# Nexus 0.9 — the Overview redesign

The plan for the 0.9 release, written before building it. It moves Nexus from
"a canvas of widgets" to "a single pane of glass that tells you what is wrong
first", gives it a modern visual language, and rebuilds the Kernel panel.

Everything in `docs/HACKING.md` still holds. Two of its rules shape this whole
plan: **absent is not zero** (an unmeasured thing is shown as unknown, never as
fine) and **no build step** (the browser loads `web/` straight off disk).

---

## 1. Goals

1. **Answer "is anything wrong?" in one glance.** The first screen is a status
   hero, a list of concrete problems, the day's numbers, and the health of each
   area, the same order as the reference design.
2. **Look premium.** A calm dark graphite surface, one accent, hairline
   borders, soft depth, real typography, crisp line icons, quiet motion. A light
   mode of the same design.
3. **Be fast.** No framework, no bundler, compressed assets, nothing rendering
   on a page you are not looking at.
4. **Kernel that works like a modern assistant.** Live progress while it works,
   a Stop button, suggestions, copyable code, a dock mode and an optional glass
   finish.
5. **Do not break what works.** Widgets, launcher, files, terminal, store,
   automations, auth and every invariant stay. The old looks remain one click
   away.

## 2. What is there today (inventory)

| Area | Today |
|---|---|
| Dashboard | Free-form 12-col widget canvas, 15 widgets, presets, drag/resize, phone stack |
| Apps | Launcher board: groups, pins, tags, sizes, PIN locks, discover from Docker |
| Containers | Cards, filters, manage sheet with live stats and log tail |
| Files | Path-jailed manager: roots with capacity, clipboard, DnD, uploads, editor |
| Terminal | xterm.js over a PTY (node-pty or `script`) |
| App Store | CasaOS + Nexus libraries, GitHub/compose installs, port-clash checks |
| Control Panel | Watch rules (sustain/cooldown), schedules, webhook notify, power |
| Kernel | LLM agent, 5 providers, capability switches, risk-graded approvals, skills, crons |
| Settings | Workstation palettes, Classic GUI, motion, SMART, services, audit |
| Server | Express + ws, metrics ring buffers in memory, scrypt auth, CSRF, origin check |

## 3. Gap analysis

What the reference design does, and what a homelab dashboard is expected to
do, against what Nexus has.

| # | Capability | Nexus today | Gap | Decision |
|---|---|---|---|---|
| 1 | A summary landing page | Widget canvas only | No "what is wrong" view | **Build** the Overview page |
| 2 | Service health checks (HTTP/TCP/ping/DNS) | None — containers only | The core of the reference | **Build** `server/health.js` |
| 3 | Result history and response time | None | "Last 30 results" bars | **Build**, in memory, 60 results per check |
| 4 | Problems aggregation | Alerts live in Control Panel | Scattered | **Build** one problem list from checks, containers, disks, temps, security, alerts |
| 5 | Alert on a service going down | Rules watch metrics only | Missing | **Build**: a check down for three rounds raises an alert and the webhook, with a flap damper |
| 6 | App status on the launcher | No status | Missing | **Build**: status dot on tiles and in the sidebar |
| 7 | Global search / command palette | None | Missing | **Build** ⌘K / Ctrl+K palette |
| 8 | Deep links (reload stays on the page) | Always lands on Dashboard | Missing | **Build** hash routing `#/files`, `#/area/network` |
| 9 | Modern theme, light + dark | Pixel + workstation | Look | **Build** the Modern theme (default) |
| 10 | Keyboard shortcuts | A few | Undiscoverable | **Build** `?` sheet, ⌘K, ⌘J, `g o`… |
| 11 | Kernel: progress, stop, long turns | Blocking request; a long turn dies at a proxy's 60 s timeout | Bug | **Fix**: turns run in the background, the panel polls progress |
| 12 | Kernel: polish | Tool details collapse on every repaint, tabs cramped, no code copy | Bugs | **Rebuild** the panel |
| 13 | Compression | Static files sent raw (app.js 354 KB) | Slow first load | **Build** gzip/brotli cache, ws permessage-deflate |
| 14 | Idle CPU in the browser | Widgets re-render every second on every page | Waste | **Fix**: render only what is visible |
| 15 | Container image updates ("Merge 3 updates") | None | Registry API, auth per registry | Later |
| 16 | Integrations (Pi-hole/AdGuard, Jellyfin, Immich, qBittorrent cards) | None | Per-app API clients | Later — design leaves room (§6.4) |
| 17 | Multi-host (Proxmox, other nodes) | Single host | Agent protocol | Later |
| 18 | Long-term metrics history | 15 min in RAM | Needs a write-light store | Later (RRD-style, hourly rollups) |
| 19 | 2FA / multiple users | One admin | Security | Later (TOTP first) |
| 20 | PWA install | None | Manifest + icons | Later (cheap) |

