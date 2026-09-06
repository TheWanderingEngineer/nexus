import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Config precedence: env vars > config file > defaults.
 * The file lives at /etc/nexus/config.json in a real install; in development it
 * falls back to ./config.json next to the repo.
 */

const DEFAULTS = {
  // Network
  host: "0.0.0.0",
  port: 8080,
  // Absolute origins allowed to open a WebSocket. Empty array = same-origin only,
  // which is what you want unless the UI is served from a different hostname.
  allowedOrigins: [],
  trustedProxies: [],

  // Feature switches. The terminal is a root shell over the network; it stays
  // easy to turn off without a redeploy.
  terminal: { enabled: true, shell: null },
  docker: { enabled: true, socket: "/var/run/docker.sock" },

  // Roots the file manager may touch. Everything outside these is rejected.
  fileRoots: [
    { name: "DATA", path: "/DATA" },
    { name: "home", path: os.homedir() }
  ],

  // Sensors
  smart: { enabled: true, cacheSeconds: 900, devices: [] },

  // Where mutable state lives
  dataDir: "/var/lib/nexus",

  // Session lifetime
  sessionHours: 168
};

function readFileIfPresent(p) {
  let raw;
  try {
    if (!fs.existsSync(p)) return null;
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    // Reporting "not valid JSON" for a permission error sends you looking for a
    // syntax mistake that is not there. Say what actually happened.
    if (err.code === "EACCES" || err.code === "EPERM") {
      console.error(`[config] cannot read ${p}: permission denied — using defaults.`);
      console.error("[config] the config is root-owned (mode 600) because it can hold secrets;");
      console.error("[config] running a dev script as a normal user cannot read it. That is expected.");
    } else {
      console.error(`[config] cannot read ${p}: ${err.message} — using defaults.`);
    }
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[config] ${p} is not valid JSON — ignoring it: ${err.message}`);
    return null;
  }
}

function deepMerge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] ? deepMerge(base[k], v) : v;
  }
  return out;
}

const candidates = [
  process.env.NEXUS_CONFIG,
  "/etc/nexus/config.json",
  path.join(process.cwd(), "config.json")
].filter(Boolean);

let fileCfg = null;
let loadedFrom = null;
for (const c of candidates) {
  const parsed = readFileIfPresent(c);
  if (parsed) { fileCfg = parsed; loadedFrom = c; break; }
}

const cfg = deepMerge(DEFAULTS, fileCfg || {});

// Env overrides — handy for containers and systemd drop-ins.
if (process.env.NEXUS_PORT) cfg.port = Number(process.env.NEXUS_PORT);
if (process.env.NEXUS_HOST) cfg.host = process.env.NEXUS_HOST;
if (process.env.NEXUS_DATA_DIR) cfg.dataDir = process.env.NEXUS_DATA_DIR;
if (process.env.NEXUS_TERMINAL === "off") cfg.terminal.enabled = false;
if (process.env.NEXUS_ALLOWED_ORIGINS) {
  cfg.allowedOrigins = process.env.NEXUS_ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean);
}

// On a non-Linux dev box /var/lib/nexus and /DATA do not exist. Fall back so the
// server still runs locally for development.
if (process.platform !== "linux") {
  if (cfg.dataDir === DEFAULTS.dataDir) cfg.dataDir = path.join(process.cwd(), ".nexus-data");
  cfg.fileRoots = cfg.fileRoots.filter(r => { try { return fs.existsSync(r.path); } catch { return false; } });
  if (!cfg.fileRoots.length) cfg.fileRoots = [{ name: "home", path: os.homedir() }];
}

cfg.isLinux = process.platform === "linux";
cfg.loadedFrom = loadedFrom;

fs.mkdirSync(cfg.dataDir, { recursive: true });

export default cfg;
