import {
  checkBlockGateClearance,
  findEligibleGateForBlockAt,
  getGateActiveColor,
  getGateOutwardNormal,
} from '../core/gate-clearance';
import {
  canGroupOccupyOffset,
  getBlockRoomId,
  getMovedGroupBlocks,
  isBlockInLockedRoom,
  isGateInLockedRoom,
  isRoomUnlocked,
} from '../core/physics';
import { getActiveColor, getLayersRemaining, getShape } from '../core/polyomino';
import {
  COLOR_PALETTE,
  type Benchmark120HzResult,
  type BlockState,
  type BoardState,
  type ColorId,
  type GateState,
  type InputMode,
  type ParticleStyleId,
  type PerfTelemetry,
  type QualityTier,
  type RocketAxis,
  type SkinId,
  type TrayId,
} from '../core/types';
import { createAtlasTextureData, type AtlasTextureData, type AtlasUVRegion } from './atlas-3d';
import { BLOCK_LIFT_DELTA_Z, BLOCK_TOP_Z, Camera3D } from './camera-3d';
import {
  ENVIRONMENT_MESHES,
  getPolyominoMeshPair,
  POLYOMINO_MESH_CATALOG,
  type MeshData,
} from './mesh-generator';

export const MAX_PARTICLES = 2048;
const PARTICLE_STRIDE = 14; // x, y, z, vx, vy, vz, r, g, b, scale, age, maxAge, rotAngle, rotSpeed
const INSTANCE_STRIDE = 8; // x, y, z, scale, r, g, b, rotAngle

export interface TrayPalette {
  bgClear: [number, number, number];
  floorTileA: [number, number, number];
  floorTileB: [number, number, number];
  wallColor: [number, number, number];
  rimHighlight: [number, number, number];
}

