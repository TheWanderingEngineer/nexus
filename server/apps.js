import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { EventEmitter } from "node:events";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";
import cfg from "./config.js";
import { db, save } from "./store.js";
import * as library from "./library.js";

const run = promisify(execFile);

export const bus = new EventEmitter();          // 'job' events -> /ws/events

const APPS_DIR = () => path.join(cfg.dataDir, "apps");
const jobs = new Map();
let nextJob = 1;

/* ------------------------------------------------------------ compose CLI */

let composeCmd = null;      // ["docker","compose"] | ["docker-compose"] | null

export async function detectCompose() {
  // Short timeout on purpose. On a box with no Docker these calls do not fail
  // fast, and a generous timeout here blocks the whole server from listening —
  // which is exactly what it did the first time round.
  for (const candidate of [["docker", ["compose", "version"]], ["docker-compose", ["version"]]]) {
    try {
      await run(candidate[0], candidate[1], { timeout: 3_000 });
      composeCmd = candidate[0] === "docker" ? ["docker", "compose"] : ["docker-compose"];
      return composeCmd;
    } catch {}
  }
  composeCmd = null;
  return null;
}

export function composeStatus() {
  return { available: !!composeCmd, command: composeCmd ? composeCmd.join(" ") : null };
}

function needCompose() {
  if (!composeCmd) {
    throw Object.assign(new Error("docker compose is not available on this host"), { status: 503 });
  }
  return composeCmd;
}

/* ------------------------------------------------------------------ jobs */

function newJob(title) {
  const id = String(nextJob++);
  const job = { id, title, status: "running", lines: [], startedAt: Date.now() };
  jobs.set(id, job);
  bus.emit("job", { ...job });
  return job;
}
function jobLog(job, line) {
  const text = String(line).replace(/\r/g, "").trimEnd();
  if (!text) return;
  job.lines.push(text);
  if (job.lines.length > 400) job.lines.shift();
  bus.emit("job", { id: job.id, title: job.title, status: job.status, line: text });
}
function jobDone(job, status, message) {
  job.status = status;
  if (message) jobLog(job, message);
  job.finishedAt = Date.now();
  bus.emit("job", { id: job.id, title: job.title, status, line: message || null, done: true });
}
export function getJob(id) { return jobs.get(String(id)) || null; }

/* --------------------------------------------------------- port conflicts */

function portsFromCompose(doc) {
  const out = [];
  for (const svc of Object.values(doc?.services || {})) {
    for (const p of svc?.ports || []) {
      // Accept "8096:8096", "0.0.0.0:8096:8096/tcp", or {published, target}
      if (typeof p === "number") { out.push(p); continue; }
      if (typeof p === "object" && p.published) { out.push(Number(p.published)); continue; }
      const m = /(?:(?:\d+\.){3}\d+:)?(\d+):\d+/.exec(String(p));
      if (m) out.push(Number(m[1]));
    }
  }
  return [...new Set(out.filter(n => Number.isFinite(n) && n > 0))];
}

function portFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "0.0.0.0");
  });
}

/**
 * Checking ports before handing the job to Docker is worth the extra second:
 * a port clash is by far the most common install failure, and Docker's own
 * error for it is buried at the end of a wall of pull output.
 */
export async function checkPorts(doc) {
  const wanted = portsFromCompose(doc);
  const conflicts = [];
  for (const p of wanted) if (!(await portFree(p))) conflicts.push(p);
  return { wanted, conflicts };
}

/* ---------------------------------------------------------- substitution */

function applyParams(text, params) {
  let out = text;
  for (const [k, v] of Object.entries(params || {})) {
    const safe = String(v);
    out = out.replaceAll("${" + k + "}", safe).replaceAll("$" + k, safe);
  }
  return out;
}

/* ------------------------------------------------------------- installed */

export function listInstalled() {
  return (db().installed || []).map(a => ({ ...a, composeText: undefined }));
}

function recordInstall(entry) {
  const d = db();
  d.installed = d.installed || [];
  d.installed = d.installed.filter(a => a.id !== entry.id);
  d.installed.push(entry);
  save();
}

/* --------------------------------------------------------------- install */

async function composeUp(job, dir, project) {
  const [bin, ...pre] = needCompose();
  const args = [...pre, "-f", path.join(dir, "docker-compose.yml"), "-p", project, "up", "-d", "--remove-orphans"];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: dir, env: { ...process.env } });
    child.stdout.on("data", d => String(d).split("\n").forEach(l => jobLog(job, l)));
    child.stderr.on("data", d => String(d).split("\n").forEach(l => jobLog(job, l)));
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`compose exited with code ${code}`)));
  });
}

