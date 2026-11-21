# Agent Verification, Harnesses & Troubleshooting Playbook (`AGENT-HARNESS-01`)

On-demand operational guide for running zero-error builds, multi-viewport visual probes, Playwright suites, and custom browser checks without hitting Node ESM resolution errors, port collisions, stale `dist/` bundles, or sandbox re-prompts.

---

## 1. Golden Verification Sequence & Port Ownership Map

Always run verification in this order so `dist/` is fresh before any preview server starts:

| Step | Command | Sandbox Mode | Port | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **1. Fast Preflight** | `npm run verify:fast` | `BypassSandbox: false` | None | Runs `biome check` + all Vitest unit suites + `tsc --noEmit && vite build` (stamps fresh `dist/`). |
| **2. Targeted UI Probe** | `./node_modules/.bin/tsx scripts/ui-probe.ts ...` | `BypassSandbox: true` | `4180` (or `:8443` with `--lan`) | Fast scene & `VIEWPORT-MATRIX-01` screenshot + DOM overflow/clipping audit (`1–8` captures in `< 6s`). |
| **3. Visual Goldens** | `./node_modules/.bin/playwright test -c playwright.visual.config.ts` | `BypassSandbox: true` | `4178` (strict) | Deterministic 18-snapshot pixel-diff regression check (`--update-snapshots` for intentional UI changes). |
| **4. Full E2E Suite** | `./node_modules/.bin/playwright test` | `BypassSandbox: true` | `4178` (strict) | Full 78-playtest Desktop Chrome + Mobile Portrait suite (`playwright test --list` counts fast in `< 1s`). **Never run concurrently with Step 3** (shared port `4178`). |
| **5. Full 45-Shot Harness** | `./node_modules/.bin/tsx scripts/visual-harness.ts` | `BypassSandbox: true` | `4179` (strict) | Comprehensive 45-capture gallery across epochs, themes, accessibility modes, and viewports. |
| **6. Live LAN HTTPS Dev** | `./node_modules/.bin/vite --config vite.lan.config.ts` | `BypassSandbox: false` (`IsDaemon: true`) | `8443` (strict) | Live HMR HTTPS server (`0.0.0.0:8443`) with compile-time LAN DevTools enabled. |

---

## 2. Sandbox & Prefix-Matchable Command Rules (`SANDBOX-SOP-01`)

To keep command approvals reusable and prevent unnecessary user prompts or failed sandbox retries:
1. **Invoke `./node_modules/.bin/*` directly** for `playwright`, `tsx`, `vite`, and `biome` — never wrap in `npx`, `env`, `timeout`, or shell backgrounding `&`.
2. **Pass output paths via CLI flags (`--out-dir`), not leading `VAR=val` env prefixes**:
   - **Good (prefix-matchable)**: `./node_modules/.bin/tsx scripts/ui-probe.ts --scene pause-expanded --out-dir <artifact-dir>`
   - **Avoid (breaks prefix matching)**: `VISUAL_OUT_DIR=<artifact-dir> ./node_modules/.bin/tsx ...`
3. **Never chain `BypassSandbox: true` commands with `&&`, `;`, or `$()`**: Run `npm run verify:fast` (`BypassSandbox: false`) first, then run `./node_modules/.bin/tsx scripts/ui-probe.ts ...` (`BypassSandbox: true`) as its own standalone command.
4. **Mutating `git` commands** (`git add -A`, `git commit -m "..."`, and `git push` only when explicitly requested by the user) use `BypassSandbox: true` on the **first** call as separate standalone commands; read-only `git` (`status`, `diff`, `log`, `show`) uses `BypassSandbox: false`.

---

## 3. Fast Scene & Multi-Viewport Inspection (`scripts/ui-probe.ts`)

Before writing any custom Playwright script, check if [`scripts/ui-probe.ts`](../scripts/ui-probe.ts) already covers the check. Because it lives inside `scripts/`, TypeScript, Biome, `@playwright/test`, Chrome Metal WebGL2 flags, `SIGKILL` server cleanup, and `auditViewportGeometry` work out of the box:

