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
  const job = {
    id, title, status: "running", lines: [], startedAt: Date.now(),
    progress: 0, phase: "preparing", layers: new Map()
  };
  jobs.set(id, job);
  bus.emit("job", { id, title, status: job.status, progress: 0, phase: job.phase });
  return job;
}
function jobLog(job, line) {
  const text = String(line).replace(/\r/g, "").trimEnd();
  if (!text) return;
  job.lines.push(text);
  if (job.lines.length > 400) job.lines.shift();
  bus.emit("job", { id: job.id, title: job.title, status: job.status, line: text });
}

/**
 * Progress is only emitted when the whole number or the phase actually changes.
 * Docker emits a progress line per layer several times a second; forwarding all
 * of them would push hundreds of frames a second down the events socket to
 * redraw a ring that moved by a tenth of a percent.
 */
function jobProgress(job, pct, phase) {
  const next = Math.max(0, Math.min(100, Math.round(pct)));
  if (next === job.progress && phase === job.phase) return;
  job.progress = next;
  job.phase = phase;
  bus.emit("job", { id: job.id, title: job.title, status: job.status, progress: next, phase });
}

function jobDone(job, status, message) {
  job.status = status;
  if (message) jobLog(job, message);
  job.finishedAt = Date.now();
  job.progress = status === "success" ? 100 : job.progress;
  job.phase = status === "success" ? "done" : "failed";
  bus.emit("job", {
    id: job.id, title: job.title, status, line: message || null, done: true,
    progress: job.progress, phase: job.phase
  });
}
export function getJob(id) {
  const j = jobs.get(String(id));
  if (!j) return null;
  const { layers, ...rest } = j;      // the layer map is bookkeeping, not payload
  return rest;
}

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
  // Longest key first. Replacing "$APP" before "$APPDATA" would leave a stray
  // "DATA" glued to the end of the substituted value.
  const keys = Object.keys(params || {}).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const safe = String(params[k]);
    out = out.replaceAll("${" + k + "}", safe).replaceAll("$" + k, safe);
  }
  return out;
}

/**
 * The variables every CasaOS template assumes somebody has already set.
 *
 * CasaOS substitutes these itself before handing the file to compose, so its
 * store is full of `$PUID`, `$AppID` and `$TZ` with nothing to fill them. Left
 * empty, compose warns "variable is not set, defaulting to a blank string" for
 * each one and the container comes up with a blank user id and no timezone.
 */
export function defaultVars(slug) {
  let tz = "Etc/UTC";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch {}
  return {
    PUID: "1000",
    PGID: "1000",
    UID: "1000",
    GID: "1000",
    TZ: tz,
    AppID: slug,
    APPID: slug,
    DATA: "/DATA"
  };
}

/**
 * Drop device bindings the host does not actually have.
 *
 * CasaOS templates are written to cover Raspberry Pi as well as x86, so a media
 * app asks for `/dev/vcsm`, `/dev/vchiq` and `/dev/video10` — Pi-only video
 * nodes. Docker refuses to create a container with a device that does not exist
 * ("error gathering device information ... no such file or directory"), so on a
 * normal mini PC the install dies before it starts.
 *
 * Dropping the missing ones is what makes these templates portable. It is done
 * loudly — every skipped device is written to the job log — because the one case
 * that matters is `/dev/dri` missing, where the app will run but transcode on
 * the CPU, and you want to know that rather than wonder why it is slow.
 */
function pruneDevices(doc) {
  const skipped = [];
  for (const [name, svc] of Object.entries(doc?.services || {})) {
    if (!Array.isArray(svc.devices) || !svc.devices.length) continue;
    svc.devices = svc.devices.filter(entry => {
      const host = typeof entry === "string"
        ? entry.split(":")[0]
        : (entry && typeof entry === "object" ? entry.source : null);
      // Anything that is not an absolute /dev path is left alone — it is not
      // ours to judge, and compose will complain about it more clearly than we would.
      if (!host || !String(host).startsWith("/dev")) return true;
      if (fs.existsSync(host)) return true;
      skipped.push({ service: name, device: String(host) });
      return false;
    });
    if (!svc.devices.length) delete svc.devices;
  }
  return skipped;
}

