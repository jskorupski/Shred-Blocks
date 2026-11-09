# AGENTS.md — Agentic Engineering Guide for ShredBlocks: Color Jam

Welcome, Agent! This document is the authoritative engineering handbook for autonomous coding agents and human developers working on **ShredBlocks: Color Jam** (`https://shredblocks.skorupski.org`). Read this file **before** modifying any code, levels, shaders, styles, or test harnesses.

---

## 1. Core Architectural & Product Invariants (NON-NEGOTIABLE)

Every change to the codebase must preserve these invariants:

1. **100% Free-to-Play, Zero Ads, Zero IAP, Zero Dark Patterns**:
   - Never add ad SDKs, paid currency packs, energy/stamina bars, or paywalled levels.
   - **Unlimited Lives (`F-01`)** and **Free Level Skip (`F-04`)** (`0 Coins` via `#btn-skip-hud`, Pause modal, or Failure modal) must remain available on every level.
   - **3 Free Undos Per Level (`F-08`)** + accidental level restart recovery (`preRestartSnapshot` in [`src/main.ts`](src/main.ts)) must remain intact.
   - **Progressive Power-Up Unlocking & Rarity Scarcity (`ECON-01`–`ECON-04`)**:
     - Power-ups unlock gradually (`UNDO: L1`, `FREEZE/Hint: L2`, `HAMMER: L8`, `ROCKET: L18`, `VACUUM: L30`) with 5 distinct rarity tiers (`COMMON`, `UNCOMMON`, `RARE`, `EPIC`, `LEGENDARY`) and rarity-scaled coin refill prices (`60 / 80 / 140 / 220 / 350 Coins`).
     - Chest rewards (`pickRarityWeightedBooster` in [`src/storage/save-manager.ts`](src/storage/save-manager.ts)) must never drop locked boosters and must weight drops by rarity (`42% / 30% / 16% / 8% / 4%` for Shredder Chests) so `EPIC`/`LEGENDARY` power-ups remain genuinely scarce and rewarding while Free Level Skip (`0 Coins`) prevents any player lock-out.
   - **Destructive Boosters Clear Undo Stack (`F-08` / `MECH-10`)**: Executing `HAMMER`, `ROCKET`, or `VACUUM` must clear `this.undoStack` so consumed inventory boosters cannot be refunded or exploited via Undo.
2. **Strict Process & Port Hygiene on macOS (Mac mini Protection)**:
   - **Never leak orphan Vite or Chromium processes.**
   - Always spawn `./node_modules/.bin/vite` directly in scripts and Playwright configs—**never** wrap Vite in `npx vite` (which spawns an intermediate `npm exec` child process that survives `proc.kill()`).
   - Never run multiple dev/preview servers concurrently. Playwright uses strict port `4178` ([`playwright.config.ts`](playwright.config.ts)), and the visual screenshot harness uses strict port `4179` ([`scripts/visual-harness.ts`](scripts/visual-harness.ts)).
   - Always check `if (proc.exitCode !== null)` inside server-readiness polling loops so port conflicts or sandbox `EPERM` errors fail immediately instead of hanging for 15 seconds.
   - Always register `process.on('exit' | 'SIGINT' | 'SIGTERM')` handlers and tear down child servers in `try / finally` blocks with `SIGTERM` followed by a `SIGKILL` fallback.
   - **Reliable LAN HTTPS Preview Server SOP (`vite.lan.config.ts`)**:
     - To launch an interactive preview server accessible over both localhost and the local Wi-Fi/LAN network (with self-healing RSA-2048 TLS certificate auto-provisioning in `.certs/key.pem` & `.certs/cert.pem`), spawn `./node_modules/.bin/vite --config vite.lan.config.ts` directly via `run_command` with `IsDaemon: true` (`BypassSandbox: false`). It binds `0.0.0.0:8443` (`strictPort: true`) in `< 150ms`.
     - To tear down the LAN preview server cleanly, call `manage_task` with `Action: 'kill'` on the daemon `TaskId` (never wrap Vite in `npx` or `npm run`, which would leave orphan child processes).