```sh
# 1. Inspect expanded Settings Cosmetics drawer across all 8 VIEWPORT-MATRIX-01 tiers (writes PNGs + probe-audit.json)
./node_modules/.bin/tsx scripts/ui-probe.ts --scene pause-expanded --viewports matrix --out-dir <artifact-dir>

# 2. Compare collapsed starter Settings, owned Settings, and locked Themes Studio on mobile + desktop
./node_modules/.bin/tsx scripts/ui-probe.ts --scene pause,pause-owned,themes-locked --viewports mobile,desktop --out-dir <artifact-dir>

# 3. Inspect a specific stage/mode with High Contrast + Colorblind against the running LAN HTTPS server (:8443)
./node_modules/.bin/tsx scripts/ui-probe.ts --scene game --level 91 --mode TIMED --high-contrast --colorblind --lan --out-dir <artifact-dir>

# 4. Stress single-line headers (Install CTA + Resume CTA + 5-digit coins/stars) across the matrix (`SINGLE-LINE-HEADER-01`)
./node_modules/.bin/tsx scripts/ui-probe.ts --scene home,themes --viewports matrix --stress-chrome --out-dir <artifact-dir>

# 5. Capture deterministic 6-frame `RELIC-AWAKEN-01` Title stone-crust unwrapping progression (`0ms -> 700ms`)
./node_modules/.bin/tsx scripts/ui-probe.ts --scene relic-unwrap --level 25 --viewports mobile,desktop --out-dir <artifact-dir>

# 6. Compare first-time Burnished Gold Power-Up Unlock vs. calm Slate-Teal Stage Guide + #game-toast (`BANNER-CLEANUP-01`)
./node_modules/.bin/tsx scripts/ui-probe.ts --scene banners --viewports ultra-compact,mobile --high-contrast --out-dir <artifact-dir>
```

* **Built-in `--scene` targets**: `title`, `title-returning`, `home`, `game`, `pause`, `pause-owned`, `pause-expanded`, `themes`, `themes-locked`, `victory`, `failure`, `save-transfer`, `install`, `relic-unwrap`, `banners` (append `--pwa-update` to show `#pwa-update-toast`, or `--stress-chrome` to enable Install/Resume header CTAs and `99,999` economy counts).
* **Built-in `--viewports` specs**: `quick` (`390x844`, `667x375`, `1280x800`), `matrix` (all 8 `VIEWPORT-MATRIX-01` tiers: `320x568`, `360x640`, `390x844`, `480x800`, `667x375`, `844x390`, `768x1024`, `1280x800`), individual preset keys (`ultra-compact`, `compact`, `mobile`, `mid-split`, `landscape-se`, `landscape`, `tablet`, `desktop`, `desktop-wide`), or custom `WxH` dimensions (`412x915,1024x768`).
* **Automated Geometry Gate**: Every capture runs `auditViewportGeometry()` checking `docOverflowPx <= 0`, zero unwanted document/shell vertical scroll, off-game leaked-banner guards (`leaked-banner:#unlock-toast` / `#booster-target-banner` whenever Title is open or `#screen-game` is hidden), single-line `.top-economy-bar` (`wrapped:.top-economy-bar` for `SINGLE-LINE-HEADER-01`), `#pwa-update-toast` & `#title-overlay` bounds/label truncation, `.dialog-card` horizontal fit, top-to-bottom `.dialog-card` scroll reachability, non-truncated `.setting-row > span` labels, and zero protruding controls. Pass `--no-strict-audit` when intentionally capturing a broken layout before fixing it.
* **Visual Inspection & Mandatory User-Facing Screenshot Links (`VISUAL-SUMMARY-01`)**: `auditViewportGeometry()` validates DOM bounds and overflow, not curved-border or high-contrast visual overlap — always inspect `320×568` and `--high-contrast` PNGs via `read_file`. Whenever a task alters UI, CSS, layout, themes, 3D rendering, shaders, or icons, always include clickable `[basename.png](file:///...)` links to updated probe captures or visual goldens in the final user response (plus a carousel `.md` artifact in `<artifact-dir>` when showcasing multiple viewports/modes).

---

## 4. Reusable `.mts` Scratch Template (For Custom Interactive Checks)

When you need a custom multi-step interaction that `ui-probe.ts` does not model:
1. **Place the file in `<scratch-dir>/custom-check.mts`** (never inside `scripts/` or `tests/` unless it is a permanent repo test, and **always use `.mts`** so `tsx` runs it as ESM even outside the repository folder).
2. **Import [`scripts/lib/agent-harness.ts`](../scripts/lib/agent-harness.ts) via `pathToFileURL(path.resolve(process.cwd(), ...))`** — never write bare `import { chromium } from '@playwright/test'` in an external scratch directory (`ERR_MODULE_NOT_FOUND`), because Node resolves packages from the scratch file's directory rather than `process.cwd()`.

