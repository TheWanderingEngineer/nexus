/* Nexus — frontend
   No framework, no build step. Loaded directly by the browser and served by the
   Go... sorry, by the Node process from /web. Everything here talks to /api. */
(function () {
"use strict";

/* ============================ tiny helpers ============================ */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/* Bind only if the element exists. Without this a single renamed id in the
   HTML throws at module scope and takes the whole dashboard down with it —
   which is exactly what happened once during development. */
const on = (sel, ev, fn, opts) => {
  const el = typeof sel === "string" ? $(sel) : sel;
  if (el) el.addEventListener(ev, fn, opts);
  else console.warn("[nexus] no element for", sel);
  return el;
};
const ICON = n => `/assets/brand/icons/ui-${n}.png`;

let CSRF = null;

function toast(msg, kind) {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = msg;
  $("#toast").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function api(pathname, opts = {}) {
  const o = { method: "GET", headers: {}, credentials: "same-origin", ...opts };
  if (o.body !== undefined && !(o.body instanceof Blob) && typeof o.body !== "string") {
    o.body = JSON.stringify(o.body);
    o.headers["Content-Type"] = "application/json";
  }
  if (CSRF && o.method !== "GET") o.headers["X-CSRF-Token"] = CSRF;

  const res = await fetch("/api" + pathname, o);
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText || "request failed");
    err.status = res.status;
    if (res.status === 401) showGate();
    throw err;
  }
  return data;
}

function bytes(n) {
  if (n == null) return "--";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)) + " " + u[i];
}
function rate(n) { return bytes(n) + "/s"; }
function since(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
function upfmt(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================ auth gate ============================ */
let needsSetup = false;

function showGate() { $("#gate").hidden = false; $("#app").hidden = true; }
function hideGate() { $("#gate").hidden = true; $("#app").hidden = false; }

async function boot() {
  try {
    const st = await fetch("/api/setup/status").then(r => r.json());
    needsSetup = !!st.needsSetup;
  } catch { /* server unreachable; the form will report it */ }

  if (needsSetup) {
    $("#gate-title").textContent = "NEXUS — FIRST RUN";
    $("#gate-msg").textContent = "No account exists yet. Create your admin user.";
    $("#g-submit").textContent = "CREATE ACCOUNT";
    $("#g-confirm-wrap").hidden = false;
    $("#g-pass").setAttribute("autocomplete", "new-password");
    showGate();
    return;
  }

  try {
    const me = await api("/auth/me");
    CSRF = me.csrf;
    hideGate();
    start();
  } catch {
    showGate();
  }
}

on("#gate-form", "submit", async e => {
  e.preventDefault();
  const err = $("#gate-err");
  err.textContent = "";
  const username = $("#g-user").value.trim();
  const password = $("#g-pass").value;

  if (needsSetup) {
    if (password.length < 8) { err.textContent = "PASSWORD MUST BE AT LEAST 8 CHARACTERS"; return; }
    if (password !== $("#g-confirm").value) { err.textContent = "PASSWORDS DO NOT MATCH"; return; }
  }

  $("#g-submit").disabled = true;
  try {
    const out = await api(needsSetup ? "/setup" : "/auth/login", { method: "POST", body: { username, password } });
    CSRF = out.csrf;
    needsSetup = false;
    $("#g-pass").value = ""; $("#g-confirm").value = "";
    hideGate();
    start();
  } catch (ex) {
    err.textContent = String(ex.message || "SIGN IN FAILED").toUpperCase();
  } finally {
    $("#g-submit").disabled = false;
  }
});

on("#logout", "click", async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  location.reload();
});

/* ============================ live state ============================ */
const LIVE = {
  cpu: 0, mem: 0, net: { rx: 0, tx: 0 }, uptimeSec: 0,
  sensors: [], history: { cpu: [], mem: [], rx: [], tx: [] },
  info: null, disks: [], containers: [], installed: []
};

let ws = null, wsRetry = 0;

function connectWS() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws/metrics`);

  ws.onopen = () => { wsRetry = 0; $("#st-state").innerHTML = '<i class="dot live" style="color:var(--ok)"></i><span>LIVE</span>'; };
  ws.onmessage = ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type !== "metrics") return;
    Object.assign(LIVE, {
      cpu: msg.data.cpu, mem: msg.data.mem, net: msg.data.net,
      uptimeSec: msg.data.uptimeSec, sensors: msg.data.sensors || [], history: msg.data.history || LIVE.history
    });
    paintTopbar();
    renderWidgets();
  };
  ws.onclose = () => {
    $("#st-state").innerHTML = '<i class="dot" style="color:var(--crit)"></i><span>OFFLINE</span>';
    wsRetry = Math.min(wsRetry + 1, 6);
    setTimeout(connectWS, 500 * 2 ** wsRetry);
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function paintTopbar() {
  $("#tb-cpu").textContent = Math.round(LIVE.cpu) + "%";
  $("#tb-mem").textContent = Math.round(LIVE.mem) + "%";
  const t = LIVE.sensors.find(s => s.kind === "temperature");
  $("#tb-temp").textContent = t ? Math.round(t.value) + "°C" : "n/a";
}

setInterval(() => {
  const n = new Date();
  $("#clock").textContent = [n.getHours(), n.getMinutes(), n.getSeconds()].map(x => String(x).padStart(2, "0")).join(":");
}, 1000);

/* ============================ charts ============================ */
function stepPath(vals, w, h, maxV) {
  if (!vals.length) return "";
  const n = vals.length, sw = w / Math.max(1, n - 1);
  let d = "";
  for (let i = 0; i < n; i++) {
    const y = Math.round(h - (clamp(vals[i], 0, maxV) / maxV) * (h - 2)) - 1;
    const x = Math.round(i * sw);
    d += i === 0 ? `M${x},${y}` : `H${x}V${y}`;
  }
  return d;
}
function drawChart(svg, vals, maxV, color) {
  const w = 120, h = 40;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("shape-rendering", "crispEdges");
  const line = stepPath(vals, w, h, maxV || 1);
  svg.innerHTML = line
    ? `<path d="${line} V${h} H0 Z" fill="${color}" fill-opacity="0.16"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2"/>`
    : "";
}
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function meterHTML(pct, warnAt, critAt, segs) {
  segs = segs || 14;
  const on = Math.round((clamp(pct, 0, 100) / 100) * segs);
  let h = "";
  for (let i = 0; i < segs; i++) {
    const p = ((i + 1) / segs) * 100;
    h += `<i class="${i < on ? (p >= critAt ? "crit" : p >= warnAt ? "warn" : "on") : ""}"></i>`;
  }
  return h;
}

