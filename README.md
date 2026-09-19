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
  "trustedProxies": [],          // proxy addresses to believe: "172.18.0.0/16", "192.168.1.5", "192.168." or "localhost"
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
| Command safety | No shell interpolation anywhere. SMART device names come from the kernel's own enumeration, never from the client. The one place a command is run verbatim is the agent's shell tool, where the command *is* the request — off by default, and gated on your approval |
| Audit log | Shell sessions, container actions, file deletions, logins, and every tool the agent runs |
| Agent capabilities | All off by default, each one a separate switch; its API key lives in a 0600 file and is never returned to a browser |
| Terminal kill switch | `terminal.enabled: false`, no redeploy needed |

**Do not expose this to the internet as-is.** Keep it on your LAN, or reach it
over Tailscale/WireGuard. If you must publish it, put it behind a reverse proxy
with TLS and an auth layer in front, set `trustedProxies`, and turn the terminal
off.

## Reaching it from outside (DuckDNS, Nginx Proxy Manager)

Nexus behind a reverse proxy is the normal way to reach it from off the LAN, and
it is where the live dashboard quietly stops working. **nginx does not forward a
WebSocket upgrade unless you tell it to, and Nginx Proxy Manager ships that
switch off.** Without it the page loads, you log in, and every reading sits at
zero.

Two things to set:

**1. Websockets Support.** In Nginx Proxy Manager, open the proxy host →
**Details** → turn on **Websockets Support**. In plain nginx, the location needs:

```nginx
proxy_set_header Upgrade    $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host       $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_read_timeout 3600s;          # the terminal is a long-lived socket
```

**2. `trustedProxies`.** Add the address Nexus sees the proxy arriving from:

```jsonc
{ "trustedProxies": ["172.18.0.0/16"] }      // or whatever your proxy's address is
```

A CIDR block, a single address, a dotted prefix (`192.168.`) or `localhost`.
Find the address Nexus actually sees with
`journalctl -u nexus | grep '\[ws\]'`, or from the **proxy** field the dashboard
banner prints.

This does two jobs: it lets Nexus believe `X-Forwarded-Proto` and mark your
session cookie `Secure`, and it lets the WebSocket origin check accept
`X-Forwarded-Host` — needed if your proxy rewrites `Host` to the upstream
address. Without it, an audit-log entry also records the proxy's address rather
than yours.

If your proxy passes the original `Host` through (the NPM default), Nexus works
without `allowedOrigins`. If it does not, add the address you type in the browser:

```jsonc
{ "allowedOrigins": ["https://nexus.yourname.duckdns.org"] }
```

`sudo systemctl restart nexus` after either change.

### If something is still wrong

**The dashboard tells you.** When the metrics socket cannot be opened, Nexus
falls back to polling over plain HTTP — so the readings keep working, a few
seconds behind instead of every second — and shows a banner naming the actual
cause: an origin the check refused (with the exact JSON to paste), or an upgrade
that never arrived at all. The status pill reads **POLLING** rather than
claiming LIVE.

The terminal genuinely needs the WebSocket and says so instead of hanging. The
Nexus Expert works either way; it talks over ordinary HTTP.

Server-side, a refused upgrade is logged with its reason and the exact config
line to add — `journalctl -u nexus | grep '\[ws\]'`.

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

## Nexus Expert

A robot sits in the corner of every page. Click it and you get Hermes: a language
model with tools pointed at this machine, in a panel that stays out of the way.
Its replies are rendered — headings, **bold**, lists, tables and fenced code — so
a `docker ps` table arrives as a table instead of a wall of pipes.

**It starts with nothing.** On a fresh install Hermes can read the metrics you
can already see on the dashboard, and that is all. Every other capability is a
switch in **Settings → Nexus Expert**, off until you turn it on:

| Capability | What it hands over |
|---|---|
| Read the machine's readings | CPU, memory, disks, sensors, uptime, top processes |
| Read files | Only inside the folders you tick, inside the file manager's existing path jail |
| Create, change and delete files | The same folders. Deletions are recursive and permanent |
| List and control containers | Start, stop, restart |
| Run shell commands as root | Install packages, edit services, change anything |

The last one is the whole machine, and the page says so where the switch is. It
is what makes "install Jellyfin and point it at /DATA/media" a sentence you can
type, and it is the reason the other rails exist.

**Before it acts**, Hermes is on *ask me first*: every write and every command
stops and shows you exactly what it is about to do, with ALLOW and DENY. Switch
to **full access** and it stops asking. That is offered because it is your
machine — with one thing worth knowing first: everything Hermes reads, including
file contents and command output, comes back into its context, and text in a file
can be written to look like an instruction. Ask-me-first is what stands between
that and an action.

