import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHROME_WEBGL_LAUNCH_ARGS,
  checkDistFreshness,
  DEFAULT_PROBE_PORT,
  MATRIX_VIEWPORT_KEYS,
  parseViewportSpec,
  QUICK_VIEWPORT_KEYS,
  VIEWPORT_PRESETS,
} from '../../scripts/lib/agent-harness';
import { formatProbeHelp, PROBE_SCENES, parseProbeCliArgs } from '../../scripts/ui-probe';
import {
  CF_BEACON_SCRIPT_ID,
  GA4_SCRIPT_ID,
  injectAnalyticsScriptsNow,
  normalizeCfBeaconToken,
  normalizeGaMeasurementId,
  scheduleIdleAnalyticsInit,
} from '../../src/ui/telemetry-analytics';
import {
  buildIndexHtmlCsp,
  resolveAnalyticsBuildOptions,
  SINGLE_BUNDLE_WARNING_LIMIT_KB,
} from '../../vite.config';

describe('Agent Verification Harness, UI Probe & Node Type Hygiene (AGENT-HARNESS-01)', () => {
  it('AGENT-HARNESS-01: parses quick, matrix, named preset, and custom WxH viewport specs', () => {
    const quick = parseViewportSpec('quick');
    expect(quick.map((v) => v.width)).toEqual(QUICK_VIEWPORT_KEYS.map((k) => VIEWPORT_PRESETS[k].width));

    const matrix = parseViewportSpec('matrix');
    expect(matrix).toHaveLength(MATRIX_VIEWPORT_KEYS.length);
    expect(matrix[0]).toMatchObject({ width: 320, height: 568, isMobile: true, hasTouch: true });
    expect(matrix[matrix.length - 1]).toMatchObject({
      width: 1280,
      height: 800,
      isMobile: false,
      hasTouch: false,
    });

    const mixed = parseViewportSpec('compact, 412x915, 1366x768');
    expect(mixed).toHaveLength(3);
    expect(mixed[0]).toMatchObject({ width: 360, height: 640, isMobile: true });
    expect(mixed[1]).toMatchObject({ name: 'custom-412x915', width: 412, height: 915, isMobile: true });
    expect(mixed[2]).toMatchObject({
      name: 'custom-1366x768',
      width: 1366,
      height: 768,
      isMobile: false,
      hasTouch: false,
    });

    expect(() => parseViewportSpec('unknown-device')).toThrow(/Unknown viewport/);
    expect(() => parseViewportSpec(' , ')).toThrow(/Invalid empty/);
  });

  it('AGENT-PROBE-01: validates CLI flags, scenes, modes, ports, and help output for scripts/ui-probe.ts', () => {
    const parsed = parseProbeCliArgs([
      '--scene',
      'pause-expanded,themes-locked,victory',
      '--viewports',
      'ultra-compact,landscape-se,desktop',
      '--level',
      '41',
      '--mode',
      'timed',
      '--high-contrast',
      '--colorblind',
      '--reduced-motion',
      '--lan',
      '--port',
      '4185',
      '--out-dir',
      'test-results/custom-probe',
      '--prefix',
      'settings audit!',
      '--no-strict-audit',
    ]);

    expect(parsed.scenes).toEqual(['pause-expanded', 'themes-locked', 'victory']);
    expect(parsed.viewports.map((v) => v.width)).toEqual([320, 667, 1280]);
    expect(parsed.levelId).toBe(41);
    expect(parsed.mode).toBe('TIMED');
    expect(parsed.highContrast).toBe(true);
    expect(parsed.colorblind).toBe(true);
    expect(parsed.reducedMotion).toBe(true);
    expect(parsed.useLan).toBe(true);
    expect(parsed.port).toBe(4185);
    expect(parsed.outDir).toBe(path.resolve(process.cwd(), 'test-results/custom-probe'));
    expect(parsed.prefix).toBe('settings-audit-');
    expect(parsed.strictAudit).toBe(false);
    expect(parsed.help).toBe(false);

    const helpParsed = parseProbeCliArgs(['--help']);
    expect(helpParsed.help).toBe(true);
    const helpText = formatProbeHelp();
    for (const scene of PROBE_SCENES) {
      expect(helpText).toContain(scene);
    }
    expect(DEFAULT_PROBE_PORT).toBe(4180);
    expect(CHROME_WEBGL_LAUNCH_ARGS).toContain('--use-angle=metal');

    expect(() => parseProbeCliArgs(['--scene', 'nonexistent'])).toThrow(/Unknown scene/);
    expect(() => parseProbeCliArgs(['--level', '0'])).toThrow(/Invalid --level/);
    expect(() => parseProbeCliArgs(['--mode', 'ARCADE'])).toThrow(/Invalid --mode/);
    expect(() => parseProbeCliArgs(['--port', '80'])).toThrow(/Invalid --port/);
    expect(() => parseProbeCliArgs(['--bogus'])).toThrow(/Unknown CLI flag/);
    expect(() => parseProbeCliArgs(['--out-dir'])).toThrow(/Missing value/);
  });

  it('AGENT-HARNESS-01: checkDistFreshness detects missing dist, fresh dist, and modified source files', async () => {
    const tempRoot = path.join(os.tmpdir(), `sb-freshness-test-${Date.now()}`);
    fs.mkdirSync(path.join(tempRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'public'), { recursive: true });

    try {
      fs.writeFileSync(path.join(tempRoot, 'index.html'), '<!doctype html>', 'utf8');
      fs.writeFileSync(path.join(tempRoot, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');

      // 1. Missing dist/index.html
      const missing = checkDistFreshness(tempRoot);
      expect(missing.exists).toBe(false);

      // 2. Fresh dist/index.html written after src/
      fs.mkdirSync(path.join(tempRoot, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, 'dist', 'index.html'), '<!doctype html>', 'utf8');
      const fresh = checkDistFreshness(tempRoot);
      expect(fresh.exists).toBe(true);
      expect(fresh.staleFiles).toEqual([]);

      // 3. Source file modified > 500ms after dist/index.html -> flagged as stale
      await new Promise((r) => setTimeout(r, 560));
      fs.writeFileSync(path.join(tempRoot, 'src', 'app.ts'), 'export const x = 2;\n', 'utf8');
      const stale = checkDistFreshness(tempRoot);
      expect(stale.exists).toBe(true);
      expect(stale.staleFiles).toEqual([path.join('src', 'app.ts')]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('BROWSER-PURE-SRC-01 & NODE-TYPES-HYGIENE-01: keeps src/ free of node:* APIs, removes @ts-expect-error Node workarounds, and keeps playbook template synced', () => {
    const repoRoot = path.resolve(process.cwd());

    const collectTsFiles = (dir: string, acc: string[] = []): string[] => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__goldens__') collectTsFiles(full, acc);
        } else if (entry.name.endsWith('.ts')) {
          acc.push(full);
        }
      }
      return acc;
    };

    // 1. Browser source files under src/ must never import node:* or call Node process methods
    const srcFiles = collectTsFiles(path.join(repoRoot, 'src'));
    expect(srcFiles.length).toBeGreaterThan(35);
    const srcViolations: string[] = [];
    for (const file of srcFiles) {
      const text = fs.readFileSync(file, 'utf8');
      if (/from\s+['"]node:/.test(text) || /\bprocess\.(cwd|exit|argv)\b/.test(text)) {
        srcViolations.push(path.relative(repoRoot, file));
      }
    }
    expect(srcViolations).toEqual([]);

    // 2. Zero leftover "@ts-expect-error Node built-in" or manual "declare const process" hacks
    const nonSrcFiles = [
      ...collectTsFiles(path.join(repoRoot, 'scripts')),
      ...collectTsFiles(path.join(repoRoot, 'tests')),
      path.join(repoRoot, 'vite.config.ts'),
      path.join(repoRoot, 'vite.lan.config.ts'),
      path.join(repoRoot, 'playwright.config.ts'),
      path.join(repoRoot, 'playwright.visual.config.ts'),
    ];
    const workaroundViolations: string[] = [];
    for (const file of nonSrcFiles) {
      const rel = path.relative(repoRoot, file);
      if (rel === path.join('tests', 'unit', 'agent-harness.test.ts')) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('@ts-expect-error Node built-in') || text.includes('declare const process')) {
        workaroundViolations.push(rel);
      }
    }
    expect(workaroundViolations).toEqual([]);

    // 3. Playbook template stays synced with real exports in scripts/lib/agent-harness.ts
    const playbookPath = path.join(repoRoot, 'docs', 'AGENT_VERIFICATION_PLAYBOOK.md');
    const playbook = fs.readFileSync(playbookPath, 'utf8');
    expect(playbook).toContain('scripts/lib/agent-harness.ts');
    expect(playbook).toContain('scripts/ui-probe.ts');
    expect(playbook).toContain('withHarnessSession');
    expect(playbook).toContain('seedPlayerSave');
    expect(playbook).toContain('auditViewportGeometry');
    expect(playbook).toContain('VIEWPORT_PRESETS');

    // 4. BUNDLE-BUDGET-01: 1,000 kB (1 MB) single-bundle warning threshold & user-escalation contract stay synced
    expect(SINGLE_BUNDLE_WARNING_LIMIT_KB).toBe(1000);
    const viteConfigText = fs.readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8');
    const agentsMdText = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    expect(viteConfigText).toContain('chunkSizeWarningLimit: SINGLE_BUNDLE_WARNING_LIMIT_KB');
    expect(agentsMdText).toContain('BUNDLE-BUDGET-01');
    expect(playbook).toContain('BUNDLE-BUDGET-01');
  });

  it('ANALYTICS-01: keeps forks tracker-free by default, stamps strict non-inline CSP when configured, and isolates offline/busy/blocker states', () => {
    const repoRoot = path.resolve(process.cwd());
    const baseHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
    const swJs = fs.readFileSync(path.join(repoRoot, 'public', 'sw.js'), 'utf8');
    expect(swJs).toContain("url.pathname.startsWith('/cdn-cgi/')");

    // 1. Strict ID/token validation rejects empty or hostile injection strings
    expect(normalizeGaMeasurementId(undefined)).toBe('');
    expect(normalizeGaMeasurementId('  g-ab12cd34ef  ')).toBe('G-AB12CD34EF');
    expect(normalizeGaMeasurementId('UA-12345-1')).toBe('');
    expect(normalizeGaMeasurementId('G-123"><script>alert(1)</script>')).toBe('');

    expect(normalizeCfBeaconToken(undefined)).toBe('');
    expect(normalizeCfBeaconToken('0123456789ABCDEF0123456789abcdef')).toBe(
      '0123456789abcdef0123456789abcdef'
    );
    expect(normalizeCfBeaconToken('not-a-hex-token')).toBe('');

    // 2. Default fork/dev build options keep CSP 100% unchanged ('self' only)
    const defaultOpts = resolveAnalyticsBuildOptions({});
    expect(defaultOpts).toEqual({ gaId: '', cfToken: '', enableCfAnalytics: false });
    expect(buildIndexHtmlCsp(baseHtml, defaultOpts)).toBe(baseHtml);

    // 3. Setting VITE_GA_MEASUREMENT_ID enables both GA4 + Cloudflare Web Analytics CSP without 'unsafe-inline' in script-src
    const bothOpts = resolveAnalyticsBuildOptions({ VITE_GA_MEASUREMENT_ID: 'G-TEST998877' });
    expect(bothOpts).toEqual({ gaId: 'G-TEST998877', cfToken: '', enableCfAnalytics: true });
    const bothHtml = buildIndexHtmlCsp(baseHtml, bothOpts);
    expect(bothHtml).toContain(
      "script-src 'self' https://www.googletagmanager.com https://static.cloudflareinsights.com;"
    );
    expect(bothHtml).toContain('https://*.google-analytics.com');
    expect(bothHtml).toContain('https://cloudflareinsights.com');
    const scriptSrcMatch = bothHtml.match(/script-src[^;]+/);
    expect(scriptSrcMatch?.[0]).not.toContain('unsafe-inline');
    expect(scriptSrcMatch?.[0]).not.toContain('unsafe-eval');

    // Explicit VITE_CF_WEB_ANALYTICS=false keeps only GA4 origins
    const gaOnlyOpts = resolveAnalyticsBuildOptions({
      VITE_GA_MEASUREMENT_ID: 'G-TEST998877',
      VITE_CF_WEB_ANALYTICS: 'false',
    });
    expect(gaOnlyOpts.enableCfAnalytics).toBe(false);
    expect(buildIndexHtmlCsp(baseHtml, gaOnlyOpts)).not.toContain('cloudflareinsights.com');

    // 4. Runtime DOM injection: genuine IArguments dataLayer, privacy flags, duplicate guard, and onerror cleanup
    interface MockScript {
      id: string;
      async: boolean;
      src: string;
      fetchPriority: string;
      attrs: Record<string, string>;
      removed: boolean;
      onerror: (() => void) | null;
      setAttribute(k: string, v: string): void;
      remove(): void;
    }
    const appendedScripts: MockScript[] = [];
    let existingEdgeCf: object | null = null;
    const prevWindow = (globalThis as { window?: unknown }).window;
    const prevDocument = (globalThis as { document?: unknown }).document;
    const prevNavigator = (globalThis as { navigator?: unknown }).navigator;

    const onlineListeners: Array<() => void> = [];
    const scheduledTimers: Array<() => void> = [];
    let mockOnline = false;

    const mockWin: Record<string, unknown> = {
      addEventListener: (ev: string, cb: () => void) => {
        if (ev === 'online') onlineListeners.push(cb);
      },
      setTimeout: (cb: () => void) => {
        scheduledTimers.push(cb);
        return scheduledTimers.length;
      },
      requestIdleCallback: (cb: () => void) => {
        cb();
        return 1;
      },
    };

    const mockDoc = {
      readyState: 'complete',
      head: {
        appendChild: (el: MockScript) => {
          appendedScripts.push(el);
          return el;
        },
      },
      getElementById: (id: string) => appendedScripts.find((s) => s.id === id && !s.removed) ?? null,
      querySelector: (sel: string) => (sel.includes('cloudflareinsights.com/beacon') ? existingEdgeCf : null),
      createElement: () => {
        const s: MockScript = {
          id: '',
          async: false,
          src: '',
          fetchPriority: 'auto',
          attrs: {},
          removed: false,
          onerror: null,
          setAttribute(k: string, v: string) {
            this.attrs[k] = v;
          },
          remove() {
            this.removed = true;
          },
        };
        return s;
      },
    };

    Object.defineProperty(globalThis, 'window', { value: mockWin, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'document', { value: mockDoc, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'navigator', {
      get: () => ({ onLine: mockOnline }),
      configurable: true,
    });

    try {
      // Offline + busy gating: zero scripts injected while offline, defers while busy, injects once online & idle
      let busy = true;
      scheduleIdleAnalyticsInit(() => busy, {
        gaId: 'G-TEST998877',
        cfBeaconToken: '0123456789abcdef0123456789abcdef',
      });
      expect(scheduledTimers).toHaveLength(1);
      scheduledTimers.shift()?.(); // runs while mockOnline === false
      expect(appendedScripts).toHaveLength(0);
      expect(onlineListeners).toHaveLength(1);

      // Reconnect online while player is actively dragging (busy === true) -> yields without injecting
      mockOnline = true;
      onlineListeners.shift()?.();
      expect(scheduledTimers).toHaveLength(1);
      scheduledTimers.shift()?.(); // busy === true -> re-schedules
      expect(appendedScripts).toHaveLength(0);
      expect(scheduledTimers).toHaveLength(1);

      // Drag ends (busy === false), Cloudflare already edge-injected beacon -> injects GA4 only (no duplicate CF)
      busy = false;
      existingEdgeCf = { edgeInjected: true };
      scheduledTimers.shift()?.();
      expect(appendedScripts).toHaveLength(1);
      expect(appendedScripts[0]?.id).toBe(GA4_SCRIPT_ID);
      expect(appendedScripts[0]?.async).toBe(true);
      expect(appendedScripts[0]?.fetchPriority).toBe('low');

      const dl = mockWin.dataLayer as IArguments[];
      expect(dl).toHaveLength(2);
      expect(Object.prototype.toString.call(dl[0])).toBe('[object Arguments]');
      expect(dl[1]?.[0]).toBe('config');
      expect(dl[1]?.[1]).toBe('G-TEST998877');
      expect(dl[1]?.[2]).toEqual({
        send_page_view: true,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      });

      // Ad-blocker / offline error handler cleans up the script element silently without throwing
      appendedScripts[0]?.onerror?.();
      expect(appendedScripts[0]?.removed).toBe(true);

      // Manual CF beacon token injects when no edge script is present, and survives throwing appendChild
      existingEdgeCf = null;
      const cfRes = injectAnalyticsScriptsNow({
        gaId: '',
        cfBeaconToken: 'fedcba9876543210fedcba9876543210',
      });
      expect(cfRes).toEqual({ gaInjected: false, cfInjected: true });
      expect(appendedScripts[1]?.id).toBe(CF_BEACON_SCRIPT_ID);
      expect(appendedScripts[1]?.attrs['data-cf-beacon']).toBe(
        '{"token":"fedcba9876543210fedcba9876543210"}'
      );

      mockDoc.head.appendChild = () => {
        throw new Error('Simulated CSP or DOM error');
      };
      expect(() => injectAnalyticsScriptsNow({ gaId: 'G-CRASHPROOF1', cfBeaconToken: '' })).not.toThrow();
    } finally {
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else
        Object.defineProperty(globalThis, 'window', {
          value: prevWindow,
          configurable: true,
          writable: true,
        });
      if (prevDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else
        Object.defineProperty(globalThis, 'document', {
          value: prevDocument,
          configurable: true,
          writable: true,
        });
      if (prevNavigator === undefined) delete (globalThis as { navigator?: unknown }).navigator;
      else Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
    }
  });
});
