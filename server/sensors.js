import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import cfg from "./config.js";

const run = promisify(execFile);

/**
 * Temperature, fan and SMART discovery.
 *
 * No two machines expose the same sensors and the kernel's own labels are often
 * useless (temp1, acpitz). So we walk the tree once, build a stable id per
 * channel, and let the UI rename/hide/threshold them. Widgets then reference the
 * id rather than a /sys path that can renumber across reboots.
 */

const HWMON = "/sys/class/hwmon";
const THERMAL = "/sys/class/thermal";

async function readTrim(p) {
  try { return (await fs.readFile(p, "utf8")).trim(); } catch { return null; }
}

async function listDir(p) {
  try { return await fs.readdir(p); } catch { return []; }
}

/** One-time discovery. Returns channel descriptors, not values. */
export async function discover() {
  if (!cfg.isLinux) return devFallback();

  const channels = [];

  for (const dir of await listDir(HWMON)) {
    const base = path.join(HWMON, dir);
    const chipName = (await readTrim(path.join(base, "name"))) || dir;

    for (const f of await listDir(base)) {
      const m = /^(temp|fan|in)(\d+)_input$/.exec(f);
      if (!m) continue;
      const [, kind, idx] = m;
      const label = await readTrim(path.join(base, `${kind}${idx}_label`));
      const critRaw = await readTrim(path.join(base, `${kind}${idx}_crit`));
      const maxRaw = await readTrim(path.join(base, `${kind}${idx}_max`));

      channels.push({
        id: `hwmon:${chipName}:${kind}${idx}`,
        source: path.join(base, f),
        kind: kind === "temp" ? "temperature" : kind === "fan" ? "fan" : "voltage",
        chip: chipName,
        label: label || `${chipName} ${kind}${idx}`,
        unit: kind === "temp" ? "°C" : kind === "fan" ? "rpm" : "V",
        divisor: kind === "temp" ? 1000 : kind === "in" ? 1000 : 1,
        critical: critRaw ? Number(critRaw) / 1000 : null,
        max: maxRaw ? Number(maxRaw) / 1000 : null
      });
    }
  }

  // ARM boards (Raspberry Pi and friends) expose CPU temp here instead.
  for (const dir of await listDir(THERMAL)) {
    if (!/^thermal_zone\d+$/.test(dir)) continue;
    const base = path.join(THERMAL, dir);
    const type = (await readTrim(path.join(base, "type"))) || dir;
    if (await readTrim(path.join(base, "temp")) === null) continue;
    channels.push({
      id: `thermal:${dir}`,
      source: path.join(base, "temp"),
      kind: "temperature",
      chip: "thermal",
      label: type,
      unit: "°C",
      divisor: 1000,
      critical: null,
      max: null
    });
  }

  return channels;
}

export async function readChannels(channels) {
  const out = [];
  for (const c of channels) {
    const raw = await readTrim(c.source);
    if (raw === null) continue;
    const v = Number(raw) / c.divisor;
    if (!Number.isFinite(v)) continue;
    out.push({ id: c.id, label: c.label, kind: c.kind, unit: c.unit, value: Math.round(v * 10) / 10, critical: c.critical, max: c.max });
  }
  return out;
}

/* ---------------- SMART ---------------- */

let smartCache = { at: 0, data: [] };

/** Block devices that plausibly support SMART. */
async function blockDevices() {
  if (!cfg.isLinux) return [];
  const names = await listDir("/sys/block");
  return names
    .filter(n => /^(sd[a-z]+|nvme\d+n\d+|hd[a-z]+)$/.test(n))
    .map(n => `/dev/${n}`);
}

/**
 * `--nocheck=standby` matters: without it, polling SMART spins an idle drive back
 * up. That defeats spindown and quietly costs power and drive life.
 *
 * Device names come from the kernel's own enumeration, never from the client —
 * this is the argument that would otherwise be a command-injection hole.
 */
export async function smart(force = false) {
  if (!cfg.smart.enabled || !cfg.isLinux) return [];
  const ttl = cfg.smart.cacheSeconds * 1000;
  if (!force && Date.now() - smartCache.at < ttl) return smartCache.data;

  const allowed = new Set(await blockDevices());
  const devices = (cfg.smart.devices.length ? cfg.smart.devices : [...allowed]).filter(d => allowed.has(d));

  const results = [];
  for (const dev of devices) {
    try {
      const { stdout } = await run("smartctl", ["--json", "--nocheck=standby", "-A", "-H", "-i", dev], {
        timeout: 10_000, maxBuffer: 4 * 1024 * 1024
      });
      const j = JSON.parse(stdout);
      results.push({
        device: dev,
        model: j.model_name ?? null,
        serialTail: j.serial_number ? String(j.serial_number).slice(-4) : null,
        capacityBytes: j.user_capacity?.bytes ?? null,
        passed: j.smart_status?.passed ?? null,
        temperature: j.temperature?.current ?? null,
        powerOnHours: j.power_on_time?.hours ?? null,
        standby: /STANDBY|SLEEP/i.test(j.smartctl?.messages?.[0]?.string || "")
      });
    } catch (err) {
      // smartctl exits non-zero for "device is in standby" and for missing binary.
      // Neither is worth failing the whole endpoint over.
      results.push({ device: dev, error: shortErr(err) });
    }
  }
  smartCache = { at: Date.now(), data: results };
  return results;
}

function shortErr(err) {
  if (err.code === "ENOENT") return "smartctl not installed";
  return String(err.stderr || err.message || err).split("\n")[0].slice(0, 160);
}

/** Non-Linux dev fallback so the UI has something to render while developing. */
function devFallback() {
  return [
    { id: "dev:cpu", source: null, kind: "temperature", chip: "dev", label: "CPU Package (simulated)", unit: "°C", divisor: 1, critical: 95, max: 90 }
  ];
}

export const isSimulated = !cfg.isLinux;
