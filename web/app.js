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

/* ============================ tooltips ============================ */
/**
 * One floating tip, driven by `data-tip` anywhere in the document.
 *
 * Delegated rather than per-element, so markup rendered later (widgets, table
 * rows, control-panel rules) gets tooltips for free. Native `title` was the
 * alternative: it cannot be styled to match anything, and its delay is a browser
 * preference rather than ours.
 */
const tipEl = document.createElement("div");
tipEl.id = "tip";
tipEl.setAttribute("role", "tooltip");
document.body.appendChild(tipEl);

let tipTimer = null, tipFor = null;

function hideTip() {
  clearTimeout(tipTimer);
  tipFor = null;
  tipEl.classList.remove("on");
}

function showTip(target) {
  const text = target.getAttribute("data-tip");
  if (!text) return;
  tipEl.textContent = text;
  tipEl.classList.add("on");

  const r = target.getBoundingClientRect();
  const t = tipEl.getBoundingClientRect();
  // Prefer below; flip above when there is no room, which is what happens to
  // anything in the top bar.
  let top = r.bottom + 8;
  if (top + t.height > innerHeight - 8) top = r.top - t.height - 8;
  const left = clamp(r.left + r.width / 2 - t.width / 2, 8, innerWidth - t.width - 8);
  tipEl.style.left = Math.round(left) + "px";
  tipEl.style.top = Math.round(Math.max(8, top)) + "px";
}

addEventListener("pointerover", e => {
  // Touch has no hover. A tap fires pointerover, so without this a tooltip pops
  // up over whatever you just pressed and then sits there with nothing to
  // dismiss it — the classic hover-tooltip-on-mobile failure.
  if (e.pointerType === "touch") return;
  const t = e.target?.closest?.("[data-tip]");
  if (!t || t === tipFor) return;
  hideTip();
  tipFor = t;
  // Long enough that tips do not flicker up while the pointer crosses the page.
  tipTimer = setTimeout(() => { if (tipFor === t && t.isConnected) showTip(t); }, 380);
});
addEventListener("pointerout", e => {
  const t = e.target?.closest?.("[data-tip]");
  if (t && t === tipFor) hideTip();
});
addEventListener("pointerdown", hideTip, true);
addEventListener("scroll", hideTip, true);
addEventListener("keydown", e => { if (e.key === "Escape") hideTip(); });

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
    // Carry the detail the server attaches to a refusal. Without this a 409
    // arrives as "1 item already exists" with no way to say which, and the
    // overwrite prompt lists nothing.
    for (const k of ["clashes", "conflicts", "wanted"]) {
      if (data && data[k] !== undefined) err[k] = data[k];
    }
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

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** 12-hour by default — "5:47 PM". 24-hour keeps the leading zero. */
function fmtTime(d, h12 = true, seconds = false) {
  const H = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  if (!h12) return `${String(H).padStart(2, "0")}:${m}${seconds ? ":" + s : ""}`;
  const h = H % 12 === 0 ? 12 : H % 12;
  return `${h}:${m}${seconds ? ":" + s : ""} ${H < 12 ? "AM" : "PM"}`;
}

function fmtDate(d) {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
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
  // When the newest sample in `history` was taken. The charts need it to put a
  // clock time against the point under the pointer; without it the best they
  // could say is "somewhere in the last few minutes".
  t: 0,
  sensors: [], history: { cpu: [], mem: [], rx: [], tx: [], dr: [], dw: [] },
  memUsed: 0, memTotal: 0, bootAt: 0,
  cores: [], disk: null, procs: { byCpu: [], byMem: [], total: 0, running: 0 },
  loadavg: [0, 0, 0], swapUsed: 0, swapTotal: 0,
  // Polled separately: the scan shells out and is cached for minutes server-side,
  // so putting it in the 2-second metrics frame would be pure waste. Keyed by
  // lookback window, because two widgets may be asking different questions.
  security: {},
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
      t: msg.data.t || Date.now(),
      cpu: msg.data.cpu, mem: msg.data.mem, net: msg.data.net,
      memUsed: msg.data.memUsed, memTotal: msg.data.memTotal, bootAt: msg.data.bootAt,
      uptimeSec: msg.data.uptimeSec, sensors: msg.data.sensors || [], history: msg.data.history || LIVE.history,
      cores: msg.data.cores || [], disk: msg.data.disk ?? null,
      procs: msg.data.procs || LIVE.procs,
      loadavg: msg.data.loadavg || LIVE.loadavg,
      swapUsed: msg.data.swapUsed ?? 0, swapTotal: msg.data.swapTotal ?? 0
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

// No seconds. Beyond being noise in a status bar, a ticking seconds digit
// re-measured the clock every second and nudged the buttons either side of it;
// the fixed min-width in the stylesheet is the other half of that fix.
setInterval(() => {
  const n = new Date();
  const el = $("#clock");
  if (el) el.innerHTML =
    `<span class="ctime">${fmtTime(n, true, false)}</span>` +
    `<span class="cday">${DAYS[n.getDay()]} ${n.getDate()} ${MONTHS[n.getMonth()]}</span>`;
}, 1000);

/* ============================ charts ============================ */
/**
 * Charts are drawn at the element's REAL pixel size — viewBox matches the
 * measured box 1:1, so nothing is scaled.
 *
 * The previous version drew into a fixed 120x40 viewBox and stretched it with
 * preserveAspectRatio="none". On a 1000px-wide widget that magnified every
 * sample into an ~8px block: not a stylistic choice, just a low-resolution
 * image scaled up. Matching the viewBox to the box, and feeding it more
 * samples, gives a crisp line that still steps — the aesthetic survives, the
 * blockiness does not.
 */
function linePath(vals, w, h, maxV, pad) {
  if (!vals.length) return "";
  const n = vals.length;
  const sw = w / Math.max(1, n - 1);
  const usable = h - pad * 2;
  let d = "";
  for (let i = 0; i < n; i++) {
    // Sub-pixel coordinates on purpose: rounding to integers is what made the
    // old chart look like a staircase. Anti-aliasing does the rest.
    const y = (pad + usable - (clamp(vals[i], 0, maxV) / maxV) * usable).toFixed(1);
    const x = (i * sw).toFixed(1);
    d += i === 0 ? `M${x},${y}` : `L${x},${y}`;
  }
  return d;
}

function drawChart(svg, vals, maxV, color, opts = {}) {
  const r = svg.getBoundingClientRect();
  // A hidden or not-yet-laid-out widget measures zero; skip rather than draw junk.
  if (r.width < 8 || r.height < 8) return;

  const w = Math.round(r.width);
  const h = Math.round(r.height);
  const pad = 3;
  const max = maxV || 1;
  const usable = h - pad * 2;

  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  // geometricPrecision, not crispEdges: we want the line anti-aliased and smooth.
  svg.setAttribute("shape-rendering", "geometricPrecision");

  if (!vals.length) { emptyChart(svg); return; }

  // What the crosshair reads back. Stored on the element rather than closed
  // over, because the widget throws this SVG's contents away and redraws once a
  // second: the hover has to find the *current* samples, not the ones that were
  // on screen when the pointer arrived.
  svg.__probe = {
    w, h, n: vals.length,
    at: opts.at || LIVE.t || Date.now(),
    step: opts.step || 1000,
    fmt: opts.fmt || String,
    series: [{
      label: opts.label || "",
      vals,
      color,
      y: v => pad + usable - (clamp(v, 0, max) / max) * usable
    }]
  };

  const line = linePath(vals, w, h, max, pad);

  // Grid stays on crisp integer pixels so it reads as a ruled background rather
  // than a set of blurry grey smears.
  const grid = [0.25, 0.5, 0.75]
    .map(f => {
      const y = Math.round(pad + (h - pad * 2) * f) + 0.5;
      return `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${cssv("--rule")}" stroke-width="1" opacity="0.45" shape-rendering="crispEdges"/>`;
    }).join("");

  const lastY = (pad + (h - pad * 2) - (clamp(vals[vals.length - 1], 0, max) / max) * (h - pad * 2)).toFixed(1);

  svg.innerHTML =
    grid +
    `<path d="${line} L${w},${h} L0,${h} Z" fill="${color}" fill-opacity="0.13"/>` +
    `<path d="${line}" fill="none" stroke="${color}" stroke-width="1.75"
           stroke-linejoin="round" stroke-linecap="round"/>` +
    // Current value, marked so you can read the number off the end of the line.
    `<circle cx="${w - 2}" cy="${lastY}" r="2.25" fill="${color}"/>` +
    (opts.maxLabel
      ? `<text x="3" y="${pad + 9}" font-family="IBM Plex Mono, monospace" font-size="9.5"
               fill="${cssv("--text-3")}">${esc(opts.maxLabel)}</text>`
      : "");
}
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/**
 * Two series mirrored around a centre line — reads above, writes below.
 *
 * Deliberately not two overlaid lines. Disk traffic is usually lopsided (a
 * backup writes for minutes without reading), and overlaying two series that
 * share a scale means the quiet one is a flat smear along the bottom. Splitting
 * the box gives each direction its own half and makes the shape of the activity
 * legible at a glance: reads up, writes down, symmetry means both at once.
 */
function drawMirror(svg, up, down, maxV, colorUp, colorDown, opts = {}) {
  const r = svg.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return;

  const w = Math.round(r.width), h = Math.round(r.height);
  const mid = h / 2;
  const max = maxV || 1;
  const pad = 2;
  const usable = mid - pad;

  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("shape-rendering", "geometricPrecision");

  const half = (vals, dir) => {
    if (!vals || !vals.length) return "";
    const n = vals.length;
    const sw = w / Math.max(1, n - 1);
    let d = "";
    for (let i = 0; i < n; i++) {
      const frac = clamp(vals[i], 0, max) / max;
      const y = (mid + dir * frac * usable).toFixed(1);
      d += (i === 0 ? "M" : "L") + (i * sw).toFixed(1) + "," + y;
    }
    return d;
  };

  const upPath = half(up, -1);
  const downPath = half(down, 1);
  const mline = Math.round(mid) + 0.5;

  // Both halves share one x axis, so the crosshair reads both at once — which
  // is the whole point of mirroring them: "what was the disk doing at 14:31:08"
  // is one question, not two.
  const track = (vals, dir) => ({
    label: dir < 0 ? (opts.upLabel || "") : (opts.downLabel || ""),
    vals: vals || [],
    color: dir < 0 ? colorUp : colorDown,
    y: v => mid + dir * (clamp(v, 0, max) / max) * usable
  });
  const n = Math.max(up?.length || 0, down?.length || 0);
  svg.__probe = n ? {
    w, h, n,
    at: opts.at || LIVE.t || Date.now(),
    step: opts.step || 1000,
    fmt: opts.fmt || String,
    series: [track(up, -1), track(down, 1)].filter(s => s.vals.length)
  } : null;

  svg.innerHTML =
    (upPath ? `<path d="${upPath} L${w},${mid} L0,${mid} Z" fill="${colorUp}" fill-opacity="0.16"/>` : "") +
    (downPath ? `<path d="${downPath} L${w},${mid} L0,${mid} Z" fill="${colorDown}" fill-opacity="0.16"/>` : "") +
    `<line x1="0" y1="${mline}" x2="${w}" y2="${mline}" stroke="${cssv("--rule")}" stroke-width="1" shape-rendering="crispEdges"/>` +
    (upPath ? `<path d="${upPath}" fill="none" stroke="${colorUp}" stroke-width="1.6" stroke-linejoin="round"/>` : "") +
    (downPath ? `<path d="${downPath}" fill="none" stroke="${colorDown}" stroke-width="1.6" stroke-linejoin="round"/>` : "");
}

/** A chart with nothing to draw. Clears the readout too, or the crosshair would
 *  keep answering with samples that are no longer on screen. */
function emptyChart(svg) { svg.innerHTML = ""; svg.__probe = null; }

/* ========================= chart crosshair ========================= */
/**
 * Hover any chart and read the sample under the pointer: what it was, and when
 * it was taken.
 *
 * One floating element for the whole page, the same arrangement as `#tip`, and
 * for a stronger reason here: every chart rewrites its own `innerHTML` once a
 * second, so a crosshair drawn *inside* the `<svg>` would be wiped out between
 * one pointer move and the next. Living outside it, the overlay simply re-reads
 * `svg.__probe` — which the redraw has just refreshed — and stays correct.
 *
 * The line snaps to a sample rather than tracking the cursor freely. Between
 * two samples there is no reading to give, and a crosshair that stops where a
 * measurement actually exists is the difference between an exact value and a
 * plausible-looking guess.
 *
 * Mouse and pen only. A finger has no hover, and a chart sits inside a widget
 * body that a long press picks up to drag — scrubbing would have to fight both
 * that gesture and the page scroll, and would win neither cleanly.
 */
const probeEl = document.createElement("div");
probeEl.id = "probe";
// Decoration over data that is already in the DOM as text: announcing it again
// would only make the widget read twice.
probeEl.setAttribute("aria-hidden", "true");
probeEl.innerHTML =
  '<i class="pb-line"></i>' +
  '<div class="pb-card"><span class="pb-when"></span><span class="pb-rows"></span></div>';
document.body.appendChild(probeEl);

const probeCard = $(".pb-card", probeEl);
const probeWhen = $(".pb-when", probeEl);
const probeRows = $(".pb-rows", probeEl);
const probeLine = $(".pb-line", probeEl);

let probeSvg = null;      // the chart being read, or null when nothing is
let probeAtX = 0;         // the pointer's last client x, so a redraw can re-read
let probeRaf = 0, probeWant = null;

function hideProbe() {
  if (!probeSvg) return;
  probeSvg = null;
  probeEl.classList.remove("on");
}

/** One dot and one card row per series, created once and then reused, so the
 *  CSS transition that makes the crosshair glide is never restarted. */
function probeSlots(n) {
  let dots = $$(".pb-dot", probeEl), rows = $$(".pb-row", probeRows);
  while (dots.length < n) {
    const dot = document.createElement("i");
    dot.className = "pb-dot";
    probeEl.insertBefore(dot, probeCard);

    const row = document.createElement("span");
    row.className = "pb-row";
    row.innerHTML = '<i class="pb-key"></i><span class="pb-lbl"></span><span class="pb-val"></span>';
    probeRows.appendChild(row);

    dots = $$(".pb-dot", probeEl);
    rows = $$(".pb-row", probeRows);
  }
  dots.forEach((d, i) => { d.hidden = i >= n; });
  rows.forEach((r, i) => { r.hidden = i >= n; });
  return { dots, rows };
}

/** Right-aligned: the newest sample is the last one in every series, so a
 *  series that is one sample short is missing it from the *start*, not the end. */
function sampleAt(vals, i, n) { return vals[vals.length - (n - i)]; }

function drawProbe(svg, clientX) {
  const p = svg && svg.isConnected ? svg.__probe : null;
  if (!p || !p.n || !p.series.length) { hideProbe(); return; }

  const rect = svg.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) { hideProbe(); return; }

  // The viewBox is built from the measured box, so this is 1:1 in practice. It
  // is written out anyway so the readout stays honest mid-resize, when the box
  // has changed but the last draw's viewBox has not.
  const kx = rect.width / p.w, ky = rect.height / p.h;
  const step = p.w / Math.max(1, p.n - 1);
  const i = clamp(Math.round((clientX - rect.left) / kx / step), 0, p.n - 1);
  const x = i * step * kx;

  // The ring around each dot is painted in the widget's own background so the
  // dot separates from the line and the fill underneath it. Widget tints are a
  // class mixed against the panel colour, so the computed value is the only
  // place the real colour exists — read once per chart, not once per frame.
  if (probeSvg !== svg) {
    const host = svg.closest(".w");
    probeEl.style.setProperty("--pbg", host ? getComputedStyle(host).backgroundColor : cssv("--panel"));
  }
  probeSvg = svg;
  probeAtX = clientX;

  const at = p.at - (p.n - 1 - i) * p.step;
  const age = Math.max(0, Math.round((Date.now() - at) / 1000));
  probeWhen.textContent = `${fmtTime(new Date(at), false, true)} · ${age ? age + "s ago" : "now"}`;

  const { dots, rows } = probeSlots(p.series.length);
  let anchorY = rect.height / 2;

  p.series.forEach((s, k) => {
    const v = sampleAt(s.vals, i, p.n);
    const known = Number.isFinite(v);
    const y = known ? s.y(v) * ky : 0;
    if (k === 0 && known) anchorY = y;

    const dot = dots[k];
    dot.hidden = !known;
    dot.style.setProperty("--pc", s.color);
    dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;

    const row = rows[k];
    $(".pb-key", row).style.background = s.color;
    $(".pb-lbl", row).textContent = s.label;
    // Absent is not zero: a series with no sample at this instant says so.
    $(".pb-val", row).textContent = known ? p.fmt(v) : "—";
  });

  probeEl.classList.add("on");
  probeEl.style.left = rect.left + "px";
  probeEl.style.top = rect.top + "px";
  probeEl.style.width = rect.width + "px";
  probeEl.style.height = rect.height + "px";
  probeLine.style.transform = `translateX(${x.toFixed(1)}px)`;

  // The card sits beside the line and flips to its other side near the right
  // edge of the window, so it never hangs off the screen or covers the point it
  // is describing.
  const card = probeCard.getBoundingClientRect();
  const GAP = 12;
  const flip = rect.left + x + GAP + card.width > innerWidth - 8;
  const cx = flip ? x - GAP - card.width : x + GAP;
  const cy = clamp(anchorY - card.height / 2, 8 - rect.top, innerHeight - 8 - card.height - rect.top);
  probeCard.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
}

/** Re-read after a redraw, so the value under a resting pointer keeps up with
 *  the machine instead of freezing at whatever it said when the pointer landed. */
function refreshProbe() {
  if (probeSvg) drawProbe(probeSvg, probeAtX);
}

addEventListener("pointermove", e => {
  if (e.pointerType === "touch") return;
  // A widget being dragged is not a widget being read.
  const svg = activeDrag ? null : e.target?.closest?.("svg.chart");
  if (!svg) { hideProbe(); probeWant = null; return; }
  probeWant = { svg, x: e.clientX };
  if (probeRaf) return;
  // Coalesced to one draw per frame: a mouse can outpace the display, and the
  // card is measured on every draw.
  probeRaf = requestAnimationFrame(() => {
    probeRaf = 0;
    if (probeWant) drawProbe(probeWant.svg, probeWant.x);
  });
}, { passive: true });

addEventListener("pointerdown", hideProbe, true);
addEventListener("pointercancel", hideProbe, true);
// Leaving the window fires no further pointermove, so the crosshair would be
// left standing on the last chart the pointer crossed.
document.addEventListener("pointerleave", hideProbe);
addEventListener("scroll", hideProbe, true);
addEventListener("blur", hideProbe);
addEventListener("keydown", e => { if (e.key === "Escape") hideProbe(); });

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

/* ==================== per-widget appearance settings ==================== */
const WCOLORS = [
  { key: "cyan",   label: "Cyan",   css: "var(--wc-cyan)"   },
  { key: "orchid", label: "Orchid", css: "var(--wc-orchid)" },
  { key: "amber",  label: "Amber",  css: "var(--wc-amber)"  },
  { key: "green",  label: "Green",  css: "var(--wc-green)"  },
  { key: "coral",  label: "Coral",  css: "var(--wc-coral)"  },
  { key: "blue",   label: "Blue",   css: "var(--wc-blue)"   }
];
const SCALES = [
  { key: 0.85, label: "S" }, { key: 1, label: "M" },
  { key: 1.25, label: "L" }, { key: 1.6, label: "XL" }
];
const colorCss = key => (WCOLORS.find(c => c.key === key) || WCOLORS[0]).css;

/** Defaults merged with whatever the widget has saved. */
function cfgOf(it) {
  const def = REG[it.t]?.defaults || {};
  return { scale: 1, color: "cyan", bg: "none", ...def, ...(it.cfg || {}) };
}

/**
 * Per-item visibility.
 *
 * Stored as a list of things to HIDE rather than a list to show, so a drive you
 * plug in next month or a sensor a kernel update exposes turns up on its own. A
 * "shown" list would silently omit anything that did not exist when you last
 * touched the menu, which is the same shape as a bug.
 */
const hiddenSet = cfg => new Set(Array.isArray(cfg.hidden) ? cfg.hidden : []);

function toggleHidden(cfg, value) {
  const h = hiddenSet(cfg);
  if (h.has(value)) h.delete(value); else h.add(value);
  return [...h];
}

/** Push the settings onto the element as CSS variables, so styling is pure CSS. */
function applyCfg(el, it) {
  const c = cfgOf(it);
  el.style.setProperty("--ws", String(c.scale));
  el.style.setProperty("--wc", colorCss(c.color));
  // Background is a class rather than an inline value so the tint can be mixed
  // against whichever panel colour the current theme is using.
  el.classList.remove(...[...el.classList].filter(n => n.startsWith("bg-")));
  el.classList.add("bg-" + (c.bg || "none"));
}

/* ============================ context menu ============================ */
const ctx = $("#ctx");
let ctxItems = [];          // the widgets the open menu is editing
let ctxAt = { x: 0, y: 0 };

function closeCtx() { ctx.classList.remove("open"); ctxItems = []; }

/**
 * "Did this click land inside the menu?" has to be answered BEFORE the handler
 * runs, not after.
 *
 * Toggling an option rebuilds #ctx-body, which detaches the button that was
 * clicked. By the time the event reaches the window listener below, that node
 * has no #ctx ancestor any more, so `closest("#ctx")` says no and the menu
 * closes itself on every tick. Flagging the event in the capture phase — while
 * the node is still in the document — is what lets you tick several boxes in a
 * row without the menu vanishing under the pointer.
 */
ctx.addEventListener("click", e => { e.nexusInCtx = true; }, true);
addEventListener("click", e => { if (!e.nexusInCtx && !e.target.closest("#ctx")) closeCtx(); });
addEventListener("keydown", e => { if (e.key === "Escape") closeCtx(); });

/**
 * Scrolling the page closes the menu, because the menu is fixed to the viewport
 * and the widget it belongs to would slide out from under it.
 *
 * Scrolling INSIDE the menu must not. The tick list is its own scroll container,
 * and this listener is in the capture phase, so without the check a host with a
 * dozen sensors gets a menu that shuts itself the instant you try to reach the
 * channel at the bottom of the list.
 */
addEventListener("scroll", e => {
  const t = e.target;
  if (t && t.nodeType === 1 && t.closest && t.closest("#ctx")) return;
  closeCtx();
}, true);

/**
 * Opens the widget menu for one widget or for a whole selection.
 *
 * With several widgets selected only the settings they all understand are
 * offered — size, colour, tint always; a widget's own options only when every
 * selected widget is the same type. Showing "Face: analog" over a mixed bag of
 * a clock and a CPU chart would just be a button that silently does nothing to
 * most of them.
 */
