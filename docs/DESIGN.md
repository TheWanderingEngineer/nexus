# Nexus — Technical Design

> Status: **Draft for review.** Nothing is built yet. Redline freely; decisions marked
> **[LOCKED]** came out of the scoping conversation, everything else is my proposal.

## 1. What Nexus is

A self-hosted homelab dashboard and Docker manager for a single Linux host. CasaOS's
information architecture — app tiles, system status, files, terminal, app store — rebuilt
as a customizable widget canvas with a modern design system.

**In scope:** live system metrics (CPU, RAM, storage, temperatures, network, SMART
health), Docker container management, an app store fed by pluggable Git-hosted libraries,
a web terminal, a file manager, and a drag-and-drop widget dashboard supporting
user-authored widgets.

**Explicitly not in scope:** it is not an operating system. No installer, no disk
partitioning, no RAID/ZFS management, no clustering, no Kubernetes. It installs onto a
Linux box you already have.

### Locked decisions

| Decision | Choice |
|---|---|
| Target host | Linux, bare metal or VM, amd64 + arm64 |
| Backend | Go 1.23+, single static binary with embedded UI |
| Frontend | React + TypeScript + Vite + Tailwind |
| Scope of control | Full — Docker, shell, filesystem |
| Network exposure | LAN-first, internet-ready by config flag |
| Users | Single admin (multi-user left additive) |
| App catalog | Own format + CasaOS library adapter |
| Dev loop | Cross-compile on Windows, scp to box; GitHub Releases for installs |
| Existing box | Currently runs CasaOS; Nexus coexists on another port |

## 2. Architecture

```
+-- Browser ---------------------------------------------+
|  React 18 + TypeScript + Vite + Tailwind               |
|  gridstack.js    widget canvas, drag/resize/persist    |
|  uPlot           streaming time-series charts          |
|  xterm.js        terminal emulator                     |
|  TanStack Query  REST cache;  native WS for streams    |
+------------+-------------------------------------------+
             |  REST  (actions, CRUD, CSRF-protected)
             |  WS    (metrics, PTY, container logs, events)
+------------v-------------------------------------------+
|  nexus - single Go binary, UI embedded via go:embed    |
|                                                         |
|  api/       chi router, handlers, middleware            |
|  auth/      argon2id, sessions, CSRF, TOTP              |
|  metrics/   collector loop -> in-memory ring buffers    |
|  sensors/   hwmon + thermal_zone discovery, smartctl    |
|  dockerx/   Docker SDK, compose orchestration           |
|  library/   catalog sync, manifest parsing, adapters    |
|  files/     path-jailed file operations                 |
|  terminal/  creack/pty session manager                  |
|  widgets/   registry + declarative custom widget eval   |
|  ws/        hub, per-topic fan-out                      |
|  audit/     append-only action log                      |
|                                                         |
|  SQLite (modernc.org/sqlite - pure Go, no cgo)         |
+---------------------------------------------------------+
             |
             +-- /var/run/docker.sock
             +-- /sys/class/hwmon, /sys/class/thermal, /proc
             +-- smartctl (exec)
```

### Process model

Nexus runs as a systemd service **as root**. This is not laziness — the feature set
requires it: PTY sessions that are actually useful, SMART queries needing `SYS_RAWIO`,
arbitrary filesystem access, and the Docker socket (which is root-equivalent regardless).
Running as a dedicated user with a pile of granted capabilities would add real complexity
while conferring effectively the same power.

The consequence, stated plainly: **compromising Nexus means owning the host.** Section 9
is therefore not optional polish.

### Why a single binary

`go:embed` places the built SPA inside the executable. Deployment is: copy one file,
restart one service. No Node runtime on the server, no `node_modules`, no static-file path
configuration, no nginx required in front. Cross-compiling from Windows is two environment
variables.

## 3. Repository layout

