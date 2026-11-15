/**
 * Reusable browser, preview-server, save-seeding, and multi-viewport geometry harness (`AGENT-HARNESS-01`).
 *
 * Designed for both in-repo verification scripts (`scripts/ui-probe.ts`) and external one-off
 * scratch scripts (`<appDataDir>/brain/<conversation-id>/scratch/*.mts`), eliminating:
 * - `@playwright/test` ESM resolution failures outside the repository root,
 * - missing `channel: 'chrome'` or Metal WebGL2 launch flags,
 * - stale `dist/` preview surprises and orphaned `vite preview` processes,
 * - self-signed TLS errors against `https://127.0.0.1:8443`,
 * - `ENOENT` missing output folders, and
 * - IndexedDB `writeSeq` clobbering when seeding `localStorage` save fixtures.
 */

import { type SpawnedChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test';

export { type Browser, type BrowserContext, chromium, type Page };

export const DEFAULT_PROBE_PORT = 4180;
export const DEFAULT_LAN_URL = 'https://127.0.0.1:8443';

export const CHROME_WEBGL_LAUNCH_ARGS = [
  '--use-angle=metal',
  '--enable-gpu-rasterization',
  '--ignore-gpu-blocklist',
] as const;

export interface ViewportPreset {
  name: string;
  width: number;
  height: number;
  isMobile: boolean;
  hasTouch: boolean;
  deviceScaleFactor: number;
}

/**
 * Canonical `VIEWPORT-MATRIX-01` presets spanning ultra-compact phones, flagship portrait,
 * mid-width split-screen, short mobile landscape, tablet, and desktop viewports.
 */
export const VIEWPORT_PRESETS: Record<string, ViewportPreset> = {
  'ultra-compact': {
    name: 'ultra-compact-320x568',
    width: 320,
    height: 568,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  compact: {
    name: 'compact-360x640',
    width: 360,
    height: 640,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  mobile: {
    name: 'mobile-390x844',
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  'mid-split': {
    name: 'mid-split-480x800',
    width: 480,
    height: 800,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  'landscape-se': {
    name: 'landscape-667x375',
    width: 667,
    height: 375,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  landscape: {
    name: 'landscape-844x390',
    width: 844,
    height: 390,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  tablet: {
    name: 'tablet-768x1024',
    width: 768,
    height: 1024,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  desktop: {
    name: 'desktop-1280x800',
    width: 1280,
    height: 800,
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 2,
  },
  'desktop-wide': {
    name: 'desktop-1440x900',
    width: 1440,
    height: 900,
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 2,
  },
};

export const MATRIX_VIEWPORT_KEYS = [
  'ultra-compact',
  'compact',
  'mobile',
  'mid-split',
  'landscape-se',
  'landscape',
  'tablet',
  'desktop',
] as const;

export const QUICK_VIEWPORT_KEYS = ['mobile', 'landscape-se', 'desktop'] as const;

/**
 * Parses a viewport selector string (`matrix`, `quick`, comma-separated preset names, or `WxH` dimensions).
 */
export function parseViewportSpec(spec: string): ViewportPreset[] {
  const trimmed = spec.trim().toLowerCase();
  if (!trimmed || trimmed === 'quick') {
    return QUICK_VIEWPORT_KEYS.map((k) => VIEWPORT_PRESETS[k]);
  }
  if (trimmed === 'matrix' || trimmed === 'all') {
    return MATRIX_VIEWPORT_KEYS.map((k) => VIEWPORT_PRESETS[k]);
  }

  const tokens = trimmed
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`Invalid empty --viewports specification: "${spec}"`);
  }

  return tokens.map((token) => {
    if (VIEWPORT_PRESETS[token]) {
      return VIEWPORT_PRESETS[token];
    }
    const dimMatch = token.match(/^(\d{2,4})x(\d{2,4})$/);
    if (dimMatch) {
      const width = Number(dimMatch[1]);
      const height = Number(dimMatch[2]);
      const isCoarse = width < 1024 || height <= 500;
      return {
        name: `custom-${width}x${height}`,
        width,
        height,
        isMobile: isCoarse,
        hasTouch: isCoarse,
        deviceScaleFactor: 2,
      };
    }
    throw new Error(
      `Unknown viewport "${token}". Use "quick", "matrix", a preset (${Object.keys(VIEWPORT_PRESETS).join(', ')}), or WxH (e.g. 412x915).`
    );
  });
}

export interface DistFreshnessStatus {
  exists: boolean;
  distMtimeMs: number;
  staleFiles: string[];
}

/**
 * Checks whether `dist/index.html` exists and whether any source file in `src/`, `public/`,
 * or `index.html` has been modified more recently than the last production build.
 */
export function checkDistFreshness(repoRoot = process.cwd()): DistFreshnessStatus {
  const distIndex = resolve(repoRoot, 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    return { exists: false, distMtimeMs: 0, staleFiles: [] };
  }

  const distMtimeMs = statSync(distIndex).mtimeMs;
  const staleFiles: string[] = [];

  const scanPath = (targetPath: string): void => {
    if (!existsSync(targetPath)) return;
    const st = statSync(targetPath);
    if (st.isFile()) {
      if (st.mtimeMs > distMtimeMs + 500) {
        staleFiles.push(relative(repoRoot, targetPath));
      }
      return;
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
        scanPath(join(targetPath, entry.name));
      }
    }
  };

  scanPath(resolve(repoRoot, 'index.html'));
  scanPath(resolve(repoRoot, 'src'));
  scanPath(resolve(repoRoot, 'public'));

  return { exists: true, distMtimeMs, staleFiles };
}

async function waitForHttpReady(url: string, proc: SpawnedChildProcess, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc.exitCode !== null) {
      throw new Error(
        `Vite preview exited prematurely with code ${proc.exitCode} for ${url} (port in use or sandbox blocked).`
      );
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (err) {
      const causeCode = String(
        (err as { cause?: { code?: string }; code?: string })?.cause?.code ||
          (err as { code?: string })?.code ||
          err
      );
      if (causeCode.includes('EPERM') || causeCode.includes('EACCES')) {
        throw new Error(
          `Loopback socket blocked by sandbox (${causeCode}). Re-run with BypassSandbox: true.`
        );
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting ${timeoutMs}ms for Vite preview server at ${url}`);
}

/**
 * Spawns `./node_modules/.bin/vite preview` on a dedicated strict port (default `4180`)
 * with guaranteed `SIGKILL` cleanup so child servers never leak on exit or crash.
 */
export async function startPreviewServer(options?: {
  port?: number;
  repoRoot?: string;
  allowStaleDist?: boolean;
}): Promise<{ baseUrl: string; stop: () => void }> {
  const repoRoot = options?.repoRoot ?? process.cwd();
  const port = options?.port ?? DEFAULT_PROBE_PORT;
  const freshness = checkDistFreshness(repoRoot);

  if (!freshness.exists) {
    throw new Error(
      'Missing dist/index.html. Run "npm run verify:fast" or "npm run build" before launching preview harnesses.'
    );
  }
  if (freshness.staleFiles.length > 0 && !options?.allowStaleDist) {
    const previewList = freshness.staleFiles.slice(0, 5).join(', ');
    const suffix = freshness.staleFiles.length > 5 ? ` (+${freshness.staleFiles.length - 5} more)` : '';
    process.stderr.write(
      `[WARN] dist/ is older than modified source files (${previewList}${suffix}). Run "npm run build" first so preview reflects latest edits!\n`
    );
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = spawn(
    './node_modules/.bin/vite',
    ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: repoRoot,
      stdio: 'ignore',
      detached: false,
    }
  );

  const stop = (): void => {
    if (proc.exitCode === null && !proc.killed) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore already-terminated child
      }
    }
  };

  process.on('exit', stop);
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    stop();
    process.exit(143);
  });
  try {
    await waitForHttpReady(baseUrl, proc);
    return { baseUrl, stop };
  } catch (err) {
    stop();
    throw err;
  }
}

/**
 * Launches system Google Chrome with hardware Metal WebGL2 flags matching Playwright configs.
 */
export async function launchAgentBrowser(options?: {
  headless?: boolean;
  ignoreCertificateErrors?: boolean;
}): Promise<Browser> {
  const args: string[] = [...CHROME_WEBGL_LAUNCH_ARGS];
  if (options?.ignoreCertificateErrors) {
    args.push('--ignore-certificate-errors');
  }
  return chromium.launch({
    channel: 'chrome',
    headless: options?.headless ?? true,
    args,
  });
}

/**
 * Creates a configured `BrowserContext` for a `ViewportPreset` with `ignoreHTTPSErrors: true`
 * so both local HTTP preview (`:4180`) and LAN HTTPS (`:8443`) work without certificate errors.
 */
export async function createViewportContext(
  browser: Browser,
  preset: ViewportPreset
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: preset.width, height: preset.height },
    deviceScaleFactor: preset.deviceScaleFactor,
    isMobile: preset.isMobile,
    hasTouch: preset.hasTouch,
    ignoreHTTPSErrors: true,
  });
  // tsx/esbuild compiles inner named functions inside page.evaluate() with __name(fn, "name").
  // Defining globalThis.__name before document scripts run prevents ReferenceError in Chrome.
  await context.addInitScript('globalThis.__name = function(target) { return target; };');
  return context;
}

/**
 * Mutates `localStorage['shredblocks.save.v1']` with automatic `writeSeq` and `updatedAt`
 * advancement so IndexedDB (`ShredBlocksDB`) never overwrites seeded test state on reload.
 */
export async function seedPlayerSave(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((overrides) => {
    const raw = localStorage.getItem('shredblocks.save.v1');
    const current = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const prevSeq = typeof current.writeSeq === 'number' ? current.writeSeq : 1;
    const next = {
      ...current,
      ...overrides,
      writeSeq: prevSeq + 100,
      updatedAt: Date.now() + 60_000,
    };
    localStorage.setItem('shredblocks.save.v1', JSON.stringify(next));
  }, patch);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__SHREDBLOCKS_DEBUG__));
}

export interface ViewportAuditReport {
  viewport: string;
  width: number;
  height: number;
  docOverflowPx: number;
  openDialogId: string | null;
  dialogCardOverflowPx: number;
  dialogScrollReachable: boolean;
  outOfBoundsControls: string[];
  passed: boolean;
}

/**
 * Audits the live page at its current viewport size for `VIEWPORT-MATRIX-01` compliance:
 * zero document horizontal overflow, zero `<dialog>` card overflow, full vertical scroll
 * reachability on open modals, and zero horizontally protruding buttons/inputs/selects.
 */
export async function auditViewportGeometry(
  page: Page,
  viewportLabel = 'custom'
): Promise<ViewportAuditReport> {
  return page.evaluate((label) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const docOverflowPx = Math.max(0, Math.round(document.documentElement.scrollWidth - width));

    const openDialog = document.querySelector<HTMLDialogElement>('dialog.game-dialog[open]');
    const openDialogId = openDialog ? openDialog.id || 'dialog' : null;
    let dialogCardOverflowPx = 0;
    let dialogScrollReachable = true;
    const outOfBoundsControls: string[] = [];

    if (openDialog) {
      const card = openDialog.querySelector<HTMLElement>('.dialog-card');
      if (card) {
        dialogCardOverflowPx = Math.max(0, Math.round(card.scrollWidth - card.clientWidth));
        const cardRect = card.getBoundingClientRect();
        const cardFitsViewport =
          cardRect.top >= -2 &&
          cardRect.bottom <= height + 2 &&
          cardRect.left >= -2 &&
          cardRect.right <= width + 2;

        const prevScroll = card.scrollTop;
        const visibleChildren: Element[] = [];
        for (const ch of Array.from(card.children)) {
          if (ch.hasAttribute('hidden')) continue;
          const cs = getComputedStyle(ch);
          if (cs.display !== 'none' && cs.visibility !== 'hidden') {
            visibleChildren.push(ch);
          }
        }
        card.scrollTop = 0;
        const firstRect = visibleChildren[0]?.getBoundingClientRect();
        const topReachable = !firstRect || firstRect.top >= cardRect.top - 2;
        card.scrollTop = card.scrollHeight;
        const lastRect = visibleChildren[visibleChildren.length - 1]?.getBoundingClientRect();
        const bottomReachable = !lastRect || lastRect.bottom <= cardRect.bottom + 3;
        card.scrollTop = prevScroll;
        dialogScrollReachable = cardFitsViewport && topReachable && bottomReachable;

        const controls = card.querySelectorAll('button, select, input:not([type="checkbox"]), summary');
        for (const ctrl of controls) {
          if (ctrl.closest('[hidden]')) continue;
          const cs = getComputedStyle(ctrl);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = ctrl.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          let insideHScroll = false;
          let cur: Element | null = ctrl.parentElement;
          while (cur && cur !== card) {
            const ox = getComputedStyle(cur).overflowX;
            if (ox === 'auto' || ox === 'scroll') {
              insideHScroll = true;
              break;
            }
            cur = cur.parentElement;
          }
          if (insideHScroll) continue;
          if (r.left < cardRect.left - 2 || r.right > cardRect.right + 2) {
            const cls = (ctrl.getAttribute('class') || '').trim().split(/\s+/).slice(0, 2).join('.');
            outOfBoundsControls.push(
              ctrl.id
                ? `#${ctrl.id}`
                : cls
                  ? `${ctrl.tagName.toLowerCase()}.${cls}`
                  : ctrl.tagName.toLowerCase()
            );
          }
        }

        for (const span of card.querySelectorAll<HTMLElement>('.setting-row > span')) {
          if (span.closest('[hidden]')) continue;
          if (span.scrollWidth > span.clientWidth + 1) {
            outOfBoundsControls.push(`truncated:${(span.textContent || '').trim()}`);
          }
        }
      }
    } else {
      const titleOpen = document.querySelector<HTMLElement>('#title-overlay:not([hidden])');
      const activeRoot = titleOpen ?? document.getElementById('app-shell');

      if (document.documentElement.scrollHeight > height + 1 || Math.round(window.scrollY) > 0) {
        outOfBoundsControls.push('doc-vertical-scroll');
      }

      if (titleOpen) {
        for (const ch of Array.from(titleOpen.children)) {
          if (ch.hasAttribute('hidden')) continue;
          const cs = getComputedStyle(ch);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = ch.getBoundingClientRect();
          if (r.top < -2 || r.bottom > height + 2) {
            const cls = (ch.getAttribute('class') || '').trim().split(/\s+/)[0];
            outOfBoundsControls.push(`clipped:${ch.id ? `#${ch.id}` : cls || ch.tagName.toLowerCase()}`);
          }
        }
      } else {
        const pwaToast = document.getElementById('pwa-update-toast');
        if (pwaToast && !pwaToast.hidden) {
          const r = pwaToast.getBoundingClientRect();
          if (r.left < -2 || r.right > width + 2 || r.top < -2 || r.bottom > height + 2) {
            outOfBoundsControls.push('clipped:#pwa-update-toast');
          }
          const labelEl = pwaToast.querySelector<HTMLElement>('.pwa-update-label');
          if (labelEl && labelEl.scrollWidth > labelEl.clientWidth + 1) {
            outOfBoundsControls.push('truncated:pwa-update-label');
          }
        }
        for (const barSel of [
          '#screen-home:not([hidden]) > .top-economy-bar',
          '#screen-themes:not([hidden]) > .top-economy-bar',
        ]) {
          const bar = document.querySelector<HTMLElement>(barSel);
          if (!bar) continue;
          const visibleCenters: number[] = [];
          for (const ch of Array.from(bar.children)) {
            if (ch.hasAttribute('hidden')) continue;
            const cs = getComputedStyle(ch);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const r = ch.getBoundingClientRect();
            if (r.height > 0 && r.width > 0) {
              visibleCenters.push(r.top + r.height * 0.5);
            }
          }
          if (visibleCenters.length > 1 && Math.max(...visibleCenters) - Math.min(...visibleCenters) > 6) {
            outOfBoundsControls.push('wrapped:.top-economy-bar');
          }
        }
        const homeScreen = document.getElementById('screen-home');
        if (homeScreen && !homeScreen.hidden) {
          const roadmapList = document.getElementById('roadmap-list');
          if (roadmapList && roadmapList.clientHeight < 64) {
            outOfBoundsControls.push('crushed:#roadmap-list');
          }
        }
        const themesScreen = document.getElementById('screen-themes');
        if (themesScreen && !themesScreen.hidden) {
          const themesScroll = themesScreen.querySelector<HTMLElement>('.themes-scroll');
          if (themesScroll && themesScroll.clientHeight < 64) {
            outOfBoundsControls.push('crushed:.themes-scroll');
          }
        }
      }

      if (activeRoot) {
        const controls = activeRoot.querySelectorAll('button, select, input:not([type="checkbox"])');
        for (const ctrl of controls) {
          if (ctrl.closest('[hidden]')) continue;
          const cs = getComputedStyle(ctrl);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = ctrl.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          let insideHScroll = false;
          let cur: Element | null = ctrl.parentElement;
          while (cur && cur !== activeRoot) {
            const ox = getComputedStyle(cur).overflowX;
            if (ox === 'auto' || ox === 'scroll') {
              insideHScroll = true;
              break;
            }
            cur = cur.parentElement;
          }
          if (insideHScroll) continue;
          if (r.left < -2 || r.right > width + 2) {
            const cls = (ctrl.getAttribute('class') || '').trim().split(/\s+/).slice(0, 2).join('.');
            outOfBoundsControls.push(
              ctrl.id
                ? `#${ctrl.id}`
                : cls
                  ? `${ctrl.tagName.toLowerCase()}.${cls}`
                  : ctrl.tagName.toLowerCase()
            );
          }
        }
      }
    }

    const passed =
      docOverflowPx <= 0 &&
      dialogCardOverflowPx <= 1 &&
      dialogScrollReachable &&
      outOfBoundsControls.length === 0;

    return {
      viewport: label,
      width,
      height,
      docOverflowPx,
      openDialogId,
      dialogCardOverflowPx,
      dialogScrollReachable,
      outOfBoundsControls,
      passed,
    };
  }, viewportLabel);
}

export interface HarnessSessionContext {
  browser: Browser;
  baseUrl: string;
  outDir: string;
  runtimeErrors: string[];
  openViewportPage: (preset: ViewportPreset) => Promise<{ context: BrowserContext; page: Page }>;
  saveScreenshot: (page: Page, filename: string) => Promise<string>;
}

/**
 * High-level session runner for one-off `.mts` scratch scripts or automated probes.
 * Automatically creates `outDir`, starts/stops `vite preview` (unless `lanUrl` is used),
 * launches Chrome with Metal WebGL2, records `pageerror`/`console.error`, and cleans up.
 */
export async function withHarnessSession<T>(
  options: {
    outDir?: string;
    useLan?: boolean;
    lanUrl?: string;
    port?: number;
    allowStaleDist?: boolean;
  },
  fn: (session: HarnessSessionContext) => Promise<T>
): Promise<T> {
  const outDir = resolve(options.outDir ?? join(process.cwd(), 'test-results', 'probe'));
  mkdirSync(outDir, { recursive: true });

  const server = options.useLan
    ? null
    : await startPreviewServer({ port: options.port, allowStaleDist: options.allowStaleDist });
  const baseUrl = options.useLan ? (options.lanUrl ?? DEFAULT_LAN_URL) : (server?.baseUrl ?? '');
  const browser = await launchAgentBrowser({ ignoreCertificateErrors: Boolean(options.useLan) });
  const runtimeErrors: string[] = [];

  try {
    const openViewportPage = async (
      preset: ViewportPreset
    ): Promise<{ context: BrowserContext; page: Page }> => {
      const context = await createViewportContext(browser, preset);
      const page = await context.newPage();
      page.on('pageerror', (err) => runtimeErrors.push(`[${preset.name}] PAGEERROR: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          runtimeErrors.push(`[${preset.name}] CONSOLE_ERROR: ${msg.text()}`);
        }
      });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.__SHREDBLOCKS_DEBUG__));
      return { context, page };
    };

    const saveScreenshot = async (page: Page, filename: string): Promise<string> => {
      const cleanName = filename.endsWith('.png') ? filename : `${filename}.png`;
      const fullPath = resolve(outDir, cleanName);
      mkdirSync(resolve(fullPath, '..'), { recursive: true });
      await page.screenshot({ path: fullPath });
      return fullPath;
    };

    return await fn({
      browser,
      baseUrl,
      outDir,
      runtimeErrors,
      openViewportPage,
      saveScreenshot,
    });
  } finally {
    await browser.close().catch(() => undefined);
    server?.stop();
  }
}