function openCtx(list, x, y) {
  const sel = (Array.isArray(list) ? list : [list]).filter(it => it && REG[it.t]);
  if (!sel.length) return;
  ctxItems = sel;
  ctxAt = { x, y };

  const many = sel.length > 1;
  const sameType = sel.every(it => it.t === sel[0].t);
  const def = REG[sel[0].t];
  const lead = cfgOf(sel[0]);
  // With a mixed selection a value is only "current" when they all share it.
  const shared = key => (sel.every(it => cfgOf(it)[key] === lead[key]) ? lead[key] : undefined);

  $("#ctx-icon").src = sameType ? def.icon : ICON("dashboard");
  $("#ctx-title").textContent = many
    ? `${sel.length} WIDGETS SELECTED`
    : def.name.toUpperCase();

  const body = $("#ctx-body");
  body.innerHTML = "";

  // Every widget gets size and colour…
  body.appendChild(ctxGroup("Text &amp; icon size", ICON("textsize"), SCALES.map(s => ({
    label: s.label, sel: shared("scale") === s.key, apply: () => setCfg({ scale: s.key })
  }))));

  body.appendChild(ctxSwatches("Colour", WCOLORS, shared("color"), c => c.css, key => setCfg({ color: key })));

  // Background tint. "None" first, because the plain panel is the sane default
  // and should be one click away rather than buried at the end.
  body.appendChild(ctxSwatches(
    "Background tint",
    [{ key: "none", label: "None", css: "var(--panel)" }, ...WCOLORS],
    shared("bg"),
    c => (c.key === "none" ? "var(--panel)" : `color-mix(in srgb, ${c.css} 45%, var(--panel))`),
    key => setCfg({ bg: key }),
    true
  ));

  // …and anything the widget itself declares, when the selection agrees on type.
  if (sameType) {
    for (const opt of def.options || []) {
      body.appendChild(ctxGroup(opt.label, opt.icon || null, opt.values.map(v => ({
        label: v.label,
        sel: shared(opt.key) === v.value,
        apply: () => setCfg({ [opt.key]: v.value })
      }))));
    }
  }

  // Free-text and one-shot commands a widget declares. A row of preset buttons
  // cannot express "type a name", so those live here instead.
  if (!many && def.actions?.length) {
    const g = document.createElement("div");
    g.className = "ctxgroup";
    g.innerHTML = `<span class="ctxlabel"><img src="${ICON("settings")}" alt="">Actions</span>`;
    const row = document.createElement("div");
    row.className = "ctxrow";
    for (const a of def.actions) {
      const b = document.createElement("button");
      b.className = "ctxopt";
      b.textContent = a.label;
      b.addEventListener("click", () => a.run(sel[0]));
      row.appendChild(b);
    }
    g.appendChild(row);
    body.appendChild(g);
  }

  // Per-item tick lists are single-widget only: "which mounts" means something
  // different for each widget, and merging two lists is a guess.
  if (!many && def.picker) {
    const p = def.picker(lead);
    if (p) body.appendChild(ctxChecklist(p, lead));
  }

  if (many) {
    const note = document.createElement("p");
    note.className = "ctxnote";
    note.textContent = sameType
      ? "Changes apply to all selected widgets."
      : "Mixed types — only the shared settings are shown.";
    body.appendChild(note);
  }

  // The file-manager menu hides the footer; put it back for widgets.
  $(".ctxfoot").hidden = false;
  $("#ctx-remove").textContent = many ? `REMOVE ${sel.length}` : "REMOVE";

  // Ctrl-click is how a selection is built with a mouse; touch has no modifier
  // key, so the menu carries the same action as a button.
  const selBtn = $("#ctx-select");
  selBtn.hidden = false;
  selBtn.textContent = many ? "CLEAR SELECTION"
    : selection.has(sel[0].id) ? "DESELECT" : "SELECT";

  placeCtx(x, y);
}

/**
 * Place on screen, nudged back inside the viewport if it would overflow.
 *
 * Below the sheet breakpoint it stops being a context menu and becomes a bottom
 * sheet instead: a 212px-wide menu anchored to a fingertip on a 390px screen
 * lands half off the edge and leaves no room for the tick lists.
 */
const SHEET_AT = 560;
function placeCtx(x, y) {
  const sheet = innerWidth <= SHEET_AT;
  ctx.classList.toggle("sheet", sheet);
  ctx.classList.add("open");
  if (sheet) { ctx.style.left = ctx.style.top = ""; return; }
  const r = ctx.getBoundingClientRect();
  ctx.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  ctx.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
}

function ctxGroup(label, icon, opts) {
  const g = document.createElement("div");
  g.className = "ctxgroup";
  g.innerHTML = `<span class="ctxlabel">${icon ? `<img src="${icon}" alt="">` : ""}${label}</span>`;
  const row = document.createElement("div");
  row.className = "ctxrow";
  opts.forEach(o => {
    const b = document.createElement("button");
    b.className = "ctxopt" + (o.sel ? " sel" : "");
    b.textContent = o.label;
    b.addEventListener("click", o.apply);
    row.appendChild(b);
  });
  g.appendChild(row);
  return g;
}

function ctxSwatches(label, colors, current, bgFor, apply, dashNone) {
  const g = document.createElement("div");
  g.className = "ctxgroup";
  g.innerHTML = `<span class="ctxlabel"><img src="${ICON("palette")}" alt="">${label}</span>`;
  const row = document.createElement("div");
  row.className = "ctxrow";
  colors.forEach(c => {
    const b = document.createElement("button");
    b.className = "ctxopt swatch" + (current === c.key ? " sel" : "");
    b.style.background = bgFor(c);
    if (dashNone && c.key === "none") b.style.borderStyle = "dashed";
    b.title = c.label;
    b.setAttribute("aria-label", `${label} ${c.label}`);
    b.addEventListener("click", () => apply(c.key));
    row.appendChild(b);
  });
  g.appendChild(row);
  return g;
}

/** A tick list: everything is on unless it is in the widget's `hidden` array. */
function ctxChecklist(p, cfg) {
  const hide = hiddenSet(cfg);
  const g = document.createElement("div");
  g.className = "ctxgroup";
  g.innerHTML = `<span class="ctxlabel">${p.icon ? `<img src="${p.icon}" alt="">` : ""}${esc(p.label)}</span>`;

  if (!p.items.length) {
    const e = document.createElement("p");
    e.className = "ctxnote";
    e.textContent = p.empty || "Nothing to show yet.";
    g.appendChild(e);
    return g;
  }

  const list = document.createElement("div");
  list.className = "ctxchecks";
  p.items.forEach(item => {
    const shown = !hide.has(item.value);
    const b = document.createElement("button");
    b.className = "ctxcheck" + (shown ? " on" : "");
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", String(shown));
    b.innerHTML =
      `<span class="tick" aria-hidden="true">${shown ? "&#10003;" : ""}</span>` +
      `<span class="ct"><span class="cl">${esc(item.label)}</span>` +
      (item.sub ? `<span class="cs">${esc(item.sub)}</span>` : "") + `</span>`;
    b.addEventListener("click", () => setCfg({ [p.key]: toggleHidden(cfgOf(ctxItems[0]), item.value) }));
    list.appendChild(b);
  });
  g.appendChild(list);

  const all = document.createElement("div");
  all.className = "ctxrow ctxallrow";
  const mk = (label, fn) => {
    const b = document.createElement("button");
    b.className = "ctxopt";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  };
  all.appendChild(mk("ALL", () => setCfg({ [p.key]: [] })));
  all.appendChild(mk("NONE", () => setCfg({ [p.key]: p.items.map(i => i.value) })));
  g.appendChild(all);
  return g;
}

/**
 * Write settings for one specific widget, without touching the open menu.
 *
 * Used by interactions inside a widget — dropping the cat somewhere records
 * where she was put — which must persist without rebuilding the widget
 * underneath the pointer that is still on it.
 */
function setCfgFor(it, patch) {
  if (!it) return;
  it.cfg = { ...(it.cfg || {}), ...patch };
  saveLayout();
}

/** Applies a settings patch to every widget the menu is currently editing. */
function setCfg(patch) {
  if (!ctxItems.length) return;
  for (const it of ctxItems) {
    it.cfg = { ...(it.cfg || {}), ...patch };
    const el = document.getElementById("w" + it.id);
    if (el) applyCfg(el, it);
    // Remount so a mode change (bars vs list, analog vs digital) takes effect.
    remount(it);
  }
  saveLayout();
  // A changed lookback window needs its own scan; without this the widget sits
  // on "scanning…" until the next poll comes round.
  if (ctxItems.some(it => it.t === "security")) pollSecurity();
  // Re-open in place so the ticks and highlights reflect what just happened.
  const keep = ctxItems;
  openCtx(keep, ctxAt.x, ctxAt.y);
}

function remount(it) {
  const el = document.getElementById("w" + it.id);
  if (!el) return;
  const def = REG[it.t];
  const body = $(".w-body", el);
  body.innerHTML = "";
  body.removeAttribute("style");
  mounted[it.id] = { def, ref: def.mount(body, cfgOf(it)), it };
  if (mounted[it.id].ref) mounted[it.id].ref.item = it;
  try { def.update(mounted[it.id].ref, cfgOf(it)); } catch {}
}

on("#ctx-remove", "click", () => {
  if (!ctxItems.length) return;
  const ids = ctxItems.map(i => i.id);
  closeCtx();
  removeWidgets(ids);
});
on("#ctx-reset", "click", () => {
  if (!ctxItems.length) return;
  ctxItems.forEach(it => { it.cfg = {}; });
  setCfg({});
});
on("#ctx-select", "click", () => {
  if (!ctxItems.length) return;
  if (ctxItems.length > 1) { clearSelection(); closeCtx(); return; }
  toggleSelect(ctxItems[0].id);
  openCtx(ctxItems, ctxAt.x, ctxAt.y);
});

