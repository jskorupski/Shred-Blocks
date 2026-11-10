# ShredBlocks: Color Jam — Architecture, Invariants & Extension Rules

This document provides the deep-dive technical specification for **ShredBlocks: Color Jam**, designed for both human engineers and autonomous coding agents extending or maintaining the codebase.

---

## 1. Coordinate Systems & 3D Camera Mathematics

### 1.1 Board Grid vs. 3D World Space
- **Grid Coordinates (`row, col`)**:
  - `row` $\in [0, \text{rows} - 1]$ increases **top-to-bottom** (North $\rightarrow$ South).
  - `col` $\in [0, \text{cols} - 1]$ increases **left-to-right** (West $\rightarrow$ East).
- **3D World Space (`x, y, z`)** ([`src/render/camera-3d.ts`](../src/render/camera-3d.ts)):
  - `x` corresponds to `col` ($x \in [0, \text{cols}]$).
  - `y` corresponds to `row` ($y \in [0, \text{rows}]$).
  - `z` is the vertical elevation axis above the courtyard floor ($z = 0$ is the floor tile surface; resting block top surface is `BLOCK_TOP_Z = 0.58`; lifted dragged block delta is `BLOCK_LIFT_DELTA_Z = 0.18`).
- **Exact Ray-Plane Unprojection (`screenToBoardRayPlane`)**:
  - The camera tilts at `52°` from horizontal with a `34°` vertical FOV and frames `rows + 1.55` × `cols + 1.55` world units so perimeter shredder gates and the 3-tier stepped architectural plinth remain 100% inside the viewport across all aspect ratios.
  - Pointer `clientX, clientY` coordinates are unprojected via the inverse View-Projection matrix (`invViewProj`) onto the horizontal plane $z = 0.58$, yielding zero-parallax 1:1 finger/cursor tracking (`UX-01`).

---

## 2. Physics, Swept Raycast & Gate Clearance Invariants

### 2.1 Dominant-Axis Swept Grid Raycast & Open-Space 2D Glide ([`src/core/physics.ts`](../src/core/physics.ts))
- **`sweepBlockToTarget(board, blockId, targetX, targetY, onSubstep)` (`DRAG-02`, `DRAG-04`)**:
  - Subdivides any pointer delta $(\Delta x, \Delta y)$ into sub-steps of at most `0.18` grid cells (`MAX_SWEEP_SUBSTEP = 0.18`).
  - At each sub-step, tests the full continuous bounding footprint (`isContinuousOffsetValid`) of the dragged block **and** all active members sharing its `groupId` (`F-03` Glued Linked Groups).
  - **Open-Space 2D Glide + Exact Obstacle-Edge Clamping (`DRAG-04`, `F-04`)**: Sweeps the dominant remaining axis first and the secondary axis second (`sweepSingleAxisWithClamp`). In unobstructed open space, both axes glide smoothly and continuously (`0` artificial 1D rail-locks or half-cell `[0.30, 0.70]` deadzones); when an obstacle or wall is encountered, movement clamps cleanly to the exact integer contact boundary (`F-04`).
  - **Grid-Intersection Landing & Corner Bevel Assist (`DRAG-02`, `CORNER_BEVEL_THRESHOLD = 0.35`)**: When a substep has significant perpendicular pull (`> 0.12`), `computeSubstepDelta` lands cleanly on any crossed integer grid line so the block can turn `90°` into narrow perpendicular corridors (`DRAG-02`). When an axis is blocked by an obstacle corner within `0.35` cells (`CORNER_BEVEL_THRESHOLD`), `tryCornerBevelAssist` smoothly snaps the perpendicular offset to the unobstructed integer lane (`with 0.08 hysteresis` to prevent diagonal corner oscillation).