3. **Solver-Verified Level Solvability & Fun-First Difficulty Ramping (`UX-03`, `F-02`–`F-05`, `RAMP-01`–`RAMP-05`)**:
   - Every curated campaign level (`1..300` in [`src/levels/catalog.ts`](src/levels/catalog.ts)) and seeded procedural Endless level (`301+` in [`src/levels/generator.ts`](src/levels/generator.ts)) **must be 100% solvable without boosters** as verified by `solveBoard()` in [`src/levels/solver.ts`](src/levels/solver.ts), with zero overlapping occupied cells in its initial state.
   - **First-Move Safety Invariant (`UX-03`)**: On levels `1..30`, every legal first move must lead to a solvable board state (`verifyFirstMoveSafety()`).
   - **Fun-First Difficulty Ramping Invariants (`RAMP-01`–`RAMP-05`)**:
     - **Breather Rhythm (`RAMP-01`)**: Every `5th` level (`15, 20, 25, ...`) is a flow-state breather level (`difficulty: 'NORMAL'`, generous gate apertures, zero bombs/tight shutters).
     - **Progressive Courtyard Scaling**: Boards expand gradually across 6 architectural epochs (`5×5` on `L1–15` $\rightarrow$ `6×6` on `L16–40` $\rightarrow$ `6×7` on `L41–80` $\rightarrow$ `7×7` on `L81–140` $\rightarrow$ `7×8`/`8×8` on `L141–220` $\rightarrow$ `8×8`/`9×9` Grand Citadel on `L221–300`).
     - **Per-Block & Per-Board Modifier Budgets (`RAMP-02` & `RAMP-03`)**: Never stack two primary movement-blocking modifiers (`axisLock`, `iceCount`, `chained`, `ropeColor`, `bombCount`) on the same block (`canAddBlockModifier`), and cap active obstacle families to `1` (`L1–70`), `2` (`L71–170`), or `3` (`L171+`).
     - **Generous Gate Apertures & Bomb Buffers (`RAMP-04` & `RAMP-05`)**: Keep gate `spanLength >= maxPerpendicularBlockSpan` (`>= 3` on `7×7+` boards) and `bombCount >= Math.max(10, coloredBlocks.length * 2 + 4)` so puzzles remain fun and tactile rather than frustrating.
4. **Sacred-Geometry Architectural Sanctuary & Tactile 3D Design Language**:
   - **Visual Identity**: Atmospheric twilight-to-terracotta `oklab` gradient skies, sacred-geometry SVG astrolabe accents (`.sacred-geometry-ornament`), stepped 3D architectural sanctuary plinths under the board tray, warm sunlit top lighting paired with cool lavender-indigo shadow fill, and chamfered 3D circular block studs.
   - **Integrated 3D Block Modifiers (Zero "Slapped-On" 2D Sticker Overlays)**:
     - Never cover a block's top face with flat dark `overlayQuad` strips or black rectangular sticker icons.
     - Axis-Locked blocks (`axisLock: 'H' | 'V'`) must use **3D beveled side-flange guide rails** (`railBeamMesh` tinted with block-harmonized `entry.lipHex` + warm champagne metallic cap) leaving the top circular studs 100% uncovered, paired with sculpted 3D circular/octagonal badge medallions (`drawBadgeMedallion3D` in [`src/render/atlas-3d.ts`](src/render/atlas-3d.ts)).
     - Early-stage 3D Move Guides must render as a hollow 3D beveled perimeter frame (`drawHollowMoveGuideFrame`) so the underlying block remains clearly visible and clickable.
   - **Anti-"Default-LLM-UI" Rules**:
     - Never use raw unstyled `#0f172a` Tailwind boxes, neon SaaS cards, or native unstyled `<input type="checkbox">`.
     - Never use the `🪙` Unicode coin emoji (which renders as a grey rock on macOS/iOS Apple Color Emoji); use `.coin-emblem` CSS gold medallions or clean `Coins` text.
     - Keep `#game-toast` as a direct child of `#app-shell` so toast feedback is visible across `#screen-home`, `#screen-game`, and `#screen-themes`.
     - Keep `closedby="none"` on `#dialog-victory` and `#dialog-failure` so mid-drag gate captures at the board perimeter never accidentally light-dismiss the victory modal on pointer release (`PLAY-02`).

