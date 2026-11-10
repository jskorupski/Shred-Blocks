import type {
  Benchmark120HzResult,
  BoardState,
  ColorId,
  InputMode,
  ParticleStyleId,
  PerfTelemetry,
  QualityTier,
  RocketAxis,
  SkinId,
  TrayId,
} from '../core/types';
import type { AtlasTextureData, AtlasUVRegion } from './atlas-3d';
import type { Camera3D } from './camera-3d';
import { ENVIRONMENT_MESHES, type MeshData } from './mesh-generator';

export const MAX_PARTICLES = 2048;
export const PARTICLE_STRIDE = 14; // x, y, z, vx, vy, vz, r, g, b, scale, age, maxAge, rotAngle, rotSpeed
export const INSTANCE_STRIDE = 8; // x, y, z, scale, r, g, b, rotAngle

export interface TrayPalette {
  bgClear: [number, number, number];
  floorTileA: [number, number, number];
  floorTileB: [number, number, number];
  wallColor: [number, number, number];
  rimHighlight: [number, number, number];
}

export const TRAY_PALETTES: Record<TrayId, TrayPalette> = {
  industrial_slate: {
    bgClear: [0.095, 0.105, 0.165],
    floorTileA: [0.165, 0.185, 0.255],
    floorTileB: [0.14, 0.16, 0.225],
    wallColor: [0.24, 0.27, 0.35],
    rimHighlight: [0.48, 0.52, 0.62],
  },
  warm_birch: {
    bgClear: [0.14, 0.1, 0.08],
    floorTileA: [0.76, 0.65, 0.5],
    floorTileB: [0.72, 0.61, 0.46],
    wallColor: [0.48, 0.34, 0.22],
    rimHighlight: [0.62, 0.46, 0.32],
  },
  midnight_arcade: {
    bgClear: [0.03, 0.04, 0.1],
    floorTileA: [0.08, 0.11, 0.22],
    floorTileB: [0.065, 0.09, 0.19],
    wallColor: [0.18, 0.16, 0.42],
    rimHighlight: [0.38, 0.32, 0.78],
  },
  frosted_quartz: {
    bgClear: [0.11, 0.15, 0.21],
    floorTileA: [0.78, 0.83, 0.89],
    floorTileB: [0.74, 0.79, 0.86],
    wallColor: [0.52, 0.59, 0.68],
    rimHighlight: [0.68, 0.75, 0.84],
  },
  mint_studio: {
    bgClear: [0.04, 0.12, 0.1],
    floorTileA: [0.68, 0.86, 0.78],
    floorTileB: [0.63, 0.82, 0.74],
    wallColor: [0.11, 0.36, 0.29],
    rimHighlight: [0.2, 0.52, 0.42],
  },
};

/**
 * High-Contrast Tray Palettes (`AX-02`):
 * Preserves each custom tray's distinct architectural color identity while enforcing
 * dark, low-luminance floor tiles (`<= 0.14`) and bright high-contrast perimeter wall rims (`>= 0.78`)
 * so all 10 block colors, reticles, and badges maintain maximum WCAG contrast regardless of equipped tray.
 */
export const HIGH_CONTRAST_TRAY_PALETTES: Record<TrayId, TrayPalette> = {
  industrial_slate: {
    bgClear: [0.03, 0.04, 0.08],
    floorTileA: [0.09, 0.105, 0.15],
    floorTileB: [0.055, 0.068, 0.105],
    wallColor: [0.18, 0.22, 0.32],
    rimHighlight: [0.84, 0.9, 0.98],
  },
  warm_birch: {
    bgClear: [0.06, 0.04, 0.025],
    floorTileA: [0.14, 0.1, 0.065],
    floorTileB: [0.095, 0.065, 0.04],
    wallColor: [0.34, 0.22, 0.12],
    rimHighlight: [0.96, 0.82, 0.58],
  },
  midnight_arcade: {
    bgClear: [0.02, 0.02, 0.06],
    floorTileA: [0.06, 0.07, 0.15],
    floorTileB: [0.035, 0.045, 0.105],
    wallColor: [0.16, 0.12, 0.38],
    rimHighlight: [0.76, 0.68, 1.0],
  },
  frosted_quartz: {
    bgClear: [0.035, 0.055, 0.09],
    floorTileA: [0.095, 0.125, 0.175],
    floorTileB: [0.06, 0.085, 0.125],
    wallColor: [0.24, 0.32, 0.44],
    rimHighlight: [0.88, 0.95, 1.0],
  },
  mint_studio: {
    bgClear: [0.02, 0.06, 0.05],
    floorTileA: [0.065, 0.135, 0.115],
    floorTileB: [0.04, 0.095, 0.08],
    wallColor: [0.1, 0.3, 0.24],
    rimHighlight: [0.68, 0.98, 0.86],
  },
};

