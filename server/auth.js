import crypto from "node:crypto";
import cfg from "./config.js";
import { db, save, audit, clientIp } from "./store.js";

/**
 * Authentication.
 *
 * scrypt rather than argon2id — argon2 needs a native module, and keeping the
 * dependency tree compiler-free is a hard requirement for deploying to a bare
 * Ubuntu box. scrypt is in Node's standard library and is a memory-hard KDF in
 * the same family; the parameters below are well above the Node defaults.
 */

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };

/**
 * scrypt's working set is roughly 128 * N * r bytes — at N=2^15, r=8 that is
 * exactly 32 MiB, which is also Node's *default* maxmem ceiling, so the call
 * throws "memory limit exceeded" unless we raise it explicitly. Give it double
 * the requirement and the parameters stay strong without tripping the guard.
 */
const maxmemFor = (N, r) => 128 * N * r * 2;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: maxmemFor(SCRYPT.N, SCRYPT.r)
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(keyB64, "base64");
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: +N, r: +r, p: +p, maxmem: maxmemFor(+N, +r)
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ---------------- sessions ---------------- */

const SESSION_COOKIE = "nexus_sid";
const CSRF_COOKIE = "nexus_csrf";

export function createSession(user, req) {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrf = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const s = {
    token, csrf,
    userId: user.id,
    createdAt: now,
    expiresAt: now + cfg.sessionHours * 3600_000,
    lastSeenAt: now,
    ip: clientIp(req),
    ua: String(req.headers["user-agent"] || "").slice(0, 200)
  };
  db().sessions.push(s);
  pruneSessions();
  save();
  return s;
}

export function pruneSessions() {
  const now = Date.now();
  const d = db();
  d.sessions = d.sessions.filter(s => s.expiresAt > now);
}

export function findSession(token) {
  if (!token) return null;
  const s = db().sessions.find(x => x.token === token);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) return null;
  return s;
}

export function destroySession(token) {
  const d = db();
  const before = d.sessions.length;
  d.sessions = d.sessions.filter(s => s.token !== token);
  if (d.sessions.length !== before) save();
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecureRequest(req) {
  if (req.socket?.encrypted) return true;
  const remote = req.socket?.remoteAddress || "";
  if (cfg.trustedProxies.some(p => remote.includes(p)) && req.headers["x-forwarded-proto"] === "https") return true;
  return false;
}

export function setSessionCookies(req, res, session) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  const maxAge = Math.floor((session.expiresAt - Date.now()) / 1000);
  res.append("Set-Cookie",
    `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
  // Readable by JS on purpose: this is the double-submit half of CSRF protection.
  res.append("Set-Cookie",
    `${CSRF_COOKIE}=${session.csrf}; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

export function clearSessionCookies(res) {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.append("Set-Cookie", `${CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0`);
}

/** Attaches req.session / req.user when a valid cookie is present. Never rejects. */
export function attachUser(req, _res, next) {
  const cookies = parseCookies(req);
  const s = findSession(cookies[SESSION_COOKIE]);
  if (s) {
    const u = db().users.find(x => x.id === s.userId);
    if (u) {
      s.lastSeenAt = Date.now();
      req.session = s;
      req.user = u;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "not authenticated" });
  next();
}

/**
 * Double-submit CSRF. The browser sends the token both as a cookie (set above)
 * and as a header the page had to read with JS — a cross-origin page can cause
 * the cookie to be sent but cannot read it to set the header.
 */
export function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!req.session) return res.status(401).json({ error: "not authenticated" });
  const sent = req.headers["x-csrf-token"];
  if (!sent || sent !== req.session.csrf) {
    return res.status(403).json({ error: "bad or missing CSRF token" });
  }
  next();
}

/* ---------------- login throttling ---------------- */

const attempts = new Map();   // ip -> { n, until }

export function loginAllowed(ip) {
  const a = attempts.get(ip);
  if (!a) return { ok: true };
  if (a.until && Date.now() < a.until) {
    return { ok: false, retryAfter: Math.ceil((a.until - Date.now()) / 1000) };
  }
  return { ok: true };
}

export function noteLoginFailure(ip) {
  const a = attempts.get(ip) || { n: 0, until: 0 };
  a.n += 1;
  // 5 free tries, then exponential backoff capped at 15 minutes.
  if (a.n > 5) a.until = Date.now() + Math.min(2 ** (a.n - 5) * 1000, 900_000);
  attempts.set(ip, a);
}

export function noteLoginSuccess(ip) { attempts.delete(ip); }

/* ---------------- WebSocket origin check ---------------- */

/**
 * The single most important check in the codebase.
 *
 * Browsers do NOT apply the same-origin policy or CORS to WebSocket handshakes.
 * Without this, any page you visit while logged in could open ws://your-box/ws/terminal
 * — with your cookies attached — and get a root shell. Same-origin by default;
 * extra origins only if explicitly configured.
 */
export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;              // non-browser client (CLI, curl); no ambient cookies to abuse
  if (cfg.allowedOrigins.includes(origin)) return true;

  const host = req.headers.host;
  if (!host) return false;
  try {
    const u = new URL(origin);
    return u.host === host;
  } catch {
    return false;
  }
}

export function sessionFromUpgrade(req) {
  const cookies = parseCookies(req);
  const s = findSession(cookies[SESSION_COOKIE]);
  if (!s) return null;
  const u = db().users.find(x => x.id === s.userId);
  return u ? { session: s, user: u } : null;
}

export { SESSION_COOKIE, CSRF_COOKIE, parseCookies, audit };
