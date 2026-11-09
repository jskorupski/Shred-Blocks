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
     - **Progressive Courtyard Scaling**: Boards expand gradually across 6 architectural epochs (`5×5` on `L1–15` $\rightarrow$ `6×6` on `L16–40` $\rightarrow$ `6×7` on `L41–80` $\rightarrow$ `7×7` on `L81–140` $\rightarrow$ `7×8`/`8×8` on `L141–220` $\rightarrow$ `8×8`/`9×9` Grand Citadel on `L221–300`).
     - **Per-Block & Per-Board Modifier Budgets (`RAMP-02` & `RAMP-03`)**: Never stack two primary movement-blocking modifiers (`axisLock`, `iceCount`, `chained`, `ropeColor`, `bombCount`) on the same block (`canAddBlockModifier`), and cap active obstacle families to `1` (`L1–70`), `2` (`L71–170`), or `3` (`L171+`).
     - **Generous Gate Apertures & Bomb Buffers (`RAMP-04` & `RAMP-05`)**: Keep gate `spanLength >= maxPerpendicularBlockSpan` (`>= 3` on `7×7+` boards) and `bombCount >= Math.max(10, coloredBlocks.length * 2 + 4)` so puzzles remain fun and tactile rather than frustrating.
4. **Sacred-Geometry Architectural Sanctuary & Tactile 3D Design Language**:
   - **Visual Identity**: Atmospheric twilight-to-terracotta `oklab` gradient skies, sacred-geometry SVG astrolabe accents (`.sacred-geometry-ornament`), stepped 3D architectural sanctuary plinths under the board tray, warm sunlit top lighting paired with cool lavender-indigo shadow fill, and chamfered 3D circular block studs.
   - **Integrated 3D Block Modifiers (Zero "Slapped-On" 2D Sticker Overlays)**:
     - Never cover a block's top face with flat dark `overlayQuad` strips or black rectangular sticker icons.
     - Axis-Locked blocks (`axisLock: 'H' | 'V'`) must use **3D beveled side-flange guide rails** (`railBeamMesh` tinted with block-harmonized `entry.lipHex` + warm champagne metallic cap) leaving the top circular studs 100% uncovered, paired with sculpted 3D circular/octagonal badge medallions (`drawBadgeMedallion3D` in [`src/render/atlas-3d.ts`](src/render/atlas-3d.ts)).
     - Early-stage 3D Move Guides must render as a hollow 3D beveled perimeter frame (`drawHollowMoveGuideFrame`) so the underlying block remains clearly visible and clickable.
   - **Sacred-Geometry Title Screen & Adaptive Player Flows (`#title-overlay`)**:
     - Launches over the live 3D courtyard backdrop (`#screen-game.title-backdrop-mode`) with a compact horizontal Sacred-Geometry Astrolabe & Title Crest banner at the top and a compact Sanctuary Pedestal at the bottom, while `.game-stage-wrapper` reserves top/bottom padding so the 3D puzzle board is centered cleanly in the open window without overlap.
     - **New Player Flow (`A2` — FTUE)**: Brand-new players (`isNewPlayerSave(save) === true`) see **`▶ BEGIN JOURNEY`** as the primary CTA (plus a single-row dock with `Restore Save`, `Settings`, and conditional `Install`) and go **straight into Level 1 (`First Shred`)** without menu overload.
     - **Returning Player Flow (`A3`)**: Returning players (`isNewPlayerSave(save) === false`) see a compact single-bar progress header (Chapter + Level title on the left, `★ / Coins / ✦` pills on the right), **`▶ CONTINUE · LEVEL N`**, and a unified single-row quick-action dock (`Map` · `Themes` · `Sync` · `Settings` · conditional `Install`).
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
| [`scripts/generate-icons.ts`](scripts/generate-icons.ts) | Cross-platform PWA icon rasterizer (`icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) and multi-OS launcher mask verification sheet generator. |
| [`vite.lan.config.ts`](vite.lan.config.ts) | Self-healing LAN HTTPS preview server configuration (`0.0.0.0:8443`, auto-generates `.certs/key.pem` & `.certs/cert.pem`). |

---

## 3. Mandatory Verification & Multi-Agent Adversarial Review Workflow

Whenever you modify code, levels, icons, or styles, execute this exact sequence before concluding:

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
   Must pass all 10 Playwright tests (5 specs × Desktop Chrome & Mobile Portrait), exercising the Title Screen (New & Returning Player flows), real pointer drag-and-drop, keyboard controls, all 5 boosters, and all 18 obstacle mechanics.
4. **Multi-Viewport Visual Screenshot & Launcher Icon Harness (when touching UI/CSS/3D rendering/icons)**:
   ```bash
   npm run verify:visual
   ./node_modules/.bin/tsx scripts/generate-icons.ts
   ```
   Captures 31+ screenshots across `360×640`, `390×844`, `768×1024`, and `1440×900` plus the cross-platform launcher icon mask sheet (`29-launcher-icons-preview.png`) and verifies zero orphan server/browser processes afterward.
5. **Multi-Level Subagent Adversarial Audit & UX Sign-Off (MANDATORY FOR UI / UX / GAMEPLAY UPDATES)**:
   - Every non-trivial UI, UX, icon, or gameplay change must be independently audited by dedicated subagents (`invoke_subagent` / `send_message`):
     1. **Visual Aesthetics & UX Design Critic**: Inspects the rendered multi-viewport screenshots (`00-title-screen-new-player-mobile.png`, `30-title-screen-returning-player-mobile.png`, `01-home-roadmap-mobile.png`, `02-level-001-gameplay-mobile.png`, `29-launcher-icons-preview.png`, etc.) for Sacred-Geometry Architectural Sanctuary cohesion, typography, hierarchy, navigation clarity, and zero clipping/overlap across mobile, tablet, and desktop.
     2. **Gameplay Mechanics & Playtest Auditor**: Audits interactive flows (New vs. Returning player onboarding, 1-tap Map/Title navigation, progressive power-up unlocking & rarity scarcity, solver-verified level ramping, and E2E playtest coverage).
   - Address all P0/P1/P2 findings raised by the review subagents and re-verify before presenting the final result to the user.

---

## 4. Browser Support & Modern Web Guidance Policy

- **Browser Support**: Baseline Widely Available + progressive enhancement (`@supports (background: linear-gradient(in oklab, white, black))` for `in oklab` / `in oklch` gradients, `"devicePixelContentBoxSize" in ResizeObserverEntry.prototype` with `devicePixelRatio` fallback).
- Consult [`docs/ARCHITECTURE_AND_RULES.md`](docs/ARCHITECTURE_AND_RULES.md) for deep-dive specifications of the 18 mechanics, coordinate systems, and shader pipelines.

---

## 5. Upstream Instance & Hosting Configuration (Optional — Trim or Customize on Fork)

If you fork this repository for your own deployment or a different hosting provider, only these upstream-specific settings reference the canonical deployment environment and can be freely modified or removed:
- **Upstream Production Domain (`https://shredblocks.skorupski.org`)**: Referenced in [`index.html`](index.html) (`canonical` / `og:url` metadata) and [`src/storage/save-manager.ts`](src/storage/save-manager.ts) (`buildShareUrl()` fallback when not running on `localhost` or LAN).
- **Cloudflare Workers Static Assets / Pages (`wrangler.jsonc`)**: Optional config for `npx wrangler deploy`; the `npm run build` output in `dist/` is a standard zero-backend static bundle compatible with any static web host.
