import fs from "node:fs";
import path from "node:path";
import cfg from "./config.js";

/**
 * A tiny JSON-file store with atomic writes.
 *
 * Deliberately not SQLite: Nexus is single-admin with a handful of small records
 * (one user, a session list, a widget layout, an audit ring). Adding a database
 * would mean a native module, which would mean a compiler on the target box.
 * `npm ci` staying compiler-free is worth more here than query power we do not use.
 */

const FILE = path.join(cfg.dataDir, "state.json");

const EMPTY = {
  users: [],
  sessions: [],
  dashboards: [{ id: 1, name: "Home", isDefault: true }],
  widgets: null,          // null = "never customised", fall back to the default layout
  settings: {},
  audit: []
};

let state = load();

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
      return { ...structuredClone(EMPTY), ...parsed };
    }
  } catch (err) {
    // A corrupt state file must not stop the server from booting — you would lose
    // the ability to log in and fix it. Move it aside and start clean.
    const bak = FILE + ".corrupt-" + Date.now();
    try { fs.renameSync(FILE, bak); } catch {}
    console.error(`[store] state.json was unreadable (${err.message}); moved to ${bak}`);
  }
  return structuredClone(EMPTY);
}

let writeTimer = null;
function flush() {
  // The debounced write can fire after the data dir has been removed (test
  // teardown, or someone clearing /var/lib/nexus while it runs). Recreate it
  // rather than throwing on a background timer nobody is awaiting.
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);   // atomic on POSIX
}

/** Batches rapid writes (layout drags fire a lot) into one disk hit. */
export function save() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = null; try { flush(); } catch (e) { console.error("[store]", e.message); } }, 250);
}

export function saveNow() {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  try { flush(); } catch (e) { console.error("[store]", e.message); }
}

export function db() { return state; }

/* ---------- audit ---------- */
const AUDIT_MAX = 2000;

export function audit(action, detail, req) {
  const entry = {
    ts: new Date().toISOString(),
    action,
    detail: detail ?? null,
    user: req?.user?.username ?? null,
    ip: req ? clientIp(req) : null
  };
  state.audit.unshift(entry);
  if (state.audit.length > AUDIT_MAX) state.audit.length = AUDIT_MAX;
  save();
  return entry;
}

export function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  const remote = req.socket?.remoteAddress || "";
  // Only believe X-Forwarded-For when the immediate peer is a configured proxy.
  if (xff && cfg.trustedProxies.some(p => remote.includes(p))) {
    return String(xff).split(",")[0].trim();
  }
  return remote;
}

process.on("exit", saveNow);
process.on("SIGINT", () => { saveNow(); process.exit(0); });
process.on("SIGTERM", () => { saveNow(); process.exit(0); });