```
nexus/
  cmd/nexus/main.go            entrypoint, flags, graceful shutdown
  internal/
    api/          router.go, middleware.go, handlers_*.go
    auth/         argon2.go, session.go, csrf.go, totp.go
    config/       config.go      (file + env + flags, in that precedence)
    db/           db.go, migrations/*.sql
    metrics/      collector.go, cpu.go, mem.go, disk.go, net.go, ring.go
    sensors/      discover.go, hwmon.go, thermal.go, smart.go, gpu.go
    dockerx/      client.go, containers.go, compose.go, events.go
    library/      sync.go, manifest.go, adapter_nexus.go, adapter_casaos.go
    files/        browse.go, transfer.go, jail.go
    terminal/     session.go, pty_linux.go
    widgets/      registry.go, spec.go, eval.go
    ws/           hub.go, topics.go
    audit/        audit.go
    updater/      github.go, apply.go
  web/
    src/
      main.tsx, App.tsx
      components/       design-system primitives
      widgets/          one directory per built-in widget
      pages/            Dashboard, Apps, Files, Terminal, Settings
      lib/              api client, ws client, hooks
      styles/
    index.html, vite.config.ts, tailwind.config.ts
  scripts/
    install.sh          curl | sudo bash installer
    nexus.service       systemd unit template
  deploy.ps1            dev: cross-compile + scp + restart
  .github/workflows/
    ci.yml              build + vet + test on push
    release.yml         on tag: build both arches, attach to Release
  docs/DESIGN.md        this file
```

The app catalog lives in a **separate repository** (`nexus-library`) so it can be
versioned, forked, and PR'd independently of the application itself.

## 4. Data model

SQLite via `modernc.org/sqlite` — pure Go, which keeps the build cgo-free and therefore
trivially cross-compilable from Windows. Migrations are numbered SQL files embedded in the
binary and applied at startup.

```
users            id, username, password_hash, totp_secret, totp_enabled,
                 created_at, last_login_at
sessions         id, user_id, created_at, expires_at, last_seen_at,
                 user_agent, ip
dashboards       id, user_id, name, position, is_default
widgets          id, dashboard_id, type, x, y, w, h, config_json,
                 title_override
widget_defs      id, name, kind('declarative'|'iframe'), spec_json,
                 created_at              -- user-authored custom widgets
libraries        id, name, url, format('nexus'|'casaos'), enabled,
                 last_sync_at, last_sync_error, etag
catalog_apps     id, library_id, slug, manifest_json, icon_url,
                 UNIQUE(library_id, slug)
installed_apps   id, slug, name, compose_path, managed_by('nexus'|'casaos'),
                 installed_at, source_library_id
settings         key, value_json         -- one row per key
audit_log        id, ts, user_id, action, target, detail_json, ip
```

### Metrics history

Deliberately **not** a SQLite table on the hot path. Writing a row per metric per second to
SQLite on an SD card or consumer SSD is a good way to kill a homelab disk.

- **Live (last 15 minutes, 1 s resolution):** in-memory ring buffers, one per metric
  series. Fixed allocation, zero disk I/O. This serves every chart the dashboard draws by
  default.
- **Historical (optional, off by default):** a downsampler writes 1-minute averages into a
  `metrics_rollup` table with configurable retention. Turn it on only if you want
  week-long graphs.

## 5. API surface

REST for actions and CRUD, WebSocket for anything streaming. All REST mutations require a
CSRF token; every endpoint except login requires a valid session.

### REST

```
POST   /api/auth/login              {username, password, totp?}
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/system/info             hostname, kernel, uptime, distro, arch
GET    /api/system/metrics          one-shot snapshot (WS is the streaming path)
GET    /api/system/sensors          discovered sensors + current values
GET    /api/system/disks            mounts, sizes, usage, device mapping
GET    /api/system/smart/{device}   parsed smartctl output, cached
GET    /api/system/network          interfaces, addresses, counters

GET    /api/docker/containers
GET    /api/docker/containers/{id}
POST   /api/docker/containers/{id}/start|stop|restart
DELETE /api/docker/containers/{id}
GET    /api/docker/images
GET    /api/docker/stats

GET    /api/files?path=             directory listing
POST   /api/files/mkdir|rename|delete|copy|move
POST   /api/files/upload            chunked, resumable
GET    /api/files/download?path=
GET    /api/files/roots             configured allowed roots

GET    /api/libraries
POST   /api/libraries               {url, format?}   format auto-detected
DELETE /api/libraries/{id}
POST   /api/libraries/{id}/sync

GET    /api/apps?q=&category=       catalog, searchable
GET    /api/apps/{library}/{slug}
POST   /api/apps/{library}/{slug}/install    -> job id, progress over WS
GET    /api/apps/installed
DELETE /api/apps/installed/{id}

GET    /api/dashboards
POST   /api/dashboards
PUT    /api/dashboards/{id}                  rename, reorder
PUT    /api/dashboards/{id}/layout           bulk position save (debounced)
POST   /api/dashboards/{id}/widgets
PUT    /api/widgets/{id}                     config update
DELETE /api/widgets/{id}
GET    /api/widgets/registry                 built-in types + config schemas
GET    /api/widgets/custom
POST   /api/widgets/custom                   author declarative or iframe widget

GET    /api/updates/check
POST   /api/updates/apply

GET    /api/audit?limit=&offset=
```

