# Hacking on Nexus

Written for whoever picks this up next, including future me. This covers how it
is *built* and which decisions are load-bearing.

**Which document to read:**

| | |
|---|---|
| `docs/HACKING.md` | this file — architecture, invariants, how to extend it |
| `docs/DESIGN.md` | the original pixel design system. Historical in places: it predates the workstation theme and its "no border-radius" rule now governs only the classic look |
| `PRODUCT.md` | what the product is meant to be |
| `HANDOFF.md` | a transient note between agents, if one is present. Delete it once settled |
| `README.md` | install, configure, and what each feature does |

Two things are true of the whole codebase and explain a lot of what follows:
**nothing is faked when it cannot be measured**, and **no gesture has to guess
what it is** — each one is decided by where it starts.

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
  appearance.js   loaded before paint; sets the theme attributes on <html>
  style.css       the original pixel theme, and every layout rule
  workstation.css the workstation theme, layered on top of style.css
  vendor/         xterm.js, vendored because CSP forbids CDN scripts
assets/brand/       pixel art (PixelLab); cat/ holds the Server Cat frames
assets/workstation/ workbench scene and the theme's fonts
```

Both stylesheets always load. `workstation.css` is an override layer scoped to
`[data-gui="workstation"]`, not a replacement, so anything structural — layout,
positioning, new components — belongs in `style.css` and only the *look* is
overridden. A rule written only in `workstation.css` disappears for anyone on
the classic theme.

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

## Two themes, three palettes

`appearance.js` runs before first paint — that is why it is a blocking script in
`<head>` — and stamps four attributes on `<html>`:

| Attribute | Values |
|---|---|
| `data-gui` | `workstation` (default) or `classic` |
| `data-palette` | `parchment` (light), `evergreen` (dark), `midnight` (dark) |
| `data-theme` | `light` / `dark`, derived from the above |
| `data-motion` | `full` or `reduced` |

All four are browser-local (`localStorage`), never server state — the same
account on two machines can look different, deliberately. `window.NexusAppearance`
is the only supported way to change them; it writes, re-applies and fires a
`nexus:appearance` event that the rest of the app listens for.

**The two themes disagree about corners, and that is fine.** `docs/DESIGN.md`
forbids `border-radius` anywhere — that rule belongs to the *classic* pixel
theme and still holds there. The workstation theme is rounded throughout. Before
adding a shape, decide which theme you are styling; a radius written into
`style.css` leaks into the pixel theme and looks wrong there.

Anything that reads colour from JavaScript must read it from the CSS tokens
(`cssv("--accent")`), never hard-code a hex. Two bugs have come from ignoring
that: the terminal painted its own near-black frame inside a green panel, and
the widget charts stopped following the palette.

## The file manager

Beyond listing and uploading, it does capacity, notes, a clipboard, and drag and
drop. Points worth knowing before changing any of it:

- **`GET /files/roots`** returns each root with `size`, `used`, `available`,
  `usage`, plus the user's `note` and `order`. Capacity comes from `statfs` on
  the root itself, not by matching its path against a list of mounts — a root
  nested inside another mount must report its own filesystem. `available` is
  `bavail`, not `bfree`, because the root-reserved blocks are not space you can
  write to.
- **`PUT /files/roots/prefs`** stores note and order together, keyed by resolved
  path, and drops any key that is not a configured root. Normalise with
  `path.resolve()` before comparing — `listRoots()` resolves its paths, so a
  raw-string comparison silently matches nothing on Windows.
- **`POST /files/transfer`** is the single copy/move endpoint. `transferTo()` in
  `app.js` is its single caller: both the clipboard paste and drag-and-drop go
  through it, so clash handling cannot drift between them.
- **Three refusals are load-bearing.** A directory cannot go into itself or a
  descendant (`fs.cp` will otherwise recurse into the copy it is writing and
  fill the disk); nothing is overwritten unless asked, with the clashing names
  returned *before* anything moves; a configured root cannot be moved.
- **`EXDEV` is the normal path, not an edge case.** `/DATA` and `/mnt/data` are
  different filesystems, so a "move" between them falls back to copy-then-delete.

A refusal can carry detail. `server/index.js` forwards `clashes`, `conflicts`
and `wanted` from a thrown error through a **named allowlist**, and `api()` in
`app.js` copies the same three onto the Error it throws. Add a field in both
places or it silently does not arrive — without this a 409 reaches the user as
"1 item already exists" with no way to say which.

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

There are fifteen widgets today: `cpu`, `memory`, `storage`, `network`,
`sensors`, `containers`, `uptime`, `clock`, `boot`, `cat`, `cores`, `procs`,
`diskio`, `security`, `host`. **One of each** — `addWidget` refuses a duplicate
and the library greys out what is already placed, so the rule holds however a
widget is added.

## Dragging and selecting

Three gestures share the dashboard, and they are kept apart by where each one is
allowed to *start*:

| Gesture | Starts on |
|---|---|
| Move a widget | the widget |
| Rubber-band select | bare canvas (`e.target === gridEl`) |
| Pick up the cat | the cat sprite, which stops propagation |

Because the starting element decides, none of them ever has to arbitrate
mid-gesture. Keep that property: a gesture that has to guess will guess wrong.

Two more rules make dragging non-destructive, and both are easy to undo by
accident:

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

## The workbench scene

`assets/workstation/workbench.png` is the still illustration, used on the
Settings page. The rail shows an animated version built from two derived layers:

- `workbench-base.png` — the scene with the foliage removed
- `workbench-leaves.png` — the foliage only, on the same 240×120 canvas so it
  registers exactly over the hole

Layers rather than a clipped copy of the whole scene: rotating a clip leaves the
original leaves visible underneath and the plant appears to grow a second set.

Three things move — leaves, indicator, steam — and every overlay is positioned
as a **percentage measured from the PNG's own pixels**, not eyeballed. The
indicator sits exactly on the 4×4 red square already in the art so it pulses,
rather than adding a second light beside it. If the art is ever regenerated,
re-measure: scan for the red pixels and the foliage bounding box, then redo the
percentages.

Motion stops completely under `[data-motion="reduced"]` and
`prefers-reduced-motion`. "Reduced" means stop, not slow down.

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
- **Every drive card can show the same capacity.** Two roots on one filesystem
  genuinely have one pool of free space. `statfs` is answering correctly.
- **`npm run vendor` is broken** — it points at `scripts/vendor-xterm.js`, which
  does not exist. Long-standing, and harmless unless you re-vendor xterm.