export interface RenderSceneOptions {
  draggedBlockId?: number | null;
  dragTargetRow?: number | null;
  dragTargetCol?: number | null;
  dragEligibleGateIndex?: number | null;
  inputMode?: InputMode;
  rocketAxis?: RocketAxis;
  hoverRow?: number | null;
  hoverCol?: number | null;
  equippedSkin?: SkinId;
  equippedTray?: TrayId;
  equippedParticle?: ParticleStyleId;
  colorblindSymbols?: boolean;
  highContrast?: boolean;
  reducedMotion?: boolean;
  qualityTier?: QualityTier;
  dtSec?: number;
  timeSec?: number;
  /** `0.0` = full 3D tactile gameplay, `1.0` = Sacred-Geometry Astrolabe Wall-Scroll Diagram preview */
  blueprintMix?: number;
  autoGuideMove?: {
    blockId: number;
    targetRow: number;
    targetCol: number;
  } | null;
}

export interface GLMeshHandle {
  vao: WebGLVertexArrayObject;
  posBuffer: WebGLBuffer;
  normBuffer: WebGLBuffer;
  uvBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  indexCount: number;
}

/**
 * Two-Tier Adaptive `120fps / 60fps` Quality Governor (`VER-03`).
 * Tracks a 120-frame ring buffer of `workDurationMs = performance.now() - frameStart`
 * (never rAF-to-rAF delta, so 60Hz displays are not misclassified by v-sync intervals).
 */
export class QualityGovernor {
  private readonly workRing = new Float32Array(120);
  private readonly sortedScratch = new Float32Array(120);
  private writeCursor = 0;
  private sampleCount = 0;
  private preferredTier: QualityTier = 'AUTO';
  private activeTier: 'ULTRA_120' | 'BALANCED_60' = 'ULTRA_120';
  private backend: 'WEBGPU' | 'WEBGL2' | 'CANVAS2D' = 'WEBGL2';
  private activeParticles = 0;
  private dpr = 1;
  private lastRafTimestamp = 0;
  private measuredFps = 120;
  private benchmarkRunner: ((frames: number) => Promise<Benchmark120HzResult>) | null = null;

  public setPreference(tier: QualityTier): void {
    this.preferredTier = tier;
    if (tier === 'ULTRA_120') {
      this.activeTier = 'ULTRA_120';
    } else if (tier === 'BALANCED_60') {
      this.activeTier = 'BALANCED_60';
    }
  }

  public setBackend(backend: 'WEBGPU' | 'WEBGL2' | 'CANVAS2D'): void {
    this.backend = backend;
  }

  public setActiveParticles(count: number): void {
    this.activeParticles = count;
  }

  public setDpr(dpr: number): void {
    this.dpr = dpr;
  }

  public setBenchmarkRunner(runner: (frames: number) => Promise<Benchmark120HzResult>): void {
    this.benchmarkRunner = runner;
  }