/* ============================ widget registry ============================ */
const REG = {
  cpu: { name: "CPU", icon: ICON("cpu"), desc: "Load with stepped history", w: 4, h: 4,
    mount(b) { b.innerHTML = '<div class="big"><span class="n">--</span><span class="u">%</span></div><svg class="chart"></svg><span class="sub"></span>';
      return { n: $(".n", b), svg: $("svg", b), sub: $(".sub", b) }; },
    update(r) { r.n.textContent = Math.round(LIVE.cpu);
      drawChart(r.svg, LIVE.history.cpu, 100, cssv("--accent"));
      const t = LIVE.sensors.find(s => s.kind === "temperature");
      r.sub.textContent = `${LIVE.info?.cpu?.cores || "?"} cores${t ? " · " + Math.round(t.value) + "°C" : ""}`; } },

  memory: { name: "Memory", icon: ICON("memory"), desc: "RAM in use", w: 4, h: 3,
    mount(b) { b.innerHTML = '<div class="big"><span class="n">--</span><span class="u">%</span></div><div class="meter inset"></div><span class="sub"></span>';
      return { n: $(".n", b), m: $(".meter", b), sub: $(".sub", b) }; },
    update(r) { r.n.textContent = Math.round(LIVE.mem);
      r.m.innerHTML = meterHTML(LIVE.mem, 75, 90);
      r.sub.textContent = "live"; } },

  storage: { name: "Storage", icon: ICON("storage"), desc: "Usage per mount point", w: 4, h: 4,
    mount(b) { b.innerHTML = '<ul class="klist"></ul>'; return { l: $("ul", b) }; },
    update(r) {
      if (!LIVE.disks.length) { r.l.innerHTML = '<li><span class="k">loading…</span></li>'; return; }
      r.l.innerHTML = LIVE.disks.slice(0, 4).map(d => {
        const col = d.usage >= 90 ? "var(--crit)" : d.usage >= 80 ? "var(--warn)" : "var(--text)";
        return `<li><span class="k">${esc(d.mount)}</span><span class="v" style="color:${col}">${d.usage}% · ${bytes(d.available)} free</span></li>
                <li><span class="meter inset" style="width:100%">${meterHTML(d.usage, 80, 90, 18)}</span></li>`;
      }).join(""); } },

  network: { name: "Network", icon: ICON("network"), desc: "Throughput in and out", w: 4, h: 4,
    mount(b) { b.innerHTML = '<div class="big"><span class="n">--</span><span class="u">↓</span></div><svg class="chart"></svg><span class="sub"></span>';
      return { n: $(".n", b), svg: $("svg", b), sub: $(".sub", b) }; },
    update(r) {
      r.n.textContent = rate(LIVE.net.rx).replace("/s", "");
      const max = Math.max(1024, ...(LIVE.history.rx || [0]));
      drawChart(r.svg, LIVE.history.rx, max, cssv("--accent-2"));
      r.sub.textContent = `↑ ${rate(LIVE.net.tx)}`; } },

  sensors: { name: "Sensors", icon: ICON("temp"), desc: "Temperatures and fans", w: 4, h: 4,
    mount(b) { b.innerHTML = '<ul class="klist"></ul>'; return { l: $("ul", b) }; },
    update(r) {
      if (!LIVE.sensors.length) { r.l.innerHTML = '<li><span class="k">no sensors detected</span></li>'; return; }
      r.l.innerHTML = LIVE.sensors.slice(0, 8).map(s => {
        const lim = s.critical || s.max;
        const col = lim && s.value >= lim * 0.92 ? "var(--crit)" : lim && s.value >= lim * 0.8 ? "var(--warn)" : "var(--text)";
        return `<li><span class="k">${esc(s.label)}</span><span class="v" style="color:${col}">${s.value}${s.unit}</span></li>`;
      }).join(""); } },

  containers: { name: "Containers", icon: ICON("containers"), desc: "Running services", w: 4, h: 4,
    mount(b) { b.innerHTML = '<ul class="klist"></ul>'; return { l: $("ul", b) }; },
    update(r) {
      if (!LIVE.containers.length) { r.l.innerHTML = '<li><span class="k">no containers</span></li>'; return; }
      r.l.innerHTML = LIVE.containers.slice(0, 8).map(c => {
        const up = c.state === "running";
        return `<li><span class="k" style="color:${up ? "var(--ok)" : "var(--crit)"}">${up ? "▶" : "■"} ${esc(c.name)}</span>
                <span class="v">${esc(c.state)}</span></li>`;
      }).join(""); } },

  uptime: { name: "Uptime", icon: ICON("power"), desc: "Time since last boot", w: 3, h: 2,
    mount(b) { b.innerHTML = '<div class="big"><span class="n" style="font-size:22px">--</span></div><span class="sub">since last boot</span>';
      return { n: $(".n", b) }; },
    update(r) { r.n.textContent = upfmt(LIVE.uptimeSec); } },

  clock: { name: "Clock", icon: ICON("home"), desc: "Big pixel clock", w: 3, h: 3,
    mount(b) { b.style.containerType = "inline-size";
      b.innerHTML = '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:6px"><div class="clockbig"></div><div class="sub" style="text-align:center"></div></div>';
      return { c: $(".clockbig", b), d: $(".sub", b) }; },
    update(r) { const n = new Date();
      r.c.textContent = String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0");
      r.d.textContent = n.toDateString().toUpperCase(); } },

  cat: { name: "Server Cat", icon: "/assets/brand/cat-sleeping.png", desc: "Sleeps when idle, stirs when busy", w: 3, h: 4,
    mount(b) { b.innerHTML = '<div class="catwrap"><img class="catimg" src="/assets/brand/cat-sleeping.png" alt="cat"><span class="catmsg"></span></div>';
      return { i: $("img", b), m: $(".catmsg", b) }; },
    update(r) {
      const hot = LIVE.cpu > 72, busy = LIVE.cpu > 45;
      r.m.textContent = hot ? "!! TOO WARM TO NAP" : busy ? "ONE EYE OPEN" : "ZZZ... ALL QUIET";
      r.i.style.filter = hot ? "hue-rotate(-25deg) saturate(1.4)" : "none";
      r.i.style.animationDuration = hot ? "0.9s" : busy ? "2s" : "3.2s"; } },

  host: { name: "Host", icon: ICON("home"), desc: "Machine identity", w: 4, h: 3,
    mount(b) { b.innerHTML = '<ul class="klist"></ul>'; return { l: $("ul", b) }; },
    update(r) {
      const i = LIVE.info;
      if (!i) { r.l.innerHTML = '<li><span class="k">loading…</span></li>'; return; }
      r.l.innerHTML = [
        ["Host", i.host?.hostname], ["OS", i.host?.distro],
        ["Kernel", i.host?.kernel], ["Arch", i.host?.arch]
      ].filter(x => x[1]).map(([k, v]) => `<li><span class="k">${k}</span><span class="v">${esc(v)}</span></li>`).join(""); } }
};

