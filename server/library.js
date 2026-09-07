import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";
import cfg from "./config.js";
import { db, save } from "./store.js";

const run = promisify(execFile);

/**
 * App libraries.
 *
 * A library is just a git repository of app definitions. Two layouts are
 * understood:
 *
 *   nexus   library.yaml at the root, apps/<slug>/manifest.yaml + docker-compose.yml
 *   casaos  Apps/<Name>/docker-compose.yml carrying an `x-casaos:` metadata block
 *
 * The CasaOS adapter is what makes the store useful on day one — it means the
 * whole existing CasaOS app ecosystem installs here without anyone hand-writing
 * hundreds of manifests.
 *
 * Cloning uses the system `git` rather than an archive download so that syncing
 * is an incremental `git pull` instead of re-fetching everything.
 */

const LIB_DIR = () => path.join(cfg.dataDir, "libraries");

/** Added automatically on first boot so the store is not empty on arrival. */
export const BUILTIN_LIBRARIES = [
  {
    name: "CasaOS App Store",
    url: "https://github.com/IceWhaleTech/CasaOS-AppStore.git",
    format: "casaos",
    description: "The official CasaOS catalogue — several hundred self-hosted apps."
  }
];

/**
 * Offered in the UI as one-click additions rather than seeded, because each one
 * is a full clone and you should choose what you pull down.
 *
 * These are CasaOS-format stores, so they go through the same adapter as the
 * official one. If a repository has moved or changed layout the sync reports it
 * rather than failing silently — nothing here is assumed to be correct forever.
 */
export const SUGGESTED_LIBRARIES = [
  {
    name: "Big Bear CasaOS",
    url: "https://github.com/bigbeartechworld/big-bear-casaos.git",
    format: "casaos",
    description: "The largest community CasaOS store — a lot of apps the official one does not carry."
  },
  {
    name: "CasaOS App Store (official)",
    url: "https://github.com/IceWhaleTech/CasaOS-AppStore.git",
    format: "casaos",
    description: "The official IceWhale catalogue. Added by default on first boot."
  },
  {
    name: "Coolify templates",
    url: "https://github.com/coollabsio/coolify.git",
    format: "auto",
    description: "Compose templates from Coolify. Layout differs — sync will report if the adapter cannot read it."
  }
];

function slugifyUrl(url) {
  return String(url).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).toLowerCase();
}

async function gitAvailable() {
  try { await run("git", ["--version"], { timeout: 5000 }); return true; }
  catch { return false; }
}

/* ------------------------------------------------------------------ CRUD */

export function listLibraries() {
  return (db().libraries || []).map(l => ({
    id: l.id, name: l.name, url: l.url, format: l.format,
    enabled: l.enabled !== false,
    lastSyncAt: l.lastSyncAt || null,
    lastSyncError: l.lastSyncError || null,
    appCount: (db().catalog || []).filter(a => a.libraryId === l.id).length
  }));
}

export async function addLibrary({ url, name, format }) {
  if (!/^https?:\/\/[^\s]+$/i.test(String(url || ""))) {
    throw Object.assign(new Error("library url must be http(s)"), { status: 400 });
  }
  const d = db();
  d.libraries = d.libraries || [];
  if (d.libraries.some(l => l.url === url)) {
    throw Object.assign(new Error("that library is already added"), { status: 409 });
  }
  const lib = {
    id: slugifyUrl(url),
    name: name || url.split("/").slice(-1)[0].replace(/\.git$/, ""),
    url, format: format || "auto",
    enabled: true, lastSyncAt: null, lastSyncError: null
  };
  d.libraries.push(lib);
  save();
  return lib;
}

export function removeLibrary(id) {
  const d = db();
  d.libraries = (d.libraries || []).filter(l => l.id !== id);
  d.catalog = (d.catalog || []).filter(a => a.libraryId !== id);
  save();
  try { fs.rmSync(path.join(LIB_DIR(), id), { recursive: true, force: true }); } catch {}
  return { ok: true };
}

/* ------------------------------------------------------------------ sync */

export async function syncLibrary(id, onProgress = () => {}) {
  const lib = (db().libraries || []).find(l => l.id === id);
  if (!lib) throw Object.assign(new Error("no such library"), { status: 404 });

  if (!await gitAvailable()) {
    throw Object.assign(new Error("git is not installed on this host"), { status: 503 });
  }

  const dest = path.join(LIB_DIR(), lib.id);
  await fsp.mkdir(LIB_DIR(), { recursive: true });

  try {
    if (fs.existsSync(path.join(dest, ".git"))) {
      onProgress(`updating ${lib.name}…`);
      await run("git", ["-C", dest, "fetch", "--quiet", "--depth", "1", "origin"], { timeout: 300_000, maxBuffer: 64e6 });
      // Reset rather than pull: app libraries are read-only mirrors and a merge
      // conflict here would wedge every future sync.
      const { stdout } = await run("git", ["-C", dest, "rev-parse", "--abbrev-ref", "origin/HEAD"], { timeout: 15_000 }).catch(() => ({ stdout: "origin/main" }));
      const branch = stdout.trim() || "origin/main";
      await run("git", ["-C", dest, "reset", "--quiet", "--hard", branch], { timeout: 120_000, maxBuffer: 64e6 });
    } else {
      onProgress(`cloning ${lib.name}… (this can take a minute)`);
      await fsp.rm(dest, { recursive: true, force: true });
      await run("git", ["clone", "--quiet", "--no-progress", "--depth", "1", "--single-branch", lib.url, dest], { timeout: 900_000, maxBuffer: 64e6 });
    }
  } catch (err) {
    lib.lastSyncError = shortErr(err);
    save();
    throw Object.assign(new Error(`sync failed: ${lib.lastSyncError}`), { status: 502 });
  }

  onProgress("indexing apps…");
  const format = lib.format === "auto" ? await detectFormat(dest) : lib.format;
  lib.format = format;

  const apps = format === "casaos" ? await scanCasaOS(dest, lib.id) : await scanNexus(dest, lib.id);

  const d = db();
  d.catalog = (d.catalog || []).filter(a => a.libraryId !== lib.id).concat(apps);
  lib.lastSyncAt = Date.now();
  lib.lastSyncError = null;
  save();

  return { library: lib.id, format, apps: apps.length };
}

