# Handoff — 16 Sep 2026

Transient note between agents. **Delete this file once the points below are
settled.** Durable knowledge belongs in `docs/HACKING.md`, not here.

---

## 1. Read this first: a credential was nearly committed

`.codex/config.toml` contains a live **PixelLab bearer token** in plaintext, and
the whole `.codex/` directory was untracked-but-unignored, so the next `git add
-A` would have pushed that token to a public GitHub repo.

`.codex/` is now in `.gitignore`, next to the existing `.mcp.json` rule which
exists for exactly the same reason.

**Nothing to revoke — it was never committed.** But please check any other
tooling directory you add for the same problem before staging it.

---

## 2. Your theme migration is in this commit

Your workstation-theme work was uncommitted and interleaved with files I needed
to change, so it went in with mine. Nothing was altered, reordered or reverted —
the working tree is byte-identical to what you left, minus `.codex/`.

Committing it was the only option that left the repo working: `web/index.html`
references `/appearance.js` and `/workstation.css`, and committing the HTML
without those two untracked files would have broken the app for anyone cloning.

Included from your side: `PRODUCT.md`, `.gitattributes`, `assets/workstation/`,
`backups/gui/before-workstation/` (82 files, 1.1 MB), `scripts/gui-backup.js`,
`scripts/gui-check.js`, `web/appearance.js`, `web/workstation.css`, the version
bump to 0.3.0, and the `gui:*` npm scripts.

Worth confirming: `backups/gui/before-workstation/` is tracked on purpose —
`.gitattributes` pins its bytes with `-text` for SHA-256 verification, which
only makes sense if it is in the repo. If that was not the intent, it is 1.1 MB
that does not belong in history.

---

## 3. What I changed, and where it needs your attention

The file manager's drives strip and clipboard. Server side is theme-agnostic and
needs nothing from you:

- `server/files.js` — `listRootsDetailed()` (capacity via `statfs`) and
  `transfer()` (copy/move, with the "into its own descendant" and overwrite
  guards).
- `server/routes.js` — `GET /files/roots` now returns capacity, note and order;
  `PUT /files/roots/prefs`; `POST /files/transfer`.
- `server/index.js` — the error handler now forwards `clashes`, `conflicts` and
  `wanted` from a refusal, via a named allowlist. Without it a 409 reached the
  client as "1 item already exists" with no way to say which. `web/app.js`'s
  `api()` copies the same three fields onto the thrown error.

**The part that touches your migration:** the root buttons are gone. `.rootbtn`
no longer exists; it is `.rootcard` now, with this structure:

```
.rootcard[data-root]      draggable, click to open, right-click for the note menu
  .rhead > .rn .rpct      name, and percentage used
  .rp                     the path
  .rbar > i               usage bar; .warn at 80%, .crit at 92%
  .rfig                   "389 GB / 465 GB · 75.7 GB free"
  .rnote(.empty)          the user's own label
```

Plus `.clipbar` (the copy/cut status strip) and `#f-table tr.cut` (rows dimmed
while they wait to be moved).

These are styled in `style.css` for the classic look **and now also in
`workstation.css`** — see the next section for what I added to your file.

New toolbar buttons in `web/index.html`: `#f-back`, `#f-copy`, `#f-cut`,
`#f-paste` (starts hidden), and `#f-clipbar` / `#f-clipcancel`.

---

## 3b. I have edited `workstation.css` — five blocks, all additive

Appended or inserted, nothing of yours rewritten. Move or restyle any of it
freely; I have flagged what each one is solving so you can tell whether your own
pass supersedes it.

- **Bar fills follow the track.** A rounded track filled with square-ended
  segments reads as cheap, because the first and last blocks overhang a curve
  they should sit inside. `.meter i:first-child` / `:last-child` get the track's
  radius; `.strack` and `.rootcard .rbar` clip so a 100% fill cannot square off
  the corners.
- **Widget selection.** The classic inset `outline` cuts across your rounded
  corners, so under `workstation` it is a `box-shadow` ring outside the border
  plus a tinted header. Selected widgets were genuinely hard to pick out before.
- **`.wband`** — the new rubber-band marquee on the dashboard canvas, given your
  radius.
- **Terminal chrome.** `#xterm-host` carried a hard-coded `#0D0916`, so the
  padding around the shell showed as a black frame inside a green panel. It now
  uses `--terminal-bg` like the rest, and `.termbar` sits on `--sunk`. Your
  palette tokens already had the right colour; nothing was using it here.
- **The workbench scene** is animated: the leaves sway, the indicator blinks,
  steam rises off the mug. It respects `[data-motion="reduced"]` and
  `prefers-reduced-motion` by stopping completely rather than slowing down.

For the scene I split `workbench.png` into `workbench-base.png` (scene with the
foliage removed) and `workbench-leaves.png` (foliage only, same 240×120 canvas
so it registers exactly). The original is untouched and still used on the
Settings page. Layers rather than a clipped copy, because rotating a clip leaves
the original leaves showing underneath and the plant grows a second set.

Overlay positions are percentages measured out of the PNG's pixels, not
eyeballed — the indicator sits precisely on the 4×4 red square already in the
art, so it pulses rather than adding a second light beside it.

## 4. State of the tests

- File manager API: **24/24** — copy, move, cross-root moves, clash detection,
  overwrite, and the refusals (into-itself, outside-the-roots both directions,
  moving a configured root, missing CSRF).
- `npm run check`: **30/31**. The failure is `system info returns data`, which is
  the known Windows-only timing issue — `si.osInfo()` takes ~97 s on this drive,
  so warmup has not finished when the assertion runs. It passes on Linux. Not a
  regression; it failed identically before my changes.

---

## 5. Two pre-existing things, neither of them yours

- **`npm run vendor` points at `scripts/vendor-xterm.js`, which does not exist.**
  Broken since well before either of us.
- **The version string disagrees in four places.** You moved `package.json` and
  `server/index.js` to 0.3.0; `/api/health` in `server/routes.js` still reports
  `0.1.0`, and `web/index.html` has `v0.1` hardcoded in the topbar. Worth
  unifying while you are in there.

---

## 6. Conventions I would ask you to keep

From `docs/HACKING.md`, the two that have actually cost time here:

- **Edit structured text with an editor, not with regex or shell strings.** A
  regex rewrite of one CSS rule silently deleted 34 lines of this stylesheet
  (the tables section and the entire drawer block) because it matched an older
  duplicate selector. Separately, a `content:""` written through a shell
  template literal landed as `content:;`.
- **Absent is not zero.** A root whose filesystem cannot be measured reports no
  bar rather than a zeroed one; security checks report `?`, never `0`. Please do
  not let a theme pass turn an unknown into a confident-looking empty state.
