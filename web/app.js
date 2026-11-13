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
const cap = s => (s = String(s ?? "")) && s[0].toUpperCase() + s.slice(1);

/* ============================ line icons ============================
 * One set of crisp stroke icons, drawn in `currentColor`, for the shell, the
 * Overview and Kernel. Inline SVG rather than a sprite file: the CSP allows
 * nothing else without a request per icon, and these are a few hundred bytes
 * each. The pixel PNGs stay where the Classic and Workstation themes use them.
 *
 * Each entry is the inner markup on a 24-unit grid; IC() wraps it.
 */
const P = d => `<path d="${d}"/>`;
const ICONS = {
  maximize: P("M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"),
  minimize: P("M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"),
  sliders: P("M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"),
  palette: '<circle cx="13.5" cy="6.5" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r="1" fill="currentColor" stroke="none"/>' +
    P("M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.6-1.7H16c3 0 5.5-2.5 5.5-5.6C21.5 6 17.2 2 12 2z"),
  search: '<circle cx="11" cy="11" r="7.5"/>' + P("m21 21-4.3-4.3"),
  activity: P("M22 12h-4l-3 9L9 3l-3 9H2"),
  "chevron-down": P("m6 9 6 6 6-6"),
  "chevron-right": P("m9 18 6-6-6-6"),
  "chevron-left": P("m15 18-6-6 6-6"),
  info: '<circle cx="12" cy="12" r="9.5"/>' + P("M12 16v-4") + P("M12 8h.01"),
  file: P("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z") + P("M14 2v4a2 2 0 0 0 2 2h4"),
  layout: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  box: P("M11 21.7a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7z") + P("M12 22V12") + P("m3.3 7 7.7 4.7a2 2 0 0 0 2 0L20.7 7"),
  folder: P("M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"),
  terminal: P("m4 17 6-6-6-6") + P("M12 19h8"),
  store: P("M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z") + P("M3 6h18") + P("M16 10a4 4 0 0 1-8 0"),
  zap: P("M13 2 4.1 13.1a.6.6 0 0 0 .5 1H11l-1 7.9 8.9-11.1a.6.6 0 0 0-.5-1H12z"),
  settings: P("M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z") + '<circle cx="12" cy="12" r="3"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2.5"/>' + P("M9 3v18"),
  "panel-right": '<rect x="3" y="3" width="18" height="18" rx="2.5"/>' + P("M15 3v18"),
  menu: P("M4 6h16M4 12h16M4 18h16"),
  refresh: P("M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8") + P("M21 3v5h-5"),
  moon: P("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"),
  sun: '<circle cx="12" cy="12" r="4"/>' + P("M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"),
  sparkles: P("M12 3.5l1.6 4.6a2 2 0 0 0 1.3 1.3l4.6 1.6-4.6 1.6a2 2 0 0 0-1.3 1.3L12 18.5l-1.6-4.6a2 2 0 0 0-1.3-1.3L4.5 11l4.6-1.6a2 2 0 0 0 1.3-1.3z") + P("M19 3v3M17.5 4.5h3M5 17v3M3.5 18.5h3"),
  logout: P("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4") + P("m16 17 5-5-5-5") + P("M21 12H9"),
  plus: P("M5 12h14M12 5v14"),
  upload: P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4") + P("m17 8-5-5-5 5") + P("M12 3v12"),
  history: P("M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8") + P("M3 3v5h5") + P("M12 7v5l4 2"),
  corner: P("m7 7 10 10") + P("M17 7v10H7"),
  x: P("M18 6 6 18M6 6l12 12"),
  paperclip: P("m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.7 5.7l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5"),
  "arrow-up": P("m5 12 7-7 7 7") + P("M12 19V5"),
  server: '<rect x="2.5" y="3" width="19" height="8" rx="2"/><rect x="2.5" y="13" width="19" height="8" rx="2"/>' + P("M6.5 7h.01M6.5 17h.01"),
  globe: '<circle cx="12" cy="12" r="9.5"/>' + P("M12 2.5a14.5 14.5 0 0 0 0 19 14.5 14.5 0 0 0 0-19") + P("M2.5 12h19"),
  database: '<ellipse cx="12" cy="5" rx="8.5" ry="3"/>' + P("M3.5 5v14a8.5 3 0 0 0 17 0V5") + P("M3.5 12a8.5 3 0 0 0 17 0"),
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/>' + P("M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"),
  memory: P("M6 19v-3M10 19v-3M14 19v-3M18 19v-3M8 11V9M16 11V9M12 11V9M2 15h20") + P("M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.8V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.8Z"),
  drive: P("M22 12H2") + P("M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z") + P("M6 16h.01M10 16h.01"),
  network: P("m3 16 4 4 4-4") + P("M7 20V4") + P("m21 8-4-4-4 4") + P("M17 4v16"),
  thermo: P("M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"),
  clock: '<circle cx="12" cy="12" r="9.5"/>' + P("M12 6.5V12l3.5 2"),
  shield: P("M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"),
  bell: P("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9") + P("M10.3 21a1.9 1.9 0 0 0 3.4 0"),
  alert: '<circle cx="12" cy="12" r="9.5"/>' + P("M12 7.5v5") + P("M12 16.5h.01"),
  "check-circle": '<circle cx="12" cy="12" r="9.5"/>' + P("m8.5 12 2.5 2.5 5-5"),
  "x-circle": '<circle cx="12" cy="12" r="9.5"/>' + P("m15 9-6 6M9 9l6 6"),
  half: '<circle cx="12" cy="12" r="9.5"/>' + '<path d="M12 6.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"/>',
  minus: '<circle cx="12" cy="12" r="9.5"/>' + P("M8 12h8"),
  external: P("M7 7h10v10") + P("M7 17 17 7"),
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/>' + P("M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"),
  check: P("M20 6 9 17l-5-5"),
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  trash: P("M3 6h18") + P("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6") + P("M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2"),
  edit: P("M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z"),
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2.5"/>' + P("M6 9h.01M10 9h.01M14 9h.01M18 9h.01M8 13h.01M12 13h.01M16 13h.01M7 16.5h10"),
  home: P("M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8") + P("M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"),
  lock: '<rect x="3.5" y="11" width="17" height="10.5" rx="2"/>' + P("M7.5 11V7a4.5 4.5 0 0 1 9 0v4"),
  gauge: P("m12 14 4-4") + P("M3.3 19a10 10 0 1 1 17.4 0"),
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/>' + P("M16 2.5v4M8 2.5v4M3 10h18"),
  message: P("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"),
  retry: P("M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8") + P("M3 3v5h5"),
  "arrow-down": P("M12 5v14") + P("m19 12-7 7-7-7"),
  wifi: P("M12 20h.01") + P("M2 8.8a15 15 0 0 1 20 0") + P("M5 12.9a10 10 0 0 1 14 0") + P("M8.5 16.4a5 5 0 0 1 7 0"),
  image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="2"/>' + P("m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"),
  power: P("M12 2v10") + P("M18.4 6.6a9 9 0 1 1-12.8 0"),
  list: P("M8 6h13M8 12h13M8 18h13") + P("M3.5 6h.01M3.5 12h.01M3.5 18h.01"),
  play: P("M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5Z"),
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
  pin: P("M12 17v5") + P("M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"),
  tag: P("M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z") + '<circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/>',
  key: '<circle cx="7.5" cy="15.5" r="5"/>' + P("m21 2-9.6 9.6") + P("m15.5 7.5 3 3L22 7l-3-3"),
  eye: P("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z") + '<circle cx="12" cy="12" r="3"/>',
  "eye-off": P("M10.7 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6") + P("M2 2l20 20") + P("M9.9 9.9a3 3 0 0 0 4.2 4.2"),
  link: P("M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7") + P("M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"),
  code: P("m16 18 6-6-6-6") + P("m8 6-6 6 6 6"),
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'
};
/** An icon as markup. Unknown names draw nothing rather than throwing. */
function IC(name, cls = "") {
  const body = ICONS[name];
  if (!body) return "";
  return `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
/** Fill every `<i class="ic" data-ic="name">` placeholder in the static HTML. */
function hydrateIcons(root = document) {
  $$("i.ic[data-ic]", root).forEach(el => { if (!el.firstChild) el.innerHTML = IC(el.dataset.ic); });
}
hydrateIcons();

/**
 * Sentence case for a message that arrives in capitals.
 *
 * The pixel theme shouted everything and a lot of strings were written that
 * way; the modern theme reads in sentence case. Only a message with no
 * lowercase letter at all is touched, and acronyms survive.
 */
const KEEP_CAPS = new Set(["CPU", "RAM", "SSH", "PIN", "URL", "API", "IP", "DNS", "HTTP", "HTTPS", "TCP", "ID", "OK",
  "AI", "GUI", "OS", "SMART", "JSON", "YAML", "LAN", "VPN", "TLS", "KB", "MB", "GB", "TB", "UTC", "PTY"]);
function human(msg) {
  const s = String(msg ?? "");
  if (/[a-z]/.test(s) || !/[A-Z].*[A-Z]/.test(s)) return s;
  return s.toLowerCase()
    .replace(/[a-z][a-z]*/g, w => (KEEP_CAPS.has(w.toUpperCase()) ? w.toUpperCase() : w === "nexus" ? "Nexus" : w))
    .replace(/^([^a-z]*)([a-z])/, (_, a, b) => a + b.toUpperCase());
}

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
  el.innerHTML = IC(kind === "err" ? "alert" : kind === "ok" ? "check-circle" : "bell", "t-ico") +
    `<span>${esc(human(msg))}</span>`;
  const host = $("#toast");
  // Three at a time. A burst of failures used to stack a column of toasts up
  // the screen that outlived the thing that caused them.
  while (host.children.length >= 3) host.firstElementChild.remove();
  host.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 220); }, 3400);
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

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
    $("#gate-title").textContent = "Nexus — first run";
    $("#gate-msg").textContent = "No account exists yet. Create your admin user.";
    $("#g-submit").textContent = "Create account";
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
    if (password.length < 8) { err.textContent = "Password must be at least 8 characters"; return; }
    if (password !== $("#g-confirm").value) { err.textContent = "Passwords do not match"; return; }
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
    err.textContent = String(ex.message || "Sign in failed");
  } finally {
    $("#g-submit").disabled = false;
  }
});
// The button ships disabled so the form cannot be submitted natively (a GET
// with the password in the URL) before this script has loaded.
const gateBtn = $("#g-submit"); if (gateBtn) gateBtn.disabled = false;

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

/* ============================ the live link ============================
 * The metrics socket is the fast path. It is not the only path.
 *
 * Reached through a reverse proxy — a DuckDNS name in front of Nginx Proxy
 * Manager is the common case — a WebSocket is the one thing that needs the
 * proxy to have been told about it. nginx does not forward an Upgrade unless
 * it is configured to, and NPM ships that switch OFF. The socket then never
 * opens, and every reading on the dashboard sits at zero with no explanation,
 * which is exactly what happened to this dashboard's owner.
 *
 * So: the socket is tried, and if it will not open the dashboard falls back to
 * polling the same numbers over plain HTTP, which is the half of the connection
 * that demonstrably works — you are reading this page over it. The status pill
 * says which mode it is in, and `diagnoseLink()` asks the server what it can
 * see so the banner can name the actual cause instead of shrugging.
 */
let ws = null, wsRetry = 0;
let wsEverOpen = false, pollTimer = null, linkState = "connecting";

/* A deadline rather than a retry count. With exponential backoff, "three
   attempts" can be fifteen seconds of a page that says CONNECTING and shows
   nothing — longer than anyone waits before deciding it is broken. */
const WS_DEADLINE_MS = 6000;
let wsDeadline = null;

function setLinkState(state, tip) {
  linkState = state;
  const el = $("#st-state");
  if (!el) return;
  const look = {
    connecting: ["var(--text-3)", "Connecting", "Opening the live metrics stream."],
    live:       ["var(--ok)",     "Live",       "Live metrics stream over a WebSocket."],
    polling:    ["var(--warn)",   "Polling",    "The WebSocket could not be opened, so readings are being fetched over HTTP instead."],
    offline:    ["var(--crit)",   "Offline",    "No connection to the server."]
  }[state] || ["var(--crit)", "Offline", ""];
  el.innerHTML = `<i class="dot${state === "live" ? " live" : ""}" style="color:${look[0]}"></i><span>${look[1]}</span>`;
  // The colour lives in CSS keyed off this, so the workstation theme cannot
  // pin the pill green while the link is actually down.
  el.dataset.link = state;
  el.setAttribute("data-tip", tip || look[2]);
}

/** The WebSocket frame and GET /system/metrics describe the same machine in two
 *  different shapes. This is the one place that knows both. */
function applyFrame(d) {
  Object.assign(LIVE, {
    t: d.t || Date.now(),
    cpu: d.cpu, mem: d.mem, net: d.net,
    memUsed: d.memUsed, memTotal: d.memTotal, bootAt: d.bootAt,
    uptimeSec: d.uptimeSec, sensors: d.sensors || [], history: d.history || LIVE.history,
    cores: d.cores || [], disk: d.disk ?? null,
    procs: d.procs || LIVE.procs,
    loadavg: d.loadavg || LIVE.loadavg,
    swapUsed: d.swapUsed ?? 0, swapTotal: d.swapTotal ?? 0
  });
  paintTopbar();
  renderWidgets();
  onLiveFrame();
}

function applyFull(m) {
  applyFrame({
    t: m.updatedAt || Date.now(),
    cpu: m.cpu?.usage ?? 0, mem: m.mem?.usage ?? 0,
    net: m.net || { rx: 0, tx: 0 },
    memUsed: m.mem?.used ?? 0, memTotal: m.mem?.total ?? 0,
    bootAt: Date.now() - (m.uptimeSec || 0) * 1000,
    uptimeSec: m.uptimeSec, sensors: m.sensors, history: m.history,
    cores: m.cores, disk: m.diskIO ?? null, procs: m.procs,
    loadavg: m.cpu?.loadavg, swapUsed: m.mem?.swapUsed, swapTotal: m.mem?.swapTotal
  });
  LIVE.disks = m.disks || LIVE.disks;
}

/** Ask the server what it sees, so the banner can say what is actually wrong. */
async function diagnoseLink() {
  let d = null;
  // Tell the server which origin the socket would announce — this GET does not
  // carry one, and diagnosing the wrong request gives the wrong answer.
  try { d = await api("/system/proxy-check?origin=" + encodeURIComponent(location.origin)); }
  catch { /* the whole API is down */ }
  if (!d) {
    return showLinkBanner("crit", "Nexus is not answering.",
      "The page is loaded but the API is unreachable. Check that the service is running: <code>systemctl status nexus</code>.");
  }
  if (!d.ok) {
    // The origin check refused the upgrade. That is a config answer, and we
    // know exactly which line to paste.
    return showLinkBanner("warn", "Live updates are blocked by the origin check.",
      `The server refused the WebSocket: ${esc(d.reason)}.<br>` +
      `Add this to <code>${esc(d.configFile)}</code> and restart Nexus:` +
      `<pre>${esc(JSON.stringify(
        d.suggest.trustedProxies
          ? { allowedOrigins: d.suggest.allowedOrigins || [], trustedProxies: d.suggest.trustedProxies }
          : { allowedOrigins: d.suggest.allowedOrigins || [] }, null, 2))}</pre>`);
  }
  // The origin is fine, so the upgrade is not reaching us at all — something in
  // front of Nexus is dropping it.
  return showLinkBanner("warn", "Your reverse proxy is not forwarding WebSockets.",
    (d.behindProxy
      ? `Nexus is being reached through a proxy at <code>${esc(d.peer || "?")}</code>, and the ` +
        `origin is allowed — but the upgrade request never arrives. In <b>Nginx Proxy Manager</b>, ` +
        `open this host and turn on <b>Websockets Support</b>. In plain nginx, the location needs ` +
        `<code>proxy_set_header Upgrade $http_upgrade;</code> and ` +
        `<code>proxy_set_header Connection "upgrade";</code>.`
      : `The browser could not open a WebSocket to this server. A proxy, VPN or firewall between ` +
        `you and Nexus is dropping the upgrade.`) +
    `<br>Readings below are being polled over HTTP instead, so they update every few seconds ` +
    `rather than every second. <b>The terminal needs the WebSocket and will not work until this is fixed.</b>`);
}

function showLinkBanner(kind, title, html) {
  let el = $("#wsbanner");
  if (!el) {
    el = document.createElement("div");
    el.id = "wsbanner";
    el.setAttribute("role", "status");
    $("#main")?.prepend(el);
  }
  el.className = "wsbanner " + kind;
  el.innerHTML = `<div class="wsb-body"><b>${esc(title)}</b><div>${html}</div></div>` +
                 `<button class="wsb-x" type="button" aria-label="Dismiss">&times;</button>`;
  $(".wsb-x", el).addEventListener("click", () => el.remove());
}

function startPolling() {
  if (pollTimer) return;
  setLinkState("polling");
  const tick = () => api("/system/metrics").then(applyFull).catch(() => setLinkState("offline"));
  tick();
  pollTimer = setInterval(tick, 3000);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function connectWS() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";

  // Armed once, on the first attempt. If nothing has opened by the time it
  // fires, stop waiting and start polling — whatever the retry count is up to.
  if (!wsEverOpen && !pollTimer && wsDeadline === null) {
    wsDeadline = setTimeout(() => {
      wsDeadline = null;
      if (!wsEverOpen && !pollTimer) { startPolling(); diagnoseLink(); }
    }, WS_DEADLINE_MS);
  }

  try { ws = new WebSocket(`${proto}//${location.host}/ws/metrics`); }
  catch { return void onWsDown(); }

  if (!wsEverOpen && !pollTimer) setLinkState("connecting");

  ws.onopen = () => {
    wsRetry = 0; wsEverOpen = true;
    if (wsDeadline !== null) { clearTimeout(wsDeadline); wsDeadline = null; }
    stopPolling();
    $("#wsbanner")?.remove();
    setLinkState("live");
  };
  ws.onmessage = ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type !== "metrics") return;
    applyFrame(msg.data);
  };
  ws.onclose = () => onWsDown();
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function onWsDown() {
  wsRetry++;
  // A socket that has worked before is probably just a restart or a dropped
  // connection: keep the old reading on screen and reconnect quietly. One that
  // has NEVER opened is a different fact, and is worth saying out loud.
  if (wsEverOpen) setLinkState("offline");

  setTimeout(connectWS, Math.min(500 * 2 ** Math.min(wsRetry, 6), 30000));
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
/* Token reads are cached. Every chart asked getComputedStyle for two or three
   tokens on every redraw — a style recalculation per chart per second — for
   values that only change when the theme does. */
const cssCache = new Map();
const cssv = n => {
  if (!cssCache.has(n)) cssCache.set(n, getComputedStyle(document.documentElement).getPropertyValue(n).trim());
  return cssCache.get(n);
};
document.addEventListener("nexus:appearance", () => cssCache.clear());

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

function probeFromEvent(e) {
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
    // One bad frame must not take hovering down for the rest of the session —
    // this runs on every mouse move, so an uncaught throw here is permanent.
    try { if (probeWant) drawProbe(probeWant.svg, probeWant.x); }
    catch (err) { console.error("[nexus] chart readout:", err); hideProbe(); }
  });
}
addEventListener("pointermove", probeFromEvent, { passive: true });
// pointerover fires the moment the pointer crosses onto the chart. Without it
// the readout waits for the next move, which on a slow, deliberate approach is
// long enough to look like nothing happened.
addEventListener("pointerover", probeFromEvent, { passive: true });

addEventListener("pointerdown", e => {
  // A press on the chart you are already reading starts nothing — the body is
  // not a drag handle any more — so the readout has no reason to blink out and
  // come straight back. Every other press is a gesture beginning somewhere else.
  if (probeSvg && e.target?.closest?.("svg.chart") === probeSvg) return;
  hideProbe();
}, true);
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
    : def.name;

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
  $("#ctx-remove").textContent = many ? `REMOVE ${sel.length}` : "Remove";

  // Ctrl-click is how a selection is built with a mouse; touch has no modifier
  // key, so the menu carries the same action as a button.
  const selBtn = $("#ctx-select");
  selBtn.hidden = false;
  selBtn.textContent = many ? "Clear selection"
    : selection.has(sel[0].id) ? "Deselect" : "Select";

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
      `<span class="tick" aria-hidden="true"></span>` +
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
  all.appendChild(mk("All", () => setCfg({ [p.key]: [] })));
  all.appendChild(mk("None", () => setCfg({ [p.key]: p.items.map(i => i.value) })));
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
        { label: "Load", fmt: v => v.toFixed(1) + "%" });
      const t = LIVE.sensors.find(s => s.kind === "temperature");
      r.sub.textContent = `${LIVE.info?.cpu?.cores || "?"} cores${t ? " · " + Math.round(t.value) + "°C" : ""}`; } },

  memory: { name: "Memory", icon: ICON("memory"), desc: "RAM in use", w: 4, h: 3,
    mount(b) { b.innerHTML = '<div class="big"><span class="n">--</span><span class="u">%</span></div><svg class="chart"></svg><span class="sub"></span>';
      return { n: $(".n", b), svg: $("svg", b), sub: $(".sub", b) }; },
    update(r, cfg) { r.n.textContent = Math.round(LIVE.mem);
      drawChart(r.svg, LIVE.history.mem, 100, colorCss(cfg.color),
        { label: "Used", fmt: v => v.toFixed(1) + "%" });
      r.sub.textContent = LIVE.memTotal ? bytes(LIVE.memUsed) + " of " + bytes(LIVE.memTotal) : ""; } },

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
        const cls = d.usage >= 90 ? "crit" : d.usage >= 80 ? "warn" : "";
        return `<li class="wmount"><span class="wm-top"><span class="k">${esc(d.mount)}</span>
            <span class="v ${cls}"><b>${d.usage}%</b> · ${bytes(d.available)} free</span></span>
          <span class="wbar"><i class="${cls}" style="width:${clamp(d.usage, 0, 100)}%"></i></span></li>`;
      }).join(""); } },

  network: { name: "Network", icon: ICON("network"), desc: "Throughput in and out", w: 4, h: 4,
    defaults: { trace: "rx" },
    options: [
      { key: "trace", label: "Graph shows", values: [
        { value: "rx", label: "Download" }, { value: "tx", label: "Upload" }] }
    ],
    mount(b) {
      // Both directions get an equal, labelled slot. Previously download was a
      // giant number and upload was an arrow in the footnote, which made it
      // look like two unrelated readings.
      b.innerHTML = `
        <div class="netrow">
          <div class="netstat"><span class="nlbl">Down</span><span class="nval rx">--</span></div>
          <div class="netstat"><span class="nlbl">Up</span><span class="nval tx">--</span></div>
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
        { label: cfg.trace === "tx" ? "Up" : "Down", fmt: rate });
    } },

  sensors: { name: "Sensors", icon: ICON("temp"), desc: "Temperatures and fans", w: 4, h: 4,
    defaults: { mode: "bars" },
    options: [
      { key: "mode", label: "Display", values: [
        { value: "bars", label: "Bars" }, { value: "list", label: "List" }] }
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
        { value: "all", label: "All" }, { value: "running", label: "Running" }, { value: "stopped", label: "Stopped" }] },
      { key: "limit", label: "How many", values: [
        { value: 5, label: "5" }, { value: 10, label: "10" }, { value: 20, label: "20" }, { value: 99, label: "All" }] }
    ],
    mount(b) {
      b.innerHTML = '<div class="csummary"></div><div class="clist"></div>';
      const el = { sum: $(".csummary", b), list: $(".clist", b), busy: new Set() };
      // Delegated so the handler survives every re-render.
      el.list.addEventListener("click", async e => {
        const open = e.target.closest("[data-wctr]");
        if (open) { go("containers"); manageFromAnywhere(open.dataset.wctr); return; }
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        e.stopPropagation();
        const { id, act, nm } = btn.dataset;
        btn.disabled = true;
        el.busy.add(id);
        try {
          await api(`/docker/containers/${encodeURIComponent(id)}/${act}`, { method: "POST" });
          toast(`${cap(act)} ${nm}`, "ok");
          const o = await api("/docker/containers");
          if (o.available) LIVE.containers = o.containers;
        } catch (ex) {
          toast(ex.message, "err");
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
        r.sum.innerHTML = '<span class="pill idle">Docker unavailable or no containers</span>';
        r.list.innerHTML = "";
        return;
      }
      const running = all.filter(c => c.state === "running").length;
      r.sum.innerHTML =
        `<span class="pill ok"><i class="dot"></i>${running} running</span>` +
        (all.length - running ? `<span class="pill crit"><i class="dot"></i>${all.length - running} stopped</span>` : "");

      const rows = all
        .filter(c => cfg.show === "all" || (cfg.show === "running") === (c.state === "running"))
        .slice(0, cfg.limit || 10);

      r.list.innerHTML = rows.map(c => {
        const up = c.state === "running";
        const busy = r.busy.has(c.id);
        // Every published port, not just the first: an app with a web UI on one
        // port and an API on another was showing you only one of them.
        const g = up ? portGroups(c.ports) : [];
        return `<div class="crow${up ? "" : " is-down"}${busy ? " busy" : ""}">
          <i class="cdot ${up ? "up" : "down"}"></i>
          <button type="button" class="cname" data-wctr="${esc(c.id)}" data-tip="${esc(c.image)} — press for details">${esc(c.title || c.name)}</button>
          <span class="cports">${g.length ? portChip(g.find(p => p.port && p.port.type !== "udp") || g[0]) + (g.length > 1 ? `<span class="cpc more">+${g.length - 1}</span>` : "") : ""}</span>
          <span class="cbtns">
            <button class="cact" data-act="${up ? "stop" : "start"}" data-id="${esc(c.id)}" data-nm="${esc(c.name)}"
                    aria-label="${up ? "Stop" : "Start"} ${esc(c.name)}" data-tip="${up ? "Stop" : "Start"}" ${busy ? "disabled" : ""}>${IC(up ? "stop" : "play")}</button>
            <button class="cact" data-act="restart" data-id="${esc(c.id)}" data-nm="${esc(c.name)}"
                    aria-label="Restart ${esc(c.name)}" data-tip="Restart" ${busy || !up ? "disabled" : ""}>${IC("retry")}</button>
          </span>
        </div>`;
      }).join("") || '<div class="empty">Nothing matches that filter</div>';
    } },

  uptime: { name: "Uptime", icon: ICON("power"), desc: "Time since last boot", w: 3, h: 2,
    mount(b) { b.innerHTML = '<div class="big"><span class="n" style="font-size:22px">--</span></div><span class="sub">since last boot</span>';
      return { n: $(".n", b) }; },
    update(r) { r.n.textContent = upfmt(LIVE.uptimeSec); } },

  clock: { name: "Clock", icon: ICON("clock"), desc: "Digital or analog, with the date", w: 3, h: 3,
    defaults: { face: "digital", h12: true, seconds: false },
    options: [
      { key: "face", label: "Face", values: [
        { value: "digital", label: "Digital" }, { value: "analog", label: "Analog" }] },
      { key: "h12", label: "Format", values: [
        { value: true, label: "12 H" }, { value: false, label: "24 H" }] },
      { key: "seconds", label: "Seconds", values: [
        { value: false, label: "Off" }, { value: true, label: "On" }] }
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
        { value: "both", label: "Both" }, { value: "uptime", label: "Uptime" }, { value: "when", label: "When" }] }
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
        { value: "she", label: "She" }, { value: "he", label: "He" }] },
      { key: "rest", label: "Sleep", values: [
        { value: "auto", label: "Auto" }, { value: "awake", label: "Keep awake" }, { value: "asleep", label: "Let sleep" }] },
      { key: "posture", label: "Posture", values: [
        { value: "auto", label: "Auto" }, { value: "sit", label: "Sitting" }, { value: "stand", label: "Stand up" }] },
      { key: "chatty", label: "Talks", values: [
        { value: "quiet", label: "Rarely" }, { value: "normal", label: "Sometimes" }, { value: "chatty", label: "A lot" }] }
    ],
    // Naming the cat is the one setting that needs free text, so it gets a
    // prompt rather than a row of preset buttons.
    actions: [
      { label: "Rename", icon: ICON("textsize"), run(it) {
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

  /* ------------------------------------------------------------- health */
  health: { name: "Health", icon: ICON("warning"), go: "overview",
    desc: "Is anything wrong right now — and what", w: 3, h: 6,
    mount(b) {
      b.innerHTML = '<div class="hw"></div>';
      const box = b.firstElementChild;
      box.addEventListener("click", e => {
        const p = e.target.closest("[data-harea]");
        if (p) go("area", p.dataset.harea);
      });
      return { box };
    },
    update(r) {
      const problems = allProblems();
      const down = problems.filter(p => p.status === "down").length;
      let st, title, line;
      if (!CK.data?.updatedAt) { st = "idle"; title = "Checking…"; line = "The first round of checks is running."; }
      else if (!problems.length) {
        const n = CK.data.checks.filter(c => c.status !== "off" && c.status !== "unknown").length;
        st = "ok"; title = "All clear"; line = `${n} check${n === 1 ? "" : "s"} passing`;
      } else {
        st = down ? "crit" : "warn";
        title = `${problems.length} problem${problems.length === 1 ? "" : "s"}`;
        line = down ? `${down} down${problems.length - down ? `, ${problems.length - down} degraded` : ""}` : "degraded, not down";
      }
      const areas = (CK.data?.areas || []).map(a => {
        const cls = statusClass(a.status);
        return `<button type="button" class="hw-area s-${cls}" data-harea="${esc(a.id)}" data-tip="${esc(AREA_META[a.id]?.name || a.id)}: ${a.up ?? 0} of ${a.total ?? 0} passing">
          <i class="hw-dot"></i><span>${esc(AREA_META[a.id]?.name || a.id)}</span><em>${a.total ? `${a.up}/${a.total}` : "—"}</em></button>`;
      }).join("");
      const list = problems.slice(0, 6).map(p => `
        <div class="hw-prob s-${p.status === "down" ? "crit" : "warn"}"><i class="hw-dot"></i>
          <span><b>${esc(p.name)}</b><small>${esc(p.areaName || "")}${p.msg ? " · " + esc(p.msg) : ""}</small></span></div>`).join("");
      const html = `
        <div class="hw-top s-${st}"><span class="hw-ico">${IC(st === "ok" ? "check-circle" : st === "crit" ? "alert" : st === "warn" ? "half" : "activity")}</span>
          <span class="hw-txt"><b>${esc(title)}</b><small>${esc(line)}</small></span></div>
        ${list ? `<div class="hw-probs">${list}</div>` : ""}
        <div class="hw-areas">${areas}</div>`;
      if (r.sig !== html) { r.box.innerHTML = html; r.sig = html; }
    } },

  /* --------------------------------------------------------------- apps */
  apps: { name: "Apps", icon: ICON("apps"), go: "apps",
    desc: "Your apps as buttons, with whether each one is up", w: 4, h: 6,
    defaults: { pick: "top", limit: 12 },
    options: [
      { key: "pick", label: "Show", values: [
        { value: "top", label: "Most used" }, { value: "pinned", label: "Pinned" }, { value: "all", label: "A–Z" }] },
      { key: "limit", label: "How many", values: [
        { value: 6, label: "6" }, { value: 12, label: "12" }, { value: 24, label: "24" }, { value: 99, label: "All" }] }
    ],
    mount(b) {
      b.innerHTML = '<div class="wapps"></div>';
      const box = b.firstElementChild;
      box.addEventListener("click", e => {
        const t = e.target.closest("[data-wapp]");
        if (t) openApp(LP.apps.find(a => a.id === t.dataset.wapp));
      });
      return { box };
    },
    update(r, cfg) {
      const all = (LP.apps || []).filter(a => a.url || a.locked);
      const s = launchStats(), now = Date.now();
      const score = a => { const x = s[a.id]; return x ? x.n * Math.pow(0.5, (now - x.at) / (14 * 86400e3)) : 0; };
      const byName = (a, b) => String(a.name).localeCompare(String(b.name));
      let list = cfg.pick === "pinned" ? all.filter(a => a.pinned).sort(byName)
        : cfg.pick === "all" ? all.slice().sort(byName)
        : all.slice().sort((a, b) => score(b) - score(a) || (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || byName(a, b));
      list = list.slice(0, cfg.limit || 12);
      const html = list.length ? list.map(a => {
        const st = appStatus(a), src = iconSrc(a);
        return `<button type="button" class="wapp" data-wapp="${esc(a.id)}"${src ? ` data-tint="${esc(src)}"` : ""}${tintStyle(src)}
            data-tip="${esc(a.name)}${a.locked ? " — needs the PIN" : ""}${st === "down" ? " — down" : st === "warn" ? " — slow" : ""}">
          <span class="wapp-ico">${appIconHTML(a)}<i class="wapp-st s-${statusClass(st)}"></i></span>
          <span class="wapp-name">${esc(a.name)}</span></button>`;
      }).join("")
        : `<p class="wempty">${cfg.pick === "pinned" ? "Nothing is pinned yet — pin an app on the Apps page." : "No apps yet — add some on the Apps page."}</p>`;
      if (r.sig !== html) { r.box.innerHTML = html; r.sig = html; wireIcons(r.box); }
    } },

  /* ---------------------------------------------------------- CPU cores */
  cores: { name: "CPU Cores", icon: ICON("cpu"),
    desc: "Load on every core, so you can see one pegged thread", w: 4, h: 4,
    defaults: { mode: "grid", labels: true },
    options: [
      { key: "mode", label: "Display", values: [
        { value: "grid", label: "Grid" }, { value: "bars", label: "Bars" }] },
      { key: "labels", label: "Numbers", values: [
        { value: true, label: "On" }, { value: false, label: "Off" }] }
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
        { value: "cpu", label: "CPU" }, { value: "mem", label: "Memory" }] },
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
          <div class="netstat"><span class="nlbl">Read</span><span class="nval rd">--</span></div>
          <div class="netstat"><span class="nlbl">Write</span><span class="nval wr">--</span></div>
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
        { upLabel: "Read", downLabel: "Write", fmt: rate });
    } },

  /* ------------------------------------------------------ security watch */
  security: { name: "Security Watch", icon: ICON("lock"),
    desc: "Failed logins, exposed ports and pending patches", w: 5, h: 5,
    defaults: { hours: 24, detail: "findings" },
    options: [
      { key: "hours", label: "Look back", values: [
        { value: 1, label: "1 H" }, { value: 24, label: "24 H" }, { value: 168, label: "7 D" }] },
      { key: "detail", label: "Show", values: [
        { value: "findings", label: "Findings" }, { value: "tiles", label: "Counts only" }] }
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
        tile("ssh", "SSH fails", sshV, d.ssh?.ok ? `${d.ssh.sources} distinct sources` : d.ssh?.reason, d.ssh?.ok && d.ssh.count >= 10) +
        tile("nexus", "Nexus fails", nexV, "Failed logins to Nexus itself", d.nexus?.ok && d.nexus.count > 0) +
        tile("ports", "Open ports", portV, d.ports?.ok ? "Listening on all interfaces" : d.ports?.reason, false) +
        tile("updates", "Sec. updates", updV, d.updates?.ok ? `${d.updates.total} updates in total` : d.updates?.reason, d.updates?.ok && d.updates.security > 0) +
        tile("sessions", "Sessions", sesV, d.sessions?.ok ? "Active logins right now" : d.sessions?.reason, false);

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
        { value: false, label: "Roomy" }, { value: true, label: "Dense" }] }
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

/* Line icons for the widget headers. Each slot carries both the pixel PNG and
   the line icon; the stylesheet shows the one that suits the theme. The cat is
   always her own sprite. */
const W_ICONS = { cpu: "cpu", memory: "memory", storage: "drive", network: "network", sensors: "thermo",
  containers: "box", uptime: "power", clock: "clock", boot: "calendar", cores: "cpu", procs: "terminal",
  diskio: "drive", security: "shield", host: "home", health: "activity", apps: "grid" };
function widgetIcon(type, def) {
  const ln = W_ICONS[type];
  return ln ? `<img class="px-ico" src="${def.icon}" alt="">${IC(ln, "ln-ico w-lico")}` : `<img src="${def.icon}" alt="">`;
}

/* ============================ grid engine ============================ */
const COLS = 12, ROW = 44, GAP = 12;
const gridEl = $("#grid"), emptyEl = $("#grid-empty");
let items = [], mounted = {}, uid = 1, saveTimer = null;

/** Three even rows that fill the canvas: the three live graphs, then what is
 *  wrong / what is running / what you open, then the slower-moving things. */
const DEFAULT_LAYOUT = [
  { t: "cpu", x: 0, y: 0, w: 4, h: 4 }, { t: "memory", x: 4, y: 0, w: 4, h: 4 }, { t: "network", x: 8, y: 0, w: 4, h: 4 },
  { t: "health", x: 0, y: 4, w: 3, h: 6 }, { t: "containers", x: 3, y: 4, w: 5, h: 6 }, { t: "apps", x: 8, y: 4, w: 4, h: 6 },
  { t: "storage", x: 0, y: 10, w: 4, h: 5 }, { t: "sensors", x: 4, y: 10, w: 4, h: 5 }, { t: "cat", x: 8, y: 10, w: 4, h: 5 }
];
/** The default up to 0.9.6. A saved layout that is still exactly this was never
 *  arranged by anyone, so it is safe to swap for the new default; one with a
 *  single widget moved, resized or restyled is left alone. */
const OLD_DEFAULT = "cpu:0,0,4,4|memory:4,0,4,3|cat:8,0,4,4|network:4,3,4,4|sensors:0,4,4,4|containers:8,4,4,4|storage:0,8,4,4|host:4,7,4,3|uptime:8,8,4,2";
const layoutSig = list => list.map(w => `${w.t}:${w.x},${w.y},${w.w},${w.h}`).join("|");
const untouchedOldDefault = list => layoutSig(list) === OLD_DEFAULT && !list.some(w => w.cfg && Object.keys(w.cfg).length);

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
/**
 * Pack every widget top-left with no gaps, keeping the reading order you
 * already have — the widget that was first stays first.
 *
 * `compact()` only ever pulls a widget straight up its own column, so a layout
 * with a hole to the left of something keeps the hole. This walks the grid row
 * by row and drops each widget into the first slot it actually fits, which is
 * what "tidy up" means to a person looking at it.
 */
function tidy() {
  const order = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [];
  for (const it of order) {
    // A widget wider than the canvas can never be placed; clamp it first.
    it.w = Math.min(it.w, COLS);
    let done = false;
    for (let y = 0; !done && y < 400; y++) {
      for (let x = 0; x + it.w <= COLS; x++) {
        const cand = { x, y, w: it.w, h: it.h };
        if (!placed.some(p => overlap(cand, p))) { it.x = x; it.y = y; done = true; break; }
      }
    }
    placed.push(it);
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

/**
 * Lay the canvas out.
 *
 * The first line is the whole bug report "I opened a folder and came back to
 * the dashboard and the widgets were on top of each other". A hidden page has
 * `clientWidth === 0`, so `cellW()` returns a NEGATIVE cell width and every
 * widget is written to the DOM at the same broken position — and the window
 * `resize` listener fires while you are on another page, because opening a long
 * folder listing adds a scrollbar. Geometry that cannot be measured is not zero;
 * it is unknown, and the honest response is to do nothing and try again when
 * the element has a size. The ResizeObserver below is what notices that.
 */
function layout(persist = true) {
  if (gridEl.clientWidth < 1) return;
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
    if (c) c.textContent = n === 1 ? "1 widget selected" : `${n} widgets selected`;
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
      widgetIcon(it.t, def) + `<span class="t">${esc(def.name)}</span>` +
      (def.go ? `<button class="w-go" type="button" data-go="${def.go}" aria-label="Open ${esc(PAGES[def.go]?.title || def.name)}" data-tip="Open ${esc(PAGES[def.go]?.title || def.name)}">${IC("chevron-right")}</button>` : "") +
      `<span class="spacer"></span>` +
      `<button class="w-cfg" aria-label="Widget settings" data-tip="Size, colour and options"><span class="px">&#9881;</span>${IC("settings", "ln-ico")}</button>` +
      `<button class="w-x" aria-label="Remove widget" data-tip="Remove this widget"><span class="px">&times;</span>${IC("x", "ln-ico")}</button>` +
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
    if ((e.ctrlKey || e.metaKey) && dashEdit) {
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
  toast(n === 1 ? "Widget removed" : `${n} widgets removed`, "ok");
}

/** True when a keystroke belongs to whatever the user is typing in. */
function typingInto(el) {
  if (!el) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}
const onDashboard = () => $("#page-dash")?.classList.contains("on") && !$("#app").hidden;

/* ---------------------------- view and edit ----------------------------
 * The board is locked until you press Edit. Arranging is something you do once
 * in a while; reading it is every day, and a board that moves when you brush a
 * title bar is one you learn to keep your hands off.
 */
let dashEdit = false;
function setDashEdit(want) {
  dashEdit = !!want;
  $("#page-dash")?.classList.toggle("editing", dashEdit);
  const v = $("#dash-view"), ed = $("#dash-editing"), bar = $("#dash-editbar");
  if (v) v.hidden = dashEdit;
  if (ed) ed.hidden = !dashEdit;
  if (bar) bar.hidden = !dashEdit;
  if (!dashEdit) { clearSelection(); closeCtx(); $("#drawer")?.classList.remove("open"); }
  else if (document.body.classList.contains("kiosk")) setKiosk(false);
}

/* Full screen: the board and nothing else, for the screen you leave it on. */
function setKiosk(want) {
  const on_ = !!want;
  document.body.classList.toggle("kiosk", on_);
  if (on_) {
    setDashEdit(false);
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
  requestAnimationFrame(() => { layout(false); renderWidgets(); });
}
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && document.body.classList.contains("kiosk")) setKiosk(false);
});

addEventListener("keydown", e => {
  if (typingInto(document.activeElement)) return;
  if (modal.classList.contains("open")) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    if (!onDashboard() || !dashEdit) return;
    e.preventDefault();
    selectAll();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (onDashboard() && selection.size) { e.preventDefault(); deleteSelection(); return; }
    if (e.key === "Delete" && $("#page-files")?.classList.contains("on") && fileSel.size) { e.preventDefault(); deleteFileSelection(); return; }
  }
  if (e.key === "Escape") {
    if (document.body.classList.contains("kiosk")) setKiosk(false);
    else if (dashEdit && onDashboard() && !selection.size && !$("#drawer").classList.contains("open") && !ctx.classList.contains("open")) setDashEdit(false);
    clearSelection(); clearFileSelection(); clipClear();
  }

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
    if (!dashEdit || e.button !== 0 || e.target !== gridEl) return;
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
    toast("Already on the dashboard", "err");
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
      widgetIcon(k, d) +
      `<span class="ct">` +
        `<span class="cn">${esc(d.name)}</span>` +
        `<span class="cd">${esc(d.desc)}</span>` +
        (used ? `<span class="cused"><i>&#10003;</i>On dashboard</span>` : "") +
      `</span>`;

    b.addEventListener("click", () => {
      if (widgetInUse(k)) {
        toast("Already on the dashboard", "err");
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
  // Nothing is drawn for a page nobody is looking at. This ran every second,
  // and on every metrics frame, on every page and in background tabs — fifteen
  // widgets' worth of DOM writes for an empty audience. Arriving on the
  // dashboard calls this again, so nothing is stale when you get there.
  if (document.hidden || !onDashboard()) return;
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
  // 24 hours is always wanted: the Overview reads it for its Security card.
  const wanted = new Set([24,
    ...items.filter(i => i.t === "security").map(i => cfgOf(i).hours || 24)]);
  if (!wanted.size) return;

  secBusy = true;
  try {
    for (const h of wanted) {
      try { LIVE.security[h] = await api(`/system/security?hours=${h}`); } catch {}
    }
    renderWidgets();
    if (curPage === "overview") paintOverview();
  } finally { secBusy = false; }
}

/** Things inside a widget that own their own click and must not start a drag. */
const NO_DRAG = "button, a, input, select, textarea, .w-rs, [contenteditable]";

/**
 * Where a mouse or pen may begin a drag: the title bar, or anywhere on a widget
 * that is already selected.
 *
 * The body used to be a drag handle too, and it cost more than it gave. A
 * widget that is entirely a grab handle wears the grab cursor everywhere, which
 * says "the only thing here is a thing to move" — so the readable parts inside
 * it, the charts above all, read as decoration you are not meant to touch. The
 * title bar is the handle every other windowed interface uses, and a selected
 * widget stays draggable from anywhere so that picking up several at once still
 * works from whichever one is under the pointer.
 *
 * Touch keeps hold-to-drag from anywhere. There is no cursor to mislead anyone
 * and no hover to protect, and a press that travels is already a scroll.
 */
function dragHandle(it, target) {
  if (!dashEdit) return false;            // locked until you press Edit
  if (target.closest(NO_DRAG)) return false;
  return !!target.closest(".w-head") || selection.has(it.id);
}

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
    if (!dragHandle(it, e.target)) return;
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
    if (!dashEdit) return;
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
    if (!dashEdit) return;
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
/* ============================ containers ============================
 * A grid of cards rather than a wide table. A table of six columns is fine on a
 * desktop and unusable on a phone, and the image column — a sha256 digest on a
 * pinned image — pushed the controls off the screen entirely. A card puts the
 * name and state first, the ports where you can press them, and everything else
 * behind one MANAGE button.
 */
let CT = {
  list: [], q: "", state: "all", available: true,
  stats: {}, prevStats: null, statsAt: 0, statsTimer: 0,
  updates: {}, jobs: {}, checking: false,
  view: "grid", group: "none", sort: "name"
};
try {
  const p = JSON.parse(localStorage.getItem("nexus.ctr") || "{}");
  if (["grid", "list"].includes(p.view)) CT.view = p.view;
  if (["none", "project"].includes(p.group)) CT.group = p.group;
  if (["name", "cpu", "mem", "state"].includes(p.sort)) CT.sort = p.sort;
} catch {}
const saveCtPrefs = () => { try { localStorage.setItem("nexus.ctr", JSON.stringify({ view: CT.view, group: CT.group, sort: CT.sort })); } catch {} };

async function loadContainers() {
  const box = $("#c-status");
  try {
    const out = await api("/docker/containers");
    CT.available = out.available;
    if (!out.available) {
      box.innerHTML = `<div class="cempty"><span class="cempty-ico">${IC("box")}</span><b>Docker is not available</b><p>${esc(out.reason || "")}</p></div>`;
      $("#c-bar").hidden = true; $("#c-sum").hidden = true;
      $("#c-grid").innerHTML = "";
      LIVE.containers = [];
      return;
    }
    box.innerHTML = "";
    CT.list = out.containers;
    LIVE.containers = out.containers;
    paintContainers();
    pollCtStats();
  } catch (e) {
    box.innerHTML = `<div class="cempty"><span class="cempty-ico">${IC("alert")}</span><b>Could not read the containers</b><p>${esc(e.message)}</p></div>`;
  }
}

const cRunning = c => c.state === "running";
const cShortImage = img => {
  const s = String(img || "");
  if (s.startsWith("sha256:")) return s.slice(7, 19);
  const noDigest = s.split("@")[0];
  const parts = noDigest.split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : noDigest;
};
const cSlug = c => (c.service || String(c.image || c.name).split("/").pop().split(/[:@]/)[0] || c.name).toLowerCase();

/** What state to show: health wins over "running" when the image has a check. */
function cState(c) {
  if (CT.jobs[c.id] && CT.jobs[c.id].state === "running") return { cls: "busy", word: "Updating" };
  if (c.state === "running") {
    if (c.health === "unhealthy") return { cls: "crit", word: "Unhealthy" };
    if (c.health === "starting") return { cls: "warn", word: "Starting" };
    return { cls: "ok", word: c.health === "healthy" ? "Healthy" : "Running" };
  }
  if (c.state === "restarting") return { cls: "warn", word: "Restarting" };
  if (c.state === "paused") return { cls: "warn", word: "Paused" };
  const code = /Exited \((\d+)\)/.exec(c.status || "");
  return { cls: code && code[1] !== "0" ? "crit" : "idle", word: code ? (code[1] === "0" ? "Stopped" : `Exited (${code[1]})`) : cap(c.state || "stopped") };
}
/** "Up 2 days (healthy)" → "2 days". */
function cUptime(c) {
  const m = /^Up\s+(.+?)(?:\s+\(.*\))?$/.exec(c.status || "");
  if (m) return m[1].replace(/^About an? /, "1 ").replace(/^Less than a second$/, "just now");
  const e = /Exited \(\d+\)\s+(.+?)\s+ago/.exec(c.status || "");
  return e ? `stopped ${e[1]} ago` : "";
}

/**
 * Published ports, grouped. A game server publishing 25500–25600 is one fact
 * — a block of ports — not a hundred links, and almost none of them is a web
 * page. Runs of three or more consecutive ports become one range chip; single
 * TCP ports stay links you can press.
 */
function portGroups(ports) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 3) out.push({ range: [run[0].public, run[run.length - 1].public], type: run[0].type, n: run.length });
    else out.push(...run.map(p => ({ port: p })));
    run = [];
  };
  for (const p of (ports || []).slice().sort((a, b) => a.public - b.public || String(a.type).localeCompare(b.type))) {
    const last = run[run.length - 1];
    if (last && p.public === last.public + 1 && p.type === last.type) run.push(p);
    else { flush(); run = [p]; }
  }
  flush();
  return out;
}
function portChip(g) {
  const host = esc(location.hostname);
  if (g.range) return `<span class="cpc range" data-tip="${g.n} ports, ${g.range[0]}–${g.range[1]}/${esc(g.type || "tcp")} — published, but not web pages">${IC("network")}${g.range[0]}–${g.range[1]}<em>${g.n}</em></span>`;
  const p = g.port;
  if (p.type === "udp") return `<span class="cpc udp" data-tip="UDP ${p.public} → container ${p.private}">${p.public}<em>udp</em></span>`;
  return `<a class="cpc" href="http://${host}:${p.public}" target="_blank" rel="noopener" data-tip="Open http://${host}:${p.public} — container port ${p.private}">:${p.public}${IC("external")}</a>`;
}
/** Kept for the dashboard widget: the same chips, inline. */
function portLinks(ports) {
  const g = portGroups(ports);
  return g.length ? g.map(portChip).join("") : "";
}
function portChips(ports, max = 4) {
  const g = portGroups(ports);
  if (!g.length) return `<span class="cpc none">No published ports</span>`;
  const shown = g.slice(0, max).map(portChip).join("");
  return shown + (g.length > max ? `<span class="cpc more" data-tip="${g.slice(max).map(x => x.range ? `${x.range[0]}–${x.range[1]}` : x.port.public).join(", ")}">+${g.length - max}</span>` : "");
}

/** Where a container came from, in one line. */
function managedTip(kind) {
  if (kind === "nexus") return "Installed through the Nexus app store.";
  if (kind === "casaos") return "Installed through CasaOS. Nexus reads its labels but does not manage it.";
  return "Started by hand or by another tool.";
}

/* ---- live numbers ---- */
async function pollCtStats() {
  clearTimeout(CT.statsTimer);
  if (curPage !== "containers" && !CD.id) return;
  if (!document.hidden && CT.available) {
    try {
      const s = await api("/docker/stats");
      CT.prevStats = CT.stats; CT.prevAt = CT.statsAt;
      CT.stats = s; CT.statsAt = Date.now();
      paintCtMeters();
      paintCtSummary();
      if (CD.id) paintCdLive();
    } catch {}
  }
  CT.statsTimer = setTimeout(pollCtStats, 5000);
}
/** Bytes per second between the last two readings. */
function ctRate(id, key) {
  const a = CT.prevStats?.[id], b = CT.stats?.[id];
  const dt = (CT.statsAt - (CT.prevAt || 0)) / 1000;
  if (!a || !b || dt <= 0) return null;
  return Math.max(0, (b[key] - a[key]) / dt);
}

function ctMeterHTML(c) {
  const s = CT.stats[c.id];
  if (!cRunning(c)) return `<div class="cc-meters off"><span>Not running</span></div>`;
  if (!s) return `<div class="cc-meters wait"><span class="cm"><i></i></span><span class="cm"><i></i></span></div>`;
  const cpu = s.cpu || 0, memPct = s.memLimit ? s.mem / s.memLimit * 100 : 0;
  return `<div class="cc-meters">
    <span class="cm" data-tip="CPU ${cpu.toFixed(1)}% of one core${cpu > 100 ? " — more than one core busy" : ""}"><b>CPU</b><span class="cmt"><i class="${lvl(cpu, 80, 150)}" style="width:${clamp(cpu, 0, 100).toFixed(1)}%"></i></span><em>${cpu.toFixed(cpu < 10 ? 1 : 0)}%</em></span>
    <span class="cm" data-tip="${bytes(s.mem)} of ${bytes(s.memLimit)}"><b>RAM</b><span class="cmt"><i class="${lvl(memPct, 75, 90)}" style="width:${clamp(memPct, 0, 100).toFixed(1)}%"></i></span><em>${bytes(s.mem)}</em></span>
  </div>`;
}
function paintCtMeters() {
  $$("#c-grid [data-meter]").forEach(el => {
    const c = CT.list.find(x => x.id === el.dataset.meter);
    if (!c) return;
    const h = ctMeterHTML(c);
    if (el.dataset.sig !== h) { el.innerHTML = h; el.dataset.sig = h; }
  });
  if (CT.sort === "cpu" || CT.sort === "mem") paintContainers();
}
function paintCtSummary() {
  const el = $("#c-sum");
  if (!el) return;
  el.hidden = !CT.list.length;
  const running = CT.list.filter(cRunning).length;
  const unhealthy = CT.list.filter(c => c.health === "unhealthy").length;
  const vals = Object.values(CT.stats || {});
  const cpu = vals.reduce((a, s) => a + (s.cpu || 0), 0), mem = vals.reduce((a, s) => a + (s.mem || 0), 0);
  const upd = Object.values(CT.updates).filter(u => u.upToDate === false).length;
  const checked = Object.keys(CT.updates).length;
  el.innerHTML = `
    <div class="cs"><span>Running</span><b>${running}<small>/ ${CT.list.length}</small></b></div>
    <div class="cs${unhealthy ? " bad" : ""}"><span>Unhealthy</span><b>${unhealthy}</b></div>
    <div class="cs"><span>CPU, all containers</span><b>${vals.length ? cpu.toFixed(1) + "<small>%</small>" : "—"}</b></div>
    <div class="cs"><span>Memory, all containers</span><b>${vals.length ? bytes(mem) : "—"}</b></div>
    <div class="cs${upd ? " acc" : ""}"><span>Updates</span><b>${checked ? upd : "—"}</b>${checked ? "" : `<button type="button" class="linkbtn" data-ccheck>Check now</button>`}</div>`;
}

/* ---- the board ---- */
function cMatches(c) {
  const st = cState(c);
  if (CT.state === "running" && !cRunning(c)) return false;
  if (CT.state === "stopped" && cRunning(c)) return false;
  if (CT.state === "unhealthy" && !(st.cls === "crit" || st.cls === "warn")) return false;
  if (CT.state === "updates" && CT.updates[c.id]?.upToDate !== false) return false;
  const q = CT.q.trim().toLowerCase();
  if (!q) return true;
  return [c.name, c.title, c.image, c.project, c.service, ...(c.ports || []).map(p => p.public)].join(" ").toLowerCase().includes(q);
}

function ctCard(c) {
  const st = cState(c), up = cRunning(c);
  const u = CT.updates[c.id], job = CT.jobs[c.id];
  const name = c.title || c.name;
  const slug = cSlug(c);
  const list = CT.view === "list";
  const actions = `
    <button class="cact" type="button" data-act="${up ? "stop" : "start"}" data-id="${esc(c.id)}" data-tip="${up ? "Stop" : "Start"}" aria-label="${up ? "Stop" : "Start"} ${esc(name)}">${IC(up ? "stop" : "play")}</button>
    <button class="cact" type="button" data-act="restart" data-id="${esc(c.id)}" data-tip="Restart" aria-label="Restart ${esc(name)}"${up ? "" : " disabled"}>${IC("retry")}</button>
    <button class="cact" type="button" data-logs="${esc(c.id)}" data-tip="Logs" aria-label="Logs for ${esc(name)}">${IC("list")}</button>
    <button class="cact" type="button" data-more="${esc(c.id)}" data-tip="More" aria-label="More for ${esc(name)}">${IC("more")}</button>`;
  const badges = `${c.project ? `<span class="cbadge" data-tip="Compose project${c.service ? " · service " + esc(c.service) : ""}">${esc(c.project)}</span>` : ""}
    ${u?.upToDate === false && !job ? `<button type="button" class="cbadge upd" data-update="${esc(c.id)}" data-tip="A newer image is published for ${esc(u.image)}. Press to update.">${IC("arrow-up")}Update</button>` : ""}
    ${job && job.state === "running" ? `<span class="cbadge busy"><i class="spin"></i>${esc(job.step || "Updating")}</span>` : ""}
    ${c.managedBy && c.managedBy !== "manual" ? `<span class="cbadge src" data-tip="${esc(managedTip(c.managedBy))}">${esc(c.managedBy === "nexus" ? "App Store" : "CasaOS")}</span>` : ""}`;
  if (list) {
    return `<div class="crow2${up ? "" : " down"}" data-open="${esc(c.id)}" tabindex="0" role="button">
      <span class="cc-ico">${appIconHTML({ name, icon: slug })}<i class="cdot s-${st.cls}"></i></span>
      <span class="cr-name"><b>${esc(name)}</b><span>${esc(cShortImage(c.image))}</span></span>
      <span class="cr-state"><span class="cstate2 s-${st.cls}">${esc(st.word)}</span><em>${esc(cUptime(c))}</em></span>
      <span class="cr-meter" data-meter="${esc(c.id)}">${ctMeterHTML(c)}</span>
      <span class="cr-ports">${portChips(c.ports, 2)}</span>
      <span class="cr-badges">${badges}</span>
      <span class="cr-acts">${actions}</span>
    </div>`;
  }
  return `<article class="cc${up ? "" : " down"}" data-open="${esc(c.id)}" tabindex="0">
    <header class="cc-head">
      <span class="cc-ico">${appIconHTML({ name, icon: slug })}<i class="cdot s-${st.cls}"></i></span>
      <span class="cc-t"><b>${esc(name)}</b><span data-tip="${esc(c.image)}">${esc(cShortImage(c.image))}</span></span>
      <span class="cstate2 s-${st.cls}">${esc(st.word)}</span>
    </header>
    <div class="cc-sub">${cUptime(c) ? `<span>${IC("clock")}${esc(cUptime(c))}</span>` : ""}${badges}</div>
    <div data-meter="${esc(c.id)}">${ctMeterHTML(c)}</div>
    <div class="cc-ports">${portChips(c.ports)}</div>
    <footer class="cc-acts">${actions}</footer>
  </article>`;
}

function paintContainers() {
  const grid = $("#c-grid"), bar = $("#c-bar");
  if (!grid) return;
  bar.hidden = !CT.list.length;
  const shown = CT.list.filter(cMatches);
  const stOrder = c => ({ crit: 0, warn: 1, busy: 1, ok: 2, idle: 3 }[cState(c).cls] ?? 4);
  const sorters = {
    name: (a, b) => (a.title || a.name).localeCompare(b.title || b.name),
    cpu: (a, b) => (CT.stats[b.id]?.cpu || 0) - (CT.stats[a.id]?.cpu || 0),
    mem: (a, b) => (CT.stats[b.id]?.mem || 0) - (CT.stats[a.id]?.mem || 0),
    state: (a, b) => stOrder(a) - stOrder(b) || (a.title || a.name).localeCompare(b.title || b.name)
  };
  shown.sort(sorters[CT.sort] || sorters.name);

  const counts = {
    all: CT.list.length, running: CT.list.filter(cRunning).length, stopped: CT.list.filter(c => !cRunning(c)).length,
    unhealthy: CT.list.filter(c => ["crit", "warn"].includes(cState(c).cls)).length,
    updates: Object.values(CT.updates).filter(u => u.upToDate === false).length
  };
  $$("#c-filter [data-cstate]").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.cstate === CT.state));
    $("i", b).textContent = counts[b.dataset.cstate] ?? 0;
    b.hidden = (b.dataset.cstate === "updates" && !counts.updates && CT.state !== "updates") ||
               (b.dataset.cstate === "unhealthy" && !counts.unhealthy && CT.state !== "unhealthy");
    b.classList.toggle("bad", b.dataset.cstate === "unhealthy" && counts.unhealthy > 0);
  });
  $$("#c-view [data-cv]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.cv === CT.view)));
  const gs = $("#c-group"), ss = $("#c-sort");
  if (gs) gs.value = CT.group;
  if (ss) ss.value = CT.sort;

  grid.className = "cgrid2" + (CT.view === "list" ? " list" : "");
  let html;
  if (!shown.length) html = `<div class="cempty"><span class="cempty-ico">${IC("search")}</span><b>${CT.list.length ? "Nothing matches" : "No containers"}</b>${CT.list.length ? `<p><button type="button" class="linkbtn" data-cclear>Clear the filters</button></p>` : ""}</div>`;
  else if (CT.group === "project") {
    const groups = new Map();
    for (const c of shown) { const k = c.project || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
    html = [...groups.entries()].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || a[0].localeCompare(b[0])).map(([k, list]) => `
      <section class="cgroup"><header><b>${k ? esc(k) : "Not in a project"}</b><span>${list.length}</span>
        <em>${list.filter(cRunning).length} running</em></header>
        <div class="cgroup-body">${list.map(ctCard).join("")}</div></section>`).join("");
  } else html = `<div class="cgroup-body">${shown.map(ctCard).join("")}</div>`;
  if (grid.dataset.sig !== html) { grid.innerHTML = html; grid.dataset.sig = html; wireIcons(grid); }
  paintCtSummary();
}

/* ---- header controls ---- */
on("#c-q", "input", e => { CT.q = e.target.value; paintContainers(); });
on("#c-filter", "click", e => {
  const b = e.target.closest("[data-cstate]");
  if (!b) return;
  CT.state = b.dataset.cstate === CT.state ? "all" : b.dataset.cstate;
  paintContainers();
});
on("#c-view", "click", e => {
  const b = e.target.closest("[data-cv]");
  if (!b) return;
  CT.view = b.dataset.cv; saveCtPrefs(); paintContainers();
});
on("#c-group", "change", e => { CT.group = e.target.value; saveCtPrefs(); paintContainers(); });
on("#c-sort", "change", e => { CT.sort = e.target.value; saveCtPrefs(); paintContainers(); });
on("#c-refresh", "click", loadContainers);
on("#c-checkupd", "click", () => checkAllUpdates());
on("#c-sum", "click", e => { if (e.target.closest("[data-ccheck]")) checkAllUpdates(); });

/* ---- updates ---- */
async function checkAllUpdates() {
  if (CT.checking || !CT.list.length) return;
  CT.checking = true;
  const btn = $("#c-checkupd");
  const queue = CT.list.slice();
  let done = 0;
  const label = () => { if (btn) btn.innerHTML = `${IC("refresh")}<span>Checking ${done}/${CT.list.length}</span>`; };
  label();
  btn?.classList.add("busy");
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      try { CT.updates[c.id] = await api(`/docker/containers/${encodeURIComponent(c.id)}/update-check?fresh=1`); } catch {}
      done++; label();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  CT.checking = false;
  btn?.classList.remove("busy");
  if (btn) btn.innerHTML = `${IC("refresh")}<span>Check for updates</span>`;
  const n = Object.values(CT.updates).filter(u => u.upToDate === false).length;
  toast(n ? `${n} container${n === 1 ? " has" : "s have"} a newer image` : "Everything is on its newest image", "ok");
  paintContainers();
}

async function updateCtr(id) {
  const c = CT.list.find(x => x.id === id);
  if (!c) return;
  const name = c.title || c.name;
  if (!confirm(`Update "${name}"?\n\nNexus pulls the newest ${c.image} and recreates the container with the same settings, volumes and networks. It is down for a few seconds; if anything fails, the old one is put back.`)) return;
  let job;
  try { job = await api(`/docker/containers/${encodeURIComponent(id)}/update`, { method: "POST" }); }
  catch (e) { return toast(e.message, "err"); }
  CT.jobs[id] = job; paintContainers();
  const tick = async () => {
    try { job = await api(`/docker/jobs/${job.id}`); } catch { job = { ...job, state: "failed", error: "lost track of the update" }; }
    CT.jobs[id] = job;
    paintContainers();
    if (CD.id === id) paintCdHead();
    if (job.state === "running") return setTimeout(tick, 1500);
    delete CT.jobs[id];
    if (job.state === "done") {
      toast(job.result?.updated ? `${name} updated` : `${name}: ${job.result?.message || "nothing to do"}`, "ok");
      CT.updates[id] = { ...(CT.updates[id] || {}), upToDate: true };
      const fresh = job.result?.id;
      if (fresh && fresh !== id) { CT.updates[fresh] = CT.updates[id]; delete CT.updates[id]; if (CD.id === id) closeCtrDrawer(); }
    } else toast(`${name}: ${job.error || "the update failed"}`, "err");
    loadContainers();
  };
  setTimeout(tick, 1200);
}

/* ---- the board's clicks ---- */
async function ctrAct(id, act, btn) {
  if (btn) btn.disabled = true;
  try {
    await api(`/docker/containers/${encodeURIComponent(id)}/${act}`, { method: "POST" });
    toast(`${cap(act)}${act === "stop" ? "ped" : act === "start" ? "ed" : "ed"} ${CT.list.find(x => x.id === id)?.name || ""}`.trim(), "ok");
    setTimeout(loadContainers, 600);
  } catch (ex) { toast(ex.message, "err"); }
  finally { if (btn) btn.disabled = false; }
}
async function removeCtr(id) {
  const c = CT.list.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Remove the container "${c.name}"?\n\nIts image and named volumes stay on disk. To uninstall an App Store app, use the App Store instead.`)) return;
  try {
    await api(`/docker/containers/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Container removed", "ok");
    if (CD.id === id) closeCtrDrawer();
    setTimeout(loadContainers, 400);
  } catch (ex) { toast(ex.message, "err"); }
}
function ctrMenu(anchor, id) {
  const c = CT.list.find(x => x.id === id);
  if (!c) return;
  const up = cRunning(c);
  chooseFrom(anchor, [
    { label: "Details", value: "open" },
    ...(up ? [{ label: "Console", value: "console" }] : []),
    { label: "Check for an update", value: "check" },
    { label: "Update now", value: "update" },
    { label: "Copy the name", value: "copy" },
    { label: "Remove…", value: "remove" }
  ], async v => {
    if (v === "open") openCtrDrawer(id);
    if (v === "console") go("term", "ctr:" + (c.name || id));
    if (v === "update") updateCtr(id);
    if (v === "copy") copyText(c.name);
    if (v === "remove") removeCtr(id);
    if (v === "check") {
      try { CT.updates[id] = await api(`/docker/containers/${encodeURIComponent(id)}/update-check?fresh=1`); } catch (e) { return toast(e.message, "err"); }
      const u = CT.updates[id];
      toast(u.upToDate === false ? "A newer image is available" : u.upToDate ? "Already on the newest image" : `Could not tell: ${u.reason || "unknown"}`, u.upToDate === null ? "err" : "ok");
      paintContainers();
    }
  });
}

on("#c-grid", "click", e => {
  if (e.target.closest("[data-cclear]")) { CT.q = ""; CT.state = "all"; $("#c-q").value = ""; return paintContainers(); }
  if (e.target.closest("a.cpc")) return;                    // a port link opens itself
  const act = e.target.closest("button[data-act]");
  if (act) { e.stopPropagation(); return ctrAct(act.dataset.id, act.dataset.act, act); }
  const lg = e.target.closest("[data-logs]");
  if (lg) { e.stopPropagation(); return openCtrDrawer(lg.dataset.logs, "logs"); }
  const more = e.target.closest("[data-more]");
  if (more) { e.stopPropagation(); return ctrMenu(more, more.dataset.more); }
  const upd = e.target.closest("[data-update]");
  if (upd) { e.stopPropagation(); return updateCtr(upd.dataset.update); }
  const card = e.target.closest("[data-open]");
  if (card) openCtrDrawer(card.dataset.open);
});
on("#c-grid", "keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-open]")) { e.preventDefault(); openCtrDrawer(e.target.dataset.open); }
});

/* ---------------- one container, in a side panel ----------------
 * Everything about it without leaving the list: live numbers, the log tail
 * with search, its environment, its storage and networks — and the actions,
 * with Remove kept away from the ones you press every day.
 */
const CD = { id: null, tab: "overview", logWS: null, follow: true, wrap: true, filter: "", lines: [], info: null, reveal: false };
function closeLogs() { if (CD.logWS) { try { CD.logWS.close(); } catch {} CD.logWS = null; } }

/** Kept for callers elsewhere (Overview, Kernel). */
function manageContainer(id) { openCtrDrawer(id); }

function openCtrDrawer(id, tab = "overview") {
  const c = CT.list.find(x => x.id === id);
  if (!c) return;
  closeLogs();
  Object.assign(CD, { id, tab, lines: [], filter: "", info: null, reveal: false });
  let el = $("#c-drawer");
  if (!el) {
    el = document.createElement("div");
    el.id = "c-drawer";
    el.innerHTML = `<div class="cdr-back"></div><aside class="cdr" role="dialog" aria-modal="true" aria-labelledby="cdr-name">
      <header class="cdr-head" id="cdr-head"></header>
      <nav class="cdr-tabs" role="tablist">
        <button type="button" role="tab" data-ctab="overview">Overview</button>
        <button type="button" role="tab" data-ctab="logs">Logs</button>
        <button type="button" role="tab" data-ctab="env">Environment</button>
        <button type="button" role="tab" data-ctab="storage">Storage &amp; network</button>
      </nav>
      <div class="cdr-body" id="cdr-body"></div></aside>`;
    document.body.appendChild(el);
    el.addEventListener("click", cdClick);
    el.addEventListener("input", e => {
      if (e.target.id === "cdl-q") { CD.filter = e.target.value; paintCdLogs(true); }
    });
  }
  requestAnimationFrame(() => el.classList.add("open"));
  paintCdHead();
  showCdTab(tab);
  api(`/docker/containers/${encodeURIComponent(id)}/inspect`).then(info => {
    if (CD.id !== id) return;
    CD.info = info;
    if (CD.tab !== "logs") showCdTab(CD.tab);
    paintCdHead();
  }).catch(() => {});
  pollCtStats();
}

function closeCtrDrawer() {
  closeLogs();
  CD.id = null;
  const el = $("#c-drawer");
  if (!el) return;
  el.classList.remove("open");
  setTimeout(() => { if (!CD.id) el.remove(); }, 320);
}
addEventListener("keydown", e => { if (e.key === "Escape" && CD.id && !$("#modal").classList.contains("open")) closeCtrDrawer(); });

function paintCdHead() {
  const c = CT.list.find(x => x.id === CD.id);
  const head = $("#cdr-head");
  if (!c || !head) return;
  const st = cState(c), up = cRunning(c), name = c.title || c.name;
  const job = CT.jobs[c.id], u = CT.updates[c.id];
  head.innerHTML = `
    <span class="cc-ico lg">${appIconHTML({ name, icon: cSlug(c) })}<i class="cdot s-${st.cls}"></i></span>
    <div class="cdr-t"><h3 id="cdr-name">${esc(name)}</h3>
      <span><span class="cstate2 s-${st.cls}">${esc(st.word)}</span>${cUptime(c) ? ` · ${esc(cUptime(c))}` : ""}${job ? ` · ${esc(job.step)}` : ""}</span></div>
    <button type="button" class="cdr-x" data-cdclose aria-label="Close">${IC("x")}</button>
    <div class="cdr-acts">
      <button type="button" class="btn sm${up ? "" : " primary"}" data-cd="${up ? "stop" : "start"}">${IC(up ? "stop" : "play")}${up ? "Stop" : "Start"}</button>
      <button type="button" class="btn sm" data-cd="restart"${up ? "" : " disabled"}>${IC("retry")}Restart</button>
      ${up ? `<button type="button" class="btn sm" data-cd="console">${IC("terminal")}Console</button>` : ""}
      <button type="button" class="btn sm${u?.upToDate === false ? " primary" : ""}" data-cd="update"${job ? " disabled" : ""}>${IC("arrow-up")}${u?.upToDate === false ? "Update available" : "Update"}</button>
      <span class="spacer"></span>
      <button type="button" class="btn sm danger ghost" data-cd="remove">${IC("trash")}Remove</button>
    </div>`;
  wireIcons(head);
}

function showCdTab(tab) {
  CD.tab = tab;
  $$("#c-drawer [data-ctab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.ctab === tab)));
  const body = $("#cdr-body");
  if (!body) return;
  if (tab !== "logs") closeLogs();
  if (tab === "overview") { body.innerHTML = cdOverview(); paintCdLive(); }
  if (tab === "env") body.innerHTML = cdEnv();
  if (tab === "storage") body.innerHTML = cdStorage();
  if (tab === "logs") openCdLogs();
}

function cdOverview() {
  const c = CT.list.find(x => x.id === CD.id), i = CD.info;
  if (!c) return "";
  const dt = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${v}</dd>` : "";
  const when = s => { const t = Date.parse(s); return t > 0 ? `${esc(fmtDate(new Date(t)))}, ${esc(fmtTime(new Date(t), false, false))}` : ""; };
  const groups = portGroups(c.ports);
  return `<div class="cdr-live" id="cdr-live"></div>
    ${i?.health ? `<section class="cdr-sec"><h4>Health check</h4><div class="cdr-health s-${i.health.status === "healthy" ? "ok" : i.health.status === "unhealthy" ? "crit" : "warn"}">
      <b>${esc(cap(i.health.status))}</b>${i.health.failing ? `<span>${i.health.failing} failing in a row</span>` : ""}
      ${i.health.log.length ? `<pre>${esc(i.health.log[i.health.log.length - 1].out.trim() || "(no output)")}</pre>` : ""}</div></section>` : ""}
    <section class="cdr-sec"><h4>Ports</h4><div class="cc-ports wrap">${groups.length ? groups.map(portChip).join("") : `<span class="cpc none">No published ports</span>`}</div></section>
    <section class="cdr-sec"><h4>About</h4><dl class="cdr-dl">
      ${dt("Image", `<code>${esc(c.image)}</code>`)}
      ${dt("Image id", i ? `<code>${esc(i.imageId)}</code>` : "")}
      ${dt("Container id", `<code>${esc(c.id)}</code>`)}
      ${dt("Created", i ? when(i.created) : c.created ? esc(fmtDate(new Date(c.created * 1000))) : "")}
      ${dt("Started", i && cRunning(c) ? when(i.startedAt) : "")}
      ${dt("Restart policy", i ? esc(i.restart) + (i.restartCount ? ` · restarted ${i.restartCount} time${i.restartCount === 1 ? "" : "s"}` : "") : "")}
      ${dt("Compose", i?.project ? `${esc(i.project)}${i.service ? " · " + esc(i.service) : ""}${i.composeFile ? `<br><code>${esc(i.composeFile)}</code>` : ""}` : "")}
      ${dt("Command", i?.cmd ? `<code>${esc(i.cmd)}</code>` : "")}
      ${dt("Source", esc(managedTip(c.managedBy)))}
      ${i?.oomKilled ? dt("Note", `<span class="crit">It was killed for running out of memory.</span>`) : ""}
      ${i?.privileged ? dt("Privileged", `<span class="warn">Yes — it has full access to the host.</span>`) : ""}
    </dl></section>`;
}
function paintCdLive() {
  const el = $("#cdr-live");
  const c = CT.list.find(x => x.id === CD.id);
  if (!el || !c) return;
  if (!cRunning(c)) { el.innerHTML = `<p class="cdr-quiet">Not running.</p>`; return; }
  const s = CT.stats[c.id];
  if (!s) { el.innerHTML = `<p class="cdr-quiet">Reading its numbers…</p>`; return; }
  const rx = ctRate(c.id, "rx"), tx = ctRate(c.id, "tx"), rd = ctRate(c.id, "read"), wr = ctRate(c.id, "write");
  const t = (k, v, sub = "") => `<div class="cdr-tile"><span>${esc(k)}</span><b>${v}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
  el.innerHTML = `<div class="cdr-tiles">
    ${t("CPU", (s.cpu || 0).toFixed(1) + "%", "of one core")}
    ${t("Memory", bytes(s.mem), s.memLimit ? `of ${bytes(s.memLimit)}` : "")}
    ${t("Network", rx != null ? `${rate(rx)}` : "—", tx != null ? `${rate(tx)} up` : "down / up")}
    ${t("Disk", rd != null ? rate(rd) : "—", wr != null ? `${rate(wr)} written` : "read / write")}
    ${s.pids != null ? t("Processes", s.pids) : ""}
  </div>`;
}
function cdEnv() {
  const i = CD.info;
  if (!i) return `<p class="cdr-quiet">Reading…</p>`;
  if (!i.env.length) return `<p class="cdr-quiet">No environment variables.</p>`;
  const secret = k => /pass|secret|token|key|auth|cred|cookie|private/i.test(k);
  return `<div class="cdr-bar"><span>${i.env.length} variables</span><span class="spacer"></span>
      <button type="button" class="btn sm" data-cdreveal>${IC(CD.reveal ? "eye-off" : "eye")}${CD.reveal ? "Hide values" : "Show values"}</button></div>
    <table class="cdr-table"><tbody>${i.env.map(({ k, v }) => `<tr><td class="k">${esc(k)}</td>
      <td class="v">${CD.reveal || (!secret(k) && v.length < 200) ? `<code>${esc(v)}</code>` : `<span class="mask">${secret(k) ? "hidden" : "long value"} · press Show values</span>`}</td></tr>`).join("")}</tbody></table>`;
}
function cdStorage() {
  const i = CD.info;
  if (!i) return `<p class="cdr-quiet">Reading…</p>`;
  return `<section class="cdr-sec"><h4>Storage</h4>${i.mounts.length ? `<table class="cdr-table"><thead><tr><th>In the container</th><th>On the host</th><th></th></tr></thead><tbody>
      ${i.mounts.map(m => `<tr><td><code>${esc(m.target)}</code></td><td><code>${esc(m.source || "")}</code><small>${esc(m.type)}</small></td><td>${m.rw ? "" : `<span class="cbadge">read only</span>`}</td></tr>`).join("")}</tbody></table>` : `<p class="cdr-quiet">Nothing mounted.</p>`}</section>
    <section class="cdr-sec"><h4>Networks</h4>${i.networks.length ? `<table class="cdr-table"><thead><tr><th>Network</th><th>Address</th><th>Gateway</th></tr></thead><tbody>
      ${i.networks.map(n => `<tr><td>${esc(n.name)}</td><td><code>${esc(n.ip || "—")}</code></td><td><code>${esc(n.gateway || "—")}</code></td></tr>`).join("")}</tbody></table>` : `<p class="cdr-quiet">Network mode: ${esc(i.networkMode || "none")}</p>`}</section>
    ${Object.keys(i.labels).length ? `<section class="cdr-sec"><h4>Labels</h4><table class="cdr-table"><tbody>${Object.entries(i.labels).map(([k, v]) =>
      `<tr><td class="k">${esc(k)}</td><td class="v"><code>${esc(v)}</code></td></tr>`).join("")}</tbody></table></section>` : ""}`;
}

/* ---- logs ---- */
function openCdLogs() {
  const body = $("#cdr-body");
  const c = CT.list.find(x => x.id === CD.id);
  if (!body || !c) return;
  body.innerHTML = `<div class="cdl">
    <div class="cdr-bar">
      <label class="lsearch sm">${IC("search")}<input id="cdl-q" type="search" placeholder="Filter lines…" value="${esc(CD.filter)}" autocomplete="off"></label>
      <span class="spacer"></span>
      <button type="button" class="btn sm${CD.follow ? " on" : ""}" data-cdl="follow" aria-pressed="${CD.follow}">${IC("arrow-down")}Follow</button>
      <button type="button" class="btn sm${CD.wrap ? " on" : ""}" data-cdl="wrap" aria-pressed="${CD.wrap}">Wrap</button>
      <button type="button" class="btn sm" data-cdl="copy">${IC("copy")}Copy</button>
      <button type="button" class="btn sm" data-cdl="download">${IC("upload")}Save</button>
      <button type="button" class="btn sm" data-cdl="clear">Clear</button>
    </div>
    <pre class="cdl-out${CD.wrap ? " wrap" : ""}" id="cdl-out"></pre>
    <div class="cdl-foot" id="cdl-foot"></div></div>`;
  if (CD.logWS) return paintCdLogs(true);
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  let carry = "";
  try {
    CD.logWS = new WebSocket(`${proto}//${location.host}/ws/logs/${encodeURIComponent(c.id)}`);
    CD.logWS.onmessage = ev => {
      const text = carry + (typeof ev.data === "string" ? ev.data : "");
      const parts = text.split(/\r?\n/);
      carry = parts.pop();
      CD.lines.push(...parts);
      if (CD.lines.length > 5000) CD.lines.splice(0, CD.lines.length - 4000);
      scheduleLogPaint();
    };
    CD.logWS.onclose = () => { const f = $("#cdl-foot"); if (f) f.textContent = linkState === "polling" ? "Logs need a WebSocket, which this connection does not have." : "The log stream closed."; };
  } catch { const f = $("#cdl-foot"); if (f) f.textContent = "Could not open the log stream."; }
  paintCdLogs(true);
}
let logPaintRaf = 0;
function scheduleLogPaint() { if (!logPaintRaf) logPaintRaf = requestAnimationFrame(() => { logPaintRaf = 0; paintCdLogs(false); }); }
function paintCdLogs(full) {
  const pre = $("#cdl-out");
  if (!pre) return;
  const q = CD.filter.trim().toLowerCase();
  const lines = q ? CD.lines.filter(l => l.toLowerCase().includes(q)) : CD.lines;
  const shown = lines.slice(-2500);
  const hl = l => {
    let h = esc(l);
    if (/\b(error|fatal|panic|exception|fail(ed)?)\b/i.test(l)) h = `<span class="le">${h}</span>`;
    else if (/\b(warn(ing)?)\b/i.test(l)) h = `<span class="lw">${h}</span>`;
    return h;
  };
  pre.innerHTML = shown.length ? shown.map(hl).join("\n") : `<span class="lq">${CD.lines.length ? "No line matches the filter." : "Waiting for output…"}</span>`;
  if (CD.follow) pre.scrollTop = pre.scrollHeight;
  const f = $("#cdl-foot");
  if (f) f.textContent = `${CD.lines.length.toLocaleString()} lines${q ? ` · ${lines.length.toLocaleString()} match` : ""}${lines.length > shown.length ? " · showing the last 2,500" : ""}`;
}

function cdClick(e) {
  if (e.target.classList.contains("cdr-back") || e.target.closest("[data-cdclose]")) return closeCtrDrawer();
  const tab = e.target.closest("[data-ctab]");
  if (tab) return showCdTab(tab.dataset.ctab);
  const id = CD.id, c = CT.list.find(x => x.id === id);
  const a = e.target.closest("[data-cd]");
  if (a && c) {
    const v = a.dataset.cd;
    if (v === "console") { closeCtrDrawer(); return go("term", "ctr:" + (c.name || id)); }
    if (v === "update") return updateCtr(id);
    if (v === "remove") return removeCtr(id);
    return ctrAct(id, v, a).then(() => setTimeout(() => { paintCdHead(); if (CD.tab === "overview") showCdTab("overview"); }, 900));
  }
  if (e.target.closest("[data-cdreveal]")) { CD.reveal = !CD.reveal; return showCdTab("env"); }
  const l = e.target.closest("[data-cdl]");
  if (l) {
    const v = l.dataset.cdl;
    if (v === "follow") { CD.follow = !CD.follow; l.classList.toggle("on", CD.follow); l.setAttribute("aria-pressed", CD.follow); if (CD.follow) paintCdLogs(false); }
    if (v === "wrap") { CD.wrap = !CD.wrap; l.classList.toggle("on", CD.wrap); $("#cdl-out")?.classList.toggle("wrap", CD.wrap); }
    if (v === "clear") { CD.lines = []; paintCdLogs(true); }
    if (v === "copy") copyText(CD.lines.join("\n"));
    if (v === "download") {
      const blob = new Blob([CD.lines.join("\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `${c?.name || id}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }
}
// Scrolling up in the log stops following; reaching the bottom starts again.
addEventListener("scroll", e => {
  if (e.target?.id !== "cdl-out") return;
  const p = e.target, atEnd = p.scrollHeight - p.scrollTop - p.clientHeight < 30;
  if (atEnd !== CD.follow) {
    CD.follow = atEnd;
    const b = $('#c-drawer [data-cdl="follow"]');
    if (b) { b.classList.toggle("on", atEnd); b.setAttribute("aria-pressed", atEnd); }
  }
}, true);

/* ============================ the launcher ============================
 * The Apps page: a board of the things actually running on this box, as tiles
 * you press to open them.
 *
 * Tiles are an ordered list with a named size, not x/y boxes on a canvas. This
 * board is read on a phone at least as often as on the desktop, and absolute
 * positions cannot make that trip — three columns become one and the
 * arrangement is gone. A list reflows: the same order, the same relative
 * sizes, fewer columns. Groups are the structure instead, which is what "put
 * the watching things together" actually means.
 */
const LP = { apps: [], groups: [], q: "", tag: "", sel: new Set(), filter: "all", view: "grid", collapsed: new Set() };

/* How this browser likes to look at the board: tiles or a list, and which
   groups are folded. Not part of the board, so not saved to the server. */
const lPref = (k, d) => { try { return localStorage.getItem("nexus.apps." + k) ?? d; } catch { return d; } };
const lSetPref = (k, v) => { try { localStorage.setItem("nexus.apps." + k, v); } catch {} };
LP.view = lPref("view", "grid") === "list" ? "list" : "grid";
try { LP.collapsed = new Set(JSON.parse(lPref("folded", "[]"))); } catch {}

const L_SIZES = [
  { key: "s",  label: "Small", hint: "Icon and name" },
  { key: "m",  label: "Medium", hint: "Name, description, ports" },
  { key: "l",  label: "Large", hint: "Twice the height" },
  { key: "xl", label: "Huge",  hint: "The one you always want first" }
];
const GROUP_COLORS = ["cyan", "orchid", "amber", "green", "coral", "blue"];

/* Small marks, drawn rather than borrowed from the emoji font: an emoji is a
   different typeface at a different weight and it shows on a tile. */
const SVG_PIN = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1.5 14.5 6.5 12 7l-1 4-3-3-4.5 4.5L3 12l4.5-4.5-3-3 4-1z" fill="currentColor"/></svg>`;
const SVG_LOCK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7zm2 0h4V5a2 2 0 0 0-4 0z" fill="currentColor"/></svg>`;
const SVG_GLOBE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1m0 1.6c.9 0 1.9 1.6 2.2 4H5.8c.3-2.4 1.3-4 2.2-4M4.3 6.6H2.8A5.4 5.4 0 0 1 5.6 3a11 11 0 0 0-1.3 3.6m-1.5 2.8h1.5A11 11 0 0 0 5.6 13a5.4 5.4 0 0 1-2.8-3.6m3 0h4.4c-.3 2.4-1.3 4-2.2 4s-1.9-1.6-2.2-4m5.9 0h1.5A5.4 5.4 0 0 1 10.4 13a11 11 0 0 0 1.3-3.6m0-2.8A11 11 0 0 0 10.4 3a5.4 5.4 0 0 1 2.8 3.6z" fill="currentColor"/></svg>`;
const SVG_GEAR = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 5.6A2.4 2.4 0 1 0 8 10.4 2.4 2.4 0 0 0 8 5.6M6.8 1h2.4l.3 1.8 1.2.5 1.5-1 1.7 1.7-1 1.5.5 1.2 1.8.3v2.4l-1.8.3-.5 1.2 1 1.5-1.7 1.7-1.5-1-1.2.5-.3 1.8H6.8l-.3-1.8-1.2-.5-1.5 1-1.7-1.7 1-1.5-.5-1.2L.8 9.2V6.8l1.8-.3.5-1.2-1-1.5 1.7-1.7 1.5 1 1.2-.5z" fill="currentColor"/></svg>`;

/**
 * Where a tile's picture comes from.
 *
 * Three steps, in order of how much the owner asked for it: a URL they typed,
 * then the community icon set Homarr uses — matched on a slug taken from the
 * app name or the container image — and finally a letter tile drawn from the
 * palette. The icon set is fetched by the browser, not the server, so it works
 * on any box that can reach the internet and degrades to the letter otherwise.
 */
const ICON_ALIASES = {
  "nginx-proxy-manager": "nginx-proxy-manager", npm: "nginx-proxy-manager",
  qbittorrent: "qbittorrent", qbit: "qbittorrent", "qbittorrent-nox": "qbittorrent",
  "immich-server": "immich", "immich-machine-learning": "immich",
  jellyseerr: "jellyseerr", jellyfin: "jellyfin",
  homeassistant: "home-assistant", "home-assistant": "home-assistant",
  pihole: "pi-hole", "pi-hole": "pi-hole",
  adguardhome: "adguard-home", vaultwarden: "vaultwarden",
  portainer: "portainer", uptimekuma: "uptime-kuma", "uptime-kuma": "uptime-kuma",
  nginxproxymanager: "nginx-proxy-manager", crafty: "crafty-controller", "crafty-controller": "crafty-controller",
  adguard: "adguard-home", "adguard-home": "adguard-home", sabnzbd: "sabnzbd", plex: "plex", emby: "emby"
};

function iconSlug(app) {
  const raw = (app.icon || app.name || "").toLowerCase().trim();
  if (/^https?:/.test(raw)) return null;
  const key = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return ICON_ALIASES[key] || key;
}

const ICON_CDN = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/";

/** The address a tile's picture comes from, or null for a letter. */
function iconSrc(app) {
  if (/^https?:/.test(app.icon || "")) return app.icon;
  const slug = iconSlug(app);
  return slug ? ICON_CDN + slug + ".png" : null;
}

function appIconHTML(app) {
  const letter = esc(((app.name || "?").trim()[0] || "?").toUpperCase());
  const src = iconSrc(app);
  if (!src) return `<span class="lico-letter">${letter}</span>`;
  // The fallback is wired by wireIcons() rather than an inline onerror: the
  // CSP here is `script-src 'self'`, which refuses inline handlers outright —
  // so an inline one would never run and a missing icon would stay broken.
  // The icon CDN answers CORS, so its images are fetched that way and can be
  // read back for their colour; any other address is left alone, because
  // asking for CORS from a server that does not answer it breaks the image.
  const cors = src.startsWith(ICON_CDN) ? ` crossorigin="anonymous"` : "";
  return `<img class="lico-img" loading="lazy" alt="" data-letter="${letter}"${cors} src="${esc(src)}">`;
}

/**
 * A tile's tint: the colour of its icon, laid faintly behind it.
 *
 * Read once per icon from a 24×24 copy on a canvas — saturated pixels count
 * most, near-white and near-black hardly at all — and remembered in this
 * browser, so a board of thirty icons is measured once, not on every paint.
 */
const TINT = new Map((() => { try { return Object.entries(JSON.parse(localStorage.getItem("nexus.tints") || "{}")); } catch { return []; } })());
const tintStyle = src => { const t = src && TINT.get(src); return t && t !== "none" ? ` style="--tint:${t}"` : ""; };

function measureTint(img) {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 24;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 140) continue;
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      const lum = (mx + mn) / 510, sat = mx ? (mx - mn) / mx : 0;
      if (lum > .94 || lum < .07) continue;
      const k = .08 + sat * sat * 3;
      r += R * k; g += G * k; b += B * k; w += k;
    }
    if (w <= 2) return "none";
    const R = Math.round(r / w), G = Math.round(g / w), B = Math.round(b / w);
    // A grey icon would lay a grey wash over the tile: leave it untinted.
    return Math.max(R, G, B) - Math.min(R, G, B) < 28 ? "none" : `rgb(${R} ${G} ${B})`;
  } catch { return "none"; }            // a tainted canvas: no CORS on that image
}

// On the document, not the window: a load event from an element never reaches
// the window (the spec leaves it out of the path), unlike "error" above.
document.addEventListener("load", e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains("lico-img")) return;
  const src = img.getAttribute("src");
  if (!src || TINT.has(src) || !img.crossOrigin) return;
  const t = measureTint(img);
  TINT.set(src, t);
  if (t !== "none") $$("[data-tint]").forEach(el => { if (el.dataset.tint === src) el.style.setProperty("--tint", t); });
  clearTimeout(measureTint.t);
  measureTint.t = setTimeout(() => {
    try { localStorage.setItem("nexus.tints", JSON.stringify(Object.fromEntries([...TINT].slice(-300)))); } catch {}
  }, 800);
}, true);

/**
 * What an image does when it cannot load.
 *
 * One capturing listener for the whole document rather than a handler per
 * image. `error` does not bubble, but it does capture, so this catches every
 * image including ones added later — and, unlike an inline `onerror=`, it
 * actually runs: the CSP here is `script-src 'self'`, which refuses inline
 * handlers outright. Three of those were in the code and none of them had ever
 * fired, which is why a missing app-store icon showed a broken-image glyph.
 *
 *   data-letter="J"   replace with a letter tile
 *   data-onfail="hide"  hide it and leave the space
 */
addEventListener("error", e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.letter) {
    const span = document.createElement("span");
    span.className = "lico-letter";
    span.textContent = img.dataset.letter;
    img.replaceWith(span);
  } else if (img.dataset.onfail === "hide") {
    img.style.visibility = "hidden";
  }
}, true);

/** Images that failed before the listener could see them — a cached failure, or
 *  markup painted in the same tick — report nothing, so check them directly. */
function wireIcons(root) {
  $$("img[data-letter],img[data-onfail]", root || document).forEach(img => {
    if (img.complete && img.naturalWidth === 0) img.dispatchEvent(new Event("error"));
  });
}

/** A tag's colour is a function of the tag, so "media" is the same colour on
 *  every tile and on the filter chip — that is the whole point of colouring
 *  them. Hashed rather than assigned, so a new tag needs no bookkeeping. */
function tagHue(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

async function loadLauncher() {
  try {
    const out = await api("/launcher");
    LP.apps = out.apps || [];
    LP.groups = out.groups || [];
  } catch { /* keep what is on screen — a failed read is not an empty board */ }
  LP.sel.clear();
  paintLauncher();
}

function saveLauncher() {
  clearTimeout(saveLauncher.t);
  saveLauncher.t = setTimeout(() => {
    api("/launcher", { method: "PUT", body: { apps: LP.apps, groups: LP.groups } })
      .catch(e => toast(e.message, "err"));
  }, 400);
}

/* ---- what is on screen ---- */

/** Search and tag — what the filter counts are counted over. */
const lMatchesText = a => {
  const q = LP.q.trim().toLowerCase();
  if (LP.tag && !(a.tags || []).includes(LP.tag)) return false;
  if (!q) return true;
  return (a.name + " " + (a.desc || "") + " " + (a.url || "") + " " + (a.live?.kind || "") + " " +
          (a.tags || []).join(" ") + " " + (a.ports || []).join(" ")).toLowerCase().includes(q);
};
/** …and then the All / Up / Problems / Live filter. */
const lMatches = a => {
  if (!lMatchesText(a)) return false;
  const st = appStatus(a);
  if (LP.filter === "up") return st === "up";
  if (LP.filter === "down") return st === "warn" || st === "down";
  if (LP.filter === "live") return !!(a.live?.on && !a.locked);
  return true;
};

/**
 * The board, in bands.
 *
 * Pinned first with a rule under it — and only when something is pinned, since
 * a divider with nothing above it is a line for its own sake. Then each group,
 * then whatever is in no group.
 */
function lSections() {
  const shown = LP.apps.filter(lMatches);
  const out = [];
  const pinned = shown.filter(a => a.pinned);
  if (pinned.length) out.push({ key: "__pinned", name: "Pinned", pinned: true, apps: pinned });

  const rest = shown.filter(a => !a.pinned);
  const filtering = !!(LP.q.trim() || LP.tag || LP.filter !== "all");
  for (const g of LP.groups) {
    const apps = rest.filter(a => a.group === g.id);
    // An empty group still shows while you are arranging, because it is a
    // target you need to be able to drop into. It hides while you search.
    if (apps.length || !filtering) out.push({ key: g.id, name: g.name, color: g.color, group: g, apps });
  }
  const loose = rest.filter(a => !LP.groups.some(g => g.id === a.group));
  if (loose.length || !LP.groups.length) {
    out.push({ key: "", name: LP.groups.length ? "Everything else" : "", apps: loose });
  }
  return out;
}

/* ---- the board ----
 * Two views of the same ordered list. Tiles keep the sizes and the groups;
 * the list is for a long board read top to bottom, with the address, tags,
 * status and live numbers in columns. Which one you look at is a preference
 * of this browser, not part of the board, so it lives in localStorage.
 */
const hostOf = a => {
  if (a.locked) return "";
  try { return new URL(a.url || a.externalUrl).host; } catch { return ""; }
};
const isLive = a => !!(a.live?.on && !a.locked);

function statusTip(a) {
  const c = CK.data?.checks?.find(x => x.id === "app:" + a.id);
  if (!c) return a.locked ? "Not checked while it has a PIN" : "Not checked — add a local address to watch it";
  return `${statusWord(c.status)}${Number.isFinite(c.ms) ? ` · ${c.ms} ms` : ""}${c.msg ? ` · ${c.msg}` : ""}`;
}

function tileHTML(a) {
  const list = LP.view === "list";
  const size = a.size || "m";
  const st = appStatus(a);
  const host = hostOf(a);
  const tags = (a.tags || []).slice(0, list ? 3 : size === "s" ? 0 : 3);
  const live = isLive(a) && LV.on;
  const src = iconSrc(a);
  // In the list the address has its own column, so the line under the name is
  // the description or nothing.
  const sub = a.desc ? esc(a.desc) : list ? "" : host ? `<span class="laddr">${esc(host)}</span>` : a.locked ? "Opens with a PIN" : "No address yet";
  return `
    <article class="ltile ${list ? "row" : esc(size)}${LP.sel.has(a.id) ? " on" : ""}${live ? " haslive" : ""}"
             data-id="${esc(a.id)}"${src ? ` data-tint="${esc(src)}"` : ""}${tintStyle(src)} tabindex="0" role="link"
             aria-label="${esc(a.name)}${a.desc ? " — " + esc(a.desc) : ""}${a.locked ? " (needs a PIN)" : ""}">
      <span class="licow"><span class="lico">${appIconHTML(a)}</span>
        <i class="lstat s-${statusClass(st)}${st === "empty" ? " none" : ""}" data-tip="${esc(statusTip(a))}"></i></span>
      <span class="lbody">
        <span class="ltop"><b class="lname">${esc(a.name)}</b>${a.pinned ? `<span class="lflag" title="Pinned">${IC("pin")}</span>` : ""}${a.locked ? `<span class="lflag lk" title="Opens with a PIN">${IC("lock")}</span>` : ""}</span>
        ${sub ? `<span class="ldesc">${sub}</span>` : ""}
        ${!list && size !== "s" ? `<span class="lmeta">${a.desc && host ? `<span class="laddr">${esc(host)}</span>` : ""}${tags.map(t =>
          `<span class="ltag wc-${tagHue(t)}">${esc(t)}</span>`).join("")}${live ? `<span class="llive" data-llive="${esc(a.id)}">${liveChip(a)}</span>` : ""}</span>` : ""}
      </span>
      ${list ? `
        <span class="lcol laddrc">${host ? `<span class="laddr">${esc(host)}</span>` : a.locked ? `<span class="lmuted">${IC("lock")} hidden</span>` : ""}</span>
        <span class="lcol ltagc">${tags.map(t => `<span class="ltag wc-${tagHue(t)}">${esc(t)}</span>`).join("")}</span>
        <span class="lcol llivec">${live ? `<span class="llive" data-llive="${esc(a.id)}">${liveChip(a)}</span>` : ""}</span>
        <span class="lcol lstc"><span class="lpill s-${statusClass(st)}" data-lpill="${esc(a.id)}">${esc(pillText(a))}</span></span>` : ""}
      ${!list && live && (size === "l" || size === "xl") ? `<span class="ltlive" data-ltlive="${esc(a.id)}">${liveMini(a)}</span>` : ""}
      <span class="lacts">
        ${a.externalUrl || (a.locked && a.hasExternal) ? `<button class="lact" data-ext="${esc(a.id)}"
           data-tip="Open the outside address" aria-label="Open externally">${IC("globe")}</button>` : ""}
        <button class="lact" data-edit="${esc(a.id)}" data-tip="Edit" aria-label="Edit ${esc(a.name)}">${IC("edit")}</button>
      </span>
    </article>`;
}

function pillText(a) {
  const st = appStatus(a);
  const c = CK.data?.checks?.find(x => x.id === "app:" + a.id);
  if (st === "empty") return "—";
  return statusWord(st) + (st === "up" && Number.isFinite(c?.ms) ? ` · ${c.ms} ms` : "");
}

function paintLauncher() {
  const grid = $("#l-grid"), empty = $("#l-empty"), none = $("#l-none");
  if (!grid) return;

  const shown = LP.apps.filter(lMatches);
  empty.hidden = LP.apps.length > 0;
  none.hidden = !LP.apps.length || shown.length > 0;
  const filtering = !!(LP.q.trim() || LP.tag || LP.filter !== "all");

  grid.classList.toggle("list", LP.view === "list");
  grid.innerHTML = !LP.apps.length ? "" : lSections().map(s => {
    const folded = LP.collapsed.has(s.key || "__loose") && !filtering;
    const up = s.apps.filter(a => appStatus(a) === "up").length;
    const bad = s.apps.filter(a => ["warn", "down"].includes(appStatus(a))).length;
    return `
    <section class="lsec${s.pinned ? " pinned" : ""}${folded ? " folded" : ""}" data-sec="${esc(s.key)}">
      ${s.name ? `<header class="lsechead${s.color ? " wc-" + esc(s.color) : ""}">
        <button type="button" class="lsecfold" data-fold="${esc(s.key || "__loose")}" aria-expanded="${!folded}">
          <span class="lsecchev">${IC("chevron-down")}</span>
          ${s.pinned ? `<span class="lsecpin">${IC("pin")}</span>` : `<span class="lsecmark"></span>`}
          <b>${esc(s.name)}</b><span class="lseccount">${s.apps.length}</span>
        </button>
        <span class="lsecsum">${bad ? `<span class="s-crit"><i class="ndot"></i>${bad} need${bad === 1 ? "s" : ""} a look</span>` : s.apps.length && up === s.apps.length ? `<span class="s-ok"><i class="ndot"></i>All up</span>` : ""}</span>
        ${s.group ? `<button class="lact" data-group="${esc(s.group.id)}" data-tip="Rename, recolour or remove this group"
                       aria-label="Edit group">${IC("edit")}</button>` : ""}
      </header>` : ""}
      <div class="lsecgrid">${s.apps.map(tileHTML).join("") ||
        `<p class="lsecempty">${s.pinned ? "" : "Drag an app here"}</p>`}</div>
    </section>`;
  }).join("");

  paintFilter();
  paintTagBar();
  paintSelBar();
  wireIcons(grid);
  paintSidebarLaunch();
  paintLive();
}

/** The All / Up / Problems / Live counts, over whatever the search leaves. */
function paintFilter() {
  const base = LP.apps.filter(lMatchesText);
  const n = {
    all: base.length,
    up: base.filter(a => appStatus(a) === "up").length,
    down: base.filter(a => ["warn", "down"].includes(appStatus(a))).length,
    live: base.filter(isLive).length
  };
  $$("#l-filter [data-lf]").forEach(b => {
    const k = b.dataset.lf;
    b.setAttribute("aria-pressed", String(LP.filter === k));
    $("i", b).textContent = n[k];
    b.classList.toggle("bad", k === "down" && n.down > 0);
    b.hidden = k === "live" && !n.live && LP.filter !== "live";
  });
  $$("#l-view [data-lv]").forEach(b => b.setAttribute("aria-pressed", String(LP.view === b.dataset.lv)));
  const sw = $("#l-live-on");
  if (sw) sw.setAttribute("aria-checked", String(LV.on));
}

function paintTagBar() {
  const bar = $("#l-tags");
  if (!bar) return;
  const counts = new Map();
  for (const a of LP.apps) for (const t of a.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  bar.hidden = tags.length === 0;
  bar.innerHTML = tags.map(([t, n]) =>
    `<button type="button" class="ltagchip wc-${tagHue(t)}${LP.tag === t ? " on" : ""}" data-tagf="${esc(t)}">
       ${esc(t)}<i>${n}</i></button>`).join("") +
    (LP.tag ? `<button type="button" class="ltagchip clear" data-tagf="">Clear</button>` : "");
}

/** The bar that appears when something is selected. On touch there is no
 *  right-click and no Delete key, so every bulk action lives here. */
function paintSelBar() {
  const bar = $("#l-selbar");
  if (!bar) return;
  // A selection can outlive the app it pointed at (removed, or filtered away).
  for (const id of [...LP.sel]) if (!LP.apps.some(a => a.id === id)) LP.sel.delete(id);
  bar.hidden = LP.sel.size === 0;
  if (!LP.sel.size) return;
  $("#l-selcount").textContent = `${LP.sel.size} selected`;
}

/* ============================ live data ============================
 * Numbers read from the apps themselves through the server (integrations.js):
 * download speeds, queues, what is playing. Polled only while the Apps page
 * is on screen and the tab is visible — every three seconds when a downloader
 * is on the board, every fifteen otherwise — and the server caches each app
 * for a few seconds more, so two open tabs do not double the requests.
 */
const LV = { kinds: null, on: true, data: {}, at: 0, timer: 0, busy: false, folded: lPref("liveFolded", "0") === "1" };

async function loadLiveKinds() {
  if (LV.kinds) return LV.kinds;
  try { const o = await api("/integrations/kinds"); LV.kinds = o.kinds; LV.on = o.on; }
  catch { LV.kinds = []; }
  return LV.kinds;
}
const kindOf = id => (LV.kinds || []).find(k => k.id === id) || null;

/** The same guess the server makes, for the editor's "Detected" line. */
const KIND_GUESS = [
  [/qbit/, "qbittorrent"], [/transmission/, "transmission"], [/sabnzbd/, "sabnzbd"],
  [/sonarr/, "sonarr"], [/radarr/, "radarr"], [/lidarr/, "lidarr"], [/readarr/, "readarr"],
  [/prowlarr/, "prowlarr"], [/bazarr/, "bazarr"], [/jellyseerr/, "jellyseerr"], [/overseerr/, "overseerr"],
  [/jellyfin/, "jellyfin"], [/emby/, "emby"], [/plex/, "plex"], [/immich/, "immich"], [/kavita/, "kavita"],
  [/nginx.?proxy|^npm$/, "npm"], [/pi.?hole/, "pihole"], [/adguard/, "adguard"], [/crafty/, "crafty"]
];
function guessKind(a) {
  const hay = [a.icon, a.name].filter(Boolean).join(" ").toLowerCase();
  for (const [re, k] of KIND_GUESS) if (re.test(hay)) return k;
  return "";
}

async function pollLive() {
  clearTimeout(LV.timer);
  if (curPage !== "apps" || document.hidden) return;
  const any = LP.apps.some(isLive);
  if (any && LV.on && !LV.busy) {
    LV.busy = true;
    try {
      await loadLiveKinds();
      const o = await api("/integrations/live");
      LV.on = o.on; LV.data = o.apps || {}; LV.at = Date.now();
    } catch { /* the last reading stays, aged by its timestamp */ }
    finally { LV.busy = false; }
  }
  paintLive();
  const fast = LP.apps.some(a => isLive(a) && kindOf(a.live.kind)?.rate);
  LV.timer = setTimeout(pollLive, fast ? 3000 : 15000);
}

function fmtStat(s) {
  if (s.v == null) return "—";
  if (s.fmt === "rate") return rate(s.v);
  if (s.fmt === "bytes") return bytes(s.v);
  if (s.fmt === "num") return Number(s.v).toLocaleString();
  return String(s.v);
}
function fmtEta(s) {
  if (!Number.isFinite(s) || s <= 0) return "";
  if (s < 60) return `${s}s left`;
  if (s < 3600) return `${Math.round(s / 60)}m left`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.round(s % 3600 / 60)}m left`;
  return `${Math.round(s / 86400)}d left`;
}
/** A big number and its unit, split so the unit can be drawn smaller. */
function bigRate(v) {
  const [n, u] = rate(v || 0).split(" ");
  return `${esc(n)}<small>${esc(u || "")}</small>`;
}

/** The one-line summary on a tile. */
function liveChip(a) {
  const d = LV.data[a.id];
  if (!d) return `<i class="lvdot wait"></i><span>Reading…</span>`;
  if (!d.ok) return `${IC("alert")}<span>${d.auth ? "Needs a key" : "No reading"}</span>`;
  if (d.rate) return `${IC("arrow-down")}<span>${esc(rate(d.rate.down))}</span>`;
  const s = (d.stats || []).find(x => x.tone === "accent" || x.tone === "warn" || x.tone === "crit") || (d.stats || [])[0];
  return s ? `<i class="lvdot"></i><span>${esc(fmtStat(s))} ${esc(s.k.toLowerCase())}</span>` : `<i class="lvdot"></i><span>Live</span>`;
}

/** The numbers inside a large tile. */
function liveMini(a) {
  const d = LV.data[a.id];
  if (!d) return "";
  if (!d.ok) return `<span class="lvminierr">${IC("alert")}${esc(d.error || "No reading")}</span>`;
  return (d.stats || []).slice(0, 4).map(s =>
    `<span class="lvm${s.tone ? " t-" + esc(s.tone) : ""}"><b>${esc(fmtStat(s))}</b><span>${esc(s.k)}</span></span>`).join("");
}

function spark(h) {
  if (!h || h.down.length < 2) return `<div class="lvspark wait"></div>`;
  const W = 300, H = 46, N = 40, step = W / (N - 1);
  const max = Math.max(1, ...h.down, ...h.up) * 1.15;
  const pts = arr => arr.map((v, i) => [W - (arr.length - 1 - i) * step, H - 2 - (v / max) * (H - 6)]);
  const line = p => p.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const d = pts(h.down), u = pts(h.up);
  return `<svg class="lvspark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path class="a" d="${line(d)}L${W} ${H}L${d[0][0].toFixed(1)} ${H}Z"/>
    <path class="d" d="${line(d)}"/><path class="u" d="${line(u)}"/></svg>`;
}

function liveItemHTML(it) {
  const pct = it.p != null && Number.isFinite(it.p) ? Math.max(0, Math.min(100, Math.round(it.p * 100))) : null;
  const meta = [pct != null ? pct + "%" : null, it.speed ? rate(it.speed) : null, it.eta ? fmtEta(it.eta) : null].filter(Boolean).join(" · ");
  const ico = it.st === "play" ? IC("play") : it.st === "paused" ? IC("pause") : "";
  return `<div class="lvrow st-${esc(it.st || "")}">
    <div class="lvrt">${ico}<span class="lvname" title="${esc(it.t)}">${esc(it.t)}</span><span class="lvmeta">${esc(meta)}</span></div>
    ${pct != null ? `<div class="lvbar"><i style="width:${pct}%"></i></div>` : ""}
    ${it.s ? `<div class="lvsub">${esc(it.s)}</div>` : ""}
  </div>`;
}

function liveCardBody(a) {
  const d = LV.data[a.id];
  if (!d) return `<div class="lvskel"><i></i><i></i><i></i></div>`;
  if (!d.ok) {
    return `<div class="lverr">${IC("alert")}<div><b>${d.auth ? "Nexus could not sign in" : "No reading"}</b>
      <span>${esc(d.error || "")}</span></div>
      <button class="btn sm" type="button" data-lvfix="${esc(a.id)}">${d.auth ? "Add the key" : "Settings"}</button></div>`;
  }
  let h = "";
  const stats = d.stats || [];
  if (d.rate) {
    h += `<div class="lvrate">
      <div class="lvr dn"><span>${IC("arrow-down")}Download</span><b>${bigRate(d.rate.down)}</b></div>
      <div class="lvr up"><span>${IC("arrow-up")}Upload</span><b>${bigRate(d.rate.up)}</b></div></div>`;
    h += spark(d.hist);
    const rest = stats.filter(s => s.fmt !== "rate");
    if (rest.length) h += `<div class="lvchips">${rest.map(s => `<span class="${s.tone ? "t-" + esc(s.tone) : ""}"><b>${esc(fmtStat(s))}</b> ${esc(s.k.toLowerCase())}</span>`).join("")}</div>`;
  } else if (stats.length) {
    if (d.caption) h += `<div class="lvcap">${esc(d.caption)}</div>`;
    h += `<div class="lvstats n${Math.min(stats.length, 4)}">${stats.slice(0, 4).map(s =>
      `<div class="lvs${s.tone ? " t-" + esc(s.tone) : ""}${s.fmt === "text" ? " txt" : ""}" title="${esc(s.k)}: ${esc(fmtStat(s))}"><b>${esc(fmtStat(s))}</b><span>${esc(s.k)}</span></div>`).join("")}</div>`;
  }
  const items = d.items || [];
  if (items.length) {
    h += `<div class="lvitems">${d.itemsLabel ? `<div class="lvih">${esc(d.itemsLabel)}<i>${items.length}</i></div>` : ""}
      ${items.slice(0, 4).map(liveItemHTML).join("")}</div>`;
  } else if (d.itemsLabel === "Downloading" || d.itemsLabel === "Now playing" || d.itemsLabel === "Queue") {
    h += `<p class="lvquiet">${d.itemsLabel === "Now playing" ? "Nothing playing right now" : d.itemsLabel === "Queue" ? "The queue is empty" : "Nothing downloading"}</p>`;
  }
  if (d.notes?.length) h += `<ul class="lvnotes">${d.notes.map(n => `<li>${IC("alert")}${esc(n)}</li>`).join("")}</ul>`;
  return h;
}

function liveCardHead(a) {
  const k = kindOf(a.live.kind);
  return `<header class="lvch">
    <span class="lico sm">${appIconHTML(a)}</span>
    <span class="lvct"><b>${esc(a.name)}</b><span>${esc(k?.label || a.live.kind)}${a.desc && k?.label !== a.desc ? " · " + esc(a.desc) : ""}</span></span>
    <span class="lvstate"></span>
    <button class="lact" type="button" data-lvopen="${esc(a.id)}" data-tip="Open ${esc(a.name)}" aria-label="Open ${esc(a.name)}">${IC("external")}</button>
    <button class="lact" type="button" data-lvfix="${esc(a.id)}" data-tip="Live data settings" aria-label="Live data settings">${IC("settings")}</button>
  </header>`;
}

function paintLive() {
  const strip = $("#l-live"), grid = $("#l-live-grid");
  if (!strip || !grid) return;
  const apps = LV.on ? LP.apps.filter(a => isLive(a) && lMatchesText(a)) : [];
  strip.hidden = !apps.length;
  strip.classList.toggle("folded", LV.folded);
  $("#l-live-fold")?.setAttribute("aria-expanded", String(!LV.folded));
  const n = $("#l-live-n");
  if (n) n.textContent = apps.length;

  const keep = new Set(apps.map(a => a.id));
  $$(".lvcard", grid).forEach(c => { if (!keep.has(c.dataset.live)) c.remove(); });
  apps.forEach((a, i) => {
    let card = $$(".lvcard", grid).find(c => c.dataset.live === a.id);
    const src = iconSrc(a);
    if (!card) {
      card = document.createElement("article");
      card.className = "lvcard";
      card.dataset.live = a.id;
      card.innerHTML = `<div class="lvhead-slot"></div><div class="lvbody"></div>`;
    }
    if (grid.children[i] !== card) grid.insertBefore(card, grid.children[i] || null);
    if (src) { card.dataset.tint = src; const t = TINT.get(src); if (t && t !== "none") card.style.setProperty("--tint", t); }
    const head = liveCardHead(a);
    const slot = $(".lvhead-slot", card);
    if (slot.dataset.sig !== head) { slot.innerHTML = head; slot.dataset.sig = head; wireIcons(slot); }
    const d = LV.data[a.id];
    const state = $(".lvstate", card);
    state.className = "lvstate " + (!d ? "wait" : d.ok ? "ok" : "bad");
    state.innerHTML = !d ? "" : d.ok ? `<i></i>Live` : `<i></i>Error`;
    state.setAttribute("data-tip", d ? `${d.ok ? "Read" : "Tried"} ${since(d.at)}${Number.isFinite(d.ms) ? ` · took ${d.ms} ms` : ""}` : "Waiting for the first reading");
    const html = liveCardBody(a);
    const body = $(".lvbody", card);
    if (body.dataset.sig !== html) { body.innerHTML = html; body.dataset.sig = html; }
  });

  $$("#l-grid [data-llive]").forEach(el => {
    const a = LP.apps.find(x => x.id === el.dataset.llive);
    if (!a) return;
    const h = liveChip(a);
    if (el.dataset.sig !== h) { el.innerHTML = h; el.dataset.sig = h; }
    const d = LV.data[a.id];
    el.className = "llive" + (d && !d.ok ? " bad" : "");
  });
  $$("#l-grid [data-ltlive]").forEach(el => {
    const a = LP.apps.find(x => x.id === el.dataset.ltlive);
    if (a) { const h = liveMini(a); if (el.dataset.sig !== h) { el.innerHTML = h; el.dataset.sig = h; } }
  });
  const ago = $("#l-live-ago");
  if (ago) ago.textContent = !LV.at ? "" : Date.now() - LV.at < 5000 ? "Updated just now" : `Updated ${since(LV.at)}`;
}

on("#l-live-grid", "click", e => {
  const o = e.target.closest("[data-lvopen]");
  if (o) return openApp(LP.apps.find(a => a.id === o.dataset.lvopen));
  const f = e.target.closest("[data-lvfix]");
  if (f) return editApp(LP.apps.find(a => a.id === f.dataset.lvfix), "live");
});

on("#l-live-fold", "click", () => {
  LV.folded = !LV.folded;
  lSetPref("liveFolded", LV.folded ? "1" : "0");
  paintLive();
});

on("#l-live-on", "click", async e => {
  const next = !LV.on;
  LV.on = next;
  e.currentTarget.setAttribute("aria-checked", String(next));
  try { await api("/settings", { method: "PUT", body: { liveApps: next } }); }
  catch (err) { LV.on = !next; toast(err.message, "err"); }
  paintLauncher();
  if (LV.on) pollLive();
  toast(LV.on ? "Live data on" : "Live data off — Nexus stops asking the apps", "ok");
});

on("#l-filter", "click", e => {
  const b = e.target.closest("[data-lf]");
  if (!b) return;
  LP.filter = b.dataset.lf === LP.filter ? "all" : b.dataset.lf;
  paintLauncher();
});
on("#l-view", "click", e => {
  const b = e.target.closest("[data-lv]");
  if (!b || b.dataset.lv === LP.view) return;
  LP.view = b.dataset.lv;
  lSetPref("view", LP.view);
  paintLauncher();
});
on("#l-none-clear", "click", () => {
  LP.q = ""; LP.tag = ""; LP.filter = "all";
  $("#l-q").value = "";
  paintLauncher();
});
on("#l-empty", "click", e => {
  const b = e.target.closest("[data-lempty]");
  if (!b) return;
  if (b.dataset.lempty === "pull") pullApps(); else editApp(null);
});

function lSelected() { return LP.apps.filter(a => LP.sel.has(a.id)); }

/* ---- opening one ----
 * The tile always opens the local address and the globe opens the outside one:
 * guessing which network you are on is a guess, and the wrong guess is a dead
 * tab. A locked app has neither address in the page at all — the server holds
 * both until the PIN is given.
 */
async function openApp(a, external) {
  if (!a) return;
  noteLaunch(a.id);
  if (a.locked) return askPin(a, external);
  const url = external ? a.externalUrl : (a.url || a.externalUrl);
  if (!url) return toast("no address set for that app", "err");
  window.open(url, "_blank", "noopener");
}

/**
 * Ask for a PIN, then do the thing.
 *
 * One dialog for both of the operations that must prove the owner knows it —
 * changing it and taking it off. `run` is given the digits and returns the
 * server's answer; `then` gets it if the server was satisfied. Anything the
 * server says (wrong PIN, throttled) is shown in the dialog rather than as a
 * toast that appears behind it.
 */
function askForPin(opts, then) {
  const form = document.createElement("div");
  form.className = "lpin";
  form.innerHTML = `
    <p class="hint">${esc(opts.lead)}</p>
    <input id="lp-a" type="password" inputmode="numeric" autocomplete="off"
           maxlength="4" placeholder="\u2022\u2022\u2022\u2022" aria-label="Current PIN">
    ${opts.second ? `<p class="hint">${esc(opts.second)}</p>
      <input id="lp-b" type="password" inputmode="numeric" autocomplete="off"
             maxlength="4" placeholder="\u2022\u2022\u2022\u2022" aria-label="New PIN">` : ""}
    <p class="lpin-err" id="lp-err" hidden></p>`;

  openModal({
    title: opts.title, icon: "/assets/brand/icons/ui-launcher.png", body: form,
    foot: `<span class="spacer"></span>
           <button class="btn primary sm" id="lp-go" type="button">${esc(opts.action)}</button>`
  });
  const a = $("#lp-a", form), b = $("#lp-b", form), err = $("#lp-err", form);
  setTimeout(() => a.focus(), 50);

  const go = async () => {
    const one = a.value.trim(), two = b ? b.value.trim() : null;
    const bad = t => { err.hidden = false; err.textContent = t; };
    if (!/^\d{4}$/.test(one)) return bad("Four digits.");
    if (b && !/^\d{4}$/.test(two)) return bad("The new PIN is four digits too.");
    try {
      then(await opts.run(one, two));
    } catch (e) { bad(e.message || "that did not work"); a.select(); }
  };
  on("#lp-go", "click", go);
  for (const el of [a, b]) el?.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
}

function askPin(a, external) {
  // Opened now, while we are still inside the click, and pointed at the real
  // address once the server hands it over: a window.open after an await is a
  // popup the browser blocks.
  const form = document.createElement("div");
  form.className = "lpin";
  form.innerHTML = `
    <p class="hint">${esc(a.name)} is behind a PIN.</p>
    <input id="lpin-in" type="password" inputmode="numeric" autocomplete="off"
           maxlength="4" pattern="\\d{4}" placeholder="••••" aria-label="Four-digit PIN">
    <p class="lpin-err" id="lpin-err" hidden></p>`;
  openModal({
    title: "PIN", icon: "/assets/brand/icons/ui-launcher.png", body: form,
    foot: `<span class="spacer"></span><button class="btn primary sm" id="lpin-go" type="button">Open</button>`
  });
  const input = $("#lpin-in", form);
  setTimeout(() => input.focus(), 50);

  const go = async () => {
    const pin = input.value.trim();
    const err = $("#lpin-err", form);
    if (!/^\d{4}$/.test(pin)) { err.hidden = false; err.textContent = "Four digits."; return; }
    const win = window.open("", "_blank", "noopener");
    try {
      const out = await api(`/launcher/${encodeURIComponent(a.id)}/open`, { method: "POST", body: { pin } });
      const url = external ? out.externalUrl : (out.url || out.externalUrl);
      if (!url) { win?.close(); throw new Error("no address set for that app"); }
      if (win) win.location = url; else window.open(url, "_blank", "noopener");
      closeModal();
    } catch (e) {
      win?.close();
      err.hidden = false;
      err.textContent = e.message || "that did not work";
      input.select();
    }
  };
  on("#lpin-go", "click", go);
  input.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
}

/* ---- clicks ---- */
on("#l-grid", "click", e => {
  const ext = e.target.closest("[data-ext]");
  if (ext) { e.stopPropagation(); return openApp(LP.apps.find(a => a.id === ext.dataset.ext), true); }
  const ed = e.target.closest("[data-edit]");
  if (ed) { e.stopPropagation(); return editApp(LP.apps.find(a => a.id === ed.dataset.edit)); }
  const gr = e.target.closest("[data-group]");
  if (gr) { e.stopPropagation(); return editGroup(LP.groups.find(g => g.id === gr.dataset.group)); }
  const fold = e.target.closest("[data-fold]");
  if (fold) {
    e.stopPropagation();
    const k = fold.dataset.fold;
    LP.collapsed.has(k) ? LP.collapsed.delete(k) : LP.collapsed.add(k);
    lSetPref("folded", JSON.stringify([...LP.collapsed]));
    const sec = fold.closest(".lsec");
    sec.classList.toggle("folded", LP.collapsed.has(k));
    fold.setAttribute("aria-expanded", String(!LP.collapsed.has(k)));
    return;
  }

  const tile = e.target.closest(".ltile");
  if (!tile) { if (LP.sel.size) { LP.sel.clear(); paintLauncher(); } return; }
  if (tile.dataset.dragged) return;

  const app = LP.apps.find(a => a.id === tile.dataset.id);
  // Ctrl/⌘ builds a selection; a plain click opens the app. Same rule as the
  // widget canvas, so one habit works on both pages.
  if (e.ctrlKey || e.metaKey || e.shiftKey || LP.sel.size) {
    e.preventDefault();
    LP.sel.has(app.id) ? LP.sel.delete(app.id) : LP.sel.add(app.id);
    paintLauncher();
    return;
  }
  openApp(app);
});

on("#l-grid", "keydown", e => {
  const tile = e.target.closest(".ltile");
  if (!tile) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openApp(LP.apps.find(a => a.id === tile.dataset.id));
  }
});

on("#l-q", "input", e => { LP.q = e.target.value; paintLauncher(); });
on("#l-tags", "click", e => {
  const b = e.target.closest("[data-tagf]");
  if (!b) return;
  LP.tag = b.dataset.tagf === LP.tag ? "" : b.dataset.tagf;
  paintLauncher();
});

/* ---- selection ---- */
on("#l-selclear", "click", () => { LP.sel.clear(); paintLauncher(); });
on("#l-selremove", "click", () => removeApps(lSelected()));
on("#l-selpin", "click", () => {
  const sel = lSelected();
  const on = !sel.every(a => a.pinned);
  sel.forEach(a => { a.pinned = on; });
  paintLauncher(); saveLauncher();
});
on("#l-selsize", "click", e => chooseFrom(e.currentTarget, L_SIZES.map(s => ({ label: s.label, value: s.key })), v => {
  lSelected().forEach(a => { a.size = v; });
  paintLauncher(); saveLauncher();
}));
on("#l-selgroup", "click", e => chooseFrom(e.currentTarget,
  [{ label: "No group", value: "" }, ...LP.groups.map(g => ({ label: g.name, value: g.id }))], v => {
    lSelected().forEach(a => { a.group = v; a.pinned = false; });
    paintLauncher(); saveLauncher();
  }));

/** A little menu anchored to a button. Small enough not to need the widget
 *  context-menu machinery, and it closes on the next click anywhere. */
function chooseFrom(anchor, items, pick) {
  $$(".lmenu").forEach(m => m.remove());
  const menu = document.createElement("div");
  menu.className = "lmenu";
  menu.innerHTML = items.map(i => `<button type="button" data-v="${esc(String(i.value))}">${esc(i.label)}</button>`).join("");
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect(), m = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - m.width - 8)) + "px";
  menu.style.top = (r.top - m.height - 6 > 8 ? r.top - m.height - 6 : r.bottom + 6) + "px";
  menu.addEventListener("click", e => {
    const b = e.target.closest("[data-v]");
    if (b) pick(b.dataset.v);
    menu.remove();
  });
  setTimeout(() => addEventListener("pointerdown", function off(ev) {
    if (!menu.contains(ev.target)) { menu.remove(); removeEventListener("pointerdown", off); }
  }), 0);
}

function removeApps(list) {
  if (!list.length) return;
  const what = list.length === 1 ? `"${list[0].name}"` : `${list.length} apps`;
  if (!confirm(`Remove ${what} from the Apps page?\n\nThis only removes the tiles. Nothing is stopped or uninstalled.`)) return;
  const gone = new Set(list.map(a => a.id));
  LP.apps = LP.apps.filter(a => !gone.has(a.id));
  LP.sel.clear();
  paintLauncher(); saveLauncher();
  toast("Removed", "ok");
}

addEventListener("keydown", e => {
  if (!LP.sel.size || !$("#page-apps")?.classList.contains("on")) return;
  if (document.activeElement?.matches("input,textarea")) return;
  if (e.key === "Escape") { LP.sel.clear(); paintLauncher(); }
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeApps(lSelected()); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    LP.apps.filter(lMatches).forEach(a => LP.sel.add(a.id));
    paintLauncher();
  }
});

/* ---- dragging: reorder, and move between groups ----
 *
 * A drag ends at a place in a list, not at a pixel, so what follows the
 * pointer is a ghost and what says where it will land is a marker drawn
 * between two tiles. Dropping on a group's band moves the app into that group;
 * dropping on the Pinned band pins it. The whole selection travels together.
 */
let lDrag = null;

function lDragStart(e, tile) {
  const ids = LP.sel.has(tile.dataset.id) && LP.sel.size ? [...LP.sel] : [tile.dataset.id];
  const ghost = document.createElement("div");
  ghost.className = "lghost";
  ghost.innerHTML = tile.innerHTML + (ids.length > 1 ? `<span class="lghostn">${ids.length}</span>` : "");
  const r = tile.getBoundingClientRect();
  ghost.style.width = Math.min(r.width, 260) + "px";
  document.body.appendChild(ghost);

  const mark = document.createElement("span");
  mark.className = "lmark";

  lDrag = { ids, ghost, mark, tile, target: null };
  $("#l-grid").classList.add("ldragging");
  ids.forEach(id => $(`.ltile[data-id="${CSS.escape(id)}"]`, $("#l-grid"))?.classList.add("moving"));
  lDragMove(e);
}

function lDragMove(e) {
  if (!lDrag) return;
  lDrag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const sec = el?.closest(".lsec");
  if (!sec) return;
  const over = el?.closest(".ltile");
  const grid = $(".lsecgrid", sec);

  if (over && !lDrag.ids.includes(over.dataset.id)) {
    const r = over.getBoundingClientRect();
    const after = LP.view === "list" ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    over.parentNode.insertBefore(lDrag.mark, after ? over.nextSibling : over);
    lDrag.target = { sec: sec.dataset.sec, anchor: over.dataset.id, after };
  } else if (!over) {
    grid.appendChild(lDrag.mark);
    lDrag.target = { sec: sec.dataset.sec, anchor: null, after: true };
  }
}

function lDragEnd(cancelled) {
  if (!lDrag) return;
  const { ids, ghost, mark, target } = lDrag;
  ghost.remove(); mark.remove();
  $("#l-grid").classList.remove("ldragging");
  lDrag = null;

  if (cancelled || !target) { paintLauncher(); return; }

  const moving = LP.apps.filter(a => ids.includes(a.id));
  const rest = LP.apps.filter(a => !ids.includes(a.id));
  for (const a of moving) {
    if (target.sec === "__pinned") a.pinned = true;
    else { a.pinned = false; a.group = target.sec; }
  }
  let at = rest.length;
  if (target.anchor) {
    const i = rest.findIndex(a => a.id === target.anchor);
    if (i >= 0) at = target.after ? i + 1 : i;
  } else {
    // Dropped on a band rather than between two tiles: the end of that band.
    const last = [...rest].reverse().find(a =>
      target.sec === "__pinned" ? a.pinned : (!a.pinned && (a.group || "") === target.sec));
    at = last ? rest.indexOf(last) + 1 : rest.length;
  }
  rest.splice(at, 0, ...moving);
  LP.apps = rest;
  paintLauncher(); saveLauncher();
}

on("#l-grid", "pointerdown", e => {
  if (e.button !== 0) return;
  if (e.target.closest("button")) return;
  const grid = $("#l-grid");
  const tile = e.target.closest(".ltile");

  if (!tile) return lMarqueeStart(e);

  const sx = e.clientX, sy = e.clientY;
  const touch = e.pointerType === "touch";
  let started = false, held = null;

  const begin = ev => { started = true; lDragStart(ev, tile); if (touch) navigator.vibrate?.(8); };
  // A finger has no hover to protect, so a press that stays still is the
  // signal; a mouse has a cursor, so distance is.
  if (touch) held = setTimeout(() => begin(e), 340);

  const mv = ev => {
    if (!started) {
      const far = Math.abs(ev.clientX - sx) > 6 || Math.abs(ev.clientY - sy) > 6;
      if (touch) { if (far) { clearTimeout(held); cleanup(); } return; }
      if (!far) return;
      begin(ev);
    }
    ev.preventDefault();
    lDragMove(ev);
  };
  const up = () => {
    clearTimeout(held);
    if (started) {
      tile.dataset.dragged = "1";
      setTimeout(() => { delete tile.dataset.dragged; }, 0);
      lDragEnd(false);
    }
    cleanup();
  };
  const cancel = () => { clearTimeout(held); if (started) lDragEnd(true); cleanup(); };
  const esc = ev => { if (ev.key === "Escape" && started) { lDragEnd(true); cleanup(); } };
  function cleanup() {
    grid.removeEventListener("pointermove", mv);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", cancel);
    removeEventListener("keydown", esc);
    try { tile.releasePointerCapture(e.pointerId); } catch {}
  }

  try { tile.setPointerCapture(e.pointerId); } catch {}
  grid.addEventListener("pointermove", mv);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", cancel);
  addEventListener("keydown", esc);
});

/** Drag a box over empty space to select what it touches. */
function lMarqueeStart(e) {
  if (e.pointerType === "touch") return;      // a finger there is a scroll
  const grid = $("#l-grid");
  const sx = e.clientX, sy = e.clientY;
  const box = document.createElement("div");
  box.className = "lmarquee";
  let live = false;
  const add = e.ctrlKey || e.metaKey;
  if (!add) LP.sel.clear();

  const mv = ev => {
    if (!live) {
      if (Math.abs(ev.clientX - sx) < 5 && Math.abs(ev.clientY - sy) < 5) return;
      live = true; document.body.appendChild(box);
    }
    const x = Math.min(sx, ev.clientX), y = Math.min(sy, ev.clientY);
    const w = Math.abs(ev.clientX - sx), h = Math.abs(ev.clientY - sy);
    Object.assign(box.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
    for (const el of $$(".ltile", grid)) {
      const r = el.getBoundingClientRect();
      const hit = r.left < x + w && r.right > x && r.top < y + h && r.bottom > y;
      if (hit) LP.sel.add(el.dataset.id); else if (!add) LP.sel.delete(el.dataset.id);
      el.classList.toggle("on", LP.sel.has(el.dataset.id));
    }
    paintSelBar();
  };
  const up = () => {
    box.remove();
    removeEventListener("pointermove", mv);
    removeEventListener("pointerup", up);
    if (live) paintLauncher();
  };
  addEventListener("pointermove", mv);
  addEventListener("pointerup", up);
}

/* ---- groups ---- */
function editGroup(g) {
  const isNew = !g;
  const row = g || { id: "", name: "", color: "cyan" };
  const form = document.createElement("div");
  form.className = "lform";
  form.innerHTML = `
    <div class="ag-row"><label for="lg-name">Name</label>
      <input id="lg-name" type="text" maxlength="40" value="${esc(row.name)}" placeholder="Watching"></div>
    <div class="ag-row"><label>Colour</label>
      <div class="ctxrow">${GROUP_COLORS.map(c =>
        `<button type="button" class="swatch wc-${c}${row.color === c ? " sel" : ""}" data-c="${c}"
                 aria-label="${c}"></button>`).join("")}</div>
      <span class="hint">Only a marker on the band and its tags — it does not recolour the apps.</span></div>`;

  let color = row.color;
  openModal({
    title: isNew ? "New group" : "Edit group",
    icon: "/assets/brand/icons/ui-launcher.png", body: form,
    foot: `${isNew ? "" : `<button class="btn sm danger" id="lg-del" type="button">Remove</button>`}
           <span class="spacer"></span>
           <button class="btn primary sm" id="lg-save" type="button">Save</button>`
  });
  $$("[data-c]", form).forEach(b => b.addEventListener("click", () => {
    color = b.dataset.c;
    $$("[data-c]", form).forEach(x => x.classList.toggle("sel", x === b));
  }));
  on("#lg-del", "click", () => {
    if (!confirm(`Remove the group "${row.name}"?\n\nThe apps in it stay on the board, without a group.`)) return;
    LP.groups = LP.groups.filter(x => x.id !== row.id);
    LP.apps.forEach(a => { if (a.group === row.id) a.group = ""; });
    closeModal(); paintLauncher(); saveLauncher();
  });
  on("#lg-save", "click", () => {
    const name = $("#lg-name", form).value.trim();
    if (!name) return toast("give it a name", "err");
    if (isNew) LP.groups.push({ id: "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, color });
    else LP.groups = LP.groups.map(x => x.id === row.id ? { ...x, name, color } : x);
    closeModal(); paintLauncher(); saveLauncher();
    toast(isNew ? "Group added" : "Group saved", "ok");
  });
}

on("#l-group", "click", () => editGroup(null));

/* ---- add / edit an app ----
 * One dialog in four short tabs rather than one long form: what it is and
 * where it lives, how its tile looks, live data, and the PIN. On the left a
 * preview of the tile, redrawn as you type, so the result is never a
 * surprise. Nothing is saved until Save; Ctrl/⌘+Enter saves from any field.
 */
const AE_TABS = [
  { id: "basics", label: "Basics", icon: "edit", hint: "Name and addresses" },
  { id: "look", label: "Tile", icon: "layout", hint: "Icon, size, group, tags" },
  { id: "live", label: "Live data", icon: "activity", hint: "Speeds, queues, playing" },
  { id: "access", label: "PIN", icon: "lock", hint: "Hide it behind four digits" }
];

async function editApp(app, startTab = "basics") {
  await loadLiveKinds();
  const isNew = !app;
  const a = app ? { ...app, tags: [...(app.tags || [])], ports: [...(app.ports || [])] }
                : { id: "", name: "", url: "", externalUrl: "", icon: "", desc: "", ports: [], tags: [],
                    group: "", pinned: false, size: "m", locked: false };
  const live0 = a.live || null;
  const L = {
    kind: live0?.kind || guessKind(a), on: live0 ? live0.on !== false : false,
    url: live0?.url || "", user: live0?.user || "", hasSecret: !!live0?.hasSecret,
    secret: undefined          // undefined keeps what is stored; "" removes it
  };
  let tags = [...a.tags];
  let size = a.size || "m";
  let tab = AE_TABS.some(t => t.id === startTab) ? startTab : "basics";
  const usedTags = [...new Set(LP.apps.flatMap(x => x.tags || []))].sort();
  const groupsByKind = {};
  for (const k of LV.kinds || []) (groupsByKind[k.group] = groupsByKind[k.group] || []).push(k);

  const form = document.createElement("div");
  form.className = "ae";
  form.innerHTML = `
    <aside class="ae-side">
      <div class="ae-prevwrap"><div class="ae-prevlbl">Preview</div><div class="ae-prev" id="ae-prev"></div></div>
      <nav class="ae-tabs" role="tablist" aria-label="Sections">
        ${AE_TABS.map(t => `<button type="button" role="tab" class="ae-tab" data-tab="${t.id}" aria-selected="false">
          ${IC(t.icon)}<span><b>${t.label}</b><small>${t.hint}</small></span><i class="ae-flag" hidden></i></button>`).join("")}
      </nav>
    </aside>
    <div class="ae-main">
      <section class="ae-pane" data-pane="basics" role="tabpanel">
        <div class="fld"><label for="lf-name">Name</label>
          <input id="lf-name" type="text" maxlength="60" value="${esc(a.name)}" placeholder="Jellyfin" autocomplete="off">
          <span class="fld-err" data-err="name" hidden></span></div>
        <div class="fld"><label for="lf-url">Local address</label>
          <div class="fld-row"><span class="fld-ico">${IC("home")}</span>
          <input id="lf-url" type="url" value="${esc(a.url)}" placeholder="${a.locked ? "Hidden while the PIN is on" : "http://192.168.1.50:8096"}"
                 spellcheck="false" autocomplete="off"${a.locked ? " disabled" : ""}></div>
          <span class="fld-hint">${a.locked ? "Both addresses stay on the server while this app has a PIN. Take the PIN off to change them."
            : "Where the tile goes. The health check and live data read it too."}</span>
          <span class="fld-err" data-err="url" hidden></span></div>
        <div class="fld"><label for="lf-ext">Outside address <em>optional</em></label>
          <div class="fld-row"><span class="fld-ico">${IC("globe")}</span>
          <input id="lf-ext" type="url" value="${esc(a.externalUrl)}" placeholder="${a.locked ? "Hidden while the PIN is on" : "https://jellyfin.example.com"}"
                 spellcheck="false" autocomplete="off"${a.locked ? " disabled" : ""}></div>
          <span class="fld-hint">For the globe button, when you are away from home.</span></div>
        <div class="fld-2">
          <div class="fld"><label for="lf-desc">Description <em>optional</em></label>
            <input id="lf-desc" type="text" maxlength="200" value="${esc(a.desc)}" placeholder="Films and TV"></div>
          <div class="fld"><label for="lf-ports">Ports <em>optional</em></label>
            <input id="lf-ports" type="text" value="${esc((a.ports || []).join(", "))}" placeholder="From the address" spellcheck="false"></div>
        </div>
      </section>

      <section class="ae-pane" data-pane="look" role="tabpanel" hidden>
        <div class="fld"><label for="lf-icon">Icon</label>
          <div class="ae-iconrow"><span class="lico" id="lf-iprev">${appIconHTML(a)}</span>
            <input id="lf-icon" type="text" value="${esc(a.icon)}" placeholder="Automatic" spellcheck="false" autocomplete="off"></div>
          <span class="fld-hint" id="lf-ihint"></span></div>
        <div class="fld"><label>Tile size</label>
          <div class="ae-sizes" role="radiogroup" aria-label="Tile size">
            ${L_SIZES.map(s => `<button type="button" role="radio" class="ae-size" data-s="${s.key}" aria-checked="${size === s.key}">
              <span class="ae-sz ae-sz-${s.key}"><i></i></span><b>${s.label}</b><small>${esc(s.hint)}</small></button>`).join("")}
          </div></div>
        <div class="fld-2">
          <div class="fld"><label for="lf-group">Group</label>
            <select id="lf-group"><option value="">No group</option>
              ${LP.groups.map(g => `<option value="${esc(g.id)}"${a.group === g.id ? " selected" : ""}>${esc(g.name)}</option>`).join("")}
            </select></div>
          <div class="fld"><label>Pinned</label>
            <div class="ae-switchrow"><span>Keep it in the band at the top</span>
              <button class="switch" id="lf-pin" type="button" role="switch" aria-checked="${!!a.pinned}" aria-label="Pinned"><span></span></button></div></div>
        </div>
        <div class="fld"><label for="lf-tagin">Tags <em>up to six</em></label>
          <div class="ae-tags" id="lf-tags"><input id="lf-tagin" type="text" placeholder="Type and press Enter" spellcheck="false" autocomplete="off"></div>
          <div class="ae-tagsug" id="lf-tagsug"></div></div>
      </section>

      <section class="ae-pane" data-pane="live" role="tabpanel" hidden>
        ${a.locked ? `<div class="ae-note">${IC("lock")}<span>Live data is not shown on a tile with a PIN — its numbers would give away what is behind it.
          The settings below are kept for when the PIN comes off.</span></div>` : ""}
        <div class="ae-switchrow big"><span><b>Show live data</b><small>Read speeds, queues or what is playing from the app itself, every few seconds while the Apps page is open. Read only — Nexus never changes anything in the app.</small></span>
          <button class="switch" id="lv-on" type="button" role="switch" aria-checked="${L.on}" aria-label="Show live data"><span></span></button></div>
        <div class="ae-livebody" id="lv-body">
          <div class="fld"><label for="lv-kind">Which app is it?</label>
            <select id="lv-kind"><option value="">Choose…</option>
              ${Object.entries(groupsByKind).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(k =>
                `<option value="${k.id}"${L.kind === k.id ? " selected" : ""}>${esc(k.label)}</option>`).join("")}</optgroup>`).join("")}
            </select>
            <span class="fld-hint" id="lv-detect"></span></div>
          <div id="lv-auth"></div>
          <details class="ae-more"${L.url ? " open" : ""}><summary>${IC("chevron-right")}Different address for the API</summary>
            <div class="fld"><input id="lv-url" type="url" value="${esc(L.url)}" placeholder="Leave empty to use the local address" spellcheck="false" autocomplete="off">
              <span class="fld-hint">Only if the API is somewhere else — a different port, or the container's own address.</span></div>
          </details>
          <div class="ae-test"><button class="btn sm" type="button" id="lv-test">${IC("activity")}Test connection</button>
            <span class="fld-hint">Uses what is typed here, without saving it.</span></div>
          <div class="ae-testout" id="lv-out" hidden></div>
        </div>
        <p class="ae-unsup" id="lv-unsup" hidden>Live data works with ${esc((LV.kinds || []).map(k => k.label).join(", "))}.</p>
      </section>

      <section class="ae-pane" data-pane="access" role="tabpanel" hidden>
        <div class="ae-note">${IC("shield")}<span>A PIN keeps this tile's address out of the page and asks for four digits before opening it.
          It is a screen for whoever is looking at Nexus — the app keeps its own login.</span></div>
        ${a.locked
          ? `<div class="ae-lockon"><span class="ae-lockico">${IC("lock")}</span><span><b>This app opens with a PIN</b>
               <small>Changing it or taking it off needs the current PIN. Forgotten it? Ask Kernel, and approve the request.</small></span></div>
             <div class="ae-lockacts"><button class="btn sm" id="lf-repin" type="button">Change PIN</button>
               <button class="btn sm danger" id="lf-unlock" type="button">Take it off</button></div>`
          : `<div class="ae-switchrow big"><span><b>Ask for a PIN</b><small>Four digits, asked every time the tile is opened.</small></span>
               <button class="switch" id="lf-lockon" type="button" role="switch" aria-checked="false" aria-label="Ask for a PIN"><span></span></button></div>
             <div class="fld" id="lf-lockbox" hidden><label for="lf-lock">PIN</label>
               <input id="lf-lock" class="ae-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="new-password">
               <span class="fld-err" data-err="pin" hidden></span></div>`}
      </section>
    </div>`;

  const foot = document.createElement("div");
  foot.className = "ae-foot";
  foot.innerHTML = `${app ? `<button class="btn sm danger ghost" id="lf-del" type="button">${IC("trash")}Remove</button>` : ""}
    <span class="spacer"></span><span class="ae-kbd"><kbd>Ctrl</kbd><kbd>Enter</kbd></span>
    <button class="btn sm" id="lf-cancel" type="button">Cancel</button>
    <button class="btn primary sm" id="lf-save" type="button">${isNew ? "Add app" : "Save"}</button>`;

  openModal({ title: isNew ? "Add an app" : `Edit ${a.name}`, icon: "/assets/brand/icons/ui-launcher.png", body: form, foot, cls: "mw-app" });

  const $f = s => $(s, form);

  /* tabs */
  const showTab = id => {
    tab = id;
    $$(".ae-tab", form).forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === id)));
    $$(".ae-pane", form).forEach(p => { p.hidden = p.dataset.pane !== id; });
  };
  $$(".ae-tab", form).forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  showTab(tab);

  /* the preview */
  const current = () => ({
    ...a, name: $f("#lf-name").value.trim() || "New app",
    url: a.locked ? a.url : $f("#lf-url").value.trim(),
    externalUrl: a.locked ? a.externalUrl : $f("#lf-ext").value.trim(),
    desc: $f("#lf-desc").value.trim(), icon: $f("#lf-icon").value.trim(),
    tags, size, pinned: $f("#lf-pin").getAttribute("aria-checked") === "true",
    live: L.kind ? { kind: L.kind, on: L.on, url: L.url, user: L.user } : null
  });
  const paintPreview = () => {
    const c = current();
    const was = LP.view; LP.view = "grid";
    const prevSel = LP.sel.has(c.id); LP.sel.delete(c.id);
    $f("#ae-prev").innerHTML = tileHTML({ ...c, id: c.id || "__preview" }).replace(/data-(edit|ext)="[^"]*"/g, "");
    LP.view = was; if (prevSel) LP.sel.add(c.id);
    $f("#ae-prev").dataset.size = size;
    $f("#lf-iprev").innerHTML = appIconHTML(c);
    const slug = iconSlug(c);
    $f("#lf-ihint").innerHTML = c.icon
      ? (/^https?:/.test(c.icon) ? "Using the image at that address." : `Looking up <code>${esc(slug)}</code> in the community icon set.`)
      : `Automatic — guessed <code>${esc(slug || "?")}</code> from the name. Type a slug like <code>jellyfin</code>, or paste an image URL.`;
    wireIcons(form);
  };
  let pt = 0;
  const schedule = () => { cancelAnimationFrame(pt); pt = requestAnimationFrame(paintPreview); };
  ["#lf-name", "#lf-url", "#lf-ext", "#lf-desc", "#lf-icon"].forEach(s => $f(s).addEventListener("input", schedule));

  /* name -> a guess at the live kind, while the owner has not picked one */
  let kindTouched = !!live0?.kind;
  $f("#lf-name").addEventListener("input", () => {
    if (kindTouched) return;
    const g = guessKind({ name: $f("#lf-name").value, icon: $f("#lf-icon").value });
    if (g !== L.kind) { L.kind = g; $f("#lv-kind").value = g; paintLiveForm(); }
  });

  /* size, pinned */
  $$(".ae-size", form).forEach(b => b.addEventListener("click", () => {
    size = b.dataset.s;
    $$(".ae-size", form).forEach(x => x.setAttribute("aria-checked", String(x === b)));
    schedule();
  }));
  const flip = el => { el.setAttribute("aria-checked", String(el.getAttribute("aria-checked") !== "true")); };
  $f("#lf-pin").addEventListener("click", e => { flip(e.currentTarget); schedule(); });

  /* tags */
  const paintTags = () => {
    const box = $f("#lf-tags"), input = $f("#lf-tagin");
    $$(".ae-chip", box).forEach(c => c.remove());
    tags.forEach(t => {
      const chip = document.createElement("span");
      chip.className = `ae-chip ltag wc-${tagHue(t)}`;
      chip.innerHTML = `${esc(t)}<button type="button" data-untag="${esc(t)}" aria-label="Remove ${esc(t)}">${IC("x")}</button>`;
      box.insertBefore(chip, input);
    });
    input.hidden = tags.length >= 6;
    const sug = usedTags.filter(t => !tags.includes(t)).slice(0, 10);
    $f("#lf-tagsug").innerHTML = sug.length && tags.length < 6
      ? sug.map(t => `<button type="button" class="ae-sug" data-sug="${esc(t)}">${IC("plus")}${esc(t)}</button>`).join("") : "";
    schedule();
  };
  const addTag = raw => {
    const t = String(raw).toLowerCase().replace(/[^a-z0-9 +-]/g, "").trim().slice(0, 18);
    if (t && !tags.includes(t) && tags.length < 6) tags.push(t);
    paintTags();
  };
  $f("#lf-tagin").addEventListener("keydown", e => {
    const v = e.target.value;
    if ((e.key === "Enter" || e.key === ",") && v.trim()) { e.preventDefault(); addTag(v); e.target.value = ""; }
    else if (e.key === "Backspace" && !v && tags.length) { tags.pop(); paintTags(); }
  });
  $f("#lf-tagin").addEventListener("blur", e => { if (e.target.value.trim()) { addTag(e.target.value); e.target.value = ""; } });
  $f("#lf-tags").addEventListener("click", e => {
    const x = e.target.closest("[data-untag]");
    if (x) { tags = tags.filter(t => t !== x.dataset.untag); paintTags(); }
    else $f("#lf-tagin").focus();
  });
  $f("#lf-tagsug").addEventListener("click", e => { const b = e.target.closest("[data-sug]"); if (b) addTag(b.dataset.sug); });

  /* live data */
  const paintLiveForm = () => {
    const k = kindOf(L.kind);
    $f("#lv-on").setAttribute("aria-checked", String(L.on));
    $f("#lv-body").classList.toggle("off", !L.on);
    $f("#lv-unsup").hidden = !!k;
    const g = guessKind({ name: $f("#lf-name").value, icon: $f("#lf-icon").value });
    const detected = k && g === L.kind && !live0?.kind;
    $f("#lv-detect").innerHTML = k
      ? (detected ? `<span class="ae-det">${IC("sparkles")}Detected from the name.</span> ` : "") + esc(k.help)
      : "Pick the app this tile opens. Others show only their up or down status.";
    const saved = L.hasSecret && L.secret === undefined;
    const secretField = (id, label) => `
      <div class="fld"><label for="${id}">${esc(label)}${k.optionalAuth ? " <em>optional</em>" : ""}</label>
        <div class="fld-row"><span class="fld-ico">${IC("key")}</span>
          <input id="${id}" type="password" value="" placeholder="${saved ? "Saved — leave empty to keep it" : "Paste it here"}" autocomplete="new-password" spellcheck="false">
          <button type="button" class="fld-btn" data-reveal="${id}" aria-label="Show">${IC("eye")}</button></div>
        ${saved ? `<button type="button" class="linkbtn" id="lv-forget">Remove the saved ${esc(label.toLowerCase())}</button>` : ""}
      </div>`;
    let h = "";
    if (k && k.auth === "userpass") {
      h = `<div class="fld-2"><div class="fld"><label for="lv-user">${esc(k.userLabel)}${k.optionalAuth ? " <em>optional</em>" : ""}</label>
              <input id="lv-user" type="text" value="${esc(L.user)}" autocomplete="off" spellcheck="false"></div>
            ${secretField("lv-secret", "Password")}</div>`;
    } else if (k && (k.auth === "key" || k.auth === "pass")) {
      h = secretField("lv-secret", k.keyLabel);
    }
    $f("#lv-auth").innerHTML = h;
    $f("#lv-user")?.addEventListener("input", e => { L.user = e.target.value.trim(); });
    $f("#lv-secret")?.addEventListener("input", e => { L.secret = e.target.value ? e.target.value : undefined; });
    $f("#lv-forget")?.addEventListener("click", () => { L.secret = ""; L.hasSecret = false; paintLiveForm(); toast("The saved key goes when you save", "ok"); });
    $$("[data-reveal]", form).forEach(b => b.addEventListener("click", () => {
      const i = $f("#" + b.dataset.reveal);
      i.type = i.type === "password" ? "text" : "password";
      b.innerHTML = IC(i.type === "password" ? "eye" : "eye-off");
    }));
    $f("#lv-test").disabled = !k || a.locked;
  };
  $f("#lv-on").addEventListener("click", () => { L.on = !L.on; if (L.on && !L.kind) $f("#lv-kind").focus(); paintLiveForm(); schedule(); });
  $f("#lv-kind").addEventListener("change", e => { L.kind = e.target.value; kindTouched = true; $f("#lv-out").hidden = true; paintLiveForm(); schedule(); });
  $f("#lv-url").addEventListener("input", e => { L.url = e.target.value.trim(); });
  paintLiveForm();

  $f("#lv-test")?.addEventListener("click", async () => {
    const out = $f("#lv-out"), btn = $f("#lv-test");
    out.hidden = false;
    out.className = "ae-testout wait";
    out.innerHTML = `<span class="spin"></span>Asking ${esc(kindOf(L.kind)?.label || "the app")}…`;
    btn.disabled = true;
    try {
      const r = await api("/integrations/test", { method: "POST", body: {
        id: a.id || undefined, kind: L.kind, url: L.url, user: L.user,
        secret: L.secret || undefined, appUrl: a.locked ? undefined : $f("#lf-url").value.trim()
      } });
      if (r.ok) {
        out.className = "ae-testout ok";
        out.innerHTML = `<div class="ae-testh">${IC("check-circle")}<b>Connected</b><span>${r.ms} ms</span></div>
          <div class="ae-testst">${(r.stats || []).slice(0, 4).map(s => `<span><b>${esc(fmtStat(s))}</b>${esc(s.k)}</span>`).join("")}</div>`;
      } else {
        out.className = "ae-testout bad";
        out.innerHTML = `<div class="ae-testh">${IC("x-circle")}<b>${r.auth ? "Signed out" : "Could not read it"}</b></div><p>${esc(r.error || "")}</p>`;
      }
    } catch (e) {
      out.className = "ae-testout bad";
      out.innerHTML = `<div class="ae-testh">${IC("x-circle")}<b>Could not test</b></div><p>${esc(e.message)}</p>`;
    } finally { btn.disabled = !kindOf(L.kind) || a.locked; }
  });

  /* the PIN */
  $f("#lf-lockon")?.addEventListener("click", e => {
    flip(e.currentTarget);
    const onNow = e.currentTarget.getAttribute("aria-checked") === "true";
    $f("#lf-lockbox").hidden = !onNow;
    if (onNow) setTimeout(() => $f("#lf-lock").focus(), 30); else $f("#lf-lock").value = "";
  });
  $f("#lf-lock")?.addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); });

  // A lock anyone can flick open from the settings gear is not a lock. Both
  // taking it off and changing it are proved with the PIN itself.
  $f("#lf-unlock")?.addEventListener("click", () => askForPin({
    title: "Take the PIN off",
    lead: `Type the PIN on "${a.name}" to remove it.`,
    action: "Take it off",
    run: pin => api(`/launcher/${encodeURIComponent(a.id)}/lock`, { method: "DELETE", body: { pin } })
  }, out => {
    LP.apps = out.apps; LP.groups = out.groups;
    closeModal(); paintLauncher();
    toast("PIN removed", "ok");
  }));
  $f("#lf-repin")?.addEventListener("click", () => askForPin({
    title: "Change the PIN",
    lead: `Type the PIN on "${a.name}", then the new one.`,
    action: "Change it",
    second: "New PIN",
    run: (pin, next) => api(`/launcher/${encodeURIComponent(a.id)}/lock`, { method: "POST", body: { current: pin, pin: next } })
  }, out => {
    LP.apps = out.apps; LP.groups = out.groups;
    closeModal(); paintLauncher();
    toast("PIN changed", "ok");
  }));

  $("#lf-del", foot)?.addEventListener("click", () => { closeModal(); removeApps([a]); });
  on($("#lf-cancel", foot), "click", closeModal);

  /* errors: shown on the field, and the tab that holds it is opened */
  const fieldErr = (key, msg, tabId) => {
    const el = $(`[data-err="${key}"]`, form);
    if (el) { el.hidden = !msg; el.textContent = msg || ""; el.closest(".fld")?.classList.toggle("bad", !!msg); }
    if (msg) {
      showTab(tabId);
      $(`.ae-tab[data-tab="${tabId}"] .ae-flag`, form).hidden = false;
    }
    return !msg;
  };
  form.addEventListener("input", e => {
    const f = e.target.closest(".fld.bad");
    if (f) { f.classList.remove("bad"); $(".fld-err", f).hidden = true; }
  });

  const save = async () => {
    $$(".ae-flag", form).forEach(f => { f.hidden = true; });
    const name = $f("#lf-name").value.trim();
    const url = a.locked ? a.url : $f("#lf-url").value.trim();
    const ext = a.locked ? a.externalUrl : $f("#lf-ext").value.trim();
    const okUrl = v => !v || /^https?:\/\/[^\s/]+/i.test(v);
    if (!fieldErr("name", name ? "" : "Give it a name.", "basics")) return $f("#lf-name").focus();
    if (!a.locked && !url && !ext) { fieldErr("url", "Give it an address — local, outside, or both.", "basics"); return $f("#lf-url").focus(); }
    if (!a.locked && (!okUrl(url) || !okUrl(ext))) { fieldErr("url", "Addresses start with http:// or https://", "basics"); return $f("#lf-url").focus(); }
    const pinOn = $f("#lf-lockon")?.getAttribute("aria-checked") === "true";
    const pin = pinOn ? $f("#lf-lock").value.trim() : "";
    if (pinOn && !/^\d{4}$/.test(pin)) { fieldErr("pin", "Four digits.", "access"); return $f("#lf-lock").focus(); }
    if (L.on && !L.kind) { showTab("live"); return toast("Pick which app it is, or turn live data off", "err"); }

    // Ports: what was typed, or the one in the address — the health check and
    // Pull all both match on them, so an empty list is worth filling.
    let ports = $f("#lf-ports").value.split(/[,\s]+/).map(Number).filter(n => n > 0 && n < 65536);
    if (!ports.length && url) { try { const u = new URL(url); if (u.port) ports = [Number(u.port)]; } catch {} }

    const row = {
      ...a, name, url, externalUrl: ext,
      icon: $f("#lf-icon").value.trim(), desc: $f("#lf-desc").value.trim(),
      ports: [...new Set(ports)].slice(0, 12), tags, group: $f("#lf-group").value,
      pinned: $f("#lf-pin").getAttribute("aria-checked") === "true", size,
      live: L.kind ? { kind: L.kind, on: L.on, url: L.url, user: L.user } : undefined
    };
    if (!row.live) delete row.live;
    if (!row.id) row.id = "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

    const btn = $("#lf-save", foot);
    btn.disabled = true;
    try {
      LP.apps = isNew ? [...LP.apps, row] : LP.apps.map(x => x.id === row.id ? row : x);
      // Written now rather than debounced: the key and the PIN below each go
      // on their own request and name an id the server must already have.
      let out = await api("/launcher", { method: "PUT", body: { apps: LP.apps, groups: LP.groups } });
      const liveChanged = JSON.stringify(live0 ? { kind: live0.kind, on: live0.on !== false, url: live0.url || "", user: live0.user || "" } : null)
                       !== JSON.stringify(row.live ? row.live : null);
      if (liveChanged || L.secret !== undefined) {
        const body = row.live ? { ...row.live } : { kind: "" };
        if (L.secret !== undefined) body.secret = L.secret;
        out = await api(`/launcher/${encodeURIComponent(row.id)}/live`, { method: "PUT", body });
      }
      if (pin) out = await api(`/launcher/${encodeURIComponent(row.id)}/lock`, { method: "POST", body: { pin } });
      LP.apps = out.apps; LP.groups = out.groups;
      delete LV.data[row.id];
    } catch (e) {
      btn.disabled = false;
      return toast(e.message || "Could not save", "err");
    }
    closeModal();
    paintLauncher();
    pollLive();
    toast(isNew ? `${name} added` : `${name} saved`, "ok");
  };
  on($("#lf-save", foot), "click", save);
  form.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });

  paintTags();
  paintPreview();
  setTimeout(() => {
    const first = tab === "basics" ? (isNew ? $f("#lf-name") : null) : tab === "live" ? $f("#lv-kind") : null;
    first?.focus();
  }, 60);
}

on("#l-add", "click", () => editApp(null));

/* ---- Pull All ----
 * Reads what is running and offers anything not already on the board. It
 * proposes; you tick. Nothing you have set up by hand is touched or
 * overwritten — the server leaves out anything whose name or published port
 * already appears here, so the worst case is that it finds nothing.
 */
async function pullApps() {
  let out;
  try { out = await api("/launcher/discover"); }
  catch (e) { return toast(e.message || "could not look", "err"); }

  if (!out.available) {
    return openModal({ title: "Pull all", icon: "/assets/brand/icons/ui-launcher.png",
      body: `<p class="hint">Docker is not available on this host, so there is nothing to read.<br>
             ${esc(out.reason || "")}</p>` });
  }
  if (!out.found.length) {
    return openModal({ title: "Pull all", icon: "/assets/brand/icons/ui-launcher.png",
      body: `<p class="hint">Nothing new. Every container with a published port is already on the
             board, or has no port to link to.</p>` });
  }

  const host = location.hostname;
  const body = document.createElement("div");
  body.innerHTML = `
    <p class="hint">Found ${out.found.length} running container${out.found.length === 1 ? "" : "s"} not on
      the board yet. Addresses are built from <code>${esc(host)}</code>, which is how you reached Nexus,
      so it is a route that works. Untick anything you do not want.</p>
    ${LP.groups.length ? `<div class="ag-row"><label for="lp-group">Put them in</label>
      <select id="lp-group"><option value="">No group</option>
        ${LP.groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("")}</select></div>` : ""}
    <div class="lpull">${out.found.map((f, i) => `
      <label class="lpullrow">
        <input type="checkbox" data-pick="${i}" checked>
        <span class="lico sm">${appIconHTML({ name: f.name, icon: f.slug })}</span>
        <span class="lpullmain"><b>${esc(f.name)}</b>
          <span>http://${esc(host)}:${f.ports[0]}${f.ports.length > 1 ? ` · also ${f.ports.slice(1).map(p => ":" + p).join(" ")}` : ""}</span></span>
        <span class="lpullstate ${f.state === "running" ? "up" : ""}">${esc(f.state)}</span>
      </label>`).join("")}</div>`;
  wireIcons(body);

  openModal({
    title: "Pull all", icon: "/assets/brand/icons/ui-launcher.png", body,
    foot: `<span class="hint">Nothing already on the board is changed.</span><span class="spacer"></span>
           <button class="btn primary sm" id="lp-add" type="button">Add ticked</button>`
  });

  on("#lp-add", "click", () => {
    const picked = $$("[data-pick]", body).filter(b => b.checked).map(b => out.found[Number(b.dataset.pick)]);
    if (!picked.length) { closeModal(); return; }
    const group = $("#lp-group", body)?.value || "";
    for (const f of picked) {
      LP.apps.push({
        id: "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        name: f.name, url: `http://${host}:${f.ports[0]}`, externalUrl: "",
        icon: f.slug, desc: "", ports: f.ports, tags: [], group, pinned: false, size: "m"
      });
    }
    closeModal(); paintLauncher(); saveLauncher();
    toast(`${picked.length} APP${picked.length === 1 ? "" : "S"} ADDED`, "ok");
  });
}

on("#l-pull", "click", pullApps);

/* ============================ file manager ============================
 * Places on the left (your drives), the folder in the middle — as a list
 * with sortable columns or as a grid with picture thumbnails — and a details
 * pane on the right that previews what you select. Everything works from the
 * keyboard too: arrows, Enter, Backspace, F2, Delete, Ctrl+A/C/X/V.
 */
let curDir = null, curParent = null, curEntries = [], curTotal = 0, curTruncated = false;

/**
 * File selection, by path. Paths rather than elements, so a selection survives
 * the listing being redrawn. Cleared on navigation — carrying it across folders
 * would let Delete hit something no longer on screen.
 */
let fileSel = new Set();
let fileAnchor = null;

/** The clipboard holds paths; the server re-resolves and re-jails them at paste time. */
const fileClip = { paths: [], move: false, from: null };
const fileHistory = [], fileForward = [];

/* View preferences of this browser: list or grid, sort, the details pane. */
const FV = (() => {
  const d = { view: "list", sort: "name", dir: 1, pane: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem("nexus.files") || "{}") }; } catch { return d; }
})();
const saveFv = () => { try { localStorage.setItem("nexus.files", JSON.stringify(FV)); } catch {} };
let fileFilter = "", fileSearch = null;      // fileSearch: { q, results, stopped } while showing search results

const fileRows = () => $$("#f-list [data-path]");

function markFileSel() {
  fileRows().forEach(el => {
    const on = fileSel.has(el.dataset.path);
    el.classList.toggle("sel", on);
    el.setAttribute("aria-selected", String(on));
  });
  const bar = $("#f-selbar");
  if (bar) {
    bar.hidden = fileSel.size < 1;
    const c = $("#f-selcount");
    const chosen = selectedEntries();
    const size = chosen.filter(e => !e.dir).reduce((a, e) => a + (e.size || 0), 0);
    if (c) c.innerHTML = `<b>${fileSel.size}</b> selected${size ? ` · ${bytes(size)}` : ""}`;
    const one = chosen.length === 1 ? chosen[0] : null;
    $$("#f-selbar [data-fa]").forEach(b => {
      const a = b.dataset.fa;
      b.hidden = (a === "open" && !one) || (a === "rename" && !one) || (a === "download" && !chosen.some(e => !e.dir));
    });
    const open = $('#f-selbar [data-fa="open"] span');
    if (open && one) open.textContent = one.dir ? "Open" : one.text ? "Edit" : "View";
  }
  paintFileStatus();
  paintPane();
}
function clearFileSelection() { if (fileSel.size) { fileSel.clear(); fileAnchor = null; markFileSel(); } }
const selectedEntries = () => shownEntries().filter(e => fileSel.has(e.path));

/* ---- what each file is ---- */
const FILE_KINDS = [
  { re: /\.(png|jpe?g|gif|webp|bmp|ico|avif|heic|svg|tiff?)$/i, k: "img",  ic: "image",    label: "Image" },
  { re: /\.(mp4|mkv|avi|mov|webm|m4v|wmv|ts)$/i,                 k: "vid",  ic: "play",     label: "Video" },
  { re: /\.(mp3|flac|wav|ogg|m4a|aac|opus)$/i,                   k: "snd",  ic: "activity", label: "Audio" },
  { re: /\.(zip|tar|gz|xz|bz2|7z|rar|tgz|zst)$/i,                k: "arc",  ic: "box",      label: "Archive" },
  { re: /\.pdf$/i,                                               k: "pdf",  ic: "file",     label: "PDF" },
  { re: /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|sh|bash|php|css|html?)$/i, k: "code", ic: "code", label: "Code" },
  { re: /\.(json|ya?ml|toml|ini|conf|cfg|env|properties|service|xml)$/i, k: "cfg", ic: "settings", label: "Config" },
  { re: /\.(txt|md|markdown|rst|log|csv|tsv)$/i,                 k: "doc",  ic: "file",     label: "Text" },
  { re: /\.(iso|img|qcow2|vmdk)$/i,                              k: "disk", ic: "drive",    label: "Disk image" },
  { re: /\.(srt|ass|sub|vtt|nfo)$/i,                             k: "doc",  ic: "file",     label: "Subtitles" }
];
function fileKind(en) {
  if (en.dir) return { k: "dir", ic: "folder", label: "Folder" };
  for (const k of FILE_KINDS) if (k.re.test(en.name)) return k;
  const ext = en.name.includes(".") ? en.name.split(".").pop().toUpperCase().slice(0, 6) : "";
  return { k: "bin", ic: "file", label: ext ? `${ext} file` : "File" };
}
const fileUrl = (p, inline = false) => "/api/files/download?path=" + encodeURIComponent(p) + (inline ? "&inline=1" : "");
const canThumb = en => !en.dir && /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(en.name) && (en.size || 0) < 25 * 1048576;
function fileWhen(ms) {
  if (!ms) return "—";
  const age = Date.now() - ms;
  if (age < 7 * 86400e3) return since(ms);
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
const fileExact = ms => ms ? `${fmtDate(new Date(ms))}, ${fmtTime(new Date(ms), false, false)}` : "";

/* ---- places (the configured roots) ---- */
let ROOTS = [];

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
    const lv = pct >= 92 ? "crit" : pct >= 80 ? "warn" : "";
    return `<div class="fx-place${r.exists ? "" : " missing"}" data-root="${esc(r.path)}" draggable="true" tabindex="0" role="button"
        aria-label="${esc(r.name)} — ${esc(r.path)}" data-tip="${esc(r.path)}${known ? ` · ${bytes(r.available)} free of ${bytes(r.used + r.available)}` : ""}">
      <span class="fx-pico">${IC("drive")}</span>
      <span class="fx-pt"><b>${esc(r.note || r.name)}</b><span>${esc(r.path)}</span>
        ${known ? `<span class="fx-pbar ${lv}"><i style="width:${pct.toFixed(1)}%"></i></span><em>${bytes(r.available)} free</em>`
                : `<em>${r.exists ? "size unknown" : "not mounted"}</em>`}</span>
    </div>`;
  }).join("") || `<p class="fx-quiet">No folders are configured. Set <code>fileRoots</code> in /etc/nexus/config.json.</p>`;
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
    e.preventDefault(); e.stopPropagation();
    openRootMenu(e.clientX, e.clientY, ROOTS.find(r => r.path === c.dataset.root));
  });
  // Drag a place to reorder. HTML5 drag-and-drop, which file rows also use;
  // a place being dragged carries no file paths, so the two never mix.
  let dragPath = null;
  bar.addEventListener("dragstart", e => {
    const c = e.target.closest("[data-root]");
    if (!c || fileDrag.paths.length) return;
    dragPath = c.dataset.root;
    c.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", dragPath); } catch {}
  });
  bar.addEventListener("dragend", () => { dragPath = null; $$("#f-roots .fx-place").forEach(c => c.classList.remove("dragging", "dropbefore")); });
  bar.addEventListener("dragover", e => {
    if (!dragPath) return;
    e.preventDefault();
    const c = e.target.closest("[data-root]");
    $$("#f-roots .fx-place").forEach(x => x.classList.remove("dropbefore"));
    if (c && c.dataset.root !== dragPath) c.classList.add("dropbefore");
  });
  bar.addEventListener("drop", async e => {
    if (!dragPath) return;
    e.preventDefault();
    const c = e.target.closest("[data-root]");
    $$("#f-roots .fx-place").forEach(x => x.classList.remove("dropbefore"));
    if (!c || c.dataset.root === dragPath) return;
    const from = ROOTS.findIndex(r => r.path === dragPath), to = ROOTS.findIndex(r => r.path === c.dataset.root);
    if (from < 0 || to < 0) return;
    ROOTS.splice(to, 0, ROOTS.splice(from, 1)[0]);
    renderRoots();
    await saveRootPrefs();
  });
}

async function saveRootPrefs() {
  const prefs = {};
  ROOTS.forEach((r, i) => { prefs[r.path] = { note: r.note || "", order: i }; });
  try { await api("/files/roots/prefs", { method: "PUT", body: { prefs } }); }
  catch (e) { toast(e.message, "err"); }
}

function openRootMenu(x, y, root) {
  if (!root) return;
  ctxMenu(x, y, root.note || root.name, [
    { label: "Open", icon: "folder", go: () => loadFiles(root.path) },
    { label: root.note ? "Rename the label" : "Give it a label", icon: "tag", go: () => editRootNote(root) },
    ...(root.note ? [{ label: "Remove the label", icon: "x", go: () => setRootNote(root, "") }] : []),
    ...(fileClip.paths.length ? [{ label: `Paste ${fileClip.paths.length} here`, icon: "copy", go: () => pasteInto(root.path) }] : [])
  ], "A label is for you — it does not rename anything on disk.");
}

async function editRootNote(root) {
  const v = await askText({ title: "Label this place", label: `A name for ${root.path}`, value: root.note || "", placeholder: "Films and TV", hint: "Shown instead of the folder name. Nothing on disk changes." });
  if (v == null) return;
  setRootNote(root, v.trim().slice(0, 120));
}
async function setRootNote(root, note) { root.note = note; renderRoots(); await saveRootPrefs(); }

/* Compared with one kind of slash: a root written C:/x in config and a path
   reported back as C:\x\y are the same place. */
const normP = p => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "") || "/";
const isUnder = (p, r) => { const a = normP(p), b = normP(r); return a === b || a.startsWith(b === "/" ? "/" : b + "/"); };
function markActiveRoot(p) {
  const cards = $$("#f-roots .fx-place");
  const under = r => isUnder(p, r);
  let best = null;
  cards.forEach(b => { const r = b.dataset.root; if (under(r) && (!best || r.length > best.length)) best = r; });
  cards.forEach(b => b.classList.toggle("on", b.dataset.root === best));
}
const rootOf = p => ROOTS.filter(r => isUnder(p, r.path)).sort((a, b) => b.path.length - a.path.length)[0];

/* ---- a small menu, for right-clicks ---- */
function ctxMenu(x, y, title, items, note) {
  $$(".fx-menu").forEach(m => m.remove());
  const m = document.createElement("div");
  m.className = "fx-menu";
  m.setAttribute("role", "menu");
  m.innerHTML = (title ? `<div class="fx-mh">${esc(title)}</div>` : "") + items.map((it, i) => it === "-" ? `<hr>` :
    `<button type="button" role="menuitem" data-mi="${i}" class="${it.danger ? "danger" : ""}"${it.disabled ? " disabled" : ""}>
      ${IC(it.icon || "chevron-right")}<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ""}</button>`).join("") +
    (note ? `<p class="fx-mnote">${esc(note)}</p>` : "");
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
  m.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
  const close = () => { m.remove(); removeEventListener("pointerdown", away, true); removeEventListener("keydown", key, true); };
  const away = ev => { if (!m.contains(ev.target)) close(); };
  const key = ev => {
    if (ev.key === "Escape") { ev.stopPropagation(); close(); }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const bs = $$("button:not([disabled])", m), i = bs.indexOf(document.activeElement);
      bs[(i + (ev.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length]?.focus();
    }
  };
  m.addEventListener("click", ev => {
    const b = ev.target.closest("[data-mi]");
    if (!b) return;
    close();
    items[Number(b.dataset.mi)]?.go?.();
  });
  setTimeout(() => { addEventListener("pointerdown", away, true); addEventListener("keydown", key, true); }, 0);
}

/** A one-field dialog, in place of prompt(). Resolves to the text, or null. */
function askText({ title, label, value = "", placeholder = "", hint = "", action = "Save", select = null }) {
  return new Promise(resolve => {
    const body = document.createElement("div");
    body.className = "fx-ask";
    body.innerHTML = `<label for="fx-ask">${esc(label)}</label>
      <input id="fx-ask" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ""}<p class="fx-askerr" hidden></p>`;
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); };
    openModal({ title, icon: ICON("files"), body,
      foot: `<span class="spacer"></span><button class="btn sm" id="fx-cancel" type="button">Cancel</button><button class="btn primary sm" id="fx-ok" type="button">${esc(action)}</button>`,
      onClose: () => finish(null) });
    const input = $("#fx-ask", body);
    setTimeout(() => { input.focus(); if (select) input.setSelectionRange(select[0], select[1]); else input.select(); }, 50);
    const ok = () => { const v = input.value; done = true; closeModal(); resolve(v); };
    on("#fx-ok", "click", ok);
    on("#fx-cancel", "click", () => closeModal());
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); ok(); } });
  });
}

/* ---- loading a folder ---- */
async function loadFiles(dir, { history = true, keepSel = false } = {}) {
  const list = $("#f-list");
  if (!list) return;
  if (!curEntries.length) list.innerHTML = `<div class="fx-loading">${Array.from({ length: 6 }, () => "<i></i>").join("")}</div>`;
  try {
    const out = await api("/files" + (dir ? "?path=" + encodeURIComponent(dir) : ""));
    if (history && curDir && curDir !== out.path) {
      fileHistory.push(curDir);
      if (fileHistory.length > 60) fileHistory.shift();
      fileForward.length = 0;
    }
    const moved = curDir !== out.path;
    curDir = out.path; curParent = out.parent;
    curEntries = out.entries; curTotal = out.total; curTruncated = out.truncated;
    if (moved) { fileSearch = null; fileFilter = ""; const q = $("#f-q"); if (q) q.value = ""; }
    if (!keepSel || moved) { fileSel.clear(); fileAnchor = null; }
    renderCrumbs(out.path);
    markActiveRoot(out.path);
    paintNav();
    renderFileList();
    if (moved) $("#f-wrap")?.scrollTo({ top: 0 });
  } catch (e) {
    list.innerHTML = `<div class="fx-empty"><span class="fx-eico">${IC("alert")}</span><b>Could not open this folder</b><p>${esc(e.message)}</p></div>`;
  }
}

/** What is on screen: the folder, or the search results, filtered and sorted. */
function shownEntries() {
  let list = fileSearch ? fileSearch.results : curEntries;
  const q = fileFilter.trim().toLowerCase();
  if (q && !fileSearch) list = list.filter(e => e.name.toLowerCase().includes(q));
  const dir = FV.dir;
  const by = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    size: (a, b) => (a.size || 0) - (b.size || 0),
    mtime: (a, b) => (a.mtime || 0) - (b.mtime || 0),
    kind: (a, b) => fileKind(a).label.localeCompare(fileKind(b).label) || a.name.localeCompare(b.name)
  }[FV.sort] || ((a, b) => a.name.localeCompare(b.name));
  return list.slice().sort((a, b) => (b.dir - a.dir) || by(a, b) * dir);
}

function fileItemHTML(en) {
  const k = fileKind(en);
  const cut = fileClip.move && fileClip.paths.includes(en.path);
  const attrs = `data-path="${esc(en.path)}" data-dir="${en.dir ? 1 : 0}" data-text="${en.text ? 1 : 0}" data-name="${esc(en.name)}"
    draggable="true" role="option" aria-selected="${fileSel.has(en.path)}" tabindex="-1"`;
  const cls = `${fileSel.has(en.path) ? " sel" : ""}${cut ? " cut" : ""}${en.error ? " err" : ""}`;
  const where = fileSearch ? `<span class="fr-where">${esc(en.path.slice(0, en.path.length - en.name.length - 1).replace(fileSearch.base, "") || "/")}</span>` : "";
  if (FV.view === "grid") {
    const thumb = canThumb(en)
      ? `<img class="fg-img" loading="lazy" decoding="async" alt="" src="${esc(fileUrl(en.path, true))}" data-onfail="hide">`
      : `<span class="fk k-${k.k} big">${IC(k.ic)}</span>`;
    return `<div class="fg${cls}" ${attrs} title="${esc(en.name)}">
      <span class="fg-thumb">${thumb}${en.symlink ? `<span class="fx-link">${IC("link")}</span>` : ""}</span>
      <span class="fg-name">${esc(en.name)}</span>
      <span class="fg-meta">${en.dir ? "Folder" : bytes(en.size)}</span>${where}</div>`;
  }
  return `<div class="fr${cls}" ${attrs}>
    <span class="fr-name"><span class="fk k-${k.k}">${IC(k.ic)}</span>
      <span class="fr-n"><span class="fr-t">${esc(en.name)}</span>${where}</span>${en.symlink ? `<span class="fx-link" data-tip="A link">${IC("link")}</span>` : ""}</span>
    <span class="fr-size">${en.dir ? "" : bytes(en.size)}</span>
    <span class="fr-mod" data-tip="${esc(fileExact(en.mtime))}">${fileWhen(en.mtime)}</span>
    <span class="fr-kind">${esc(k.label)}</span>
  </div>`;
}

function renderFileList() {
  const list = $("#f-list");
  if (!list) return;
  const entries = shownEntries();
  list.className = "fx-list " + FV.view;
  $("#f-head").hidden = FV.view !== "list";
  $$("#f-head [data-sort]").forEach(h => {
    const on = h.dataset.sort === FV.sort;
    h.classList.toggle("on", on);
    h.setAttribute("aria-sort", on ? (FV.dir > 0 ? "ascending" : "descending") : "none");
  });
  $$("#f-view [data-fv]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.fv === FV.view)));

  if (!entries.length) {
    list.innerHTML = fileSearch
      ? `<div class="fx-empty"><span class="fx-eico">${IC("search")}</span><b>Nothing called “${esc(fileSearch.q)}” here</b><p>Searched ${fileSearch.visited.toLocaleString()} folders under this one.</p></div>`
      : fileFilter
      ? `<div class="fx-empty"><span class="fx-eico">${IC("search")}</span><b>Nothing matches</b><p><button type="button" class="linkbtn" data-fsearch>Search the subfolders for “${esc(fileFilter)}”</button></p></div>`
      : `<div class="fx-empty"><span class="fx-eico">${IC("folder")}</span><b>This folder is empty</b><p>Drop files here to upload them, or make a <button type="button" class="linkbtn" data-fnew>new folder</button>.</p></div>`;
  } else {
    list.innerHTML = (fileSearch ? `<div class="fx-searchhead">${IC("search")}<span>${fileSearch.results.length}${fileSearch.stopped ? "+" : ""} results for <b>“${esc(fileSearch.q)}”</b> under this folder${fileSearch.stopped ? " — stopped early, narrow it down for the rest" : ""}</span>
        <button type="button" class="btn sm" data-fsearchclose>Back to the folder</button></div>` : "") +
      entries.map(fileItemHTML).join("") +
      (curTruncated && !fileSearch ? `<div class="fx-more">Showing ${curEntries.length.toLocaleString()} of ${curTotal.toLocaleString()} — open a subfolder or filter to narrow it down.</div>` : "");
  }
  wireIcons(list);
  markFileSel();
}

/* ---- the path bar ---- */
function renderCrumbs(p) {
  const sep = p.includes("\\") ? "\\" : "/";
  const root = rootOf(p);
  const crumbs = [];
  if (root) {
    crumbs.push({ path: root.path, label: root.note || root.name, root: true });
    const rest = normP(p).slice(normP(root.path).length).split("/").filter(Boolean);
    let acc = root.path.replace(/[\\/]+$/, "");
    for (const seg of rest) { acc = acc.endsWith(sep) ? acc + seg : acc + sep + seg; crumbs.push({ path: acc, label: seg }); }
  } else crumbs.push({ path: p, label: p });
  // A deep path keeps its first and last two crumbs; the middle folds into "…".
  const folded = crumbs.length > 5 ? [crumbs[0], { more: crumbs.slice(1, -2) }, ...crumbs.slice(-2)] : crumbs;
  $("#f-crumbs").innerHTML = folded.map((c, i) => (i ? `<span class="fx-sep">${IC("chevron-right")}</span>` : "") +
    (c.more ? `<button type="button" class="fx-crumb more" data-crumbmore="${esc(JSON.stringify(c.more.map(x => x.path)))}" aria-label="More folders">…</button>`
            : `<button type="button" class="fx-crumb${i === folded.length - 1 ? " cur" : ""}" data-fpath="${esc(c.path)}">${c.root ? IC("drive") : ""}<span>${esc(c.label)}</span></button>`)).join("");
}
on("#f-crumbs", "click", e => {
  const m = e.target.closest("[data-crumbmore]");
  if (m) {
    const paths = JSON.parse(m.dataset.crumbmore);
    const r = m.getBoundingClientRect();
    return ctxMenu(r.left, r.bottom + 6, null, paths.map(p => ({ label: p.split(/[\\/]/).pop(), icon: "folder", go: () => loadFiles(p) })));
  }
  const b = e.target.closest("[data-fpath]");
  if (b) { e.stopPropagation(); loadFiles(b.dataset.fpath); }
});

/* ---- selecting ---- */
on("#f-list", "click", e => {
  if (e.target.closest("[data-fnew]")) return makeFolder();
  if (e.target.closest("[data-fsearch]")) return runFileSearch(fileFilter);
  if (e.target.closest("[data-fsearchclose]")) { fileSearch = null; fileFilter = ""; $("#f-q").value = ""; return renderFileList(); }
  const row = e.target.closest("[data-path]");
  if (!row) { clearFileSelection(); return; }
  const p = row.dataset.path;
  const order = fileRows().map(r => r.dataset.path);
  if (e.shiftKey && fileAnchor) {
    const a = order.indexOf(fileAnchor), b = order.indexOf(p);
    if (a >= 0 && b >= 0) {
      if (!(e.ctrlKey || e.metaKey)) fileSel.clear();
      order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => fileSel.add(x));
    }
  } else if (e.ctrlKey || e.metaKey) {
    fileSel.has(p) ? fileSel.delete(p) : fileSel.add(p);
    fileAnchor = p;
  } else {
    fileSel = new Set([p]);
    fileAnchor = p;
  }
  row.focus({ preventScroll: true });
  markFileSel();
});
on("#f-list", "dblclick", e => {
  const row = e.target.closest("[data-path]");
  if (row) openEntry(entryOf(row.dataset.path));
});
const entryOf = p => shownEntries().find(e => e.path === p) || curEntries.find(e => e.path === p);

/** Open: a folder navigates, text opens the editor, media previews, the rest downloads. */
function openEntry(en) {
  if (!en) return;
  if (en.dir) return loadFiles(en.path);
  const k = fileKind(en).k;
  if (en.text) return openEditor(en.path, en.name);
  if (["img", "vid", "snd", "pdf"].includes(k)) return openViewer(en);
  location.href = fileUrl(en.path);
}

/* ---- sorting, viewing, filtering, searching ---- */
on("#f-head", "click", e => {
  const h = e.target.closest("[data-sort]");
  if (!h) return;
  if (FV.sort === h.dataset.sort) FV.dir = -FV.dir; else { FV.sort = h.dataset.sort; FV.dir = h.dataset.sort === "mtime" || h.dataset.sort === "size" ? -1 : 1; }
  saveFv(); renderFileList();
});
on("#f-view", "click", e => {
  const b = e.target.closest("[data-fv]");
  if (!b) return;
  FV.view = b.dataset.fv; saveFv(); renderFileList();
});
on("#f-info", "click", () => { FV.pane = !FV.pane; saveFv(); paintPane(); });
let filterTimer = 0;
on("#f-q", "input", e => {
  fileFilter = e.target.value;
  if (fileSearch && !fileFilter.trim()) fileSearch = null;
  clearTimeout(filterTimer);
  filterTimer = setTimeout(renderFileList, 60);
});
on("#f-q", "keydown", e => {
  if (e.key === "Enter" && fileFilter.trim().length >= 2) { e.preventDefault(); runFileSearch(fileFilter); }
  if (e.key === "Escape") { e.target.value = ""; fileFilter = ""; fileSearch = null; renderFileList(); e.target.blur(); }
});
async function runFileSearch(q) {
  if (!curDir || String(q).trim().length < 2) return;
  const list = $("#f-list");
  list.innerHTML = `<div class="fx-empty"><span class="fx-eico spin">${IC("refresh")}</span><b>Searching under ${esc(curDir)}…</b></div>`;
  try {
    const out = await api(`/files/search?path=${encodeURIComponent(curDir)}&q=${encodeURIComponent(q.trim())}`);
    fileSearch = { q: out.q, results: out.results, stopped: out.stopped, visited: out.visited, base: curDir };
    fileSel.clear();
  } catch (e) { toast(e.message, "err"); fileSearch = null; }
  renderFileList();
}

/* ---- navigating ---- */
function paintNav() {
  const set = (id, off) => { const b = $(id); if (b) b.disabled = off; };
  set("#f-back", !fileHistory.length);
  set("#f-fwd", !fileForward.length);
  set("#f-up", !curParent);
}
on("#f-back", "click", () => {
  const prev = fileHistory.pop();
  if (!prev) return;
  if (curDir) fileForward.push(curDir);
  loadFiles(prev, { history: false });
});
on("#f-fwd", "click", () => {
  const next = fileForward.pop();
  if (!next) return;
  if (curDir) fileHistory.push(curDir);
  loadFiles(next, { history: false });
});
on("#f-up", "click", () => { if (curParent) loadFiles(curParent); });
on("#f-reload", "click", () => { loadFiles(curDir, { history: false, keepSel: true }); loadRoots(true); });

/* ---- the details pane ---- */
let paneSig = "";
function paintPane() {
  const pane = $("#f-pane"), btn = $("#f-info");
  if (!pane) return;
  btn?.setAttribute("aria-pressed", String(FV.pane));
  $("#page-files")?.classList.toggle("with-pane", FV.pane);
  pane.hidden = !FV.pane;
  if (!FV.pane) return;
  const chosen = selectedEntries();
  let html;
  if (chosen.length === 1) {
    const en = chosen[0], k = fileKind(en);
    let preview = `<span class="fk k-${k.k} huge">${IC(k.ic)}</span>`;
    if (k.k === "img" && canThumb(en)) preview = `<img class="fp-img" alt="" src="${esc(fileUrl(en.path, true))}" data-onfail="hide">`;
    else if (k.k === "vid") preview = `<video class="fp-vid" controls preload="metadata" src="${esc(fileUrl(en.path, true))}"></video>`;
    else if (k.k === "snd") preview = `<div class="fp-snd"><span class="fk k-snd huge">${IC(k.ic)}</span><audio controls preload="none" src="${esc(fileUrl(en.path, true))}"></audio></div>`;
    else if (en.text && (en.size || 0) < 400000) preview = `<pre class="fp-text" id="fp-text">Reading…</pre>`;
    const rows = [["Kind", k.label], ...(en.dir ? [] : [["Size", `${bytes(en.size)}${en.size >= 1024 ? ` <small>(${Number(en.size).toLocaleString()} bytes)</small>` : ""}`]]),
      ["Modified", fileExact(en.mtime)], ["Permissions", en.mode ? `<code>${en.mode.toString(8).padStart(3, "0")}</code>` : "—"],
      ["Where", `<code>${esc(en.path.slice(0, en.path.length - en.name.length))}</code>`]];
    html = `<div class="fp-prev">${preview}</div>
      <div class="fp-name">${esc(en.name)}${en.symlink ? `<span class="cbadge">link</span>` : ""}</div>
      <dl class="fp-dl">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>
      <div class="fp-acts">
        <button class="btn sm primary" data-fa="open">${IC(en.dir ? "folder" : en.text ? "edit" : "eye")}${en.dir ? "Open" : en.text ? "Edit" : "View"}</button>
        ${en.dir ? "" : `<button class="btn sm" data-fa="download">${IC("arrow-down")}Download</button>`}
        <button class="btn sm" data-fa="rename">${IC("edit")}Rename</button>
        <button class="btn sm" data-fa="copypath">${IC("copy")}Copy path</button>
        <button class="btn sm danger ghost" data-fa="delete">${IC("trash")}Delete</button>
      </div>`;
  } else if (chosen.length > 1) {
    const files = chosen.filter(e => !e.dir), dirs = chosen.length - files.length;
    html = `<div class="fp-prev multi">${chosen.slice(0, 3).map(e => `<span class="fk k-${fileKind(e).k} big">${IC(fileKind(e).ic)}</span>`).join("")}</div>
      <div class="fp-name">${chosen.length} items</div>
      <dl class="fp-dl"><dt>Files</dt><dd>${files.length}${files.length ? ` · ${bytes(files.reduce((a, e) => a + (e.size || 0), 0))}` : ""}</dd><dt>Folders</dt><dd>${dirs}</dd></dl>
      <div class="fp-acts"><button class="btn sm" data-fa="copy">${IC("copy")}Copy</button><button class="btn sm" data-fa="cut">Cut</button>
        <button class="btn sm" data-fa="move">${IC("folder")}Move to…</button>${files.length ? `<button class="btn sm" data-fa="download">${IC("arrow-down")}Download</button>` : ""}
        <button class="btn sm danger ghost" data-fa="delete">${IC("trash")}Delete</button></div>`;
  } else {
    const r = curDir ? rootOf(curDir) : null;
    const files = curEntries.filter(e => !e.dir);
    html = `<div class="fp-prev"><span class="fk k-dir huge">${IC("folder")}</span></div>
      <div class="fp-name">${esc(curDir ? (curDir.split(/[\\/]/).filter(Boolean).pop() || curDir) : "")}</div>
      <dl class="fp-dl"><dt>Items</dt><dd>${curTotal.toLocaleString()}</dd><dt>Folders</dt><dd>${curEntries.length - files.length}</dd>
        <dt>Files</dt><dd>${files.length} · ${bytes(files.reduce((a, e) => a + (e.size || 0), 0))}</dd>
        ${r && r.size ? `<dt>Free on ${esc(r.note || r.name)}</dt><dd>${bytes(r.available)} of ${bytes(r.used + r.available)}</dd>` : ""}</dl>
      <p class="fx-tip">Select something to see it here. Double-click opens; drag onto a folder or a place to move (hold Ctrl to copy).</p>`;
  }
  const sig = html;
  if (sig === paneSig) return;
  paneSig = sig;
  $("#f-pane-body").innerHTML = html;
  wireIcons(pane);
  const t = $("#fp-text");
  if (t && chosen[0]) {
    const p = chosen[0].path;
    api("/files/read?path=" + encodeURIComponent(p)).then(f => {
      if (selectedEntries()[0]?.path !== p) return;
      const lines = f.content.split("\n");
      t.textContent = lines.slice(0, 160).join("\n") + (lines.length > 160 ? `\n… ${lines.length - 160} more lines` : "");
    }).catch(err => { t.textContent = err.message; });
  }
}

function paintFileStatus() {
  const el = $("#f-status");
  if (!el) return;
  const shown = shownEntries();
  const dirs = shown.filter(e => e.dir).length;
  const size = shown.filter(e => !e.dir).reduce((a, e) => a + (e.size || 0), 0);
  el.innerHTML = `<span>${shown.length.toLocaleString()} item${shown.length === 1 ? "" : "s"}${dirs ? ` · ${dirs} folder${dirs === 1 ? "" : "s"}` : ""}${size ? ` · ${bytes(size)}` : ""}</span>
    ${fileSel.size ? `<span>${fileSel.size} selected</span>` : ""}
    <span class="fx-keys"><kbd>Enter</kbd> open <kbd>F2</kbd> rename <kbd>Del</kbd> delete <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd></span>`;
}

/* ---- the selection bar and the pane's buttons ---- */
function fileAction(a) {
  const chosen = selectedEntries(), one = chosen.length === 1 ? chosen[0] : null;
  if (a === "open" && one) return openEntry(one);
  if (a === "rename" && one) return renameEntry(one);
  if (a === "copy") return clipTake(false);
  if (a === "cut") return clipTake(true);
  if (a === "move") return moveDialog(chosen.map(e => e.path));
  if (a === "download") return downloadFileSelection();
  if (a === "delete") return deleteFileSelection();
  if (a === "clear") return clearFileSelection();
  if (a === "copypath" && one) return copyText(one.path);
}
on("#f-selbar", "click", e => { const b = e.target.closest("[data-fa]"); if (b) fileAction(b.dataset.fa); });
on("#f-pane", "click", e => { const b = e.target.closest("[data-fa]"); if (b) fileAction(b.dataset.fa); });
on("#f-mkdir", "click", () => makeFolder());

/* ---- the keyboard ---- */
addEventListener("keydown", e => {
  if (curPage !== "files" || typingInto(document.activeElement) || $("#modal").classList.contains("open") || $(".fx-menu")) return;
  const rows = fileRows();
  const order = rows.map(r => r.dataset.path);
  const cur = order.indexOf(fileAnchor);
  const grid = FV.view === "grid";
  const cols = grid && rows[0] ? Math.max(1, Math.round($("#f-list").clientWidth / rows[0].getBoundingClientRect().width)) : 1;
  const moveTo = i => {
    i = clamp(i, 0, order.length - 1);
    const p = order[i];
    if (!p) return;
    if (e.shiftKey && fileAnchor) fileSel.add(p); else fileSel = new Set([p]);
    fileAnchor = p;
    markFileSel();
    rows[i].scrollIntoView({ block: "nearest" });
    rows[i].focus({ preventScroll: true });
  };
  const k = e.key;
  if (k === "ArrowDown") { e.preventDefault(); return moveTo(cur < 0 ? 0 : cur + cols); }
  if (k === "ArrowUp") { e.preventDefault(); return moveTo(cur < 0 ? 0 : cur - cols); }
  if (grid && k === "ArrowRight") { e.preventDefault(); return moveTo(cur + 1); }
  if (grid && k === "ArrowLeft") { e.preventDefault(); return moveTo(cur - 1); }
  if (k === "Home") { e.preventDefault(); return moveTo(0); }
  if (k === "End") { e.preventDefault(); return moveTo(order.length - 1); }
  if (k === "Enter" && fileSel.size === 1) { e.preventDefault(); return openEntry(selectedEntries()[0]); }
  if (k === "Backspace" || (k === "ArrowUp" && e.altKey)) { e.preventDefault(); return curParent && loadFiles(curParent); }
  if (k === "ArrowLeft" && e.altKey) { e.preventDefault(); return $("#f-back").click(); }
  if (k === "ArrowRight" && e.altKey) { e.preventDefault(); return $("#f-fwd").click(); }
  if (k === "F2" && fileSel.size === 1) { e.preventDefault(); return renameEntry(selectedEntries()[0]); }
  if (k === "F5") { e.preventDefault(); return $("#f-reload").click(); }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "a") { e.preventDefault(); return selectAllFiles(); }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "f") { e.preventDefault(); return $("#f-q")?.focus(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && k.toLowerCase() === "n") { e.preventDefault(); return makeFolder(); }
});

/* ============================ drag and drop ============================
 * Drag items onto a folder, a crumb in the path bar or a place to move them
 * there; hold Ctrl (⌘) to copy. The modifier is read at drop time, so you can
 * change your mind halfway across.
 */
const fileDrag = { paths: [] };
const DROP_SEL = "#f-list [data-path][data-dir='1'], #f-roots .fx-place, #f-crumbs [data-fpath]";
function dropTargets(on) { $$(DROP_SEL).forEach(el => el.classList.toggle("droptarget", on)); }

function wireFileDnD() {
  const page = $("#page-files");
  if (!page || page.dataset.dnd) return;
  page.dataset.dnd = "1";
  page.addEventListener("dragstart", e => {
    const row = e.target.closest("#f-list [data-path]");
    if (!row) return;
    if (!fileSel.has(row.dataset.path)) { fileSel = new Set([row.dataset.path]); fileAnchor = row.dataset.path; markFileSel(); }
    fileDrag.paths = [...fileSel];
    e.dataTransfer.effectAllowed = "copyMove";
    try { e.dataTransfer.setData("text/plain", fileDrag.paths.join("\n")); } catch {}
    // A small "3 items" card under the pointer instead of a ghost of the row.
    const ghost = document.createElement("div");
    ghost.className = "fx-ghost";
    ghost.innerHTML = `${IC("file")}<span>${fileDrag.paths.length === 1 ? esc(row.dataset.name) : fileDrag.paths.length + " items"}</span>`;
    document.body.appendChild(ghost);
    try { e.dataTransfer.setDragImage(ghost, 14, 14); } catch {}
    setTimeout(() => ghost.remove(), 0);
    page.classList.add("dragging-rows");
    dropTargets(true);
  });
  page.addEventListener("dragend", () => {
    fileDrag.paths = [];
    page.classList.remove("dragging-rows");
    dropTargets(false);
    $$(".dropinto").forEach(el => el.classList.remove("dropinto"));
  });
  const targetOf = el => el?.closest?.(DROP_SEL);
  page.addEventListener("dragover", e => {
    if (!fileDrag.paths.length) return;
    const t = targetOf(e.target);
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
    const dest = t.dataset.path || t.dataset.root || t.dataset.fpath;
    const paths = [...fileDrag.paths];
    const move = !(e.ctrlKey || e.metaKey);
    page.classList.remove("dragging-rows");
    dropTargets(false);
    $$(".dropinto").forEach(el => el.classList.remove("dropinto"));
    if (!dest || paths.includes(dest)) return;
    await transferTo(paths, dest, move);
  });
}

/** The one place a copy or move happens, so drag, paste and Move to… agree. */
async function transferTo(paths, dest, move) {
  const run = overwrite => api("/files/transfer", { method: "POST", body: { from: paths, to: dest, move, overwrite } });
  try { await run(false); }
  catch (err) {
    if (err.status !== 409) { toast(err.message, "err"); return false; }
    const names = (err.clashes || []).slice(0, 6).join(", ");
    const more = (err.clashes || []).length > 6 ? `\n…and ${err.clashes.length - 6} more` : "";
    if (!confirm(`${err.message}:\n\n${names}${more}\n\nReplace them?`)) return false;
    try { await run(true); } catch (ex) { toast(ex.message, "err"); return false; }
  }
  const n = paths.length;
  toast(`${move ? "Moved" : "Copied"} ${n} item${n === 1 ? "" : "s"}`, "ok");
  loadFiles(curDir, { history: false });
  loadRoots(true);
  return true;
}

/** Move to… — pick a folder by browsing, then copy or move there. */
async function moveDialog(paths) {
  if (!paths.length) return toast("Select something first", "err");
  let at = curDir;
  const body = document.createElement("div");
  body.className = "fx-pick";
  openModal({ title: `Move or copy ${paths.length} item${paths.length === 1 ? "" : "s"}`, icon: ICON("files"), body, cls: "mw-pick",
    foot: `<span class="fx-pickat" id="fx-pickat"></span><span class="spacer"></span>
      <button class="btn sm" id="fx-pcopy" type="button">Copy here</button><button class="btn primary sm" id="fx-pmove" type="button">Move here</button>` });
  const paint = async () => {
    body.innerHTML = `<div class="fx-pickroots">${ROOTS.map(r => `<button type="button" class="${at && (at === r.path || at.startsWith(r.path)) ? "on" : ""}" data-pgo="${esc(r.path)}">${IC("drive")}${esc(r.note || r.name)}</button>`).join("")}</div>
      <div class="fx-picklist"><div class="fx-loading">${"<i></i>".repeat(4)}</div></div>`;
    $("#fx-pickat").innerHTML = `${IC("folder")}<code>${esc(at)}</code>`;
    try {
      const out = await api("/files?path=" + encodeURIComponent(at));
      at = out.path;
      const dirs = out.entries.filter(e => e.dir && !paths.includes(e.path));
      $(".fx-picklist", body).innerHTML = (out.parent ? `<button type="button" class="fx-pi up" data-pgo="${esc(out.parent)}">${IC("arrow-up")}<span>Up one folder</span></button>` : "") +
        (dirs.map(d => `<button type="button" class="fx-pi" data-pgo="${esc(d.path)}">${IC("folder")}<span>${esc(d.name)}</span>${IC("chevron-right")}</button>`).join("") ||
          `<p class="fx-quiet">No folders inside — this one is the destination.</p>`);
      wireIcons(body);
    } catch (e) { $(".fx-picklist", body).innerHTML = `<p class="fx-quiet">${esc(e.message)}</p>`; }
  };
  body.addEventListener("click", e => { const b = e.target.closest("[data-pgo]"); if (b) { at = b.dataset.pgo; paint(); } });
  on("#fx-pcopy", "click", async () => { closeModal(); if (await transferTo(paths, at, false)) fileSel.clear(); });
  on("#fx-pmove", "click", async () => { closeModal(); if (await transferTo(paths, at, true)) fileSel.clear(); });
  paint();
}

/* ---- rubber-band selection over empty space ---- */
(function marquee() {
  const host = $("#page-files");
  if (!host) return;
  let band = null, sx = 0, sy = 0, active = false, additive = false;
  const toHost = (cx, cy) => { const r = host.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; };
  host.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    if (!e.target.closest("#f-wrap") || e.target.closest("[data-path], button, a, input, select, textarea, video, audio")) return;
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
    if (!band && w < 4 && h < 4) return;
    if (!band) { band = document.createElement("div"); band.id = "f-band"; host.appendChild(band); }
    const left = Math.min(sx, p.x), top = Math.min(sy, p.y);
    band.style.cssText = `left:${left}px;top:${top}px;width:${w}px;height:${h}px`;
    const hr = host.getBoundingClientRect();
    const box = { l: left, t: top, r: left + w, b: top + h };
    const base = additive ? new Set(fileSel) : new Set();
    fileRows().forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.left - hr.left < box.r && r.right - hr.left > box.l && r.top - hr.top < box.b && r.bottom - hr.top > box.t) base.add(el.dataset.path);
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

/* ---- right-click, on an item or on empty space ---- */
on("#page-files", "contextmenu", e => {
  if (e.target.closest("#f-roots, input, textarea, video, audio")) return;
  e.preventDefault();
  const row = e.target.closest("[data-path]");
  if (row && !fileSel.has(row.dataset.path)) { fileSel = new Set([row.dataset.path]); fileAnchor = row.dataset.path; markFileSel(); }
  openFileMenu(e.clientX, e.clientY, row ? entryOf(row.dataset.path) : null);
});

function openFileMenu(x, y, entry) {
  const many = fileSel.size > 1;
  const items = [];
  const clip = fileClip.paths.length;
  if (entry && many) {
    items.push({ label: `Copy ${fileSel.size} items`, icon: "copy", kbd: "Ctrl+C", go: () => clipTake(false) });
    items.push({ label: `Cut ${fileSel.size} items`, icon: "corner", kbd: "Ctrl+X", go: () => clipTake(true) });
    items.push({ label: "Move to…", icon: "folder", go: () => moveDialog([...fileSel]) });
    items.push({ label: "Download the files", icon: "arrow-down", go: downloadFileSelection });
    items.push("-");
    items.push({ label: `Delete ${fileSel.size} items`, icon: "trash", kbd: "Del", danger: true, go: deleteFileSelection });
  } else if (entry) {
    const k = fileKind(entry).k;
    items.push({ label: entry.dir ? "Open" : entry.text ? "Edit" : ["img", "vid", "snd", "pdf"].includes(k) ? "View" : "Download", icon: entry.dir ? "folder" : entry.text ? "edit" : "eye", kbd: "Enter", go: () => openEntry(entry) });
    if (!entry.dir && (entry.text || ["img", "vid", "snd", "pdf"].includes(k))) items.push({ label: "Download", icon: "arrow-down", go: () => { location.href = fileUrl(entry.path); } });
    items.push("-");
    items.push({ label: "Copy", icon: "copy", kbd: "Ctrl+C", go: () => clipTake(false) });
    items.push({ label: "Cut", icon: "corner", kbd: "Ctrl+X", go: () => clipTake(true) });
    if (entry.dir && clip) items.push({ label: `Paste ${clip} into it`, icon: "copy", go: () => pasteInto(entry.path) });
    items.push({ label: "Move to…", icon: "folder", go: () => moveDialog([entry.path]) });
    items.push({ label: "Rename", icon: "edit", kbd: "F2", go: () => renameEntry(entry) });
    items.push({ label: "Copy the path", icon: "link", go: () => copyText(entry.path) });
    items.push("-");
    items.push({ label: "Delete", icon: "trash", kbd: "Del", danger: true, go: () => deleteEntry(entry) });
  } else {
    if (clip) items.push({ label: `Paste ${clip} here`, icon: "copy", kbd: "Ctrl+V", go: () => pasteInto(curDir) });
    items.push({ label: "New folder", icon: "plus", kbd: "Ctrl+Shift+N", go: makeFolder });
    items.push({ label: "Upload files", icon: "upload", go: () => $("#f-file-input")?.click() });
    items.push({ label: "Select everything", icon: "check", kbd: "Ctrl+A", go: selectAllFiles });
    items.push({ label: "Refresh", icon: "refresh", kbd: "F5", go: () => loadFiles(curDir, { history: false }) });
    if (curParent) items.push({ label: "Up one folder", icon: "arrow-up", kbd: "Backspace", go: () => loadFiles(curParent) });
  }
  ctxMenu(x, y, many ? `${fileSel.size} items` : entry ? entry.name : null, items);
}

function selectAllFiles() { fileSel = new Set(fileRows().map(r => r.dataset.path)); markFileSel(); }

/** One request per item, in order: a failure halfway stops and says which. */
async function deleteFileSelection() {
  const chosen = selectedEntries();
  if (!chosen.length) return;
  const dirs = chosen.filter(e => e.dir).length;
  const msg = (chosen.length === 1 ? `Delete "${chosen[0].name}"?` : `Delete ${chosen.length} items?`) +
    (dirs ? `\n\n${dirs === 1 && chosen.length === 1 ? "It is a folder, and everything inside it goes too." : `${dirs} of them ${dirs === 1 ? "is a folder" : "are folders"}, and everything inside goes too.`}` : "") +
    "\n\nThis cannot be undone.";
  if (!confirm(msg)) return;
  let done = 0; const failed = [];
  for (const en of chosen) {
    try { await api("/files/delete", { method: "POST", body: { path: en.path } }); done++; }
    catch (ex) { failed.push(`${en.name}: ${ex.message}`); }
  }
  if (failed.length) toast(`Deleted ${done}, ${failed.length} failed — ${failed[0]}`, "err");
  else toast(`Deleted ${done} item${done === 1 ? "" : "s"}`, "ok");
  loadFiles(curDir, { history: false });
  loadRoots(true);
}
const deleteEntry = en => { fileSel = new Set([en.path]); return deleteFileSelection(); };

function downloadFileSelection() {
  const files = selectedEntries().filter(e => !e.dir);
  if (!files.length) return toast("Folders cannot be downloaded — select files", "err");
  files.forEach((en, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = fileUrl(en.path); a.download = en.name;
    document.body.appendChild(a); a.click(); a.remove();
  }, i * 350));
  toast(`Downloading ${files.length} file${files.length === 1 ? "" : "s"}`, "ok");
}

/** A new folder appears as a row with its name ready to type. */
async function makeFolder() {
  if (!curDir) return;
  if (fileSearch) { fileSearch = null; renderFileList(); }
  const list = $("#f-list");
  $(".fx-newrow", list)?.remove();
  $(".fx-empty", list)?.remove();
  const row = document.createElement("div");
  row.className = (FV.view === "grid" ? "fg" : "fr") + " fx-newrow sel";
  row.innerHTML = FV.view === "grid"
    ? `<span class="fg-thumb"><span class="fk k-dir big">${IC("folder")}</span></span><input class="fx-rename" value="New folder" spellcheck="false" aria-label="Folder name">`
    : `<span class="fr-name"><span class="fk k-dir">${IC("folder")}</span><input class="fx-rename" value="New folder" spellcheck="false" aria-label="Folder name"></span><span></span><span></span><span class="fr-kind">Folder</span>`;
  list.prepend(row);
  const input = $("input", row);
  input.focus(); input.select();
  let done = false;
  const commit = async ok => {
    if (done) return; done = true;
    const name = input.value.trim();
    row.remove();
    if (!ok || !name) return;
    try {
      await api("/files/mkdir", { method: "POST", body: { path: joinPath(curDir, name) } });
      await loadFiles(curDir, { history: false });
      const p = curEntries.find(e => e.name === name)?.path;
      if (p) { fileSel = new Set([p]); fileAnchor = p; markFileSel(); }
      toast("Folder created", "ok");
    } catch (ex) { toast(ex.message, "err"); }
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") commit(true); if (e.key === "Escape") commit(false); e.stopPropagation(); });
  input.addEventListener("blur", () => commit(true));
}

/** Rename in place: the name becomes a text box, with the extension left out of the selection. */
function renameEntry(entry) {
  const row = fileRows().find(r => r.dataset.path === entry.path);
  const label = row && $(FV.view === "grid" ? ".fg-name" : ".fr-t", row);
  if (!label) return;
  const input = document.createElement("input");
  input.className = "fx-rename";
  input.value = entry.name;
  input.spellcheck = false;
  input.setAttribute("aria-label", "New name");
  label.replaceWith(input);
  input.focus();
  const dot = entry.dir ? -1 : entry.name.lastIndexOf(".");
  input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  row.draggable = false;
  let done = false;
  const commit = async ok => {
    if (done) return; done = true;
    const name = input.value.trim();
    if (!ok || !name || name === entry.name) { renderFileList(); return; }
    if (/[\\/]/.test(name)) { toast("A name cannot contain / or \\", "err"); renderFileList(); return; }
    const dir = entry.path.slice(0, entry.path.length - entry.name.length);
    try {
      await api("/files/rename", { method: "POST", body: { from: entry.path, to: dir + name } });
      await loadFiles(curDir, { history: false });
      const p = dir + name;
      fileSel = new Set([p]); fileAnchor = p; markFileSel();
      toast("Renamed", "ok");
    } catch (ex) { toast(ex.message, "err"); renderFileList(); }
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") commit(true); if (e.key === "Escape") commit(false); e.stopPropagation(); });
  input.addEventListener("blur", () => commit(true));
  input.addEventListener("click", e => e.stopPropagation());
  input.addEventListener("dblclick", e => e.stopPropagation());
}

/* ---- the viewer: pictures, video, sound, PDF ---- */
function openViewer(en) {
  const media = shownEntries().filter(e => !e.dir && ["img", "vid", "snd", "pdf"].includes(fileKind(e).k));
  let i = Math.max(0, media.findIndex(e => e.path === en.path));
  let el = $("#fx-viewer");
  if (!el) {
    el = document.createElement("div");
    el.id = "fx-viewer";
    document.body.appendChild(el);
  }
  const paint = () => {
    const cur = media[i], k = fileKind(cur).k, url = esc(fileUrl(cur.path, true));
    const stage = k === "img" ? `<img src="${url}" alt="${esc(cur.name)}">`
      : k === "vid" ? `<video src="${url}" controls autoplay></video>`
      : k === "snd" ? `<div class="fv-snd"><span class="fk k-snd huge">${IC("activity")}</span><audio src="${url}" controls autoplay></audio></div>`
      : `<iframe src="${url}" title="${esc(cur.name)}"></iframe>`;
    el.innerHTML = `<div class="fv-top"><span class="fv-name">${esc(cur.name)}</span><span class="fv-n">${i + 1} / ${media.length}</span>
        <a class="fv-btn" href="${esc(fileUrl(cur.path))}" aria-label="Download">${IC("arrow-down")}</a>
        <button class="fv-btn" type="button" data-fv="close" aria-label="Close">${IC("x")}</button></div>
      <div class="fv-stage">${stage}</div>
      ${media.length > 1 ? `<button class="fv-nav prev" type="button" data-fv="prev" aria-label="Previous">${IC("chevron-left")}</button>
        <button class="fv-nav next" type="button" data-fv="next" aria-label="Next">${IC("chevron-right")}</button>` : ""}`;
    fileSel = new Set([cur.path]); fileAnchor = cur.path; markFileSel();
  };
  const close = () => { el.remove(); removeEventListener("keydown", key, true); };
  const key = e => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    if (e.key === "ArrowRight" && media.length > 1) { e.stopPropagation(); i = (i + 1) % media.length; paint(); }
    if (e.key === "ArrowLeft" && media.length > 1) { e.stopPropagation(); i = (i - 1 + media.length) % media.length; paint(); }
  };
  el.onclick = e => {
    const b = e.target.closest("[data-fv]");
    if (b?.dataset.fv === "close" || e.target === el || e.target.classList.contains("fv-stage")) return close();
    if (b?.dataset.fv === "next") { i = (i + 1) % media.length; paint(); }
    if (b?.dataset.fv === "prev") { i = (i - 1 + media.length) % media.length; paint(); }
  };
  addEventListener("keydown", key, true);
  paint();
}

/* ---- in-browser text editor ---- */
let editorState = null;

async function openEditor(path, name) {
  openModal({ title: name, icon: ICON("files"), body: "<p>Loading…</p>", cls: "mw-editor" });
  let file;
  try { file = await api("/files/read?path=" + encodeURIComponent(path)); }
  catch (e) {
    const b = document.createElement("div");
    b.innerHTML = `<div class="warnbox err">${esc(e.message)}</div>`;
    openModal({ title: name, icon: ICON("files"), body: b });
    return;
  }
  editorState = { path: file.path, mtime: file.mtime, original: file.content };
  const body = document.createElement("div");
  body.className = "fx-ed";
  body.innerHTML = `
    <div class="fx-edbar"><code>${esc(file.path)}</code><span class="spacer"></span>
      <label class="fx-edwrap"><input type="checkbox" id="ed-wrap"> Wrap lines</label>
      <span id="ed-pos">Ln 1, Col 1</span><span id="ed-stat">${bytes(file.size)}</span></div>
    <textarea id="ed-area" spellcheck="false" wrap="off"></textarea>`;
  $("#ed-area", body).value = file.content;
  const foot = document.createElement("div");
  foot.className = "fx-edfoot";
  foot.innerHTML = `<span class="hint" id="ed-hint">Ctrl+S saves</span><span class="spacer"></span>
    <button class="btn sm" id="ed-cancel" type="button">Close</button><button class="btn primary sm" id="ed-save" type="button">Save</button>`;
  openModal({ title: name, icon: ICON("files"), body, foot, cls: "mw-editor" });
  const area = $("#ed-area");
  const pos = () => {
    const before = area.value.slice(0, area.selectionStart).split("\n");
    $("#ed-pos").textContent = `Ln ${before.length}, Col ${before[before.length - 1].length + 1}`;
  };
  area.addEventListener("input", () => {
    const dirty = area.value !== editorState.original;
    $("#ed-hint").textContent = dirty ? "Unsaved changes" : "Ctrl+S saves";
    $("#ed-hint").style.color = dirty ? "var(--warn)" : "";
  });
  ["keyup", "click"].forEach(t => area.addEventListener(t, pos));
  area.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveEditor(); }
    // Tab indents rather than leaving the box.
    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const s = area.selectionStart, en = area.selectionEnd;
      area.setRangeText("  ", s, en, "end");
      area.dispatchEvent(new Event("input"));
    }
  });
  $("#ed-wrap").addEventListener("change", e => area.setAttribute("wrap", e.target.checked ? "soft" : "off"));
  on("#ed-cancel", "click", () => {
    if (area.value !== editorState.original && !confirm("Close without saving your changes?")) return;
    closeModal();
  });
  on("#ed-save", "click", saveEditor);
  area.focus();
  area.setSelectionRange(0, 0);
}

async function saveEditor() {
  if (!editorState) return;
  const area = $("#ed-area"), btn = $("#ed-save");
  btn.disabled = true;
  try {
    const out = await api("/files/write", { method: "POST", body: { path: editorState.path, content: area.value, mtime: editorState.mtime } });
    editorState.mtime = out.mtime;
    editorState.original = area.value;
    $("#ed-stat").textContent = bytes(out.size);
    $("#ed-hint").textContent = "Saved";
    $("#ed-hint").style.color = "var(--ok)";
    toast("Saved", "ok");
    loadFiles(curDir, { history: false, keepSel: true });
  } catch (e) {
    toast(e.message, "err");
    $("#ed-hint").textContent = e.message;
    $("#ed-hint").style.color = "var(--crit)";
  } finally { btn.disabled = false; }
}

/* ============================ clipboard ============================ */
function clipTake(move) {
  const chosen = selectedEntries();
  if (!chosen.length) return toast("Select something first", "err");
  fileClip.paths = chosen.map(e => e.path);
  fileClip.move = move;
  fileClip.from = curDir;
  paintClip();
  toast(`${move ? "Cut" : "Copied"} ${chosen.length} item${chosen.length === 1 ? "" : "s"} — open a folder and paste`, "ok");
}
function clipClear() { fileClip.paths = []; fileClip.from = null; paintClip(); }

function paintClip() {
  const n = fileClip.paths.length;
  const btn = $("#f-paste");
  if (btn) {
    btn.hidden = !n;
    btn.innerHTML = `${IC("copy")}<span>Paste ${n}</span>`;
    btn.setAttribute("data-tip", n ? `${fileClip.move ? "Move" : "Copy"} ${n} item${n === 1 ? "" : "s"} into this folder.` : "");
  }
  const bar = $("#f-clipbar");
  if (bar) {
    bar.hidden = !n;
    const t = $("#f-clipinfo");
    if (t && n) {
      const names = fileClip.paths.slice(0, 3).map(p => p.split(/[\\/]/).pop());
      t.innerHTML = `<b>${n} item${n === 1 ? "" : "s"} ${fileClip.move ? "to move" : "to copy"}</b><span>${esc(names.join(", "))}${n > 3 ? ` and ${n - 3} more` : ""}</span>`;
    }
  }
  fileRows().forEach(el => el.classList.toggle("cut", fileClip.move && fileClip.paths.includes(el.dataset.path)));
}

async function pasteInto(destDir) {
  if (!fileClip.paths.length) return;
  const dest = destDir || curDir;
  if (!dest) return toast("Open a folder first", "err");
  const ok = await transferTo(fileClip.paths, dest, fileClip.move);
  if (!ok) return;
  if (fileClip.move) clipClear(); else paintClip();
}

on("#f-paste", "click", () => pasteInto(curDir));
on("#f-clippaste", "click", () => pasteInto(curDir));
on("#f-clipcancel", "click", () => { clipClear(); toast("Clipboard cleared"); });

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
  if (UP.running) return toast("An upload is already running", "err");
  items = items.filter(i => i.file && safeRel(i.rel));
  if (!items.length) return;

  const dir = targetDir || curDir;
  if (!dir) return toast("Open a folder first", "err");

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
  if (!queue.length) { toast("Nothing to upload — everything was skipped", "err"); return; }

  // Directories first, so a file never races the folder it belongs in.
  const dirs = [...new Set(queue.map(p => p.rel).filter(r => r.includes("/"))
    .map(r => joinPath(dir, r.slice(0, r.lastIndexOf("/")))))];

  UP.running = true; UP.cancelled = false;
  upShow(true);
  const cancelBtn = $("#up-cancel");
  if (cancelBtn) cancelBtn.hidden = false;
  upPaint(0, "", "preparing…", "Uploading");

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
      upPaint(totalBytes ? (doneBytes / totalBytes) * 100 : 0, "", `cancelled after ${doneCount} file${doneCount === 1 ? "" : "s"}`, "Cancelled");
      toast("Upload cancelled", "err");
    } else if (failed) {
      if (el) el.className = "err";
      upPaint(100, "", `${doneCount - failed} uploaded, ${failed} failed`, "Finished with errors");
      toast(`${failed} FILE${failed === 1 ? "" : "S"} FAILED`, "err");
    } else {
      if (el) el.className = "ok";
      upPaint(100, "", `${doneCount} file${doneCount === 1 ? "" : "s"} · ${bytes(doneBytes)}`, "Done");
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
    if (!items.length) return toast("Nothing usable in that drop", "err");
    startUpload(items, dropDir);
  });

  // A file dropped anywhere else in the window would otherwise be opened by the
  // browser, navigating away from Nexus and losing whatever you were doing.
  addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener("drop", e => { if (hasFiles(e) && !page.contains(e.target)) e.preventDefault(); });
})();


/* ============================ terminal (xterm.js) ============================ */
let term = null, fit = null, termWS = null, termReady = false;
/* "shell" or "claude": which command the open session runs. The Claude profile
   is Claude Code inside a tmux session called "claude", run as the person who
   installed it (server/terminal.js decides who, never the page). */
let termProfile = "shell";

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
  if (typeof Terminal === "undefined") { toast("Terminal library failed to load", "err"); return null; }

  term = new Terminal({
    fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: true,
    cursorStyle: "block",
    scrollback: 10000,
    smoothScrollDuration: 110,
    scrollSensitivity: 1.2,
    allowProposedApi: true,
    macOptionIsMeta: true,
    theme: termTheme()
  });

  try { fit = new FitAddon.FitAddon(); term.loadAddon(fit); } catch { fit = null; }
  try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch {}

  term.open($("#xterm-host"));
  loadWebgl();
  // Fit whenever the box changes size, not only when the window does: the
  // sidebar folding, the help line under it wrapping, a phone's toolbar
  // showing — each moves the box without a window resize, and a stale fit is
  // a bottom row drawn under the edge.
  if ("ResizeObserver" in window) {
    let fr = 0;
    new ResizeObserver(() => { cancelAnimationFrame(fr); fr = requestAnimationFrame(fitTerm); }).observe($("#xterm-host"));
  }
  term.onData(d => { if (termWS?.readyState === 1) termWS.send(d); });

  // Right-click belongs to the browser. When the program inside asks for the
  // mouse (tmux with mouse on, which the Claude session uses), xterm reports
  // every button to it — and tmux answers a right-click with its own window
  // menu, drawn over the browser's, so Paste was buried under "Kill". The
  // right button never reaches xterm's mouse reporting; the contextmenu event
  // still does, which is what puts the text box under the pointer so the
  // browser's Paste lands in the terminal.
  const host = $("#xterm-host");
  for (const type of ["mousedown", "mouseup", "auxclick"]) {
    host.addEventListener(type, e => { if (e.button === 2) e.stopPropagation(); }, true);
  }

  // The left button selects, always — the way a terminal is expected to work.
  // While the program inside has the mouse (tmux, for wheel scrolling), xterm
  // would send a left drag to it instead, and tmux's selection never reaches
  // the browser: Ctrl+C had nothing to copy and right-click Copy was grey.
  // xterm makes its own selection when Shift (Option on a Mac) is held, so a
  // left press is handed to it as exactly that. The wheel still goes to tmux.
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || "");
  term.options.macOptionClickForcesSelection = true;
  const ours = new WeakSet();
  host.addEventListener("mousedown", e => {
    if (e.button !== 0 || ours.has(e)) return;
    const mode = term.modes?.mouseTrackingMode;
    if (!mode || mode === "none" || e.shiftKey || (MAC && e.altKey)) return;
    e.stopPropagation();
    e.preventDefault();
    term.clearSelection();          // a forced click with a selection would extend it
    const clone = new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, view: window, detail: e.detail,
      clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
      button: 0, buttons: e.buttons, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
      shiftKey: !MAC, altKey: MAC
    });
    ours.add(clone);
    e.target.dispatchEvent(clone);
    term.focus();
  }, true);

  // Clipboard keys. Ctrl/⌘+V, Ctrl+Shift+V and Shift+Insert are left to the
  // browser, whose paste event xterm takes (and wraps for bracketed paste).
  // Ctrl+Shift+C copies, and so does Ctrl+C when something is selected —
  // with nothing selected, Ctrl+C is still an interrupt.
  try { term.parser.registerOscHandler(52, onOsc52); } catch {}

  // Copy on select, like most Linux terminals: let go of a Shift+drag (or any
  // selection xterm itself makes) and it is on the clipboard. Selections made
  // in tmux arrive through OSC 52 above instead.
  host.addEventListener("mouseup", e => {
    if (e.button !== 0) return;
    setTimeout(() => { if (term.hasSelection()) copyText(term.getSelection()); }, 0);
  });

  term.attachCustomKeyEventHandler(e => {
    if (e.type !== "keydown") return true;
    const k = (e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "v") return false;
    if (e.shiftKey && e.key === "Insert") return false;
    if ((e.ctrlKey || e.metaKey) && k === "c" && (e.shiftKey || term.hasSelection())) {
      e.preventDefault();
      copyText(term.getSelection());
      term.clearSelection();
      return false;
    }
    return true;
  });

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

/**
 * The GPU renderer. xterm 6 draws with DOM elements unless told otherwise, and
 * a full-screen program that redraws constantly (Claude Code) makes thousands
 * of element updates a second — the stutter. WebGL draws the same in one pass.
 * Fetched only when a terminal is first opened, so other pages never pay for
 * it; without WebGL2, or if the GPU context is lost, xterm keeps drawing with
 * the DOM as before.
 */
let webglTried = false;
function loadWebgl() {
  if (webglTried || !term) return;
  webglTried = true;
  try { if (!document.createElement("canvas").getContext("webgl2")) return; } catch { return; }
  const s = document.createElement("script");
  // The same version tag as app.js, so it is cached exactly as long as app.js.
  const ver = (document.querySelector('script[src*="app.js?v="]')?.getAttribute("src") || "").split("v=")[1] || "";
  s.src = "/vendor/xterm-addon-webgl.js" + (ver ? "?v=" + ver : "");
  s.onload = () => {
    try {
      const gl = new WebglAddon.WebglAddon();
      gl.onContextLoss(() => { try { gl.dispose(); } catch {} });
      term.loadAddon(gl);
      fitTerm();
    } catch (e) { console.warn("[nexus] GPU terminal renderer unavailable:", e?.message || e); }
  };
  document.head.appendChild(s);
}

/** Copy to the clipboard. The Clipboard API exists only on https or
 *  localhost; Nexus is often reached on a plain LAN address, so fall back to
 *  the old copy command, which works anywhere from inside a key or click. */
function copyText(text, btn) {
  if (!text) return;
  // With a button (Kernel's copy buttons) the button says so; otherwise a toast.
  const done = () => {
    if (!btn) return toast("Copied", "ok");
    btn.classList.add("done");
    const was = btn.innerHTML;
    btn.innerHTML = IC("check") + "<span>Copied</span>";
    setTimeout(() => { btn.classList.remove("done"); btn.innerHTML = was; }, 1400);
  };
  // If the browser refuses both ways (no recent click or key, which happens
  // when a copy arrives from the program rather than from you), show the text
  // with a Copy button — pressing it is the gesture the browser wants.
  const fallback = () => { if (legacyCopy(text)) done(); else copyBox(text); };
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, fallback);
  } else fallback();
}

function copyBox(text) {
  const body = document.createElement("div");
  body.className = "tpaste";
  body.innerHTML = `<p class="hint">The browser would not let the page copy on its own. Press Copy, or select the text and press Ctrl+C.</p>
    <textarea id="cb-text" rows="5" readonly spellcheck="false"></textarea>`;
  $("#cb-text", body).value = text;
  openModal({
    title: "Copy", icon: ICON("terminal"), body,
    foot: `<span class="spacer"></span><button class="btn primary sm" id="cb-copy" type="button">Copy</button>`
  });
  const ta = $("#cb-text", body);
  setTimeout(() => { ta.focus(); ta.select(); }, 60);
  on("#cb-copy", "click", () => {
    const ok = () => { closeModal(); toast("Copied", "ok"); term?.focus(); };
    if (window.isSecureContext && navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, () => { ta.select(); if (document.execCommand("copy")) ok(); });
    else { ta.select(); if (document.execCommand("copy")) ok(); }
  });
}

/**
 * OSC 52: a program asking the terminal to put text on the clipboard. That is
 * how a selection made in tmux leaves tmux (set-clipboard on, set by the
 * Claude profile) and how Claude's own "c to copy" works. Only writing is
 * honoured — a request to READ the clipboard ("?") is ignored, so nothing on
 * the box can lift what you copied elsewhere.
 */
function onOsc52(data) {
  const i = data.indexOf(";");
  const b64 = (i >= 0 ? data.slice(i + 1) : data).trim();
  if (!b64 || b64 === "?" || b64.length > 1_400_000) return true;
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    copyText(text);
  } catch { /* not base64: ignore it, as xterm would */ }
  return true;
}
function legacyCopy(text) {
  const prev = document.activeElement;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  ta.remove();
  try { prev?.focus?.({ preventScroll: true }); } catch {}
  return ok;
}

/**
 * The Paste button. Reading the clipboard needs https (or localhost) and the
 * browser's permission, and a phone has no Ctrl+V at all — so when it cannot
 * read the clipboard directly it opens a box to long-press-paste into, then
 * types that into the terminal. term.paste() wraps it for bracketed paste, so
 * a multi-line paste is not run line by line.
 */
async function pasteIntoTerminal() {
  if (!term || termWS?.readyState !== 1) return toast("The terminal is not connected", "err");
  if (window.isSecureContext && navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { term.paste(text); term.focus(); return; }
    } catch { /* refused or unsupported: fall through to the box */ }
  }
  const body = document.createElement("div");
  body.className = "tpaste";
  body.innerHTML = `<p class="hint">Paste here — Ctrl+V, or long-press on a phone — and it is typed into the terminal.</p>
    <textarea id="tp-text" rows="5" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>`;
  openModal({
    title: "Paste into the terminal", icon: ICON("terminal"), body,
    foot: `<span class="spacer"></span>
      <button class="btn sm" id="tp-send" type="button">Paste</button>
      <button class="btn primary sm" id="tp-enter" type="button">Paste and press Enter</button>`
  });
  const ta = $("#tp-text", body);
  setTimeout(() => ta.focus(), 60);
  const send = enter => {
    const text = ta.value.replace(/\r?\n$/, "");
    if (!text) return;
    closeModal();
    term.paste(text);
    if (enter && termWS?.readyState === 1) termWS.send("\r");
    term.focus();
  };
  on("#tp-send", "click", () => send(false));
  on("#tp-enter", "click", () => send(true));
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(true); } });
}

function connectTerminal(profile = termProfile) {
  if (!ensureTerm()) return;
  // Switching between the shell and Claude closes the one that is open. For
  // Claude that only detaches tmux: the session itself keeps running.
  if (profile !== termProfile && termWS) { try { termWS.close(); } catch {} termWS = null; term.reset(); }
  termProfile = profile;
  if (termWS && termWS.readyState <= 1) return;

  const state = $("#term-state");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const qs = profile === "claude" ? "?profile=claude"
    : profile.startsWith("exec:") ? "?profile=exec&id=" + encodeURIComponent(profile.slice(5)) : "";
  termWS = new WebSocket(`${proto}//${location.host}/ws/terminal${qs}`);
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
  termWS.onclose = ev => {
    // 4000 is the server saying it could not start anything; its message is
    // already on screen and says why.
    if (ev.code === 4000) {
      termReady = false;
      state.className = "pill warn";
      state.innerHTML = '<i class="dot"></i>Not started';
      return;
    }
    const opened = termReady;
    termReady = false;
    state.className = "pill crit";
    state.innerHTML = '<i class="dot"></i>DISCONNECTED';
    // A shell that never opened is not a closed session, and telling someone to
    // press NEW SESSION when the upgrade is being eaten by a proxy just makes
    // them press it again. Say the real thing.
    if (opened && termProfile === "claude") {
      term.write("\r\n\x1b[90m[detached — Claude Code keeps running in tmux. Press New session to reattach]\x1b[0m\r\n");
    } else if (opened) {
      term.write("\r\n\x1b[90m[session closed — press NEW SESSION to reconnect]\x1b[0m\r\n");
    } else {
      term.write("\r\n\x1b[33m[the shell could not be opened]\x1b[0m\r\n");
      term.write("\x1b[90mThe terminal needs a WebSocket. If you are reaching Nexus through a reverse\r\n");
      term.write("proxy, turn on Websockets Support for this host (Nginx Proxy Manager), or set\r\n");
      term.write("proxy_set_header Upgrade / Connection in nginx. The dashboard banner has the\r\n");
      term.write("exact diagnosis for your setup.\x1b[0m\r\n");
      if (linkState === "polling") diagnoseLink();
    }
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
on("#t-paste", "click", pasteIntoTerminal);
on("#t-mode", "click", () => go("term", termProfile === "shell" ? "claude" : null));
on("#t-clear", "click", () => { if (term) term.clear(); });
addEventListener("resize", () => { if (term && $("#page-term").classList.contains("on")) fitTerm(); });

/* ============================ settings ============================
 * One section at a time, each with its own address (#/settings/kernel), so a
 * link from anywhere lands on the thing it is about and the back button walks
 * the sections. Each section loads only what it shows: the disk scan and the
 * activity log are not fetched to change an accent colour.
 */
const SX = { tab: "appearance", audit: [], auditQ: "" };
const SX_TABS = ["appearance", "general", "kernel", "system", "disks", "activity", "about"];

async function loadSettings(arg) {
  let tab = SX_TABS.includes(arg) ? arg : null;
  if (!tab) { try { tab = localStorage.getItem("nexus.settings.tab"); } catch {} }
  if (!SX_TABS.includes(tab)) tab = "appearance";
  SX.tab = tab;
  try { localStorage.setItem("nexus.settings.tab", tab); } catch {}
  $$("#sx-nav [data-sx]").forEach(b => {
    const on_ = b.dataset.sx === tab;
    b.classList.toggle("on", on_);
    if (on_) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  $$("#page-settings .sx-pane").forEach(p => { p.hidden = p.dataset.pane !== tab; });

  if (tab === "appearance") paintAppearance();
  if (tab === "general") paintGeneral();
  if (tab === "kernel") renderAgentSettings();

  const i = LIVE.info || (LIVE.info = await api("/system/info").catch(() => null));
  const ver = $("#sx-ver");
  if (ver && i?.version) ver.textContent = "Nexus " + i.version;
  if (SX.tab !== tab) return;               // moved on while that was loading
  if (tab === "system") paintSystem(i);
  if (tab === "disks") loadSmart();
  if (tab === "activity") loadAudit();
  if (tab === "about") paintAbout(i);
}
on("#sx-nav", "click", e => {
  const b = e.target.closest("[data-sx]");
  if (b) go("settings", b.dataset.sx);
});

/* ---- general ---- */
function paintGeneral() {
  const sw = (id, v) => { const b = $(id); if (b) b.setAttribute("aria-checked", String(!!v)); };
  sw("#sx-live", LV.on);
  sw("#sx-rail", document.body.classList.contains("rail-mini"));
  const n = Object.keys(launchStats()).length;
  const ln = $("#sx-launch-n");
  if (ln) ln.textContent = n
    ? `The five icons under Overview are the apps you open most. ${n} app${n === 1 ? "" : "s"} counted so far.`
    : "The five icons under Overview are the apps you open most. Nothing counted yet.";
  const ov = $("#sx-ov-n");
  if (ov) {
    const hid = (OVP.hidden || []).length, opts = Object.keys(OVP.opts || {}).length;
    ov.textContent = hid || opts
      ? `Order, hidden cards and what each one shows. ${[hid ? `${hid} hidden` : "", opts ? `${opts} changed` : ""].filter(Boolean).join(", ")}.`
      : "Order, hidden cards and what each one shows. Currently the default.";
  }
}
on("#sx-live", "click", () => { $("#l-live-on")?.click(); paintGeneral(); });
on("#sx-rail", "click", () => { setRailMini(!document.body.classList.contains("rail-mini")); paintGeneral(); });
on("#sx-ov-reset", "click", () => { $("#ov-reset")?.click(); paintGeneral(); });
on("#sx-dash-reset", "click", () => $("#reset")?.click());
on("#sx-launch-clear", "click", () => {
  try { localStorage.removeItem(LAUNCH_KEY); } catch {}
  paintSidebarLaunch(); paintGeneral();
  toast("Quick launch is counting from zero", "ok");
});
on("#sx-keys", "click", () => showShortcuts());
on("#sx-logout", "click", () => $("#logout")?.click());

/* ---- system ---- */
function paintSystem(i) {
  const sys = $("#s-system"), svc = $("#s-services");
  if (!sys || !svc) return;
  if (!i) {
    sys.innerHTML = `<div class="sx-empty">Could not read this machine's details.</div>`;
    svc.innerHTML = "";
    return;
  }
  const rows = [
    ["Hostname", i.host?.hostname],
    ["Address", i.host?.ip4 ? i.host.ip4 + (i.host.iface ? `  ·  ${i.host.iface}` : "") : null],
    ["Operating system", i.host?.distro],
    ["Kernel", i.host?.kernel],
    ["Architecture", i.host?.arch],
    ["Processor", i.cpu?.model ? i.cpu.model + (i.cpu.cores ? `  ·  ${i.cpu.cores} cores` : "") : null],
    ["Memory", LIVE.memTotal ? bytes(LIVE.memTotal) : null],
    ["Up for", LIVE.uptimeSec ? upfmt(LIVE.uptimeSec) : null]
  ];
  sys.innerHTML = rows.filter(r => r[1] != null && r[1] !== "")
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");

  const row = (name, tone, state, sub) => `
    <div class="sx-row"><div class="sx-rl"><b>${name}</b><span>${esc(sub)}</span></div>
      <span class="pill ${tone}"><i class="dot"></i>${esc(state)}</span></div>`;
  const t = i.terminal || {}, c = t.claude || {};
  const roots = (i.fileRoots || []).map(r => r.path);
  svc.innerHTML =
    row("Docker", i.docker?.available ? "ok" : "idle", i.docker?.available ? "Connected" : "Unavailable",
      i.docker?.available ? "Containers, logs, updates and the App Store work." : (i.docker?.reason || "Nexus cannot reach the Docker engine.")) +
    row("Terminal", t.enabled ? "ok" : "idle", t.enabled ? "On" : "Off",
      t.enabled ? `${t.shell || "shell"} · ${t.active ?? 0} open session${t.active === 1 ? "" : "s"} · ${t.resize ? "resizes with the window" : "fixed size"}`
                : "Switched off in the server config (terminal.enabled).") +
    row("Claude Code", c.available ? "ok" : "idle", c.available ? "Ready" : "Not set up",
      c.available ? `Runs as ${c.user || "your user"}${c.tmux ? ", in tmux so it keeps working when the tab closes" : " — tmux is missing, so it stops when the tab closes"}.`
                  : "Install Claude Code on this machine and run scripts/claude-setup.sh.") +
    row("Files", roots.length ? "ok" : "idle", roots.length ? `${roots.length} folder${roots.length === 1 ? "" : "s"}` : "None",
      roots.length ? roots.join("  ·  ") : "No folders are shared with the file manager (fileRoots in the config).") +
    row("Sensors", i.simulated ? "warn" : "ok", i.simulated ? "Simulated" : "Live",
      i.simulated ? "This is not a Linux host, so temperatures are made up for testing." : "Temperatures and fans are read from the machine.");
}

/* ---- disk health ---- */
function hoursWord(h) {
  if (h == null) return "—";
  if (h < 48) return `${h} h`;
  const d = h / 24;
  return d < 365 ? `${Math.round(d)} days` : `${(d / 365).toFixed(1)} years`;
}
async function loadSmart() {
  const box = $("#s-smart");
  if (!box) return;
  if (!box.children.length) box.innerHTML = `<div class="sx-card"><div class="sx-empty">Asking the drives…</div></div>`;
  let sm;
  try { sm = await api("/system/smart"); }
  catch { box.innerHTML = `<div class="sx-card"><div class="sx-empty">${IC("drive")}<b>Disk health is not available</b><span>The check could not be run on this machine.</span></div></div>`; return; }
  if (!sm.length) {
    box.innerHTML = `<div class="sx-card"><div class="sx-empty">${IC("drive")}<b>No drive reported anything</b>
      <span>This needs <code>smartmontools</code> on a Linux host: <code>sudo apt install smartmontools</code>.</span></div></div>`;
    return;
  }
  box.innerHTML = `<div class="sx-card sx-flush">` + sm.map(d => {
    const tone = d.error ? "idle" : d.passed ? "ok" : "crit";
    const hot = d.temperature != null && d.temperature >= 55;
    return `<div class="sx-disk${tone === "crit" ? " bad" : ""}">
      <span class="sx-dico">${IC("drive")}</span>
      <div class="sx-dtxt"><b>${esc(d.model || d.device)}</b><small>${esc(d.device)}${d.serial ? " · " + esc(d.serial) : ""}</small></div>
      <div class="sx-dstat"><span>Temperature</span><b class="${hot ? "warn" : ""}">${d.temperature != null ? d.temperature + "°C" : "—"}</b></div>
      <div class="sx-dstat"><span>Powered on</span><b data-tip="${d.powerOnHours != null ? d.powerOnHours + " hours" : "not reported"}">${hoursWord(d.powerOnHours)}</b></div>
      <span class="pill ${tone}"><i class="dot"></i>${d.error ? esc(d.error) : d.passed ? "Healthy" : "Failing"}</span>
    </div>`;
  }).join("") + `</div>`;
  hydrateIcons(box);
}

/* ---- activity ---- */
function auditDetail(d) {
  if (d == null || d === "") return "";
  if (typeof d !== "object") return String(d);
  return Object.entries(d).map(([k, v]) => `${k}: ${v && typeof v === "object" ? JSON.stringify(v) : v}`).join("  ·  ");
}
const auditTone = a => /fail|denied|refus|error/.test(a) ? "crit"
  : /delete|remove|clear|power|reboot|shutdown|uninstall|stop/.test(a) ? "warn" : "";
async function loadAudit() {
  const box = $("#s-audit");
  if (!box) return;
  if (!SX.audit.length) box.innerHTML = `<div class="sx-empty">Reading the log…</div>`;
  try { SX.audit = await api("/audit?limit=300"); }
  catch { box.innerHTML = `<div class="sx-empty">The activity log could not be read.</div>`; return; }
  paintAudit();
}
function paintAudit() {
  const box = $("#s-audit");
  if (!box) return;
  const q = SX.auditQ.trim().toLowerCase();
  const rows = SX.audit.filter(e => !q ||
    `${e.action} ${e.user || ""} ${e.ip || ""} ${auditDetail(e.detail)}`.toLowerCase().includes(q));
  if (!rows.length) {
    box.innerHTML = `<div class="sx-empty">${SX.audit.length ? "Nothing in the log matches that." : "No activity yet."}</div>`;
    return;
  }
  box.innerHTML = `<div class="sx-ahead"><span>Action</span><span>Detail</span><span>Who</span><span>When</span></div>` +
    rows.map(e => {
      const det = auditDetail(e.detail);
      return `<div class="sx-arow">
        <span class="sx-aact ${auditTone(String(e.action))}">${esc(e.action)}</span>
        <span class="sx-adet" ${det ? `data-tip="${esc(det)}"` : ""}>${det ? esc(det) : "—"}</span>
        <span class="sx-awho">${esc(e.user || "—")}${e.ip ? `<small>${esc(e.ip)}</small>` : ""}</span>
        <time data-tip="${esc(new Date(e.ts).toLocaleString())}">${esc(since(new Date(e.ts).getTime()))}</time>
      </div>`;
    }).join("") +
    (rows.length < SX.audit.length ? "" : SX.audit.length >= 300 ? `<div class="sx-afoot">Showing the newest 300 entries.</div>` : "");
}
on("#sx-audit-q", "input", e => { SX.auditQ = e.target.value; paintAudit(); });
on("#sx-audit-reload", "click", () => loadAudit());

/* ---- about ---- */
function paintAbout(i) {
  const v = $("#sx-about-ver");
  if (v) v.textContent = i?.version ? `Version ${i.version}` : "Your homelab, in one place";
  const kv = $("#s-about");
  if (!kv) return;
  const rows = [
    ["Version", i?.version],
    ["Data folder", i?.config?.dataDir],
    ["Config file", i?.config?.loadedFrom || "built-in defaults"],
    ["Running on", i?.host?.hostname ? `${i.host.hostname}${i.host.distro ? "  ·  " + i.host.distro : ""}` : null]
  ];
  kv.innerHTML = rows.filter(r => r[1] != null && r[1] !== "")
    .map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`).join("");
}
on("#page-settings", "click", e => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  const src = document.getElementById(b.dataset.copy);
  if (src) copyText(src.textContent, b);
});

/* ============================ modal ============================ */
const modal = $("#modal");
/**
 * One modal, one way out: the X in its top-right corner, the backdrop, or
 * Escape.
 *
 * `onClose` exists because several dialogs used to carry a second CLOSE button
 * in the footer that did cleanup on the way out — stopping a log stream,
 * refreshing the page behind. Deleting those buttons without somewhere to put
 * that work would have leaked a socket every time you pressed X instead.
 */
let modalOnClose = null;

function openModal({ title, icon, body, foot, onClose, cls = "" }) {
  $(".mw", modal).className = "mw raised" + (cls ? " " + cls : "");
  // A modal opened from inside another one must not fire the first one's
  // cleanup as if it had been dismissed.
  modalOnClose = onClose || null;
  $("#mw-title").textContent = title;
  $("#mw-icon").src = icon || "/assets/brand/icons/ui-apps.png";
  $("#mw-body").innerHTML = "";
  $("#mw-foot").innerHTML = "";
  if (typeof body === "string") $("#mw-body").innerHTML = body; else if (body) $("#mw-body").appendChild(body);
  if (typeof foot === "string") $("#mw-foot").innerHTML = foot; else if (foot) $("#mw-foot").appendChild(foot);
  $("#mw-foot").hidden = !foot;
  modal.classList.add("open");
}
function closeModal() {
  modal.classList.remove("open");
  const fn = modalOnClose;
  modalOnClose = null;
  if (fn) { try { fn(); } catch (e) { console.error("[nexus] modal cleanup:", e); } }
}
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
      bits.push(`<div class="warnbox"><b>The catalogue is empty.</b> Sync a library to populate it — the CasaOS store is already added, it just needs its first sync (a one-off clone of a few hundred MB). <button class="btn sm" id="st-sync-now">Sync now</button></div>`);
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
  if (reset) { ST.offset = 0; $("#st-grid").innerHTML = '<div class="empty">Loading…</div>'; }
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
      $("#st-grid").innerHTML = `<div class="empty">${ST.q ? "No matches" : "Catalogue empty — sync a library"}</div>`;
    }
    for (const a of out.apps) $("#st-grid").appendChild(appCard(a));

    $("#st-count").textContent = out.total ? `${out.total} app${out.total === 1 ? "" : "s"}` : "";
    $("#st-more").hidden = ST.offset + ST.limit >= out.total;
  } catch (e) {
    $("#st-grid").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  } finally { ST.loading = false; }
}

function appCard(a) {
  const el = document.createElement("button");
  el.className = "appcard";
  const installed = (LIVE.installed || []).some(i => i.slug === a.slug);
  el.innerHTML = `
    <div class="top">
      ${a.icon ? `<img class="ico" src="${esc(a.icon)}" alt="" loading="lazy" data-onfail="hide">`
               : `<span class="ico"></span>`}
      <span style="min-width:0">
        <span class="nm">${esc(a.name)}</span>
        <span class="tg">${esc(a.tagline || a.description || "")}</span>
      </span>
    </div>
    <div class="meta">
      <span class="pill idle">${esc(a.category || "App")}</span>
      ${installed ? '<span class="pill ok"><i class="dot"></i>Installed</span>' : ""}
    </div>`;
  el.addEventListener("click", () => openAppDetail(a));
  return el;
}

async function openAppDetail(a) {
  openModal({ title: a.name, icon: a.icon || undefined, body: `<p>Loading…</p>` });
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
      ${full.icon ? `<img src="${esc(full.icon)}" alt="" data-onfail="hide">` : `<img src="/assets/brand/icons/ui-apps.png" alt="">`}
      <div style="min-width:0">
        <span class="t">${esc(full.name)}</span>
        <p>${esc(full.tagline || "")}</p>
        <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <span class="pill idle">${esc(full.category || "App")}</span>
          ${full.developer ? `<span class="pill idle">${esc(full.developer)}</span>` : ""}
          ${full.image ? `<span class="pill idle">${esc(String(full.image).split(":")[0])}</span>` : ""}
        </div>
      </div>
    </div>
    ${full.description ? `<div><h3>About</h3><p>${esc(full.description).slice(0, 1200)}</p></div>` : ""}
    ${params.length ? `<div><h3>Settings</h3><div id="ap-params" style="display:flex;flex-direction:column;gap:12px"></div></div>` : ""}
    ${full.compose ? `<div><h3>Compose</h3><div class="joblog"><pre>${esc(full.compose.slice(0, 4000))}</pre></div></div>` : ""}
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
    ? `<button class="btn danger" id="ap-remove">Uninstall</button>`
    : `<button class="btn" id="ap-cancel">Cancel</button><button class="btn primary" id="ap-install">Install</button>`;

  openModal({ title: full.name, icon: full.icon || undefined, body, foot });

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
  foot.innerHTML = "";
  openModal({ title, body, foot });
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
  const pre = jobModal(`Installing ${opts.name}`);
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
      btn.textContent = "Install anyway";
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
  const pre = jobModal(`Removing ${name}`);
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
        if (d.status === "success") toast("Done", "ok"); else toast("Failed", "err");
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
  toast("Syncing — this may take a minute");
  try {
    const out = await api(`/store/libraries/${encodeURIComponent(id)}/sync`, { method: "POST" });
    toast(`INDEXED ${out.apps} APPS`, "ok");
    await loadStoreStatus();
    loadStore(true);
  } catch (e) { toast(e.message, "err"); }
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
      <label for="lib-url">Or add any git URL</label>
      <input id="lib-url" type="text" placeholder="https://github.com/owner/repo.git" spellcheck="false">
    </div>`;

  const sugWrap = body.querySelector("#lib-sug-wrap");
  const notAdded = sug.filter(s => !s.added);
  if (notAdded.length) {
    sugWrap.innerHTML = `<h3 style="margin:0 0 8px">Suggested</h3><div class="libsug">` +
      notAdded.map(s => `<div class="s">
        <span class="sn">${esc(s.name)}</span>
        <span class="pill idle">${esc(String(s.format).toUpperCase())}</span>
        <button class="btn sm" data-add="${esc(s.url)}" data-nm="${esc(s.name)}">Add</button>
        <span class="sd">${esc(s.description)}</span>
      </div>`).join("") + `</div>`;
    sugWrap.addEventListener("click", async e => {
      const b = e.target.closest("[data-add]");
      if (!b) return;
      b.disabled = true;
      try {
        await api("/store/libraries", { method: "POST", body: { url: b.dataset.add, name: b.dataset.nm } });
        toast("Added — now sync it", "ok");
        openLibraries();
      } catch (ex) { toast(ex.message, "err"); b.disabled = false; }
    });
  }
  const list = body.querySelector("#lib-list");
  libs.forEach(l => {
    const row = document.createElement("div");
    row.className = "libitem";
    row.innerHTML = `
      <span class="ln">${esc(l.name)}</span>
      <span class="pill idle">${esc(l.format.toUpperCase())}</span>
      <span class="pill ${l.lastSyncAt ? "ok" : "warn"}">${l.lastSyncAt ? l.appCount + " APPS" : "Not synced"}</span>
      <button class="btn sm" data-sync="${esc(l.id)}">Sync</button>
      <button class="btn sm danger" data-del="${esc(l.id)}">Remove</button>
      <span class="lu">${esc(l.url)}</span>
      ${l.lastSyncError ? `<span class="lu" style="color:var(--crit)">${esc(l.lastSyncError)}</span>` : ""}`;
    list.appendChild(row);
  });

  const foot = document.createElement("div");
  foot.innerHTML = `<button class="btn" id="lib-cancel">Cancel</button><button class="btn primary" id="lib-add">Add library</button>`;
  openModal({ title: "App libraries", body, foot });

  on("#lib-cancel", "click", closeModal);
  on("#lib-add", "click", async () => {
    const url = $("#lib-url").value.trim();
    if (!url) return;
    try { await api("/store/libraries", { method: "POST", body: { url } }); toast("Added — now sync it", "ok"); openLibraries(); }
    catch (e) { toast(e.message, "err"); }
  });
  list.addEventListener("click", async e => {
    const s = e.target.closest("[data-sync]"), d = e.target.closest("[data-del]");
    if (s) { closeModal(); return syncLibrary(s.dataset.sync); }
    if (d) {
      if (!confirm("Remove this library and its indexed apps?")) return;
      try { await api(`/store/libraries/${encodeURIComponent(d.dataset.del)}`, { method: "DELETE" }); openLibraries(); loadStore(true); }
      catch (ex) { toast(ex.message, "err"); }
    }
  });
}

/* ---- install from GitHub / raw compose ---- */
function openGitHubInstall() {
  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:16px";
  body.innerHTML = `
    <div class="field">
      <label for="gh-url">GitHub repo or compose URL</label>
      <input id="gh-url" type="text" spellcheck="false"
             placeholder="https://github.com/owner/repo">
      <span class="fh">A repo with docker-compose.yml at its root, a /blob/ link to one, or a raw .yml URL.</span>
    </div>
    <div class="field">
      <label for="gh-name">App name (optional)</label>
      <input id="gh-name" type="text" spellcheck="false" placeholder="derived from the repo name">
    </div>
    <div class="field">
      <label for="gh-compose">…Or paste a compose file directly</label>
      <textarea id="gh-compose" spellcheck="false" placeholder="services:&#10;  app:&#10;    image: nginx&#10;    ports: [&quot;8081:80&quot;]"></textarea>
    </div>
    <div class="warnbox"><b>This runs third-party containers as root.</b> Only install from sources you trust.</div>`;
  const foot = document.createElement("div");
  foot.innerHTML = `<button class="btn" id="gh-cancel">Cancel</button><button class="btn primary" id="gh-go">Install</button>`;
  openModal({ title: "Install from GitHub", body, foot });

  on("#gh-cancel", "click", closeModal);
  on("#gh-go", "click", () => {
    const url = $("#gh-url").value.trim();
    const name = $("#gh-name").value.trim();
    const composeText = $("#gh-compose").value.trim();
    if (composeText) return doInstall({ composeText, name: name || "custom-app" });
    if (!url) return toast("Enter a URL or paste a compose file", "err");
    doInstall({ url, name: name || url.split("/").filter(Boolean).slice(-1)[0] });
  });
}

/* ---- installed apps ---- */
async function openInstalled() {
  await refreshInstalled();
  const body = document.createElement("div");
  if (!LIVE.installed.length) {
    body.innerHTML = `<div class="empty">Nothing installed through Nexus yet</div>`;
  } else {
    body.innerHTML = `<div class="tw"><table><thead><tr><th>App</th><th>Ports</th><th>Source</th><th></th></tr></thead>
      <tbody>${LIVE.installed.map(a => `<tr>
        <td class="name">${esc(a.name)}</td>
        <td class="mono">${(a.ports || []).join(", ") || "—"}</td>
        <td class="mono">${esc(a.libraryId || a.source || "manual").slice(0, 40)}</td>
        <td><button class="btn sm danger" data-rm="${esc(a.slug)}" data-nm="${esc(a.name)}">Remove</button></td>
      </tr>`).join("")}</tbody></table></div>`;
  }
  const foot = document.createElement("div");
  foot.innerHTML = "";
  openModal({ title: "Installed apps", body, foot });
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
const CP = { conf: null, alerts: [], tab: "alerts", filter: "all", at: 0 };

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmtSecs(s) {
  s = Number(s) || 0;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${+(s / 3600).toFixed(1)}h`;
  return `${+(s / 86400).toFixed(1)}d`;
}

const AU_TABS = ["alerts", "rules", "tasks", "notify", "power"];

function showAuTab(tab) {
  CP.tab = AU_TABS.includes(tab) ? tab : "alerts";
  $$("#au-tabs [data-au]").forEach(b => {
    const on_ = b.dataset.au === CP.tab;
    b.classList.toggle("on", on_);
    b.setAttribute("aria-selected", String(on_));
  });
  $$("#page-control .au-pane").forEach(p => { p.hidden = p.dataset.pane !== CP.tab; });
}
on("#au-tabs", "click", e => {
  const b = e.target.closest("[data-au]");
  if (b) go("control", b.dataset.au);
});

/** What a webhook address is, in a word. */
function hookName(n) {
  const f = n.webhookFormat && n.webhookFormat !== "auto" ? n.webhookFormat
    : /ntfy/i.test(n.webhookUrl || "") ? "ntfy" : /discord/i.test(n.webhookUrl || "") ? "discord" : "json";
  return { ntfy: "ntfy", discord: "Discord", json: "Webhook" }[f] || "Webhook";
}
const browserNotes = () => ("Notification" in window) ? Notification.permission : "unsupported";

/** The line under each tab: the state of that section without opening it. */
function paintAuTabs() {
  const set = (id, text, tone = "") => {
    const el = $("#au-s-" + id);
    if (!el) return;
    el.textContent = text;
    el.closest("[data-au]").dataset.tone = tone;
  };
  const unread = (CP.alerts || []).filter(a => !a.ack).length;
  set("alerts", unread ? `${unread} unread` : (CP.alerts || []).length ? "All read" : "Nothing has tripped", unread ? "warn" : "");
  if (!CP.conf) return;
  const rules = CP.conf.rules || [], sch = CP.conf.schedules || [];
  set("rules", rules.length ? `${rules.filter(r => r.enabled).length} of ${rules.length} on` : "None yet");
  set("tasks", sch.length ? `${sch.filter(s => s.enabled).length} of ${sch.length} on` : "None yet");
  const n = CP.conf.notify || {};
  const ways = [n.webhookUrl ? hookName(n) : null, browserNotes() === "granted" && n.browser !== false ? "this browser" : null].filter(Boolean);
  set("notify", ways.length ? ways.join(" + ") : "Not set up", ways.length ? "" : "warn");
  set("power", CP.conf.power?.allowRemote ? "Armed" : "Switched off", CP.conf.power?.allowRemote ? "crit" : "");
}

/**
 * `arg` is the tab from the address. Called with nothing — which is what every
 * save does — it re-reads everything and stays on the tab you are on.
 */
async function loadControl(arg) {
  const tabOnly = arg !== undefined && CP.conf && Date.now() - (CP.at || 0) < 8000;
  showAuTab(arg === undefined ? CP.tab : arg || "alerts");
  paintAuTabs();
  // Moving between tabs moments after a load re-reads nothing — and so does not
  // throw away a webhook address you were halfway through typing.
  if (tabOnly) return;
  try {
    CP.conf = await api("/automation");
    CP.at = Date.now();
  } catch (e) {
    for (const id of ["#cp-rules", "#cp-schedules", "#cp-notify", "#cp-power"]) {
      const el = $(id);
      if (el) el.innerHTML = `<div class="au-empty">${IC("alert")}<b>Could not load this</b><span>${esc(e.message)}</span></div>`;
    }
    return;
  }
  await loadAlerts();
  renderRules();
  renderSchedules();
  renderNotify();
  renderPower();
  paintAuTabs();
}

/* ---- alerts ---- */
async function loadAlerts() {
  try { CP.alerts = await api("/automation/alerts?limit=60"); } catch { CP.alerts = []; }
  renderAlerts();
  paintAlertBadge();
}

function dayLabel(ts) {
  const d = new Date(ts), n = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86400e3);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday"
    : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function renderAlerts() {
  const box = $("#cp-alerts");
  if (!box) return;
  const all = CP.alerts || [];
  const f = CP.filter || "all";
  const match = (a, k) => k === "all" || (k === "unread" ? !a.ack : a.level === k);
  $$("#au-filter [data-af]").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.af === f));
    $("i", b).textContent = all.filter(a => match(a, b.dataset.af)).length;
  });
  const ack = $("#cp-ack"), clr = $("#cp-clear");
  if (ack) ack.disabled = !all.some(a => !a.ack);
  if (clr) clr.disabled = !all.length;
  paintAuTabs();

  if (!all.length) {
    box.innerHTML = `<div class="au-empty ok">${IC("check-circle")}<b>Nothing has tripped</b>
      <span>That is the good outcome. When a rule fires or a health check goes down, it is listed here.</span></div>`;
    return;
  }
  const list = all.filter(a => match(a, f));
  if (!list.length) {
    box.innerHTML = `<div class="au-empty">${IC("bell")}<b>Nothing here</b><span>No alert matches this filter.</span></div>`;
    return;
  }
  let html = "", last = "";
  for (const a of list) {
    const day = dayLabel(a.ts);
    if (day !== last) { html += `${last ? "</div>" : ""}<h3 class="au-day">${esc(day)}</h3><div class="au-list">`; last = day; }
    const lv = a.level === "crit" ? "crit" : a.level === "warn" ? "warn" : "info";
    html += `<div class="au-alert lv-${lv}${a.ack ? "" : " unread"}">
      <span class="au-aico">${IC(lv === "crit" ? "alert" : lv === "warn" ? "half" : "info")}</span>
      <div class="au-atxt"><b>${esc(a.title)}</b>${a.message ? `<span>${esc(a.message)}</span>` : ""}</div>
      ${a.source === "health" ? `<span class="au-chip">Health check</span>` : a.ruleId ? `<span class="au-chip">Rule</span>` : ""}
      <time data-tip="${esc(new Date(a.ts).toLocaleString())}">${esc(fmtTime(new Date(a.ts)))}</time>
    </div>`;
  }
  box.innerHTML = html + "</div>";
}
on("#au-filter", "click", e => {
  const b = e.target.closest("[data-af]");
  if (!b) return;
  CP.filter = b.dataset.af;
  renderAlerts();
});

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

/** Starting points: the four rules nearly every box wants. Each opens the
 *  editor filled in, so the threshold is yours to change before it is saved. */
const RULE_STARTERS = [
  { icon: "thermo", label: "Running hot", sub: "Temperature above 85°C for 2 minutes",
    preset: { name: "Running hot", source: "temp", target: "*", op: "above", value: 85, forSec: 120, severity: "warn" } },
  { icon: "drive", label: "Disk nearly full", sub: "Any disk above 90%",
    preset: { name: "Disk nearly full", source: "disk", target: "*", op: "above", value: 90, forSec: 300, cooldownSec: 21600, severity: "warn" } },
  { icon: "box", label: "Container stopped", sub: "Any container down for a minute",
    preset: { name: "Container stopped", source: "container", target: "*", forSec: 60, severity: "crit" } },
  { icon: "memory", label: "Memory nearly full", sub: "Above 92% for 5 minutes",
    preset: { name: "Memory nearly full", source: "memory", target: "*", op: "above", value: 92, forSec: 300, severity: "warn" } }
];
const SEV_WORD = { crit: "Critical", warn: "Warning", info: "Info" };

function renderRules() {
  const box = $("#cp-rules");
  if (!box) return;
  const rules = CP.conf.rules || [];
  const starters = RULE_STARTERS.filter(s => !rules.some(r => r.name === s.preset.name));
  const startHTML = starters.length ? `
    <div class="au-start">
      <h3>${rules.length ? "Add from a starting point" : "Start from one of these"}</h3>
      <div class="au-starts">${starters.map((s, i) => `
        <button type="button" class="au-startb" data-starter="${RULE_STARTERS.indexOf(s)}">
          <span class="au-si">${IC(s.icon)}</span><span class="au-st"><b>${esc(s.label)}</b><small>${esc(s.sub)}</small></span>${IC("plus")}</button>`).join("")}</div>
    </div>` : "";
  if (!rules.length) {
    box.innerHTML = `<div class="au-empty">${IC("zap")}<b>No rules yet</b>
      <span>A rule tells you — or restarts something — when a reading stays wrong.</span></div>` + startHTML;
    return;
  }
  box.innerHTML = `<div class="au-list">` + rules.map(r => {
    const acts = actionLabels(r.actions) + (r.actionTarget ? ` (${r.actionTarget})` : "");
    return `<div class="au-item${r.enabled ? "" : " off"}">
      <button class="switch" type="button" data-toggle="${esc(r.id)}" role="switch" aria-checked="${!!r.enabled}"
              aria-label="${r.enabled ? "Turn off" : "Turn on"} ${esc(r.name)}"><span></span></button>
      <div class="au-itxt">
        <b>${esc(r.name)}</b>
        <span>When ${esc(ruleSummary(r))}</span>
        <small>${IC("chevron-right")}${esc(acts)} · then quiet for ${esc(fmtSecs(r.cooldownSec))}</small>
      </div>
      <span class="au-sev ${r.severity === "crit" ? "crit" : r.severity === "warn" ? "warn" : "info"}">${SEV_WORD[r.severity] || "Info"}</span>
      <button class="au-ib" type="button" data-edit="${esc(r.id)}" aria-label="Edit ${esc(r.name)}" data-tip="Edit">${IC("edit")}</button>
      <button class="au-ib danger" type="button" data-del="${esc(r.id)}" aria-label="Delete ${esc(r.name)}" data-tip="Delete">${IC("trash")}</button>
    </div>`;
  }).join("") + `</div>` + startHTML;
}

on("#cp-rules", "click", async e => {
  const t = e.target.closest("[data-toggle]"), ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
  if (t) {
    const r = CP.conf.rules.find(x => x.id === t.dataset.toggle);
    if (!r) return;
    try { await api("/automation/rules", { method: "PUT", body: { ...r, enabled: !r.enabled } }); await loadControl(); }
    catch (ex) { toast(ex.message, "err"); }
  }
  if (ed) openRuleEditor(CP.conf.rules.find(x => x.id === ed.dataset.edit));
  if (del) {
    const r = CP.conf.rules.find(x => x.id === del.dataset.del);
    if (!r || !confirm(`Delete the rule "${r.name}"?`)) return;
    try { await api(`/automation/rules/${encodeURIComponent(r.id)}`, { method: "DELETE" }); await loadControl(); toast("Rule deleted", "ok"); }
    catch (ex) { toast(ex.message, "err"); }
  }
});

function selectHTML(id, options, current) {
  return `<select id="${id}">` + options.map(o =>
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

function openRuleEditor(rule, preset) {
  const isNew = !rule;
  const r = rule || {
    name: "", source: "temp", target: "*", op: "above", value: 80,
    forSec: 120, cooldownSec: 1800, severity: "warn", actions: ["notify"], actionTarget: null, enabled: true,
    ...(preset || {})
  };
  const sources = CP.conf.sources || [];
  const containers = (CP.conf.available?.containers || []).map(c => ({ value: c.name, label: c.name }));

  const body = document.createElement("div");
  body.className = "cpform";
  body.innerHTML = `
    <div class="field">
      <label for="ru-name">Name</label>
      <input id="ru-name" type="text" value="${esc(r.name)}" placeholder="CPU temperature high">
    </div>

    <h3>When</h3>
    <div class="frow">
      <div class="field"><label for="ru-src">Watch</label>
        ${selectHTML("ru-src", sources.map(s => ({ value: s.key, label: s.label })), r.source)}</div>
      <div class="field" id="ru-target-wrap"><label for="ru-target">Which one</label><span id="ru-target-slot"></span></div>
    </div>
    <div class="frow" id="ru-threshold">
      <div class="field"><label for="ru-op">Goes</label>
        ${selectHTML("ru-op", [{ value: "above", label: "Above" }, { value: "below", label: "Below" }], r.op)}</div>
      <div class="field"><label for="ru-val">Threshold</label>
        <input id="ru-val" type="number" step="0.1" value="${esc(r.value)}"></div>
    </div>
    <div class="frow">
      <div class="field"><label for="ru-for">Sustained for (seconds)</label>
        <input id="ru-for" type="number" min="0" step="10" value="${esc(r.forSec)}">
        <span class="fh">Stops a one-second spike during a backup from paging you.</span></div>
      <div class="field"><label for="ru-cool">Then stay quiet for (seconds)</label>
        <input id="ru-cool" type="number" min="60" step="60" value="${esc(r.cooldownSec)}">
        <span class="fh">Without this, a disk at 91% alerts on every tick, forever.</span></div>
    </div>

    <h3>Then</h3>
    <div class="field"><label>Do</label>
      <div class="checkrow" id="ru-actions"></div>
    </div>
    <div class="field" id="ru-actarget-wrap" hidden>
      <label for="ru-actarget">On which container</label>
      ${selectHTML("ru-actarget", containers.length ? containers : [{ value: "", label: "no containers visible" }], r.actionTarget || "")}
    </div>
    <div class="field"><label for="ru-sev">Severity</label>
      ${selectHTML("ru-sev", [{ value: "info", label: "Info" }, { value: "warn", label: "Warning" }, { value: "crit", label: "Critical" }], r.severity)}</div>
    <div class="warnbox" id="ru-danger" hidden></div>`;

  const foot = document.createElement("div");
  foot.innerHTML = `<button class="btn" id="ru-cancel">Cancel</button><button class="btn primary" id="ru-save">${isNew ? "Create rule" : "Save"}</button>`;
  openModal({ title: isNew ? "New rule" : "Edit rule", icon: ICON("warning"), body, foot });

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
    if (!payload.actions?.length) return toast("Pick at least one action", "err");
    try {
      await api("/automation/rules", { method: "PUT", body: payload });
      closeModal(); await loadControl();
      toast(isNew ? "Rule created" : "Rule saved", "ok");
    } catch (ex) { toast(ex.message, "err"); }
  });
}

on("#cp-new-rule", "click", () => openRuleEditor(null));
on("#cp-rules", "click", e => {
  const s = e.target.closest("[data-starter]");
  if (s) openRuleEditor(null, RULE_STARTERS[Number(s.dataset.starter)]?.preset);
});

/* ---- scheduled tasks ---- */
function renderSchedules() {
  const box = $("#cp-schedules");
  if (!box) return;
  const list = CP.conf.schedules || [];
  if (!list.length) {
    box.innerHTML = `<div class="au-empty">${IC("calendar")}<b>Nothing is scheduled</b>
      <span>A nightly restart for the one container that leaks, or stopping something outside the hours you use it.</span>
      <button class="btn primary" type="button" data-au-new="task">${IC("plus")}New schedule</button></div>`;
    return;
  }
  const verb = a => ({ "container.restart": "Restart", "container.stop": "Stop", "container.start": "Start" }[a] || a);
  box.innerHTML = `<div class="au-list">` + list.map(s => {
    const days = new Set(s.days || []);
    const failed = !!s.lastError;
    return `<div class="au-item${s.enabled ? "" : " off"}">
      <button class="switch" type="button" data-toggle="${esc(s.id)}" role="switch" aria-checked="${!!s.enabled}"
              aria-label="${s.enabled ? "Turn off" : "Turn on"} ${esc(s.name)}"><span></span></button>
      <div class="au-itxt">
        <b>${esc(s.name || `${verb(s.action)} ${s.target || ""}`)}</b>
        <span>${esc(verb(s.action))} <em>${esc(s.target || "—")}</em> at <em>${esc(s.time)}</em></span>
        <small class="${failed ? "bad" : ""}">${s.lastRunAt ? "Last ran " + esc(since(s.lastRunAt)) : "Has not run yet"}${failed ? " · " + esc(s.lastError) : ""}</small>
      </div>
      <span class="au-days" aria-label="${days.size === 7 ? "Every day" : [...days].sort().map(d => DAY_NAMES[d]).join(", ")}">${DAY_LABELS.map((d, i) =>
        `<i class="${days.has(i) ? "on" : ""}">${d}</i>`).join("")}</span>
      <button class="au-ib" type="button" data-edit="${esc(s.id)}" aria-label="Edit ${esc(s.name)}" data-tip="Edit">${IC("edit")}</button>
      <button class="au-ib danger" type="button" data-del="${esc(s.id)}" aria-label="Delete ${esc(s.name)}" data-tip="Delete">${IC("trash")}</button>
    </div>`;
  }).join("") + `</div>`;
}

on("#cp-schedules", "click", async e => {
  const t = e.target.closest("[data-toggle]"), ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
  if (t) {
    const s = CP.conf.schedules.find(x => x.id === t.dataset.toggle);
    if (!s) return;
    try { await api("/automation/schedules", { method: "PUT", body: { ...s, enabled: !s.enabled } }); await loadControl(); }
    catch (ex) { toast(ex.message, "err"); }
  }
  if (ed) openScheduleEditor(CP.conf.schedules.find(x => x.id === ed.dataset.edit));
  if (del) {
    const s = CP.conf.schedules.find(x => x.id === del.dataset.del);
    if (!s || !confirm(`Delete the task "${s.name}"?`)) return;
    try { await api(`/automation/schedules/${encodeURIComponent(s.id)}`, { method: "DELETE" }); await loadControl(); toast("Task deleted", "ok"); }
    catch (ex) { toast(ex.message, "err"); }
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
    <div class="field"><label for="sc-name">Name</label>
      <input id="sc-name" type="text" value="${esc(s.name)}" placeholder="Nightly Jellyfin restart"></div>
    <div class="frow">
      <div class="field"><label for="sc-act">Do</label>
        ${selectHTML("sc-act", CP.conf.scheduleActions.map(a => ({ value: a.key, label: a.label })), s.action)}</div>
      <div class="field"><label for="sc-target">Container</label>
        ${selectHTML("sc-target", containers.length ? containers : [{ value: "", label: "no containers visible" }], s.target || "")}</div>
    </div>
    <div class="frow">
      <div class="field"><label for="sc-time">At (server local time)</label>
        <input id="sc-time" type="time" value="${esc(s.time)}"></div>
      <div class="field"><label>On</label><div class="daypick" id="sc-days"></div></div>
    </div>
    <div class="warnbox">
      Whole-host reboots are deliberately not offered here. Rebooting Linux on a
      timer hides a leak rather than finding it and guarantees downtime at a fixed
      hour; restarting the one container that misbehaves does the useful half.
      Reboot and shutdown live under POWER below, and can also be triggered by a
      temperature rule.
    </div>`;

  const foot = document.createElement("div");
  foot.innerHTML = `<button class="btn" id="sc-cancel">Cancel</button><button class="btn primary" id="sc-save">${isNew ? "Create task" : "Save"}</button>`;
  openModal({ title: isNew ? "New scheduled task" : "Edit task", icon: ICON("clock"), body, foot });

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
    if (!days.size) return toast("Pick at least one day", "err");
    if (!$("#sc-target").value) return toast("Pick a container", "err");
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
      toast(isNew ? "Task created" : "Task saved", "ok");
    } catch (ex) { toast(ex.message, "err"); }
  });
}

on("#cp-new-task", "click", () => openScheduleEditor(null));
on("#cp-schedules", "click", e => { if (e.target.closest("[data-au-new]")) openScheduleEditor(null); });

/* ---- notifications ---- */
function renderNotify() {
  const n = CP.conf.notify || {};
  const perm = browserNotes();
  const bOn = perm === "granted" && n.browser !== false;
  $("#cp-notify").innerHTML = `
    <div class="au-cards">
      <div class="au-card">
        <div class="au-ch"><span class="au-ci">${IC("link")}</span>
          <div><h3>Webhook</h3><p>Reaches your phone when no Nexus tab is open. This is the one that matters.</p></div>
          <span class="pill ${n.webhookUrl ? "ok" : "idle"}"><i class="dot"></i>${n.webhookUrl ? esc(hookName(n)) : "Not set up"}</span></div>
        <div class="cpform">
          <div class="field">
            <label for="nt-url">Address</label>
            <input id="nt-url" type="text" spellcheck="false" autocomplete="off" value="${esc(n.webhookUrl || "")}"
                   placeholder="https://ntfy.sh/my-private-topic">
            <span class="fh">ntfy, a Discord webhook, or anything that accepts a JSON POST.</span>
          </div>
          <div class="field"><label for="nt-fmt">Format</label>
            ${selectHTML("nt-fmt", [
              { value: "auto", label: "Work it out from the address" }, { value: "ntfy", label: "ntfy" },
              { value: "discord", label: "Discord" }, { value: "json", label: "Plain JSON" }
            ], n.webhookFormat || "auto")}</div>
          <div class="rowbtns">
            <button class="btn primary" id="nt-save" type="button">Save</button>
            <button class="btn" id="nt-test" type="button">Send test</button>
          </div>
        </div>
      </div>
      <div class="au-card">
        <div class="au-ch"><span class="au-ci">${IC("bell")}</span>
          <div><h3>This browser</h3><p>A desktop pop-up while a Nexus tab is open somewhere.</p></div>
          <span class="pill ${bOn ? "ok" : perm === "denied" ? "crit" : "idle"}"><i class="dot"></i>${bOn ? "On" : perm === "denied" ? "Blocked" : "Off"}</span></div>
        <p class="au-cnote">${perm === "unsupported" ? "This browser has no notifications."
          : perm === "denied" ? "This browser is blocking notifications from Nexus. Allow them in the site settings (the icon left of the address), then come back."
          : bOn ? "Alerts pop up on this device. Each browser you use is switched on separately."
          : "Off on this device. Turning it on asks the browser for permission first."}</p>
        <div class="rowbtns">
          <button class="btn${bOn ? "" : " primary"}" id="nt-browser" type="button" ${perm === "unsupported" ? "disabled" : ""}>${bOn ? "Turn off" : perm === "denied" ? "How to unblock" : "Turn on"}</button>
        </div>
      </div>
    </div>`;

  on("#nt-save", "click", async () => {
    try {
      await api("/automation/notify", {
        method: "PUT",
        body: { webhookUrl: $("#nt-url").value.trim(), webhookFormat: $("#nt-fmt").value, browser: CP.conf.notify.browser !== false }
      });
      await loadControl();
      toast("Notifications saved", "ok");
    } catch (ex) { toast(ex.message, "err"); }
  });

  on("#nt-test", "click", async () => {
    const url = $("#nt-url").value.trim();
    if (!url) return toast("Enter a webhook URL first", "err");
    const btn = $("#nt-test");
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      const out = await api("/automation/notify/test", { method: "POST", body: { webhookUrl: url } });
      toast(`Test sent as ${String(out.format)}`, "ok");
    } catch (ex) { toast(ex.message, "err"); }
    finally { btn.disabled = false; btn.textContent = "Send test"; }
  });

  on("#nt-browser", "click", async () => {
    if (!("Notification" in window)) return toast("This browser has no notification API", "err");
    if (Notification.permission === "denied") return toast("Unblock notifications in your browser settings", "err");
    if (Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") return toast("Permission not granted", "err");
    }
    const next = CP.conf.notify.browser === false;
    try {
      await api("/automation/notify", {
        method: "PUT",
        body: { webhookUrl: CP.conf.notify.webhookUrl || "", webhookFormat: CP.conf.notify.webhookFormat || "auto", browser: next }
      });
      await loadControl();
    } catch (ex) { toast(ex.message, "err"); }
  });
}

/* ---- power ---- */
function renderPower() {
  const p = CP.conf.power || {};
  const live = p.allowRemote && p.supported;
  $("#cp-power").innerHTML = `
    <div class="au-card au-power${p.allowRemote ? " armed" : ""}">
      <div class="au-ch"><span class="au-ci">${IC(p.allowRemote ? "power" : "lock")}</span>
        <div><h3>${p.allowRemote ? "Power actions are armed" : "Power actions are switched off"}</h3>
          <p>${p.supported
            ? "While armed, this page — and any rule you give a power action to — can reboot or shut the machine down. Leave it off unless you want that reachable from a browser."
            : "This machine is not Linux, so reboot and shut down are not wired up. The switch is still stored, so your rules keep their settings."}</p></div>
        <button class="btn ${p.allowRemote ? "" : "primary"}" id="pw-arm" type="button">${p.allowRemote ? "Switch off" : "Arm"}</button></div>
      <div class="au-pwr">
        <button class="au-pbtn" id="pw-reboot" type="button" ${live ? "" : "disabled"}>${IC("retry")}<b>Reboot</b><small>Back in a minute or two</small></button>
        <button class="au-pbtn danger" id="pw-shutdown" type="button" ${live ? "" : "disabled"}>${IC("power")}<b>Shut down</b><small>Stays off until someone presses the button</small></button>
      </div>
      <p class="au-cnote">Nexus runs as root, so these do exactly what they say. There is no undo and no remote power-on &mdash; if the box lives somewhere awkward, think before the second one. Both ask you to type the hostname first.</p>
    </div>`;

  on("#pw-arm", "click", async () => {
    const next = !CP.conf.power.allowRemote;
    if (next && !confirm("Arm power actions?\n\nOnce armed, this browser page can reboot or power off the host, and any rule with a power action becomes live.")) return;
    try { await api("/automation/power", { method: "PUT", body: { allowRemote: next } }); await loadControl(); }
    catch (ex) { toast(ex.message, "err"); }
  });

  const doPower = async action => {
    const host = LIVE.info?.host?.hostname || "this host";
    // Typing the hostname, not an OK button. A mis-click should not be able to
    // power off a machine you may have to walk to.
    const typed = prompt(`${action === "reboot" ? "Reboot" : "Shut down"} ${host}?\n\nType the hostname to confirm:`);
    if (typed == null) return;
    if (typed.trim() !== host) return toast("Hostname did not match — nothing happened", "err");
    try {
      await api(`/system/power/${action}`, { method: "POST" });
      toast(action === "reboot" ? "Rebooting…" : "Shutting down…", "ok");
    } catch (ex) { toast(ex.message, "err"); }
  };
  on("#pw-reboot", "click", () => doPower("reboot"));
  on("#pw-shutdown", "click", () => doPower("shutdown"));
}

/* ---- live alerts ---- */
function onAlert(a) {
  toast(a.title, a.level === "crit" ? "err" : a.level === "warn" ? "err" : "ok");

  if (CP.conf?.notify?.browser !== false && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(a.title, { body: a.message, icon: "/assets/brand/icons/nexus-128.png?v=0.9.7", tag: a.ruleId || a.id }); } catch {}
  }
  CP.alerts.unshift(a);
  if (CP.alerts.length > 60) CP.alerts.length = 60;
  if ($("#page-control")?.classList.contains("on")) renderAlerts();
  paintAlertBadge();
  // A health alert means a check just changed state: show it now rather than
  // at the next poll.
  if (a.source === "health") loadChecks();
}

on("#cp-ack", "click", async () => {
  try { await api("/automation/alerts/ack", { method: "POST" }); await loadAlerts(); toast("Acknowledged", "ok"); }
  catch (ex) { toast(ex.message, "err"); }
});
on("#cp-clear", "click", async () => {
  if (!confirm("Clear the alert history?")) return;
  try { await api("/automation/alerts", { method: "DELETE" }); await loadAlerts(); }
  catch (ex) { toast(ex.message, "err"); }
});

/* ============================ navigation ============================
 * Every page has an address: `#/files`, `#/area/network`. Reloading keeps you
 * where you were, the back button works, and a link to a page can be shared
 * with yourself on another device. Hash routing because the server already
 * serves the shell for any path, and a hash never reaches it.
 */
const PAGES = {
  overview:   { title: "Overview",      icon: "activity", sub: "Your homelab, at a glance." },
  area:       { title: "Area",          icon: "activity", sub: "" },
  dash:       { title: "Dashboard",     icon: "layout",   sub: "Your board: the readings and buttons you want in one place." },
  apps:       { title: "Apps",          icon: "grid",     sub: "Everything you run, one press away." },
  containers: { title: "Containers",    icon: "box",      sub: "The services that keep your homelab running." },
  files:      { title: "Files",         icon: "folder",   sub: "Everything in its place." },
  term:       { title: "Terminal",      icon: "terminal", sub: "A direct line to your machine." },
  store:      { title: "App Store",     icon: "store",    sub: "Find a new home for your next project." },
  control:    { title: "Automations",   icon: "zap",      sub: "Alerts, watch rules, schedules and where the news goes." },
  settings:   { title: "Settings",      icon: "settings", sub: "How Nexus looks, what Kernel may do, and what this machine is." }
};
const TITLES = Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, v.title]));
let curPage = null, curArg = null, hashSkip = null;

function go(page, arg = null, { push = true } = {}) {
  if (!PAGES[page]) page = "overview";
  if (page === "area" && !arg) arg = "servers";
  const same = page === curPage && arg === curArg;
  curPage = page; curArg = arg;

  $$(".nav").forEach(n => {
    const hit = n.dataset.page === page &&
      (page === "area" ? n.dataset.area === arg : page === "term" ? (n.dataset.arg || null) === (arg || null) : true);
    n.classList.toggle("on", hit);
    if (hit) n.setAttribute("aria-current", "page"); else n.removeAttribute("aria-current");
  });
  $$(".page").forEach(p => p.classList.toggle("on", p.id === "page-" + page));

  const meta = page === "term" && arg === "claude"
    ? { title: "Claude Code", icon: "code", sub: "Claude Code on this box. Close the tab and it keeps working." }
    : page === "term" && String(arg || "").startsWith("ctr:")
    ? { title: "Console", icon: "box", sub: `A shell inside the container ${String(arg).slice(4)}.` }
    : PAGES[page];
  const areaMeta = page === "area" ? AREA_META[arg] : null;
  $("#page-title").textContent = areaMeta ? areaMeta.name : meta.title;
  $("#tb-pico").innerHTML = IC(areaMeta ? areaMeta.icon : meta.icon);
  $("#page-subtitle").textContent = areaMeta ? areaMeta.sub : meta.sub;
  document.title = (areaMeta ? areaMeta.name : meta.title) + " · Nexus";

  for (const k of ["overview", "area", "dash", "containers", "apps", "files", "store", "term"]) {
    const t = $("#tools-" + k);
    if (t) t.hidden = page !== k;
  }

  if (ZOOM.key) closeStatZoom(true);
  // Leaving a page should not leave its selection armed for the Delete key.
  if (page !== "dash") { clearSelection(); if (dashEdit) setDashEdit(false); if (document.body.classList.contains("kiosk")) setKiosk(false); }
  if (page !== "files") clearFileSelection();
  closeSidebar();

  if (push) {
    const h = "#/" + page + (arg ? "/" + encodeURIComponent(arg) : "");
    if (location.hash !== h) { hashSkip = h; location.hash = h; }
  }
  if (same && !push) return;

  if (page === "overview") { paintOverview(); loadChecks(); }
  if (page === "area") { paintArea(); loadChecks(); }
  // Re-measure on arrival: the canvas had no width while it was hidden, so
  // anything that tried to lay it out in the meantime was correctly ignored.
  if (page === "dash") requestAnimationFrame(() => { layout(false); renderWidgets(); });
  if (page === "containers") loadContainers();
  else if (!CD.id) clearTimeout(CT.statsTimer);
  if (page === "apps") { loadLauncher().then(pollLive); requestAnimationFrame(paintLauncher); }
  else clearTimeout(LV.timer);
  if (page === "files") { wireFileDnD(); loadRoots(); loadFiles(curDir, { history: false }); paintClip(); paintPane(); }
  if (page === "control") loadControl(arg);
  if (page === "settings") loadSettings(arg);
  if (page === "store") { refreshInstalled().then(() => { loadStoreStatus(); loadStore(true); }); }
  if (page === "term") paintTermPage(arg);
  $("#main").scrollTop = 0;
}

/** The Terminal page, as a plain shell or as Claude Code. Run again when the
 *  server's info arrives: a page opened straight from a link (#/term/claude)
 *  is drawn before the server has said whether the terminal is on. */
function paintTermPage(arg) {
  const on = LIVE.info?.terminal?.enabled;
  $("#term-off").hidden = !!on;
  $("#term-on").hidden = !on;
  if (on) {
    const t = LIVE.info.terminal;
    const claude = arg === "claude";
    const ctr = typeof arg === "string" && arg.startsWith("ctr:") ? arg.slice(4) : null;
    const c = t.claude || {};
    $("#term-title").textContent = ctr ? `Console · ${ctr}` : claude ? `Claude Code${c.user ? " · " + c.user : ""}${c.available && !c.tmux ? " · no tmux" : ""}` : (t.shell || "shell");
    const mode = $("#t-mode");
    if (mode) {
      mode.innerHTML = claude || ctr ? `${IC("terminal")}<span>Plain shell</span>` : `${IC("code")}<span>Claude Code</span>`;
      mode.dataset.tip = claude ? "Back to an ordinary shell. Claude keeps running in tmux." : "Open Claude Code in its tmux session.";
    }
    $("#term-hint").innerHTML = claude
      ? "tmux session <code>claude</code> as " + esc(c.user || "your user") +
        " — closing the tab only detaches; Claude keeps working. Scroll with the wheel. Drag to select — it is copied as you let go; Ctrl+C and right-click Copy work too. Ctrl+V or right-click pastes. " +
        "If Claude exits, <code>claude --continue</code> picks the conversation back up."
      : "Full PTY — arrow keys, tab completion, colours and curses apps all work. Every session is written to the audit log.";
    const b = $("#term-backend");
    b.className = "pill " + (t.resize ? "ok" : "warn");
    b.textContent = `${String(t.backend || "script")} · ${t.resize ? "full resize" : "no resize"}`;
    connectTerminal(ctr ? "exec:" + ctr : claude ? "claude" : "shell");
    // The host has no size until the page is visible, so fit after paint.
    requestAnimationFrame(() => { fitTerm(); term?.focus(); });
  }
}

function routeFromHash() {
  const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
  return { page: PAGES[page] ? page : "overview", arg: arg ? decodeURIComponent(arg) : null };
}
addEventListener("hashchange", () => {
  if (hashSkip && location.hash === hashSkip) { hashSkip = null; return; }
  hashSkip = null;
  const r = routeFromHash();
  go(r.page, r.arg, { push: false });
});

// One delegated listener for every way of going somewhere: the sidebar, the
// brand, and any `data-go` link drawn later (problem rows, stat cards).
document.addEventListener("click", e => {
  const n = e.target.closest(".nav[data-page], [data-go]");
  if (!n || n.closest("#ctx")) return;
  if (!PAGES[n.dataset.page || n.dataset.go]) return;   // a data-go that is not a page is someone else's
  if (n.matches("a[href]") && (e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  go(n.dataset.page || n.dataset.go, n.dataset.area || n.dataset.arg || null);
});

/* ============================ sidebar ============================
 * Wide with labels, or a slim rail of icons; on a phone, a drawer. The groups
 * remember whether they are folded, per browser, like every display choice.
 */
const AREA_META = {
  servers:    { name: "Servers",    icon: "server",   sub: "The host itself — collector, CPU, memory, temperature and Docker." },
  network:    { name: "Network",    icon: "globe",    sub: "Name resolution, the internet and your gateway." },
  storage:    { name: "Storage",    icon: "database", sub: "Every mount, and drive health where SMART could read it." },
  containers: { name: "Containers", icon: "box",      sub: "Each container: running, and not reporting itself unhealthy." },
  apps:       { name: "Apps",       icon: "grid",     sub: "Every app on your Apps page with a local address, checked over HTTP." }
};

function paintSidebarAreas() {
  const box = $("#sb-areas");
  if (!box) return;
  const areas = CK.data?.areas || Object.keys(AREA_META).map(id => ({ id, status: "empty" }));
  const html = areas.map(a => {
    const m = AREA_META[a.id] || { name: a.name, icon: "activity" };
    const st = statusClass(a.status);
    return `<button class="nav" type="button" data-page="area" data-area="${esc(a.id)}"
              data-tip="${esc(m.name)}: ${esc(statusWord(a.status))}${a.total ? ` · ${a.up} of ${a.total} passing` : ""}">
        ${IC(m.icon)}<span class="nlabel">${esc(m.name)}</span><span class="ndot s-${st}"></span></button>`;
  }).join("");
  if (box.dataset.sig !== html) {
    box.innerHTML = html;
    box.dataset.sig = html;
    if (curPage === "area") $$(".nav", box).forEach(n => n.classList.toggle("on", n.dataset.area === curArg));
  }

  const n = (CK.data?.problems || []).length + extraProblems().length;
  const badge = $("#nb-problems");
  if (badge) {
    badge.hidden = !n;
    badge.textContent = n;
    badge.className = "nbadge" + ((CK.data?.problems || []).some(p => p.status === "down") ? "" : " warn");
  }
  const ctrs = CK.data?.areas?.find(a => a.id === "containers");
  const nd = $("#nd-containers");
  if (nd) nd.className = "ndot s-" + statusClass(ctrs?.status || "empty");
}

/**
 * Quick launch: the five apps you open most, in this browser.
 *
 * Every open is counted (openApp → noteLaunch) and a count fades with age —
 * halving every two weeks — so what you use now outranks what you used a lot
 * in the spring. Empty slots fill with pinned apps, then the board's order, so
 * a new browser starts with something useful rather than nothing.
 */
const LAUNCH_KEY = "nexus.launches";
function launchStats() {
  try { return JSON.parse(localStorage.getItem(LAUNCH_KEY) || "{}") || {}; } catch { return {}; }
}
function noteLaunch(id) {
  if (!id) return;
  const s = launchStats();
  const now = Date.now(), cur = s[id] || { n: 0, at: now };
  // Decay the old score to now, then add this open.
  const n = cur.n * Math.pow(0.5, (now - cur.at) / (14 * 86400e3)) + 1;
  s[id] = { n: Math.round(n * 1000) / 1000, at: now };
  for (const k of Object.keys(s)) if (!LP.apps.some(a => a.id === k) && LP.apps.length) delete s[k];
  try { localStorage.setItem(LAUNCH_KEY, JSON.stringify(s)); } catch {}
  paintSidebarLaunch();
}
function launchList() {
  const s = launchStats(), now = Date.now();
  const score = a => { const r = s[a.id]; return r ? r.n * Math.pow(0.5, (now - r.at) / (14 * 86400e3)) : 0; };
  const used = LP.apps.filter(a => score(a) > 0.05).sort((a, b) => score(b) - score(a));
  const rest = [...LP.apps.filter(a => a.pinned), ...LP.apps].filter(a => !used.includes(a));
  return [...new Set([...used, ...rest])].slice(0, 5);
}

function appStatus(a) {
  const c = CK.data?.checks?.find(x => x.id === "app:" + a.id);
  return c ? c.status : (a.url || a.locked ? "unknown" : "empty");
}

function paintSidebarLaunch() {
  const box = $("#sb-launch");
  if (!box) return;
  const list = launchList();
  box.hidden = !list.length;
  const html = list.map(a => {
    const src = iconSrc(a), st = appStatus(a);
    return `<button class="sb-dapp" type="button" data-launch="${esc(a.id)}"${src ? ` data-tint="${esc(src)}"` : ""}${tintStyle(src)}
        aria-label="Open ${esc(a.name)}" data-tip="${esc(a.name)}${a.locked ? " — needs the PIN" : ""}${st === "down" ? " — down" : st === "warn" ? " — slow" : ""}">
      ${appIconHTML(a)}${st === "down" || st === "warn" ? `<i class="sb-dstat s-${statusClass(st)}"></i>` : ""}</button>`;
  }).join("");
  if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; wireIcons(box); }
}
on("#sb-launch", "click", e => {
  const b = e.target.closest("[data-launch]");
  if (b) openApp(LP.apps.find(a => a.id === b.dataset.launch));
});

// Folding a group.
$$(".sb-group").forEach(g => {
  const key = "nexus.sb." + g.dataset.group;
  const head = $(".sb-ghead", g);
  const set = open => { g.classList.toggle("folded", !open); head?.setAttribute("aria-expanded", String(open)); };
  try { set(localStorage.getItem(key) !== "0"); } catch { set(true); }
  head?.addEventListener("click", () => {
    const open = g.classList.contains("folded");
    set(open);
    try { localStorage.setItem(key, open ? "1" : "0"); } catch {}
  });
});

function setRailMini(mini, persist = true) {
  document.body.classList.toggle("rail-mini", !!mini);
  const t = $("#rail-toggle");
  t?.setAttribute("aria-label", mini ? "Expand the sidebar" : "Collapse the sidebar");
  const txt = $("#rail-toggle-txt");
  if (txt) txt.textContent = mini ? "Expand" : "Collapse";
  if (persist) { try { localStorage.setItem("nexus.rail.mini", mini ? "1" : "0"); } catch {} }
  requestAnimationFrame(() => {
    layout(false);
    if (term && $("#page-term").classList.contains("on")) fitTerm();
  });
}
on("#rail-toggle", "click", () => setRailMini(!document.body.classList.contains("rail-mini")));
try { setRailMini(localStorage.getItem("nexus.rail.mini") === "1", false); } catch { setRailMini(false, false); }

// On a phone the sidebar is a drawer over the page.
function openSidebar() { document.body.classList.add("sb-open"); $("#scrim").hidden = false; }
function closeSidebar() { document.body.classList.remove("sb-open"); const s = $("#scrim"); if (s) s.hidden = true; }
on("#sb-open", "click", () => (document.body.classList.contains("sb-open") ? closeSidebar() : openSidebar()));
on("#scrim", "click", closeSidebar);

/* ============================ top bar ============================ */
on("#tb-refresh", "click", async e => {
  const b = e.currentTarget;
  b.classList.add("spin");
  setTimeout(() => b.classList.remove("spin"), 700);
  const p = curPage;
  if (p === "overview" || p === "area") await loadChecks(true);
  else if (p === "dash") { api("/system/metrics").then(m => { LIVE.disks = m.disks || []; renderWidgets(); }).catch(() => {}); pollSecurity(); }
  else if (p === "containers") loadContainers();
  else if (p === "apps") loadLauncher();
  else if (p === "files") loadFiles(curDir, { history: false });
  else if (p === "store") loadStore(true);
  else if (p === "control") loadControl();
  else if (p === "settings") loadSettings();
});
on("#theme", "click", () => window.NexusAppearance?.toggleMode());
on("#tb-search", "click", () => openPalette());
on("#sb-search", "click", () => openPalette());
on("#tb-kernel", "click", () => toggleKernel());
if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
  $("#kbd-k") && ($("#kbd-k").textContent = "⌘K");
}

/* ============================ appearance ============================ */
function paintAppearance() {
  const a = window.NexusAppearance;
  if (!a) return;
  $$("[data-skin-choice]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.skinChoice === a.skin)));
  $$("[data-palette-choice]").forEach(b => b.setAttribute("aria-pressed", String(a.skin === "workstation" && b.dataset.paletteChoice === a.palette)));
  const modern = $("#ap-modern"), ws = $("#ap-workstation");
  if (modern) modern.hidden = a.skin !== "modern";
  if (ws) ws.hidden = a.skin !== "workstation";
  $$("#ap-mode [data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === a.mode)));
  const acc = $("#ap-accent");
  if (acc && !acc.children.length) {
    acc.innerHTML = Object.entries(a.accents).map(([k, v]) =>
      `<button type="button" class="accent-dot" data-accent="${k}" style="--sw:${v.swatch}" aria-label="${v.name}" data-tip="${v.name}"></button>`).join("");
  }
  $$("#ap-accent [data-accent]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.accent === a.accent)));
  const sw = (id, on_) => { const b = $(id); if (b) b.setAttribute("aria-checked", String(!!on_)); };
  sw("#glass-toggle", a.glass);
  sw("#motion-toggle", a.motion === "reduced");
  sw("#crt-toggle", document.documentElement.getAttribute("data-crt") === "on");
  const crtRow = $("#crt-row");
  if (crtRow) crtRow.hidden = a.skin === "modern";
  const glassBtn = $("#glass-toggle");
  if (glassBtn) glassBtn.disabled = a.skin === "classic";
  const label = a.skin === "modern"
    ? `Modern · ${a.mode === "system" ? "following your device" : a.mode} · ${a.accents[a.accent].name} accent${a.glass ? " · glass" : ""}`
    : a.skin === "workstation" ? `Workstation · ${a.palettes[a.palette].name}` : "Classic pixel GUI";
  const st = $("#appearance-status");
  if (st) st.textContent = label + ". Saved in this browser.";
  const theme = $("#theme");
  if (theme) theme.innerHTML = IC(document.documentElement.dataset.theme === "dark" ? "sun" : "moon");
}
on("#appearance-section", "click", e => {
  const A = window.NexusAppearance;
  if (!A) return;
  const t = e.target.closest("[data-skin-choice],[data-palette-choice],[data-mode],[data-accent]");
  if (!t) return;
  if (t.dataset.skinChoice) A.setSkin(t.dataset.skinChoice);
  else if (t.dataset.paletteChoice) A.setPalette(t.dataset.paletteChoice);
  else if (t.dataset.mode) A.setMode(t.dataset.mode);
  else if (t.dataset.accent) A.setAccent(t.dataset.accent);
});
on("#glass-toggle", "click", () => window.NexusAppearance?.setGlass(!window.NexusAppearance.glass));
on("#motion-toggle", "click", () => window.NexusAppearance?.setMotion(window.NexusAppearance.motion === "reduced" ? "full" : "reduced"));
on("#crt-toggle", "click", () => { toggleCRT(); paintAppearance(); });
document.addEventListener("nexus:appearance", () => {
  paintAppearance();
  renderWidgets();
  layout(false);
  if (curPage === "overview") paintOverview();
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
on("#dash-edit", "click", () => setDashEdit(true));
on("#dash-done", "click", () => setDashEdit(false));
on("#dash-full", "click", () => setKiosk(true));
on("#kiosk-exit", "click", () => setKiosk(false));
on("#dclose", "click", () => $("#drawer").classList.remove("open"));
on("#drawer", "click", e => { if (e.target.id === "drawer") e.currentTarget.classList.remove("open"); });
on("#tidy", "click", () => {
  tidy();
  layout();
  toast("Tidied", "ok");
});

/* ---------------- dashboard presets ----------------
 * A named arrangement. The point is switching: one layout for watching the
 * media stack, another for a disk problem, without rebuilding either.
 */
async function openPresets() {
  let list = [];
  try { list = (await api("/layout/presets")).presets || []; } catch {}

  const row = p => `
    <div class="pz-item" data-id="${esc(p.id)}">
      <div class="pz-main">
        <b>${esc(p.name)}</b>
        <span>${p.widgets.length} widget${p.widgets.length === 1 ? "" : "s"} · saved ${esc(since(p.savedAt))}</span>
      </div>
      <div class="pz-acts">
        <button class="btn sm" data-pz-use type="button">Use</button>
        <button class="btn sm" data-pz-over type="button" data-tip="Replace this preset with what is on the dashboard now">Overwrite</button>
        <button class="btn sm danger" data-pz-del type="button">DELETE</button>
      </div>
    </div>`;

  openModal({
    title: "Dashboard presets",
    icon: ICON("dashboard"),
    body: `<div id="pz-wrap">
      <div class="pz-save">
        <label for="pz-name">Save what is on screen now</label>
        <input id="pz-name" type="text" maxlength="40" placeholder="Media stack, Disk triage, Everything…">
        <button class="btn primary sm" id="pz-add" type="button">Save</button>
      </div>
      <div class="pz-list">${list.length ? list.map(row).join("")
        : `<p class="hint">No presets yet. Arrange the dashboard how you like it, name it above, and it will be here to come back to.</p>`}</div>
    </div>`,
    foot: null
  });

  const save = async name => {
    if (!name) return toast("give it a name", "err");
    try { await api("/layout/presets", { method: "POST", body: { name, widgets: items } });
          toast("Preset saved", "ok"); openPresets(); }
    catch (e) { toast(e.message || "could not save", "err"); }
  };
  on("#pz-add", "click", () => save($("#pz-name").value.trim()));
  $("#pz-name")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); save(e.target.value.trim()); }
  });

  $$("[data-pz-use]").forEach(b => b.addEventListener("click", () => {
    const p = list.find(x => x.id === b.closest(".pz-item").dataset.id);
    if (p) { closeModal(); applyPreset(p); }
  }));
  $$("[data-pz-over]").forEach(b => b.addEventListener("click", () => {
    const p = list.find(x => x.id === b.closest(".pz-item").dataset.id);
    if (p && confirm(`Replace "${p.name}" with the dashboard as it is now?`)) save(p.name);
  }));
  $$("[data-pz-del]").forEach(b => b.addEventListener("click", async () => {
    const p = list.find(x => x.id === b.closest(".pz-item").dataset.id);
    if (!p || !confirm(`Delete the preset "${p.name}"?`)) return;
    try { await api(`/layout/presets/${encodeURIComponent(p.id)}`, { method: "DELETE" }); openPresets(); }
    catch (e) { toast(e.message, "err"); }
  }));
}

/** Swap the canvas to a saved arrangement. Rebuilt rather than patched: widgets
 *  come and go between presets, so reconciling in place would be more code and
 *  more ways to end up half-applied. */
function applyPreset(p) {
  gridEl.innerHTML = ""; mounted = {}; clearSelection();
  items = p.widgets.map((w, i) => ({ ...w, id: w.id || i + 1 }));
  uid = Math.max(0, ...items.map(i => i.id)) + 1;
  items.forEach(it => build(it, true));
  layout();
  renderDrawer();
  renderWidgets();
  toast(`Preset: ${p.name}`, "ok");
}

on("#presets", "click", openPresets);

on("#reset", "click", async () => {
  if (!confirm("Put the default widgets back?\n\nYour arrangement and each widget's own settings are discarded. Saved presets are kept.")) return;
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
addEventListener("resize", () => { layout(false); renderWidgets(); if (curPage === "apps") paintLauncher(); });

/**
 * The canvas can change size without the window doing anything: switching back
 * to the Dashboard, collapsing the rail, an iPad rotating, the browser's own
 * font size. A ResizeObserver on the element itself catches all of them,
 * including the 0 -> real transition when the page becomes visible again, which
 * is the moment the guard in `layout()` is waiting for.
 */
if (typeof ResizeObserver === "function") {
  let lastW = 0;
  new ResizeObserver(() => {
    const w = gridEl.clientWidth;
    if (w < 1 || w === lastW) return;
    lastW = w;
    layout(false);
  }).observe(gridEl);
}

/* ============================ start ============================ */
async function start() {
  try {
    const saved = await api("/layout");
    items = Array.isArray(saved.widgets) && saved.widgets.length && !untouchedOldDefault(saved.widgets)
      ? saved.widgets.filter(w => REG[w.t])
      : DEFAULT_LAYOUT.map((d, i) => ({ id: i + 1, ...d }));
  } catch {
    items = DEFAULT_LAYOUT.map((d, i) => ({ id: i + 1, ...d }));
  }
  items.forEach((it, i) => { if (!it.id) it.id = i + 1; });
  uid = Math.max(0, ...items.map(i => i.id)) + 1;
  items.forEach(it => build(it, false)); layout(false);
  renderDrawer();                 // after items exist, so "added" is accurate

  api("/system/info").then(i => { LIVE.info = i; renderWidgets(); if (curPage === "term") paintTermPage(curArg); }).catch(() => {});
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
  mountKernel();
  setInterval(renderWidgets, 1000);

  // The Overview, the sidebar and the search palette all read these, so they
  // are fetched once at start rather than on first visit to their own pages.
  api("/automation/alerts?limit=60").then(a => { CP.alerts = a; paintAlertBadge(); }).catch(() => {});
  loadOvPrefs();
  paintSidebarAreas();            // the five areas, grey until the first reading
  loadLauncherQuiet();
  loadChecks();
  // Fifteen seconds is half a probe round, and the response is a small JSON
  // read from memory. Paused while the tab is in the background.
  setInterval(() => { if (!document.hidden) loadChecks(); }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    loadChecks();
    renderWidgets();
    if (curPage === "overview") paintOverview();
    if (curPage === "apps") pollLive();
    // A background tab's timers are throttled to about one a minute, so a
    // Kernel turn followed from a hidden tab is caught up the moment you look.
    if (KX.run && (KX.busy || !$("#kernel").hidden)) refreshTranscript();
  });

  const r = routeFromHash();
  go(r.page, r.arg, { push: false });
}


/* ============================ health checks ============================
 * The Overview page, the area pages and every status dot in the sidebar read
 * one object: GET /api/checks, which the server builds from memory.
 */
const CK = { data: null, at: 0, busy: false, open: new Set() };

async function loadChecks(force = false) {
  if (CK.busy && !force) return;
  CK.busy = true;
  try {
    CK.data = force ? await api("/checks/run", { method: "POST" }) : await api("/checks");
    CK.at = Date.now();
  } catch { /* the previous reading stays on screen, marked by its age */ }
  finally { CK.busy = false; }
  paintSidebarAreas();
  paintSidebarLaunch();
  if (curPage === "overview") paintOverview();
  if (curPage === "area") paintArea();
  if (curPage === "apps") paintLauncherStatus();
}

const statusClass = s => ({ up: "ok", warn: "warn", down: "crit" }[s] || "idle");
const statusWord = s => ({ up: "Up", warn: "Degraded", down: "Down", off: "Stopped", unknown: "Unknown", empty: "No checks" }[s] || "Unknown");
const statusIcon = s => ({ up: "check-circle", warn: "half", down: "x-circle", off: "minus" }[s] || "minus");

function ago(t) {
  if (!t) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.round(s / 60) + " min";
  if (s < 86400) return Math.floor(s / 3600) + " h " + Math.round(s % 3600 / 60) + " min";
  return Math.floor(s / 86400) + " d";
}
const hhmm = t => fmtTime(new Date(t), false, false);

async function loadLauncherQuiet() {
  try {
    const out = await api("/launcher");
    LP.apps = out.apps || [];
    LP.groups = out.groups || [];
  } catch { return; }
  paintSidebarLaunch();
  if (curPage === "overview") paintOverview();
  if (curPage === "apps") { paintLauncher(); pollLive(); }
}

/** Problems that are not checks: the link itself, and the security scan. */
function extraProblems() {
  const out = [];
  if (linkState === "polling") {
    out.push({ id: "x:link", status: "warn", name: "Live updates are polling",
      areaName: "Nexus", msg: "The WebSocket could not be opened, so readings arrive every few seconds over HTTP.",
      action: null });
  } else if (linkState === "offline") {
    out.push({ id: "x:link", status: "down", name: "Lost the connection to Nexus", areaName: "Nexus",
      msg: "Reconnecting…", action: null });
  }
  const sec = LIVE.security?.[24];
  for (const f of (sec?.findings || []).filter(f => f.level === "crit" || f.level === "warn").slice(0, 3)) {
    out.push({ id: "x:sec:" + f.title, status: f.level === "crit" ? "down" : "warn", name: f.title,
      areaName: "Security", msg: f.detail || "", action: null });
  }
  return out;
}

function allProblems() {
  const checks = (CK.data?.problems || []).map(p => ({ ...p, areaName: AREA_META[p.area]?.name || p.area }));
  return [...checks, ...extraProblems()]
    .sort((a, b) => (a.status === "down" ? 0 : 1) - (b.status === "down" ? 0 : 1));
}

function paintAlertBadge() {
  const n = (CP.alerts || []).filter(a => !a.ack).length;
  const b = $("#nb-alerts");
  if (b) { b.hidden = !n; b.textContent = n > 99 ? "99+" : n; }
}

/* ---------- small drawings ---------- */

function sparkPath(vals, w, h, max) {
  if (!vals || vals.length < 2) return "";
  const m = max || Math.max(1, ...vals);
  const step = w / (vals.length - 1);
  return vals.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - 2 - (clamp(v, 0, m) / m) * (h - 4)).toFixed(1)}`).join("");
}
function sparkSVG(vals, max, cls = "") {
  const w = 200, h = 40, d = sparkPath(vals, w, h, max);
  if (!d) return `<svg class="ov-spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"></svg>`;
  return `<svg class="ov-spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path class="sp-fill" d="${d} L${w},${h} L0,${h} Z"/><path class="sp-line" d="${d}"/></svg>`;
}
/** A bar made of weighted segments: [{ w, cls, tip }]. */
function segBar(parts) {
  const total = parts.reduce((a, p) => a + (p.w || 0), 0);
  if (!total) return `<div class="ov-seg empty"></div>`;
  return `<div class="ov-seg">${parts.filter(p => p.w > 0).map(p =>
    `<i class="${p.cls || ""}" style="flex:${p.w}"${p.tip ? ` data-tip="${esc(p.tip)}"` : ""}></i>`).join("")}</div>`;
}
function meterRow(label, pct, cls = "") {
  const p = clamp(Number(pct) || 0, 0, 100);
  return `<div class="ov-mrow"><span>${esc(label)}</span><span class="ov-mtrack"><i class="${cls}" style="width:${p.toFixed(1)}%"></i></span><b>${Math.round(p)}%</b></div>`;
}
const lvl = (v, warn, crit) => (v >= crit ? "crit" : v >= warn ? "warn" : "");

/** The last N results as bars, oldest left. Missing slots stay empty. */
function resultBars(hist, n = 30) {
  const h = (hist || []).slice(-n);
  const pad = n - h.length;
  let out = "";
  for (let i = 0; i < pad; i++) out += `<i class="rb none"></i>`;
  for (const r of h) {
    const tip = `${hhmm(r.t)} · ${statusWord(r.s)}${Number.isFinite(r.ms) ? ` · ${r.ms} ms` : ""}${r.m ? ` · ${r.m}` : ""}`;
    out += `<i class="rb s-${statusClass(r.s)}" data-tip="${esc(tip)}"></i>`;
  }
  return `<span class="rbars" aria-label="last ${n} results">${out}</span>`;
}
function ring(up, total, st) {
  const r = 7, c = 2 * Math.PI * r, f = total ? up / total : 0;
  return `<svg class="ring s-${statusClass(st)}" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="${r}" class="rt"/><circle cx="9" cy="9" r="${r}" class="rf"
      stroke-dasharray="${(f * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 9 9)"/></svg>`;
}

/* ---------- the overview ---------- */

function paintOverview() {
  if (!$("#page-overview")?.classList.contains("on")) return;
  paintHero();
  paintProblems();
  paintStats();
  paintAreasTable($("#ov-areas"), CK.data?.areas || []);
  const sub = $("#page-subtitle");
  if (sub) sub.textContent = CK.at ? `Checks updated ${ago(CK.at)} ago · ${(CK.data?.checks || []).length} checks across ${(CK.data?.areas || []).filter(a => a.checks).length} areas` : "Running the first checks…";
}

function heroChips(problems) {
  const chips = [];
  const first = problems.find(p => p.action);
  if (first) {
    const a = first.action;
    if (a.kind === "app") {
      const app = LP.apps.find(x => x.id === a.id);
      if (app) chips.push(`<button class="ov-chip primary" data-chip-app="${esc(app.id)}">${IC("external")}Open ${esc(app.name)}</button>`);
    } else if (a.kind === "container") {
      chips.push(`<button class="ov-chip primary" data-chip-ctr="${esc(a.id)}">${IC("box")}Manage ${esc(a.name)}</button>`);
    } else if (a.kind === "files") {
      chips.push(`<button class="ov-chip primary" data-go="files">${IC("folder")}Open Files</button>`);
    }
  }
  for (const app of launchList().slice(0, 6)) {
    chips.push(`<button class="ov-chip" data-chip-app="${esc(app.id)}"><span class="ov-chipico">${appIconHTML(app)}</span>${esc(app.name)}<span class="ndot s-${statusClass(appStatus(app))}"></span></button>`);
  }
  chips.push(`<button class="ov-chip" data-chip-kernel>${IC("sparkles")}Ask Kernel</button>`);
  chips.push(`<button class="ov-chip" data-chip-search>${IC("search")}Everything else <kbd>${$("#kbd-k")?.textContent || "Ctrl K"}</kbd></button>`);
  return chips.join("");
}

function paintHero() {
  const box = $("#ov-hero");
  if (!box) return;
  const problems = allProblems();
  const down = problems.filter(p => p.status === "down").length;
  let st, title, line;
  if (!CK.data?.updatedAt) {
    st = "idle"; title = "Checking your homelab…";
    line = "The first round of health checks is running.";
  } else if (!problems.length) {
    const checks = CK.data.checks.filter(c => c.status !== "off" && c.status !== "unknown");
    const ctr = (CK.data.areas.find(a => a.id === "containers") || {});
    st = "ok"; title = "All systems normal";
    line = [`${checks.length} check${checks.length === 1 ? "" : "s"} passing`,
            ctr.total ? `${ctr.up} container${ctr.up === 1 ? "" : "s"} healthy` : null,
            LIVE.uptimeSec ? `up ${upfmt(LIVE.uptimeSec)}` : null].filter(Boolean).join(" · ");
  } else {
    st = down ? "crit" : "warn";
    title = `${problems.length} problem${problems.length === 1 ? "" : "s"}`;
    const p = problems[0];
    line = `${p.areaName} ${p.status === "down" ? "down" : "degraded"} · ${p.name}${p.msg ? " — " + p.msg : ""}`;
  }
  const html = `
    <div class="ov-hero-in s-${st}">
      <span class="ov-hico">${IC(st === "ok" ? "check-circle" : st === "crit" ? "alert" : st === "warn" ? "half" : "activity")}</span>
      <div class="ov-htxt"><h2>${esc(title)}</h2><p>${esc(line)}</p></div>
    </div>
    <div class="ov-chips">${heroChips(problems)}</div>`;
  if (box.dataset.sig !== html) {
    box.innerHTML = html;
    box.dataset.sig = html;
    box.className = "ov-hero s-" + st;
    wireIcons(box);
  }
}

on("#ov-hero", "click", e => {
  const app = e.target.closest("[data-chip-app]");
  if (app) return openApp(LP.apps.find(a => a.id === app.dataset.chipApp));
  const ctr = e.target.closest("[data-chip-ctr]");
  if (ctr) return manageFromAnywhere(ctr.dataset.chipCtr);
  if (e.target.closest("[data-chip-kernel]")) return toggleKernel(true);
  if (e.target.closest("[data-chip-search]")) return openPalette();
});

/** Open a container's manage sheet from a page other than Containers. */
async function manageFromAnywhere(id) {
  if (!CT.list.length) {
    try { const o = await api("/docker/containers"); if (o.available) CT.list = o.containers; } catch {}
  }
  manageContainer(id);
}

function problemAction(p) {
  const a = p.action;
  if (!a) return "";
  if (a.kind === "app") {
    const app = LP.apps.find(x => x.id === a.id);
    return app ? `<button class="ov-plink" data-chip-app="${esc(app.id)}">Open ${esc(app.name)} ${IC("external")}</button>` : "";
  }
  if (a.kind === "container") return `<button class="ov-plink" data-chip-ctr="${esc(a.id)}">Manage ${IC("chevron-right")}</button>`;
  if (a.kind === "files") return `<button class="ov-plink" data-go="files">Open Files ${IC("chevron-right")}</button>`;
  return "";
}

function paintProblems() {
  const box = $("#ov-problems"), sec = $("#ov-problems-sec");
  if (!box) return;
  const list = allProblems();
  sec.hidden = !list.length;
  $("#ov-pcount").textContent = list.length || "";
  const html = list.map(p => `
    <div class="ov-prob s-${statusClass(p.status)}">
      <span class="ov-pico">${IC(p.status === "down" ? "alert" : "half")}</span>
      <div class="ov-ptxt">
        <b>${esc(p.name)}</b>
        <span class="ov-pmeta">${esc(p.areaName)} · ${p.status === "down" ? "down" : "degraded"}${p.since ? ` since ${hhmm(p.since)}, ${ago(p.since)}` : ""}</span>
        ${p.msg ? `<code class="ov-perr">${esc(p.msg)}</code>` : ""}
      </div>
      ${p.area ? `<button class="ov-plink sub" data-go="area" data-arg="${esc(p.area)}">Details</button>` : ""}
      ${problemAction(p)}
    </div>`).join("");
  if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
}
on("#ov-problems", "click", e => {
  const app = e.target.closest("[data-chip-app]");
  if (app) return openApp(LP.apps.find(a => a.id === app.dataset.chipApp));
  const ctr = e.target.closest("[data-chip-ctr]");
  if (ctr) return manageFromAnywhere(ctr.dataset.chipCtr);
});

/* ---------- today ----------
 * Ten cards, each a number you can read from across the room. Press one and it
 * zooms into a panel with everything behind that number — the longer chart,
 * every mount, every sensor, the processes, the containers — and a choice of
 * what the small card shows. "Customize" hides and reorders them.
 *
 * Preferences are the owner's and follow them between devices: stored in
 * settings (`overviewCards`), cached in this browser so the first paint is
 * already right. Only known card keys and known option values are honoured.
 */
const STAT_KEYS = ["cpu", "mem", "disk", "net", "ctr", "apps", "temp", "up", "sec", "alerts"];
const STAT_CHOICES = {
  cpu:  [["usage", "Usage"], ["load", "Load average"]],
  mem:  [["percent", "Percent used"], ["used", "Amount used"], ["free", "Free"]],
  disk: [["used", "Used"], ["free", "Free"], ["percent", "Fullest mount"]],
  net:  [["down", "Download"], ["up", "Upload"]],
  sec:  [["logins", "Failed logins"], ["updates", "Security updates"], ["ports", "Open ports"]]
};
const OVP = (() => {
  const base = { order: STAT_KEYS.slice(), hidden: [], opts: {} };
  try { return cleanOvPrefs(JSON.parse(localStorage.getItem("nexus.today") || "null")) || base; } catch { return base; }
})();
let ovEditing = false;

function cleanOvPrefs(p) {
  if (!p || typeof p !== "object") return null;
  const order = (Array.isArray(p.order) ? p.order : []).filter(k => STAT_KEYS.includes(k));
  for (const k of STAT_KEYS) if (!order.includes(k)) order.push(k);
  const hidden = (Array.isArray(p.hidden) ? p.hidden : []).filter(k => STAT_KEYS.includes(k));
  const opts = {};
  for (const [k, v] of Object.entries(p.opts || {})) {
    if (!STAT_KEYS.includes(k) || typeof v !== "string") continue;
    if (k === "temp" || (STAT_CHOICES[k] || []).some(c => c[0] === v)) opts[k] = v.slice(0, 60);
  }
  return { order, hidden, opts };
}
function saveOvPrefs() {
  try { localStorage.setItem("nexus.today", JSON.stringify(OVP)); } catch {}
  clearTimeout(saveOvPrefs.t);
  saveOvPrefs.t = setTimeout(() => {
    api("/settings", { method: "PUT", body: { overviewCards: { order: OVP.order, hidden: OVP.hidden, opts: OVP.opts } } })
      .catch(e => toast(e.message || "Could not save the card layout", "err"));
  }, 500);
}
async function loadOvPrefs() {
  try {
    const s = await api("/settings");
    const p = cleanOvPrefs(s.overviewCards);
    if (p) { Object.assign(OVP, p); try { localStorage.setItem("nexus.today", JSON.stringify(OVP)); } catch {} }
  } catch {}
  paintStats();
}

const STAT_DEST = {
  cpu: ["dash"], mem: ["dash"], disk: ["area", "storage"], net: ["area", "network"], ctr: ["containers"],
  apps: ["area", "apps"], temp: ["area", "servers"], up: ["area", "servers"], sec: ["dash"], alerts: ["control"]
};

function statCard({ key, icon, label, value, unit, sub, foot, attention, tip }) {
  const hidden = OVP.hidden.includes(key);
  return { key, html: `<button class="ov-stat${attention ? " att-" + attention : ""}${hidden ? " is-hidden" : ""}" type="button" data-stat="${key}"
      ${ovEditing ? `draggable="true"` : ""}${tip ? ` data-tip="${esc(tip)}"` : ""} aria-label="${esc(label)} — open details">
    <span class="ov-slabel">${IC(icon)}${esc(label)}${ovEditing ? `<span class="ov-sedit" role="button" tabindex="0" data-hide="${key}"
        aria-label="${hidden ? "Show" : "Hide"} ${esc(label)}">${IC(hidden ? "eye-off" : "eye")}</span>` : `<span class="ov-sopen">${IC("corner")}</span>`}</span>
    <span class="ov-sval"><b>${value}</b>${unit ? `<i>${esc(unit)}</i>` : ""}</span>
    <span class="ov-ssub">${sub || "&nbsp;"}</span>
    <span class="ov-sfoot">${foot || ""}</span>
  </button>` };
}

/** Everything each card needs, computed once: the card and the zoom both read it. */
function statModel() {
  const m = {};
  const live = !!LIVE.t;
  const o = k => OVP.opts[k] || (STAT_CHOICES[k] ? STAT_CHOICES[k][0][0] : "");

  // CPU
  const cores = LIVE.info?.cpu?.cores || LIVE.cores?.length;
  const la = LIVE.loadavg || [];
  m.cpu = o("cpu") === "load"
    ? { icon: "cpu", label: "CPU", value: live ? (la[0] ?? 0).toFixed(2) : "—", unit: live ? "load · 1 min" : "",
        sub: live ? `${Math.round(LIVE.cpu)}% busy · ${(la[1] ?? 0).toFixed(2)} · ${(la[2] ?? 0).toFixed(2)}` : "waiting for the first reading" }
    : { icon: "cpu", label: "CPU", value: live ? Math.round(LIVE.cpu) : "—", unit: live ? "%" : "",
        sub: live ? `${cores ? cores + " cores · " : ""}load ${la[0] ?? "—"}` : "waiting for the first reading" };
  m.cpu.foot = sparkSVG((LIVE.history.cpu || []).slice(-120), 100, "acc");
  m.cpu.attention = live ? lvl(LIVE.cpu, 85, 95) : "";

  // Memory
  const memOk = !!LIVE.memTotal, memFree = Math.max(0, (LIVE.memTotal || 0) - (LIVE.memUsed || 0));
  const mo = o("mem");
  const [muN, ...muU] = bytes(LIVE.memUsed).split(" "), [mfN, ...mfU] = bytes(memFree).split(" ");
  m.mem = { icon: "memory", label: "Memory",
    value: !memOk ? "—" : mo === "used" ? muN : mo === "free" ? mfN : Math.round(LIVE.mem),
    unit: !memOk ? "" : mo === "used" ? muU.join(" ") + " used" : mo === "free" ? mfU.join(" ") + " free" : "%",
    sub: memOk ? `${bytes(LIVE.memUsed)} of ${bytes(LIVE.memTotal)}` : "not reported yet",
    foot: memOk ? meterRow("RAM", LIVE.mem, lvl(LIVE.mem, 80, 92)) +
      (LIVE.swapTotal ? meterRow("Swap", LIVE.swapUsed / LIVE.swapTotal * 100, lvl(LIVE.swapUsed / LIVE.swapTotal * 100, 50, 80)) : "") : "",
    attention: memOk ? lvl(LIVE.mem, 88, 95) : "" };

  // Storage
  const disks = LIVE.disks || [];
  if (disks.length) {
    const used = disks.reduce((a, d) => a + (d.used || 0), 0);
    const free = disks.reduce((a, d) => a + (d.available || 0), 0);
    const worst = disks.reduce((a, d) => (d.usage > a.usage ? d : a), disks[0]);
    const dO = o("disk");
    const [uN, ...uU] = bytes(used).split(" "), [fN, ...fU] = bytes(free).split(" ");
    m.disk = { icon: "drive", label: "Storage",
      value: dO === "free" ? fN : dO === "percent" ? Math.round(worst.usage) : uN,
      unit: dO === "free" ? fU.join(" ") + " free" : dO === "percent" ? "% · " + worst.mount : uU.join(" ") + " used",
      sub: `${bytes(free)} free · ${disks.length} mount${disks.length === 1 ? "" : "s"} · fullest ${esc(worst.mount)} ${Math.round(worst.usage)}%`,
      foot: segBar(disks.map(d => ({ w: d.size, cls: "c-" + (lvl(d.usage, 85, 95) || "ok"), tip: `${d.mount}: ${Math.round(d.usage)}% used, ${bytes(d.available)} free` }))),
      attention: lvl(worst.usage, 85, 95) };
  } else m.disk = { icon: "drive", label: "Storage", value: "—", sub: "no mounts reported yet" };

  // Network
  const up = o("net") === "up";
  const [nN, ...nU] = rate((up ? LIVE.net?.tx : LIVE.net?.rx) || 0).split(" ");
  m.net = { icon: "network", label: "Network", value: live ? nN : "—", unit: live ? nU.join(" ") + (up ? " up" : " down") : "",
    sub: live ? `${rate((up ? LIVE.net?.rx : LIVE.net?.tx) || 0)} ${up ? "down" : "up"}` : "waiting for the first reading",
    foot: sparkSVG((LIVE.history[up ? "tx" : "rx"] || []).slice(-120), null, "acc2") };

  // Containers
  const ctrArea = CK.data?.areas?.find(a => a.id === "containers");
  const ctrs = LIVE.containers || [];
  if (ctrs.length) {
    const running = ctrs.filter(c => c.state === "running").length;
    const bad = (CK.data?.checks || []).filter(c => c.area === "containers" && c.status === "down").length;
    m.ctr = { icon: "box", label: "Containers", value: running, unit: `of ${ctrs.length} running`,
      sub: bad ? `${bad} unhealthy` : "none unhealthy",
      foot: segBar([{ w: running - bad, cls: "c-ok", tip: `${running - bad} running` }, { w: bad, cls: "c-crit", tip: `${bad} unhealthy` },
                    { w: ctrs.length - running, cls: "c-idle", tip: `${ctrs.length - running} stopped` }]),
      attention: bad ? "crit" : ctrArea?.status === "warn" ? "warn" : "" };
  } else m.ctr = { icon: "box", label: "Containers", value: "—", sub: LIVE.info?.docker && !LIVE.info.docker.available ? "Docker unavailable" : "no containers" };

  // Apps
  const appArea = CK.data?.areas?.find(a => a.id === "apps");
  if (appArea?.checks) {
    const appChecks = CK.data.checks.filter(c => c.area === "apps");
    m.apps = { icon: "grid", label: "Apps", value: appArea.up, unit: `of ${appArea.total} up`,
      sub: appArea.avgMs != null ? `average response ${appArea.avgMs} ms` : "&nbsp;",
      foot: segBar(appChecks.map(c => ({ w: 1, cls: "c-" + statusClass(c.status), tip: `${c.name}: ${statusWord(c.status)}` }))),
      attention: appArea.status === "down" ? "crit" : appArea.status === "warn" ? "warn" : "" };
  } else m.apps = { icon: "grid", label: "Apps", value: LP.apps.length || "—", unit: LP.apps.length ? "on the board" : "",
    sub: "add a local address to an app to watch it" };

  // Temperature — the hottest, or the sensor you chose
  const temps = (LIVE.sensors || []).filter(s => s.kind === "temperature" && Number.isFinite(s.value));
  if (temps.length) {
    const hot = temps.reduce((a, b) => (b.value > a.value ? b : a));
    const pick = OVP.opts.temp && OVP.opts.temp !== "hottest" ? temps.find(t => t.label === OVP.opts.temp) || hot : hot;
    const crit = pick.critical || 95;
    m.temp = { icon: "thermo", label: "Temperature", value: Math.round(pick.value), unit: "°C",
      sub: esc(pick.label) + (pick === hot && temps.length > 1 ? ` · hottest of ${temps.length}` : ""),
      foot: meterRow("vs limit", pick.value / crit * 100, lvl(pick.value / crit * 100, 85, 95)),
      attention: lvl(hot.value / (hot.critical || 95) * 100, 88, 97) };
  }

  // Uptime
  const boot = LIVE.uptimeSec ? new Date(Date.now() - LIVE.uptimeSec * 1000) : null;
  m.up = { icon: "clock", label: "Uptime",
    value: LIVE.uptimeSec ? esc(upfmt(LIVE.uptimeSec).split(" ").slice(0, 2).join(" ")) : "—",
    sub: boot ? `booted ${fmtDate(boot)}, ${fmtTime(boot, false, false)}` : "not reported yet",
    foot: LIVE.info?.host?.distro ? `<span class="ov-fnote">${esc(LIVE.info.host.distro)}</span>` : "" };

  // Security
  const sec = LIVE.security?.[24];
  if (sec) {
    const ssh = sec.ssh?.ok ? sec.ssh.count : "?";
    const upd = sec.updates?.ok ? sec.updates.security || 0 : "?";
    const ports = sec.ports?.ok ? sec.ports.exposed : "?";
    const so = o("sec");
    m.sec = { icon: "shield", label: "Security",
      value: so === "updates" ? upd : so === "ports" ? ports : ssh,
      unit: so === "updates" ? "security updates" : so === "ports" ? "open ports" : "failed logins · 24 h",
      sub: so === "logins" ? `${upd} security update${upd === 1 ? "" : "s"} · ${ports} open port${ports === 1 ? "" : "s"}`
                           : `${ssh} failed login${ssh === 1 ? "" : "s"} in 24 h`,
      foot: (sec.findings || []).length ? `<span class="ov-fnote">${esc(sec.findings[0].title)}</span>` : "",
      attention: sec.level === "crit" ? "crit" : sec.level === "warn" ? "warn" : "" };
  }

  // Alerts
  const unread = (CP.alerts || []).filter(a => !a.ack);
  const last = (CP.alerts || [])[0];
  m.alerts = { icon: "bell", label: "Alerts", value: unread.length, unit: "unread",
    sub: last ? `last: ${esc(last.title)} · ${ago(new Date(last.ts).getTime())} ago` : "nothing has tripped",
    attention: unread.some(a => a.level === "crit") ? "crit" : unread.length ? "warn" : "" };
  return m;
}

function paintStats() {
  const box = $("#ov-stats");
  if (!box) return;
  const m = statModel();
  const keys = OVP.order.filter(k => m[k] && (ovEditing || !OVP.hidden.includes(k)));
  const html = keys.map(k => statCard({ key: k, ...m[k] }).html).join("") ||
    `<p class="ov-snone">Every card is hidden. <button type="button" class="linkbtn" data-ovreset>Show them all</button></p>`;
  box.classList.toggle("editing", ovEditing);
  if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
  const bar = $("#ov-editbar");
  if (bar) bar.hidden = !ovEditing;
  const cb = $("#ov-custom");
  if (cb) { cb.textContent = ovEditing ? "Done" : "Customize"; cb.classList.toggle("primary", ovEditing); }
  paintZoom();
}

/* ---- customising ---- */
on("#ov-custom", "click", () => { ovEditing = !ovEditing; paintStats(); });
on("#ov-reset", "click", () => {
  OVP.order = STAT_KEYS.slice(); OVP.hidden = []; OVP.opts = {};
  saveOvPrefs(); paintStats(); toast("Cards back to the default", "ok");
});

on("#ov-stats", "click", e => {
  if (e.target.closest("[data-ovreset]")) { OVP.hidden = []; saveOvPrefs(); return paintStats(); }
  const hide = e.target.closest("[data-hide]");
  if (hide) {
    e.stopPropagation();
    const k = hide.dataset.hide;
    OVP.hidden = OVP.hidden.includes(k) ? OVP.hidden.filter(x => x !== k) : [...OVP.hidden, k];
    saveOvPrefs(); return paintStats();
  }
  const card = e.target.closest(".ov-stat[data-stat]");
  if (!card || ovEditing) return;
  openStatZoom(card.dataset.stat, card);
});
on("#ov-stats", "keydown", e => {
  const hide = e.target.closest?.("[data-hide]");
  if (hide && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); hide.click(); }
});

/* Reordering: drag a card onto another while customising. HTML5 drag and drop
   is enough here — ten cards, a mouse — and the zoom panel has Move earlier /
   later for a touch screen. */
let ovDrag = null;
on("#ov-stats", "dragstart", e => {
  const c = e.target.closest(".ov-stat");
  if (!c || !ovEditing) return;
  ovDrag = c.dataset.stat;
  c.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", ovDrag); } catch {}
});
on("#ov-stats", "dragover", e => {
  if (!ovDrag) return;
  const c = e.target.closest(".ov-stat");
  e.preventDefault();
  if (!c || c.dataset.stat === ovDrag) return;
  const r = c.getBoundingClientRect();
  const before = e.clientX < r.left + r.width / 2;
  const from = $(`.ov-stat[data-stat="${ovDrag}"]`, $("#ov-stats"));
  if (from) c.parentNode.insertBefore(from, before ? c : c.nextSibling);
});
on("#ov-stats", "dragend", () => {
  if (!ovDrag) return;
  const shown = $$("#ov-stats .ov-stat").map(c => c.dataset.stat);
  OVP.order = [...shown, ...OVP.order.filter(k => !shown.includes(k))];
  ovDrag = null;
  $("#ov-stats").dataset.sig = "";
  saveOvPrefs(); paintStats();
});

/* ---- the zoom ---- */
const ZOOM = { key: null, from: null };

function bigChart(series, { max = null, unit = "", fmt = v => Math.round(v) + unit } = {}) {
  const W = 640, H = 150, n = Math.max(...series.map(s => (s.vals || []).length), 0);
  if (n < 2) return `<div class="ovz-chart empty">Collecting readings…</div>`;
  const top = max || Math.max(1, ...series.flatMap(s => s.vals)) * 1.12;
  const y = v => (H - 4 - (clamp(v, 0, top) / top) * (H - 10)).toFixed(1);
  const x = (i, len) => ((W - 1) - (len - 1 - i) * (W - 1) / (n - 1)).toFixed(1);
  const paths = series.map(s => {
    const v = s.vals || [];
    const d = v.map((p, i) => `${i ? "L" : "M"}${x(i, v.length)} ${y(p)}`).join("");
    return `<path class="a ${s.cls}" d="${d}L${x(v.length - 1, v.length)} ${H}L${x(0, v.length)} ${H}Z"/><path class="l ${s.cls}" d="${d}"/>`;
  }).join("");
  const mins = Math.max(1, Math.round(n / 60));
  return `<div class="ovz-chart">
    <div class="ovz-axis"><span>${esc(fmt(top))}</span><span>${esc(fmt(top / 2))}</span><span>0</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="${W}" y1="${y(top / 2)}" y2="${y(top / 2)}"/><line x1="0" x2="${W}" y1="${y(top)}" y2="${y(top)}"/>${paths}</svg>
    <div class="ovz-time"><span>${mins} min ago</span><span>now</span></div>
    ${series.length > 1 ? `<div class="ovz-legend">${series.map(s => `<span class="${s.cls}"><i></i>${esc(s.label)}</span>`).join("")}</div>` : ""}
  </div>`;
}
const tile = (k, v, cls = "") => `<div class="ovz-tile${cls ? " " + cls : ""}"><b>${v}</b><span>${esc(k)}</span></div>`;
const procTable = (list, by) => !list?.length ? `<p class="ovz-quiet">No process list yet.</p>` : `
  <table class="ovz-table"><thead><tr><th>Process</th><th>CPU</th><th>Memory</th><th>User</th></tr></thead><tbody>
  ${list.slice(0, 8).map(p => `<tr><td class="nm">${esc(p.name)}<small>${p.pid}</small></td>
    <td class="${by === "cpu" ? "hi" : ""}">${p.cpu}%</td><td class="${by === "mem" ? "hi" : ""}">${p.rss != null ? bytes(p.rss) : p.mem + "%"}</td>
    <td class="mut">${esc(p.user || "")}</td></tr>`).join("")}</tbody></table>`;

function zoomBody(key) {
  const sec = (title, html) => `<section class="ovz-sec"><h4>${esc(title)}</h4>${html}</section>`;
  switch (key) {
    case "cpu": {
      const la = LIVE.loadavg || [];
      return `<div class="ovz-tiles">${tile("Busy now", Math.round(LIVE.cpu) + "%")}${tile("Load · 1 min", (la[0] ?? 0).toFixed(2))}${tile("5 min", (la[1] ?? 0).toFixed(2))}${tile("15 min", (la[2] ?? 0).toFixed(2))}</div>` +
        sec("Usage", bigChart([{ vals: LIVE.history.cpu, cls: "c1", label: "CPU" }], { max: 100, unit: "%" })) +
        (LIVE.cores?.length ? sec(`${LIVE.cores.length} cores`, `<div class="ovz-cores">${LIVE.cores.map((c, i) =>
          `<div class="ovz-core" data-tip="Core ${i}: ${c}%"><i style="height:${clamp(c, 0, 100)}%" class="${lvl(c, 85, 95)}"></i></div>`).join("")}</div>`) : "") +
        sec("Busiest processes", procTable(LIVE.procs?.byCpu, "cpu"));
    }
    case "mem": {
      const free = Math.max(0, (LIVE.memTotal || 0) - (LIVE.memUsed || 0));
      return `<div class="ovz-tiles">${tile("Used", bytes(LIVE.memUsed))}${tile("Free", bytes(free))}${tile("Total", bytes(LIVE.memTotal))}${tile("Swap", LIVE.swapTotal ? `${bytes(LIVE.swapUsed)} of ${bytes(LIVE.swapTotal)}` : "none")}</div>` +
        sec("Usage", bigChart([{ vals: LIVE.history.mem, cls: "c1", label: "Memory" }], { max: 100, unit: "%" })) +
        sec("Largest processes", procTable(LIVE.procs?.byMem, "mem"));
    }
    case "disk": {
      const disks = (LIVE.disks || []).slice().sort((a, b) => b.usage - a.usage);
      const io = LIVE.history.dr?.length ? sec("Disk activity", bigChart([{ vals: LIVE.history.dr, cls: "c1", label: "Read" }, { vals: LIVE.history.dw, cls: "c2", label: "Write" }], { fmt: v => rate(v) })) : "";
      return sec("Mounts", disks.length ? `<div class="ovz-mounts">${disks.map(d => `
        <div class="ovz-mount"><div class="ovz-mrow"><b>${esc(d.mount)}</b><span>${esc(d.type || "")}${d.fs ? " · " + esc(d.fs) : ""}</span>
          <em class="${lvl(d.usage, 85, 95)}">${Math.round(d.usage)}%</em></div>
          <div class="ovz-bar"><i class="${lvl(d.usage, 85, 95)}" style="width:${clamp(d.usage, 0, 100)}%"></i></div>
          <div class="ovz-msub">${bytes(d.used)} used · ${bytes(d.available)} free · ${bytes(d.size)}</div></div>`).join("")}</div>` : `<p class="ovz-quiet">No mounts reported.</p>`) + io;
    }
    case "net": {
      const rx = LIVE.history.rx || [], tx = LIVE.history.tx || [];
      return `<div class="ovz-tiles">${tile("Down now", rate(LIVE.net?.rx || 0))}${tile("Up now", rate(LIVE.net?.tx || 0))}${tile("Peak down", rate(Math.max(0, ...rx)))}${tile("Peak up", rate(Math.max(0, ...tx)))}</div>` +
        sec("Traffic", bigChart([{ vals: rx, cls: "c1", label: "Down" }, { vals: tx, cls: "c2", label: "Up" }], { fmt: v => rate(v) }));
    }
    case "ctr": {
      const list = (LIVE.containers || []).slice().sort((a, b) => (a.state === "running") - (b.state === "running") || a.name.localeCompare(b.name));
      return sec(`${list.length} containers`, list.length ? `<div class="ovz-list">${list.map(c => `
        <button type="button" class="ovz-li" data-zctr="${esc(c.id)}"><i class="ndot s-${c.state === "running" ? "ok" : "idle"}"></i>
          <b>${esc(c.title || c.name)}</b><span>${esc(String(c.image || "").split("/").pop())}</span><em>${esc(c.status || c.state)}</em></button>`).join("")}</div>` : `<p class="ovz-quiet">No containers.</p>`);
    }
    case "apps": {
      const checks = (CK.data?.checks || []).filter(c => c.area === "apps");
      return sec("Health checks", checks.length ? `<div class="ovz-list">${checks.map(c => {
        const app = LP.apps.find(a => "app:" + a.id === c.id);
        return `<button type="button" class="ovz-li" ${app ? `data-zapp="${esc(app.id)}"` : ""}><i class="ndot s-${statusClass(c.status)}"></i>
          <b>${esc(c.name)}</b><span>${esc(c.msg || "")}</span><em>${Number.isFinite(c.ms) ? c.ms + " ms" : statusWord(c.status)}</em></button>`; }).join("")}</div>`
        : `<p class="ovz-quiet">No app is being checked yet — give an app a local address.</p>`);
    }
    case "temp": {
      const temps = (LIVE.sensors || []).filter(s => s.kind === "temperature" && Number.isFinite(s.value)).sort((a, b) => b.value - a.value);
      return sec(`${temps.length} sensors`, `<div class="ovz-mounts">${temps.map(s => { const c = s.critical || 95, p = s.value / c * 100; return `
        <div class="ovz-mount"><div class="ovz-mrow"><b>${esc(s.label)}</b><span>limit ${Math.round(c)}°C</span><em class="${lvl(p, 85, 95)}">${Math.round(s.value)}°C</em></div>
          <div class="ovz-bar"><i class="${lvl(p, 85, 95)}" style="width:${clamp(p, 0, 100)}%"></i></div></div>`; }).join("")}</div>`);
    }
    case "up": {
      const h = LIVE.info?.host || {}, boot = LIVE.uptimeSec ? new Date(Date.now() - LIVE.uptimeSec * 1000) : null;
      return `<div class="ovz-tiles">${tile("Up for", esc(upfmt(LIVE.uptimeSec || 0)))}${tile("Booted", boot ? esc(fmtDate(boot)) : "—")}${tile("At", boot ? esc(fmtTime(boot, false, false)) : "—")}</div>` +
        sec("This machine", `<dl class="ovz-dl"><dt>Name</dt><dd>${esc(h.hostname || "—")}</dd><dt>System</dt><dd>${esc(h.distro || "—")}</dd>
          <dt>Kernel</dt><dd>${esc(h.kernel || "—")}</dd><dt>Architecture</dt><dd>${esc(h.arch || "—")}</dd>
          <dt>CPU</dt><dd>${esc(LIVE.info?.cpu?.model || "—")}${LIVE.info?.cpu?.cores ? ` · ${LIVE.info.cpu.cores} cores` : ""}</dd>
          <dt>Nexus</dt><dd>${esc(LIVE.info?.version || "")}</dd></dl>`);
    }
    case "sec": {
      const s = LIVE.security?.[24] || {};
      return `<div class="ovz-tiles">${tile("Failed logins · 24 h", s.ssh?.ok ? s.ssh.count : "?")}${tile("Security updates", s.updates?.ok ? s.updates.security || 0 : "?")}${tile("Open ports", s.ports?.ok ? s.ports.exposed : "?")}</div>` +
        sec("Findings", (s.findings || []).length ? `<div class="ovz-list">${s.findings.map(f => `<div class="ovz-li static"><i class="ndot s-${f.level === "crit" ? "crit" : f.level === "warn" ? "warn" : "idle"}"></i>
          <b>${esc(f.title)}</b><span>${esc(f.detail || "")}</span></div>`).join("")}</div>` : `<p class="ovz-quiet">Nothing found.</p>`);
    }
    case "alerts": {
      const list = (CP.alerts || []).slice(0, 12);
      return sec("Recent", list.length ? `<div class="ovz-list">${list.map(a => `<div class="ovz-li static${a.ack ? " read" : ""}"><i class="ndot s-${a.level === "crit" ? "crit" : a.level === "warn" ? "warn" : "idle"}"></i>
          <b>${esc(a.title)}</b><span>${esc(a.detail || a.message || "")}</span><em>${ago(new Date(a.ts).getTime())} ago</em></div>`).join("")}</div>` : `<p class="ovz-quiet">Nothing has tripped.</p>`) +
        ((CP.alerts || []).some(a => !a.ack) ? `<button type="button" class="btn sm" data-zack>Mark all read</button>` : "");
    }
  }
  return "";
}

function zoomOpts(key) {
  const choices = key === "temp"
    ? [["hottest", "Hottest"], ...(LIVE.sensors || []).filter(s => s.kind === "temperature").slice(0, 8).map(s => [s.label, s.label])]
    : STAT_CHOICES[key];
  const cur = OVP.opts[key] || (choices ? choices[0][0] : "");
  const i = OVP.order.indexOf(key);
  return `${choices ? `<div class="ovz-opt"><span>The card shows</span><div class="seg">${choices.map(([v, l]) =>
      `<button type="button" data-zopt="${esc(v)}" aria-pressed="${cur === v}">${esc(l)}</button>`).join("")}</div></div>` : ""}
    <div class="ovz-opt"><span>On the Overview</span>
      <button type="button" class="btn sm" data-zmove="-1"${i <= 0 ? " disabled" : ""}>${IC("chevron-left")}Earlier</button>
      <button type="button" class="btn sm" data-zmove="1"${i >= OVP.order.length - 1 ? " disabled" : ""}>Later${IC("chevron-right")}</button>
      <button type="button" class="btn sm" data-zhide>${IC(OVP.hidden.includes(key) ? "eye" : "eye-off")}${OVP.hidden.includes(key) ? "Show the card" : "Hide the card"}</button></div>`;
}

function openStatZoom(key, from) {
  closeStatZoom(true);
  const m = statModel()[key];
  if (!m) return;
  ZOOM.key = key; ZOOM.from = from;
  const dest = STAT_DEST[key] || [];
  const destLabel = { dash: "Dashboard", containers: "Containers", control: "Automations", area: AREA_META[dest[1]]?.name }[dest[0]] || "";
  const wrap = document.createElement("div");
  wrap.id = "ov-zoom";
  wrap.innerHTML = `<div class="ovz-back"></div>
    <section class="ovz" role="dialog" aria-modal="true" aria-labelledby="ovz-title">
      <div class="ovz-in">
        <header class="ovz-head">
          <div class="ovz-hl"><span class="ovz-ico">${IC(m.icon)}</span>
            <div><h3 id="ovz-title">${esc(m.label)}</h3><div class="ovz-big" id="ovz-big"></div></div></div>
          ${dest.length ? `<button type="button" class="btn sm" data-zgo>Open ${esc(destLabel)}${IC("chevron-right")}</button>` : ""}
          <button type="button" class="ovz-x" data-zclose aria-label="Close">${IC("x")}</button>
        </header>
        <div class="ovz-opts" id="ovz-opts"></div>
        <div class="ovz-body" id="ovz-body"></div>
      </div>
    </section>`;
  document.body.appendChild(wrap);
  paintZoom(true);

  const panel = $(".ovz", wrap);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";
  const a = from?.getBoundingClientRect(), b = panel.getBoundingClientRect();
  if (a && !reduced && a.width) {
    from.classList.add("ov-lifted");
    panel.animate([
      { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, borderRadius: "14px" },
      { transform: "none" }
    ], { duration: 420, easing: "cubic-bezier(.2,.9,.25,1)" });
    $(".ovz-in", wrap).animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      { duration: 260, delay: 170, easing: "ease-out", fill: "backwards" });
    $(".ovz-back", wrap).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
  }
  setTimeout(() => $("[data-zclose]", wrap)?.focus({ preventScroll: true }), 60);

  wrap.addEventListener("click", e => {
    if (e.target.classList.contains("ovz-back") || e.target.closest("[data-zclose]")) return closeStatZoom();
    if (e.target.closest("[data-zgo]")) { closeStatZoom(true); return go(dest[0], dest[1] || null); }
    const opt = e.target.closest("[data-zopt]");
    if (opt) { OVP.opts[key] = opt.dataset.zopt; saveOvPrefs(); paintStats(); return paintZoom(true); }
    const mv = e.target.closest("[data-zmove]");
    if (mv) {
      const i = OVP.order.indexOf(key), j = i + Number(mv.dataset.zmove);
      if (j < 0 || j >= OVP.order.length) return;
      [OVP.order[i], OVP.order[j]] = [OVP.order[j], OVP.order[i]];
      saveOvPrefs(); paintStats(); return paintZoom(true);
    }
    if (e.target.closest("[data-zhide]")) {
      OVP.hidden = OVP.hidden.includes(key) ? OVP.hidden.filter(x => x !== key) : [...OVP.hidden, key];
      saveOvPrefs(); paintStats(); return paintZoom(true);
    }
    const ctr = e.target.closest("[data-zctr]");
    if (ctr) { closeStatZoom(true); return manageFromAnywhere(ctr.dataset.zctr); }
    const app = e.target.closest("[data-zapp]");
    if (app) return openApp(LP.apps.find(x => x.id === app.dataset.zapp));
    if (e.target.closest("[data-zack]")) {
      api("/automation/alerts/ack", { method: "POST" }).then(() => api("/automation/alerts?limit=60"))
        .then(a => { CP.alerts = a; paintAlertBadge(); paintStats(); }).catch(err => toast(err.message, "err"));
    }
  });
}

function paintZoom(force = false) {
  const wrap = $("#ov-zoom");
  if (!wrap || !ZOOM.key) return;
  const m = statModel()[ZOOM.key];
  if (!m) return;
  const big = `<b>${m.value}</b>${m.unit ? `<i>${esc(m.unit)}</i>` : ""}<span>${m.sub || ""}</span>`;
  const set = (id, html) => { const el = $(id, wrap); if (el && (force || el.dataset.sig !== html)) { el.innerHTML = html; el.dataset.sig = html; } };
  set("#ovz-big", big);
  set("#ovz-opts", zoomOpts(ZOOM.key));
  set("#ovz-body", zoomBody(ZOOM.key));
}

function closeStatZoom(instant = false) {
  const wrap = $("#ov-zoom");
  const from = ZOOM.from;
  ZOOM.key = null; ZOOM.from = null;
  if (!wrap) return;
  let gone = false;
  const done = () => { if (gone) return; gone = true; wrap.remove(); from?.classList.remove("ov-lifted"); };
  // An animation in a background tab never finishes; never leave the panel up.
  setTimeout(done, 480);
  const panel = $(".ovz", wrap);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";
  // The card may have moved or been hidden while the panel was open.
  const target = from && document.contains(from) ? from : $(`#ov-stats .ov-stat[data-stat="${from?.dataset?.stat}"]`);
  if (instant || reduced || !panel || !target) return done();
  const a = target.getBoundingClientRect(), b = panel.getBoundingClientRect();
  $(".ovz-in", wrap).animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" });
  $(".ovz-back", wrap).animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
  panel.animate([{ transform: "none" },
    { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})` }],
    { duration: 320, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }).finished.then(done, done);
}
addEventListener("keydown", e => { if (e.key === "Escape" && ZOOM.key) { e.stopPropagation(); closeStatZoom(); } }, true);

/* ---------- the areas table ---------- */

function checkTarget(c) {
  if (!c.target) return "";
  if (c.kind === "container") return c.target;
  return c.target;
}

function checkRow(c, { detail = false } = {}) {
  const kindLabel = { http: "HTTP", tcp: "TCP", ping: "Ping", dns: "DNS", container: "Container", disk: "Mount", smart: "SMART", derived: "Reading" }[c.kind] || c.kind;
  return `<div class="ar-row check s-${statusClass(c.status)}" data-check="${esc(c.id)}">
    <span class="ar-name"><span class="ar-kind">${esc(kindLabel)}</span><span class="ar-nm"><b>${esc(c.name)}</b>
      ${detail && c.target ? `<small class="mono">${esc(checkTarget(c))}</small>` : c.msg ? `<small>${esc(c.msg)}</small>` : ""}</span></span>
    <span class="ar-health s-${statusClass(c.status)}">${IC(statusIcon(c.status))}${esc(statusWord(c.status))}</span>
    <span class="ar-checks">${c.uptime != null ? `${c.uptime}%` : "—"}</span>
    <span class="ar-resp">${Number.isFinite(c.ms) ? c.ms + " ms" : "—"}</span>
    <span class="ar-results">${resultBars(c.history)}</span>
    ${detail ? `<span class="ar-more">
        ${c.msg ? `<span class="ar-msg">${esc(c.msg)}</span>` : ""}
        <span class="ar-since">${statusWord(c.status)} since ${hhmm(c.since)} (${ago(c.since)})</span>
        ${c.custom ? `<button class="ar-act" data-edit-check="${esc(c.id)}" aria-label="Edit">${IC("edit")}</button>
                      <button class="ar-act danger" data-del-check="${esc(c.id)}" aria-label="Delete">${IC("trash")}</button>` : ""}
      </span>` : ""}
  </div>`;
}

function paintAreasTable(box, areas) {
  if (!box) return;
  if (!CK.data) { box.innerHTML = `<div class="ov-empty">Loading checks…</div>`; return; }
  const checks = CK.data.checks || [];
  const head = `<div class="ar-row head"><span>Name</span><span>Health</span><span>Checks</span><span>Response</span><span>Results</span></div>`;
  const rows = areas.map(a => {
    const m = AREA_META[a.id] || { name: a.name, icon: "activity" };
    const open = CK.open.has(a.id);
    const mine = checks.filter(c => c.area === a.id);
    return `<div class="ar-group${open ? " open" : ""}">
      <div class="ar-row area" data-toggle-area="${esc(a.id)}" role="button" tabindex="0" aria-expanded="${open}">
        <span class="ar-name">${IC("chevron-right", "ar-chev")}<span class="ar-tile t-${esc(a.id)}">${IC(m.icon)}</span>
          <b class="ar-link" data-go="area" data-arg="${esc(a.id)}">${esc(m.name)}</b></span>
        <span class="ar-health s-${statusClass(a.status)}">${IC(statusIcon(a.status))}${esc(statusWord(a.status))}</span>
        <span class="ar-checks">${a.checks ? ring(a.up, a.total, a.status) + `${a.up} / ${a.total}` : "—"}</span>
        <span class="ar-resp">${a.avgMs != null ? a.avgMs + " ms" : "—"}</span>
        <span class="ar-results">${resultBars(a.history)}</span>
      </div>
      ${open ? `<div class="ar-sub">${mine.map(c => checkRow(c)).join("") || `<div class="ov-empty">No checks in this area.</div>`}</div>` : ""}
    </div>`;
  }).join("");
  const html = `<div class="ar-table">${head}${rows}</div>`;
  if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
}

on("#ov-areas", "click", e => {
  if (e.target.closest("[data-go]")) return;           // the name is a link to the area page
  const t = e.target.closest("[data-toggle-area]");
  if (!t) return;
  const id = t.dataset.toggleArea;
  if (CK.open.has(id)) CK.open.delete(id); else CK.open.add(id);
  paintAreasTable($("#ov-areas"), CK.data?.areas || []);
});
on("#ov-areas", "keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-toggle-area]")) { e.preventDefault(); e.target.click(); }
});

/* ---------- one area ---------- */

function paintArea() {
  if (!$("#page-area")?.classList.contains("on")) return;
  const id = curArg;
  const m = AREA_META[id] || { name: id, icon: "activity", sub: "" };
  const a = CK.data?.areas?.find(x => x.id === id);
  const checks = (CK.data?.checks || []).filter(c => c.area === id)
    .sort((x, y) => (statusClass(y.status) === "crit") - (statusClass(x.status) === "crit") || x.name.localeCompare(y.name));
  const sum = $("#ar-summary");
  if (sum) {
    const html = a ? `
      <div class="ar-sumcard s-${statusClass(a.status)}">
        <span class="ar-tile lg t-${esc(id)}">${IC(m.icon)}</span>
        <div><h2>${esc(m.name)} <span class="ar-health s-${statusClass(a.status)}">${IC(statusIcon(a.status))}${esc(statusWord(a.status))}</span></h2>
          <p>${a.checks ? `${a.up} of ${a.total} passing${a.checks > a.total ? ` · ${a.checks - a.total} idle or unknown` : ""}${a.avgMs != null ? ` · average response ${a.avgMs} ms` : ""}` : "No checks in this area yet."}</p></div>
        <span class="spacer"></span>
        ${resultBars(a.history, 30)}
      </div>` : `<div class="ov-empty">Loading…</div>`;
    if (sum.dataset.sig !== html) { sum.innerHTML = html; sum.dataset.sig = html; }
  }
  const box = $("#ar-checks");
  if (box) {
    const head = `<div class="ar-row head"><span>Check</span><span>Health</span><span>Uptime</span><span>Response</span><span>Results</span></div>`;
    const html = CK.data
      ? `<div class="ar-table detail">${head}${checks.map(c => checkRow(c, { detail: true })).join("") ||
          `<div class="ov-empty">Nothing is checked here yet${id === "apps" ? " — give an app on the Apps page a local address and it will be watched" : ""}. Press <b>Add check</b> to watch a web address, a port, a host or a DNS name.</div>`}</div>`
      : `<div class="ov-empty">Loading checks…</div>`;
    if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
  }
  const note = $("#ar-note");
  if (note && CK.data) {
    const n = CK.data.config?.notify;
    note.innerHTML = `A check that fails three rounds in a row raises an alert${n ? " and is sent to your notification webhook" : ""}; recovery is announced once, and a check that keeps bouncing alerts at most every 15 minutes.
      <button class="linkbtn" id="ar-notify">${n ? "Stop sending check alerts to the webhook" : "Send check alerts to the webhook too"}</button>`;
  }
}

on("#page-area", "click", async e => {
  if (e.target.closest("#ar-notify")) {
    try { CK.data = await api("/checks/config", { method: "PUT", body: { notify: !CK.data?.config?.notify } }); paintArea(); toast("Saved", "ok"); }
    catch (ex) { toast(ex.message, "err"); }
    return;
  }
  const ed = e.target.closest("[data-edit-check]");
  if (ed) return editCheck(customOf(ed.dataset.editCheck));
  const del = e.target.closest("[data-del-check]");
  if (del) {
    const c = customOf(del.dataset.delCheck);
    if (!c || !confirm(`Stop checking "${c.name}"?`)) return;
    saveCustom((CK.data.config.custom || []).filter(x => x.id !== c.id), "Check removed");
  }
});
const customOf = checkId => (CK.data?.config?.custom || []).find(c => "custom:" + c.id === checkId);

async function saveCustom(list, msg) {
  try {
    CK.data = await api("/checks/config", { method: "PUT", body: { custom: list } });
    toast(msg || "Saved", "ok");
    paintArea(); paintOverview(); paintSidebarAreas();
    setTimeout(() => loadChecks(), 2500);       // the first probe of a new check
  } catch (ex) { toast(ex.message, "err"); }
}

function editCheck(existing) {
  const c = existing || { kind: "http", area: curPage === "area" ? curArg : "network", name: "", target: "" };
  const hints = {
    http: ["https://192.168.1.50:8096", "Any answer below HTTP 500 counts as up — a login page is an app that is running."],
    tcp: ["192.168.1.1:53", "Up when the port accepts a connection."],
    ping: ["192.168.1.1", "One ICMP echo, through the system ping."],
    dns: ["example.com", "Up when the name resolves through this box's DNS."]
  };
  const body = document.createElement("div");
  body.className = "formgrid";
  body.innerHTML = `
    <label>Type
      <select id="ck-kind">${["http", "tcp", "ping", "dns"].map(k => `<option value="${k}"${c.kind === k ? " selected" : ""}>${{ http: "Web address (HTTP)", tcp: "Port (TCP)", ping: "Host (ping)", dns: "DNS name" }[k]}</option>`).join("")}</select></label>
    <label>Target <input id="ck-target" type="text" spellcheck="false" autocapitalize="none" value="${esc(c.target)}"></label>
    <p class="hint" id="ck-hint"></p>
    <label>Name <input id="ck-name" type="text" maxlength="48" value="${esc(c.name)}" placeholder="What to call it"></label>
    <label>Area
      <select id="ck-area">${Object.entries(AREA_META).map(([k, v]) => `<option value="${k}"${c.area === k ? " selected" : ""}>${v.name}</option>`).join("")}</select></label>`;
  openModal({
    title: existing ? "Edit check" : "Add a check", icon: ICON("network"), body,
    foot: `<span class="spacer"></span><button class="btn primary" id="ck-save" type="button">${existing ? "Save" : "Add check"}</button>`
  });
  const paintHint = () => {
    const [ph, hint] = hints[$("#ck-kind").value];
    $("#ck-target").placeholder = ph;
    $("#ck-hint").textContent = hint;
  };
  paintHint();
  on("#ck-kind", "change", paintHint);
  on("#ck-save", "click", () => {
    const next = { id: existing?.id, kind: $("#ck-kind").value, target: $("#ck-target").value.trim(),
                   name: $("#ck-name").value.trim(), area: $("#ck-area").value };
    if (!next.target) return toast("Give it a target", "err");
    const list = (CK.data?.config?.custom || []).filter(x => x.id !== existing?.id);
    const before = list.length;
    closeModal();
    saveCustom([...list, next], existing ? "Check saved" : "Check added").then(() => {
      if ((CK.data?.config?.custom || []).length === before) toast("That target was not accepted — check its format", "err");
    });
  });
}
on("#ov-run", "click", async e => { e.currentTarget.disabled = true; await loadChecks(true); e.currentTarget.disabled = false; toast("Checks run", "ok"); });
on("#ar-run", "click", async e => { e.currentTarget.disabled = true; await loadChecks(true); e.currentTarget.disabled = false; toast("Checks run", "ok"); });
on("#ar-add", "click", () => editCheck(null));

/* ---------- live repaint ---------- */

let liveRaf = 0, liveLast = 0;
/** Metrics frames arrive every two seconds; the Overview repaints with them. */
function onLiveFrame() {
  if (document.hidden || curPage !== "overview" || liveRaf) return;
  if (Date.now() - liveLast < 900) return;
  liveRaf = requestAnimationFrame(() => {
    liveRaf = 0; liveLast = Date.now();
    paintStats();
    paintHero();
  });
}

/** Status dots on the launcher tiles — repainted in place when a check round
 *  lands, so a reading every fifteen seconds never rebuilds the board. */
function paintLauncherStatus() {
  $$("#l-grid .ltile[data-id]").forEach(t => {
    const a = LP.apps.find(x => x.id === t.dataset.id);
    if (!a) return;
    const st = appStatus(a);
    const dot = $(".lstat", t);
    if (dot) {
      dot.className = "lstat s-" + statusClass(st) + (st === "empty" ? " none" : "");
      dot.setAttribute("data-tip", statusTip(a));
    }
    const pill = $("[data-lpill]", t);
    if (pill) { pill.className = "lpill s-" + statusClass(st); pill.textContent = pillText(a); }
  });
  $$("#l-grid .lsec").forEach(sec => {
    const s = $(".lsecsum", sec);
    if (!s) return;
    const apps = $$(".ltile[data-id]", sec).map(t => LP.apps.find(x => x.id === t.dataset.id)).filter(Boolean);
    const up = apps.filter(a => appStatus(a) === "up").length;
    const bad = apps.filter(a => ["warn", "down"].includes(appStatus(a))).length;
    s.innerHTML = bad ? `<span class="s-crit"><i class="ndot"></i>${bad} need${bad === 1 ? "s" : ""} a look</span>`
      : apps.length && up === apps.length ? `<span class="s-ok"><i class="ndot"></i>All up</span>` : "";
  });
  paintFilter();
}

/* ============================ command palette ============================
 * Ctrl/⌘+K anywhere, or "/" when not typing. Everything it searches is already
 * in memory — pages, areas, apps, containers, checks, actions — so typing never
 * waits on the network. The last row always offers to ask Kernel instead.
 */
const PAL = { items: [], shown: [], sel: 0, open: false, last: null };

function paletteSources() {
  const out = [];
  const add = (group, label, opts) => out.push({ group, label, ...opts });
  for (const [k, v] of Object.entries(PAGES)) {
    if (k === "area") continue;
    add("Pages", v.title, { icon: v.icon, hint: v.sub, run: () => go(k) });
  }
  for (const [k, v] of Object.entries(AREA_META)) {
    const a = CK.data?.areas?.find(x => x.id === k);
    add("Areas", v.name, { icon: v.icon, hint: a ? statusWord(a.status) + (a.total ? ` · ${a.up}/${a.total}` : "") : v.sub,
      dot: a ? statusClass(a.status) : null, run: () => go("area", k) });
  }
  for (const a of LP.apps) {
    add("Apps", a.name, { iconHTML: appIconHTML(a), hint: a.desc || (a.locked ? "needs the PIN" : a.url || ""),
      dot: statusClass(appStatus(a)), keys: (a.tags || []).join(" "), run: () => openApp(a) });
  }
  for (const c of LIVE.containers || []) {
    add("Containers", c.title || c.name, { icon: "box", hint: `${c.state} · ${c.image}`,
      dot: c.state === "running" ? "ok" : "idle", keys: c.name, run: () => manageFromAnywhere(c.id) });
  }
  for (const c of (CK.data?.checks || []).filter(c => !c.id.startsWith("ctr:") && !c.id.startsWith("app:"))) {
    add("Checks", c.name, { icon: AREA_META[c.area]?.icon || "activity", hint: `${AREA_META[c.area]?.name || c.area} · ${c.msg || statusWord(c.status)}`,
      dot: statusClass(c.status), run: () => go("area", c.area) });
  }
  const A = window.NexusAppearance;
  const acts = [
    ["Open Claude Code", "code", () => go("term", "claude")],
    ["Run all health checks now", "refresh", () => loadChecks(true).then(() => toast("Checks run", "ok"))],
    ["Add a health check", "plus", () => { go("area", curPage === "area" ? curArg : "network"); setTimeout(() => editCheck(null), 50); }],
    ["Add a widget", "layout", () => { go("dash"); renderDrawer(); $("#drawer").classList.add("open"); }],
    ["Add an app", "grid", () => { go("apps"); setTimeout(() => editApp(null), 50); }],
    ["New watch rule", "zap", () => { go("control", "rules"); setTimeout(() => $("#cp-new-rule")?.click(), 150); }],
    ["Install from GitHub", "store", () => { go("store"); setTimeout(() => openGitHubInstall(), 50); }],
    ["Open Kernel", "sparkles", () => toggleKernel(true)],
    ["New Kernel conversation", "message", () => { toggleKernel(true); newChat(); }],
    [document.documentElement.dataset.theme === "dark" ? "Switch to light mode" : "Switch to dark mode", "moon", () => A?.toggleMode()],
    [A?.glass ? "Turn glass panels off" : "Turn glass panels on", "sparkles", () => A?.setGlass(!A.glass)],
    [document.body.classList.contains("rail-mini") ? "Expand the sidebar" : "Collapse the sidebar", "sidebar", () => setRailMini(!document.body.classList.contains("rail-mini"))],
    ["Keyboard shortcuts", "keyboard", () => showShortcuts()],
    ["Sign out", "logout", () => $("#logout")?.click()]
  ];
  for (const [label, icon, run] of acts) add("Actions", label, { icon, run });
  return out;
}

/** Higher is better; 0 is no match. Prefix beats word-start beats substring beats scattered letters. */
function fuzzy(q, s) {
  if (!q) return 1;
  s = s.toLowerCase();
  if (s.startsWith(q)) return 100 - s.length / 100;
  const at = s.indexOf(q);
  if (at > 0 && /[\s\-_./·]/.test(s[at - 1])) return 80 - at / 100;
  if (at >= 0) return 60 - at / 100;
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i === q.length ? 20 : 0;
}

function openPalette(prefill = "") {
  const box = $("#cmdk");
  if (!box) return;
  PAL.items = paletteSources();
  PAL.open = true;
  PAL.last = document.activeElement;
  box.hidden = false;
  const q = $("#ck-q");
  q.value = prefill;
  filterPalette();
  requestAnimationFrame(() => { q.focus(); q.select(); });
}
function closePalette() {
  const box = $("#cmdk");
  if (!box || box.hidden) return;
  box.hidden = true;
  PAL.open = false;
  try { PAL.last?.focus?.({ preventScroll: true }); } catch {}
}
function filterPalette() {
  const q = $("#ck-q").value.trim().toLowerCase();
  const scored = PAL.items
    .map(it => ({ it, s: Math.max(fuzzy(q, it.label), fuzzy(q, it.keys || "") * 0.8, q.length > 2 ? fuzzy(q, it.hint || "") * 0.5 : 0) }))
    .filter(x => x.s > 0);
  if (q) scored.sort((a, b) => b.s - a.s);
  const order = ["Pages", "Areas", "Apps", "Containers", "Checks", "Actions"];
  let list = q ? scored.slice(0, 40).map(x => x.it)
    : order.flatMap(g => scored.filter(x => x.it.group === g).slice(0, g === "Pages" || g === "Areas" ? 10 : 6).map(x => x.it));
  if (q) list.push({ group: "Kernel", label: `Ask Kernel: “${$("#ck-q").value.trim()}”`, icon: "sparkles",
    run: () => askKernel($("#ck-q").value.trim()) });
  PAL.shown = list;
  PAL.sel = 0;
  paintPalette();
}
function paintPalette() {
  const box = $("#ck-list");
  let group = null, i = 0;
  box.innerHTML = PAL.shown.map(it => {
    const head = it.group !== group ? `<div class="ck-group">${esc(it.group)}</div>` : "";
    group = it.group;
    const idx = i++;
    return head + `<div class="ck-item${idx === PAL.sel ? " on" : ""}" role="option" id="ck-o${idx}" data-i="${idx}" aria-selected="${idx === PAL.sel}">
      <span class="ck-ico">${it.iconHTML || IC(it.icon || "chevron-right")}</span>
      <span class="ck-label">${esc(it.label)}</span>
      ${it.hint ? `<span class="ck-hint">${esc(it.hint)}</span>` : ""}
      ${it.dot ? `<span class="ndot s-${it.dot}"></span>` : ""}
    </div>`;
  }).join("") || `<div class="ck-empty">Nothing matches.</div>`;
  wireIcons(box);
  $("#ck-q").setAttribute("aria-activedescendant", PAL.shown.length ? "ck-o" + PAL.sel : "");
  $(".ck-item.on", box)?.scrollIntoView({ block: "nearest" });
}
function runPalette(i) {
  const it = PAL.shown[i];
  if (!it) return;
  closePalette();
  try { it.run(); } catch (e) { console.error("[nexus] palette:", e); }
}
on("#ck-q", "input", filterPalette);
on("#ck-q", "keydown", e => {
  if (e.key === "ArrowDown") { e.preventDefault(); PAL.sel = Math.min(PAL.shown.length - 1, PAL.sel + 1); paintPalette(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); PAL.sel = Math.max(0, PAL.sel - 1); paintPalette(); }
  else if (e.key === "Enter") { e.preventDefault(); runPalette(PAL.sel); }
  else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
});
on("#ck-list", "click", e => { const it = e.target.closest(".ck-item"); if (it) runPalette(Number(it.dataset.i)); });
on("#ck-list", "pointermove", e => {
  const it = e.target.closest(".ck-item");
  if (it && Number(it.dataset.i) !== PAL.sel) { PAL.sel = Number(it.dataset.i); $$(".ck-item", $("#ck-list")).forEach(n => n.classList.toggle("on", n === it)); }
});
on("#cmdk", "pointerdown", e => { if (e.target.id === "cmdk") closePalette(); });

/* ============================ keyboard ============================ */
function showShortcuts() {
  const k = /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘" : "Ctrl";
  const rows = [
    [`${k} K`, "Search everything"], ["/", "Search everything"], [`${k} J`, "Open or close Kernel"],
    ["g then o", "Overview"], ["g then d", "Dashboard"], ["g then a", "Apps"], ["g then c", "Containers"],
    ["g then f", "Files"], ["g then t", "Terminal"], ["g then s", "Settings"], ["g then u", "Automations"],
    ["r", "Refresh this page"], ["?", "This list"], ["Esc", "Close whatever is open"]
  ];
  openModal({
    title: "Keyboard shortcuts", icon: ICON("settings"),
    body: `<div class="kbd-list">${rows.map(([a, b]) => `<div><span>${a.split(" ").map(x => x === "then" ? "then" : `<kbd>${esc(x)}</kbd>`).join(" ")}</span><b>${esc(b)}</b></div>`).join("")}</div>`
  });
}

let gPending = 0;
addEventListener("keydown", e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); PAL.open ? closePalette() : openPalette(); return; }
  if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); toggleKernel(); return; }
  if (e.key === "Escape" && PAL.open) { closePalette(); return; }
  if (mod || e.altKey || typingInto(document.activeElement) || $("#app").hidden) return;
  if (modal.classList.contains("open") || PAL.open) return;
  const k = e.key;
  if (gPending && Date.now() - gPending < 1200) {
    gPending = 0;
    const map = { o: "overview", d: "dash", a: "apps", c: "containers", f: "files", t: "term", s: "settings", u: "control", p: "store" };
    if (map[k]) { e.preventDefault(); go(map[k]); }
    return;
  }
  if (k === "g") { gPending = Date.now(); return; }
  if (k === "/") { e.preventDefault(); openPalette(); return; }
  if (k === "?") { e.preventDefault(); showShortcuts(); return; }
  if (k === "r" && curPage !== "term") { e.preventDefault(); $("#tb-refresh")?.click(); }
});


/* ==================== Kernel — the Nexus Expert ====================
 * A panel on every page, an agent behind it, and a settings section that
 * decides what that agent is allowed to touch.
 *
 * What changed in 0.9, and why:
 *
 *  - **Turns run in the background.** The panel used to hold one HTTP request
 *    open for the whole turn. Behind Nginx Proxy Manager that request is cut at
 *    60 seconds, so a turn with a few tool calls showed an error while it went on
 *    and finished unseen. Now `send` returns at once and the panel polls the
 *    transcript: every tool step appears as it happens, and a reload in the
 *    middle of a turn picks it back up.
 *  - **Stop** is a real button, checked by the server between steps.
 *  - **Rendering is incremental.** Every repaint used to rebuild every message,
 *    which closed any tool detail you had opened and threw the scroll position
 *    away. Messages are now appended, and a message is rebuilt only when it
 *    actually changed.
 *  - Conversations moved from a cramped tab strip (with a close button nested
 *    inside each tab button) into a history menu.
 *  - It can dock to the side as a full-height panel, and it can be glass.
 */

const KX = {
  run: null,          // current conversation id
  chats: [],          // newest first
  busy: false,        // a turn is running on the server
  sending: false,     // a request is in flight from this browser
  cfg: null,          // last /agent/config payload
  steps: [],
  pending: null,
  atts: [],           // images picked or pasted but not sent yet
  usage: { in: 0, out: 0, cost: 0 },
  startedAt: 0,
  stopping: false,    // Stop was pressed and the server has not finished yet
  poll: null,
  keys: [],           // what is on screen: one key per rendered step
  open: new Set()     // tool details the owner has expanded, by step index
};

const tok = n => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n || 0);
/* `priced === false` means we have no rate for that model, which is not the
   same as it being free — a local model really is free, and saying "$0" for
   both would make one of them a lie. */
const money = (n, priced = true) =>
  priced === false ? "no rate" : n >= 1 ? "$" + n.toFixed(2) : n > 0 ? "$" + n.toFixed(4) : "$0.00";

/* ---------------- mounting ---------------- */

function mountKernel() {
  on("#kernel-open", "click", () => toggleKernel());
  on("#kx-close", "click", () => toggleKernel(false));
  on("#kx-config", "click", () => { toggleKernel(false); go("settings", "kernel"); });
  on("#kx-reset", "click", () => resetPanel());
  on("#kx-add", "click", () => newChat());
  on("#kx-dock", "click", () => setDock(!$("#kernel").classList.contains("docked")));
  on("#kx-hist", "click", e => { e.stopPropagation(); toggleHistory(); });

  const input = $("#kx-input");
  on("#kx-compose", "submit", e => { e.preventDefault(); kernelSend(); });
  if (input) {
    // Enter sends, Shift+Enter is a newline. A chat box that needs a mouse to
    // send is a chat box nobody uses twice.
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); kernelSend(); }
      if (e.key === "ArrowUp" && !input.value) {
        // Up on an empty box brings back the last thing you asked, like a shell.
        const last = [...KX.steps].reverse().find(s => s.kind === "user" && s.text);
        if (last) { e.preventDefault(); input.value = last.text; growInput(); }
      }
    });
    input.addEventListener("input", growInput);
    // A screenshot in the clipboard is the common case, so it needs no button.
    input.addEventListener("paste", e => {
      const files = [...(e.clipboardData?.items || [])]
        .filter(i => i.kind === "file" && i.type.startsWith("image/"))
        .map(i => i.getAsFile()).filter(Boolean);
      if (!files.length) return;
      e.preventDefault();
      addAttachments(files);
    });
  }

  on("#kx-attach", "click", () => $("#kx-file")?.click());
  on("#kx-file", "change", e => { addAttachments([...e.target.files]); e.target.value = ""; });
  on("#kx-atts", "click", e => {
    const b = e.target.closest("[data-drop]");
    if (!b) return;
    const [gone] = KX.atts.splice(Number(b.dataset.drop), 1);
    if (gone?.url) URL.revokeObjectURL(gone.url);
    paintAttachments();
  });

  // Dropping an image on the panel is the same gesture as pasting one.
  const panel = $("#kernel");
  if (panel) {
    panel.addEventListener("dragover", e => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); panel.classList.add("dropping"); } });
    panel.addEventListener("dragleave", e => { if (e.target === panel) panel.classList.remove("dropping"); });
    panel.addEventListener("drop", e => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      panel.classList.remove("dropping");
      addAttachments([...e.dataTransfer.files].filter(f => f.type.startsWith("image/")));
    });
    // Esc closes the panel when the focus is inside it — and closes the
    // history menu first if that is open.
    panel.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (!$("#kx-histmenu").hidden) { toggleHistory(false); return; }
      toggleKernel(false);
      $("#tb-kernel")?.focus();
    });
  }

  on("#kx-body", "click", async e => {
    const b = e.target.closest("[data-copy]");
    if (b) return copyText(KX.steps[Number(b.dataset.copy)]?.text || "", b);
    const cb = e.target.closest("[data-ccopy]");
    if (cb) return copyText(cb.closest("pre")?.querySelector("code")?.textContent || "", cb);
    const retry = e.target.closest("[data-retry]");
    if (retry) {
      const last = [...KX.steps].reverse().find(s => s.kind === "user" && s.text);
      if (last) kernelSend(last.text);
      return;
    }
    const sug = e.target.closest("[data-suggest]");
    if (sug) return kernelSend(sug.dataset.suggest);
    if (e.target.closest("[data-kx-setup]")) { toggleKernel(false); go("settings", "kernel"); return; }
    const img = e.target.closest("[data-shot]");
    if (img) openShot(img.dataset.shot, img.dataset.name);
  });
  // Remember which tool details are open, so a repaint cannot close them.
  $("#kx-body")?.addEventListener("toggle", e => {
    const d = e.target;
    if (!d.matches?.("details[data-step]")) return;
    const i = Number(d.dataset.step);
    if (d.open) KX.open.add(i); else KX.open.delete(i);
  }, true);

  on("#kx-status", "click", e => { if (e.target.closest("[data-stop]")) kernelStop(); });
  on("#kx-histmenu", "click", e => {
    const del = e.target.closest("[data-shut]");
    if (del) { e.stopPropagation(); return shutChat(del.dataset.shut); }
    if (e.target.closest("[data-newchat]")) { toggleHistory(false); return newChat(); }
    const c = e.target.closest("[data-chat]");
    if (c) { toggleHistory(false); switchChat(c.dataset.chat); }
  });
  document.addEventListener("click", e => {
    if (!$("#kx-histmenu")?.hidden && !e.target.closest("#kx-histmenu, #kx-hist")) toggleHistory(false);
  });

  wirePanelGeometry();

  // Remembered per browser, like every other display preference here.
  try {
    if (localStorage.getItem("nexus.kernel.dock") === "1") $("#kernel").classList.add("docked");
    if (localStorage.getItem("nexus.kernel.open") === "1") toggleKernel(true);
  } catch {}
  refreshAgentConfig();
  loadChats();
}

function growInput() {
  const input = $("#kx-input");
  if (!input) return;
  input.style.height = "auto";
  input.style.height = Math.min(180, input.scrollHeight) + "px";
}

/* Kernel's copy buttons use copyText(text, btn) from the terminal section: the
   one copy routine, which also works on a plain-http LAN address. */

/* ---- where the panel sits, and how big it is ----
 * Both are the owner's, both are remembered per browser, and both are ignored
 * on a small screen where the panel is the page rather than a card on it.
 */
const PANEL_MIN = { w: 340, h: 380 };
const floating = () => innerWidth > 640 && !$("#kernel")?.classList.contains("docked");

function panelGeom() {
  try { return JSON.parse(localStorage.getItem("nexus.kernel.geom") || "{}"); } catch { return {}; }
}
function saveGeom(g) {
  try { localStorage.setItem("nexus.kernel.geom", JSON.stringify(g)); } catch {}
}

function applyGeom() {
  const panel = $("#kernel");
  if (!panel) return;
  const docked = panel.classList.contains("docked");
  if (docked && innerWidth > 640) {
    const w = clamp(panelGeom().dw || 420, 340, Math.min(720, innerWidth - 320));
    panel.style.cssText = "";
    document.documentElement.style.setProperty("--kx-dock-w", w + "px");
    document.body.classList.toggle("kx-docked", !panel.hidden);
    return;
  }
  document.body.classList.remove("kx-docked");
  if (!floating()) { panel.style.cssText = ""; return; }
  const g = panelGeom();
  const w = Math.max(PANEL_MIN.w, Math.min(g.w || 430, innerWidth - 16));
  const h = Math.max(PANEL_MIN.h, Math.min(g.h || 640, innerHeight - 16));
  panel.style.width = w + "px";
  panel.style.height = h + "px";
  if (g.x != null && g.y != null) {
    // Clamped on every apply, so a panel parked off the edge of a big monitor
    // comes back when the window is small.
    panel.style.left = Math.max(8, Math.min(g.x, innerWidth - w - 8)) + "px";
    panel.style.top = Math.max(8, Math.min(g.y, innerHeight - h - 8)) + "px";
    panel.style.right = "auto"; panel.style.bottom = "auto";
  } else {
    panel.style.left = "auto"; panel.style.top = "auto";
    panel.style.right = ""; panel.style.bottom = "";
  }
}

function resetPanel() {
  saveGeom({});
  setDock(false);
  applyGeom();
  toast("Panel back in the corner", "ok");
}

function setDock(on_) {
  const panel = $("#kernel");
  if (!panel) return;
  panel.classList.toggle("docked", !!on_);
  try { localStorage.setItem("nexus.kernel.dock", on_ ? "1" : "0"); } catch {}
  const b = $("#kx-dock");
  if (b) {
    b.setAttribute("aria-label", on_ ? "Float the panel" : "Dock to the side");
    b.setAttribute("data-tip", on_ ? "Float the panel" : "Dock to the side");
    b.classList.toggle("on", !!on_);
  }
  applyGeom();
  requestAnimationFrame(() => { layout(false); if (term && $("#page-term").classList.contains("on")) fitTerm(); });
}

function wirePanelGeometry() {
  const panel = $("#kernel"), head = $("#kx-head");
  if (!panel || !head) return;
  setDock(panel.classList.contains("docked"));
  addEventListener("resize", applyGeom);

  // Dragging by the header. Buttons in it are still buttons.
  head.addEventListener("pointerdown", e => {
    if (!floating() || e.button !== 0 || e.target.closest("button")) return;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    let moved = false;
    const mv = ev => {
      if (!moved && Math.abs(ev.clientX - e.clientX) < 3 && Math.abs(ev.clientY - e.clientY) < 3) return;
      moved = true;
      panel.classList.add("moving");
      saveGeom({ ...panelGeom(), w: r.width, h: r.height, x: ev.clientX - dx, y: ev.clientY - dy });
      applyGeom();
    };
    const up = () => {
      head.removeEventListener("pointermove", mv);
      removeEventListener("pointerup", up);
      panel.classList.remove("moving");
      try { head.releasePointerCapture(e.pointerId); } catch {}
    };
    try { head.setPointerCapture(e.pointerId); } catch {}
    head.addEventListener("pointermove", mv);
    addEventListener("pointerup", up);
  });

  // Resizing from the top and left edges — the panel sits in the bottom-right
  // corner, so those are the two edges with room in front of them. Docked, the
  // left edge sets the dock's width.
  $$(".kx-grip", panel).forEach(grip => {
    grip.addEventListener("pointerdown", e => {
      if (e.button !== 0 || innerWidth <= 640) return;
      const docked = panel.classList.contains("docked");
      if (docked && grip.dataset.grip !== "w") return;
      e.preventDefault();
      const r = panel.getBoundingClientRect();
      const dir = grip.dataset.grip;
      const mv = ev => {
        const g = { ...panelGeom() };
        if (docked) { g.dw = clamp(innerWidth - ev.clientX, 340, Math.min(720, innerWidth - 320)); saveGeom(g); applyGeom(); return; }
        if (dir.includes("w")) {
          g.w = Math.max(PANEL_MIN.w, Math.min(r.right - ev.clientX, innerWidth - 16));
          g.x = r.right - g.w;
        } else g.w = r.width;
        if (dir.includes("n")) {
          g.h = Math.max(PANEL_MIN.h, Math.min(r.bottom - ev.clientY, innerHeight - 16));
          g.y = r.bottom - g.h;
        } else g.h = r.height;
        if (g.x == null) g.x = r.left;
        if (g.y == null) g.y = r.top;
        panel.classList.add("moving");
        saveGeom(g); applyGeom();
      };
      const up = () => {
        grip.removeEventListener("pointermove", mv);
        removeEventListener("pointerup", up);
        panel.classList.remove("moving");
        try { grip.releasePointerCapture(e.pointerId); } catch {}
        requestAnimationFrame(() => layout(false));
      };
      try { grip.setPointerCapture(e.pointerId); } catch {}
      grip.addEventListener("pointermove", mv);
      addEventListener("pointerup", up);
    });
  });
}

function toggleKernel(want) {
  const panel = $("#kernel"), btn = $("#kernel-open");
  if (!panel) return;
  const open = want === undefined ? panel.hasAttribute("hidden") : want;
  panel.toggleAttribute("hidden", !open);
  btn?.setAttribute("aria-expanded", String(open));
  btn?.classList.toggle("tucked", open);
  $("#tb-kernel")?.classList.toggle("on", open);
  try { localStorage.setItem("nexus.kernel.open", open ? "1" : "0"); } catch {}
  applyGeom();
  if (open) {
    paintKernel(true);
    if (KX.run && !KX.poll) refreshTranscript();
    requestAnimationFrame(() => { $("#kx-input")?.focus(); scrollKernel(true); });
  } else toggleHistory(false);
  requestAnimationFrame(() => layout(false));
}

/** Open Kernel and ask it something — the palette's last row. */
function askKernel(text) {
  toggleKernel(true);
  if (!text) return;
  if (KX.busy || KX.sending) { $("#kx-input").value = text; growInput(); return; }
  kernelSend(text);
}

async function refreshAgentConfig() {
  try {
    KX.cfg = await api("/agent/config");
    const s = KX.cfg.settings;
    const model = (KX.cfg.providers.find(p => p.id === s.provider)?.models || []).find(m => m.id === s.model);
    const prov = KX.cfg.providers.find(p => p.id === s.provider);
    const label = model?.label || s.customModel || s.model || "no model";
    const el = $("#kx-model");
    if (el) {
      el.textContent = KX.cfg.ready ? `${prov?.label ? prov.label + " · " : ""}${label}` : "Needs an API key";
      el.classList.toggle("warn", !KX.cfg.ready);
    }
    $("#kernel-open")?.classList.toggle("unconfigured", !KX.cfg.ready);
    // The attach button appears only where the chosen model takes images.
    const att = $("#kx-attach");
    if (att) att.hidden = !(s.provider === "custom" || model?.vision);
    paintUsage();
    if (!KX.steps.length) paintKernel(true);
  } catch { /* not fatal: the panel says so when you try to send */ }
}

/* ---------------- conversations ---------------- */

async function loadChats() {
  try {
    KX.chats = (await api("/agent/chats")).chats || [];
  } catch { KX.chats = []; }
  // Pick up where this browser left off, or the most recent conversation —
  // which is how a chat started on a laptop is waiting on the phone.
  let want = null;
  try { want = localStorage.getItem("nexus.kernel.chat"); } catch {}
  const pick = KX.chats.find(c => c.id === want) || KX.chats[0];
  if (pick && pick.id !== KX.run) await switchChat(pick.id, { quiet: true });
  else paintKernel();
  paintHistory();
}

async function switchChat(id, opts = {}) {
  if (KX.sending) return;
  if (KX.run === id && !opts.force) return;
  stopPolling();
  try {
    const t = await api(`/agent/run/${id}`);
    KX.run = id;
    applyTurn(t);
    KX.atts = [];
    KX.open.clear();
    try { localStorage.setItem("nexus.kernel.chat", id); } catch {}
    if (t.busy) startPolling();
  } catch {
    // Gone on the server: drop it from the list rather than showing a row
    // that does nothing.
    KX.chats = KX.chats.filter(c => c.id !== id);
    if (KX.run === id) { KX.run = null; KX.steps = []; }
  }
  paintKernel(true);
  paintHistory();
  scrollKernel(true);
}

async function newChat() {
  if (KX.sending) return;
  stopPolling();
  try {
    const out = await api("/agent/run", { method: "POST" });
    KX.run = out.id;
    KX.chats = out.chats || KX.chats;
    KX.steps = []; KX.pending = null; KX.atts = []; KX.busy = false; KX.open.clear();
    KX.usage = { in: 0, out: 0, cost: 0 };
    try { localStorage.setItem("nexus.kernel.chat", out.id); } catch {}
  } catch (e) { toast(e.message || "Could not start one", "err"); }
  paintKernel(true);
  paintHistory();
  $("#kx-input")?.focus();
}

async function shutChat(id) {
  try {
    KX.chats = (await api(`/agent/run/${id}`, { method: "DELETE" })).chats || [];
  } catch { KX.chats = KX.chats.filter(c => c.id !== id); }
  if (KX.run === id) {
    stopPolling();
    KX.run = null; KX.steps = []; KX.pending = null; KX.busy = false; KX.usage = { in: 0, out: 0, cost: 0 };
    const next = KX.chats[0];
    if (next) return switchChat(next.id);
  }
  paintKernel(true);
  paintHistory();
}

function toggleHistory(want) {
  const menu = $("#kx-histmenu"), btn = $("#kx-hist");
  if (!menu) return;
  const open = want === undefined ? menu.hidden : want;
  menu.hidden = !open;
  btn?.setAttribute("aria-expanded", String(open));
  btn?.classList.toggle("on", open);
  if (open) paintHistory();
}

function paintHistory() {
  const menu = $("#kx-histmenu");
  if (!menu || menu.hidden) return;
  menu.innerHTML = `
    <button type="button" class="kx-hrow new" data-newchat>${IC("plus")}<span>New conversation</span></button>
    ${KX.chats.length ? KX.chats.map(c => `
      <div class="kx-hrow${c.id === KX.run ? " on" : ""}">
        <button type="button" class="kx-hpick" data-chat="${esc(c.id)}">${IC("message")}
          <span class="kx-htitle">${esc(c.title)}</span>
          <span class="kx-hmeta">${c.messages || 0} msg · ${ago(c.at)} ago</span></button>
        <button type="button" class="kx-hdel" data-shut="${esc(c.id)}" aria-label="Delete this conversation" data-tip="Delete">${IC("trash")}</button>
      </div>`).join("") : `<p class="kx-hnone">No conversations yet.</p>`}
    <p class="kx-hnote">The five most recent are kept, on the server, so they follow you between devices.</p>`;
}

/* ---------------- attachments ---------------- */

const MAX_ATTS = 4, MAX_ATT_BYTES = 5 * 1024 * 1024;

async function addAttachments(files) {
  for (const f of files) {
    if (KX.atts.length >= MAX_ATTS) { toast(`${MAX_ATTS} images at a time`, "err"); break; }
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { toast("PNG, JPEG, WebP or GIF", "err"); continue; }
    if (f.size > MAX_ATT_BYTES) { toast(`${f.name || "That image"} is over 5 MB`, "err"); continue; }
    try {
      const data = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1] || "");
        fr.onerror = () => rej(new Error("could not read it"));
        fr.readAsDataURL(f);
      });
      KX.atts.push({ name: f.name || "pasted image", mime: f.type, size: f.size, data,
                     url: URL.createObjectURL(f) });
    } catch { toast("Could not read that image", "err"); }
  }
  paintAttachments();
}

function paintAttachments() {
  const box = $("#kx-atts");
  if (!box) return;
  box.toggleAttribute("hidden", !KX.atts.length);
  box.innerHTML = KX.atts.map((a, i) => `
    <span class="kx-att">
      <img src="${esc(a.url)}" alt="">
      <span class="kx-attname">${esc(a.name)}</span>
      <button type="button" class="kx-attx" data-drop="${i}" aria-label="Remove">${IC("x")}</button>
    </span>`).join("");
}

/* ---------------- sending, and following a turn ---------------- */

async function kernelSend(override) {
  const input = $("#kx-input");
  const text = (override ?? input?.value ?? "").trim();
  if ((!text && !KX.atts.length) || KX.busy || KX.sending) return;
  if (KX.cfg && !KX.cfg.ready) { toast("Kernel needs an API key first — Settings → Kernel", "err"); return; }

  const images = KX.atts.map(a => ({ name: a.name, mime: a.mime, data: a.data }));
  const shown = KX.atts.map(a => ({ url: a.url, name: a.name, local: true }));
  const localUrls = KX.atts.map(a => a.url);
  if (override == null && input) { input.value = ""; growInput(); }
  KX.atts = [];
  paintAttachments();

  KX.sending = true;
  KX.steps.push({ kind: "user", text, images: shown });
  KX.busy = true;
  KX.startedAt = Date.now();
  paintKernel();
  scrollKernel(true);

  try {
    if (!KX.run) {
      const out = await api("/agent/run", { method: "POST" });
      KX.run = out.id;
      KX.chats = out.chats || KX.chats;
      try { localStorage.setItem("nexus.kernel.chat", out.id); } catch {}
    }
    const out = await api(`/agent/run/${KX.run}/send`, { method: "POST", body: { text, images, async: true } });
    applyTurn(out);
    if (out.busy) startPolling(); else finishTurn();
  } catch (e) {
    // A run that is gone server-side is recoverable: drop the id so the next
    // message starts a fresh conversation rather than failing forever.
    if (e.status === 404) KX.run = null;
    if (e.status === 409) { startPolling(); }
    else {
      KX.busy = false;
      KX.steps.push({ kind: "error", text: e.message || "That did not work" });
    }
  } finally {
    KX.sending = false;
    // The server has its own copies of the images now; the browser's are done.
    setTimeout(() => localUrls.forEach(u => URL.revokeObjectURL(u)), 4000);
    paintKernel();
  }
}

function applyTurn(out) {
  if (!out) return;
  KX.steps = out.steps || KX.steps;
  KX.pending = out.pending || null;
  KX.usage = out.usage || KX.usage;
  KX.busy = !!out.busy;
  if (!KX.busy) KX.stopping = false;
  if (out.startedAt) KX.startedAt = out.startedAt;
}

function startPolling() {
  if (KX.poll) return;
  KX.busy = true;
  const tick = async () => {
    if (!KX.run) return stopPolling();
    try {
      const t = await api(`/agent/run/${KX.run}`);
      applyTurn(t);
      paintKernel();
      if (!t.busy) { stopPolling(); finishTurn(); }
    } catch (e) {
      if (e.status === 404) { stopPolling(); KX.busy = false; paintKernel(); }
    }
  };
  // Quick at first, then easing off: most turns finish in a few seconds, and a
  // long one does not need a request every second for minutes.
  let n = 0;
  const loop = () => { KX.poll = setTimeout(async () => { await tick(); if (KX.poll) { n++; loop(); } }, n < 20 ? 700 : 1600); };
  loop();
  paintKernel();
}
function stopPolling() { if (KX.poll) { clearTimeout(KX.poll); KX.poll = null; } }

function finishTurn() {
  KX.busy = false;
  paintKernel();
  refreshAgentConfig();
  api("/agent/chats").then(o => { KX.chats = o.chats || KX.chats; paintHistory(); }).catch(() => {});
  // Someone who looked away gets a nudge when Kernel finishes.
  if (document.hidden || $("#kernel")?.hidden) {
    const last = [...KX.steps].reverse().find(s => s.kind === "assistant" || s.kind === "error");
    if (KX.pending) toast("Kernel is waiting for your approval", "warn");
    else if (last) toast("Kernel replied", "ok");
  }
}

/** Re-read the current conversation — on opening the panel, in case a turn
 *  finished (or started) on another device. */
async function refreshTranscript() {
  if (!KX.run) return;
  try {
    const t = await api(`/agent/run/${KX.run}`);
    applyTurn(t);
    paintKernel();
    if (t.busy) startPolling();
  } catch {}
}

async function kernelStop() {
  if (!KX.run || KX.stopping) return;
  KX.stopping = true;
  paintStatus();
  try { applyTurn(await api(`/agent/run/${KX.run}/stop`, { method: "POST" })); }
  catch (e) { KX.stopping = false; toast(e.message || "Could not stop it", "err"); }
  paintStatus();
}

async function kernelDecide(decision) {
  if (!KX.run || KX.busy || KX.sending) return;
  KX.sending = true;
  KX.pending = null;
  KX.busy = true;
  KX.startedAt = Date.now();
  paintKernel();
  try {
    const out = await api(`/agent/run/${KX.run}/approve`, { method: "POST", body: { decision, async: true } });
    applyTurn(out);
    if (out.busy) startPolling(); else finishTurn();
  } catch (e) {
    if (e.status === 409) startPolling();
    else { KX.busy = false; KX.steps.push({ kind: "error", text: e.message || "That did not work" }); }
  } finally {
    KX.sending = false;
    paintKernel();
  }
}

/* Two tenses, because the same tool is described at two different moments: the
   log says what happened, the approval asks about what has not happened yet.
   One map produced "Kernel wants to ran a command". */
const TOOL_WORDS = {
  system_metrics:  ["Read the machine's readings", "read the machine's readings"],
  nexus_config:    ["Read the Nexus settings",     "read the Nexus settings"],
  recall_app_pin:  ["Read back an app's PIN",      "read back an app's PIN"],
  load_skill:      ["Loaded a skill",              "load a skill"],
  list_dir:        ["Listed a folder",             "list a folder"],
  read_file:       ["Read a file",                 "read a file"],
  write_file:      ["Wrote a file",                "write a file"],
  make_dir:        ["Created a folder",            "create a folder"],
  delete_path:     ["Deleted a path",              "delete a path"],
  run_command:     ["Ran a command",               "run a command"],
  docker_list:     ["Listed containers",           "list the containers"],
  docker_action:   ["Controlled a container",      "start, stop or restart a container"]
};
const toolPast = n => TOOL_WORDS[n]?.[0] || n;
const toolNow  = n => TOOL_WORDS[n]?.[1] || n;
const TOOL_ICON = { run_command: "terminal", read_file: "folder", write_file: "edit", list_dir: "folder", make_dir: "folder",
  delete_path: "trash", docker_list: "box", docker_action: "box", system_metrics: "activity", nexus_config: "settings",
  recall_app_pin: "lock", load_skill: "sparkles" };

/* Four words for four levels. The colour carries the same meaning as it does
   everywhere else in Nexus — green is fine, red is not. */
const RISK_WORDS = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };

const SUGGEST = [
  ["How is the machine doing right now?", "activity"],
  ["Is anything wrong? Go through the problems on the Overview.", "alert"],
  ["Which containers are using the most memory?", "box"],
  ["How much disk space is left, and what is filling it?", "drive"]
];

/** A step's identity on screen. When it changes, that message is redrawn. */
const stepKey = (s, i) => `${i}|${s.kind}|${(s.text || "").length}|${(s.result || "").length}|${s.denied ? 1 : 0}|${s.error ? 1 : 0}`;

function paintKernel(full = false) {
  const body = $("#kx-body");
  if (!body) return;
  const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 48;

  if (!KX.steps.length) {
    KX.keys = [];
    body.innerHTML = helloHTML();
  } else {
    let list = $(".kx-msgs", body);
    if (!list || full) {
      body.innerHTML = `<div class="kx-msgs"></div>`;
      list = $(".kx-msgs", body);
      KX.keys = [];
    }
    const keys = KX.steps.map(stepKey);
    // From the first step that differs, everything after it is redrawn. In the
    // normal case that is just the new step at the end.
    let from = 0;
    while (from < KX.keys.length && from < keys.length && KX.keys[from] === keys[from]) from++;
    while (list.children.length > from) list.lastElementChild.remove();
    const lastUser = KX.steps.reduce((a, s, i) => (s.kind === "user" ? i : a), -1);
    const lastBot = KX.steps.reduce((a, s, i) => (s.kind === "assistant" ? i : a), -1);
    const tpl = document.createElement("template");
    tpl.innerHTML = KX.steps.slice(from).map((s, j) => stepHTML(s, from + j, { lastBot, lastUser })).join("");
    list.append(tpl.content);
    // The retry/copy row belongs to the last reply only; an older one loses it.
    $$(".kx-acts.last", list).forEach(el => {
      if (Number(el.dataset.for) !== lastBot) el.classList.remove("last");
    });
    KX.keys = keys;
    wireIcons(list);
  }

  paintStatus();
  paintAsk();

  const send = $("#kx-send");
  if (send) send.disabled = KX.busy || KX.sending;
  const input = $("#kx-input");
  if (input) input.placeholder = KX.busy ? "Kernel is working — you can type your next message…" : "Ask about this machine…";
  if (atBottom || full) scrollKernel();
  paintUsage();
}

function scrollKernel(force) {
  const body = $("#kx-body");
  if (!body) return;
  requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
}

function helloHTML() {
  const ready = KX.cfg?.ready;
  const tools = KX.cfg?.capabilities?.tools?.length || 0;
  return `<div class="kx-hello">
    <span class="kx-orb lg" aria-hidden="true"></span>
    <p class="kx-hi">Hi, I'm Kernel.</p>
    <p class="kx-sub">${ready
      ? (tools ? `I can use ${tools} tool${tools === 1 ? "" : "s"} on this machine, and I always ask before anything risky.`
               : "No capabilities are switched on yet, so I can only talk. You can hand me some in Settings.")
      : "Add an API key and I'll wake up."}</p>
    ${ready ? `<div class="kx-sugs">${SUGGEST.map(([t, ic]) =>
        `<button type="button" class="kx-sug" data-suggest="${esc(t)}">${IC(ic)}<span>${esc(t)}</span></button>`).join("")}</div>`
      : `<button type="button" class="btn primary" data-kx-setup>${IC("settings")}Set up Kernel</button>`}
  </div>`;
}

function paintStatus() {
  const st = $("#kx-status");
  if (!st) return;
  const on_ = KX.busy;
  st.hidden = !on_;
  if (!on_) { clearInterval(paintStatus.t); paintStatus.t = null; return; }
  const lastTool = [...KX.steps].reverse().find(s => s.kind === "tool");
  const since = KX.startedAt ? Math.max(0, Math.round((Date.now() - KX.startedAt) / 1000)) : 0;
  const what = lastTool && (lastTool.at || 0) >= KX.startedAt - 1000 ? toolPast(lastTool.name).toLowerCase() : null;
  st.innerHTML = `<span class="kx-shimmer" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="kx-stxt">${what ? `Working · ${esc(what)}` : "Thinking"}<em>${since}s</em></span>
    <span class="spacer"></span>
    <button type="button" class="kx-stop" data-stop${KX.stopping ? " disabled" : ""}>${IC("stop")}${KX.stopping ? "Stopping…" : "Stop"}</button>`;
  if (!paintStatus.t) paintStatus.t = setInterval(() => { if (KX.busy) paintStatus(); }, 1000);
}

function paintAsk() {
  const ask = $("#kx-ask");
  if (!ask) return;
  ask.toggleAttribute("hidden", !KX.pending);
  if (!KX.pending) { ask.innerHTML = ""; return; }
  const p = KX.pending;
  const level = RISK_WORDS[p.risk] ? p.risk : "high";
  const sig = JSON.stringify([p.id, p.name, level]);
  if (ask.dataset.sig === sig) return;
  ask.dataset.sig = sig;
  ask.innerHTML =
    `<div class="kx-askhead">
       <span class="kx-askico">${IC(TOOL_ICON[p.name] || "shield")}</span>
       <span class="kx-asktitle">Kernel wants to ${esc(toolNow(p.name))}</span>
       <span class="kx-risk ${esc(level)}">${RISK_WORDS[level]} risk</span>
     </div>
     ${p.why?.length ? `<ul class="kx-why">${p.why.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
     <pre class="kx-preview">${esc(p.preview || "")}</pre>
     <div class="kx-askrow">
       <span class="kx-askhint">Nothing runs until you choose.</span>
       <span class="spacer"></span>
       <button class="btn sm" id="kx-deny" type="button">Deny</button>
       <button class="btn primary sm" id="kx-allow" type="button">${IC("check")}Allow</button>
     </div>`;
  on("#kx-allow", "click", () => kernelDecide("allow"));
  on("#kx-deny", "click", () => kernelDecide("deny"));
}

function shotHTML(s) {
  if (!s.images?.length) return "";
  return `<span class="kx-shots">${s.images.map(im => {
    const url = im.local ? im.url : `/api/agent/run/${encodeURIComponent(KX.run)}/image/${encodeURIComponent(im.file)}`;
    return `<img class="kx-shot" src="${esc(url)}" alt="${esc(im.name || "attached image")}"
                 data-shot="${esc(url)}" data-name="${esc(im.name || "image")}" loading="lazy">`;
  }).join("")}</span>`;
}

function stepHTML(s, i, { lastBot } = {}) {
  if (s.kind === "user") {
    return `<div class="kx-row me"><div class="kx-bub">${shotHTML(s)}${s.text ? esc(s.text) : ""}</div></div>`;
  }
  if (s.kind === "assistant") {
    // Every code block gets its own copy button: the thing you want out of a
    // reply is usually the command in it, not the whole reply.
    const body = md(s.text).replace(/<pre class="md-pre">/g,
      `<pre class="md-pre"><button class="kx-ccopy" type="button" data-ccopy aria-label="Copy this code">${IC("copy")}<span>Copy</span></button>`);
    return `<div class="kx-row bot">
      <span class="kx-av" aria-hidden="true"></span>
      <div class="kx-msg">
        <div class="kx-bub md">${body}</div>
        <div class="kx-acts${i === lastBot ? " last" : ""}" data-for="${i}">
          <button class="kx-act" type="button" data-copy="${i}" aria-label="Copy this reply">${IC("copy")}<span>Copy</span></button>
          <button class="kx-act" type="button" data-retry aria-label="Ask again">${IC("retry")}<span>Retry</span></button>
        </div>
      </div></div>`;
  }
  if (s.kind === "error") {
    return `<div class="kx-row"><div class="kx-err${s.stopped ? " stopped" : ""}">${IC(s.stopped ? "stop" : "alert")}<span>${esc(s.text)}</span></div></div>`;
  }

  // A tool call is a fact about what happened to the machine, so it is shown
  // as one — name, outcome, and the detail one click away.
  // A denied call never happened, so it is not described in the past tense.
  const label = s.denied ? "Wanted to " + toolNow(s.name) : toolPast(s.name);
  const state = s.denied ? "denied" : s.error ? "failed" : "done";
  const detail = s.denied ? "You denied this." : (s.result || "");
  const arg = argLine(s.args);
  const short = s.args?.command || s.args?.path || s.args?.name || "";
  return `<details class="kx-tool ${state}" data-step="${i}"${KX.open.has(i) ? " open" : ""}>
    <summary>${IC(TOOL_ICON[s.name] || "zap", "kx-tico")}<span class="kx-tlabel">${esc(label)}</span>
      ${short ? `<code class="kx-targ">${esc(String(short).slice(0, 80))}</code>` : ""}
      <em class="kx-tstate">${state}</em>${IC("chevron-right", "kx-tchev")}</summary>
    <pre>${esc(arg)}${detail ? (arg ? "\n\n" : "") + esc(detail) : ""}</pre>
  </details>`;
}

/** An attached image, full size, with a way to keep it. */
function openShot(url, name) {
  const wrap = document.createElement("div");
  wrap.className = "kx-lightbox";
  wrap.innerHTML = `<img src="${esc(url)}" alt="${esc(name)}">`;
  openModal({
    title: name.slice(0, 60),
    icon: ICON("files"),
    body: wrap,
    foot: `<span class="spacer"></span>
           <a class="btn sm" id="kx-dl" href="${esc(url)}" download="${esc(name)}">Download</a>`
  });
}

function argLine(args) {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" && v.length > 400 ? v.slice(0, 400) + "…" : JSON.stringify(v)}`)
    .join("\n");
}

/* ============================ markdown ============================
 * Enough markdown for what actually arrives: an answer from the model, and a
 * skill file being previewed. Headings, bold, italic, inline and fenced code,
 * lists, tables, blockquotes, rules and links.
 *
 * Written here rather than pulled in, because `web/` is served straight off
 * disk with no build step and a CSP that forbids CDN scripts — a markdown
 * library would have to be vendored, and this is a fifth of the size.
 *
 * **Everything is escaped before a single rule runs.** The input is model
 * output and file contents; both are untrusted. The rules below can only ever
 * add formatting to text that is already inert, so there is no path from a
 * `<script>` in a skill file to a `<script>` on the page.
 */
function md(text) {
  const src = esc(String(text ?? "")).replace(/\r\n?/g, "\n");

  // Fenced code first, lifted out whole so nothing inside it is interpreted.
  const fences = [];
  let body = src.replace(/```([a-z0-9+-]*)\n?([\s\S]*?)```/gi, (_, lang, code) => {
    fences.push(`<pre class="md-pre"><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `\u0000FENCE${fences.length - 1}\u0000`;
  });

  const inline = t => t
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    // Only http(s) links become anchors. A markdown link is still text the
    // model wrote, so it opens in a new tab and carries noopener.
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
             '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = body.split("\n");
  const out = [];
  let para = [], list = null, quote = [];

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${md(quote.join("\n"))}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { flushAll(); continue; }
    if (/^\u0000FENCE\d+\u0000$/.test(line.trim())) { flushAll(); out.push(line.trim()); continue; }
    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushAll(); out.push("<hr>"); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flushAll(); const n = Math.min(6, h[1].length + 2); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }

    const q = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
    flushQuote();

    // A table needs its separator row to be a table at all, so look ahead.
    if (line.includes("|") && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || "")) {
      flushAll();
      const cells = r => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
      const align = cells(lines[i + 1]).map(c =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left");
      const head = cells(line);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim()) { rows.push(cells(lines[j])); j++; }
      out.push(`<table class="md-table"><thead><tr>${
        head.map((c, k) => `<th style="text-align:${align[k] || "left"}">${inline(c)}</th>`).join("")
      }</tr></thead><tbody>${
        rows.map(r => `<tr>${r.map((c, k) => `<td style="text-align:${align[k] || "left"}">${inline(c)}</td>`).join("")}</tr>`).join("")
      }</tbody></table>`);
      i = j - 1;
      continue;
    }

    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const tag = /^\d/.test(li[1]) ? "ol" : "ul";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(`<li>${inline(li[2])}</li>`);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushAll();

  return out.join("").replace(/\u0000FENCE(\d+)\u0000/g, (_, n) => fences[Number(n)]);
}

function paintUsage() {
  const el = $("#kx-usage");
  if (!el) return;
  const t = KX.cfg?.usage;
  const here = KX.usage || { in: 0, out: 0, cost: 0 };
  // One line, because the footer is one line wide. The running total goes in
  // the tooltip and in full on the settings page, where there is room for it.
  el.textContent = `${tok(here.in)} in · ${tok(here.out)} out · ${money(here.cost, here.priced)}`;
  el.setAttribute("data-tip", t
    ? `This conversation: ${here.in.toLocaleString()} in, ${here.out.toLocaleString()} out.\n` +
      `Since the last reset: ${t.inTokens.toLocaleString()} in, ${t.outTokens.toLocaleString()} out, ${money(t.cost, true)}.`
    : "Tokens used by this conversation.");
}

/* ==================== Settings → Nexus Expert ==================== */

async function renderAgentSettings() {
  const host = $("#agent-panel");
  if (!host) return;
  if (!host.children.length) host.innerHTML = `<div class="sx-card"><div class="sx-empty">Loading Kernel’s settings…</div></div>`;
  let c;
  try { c = KX.cfg = await api("/agent/config"); }
  catch { host.innerHTML = `<p class="hint">Could not load the agent settings.</p>`; return; }

  const s = c.settings;
  const prov = c.providers.find(p => p.id === s.provider) || c.providers[0];
  // The server uses the custom id whenever the chosen model is not one of the
  // listed ones, so "using my own" is exactly that.
  const usingCustom = !!s.model && !prov.models.some(m => m.id === s.model);
  const key = c.keys[s.provider] || { set: false };

  const priceBit = m => m.priced
    ? `<span class="ag-price">$${m.in}<small>/M in</small> · $${m.out}<small>/M out</small></span>`
    : `<span class="ag-price none">see pricing</span>`;

  host.innerHTML = `
    <div class="ag-block">
      <h3>Provider</h3>
      <div class="ag-provs">${c.providers.map(p => `
        <button type="button" class="ag-prov${p.id === s.provider ? " on" : ""}" data-prov="${esc(p.id)}">
          <b>${esc(p.label)}</b>
          <span>${c.keys[p.id]?.set ? "key saved " + esc(c.keys[p.id].hint) : "no key"}</span>
        </button>`).join("")}</div>
    </div>

    <div class="ag-block">
      <h3>Model <small>strongest first · prices checked ${esc(c.pricingAsOf)}, per million tokens</small></h3>
      <div class="ag-models">${prov.models.map(m => `
        <button type="button" class="ag-model${m.id === s.model ? " on" : ""}" data-model="${esc(m.id)}">
          <span class="ag-tier">${esc(m.tier)}</span>
          <b>${esc(m.label)}</b>
          ${priceBit(m)}
          <span class="ag-note">${esc(m.note || "")}</span>
        </button>`).join("")}</div>
      ${prov.pricingUrl ? `<p class="hint"><a href="${esc(prov.pricingUrl)}" target="_blank" rel="noopener">${esc(prov.label)}'s current pricing &rarr;</a> These figures are a guide, not a quote.</p>` : ""}
      <div class="ag-row ag-customrow${usingCustom ? " on" : ""}">
        <label for="ag-custom">Or a model id of your own</label>
        <input id="ag-custom" type="text" value="${esc(usingCustom ? s.model : (s.customModel || ""))}" placeholder="exactly as your provider spells it" spellcheck="false" autocomplete="off">
        <button class="btn sm${usingCustom ? "" : " primary"}" id="ag-custom-use" type="button">${usingCustom ? "Update" : "Use"}</button>
        ${usingCustom ? `<button class="btn sm" id="ag-custom-clear" type="button">Back to the list</button>` : ""}
      </div>
      <p class="hint ag-customstate">${usingCustom
        ? `In use: <code>${esc(s.model)}</code>. Press <b>Test</b> below to check ${esc(prov.label)} knows it.`
        : "Type the id, press Use (or Enter), then Test below."}</p>
      ${prov.needsBaseUrl ? `<div class="ag-row">
        <label for="ag-base">Base URL</label>
        <input id="ag-base" type="text" value="${esc(s.baseUrl || "")}" placeholder="http://127.0.0.1:11434/v1" spellcheck="false">
      </div>` : ""}
    </div>

    <div class="ag-block">
      <h3>API key</h3>
      <div class="ag-row">
        <label for="ag-key">${esc(prov.label)} key</label>
        <input id="ag-key" type="password" autocomplete="off" spellcheck="false"
               placeholder="${key.set ? "saved — " + esc(key.hint) + ", type to replace" : esc(prov.keyHint || "paste your key")}">
        <button class="btn sm" id="ag-key-save" type="button">Save key</button>
        <button class="btn sm" id="ag-key-test" type="button">Test</button>
        ${key.set ? `<button class="btn sm danger" id="ag-key-clear" type="button">Remove</button>` : ""}
      </div>
      <p class="ag-test" id="ag-test" role="status" aria-live="polite"></p>
      <p class="hint">Stored on this server only, in a file only root can read, and never sent back to a
        browser. ${prov.keyUrl ? `<a href="${esc(prov.keyUrl)}" target="_blank" rel="noopener">Get a key &rarr;</a>` : ""}</p>
    </div>

    <div class="ag-block">
      <h3>What Kernel may do</h3>
      <p class="hint">Everything is off until you turn it on. Nexus runs as root, so anything you grant
        here, it grants at root.</p>
      <div class="ag-caps">
        ${capRow("metrics", "Read the machine's readings", "CPU, memory, disks, sensors, uptime, top processes.", s.caps.metrics)}
        ${capRow("readFiles", "Read files", "Only inside the folders ticked below.", s.caps.readFiles)}
        ${capRow("writeFiles", "Create, change and delete files", "Same folders. Deletions are recursive and permanent.", s.caps.writeFiles)}
        ${capRow("docker", "List and control containers", c.dockerAvailable ? "Start, stop and restart." : "Docker is not available on this host.", s.caps.docker, !c.dockerAvailable)}
        ${capRow("shell", "Run shell commands as root", "Install packages, edit services, change anything. This is the whole machine.", s.caps.shell, false, true)}
      </div>
    </div>

    <div class="ag-block">
      <h3>Folders it can reach</h3>
      ${c.roots.length ? `<div class="ag-roots">${c.roots.map(r => `
        <label class="ag-check"><input type="checkbox" data-root="${esc(r.path)}"${s.roots.includes(r.path) ? " checked" : ""}>
          <span><b>${esc(r.name)}</b><small>${esc(r.path)}</small></span></label>`).join("")}</div>`
        : `<p class="hint">No file roots are configured, so there is nothing to share.</p>`}
      <p class="hint">Only the roots your file manager already uses can be offered. Anything outside a
        ticked folder is refused by the same path jail the file manager uses.</p>
    </div>

    <div class="ag-block">
      <h3>Before it acts</h3>
      <div class="ag-modes">
        <button type="button" class="ag-mode${s.approval === "ask" ? " on" : ""}" data-approval="ask">
          <b>Ask me first</b><span>Every change and every command waits for you.</span></button>
        <button type="button" class="ag-mode${s.approval === "auto" ? " on" : ""}" data-approval="auto">
          <b>Full access</b><span>Kernel acts without asking.</span></button>
      </div>
      <p class="hint warnline">Full access plus the shell means anything Kernel reads &mdash; a file, a log,
        a command's output &mdash; can carry text that reads like an instruction. Ask-me-first is what
        stops that becoming an action.</p>

      <div class="ag-sub${s.approval === "ask" ? "" : " off"}">
        <h4>Ask me about&hellip;</h4>
        <p class="hint">Every command is classified from what it actually does before you are asked.
          Pick the point at which it is worth interrupting you &mdash; being asked about
          <code>df -h</code> is how people learn to press ALLOW without reading.</p>
        <div class="ag-levels" role="group" aria-label="When to ask">
          ${[["low", "Everything", "Even a command that only reads."],
             ["medium", "Medium and up", "Installs, writes, starting things."],
             ["high", "High and up", "Deletes, stops a service, changes permissions."],
             ["critical", "Critical only", "Destroys data, repartitions, powers off, pipes the internet into a shell."]]
            .map(([k, label, note]) => `
            <button type="button" class="ag-level${(s.askAt || "medium") === k ? " on" : ""}" data-askat="${k}"
                    ${s.approval === "ask" ? "" : "disabled"}>
              <span class="kx-risk ${k}">${k.toUpperCase()}</span>
              <b>${label}</b><span>${note}</span>
            </button>`).join("")}
        </div>
        <p class="hint">Whatever this is set to, a tool that only reads never asks, and every call is
          in the audit log.</p>
      </div>
    </div>

    <div class="ag-block">
      <h3>Skills <small>what Kernel knows before you tell him</small></h3>
      ${skillSummary(c.skills)}
      <div class="ag-row">
        <button class="btn" id="ag-skills-open" type="button">Open skill library</button>
        <span class="hint">Markdown files. Drop one in, switch it on or off, or delete it for good.</span>
      </div>
    </div>

    <details class="ag-block ag-adv"${AGadvOpen ? " open" : ""}>
      <summary><h3>Advanced</h3><span>Scheduled tasks, context and limits</span></summary>

      <div class="ag-sub">
        <h4>Scheduled tasks</h4>
        <p class="hint">Kernel can run a prompt on a timer — a morning check, a weekly tidy-up.
          ${s.approval === "ask"
            ? `You are on <b>ask me first</b>, so a task that wants to write a file or run a command
               will stop and wait with nobody there to answer. It records that it was waiting rather
               than pretending it finished.`
            : `You are on <b>full access</b>, so these run unattended and can change the machine.`}</p>
        <div class="cr-list">${(c.crons || []).map(cronRow).join("")
          || `<p class="hint">No scheduled tasks yet.</p>`}</div>
        <button class="btn sm" id="ag-cron-new" type="button">+ New task</button>
      </div>

      <div class="ag-sub">
        <h4>Context</h4>
        ${capRowPlain("sendHostFacts", "Send the live briefing",
          "Host, uptime, CPU, memory, filesystems and containers go in every message, so Kernel does not spend a tool call finding out where it is. Turning this off makes each message cheaper and Kernel blinder.",
          s.sendHostFacts)}
        <div class="ag-row">
          <label for="ag-steps">Tool calls per message</label>
          <input id="ag-steps" type="number" min="1" max="40" value="${Number(s.maxSteps)}">
          <span class="hint">It stops at this many and waits for you to say "carry on".</span>
        </div>
      </div>
    </details>

    <div class="ag-block">
      <h3>Usage</h3>
      <dl class="kv ag-usage">
        <dt>Input</dt><dd>${tok(c.usage.inTokens)} tokens</dd>
        <dt>Output</dt><dd>${tok(c.usage.outTokens)} tokens</dd>
        <dt>Messages</dt><dd>${c.usage.runs || 0}</dd>
        <dt>Estimated cost</dt><dd>${money(c.usage.cost, !allUnpriced(c.usage))}${anyUnpriced(c.usage) ? " <small>(excludes models with no published rate here)</small>" : ""}</dd>
      </dl>
      <button class="btn sm" id="ag-usage-reset" type="button">Reset counters</button>
    </div>`;

  /* ---- wiring ---- */
  const patch = body => api("/agent/config", { method: "PUT", body })
    .then(() => { renderAgentSettings(); refreshAgentConfig(); })
    .catch(e => toast(e.message || "could not save", "err"));

  $$("[data-prov]", host).forEach(b => b.addEventListener("click", () => {
    const p = c.providers.find(x => x.id === b.dataset.prov);
    // Moving provider without moving model would leave a model id the new
    // provider has never heard of, so take its strongest by default.
    patch({ provider: b.dataset.prov, model: p?.models?.[0]?.id || "" });
  }));
  $$("[data-model]", host).forEach(b => b.addEventListener("click", () => patch({ model: b.dataset.model })));
  $$("[data-approval]", host).forEach(b => b.addEventListener("click", () => patch({ approval: b.dataset.approval })));
  $$("[data-askat]", host).forEach(b => b.addEventListener("click", () => patch({ askAt: b.dataset.askat })));
  $$("[data-cap]", host).forEach(b => b.addEventListener("change", () => {
    patch({ caps: { ...s.caps, [b.dataset.cap]: b.checked } });
  }));
  $$("[data-root]", host).forEach(b => b.addEventListener("change", () => {
    const roots = $$("[data-root]", host).filter(x => x.checked).map(x => x.dataset.root);
    patch({ roots });
  }));
  // A typed id only takes effect when it is chosen: Use (or Enter) makes it
  // the model, and a card click goes back to the list. Typing alone used to
  // save it and change nothing, because a listed model was still selected.
  const useCustom = () => {
    const v = $("#ag-custom", host).value.trim();
    if (!v) return toast("Type a model id first", "err");
    patch({ customModel: v, model: v }).then(() => toast(`Using ${v}`, "ok"));
  };
  on($("#ag-custom-use", host), "click", useCustom);
  $("#ag-custom", host)?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); useCustom(); } });
  $("#ag-custom-clear", host)?.addEventListener("click", () => patch({ model: prov.models[0]?.id || "" }));
  const base = $("#ag-base", host);
  if (base) base.addEventListener("change", e => patch({ baseUrl: e.target.value.trim() }));
  on($("#ag-steps", host), "change", e => patch({ maxSteps: Number(e.target.value) }));

  on($("#ag-key-save", host), "click", async () => {
    const v = $("#ag-key", host).value;
    if (!v) return toast("paste a key first");
    try {
      await api("/agent/key", { method: "PUT", body: { provider: s.provider, key: v } });
      toast("key saved");
      renderAgentSettings(); refreshAgentConfig();
    } catch (e) { toast(e.message || "could not save the key", "err"); }
  });
  const clear = $("#ag-key-clear", host);
  if (clear) clear.addEventListener("click", async () => {
    if (!confirm(`Remove the ${prov.label} key?\n\nKernel will stop working until you add another.`)) return;
    await api("/agent/key", { method: "PUT", body: { provider: s.provider, key: null } }).catch(() => {});
    renderAgentSettings(); refreshAgentConfig();
  });
  on($("#ag-skills-open", host), "click", () => openSkillLibrary());

  // Keep the Advanced block open across the re-render that every change causes.
  const adv = $(".ag-adv", host);
  if (adv) adv.addEventListener("toggle", () => { AGadvOpen = adv.open; });

  $$("[data-cap-plain]", host).forEach(b => b.addEventListener("change", () =>
    patch({ [b.dataset.capPlain]: b.checked })));

  on($("#ag-cron-new", host), "click", () => editCron(null));
  $$("[data-cron-edit]", host).forEach(b => b.addEventListener("click", () =>
    editCron((c.crons || []).find(x => x.id === b.dataset.cronEdit))));
  $$("[data-cron-run]", host).forEach(b => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "Running…";
    try { await api(`/agent/crons/${encodeURIComponent(b.dataset.cronRun)}/run`, { method: "POST" }); }
    catch (e) { toast(e.message || "the task failed", "err"); }
    renderAgentSettings();
  }));
  $$("[data-cron-on]", host).forEach(b => b.addEventListener("change", async () => {
    const row = (c.crons || []).find(x => x.id === b.dataset.cronOn);
    await api("/agent/crons", { method: "PUT", body: { ...row, enabled: b.checked } }).catch(() => {});
    renderAgentSettings();
  }));
  $$("[data-cron-del]", host).forEach(b => b.addEventListener("click", async () => {
    const row = (c.crons || []).find(x => x.id === b.dataset.cronDel);
    if (!confirm(`Delete the scheduled task "${row.name}"?`)) return;
    await api(`/agent/crons/${encodeURIComponent(row.id)}`, { method: "DELETE" }).catch(() => {});
    renderAgentSettings();
  }));

  on($("#ag-key-test", host), "click", async e => {
    const out = $("#ag-test", host);
    const btn = e.currentTarget;
    btn.disabled = true;
    out.className = "ag-test working";
    out.textContent = "calling " + prov.label + "…";
    try {
      const r = await api("/agent/test", { method: "POST" });
      out.className = "ag-test " + (r.ok ? "ok" : "bad");
      out.textContent = r.ok
        ? `${r.provider} answered as ${r.model} in ${r.ms} ms — ${r.tokens.in} in, ${r.tokens.out} out.`
        : `${r.provider} refused: ${r.error}`;
      refreshAgentConfig();
    } catch (err) {
      out.className = "ag-test bad";
      out.textContent = err.message || "the test could not be run";
    } finally { btn.disabled = false; }
  });

  on($("#ag-usage-reset", host), "click", async () => {
    await api("/agent/usage", { method: "DELETE" }).catch(() => {});
    renderAgentSettings(); refreshAgentConfig();
  });
}

const anyUnpriced = u => Object.values(u.byModel || {}).some(m => !m.priced);
const allUnpriced = u => {
  const rows = Object.values(u.byModel || {});
  return rows.length > 0 && rows.every(m => !m.priced);
};

/* ==================== the skill library ====================
 * Skills are Markdown files. The library is a modal rather than more rows in
 * the settings page, because it is a place you go to do a job — read one, drop
 * a few in, decide what is memory and what is on demand — and then leave.
 */

function skillSummary(sk) {
  if (!sk) return "";
  const on = sk.list.filter(x => x.enabled);
  const always = on.filter(x => x.mode === "always");
  const demand = on.filter(x => x.mode === "ondemand");
  const pct = Math.min(100, Math.round((sk.budget.used / sk.budget.limit) * 100));
  return `<div class="sk-sum">
    <div class="sk-sumrow"><b>${always.length}</b><span>in memory, sent every message</span></div>
    <div class="sk-sumrow"><b>${demand.length}</b><span>on demand, fetched when needed</span></div>
    <div class="sk-sumrow"><b>${sk.list.length - on.length}</b><span>switched off</span></div>
    <div class="sk-budget${sk.budget.over ? " over" : ""}">
      <div class="sk-track"><i style="width:${pct}%"></i></div>
      <span>${(sk.budget.used / 1024).toFixed(1)} kB of ${(sk.budget.limit / 1024).toFixed(0)} kB memory budget${
        sk.budget.over ? " — over; move something to on-demand" : ""}</span>
    </div>
  </div>`;
}

let SK = { list: [], budget: null, seeds: [], tags: [] };
/* Which tags the library is filtered to. A set, because picking two tags
   should mean "either of these", which is what you want when you are
   looking for something rather than building a query. */
let SKfilter = new Set();
let SKsearch = "";
/* The tag cloud grows with the library; past a dozen chips it is taller than
   the list it is filtering. Show the most-used, and the rest on request. */
let SKallTags = false;
const SK_TAGS_SHOWN = 10;

async function openSkillLibrary() {
  openModal({
    title: "Skill library",
    icon: ICON("terminal"),
    body: `<div id="sk-wrap"><div class="sk-loading">loading…</div></div>`,
    foot: `<span class="hint sk-foothint">Markdown, front matter optional.</span>
           <span class="spacer"></span>
           <button class="btn sm" id="sk-restore" type="button">Restore defaults</button>
           <button class="btn primary sm" id="sk-new" type="button">New skill</button>`,
    // Closing the library is what refreshes the summary behind it.
    onClose: () => renderAgentSettings()
  });
  on("#sk-new", "click", () => editSkill(null));
  on("#sk-restore", "click", async () => {
    const r = await api("/agent/skills/restore", { method: "POST" }).catch(e => { toast(e.message, "err"); });
    if (r) { toast(r.added ? `${r.added} restored` : "nothing was missing", "ok"); paintSkills(r); }
  });
  SKfilter = new Set(); SKsearch = ""; SKallTags = false;
  paintSkills(await api("/agent/skills").catch(() => ({ list: [], budget: null, seeds: [], tags: [] })));
}

function paintSkills(data) {
  if (data) SK = data;
  const wrap = $("#sk-wrap");
  if (!wrap) return;

  // Filter first, then group, so the counts and the headings agree with what is
  // actually on screen.
  const q = SKsearch.trim().toLowerCase();
  const shown = SK.list.filter(k => {
    if (SKfilter.size && !k.tags.some(t => SKfilter.has(t))) return false;
    if (!q) return true;
    return (k.name + " " + k.description + " " + k.id + " " + k.tags.join(" ")).toLowerCase().includes(q);
  });
  const memory = shown.filter(k => k.mode === "always");
  const demand = shown.filter(k => k.mode === "ondemand");

  const tagChip = t => `<button type="button" class="sk-tag${SKfilter.has(t.tag) ? " on" : ""}" data-tag="${esc(t.tag)}">${esc(t.tag)}<i>${t.n}</i></button>`;

  const row = k => `
    <div class="sk-item${k.enabled ? "" : " off"}" data-id="${esc(k.id)}">
      <label class="sk-on" data-tip="${k.enabled ? "Switch off — kept on disk" : "Switch on"}">
        <input type="checkbox" data-sk-on${k.enabled ? " checked" : ""}>
      </label>
      <div class="sk-main">
        <div class="sk-name">${esc(k.name)}
          ${k.seeded ? `<span class="sk-seed" data-tip="Shipped with Nexus — RESTORE DEFAULTS brings it back">Stock</span>` : ""}
        </div>
        <div class="sk-desc">${esc(k.description || "no description")}</div>
        <div class="sk-meta">
          ${k.tags.map(t => `<button type="button" class="sk-minitag${SKfilter.has(t) ? " on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}
          <span class="sk-size">${(k.bytes / 1024).toFixed(1)} kB · ${esc(k.id)}</span>
        </div>
      </div>
      <div class="sk-acts">
        <button class="btn sm" data-sk-swap type="button">${k.mode === "always" ? "→ ON DEMAND" : "→ MEMORY"}</button>
        <button class="btn sm" data-sk-edit type="button">Open</button>
        <button class="btn sm danger" data-sk-del type="button">DELETE</button>
      </div>
    </div>`;

  const group = (title, blurb, rows) => rows.length ? `
    <div class="sk-group">
      <div class="sk-ghead"><b>${esc(title)}</b><span>${esc(blurb)}</span><em>${rows.length}</em></div>
      ${rows.map(row).join("")}
    </div>` : "";

  wrap.innerHTML = `
    <div class="sk-drop" id="sk-drop">
      <b>Drop .md files here</b>
      <span>or <button class="kx-link" id="sk-pick" type="button">choose files</button></span>
      <input type="file" id="sk-file" accept=".md,.markdown,text/markdown,text/plain" multiple hidden>
    </div>
    ${SK.budget ? skillSummary(SK) : ""}
    <div class="sk-filter">
      <input id="sk-q" type="search" placeholder="Search skills…" value="${esc(SKsearch)}" aria-label="Search skills">
      <div class="sk-tags">
        ${(() => {
          const all = SK.tags || [];
          if (!all.length) return `<span class="hint">No tags yet — open a skill to give it some.</span>`;
          // A tag you have filtered on always stays visible, even if it is not
          // popular enough to be in the first ten.
          const shownTags = SKallTags ? all
            : all.filter((t, i) => i < SK_TAGS_SHOWN || SKfilter.has(t.tag));
          const hidden = all.length - shownTags.length;
          return shownTags.map(tagChip).join("") +
            (hidden > 0 ? `<button type="button" class="sk-tag more" id="sk-more">+${hidden} more</button>` : "") +
            (SKallTags && all.length > SK_TAGS_SHOWN ? `<button type="button" class="sk-tag more" id="sk-less">fewer</button>` : "");
        })()}
        ${SKfilter.size ? `<button type="button" class="sk-tag clear" id="sk-clear">clear</button>` : ""}
      </div>
    </div>
    ${shown.length
      ? group("In memory", "sent with every message", memory) + group("On demand", "loaded when a question needs it", demand)
      : `<p class="hint sk-none">Nothing matches${SKfilter.size ? " those tags" : ""}${q ? ` and "${esc(q)}"` : ""}.</p>`}`;

  /* ---- drop zone ---- */
  const drop = $("#sk-drop"), file = $("#sk-file");
  on("#sk-pick", "click", () => file.click());
  file.addEventListener("change", () => { addSkillFiles([...file.files]); file.value = ""; });
  // dragover must be prevented or the browser navigates to the file instead.
  ["dragenter", "dragover"].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => addSkillFiles([...(e.dataTransfer?.files || [])]));

  /* ---- search and tags ---- */
  const qBox = $("#sk-q", wrap);
  if (qBox) {
    qBox.addEventListener("input", e => {
      SKsearch = e.target.value;
      const at = e.target.selectionStart;
      paintSkills();
      // Repainting the list replaces the box, so put the caret back where it was.
      const again = $("#sk-q");
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch {} }
    });
  }
  $$("[data-tag]", wrap).forEach(b => b.addEventListener("click", () => {
    const t = b.dataset.tag;
    if (SKfilter.has(t)) SKfilter.delete(t); else SKfilter.add(t);
    paintSkills();
  }));
  on($("#sk-clear", wrap), "click", () => { SKfilter.clear(); paintSkills(); });
  on($("#sk-more", wrap), "click", () => { SKallTags = true; paintSkills(); });
  on($("#sk-less", wrap), "click", () => { SKallTags = false; paintSkills(); });

  /* ---- per-row ---- */
  $$("[data-sk-on]", wrap).forEach(b => b.addEventListener("change", async e => {
    const id = e.target.closest(".sk-item").dataset.id;
    paintSkills(await api(`/agent/skills/${encodeURIComponent(id)}`, {
      method: "PUT", body: { enabled: e.target.checked } }).catch(() => null));
  }));
  $$("[data-sk-swap]", wrap).forEach(b => b.addEventListener("click", async e => {
    const item = e.target.closest(".sk-item");
    const cur = SK.list.find(k => k.id === item.dataset.id);
    paintSkills(await api(`/agent/skills/${encodeURIComponent(item.dataset.id)}`, {
      method: "PUT", body: { mode: cur.mode === "always" ? "ondemand" : "always" } }).catch(() => null));
  }));
  $$("[data-sk-edit]", wrap).forEach(b => b.addEventListener("click", e =>
    editSkill(e.target.closest(".sk-item").dataset.id)));
  $$("[data-sk-del]", wrap).forEach(b => b.addEventListener("click", async e => {
    const item = e.target.closest(".sk-item");
    const k = SK.list.find(x => x.id === item.dataset.id);
    if (!confirm(`Delete "${k.name}" permanently?\n\n` +
                 (k.seeded ? "It ships with Nexus, so RESTORE DEFAULTS would bring it back."
                           : "There is no copy of this one — it is gone for good."))) return;
    paintSkills(await api(`/agent/skills/${encodeURIComponent(item.dataset.id)}`, { method: "DELETE" })
      .catch(err => { toast(err.message, "err"); return null; }));
  }));
}

async function addSkillFiles(files) {
  const md = files.filter(f => /\.(md|markdown|txt)$/i.test(f.name));
  if (!md.length) return toast("markdown files only", "err");
  let last = null;
  for (const f of md) {
    try {
      const content = await f.text();
      last = await api("/agent/skills", { method: "POST", body: { name: f.name, content } });
    } catch (e) { toast(`${f.name}: ${e.message}`, "err"); }
  }
  if (last) { toast(md.length === 1 ? "Skill added" : `${md.length} SKILLS ADDED`, "ok"); paintSkills(last); }
}

/** Read or write one skill. The same form for both, because "open" almost always
 *  turns into "change one line". */
async function editSkill(id) {
  let k = { id: "", name: "", description: "", mode: "ondemand", tags: [], body: "" };
  if (id) { try { k = await api(`/agent/skills/${encodeURIComponent(id)}`); } catch { return; } }

  const form = document.createElement("div");
  form.className = "sk-edit";
  form.innerHTML = `
    <div class="ag-row"><label for="sk-e-name">Name</label>
      <input id="sk-e-name" type="text" value="${esc(k.name)}" placeholder="What this skill is called"></div>
    <div class="ag-row"><label for="sk-e-desc">One line</label>
      <input id="sk-e-desc" type="text" value="${esc(k.description)}"
             placeholder="How Kernel decides whether he needs it"></div>
    <div class="ag-row"><label for="sk-e-tags">Tags</label>
      <input id="sk-e-tags" type="text" value="${esc((k.tags || []).join(", "))}"
             placeholder="docker, media, troubleshooting" spellcheck="false"></div>
    <div class="sk-tagsug">${(SK.tags || []).slice(0, 14).map(t =>
      `<button type="button" class="sk-tag sug" data-sug="${esc(t.tag)}">+ ${esc(t.tag)}</button>`).join("")}</div>
    <div class="ag-row"><label>When</label>
      <div class="ag-modes sk-modes">
        <button type="button" class="ag-mode${k.mode === "always" ? " on" : ""}" data-m="always">
          <b>In memory</b><span>Sent with every message. Keep it short.</span></button>
        <button type="button" class="ag-mode${k.mode === "ondemand" ? " on" : ""}" data-m="ondemand">
          <b>On demand</b><span>Only its name and one line cost anything.</span></button>
      </div></div>
    <div class="sk-editbar">
      <label for="sk-e-body">Skill text</label>
      <span class="spacer"></span>
      <div class="sk-tabs" role="group" aria-label="Preview or write">
        <button type="button" class="sk-tab" data-pane="read">Preview</button>
        <button type="button" class="sk-tab" data-pane="write">Write</button>
      </div>
    </div>
    <textarea id="sk-e-body" class="sk-body" spellcheck="false"
              placeholder="Markdown. Write it as instructions to Kernel.">${esc(k.body)}</textarea>
    <div id="sk-e-view" class="sk-view md" hidden></div>`;

  let mode = k.mode;
  openModal({
    title: id ? "Edit skill" : "New skill",
    icon: ICON("terminal"),
    body: form,
    foot: `<span class="spacer"></span>
           <button class="btn sm" id="sk-e-back" type="button">Back</button>
           <button class="btn primary sm" id="sk-e-save" type="button">Save</button>`
  });
  $$("[data-m]", form).forEach(b => b.addEventListener("click", () => {
    mode = b.dataset.m;
    $$("[data-m]", form).forEach(x => x.classList.toggle("on", x === b));
  }));
  // Suggestions from tags already in use, so the vocabulary stays small enough
  // for the filter chips to be worth having.
  $$("[data-sug]", form).forEach(b => b.addEventListener("click", () => {
    const box = $("#sk-e-tags", form);
    const have = box.value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
    if (have.includes(b.dataset.sug)) return;
    box.value = [...have, b.dataset.sug].join(", ");
  }));
  // Write / preview. The preview uses the same renderer the chat does, so what
  // you see here is what Kernel will be handed.
  const pane = which => {
    $$(".sk-tab", form).forEach(t => t.classList.toggle("on", t.dataset.pane === which));
    const ta = $("#sk-e-body", form), view = $("#sk-e-view", form);
    ta.hidden = which !== "write";
    view.hidden = which !== "read";
    if (which === "read") view.innerHTML = md(ta.value) || '<p class="dim">nothing written yet</p>';
  };
  $$(".sk-tab", form).forEach(t => t.addEventListener("click", () => pane(t.dataset.pane)));
  // Reading first: opening a skill is usually to see what it says, and rendered
  // Markdown is the readable form of it. A blank new skill has nothing to read,
  // so that one opens on the keyboard instead.
  pane(k.body.trim() ? "read" : "write");

  on("#sk-e-back", "click", () => openSkillLibrary());
  on("#sk-e-save", "click", async () => {
    const name = $("#sk-e-name", form).value.trim();
    const body = $("#sk-e-body", form).value;
    if (!name) return toast("give it a name", "err");
    if (!body.trim()) return toast("give it some text", "err");
    try {
      await api("/agent/skills", { method: "POST", body: {
        id: k.id || name, name, description: $("#sk-e-desc", form).value.trim(), mode,
        tags: $("#sk-e-tags", form).value, content: body } });
      toast("Skill saved", "ok");
      openSkillLibrary();
    } catch (e) { toast(e.message || "could not save", "err"); }
  });
}

/* Whether the Advanced block is open. Module-level because every setting change
   re-renders the whole section, and a panel that closes itself each time you
   touch something inside it is worse than no panel. */
let AGadvOpen = false;

const DAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function cronWhen(cr) {
  const d = cr.days || [];
  if (d.length === 7) return `every day at ${cr.time}`;
  if (d.length === 5 && [1, 2, 3, 4, 5].every(x => d.includes(x))) return `weekdays at ${cr.time}`;
  if (d.length === 2 && d.includes(0) && d.includes(6)) return `weekends at ${cr.time}`;
  if (!d.length) return `at ${cr.time}`;
  return `${d.map(i => DAY_FULL[i].slice(0, 3)).join(", ")} at ${cr.time}`;
}

function cronRow(cr) {
  const r = cr.lastRun;
  const state = !r ? "" : r.waiting ? "waiting" : r.ok ? "ok" : "bad";
  const last = !r ? "never run"
    : r.waiting ? `waited for approval on ${esc(r.waiting)} — ${since(r.at)}`
    : `${r.ok ? "ran" : "failed"} ${since(r.at)}`;
  return `<div class="cr-item${cr.enabled ? "" : " off"}" data-id="${esc(cr.id)}">
    <label class="cr-on"><input type="checkbox" data-cron-on="${esc(cr.id)}"${cr.enabled ? " checked" : ""}></label>
    <div class="cr-main">
      <div class="cr-name">${esc(cr.name)}<span class="cr-when">${esc(cronWhen(cr))}</span></div>
      <div class="cr-prompt">${esc(cr.prompt)}</div>
      <div class="cr-last ${state}">${last}${r?.summary ? ` · ${esc(String(r.summary).slice(0, 120))}` : ""}</div>
    </div>
    <div class="cr-acts">
      <button class="btn sm" data-cron-run="${esc(cr.id)}" type="button">Run now</button>
      <button class="btn sm" data-cron-edit="${esc(cr.id)}" type="button">Edit</button>
      <button class="btn sm danger" data-cron-del="${esc(cr.id)}" type="button">DELETE</button>
    </div>
  </div>`;
}

/** A plain on/off row for settings that are not capabilities — same shape, but
 *  it does not live under the caps object. */
function capRowPlain(key, title, sub, on_) {
  return `<label class="ag-cap">
    <input type="checkbox" data-cap-plain="${esc(key)}"${on_ ? " checked" : ""}>
    <span class="ag-capbody"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
  </label>`;
}

function editCron(cr) {
  const row = cr || { id: "", name: "", prompt: "", time: "08:00", days: [0, 1, 2, 3, 4, 5, 6], enabled: true };
  let days = new Set(row.days);

  const form = document.createElement("div");
  form.className = "sk-edit";
  form.innerHTML = `
    <div class="ag-row"><label for="cr-name">Name</label>
      <input id="cr-name" type="text" maxlength="60" value="${esc(row.name)}" placeholder="Morning check"></div>
    <div class="ag-row"><label for="cr-time">At</label>
      <input id="cr-time" type="time" value="${esc(row.time)}">
      <span class="hint">This machine's clock.</span></div>
    <div class="ag-row"><label>On</label>
      <div class="cr-days" role="group" aria-label="Days">
        ${DAYS_SHORT.map((d, i) => `<button type="button" class="cr-day${days.has(i) ? " on" : ""}"
          data-day="${i}" aria-pressed="${days.has(i)}" aria-label="${DAY_FULL[i]}">${d}</button>`).join("")}
      </div></div>
    <div class="ag-row cr-presetrow"><label>Quick</label>
      <div class="cr-days">
        <button type="button" class="btn sm" data-days="everyday">Every day</button>
        <button type="button" class="btn sm" data-days="weekdays">Weekdays</button>
        <button type="button" class="btn sm" data-days="weekends">Weekends</button>
      </div></div>
    <label for="cr-prompt">What to ask</label>
    <textarea id="cr-prompt" class="sk-body cr-body" spellcheck="false"
      placeholder="Check for failed services and full filesystems, and tell me only if something needs doing.">${esc(row.prompt)}</textarea>
    <p class="hint">Write it as one instruction. Kernel has the same tools and the same
      approval setting it has in the chat panel.</p>`;

  const paintDays = () => $$("[data-day]", form).forEach(b => {
    const on_ = days.has(Number(b.dataset.day));
    b.classList.toggle("on", on_);
    b.setAttribute("aria-pressed", String(on_));
  });

  openModal({
    title: cr ? "Edit scheduled task" : "New scheduled task",
    icon: ICON("power"),
    body: form,
    foot: `<span class="spacer"></span>
           <button class="btn sm" id="cr-cancel" type="button">Cancel</button>
           <button class="btn primary sm" id="cr-save" type="button">Save</button>`
  });

  $$("[data-day]", form).forEach(b => b.addEventListener("click", () => {
    const i = Number(b.dataset.day);
    if (days.has(i)) days.delete(i); else days.add(i);
    paintDays();
  }));
  $$("[data-days]", form).forEach(b => b.addEventListener("click", () => {
    days = new Set(b.dataset.days === "weekdays" ? [1, 2, 3, 4, 5]
                 : b.dataset.days === "weekends" ? [0, 6]
                 : [0, 1, 2, 3, 4, 5, 6]);
    paintDays();
  }));
  on("#cr-cancel", "click", () => { closeModal(); renderAgentSettings(); });
  on("#cr-save", "click", async () => {
    const name = $("#cr-name", form).value.trim();
    const prompt = $("#cr-prompt", form).value.trim();
    if (!prompt) return toast("say what to ask", "err");
    if (!days.size) return toast("pick at least one day", "err");
    try {
      await api("/agent/crons", { method: "PUT", body: {
        id: row.id || undefined, name: name || "Scheduled task", prompt,
        time: $("#cr-time", form).value || "08:00", days: [...days].sort(), enabled: row.enabled } });
      toast("Task saved", "ok");
      closeModal();
      AGadvOpen = true;
      renderAgentSettings();
    } catch (e) { toast(e.message || "could not save", "err"); }
  });
}

function capRow(key, title, sub, on_, disabled, danger) {
  return `<label class="ag-cap${danger ? " danger" : ""}${disabled ? " off" : ""}">
    <input type="checkbox" data-cap="${esc(key)}"${on_ ? " checked" : ""}${disabled ? " disabled" : ""}>
    <span class="ag-capbody"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
  </label>`;
}

boot();
})();