/**
 * Install an app from a synced library.
 * Returns immediately with a job id; progress streams over /ws/events.
 */
export async function installFromCatalog({ libraryId, slug, params = {}, force = false }) {
  const app = library.getApp(libraryId, slug);
  if (!app) throw Object.assign(new Error("app not found in catalogue"), { status: 404 });
  needCompose();

  const raw = await library.readCompose(app);
  const rendered = applyParams(raw, params);

  let doc;
  try { doc = YAML.parse(rendered); }
  catch (e) { throw Object.assign(new Error("app compose file is not valid YAML: " + e.message), { status: 422 }); }

  // Strip CasaOS's own metadata blocks — docker compose warns about unknown
  // top-level keys and they carry no runtime meaning for us.
  delete doc["x-casaos"];
  for (const svc of Object.values(doc.services || {})) delete svc["x-casaos"];

  const { wanted, conflicts } = await checkPorts(doc);
  if (conflicts.length && !force) {
    throw Object.assign(
      new Error(`port ${conflicts.join(", ")} already in use on this host`),
      { status: 409, conflicts, wanted }
    );
  }

  const project = ("nexus-" + slug).replace(/[^a-z0-9-]/g, "").slice(0, 40);
  const dir = path.join(APPS_DIR(), slug);
  await fsp.mkdir(dir, { recursive: true });

  // Tag everything we install so it is distinguishable from hand-run containers
  // and from CasaOS's, both in `docker ps` and in our own container list.
  for (const svc of Object.values(doc.services || {})) {
    svc.labels = { ...(svc.labels || {}), "io.nexus.managed": "true", "io.nexus.app": slug };
  }

  await fsp.writeFile(path.join(dir, "docker-compose.yml"), YAML.stringify(doc), "utf8");

  const job = newJob(`Installing ${app.name}`);
  (async () => {
    try {
      jobLog(job, `project ${project}`);
      if (wanted.length) jobLog(job, `ports ${wanted.join(", ")}`);
      await composeUp(job, dir, project);
      recordInstall({
        id: slug, slug, name: app.name, icon: app.icon || null,
        project, dir, libraryId, source: "library",
        ports: wanted, installedAt: Date.now(), managedBy: "nexus"
      });
      jobDone(job, "success", `${app.name} is running.`);
    } catch (err) {
      jobDone(job, "error", err.message);
    }
  })();

  return { jobId: job.id, project, ports: wanted };
}

/* ------------------------------------------------- install straight from git */

const GH_REPO = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

/**
 * Install directly from a GitHub repository or a raw compose URL.
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/blob/main/docker-compose.yml
 *   https://raw.githubusercontent.com/owner/repo/main/docker-compose.yml
 */
