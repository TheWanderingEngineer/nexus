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
  terminal.js     pty-less shell over a WebSocket
  library.js      app-store catalogue sync + CasaOS adapter
  apps.js         compose install/uninstall, port checks, job bus
  agent.js        Hermes: providers, tools, approvals, usage, crons
  skills.js       the agent's Markdown skill library
  netmatch.js     trustedProxies matching (CIDR, exact, prefix, localhost)
  routes.js       the whole REST surface — including the Apps launcher
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

**No inline event handlers, ever.** The CSP is `script-src 'self'`, so
`onclick=` and `onerror=` written into HTML are *refused silently* — the
attribute is there, the handler never runs, and it looks like the code path is
simply wrong. Image fallbacks go through the one document-level capturing
`error` listener near the top of `app.js`, which reads `data-letter` (draw a
lettered tile instead) or `data-onfail="hide"`. Two App Store handlers sat dead
in the tree for months before this was noticed.

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

## Charts, and the crosshair that reads them

`drawChart` (one series) and `drawMirror` (two, mirrored around a centre line)
draw at the element's real pixel size — the viewBox matches the measured box
1:1, so nothing is scaled and the line stays crisp on a wide widget.

Both also record a **probe descriptor** on the SVG element, `svg.__probe`, and
that is what the hover crosshair reads:

```js
svg.__probe = {
  w, h, n,                      // viewBox size and number of samples
  at,                           // when the NEWEST sample was taken (LIVE.t)
  step,                         // ms between samples — 1000, the collector's tick
  fmt,                          // value -> string, e.g. rate() or v => v + "%"
  series: [{ label, vals, color, y }]   // y(v) -> viewBox y for that value
};
```

Three things about it are load-bearing:

- **It lives on the element, not in a closure.** Every widget rewrites its
  chart's `innerHTML` once a second, so a crosshair drawn *inside* the SVG would
  be erased between one pointer move and the next. `#probe` is a single floating
  overlay — the same arrangement as `#tip` — that re-reads `svg.__probe` after
  every redraw, which is also why `renderWidgets()` ends with `refreshProbe()`.
- **A chart with nothing to draw must call `emptyChart(svg)`,** not
  `svg.innerHTML = ""`. Clearing the pixels without clearing the descriptor
  leaves the crosshair quoting samples that are no longer on screen. Disk
  Activity on a platform that cannot report throughput is the live case.
- **Series are read right-aligned** (`sampleAt`): the newest sample is the last
  one, so a series that is one sample short is missing it from the *start*.

The line snaps to a sample rather than tracking the cursor. Between two samples
there is no reading, and a crosshair that stops where a measurement exists is
the difference between an exact value and a plausible-looking guess. Time comes
from `LIVE.t` — the frame's own timestamp — worked backwards a `step` per
sample, not from the browser clock.

Mouse and pen only, deliberately. A finger has no hover, and a chart sits inside
a widget body that a long press picks up to drag; scrubbing would have to fight
both that gesture and the page scroll and would win neither cleanly. The
crosshair also hides itself while a drag is running: a widget being moved is not
a widget being read.

Adding a chart to a new widget needs nothing beyond passing `label` and `fmt`:

```js
drawChart(r.svg, LIVE.history.cpu, 100, colorCss(cfg.color),
  { label: "LOAD", fmt: v => v.toFixed(1) + "%" });
```

Structure and the classic look are in `style.css` under `#probe`; the rounded,
soft-edged reading of the same geometry is in `workstation.css`. The line colour
is derived from `--text` with `color-mix`, with a `--text-3` fallback, so it
follows all three palettes without either theme naming a colour for it.

## The canvas has to be measurable

`layout()` returns immediately when `gridEl.clientWidth < 1`, and that one line
is a whole class of bug. A hidden page measures zero, so `cellW()` returns a
**negative** cell width and every widget is written to the same broken position
— and the window `resize` listener fires while you are on another page, because
opening a long folder listing adds a scrollbar. Geometry that cannot be measured
is not zero, it is unknown, and the response is to do nothing.

