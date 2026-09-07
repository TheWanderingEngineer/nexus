# Nexus

A retro-pixel homelab dashboard and Docker manager for a single Linux host.
Live system metrics, container control, a file manager, a web terminal, and a
drag-and-drop widget canvas — on a design system that looks like a machine from
1994 and behaves like something from now.

<img src="assets/brand/icons/nexus-128.png" width="96" alt="Nexus">

---

## Requirements

| | |
|---|---|
| OS | Linux (developed against Ubuntu Server 24.04, amd64 + arm64) |
| Node | 20 or newer — the installer adds it if missing |
| Optional | `smartmontools` for drive health, Docker for container management |

Nexus has **no native dependencies**, so `npm ci` never needs a compiler on the
target machine.

## Install

```bash
git clone https://github.com/<you>/nexus.git
cd nexus
sudo bash scripts/install.sh
```

Then open `http://<your-server-ip>:8080` and create your admin account on first
visit. That account is the only one; there is no default password to forget to
change.

To upgrade, pull and re-run — the installer is idempotent and keeps your config:

```bash
cd nexus && git pull && sudo bash scripts/install.sh
```

### Running alongside CasaOS

CasaOS holds port 80, so Nexus defaults to **8080**. Both talk to the same Docker
daemon, which Docker is entirely happy about. Nexus reads `io.casaos.*` container
labels, so apps you installed through CasaOS appear in Nexus immediately, tagged
`CASAOS` in the containers table.

## Configuration

`/etc/nexus/config.json`, created on install:

```jsonc
{
  "host": "0.0.0.0",
  "port": 8080,
  "allowedOrigins": [],          // extra origins allowed to open a WebSocket
  "trustedProxies": [],          // CIDRs whose X-Forwarded-For we believe
  "terminal": { "enabled": true, "shell": "/bin/bash" },
  "docker":   { "enabled": true, "socket": "/var/run/docker.sock" },
  "fileRoots": [                 // the file manager cannot escape these
    { "name": "DATA", "path": "/DATA" },
    { "name": "root", "path": "/root" }
  ],
  "smart": { "enabled": true, "cacheSeconds": 900, "devices": [] },
  "dataDir": "/var/lib/nexus",
  "sessionHours": 168
}
```

Environment overrides: `NEXUS_PORT`, `NEXUS_HOST`, `NEXUS_DATA_DIR`,
`NEXUS_TERMINAL=off`, `NEXUS_ALLOWED_ORIGINS`.

Restart after editing: `sudo systemctl restart nexus`

## Security — read this part

Nexus runs **as root** and exposes a shell, the Docker socket, and your
filesystem. Its login is therefore your host's security boundary. This is stated
plainly rather than buried:

> **Anyone who can reach this port and log in gets root on the machine.**

What is in place:

| Control | Implementation |
|---|---|
| Password hashing | scrypt, N=2¹⁵ r=8, per-install random salt |
| Sessions | 256-bit token, server-side, `HttpOnly` + `SameSite=Strict`, `Secure` under TLS |
| **WebSocket origin check** | Validated on every upgrade. Browsers do **not** apply CORS to WebSockets — without this, any site you visited while logged in could open a root shell on your box. |
| CSRF | Double-submit token on every state-changing request |
| Login throttling | Exponential backoff per IP after 5 failures, capped at 15 min |
| Path jail | Every file path is `realpath`-resolved and must land inside a configured root; traversal is rejected, never sanitised |
| Command safety | No shell interpolation anywhere. SMART device names come from the kernel's own enumeration, never from the client |
| Audit log | Shell sessions, container actions, file deletions, logins |
| Terminal kill switch | `terminal.enabled: false`, no redeploy needed |

**Do not expose this to the internet as-is.** Keep it on your LAN, or reach it
over Tailscale/WireGuard. If you must publish it, put it behind a reverse proxy
with TLS and an auth layer in front, set `trustedProxies`, and turn the terminal
off.

## The app store

**Libraries** are git repositories of app definitions. Two layouts are read:

| Format | Layout |
|---|---|
| `casaos` | `Apps/<Name>/docker-compose.yml` carrying an `x-casaos:` metadata block |
| `nexus` | `apps/<slug>/manifest.yaml` next to a `docker-compose.yml` |

The **CasaOS App Store is added by default** and just needs its first sync
(a shallow clone, a few hundred MB). That gives you several hundred apps
immediately without anyone hand-writing manifests. Add your own libraries by
pasting a git URL under **App Store → LIBRARIES**.

### Installing straight from GitHub

**App Store → + FROM GITHUB** accepts any of:

- `https://github.com/owner/repo` — looks for a compose file at the repo root
  on `main` then `master`
