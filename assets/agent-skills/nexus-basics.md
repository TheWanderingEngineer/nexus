---
name: Nexus itself
description: What the dashboard around you is, where its files live, and how the owner uses it
mode: always
tags: core, nexus
---

**Nexus** is the dashboard you are inside. Node.js, no build step, runs as a
systemd service as root on one Linux host. The owner keeps it open as the
control surface for the whole machine.

## Where things are

| | |
|---|---|
| Installed app | `/opt/nexus` |
| Config | `/etc/nexus/config.json` |
| State, layouts, audit log | `/var/lib/nexus` |
| Your skills | `/var/lib/nexus/agent-skills` |
| Apps Nexus installed | `/var/lib/nexus/apps/<slug>/docker-compose.yml` |
| Service | `systemctl status nexus` · restart with `systemctl restart nexus` |
| Default port | 8080 (80 is often CasaOS) |

Source checkout is separate; upgrading is `git pull && sudo bash
scripts/install.sh` from it, which rsyncs to `/opt/nexus` and restarts.

## What the owner does with it

- **Dashboard** — draggable widgets: CPU, memory, storage, network, sensors,
  containers, top processes, disk activity, security watch, and a Server Cat
  whose mood is driven by real readings. Charts read out exact values on hover.
- **App Store** — installs docker-compose apps from library repos (the CasaOS
  store is added by default) or straight from a GitHub URL. Everything it
  installs is labelled `io.nexus.managed=true`.
- **Containers** — start, stop, restart, remove; reads `io.casaos.*` labels so
  CasaOS-installed apps show up too.
- **Files** — a path-jailed browser over configured roots, with upload,
  copy/move and a text editor.
- **Terminal** — a real root PTY in the browser.
- **Control panel** — watch rules, scheduled tasks, webhooks, power.

## Rules that apply to you

- **Containers installed through Nexus** live in `/var/lib/nexus/apps/<slug>/`.
  Change one by editing its compose file and running `docker compose up -d` in
  that directory — not by `docker run`, which Nexus will not know about.
- **Do not edit `/opt/nexus` directly.** It is overwritten on every upgrade.
  Changes belong in the source checkout.
- **`/etc/nexus/config.json` decides the file roots and the terminal switch.**
  Editing it needs `systemctl restart nexus` to take effect, which will drop the
  owner's session — say so before you do it.
- Your own actions are written to the audit log the owner reads on the Settings
  page. Assume everything you do is visible.