Recovery is a **ResizeObserver on the grid element**, not a hook in `go()`.
The canvas resizes without the window doing anything: returning to the
Dashboard, collapsing the rail, an iPad rotating, the browser's own font size.
The observer catches all of them, including the 0 → real transition the guard is
waiting for.

Two notes for anyone testing this. A negative `width` is **invalid CSS and is
silently rejected**, so the first widget (`x: 0`) looks untouched even when the
layout is destroyed — `left` accepts negatives happily and is what actually
piles them up, so assert over every widget, not the first. And the observer
repairs the damage before a round-trip test can see it, so
`scripts/dashboard-check.js` fires a `resize` on the hidden page and checks that
nothing was written, which is the invariant rather than a symptom. Run it with
the guard deleted before trusting a change to it: it should fail.

`tidy()` packs top-left with no gaps in reading order. `compact()` still exists
and is different — it only pulls a widget straight up its own column, so it
keeps a hole to the left of something. That is right for RESET and wrong for a
tidy-up button.

Presets are `settings.presets`, and `POST /layout/presets` runs its widgets
through the **same** `sanitizeCfg`/clamp path as `PUT /layout`. A preset must
not be a way to put into the state file what the layout endpoint would refuse.

## The agent

`server/agent.js` is self-contained: a provider catalogue, a tool table, and a
run loop. `routes.js` only exposes it. Four things in there are load-bearing.

**Capabilities gate the tool list, not just the tool.** `toolsFor(settings)`
decides which tools are even *described* to the model. A switched-off capability
does not produce a refusal the model can argue with — the tool does not exist as
far as it knows. `execute()` re-checks the capability anyway, because a paused
run can be approved after the switch was turned off.

**Two jails, in series.** `agentPath()` calls the file manager's `resolveSafe`
(or `resolveForCreate`), which answers "may Nexus touch this", and then checks
the result against the roots ticked for the agent, which answers "may Hermes".
`allowedRoots()` intersects the saved list with the *currently configured* roots
every time, so editing `config.json` can only ever narrow what a stale saved path
reaches.

**`PUT /settings` must never be a way in.** That endpoint merges whatever it is
given into `settings`, so it explicitly deletes `agent` and `agentUsage`. Without
that, the root-shell switch could be set without any of `saveSettings()`'s
validation. If you add another validated settings island, delete it there too.

**Transcripts stay in memory.** A conversation can contain file contents and
command output; writing it to `state.json` would quietly turn a chat into a copy
of the machine. Only the audit entries and the token counters reach disk.

### Skills

`server/skills.js`. A skill is a Markdown file with front matter, living in
`<dataDir>/agent-skills`. `mode: always` is concatenated into the system prompt
every turn; `mode: ondemand` contributes only its name and description, and the
body arrives through the `load_skill` tool when the model asks for it.

- **The file is the skill.** Name, description, mode and body all live in it, so
  one can be copied to another install and still be itself. Whether it is
  switched *off* lives in the store, and it stores what is OFF, not what is on —
  a file dropped into the folder appears rather than being silently ignored.
- **`slug()` jails by construction.** It takes a filename straight from a
  dropped file, so it strips to `[a-z0-9._-]` and drops leading dots: what
  survives is one flat component that cannot address a parent directory. Do not
  replace it with a check-afterwards.
- **`memory()` clips to `ALWAYS_BUDGET`** and says in the prompt that it did.
  Silently dropping a skill the owner switched on would be worse than the token
  cost.
- **`load_skill` has `cap: null`** — it is the only tool that is not capability
  gated, because it returns text the owner put there themselves, not machine
  access. `execute()` and `allTools()` both account for that.

Seeds live in `assets/agent-skills/` and are copied on first boot and by RESTORE
DEFAULTS, which is a restore rather than a reset: an edited skill keeps your
version, a deleted one comes back.

### Scheduled tasks