/* ============================ grid engine ============================ */
const COLS = 12, ROW = 44, GAP = 8;
const gridEl = $("#grid"), emptyEl = $("#grid-empty");
let items = [], mounted = {}, uid = 1, saveTimer = null;

const DEFAULT_LAYOUT = [
  { t: "cpu", x: 0, y: 0, w: 4, h: 4 }, { t: "memory", x: 4, y: 0, w: 4, h: 3 },
  { t: "cat", x: 8, y: 0, w: 4, h: 4 }, { t: "network", x: 4, y: 3, w: 4, h: 4 },
  { t: "sensors", x: 0, y: 4, w: 4, h: 4 }, { t: "containers", x: 8, y: 4, w: 4, h: 4 },
  { t: "storage", x: 0, y: 8, w: 4, h: 4 }, { t: "host", x: 4, y: 7, w: 4, h: 3 },
  { t: "uptime", x: 8, y: 8, w: 4, h: 2 }
];

const cellW = () => (gridEl.clientWidth - (COLS - 1) * GAP) / COLS;
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function resolve(movedId) {
  let guard = 0, moved = true;
  while (moved && guard++ < 300) {
    moved = false;
    for (const a of items) for (const b of items) {
      if (a === b || b.id === movedId) continue;
      if (overlap(a, b) && (a.id === movedId || a.y < b.y || (a.y === b.y && a.x < b.x))) { b.y = a.y + a.h; moved = true; }
    }
  }
}
function compact() {
  items.slice().sort((p, q) => p.y - q.y || p.x - q.x).forEach(it => {
    while (it.y > 0) { it.y--; if (items.some(o => o !== it && overlap(it, o))) { it.y++; break; } }
  });
}
function place(el, it) {
  const cw = cellW();
  el.style.left = Math.round(it.x * (cw + GAP)) + "px";
  el.style.top = Math.round(it.y * (ROW + GAP)) + "px";
  el.style.width = Math.round(it.w * cw + (it.w - 1) * GAP) + "px";
  el.style.height = Math.round(it.h * ROW + (it.h - 1) * GAP) + "px";
}
/** Below this width the 12-column canvas stops making sense: a 3-column widget
 *  would be ~90px. Phones get a single stacked column instead, ordered by the
 *  same y/x the desktop layout uses, so the arrangement still feels like yours. */
const NARROW_AT = 640;
const isNarrow = () => gridEl.clientWidth > 0 && gridEl.clientWidth < NARROW_AT;

function layout(persist = true) {
  const narrow = isNarrow();
  gridEl.classList.toggle("stack", narrow);

  if (narrow) {
    // Static flow: DOM order is visual order, so sort the nodes themselves.
    items.slice().sort((a, b) => a.y - b.y || a.x - b.x).forEach(it => {
      const el = document.getElementById("w" + it.id);
      if (!el) return;
      el.style.left = el.style.top = el.style.width = "";
      el.style.height = Math.max(140, it.h * ROW + (it.h - 1) * GAP) + "px";
      gridEl.appendChild(el);           // re-append = move to the end, in order
    });
    gridEl.style.height = "";
  } else {
    items.forEach(it => { const el = document.getElementById("w" + it.id); if (el) place(el, it); });
    gridEl.style.height = items.reduce((m, i) => Math.max(m, i.y + i.h), 0) * (ROW + GAP) + "px";
  }

  emptyEl.hidden = items.length > 0;
  if (persist) saveLayout();
}
function saveLayout() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { api("/layout", { method: "PUT", body: { widgets: items } }).catch(() => {}); }, 500);
}

function build(it, animate) {
  const def = REG[it.t];
  if (!def) return;
  const el = document.createElement("div");
  el.className = "w" + (animate ? " spawn" : "");
  el.id = "w" + it.id;
  el.innerHTML = `<div class="w-head"><img src="${def.icon}" alt=""><span class="t">${esc(def.name.toUpperCase())}</span><button class="w-x" title="Remove">X</button></div><div class="w-body"></div><div class="w-rs"></div>`;
  gridEl.appendChild(el);
  mounted[it.id] = { def, ref: def.mount($(".w-body", el)) };
  $(".w-x", el).addEventListener("click", e => { e.stopPropagation(); removeWidget(it.id); });
  dragify(el, it); resizify(el, it);
  place(el, it);
  try { def.update(mounted[it.id].ref); } catch {}
}
function removeWidget(id) {
  const el = document.getElementById("w" + id);
  if (el) el.remove();
  items = items.filter(i => i.id !== id);
  delete mounted[id];
  compact(); layout();
}
function addWidget(type) {
  const maxY = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  const d = REG[type];
  const it = { id: uid++, t: type, x: 0, y: maxY, w: d.w, h: d.h };
  items.push(it); build(it, true); compact(); layout();
  $("#main").scrollTo({ top: 1e6, behavior: "smooth" });
}
function renderWidgets() {
  for (const id in mounted) { try { mounted[id].def.update(mounted[id].ref); } catch {} }
}

function dragify(el, it) {
  const head = $(".w-head", el);
  head.addEventListener("pointerdown", e => {
    if (e.target.closest(".w-x")) return;
    e.preventDefault();
    head.setPointerCapture(e.pointerId);
    const cw = cellW(), sx = e.clientX, sy = e.clientY, ox = it.x, oy = it.y;
    el.classList.add("dragging");
    const mv = ev => {
      const nx = clamp(ox + Math.round((ev.clientX - sx) / (cw + GAP)), 0, COLS - it.w);
      const ny = Math.max(0, oy + Math.round((ev.clientY - sy) / (ROW + GAP)));
      if (nx !== it.x || ny !== it.y) { it.x = nx; it.y = ny; resolve(it.id); layout(false); }
      place(el, it);
    };
    const up = () => {
      head.releasePointerCapture(e.pointerId);
      head.removeEventListener("pointermove", mv); head.removeEventListener("pointerup", up); head.removeEventListener("pointercancel", up);
      el.classList.remove("dragging"); compact(); layout();
    };
    head.addEventListener("pointermove", mv); head.addEventListener("pointerup", up); head.addEventListener("pointercancel", up);
  });
}
function resizify(el, it) {
  const h = $(".w-rs", el);
  h.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    h.setPointerCapture(e.pointerId);
    const cw = cellW(), sx = e.clientX, sy = e.clientY, ow = it.w, oh = it.h;
    el.classList.add("resizing");
    const mv = ev => {
      const nw = clamp(ow + Math.round((ev.clientX - sx) / (cw + GAP)), 2, COLS - it.x);
      const nh = Math.max(2, oh + Math.round((ev.clientY - sy) / (ROW + GAP)));
      if (nw !== it.w || nh !== it.h) { it.w = nw; it.h = nh; resolve(it.id); layout(false); }
      place(el, it);
    };
    const up = () => {
      h.releasePointerCapture(e.pointerId);
      h.removeEventListener("pointermove", mv); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up);
      el.classList.remove("resizing"); compact(); layout();
    };
    h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
  });
}

