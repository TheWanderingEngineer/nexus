import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import cfg from "./config.js";
import { db, save, audit } from "./store.js";
import * as metrics from "./metrics.js";
import * as dockerx from "./dockerx.js";

const run = promisify(execFile);

/**
 * Automation: watch rules, scheduled tasks, and the alerts they produce.
 *
 * Design notes worth keeping:
 *
 *  - Rules are SUSTAINED, not instantaneous. `forSec` exists because a CPU that
 *    touches 95C for one sample during a compile is not an emergency, and an
 *    alerting system that cries wolf gets muted — which is worse than no
 *    alerting at all.
 *
 *  - Every rule has a cooldown. Without one, a disk sitting at 91% would emit an
 *    alert on every evaluation tick, forever.
 *
 *  - Destructive actions (reboot, shutdown) are refused unless `power.allowRemote`
 *    is switched on. A typo in a threshold should not be able to power off the
 *    machine you are typing it from.
 *
 *  - Alerts live in the same JSON state file as everything else, capped at a
 *    fixed ring. Same reasoning as metrics: no database, no compiler.
 */

export const bus = new EventEmitter();

const TICK_MS = 10_000;          // rule evaluation
const SCHED_MS = 20_000;         // schedule check
const ALERT_MAX = 200;

/* ------------------------------------------------------------------ state */

function root() {
  const d = db();
  d.automation = d.automation || {};
  const a = d.automation;
  a.rules = a.rules || [];
  a.schedules = a.schedules || [];
  a.notify = { webhookUrl: "", webhookFormat: "auto", browser: true, ...(a.notify || {}) };
  a.power = { allowRemote: false, ...(a.power || {}) };
  d.alerts = d.alerts || [];
  return a;
}

/** Runtime-only: how long each rule has been true, and when it last fired. */
const rt = new Map();            // ruleId -> { since, lastFired, firing }

/* ------------------------------------------------------------- vocabulary */

/**
 * What a rule can watch. Kept as data so the UI builds its form from the same
 * list the evaluator uses — a source can never appear in one and not the other.
 */
export const SOURCES = [
  { key: "temp", label: "Temperature", unit: "°C", numeric: true, targets: "sensor",
    hint: "Any temperature sensor, or one you pick. ANY watches whichever is hottest." },
  { key: "cpu", label: "CPU load", unit: "%", numeric: true, targets: "none",
    hint: "Whole-host CPU usage." },
  { key: "memory", label: "Memory used", unit: "%", numeric: true, targets: "none",
    hint: "Percentage of RAM in use." },
  { key: "disk", label: "Disk used", unit: "%", numeric: true, targets: "mount",
    hint: "One mount point, or ANY for whichever is fullest." },
  { key: "container", label: "Container down", unit: "", numeric: false, targets: "container",
    hint: "Fires when the named container is not running." }
];

export const ACTIONS = [
  { key: "notify", label: "Notify in Nexus", destructive: false },
  { key: "webhook", label: "Send webhook", destructive: false },
  { key: "container.restart", label: "Restart container", destructive: false, needsTarget: true },
  { key: "container.stop", label: "Stop container", destructive: true, needsTarget: true },
  { key: "system.reboot", label: "Reboot the host", destructive: true, power: true },
  { key: "system.shutdown", label: "Shut the host down", destructive: true, power: true }
];

/**
 * Container actions only, deliberately.
 *
 * A timed whole-host reboot is not offered. Rebooting Linux on a schedule is a
 * Windows habit: it hides a leak instead of finding it, and it guarantees
 * downtime at a fixed hour whether or not anything was wrong. Restarting a
 * single container that is known to wedge is the same idea aimed at the thing
 * that actually misbehaves, so that is what this supports.
 *
 * Reboot and shutdown still exist as (a) manual buttons and (b) rule actions,
 * because "shut down if the CPU passes 95°C" is a threshold trip, not a timer.
 */
export const SCHEDULE_ACTIONS = [
  { key: "container.restart", label: "Restart a container", needsTarget: true },
  { key: "container.stop", label: "Stop a container", needsTarget: true },
  { key: "container.start", label: "Start a container", needsTarget: true }
];

