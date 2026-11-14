import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));
const CERT_DIR = resolve(REPO_ROOT, '.certs');
const KEY_PATH = resolve(CERT_DIR, 'key.pem');
const CERT_PATH = resolve(CERT_DIR, 'cert.pem');

/**
 * Ensures a valid self-signed TLS certificate exists in `.certs/` for LAN HTTPS testing (`https://0.0.0.0:8443`).
 * Automatically generates `key.pem` and `cert.pem` via `openssl` if missing on a fresh clone.
 */
function ensureLanHttpsCerts(): { key: string; cert: string } {
  if (!existsSync(KEY_PATH) || !existsSync(CERT_PATH)) {
    mkdirSync(CERT_DIR, { recursive: true });
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '365',
      '-subj',
      '/CN=shredblocks.local',
      '-keyout',
      KEY_PATH,
      '-out',
      CERT_PATH,
    ]);
  }
  return {
    key: readFileSync(KEY_PATH, 'utf8'),
    cert: readFileSync(CERT_PATH, 'utf8'),
  };
}

const httpsConfig = ensureLanHttpsCerts();

/** Same anti-clickjacking frame guard as `public/_headers` / `vite.config.ts` (`SAVE-SEC-01`). */
const FRAME_GUARD_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'self'",
  'X-Frame-Options': 'SAMEORIGIN',
};

export default defineConfig({
  base: '/',
  define: {
    __SHREDBLOCKS_LAN_DEVTOOLS__: 'true',
    __SHREDBLOCKS_GA_ID__: '""',
    __SHREDBLOCKS_CF_TOKEN__: '""',
  },
  server: {
    host: '0.0.0.0',
    port: 8443,
    strictPort: true,
    https: httpsConfig,
    headers: FRAME_GUARD_HEADERS,
  },
  preview: {
    host: '0.0.0.0',
    port: 8443,
    strictPort: true,
    https: httpsConfig,
    headers: FRAME_GUARD_HEADERS,
  },
});
