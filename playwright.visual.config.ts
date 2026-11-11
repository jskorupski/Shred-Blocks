import { defineConfig } from '@playwright/test';

/**
 * Golden screenshot suite (`VISUAL-GOLDEN-01`): deterministic pixel-diff regression captures.
 * - Run: `npm run test:visual` (fails + writes diff PNGs to `test-results/` on unintended visual changes).
 * - Accept intended changes: `npm run test:visual:update`, then review the updated PNGs in the git diff.
 * - Goldens are platform/GPU-specific (`tests/visual/__goldens__/{platform}/`); regenerate when switching machines.
 * Uses strict port 4178 (same as the E2E suite; never run both concurrently).
 */
export default defineConfig({
  testDir: './tests/visual',
  snapshotPathTemplate: '{testDir}/__goldens__/{platform}/{projectName}/{arg}{ext}',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.0005,
      threshold: 0.1,
    },
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4178',
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    serviceWorkers: 'block',
    launchOptions: {
      args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
    },
    trace: 'off',
  },
  projects: [
    { name: 'golden-mobile', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
    { name: 'golden-desktop', use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: './node_modules/.bin/vite preview --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
