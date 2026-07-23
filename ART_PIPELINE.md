# Art pipeline — biomes, tiles & props (Forest reference)

Practical guide to **how the world art is built and how to edit it**, using the
Forest as the worked example. This complements [`../ART_DIRECTION.md`](../ART_DIRECTION.md)
(the visual bible / house style / "no AI art" rule) — read that for *what the art
should look like*; read this for *the mechanics of editing and rebuilding it*.

Everything here is the hand-authored, deterministic text-grid pipeline. No image
generation. If art looks wrong, edit the `.txt` grid and re-render.

---

## 1. Spec → build → atlas pipeline

Hand-authored pixel art lives as **text-grid `.txt` specs** under `art_src/`.
Each spec is character rows plus a hex-color palette legend (and a `scale:`
header). They're rendered by the pixel-art skill
(`~/.claude/skills/pixel-art/pixelart.py`) into PNGs, then nearest-neighbour
upscaled and stitched into the runtime assets in `assets/art/`.

### Source tree layout

```
art_src/
  Environment/<Biome>/tiles/   # tileset columns (e.g. Forest/tiles/forest_*.txt)
  Environment/<Biome>/props/   # trees, rocks, flowers, shore decor
  Enemies/<Biome>/             # per-biome enemies & bosses
  Heroes/                      # playable characters + weapons
  fx/  ui/  items/  minions/  props/  decor/   # shared, cross-biome sets
```

**Specs are resolved by basename, not by path.** The build scripts index every
`art_src/**/*.txt` and look specs up by filename (`spec()` in
`tools/build_pixel_art.py`, `find_spec()` in `tools/build_all_new_art.py`). So
the source tree can be freely reorganized — moving a spec to a new folder does
not break the build (a duplicate basename raises an "ambiguous spec" error, so
keep basenames unique).

### The build scripts

| Script | Builds | Run |
|---|---|---|
| `tools/build_pixel_art.py` | The original/base sets: hero + zombie sheets (`char/`, `enemies/`), the older dungeon props, the 6-slot Catacomb & ground tilesets, decor, UI window + skill icons, and skill-FX flipbooks. | `python tools/build_pixel_art.py` |
| `tools/build_all_new_art.py` | The "new content" wave: the 6-tile tilesets **and** face sprites for biomes `marsh, coral, clockwork, storm, astral, city, library`; ~40 new enemies/bosses (auto sheet vs. static by counting `frame:`); charms; biome props; and ambient/`shot_` FX. Warns-and-skips missing specs. | `python tools/build_all_new_art.py` |
| `tools/build_forest_tiles.py` | **Only the Forest tileset atlas** — the 8 Forest tile specs stitched into `assets/art/tiles_biome_forest.png`. | `python tools/build_forest_tiles.py` |

The Forest has its own builder because it's an **8-column** atlas (6 standard
open-biome tiles + 2 river-bank tiles), so it doesn't fit
`build_all_new_art.py`'s fixed 6-tile biome loop.

All three scripts `os.chdir` to the repo root on startup, so run them from
anywhere. They shell out to `pixelart.py` via the current `python`, so use the
project's Python that has Pillow/numpy available.

> Specs must be saved **UTF-8 without BOM** (PowerShell 5.1 `Set-Content` adds a
> BOM and breaks the parser — use `[IO.File]::WriteAllText`). The sprite editor
> writes them correctly.

---

## 2. Forest tiles as individual editable specs

The Forest tileset (`assets/art/tiles_biome_forest.png`) is an **8-column atlas**,
each column a 128px cell. Every column is its **own single-frame spec** at
`scale: 8` (16px grid → 128px cell) under
`art_src/Environment/Forest/tiles/`:

| Col | Atlas `Vector2i` | Spec | Meaning |
|---|---|---|---|
| 0 | `(0,0)` | `forest_base.txt` | meadow grass (default floor) |
| 1 | `(1,0)` | `forest_varA.txt` | flowers variant |
| 2 | `(2,0)` | `forest_wall.txt` | hedge wall |
| 3 | `(3,0)` | `forest_varB.txt` | small rocks variant |
| 4 | `(4,0)` | `forest_water.txt` | water |
| 5 | `(5,0)` | `forest_path.txt` | dirt path (also used for river fords / stepping stones) |
| 6 | `(6,0)` | `forest_bank_right.txt` | river bank: water left, grass right |
| 7 | `(7,0)` | `forest_bank_left.txt` | river bank: grass left, water right |

The column order is defined in `build_forest_tiles.py`'s `TILES` list; that order
**is** the atlas layout the game indexes into.

### Editing workflow (sprite editor)

1. Launch the editor: `python tools/sprite_editor.py` — or double-click
   **`sprite_editor.bat`** in the repo root.
2. In the left panel, open **Environment/Forest/tiles** and pick a tile (e.g.
   `forest_base`).
3. Paint on the canvas: **left-drag paints, right-drag erases, middle-click
   eyedrops.** The right panel is the sprite's palette plus a base palette
   (clicking a base color adds it to the sprite). **Ctrl+Z** undo.
4. **Ctrl+S** (or Save) writes the spec back.
5. Rebuild the atlas:

   ```
   python tools/build_forest_tiles.py
   ```

**Editing model — important:** the sprite editor edits **only the FIRST frame**
of a spec (the "static" frame). It preserves headers and any other frames
untouched. Forest tiles are single-frame, so this is the whole tile; for
multi-frame sprites (walk/attack) the user edits the static frame and Claude
propagates the change to the animation frames, then rebuilds.

After a rebuild, re-import so Godot picks up the new PNG:
`& $godot --headless --path . --import`

---

## 3. River bank blend