### WebSocket

| Endpoint | Direction | Payload |
|---|---|---|
| `/ws/metrics` | server to client | Metric frames at a client-requested interval (default 2 s). The client subscribes only to the series its visible widgets need, so off-screen widgets cost nothing. |
| `/ws/terminal` | bidirectional | Binary PTY data plus JSON control frames (resize, ping). |
| `/ws/logs/{id}` | server to client | Container log stream, follow mode. |
| `/ws/events` | server to client | Docker events, install job progress, library sync results, toasts. |

A single multiplexed socket would also work, but four topic-scoped sockets are easier to
reason about and let the terminal be independently kill-switched.

## 6. Metrics and sensors

### Collector loop

One goroutine ticks at 1 s. Each collector implements:

```go
type Collector interface {
    Name() string
    Collect(ctx context.Context) ([]Sample, error)
    Interval() time.Duration   // collectors may opt out of the 1 s default
}
```

Samples land in ring buffers; the WS hub fans out to subscribers on their requested
cadence. Collectors that are slow or hardware-dependent (SMART especially) declare a
longer interval rather than blocking the tick.

### Where the numbers come from

| Metric | Source |
|---|---|
| CPU load, per-core | `gopsutil/cpu` (`/proc/stat` deltas) |
| Memory, swap | `gopsutil/mem` (`/proc/meminfo`) |
| Disk usage | `gopsutil/disk` — with an explicit ignore list for overlay/tmpfs/squashfs, which otherwise pollute the list badly on a Docker host |
| Network throughput | `/proc/net/dev` counter deltas per interface |
| CPU temperature | `/sys/class/hwmon/*/temp*_input` (`coretemp` on Intel, `k10temp` on AMD); `/sys/class/thermal/thermal_zone*/temp` on ARM |
| Fan speed | `/sys/class/hwmon/*/fan*_input` |
| NVMe temperature | hwmon under `/sys/class/nvme/*`, falling back to smartctl |
| SATA drive temperature | `drivetemp` kernel module if loaded, else `smartctl -A` |
| SMART health | `smartctl --json --nocheck=standby -a /dev/xxx` |
| GPU | `nvidia-smi --query-gpu=... --format=csv`, or `amdgpu` hwmon |
| Docker per-container stats | Docker SDK stats stream |

### Sensor discovery is a first-class feature, not a detail

No two machines expose the same sensors, and raw hwmon labels are frequently useless
(`temp1`, `temp2`, `acpitz`). So:

1. On first run, Nexus walks hwmon, thermal zones, and block devices and builds a
   candidate list with whatever labels the kernel provides.
2. **Settings → Sensors** shows every discovered channel with its live value, and lets you
   rename, hide, set warn/critical thresholds, and pin favourites.
3. The mapping is persisted, so widgets reference stable IDs rather than kernel paths that
   can renumber across reboots.

This turns the messiest part of the project into a five-minute setup screen instead of a
permanent source of wrong readings.

### Spinning disks

`smartctl` with `--nocheck=standby` so polling never spins an idle drive up. SMART results
are cached for 15 minutes by default. This matters: naive SMART polling defeats drive
spindown and quietly costs you power and drive life.

## 7. Widget system

The heart of the product. Three tiers.

### Tier 1 — built-in widgets

A registry entry per widget type:

```ts
registerWidget({
  type: 'cpu',
  name: 'CPU',
  category: 'system',
  sizes: ['1x1', '2x1', '2x2', '4x2'],
  defaultSize: '2x1',
  series: ['cpu.total', 'cpu.percore'],   // drives WS subscription
  configSchema: z.object({
    mode: z.enum(['total', 'percore']).default('total'),
    showTemp: z.boolean().default(true),
    warnAt: z.number().min(0).max(100).default(85),
  }),
  component: CpuWidget,
})
```

The settings panel is **generated from `configSchema`** — no per-widget settings UI to
write. Adding a widget is one file plus a registry line.

### Responsive by size, not just scaled

This is what separates a designed dashboard from an assembled one. Each widget renders
genuinely differently per size class:

| Size | CPU widget renders as |
|---|---|
| 1x1 | Single large number + a colored ring |
| 2x1 | Number, sparkline, and current temperature |
| 2x2 | Number, full chart with axes, load averages |
| 4x2 | Per-core stacked chart, temps, top processes |

### Tier 2 — customized built-ins

Same component, different persisted config. "Disk widget, pointed at `/mnt/tank`, warn at
85%, rendered as a bar rather than a donut." Purely a `widgets.config_json` row. Users can
save a configured widget as a named preset.

### Tier 3 — user-authored widgets

Two mechanisms, deliberately both safe:

**a) Declarative (the default path).** A YAML spec: a data source plus a renderer. No
arbitrary code in the page.

```yaml
name: Jellyfin Sessions
icon: mdi:play-circle
refresh: 10s
source:
  type: http
  url: http://localhost:8096/Sessions
  headers:
    X-Emby-Token: "{{ secret.jellyfin }}"
  select: "$.length()"
render:
  type: stat
  label: Active streams
  format: integer
  thresholds:
    - { at: 0, color: muted }
    - { at: 1, color: accent }
    - { at: 5, color: warn }
```

Source types: `http` (with JSONPath select), `command` (allowlisted shell), `metric`
(any internal series), `docker` (container state or stat), `ping`.
Renderers: `stat`, `gauge`, `sparkline`, `bar`, `table`, `list`, `status-dot`, `text`.

This covers the large majority of what people actually want, and it is safe to import from
someone else's repo because nothing in it executes arbitrary code in your browser.

**b) Sandboxed iframe (the escape hatch).** Drop in HTML/JS; it renders in a
`sandbox="allow-scripts"` iframe with a `postMessage` contract for requesting data,
receiving theme tokens, and reporting its desired height. Full creative freedom, contained
blast radius.

**Rejected:** loading user JS as a module into the main page. One broken widget would take
down the entire dashboard, and one malicious one would have the session cookie.

### Phase 1 built-in widget set

CPU · Memory · Storage (per-mount) · Network throughput · Temperatures · SMART health ·
System info · Uptime · Docker containers · Container stats · App tiles · Service health
checks · Clock · Notes · Quick links · Terminal (embedded mini)

## 8. App libraries

A **library** is a Git repository with a known structure. Adding one is pasting a URL.

```
nexus-library/
  library.yaml
  apps/
    jellyfin/
      manifest.yaml
      docker-compose.yml
      icon.png
      screenshots/
    immich/
      ...
```

```yaml
# apps/jellyfin/manifest.yaml
schema: 1
slug: jellyfin
name: Jellyfin
tagline: The free software media system
description: |
  Multi-line markdown description.
icon: icon.png
category: media
author: Jellyfin Team
website: https://jellyfin.org
license: GPL-2.0

compose: docker-compose.yml

# Values surfaced in the install dialog and substituted into compose
params:
  - key: MEDIA_PATH
    label: Media library location
    type: path
    default: /DATA/Media
  - key: WEB_PORT
    label: Web UI port
    type: port
    default: 8096

health:
  http: "http://localhost:${WEB_PORT}/health"
  timeout: 60s

# Drives the app tile
webui:
  path: "/"
  port: "${WEB_PORT}"
```

### CasaOS adapter

CasaOS libraries are compose files with `x-casaos:` extension blocks carrying metadata.
The adapter maps those fields onto the Nexus manifest shape at sync time, so an imported
CasaOS store is browsable and installable natively. Format is auto-detected on add: if
`library.yaml` is absent but `x-casaos` blocks are present, treat it as CasaOS.