```ts
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = process.argv[2];

async function main(): Promise<void> {
  const harnessUrl = pathToFileURL(
    path.resolve(process.cwd(), 'scripts/lib/agent-harness.ts')
  ).href;
  const { VIEWPORT_PRESETS, auditViewportGeometry, seedPlayerSave, withHarnessSession } =
    await import(harnessUrl);

  await withHarnessSession({ outDir, useLan: false }, async (session) => {
    const { context, page } = await session.openViewportPage(VIEWPORT_PRESETS.mobile);
    try {
      await seedPlayerSave(page, {
        coins: 500,
        unlockedSkins: ['classic_studs', 'relic_stone'],
        equippedSkin: 'relic_stone',
      });
      await page.evaluate(() => {
        window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game');
        window.__SHREDBLOCKS_DEBUG__.loadLevel(12);
        window.__SHREDBLOCKS_DEBUG__.openModal('pause');
      });
      await page.locator('#btn-toggle-cosmetics-drawer').click();
      await page.waitForTimeout(160);

      const savedPath = await session.saveScreenshot(page, 'custom-check-mobile.png');
      const audit = await auditViewportGeometry(page, 'mobile-390x844');
      process.stdout.write(`Saved ${savedPath} (passed=${audit.passed})\n`);
      if (!audit.passed) {
        throw new Error(`Viewport audit failed: ${JSON.stringify(audit)}`);
      }
    } finally {
      await context.close();
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run with (`BypassSandbox: true`):
```sh
./node_modules/.bin/tsx <scratch-dir>/custom-check.mts <artifact-dir>
```

---

## 5. Common Repo-Specific Pitfalls & Instant Fixes

1. **Changes Not Showing Up in Playwright or `ui-probe` (`Stale dist/`)**:
   - Preview harnesses serve production `dist/` via `vite preview`. Always run `npm run verify:fast` or `npm run build` before browser runs (`agent-harness.ts` prints `[WARN] dist/ is older than modified source files` automatically if forgotten).
2. **`localStorage` Save Edits Reverted on `page.reload()` (`IndexedDB writeSeq`)**:
   - Dual-layer persistence (`localStorage` + `ShredBlocksDB` in IndexedDB) reconciles by highest `writeSeq` and `updatedAt`. Always use `seedPlayerSave(page, patch)` (or increment `save.writeSeq += 100` and `save.updatedAt = Date.now() + 60_000` before `localStorage.setItem` + reload).
3. **`node:*` Imports & `BROWSER-PURE-SRC-01`**:
   - [`scripts/node-builtins.d.ts`](../scripts/node-builtins.d.ts) provides ambient types for `node:fs`, `node:path`, `node:url`, `node:child_process`, `node:crypto`, `node:buffer`, and `process` in `scripts/`, `tests/unit/`, and `vite*.config.ts` (no `@ts-expect-error` needed). Browser code in `src/` must **never** import `node:*` or call `process.cwd` / `process.exit`.
4. **Template-Literal Backticks & Prod Bundle Leak Guard in [`src/ui/dialogs-template.ts`](../src/ui/dialogs-template.ts)**:
   - `DIALOGS_AND_TOAST_TEMPLATE` is a JS template literal: **never** place backticks (`` ` ``) inside its HTML or comments, and **never** mention dev-only phrases (`LAN DevTools`) inside production template strings/comments (`shred-styles-and-fx.test.ts` asserts zero LAN devtool string leaks in `dist/assets/*.js`).
5. **`tsx` / `esbuild` `ReferenceError: __name is not defined` Inside `page.evaluate()`**:
   - `tsx` compiles inner named functions (`const helper = () => ...` or `function helper() {}`) with `esbuild`'s `__name(fn, "helper")` wrapper, which throws `ReferenceError: __name is not defined` in Chrome unless `globalThis.__name` exists. `createViewportContext()` in [`scripts/lib/agent-harness.ts`](../scripts/lib/agent-harness.ts) pre-installs `globalThis.__name = (t) => t` automatically; if writing raw `page.evaluate()` in Playwright specs, prefer inline loops/expressions over nested named functions.
