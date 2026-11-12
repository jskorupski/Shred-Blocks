# AGENTS.md — Agentic Engineering Guide for ShredBlocks: Color Jam

Authoritative engineering entrypoint for autonomous coding agents and contributors working on **ShredBlocks: Color Jam**. To preserve context window efficiency, this file contains **core non-negotiable rules, execution SOPs, module routing, and verification steps**, while deep-dive subsystem rules live in **on-demand reference docs** (Section 2) that you load only when touching that domain.

---

## 1. Core Architectural & Product Invariants (NON-NEGOTIABLE)

1. **100% Free-to-Play, Closed-Loop Ludological Core & Fair Economy v2 (`LUDO-CORE-01`, `ECON-01`–`04`, `ECON-V2`, `MAP-MODE-SPLIT-01`, `MODE-ISOLATION-01`, `ZEN-SKIP-GUARD-01`, `STREAK-INTEGRITY-01`, `ZEN-STARS-01`)**:
   - Never add ad SDKs, paid currency, stamina bars, or paywalls. Keep **Unlimited Lives (`F-01`)**, **Free Zen Blessing Continues** (`1 / 4` unique Zen clears, cap `3`), **Zen-Only Free Level Skips (`0 Coins`, `F-04`)**, and **3 Free Undos (`F-08`)** + accidental-restart recovery (`preRestartSnapshot`) on every stage.
   - **3 Independent Mode Ladders (`modeState[mode]`) & Clean-Reset Mode Isolation (`MODE-ISOLATION-01`)**: `'CHALLENGE'` (move budget + Touch-Move Coalescing + `FINAL-TOUCH-01` grace, `1–3★` via `STARS-SLACK-01`, Continue caps at `1★`), `'ZEN'` (untimed, `bombsInert` `ZEN-CALM-01`, `1★ / 3` unique clears + `1 🌿 Zen Blessing / 4` unique clears), and `'TIMED'` (`TIMED-BOMB-01` move-paced fuses, `1–3★`). Every mode switch loads a clean Move-0 board (`boardPlayMode = activeMode`, `undoStack = []`, `preRestartSnapshot = null`, active drags/targeting cancelled) without clobbering a higher `modeState[mode].currentLevelId` frontier bookmark.
   - **Genuine-Clear Progression, 3-Skip Cap & Streak Integrity (`ZEN-SKIP-GUARD-01`, `STREAK-INTEGRITY-01`)**: Free skips exist strictly in `'ZEN'`, cap at `ZEN_MAX_CONSECUTIVE_SKIPS = 3` trailing un-cleared stages (`canSkipZenLevel`), and **never** advance global Power-Up unlocks (`getEffectiveBoosterUnlockLevel`, which ignores un-cleared Zen skip frontier inflation) or Milestone Chests (every `10` unique genuinely cleared stages via `countUniqueClearedLevels`). `winStreak` increments strictly on per-mode first clears (`!isZenRun && isFirstClear`), pauses across normal `'ZEN'` play, `Restart`, and `‹ Map` exits, and resets to `0` on failure or mid-run `CHALLENGE`/`TIMED` mode switch (`isBoardRunStarted(board)`).
   - **Boosters & Undo Integrity (`UNDO-RES-01`)**: `UNDO (L1, 60c)`, `HINT (L2, 80c: hintMove + 2 Free Moves, or +10s in TIMED)`, `HAMMER (L8, 140c)`, `ROCKET (L18, 220c)`, `VACUUM (L30, 350c)`. Always use `carryLiveResourcesIntoUndo` (preserving live `timerRunning` across Move-0 undos in `TIMED`), charge before applying, clear `undoStack` on `HAMMER`/`ROCKET`/`VACUUM`, and keep `#level-jump-input` locked to `1 .. modeState[activeMode].highestUnlocked`.
