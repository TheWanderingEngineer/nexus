import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import cfg from "./config.js";

/**
 * Live data from the apps on the Apps page.
 *
 * Each supported app has an adapter that reads a few numbers and a short list
 * from that app's own API — download speed and what is downloading, what is
 * playing, the request queue — and returns them in one shape the page can draw
 * without knowing which app it came from:
 *
 *   { ok, at, ms, stats: [{ k, v, fmt, tone }], items: [{ t, s, p, eta, st }],
 *     itemsLabel, rate: { down, up }, hist: { down: [], up: [] }, error }
 *
 * Three rules hold everywhere here:
 *
 * 1. **Read only.** Nothing in this file changes anything in the app it talks
 *    to. Every request is a GET, or the login POST some apps need to get one.
 * 2. **Fetched on demand, never in the background.** A reading is taken when a
 *    browser asks for it and cached for a few seconds; nobody looking at the
 *    page means no requests at all. The speed history behind the sparkline is
 *    kept in memory only, like every other metric here.
 * 3. **Keys never travel to the browser.** API keys and passwords live in their
 *    own 0600 file beside the PINs, and the page is only ever told whether one
 *    is set.
 */

const SECRETS = path.join(cfg.dataDir, "integration-secrets.json");
const TIMEOUT = 5000;
const MAX_BODY = 4 * 1024 * 1024;
const HIST = 40;

/* ---------------- secrets ---------------- */

function readSecrets() {
  try { return JSON.parse(fs.readFileSync(SECRETS, "utf8")); } catch { return {}; }
}
function writeSecrets(all) {
  fs.mkdirSync(path.dirname(SECRETS), { recursive: true });
  fs.writeFileSync(SECRETS, JSON.stringify(all, null, 1), { mode: 0o600 });
  try { fs.chmodSync(SECRETS, 0o600); } catch {}
}
export const secretIds = () => new Set(Object.keys(readSecrets()));
export const secretOf = id => readSecrets()[id] || "";
export function setSecret(id, value) {
  const all = readSecrets();
  if (value) all[id] = String(value).slice(0, 400); else delete all[id];
  writeSecrets(all);
  sessions.delete(id);
  cache.delete(id);
}
export function pruneSecrets(liveIds) {
  const all = readSecrets();
  let changed = false;
  for (const id of Object.keys(all)) if (!liveIds.has(id)) { delete all[id]; changed = true; }
  if (changed) writeSecrets(all);
}

/* ---------------- HTTP ---------------- */

/**
 * One request. Self-signed certificates are accepted: almost every homelab
 * service that speaks HTTPS does it with one, and this only reads.
 */
function request(base, p, { method = "GET", headers = {}, body = null, auth = null } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(p, base.endsWith("/") ? base : base + "/"); } catch { return reject(new Error("bad address")); }
    // A path given as "/api/x" resolves against the host root, which loses a
    // reverse-proxy prefix like /sonarr. Keep the prefix.
    try {
      const b = new URL(base);
      const prefix = b.pathname.replace(/\/+$/, "");
      if (prefix && p.startsWith("/")) u = new URL(prefix + p, b.origin);
    } catch {}
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new Error("bad address"));
    const lib = u.protocol === "https:" ? https : http;
    const h = { "User-Agent": "Nexus/" + cfg.version, Accept: "application/json", ...headers };
    if (auth) h.Authorization = "Basic " + Buffer.from(auth).toString("base64");
    let data = null;
    if (body != null) {
      data = typeof body === "string" ? body : JSON.stringify(body);
      if (!h["Content-Type"]) h["Content-Type"] = typeof body === "string" ? "application/x-www-form-urlencoded" : "application/json";
      h["Content-Length"] = Buffer.byteLength(data);
    }
    const req = lib.request(u, { method, headers: h, timeout: TIMEOUT, rejectUnauthorized: false }, res => {
      const chunks = []; let size = 0;
      res.on("data", c => {
        size += c.length;
        if (size > MAX_BODY) { res.destroy(); reject(new Error("the answer was too large")); return; }
        chunks.push(c);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: res.statusCode || 0, headers: res.headers, text, json });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const fail = (msg, code) => Object.assign(new Error(msg), { code });

/** A JSON GET that must succeed. */
async function getJSON(ctx, p, opts = {}) {
  const r = await request(ctx.url, p, { headers: ctx.headers, auth: ctx.basic, ...opts, headers: { ...ctx.headers, ...(opts.headers || {}) } });
  if (r.status === 401 || r.status === 403) throw fail(ctx.secret ? "the key or password was refused" : "it wants a key or a login", "AUTH");
  if (r.status === 404) throw fail(`not found: ${p.split("?")[0]}`, "NOTFOUND");
  if (r.status >= 400) throw fail(`HTTP ${r.status}`, "HTTP");
  if (r.json == null) throw fail(`that does not look like ${ctx.label}`, "SHAPE");
  return r.json;
}
/** The same, but a failure is just "no number" rather than "no reading". */
const maybe = (ctx, p, opts) => getJSON(ctx, p, opts).catch(() => null);

function cookiesOf(res) {
  const sc = res.headers["set-cookie"];
  return (Array.isArray(sc) ? sc : sc ? [sc] : []).map(c => c.split(";")[0]).join("; ");
}

/* ---------------- helpers ---------------- */

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
/** Sonarr-style "1.02:03:04" or "02:03:04" to seconds. */
function spanSecs(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+)/);
  if (!m) return null;
  return (Number(m[1] || 0) * 86400) + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}