6. **Biome CSS `noDescendingSpecificity` Ordering**:
   - Place base rules (e.g. `.select-tactile`) **above** compound rules (`.setting-row .select-tactile`), and include full compound chains on state overrides (e.g. `body.reduced-motion .cosmetics-drawer-toggle .cosmetics-chevron-svg`) so override specificity never drops below base declarations.
7. **Public Repo Path Hygiene (`REPO-PORTABILITY-01`)**:
   - [`tests/unit/sanctums-and-architecture.test.ts`](../tests/unit/sanctums-and-architecture.test.ts) fails if any tracked/unignored repo file contains literal OS home paths or local agent config directory paths. Always pass external artifact directories at runtime via CLI `--out-dir` or `process.argv`.
8. **Vite `chunkSizeWarningLimit` Threshold (`BUNDLE-BUDGET-01`, `1,000 kB` Minified)**:
   - [`vite.config.ts`](../vite.config.ts) sets `SINGLE_BUNDLE_WARNING_LIMIT_KB = 1000` (`1 MB` minified / `~300 kB` gzipped) because ShredBlocks is an offline-first single-bundle PWA. If a future `vite build` ever crosses `1,000 kB` and triggers Vite's chunk-size warning, **do not** start splitting chunks or bumping the limit on your own—flag the warning to the user as a potential standalone architectural task, since offline-safe code-splitting is a major refactor.
9. **Exact Storage Key Constants in Playwright Specs (`localStorage` vs. IDB)**:
   - Never guess `localStorage` key strings from memory (`PWA_INSTALLED_STORAGE_KEY` uses underscores `'shredblocks_pwa_installed_v1'` in [`src/ui/catalog-meta.ts`](../src/ui/catalog-meta.ts), whereas `SAVE_STORAGE_KEY` uses dots `'shredblocks.save.v1'` in [`src/storage/save-manager.ts`](../src/storage/save-manager.ts)). Read or reference the exported constant directly.
10. **Sandbox Search Binary (`grep -rn`, Not `rg`)**:
    - `rg` (`ripgrep`) is not installed in the sandbox `PATH`; always use `grep -rn` or file-reading tools to avoid wasted failed commands.
11. **Antigravity `24,000`-Byte Rule File Cap (`RULE-BUDGET-01`)**:
    - Antigravity silently truncates `AGENTS.md` / `GEMINI.md` above `24,000` bytes. [`tests/unit/sanctums-and-architecture.test.ts`](../tests/unit/sanctums-and-architecture.test.ts) enforces `<= 23,500` bytes on `AGENTS.md` / `GEMINI.md` — keep deep domain specs in `docs/*.md` rather than growing `AGENTS.md`.
12. **Fast `./node_modules/.bin/tsc --noEmit` Preflight & Exact Signature Checks**:
    - Run `./node_modules/.bin/tsc --noEmit` (`~2s`, `BypassSandbox: false`) after editing TypeScript/test files before running the `35s` `npm run verify:fast` full solver suite, and inspect exact function signatures (`applyBoosterRocket(board, row, col, axis)`, `boardToScreen(colX, rowY)`) and live UI toast copy before writing test assertions.
13. **`tsx -e` CJS / Vitest Limits & System Chrome Channel (`launchAgentBrowser`)**:
    - `tsx -e "..."` evaluates as CJS (top-level `await` fails, and importing `tests/unit/*.test.ts` throws `Vitest cannot be imported in a CommonJS module`); wrap async `src/*` helpers in `(async () => { ... })()` or use an `.mts` scratch script. Never call bare `chromium.launch()` without `launchAgentBrowser()` / `channel: 'chrome'` (standalone Playwright `chromium_headless_shell` binaries are not installed).
14. **Upfront Root-Cause Headline Before Multi-Turn Async Suites**:
    - When sequential verification commands (`verify:fast`, `playwright test`, `playwright.visual.config.ts`) span multiple async turns, share a 1–2 sentence root-cause/fix summary before or alongside the first status wait rather than keeping the user waiting through bare status lines until the final turn.
15. **Pre-Split Data vs. Engine Modules (`<= 750` Lines), Post-Biome Line Checks & Zero Postfix `!` (`ARCH-ERGONOMICS-01`)**:
    - Before creating a multi-preset module or editing files already above `~770` lines (`src/main.ts`, `tests/e2e/*.spec.ts`), split static presets/tables (`*-presets.ts`, `*-meta.ts`) or relocate new E2E blocks into smaller sibling specs upfront. Because `biome check --write` wraps long expressions and can push a `795`-line file past `800` lines, always run `./node_modules/.bin/biome check --write` followed by `wc -l` on touched files **before** launching the `35s` `npm run verify:fast` suite. Never use TypeScript postfix `!` non-null assertions (`Biome lint/style/noNonNullAssertion` rejects `!`; use `?? fallback` + `expect(...)`).