2. **Local Process, Port & Sandbox Execution SOP (`SANDBOX-SOP-01`)**:
   - **Never leak Vite or Chromium processes.** Spawn `./node_modules/.bin/vite` directly (never `npx vite`). Strict ports: Playwright `4178` ([`playwright.config.ts`](playwright.config.ts)), visual harness `4179` ([`scripts/visual-harness.ts`](scripts/visual-harness.ts)).
   - **Sandbox vs. `BypassSandbox: true` First-Try Matrix (DO NOT WASTE FAILED ATTEMPTS)**:
     - **Mutating `git` (`add`, `commit`, `reset`, `checkout`, `switch`, `stash`, `rebase`, `merge`, `tag`, `fetch`, `pull`, `push`) $\rightarrow$ `BypassSandbox: true` on FIRST call**, as standalone prefix-matchable commands (`git add -A`, then `git commit -m "..."` — no `&&`, `$()`, or heredocs). Read-only `git` (`status`, `diff`, `log`, `show`) uses `BypassSandbox: false`.
     - **Loopback Browser/Server Suites $\rightarrow$ `BypassSandbox: true` on FIRST call**: `./node_modules/.bin/playwright test ...` and `./node_modules/.bin/tsx scripts/visual-harness.ts` (invoke `./node_modules/.bin/*` directly for clean prefix approval reuse).
     - **Sandboxed (`BypassSandbox: false`)**: `npm run lint`, `npm run lint:fix`, `npm run test:unit`, `npm run build`, `./node_modules/.bin/tsx scripts/generate-icons.ts`, and LAN HTTPS server `./node_modules/.bin/vite --config vite.lan.config.ts` (`IsDaemon: true`, `0.0.0.0:8443` — kill daemon task when done).
3. **100% Booster-Free Solvability & 3-Tier Challenge Ramp (`UX-03`, `RAMP-01`–`05`, `C1-03`)**:
   - Every campaign (`1..300`) and Endless (`301+`) stage must pass `solveBoard()` without boosters and with zero cell overlaps: `L1–12` enforce `verifyFirstMoveSafety()` (`UX-03`), `L13–25` keep onboarding gate/queue rescues, and `L26+` disable normal-move silent bailouts while preserving `C1-03` Zero-Softlock rescues on `createBoardState` and Booster strikes.
4. **Sacred-Geometry Sanctuary Visuals, 120Hz Canvas & Anti-"Default-LLM-UI" Rules**:
   - Preserve the 3-plane tactile stone UI (`UI-DEPTH-01`), Sanctuary-Anchored Mode Lighting (`MODE-AMBIENCE-01`: ~65% Nocturnal Indigo-Obsidian Sanctuary / ~35% mode cues, `opacity: 0.28` Map whisper, `1.05s cubic-bezier(0.37, 0, 0.22, 1)` `#app-shell::before` / `.mode-ambience-backdrop` compositor cross-fade), self-hosted `Fraunces` + `Plus Jakarta Sans` variable `.woff2` fonts (`TYPOGRAPHY-01` — never use external font CDNs), full `8 Settings × 15 Cosmetics` compatibility (`AX-01`, `AX-02`, `zCbSymbol = 0.692`), sculpted 3D modifiers, and opaque `blueprintAlpha = 1.0` Satin Astrolabe Title rendering (`MYSTIC-RELIC-01`, zero CSS `filter` on `#game-canvas`, `0px` canvas layout shift via `TITLE-TRANSITION-01`, `VIEWPORT-01` without `viewport-fit=cover`).
   - Never use raw Tailwind `#0f172a` boxes, unstyled checkboxes, or the `🪙` emoji (use `.coin-emblem` or `Coins`). Keep `#game-toast` directly inside `#app-shell` and `closedby="none"` on `#dialog-victory` / `#dialog-failure` (`PLAY-02`).
   - **Self-Contained Comment Hygiene**: Code comments, tests, and docs must reference only self-contained domain concepts or invariant IDs—never transient review rounds or plan step numbers.
5. **Live Player Save Backward-Compatibility & Append-Only Migration (`SAVE-COMPAT-01`)**:
   - Real players have active saves in `localStorage` (`'shredblocks.save.v1'`), `IndexedDB` (`'ShredBlocksDB'`), `.json` backups, and `SB1-...` / QR codes. **Never** break existing saves or wipe player progress.
   - Keep cosmetic/tier index arrays (`SKIN_IDS`, `TRAY_IDS`, `PARTICLE_IDS`, `QUALITY_TIERS`) and `sFlags` bits in [`src/storage/save-code.ts`](src/storage/save-code.ts) strictly **append-only**. Add new save fields with safe defaults in `sanitizeSavePayload`, append-only tagged binary trailers (after `0xa5`), and sequential forward-migration functions tested against frozen v1 fixtures in [`tests/unit/save-security.test.ts`](tests/unit/save-security.test.ts).