- `https://github.com/owner/repo/blob/main/docker-compose.yml`
- a raw `.yml` URL
- or paste a compose file into the box directly

Before anything runs, Nexus **checks every published port against what is
already bound** on the host and refuses with a clear message rather than letting
you discover the clash at the bottom of a wall of Docker pull output. You can
override with "install anyway".

Everything Nexus installs is labelled `io.nexus.managed=true` and lands in
`/var/lib/nexus/apps/<slug>/docker-compose.yml`, so it stays distinguishable
from containers you started by hand and from CasaOS's.

Uninstall removes the containers and **keeps volumes by default** — the compose
file also stays on disk, so a mis-click is recoverable.

> Installing an app runs third-party containers as root. Only install from
> sources you trust. Nexus says so at the point of install, not just here.

## The terminal

A real PTY in the browser, using xterm.js (vendored in `web/vendor/`, not loaded
from a CDN). Arrow keys, tab completion, colours, `htop`, `vim` — all work.

There are two backends and the UI tells you which is active:

| Backend | Resize | Requirement |
|---|---|---|
| `node-pty` | Full `SIGWINCH` | optional dependency; needs a compiler at install time |
| `script` | Best-effort via `stty` | util-linux, always present |

`node-pty` is an **optional** dependency: if your box has no build toolchain,
npm skips it and Nexus silently uses `script` instead. To get the better one,
install build tools before running the installer:

```bash
sudo apt-get install -y build-essential python3
```

Every session open and close is written to the audit log, and the whole feature
can be switched off with `terminal.enabled: false`.

## The dashboard

Widgets float where you drop them — gravity only applies when you press RESET.

| Gesture | Effect |
|---|---|
| Right-click a widget | Its own settings: size, colour, background tint, plus per-type options |
| Ctrl/⌘ + click | Add or remove a widget from the selection |
| Ctrl/⌘ + A | Select every widget, including any below the fold |
| Drag a selected widget | Moves the whole selection, keeping its internal spacing |
| Right-click a selection | Only the settings they all share; per-type options appear when the types match |
| Delete / Backspace | Remove the selection |
| Escape | Clear it |

**Storage** and **Sensors** carry a tick list in their right-click menu, so you can
drop `/boot/efi` from the disk list or hide the four hwmon channels that only ever
report 0 V. The list stores what is *hidden*, not what is shown — a drive you plug
in next month appears on its own rather than being silently excluded.

### On a phone or a tablet

The gear in each widget's header opens the same settings menu, because touch has
no right-click. On phones it opens as a bottom sheet rather than a menu pinned to
a fingertip.

**Hold a widget to pick it up.** A press that moves is a scroll; a press that
stays still for a moment becomes a drag, with a short buzz to say so. Below
640px the canvas becomes a single column and dragging reorders the list.

That phone order is stored separately from the desktop x/y, so rearranging on
your phone does not flatten the layout you built on a real screen. The two are
allowed to differ; until you drag something on a phone, the phone order simply
follows the desktop reading order.

Layout, hit targets and reading size are decided independently — by width, by
whether a finger is driving, and by how large the display is. That is why a
1024px iPad gets desktop layout with touch-sized controls, and a 1080p TV gets
desktop layout at a size you can read from a sofa.

## Files

Selection works the way it does everywhere else: click, Ctrl/⌘+click to add,
Shift+click for a run, or drag a box over empty space. Delete removes the
selection, and the right-click menu collapses to the operations that make sense
for a set. Downloads are issued one file at a time — there is no server-side zip.

### Uploads

**UPLOAD** and **UPLOAD FOLDER** in the toolbar, or drop files and folders
anywhere on the page. A dropped folder keeps its structure — the directory tree
is rebuilt on the server as the files arrive.

Bytes go up as a raw `PUT` with the destination in the query string, so there is
no multipart dependency on either side, and progress is read from the browser's
own upload events rather than guessed at. Uploads run one file at a time so the
percentage means something, and **CANCEL** stops after the file in flight.

Three things worth knowing:

- **Nothing is overwritten silently.** Clashes are detected before any bytes move
  and you are asked once for the whole batch — overwrite everything, or skip the
  ones that already exist and upload the rest.
- **Each file is streamed to a temp file and renamed on completion**, so a
  connection that drops halfway cannot leave a truncated file where a good one
  used to be.
- **The path jail applies to uploads too.** Destinations are resolved against the
  nearest existing ancestor, which is then checked against your `fileRoots`;
  missing intermediate directories cannot be symlinks, so there is nothing left
  to escape through.

## Control panel

Automations, in three parts.

**Watch rules** — one rule watches one thing (a temperature, CPU, memory, a disk,
a container) and acts when it stays wrong. Two knobs make this useful rather than
noisy:

- **Sustain** — how long the condition must hold. A CPU that touches 95 °C for one
  sample during a compile is not an emergency, and an alerting system that cries
  wolf gets muted, which is worse than no alerting.
- **Cooldown** — how long the rule stays quiet after firing. Without it a disk
  sitting at 91 % alerts on every evaluation tick, forever.

Actions are: notify in Nexus, send a webhook, restart or stop a container, or
reboot/shut the host down. Two notify-only rules are seeded on first boot — high
CPU temperature and a nearly-full disk — because those are the two failures that
actually kill homelab boxes.

**Scheduled tasks** — container restarts on a clock. A timed whole-host reboot is
deliberately *not* offered: rebooting Linux on a timer hides a leak instead of
finding it and guarantees downtime at a fixed hour. Restarting the one container
that misbehaves is the same idea aimed at the thing that actually misbehaves.

**Notifications** — an ntfy topic, a Discord webhook, or any endpoint that takes a
JSON POST; the shape is picked from the URL. This is the part that matters: an
alert that only appears in a browser tab you do not have open is not an alert.
Browser notifications are available too, while a Nexus tab is open.

**Power** — reboot and shutdown, disarmed by default. While disarmed, both the
buttons and any rule that carries a power action are refused by the server, not
just greyed out in the UI. Arming is a deliberate switch, and the buttons then ask
you to type the hostname; Nexus runs as root, so these do exactly what they say and
there is no remote power-on.

## Development

```bash
npm install          # REQUIRED FIRST — see note below
npm run dev          # auto-restarts on change
npm run check        # end-to-end self test
npm run store-check  # clones the real CasaOS store and validates the adapter
```

> **`scripts/install.sh` does not install dependencies into your clone.** It
> copies the app to `/opt/nexus` and runs `npm ci` *there*, because that is what
> the systemd service executes. Your git checkout keeps no `node_modules` of its
> own, so `npm install` is a separate step before any of the dev scripts will
> run. Both test scripts now check for this and say so rather than failing with
> a module-resolution stack trace.

Running a dev script as your normal user will also print a line about not being
able to read `/etc/nexus/config.json`. That is correct and harmless — the config
is root-owned `600` because it can contain secrets, so the scripts fall back to
defaults with a scratch data directory.

`npm run check` boots a real server on a scratch port and exercises the auth
flow, CSRF enforcement, the path jail, the WebSocket origin check and the store
endpoints. It runs on Windows and macOS too, where hardware sensors report as
simulated and Docker-dependent assertions accept a 503.

`npm run store-check` is the one that cannot be faked: it clones the actual
CasaOS App Store and asserts the adapter still parses it, because that format is
whatever IceWhale ships today.

> **On Windows with an antivirus scanner**, module loading can be extremely slow
> — importing express alone has been measured at over two minutes on a scanned
> drive. That is environmental, not the app. The self-check allows four minutes
> for startup because of it; on Linux the server is listening in well under a
> second.

## How it is put together

```
server/
  index.js     express app, static serving, WebSocket upgrade + routing
  config.js    defaults < config file < env
  store.js     JSON state with atomic writes
  auth.js      scrypt, sessions, CSRF, login throttle, WS origin check
  metrics.js   1s collector loop into in-memory ring buffers
  sensors.js   hwmon / thermal_zone discovery, smartctl
  dockerx.js   container list + control, CasaOS label reading
  files.js     path-jailed file operations
  terminal.js  PTY sessions
  routes.js    the REST surface
web/           the UI — plain JS, no build step
assets/brand/  pixel art, generated with PixelLab
```

### Two deliberate engineering choices

**Metrics history lives in memory, not on disk.** Writing a row per metric per
second to a database on an SD card or consumer SSD is a good way to kill a
homelab disk. Fixed-size ring buffers hold 15 minutes at 1-second resolution,
which covers every chart the dashboard draws.

**The terminal uses `script`, not `node-pty`.** node-pty is a native addon, so
installing it needs Python and a C++ toolchain on the target box. Instead Nexus
runs `script -qfc $SHELL /dev/null`, which allocates a real pty using a
util-linux tool present on every Ubuntu install. The trade-off is that window
resize is best-effort rather than a true `SIGWINCH`.

## Design

The visual language — palette, type, bevel geometry, the rule that charts are
drawn deliberately un-smooth — is documented in
[`docs/DESIGN.md`](docs/DESIGN.md).

Short version: violet-anchored dark theme (the CRT), a light theme that is a
beige workstation rather than an inversion, Silkscreen and Pixelify Sans for
type, a 4px base unit, no border radius anywhere, and no anti-aliasing on
decoration. Status colours (green/amber/red) are reserved for meaning and never
used decoratively — that is what keeps a red border on a widget informative.

## Licence

MIT.