/* ============================ widget registry ============================ */
const REG = {
  cpu: { name: "CPU", icon: ICON("cpu"), desc: "Load with stepped history", w: 4, h: 4,
    mount(b) { b.innerHTML = '<div class="big"><span class="n">--</span><span class="u">%</span></div><svg class="chart"></svg><span class="sub"></span>';
      return { n: $(".n", b), svg: $("svg", b), sub: $(".sub", b) }; },
    update(r, cfg) { r.n.textContent = Math.round(LIVE.cpu);
      drawChart(r.svg, LIVE.history.cpu, 100, colorCss(cfg.color),
        { label: "LOAD", fmt: v => v.toFixed(1) + "%" });
      const t = LIVE.sensors.find(s => s.kind === "temperature");
      r.sub.textContent = `${LIVE.info?.cpu?.cores || "?"} cores${t ? " · " + Math.round(t.value) + "°C" : ""}`; } },

  memory: { name: "Memory", icon: ICON("memory"), desc: "RAM in use", w: 4, h: 3,
    mount(b) { b.innerHTML = '<div class="big"><span class="n">--</span><span class="u">%</span></div><div class="meter inset"></div><span class="sub"></span>';
      return { n: $(".n", b), m: $(".meter", b), sub: $(".sub", b) }; },
    update(r) { r.n.textContent = Math.round(LIVE.mem);
      r.m.innerHTML = meterHTML(LIVE.mem, 75, 90);
      r.sub.textContent = bytes(LIVE.memUsed) + " of " + bytes(LIVE.memTotal); } },

  storage: { name: "Storage", icon: ICON("storage"), desc: "Usage per mount point", w: 4, h: 4,
    // Right-click -> tick the mounts you care about. /boot/efi and snap loops are
    // the usual things people want gone.
    picker: () => ({
      key: "hidden",
      label: "Mount points",
      icon: ICON("storage"),
      empty: "No mounts detected yet.",
      items: (LIVE.disks || []).map(d => ({
        value: d.mount,
        label: d.mount,
        sub: `${d.usage}% used · ${bytes(d.available)} free`
      }))
    }),
    mount(b) { b.innerHTML = '<ul class="klist"></ul>'; return { l: $("ul", b) }; },
    update(r, cfg) {
      if (!LIVE.disks.length) { r.l.innerHTML = '<li><span class="k">loading…</span></li>'; return; }
      const hide = hiddenSet(cfg);
      const shown = LIVE.disks.filter(d => !hide.has(d.mount));
      if (!shown.length) {
        r.l.innerHTML = '<li><span class="k">every mount is hidden — right-click to bring one back</span></li>';
        return;
      }
      r.l.innerHTML = shown.map(d => {
        const col = d.usage >= 90 ? "var(--crit)" : d.usage >= 80 ? "var(--warn)" : "var(--text)";
        return `<li><span class="k">${esc(d.mount)}</span><span class="v" style="color:${col}">${d.usage}% · ${bytes(d.available)} free</span></li>
                <li><span class="meter inset" style="width:100%">${meterHTML(d.usage, 80, 90, 18)}</span></li>`;
      }).join(""); } },

  network: { name: "Network", icon: ICON("network"), desc: "Throughput in and out", w: 4, h: 4,
    defaults: { trace: "rx" },
    options: [
      { key: "trace", label: "Graph shows", values: [
        { value: "rx", label: "DOWNLOAD" }, { value: "tx", label: "UPLOAD" }] }
    ],
    mount(b) {
      // Both directions get an equal, labelled slot. Previously download was a
      // giant number and upload was an arrow in the footnote, which made it
      // look like two unrelated readings.
      b.innerHTML = `
        <div class="netrow">
          <div class="netstat"><span class="nlbl">DOWN</span><span class="nval rx">--</span></div>
          <div class="netstat"><span class="nlbl">UP</span><span class="nval tx">--</span></div>
          <span class="spacer"></span>
          <span class="npeak"></span>
        </div>
        <svg class="chart"></svg>`;
      return { rx: $(".rx", b), tx: $(".tx", b), peak: $(".npeak", b), svg: $("svg", b) };
    },
    update(r, cfg) {
      r.rx.textContent = rate(LIVE.net.rx);
      r.tx.textContent = rate(LIVE.net.tx);
      const series = (cfg.trace === "tx" ? LIVE.history.tx : LIVE.history.rx) || [];
      const max = Math.max(1024, ...series);
      // The scale lives outside the drawing now, so the line can never run
      // through its own axis label.
      r.peak.textContent = `peak ${rate(max)} · ${cfg.trace === "tx" ? "up" : "down"}`;
      drawChart(r.svg, series, max, colorCss(cfg.color),
        { label: cfg.trace === "tx" ? "UP" : "DOWN", fmt: rate });
    } },

  sensors: { name: "Sensors", icon: ICON("temp"), desc: "Temperatures and fans", w: 4, h: 4,
    defaults: { mode: "bars" },
    options: [
      { key: "mode", label: "Display", values: [
        { value: "bars", label: "BARS" }, { value: "list", label: "LIST" }] }
    ],
    // This replaces the old "how many" cap. Ticking the channels you want is
    // strictly better than a count: on a box with acpitz, Composite, two NVMe
    // sensors and three core temps, "first 8" was never the eight you wanted.
    picker: () => ({
      key: "hidden",
      label: "Channels",
      icon: ICON("temp"),
      empty: "No sensors detected on this host.",
      items: (LIVE.sensors || []).map(s => ({
        value: s.id,
        label: s.label,
        sub: `${s.value}${s.unit} · ${s.kind}`
      }))
    }),
    mount(b, cfg) {
      b.innerHTML = cfg.mode === "list" ? '<ul class="klist"></ul>' : '<div class="sbars"></div>';
      return { box: b.firstElementChild, mode: cfg.mode };
    },
    update(r, cfg) {
      const hide = hiddenSet(cfg);
      const list = (LIVE.sensors || []).filter(s => !hide.has(s.id));
      if (!list.length) {
        r.box.innerHTML = LIVE.sensors?.length
          ? '<li><span class="k">every channel is hidden — right-click to bring one back</span></li>'
          : '<li><span class="k">no sensors detected</span></li>';
        return;
      }

      if (cfg.mode === "list") {
        r.box.innerHTML = list.map(s => {
          const lim = s.critical || s.max;
          const col = lim && s.value >= lim * 0.92 ? "var(--crit)" : lim && s.value >= lim * 0.8 ? "var(--warn)" : "var(--text)";
          return `<li><span class="k">${esc(s.label)}</span><span class="v" style="color:${col}">${s.value}${s.unit}</span></li>`;
        }).join("");
        return;
      }

      // Bars. Fans have no meaningful ceiling reported, so fall back to sane
      // per-kind maxima rather than drawing a bar against an unknown scale.
      r.box.innerHTML = list.map(s => {
        const lim = s.critical || s.max || (s.kind === "fan" ? 3000 : s.kind === "temperature" ? 100 : 100);
        const pct = clamp((s.value / lim) * 100, 0, 100);
        const cls = pct >= 92 ? "crit" : pct >= 80 ? "warn" : "";
        const col = cls === "crit" ? "var(--crit)" : cls === "warn" ? "var(--warn)" : "var(--text)";
        return `<div class="sbar">
          <div class="srow">
            <span class="sname">${esc(s.label)}</span>
            <span class="sval" style="color:${col}">${s.value}${esc(s.unit)}</span>
          </div>
          <div class="strack"><div class="sfill ${cls}" style="width:${pct.toFixed(1)}%"></div></div>
        </div>`;
      }).join("");
    } },

  containers: { name: "Containers", icon: ICON("containers"), desc: "Start, stop and watch your services", w: 5, h: 5,
    defaults: { show: "all", limit: 10 },
    options: [
      { key: "show", label: "Show", values: [
        { value: "all", label: "ALL" }, { value: "running", label: "RUNNING" }, { value: "stopped", label: "STOPPED" }] },
      { key: "limit", label: "How many", values: [
        { value: 5, label: "5" }, { value: 10, label: "10" }, { value: 20, label: "20" }, { value: 99, label: "ALL" }] }
    ],
    mount(b) {
      b.innerHTML = '<div class="csummary"></div><div class="clist"></div>';
      const el = { sum: $(".csummary", b), list: $(".clist", b), busy: new Set() };
      // Delegated so the handler survives every re-render.
      el.list.addEventListener("click", async e => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        e.stopPropagation();
        const { id, act, nm } = btn.dataset;
        btn.disabled = true;
        el.busy.add(id);
        try {
          await api(`/docker/containers/${encodeURIComponent(id)}/${act}`, { method: "POST" });
          toast(`${act.toUpperCase()} ${nm}`, "ok");
          const o = await api("/docker/containers");
          if (o.available) LIVE.containers = o.containers;
        } catch (ex) {
          toast(ex.message.toUpperCase(), "err");
        } finally {
          el.busy.delete(id);
          renderWidgets();
        }
      });
      return el;
    },
    update(r, cfg) {
      const all = LIVE.containers || [];
      if (!all.length) {
        r.sum.innerHTML = '<span class="pill idle">DOCKER UNAVAILABLE OR NO CONTAINERS</span>';
        r.list.innerHTML = "";
        return;
      }
      const running = all.filter(c => c.state === "running").length;
      r.sum.innerHTML =
        `<span class="pill ok"><i class="dot"></i>${running} UP</span>` +
        (all.length - running ? `<span class="pill crit"><i class="dot"></i>${all.length - running} DOWN</span>` : "");

      const rows = all
        .filter(c => cfg.show === "all" || (cfg.show === "running") === (c.state === "running"))
        .slice(0, cfg.limit || 10);

      r.list.innerHTML = rows.map(c => {
        const up = c.state === "running";
        const busy = r.busy.has(c.id);
        // Every published port, not just the first: an app with a web UI on one
        // port and an API on another was showing you only one of them.
        return `<div class="crow">
          <i class="cdot ${up ? "up" : "down"}"></i>
          <span class="cname" data-tip="${esc(c.image)}">${esc(c.title || c.name)}</span>
          <span class="cports">${up ? portLinks(c.ports, "cport") : ""}</span>
          <button class="cact" data-act="${up ? "stop" : "start"}" data-id="${esc(c.id)}"
                  data-nm="${esc(c.name)}" ${busy ? "disabled" : ""}>${busy ? "…" : up ? "STOP" : "START"}</button>
          <button class="cact" data-act="restart" data-id="${esc(c.id)}"
                  data-nm="${esc(c.name)}" ${busy || !up ? "disabled" : ""}>RESTART</button>
        </div>`;
      }).join("") || '<div class="empty">NOTHING MATCHES THAT FILTER</div>';
    } },

  uptime: { name: "Uptime", icon: ICON("power"), desc: "Time since last boot", w: 3, h: 2,
    mount(b) { b.innerHTML = '<div class="big"><span class="n" style="font-size:22px">--</span></div><span class="sub">since last boot</span>';
      return { n: $(".n", b) }; },
    update(r) { r.n.textContent = upfmt(LIVE.uptimeSec); } },

  clock: { name: "Clock", icon: ICON("clock"), desc: "Digital or analog, with the date", w: 3, h: 3,
    defaults: { face: "digital", h12: true, seconds: false },
    options: [
      { key: "face", label: "Face", values: [
        { value: "digital", label: "DIGITAL" }, { value: "analog", label: "ANALOG" }] },
      { key: "h12", label: "Format", values: [
        { value: true, label: "12 H" }, { value: false, label: "24 H" }] },
      { key: "seconds", label: "Seconds", values: [
        { value: false, label: "OFF" }, { value: true, label: "ON" }] }
    ],
    mount(b, cfg) {
      b.style.containerType = "inline-size";
      b.innerHTML = cfg.face === "analog"
        ? `<div class="analog"><svg viewBox="0 0 100 100" aria-label="Analog clock"></svg></div><div class="cdate"></div>`
        : `<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:6px">
             <div class="clockbig"></div><div class="cdate"></div></div>`;
      return { face: cfg.face, svg: $("svg", b), big: $(".clockbig", b), d: $(".cdate", b) };
    },
    update(r, cfg) {
      const n = new Date();
      r.d.textContent = fmtDate(n);

      if (r.face === "analog" && r.svg) {
        const hA = ((n.getHours() % 12) + n.getMinutes() / 60) * 30 - 90;
        const mA = (n.getMinutes() + n.getSeconds() / 60) * 6 - 90;
        const sA = n.getSeconds() * 6 - 90;
        const hand = (deg, len, wdt, col) => {
          const rad = deg * Math.PI / 180;
          return `<line x1="50" y1="50" x2="${(50 + Math.cos(rad) * len).toFixed(1)}"
                        y2="${(50 + Math.sin(rad) * len).toFixed(1)}"
                        stroke="${col}" stroke-width="${wdt}" stroke-linecap="round"/>`;
        };
        const ticks = Array.from({ length: 12 }, (_, i) => {
          const rad = (i * 30 - 90) * Math.PI / 180;
          const r1 = 42, r2 = i % 3 === 0 ? 34 : 38;
          return `<line x1="${(50 + Math.cos(rad) * r1).toFixed(1)}" y1="${(50 + Math.sin(rad) * r1).toFixed(1)}"
                        x2="${(50 + Math.cos(rad) * r2).toFixed(1)}" y2="${(50 + Math.sin(rad) * r2).toFixed(1)}"
                        stroke="${cssv("--text-3")}" stroke-width="${i % 3 === 0 ? 2.5 : 1.5}"/>`;
        }).join("");
        r.svg.innerHTML =
          `<circle cx="50" cy="50" r="46" fill="${cssv("--sunk")}" stroke="${cssv("--rule")}" stroke-width="2"/>` +
          ticks +
          hand(hA, 24, 4, cssv("--text")) +
          hand(mA, 34, 3, cssv("--text")) +
          (cfg.seconds ? hand(sA, 38, 1.5, colorCss(cfg.color)) : "") +
          `<circle cx="50" cy="50" r="3" fill="${colorCss(cfg.color)}"/>`;
        return;
      }

      if (r.big) r.big.textContent = fmtTime(n, cfg.h12, cfg.seconds);
    } },

  boot: { name: "Last Boot", icon: ICON("boot"), desc: "When the machine last started, and how long it has been up", w: 4, h: 3,
    defaults: { show: "both" },
    options: [
      { key: "show", label: "Show", values: [
        { value: "both", label: "BOTH" }, { value: "uptime", label: "UPTIME" }, { value: "when", label: "WHEN" }] }
    ],
    mount(b) {
      b.innerHTML = `<div class="big"><span class="n" style="font-size:0.62em">--</span></div>
                     <span class="sub sub1"></span><span class="sub sub2"></span>`;
      return { n: $(".n", b), s1: $(".sub1", b), s2: $(".sub2", b) };
    },
    update(r, cfg) {
      const sec = LIVE.uptimeSec || 0;
      // Boot time is derived from uptime rather than trusted from the client
      // clock alone, so it stays right even if the browser's time is skewed.
      const boot = new Date(Date.now() - sec * 1000);
      if (cfg.show === "when") {
        r.n.textContent = fmtTime(boot, true, false);
        r.s1.textContent = fmtDate(boot);
        r.s2.textContent = "up " + upfmt(sec);
      } else if (cfg.show === "uptime") {
        r.n.textContent = upfmt(sec);
        r.s1.textContent = "since last boot";
        r.s2.textContent = "";
      } else {
        r.n.textContent = upfmt(sec);
        r.s1.textContent = "booted " + fmtDate(boot) + " at " + fmtTime(boot, true, false);
        r.s2.textContent = sec > 86400 ? Math.floor(sec / 86400) + " full days of uptime" : "";
      }
    } },

  cat: { name: "Server Cat", icon: "/assets/brand/cat/content-a.png",
    // Roomier than the old one: there is a sprite, a speech bubble and a mood
    // badge to fit now, and at three columns the cat ends up thumbnail-sized.
    desc: "Your machine's mood, with opinions", w: 4, h: 6,
    defaults: { catName: "Nyx", gender: "she", chatty: "normal", rest: "auto", posture: "auto" },
    options: [
      { key: "gender", label: "Refer to her as", values: [
        { value: "she", label: "SHE" }, { value: "he", label: "HE" }] },
      { key: "rest", label: "Sleep", values: [
        { value: "auto", label: "AUTO" }, { value: "awake", label: "KEEP AWAKE" }, { value: "asleep", label: "LET SLEEP" }] },
      { key: "posture", label: "Posture", values: [
        { value: "auto", label: "AUTO" }, { value: "sit", label: "SITTING" }, { value: "stand", label: "STAND UP" }] },
      { key: "chatty", label: "Talks", values: [
        { value: "quiet", label: "RARELY" }, { value: "normal", label: "SOMETIMES" }, { value: "chatty", label: "A LOT" }] }
    ],
    // Naming the cat is the one setting that needs free text, so it gets a
    // prompt rather than a row of preset buttons.
    actions: [
      { label: "RENAME", icon: ICON("textsize"), run(it) {
        const cur = cfgOf(it).catName || "Nyx";
        const next = prompt("What is the cat called?", cur);
        if (next == null) return;
        const clean = next.trim().slice(0, 18);
        if (clean) setCfg({ catName: clean });
      } }
    ],
    mount(b, cfg) {
      b.innerHTML = `
        <div class="catwrap" tabindex="0" role="button" aria-label="${esc(cfg.catName || "the cat")}">
          <div class="catstage">
            <!-- The mover carries position, the image carries the breathing
                 animation. Both are transforms, so they need separate elements
                 or one overwrites the other. -->
            <div class="catmover">
              <img class="catimg" alt="" draggable="false">
              <span class="catz" hidden>z<i>z</i><b>z</b></span>
            </div>
            <!-- Inside the stage and absolutely positioned, so appearing and
                 disappearing can never change how much room the cat has. -->
            <div class="catbubble" hidden><span class="cbt"></span></div>
          </div>
          <div class="catfoot">
            <span class="catname"></span>
            <span class="catmood"><i class="mdot"></i><span class="mtxt"></span></span>
          </div>
        </div>`;
      const ref = {
        wrap: $(".catwrap", b), img: $(".catimg", b), z: $(".catz", b),
        stage: $(".catstage", b), mover: $(".catmover", b),
        bubble: $(".catbubble", b), bt: $(".cbt", b),
        nameEl: $(".catname", b), moodEl: $(".mtxt", b), dot: $(".mdot", b),
        mood: null, frame: 0, blinkUntil: 0, nextBeat: 0, saying: null, sayUntil: 0,
        pets: 0, lastPet: 0,
        // Where she has been put, as a fraction of the stage, so the spot
        // survives a resize and a reload rather than being pixels that stop
        // meaning anything the moment the widget changes size.
        px: cfg.catX ?? 0.5, py: cfg.catY ?? 1, dragging: false
      };
      wireCat(ref, cfg);
      catPlace(ref);
      return ref;
    },
    update(r, cfg) { catTick(r, cfg); } },

  /* ---------------------------------------------------------- CPU cores */
  cores: { name: "CPU Cores", icon: ICON("cpu"),
    desc: "Load on every core, so you can see one pegged thread", w: 4, h: 4,
    defaults: { mode: "grid", labels: true },
    options: [
      { key: "mode", label: "Display", values: [
        { value: "grid", label: "GRID" }, { value: "bars", label: "BARS" }] },
      { key: "labels", label: "Numbers", values: [
        { value: true, label: "ON" }, { value: false, label: "OFF" }] }
    ],
    mount(b, cfg) {
      b.innerHTML = `<div class="coregrid ${cfg.mode === "bars" ? "asbars" : ""}"></div><span class="sub"></span>`;
      return { box: $(".coregrid", b), sub: $(".sub", b), mode: cfg.mode };
    },
    update(r, cfg) {
      const cores = LIVE.cores || [];
      if (!cores.length) {
        r.box.innerHTML = '<span class="coreempty">waiting for the first sample…</span>';
        r.sub.textContent = "";
        return;
      }
      // Reusing the status colours on purpose: on a core, "busy" IS the meaning.
      const cls = v => (v >= 90 ? "crit" : v >= 70 ? "warn" : "");
      // One custom property, two orientations: the grid fills upwards, the bar
      // mode fills rightwards, and the stylesheet decides which without the
      // markup needing to know the layout.
      r.box.innerHTML = cores.map((v, i) => `
        <div class="core ${cls(v)}" style="--p:${clamp(v, 0, 100).toFixed(1)}%" title="Core ${i}: ${v}%">
          <div class="cfill"></div>
          ${cfg.labels ? `<span class="cn">${i}</span><span class="cv">${Math.round(v)}</span>` : ""}
        </div>`).join("");

      const busy = cores.filter(v => v >= 70).length;
      const peak = Math.max(...cores);
      const avg = cores.reduce((a, b) => a + b, 0) / cores.length;
      r.sub.textContent =
        `${cores.length} cores · avg ${Math.round(avg)}% · peak ${Math.round(peak)}%` +
        (busy ? ` · ${busy} busy` : "");
    } },

  /* ------------------------------------------------------ top processes */
  procs: { name: "Top Processes", icon: ICON("terminal"),
    desc: "What is actually using the machine right now", w: 5, h: 5,
    defaults: { by: "cpu", limit: 5 },
    options: [
      { key: "by", label: "Sort by", values: [
        { value: "cpu", label: "CPU" }, { value: "mem", label: "MEMORY" }] },
      { key: "limit", label: "How many", values: [
        { value: 3, label: "3" }, { value: 5, label: "5" }, { value: 8, label: "8" }, { value: 12, label: "12" }] }
    ],
    mount(b) {
      b.innerHTML = '<div class="proclist"></div><span class="sub"></span>';
      return { list: $(".proclist", b), sub: $(".sub", b) };
    },
    update(r, cfg) {
      const p = LIVE.procs || {};
      // Two orderings come from the server. Re-sorting one list by the other key
      // would show the hungriest of the busiest, which is not the same thing.
      const rows = (cfg.by === "mem" ? p.byMem : p.byCpu) || [];
      if (!rows.length) {
        r.list.innerHTML = '<span class="coreempty">reading the process table…</span>';
        r.sub.textContent = "";
        return;
      }
      const byMem = cfg.by === "mem";
      const key = byMem ? "mem" : "cpu";
      // Scale against the busiest row, not against 100. On an idle box every
      // process is under 2% and a bar scaled to 100 is invisible for all of
      // them — which is the shape the old version had.
      const top = Math.max(0.1, rows[0][key]);

      r.list.innerHTML = rows.slice(0, cfg.limit || 5).map(x => {
        const v = x[key];
        const pct = clamp((v / top) * 100, 1.5, 100);
        const cls = v >= 80 ? "crit" : v >= 40 ? "warn" : "";
        // Memory as real megabytes where the server could measure it. "1.4%"
        // means nothing without knowing the total; "312 MB" always means the
        // same thing.
        const shown = byMem && x.rss ? bytes(x.rss) : v.toFixed(1) + "%";
        return `<div class="prow" data-tip="pid ${x.pid}${x.user ? " · " + esc(x.user) : ""} · ${v.toFixed(1)}% ${byMem ? "of RAM" : "CPU"}">
          <span class="ptop">
            <span class="pname">${esc(x.name)}</span>
            <span class="pval">${esc(shown)}</span>
          </span>
          <span class="ptrack"><span class="pfill ${cls}" style="width:${pct.toFixed(1)}%"></span></span>
        </div>`;
      }).join("");

      r.sub.textContent =
        `by ${byMem ? "memory" : "CPU"}` +
        (p.total ? ` · ${p.total} processes` : "") +
        (p.at ? ` · ${since(p.at)}` : "");
    } },

  /* ------------------------------------------------------ disk activity */
  diskio: { name: "Disk Activity", icon: ICON("storage"),
    desc: "Read and write throughput, mirrored", w: 4, h: 4,
    defaults: { window: 60 },
    options: [
      { key: "window", label: "History", values: [
        { value: 60, label: "1 MIN" }, { value: 120, label: "2 MIN" }, { value: 240, label: "4 MIN" }] }
    ],
    mount(b) {
      b.innerHTML = `
        <div class="netrow">
          <div class="netstat"><span class="nlbl">READ</span><span class="nval rd">--</span></div>
          <div class="netstat"><span class="nlbl">WRITE</span><span class="nval wr">--</span></div>
          <span class="spacer"></span>
          <span class="npeak"></span>
        </div>
        <svg class="chart"></svg>`;
      return { rd: $(".rd", b), wr: $(".wr", b), peak: $(".npeak", b), svg: $("svg", b) };
    },
    update(r, cfg) {
      // Absent is not zero. Where the platform cannot report disk throughput,
      // say so rather than drawing a convincing flat line at nothing.
      if (!LIVE.disk) {
        r.rd.textContent = r.wr.textContent = "n/a";
        r.peak.textContent = "not reported on this platform";
        emptyChart(r.svg);
        return;
      }
      const n = cfg.window || 60;
      const dr = (LIVE.history.dr || []).slice(-n);
      const dw = (LIVE.history.dw || []).slice(-n);
      r.rd.textContent = rate(LIVE.disk.read);
      r.wr.textContent = rate(LIVE.disk.write);

      // One shared scale, or the two halves would lie about their relative size.
      const max = Math.max(65536, ...dr, ...dw);
      r.peak.textContent = `peak ${rate(max)}`;
      drawMirror(r.svg, dr, dw, max, colorCss(cfg.color), cssv("--text-2"),
        { upLabel: "READ", downLabel: "WRITE", fmt: rate });
    } },

  /* ------------------------------------------------------ security watch */
  security: { name: "Security Watch", icon: ICON("lock"),
    desc: "Failed logins, exposed ports and pending patches", w: 5, h: 5,
    defaults: { hours: 24, detail: "findings" },
    options: [
      { key: "hours", label: "Look back", values: [
        { value: 1, label: "1 H" }, { value: 24, label: "24 H" }, { value: 168, label: "7 D" }] },
      { key: "detail", label: "Show", values: [
        { value: "findings", label: "FINDINGS" }, { value: "tiles", label: "COUNTS ONLY" }] }
    ],
    // Which checks you care about. A box with SSH firewalled off has no use for
    // the SSH row, and a permanently-visible zero trains you to ignore it.
    picker: () => ({
      key: "hidden",
      label: "Checks",
      icon: ICON("lock"),
      empty: "No checks available.",
      items: [
        { value: "ssh", label: "Failed SSH logins", sub: "from the system journal" },
        { value: "nexus", label: "Failed Nexus logins", sub: "from the audit log" },
        { value: "ports", label: "Ports open to the network", sub: "listening on all interfaces" },
        { value: "updates", label: "Pending updates", sub: "security ones counted separately" },
        { value: "sessions", label: "Active login sessions", sub: "who is on the box" }
      ]
    }),
    mount(b) {
      b.innerHTML = '<div class="secwrap"><div class="sectiles"></div><div class="secfind"></div></div>';
      return { tiles: $(".sectiles", b), find: $(".secfind", b), wrap: $(".secwrap", b) };
    },
    update(r, cfg) {
      const d = LIVE.security[cfg.hours || 24];
      if (!d) {
        r.tiles.innerHTML = '<span class="coreempty">scanning…</span>';
        r.find.innerHTML = "";
        return;
      }
      const hide = hiddenSet(cfg);
      r.wrap.className = "secwrap lvl-" + (d.level || "ok");

      // A check that could not run reports "?" — not a zero. A zero that is
      // really "I failed to look" is the one number that must never appear here.
      const tile = (key, label, value, note, bad) => {
        if (hide.has(key)) return "";
        return `<div class="stile ${bad ? "bad" : ""}" title="${esc(note || "")}">
          <span class="sv">${esc(value)}</span>
          <span class="sl">${esc(label)}</span>
        </div>`;
      };

      const sshV = d.ssh?.ok ? d.ssh.count : "?";
      const nexV = d.nexus?.ok ? d.nexus.count : "?";
      const portV = d.ports?.ok ? d.ports.exposed : "?";
      const updV = d.updates?.ok ? (d.updates.security || 0) : "?";
      const sesV = d.sessions?.ok ? d.sessions.count : "?";

      r.tiles.innerHTML =
        tile("ssh", "SSH FAILS", sshV, d.ssh?.ok ? `${d.ssh.sources} distinct sources` : d.ssh?.reason, d.ssh?.ok && d.ssh.count >= 10) +
        tile("nexus", "NEXUS FAILS", nexV, "Failed logins to Nexus itself", d.nexus?.ok && d.nexus.count > 0) +
        tile("ports", "OPEN PORTS", portV, d.ports?.ok ? "Listening on all interfaces" : d.ports?.reason, false) +
        tile("updates", "SEC. UPDATES", updV, d.updates?.ok ? `${d.updates.total} updates in total` : d.updates?.reason, d.updates?.ok && d.updates.security > 0) +
        tile("sessions", "SESSIONS", sesV, d.sessions?.ok ? "Active logins right now" : d.sessions?.reason, false);

      if (cfg.detail !== "findings") { r.find.innerHTML = ""; return; }

      const shown = (d.findings || []).filter(f => {
        if (hide.has("ssh") && /SSH/i.test(f.title)) return false;
        if (hide.has("nexus") && /Nexus login/i.test(f.title)) return false;
        if (hide.has("ports") && /port/i.test(f.title)) return false;
        if (hide.has("updates") && /update/i.test(f.title)) return false;
        if (hide.has("sessions") && /session/i.test(f.title)) return false;
        return true;
      });

      r.find.innerHTML = shown.map(f => `
        <div class="sfind ${esc(f.level)}">
          <span class="st">${esc(f.title)}</span>
          <span class="sd">${esc(f.detail || "")}</span>
        </div>`).join("") || '<div class="sfind ok"><span class="st">Nothing to report</span></div>';
    } },

  host: { name: "Host", icon: ICON("home"),
    desc: "What this machine is, and how to reach it", w: 4, h: 4,
    defaults: { dense: false },
    options: [
      { key: "dense", label: "Layout", values: [
        { value: false, label: "ROOMY" }, { value: true, label: "DENSE" }] }
    ],
    // Which lines matter differs by person: someone with one box does not need
    // the interface name, someone with three needs the address above all.
    picker: () => ({
      key: "hidden",
      label: "Rows",
      icon: ICON("home"),
      empty: "No host details yet.",
      items: [
        { value: "ip", label: "Address", sub: "the LAN IP you reach it on" },
        { value: "os", label: "Operating system" },
        { value: "kernel", label: "Kernel" },
        { value: "cpu", label: "CPU", sub: "model and core count" },
        { value: "ram", label: "Memory", sub: "total installed" },
        { value: "arch", label: "Architecture" },
        { value: "up", label: "Uptime" }
      ]
    }),
    mount(b, cfg) {
      b.innerHTML = `<dl class="hostkv ${cfg.dense ? "dense" : ""}"></dl>`;
      return { l: $("dl", b) };
    },
    update(r, cfg) {
      const i = LIVE.info;
      if (!i) { r.l.innerHTML = '<div class="coreempty">loading…</div>'; return; }
      const hide = hiddenSet(cfg);

      // The address is a link: it is the thing you are most likely to want to
      // do something with, and copying an IP by eye is a small daily annoyance.
      const ip = i.host?.ip4;
      const rows = [
        ["ip", "Address", ip
          ? `<a href="http://${esc(ip)}" target="_blank" rel="noopener" data-tip="Open http://${esc(ip)}">${esc(ip)}</a>`
          + (i.host?.iface ? ` <span class="hdim">${esc(i.host.iface)}</span>` : "")
          : null, true],
        ["os", "OS", i.host?.distro],
        ["kernel", "Kernel", i.host?.kernel],
        ["cpu", "CPU", i.cpu?.model ? `${esc(i.cpu.model)}${i.cpu.cores ? ` <span class="hdim">${i.cpu.cores} cores</span>` : ""}` : null, true],
        ["ram", "Memory", LIVE.memTotal ? bytes(LIVE.memTotal) : null],
        ["arch", "Arch", i.host?.arch],
        ["up", "Uptime", LIVE.uptimeSec ? upfmt(LIVE.uptimeSec) : null]
      ];

      r.l.className = "hostkv" + (cfg.dense ? " dense" : "");
      r.l.innerHTML = rows
        .filter(([key, , val]) => val && !hide.has(key))
        .map(([, label, val, raw]) =>
          `<dt>${label}</dt><dd>${raw ? val : esc(val)}</dd>`)
        .join("") || '<div class="coreempty">every row is hidden — right-click to bring one back</div>';
    } }
};

/* ============================ the cat ============================ */
/**
 * A mood ring for the machine.
 *
 * The point is that every mood is driven by something real — CPU, temperature,
 * memory, whether a container has fallen over. A cat that is simply cute tells
 * you nothing; a cat that is visibly cross because the box is at 95°C has told
 * you the same thing a gauge would, and you will notice it from across a room.
 */
const CAT_MOODS = {
  sleepy:  { label: "Sleepy",  beat: 2600, tail: "slow"  },
  content: { label: "Content", beat: 1800, tail: "easy"  },
  alert:   { label: "Alert",   beat: 1000, tail: "quick" },
  grumpy:  { label: "Grumpy",  beat: 620,  tail: "lash"  }
};

/**
 * Moods that have a blink frame drawn for them.
 *
 * Sleepy is already asleep with its eyes shut, and grumpy is squinting — a
 * blink would read as nothing in either. Add a mood here when its art exists.
 */
const CAT_BLINK = new Set(["content", "alert"]);

function catMood() {
  const temp = LIVE.sensors?.find(s => s.kind === "temperature")?.value ?? 0;
  const down = (LIVE.containers || []).filter(c => c.state !== "running").length;
  const disk = Math.max(0, ...(LIVE.disks || []).map(d => d.usage || 0));

  if (temp >= 80 || LIVE.cpu >= 88 || LIVE.mem >= 92 || disk >= 95) return "grumpy";
  if (LIVE.cpu >= 55 || LIVE.mem >= 75 || down > 0 || disk >= 88) return "alert";
  if (LIVE.cpu >= 20) return "content";
  return "sleepy";
}

/** How the cat is referred to in its own dialogue. */
function catPronoun(cfg) {
  return cfg.gender === "he"
    ? { they: "he", them: "him", their: "his", theyre: "he's" }
    : { they: "she", them: "her", their: "her", theyre: "she's" };
}

/**
 * What the cat says. {name} and the pronouns are substituted at display time,
 * so renaming the cat or changing how it is referred to rewrites every line —
 * nothing here hardcodes a name.
 */
const CAT_LINES = {
  sleepy: [
    "zzz...", "do not disturb", "five more minutes", "the fans are quiet. good.",
    "nothing is on fire", "{name} is off duty", "a fine day for doing nothing",
    "idle is a lifestyle", "wake me if a disk fills", "warm. dark. perfect.",
    "the load average is a rumour", "purring at 0.02 load",
    "dreaming of empty log files", "everything is fine and I am asleep",
    "{name} has entered low power mode"
  ],
  content: [
    "ticking along nicely", "all services accounted for", "this is a good box",
    "{name} approves", "steady as you like", "no complaints today",
    "the containers behave themselves", "uptime is a kind of love",
    "somebody has been tidying", "green across the board",
    "I have inspected the logs. they are fine.", "a respectable amount of RAM",
    "the disks spin sweetly", "you may pet {name}", "everything in its place",
    "{name} is supervising"
  ],
  alert: [
    "something is happening", "ears up", "{name} noticed that",
    "who started that?", "the fans have opinions now", "watching closely",
    "that container looks shifty", "CPU is getting ideas", "I am not worried. yet.",
    "memory is filling up, just so you know", "keeping an eye on it",
    "{name} does not love this", "somebody is compiling something",
    "stand by", "this is fine. probably."
  ],
  grumpy: [
    "it is TOO WARM in here", "unacceptable", "{name} is displeased",
    "turn something off", "hssss", "my box is cooking",
    "check the fans. now.", "this is not fine", "I will remember this",
    "whoever did this, {name} knows", "the thermals are an insult",
    "somebody fix it", "I am too hot to be charming", "no more containers. NO MORE.",
    "{name} demands airflow"
  ],
  // Said on a click, so they acknowledge the interaction rather than the load.
  petted: [
    "mrrp", "purrrr", "again", "{name} permits this", "yes. there.",
    "acceptable human behaviour", "you may continue", "*headbutt*",
    "that is the spot", "{theyre} pleased", "prrrrt", "one more",
    "I suppose you are alright", "*slow blink*", "you have been promoted"
  ],
  // The fourth-or-more click in quick succession.
  overpetted: [
    "that is enough", "{name} has had sufficient", "careful", "*tail flick*",
    "we were having such a nice time", "I said enough", "you are pushing it",
    "*ears back*"
  ],
  // Said while being carried around the widget.
  carried: [
    "whoa", "put me DOWN", "this is undignified", "wheee",
    "{name} did not consent to this", "*dangling*", "where are we going",
    "I was comfortable", "unhand me", "*flails*", "this is not a cat carrier",
    "you are going to drop me"
  ],
  // Said on landing.
  dropped: [
    "*lands on feet*", "obviously", "I meant to do that", "hmph",
    "this spot will do", "{name} accepts this location", "*shakes out fur*",
    "never speak of this", "acceptable", "much better actually"
  ]
};