The two river-bank tiles do a **soft water→grass transition** using an
**ordered-dither** speckle at the interface (mixed water `W/w/V/s` and grass
`G/g/L/l/t` pixels), not a hard cut line. `forest_bank_right` keeps water on the
left and grass on the right; `forest_bank_left` mirrors it. This lets a 2-wide
river blend only on its **outer** edges while the middle seam stays pure water.

Placement is in `_build_open_biome` in
[`scripts/rogue/rogue_main.gd`](../scripts/rogue/rogue_main.gd) (around line 663):

- A winding **2-tile-wide river** is carved down a column `rx` that jitters
  `±1` per row, avoiding the town in `home_mode`.
- The left column of the pair gets **`bank_left` (7)**, the right column gets
  **`bank_right` (6)** — so only the outer edges dither to grass. Those cells
  are marked `_walls` (blocking) and tracked in `water_cells`.
- Two **fords** (random rows) drop `path (5)` stepping-stone tiles so the river
  stays crossable.
- **Shore decor** breaks the rectangular edge: reeds (`assets/art/props/reed.png`)
  scatter on the grass banks (40% per adjacent non-water cell) and lilypads
  (`assets/art/props/lilypad.png`) float on the water (22% per water cell), each
  with a random position jitter.

---

## 4. Forest props

Specs live in `art_src/Environment/Forest/props/`:

| Spec | Role |
|---|---|
| `oak.txt`, `pine.txt`, `birch.txt` | the tree set (obstacles / collision) |
| `rock.txt` | scattered boulder obstacle |
| `flower_red.txt`, `flower_blue.txt`, `flower_white.txt` | non-blocking meadow decor |
| `reed.txt`, `lilypad.txt` | river shore decor |
| `grass_tuft.txt` | low clump scattered at each prop's base |

All are authored at **`scale: 6`**. That's deliberate: the 6× render makes the
prop's baked 1px-grid outline **6px thick**, matching the character/enemy outline
weight so props sit in the same visual family as the cast. Runtime PNGs land in
`assets/art/forest/` (oak, pine, birch, rock, grass_tuft) and
`assets/art/props/` (reed, lilypad, flowers).

Two behaviours in `_build_open_biome` / its `place_obstacle` closure make the
props read as a natural meadow rather than a grid:

1. **Gentle per-tree size jitter.** Each placed tree gets `scale =
   randf_range(0.88, 1.10)` so no two are identical. The range is kept **tight
   on purpose**: scaling a sprite scales its baked outline too, so a big upscale
   would read as a too-thick outline versus the cast. Genuinely bigger trees
   need a bigger *spec*, authored separately — not an upscale.
2. **Grass tufts at the base.** After placing a prop, 1–2 `grass_tuft` sprites
   are scattered at its foot (drawn on top of the trunk) so the sprite's bottom
   edge melts into the meadow instead of sitting on a hard line.

Trees/rocks form the arena's collision (treeline border + ~60 scattered trees +
~14 rocks in non-home floors); flowers are pure decor placed on open cells.

To edit a prop: open it in the sprite editor under **Environment/Forest/props**,
paint the first frame, save, then re-render it with the pixel-art skill and
upscale into the right `assets/art/…` folder (props aren't covered by
`build_forest_tiles.py`, which only does tiles). Keep `scale: 6` so the outline
weight stays matched.

---

## 5. CRT filter (Forest-only post-process)

A full-screen CRT effect gives the Forest a soft old-TV look. Shader:
[`assets/shaders/crt.gdshader`](../assets/shaders/crt.gdshader) — a
`canvas_item` post-process reading the screen texture. It combines:

- **Barrel curvature** (`curvature`, higher = flatter) with a black "tube"
  border masked in beyond the curved edge.
- **Horizontal scanlines** (`scanline`) darkening every other screen row.
- **Chromatic aberration** (`aberration`, in px) splitting R/B more toward the
  edges.
- **Soft vignette** (`vignette`).

### How it's wired (in `scripts/rogue/rogue_main.gd`)

- Built by **`_apply_crt()`**, called from `_build_open_biome` **only when
  `env.name == "Forest"`**. It's a `ColorRect` (full-rect, mouse-ignored) on a
  `CanvasLayer` at `layer = 60` — above the world + HUD, below the pause menu
  (90). It's added to `_arena_nodes` so it tears down on the next floor build.
- **Defaults are baked in `_crt_cfg`** (stored 0..1, slider-friendly):
  `{"enabled": true, "curve": 0.62, "scan": 0.43, "vig": 0.06, "aberr": 0.74}`.
  `_crt_shader()` maps those onto the shader's real uniform ranges (e.g.
  `curvature = lerp(24→4, curve)`, `aberration = aberr * 3.0`).
- **Tunable live from the pause menu**: Options → **"CRT FILTER…"** page
  (`_build_crt_panel`) — an enable toggle plus sliders **Screen curve /
  Scanlines / Vignette / Colour bleed**. Each slider calls `_crt_set(...)`,
  which updates `_crt_cfg`, pushes the value onto the live material
  (`_crt_apply_live`), and **persists to `user://crt.json`** (`_crt_save`).
- On startup, `_crt_load()` reads `user://crt.json` (if present) over the baked
  defaults, so saved settings are the effective defaults next run.

To change the shipped defaults, edit `_crt_cfg` in `rogue_main.gd`. To retune the
effect's math/ranges, edit `crt.gdshader` (uniform ranges) and/or `_crt_shader()`
(the 0..1 → uniform mapping). To extend the effect to other biomes, relax the
`env.name == "Forest"` guard around the `_apply_crt()` call and in
`_crt_set_enabled`.
