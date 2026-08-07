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

## 2. Publishing to itch

```
pwsh C:\Goliath\marketing\scripts\publish_itch.ps1 -Bump patch
```

`-Bump patch` is almost always required: the script refuses to reuse a version,
because itch will happily accept two different builds under one `userversion`
and then nobody can say which one a player is running.

What it does, in order — and it stops at the first failure:

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
6. **butler push** to the `html5`, `windows` and `linux` channels. Delta
   patching means a repeat push of a 30 MB build uploads ~1.3 MB.

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
