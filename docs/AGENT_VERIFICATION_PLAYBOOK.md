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
| **4. Full E2E Suite** | `./node_modules/.bin/playwright test` | `BypassSandbox: true` | `4178` (strict) | Full 54-playtest Desktop Chrome + Mobile Portrait suite. **Never run concurrently with Step 3** (shared port `4178`). |
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
4. **Mutating `git` commands** (`git add -A`, `git commit -m "..."`) use `BypassSandbox: true` on the **first** call as separate standalone commands; read-only `git` (`status`, `diff`, `log`, `show`) uses `BypassSandbox: false`.

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
```

* **Built-in `--scene` targets**: `title`, `title-returning`, `home`, `game`, `pause`, `pause-owned`, `pause-expanded`, `themes`, `themes-locked`, `victory`, `failure`, `save-transfer`, `install`.
* **Built-in `--viewports` specs**: `quick` (`390x844`, `667x375`, `1280x800`), `matrix` (all 8 `VIEWPORT-MATRIX-01` tiers: `320x568`, `360x640`, `390x844`, `480x800`, `667x375`, `844x390`, `768x1024`, `1280x800`), individual preset keys (`ultra-compact`, `compact`, `mobile`, `mid-split`, `landscape-se`, `landscape`, `tablet`, `desktop`, `desktop-wide`), or custom `WxH` dimensions (`412x915,1024x768`).
* **Automated Geometry Gate**: Every capture runs `auditViewportGeometry()` checking `docOverflowPx <= 0`, `.dialog-card` horizontal fit, top-to-bottom `.dialog-card` scroll reachability, non-truncated `.setting-row > span` labels, and zero protruding controls. Pass `--no-strict-audit` when intentionally capturing a broken layout before fixing it.

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
