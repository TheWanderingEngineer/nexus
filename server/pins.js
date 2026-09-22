import fs from "node:fs";
import path from "node:path";
import cfg from "./config.js";

/**
 * The PINs on the Apps page, in their own root-only file.
 *
 * Kept out of `state.json` because that file is read and rewritten constantly
 * and ends up in backups; this one is 0600 and holds nothing else.
 *
 * They are stored so they can be read back, rather than hashed, because the
 * owner asked to be able to recover a forgotten one — Kernel reads it out with
 * `recall_app_pin`, which needs approval and lands in the audit log. That is a
 * deliberate trade and it costs nothing against the threat a four-digit PIN
 * actually defends against: someone looking at the dashboard over your
 * shoulder. Anyone who can read a 0600 file in the data directory is already
 * root, and already has the addresses, the state file and the machine.
 */
const FILE = path.join(cfg.dataDir, "launcher-pins.json");

export function all() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}

export function save(pins) {
  fs.writeFileSync(FILE, JSON.stringify(pins, null, 1), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch {}
}

export const get = id => all()[id] || null;

export function set(id, pin) { const p = all(); p[id] = pin; save(p); }

export function clear(id) { const p = all(); delete p[id]; save(p); }

/** Drop PINs whose tile no longer exists. */
export function prune(liveIds) {
  const p = all();
  let changed = false;
  for (const id of Object.keys(p)) if (!liveIds.has(id)) { delete p[id]; changed = true; }
  if (changed) save(p);
  return changed;
}