  public recordFrameWork(workDurationMs: number, nowMs = performance.now()): void {
    const clampedWork = Math.max(0.01, workDurationMs);
    this.workRing[this.writeCursor] = clampedWork;
    this.writeCursor = (this.writeCursor + 1) % 120;
    if (this.sampleCount < 120) this.sampleCount++;

    if (this.lastRafTimestamp > 0) {
      const delta = nowMs - this.lastRafTimestamp;
      if (delta > 1 && delta < 250) {
        const instFps = 1000 / delta;
        this.measuredFps = this.measuredFps * 0.9 + instFps * 0.1;
      }
    }
    this.lastRafTimestamp = nowMs;

    if (this.preferredTier === 'AUTO' && this.sampleCount >= 24) {
      const stats = this.computeStats();
      if (this.activeTier === 'ULTRA_120' && stats.p95WorkMs > 7.8) {
        this.activeTier = 'BALANCED_60';
      } else if (this.activeTier === 'BALANCED_60' && stats.p95WorkMs < 4.8) {
        this.activeTier = 'ULTRA_120';
      }
    } else if (this.preferredTier === 'ULTRA_120') {
      this.activeTier = 'ULTRA_120';
    } else if (this.preferredTier === 'BALANCED_60') {
      this.activeTier = 'BALANCED_60';
    }
  }

  public getActiveTier(): 'ULTRA_120' | 'BALANCED_60' {
    return this.activeTier;
  }

  public getBurstParticleCount(reducedMotion = false): number {
    if (reducedMotion) return 14;
    return this.activeTier === 'ULTRA_120' ? 60 : 36;
  }

  public getMaxActiveParticles(): number {
    return this.activeTier === 'ULTRA_120' ? 1024 : 384;
  }

  public getTargetMaxDpr(): number {
    return this.activeTier === 'ULTRA_120' ? 2.5 : 1.75;
  }

  private computeStats(): {
    avgWorkMs: number;
    p95WorkMs: number;
    p99WorkMs: number;
    maxWorkMs: number;
  } {
    const count = this.sampleCount;
    if (count === 0) {
      return { avgWorkMs: 0.8, p95WorkMs: 1.2, p99WorkMs: 1.5, maxWorkMs: 1.8 };
    }

    let sum = 0;
    let maxWorkMs = 0;
    for (let i = 0; i < count; i++) {
      const v = this.workRing[i];
      sum += v;
      if (v > maxWorkMs) maxWorkMs = v;
      this.sortedScratch[i] = v;
    }

    const sub = this.sortedScratch.subarray(0, count);
    sub.sort();

    const p95Idx = Math.min(count - 1, Math.floor(count * 0.95));
    const p99Idx = Math.min(count - 1, Math.floor(count * 0.99));

    return {
      avgWorkMs: Number((sum / count).toFixed(3)),
      p95WorkMs: Number(sub[p95Idx].toFixed(3)),
      p99WorkMs: Number(sub[p99Idx].toFixed(3)),
      maxWorkMs: Number(maxWorkMs.toFixed(3)),
    };
  }

  public getTelemetry(): PerfTelemetry {
    const stats = this.computeStats();
    return {
      fps: Math.round(Math.min(240, Math.max(30, this.measuredFps))),
      avgWorkMs: stats.avgWorkMs,
      p95WorkMs: stats.p95WorkMs,
      p99WorkMs: stats.p99WorkMs,
      maxWorkMs: stats.maxWorkMs,
      activeTier: this.activeTier,
      rendererBackend: this.backend,
      activeParticles: this.activeParticles,
      dpr: Number(this.dpr.toFixed(2)),
    };
  }

  public async run120HzBenchmark(frames = 120): Promise<Benchmark120HzResult> {
    if (this.benchmarkRunner) {
      return this.benchmarkRunner(frames);
    }
    const stats = this.computeStats();
    return {
      framesExecuted: frames,
      avgWorkMs: stats.avgWorkMs,
      p95WorkMs: stats.p95WorkMs,
      p99WorkMs: stats.p99WorkMs,
      maxWorkMs: stats.maxWorkMs,
      passes120HzBudget: stats.p95WorkMs <= 8.33,
      passes60HzBudget: stats.p95WorkMs <= 16.67,
    };
  }
}

export interface VisualShredAnim {
  shapeId: string;
  x: number;
  y: number;
  colorId: ColorId;
  gateIndex: number;
  progress: number;
  isOuterPeelOnly: boolean;
}

export interface VisualShockwave {
  cx: number;
  cy: number;
  z: number;
  r: number;
  g: number;
  b: number;
  age: number;
  maxAge: number;
  minRadius: number;
  maxRadius: number;
}