/** Fill {name} / {they} / {them} / {their} / {theyre} in a line. */
function catSay(line, cfg) {
  const p = catPronoun(cfg);
  return String(line)
    .replaceAll("{name}", cfg.catName || "the cat")
    .replaceAll("{they}", p.they).replaceAll("{them}", p.them)
    .replaceAll("{their}", p.their).replaceAll("{theyre}", p.theyre);
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/** How long between unprompted remarks, by how talkative you asked for. */
const CAT_GAP = { quiet: [45000, 90000], normal: [18000, 40000], chatty: [7000, 16000] };

function catSpeak(r, cfg, line, ms = 4200) {
  r.saying = catSay(line, cfg);
  r.sayUntil = Date.now() + ms;
  r.bt.textContent = r.saying;
  r.bubble.hidden = false;
  r.bubble.classList.remove("pop");
  void r.bubble.offsetWidth;              // restart the animation
  r.bubble.classList.add("pop");
}

function wireCat(r, cfg) {
  // catTick stamps the live config onto the ref every frame, so a rename takes
  // effect in what the cat says without rebinding any of these handlers.
  const speakNow = lines => catSpeak(r, r.cfg || cfg, pick(lines));

  // A click is a pet. Several in a row and the cat's patience runs out, which
  // is both funnier and more cat-like than an endless supply of purring.
  r.wrap.addEventListener("click", e => {
    if (e.target.closest("button, a")) return;
    const now = Date.now();
    r.pets = now - r.lastPet < 3500 ? r.pets + 1 : 1;
    r.lastPet = now;
    r.wrap.classList.remove("pet");
    void r.wrap.offsetWidth;
    r.wrap.classList.add("pet");
    speakNow(r.pets >= 4 ? CAT_LINES.overpetted : CAT_LINES.petted);
    // Beat fast for a moment. The two frames differ by tail position, so this
    // reads as a tail flick without needing any extra art.
    r.flickUntil = now + 900;
    r.nextBeat = 0;
  });

  // Hovering wakes the cat: it looks up while you are pointing at it.
  r.wrap.addEventListener("pointerenter", () => { r.hovering = true; });
  r.wrap.addEventListener("pointerleave", () => { r.hovering = false; });
  r.wrap.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.wrap.click(); }
  });

  /* ---- picking the cat up and moving her around her own box ---- */
  /**
   * stopPropagation is what keeps this from becoming a widget drag: the
   * widget's own handler sits on an ancestor in the bubble phase, so stopping
   * here means grabbing the cat moves the cat and grabbing anywhere else in
   * the widget still moves the widget.
   */
  r.mover.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();

    const stage = r.stage.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, px: r.px, py: r.py };
    let moved = false;
    try { r.mover.setPointerCapture(e.pointerId); } catch {}

    const mv = ev => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;   // still a click
      if (!moved) {
        moved = true;
        r.dragging = true;
        r.wrap.classList.add("carrying");
        catSpeak(r, r.cfg || cfg, pick(CAT_LINES.carried));
        r.flickUntil = Date.now() + 60_000;   // tail going while she is in the air
      }
      // Fractions of the stage, clamped so she cannot be dropped outside her box.
      r.px = clamp(start.px + dx / Math.max(1, stage.width), 0.08, 0.92);
      r.py = clamp(start.py + dy / Math.max(1, stage.height), 0.18, 1);
      catPlace(r);
    };

    const up = () => {
      r.mover.removeEventListener("pointermove", mv);
      r.mover.removeEventListener("pointerup", up);
      r.mover.removeEventListener("pointercancel", up);
      try { r.mover.releasePointerCapture(e.pointerId); } catch {}
      if (!moved) return;                    // it was a pet, not a carry
      r.dragging = false;
      r.flickUntil = Date.now() + 700;       // one last indignant flick
      r.wrap.classList.remove("carrying");
      r.wrap.classList.add("landed");
      setTimeout(() => r.wrap.classList.remove("landed"), 340);
      catSpeak(r, r.cfg || cfg, pick(CAT_LINES.dropped));
      setCfgFor(r.item, { catX: round2(r.px), catY: round2(r.py) });
    };

    r.mover.addEventListener("pointermove", mv);
    r.mover.addEventListener("pointerup", up);
    r.mover.addEventListener("pointercancel", up);
  });
}

const round2 = n => Math.round(n * 100) / 100;

/** Put the cat where she has been left, as a fraction of her stage. */
function catPlace(r) {
  if (!r.mover) return;
  r.mover.style.left = (r.px * 100).toFixed(2) + "%";
  r.mover.style.top = (r.py * 100).toFixed(2) + "%";
}

/**
 * One animation step. Called on the shared 1s render tick plus every metrics
 * frame, so it has to be cheap and idempotent — all timing is against wall
 * clock rather than assuming a fixed cadence.
 */
/**
 * Standing up is a scripted sequence, not a single swap.
 *
 * A cat that teleports from sitting to standing looks broken. These frames play
 * in order — settle, push up, stretch — and the same list runs backwards to sit
 * down again, so the two transitions cost one set of art.
 */
const CAT_RISE = ["rise-1", "rise-2", "rise-3", "rise-4", "rise-5"];
const RISE_MS = 95;               // ~475ms for the whole movement
const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const prefersQuietMotion = () => document.documentElement.dataset.motion === "reduced" || reducedMotionQuery.matches;

/** The pose the cat should be in, before any transition is applied. */
function catPosture(r, cfg, mood, now) {
  if (cfg.posture === "stand") return "stand";
  if (cfg.posture === "sit") return "sit";
  // Auto: the cat gets up now and then, more often when the box is busy, and
  // never while it is asleep.
  if (mood === "sleepy") return "sit";
  if (!r.nextStandRoll || now >= r.nextStandRoll) {
    r.nextStandRoll = now + 12000 + Math.random() * 20000;
    const odds = mood === "grumpy" ? 0.55 : mood === "alert" ? 0.4 : 0.22;
    r.autoStand = Math.random() < odds;
  }
  return r.autoStand ? "stand" : "sit";
}

function catTick(r, cfg) {
  const now = Date.now();
  r.cfg = cfg;

  // Sleep can be forced either way. "Auto" follows the machine, which is why
  // an idle box shows a sleeping cat — that is the reading, not a bug.
  const natural = catMood();
  const mood = cfg.rest === "asleep" ? "sleepy"
             : cfg.rest === "awake" && natural === "sleepy" ? "content"
             : natural;
  const spec = CAT_MOODS[mood];
  // Asking for STAND UP means asking the cat to be up, so it overrides sleep —
  // a control that visibly does nothing is worse than not offering it.
  const asleep = mood === "sleepy" && cfg.posture !== "stand";

  if (mood !== r.mood) {
    r.mood = mood;
    r.frame = 0;
    r.nextBeat = 0;
    // A mood change is worth remarking on, so the cat reacts when the box does.
    if (r.moodSeen && !asleep) catSpeak(r, cfg, pick(CAT_LINES[mood]));
    r.moodSeen = true;
    r.nextLine = now + 6000;
  }

  /* ---- posture, with a real transition between the two ---- */
  const want = asleep ? "sit" : catPosture(r, cfg, mood, now);
  const quiet = prefersQuietMotion();
  if (quiet) { r.posture = want; r.rise = null; r.frame = 0; r.blinkUntil = 0; }
  if (!r.posture) r.posture = want;
  if (want !== r.posture && !r.rise) {
    r.rise = { to: want, step: 0, at: now };     // start the sit<->stand sequence
  }
  let riseFrame = null;
  if (r.rise) {
    if (now - r.rise.at >= RISE_MS) {
      r.rise.step++;
      r.rise.at = now;
    }
    if (r.rise.step >= CAT_RISE.length) {
      r.posture = r.rise.to;
      r.rise = null;
    } else {
      // Standing up runs the frames forwards; sitting down runs them backwards.
      riseFrame = r.rise.to === "stand"
        ? CAT_RISE[r.rise.step]
        : CAT_RISE[CAT_RISE.length - 1 - r.rise.step];
    }
  }

  r.wrap.className = "catwrap mood-" + mood
    + (r.posture === "stand" ? " standing" : "")
    + (r.rise ? " rising" : "");

  r.nameEl.textContent = cfg.catName || "Nyx";
  r.moodEl.textContent = asleep ? "Asleep" : spec.label;
  r.z.hidden = !asleep;

  /* ---- frame timing ---- */
  // A click flicks the tail: the two frames differ by tail position, so beating
  // fast between them for a moment is a tail flick without any extra art.
  const flicking = now < (r.flickUntil || 0);
  const beat = flicking ? 110
    : r.hovering ? Math.max(420, spec.beat * 0.45)
    : spec.beat;

  if (!quiet && now >= r.nextBeat) {
    r.frame ^= 1;
    r.nextBeat = now + beat;
    // Blinks are brief and occasional — a 50% duty cycle would look like a
    // malfunction rather than a cat.
    if (!asleep && !flicking && Math.random() < 0.22) r.blinkUntil = now + 160;
  }

  /* ---- which image ---- */
  let src;
  if (riseFrame) {
    src = `/assets/brand/cat/${riseFrame}.png`;
  } else if (r.posture === "stand" && !asleep) {
    src = `/assets/brand/cat/stand-${r.frame ? "b" : "a"}.png`;
  } else {
    // Blink frames are optional art. A mood without one simply does not blink,
    // rather than requesting a file that is not there.
    const blinking = now < r.blinkUntil && CAT_BLINK.has(mood);
    src = `/assets/brand/cat/${mood}-${blinking ? "blink" : (r.frame ? "b" : "a")}.png`;
  }
  if (r.img.getAttribute("src") !== src) r.img.setAttribute("src", src);
  r.img.alt = `${cfg.catName || "the cat"} looking ${(asleep ? "asleep" : spec.label).toLowerCase()}`;

  /* ---- talking ---- */
  // A sleeping cat mumbles rarely; it does not hold forth about disk usage.
  const gap = CAT_GAP[cfg.chatty] || CAT_GAP.normal;
  const scale = asleep ? 3 : 1;
  if (!r.nextLine) r.nextLine = now + gap[0] * scale;
  if (now >= r.nextLine && now >= r.sayUntil) {
    catSpeak(r, cfg, pick(CAT_LINES[mood]));
    r.nextLine = now + (gap[0] + Math.random() * (gap[1] - gap[0])) * scale;
  }

  if (r.saying && now >= r.sayUntil) {
    r.saying = null;
    r.bubble.hidden = true;
  }
}

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

/**
 * Push overlapping widgets downwards.
 *
 * `anchors` are the widgets the user is actively moving — they hold their
 * position and everything else gets out of the way. It takes a set rather than
 * a single id so a multi-widget drag resolves as one movement instead of the
 * group shoving its own members around.
 */
function resolve(anchors) {
  const held = anchors instanceof Set ? anchors : new Set([anchors].flat().filter(v => v != null));
  let guard = 0, moved = true;
  while (moved && guard++ < 300) {
    moved = false;
    for (const a of items) for (const b of items) {
      if (a === b || held.has(b.id)) continue;
      if (overlap(a, b) && (held.has(a.id) || a.y < b.y || (a.y === b.y && a.x < b.x))) { b.y = a.y + a.h; moved = true; }
    }
  }
}
/** Kept for the RESET action only — normal edits leave widgets where you put them. */
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
    stackSorted().forEach(it => {
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

/* ---------------------------- selection ---------------------------- */
/**
 * Ctrl/Cmd-click builds a selection; a selection then drags, deletes and
 * restyles as one thing. The Set holds ids rather than objects so it survives a
 * layout reload without dangling references.
 */
let selection = new Set();

function paintSelection() {
  items.forEach(it => {
    const el = document.getElementById("w" + it.id);
    if (el) el.classList.toggle("selected", selection.has(it.id));
  });
  const n = selection.size;
  const bar = $("#selbar");
  if (bar) {
    bar.hidden = n < 1;
    const c = $("#selcount");
    if (c) c.textContent = n === 1 ? "1 WIDGET SELECTED" : `${n} WIDGETS SELECTED`;
  }
}
function clearSelection() { if (selection.size) { selection.clear(); paintSelection(); } }
function toggleSelect(id) {
  if (selection.has(id)) selection.delete(id); else selection.add(id);
  paintSelection();
}
function selectAll() { selection = new Set(items.map(i => i.id)); paintSelection(); }
const selectedItems = () => items.filter(i => selection.has(i.id));

function build(it, animate) {
  const def = REG[it.t];
  if (!def) return;
  const el = document.createElement("div");
  el.className = "w" + (animate ? " spawn" : "") + (selection.has(it.id) ? " selected" : "");
  el.id = "w" + it.id;
  // The gear is not decoration: touch has no right-click, so without a visible
  // control there is no way to reach a widget's settings on a phone or an iPad.
  el.innerHTML =
    `<div class="w-head" data-tip="${esc(def.desc)} — drag to move, right-click or press the gear for settings">` +
      `<img src="${def.icon}" alt=""><span class="t">${esc(def.name.toUpperCase())}</span>` +
      `<button class="w-cfg" aria-label="Widget settings" data-tip="Size, colour and options">&#9881;</button>` +
      `<button class="w-x" aria-label="Remove widget" data-tip="Remove this widget">&times;</button>` +
    `</div>` +
    `<div class="w-body"></div>` +
    `<div class="w-rs" data-tip="Drag to resize"></div>`;
  gridEl.appendChild(el);
  applyCfg(el, it);
  mounted[it.id] = { def, ref: def.mount($(".w-body", el), cfgOf(it)), it };
  if (mounted[it.id].ref) mounted[it.id].ref.item = it;   // for setCfgFor from inside
  $(".w-x", el).addEventListener("click", e => { e.stopPropagation(); removeWidgets([it.id]); });
  $(".w-cfg", el).addEventListener("click", e => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const group = selection.has(it.id) && selection.size > 1 ? selectedItems() : [it];
    openCtx(group, r.left, r.bottom + 4);
  });

  // Ctrl/Cmd-click toggles selection from anywhere in the widget, including over
  // its buttons. Capture phase and stopPropagation, so a ctrl-click on a
  // container's STOP button selects the widget instead of stopping a container.
  el.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleSelect(it.id);
      return;
    }
    // A plain press outside the current selection starts a fresh one.
    if (selection.size && !selection.has(it.id)) clearSelection();
  }, true);

  // Right-click opens settings — for the whole selection if this widget is part
  // of one, otherwise just for this widget.
  el.addEventListener("contextmenu", e => {
    e.preventDefault();
    e.stopPropagation();
    const group = selection.has(it.id) && selection.size > 1 ? selectedItems() : [it];
    if (!selection.has(it.id)) clearSelection();
    openCtx(group, e.clientX, e.clientY);
  });

  dragify(el, it); resizify(el, it);
  place(el, it);
  try { def.update(mounted[it.id].ref, cfgOf(it)); } catch {}
}

function removeWidgets(ids) {
  const kill = new Set(ids);
  if (!kill.size) return;
  kill.forEach(id => {
    const el = document.getElementById("w" + id);
    if (el) el.remove();
    delete mounted[id];
    selection.delete(id);
  });
  items = items.filter(i => !kill.has(i.id));
  paintSelection();
  layout();
}

/** Delete / Backspace removes the selection. */
function deleteSelection() {
  const n = selection.size;
  if (!n) return;
  if (n > 1 && !confirm(`Remove ${n} widgets from the dashboard?`)) return;
  removeWidgets([...selection]);
  toast(n === 1 ? "WIDGET REMOVED" : `${n} WIDGETS REMOVED`, "ok");
}

/** True when a keystroke belongs to whatever the user is typing in. */
function typingInto(el) {
  if (!el) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}
const onDashboard = () => $("#page-dash")?.classList.contains("on") && !$("#app").hidden;

addEventListener("keydown", e => {
  if (typingInto(document.activeElement)) return;
  if (modal.classList.contains("open")) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    if (!onDashboard()) return;
    e.preventDefault();
    selectAll();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (onDashboard() && selection.size) { e.preventDefault(); deleteSelection(); return; }
    if ($("#page-files")?.classList.contains("on") && fileSel.size) { e.preventDefault(); deleteFileSelection(); return; }
  }
  if (e.key === "Escape") { clearSelection(); clearFileSelection(); clipClear(); }

  // Ctrl/Cmd C, X, V on the files page — the shortcuts everyone already knows.
  if (!$("#page-files")?.classList.contains("on")) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "c" && fileSel.size) { e.preventDefault(); clipTake(false); }
  else if (k === "x" && fileSel.size) { e.preventDefault(); clipTake(true); }
  else if (k === "v" && fileClip.paths.length) { e.preventDefault(); pasteInto(curDir); }
});

/* ---- rubber-band select on the canvas ----
   Only ever starts on the canvas itself. A press that lands on a widget is that
   widget's drag, so the two gestures never have to arbitrate. */
(function widgetMarquee() {
  let band = null, sx = 0, sy = 0, active = false, additive = false;

  const toGrid = (cx, cy) => {
    const r = gridEl.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };

  gridEl.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target !== gridEl) return;
    const p = toGrid(e.clientX, e.clientY);
    sx = p.x; sy = p.y; active = true;
    additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!additive) clearSelection();
    gridEl.setPointerCapture(e.pointerId);
  });

  gridEl.addEventListener("pointermove", e => {
    if (!active) return;
    const p = toGrid(e.clientX, e.clientY);
    const w = Math.abs(p.x - sx), h = Math.abs(p.y - sy);
    if (!band && w < 5 && h < 5) return;        // ignore a jittery click

    if (!band) {
      band = document.createElement("div");
      band.className = "wband";
      gridEl.appendChild(band);
    }
    const left = Math.min(sx, p.x), top = Math.min(sy, p.y);
    band.style.cssText = `left:${left}px;top:${top}px;width:${w}px;height:${h}px`;

    const gr = gridEl.getBoundingClientRect();
    const box = { l: left, t: top, r: left + w, b: top + h };
    const base = additive ? new Set(selection) : new Set();
    items.forEach(it => {
      const el = document.getElementById("w" + it.id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const l = r.left - gr.left, t = r.top - gr.top;
      if (l < box.r && l + r.width > box.l && t < box.b && t + r.height > box.t) base.add(it.id);
    });
    selection = base;
    paintSelection();
  });

  const end = e => {
    if (!active) return;
    active = false;
    try { gridEl.releasePointerCapture(e.pointerId); } catch {}
    if (band) { band.remove(); band = null; }
    else if (!additive) clearSelection();       // a plain click on empty canvas
  };
  gridEl.addEventListener("pointerup", end);
  gridEl.addEventListener("pointercancel", end);
})();
/** Already on the dashboard? The library and addWidget both ask this. */
const widgetInUse = type => items.some(i => i.t === type);

function addWidget(type) {
  const d = REG[type];
  if (!d) return;
  // One of each. Enforced here rather than only in the library, so the rule
  // holds however the widget is added.
  if (widgetInUse(type)) {
    toast("ALREADY ON THE DASHBOARD", "err");
    return;
  }
  const maxY = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  const it = { id: uid++, t: type, x: 0, y: maxY, w: d.w, h: d.h };
  items.push(it); build(it, true); layout();
  if (type === "security") pollSecurity();
  $("#main").scrollTo({ top: 1e6, behavior: "smooth" });
}

/**
 * The widget library, rebuilt every time it opens.
 *
 * Rebuilding rather than patching means the "already added" state cannot drift
 * out of sync with the dashboard — there is no path where a widget is removed
 * and the library still believes it is in use.
 *
 * Used cards stay readable rather than being faded to near-nothing: you still
 * need to read the name to understand why you cannot add it, and a card you
 * cannot read is just a gap in the grid.
 */
function renderDrawer() {
  const body = $("#dbody");
  if (!body) return;

  const types = Object.keys(REG);
  body.innerHTML = "";

  for (const k of types) {
    const d = REG[k];
    const used = widgetInUse(k);

    const b = document.createElement("button");
    b.className = "card" + (used ? " used" : "");
    b.dataset.type = k;
    // aria-disabled rather than the disabled attribute: a disabled button fires
    // no pointer events, so it would lose its tooltip and give no feedback at
    // all when pressed — which reads as the UI being broken.
    b.setAttribute("aria-disabled", String(used));
    b.setAttribute("data-tip", used
      ? `Already on the dashboard. Remove it there to add it again.`
      : d.desc);

    b.innerHTML =
      `<img src="${d.icon}" alt="">` +
      `<span class="ct">` +
        `<span class="cn">${esc(d.name.toUpperCase())}</span>` +
        `<span class="cd">${esc(d.desc)}</span>` +
        (used ? `<span class="cused"><i>&#10003;</i>ON DASHBOARD</span>` : "") +
      `</span>`;

    b.addEventListener("click", () => {
      if (widgetInUse(k)) {
        toast("ALREADY ON THE DASHBOARD", "err");
        return;                      // the drawer stays open; nothing happened
      }
      addWidget(k);
      $("#drawer").classList.remove("open");
    });

    body.appendChild(b);
  }

  const count = $("#dcount");
  if (count) {
    const n = types.filter(widgetInUse).length;
    count.textContent = `${n} of ${types.length} added`;
  }
}
function renderWidgets() {
  for (const id in mounted) {
    const m = mounted[id];
    try { m.def.update(m.ref, cfgOf(m.it)); } catch {}
  }
  // Every chart has just been redrawn underneath the pointer. Read it again, or
  // a resting crosshair would go on displaying the sample it first landed on.
  refreshProbe();
}

/**
 * Fetch a security scan for each lookback window currently on the dashboard.
 *
 * Only for windows actually in use: the scan reads the journal and asks apt what
 * is pending, and doing that for three windows nobody is looking at is work the
 * box does not need to do.
 */
let secBusy = false;
async function pollSecurity() {
  if (secBusy) return;
  const wanted = new Set(
    items.filter(i => i.t === "security").map(i => cfgOf(i).hours || 24));
  if (!wanted.size) return;

  secBusy = true;
  try {
    for (const h of wanted) {
      try { LIVE.security[h] = await api(`/system/security?hours=${h}`); } catch {}
    }
    renderWidgets();
  } finally { secBusy = false; }
}

/** Things inside a widget that own their own click and must not start a drag. */
const NO_DRAG = "button, a, input, select, textarea, .w-rs, [contenteditable]";

/** The drag in progress, so Escape can reach it from anywhere. */
let activeDrag = null;

/**
 * One drag, shared by mouse and touch.
 *
 * Returns { move, end }. The two input paths differ only in when a drag is
 * allowed to start — a mouse commits after 5px of travel, a finger has to hold
 * still for a moment first — so everything after that point is this function.
 */
