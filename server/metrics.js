import si from "systeminformation";
import cfg from "./config.js";
import * as sensors from "./sensors.js";

/**
 * Collector loop.
 *
 * Live history lives in fixed-size in-memory ring buffers, never on disk.
 * Writing a row per metric per second to a database on an SD card or consumer
 * SSD is a good way to kill a homelab disk, and 15 minutes of 1s samples covers
 * every chart the dashboard actually draws.
 */

const RING = 900;            // 15 minutes at 1s
const TICK_MS = 1000;

class Ring {
  constructor(n = RING) { this.n = n; this.buf = []; }
  push(v) { this.buf.push(v); if (this.buf.length > this.n) this.buf.shift(); }
  last(k = 60) { return this.buf.slice(-k); }
  get latest() { return this.buf.length ? this.buf[this.buf.length - 1] : null; }
}

export const series = {
  cpu: new Ring(),
  mem: new Ring(),
  netRx: new Ring(),
  netTx: new Ring()
};

export const snapshot = {
  host: null,
  cpu: { usage: 0, cores: 0, loadavg: [0, 0, 0], model: "" },
  mem: { total: 0, used: 0, active: 0, usage: 0, swapTotal: 0, swapUsed: 0 },
  disks: [],
  net: { rx: 0, tx: 0, iface: null, interfaces: [] },
  sensors: [],
  smart: [],
  uptimeSec: 0,
  simulated: sensors.isSimulated,
  updatedAt: 0
};

let channels = [];
let prevNet = null;
let started = false;

// Mount points that are noise on a Docker host. Without this filter the storage
// widget is 40 rows of overlay2 and nothing you care about.
const IGNORED_FS = /^(overlay|overlay2|tmpfs|devtmpfs|squashfs|ramfs|aufs|fuse\.|nsfs|cgroup|proc|sysfs)/i;
const IGNORED_MOUNT = /^\/(proc|sys|dev|run)(\/|$)|^\/var\/lib\/docker\//;

async function collectStatic() {
  try {
    const [osInfo, cpuInfo] = await Promise.all([si.osInfo(), si.cpu()]);
    snapshot.host = {
      hostname: osInfo.hostname,
      distro: `${osInfo.distro} ${osInfo.release}`.trim(),
      kernel: osInfo.kernel,
      arch: osInfo.arch,
      platform: osInfo.platform
    };
    snapshot.cpu.model = `${cpuInfo.manufacturer} ${cpuInfo.brand}`.trim();
    snapshot.cpu.cores = cpuInfo.cores;
  } catch (err) {
    console.error("[metrics] static info failed:", err.message);
  }
  try { channels = await sensors.discover(); }
  catch (err) { console.error("[metrics] sensor discovery failed:", err.message); }
}

async function tick() {
  const now = Date.now();

  // CPU + load
  try {
    const load = await si.currentLoad();
    snapshot.cpu.usage = round1(load.currentLoad);
    series.cpu.push(snapshot.cpu.usage);
  } catch {}
  try {
    const t = await si.time();
    snapshot.uptimeSec = t.uptime || 0;
  } catch {}
  if (cfg.isLinux) {
    try {
      const os = await import("node:os");
      snapshot.cpu.loadavg = os.loadavg().map(n => round1(n));
    } catch {}
  }

  // Memory
  try {
    const m = await si.mem();
    snapshot.mem = {
      total: m.total, used: m.active, active: m.active,
      usage: round1((m.active / m.total) * 100),
      swapTotal: m.swaptotal, swapUsed: m.swapused
    };
    series.mem.push(snapshot.mem.usage);
  } catch {}

  // Disks
  try {
    const fsList = await si.fsSize();
    snapshot.disks = fsList
      .filter(d => d.size > 0 && !IGNORED_FS.test(d.type || "") && !IGNORED_MOUNT.test(d.mount || ""))
      .map(d => ({
        mount: d.mount, fs: d.fs, type: d.type,
        size: d.size, used: d.used, available: d.available,
        usage: round1(d.use)
      }))
      // De-duplicate bind mounts that report the same device twice.
      .filter((d, i, arr) => arr.findIndex(x => x.mount === d.mount) === i);
  } catch {}

  // Network throughput from counter deltas
  try {
    const stats = await si.networkStats("*");
    let rx = 0, tx = 0;
    const ifaces = [];
    for (const s of stats) {
      if (s.iface === "lo" || /^(docker|br-|veth)/.test(s.iface)) continue;
      ifaces.push({ iface: s.iface, rxBytes: s.rx_bytes, txBytes: s.tx_bytes });
      rx += s.rx_sec > 0 ? s.rx_sec : 0;
      tx += s.tx_sec > 0 ? s.tx_sec : 0;
    }
    snapshot.net = { rx: Math.round(rx), tx: Math.round(tx), iface: ifaces[0]?.iface ?? null, interfaces: ifaces };
    series.netRx.push(Math.round(rx));
    series.netTx.push(Math.round(tx));
  } catch {}

  // Sensors
  try {
    if (cfg.isLinux && channels.length) {
      snapshot.sensors = await sensors.readChannels(channels);
    } else {
      // Development fallback: derive a believable package temp from CPU load so
      // the UI has a moving number. Clearly flagged as simulated in the payload.
      snapshot.sensors = [{
        id: "dev:cpu", label: "CPU Package (simulated)", kind: "temperature",
        unit: "°C", value: round1(38 + snapshot.cpu.usage * 0.34), critical: 95, max: 90
      }];
    }
  } catch {}

  snapshot.updatedAt = now;
  prevNet = now;
}

// SMART on a much slower cadence — it shells out and must not block the 1s tick.
async function smartLoop() {
  try { snapshot.smart = await sensors.smart(); }
  catch (err) { console.error("[metrics] smart:", err.message); }
}

export async function start() {
  if (started) return;
  started = true;
  await collectStatic();
  await tick();
  await smartLoop();
  setInterval(tick, TICK_MS).unref?.();
  setInterval(smartLoop, Math.max(60, cfg.smart.cacheSeconds) * 1000).unref?.();
}

/** Compact payload for the WebSocket stream. */
export function frame(historyPoints = 60) {
  return {
    t: Date.now(),
    cpu: snapshot.cpu.usage,
    mem: snapshot.mem.usage,
    memUsed: snapshot.mem.used,
    memTotal: snapshot.mem.total,
    bootAt: Date.now() - (snapshot.uptimeSec || 0) * 1000,
    net: { rx: snapshot.net.rx, tx: snapshot.net.tx },
    uptimeSec: snapshot.uptimeSec,
    sensors: snapshot.sensors,
    history: {
      cpu: series.cpu.last(historyPoints),
      mem: series.mem.last(historyPoints),
      rx: series.netRx.last(historyPoints),
      tx: series.netTx.last(historyPoints)
    }
  };
}

export function full() {
  return { ...snapshot, history: { cpu: series.cpu.last(120), mem: series.mem.last(120), rx: series.netRx.last(120), tx: series.netTx.last(120) } };
}

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