/**
 * Applies both fixups and reports what it changed, so every install path gets
 * the same treatment rather than each one growing its own copy.
 */
function hostFixups(doc, job) {
  const skipped = pruneDevices(doc);
  for (const s of skipped) {
    jobLog(job, `skipped device ${s.device} (${s.service}) — not present on this host`);
  }
  if (skipped.some(s => s.device.startsWith("/dev/dri"))) {
    jobLog(job, "note: /dev/dri is missing, so hardware transcoding will not be available.");
  }
  return skipped;
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

/* ------------------------------------------------------ progress parsing */

/**
 * Real progress, read out of what Docker is already telling us.
 *
 * Without a TTY, `docker compose up` prints one line per image layer per state
 * change, prefixed with the layer id:
 *
 *     8a1e25ce7c4f Pulling fs layer
 *     8a1e25ce7c4f Downloading [====>       ]  4.5MB/52.34MB
 *     8a1e25ce7c4f Extracting  [=========>  ]  24.1MB/52.34MB
 *     8a1e25ce7c4f Pull complete
 *
 * Averaging each layer's own fraction gives a number that means something, as
 * opposed to a bar that fills on a timer. The pull is the long part, so it owns
 * most of the range and container creation gets the tail.
 */
const PULL_SHARE = 0.88;

const LAYER_RE = /^\s*([0-9a-f]{8,64})\s+(Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)\b(?:.*?([\d.]+\s*[kKMGT]?i?B)\s*\/\s*([\d.]+\s*[kKMGT]?i?B))?/;
const STEP_RE = /^\s*(?:Container|Network|Volume|Image)\s+\S+\s+(Creating|Created|Starting|Started|Running|Pulling|Pulled|Recreating|Recreated)\b/i;

function parseSize(s) {
  const m = /^([\d.]+)\s*([kKMGT]?)i?B$/.exec(String(s).trim());
  if (!m) return null;
  const mult = { "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2]] ?? 1;
  return parseFloat(m[1]) * mult;
}

/** How far along one layer is, 0..1. */
function layerFraction(state, done, total) {
  switch (state) {
    case "Already exists":
    case "Pull complete": return 1;
    case "Extracting": {
      const f = done && total ? done / total : 0;
      return 0.9 + Math.min(1, f) * 0.1;          // extraction is the last tenth
    }
    case "Verifying Checksum":
    case "Download complete": return 0.9;
    case "Downloading": {
      const f = done && total ? done / total : 0;
      return Math.min(0.9, f * 0.9);
    }
    default: return 0;                             // Pulling fs layer, Waiting
  }
}

/**
 * One line of compose output -> what it tells us, or null if it tells us nothing.
 * Pure and exported so it can be tested without a Docker daemon.
 */
export function parseComposeLine(line) {
  const m = LAYER_RE.exec(String(line));
  if (m) {
    const [, layer, state, doneRaw, totalRaw] = m;
    return {
      kind: "layer", layer, state,
      fraction: layerFraction(state, parseSize(doneRaw), parseSize(totalRaw))
    };
  }
  const s = STEP_RE.exec(String(line));
  if (s) return { kind: "step", step: s[1].toLowerCase() };
  return null;
}

function feedProgress(job, line) {
  const parsed = parseComposeLine(line);
  if (!parsed) return;

  if (parsed.kind === "layer") {
    job.layers.set(parsed.layer, parsed.fraction);
    let sum = 0;
    for (const v of job.layers.values()) sum += v;
    const pct = (sum / job.layers.size) * 100 * PULL_SHARE;
    jobProgress(job, pct, `pulling image · ${job.layers.size} layer${job.layers.size === 1 ? "" : "s"}`);
    return;
  }

  // Once containers are being made the pull is finished, however many layers
  // reported — an image already on disk emits no layer lines at all.
  const step = parsed.step;
  if (step.startsWith("creat")) jobProgress(job, PULL_SHARE * 100 + 4, "creating containers");
  else if (step.startsWith("start") || step === "running") jobProgress(job, PULL_SHARE * 100 + 9, "starting containers");
}

async function composeUp(job, dir, project, vars = {}) {
  const [bin, ...pre] = needCompose();
  const args = [...pre, "-f", path.join(dir, "docker-compose.yml"), "-p", project, "up", "-d", "--remove-orphans"];

  // The same variables also go into compose's environment, not just through our
  // own text substitution — that is what makes `${TZ:-Etc/UTC}` style defaults
  // resolve, which a plain string replace never sees.
  const env = { ...process.env, ...vars };

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: dir, env });
    const onChunk = d => String(d).split("\n").forEach(l => {
      if (!l.trim()) return;
      feedProgress(job, l);
      jobLog(job, l);
    });
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`compose exited with code ${code}`)));
  });
}