const stat = (k, v, fmt = "num", tone) => (v == null ? null : { k, v, fmt, ...(tone ? { tone } : {}) });
const clean = list => list.filter(Boolean);

/* Logins some apps hand back, kept per tile so a reading every few seconds is
   not a login every few seconds. Memory only. */
const sessions = new Map();

/* ---------------- adapters ---------------- */

const ARR_KEY_HINT = "Settings → General → Security → API Key";

function arr(api, include) {
  return async ctx => {
    ctx.headers["X-Api-Key"] = ctx.secret || "";
    const now = new Date(), week = new Date(Date.now() + 7 * 86400e3);
    const [queue, missing, cal, health] = await Promise.all([
      getJSON(ctx, `/api/${api}/queue?page=1&pageSize=6&${include}`),
      maybe(ctx, `/api/${api}/wanted/missing?page=1&pageSize=1&monitored=true`),
      maybe(ctx, `/api/${api}/calendar?start=${now.toISOString()}&end=${week.toISOString()}`),
      maybe(ctx, `/api/${api}/health`)
    ]);
    const recs = Array.isArray(queue) ? queue : (queue.records || []);
    const total = Array.isArray(queue) ? queue.length : num(queue.totalRecords);
    const issues = Array.isArray(health) ? health.filter(h => h.type === "error" || h.type === "warning") : null;
    const items = recs.slice(0, 5).map(q => {
      const ep = q.episode, se = q.series, mv = q.movie, al = q.album, ar = q.artist, bk = q.book, au = q.author;
      let t = q.title || "Unknown";
      if (se && ep) t = `${se.title} · S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber).padStart(2, "0")}`;
      else if (mv) t = mv.year ? `${mv.title} (${mv.year})` : mv.title;
      else if (ar && al) t = `${ar.artistName} · ${al.title}`;
      else if (au && bk) t = `${au.authorName} · ${bk.title}`;
      const size = num(q.size), left = num(q.sizeleft);
      const warn = q.trackedDownloadStatus === "warning" || q.trackedDownloadStatus === "error";
      return {
        t,
        s: warn ? (q.statusMessages?.[0]?.messages?.[0] || q.errorMessage || "needs attention") : (q.downloadClient || q.protocol || ""),
        p: size ? Math.max(0, Math.min(1, 1 - (left || 0) / size)) : null,
        eta: spanSecs(q.timeleft),
        st: warn ? "warn" : String(q.status || q.trackedDownloadState || "").toLowerCase()
      };
    });
    return {
      stats: clean([
        stat("Queue", total),
        stat("Missing", missing ? num(missing.totalRecords) : null, "num", missing?.totalRecords > 0 ? "warn" : undefined),
        stat("This week", Array.isArray(cal) ? cal.length : null),
        issues ? stat("Health", issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"}` : "OK", "text",
                      issues.some(i => i.type === "error") ? "crit" : issues.length ? "warn" : "ok") : null
      ]),
      itemsLabel: "Queue", items,
      notes: issues?.slice(0, 2).map(i => i.message) || []
    };
  };
}