function startDragSession(el, it, sx, sy) {
  const group = selection.has(it.id) && selection.size > 1 ? selectedItems() : [it];
  const ids = new Set(group.map(g => g.id));

  group.forEach(g => document.getElementById("w" + g.id)?.classList.add("dragging"));

  // Stacked (phone) mode is a list, not a canvas: there is one column, so the
  // only meaningful drag is reordering. Position is decided by which widget the
  // finger is currently over rather than by a grid delta.
  if (isNarrow()) {
    return {
      move(_cx, cy) { stackDragTo(el, cy); },
      end() {
        group.forEach(g => document.getElementById("w" + g.id)?.classList.remove("dragging"));
        commitStackOrder();
      }
    };
  }

  // The arrangement before anything moved. Every frame of the drag is computed
  // from THIS, never from the previous frame.
  //
  // Without it, resolve() pushes widgets out of the way and they stay pushed:
  // drag a widget across the canvas and back to where it started and your
  // layout is permanently rearranged, because each frame displaced the
  // already-displaced result of the last one. Restoring the snapshot first
  // makes the layout a pure function of where the pointer is now, so wandering
  // around costs nothing and returning to the start undoes itself.
  const snapshot = new Map(items.map(i => [i.id, { x: i.x, y: i.y }]));
  const restore = () => {
    for (const i of items) {
      const s = snapshot.get(i.id);
      if (s) { i.x = s.x; i.y = s.y; }
    }
  };

  const cw = cellW();
  // Clamp the delta against the group's bounding box, not each widget, or the
  // leftmost one would stop while the rest kept going and the shape collapsed.
  const minX = Math.min(...group.map(g => g.x));
  const maxRight = Math.max(...group.map(g => g.x + g.w));
  const minY = Math.min(...group.map(g => g.y));

  const ghost = showGhost();
  let fits = true;

  const apply = (cx, cy) => {
    restore();
    const dx = clamp(Math.round((cx - sx) / (cw + GAP)), -minX, COLS - maxRight);
    const dy = Math.max(-minY, Math.round((cy - sy) / (ROW + GAP)));

    for (const g of group) {
      const s = snapshot.get(g.id);
      g.x = s.x + dx;
      g.y = s.y + dy;
    }

    // Does the group land in genuinely free space? If so nothing else needs to
    // move at all, and the ghost says as much before you let go.
    fits = !items.some(a => !ids.has(a.id) && group.some(g => overlap(a, g)));
    if (!fits) resolve(ids);

    layout(false);
    group.forEach(g => { const ge = document.getElementById("w" + g.id); if (ge) place(ge, g); });
    placeGhost(ghost, group, fits);
  };

  return {
    move: apply,
    /** Put everything back exactly as it was and drop the drag. */
    cancel() {
      restore();
      hideGhost(ghost);
      group.forEach(g => document.getElementById("w" + g.id)?.classList.remove("dragging"));
      layout();
    },
    end() {
      hideGhost(ghost);
      group.forEach(g => document.getElementById("w" + g.id)?.classList.remove("dragging"));
      layout();
    }
  };
}

/* ---------------------------- drop preview ---------------------------- */
/**
 * A rectangle the size of what you are carrying, drawn where it would land.
 *
 * `fits` is the whole point of it: green means the space is empty and nothing
 * else will move, amber means the drop will push other widgets aside. You can
 * see which before committing rather than after.
 */
function showGhost() {
  if (isNarrow()) return null;              // the stacked list has no free space
  const el = document.createElement("div");
  el.className = "wghost";
  gridEl.appendChild(el);
  return el;
}

function placeGhost(el, group, fits) {
  if (!el) return;
  const box = {
    x: Math.min(...group.map(g => g.x)),
    y: Math.min(...group.map(g => g.y)),
    w: Math.max(...group.map(g => g.x + g.w)) - Math.min(...group.map(g => g.x)),
    h: Math.max(...group.map(g => g.y + g.h)) - Math.min(...group.map(g => g.y))
  };
  place(el, box);
  el.classList.toggle("bump", !fits);
}

function hideGhost(el) { el?.remove(); }

/** Move the dragged node to wherever the pointer sits in the stacked list. */
function stackDragTo(el, clientY) {
  const others = [...gridEl.children].filter(n => n !== el && n.classList.contains("w"));
  let before = null;
  for (const o of others) {
    const r = o.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) { before = o; break; }
  }
  if (before) gridEl.insertBefore(el, before);
  else gridEl.appendChild(el);
}

/**
 * Freeze the stacked order into an explicit `order` field.
 *
 * Deliberately NOT written back into x/y. Reordering on a phone would otherwise
 * flatten the desktop canvas — every widget to one column — and you would find
 * your dashboard rearranged next time you opened it on a real screen. The two
 * arrangements are allowed to differ; `order` only decides the phone one, and
 * falls back to the desktop y/x reading order until you have touched it.
 */
function commitStackOrder() {
  [...gridEl.children].filter(n => n.classList.contains("w")).forEach((node, i) => {
    const item = items.find(x => "w" + x.id === node.id);
    if (item) item.order = i;
  });
  saveLayout();
}

/** Reading order for the stacked list. */
const stackSorted = () =>
  items.slice().sort((a, b) =>
    (a.order ?? a.y * 100 + a.x) - (b.order ?? b.y * 100 + b.x));

function dragify(el, it) {
  /* ---- mouse and pen: the whole widget is the handle ---- */
  el.addEventListener("pointerdown", e => {
    if (e.pointerType === "touch") return;   // handled by the touch path below
    if (e.button !== 0) return;
    if (e.target.closest(NO_DRAG)) return;
    if (e.ctrlKey || e.metaKey) return;      // that gesture is "select", not "move"

    const sx = e.clientX, sy = e.clientY;
    // 5px of slack. Without it, one stray pixel between press and release on a
    // widget body counts as a drag, and widgets creep every time you click one.
    const THRESHOLD = 5;
    let session = null;

    // Capture straight away, before the threshold is crossed. Without it, a fast
    // flick off the widget delivers its pointermove and pointerup somewhere else
    // entirely — the drag never starts and the listeners below never come off.
    try { el.setPointerCapture(e.pointerId); } catch {}

    const detach = () => {
      el.removeEventListener("pointermove", mv);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      removeEventListener("keydown", onKey, true);
      try { el.releasePointerCapture(e.pointerId); } catch {}
      activeDrag = null;
    };

    const mv = ev => {
      if (!session) {
        if (Math.abs(ev.clientX - sx) < THRESHOLD && Math.abs(ev.clientY - sy) < THRESHOLD) return;
        session = startDragSession(el, it, sx, sy);
        activeDrag = session;
      }
      session.move(ev.clientX, ev.clientY);
    };
    const up = () => { detach(); session?.end(); };   // no session = it was a click
    const cancel = () => { detach(); session?.cancel(); };

    // Escape abandons the drag and puts the layout back. The browser also fires
    // pointercancel when it takes the gesture over, which must not be treated as
    // a drop — that would commit a move the user never completed.
    const onKey = ev => { if (ev.key === "Escape" && session) { ev.preventDefault(); cancel(); } };

    el.addEventListener("pointermove", mv);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    addEventListener("keydown", onKey, true);
  });

  /* ---- touch: hold to pick up ---- */
  /**
   * A finger cannot both scroll the page and drag a widget, and the browser
   * decides which at the start of the gesture. So the rule is: a press that
   * moves is a scroll, a press that stays put becomes a drag.
   *
   * These are touch events rather than pointer events because stopping the page
   * from scrolling means preventDefault() on touchmove, which needs a
   * non-passive listener. touch-action alone cannot express "sometimes".
   */
  let holdTimer = null, held = false, startPt = null, session = null;

  const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };

  el.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) return;      // pinch/zoom is not ours
    if (e.target.closest(NO_DRAG)) return;
    const t = e.touches[0];
    startPt = { x: t.clientX, y: t.clientY };
    held = false;
    cancelHold();
    holdTimer = setTimeout(() => {
      held = true;
      el.classList.add("held");
      // A short buzz is the only feedback that the widget is now in your hand.
      try { navigator.vibrate?.(18); } catch {}
      session = startDragSession(el, it, startPt.x, startPt.y);
      activeDrag = session;
    }, 380);
  }, { passive: true });

  el.addEventListener("touchmove", e => {
    if (!held) {
      // Still deciding. Any real travel means the user meant to scroll.
      const t = e.touches[0];
      if (startPt && Math.hypot(t.clientX - startPt.x, t.clientY - startPt.y) > 12) cancelHold();
      return;
    }
    e.preventDefault();                      // the gesture is ours now
    session?.move(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  const finishTouch = drop => {
    cancelHold();
    if (held) {
      // A cancelled touch (a call arriving, the gesture stolen by the browser)
      // is not a drop, and must not commit a move.
      if (drop) session?.end(); else session?.cancel();
      el.classList.remove("held");
    }
    held = false; session = null; startPt = null; activeDrag = null;
  };
  el.addEventListener("touchend", () => finishTouch(true));
  el.addEventListener("touchcancel", () => finishTouch(false));
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
      el.classList.remove("resizing"); layout();
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
      const links = portLinks(c.ports, "cport");
      return `<tr>
        <td class="name">${esc(c.title || c.name)}</td>
        <td class="mono">${esc(c.image)}</td>
        <td><span class="pill ${up ? "ok" : "crit"}"><i class="dot"></i>${esc(c.state.toUpperCase())}</span></td>
        <td><span class="cports">${links || '<span class="dim">—</span>'}</span></td>
        <td><span class="pill idle" data-tip="${esc(managedTip(c.managedBy))}">${esc((c.managedBy || "manual").toUpperCase())}</span></td>
        <td><div class="rowbtns">
          <button class="btn sm" data-act="${up ? "stop" : "start"}" data-id="${esc(c.id)}"
                  data-tip="${up ? "Stop this container" : "Start this container"}">${up ? "STOP" : "START"}</button>
          <button class="btn sm" data-act="restart" data-id="${esc(c.id)}"
                  data-tip="Stop and start it again">RESTART</button>
          <button class="btn sm danger" data-rm="${esc(c.id)}" data-nm="${esc(c.name)}"
                  data-tip="Delete the container. Images and volumes are kept.">REMOVE</button>
        </div></td></tr>`;
    }).join("") || `<tr><td colspan="6" class="empty">NO CONTAINERS</td></tr>`;
  } catch (e) {
    box.innerHTML = `<div class="empty">${esc(e.message).toUpperCase()}</div>`;
  }
}
/**
 * Published ports, as links you can actually click.
 *
 * A port number on its own makes you copy it into the address bar by hand, and
 * the whole reason you knew the container was up was that you were already
 * looking at this screen. The host is taken from the address you are viewing
 * Nexus on, which is by definition a route that reaches the box.
 */
function portLinks(ports, cls) {
  const seen = new Set();
  const list = (ports || [])
    .filter(p => p.public && !seen.has(p.public) && seen.add(p.public))
    .sort((a, b) => a.public - b.public);
  if (!list.length) return "";
  return list.map(p =>
    `<a class="${cls}" href="http://${esc(location.hostname)}:${p.public}" target="_blank" rel="noopener"
        data-tip="Open http://${esc(location.hostname)}:${p.public} — container port ${p.private}/${esc(p.type || "tcp")}"
     >:${p.public}</a>`).join("");
}

/** Where a container came from, in one line. */
function managedTip(kind) {
  if (kind === "nexus") return "Installed through the Nexus app store.";
  if (kind === "casaos") return "Installed through CasaOS. Nexus reads its labels but does not manage it.";
  return "Started by hand or by another tool. Nexus will not touch it unless you ask.";
}

on("#c-table", "click", async e => {
  const rm = e.target.closest("button[data-rm]");
  if (rm) {
    // The list also shows containers Nexus did not create — including debris
    // from an install that failed partway — so removal has to be available here
    // rather than only through the app store's uninstall.
    if (!confirm(`Delete the container "${rm.dataset.nm}"?\n\nIts image and any named volumes stay on disk. This does not uninstall an app that Nexus manages — use the app store for that.`)) return;
    rm.disabled = true;
    try {
      await api(`/docker/containers/${encodeURIComponent(rm.dataset.rm)}`, { method: "DELETE" });
      toast("CONTAINER REMOVED", "ok");
      setTimeout(loadContainers, 500);
    } catch (ex) { toast(ex.message.toUpperCase(), "err"); rm.disabled = false; }
    return;
  }

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

/* ============================ file manager ============================ */
let curDir = null, curParent = null, curEntries = [];

/**
 * File selection, by path.
 *
 * Paths rather than row elements, so a selection survives the table being
 * re-rendered by a refresh. Cleared on navigation — carrying a selection across
 * directories would mean a DELETE could hit something no longer on screen.
 */
let fileSel = new Set();
let fileAnchor = null;

/**
 * The clipboard, and where you have been.
 *
 * The clipboard holds paths rather than entries: a cut folder may be pasted
 * after several navigations, by which time the listing it came from is long
 * gone. The server re-resolves and re-jails every path at paste time anyway,
 * so holding anything richer would only be a staleness risk.
 */
const fileClip = { paths: [], move: false, from: null };
const fileHistory = [];

const fileRows = () => $$("#f-table tbody tr[data-path]");

function markFileSel() {
  fileRows().forEach(tr => tr.classList.toggle("sel", fileSel.has(tr.dataset.path)));
  const bar = $("#f-selbar");
  if (bar) {
    bar.hidden = fileSel.size < 1;
    const c = $("#f-selcount");
    if (c) c.textContent = fileSel.size === 1 ? "1 ITEM SELECTED" : `${fileSel.size} ITEMS SELECTED`;
  }
}
function clearFileSelection() { if (fileSel.size) { fileSel.clear(); fileAnchor = null; markFileSel(); } }
const selectedEntries = () => curEntries.filter(e => fileSel.has(e.path));

/** Glyph + colour by extension, so a folder listing is scannable at a glance. */
const FILE_KINDS = [
  { re: /\.(txt|md|markdown|rst)$/i,                                   ic: "TXT", cls: "k-doc"  },
  { re: /\.(json|ya?ml|toml|ini|conf|cfg|env|properties|service)$/i,   ic: "CFG", cls: "k-cfg"  },
  { re: /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|sh|bash)$/i, ic: "{ }", cls: "k-code" },
  { re: /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i,                   ic: "IMG", cls: "k-img"  },
  { re: /\.(mp4|mkv|avi|mov|webm|m4v)$/i,                              ic: "VID", cls: "k-vid"  },
  { re: /\.(mp3|flac|wav|ogg|m4a|aac)$/i,                              ic: "SND", cls: "k-snd"  },
  { re: /\.(zip|tar|gz|xz|bz2|7z|rar|tgz)$/i,                          ic: "ZIP", cls: "k-arc"  },
  { re: /\.log$/i,                                                     ic: "LOG", cls: "k-log"  },
  { re: /\.pdf$/i,                                                     ic: "PDF", cls: "k-pdf"  }
];
function fileKind(en) {
  if (en.dir) return { ic: "DIR", cls: "k-dir" };
  for (const k of FILE_KINDS) if (k.re.test(en.name)) return k;
  return { ic: "BIN", cls: "k-bin" };
}

/**
 * The file manager can only reach configured roots, and until now the UI never
 * showed what those were — so if the first root was /DATA you had no way to
 * reach /root at all. These buttons make every root one click away.
 */
let ROOTS = [];

/**
 * The drives strip.
 *
 * Each root is a card rather than a button: where it points, how full it is,
 * and what you keep on it. The note is the part that earns its place — "/DATA"
 * and "/mnt/data" are indistinguishable at a glance, and the difference between
 * them is the whole reason you are looking.
 */
async function loadRoots(force = false) {
  const bar = $("#f-roots");
  if (!bar) return;
  if (bar.dataset.loaded && !force) return renderRoots();
  try {
    ROOTS = await api("/files/roots");
    bar.dataset.loaded = "1";
    renderRoots();
    wireRoots(bar);
  } catch { bar.innerHTML = ""; }
}

function renderRoots() {
  const bar = $("#f-roots");
  if (!bar) return;

  bar.innerHTML = ROOTS.map(r => {
    const known = r.size > 0 && r.usage != null;
    const pct = known ? clamp(r.usage, 0, 100) : 0;
    const lvl = pct >= 92 ? "crit" : pct >= 80 ? "warn" : "";
    return `
      <div class="rootcard${r.exists ? "" : " missing"}${known ? "" : " nostat"}"
           data-root="${esc(r.path)}" draggable="true" tabindex="0" role="button"
           aria-label="${esc(r.name)} — ${esc(r.path)}">
        <span class="rhead">
          <span class="rn">${esc(r.name)}</span>
          ${known ? `<span class="rpct ${lvl}">${pct.toFixed(0)}%</span>` : ""}
        </span>
        <span class="rp mono">${esc(r.path)}</span>
        ${known ? `
          <span class="rbar ${lvl}"><i style="width:${pct.toFixed(1)}%"></i></span>
          <span class="rfig mono">${bytes(r.used)} <b>/</b> ${bytes(r.used + r.available)}
            <span class="rfree">· ${bytes(r.available)} free</span></span>`
        : `<span class="rfig mono dim">${r.exists ? "size unavailable" : "not mounted"}</span>`}
        <span class="rnote${r.note ? "" : " empty"}">${esc(r.note || "add a note")}</span>
      </div>`;
  }).join("") +
    `<span class="hint rootshint">Drag a card to reorder. Right-click one for a note.
      Only these paths are reachable — set <code>fileRoots</code> in
      /etc/nexus/config.json to add more.</span>`;

  if (curDir) markActiveRoot(curDir);
}

function wireRoots(bar) {
  bar.addEventListener("click", e => {
    const c = e.target.closest("[data-root]");
    if (c && !c.classList.contains("missing")) loadFiles(c.dataset.root);
  });
  bar.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const c = e.target.closest("[data-root]");
    if (c) { e.preventDefault(); c.click(); }
  });
  bar.addEventListener("contextmenu", e => {
    const c = e.target.closest("[data-root]");
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    openRootMenu(e.clientX, e.clientY, ROOTS.find(r => r.path === c.dataset.root));
  });

  /* ---- drag to reorder ----
     HTML5 drag-and-drop rather than pointer events, because these cards sit on
     a page that already uses pointer drags for the rubber-band selection, and
     the two would fight over the same gesture. */
  let dragPath = null;
  bar.addEventListener("dragstart", e => {
    const c = e.target.closest("[data-root]");
    if (!c) return;
    dragPath = c.dataset.root;
    c.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    // Firefox will not start a drag without data on the transfer.
    try { e.dataTransfer.setData("text/plain", dragPath); } catch {}
  });
  bar.addEventListener("dragend", () => {
    dragPath = null;
    $$("#f-roots .rootcard").forEach(c => c.classList.remove("dragging", "dropbefore"));
  });
  bar.addEventListener("dragover", e => {
    if (!dragPath) return;
    e.preventDefault();
    const c = e.target.closest("[data-root]");
    $$("#f-roots .rootcard").forEach(x => x.classList.remove("dropbefore"));
    if (c && c.dataset.root !== dragPath) c.classList.add("dropbefore");
  });
  bar.addEventListener("drop", async e => {
    if (!dragPath) return;
    e.preventDefault();
    const c = e.target.closest("[data-root]");
    $$("#f-roots .rootcard").forEach(x => x.classList.remove("dropbefore"));
    if (!c || c.dataset.root === dragPath) return;

    const from = ROOTS.findIndex(r => r.path === dragPath);
    const to = ROOTS.findIndex(r => r.path === c.dataset.root);
    if (from < 0 || to < 0) return;
    ROOTS.splice(to, 0, ROOTS.splice(from, 1)[0]);
    renderRoots();
    await saveRootPrefs();
  });
}

/** Persist order and notes together — the server stores one map for both. */
async function saveRootPrefs() {
  const prefs = {};
  ROOTS.forEach((r, i) => { prefs[r.path] = { note: r.note || "", order: i }; });
  try { await api("/files/roots/prefs", { method: "PUT", body: { prefs } }); }
  catch (e) { toast(e.message.toUpperCase(), "err"); }
}

function openRootMenu(x, y, root) {
  if (!root) return;
  const body = $("#ctx-body");
  $("#ctx-icon").src = ICON("storage");
  $("#ctx-title").textContent = root.name.slice(0, 26).toUpperCase();
  body.innerHTML = "";
  ctxItems = [];

  const actions = [
    { label: root.note ? "EDIT NOTE" : "ADD NOTE", go: () => editRootNote(root) },
    { label: "OPEN", go: () => loadFiles(root.path) }
  ];
  if (root.note) actions.push({ label: "CLEAR NOTE", go: () => setRootNote(root, "") });
  if (fileClip.paths.length) {
    actions.push({ label: `PASTE ${fileClip.paths.length} HERE`, go: () => pasteInto(root.path) });
  }

  const g = document.createElement("div");
  g.className = "ctxgroup ctxstack";
  actions.forEach(a => {
    const b = document.createElement("button");
    b.className = "ctxopt wide";
    b.textContent = a.label;
    b.addEventListener("click", () => { closeCtx(); a.go(); });
    g.appendChild(b);
  });
  body.appendChild(g);

  const note = document.createElement("p");
  note.className = "ctxnote";
  note.textContent = "A note is a label for you — it does not rename anything on disk.";
  body.appendChild(note);

  $(".ctxfoot").hidden = true;
  placeCtx(x, y);
}

function editRootNote(root) {
  const v = prompt(`Note for ${root.name} (${root.path}):\n\nThis is a label for you, not a rename.`, root.note || "");
  if (v == null) return;
  setRootNote(root, v.trim().slice(0, 120));
}

async function setRootNote(root, note) {
  root.note = note;
  renderRoots();
  await saveRootPrefs();
}

function markActiveRoot(p) {
  // $ is querySelector and returns one node; the list needs $$. This threw on
  // every listing, and because markActiveRoot runs before the rows are written
  // the catch in loadFiles swallowed it and the file manager showed the type
  // error where the files should have been.
  const cards = $$("#f-roots .rootcard");
  const under = r => p === r || p.startsWith(r.endsWith("/") ? r : r + "/") || p.startsWith(r + "\\");
  // Longest match wins, so /DATA does not light up when you are inside a
  // separate, more specific root nested under it.
  let best = null;
  cards.forEach(b => {
    const r = b.dataset.root;
    if (under(r) && (!best || r.length > best.length)) best = r;
  });
  cards.forEach(b => b.classList.toggle("on", b.dataset.root === best));
}