### 2.2 Gate Aperture Span, Axis-Lock Exit & Mid-Drag Capture ([`src/core/gate-clearance.ts`](../src/core/gate-clearance.ts))
- **`checkBlockGateClearance(board, block, gate, candidateRow, candidateCol)` (`F-02`, `DRAG-01`)**:
  - A block can exit through `gate` if and only if:
    1. Its active top color (`getActiveColor(block.colorStack, block.colorCursor)`) is `> 0` (Neutral Stone Sliders with `color === 0` never shred!) and matches `getGateActiveColor(gate)`.
    2. **Strict Axis-Lock Gate Exit (`DRAG-01`)**: If `block.axisLock === 'H'`, `gate.edge` must be `'LEFT'` or `'RIGHT'`. If `block.axisLock === 'V'`, `gate.edge` must be `'TOP'` or `'BOTTOM'`. An axis-locked block can never exit sideways through a gate perpendicular to its rail axis.
    3. `gate.iceCount === 0` and `gate.shutterOpen === true` and `gate.shutterLockColor === 0`.
    4. If `block.isStar === true`, `gate.isStar` must also be `true`.
    5. Every cell of the block (at `candidateRow, candidateCol`) lies within `[gate.spanStart, gate.spanStart + gate.spanLength - 1]` along the gate's parallel axis, and at least one cell touches the gate's boundary row/col (`gate.edgeLine`, supporting both outer perimeter gates and **Stepped-Edge Exit Gates (`GATE-STEP-01`)** mounted on recessed inner courtyard ledges).
    6. No occupied cell (`occupancy !== 0` and not `block.id`) blocks the straight-line extrusion corridor between any cell of the block and `gate.edgeLine`.
    7. **Multi-Room Portcullis Sanctum & Sealed Mystery Vault Gating (`SANCTUM-01`, `SANCTUM-02`, `VAULT-01`, `GATE-ICE-01`)**: Neither the block (`isBlockInLockedRoom` / `isBlockInSealedVault`) nor a threshold-gated exit gate (`isGateInLockedRoom`) may belong to a sealed room (`roomId > 0` where an active `BarrierState` with `unlocksRoomId === roomId` has `open === false`). For in-board Sealed Mystery Vaults (`bar.isVault === true`), `isGateInLockedRoom` ignores `bar.isVault` so perimeter Frozen Gates (`gate.iceCount > 0`) remain active on the outer wall from `t = 0` and thaw in lockstep with vault countdowns.
- **`checkMidDragGateCapture(board, blockId, stepVecX, stepVecY, rawPullX, rawPullY)` (`F-01`, `MECH-04`)**:
  - Captures and shreds a block mid-drag when it is within `0.18` cells of an eligible gate lip (`gate.edgeLine`), lies anywhere across the gate's continuous parallel span aperture (`[minSpan - 0.45, maxSpan + 0.45]` — eliminating mid-gate `Math.round` deadzones at half-cell `0.50` offsets on wide gates), AND either:
    - The incremental step vector has positive dot product toward the gate's outward normal (`dot > 1e-4`), OR
    - The raw pointer pull vector from the block's center has outward component `pullDot >= 0.08` (`>= 0.12` on the outer `0.25..0.45` bevel jaw), allowing both smooth curved/diagonal entries into wide gates and outward pulls from blocks starting at `gate.edgeLine`.
- **Outward Gate Funnel, Sealed Vault Hit-Slop Guard & Pointer Cancel Safety ([`src/input/pointer-controller.ts`](../src/input/pointer-controller.ts), [`src/input/targeting-and-keyboard.ts`](../src/input/targeting-and-keyboard.ts))**:
  - When a dragged block is touching `gate.edgeLine` and aligned with a matching gate, outward pointer pulls up to `32px` beyond the gate lip clamp tangential jitter (`rawDeltaX *= 0.25` or `rawDeltaY *= 0.25`) so the block funnels cleanly into the shredder mouth.
  - `pickBlockAtBoardPoint` checks `getSealedVaultAtCell(board, Math.floor(boardY), Math.floor(boardX))` before the `0.22`-cell halo fallback (`return null`), and `handlePointerDown` triggers `onLockedVaultTap(sealedVault)` (`"🔒 Sealed Mystery Vault: Shred N more blocks to reveal hidden blocks!"`).
  - Tapping a dormant block inside a sealed Sunken Twilight Chamber (`isBlockInLockedRoom`) triggers a gentle rebound shake and displays a clear `"⛩ Chamber Sealed! Shred N more blocks to open the Portcullis."` toast.
  - Any `pointercancel`, `window.blur`, or `visibilitychange` event during an active drag cleanly snaps the dragged block (and its glued `groupId` partners) back to its last valid integer cell (`snapActiveDragToGridAndEnd`).