/* ------------------------------------------------------------------ alerts */

export function raise({ level = "warn", title, message, ruleId = null, source = null }) {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: new Date().toISOString(),
    level, title, message, ruleId, source, ack: false
  };
  const d = db();
  d.alerts.unshift(entry);
  if (d.alerts.length > ALERT_MAX) d.alerts.length = ALERT_MAX;
  save();
  bus.emit("alert", entry);
  return entry;
}

export function listAlerts(limit = 60) { return (db().alerts || []).slice(0, limit); }

export function ackAlerts() {
  const d = db();
  d.alerts = (d.alerts || []).map(a => ({ ...a, ack: true }));
  save();
  return { ok: true };
}

export function clearAlerts() {
  db().alerts = [];
  save();
  return { ok: true };
}

/* ----------------------------------------------------------------- webhook */

/**
 * One outbound shape per popular receiver, detected from the URL rather than
 * asked for — "which format is my webhook" is a question nobody should have to
 * answer about their own ntfy topic.
 */
function webhookRequest(url, { level, title, message }) {
  const fmt = detectFormat(url);
  if (fmt === "discord") {
    const dot = level === "crit" ? "🔴" : level === "warn" ? "🟠" : "🔵";
    return {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `${dot} **${title}**\n${message}` })
    };
  }
  if (fmt === "ntfy") {
    return {
      headers: {
        "Content-Type": "text/plain",
        "Title": title,
        "Priority": level === "crit" ? "urgent" : level === "warn" ? "high" : "default",
        "Tags": level === "crit" ? "rotating_light" : level === "warn" ? "warning" : "information_source"
      },
      body: message
    };
  }
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "nexus",
      host: metrics.snapshot.host?.hostname || null,
      level, title, message, ts: new Date().toISOString()
    })
  };
}

function detectFormat(url) {
  const explicit = root().notify.webhookFormat;
  if (explicit && explicit !== "auto") return explicit;
  if (/discord(app)?\.com\/api\/webhooks/i.test(url)) return "discord";
  if (/ntfy/i.test(url)) return "ntfy";
  return "json";
}

