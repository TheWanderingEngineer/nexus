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
const PROC_MS = 5000;        // process table: far too heavy for the 1s tick

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
  netTx: new Ring(),
  diskR: new Ring(),
  diskW: new Ring()
};

export const snapshot = {
  host: null,
  cpu: { usage: 0, cores: 0, loadavg: [0, 0, 0], model: "" },
  // Per-core load. A box at "50% CPU" is a very different machine depending on
  // whether that is every core at half or one core pinned and the rest asleep,
  // and the aggregate number cannot tell you which.
  cores: [],
  mem: { total: 0, used: 0, active: 0, usage: 0, swapTotal: 0, swapUsed: 0 },
  disks: [],
  // Bytes per second across all filesystems. Null where the platform cannot
  // report it — fsStats reads /proc/diskstats, so this is Linux-only.
  diskIO: null,
  net: { rx: 0, tx: 0, iface: null, interfaces: [] },
  sensors: [],
  smart: [],
  procs: { at: 0, total: 0, running: 0, byCpu: [], byMem: [] },
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
    snapshot.cores = (load.cpus || []).map(c => round1(c.load));
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

  // Disk throughput. fsStats returns null on platforms that cannot report it
  // (Windows), so an absent reading stays absent rather than becoming a zero
  // that would draw a flat line and look like an idle disk.
  try {
    const io = await si.fsStats();
    if (io && (io.rx_sec != null || io.wx_sec != null)) {
      const r = io.rx_sec > 0 ? io.rx_sec : 0;
      const w = io.wx_sec > 0 ? io.wx_sec : 0;
      snapshot.diskIO = { read: Math.round(r), write: Math.round(w) };
      series.diskR.push(snapshot.diskIO.read);
      series.diskW.push(snapshot.diskIO.write);
    }
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

/**
 * Process table, on its own slower loop.
 *
 * si.processes() walks every entry in /proc, which is far too much to do once a
 * second, and on Windows it goes through WMI and takes over a second by itself.
 * The `busy` guard matters more than the interval: without it a slow host queues
 * one scan behind another until they overlap permanently.
 *
 * Two orderings are kept rather than one. Sorting a top-by-CPU list by memory
 * gives you the most memory-hungry of the busiest processes, which is not the
 * same thing as the most memory-hungry process and is quietly wrong.
 */
const PROC_KEEP = 12;
let procBusy = false;

async function procLoop() {
  if (procBusy) return;
  procBusy = true;
  try {
    const p = await si.processes();
    const list = (p.list || [])
      .filter(x => x && x.name)
      // Windows' idle process is reported at ~90% and is not a real consumer.
      .filter(x => x.name !== "System Idle Process")
      .map(x => ({
        pid: x.pid,
        name: String(x.name).slice(0, 40),
        cpu: round1(x.cpu),
        mem: round1(x.mem),
        user: x.user ? String(x.user).slice(0, 24) : null
      }));

    snapshot.procs = {
      at: Date.now(),
      total: p.all ?? list.length,
      running: p.running ?? 0,
      byCpu: list.slice().sort((a, b) => b.cpu - a.cpu).slice(0, PROC_KEEP),
      byMem: list.slice().sort((a, b) => b.mem - a.mem).slice(0, PROC_KEEP)
    };
  } catch (err) {
    console.error("[metrics] processes:", err.message);
  } finally {
    procBusy = false;
  }
}

export async function start() {
  if (started) return;
  started = true;
  await collectStatic();
  await tick();
  await smartLoop();
  procLoop();                                   // not awaited: slow on Windows
  setInterval(tick, TICK_MS).unref?.();
  setInterval(procLoop, PROC_MS).unref?.();
  setInterval(smartLoop, Math.max(60, cfg.smart.cacheSeconds) * 1000).unref?.();
}

/** Compact payload for the WebSocket stream. */
export function frame(historyPoints = 60) {
  return {
    t: Date.now(),
    cpu: snapshot.cpu.usage,
    cores: snapshot.cores,
    mem: snapshot.mem.usage,
    memUsed: snapshot.mem.used,
    memTotal: snapshot.mem.total,
    swapUsed: snapshot.mem.swapUsed,
    swapTotal: snapshot.mem.swapTotal,
    loadavg: snapshot.cpu.loadavg,
    bootAt: Date.now() - (snapshot.uptimeSec || 0) * 1000,
    net: { rx: snapshot.net.rx, tx: snapshot.net.tx },
    disk: snapshot.diskIO,
    procs: snapshot.procs,
    uptimeSec: snapshot.uptimeSec,
    sensors: snapshot.sensors,
    history: {
      cpu: series.cpu.last(historyPoints),
      mem: series.mem.last(historyPoints),
      rx: series.netRx.last(historyPoints),
      tx: series.netTx.last(historyPoints),
      dr: series.diskR.last(historyPoints),
      dw: series.diskW.last(historyPoints)
    }
  };
}

export function full() {
  return {
    ...snapshot,
    history: {
      cpu: series.cpu.last(120), mem: series.mem.last(120),
      rx: series.netRx.last(120), tx: series.netTx.last(120),
      dr: series.diskR.last(120), dw: series.diskW.last(120)
    }
  };
}

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