async function loadFiles(dir, { history = true } = {}) {
  const tb = $("#f-table tbody");
  try {
    const out = await api("/files" + (dir ? "?path=" + encodeURIComponent(dir) : ""));
    // Record where we were, not where we are going, and only for a real move —
    // a refresh of the same folder is not a step in the journey.
    if (history && curDir && curDir !== out.path) {
      fileHistory.push(curDir);
      if (fileHistory.length > 50) fileHistory.shift();
    }
    curDir = out.path;
    curParent = out.parent;
    curEntries = out.entries;
    clearFileSelection();
    renderCrumbs(out.path);
    markActiveRoot(out.path);
    paintNav();

    if (!out.entries.length) {
      tb.innerHTML = '<tr><td colspan="4" class="empty">EMPTY FOLDER &mdash; RIGHT-CLICK TO CREATE SOMETHING</td></tr>';
      return;
    }

    tb.innerHTML = out.entries.map(en => {
      const k = fileKind(en);
      return `<tr draggable="true" data-path="${esc(en.path)}" data-dir="${en.dir ? 1 : 0}" data-text="${en.text ? 1 : 0}" data-name="${esc(en.name)}">
        <td class="name"><span class="fname">
          <span class="fic ${k.cls}">${esc(k.ic)}</span>
          <span class="ftxt">${esc(en.name)}${en.dir ? "/" : ""}</span>
          ${en.symlink ? '<span class="pill idle">LINK</span>' : ""}
        </span></td>
        <td class="mono">${en.dir ? "—" : bytes(en.size)}</td>
        <td class="mono">${en.mtime ? since(en.mtime) : "—"}</td>
        <td class="mono dim">${en.mode ? en.mode.toString(8).padStart(3, "0") : ""}</td>
      </tr>`;
    }).join("") + (out.truncated
      ? `<tr><td colspan="4" class="empty">SHOWING ${out.entries.length} OF ${out.total} —
           OPEN A SUBFOLDER TO NARROW IT DOWN</td></tr>`
      : "");
    paintClip();                   // re-dim anything still on the clipboard
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="4" class="empty">${esc(e.message).toUpperCase()}</td></tr>`;
  }
}

/** Clickable path segments — jump up several levels in one click. */
function renderCrumbs(p) {
  const sep = p.includes("\\") ? "\\" : "/";
  const parts = p.split(sep).filter(Boolean);
  const bits = [];
  let acc = p.startsWith(sep) ? sep : "";
  if (p.startsWith(sep)) bits.push(`<button data-go="${sep}">${sep}</button>`);
  parts.forEach((seg, i) => {
    acc = acc === sep ? sep + seg : (acc ? acc + sep + seg : seg);
    bits.push(`<button data-go="${esc(acc)}">${esc(seg)}</button>`);
    if (i < parts.length - 1) bits.push(`<span class="csep">${sep}</span>`);
  });
  $("#f-crumbs").innerHTML = bits.join("");
}

on("#f-crumbs", "click", e => {
  const b = e.target.closest("[data-go]");
  if (b) loadFiles(b.dataset.go);
});

// Single click selects; double click opens. Folders navigate, text files open
// in the editor, anything else downloads.
//
// Ctrl/Cmd adds one, Shift takes a run from the last thing you touched — the
// same two modifiers every file manager uses, so nothing here needs explaining.
on("#f-table", "click", e => {
  const tr = e.target.closest("tr[data-path]");
  if (!tr) { clearFileSelection(); return; }
  const path = tr.dataset.path;

  if (e.shiftKey && fileAnchor) {
    const rows = fileRows().map(r => r.dataset.path);
    const a = rows.indexOf(fileAnchor), b = rows.indexOf(path);
    if (a >= 0 && b >= 0) {
      if (!(e.ctrlKey || e.metaKey)) fileSel.clear();
      rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(p => fileSel.add(p));
    }
  } else if (e.ctrlKey || e.metaKey) {
    if (fileSel.has(path)) fileSel.delete(path); else fileSel.add(path);
    fileAnchor = path;
  } else {
    fileSel = new Set([path]);
    fileAnchor = path;
  }
  markFileSel();
});

/* ============================ drag and drop ============================ */
/**
 * Drag rows onto a folder, a breadcrumb or a drive card to move them there.
 *
 * HTML5 drag-and-drop rather than pointer events, because this page already
 * spends pointer drags on the rubber-band selection and the two would fight
 * over the same gesture. It also gives the browser's own drag cursor, which is
 * the affordance people are looking for.
 *
 * Move by default, copy with Ctrl held — the convention everywhere else. The
 * modifier is read at DROP time, not at drag start, so changing your mind
 * halfway across the window still works.
 */
const fileDrag = { paths: [] };

function dropTargets(on) {
  $$("#f-table tr[data-path][data-dir='1'], #f-roots .rootcard, #f-crumbs [data-go]")
    .forEach(el => el.classList.toggle("droptarget", on));
}

function wireFileDnD() {
  const page = $("#page-files");
  if (!page || page.dataset.dnd) return;
  page.dataset.dnd = "1";

  page.addEventListener("dragstart", e => {
    const tr = e.target.closest("#f-table tr[data-path]");
    if (!tr) return;
    // Dragging something outside the selection makes it the selection, so what
    // moves is always what is highlighted.
    if (!fileSel.has(tr.dataset.path)) {
      fileSel = new Set([tr.dataset.path]);
      fileAnchor = tr.dataset.path;
      markFileSel();
    }
    fileDrag.paths = [...fileSel];
    e.dataTransfer.effectAllowed = "copyMove";
    try { e.dataTransfer.setData("text/plain", fileDrag.paths.join("\n")); } catch {}
    page.classList.add("dragging-rows");
    dropTargets(true);
  });

  page.addEventListener("dragend", () => {
    fileDrag.paths = [];
    page.classList.remove("dragging-rows");
    dropTargets(false);
    $$(".dropinto").forEach(el => el.classList.remove("dropinto"));
  });

  const targetOf = el => el?.closest?.(
    "#f-table tr[data-path][data-dir='1'], #f-roots .rootcard, #f-crumbs [data-go]");

  page.addEventListener("dragover", e => {
    if (!fileDrag.paths.length) return;
    const t = targetOf(e.target);
    // Dropping a folder on itself is the one target that must refuse.
    const self = t?.dataset?.path && fileDrag.paths.includes(t.dataset.path);
    $$(".dropinto").forEach(el => el.classList.remove("dropinto"));
    if (!t || self) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = (e.ctrlKey || e.metaKey) ? "copy" : "move";
    t.classList.add("dropinto");
  });

  page.addEventListener("drop", async e => {
    if (!fileDrag.paths.length) return;
    const t = targetOf(e.target);
    if (!t) return;
    e.preventDefault();
    const dest = t.dataset.path || t.dataset.root || t.dataset.go;
    const paths = [...fileDrag.paths];
    const move = !(e.ctrlKey || e.metaKey);
    page.classList.remove("dragging-rows");
    dropTargets(false);
    $$(".dropinto").forEach(el => el.classList.remove("dropinto"));
    if (!dest || paths.includes(dest)) return;
    await transferTo(paths, dest, move);
  });
}

/**
 * The one place a copy or move is actually performed, so drag-and-drop and
 * paste cannot drift apart in how they handle clashes or what they refresh.
 */
async function transferTo(paths, dest, move) {
  const run = overwrite =>
    api("/files/transfer", { method: "POST", body: { from: paths, to: dest, move, overwrite } });
  try {
    await run(false);
  } catch (err) {
    if (err.status !== 409) { toast(err.message.toUpperCase(), "err"); return false; }
    const names = (err.clashes || []).slice(0, 6).join(", ");
    const more = (err.clashes || []).length > 6 ? `\n…and ${err.clashes.length - 6} more` : "";
    if (!confirm(`${err.message}:\n\n${names}${more}\n\nOverwrite them?`)) return false;
    try { await run(true); }
    catch (ex) { toast(ex.message.toUpperCase(), "err"); return false; }
  }
  const n = paths.length;
  toast(`${move ? "MOVED" : "COPIED"} ${n} ITEM${n === 1 ? "" : "S"}`, "ok");
  loadFiles(curDir, { history: false });
  loadRoots(true);
  return true;
}

/* ---- rubber-band selection over empty space ---- */
/**
 * Drag a box the way Explorer and Finder do. The band is positioned inside
 * #page-files and its start point is stored in that element's coordinate space,
 * so scrolling mid-drag does not drag the anchor along with the viewport.
 */
(function marquee() {
  const host = $("#page-files");
  if (!host) return;
  let band = null, sx = 0, sy = 0, active = false, additive = false;

  const toHost = (cx, cy) => {
    const r = host.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };

  host.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    // Anything interactive, and the chrome above the table, keeps its own behaviour.
    if (e.target.closest("tr[data-path], button, a, input, select, textarea")) return;
    if (e.target.closest(".rootbar, .crumbs, .selbar")) return;

    const p = toHost(e.clientX, e.clientY);
    sx = p.x; sy = p.y; active = true;
    additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!additive) clearFileSelection();
    host.setPointerCapture(e.pointerId);
  });

  host.addEventListener("pointermove", e => {
    if (!active) return;
    const p = toHost(e.clientX, e.clientY);
    const w = Math.abs(p.x - sx), h = Math.abs(p.y - sy);
    if (!band && w < 4 && h < 4) return;      // ignore a jittery click

    if (!band) {
      band = document.createElement("div");
      band.id = "f-band";
      host.appendChild(band);
    }
    const left = Math.min(sx, p.x), top = Math.min(sy, p.y);
    band.style.cssText = `left:${left}px;top:${top}px;width:${w}px;height:${h}px`;

    const hr = host.getBoundingClientRect();
    const box = { l: left, t: top, r: left + w, b: top + h };
    const base = additive ? new Set(fileSel) : new Set();
    fileRows().forEach(tr => {
      const r = tr.getBoundingClientRect();
      const rt = r.top - hr.top, rb = r.bottom - hr.top;
      const rl = r.left - hr.left, rr = r.right - hr.left;
      if (rl < box.r && rr > box.l && rt < box.b && rb > box.t) base.add(tr.dataset.path);
    });
    fileSel = base;
    markFileSel();
  });

  const end = e => {
    if (!active) return;
    active = false;
    try { host.releasePointerCapture(e.pointerId); } catch {}
    if (band) { band.remove(); band = null; }
    if (fileSel.size) fileAnchor = [...fileSel][fileSel.size - 1];
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
})();

on("#f-table", "dblclick", e => {
  const tr = e.target.closest("tr[data-path]");
  if (!tr) return;
  if (tr.dataset.dir === "1") return loadFiles(tr.dataset.path);
  if (tr.dataset.text === "1") return openEditor(tr.dataset.path, tr.dataset.name);
  location.href = "/api/files/download?path=" + encodeURIComponent(tr.dataset.path);
});

/* ---- right-click, on a row or on empty space ---- */
on("#page-files", "contextmenu", e => {
  e.preventDefault();
  const tr = e.target.closest("tr[data-path]");
  if (!tr) return openFileMenu(e.clientX, e.clientY, null);

  // Right-clicking inside a selection keeps it; right-clicking outside one
  // replaces it, so the menu always acts on what is highlighted.
  if (!fileSel.has(tr.dataset.path)) {
    fileSel = new Set([tr.dataset.path]);
    fileAnchor = tr.dataset.path;
    markFileSel();
  }
  openFileMenu(e.clientX, e.clientY, {
    path: tr.dataset.path, name: tr.dataset.name,
    dir: tr.dataset.dir === "1", text: tr.dataset.text === "1"
  });
});

function openFileMenu(x, y, entry) {
  const body = $("#ctx-body");
  const many = fileSel.size > 1;

  $("#ctx-icon").src = ICON("files");
  $("#ctx-title").textContent = many
    ? `${fileSel.size} ITEMS`
    : entry ? entry.name.slice(0, 26).toUpperCase() : "THIS FOLDER";
  body.innerHTML = "";
  ctxItems = [];

  const actions = [];
  if (entry && many) {
    // Only what makes sense for a set. Rename and edit are single-target by
    // nature; offering them here would just mean "does it to one at random".
    actions.push({ label: `COPY ${fileSel.size}`, go: () => clipTake(false) });
    actions.push({ label: `CUT ${fileSel.size}`, go: () => clipTake(true) });
    actions.push({ label: `DELETE ${fileSel.size} ITEMS`, go: deleteFileSelection, danger: true });
    actions.push({ label: "DOWNLOAD FILES", go: downloadFileSelection });
    actions.push({ label: "CLEAR SELECTION", go: clearFileSelection });
  } else if (entry) {
    if (entry.dir) actions.push({ label: "OPEN", go: () => loadFiles(entry.path) });
    if (entry.text) actions.push({ label: "EDIT", go: () => openEditor(entry.path, entry.name) });
    if (!entry.dir) actions.push({ label: "DOWNLOAD", go: () => { location.href = "/api/files/download?path=" + encodeURIComponent(entry.path); } });
    actions.push({ label: "COPY", go: () => clipTake(false) });
    actions.push({ label: "CUT", go: () => clipTake(true) });
    // Pasting onto a folder puts things inside it, which is what every file
    // manager does and what the pointer is implicitly aiming at.
    if (entry.dir && fileClip.paths.length) {
      actions.push({ label: `PASTE ${fileClip.paths.length} INTO`, go: () => pasteInto(entry.path) });
    }
    actions.push({ label: "RENAME", go: () => renameEntry(entry) });
    actions.push({ label: "DELETE", go: () => deleteEntry(entry), danger: true });
  }
  if (fileClip.paths.length) {
    actions.push({ label: `PASTE ${fileClip.paths.length} HERE`, go: () => pasteInto(curDir) });
  }
  actions.push({ label: "SELECT ALL", go: selectAllFiles });
  actions.push({ label: "NEW FOLDER", go: makeFolder });
  actions.push({ label: "REFRESH", go: () => loadFiles(curDir, { history: false }) });
  if (curParent) actions.push({ label: "GO UP", go: () => loadFiles(curParent) });
  if (fileHistory.length) actions.push({ label: "BACK", go: () => $("#f-back").click() });

  const g = document.createElement("div");
  g.className = "ctxgroup ctxstack";
  actions.forEach(a => {
    const b = document.createElement("button");
    b.className = "ctxopt wide" + (a.danger ? " danger" : "");
    b.textContent = a.label;
    b.addEventListener("click", () => { closeCtx(); a.go(); });
    g.appendChild(b);
  });
  body.appendChild(g);

  $(".ctxfoot").hidden = true;
  placeCtx(x, y);
}

function selectAllFiles() {
  fileSel = new Set(fileRows().map(r => r.dataset.path));
  markFileSel();
}

/**
 * Deletes everything selected, one request per item.
 *
 * Sequential rather than parallel on purpose: a partial failure halfway through
 * should stop and say so, not fire forty concurrent deletes and leave you
 * guessing which ones landed.
 */
async function deleteFileSelection() {
  const chosen = selectedEntries();
  if (!chosen.length) return;
  const dirs = chosen.filter(e => e.dir).length;
  const msg = `Delete ${chosen.length} item${chosen.length === 1 ? "" : "s"}?` +
    (dirs ? `\n\n${dirs} of them ${dirs === 1 ? "is a folder and takes its" : "are folders and take their"} contents too.` : "") +
    "\n\nThis cannot be undone.";
  if (!confirm(msg)) return;

  let done = 0, failed = [];
  for (const en of chosen) {
    try { await api("/files/delete", { method: "POST", body: { path: en.path } }); done++; }
    catch (ex) { failed.push(`${en.name}: ${ex.message}`); }
  }
  if (failed.length) toast(`DELETED ${done}, ${failed.length} FAILED`, "err");
  else toast(`DELETED ${done} ITEM${done === 1 ? "" : "S"}`, "ok");
  if (failed.length) console.warn("[nexus] delete failures:", failed);
  loadFiles(curDir);
}

function downloadFileSelection() {
  const files = selectedEntries().filter(e => !e.dir);
  if (!files.length) return toast("NOTHING TO DOWNLOAD — FOLDERS ONLY", "err");
  // One navigation per file, spaced out: the browser blocks a burst of
  // simultaneous downloads, and there is no server-side zip to hand back.
  files.forEach((en, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = "/api/files/download?path=" + encodeURIComponent(en.path);
    a.download = en.name;
    document.body.appendChild(a); a.click(); a.remove();
  }, i * 350));
  toast(`DOWNLOADING ${files.length} FILE${files.length === 1 ? "" : "S"}`, "ok");
}

async function makeFolder() {
  const name = prompt("New folder name:");
  if (!name) return;
  try {
    await api("/files/mkdir", { method: "POST", body: { path: curDir + "/" + name } });
    toast("FOLDER CREATED", "ok");
    loadFiles(curDir);
  } catch (ex) { toast(ex.message.toUpperCase(), "err"); }
}

async function renameEntry(entry) {
  const name = prompt("Rename to:", entry.name);
  if (!name || name === entry.name) return;
  const dir = entry.path.slice(0, entry.path.length - entry.name.length);
  try {
    await api("/files/rename", { method: "POST", body: { from: entry.path, to: dir + name } });
    toast("RENAMED", "ok");
    loadFiles(curDir);
  } catch (ex) { toast(ex.message.toUpperCase(), "err"); }
}

async function deleteEntry(entry) {
  // A folder takes its contents with it — say so rather than asking a generic
  // "are you sure" that hides the real consequence.
  const msg = entry.dir
    ? `Delete the folder "${entry.name}" and everything inside it?\n\nThis cannot be undone.`
    : `Delete "${entry.name}"?\n\nThis cannot be undone.`;
  if (!confirm(msg)) return;
  try {
    await api("/files/delete", { method: "POST", body: { path: entry.path } });
    toast("DELETED", "ok");
    loadFiles(curDir);
  } catch (ex) { toast(ex.message.toUpperCase(), "err"); }
}

/* ---- in-browser text editor ---- */
let editorState = null;

async function openEditor(path, name) {
  openModal({ title: name.toUpperCase(), icon: ICON("files"), body: "<p>Loading…</p>" });
  let file;
  try {
    file = await api("/files/read?path=" + encodeURIComponent(path));
  } catch (e) {
    const b = document.createElement("div");
    b.innerHTML = `<div class="warnbox err">${esc(e.message)}</div>`;
    const f = document.createElement("div");
    f.innerHTML = '<button class="btn" id="ed-close2">CLOSE</button>';
    openModal({ title: name.toUpperCase(), icon: ICON("files"), body: b, foot: f });
    on("#ed-close2", "click", closeModal);
    return;
  }

  editorState = { path: file.path, mtime: file.mtime, original: file.content };

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="edmeta">
      <span class="mono">${esc(file.path)}</span>
      <span class="spacer"></span>
      <span class="mono" id="ed-stat">${bytes(file.size)}</span>
    </div>
    <textarea id="ed-area" spellcheck="false" wrap="off"></textarea>`;
  body.querySelector("#ed-area").value = file.content;

  const foot = document.createElement("div");
  foot.innerHTML = `<span class="hint" id="ed-hint">Ctrl+S saves</span>
                    <span class="spacer"></span>
                    <button class="btn" id="ed-cancel">CLOSE</button>
                    <button class="btn primary" id="ed-save">SAVE</button>`;

  openModal({ title: name.toUpperCase(), icon: ICON("files"), body, foot });

  const area = $("#ed-area");
  area.addEventListener("input", () => {
    const dirty = area.value !== editorState.original;
    $("#ed-hint").textContent = dirty ? "unsaved changes" : "Ctrl+S saves";
    $("#ed-hint").style.color = dirty ? "var(--warn)" : "";
  });
  area.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveEditor(); }
  });
  on("#ed-cancel", "click", () => {
    if (area.value !== editorState.original && !confirm("Discard unsaved changes?")) return;
    closeModal();
  });
  on("#ed-save", "click", saveEditor);
  area.focus();
}

async function saveEditor() {
  if (!editorState) return;
  const area = $("#ed-area"), btn = $("#ed-save");
  btn.disabled = true;
  try {
    const out = await api("/files/write", {
      method: "POST",
      body: { path: editorState.path, content: area.value, mtime: editorState.mtime }
    });
    // Adopt the new mtime, or our own save would look like someone else's edit
    // the second time round and trip the conflict check.
    editorState.mtime = out.mtime;
    editorState.original = area.value;
    $("#ed-stat").textContent = bytes(out.size);
    $("#ed-hint").textContent = "saved";
    $("#ed-hint").style.color = "var(--ok)";
    toast("SAVED", "ok");
    loadFiles(curDir);
  } catch (e) {
    toast(e.message.toUpperCase(), "err");
    $("#ed-hint").textContent = e.message;
    $("#ed-hint").style.color = "var(--crit)";
  } finally { btn.disabled = false; }
}

on("#f-up", "click", () => {
  if (curParent) loadFiles(curParent); else toast("ALREADY AT A ROOT", "err");
});
on("#f-mkdir", "click", makeFolder);

/* ============================ clipboard ============================ */

function clipTake(move) {
  const chosen = selectedEntries();
  if (!chosen.length) return toast("NOTHING SELECTED", "err");
  fileClip.paths = chosen.map(e => e.path);
  fileClip.move = move;
  fileClip.from = curDir;
  paintClip();
  toast(`${chosen.length} ITEM${chosen.length === 1 ? "" : "S"} ${move ? "CUT" : "COPIED"}`, "ok");
}

function clipClear() {
  fileClip.paths = [];
  fileClip.from = null;
  paintClip();
}

/** The toolbar button and the status strip both reflect what is held. */
function paintClip() {
  const n = fileClip.paths.length;
  const btn = $("#f-paste");
  if (btn) {
    btn.hidden = !n;
    btn.textContent = `PASTE ${n}`;
    btn.setAttribute("data-tip", n
      ? `${fileClip.move ? "Move" : "Copy"} ${n} item${n === 1 ? "" : "s"} from ${fileClip.from} into this folder.`
      : "");
  }
  const bar = $("#f-clipbar");
  if (bar) {
    bar.hidden = !n;
    const t = $("#f-clipinfo");
    if (t && n) {
      t.textContent = `${n} ITEM${n === 1 ? "" : "S"} ${fileClip.move ? "CUT" : "COPIED"} FROM ${fileClip.from}`;
    }
  }
  // Cut items are dimmed in place until the paste lands, so it is obvious what
  // is about to move rather than silently vanishing later.
  fileRows().forEach(tr =>
    tr.classList.toggle("cut", fileClip.move && fileClip.paths.includes(tr.dataset.path)));
}

/**
 * Paste into a folder.
 *
 * Clashes are reported by the server before anything is written, so the
 * overwrite question is asked once for the batch rather than once per file —
 * and asked before any bytes have moved, not halfway through.
 */
async function pasteInto(destDir) {
  if (!fileClip.paths.length) return;
  const dest = destDir || curDir;
  if (!dest) return toast("OPEN A FOLDER FIRST", "err");

  const ok = await transferTo(fileClip.paths, dest, fileClip.move);
  if (!ok) return;
  // A copy stays on the clipboard so it can be pasted into several places; a
  // cut is spent, because the source no longer exists.
  if (fileClip.move) clipClear(); else paintClip();
}

on("#f-copy", "click", () => clipTake(false));
on("#f-cut", "click", () => clipTake(true));
on("#f-paste", "click", () => pasteInto(curDir));
on("#f-clipcancel", "click", () => { clipClear(); toast("CLIPBOARD CLEARED"); });

/* ---- going back ---- */
on("#f-back", "click", () => {
  const prev = fileHistory.pop();
  if (!prev) return toast("NOTHING TO GO BACK TO", "err");
  loadFiles(prev, { history: false });
});

function paintNav() {
  const back = $("#f-back");
  if (back) back.disabled = !fileHistory.length;
  const up = $("#f-up");
  if (up) up.disabled = !curParent;
}

/* ============================ uploads ============================ */
/**
 * Files and folders, by button or by drop.
 *
 * XMLHttpRequest rather than fetch: fetch still has no upload progress event, and
 * a progress bar that only knows "started" and "finished" is not worth drawing.
 * The server takes raw bytes with the destination in the query string, so there
 * is no multipart dependency on either side.
 */
const UP = { running: false, cancelled: false, xhr: null };

const joinPath = (dir, rel) => {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + rel.replace(/^[\\/]+/, "");
};

/** Strip anything that would let a crafted name climb out of the target folder. */
function safeRel(rel) {
  return String(rel)
    .split(/[\\/]+/)
    .filter(seg => seg && seg !== "." && seg !== "..")
    .join("/");
}

/**
 * Walk a drop into a flat list of files with their relative paths.
 *
 * `readEntries` returns at most 100 entries per call and gives an empty array
 * when it is finished, so it has to be called in a loop — read it once and a
 * folder of 300 files quietly uploads the first 100.
 */
async function collectDrop(dt) {
  const roots = [...(dt.items || [])]
    .map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter(Boolean);

  // No FileSystemEntry support: fall back to the plain file list, no folders.
  if (!roots.length) {
    return [...(dt.files || [])].map(f => ({ file: f, rel: f.name }));
  }

  const out = [];
  const walk = async (entry, prefix) => {
    if (out.length > 5000) return;
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
      if (file) out.push({ file, rel: prefix + entry.name });
      return;
    }
    if (!entry.isDirectory) return;
    const reader = entry.createReader();
    while (true) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej)).catch(() => []);
      if (!batch.length) break;
      for (const e of batch) await walk(e, prefix + entry.name + "/");
    }
  };
  for (const r of roots) await walk(r, "");
  return out;
}