/**
 * Tear down whatever a failed `up` managed to create.
 *
 * Compose creates the containers and then starts them, so a failure at start
 * time leaves them behind in `Created`. Nothing records them as installed —
 * they are not in the Installed list and there is no compose project the UI
 * knows about — so they sit in `docker ps -a` as debris with no button to
 * remove them. Cleaning up is part of failing.
 */
async function composeDownQuiet(dir, project) {
  const [bin, ...pre] = composeCmd || [];
  if (!bin) return;
  const args = [...pre, "-f", path.join(dir, "docker-compose.yml"), "-p", project, "down", "--remove-orphans"];
  await new Promise(resolve => {
    const child = spawn(bin, args, { cwd: dir, env: { ...process.env } });
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
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
  // User-supplied values win over the defaults; the defaults exist so a CasaOS
  // template that assumes $PUID/$TZ/$AppID does not render with blanks.
  const vars = { ...defaultVars(slug), ...params };
  const rendered = applyParams(raw, vars);

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

  const job = newJob(`Installing ${app.name}`);
  // Host fixups need the job so they can report what they dropped, so the file
  // is written after they have run rather than before.
  hostFixups(doc, job);
  await fsp.writeFile(path.join(dir, "docker-compose.yml"), YAML.stringify(doc), "utf8");

  (async () => {
    try {
      jobLog(job, `project ${project}`);
      if (wanted.length) jobLog(job, `ports ${wanted.join(", ")}`);
      await composeUp(job, dir, project, vars);
      recordInstall({
        id: slug, slug, name: app.name, icon: app.icon || null,
        project, dir, libraryId, source: "library",
        ports: wanted, installedAt: Date.now(), managedBy: "nexus"
      });
      jobDone(job, "success", `${app.name} is running.`);
    } catch (err) {
      jobLog(job, "install failed — removing what was created…");
      await composeDownQuiet(dir, project).catch(() => {});
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
  const seedSlug = String(name || "app").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";
  const vars = { ...defaultVars(seedSlug), ...params };
  const rendered = applyParams(composeText, vars);

  let doc;
  try { doc = YAML.parse(rendered); }
  catch (e) { throw Object.assign(new Error("that is not valid YAML: " + e.message), { status: 422 }); }
  if (!doc || typeof doc !== "object" || !doc.services || !Object.keys(doc.services).length) {
    throw Object.assign(new Error("compose file has no services"), { status: 422 });
  }

  delete doc["x-casaos"];
  for (const svc of Object.values(doc.services)) delete svc["x-casaos"];

  const slug = seedSlug;
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

  const job = newJob(`Installing ${slug}`);
  hostFixups(doc, job);
  await fsp.writeFile(path.join(dir, "docker-compose.yml"), YAML.stringify(doc), "utf8");

  (async () => {
    try {
      if (wanted.length) jobLog(job, `ports ${wanted.join(", ")}`);
      await composeUp(job, dir, project, vars);
      recordInstall({
        id: slug, slug, name: slug, icon: null, project, dir,
        libraryId: null, source, ports: wanted, installedAt: Date.now(), managedBy: "nexus"
      });
      jobDone(job, "success", `${slug} is running.`);
    } catch (err) {
      jobLog(job, "install failed — removing what was created…");
      await composeDownQuiet(dir, project).catch(() => {});
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
