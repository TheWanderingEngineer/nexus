# Hacking on Nexus

Written for whoever picks this up next, including future me. `docs/DESIGN.md`
covers what it should *look* like; this covers how it is *built* and which
decisions are load-bearing.

---

## Shape of the thing

Node 20, ESM, **no native runtime dependencies** — `npm ci` must never need a
compiler on the target box. No build step on the frontend: `web/` is served
straight off disk and loaded by the browser as-is.

```
server/
  index.js        express app, static serving, WebSocket upgrade + routing
  config.js       defaults < /etc/nexus/config.json < env vars
  store.js        JSON state, atomic writes, audit ring
  auth.js         scrypt, sessions, CSRF, login throttle, WS origin check
  metrics.js      1s collector -> in-memory ring buffers
  sensors.js      hwmon / thermal_zone discovery, smartctl
  security.js     failed logins, listening ports, pending updates
  automation.js   watch rules, scheduled tasks, webhooks, power
  dockerx.js      container list + control, reads io.casaos.* labels
  files.js        path-jailed file ops, uploads
  library.js      app-store catalogue sync + CasaOS adapter
  apps.js         compose install/uninstall, port checks, job bus
  routes.js       the whole REST surface
web/
  app.js          one IIFE, no framework, no bundler
  style.css       one stylesheet, design tokens at the top
  vendor/         xterm.js, vendored because CSP forbids CDN scripts
assets/brand/     pixel art (PixelLab); cat/ holds the Server Cat frames
```

---

## Invariants — break these and something important breaks quietly

**The WebSocket origin check** (`auth.js` `originAllowed`, called first in the
`upgrade` handler). Browsers do not apply CORS to WebSockets. Without it, any
page you visit while logged in can open a root shell on the box. It is the
highest-consequence line in the codebase.

**The path jail** (`files.js`). Every client path is `realpath`-resolved and
must land inside a configured root. Traversal is *rejected*, never sanitised
and retried — "clean it up and continue" is how traversal bugs survive.
`resolveForCreate` is the one exception and is deliberately careful: it walks up
to the nearest component that actually exists, jails *that*, then appends the
missing tail. Components that do not exist cannot be symlinks.

**Metrics live in memory, never on disk.** Fixed ring buffers, 15 minutes at 1s.
Writing a row per metric per second to an SD card or a consumer SSD kills it.

**Absent is not zero.** If a reading cannot be taken, say so. `diskIO` is `null`
on platforms that cannot report it and the widget says "not reported on this
platform"; security checks report `?`, never `0`. A check that quietly says
all-clear when it failed to look is worse than no check.

**Visibility lists store what is HIDDEN, not what is shown.** A "shown" list
silently omits any drive or sensor that did not exist when the menu was last
opened, which is indistinguishable from a bug.

**Anything slow gets a `busy` guard, not just a longer interval.** On a slow
host, un-guarded periodic work queues behind itself until the calls overlap
permanently. See `procLoop` in `metrics.js`.

---

## Adding a widget

Widgets are entries in the `REG` object in `web/app.js`. That is the whole
extension point — there is no registration elsewhere.

```js
mywidget: {
  name: "My Widget",                  // shown in the library and the header
  icon: ICON("cpu"),                  // assets/brand/icons/ui-*.png
  desc: "One line, said plainly",     // library card + header tooltip
  w: 4, h: 4,                         // default size in grid cells

  defaults: { mode: "bars" },         // merged under the user's saved cfg

  // Rows of preset buttons in the right-click menu.
  options: [
    { key: "mode", label: "Display", values: [
      { value: "bars", label: "BARS" }, { value: "list", label: "LIST" }] }
  ],

  // Optional: a tick list of individual items to show or hide.
  picker: cfg => ({
    key: "hidden", label: "Channels", icon: ICON("temp"),
    empty: "Nothing detected yet.",
    items: LIVE.things.map(t => ({ value: t.id, label: t.name, sub: "detail" }))
  }),

  // Optional: one-shot commands. Use for anything a row of buttons cannot say,
  // such as free text.
  actions: [
    { label: "RENAME", run(item) { /* ... setCfg({ ... }) */ } }
  ],

  mount(bodyEl, cfg) {                // called once; return whatever you need
    bodyEl.innerHTML = `<div class="mine"></div>`;
    return { box: $(".mine", bodyEl) };
  },

  update(ref, cfg) {                  // called ~1/s and on every metrics frame
    ref.box.textContent = LIVE.cpu;   // must be cheap and idempotent
  }
}
```

Notes that will save you an hour:

- `update` runs on a shared tick. Do all timing against `Date.now()`, never
  against an assumed cadence.
- A config change **remounts** the widget, so `mount` may run many times.
  Anything expensive belongs in `LIVE`, not in `mount`.
- `cfgOf(item)` gives `{ scale, color, bg, ...defaults, ...saved }`. Use
  `colorCss(cfg.color)` for the accent; `--ws` (scale) and `--wc` (colour) are
  already on the element for CSS to use.
