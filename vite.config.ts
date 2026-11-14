import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { normalizeCfBeaconToken, normalizeGaMeasurementId } from './src/ui/telemetry-analytics';

/**
 * Automatically stamps a deterministic SHA-256 build hash and hashed bundle asset list
 * into `dist/sw.js` and `dist/version.json` on every `vite build`.
 * Guarantees that browsers and installed PWAs always detect every deployment automatically
 * without manual `CACHE_VERSION` edits.
 */
function pwaAutoVersionPlugin(): Plugin {
  return {
    name: 'shredblocks-pwa-auto-version',
    apply: 'build',
    closeBundle() {
      const distDir = resolve(process.cwd(), 'dist');
      const swPath = resolve(distDir, 'sw.js');
      const versionJsonPath = resolve(distDir, 'version.json');
      const indexHtmlPath = resolve(distDir, 'index.html');
      const assetsDir = resolve(distDir, 'assets');
      const pkgPath = resolve(process.cwd(), 'package.json');

      if (!existsSync(swPath) || !existsSync(indexHtmlPath)) return;

      const hash = createHash('sha256');
      hash.update(readFileSync(indexHtmlPath));

      const assetUrls: string[] = [];
      if (existsSync(assetsDir)) {
        const files = readdirSync(assetsDir).sort();
        for (const file of files) {
          if (file.endsWith('.js') || file.endsWith('.css')) {
            const fullPath = resolve(assetsDir, file);
            hash.update(readFileSync(fullPath));
            assetUrls.push(`/assets/${file}`);
          }
        }
      }

      const fontsDir = resolve(distDir, 'fonts');
      if (existsSync(fontsDir)) {
        const fontFiles = readdirSync(fontsDir).sort();
        for (const file of fontFiles) {
          if (file.endsWith('.woff2')) {
            hash.update(readFileSync(resolve(fontsDir, file)));
          }
        }
      }

      for (const iconFile of ['favicon.ico', 'icon.svg', 'icon-maskable.svg', 'og-image.png']) {
        const iconPath = resolve(distDir, iconFile);
        if (existsSync(iconPath)) {
          hash.update(readFileSync(iconPath));
        }
      }

      const shortHash = hash.digest('hex').slice(0, 8);
      let pkgVersion = '1.2.0';
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
          if (pkg.version) pkgVersion = pkg.version;
        } catch {
          // Fallback to default version string
        }
      }

      const cacheVersion = `shredblocks-v${pkgVersion}-${shortHash}`;

      // 1. Stamp CACHE_VERSION and hashed asset URLs into dist/sw.js
      let swContent = readFileSync(swPath, 'utf8');
      swContent = swContent.replace(
        /const CACHE_VERSION = ['"][^'"]+['"];/,
        `const CACHE_VERSION = '${cacheVersion}';`
      );
      if (assetUrls.length > 0) {
        const assetEntries = assetUrls.map((u) => `  '${u}',`).join('\n');
        swContent = swContent.replace(
          /const APP_SHELL_URLS = \[\n/,
          `const APP_SHELL_URLS = [\n${assetEntries}\n`
        );
      }
      writeFileSync(swPath, swContent, 'utf8');

      // 2. Stamp dist/version.json with exact build metadata
      const versionPayload = {
        version: pkgVersion,
        buildHash: `sb-${shortHash}`,
        cacheVersion,
        releasedAt: new Date().toISOString(),
      };
      writeFileSync(versionJsonPath, `${JSON.stringify(versionPayload, null, 2)}\n`, 'utf8');
    },
  };
}

/**
 * Anti-clickjacking frame guard (`SAVE-SEC-01`), mirroring `public/_headers` in production so local
 * dev/preview behave identically. `frame-ancestors` is ignored in `<meta>` CSP, so it must be a header.
 */
export const FRAME_GUARD_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'self'",
  'X-Frame-Options': 'SAMEORIGIN',
};

/**
 * Single-bundle offline-PWA warning threshold in kB of minified uncompressed JS (`BUNDLE-BUDGET-01`).
 * ShredBlocks intentionally ships one atomic SW-precached JS bundle (~70% renders Frame-0 3D Title Screen;
 * zero external runtime dependencies or asset packs). `1000` kB (`1 MB` minified, ~`300 kB` gzipped) marks
 * the mobile parse/transfer inflection point where staged code-splitting is worth discussing with the user.
 */
export const SINGLE_BUNDLE_WARNING_LIMIT_KB = 1000;

export interface AnalyticsBuildOptions {
  gaId: string;
  cfToken: string;
  enableCfAnalytics: boolean;
}