export async function sendWebhook(payload, urlOverride) {
  const url = urlOverride || root().notify.webhookUrl;
  if (!url) throw Object.assign(new Error("no webhook URL configured"), { status: 400 });
  if (!/^https?:\/\//i.test(url)) throw Object.assign(new Error("webhook URL must be http(s)"), { status: 400 });

  const { headers, body } = webhookRequest(url, payload);
  const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw Object.assign(new Error(`webhook returned HTTP ${res.status}`), { status: 502 });
  return { ok: true, format: detectFormat(url) };
}

/* ------------------------------------------------------------------- power */

export function powerAllowed() { return !!root().power.allowRemote; }

export async function power(action, req = null, user = null) {
  if (!["reboot", "shutdown"].includes(action)) {
    throw Object.assign(new Error("unknown power action"), { status: 400 });
  }
  if (!powerAllowed()) {
    throw Object.assign(new Error("power actions are switched off - enable them in the Control Panel first"), { status: 403 });
  }
  if (!cfg.isLinux) {
    throw Object.assign(new Error("power actions are only wired up on Linux"), { status: 501 });
  }
  audit("system." + action, null, req, user);

  // systemctl first, `shutdown` as the fallback for hosts without systemd.
  const attempts = action === "reboot"
    ? [["systemctl", ["reboot"]], ["shutdown", ["-r", "now"]]]
    : [["systemctl", ["poweroff"]], ["shutdown", ["-h", "now"]]];

  let last = null;
  for (const [bin, args] of attempts) {
    try { await run(bin, args, { timeout: 10_000 }); return { ok: true, via: bin }; }
    catch (err) { last = err; }
  }
  throw Object.assign(new Error(`could not ${action}: ${String(last?.message || last).slice(0, 160)}`), { status: 500 });
}

/* ----------------------------------------------------------------- reading */

let containerCache = { at: 0, list: [] };

async function containers() {
  if (Date.now() - containerCache.at < 8000) return containerCache.list;
  if (!dockerx.status().available) { containerCache = { at: Date.now(), list: [] }; return []; }
  try {
    containerCache = { at: Date.now(), list: await dockerx.listContainers() };
  } catch { containerCache = { at: Date.now(), list: [] }; }
  return containerCache.list;
}

/** Current reading for a rule, or null when the thing it watches is missing. */
async function readSource(rule) {
  const s = metrics.snapshot;
  const target = rule.target && rule.target !== "*" ? rule.target : null;

  if (rule.source === "cpu") return { value: s.cpu.usage, unit: "%", what: "CPU" };
  if (rule.source === "memory") return { value: s.mem.usage, unit: "%", what: "Memory" };

  if (rule.source === "temp") {
    const temps = (s.sensors || []).filter(x => x.kind === "temperature");
    if (!temps.length) return null;
    const hit = target ? temps.find(x => x.id === target) : temps.reduce((a, b) => (b.value > a.value ? b : a));
    return hit ? { value: hit.value, unit: "°C", what: hit.label } : null;
  }

  if (rule.source === "disk") {
    const disks = s.disks || [];
    if (!disks.length) return null;
    const hit = target ? disks.find(d => d.mount === target) : disks.reduce((a, b) => (b.usage > a.usage ? b : a));
    return hit ? { value: hit.usage, unit: "%", what: hit.mount } : null;
  }

  if (rule.source === "container") {
    const list = await containers();
    if (!list.length) return null;
    if (target) {
      const c = list.find(x => x.name === target || x.id === target);
      if (!c) return { down: true, what: target, missing: true };
      return { down: c.state !== "running", what: c.name };
    }
    const down = list.filter(c => c.state !== "running");
    return { down: down.length > 0, what: down.map(c => c.name).slice(0, 4).join(", ") || "all containers" };
  }
  return null;
}

function conditionMet(rule, reading) {
  if (!reading) return false;
  if (rule.source === "container") return !!reading.down;
  if (typeof reading.value !== "number") return false;
  return rule.op === "below" ? reading.value < rule.value : reading.value > rule.value;
}

/* ----------------------------------------------------------------- actions */

async function runActions(rule, reading, why) {
  const title = rule.name || "Nexus alert";
  const level = rule.severity || "warn";

  for (const act of rule.actions || []) {
    try {
      if (act === "notify") {
        raise({ level, title, message: why, ruleId: rule.id, source: rule.source });

      } else if (act === "webhook") {
        await sendWebhook({ level, title, message: why });

      } else if (act === "container.restart" || act === "container.stop") {
        const name = rule.actionTarget || (rule.source === "container" ? rule.target : null);
        if (!name || name === "*") throw new Error("no container named for this action");
        await dockerx.containerAction(name, act === "container.restart" ? "restart" : "stop");
        raise({
          level: "info", title,
          message: `${act === "container.restart" ? "Restarted" : "Stopped"} ${name} - ${why}`,
          ruleId: rule.id, source: rule.source
        });

      } else if (act === "system.reboot" || act === "system.shutdown") {
        const which = act === "system.reboot" ? "reboot" : "shutdown";
        raise({ level: "crit", title, message: `${why} Triggering ${which}.`, ruleId: rule.id, source: rule.source });
        await power(which);
      }
    } catch (err) {
      raise({
        level: "crit", title: `${title}: action failed`,
        message: `${act} - ${err.message}`, ruleId: rule.id, source: rule.source
      });
    }
  }
}

/* ---------------------------------------------------------------- evaluate */

let ticking = false;

export async function evaluate() {
  if (ticking) return;
  ticking = true;
  const a = root();
  const now = Date.now();

  try {
    for (const rule of a.rules) {
      const state = rt.get(rule.id) || { since: 0, lastFired: 0, firing: false };
      if (!rule.enabled) { state.since = 0; state.firing = false; rt.set(rule.id, state); continue; }

      let reading = null;
      try { reading = await readSource(rule); } catch { reading = null; }
      const met = conditionMet(rule, reading);

      if (!met) {
        // Only announce a recovery for something that actually alerted.
        if (state.firing) {
          state.firing = false;
          raise({
            level: "info",
            title: `${rule.name || "Rule"} - cleared`,
            message: describe(rule, reading, true),
            ruleId: rule.id, source: rule.source
          });
        }
        state.since = 0;
        rt.set(rule.id, state);
        continue;
      }

      if (!state.since) state.since = now;
      const sustained = now - state.since >= (rule.forSec || 0) * 1000;
      const cooled = now - state.lastFired >= (rule.cooldownSec || 900) * 1000;

      if (sustained && cooled && !state.firing) {
        state.lastFired = now;
        state.firing = true;
        rt.set(rule.id, state);
        await runActions(rule, reading, describe(rule, reading, false));
      } else {
        rt.set(rule.id, state);
      }
    }
  } finally {
    ticking = false;
  }
}

function describe(rule, reading, cleared) {
  if (rule.source === "container") {
    const what = reading?.what || rule.target || "container";
    return cleared ? `${what} is running again.` : `${what} is not running.`;
  }
  const what = reading?.what || rule.source;
  const unit = reading?.unit || "";
  const v = reading?.value;
  const dir = rule.op === "below" ? "below" : "above";
  if (cleared) {
    const back = rule.op === "below" ? "above" : "below";
    return `${what} is back ${back} ${rule.value}${unit}${v != null ? ` (now ${v}${unit})` : ""}.`;
  }
  return `${what} is ${v}${unit}, ${dir} the ${rule.value}${unit} threshold for ${fmtDur(rule.forSec)}.`;
}

function fmtDur(sec) {
  sec = Number(sec) || 0;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

/* --------------------------------------------------------------- schedules */

async function runSchedules() {
  const a = root();
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  const day = now.getDay();
  const minuteStamp = now.toISOString().slice(0, 16);

  for (const s of a.schedules) {
    if (!s.enabled) continue;
    if (s.time !== hhmm) continue;
    if (Array.isArray(s.days) && s.days.length && !s.days.includes(day)) continue;
    // The tick is faster than a minute, so stamp the minute we ran in and skip
    // repeats within it. Without this a 20s tick fires the same job three times.
    if (s.lastMinute === minuteStamp) continue;

    s.lastMinute = minuteStamp;
    s.lastRunAt = Date.now();
    save();

    try {
      if (!s.action.startsWith("container.")) throw new Error(`unsupported scheduled action ${s.action}`);
      if (!s.target) throw new Error("no container selected");
      await dockerx.containerAction(s.target, s.action.split(".")[1]);
      raise({ level: "info", title: s.name || "Scheduled task", message: `${s.action} on ${s.target} - done.`, source: "schedule" });
      s.lastError = null;
    } catch (err) {
      s.lastError = String(err.message || err).slice(0, 200);
      raise({ level: "crit", title: `${s.name || "Scheduled task"} failed`, message: s.lastError, source: "schedule" });
    }
    save();
  }
}

/* -------------------------------------------------------------------- CRUD */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function cleanRule(input, existing = {}) {
  const src = SOURCES.find(s => s.key === input.source)
           || SOURCES.find(s => s.key === existing.source)
           || SOURCES[0];
  const actions = (Array.isArray(input.actions) ? input.actions : [])
    .filter(k => ACTIONS.some(a => a.key === k)).slice(0, 4);
  return {
    id: existing.id || uid(),
    enabled: input.enabled !== false,
    name: String(input.name || "").slice(0, 60) || `${src.label} rule`,
    source: src.key,
    target: input.target == null ? "*" : String(input.target).slice(0, 120),
    op: input.op === "below" ? "below" : "above",
    value: clampNum(input.value, -1000, 100000, 80),
    forSec: clampNum(input.forSec, 0, 86400, 60),
    cooldownSec: clampNum(input.cooldownSec, 60, 604800, 900),
    severity: ["info", "warn", "crit"].includes(input.severity) ? input.severity : "warn",
    actions: actions.length ? actions : ["notify"],
    actionTarget: input.actionTarget ? String(input.actionTarget).slice(0, 120) : null
  };
}

function cleanSchedule(input, existing = {}) {
  const action = SCHEDULE_ACTIONS.some(a => a.key === input.action) ? input.action : "container.restart";
  const days = Array.isArray(input.days)
    ? [...new Set(input.days.map(Number).filter(n => n >= 0 && n <= 6))].sort()
    : [0, 1, 2, 3, 4, 5, 6];
  return {
    id: existing.id || uid(),
    enabled: input.enabled !== false,
    name: String(input.name || "").slice(0, 60) || "Scheduled task",
    time: /^\d{2}:\d{2}$/.test(String(input.time || "")) ? input.time : "04:00",
    days: days.length ? days : [0, 1, 2, 3, 4, 5, 6],
    action,
    target: input.target ? String(input.target).slice(0, 120) : null,
    lastRunAt: existing.lastRunAt || null,
    lastMinute: existing.lastMinute || null,
    lastError: existing.lastError || null
  };
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n * 10) / 10));
}