- `hiddenSet(cfg)` reads a picker's hidden list.
- Escape everything user- or host-derived with `esc()` before it goes near
  `innerHTML`. Container names, file names and process names are all hostile.
- `$` is `querySelector` (one). `$$` is `querySelectorAll` (many). Calling
  `.forEach` on `$` threw for a whole release and took the file manager down
  with it, because the surrounding `catch` swallowed it.

### What the server will actually persist

`PUT /api/layout` sanitises every widget (`sanitizeCfg` in `routes.js`). A
config value survives only if it is:

| Type | Limit |
|---|---|
| number | clamped to ±1,000,000 |
| boolean | as-is |
| string | **truncated to 40 characters** |
| array of strings | max 64 entries, each ≤200 chars |

At most 14 keys, and each key must match `^[a-zA-Z][a-zA-Z0-9_]{0,24}$`.
Anything else is dropped silently. The 40-character string cap is the one that
catches people out.

Layout fields persisted per widget: `id, t, x, y, w, h, order, cfg`.
`order` is the **phone** reading order and is deliberately separate from `x/y`
so reordering on a phone does not flatten the desktop canvas.

---

## Dragging widgets

Two rules make it non-destructive, and both are easy to undo by accident:

1. **Every frame is computed from a snapshot taken at pointer-down**, never from
   the previous frame. Otherwise `resolve()` displaces widgets, they stay
   displaced, and each frame pushes the already-pushed result of the last one —
   so crossing the canvas and coming back permanently rearranges the layout.
2. **`pointercancel` is a cancel, not a drop.** Treating it as a drop commits a
   move the user never finished.

On touch, a press that travels is a scroll and a press that stays still becomes
a drag. That is implemented with *touch* events rather than pointer events
because suppressing the scroll needs `preventDefault()` on `touchmove`, which
needs a non-passive listener; `touch-action` cannot express "sometimes".

---

## Responsive: three axes, kept separate

Merging these is why "mobile styles" usually break tablets.

| Decides | Driven by |
|---|---|
| Layout | viewport **width** |
| Hit-target size | `(pointer:coarse)` — is a finger driving it? |
| Reading size | `min-width:1800px` — how far away is it? |

A 1024px iPad is not a desktop, and a 1080p TV is not simply more desktop.

---

## The Server Cat

Sprites live in `assets/brand/cat/`, named `<mood>-<frame>.png`:

- moods: `sleepy`, `content`, `alert`, `grumpy`
- frames: `a`, `b` (the two-frame idle; they differ by tail position, which is
  why beating fast between them reads as a tail flick)
- `content-blink.png`, `alert-blink.png` — optional. `CAT_BLINK` gates which
  moods have one, so a mood without the art simply does not blink.
- `stand-a/b.png` plus `rise-1..5.png` — the sit↔stand transition, played
  forwards to stand and backwards to sit.

All dialogue substitutes `{name}`, `{they}`, `{them}`, `{their}`, `{theyre}` at
display time. Never hardcode the cat's name or gender into a line.

Position (`catX`/`catY`) is a **fraction of the stage**, not pixels, so where
she is put survives a resize.

---

## Verifying a change

There is a real self-check; run it before pushing anything server-side:

```bash
npm run check
```

It boots a server on a scratch port with a scratch data dir and exercises auth,
CSRF, the path jail, the WebSocket origin check and the store endpoints.

To look at a change in a browser without touching your real instance, run a
second server against a throwaway data dir and config — never point a test at
`./.nexus-data`, which holds the real account. Log in over the API rather than
typing into the form, the way `scripts/selfcheck.js` does, then inject the
returned cookies.

**Do not fake data to make a screenshot look right.** If a platform genuinely
cannot report something, that absence is the correct output. If you must
simulate to check a rendering path, do it in a temporary edit and diff the file
afterwards to prove it is gone.

---

## Two ways this codebase has been broken before

**Editing structured text with regex or shell strings.** A rewrite of a CSS rule
with `/\.foo\{[\s\S]*?\n\}/` matched an older duplicate of the same selector and
lazily ran on until the next line ending in `}`, deleting 34 lines — the tables
section, the breadcrumbs and the whole drawer block. Symptoms were "table rows
have no dividers" and "the + ADD WIDGET button is dead" (it was fine; the drawer
had no `display` rules left). Separately, a `content:""` written through a shell
template literal landed as `content:;` and silently killed two pseudo-elements.
**Use an editor for structured text.**

**Assuming a helper does what its name suggests.** See `$` vs `$$` above.

---

## Things that look like bugs and are not

- **The cat is always asleep on an idle box.** That is the reading. Sleep is
  AUTO/KEEP AWAKE/LET SLEEP in the right-click menu.
- **Disk Activity says "not reported on this platform" on Windows.** `fsStats`
  reads `/proc/diskstats`. It draws on Linux.
- **Four of the five Security Watch checks show `?` on Windows.** They shell out
  to `journalctl`, `ss`, `apt-check` and `who`.
- **`npm run check` fails one assertion on a slow Windows box** (`system info
  returns data`). `si.osInfo()` has been measured at 97 seconds there, so warmup
  has not finished when the assertion runs. It passes on Linux.