async function detectFormat(dir) {
  if (fs.existsSync(path.join(dir, "library.yaml")) || fs.existsSync(path.join(dir, "apps"))) return "nexus";
  if (fs.existsSync(path.join(dir, "Apps"))) return "casaos";
  return "casaos";
}

function shortErr(err) {
  const s = String(err.stderr || err.message || err);
  return s.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 200) || "unknown error";
}

/* ------------------------------------------------------- format adapters */

const pickLang = v => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") return v.en_us || v.en_US || v.en || Object.values(v)[0] || null;
  return null;
};

/** CasaOS: Apps/<Name>/docker-compose.yml with a top-level `x-casaos` block. */
async function scanCasaOS(dir, libraryId) {
  const appsDir = path.join(dir, "Apps");
  let names = [];
  try { names = await fsp.readdir(appsDir); } catch { return []; }

  const out = [];
  for (const name of names) {
    const composePath = path.join(appsDir, name, "docker-compose.yml");
    if (!fs.existsSync(composePath)) continue;
    try {
      const raw = await fsp.readFile(composePath, "utf8");
      const doc = YAML.parse(raw);
      if (!doc || typeof doc !== "object") continue;
      const meta = doc["x-casaos"] || {};

      const services = doc.services || {};
      const mainKey = meta.main || Object.keys(services)[0];
      const main = services[mainKey] || {};

      out.push({
        libraryId,
        slug: String(name).toLowerCase(),
        name: pickLang(meta.title) || name,
        tagline: pickLang(meta.tagline) || "",
        description: pickLang(meta.description) || "",
        icon: meta.icon || null,
        thumbnail: meta.thumbnail || null,
        category: meta.category || "Uncategorised",
        developer: meta.developer || meta.author || null,
        architectures: meta.architectures || [],
        portMap: meta.port_map || null,
        image: main.image || null,
        composePath,
        format: "casaos"
      });
    } catch {
      // A single malformed app must not break the whole index.
    }
  }
  return out;
}

/** Nexus: apps/<slug>/manifest.yaml alongside docker-compose.yml */
async function scanNexus(dir, libraryId) {
  const appsDir = path.join(dir, "apps");
  let names = [];
  try { names = await fsp.readdir(appsDir); } catch { return []; }

  const out = [];
  for (const slug of names) {
    const manifestPath = path.join(appsDir, slug, "manifest.yaml");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const m = YAML.parse(await fsp.readFile(manifestPath, "utf8")) || {};
      const composePath = path.join(appsDir, slug, m.compose || "docker-compose.yml");
      if (!fs.existsSync(composePath)) continue;
      out.push({
        libraryId,
        slug: String(m.slug || slug).toLowerCase(),
        name: m.name || slug,
        tagline: m.tagline || "",
        description: m.description || "",
        icon: m.icon && /^https?:/.test(m.icon) ? m.icon : null,
        category: m.category || "Uncategorised",
        developer: m.author || null,
        architectures: m.architectures || [],
        params: m.params || [],
        health: m.health || null,
        webui: m.webui || null,
        composePath,
        format: "nexus"
      });
    } catch {}
  }
  return out;
}

/* ------------------------------------------------------------------ query */

export function searchCatalog({ q = "", category = "", library = "", limit = 60, offset = 0 } = {}) {
  const all = db().catalog || [];
  const needle = String(q).trim().toLowerCase();

  let rows = all;
  if (library) rows = rows.filter(a => a.libraryId === library);
  if (category) rows = rows.filter(a => (a.category || "").toLowerCase() === category.toLowerCase());
  if (needle) {
    rows = rows.filter(a =>
      a.slug.includes(needle) ||
      (a.name || "").toLowerCase().includes(needle) ||
      (a.tagline || "").toLowerCase().includes(needle));
  }
  rows = rows.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return {
    total: rows.length,
    categories: [...new Set(all.map(a => a.category).filter(Boolean))].sort(),
    apps: rows.slice(offset, offset + limit)
  };
}

export function getApp(libraryId, slug) {
  return (db().catalog || []).find(a => a.libraryId === libraryId && a.slug === slug) || null;
}

/**
 * Every placeholder a compose file expects somebody else to fill in.
 *
 * CasaOS substitutes these before compose ever sees the file, so its templates
 * are full of `$PUID`, `$TZ` and `$AppID` with nothing behind them. Listing them
 * lets the install dialog show what an app is actually asking for, instead of
 * rendering blanks and leaving you to find the warnings afterwards.
 */
export function detectVars(text) {
  const found = new Set();
  // ${NAME}, ${NAME:-default}, or bare $NAME.
  const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-[^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const name = m[1] || m[2];
    // Compose's own runtime variables are not ours to prompt for.
    if (/^(COMPOSE_|DOCKER_)/.test(name)) continue;
    found.add(name);
  }
  return [...found].slice(0, 20);
}

export async function readCompose(app) {
  return fsp.readFile(app.composePath, "utf8");
}
