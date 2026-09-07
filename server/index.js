import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";

import cfg from "./config.js";
import { db, audit } from "./store.js";
import { attachUser, originAllowed, sessionFromUpgrade } from "./auth.js";
import routes from "./routes.js";
import * as metrics from "./metrics.js";
import * as dockerx from "./dockerx.js";
import * as terminal from "./terminal.js";
import * as apps from "./apps.js";
import * as automation from "./automation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "..", "web");
const ASSET_DIR = path.join(__dirname, "..", "assets");

const app = express();
app.disable("x-powered-by");

// Behind a reverse proxy we only trust forwarded headers from configured hops.
app.set("trust proxy", cfg.trustedProxies.length ? cfg.trustedProxies : false);

app.use(express.json({ limit: "1mb" }));
app.use(attachUser);

// Security headers. No CDN is used anywhere in the UI except Google Fonts, so
// the policy can stay tight.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "img-src 'self' data: https:",   // remote app-store icons; images cannot execute
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join("; "));
  next();
});

app.use("/api", routes());

// Sprites are content-stable and small; a day of caching is safe and they
// revalidate by ETag anyway.
app.use("/assets", express.static(ASSET_DIR, { maxAge: "1d", etag: true }));

// The app shell must NOT be cached by time. After `git pull && install.sh` a
// stale app.js would keep running against a newer API until the cache expired,
// which is a genuinely confusing failure. ETag revalidation makes repeat loads
// cheap (304, no body) without ever serving stale code.
app.use(express.static(WEB_DIR, {
  index: "index.html",
  etag: true,
  lastModified: true,
  maxAge: 0,
  setHeaders(res) { res.setHeader("Cache-Control", "no-cache"); }
}));

// SPA fallback — anything not an API route or a real file serves the app shell.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(WEB_DIR, "index.html"));
});

// Error handler last. Never leak a stack trace to the browser.
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error("[api]", req.method, req.path, err);
  res.status(status).json({ error: err.expose === false ? "internal error" : (err.message || "internal error") });
});

const VERSION = "0.2.0";
const server = http.createServer(app);

/* ============================ WebSockets ============================ */

const wssMetrics = new WebSocketServer({ noServer: true });
const wssTerminal = new WebSocketServer({ noServer: true });
const wssLogs = new WebSocketServer({ noServer: true });
const wssEvents = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  // 1. Origin check FIRST. Browsers do not apply CORS to WebSockets, so without
  //    this any site you visit while logged in could open a socket to this box
  //    with your cookies attached. This is the highest-consequence check here.
  if (!originAllowed(req)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    return socket.destroy();
  }
  // 2. Then the session.
  const auth = sessionFromUpgrade(req);
  if (!auth) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return socket.destroy();
  }

  const { pathname } = new URL(req.url, "http://localhost");

  if (pathname === "/ws/metrics") {
    return wssMetrics.handleUpgrade(req, socket, head, ws => wssMetrics.emit("connection", ws, req, auth));
  }
  if (pathname === "/ws/terminal") {
    if (!terminal.enabled()) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); return socket.destroy(); }
    return wssTerminal.handleUpgrade(req, socket, head, ws => wssTerminal.emit("connection", ws, req, auth));
  }
  if (pathname === "/ws/events") {
    return wssEvents.handleUpgrade(req, socket, head, ws => wssEvents.emit("connection", ws, req, auth));
  }
  if (pathname.startsWith("/ws/logs/")) {
    return wssLogs.handleUpgrade(req, socket, head, ws => wssLogs.emit("connection", ws, req, auth));
  }
  socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
  socket.destroy();
});

/* ---- metrics stream ---- */
wssMetrics.on("connection", ws => {
  let alive = true;
  ws.on("pong", () => { alive = true; });

  const send = () => {
    if (ws.readyState !== ws.OPEN) return;
    try { ws.send(JSON.stringify({ type: "metrics", data: metrics.frame(240) })); } catch {}
  };
  send();
  const iv = setInterval(send, 2000);
  const ping = setInterval(() => {
    if (!alive) { clearInterval(iv); clearInterval(ping); return ws.terminate(); }
    alive = false;
    try { ws.ping(); } catch {}
  }, 30_000);

  ws.on("close", () => { clearInterval(iv); clearInterval(ping); });
  ws.on("error", () => { clearInterval(iv); clearInterval(ping); });
});

