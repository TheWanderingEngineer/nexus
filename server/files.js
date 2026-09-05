import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import cfg from "./config.js";

/**
 * File manager with a hard path jail.
 *
 * Every path from the client is resolved (following symlinks) and then checked
 * to be inside a configured root. A request that escapes is rejected outright —
 * never sanitised and retried, because "clean it up and continue" is how
 * traversal bugs survive.
 */

function roots() {
  return cfg.fileRoots.map(r => ({ name: r.name, path: path.resolve(r.path) }));
}

export function listRoots() {
  return roots().map(r => ({ name: r.name, path: r.path, exists: fsSync.existsSync(r.path) }));
}

export class PathError extends Error {
  constructor(msg) { super(msg); this.status = 403; }
}

/**
 * Resolve a client path to a real absolute path inside a root.
 * `mustExist: false` is used for create/move targets whose final component
 * does not exist yet — the parent directory is still jailed.
 */
export async function resolveSafe(input, { mustExist = true } = {}) {
  if (typeof input !== "string" || !input.length) throw new PathError("path required");
  if (input.includes("\0")) throw new PathError("invalid path");

  const abs = path.resolve(input);
  const rs = roots();

  const target = mustExist ? abs : path.dirname(abs);
  let real;
  try {
    real = await fs.realpath(target);
  } catch (err) {
    if (err.code === "ENOENT") throw new PathError("path does not exist");
    throw new PathError("path not accessible");
  }

  const inside = rs.some(r => real === r.path || real.startsWith(r.path + path.sep));
  if (!inside) throw new PathError("path is outside the configured roots");

  return mustExist ? real : path.join(real, path.basename(abs));
}

export async function list(dir) {
  const safe = await resolveSafe(dir);
  const st = await fs.stat(safe);
  if (!st.isDirectory()) throw new PathError("not a directory");

  const names = await fs.readdir(safe);
  const out = [];
  for (const name of names) {
    const full = path.join(safe, name);
    try {
      const s = await fs.lstat(full);
      out.push({
        name,
        path: full,
        dir: s.isDirectory(),
        symlink: s.isSymbolicLink(),
        size: s.isDirectory() ? null : s.size,
        mtime: s.mtimeMs,
        mode: s.mode & 0o777
      });
    } catch {
      // Unreadable entries (permissions, broken symlinks) are listed as-is
      // rather than failing the whole directory.
      out.push({ name, path: full, dir: false, error: true, size: null, mtime: 0 });
    }
  }
  out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));

  const parent = path.dirname(safe);
  const hasParent = roots().some(r => parent === r.path || parent.startsWith(r.path + path.sep));
  return { path: safe, parent: hasParent ? parent : null, entries: out };
}

export async function mkdir(target) {
  const safe = await resolveSafe(target, { mustExist: false });
  await fs.mkdir(safe, { recursive: false });
  return { path: safe };
}

export async function rename(from, to) {
  const a = await resolveSafe(from);
  const b = await resolveSafe(to, { mustExist: false });
  await fs.rename(a, b);
  return { path: b };
}

export async function remove(target) {
  const safe = await resolveSafe(target);
  if (roots().some(r => r.path === safe)) throw new PathError("refusing to delete a configured root");
  const st = await fs.lstat(safe);
  if (st.isDirectory()) await fs.rm(safe, { recursive: true, force: false });
  else await fs.unlink(safe);
  return { ok: true };
}

export async function statFile(target) {
  const safe = await resolveSafe(target);
  const s = await fs.stat(safe);
  return { path: safe, size: s.size, dir: s.isDirectory(), mtime: s.mtimeMs };
}
