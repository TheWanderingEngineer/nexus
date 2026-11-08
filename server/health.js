import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import cfg from "./config.js";
import { db, save } from "./store.js";
import * as metrics from "./metrics.js";
import * as dockerx from "./dockerx.js";
import * as automation from "./automation.js";

/**
 * Health checks: is each thing this box is responsible for actually working?
 *
 * Five areas, the same five the Overview page shows:
 *
 *   servers     the host itself — collector, CPU, memory, temperature, Docker
 *   network     DNS, the internet, the default gateway
 *   storage     every mount, and SMART where it could be read
 *   containers  each container: running, and not reporting itself unhealthy
 *   apps        every launcher tile with a local address, probed over HTTP
 *
 * plus any custom checks the owner adds (HTTP, TCP, ping, DNS) in whichever area
 * they choose.
 *
 * Rules this module keeps, and why:
 *
 *  - **Results live in memory.** The same reasoning as the metrics ring buffers:
 *    a row per check every thirty seconds written to an SD card is a slow way to
 *    kill it. Sixty results per check, which is the half hour the Overview shows.
 *
 *  - **Absent is not zero.** A check that could not run reports `unknown`, and a
 *    thing that cannot be measured on this platform (a gateway on Windows, a
 *    temperature on a box with no sensors) has no check at all rather than a
 *    green one. A stopped container is `off`, not `down`: people stop things on
 *    purpose, and a dashboard that calls that an outage gets ignored.
 *
 *  - **Three strikes, and a flap damper.** A probe has to fail three times in a
 *    row before it raises an alert, recovery is announced once, and a check
 *    that alerted in the last fifteen minutes stays quiet. One dropped packet
 *    is not news, and neither is the tenth bounce of a flaky DNS server.
 *
 *  - **Nothing is interpolated into a shell.** `ping` is `execFile` with a host
 *    that has already matched a strict pattern; everything else is a socket.
 *
 *  - **A locked app's address never leaves the server.** It is probed like any
 *    other, but the target is reported as "locked".
 */

const KEEP = 60;
const FAST_MS = 10_000;
const SLOW_MS = 30_000;
const PROBE_TIMEOUT = 6000;
const SLOW_RESPONSE_MS = 3000;

export const AREAS = [
  { id: "servers",    name: "Servers",    icon: "server" },
  { id: "network",    name: "Network",    icon: "globe" },
  { id: "storage",    name: "Storage",    icon: "database" },
  { id: "containers", name: "Containers", icon: "box" },
  { id: "apps",       name: "Apps",       icon: "grid" }
];
const AREA_IDS = new Set(AREAS.map(a => a.id));

/** checkId -> { id, area, name, kind, target, status, ms, msg, since, at, strikes, alerted, history[] } */
const checks = new Map();
/** areaId -> [{ t, s }] */
const areaHistory = new Map(AREAS.map(a => [a.id, []]));
let updatedAt = 0;

/* ------------------------------------------------------------------ config */

function conf() {
  const s = db().settings = db().settings || {};
  s.health = { notify: true, custom: [], ...(s.health || {}) };
  if (!Array.isArray(s.health.custom)) s.health.custom = [];
  return s.health;
}

const HOST_RE = /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
const IPV6_RE = /^[0-9a-fA-F:]{2,39}$/;
const validHost = h => typeof h === "string" && (HOST_RE.test(h) || IPV6_RE.test(h));

function cleanCustom(c, i) {
  const kind = ["http", "tcp", "ping", "dns"].includes(c?.kind) ? c.kind : null;
  if (!kind) return null;
  let target = String(c.target || "").trim().slice(0, 300);
  if (kind === "http") {
    try {
      const u = new URL(target);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      target = u.toString();
    } catch { return null; }
  } else if (kind === "tcp") {
    const m = /^(.+):(\d{1,5})$/.exec(target);
    if (!m || !validHost(m[1].replace(/^\[|\]$/g, "")) || +m[2] < 1 || +m[2] > 65535) return null;
  } else if (!validHost(target)) return null;
  return {
    id: String(c.id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 24) || "c" + Date.now().toString(36) + i,
    name: String(c.name || target).trim().slice(0, 48) || target,
    area: AREA_IDS.has(c.area) ? c.area : "network",
    kind, target
  };
}