/* ============================ pages ============================ */
async function loadContainers() {
  const box = $("#c-status"), tb = $("#c-table tbody");
  try {
    const out = await api("/docker/containers");
    if (!out.available) {
      box.innerHTML = `<div class="empty">DOCKER UNAVAILABLE — ${esc(out.reason || "")}</div>`;
      $("#c-table").hidden = true;
      LIVE.containers = [];
      return;
    }
    box.innerHTML = ""; $("#c-table").hidden = false;
    LIVE.containers = out.containers;
    tb.innerHTML = out.containers.map(c => {
      const up = c.state === "running";
      const ports = c.ports.map(p => p.public + "→" + p.private).join(", ") || "—";
      return `<tr>
        <td class="name">${esc(c.title || c.name)}</td>
        <td class="mono">${esc(c.image)}</td>
        <td><span class="pill ${up ? "ok" : "crit"}"><i class="dot"></i>${esc(c.state.toUpperCase())}</span></td>
        <td class="mono">${esc(ports)}</td>
        <td><span class="pill idle">${esc((c.managedBy || "manual").toUpperCase())}</span></td>
        <td><div class="rowbtns">
          <button class="btn sm" data-act="${up ? "stop" : "start"}" data-id="${esc(c.id)}">${up ? "STOP" : "START"}</button>
          <button class="btn sm" data-act="restart" data-id="${esc(c.id)}">RESTART</button>
        </div></td></tr>`;
    }).join("") || `<tr><td colspan="6" class="empty">NO CONTAINERS</td></tr>`;
  } catch (e) {
    box.innerHTML = `<div class="empty">${esc(e.message).toUpperCase()}</div>`;
  }
}
on("#c-table", "click", async e => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  b.disabled = true;
  try {
    await api(`/docker/containers/${encodeURIComponent(b.dataset.id)}/${b.dataset.act}`, { method: "POST" });
    toast(b.dataset.act.toUpperCase() + " OK", "ok");
    setTimeout(loadContainers, 700);
  } catch (ex) { toast(ex.message.toUpperCase(), "err"); b.disabled = false; }
});
on("#c-refresh", "click", loadContainers);

let curDir = null;
async function loadFiles(dir) {
  const tb = $("#f-table tbody");
  try {
    const out = await api("/files" + (dir ? "?path=" + encodeURIComponent(dir) : ""));
    curDir = out.path;
    $("#f-crumbs").innerHTML = `<span class="mono">${esc(out.path)}</span>`;
    tb.innerHTML = out.entries.map(en => `<tr>
      <td class="name"><span class="fname"><i class="ic ${en.dir ? "" : "file"}"></i>
        ${en.dir ? `<button data-dir="${esc(en.path)}">${esc(en.name)}/</button>` : esc(en.name)}</span></td>
      <td class="mono">${en.dir ? "—" : bytes(en.size)}</td>
      <td class="mono">${en.mtime ? since(en.mtime) : "—"}</td>
      <td><div class="rowbtns">
        ${en.dir ? "" : `<a class="btn sm" href="/api/files/download?path=${encodeURIComponent(en.path)}">GET</a>`}
        <button class="btn sm danger" data-del="${esc(en.path)}">DEL</button>
      </div></td></tr>`).join("") || `<tr><td colspan="4" class="empty">EMPTY DIRECTORY</td></tr>`;
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="4" class="empty">${esc(e.message).toUpperCase()}</td></tr>`;
  }
}
on("#f-table", "click", async e => {
  const d = e.target.closest("button[data-dir]");
  if (d) return loadFiles(d.dataset.dir);
  const del = e.target.closest("button[data-del]");
  if (del) {
    if (!confirm("Delete " + del.dataset.del + " ?")) return;
    try { await api("/files/delete", { method: "POST", body: { path: del.dataset.del } }); toast("DELETED", "ok"); loadFiles(curDir); }
    catch (ex) { toast(ex.message.toUpperCase(), "err"); }
  }
});
on("#f-up", "click", async () => {
  if (!curDir) return;
  try { const out = await api("/files?path=" + encodeURIComponent(curDir)); if (out.parent) loadFiles(out.parent); else toast("AT ROOT", "err"); }
  catch (ex) { toast(ex.message.toUpperCase(), "err"); }
});
on("#f-mkdir", "click", async () => {
  const name = prompt("New folder name:");
  if (!name) return;
  try { await api("/files/mkdir", { method: "POST", body: { path: curDir + "/" + name } }); toast("CREATED", "ok"); loadFiles(curDir); }
  catch (ex) { toast(ex.message.toUpperCase(), "err"); }
});

/* ============================ terminal (xterm.js) ============================ */
let term = null, fit = null, termWS = null, termReady = false;

function termTheme() {
  // Pull the palette straight from the CSS tokens so the terminal follows the
  // theme toggle instead of being a separate hard-coded colour scheme.
  const v = n => cssv(n) || undefined;
  const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme:dark)").matches);
  return {
    background: dark ? "#0D0916" : "#1C1528",
    foreground: dark ? "#C9C2DE" : "#E8E2F5",
    cursor: v("--accent"), cursorAccent: "#0D0916",
    selectionBackground: "rgba(199,125,255,.35)",
    black: "#0D0916", red: "#FF4D5E", green: "#5CE68A", yellow: "#FFC145",
    blue: "#7DA2FF", magenta: "#C77DFF", cyan: "#4EE1E8", white: "#C9C2DE",
    brightBlack: "#6E6291", brightRed: "#FF7A87", brightGreen: "#86F0A9",
    brightYellow: "#FFD37A", brightBlue: "#A6C0FF", brightMagenta: "#DCA6FF",
    brightCyan: "#8CF0F5", brightWhite: "#F2EEFA"
  };
}

function ensureTerm() {
  if (term) return term;
  if (typeof Terminal === "undefined") { toast("TERMINAL LIBRARY FAILED TO LOAD", "err"); return null; }

  term = new Terminal({
    fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: true,
    cursorStyle: "block",
    scrollback: 5000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    theme: termTheme()
  });

  try { fit = new FitAddon.FitAddon(); term.loadAddon(fit); } catch { fit = null; }
  try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch {}

  term.open($("#xterm-host"));
  term.onData(d => { if (termWS?.readyState === 1) termWS.send(d); });

  // Resize is debounced: xterm fires per-frame during a window drag and each one
  // would otherwise become a control frame and an ioctl on the pty.
  let rt = null;
  term.onResize(({ cols, rows }) => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (termWS?.readyState === 1) termWS.send(JSON.stringify({ type: "resize", cols, rows }));
    }, 80);
  });

  return term;
}

function fitTerm() {
  if (!fit) return;
  try { fit.fit(); } catch {}
}

function connectTerminal() {
  if (!ensureTerm()) return;
  if (termWS && termWS.readyState <= 1) return;

  const state = $("#term-state");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  termWS = new WebSocket(`${proto}//${location.host}/ws/terminal`);
  termWS.binaryType = "arraybuffer";

  termWS.onopen = () => {
    termReady = true;
    state.className = "pill ok";
    state.innerHTML = '<i class="dot live"></i>CONNECTED';
    requestAnimationFrame(() => {
      fitTerm();
      termWS.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      term.focus();
    });
  };
  termWS.onmessage = ev => {
    term.write(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data));
  };
  termWS.onclose = () => {
    termReady = false;
    state.className = "pill crit";
    state.innerHTML = '<i class="dot"></i>DISCONNECTED';
    term.write("\r\n\x1b[90m[session closed — press NEW SESSION to reconnect]\x1b[0m\r\n");
  };
  termWS.onerror = () => {
    state.className = "pill crit";
    state.innerHTML = '<i class="dot"></i>ERROR';
  };
}

