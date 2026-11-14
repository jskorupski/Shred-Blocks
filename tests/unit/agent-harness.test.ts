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
import { SINGLE_BUNDLE_WARNING_LIMIT_KB } from '../../vite.config';

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
});
