# Android

Status (2026-08-13): **the toolchain exists and APKs/AABs have been built. The one
thing still blocking an automated release is the release keystore.**

```
ERROR: Code Signing: Could not find release keystore, unable to export.
ERROR: Project export for preset "Android Play" failed.
```

`C:\Goliath\Android\release.keystore` is on disk, but nothing tells Godot to use it,
and its alias and password are recorded nowhere. Set all three in the shell that
runs the release — never in the repo:

```
$env:GODOT_ANDROID_KEYSTORE_RELEASE_PATH     = "C:\Goliath\Android\release.keystore"
$env:GODOT_ANDROID_KEYSTORE_RELEASE_USER     = "<alias>"
$env:GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD = "<password>"
```

`tools\release.ps1` checks for these in **preflight**, before anything is built,
because Godot only reports the missing keystore at the end of a full Gradle build.

> Note that Godot writes that error to **stderr**, which the release script does not
> capture (it must not — see the NativeCommandError comment in `tools/release.ps1`).
> A failed export is caught by asserting the artifact's timestamp actually moved, not
> by reading the log. Do not "fix" that by adding `2>&1`.

Two other things in this file were wrong until now and are worth stating plainly:
**`gradle_build/use_gradle_build` is `true`, not false** (both Android presets), and
because of that **the AAB contains no `.pck`** — resources land loose in
`assetPackInstallTime/assets/`. `tools/verify_pck.py` handles that container
directly; do not go looking for a pck that does not exist.

`version/code` is now derived from `config/version` by `tools/release/bump.py`
(`major*100000 + minor*1000 + patch*10`), so 1.0.3 is `100030`. It was `2` in both
presets while the last shipped AAB reported `1`. Play rejects a reused version code,
so this is not cosmetic.

---

## What the game already had right

None of this needed changing, and it is worth knowing why:

- **`renderer/rendering_method.mobile="gl_compatibility"`.** The mobile renderer is
  already the OpenGL one. Forward+ would not run on most Android GPUs.
- **`canvas_items` stretch at 640x360, aspect `keep`.** Scales to any phone and
  letterboxes rather than distorting. A pixel game must never stretch.
- **Touch controls arm themselves.** `touch_controls.gd` keys off
  `DisplayServer.is_touchscreen_available()`, which is true on Android with no flag
  and no build-specific branch.
- **The leaderboard works with no code change.** `_pick_backend` asks
  `OS.has_feature("web")` (false), then `Engine.has_singleton("Steam")` — and the
  preset excludes `addons/*`, so there is no Steam singleton and it lands on the
  HTTP board, exactly like the itch desktop builds.

Added for Android: `display/window/handheld/orientation="landscape"`. Godot
defaults to landscape, but a 16:9 game should say so rather than inherit it.

## The preset

`Android`, in `export_presets.cfg`:

- **`arm64-v8a` only.** Google Play has required 64-bit since 2019; armeabi-v7a
  only adds size unless you are targeting pre-2017 hardware.
- **`permissions/internet=true`.** Without it the leaderboard silently fails on
  device: the same "board sits there forever" shape as a CORS block.
- **`addons/*` excluded**, same as the itch presets. GodotSteam has no Android
  binaries and has no business in this build.
- **`gradle_build/use_gradle_build=true`** — turned on since this was written,
  because the AdMob plugin needs a custom Android source template. It drags in the
  whole Gradle toolchain, and it is why the AAB has no `.pck`.
- **`addons/` is only partly excluded here, deliberately**: `addons/godotsteam/*`
  only, because `addons/AdmobPlugin/` is the ads integration this build wants.
  Every *web* preset excludes `addons/*` wholesale — and Playgama's did not until
  2026-08-13, so 51 AdmobPlugin scripts were shipping inside a web build for a
  portal whose rules forbid external ad networks.
- `screen/immersive_mode=true`, so the system bars stay out of a fullscreen game.

## What is still needed

1. **JDK 17.** Godot 4.x's Android export requires 17 specifically — not 11, not 21.
2. **Android SDK**, with `platform-tools` and `build-tools`. The command-line tools
   are sufficient; Android Studio is not required.
3. **Editor Settings** must point at both. They live in the editor settings file,
   not in the project, so they are per-machine and NOT in this repo:
   `export/android/java_sdk_path` and `export/android/android_sdk_path`.
4. **A debug keystore** for local APKs (Godot can generate one), and a **release
   keystore** for Play. The release keystore and its password must never enter this
   repo — same rule as `ADMIN_TOKEN.txt`, and with worse consequences: lose it and
   you can never update the listing again.
5. **Play Console**: a one-time $25 registration, and an AAB rather than an APK for
   the store listing (`gradle_build/export_format=1`). An APK is still the right
   artefact for sideloading and for testing on your own device.

## Done

- **The back button.** Godot quits on back by default, so the gesture ended a run
  outright. The `GO_BACK` notification was already handled — but only to SAVE, so
  the game wrote the file and then closed anyway. `quit_on_go_back` is now false
  and the press is synthesised into `ui_cancel`, so back means what Escape means
  and every existing panel handles it without a second copy of the routing.