function newTerminalSession() {
  if (termWS) { try { termWS.close(); } catch {} termWS = null; }
  if (term) term.reset();
  connectTerminal();
}

on("#t-new", "click", newTerminalSession);
on("#t-clear", "click", () => { if (term) term.clear(); });
addEventListener("resize", () => { if (term && $("#page-term").classList.contains("on")) fitTerm(); });

async function loadSettings() {
  const i = LIVE.info || (LIVE.info = await api("/system/info").catch(() => null));
  if (!i) return;
  $("#s-system").innerHTML = [
    ["HOSTNAME", i.host?.hostname], ["OS", i.host?.distro], ["KERNEL", i.host?.kernel],
    ["ARCH", i.host?.arch], ["CPU", i.cpu?.model], ["CORES", i.cpu?.cores],
    ["DATA DIR", i.config?.dataDir], ["CONFIG", i.config?.loadedFrom || "defaults"]
  ].filter(x => x[1] != null).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");

  $("#s-services").innerHTML = [
    ["DOCKER", i.docker?.available ? "connected" : "unavailable — " + (i.docker?.reason || "")],
    ["TERMINAL", i.terminal?.enabled ? "enabled (" + i.terminal.shell + ")" : "disabled"],
    ["SESSIONS", String(i.terminal?.active ?? 0)],
    ["FILE ROOTS", (i.fileRoots || []).map(r => r.path).join(", ") || "none"],
    ["SENSORS", i.simulated ? "simulated (non-Linux host)" : "reading /sys"]
  ].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");

  try {
    const sm = await api("/system/smart");
    $("#s-smart").innerHTML = sm.length
      ? `<div class="tw"><table><thead><tr><th>Device</th><th>Model</th><th>Health</th><th>Temp</th><th>Hours</th></tr></thead><tbody>` +
        sm.map(d => `<tr><td class="mono">${esc(d.device)}</td><td>${esc(d.model || "—")}</td>
          <td>${d.error ? `<span class="pill idle">${esc(d.error)}</span>` : `<span class="pill ${d.passed ? "ok" : "crit"}"><i class="dot"></i>${d.passed ? "PASSED" : "FAILED"}</span>`}</td>
          <td class="mono">${d.temperature != null ? d.temperature + "°C" : "—"}</td>
          <td class="mono">${d.powerOnHours ?? "—"}</td></tr>`).join("") + "</tbody></table></div>"
      : `<div class="empty">NO SMART DATA — needs smartmontools on Linux</div>`;
  } catch { $("#s-smart").innerHTML = `<div class="empty">SMART UNAVAILABLE</div>`; }

  try {
    const a = await api("/audit?limit=40");
    $("#s-audit tbody").innerHTML = a.map(e => `<tr>
      <td class="mono">${esc(new Date(e.ts).toLocaleString())}</td>
      <td class="name">${esc(e.action)}</td><td>${esc(e.user || "—")}</td>
      <td class="mono">${esc(e.detail ? JSON.stringify(e.detail) : "—")}</td></tr>`).join("")
      || `<tr><td colspan="4" class="empty">NO ACTIVITY YET</td></tr>`;
  } catch {}
}

/* ============================ modal ============================ */
const modal = $("#modal");
function openModal({ title, icon, body, foot }) {
  $("#mw-title").textContent = title;
  $("#mw-icon").src = icon || "/assets/brand/icons/ui-apps.png";
  $("#mw-body").innerHTML = "";
  $("#mw-foot").innerHTML = "";
  if (typeof body === "string") $("#mw-body").innerHTML = body; else if (body) $("#mw-body").appendChild(body);
  if (typeof foot === "string") $("#mw-foot").innerHTML = foot; else if (foot) $("#mw-foot").appendChild(foot);
  modal.classList.add("open");
}
function closeModal() { modal.classList.remove("open"); }
on("#mw-close", "click", closeModal);
modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
addEventListener("keydown", e => { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); });

/* ============================ app store ============================ */
const ST = { q: "", category: "", offset: 0, limit: 60, total: 0, loading: false, status: null };

async function loadStoreStatus() {
  try {
    ST.status = await api("/store/status");
    const warn = $("#st-warn");
    const bits = [];
    if (!ST.status.docker.available) bits.push(`<div class="warnbox err"><b>Docker is unavailable</b> — ${esc(ST.status.docker.reason)}. Browsing works, installing does not.</div>`);
    else if (!ST.status.compose.available) bits.push(`<div class="warnbox err"><b>docker compose not found</b> — install the Compose plugin to enable app installs.</div>`);
    const unsynced = ST.status.libraries.filter(l => !l.lastSyncAt);
    if (unsynced.length && !(db_catalogCount())) {
      bits.push(`<div class="warnbox"><b>The catalogue is empty.</b> Sync a library to populate it — the CasaOS store is already added, it just needs its first sync (a one-off clone of a few hundred MB). <button class="btn sm" id="st-sync-now">SYNC NOW</button></div>`);
    }
    warn.innerHTML = bits.join("");
    const b = $("#st-sync-now");
    if (b) b.addEventListener("click", () => syncLibrary(unsynced[0].id));
  } catch {}
}
let _catalogCount = 0;
const db_catalogCount = () => _catalogCount;