const KINDS = {
  qbittorrent: {
    label: "qBittorrent", group: "Downloads", auth: "userpass", optionalAuth: true, ttl: 2000, rate: true,
    help: "The Web UI login (Tools → Options → Web UI). Leave it empty if Nexus is on a subnet qBittorrent lets in without one.",
    async read(ctx) {
      const call = p => request(ctx.url, p, { headers: { ...(sessions.get(ctx.id) ? { Cookie: sessions.get(ctx.id) } : {}) } });
      let r = await call("/api/v2/transfer/info");
      if ((r.status === 403 || r.status === 401) && ctx.user) {
        const login = await request(ctx.url, "/api/v2/auth/login", {
          method: "POST",
          headers: { Referer: new URL(ctx.url).origin, Origin: new URL(ctx.url).origin },
          body: `username=${encodeURIComponent(ctx.user)}&password=${encodeURIComponent(ctx.secret || "")}`
        });
        if (login.status >= 400 || /fail/i.test(login.text)) throw fail("qBittorrent refused the username or password", "AUTH");
        sessions.set(ctx.id, cookiesOf(login));
        r = await call("/api/v2/transfer/info");
      }
      if (r.status === 403 || r.status === 401) throw fail("qBittorrent wants a login", "AUTH");
      if (!r.json) throw fail("that does not look like qBittorrent", "SHAPE");
      const info = r.json;
      const dl = await call("/api/v2/torrents/info?filter=downloading&sort=dlspeed&reverse=true");
      const list = Array.isArray(dl.json) ? dl.json : [];
      const act = await call("/api/v2/torrents/info?filter=active");
      const active = Array.isArray(act.json) ? act.json.length : null;
      return {
        rate: { down: num(info.dl_info_speed) || 0, up: num(info.up_info_speed) || 0 },
        stats: clean([
          stat("Down", num(info.dl_info_speed), "rate"),
          stat("Up", num(info.up_info_speed), "rate"),
          stat("Downloading", list.length),
          stat("Active", active)
        ]),
        itemsLabel: "Downloading",
        items: list.slice(0, 5).map(t => ({
          t: t.name, s: t.dlspeed ? null : String(t.state || ""),
          p: num(t.progress), eta: t.eta > 0 && t.eta < 8640000 ? t.eta : null,
          st: /stalled|error|missing/i.test(t.state) ? "warn" : "down", speed: num(t.dlspeed)
        }))
      };
    }
  },

  transmission: {
    label: "Transmission", group: "Downloads", auth: "userpass", optionalAuth: true, ttl: 2000, rate: true,
    help: "Only if RPC authentication is turned on in Transmission.",
    async read(ctx) {
      const rpc = async body => {
        const send = () => request(ctx.url, "/transmission/rpc", {
          method: "POST", body, auth: ctx.basic,
          headers: sessions.get(ctx.id) ? { "X-Transmission-Session-Id": sessions.get(ctx.id) } : {}
        });
        let r = await send();
        if (r.status === 409) { sessions.set(ctx.id, r.headers["x-transmission-session-id"]); r = await send(); }
        if (r.status === 401) throw fail("Transmission refused the username or password", "AUTH");
        if (!r.json?.arguments) throw fail("that does not look like Transmission", "SHAPE");
        return r.json.arguments;
      };
      const s = await rpc({ method: "session-stats" });
      const t = await rpc({ method: "torrent-get", arguments: { fields: ["name", "percentDone", "rateDownload", "eta", "status", "error"] } });
      const dl = (t.torrents || []).filter(x => x.status === 4).sort((a, b) => b.rateDownload - a.rateDownload);
      return {
        rate: { down: num(s.downloadSpeed) || 0, up: num(s.uploadSpeed) || 0 },
        stats: clean([stat("Down", num(s.downloadSpeed), "rate"), stat("Up", num(s.uploadSpeed), "rate"),
                      stat("Downloading", dl.length), stat("Torrents", num(s.torrentCount))]),
        itemsLabel: "Downloading",
        items: dl.slice(0, 5).map(x => ({ t: x.name, p: num(x.percentDone), eta: x.eta > 0 ? x.eta : null,
                                           st: x.error ? "warn" : "down", speed: num(x.rateDownload) }))
      };
    }
  },

  sabnzbd: {
    label: "SABnzbd", group: "Downloads", auth: "key", ttl: 2000, rate: true,
    help: "Config → General → Security → API Key.",
    async read(ctx) {
      const j = await getJSON(ctx, `/api?mode=queue&output=json&limit=5&apikey=${encodeURIComponent(ctx.secret || "")}`);
      if (j.error) throw fail(String(j.error), "AUTH");
      const q = j.queue || {};
      const kb = Number(q.kbpersec) || 0;
      return {
        rate: { down: kb * 1024, up: 0 },
        stats: clean([stat("Down", kb * 1024, "rate"), stat("Queue", num(q.noofslots_total ?? q.noofslots)),
                      stat("Left", q.sizeleft || null, "text"), q.paused ? stat("State", "Paused", "text", "warn") : null]),
        itemsLabel: "Queue",
        items: (q.slots || []).slice(0, 5).map(s => ({ t: s.filename, p: num(s.percentage) / 100, eta: spanSecs(s.timeleft),
                                                      st: String(s.status || "").toLowerCase() }))
      };
    }
  },

  sonarr:  { label: "Sonarr",  group: "Media management", auth: "key", ttl: 15000, help: ARR_KEY_HINT, read: arr("v3", "includeSeries=true&includeEpisode=true") },
  radarr:  { label: "Radarr",  group: "Media management", auth: "key", ttl: 15000, help: ARR_KEY_HINT, read: arr("v3", "includeMovie=true") },
  lidarr:  { label: "Lidarr",  group: "Media management", auth: "key", ttl: 15000, help: ARR_KEY_HINT, read: arr("v1", "includeArtist=true&includeAlbum=true") },
  readarr: { label: "Readarr", group: "Media management", auth: "key", ttl: 15000, help: ARR_KEY_HINT, read: arr("v1", "includeAuthor=true&includeBook=true") },

  prowlarr: {
    label: "Prowlarr", group: "Media management", auth: "key", ttl: 30000, help: ARR_KEY_HINT,
    async read(ctx) {
      ctx.headers["X-Api-Key"] = ctx.secret || "";
      const [idx, status, health] = await Promise.all([
        getJSON(ctx, "/api/v1/indexer"), maybe(ctx, "/api/v1/indexerstatus"), maybe(ctx, "/api/v1/health")]);
      const list = Array.isArray(idx) ? idx : [];
      const failing = Array.isArray(status) ? status.filter(s => s.disabledTill && new Date(s.disabledTill) > new Date()) : [];
      const byId = new Map(list.map(i => [i.id, i.name]));
      return {
        stats: clean([stat("Indexers", list.filter(i => i.enable).length),
                      stat("Failing", failing.length, "num", failing.length ? "warn" : "ok"),
                      Array.isArray(health) ? stat("Health", health.length ? `${health.length} issue${health.length === 1 ? "" : "s"}` : "OK", "text", health.length ? "warn" : "ok") : null]),
        itemsLabel: failing.length ? "Failing" : "",
        items: failing.slice(0, 4).map(f => ({ t: byId.get(f.indexerId) || `Indexer ${f.indexerId}`, s: "disabled for now", st: "warn" }))
      };
    }
  },

  bazarr: {
    label: "Bazarr", group: "Media management", auth: "key", ttl: 30000, help: "Settings → General → Security → API Key.",
    async read(ctx) {
      ctx.headers["X-API-KEY"] = ctx.secret || "";
      const b = await getJSON(ctx, "/api/badges");
      return { stats: clean([
        stat("Episodes", num(b.episodes), "num", b.episodes > 0 ? "warn" : undefined),
        stat("Movies", num(b.movies), "num", b.movies > 0 ? "warn" : undefined),
        stat("Providers", num(b.providers) ? `${b.providers} throttled` : "OK", "text", b.providers > 0 ? "warn" : "ok"),
        b.status ? stat("Health", `${b.status} issue${b.status === 1 ? "" : "s"}`, "text", "warn") : null
      ]), caption: "Wanting subtitles", items: [] };
    }
  },

  jellyfin: {
    label: "Jellyfin", group: "Media", auth: "key", ttl: 5000, help: "Dashboard → API Keys → +.",
    read: mediaBrowser
  },
  emby: {
    label: "Emby", group: "Media", auth: "key", ttl: 5000, help: "Settings → Advanced → API Keys.",
    read: mediaBrowser
  },

  plex: {
    label: "Plex", group: "Media", auth: "key", ttl: 5000, keyLabel: "Plex token",
    help: "Your X-Plex-Token — Plex's support pages explain how to find it.",
    async read(ctx) {
      ctx.headers["X-Plex-Token"] = ctx.secret || "";
      const [s, lib] = await Promise.all([getJSON(ctx, "/status/sessions"), maybe(ctx, "/library/sections")]);
      const list = s.MediaContainer?.Metadata || [];
      return {
        stats: clean([stat("Streaming", list.length, "num", list.length ? "accent" : undefined),
                      stat("Libraries", lib?.MediaContainer?.size ?? null)]),
        itemsLabel: "Now playing",
        items: list.slice(0, 5).map(m => ({
          t: m.grandparentTitle ? `${m.grandparentTitle} · ${m.title}` : m.title,
          s: [m.User?.title, m.Player?.title].filter(Boolean).join(" · "),
          p: m.duration ? num(m.viewOffset) / m.duration : null,
          st: m.Player?.state === "paused" ? "paused" : "play"
        }))
      };
    }
  },

  jellyseerr: { label: "Jellyseerr", group: "Media", auth: "key", ttl: 20000, help: "Settings → General → API Key.", read: seerr },
  overseerr:  { label: "Overseerr",  group: "Media", auth: "key", ttl: 20000, help: "Settings → General → API Key.", read: seerr },

  immich: {
    label: "Immich", group: "Media", auth: "key", ttl: 60000, help: "Account settings → API Keys. Statistics need an admin's key.",
    async read(ctx) {
      ctx.headers["x-api-key"] = ctx.secret || "";
      const st = await getJSON(ctx, "/api/server/statistics").catch(e => {
        if (e.code === "NOTFOUND") return getJSON(ctx, "/api/server-info/statistics");
        throw e;
      });
      const disk = await maybe(ctx, "/api/server/storage");
      return { stats: clean([
        stat("Photos", num(st.photos)), stat("Videos", num(st.videos)),
        stat("Library", num(st.usage), "bytes"),
        disk ? stat("Disk", Math.round(num(disk.diskUsagePercentage) || 0) + "%", "text",
                    disk.diskUsagePercentage > 90 ? "crit" : disk.diskUsagePercentage > 80 ? "warn" : undefined) : null
      ]), items: [] };
    }
  },

  kavita: {
    label: "Kavita", group: "Media", auth: "key", ttl: 120000, help: "User settings → 3rd party clients → API key.",
    async read(ctx) {
      let token = sessions.get(ctx.id);
      const login = async () => {
        const r = await request(ctx.url, `/api/Plugin/authenticate?apiKey=${encodeURIComponent(ctx.secret || "")}&pluginName=Nexus`, { method: "POST", body: "" });
        if (r.status >= 400 || !r.json?.token) throw fail("Kavita refused the API key", "AUTH");
        sessions.set(ctx.id, r.json.token);
        return r.json.token;
      };
      if (!token) token = await login();
      let s = await request(ctx.url, "/api/Stats/server/stats", { headers: { Authorization: "Bearer " + token } });
      if (s.status === 401) { token = await login(); s = await request(ctx.url, "/api/Stats/server/stats", { headers: { Authorization: "Bearer " + token } }); }
      if (!s.json) throw fail(s.status === 403 ? "statistics need an admin's key" : "that does not look like Kavita", "SHAPE");
      const j = s.json;
      return { stats: clean([stat("Series", num(j.seriesCount)), stat("Volumes", num(j.volumeCount)),
                             stat("Files", num(j.totalFiles)), stat("Size", num(j.totalSize), "bytes")]), items: [] };
    }
  },

  npm: {
    label: "Nginx Proxy Manager", group: "Network", auth: "userpass", ttl: 60000, userLabel: "Email",
    help: "The email and password you sign in to Nginx Proxy Manager with.",
    async read(ctx) {
      const auth = async () => {
        const r = await request(ctx.url, "/api/tokens", { method: "POST", body: { identity: ctx.user, secret: ctx.secret || "" } });
        if (!r.json?.token) throw fail("Nginx Proxy Manager refused the email or password", "AUTH");
        sessions.set(ctx.id, r.json.token);
        return r.json.token;
      };
      let token = sessions.get(ctx.id) || await auth();
      const get = p => request(ctx.url, p, { headers: { Authorization: "Bearer " + token } });
      let hosts = await get("/api/reports/hosts");
      if (hosts.status === 401) { token = await auth(); hosts = await get("/api/reports/hosts"); }
      if (!hosts.json) throw fail("that does not look like Nginx Proxy Manager", "SHAPE");
      const certs = (await get("/api/nginx/certificates")).json;
      const soon = Array.isArray(certs)
        ? certs.map(c => ({ name: c.nice_name || (c.domain_names || [])[0], days: Math.floor((new Date(c.expires_on) - Date.now()) / 86400e3) }))
               .filter(c => Number.isFinite(c.days)).sort((a, b) => a.days - b.days)
        : [];
      const expiring = soon.filter(c => c.days < 14);
      return {
        stats: clean([stat("Proxy hosts", num(hosts.json.proxy)), stat("Streams", num(hosts.json.stream)),
                      stat("Certificates", Array.isArray(certs) ? certs.length : null),
                      stat("Expiring", expiring.length, "num", expiring.some(c => c.days < 3) ? "crit" : expiring.length ? "warn" : "ok")]),
        itemsLabel: "Certificates",
        items: soon.slice(0, 3).map(c => ({ t: c.name, s: c.days < 0 ? "expired" : `${c.days} day${c.days === 1 ? "" : "s"} left`,
                                            st: c.days < 3 ? "crit" : c.days < 14 ? "warn" : "ok" }))
      };
    }
  },

  pihole: {
    label: "Pi-hole", group: "Network", auth: "pass", optionalAuth: true, ttl: 15000, keyLabel: "Password or API token",
    help: "Pi-hole 6: the web password, or an app password. Pi-hole 5: Settings → API → Show API token.",
    async read(ctx) {
      // Pi-hole 6 first. A session is a limited seat on Pi-hole, so the one
      // we get is kept and reused rather than taken afresh every reading.
      const v6 = async () => {
        const call = () => request(ctx.url, "/api/stats/summary", { headers: sessions.get(ctx.id) ? { "X-FTL-SID": sessions.get(ctx.id) } : {} });
        let r = await call();
        if (r.status === 401) {
          const a = await request(ctx.url, "/api/auth", { method: "POST", body: { password: ctx.secret || "" } });
          if (!a.json?.session?.valid) throw fail("Pi-hole refused the password", "AUTH");
          sessions.set(ctx.id, a.json.session.sid);
          r = await call();
        }
        return r;
      };
      const r = await v6();
      if (r.status === 200 && r.json?.queries) {
        const q = r.json.queries;
        const blk = await request(ctx.url, "/api/dns/blocking", { headers: { "X-FTL-SID": sessions.get(ctx.id) || "" } }).catch(() => null);
        const on = blk?.json?.blocking;
        return { stats: clean([stat("Queries", num(q.total)), stat("Blocked", num(q.blocked)),
                               stat("Blocked %", (num(q.percent_blocked) || 0).toFixed(1) + "%", "text"),
                               on ? stat("Blocking", on === "enabled" ? "On" : "Off", "text", on === "enabled" ? "ok" : "warn") : null]), items: [] };
      }
      const v5 = await getJSON(ctx, `/admin/api.php?summaryRaw&auth=${encodeURIComponent(ctx.secret || "")}`);
      if (Array.isArray(v5) || v5.dns_queries_today == null) throw fail("Pi-hole refused the API token", "AUTH");
      return { stats: clean([stat("Queries", num(v5.dns_queries_today)), stat("Blocked", num(v5.ads_blocked_today)),
                             stat("Blocked %", (num(v5.ads_percentage_today) || 0).toFixed(1) + "%", "text"),
                             stat("Blocking", v5.status === "enabled" ? "On" : "Off", "text", v5.status === "enabled" ? "ok" : "warn")]), items: [] };
    }
  },

  adguard: {
    label: "AdGuard Home", group: "Network", auth: "userpass", ttl: 15000, help: "The login you use for the AdGuard Home web page.",
    async read(ctx) {
      const [s, st] = await Promise.all([getJSON(ctx, "/control/stats"), maybe(ctx, "/control/status")]);
      const total = num(s.num_dns_queries) || 0, blocked = num(s.num_blocked_filtering) || 0;
      return { stats: clean([stat("Queries", total), stat("Blocked", blocked),
                             stat("Blocked %", (total ? blocked / total * 100 : 0).toFixed(1) + "%", "text"),
                             st ? stat("Protection", st.protection_enabled ? "On" : "Off", "text", st.protection_enabled ? "ok" : "warn") : null]), items: [] };
    }
  },

  crafty: {
    label: "Crafty Controller", group: "Games", auth: "key", ttl: 10000, keyLabel: "API token",
    help: "Panel config → Users → your user → API Keys. Give it access to the servers.",
    async read(ctx) {
      ctx.headers.Authorization = "Bearer " + (ctx.secret || "");
      const list = await getJSON(ctx, "/api/v2/servers");
      const servers = (list.data || []).slice(0, 6);
      const stats = await Promise.all(servers.map(s => maybe(ctx, `/api/v2/servers/${encodeURIComponent(s.server_id)}/stats`)));
      const rows = servers.map((s, i) => ({ s, d: stats[i]?.data || {} }));
      const running = rows.filter(r => r.d.running).length;
      const players = rows.reduce((n, r) => n + (num(r.d.online) || 0), 0);
      return {
        stats: clean([stat("Running", `${running}/${servers.length}`, "text", running ? "ok" : undefined), stat("Players", players, "num", players ? "accent" : undefined)]),
        itemsLabel: "Servers",
        items: rows.map(({ s, d }) => ({ t: s.server_name, s: d.running ? `${d.online || 0}/${d.max || 0} players${d.version ? " · " + d.version : ""}` : "stopped",
                                          st: d.running ? "ok" : "off" }))
      };
    }
  }
};

