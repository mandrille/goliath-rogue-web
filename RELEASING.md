# Releasing, and the online board

Everything here is written down because it was learned by getting it wrong once.
Where a rule looks arbitrary, the reason it exists is stated next to it.

---

## 1. Where things live

| What | Path | In git? |
|---|---|---|
| The game | `C:\Goliath\GoliathRogue` | yes |
| The leaderboard service | `GoliathRogue/board-worker/` | **yes — this is the source of truth** |
| Marketing text + tooling | `GoliathRogue/marketing/` | yes (this copy) |
| Marketing, the real folder | `C:\Goliath\marketing` | **no — 18 GB** |
| Cloudflare admin token | `C:\Goliath\marketing\board-worker\ADMIN_TOKEN.txt` | **never** |
| itch push credential | `~/.config/itch/butler_creds` | **never** |

`C:\Goliath\marketing` is 18 GB, and `build/` alone is 17 GB of intermediate
video. Only the text and tooling are mirrored into the repo — the release
scripts, the store copy, the playbook. Anything rendered, captured or downloaded
stays out; git history never forgets a 400 MB file.

`marketing/*` is in the `exclude_filter` of **every** export preset, exactly like
`board-worker/*`. Without that the store copy and the release scripts ship inside
the game.

### The two board-worker copies

`GoliathRogue/board-worker/` is canonical. `C:\Goliath\marketing\board-worker\`
holds the wrangler state (`.wrangler/`) and the admin token, and for a while it
also held a **stale copy of `src/index.js`** — older than the game repo's, and
the one wrangler was deploying from. They had already drifted: the repo copy
allowed `localhost` origins for local testing and the deployed one did not,
which led directly to a wrong conclusion ("a local browser test would be CORS
blocked, so it proves nothing") and a release that went out unverified.

**Deploy from the game repo copy.** If you deploy from marketing, sync it first
and check `diff` is empty.

---

## 2. Publishing

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools\release.ps1 -All -Bump patch
```

> **Why the long prefix.** This machine's execution policy is Restricted, so
> `powershell tools\release.ps1` fails with *"running scripts is disabled on this
> system"* — and the failure looks like a broken script rather than a machine
> setting. `-ExecutionPolicy Bypass` applies to that one process only and needs no
> admin rights. If you would rather type less, `Set-ExecutionPolicy -Scope
> CurrentUser RemoteSigned` once removes the need — that is your call to make, not
> the pipeline's.
>
> `pwsh` is **not** installed here, only Windows PowerShell 5.1. The script resolves
> whichever host exists before launching `deploy_pages.ps1`, so it keeps working if
> PowerShell 7 is ever installed.

One command, every storefront. `tools\release.ps1` is the generalisation of the old
`publish_itch.ps1` — same stages, same guards, but driven by a manifest
(`tools/release/targets.json`) that holds one entry per target, so adding a platform
is a manifest edit rather than a fourth copy of the script.

**`publish_itch.ps1` is gone.** It existed in two copies that had already diverged —
the repo's still had the hand-rolled byte scan, `C:\Goliath\marketing`'s called
`verify_pck.py` — which is the same disease §1 describes for board-worker. The
release tooling now lives only in `tools/release/`, in git.

| | |
|---|---|
| `-All` | every target in the manifest |
| `-Targets itch-web,crazygames` | just these |
| `-Resume` | re-run only the targets not yet at the current version |
| `-WhatIfOnly` | build, verify, package — upload nothing. Needs no credentials at all, so it is safe to run at any time |
| `-ConfirmSubmit` | required before anything irreversible: a portal's Submit-for-review, or sending a Play release for review |
| `-Login crazygames` | sign in to a portal dashboard by hand, once; the session is reused after that |

Targets: `pages`, `itch-web`, `itch-win`, `itch-linux`, `crazygames`, `playgama`,
`android`.

`-Bump patch` is almost always required: the script refuses to reuse a version on a
target that already has it, because a storefront will happily accept two different
builds under one version and then nobody can say which one a player is running.
State is tracked **per target** in `tools/release/state.json` — the normal outcome of
a six-target push is not "it worked", it is "five landed and Playgama moved a
button", and `marketing/last_release.json` could not express that (it sat at 1.0.2
while the game shipped 1.0.3).

### What is automated, and what cannot be