This is what gets you a populated app store on day one without authoring hundreds of
manifests.

### Install flow

1. Resolve manifest, prompt for `params`.
2. **Validate ports** against what is already bound on the host — the single most common
   install failure, and worth catching before Docker does.
3. Render compose with substitutions to `/var/lib/nexus/apps/{slug}/docker-compose.yml`.
4. `docker compose up -d`, streaming progress over `/ws/events`.
5. Poll the health check until pass or timeout.
6. Register in `installed_apps`, create the app tile.

### Coexisting with your current CasaOS

- Nexus binds a different port (`:8080` by default; CasaOS holds `:80`).
- Both talk to the same Docker daemon. Docker does not mind multiple clients.
- CasaOS labels its containers `io.casaos.*`. Nexus **reads those labels**, so your
  existing apps appear as proper tiles with their icons and metadata from first launch.
- Apps carrying CasaOS labels are marked `managed_by='casaos'` and shown with a badge.
  Nexus will display and start/stop them, but will not rewrite their compose files until
  you explicitly "adopt" the app. This avoids two managers fighting over one container.

## 9. Security model

Because Nexus runs as root with the Docker socket and a shell endpoint, its authentication
boundary *is* the host's security boundary. All of the following belongs in Phase 0, not a
later hardening pass — every item here is materially harder to retrofit.

| Control | Detail |
|---|---|
| Password hashing | argon2id, per-install random salt, tuned parameters |
| Sessions | Random 256-bit token, server-side record, `HttpOnly` + `SameSite=Strict` + `Secure` when TLS is enabled, sliding expiry |
| **WS origin check** | Validate the `Origin` header on every WebSocket upgrade. Browsers do **not** apply CORS to WebSockets, so without this any website you visit while logged in can open a root shell on your box. This is the single most important line of code in the project. |
| CSRF | Double-submit token on every state-changing REST call |
| Login throttling | Exponential backoff per-IP and per-account, with lockout |
| TOTP | Schema and verification implemented in Phase 0, enrolment UI later. Makes "internet-ready" a settings toggle rather than a migration. |
| Path jail | Every file operation resolves symlinks and confirms the result is inside a configured root. Reject, never sanitize-and-continue. |
| Command construction | `exec.Command` with argument slices only. No shell interpolation anywhere. Device names for `smartctl` validated against the enumerated block-device list, not accepted from the client. |
| Terminal kill switch | `terminal.enabled` config flag, off-switchable without redeploy |
| Audit log | Append-only: every shell session opened, app installed or removed, file deleted, container destroyed, login attempt |
| Bind address | Defaults to LAN. Binding to `0.0.0.0` with the terminal enabled and 2FA disabled emits a loud startup warning. |
| Reverse proxy | `trusted_proxies` CIDR list; `X-Forwarded-For` honoured only from those sources |

### Threat model, briefly

- **In scope:** hostile web pages attacking the dashboard through the user's browser
  (CSRF, WS origin abuse); credential stuffing; path traversal in the file manager;
  command injection through device or path parameters; a malicious app library.
- **Out of scope:** an attacker already root on the host; supply-chain compromise of Docker
  images (the app store runs whatever the manifest says — same trust model as CasaOS and
  every other app store of this kind).
- **Explicit residual risk:** installing an app from an untrusted library runs untrusted
  containers as root. The UI should say so at install time when the library is not the
  official one.

## 10. Build, release, deployment

### Development loop

`deploy.ps1` — the thing you will actually run a hundred times a day:

1. `npm run build` in `web/` (skippable with `-NoWeb` for backend-only changes)
2. `$env:GOOS="linux"; $env:GOARCH="amd64"; go build -o dist/nexus ./cmd/nexus`
3. `scp dist/nexus root@box:/usr/local/bin/nexus.new`
4. `ssh root@box "mv /usr/local/bin/nexus.new /usr/local/bin/nexus && systemctl restart nexus"`

Roughly five seconds for a backend change. For frontend work, run the Vite dev server on
Windows with its proxy pointed at the box, so you get hot reload against real hardware
data.

### Release pipeline

`release.yml`, triggered on a `v*` tag: build the frontend once, cross-compile
`linux/amd64` and `linux/arm64`, generate checksums, attach everything to a GitHub Release.

