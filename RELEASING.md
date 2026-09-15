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

Targets: `pages`, `itch-web`, `itch-win`, `itch-linux`, `steam`, `crazygames`,
`playgama`, `android`.

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
   `devtools` tag; no `coi-serviceworker`; `crashlog.js` is copied in. The
   `steam` target inverts exactly one of these — see below.
6. **Packages and uploads** per target: `butler push` for the three itch channels
   (delta patching means a repeat push of a 30 MB build uploads ~1.3 MB), a squashed
   force-push for Pages, a browser session for the two portals, the Play API for
   Android.

### The Steam target, and the one check it runs backwards

`steam` is the only target that *wants* `addons/godotsteam` in the build, so it is
the only one that must not run `no_native_libs`. Running itch's check here would
reject `steam_api64.dll` — the single file the build exists to ship. It runs
`steam_api` instead, which asserts that library by NAME rather than "some native
lib is present": Godot copies GDExtension dependencies next to the binary, and the
quiet failure is the extension `.dll` arriving while the Steamworks `.dll` it links
against does not. That build loads fine and tells every player "Steam not running",
for ever.

Presets: **`Windows Steam`** → `builds/steam/win64`, **`Linux Steam`** →
`builds/steam/linux64`. Both carry `custom_features="steam"`, which is what makes
exporting the wrong preset into `builds/steam/` a failed verify rather than a
surprise on the storefront. Both were based on the orphaned `Windows Desktop` /
`Linux Desktop` presets **minus the ad SDK**: those exclude no addons at all, so a
desktop export off them packs 55 `AdmobPlugin` + `GMPShared` resources — 36 of them
model classes — into a build that can never show an ad. Measured 2026-08-28 against
`builds/windows`, which is also what proves the new `forbid_glob` is not vacuous.

**`steam_appid.txt` is the hazard, not the requirement.** `.gitignore` has refused
it since long before this target existed, and the reasoning still holds:
`steamInitEx(APP_ID, true)` sets `SteamAppId` itself, and a `steam_appid.txt` next
to a shipped exe **overrides** the real App ID — which is how a build ends up
runnable by people who do not own it. A local, ignored copy in the repo root is a
legitimate convenience (it is how you launch a build outside the client), but it is
then a second copy of the number that nothing relates to `Platform.APP_ID`, and a
stale one points a whole session at the wrong app while everything appears to work.
So the `steam_appid` check asserts the artifact first — no `steam_appid.txt`
anywhere in the export — then, only if a local copy exists, that it agrees. Absent
is a pass. It warns while the value is still 480.

**The Deck is 16:10, and that is a preset concern as well as a display one.**
1280x800 against a 640x360 canvas with `stretch/aspect="keep"` letterboxes the
device the store page sells day-one support for, so `project.godot` carries
`window/stretch/aspect.steam="expand"` beside the existing `.android` and `.pg`
overrides — keyed off the very `custom_features="steam"` this section is about.
The other half is `scripts/portal/aspect_fill.gd`, the backdrop that stops the
widened frame showing the void past the edge of a floor, and it forced the one
change to these presets: they excluded `scripts/portal/*` wholesale, which
forbade the file the fix depends on. They now exclude the three portal-**vendor**
scripts by name — `crazy_sdk`, `playgama_sdk`, `play_gate` — and
`tools/release/targets.json` follows, because a preset and its verify are two
halves of one fact. The guard loses nothing that mattered: a portal preset
exported into `builds/steam/` still fails on `require: steam`, on the forbidden
`portal`/`cg`/`pg` tags, on the missing `addons/godotsteam`, and on `bytes_min`
for the cut-down score. Measured with
`--steamframe --shotres 1280x800 --deckcheck`; see CLAUDE.md for why
`--resolution` cannot prove it.

**There is no upload.** A depot goes up through `steamcmd` with an app_build VDF and
a Steam Guard prompt, none of which exists here, and there is no app id to push to
yet. The target's strategy is `manual`: it exports, verifies everything machine-
checkable, prints the folder and stops — recorded as
`staged-awaiting-manual-upload`, never as published. §"What is automated" above is
the reason that distinction is worth a code path.

### Steam Cloud, and the one file that must not ride it

**There is no code to write.** Auto-Cloud is configured entirely on the partner
site (App Admin -> Cloud), and Steam syncs the files on launch and on clean exit
without the game knowing. The alternative -- the ISteamRemoteStorage API -- would
mean routing every write in `SaveIO` through Steam, which is a rewrite of the save
layer to buy a feature the config page already gives us. Nothing below changes the
build.

#### The two roots

`user://` is Godot's per-project data directory. `config/name="GoliathRogue"` and
there is no `use_custom_user_dir`, so it resolves to:

| Platform | Root Path | Subdirectory |
| --- | --- | --- |
| Windows | `WinAppDataRoaming` | `Godot/app_userdata/GoliathRogue` |
| Linux (and the Deck's native build) | `LinuxXdgDataHome` | `godot/app_userdata/GoliathRogue` |

**The capitalisation is not a typo and it is not cosmetic.** Godot writes
`%APPDATA%\Godot\...` with a capital G on Windows and `~/.local/share/godot/...`
with a lowercase one on Linux. Linux is case-sensitive; a copied-and-pasted
`Godot` in the Linux row is a path that never exists and a Cloud that silently
carries nothing.

**Both rows are required even though any one machine uses only one of them.** A
Deck runs the native Linux build; the same player's desktop runs the Windows one.
Steam maps each root to the same remote file, so the two only meet in the Cloud if
both are declared. That the meeting is safe is a property of these files and worth
saying once: every one of them is plain JSON (or a Godot `ConfigFile`) with no path,
no drive letter and no platform inside it, so a save written on a desktop genuinely
loads on a Deck. `settings.cfg` is the exception, and that is the whole of the next
section.

#### The files, one Auto-Cloud row each

`Root Path` and `Subdirectory` as above, `Recursive` **off**, `Platforms` = All.

| Pattern | What it holds | Cloud |
| --- | --- | --- |
| `meta.json` | gear, talents, the town, materials, the checkpoint | yes |
| `progress.json` | achievements, unlocks, the chosen player name | yes |
| `save_0.json` | the in-run save: stats, HP, equipped items, position | yes |
| `leaderboard.json` | this machine's local top ten | yes |
| `locale.json` | the chosen language | yes |
| `crt.json` | CRT filter tuning | yes |
| `settings.cfg` | audio volumes **and display mode/resolution/vsync** | **no** |

**Do NOT configure this as one `*` row with Recursive on.** The same directory also
holds `logs/`, `shader_cache/` and `objectdb_snapshots/`. `shader_cache/` is the
expensive mistake of the three: it is machine- and driver-specific, it is the only
thing in there that gets large, and restoring a desktop GPU's cache onto a Deck is
worse than having none. Seven named rows cannot do any of that, and they make every
exclusion below belt-and-braces rather than load-bearing.

#### Excluded paths, for whoever ignores the paragraph above

If a wildcard row is ever used, these must be excluded, and they are worth entering
anyway because an exclusion costs nothing and catches the day someone adds one:

| Pattern | Why |
| --- | --- |
| `meta_*check.json` | harness shadows. Every `--*check` probe writes its own copy of a **default** character -- no gear, no talents -- precisely so it cannot touch the player's save. Uploading one puts a naked wizard in the Cloud and hands it back on the next launch. |
| `meta_dev.json` | the same thing for `--shot` / `--bot`. It matches none of the other patterns here, so it needs its own row. |
| `*_test.json` | `leaderboard_test.json`, `progress_test.json` -- unit-suite scratch files. |
| `leaderboard_dev.json` | a developer's bot-run history, which is not anybody's score. |
| `telemetry/` | local funnel counters. Not progress, and not the player's business to carry between machines. |
| `logs/`, `shader_cache/`, `objectdb_snapshots/` | Godot's own working directories. |

#### Why `settings.cfg` stays out, and it is not a close call

It holds two unrelated things in one file: `[audio]` (sfx, music, the background
toggle, mute) and `[display]` (`mode`, `res_w`, `res_h`, `vsync`).

The display half is the problem. A Deck is a fixed 1280x800 screen; a desktop is
whatever monitor it is plugged into. Sync this file and the last machine to exit
wins: play on a 2560x1440 desktop in fullscreen, then launch on the Deck, and the
Deck comes up trying to be a 1440p window it cannot be. The failure is not
theoretical and it is not recoverable from inside the game if the resulting window
puts the options screen off the panel -- the player's only route back is deleting a
file they cannot find on a device with no file manager.

Losing the audio half is the cost, and it is small: two sliders and a mute, reset
once per machine, against a game that will not open on the machine the player
actually bought it for.

**If it is ever wanted anyway, split the file first** -- `settings.cfg` for display,
a new `audio.cfg` for audio, and sync only the second. That is a change in
`autoload/sfx.gd`, not a change on the partner site.

`locale.json` is the only other judgement call and it goes the other way: a language
is a preference, it is one line, and a Deck coming up in English after the desktop
was set to Spanish is a bug the player will report. Note that `rogue_main.LOCALE_PATH`
carries a comment arguing the opposite -- but that comment is about the **portal**
save mirror, where the shared surface is a phone and a household desktop. A Steam
account is one person.

#### Quota

Set the byte quota to **1 MB** and the file quota to **20**. Measured against a real
`user://` on 2026-08-29, the seven files total about 1.3 KB; `meta.json` is the
largest at 770 bytes and it grows with the town, not with playtime. Both numbers are
per user and are a ceiling, not an allocation -- they exist so that a bug which
starts writing a file per run is a refused sync rather than a bill.

#### Afterwards, check it actually did something

Auto-Cloud is configured in a place with no build to verify, so the only proof is
the round trip: publish the Cloud settings, run the game to a save, quit **cleanly**
(a crash can skip the sync), and confirm the files appear under the app's Cloud page
in the client. `--savecheck` asserts that the game's own writes land and that an
unreadable save is never overwritten; it knows nothing about Steam and cannot cover
any of this.

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