| | build upload | announcement |
|---|---|---|
| itch.io | `butler push`, delta-patched | **no API** — itch decline to provide one, to limit spam |
| GitHub Pages | git push | n/a |
| Google Play | androidpublisher v3 | release notes only |
| CrazyGames | **no API** — browser automation | no API |
| Playgama | **no API** — browser automation | no API |

Two things stay human on purpose: **signing in** to each dashboard (2FA, and no
script here touches a bot check), and **the devlog text**. `tools/release/devlog.py`
drafts the brief from the commit log and stops at "The angle", because choosing what
a release is *about* is the whole value of a devlog and no commit message decides it.

What a release does, in order — and it stops at the first failure:

1. **git must be clean.** The version bump is committed, so a dirty tree would
   sweep unrelated work into a release commit.
2. **Bumps `config/version`** in `project.godot` and commits it. This happens
   *after* the clean check, not before — the other order left the bump stranded
   in a dirty tree when a later step failed.
3. **Runs the whole harness.** craft, progression, platform, `--debugcheck`,
   `--talentcheck`, `--introcheck`, `--steamcheck`. A red suite stops the release.
4. **Exports `Web itch`, `Windows itch`, `Linux itch`** — never the plain `Web`
   preset, which carries `custom_features="devtools"` and would put the debug
   menu on a public storefront.
5. **Verifies what is about to ship**: the web build is newer than every source
   file; no `.dll`/`.so`/`.dylib` in the desktop builds (they must exclude
   `addons/*`, or a player with Steam running shows to their friends as playing
   Spacewar, App ID 480); every UI glyph resolves in a bundled font; no
   `devtools` tag; no `coi-serviceworker`; `crashlog.js` is copied in.
6. **Packages and uploads** per target: `butler push` for the three itch channels
   (delta patching means a repeat push of a 30 MB build uploads ~1.3 MB), a squashed
   force-push for Pages, a browser session for the two portals, the Play API for
   Android.

### The checks that guard a portal build

`tools/verify_pck.py` asserts against the **artifact**, never the config — reading
`export_presets.cfg` cannot catch the one failure that matters, which is exporting
with the wrong preset selected. It now reads `.pck`, `.aab` and `.zip` through one
code path, so an Android bundle (which contains no pck at all — the resources land
loose in `assetPackInstallTime/assets/`) is checked by the same rules as a web build.

**The audio split cannot be checked by a glob, and for a long time we thought it
could.** PUBLISHING_PLAYBOOK §1.5 documents

```
--forbid-glob "assets/audio/music_*.ogg*"
```

as the guard that caught the Android presets shipping both soundtracks. Run it today
and it reports `ok` on **every** build, including ones carrying the full score:
packed audio keeps no source directory, so a track is
`.godot/imported/music_astral.ogg-<hash>.oggvorbisstr`, and the portal set and the
full set have *identical basenames*. No pattern can separate them. Size can —
measured 2026-08-13, portal 4.95 MB across 40 files, full 19.98 MB across the same 40
names — so the manifest uses `--bytes-max`/`--bytes-min` instead. `verify_pck.py`
now also prints a NOTE whenever a forbid pattern looks in a directory that exists and
still matches nothing, because a guard that can only pass is not a guard.

**`builds/` needs its `.gdignore`.** It did not have one, while `docs/`, `tools/` and
`marketing/` all did — so the editor imported the PNGs the exporter had just written
there and packed them into the *next* export. Six stray
`.godot/imported/index.png-<hash>.ctex` entries were inside the shipped CrazyGames
pck, and four `.import` files inside the shipped zip. `release.ps1` recreates the
file on every run, because `builds/` is gitignored and a fresh clone would otherwise
reintroduce it.

Afterwards: **post a devlog.** With Status = In development, devlogs are the
discovery channel — they surface to followers and browse feeds. A build push on
its own tells nobody anything.

### Standing rules for the web build

- **Thread Support OFF.** Godot 4.3+ fixed single-threaded exports.
- **Never enable itch's SharedArrayBuffer option.** It serves from a *different
  origin*, which silently destroys every existing player's save.
- **Never reintroduce `coi-serviceworker.js`.** It breaks inside an iframe, which
  is exactly how itch embeds a game.
- **Never rename a save key.** Browser saves are per-origin and survive updates
  only if the keys do. Add a one-shot `*_migrated` flag and migrate.
