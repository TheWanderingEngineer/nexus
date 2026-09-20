---
name: Requesting media
description: How to ask for films, series, anime, manga, books and audiobooks efficiently — Jellyseerr, Kaizoku and what fills the gaps
mode: ondemand
tags: media, jellyseerr, kaizoku, anime, manga, books
---

The owner's question is usually "how do I get this thing" — not "which app
owns it". Start from the kind of thing and work back to the app.

| They want | Ask through | Which lands in |
|---|---|---|
| Film | Jellyseerr (5055) | Radarr → qBittorrent → Jellyfin |
| Series | Jellyseerr | Sonarr |
| Anime | Jellyseerr, but the series must be `Series Type: Anime` in Sonarr | Sonarr (anime profile) |
| Manga | Kaizoku (3000) | its own library folder |
| Books / comics | No *arr owns this any more — see below | |
| Audiobooks | Audiobookshelf as the server; acquisition is manual or via a separate grabber | |

## Jellyseerr, used well

- **Request the season, not the series**, when the owner only wants the current
  one. A whole-series request on a 12-season show fills the disk and hammers
  every indexer.
- **Auto-approve** for the owner's own account, manual approval for anyone else
  they share with. `Settings → Users → Permissions`.
- Jellyseerr does not download anything itself. If a request sits at "Pending",
  the question is Jellyseerr's; if it says "Processing" and nothing arrives, the
  question is Radarr's or Sonarr's queue.
- **4K goes to a separate instance.** Jellyseerr can point at a second
  Radarr/Sonarr with its own root folder and profile. Mixing 4K and 1080p in one
  instance means one of them is always wrong.
- A request that vanishes usually failed the *arr's `Minimum Availability` —
  the film is announced but not released, so nothing is searched yet. That is
  correct behaviour, not a fault.

## Anime, specifically

Anime is the one that goes wrong quietly.

- Set the series to **Anime** in Sonarr before requesting, or the absolute
  numbering will not match and every release is rejected.
- Decide **subs or dub** in a custom format, once, rather than per release.
- Seasonal splits differ between TheTVDB (what Sonarr uses) and how groups name
  releases. When a cour will not match, check scene/absolute numbering before
  touching the indexers.
- Batch releases arrive as one large pack; they import as a season, so expect
  the queue to sit at 100% for a while doing the import.

## Manga, with Kaizoku

Kaizoku tracks manga series and pulls chapters on a schedule.

- Add by source, let it index, then let the scheduled job do the fetching; a
  manual "download all" on a 1,000-chapter series will get the source to rate
  limit or block you.
- Chapters land as CBZ per chapter. Point a reader (Kavita, Komga, Tachiyomi
  over OPDS) at the same folder rather than making Kaizoku serve reading.
- A stalled series is usually the **source** being down or having renamed the
  series, not Kaizoku. Check one chapter by hand in a browser before debugging
  the app.

## Books and audiobooks — say this plainly

**Readarr is no longer maintained** (the *arr team stopped development in
2025). Anyone still running it is running unmaintained software, and new
installs are not a good idea. What people use instead:

- **Calibre + Calibre-Web** for the library and format conversion; acquisition
  by hand or through a browser.
- **Audiobookshelf** for audiobooks and podcasts: excellent server, excellent
  apps, no acquisition of its own.
- **LazyLibrarian** still exists and still automates searching, but it is a
  smaller project — set expectations before recommending it.
- Prowlarr can search book indexers directly and hand a .torrent or .nzb to the
  client; that works without any book-specific app at all.

Do not tell the owner Readarr will do it. Offer the honest shape of the
options and let them choose.

## What to say when a request produces nothing

Work down this list and report which step it stopped at, rather than guessing:

1. Is it **approved** in Jellyseerr?
2. Did it reach the *arr — does the item exist there, monitored?
3. Did a **search** run? (`Activity → History` in the *arr)
4. Did any indexer **return results**? (Prowlarr → Search the title by hand)
5. Did a release get **grabbed** and reach the client?
6. Did the client finish, and did the *arr **import** it?

Five of those six are visible without touching anything. Read them before
proposing a change.