export function getConfig() {
  const a = root();
  return {
    rules: a.rules,
    schedules: a.schedules,
    notify: a.notify,
    power: { allowRemote: a.power.allowRemote, supported: cfg.isLinux },
    sources: SOURCES,
    actions: ACTIONS,
    scheduleActions: SCHEDULE_ACTIONS,
    // Everything the UI needs to offer real choices instead of free-text boxes.
    available: {
      sensors: (metrics.snapshot.sensors || []).map(s => ({ id: s.id, label: s.label, kind: s.kind, unit: s.unit, value: s.value })),
      mounts: (metrics.snapshot.disks || []).map(d => ({ mount: d.mount, usage: d.usage })),
      containers: containerCache.list.map(c => ({ name: c.name, state: c.state }))
    }
  };
}

export function saveRule(input) {
  const a = root();
  const i = a.rules.findIndex(r => r.id === input.id);
  const rule = cleanRule(input, i >= 0 ? a.rules[i] : {});
  if (i >= 0) a.rules[i] = rule; else a.rules.push(rule);
  // A rule whose threshold just changed should re-arm, not inherit the old timer.
  rt.delete(rule.id);
  save();
  return rule;
}

export function deleteRule(id) {
  const a = root();
  a.rules = a.rules.filter(r => r.id !== id);
  rt.delete(id);
  save();
  return { ok: true };
}