### 2.3 Synchronous Fixed-Point Clear Cascade (`resolveClearCascade`)
Whenever a block shreds or peels at a gate, side effects execute in a strict deterministic order:
1. **Step 1A (`triggerCarrierItems`)**: Keys (`hasKey`) unlock matching `lockId` Chained blocks and Key-locked Portcullis Barriers (`bar.lockId === keyId`); Colored Scissors (`scissorColor`) cut matching `ropeColor` ropes; Shutter Gems (`shutterGemColor`) unlock matching `shutterLockColor` gates.
2. **Step 1B (Layer Peel vs. Full Shred)**:
   - If `colorCursor + 1 < colorStack.length`, increments `colorCursor`, adds `+2` moves/sec to any active bomb on that block, detaches from any glued group, and keeps the block `ACTIVE` on the board.
   - Otherwise, marks `block.status = 'CLEARED'` and detaches from any glued group (`detachBlockFromGluedGroup` re-evaluates connected components so remaining glued partners stay intact!).
3. **Step 1C (Global Ice Thaw & Progressive Portcullis / Mystery Vault Countdown — `stepPortcullisBarriersOnShred`)**:
   - Decrements `iceCount` by `1` on all active frozen blocks and frozen gates (skipping dormant blocks/gates inside still-locked rooms).
   - Evaluates closed Portcullis Barriers and Sealed Mystery Vaults (`bar.shredsRemaining > 0`) in ascending `shredsRemaining` order against a cumulative reachable-layer & key budget (`cumulativeLayers` / `cumulativeKeys`) so progressive multi-vault boards (`Level 74`) never prematurely clamp higher-threshold vaults. When `shredsRemaining` reaches `0` (and `lockId === 0`), opens the barrier/vault (`bar.open = true`), vacates its `occupancy = -3` cells via `rebuildOccupancyGrid`, and reveals the blocks underneath (`unlockedBarrierIds`).
4. **Step 1D (Adjacent Wooden Crates)**: Decrements `hp` by `1` on any Wooden Crate orthogonally adjacent to the cleared block's footprint.
5. **Step 1E (`stepDynamicGatesOnShred`)**:
   - Advances `exitedGate.colorCursor` on the gate that just shredded the block.
   - Flips all unlocked `togglesOnClear` shutter gates—**with an anti-softlock parity guard (`DRAG-06`)**: if all remaining gates carrying a needed active color `C` would become closed simultaneously and no unshuttered gate of another still-needed color exists to toggle them back open, forces at least one gate of color `C` open.
   - Shifts all `slidesOnClear` gates and steps all `sizeChangesOnClear` gates—**with an anti-softlock span guard (`DRAG-07`)**: never shrinks a gate's `spanLength` below the minimum perpendicular span required by the largest remaining block of that gate's active color when it is the sole gate for that color.
6. **Step 2A (`stepMovingElevators`)**: Shifts each Moving Elevator (`F-05`) and any active blocks whose footprints are **100% contained** within the elevator platform, provided no block straddles the boundary, is immobilized, or violates a `floorColor` path.
7. **Step 2B (`trySpawnReadyGenerators`)**: Decrements generator cooldowns and spawns queued blocks at `[spawnRow, spawnCol]` when unobstructed (`F-06`).
8. **Step 2C (Strict Cascade Isolation)**: Only newly spawned generator blocks or blocks actively involved in the current move (`allowedCascadeIds`) are checked for automatic gate clearance; unrelated stationary blocks resting near another perimeter gate never auto-shred or trigger phantom gate animations.
9. **Step 3 (`autoAdvanceColorQueues` — Single-Pass Queue Auto-Advance & Vault-Supply Swap)**: Advances any unlocked-room Color-Changing Gate whose front color has `0` total remaining supply (`F-08`), or swaps `gate.colorQueue[gate.colorCursor]` with the next queued color that has `unlockedSupply[nextC] > 0` if all remaining blocks of the front color are currently sealed inside closed Mystery Vaults/chambers.

