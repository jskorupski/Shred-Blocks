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

### 2.1 Channel-Locked Orthogonal Swept Grid Raycast ([`src/core/physics.ts`](../src/core/physics.ts))
- **`clampGroupDragDelta(board, leadBlockId, rawDeltaX, rawDeltaY)` & `sweepBlockToTarget`**:
  - Subdivides any pointer delta $(\Delta x, \Delta y)$ into sub-steps of at most `0.05` grid cells (`MAX_SWEEP_STEP = 0.05`).
  - At each sub-step, tests the full swept bounding footprint of the dragged block **and** all active members sharing its `groupId` (`F-03` Glued Linked Groups).
  - **Channel-Locked Orthogonal Sweep (`DRAG-02`)**: Blocks move strictly along orthogonal integer grid corridors (`|row - round(row)| <= 1e-4` when moving horizontally, or `|col - round(col)| <= 1e-4` when moving vertically). A block can never occupy a diagonal half-cell `(row + 0.4, col + 0.4)`, preventing diagonal corner clipping while preserving fluid L-turn and U-turn gestures in a single continuous drag.
  - **Corner Bevel Assist (`CORNER_ASSIST_THRESHOLD = 0.30`)**: When sliding along one axis within `0.30` cells of a perpendicular integer corridor while pulling into that perpendicular lane, smoothly snaps the block onto the integer intersection and transitions into the perpendicular corridor.

### 2.2 Gate Aperture Span, Axis-Lock Exit & Mid-Drag Capture ([`src/core/gate-clearance.ts`](../src/core/gate-clearance.ts))
- **`checkBlockGateClearance(board, block, gate, candidateRow, candidateCol)` (`F-02`, `DRAG-01`)**:
  - A block can exit through `gate` if and only if:
    1. Its active top color (`getActiveColor(block.colorStack, block.colorCursor)`) is `> 0` (Neutral Stone Sliders with `color === 0` never shred!) and matches `getGateActiveColor(gate)`.
    2. **Strict Axis-Lock Gate Exit (`DRAG-01`)**: If `block.axisLock === 'H'`, `gate.edge` must be `'LEFT'` or `'RIGHT'`. If `block.axisLock === 'V'`, `gate.edge` must be `'TOP'` or `'BOTTOM'`. An axis-locked block can never exit sideways through a gate perpendicular to its rail axis.
    3. `gate.iceCount === 0` and `gate.shutterOpen === true` and `gate.shutterLockColor === 0`.
    4. If `block.isStar === true`, `gate.isStar` must also be `true`.
    5. Every cell of the block (at `candidateRow, candidateCol`) lies within `[gate.spanStart, gate.spanStart + gate.spanLength - 1]` along the gate's parallel axis, and at least one cell touches the gate's boundary row/col.
    6. No occupied cell (`occupancy !== 0` and not `block.id`) blocks the straight-line extrusion corridor between any cell of the block and the gate lip.
- **`checkMidDragGateCapture(board, blockId, stepVecX, stepVecY, rawPullX, rawPullY)` (`F-01`, `MECH-04`)**:
  - Captures and shreds a block mid-drag when it is within `0.15` cells of an integer alignment at an eligible gate lip AND either:
    - The incremental step vector has positive dot product toward the gate's outward normal (`dot > 1e-4`), OR
    - The raw pointer pull vector from the block's center has outward component `pullDot >= 0.12` (allowing blocks that start at `row = 0` or `col = 0` to shred when pulled outward against the wall clamp).
- **Outward Gate Funnel & Pointer Cancel Safety ([`src/input/pointer-controller.ts`](../src/input/pointer-controller.ts))**:
  - When a dragged block is touching the perimeter row/col and aligned with a matching gate, outward pointer pulls up to `32px` beyond the board lip clamp tangential jitter (`rawDeltaX *= 0.25` or `rawDeltaY *= 0.25`) so the block funnels cleanly into the shredder mouth.
  - Any `pointercancel`, `window.blur`, or `visibilitychange` event during an active drag cleanly snaps the dragged block (and its glued `groupId` partners) back to its last valid integer cell (`snapActiveDragToGridAndEnd`).

### 2.3 Synchronous Fixed-Point Clear Cascade (`resolveClearCascade`)
Whenever a block shreds or peels at a gate, side effects execute in a strict deterministic order:
1. **Step 1A (`triggerCarrierItems`)**: Keys (`hasKey`) unlock matching `lockId` Chained blocks; Colored Scissors (`scissorColor`) cut matching `ropeColor` ropes; Shutter Gems (`shutterGemColor`) unlock matching `shutterLockColor` gates.
2. **Step 1B (Layer Peel vs. Full Shred)**:
   - If `colorCursor + 1 < colorStack.length`, increments `colorCursor`, adds `+2` moves/sec to any active bomb on that block, detaches from any glued group, and keeps the block `ACTIVE` on the board.
   - Otherwise, marks `block.status = 'CLEARED'` and detaches from any glued group (`detachBlockFromGluedGroup` re-evaluates connected components so remaining glued partners stay intact!).