async function mediaBrowser(ctx) {
  ctx.headers["X-Emby-Token"] = ctx.secret || "";
  const [sess, counts] = await Promise.all([getJSON(ctx, "/Sessions?activeWithinSeconds=960"), maybe(ctx, "/Items/Counts")]);
  const playing = (Array.isArray(sess) ? sess : []).filter(s => s.NowPlayingItem);
  return {
    stats: clean([
      stat("Streaming", playing.length, "num", playing.length ? "accent" : undefined),
      counts ? stat("Movies", num(counts.MovieCount)) : null,
      counts ? stat("Shows", num(counts.SeriesCount)) : null,
      counts ? stat("Episodes", num(counts.EpisodeCount)) : null
    ]),
    itemsLabel: "Now playing",
    items: playing.slice(0, 5).map(s => {
      const it = s.NowPlayingItem, ps = s.PlayState || {};
      return {
        t: it.SeriesName ? `${it.SeriesName} · ${it.Name}` : it.Name,
        s: [s.UserName, s.DeviceName, ps.PlayMethod === "Transcode" ? "transcoding" : null].filter(Boolean).join(" · "),
        p: it.RunTimeTicks ? (num(ps.PositionTicks) || 0) / it.RunTimeTicks : null,
        st: ps.IsPaused ? "paused" : "play"
      };
    })
  };
}

