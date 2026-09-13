import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import cfg from "./config.js";
import { db } from "./store.js";
import * as terminal from "./terminal.js";

const run = promisify(execFile);

/**
 * Security posture for a single homelab box.
 *
 * Scope, stated plainly: this is not an intrusion detection system and does not
 * pretend to be. It answers four questions a person running a box at home
 * actually asks, using signals the machine already has:
 *
 *   - Is anyone trying to log in?        failed SSH and failed Nexus logins
 *   - What of mine is reachable?         listening sockets bound to all interfaces
 *   - Am I behind on patches?            pending updates, security ones counted
 *   - Who is on the box right now?       active login sessions
 *
 * Every check degrades to "unknown" rather than to "fine". A check that quietly
 * reports all-clear when it failed to run is worse than no check, because it
 * buys confidence it has not earned.
 */

const CACHE_MS = 5 * 60_000;     // the update check is slow; nobody needs it live
let cache = { at: 0, hours: 0, data: null };
let scanning = false;

const nowSec = () => Math.floor(Date.now() / 1000);

/* --------------------------------------------------------------- helpers */

async function sh(bin, args, timeout = 12_000) {
  const { stdout, stderr } = await run(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
  return { stdout: stdout || "", stderr: stderr || "" };
}

/** A result that says "I could not tell", which is not the same as "all clear". */
const unknown = reason => ({ ok: false, reason });

/* ----------------------------------------------------------- ssh failures */

/**
 * Failed SSH logins in the window.
 *
 * journalctl first because it works regardless of whether rsyslog is installed;
 * /var/log/auth.log as a fallback for hosts that still write one. Both are
 * capped: a box that has been scanned for a week can have hundreds of thousands
 * of these lines and reading them all to count them would be its own outage.
 */
async function sshFailures(hours) {
  const since = `-${hours}h`;
  let lines = null;

  try {
    const { stdout } = await sh("journalctl", [
      "-u", "ssh", "-u", "sshd", "--since", since, "--no-pager", "-q", "-n", "5000"
    ]);
    lines = stdout.split("\n");
  } catch {
    try {
      const raw = await fs.readFile("/var/log/auth.log", "utf8");
      lines = raw.split("\n").slice(-20000);
    } catch {
      return unknown("no journal or auth.log could be read");
    }
  }

  const byIp = new Map();
  let count = 0;
  for (const line of lines) {
    if (!/Failed password|Invalid user|authentication failure|Connection closed by authenticating user/i.test(line)) continue;
    count++;
    const m = /from\s+((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f:]{3,})/i.exec(line);
    if (m) byIp.set(m[1], (byIp.get(m[1]) || 0) + 1);
  }

  const top = [...byIp.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([ip, n]) => ({ ip, n }));

  return { ok: true, count, sources: byIp.size, top };
}

/* --------------------------------------------------- nexus login failures */

/** Straight from the audit ring — no shelling out, and it is always present. */
function nexusFailures(hours) {
  const cutoff = Date.now() - hours * 3600_000;
  const rows = (db().audit || []).filter(e =>
    e.action === "auth.login.failed" && new Date(e.ts).getTime() >= cutoff);

  const byIp = new Map();
  for (const r of rows) if (r.ip) byIp.set(r.ip, (byIp.get(r.ip) || 0) + 1);

  return {
    ok: true,
    count: rows.length,
    top: [...byIp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ip, n]) => ({ ip, n }))
  };
}

/* --------------------------------------------------------- listening ports */

/**
 * What this box is offering to the network.
 *
 * The distinction that matters is the bind address, not the port: something on
 * 127.0.0.1 is reachable only from the box itself, while the same service on
 * 0.0.0.0 is reachable by every device on your network — and by anything that
 * gets onto it.
 */
async function listeningPorts() {
  if (!cfg.isLinux) return unknown("only implemented on Linux");

  let out;
  try { ({ stdout: out } = await sh("ss", ["-tlnpH"])); }
  catch {
    try { ({ stdout: out } = await sh("ss", ["-tlnH"])); }
    catch { return unknown("ss is not available"); }
  }

  const seen = new Map();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    // LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))
    const local = parts[3];
    if (!local) continue;
    const i = local.lastIndexOf(":");
    if (i < 0) continue;
    const addr = local.slice(0, i);
    const port = Number(local.slice(i + 1));
    if (!Number.isFinite(port)) continue;

    const world = addr === "0.0.0.0" || addr === "*" || addr === "::" || addr === "[::]";
    const proc = /"([^"]+)"/.exec(line)?.[1] || null;

    // The same port on 0.0.0.0 and :: is one service, not two.
    const key = port + "|" + (world ? "w" : addr);
    const prev = seen.get(key);
    if (!prev || (proc && !prev.proc)) seen.set(key, { port, addr, world, proc });
  }

  const list = [...seen.values()].sort((a, b) => a.port - b.port);
  return { ok: true, list, exposed: list.filter(p => p.world).length };
}

/* -------------------------------------------------------- pending updates */

/**
 * Ubuntu and Debian ship apt-check precisely for this, and it answers in
 * milliseconds. `apt-get -s upgrade` would also work but takes seconds and
 * needs the lock, which is a poor trade for a number on a dashboard.
 */