---

## 3. 4-Pass WebGL2 Renderer & Architectural Sanctuary Shader Pipeline

[`src/render/renderer-3d.ts`](../src/render/renderer-3d.ts) renders each frame in 4 GPU passes:
1. **Pass 1 (`renderPass1Environment` — [`pass1-courtyard.ts`](../src/render/pass1-courtyard.ts) & [`pass1-gates-barriers.ts`](../src/render/pass1-gates-barriers.ts))**:
   - Draws the 3-tier **Stepped Architectural Sanctuary Plinth** (`z = -0.50`, `-0.34`, `-0.18`, merged into contiguous row spans via `plinthSpans` for non-rectangular and multi-room courtyards), interior recessed courtyard tiles, cutouts, stone pillars, elevator rails, generator housings, wooden crates, and perimeter shredder gates (with toothed rollers that spin cleanly at `1.35 rad/s` on standby and `18.0 rad/s` **only** on the specific gate actively shredding or aligned with a dragged block, queued color indicator bars in dark bezels, star emblems, **3D Sculpted Frost Medallions (`[❄️ N]` via `drawBadgeMedallion3D`)** on Frozen Gates, and shutter bars).
2. **Pass 2 (`renderPass2BarriersAndReticles` — [`pass2-barriers-and-reticles.ts`](../src/render/pass2-barriers-and-reticles.ts))**:
   - Draws threshold **3D Sanctuary Portcullis Barriers (`⛩ N`)**, **3D Carved Sanctuary Mystery Vault Lids (`bar.isVault === true`, `materialStyle = 2`)** with gilded bronze frames, recessed indigo-violet coffered slabs, 3D horizontal louver ribs, 4 corner bronze bolsters, and elevated `[🔒 N]` medallions (plus flush `Z = 0.008` corner brass inlays once unsealed), snapped grid shadow reticles, green alignment beams, solver hint chevrons, isolated 3D circular shockwave rings (`this.activeShockwaves`), and booster targeting highlights (`HAMMER`, `ROCKET`, `VACUUM`).
