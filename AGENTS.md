# AGENTS.md — Agentic Engineering Guide for ShredBlocks: Color Jam

Welcome, Agent! This document is the authoritative engineering handbook for autonomous coding agents and human developers working on **ShredBlocks: Color Jam**. Read this file **before** modifying any code, levels, shaders, styles, or test harnesses.

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
2. **Local Process, Browser & Port Lifecycle Hygiene**:
   - **Never leak orphan dev servers (Vite) or headless browser (Chromium) processes.**
   - Always spawn `./node_modules/.bin/vite` directly in scripts and Playwright configs—**never** wrap Vite in `npx vite` (which spawns an intermediate `npm exec` child process that can survive `proc.kill()`).
   - Never run multiple dev/preview servers concurrently on conflicting ports. Playwright uses strict port `4178` ([`playwright.config.ts`](playwright.config.ts)), and the visual screenshot harness uses strict port `4179` ([`scripts/visual-harness.ts`](scripts/visual-harness.ts)).
   - Always check `if (proc.exitCode !== null)` inside server-readiness polling loops so port conflicts or sandbox `EPERM` errors fail immediately instead of hanging for 15 seconds.
   - Always register `process.on('exit' | 'SIGINT' | 'SIGTERM')` handlers and tear down child servers in `try / finally` blocks with `SIGTERM` followed by a `SIGKILL` fallback.
   - **LAN HTTPS Preview Server SOP (`vite.lan.config.ts`)**:
     - To launch an interactive preview server accessible over both localhost and the local Wi-Fi/LAN network (with self-healing RSA-2048 TLS certificate auto-provisioning in `.certs/key.pem` & `.certs/cert.pem`), spawn `./node_modules/.bin/vite --config vite.lan.config.ts` directly (`IsDaemon: true`, `BypassSandbox: false`). It binds `0.0.0.0:8443` (`strictPort: true`) in `< 150ms`.
     - To tear down the LAN preview server cleanly, terminate the daemon task directly (never wrap Vite in `npx` or `npm run`, which can leave orphan child processes).
3. **Solver-Verified Level Solvability & Fun-First Difficulty Ramping (`UX-03`, `F-02`–`F-05`, `RAMP-01`–`RAMP-05`)**:
   - Every curated campaign level (`1..300` in [`src/levels/catalog.ts`](src/levels/catalog.ts)) and seeded procedural Endless level (`301+` in [`src/levels/generator.ts`](src/levels/generator.ts)) **must be 100% solvable without boosters** as verified by `solveBoard()` in [`src/levels/solver.ts`](src/levels/solver.ts), with zero overlapping occupied cells in its initial state.
   - **First-Move Safety Invariant (`UX-03`)**: On levels `1..30`, every legal first move must lead to a solvable board state (`verifyFirstMoveSafety()`).
   - **Fun-First Difficulty Ramping Invariants (`RAMP-01`–`RAMP-05`)**:
     - **Breather Rhythm (`RAMP-01`)**: Every `5th` level (`15, 20, 25, ...`) is a flow-state breather level (`difficulty: 'NORMAL'`, generous gate apertures, zero bombs/tight shutters).
     - **Progressive Courtyard Scaling & Sculpted Multi-Room Sanctums**: Boards expand gradually across 6 architectural epochs (`5×5` on `L1–15` $\rightarrow$ `6×6` on `L16–40` $\rightarrow$ `6×7` on `L41–80` $\rightarrow$ `7×7` on `L81–140` $\rightarrow$ `7×8`/`8×8` on `L141–220` $\rightarrow$ `8×8`/`9×9` Grand Citadel on `L221–300`), incorporating **Sculpted 3D Courtyards (`L14+`)**, **Stepped-Edge Exit Gates (`gate.edgeLine`, `L18+`)**, and **Multi-Room Portcullis Sanctums & Sunken Twilight Chambers (`board.barriers`, `board.roomMap`, `L25+`)**.
     - **Per-Block & Per-Board Modifier Budgets (`RAMP-02` & `RAMP-03`)**: Never stack two primary movement-blocking modifiers (`axisLock`, `iceCount`, `chained`, `ropeColor`, `bombCount`) on the same block (`canAddBlockModifier`), and cap active obstacle families to `1` (`L1–70`), `2` (`L71–170`), or `3` (`L171+`).
     - **Generous Gate Apertures & Bomb Buffers (`RAMP-04` & `RAMP-05`)**: Keep gate `spanLength >= maxPerpendicularBlockSpan` (`>= 3` on `7×7+` boards) and `bombCount >= Math.max(10, coloredBlocks.length * 2 + 4)` so puzzles remain fun and tactile rather than frustrating.