export function saveConfig(input = {}) {
  const h = conf();
  if (Array.isArray(input.custom)) {
    h.custom = input.custom.slice(0, 40).map(cleanCustom).filter(Boolean);
    // Drop the history of checks that no longer exist, so a renamed target
    // does not inherit the record of the old one.
    for (const id of [...checks.keys()]) {
      if (id.startsWith("custom:") && !h.custom.some(c => "custom:" + c.id === id)) checks.delete(id);
    }
  }
  if (typeof input.notify === "boolean") h.notify = input.notify;
  save();
  slowLoop().catch(() => {});
  return { notify: h.notify, custom: h.custom };
}

/* ------------------------------------------------------------------ probes */

const now = () => Date.now();

function timed(fn) {
  const t0 = performance.now();
  return fn().then(
    r => ({ ...r, ms: r.ms ?? Math.round(performance.now() - t0) }),
    e => ({ s: "down", ms: Math.round(performance.now() - t0), msg: shortErr(e) })
  );
}

function shortErr(e) {
  const code = e?.code || "";
  const map = {
    ECONNREFUSED: "connection refused", ETIMEDOUT: "timed out", ENOTFOUND: "name not found",
    EHOSTUNREACH: "host unreachable", ENETUNREACH: "network unreachable", ECONNRESET: "connection reset",
    EAI_AGAIN: "DNS lookup failed", ESERVFAIL: "DNS server failed", ENODATA: "no DNS records"
  };
  return map[code] || String(e?.message || e || "failed").split("\n")[0].slice(0, 160);
}

/**
 * An HTTP check. Any response below 500 means the app answered — a 401 or a
 * redirect to a login page is an app that is up. Certificates are not verified:
 * homelab services are usually self-signed, and this asks "is it answering",
 * not "is the connection private". Nothing is sent but a GET.
 */
function httpProbe(url) {
  return timed(() => new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error("bad address")); }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, {
      method: "GET",
      timeout: PROBE_TIMEOUT,
      rejectUnauthorized: false,
      headers: { "User-Agent": "Nexus-health/" + cfg.version, Accept: "*/*" }
    }, res => {
      const code = res.statusCode || 0;
      res.destroy();
      if (code >= 500) resolve({ s: "down", msg: `HTTP ${code}` });
      else resolve({ s: "up", msg: `HTTP ${code}` });
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    req.end();
  })).then(r => (r.s === "up" && r.ms > SLOW_RESPONSE_MS ? { ...r, s: "warn", msg: `slow — ${r.msg}` } : r));
}

function tcpProbe(host, port) {
  return timed(() => new Promise((resolve, reject) => {
    const sock = net.connect({ host, port, timeout: PROBE_TIMEOUT });
    sock.once("connect", () => { sock.destroy(); resolve({ s: "up", msg: `port ${port} open` }); });
    sock.once("timeout", () => { sock.destroy(); reject(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })); });
    sock.once("error", e => { sock.destroy(); reject(e); });
  }));
}

const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 1 });

function dnsProbe(name) {
  return timed(async () => {
    let addrs;
    try { addrs = await resolver.resolve4(name); }
    catch (e) { if (e.code === "ENODATA") addrs = await resolver.resolve6(name); else throw e; }
    return { s: "up", msg: `${addrs.length} address${addrs.length === 1 ? "" : "es"}` };
  });
}