## 4. Information architecture

```
Sidebar
  [logo] Nexus · hostname                         [search]
  Overview                                         (problem badge)
  Areas ▾      Servers · Network · Storage · Containers · Apps   (status dots)
  Workspace ▾  Dashboard · Apps · Containers · Files · Terminal · App Store
  Quick launch ▾  pinned/first launcher apps, live status dots, open in a new tab
  ─────────
  Automations (Control Panel) · Settings
  [status card: LIVE · CPU · RAM · Temp]           [sign out]

Top bar
  [☰ mobile] [page icon] Page title / subtitle      [link state] [refresh] [Search ⌘K] [Ask Kernel ⌘J]
```

* **Overview** (`#/overview`, the new default): status hero → Problems → Today
  (stat cards) → Areas table (expandable rows, response time, last-30 results).
* **Area** (`#/area/<id>`): every check in that area with its history, error
  text, target, and related live readings.
* Every other page keeps its route: `#/dash`, `#/apps`, `#/containers`,
  `#/files`, `#/term`, `#/store`, `#/control`, `#/settings`.

## 5. Visual design system

### 5.1 Themes

| Theme | Modes | Notes |
|---|---|---|
| **Modern** (default) | Dark (Graphite), Light (Daylight), System | Accent: Indigo (default), Blue, Teal, Emerald, Amber, Rose |
| Workstation | Parchment, Evergreen, Night Shift | Unchanged, selectable |
| Classic | Pixel CRT | Unchanged, selectable |

Implementation: Modern is a refinement layer. `<html data-gui="workstation"
data-skin="modern">` reuses the workstation geometry (rounded, 1 px borders) and
`web/modern.css` replaces its tokens and refines every component. New
components (sidebar, overview, palette, Kernel v2) live in `web/ui.css`, written
only against tokens so they render correctly under all three themes. All
choices are browser-local, as before (`localStorage`, `window.NexusAppearance`).

### 5.2 Colour tokens

Dark (Graphite) — near-black with a cool cast, like the reference:

| Token | Value | Use |
|---|---|---|
| `--void` | `#0b0c0f` | page background |
| `--panel` | `#131418` | cards, sidebar |
| `--panel-hi` | `#1a1b21` | hover, raised |
| `--sunk` | `#0f1013` | inputs, wells |
| `--rule` | `#24262d` | hairline borders |
| `--text` / `-2` / `-3` | `#ecedf0` / `#a3a6b0` / `#6c707c` | ink |
| `--accent` | `#7c83ff` (Indigo) | the one accent |
| `--ok` / `--warn` / `--crit` | `#3ecf8e` / `#f5b544` / `#f2555a` | status, never decoration |

Light (Daylight): `#f6f7f9` page, `#ffffff` cards, `#e6e8ec` rules, `#16181d`
ink, same hues one step deeper for contrast (AA on white).

Status colour carries meaning only: green up, amber degraded, red down, grey
unknown. A problem hero is tinted by the worst status, never by the accent.

### 5.3 Typography

System UI stack led by Inter/SF/Segoe UI Variable (no download, crisp on every
OS), Plex Mono for numbers in tables and code. Scale: 12 / 13 / 14 (body) / 16 /
20 / 28 (hero) / 34 (stat numbers), tabular numerals everywhere a number
changes. Sentence case for labels; Classic keeps its uppercase.

### 5.4 Space, shape, depth

4 px grid; card padding 16–20 px; radius 10 (cards), 8 (controls), 6 (chips);
hairline borders; elevation by a soft shadow only on floating things (menus,
palette, Kernel, modals).