### Installation on the box

```
curl -fsSL https://raw.githubusercontent.com/<you>/nexus/main/scripts/install.sh | sudo bash
```

The script detects architecture, downloads the latest release asset, verifies the checksum,
installs to `/usr/local/bin/nexus`, writes `/etc/nexus/config.yaml` and the systemd unit,
creates `/var/lib/nexus`, then enables and starts the service.

### Self-update

`GET /api/updates/check` queries the GitHub Releases API and compares against the embedded
build version. `POST /api/updates/apply` downloads, verifies the checksum, swaps the binary
atomically, and restarts via systemd. Because the whole application is one file, this is
genuinely simple — and it is the reason the single-binary choice pays off twice.

## 11. Phasing

| Phase | Deliverable | Done when |
|---|---|---|
| **0** | Foundation: config, SQLite + migrations, auth (argon2id, sessions, CSRF, WS origin check, TOTP schema), audit log, chi router, WS hub, React shell, gridstack canvas, design tokens, `deploy.ps1`, CI + release workflows, `install.sh` | You can install from a GitHub release, log in, and drag two placeholder widgets around a persisted layout |
| **1** | System metrics: collector loop, ring buffers, sensor discovery + settings screen, SMART, `/ws/metrics`, and the CPU / Memory / Storage / Network / Temperature / SMART / System-info widgets | The dashboard shows live, correct numbers for your actual hardware |
| **2** | Docker: container list, start/stop/restart/remove, log streaming, per-container stats, reading CasaOS labels so existing apps appear as tiles | You can manage every container on the box, including the ones CasaOS installed |
| **3** | Terminal: PTY session manager, xterm.js, resize handling, session audit, kill switch | A usable root shell in the browser |
| **4** | Files: browse, chunked upload, download, mkdir/rename/move/copy/delete, path jail, archive extract | Comfortable for day-to-day file work on `/DATA` |
| **5** | App store: library sync, Nexus + CasaOS manifest parsing, install flow with port validation and health checks, uninstall, app tiles | Install Jellyfin from the store, end to end |
| **6** | Widget authoring: declarative spec engine, iframe sandbox, widget marketplace UI, multiple dashboards, themes, self-update UI | You can build a custom widget without touching Go |

Phases 0 and 1 together are where it starts feeling real.

## 12. Visual identity

**Direction: full retro-pixel OS.** Committed, not decorative — pixel type, hard bevels,
dithered fills, stepped charts, no anti-aliasing anywhere. Every competing dashboard
(Homepage, Dashy, Homarr, CasaOS) is flat-modern. This is the differentiator.

### Palette

Anchored on violet rather than neutral black — a dark grey ground reads as unconsidered,
a dark *violet* ground reads as chosen. Dark is the primary theme.

```
                  DARK (primary)      LIGHT
--void            #14101F             #CFC9DE     page ground
--panel           #221B33             #E4E0EE     widget fill
--panel-hi        #2E2545             #F2EFF8     raised / hover
--bevel-lt        #4A3D6B             #FFFFFF     top + left edge
--bevel-dk        #0D0916             #8B82A6     bottom + right edge
--rule            #3A2F55             #B3A9C9

--text            #E8E2F5             #1C1528
--text-2          #A99CC4             #4A4063
--text-3          #6E6291             #7A6F96

--accent          #4EE1E8             #0F6E85     cyan - interactive, focus, selection
--accent-2        #C77DFF             #7B3FB8     orchid - brand, active state

--ok              #5CE68A             #1F7A45
--warn            #FFC145             #9A6200
--crit            #FF4D5E             #B32334
```

Cyan and orchid carry the brand; the three semantic colors are reserved for status and
never used decoratively. That separation is what keeps a red widget border meaningful.

**Light theme is not an inversion.** Dark mode is CRT/synthwave; light mode is the beige
workstation — same chunky bevel geometry, lilac-grey panels, as if the box on the desk in
1993 had been violet instead of putty. Same design language, different machine.

### Type

| Role | Face | Notes |
|---|---|---|
| Labels, chrome, nav | **Silkscreen** | 8px bitmap, crisp, all-caps with letter-spacing |
| Headings, UI text | **Pixelify Sans** | Pixel face designed for readability at length |
| Numeric data | Pixelify Sans, tabular | `font-variant-numeric: tabular-nums` |
| **Terminal + logs** | **IBM Plex Mono** | See below |