async function pendingUpdates() {
  if (!cfg.isLinux) return unknown("only implemented on Linux");

  try {
    // apt-check writes "total;security" to stderr, which is unusual but stable.
    const { stdout, stderr } = await sh("/usr/lib/update-notifier/apt-check", [], 20_000);
    const m = /^(\d+);(\d+)/.exec((stderr || stdout).trim());
    if (m) return { ok: true, total: Number(m[1]), security: Number(m[2]) };
  } catch { /* not an Ubuntu box, or update-notifier is not installed */ }

  try {
    const { stdout } = await sh("apt-get", ["-s", "-q", "upgrade"], 30_000);
    const total = (stdout.match(/^Inst /gm) || []).length;
    const security = (stdout.match(/^Inst .*(-security|Security)/gm) || []).length;
    return { ok: true, total, security, approximate: true };
  } catch {
    return unknown("no apt on this host");
  }
}

/* -------------------------------------------------------------- sessions */

async function activeSessions() {
  if (!cfg.isLinux) return unknown("only implemented on Linux");
  try {
    const { stdout } = await sh("who", []);
    const list = stdout.split("\n").filter(Boolean).map(line => {
      const p = line.trim().split(/\s+/);
      const from = /\(([^)]+)\)/.exec(line)?.[1] || null;
      return { user: p[0], tty: p[1], since: `${p[2] || ""} ${p[3] || ""}`.trim(), from };
    });
    return { ok: true, list, count: list.length };
  } catch {
    return unknown("who is not available");
  }
}

/* -------------------------------------------------------------- findings */

/**
 * Turn the raw readings into things worth saying.
 *
 * Deliberately not a score out of 100. A single number invites you to chase it
 * and tells you nothing about what to do; a short list of specific findings
 * with a severity each is what actually gets acted on.
 */
function buildFindings(d) {
  const f = [];

  if (d.updates.ok && d.updates.security > 0) {
    f.push({ level: "crit", title: `${d.updates.security} security update${d.updates.security === 1 ? "" : "s"} pending`,
             detail: "Run apt upgrade. Security updates are the cheapest defence you have." });
  } else if (d.updates.ok && d.updates.total > 20) {
    f.push({ level: "warn", title: `${d.updates.total} updates pending`,
             detail: "None flagged as security, but the box is drifting behind." });
  }

  if (d.ssh.ok && d.ssh.count > 0) {
    const worst = d.ssh.top[0];
    const level = d.ssh.count >= 100 ? "crit" : d.ssh.count >= 10 ? "warn" : "info";
    f.push({
      level,
      title: `${d.ssh.count} failed SSH login${d.ssh.count === 1 ? "" : "s"}`,
      detail: worst
        ? `Busiest source ${worst.ip} (${worst.n}). ${d.ssh.count >= 100 ? "That pattern is a scanner — if SSH is reachable from the internet, key-only auth and fail2ban are the fix." : "Normal background noise if SSH is exposed."}`
        : "No source addresses could be read from the log."
    });
  }

  if (d.nexus.ok && d.nexus.count > 0) {
    f.push({
      level: d.nexus.count >= 5 ? "crit" : "warn",
      title: `${d.nexus.count} failed Nexus login${d.nexus.count === 1 ? "" : "s"}`,
      detail: "Nexus login is root on this machine. If this was not you, change the password."
    });
  }

  if (d.ports.ok && d.ports.exposed > 0) {
    f.push({
      level: "info",
      title: `${d.ports.exposed} port${d.ports.exposed === 1 ? "" : "s"} open to the network`,
      detail: d.ports.list.filter(p => p.world).map(p => p.proc ? `${p.port} (${p.proc})` : String(p.port)).join(", ")
    });
  }

  // The highest-consequence configuration on the box, so it is stated outright.
  if (d.terminal.enabled && d.terminal.boundAll) {
    f.push({
      level: "warn",
      title: "Web terminal is enabled on all interfaces",
      detail: "Anyone who reaches this port and logs in gets a root shell. Fine on a trusted LAN; not fine if this port is forwarded."
    });
  }

  if (d.sessions.ok && d.sessions.count > 1) {
    f.push({
      level: "info",
      title: `${d.sessions.count} active login sessions`,
      detail: d.sessions.list.map(s => `${s.user}@${s.tty}${s.from ? " from " + s.from : ""}`).join(", ")
    });
  }

  if (!f.length) f.push({ level: "ok", title: "Nothing to report", detail: "No failed logins, no pending security updates." });
  return f;
}

const WORST = { ok: 0, info: 1, warn: 2, crit: 3 };

/* ------------------------------------------------------------------ scan */

export async function scan({ hours = 24, force = false } = {}) {
  hours = Math.max(1, Math.min(168, Number(hours) || 24));

  if (!force && cache.data && cache.hours === hours && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }
  // A second caller while a scan is running gets the previous answer rather
  // than starting a competing set of subprocesses.
  if (scanning && cache.data) return cache.data;

  scanning = true;
  try {
    const [ssh, ports, updates, sessions] = await Promise.all([
      sshFailures(hours).catch(e => unknown(e.message)),
      listeningPorts().catch(e => unknown(e.message)),
      pendingUpdates().catch(e => unknown(e.message)),
      activeSessions().catch(e => unknown(e.message))
    ]);

    const d = {
      at: Date.now(),
      hours,
      platform: process.platform,
      ssh,
      nexus: nexusFailures(hours),
      ports,
      updates,
      sessions,
      terminal: { enabled: terminal.enabled(), boundAll: cfg.host === "0.0.0.0" }
    };

    d.findings = buildFindings(d);
    d.level = d.findings.reduce((w, x) => (WORST[x.level] > WORST[w] ? x.level : w), "ok");

    cache = { at: Date.now(), hours, data: d };
    return d;
  } finally {
    scanning = false;
  }
}

export const lastScanAt = () => cache.at;
