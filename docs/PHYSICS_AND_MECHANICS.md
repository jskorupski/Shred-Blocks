# Physics, Coordinate Systems & 18-Mechanic Clear Cascades

On-demand reference for **3D camera/grid math**, **swept polyomino physics**, **gate clearance & mid-drag capture**, **Sealed Mystery Vault stasis**, and **deterministic post-shred clear cascades**. Read this before modifying `src/core/*`, `src/input/*`, or `src/render/camera-3d.ts`.

---

## 1. Coordinate Systems & 3D Camera Mathematics

- **Grid Coordinates (`row, col`)**:
  - `row` $\in [0, \text{rows} - 1]$ increases **top-to-bottom** (North $\rightarrow$ South).
  - `col` $\in [0, \text{cols} - 1]$ increases **left-to-right** (West $\rightarrow$ East).
- **3D World Space (`x, y, z`)** ([`src/render/camera-3d.ts`](../src/render/camera-3d.ts)):
  - `x` corresponds to `col` ($x \in [0, \text{cols}]$); `y` corresponds to `row` ($y \in [0, \text{rows}]$).
  - `z` is vertical elevation above the courtyard floor ($z = 0$ floor tile surface; resting block top `BLOCK_TOP_Z = 0.58`; grabbed lift delta `BLOCK_LIFT_DELTA_Z = 0.46` in Pass 3, ray-plane hit at $z = 0.58$).
- **Exact Ray-Plane Unprojection (`screenToBoardRayPlane`, `UX-01`)**:
  - Camera tilts at `52°` from horizontal with a `34°` vertical FOV and frames `rows + 1.55` × `cols + 1.55` world units so perimeter shredder gates and the 3-tier stepped architectural plinth stay 100% inside the viewport across all aspect ratios.
  - Pointer `(clientX, clientY)` unprojects via `invViewProj` onto $z = 0.58$ for zero-parallax 1:1 finger/cursor tracking.

---

## 2. Swept Grid Raycast & Open-Space 2D Glide ([`src/core/physics.ts`](../src/core/physics.ts))

- **`sweepBlockToTarget(board, blockId, targetX, targetY, onSubstep)` (`DRAG-02`, `DRAG-04`, `F-03`, `F-04`)**:
  - Subdivides any pointer delta $(\Delta x, \Delta y)$ into sub-steps of at most `0.18` grid cells (`MAX_SWEEP_SUBSTEP = 0.18`).
  - Tests the full continuous bounding footprint (`isContinuousOffsetValid`) of the dragged block **and** all active members sharing its `groupId` (`F-03` Glued Linked Groups).
  - **Open-Space 2D Glide + Exact Obstacle-Edge Clamping (`DRAG-04`, `F-04`)**: Sweeps the dominant remaining axis first and the secondary axis second (`sweepSingleAxisWithClamp`). In unobstructed open space, both axes glide smoothly and continuously (`0` artificial 1D rail-locks or `[0.30, 0.70]` deadzones); on wall/obstacle contact, movement clamps cleanly to the integer contact boundary.
  - **Grid-Intersection Landing & Corner Bevel Assist (`DRAG-02`, `CORNER_BEVEL_THRESHOLD = 0.35`)**: When perpendicular pull exceeds `0.12`, `computeSubstepDelta` lands on crossed integer grid lines so blocks turn `90°` into perpendicular corridors. Within `0.35` cells of a corner, `tryCornerBevelAssist` snaps perpendicular offset to the open integer lane (`0.08` hysteresis prevents diagonal oscillation).

---

## 3. Gate Clearance, Mid-Drag Capture & Input Funneling ([`src/core/gate-clearance.ts`](../src/core/gate-clearance.ts))

- **`checkBlockGateClearance(board, block, gate, candidateRow, candidateCol)` (`F-02`, `DRAG-01`)**:
  1. Active top color (`getActiveColor(block.colorStack, block.colorCursor)`) is `> 0` (`color === 0` Neutral Stone Sliders never shred) and matches `getGateActiveColor(gate)`.
  2. **Strict Axis-Lock Exit (`DRAG-01`)**: `axisLock === 'H'` exits only `'LEFT' | 'RIGHT'`; `axisLock === 'V'` exits only `'TOP' | 'BOTTOM'`.
  3. `gate.iceCount === 0`, `gate.shutterOpen === true`, and `gate.shutterLockColor === 0`.
  4. If `block.isStar === true`, `gate.isStar` must also be `true`.
  5. Every block cell lies within `[gate.spanStart, gate.spanStart + gate.spanLength - 1]` along the gate's parallel axis, and at least one cell touches `gate.edgeLine` (supporting outer perimeter gates and **Stepped-Edge Exit Gates `GATE-STEP-01`** on recessed inner courtyard ledges).
  6. No occupied cell (`occupancy !== 0 && occupancy !== block.id`) blocks the extrusion corridor between any block cell and `gate.edgeLine`.
  7. **Multi-Room Portcullis & Mystery Vault Gating (`SANCTUM-01..02`, `VAULT-01`, `GATE-ICE-01`)**: Neither the block (`isBlockInLockedRoom` / `isBlockInSealedVault`) nor a room-gated exit gate (`isGateInLockedRoom`) belongs to a sealed room (`roomId > 0` with closed `BarrierState`). `isGateInLockedRoom` ignores `bar.isVault === true` so outer Frozen Gates (`gate.iceCount > 0`) remain active from $t = 0$ and thaw in lockstep with vault countdowns.