4. **Sacred-Geometry Architectural Sanctuary & Tactile 3D Design Language**:
   - **Visual Identity**: Atmospheric twilight-to-terracotta `oklab` gradient skies, sacred-geometry SVG astrolabe accents (`.sacred-geometry-ornament`), sculpted cell-aware 3D architectural sanctuary plinths under non-rectangular & multi-room boards (`plinthSpans`), warm sunlit top lighting paired with cool lavender-indigo shadow fill, and chamfered 3D circular block studs.
   - **Full Settings × Custom Theme Compatibility (`AX-01`, `AX-02`, `UX-10`)**:
     - All 8 user settings (`playMode`, `sfxEnabled`, `musicEnabled`, `hapticsEnabled`, `colorblindSymbols`, `highContrast`, `reducedMotion`, `qualityTier`) must work in every combination across all 5 Block Skins, 5 Board Trays (`HIGH_CONTRAST_TRAY_PALETTES` / `getEffectiveTrayPalette`), and 5 Particle Styles.
     - Colorblind symbols (`CB_0..9` on dark obsidian circular medallions) must render at `zCbSymbol = zLift + 0.692 * scaleZ` above all studs, 3D medallions, and straps, and shift cleanly to the top-left collar `(0.21, 0.21)` on multi-layer or center-badged cells so outer vs. inner layer symbols never collide.
   - **Integrated 3D Block Modifiers (Zero "Slapped-On" 2D Sticker Overlays)**:
     - Never cover a block's top face with flat dark `overlayQuad` strips or black rectangular sticker icons.
     - Axis-Locked blocks (`axisLock: 'H' | 'V'`) must use **3D beveled side-flange guide rails** (`railBeamMesh` tinted with block-harmonized `entry.lipHex` + warm champagne metallic cap) leaving the top circular studs 100% uncovered, paired with sculpted 3D circular/octagonal badge medallions (`drawBadgeMedallion3D` in [`src/render/atlas-3d.ts`](src/render/atlas-3d.ts)).
     - Early-stage 3D Move Guides must render as a hollow 3D beveled perimeter frame (`drawHollowMoveGuideFrame`) so the underlying block remains clearly visible and clickable.
   - **Sacred-Geometry Title Screen & Adaptive Player Flows (`#title-overlay`)**:
     - Launches over the live 3D courtyard backdrop (`#screen-game.title-backdrop-mode`), rendering any rectangular, sculpted, or multi-room board as an animated **Sacred-Geometry Astrolabe Wall-Scroll Diagram** (`u_blueprintMix = 1.0`) that smoothly transitions (`0.72s`) into full tactile 3D when gameplay begins.
     - **New Player Flow (FTUE)**: Brand-new players (`isNewPlayerSave(save) === true`) see **`▶ BEGIN JOURNEY`** as the primary CTA (plus a single-row dock with `Restore Save`, `Settings`, and conditional `Install`) and go **straight into Level 1 (`First Shred`)** without menu overload.
     - **Returning Player Flow**: Returning players (`isNewPlayerSave(save) === false`) see a compact single-bar progress header (Chapter + Level title on the left, `★ / Coins / ✦` pills on the right), **`▶ CONTINUE · LEVEL N`**, and a unified single-row quick-action dock (`Map` · `Themes` · `Sync` · `Settings` · conditional `Install`).
     - **Installed PWA Detection (`isPwaInstalled()`)**: Uses multi-signal detection (`matchMedia('(display-mode: standalone|fullscreen|minimal-ui|window-controls-overlay)')`, iOS `navigator.standalone`, Android `android-app://` referrer, `appinstalled` event persisted in `localStorage`, and Chromium `navigator.getInstalledRelatedApps()`) to automatically hide `#btn-title-install` and `#btn-install-header` whenever the app is already installed.
     - Tapping the ShredBlocks brand crest (`#btn-home-title`) on `#screen-home` re-opens `#title-overlay` at any time.
   - **Cross-Platform PWA Launcher Icons & Automatic SW Versioning (`public/icon*.{svg,png}`, `scripts/generate-icons.ts`, `vite.config.ts`)**:
     - **Maskable Icon Safe-Zone Rule (`purpose: "maskable"`)**: `public/icon-maskable.svg`, `public/icon-maskable-192.png`, and `public/icon-maskable-512.png` must use a **100% full-bleed** Twilight Sanctuary sky gradient + concentric circular astrolabe rings and keep all 3D block/gate foreground elements inside the central 80% W3C safe circle (`cx=256, cy=256, r<=190`) with **zero inner rectangular border**, preventing "box-inside-a-squircle" clipping on Samsung One UI and Android Pixel launchers.
     - **iOS / iPadOS Home Screen (`public/apple-touch-icon.png`)**: Must be a `180×180` opaque full-bleed PNG (iOS Safari ignores SVG `apple-touch-icon` links and applies its own native squircle corner mask).
     - **Automatic Build-Time SW Cache & Version Stamping (`pwaAutoVersionPlugin` in [`vite.config.ts`](vite.config.ts))**: Every `npm run build` automatically hashes `dist/index.html` and `dist/assets/*` (`SHA-256` 8-char digest), stamps `CACHE_VERSION = 'shredblocks-v<pkgVersion>-<hash8>'` and the hashed `/assets/*` bundle URLs into `dist/sw.js`, and writes `dist/version.json`. This guarantees browsers and installed PWAs detect every deployment automatically without manual version bumps.
     - **Service Worker Redirect Hygiene (`public/sw.js`)**: Never cache or return a `Response` with `response.redirected === true` for top-level navigation requests (`request.mode === 'navigate'`), as Chromium rejects redirected cached responses on manual-redirect navigations (`ERR_FAILED`). Always normalize responses via `stripRedirectFlag()` and pre-cache `/` as the canonical HTML shell.
   - **Living Sanctuary Courtyard Idle & Passive Animation System (`IDLE-01`–`IDLE-06`)**:
     - When `reducedMotion === false` and no block is being dragged, the 3D gameboard must feel calmly alive: movable blocks breathe in a gentle diagonal harmonic wave (`+0.038 Z` lift + `±1.0%` centroid scale pulse + subtle `±0.008` axis-lock slide hint), cycle through a staggered spotlight double-bounce cue (`+0.052 Z` + soft floor drop shadow every `3.2s`), ready Exit Gates project a subtle threshold floor aura with `1.35 rad/s` glinting rollers, 3D obstacle medallions/pillar diamonds/generators/bombs animate smoothly, and delicate GPU-instanced courtyard motes & gate sparks rise across the tray.
   - **Anti-"Default-LLM-UI" Rules**:
     - Never use raw unstyled `#0f172a` Tailwind boxes, neon SaaS cards, or native unstyled `<input type="checkbox">`.
     - Never use the `🪙` Unicode coin emoji (which renders as a grey rock on macOS/iOS Apple Color Emoji); use `.coin-emblem` CSS gold medallions or clean `Coins` text.
     - Keep `#game-toast` as a direct child of `#app-shell` so toast feedback is visible across `#screen-home`, `#screen-game`, and `#screen-themes`.
     - Keep `closedby="none"` on `#dialog-victory` and `#dialog-failure` so mid-drag gate captures at the board perimeter never accidentally light-dismiss the victory modal on pointer release (`PLAY-02`).