`saveCron` / `tickCrons` in `agent.js`, deliberately the same shape as the
Control Panel's schedules — time, days, and a `lastMinute` stamp that stops a
job firing twice inside one minute. A cron obeys the approval mode like
everything else, so on "ask me first" a task that wants to write or run stops
and waits with nobody there to answer. It records `waiting: <tool>` rather than
reporting success, and the settings page says so next to the switch. A run's
transcript is deleted once the answer is extracted: it holds file contents and
command output and has no business sitting in memory for hours.

### The briefing

`briefing()` builds a snapshot of the machine once per user turn — not once per
model call, or a dozen tool steps would mean a dozen trips to the Docker socket.
It is stamped with the time and the prompt says it is a snapshot.

It honours the capability switches: no container list without `docker`, no
folder list without `readFiles`. A switch that does not stop information flowing
is decorative.

And it states absences rather than omitting them. The collector starts a moment
*after* the socket opens (deliberately — see `index.js`), so "Memory: not
reported" is a real state the first few seconds after boot. An empty line where
a reading should be is something a model will fill in for you.

### Adding a tool

One entry in the `TOOLS` array:

```js
{
  name: "read_file", cap: "readFiles", risk: "read",
  description: "What the model reads to decide whether to call it.",
  schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  preview: a => `${a.path}`,        // only for risk "write"/"exec": what ALLOW is agreeing to
  async run(args, settings) { return "text the model gets back"; }
}
```

`risk` decides the approval gate: `read` never asks, `write` and `exec` ask
unless the owner has chosen full access. `cap` must be one of the keys in
`DEFAULTS.caps`, or the tool can never be enabled. The return value is a string
and is clipped — `clip()` exists because a 200 MB log would otherwise become a
200 MB request.

### Every tool call must come back answered

`sealed(messages)` runs once in `callModel`, before any adapter sees the
history, and it is the reason a conversation cannot brick itself.

Every provider enforces the same contract: an assistant turn carrying tool calls
must be followed by a result for each one. Break it and you do not get one bad
reply — the mismatched pair stays in the history, so the next message fails the
same way, and the one after that, until the owner starts a new conversation.
DeepSeek says it plainly: *"An assistant message with 'tool_calls' must be
followed by tool messages responding to each 'tool_call_id'."*

Two honest ways to break it, both of which happened:

- A model emits three calls in one turn, the second needs approval, so the loop
  stops — and the third is never reached.
- The owner ignores the approval card and types something else instead, stacking
  a user message on top of an open call.

`send()` now closes an ignored approval explicitly (it is a "no", and the model
is told so), and `sealed` is the backstop: anything still owed a result gets one
saying it was not run, and results answering no call at all are dropped. A model
told "not run" asks again. A model told nothing gets a 400 on its owner's behalf.

The stub provider in `scripts/agent-check.js` enforces the same contract, so a
broken history fails in the test rather than on the owner's box.

### Providers

Three wire shapes behind one normalised `{text, calls, usage}`: `anthropicCall`,
`openaiCall` (OpenAI, DeepSeek, and every local server that copies them) and
`googleCall`.

**Anthropic has no `tool` role.** Results are user turns, roles must alternate,
and it rejects block keys its schema does not name — so `anthropicMessages()`
rebuilds each block rather than passing the internal shape through, and merges
same-role turns. Sending the internal shape straight out is a 400 every time. Raw `fetch` rather than the vendors' SDKs, because `npm ci` on the
target box must never need a compiler and one adapter is less code than three
SDKs plus the glue to make them interchangeable behind a single model picker.

Prices in `PROVIDERS` carry `PRICING_AS_OF` and a `priced` flag. **Do not invent
a rate for a model you could not verify** — set `priced: false` and the UI says
"see pricing" and reports tokens without a dollar figure. Absent is not zero here
either. Two live consequences of that rule in the current catalogue: DeepSeek
lists two models rather than three, because its third alias was retired and
inventing one would be worse than a short list; and `gpt-5.6-sol` is unpriced
because the sources disagreed about its promotional rate.