16. **5-Tray Floor-Overlay Sweeps & Interactive Web Audio Audition Artifacts**:
    - Never tune subtle floor-plane overlays or reticles solely on default `industrial_slate` — verify across all 5 board trays (`industrial_slate`, `warm_birch`, `midnight_arcade`, `frosted_quartz`, `mint_studio`), inlaid `FLOOR_PATHS` (`L176`), and `--high-contrast`. For subjective procedural music/audio tuning (where screenshots cannot convey timbre or groove), build a standalone zero-dependency HTML Web Audio audition player in `<artifact-dir>` (validating JS syntax and harmonic intervals via `node -e`) so the user can compare palettes before touching `src/audio/*`.
17. **`text-box: trim-both cap alphabetic` + `overflow: hidden` Descender Clipping**:
    - `alphabetic` trims a text box's content edge strictly at the baseline, so combining it with `overflow: hidden` (for `text-overflow: ellipsis` on structured buttons/tabs) slices lowercase descenders (`g`, `j`, `p`, `q`, `y`) flat (`Play` → `Plav`, `Map` → `Mao`). Always pair it with `padding-block-end: 0.24em; margin-block-end: -0.24em;` on `.btn-label-text` so the padding clip-box clears descenders without shifting flex centering, and visually inspect `320×568` / `390×844` PNGs via `read_file`.
18. **Two-Tier Icon Density, Dynamic Multi-Digit CTAs, Top-Banner Canvas Clicks & `index.html` `45 kB` Cap**:
    - Never mix raw Unicode emojis with custom SVGs across related UI — share one vector `<symbol>` geometry, keeping interactive buttons **and** compact `10–13px` passive telemetry headers (`#zen-sanctuary-card`, `#hud-keystone-meta`, Map counters) as flat unboxed SVGs (`0` bezel/glow) while reserving glowing faceted `.inline-mode-icon` / `.inline-booster-icon` jewels for spacious callouts (toasts, targeting banners, milestone debuts, Victory rewards).
    - Size multi-item tab bars proportionally to label width rather than uniform `1fr` columns (`.bottom-tab-bar` `0.92fr 1.44fr ...`, `#map-mode-tabs` `1.27fr 0.83fr 0.9fr` at `<= 390px`) and test dynamic stage numbers across `1..5` digits (`#177`..`#99999`) at `320×568`.
    - In Playwright board tests, scan `BoardState` rows bottom-up (`r = rows - 1 .. 0`) when `#booster-target-banner` or a toast is open at the top of `#board-stage` so top banners never intercept `320×568` canvas clicks, and commit at least 1 move (`movesCommitted > 0`) before asserting `#btn-restart`'s Undo restore toast. Check `wc -c index.html` (`~44.9 kB` vs. `45,000`-byte `ARCH-ERGONOMICS-01` cap) before adding inline HTML/SVG markup.
19. **Post-Compaction `:8443` Daemon Shutdown & Decoupled Progression Sweeps**:
    - After a context compaction, an idle `IsDaemon: true` LAN server (`./node_modules/.bin/vite --config vite.lan.config.ts`) can temporarily report `status: CLEARED` in `manage_task` while its OS process is still listening on `:8443` (re-appearing as `RUNNING` once HMR logs fire). Check `manage_task` `list`/`status` after file edits (or verify `:8443` has no listener) before confirming the LAN server is stopped.
    - Whenever stage access (`modeState.ZEN.highestUnlocked` via skips) is decoupled from genuine-clear progression (`countUniqueClearedLevels`), sweep display-only debut copy (`BOOSTER_DEBUT_NOTES` / `resolveBoosterDebutToastNote`), range loops that assume `highestUnlocked` scales `O(clears)` (iterate `Object.keys(save.levelRecords)` instead of `start..end`), `qrCompact` record-cap slicing (keep genuinely cleared stages ahead of `zenSkipped` entries), and Save Transfer summary labels.