If you ignore the approval and ask something else instead, that is taken as a
no: the waiting action is closed off, Hermes is told it was not run, and the
conversation carries on. Nothing is left half-answered — a tool call with no
result in the history is a conversation every provider refuses from then on.

Every tool call it makes lands in the audit log on the Settings page, whichever
mode you are in.

### What it already knows

Hermes does not have to go looking for the machine it is running on. Every
message you send carries a **Right now** block: hostname, OS, kernel, uptime,
CPU and memory load, every filesystem with its usage, the containers and their
states, and the folders shared with it. It respects the capability switches — no
container list without the Docker capability — and it is stamped with the moment
it was taken, because after Hermes restarts something the block describes the
past. Readings that have not been taken yet say so rather than going quiet.

### Skills

**Settings → Nexus Expert → Skills** is a library of Markdown files. Drag `.md`
files in, switch them on and off, or delete them for good. Each one is either:

- **Memory** — pasted into every message. Who Hermes is, what this machine is,
  what Nexus is. You pay for it every turn, so there is a budget bar and the page
  tells you when you are over it.
- **On demand** — only its name and one-line description cost anything. Hermes
  loads the body himself when a question lands in its territory.

Nexus ships eight to start with: **Who you are**, **This machine** and **Nexus
itself** as memory; **Docker on this box**, **Ubuntu Server administration**,
**The media stack** (Jellyfin, Jellyseerr, Radarr, Sonarr, Prowlarr,
qBittorrent, Kaizoku — and the path layout that makes hardlinks work), **Remote
access** (Nginx Proxy Manager, DuckDNS, ports, certificates) and **Homelab
practice** on demand.

Skills carry **tags** — search the library, or filter it down to `docker`,
`media`, `networking`. Tags are a line in the file's front matter, so they travel
with it.

The editor opens on **PREVIEW** — rendered, the way Hermes will be handed it —
with **WRITE** next to it for the source.

They are ordinary files in `/var/lib/nexus/agent-skills`, so you can edit them in
the browser, drop your own in, or copy one to another machine. **RESTORE
DEFAULTS** brings back anything stock you deleted without touching your edits.

### Advanced

**Scheduled tasks** run a prompt on a timer — a morning check, a weekly tidy-up.
Pick the time and the days, write the instruction, and RUN NOW to try it. They
obey the approval setting: on *ask me first* a task that wants to write a file or
run a command will stop and wait with nobody there to answer, and it records that
it was waiting rather than pretending it finished.

Also here: whether the live briefing is sent at all, and how many tool calls one
message may make before Hermes stops and asks you to say "carry on".

### Provider, model and what it costs

Anthropic, DeepSeek, Google Gemini, OpenAI, or anything that speaks the
OpenAI chat-completions shape — which includes Ollama, llama.cpp, vLLM and
LM Studio, so the model can run on this box and never send your files anywhere.

Each provider offers three models, strongest to cheapest, with a per-million-token
price and the date that price was checked. They are a guide, not a quote, and each
one links to the provider's own pricing page. There is a free-text box for a model
id of your own, because this list will age.

**TEST** next to the key does a one-token round trip with no tools attached and
reports what came back, how long it took, and what it cost. It separates the
three things a failure usually conflates: a bad key, a model id this provider
does not know, and a box that cannot reach the internet at all.

Your API key is stored on the server in a file only root can read, is never
returned to a browser, and never appears in the audit log. Token usage — in, out,
and an estimated cost — is on the panel footer for the conversation and on the
settings page for everything since you last reset it. A model with no published
rate here reports its tokens and says **no rate** rather than claiming $0.00.

## The dashboard

Widgets float where you drop them — gravity only applies when you press RESET.

| Gesture | Effect |
|---|---|
| Drag a widget's title bar | Moves it. The body is not a handle — so the things inside it stay usable |
| Right-click a widget | Its own settings: size, colour, background tint, plus per-type options |
| Ctrl/⌘ + click | Add or remove a widget from the selection |
| Ctrl/⌘ + A | Select every widget, including any below the fold |
| Drag a selected widget | Moves the whole selection, keeping its internal spacing. A selected widget moves from anywhere on it, not just its title bar |
| Right-click a selection | Only the settings they all share; per-type options appear when the types match |
| Delete / Backspace | Remove the selection |
| Escape | Clear it |

**TIDY** packs every widget top-left with no gaps, keeping the order you already
have. **PRESETS** saves the whole arrangement under a name — one layout for
watching the media stack, another for chasing a disk problem — and switches
between them.

**Storage** and **Sensors** carry a tick list in their right-click menu, so you can
drop `/boot/efi` from the disk list or hide the four hwmon channels that only ever
report 0 V. The list stores what is *hidden*, not what is shown — a drive you plug
in next month appears on its own rather than being silently excluded.

