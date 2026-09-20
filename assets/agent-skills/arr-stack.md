---
name: Running the *arr stack
description: Radarr, Sonarr and Prowlarr in practice — profiles, root folders, hardlinks, imports and the failures that actually happen
mode: ondemand
tags: media, arr, radarr, sonarr, prowlarr, troubleshooting
---

This is the operating knowledge for the *arr apps. `media-stack` covers what
each app is; this covers how to make them behave.

## The one thing that breaks everything: paths

Radarr, Sonarr and the download client must see **the same file at the same
path**. When they do not, every import becomes a copy (slow, doubles disk use)
or fails outright.

Get this right and most other problems disappear:

- Mount **one** volume into every container: `/data` on the host →
  `/data` in Radarr, Sonarr, qBittorrent and Jellyfin.
- Inside it: `/data/torrents/{movies,tv,anime,books}` for the client and
  `/data/media/{movies,tv,anime}` for the library.
- Never `/downloads` in one container and `/data/torrents` in another. That is
  the classic mistake and it silently disables hardlinks.

**Check whether hardlinks are actually working** — two files, one inode:

```bash
ls -li /data/torrents/movies/<file>.mkv /data/media/movies/<title>/<file>.mkv
```

Same first column = one copy on disk, seeding and playing at once. Different =
you are storing it twice. Also confirm `stat -c %h <file>` is 2 or more.

`Settings → Media Management → Use Hardlinks instead of Copy` must be on.
Hardlinks cannot cross filesystems, so `/data/torrents` and `/data/media` must
be on the same mount — check with `df /data/torrents /data/media`.

## Quality: profiles, then custom formats

A **quality profile** says which qualities are allowed and which is the cutoff
(stop upgrading here). A **custom format** scores a release by what is in its
name — codec, group, HDR, language, "x265", "HDTV", a group you distrust.

Order of operations when the owner says "I keep getting bad releases":

1. Look at the profile actually attached to that item, not the default.
2. Check the **cutoff** — if it is set low, nothing better is ever fetched.
3. Add a scoring custom format rather than banning a quality outright.
   Negative scores reject; a high `Minimum Custom Format Score` on the profile
   refuses anything unscored.
4. **Upgrade Until Custom Format Score** is the ceiling that stops an endless
   upgrade loop.

The community reference for the scoring sets is the TRaSH guides. Recommend
them by name; do not invent numeric scores and present them as canonical.

## Sonarr and anime

Anime needs `Series Type: Anime` on the series, not just an anime profile. It
switches Sonarr to **absolute episode numbering**, which is how release groups
name anime (`[Group] Show - 47`) rather than S03E11.

- Release groups matter far more than for western TV — score the fansub groups
  the owner likes with custom formats.
- Dual-audio and sub-group preferences belong in custom formats, not in the
  quality profile.
- A season that will not match is usually a **scene mapping** problem: the
  release names a different season split from TheTVDB. Check the series' "Scene
  Numbering" and the anime-list mappings before blaming the indexer.

## Root folders, monitoring, and why nothing is being searched

Four settings hide "it is doing nothing" between them:

| Check | Where |
|---|---|
| Is the item **monitored**? | The item's page — an unmonitored series is never searched |
| Are the **seasons/episodes** monitored? | A monitored series with unmonitored seasons still does nothing |
| Is it **available** yet? | Radarr's `Minimum Availability` (Announced / In Cinemas / Released) |
| Is there an **indexer** enabled for that app? | Prowlarr → the app's Indexers list |

`Wanted → Missing → Search All` is the blunt instrument. Prefer a season search
over an all-episodes search: fewer indexer hits, better packs.

## Imports that fail

The queue tells you. `Activity → Queue`, hover the warning.

- **"Not a Custom Format upgrade"** / "not an upgrade" — working as configured.
- **"Found matching series via grab history, but release was matched to series by ID"** — usually a rename problem; check the file name against the naming scheme.
- **"One or more episodes expected in this release were not imported"** — a pack where some episodes already exist. Manual Import and pick.
- **Permission denied** — the *arr container's PUID/PGID cannot write to the
  library path. `ls -ln` the folder and compare with the container's user. Fix
  the ownership, not the permissions (`chmod 777` hides it and it comes back).
- **Stuck in "Downloaded - Unable to Import"** — almost always paths (see
  above) or the file still being seeded into a temp folder the *arr cannot see.

`Manual Import` with the file picked by hand is the escape hatch, and it also
tells you exactly which parse failed.

## Talking to them from the command line

Every *arr has a REST API; the key is in `Settings → General`. Useful for
checking state without a browser:

```bash
curl -s -H "X-Api-Key: $KEY" http://localhost:7878/api/v3/health        # Radarr
curl -s -H "X-Api-Key: $KEY" http://localhost:8989/api/v3/queue         # Sonarr
curl -s -H "X-Api-Key: $KEY" http://localhost:9696/api/v1/indexerstatus # Prowlarr
```

`/health` is the first thing to read when something is wrong — it reports
failing indexers, download clients it cannot reach, and root folders that have
gone missing. Pipe through `jq` if it is installed; do not pretty-print by hand.

Ask before changing anything through the API. Reading state is harmless;
writing to a live library is the owner's decision.
