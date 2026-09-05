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

## Development

```bash
npm install
npm run dev      # auto-restarts on change
npm run check    # end-to-end self test — 21 assertions
```

`npm run check` boots a real server on a scratch port and exercises the auth
flow, CSRF enforcement, the path jail and the WebSocket origin check. It runs on
Windows and macOS too, where hardware sensors report as simulated.

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