export async function installFromUrl({ url, name, params = {}, force = false }) {
  needCompose();
  const clean = String(url || "").trim();

  let composeText = null;
  let derivedName = name;

  const rawUrl = toRawUrl(clean);
  if (rawUrl) {
    const res = await fetch(rawUrl, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw Object.assign(new Error(`could not fetch compose file (HTTP ${res.status})`), { status: 400 });
    composeText = await res.text();
    derivedName = derivedName || rawUrl.split("/").slice(-3, -2)[0] || "app";
  } else {
    const m = GH_REPO.exec(clean);
    if (!m) throw Object.assign(new Error("not a recognised GitHub repository or compose URL"), { status: 400 });
    const [, owner, repo] = m;
    derivedName = derivedName || repo;

    // Try the common locations for a compose file on the default branch,
    // rather than cloning a whole repository for one file.
    const branches = ["main", "master"];
    const files = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
    outer:
    for (const b of branches) for (const f of files) {
      const u = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/${f}`;
      try {
        const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
        if (res.ok) { composeText = await res.text(); break outer; }
      } catch {}
    }
    if (!composeText) {
      throw Object.assign(new Error(`no docker-compose.yml found at the root of ${owner}/${repo}`), { status: 404 });
    }
  }

  return installFromComposeText({ name: derivedName, composeText, params, force, source: clean });
}

function toRawUrl(u) {
  if (/^https?:\/\/raw\.githubusercontent\.com\//i.test(u)) return u;
  const blob = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/(.+)$/i.exec(u);
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
  if (/\.(ya?ml)$/i.test(u) && /^https?:\/\//i.test(u)) return u;
  return null;
}

export async function installFromComposeText({ name, composeText, params = {}, force = false, source = "manual" }) {
  needCompose();
  const rendered = applyParams(composeText, params);

  let doc;
  try { doc = YAML.parse(rendered); }
  catch (e) { throw Object.assign(new Error("that is not valid YAML: " + e.message), { status: 422 }); }
  if (!doc || typeof doc !== "object" || !doc.services || !Object.keys(doc.services).length) {
    throw Object.assign(new Error("compose file has no services"), { status: 422 });
  }

  delete doc["x-casaos"];
  for (const svc of Object.values(doc.services)) delete svc["x-casaos"];

  const slug = String(name || "app").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";
  const { wanted, conflicts } = await checkPorts(doc);
  if (conflicts.length && !force) {
    throw Object.assign(new Error(`port ${conflicts.join(", ")} already in use on this host`), { status: 409, conflicts, wanted });
  }

  const project = ("nexus-" + slug).replace(/[^a-z0-9-]/g, "").slice(0, 40);
  const dir = path.join(APPS_DIR(), slug);
  await fsp.mkdir(dir, { recursive: true });

  for (const svc of Object.values(doc.services)) {
    svc.labels = { ...(svc.labels || {}), "io.nexus.managed": "true", "io.nexus.app": slug };
  }
  await fsp.writeFile(path.join(dir, "docker-compose.yml"), YAML.stringify(doc), "utf8");

  const job = newJob(`Installing ${slug}`);
  (async () => {
    try {
      if (wanted.length) jobLog(job, `ports ${wanted.join(", ")}`);
      await composeUp(job, dir, project);
      recordInstall({
        id: slug, slug, name: slug, icon: null, project, dir,
        libraryId: null, source, ports: wanted, installedAt: Date.now(), managedBy: "nexus"
      });
      jobDone(job, "success", `${slug} is running.`);
    } catch (err) {
      jobDone(job, "error", err.message);
    }
  })();

  return { jobId: job.id, project, ports: wanted, slug };
}

/* ------------------------------------------------------------- uninstall */

export async function uninstall(id, { removeVolumes = false } = {}) {
  const entry = (db().installed || []).find(a => a.id === id);
  if (!entry) throw Object.assign(new Error("app is not installed"), { status: 404 });
  const [bin, ...pre] = needCompose();

  const job = newJob(`Removing ${entry.name}`);
  (async () => {
    try {
      const args = [...pre, "-f", path.join(entry.dir, "docker-compose.yml"), "-p", entry.project, "down"];
      if (removeVolumes) args.push("-v");
      await new Promise((resolve, reject) => {
        const child = spawn(bin, args, { cwd: entry.dir });
        child.stdout.on("data", d => String(d).split("\n").forEach(l => jobLog(job, l)));
        child.stderr.on("data", d => String(d).split("\n").forEach(l => jobLog(job, l)));
        child.on("error", reject);
        child.on("exit", c => c === 0 ? resolve() : reject(new Error(`compose down exited ${c}`)));
      });
      const d = db();
      d.installed = (d.installed || []).filter(a => a.id !== id);
      save();
      // The compose file stays on disk so a mis-click is recoverable; volumes
      // are only touched when explicitly asked for.
      jobDone(job, "success", `${entry.name} removed.${removeVolumes ? " Volumes deleted." : " Volumes kept."}`);
    } catch (err) {
      jobDone(job, "error", err.message);
    }
  })();

  return { jobId: job.id };
}

export async function init() {
  await fsp.mkdir(APPS_DIR(), { recursive: true }).catch(() => {});

  // Deliberately not awaited: probing for the compose binary is slow on a host
  // without Docker, and nothing about accepting HTTP connections depends on the
  // answer. composeCmd is filled in a moment later; every caller checks it.
  detectCompose().catch(() => {});

  const d = db();
  d.libraries = d.libraries || [];
  d.catalog = d.catalog || [];
  d.installed = d.installed || [];
  // Seed the CasaOS store on first boot so the store is not empty on arrival.
  if (!d.libraries.length) {
    for (const b of library.BUILTIN_LIBRARIES) {
      d.libraries.push({
        id: b.url.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).toLowerCase(),
        name: b.name, url: b.url, format: b.format, enabled: true,
        lastSyncAt: null, lastSyncError: null
      });
    }
    save();
  }
}