---

## 2. On-Demand Deep-Dive Reference Docs (Load Before Modifying a Domain!)

Before editing code, shaders, levels, styles, icons, or storage in any domain below, **call `read_file` on the matching reference guide** (index in [`docs/ARCHITECTURE_AND_RULES.md`](docs/ARCHITECTURE_AND_RULES.md)):

| Reference File | Load Before Editing... | Key Specs Inside |
| :--- | :--- | :--- |
| **[`docs/PHYSICS_AND_MECHANICS.md`](docs/PHYSICS_AND_MECHANICS.md)** | `src/core/*`, `src/input/*`, `src/render/camera-3d.ts` | Grid/3D math, `screenToBoardRayPlane`, swept 2D glide & corner bevels (`DRAG-02/04`), gate span/axis clearance, mid-drag capture, Mystery Vault stasis (`VAULT-01/02`), `ROCKET-AIM-01`, `ORIGIN-GHOST-01`, `MYSTIC-TRACE-01` corridor, 9-step `resolveClearCascade`, `C1-03` 4-entry-point parity. |
| **[`docs/RENDERING_AND_SHADERS.md`](docs/RENDERING_AND_SHADERS.md)** | `src/render/*`, `src/audio/*`, title/relic CSS & FX | 4-Pass WebGL2 & Canvas2D parity, `plinthSpans` 120Hz rule, Z-layer table (`0.000 .. zCbSymbol = 0.692`), 5 skins (`classic_studs` default, `relic_stone` `250c` worn chamfers + `runeDist`), 5 tray materials, 5 shred animations + WCAG Gate Seals (`SHRED-STYLE-01`), single-quad `u_materialStyle = 8` tapered motion-blur smear (`MYSTIC-TRACE-01`), Satin Astrolabe shader, zero-filter `#game-canvas`, `.astrolabe-backlight-halo`, prewarmed `0.58s` `RELIC-AWAKEN-01` burst, `IDLE-01..06`, `fxRandom()`. |
| **[`docs/PROGRESSION_AND_ECONOMY.md`](docs/PROGRESSION_AND_ECONOMY.md)** | `src/levels/*`, `src/core/board*.ts`, rewards/chests | 6 epochs (`1..300` + `301+`), `RAMP-01` `decPos === 6` breathers, `RAMP-02..05` modifier/fuse budgets, `L1–12` / `L13–25` / `L26+` rules, Challenge/Zen/Timed math, coalescing, `STARS-SLACK-01`, `TIMED-BOMB-01`, `STUCK-01`, Economy v2 payouts & chests. |
| **[`docs/UI_PWA_STORAGE_AND_SEO.md`](docs/UI_PWA_STORAGE_AND_SEO.md)** | `index.html`, `public/*`, `src/ui/*`, `src/styles/*`, `src/storage/*`, `scripts/generate-icons.ts`, `vite.config.ts` | Title FTUE/returning dock (`TITLE-DOCK-FIT-01`), `TYPOGRAPHY-01`, `UI-DEPTH-01`, `UI-BTN-COLOR-01` + `@media (hover: hover)`, `MODE-AMBIENCE-01` astrolabe & rim framing + `"Settings"` modal, O(1) Linked Sanctuary Map (`MAP-LINKED-PATH-01`), `VIEWPORT-01`, `NAV-HISTORY-01`, Zen Mystic icons (`r <= 190` maskable, `180×180` iOS), Cloudflare Pages `favicon.ico` (`16/32/48`) + `1200×630` `og-image.png` + `_headers` / `robots.txt` / `sitemap.xml` / JSON-LD (`SEO-OG-FAVICON-01`), `PWA-UPDATE-01`, dual-layer `SB1-...` 53-bit save codec (`STOR-01..02`, `qrCompact`), `SAVE-SEC-01` CSP. |

---

## 3. Directory & Module Map (`ARCH-ERGONOMICS-01`: `<= 800 lines` & `<= 45,000 bytes` per file)

Every repository text/SVG file (except `package-lock.json`) is enforced `<= 800 lines` and `<= 45,000 bytes` (aim `<= 750 lines`) by [`tests/unit/sanctums-and-architecture.test.ts`](tests/unit/sanctums-and-architecture.test.ts). Domain barrels re-export extracted sub-modules:

| Path | Responsibility |
| :--- | :--- |
| [`index.html`](index.html) & [`src/ui/dialogs-template.ts`](src/ui/dialogs-template.ts) | SPA shell (`#screen-home`, `#screen-game`, `#screen-themes`, `#title-overlay`), CSP, SEO/OG/Twitter/JSON-LD head tags + lazy `<dialog>` modals. |
| [`src/main.ts`](src/main.ts) & [`src/ui/*.ts`](src/ui/) | `ShredBlocksApp` orchestrator + modular views (`catalog-meta`, `boosters-controller`, `hud-and-title-view`, `outcome-modals-view`, `roadmap-and-themes-view`, `modals-and-save-transfer`, `dom-events-and-pwa`, compile-time `lan-devtools`). |
| [`src/styles/main.css`](src/styles/main.css) & [`src/styles/*.css`](src/styles/) | Ordered CSS barrel: `tokens-and-shell`, `screen-home`, `roadmap-path`, `screen-game`, `booster-dock`, `themes-and-nav`, `dialogs`, `title-and-a11y`. |
| [`src/core/*.ts`](src/core/) | `types`, `polyomino` (19 shapes), `physics` & `room-and-occupancy`, `gate-clearance` & `shred-side-effects`, `board` & `board-state`, `fx-random`. |
| [`src/levels/*.ts`](src/levels/) | `catalog` & `curated-early` (`1..300` + O(1) `getCampaignRoadmapMeta`), `generator*` (`82..300` & Endless `301+`), `solver` (Zobrist A\* `solveBoard` & hints). |
| [`src/render/*.ts`](src/render/) | `camera-3d`, `atlas-3d`, `mesh-generator` & `mesh-primitives`, `renderer-3d`, `render-types`, `shaders-*`, `pass1..3*`, `path-trace-ribbon`, `particle-fx`, `shred-style-fx`, `relic-awakening-fx`, `canvas2d-fallback`. |
| [`src/input/*.ts`](src/input/) & [`src/audio/*.ts`](src/audio/) | Pointer/touch drag controller (`pointer-controller`, `targeting-and-keyboard`) and procedural Web Audio synthesizer (`synth`, `synth-voices`). |
| [`src/storage/*.ts`](src/storage/) | `save-manager` (`localStorage` + `IndexedDB`), `save-mode-ladders` (`modeState` + `[0xa6, 0x4d]` trailer), `save-code` (53-bit `SB1-...` + LZ77 + CRC32), `qr-svg` (ISO 18004 QR SVG). |
| [`public/*`](public/) & [`scripts/*`](scripts/) | Zen Mystic `icon*.{svg,png}`, `apple-touch-icon.png`, `favicon.ico` / `favicon-*.png`, `og-image.png`, `_headers`, `robots.txt`, `sitemap.xml`, `manifest.webmanifest`, `sw.js`, `fonts/*.woff2`, `generate-icons.ts`, `visual-harness.ts`. |
| [`tests/unit/*.test.ts`](tests/unit/), [`tests/e2e/*.spec.ts`](tests/e2e/), [`tests/visual/*`](tests/visual/) | 8 Vitest unit/solver/security/FX/ladder suites (`75+` tests), 28+ Playwright E2E specs, and 18 deterministic visual golden snapshots. |

---

## 4. Mandatory Ludological Impact Gate & Verification Workflow

0. **Mandatory 5-Question Ludological Impact Gate (`LUDO-CORE-01`)**:
   - Before editing any play mode, booster, skip, continue, undo, streak, chest, payout, price, or progression rule, load [`docs/PROGRESSION_AND_ECONOMY.md`](docs/PROGRESSION_AND_ECONOMY.md) and verify all 5 conservation invariants hold (`false` to exploits, `true` to balance):
     1. *Zero Infinite Faucets*: Replaying, restarting, undoing, skipping, or switching modes can never farm unbounded Coins, Stars, Zen Blessings, Streaks, or Chests.
     2. *Strict Mode State Isolation (`MODE-ISOLATION-01`)*: `undoStack`, `preRestartSnapshot`, `freeMovesRemaining`, `freezeRemainingSec`, `bombsInert`, `timerRunning`, and active drags never cross a mode boundary.
     3. *Genuine-Clear Gating (`ZEN-SKIP-GUARD-01`)*: `0`-cost Zen skips (`<= 3` consecutive) never advance global Power-Up unlocks (`L2/8/18/30`), Milestone Chests (`every 10 unique clears`), or `winStreak`.
     4. *100% Booster-Free Solvability & Faucet/Sink Equilibrium*: Every stage stays `solveBoard()`-solvable without boosters while booster sinks (`60..350c`), Continue (`150c` / `1 🌿`), and cosmetics (`250..1200c`) stay balanced against first-clear vs. `20%` replay rewards.
     5. *Append-Only Save Conservation (`SAVE-COMPAT-01`)*: Existing `v1`, `0xa5`, and `[0xa6, 0x4d]` saves migrate losslessly without resetting earned currency, stars, or unlocks.
