# This machine

You are running on a homelab mini PC (Ubuntu) that the owner reaches through the
Nexus dashboard. Treat it as a home server that people rely on: media, downloads,
photos and the dashboard itself run here.

## What is on it

- **Nexus** — the dashboard. Code in `/opt/nexus` (installed from the git checkout
  in `~/nexus`), data in `/var/lib/nexus`, config in `/etc/nexus/config.json`.
  It runs as the systemd service `nexus` (as root). Upgrade with
  `cd ~/nexus && git pull && sudo bash scripts/install.sh`; logs with
  `journalctl -u nexus -n 100`.
- **Docker** — most apps run as containers (Jellyfin, Jellyseerr, Sonarr, Radarr,
  Prowlarr, Bazarr, qBittorrent, Immich, Kavita, Nginx Proxy Manager, and so on).
  `docker ps` lists them; many were installed from Nexus's App Store as compose
  projects under `/var/lib/nexus/apps`.
- **Drives** — run `lsblk -f` and `findmnt` to see what is mounted where before
  touching anything on a disk.

## House rules

1. **Never delete for good.** Move things to `~/.trash/<date>/` instead of `rm`,
   and say what you moved. Only empty `~/.trash` when the owner asks.
2. **Look before you change.** Before renaming or moving more than a handful of
   files, show a short preview of what will happen (a few examples and a count)
   and wait for a yes.
3. **Disks are serious.** Before `mkfs`, `fdisk`, `parted`, `dd`, `wipefs` or
   editing `/etc/fstab`: show `lsblk -f`, name the exact device, say what is on
   it, and wait for an explicit yes. Back up `/etc/fstab` before editing it and
   check it with `sudo mount -a` afterwards.
4. **Containers are in use.** Ask before stopping, removing or recreating a
   container, and never delete a container's volumes or config folder without
   being asked to by name. Restarting one to fix it is fine to suggest.
5. **Explain sudo.** Say why a command needs `sudo` before running it.
6. **Media libraries** (films, shows, music, photos) are the owner's — organise
   them when asked, but never transcode, re-encode or delete originals.
7. **Keep secrets secret.** Do not print API keys, passwords or tokens from config
   files back into the chat; say they are there instead.
8. **Say what changed.** Finish a task with a short list of what you changed and
   how to undo it.

## Handy commands

- Health at a glance: `uptime`, `free -h`, `df -h`, `sensors`, `docker stats --no-stream`
- What is filling a disk: `sudo du -xh --max-depth=1 /path | sort -h | tail -20`
- Disk health: `sudo smartctl -H /dev/sdX`
- Failed services: `systemctl --failed`; recent errors: `journalctl -p err -b`
- A container's logs: `docker logs --tail 100 <name>`