3. **Step 1C (Global Ice Thaw)**: Decrements `iceCount` by `1` on all active frozen blocks and frozen gates.
4. **Step 1D (Adjacent Wooden Crates)**: Decrements `hp` by `1` on any Wooden Crate orthogonally adjacent to the cleared block's footprint.
5. **Step 1E (`stepDynamicGatesOnShred`)**:
   - Advances `exitedGate.colorCursor` on the gate that just shredded the block.
   - Flips all unlocked `togglesOnClear` shutter gates—**with an anti-softlock parity guard (`DRAG-06`)**: if all remaining gates carrying a needed active color `C` would become closed simultaneously and no unshuttered gate of another still-needed color exists to toggle them back open, forces at least one gate of color `C` open.
   - Shifts all `slidesOnClear` gates and steps all `sizeChangesOnClear` gates—**with an anti-softlock span guard (`DRAG-07`)**: never shrinks a gate's `spanLength` below the minimum perpendicular span required by the largest remaining block of that gate's active color when it is the sole gate for that color.
6. **Step 2A (`stepMovingElevators`)**: Shifts each Moving Elevator (`F-05`) and any active blocks whose footprints are **100% contained** within the elevator platform, provided no block straddles the boundary, is immobilized, or violates a `floorColor` path.
7. **Step 2B (`trySpawnReadyGenerators`)**: Decrements generator cooldowns and spawns queued blocks at `[spawnRow, spawnCol]` when unobstructed (`F-06`).
8. **Step 2C (Isolated Cascade Check — `BUG-01`)**: Only newly spawned generator blocks or blocks shifted by a moving elevator (`allowedCascadeIds`) are checked for automatic gate clearance; unrelated blocks merely resting near another perimeter gate never auto-shred or trigger phantom gate animations.
9. **Step 3 (`autoAdvanceColorQueues` — `BUG-02`)**: Single-pass check per shred event that advances any Color-Changing Gate whose front color has `0` remaining supply across active blocks and generators (`F-08`).

---

## 3. 4-Pass WebGL2 Renderer & Architectural Sanctuary Shader Pipeline

[`src/render/renderer-3d.ts`](../src/render/renderer-3d.ts) renders each frame in 4 GPU passes:
1. **Pass 1 (`renderPass1Environment`)**:
   - Draws the 3-tier **Stepped Architectural Sanctuary Plinth** (`z = -0.50`, `-0.34`, `-0.18`), interior recessed courtyard tiles, cutouts, stone pillars, elevator rails, generator housings, wooden crates, and perimeter shredder gates (with toothed rollers that spin cleanly at `2.0 rad/s` on standby and `18.0 rad/s` **only** on the specific gate actively shredding or aligned with a dragged block (`BUG-03`), queued color indicator bars in dark bezels, star emblems, ice shells, and shutter bars).
2. **Pass 2 (`renderPass2ReticleAndPrompts`)**:
   - Draws the snapped grid shadow reticle, green alignment beam when aligned with an eligible shredder gate, solver hint / `autoGuideMove` highlights (`source` + `target` cells + 3 stepping floor chevrons), isolated 3D circular shockwave rings (`this.activeShockwaves` using `ENVIRONMENT_MESHES.shockwaveRingMesh` triggered only on the specific gate and blocks whose state changed (`BUG-04`)), and booster targeting highlights (`HAMMER`, `ROCKET`, `VACUUM`).