async function seerr(ctx) {
  ctx.headers["X-Api-Key"] = ctx.secret || "";
  const [c, issues] = await Promise.all([getJSON(ctx, "/api/v1/request/count"), maybe(ctx, "/api/v1/issue/count")]);
  return { stats: clean([
    stat("Pending", num(c.pending), "num", c.pending > 0 ? "accent" : undefined),
    stat("Processing", num(c.processing)),
    stat("Available", num(c.available)),
    issues ? stat("Open issues", num(issues.open), "num", issues.open > 0 ? "warn" : undefined) : null
  ]), caption: "Requests", items: [] };
}

/* ---------------- guessing the kind ---------------- */

const GUESS = [
  [/qbit/, "qbittorrent"], [/transmission/, "transmission"], [/sabnzbd/, "sabnzbd"],
  [/sonarr/, "sonarr"], [/radarr/, "radarr"], [/lidarr/, "lidarr"], [/readarr/, "readarr"],
  [/prowlarr/, "prowlarr"], [/bazarr/, "bazarr"], [/jellyseerr/, "jellyseerr"], [/overseerr/, "overseerr"],
  [/jellyfin/, "jellyfin"], [/emby/, "emby"], [/plex/, "plex"], [/immich/, "immich"], [/kavita/, "kavita"],
  [/nginx.?proxy|^npm$/, "npm"], [/pi.?hole/, "pihole"], [/adguard/, "adguard"], [/crafty/, "crafty"]
];
export function guess(app) {
  const hay = [app.icon, app.name].filter(Boolean).join(" ").toLowerCase();
  for (const [re, k] of GUESS) if (re.test(hay)) return k;
  return "";
}

