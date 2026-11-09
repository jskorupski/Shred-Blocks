import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
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
    launchOptions: {
      args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
    },
    trace: 'off',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'mobile-portrait',
      use: {
        ...devices['iPhone 14 Pro'],
        defaultBrowserType: 'chromium',
        browserName: 'chromium',
        channel: 'chrome',
      },
    },
  ],
  webServer: {
    command: './node_modules/.bin/vite preview --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