Where a provider bills by time of day (DeepSeek's peak/off-peak), quote the
**peak** rate. Being wrong in the expensive direction is the safe one.

`testKey()` exists so a failure surfaces at the settings page rather than twenty
seconds into a conversation. It calls the model with capabilities stripped and
no skills attached, so it measures the connection rather than the configuration
around it — and it counts the tokens it spends, because they are real.

## The version string

`cfg.version` in `config.js`, read from `package.json`, is the only one. The
banner, `/api/health`, `/api/system/info` and the Settings page all print it. It
used to be written out in four places, three of them drifted, and "are you
actually running the new build?" became unanswerable — which is exactly the
question you need answered first when a UI change appears not to have worked.

## Behind a reverse proxy

The common deployment — a DuckDNS name, Nginx Proxy Manager, TLS — breaks the
live dashboard in a way that looks like the backend is dead: the page loads, the
API answers, and every number is zero. nginx does not forward a WebSocket
upgrade unless configured to, and NPM ships that switch off.

Three pieces handle it, and they are deliberately separate:

**`originDiagnosis(req, forcedOrigin)`** in `auth.js` replaced the boolean
`originAllowed`, which still exists and calls it. It returns *why*, not just
whether. Two things about it are load-bearing:

- It accepts `X-Forwarded-Host` **only from a peer in `trustedProxies`**. That
  header is attacker-controlled everywhere else, so the selfcheck asserts a
  forged one still gets a 403. Do not relax that to "any private address".
- `forcedOrigin` exists because a same-origin `GET` usually carries no `Origin`
  header at all, while a WebSocket handshake always does. Diagnosing the
  diagnostic request rather than the failing one answered "fine" every time.
  Only `/system/proxy-check` passes it, and it decides nothing.

**The fallback.** `connectWS()` arms a 6-second deadline on the first attempt.
If nothing has opened by then, `startPolling()` fetches `/system/metrics` every
3s and `applyFull()` maps it into the same `LIVE` shape the socket frame uses —
one function knows both shapes, so they cannot drift. A deadline rather than a
retry count: with exponential backoff, "three attempts" is fifteen seconds of a
page that says CONNECTING and shows nothing.

**The banner.** `diagnoseLink()` asks the server what it sees and names the
cause — origin refused (with the JSON to paste, built from the live config) or
upgrade never arrived. The status pill has four states and `#st-state[data-link]`
carries the colour, because the workstation theme used to pin it green and it
read LIVE while nothing was.

**`netmatch.js`** decides whether a peer is one of the operator's proxies. It
replaced `remote.includes(pattern)`, which was wrong both ways: a CIDR like
`172.18.0.0/16` matched nothing, so the documented way to trust a Docker network
silently did not work; and the pattern `10.0.0.1` matched the peer `110.0.0.1`,
so it could trust an address nobody meant. That list gates whether
`X-Forwarded-Proto` and `X-Forwarded-Host` are believed, so both directions
matter. `gui:check` covers the cases.

`npm run proxy:check` drives a real browser through four proxy shapes: upgrade
forwarded, upgrade dropped, `Host` rewritten with `trustedProxies` empty, and
the same once it is set. If you touch any of the above, run it.

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

## The launcher (Apps page)

`web/app.js`, the `LP` block. The server side is in `routes.js`, not a module of
its own: the stored shape is a list, a few flags and some text.

**A tile has an order and a size, not an x/y and a width.** This is the load-
bearing decision on this page. The same board is opened on a desktop, an iPad
and a phone, and absolute positions cannot make that trip — three columns become
one and the arrangement is gone, or worse, is silently kept per-device and
diverges. Flow plus a named size (`s`/`m`/`l`/`xl`, spans in a `repeat(auto-fill,
minmax(168px,1fr))` grid) reflows into any width with the order and the relative
weight intact. Groups carry the structure that positions used to imply.

`grid-auto-flow: dense` closes the holes a tall tile leaves, and a span wider
than the viewport is clamped by the grid itself rather than overflowing — which
is why there is no phone-specific layout code, only a smaller row height.

Old boards are migrated on read (`launcher()` in `routes.js`): sorted by `y`
then `x`, and `w`/`h` mapped to a size. Reading order is what the positions
meant.

**Dragging ends at a place in a list, not at a pixel.** A ghost follows the
pointer, a marker between two tiles says where it will land, and the drop
computes `(section, anchor, before/after)`. Dropping on a band's background
means the end of that band; dropping on the pinned band pins it. The whole
selection travels together.

Three rules that are not obvious:

**`safeUrl` accepts `http:` and `https:` only.** A tile becomes an `<a href>`.
A `javascript:` URL stored here would be persistent XSS wearing a Jellyfin icon,
and the tile is rendered from server state on every load, so the check belongs on
the way *in*. It returns `""` for anything else rather than throwing — a tile
with a bad address is still a tile you can edit.

**`/launcher/discover` proposes and never writes.** It reads the container list,
drops anything whose name *or* any published port already appears on a tile, and
returns the rest as candidates. "Pull All" then shows them with tick boxes. The
owner has renamed and arranged those tiles by hand; a discovery pass that
overwrote them would be the single most annoying thing this page could do, so the
skip is decided on the server and the write is a normal `PUT /launcher`.

**Icons resolve by slug, and the fallback is a letter.** `iconSlug()` normalises
the name, runs it through `ICON_ALIASES` for the ones that do not match
(`npm` → `nginx-proxy-manager`, `qbit` → `qbittorrent`), and builds a
`dashboard-icons` CDN URL; `img-src 'self' data: https:` is what allows it. A
box with no outbound access is the normal case, not the error case, so the
failure path draws a lettered tile — via the delegated `error` listener, because
`onerror=` would be refused (see the invariants).

### The PIN, and what it actually protects

A four-digit PIN is worth almost nothing if it only hides a button, so it does
not. `POST /launcher/:id/lock` stores a scrypt hash; `GET /launcher` returns
locked apps with `url` and `externalUrl` blanked and `locked: true`; the address
is handed over only by `POST /launcher/:id/open` with the right digits, counted
and throttled at six tries a minute. "View source" and the API are both dead
ends.

Two consequences worth knowing before changing this code:

- **`PUT /launcher` must carry the lock and the addresses across.** The browser
  never held either, so it cannot send them back; the merge in the handler is
  what stops an ordinary board save from silently unlocking everything.
- **A locked app's address cannot be edited**, because it is not on screen to
  edit. The form disables those two fields and says why. Take the PIN off first.

The README states the limit in the UI's own words: this is a screen against
whoever is looking at Nexus, not access control on the app, which has its own
login. Do not let the code drift into implying more than that.

---

## Two rules that outrank yours

Both of these shipped, both were invisible in review, and both came from the same
mechanism: `[data-gui="workstation"] :is(input[type=text],…)` has specificity
(0,2,1) and beats any single class.

**`.sel` meant two things.** It was the class on `<select>` elements *and* the
"this one is chosen" state on `.ctxopt`, file rows and swatches. The workstation
theme styled selects with `background: var(--sunk)`, so every selected option in
every widget menu became `--on-accent` text on the sunk background: a contrast
ratio of **1.05:1** — invisible, in all three dark palettes, everywhere in the
app. Dropdowns are matched by element now, and `.sel` means exactly one thing.

**`min-height: 38px` squashed every editor.** The same rule listed `textarea`,
so the skill editor's `min-height: min(58vh,520px)` lost and the box came out
60px tall. One-line fields keep the floor; text areas are excluded, and
`textarea` in `style.css` carries its own.

The lesson for new theme rules: a base rule for form fields should style the
*look* and leave the size to the component, or it will win an argument it was
never meant to have. Both are now asserted in `npm run dash:check` — contrast is
measured across five theme combinations, and the editor's height is measured
rather than its CSS read.

---

## Modals have one way out

`openModal({title, icon, body, foot, onClose})`. The **×** in the top-right
corner closes it and nothing else does the same job: no CLOSE button in the
footer, ever. The footer is for the buttons that *do* something — SAVE, BACK,
DELETE — and a second dismiss sitting among them makes you read all of them to
find the harmless one.

`onClose` is fired by `closeModal()` however the modal went away, so a dialog
that has to restore state (re-open its parent, repaint a list) hangs it there
rather than on the × handler, which would be skipped by Escape or a backdrop
click. `scripts/launcher-check.js` asserts that no window carries a second CLOSE
button; keep it that way when you add one.

---

## Rendering Markdown

`md(text)` in `app.js` renders the agent's replies and the skill editor's
preview. It is deliberately small — headings, bold/italic/strike, inline code,
fenced blocks, lists, tables, blockquotes, rules, and `http(s)` links.

**It escapes first, then marks up.** Everything it renders is untrusted: model
output, and `.md` files dropped into the skill library. Escaping the whole string
before any tag is inserted is what makes that safe, and it is why fenced code is
lifted out before the inline pass — otherwise `**` inside a code block would be
rendered as emphasis, which is exactly wrong in the one place people paste shell.

There is no library and there should not be: adding a Markdown dependency to buy
footnotes would be the first frontend build step in the project.

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
| Move a widget | its title bar, or anywhere on a widget already selected (`dragHandle`). Touch keeps hold-to-drag from anywhere |
| Read a chart | the chart, on hover — no press, so it never competes for the press |
| Rubber-band select | bare canvas (`e.target === gridEl`) |
| Pick up the cat | the cat sprite, which stops propagation |

The body was a drag handle once, and giving it up was the right trade. A widget
that is entirely a grab handle wears the grab cursor everywhere, and that cursor
says the only thing here is a thing to move — so the readable parts inside it,
the charts above all, read as decoration you are not meant to touch. Each cursor
in the `WHERE A WIDGET IS PICKED UP` block of `style.css` now names exactly one
thing the spot under it will do, and the crosshair on a chart is the only notice
anyone gets that it can be read.

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
npm run check          # auth, CSRF, the path jail, the WS origin check, the store
npm run gui:check      # theme tokens, trustedProxies matching
npm run agent:check    # providers, capabilities, the agent's jails, skills, crons
npm run proxy:check    # the four reverse-proxy shapes
npm run dash:check     # widget layout and drag, plus the app-wide UI rules
npm run apps:check     # the launcher: URLs, PINs, groups, tags, drag, a phone
```

The last three drive Chromium through Playwright.

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

## Ways this codebase has been broken before

**Editing structured text with regex or shell strings.** A rewrite of a CSS rule
with `/\.foo\{[\s\S]*?\n\}/` matched an older duplicate of the same selector and
lazily ran on until the next line ending in `}`, deleting 34 lines — the tables
section, the breadcrumbs and the whole drawer block. Symptoms were "table rows
have no dividers" and "the + ADD WIDGET button is dead" (it was fine; the drawer
had no `display` rules left). Separately, a `content:""` written through a shell
template literal landed as `content:;` and silently killed two pseudo-elements.
**Use an editor for structured text.**

**Assuming a helper does what its name suggests.** See `$` vs `$$` above.

**One class name meaning two things.** `.sel` was both "this is a dropdown" and
"this is selected". See *Two rules that outrank yours*.

**Writing a test that cannot fail.** A widget-overlap regression test passed
twice with the fix removed: once because the ResizeObserver repaired the layout
before the assertion ran, and once because it only checked the first widget —
and a negative CSS `width` is silently rejected, so that one widget's `left`
looked untouched while five others had been rewritten. **Delete the fix and
watch the test go red** before believing it. The failure message should name what
it found: "6 widgets rewritten" is a test that works.

**Trusting an inline handler to run.** See the CSP invariant above.

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