---

## 2. Directory & Module Map

| Path | Responsibility |
| :--- | :--- |
| [`index.html`](index.html) | Single-page application shell: `#screen-home`, `#screen-game`, `#screen-themes`, 5 `<dialog>` modals, and `.sacred-geometry-ornament` SVG. |
| [`src/main.ts`](src/main.ts) | `ShredBlocksApp` orchestrator: screen routing, HUD synchronization, rAF loop, booster state machine, modals, PWA lifecycle, and `window.__SHREDBLOCKS_DEBUG__`. |
| [`src/styles/main.css`](src/styles/main.css) | Sacred-geometry architectural & tactile 3D stylesheet (`in oklab` gradients, responsive `100dvh`/`100dvw` layout, `@media (forced-colors: active)`). |
| [`src/core/types.ts`](src/core/types.ts) | Canonical TypeScript interfaces, `COLOR_PALETTE` (8 colors + `0` neutral stone + `AX-01` symbols), and `SavePayloadV1` schema. |
| [`src/core/polyomino.ts`](src/core/polyomino.ts) | 19 canonical polyomino shapes (`1×1` through `3×3` and pentominoes), cell occupancy iterators, and multi-layer color stack helpers. |
| [`src/core/physics.ts`](src/core/physics.ts) | Channel-locked orthogonal swept grid raycast (`clampGroupDragDelta` with `0.30`-cell corner bevel assist), `isBlockMovable` (including movable neutral stone sliders `color: 0`), and `groupId` linked-group movement (`F-03`). |
| [`src/core/gate-clearance.ts`](src/core/gate-clearance.ts) | Gate aperture span & axis-lock directional exit rules (`F-02`), outward pull-dot mid-drag gate capture (`checkMidDragGateCapture`), and isolated post-shred side-effect resolution (`allowedCascadeIds`). |
| [`src/core/board.ts`](src/core/board.ts) | `createBoardState`, `cloneBoardState`, `commitBlockMove`, 5 booster mutations (`applyBoosterHammer`, `applyBoosterRocket`, `applyBoosterVacuum`), and Zen/Timed star calculation (`computeEarnedStars`). |
| [`src/levels/catalog.ts`](src/levels/catalog.ts) | 300 campaign levels (`1..300`) across 6 progressive courtyard epochs (`5×5` $\rightarrow$ `9×9`) with gradual 18-obstacle onboarding and `unlockNote` tutorial banners. |
| [`src/levels/generator.ts`](src/levels/generator.ts) | Deterministic `Mulberry32` reverse-move procedural level generator (`RAMP-01`–`RAMP-05`) for Campaign (`82..300`) and Endless Mastery (`Level 301+`). |
| [`src/levels/solver.ts`](src/levels/solver.ts) | State-space BFS/A\* solver (`solveBoard`), optimal `parMoves` calculator, and Zen/Timed Hint engine (`findNextHintMove`). |
| [`src/render/camera-3d.ts`](src/render/camera-3d.ts) | 52° perspective camera, responsive aspect-fit framing (`rows + 1.55`), and exact ray-plane unprojection (`screenToBoardRayPlane` at `z = 0.58`). |
| [`src/render/mesh-generator.ts`](src/render/mesh-generator.ts) | Procedural 3D mesh generator for all 19 polyomino shapes, chamfered 3D circular top studs (`addCylinderCapToBuilder`), inner multi-layer cores, and environment meshes. |
| [`src/render/atlas-3d.ts`](src/render/atlas-3d.ts) | Procedural 1024×1024 crisp mipmapped WebGL2 texture atlas (`CB_0..8`, sculpted 3D `drawBadgeMedallion3D` obstacle badges, `DIGIT_0..9`). |
| [`src/render/renderer-3d.ts`](src/render/renderer-3d.ts) | 4-Pass WebGL2 renderer, `QualityGovernor` (`VER-03` `workDurationMs` ring buffer), GPU-instanced 3D particles (`MAX_PARTICLES = 2048`), and `Canvas2D` fallback. |
| [`src/input/pointer-controller.ts`](src/input/pointer-controller.ts) | Unified pointer/touch/mouse drag controller (`setPointerCapture`, `pointercancel`/`blur` snap-back, 32px outward gate funnel), booster canvas targeting, and `AX-03` keyboard navigation. |
| [`src/audio/synth.ts`](src/audio/synth.ts) | Zero-asset procedural Web Audio API synthesizer + ambient pentatonic chime loop + haptic feedback wrapper. |
| [`src/storage/save-manager.ts`](src/storage/save-manager.ts) | Dual-slot `localStorage` persistence (`shredblocks_save_v1` + backup), coin/star/streak/chest economy, and 1-tap pre-import rollback. |
| [`src/storage/save-code.ts`](src/storage/save-code.ts) | `SB1-<base64url>-<crc32hex>` compact save encoder/decoder and strict schema validator. |
| [`src/storage/qr-svg.ts`](src/storage/qr-svg.ts) | Pure TypeScript ISO/IEC 18004 QR Code Version 1–10 Mode-Byte ECC-L SVG generator. |
| [`public/sw.js`](public/sw.js) | Offline-first PWA Service Worker with versioned cache cleanup and user-prompted `SKIP_WAITING`. |
| [`vite.lan.config.ts`](vite.lan.config.ts) | Self-healing LAN HTTPS preview server configuration (`0.0.0.0:8443`, auto-generates `.certs/key.pem` & `.certs/cert.pem`). |