### 5.5 Icons

One inline SVG set (Lucide-style, 1.75 stroke, `currentColor`) generated by
`IC(name)` in `app.js`. Pixel PNG icons remain for Classic/Workstation; each
icon slot renders both and CSS shows the right one for the theme.

### 5.6 Glass (optional)

Settings → Appearance → **Glass panels** (`data-glass="on"`). Floating surfaces
(Kernel, command palette, menus, modals) become translucent with
`backdrop-filter: blur(22px) saturate(160%)`, a 1 px inner highlight and a
softer border. **On by default** (the owner asked for it) and one switch to turn
off; never in Classic; automatically solid where `backdrop-filter` is
unsupported or `prefers-reduced-transparency` is set.

### 5.7 Motion

Durations 120 ms (hover/press), 180 ms (menus), 240 ms (panels); one easing
`cubic-bezier(.16,1,.3,1)`. What moves: page fade-in, card lift on hover,
palette/panel scale-in, number tick, result-bar hover. Nothing loops except the
live dot and the Kernel "thinking" shimmer. Reduced motion means stop.

## 6. Components and behaviour

### 6.1 Overview

* **Hero** — icon in a status-tinted tile, "All systems normal" or "N
  problems", a one-line summary, and quick chips: pinned apps (with icons and
  status), *Ask Kernel*, *Everything else ⌘K*.
* **Problems** — one row per problem: severity icon, title, area · since when,
  the raw error in mono, and the action (open the app, manage the container,
  open Files, open Automations).
* **Today** — stat cards in an auto-fill grid (min 200 px): CPU (sparkline,
  load), Memory (bar), Storage (per-disk segmented bar), Network (rx/tx
  sparkline), Containers (n of m running), Apps (n of m up), Temperature, Uptime,
  Security, Alerts. A card whose reading is unknown says so.
* **Areas** — table: name, health, checks ring `x / y`, average response, and
  the last 30 results as coloured bars with a tooltip per result. Rows expand
  to the individual checks.

### 6.2 Command palette

⌘K / Ctrl+K / `/`. Fuzzy-ranked results grouped as Pages, Areas, Apps,
Containers, Actions (add widget, new rule, theme toggle, glass toggle, run checks
now, open Kernel, *Ask Kernel "…"*). Arrow keys, Enter, Esc. Results are built
from data already in memory — no request per keystroke.

### 6.3 Kernel panel v2

Bugs found in the old panel and their fixes:

| Bug | Fix |
|---|---|
| A long turn is one HTTP request; a reverse proxy's 60 s timeout kills it and the reply only appears after a reload | Turns run in the background on the server; the panel polls the transcript and shows each tool step as it happens |
| No way to stop a runaway turn | **Stop** button → `POST /agent/run/:id/stop`, checked between model calls and between tool calls |
| Every repaint re-renders all messages, collapsing open tool details and jumping the scroll | Keyed incremental rendering; open state remembered; stick-to-bottom only when already at the bottom |
| A close "×" nested inside the tab button | Conversations move to a history menu with real buttons |
| Attachment object URLs never revoked | Revoked when sent or removed |
| Esc did nothing; no shortcut | Esc closes, ⌘J / Ctrl+J toggles |
| Cramped tabs, footer, unlabeled controls | New header: model chip, new chat, history, dock/float, close |

New: suggestion chips on an empty chat, per-code-block Copy, Retry the last
message, elapsed timer while working, dock-to-side mode (full height), full
screen sheet on phones, the glass finish.

### 6.4 Room for integrations (later)

Stat cards are produced by small "providers" (`{ id, title, icon, read() }`).
Integrations such as Pi-hole or Jellyfin become another provider with its own
settings block; nothing in the Overview needs to change to add one.

## 7. Backend

### 7.1 `server/health.js`

* **Derived checks**, no configuration needed:
  * *Servers*: metrics collector fresh, CPU < 90 % sustained, memory < 92 %,
    hottest sensor below its critical point, Docker reachable.
  * *Network*: DNS resolution (`dns.resolve`), internet reachability (TCP
    connect to 1.1.1.1:443 / 8.8.8.8:53), default gateway (ICMP via `ping`,
    from `/proc/net/route`).
  * *Storage*: one per mount (warn 85 %, fail 95 %), SMART verdicts where read.
  * *Containers*: each container, running and not `unhealthy`.
  * *Apps*: every launcher tile with a local address, HTTP GET with a 6 s
    timeout; any response under 500 counts as up (401/403 means "it answered").