/** ICMP through the system `ping`, because a raw socket needs a native module. */
function pingProbe(host) {
  if (!validHost(host)) return Promise.resolve({ s: "unknown", ms: null, msg: "invalid host" });
  const args = process.platform === "win32" ? ["-n", "1", "-w", "2000", host] : ["-c", "1", "-W", "2", host];
  return new Promise(resolve => {
    const t0 = performance.now();
    execFile("ping", args, { timeout: 5000 }, (err, stdout) => {
      if (err && err.code === "ENOENT") return resolve({ s: "unknown", ms: null, msg: "ping is not installed" });
      const m = /time[=<]\s*([\d.]+)\s*ms/i.exec(stdout || "");
      if (err || !m) return resolve({ s: "down", ms: Math.round(performance.now() - t0), msg: "no reply" });
      resolve({ s: "up", ms: Math.round(Number(m[1])), msg: "reply" });
    });
  });
}

/** The default gateway, from the kernel's routing table. Linux only. */
async function defaultGateway() {
  if (!cfg.isLinux) return null;
  try {
    const rows = (await fsp.readFile("/proc/net/route", "utf8")).trim().split("\n").slice(1);
    for (const row of rows) {
      const f = row.trim().split(/\s+/);
      if (f[1] === "00000000" && f[2] !== "00000000") {
        const hex = f[2];
        return [3, 2, 1, 0].map(i => parseInt(hex.slice(i * 2, i * 2 + 2), 16)).join(".");
      }
    }
  } catch {}
  return null;
}

/* --------------------------------------------------------------- recording */

function record(def, r) {
  const t = now();
  let c = checks.get(def.id);
  if (!c) {
    c = { id: def.id, history: [], status: null, since: t, strikes: 0, alerted: false };
    checks.set(def.id, c);
  }
  Object.assign(c, {
    area: def.area, name: def.name, kind: def.kind, target: def.target ?? null,
    action: def.action || null, alerts: !!def.alerts
  });
  const s = r.s || "unknown";
  if (c.status !== s) { c.status = s; c.since = t; }
  c.ms = Number.isFinite(r.ms) ? r.ms : null;
  c.msg = r.msg || "";
  c.at = t;
  c.history.push({ t, s, ms: c.ms, ...(s !== "up" && c.msg ? { m: c.msg } : {}) });
  if (c.history.length > KEEP) c.history.splice(0, c.history.length - KEEP);
  if (def.alerts) noteForAlert(c);
}

/**
 * When a check is worth telling someone about.
 *
 * Three consecutive failures — about ninety seconds of a probe that runs every
 * thirty — before anything is raised, and the first success after that clears
 * it with one "back up". On top of that, a check that alerted in the last
 * fifteen minutes goes quiet if it fails again: a flapping DNS server or a
 * congested uplink otherwise produces a down/up pair every few minutes, and an
 * alert channel that does that gets muted, which is worse than no alerts.
 * The flap is still on the Overview, in the result bars, where it belongs.
 */
const STRIKES = 3;
const FLAP_MS = 15 * 60_000;
function noteForAlert(c) {
  const area = AREAS.find(a => a.id === c.area)?.name || c.area;
  if (c.status === "down") {
    c.strikes++;
    if (c.strikes >= STRIKES && !c.alerted) {
      c.alerted = true;
      const t = now();
      c.loud = !c.lastAlertAt || t - c.lastAlertAt >= FLAP_MS;
      if (c.loud) {
        c.lastAlertAt = t;
        announce("crit", `${c.name} is down`, `${area}: ${c.msg || "no response"}`);
      }
    }
  } else if (c.status === "up") {
    if (c.alerted && c.loud) announce("info", `${c.name} is back up`, `${area}: ${c.msg || "responding"}`);
    c.strikes = 0;
    c.alerted = false;
    c.loud = false;
  }
}

function announce(level, title, message) {
  try { automation.raise({ level, title, message, source: "health" }); } catch {}
  const h = conf();
  const hasHook = !!db().automation?.notify?.webhookUrl;
  if (h.notify && hasHook) automation.sendWebhook({ level, title, message }).catch(() => {});
}

function pushAreaHistory(ids) {
  const t = now();
  for (const id of ids) {
    const list = [...checks.values()].filter(c => c.area === id);
    const s = worst(list.map(c => c.status));
    if (!s) continue;
    const h = areaHistory.get(id);
    h.push({ t, s });
    if (h.length > KEEP) h.splice(0, h.length - KEEP);
  }
}

