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

  // `withFileTypes` gives directory/symlink flags straight from the directory
  // read, so the per-entry stat is only needed for size and mtime.
  const dirents = await fs.readdir(safe, { withFileTypes: true });
  const truncated = dirents.length > MAX_ENTRIES;
  const slice = truncated ? dirents.slice(0, MAX_ENTRIES) : dirents;

  // Statting sequentially made a folder of a few thousand files take minutes —
  // each stat is a round trip, and on Windows every one of them goes past the
  // virus scanner. Run them in bounded parallel instead: fast everywhere,
  // without opening thousands of handles at once.
  const out = await mapLimit(slice, 64, async d => {
    const full = path.join(safe, d.name);
    const base = {
      name: d.name,
      path: full,
      dir: d.isDirectory(),
      symlink: d.isSymbolicLink(),
      // Lets the UI offer "open in editor" only where that will actually work.
      text: !d.isDirectory() && isTextFile(d.name)
    };
    try {
      const s = await fs.lstat(full);
      return { ...base, size: d.isDirectory() ? null : s.size, mtime: s.mtimeMs, mode: s.mode & 0o777 };
    } catch {
      // Unreadable entries (permissions, broken symlinks) are still listed
      // rather than failing the whole directory.
      return { ...base, size: null, mtime: 0, error: true };
    }
  });

  out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));

  const parent = path.dirname(safe);
  const hasParent = roots().some(r => parent === r.path || parent.startsWith(r.path + path.sep));
  return {
    path: safe,
    parent: hasParent ? parent : null,
    entries: out,
    truncated,
    total: dirents.length
  };
}

const MAX_ENTRIES = 4000;

/** Promise.all with a ceiling on how many run at once. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
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

/* ---------------------------------------------------------- text editing */

/** Editable in the browser. Anything else is offered as a download instead. */
const TEXT_EXT = new Set([
  "txt", "md", "markdown", "log", "json", "yaml", "yml", "toml", "ini", "conf", "cfg",
  "env", "sh", "bash", "zsh", "js", "mjs", "cjs", "ts", "css", "html", "htm", "xml",
  "csv", "tsv", "sql", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "hpp",
  "service", "gitignore", "dockerfile", "properties", "lock"
]);

const MAX_EDIT_BYTES = 2 * 1024 * 1024;   // 2 MB — past this a browser textarea is useless anyway

export function isTextFile(name) {
  const base = String(name).toLowerCase();
  if (base === "dockerfile" || base === "makefile" || base.startsWith(".env")) return true;
  const ext = base.includes(".") ? base.split(".").pop() : "";
  return TEXT_EXT.has(ext);
}

export async function readText(target) {
  const safe = await resolveSafe(target);
  const st = await fs.stat(safe);
  if (st.isDirectory()) throw Object.assign(new Error("that is a directory"), { status: 400 });
  if (st.size > MAX_EDIT_BYTES) {
    throw Object.assign(new Error(`file is ${(st.size / 1048576).toFixed(1)} MB — too large to edit in the browser`), { status: 413 });
  }

  const buf = await fs.readFile(safe);
  // Sniff for binary rather than trusting the extension: a NUL byte in the
  // first chunk means opening it in a textarea would corrupt it on save.
  const probe = buf.subarray(0, 8000);
  if (probe.includes(0)) {
    throw Object.assign(new Error("this looks like a binary file, not text"), { status: 415 });
  }

  return { path: safe, content: buf.toString("utf8"), size: st.size, mtime: st.mtimeMs };
}

export async function writeText(target, content, expectedMtime) {
  const safe = await resolveSafe(target);
  const st = await fs.stat(safe).catch(() => null);
  if (st?.isDirectory()) throw Object.assign(new Error("that is a directory"), { status: 400 });

  // Refuse to clobber a file that changed underneath the editor.
  if (st && expectedMtime && Math.abs(st.mtimeMs - Number(expectedMtime)) > 1) {
    throw Object.assign(
      new Error("the file changed on disk since you opened it — reopen it before saving"),
      { status: 409 }
    );
  }
  if (typeof content !== "string") throw Object.assign(new Error("content must be text"), { status: 400 });
  if (Buffer.byteLength(content, "utf8") > MAX_EDIT_BYTES) {
    throw Object.assign(new Error("that is larger than the 2 MB edit limit"), { status: 413 });
  }

  // Write to a sibling temp file then rename, so a failure mid-write cannot
  // leave a half-written config behind.
  const tmp = safe + ".nexus-tmp";
  await fs.writeFile(tmp, content, "utf8");
  if (st) await fs.chmod(tmp, st.mode & 0o777).catch(() => {});
  await fs.rename(tmp, safe);

  const after = await fs.stat(safe);
  return { path: safe, size: after.size, mtime: after.mtimeMs };
}