---

## 2. Directory & Module Map (`ARCH-ERGONOMICS-01` Modular Architecture)

Every source, stylesheet, HTML, test, script, and documentation file is kept `<= 750 lines` (`<= 800 lines` and `<= 45,000 bytes` hard ceiling, enforced by `ARCH-ERGONOMICS-01` in [`tests/unit/sanctums-and-architecture.test.ts`](tests/unit/sanctums-and-architecture.test.ts)) so autonomous coding agents can inspect any file in a single `read_file` call without multi-chunk pagination. Domain barrels (`src/core/physics.ts`, `src/core/gate-clearance.ts`, `src/core/board.ts`, `src/levels/generator.ts`, `src/render/mesh-generator.ts`, `src/render/renderer-3d.ts`, `src/input/pointer-controller.ts`, `src/main.ts`) re-export their extracted sub-modules for zero-friction imports:

| Path | Responsibility |
| :--- | :--- |
| [`index.html`](index.html) & [`src/ui/dialogs-template.ts`](src/ui/dialogs-template.ts) | Single-page application shell (`#screen-home`, `#screen-game`, `#screen-themes`, `#title-overlay`) + lazy-mounted `<dialog>` modals (`ensureDialogsMounted`). |
| [`src/main.ts`](src/main.ts) & [`src/ui/`](src/ui/) | `ShredBlocksApp` orchestrator (`undoStack`, `preRestartSnapshot`, boosters, rAF loop) + modular UI views ([`catalog-meta.ts`](src/ui/catalog-meta.ts), [`hud-and-title-view.ts`](src/ui/hud-and-title-view.ts), [`roadmap-and-themes-view.ts`](src/ui/roadmap-and-themes-view.ts), [`modals-and-save-transfer.ts`](src/ui/modals-and-save-transfer.ts), [`dom-events-and-pwa.ts`](src/ui/dom-events-and-pwa.ts)). |
| [`src/styles/main.css`](src/styles/main.css) & [`src/styles/*.css`](src/styles/) | Ordered `@import` CSS barrel: [`tokens-and-shell.css`](src/styles/tokens-and-shell.css), [`screen-home.css`](src/styles/screen-home.css), [`screen-game.css`](src/styles/screen-game.css), [`themes-and-nav.css`](src/styles/themes-and-nav.css), [`dialogs.css`](src/styles/dialogs.css), [`title-and-a11y.css`](src/styles/title-and-a11y.css). |
| [`src/core/types.ts`](src/core/types.ts) & [`src/core/polyomino.ts`](src/core/polyomino.ts) | Canonical TypeScript interfaces, `COLOR_PALETTE` (9 colors + `0` neutral stone + `AX-01` symbols + `hcRgb`), `SavePayloadV1`, and 19 polyomino shapes. |
| [`src/core/physics.ts`](src/core/physics.ts) & [`src/core/room-and-occupancy.ts`](src/core/room-and-occupancy.ts) | Channel-locked orthogonal swept grid raycast (`clampGroupDragDelta` with `0.30`-cell corner bevel assist), multi-room sanctum occupancy, and `groupId` movement (`F-03`). |
| [`src/core/gate-clearance.ts`](src/core/gate-clearance.ts) & [`src/core/shred-side-effects.ts`](src/core/shred-side-effects.ts) | Gate aperture & axis-lock exit rules (`F-02`), mid-drag gate capture (`checkMidDragGateCapture`), and isolated post-shred side-effect resolution (`allowedCascadeIds`). |
| [`src/core/board.ts`](src/core/board.ts) & [`src/core/board-state.ts`](src/core/board-state.ts) | `createBoardState`, `cloneBoardState`, `commitBlockMove`, 5 booster mutations (`applyBoosterHammer`, `applyBoosterRocket`, `applyBoosterVacuum`), and star calculation (`computeEarnedStars`). |
| [`src/levels/catalog.ts`](src/levels/catalog.ts) & [`src/levels/curated-early.ts`](src/levels/curated-early.ts) | 300 campaign levels (`1..300`) across 6 progressive courtyard epochs (`5×5` $\rightarrow$ `9×9`) with gradual 18-obstacle onboarding and `unlockNote` tutorial banners. |
| [`src/levels/generator.ts`](src/levels/generator.ts), [`generator-rules.ts`](src/levels/generator-rules.ts), [`generator-mechanics.ts`](src/levels/generator-mechanics.ts) | Deterministic `Mulberry32` reverse-move procedural level generator (`RAMP-01`–`RAMP-05`) for Campaign (`82..300`) and Endless Mastery (`Level 301+`). |
| [`src/levels/solver.ts`](src/levels/solver.ts) | State-space BFS/A\* solver (`solveBoard`), optimal `parMoves` calculator, and Zen/Timed Hint engine (`findNextHintMove`). |
| [`src/render/camera-3d.ts`](src/render/camera-3d.ts) & [`src/render/atlas-3d.ts`](src/render/atlas-3d.ts) | 52° perspective camera (`screenToBoardRayPlane` at `z = 0.58`) and 512×512 procedural RGBA WebGL2 texture atlas (`CB_0..9`, obstacle glyphs, `DIGIT_0..9`). |
| [`src/render/mesh-generator.ts`](src/render/mesh-generator.ts) & [`src/render/mesh-primitives.ts`](src/render/mesh-primitives.ts) | Procedural 3D mesh generator for all 76 static polyomino meshes (19 shapes × 4 geometry variants), chamfered 3D circular top studs (`addCylinderCapToBuilder`), and `ENVIRONMENT_MESHES`. |
| [`src/render/renderer-3d.ts`](src/render/renderer-3d.ts) & [`src/render/pass*.ts`](src/render/) | 4-Pass WebGL2 renderer orchestrator (`RenderPassContext`), [`render-types.ts`](src/render/render-types.ts), [`shaders-3d.ts`](src/render/shaders-3d.ts), [`particle-fx.ts`](src/render/particle-fx.ts), [`pass1-courtyard.ts`](src/render/pass1-courtyard.ts), [`pass1-gates-barriers.ts`](src/render/pass1-gates-barriers.ts), [`pass2-barriers-and-reticles.ts`](src/render/pass2-barriers-and-reticles.ts), [`pass3-block-shells.ts`](src/render/pass3-block-shells.ts), [`pass3-block-overlays.ts`](src/render/pass3-block-overlays.ts), and [`canvas2d-fallback.ts`](src/render/canvas2d-fallback.ts). |
| [`src/input/pointer-controller.ts`](src/input/pointer-controller.ts) & [`src/input/targeting-and-keyboard.ts`](src/input/targeting-and-keyboard.ts) | Unified pointer/touch/mouse drag controller (`setPointerCapture`, `pointercancel`/`blur` snap-back, 32px outward gate funnel), booster canvas targeting, and `AX-03` keyboard navigation. |
| [`src/audio/synth.ts`](src/audio/synth.ts) & [`src/audio/synth-voices.ts`](src/audio/synth-voices.ts) | Zero-asset procedural Web Audio API synthesizer + ambient pentatonic chime loop + haptic feedback wrapper. |
| [`src/storage/save-manager.ts`](src/storage/save-manager.ts), [`save-code.ts`](src/storage/save-code.ts), [`qr-svg.ts`](src/storage/qr-svg.ts) | Dual-slot `localStorage` persistence (`shredblocks_save_v1` + backup), `SB1-<base64url>-<crc32hex>` save codes, ISO/IEC 18004 QR SVG generator, and 1-tap rollback. |
| [`tests/unit/*.test.ts`](tests/unit/) & [`tests/e2e/shredblocks.spec.ts`](tests/e2e/shredblocks.spec.ts) | Split unit suites ([`engine-and-solver.test.ts`](tests/unit/engine-and-solver.test.ts), [`campaign-and-invariants.test.ts`](tests/unit/campaign-and-invariants.test.ts), [`sanctums-and-architecture.test.ts`](tests/unit/sanctums-and-architecture.test.ts), [`storage-and-integration.test.ts`](tests/unit/storage-and-integration.test.ts)) and 10 Playwright E2E browser playtests. |
| [`public/sw.js`](public/sw.js), [`scripts/generate-icons.ts`](scripts/generate-icons.ts), [`vite.lan.config.ts`](vite.lan.config.ts) | Offline-first PWA Service Worker, cross-platform launcher icon rasterizer, and self-healing LAN HTTPS preview server (`0.0.0.0:8443`). |