const RANK = { down: 3, warn: 2, up: 1 };
/** The worst real status. `off` and `unknown` say nothing about health. */
function worst(list) {
  let best = null, r = 0;
  for (const s of list) if ((RANK[s] || 0) > r) { r = RANK[s]; best = s; }
  if (best) return best;
  return list.length ? "unknown" : null;
}

function prune(prefixes, alive) {
  for (const id of [...checks.keys()]) {
    if (prefixes.some(p => id.startsWith(p)) && !alive.has(id)) checks.delete(id);
  }
}

/* ------------------------------------------------------------ fast checks */

/* A pass already running is joined, not skipped. Skipping (a plain busy
   flag) meant "Run checks" pressed right after adding a check returned before
   that check had been probed at all. Joining still never runs two passes at
   once, which is what the guard is for. */
let fastRun = null, slowRun = null;
function fastLoop() {
  if (!fastRun) fastRun = fastPass().finally(() => { fastRun = null; });
  return fastRun;
}
function slowLoop() {
  if (!slowRun) slowRun = slowPass().finally(() => { slowRun = null; });
  return slowRun;
}

async function fastPass() {
  try {
    const snap = metrics.snapshot;
    const alive = new Set();
    const put = (def, r) => { alive.add(def.id); record(def, r); };

    // The collector itself. If this is stale, every other reading is too.
    const age = snap.updatedAt ? Math.round((now() - snap.updatedAt) / 1000) : null;
    // A tick normally lands every second, but on a slow or busy host one pass
    // of the collector can take several — so "late" is degraded and only a
    // minute of silence is down.
    put({ id: "srv:collector", area: "servers", name: "Metrics collector", kind: "derived" },
      age == null ? { s: "unknown", msg: "warming up" }
        : age <= 20 ? { s: "up", msg: `last sample ${age}s ago` }
          : age <= 60 ? { s: "warn", msg: `last sample ${age}s ago — the host is slow to answer` }
            : { s: "down", msg: `no sample for ${age}s` });

    if (snap.updatedAt) {
      const recent = metrics.series.cpu.last(60);
      const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : snap.cpu.usage;
      put({ id: "srv:cpu", area: "servers", name: "CPU load", kind: "derived" },
        { s: avg >= 97 ? "down" : avg >= 90 ? "warn" : "up", msg: `${Math.round(avg)}% average over the last minute` });

      const m = snap.mem;
      if (m.total) {
        put({ id: "srv:mem", area: "servers", name: "Memory", kind: "derived" },
          { s: m.usage >= 97 ? "down" : m.usage >= 92 ? "warn" : "up", msg: `${Math.round(m.usage)}% in use` });
      }

      const temps = (snap.sensors || []).filter(s => s.kind === "temperature" && Number.isFinite(s.value));
      if (temps.length) {
        const hot = temps.reduce((a, b) => (b.value > a.value ? b : a));
        const crit = hot.critical || 95, warnAt = hot.max || crit * 0.88;
        put({ id: "srv:temp", area: "servers", name: "Temperature", kind: "derived" },
          { s: hot.value >= crit ? "down" : hot.value >= warnAt ? "warn" : "up",
            msg: `${hot.label}: ${Math.round(hot.value)}°C` });
      }
    }

    if (cfg.docker.enabled) {
      const d = dockerx.status();
      put({ id: "srv:docker", area: "servers", name: "Docker engine", kind: "derived" },
        d.available ? { s: "up", msg: "connected" } : { s: "down", msg: d.reason || "unavailable" });
    }

    for (const d of snap.disks || []) {
      const free = humanBytes(d.available);
      put({ id: "disk:" + d.mount, area: "storage", name: d.mount, kind: "disk", action: { kind: "files" } },
        { s: d.usage >= 95 ? "down" : d.usage >= 85 ? "warn" : "up",
          msg: `${Math.round(d.usage)}% used · ${free} free` });
    }
    for (const sm of snap.smart || []) {
      const def = { id: "smart:" + sm.device, area: "storage", name: `SMART ${sm.device}`, kind: "smart" };
      if (sm.error) put(def, { s: "unknown", msg: sm.error });
      else if (sm.standby) put(def, { s: "unknown", msg: "drive asleep — not woken to check" });
      else put(def, sm.passed === false ? { s: "down", msg: "SMART reports failing" }
        : sm.passed ? { s: "up", msg: `passed${sm.temperature != null ? ` · ${sm.temperature}°C` : ""}` }
          : { s: "unknown", msg: "no verdict" });
    }

    prune(["srv:", "disk:", "smart:"], alive);
    pushAreaHistory(["servers", "storage"]);
    updatedAt = now();
  } catch (e) { console.error("[health] readings:", e.message); }
}