async function loadStore(reset = true) {
  if (ST.loading) return;
  ST.loading = true;
  if (reset) { ST.offset = 0; $("#st-grid").innerHTML = '<div class="empty">LOADING…</div>'; }
  try {
    const out = await api(`/store/apps?q=${encodeURIComponent(ST.q)}&category=${encodeURIComponent(ST.category)}&limit=${ST.limit}&offset=${ST.offset}`);
    ST.total = out.total;
    _catalogCount = out.total;

    const cat = $("#st-cat");
    if (cat.options.length <= 1 && out.categories.length) {
      out.categories.forEach(c => { const o = document.createElement("option"); o.value = c; o.textContent = c; cat.appendChild(o); });
    }

    if (reset) $("#st-grid").innerHTML = "";
    if (!out.apps.length && reset) {
      $("#st-grid").innerHTML = `<div class="empty">${ST.q ? "NO MATCHES" : "CATALOGUE EMPTY — SYNC A LIBRARY"}</div>`;
    }
    for (const a of out.apps) $("#st-grid").appendChild(appCard(a));

    $("#st-count").textContent = out.total ? `${out.total} app${out.total === 1 ? "" : "s"}` : "";
    $("#st-more").hidden = ST.offset + ST.limit >= out.total;
  } catch (e) {
    $("#st-grid").innerHTML = `<div class="empty">${esc(e.message).toUpperCase()}</div>`;
  } finally { ST.loading = false; }
}

function appCard(a) {
  const el = document.createElement("button");
  el.className = "appcard";
  const installed = (LIVE.installed || []).some(i => i.slug === a.slug);
  el.innerHTML = `
    <div class="top">
      ${a.icon ? `<img class="ico" src="${esc(a.icon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
               : `<span class="ico"></span>`}
      <span style="min-width:0">
        <span class="nm">${esc(a.name)}</span>
        <span class="tg">${esc(a.tagline || a.description || "")}</span>
      </span>
    </div>
    <div class="meta">
      <span class="pill idle">${esc(a.category || "APP")}</span>
      ${installed ? '<span class="pill ok"><i class="dot"></i>INSTALLED</span>' : ""}
    </div>`;
  el.addEventListener("click", () => openAppDetail(a));
  return el;
}

async function openAppDetail(a) {
  openModal({ title: a.name.toUpperCase(), icon: a.icon || undefined, body: `<p>Loading…</p>` });
  let full = a;
  try { full = await api(`/store/apps/${encodeURIComponent(a.libraryId)}/${encodeURIComponent(a.slug)}`); } catch {}

  const params = full.params || [];
  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:16px";
  body.innerHTML = `
    <div class="applead">
      ${full.icon ? `<img src="${esc(full.icon)}" alt="" onerror="this.style.visibility='hidden'">` : `<img src="/assets/brand/icons/ui-apps.png" alt="">`}
      <div style="min-width:0">
        <span class="t">${esc(full.name)}</span>
        <p>${esc(full.tagline || "")}</p>
        <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <span class="pill idle">${esc(full.category || "APP")}</span>
          ${full.developer ? `<span class="pill idle">${esc(full.developer)}</span>` : ""}
          ${full.image ? `<span class="pill idle">${esc(String(full.image).split(":")[0])}</span>` : ""}
        </div>
      </div>
    </div>
    ${full.description ? `<div><h3>ABOUT</h3><p>${esc(full.description).slice(0, 1200)}</p></div>` : ""}
    ${params.length ? `<div><h3>SETTINGS</h3><div id="ap-params" style="display:flex;flex-direction:column;gap:12px"></div></div>` : ""}
    ${full.compose ? `<div><h3>COMPOSE</h3><div class="joblog"><pre>${esc(full.compose.slice(0, 4000))}</pre></div></div>` : ""}
  `;

  if (params.length) {
    const wrap = body.querySelector("#ap-params");
    params.forEach(p => {
      const f = document.createElement("div");
      f.className = "field";
      f.innerHTML = `<label for="p-${esc(p.key)}">${esc(p.label || p.key)}</label>
                     <input id="p-${esc(p.key)}" type="text" value="${esc(p.default ?? "")}" data-key="${esc(p.key)}">`;
      wrap.appendChild(f);
    });
  }

  const installed = (LIVE.installed || []).some(i => i.slug === full.slug);
  const foot = document.createElement("div");
  foot.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
  foot.innerHTML = installed
    ? `<button class="btn danger" id="ap-remove">UNINSTALL</button><button class="btn" id="ap-cancel">CLOSE</button>`
    : `<button class="btn" id="ap-cancel">CANCEL</button><button class="btn primary" id="ap-install">INSTALL</button>`;

  openModal({ title: full.name.toUpperCase(), icon: full.icon || undefined, body, foot });

  $("#ap-cancel")?.addEventListener("click", closeModal);
  $("#ap-install")?.addEventListener("click", () => {
    const p = {};
    $$("#ap-params input").forEach(i => { p[i.dataset.key] = i.value; });
    doInstall({ libraryId: full.libraryId, slug: full.slug, params: p, name: full.name });
  });
  $("#ap-remove")?.addEventListener("click", () => doUninstall(full.slug, full.name));
}

/* ---- install with live job output ---- */
function jobModal(title) {
  const body = document.createElement("div");
  body.innerHTML = `<div class="joblog" id="job-log"><pre></pre></div>`;
  const foot = document.createElement("div");
  foot.innerHTML = `<button class="btn" id="job-close">CLOSE</button>`;
  openModal({ title, body, foot });
  on("#job-close", "click", closeModal);
  return $("#job-log pre");
}

const activeJobs = new Map();

async function doInstall(opts, force = false) {
  const pre = jobModal(`INSTALLING ${opts.name.toUpperCase()}`);
  const write = (t, cls) => {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = t + "\n";
    pre.appendChild(s);
    pre.parentElement.scrollTop = pre.parentElement.scrollHeight;
  };
  write("preparing…");
  try {
    const body = opts.url
      ? { url: opts.url, name: opts.name, force }
      : opts.composeText
        ? { name: opts.name, composeText: opts.composeText, force }
        : { libraryId: opts.libraryId, slug: opts.slug, params: opts.params || {}, force };
    const path = opts.url ? "/store/install-url" : opts.composeText ? "/store/install-compose" : "/store/install";
    const out = await api(path, { method: "POST", body });
    activeJobs.set(String(out.jobId), write);
    write(`job ${out.jobId} started`);
  } catch (e) {
    if (e.status === 409) {
      write(e.message, "errl");
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "INSTALL ANYWAY";
      btn.addEventListener("click", () => doInstall(opts, true));
      $("#mw-foot").prepend(btn);
    } else {
      write(e.message, "errl");
    }
  }
}

async function doUninstall(slug, name) {
  const keep = confirm(`Remove ${name}?\n\nOK = remove containers, keep data volumes.\nCancel = abort.`);
  if (!keep) return;
  const pre = jobModal(`REMOVING ${name.toUpperCase()}`);
  const write = (t, cls) => {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = t + "\n"; pre.appendChild(s);
    pre.parentElement.scrollTop = pre.parentElement.scrollHeight;
  };
  try {
    const out = await api(`/store/installed/${encodeURIComponent(slug)}`, { method: "DELETE" });
    activeJobs.set(String(out.jobId), write);
  } catch (e) { write(e.message, "errl"); }
}

/* ---- events socket: install/uninstall progress ---- */
let evtWS = null, evtRetry = 0;
function connectEvents() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  evtWS = new WebSocket(`${proto}//${location.host}/ws/events`);
  evtWS.onopen = () => { evtRetry = 0; };
  evtWS.onmessage = ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type !== "job") return;
    const d = msg.data;
    const write = activeJobs.get(String(d.id));
    if (write) {
      if (d.line) write(d.line, d.status === "error" ? "errl" : d.done ? "okl" : "");
      if (d.done) {
        activeJobs.delete(String(d.id));
        refreshInstalled();
        if (d.status === "success") toast("DONE", "ok"); else toast("FAILED", "err");
      }
    }
  };
  evtWS.onclose = () => { evtRetry = Math.min(evtRetry + 1, 6); setTimeout(connectEvents, 500 * 2 ** evtRetry); };
  evtWS.onerror = () => { try { evtWS.close(); } catch {} };
}

