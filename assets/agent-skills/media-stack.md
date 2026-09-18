---
name: The media stack
description: Jellyfin, Jellyseerr, Radarr, Sonarr, Prowlarr, qBittorrent and Kaizoku — how they fit together and how to fix them
mode: ondemand
---

The usual self-hosted media chain, and the order things flow in:

**Prowlarr** (indexer manager) → **Radarr** / **Sonarr** (want lists, quality,
renaming) → **qBittorrent** (or an NZB client) → back to Radarr/Sonarr to import
and rename → **Jellyfin** (library and playback) ← **Jellyseerr** (requests).
**Kaizoku** does the same job for manga.

## What each one is

| App | Does | Default port |
|---|---|---|
| **Jellyfin** | Media server: library, metadata, transcoding, clients. FOSS, no licence | 8096 |
| **Jellyseerr** | Request front end for Jellyfin; forwards approved requests to Radarr/Sonarr | 5055 |
| **Radarr** | Films: watchlist, search, quality profiles, import and rename | 7878 |
| **Sonarr** | TV: the same, per series and episode | 8989 |
| **Prowlarr** | One place to define indexers, syncs them into Radarr/Sonarr | 9696 |
| **qBittorrent** | Torrent client with a Web UI | 8080 (clashes with Nexus — remap it) |
| **Kaizoku** | Manga downloads, built on Mihon/Tachiyomi sources | 3000 |
| **Bazarr** | Subtitles for what Radarr/Sonarr manage | 6767 |

## How they are wired

- Prowlarr holds the indexers. In Prowlarr, add Radarr and Sonarr under
  *Settings → Apps*; it pushes indexers to them. Do not add indexers to Radarr
  and Sonarr by hand as well — you get duplicate searches and confused stats.
- Radarr/Sonarr talk to qBittorrent under *Settings → Download Clients*. Use the
  container name as the host (`qbittorrent`) when they share a Docker network,
  not `localhost` — inside a container, `localhost` is that container.
- Jellyseerr needs the Jellyfin URL plus Radarr/Sonarr API keys. API keys are in
  each app under *Settings → General*.
- Jellyfin only reads the finished library folder. It should never see the
  downloads folder.

## The one thing that breaks every install: paths

Every container must see **the same paths as every other one**. The classic
mistake is mapping `/downloads` in qBittorrent and `/data/downloads` in Sonarr:
the import then does a slow copy across what the filesystem thinks are two
devices, and hardlinks are impossible, so you keep two copies of everything and
seeding breaks on move.

The layout that works — one mount, one tree:

```
/DATA/media/            ->  mounted as /data in every container
  torrents/
    movies/  tv/  manga/
  media/
    movies/  tv/  music/  manga/
```

- qBittorrent: `/DATA/media:/data`, save path `/data/torrents/...`
- Radarr/Sonarr: `/DATA/media:/data`, root folder `/data/media/movies` (or `/tv`)
- Jellyfin: `/DATA/media/media:/media` (read-only is fine)

That gives instant atomic moves and working hardlinks, so a file can be seeded
and in the library at once without a second copy. In Radarr/Sonarr,
*Settings → Media Management → Use Hardlinks instead of Copy* must be on.

## Permissions

All of these images use `PUID`/`PGID`. Pick one uid/gid — commonly `1000:1000` —
set it identically on every container, and make it own the tree:

```bash
chown -R 1000:1000 /DATA/media
chmod -R 775 /DATA/media
```

`UMASK=002` on the *arr containers keeps group-writable permissions on new files.

## Diagnosing

- **"No results" on a search** → Prowlarr first: *Indexers → Test All*. Dead or
  rate-limited indexer, or an expired API key.
- **Grabbed but never imports** → path mismatch (above), or permissions. Sonarr
  *Activity → Queue* usually states the reason outright.
- **Imported but Jellyfin does not show it** → scan the library; then check
  naming matches Jellyfin's expectations (`Show (2011)/Season 01/Show - S01E01 - Title.ext`).
- **Playback buffers or pins the CPU** → it is transcoding. Check the Jellyfin
  dashboard's active streams: it names the reason (codec, container, subtitle
  burn-in). Enable hardware acceleration (VAAPI on Intel, `/dev/dri` passed
  through), or fix the client so it can direct-play.
- **Subtitle burn-in** forces a transcode. It is very often the real cause.

## Rules

- These apps handle copyrighted material. Configuration and troubleshooting is
  the job; sourcing content is the owner's business, not yours.
- Never delete from the library to "clean up". Ask.
- A VPN container (gluetun and friends) in front of the torrent client is a
  common pattern; if one is present, the client uses `network_mode:
  service:gluetun` and has no ports of its own — its Web UI is published by the
  VPN container instead. Check that before "fixing" a missing port.