3. **Pass 3 (`renderPass3Blocks`)**:
   - Renders each active 3D polyomino block (and any active visual shred animation) using hardware clip planes (`u_useClipPlane`) as the block slices through the gate plane, plus inner multi-layer cores, chamfered 3D top studs (`addCylinderCapToBuilder`), glued solder bridges, **3D beveled side-flange Axis-Lock guide rails** (`railBeamMesh` tinted with block-harmonized `entry.lipHex` + warm champagne metallic cap, leaving top circular studs 100% uncovered), **sculpted 3D circular/octagonal badge medallions** (`drawBadgeMedallion3D` in [`src/render/atlas-3d.ts`](../src/render/atlas-3d.ts)), **hollow 3D beveled perimeter move-guide frames** (`drawHollowMoveGuideFrame`), and `AX-01` colorblind symbols on every stud.
   - **Grabbed Block Focus & Centroid Compensation**: Grabbed blocks (and any glued `groupId` partners) elevate by `BLOCK_LIFT_DELTA_Z = 0.46`, scale by `1.05x` in XY (shifting `(meshTx, meshTy)` by `-(scaleXY - 1.0) * shape.cols * 0.5` so scaling occurs around the polyomino's geometric center), cast an offset floor drop shadow, and render a pulsing golden-white selection rim halo while non-grabbed blocks dim to `0.88x`.
   - **Sunlit & Twilight Directional Lighting**: `MAIN_FRAGMENT_SHADER` blends a warm sunlit key light (`vec3(1.04, 0.98, 0.92)`) on top faces/stud bevels with a cool twilight shadow tint (`vec3(0.90, 0.88, 1.03)`) on side faces.
4. **Pass 4 (`renderPass4Particles`)**:
   - Single-draw-call GPU-instanced 3D particle system (`gl.drawArraysInstanced`, `MAX_PARTICLES = 2048`) supporting 5 distinct geometric styles (`micro_cubes`, `star_confetti`, `pixel_sparks`, `soap_bubbles`, `lightning_bolts`).

---

## 4. 300-Level Progression Epochs & Fun-First Difficulty Ramp (`RAMP-01`–`RAMP-05`)

1. **Progressive Courtyard Scaling Across 6 Architectural Epochs (`1..300`, Endless `301+`)**:
   - **Epoch I (`Levels 1–15`, `5×5`)**: Onboarding Sanctuary (`3–4` blocks, `2–3` colors, Axis-Lock debut at `L11`).
   - **Epoch II (`Levels 16–40`, `6×6`)**: Courtyard Expansion (`4–5` blocks, Cutouts & Pillars at `L21`, Multi-Layer at `L31`).
   - **Epoch III (`Levels 41–80`, `6×7`)**: Tactical Chambers (`5–6` blocks, Ice `L41`, Stars `L51`, Keys `L61`, Neutral Stone `L71`).
   - **Epoch IV (`Levels 81–140`, `7×7`)**: Grand Plaza (`6–7` blocks, Crates `L81`, Bombs `L91`, Glued Groups `L101`, Ropes `L111`, Color Queue Gates `L121`, Frozen Gates `L131`).
   - **Epoch V (`Levels 141–220`, `7×8` & `8×8`)**: Kinetic Machinery (`6–8` blocks, Shutters `L141/145`, Sliding/Resizing Gates `L151/155`, Generators `L161`, Floor Paths `L171`, Elevators `L181`, Milestone `L200`).
   - **Epoch VI (`Levels 221–300`, `8×8` & `9×9`)**: Monumental Mastery (`7–9` blocks, `4–6` colors, culminating in the `9×9` Grand Citadel Finale at `Level 300`, followed by seeded Endless Mastery at `Level 301+`).
2. **Adding or Modifying a Campaign Level ([`src/levels/catalog.ts`](../src/levels/catalog.ts) / [`src/levels/generator.ts`](../src/levels/generator.ts))**:
   - Preserve the **Fun-First Difficulty Ramp Invariants (`RAMP-01`–`RAMP-05`)**: every 5th level (`15, 20, 25, ...`) is a `NORMAL` breather level; never stack two movement-blocking modifiers on the same block (`canAddBlockModifier`); keep gate apertures generous (`>= 3` on `7×7+` boards); and ensure zero overlapping cells in the initial block/pillar/crate/cutout layout.
   - Run `npm run test:unit` to verify that `solveBoard()` solves all 300 campaign levels with `0` fallback steps, zero cell overlaps, and `verifyFirstMoveSafety()` on levels `1..30`.
3. **Progressive Power-Up Unlocking, Rarity Tiers & Navigation Invariants (`ECON-01`–`ECON-04`)**:
   - **Gradual Power-Up Introduction (`BOOSTER_UNLOCK_LEVEL`)**: `UNDO` (`COMMON`, Lvl 1), `FREEZE` (`UNCOMMON`, Lvl 2), `HAMMER` (`RARE`, Lvl 8), `ROCKET` (`EPIC`, Lvl 18), `VACUUM` (`LEGENDARY`, Lvl 30).
   - **Rarity-Weighted & Level-Gated Chest Drops (`pickRarityWeightedBooster`)**: Shredder Chests (`42% / 30% / 16% / 8% / 4%`) and Milestone Chests (`20% / 28% / 26% / 16% / 10%`, plus guaranteed debut drops at `L10`, `L20`, `L30`) filter out any booster whose unlock level exceeds `effectiveLevel` so players never receive locked items and high-tier boosters remain special and scarce.
   - **1-Tap Sanctuary Map Return**: Direct `‹ Map` navigation buttons (`#btn-hud-home`, `#btn-themes-home`, `#btn-victory-home`, `#btn-failure-home`, and above-the-fold `#btn-pause-home`) must remain immediately accessible so returning from the game board or modals to `#screen-home` never requires scrolling or hunting through nested menus.
4. **Adding a New Cosmetic Theme**:
   - Register the ID in `SkinId`, `TrayId`, or `ParticleStyleId` in [`src/core/types.ts`](../src/core/types.ts).
   - Add the catalog entry in [`src/main.ts`](../src/main.ts) and the `.swatch-<id>` preview in [`src/styles/main.css`](../src/styles/main.css).
   - Add the shader/palette branch in [`src/render/renderer-3d.ts`](../src/render/renderer-3d.ts).
