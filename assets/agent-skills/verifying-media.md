---
name: Checking what actually arrived
description: Proving a download matches what was asked for — resolution, codec, audio, subtitles, episode counts, chapters, page counts, duration — and what to do when it does not
mode: ondemand
tags: media, troubleshooting, quality, subtitles, verification
---

"It downloaded" is not "it is what I asked for". A release name is a claim the
uploader made; the file is the evidence. Check the file.

## The one tool to reach for

`ffprobe` (part of ffmpeg) answers almost every question about a video file:

```bash
ffprobe -v error -show_entries format=duration,size,bit_rate \
        -show_entries stream=index,codec_type,codec_name,width,height,channels,bit_rate \
        -show_entries stream_tags=language,title -of default=nw=1 "$FILE"
```

`mediainfo "$FILE"` is friendlier to read if it is installed. Neither modifies
anything, so both are safe to run without asking.

Read it like this:

| Question | What to look at |
|---|---|
| Is it really 1080p/4K? | `width`×`height` — 1920×1080, 3840×2160. A "2160p" name with 1280×720 inside is a fake |
| Is it HDR? | `color_transfer` = `smpte2084` (HDR10) or `arib-std-b67` (HLG); Dolby Vision shows as a `dvhe`/`dvh1` profile or a DV side-data block |
| Which codec? | `codec_name` — `h264`, `hevc`, `av1` |
| Is the audio the right language? | audio streams' `TAG:language` — `eng`, `jpn`, `ara` |
| Is there a dub as well as the original? | count of audio streams and their languages |
| Are subtitles inside the file? | subtitle streams and their `TAG:language`; `codec_name` `subrip`/`ass` are text, `hdmv_pgs_subtitle` is images and cannot be searched or restyled |
| Is it the full runtime? | `format=duration` against the expected runtime — a 45-minute "film" is a sample or a trailer |
| Is the bitrate plausible? | A 1080p film at 900 kbps is a bad transcode whatever the name says |

A quick sanity pass over a whole folder:

```bash
for f in *.mkv; do
  printf '%s\t' "$f"
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
          -of csv=p=0:s=x "$f"
done
```

## Series: did every episode arrive?

Count before you trust:

```bash
ls -1 "/data/media/tv/<Show>/Season 03" | wc -l
```

Compare with Sonarr's own count — `Series → the show` shows episodes present
against episodes expected, and `Wanted → Missing` lists exactly what is absent.
That is faster and more reliable than counting files, because Sonarr knows the
expected total.

Watch for: a season pack that is missing the last two episodes, files that are
1 KB (a failed grab), and "S03E11-E12" double episodes that look like a gap but
are not.

## Manga: chapters and pages

- Chapters are CBZ (a zip). `unzip -l chapter-042.cbz | tail -1` gives the page
  count; a chapter with 3 pages is a partial or a placeholder.
- Gaps in numbering are normal for scanlations (missing chapters), but a gap
  that runs to the end means the source stopped tracking the series.
- `for f in *.cbz; do printf '%s %s\n' "$f" "$(unzip -l "$f" | tail -1 | awk '{print $2}')"; done`
  lists page counts for a whole folder — a run of suspiciously small numbers is
  the answer.

## Books and audiobooks

- Format first: `file book.epub` and `ls -lh`. A 40 KB "book" is a stub.
- EPUB page counts are not fixed, so compare word count or file size against
  another edition rather than chasing a page number.
- Audiobooks: `ffprobe` gives duration. Compare with the published runtime;
  a 3-hour file for a 14-hour book is an abridged edition, which is usually not
  what was wanted.
- Check chapter marks exist (`ffprobe -show_chapters`) — an audiobook with one
  chapter mark is a single blob and most players handle it badly.

## When it is wrong: the workarounds, in order

1. **Tell the *arr it is wrong.** In Radarr/Sonarr, delete the file from the
   item's Files tab and choose *blocklist and search again* — this is the
   correct tool. Blocklisting stops the same bad release being re-grabbed
   immediately, which is what makes a plain re-search useless.
2. **Fix the rule, not the file.** If a whole class of bad release keeps
   arriving, add a negative custom format for what they have in common (a
   group, "HDTV", a re-encode tag). One score change stops it for good.
3. **Missing subtitles → Bazarr**, rather than hunting by hand. It watches the
   library and fetches from OpenSubtitles and friends on a schedule. For
   external subs, keep them beside the file as `Movie.en.srt` — Jellyfin picks
   those up without a scan of the file itself.
4. **Wrong audio language only** — often the release has both tracks and the
   player picked the wrong default. Check the stream list before re-downloading
   a 30 GB file; setting the default track in Jellyfin's per-user settings may
   be the entire fix.
5. **Interactive search** (the magnifying glass with the list) shows every
   release with its size, seeds, indexer and rejection reason. When automation
   keeps choosing badly, this is where you see why, and you can grab a specific
   release by hand.
6. **Manual import** for a file that is right but will not import: `Wanted →
   Manual Import`, point at the file, pick the series/episode explicitly.

Two things not to do: do not re-download repeatedly hoping for a different
result (the same release will be grabbed again unless blocklisted), and do not
`chmod 777` the library to fix a permission error — find the actual uid.

## Reporting back

When asked to check something, answer with the measurement, not an impression:
"1920×1080 h264, 8.2 Mbps, 2 audio tracks (jpn, eng), 1 subtitle track (eng,
subrip), 24 min 11 s" says everything. "Looks fine" says nothing and cannot be
checked later.