20. **Native `<dialog>` UA `overflow: auto` Width Flicker & `--update-snapshots` CLI Arg Order**:
    - Browser UA stylesheets default `<dialog>` to `overflow: auto`, so child `translateY(...)` entrance animations or drop shadows can transiently spawn a `15px` desktop scrollbar on the outer `<dialog>` (`520px -> 505px -> 520px`). Keep outer `.game-dialog` `overflow: visible` (scrolling lives strictly on inner `.dialog-card`) and avoid horizontal `scale()` overshoots on outcome modals.
    - Playwright's `-u / --update-snapshots [mode]` accepts an optional `[mode]` (`all | changed | missing | none`), so placing a positional spec path immediately after `--update-snapshots` misparses the path as `[mode]`. Always place positional spec paths **before** `--update-snapshots` (or pass `--update-snapshots=all`).
21. **Schema-Complete `SavePayloadV1` Seeding in `addInitScript` & Post-Reload SW Readiness (`PWA-UPDATE-01`)**:
    - Never write partial JSON stubs (`{ highestLevelUnlocked, coins }`) directly to `localStorage.setItem('shredblocks.save.v1', ...)` in raw Playwright `page.addInitScript`: `validateSavePayloadV1` (`SAVE-SEC-01`) rejects incomplete objects and falls back to a brand-new Level 1 FTUE save (where `#btn-title-map` and `#btn-title-themes` are hidden per `TITLE-DOCK-FIT-01`). Use `seedPlayerSave(page, patch)` in [`scripts/lib/agent-harness.ts`](../scripts/lib/agent-harness.ts) or pass a complete schema-valid `SavePayloadV1` fixture (`buildReturningSaveJson`).
    - Static `#title-overlay` HTML is visible on `framenavigated` before `window.load` and before `registerSw()` attaches `updatefound` listeners; after full-page reloads in E2E tests, wait for both `window.__SHREDBLOCKS_DEBUG__` and SW listener attachment before firing synthetic SW events. In production SW code ([`pwa-update-lifecycle.ts`](../src/ui/pwa-update-lifecycle.ts)), always prefer live `reg.waiting` (`state === 'installed'`) over cached `ServiceWorker` pointers and pair `controllerchange` with `statechange === 'activated'` + bounded stall fallback timers.
22. **Monotonic Vertex Rim Attributes, Secondary `TEXTURE1` Samplers & Multi-Cell Fracture Topology**:
    - Never encode perimeter material effects with a mid-range band-pass filter on an interpolated scalar vertex attribute (`v_uv.x` interpolating `0.0 -> 0.92` across a triangle crosses `[0.36..0.62]` and paints concentric interior target stripes across faces); use strictly monotonic thresholds (`0.0` interior/welds < `0.70/0.72` outer frame < `0.92..1.0` torn cracks/walls).
    - Keep secondary WebGL2 sampler textures (`u_relicClusterTex` on `TEXTURE1`) in `WeakMap`s outside `799`-line `renderer-3d.ts`, reference the global sampler uniform directly inside `GLSL_STONE_LIB` (no `sampler2D` helper function parameters), always restore `gl.activeTexture(gl.TEXTURE0)` before returning, guard optional `gl` texture methods for unit mocks, and keep [`tests/unit/perf-and-prewarm.test.ts`](../tests/unit/perf-and-prewarm.test.ts) mock stubs compact (`<= 800` lines post-Biome).
    - Compose non-convex multi-cell slabs from per-cell convex star-shaped `RelicSubCell` rings with `edgeFlags = 0` internal welds (`0` pull, `0` side walls, identical `rockJag`-inverted seam endpoints), weight `glowAffinity` by interior cell crack coverage (`avgCellScore`) rather than `maxEdgeGlow`, and capture multi-frame transition progressions with `./node_modules/.bin/tsx scripts/ui-probe.ts --scene relic-unwrap` rather than throwaway scratch scripts.