/** What the editor needs to draw the form. No functions, no secrets. */
export function kinds() {
  return Object.entries(KINDS).map(([id, k]) => ({
    id, label: k.label, group: k.group, auth: k.auth, optionalAuth: !!k.optionalAuth,
    keyLabel: k.keyLabel || (k.auth === "pass" ? "Password" : "API key"), userLabel: k.userLabel || "Username",
    help: k.help || "", rate: !!k.rate
  }));
}
export const isKind = k => Object.prototype.hasOwnProperty.call(KINDS, k);

/** The stored settings for one tile, cleaned. The secret is not part of it. */
export function sanitizeLive(v) {
  if (!v || typeof v !== "object") return undefined;
  const kind = isKind(v.kind) ? v.kind : "";
  if (!kind) return undefined;
  let url = "";
  if (typeof v.url === "string" && v.url.trim()) {
    try { const u = new URL(v.url.trim()); if (u.protocol === "http:" || u.protocol === "https:") url = u.toString(); } catch {}
  }
  return { kind, on: v.on !== false, url, user: typeof v.user === "string" ? v.user.slice(0, 120) : "" };
}

/* ---------------- reading ---------------- */

const cache = new Map();     // id -> { at, sig, result, pending }
const hist = new Map();      // id -> { down: [], up: [], at }