/* ------------------------------------------------------------ slow checks */

async function slowPass() {
  try {
    const alive = new Set();
    const jobs = [];
    const add = (def, fn) => {
      alive.add(def.id);
      jobs.push(async () => { record(def, await fn().catch(e => ({ s: "unknown", msg: shortErr(e) }))); });
    };

    // Network.
    add({ id: "net:dns", area: "network", name: "DNS resolution", kind: "dns", target: "cloudflare.com", alerts: true },
      () => dnsProbe("cloudflare.com"));
    // Two well-known anycast addresses at once: up if either answers, so one
    // provider having a bad minute is not "the internet is down".
    add({ id: "net:internet", area: "network", name: "Internet", kind: "tcp", target: "1.1.1.1:443", alerts: true },
      async () => {
        const [a, b] = await Promise.all([tcpProbe("1.1.1.1", 443), tcpProbe("8.8.8.8", 53)]);
        if (a.s === "up") return a;
        return b.s === "up" ? { ...b, msg: "1.1.1.1 unreachable, 8.8.8.8 answered" } : a;
      });
    const gw = await defaultGateway();
    if (gw) {
      add({ id: "net:gateway", area: "network", name: "Default gateway", kind: "ping", target: gw, alerts: true },
        () => pingProbe(gw));
    }

    // Containers. Running and healthy is up; unhealthy is down; restarting is
    // degraded; stopped is off — a choice, not an outage.
    if (cfg.docker.enabled && dockerx.status().available) {
      let list = [];
      try { list = await dockerx.listContainers(); } catch {}
      for (const c of list) {
        const st = String(c.status || "");
        const def = { id: "ctr:" + c.name, area: "containers", name: c.title || c.name, kind: "container",
                      target: c.image, alerts: true, action: { kind: "container", id: c.id, name: c.name } };
        alive.add(def.id);
        let r;
        if (c.state === "running") {
          r = /unhealthy/i.test(st) ? { s: "down", msg: st }
            : /health: starting/i.test(st) ? { s: "warn", msg: st }
              : { s: "up", msg: st };
        } else if (c.state === "restarting") r = { s: "warn", msg: st || "restarting" };
        else if (c.state === "dead") r = { s: "down", msg: st || "dead" };
        else r = { s: "off", msg: st || c.state };
        record(def, r);
      }
    }

    // Launcher apps with a local address.
    const apps = (db().settings?.launcher?.apps || []).filter(a => a && a.url);
    for (const a of apps) {
      add({ id: "app:" + a.id, area: "apps", name: a.name, kind: "http",
            target: a.lock ? "locked" : a.url, alerts: true, action: { kind: "app", id: a.id } },
        () => httpProbe(a.url));
    }

    // The owner's own.
    for (const c of conf().custom) {
      const def = { id: "custom:" + c.id, area: c.area, name: c.name, kind: c.kind, target: c.target, alerts: true, custom: true };
      add(def, () => {
        if (c.kind === "http") return httpProbe(c.target);
        if (c.kind === "dns") return dnsProbe(c.target);
        if (c.kind === "ping") return pingProbe(c.target);
        const m = /^(.+):(\d+)$/.exec(c.target);
        return tcpProbe(m[1].replace(/^\[|\]$/g, ""), Number(m[2]));
      });
    }

    // Six at a time: enough to finish a board of thirty apps inside one
    // interval, few enough that a slow box is not opening sockets in a burst.
    const queue = jobs.slice();
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (queue.length) await queue.shift()();
    }));

    prune(["net:", "ctr:", "app:", "custom:"], alive);
    pushAreaHistory(["network", "containers", "apps"]);
    updatedAt = now();
  } catch (e) { console.error("[health] probes:", e.message); }
}