/**
 * Resolves optional build-time analytics env vars (`ANALYTICS-01`).
 * Defaults to 100% disabled for forks, local dev, and CI unless explicitly configured.
 */
export function resolveAnalyticsBuildOptions(env: Record<string, string | undefined>): AnalyticsBuildOptions {
  const gaId = normalizeGaMeasurementId(env.VITE_GA_MEASUREMENT_ID);
  const cfToken = normalizeCfBeaconToken(env.VITE_CF_BEACON_TOKEN);
  const rawCfFlag = (env.VITE_CF_WEB_ANALYTICS ?? '').trim().toLowerCase();
  const explicitlyDisabled = rawCfFlag === 'false' || rawCfFlag === '0';
  const explicitlyEnabled = rawCfFlag === 'true' || rawCfFlag === '1';
  const enableCfAnalytics = !explicitlyDisabled && (explicitlyEnabled || Boolean(cfToken) || Boolean(gaId));
  return { gaId, cfToken, enableCfAnalytics };
}

/**
 * Conditionally widens `<meta http-equiv="Content-Security-Policy">` in `index.html` ONLY when
 * optional analytics are enabled at build time—never permitting `'unsafe-inline'` or `'unsafe-eval'`
 * in `script-src` (`SAVE-SEC-01`).
 */
export function buildIndexHtmlCsp(
  html: string,
  opts: Pick<AnalyticsBuildOptions, 'gaId' | 'enableCfAnalytics'>
): string {
  const gaId = normalizeGaMeasurementId(opts.gaId);
  if (!gaId && !opts.enableCfAnalytics) return html;

  const scriptExtras: string[] = [];
  const connectExtras: string[] = [];
  const imgExtras: string[] = [];

  if (gaId) {
    scriptExtras.push('https://www.googletagmanager.com');
    connectExtras.push(
      'https://*.google-analytics.com',
      'https://*.analytics.google.com',
      'https://www.googletagmanager.com'
    );
    imgExtras.push('https://*.google-analytics.com', 'https://www.googletagmanager.com');
  }
  if (opts.enableCfAnalytics) {
    scriptExtras.push('https://static.cloudflareinsights.com');
    connectExtras.push('https://cloudflareinsights.com', 'https://*.cloudflareinsights.com');
  }

  let updated = html;
  if (scriptExtras.length > 0) {
    updated = updated.replace("script-src 'self'", `script-src 'self' ${scriptExtras.join(' ')}`);
  }
  if (connectExtras.length > 0) {
    updated = updated.replace("connect-src 'self'", `connect-src 'self' ${connectExtras.join(' ')}`);
  }
  if (imgExtras.length > 0) {
    updated = updated.replace(
      "img-src 'self' data: blob:",
      `img-src 'self' data: blob: ${imgExtras.join(' ')}`
    );
  }
  return updated;
}

function analyticsCspPlugin(opts: Pick<AnalyticsBuildOptions, 'gaId' | 'enableCfAnalytics'>): Plugin {
  return {
    name: 'shredblocks-analytics-csp',
    transformIndexHtml(html) {
      return buildIndexHtmlCsp(html, opts);
    },
  };
}

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const analytics = resolveAnalyticsBuildOptions({
    VITE_GA_MEASUREMENT_ID: process.env.VITE_GA_MEASUREMENT_ID ?? fileEnv.VITE_GA_MEASUREMENT_ID,
    VITE_CF_BEACON_TOKEN: process.env.VITE_CF_BEACON_TOKEN ?? fileEnv.VITE_CF_BEACON_TOKEN,
    VITE_CF_WEB_ANALYTICS: process.env.VITE_CF_WEB_ANALYTICS ?? fileEnv.VITE_CF_WEB_ANALYTICS,
  });

  return {
    base: '/',
    define: {
      __SHREDBLOCKS_LAN_DEVTOOLS__: 'false',
      __SHREDBLOCKS_GA_ID__: JSON.stringify(analytics.gaId),
      __SHREDBLOCKS_CF_TOKEN__: JSON.stringify(analytics.cfToken),
    },
    plugins: [analyticsCspPlugin(analytics), pwaAutoVersionPlugin()],
    build: {
      target: 'es2022',
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,
      minify: 'esbuild',
      chunkSizeWarningLimit: SINGLE_BUNDLE_WARNING_LIMIT_KB,
    },
    server: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      headers: FRAME_GUARD_HEADERS,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      headers: FRAME_GUARD_HEADERS,
    },
  };
});