---

## 3. Mandatory Verification & Multi-Agent Adversarial Review Workflow

Whenever you modify code, levels, icons, or styles, execute this exact sequence before concluding:

1. **Unit & 300-Level Solver Suite**:
   ```bash
   npm run test:unit
   ```
   Must pass all 42+ tests in `< 1.5s`, including 100% solvability and non-overlapping cell verification across all 300 campaign levels.
2. **TypeScript Typecheck & Production Build**:
   ```bash
   npm run build
   ```
   Must exit with `0` errors (`tsc --noEmit && vite build`).
3. **End-to-End Interactive Browser Playtest Suite**:
   ```bash
   npm run test:e2e
   ```
   Must pass all 10 Playwright tests (5 specs × Desktop Chrome & Mobile Portrait), exercising the Title Screen (New & Returning Player flows), real pointer drag-and-drop, keyboard controls, all 5 boosters, all 8 user settings across custom themes, and all 18 obstacle + multi-room sanctum mechanics.
4. **Multi-Viewport Visual Screenshot & Launcher Icon Harness (when touching UI/CSS/3D rendering/icons)**:
   ```bash
   npm run verify:visual
   ./node_modules/.bin/tsx scripts/generate-icons.ts
   ```
   Captures 34+ screenshots across `360×640`, `390×844`, `768×1024`, and `1440×900` plus the cross-platform launcher icon mask sheet (`29-launcher-icons-preview.png`) and verifies zero orphan server/browser processes afterward.