function uploadOne(file, dest, overwrite, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    UP.xhr = xhr;
    const q = `?path=${encodeURIComponent(dest)}${overwrite ? "&overwrite=1" : ""}`;
    xhr.open("PUT", "/api/files/upload" + q);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    if (CSRF) xhr.setRequestHeader("X-CSRF-Token", CSRF);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => {
      UP.xhr = null;
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `HTTP ${xhr.status}`;
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
      reject(Object.assign(new Error(msg), { status: xhr.status }));
    };
    xhr.onerror = () => { UP.xhr = null; reject(new Error("network error")); };
    xhr.onabort = () => { UP.xhr = null; reject(Object.assign(new Error("cancelled"), { cancelled: true })); };
    xhr.send(file);
  });
}

const UP_RING_C = 2 * Math.PI * 52;

function upPaint(pct, name, stat, title) {
  const ring = $("#up-ring");
  if (ring) {
    ring.setAttribute("stroke-dasharray", UP_RING_C.toFixed(1));
    ring.style.strokeDashoffset = String(UP_RING_C * (1 - clamp(pct, 0, 100) / 100));
  }
  const p = $("#up-pct"); if (p) p.textContent = Math.round(clamp(pct, 0, 100));
  const n = $("#up-name"); if (n) n.textContent = name ?? "";
  const s = $("#up-stat"); if (s) s.textContent = stat ?? "";
  const t = $("#up-title"); if (t && title) t.textContent = title;
}

function upShow(on) {
  const el = $("#uploader");
  if (el) el.hidden = !on;
  if (on) el.className = "";
}

async function startUpload(items, targetDir) {
  if (UP.running) return toast("AN UPLOAD IS ALREADY RUNNING", "err");
  items = items.filter(i => i.file && safeRel(i.rel));
  if (!items.length) return;

  const dir = targetDir || curDir;
  if (!dir) return toast("OPEN A FOLDER FIRST", "err");

  const planned = items.map(i => ({ ...i, rel: safeRel(i.rel), dest: joinPath(dir, safeRel(i.rel)) }));

  // Ask about clashes once, before any bytes move, rather than stopping on each
  // one halfway through a folder.
  let overwrite = false;
  try {
    const { existing } = await api("/files/exists", { method: "POST", body: { paths: planned.map(p => p.dest) } });
    if (existing.length) {
      const names = existing.slice(0, 5).map(p => p.split(/[\\/]/).pop()).join(", ");
      overwrite = confirm(
        `${existing.length} file${existing.length === 1 ? "" : "s"} already exist here:\n\n${names}` +
        `${existing.length > 5 ? `\n…and ${existing.length - 5} more` : ""}\n\n` +
        `OK = overwrite them.\nCancel = skip those and upload the rest.`
      );
      if (!overwrite) {
        const clash = new Set(existing);
        for (const p of planned) p.skip = clash.has(p.dest);
      }
    }
  } catch { /* the precheck is a courtesy; a clash still 409s below */ }

  const queue = planned.filter(p => !p.skip);
  if (!queue.length) { toast("NOTHING TO UPLOAD — EVERYTHING WAS SKIPPED", "err"); return; }

  // Directories first, so a file never races the folder it belongs in.
  const dirs = [...new Set(queue.map(p => p.rel).filter(r => r.includes("/"))
    .map(r => joinPath(dir, r.slice(0, r.lastIndexOf("/")))))];

  UP.running = true; UP.cancelled = false;
  upShow(true);
  const cancelBtn = $("#up-cancel");
  if (cancelBtn) cancelBtn.hidden = false;
  upPaint(0, "", "preparing…", "UPLOADING");

  const totalBytes = queue.reduce((n, p) => n + (p.file.size || 0), 0);
  let doneBytes = 0, doneCount = 0, failed = 0;

  try {
    for (const d of dirs) {
      if (UP.cancelled) break;
      await api("/files/mkdirp", { method: "POST", body: { path: d } }).catch(() => {});
    }

    for (const p of queue) {
      if (UP.cancelled) break;
      const label = `${doneCount + 1} of ${queue.length}`;
      upPaint(totalBytes ? (doneBytes / totalBytes) * 100 : 0, p.rel,
              `${label} · ${bytes(doneBytes)} of ${bytes(totalBytes)}`);
      try {
        await uploadOne(p.file, p.dest, overwrite, loaded => {
          const pct = totalBytes ? ((doneBytes + loaded) / totalBytes) * 100 : 0;
          upPaint(pct, p.rel, `${label} · ${bytes(doneBytes + loaded)} of ${bytes(totalBytes)}`);
        });
      } catch (ex) {
        if (ex.cancelled) break;
        failed++;
        console.warn("[nexus] upload failed:", p.rel, ex.message);
      }
      doneBytes += p.file.size || 0;
      doneCount++;
    }
  } finally {
    UP.running = false;
    UP.xhr = null;
    const el = $("#uploader");
    // Nothing left to cancel, so the button stops offering to.
    if (cancelBtn) cancelBtn.hidden = true;

    if (UP.cancelled) {
      if (el) el.className = "err";
      upPaint(totalBytes ? (doneBytes / totalBytes) * 100 : 0, "", `cancelled after ${doneCount} file${doneCount === 1 ? "" : "s"}`, "CANCELLED");
      toast("UPLOAD CANCELLED", "err");
    } else if (failed) {
      if (el) el.className = "err";
      upPaint(100, "", `${doneCount - failed} uploaded, ${failed} failed`, "FINISHED WITH ERRORS");
      toast(`${failed} FILE${failed === 1 ? "" : "S"} FAILED`, "err");
    } else {
      if (el) el.className = "ok";
      upPaint(100, "", `${doneCount} file${doneCount === 1 ? "" : "s"} · ${bytes(doneBytes)}`, "DONE");
      toast(`UPLOADED ${doneCount} FILE${doneCount === 1 ? "" : "S"}`, "ok");
    }

    // Leave the result on screen briefly rather than snapping it away.
    setTimeout(() => { if (!UP.running) upShow(false); }, failed || UP.cancelled ? 6000 : 2600);
    loadFiles(curDir);
  }
}

on("#up-cancel", "click", () => {
  if (!UP.running) return;
  UP.cancelled = true;
  try { UP.xhr?.abort(); } catch {}
});

on("#f-upload", "click", () => $("#f-file-input")?.click());
on("#f-upload-dir", "click", () => $("#f-dir-input")?.click());

on("#f-file-input", "change", e => {
  const files = [...e.target.files].map(f => ({ file: f, rel: f.name }));
  e.target.value = "";                      // so picking the same file twice works
  startUpload(files);
});
on("#f-dir-input", "change", e => {
  const files = [...e.target.files].map(f => ({ file: f, rel: f.webkitRelativePath || f.name }));
  e.target.value = "";
  startUpload(files);
});

/* ---- drag and drop ---- */
(function dropZone() {
  const page = $("#page-files");
  const overlay = $("#f-drop");
  if (!page || !overlay) return;

  // dragenter/dragleave fire for every child the pointer crosses, so a plain
  // boolean flickers the overlay on and off across the whole table. Counting
  // enters against leaves is the standard cure.
  let depth = 0;

  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");

  const show = () => {
    overlay.hidden = false;
    const p = $("#f-drop-path");
    if (p) p.textContent = curDir || "";
  };
  const hide = () => { depth = 0; overlay.hidden = true; };

  page.addEventListener("dragenter", e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    show();
  });
  page.addEventListener("dragover", e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  page.addEventListener("dragleave", e => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) hide();
  });
  page.addEventListener("drop", async e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hide();
    const dropDir = curDir;                 // pin it: the listing may refresh mid-walk
    const items = await collectDrop(e.dataTransfer);
    if (!items.length) return toast("NOTHING USABLE IN THAT DROP", "err");
    startUpload(items, dropDir);
  });

  // A file dropped anywhere else in the window would otherwise be opened by the
  // browser, navigating away from Nexus and losing whatever you were doing.
  addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener("drop", e => { if (hasFiles(e) && !page.contains(e.target)) e.preventDefault(); });
})();


/* ============================ terminal (xterm.js) ============================ */
let term = null, fit = null, termWS = null, termReady = false;

function termTheme() {
  // Pull the palette straight from the CSS tokens so the terminal follows the
  // theme toggle instead of being a separate hard-coded colour scheme.
  const v = n => cssv(n) || undefined;
  if (document.documentElement.dataset.gui === "workstation") {
    return {
      background: v("--terminal-bg"), foreground: v("--terminal-text"),
      cursor: v("--accent"), cursorAccent: v("--terminal-bg"),
      selectionBackground: "rgba(180,190,160,.3)",
      black: "#202723", red: "#ee9b8e", green: "#b2cd95", yellow: "#e4c57d",
      blue: "#9cbde0", magenta: "#c7afd2", cyan: "#9dc9c9", white: "#e5e7df",
      brightBlack: "#9fa99e", brightRed: "#ffb9ab", brightGreen: "#d1e7b7",
      brightYellow: "#f7dfa2", brightBlue: "#c0daf5", brightMagenta: "#e0cbed",
      brightCyan: "#c0e8e3", brightWhite: "#fffdf5"
    };
  }
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
  paintAppearance();
  const crtBtn = $("#crt-toggle");
  if (crtBtn && !crtBtn.dataset.wired) {
    crtBtn.dataset.wired = "1";
    const paint = () => {
      crtBtn.setAttribute("aria-pressed", String(document.documentElement.getAttribute("data-crt") === "on"));
      crtBtn.textContent = "CRT SCANLINES: " +
        (document.documentElement.getAttribute("data-crt") === "on" ? "ON" : "OFF");
    };
    paint();
    crtBtn.addEventListener("click", () => { toggleCRT(); paint(); });
  }

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

  // Nexus-format apps declare their own params. CasaOS templates declare
  // nothing, so the server reports the placeholders it found in the compose file
  // along with what it would substitute — shown here as editable fields so PUID
  // and TZ are a decision rather than a surprise.
  const params = (full.params || []).length
    ? full.params
    : (full.vars || []).map(v => ({ key: v.name, label: v.name, default: v.value }));
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

/**
 * Progress ring.
 *
 * The number is real: the server parses Docker's own per-layer pull output and
 * averages it. Nothing here animates on a timer — if the ring is not moving,
 * neither is the download, and that is worth being able to see.
 */
const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

function jobModal(title) {
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="jobwrap">
      <div class="donut">
        <svg viewBox="0 0 128 128" role="img" aria-label="Install progress">
          <circle class="track" cx="64" cy="64" r="${RING_R}"></circle>
          <circle class="fill" id="job-ring" cx="64" cy="64" r="${RING_R}"
                  stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${RING_C.toFixed(1)}"></circle>
        </svg>
        <div class="dnum"><span id="job-pct">0</span><i>%</i></div>
      </div>
      <div class="jobmeta">
        <span class="jphase" id="job-phase">preparing…</span>
        <span class="hint">Layers are pulled first, then the containers are created and started.</span>
      </div>
    </div>
    <div class="joblog" id="job-log"><pre></pre></div>`;
  const foot = document.createElement("div");
  foot.innerHTML = `<button class="btn" id="job-close">CLOSE</button>`;
  openModal({ title, body, foot });
  on("#job-close", "click", closeModal);
  return $("#job-log pre");
}

/** Moves the ring. `state` tints it for the terminal outcomes. */
function setJobProgress(pct, phase, state) {
  const ring = $("#job-ring");
  if (!ring) return;                       // the modal was closed mid-install
  const p = clamp(Number(pct) || 0, 0, 100);
  ring.style.strokeDashoffset = String(RING_C * (1 - p / 100));
  const num = $("#job-pct");
  if (num) num.textContent = Math.round(p);
  const ph = $("#job-phase");
  if (ph && phase) ph.textContent = phase;
  const wrap = $(".jobwrap");
  if (wrap && state) wrap.className = "jobwrap " + state;
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
    if (msg.type === "alert") return onAlert(msg.data);
    if (msg.type !== "job") return;
    const d = msg.data;
    const write = activeJobs.get(String(d.id));
    if (write) {
      if (typeof d.progress === "number") setJobProgress(d.progress, d.phase);
      if (d.line) write(d.line, d.status === "error" ? "errl" : d.done ? "okl" : "");
      if (d.done) {
        activeJobs.delete(String(d.id));
        setJobProgress(d.status === "success" ? 100 : (d.progress ?? 0),
                       d.status === "success" ? "done" : "failed",
                       d.status === "success" ? "ok" : "err");
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
  const [libs, sug] = await Promise.all([
    api("/store/libraries").catch(() => []),
    api("/store/libraries/suggested").catch(() => [])
  ]);
  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:12px";
  body.innerHTML = `
    <p>A library is a git repository of app definitions. CasaOS-format stores work as-is.</p>
    <div id="lib-list" style="display:flex;flex-direction:column;gap:8px"></div>
    <div id="lib-sug-wrap"></div>
    <div class="field">
      <label for="lib-url">OR ADD ANY GIT URL</label>
      <input id="lib-url" type="text" placeholder="https://github.com/owner/repo.git" spellcheck="false">
    </div>`;

  const sugWrap = body.querySelector("#lib-sug-wrap");
  const notAdded = sug.filter(s => !s.added);
  if (notAdded.length) {
    sugWrap.innerHTML = `<h3 style="margin:0 0 8px">SUGGESTED</h3><div class="libsug">` +
      notAdded.map(s => `<div class="s">
        <span class="sn">${esc(s.name)}</span>
        <span class="pill idle">${esc(String(s.format).toUpperCase())}</span>
        <button class="btn sm" data-add="${esc(s.url)}" data-nm="${esc(s.name)}">ADD</button>
        <span class="sd">${esc(s.description)}</span>
      </div>`).join("") + `</div>`;
    sugWrap.addEventListener("click", async e => {
      const b = e.target.closest("[data-add]");
      if (!b) return;
      b.disabled = true;
      try {
        await api("/store/libraries", { method: "POST", body: { url: b.dataset.add, name: b.dataset.nm } });
        toast("ADDED — NOW SYNC IT", "ok");
        openLibraries();
      } catch (ex) { toast(ex.message.toUpperCase(), "err"); b.disabled = false; }
    });
  }
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

/* ============================ control panel ============================ */
/**
 * Automations, scheduled container tasks, outbound notifications and power.
 *
 * The whole page is built from the vocabulary the server sends in
 * /api/automation — sources, actions and schedule actions all come down as data.
 * That means the form can never offer a rule the evaluator does not implement,
 * which is the failure mode every hand-written settings screen eventually hits.
 */
const CP = { conf: null, alerts: [] };

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmtSecs(s) {
  s = Number(s) || 0;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${+(s / 3600).toFixed(1)}h`;
  return `${+(s / 86400).toFixed(1)}d`;
}

async function loadControl() {
  try {
    CP.conf = await api("/automation");
  } catch (e) {
    $("#cp-rules").innerHTML = `<div class="empty">${esc(e.message).toUpperCase()}</div>`;
    return;
  }
  await loadAlerts();
  renderRules();
  renderSchedules();
  renderNotify();
  renderPower();
}

/* ---- alerts ---- */
async function loadAlerts() {
  try { CP.alerts = await api("/automation/alerts?limit=60"); } catch { CP.alerts = []; }
  renderAlerts();
}

function renderAlerts() {
  const box = $("#cp-alerts");
  if (!box) return;
  if (!CP.alerts.length) {
    box.innerHTML = `<div class="empty">NOTHING HAS TRIPPED YET — THAT IS THE GOOD OUTCOME</div>`;
    return;
  }
  box.innerHTML = `<div class="alertlist">` + CP.alerts.map(a => `
    <div class="alert ${esc(a.level)}">
      <span class="apill">${esc(String(a.level).toUpperCase())}</span>
      <span class="atxt">
        <span class="at">${esc(a.title)}</span>
        <span class="am">${esc(a.message)}</span>
      </span>
      <span class="awhen mono">${esc(new Date(a.ts).toLocaleString())}</span>
    </div>`).join("") + `</div>`;
}

/* ---- watch rules ---- */
function ruleSummary(r) {
  const src = (CP.conf.sources || []).find(s => s.key === r.source);
  const label = src ? src.label : r.source;
  const anyTarget = !r.target || r.target === "*";

  if (r.source === "container") {
    return `${anyTarget ? "any container" : r.target} stops running for ${fmtSecs(r.forSec)}`;
  }
  // CPU and memory are whole-host readings with nothing to pick, so naming a
  // target at all ("CPU load (any)") reads like a setting you forgot to fill in.
  const which = src?.targets === "none" ? "" : ` (${anyTarget ? "any" : r.target})`;
  return `${label}${which} goes ${r.op} ${r.value}${src?.unit || ""} for ${fmtSecs(r.forSec)}`;
}

function actionLabels(keys) {
  return (keys || []).map(k => (CP.conf.actions.find(a => a.key === k) || {}).label || k).join(", ");
}

function renderRules() {
  const box = $("#cp-rules");
  const rules = CP.conf.rules || [];
  if (!rules.length) {
    box.innerHTML = `<div class="empty">NO RULES — PRESS &ldquo;+ NEW RULE&rdquo;</div>`;
    return;
  }
  box.innerHTML = `<div class="rulelist">` + rules.map(r => `
    <div class="rule${r.enabled ? "" : " off"}">
      <button class="toggle${r.enabled ? " on" : ""}" data-toggle="${esc(r.id)}"
              role="switch" aria-checked="${r.enabled}" title="Enable or disable"><i></i></button>
      <span class="rtxt">
        <span class="rn">${esc(r.name)}</span>
        <span class="rd">When ${esc(ruleSummary(r))} &rarr; ${esc(actionLabels(r.actions))}</span>
        <span class="rd dim">Then stays quiet for ${esc(fmtSecs(r.cooldownSec))}</span>
      </span>
      <span class="pill ${r.severity === "crit" ? "crit" : r.severity === "warn" ? "warn" : "idle"}">${esc(String(r.severity).toUpperCase())}</span>
      <button class="btn sm" data-edit="${esc(r.id)}">EDIT</button>
      <button class="btn sm danger" data-del="${esc(r.id)}">DELETE</button>
    </div>`).join("") + `</div>`;
}

on("#cp-rules", "click", async e => {
  const t = e.target.closest("[data-toggle]"), ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
  if (t) {
    const r = CP.conf.rules.find(x => x.id === t.dataset.toggle);
    if (!r) return;
    try { await api("/automation/rules", { method: "PUT", body: { ...r, enabled: !r.enabled } }); await loadControl(); }
    catch (ex) { toast(ex.message.toUpperCase(), "err"); }
  }
  if (ed) openRuleEditor(CP.conf.rules.find(x => x.id === ed.dataset.edit));
  if (del) {
    const r = CP.conf.rules.find(x => x.id === del.dataset.del);
    if (!r || !confirm(`Delete the rule "${r.name}"?`)) return;
    try { await api(`/automation/rules/${encodeURIComponent(r.id)}`, { method: "DELETE" }); await loadControl(); toast("RULE DELETED", "ok"); }
    catch (ex) { toast(ex.message.toUpperCase(), "err"); }
  }
});

function selectHTML(id, options, current) {
  return `<select id="${id}" class="sel">` + options.map(o =>
    `<option value="${esc(o.value)}"${String(o.value) === String(current) ? " selected" : ""}>${esc(o.label)}</option>`
  ).join("") + `</select>`;
}

function targetOptions(source) {
  const av = CP.conf.available || {};
  const any = { value: "*", label: "Any (worst one)" };
  if (source === "temp") return [any, ...(av.sensors || []).filter(s => s.kind === "temperature").map(s => ({ value: s.id, label: `${s.label} (${s.value}${s.unit})` }))];
  if (source === "disk") return [any, ...(av.mounts || []).map(m => ({ value: m.mount, label: `${m.mount} (${m.usage}% used)` }))];
  if (source === "container") return [{ value: "*", label: "Any container" }, ...(av.containers || []).map(c => ({ value: c.name, label: `${c.name} (${c.state})` }))];
  return null;
}

function openRuleEditor(rule) {
  const isNew = !rule;
  const r = rule || {
    name: "", source: "temp", target: "*", op: "above", value: 80,
    forSec: 120, cooldownSec: 1800, severity: "warn", actions: ["notify"], actionTarget: null, enabled: true
  };
  const sources = CP.conf.sources || [];
  const containers = (CP.conf.available?.containers || []).map(c => ({ value: c.name, label: c.name }));

  const body = document.createElement("div");
  body.className = "cpform";
  body.innerHTML = `
    <div class="field">
      <label for="ru-name">NAME</label>
      <input id="ru-name" type="text" value="${esc(r.name)}" placeholder="CPU temperature high">
    </div>

    <h3>WHEN</h3>
    <div class="frow">
      <div class="field"><label for="ru-src">WATCH</label>
        ${selectHTML("ru-src", sources.map(s => ({ value: s.key, label: s.label })), r.source)}</div>
      <div class="field" id="ru-target-wrap"><label for="ru-target">WHICH ONE</label><span id="ru-target-slot"></span></div>
    </div>
    <div class="frow" id="ru-threshold">
      <div class="field"><label for="ru-op">GOES</label>
        ${selectHTML("ru-op", [{ value: "above", label: "Above" }, { value: "below", label: "Below" }], r.op)}</div>
      <div class="field"><label for="ru-val">THRESHOLD</label>
        <input id="ru-val" type="number" step="0.1" value="${esc(r.value)}"></div>
    </div>
    <div class="frow">
      <div class="field"><label for="ru-for">SUSTAINED FOR (SECONDS)</label>
        <input id="ru-for" type="number" min="0" step="10" value="${esc(r.forSec)}">
        <span class="fh">Stops a one-second spike during a backup from paging you.</span></div>
      <div class="field"><label for="ru-cool">THEN STAY QUIET FOR (SECONDS)</label>
        <input id="ru-cool" type="number" min="60" step="60" value="${esc(r.cooldownSec)}">
        <span class="fh">Without this, a disk at 91% alerts on every tick, forever.</span></div>
    </div>

    <h3>THEN</h3>
    <div class="field"><label>DO</label>
      <div class="checkrow" id="ru-actions"></div>
    </div>
    <div class="field" id="ru-actarget-wrap" hidden>
      <label for="ru-actarget">ON WHICH CONTAINER</label>
      ${selectHTML("ru-actarget", containers.length ? containers : [{ value: "", label: "no containers visible" }], r.actionTarget || "")}
    </div>
    <div class="field"><label for="ru-sev">SEVERITY</label>
      ${selectHTML("ru-sev", [{ value: "info", label: "Info" }, { value: "warn", label: "Warning" }, { value: "crit", label: "Critical" }], r.severity)}</div>
    <div class="warnbox" id="ru-danger" hidden></div>`;

  const foot = document.createElement("div");
  foot.innerHTML = `<button class="btn" id="ru-cancel">CANCEL</button><button class="btn primary" id="ru-save">${isNew ? "CREATE RULE" : "SAVE"}</button>`;
  openModal({ title: isNew ? "NEW RULE" : "EDIT RULE", icon: ICON("warning"), body, foot });

  /* --- reactive bits --- */
  const paintTarget = () => {
    const src = $("#ru-src").value;
    const opts = targetOptions(src);
    const slot = $("#ru-target-slot");
    if (!opts) { $("#ru-target-wrap").hidden = true; slot.innerHTML = ""; }
    else { $("#ru-target-wrap").hidden = false; slot.innerHTML = selectHTML("ru-target", opts, r.target); }
    $("#ru-threshold").hidden = src === "container";
    const s = sources.find(x => x.key === src);
    if (s) $("#ru-val").placeholder = s.unit || "";
  };

  const paintActions = () => {
    const chosen = new Set(r.actions || []);
    $("#ru-actions").innerHTML = CP.conf.actions.map(a => `
      <button type="button" class="ctxcheck${chosen.has(a.key) ? " on" : ""}" data-act="${esc(a.key)}"
              role="switch" aria-checked="${chosen.has(a.key)}">
        <span class="tick" aria-hidden="true">${chosen.has(a.key) ? "&#10003;" : ""}</span>
        <span class="ct"><span class="cl">${esc(a.label)}</span>${a.power ? '<span class="cs">needs power actions armed</span>' : ""}</span>
      </button>`).join("");
    $("#ru-actarget-wrap").hidden = !(chosen.has("container.restart") || chosen.has("container.stop"));

    const power = [...chosen].some(k => (CP.conf.actions.find(a => a.key === k) || {}).power);
    const dz = $("#ru-danger");
    dz.hidden = !power;
    if (power) {
      dz.innerHTML = CP.conf.power.allowRemote
        ? `<b>This rule can power the machine off.</b> Set the threshold somewhere the host genuinely cannot survive, and give it a long sustain — a shutdown triggered by a bad reading is a trip to wherever the box lives.`
        : `<b>Power actions are switched off.</b> This rule will save, but the action will fail until you arm power actions further down the Control Panel.`;
    }
  };

  paintTarget(); paintActions();
  on("#ru-src", "change", paintTarget);
  on("#ru-actions", "click", e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const key = b.dataset.act;
    const set = new Set(r.actions || []);
    if (set.has(key)) set.delete(key); else set.add(key);
    r.actions = [...set];
    paintActions();
  });

  on("#ru-cancel", "click", closeModal);
  on("#ru-save", "click", async () => {
    const src = $("#ru-src").value;
    const payload = {
      id: r.id,
      enabled: r.enabled !== false,
      name: $("#ru-name").value.trim(),
      source: src,
      target: $("#ru-target")?.value ?? "*",
      op: $("#ru-op")?.value || "above",
      value: Number($("#ru-val")?.value ?? 0),
      forSec: Number($("#ru-for").value),
      cooldownSec: Number($("#ru-cool").value),
      severity: $("#ru-sev").value,
      actions: r.actions,
      actionTarget: $("#ru-actarget-wrap").hidden ? null : $("#ru-actarget").value
    };
    if (!payload.actions?.length) return toast("PICK AT LEAST ONE ACTION", "err");
    try {
      await api("/automation/rules", { method: "PUT", body: payload });
      closeModal(); await loadControl();
      toast(isNew ? "RULE CREATED" : "RULE SAVED", "ok");
    } catch (ex) { toast(ex.message.toUpperCase(), "err"); }
  });
}