### The widgets

CPU, Memory, Storage, Network, Sensors, Containers, Uptime, Clock, Last Boot,
Host, Server Cat — plus four that answer more specific questions:

| Widget | The question it answers |
|---|---|
| **CPU Cores** | Is that 50% every core at half, or one core pinned? The aggregate number cannot tell you, and the answer changes what you do next. |
| **Top Processes** | What is actually using the machine. Sort by CPU or by memory — two separate lists, not one re-sorted. |
| **Disk Activity** | Read and write throughput, mirrored around a centre line. Linux only; `fsStats` reads `/proc/diskstats`. |
| **Security Watch** | Failed logins, what is listening on all interfaces, pending security updates, who is logged in. |

### Containers

A card each: name, state, what it is actually saying (`Up 3 days (healthy)`,
`Exited (137) 2 hours ago`), and its published ports as buttons you can press.
Search and filter by running or stopped. **MANAGE** opens one container on its
own with live CPU and memory, a tailing log, and the destructive action kept
away from the buttons you press every day.

### Reading a chart

Hover any chart — CPU, Network, Disk Activity — and a crosshair reads the sample
under the pointer: the exact value and the clock time it was taken, down to the
second. The line snaps to a sample rather than following the cursor, because
between two samples there is no reading to give; the dot sits on the point being
quoted, so there is never a question of which one the number belongs to. Disk
Activity reads both halves at once, since "what was the disk doing at 14:31:08"
is one question and not two. Leave the pointer where it is and the readout keeps
up with the machine instead of freezing at whatever it said when you arrived.

Mouse and pen only. A finger has no hover, and the chart sits inside a widget
body that a long press picks up to drag.

**Server Cat** is a mood ring for the machine. Four moods — sleepy, content,
alert, grumpy — each driven by real readings (CPU, temperature, memory, disk,
whether a container has fallen over), each with its own two-frame sprite
animation whose tempo *is* the information: a fast lashing tail means a busy
box. Click to pet, and keep clicking to find out how the cat feels about that.
Right-click to rename them and to choose whether they are a he, a she or a they;
every line of dialogue substitutes the name and pronouns at display time, so
nothing is hardcoded. The art was generated with PixelLab.

### Moving widgets

Dragging is non-destructive. Every frame of a drag is computed from the layout
as it was when you picked the widget up, never from the previous frame — so
wandering across the canvas and coming back leaves the arrangement exactly as
it was, and **Escape** abandons a drag and puts everything back.

While dragging, an outline shows where the widget would land. **Accent** means
the space is free and nothing else will move; **amber** means the drop will push
other widgets aside. You can see which before you let go.

**Security Watch** is a posture summary, not an intrusion detection system, and
it does not pretend otherwise. It reads failed SSH attempts from the journal,
failed Nexus logins from the audit log, listening sockets from `ss`, and pending
updates from `apt-check`. Every check that cannot run reports **`?`**, never a
zero — a check that quietly says "all clear" when it failed to look is worse
than no check at all, because it buys confidence it has not earned.

There is no score out of 100. A single number invites you to chase it and tells
you nothing about what to do; the widget lists specific findings with a severity
each, and the widget's title bar picks up the colour of the worst one.

### On a phone or a tablet

The gear in each widget's header opens the same settings menu, because touch has
no right-click. On phones it opens as a bottom sheet rather than a menu pinned to
a fingertip.

**Hold a widget to pick it up** — anywhere on it, not just the title bar, since
a finger has no hover to protect and no cursor to mislead. A press that moves is
a scroll; a press that stays still for a moment becomes a drag, with a short buzz
to say so. Below 640px the canvas becomes a single column and dragging reorders
the list.

That phone order is stored separately from the desktop x/y, so rearranging on
your phone does not flatten the layout you built on a real screen. The two are
allowed to differ; until you drag something on a phone, the phone order simply
follows the desktop reading order.

Layout, hit targets and reading size are decided independently — by width, by
whether a finger is driving, and by how large the display is. That is why a
1024px iPad gets desktop layout with touch-sized controls, and a 1080p TV gets
desktop layout at a size you can read from a sofa.

## Apps

The dashboard watches the machine. **Apps** is the other half: a launcher for the
things running *on* it — Jellyfin, Sonarr, Nginx Proxy Manager, whatever you have
— as tiles you click to open.

Each tile carries a name, an icon, a description, the ports it publishes, tags,
and two addresses:

- **Local** — `http://192.168.1.50:8096`, the one that works on your own network.
- **External** — your DuckDNS hostname, for when you are not on it.