5. **Multi-Level Subagent Adversarial Audit & UX Sign-Off (MANDATORY FOR UI / UX / GAMEPLAY UPDATES)**:
   - Every non-trivial UI, UX, icon, or gameplay change must be independently audited by dedicated subagents (`invoke_subagent` / `send_message`):
     1. **Visual Aesthetics & UX Design Critic**: Inspects the rendered multi-viewport screenshots (`00-title-screen-new-player-mobile.png`, `30-title-screen-returning-player-mobile.png`, `01-home-roadmap-mobile.png`, `02-level-001-gameplay-mobile.png`, `29-launcher-icons-preview.png`, `32..37`, etc.) for Sacred-Geometry Architectural Sanctuary cohesion, typography, hierarchy, navigation clarity, and zero clipping/overlap across mobile, tablet, and desktop.
     2. **Gameplay Mechanics & Playtest Auditor**: Audits interactive flows (New vs. Returning player onboarding, 1-tap Map/Title navigation, progressive power-up unlocking & rarity scarcity, solver-verified level ramping, and E2E playtest coverage).
   - Address all P0/P1/P2 findings raised by the review subagents and re-verify in iterative cycles until zero issues remain (`0 P0`, `0 P1`, `0 P2`), always adding regression tests whenever bugs or regressions not caught by existing tests are uncovered.

