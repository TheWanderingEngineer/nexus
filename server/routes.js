import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import cfg from "./config.js";
import { db, save, audit, clientIp } from "./store.js";
import * as metrics from "./metrics.js";
import * as sensors from "./sensors.js";
import * as security from "./security.js";
import * as dockerx from "./dockerx.js";
import * as filesvc from "./files.js";
import * as terminal from "./terminal.js";
import * as library from "./library.js";
import * as apps from "./apps.js";
import * as automation from "./automation.js";
import * as agent from "./agent.js";
import * as agentSkills from "./skills.js";
import {
  hashPassword, verifyPassword, createSession, destroySession,
  setSessionCookies, clearSessionCookies, requireAuth, requireCsrf,
  loginAllowed, noteLoginFailure, noteLoginSuccess, originDiagnosis
} from "./auth.js";

export default function routes() {
  const r = express.Router();

  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /* ---------------- health (unauthenticated, for uptime monitors) ------------ */
  r.get("/health", (_req, res) => res.json({ ok: true, version: cfg.version, uptimeSec: Math.floor(process.uptime()) }));

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
      version: cfg.version,
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

  /**
   * What the server sees about how this request reached it.
   *
   * The browser cannot tell a refused WebSocket from one a proxy silently
   * dropped — both are just a socket that closed. This endpoint arrives over
   * plain HTTP, which is the half of the connection that IS working, and says
   * whether an upgrade from this same origin would be allowed. The UI uses that
   * to name the actual cause instead of showing zeroes.
   */
  r.get("/system/proxy-check", (req, res) => {
    // The caller tells us the origin its WebSocket would use, because this
    // request's own Origin header is usually absent on a same-origin GET.
    const asked = typeof req.query.origin === "string" ? req.query.origin.slice(0, 300) : null;
    const d = originDiagnosis(req, asked);
    res.json({
      ...d,
      wsPath: "/ws/metrics",
      configFile: cfg.loadedFrom || "/etc/nexus/config.json",
      // The exact strings to paste, rather than a paragraph describing them.
      suggest: {
        allowedOrigins: d.origin && !d.ok ? [...cfg.allowedOrigins, d.origin] : null,
        trustedProxies: d.behindProxy && !d.trustedPeer && d.peer ? [...cfg.trustedProxies, d.peer] : null
      }
    });
  });

  r.get("/system/security", wrap(async (req, res) => {
    res.json(await security.scan({ hours: Number(req.query.hours) || 24, force: req.query.refresh === "1" }));
  }));

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
  /**
   * Roots, with capacity and the user's own labelling.
   *
   * Order and note are a browser-side concern conceptually, but they live in
   * server settings on purpose: the point of "which drive is for films" is that
   * it reads the same from the phone as from the desktop.
   */
  r.get("/files/roots", wrap(async (_req, res) => {
    const prefs = db().settings?.fileRoots || {};
    const rows = (await filesvc.listRootsDetailed()).map(r0 => ({
      ...r0,
      note: prefs[r0.path]?.note || "",
      order: Number.isFinite(prefs[r0.path]?.order) ? prefs[r0.path].order : null
    }));
    // Unordered roots keep their config order, after the ones placed by hand.
    rows.sort((a, b) =>
      (a.order ?? 500 + rows.indexOf(a)) - (b.order ?? 500 + rows.indexOf(b)));
    res.json(rows);
  }));

  r.put("/files/roots/prefs", (req, res) => {
    const known = new Set(filesvc.listRoots().map(r0 => r0.path));
    const incoming = req.body?.prefs;
    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ error: "prefs must be an object" });
    }
    const out = {};
    for (const [rawPath, v] of Object.entries(incoming)) {
      // Normalise before comparing: listRoots resolves its paths, so on Windows
      // it answers in backslashes while a caller may well send forward slashes.
      // Comparing the raw strings silently matches nothing and drops every pref.
      const p = path.resolve(String(rawPath));
      // Only paths that are actually configured roots, so this endpoint cannot
      // be used to grow the settings file with arbitrary keys.
      if (!known.has(p) || !v || typeof v !== "object") continue;
      out[p] = {
        note: String(v.note ?? "").slice(0, 120),
        order: clampInt(v.order, 0, 99)
      };
    }
    const d = db();
    d.settings = { ...d.settings, fileRoots: out };
    save();
    res.json({ ok: true, prefs: out });
  });

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

  r.post("/files/transfer", wrap(async (req, res) => {
    const move = !!req.body?.move;
    const out = await filesvc.transfer(req.body?.from, req.body?.to, {
      move,
      overwrite: !!req.body?.overwrite
    });
    audit(move ? "files.move" : "files.copy", { count: out.count, to: out.dest }, req);
    res.json(out);
  }));

  r.post("/files/delete", wrap(async (req, res) => {
    const target = String(req.body?.path || "");
    const out = await filesvc.remove(target);
    audit("files.delete", { path: target }, req);
    res.json(out);
  }));

  r.get("/files/read", wrap(async (req, res) => {
    res.json(await filesvc.readText(String(req.query.path || "")));
  }));

  r.post("/files/write", wrap(async (req, res) => {
    const out = await filesvc.writeText(
      String(req.body?.path || ""),
      req.body?.content,
      req.body?.mtime
    );
    audit("files.write", { path: out.path, bytes: out.size }, req);
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

  r.post("/files/mkdirp", wrap(async (req, res) => {
    const out = await filesvc.mkdirp(String(req.body?.path || ""));
    res.json(out);
  }));

  r.post("/files/exists", wrap(async (req, res) => {
    const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    res.json({ existing: await filesvc.existing(paths) });
  }));

  // Raw-body upload: avoids a multipart dependency. The client PUTs the file
  // bytes with the destination in the query string.
  //
  // Streamed to a sibling temp file and renamed on completion, so a connection
  // that drops halfway cannot leave a truncated file sitting where a good one
  // used to be — the same reasoning as the text editor's save.
  r.put("/files/upload", wrap(async (req, res) => {
    const dest = await filesvc.resolveForCreate(String(req.query.path || ""));
    const overwrite = req.query.overwrite === "1";

    const existing = await fsp.stat(dest).catch(() => null);
    if (existing?.isDirectory()) {
      return res.status(409).json({ error: "a folder already exists at that path" });
    }
    if (existing && !overwrite) {
      return res.status(409).json({ error: "a file already exists there" });
    }

    await fsp.mkdir(path.dirname(dest), { recursive: true });

    const tmp = dest + ".nexus-upload";
    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp, { flags: "w", mode: 0o644 });
        req.pipe(out);
        out.on("finish", resolve);
        out.on("error", reject);
        req.on("error", reject);
        req.on("aborted", () => reject(new Error("upload aborted")));
      });
      await fsp.rename(tmp, dest);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }

    const st = await fsp.stat(dest);
    audit("files.upload", { path: dest, bytes: st.size }, req);
    res.json({ ok: true, path: dest, size: st.size });
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
      // Phone reading order. Kept separate from x/y so reordering the stacked
      // list on a phone does not flatten the desktop canvas; null means "not
      // set yet", and the client falls back to the y/x order.
      order: x.order == null ? null : clampInt(x.order, 0, 500),
      // Per-widget appearance (scale, colour, display mode). Sanitised rather
      // than stored verbatim so a crafted request cannot stuff arbitrary data
      // into the state file through the layout endpoint.
      cfg: sanitizeCfg(x.cfg)
    }));
    save();
    res.json({ ok: true });
  });

  r.delete("/layout", (req, res) => { db().widgets = null; save(); audit("layout.reset", null, req); res.json({ ok: true }); });

  /* ---------------- dashboard presets ----------------
     A named arrangement you can switch to. Stored widgets go through exactly
     the same sanitiser as PUT /layout — a preset must not be a way to put into
     the state file what the layout endpoint would have refused. */
  const MAX_PRESETS = 24;

  const sanitizeWidgets = w => (Array.isArray(w) ? w : []).slice(0, 100).map(x => ({
    id: Number(x.id) || 0, t: String(x.t || "").slice(0, 40),
    x: clampInt(x.x, 0, 11), y: clampInt(x.y, 0, 500),
    w: clampInt(x.w, 1, 12), h: clampInt(x.h, 1, 40),
    order: x.order == null ? null : clampInt(x.order, 0, 500),
    cfg: sanitizeCfg(x.cfg)
  }));

  const presets = () => {
    const s0 = db().settings = db().settings || {};
    if (!Array.isArray(s0.presets)) s0.presets = [];
    return s0.presets;
  };

  r.get("/layout/presets", (_req, res) => res.json({ presets: presets() }));

  r.post("/layout/presets", (req, res) => {
    const list = presets();
    const name = String(req.body?.name || "").trim().slice(0, 40);
    if (!name) throw Object.assign(new Error("give the preset a name"), { status: 400 });
    const widgets = sanitizeWidgets(req.body?.widgets);
    if (!widgets.length) throw Object.assign(new Error("there are no widgets to save"), { status: 400 });

    // Saving over a name you already used is the expected thing, not an error.
    const existing = list.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.widgets = widgets;
      existing.savedAt = Date.now();
    } else {
      if (list.length >= MAX_PRESETS) throw Object.assign(new Error(`that is the ${MAX_PRESETS}th preset — delete one first`), { status: 400 });
      list.push({ id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                  name, widgets, savedAt: Date.now() });
    }
    save();
    audit("layout.preset.save", { name, widgets: widgets.length }, req);
    res.json({ presets: list });
  });

  r.delete("/layout/presets/:id", (req, res) => {
    const list = presets();
    const i = list.findIndex(p => p.id === req.params.id);
    if (i < 0) throw Object.assign(new Error("no such preset"), { status: 404 });
    const [gone] = list.splice(i, 1);
    save();
    audit("layout.preset.delete", { name: gone.name }, req);
    res.json({ presets: list });
  });

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

    // What the template expects somebody to fill in, and what we would use if
    // nobody did. Sent together so the install dialog can show real values
    // rather than the app quietly rendering blanks.
    const defaults = apps.defaultVars(app.slug);
    const vars = compose
      ? library.detectVars(compose).map(name => ({ name, value: defaults[name] ?? "" }))
      : [];

    res.json({ ...app, compose, vars });
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

  /* ---------------- control panel: automation ---------------- */
  r.get("/automation", (_req, res) => res.json(automation.getConfig()));

  r.put("/automation/rules", (req, res) => {
    const rule = automation.saveRule(req.body || {});
    audit("automation.rule.save", { id: rule.id, name: rule.name }, req);
    res.json(rule);
  });

  r.delete("/automation/rules/:id", (req, res) => {
    automation.deleteRule(req.params.id);
    audit("automation.rule.delete", { id: req.params.id }, req);
    res.json({ ok: true });
  });

  r.put("/automation/schedules", (req, res) => {
    const s = automation.saveSchedule(req.body || {});
    audit("automation.schedule.save", { id: s.id, name: s.name, time: s.time }, req);
    res.json(s);
  });

  r.delete("/automation/schedules/:id", (req, res) => {
    automation.deleteSchedule(req.params.id);
    audit("automation.schedule.delete", { id: req.params.id }, req);
    res.json({ ok: true });
  });

  r.put("/automation/notify", (req, res) => {
    const n = automation.saveNotify(req.body || {});
    // The URL can carry a token (ntfy topics, Discord webhooks), so log that it
    // changed without writing the secret itself into the audit log.
    audit("automation.notify.save", { configured: !!n.webhookUrl, format: n.webhookFormat }, req);
    res.json(n);
  });

  r.post("/automation/notify/test", wrap(async (req, res) => {
    const out = await automation.sendWebhook({
      level: "info",
      title: "Nexus test notification",
      message: `If you are reading this, alerts from ${metrics.snapshot.host?.hostname || "this host"} will reach you.`
    }, req.body?.webhookUrl || undefined);
    audit("automation.notify.test", out, req);
    res.json(out);
  }));

  r.put("/automation/power", (req, res) => {
    const p = automation.savePower(req.body || {});
    audit("automation.power.arm", p, req);
    res.json(p);
  });

  r.get("/automation/alerts", (req, res) => {
    res.json(automation.listAlerts(Math.min(Number(req.query.limit) || 60, 200)));
  });

  r.post("/automation/alerts/ack", (_req, res) => res.json(automation.ackAlerts()));
  r.delete("/automation/alerts", (req, res) => { audit("automation.alerts.clear", null, req); res.json(automation.clearAlerts()); });

  r.post("/system/power/:action", wrap(async (req, res) => {
    const out = await automation.power(req.params.action, req, req.user);
    res.json(out);
  }));

  /* ---------------- settings + audit ---------------- */
  r.get("/settings", (_req, res) => res.json(db().settings || {}));

  r.put("/settings", (req, res) => {
    const s = req.body && typeof req.body === "object" ? req.body : {};
    // The agent's config and its token counters are not general settings: they
    // are validated and clamped by agent.js, and this endpoint merges whatever
    // it is given. Without this the capability switches — including the root
    // shell — could be set from here with none of those checks run.
    delete s.agent; delete s.agentUsage;
    db().settings = { ...db().settings, ...s };
    save();
    res.json(db().settings);
  });

  r.get("/audit", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(db().audit.slice(0, limit));
  });

  /* ---------------- Nexus Expert (Hermes) ----------------
     Everything here is behind requireAuth + requireCsrf like the rest of this
     router. No endpoint returns an API key; `publicConfig()` reports only
     whether one is set and its last four characters. */
  r.get("/agent/config", (_req, res) => res.json(agent.publicConfig()));

  r.put("/agent/config", (req, res) => {
    const next = agent.saveSettings(req.body || {});
    // The capability set is the security-relevant part, so that is what the
    // audit log records — not the whole blob.
    audit("agent.config", { provider: next.provider, model: next.model, approval: next.approval, caps: next.caps, roots: next.roots }, req);
    res.json(agent.publicConfig());
  });

  r.put("/agent/key", (req, res) => {
    const provider = String(req.body?.provider || "");
    if (!agent.PROVIDERS.some(p => p.id === provider)) throw Object.assign(new Error("unknown provider"), { status: 400 });
    const key = req.body?.key;
    agent.setKey(provider, key === null || key === "" ? null : String(key));
    // The key itself is never logged — only that one was set or cleared.
    audit("agent.key", { provider, set: !!key }, req);
    res.json({ keys: agent.keyStatus() });
  });

  r.post("/agent/run", (_req, res) => res.json({ id: agent.newRun() }));

  r.post("/agent/run/:id/send", wrap(async (req, res) => {
    const text = String(req.body?.text || "").trim();
    if (!text) throw Object.assign(new Error("say something first"), { status: 400 });
    res.json(await agent.send(req.params.id, text, req));
  }));

  r.post("/agent/run/:id/approve", wrap(async (req, res) => {
    const decision = req.body?.decision === "allow" ? "allow" : "deny";
    audit("agent.approval", { decision }, req);
    res.json(await agent.resume(req.params.id, decision, req));
  }));

  r.post("/agent/test", wrap(async (req, res) => {
    const out = await agent.testKey();
    audit("agent.test", { provider: out.provider, model: out.model, ok: out.ok }, req);
    res.json(out);
  }));

  /* ---- the skill library ----
     Skills are Markdown on disk under <dataDir>/agent-skills. The id is
     slugified in skills.js so a dropped filename cannot address anything
     outside that folder. */
  const skillPayload = () => ({ list: agentSkills.list(), budget: agentSkills.budget(),
                                seeds: agentSkills.seedNames(), tags: agentSkills.tagCloud() });

  r.get("/agent/skills", (_req, res) => res.json(skillPayload()));

  r.get("/agent/skills/:id", (req, res) => res.json(agentSkills.read(req.params.id)));

  r.post("/agent/skills", (req, res) => {
    const { id, name, content, description, mode, tags } = req.body || {};
    if (typeof content !== "string" || !content.trim()) {
      throw Object.assign(new Error("a skill needs some text in it"), { status: 400 });
    }
    const savedId = agentSkills.write({ id, name, content, description, mode, tags });
    audit("agent.skill.save", { id: savedId, bytes: content.length }, req);
    res.json({ id: savedId, ...skillPayload() });
  });

  r.put("/agent/skills/:id", (req, res) => {
    if (typeof req.body?.enabled === "boolean") agentSkills.setEnabled(req.params.id, req.body.enabled);
    if (req.body?.mode) agentSkills.setMode(req.params.id, req.body.mode);
    if (req.body?.tags !== undefined) agentSkills.setTags(req.params.id, req.body.tags);
    audit("agent.skill.update", { id: req.params.id, enabled: req.body?.enabled, mode: req.body?.mode }, req);
    res.json(skillPayload());
  });

  r.delete("/agent/skills/:id", (req, res) => {
    agentSkills.remove(req.params.id);
    audit("agent.skill.delete", { id: req.params.id }, req);
    res.json(skillPayload());
  });

  /* Restore, not reset: a skill you edited keeps your version, a skill you
     deleted comes back. */
  r.post("/agent/skills/restore", (req, res) => {
    const added = agentSkills.seed();
    audit("agent.skill.restore", { added }, req);
    res.json({ added, ...skillPayload() });
  });

  /* ---- scheduled tasks ---- */
  r.put("/agent/crons", (req, res) => {
    const row = agent.saveCron(req.body || {});
    audit("agent.cron.save", { id: row.id, name: row.name, time: row.time, enabled: row.enabled }, req);
    res.json({ crons: agent.crons() });
  });

  r.delete("/agent/crons/:id", (req, res) => {
    agent.deleteCron(req.params.id);
    audit("agent.cron.delete", { id: req.params.id }, req);
    res.json({ crons: agent.crons() });
  });

  r.post("/agent/crons/:id/run", wrap(async (req, res) => {
    res.json({ cron: await agent.runCron(req.params.id, req), crons: agent.crons() });
  }));

  r.delete("/agent/usage", (req, res) => {
    agent.resetUsage();
    audit("agent.usage.reset", null, req);
    res.json(agent.usage());
  });

  return r;
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v) || 0);
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Widget appearance settings: a small, closed set of short scalars, plus short
 * string lists.
 *
 * The lists exist for the per-item visibility pickers (which mount points a
 * Storage widget shows, which channels a Sensors widget shows). Those hold real
 * filesystem paths and hwmon channel ids, so they need more than the 40-char
 * scalar budget — but they are still bounded on both count and length so the
 * layout endpoint cannot be used to stuff arbitrary data into the state file.
 */
function sanitizeCfg(cfg) {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return {};
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(cfg)) {
    if (n++ >= 14) break;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,24}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(-1e6, Math.min(1e6, v));
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 40);
    else if (Array.isArray(v)) {
      out[k] = v.filter(x => typeof x === "string").slice(0, 64).map(x => x.slice(0, 200));
    }
  }
  return out;
}