async function refreshInstalled() {
  try { LIVE.installed = await api("/store/installed"); } catch { LIVE.installed = []; }
}

/* ---- libraries ---- */
async function syncLibrary(id) {
  toast("SYNCING — THIS MAY TAKE A MINUTE");
  try {
    const out = await api(`/store/libraries/${encodeURIComponent(id)}/sync`, { method: "POST" });
    toast(`INDEXED ${out.apps} APPS`, "ok");
    await loadStoreStatus();
    loadStore(true);
  } catch (e) { toast(e.message.toUpperCase(), "err"); }
}

async function openLibraries() {
  const libs = await api("/store/libraries").catch(() => []);
  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:12px";
  body.innerHTML = `
    <p>A library is a git repository of app definitions. CasaOS-format stores work as-is.</p>
    <div id="lib-list" style="display:flex;flex-direction:column;gap:8px"></div>
    <div class="field">
      <label for="lib-url">ADD A LIBRARY (GIT URL)</label>
      <input id="lib-url" type="text" placeholder="https://github.com/owner/repo.git" spellcheck="false">
    </div>`;
  const list = body.querySelector("#lib-list");
  libs.forEach(l => {
    const row = document.createElement("div");
    row.className = "libitem";
    row.innerHTML = `
      <span class="ln">${esc(l.name)}</span>
      <span class="pill idle">${esc(l.format.toUpperCase())}</span>
      <span class="pill ${l.lastSyncAt ? "ok" : "warn"}">${l.lastSyncAt ? l.appCount + " APPS" : "NOT SYNCED"}</span>
      <button class="btn sm" data-sync="${esc(l.id)}">SYNC</button>
      <button class="btn sm danger" data-del="${esc(l.id)}">REMOVE</button>
      <span class="lu">${esc(l.url)}</span>
      ${l.lastSyncError ? `<span class="lu" style="color:var(--crit)">${esc(l.lastSyncError)}</span>` : ""}`;
    list.appendChild(row);
  });

  const foot = document.createElement("div");
  foot.innerHTML = `<button class="btn" id="lib-cancel">CLOSE</button><button class="btn primary" id="lib-add">ADD LIBRARY</button>`;
  openModal({ title: "APP LIBRARIES", body, foot });

  on("#lib-cancel", "click", closeModal);
  on("#lib-add", "click", async () => {
    const url = $("#lib-url").value.trim();
    if (!url) return;
    try { await api("/store/libraries", { method: "POST", body: { url } }); toast("ADDED — NOW SYNC IT", "ok"); openLibraries(); }
    catch (e) { toast(e.message.toUpperCase(), "err"); }
  });
  list.addEventListener("click", async e => {
    const s = e.target.closest("[data-sync]"), d = e.target.closest("[data-del]");
    if (s) { closeModal(); return syncLibrary(s.dataset.sync); }
    if (d) {
      if (!confirm("Remove this library and its indexed apps?")) return;
      try { await api(`/store/libraries/${encodeURIComponent(d.dataset.del)}`, { method: "DELETE" }); openLibraries(); loadStore(true); }
      catch (ex) { toast(ex.message.toUpperCase(), "err"); }
    }
  });
}

/* ---- install from GitHub / raw compose ---- */
function openGitHubInstall() {
  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:16px";
  body.innerHTML = `
    <div class="field">
      <label for="gh-url">GITHUB REPO OR COMPOSE URL</label>
      <input id="gh-url" type="text" spellcheck="false"
             placeholder="https://github.com/owner/repo">
      <span class="fh">A repo with docker-compose.yml at its root, a /blob/ link to one, or a raw .yml URL.</span>
    </div>
    <div class="field">
      <label for="gh-name">APP NAME (OPTIONAL)</label>
      <input id="gh-name" type="text" spellcheck="false" placeholder="derived from the repo name">
    </div>
    <div class="field">
      <label for="gh-compose">…OR PASTE A COMPOSE FILE DIRECTLY</label>
      <textarea id="gh-compose" spellcheck="false" placeholder="services:&#10;  app:&#10;    image: nginx&#10;    ports: [&quot;8081:80&quot;]"></textarea>
    </div>
    <div class="warnbox"><b>This runs third-party containers as root.</b> Only install from sources you trust.</div>`;
  const foot = document.createElement("div");
  foot.innerHTML = `<button class="btn" id="gh-cancel">CANCEL</button><button class="btn primary" id="gh-go">INSTALL</button>`;
  openModal({ title: "INSTALL FROM GITHUB", body, foot });

  on("#gh-cancel", "click", closeModal);
  on("#gh-go", "click", () => {
    const url = $("#gh-url").value.trim();
    const name = $("#gh-name").value.trim();
    const composeText = $("#gh-compose").value.trim();
    if (composeText) return doInstall({ composeText, name: name || "custom-app" });
    if (!url) return toast("ENTER A URL OR PASTE A COMPOSE FILE", "err");
    doInstall({ url, name: name || url.split("/").filter(Boolean).slice(-1)[0] });
  });
}