function humanBytes(n) {
  if (!Number.isFinite(n)) return "?";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)) + " " + u[i];
}

/* ------------------------------------------------------------------ output */

const SHOWN = 30;

function publicCheck(c) {
  const hist = c.history.slice(-SHOWN);
  const timed = c.history.filter(h => Number.isFinite(h.ms));
  // Only results that said something count towards uptime: an `off` container
  // or an `unknown` probe is neither up nor down, and an uptime with nothing
  // behind it is null rather than a confident 0%.
  const counted = c.history.filter(h => h.s !== "off" && h.s !== "unknown");
  return {
    id: c.id, area: c.area, name: c.name, kind: c.kind, target: c.target,
    status: c.status, ms: c.ms, msg: c.msg, since: c.since, at: c.at,
    avgMs: timed.length ? Math.round(timed.reduce((a, h) => a + h.ms, 0) / timed.length) : null,
    uptime: counted.length
      ? Math.round(counted.filter(h => h.s === "up").length / counted.length * 1000) / 10
      : null,
    action: c.action, custom: c.id.startsWith("custom:"),
    history: hist
  };
}

/** What the Overview and the area pages read. */
export function overview() {
  const list = [...checks.values()].map(publicCheck);
  const areas = AREAS.map(a => {
    const mine = list.filter(c => c.area === a.id);
    const counted = mine.filter(c => c.status !== "off" && c.status !== "unknown");
    const ms = mine.filter(c => Number.isFinite(c.ms)).map(c => c.ms);
    return {
      ...a,
      status: worst(mine.map(c => c.status)) || "empty",
      up: counted.filter(c => c.status === "up").length,
      total: counted.length,
      checks: mine.length,
      avgMs: ms.length ? Math.round(ms.reduce((x, y) => x + y, 0) / ms.length) : null,
      history: areaHistory.get(a.id).slice(-SHOWN)
    };
  });
  const problems = list
    .filter(c => c.status === "down" || c.status === "warn")
    .sort((a, b) => (RANK[b.status] - RANK[a.status]) || (a.since - b.since))
    .map(c => ({ id: c.id, area: c.area, name: c.name, status: c.status, since: c.since, msg: c.msg,
                 target: c.target, action: c.action }));
  const h = conf();
  return { updatedAt, areas, checks: list, problems, config: { notify: h.notify, custom: h.custom } };
}

/** One line per problem, for Kernel's briefing. */
export function summaryLines() {
  const o = overview();
  if (!o.updatedAt) return ["Health checks: not run yet."];
  if (!o.problems.length) return [`Health checks: all ${o.checks.length} passing or idle.`];
  return [`Health checks: ${o.problems.length} problem${o.problems.length === 1 ? "" : "s"}.`,
    ...o.problems.slice(0, 8).map(p => `  - [${p.status}] ${p.name} (${p.area}): ${p.msg}`)];
}

export async function runNow() {
  await Promise.all([fastLoop(), slowLoop()]);
  return overview();
}

export function start() {
  // Staggered, so the first slow pass does not land on top of the first
  // metrics sample and the first container listing at boot.
  setTimeout(() => fastLoop().catch(e => console.error("[health]", e.message)), 1500);
  setTimeout(() => slowLoop().catch(e => console.error("[health]", e.message)), 4000);
  setInterval(() => fastLoop().catch(() => {}), FAST_MS).unref?.();
  setInterval(() => slowLoop().catch(() => {}), SLOW_MS).unref?.();
}
