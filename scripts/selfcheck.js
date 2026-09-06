/**
 * End-to-end self check.
 *
 * Boots a real server on a scratch port with a scratch data dir, then exercises
 * the auth flow, CSRF enforcement, the path jail and the WebSocket origin check.
 * Run with:  npm run check
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = 8123 + Math.floor(Math.random() * 300);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-check-"));
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  \x1b[32mPASS\x1b[0m  ${name}`); };
const bad = (name, why) => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m  ${name}\n        ${why}`); };

function check(name, cond, why = "") { cond ? ok(name) : bad(name, why); }

let cookies = "";
function absorb(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const kv = c.split(";")[0];
    const name = kv.split("=")[0];
    const rest = cookies.split("; ").filter(Boolean).filter(x => !x.startsWith(name + "="));
    if (kv.endsWith("=")) cookies = rest.join("; ");
    else cookies = [...rest, kv].join("; ");
  }
}
async function req(pathname, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (cookies) headers.Cookie = cookies;
  if (opts.json) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
  const res = await fetch(BASE + pathname, { ...opts, headers, redirect: "manual" });
  absorb(res);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { res, body, status: res.status };
}

function waitForPort(port, timeoutMs = 600000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      // If the server process has already died there is nothing to wait for.
      // Without this the harness sat here for ten minutes while the real answer
      // ("Cannot find package 'yaml'") was already sitting in its stderr.
      if (childExited !== null) {
        return reject(new Error(`server process exited with code ${childExited} before it could listen`));
      }
      const s = net.connect(port, "127.0.0.1");
      s.on("connect", () => { s.destroy(); resolve(); });
      s.on("error", () => {
        s.destroy();
        if (Date.now() - started > timeoutMs) return reject(new Error("server did not start"));
        setTimeout(attempt, 200);
      });
    })();
  });
}

// Dependencies must exist before anything else is worth trying. `install.sh`
// installs into /opt/nexus, so a fresh git clone you run tests from has no
// node_modules of its own — an easy and confusing thing to trip over.
if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
  console.error("\n  Dependencies are not installed in this directory.\n");
  console.error("  Run this first:\n");
  console.error("      npm install\n");
  console.error("  (scripts/install.sh installs into /opt/nexus, not into your clone.)\n");
  process.exit(1);
}

const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  env: { ...process.env, NEXUS_PORT: String(PORT), NEXUS_HOST: "127.0.0.1", NEXUS_DATA_DIR: DATA },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverLog = "";
let childExited = null;
child.stdout.on("data", d => { serverLog += d; });
child.stderr.on("data", d => { serverLog += d; });
child.on("exit", code => { childExited = code ?? 0; });
child.on("error", err => { childExited = -1; serverLog += `\nfailed to spawn server: ${err.message}\n`; });

function cleanup(code) {
  try { child.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { child.kill("SIGKILL"); } catch {} ; try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {} ; process.exit(code); }, 300);
}

try {
  console.log(`\n  nexus self-check  (port ${PORT}, data ${DATA})`);
  console.log("  waiting for the server — this can take minutes on a scanned filesystem\n");
  await waitForPort(PORT);

  // The socket accepting is not the same as the app answering. On a slow host
  // the first request can land while Node is still busy, so poll /api/health
  // until it actually replies rather than failing the whole run on one refusal.
  {
    const deadline = Date.now() + 120000;
    let ready = false, lastErr = "";
    while (Date.now() < deadline) {
      try {
        const r = await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(10000) });
        if (r.ok) { ready = true; break; }
        lastErr = "HTTP " + r.status;
      } catch (e) { lastErr = e.message; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!ready) throw new Error(`server never answered /api/health (${lastErr})`);
  }

  /* ---- health, unauthenticated ---- */
  {
    const { status, body } = await req("/api/health");
    check("health endpoint responds without auth", status === 200 && body.ok === true, `got ${status}`);
  }

  /* ---- protected route rejects anonymous ---- */
  {
    const { status } = await req("/api/system/info");
    check("protected route rejects anonymous request", status === 401, `expected 401, got ${status}`);
  }

  /* ---- first-run setup ---- */
  {
    const { body } = await req("/api/setup/status");
    check("reports first-run state", body.needsSetup === true, JSON.stringify(body));
  }
  {
    const { status, body } = await req("/api/setup", { method: "POST", json: { username: "admin", password: "correct-horse-battery" } });
    check("creates the admin account", status === 200 && body.ok === true, JSON.stringify(body));
    globalThis.CSRF = body.csrf;
    check("issues a CSRF token", typeof body.csrf === "string" && body.csrf.length > 20, "no csrf returned");
  }
  {
    const { status } = await req("/api/setup", { method: "POST", json: { username: "x", password: "yyyyyyyy" } });
    check("refuses a second setup", status === 409, `expected 409, got ${status}`);
  }

  /* ---- session works ---- */
  {
    const { status, body } = await req("/api/auth/me");
    check("session cookie authenticates", status === 200 && body.user.username === "admin", JSON.stringify(body));
  }
  {
    const { status, body } = await req("/api/system/info");
    check("system info returns data", status === 200 && !!body.host, JSON.stringify(body).slice(0, 120));
  }
  {
    const { status, body } = await req("/api/system/metrics");
    const hasCpu = body && body.cpu && typeof body.cpu.usage === "number";
    check("metrics report a real CPU number", status === 200 && hasCpu, JSON.stringify(body?.cpu));
  }

  /* ---- CSRF ---- */
  {
    const { status } = await req("/api/layout", { method: "PUT", json: { widgets: [] } });
    check("state-changing request without CSRF is refused", status === 403, `expected 403, got ${status}`);
  }
  {
    const { status } = await req("/api/layout", {
      method: "PUT", json: { widgets: [{ id: 1, t: "cpu", x: 0, y: 0, w: 4, h: 4 }] },
      headers: { "X-CSRF-Token": globalThis.CSRF }
    });
    check("state-changing request with CSRF succeeds", status === 200, `got ${status}`);
  }
  {
    const { body } = await req("/api/layout");
    check("layout persisted and reads back", Array.isArray(body.widgets) && body.widgets[0]?.t === "cpu", JSON.stringify(body));
  }

  /* ---- path jail ---- */
  {
    const escape = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc";
    const { status, body } = await req("/api/files?path=" + encodeURIComponent(escape));
    check("file manager rejects a path outside its roots", status === 403, `expected 403, got ${status} ${JSON.stringify(body)}`);
  }
  {
    const { status, body } = await req("/api/files?path=" + encodeURIComponent(os.homedir()));
    check("file manager lists an allowed root", status === 200 && Array.isArray(body.entries), `got ${status}`);
  }
  {
    const { status } = await req("/api/files?path=" + encodeURIComponent(os.homedir() + "/../../.."));
    check("traversal with .. is rejected", status === 403, `expected 403, got ${status}`);
  }

  /* ---- bad login throttling + wrong password ---- */
  {
    const saved = cookies; cookies = "";
    const { status } = await req("/api/auth/login", { method: "POST", json: { username: "admin", password: "wrong" } });
    check("wrong password is rejected", status === 401, `got ${status}`);
    cookies = saved;
  }

  /* ---- websocket origin check ---- */
  {
    const bad = await wsHandshake("/ws/metrics", { Origin: "http://evil.example.com", Cookie: cookies });
    check("WebSocket from a foreign Origin is refused", bad === 403, `expected 403, got ${bad}`);
  }
  {
    const good = await wsHandshake("/ws/metrics", { Origin: BASE, Cookie: cookies });
    check("WebSocket from same Origin is accepted", good === 101, `expected 101, got ${good}`);
  }
  {
    const anon = await wsHandshake("/ws/metrics", { Origin: BASE });
    check("WebSocket without a session is refused", anon === 401, `expected 401, got ${anon}`);
  }

  /* ---- app store ---- */
  {
    const { status, body } = await req("/api/store/status");
    const shaped = body && body.compose && body.docker && Array.isArray(body.libraries);
    check("store status reports compose/docker/libraries", status === 200 && shaped, JSON.stringify(body).slice(0, 140));
    check("CasaOS library is seeded on first boot", body.libraries.some(l => l.format === "casaos"), JSON.stringify(body.libraries));
  }
  {
    const { status, body } = await req("/api/store/apps");
    check("catalogue endpoint returns a valid shape", status === 200 && Array.isArray(body.apps) && Array.isArray(body.categories), JSON.stringify(body).slice(0, 120));
  }
  {
    const { status } = await req("/api/store/libraries", {
      method: "POST", json: { url: "not-a-url" }, headers: { "X-CSRF-Token": globalThis.CSRF }
    });
    check("library add rejects a non-http url", status === 400, `expected 400, got ${status}`);
  }
  {
    const { status } = await req("/api/store/libraries", {
      method: "POST", json: { url: "https://github.com/example/store.git" }
    });
    check("library add without CSRF is refused", status === 403, `expected 403, got ${status}`);
  }
  {
    const { status } = await req("/api/store/install-url", {
      method: "POST", json: { url: "https://example.com/not-a-repo" }, headers: { "X-CSRF-Token": globalThis.CSRF }
    });
    // 400 = rejected as not a GitHub repo, 503 = compose missing on this box.
    check("install-url rejects an unrecognised url", status === 400 || status === 503, `got ${status}`);
  }
  {
    const { status } = await req("/api/store/install-compose", {
      method: "POST", json: { name: "bad", composeText: "this: [is: not: valid" }, headers: { "X-CSRF-Token": globalThis.CSRF }
    });
    check("install rejects malformed YAML", status === 422 || status === 503, `expected 422/503, got ${status}`);
  }
  {
    const { status, body } = await req("/api/store/installed");
    check("installed list is empty on a fresh install", status === 200 && Array.isArray(body) && body.length === 0, JSON.stringify(body));
  }
  {
    const ws = await wsHandshake("/ws/events", { Origin: BASE, Cookie: cookies });
    check("events WebSocket accepts an authenticated same-origin client", ws === 101, `expected 101, got ${ws}`);
  }
  {
    const ws = await wsHandshake("/ws/events", { Origin: "http://evil.example.com", Cookie: cookies });
    check("events WebSocket refuses a foreign Origin", ws === 403, `expected 403, got ${ws}`);
  }

  /* ---- logout ---- */
  {
    const { status } = await req("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": globalThis.CSRF } });
    check("logout succeeds", status === 200, `got ${status}`);
    const after = await req("/api/system/info");
    check("session is dead after logout", after.status === 401, `expected 401, got ${after.status}`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail) { console.log("--- server log ---\n" + serverLog); }
  cleanup(fail ? 1 : 0);

} catch (err) {
  console.error("\n  self-check crashed:", err.message);
  console.log("--- server log ---\n" + serverLog);
  cleanup(1);
}

/** Raw HTTP upgrade so we can read the status code the server replies with. */
function wsHandshake(pathname, headers) {
  return new Promise(resolve => {
    const sock = net.connect(PORT, "127.0.0.1", () => {
      // Must decode to exactly 16 bytes or the ws library answers 400 before
      // our own checks ever run.
      const key = crypto.randomBytes(16).toString("base64");
      const lines = [
        `GET ${pathname} HTTP/1.1`,
        `Host: 127.0.0.1:${PORT}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
        "", ""
      ];
      sock.write(lines.join("\r\n"));
    });
    let buf = "";
    sock.on("data", d => {
      buf += d.toString();
      const m = /^HTTP\/1\.1 (\d{3})/.exec(buf);
      if (m) { sock.destroy(); resolve(Number(m[1])); }
    });
    sock.on("error", () => resolve(0));
    setTimeout(() => { sock.destroy(); resolve(0); }, 5000);
  });
}