23. **Default-ON Feature Parity in Test Fixtures & Asymmetric `window.blur` Gates (`HAPTICS-01`)**:
    - Never leave default-ON features (`sfx`, `music`, `haptics`, `serviceWorker`, default theme) tested solely with helper fixtures (`buildReturningSaveJson` / unit stubs) that turn them off or omit the native browser API (`navigator.vibrate`, `AudioContext`, `navigator.serviceWorker`). Pair positive unit assertions + dynamic prototype enumeration (`Object.getOwnPropertyNames(SoundEngine.prototype)`) in [`tests/unit/haptics-coverage.test.ts`](../tests/unit/haptics-coverage.test.ts) with an unseeded Playwright E2E test in [`tests/e2e/booster-jewels-and-dynamic-cta.spec.ts`](../tests/e2e/booster-jewels-and-dynamic-cta.spec.ts) spying on real `navigator.vibrate` across Title Play, drag/shred, SFX-Off mode, and Settings toggle OFF/ON persistence.
    - **Mobile `window.blur` ≠ Backgrounded**: Whenever gating audio or haptics on `window.blur`, always pair capture-phase foreground recovery on `'touchstart'`, `'pointermove'`, and `'touchmove'` while `!document.hidden` (`MOVE_RECOVERY_EVENTS` in [`synth.ts`](../src/audio/synth.ts)), because mobile notification/gesture peeks, split-screen, WebAPKs, and DevTools focus can blur `window` without hiding `document`.
24. **3-Layer Live-Device Triage & Fast Playwright Count Sync**:
    - When investigating physical phone/laptop bug reports ("no vibration in Chrome", "update banner didn't reload"), audit all three layers before concluding: **(1)** `git log -p` history, **(2)** hardware & OS rules (`>= 10ms` LRA motor rise time vs. `4–8ms` micro-pulses, Android **Do Not Disturb (DND)** / Battery Saver / *Touch feedback* — note that Android DND silently mutes physical LRA vibration while `navigator.vibrate()` still returns `true` in JS even with *Touch feedback* ON, so always ask the user to verify DND/Battery Saver is off before building temporary device debug UIs — plus iOS WebKit lacking `navigator.vibrate` even inside Chrome for iOS), and **(3)** upstream browser bugs (e.g., Chromium `Blink>Vibration` Issue `436751434` returning `true` while dropping `<= 1000ms` pulses). Never ship spec-violating workarounds (like padding pulses past `1000ms`) that degrade compliant devices.
    - Run `./node_modules/.bin/playwright test --list` (`BypassSandbox: false`, `< 1s`) before updating E2E test counts in docs so `verify:fast` never has to run twice for count drift.
25. **Web Audio Mobile Anti-Static Rules (Persistent LFO `AudioParam` Leaks, Zero-Mutation Foreground `unlock()`, & Balanced Buffer Headroom)**:
    - When a persistent LFO/`GainNode` (`wowDepthGain` in [`src/audio/ambient-music.ts`](../src/audio/ambient-music.ts)) modulates per-note `AudioParam` targets (`osc.detune`), `osc.stop()` alone leaves finished `AudioParam` edges inside the persistent node's output fan-out graph, degrading audio-thread render-quantum budgets into static crackle over minutes of play — always disconnect `wowDepthGain.disconnect(osc.detune)` and finished voice nodes inside `osc.onended`.
    - Keep capture-phase `UNLOCK_EVENTS` (`pointerdown`, `pointerup`, `touchstart`, `touchend`, `click` in [`src/audio/synth.ts`](../src/audio/synth.ts)) zero-mutation on `musicGain`/`sfxGain` once already foregrounded (`!gainsMutedForBackground && ctx.state === 'running'`), anchor live gain changes with `cancelAndHoldAtTime` (`setSmoothGainTarget`), ramp note envelopes linearly to `0.0` (`2–3ms`) ahead of `osc.stop()`, and open `AudioContext` with `{ latencyHint: 'balanced' }` (with fallback) so mobile AAudio/CoreAudio absorbs main-thread CPU spikes without glitching.
26. **Visual-First Probe Order, `MODE-AMBIENCE-01` CSS Specificity Traps, Static `drop-shadow` Parity & Comment-Stripped Source Tests**:
    - When modifying CSS/UI visuals, always run the fast targeted `ui-probe.ts` (`~5s`) and visually inspect PNGs via `read_file` **before** launching the ~3-minute full Playwright E2E suite so CSS specificity or contrast tweaks are caught in seconds instead of triggering a second E2E pass.
    - Before styling any HUD, dock, or banner component variant (such as `.unlock-banner[data-banner-kind="..."]`), grep `#app-shell[data-play-mode` across `src/styles/` — high-specificity `MODE-AMBIENCE-01` rules (`body:not(.high-contrast) #app-shell[data-play-mode=...] #screen-game ...`) silently override lower-specificity base/attribute variants.
    - When optimizing GPU compositor layers, distinguish *animated* `filter: drop-shadow(...)` (per-frame SVG/canvas Gaussian re-rasterization — replace with static radial glows) from *static* text `filter: drop-shadow(...)` (rasterized once, `0` per-frame cost; replacing it with `text-shadow` changes blur sigma by `~2×` and breaks pixel-exact visual goldens).
    - In static source-code unit assertions against `.css`/`.ts` (e.g., [`tests/unit/gpu-pipeline-batching.test.ts`](../tests/unit/gpu-pipeline-batching.test.ts)), strip `/* ... */` and `// ...` comments before matching tokens so explanatory comments never cause false test failures.
