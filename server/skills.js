import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import cfg from "./config.js";
import { db, save } from "./store.js";

/**
 * The agent's skill library.
 *
 * A skill is a Markdown file with a little front matter. Two kinds, and the
 * difference is what it costs:
 *
 * - `mode: always` is pasted into the system prompt on every single turn. It is
 *   memory — who Kernel is, what this machine is, what Nexus is. You pay for it
 *   on every message, so it stays short.
 * - `mode: ondemand` is advertised by name and one-line description only. The
 *   body is fetched by the `load_skill` tool when the model decides it needs it.
 *   A 6 kB guide to the *arr stack costs nothing on a question about disk space.
 *
 * Files are the source of truth for name, description and body, so a skill can
 * be dragged out of this folder into another install and still be itself.
 * Whether one is switched *off* lives in the store instead, because that is a
 * preference about this install rather than a property of the document — and it
 * stores what is OFF, not what is on, so a skill dropped into the folder appears
 * rather than being silently ignored (the same rule the widget pickers follow).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(HERE, "..", "assets", "agent-skills");
export const SKILLS_DIR = path.join(cfg.dataDir, "agent-skills");

export const MAX_SKILL_BYTES = 64 * 1024;
/** Everything `always` costs tokens on every turn, so the total is capped and
 *  the UI shows how close you are. Past this, extra always-on skills are not
 *  silently dropped — `budget()` reports it and the settings page says so. */
export const ALWAYS_BUDGET = 24000;

/* ---------------- front matter ---------------- */

function parse(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const meta = {};
  let body = raw;
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
  }
  return { meta, body: body.trim() };
}

function serialise({ name, description, mode, tags, body }) {
  const t = (tags || []).join(", ");
  return `---\nname: ${name}\ndescription: ${description}\nmode: ${mode}\n` +
         (t ? `tags: ${t}\n` : "") + `---\n\n${body.trim()}\n`;
}

/** Tags are a comma-separated line in the front matter, so a skill file stays
 *  something a person can write in any editor. Normalised hard on the way in:
 *  lowercase, no commas, deduped — "Docker", "docker " and "docker" are one tag
 *  or the filter chips are useless. */
export function normTags(v) {
  const raw = Array.isArray(v) ? v : String(v || "").split(",");
  const out = [];
  for (const t of raw) {
    const tag = String(t).trim().toLowerCase().replace(/[,\n]/g, " ").replace(/\s+/g, " ").slice(0, 24);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 12);
}

/**
 * A filename that cannot leave the skills folder.
 *
 * This takes a name straight from a dropped file, so it is jailed by
 * construction rather than by checking afterwards: strip everything that is not
 * a safe character, and anything that survives is a single flat component with
 * no separators and no leading dot for it to climb out with.
 */
export function slug(name) {
  const base = String(name || "").replace(/\.md$/i, "").toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.\-]+/, "")
    .replace(/[.\-]+$/, "")
    .slice(0, 60);
  return base || "skill";
}

/* ---------------- the folder ---------------- */

/**
 * Stock skills that have been renamed, and the hash of the version they were
 * shipped as.
 *
 * A rename would otherwise leave both copies on an existing install: the old
 * file is still there, so `seed()` leaves it alone, and the new one arrives
 * beside it. Deleting the old one outright would throw away an edit the owner
 * made. So the old file is removed only when it is byte-for-byte the version
 * we shipped — untouched stock, safe to replace. An edited one is theirs and
 * stays, even at the cost of a duplicate they can delete themselves.
 */
const RETIRED = [
  // The agent was called Hermes before it was called Kernel.
  { file: "hermes-identity.md", sha256: "67dcc62da801d445e7c0ba6aadde1264848779d3a53955f75d36c821597aa288" }
];

function retire() {
  for (const r of RETIRED) {
    const p = path.join(SKILLS_DIR, r.file);
    if (!fs.existsSync(p)) continue;
    try {
      const have = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      if (have === r.sha256) fs.unlinkSync(p);
    } catch { /* leave it; a file we cannot read is a file we do not delete */ }
  }
}

/** Copy any seed skill that is not already present. Called on first boot, and
 *  again by RESTORE DEFAULTS — which is a restore, not a reset: a skill you
 *  edited keeps your version, a skill you deleted comes back. */
export function seed() {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  retire();
  let added = 0;
  let seeds = [];
  try { seeds = fs.readdirSync(SEED_DIR).filter(f => f.endsWith(".md")); } catch { return 0; }
  for (const f of seeds) {
    const dest = path.join(SKILLS_DIR, f);
    if (fs.existsSync(dest)) continue;
    fs.copyFileSync(path.join(SEED_DIR, f), dest);
    added++;
  }
  return added;
}

export function seedNames() {
  try { return fs.readdirSync(SEED_DIR).filter(f => f.endsWith(".md")).map(f => f.slice(0, -3)); }
  catch { return []; }
}

function offList() {
  const v = db().settings?.agent?.skillsOff;
  return new Set(Array.isArray(v) ? v : []);
}

function setOffList(ids) {
  const s = db().settings = db().settings || {};
  s.agent = s.agent || {};
  s.agent.skillsOff = [...new Set(ids)].slice(0, 200);
  save();
}

