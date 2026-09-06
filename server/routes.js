import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import cfg from "./config.js";
import { db, save, audit, clientIp } from "./store.js";
import * as metrics from "./metrics.js";
import * as sensors from "./sensors.js";
import * as dockerx from "./dockerx.js";
import * as filesvc from "./files.js";
import * as terminal from "./terminal.js";
import * as library from "./library.js";
import * as apps from "./apps.js";
import {
  hashPassword, verifyPassword, createSession, destroySession,
  setSessionCookies, clearSessionCookies, requireAuth, requireCsrf,
  loginAllowed, noteLoginFailure, noteLoginSuccess
} from "./auth.js";

export default function routes() {
  const r = express.Router();

  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /* ---------------- health (unauthenticated, for uptime monitors) ------------ */
  r.get("/health", (_req, res) => res.json({ ok: true, version: "0.1.0", uptimeSec: Math.floor(process.uptime()) }));

  /* ---------------- first-run setup ---------------- */
  r.get("/setup/status", (_req, res) => {
    res.json({ needsSetup: db().users.length === 0 });
  });

  r.post("/setup", wrap(async (req, res) => {
    if (db().users.length > 0) return res.status(409).json({ error: "already set up" });
    const { username, password } = req.body || {};
    if (!username || String(username).length < 2) return res.status(400).json({ error: "username too short" });
    if (!password || String(password).length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });

    const user = { id: 1, username: String(username).trim(), passwordHash: hashPassword(String(password)), createdAt: Date.now() };
    db().users.push(user);
    save();
    const s = createSession(user, req);
    setSessionCookies(req, res, s);
    audit("setup.complete", { username: user.username }, req);
    res.json({ ok: true, user: { id: user.id, username: user.username }, csrf: s.csrf });
  }));

  /* ---------------- auth ---------------- */
  r.post("/auth/login", wrap(async (req, res) => {
    const ip = clientIp(req);
    const gate = loginAllowed(ip);
    if (!gate.ok) {
      res.set("Retry-After", String(gate.retryAfter));
      return res.status(429).json({ error: `too many attempts — retry in ${gate.retryAfter}s` });
    }
    const { username, password } = req.body || {};
    const user = db().users.find(u => u.username === String(username || "").trim());

    // Verify even when the user is missing, so a wrong username and a wrong
    // password take about the same time.
    const ok = user
      ? verifyPassword(String(password || ""), user.passwordHash)
      : verifyPassword("dummy", hashPassword("dummy-not-a-real-user"));

    if (!user || !ok) {
      noteLoginFailure(ip);
      audit("auth.login.failed", { username: String(username || "").slice(0, 64) }, req);
      return res.status(401).json({ error: "invalid credentials" });
    }
    noteLoginSuccess(ip);
    user.lastLoginAt = Date.now();
    const s = createSession(user, req);
    setSessionCookies(req, res, s);
    audit("auth.login", null, req, user);
    res.json({ ok: true, user: { id: user.id, username: user.username }, csrf: s.csrf });
  }));

  r.post("/auth/logout", requireAuth, requireCsrf, (req, res) => {
    audit("auth.logout", null, req);
    destroySession(req.session.token);
    clearSessionCookies(res);
    res.json({ ok: true });
  });

  r.get("/auth/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not authenticated" });
    res.json({ user: { id: req.user.id, username: req.user.username }, csrf: req.session.csrf });
  });

  /* everything below requires a session */
  r.use(requireAuth);
  r.use(requireCsrf);

  /* ---------------- system ---------------- */
  r.get("/system/info", (_req, res) => {
    res.json({
      host: metrics.snapshot.host,
      cpu: { model: metrics.snapshot.cpu.model, cores: metrics.snapshot.cpu.cores },
      simulated: metrics.snapshot.simulated,
      platform: process.platform,
      terminal: { enabled: terminal.enabled(), shell: terminal.shellName(), active: terminal.activeCount(), backend: terminal.backendName(), resize: terminal.supportsResize() },
      store: { compose: apps.composeStatus(), libraries: library.listLibraries().length, installed: apps.listInstalled().length },
      docker: dockerx.status(),
      fileRoots: filesvc.listRoots(),
      config: { loadedFrom: cfg.loadedFrom, dataDir: cfg.dataDir, port: cfg.port }
    });
  });

  r.get("/system/metrics", (_req, res) => res.json(metrics.full()));

  r.get("/system/smart", wrap(async (req, res) => {
    const force = req.query.refresh === "1";
    res.json(await sensors.smart(force));
  }));

  /* ---------------- docker ---------------- */
  r.get("/docker/containers", wrap(async (_req, res) => {
    if (!dockerx.status().available) return res.json({ available: false, reason: dockerx.status().reason, containers: [] });
    res.json({ available: true, containers: await dockerx.listContainers() });
  }));

  r.post("/docker/containers/:id/:action", wrap(async (req, res) => {
    const { id, action } = req.params;
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) return res.status(400).json({ error: "bad container id" });
    await dockerx.containerAction(id, action);
    audit("docker." + action, { container: id }, req);
    res.json({ ok: true });
  }));

  r.delete("/docker/containers/:id", wrap(async (req, res) => {
    const { id } = req.params;
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) return res.status(400).json({ error: "bad container id" });
    await dockerx.removeContainer(id);
    audit("docker.remove", { container: id }, req);
    res.json({ ok: true });
  }));

  r.get("/docker/containers/:id/stats", wrap(async (req, res) => {
    res.json(await dockerx.containerStats(req.params.id));
  }));

  /* ---------------- files ---------------- */
  r.get("/files/roots", (_req, res) => res.json(filesvc.listRoots()));

  r.get("/files", wrap(async (req, res) => {
    const dir = req.query.path || filesvc.listRoots()[0]?.path;
    if (!dir) return res.status(400).json({ error: "no file roots configured" });
    res.json(await filesvc.list(String(dir)));
  }));

  r.post("/files/mkdir", wrap(async (req, res) => {
    const out = await filesvc.mkdir(String(req.body?.path || ""));
    audit("files.mkdir", out, req);
    res.json(out);
  }));

  r.post("/files/rename", wrap(async (req, res) => {
    const out = await filesvc.rename(String(req.body?.from || ""), String(req.body?.to || ""));
    audit("files.rename", { from: req.body?.from, to: req.body?.to }, req);
    res.json(out);
  }));

  r.post("/files/delete", wrap(async (req, res) => {
    const target = String(req.body?.path || "");
    const out = await filesvc.remove(target);
    audit("files.delete", { path: target }, req);
    res.json(out);
  }));

  r.get("/files/download", wrap(async (req, res) => {
    const safe = await filesvc.resolveSafe(String(req.query.path || ""));
    const st = await fsp.stat(safe);
    if (st.isDirectory()) return res.status(400).json({ error: "cannot download a directory" });
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(safe).replace(/"/g, "")}"`);
    res.setHeader("Content-Length", String(st.size));
    fs.createReadStream(safe).pipe(res);
  }));

  // Raw-body upload: avoids a multipart dependency. The client PUTs the file
  // bytes with the destination in the query string.
  r.put("/files/upload", wrap(async (req, res) => {
    const dest = await filesvc.resolveSafe(String(req.query.path || ""), { mustExist: false });
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(dest, { flags: "w", mode: 0o644 });
      req.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      req.on("error", reject);
    });
    audit("files.upload", { path: dest }, req);
    res.json({ ok: true, path: dest });
  }));

  /* ---------------- dashboard layout ---------------- */
  r.get("/layout", (_req, res) => res.json({ widgets: db().widgets }));

  r.put("/layout", (req, res) => {
    const w = req.body?.widgets;
    if (!Array.isArray(w)) return res.status(400).json({ error: "widgets must be an array" });
    if (w.length > 100) return res.status(400).json({ error: "too many widgets" });
    db().widgets = w.map(x => ({
      id: Number(x.id) || 0, t: String(x.t || "").slice(0, 40),
      x: clampInt(x.x, 0, 11), y: clampInt(x.y, 0, 500),
      w: clampInt(x.w, 1, 12), h: clampInt(x.h, 1, 40),
      // Per-widget appearance (scale, colour, display mode). Sanitised rather
      // than stored verbatim so a crafted request cannot stuff arbitrary data
      // into the state file through the layout endpoint.
      cfg: sanitizeCfg(x.cfg)
    }));
    save();
    res.json({ ok: true });
  });

  r.delete("/layout", (req, res) => { db().widgets = null; save(); audit("layout.reset", null, req); res.json({ ok: true }); });

  /* ---------------- app store ---------------- */
  r.get("/store/status", (_req, res) => {
    res.json({
      compose: apps.composeStatus(),
      docker: dockerx.status(),
      libraries: library.listLibraries(),
      installedCount: apps.listInstalled().length
    });
  });

  r.get("/store/libraries", (_req, res) => res.json(library.listLibraries()));

  r.get("/store/libraries/suggested", (_req, res) => {
    const have = new Set(library.listLibraries().map(l => l.url));
    res.json(library.SUGGESTED_LIBRARIES.map(s => ({ ...s, added: have.has(s.url) })));
  });

  r.post("/store/libraries", wrap(async (req, res) => {
    const lib = await library.addLibrary({
      url: String(req.body?.url || "").trim(),
      name: req.body?.name ? String(req.body.name).slice(0, 80) : null,
      format: ["nexus", "casaos", "auto"].includes(req.body?.format) ? req.body.format : "auto"
    });
    audit("store.library.add", { url: lib.url }, req);
    res.json(lib);
  }));

  r.delete("/store/libraries/:id", wrap(async (req, res) => {
    library.removeLibrary(req.params.id);
    audit("store.library.remove", { id: req.params.id }, req);
    res.json({ ok: true });
  }));

  r.post("/store/libraries/:id/sync", wrap(async (req, res) => {
    const out = await library.syncLibrary(req.params.id);
    audit("store.library.sync", out, req);
    res.json(out);
  }));

  r.get("/store/apps", (req, res) => {
    res.json(library.searchCatalog({
      q: String(req.query.q || ""),
      category: String(req.query.category || ""),
      library: String(req.query.library || ""),
      limit: Math.min(Number(req.query.limit) || 60, 200),
      offset: Math.max(Number(req.query.offset) || 0, 0)
    }));
  });

  r.get("/store/apps/:library/:slug", wrap(async (req, res) => {
    const app = library.getApp(req.params.library, req.params.slug);
    if (!app) return res.status(404).json({ error: "not found" });
    let compose = null;
    try { compose = await library.readCompose(app); } catch {}
    res.json({ ...app, compose });
  }));

  r.post("/store/install", wrap(async (req, res) => {
    const out = await apps.installFromCatalog({
      libraryId: String(req.body?.libraryId || ""),
      slug: String(req.body?.slug || ""),
      params: req.body?.params || {},
      force: !!req.body?.force
    });
    audit("store.install", { slug: req.body?.slug, library: req.body?.libraryId }, req);
    res.json(out);
  }));

  r.post("/store/install-url", wrap(async (req, res) => {
    const out = await apps.installFromUrl({
      url: String(req.body?.url || ""),
      name: req.body?.name ? String(req.body.name) : null,
      params: req.body?.params || {},
      force: !!req.body?.force
    });
    audit("store.install.url", { url: req.body?.url }, req);
    res.json(out);
  }));

  r.post("/store/install-compose", wrap(async (req, res) => {
    const out = await apps.installFromComposeText({
      name: String(req.body?.name || "app"),
      composeText: String(req.body?.composeText || ""),
      params: req.body?.params || {},
      force: !!req.body?.force
    });
    audit("store.install.compose", { name: req.body?.name }, req);
    res.json(out);
  }));

  r.get("/store/installed", (_req, res) => res.json(apps.listInstalled()));

  r.delete("/store/installed/:id", wrap(async (req, res) => {
    const out = await apps.uninstall(req.params.id, { removeVolumes: req.query.volumes === "1" });
    audit("store.uninstall", { id: req.params.id, volumes: req.query.volumes === "1" }, req);
    res.json(out);
  }));

  r.get("/store/jobs/:id", (req, res) => {
    const j = apps.getJob(req.params.id);
    if (!j) return res.status(404).json({ error: "no such job" });
    res.json(j);
  });

  /* ---------------- settings + audit ---------------- */
  r.get("/settings", (_req, res) => res.json(db().settings || {}));

  r.put("/settings", (req, res) => {
    const s = req.body && typeof req.body === "object" ? req.body : {};
    db().settings = { ...db().settings, ...s };
    save();
    res.json(db().settings);
  });

  r.get("/audit", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(db().audit.slice(0, limit));
  });

  return r;
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v) || 0);
  return Math.max(lo, Math.min(hi, n));
}

/** Widget appearance settings: a small, closed set of short scalar values. */
function sanitizeCfg(cfg) {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return {};
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(cfg)) {
    if (n++ >= 12) break;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,24}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(-1e6, Math.min(1e6, v));
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 40);
  }
  return out;
}