/* ---- installed apps ---- */
async function openInstalled() {
  await refreshInstalled();
  const body = document.createElement("div");
  if (!LIVE.installed.length) {
    body.innerHTML = `<div class="empty">NOTHING INSTALLED THROUGH NEXUS YET</div>`;
  } else {
    body.innerHTML = `<div class="tw"><table><thead><tr><th>App</th><th>Ports</th><th>Source</th><th></th></tr></thead>
      <tbody>${LIVE.installed.map(a => `<tr>
        <td class="name">${esc(a.name)}</td>
        <td class="mono">${(a.ports || []).join(", ") || "—"}</td>
        <td class="mono">${esc(a.libraryId || a.source || "manual").slice(0, 40)}</td>
        <td><button class="btn sm danger" data-rm="${esc(a.slug)}" data-nm="${esc(a.name)}">REMOVE</button></td>
      </tr>`).join("")}</tbody></table></div>`;
  }
  const foot = document.createElement("div");
  foot.innerHTML = `<button class="btn" id="ins-close">CLOSE</button>`;
  openModal({ title: "INSTALLED APPS", body, foot });
  on("#ins-close", "click", closeModal);
  body.addEventListener("click", e => {
    const b = e.target.closest("[data-rm]");
    if (b) doUninstall(b.dataset.rm, b.dataset.nm);
  });
}

let searchTimer = null;
on("#st-q", "input", e => {
  clearTimeout(searchTimer);
  ST.q = e.target.value;
  searchTimer = setTimeout(() => loadStore(true), 220);
});
on("#st-cat", "change", e => { ST.category = e.target.value; loadStore(true); });
on("#st-more-btn", "click", () => { ST.offset += ST.limit; loadStore(false); });
on("#st-libs", "click", openLibraries);
on("#st-github", "click", openGitHubInstall);
on("#st-installed-btn", "click", openInstalled);

/* ============================ navigation ============================ */
const TITLES = { dash: "DASHBOARD", store: "APP STORE", containers: "CONTAINERS", files: "FILES", term: "TERMINAL", settings: "SETTINGS" };

function go(page) {
  $$(".nav").forEach(n => n.classList.toggle("on", n.dataset.page === page));
  $$(".page").forEach(p => p.classList.toggle("on", p.id === "page-" + page));
  $("#page-title").textContent = TITLES[page] || page;
  $("#tools-dash").hidden = page !== "dash";
  $("#tools-containers").hidden = page !== "containers";
  $("#tools-files").hidden = page !== "files";
  $("#tools-store").hidden = page !== "store";
  $("#tools-term").hidden = page !== "term";

  if (page === "containers") loadContainers();
  if (page === "files") loadFiles(curDir);
  if (page === "settings") loadSettings();
  if (page === "store") { refreshInstalled().then(() => { loadStoreStatus(); loadStore(true); }); }
  if (page === "term") {
    const on = LIVE.info?.terminal?.enabled;
    $("#term-off").hidden = !!on;
    $("#term-on").hidden = !on;
    if (on) {
      const t = LIVE.info.terminal;
      $("#term-title").textContent = t.shell || "shell";
      const b = $("#term-backend");
      b.className = "pill " + (t.resize ? "ok" : "warn");
      b.textContent = t.resize ? "NODE-PTY · FULL RESIZE" : "SCRIPT · RESIZE BEST-EFFORT";
      connectTerminal();
      // The host has no size until the page is visible, so fit after paint.
      requestAnimationFrame(() => { fitTerm(); term?.focus(); });
    }
  }
}
$$(".nav").forEach(n => n.addEventListener("click", () => go(n.dataset.page)));

on("#theme", "click", () => {
  const r = document.documentElement;
  const dark = r.getAttribute("data-theme") === "dark" ||
    (!r.getAttribute("data-theme") && matchMedia("(prefers-color-scheme:dark)").matches);
  r.setAttribute("data-theme", dark ? "light" : "dark");
  try { localStorage.setItem("nexus.theme", dark ? "light" : "dark"); } catch {}
  renderWidgets();
  if (term) { term.options.theme = termTheme(); }
});
try { const t = localStorage.getItem("nexus.theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch {}

on("#add", "click", () => $("#drawer").classList.add("open"));
on("#dclose", "click", () => $("#drawer").classList.remove("open"));
on("#drawer", "click", e => { if (e.target.id === "drawer") e.currentTarget.classList.remove("open"); });
on("#reset", "click", async () => {
  try { await api("/layout", { method: "DELETE" }); } catch {}
  gridEl.innerHTML = ""; mounted = {};
  items = DEFAULT_LAYOUT.map((d, i) => ({ id: i + 1, ...d }));
  uid = items.length + 1;
  items.forEach(it => build(it, true));
  compact(); layout();
});
addEventListener("resize", () => layout(false));

/* ============================ start ============================ */
async function start() {
  Object.keys(REG).forEach(k => {
    const d = REG[k];
    const b = document.createElement("button");
    b.className = "card";
    b.innerHTML = `<img src="${d.icon}" alt=""><span><span class="cn">${esc(d.name.toUpperCase())}</span><span class="cd">${esc(d.desc)}</span></span>`;
    b.addEventListener("click", () => { addWidget(k); $("#drawer").classList.remove("open"); });
    $("#dbody").appendChild(b);
  });

  try {
    const saved = await api("/layout");
    items = Array.isArray(saved.widgets) && saved.widgets.length
      ? saved.widgets.filter(w => REG[w.t])
      : DEFAULT_LAYOUT.map((d, i) => ({ id: i + 1, ...d }));
  } catch {
    items = DEFAULT_LAYOUT.map((d, i) => ({ id: i + 1, ...d }));
  }
  items.forEach((it, i) => { if (!it.id) it.id = i + 1; });
  uid = Math.max(0, ...items.map(i => i.id)) + 1;
  items.forEach(it => build(it, false));
  compact(); layout(false);

  api("/system/info").then(i => { LIVE.info = i; renderWidgets(); }).catch(() => {});
  api("/system/metrics").then(m => { LIVE.disks = m.disks || []; renderWidgets(); }).catch(() => {});
  api("/docker/containers").then(o => { if (o.available) { LIVE.containers = o.containers; renderWidgets(); } }).catch(() => {});
  setInterval(() => { api("/system/metrics").then(m => { LIVE.disks = m.disks || []; }).catch(() => {}); }, 30000);
  setInterval(() => { api("/docker/containers").then(o => { if (o.available) LIVE.containers = o.containers; }).catch(() => {}); }, 15000);

  connectWS();
  connectEvents();
  refreshInstalled();
  setInterval(renderWidgets, 1000);
}

boot();
})();