- itch limits: 500 MB extracted, 200 MB per file, ≤1000 files.

---

## 3. The online board

A Cloudflare Worker over D1 (SQLite). D1, not KV: KV's free tier is **1,000
writes per day in total**, and a 60-second presence heartbeat at 200 daily
players needs 5,000 before a single run is submitted. D1 gives 100,000 row-writes
a day.

```
POST /v1/ping    presence + the live count. The server sends `interval` and the
                 client obeys it, so the heartbeat rate can change for everyone
                 already playing without shipping a build.
POST /v1/run     submit. `tainted` is NOT in the schema -- if the Worker sees the
                 key at all it returns 400, so a client-side regression fails
                 loudly instead of quietly uploading a god-mode run.
GET  /v1/board   rows + the count. The server sets `you` per row, so player ids
                 are never returned to other clients.
POST /v1/name    stateless validator, so the name screen can reject immediately.
POST /v1/admin/* delete / ban / stats, behind a bearer token.
```

Bodies are `text/plain` — a CORS-safelisted type, so there is no preflight and
the request count halves.

### Client

`Platform` (autoload) picks one backend at boot and every call site talks to a
capability, never to a vendor. The order is the safety property:

1. a probe or headless run is **local**, full stop — unless `--boardurl` was
   typed, which is how a probe reaches a staging board and never production;
2. web can only be HTTP (a GDExtension cannot load there at all);
3. desktop prefers Steam **and Steam composes the HTTP board** rather than
   replacing it. Steam owns achievements, identity and presence; it has never
   owned a leaderboard. Composing only the local backend meant that merely
   having the Steam client running greyed out GLOBAL and hid the name prompt.

`BOARD_URL = ""` in `autoload/platform.gd` is the emergency off switch: one line
disables every network call in the game.

### What is sent, and what is not

A random id generated on-device, the name you choose, and your run scores.
Nothing else. **The crash log stays on the device** — it contains a browser
fingerprint (user agent, GPU renderer, cores, memory) and must never be
auto-uploaded. This is stated in-game in the credits, not only on a store page.

### Honest limits

The client is authoritative and the `.pck` is a public download. Anyone who
spends an hour with it can craft a run that sits exactly at whatever ceiling the
plausibility bounds set. Those bounds stop `floor: 99999`; they do not make the
board honest. An embedded HMAC would be obfuscation, not authentication — the key
would ship in the pck. **What actually works at this scale is a delete button**:

```
TOK=$(head -1 "C:\Goliath\marketing\board-worker\ADMIN_TOKEN.txt" | sed 's/^[A-Za-z_]*=//')
curl -X POST -H "Authorization: Bearer $TOK" \
  "https://goliath-board.goliathstudiossp.workers.dev/v1/admin/delete?board=main&pid=<pid>"
```

`ADMIN_TOKEN.txt` is `KEY=value` plus usage notes, not a bare token — read line 1
and strip up to the `=`. Player ids are never returned by the public API by
design, so get them from D1:

```
npx wrangler d1 execute goliath-board --remote --json \
  --command "SELECT pid, name, floor FROM best"
```

---

## 4. Traps that cost real time

- **`HTTPRequest` hangs forever on a CORS-blocked fetch.** `request_completed`
  never fires — not even on the node's own `timeout`. Every request carries its
  own watchdog `Timer` for this reason. This is what a player behind a blocking
  proxy gets, and without the watchdog the board sits on "Contacting…" with
  nothing to click.
- **`PlatformBackend` is `RefCounted`, `HTTPRequest` is a `Node`.** The backend
  parents a `_net` container to the `Platform` autoload, and that container is
  `PROCESS_MODE_ALWAYS` — opening the board *pauses the tree*, and a paused
  `HTTPRequest` never polls its connection. The one screen that needs the
  network is the one screen where the network is off.
- **A release build ignores debug flags**, so `--boardcheck` cannot self-test a
  shipped artifact, and a Windows release build has no console — its output goes
  to `user://logs/`.
- **The Browser pane must be displayed to test a web build.** Godot's main loop
  is `requestAnimationFrame`-driven and browsers suspend that for pages that are
  not compositing. The game will boot its autoloads and then silently stall.
- **Never grep a `.pck` to check whether a string shipped.** Entries are
  compressed; `"RETURN TO TOWN"` is not greppable either.