- **`checkMidDragGateCapture` (`F-01`, `MECH-04`)**:
  - Captures mid-drag within `0.18` cells of `gate.edgeLine` across continuous span containment (`[minSpan - 0.45, maxSpan + 0.45]` — zero center deadzones on wide gates) when incremental `dot > 1e-4` OR raw pointer pull `pullDot >= 0.08` (`>= 0.12` on the outer `0.25..0.45` bevel jaw).
- **Outward Funnel, Vault Hit-Slop Guard & Cancel Safety ([`src/input/pointer-controller.ts`](../src/input/pointer-controller.ts), [`src/input/targeting-and-keyboard.ts`](../src/input/targeting-and-keyboard.ts))**:
  - Outward pulls up to `32px` past `gate.edgeLine` damp tangential jitter (`× 0.25`).
  - `pickBlockAtBoardPoint` checks `getSealedVaultAtCell` before the `0.22`-cell halo fallback so sealed vaults never leak concealed hits (`onLockedVaultTap` shows `"🔒 Sealed Mystery Vault: Shred N more blocks to reveal hidden blocks!"`).
  - While `bar.isVault && !bar.open`, `rebuildOccupancyGrid` preserves `-3` (`BARRIER`) across `bar.cells` and skips concealed blocks (`isBlockInSealedVault`).
  - `pointercancel`, `window.blur`, or `visibilitychange` cleanly snaps active drags (and glued `groupId` partners) to the last valid integer cell (`snapActiveDragToGridAndEnd`).

---

## 4. Synchronous Clear Cascade & 4-Entry-Point Parity (`resolveClearCascade`, `C1-03`)

Every shred or peel executes side effects in deterministic order:
1. **Step 1A (`triggerCarrierItems`)**: Keys (`hasKey`) unlock matching `lockId` Chained blocks and Portcullis Barriers; Scissors (`scissorColor`) cut `ropeColor` ropes; Shutter Gems (`shutterGemColor`) unlock `shutterLockColor` gates.
2. **Step 1B (Layer Peel vs. Full Shred)**: Multi-layer blocks increment `colorCursor`, add `+2` moves/sec to any active bomb on that block, detach from glued groups, and remain `ACTIVE`. Single/final layers become `'CLEARED'` (`detachBlockFromGluedGroup` re-evaluates connected components so remaining glued partners stay bonded).
3. **Step 1C (`stepPortcullisBarriersOnShred` — Ice Thaw & Multi-Vault Ordering `VAULT-02`)**: Decrements `iceCount` by `1` on active unlocked-room frozen blocks/gates. Sorts closed barriers/vaults ascending by `shredsRemaining` against cumulative reachable-layer & key budgets (`cumulativeLayers` / `cumulativeKeys`) so multi-vault stages (`Level 74`) never prematurely clamp higher vaults. Opening a barrier/vault sets `bar.open = true` and rebuilds occupancy.
4. **Step 1D (Wooden Crates)**: Decrements `hp` by `1` on Wooden Crates orthogonally adjacent to the cleared footprint.
5. **Step 1E (`stepDynamicGatesOnShred` — `L1–25` & `C1-03` Rescue vs. `L26+` Non-Rescue)**: Advances `exitedGate.colorCursor` and steps `togglesOnClear`, `slidesOnClear`, and `sizeChangesOnClear` gates. Parity/span rescues (`DRAG-06`, `DRAG-07`) run on `levelId <= 25`, `createBoardState`, and all Booster strikes (`rescueDynamicGatesOnBoard`), but are disabled on normal moves in **`L26+`**.
6. **Step 2A (`stepMovingElevators`, `F-05`)**: Shifts elevators and active blocks 100% contained on the platform when unobstructed and `floorColor`-valid.
7. **Step 2B (`trySpawnReadyGenerators`, `F-06`)**: Decrements generator cooldowns and spawns queued blocks at `[spawnRow, spawnCol]` when open.
8. **Step 2C (Cascade Isolation)**: Only newly spawned generator blocks or blocks in `allowedCascadeIds` check auto-clearance; stationary unrelated blocks never auto-shred.
9. **Step 3 (`autoAdvanceColorQueues`, `F-08`)**: Advances unlocked-room Color-Changing Gates when `0` blocks of their front color remain globally (`unlockedSupply[c]` decoy/vault swaps run only on `levelId <= 25`, `createBoardState`, or `forceRescue = true` Booster strikes).
10. **4-Entry-Point Law (`C1-03`)**: `commitBlockMove`, `applyBoosterHammer`, `applyBoosterRocket`, and `applyBoosterVacuum` must all run `triggerCarrierItems`, `stepPortcullisBarriersOnShred`, `trySpawnReadyGenerators`, and portcullis/vault toast feedback; Booster strikes additionally run `rescueDynamicGatesOnBoard` + `autoAdvanceColorQueues(board, true)`.