3. **Pass 3 (`renderPass3Blocks` — [`pass3-block-shells.ts`](../src/render/pass3-block-shells.ts) & [`pass3-block-overlays.ts`](../src/render/pass3-block-overlays.ts))**:
   - Renders each active unlocked 3D polyomino block (skipping blocks and glued weld clamps concealed inside sealed Mystery Vaults via `isBlockInSealedVault`) and any active visual shred animation using hardware clip planes (`u_useClipPlane`) as the block slices through the gate plane, plus inner multi-layer cores, chamfered 3D top studs (`addCylinderCapToBuilder`), glued solder bridges, **3D beveled side-flange Axis-Lock guide rails** (`railBeamMesh` tinted with block-harmonized `entry.lipHex` + warm champagne metallic cap, leaving top circular studs 100% uncovered), **sculpted 3D circular/octagonal badge medallions** (`drawBadgeMedallion3D` in [`src/render/atlas-3d.ts`](../src/render/atlas-3d.ts)), **hollow 3D beveled perimeter move-guide frames** (`drawHollowMoveGuideFrame`), and `AX-01` colorblind symbols (`CB_0..9` on dark obsidian circular medallions).
   - **Grabbed Block Focus & Centroid Compensation**: Grabbed blocks (and any glued `groupId` partners) elevate by `BLOCK_LIFT_DELTA_Z = 0.46`, scale by `1.05x` in XY (shifting `(meshTx, meshTy)` by `-(scaleXY - 1.0) * shape.cols * 0.5` so scaling occurs around the polyomino's geometric center), cast an offset floor drop shadow, and render a pulsing golden-white selection rim halo while non-grabbed blocks dim to `0.88x`.
   - **Sunlit & Twilight Directional Lighting**: `MAIN_FRAGMENT_SHADER` blends a warm sunlit key light (`vec3(1.04, 0.98, 0.92)`) on top faces/stud bevels with a cool twilight shadow tint (`vec3(0.90, 0.88, 1.03)`) on side faces.
4. **Pass 4 (`renderPass4Particles`)**:
   - Single-draw-call GPU-instanced 3D particle system (`gl.drawArraysInstanced`, `MAX_PARTICLES = 2048`) supporting 5 distinct geometric styles (`micro_cubes`, `star_confetti`, `pixel_sparks`, `soap_bubbles`, `lightning_bolts`).

### 3.1 Canonical 3D Block Top-Surface Z-Layer Hierarchy
Because WebGL depth testing (`gl.DEPTH_TEST`, `gl.LEQUAL`) is active during Pass 3, every element rendered on top of a block must obey this strict vertical `Z` hierarchy (relative to `zLift`, scaled by `scaleZ`):

| Layer / Feature | Relative `Z` Elevation | Notes |
| :--- | :--- | :--- |
| **Courtyard Floor Tile** | `0.000` (`-0.042` in sealed chambers) | Sunken Twilight Chambers (`roomId > 0` while locked) sit `-0.042` lower and smoothly rise to `0.000` when unlocked. |
| **Block Top Face** | `0.580` | Base top face of all 19 polyomino shapes (`BLOCK_TOP_Z = 0.58`). |
| **3D Straps, Chains, Ropes & Axis-Lock Side Rails** | `0.588 .. 0.626` | Side-flange rails (`0.13` / `0.87`) leave the central `[0.34, 0.66]` circular stud zone 100% uncovered. |
| **Multi-Layer Inner Core Top Face** | `0.602` | Exposed through the outer shell's central cutout window on multi-layer blocks. |
| **3D Beveled Obstacle Medallions (`drawBadgeMedallion3D`)** | `0.562 .. 0.648` | Two-tiered 3D plinths for Axis-Lock chevrons, Ice, Bombs, Keys, Locks, Scissors, Gems, and Stars; glyphs sit at `0.651`. |
| **Outer Shell 3D Circular Studs** | `0.660` | Present on `classic_studs`, `gummy_jelly`, and `neon_cyber` skins (`0.580 + 0.080`). |
| **Inner Multi-Layer Core 3D Studs** | `0.677` | Present on `classic_studs`, `gummy_jelly`, and `neon_cyber` multi-layer cores (`0.602 + 0.075`). |
| **Colorblind Symbol Medallions (`zCbSymbol`)** | `0.692` (`0.696` inner core) | Renders above all studs, straps, and medallions across all 5 skins; shifts to top-left collar `(0.21, 0.21)` on multi-layer or center-badged cells so outer and inner symbols never overlap. |

### 3.2 High-Contrast, Custom Themes & Wall-Scroll Blueprint Shader Pipeline
- **High-Contrast Tray & Block Palettes (`AX-02`)**: When `highContrast === true`, `getEffectiveTrayPalette(trayId, true)` selects from `HIGH_CONTRAST_TRAY_PALETTES` (deep obsidian-slate floors and dark borders for all 5 Board Trays, including light trays like `warm_birch`, `frosted_quartz`, and `mint_studio`), `getColorRgb(color, true)` selects high-luminance `hcRgb` block colors, and `u_highContrast = 1.0` boosts fragment rim contrast across all 5 Block Skins.
- **Sacred-Geometry Wall-Scroll Diagram (`u_blueprintMix`)**: While `#title-overlay` is open (`blueprintMix = 1.0`), `MAIN_FRAGMENT_SHADER` transforms any rectangular, sculpted (`L14+`), or multi-room (`L25+`) courtyard into a warm parchment & bronze-gold architectural blueprint (`materialStyle = 5` ink outlines on blocks, gates, pillars, and portcullis barriers) and smoothly interpolates to `0.0` over `0.72s` when entering gameplay.

---

## 4. 300-Level Progression Epochs & Fun-First Difficulty Ramp (`RAMP-01`–`RAMP-05`)

1. **Progressive Courtyard Scaling Across 6 Architectural Epochs (`1..300`, Endless `301+`)**:
   - **Epoch I (`Levels 1–15`, `5×5`)**: Onboarding Sanctuary (`3–6` blocks, `5` on breathers, `2–3` colors, Axis-Lock debut at `L11`, Sculpted Courtyard `CROSS_ATRIUM` debut at `L14`).
   - **Epoch II (`Levels 16–40`, `6×6` & `8×6` Tall Portrait)**: Courtyard Expansion (`6–13` blocks, `5–6` on breathers, Stepped-Edge Exit Gates on `L_WING` at `L18`, Cutouts & Pillars at `L21`, Multi-Room Portcullis Sanctum `9` blocks at `L25`, **Sealed Mystery Vaults** `12` blocks at `L28`, Multi-Layer at `L31`, Central Hourglass Mystery Vault Island `13` blocks at `L38`).
   - **Epoch III (`Levels 41–80`, `6×7`, `8×6` & `9×7` Tall Portrait)**: Tactical Chambers (`7–16` blocks across High-Density Stage-Partitioned Courtyard Packing `DENSITY-01`, `7` on breathers, Ice `L41`, Stars `L51`, Keys `L61`, Neutral Stone `L71`, **Quad Vault Sanctum** `16`-block multi-vault showcase at `L74`).
   - **Epoch IV (`Levels 81–140`, `7×7` & `9×7` Tall Portrait)**: Grand Plaza (`7–11` blocks, `7` on breathers, Crates `L81`, Bombs `L91`, Glued Groups `L101`, Ropes `L111`, Color Queue Gates `L121`, Frozen Gates `L131`).
   - **Epoch V (`Levels 141–220`, `7×8`, `8×8` & `9×7` Tall Portrait)**: Kinetic Machinery (`8–12` blocks, `8` on breathers, Shutters `L141/145`, Sliding/Resizing Gates `L151/155`, Generators `L161`, Floor Paths `L171`, Elevators `L181`, Milestone `L200` with `10` blocks).
   - **Epoch VI (`Levels 221–300`, `8×8`, `9×9` & `10×8` Tall Portrait)**: Monumental Mastery (`9–14` blocks, `9` on breathers, `4–6` colors, Milestone `L250` with `12` blocks, culminating in the `14`-block `9×9` Grand Citadel Finale at `Level 300`, followed by seeded Endless Mastery at `Level 301+`).
   - **Sealed Mystery Vaults & Synchronized Gate Countdowns (`VAULT-01`, `VAULT-02`, `PORTRAIT-01`..`02`, `GATE-ICE-01`)**:
     - Sealed Mystery Vaults (`bar.isVault === true`) cover rectangular `W×H` sub-regions (`occupancy === -3`), conceal all blocks inside (`isBlockInSealedVault`) in complete stasis until `bar.shredsRemaining` reaches `0` (evaluated in ascending `shredsRemaining` order with a cumulative reachable-layer Zero-Softlock guard in `stepPortcullisBarriersOnShred`), and allow perimeter Frozen Gates (`isGateInLockedRoom === false` for `bar.isVault`) to thaw on every shred from `t = 0`.
     - `#game-canvas` dynamically updates `--board-aspect = clamp(0.65, (cols + 1.55) / (rows + 1.55), 1.25)` so tall portrait boards (`rows > cols`) expand vertically inside `.board-stage` on mobile portrait without shrinking cell width.
2. **Adding or Modifying a Campaign Level ([`src/levels/catalog.ts`](../src/levels/catalog.ts) / [`src/levels/generator.ts`](../src/levels/generator.ts))**:
   - Preserve the **Fun-First Difficulty Ramp Invariants (`RAMP-01`–`RAMP-05`)**: every 5th level (`15, 20, 25, ...`) and `decPos === 6` wave (`16, 26, 36, ...`) is an epoch-scaled `NORMAL` breather level (`5 -> 9` blocks); never stack two movement-blocking modifiers on the same block (`canAddBlockModifier`); keep gate apertures generous (`>= 3` on `7×7+` boards); and ensure zero overlapping cells in the initial block/pillar/crate/cutout layout.
   - Run `npm run test:unit` to verify that `solveBoard()` solves all 300 campaign levels with `0` fallback steps, zero cell overlaps, and `verifyFirstMoveSafety()` on levels `1..30`.
3. **Progressive Power-Up Unlocking, Rarity Tiers & Navigation Invariants (`ECON-01`–`ECON-04`)**:
   - **Gradual Power-Up Introduction (`BOOSTER_UNLOCK_LEVEL`)**: `UNDO` (`COMMON`, Lvl 1), `FREEZE` (`UNCOMMON`, Lvl 2), `HAMMER` (`RARE`, Lvl 8), `ROCKET` (`EPIC`, Lvl 18), `VACUUM` (`LEGENDARY`, Lvl 30).
   - **Rarity-Weighted & Level-Gated Chest Drops (`pickRarityWeightedBooster`)**: Shredder Chests (`42% / 30% / 16% / 8% / 4%`) and Milestone Chests (`20% / 28% / 26% / 16% / 10%`, plus guaranteed debut drops at `L10`, `L20`, `L30`) filter out any booster whose unlock level exceeds `effectiveLevel` so players never receive locked items and high-tier boosters remain special and scarce.
   - **1-Tap Sanctuary Map Return**: Direct `‹ Map` navigation buttons (`#btn-hud-home`, `#btn-themes-home`, `#btn-victory-home`, `#btn-failure-home`, and above-the-fold `#btn-pause-home`) must remain immediately accessible so returning from the game board or modals to `#screen-home` never requires scrolling or hunting through nested menus.
4. **Adding a New Cosmetic Theme**:
   - Register the ID in `SkinId`, `TrayId`, or `ParticleStyleId` in [`src/core/types.ts`](../src/core/types.ts).
   - Add the catalog entry in [`src/ui/catalog-meta.ts`](../src/ui/catalog-meta.ts) (re-exported by [`src/main.ts`](../src/main.ts)) and the `.swatch-<id>` preview in [`src/styles/themes-and-nav.css`](../src/styles/themes-and-nav.css).
   - Add the shader/palette branch in [`src/render/render-types.ts`](../src/render/render-types.ts) and [`src/render/shaders-3d.ts`](../src/render/shaders-3d.ts) (orchestrated by [`src/render/renderer-3d.ts`](../src/render/renderer-3d.ts)).
5. **Agentic Ergonomics & Single-Call File-Size Invariant (`ARCH-ERGONOMICS-01`)**:
   - Every source, stylesheet, HTML, test, script, and documentation file must remain `<= 800 lines` and `<= 45,000 bytes` (ideal target `<= 750 lines`), verified automatically by `ARCH-ERGONOMICS-01` in [`tests/unit/sanctums-and-architecture.test.ts`](../tests/unit/sanctums-and-architecture.test.ts).
   - Multi-pass render logic is modularized across [`src/render/pass1-courtyard.ts`](../src/render/pass1-courtyard.ts), [`src/render/pass1-gates-barriers.ts`](../src/render/pass1-gates-barriers.ts), [`src/render/pass2-barriers-and-reticles.ts`](../src/render/pass2-barriers-and-reticles.ts), [`src/render/pass3-block-shells.ts`](../src/render/pass3-block-shells.ts), [`src/render/pass3-block-overlays.ts`](../src/render/pass3-block-overlays.ts), [`src/render/particle-fx.ts`](../src/render/particle-fx.ts), and [`src/render/canvas2d-fallback.ts`](../src/render/canvas2d-fallback.ts) via `RenderPassContext` (implemented directly by `Renderer3D` with zero per-frame wrapper allocations).
   - UI views and modal templates are modularized across [`src/ui/catalog-meta.ts`](../src/ui/catalog-meta.ts), [`src/ui/dialogs-template.ts`](../src/ui/dialogs-template.ts), [`src/ui/hud-and-title-view.ts`](../src/ui/hud-and-title-view.ts), [`src/ui/roadmap-and-themes-view.ts`](../src/ui/roadmap-and-themes-view.ts), [`src/ui/modals-and-save-transfer.ts`](../src/ui/modals-and-save-transfer.ts), and [`src/ui/dom-events-and-pwa.ts`](../src/ui/dom-events-and-pwa.ts) via `AppViewContext` (implemented directly by `ShredBlocksApp`).