27. **Dual-Program WebGL2 Custom Uniforms (`useMainProgram`) & Tight File-Budget Ceilings (`PERF-GPU-01`, `ARCH-ERGONOMICS-01`)**:
    - Any Pass 1–4 draw that uploads `mainProgram`-only uniforms (`uClipPlane`, `uCapColor`, `uTraceCount`, `uTracePts`, `uUseTexture`) must call `rctx.useMainProgram?.(gl)` first — never assume `mainProgram` stayed bound after opaque `solidProgram` draws.
    - Check tight `800`-line file ceilings before editing (`src/main.ts` `~795/800`, `tests/e2e/shredblocks.spec.ts` `~793/800`, `tests/e2e/navigation-and-endless.spec.ts` `~790/800`): extract cohesive helpers into leaf `src/ui/*` modules or place new E2E specs in sibling files with ample headroom, and keep `AGENTS.md` well below its `23,500`-byte `RULE-BUDGET-01` cap by routing detailed learnings into `docs/*.md`.
28. **Android Post-Swipe `TapSuppressionController` vs. `pointerup`, Structured-Button Child Spans & `:8443` LAN SW/HMR Gotchas (`OUTCOME-SKIP-01`, `LAN-SW-BYPASS-01`)**:
    - **Why synthetic CDP taps miss real Android `~300–500ms` CTA lockouts**: Headless CDP `Input.dispatchTouchEvent` (`touchStart` + `touchEnd`) and `.click()` synthesize `click` directly without Android OS `MotionEvent` fling velocity, whereas on physical Android Chrome (e.g. Samsung S24 Ultra), swiping the final block into a gate arms `TapSuppressionController` + `double_tap_timeout` + `8dp` thumb-roll slop, dropping or delaying the synthesized `GestureTap` (`click`) event on newly opened `<dialog>` CTAs for `~300–500ms` even though `pointerdown`/`pointerup` arrive at `0ms`. Always wire post-gesture outcome CTAs via `bindOutcomeModalCta` (`pointerdown` while `dialog.open` $\rightarrow$ immediate `pointerup` activation within `12px` slop $\rightarrow$ `500ms` trailing `click` deduplication + keyboard/`click()` fallback), release `#game-canvas` pointer capture inside `finalizeDragMove` before `onMoveCommitted`, and test E2E fast-skip by dispatching `pointerdown` + `pointerup` *without* a `click` event (followed by a deduplicated `click`).
    - **Structured button children & decorative `<canvas>` overlays**: Every child span inside `.btn-structured` (including `.btn-label-text`) must set `pointer-events: none` (paired with `touch-action: none` on `.dialog-actions > button, .dialog-actions > button *`) so `.dialog-card * { touch-action: pan-y }` never leaks onto button labels, keep `#victory-fx-canvas` strictly above `.dialog-actions` (`inset: 0 0 calc(40px + 1.15rem) 0`, `z-index: 2 < 3`), and synchronize `.inert = .hidden` on off-game screens (`#screen-home`, `#screen-themes`, `#menu-tab-bar`) so `dialog.showModal()` skips walking ~3,500 hidden roadmap nodes on Android `WebContentsAccessibilityImpl`.
    - **Vite HMR stdout illusion & `:8443` Service Worker bypass**: Vite's dev server logs `[vite] (client) hmr update / page reload` whenever `chokidar` sees a file save on disk *even when zero phone clients are connected or awake* — never treat Vite stdout logs as proof that a mobile device loaded new code. Keep `:8443` (`__SHREDBLOCKS_LAN_DEVTOOLS__` & `public/sw.js` `IS_LAN_DEV`) strictly SW-free (unregistering workers and purging `CacheStorage`) so mobile browsers without DevTools never get pinned to a Cache-First `/` shell.
