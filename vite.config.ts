import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

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

export default defineConfig({
  base: '/',
  plugins: [pwaAutoVersionPlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'esbuild',
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
});