/* ---- terminal ---- */
wssTerminal.on("connection", (ws, req, auth) => {
  let session;
  try {
    session = terminal.open({
      cols: 80, rows: 24,
      onData: buf => { if (ws.readyState === ws.OPEN) ws.send(buf); },
      onExit: code => {
        if (ws.readyState === ws.OPEN) {
          ws.send(Buffer.from(`\r\n[nexus] session ended (exit ${code})\r\n`));
          ws.close();
        }
      }
    });
  } catch (err) {
    ws.send(Buffer.from(`\r\n[nexus] ${err.message}\r\n`));
    return ws.close();
  }

  audit("terminal.open", { sessionId: session.id }, req, auth.user);

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      // Control frames arrive as JSON; anything else is keystrokes.
      const s = data.toString();
      if (s.startsWith("{")) {
        try {
          const msg = JSON.parse(s);
          if (msg.type === "resize") return session.resize(Number(msg.cols) || 80, Number(msg.rows) || 24);
        } catch {}
      }
      return session.write(s);
    }
    session.write(data);
  });

  ws.on("close", () => {
    audit("terminal.close", { sessionId: session.id, durationSec: Math.round((Date.now() - session.startedAt) / 1000) }, req, auth.user);
    session.kill();
  });
  ws.on("error", () => session.kill());
});

/* ---- install/uninstall job progress, and automation alerts ---- */
wssEvents.on("connection", ws => {
  const send = (type, data) => {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify({ type, data })); } catch {}
    }
  };
  const onJob = payload => send("job", payload);
  const onAlert = payload => send("alert", payload);

  apps.bus.on("job", onJob);
  automation.bus.on("alert", onAlert);

  const off = () => { apps.bus.off("job", onJob); automation.bus.off("alert", onAlert); };
  ws.on("close", off);
  ws.on("error", off);
});

/* ---- container logs ---- */
wssLogs.on("connection", async (ws, req) => {
  const id = new URL(req.url, "http://localhost").pathname.replace("/ws/logs/", "");
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) { ws.send("bad container id"); return ws.close(); }
  let stop = () => {};
  try {
    stop = await dockerx.followLogs(id, line => { if (ws.readyState === ws.OPEN) ws.send(line); });
  } catch (err) {
    ws.send(`[nexus] ${err.message}`);
    return ws.close();
  }
  ws.on("close", stop);
  ws.on("error", stop);
});

/* ============================ boot ============================ */

async function main() {
  // Listen FIRST, then warm everything up in the background.
  //
  // Probing Docker, discovering sensors and taking a first metrics sample all
  // shell out to the OS, and on some hosts that is slow enough to look like a
  // hang (Windows + WMI is minutes, not seconds). None of it is needed to serve
  // the login page, so nothing here gets to delay the socket opening. Endpoints
  // that depend on this data already report their own "not ready" state.
  const warmup = (async () => {
    await apps.init().catch(e => console.error("[boot] app store:", e.message));
    await dockerx.init().catch(e => console.error("[boot] docker:", e.message));
    await metrics.start().catch(e => console.error("[boot] metrics:", e.message));
    // Last: the rule evaluator reads the metrics snapshot and the Docker list,
    // so starting it before those exist just burns ticks on empty readings.
    try { automation.init(); } catch (e) { console.error("[boot] automation:", e.message); }
  })();

  server.listen(cfg.port, cfg.host, async () => {
    console.log("");
    console.log("  nexus " + VERSION);
    console.log(`  listening       http://${cfg.host}:${cfg.port}`);
    console.log("  warming up      docker, sensors, app store…");
    await warmup;
    const d = dockerx.status();
    console.log("");
    console.log(`  platform        ${process.platform} ${metrics.snapshot.host?.distro || ""}`.trimEnd());
    console.log(`  config          ${cfg.loadedFrom || "defaults (no config file found)"}`);
    console.log(`  data dir        ${cfg.dataDir}`);
    console.log(`  docker          ${d.available ? "connected" : "unavailable — " + d.reason}`);
    console.log(`  terminal        ${cfg.terminal.enabled ? "ENABLED via " + terminal.backendName() + " (" + terminal.shellName() + ")" : "disabled"}`);
    console.log(`  compose         ${apps.composeStatus().available ? apps.composeStatus().command : "not found — app store installs disabled"}`);
    console.log(`  file roots      ${cfg.fileRoots.map(r => r.path).join(", ") || "(none)"}`);

    if (db().users.length === 0) {
      console.log("");
      console.log("  >> No account yet. Open the URL above to create your admin user.");
    }
    if (cfg.terminal.enabled && cfg.host === "0.0.0.0") {
      console.log("");
      console.log("  !! The terminal is enabled and Nexus is bound to all interfaces.");
      console.log("  !! Anyone who reaches this port and logs in gets a root shell.");
      console.log("  !! Keep it behind your LAN firewall, or set terminal.enabled=false.");
    }
    console.log("");
  });
}

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${cfg.port} is already in use.`);
    console.error(`  CasaOS holds :80 — pick another port with NEXUS_PORT=8081 npm start\n`);
    process.exit(1);
  }
  if (err.code === "EACCES") {
    console.error(`\n  Permission denied binding port ${cfg.port}. Ports below 1024 need root.\n`);
    process.exit(1);
  }
  throw err;
});

process.on("SIGTERM", () => { terminal.killAll(); server.close(() => process.exit(0)); });
process.on("SIGINT", () => { terminal.killAll(); server.close(() => process.exit(0)); });

main().catch(err => { console.error("failed to start:", err); process.exit(1); });