on("#cp-new-rule", "click", () => openRuleEditor(null));

/* ---- scheduled tasks ---- */
function renderSchedules() {
  const box = $("#cp-schedules");
  const list = CP.conf.schedules || [];
  if (!list.length) {
    box.innerHTML = `<div class="empty">NO SCHEDULED TASKS</div>`;
    return;
  }
  box.innerHTML = `<div class="rulelist">` + list.map(s => {
    const days = s.days?.length === 7 ? "every day" : (s.days || []).map(d => DAY_NAMES[d].slice(0, 3)).join(", ");
    return `<div class="rule${s.enabled ? "" : " off"}">
      <button class="toggle${s.enabled ? " on" : ""}" data-toggle="${esc(s.id)}"
              role="switch" aria-checked="${s.enabled}" title="Enable or disable"><i></i></button>
      <span class="rtxt">
        <span class="rn">${esc(s.name)}</span>
        <span class="rd">${esc(s.action.replace("container.", ""))} <b>${esc(s.target || "—")}</b> at ${esc(s.time)}, ${esc(days)}</span>
        <span class="rd dim">${s.lastRunAt ? "last ran " + esc(since(s.lastRunAt)) : "has not run yet"}${s.lastError ? " · " + esc(s.lastError) : ""}</span>
      </span>
      <button class="btn sm" data-edit="${esc(s.id)}">EDIT</button>
      <button class="btn sm danger" data-del="${esc(s.id)}">DELETE</button>
    </div>`;
  }).join("") + `</div>`;
}

on("#cp-schedules", "click", async e => {
  const t = e.target.closest("[data-toggle]"), ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
  if (t) {
    const s = CP.conf.schedules.find(x => x.id === t.dataset.toggle);
    if (!s) return;
    try { await api("/automation/schedules", { method: "PUT", body: { ...s, enabled: !s.enabled } }); await loadControl(); }
    catch (ex) { toast(ex.message.toUpperCase(), "err"); }
  }
  if (ed) openScheduleEditor(CP.conf.schedules.find(x => x.id === ed.dataset.edit));
  if (del) {
    const s = CP.conf.schedules.find(x => x.id === del.dataset.del);
    if (!s || !confirm(`Delete the task "${s.name}"?`)) return;
    try { await api(`/automation/schedules/${encodeURIComponent(s.id)}`, { method: "DELETE" }); await loadControl(); toast("TASK DELETED", "ok"); }
    catch (ex) { toast(ex.message.toUpperCase(), "err"); }
  }
});

function openScheduleEditor(sched) {
  const isNew = !sched;
  const s = sched || { name: "", time: "04:00", days: [0, 1, 2, 3, 4, 5, 6], action: "container.restart", target: "", enabled: true };
  const containers = (CP.conf.available?.containers || []).map(c => ({ value: c.name, label: `${c.name} (${c.state})` }));
  let days = new Set(s.days || []);

  const body = document.createElement("div");
  body.className = "cpform";
  body.innerHTML = `
    <div class="field"><label for="sc-name">NAME</label>
      <input id="sc-name" type="text" value="${esc(s.name)}" placeholder="Nightly Jellyfin restart"></div>
    <div class="frow">
      <div class="field"><label for="sc-act">DO</label>
        ${selectHTML("sc-act", CP.conf.scheduleActions.map(a => ({ value: a.key, label: a.label })), s.action)}</div>
      <div class="field"><label for="sc-target">CONTAINER</label>
        ${selectHTML("sc-target", containers.length ? containers : [{ value: "", label: "no containers visible" }], s.target || "")}</div>
    </div>
    <div class="frow">
      <div class="field"><label for="sc-time">AT (SERVER LOCAL TIME)</label>
        <input id="sc-time" type="time" value="${esc(s.time)}"></div>
      <div class="field"><label>ON</label><div class="daypick" id="sc-days"></div></div>
    </div>
    <div class="warnbox">
      Whole-host reboots are deliberately not offered here. Rebooting Linux on a
      timer hides a leak rather than finding it and guarantees downtime at a fixed
      hour; restarting the one container that misbehaves does the useful half.
      Reboot and shutdown live under POWER below, and can also be triggered by a
      temperature rule.
    </div>`;

  const foot = document.createElement("div");
  foot.innerHTML = `<button class="btn" id="sc-cancel">CANCEL</button><button class="btn primary" id="sc-save">${isNew ? "CREATE TASK" : "SAVE"}</button>`;
  openModal({ title: isNew ? "NEW SCHEDULED TASK" : "EDIT TASK", icon: ICON("clock"), body, foot });

  const paintDays = () => {
    $("#sc-days").innerHTML = DAY_LABELS.map((d, i) =>
      `<button type="button" class="dayb${days.has(i) ? " on" : ""}" data-day="${i}" title="${DAY_NAMES[i]}"
               role="switch" aria-checked="${days.has(i)}" aria-label="${DAY_NAMES[i]}">${d}</button>`).join("");
  };
  paintDays();
  on("#sc-days", "click", e => {
    const b = e.target.closest("[data-day]");
    if (!b) return;
    const i = Number(b.dataset.day);
    if (days.has(i)) days.delete(i); else days.add(i);
    paintDays();
  });

  on("#sc-cancel", "click", closeModal);
  on("#sc-save", "click", async () => {
    if (!days.size) return toast("PICK AT LEAST ONE DAY", "err");
    if (!$("#sc-target").value) return toast("PICK A CONTAINER", "err");
    try {
      await api("/automation/schedules", {
        method: "PUT",
        body: {
          id: s.id, enabled: s.enabled !== false,
          name: $("#sc-name").value.trim(), time: $("#sc-time").value,
          days: [...days], action: $("#sc-act").value, target: $("#sc-target").value
        }
      });
      closeModal(); await loadControl();
      toast(isNew ? "TASK CREATED" : "TASK SAVED", "ok");
    } catch (ex) { toast(ex.message.toUpperCase(), "err"); }
  });
}

on("#cp-new-task", "click", () => openScheduleEditor(null));

/* ---- notifications ---- */
function renderNotify() {
  const n = CP.conf.notify || {};
  const perm = ("Notification" in window) ? Notification.permission : "unsupported";
  $("#cp-notify").innerHTML = `
    <div class="cpform">
      <div class="field">
        <label for="nt-url">WEBHOOK URL</label>
        <input id="nt-url" type="text" spellcheck="false" value="${esc(n.webhookUrl || "")}"
               placeholder="https://ntfy.sh/my-private-topic">
        <span class="fh">ntfy, a Discord webhook, or any endpoint that accepts a JSON POST.
          The shape is picked from the URL. This is the part that matters — an alert
          that only appears in a tab you do not have open is not an alert.</span>
      </div>
      <div class="frow">
        <div class="field"><label for="nt-fmt">FORMAT</label>
          ${selectHTML("nt-fmt", [
            { value: "auto", label: "Detect from URL" }, { value: "ntfy", label: "ntfy" },
            { value: "discord", label: "Discord" }, { value: "json", label: "Plain JSON" }
          ], n.webhookFormat || "auto")}</div>
        <div class="field"><label>BROWSER NOTIFICATIONS</label>
          <button class="btn" id="nt-browser">${perm === "granted" ? (n.browser === false ? "OFF — TURN ON" : "ON") : perm === "denied" ? "BLOCKED BY BROWSER" : "ENABLE"}</button>
          <span class="fh">Desktop pop-ups while a Nexus tab is open.</span>
        </div>
      </div>
      <div class="rowbtns">
        <button class="btn primary" id="nt-save">SAVE</button>
        <button class="btn" id="nt-test">SEND TEST</button>
      </div>
    </div>`;

  on("#nt-save", "click", async () => {
    try {
      await api("/automation/notify", {
        method: "PUT",
        body: { webhookUrl: $("#nt-url").value.trim(), webhookFormat: $("#nt-fmt").value, browser: CP.conf.notify.browser !== false }
      });
      await loadControl();
      toast("NOTIFICATIONS SAVED", "ok");
    } catch (ex) { toast(ex.message.toUpperCase(), "err"); }
  });

  on("#nt-test", "click", async () => {
    const url = $("#nt-url").value.trim();
    if (!url) return toast("ENTER A WEBHOOK URL FIRST", "err");
    const btn = $("#nt-test");
    btn.disabled = true; btn.textContent = "SENDING…";
    try {
      const out = await api("/automation/notify/test", { method: "POST", body: { webhookUrl: url } });
      toast(`TEST SENT AS ${String(out.format).toUpperCase()}`, "ok");
    } catch (ex) { toast(ex.message.toUpperCase(), "err"); }
    finally { btn.disabled = false; btn.textContent = "SEND TEST"; }
  });

  on("#nt-browser", "click", async () => {
    if (!("Notification" in window)) return toast("THIS BROWSER HAS NO NOTIFICATION API", "err");
    if (Notification.permission === "denied") return toast("UNBLOCK NOTIFICATIONS IN YOUR BROWSER SETTINGS", "err");
    if (Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") return toast("PERMISSION NOT GRANTED", "err");
    }
    const next = CP.conf.notify.browser === false;
    try {
      await api("/automation/notify", {
        method: "PUT",
        body: { webhookUrl: CP.conf.notify.webhookUrl || "", webhookFormat: CP.conf.notify.webhookFormat || "auto", browser: next }
      });
      await loadControl();
    } catch (ex) { toast(ex.message.toUpperCase(), "err"); }
  });
}

/* ---- power ---- */
function renderPower() {
  const p = CP.conf.power || {};
  $("#cp-power").innerHTML = `
    <div class="cpform">
      <div class="warnbox ${p.allowRemote ? "err" : ""}">
        <b>${p.allowRemote ? "Power actions are armed." : "Power actions are switched off."}</b>
        ${p.supported
          ? "While armed, this page — and any rule you give a power action to — can reboot or shut the host down. Leave it off unless you actually want that reachable from a browser."
          : "This host is not Linux, so reboot and shutdown are not wired up. The switch is still stored so your rules keep their settings."}
      </div>
      <div class="rowbtns">
        <button class="btn ${p.allowRemote ? "danger" : "primary"}" id="pw-arm">
          ${p.allowRemote ? "DISARM POWER ACTIONS" : "ARM POWER ACTIONS"}</button>
        <button class="btn danger" id="pw-reboot" ${p.allowRemote && p.supported ? "" : "disabled"}>REBOOT NOW</button>
        <button class="btn danger" id="pw-shutdown" ${p.allowRemote && p.supported ? "" : "disabled"}>SHUT DOWN NOW</button>
      </div>
      <span class="fh">Nexus runs as root, so these do exactly what they say. There is no undo
        and no remote power-on — if the box lives somewhere awkward, think before the second one.</span>
    </div>`;

  on("#pw-arm", "click", async () => {
    const next = !CP.conf.power.allowRemote;
    if (next && !confirm("Arm power actions?\n\nOnce armed, this browser page can reboot or power off the host, and any rule with a power action becomes live.")) return;
    try { await api("/automation/power", { method: "PUT", body: { allowRemote: next } }); await loadControl(); }
    catch (ex) { toast(ex.message.toUpperCase(), "err"); }
  });

  const doPower = async action => {
    const host = LIVE.info?.host?.hostname || "this host";
    // Typing the hostname, not an OK button. A mis-click should not be able to
    // power off a machine you may have to walk to.
    const typed = prompt(`${action === "reboot" ? "Reboot" : "Shut down"} ${host}?\n\nType the hostname to confirm:`);
    if (typed == null) return;
    if (typed.trim() !== host) return toast("HOSTNAME DID NOT MATCH — NOTHING HAPPENED", "err");
    try {
      await api(`/system/power/${action}`, { method: "POST" });
      toast(action === "reboot" ? "REBOOTING…" : "SHUTTING DOWN…", "ok");
    } catch (ex) { toast(ex.message.toUpperCase(), "err"); }
  };
  on("#pw-reboot", "click", () => doPower("reboot"));
  on("#pw-shutdown", "click", () => doPower("shutdown"));
}

/* ---- live alerts ---- */
function onAlert(a) {
  toast(`${String(a.level).toUpperCase()}: ${a.title}`, a.level === "crit" ? "err" : a.level === "warn" ? "err" : "ok");

  if (CP.conf?.notify?.browser !== false && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(a.title, { body: a.message, icon: "/assets/brand/icons/nexus-128.png", tag: a.ruleId || a.id }); } catch {}
  }
  CP.alerts.unshift(a);
  if (CP.alerts.length > 60) CP.alerts.length = 60;
  if ($("#page-control")?.classList.contains("on")) renderAlerts();
}

on("#cp-ack", "click", async () => {
  try { await api("/automation/alerts/ack", { method: "POST" }); await loadAlerts(); toast("ACKNOWLEDGED", "ok"); }
  catch (ex) { toast(ex.message.toUpperCase(), "err"); }
});
on("#cp-clear", "click", async () => {
  if (!confirm("Clear the alert history?")) return;
  try { await api("/automation/alerts", { method: "DELETE" }); await loadAlerts(); }
  catch (ex) { toast(ex.message.toUpperCase(), "err"); }
});

/* ============================ navigation ============================ */
const TITLES = { dash: "Dashboard", store: "App Store", containers: "Containers", files: "Files", term: "Terminal", control: "Control Panel", settings: "Settings" };
const SUBTITLES = { dash: "Your homelab, at a glance.", store: "Find a new home for your next project.", containers: "The services that keep your homelab running.", files: "Everything in its place.", term: "A direct line to your machine.", control: "Your routines, running quietly in the background.", settings: "A workstation that feels like yours." };

function go(page) {
  $$(".nav").forEach(n => {
    n.classList.toggle("on", n.dataset.page === page);
    if (n.dataset.page === page) n.setAttribute("aria-current", "page");
    else n.removeAttribute("aria-current");
  });
  $$(".page").forEach(p => p.classList.toggle("on", p.id === "page-" + page));
  $("#page-title").textContent = TITLES[page] || page;
  $("#page-subtitle").textContent = SUBTITLES[page] || "";
  $("#tools-dash").hidden = page !== "dash";
  $("#tools-containers").hidden = page !== "containers";
  $("#tools-files").hidden = page !== "files";
  $("#tools-store").hidden = page !== "store";
  $("#tools-term").hidden = page !== "term";
  $("#tools-control").hidden = page !== "control";

  // Leaving a page should not leave its selection armed for the Delete key.
  if (page !== "dash") clearSelection();
  if (page !== "files") clearFileSelection();

  if (page === "containers") loadContainers();
  if (page === "files") { wireFileDnD(); loadRoots(); loadFiles(curDir, { history: false }); }
  if (page === "control") loadControl();
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

/* ============================ sidebar ============================ */
const RAIL_MIN = 60, RAIL_MAX = 260, RAIL_WIDE_AT = 132;

function setRail(px, persist = true) {
  const w = clamp(Math.round(px), RAIL_MIN, RAIL_MAX);
  const rail = $("#rail");
  document.documentElement.style.setProperty("--rail-w", w + "px");
  // Icons grow with the rail, but stop before they dominate the labels.
  document.documentElement.style.setProperty("--rail-icon", clamp(Math.round(w * 0.34), 22, 40) + "px");
  rail.classList.toggle("wide", w >= RAIL_WIDE_AT);
  $("#rail-toggle-txt").textContent = w >= RAIL_WIDE_AT ? "◀  MENU" : "☰";
  if (persist) { try { localStorage.setItem("nexus.rail", String(w)); } catch {} }
  if (term && $("#page-term").classList.contains("on")) requestAnimationFrame(fitTerm);
  layout(false);
}

on("#rail-toggle", "click", () => {
  const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rail-w")) || 72;
  setRail(cur >= RAIL_WIDE_AT ? 72 : 180);
});

// Drag the right edge to any width in between.
on("#rail-grip", "pointerdown", e => {
  e.preventDefault();
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  const startX = e.clientX;
  const startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rail-w")) || 72;
  const mv = ev => setRail(startW + (ev.clientX - startX), false);
  const up = () => {
    grip.releasePointerCapture(e.pointerId);
    grip.removeEventListener("pointermove", mv);
    grip.removeEventListener("pointerup", up);
    grip.removeEventListener("pointercancel", up);
    const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rail-w")) || 72;
    setRail(w);
  };
  grip.addEventListener("pointermove", mv);
  grip.addEventListener("pointerup", up);
  grip.addEventListener("pointercancel", up);
});

try {
  const saved = parseInt(localStorage.getItem("nexus.rail"));
  setRail(Number.isFinite(saved) ? saved : 192, false);
} catch { setRail(192, false); }

on("#theme", "click", () => {
  go("settings");
  $("#main").scrollTop = 0;
  $(".palette-choice").focus({ preventScroll: true });
});

function paintAppearance() {
  const a = window.NexusAppearance;
  if (!a) return;
  $$("[data-palette-choice]").forEach(button => button.setAttribute("aria-pressed", String(!a.classic && button.dataset.paletteChoice === a.palette)));
  $("#appearance-status").textContent = a.classic ? "Classic GUI is active. Choose a palette to return to Workstation." : a.palettes[a.palette].name + " is active. Saved in this browser.";
  $("#classic-toggle").textContent = a.classic ? "RETURN TO WORKSTATION" : "USE CLASSIC GUI";
  $("#classic-toggle").setAttribute("aria-pressed", String(a.classic));
  $("#motion-toggle").textContent = "REDUCE MOTION: " + (a.motion === "reduced" ? "ON" : "OFF");
  $("#motion-toggle").setAttribute("aria-pressed", String(a.motion === "reduced"));
}
on(".palette-list", "click", e => {
  const choice = e.target.closest("[data-palette-choice]");
  if (choice) window.NexusAppearance?.setPalette(choice.dataset.paletteChoice);
});
on("#classic-toggle", "click", () => window.NexusAppearance?.setClassic(!window.NexusAppearance.classic));
on("#motion-toggle", "click", () => window.NexusAppearance?.setMotion(window.NexusAppearance.motion === "reduced" ? "full" : "reduced"));
document.addEventListener("nexus:appearance", () => {
  paintAppearance();
  renderWidgets();
  layout(false);
  if (term) { term.options.theme = termTheme(); requestAnimationFrame(fitTerm); }
});
paintAppearance();

function toggleCRT() {
  const r = document.documentElement;
  const on = r.getAttribute("data-crt") === "on";
  if (on) r.removeAttribute("data-crt"); else r.setAttribute("data-crt", "on");
  try { localStorage.setItem("nexus.crt", on ? "off" : "on"); } catch {}
  return !on;
}

on("#add", "click", () => { renderDrawer(); $("#drawer").classList.add("open"); });
on("#dclose", "click", () => $("#drawer").classList.remove("open"));
on("#drawer", "click", e => { if (e.target.id === "drawer") e.currentTarget.classList.remove("open"); });
on("#reset", "click", async () => {
  try { await api("/layout", { method: "DELETE" }); } catch {}
  gridEl.innerHTML = ""; mounted = {}; clearSelection();
  items = DEFAULT_LAYOUT.map((d, i) => ({ id: i + 1, ...d }));
  uid = items.length + 1;
  items.forEach(it => build(it, true));
  // The only place gravity still applies: RESET exists to put things in order,
  // so it closes gaps. Ordinary drags and deletions leave your spacing alone.
  compact();
  layout();
});
addEventListener("resize", () => { layout(false); renderWidgets(); });

/* ============================ start ============================ */
async function start() {
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
  items.forEach(it => build(it, false)); layout(false);
  renderDrawer();                 // after items exist, so "added" is accurate

  api("/system/info").then(i => { LIVE.info = i; renderWidgets(); }).catch(() => {});
  api("/system/metrics").then(m => { LIVE.disks = m.disks || []; renderWidgets(); }).catch(() => {});
  api("/docker/containers").then(o => { if (o.available) { LIVE.containers = o.containers; renderWidgets(); } }).catch(() => {});
  setInterval(() => { api("/system/metrics").then(m => { LIVE.disks = m.disks || []; }).catch(() => {}); }, 30000);
  // The server caches a scan for five minutes, so a minute here costs almost
  // nothing and keeps the widget current without hammering journalctl.
  pollSecurity();
  setInterval(pollSecurity, 60000);
  setInterval(() => { api("/docker/containers").then(o => { if (o.available) LIVE.containers = o.containers; }).catch(() => {}); }, 15000);

  // Fetched up front, not on first visit to the page: onAlert needs to know
  // whether browser notifications are wanted before the first alert arrives.
  api("/automation").then(c => { CP.conf = c; }).catch(() => {});

  connectWS();
  connectEvents();
  refreshInstalled();
  setInterval(renderWidgets, 1000);
}

boot();
})();