export interface RenderPassContext {
  readonly canvas: HTMLCanvasElement;
  readonly camera: Camera3D;
  readonly qualityGovernor: QualityGovernor;
  gl: WebGL2RenderingContext | null;
  ctx2d: CanvasRenderingContext2D | null;
  uUseClipPlane: WebGLUniformLocation | null;
  uClipPlane: WebGLUniformLocation | null;
  uCapColor: WebGLUniformLocation | null;
  readonly particlePool: Float32Array;
  readonly particleInstanceData: Float32Array;
  activeParticleCount: number;
  particleWriteCursor: number;
  lastBoardLevelId: number;
  lastSessionShredded: number;
  lastMovesCommitted: number;
  readonly blockLayerSnapshots: Map<
    number,
    {
      cursor: number;
      status: string;
      x: number;
      y: number;
      row: number;
      col: number;
      color: ColorId;
      iceCount: number;
      chained: boolean;
      ropeColor: ColorId;
    }
  >;
  readonly crateSnapshots: Map<number, { hp: number; destroyed: boolean }>;
  readonly gateSnapshots: Map<
    number,
    {
      colorCursor: number;
      iceCount: number;
      shutterOpen: boolean;
      shutterLockColor: ColorId;
      spanStart: number;
      spanLength: number;
    }
  >;
  readonly elevatorSnapshots: Map<number, { atAlternatePos: boolean }>;
  readonly barrierSnapshots: Map<number, { open: boolean; shredsRemaining: number }>;
  readonly roomAwakenMap: Map<number, number>;
  readonly activeVisualShreds: VisualShredAnim[];
  readonly activeShockwaves: VisualShockwave[];
  readonly blockBounceMap: Map<number, number>;
  boardShakeTimer: number;
  boardShakeDirX: number;
  boardShakeDirY: number;
  ambientMoteAccumSec: number;
  lastOptions: RenderSceneOptions;
  startTimeMs: number;
  getEffectiveTrayPalette(trayId: TrayId, highContrast?: boolean): TrayPalette;
  getColorRgb(colorId: ColorId, highContrast?: boolean): [number, number, number];
  getMaterialStyleCode(skin?: SkinId): number;
  getParticleStyleCode(style?: ParticleStyleId): number;
  getRoomVisualState(
    board: BoardState,
    roomId: number
  ): { zOffset: number; luminanceMul: number; isLocked: boolean };
  spawnParticlesAt(
    worldX: number,
    worldY: number,
    worldZ: number,
    colorId: ColorId,
    count?: number,
    dirX?: number,
    dirY?: number,
    particleStyle?: ParticleStyleId
  ): void;
  spawnShockwave(
    cx: number,
    cy: number,
    z: number,
    r: number,
    g: number,
    b: number,
    minRadius?: number,
    maxRadius?: number,
    maxAge?: number
  ): void;
  drawMesh(
    gl: WebGL2RenderingContext,
    mesh: MeshData,
    tx: number,
    ty: number,
    tz: number,
    sx: number,
    sy: number,
    sz: number,
    r: number,
    g: number,
    b: number,
    a?: number,
    rotX?: number,
    rotZ?: number,
    materialStyle?: number,
    uvRegion?: AtlasUVRegion | null
  ): void;
  drawAtlasBadge(
    gl: WebGL2RenderingContext,
    regionKey: string,
    cx: number,
    cy: number,
    z: number,
    size: number,
    r?: number,
    g?: number,
    b?: number,
    a?: number
  ): void;
  drawNumberBadges(
    gl: WebGL2RenderingContext,
    value: number,
    cx: number,
    cy: number,
    z: number,
    digitSize: number,
    r?: number,
    g?: number,
    b?: number
  ): void;
  drawBadgeMedallion3D(
    gl: WebGL2RenderingContext,
    cx: number,
    cy: number,
    zBase: number,
    width: number,
    height: number,
    faceR: number,
    faceG: number,
    faceB: number,
    rimR?: number,
    rimG?: number,
    rimB?: number
  ): number;
}