1. **`npm run lint`** (`BypassSandbox: false`): Biome check across all files in `< 200ms` with `0` errors (`npm run lint:fix` to auto-format). No `biome-ignore` suppressions in `src/**/*.ts`.
2. **`npm run test:unit`** (`BypassSandbox: false`): Passes all `75+` unit, 300-level solver, ladder/anti-exploit, security, SEO/favicon, and `ARCH-ERGONOMICS-01` tests across 8 suites.
3. **`npm run build`** (`BypassSandbox: false`): `tsc --noEmit && vite build` (`0` errors, stamps `dist/sw.js` & `dist/version.json`). **Always build immediately before Playwright E2E, visual goldens, or `visual-harness.ts`**, which serve `dist/` via `vite preview`.
4. **`./node_modules/.bin/playwright test`** (`BypassSandbox: true`): Passes all `29+` E2E playtests (Desktop Chrome + Mobile Portrait).
5. **Visual Verification (when touching UI/CSS/3D/shaders/icons)**:
   - `./node_modules/.bin/playwright test -c playwright.visual.config.ts` (`BypassSandbox: true`, `18` deterministic snapshots; `--update-snapshots` after inspecting intentional changes).
   - `./node_modules/.bin/tsx scripts/generate-icons.ts` (`BypassSandbox: false`, regenerates icons, `favicon.ico`, `og-image.png`, and `29-launcher-icons-preview.png`).
   - `./node_modules/.bin/tsx scripts/visual-harness.ts` (`BypassSandbox: true`, `45` multi-viewport captures; reset High Contrast / Colorblind / default theme after custom captures).
6. **Adversarial Subagent Sign-Off (for non-trivial UI/UX/gameplay changes)**: Audit via Visual/UX, Gameplay/Mechanics, and Architecture/Ergonomics subagents until `0 P0 / 0 P1 / 0 P2` remain.

---

## 5. Public Repository Portability, Security & Upstream Hosting (`REPO-PORTABILITY-01`)

- **Public Repo Hygiene & Zero Machine-Specific Bindings (`REPO-PORTABILITY-01`)**:
  - This is a public open-source repository (`MIT`). **Never** commit secrets, API keys, tokens, `.env*` files, TLS private keys/certs (`.certs/`), Cloudflare `account_id`/`zone_id` values, private LAN IPs, or machine-specific filesystem paths (`/Users/<user>`, `/home/<user>`, `C:\Users\<user>`, `.gemini/<dir>`).
  - All scripts, configs, and tests must resolve paths portably via `process.cwd()` or `fileURLToPath(new URL(..., import.meta.url))` (with optional env-var overrides like `VISUAL_OUT_DIR`), enforced automatically by [`tests/unit/sanctums-and-architecture.test.ts`](tests/unit/sanctums-and-architecture.test.ts).
- **Browser Support**: Baseline Widely Available + progressive enhancement (`@supports` `in oklab`/`in oklch`, `devicePixelContentBoxSize` with `devicePixelRatio` fallback).
- **Upstream Fork Customization**: Only `https://shredblocks.skorupski.org` references ([`index.html`](index.html), [`public/robots.txt`](public/robots.txt), [`public/sitemap.xml`](public/sitemap.xml), [`src/storage/save-manager.ts`](src/storage/save-manager.ts)) and optional Cloudflare config ([`wrangler.jsonc`](wrangler.jsonc), [`public/_headers`](public/_headers)) are deployment-specific; `dist/` runs on any static host.