function humanError(e, label) {
  const c = e.code || "";
  if (c === "ECONNREFUSED") return `${label} refused the connection — is it running?`;
  if (c === "ETIMEDOUT" || c === "ESOCKETTIMEDOUT") return `no answer from ${label} in ${TIMEOUT / 1000} s`;
  if (c === "ENOTFOUND" || c === "EAI_AGAIN") return "that address does not resolve";
  if (c === "EHOSTUNREACH" || c === "ENETUNREACH") return "that host cannot be reached from here";
  if (c === "ECONNRESET") return `${label} closed the connection`;
  return e.message || "could not read it";
}

/**
 * Take one reading for a tile. `conf` is the tile's live settings plus the
 * address to use; `secret` comes from the secrets file or, for a test, from
 * the form.
 */
export async function read(id, conf, secret) {
  const k = KINDS[conf.kind];
  if (!k) return { ok: false, error: "not a supported app", at: Date.now() };
  const url = conf.url || conf.appUrl;
  if (!url) return { ok: false, error: "the app has no local address to read from", at: Date.now() };
  const ctx = {
    id, url, label: k.label, user: conf.user || "", secret: secret || "", headers: {},
    basic: (k.auth === "userpass" && conf.user) ? `${conf.user}:${secret || ""}` : null
  };
  const t0 = Date.now();
  try {
    const out = await k.read(ctx);
    const res = { ok: true, at: Date.now(), ms: Date.now() - t0, kind: conf.kind, ...out };
    if (k.rate && out.rate) {
      const h = hist.get(id) || { down: [], up: [], at: 0 };
      if (Date.now() - h.at > 1500) {
        h.down.push(Math.round(out.rate.down)); h.up.push(Math.round(out.rate.up)); h.at = Date.now();
        if (h.down.length > HIST) { h.down.shift(); h.up.shift(); }
        hist.set(id, h);
      }
      res.hist = { down: h.down.slice(), up: h.up.slice() };
    }
    return res;
  } catch (e) {
    return { ok: false, at: Date.now(), ms: Date.now() - t0, kind: conf.kind, error: humanError(e, k.label), auth: e.code === "AUTH" };
  }
}