---

## 4. Engineering & Testing Guardrails (Lessons Learned)

1. **Self-Contained Documentation & Comment Hygiene**:
   - Code comments, test descriptions, and documentation (`src/`, `tests/`, `scripts/`, `docs/`, `README.md`, `AGENTS.md`) must **only** reference self-contained domain concepts or git-tracked architecture invariants defined in [`docs/ARCHITECTURE_AND_RULES.md`](docs/ARCHITECTURE_AND_RULES.md) and [`AGENTS.md`](AGENTS.md). Never leave references to transient implementation plans, stage numbers, review rounds, or temporary bug labels.
2. **3D Block Top-Surface Z-Layer Hierarchy (`zCbSymbol = 0.692`)**:
   - Studded block skins (`classic_studs`, `gummy_jelly`, `neon_cyber`) have 3D circular top studs reaching `Z = 0.660` (outer shell) and `Z = 0.677` (inner multi-layer core). Any surface badge that must be visible on studded skins—such as `CB_0..9` colorblind symbols—must render at `zCbSymbol = zLift + 0.692 * scaleZ` above the studs and shift to the top-left collar `(0.21, 0.21)` on multi-layer or center-badged cells. Consult the Z-Layer Hierarchy table in [`docs/ARCHITECTURE_AND_RULES.md`](docs/ARCHITECTURE_AND_RULES.md) before adding or moving any 3D block overlay.