---

## 3. Mandatory Verification Workflow Before Concluding Any Task

Whenever you modify code, levels, or styles, execute this exact sequence:

1. **Unit & 300-Level Solver Suite**:
   ```bash
   npm run test:unit
   ```
   Must pass all 35+ tests in `< 1.5s`, including 100% solvability and non-overlapping cell verification across all 300 campaign levels.
2. **TypeScript Typecheck & Production Build**:
   ```bash
   npm run build
   ```
   Must exit with `0` errors (`tsc --noEmit && vite build`).
3. **End-to-End Interactive Browser Playtest Suite**:
   ```bash
   npm run test:e2e
   ```
   Must pass all 10 Playwright tests (5 specs × Desktop Chrome & Mobile Portrait), exercising real pointer drag-and-drop, keyboard controls, all 5 boosters, and all 18 obstacle mechanics.
4. **Multi-Viewport Visual Screenshot Harness (when touching UI/CSS/3D rendering)**:
   ```bash
   npm run verify:visual
   ```
   Captures 28 screenshots across `360×640`, `390×844`, `768×1024`, and `1440×900` and verifies zero orphan server/browser processes afterward.

---

## 4. Browser Support & Modern Web Guidance Policy

- **Browser Support**: Baseline Widely Available + progressive enhancement (`@supports (background: linear-gradient(in oklab, white, black))` for `in oklab` / `in oklch` gradients, `"devicePixelContentBoxSize" in ResizeObserverEntry.prototype` with `devicePixelRatio` fallback).
- Consult [`docs/ARCHITECTURE_AND_RULES.md`](docs/ARCHITECTURE_AND_RULES.md) for deep-dive specifications of the 18 mechanics, coordinate systems, and shader pipelines.
