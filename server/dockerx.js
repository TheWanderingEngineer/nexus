import fs from "node:fs";
import cfg from "./config.js";

/**
 * Docker access. Everything degrades gracefully when the socket is absent —
 * on a dev box without Docker the dashboard should still boot and show
 * "Docker unavailable" rather than crash on startup.
 */

let docker = null;
let available = false;
let reason = "not initialised";

export async function init() {
  if (!cfg.docker.enabled) { reason = "disabled in config"; return; }
  try {
    if (cfg.isLinux && !fs.existsSync(cfg.docker.socket)) {
      reason = `socket not found at ${cfg.docker.socket}`;
      return;
    }
    const { default: Docker } = await import("dockerode");
    docker = cfg.isLinux ? new Docker({ socketPath: cfg.docker.socket }) : new Docker();
    await docker.ping();
    available = true;
    reason = "ok";
  } catch (err) {
    available = false;
    reason = err.code === "EACCES"
      ? `permission denied on ${cfg.docker.socket} — is nexus running as root or in the docker group?`
      : String(err.message || err).slice(0, 200);
  }
}

export function status() { return { available, reason, socket: cfg.docker.socket }; }

function need() {
  if (!available) { const e = new Error(`docker unavailable: ${reason}`); e.status = 503; throw e; }
  return docker;
}

/** CasaOS labels its containers io.casaos.* — we read them so existing apps
 *  show up as proper tiles with their icons from first launch. */
function readLabels(labels = {}) {
  const casa = {};
  for (const [k, v] of Object.entries(labels)) {
    if (k.startsWith("io.casaos.")) casa[k.slice("io.casaos.".length)] = v;
  }
  const hasCasa = Object.keys(casa).length > 0;
  return {
    managedBy: hasCasa ? "casaos" : (labels["io.nexus.managed"] ? "nexus" : "manual"),
    icon: casa.icon || labels["io.nexus.icon"] || null,
    title: casa.title || casa["app.title"] || labels["io.nexus.title"] || null,
    webui: casa["web-ui.port"] || labels["io.nexus.port"] || null
  };
}

export async function listContainers() {
  const d = need();
  const list = await d.listContainers({ all: true });
  return list.map(c => {
    const meta = readLabels(c.Labels);
    return {
      id: c.Id.slice(0, 12),
      fullId: c.Id,
      name: (c.Names?.[0] || "").replace(/^\//, ""),
      image: c.Image,
      state: c.State,
      status: c.Status,
      created: c.Created,
      ports: (c.Ports || [])
        .filter(p => p.PublicPort)
        .map(p => ({ public: p.PublicPort, private: p.PrivatePort, type: p.Type })),
      ...meta
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const ACTIONS = { start: "start", stop: "stop", restart: "restart" };

export async function containerAction(id, action) {
  const d = need();
  const method = ACTIONS[action];
  if (!method) { const e = new Error("unknown action"); e.status = 400; throw e; }
  const c = d.getContainer(id);
  await c[method]();
  return { ok: true };
}

export async function removeContainer(id) {
  const d = need();
  await d.getContainer(id).remove({ force: true });
  return { ok: true };
}

export async function containerStats(id) {
  const d = need();
  const s = await d.getContainer(id).stats({ stream: false });
  return { cpu: cpuPercent(s), memory: s.memory_stats?.usage ?? 0, memoryLimit: s.memory_stats?.limit ?? 0 };
}

function cpuPercent(s) {
  try {
    const delta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
    const sysDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
    const cores = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
    if (sysDelta > 0 && delta > 0) return Math.round((delta / sysDelta) * cores * 1000) / 10;
  } catch {}
  return 0;
}

/** Streams container logs into a callback. Returns a stop function. */
export async function followLogs(id, onLine) {
  const d = need();
  const stream = await d.getContainer(id).logs({ follow: true, stdout: true, stderr: true, tail: 200, timestamps: false });
  stream.on("data", chunk => {
    // Docker multiplexes streams with an 8-byte header per frame when the
    // container has no TTY. Strip it or the UI shows control bytes.
    let buf = chunk;
    while (buf.length > 8) {
      const len = buf.readUInt32BE(4);
      const payload = buf.slice(8, 8 + len);
      onLine(payload.toString("utf8"));
      buf = buf.slice(8 + len);
      if (len === 0) break;
    }
    if (buf.length && buf.length <= 8) onLine(buf.toString("utf8"));
  });
  return () => { try { stream.destroy(); } catch {} };
}