- **The name prompt was never broken here.** Checked rather than assumed: it takes
  the browser's `prompt()` only under `OS.has_feature("web")`, which is false on
  Android, so the GLOBAL tab already builds a real `LineEdit` and Godot raises the
  system keyboard on focus. `html/experimental_virtual_keyboard` is a web-only
  export flag and appears in the three Web presets alone.

## Before it ships, not after

- **Test on a real device.** The web build is not a proxy — touch target sizes and
  the back gesture behave differently, and neither can be judged on a desktop.
- **Audio focus and pause.** A call or a lock screen should pause the run.
  `APPLICATION_PAUSED` currently only triggers a save; it does not pause the tree.
  Deliberately left until it can be tested on a device, because forcing a pause
  interacts with the menu state machine and guessing at that is how you ship a
  game that resumes into a broken menu.
- **Save location.** `user://` maps to app-private storage, wiped on uninstall.
  `package/retain_data_on_uninstall` is false, which is the honest default;
  players should be told rather than surprised.

---

## What the signed AAB actually contains (verified 15 August 2026)

Read out of `builds/android/GoliathRogue.aab` with bundletool and keytool, not out
of `export_presets.cfg`. Reading the config cannot catch the one failure that
matters, which is exporting with the wrong preset selected.

| | |
|---|---|
| signing cert SHA-256 | `29:36:80:56:DF:DE:EA:EE:C5:A9:52:73:70:7E:C8:A4:79:00:FE:2A:33:91:40:01:AA:8A:32:87:B8:D1:EE:21` |
| certificate | `CN=Alberto Fernandez, OU=Goliath Studios SP, L=Jerez, ST=Cadiz, C=CA` |
| package | `com.goliathstudios.rogue` |
| versionCode / versionName | `100030` / `1.0.3` |
| min / target SDK | 24 / **36** |
| AdMob app id | `ca-app-pub-3940256099942544~3347511713` -- **Google's TEST id** |

`keytool -printcert -jarfile <aab>` reads the signature; an AAB is JAR-signed, so
this works where `apksigner` (v2/v3) does not. `aapt2` cannot read an AAB at all --
the manifest is protobuf, not binary XML -- so the manifest facts come from
`bundletool dump manifest`.

### The permission allowlist in the plan was wrong

The release plan specified an exact allowlist of three (`INTERNET`,
`ACCESS_NETWORK_STATE`, `com.google.android.gms.permission.AD_ID`) and called
anything else a Data-safety mismatch. **The real artifact declares nine.** A gate
built from that list would reject every legitimate ads build.

The six extras all arrive with `play-services-ads:24.9.0`, not from the game:

```
android.permission.ACCESS_ADSERVICES_AD_ID          Privacy Sandbox
android.permission.ACCESS_ADSERVICES_ATTRIBUTION    Privacy Sandbox
android.permission.ACCESS_ADSERVICES_TOPICS         Privacy Sandbox
android.permission.AD_ID                            alongside the gms one
android.permission.FOREGROUND_SERVICE               ads SDK
android.permission.WAKE_LOCK                        ads SDK
```

Two consequences. **FOREGROUND_SERVICE draws Play scrutiny** and the game itself
runs no foreground service -- if review asks, the answer is that the ads SDK
declares it. And the **Privacy Sandbox permissions widen what Data safety must
cover** beyond the advertising ID alone; `docs/privacy.html` describes the ad SDK
sending "technical information ... to Google", which covers it, but a reviewer
comparing the two will see Topics and Attribution in the manifest.

### The gate that is still missing

`tools/release/package.py` prints the **artifact** sha256. Nothing asserts the
**signing certificate**, which the plan correctly called the highest-value single
check -- nothing currently stops a debug-signed AAB reaching an upload. The
fingerprint above is the value to assert against.

### The two Play warnings on upload, and why both are ignorable

Play flags these on every Alpha upload. Neither blocks a rollout, and one does not
apply at all.

**"Remove resizability and orientation restrictions."** Apps targeting API 36 have
`screenOrientation`, `resizeableActivity="false"`, `minAspectRatio` and
`maxAspectRatio` IGNORED on displays of sw600dp or greater. Two reasons it does not
bite here. `resizeableActivity` is already **true** in the shipped manifest, so half
the warning was never true of this app. And **games are excluded from the change by
`android:appCategory`** -- the bundle declares `appCategory="0"`, which is
`CATEGORY_GAME`, set by Godot without being asked. The landscape lock survives on
tablets and foldables.

Not permanent: Google removes the `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY`
opt-out at API 37, and whether the games exclusion outlives it is unstated. Revisit
when targetSdk 37 becomes mandatory, not before.

**"Deprecated APIs for edge-to-edge."** This is Godot's Android AAR, not this
project's code -- the window/system-bar calls deprecated in Android 15. It cannot be
fixed without patching the Android build template, and it is cosmetically moot for a
game running `screen/immersive_mode=true` at a fixed 640x360 with `aspect="keep"`,
which letterboxes rather than drawing under the system bars.

Both were checked against the artifact with `bundletool dump manifest`, not against
the Console text, which describes the general case rather than this app.