const TRAY_PALETTES: Record<TrayId, TrayPalette> = {
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
const HIGH_CONTRAST_TRAY_PALETTES: Record<TrayId, TrayPalette> = {
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

interface GLMeshHandle {
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

interface VisualShredAnim {
  shapeId: string;
  x: number;
  y: number;
  colorId: ColorId;
  gateIndex: number;
  progress: number;
  isOuterPeelOnly: boolean;
}

interface VisualShockwave {
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

const MAIN_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_viewProj;
uniform vec3 u_translate;
uniform vec3 u_scale;
uniform float u_rotX;
uniform float u_rotZ;
uniform vec4 u_uvRect;
uniform float u_blueprintMix;

out vec3 v_worldPos;
out vec3 v_localPos;
out vec3 v_normal;
out vec2 v_uv;

void main() {
  vec3 p = a_position * u_scale;
  vec3 n = a_normal;

  if (abs(u_rotX) > 0.0001) {
    float cx = cos(u_rotX);
    float sx = sin(u_rotX);
    p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
    n = vec3(n.x, n.y * cx - n.z * sx, n.y * sx + n.z * cx);
  }

  if (abs(u_rotZ) > 0.0001) {
    float cz = cos(u_rotZ);
    float sz = sin(u_rotZ);
    p = vec3(p.x * cz - p.y * sz, p.x * sz + p.y * cz, p.z);
    n = vec3(n.x * cz - n.y * sz, n.x * sz + n.y * cz, n.z);
  }

  vec3 rawWorldPos = p + u_translate;
  v_worldPos = rawWorldPos;
  v_localPos = p;
  v_normal = normalize(n);
  v_uv = mix(u_uvRect.xy, u_uvRect.zw, a_uv);

  // In Sacred-Geometry Wall-Scroll Preview Mode (u_blueprintMix = 1.0), compress Z relief
  // so the board lies flat like an etched celestial astrolabe parchment diagram, then extrudes
  // smoothly into full 3D relief (0.22 -> 1.0) when the player starts the level.
  float zRelief = mix(1.0, 0.22, u_blueprintMix);
  vec3 stagePos = vec3(rawWorldPos.x, rawWorldPos.y, rawWorldPos.z * zRelief);

  gl_Position = u_viewProj * vec4(stagePos, 1.0);
}
`;

const MAIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec3 v_worldPos;
in vec3 v_localPos;
in vec3 v_normal;
in vec2 v_uv;

uniform vec4 u_color;
uniform vec3 u_capColor;
uniform vec4 u_clipPlane;
uniform int u_useClipPlane;
uniform int u_useTexture;
uniform int u_materialStyle; // 0=standard, 1=gummy, 2=wood, 3=neon, 4=unlit_overlay
uniform sampler2D u_atlas;
uniform float u_blueprintMix;
uniform vec3 u_boardInfo; // x = cols * 0.5, y = rows * 0.5, z = timeSec
uniform int u_highContrast;

out vec4 outColor;

void main() {
  if (u_useClipPlane == 1) {
    float clipDist = dot(v_worldPos, u_clipPlane.xyz) + u_clipPlane.w;
    if (clipDist < 0.0) {
      discard;
    }
    if (!gl_FrontFacing) {
      outColor = vec4(u_capColor, u_color.a);
      return;
    }
  }

  if (u_useTexture == 1) {
    vec4 texel = texture(u_atlas, v_uv);
    if (texel.a < 0.08) {
      discard;
    }
    if (u_materialStyle == 4) {
      vec3 badgeRgb = texel.rgb * u_color.rgb;
      if (u_blueprintMix > 0.001) {
        float bLum = dot(badgeRgb, vec3(0.299, 0.587, 0.114));
        vec3 goldBadge = mix(vec3(0.76, 0.58, 0.32), vec3(1.0, 0.90, 0.68), bLum);
        badgeRgb = mix(badgeRgb, goldBadge, u_blueprintMix);
      }
      outColor = vec4(badgeRgb, texel.a * u_color.a * mix(1.0, 0.86, u_blueprintMix));
      return;
    }
  }

  if (u_materialStyle == 4) {
    vec3 flatRgb = u_color.rgb;
    if (u_blueprintMix > 0.001) {
      flatRgb = mix(flatRgb, vec3(0.95, 0.77, 0.44), u_blueprintMix * 0.85);
    }
    outColor = vec4(flatRgb, u_color.a * mix(1.0, 0.62, u_blueprintMix));
    return;
  }

  vec3 N = normalize(v_normal);
  vec3 L1 = normalize(vec3(-0.35, -0.55, 0.76));
  vec3 L2 = normalize(vec3(0.45, 0.35, 0.82));
  vec3 V = normalize(vec3(0.0, 0.21, 0.97));
  vec3 H = normalize(L1 + V);

  float diff1 = max(dot(N, L1), 0.0);
  float diff2 = max(dot(N, L2), 0.0) * 0.28;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);

  vec3 base = u_color.rgb;
  float specPower = 28.0;
  float specStrength = 0.26;

  if (u_materialStyle == 1) {
    // gummy_jelly: subsurface glow + glossy highlight
    specPower = 48.0;
    specStrength = u_highContrast == 1 ? 0.34 : 0.45;
    base = mix(base, vec3(1.0), 0.12 * rim);
  } else if (u_materialStyle == 2) {
    // carved_wood: warm procedural woodgrain bands locked to block-local coordinates
    float grainAmp = u_highContrast == 1 ? 0.048 : 0.105;
    float grain = sin(v_localPos.x * 16.0 + v_localPos.y * 6.0 + sin(v_localPos.x * 5.0 - v_localPos.y * 4.0) * 1.6) * grainAmp;
    base = clamp(base + vec3(grain * 1.1, grain * 0.85, grain * 0.55), 0.0, 1.0);
    specStrength = 0.16;
  } else if (u_materialStyle == 3) {
    // neon_cyber: dark core with bright edge rim (kept brighter in High Contrast mode)
    float coreMul = u_highContrast == 1 ? 0.92 : 0.72;
    base = mix(base * coreMul, min(vec3(1.0), base * 1.35 + 0.15), clamp(rim * 1.6, 0.0, 1.0));
    specPower = 64.0;
    specStrength = 0.4;
  }

  float spec = pow(max(dot(N, H), 0.0), specPower) * specStrength;
  float ambient = u_highContrast == 1 ? 0.54 : 0.50;
  float heightShade = clamp((v_localPos.z - 0.54) * 1.45, -0.08, 0.14);
  float studRim = (v_localPos.z > 0.565 && N.z < 0.96 && N.z > 0.05) ? (0.16 * max(dot(N, L1), -0.35)) : 0.0;
  vec3 lit = base * (ambient + diff1 * 0.49 + diff2 + heightShade) + vec3(spec + studRim);

  if (u_highContrast == 1) {
    // Crisp high-contrast 3D bevel edge contour so every block and wall edge has razor-sharp definition
    float edgeBevel = smoothstep(0.58, 0.16, abs(N.z));
    lit = mix(min(vec3(1.0), lit * 1.08), lit * 0.34, edgeBevel * 0.58);
  }

  if (u_blueprintMix > 0.001) {
    // Sacred-Geometry Astrolabe Wall-Scroll Diagram Mode:
    // Transforms the 3D board into an illuminated nocturnal parchment & gilded brass architectural
    // blueprint matching the counter-rotating sacred-geometry astrolabe rings behind the board.
    float maxC = max(u_color.r, max(u_color.g, u_color.b));
    float minC = min(u_color.r, min(u_color.g, u_color.b));
    float sat = (maxC - minC) / max(maxC, 0.12);
    float isPiece = smoothstep(0.14, 0.30, sat);
    float isSunkenRoom = smoothstep(-0.02, -0.10, v_worldPos.z);

    vec2 relCenter = v_worldPos.xy - u_boardInfo.xy;
    float distCenter = length(relCenter);
    float radialGlow = clamp(1.0 - distCenter * 0.14, 0.0, 1.0);

    vec3 scrollPaper = mix(
      vec3(0.11, 0.085, 0.195),
      vec3(0.165, 0.125, 0.265),
      radialGlow
    );
    scrollPaper *= mix(1.0, 0.78, isSunkenRoom);
    float paperGrain =
      sin(v_worldPos.x * 38.0 + sin(v_worldPos.y * 29.0)) *
      cos(v_worldPos.y * 41.0 + sin(v_worldPos.x * 23.0)) * 0.015;
    scrollPaper += vec3(paperGrain);

    // Delicate architectural ink-wash for colored blocks & exit gates (28% hue + warm vellum)
    vec3 normPieceRgb = u_color.rgb / max(1.0 - isSunkenRoom * 0.40, 0.58);
    vec3 warmPieceHue = mix(clamp(normPieceRgb, 0.0, 1.0), vec3(0.96, 0.78, 0.48), 0.26);
    vec3 pieceWash = mix(scrollPaper + vec3(0.035, 0.025, 0.055), warmPieceHue, mix(0.29, 0.21, isSunkenRoom));
    vec3 scrollFill = mix(scrollPaper, pieceWash, isPiece);

    // 1. 3D Bevel, Chamfer & Circular Stud Rim Drafting Contours
    float bevelInk = smoothstep(0.95, 0.56, abs(N.z)) * mix(0.46, 0.92, isPiece);
    float studOutline = (v_localPos.z > 0.56 && N.z < 0.965) ? 0.95 : 0.0;

    // 2. Crisp World-Grid Blueprint Sub-Divisions & Inner Block Framing Rules
    vec2 cellUv = fract(v_worldPos.xy);
    float borderDist = min(min(cellUv.x, 1.0 - cellUv.x), min(cellUv.y, 1.0 - cellUv.y));
    float gridDraftLine = (1.0 - smoothstep(0.014, 0.042, borderDist)) * mix(0.30, 0.64, isPiece);
    float innerFrameRule =
      (1.0 - smoothstep(0.007, 0.022, abs(borderDist - 0.115))) * isPiece * 0.50;
    float cornerCross =
      (1.0 - smoothstep(0.01, 0.028, min(cellUv.x, 1.0 - cellUv.x))) *
      (1.0 - smoothstep(0.06, 0.14, min(cellUv.y, 1.0 - cellUv.y))) +
      (1.0 - smoothstep(0.01, 0.028, min(cellUv.y, 1.0 - cellUv.y))) *
      (1.0 - smoothstep(0.06, 0.14, min(cellUv.x, 1.0 - cellUv.x)));
    float floorTicks = clamp(cornerCross, 0.0, 1.0) * (1.0 - isPiece) * 0.36;

    // 3. Fine 45-Degree Architectural Pen Cross-Hatching
    float hatchA = sin((v_worldPos.x + v_worldPos.y) * 52.0);
    float hatchB = sin((v_worldPos.x - v_worldPos.y) * 52.0);
    float penHatch =
      smoothstep(0.76, 0.96, hatchA) * mix(0.07, 0.32, isPiece) +
      smoothstep(0.84, 0.98, hatchB) * 0.15 * isPiece;

    // 4. Sacred-Geometry Astrolabe Concentric Rings & 12-Spoke Compass Rays Across the Board
    float angle = atan(relCenter.y, relCenter.x);
    float ringWave = sin(distCenter * 8.37758 - u_boardInfo.z * 0.45);
    float astrolabeRing = smoothstep(0.92, 0.992, ringWave) * 0.28;
    float compassSpoke =
      smoothstep(0.965, 0.997, cos(angle * 12.0 + u_boardInfo.z * 0.14)) *
      smoothstep(0.25, 1.4, distCenter) * 0.18;

    float inkStrength = clamp(
      max(bevelInk, studOutline) +
      gridDraftLine +
      innerFrameRule +
      floorTicks +
      penHatch +
      astrolabeRing +
      compassSpoke,
      0.0,
      1.0
    );

    vec3 baseGold = mix(vec3(0.96, 0.74, 0.38), warmPieceHue, isPiece * 0.28);
    vec3 brightGold = vec3(1.0, 0.94, 0.78);
    vec3 goldInk = mix(baseGold, brightGold, clamp(inkStrength * 0.7, 0.0, 1.0));

    if (u_highContrast == 1) {
      scrollFill *= 0.65;
      inkStrength = clamp(inkStrength * 1.25 + bevelInk * 0.22, 0.0, 1.0);
      goldInk = mix(vec3(1.0, 0.88, 0.40), vec3(1.0, 0.99, 0.92), clamp(inkStrength, 0.0, 1.0));
    }

    vec3 scrollDiagram = mix(scrollFill, goldInk, inkStrength);
    lit = mix(lit, scrollDiagram, u_blueprintMix);
  }

  outColor = vec4(clamp(lit, 0.0, 1.0), u_color.a);
}
`;

const PARTICLE_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 3) in vec4 a_instPosScale;
layout(location = 4) in vec4 a_instColorRot;

uniform mat4 u_viewProj;
uniform int u_particleStyle; // 0=micro_cubes, 1=star_confetti, 2=pixel_sparks, 3=soap_bubbles, 4=lightning_bolts

out vec3 v_normal;
out vec3 v_color;
out vec3 v_localPos;

void main() {
  float angle = a_instColorRot.w;
  float c = cos(angle);
  float s = sin(angle);

  vec3 p = a_position;
  vec3 n = a_normal;

  if (u_particleStyle == 1) {
    // star_confetti: flat fluttering ribbon wafers
    p = vec3(p.x * 1.38, p.y * 1.15, p.z * 0.16);
  } else if (u_particleStyle == 2) {
    // pixel_sparks: crisp axis-aligned voxel sparks
    p = p * 0.78;
    c = 1.0;
    s = 0.0;
  } else if (u_particleStyle == 3) {
    // soap_bubbles: inflated spherical droplets
    vec3 sphereDir = normalize(a_position);
    p = sphereDir * 0.62;
    n = sphereDir;
  } else if (u_particleStyle == 4) {
    // lightning_bolts: elongated jagged electric streaks
    p = vec3(p.x * 2.45, p.y * 0.28 + sin(p.x * 6.0) * 0.14, p.z * 0.28);
  }

  p = p * a_instPosScale.w;
  vec3 rotated = vec3(
    p.x * c - p.y * s,
    p.x * s + p.y * c,
    p.z * c - p.x * s * 0.3
  );

  vec3 worldPos = rotated + a_instPosScale.xyz;
  v_normal = n;
  v_color = a_instColorRot.rgb;
  v_localPos = a_position;

  gl_Position = u_viewProj * vec4(worldPos, 1.0);
}
`;

const PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec3 v_normal;
in vec3 v_color;
in vec3 v_localPos;

uniform int u_particleStyle; // 0=micro_cubes, 1=star_confetti, 2=pixel_sparks, 3=soap_bubbles, 4=lightning_bolts

out vec4 outColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(vec3(-0.3, -0.5, 0.8));
  vec3 V = normalize(vec3(0.0, 0.21, 0.97));
  float light = 0.62 + max(dot(N, L), 0.0) * 0.45;

  if (u_particleStyle == 1) {
    // star_confetti: glossy metallic foil sheen
    float foil = 0.75 + 0.45 * abs(dot(N, L));
    vec3 col = mix(v_color * foil, vec3(1.0, 0.96, 0.8), 0.22);
    outColor = vec4(clamp(col, 0.0, 1.0), 0.96);
    return;
  } else if (u_particleStyle == 2) {
    // pixel_sparks: white-hot incandescent core with glowing edge
    float core = clamp(1.0 - length(v_localPos) * 1.15, 0.0, 1.0);
    vec3 col = mix(v_color * 1.25, vec3(1.0, 0.98, 0.82), core * 0.7);
    outColor = vec4(clamp(col, 0.0, 1.0), 0.98);
    return;
  } else if (u_particleStyle == 3) {
    // soap_bubbles: translucent sphere with iridescent Fresnel rim glow
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    vec3 irid = mix(v_color, vec3(0.78, 0.96, 1.0), 0.55 * fresnel);
    float alpha = clamp(0.28 + fresnel * 0.64, 0.25, 0.92);
    outColor = vec4(clamp(irid + vec3(fresnel * 0.35), 0.0, 1.0), alpha);
    return;
  } else if (u_particleStyle == 4) {
    // lightning_bolts: high-voltage electric cyan/white arc flash
    float arc = clamp(1.0 - abs(v_localPos.y) * 1.6, 0.0, 1.0);
    vec3 col = mix(mix(v_color, vec3(0.35, 0.92, 1.0), 0.55), vec3(1.0), arc * 0.75);
    outColor = vec4(clamp(col, 0.0, 1.0), 0.98);
    return;
  }

  outColor = vec4(clamp(v_color * light, 0.0, 1.0), 0.95);
}
`;

export class Renderer3D {
  public readonly canvas: HTMLCanvasElement;
  public readonly camera: Camera3D;
  public readonly qualityGovernor: QualityGovernor;

  private gl: WebGL2RenderingContext | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private contextLost = false;

  private mainProgram: WebGLProgram | null = null;
  private particleProgram: WebGLProgram | null = null;
  private atlasTexture: WebGLTexture | null = null;
  private atlasData: AtlasTextureData;

  private meshHandles = new Map<MeshData, GLMeshHandle>();
  private particleVao: WebGLVertexArrayObject | null = null;
  private particlePosBuffer: WebGLBuffer | null = null;
  private particleNormBuffer: WebGLBuffer | null = null;
  private particleIndexBuffer: WebGLBuffer | null = null;
  private particleInstanceBuffer: WebGLBuffer | null = null;
  private particleIndexCount = 0;

  // Uniform locations for main program
  private uViewProj: WebGLUniformLocation | null = null;
  private uTranslate: WebGLUniformLocation | null = null;
  private uScale: WebGLUniformLocation | null = null;
  private uRotX: WebGLUniformLocation | null = null;
  private uRotZ: WebGLUniformLocation | null = null;
  private uUvRect: WebGLUniformLocation | null = null;
  private uColor: WebGLUniformLocation | null = null;
  private uCapColor: WebGLUniformLocation | null = null;
  private uClipPlane: WebGLUniformLocation | null = null;
  private uUseClipPlane: WebGLUniformLocation | null = null;
  private uUseTexture: WebGLUniformLocation | null = null;
  private uMaterialStyle: WebGLUniformLocation | null = null;
  private uAtlas: WebGLUniformLocation | null = null;
  private uBlueprintMix: WebGLUniformLocation | null = null;
  private uBoardInfo: WebGLUniformLocation | null = null;
  private uHighContrast: WebGLUniformLocation | null = null;

  // Uniform locations for particle program
  private uPartViewProj: WebGLUniformLocation | null = null;
  private uPartStyle: WebGLUniformLocation | null = null;

  // Pre-allocated 2,048 particle pool (zero per-frame GC allocations)
  private readonly particlePool = new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE);
  private readonly particleInstanceData = new Float32Array(MAX_PARTICLES * INSTANCE_STRIDE);
  private activeParticleCount = 0;
  private particleWriteCursor = 0;

  // Automatic state diff tracking for automatic shred particle bursts, knock-on shockwaves, and bounces
  private lastBoardLevelId = -1;
  private lastSessionShredded = 0;
  private lastMovesCommitted = 0;
  private readonly blockLayerSnapshots = new Map<
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
  >();
  private readonly crateSnapshots = new Map<number, { hp: number; destroyed: boolean }>();
  private readonly gateSnapshots = new Map<
    number,
    {
      colorCursor: number;
      iceCount: number;
      shutterOpen: boolean;
      shutterLockColor: ColorId;
      spanStart: number;
      spanLength: number;
    }
  >();
  private readonly elevatorSnapshots = new Map<number, { atAlternatePos: boolean }>();
  private readonly barrierSnapshots = new Map<
    number,
    { open: boolean; shredsRemaining: number }
  >();
  private readonly roomAwakenMap = new Map<number, number>();
  private readonly activeVisualShreds: VisualShredAnim[] = [];
  private readonly activeShockwaves: VisualShockwave[] = [];
  private readonly blockBounceMap = new Map<number, number>();
  private boardShakeTimer = 0;
  private boardShakeDirX = 0;
  private boardShakeDirY = 0;
  private ambientMoteAccumSec = 0;

  private resizeObserver: ResizeObserver | null = null;
  private cssWidth = 600;
  private cssHeight = 600;
  private currentDpr = 1;
  private lastBoard: BoardState | null = null;
  private lastOptions: RenderSceneOptions = {};
  private startTimeMs = performance.now();

  private readonly onContextLostBound: (e: Event) => void;
  private readonly onContextRestoredBound: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.camera = new Camera3D(6, 6, 1);
    this.qualityGovernor = new QualityGovernor();
    this.atlasData = createAtlasTextureData();

    this.onContextLostBound = (e: Event) => {
      e.preventDefault();
      this.contextLost = true;
    };

    this.onContextRestoredBound = () => {
      this.contextLost = false;
      this.initWebGLResources();
      if (this.lastBoard) {
        this.render(this.lastBoard, this.lastOptions);
      }
    };

    this.canvas.addEventListener('webglcontextlost', this.onContextLostBound, false);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestoredBound, false);

    this.initContext();
    this.setupResizeObserver();

    this.qualityGovernor.setBenchmarkRunner(async (frames: number) => {
      return this.executeBenchmarkFrames(frames);
    });
  }

  public getCamera(): Camera3D {
    return this.camera;
  }

  public getQualityGovernor(): QualityGovernor {
    return this.qualityGovernor;
  }

  public getTelemetry(): PerfTelemetry {
    return this.qualityGovernor.getTelemetry();
  }

  public setQualityPreference(tier: QualityTier): void {
    this.qualityGovernor.setPreference(tier);
  }

  public getEffectiveTrayPalette(trayId: TrayId, highContrast = false): TrayPalette {
    if (highContrast) {
      return HIGH_CONTRAST_TRAY_PALETTES[trayId] ?? HIGH_CONTRAST_TRAY_PALETTES.industrial_slate;
    }
    return TRAY_PALETTES[trayId] ?? TRAY_PALETTES.industrial_slate;
  }

  public async run120HzBenchmark(frames = 120, board?: BoardState): Promise<Benchmark120HzResult> {
    if (board) {
      this.lastBoard = board;
    }
    return this.executeBenchmarkFrames(frames);
  }

  private async executeBenchmarkFrames(frames: number): Promise<Benchmark120HzResult> {
    const count = Math.max(10, frames);
    const samples = new Float32Array(count);

    // Ensure active particles are present during benchmark stress test
    if (this.activeParticleCount < 60 && this.lastBoard) {
      this.spawnParticlesAt(
        this.lastBoard.cols * 0.5,
        this.lastBoard.rows * 0.5,
        0.45,
        1,
        60,
        0,
        -1
      );
    }

    for (let i = 0; i < count; i++) {
      const t0 = performance.now();
      if (this.lastBoard) {
        this.render(this.lastBoard, {
          ...this.lastOptions,
          dtSec: 1 / 120,
        });
      }
      this.gl?.finish();
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

  private initContext(): void {
    try {
      const gl = this.canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: false,
        depth: true,
        stencil: false,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      }) as WebGL2RenderingContext | null;

      if (gl) {
        this.gl = gl;
        this.qualityGovernor.setBackend('WEBGL2');
        this.initWebGLResources();
        return;
      }
    } catch {
      // Fall through to Canvas2D fallback
    }

    this.gl = null;
    this.ctx2d = this.canvas.getContext('2d');
    this.qualityGovernor.setBackend('CANVAS2D');
  }

  /**
   * Sizes the `<canvas>` using `ResizeObserver` checking `"devicePixelContentBoxSize" in ResizeObserverEntry.prototype`
   * with `Math.round(entry.contentRect.width * window.devicePixelRatio)` fallback (`expose-canvas-content-to-browser-features`).
   */
  private setupResizeObserver(): void {
    this.resize();

    if (typeof ResizeObserver === 'undefined') return;

    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const maxDpr = this.qualityGovernor.getTargetMaxDpr();
      const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const dpr = Math.min(maxDpr, rawDpr);
      this.currentDpr = dpr;
      this.qualityGovernor.setDpr(dpr);

      const dpc = (
        entry as ResizeObserverEntry & {
          devicePixelContentBoxSize?: ReadonlyArray<{ inlineSize: number; blockSize: number }>;
        }
      ).devicePixelContentBoxSize;

      const rawPixelW =
        dpc && dpc.length > 0
          ? dpc[0].inlineSize
          : Math.round(entry.contentRect.width * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
      const rawPixelH =
        dpc && dpc.length > 0
          ? dpc[0].blockSize
          : Math.round(entry.contentRect.height * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));

      const scaleCap = rawDpr > maxDpr ? maxDpr / rawDpr : 1;
      const targetW = Math.max(64, Math.round(rawPixelW * scaleCap));
      const targetH = Math.max(64, Math.round(rawPixelH * scaleCap));

      this.cssWidth = Math.max(1, entry.contentRect.width);
      this.cssHeight = Math.max(1, entry.contentRect.height);

      if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
        this.canvas.width = targetW;
        this.canvas.height = targetH;
      }

      if (this.lastBoard) {
        this.render(this.lastBoard, this.lastOptions);
      }
    });

    const supportsDevicePixelContentBox =
      typeof ResizeObserverEntry !== 'undefined' &&
      'devicePixelContentBoxSize' in ResizeObserverEntry.prototype;
    const options: ResizeObserverOptions = supportsDevicePixelContentBox
      ? { box: 'device-pixel-content-box' }
      : {};
    try {
      this.resizeObserver.observe(this.canvas, options);
    } catch {
      this.resizeObserver.observe(this.canvas);
    }
  }

  public resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width > 0 ? rect.width : this.canvas.clientWidth || 640;
    const cssH = rect.height > 0 ? rect.height : this.canvas.clientHeight || 640;
    this.cssWidth = cssW;
    this.cssHeight = cssH;

    const maxDpr = this.qualityGovernor.getTargetMaxDpr();
    const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const dpr = Math.min(maxDpr, rawDpr);
    this.currentDpr = dpr;
    this.qualityGovernor.setDpr(dpr);

    const targetW = Math.max(64, Math.round(cssW * dpr));
    const targetH = Math.max(64, Math.round(cssH * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }
  }

  private releaseWebGLResources(): void {
    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      for (const handle of this.meshHandles.values()) {
        gl.deleteVertexArray(handle.vao);
        gl.deleteBuffer(handle.posBuffer);
        gl.deleteBuffer(handle.normBuffer);
        gl.deleteBuffer(handle.uvBuffer);
        gl.deleteBuffer(handle.indexBuffer);
      }
      if (this.particleVao) gl.deleteVertexArray(this.particleVao);
      if (this.particlePosBuffer) gl.deleteBuffer(this.particlePosBuffer);
      if (this.particleNormBuffer) gl.deleteBuffer(this.particleNormBuffer);
      if (this.particleIndexBuffer) gl.deleteBuffer(this.particleIndexBuffer);
      if (this.particleInstanceBuffer) gl.deleteBuffer(this.particleInstanceBuffer);
      if (this.atlasTexture) gl.deleteTexture(this.atlasTexture);
      if (this.mainProgram) gl.deleteProgram(this.mainProgram);
      if (this.particleProgram) gl.deleteProgram(this.particleProgram);
    }

    this.meshHandles.clear();
    this.particleVao = null;
    this.particlePosBuffer = null;
    this.particleNormBuffer = null;
    this.particleIndexBuffer = null;
    this.particleInstanceBuffer = null;
    this.atlasTexture = null;
    this.mainProgram = null;
    this.particleProgram = null;
  }

  private initWebGLResources(): void {
    const gl = this.gl;
    if (!gl) return;

    this.releaseWebGLResources();

    const mainProg = this.createProgram(gl, MAIN_VERTEX_SHADER, MAIN_FRAGMENT_SHADER);
    const partProg = this.createProgram(gl, PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER);

    if (!mainProg || !partProg) {
      if (mainProg) gl.deleteProgram(mainProg);
      if (partProg) gl.deleteProgram(partProg);
      this.gl = null;
      this.ctx2d = this.canvas.getContext('2d');
      this.qualityGovernor.setBackend('CANVAS2D');
      return;
    }

    this.mainProgram = mainProg;
    this.particleProgram = partProg;

    this.uViewProj = gl.getUniformLocation(mainProg, 'u_viewProj');
    this.uTranslate = gl.getUniformLocation(mainProg, 'u_translate');
    this.uScale = gl.getUniformLocation(mainProg, 'u_scale');
    this.uRotX = gl.getUniformLocation(mainProg, 'u_rotX');
    this.uRotZ = gl.getUniformLocation(mainProg, 'u_rotZ');
    this.uUvRect = gl.getUniformLocation(mainProg, 'u_uvRect');
    this.uColor = gl.getUniformLocation(mainProg, 'u_color');
    this.uCapColor = gl.getUniformLocation(mainProg, 'u_capColor');
    this.uClipPlane = gl.getUniformLocation(mainProg, 'u_clipPlane');
    this.uUseClipPlane = gl.getUniformLocation(mainProg, 'u_useClipPlane');
    this.uUseTexture = gl.getUniformLocation(mainProg, 'u_useTexture');
    this.uMaterialStyle = gl.getUniformLocation(mainProg, 'u_materialStyle');
    this.uAtlas = gl.getUniformLocation(mainProg, 'u_atlas');
    this.uBlueprintMix = gl.getUniformLocation(mainProg, 'u_blueprintMix');
    this.uBoardInfo = gl.getUniformLocation(mainProg, 'u_boardInfo');
    this.uHighContrast = gl.getUniformLocation(mainProg, 'u_highContrast');

    this.uPartViewProj = gl.getUniformLocation(partProg, 'u_viewProj');
    this.uPartStyle = gl.getUniformLocation(partProg, 'u_particleStyle');

    // Upload 512x512 procedural RGBA texture atlas
    const tex = gl.createTexture();
    if (tex) {
      this.atlasTexture = tex;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.atlasData.canvas
      );
    }

    // Pre-upload all 66 static polyomino meshes + environment meshes
    for (const entry of Object.values(POLYOMINO_MESH_CATALOG)) {
      this.getOrCreateMeshHandle(gl, entry.meshOuter);
      this.getOrCreateMeshHandle(gl, entry.meshInnerCore);
      this.getOrCreateMeshHandle(gl, entry.meshOuterStudded);
      this.getOrCreateMeshHandle(gl, entry.meshInnerCoreStudded);
    }
    for (const envMesh of Object.values(ENVIRONMENT_MESHES) as MeshData[]) {
      this.getOrCreateMeshHandle(gl, envMesh);
    }

    // Setup GPU-instanced particle VAO
    this.initParticleInstancedVao(gl);
  }

  private initParticleInstancedVao(gl: WebGL2RenderingContext): void {
    const cube = ENVIRONMENT_MESHES.unitParticleCube;
    const vao = gl.createVertexArray();
    const posBuf = gl.createBuffer();
    const normBuf = gl.createBuffer();
    const idxBuf = gl.createBuffer();
    const instBuf = gl.createBuffer();
    if (!vao || !posBuf || !normBuf || !idxBuf || !instBuf) return;

    this.particleVao = vao;
    this.particlePosBuffer = posBuf;
    this.particleNormBuffer = normBuf;
    this.particleIndexBuffer = idxBuf;
    this.particleInstanceBuffer = instBuf;
    this.particleIndexCount = cube.indices.length;

    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, cube.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, cube.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cube.indices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.particleInstanceData.byteLength, gl.DYNAMIC_DRAW);

    const strideBytes = INSTANCE_STRIDE * 4;
    // location 3: a_instPosScale (vec4)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, strideBytes, 0);
    gl.vertexAttribDivisor(3, 1);

    // location 4: a_instColorRot (vec4)
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, strideBytes, 16);
    gl.vertexAttribDivisor(4, 1);

    gl.bindVertexArray(null);
  }

  private getOrCreateMeshHandle(gl: WebGL2RenderingContext, mesh: MeshData): GLMeshHandle {
    const existing = this.meshHandles.get(mesh);
    if (existing) return existing;

    const vao = gl.createVertexArray()!;
    const posBuffer = gl.createBuffer()!;
    const normBuffer = gl.createBuffer()!;
    const uvBuffer = gl.createBuffer()!;
    const indexBuffer = gl.createBuffer()!;

    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, normBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);

    const handle: GLMeshHandle = {
      vao,
      posBuffer,
      normBuffer,
      uvBuffer,
      indexBuffer,
      indexCount: mesh.indices.length,
    };
    this.meshHandles.set(mesh, handle);
    return handle;
  }

  private createProgram(
    gl: WebGL2RenderingContext,
    vsSource: string,
    fsSource: string
  ): WebGLProgram | null {
    const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }

    const prog = gl.createProgram();
    if (!prog) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.detachShader(prog, vs);
    gl.detachShader(prog, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      return null;
    }
    return prog;
  }

  private compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    source: string
  ): WebGLShader | null {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  public screenToBoard(
    clientX: number,
    clientY: number,
    rows: number,
    cols: number
  ): { boardX: number; boardY: number } {
    const rect = this.canvas.getBoundingClientRect();
    return this.camera.screenToBoardRayPlane(clientX, clientY, rect, rows, cols);
  }

  public boardToScreen(
    boardX: number,
    boardY: number,
    worldZ: number,
    rows: number,
    cols: number
  ): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return this.camera.boardToScreen(boardX, boardY, worldZ, rect, rows, cols);
  }

  /**
   * Spawns a burst of 3D shredder particles into the pre-allocated 2,048-particle ring buffer.
   */
  public spawnParticlesAt(
    worldX: number,
    worldY: number,
    worldZ: number,
    colorId: ColorId,
    count?: number,
    dirX = 0,
    dirY = 0,
    particleStyle: ParticleStyleId = 'micro_cubes'
  ): void {
    const entry = COLOR_PALETTE[colorId] ?? COLOR_PALETTE[1];
    const [r, g, b] = entry.rgb;
    const burstCount =
      count ?? this.qualityGovernor.getBurstParticleCount(Boolean(this.lastOptions.reducedMotion));

    let styleSpeedMul = 1.0;
    let styleScaleMul = 1.0;
    if (particleStyle === 'pixel_sparks' || particleStyle === 'lightning_bolts') {
      styleSpeedMul = 1.35;
      styleScaleMul = 0.82;
    } else if (particleStyle === 'soap_bubbles') {
      styleSpeedMul = 0.72;
      styleScaleMul = 1.25;
    } else if (particleStyle === 'star_confetti') {
      styleSpeedMul = 1.1;
      styleScaleMul = 1.1;
    }

    const hasDir = Math.hypot(dirX, dirY) > 0.1;
    const tanX = hasDir ? -dirY : 1;
    const tanY = hasDir ? dirX : 0;

    for (let i = 0; i < burstCount; i++) {
      const idx = this.particleWriteCursor * PARTICLE_STRIDE;
      this.particleWriteCursor = (this.particleWriteCursor + 1) % MAX_PARTICLES;

      const angle = (i / burstCount) * Math.PI * 2 + (i * 1.6180339);
      const radialSpeed = (0.45 + ((i * 7) % 13) * 0.14) * styleSpeedMul;
      const lateralOffset = (((i * 11) % 19) / 9.0 - 1.0) * 0.58;
      const jitterRadius = 0.04 + ((i * 5) % 9) * 0.025;

      const px =
        worldX + (hasDir ? tanX * lateralOffset + dirX * 0.12 : 0) + Math.cos(angle) * jitterRadius;
      const py =
        worldY + (hasDir ? tanY * lateralOffset + dirY * 0.12 : 0) + Math.sin(angle) * jitterRadius;
      const pz = worldZ + (((i * 3) % 7) - 3) * 0.04;

      const forwardBoost = (1.35 + ((i * 13) % 11) * 0.22) * styleSpeedMul;
      const vx =
        dirX * forwardBoost +
        (hasDir ? tanX * lateralOffset * 1.4 : 0) +
        Math.cos(angle) * radialSpeed;
      const vy =
        dirY * forwardBoost +
        (hasDir ? tanY * lateralOffset * 1.4 : 0) +
        Math.sin(angle) * radialSpeed;
      const vz = (1.6 + ((i * 5) % 11) * 0.22) * styleSpeedMul;

      const shade = 0.85 + ((i * 11) % 7) * 0.04;
      this.particlePool[idx + 0] = px;
      this.particlePool[idx + 1] = py;
      this.particlePool[idx + 2] = pz;
      this.particlePool[idx + 3] = vx;
      this.particlePool[idx + 4] = vy;
      this.particlePool[idx + 5] = vz;
      this.particlePool[idx + 6] = Math.min(1, r * shade);
      this.particlePool[idx + 7] = Math.min(1, g * shade);
      this.particlePool[idx + 8] = Math.min(1, b * shade);
      this.particlePool[idx + 9] = (0.085 + ((i * 3) % 5) * 0.018) * styleScaleMul;
      this.particlePool[idx + 10] = 0.001; // age > 0 marks active
      this.particlePool[idx + 11] = 0.48 + ((i * 9) % 7) * 0.06; // maxAge
      this.particlePool[idx + 12] = angle;
      this.particlePool[idx + 13] = (i % 2 === 0 ? 1 : -1) * (4.5 + (i % 5));
    }
  }

  public spawnShockwave(
    cx: number,
    cy: number,
    z: number,
    r: number,
    g: number,
    b: number,
    minRadius = 0.28,
    maxRadius = 1.65,
    maxAge = 0.42
  ): void {
    if (this.lastOptions.reducedMotion) return;
    if (this.activeShockwaves.length >= 16) {
      this.activeShockwaves.shift();
    }
    this.activeShockwaves.push({
      cx,
      cy,
      z,
      r,
      g,
      b,
      age: 0.001,
      maxAge,
      minRadius,
      maxRadius,
    });
  }

  /**
   * Triggers a multi-wave celebratory 3D confetti & golden shockwave fountain across the sanctuary
   * courtyard when a level is won.
   */
  public spawnVictoryCelebrationBurst(board: BoardState): void {
    const style = this.lastOptions.equippedParticle ?? 'star_confetti';
    const centerCx = board.cols * 0.5;
    const centerCy = board.rows * 0.5;

    // 3 concentric golden & turquoise shockwave rings
    this.spawnShockwave(centerCx, centerCy, 0.35, 1.0, 0.85, 0.28, 0.3, Math.max(board.cols, board.rows) * 0.72, 0.65);
    this.spawnShockwave(centerCx, centerCy, 0.42, 0.18, 0.88, 0.78, 0.15, Math.max(board.cols, board.rows) * 0.55, 0.52);

    // Center courtyard multi-color fountain
    const celebrationColors: ColorId[] = [4, 1, 2, 3, 7, 8];
    for (let i = 0; i < celebrationColors.length; i++) {
      const angle = (i / celebrationColors.length) * Math.PI * 2;
      const ox = Math.cos(angle) * 0.85;
      const oy = Math.sin(angle) * 0.85;
      this.spawnParticlesAt(
        centerCx + ox,
        centerCy + oy,
        0.52,
        celebrationColors[i],
        28,
        Math.cos(angle) * 0.5,
        Math.sin(angle) * 0.5,
        style
      );
    }

    // Perimeter gate fireworks
    for (const gate of board.gates) {
      const cId = getGateActiveColor(gate);
      const isHoriz = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
      const gx = isHoriz
        ? gate.spanStart + gate.spanLength * 0.5
        : gate.edge === 'LEFT'
          ? gate.edgeLine
          : gate.edgeLine + 1;
      const gy = !isHoriz
        ? gate.spanStart + gate.spanLength * 0.5
        : gate.edge === 'TOP'
          ? gate.edgeLine
          : gate.edgeLine + 1;
      const [nx, ny] = getGateOutwardNormal(gate.edge);
      this.spawnParticlesAt(gx, gy, 0.55, cId, 24, -nx * 0.6, -ny * 0.6, style);
    }
  }

  public spawnBlockShredBurst(
    board: BoardState,
    block: BlockState,
    gate?: GateState,
    colorOverride?: ColorId
  ): void {
    const shape = getShape(block.shapeId);
    const cx = block.x + shape.cols * 0.5;
    const cy = block.y + shape.rows * 0.5;
    const colorId: ColorId = colorOverride ?? getActiveColor(block.colorStack, block.colorCursor);
    let nx = 0;
    let ny = 0;
    if (gate) {
      [nx, ny] = getGateOutwardNormal(gate.edge);
    }
    const [cr, cg, cb] = this.getColorRgb(colorId, Boolean(this.lastOptions.highContrast));
    this.spawnShockwave(cx + nx * 0.35, cy + ny * 0.35, 0.45, cr, cg, cb, 0.3, 1.85, 0.44);
    this.spawnParticlesAt(
      cx + nx * 0.4,
      cy + ny * 0.4,
      0.42,
      colorId,
      this.qualityGovernor.getBurstParticleCount(Boolean(this.lastOptions.reducedMotion)) + 18,
      nx,
      ny,
      this.lastOptions.equippedParticle ?? 'micro_cubes'
    );
  }

  public stepParticles(dtSec: number): void {
    const dt = Math.min(0.05, Math.max(0.001, dtSec));
    const maxActive = this.qualityGovernor.getMaxActiveParticles();
    let active = 0;

    // Step micro-recoil board shake timer
    if (this.boardShakeTimer > 0) {
      this.boardShakeTimer = Math.max(0, this.boardShakeTimer - dt);
    }

    // Step expanding 3D shockwave rings
    for (let i = this.activeShockwaves.length - 1; i >= 0; i--) {
      const sw = this.activeShockwaves[i];
      sw.age += dt;
      if (sw.age >= sw.maxAge) {
        this.activeShockwaves.splice(i, 1);
      }
    }

    // Step knock-on block scale-bounce animations
    for (const [bid, rem] of this.blockBounceMap.entries()) {
      const next = rem - dt;
      if (next <= 0) {
        this.blockBounceMap.delete(bid);
      } else {
        this.blockBounceMap.set(bid, next);
      }
    }

    // Step 3D room awakening upward extrusion timers (`550ms` smooth cubic ease-out)
    for (const [rid, elapsed] of this.roomAwakenMap.entries()) {
      const next = elapsed + dt;
      if (next >= 0.55) {
        this.roomAwakenMap.delete(rid);
      } else {
        this.roomAwakenMap.set(rid, next);
      }
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const idx = i * PARTICLE_STRIDE;
      const age = this.particlePool[idx + 10];
      const maxAge = this.particlePool[idx + 11];
      if (age <= 0 || age >= maxAge) continue;

      const nextAge = age + dt;
      if (nextAge >= maxAge || active >= maxActive) {
        this.particlePool[idx + 10] = 0;
        continue;
      }

      this.particlePool[idx + 10] = nextAge;
      this.particlePool[idx + 0] += this.particlePool[idx + 3] * dt;
      this.particlePool[idx + 1] += this.particlePool[idx + 4] * dt;
      this.particlePool[idx + 2] += this.particlePool[idx + 5] * dt;
      // Gravity
      this.particlePool[idx + 5] -= 6.8 * dt;
      this.particlePool[idx + 12] += this.particlePool[idx + 13] * dt;

      const lifeRatio = 1.0 - nextAge / maxAge;
      const scale = this.particlePool[idx + 9] * (0.35 + 0.65 * lifeRatio);

      const outIdx = active * INSTANCE_STRIDE;
      this.particleInstanceData[outIdx + 0] = this.particlePool[idx + 0];
      this.particleInstanceData[outIdx + 1] = this.particlePool[idx + 1];
      this.particleInstanceData[outIdx + 2] = Math.max(-0.1, this.particlePool[idx + 2]);
      this.particleInstanceData[outIdx + 3] = scale;
      this.particleInstanceData[outIdx + 4] = this.particlePool[idx + 6];
      this.particleInstanceData[outIdx + 5] = this.particlePool[idx + 7];
      this.particleInstanceData[outIdx + 6] = this.particlePool[idx + 8];
      this.particleInstanceData[outIdx + 7] = this.particlePool[idx + 12];
      active++;
    }

    this.activeParticleCount = active;
    this.qualityGovernor.setActiveParticles(active);
  }

  private getRoomVisualState(
    board: BoardState,
    roomId: number
  ): { zOffset: number; luminanceMul: number; isLocked: boolean } {
    if (roomId <= 0) {
      return { zOffset: 0, luminanceMul: 1.0, isLocked: false };
    }
    if (!isRoomUnlocked(board, roomId)) {
      return { zOffset: -0.14, luminanceMul: 0.58, isLocked: true };
    }
    const elapsed = this.roomAwakenMap.get(roomId);
    if (elapsed !== undefined && elapsed < 0.55 && !this.lastOptions.reducedMotion) {
      const t = Math.min(1, Math.max(0, elapsed / 0.55));
      const eased = 1 - Math.pow(1 - t, 3);
      return {
        zOffset: -0.14 * (1 - eased),
        luminanceMul: 0.58 + 0.42 * eased,
        isLocked: false,
      };
    }
    return { zOffset: 0, luminanceMul: 1.0, isLocked: false };
  }

  /**
   * Spawns continuous GPU-instanced ambient sanctuary motes and ready-gate roller sparks (`IDLE-04`)
   * when `reducedMotion === false` so the idle 3D courtyard feels alive and tactile.
   */
  private spawnAmbientCourtyardMotes(
    board: BoardState,
    options: RenderSceneOptions,
    dtSec: number,
    timeSec: number
  ): void {
    if (options.reducedMotion || (options.blueprintMix ?? 0) > 0.5) return;
    const isUltra = this.qualityGovernor.getActiveTier() === 'ULTRA_120';
    const spawnIntervalSec = isUltra ? 0.24 : 0.42;
    const maxAmbientCap = isUltra ? 18 : 10;

    this.ambientMoteAccumSec = Math.min(0.5, this.ambientMoteAccumSec + dtSec);
    if (this.ambientMoteAccumSec < spawnIntervalSec) return;

    const pStyle = options.equippedParticle ?? 'micro_cubes';
    let stepIndex = Math.floor(timeSec * 6.0);

    while (this.ambientMoteAccumSec >= spawnIntervalSec) {
      this.ambientMoteAccumSec -= spawnIntervalSec;
      stepIndex++;
      if (this.activeParticleCount >= maxAmbientCap) break;

      const readyGates = board.gates.filter(
        (g) =>
          g.shutterOpen &&
          g.shutterLockColor === 0 &&
          g.iceCount <= 0 &&
          !isGateInLockedRoom(board, g)
      );

      // Alternate between Gate Roller Intake Sparks and Floating Block/Courtyard Shimmer Motes
      if (readyGates.length > 0 && stepIndex % 2 === 0) {
        const gate = readyGates[stepIndex % readyGates.length];
        const cId = getGateActiveColor(gate);
        const [r, g, b] = this.getColorRgb(cId, Boolean(options.highContrast));
        const isHoriz = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
        const spanFrac = 0.15 + ((stepIndex * 0.381966) % 0.7);
        const along = gate.spanStart + gate.spanLength * spanFrac;
        const gx = isHoriz
          ? along
          : gate.edge === 'LEFT'
            ? gate.edgeLine - 0.14
            : gate.edgeLine + 1 + 0.14;
        const gy = !isHoriz
          ? along
          : gate.edge === 'TOP'
            ? gate.edgeLine - 0.14
            : gate.edgeLine + 1 + 0.14;
        const [nx, ny] = getGateOutwardNormal(gate.edge);

        const idx = this.particleWriteCursor * PARTICLE_STRIDE;
        this.particleWriteCursor = (this.particleWriteCursor + 1) % MAX_PARTICLES;
        this.particlePool[idx + 0] = gx;
        this.particlePool[idx + 1] = gy;
        this.particlePool[idx + 2] = 0.42;
        this.particlePool[idx + 3] = -nx * 0.38 + Math.sin(timeSec * 2.5 + stepIndex) * 0.22;
        this.particlePool[idx + 4] = -ny * 0.38 + Math.cos(timeSec * 2.1 + stepIndex) * 0.22;
        this.particlePool[idx + 5] = 1.45 + (stepIndex % 3) * 0.16;
        this.particlePool[idx + 6] = Math.min(1, r * 0.85 + 0.2);
        this.particlePool[idx + 7] = Math.min(1, g * 0.85 + 0.2);
        this.particlePool[idx + 8] = Math.min(1, b * 0.85 + 0.18);
        this.particlePool[idx + 9] = pStyle === 'soap_bubbles' ? 0.082 : 0.062;
        this.particlePool[idx + 10] = 0.001;
        this.particlePool[idx + 11] = 0.62;
        this.particlePool[idx + 12] = stepIndex * 0.9;
        this.particlePool[idx + 13] = (stepIndex % 2 === 0 ? 1 : -1) * 3.4;
      } else {
        const activeBlocks = board.blocks.filter(
          (blk) => blk.status === 'ACTIVE' && !isBlockInLockedRoom(board, blk)
        );
        let mx = ((stepIndex * 1.6180339) % 1) * board.cols;
        let my = ((stepIndex * 2.4142135) % 1) * board.rows;
        let mr = 1.0;
        let mg = 0.88;
        let mb = 0.52;

        if (activeBlocks.length > 0) {
          const blk = activeBlocks[stepIndex % activeBlocks.length];
          const shape = getShape(blk.shapeId);
          const cell = shape.cells[stepIndex % shape.cells.length] ?? shape.cells[0];
          const jitterX = 0.2 + ((stepIndex * 0.618) % 0.6);
          const jitterY = 0.2 + ((stepIndex * 0.754) % 0.6);
          mx = blk.x + cell[1] + jitterX;
          my = blk.y + cell[0] + jitterY;
          const cId = getActiveColor(blk.colorStack, blk.colorCursor);
          const [br, bg, bb] = this.getColorRgb(cId, Boolean(options.highContrast));
          mr = Math.min(1, br * 0.68 + 0.35);
          mg = Math.min(1, bg * 0.68 + 0.32);
          mb = Math.min(1, bb * 0.68 + 0.24);
        } else {
          const fallbackR = Math.floor(my);
          const fallbackC = Math.floor(mx);
          if (
            fallbackR < 0 ||
            fallbackR >= board.rows ||
            fallbackC < 0 ||
            fallbackC >= board.cols ||
            board.occupancy[fallbackR * board.cols + fallbackC] === -1
          ) {
            continue;
          }
        }

        const idx = this.particleWriteCursor * PARTICLE_STRIDE;
        this.particleWriteCursor = (this.particleWriteCursor + 1) % MAX_PARTICLES;
        this.particlePool[idx + 0] = mx;
        this.particlePool[idx + 1] = my;
        this.particlePool[idx + 2] = 0.62;
        this.particlePool[idx + 3] = Math.cos(timeSec * 1.8 + stepIndex) * 0.22;
        this.particlePool[idx + 4] = Math.sin(timeSec * 2.1 + stepIndex) * 0.22;
        this.particlePool[idx + 5] = 1.65 + (stepIndex % 4) * 0.14;
        this.particlePool[idx + 6] = mr;
        this.particlePool[idx + 7] = mg;
        this.particlePool[idx + 8] = mb;
        this.particlePool[idx + 9] = pStyle === 'soap_bubbles' ? 0.086 : 0.066;
        this.particlePool[idx + 10] = 0.001;
        this.particlePool[idx + 11] = 0.68;
        this.particlePool[idx + 12] = stepIndex * 1.2;
        this.particlePool[idx + 13] = (stepIndex % 2 === 0 ? 1 : -1) * 2.8;
      }
    }
  }

  private syncSnapshots(board: BoardState): void {
    this.lastBoardLevelId = board.levelId;
    this.lastSessionShredded = board.sessionBlocksShredded;
    this.lastMovesCommitted = board.movesCommitted;
    this.blockLayerSnapshots.clear();
    for (const b of board.blocks) {
      this.blockLayerSnapshots.set(b.id, {
        cursor: b.colorCursor,
        status: b.status,
        x: b.x,
        y: b.y,
        row: b.row,
        col: b.col,
        color: getActiveColor(b.colorStack, b.colorCursor),
        iceCount: b.iceCount,
        chained: b.chained,
        ropeColor: b.ropeColor,
      });
    }
    this.crateSnapshots.clear();
    for (const c of board.crates) {
      this.crateSnapshots.set(c.id, { hp: c.hp, destroyed: c.destroyed });
    }
    this.gateSnapshots.clear();
    board.gates.forEach((g, idx) => {
      this.gateSnapshots.set(idx, {
        colorCursor: g.colorCursor,
        iceCount: g.iceCount,
        shutterOpen: g.shutterOpen,
        shutterLockColor: g.shutterLockColor,
        spanStart: g.spanStart,
        spanLength: g.spanLength,
      });
    });
    this.elevatorSnapshots.clear();
    for (const el of board.elevators) {
      this.elevatorSnapshots.set(el.id, { atAlternatePos: el.atAlternatePos });
    }
    this.barrierSnapshots.clear();
    for (const bar of board.barriers) {
      this.barrierSnapshots.set(bar.id, {
        open: bar.open,
        shredsRemaining: bar.shredsRemaining,
      });
    }
  }

  private detectAutomaticShredEvents(board: BoardState, options: RenderSceneOptions): void {
    const isLevelChange = board.levelId !== this.lastBoardLevelId;
    const isUndoOrRestart =
      board.movesCommitted < this.lastMovesCommitted ||
      (board.movesCommitted === 0 && this.lastMovesCommitted > 0) ||
      board.sessionBlocksShredded < this.lastSessionShredded;

    if (isLevelChange || isUndoOrRestart) {
      this.syncSnapshots(board);
      this.roomAwakenMap.clear();
      if (isLevelChange) {
        this.activeVisualShreds.length = 0;
        this.activeShockwaves.length = 0;
        this.blockBounceMap.clear();
        this.boardShakeTimer = 0;
      }
      return;
    }

    const hc = Boolean(options.highContrast);
    const pStyle = options.equippedParticle ?? 'micro_cubes';

    // Check if any moving elevator toggled position this frame
    let anyElevatorMoved = false;
    for (const el of board.elevators) {
      const prevEl = this.elevatorSnapshots.get(el.id);
      if (prevEl && prevEl.atAlternatePos !== el.atAlternatePos) {
        anyElevatorMoved = true;
      }
    }

    // 1. Diff Block Shreds, Layer Peels, Generator Spawns, Ice Thaws, Key Unlocks, Rope Cuts & Elevator Shifts
    for (const b of board.blocks) {
      const prev = this.blockLayerSnapshots.get(b.id);
      const curColor: ColorId = getActiveColor(b.colorStack, b.colorCursor);
      const shape = getShape(b.shapeId);
      const cx = b.x + shape.cols * 0.5;
      const cy = b.y + shape.rows * 0.5;

      if (!prev && b.status === 'ACTIVE') {
        // Generator spawned a new block!
        const [cr, cg, cb] = this.getColorRgb(curColor, hc);
        this.spawnShockwave(cx, cy, 0.55, cr, cg, cb, 0.25, 1.55, 0.42);
        this.spawnParticlesAt(cx, cy, 0.48, curColor, 26, 0, 0, pStyle);
        this.blockBounceMap.set(b.id, 0.34);
        continue;
      }

      if (prev) {
        const peeled = b.colorCursor > prev.cursor;
        const cleared = prev.status === 'ACTIVE' && b.status !== 'ACTIVE';
        if (peeled || cleared) {
          const gate = b.shredGateIndex >= 0 ? board.gates[b.shredGateIndex] : undefined;
          let nx = 0;
          let ny = 0;
          if (gate) {
            [nx, ny] = getGateOutwardNormal(gate.edge);
            gate.rollerPhase += 2.2;
          }
          if (b.shredGateIndex >= 0 && gate) {
            this.activeVisualShreds.push({
              shapeId: b.shapeId,
              x: b.x,
              y: b.y,
              colorId: prev.color,
              gateIndex: b.shredGateIndex,
              progress: 0,
              isOuterPeelOnly: peeled && !cleared,
            });
          }
          const [pr, pg, pb] = this.getColorRgb(prev.color, hc);
          this.spawnShockwave(cx + nx * 0.35, cy + ny * 0.35, 0.45, pr, pg, pb, 0.3, 1.85, 0.44);
          this.spawnParticlesAt(
            cx + nx * 0.35,
            cy + ny * 0.35,
            0.42,
            prev.color,
            this.qualityGovernor.getBurstParticleCount(Boolean(options.reducedMotion)) + 16,
            nx,
            ny,
            pStyle
          );
          if (!options.reducedMotion) {
            this.boardShakeTimer = 0.16;
            this.boardShakeDirX = nx !== 0 ? nx : 0.7;
            this.boardShakeDirY = ny !== 0 ? ny : 0.7;
          }
          if (peeled && !cleared) {
            this.blockBounceMap.set(b.id, 0.32);
          }
        }

        if (b.status === 'ACTIVE') {
          // Knock-on 1A: Ice thawed or shattered on block
          if (prev.iceCount > 0 && b.iceCount < prev.iceCount) {
            this.spawnShockwave(cx, cy, 0.58, 0.42, 0.92, 1.0, 0.25, 1.48, 0.38);
            this.spawnParticlesAt(cx, cy, 0.52, 7, 24, 0, 0, pStyle);
            this.blockBounceMap.set(b.id, 0.32);
          }
          // Knock-on 1B: Chain unlocked by Key
          if (prev.chained && !b.chained) {
            this.spawnShockwave(cx, cy, 0.6, 1.0, 0.85, 0.24, 0.28, 1.65, 0.42);
            this.spawnParticlesAt(cx, cy, 0.54, 4, 28, 0, 0, pStyle);
            this.blockBounceMap.set(b.id, 0.34);
          }
          // Knock-on 1C: Colored Rope untied by Scissors
          if (prev.ropeColor > 0 && b.ropeColor === 0) {
            const [rr, rg, rb] = this.getColorRgb(prev.ropeColor, hc);
            this.spawnShockwave(cx, cy, 0.6, rr, rg, rb, 0.28, 1.65, 0.42);
            this.spawnParticlesAt(cx, cy, 0.54, prev.ropeColor, 28, 0, 0, pStyle);
            this.blockBounceMap.set(b.id, 0.34);
          }
          // Knock-on 1D: Elevator shifted block
          if (
            anyElevatorMoved &&
            prev.status === 'ACTIVE' &&
            (b.row !== prev.row || b.col !== prev.col)
          ) {
            this.spawnShockwave(cx, cy, 0.35, 0.38, 0.78, 1.0, 0.25, 1.35, 0.36);
            this.blockBounceMap.set(b.id, 0.3);
          }
        }
      }
    }

    // 2. Diff Wooden Crate Crack / Shatter Knock-Ons
    for (const c of board.crates) {
      const prevC = this.crateSnapshots.get(c.id);
      if (prevC && (c.hp < prevC.hp || (!prevC.destroyed && c.destroyed))) {
        const cx = c.col + 0.5;
        const cy = c.row + 0.5;
        this.spawnShockwave(cx, cy, 0.45, 0.96, 0.62, 0.22, 0.22, 1.45, 0.38);
        this.spawnParticlesAt(cx, cy, 0.45, 6, c.destroyed ? 32 : 18, 0, 0, pStyle);
      }
    }

    // 3. Diff Gate Knock-Ons: Only fire a localized gate unlock effect when a gate's
    // frozen ice shatters to 0 or its shutter gem lock unlocks — never on routine color queue steps or sliding.
    board.gates.forEach((gate, gi) => {
      const prevG = this.gateSnapshots.get(gi);
      if (!prevG) return;
      const iceShattered = prevG.iceCount > 0 && gate.iceCount === 0;
      const gemUnlocked = prevG.shutterLockColor > 0 && gate.shutterLockColor === 0;

      if (iceShattered || gemUnlocked) {
        const isHoriz = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
        const gx = isHoriz
          ? gate.spanStart + gate.spanLength * 0.5
          : gate.edge === 'LEFT'
            ? gate.edgeLine
            : gate.edgeLine + 1;
        const gy = !isHoriz
          ? gate.spanStart + gate.spanLength * 0.5
          : gate.edge === 'TOP'
            ? gate.edgeLine
            : gate.edgeLine + 1;
        const cId = getGateActiveColor(gate);
        const [gr, gg, gb] = iceShattered ? [0.45, 0.92, 1.0] : this.getColorRgb(cId, hc);
        this.spawnShockwave(gx, gy, 0.52, gr, gg, gb, 0.2, 0.85, 0.32);
        this.spawnParticlesAt(gx, gy, 0.5, iceShattered ? 7 : cId, 8, 0, 0, pStyle);
      }
    });

    // 4. Diff Sanctuary Portcullis Barrier Countdown & Room Awakening Knock-Ons (`SANCTUM-01`)
    for (const bar of board.barriers) {
      const prevB = this.barrierSnapshots.get(bar.id);
      if (!prevB || bar.cells.length === 0) continue;
      let minR = bar.cells[0][0];
      let maxR = bar.cells[0][0];
      let minC = bar.cells[0][1];
      let maxC = bar.cells[0][1];
      for (const [r, c] of bar.cells) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
      const spanW = maxC - minC + 1;
      const spanH = maxR - minR + 1;
      const barLen = Math.max(spanW, spanH);
      const bcx = minC + spanW * 0.5;
      const bcy = minR + spanH * 0.5;
      if (!prevB.open && bar.open) {
        this.roomAwakenMap.set(bar.unlocksRoomId, 0.001);
        this.spawnShockwave(
          bcx,
          bcy,
          0.55,
          1.0,
          0.86,
          0.32,
          0.35,
          Math.max(2.2, barLen * 0.95),
          0.52
        );
        this.spawnParticlesAt(bcx, bcy, 0.52, 4, 34, 0, 0, pStyle);
        for (const blk of board.blocks) {
          if (blk.status === 'ACTIVE' && getBlockRoomId(board, blk) === bar.unlocksRoomId) {
            this.blockBounceMap.set(blk.id, 0.38);
          }
        }
      } else if (!bar.open && bar.shredsRemaining < prevB.shredsRemaining) {
        this.spawnShockwave(bcx, bcy, 0.62, 1.0, 0.88, 0.38, 0.18, 0.85, 0.28);
      }
    }

    this.syncSnapshots(board);
  }

  public renderFrame(board: BoardState, options: RenderSceneOptions = {}): void {
    this.render(board, options);
  }

  /**
   * Executes the 4-pass 3D render pipeline (`Tray & Environment`, `Target Reticle & Gate Alignment Beam`,
   * `3D Polyomino Blocks & Clip-Plane Shredding`, `GPU-Instanced 3D Shredder Particles`) and records
   * frame work duration in `QualityGovernor`.
   */
  public render(board: BoardState, options: RenderSceneOptions = {}): void {
    const frameStart = performance.now();
    this.lastBoard = board;
    this.lastOptions = options;

    if (options.qualityTier) {
      this.qualityGovernor.setPreference(options.qualityTier);
    }

    const maxDpr = this.qualityGovernor.getTargetMaxDpr();
    const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const expectedDpr = Math.min(maxDpr, rawDpr);
    if (Math.abs(expectedDpr - this.currentDpr) > 0.01) {
      this.resize();
    }

    const dtSec = options.dtSec ?? 1 / 60;
    const timeSec = options.timeSec ?? (performance.now() - this.startTimeMs) * 0.001;
    this.detectAutomaticShredEvents(board, options);
    this.spawnAmbientCourtyardMotes(board, options, dtSec, timeSec);
    this.stepParticles(dtSec);

    const aspect =
      this.canvas.width > 0 && this.canvas.height > 0
        ? this.canvas.width / this.canvas.height
        : 1;
    this.camera.setBoardAndViewport(board.rows, board.cols, aspect);

    if (this.gl && !this.contextLost && this.mainProgram && this.particleProgram) {
      this.renderWebGL2(board, options, dtSec);
    } else if (this.ctx2d) {
      this.renderCanvas2DFallback(board, options, dtSec);
    }

    const nowMs = performance.now();
    const workDurationMs = nowMs - frameStart;
    this.qualityGovernor.recordFrameWork(workDurationMs, nowMs);
  }

  private getColorRgb(colorId: ColorId, highContrast = false): [number, number, number] {
    const entry = COLOR_PALETTE[colorId] ?? COLOR_PALETTE[0];
    return highContrast ? entry.hcRgb : entry.rgb;
  }

  private getMaterialStyleCode(skin: SkinId = 'smooth_bevel'): number {
    if (skin === 'gummy_jelly') return 1;
    if (skin === 'carved_wood') return 2;
    if (skin === 'neon_cyber') return 3;
    return 0;
  }

  private drawMesh(
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
    a = 1.0,
    rotX = 0,
    rotZ = 0,
    materialStyle = 0,
    uvRegion: AtlasUVRegion | null = null
  ): void {
    const handle = this.getOrCreateMeshHandle(gl, mesh);
    gl.bindVertexArray(handle.vao);
    const shakeAmp =
      this.boardShakeTimer > 0 && !this.lastOptions.reducedMotion
        ? Math.sin(this.boardShakeTimer * 54.0) * (this.boardShakeTimer / 0.16) * 0.055
        : 0;
    gl.uniform3f(
      this.uTranslate,
      tx + this.boardShakeDirX * shakeAmp,
      ty + this.boardShakeDirY * shakeAmp,
      tz
    );
    gl.uniform3f(this.uScale, sx, sy, sz);
    gl.uniform1f(this.uRotX, rotX);
    gl.uniform1f(this.uRotZ, rotZ);
    gl.uniform4f(this.uColor, r, g, b, a);
    gl.uniform1i(this.uMaterialStyle, materialStyle);

    if (uvRegion) {
      gl.uniform1i(this.uUseTexture, 1);
      gl.uniform4f(this.uUvRect, uvRegion.u0, uvRegion.v0, uvRegion.u1, uvRegion.v1);
    } else {
      gl.uniform1i(this.uUseTexture, 0);
      gl.uniform4f(this.uUvRect, 0, 0, 1, 1);
    }

    gl.drawElements(gl.TRIANGLES, handle.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  private drawAtlasBadge(
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
    const region = this.atlasData.regions[regionKey];
    if (!region) return;
    this.drawMesh(
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

  private drawNumberBadges(
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
      this.drawAtlasBadge(
        gl,
        `DIGIT_${ch}`,
        startX + i * step,
        cy,
        z,
        digitSize,
        r,
        g,
        b,
        1.0
      );
    }
  }

  /**
   * Renders a two-tiered 3D beveled architectural medallion plinth (`UX-10`, `R3D-07`)
   * using `unitParticleCube` (`materialStyle = 0` full 3D lighting) so block modifiers and axis
   * emblems look carved and inlaid into the 3D piece rather than flat black 2D stickers.
   * Returns the exact top `Z` coordinate (`zBase + 0.086`) for placing the vector glyph on top.
   */
  private drawBadgeMedallion3D(
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
    // 1. Outer 3D beveled brass/metallic bezel (`unitParticleCube` is centered at 0,0,0)
    this.drawMesh(
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
    // 2. Inner 3D beveled tone-on-tone jewel plinth
    this.drawMesh(
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

  private renderWebGL2(board: BoardState, options: RenderSceneOptions, dtSec = 1 / 60): void {
    const gl = this.gl!;
    const trayId = options.equippedTray ?? 'industrial_slate';
    const skinId = options.equippedSkin ?? 'smooth_bevel';
    const highContrast = Boolean(options.highContrast);
    const colorblind = Boolean(options.colorblindSymbols);
    const palette = this.getEffectiveTrayPalette(trayId, highContrast);
    const timeSec = options.timeSec ?? (performance.now() - this.startTimeMs) * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 6.0);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA
    );
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const blueprintMix = Math.max(0, Math.min(1, options.blueprintMix ?? 0));
    gl.useProgram(this.mainProgram);
    gl.uniformMatrix4fv(this.uViewProj, false, this.camera.getViewProjectionMatrix(false));
    gl.uniform1i(this.uUseClipPlane, 0);
    gl.uniform4f(this.uClipPlane, 0, 0, 1, 0);
    gl.uniform3f(this.uCapColor, 0.2, 0.2, 0.2);
    gl.uniform1f(this.uBlueprintMix, blueprintMix);
    gl.uniform3f(this.uBoardInfo, board.cols * 0.5, board.rows * 0.5, timeSec);
    gl.uniform1i(this.uHighContrast, highContrast ? 1 : 0);

    if (this.atlasTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
      gl.uniform1i(this.uAtlas, 0);
    }

    // =========================================================================
    // PASS 1: TRAY & ENVIRONMENT PASS
    // =========================================================================
    this.renderPass1Environment(gl, board, palette, highContrast, colorblind, timeSec);

    // =========================================================================
    // PASS 2: TARGET RETICLE & GATE ALIGNMENT BEAM PASS (`UX-01`)
    // =========================================================================
    this.renderPass2ReticleAndPrompts(gl, board, options, highContrast, pulse);

    // =========================================================================
    // PASS 3: 3D POLYOMINO BLOCKS & CLIP-PLANE SHREDDING PASS
    // =========================================================================
    this.renderPass3Blocks(gl, board, options, skinId, highContrast, colorblind, pulse, timeSec, dtSec);

    // =========================================================================
    // PASS 4: GPU-INSTANCED 3D SHREDDER PARTICLES PASS
    // =========================================================================
    if (blueprintMix < 0.65) {
      this.renderPass4Particles(gl, options.equippedParticle ?? 'micro_cubes');
    }
  }

  private renderPass1Environment(
    gl: WebGL2RenderingContext,
    board: BoardState,
    palette: TrayPalette,
    highContrast: boolean,
    colorblind: boolean,
    timeSec: number
  ): void {
    const { rows, cols, occupancy, floorColor } = board;
    const live3DMix = Math.max(0, 1.0 - (this.lastOptions.blueprintMix ?? 0) * 0.92);
    const isCellPlayable = (r: number, c: number): boolean =>
      r >= 0 && r < rows && c >= 0 && c < cols && occupancy[r * cols + c] !== -1;

    // 1A. Contoured Stepped Sanctuary Pedestal Plinth (merged contiguous spans to minimize draw calls & overdraw)
    const plinthSpans: Array<{ r0: number; r1: number; c0: number; c1: number; roomId: number }> = [];
    for (let r = 0; r < rows; r++) {
      let c = 0;
      while (c < cols) {
        if (!isCellPlayable(r, c)) {
          c++;
          continue;
        }
        const roomId = board.roomMap[r * cols + c] ?? 0;
        const c0 = c;
        while (
          c + 1 < cols &&
          isCellPlayable(r, c + 1) &&
          (board.roomMap[r * cols + (c + 1)] ?? 0) === roomId
        ) {
          c++;
        }
        const c1 = c;
        const prev = plinthSpans.find(
          (s) => s.r1 === r - 1 && s.c0 === c0 && s.c1 === c1 && s.roomId === roomId
        );
        if (prev) {
          prev.r1 = r;
        } else {
          plinthSpans.push({ r0: r, r1: r, c0, c1, roomId });
        }
        c++;
      }
    }

    for (const span of plinthSpans) {
      const roomVis = this.getRoomVisualState(board, span.roomId);
      const zOff = roomVis.zOffset;
      const lum = roomVis.luminanceMul;
      let bordersDiffRoomTop = false;
      let bordersDiffRoomBot = false;
      for (let c = span.c0; c <= span.c1; c++) {
        if (
          span.r0 > 0 &&
          isCellPlayable(span.r0 - 1, c) &&
          (board.roomMap[(span.r0 - 1) * cols + c] ?? 0) !== span.roomId
        ) {
          bordersDiffRoomTop = true;
        }
        if (
          span.r1 < rows - 1 &&
          isCellPlayable(span.r1 + 1, c) &&
          (board.roomMap[(span.r1 + 1) * cols + c] ?? 0) !== span.roomId
        ) {
          bordersDiffRoomBot = true;
        }
      }
      let bordersDiffRoomLeft = false;
      let bordersDiffRoomRight = false;
      for (let r = span.r0; r <= span.r1; r++) {
        if (
          span.c0 > 0 &&
          isCellPlayable(r, span.c0 - 1) &&
          (board.roomMap[r * cols + (span.c0 - 1)] ?? 0) !== span.roomId
        ) {
          bordersDiffRoomLeft = true;
        }
        if (
          span.c1 < cols - 1 &&
          isCellPlayable(r, span.c1 + 1) &&
          (board.roomMap[r * cols + (span.c1 + 1)] ?? 0) !== span.roomId
        ) {
          bordersDiffRoomRight = true;
        }
      }

      const stepL = bordersDiffRoomLeft ? 0.02 : 0.55;
      const stepR = bordersDiffRoomRight ? 0.02 : 0.55;
      const stepT = bordersDiffRoomTop ? 0.02 : 0.55;
      const stepB = bordersDiffRoomBot ? 0.02 : 0.55;
      const spanW = span.c1 - span.c0 + 1;
      const spanH = span.r1 - span.r0 + 1;

      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.wallSegment,
        span.c0 - stepL,
        span.r0 - stepT,
        -0.34 + zOff * 0.45,
        spanW + stepL + stepR,
        spanH + stepT + stepB,
        0.16,
        palette.wallColor[0] * 0.56 * lum,
        palette.wallColor[1] * 0.55 * lum,
        palette.wallColor[2] * 0.62 * lum,
        1.0
      );

      const padL = bordersDiffRoomLeft ? 0.02 : 0.38;
      const padR = bordersDiffRoomRight ? 0.02 : 0.38;
      const padT = bordersDiffRoomTop ? 0.02 : 0.38;
      const padB = bordersDiffRoomBot ? 0.02 : 0.38;
      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.wallSegment,
        span.c0 - padL,
        span.r0 - padT,
        -0.18 + zOff * 0.65,
        spanW + padL + padR,
        spanH + padT + padB,
        0.18,
        palette.wallColor[0] * 0.78 * lum,
        palette.wallColor[1] * 0.76 * lum,
        palette.wallColor[2] * 0.82 * lum,
        1.0
      );
    }

    // 1B. Interior Floor Tiles, Sunken Twilight Veil, Pillars & Floor Paths
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const occ = occupancy[idx];

        if (occ === -1) {
          // Exterior VOID cell (`COURTYARD-01`): carved completely away into open negative space!
          continue;
        }

        const roomId = board.roomMap[idx] ?? 0;
        const roomVis = this.getRoomVisualState(board, roomId);
        const zOff = roomVis.zOffset;
        const lum = roomVis.luminanceMul;

        const checker = (r + c) % 2 === 0 ? palette.floorTileA : palette.floorTileB;
        const primaryWave = Math.pow(
          Math.max(0, Math.sin(timeSec * 1.1 - (c * 0.58 + r * 0.46))),
          3
        );
        const crossWave = Math.pow(
          Math.max(0, Math.cos(timeSec * 0.8 + (c - r) * 0.52)),
          4
        );
        const sheen =
          !this.lastOptions.reducedMotion && !roomVis.isLocked
            ? primaryWave * 0.048 + crossWave * 0.022
            : 0;
        const pathColorId = (floorColor[idx] ?? 0) as ColorId;

        if (pathColorId > 0) {
          const [pr, pg, pb] = this.getColorRgb(pathColorId, highContrast);
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.trayFloorTile,
            c,
            r,
            zOff,
            1.0,
            1.0,
            1.0,
            Math.min(1, (pr * 0.62 + checker[0] * 0.38 + sheen) * lum),
            Math.min(1, (pg * 0.62 + checker[1] * 0.38 + sheen) * lum),
            Math.min(1, (pb * 0.62 + checker[2] * 0.38 + sheen * 0.7) * lum),
            1.0
          );
          if (colorblind) {
            this.drawAtlasBadge(
              gl,
              `CB_${pathColorId}`,
              c + 0.5,
              r + 0.5,
              zOff + 0.008,
              0.42,
              lum,
              lum,
              lum,
              0.85
            );
          }
        } else {
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.trayFloorTile,
            c,
            r,
            zOff,
            1.0,
            1.0,
            1.0,
            Math.min(1, (checker[0] + sheen) * lum),
            Math.min(1, (checker[1] + sheen * 0.9) * lum),
            Math.min(1, (checker[2] + sheen * 0.65) * lum + (1 - lum) * 0.05),
            1.0
          );
        }

        // Interior Stone Pillar (`occ === -2`): Fixed architectural wall column with 3D carved diamond capital
        if (occ === -2) {
          const pr = Math.min(1, palette.wallColor[0] * 1.38 * lum);
          const pg = Math.min(1, palette.wallColor[1] * 1.38 * lum);
          const pb = Math.min(1, palette.wallColor[2] * 1.38 * lum);
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.pillarMesh,
            c,
            r,
            zOff,
            1.0,
            1.0,
            1.0,
            pr,
            pg,
            pb,
            1.0
          );
          const pillarBobZ =
            !this.lastOptions.reducedMotion && !roomVis.isLocked
              ? Math.sin(timeSec * 2.8 + r * 0.9 + c * 1.1) * 0.024
              : 0;
          const pillarSpinZ =
            !this.lastOptions.reducedMotion && !roomVis.isLocked
              ? Math.PI * 0.25 + timeSec * 0.95
              : Math.PI * 0.25;
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.unitParticleCube,
            c + 0.5,
            r + 0.5,
            zOff + 0.652 + pillarBobZ,
            0.38,
            0.38,
            0.056,
            Math.min(1, pr * 0.85 + 0.22 * lum),
            Math.min(1, pg * 0.82 + 0.18 * lum),
            Math.min(1, pb * 0.78 + 0.12 * lum),
            1.0,
            0,
            pillarSpinZ,
            0
          );
          this.drawAtlasBadge(
            gl,
            'DIAMOND',
            c + 0.5,
            r + 0.5,
            zOff + 0.686 + pillarBobZ,
            0.36,
            0.98 * lum,
            0.86 * lum,
            0.58 * lum,
            0.95
          );
        }
      }
    }

    // 1C. Moving Elevator Platforms (`board.elevators`)
    for (const elev of board.elevators) {
      const elevRoomId = board.roomMap[elev.row * cols + elev.col] ?? 0;
      const elevVis = this.getRoomVisualState(board, elevRoomId);
      const zOff = elevVis.zOffset;
      const lum = elevVis.luminanceMul;
      const dir = elev.atAlternatePos ? -1 : 1;
      const targetR = elev.row + elev.deltaRow * dir;
      const targetC = elev.col + elev.deltaCol * dir;

      const minR = Math.min(elev.row, targetR);
      const minC = Math.min(elev.col, targetC);
      const spanR = Math.abs(targetR - elev.row) + elev.height;
      const spanC = Math.abs(targetC - elev.col) + elev.width;
      const isHorizTrack = Math.abs(elev.deltaCol) >= Math.abs(elev.deltaRow);
      if (isHorizTrack) {
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          minC + spanC * 0.5,
          minR + 0.22,
          zOff + 0.014,
          spanC - 0.24,
          0.08,
          0.028,
          0.36 * lum,
          0.66 * lum,
          0.86 * lum,
          0.88,
          0,
          0,
          0
        );
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          minC + spanC * 0.5,
          minR + spanR - 0.22,
          zOff + 0.014,
          spanC - 0.24,
          0.08,
          0.028,
          0.36 * lum,
          0.66 * lum,
          0.86 * lum,
          0.88,
          0,
          0,
          0
        );
      } else {
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          minC + 0.22,
          minR + spanR * 0.5,
          zOff + 0.014,
          0.08,
          spanR - 0.24,
          0.028,
          0.36 * lum,
          0.66 * lum,
          0.86 * lum,
          0.88,
          0,
          0,
          0
        );
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          minC + spanC - 0.22,
          minR + spanR * 0.5,
          zOff + 0.014,
          0.08,
          spanR - 0.24,
          0.028,
          0.36 * lum,
          0.66 * lum,
          0.86 * lum,
          0.88,
          0,
          0,
          0
        );
      }

      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.elevatorMesh,
        elev.col,
        elev.row,
        zOff,
        elev.width,
        elev.height,
        1.0,
        0.32 * lum,
        0.58 * lum,
        0.78 * lum,
        1.0
      );
      const chevronKey = isHorizTrack ? 'LOCK_H' : 'LOCK_V';
      const elevBadgeZ = this.drawBadgeMedallion3D(
        gl,
        elev.col + elev.width * 0.5,
        elev.row + elev.height * 0.5,
        zOff + 0.032,
        isHorizTrack ? 0.52 : 0.38,
        isHorizTrack ? 0.38 : 0.52,
        0.32 * lum,
        0.58 * lum,
        0.78 * lum
      );
      this.drawAtlasBadge(
        gl,
        chevronKey,
        elev.col + elev.width * 0.5,
        elev.row + elev.height * 0.5,
        elevBadgeZ,
        0.42,
        0.92 * lum,
        0.98 * lum,
        1.0 * lum,
        0.95
      );
    }

    // 1D. Wooden Crates (`board.crates`)
    for (const crate of board.crates) {
      if (crate.destroyed || crate.hp <= 0) continue;
      const crateRoomId = board.roomMap[crate.row * cols + crate.col] ?? 0;
      const crateVis = this.getRoomVisualState(board, crateRoomId);
      const zOff = crateVis.zOffset;
      const lum = crateVis.luminanceMul;
      const hpRatio = crate.hp / Math.max(1, crate.maxHp);
      const cr = (0.68 + 0.12 * hpRatio) * lum;
      const cg = (0.44 + 0.1 * hpRatio) * lum;
      const cb = (0.2 + 0.06 * hpRatio) * lum;
      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.crateMesh,
        crate.col,
        crate.row,
        zOff,
        1.0,
        1.0,
        1.0,
        cr,
        cg,
        cb,
        1.0,
        0,
        0,
        2
      );
      const crateBadgeZ = this.drawBadgeMedallion3D(
        gl,
        crate.col + 0.5,
        crate.row + 0.5,
        zOff + 0.585,
        0.46,
        0.42,
        cr,
        cg,
        cb
      );
      this.drawNumberBadges(
        gl,
        crate.hp,
        crate.col + 0.5,
        crate.row + 0.5,
        crateBadgeZ,
        0.38,
        1.0 * lum,
        0.96 * lum,
        0.84 * lum
      );
    }

    // 1E. Block Generators (`board.generators`)
    for (const gen of board.generators) {
      const genRoomId = board.roomMap[gen.row * cols + gen.col] ?? 0;
      const genVis = this.getRoomVisualState(board, genRoomId);
      const zOff = genVis.zOffset;
      const lum = genVis.luminanceMul;
      const depleted = gen.state === 'DEPLETED' || gen.queueCursor >= gen.queue.length;
      const gr = (depleted ? 0.25 : 0.35) * lum;
      const gg = (depleted ? 0.28 : 0.42) * lum;
      const gb = (depleted ? 0.32 : 0.55) * lum;
      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.generatorMesh,
        gen.col,
        gen.row,
        zOff,
        1.0,
        1.0,
        1.0,
        gr,
        gg,
        gb,
        1.0
      );

      if (!depleted) {
        const nextSpec = gen.queue[gen.queueCursor];
        if (nextSpec && nextSpec.colorStack.length > 0) {
          const nextColor = nextSpec.colorStack[0];
          const [rawNr, rawNg, rawNb] = this.getColorRgb(nextColor, highContrast);
          const nr = rawNr * lum;
          const ng = rawNg * lum;
          const nb = rawNb * lum;

          const genPulse =
            !this.lastOptions.reducedMotion && !genVis.isLocked
              ? 0.5 + 0.5 * Math.sin(timeSec * 3.8 + gen.col * 0.9)
              : 0.5;
          const spawnShape = getShape(nextSpec.shapeId);
          for (const [dr, dc] of spawnShape.cells) {
            const sc = gen.spawnCol + dc;
            const sr = gen.spawnRow + dr;
            if (sc >= 0 && sc < cols && sr >= 0 && sr < rows) {
              this.drawMesh(
                gl,
                ENVIRONMENT_MESHES.overlayQuad,
                sc + 0.06,
                sr + 0.06,
                zOff + 0.006,
                0.88,
                0.88,
                1.0,
                nr,
                ng,
                nb,
                0.24 + 0.22 * genPulse,
                0,
                0,
                4
              );
            }
          }

          const previewBobZ =
            !this.lastOptions.reducedMotion && !genVis.isLocked
              ? Math.sin(timeSec * 3.8 + gen.col) * 0.034
              : 0;
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.unitParticleCube,
            gen.col + 0.5,
            gen.row + 0.34,
            zOff + 0.735 + previewBobZ,
            0.62,
            0.36,
            0.065,
            nr,
            ng,
            nb,
            1.0,
            0,
            0,
            0
          );
          if (colorblind) {
            this.drawAtlasBadge(
              gl,
              `CB_${nextColor}`,
              gen.col + 0.5,
              gen.row + 0.34,
              zOff + 0.774 + previewBobZ,
              0.24,
              lum,
              lum,
              lum,
              0.96
            );
          }
        }
        const genBadgeZ = this.drawBadgeMedallion3D(
          gl,
          gen.col + 0.5,
          gen.row + 0.68,
          zOff + 0.705,
          0.68,
          0.32,
          gr,
          gg,
          gb
        );
        this.drawAtlasBadge(
          gl,
          'BADGE_GENERATOR',
          gen.col + 0.34,
          gen.row + 0.68,
          genBadgeZ,
          0.3,
          1.0 * lum,
          0.92 * lum,
          0.25 * lum,
          1.0
        );
        this.drawNumberBadges(
          gl,
          gen.cooldown,
          gen.col + 0.66,
          gen.row + 0.68,
          genBadgeZ + 0.002,
          0.3,
          lum,
          lum,
          lum
        );
      }
    }

    // 1F. Contoured Perimeter Parapet Walls, Corner Posts & Stepped-Edge Exit Gates (`COURTYARD-01`, `GATE-STEP-01`)
    const wallThick = 0.42;
    const [wr, wg, wb] = palette.wallColor;
    const [rhr, rhg, rhb] = palette.rimHighlight;

    const isUnitEdgeCoveredByGate = (
      edge: GateState['edge'],
      edgeLine: number,
      spanCell: number
    ): boolean => {
      for (const gate of board.gates) {
        if (
          gate.edge === edge &&
          gate.edgeLine === edgeLine &&
          spanCell >= gate.spanStart &&
          spanCell < gate.spanStart + gate.spanLength
        ) {
          return true;
        }
      }
      return false;
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isCellPlayable(r, c)) continue;

        const roomId = board.roomMap[r * cols + c] ?? 0;
        const roomVis = this.getRoomVisualState(board, roomId);
        const zOff = roomVis.zOffset;
        const lum = roomVis.luminanceMul;
        const cwr = wr * lum;
        const cwg = wg * lum;
        const cwb = wb * lum;
        const crhr = rhr * lum;
        const crhg = rhg * lum;
        const crhb = rhb * lum;

        const topOpen = !isCellPlayable(r - 1, c);
        const botOpen = !isCellPlayable(r + 1, c);
        const leftOpen = !isCellPlayable(r, c - 1);
        const rightOpen = !isCellPlayable(r, c + 1);

        const gateThick = wallThick - 0.03;
        if (topOpen && !isUnitEdgeCoveredByGate('TOP', r, c)) {
          const trimLeft =
            isCellPlayable(r - 1, c - 1) && isUnitEdgeCoveredByGate('RIGHT', c - 1, r - 1)
              ? gateThick
              : 0;
          const trimRight =
            isCellPlayable(r - 1, c + 1) && isUnitEdgeCoveredByGate('LEFT', c + 1, r - 1)
              ? gateThick
              : 0;
          const segW = 1 - trimLeft - trimRight;
          if (segW > 0.02) {
            this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c + trimLeft, r - wallThick, zOff, segW, wallThick, 1, cwr, cwg, cwb);
            this.drawMesh(gl, ENVIRONMENT_MESHES.overlayQuad, c + trimLeft, r - 0.09, zOff + 0.682, segW, 0.08, 1, crhr, crhg, crhb, 0.9);
          }
        }
        if (botOpen && !isUnitEdgeCoveredByGate('BOTTOM', r, c)) {
          const trimLeft =
            isCellPlayable(r + 1, c - 1) && isUnitEdgeCoveredByGate('RIGHT', c - 1, r + 1)
              ? gateThick
              : 0;
          const trimRight =
            isCellPlayable(r + 1, c + 1) && isUnitEdgeCoveredByGate('LEFT', c + 1, r + 1)
              ? gateThick
              : 0;
          const segW = 1 - trimLeft - trimRight;
          if (segW > 0.02) {
            this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c + trimLeft, r + 1, zOff, segW, wallThick, 1, cwr, cwg, cwb);
            this.drawMesh(gl, ENVIRONMENT_MESHES.overlayQuad, c + trimLeft, r + 1.01, zOff + 0.682, segW, 0.08, 1, crhr, crhg, crhb, 0.9);
          }
        }
        if (leftOpen && !isUnitEdgeCoveredByGate('LEFT', c, r)) {
          const trimTop = isCellPlayable(r - 1, c - 1)
            ? isUnitEdgeCoveredByGate('BOTTOM', r - 1, c - 1)
              ? gateThick
              : wallThick
            : 0;
          const trimBot = isCellPlayable(r + 1, c - 1)
            ? isUnitEdgeCoveredByGate('TOP', r + 1, c - 1)
              ? gateThick
              : wallThick
            : 0;
          const segH = 1 - trimTop - trimBot;
          if (segH > 0.02) {
            this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c - wallThick, r + trimTop, zOff, wallThick, segH, 1, cwr, cwg, cwb);
            this.drawMesh(gl, ENVIRONMENT_MESHES.overlayQuad, c - 0.09, r + trimTop, zOff + 0.682, 0.08, segH, 1, crhr, crhg, crhb, 0.9);
          }
        }
        if (rightOpen && !isUnitEdgeCoveredByGate('RIGHT', c, r)) {
          const trimTop = isCellPlayable(r - 1, c + 1)
            ? isUnitEdgeCoveredByGate('BOTTOM', r - 1, c + 1)
              ? gateThick
              : wallThick
            : 0;
          const trimBot = isCellPlayable(r + 1, c + 1)
            ? isUnitEdgeCoveredByGate('TOP', r + 1, c + 1)
              ? gateThick
              : wallThick
            : 0;
          const segH = 1 - trimTop - trimBot;
          if (segH > 0.02) {
            this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c + 1, r + trimTop, zOff, wallThick, segH, 1, cwr, cwg, cwb);
            this.drawMesh(gl, ENVIRONMENT_MESHES.overlayQuad, c + 1.01, r + trimTop, zOff + 0.682, 0.08, segH, 1, crhr, crhg, crhb, 0.9);
          }
        }

        // Convex outer corner posts
        if (topOpen && leftOpen) {
          this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c - wallThick, r - wallThick, zOff, wallThick, wallThick, 1, cwr, cwg, cwb);
        }
        if (topOpen && rightOpen) {
          this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c + 1, r - wallThick, zOff, wallThick, wallThick, 1, cwr, cwg, cwb);
        }
        if (botOpen && leftOpen) {
          this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c - wallThick, r + 1, zOff, wallThick, wallThick, 1, cwr, cwg, cwb);
        }
        if (botOpen && rightOpen) {
          this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c + 1, r + 1, zOff, wallThick, wallThick, 1, cwr, cwg, cwb);
        }

        // Concave inner elbow posts when stepped-edge gates abut an inward corner
        if (
          !topOpen &&
          !leftOpen &&
          !isCellPlayable(r - 1, c - 1) &&
          isUnitEdgeCoveredByGate('LEFT', c, r - 1) &&
          isUnitEdgeCoveredByGate('TOP', r, c - 1)
        ) {
          this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c - wallThick, r - wallThick, zOff, wallThick, wallThick, 1, cwr, cwg, cwb);
        }
        if (
          !topOpen &&
          !rightOpen &&
          !isCellPlayable(r - 1, c + 1) &&
          isUnitEdgeCoveredByGate('RIGHT', c, r - 1) &&
          isUnitEdgeCoveredByGate('TOP', r, c + 1)
        ) {
          this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c + 1, r - wallThick, zOff, wallThick, wallThick, 1, cwr, cwg, cwb);
        }
        if (
          !botOpen &&
          !leftOpen &&
          !isCellPlayable(r + 1, c - 1) &&
          isUnitEdgeCoveredByGate('LEFT', c, r + 1) &&
          isUnitEdgeCoveredByGate('BOTTOM', r, c - 1)
        ) {
          this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c - wallThick, r + 1, zOff, wallThick, wallThick, 1, cwr, cwg, cwb);
        }
        if (
          !botOpen &&
          !rightOpen &&
          !isCellPlayable(r + 1, c + 1) &&
          isUnitEdgeCoveredByGate('RIGHT', c, r + 1) &&
          isUnitEdgeCoveredByGate('BOTTOM', r, c + 1)
        ) {
          this.drawMesh(gl, ENVIRONMENT_MESHES.wallSegment, c + 1, r + 1, zOff, wallThick, wallThick, 1, cwr, cwg, cwb);
        }
      }
    }

    // Render each Exit Gate housing, spinning shredder roller, queue pips, and badges (`GATE-STEP-01`)
    for (const gate of board.gates) {
      const activeColor = getGateActiveColor(gate);
      const [rawGr, rawGg, rawGb] = this.getColorRgb(activeColor, highContrast);
      const isHorizEdge = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
      const spanAxisX = isHorizEdge ? 1 : 0;
      const spanAxisY = isHorizEdge ? 0 : 1;

      const adjR = isHorizEdge ? gate.edgeLine : gate.spanStart;
      const adjC = isHorizEdge ? gate.spanStart : gate.edgeLine;
      const gateRoomId =
        adjR >= 0 && adjR < rows && adjC >= 0 && adjC < cols
          ? (board.roomMap[adjR * cols + adjC] ?? 0)
          : 0;
      const gateVis = this.getRoomVisualState(board, gateRoomId);
      const zOff = gateVis.zOffset;
      const lum = gateVis.luminanceMul;
      const gr = rawGr * lum;
      const gg = rawGg * lum;
      const gb = rawGb * lum;

      let gx = 0;
      let gy = 0;
      let gw = 1;
      let gh = 1;
      let rollerX = 0;
      let rollerY = 0;
      const rollerLen = gate.spanLength;
      let rollerRotZ = 0;

      if (gate.edge === 'TOP') {
        gx = gate.spanStart;
        gy = gate.edgeLine - wallThick;
        gw = gate.spanLength;
        gh = wallThick;
        rollerX = gate.spanStart + gate.spanLength * 0.5;
        rollerY = gate.edgeLine - wallThick * 0.5;
        rollerRotZ = 0;
      } else if (gate.edge === 'BOTTOM') {
        gx = gate.spanStart;
        gy = gate.edgeLine + 1;
        gw = gate.spanLength;
        gh = wallThick;
        rollerX = gate.spanStart + gate.spanLength * 0.5;
        rollerY = gate.edgeLine + 1 + wallThick * 0.5;
        rollerRotZ = 0;
      } else if (gate.edge === 'LEFT') {
        gx = gate.edgeLine - wallThick;
        gy = gate.spanStart;
        gw = wallThick;
        gh = gate.spanLength;
        rollerX = gate.edgeLine - wallThick * 0.5;
        rollerY = gate.spanStart + gate.spanLength * 0.5;
        rollerRotZ = Math.PI * 0.5;
      } else {
        gx = gate.edgeLine + 1;
        gy = gate.spanStart;
        gw = wallThick;
        gh = gate.spanLength;
        rollerX = gate.edgeLine + 1 + wallThick * 0.5;
        rollerY = gate.spanStart + gate.spanLength * 0.5;
        rollerRotZ = Math.PI * 0.5;
      }

      // Sliding / Size-Changing Gate Rail Track (`R3D-08`)
      if (gate.slidesOnClear || gate.sizeChangesOnClear) {
        const railMin = gate.slidesOnClear ? gate.slideMin : gate.spanStart;
        const railSpan = gate.slidesOnClear
          ? Math.max(gate.spanLength, gate.slideMax - gate.slideMin + gate.spanLength)
          : Math.max(gate.spanLength, gate.maxLength);
        const rx = isHorizEdge ? railMin : gx + gw * 0.35;
        const ry = isHorizEdge ? gy + gh * 0.35 : railMin;
        const rw = isHorizEdge ? railSpan : gw * 0.3;
        const rh = isHorizEdge ? gh * 0.3 : railSpan;
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.gateHousing,
          rx,
          ry,
          zOff,
          rw,
          rh,
          0.18,
          rhr * 0.9 * lum,
          rhg * 0.9 * lum,
          rhb * 0.9 * lum,
          0.95
        );
        this.drawAtlasBadge(
          gl,
          isHorizEdge ? 'LOCK_H' : 'LOCK_V',
          rollerX + spanAxisX * (gate.spanLength * 0.5 - 0.16),
          rollerY + spanAxisY * (gate.spanLength * 0.5 - 0.16),
          zOff + 0.72,
          0.24,
          0.9 * lum,
          0.96 * lum,
          1.0 * lum,
          0.95
        );
      }

      // Gate colored base sill
      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.gateHousing,
        gx,
        gy,
        zOff,
        gw,
        gh,
        0.42,
        gr,
        gg,
        gb,
        1.0
      );

      // Spinning 3D Shredder Roller cylinder + Breathing Threshold Floor Aura (`IDLE-03`)
      const gateReady =
        gate.shutterOpen &&
        gate.shutterLockColor === 0 &&
        gate.iceCount <= 0 &&
        !gateVis.isLocked;
      const isGateActivelyShredding = this.activeVisualShreds.some(
        (a) => a.gateIndex === gate.index
      );
      const isGateDragTargeted = this.lastOptions.dragEligibleGateIndex === gate.index;
      const gatePulse = !this.lastOptions.reducedMotion
        ? 0.5 + 0.5 * Math.sin(timeSec * 2.2 + gate.index * 1.4)
        : 0.5;
      const rollerGlint = !this.lastOptions.reducedMotion && gateReady
        ? 0.08 * gatePulse
        : 0;
      const rollerSpeed =
        !gateReady || this.lastOptions.reducedMotion
          ? 0.0
          : (isGateActivelyShredding || isGateDragTargeted ? 6.4 : 1.35) * live3DMix;
      const rollerSpin = gate.rollerPhase + timeSec * rollerSpeed;
      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.rollerMesh,
        rollerX,
        rollerY,
        zOff + 0.34,
        rollerLen * 0.92,
        0.135,
        0.135,
        Math.min(1, (rawGr * 0.85 + 0.18 + rollerGlint) * lum),
        Math.min(1, (rawGg * 0.85 + 0.18 + rollerGlint) * lum),
        Math.min(1, (rawGb * 0.85 + 0.18 + rollerGlint * 0.8) * lum),
        1.0,
        rollerSpin,
        rollerRotZ
      );

      // Breathing Threshold Intake Floor Glow on ready gates (`IDLE-03`)
      if (gateReady && live3DMix > 0.05) {
        const auraDepth = 0.38 + 0.07 * gatePulse * live3DMix;
        let auraX = 0;
        let auraY = 0;
        let auraW = 1;
        let auraH = 1;
        if (gate.edge === 'TOP') {
          auraX = gate.spanStart + 0.04;
          auraY = gate.edgeLine + 0.01;
          auraW = gate.spanLength - 0.08;
          auraH = auraDepth;
        } else if (gate.edge === 'BOTTOM') {
          auraX = gate.spanStart + 0.04;
          auraY = gate.edgeLine + 1 - auraDepth - 0.01;
          auraW = gate.spanLength - 0.08;
          auraH = auraDepth;
        } else if (gate.edge === 'LEFT') {
          auraX = gate.edgeLine + 0.01;
          auraY = gate.spanStart + 0.04;
          auraW = auraDepth;
          auraH = gate.spanLength - 0.08;
        } else {
          auraX = gate.edgeLine + 1 - auraDepth - 0.01;
          auraY = gate.spanStart + 0.04;
          auraW = auraDepth;
          auraH = gate.spanLength - 0.08;
        }
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.overlayQuad,
          auraX,
          auraY,
          zOff + 0.007,
          Math.max(0.2, auraW),
          Math.max(0.2, auraH),
          1.0,
          Math.min(1, gr * 0.8 + 0.2 * lum),
          Math.min(1, gg * 0.8 + 0.2 * lum),
          Math.min(1, gb * 0.8 + 0.2 * lum),
          (0.1 + 0.1 * gatePulse) * live3DMix,
          0,
          0,
          4
        );
      }

      // Toggling Shutter Side-Posts & Status Bar (`R3D-08`)
      if (gate.togglesOnClear) {
        const indR = (gate.shutterOpen ? 0.14 : 0.92) * lum;
        const indG = (gate.shutterOpen ? 0.82 : 0.22) * lum;
        const indB = (gate.shutterOpen ? 0.38 : 0.28) * lum;
        const postW = isHorizEdge ? 0.1 : gw * 0.86;
        const postH = isHorizEdge ? gh * 0.86 : 0.1;
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.gateHousing,
          gx + (isHorizEdge ? 0.02 : gw * 0.07),
          gy + (isHorizEdge ? gh * 0.07 : 0.02),
          zOff + 0.26,
          postW,
          postH,
          0.52,
          indR,
          indG,
          indB,
          1.0
        );
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.gateHousing,
          gx + (isHorizEdge ? gw - 0.12 : gw * 0.07),
          gy + (isHorizEdge ? gh * 0.07 : gh - 0.12),
          zOff + 0.26,
          postW,
          postH,
          0.52,
          indR,
          indG,
          indB,
          1.0
        );
      }

      // Shutter Lock / Closed Shutter Bars
      if (!gate.shutterOpen || gate.shutterLockColor > 0) {
        const lockRgb =
          gate.shutterLockColor > 0
            ? this.getColorRgb(gate.shutterLockColor, highContrast)
            : ([0.65, 0.72, 0.8] as [number, number, number]);
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.gateHousing,
          gx + gw * 0.08,
          gy + gh * 0.08,
          zOff + 0.32,
          gw * 0.84,
          gh * 0.84,
          0.45,
          lockRgb[0] * 0.7 * lum,
          lockRgb[1] * 0.7 * lum,
          lockRgb[2] * 0.7 * lum,
          0.95
        );
        if (gate.shutterLockColor > 0) {
          this.drawAtlasBadge(
            gl,
            'BADGE_GEM',
            rollerX,
            rollerY,
            zOff + 0.72,
            0.32,
            lockRgb[0] * lum,
            lockRgb[1] * lum,
            lockRgb[2] * lum,
            1.0
          );
          if (colorblind) {
            this.drawAtlasBadge(
              gl,
              `CB_${gate.shutterLockColor}`,
              rollerX + spanAxisX * 0.2,
              rollerY + spanAxisY * 0.2,
              zOff + 0.725,
              0.22,
              lum,
              lum,
              lum,
              1
            );
          }
        }
      }

      // Frozen Gate Overlay (`R3D-04`, `R3D-11`)
      if (gate.iceCount > 0) {
        gl.depthMask(false);
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.gateHousing,
          gx - 0.008,
          gy - 0.008,
          zOff + 0.02,
          gw + 0.016,
          gh + 0.016,
          0.92,
          0.55 * lum,
          0.88 * lum,
          1.0 * lum,
          0.55,
          0,
          0,
          1
        );
        gl.depthMask(true);
        this.drawAtlasBadge(
          gl,
          'BADGE_ICE',
          rollerX - spanAxisX * 0.12,
          rollerY - spanAxisY * 0.12,
          zOff + 0.72,
          0.28,
          0.85 * lum,
          0.97 * lum,
          1.0 * lum,
          1.0
        );
        this.drawNumberBadges(
          gl,
          gate.iceCount,
          rollerX + spanAxisX * 0.12,
          rollerY + spanAxisY * 0.12,
          zOff + 0.725,
          0.3,
          lum,
          lum,
          lum
        );
      }

      // Star Gate Emblem (`R3D-04`: separated along span axis and elevated to z = 0.72)
      if (gate.isStar) {
        const starOffset = gate.iceCount > 0 || gate.shutterLockColor > 0 ? 0.28 : 0.0;
        this.drawAtlasBadge(
          gl,
          'BADGE_STAR',
          rollerX + spanAxisX * starOffset,
          rollerY + spanAxisY * starOffset,
          zOff + 0.72,
          0.32,
          1.0 * lum,
          0.9 * lum,
          0.25 * lum,
          1.0
        );
      }

      // Colorblind symbol on gate housing (`UX-10`, `R3D-04`: clear of center badges and outward queue pips)
      if (colorblind) {
        const hasCenterGateBadge =
          gate.iceCount > 0 || gate.shutterLockColor > 0 || gate.isStar;
        const symSpanOffset = hasCenterGateBadge
          ? -Math.max(0.34, Math.min(0.46, gate.spanLength * 0.5 - 0.22))
          : 0.0;
        const inwardX =
          gate.edge === 'LEFT' ? 0.06 : gate.edge === 'RIGHT' ? -0.06 : 0;
        const inwardY =
          gate.edge === 'TOP' ? 0.06 : gate.edge === 'BOTTOM' ? -0.06 : 0;
        this.drawAtlasBadge(
          gl,
          `CB_${activeColor}`,
          rollerX + spanAxisX * symSpanOffset + inwardX,
          rollerY + spanAxisY * symSpanOffset + inwardY,
          zOff + 0.755,
          0.28,
          lum,
          lum,
          lum,
          1.0
        );
      }

      // Queued Next-Color Bars (`gate.colorQueue.slice(gate.colorCursor + 1)`, `FR-21`, `R3D-04`)
      const remainingQueue = gate.colorQueue.length - (gate.colorCursor + 1);
      const visibleQueue = Math.min(3, remainingQueue);
      for (let q = 0; q < visibleQueue; q++) {
        const nextCol = gate.colorQueue[gate.colorCursor + 1 + q];
        const [qr, qg, qb] = this.getColorRgb(nextCol, highContrast);
        const pipOffset = (q - (visibleQueue - 1) * 0.5) * 0.62;
        const px = isHorizEdge
          ? rollerX + pipOffset
          : rollerX + (gate.edge === 'LEFT' ? -0.18 : 0.18);
        const py = !isHorizEdge
          ? rollerY + pipOffset
          : rollerY + (gate.edge === 'TOP' ? -0.18 : 0.18);
        const barW = isHorizEdge ? 0.5 : 0.16;
        const barH = !isHorizEdge ? 0.5 : 0.16;
        const pipBobZ =
          !this.lastOptions.reducedMotion && !gateVis.isLocked
            ? Math.sin(timeSec * 3.4 + q * 1.1 + gate.index * 0.8) * 0.025
            : 0;

        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          px,
          py,
          zOff + 0.62 + pipBobZ,
          barW + 0.08,
          barH + 0.08,
          0.11,
          0.08 * lum,
          0.11 * lum,
          0.18 * lum,
          1.0
        );
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          px,
          py,
          zOff + 0.65 + pipBobZ,
          barW,
          barH,
          0.12,
          qr * lum,
          qg * lum,
          qb * lum,
          1.0
        );
        if (colorblind) {
          this.drawAtlasBadge(
            gl,
            `CB_${nextCol}`,
            px,
            py,
            zOff + 0.72 + pipBobZ,
            0.15,
            lum,
            lum,
            lum,
            0.96
          );
        }
      }
    }

    // 1G. 3D Sanctuary Portcullis Barriers (`board.barriers`, `SANCTUM-01`, `SANCTUM-02`)
    for (const bar of board.barriers) {
      if (bar.cells.length === 0) continue;
      let minR = bar.cells[0][0];
      let maxR = bar.cells[0][0];
      let minC = bar.cells[0][1];
      let maxC = bar.cells[0][1];
      for (const [r, c] of bar.cells) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
      const isHoriz = bar.orientation === 'H';
      const spanW = maxC - minC + 1;
      const spanH = maxR - minR + 1;
      const barLen = Math.max(spanW, spanH);
      const bcx = minC + spanW * 0.5;
      const bcy = minR + spanH * 0.5;

      // Flush inlaid brass & obsidian threshold track across the barrier cells (visible both open and closed)
      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        bcx,
        bcy,
        0.008,
        spanW - 0.08,
        spanH - 0.08,
        0.016,
        0.58,
        0.46,
        0.24,
        0.92
      );
      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        bcx,
        bcy,
        0.012,
        isHoriz ? spanW - 0.14 : 0.24,
        isHoriz ? 0.24 : spanH - 0.14,
        0.02,
        0.22,
        0.18,
        0.14,
        0.96
      );

      if (bar.open) {
        // Retracted threshold side-bollards at the two outer ends of the opened doorway
        const endOffset = (barLen - 0.22) * 0.5;
        for (const sign of [-1, 1]) {
          const px = isHoriz ? bcx + sign * endOffset : bcx;
          const py = isHoriz ? bcy : bcy + sign * endOffset;
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.unitParticleCube,
            px,
            py,
            0.03,
            0.18,
            0.18,
            0.06,
            0.84,
            0.68,
            0.34,
            0.95
          );
        }
        continue;
      }

      // Closed 3D Sanctuary Portcullis Archway & Golden Slotted Lattice
      const portPulse = !this.lastOptions.reducedMotion
        ? 0.5 + 0.5 * Math.sin(timeSec * 3.2 + bar.id * 1.3)
        : 0.5;

      // Subtle golden threshold floor aura beneath the closed portcullis
      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.overlayQuad,
        minC + 0.06,
        minR + 0.06,
        0.018,
        spanW - 0.12,
        spanH - 0.12,
        1.0,
        0.98,
        0.8,
        0.32,
        0.18 + 0.1 * portPulse,
        0,
        0,
        4
      );

      // Twin sculpted stone-and-brass jamb pillars at the two ends of the portcullis span
      const pillarOffset = Math.max(0.32, barLen * 0.5 - 0.16);
      const jambR = Math.min(1, palette.wallColor[0] * 0.65 + 0.16);
      const jambG = Math.min(1, palette.wallColor[1] * 0.65 + 0.14);
      const jambB = Math.min(1, palette.wallColor[2] * 0.65 + 0.18);
      for (const sign of [-1, 1]) {
        const px = isHoriz ? bcx + sign * pillarOffset : bcx;
        const py = isHoriz ? bcy : bcy + sign * pillarOffset;
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          px,
          py,
          0.32,
          isHoriz ? 0.26 : 0.62,
          isHoriz ? 0.62 : 0.26,
          0.64,
          jambR,
          jambG,
          jambB,
          1.0
        );
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          px,
          py,
          0.65,
          isHoriz ? 0.3 : 0.66,
          isHoriz ? 0.66 : 0.3,
          0.06,
          0.92,
          0.76,
          0.38,
          1.0
        );
      }

      // Upper sculpted bronze-gold lintel beam + lower sill beam
      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        bcx,
        bcy,
        0.54,
        isHoriz ? spanW - 0.12 : 0.42,
        isHoriz ? 0.42 : spanH - 0.12,
        0.14,
        0.88 + 0.08 * portPulse,
        0.72 + 0.08 * portPulse,
        0.34,
        1.0
      );
      this.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        bcx,
        bcy,
        0.08,
        isHoriz ? spanW - 0.16 : 0.36,
        isHoriz ? 0.36 : spanH - 0.16,
        0.12,
        0.72,
        0.58,
        0.28,
        1.0
      );

      // Vertical 3D golden portcullis spears along the span
      const barCount = Math.max(3, barLen * 2 + 1);
      for (let bi = 0; bi < barCount; bi++) {
        const frac = (bi + 0.5) / barCount - 0.5;
        const bx = isHoriz ? bcx + frac * (barLen - 0.32) : bcx;
        const by = isHoriz ? bcy : bcy + frac * (barLen - 0.32);
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          bx,
          by,
          0.31,
          0.09,
          0.09,
          0.42,
          0.95,
          0.82,
          0.42,
          1.0
        );
      }

      // Central 3D Sculpted Portcullis Medallion (`BADGE_PORTCULLIS` + `shredsRemaining` or `BADGE_KEY`)
      const isKeyOnly = Boolean(bar.lockId && bar.lockId > 0 && bar.shredsRemaining <= 0);
      const medBobZ = !this.lastOptions.reducedMotion
        ? Math.sin(timeSec * 2.6 + bar.id) * 0.015 * live3DMix
        : 0;
      const medZ = this.drawBadgeMedallion3D(
        gl,
        bcx,
        bcy,
        0.615 + medBobZ,
        isKeyOnly ? 0.54 : 0.78,
        0.48,
        0.32,
        0.24,
        0.14,
        0.96,
        0.82,
        0.42
      );
      if (isKeyOnly) {
        this.drawAtlasBadge(
          gl,
          'BADGE_KEY',
          bcx,
          bcy,
          medZ,
          0.44,
          1.0,
          0.9,
          0.35,
          1.0
        );
      } else {
        const twoDigit = bar.shredsRemaining >= 10;
        this.drawAtlasBadge(
          gl,
          'BADGE_PORTCULLIS',
          bcx - (twoDigit ? 0.21 : 0.16),
          bcy,
          medZ,
          twoDigit ? 0.34 : 0.38,
          1.0,
          0.9,
          0.38,
          1.0
        );
        this.drawNumberBadges(
          gl,
          bar.shredsRemaining,
          bcx + (twoDigit ? 0.16 : 0.15),
          bcy,
          medZ + 0.002,
          twoDigit ? 0.32 : 0.36,
          1.0,
          0.97,
          0.52
        );
      }
    }
  }

  private renderPass2ReticleAndPrompts(
    gl: WebGL2RenderingContext,
    board: BoardState,
    options: RenderSceneOptions,
    highContrast: boolean,
    pulse: number
  ): void {
    // 2A. Active Drag Floor Target Reticle & Gate Alignment Beam (`UX-01`)
    let draggedId = options.draggedBlockId ?? null;
    if (draggedId === null) {
      const lifted = board.blocks.find((b) => b.status === 'ACTIVE' && b.liftAlpha > 0.1);
      if (lifted) draggedId = lifted.id;
    }

    if (draggedId !== null) {
      const group = getMovedGroupBlocks(board, draggedId);
      const lead = group.find((b) => b.id === draggedId) ?? group[0];
      if (lead) {
        let dRow =
          options.dragTargetRow !== undefined && options.dragTargetRow !== null
            ? options.dragTargetRow - lead.row
            : Math.round(lead.y - lead.row);
        let dCol =
          options.dragTargetCol !== undefined && options.dragTargetCol !== null
            ? options.dragTargetCol - lead.col
            : Math.round(lead.x - lead.col);

        if (!canGroupOccupyOffset(board, group, dRow, dCol)) {
          dRow = 0;
          dCol = 0;
        }

        for (const b of group) {
          const shape = getShape(b.shapeId);
          const activeColor: ColorId = getActiveColor(b.colorStack, b.colorCursor);
          const [cr, cg, cb] = this.getColorRgb(activeColor, highContrast);
          const snapRow = b.row + dRow;
          const snapCol = b.col + dCol;

          for (const [dr, dc] of shape.cells) {
            this.drawMesh(
              gl,
              ENVIRONMENT_MESHES.overlayQuad,
              snapCol + dc + 0.05,
              snapRow + dr + 0.05,
              0.012,
              0.9,
              0.9,
              1.0,
              cr,
              cg,
              cb,
              0.28 + 0.16 * pulse,
              0,
              0,
              4
            );
          }

          // Gate Alignment Beam projecting to any eligible gate at the snapped landing footprint
          const eligibleGateIdx =
            options.dragEligibleGateIndex !== undefined && options.dragEligibleGateIndex !== null
              ? options.dragEligibleGateIndex
              : findEligibleGateForBlockAt(board, b, snapRow, snapCol);

          if (eligibleGateIdx >= 0 && board.gates[eligibleGateIdx]) {
            const gate = board.gates[eligibleGateIdx];
            const [nx, ny] = getGateOutwardNormal(gate.edge);
            const beamCx = snapCol + shape.cols * 0.5 + nx * 0.35;
            const beamCy = snapRow + shape.rows * 0.5 + ny * 0.35;
            const beamW = gate.edge === 'TOP' || gate.edge === 'BOTTOM' ? shape.cols * 0.75 : 0.65;
            const beamH = gate.edge === 'LEFT' || gate.edge === 'RIGHT' ? shape.rows * 0.75 : 0.65;

            this.drawMesh(
              gl,
              ENVIRONMENT_MESHES.overlayQuad,
              beamCx - beamW * 0.5,
              beamCy - beamH * 0.5,
              0.02,
              beamW,
              beamH,
              1.0,
              Math.min(1, cr + 0.25),
              Math.min(1, cg + 0.25),
              Math.min(1, cb + 0.25),
              0.55 + 0.25 * pulse,
              0,
              0,
              4
            );
          }
        }
      }
    }

    // 2B. Booster Targeting Highlights (`TARGET_HAMMER`, `TARGET_ROCKET`, `TARGET_VACUUM`)
    const inputMode = options.inputMode ?? 'DRAG';
    if (inputMode === 'TARGET_ROCKET') {
      const axis = options.rocketAxis ?? 'ROW';
      const hRow = options.hoverRow ?? Math.floor(board.rows * 0.5);
      const hCol = options.hoverCol ?? Math.floor(board.cols * 0.5);
      if (axis === 'ROW' && hRow >= 0 && hRow < board.rows) {
        for (let c = 0; c < board.cols; c++) {
          if (board.occupancy[hRow * board.cols + c] === -1) continue;
          const roomVis = this.getRoomVisualState(board, board.roomMap[hRow * board.cols + c] ?? 0);
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.overlayQuad,
            c + 0.02,
            hRow + 0.1,
            roomVis.zOffset + 0.025,
            0.96,
            0.8,
            1.0,
            1.0,
            0.35,
            0.2,
            (0.42 + 0.22 * pulse) * roomVis.luminanceMul,
            0,
            0,
            4
          );
        }
      } else if (axis === 'COL' && hCol >= 0 && hCol < board.cols) {
        for (let r = 0; r < board.rows; r++) {
          if (board.occupancy[r * board.cols + hCol] === -1) continue;
          const roomVis = this.getRoomVisualState(board, board.roomMap[r * board.cols + hCol] ?? 0);
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.overlayQuad,
            hCol + 0.1,
            r + 0.02,
            roomVis.zOffset + 0.025,
            0.8,
            0.96,
            1.0,
            1.0,
            0.35,
            0.2,
            (0.42 + 0.22 * pulse) * roomVis.luminanceMul,
            0,
            0,
            4
          );
        }
      }
    } else if (inputMode === 'TARGET_HAMMER' || inputMode === 'TARGET_VACUUM') {
      for (const b of board.blocks) {
        if (b.status !== 'ACTIVE') continue;
        if (isBlockInLockedRoom(board, b)) continue;
        const cId: ColorId = getActiveColor(b.colorStack, b.colorCursor);
        if (cId === 0 && inputMode === 'TARGET_VACUUM') continue;
        if (
          inputMode === 'TARGET_VACUUM' &&
          (b.chained || b.ropeColor > 0 || b.iceCount > 0)
        ) {
          continue;
        }
        const shape = getShape(b.shapeId);
        for (const [dr, dc] of shape.cells) {
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.overlayQuad,
            b.col + dc + 0.04,
            b.row + dr + 0.04,
            0.02,
            0.92,
            0.92,
            1.0,
            1.0,
            0.85,
            0.25,
            0.25 + 0.2 * pulse,
            0,
            0,
            4
          );
        }
      }

      if (inputMode === 'TARGET_HAMMER') {
        if (board.barriers) {
          for (const bar of board.barriers) {
            if (bar.open) continue;
            for (const [br, bc] of bar.cells) {
              this.drawMesh(
                gl,
                ENVIRONMENT_MESHES.overlayQuad,
                bc + 0.04,
                br + 0.04,
                0.025,
                0.92,
                0.92,
                1.0,
                1.0,
                0.85,
                0.25,
                0.28 + 0.22 * pulse,
                0,
                0,
                4
              );
            }
          }
        }
        for (const crate of board.crates) {
          if (crate.destroyed) continue;
          if (!isRoomUnlocked(board, board.roomMap[crate.row * board.cols + crate.col] ?? 0)) continue;
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.overlayQuad,
            crate.col + 0.04,
            crate.row + 0.04,
            0.02,
            0.92,
            0.92,
            1.0,
            1.0,
            0.85,
            0.25,
            0.25 + 0.2 * pulse,
            0,
            0,
            4
          );
        }
      }
    }

    // 2C. ZEN Mode Hint & Early-Stage Auto-Guide Trail (`board.hintMove` / `options.autoGuideMove`)
    const guideMove = board.hintMove ?? (draggedId === null ? options.autoGuideMove : null) ?? null;
    if (guideMove) {
      const hintBlock = board.blocks.find(
        (b) => b.id === guideMove.blockId && b.status === 'ACTIVE'
      );
      if (hintBlock) {
        const shape = getShape(hintBlock.shapeId);
        const { targetRow, targetCol } = guideMove;
        const hintColor: ColorId = getActiveColor(hintBlock.colorStack, hintBlock.colorCursor);
        const [hr, hg, hb] = this.getColorRgb(hintColor, highContrast);
        const frameR = Math.min(1, hr * 0.72 + 0.28);
        const frameG = Math.min(1, hg * 0.72 + 0.28);
        const frameB = Math.min(1, hb * 0.72 + 0.28);
        const frameAlpha = 0.62 + 0.26 * pulse;

        // Render hollow 3D beveled perimeter frame around target footprint (tinted in block's own color, never a solid yellow fill)
        const minC = targetCol + 0.05;
        const maxC = targetCol + shape.cols - 0.05;
        const minR = targetRow + 0.05;
        const maxR = targetRow + shape.rows - 0.05;
        const spanW = Math.max(0.2, maxC - minC);
        const spanH = Math.max(0.2, maxR - minR);
        const barThick = 0.075;
        const barZ = 0.022;
        // Top & bottom frame bars
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          minC + spanW * 0.5,
          minR + barThick * 0.5,
          barZ,
          spanW,
          barThick,
          0.028,
          frameR,
          frameG,
          frameB,
          frameAlpha,
          0,
          0,
          0
        );
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          minC + spanW * 0.5,
          maxR - barThick * 0.5,
          barZ,
          spanW,
          barThick,
          0.028,
          frameR,
          frameG,
          frameB,
          frameAlpha,
          0,
          0,
          0
        );
        // Left & right frame bars
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          minC + barThick * 0.5,
          minR + spanH * 0.5,
          barZ,
          barThick,
          spanH,
          0.028,
          frameR,
          frameG,
          frameB,
          frameAlpha,
          0,
          0,
          0
        );
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          maxC - barThick * 0.5,
          minR + spanH * 0.5,
          barZ,
          barThick,
          spanH,
          0.028,
          frameR,
          frameG,
          frameB,
          frameAlpha,
          0,
          0,
          0
        );

        // Animated stepping directional chevrons from source centroid to target centroid
        const startCx = hintBlock.col + shape.cols * 0.5;
        const startCy = hintBlock.row + shape.rows * 0.5;
        const endCx = targetCol + shape.cols * 0.5;
        const endCy = targetRow + shape.rows * 0.5;
        const dx = endCx - startCx;
        const dy = endCy - startCy;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.25) {
          const chevronKey = Math.abs(dx) >= Math.abs(dy) ? 'LOCK_H' : 'LOCK_V';
          const steps = 3;
          const timeSec = options.timeSec ?? (performance.now() - this.startTimeMs) * 0.001;
          for (let s = 0; s < steps; s++) {
            const rawT = options.reducedMotion
              ? (s + 1) / (steps + 1)
              : ((s / steps + timeSec * 0.75) % 1.0);
            const px = startCx + dx * rawT;
            const py = startCy + dy * rawT;
            const alpha = Math.sin(rawT * Math.PI) * 0.78;
            this.drawAtlasBadge(gl, chevronKey, px, py, 0.028, 0.36, frameR, frameG, frameB, alpha);
          }
        }
      }
    }

    // 2D. Expanding 3D Knock-On & Shredding Shockwave Rings (`this.activeShockwaves`, `R3D-08`)
    if (this.activeShockwaves.length > 0) {
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      for (const sw of this.activeShockwaves) {
        const progress = Math.min(1, sw.age / sw.maxAge);
        const eased = 1 - (1 - progress) * (1 - progress);
        const radius = sw.minRadius + (sw.maxRadius - sw.minRadius) * eased;
        const alpha = (1 - progress) * 0.88;
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.shockwaveRingMesh,
          sw.cx,
          sw.cy,
          sw.z,
          radius * 2,
          radius * 2,
          1.0,
          sw.r,
          sw.g,
          sw.b,
          alpha,
          0,
          0,
          4
        );
      }
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
    }
  }

  private renderPass3Blocks(
    gl: WebGL2RenderingContext,
    board: BoardState,
    options: RenderSceneOptions,
    skinId: SkinId,
    highContrast: boolean,
    colorblind: boolean,
    pulse: number,
    timeSec: number,
    dtSec = 1 / 60
  ): void {
    const matStyle = this.getMaterialStyleCode(skinId);
    const dtMs = dtSec * 1000;
    const reducedMotion = Boolean(options.reducedMotion);
    const live3DMix = Math.max(0, 1.0 - (options.blueprintMix ?? 0) * 0.92);

    // Identify all blocks in the currently grabbed/dragged group (`F-03`)
    const draggedGroupIds = new Set<number>();
    const liftedBlock = board.blocks.find((b) => b.status === 'ACTIVE' && b.liftAlpha > 0.05);
    const leadDraggedId = liftedBlock ? liftedBlock.id : null;
    if (leadDraggedId !== null) {
      for (const gb of getMovedGroupBlocks(board, leadDraggedId)) {
        draggedGroupIds.add(gb.id);
      }
    }
    const anyDragActive = draggedGroupIds.size > 0;

    // 3.0 Visual Shred Clip-Plane Animation Queue (`R3D-01`, `R3D-02`, `R3D-14`)
    for (let i = this.activeVisualShreds.length - 1; i >= 0; i--) {
      const anim = this.activeVisualShreds[i];
      anim.progress += dtSec / 0.22;
      const gate = board.gates[anim.gateIndex];
      if (anim.progress >= 1 || !gate) {
        this.activeVisualShreds.splice(i, 1);
        continue;
      }

      gate.rollerPhase += dtSec * 14.0;
      const shape = getShape(anim.shapeId);
      const meshPair = getPolyominoMeshPair(anim.shapeId, skinId);
      const [r, g, b] = this.getColorRgb(anim.colorId, highContrast);
      const [nx, ny] = getGateOutwardNormal(gate.edge);
      const span = nx !== 0 ? shape.cols : shape.rows;
      const feedDist = anim.progress * (span + 0.45);
      const sx = anim.x + nx * feedDist;
      const sy = anim.y + ny * feedDist;

      const planeNx = -nx;
      const planeNy = -ny;
      let planeD = 0.21;
      if (gate.edge === 'TOP') planeD = 0.21 - gate.edgeLine;
      else if (gate.edge === 'BOTTOM') planeD = gate.edgeLine + 1 + 0.21;
      else if (gate.edge === 'LEFT') planeD = 0.21 - gate.edgeLine;
      else if (gate.edge === 'RIGHT') planeD = gate.edgeLine + 1 + 0.21;

      gl.disable(gl.CULL_FACE);
      gl.uniform1i(this.uUseClipPlane, 1);
      gl.uniform4f(this.uClipPlane, planeNx, planeNy, 0, planeD);
      gl.uniform3f(this.uCapColor, r * 0.72, g * 0.72, b * 0.72);

      const shredOuterMesh =
        anim.isOuterPeelOnly && skinId === 'classic_studs'
          ? (POLYOMINO_MESH_CATALOG[anim.shapeId]?.meshOuter ?? meshPair.meshOuter)
          : meshPair.meshOuter;
      const isHorizShredGate = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
      const shredAdjR = isHorizShredGate ? gate.edgeLine : gate.spanStart;
      const shredAdjC = isHorizShredGate ? gate.spanStart : gate.edgeLine;
      const shredRoomId =
        shredAdjR >= 0 && shredAdjR < board.rows && shredAdjC >= 0 && shredAdjC < board.cols
          ? (board.roomMap[shredAdjR * board.cols + shredAdjC] ?? 0)
          : 0;
      const shredRoomVis = this.getRoomVisualState(board, shredRoomId);

      this.drawMesh(
        gl,
        shredOuterMesh,
        sx,
        sy,
        shredRoomVis.zOffset,
        1.0,
        1.0,
        1.0,
        r * shredRoomVis.luminanceMul,
        g * shredRoomVis.luminanceMul,
        b * shredRoomVis.luminanceMul,
        1.0,
        0,
        0,
        anim.colorId === 0 ? 0 : matStyle
      );

      gl.uniform1i(this.uUseClipPlane, 0);
      gl.enable(gl.CULL_FACE);
    }

    // Identify all idle movable blocks so we can cycle the Staggered Spotlight Double-Bounce Hop (`IDLE-02`)
    const idleMovableBlockIds: number[] = [];
    for (const blk of board.blocks) {
      if (
        blk.status === 'ACTIVE' &&
        blk.iceCount === 0 &&
        !blk.chained &&
        blk.ropeColor === 0 &&
        !isBlockInLockedRoom(board, blk) &&
        !draggedGroupIds.has(blk.id) &&
        blk.liftAlpha <= 0.05
      ) {
        idleMovableBlockIds.push(blk.id);
      }
    }
    const spotlightCycleSec = 3.2;
    const spotlightHopWindowSec = 0.72;
    const spotlightCycleIndex = Math.floor(timeSec / spotlightCycleSec);
    const spotlightPhaseSec = timeSec - spotlightCycleIndex * spotlightCycleSec;
    const spotlightBlockId =
      !reducedMotion &&
      !anyDragActive &&
      idleMovableBlockIds.length > 0 &&
      spotlightPhaseSec < spotlightHopWindowSec
        ? idleMovableBlockIds[spotlightCycleIndex % idleMovableBlockIds.length]
        : -1;
    const spotlightHopT =
      spotlightBlockId >= 0 ? spotlightPhaseSec / spotlightHopWindowSec : 0;
    const spotlightHopEnv =
      spotlightBlockId >= 0
        ? Math.sin(spotlightHopT * Math.PI) * Math.abs(Math.sin(spotlightHopT * Math.PI * 2.0))
        : 0;

    for (const block of board.blocks) {
      if (block.status === 'CLEARED') continue;

      const shape = getShape(block.shapeId);
      const meshPair = getPolyominoMeshPair(block.shapeId, skinId);
      const activeColor: ColorId = getActiveColor(block.colorStack, block.colorCursor);
      const [rawR, rawG, rawB] = this.getColorRgb(activeColor, highContrast);
      const layersLeft = getLayersRemaining(block.colorStack, block.colorCursor);

      const blockRoomId = getBlockRoomId(board, block);
      const blockRoomVis = this.getRoomVisualState(board, blockRoomId);
      const roomLum = blockRoomVis.luminanceMul;

      const isGrabbed = draggedGroupIds.has(block.id) || block.liftAlpha > 0.05;
      const isIdleMovable =
        !reducedMotion &&
        !isGrabbed &&
        !blockRoomVis.isLocked &&
        block.iceCount === 0 &&
        !block.chained &&
        block.ropeColor === 0;
      const isSpotlightHopping = isIdleMovable && block.id === spotlightBlockId;
      const blockHopEnv = isSpotlightHopping ? spotlightHopEnv : 0;

      // Diagonal harmonic wave across the courtyard (`IDLE-01`)
      const wavePhase =
        timeSec * 2.1 - (block.col * 0.68 + block.row * 0.54) + block.id * 0.55;
      const wave01 = isIdleMovable ? 0.5 + 0.5 * Math.sin(wavePhase) : 0;

      // Bomb blocks also throb with an urgent rhythmic heartbeat (`IDLE-05`)
      const isBombBlock =
        !reducedMotion && !blockRoomVis.isLocked && block.bombMax > 0 && block.bombCount > 0;
      const bombHeartbeat = isBombBlock
        ? (0.5 + 0.5 * Math.sin(timeSec * (block.bombCount <= 4 ? 7.6 : 4.2) + block.id)) *
          (block.bombCount <= 4 ? 0.036 : 0.018)
        : 0;

      const idleColorBoost = isIdleMovable
        ? wave01 * 0.048 + blockHopEnv * 0.075
        : bombHeartbeat * 1.2;
      const colorMul =
        (isGrabbed ? 1.14 : anyDragActive ? 0.88 : 1.0 + idleColorBoost) * roomLum;
      const r = Math.min(1, rawR * colorMul + (1 - roomLum) * 0.03);
      const g = Math.min(1, rawG * colorMul + (1 - roomLum) * 0.04);
      const b = Math.min(1, rawB * colorMul + (1 - roomLum) * 0.09);

      // Gentle 3D vertical buoyancy + Spotlight Double-Bounce Hop (`IDLE-01`, `IDLE-02`)
      // Scaled by `live3DMix` so blocks lie still as an etched scroll diagram on the Title Screen
      const idleBreathZ =
        (isIdleMovable ? wave01 * 0.038 + blockHopEnv * 0.052 : bombHeartbeat * 0.5) *
        live3DMix;
      const grabHoverZ =
        !reducedMotion && isGrabbed
          ? Math.sin(timeSec * 7.2) * 0.022 * Math.min(1, block.liftAlpha)
          : 0;
      const zLift =
        blockRoomVis.zOffset +
        Math.max(0, Math.min(1, block.liftAlpha)) * 0.46 +
        grabHoverZ +
        idleBreathZ;

      // Knock-on scale bounce + grabbed scale pop + idle breathing scale (`IDLE-01`, `IDLE-02`)
      const bounceRem = this.blockBounceMap.get(block.id) ?? 0;
      const bouncePop =
        bounceRem > 0 && !reducedMotion
          ? Math.sin((1.0 - bounceRem / 0.34) * Math.PI) * 0.14
          : 0;
      const idleScaleXY =
        (isIdleMovable ? Math.sin(wavePhase) * 0.01 + blockHopEnv * 0.018 : bombHeartbeat) *
        live3DMix;
      const idleScaleZ =
        (isIdleMovable ? Math.sin(wavePhase) * 0.015 + blockHopEnv * 0.025 : bombHeartbeat) *
        live3DMix;
      const scaleXY =
        1.0 + 0.05 * Math.min(1, block.liftAlpha) + bouncePop + idleScaleXY;
      const scaleZ =
        1.0 + 0.06 * Math.min(1, block.liftAlpha) + bouncePop * 0.8 + idleScaleZ;

      // Subtle axis-advertising micro-drift along free movement lanes (`IDLE-01`)
      let idleDriftX = 0;
      let idleDriftY = 0;
      if (isIdleMovable && live3DMix > 0.1) {
        const hopWiggle = isSpotlightHopping
          ? Math.sin(spotlightHopT * Math.PI * 4.0) * 0.014
          : 0;
        if (block.axisLock === 'H') {
          idleDriftX = (Math.sin(timeSec * 2.0 + block.id * 1.3) * 0.008 + hopWiggle) * live3DMix;
        } else if (block.axisLock === 'V') {
          idleDriftY = (Math.sin(timeSec * 2.0 + block.id * 1.3) * 0.008 + hopWiggle) * live3DMix;
        }
      }

      let drawX = block.x + idleDriftX;
      let drawY = block.y + idleDriftY;

      // Damped spring rebound / immobile block tap shake (`R3D-01`)
      if (block.reboundTimerMs > 0) {
        block.reboundTimerMs = Math.max(0, block.reboundTimerMs - dtMs);
        const reboundT = block.reboundTimerMs / 200;
        if (block.shredGateIndex >= 0 && board.gates[block.shredGateIndex]) {
          const [nx, ny] = getGateOutwardNormal(board.gates[block.shredGateIndex].edge);
          const bounce = Math.sin(reboundT * Math.PI) * 0.14;
          drawX -= nx * bounce;
          drawY -= ny * bounce;
        } else {
          drawX += Math.sin(block.reboundTimerMs * 0.08) * 0.09 * reboundT;
        }
      }

      const meshTx = drawX - (scaleXY - 1.0) * shape.cols * 0.5;
      const meshTy = drawY - (scaleXY - 1.0) * shape.rows * 0.5;

      // Clip-plane shredding (`ENG-03`, `R3D-02`, `R3D-14`) when block is actively shredding through a gate
      let useClip = false;
      if (
        (block.status === 'SHREDDING' || block.shredProgress > 0) &&
        block.shredGateIndex >= 0 &&
        board.gates[block.shredGateIndex]
      ) {
        const gate = board.gates[block.shredGateIndex];
        const [nx, ny] = getGateOutwardNormal(gate.edge);
        const span = nx !== 0 ? shape.cols : shape.rows;
        const feedDist = block.shredProgress * (span + 0.45);
        drawX += nx * feedDist;
        drawY += ny * feedDist;

        // Clip plane aligned with spinning roller centerline (`±0.21`, `R3D-14`)
        const planeNx = -nx;
        const planeNy = -ny;
        let planeD = 0.21;
        if (gate.edge === 'TOP') planeD = 0.21 - gate.edgeLine;
        else if (gate.edge === 'BOTTOM') planeD = gate.edgeLine + 1 + 0.21;
        else if (gate.edge === 'LEFT') planeD = 0.21 - gate.edgeLine;
        else if (gate.edge === 'RIGHT') planeD = gate.edgeLine + 1 + 0.21;

        useClip = true;
        gl.disable(gl.CULL_FACE);
        gl.uniform1i(this.uUseClipPlane, 1);
        gl.uniform4f(this.uClipPlane, planeNx, planeNy, 0, planeD);
        gl.uniform3f(this.uCapColor, r * 0.72, g * 0.72, b * 0.72);
      } else {
        gl.uniform1i(this.uUseClipPlane, 0);
      }

      // Dynamic floor drop shadow when lifted or spotlight-hopping (`IDLE-02`)
      const shadowAlpha = Math.max(block.liftAlpha, blockHopEnv * 0.28);
      if (shadowAlpha > 0.02) {
        for (const [dr, dc] of shape.cells) {
          // Crisp offset drop shadow on floor
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.overlayQuad,
            drawX + dc + 0.12 * shadowAlpha,
            drawY + dr + 0.14 * shadowAlpha,
            blockRoomVis.zOffset + 0.008,
            0.92,
            0.92,
            1.0,
            0.01,
            0.02,
            0.05,
            0.46 * shadowAlpha,
            0,
            0,
            4
          );
          // Energized pulsing block-tinted selection rim halo around actively grabbed/lifted block
          if (block.liftAlpha > 0.02) {
            this.drawMesh(
              gl,
              ENVIRONMENT_MESHES.overlayQuad,
              drawX + dc - 0.05,
              drawY + dr - 0.05,
              Math.max(0.02, zLift - 0.015),
              1.1,
              1.1,
              1.0,
              Math.min(1, rawR * 0.65 + 0.35),
              Math.min(1, rawG * 0.65 + 0.35),
              Math.min(1, rawB * 0.65 + 0.35),
              (0.42 + 0.22 * pulse) * block.liftAlpha,
              0,
              0,
              4
            );
          }
        }
      }

      // 3A. Outer Morphological Shell (`meshOuter`; un-studded collar when `layersLeft > 1`, `R3D-11`)
      const outerMesh =
        layersLeft > 1 && skinId === 'classic_studs'
          ? (POLYOMINO_MESH_CATALOG[block.shapeId]?.meshOuter ?? meshPair.meshOuter)
          : meshPair.meshOuter;

      this.drawMesh(
        gl,
        outerMesh,
         useClip ? drawX : meshTx,
        useClip ? drawY : meshTy,
        zLift,
        scaleXY,
        scaleXY,
        scaleZ,
        r,
        g,
        b,
        1.0,
        0,
        0,
        activeColor === 0 ? 0 : matStyle
      );

      // 3B. Nested Inner Core Shell (`meshInnerCore`) if multi-layered (`layersLeft > 1`)
      if (layersLeft > 1) {
        const innerColor = block.colorStack[block.colorCursor + 1] ?? activeColor;
        const [ir, ig, ib] = this.getColorRgb(innerColor, highContrast);
        this.drawMesh(
          gl,
          meshPair.meshInnerCore,
          useClip ? drawX : meshTx,
          useClip ? drawY : meshTy,
          zLift,
          scaleXY,
          scaleXY,
          scaleZ,
          Math.min(1, ir * colorMul),
          Math.min(1, ig * colorMul),
          Math.min(1, ib * colorMul),
          1.0,
          0,
          0,
          matStyle
        );
      }

      const zCbSymbol = zLift + 0.692 * scaleZ;
      const zMedallionBase = zLift + 0.562 * scaleZ;
      const zStrapCenter = zLift + 0.588 * scaleZ;

      // 3C. 3D Colored Rope Straps (`block.ropeColor > 0` — sculpted 3D wrapping straps)
      if (block.ropeColor > 0) {
        const [rawRr, rawRg, rawRb] = this.getColorRgb(block.ropeColor, highContrast);
        const rr = rawRr * roomLum;
        const rg = rawRg * roomLum;
        const rb = rawRb * roomLum;
        const anchorCell = shape.cells[shape.anchorCellIndex] ?? shape.cells[0];
        const rCx = drawX + anchorCell[1] + 0.5;
        const rCy = drawY + anchorCell[0] + 0.5;
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          rCx,
          rCy,
          zStrapCenter,
          0.94,
          0.24,
          0.068 * scaleZ,
          rr,
          rg,
          rb,
          1.0,
          0,
          0,
          0
        );
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          rCx,
          rCy,
          zStrapCenter + 0.004,
          0.24,
          0.94,
          0.068 * scaleZ,
          rr * 0.92,
          rg * 0.92,
          rb * 0.92,
          1.0,
          0,
          0,
          0
        );
        if (colorblind) {
          this.drawAtlasBadge(
            gl,
            `CB_${block.ropeColor}`,
            drawX + anchorCell[1] + 0.79,
            rCy,
            zCbSymbol + 0.006,
            0.25,
            roomLum,
            roomLum,
            roomLum,
            1
          );
        }
      }

      // 3D. 3D Chained / Padlock Iron Straps (`block.chained`, sculpted 3D dark-bronze/iron bars)
      if (block.chained) {
        const anchorCell = shape.cells[shape.anchorCellIndex] ?? shape.cells[0];
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          drawX + shape.cols * 0.5,
          drawY + anchorCell[0] + 0.5,
          zStrapCenter,
          Math.max(0.92, shape.cols - 0.08),
          0.22,
          0.066 * scaleZ,
          0.28 * roomLum,
          0.32 * roomLum,
          0.4 * roomLum,
          1.0,
          0,
          0,
          0
        );
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          drawX + anchorCell[1] + 0.5,
          drawY + shape.rows * 0.5,
          zStrapCenter + 0.004,
          0.22,
          Math.max(0.92, shape.rows - 0.08),
          0.066 * scaleZ,
          0.32 * roomLum,
          0.36 * roomLum,
          0.44 * roomLum,
          1.0,
          0,
          0,
          0
        );
      }

      // 3E. Translucent Ice Casing (`block.iceCount > 0`, `R3D-11`)
      if (block.iceCount > 0) {
        gl.depthMask(false);
        this.drawMesh(
          gl,
          outerMesh,
          meshTx - shape.cols * 0.008,
          meshTy - shape.rows * 0.008,
          zLift + 0.01,
          scaleXY * 1.016,
          scaleXY * 1.016,
          scaleZ * 1.02,
          0.62 * roomLum,
          0.92 * roomLum,
          1.0 * roomLum,
          0.48,
          0,
          0,
          1
        );
        gl.depthMask(true);
      }

      // 3F. 3-Zone Sculpted Architectural Surface Overlays (`UX-10`, `AX-01`, `R3D-07`)
      const anchor = shape.cells[shape.anchorCellIndex] ?? shape.cells[0];
      const anchorCx = drawX + anchor[1] + 0.5;
      const anchorCy = drawY + anchor[0] + 0.5;
      const hasImmobilizer = block.iceCount > 0 || block.chained;
      const hasPayload =
        (block.bombMax > 0 && block.bombCount > 0) ||
        block.hasKey > 0 ||
        block.scissorColor > 0 ||
        block.shutterGemColor > 0 ||
        block.isStar;
      let lockBadgeCx = -999;
      let lockBadgeCy = -999;

      // Zone A: Integrated 3D Axis-Lock Side-Flange Rails + Sculpted Tone-on-Tone Medallion (`UX-10`, `R3D-07`)
      // Circular studs occupy [0.34, 0.66]; placing 3D side rails at 0.13 and 0.87 leaves the 3D studs 100% uncovered!
      if (block.axisLock === 'H') {
        const rowCells = shape.cells.filter((c) => c[0] === anchor[0]);
        let minCol = anchor[1];
        let maxCol = anchor[1];
        for (const rc of rowCells) {
          if (rc[1] < minCol) minCol = rc[1];
          if (rc[1] > maxCol) maxCol = rc[1];
        }
        const spanW = maxCol - minCol + 1;
        const railCenterX = drawX + minCol + spanW * 0.5;
        const railLen = spanW - 0.12;
        const zRail = zLift + 0.592 * scaleZ;
        const flangeR = Math.min(1, r * 0.42 + 0.58);
        const flangeG = Math.min(1, g * 0.42 + 0.55);
        const flangeB = Math.min(1, b * 0.42 + 0.48);

        // Parallel 3D beveled architectural side-flange rails along the locked top & bottom edges
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          railCenterX,
          drawY + anchor[0] + 0.13,
          zRail,
          railLen,
          0.092,
          0.058 * scaleZ,
          flangeR,
          flangeG,
          flangeB,
          1.0,
          0,
          0,
          0
        );
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          railCenterX,
          drawY + anchor[0] + 0.87,
          zRail,
          railLen,
          0.092,
          0.058 * scaleZ,
          flangeR,
          flangeG,
          flangeB,
          1.0,
          0,
          0,
          0
        );

        // Sculpted 3D tone-on-tone medallion + pill-free architectural double-chevron (`LOCK_H`)
        let arrowCx = railCenterX;
        let arrowCy = anchorCy;
        let medW = spanW >= 2 ? 0.58 : 0.48;
        let medH = 0.36;
        let iconSize = spanW >= 2 ? 0.5 : 0.42;

        if (hasImmobilizer || hasPayload) {
          const freeCell =
            rowCells.find((c) => c[1] !== anchor[1]) ??
            shape.cells.find((c) => c[0] !== anchor[0] || c[1] !== anchor[1]);
          if (freeCell) {
            arrowCx = drawX + freeCell[1] + 0.5;
            arrowCy = drawY + freeCell[0] + 0.5;
            medW = 0.5;
            medH = 0.36;
            iconSize = 0.44;
          } else {
            arrowCx = anchorCx;
            arrowCy = drawY + anchor[0] + 0.8;
            medW = 0.42;
            medH = 0.28;
            iconSize = 0.34;
          }
        }
        lockBadgeCx = arrowCx;
        lockBadgeCy = arrowCy;

        const lockBadgeZ = this.drawBadgeMedallion3D(
          gl,
          arrowCx,
          arrowCy,
          zMedallionBase,
          medW,
          medH,
          r,
          g,
          b
        );
        this.drawAtlasBadge(
          gl,
          'LOCK_H',
          arrowCx,
          arrowCy,
          lockBadgeZ,
          iconSize,
          1.0,
          0.99,
          0.94,
          1.0
        );
      } else if (block.axisLock === 'V') {
        const colCells = shape.cells.filter((c) => c[1] === anchor[1]);
        let minRow = anchor[0];
        let maxRow = anchor[0];
        for (const cc of colCells) {
          if (cc[0] < minRow) minRow = cc[0];
          if (cc[0] > maxRow) maxRow = cc[0];
        }
        const spanH = maxRow - minRow + 1;
        const railCenterY = drawY + minRow + spanH * 0.5;
        const railLen = spanH - 0.12;
        const zRail = zLift + 0.592 * scaleZ;
        const flangeR = Math.min(1, r * 0.42 + 0.58);
        const flangeG = Math.min(1, g * 0.42 + 0.55);
        const flangeB = Math.min(1, b * 0.42 + 0.48);

        // Parallel 3D beveled architectural side-flange rails along the locked left & right edges
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          drawX + anchor[1] + 0.13,
          railCenterY,
          zRail,
          0.092,
          railLen,
          0.058 * scaleZ,
          flangeR,
          flangeG,
          flangeB,
          1.0,
          0,
          0,
          0
        );
        this.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          drawX + anchor[1] + 0.87,
          railCenterY,
          zRail,
          0.092,
          railLen,
          0.058 * scaleZ,
          flangeR,
          flangeG,
          flangeB,
          1.0,
          0,
          0,
          0
        );

        // Sculpted 3D tone-on-tone medallion + pill-free architectural double-chevron (`LOCK_V`)
        let arrowCx = anchorCx;
        let arrowCy = railCenterY;
        let medW = 0.36;
        let medH = spanH >= 2 ? 0.58 : 0.48;
        let iconSize = spanH >= 2 ? 0.5 : 0.42;

        if (hasImmobilizer || hasPayload) {
          const freeCell =
            colCells.find((c) => c[0] !== anchor[0]) ??
            shape.cells.find((c) => c[0] !== anchor[0] || c[1] !== anchor[1]);
          if (freeCell) {
            arrowCx = drawX + freeCell[1] + 0.5;
            arrowCy = drawY + freeCell[0] + 0.5;
            medW = 0.36;
            medH = 0.5;
            iconSize = 0.44;
          } else {
            arrowCx = drawX + anchor[1] + 0.8;
            arrowCy = anchorCy;
            medW = 0.28;
            medH = 0.42;
            iconSize = 0.34;
          }
        }
        lockBadgeCx = arrowCx;
        lockBadgeCy = arrowCy;

        const lockBadgeZ = this.drawBadgeMedallion3D(
          gl,
          arrowCx,
          arrowCy,
          zMedallionBase,
          medW,
          medH,
          r,
          g,
          b
        );
        this.drawAtlasBadge(
          gl,
          'LOCK_V',
          arrowCx,
          arrowCy,
          lockBadgeZ,
          iconSize,
          1.0,
          0.99,
          0.94,
          1.0
        );
      }

      // Zone B: Decoupled Immobilizer Badge vs Payload / Modifier Badge (`R3D-03`, `UX-10`)
      let immCx = anchorCx;
      let immCy = anchorCy;
      let immScale = layersLeft > 1 && shape.cells.length === 1 ? 0.86 : 1.0;
      let payCx = anchorCx;
      let payCy = anchorCy;
      let payScale = layersLeft > 1 && shape.cells.length === 1 ? 0.86 : 1.0;

      if (hasImmobilizer && hasPayload) {
        if (shape.cells.length >= 2) {
          const secCell = shape.cells[(shape.anchorCellIndex + 1) % shape.cells.length];
          payCx = drawX + secCell[1] + 0.5;
          payCy = drawY + secCell[0] + 0.5;
        } else {
          immCx = anchorCx - 0.16;
          immCy = anchorCy - 0.14;
          immScale = 0.76;
          payCx = anchorCx + 0.16;
          payCy = anchorCy + 0.14;
          payScale = 0.76;
        }
      }

      const isCellCenterBusy = (cellR: number, cellC: number, ci: number): boolean => {
        const cellCx = drawX + cellC + 0.5;
        const cellCy = drawY + cellR + 0.5;
        return (
          (hasImmobilizer && Math.hypot(cellCx - immCx, cellCy - immCy) < 0.36) ||
          (hasPayload && Math.hypot(cellCx - payCx, cellCy - payCy) < 0.36) ||
          (block.axisLock !== 'NONE' &&
            Math.hypot(cellCx - lockBadgeCx, cellCy - lockBadgeCy) < 0.38) ||
          (block.ropeColor > 0 && ci === shape.anchorCellIndex) ||
          (block.chained && (cellR === anchor[0] || cellC === anchor[1]))
        );
      };

      // Neutral `color: 0` Stone Sliders: 3D carved architectural masonry inlay when `colorblind === false`
      if (activeColor === 0 && !colorblind) {
        for (let ci = 0; ci < shape.cells.length; ci++) {
          const cell = shape.cells[ci];
          if (isCellCenterBusy(cell[0], cell[1], ci)) continue;
          this.drawMesh(
            gl,
            ENVIRONMENT_MESHES.unitParticleCube,
            drawX + cell[1] + 0.5,
            drawY + cell[0] + 0.5,
            zLift + 0.602 * scaleZ,
            0.44,
            0.44,
            0.046 * scaleZ,
            Math.min(1, r * 0.78 + 0.18),
            Math.min(1, g * 0.78 + 0.18),
            Math.min(1, b * 0.78 + 0.18),
            1.0,
            0,
            Math.PI * 0.25,
            0
          );
        }
      }

      // AX-01 Colorblind Symbols embossed above all studs/medallions (`zCbSymbol = zLift + 0.692 * scaleZ`)
      if (colorblind) {
        for (let ci = 0; ci < shape.cells.length; ci++) {
          const cell = shape.cells[ci];
          const isBusyCell = layersLeft > 1 || isCellCenterBusy(cell[0], cell[1], ci);
          const symX = drawX + cell[1] + (isBusyCell ? 0.21 : 0.5);
          const symY = drawY + cell[0] + (isBusyCell ? 0.21 : 0.5);
          const symSize = isBusyCell ? 0.25 : 0.35;
          this.drawAtlasBadge(
            gl,
            `CB_${activeColor}`,
            symX,
            symY,
            zCbSymbol,
            symSize,
            roomLum,
            roomLum,
            roomLum,
            0.98
          );
        }
        const firstCell = shape.cells[0];
        if (layersLeft > 1) {
          const innerColor = block.colorStack[block.colorCursor + 1] ?? activeColor;
          const firstBusy = isCellCenterBusy(firstCell[0], firstCell[1], 0);
          this.drawAtlasBadge(
            gl,
            `CB_${innerColor}`,
            drawX + firstCell[1] + (firstBusy ? 0.79 : 0.5),
            drawY + firstCell[0] + (firstBusy ? 0.79 : 0.5),
            zCbSymbol + 0.004,
            firstBusy ? 0.24 : 0.31,
            roomLum,
            roomLum,
            roomLum,
            0.98
          );
        }
      }

      // 1) Immobilizer Badge (`iceCount > 0` or `chained`) via Sculpted 3D Medallion
      if (block.iceCount > 0) {
        const iceBadgeZ = this.drawBadgeMedallion3D(
          gl,
          immCx,
          immCy,
          zMedallionBase,
          0.66 * immScale,
          0.44 * immScale,
          0.38 * roomLum,
          0.74 * roomLum,
          0.96 * roomLum
        );
        this.drawAtlasBadge(
          gl,
          'BADGE_ICE',
          immCx - 0.14 * immScale,
          immCy,
          iceBadgeZ,
          0.35 * immScale,
          0.88 * roomLum,
          0.98 * roomLum,
          1.0 * roomLum,
          1.0
        );
        this.drawNumberBadges(
          gl,
          block.iceCount,
          immCx + 0.15 * immScale,
          immCy,
          iceBadgeZ + 0.002,
          0.35 * immScale,
          roomLum,
          roomLum,
          roomLum
        );
      } else if (block.chained) {
        const lockBadgeZ = this.drawBadgeMedallion3D(
          gl,
          immCx,
          immCy,
          zMedallionBase,
          0.52 * immScale,
          0.52 * immScale,
          0.36 * roomLum,
          0.4 * roomLum,
          0.48 * roomLum
        );
        this.drawAtlasBadge(
          gl,
          'BADGE_LOCK',
          immCx,
          immCy,
          lockBadgeZ,
          0.48 * immScale,
          1.0 * roomLum,
          0.9 * roomLum,
          0.42 * roomLum,
          1.0
        );
      }

      // 2) Payload / Modifier Badge (`bomb`, `hasKey`, `scissorColor`, `shutterGemColor`, `isStar`) via Sculpted 3D Medallion (`IDLE-05`)
      const payBobZ =
        !reducedMotion && !blockRoomVis.isLocked
          ? Math.sin(timeSec * 2.2 + block.id * 0.9) * 0.011 * live3DMix
          : 0;
      const payPulseScale =
        !reducedMotion && !blockRoomVis.isLocked
          ? payScale * (1.0 + Math.sin(timeSec * 2.2 + block.id * 0.9) * 0.028 * live3DMix)
          : payScale;

      if (block.bombMax > 0 && block.bombCount > 0) {
        const urgent = block.bombCount <= 3 && !blockRoomVis.isLocked ? 0.65 + 0.35 * pulse : 1.0;
        const bombMedScale =
          !reducedMotion && !blockRoomVis.isLocked
            ? payScale * (1.0 + bombHeartbeat * 1.2 * live3DMix)
            : payScale;
        const twoDigit = block.bombCount >= 10;
        const bombBadgeZ = this.drawBadgeMedallion3D(
          gl,
          payCx,
          payCy,
          zMedallionBase + payBobZ * 0.6,
          0.74 * bombMedScale,
          0.46 * bombMedScale,
          r,
          g,
          b
        );
        this.drawAtlasBadge(
          gl,
          'BADGE_BOMB',
          payCx - (twoDigit ? 0.2 : 0.15) * bombMedScale,
          payCy,
          bombBadgeZ,
          (twoDigit ? 0.32 : 0.35) * bombMedScale,
          1.0 * roomLum,
          0.86 * urgent * roomLum,
          0.3 * urgent * roomLum,
          1.0
        );
        this.drawNumberBadges(
          gl,
          block.bombCount,
          payCx + (twoDigit ? 0.16 : 0.15) * bombMedScale,
          payCy,
          bombBadgeZ + 0.002,
          (twoDigit ? 0.3 : 0.35) * bombMedScale,
          1.0 * roomLum,
          0.97 * roomLum,
          0.48 * roomLum
        );
      } else if (block.hasKey > 0) {
        const keyBadgeZ = this.drawBadgeMedallion3D(
          gl,
          payCx,
          payCy,
          zMedallionBase + payBobZ,
          0.52 * payPulseScale,
          0.52 * payPulseScale,
          r,
          g,
          b
        );
        this.drawAtlasBadge(
          gl,
          'BADGE_KEY',
          payCx,
          payCy,
          keyBadgeZ,
          0.48 * payPulseScale,
          1.0 * roomLum,
          0.9 * roomLum,
          0.32 * roomLum,
          1.0
        );
      } else if (block.scissorColor > 0) {
        const [sr, sg, sb] = this.getColorRgb(block.scissorColor, highContrast);
        const scisBadgeZ = this.drawBadgeMedallion3D(
          gl,
          payCx,
          payCy,
          zMedallionBase + payBobZ,
          0.52 * payPulseScale,
          0.52 * payPulseScale,
          r,
          g,
          b
        );
        this.drawAtlasBadge(
          gl,
          'BADGE_SCISSORS',
          payCx,
          payCy,
          scisBadgeZ,
          0.48 * payPulseScale,
          sr * roomLum,
          sg * roomLum,
          sb * roomLum,
          1.0
        );
        if (colorblind) {
          this.drawAtlasBadge(
            gl,
            `CB_${block.scissorColor}`,
            payCx + 0.2 * payPulseScale,
            payCy + 0.18 * payPulseScale,
            scisBadgeZ + 0.003,
            0.22 * payPulseScale,
            roomLum,
            roomLum,
            roomLum,
            1
          );
        }
      } else if (block.shutterGemColor > 0) {
        const [gr, gg, gb] = this.getColorRgb(block.shutterGemColor, highContrast);
        const gemBadgeZ = this.drawBadgeMedallion3D(
          gl,
          payCx,
          payCy,
          zMedallionBase + payBobZ,
          0.52 * payPulseScale,
          0.52 * payPulseScale,
          r,
          g,
          b
        );
        this.drawAtlasBadge(
          gl,
          'BADGE_GEM',
          payCx,
          payCy,
          gemBadgeZ,
          0.48 * payPulseScale,
          gr * roomLum,
          gg * roomLum,
          gb * roomLum,
          1.0
        );
        if (colorblind) {
          this.drawAtlasBadge(
            gl,
            `CB_${block.shutterGemColor}`,
            payCx + 0.2 * payPulseScale,
            payCy + 0.18 * payPulseScale,
            gemBadgeZ + 0.003,
            0.22 * payPulseScale,
            roomLum,
            roomLum,
            roomLum,
            1
          );
        }
      } else if (block.isStar) {
        const starBadgeZ = this.drawBadgeMedallion3D(
          gl,
          payCx,
          payCy,
          zMedallionBase + payBobZ,
          0.5 * payPulseScale,
          0.5 * payPulseScale,
          r,
          g,
          b
        );
        this.drawAtlasBadge(
          gl,
          'BADGE_STAR',
          payCx,
          payCy,
          starBadgeZ,
          0.46 * payPulseScale,
          1.0 * roomLum,
          0.92 * roomLum,
          0.32 * roomLum,
          1.0
        );
      }

      if (useClip) {
        gl.uniform1i(this.uUseClipPlane, 0);
        gl.enable(gl.CULL_FACE);
      }
    }

    // 3F.2 Early-Stage & Hint 3D Sliding Ghost Polyomino (`UX-10`)
    const guideMove = board.hintMove ?? (!anyDragActive ? options.autoGuideMove : null) ?? null;
    if (guideMove && !anyDragActive && !reducedMotion) {
      const ghostBlock = board.blocks.find(
        (b) => b.id === guideMove.blockId && b.status === 'ACTIVE'
      );
      if (ghostBlock) {
        const meshPair = getPolyominoMeshPair(ghostBlock.shapeId, skinId);
        const activeColor: ColorId = getActiveColor(ghostBlock.colorStack, ghostBlock.colorCursor);
        const [gr, gg, gb] = this.getColorRgb(activeColor, highContrast);
        const rawPhase = (timeSec * 0.72) % 1.0;
        const moveT =
          rawPhase < 0.78 ? (1.0 - Math.cos((rawPhase / 0.78) * Math.PI)) * 0.5 : 1.0;
        const ghostAlpha = Math.sin(rawPhase * Math.PI) * 0.38;
        if (ghostAlpha > 0.03 && moveT > 0.06) {
          const gx = ghostBlock.col + (guideMove.targetCol - ghostBlock.col) * moveT;
          const gy = ghostBlock.row + (guideMove.targetRow - ghostBlock.row) * moveT;
          gl.depthMask(false);
          this.drawMesh(
            gl,
            meshPair.meshOuter,
            gx,
            gy,
            0.09,
            1.0,
            1.0,
            1.0,
            Math.min(1, gr * 0.7 + 0.3),
            Math.min(1, gg * 0.7 + 0.28),
            Math.min(1, gb * 0.7 + 0.15),
            ghostAlpha,
            0,
            0,
            1
          );
          gl.depthMask(true);
        }
      }
    }

    // 3G. 3D Metallic Weld Clamps bridging adjacent blocks that share `groupId > 0`
    for (let i = 0; i < board.blocks.length; i++) {
      const a = board.blocks[i];
      if (a.status !== 'ACTIVE' || a.groupId <= 0) continue;
      const shapeA = getShape(a.shapeId);

      for (let j = i + 1; j < board.blocks.length; j++) {
        const b = board.blocks[j];
        if (b.status !== 'ACTIVE' || b.groupId !== a.groupId) continue;
        const shapeB = getShape(b.shapeId);

        let clamped = false;
        for (const [ar, ac] of shapeA.cells) {
          if (clamped) break;
          const ax = a.x + ac;
          const ay = a.y + ar;
          for (const [br, bc] of shapeB.cells) {
            const bx = b.x + bc;
            const by = b.y + br;
            if (Math.abs(ax - bx) + Math.abs(ay - by) < 1.05) {
              const mx = (ax + bx) * 0.5 + 0.5;
              const my = (ay + by) * 0.5 + 0.5;
              const clampRoomVis = this.getRoomVisualState(board, getBlockRoomId(board, a));
              const mz =
                clampRoomVis.zOffset + Math.max(a.liftAlpha, b.liftAlpha) * BLOCK_LIFT_DELTA_Z;
              this.drawMesh(
                gl,
                ENVIRONMENT_MESHES.weldClampMesh,
                mx,
                my,
                mz,
                1.0,
                1.0,
                1.0,
                0.78 * clampRoomVis.luminanceMul,
                0.84 * clampRoomVis.luminanceMul,
                0.92 * clampRoomVis.luminanceMul,
                1.0
              );
              clamped = true;
              break;
            }
          }
        }
      }
    }
  }

  private getParticleStyleCode(style: ParticleStyleId = 'micro_cubes'): number {
    if (style === 'star_confetti') return 1;
    if (style === 'pixel_sparks') return 2;
    if (style === 'soap_bubbles') return 3;
    if (style === 'lightning_bolts') return 4;
    return 0;
  }

  private renderPass4Particles(
    gl: WebGL2RenderingContext,
    particleStyle: ParticleStyleId = 'micro_cubes'
  ): void {
    if (this.activeParticleCount <= 0 || !this.particleVao || !this.particleInstanceBuffer) {
      return;
    }

    gl.useProgram(this.particleProgram);
    gl.uniformMatrix4fv(this.uPartViewProj, false, this.camera.getViewProjectionMatrix(false));
    gl.uniform1i(this.uPartStyle, this.getParticleStyleCode(particleStyle));

    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleInstanceBuffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.particleInstanceData.subarray(0, this.activeParticleCount * INSTANCE_STRIDE)
    );

    gl.drawElementsInstanced(
      gl.TRIANGLES,
      this.particleIndexCount,
      gl.UNSIGNED_SHORT,
      0,
      this.activeParticleCount
    );
    gl.bindVertexArray(null);
  }

  /**
   * Complete `Canvas2D` fallback renderer (`R3D-05`) using `Camera3D.boardToScreen` so all 18 obstacles,
   * reticles, visual shred animations, multi-modifier badges, and 3D particles remain 100% visible
   * even in environments without WebGL2.
   */
  private renderCanvas2DFallback(
    board: BoardState,
    options: RenderSceneOptions,
    dtSec = 1 / 60
  ): void {
    const ctx = this.ctx2d;
    if (!ctx) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const trayId = options.equippedTray ?? 'industrial_slate';
    const highContrast = Boolean(options.highContrast);
    const colorblind = Boolean(options.colorblindSymbols);
    const palette = this.getEffectiveTrayPalette(trayId, highContrast);
    const toCssRgb = (rgb: [number, number, number], mul = 1.0): string =>
      `rgb(${Math.round(Math.min(1, rgb[0] * mul) * 255)}, ${Math.round(Math.min(1, rgb[1] * mul) * 255)}, ${Math.round(Math.min(1, rgb[2] * mul) * 255)})`;
    const dtMs = dtSec * 1000;

    const virtualRect = {
      left: 0,
      top: 0,
      width: w,
      height: h,
      right: w,
      bottom: h,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    ctx.clearRect(0, 0, w, h);

    const blueprintMix = Math.max(0, Math.min(1, options.blueprintMix ?? 0));
    const zRelief = 1.0 - 0.78 * blueprintMix;
    const project = (bx: number, by: number, bz: number) =>
      this.camera.boardToScreen(bx, by, bz * zRelief, virtualRect, board.rows, board.cols);

    const fillProjectedQuad = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      z: number,
      fillStyle: string,
      strokeStyle?: string,
      lineWidth = 1.5
    ) => {
      const p0 = project(x0, y0, z);
      const p1 = project(x1, y0, z);
      const p2 = project(x1, y1, z);
      const p3 = project(x0, y1, z);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
      if (strokeStyle) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    };

    const drawCenteredText = (
      text: string,
      bx: number,
      by: number,
      bz: number,
      color = '#FFFFFF',
      font = 'bold 12px sans-serif'
    ) => {
      const pt = project(bx, by, bz);
      ctx.save();
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 3;
      ctx.strokeText(text, pt.x, pt.y);
      ctx.fillStyle = color;
      ctx.fillText(text, pt.x, pt.y);
      ctx.restore();
    };

    // 1. Draw Floor Tiles, Cutouts, Colorful Floor Paths & Stone Pillars (`occ === -2`)
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const idx = r * board.cols + c;
        const occ = board.occupancy[idx];
        if (occ === -1) {
          continue;
        }
        const roomId = board.roomMap[idx] ?? 0;
        const roomVis = this.getRoomVisualState(board, roomId);
        const zOff = roomVis.zOffset;
        const fc = (board.floorColor[idx] ?? 0) as ColorId;
        const fill =
          fc > 0
            ? highContrast
              ? COLOR_PALETTE[fc].highContrastPrimaryHex
              : COLOR_PALETTE[fc].primaryHex
            : (r + c) % 2 === 0
              ? toCssRgb(palette.floorTileA, roomVis.luminanceMul)
              : toCssRgb(palette.floorTileB, roomVis.luminanceMul);
        fillProjectedQuad(c + 0.04, r + 0.04, c + 0.96, r + 0.96, zOff, fill);
        if (fc > 0 && colorblind) {
          drawCenteredText(COLOR_PALETTE[fc].symbol, c + 0.5, r + 0.5, zOff + 0.02, '#FFFFFF');
        }
        if (occ === -2) {
          fillProjectedQuad(
            c + 0.08,
            r + 0.08,
            c + 0.92,
            r + 0.92,
            zOff + 0.62,
            COLOR_PALETTE[0].primaryHex,
            COLOR_PALETTE[0].lipHex,
            2
          );
          drawCenteredText('▨', c + 0.5, r + 0.5, zOff + 0.65, '#E2E8F0', 'bold 14px sans-serif');
        }
      }
    }

    // 2. Draw Moving Elevator Platforms (`board.elevators`)
    for (const elev of board.elevators) {
      const dir = elev.atAlternatePos ? -1 : 1;
      const targetR = elev.row + elev.deltaRow * dir;
      const targetC = elev.col + elev.deltaCol * dir;
      const minR = Math.min(elev.row, targetR);
      const minC = Math.min(elev.col, targetC);
      const spanR = Math.abs(targetR - elev.row) + elev.height;
      const spanC = Math.abs(targetC - elev.col) + elev.width;
      fillProjectedQuad(
        minC + 0.15,
        minR + 0.15,
        minC + spanC - 0.15,
        minR + spanR - 0.15,
        0.01,
        'rgba(56, 189, 248, 0.22)',
        'rgba(56, 189, 248, 0.55)',
        1
      );
      fillProjectedQuad(
        elev.col + 0.04,
        elev.row + 0.04,
        elev.col + elev.width - 0.04,
        elev.row + elev.height - 0.04,
        0.05,
        '#38BDF8',
        '#0284C7',
        2
      );
      const arrow = Math.abs(elev.deltaCol) >= Math.abs(elev.deltaRow) ? '↔' : '↕';
      drawCenteredText(
        arrow,
        elev.col + elev.width * 0.5,
        elev.row + elev.height * 0.5,
        0.08,
        '#FFFFFF',
        'bold 14px sans-serif'
      );
    }

    // 3. Draw Wooden Crates (`board.crates`)
    for (const crate of board.crates) {
      if (crate.destroyed || crate.hp <= 0) continue;
      fillProjectedQuad(
        crate.col + 0.06,
        crate.row + 0.06,
        crate.col + 0.94,
        crate.row + 0.94,
        0.58,
        '#B45309',
        '#78350F',
        2
      );
      drawCenteredText(
        String(crate.hp),
        crate.col + 0.5,
        crate.row + 0.5,
        0.62,
        '#FEF3C7',
        'bold 14px sans-serif'
      );
    }

    // 4. Draw Block Generators & Spawn Pads (`board.generators`)
    for (const gen of board.generators) {
      const depleted = gen.state === 'DEPLETED' || gen.queueCursor >= gen.queue.length;
      fillProjectedQuad(
        gen.col + 0.05,
        gen.row + 0.05,
        gen.col + 0.95,
        gen.row + 0.95,
        0.68,
        depleted ? '#334155' : '#475569',
        '#1E293B',
        2
      );
      if (!depleted) {
        const nextSpec = gen.queue[gen.queueCursor];
        if (nextSpec && nextSpec.colorStack.length > 0) {
          const nextCol = nextSpec.colorStack[0];
          const nextEntry = COLOR_PALETTE[nextCol] ?? COLOR_PALETTE[1];
          const spawnShape = getShape(nextSpec.shapeId);
          for (const [dr, dc] of spawnShape.cells) {
            const sc = gen.spawnCol + dc;
            const sr = gen.spawnRow + dr;
            if (sc >= 0 && sc < board.cols && sr >= 0 && sr < board.rows) {
              fillProjectedQuad(
                sc + 0.08,
                sr + 0.08,
                sc + 0.92,
                sr + 0.92,
                0.02,
                'rgba(250, 204, 21, 0.24)',
                nextEntry.primaryHex,
                1.5
              );
            }
          }
          fillProjectedQuad(
            gen.col + 0.2,
            gen.row + 0.16,
            gen.col + 0.8,
            gen.row + 0.52,
            0.7,
            highContrast ? nextEntry.highContrastPrimaryHex : nextEntry.primaryHex
          );
          if (colorblind) {
            drawCenteredText(nextEntry.symbol, gen.col + 0.5, gen.row + 0.34, 0.72, '#FFFFFF');
          }
        }
        drawCenteredText(
          `⚡${gen.cooldown}`,
          gen.col + 0.5,
          gen.row + 0.72,
          0.72,
          '#FDE047',
          'bold 12px sans-serif'
        );
      }
    }

    // 5. Draw Target Reticles & Hint Ghost Outline
    let draggedId = options.draggedBlockId ?? null;
    if (draggedId === null) {
      const lifted = board.blocks.find((b) => b.status === 'ACTIVE' && b.liftAlpha > 0.1);
      if (lifted) draggedId = lifted.id;
    }
    if (draggedId !== null) {
      const group = getMovedGroupBlocks(board, draggedId);
      const lead = group.find((b) => b.id === draggedId) ?? group[0];
      if (lead) {
        let dRow =
          options.dragTargetRow !== undefined && options.dragTargetRow !== null
            ? options.dragTargetRow - lead.row
            : Math.round(lead.y - lead.row);
        let dCol =
          options.dragTargetCol !== undefined && options.dragTargetCol !== null
            ? options.dragTargetCol - lead.col
            : Math.round(lead.x - lead.col);
        if (!canGroupOccupyOffset(board, group, dRow, dCol)) {
          dRow = 0;
          dCol = 0;
        }
        for (const b of group) {
          const shape = getShape(b.shapeId);
          const snapRow = b.row + dRow;
          const snapCol = b.col + dCol;
          for (const [dr, dc] of shape.cells) {
            fillProjectedQuad(
              snapCol + dc + 0.06,
              snapRow + dr + 0.06,
              snapCol + dc + 0.94,
              snapRow + dr + 0.94,
              0.015,
              'rgba(255, 255, 255, 0.25)',
              '#FFFFFF',
              1.5
            );
          }
        }
      }
    }
    const fallbackGuideMove = board.hintMove ?? options.autoGuideMove ?? null;
    if (fallbackGuideMove) {
      const hintBlock = board.blocks.find(
        (b) => b.id === fallbackGuideMove.blockId && b.status === 'ACTIVE'
      );
      if (hintBlock) {
        const shape = getShape(hintBlock.shapeId);
        for (const [dr, dc] of shape.cells) {
          fillProjectedQuad(
            fallbackGuideMove.targetCol + dc + 0.06,
            fallbackGuideMove.targetRow + dr + 0.06,
            fallbackGuideMove.targetCol + dc + 0.94,
            fallbackGuideMove.targetRow + dr + 0.94,
            0.02,
            'rgba(250, 204, 21, 0.35)',
            '#FACC15',
            2
          );
        }
      }
    }

    // 6. Draw Gates, Shutters, Ice Counters, Star Emblems, Queue Pips & Portcullis Barriers
    for (const gate of board.gates) {
      const cId = getGateActiveColor(gate);
      const entry = COLOR_PALETTE[cId] ?? COLOR_PALETTE[1];
      const isHorizEdge = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
      let gx0 = gate.spanStart;
      let gy0 = 0;
      let gx1 = gate.spanStart + gate.spanLength;
      let gy1 = 0;
      if (gate.edge === 'TOP') {
        gy0 = gate.edgeLine - 0.38;
        gy1 = gate.edgeLine;
      } else if (gate.edge === 'BOTTOM') {
        gy0 = gate.edgeLine + 1;
        gy1 = gate.edgeLine + 1 + 0.38;
      } else if (gate.edge === 'LEFT') {
        gx0 = gate.edgeLine - 0.38;
        gx1 = gate.edgeLine;
        gy0 = gate.spanStart;
        gy1 = gate.spanStart + gate.spanLength;
      } else {
        gx0 = gate.edgeLine + 1;
        gx1 = gate.edgeLine + 1 + 0.38;
        gy0 = gate.spanStart;
        gy1 = gate.spanStart + gate.spanLength;
      }

      fillProjectedQuad(
        gx0,
        gy0,
        gx1,
        gy1,
        0.35,
        highContrast ? entry.highContrastPrimaryHex : entry.primaryHex,
        entry.lipHex,
        2
      );

      const gcx = (gx0 + gx1) * 0.5;
      const gcy = (gy0 + gy1) * 0.5;
      const spanAxisX = isHorizEdge ? 1 : 0;
      const spanAxisY = isHorizEdge ? 0 : 1;

      if (!gate.shutterOpen || gate.shutterLockColor > 0) {
        const lockHex =
          gate.shutterLockColor > 0
            ? COLOR_PALETTE[gate.shutterLockColor].primaryHex
            : '#64748B';
        fillProjectedQuad(gx0 + 0.05, gy0 + 0.05, gx1 - 0.05, gy1 - 0.05, 0.48, lockHex, '#0F172A');
        if (gate.shutterLockColor > 0) {
          drawCenteredText('💎', gcx, gcy, 0.56, '#FFFFFF');
        }
      } else if (gate.togglesOnClear) {
        fillProjectedQuad(gx0, gy0, gx0 + 0.1, gy0 + 0.1, 0.45, '#22C55E');
      }

      if (gate.iceCount > 0) {
        fillProjectedQuad(
          gx0,
          gy0,
          gx1,
          gy1,
          0.52,
          'rgba(125, 211, 252, 0.55)',
          '#BAE6FD',
          1.5
        );
        drawCenteredText(`❄${gate.iceCount}`, gcx, gcy, 0.6, '#FFFFFF');
      }

      if (gate.isStar) {
        const starOff = gate.iceCount > 0 || gate.shutterLockColor > 0 ? 0.28 : 0;
        drawCenteredText(
          '★',
          gcx + spanAxisX * starOff,
          gcy + spanAxisY * starOff,
          0.6,
          '#FDE047'
        );
      }

      if (colorblind) {
        drawCenteredText(
          entry.symbol,
          gcx - spanAxisX * 0.28,
          gcy - spanAxisY * 0.28,
          0.6,
          '#FFFFFF'
        );
      }

      const remainingQueue = gate.colorQueue.length - (gate.colorCursor + 1);
      for (let q = 0; q < Math.min(3, remainingQueue); q++) {
        const nextCol = gate.colorQueue[gate.colorCursor + 1 + q];
        const qEntry = COLOR_PALETTE[nextCol] ?? COLOR_PALETTE[1];
        const pipOffset = (q - (Math.min(3, remainingQueue) - 1) * 0.5) * 0.26;
        const px = isHorizEdge ? gcx + pipOffset : gcx + (gate.edge === 'LEFT' ? -0.18 : 0.18);
        const py = !isHorizEdge ? gcy + pipOffset : gcy + (gate.edge === 'TOP' ? -0.18 : 0.18);
        fillProjectedQuad(
          px - 0.08,
          py - 0.08,
          px + 0.08,
          py + 0.08,
          0.64,
          highContrast ? qEntry.highContrastPrimaryHex : qEntry.primaryHex,
          '#0F172A',
          1
        );
        if (colorblind) {
          drawCenteredText(qEntry.symbol, px, py, 0.68, '#FFFFFF', 'bold 9px sans-serif');
        }
      }
    }

    for (const bar of board.barriers) {
      if (bar.cells.length === 0) continue;
      let minR = bar.cells[0][0];
      let maxR = bar.cells[0][0];
      let minC = bar.cells[0][1];
      let maxC = bar.cells[0][1];
      for (const [r, c] of bar.cells) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
      const spanW = maxC - minC + 1;
      const spanH = maxR - minR + 1;
      if (bar.open) {
        fillProjectedQuad(
          minC + 0.12,
          minR + 0.12,
          minC + spanW - 0.12,
          minR + spanH - 0.12,
          0.02,
          'rgba(234, 179, 8, 0.18)',
          '#CA8A04',
          1
        );
      } else {
        fillProjectedQuad(
          minC + 0.08,
          minR + 0.08,
          minC + spanW - 0.08,
          minR + spanH - 0.08,
          0.56,
          '#B45309',
          '#FDE047',
          2
        );
        const label =
          bar.lockId && bar.lockId > 0 && bar.shredsRemaining <= 0
            ? '🔑'
            : `⛩${bar.shredsRemaining}`;
        drawCenteredText(
          label,
          minC + spanW * 0.5,
          minR + spanH * 0.5,
          0.64,
          '#FEF08A',
          'bold 13px sans-serif'
        );
      }
    }

    // 7. Advance & Draw Active Visual Shreds (`this.activeVisualShreds`)
    for (let i = this.activeVisualShreds.length - 1; i >= 0; i--) {
      const anim = this.activeVisualShreds[i];
      anim.progress += dtSec / 0.22;
      const gate = board.gates[anim.gateIndex];
      if (anim.progress >= 1 || !gate) {
        this.activeVisualShreds.splice(i, 1);
        continue;
      }
      const shape = getShape(anim.shapeId);
      const entry = COLOR_PALETTE[anim.colorId] ?? COLOR_PALETTE[1];
      const [nx, ny] = getGateOutwardNormal(gate.edge);
      const span = nx !== 0 ? shape.cols : shape.rows;
      const sx = anim.x + nx * anim.progress * (span + 0.35);
      const sy = anim.y + ny * anim.progress * (span + 0.35);
      for (const [dr, dc] of shape.cells) {
        const cx = sx + dc;
        const cy = sy + dr;
        if (gate.edge === 'TOP' && cy < gate.edgeLine - 0.25) continue;
        if (gate.edge === 'BOTTOM' && cy > gate.edgeLine + 0.25) continue;
        if (gate.edge === 'LEFT' && cx < gate.edgeLine - 0.25) continue;
        if (gate.edge === 'RIGHT' && cx > gate.edgeLine + 0.25) continue;
        if (cx < -0.25 || cx > board.cols - 0.75 || cy < -0.25 || cy > board.rows - 0.75) continue;
        fillProjectedQuad(
          cx + 0.05,
          cy + 0.05,
          cx + 0.95,
          cy + 0.95,
          BLOCK_TOP_Z,
          highContrast ? entry.highContrastPrimaryHex : entry.primaryHex,
          entry.lipHex,
          1.5
        );
      }
    }

    // 8. Draw Blocks, Multi-Layer Inner Cores, Ropes, Chains, Ice & All Badges
    const fallbackTimeSec = options.timeSec ?? (performance.now() - this.startTimeMs) * 0.001;
    const fallbackReducedMotion = Boolean(options.reducedMotion);
    for (const block of board.blocks) {
      if (block.status === 'CLEARED') continue;
      const shape = getShape(block.shapeId);
      const cId: ColorId = getActiveColor(block.colorStack, block.colorCursor);
      const entry = COLOR_PALETTE[cId] ?? COLOR_PALETTE[1];
      const layersLeft = getLayersRemaining(block.colorStack, block.colorCursor);
      const blockRoomId = getBlockRoomId(board, block);
      const blockRoomVis = this.getRoomVisualState(board, blockRoomId);
      const isIdleMovable =
        !fallbackReducedMotion &&
        !blockRoomVis.isLocked &&
        block.liftAlpha <= 0.05 &&
        block.iceCount === 0 &&
        !block.chained &&
        block.ropeColor === 0;
      const wave01 = isIdleMovable
        ? 0.5 +
          0.5 *
            Math.sin(
              fallbackTimeSec * 2.1 - (block.col * 0.68 + block.row * 0.54) + block.id * 0.55
            )
        : 0;
      const z =
        BLOCK_TOP_Z +
        blockRoomVis.zOffset +
        block.liftAlpha * BLOCK_LIFT_DELTA_Z +
        wave01 * 0.038;

      let drawX =
        block.x +
        (isIdleMovable && block.axisLock === 'H'
          ? Math.sin(fallbackTimeSec * 2.0 + block.id * 1.3) * 0.008
          : 0);
      let drawY =
        block.y +
        (isIdleMovable && block.axisLock === 'V'
          ? Math.sin(fallbackTimeSec * 2.0 + block.id * 1.3) * 0.008
          : 0);
      if (block.reboundTimerMs > 0) {
        block.reboundTimerMs = Math.max(0, block.reboundTimerMs - dtMs);
        const reboundT = block.reboundTimerMs / 200;
        if (block.shredGateIndex >= 0 && board.gates[block.shredGateIndex]) {
          const [nx, ny] = getGateOutwardNormal(board.gates[block.shredGateIndex].edge);
          const bounce = Math.sin(reboundT * Math.PI) * 0.14;
          drawX -= nx * bounce;
          drawY -= ny * bounce;
        } else {
          drawX += Math.sin(block.reboundTimerMs * 0.08) * 0.09 * reboundT;
        }
      }

      for (const [dr, dc] of shape.cells) {
        fillProjectedQuad(
          drawX + dc + 0.04,
          drawY + dr + 0.04,
          drawX + dc + 0.96,
          drawY + dr + 0.96,
          z,
          highContrast ? entry.highContrastPrimaryHex : entry.primaryHex,
          entry.lipHex,
          2
        );

        if (layersLeft > 1) {
          const innerId = block.colorStack[block.colorCursor + 1] ?? cId;
          const innerEntry = COLOR_PALETTE[innerId] ?? entry;
          fillProjectedQuad(
            drawX + dc + 0.18,
            drawY + dr + 0.18,
            drawX + dc + 0.82,
            drawY + dr + 0.82,
            z + 0.02,
            highContrast ? innerEntry.highContrastPrimaryHex : innerEntry.primaryHex,
            innerEntry.lipHex,
            1.5
          );
        }

        if (block.iceCount > 0) {
          fillProjectedQuad(
            drawX + dc + 0.03,
            drawY + dr + 0.03,
            drawX + dc + 0.97,
            drawY + dr + 0.97,
            z + 0.025,
            'rgba(125, 211, 252, 0.45)',
            '#E0F2FE',
            1.5
          );
        }
      }

      const first = shape.cells[0];
      if (colorblind || cId === 0) {
        drawCenteredText(
          entry.symbol,
          drawX + first[1] + 0.22,
          drawY + first[0] + 0.22,
          z + 0.03,
          '#FFFFFF'
        );
        if (colorblind && layersLeft > 1) {
          const innerId = block.colorStack[block.colorCursor + 1] ?? cId;
          drawCenteredText(
            COLOR_PALETTE[innerId].symbol,
            drawX + first[1] + 0.78,
            drawY + first[0] + 0.78,
            z + 0.03,
            '#FFFFFF',
            'bold 10px sans-serif'
          );
        }
      }

      const anchor = shape.cells[shape.anchorCellIndex] ?? shape.cells[0];
      const anchorCx = drawX + anchor[1] + 0.5;
      const anchorCy = drawY + anchor[0] + 0.5;

      if (block.ropeColor > 0) {
        const ropeEntry = COLOR_PALETTE[block.ropeColor];
        fillProjectedQuad(
          drawX + anchor[1] + 0.06,
          drawY + anchor[0] + 0.36,
          drawX + anchor[1] + 0.94,
          drawY + anchor[0] + 0.64,
          z + 0.028,
          ropeEntry.primaryHex,
          ropeEntry.lipHex,
          1.5
        );
      }

      if (block.chained) {
        fillProjectedQuad(
          drawX + anchor[1] + 0.08,
          drawY + anchor[0] + 0.4,
          drawX + anchor[1] + 0.92,
          drawY + anchor[0] + 0.6,
          z + 0.028,
          '#475569',
          '#0F172A',
          1.5
        );
      }

      if (block.axisLock === 'H') {
        fillProjectedQuad(
          drawX + 0.22,
          drawY + shape.rows * 0.5 - 0.16,
          drawX + shape.cols - 0.22,
          drawY + shape.rows * 0.5 + 0.16,
          z + 0.025,
          entry.lipHex,
          entry.highlightHex,
          1.5
        );
        drawCenteredText(
          '↔',
          drawX + shape.cols * 0.5,
          drawY + shape.rows * 0.5,
          z + 0.032,
          '#FFFDF9',
          'bold 15px sans-serif'
        );
      } else if (block.axisLock === 'V') {
        fillProjectedQuad(
          drawX + shape.cols * 0.5 - 0.16,
          drawY + 0.22,
          drawX + shape.cols * 0.5 + 0.16,
          drawY + shape.rows - 0.22,
          z + 0.025,
          entry.lipHex,
          entry.highlightHex,
          1.5
        );
        drawCenteredText(
          '↕',
          drawX + shape.cols * 0.5,
          drawY + shape.rows * 0.5,
          z + 0.032,
          '#FFFDF9',
          'bold 15px sans-serif'
        );
      }

      const hasImmobilizer = block.iceCount > 0 || block.chained;
      const hasPayload =
        (block.bombMax > 0 && block.bombCount > 0) ||
        block.hasKey > 0 ||
        block.scissorColor > 0 ||
        block.shutterGemColor > 0 ||
        block.isStar;

      let immCx = anchorCx;
      let immCy = anchorCy;
      let payCx = anchorCx;
      let payCy = anchorCy;
      if (hasImmobilizer && hasPayload) {
        if (shape.cells.length >= 2) {
          const sec = shape.cells[(shape.anchorCellIndex + 1) % shape.cells.length];
          payCx = drawX + sec[1] + 0.5;
          payCy = drawY + sec[0] + 0.5;
        } else {
          immCx = anchorCx - 0.16;
          immCy = anchorCy - 0.14;
          payCx = anchorCx + 0.16;
          payCy = anchorCy + 0.14;
        }
      }

      if (block.iceCount > 0) {
        drawCenteredText(`❄${block.iceCount}`, immCx, immCy, z + 0.04, '#E0F2FE');
      } else if (block.chained) {
        drawCenteredText('🔒', immCx, immCy, z + 0.04, '#FDE047');
      }

      if (block.bombMax > 0 && block.bombCount > 0) {
        drawCenteredText(`💣${block.bombCount}`, payCx, payCy, z + 0.04, '#FCA5A5');
      } else if (block.hasKey > 0) {
        drawCenteredText('🔑', payCx, payCy, z + 0.04, '#FDE047');
      } else if (block.scissorColor > 0) {
        drawCenteredText(
          '✂',
          payCx,
          payCy,
          z + 0.04,
          COLOR_PALETTE[block.scissorColor].primaryHex
        );
      } else if (block.shutterGemColor > 0) {
        drawCenteredText(
          '💎',
          payCx,
          payCy,
          z + 0.04,
          COLOR_PALETTE[block.shutterGemColor].primaryHex
        );
      } else if (block.isStar) {
        drawCenteredText('★', payCx, payCy, z + 0.04, '#FDE047');
      }
    }

    // 9. Draw Weld Clamps between adjacent blocks sharing `groupId > 0`
    for (let i = 0; i < board.blocks.length; i++) {
      const a = board.blocks[i];
      if (a.status !== 'ACTIVE' || a.groupId <= 0) continue;
      const shapeA = getShape(a.shapeId);
      for (let j = i + 1; j < board.blocks.length; j++) {
        const b = board.blocks[j];
        if (b.status !== 'ACTIVE' || b.groupId !== a.groupId) continue;
        const shapeB = getShape(b.shapeId);
        let clamped = false;
        for (const [ar, ac] of shapeA.cells) {
          if (clamped) break;
          const ax = a.x + ac;
          const ay = a.y + ar;
          for (const [br, bc] of shapeB.cells) {
            const bx = b.x + bc;
            const by = b.y + br;
            if (Math.abs(ax - bx) + Math.abs(ay - by) < 1.05) {
              const mx = (ax + bx) * 0.5 + 0.5;
              const my = (ay + by) * 0.5 + 0.5;
              fillProjectedQuad(
                mx - 0.16,
                my - 0.16,
                mx + 0.16,
                my + 0.16,
                BLOCK_TOP_Z + 0.03,
                '#CBD5E1',
                '#475569',
                1.5
              );
              clamped = true;
              break;
            }
          }
        }
      }
    }

    // 10. Draw Active 3D Particles
    for (let i = 0; i < this.activeParticleCount; i++) {
      const base = i * INSTANCE_STRIDE;
      const px = this.particleInstanceData[base + 0];
      const py = this.particleInstanceData[base + 1];
      const pz = this.particleInstanceData[base + 2];
      const pScale = this.particleInstanceData[base + 3];
      const pr = Math.round(this.particleInstanceData[base + 4] * 255);
      const pg = Math.round(this.particleInstanceData[base + 5] * 255);
      const pb = Math.round(this.particleInstanceData[base + 6] * 255);
      const pt = project(px, py, pz);
      const rad = Math.max(2, pScale * 28);
      ctx.fillStyle = `rgb(${pr}, ${pg}, ${pb})`;
      ctx.fillRect(pt.x - rad * 0.5, pt.y - rad * 0.5, rad, rad);
    }
  }

  public dispose(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.canvas.removeEventListener('webglcontextlost', this.onContextLostBound);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestoredBound);
    this.releaseWebGLResources();
  }
}
