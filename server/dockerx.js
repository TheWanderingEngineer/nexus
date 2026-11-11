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
    // Docker lists a published port once per address family (0.0.0.0 and ::),
    // so the same port arrived twice. One entry per public port and protocol.
    const seen = new Set();
    const ports = (c.Ports || [])
      .filter(p => p.PublicPort && !seen.has(p.PublicPort + "/" + p.Type) && seen.add(p.PublicPort + "/" + p.Type))
      .map(p => ({ public: p.PublicPort, private: p.PrivatePort, type: p.Type }))
      .sort((a, b) => a.public - b.public);
    return {
      id: c.Id.slice(0, 12),
      fullId: c.Id,
      name: (c.Names?.[0] || "").replace(/^\//, ""),
      image: c.Image,
      state: c.State,
      status: c.Status,
      health: healthOf(c.Status),
      created: c.Created,
      ports,
      project: c.Labels?.["com.docker.compose.project"] || null,
      service: c.Labels?.["com.docker.compose.service"] || null,
      networks: Object.keys(c.NetworkSettings?.Networks || {}),
      mounts: (c.Mounts || []).length,
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

/* ------------------------------------------------------------------ more
 * What the Containers page needs beyond start and stop: every container's live
 * numbers in one call, the details behind one, whether its image has a newer
 * version, and updating it in place.
 */

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
export const validId = id => typeof id === "string" && ID_RE.test(id);

/** "Up 2 days (healthy)" → "healthy". Absent when the image has no check. */
export function healthOf(status) {
  const m = /\((healthy|unhealthy|health: starting)\)/.exec(status || "");
  return m ? (m[1] === "health: starting" ? "starting" : m[1]) : null;
}

/* Live CPU and memory for every running container, in one request. A single
   non-streaming stats call takes about a second (Docker waits for a second
   sample to work out CPU), so they run in parallel and the result is shared
   for a few seconds — two open tabs do not double the work. */
let statsCache = { at: 0, data: null, pending: null };
export function allStats() {
  if (statsCache.pending) return statsCache.pending;
  if (statsCache.data && Date.now() - statsCache.at < 4000) return Promise.resolve(statsCache.data);
  statsCache.pending = (async () => {
    const d = need();
    const list = await d.listContainers({ all: false });
    const out = {};
    await Promise.all(list.map(async c => {
      try {
        const s = await d.getContainer(c.Id).stats({ stream: false });
        const nets = Object.values(s.networks || {});
        const io = (s.blkio_stats?.io_service_bytes_recursive || []);
        out[c.Id.slice(0, 12)] = {
          cpu: cpuPercent(s),
          mem: memUsed(s), memLimit: s.memory_stats?.limit ?? 0,
          rx: nets.reduce((a, n) => a + (n.rx_bytes || 0), 0),
          tx: nets.reduce((a, n) => a + (n.tx_bytes || 0), 0),
          read: io.filter(x => /read/i.test(x.op)).reduce((a, x) => a + (x.value || 0), 0),
          write: io.filter(x => /write/i.test(x.op)).reduce((a, x) => a + (x.value || 0), 0),
          pids: s.pids_stats?.current ?? null
        };
      } catch { /* a container that stopped mid-read just has no numbers */ }
    }));
    statsCache = { at: Date.now(), data: out, pending: null };
    return out;
  })().catch(e => { statsCache.pending = null; throw e; });
  return statsCache.pending;
}

/** Memory the way `docker stats` shows it: usage minus page cache. */
function memUsed(s) {
  const m = s.memory_stats || {};
  const cache = m.stats?.inactive_file ?? m.stats?.total_inactive_file ?? m.stats?.cache ?? 0;
  return Math.max(0, (m.usage || 0) - cache);
}

/** Everything the detail panel shows about one container. */
export async function inspectContainer(id) {
  const d = need();
  const i = await d.getContainer(id).inspect();
  const labels = i.Config?.Labels || {};
  const nets = i.NetworkSettings?.Networks || {};
  return {
    id: i.Id.slice(0, 12), name: (i.Name || "").replace(/^\//, ""),
    image: i.Config?.Image, imageId: (i.Image || "").replace(/^sha256:/, "").slice(0, 12),
    created: i.Created, startedAt: i.State?.StartedAt, finishedAt: i.State?.FinishedAt,
    state: i.State?.Status, exitCode: i.State?.ExitCode, restartCount: i.RestartCount ?? 0,
    oomKilled: !!i.State?.OOMKilled,
    health: i.State?.Health ? {
      status: i.State.Health.Status, failing: i.State.Health.FailingStreak,
      log: (i.State.Health.Log || []).slice(-3).map(l => ({ at: l.End, code: l.ExitCode, out: String(l.Output || "").slice(0, 400) }))
    } : null,
    restart: i.HostConfig?.RestartPolicy?.Name || "no",
    networkMode: i.HostConfig?.NetworkMode,
    privileged: !!i.HostConfig?.Privileged,
    cmd: [...(i.Config?.Entrypoint || []), ...(i.Config?.Cmd || [])].join(" ").slice(0, 600),
    workdir: i.Config?.WorkingDir || "",
    hostname: i.Config?.Hostname,
    project: labels["com.docker.compose.project"] || null,
    service: labels["com.docker.compose.service"] || null,
    composeFile: labels["com.docker.compose.project.config_files"] || null,
    env: (i.Config?.Env || []).map(e => { const k = e.indexOf("="); return { k: k < 0 ? e : e.slice(0, k), v: k < 0 ? "" : e.slice(k + 1) }; }),
    mounts: (i.Mounts || []).map(m => ({ type: m.Type, source: m.Name || m.Source, target: m.Destination, rw: m.RW !== false })),
    networks: Object.entries(nets).map(([name, n]) => ({ name, ip: n.IPAddress || "", gateway: n.Gateway || "", mac: n.MacAddress || "" })),
    labels: Object.fromEntries(Object.entries(labels).filter(([k]) => !k.startsWith("com.docker.compose.") && !k.startsWith("org.opencontainers.")).slice(0, 40))
  };
}

/* Is there a newer image? Docker asks the registry itself (with whatever
   login it already has) and returns the digest the tag points at now; the
   image is up to date when that digest is one this box already has. Cached
   for an hour, because registries rate-limit and images do not change by the
   minute. */
const updCache = new Map();
export async function checkUpdate(id, { fresh = false } = {}) {
  const d = need();
  const info = await d.getContainer(id).inspect();
  const ref = info.Config?.Image || "";
  if (!ref || ref.startsWith("sha256:") || ref.includes("@sha256:")) {
    return { id, image: ref, upToDate: null, reason: "pinned to an exact image — nothing newer to look for" };
  }
  const hit = updCache.get(ref + "|" + info.Image);
  if (!fresh && hit && Date.now() - hit.at < 3600e3) return { id, ...hit.result };
  let result;
  try {
    const local = await d.getImage(info.Image).inspect();
    const dist = await d.getImage(ref).distribution();
    const remote = dist?.Descriptor?.digest;
    const have = (local.RepoDigests || []).map(r => r.split("@")[1]);
    result = remote
      ? { image: ref, upToDate: have.includes(remote), remote, checkedAt: Date.now() }
      : { image: ref, upToDate: null, reason: "the registry did not say", checkedAt: Date.now() };
    if (!have.length) result = { image: ref, upToDate: null, reason: "built locally, not pulled from a registry", checkedAt: Date.now() };
  } catch (e) {
    result = { image: ref, upToDate: null, reason: String(e.message || e).replace(/^\(HTTP code \d+\)\s*/, "").slice(0, 160), checkedAt: Date.now() };
  }
  updCache.set(ref + "|" + info.Image, { at: Date.now(), result });
  return { id, ...result };
}

/* ---- updating in place ----
 * Pull the image, then replace the container with an identical one on the
 * new image: same name, same settings, same volumes and networks. The old one
 * is renamed and kept until the new one is running, and put back if anything
 * fails. Runs as a job the page polls, because a pull can take minutes and a
 * reverse proxy will not hold a request that long.
 */
const jobs = new Map();
export const getJob = id => jobs.get(id) || null;

export function startUpdate(id) {
  need();
  const jobId = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const job = { id: jobId, container: id, state: "running", step: "Starting", log: [], at: Date.now(), result: null, error: null };
  jobs.set(jobId, job);
  for (const [k, j] of jobs) if (Date.now() - j.at > 3600e3) jobs.delete(k);
  const say = s => { job.step = s; job.log.push(s); if (job.log.length > 200) job.log.shift(); };
  updateContainer(id, say)
    .then(r => { job.state = "done"; job.result = r; say(r.updated ? "Updated" : r.message); })
    .catch(e => { job.state = "failed"; job.error = String(e.message || e).slice(0, 300); say("Failed: " + job.error); });
  return job;
}

async function pull(d, ref, say) {
  const stream = await d.pull(ref);
  let last = 0;
  await new Promise((resolve, reject) => d.modem.followProgress(stream,
    err => (err ? reject(err) : resolve()),
    ev => {
      if (ev.error) return;
      if (Date.now() - last > 1500 && ev.status) {
        last = Date.now();
        say(`Pulling: ${ev.status}${ev.progress ? " " + ev.progress.replace(/\s+/g, " ").slice(0, 60) : ""}`);
      }
    }));
}

async function updateContainer(id, say) {
  const d = need();
  const old = d.getContainer(id);
  const info = await old.inspect();
  const ref = info.Config?.Image || "";
  if (!ref || ref.startsWith("sha256:") || ref.includes("@sha256:")) throw new Error("this container is pinned to an exact image, so there is nothing to update to");
  const name = (info.Name || "").replace(/^\//, "");
  say(`Pulling ${ref}`);
  await pull(d, ref, say);
  const img = await d.getImage(ref).inspect();
  if (img.Id === info.Image) { updCache.clear(); return { updated: false, message: "Already on the newest image" }; }

  // The new container's settings: the old one's, with what Docker derives on
  // its own left out.
  const nets = info.NetworkSettings?.Networks || {};
  const netNames = Object.keys(nets);
  const endpoint = n => ({
    Aliases: (nets[n].Aliases || []).filter(a => a !== info.Id.slice(0, 12) && a !== info.Config?.Hostname),
    ...(nets[n].IPAMConfig ? { IPAMConfig: nets[n].IPAMConfig } : {}),
    ...(nets[n].Links ? { Links: nets[n].Links } : {})
  });
  const config = { ...info.Config, Image: ref, name, HostConfig: { ...info.HostConfig } };
  if (config.Hostname && info.Id.startsWith(config.Hostname)) delete config.Hostname;
  // An anonymous volume (an image's VOLUME with nothing mounted on it) would
  // come back empty on a new container; mount the old one by name instead.
  const named = new Set([...(info.HostConfig?.Binds || []).map(b => b.split(":")[1]), ...(info.HostConfig?.Mounts || []).map(m => m.Target)]);
  const anon = (info.Mounts || []).filter(m => m.Type === "volume" && /^[0-9a-f]{64}$/.test(m.Name || "") && !named.has(m.Destination));
  if (anon.length) config.HostConfig.Mounts = [...(info.HostConfig?.Mounts || []), ...anon.map(m => ({ Type: "volume", Source: m.Name, Target: m.Destination }))];
  const mode = info.HostConfig?.NetworkMode || "";
  if (netNames.length && !mode.startsWith("container:") && mode !== "host") {
    config.NetworkingConfig = { EndpointsConfig: { [netNames[0]]: endpoint(netNames[0]) } };
  }

  const wasRunning = !!info.State?.Running;
  const aside = `${name}-nexus-old-${Date.now().toString(36)}`;
  if (wasRunning) { say("Stopping the old container"); await old.stop({ t: 20 }).catch(e => { if (e.statusCode !== 304) throw e; }); }
  await old.rename({ name: aside });
  let fresh = null;
  try {
    say("Creating the new container");
    fresh = await d.createContainer(config);
    if (!mode.startsWith("container:") && mode !== "host") {
      for (const n of netNames.slice(1)) await d.getNetwork(n).connect({ Container: fresh.id, EndpointConfig: endpoint(n) });
    }
    if (wasRunning) { say("Starting it"); await fresh.start(); }
  } catch (e) {
    say("Putting the old container back");
    if (fresh) await fresh.remove({ force: true }).catch(() => {});
    await old.rename({ name }).catch(() => {});
    if (wasRunning) await old.start().catch(() => {});
    throw e;
  }
  say("Removing the old container");
  await old.remove({ force: true, v: false }).catch(() => {});
  updCache.clear();
  statsCache.data = null;
  return { updated: true, id: fresh.id.slice(0, 12), message: "Updated to the newest image" };
}