export function saveSchedule(input) {
  const a = root();
  const i = a.schedules.findIndex(s => s.id === input.id);
  const sched = cleanSchedule(input, i >= 0 ? a.schedules[i] : {});
  if (i >= 0) a.schedules[i] = sched; else a.schedules.push(sched);
  save();
  return sched;
}

export function deleteSchedule(id) {
  const a = root();
  a.schedules = a.schedules.filter(s => s.id !== id);
  save();
  return { ok: true };
}

export function saveNotify(input) {
  const a = root();
  a.notify = {
    webhookUrl: String(input.webhookUrl || "").slice(0, 400),
    webhookFormat: ["auto", "ntfy", "discord", "json"].includes(input.webhookFormat) ? input.webhookFormat : "auto",
    browser: input.browser !== false
  };
  save();
  return a.notify;
}

export function savePower(input) {
  const a = root();
  a.power.allowRemote = !!input.allowRemote;
  save();
  return { allowRemote: a.power.allowRemote, supported: cfg.isLinux };
}

/* ----------------------------------------------------------------- seeding */

/**
 * Two rules on first boot, both notify-only.
 *
 * Seeding nothing leaves a page of empty forms most people never fill in;
 * seeding anything destructive would be indefensible. These two are the failures
 * that actually kill homelab boxes, and the worst they can do is tell you.
 */
const SEED = [
  { name: "CPU temperature high", source: "temp", target: "*", op: "above", value: 82, forSec: 120, cooldownSec: 1800, severity: "warn", actions: ["notify"] },
  { name: "Disk almost full", source: "disk", target: "*", op: "above", value: 90, forSec: 300, cooldownSec: 21600, severity: "warn", actions: ["notify"] }
];

export function init() {
  const a = root();
  if (!a.seeded) {
    a.seeded = true;
    if (!a.rules.length) for (const s of SEED) a.rules.push(cleanRule(s));
    save();
  }
  setInterval(() => { evaluate().catch(() => {}); }, TICK_MS).unref?.();
  setInterval(() => { runSchedules().catch(() => {}); }, SCHED_MS).unref?.();
}
