/**
 * Minimal ambient type declarations for Node.js built-in modules (`node:*`) and `process`
 * used by build configs (`vite*.config.ts`), verification harnesses (`scripts/*`), and Vitest
 * Node-side suites (`tests/unit/*`) without requiring external `@types/node` installation.
 *
 * Browser application code under `src/` is guarded by `BROWSER-PURE-SRC-01` in
 * `tests/unit/agent-harness.test.ts` so `node:*` imports never enter client bundles.
 */

interface NodeByteBuffer extends Uint8Array {
  toString(encoding?: 'utf8' | 'utf-8' | 'base64' | 'hex' | 'ascii'): string;
  readUInt8(offset?: number): number;
  readUInt16LE(offset?: number): number;
  readUInt16BE(offset?: number): number;
  readUInt32LE(offset?: number): number;
  readUInt32BE(offset?: number): number;
  writeUInt8(value: number, offset?: number): number;
  writeUInt16LE(value: number, offset?: number): number;
  writeUInt32LE(value: number, offset?: number): number;
  copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
}

interface NodeBufferConstructor {
  alloc(size: number, fill?: number | string): NodeByteBuffer;
  from(data: Uint8Array | ArrayBuffer | readonly number[]): NodeByteBuffer;
  from(data: string, encoding?: 'utf8' | 'utf-8' | 'base64' | 'hex' | 'ascii'): NodeByteBuffer;
  isBuffer(value: unknown): value is NodeByteBuffer;
}

declare var process: {
  readonly argv: string[];
  readonly env: Record<string, string | undefined>;
  readonly platform: string;
  cwd(): string;
  exit(code?: number): never;
  on(
    event: 'exit' | 'SIGINT' | 'SIGTERM' | 'uncaughtException',
    listener: (...args: unknown[]) => void
  ): void;
  stdout: { write(chunk: string | Uint8Array): boolean };
  stderr: { write(chunk: string | Uint8Array): boolean };
};

declare module 'node:buffer' {
  export const Buffer: NodeBufferConstructor;
  const bufferModule: { Buffer: NodeBufferConstructor };
  export default bufferModule;
}

declare module 'node:fs' {
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }

  export interface Stats {
    size: number;
    mtimeMs: number;
    mtime: Date;
    isDirectory(): boolean;
    isFile(): boolean;
  }

  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function readFileSync(path: string): NodeByteBuffer;
  export function readFileSync(path: string, encoding: 'utf8' | 'utf-8'): string;
  export function writeFileSync(
    path: string,
    data: string | Uint8Array,
    options?: 'utf8' | 'utf-8' | { encoding?: 'utf8' | 'utf-8' }
  ): void;
  export function readdirSync(path: string): string[];
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function statSync(path: string): Stats;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function copyFileSync(src: string, dest: string): void;

  const fsDefault: {
    existsSync: typeof existsSync;
    mkdirSync: typeof mkdirSync;
    readFileSync: typeof readFileSync;
    writeFileSync: typeof writeFileSync;
    readdirSync: typeof readdirSync;
    statSync: typeof statSync;
    rmSync: typeof rmSync;
    copyFileSync: typeof copyFileSync;
  };
  export default fsDefault;
}

declare module 'node:path' {
  export const sep: string;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function dirname(path: string): string;
  export function basename(path: string, suffix?: string): string;
  export function extname(path: string): string;

  const pathDefault: {
    sep: string;
    join: typeof join;
    resolve: typeof resolve;
    relative: typeof relative;
    dirname: typeof dirname;
    basename: typeof basename;
    extname: typeof extname;
  };
  export default pathDefault;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;

  const urlDefault: {
    fileURLToPath: typeof fileURLToPath;
    pathToFileURL: typeof pathToFileURL;
  };
  export default urlDefault;
}

declare module 'node:child_process' {
  export interface SpawnedChildProcess {
    readonly pid?: number;
    readonly killed: boolean;
    readonly exitCode: number | null;
    stdout?: { on(event: 'data', listener: (chunk: NodeByteBuffer) => void): void } | null;
    stderr?: { on(event: 'data', listener: (chunk: NodeByteBuffer) => void): void } | null;
    kill(signal?: string): boolean;
    on(event: 'exit' | 'close', listener: (code: number | null, signal: string | null) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
  }

  export interface SpawnProcessOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdio?: 'inherit' | 'ignore' | 'pipe' | ReadonlyArray<'inherit' | 'ignore' | 'pipe'>;
    detached?: boolean;
  }

  export function spawn(
    command: string,
    args?: readonly string[],
    options?: SpawnProcessOptions
  ): SpawnedChildProcess;

  export function execFileSync(
    file: string,
    args?: readonly string[],
    options?: { cwd?: string; stdio?: 'inherit' | 'ignore' | 'pipe'; encoding?: 'utf8' | 'utf-8' }
  ): NodeByteBuffer | string;

  const childProcessDefault: {
    spawn: typeof spawn;
    execFileSync: typeof execFileSync;
  };
  export default childProcessDefault;
}

declare module 'node:crypto' {
  export interface Hash {
    update(data: string | Uint8Array): this;
    digest(encoding: 'hex' | 'base64'): string;
  }
  export function createHash(algorithm: 'sha256' | 'sha1' | 'md5'): Hash;
  export function randomUUID(): string;

  const cryptoDefault: {
    createHash: typeof createHash;
    randomUUID: typeof randomUUID;
  };
  export default cryptoDefault;
}

declare module 'node:os' {
  export function tmpdir(): string;
  export function platform(): string;
  const osDefault: {
    tmpdir: typeof tmpdir;
    platform: typeof platform;
  };
  export default osDefault;
}
