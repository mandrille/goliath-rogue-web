# Does it run on Linux?

Asked because Valve's review (2026-09-09) said the Linux build did not launch,
and because there is no Linux on the machine this game is written on: no WSL
(`wsl --status` says it is not installed), no Docker, no second box. The honest
answer has three parts.

## There is no 100%

Nothing gets you a guarantee across "Linux". Distros differ, drivers differ,
Wayland and X11 differ, glibc versions differ. What you can buy is coverage of
the things that actually break, in rising order of cost — and the first two
cover the overwhelming majority of Godot-on-Windows-developed failures.

## 1. Case-sensitive paths — free, runs here, in the gate

`tools/linux_check.py`. Every `res://` path literal in the project, checked
against the case the filesystem really has. NTFS does not care about case and
ext4 does, so `res://scripts/UI/x.gd` against a folder named `ui` works on every
machine here, ships, and gives a null resource on Linux. This is the single most
common cause of "it does not launch on Linux" for a project developed on
Windows, it cannot be found by running the game here, and it takes two seconds.

    python tools/linux_check.py

977 paths checked, 32 skipped (built at runtime from a variable, so a static
check cannot see them). It is in `tools/release.ps1`, so it blocks an upload.

## 2. A real Linux, on every push — free, needs nothing installed

`.github/workflows/linux-check.yml`. An Ubuntu runner that:

- runs the case check
- runs all four test scenes and all five headless probes on the Linux build of
  the engine, with the same pass strings the Windows gate uses
- **exports the Linux Steam build and runs it** — which is the step that speaks
  to what Valve saw, because everything above it runs on the *editor* binary and
  the thing a player double-clicks is a different executable that loads an export
  template and a GodotSteam `.so` at startup
- checks that binary's **execute bit** and that its libraries resolve (`ldd`).
  A file exported and uploaded from Windows carries no Unix permissions, and a
  depot that lands mode 644 gives a player exactly "does not launch"
- boots it headless and requires the `[design]` and `[platform]` lines, so a
  binary that starts and immediately falls over cannot pass
- runs it under `xvfb` with software GL and **records the frames** with Godot's
  movie writer. A multi-megabyte recording is a game that rendered; a tiny one
  is a black screen

Green means: it launches, boots, plays and draws on Ubuntu with software GL. That
is a long way past where this was.

## 3. What is still not covered

- other distros, other glibc, Wayland, a real GPU driver
- the Steam client itself: `--steamcheck` needs a running Steam and a
  leaderboard, so it stays on the machine that has one
- whether the depot's file permissions survive the upload. CI checks the file it
  exported; only a Linux install of the shipped build checks the depot

For those, the options are a Steam Deck (the actual target, and it runs an
Arch-based SteamOS), `wsl --install` here (admin plus a reboot, and WSLg gives a
real window), or a cheap Linux VM.

## The Steam-specific shortcut

**Proton.** The current store page has Linux/SteamOS unchecked, which means Steam
serves the *Windows* depot to a Linux player and Proton runs it — and for a small
Godot game with no anti-cheat and no launcher, that path is extremely reliable.
It is also how most of the Deck library works. Shipping Windows-only and letting
Proton handle Linux is a smaller risk than shipping a Linux depot you cannot
test, which is the trade this project is currently taking.

If the Linux depot goes back on, the order is: CI green (2), then a real install
on a Deck or a VM, then re-check the box.
