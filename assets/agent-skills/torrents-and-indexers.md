---
name: qBittorrent and indexers
description: Managing the download client and the indexers behind it — categories, seeding, stalls, Prowlarr, FlareSolverr and rate limits
mode: ondemand
tags: media, qbittorrent, prowlarr, indexers, networking, troubleshooting
---

## qBittorrent, set up so the *arrs can work with it

Four settings decide whether imports work at all:

| Setting | Value | Why |
|---|---|---|
| `Downloads → Default Save Path` | `/data/torrents` | Same path the *arrs see |
| `Downloads → Keep incomplete torrents in` | `/data/torrents/incomplete` | An *arr must never see a half-written file |
| `Downloads → Content layout` | `Original` | `Create subfolder` breaks some imports |
| Categories | `movies`, `tv`, `anime` … | Each *arr writes its own category and finds its own downloads |

Categories are how Radarr and Sonarr find what they grabbed. A category with a
**save path override** that differs from the *arr's view of it is the single
most common cause of "Downloaded — Unable to Import".

### Seeding, ratio and disk

- Private trackers: honour their rules. `Options → BitTorrent → Seeding Limits`
  by ratio *and* by time, and set the action to **Pause**, not Delete — the
  *arr may still want the file.
- Public trackers: seed to a sane ratio and stop. There is no obligation to
  seed forever.
- If the *arr is set to remove completed downloads, seeding limits are what
  decide when that happens. Check both or files hang around for ever.

### The command line

```bash
docker exec qbittorrent qbt --version          # only if qbt is installed
curl -s -d "username=U&password=P" -c /tmp/qb.jar http://localhost:8080/api/v2/auth/login
curl -s -b /tmp/qb.jar http://localhost:8080/api/v2/torrents/info | jq '.[] | {name,state,progress,dlspeed}'
```

The Web API is the reliable route. `state` is what you want: `stalledDL`,
`missingFiles`, `error` and `pausedDL` each mean something different.

### Why something is not downloading

Read the state first, then work through:

- **`stalledDL` with 0 seeds** — nobody has it. Not a fault; tell the *arr to
  look for another release rather than waiting.
- **`stalledDL` with seeds present** — connectivity. Check the listening port
  is open and forwarded, and whether a VPN container is in the path.
- **`error` / `missingFiles`** — the data moved or the disk is full.
  `df -h /data` first, always.
- **Everything slow at once** — check the global rate limits, then whether
  another container is saturating the disk (`nexus`'s Disk Activity widget
  answers this directly).
- **Tracker says "unregistered torrent"** — the release was removed from the
  tracker. It will never complete; remove it and search again.

If a VPN container carries the traffic, qBittorrent's port must be the one the
VPN forwards, and `Advanced → Network Interface` should be bound to the tunnel
so a VPN drop stops traffic rather than leaking it.

## Indexers, through Prowlarr

Prowlarr owns the indexer list and pushes it to every *arr. Add indexers
**there**, never in Radarr or Sonarr directly, or the two lists drift.

**Adding one:** `Indexers → Add Indexer`, pick it, fill credentials, **Test**,
then `Settings → Apps` must list each *arr with `Full Sync`. After that a new
indexer appears everywhere within a minute.

Per-indexer settings worth knowing:

- **Priority** (1 is best) — which indexer wins when several have the release.
- **Seed ratio / seed time overrides** — private trackers with rules that
  differ from the global ones.
- **Tags** — attach an indexer to only some apps or some profiles. This is how
  you keep an anime tracker out of the film searches.
- **Query limits** — private trackers ban for hammering. Prowlarr's per-indexer
  limits exist to stop that; do not raise them to "fix" slow searching.

### Testing and failure

`Prowlarr → Indexers → Test All`. A red indexer names its own problem:

- **Cloudflare / 403** — the site is behind a challenge. **FlareSolverr** is
  the usual answer: run the container, add it in Prowlarr as an indexer proxy
  with a tag, and tag the affected indexers. It is a browser in a container, so
  it is heavy; tag only the indexers that need it.
- **401 / invalid API key** — credentials, or the account was disabled for
  inactivity (private trackers do this).
- **Timeouts on one indexer only** — theirs, not yours. Prowlarr disables a
  failing indexer for a while on its own and says so.
- **Everything failing at once** — DNS or outbound network on the host. Test
  with `curl -sI https://example.org` from inside the container, not the host.

### Getting better results

- Fewer, better indexers beat many bad ones. Every indexer is a query on every
  search and a chance to be rate-limited.
- Check **Search** in Prowlarr with the exact title before blaming an *arr: it
  shows what each indexer actually returned.
- If results exist in Prowlarr but the *arr rejects them all, it is a profile
  or custom-format problem, not an indexer problem. The *arr's search history
  states the rejection reason for each release.