3. **WebGL2 Canvas Pixel-Diff Verification for Settings × Custom Themes**:
   - Asserting DOM classes or `localStorage` state is insufficient for verifying 3D visual accessibility settings (`highContrast`, `colorblindSymbols`) across custom skins and trays. Always maintain the `#game-canvas` screenshot buffer comparison in [`tests/e2e/shredblocks.spec.ts`](tests/e2e/shredblocks.spec.ts) verifying that toggling High Contrast and Colorblind Symbols on non-default custom themes (`neon_cyber` + `warm_birch`) produces measurably distinct WebGL2 rendered frames.
4. **Row-Span Plinth Merging (`plinthSpans`) for 120Hz Frame Budget (`<= 6.5ms`)**:
   - Never issue per-cell `drawMesh` calls for multi-tier architectural plinths under sculpted or multi-room boards (`L14+`, `L25+`). Always merge contiguous row spans (`plinthSpans` in [`src/render/renderer-3d.ts`](src/render/renderer-3d.ts)) so Pass 1 draw calls stay compact (`~15–24` calls instead of `150+`).
5. **4-Entry-Point Clear & Barrier Unlock Parity**:
   - All 4 block-clearing entry points (`commitBlockMove`, `applyBoosterHammer`, `applyBoosterRocket`, and `applyBoosterVacuum`) must maintain 100% parity for post-clear side effects (`triggerCarrierItems`, `stepPortcullisBarriersOnShred`, `trySpawnReadyGenerators`, and `⛩️ Portcullis Opened!` toast feedback).
6. **Visual Harness Context Isolation**:
   - Because [`scripts/visual-harness.ts`](scripts/visual-harness.ts) reuses browser contexts across captures, always explicitly reset `setHighContrast(false)`, `setColorblindMode(false)`, `setReducedMotion(false)`, and `setTheme('classic_studs', 'industrial_slate', 'micro_cubes')` after any custom-state capture.
7. **Single-Call Agentic File-Size Invariant (`ARCH-ERGONOMICS-01`) & Atomic Commit Hygiene**:
   - Never allow any `.ts`, `.css`, `.html`, `.md`, `.js`, `.json`, `.jsonc`, or `.svg` file in the repository to exceed `800 lines` or `45,000 bytes` (aim for `<= 750 lines`). When adding new features, place them in focused domain sub-modules (`src/core/`, `src/levels/`, `src/render/`, `src/ui/`, `src/styles/`, `tests/unit/`) and re-export public symbols through the domain barrel.
   - Keep git commits focused on cohesive logical units: isolate pure internal refactors in their own dedicated commit separate from user-facing feature/fix commits, while grouping tightly interconnected changes that depend on each other into a single verified commit after iterative adversarial sign-off.

---

## 5. Browser Support & Modern Web Guidance Policy

- **Browser Support**: Baseline Widely Available + progressive enhancement (`@supports (background: linear-gradient(in oklab, white, black))` for `in oklab` / `in oklch` gradients, `"devicePixelContentBoxSize" in ResizeObserverEntry.prototype` with `devicePixelRatio` fallback).
- Consult [`docs/ARCHITECTURE_AND_RULES.md`](docs/ARCHITECTURE_AND_RULES.md) for deep-dive specifications of the 18 mechanics, coordinate systems, and shader pipelines.

---

## 6. Upstream Instance & Hosting Configuration (Optional — Trim or Customize on Fork)

If you fork this repository for your own deployment or a different hosting provider, only these upstream-specific settings reference the canonical deployment environment and can be freely modified or removed:
- **Upstream Production Domain (`https://shredblocks.skorupski.org`)**: Referenced in [`index.html`](index.html) (`canonical` / `og:url` metadata) and [`src/storage/save-manager.ts`](src/storage/save-manager.ts) (`buildShareUrl()` fallback when not running on `localhost` or LAN).
- **Cloudflare Workers Static Assets / Pages (`wrangler.jsonc`)**: Optional config for `npx wrangler deploy`; the `npm run build` output in `dist/` is a standard zero-backend static bundle compatible with any static web host.