/** A cached reading: fresh enough for this kind, and one request in flight at a time. */
export function cached(app) {
  const conf = { ...app.live, appUrl: app.url };
  const k = KINDS[conf.kind];
  const sig = JSON.stringify([conf.kind, conf.url, conf.user, app.url]);
  const c = cache.get(app.id);
  if (c && c.sig === sig) {
    if (c.pending) return c.pending;
    if (Date.now() - c.at < (k?.ttl || 10000)) return Promise.resolve(c.result);
  }
  const secret = readSecrets()[app.id];
  const pending = read(app.id, conf, secret).then(result => {
    cache.set(app.id, { at: Date.now(), sig, result, pending: null });
    return result;
  });
  cache.set(app.id, { ...(c || {}), sig, pending, at: c?.at || 0 });
  return pending;
}

/** Forget a tile's session, cache and history — its settings changed. */
export function reset(id) { sessions.delete(id); cache.delete(id); hist.delete(id); }

/** Short lines for Kernel's briefing: only what is happening right now. */
export function summaryLines(apps) {
  const out = [];
  for (const a of apps) {
    const c = cache.get(a.id)?.result;
    if (!c?.ok || Date.now() - c.at > 120000) continue;
    const human = n => { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; n = Number(n) || 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return `${n >= 100 || !i ? n.toFixed(0) : n.toFixed(1)} ${u[i]}`; };
    const bits = (c.stats || []).slice(0, 4).map(s => `${s.k} ${s.fmt === "rate" ? human(s.v) + "/s" : s.fmt === "bytes" ? human(s.v) : s.v}`);
    out.push(`${a.name}: ${bits.join(", ")}`);
  }
  return out;
}
