---
name: Homelab practice
description: Storage layout, backups, hardware transcoding, resource limits and the habits that keep a mini server alive
mode: ondemand
tags: homelab, storage, backups
---

## Storage

Keep the OS disk and the data disk separate, and keep one data tree that every
container sees at the same path. A single mount with subfolders beats six
bind mounts pointing at unrelated places — it makes atomic moves and hardlinks
possible, and those are what stop a media stack keeping two copies of everything.

Mount data disks by UUID in `/etc/fstab` with `nofail`, so a disk that fails to
appear does not stop the machine booting. Test with `mount -a` before rebooting;
this box has no monitor attached.

Watch free space. Most "mysterious" homelab failures are a full disk:

```bash
df -h ; du -xh --max-depth=1 /var | sort -h
docker system df
journalctl --disk-usage
```

## Backups

What actually matters on a box like this:

1. **Config**, not media. `/etc/nexus/config.json`, `/var/lib/nexus`, each app's
   compose file and its config volume. Media is re-downloadable; a Radarr
   database with five years of history is not.
2. **Off the machine.** A copy on the same disk is not a backup.
3. **Tested.** An untested backup is a hope.

Stop a container before copying a database out of it (SQLite mid-write copies
corrupt), or use the app's own export.

## Permissions

Pick one uid/gid for everything that shares files — usually `1000:1000` — and set
`PUID`/`PGID` identically on every container. Mixed ownership across a shared
tree is the single most common cause of "it downloaded but never imported".

`ls -ln` shows numeric ids, which is what the container actually sees. `ls -l`
shows names from *this* host's `/etc/passwd`, which the container does not have.

## Hardware transcoding

On an Intel mini PC, Quick Sync makes transcoding nearly free. Pass the render
device through:

```yaml
devices:
  - /dev/dri:/dev/dri
group_add:
  - "<gid of the render group>"
```

`getent group render` for the gid. Then enable VAAPI in Jellyfin's playback
settings. Verify it is working from the Jellyfin dashboard while a stream is
running — it says whether the transcode is hardware or software.

## Resource limits

One runaway container should not take the box down:

```yaml
deploy:
  resources:
    limits:
      memory: 2g
restart: unless-stopped
```

`restart: unless-stopped` is right for services; `always` will also restart them
after the owner deliberately stops one.

## Habits worth keeping

- **Pin image tags.** `:latest` means the app can change under you overnight.
- **One change at a time**, then verify. Three changes and a failure tells you
  nothing.
- **Keep compose files in one place** and, ideally, in git. They are the machine.
- **Label things.** Six months later `docker ps` should be self-explanatory.
- **Check `systemctl list-units --failed` and `df -h` first** whenever something
  is vaguely wrong. It is one of those two more often than it has any right to be.
- **Read the logs before restarting.** A restart erases the evidence and usually
  fixes nothing.