The terminal is the one deliberate exception. Shell output rendered in a decorative face
is a functional bug, not a style choice — you cannot debug in a font that loses legibility
at small sizes. The terminal pane keeps a real monospace and everything around it stays
pixel. Logs and the file manager's dense rows follow the same rule.

### Geometry rules

These are constraints, not suggestions — one violation makes the whole page look muddy on
a HiDPI display.

- **4px base unit.** Every dimension, gap, and padding is a multiple of 4.
- **`image-rendering: pixelated`** on every raster asset. No fractional scaling, ever.
- **No `border-radius`. No soft shadows.** Bevels do the work: 2px light on top/left,
  2px dark on bottom/right for raised; inverted for inset/pressed.
- **No anti-aliasing on decoration.** Dithered fills instead of gradients —
  a 4px checkerboard via `repeating-conic-gradient` is the workhorse.

### Charts

Anti-aliased curves beside pixel art look broken. Charts are drawn deliberately un-smooth:
hard-stepped lines, integer-snapped points, no AA, dithered area fills, an emphasized
square endpoint. uPlot supports this directly. It reads as an old system monitor — and in
this aesthetic it looks better than the smooth version, not worse.

### Icons

Pixel Lab turned out to be substantially more capable than its public README suggests. The
documented four tools (`create_character`, `animate_character`, `create_tileset`,
`create_isometric_tile`) are a fraction of what the MCP server actually exposes — the real
set includes `create_ui_asset` for UI panels, `create_font` for full pixel typefaces,
`image_to_pixelart` for converting existing artwork, and three general text-to-image
models. That widens the plan considerably.

| Model | Cost | Returns | Use for |
|---|---|---|---|
| `create_image_pixflux` | 1 gen | 1 image | Fast iteration, img2img, forced palettes |
| `create_image_pixen` | 1 gen | 1 image | Clean small sprites |
| `create_image_pro` | 20–40 gens | 16 candidates at 64px | Anything final — cost is per *call*, so small canvases are where it pays |

Four sources, by role:

1. **Brand marks** — logo and app icon. `create_image_pro` at 64x64, which returns 16
   candidates per call. Cheap enough to run several concepts.
2. **Functional UI icons** (~60: nav, actions, states, widget types) — a consistent 16x16
   set. These need to be *systematic* more than characterful, so generating them
   individually risks 60 icons that don't share a visual grammar. Approach: generate a few
   with `create_image_pixflux` using a forced palette via `color_image`, and fall back to
   an existing open pixel icon set for the long tail if consistency suffers.
3. **`image_to_pixelart` for third-party app logos** — this solves the open problem from
   the previous draft directly. Rather than hand-writing a canvas posterize filter, run
   each library's official logo through Pixel Lab once at install time and cache the 32x32
   result. Worth testing against a hard case (a logo with gradients and thin type) before
   committing.
4. **Pixel Lab characters** — the Nexus mascot, with `animate_character` idle states that
   react to system load. Genuinely what the tool is built for.

`create_font` is a live option for a bespoke Nexus typeface later, replacing Silkscreen.
Not Phase 0 work, but worth knowing it exists.

## 13. Open questions

1. **Icon set.** Bundle an icon pack (`mdi`, `simple-icons`) into the binary, or fetch from
   a CDN? Bundling adds a few MB but keeps a LAN-only install fully offline. I lean
   bundled — an offline homelab dashboard that needs the internet to draw icons is a bad
   look.
2. **Compose invocation.** Shell out to the `docker compose` CLI (simple, matches what
   users would run by hand, requires the plugin present) versus the compose-go library
   (no external dependency, meaningfully more code). I lean CLI with a startup check.
3. **Config file format.** YAML for consistency with the manifests, or TOML for
   unambiguous editing by hand? Leaning YAML.
4. **Historical metrics.** Is a rollup table worth building in Phase 1, or does 15 minutes
   of live data cover what you actually look at?
5. **Adoption of CasaOS apps.** How aggressive should "adopt this app" be — copy the
   compose file into Nexus's tree and take over, or just relabel in place?