export function drawAtlasBadgeImpl(
  rctx: RenderPassContext,
  atlasData: AtlasTextureData,
  gl: WebGL2RenderingContext,
  regionKey: string,
  cx: number,
  cy: number,
  z: number,
  size: number,
  r = 1,
  g = 1,
  b = 1,
  a = 1
): void {
  const region = atlasData.regions[regionKey];
  if (!region) return;
  rctx.drawMesh(
    gl,
    ENVIRONMENT_MESHES.overlayQuad,
    cx - size * 0.5,
    cy - size * 0.5,
    z,
    size,
    size,
    1,
    r,
    g,
    b,
    a,
    0,
    0,
    4,
    region
  );
}

export function drawNumberBadgesImpl(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  value: number,
  cx: number,
  cy: number,
  z: number,
  digitSize: number,
  r = 1,
  g = 1,
  b = 1
): void {
  const str = String(Math.max(0, Math.floor(value)));
  const step = digitSize * 0.54;
  const totalW = str.length * step;
  const startX = cx - totalW * 0.5 + step * 0.5;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    rctx.drawAtlasBadge(gl, `DIGIT_${ch}`, startX + i * step, cy, z, digitSize, r, g, b, 1.0);
  }
}

export function drawBadgeMedallion3DImpl(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  cx: number,
  cy: number,
  zBase: number,
  width: number,
  height: number,
  faceR: number,
  faceG: number,
  faceB: number,
  rimR = 0.92,
  rimG = 0.8,
  rimB = 0.52
): number {
  rctx.drawMesh(
    gl,
    ENVIRONMENT_MESHES.unitParticleCube,
    cx,
    cy,
    zBase + 0.036,
    width + 0.055,
    height + 0.055,
    0.072,
    rimR,
    rimG,
    rimB,
    1.0,
    0,
    0,
    0
  );
  rctx.drawMesh(
    gl,
    ENVIRONMENT_MESHES.unitParticleCube,
    cx,
    cy,
    zBase + 0.041,
    width,
    height,
    0.082,
    faceR,
    faceG,
    faceB,
    1.0,
    0,
    0,
    0
  );
  return zBase + 0.086;
}

export async function executeBenchmarkFramesImpl(
  rctx: RenderPassContext & { render(board: BoardState, options?: RenderSceneOptions): void },
  lastBoard: BoardState | null,
  frames: number
): Promise<Benchmark120HzResult> {
  const count = Math.max(10, frames);
  const samples = new Float32Array(count);

  if (rctx.activeParticleCount < 60 && lastBoard) {
    rctx.spawnParticlesAt(lastBoard.cols * 0.5, lastBoard.rows * 0.5, 0.45, 1, 60, 0, -1);
  }
  if (lastBoard) {
    rctx.render(lastBoard, { ...rctx.lastOptions, dtSec: 1 / 120 });
    rctx.gl?.finish();
  }

  for (let i = 0; i < count; i++) {
    const t0 = performance.now();
    if (lastBoard) {
      rctx.render(lastBoard, {
        ...rctx.lastOptions,
        dtSec: 1 / 120,
      });
    }
    rctx.gl?.flush();
    const workMs = Math.max(0.01, performance.now() - t0);
    samples[i] = workMs;
  }

  let sum = 0;
  let maxWorkMs = 0;
  for (let i = 0; i < count; i++) {
    sum += samples[i];
    if (samples[i] > maxWorkMs) maxWorkMs = samples[i];
  }
  samples.sort();
  const p95WorkMs = Number(samples[Math.min(count - 1, Math.floor(count * 0.95))].toFixed(3));
  const p99WorkMs = Number(samples[Math.min(count - 1, Math.floor(count * 0.99))].toFixed(3));
  const avgWorkMs = Number((sum / count).toFixed(3));

  return {
    framesExecuted: count,
    avgWorkMs,
    p95WorkMs,
    p99WorkMs,
    maxWorkMs: Number(maxWorkMs.toFixed(3)),
    passes120HzBudget: p95WorkMs <= 8.33,
    passes60HzBudget: p95WorkMs <= 16.67,
  };
}