const fileFor = id => path.join(SKILLS_DIR, slug(id) + ".md");

export function list() {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  const off = offList();
  const seeds = new Set(seedNames());
  let files = [];
  try { files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith(".md")); } catch {}

  return files.map(f => {
    const id = f.slice(0, -3);
    let raw = "";
    try { raw = fs.readFileSync(path.join(SKILLS_DIR, f), "utf8"); } catch {}
    const { meta, body } = parse(raw);
    return {
      id,
      name: meta.name || id.replace(/[-_]/g, " "),
      description: meta.description || "",
      mode: meta.mode === "always" ? "always" : "ondemand",
      tags: normTags(meta.tags),
      enabled: !off.has(id),
      seeded: seeds.has(id),
      bytes: Buffer.byteLength(body, "utf8")
    };
  }).sort((a, b) =>
    (a.mode === b.mode ? 0 : a.mode === "always" ? -1 : 1) || a.name.localeCompare(b.name));
}

export function read(id) {
  const f = fileFor(id);
  if (!fs.existsSync(f)) throw Object.assign(new Error("no such skill"), { status: 404 });
  const { meta, body } = parse(fs.readFileSync(f, "utf8"));
  return {
    id: slug(id),
    name: meta.name || id,
    description: meta.description || "",
    mode: meta.mode === "always" ? "always" : "ondemand",
    tags: normTags(meta.tags),
    body
  };
}

/** Every tag in use, with how many skills carry it — the filter bar needs both. */
export function tagCloud() {
  const counts = new Map();
  for (const sk of list()) for (const t of sk.tags) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].map(([tag, n]) => ({ tag, n }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
}

/** Write a skill. Used by the upload drop zone and by the editor; both land
 *  here so validation cannot drift between them. */
export function write({ id, name, content, description, mode, tags }) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  if (typeof content !== "string") throw Object.assign(new Error("content must be text"), { status: 400 });
  if (Buffer.byteLength(content, "utf8") > MAX_SKILL_BYTES) {
    throw Object.assign(new Error(`a skill must be under ${MAX_SKILL_BYTES / 1024} kB`), { status: 413 });
  }

  // Front matter inside the dropped file wins over anything guessed from the
  // filename — a .md written elsewhere should arrive as its author meant it.
  const parsed = parse(content);
  const finalId = slug(id || parsed.meta.name || name);
  const finalName = parsed.meta.name || name || finalId.replace(/[-_]/g, " ");
  const finalDesc = (description ?? parsed.meta.description ?? "").slice(0, 300);
  const finalMode = (mode || parsed.meta.mode) === "always" ? "always" : "ondemand";
  const finalTags = normTags(tags !== undefined ? tags : parsed.meta.tags);

  fs.writeFileSync(fileFor(finalId),
    serialise({ name: finalName.slice(0, 120), description: finalDesc, mode: finalMode,
                tags: finalTags, body: parsed.body }),
    { mode: 0o600 });

  // A rewritten skill is one you just chose to have, so it comes back on.
  const off = offList(); off.delete(finalId); setOffList([...off]);
  return finalId;
}

export function remove(id) {
  const f = fileFor(id);
  if (!fs.existsSync(f)) throw Object.assign(new Error("no such skill"), { status: 404 });
  fs.unlinkSync(f);
  const off = offList(); off.delete(slug(id)); setOffList([...off]);
}

export function setEnabled(id, enabled) {
  const off = offList();
  if (enabled) off.delete(slug(id)); else off.add(slug(id));
  setOffList([...off]);
}

export function setMode(id, mode) {
  const cur = read(id);
  write({ id: cur.id, name: cur.name, description: cur.description, content: cur.body, mode, tags: cur.tags });
}

export function setTags(id, tags) {
  const cur = read(id);
  write({ id: cur.id, name: cur.name, description: cur.description, content: cur.body, mode: cur.mode, tags });
}

/* ---------------- what the agent sees ---------------- */

/** The always-on skills, concatenated, clipped to the budget. */
export function memory() {
  const rows = list().filter(s => s.enabled && s.mode === "always");
  let used = 0;
  const parts = [];
  for (const r of rows) {
    let body;
    try { body = read(r.id).body; } catch { continue; }
    if (used + body.length > ALWAYS_BUDGET) {
      parts.push(`## ${r.name}\n(omitted — the always-on skills are over their token budget; ` +
                 `switch one to on-demand in Settings → Nexus Expert → Skills)`);
      continue;
    }
    used += body.length;
    parts.push(`## ${r.name}\n${body}`);
  }
  return parts.join("\n\n");
}

/** The on-demand menu: enough for the model to know what exists and to ask. */
export function menu() {
  return list().filter(s => s.enabled && s.mode === "ondemand")
    .map(s => ({ id: s.id, name: s.name, description: s.description, tags: s.tags }));
}

export function budget() {
  const rows = list().filter(s => s.enabled && s.mode === "always");
  const used = rows.reduce((n, r) => n + r.bytes, 0);
  return { used, limit: ALWAYS_BUDGET, over: used > ALWAYS_BUDGET, count: rows.length };
}