Both are optional and Nexus keeps them apart rather than guessing. A tile with
both shows a small globe button; clicking the tile itself always takes the local
route, because that is the one you want nine times out of ten. Only `http` and
`https` addresses are stored — anything else is rejected by the server, not just
by the form.

**Icons pull themselves.** Type "jellyfin" and the icon appears, from the same
[dashboard-icons](https://github.com/homarr-labs/dashboard-icons) set Homarr
uses, matched on the name with an alias table for the ones that do not match
cleanly (`npm` → Nginx Proxy Manager, `qbit` → qBittorrent). You can paste an
image URL instead. If the icon cannot be fetched — no internet, a name nothing
matches — the tile falls back to a lettered square rather than a broken-image
glyph, so a box with no outbound access still gets a usable launcher.

### Arranging it

**Groups** are titled bands: one for watching, one for grabbing, one for the
things you keep an eye on. **+ GROUP** makes one, and dragging a tile onto a
band moves it there. A group has a colour, which marks the band and nothing else
— it does not recolour your apps.

**Pinned** apps sit in their own band at the top, above a dividing rule, with a
pin mark on the tile. Nothing pinned means no band and no rule: a divider with
nothing above it is a line for its own sake.

**Tags** are how you find things once there are thirty of them. Add them in Edit
App, and each one becomes a filter chip above the board — click to narrow, click
again to clear. A tag's colour is derived from the tag itself, so `media` is the
same colour on every tile and on its chip. Search matches names, descriptions,
ports and tags.

| Gesture | Effect |
|---|---|
| Click a tile | Opens the app |
| Drag a tile | Moves it — within its band to reorder, onto another band to regroup |
| Ctrl/⌘ + click | Add or remove a tile from the selection |
| Drag over empty space | Marquee-select everything the box touches |
| Ctrl/⌘ + A | Select everything currently shown |
| Delete / Escape | Remove the selection / clear it |
| Hold a tile (touch) | Picks it up — a finger has no hover, so a still press is the signal |

With something selected, a bar offers the bulk actions: move to a group, change
size, pin, remove.

**Four tile sizes**, not free resizing. Small is an icon and a name; medium adds
the description and ports; large and huge are twice the height for the two or
three you actually look at. A board of arbitrary rectangles is the mess this is
meant to avoid.

### The same board on a phone

Tiles are an ordered list with a size, not boxes at coordinates. That is a
deliberate choice and it is what makes the board survive the trip: the desktop
shows six columns, an iPad three, a phone one, and the order, the groups and the
relative sizes are the same on all of them. Nothing to rearrange twice, and no
arrangement to lose.

### A PIN on a tile

Any app can be given a four-digit PIN in Edit App; the tile then shows a lock and
asks for the digits before it opens.

What it does, said plainly: it keeps that app off the board and **its address out
of the page** for whoever is looking at Nexus over your shoulder. The PIN is
stored as a scrypt hash, is never returned by any endpoint, and the server
withholds the app's addresses until the digits are given — so "view source" does
not defeat it and neither does the API. Guesses are counted and throttled.

What it is not: access control on the app itself. That app has its own login, and
anyone who knows its address can still type it into a browser. It is a screen, a
good one, and it is described as one.

### PULL ALL

Reads the containers that are actually running and proposes the ones that are not
on the board yet, with a tick box each. It is additive by construction: a
container is skipped if its name or any of its published ports already appears on
a tile, so running it a second time after you have renamed, tagged and arranged
everything adds only what is new and leaves your work alone. It proposes; you
choose; nothing is written until you press ADD.

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
npm run agent:check  # the agent: providers, capabilities, jails, skills, crons
npm run proxy:check  # the four reverse-proxy shapes
npm run dash:check   # the widget canvas, in a real browser
npm run apps:check   # the Apps launcher, in a real browser
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

## Working on it

[`docs/HACKING.md`](docs/HACKING.md) is the developer guide: the module map, the
invariants that are load-bearing, how to add a widget (and exactly what the
server will persist of its settings), how dragging stays non-destructive, how
the responsive rules are split, and how to verify a change without touching your
real instance. Read it before adding anything.

## Design

The visual language — palette, type, bevel geometry, the rule that charts are
drawn deliberately un-smooth — is documented in
[`docs/DESIGN.md`](docs/DESIGN.md).

Short version: violet-anchored dark theme (the CRT), a light theme that is a
beige workstation rather than an inversion, Silkscreen and Pixelify Sans for
type, a 4px base unit, no border radius anywhere, and no anti-aliasing on
decoration. Every window closes one way — the **×** in its top-right corner —
so there is never a second CLOSE button at the bottom competing with the buttons
that actually do something. Status colours (green/amber/red) are reserved for meaning and never
used decoratively — that is what keeps a red border on a widget informative.

## Licence

MIT.