* **Custom checks** (HTTP, TCP, ping, DNS) with a name, target and area, stored
  in `settings.health.custom`, editable from the Area page.
* Results: `{ t, s: "up"|"warn"|"down"|"unknown"|"off", ms, msg }`, last 60 per
  check, **in memory only** (the metrics invariant). Network/app probes every
  30 s, derived checks every 10 s; a pass already running is joined, never run
  twice.
* A check that fails **three** rounds in a row raises an alert
  (`automation.raise`) and sends the configured webhook; recovery is announced
  once; a check that alerted in the last 15 minutes stays quiet (flap damper).
  Built at two strikes first — on a congested link that made 24 alerts an hour.
* Probes never interpolate a shell: `ping` is `execFile` with a validated
  hostname, HTTP is a plain GET (certificates not verified — homelab services
  are self-signed), and locked launcher apps are probed server-side without
  their address ever reaching a browser.
* API: `GET /api/checks` (areas + checks + problems), `POST /api/checks/run`,
  `PUT /api/checks/config` (custom checks, webhook switch). `PUT /settings` now
  refuses the `health`, `launcher` and `presets` islands, which have their own
  validated endpoints.

### 7.2 Kernel

`send` and `resume` accept `{ async: true }`: the turn starts, the response
returns at once with `busy: true`, and `GET /agent/run/:id` reports progress.
A second message while busy is refused with 409. `POST /agent/run/:id/stop`
sets a flag the loop checks. The synchronous form remains for scripts and tests.

### 7.3 Delivery

* Static `web/` files are gzip (and brotli where the client accepts it)
  compressed once per file version and kept in memory; `ETag` revalidation as
  before. Measured: `app.js` 426 KB → 114 KB (brotli) / 127 KB (gzip).
* WebSockets use `permessage-deflate` (metrics frames shrink ~4×).
* Assets keep `?v=<version>` cache-busting; the version comes from
  `package.json` only.

## 8. Performance budget

| | Target |
|---|---|
| First load over LAN (compressed) | < 200 KB transferred |
| Repeat load | 304s only |
| Idle CPU in an open tab | ≈ 0 when hidden; one paint per second on the visible page |
| Overview refresh | one `/api/checks` call per 15 s while visible |

Techniques: render-gating on `document.hidden` and page visibility, cached CSS
tokens (no `getComputedStyle` per chart per frame), keyed DOM updates in the
Kernel, `content-visibility` on long lists, passive listeners.

## 9. Accessibility

Visible focus rings, AA contrast in both modes (asserted for status colours),
`aria-current` on navigation, the palette as a combobox/listbox, the Kernel log
as `role=log`, status never by colour alone (icon + word), reduced motion
honoured, all actions reachable by keyboard.

## 10. Responsive

| Width | Layout |
|---|---|
| ≥ 1280 | Sidebar 248 px, stat grid 5 across |
| 1024–1279 | Sidebar 220 px, 4 across |
| 768–1023 | Sidebar collapses to icons (expand on demand), 3 across |
| < 768 | Sidebar becomes a drawer (☰), 2 across, areas table becomes stacked rows, Kernel full screen |
| < 420 | 1 across |

Hit targets grow under `(pointer: coarse)`, as before.

## 11. Rollout

```bash
# on the server
cd ~/nexus && git pull && sudo bash scripts/install.sh
```

The installer is idempotent and keeps `/etc/nexus/config.json` and the data
directory. Hard-refresh the browser once.

**Rolling back the look only:** Settings → Appearance → Workstation or Classic.
**Rolling back the release:** `git checkout d923027` (the last 0.8 commit) and
re-run the installer; `git checkout main` and re-run it again to come back.

## 12. Later

Container image update checks, integrations (DNS blockers, media servers,
photo libraries, download clients), multi-host agents, a write-light long-term
metrics store, TOTP, PWA manifest.
