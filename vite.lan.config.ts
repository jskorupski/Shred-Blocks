// @ts-expect-error Node built-in module resolved at runtime by Vite
import { execFileSync } from 'node:child_process';
// @ts-expect-error Node built-in module resolved at runtime by Vite
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
// @ts-expect-error Node built-in module resolved at runtime by Vite
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const CERT_DIR = resolve('/Users/james/projects/krista-game/.certs');
const KEY_PATH = resolve(CERT_DIR, 'key.pem');
const CERT_PATH = resolve(CERT_DIR, 'cert.pem');

/**
 * Ensures a valid self-signed TLS certificate exists in `.certs/` for LAN HTTPS testing (`https://0.0.0.0:8443`).
 * Automatically generates `key.pem` and `cert.pem` via `openssl` if missing on a fresh clone.
 */
function ensureLanHttpsCerts(): { key: unknown; cert: unknown } {
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
    key: readFileSync(KEY_PATH),
    cert: readFileSync(CERT_PATH),
  };
}

const httpsConfig = ensureLanHttpsCerts();

export default defineConfig({
  base: '/',
  server: {
    host: '0.0.0.0',
    port: 8443,
    strictPort: true,
    https: httpsConfig as Record<string, never>,
  },
  preview: {
    host: '0.0.0.0',
    port: 8443,
    strictPort: true,
    https: httpsConfig as Record<string, never>,
  },
});
