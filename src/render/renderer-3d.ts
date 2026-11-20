import {
  type Benchmark120HzResult,
  type BlockState,
  type BoardState,
  COLOR_PALETTE,
  type ColorId,
  type GateState,
  type ParticleStyleId,
  type PerfTelemetry,
  type QualityTier,
  type SkinId,
  type TrayId,
} from '../core/types';
import { type AtlasTextureData, createAtlasTextureData } from './atlas-3d';
import {
  Camera3D,
  computeBoardBleedFraming,
  computeBoardTargetAspect,
  measureStageContentBox,
} from './camera-3d';
import { renderCanvas2DFallbackImpl } from './canvas2d-fallback';
import {
  bindMainProgramImpl,
  createGlProgramState,
  disposeGlProgramState,
  drawMeshInstancedWithStateCache,
  drawMeshWithStateCache,
  type GlProgramState,
  setClipPlaneStateImpl,
} from './gl-program-state';
import { ENVIRONMENT_MESHES, type MeshData } from './mesh-generator';
import {
  detectAutomaticShredEventsImpl,
  getRoomVisualStateImpl,
  spawnAmbientCourtyardMotesImpl,
  spawnBlockShredBurstImpl,
  spawnParticlesAtImpl,
  spawnShockwaveImpl,
  stepParticlesImpl,
} from './particle-fx';
import { renderPass1Courtyard } from './pass1-courtyard';
import { renderPass1WallsAndGates } from './pass1-gates-barriers';
import {
  renderPass1PortcullisBarriers,
  renderPass2ReticleAndPromptsImpl,
} from './pass2-barriers-and-reticles';
import { spawnPathTraceImpl } from './pass2-drag-fx';
import { renderPass3BlocksImpl } from './pass3-block-shells';
import {
  createEmptyParticleDrawHandles,
  disposeWebGLResourcesImpl,
  type ParticleDrawHandles,
  prepareWebGL2FrameStateImpl,
  renderPass4ParticlesImpl,
  resetTransientFxImpl,
  spawnRelicAwakeningBurstImpl,
  uploadAtlasAndStaticMeshesImpl,
  warmUpWebGLPipelinesImpl,
} from './relic-awakening-fx';
import {
  drawAtlasBadgeImpl,
  drawBadgeMedallion3DImpl,
  drawNumberBadgesImpl,
  executeBenchmarkFramesImpl,
  type GLMeshHandle,
  getMaterialStyleCodeForSkin,
  getParticleStyleCodeForId,
  HIGH_CONTRAST_TRAY_PALETTES,
  INSTANCE_STRIDE,
  MAX_PARTICLES,
  MAX_SMOKE_PUFFS,
  PARTICLE_STRIDE,
  QualityGovernor,
  type RelicFracturePlate,
  type RenderPassContext,
  type RenderSceneOptions,
  TRAY_PALETTES,
  type TrayPalette,
  type VisualGateBurst,
  type VisualPathTrace,
  type VisualShockwave,
  type VisualShredAnim,
} from './render-types';
import {
  createMeshHandle,
  createParticleInstancedVao,
  createShaderProgram,
  createSmokeBillboardInstancedVao,
  MAIN_FRAGMENT_SHADER,
  MAIN_VERTEX_SHADER,
  PARTICLE_FRAGMENT_SHADER,
  PARTICLE_VERTEX_SHADER,
  type ParticleInstancedVaoHandle,
  SOLID_OPAQUE_FRAGMENT_SHADER,
  SOLID_OPAQUE_VERTEX_SHADER,
} from './shaders-3d';
import { renderRelicPlatesWebGL2Impl } from './voronoi-plates';

export * from './render-types';

export class Renderer3D implements RenderPassContext {
  public readonly canvas: HTMLCanvasElement;
  public readonly camera: Camera3D;
  public readonly qualityGovernor: QualityGovernor;

  public gl: WebGL2RenderingContext | null = null;
  public ctx2d: CanvasRenderingContext2D | null = null;
  private contextLost = false;

  private mainProgram: WebGLProgram | null = null;
  private programState: GlProgramState | null = null;
  private particleProgram: WebGLProgram | null = null;
  private atlasTexture: WebGLTexture | null = null;
  private atlasData: AtlasTextureData;

  private meshHandles = new Map<MeshData, GLMeshHandle>();
  private particleHandle: ParticleInstancedVaoHandle | null = null;
  private smokeHandle: ParticleInstancedVaoHandle | null = null;

  // Exposed `mainProgram` uniform handles for custom FX passes (`MYSTIC-TRACE-01`, `PLASMA_ARCS`, shockwaves)
  public uCapColor: WebGLUniformLocation | null = null;
  public uTraceCount: WebGLUniformLocation | null = null;
  public uTracePts: WebGLUniformLocation | null = null;
  public uClipPlane: WebGLUniformLocation | null = null;
  public uUseClipPlane: WebGLUniformLocation | null = null;
  public uBlockSeed: WebGLUniformLocation | null = null;

  // Uniform locations for particle program
  private uPartViewProj: WebGLUniformLocation | null = null;
  private uPartStyle: WebGLUniformLocation | null = null;

  // Pre-allocated 2,048 particle pool (zero per-frame GC allocations)
  public readonly particlePool = new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE);
  public readonly particleInstanceData = new Float32Array(MAX_PARTICLES * INSTANCE_STRIDE);
  public readonly smokeInstanceData = new Float32Array(MAX_SMOKE_PUFFS * INSTANCE_STRIDE);
  public activeParticleCount = 0;
  public activeSmokeCount = 0;
  public readonly relicPlates: RelicFracturePlate[] = [];
  public activeRelicPlateCount = 0;
  public hasGameplayParticles = false;
  public particlePoolCount = 0;
  public particleWriteCursor = 0;

  // Automatic state diff tracking for automatic shred particle bursts, knock-on shockwaves, and bounces
  public lastBoardLevelId = -1;
  public lastSessionShredded = 0;
  public lastMovesCommitted = 0;
  public lastSyncedBoardRef: BoardState | null = null;
  public readonly blockLayerSnapshots: RenderPassContext['blockLayerSnapshots'] = new Map();
  public readonly crateSnapshots: RenderPassContext['crateSnapshots'] = new Map();
  public readonly gateSnapshots: RenderPassContext['gateSnapshots'] = new Map();
  public readonly elevatorSnapshots: RenderPassContext['elevatorSnapshots'] = new Map();
  public readonly barrierSnapshots: RenderPassContext['barrierSnapshots'] = new Map();
  public readonly roomAwakenMap = new Map<number, number>();
  public readonly activeVisualShreds: VisualShredAnim[] = [];
  public readonly activeShockwaves: VisualShockwave[] = [];
  public readonly activeGateBursts: VisualGateBurst[] = [];
  public readonly activePathTraces: VisualPathTrace[] = [];
  public readonly blockBounceMap = new Map<number, number>();
  public boardShakeTimer = 0;
  public boardShakeDirX = 0;
  public boardShakeDirY = 0;
  public ambientMoteAccumSec = 0;

  private resizeObserver: ResizeObserver | null = null;
  private currentDpr = 1;
  private lastAppliedMaxDpr = 0;
  private rawDevicePixelW = 0;
  private rawDevicePixelH = 0;
  private stageContentW = 0;
  private stageContentH = 0;
  private canvasCssW = 0;
  private canvasCssH = 0;
  private lastCanvasRect: DOMRect | null = null;
  private lastRectReadMs = 0;
  private lastAspectRows = 0;
  private lastAspectCols = 0;
  private lastBoard: BoardState | null = null;
  private readonly cachedParticleHandles: ParticleDrawHandles = createEmptyParticleDrawHandles();
  public lastOptions: RenderSceneOptions = {};
  public startTimeMs = performance.now();

  private readonly isPreview: boolean;
  private readonly onContextLostBound: (e: Event) => void;
  private readonly onContextRestoredBound: () => void;

  constructor(canvas: HTMLCanvasElement, opts?: { isPreview?: boolean }) {
    this.canvas = canvas;
    this.isPreview = Boolean(opts?.isPreview);
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
      this.qualityGovernor.resetWorkSamples();
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
    if (this.canvasCssW > 1) this.applyCanvasDpr(this.canvasCssW, this.canvasCssH);
  }
  public getEffectiveTrayPalette(trayId: TrayId, highContrast = false): TrayPalette {
    return highContrast
      ? (HIGH_CONTRAST_TRAY_PALETTES[trayId] ?? HIGH_CONTRAST_TRAY_PALETTES.industrial_slate)
      : (TRAY_PALETTES[trayId] ?? TRAY_PALETTES.industrial_slate);
  }

  public async run120HzBenchmark(frames = 120, board?: BoardState): Promise<Benchmark120HzResult> {
    if (board) {
      this.lastBoard = board;
    }
    return this.executeBenchmarkFrames(frames);
  }

  private async executeBenchmarkFrames(frames: number): Promise<Benchmark120HzResult> {
    return executeBenchmarkFramesImpl(this, this.lastBoard, frames);
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
        preserveDrawingBuffer: false,
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
      if (entry.contentRect.width <= 0 || entry.contentRect.height <= 0) {
        this.canvasCssW = 0;
        this.canvasCssH = 0;
        this.lastCanvasRect = null;
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      this.lastCanvasRect = rect;
      this.lastRectReadMs = performance.now();
      const cssEntryW = Math.max(1, rect.width || entry.contentRect.width);
      const cssEntryH = Math.max(1, rect.height || entry.contentRect.height);
      this.refreshStageMetrics(cssEntryW, cssEntryH);
      const dpc = (
        entry as ResizeObserverEntry & {
          devicePixelContentBoxSize?: ReadonlyArray<{ inlineSize: number; blockSize: number }>;
        }
      ).devicePixelContentBoxSize;
      this.rawDevicePixelW = dpc && dpc.length > 0 ? dpc[0].inlineSize : 0;
      this.rawDevicePixelH = dpc && dpc.length > 0 ? dpc[0].blockSize : 0;
      this.lastAppliedMaxDpr = 0;
      this.applyCanvasDpr(cssEntryW, cssEntryH);
      if (this.lastBoard) {
        this.render(this.lastBoard, this.lastOptions);
      }
    });

    const supportsDevicePixelContentBox =
      typeof ResizeObserverEntry !== 'undefined' &&
      'devicePixelContentBoxSize' in ResizeObserverEntry.prototype;
    try {
      this.resizeObserver.observe(
        this.canvas,
        supportsDevicePixelContentBox ? { box: 'device-pixel-content-box' } : {}
      );
    } catch {
      this.resizeObserver.observe(this.canvas);
    }
  }

  private refreshStageMetrics(cssW: number, cssH: number): void {
    this.canvasCssW = cssW;
    this.canvasCssH = cssH;
    [this.stageContentW, this.stageContentH] = measureStageContentBox(this.canvas, cssW, cssH);
  }

  private computeEffectiveDpr(cssW: number, cssH: number): { dpr: number; rawDpr: number } {
    const govMaxDpr = this.qualityGovernor.getTargetMaxDpr();
    const maxDpr = this.isPreview ? Math.min(govMaxDpr, 2.0) : govMaxDpr;
    const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const f = computeBoardBleedFraming(
      this.lastBoard?.rows ?? 6,
      this.lastBoard?.cols ?? 6,
      cssW,
      cssH,
      this.stageContentW,
      this.stageContentH
    );
    const boardMaxCss = Math.max(1, cssW * f.scaleX, cssH * f.scaleY);
    const canvasMaxCss = Math.max(1, cssW, cssH);
    const dpr = Math.min(maxDpr, rawDpr, Math.max(1, Math.min(900 / boardMaxCss, 1024 / canvasMaxCss)));
    this.currentDpr = dpr;
    this.qualityGovernor.setDpr(dpr);
    return { dpr, rawDpr };
  }

  private applyCanvasDpr(cssW: number, cssH: number): void {
    const govMaxDpr = this.qualityGovernor.getTargetMaxDpr();
    const maxDpr = this.isPreview ? Math.min(govMaxDpr, 2.0) : govMaxDpr;
    if (maxDpr === this.lastAppliedMaxDpr && this.canvas.width >= 64 && this.canvas.height >= 64) {
      return;
    }
    const { dpr, rawDpr } = this.computeEffectiveDpr(cssW, cssH);
    const scaleCap = rawDpr > dpr ? dpr / rawDpr : 1;
    const targetW = Math.max(
      64,
      this.rawDevicePixelW > 0 ? Math.round(this.rawDevicePixelW * scaleCap) : Math.round(cssW * dpr)
    );
    const targetH = Math.max(
      64,
      this.rawDevicePixelH > 0 ? Math.round(this.rawDevicePixelH * scaleCap) : Math.round(cssH * dpr)
    );
    this.lastAppliedMaxDpr = maxDpr;
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }
  }

  /** Reclaims WebGL2 color/depth/MSAA backbuffer VRAM while a preview canvas is offscreen (`PERF-GPU-01`). */
  public releaseBackbufferForSuspend(): void {
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.lastAppliedMaxDpr = 0;
  }

  public resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.lastCanvasRect = rect;
    this.lastRectReadMs = performance.now();
    if ((rect.width <= 0 || rect.height <= 0) && this.canvas.isConnected) {
      this.canvasCssW = 0;
      this.canvasCssH = 0;
      return;
    }
    const cssW = rect.width > 0 ? rect.width : this.canvas.clientWidth || this.canvas.width || 640;
    const cssH = rect.height > 0 ? rect.height : this.canvas.clientHeight || this.canvas.height || 640;
    this.rawDevicePixelW = 0;
    this.rawDevicePixelH = 0;
    this.lastAppliedMaxDpr = 0;
    this.refreshStageMetrics(cssW, cssH);
    this.applyCanvasDpr(cssW, cssH);
  }

  private releaseWebGLResources(): void {
    disposeGlProgramState(this.gl, this.programState);
    this.programState = null;
    disposeWebGLResourcesImpl(
      this.gl,
      this.meshHandles,
      this.particleHandle,
      this.smokeHandle,
      this.atlasTexture,
      this.mainProgram,
      this.particleProgram
    );
    this.particleHandle = null;
    this.smokeHandle = null;
    this.atlasTexture = null;
    this.mainProgram = null;
    this.particleProgram = null;
  }

  private initWebGLResources(): void {
    const gl = this.gl;
    if (!gl) return;

    this.releaseWebGLResources();

    const mainProg = createShaderProgram(gl, MAIN_VERTEX_SHADER, MAIN_FRAGMENT_SHADER);
    const solidProg = createShaderProgram(gl, SOLID_OPAQUE_VERTEX_SHADER, SOLID_OPAQUE_FRAGMENT_SHADER);
    const partProg = createShaderProgram(gl, PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER);

    if (!mainProg || !partProg) {
      if (mainProg) gl.deleteProgram(mainProg);
      if (solidProg) gl.deleteProgram(solidProg);
      if (partProg) gl.deleteProgram(partProg);
      this.gl = null;
      this.ctx2d = this.canvas.getContext('2d');
      this.qualityGovernor.setBackend('CANVAS2D');
      return;
    }

    this.mainProgram = mainProg;
    this.particleProgram = partProg;
    this.programState = createGlProgramState(gl, mainProg, solidProg);
    const mu = this.programState.mainUniforms;
    this.uCapColor = mu.uCapColor;
    this.uClipPlane = mu.uClipPlane;
    this.uUseClipPlane = mu.uUseClipPlane;
    this.uBlockSeed = mu.uBlockSeed;
    this.uTraceCount = mu.uTraceCount;
    this.uTracePts = mu.uTracePts;

    this.uPartViewProj = gl.getUniformLocation(partProg, 'u_viewProj');
    this.uPartStyle = gl.getUniformLocation(partProg, 'u_particleStyle');

    this.atlasTexture = uploadAtlasAndStaticMeshesImpl(gl, this.atlasData.canvas, (g, m) =>
      this.getOrCreateMeshHandle(g, m)
    );

    // Setup GPU-instanced particle & smoke quad VAOs + pre-warm Vulkan/Adreno PSOs
    this.particleHandle = createParticleInstancedVao(gl, this.particleInstanceData.byteLength);
    this.smokeHandle = createSmokeBillboardInstancedVao(gl, this.smokeInstanceData.byteLength);
    warmUpWebGLPipelinesImpl(
      this,
      gl,
      this.programState,
      this.atlasTexture,
      this.getParticleDrawHandles(),
      this.getOrCreateMeshHandle(gl, ENVIRONMENT_MESHES.overlayQuad),
      this.isPreview
    );
  }

  private getParticleDrawHandles(): ParticleDrawHandles {
    const h = this.cachedParticleHandles;
    h.program = this.particleProgram;
    h.vao = this.particleHandle?.vao ?? null;
    h.instanceBuffer = this.particleHandle?.instBuf ?? null;
    h.indexCount = this.particleHandle?.indexCount ?? 0;
    h.smokeVao = this.smokeHandle?.vao ?? null;
    h.smokeInstanceBuffer = this.smokeHandle?.instBuf ?? null;
    h.smokeIndexCount = this.smokeHandle?.indexCount ?? 0;
    h.uViewProj = this.uPartViewProj;
    h.uStyle = this.uPartStyle;
    return h;
  }

  private getOrCreateMeshHandle(gl: WebGL2RenderingContext, mesh: MeshData): GLMeshHandle {
    const existing = this.meshHandles.get(mesh);
    if (existing) return existing;
    const handle = createMeshHandle(gl, mesh);
    this.meshHandles.set(mesh, handle);
    return handle;
  }

  private syncRectAndFraming(rows: number, cols: number) {
    const now = performance.now();
    if (!this.lastCanvasRect || this.lastCanvasRect.width <= 0 || now - this.lastRectReadMs > 250) {
      this.lastCanvasRect = this.canvas.getBoundingClientRect();
      this.lastRectReadMs = now;
    }
    const rect = this.lastCanvasRect;
    if (
      rect.width > 0 &&
      (Math.abs(rect.width - this.canvasCssW) > 0.5 || Math.abs(rect.height - this.canvasCssH) > 0.5)
    ) {
      this.refreshStageMetrics(rect.width, rect.height);
    }
    return {
      rect,
      f: computeBoardBleedFraming(
        rows,
        cols,
        rect.width,
        rect.height,
        this.stageContentW,
        this.stageContentH
      ),
    };
  }

  public screenToBoard(clientX: number, clientY: number, rows: number, cols: number) {
    const { rect, f } = this.syncRectAndFraming(rows, cols);
    return this.camera.screenToBoardRayPlane(
      clientX,
      clientY,
      rect,
      rows,
      cols,
      f.scaleX,
      f.scaleY,
      f.boardAspect
    );
  }

  public boardToScreen(boardX: number, boardY: number, worldZ: number, rows: number, cols: number) {
    const { rect, f } = this.syncRectAndFraming(rows, cols);
    return this.camera.boardToScreen(
      boardX,
      boardY,
      worldZ,
      rect,
      rows,
      cols,
      f.scaleX,
      f.scaleY,
      f.boardAspect
    );
  }

  public spawnParticlesAt(...args: Parameters<RenderPassContext['spawnParticlesAt']>): void {
    spawnParticlesAtImpl(this, ...args);
  }

  public spawnShockwave(...args: Parameters<RenderPassContext['spawnShockwave']>): void {
    spawnShockwaveImpl(this, ...args);
  }

  public spawnPathTrace(...args: Parameters<RenderPassContext['spawnPathTrace']>): void {
    spawnPathTraceImpl(this, ...args);
  }

  public spawnRelicAwakeningBurst(board: BoardState): void {
    spawnRelicAwakeningBurstImpl(this, board);
  }

  public spawnBlockShredBurst(board: BoardState, block: BlockState, gate?: GateState, color?: ColorId): void {
    spawnBlockShredBurstImpl(this, board, block, gate, color);
  }
  public stepParticles(dtSec: number): void {
    stepParticlesImpl(this, dtSec);
  }
  public getRoomVisualState(board: BoardState, roomId: number) {
    return getRoomVisualStateImpl(this, board, roomId);
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

    const boardDimsChanged = board.rows !== this.lastAspectRows || board.cols !== this.lastAspectCols;
    if (boardDimsChanged || this.canvasCssW <= 1) {
      this.canvas.style.setProperty(
        '--board-aspect',
        computeBoardTargetAspect(board.rows, board.cols).toFixed(4)
      );
      this.resize();
      if (this.canvasCssW > 1) {
        this.lastAspectRows = board.rows;
        this.lastAspectCols = board.cols;
      }
    } else {
      this.applyCanvasDpr(this.canvasCssW, this.canvasCssH);
    }

    const dtSec = options.dtSec ?? 1 / 60;
    const timeSec = options.timeSec ?? (performance.now() - this.startTimeMs) * 0.001;
    detectAutomaticShredEventsImpl(this, board, options);
    spawnAmbientCourtyardMotesImpl(this, board, options, dtSec, timeSec);
    this.stepParticles(dtSec);

    const cssW = this.canvasCssW > 1 ? this.canvasCssW : Math.max(1, this.canvas.width / this.currentDpr);
    const cssH = this.canvasCssH > 1 ? this.canvasCssH : Math.max(1, this.canvas.height / this.currentDpr);
    const f = computeBoardBleedFraming(
      board.rows,
      board.cols,
      cssW,
      cssH,
      this.stageContentW,
      this.stageContentH
    );
    this.camera.setBoardAndViewport(board.rows, board.cols, f.boardAspect, f.scaleX, f.scaleY);

    if (this.gl && !this.contextLost && this.mainProgram && this.particleProgram) {
      this.renderWebGL2(board, options, dtSec);
    } else if (this.ctx2d) {
      renderCanvas2DFallbackImpl(this, board, options, dtSec);
    }

    const nowMs = performance.now();
    this.qualityGovernor.recordFrameWork(nowMs - frameStart, nowMs, false);
  }

  public resetTransientFx(): void {
    resetTransientFxImpl(this);
  }

  public getColorRgb(
    colorId: ColorId,
    highContrast = false,
    colorblind = Boolean(this.lastOptions.colorblindSymbols)
  ): [number, number, number] {
    const e = COLOR_PALETTE[colorId] ?? COLOR_PALETTE[0];
    return colorblind ? (highContrast ? e.cbHcRgb : e.cbRgb) : highContrast ? e.hcRgb : e.rgb;
  }

  public getMaterialStyleCode(skin: SkinId = 'classic_studs'): number {
    return getMaterialStyleCodeForSkin(skin);
  }

  public useMainProgram(gl: WebGL2RenderingContext): void {
    if (this.programState) bindMainProgramImpl(gl, this.programState);
  }

  public setClipPlaneState(...args: Parameters<NonNullable<RenderPassContext['setClipPlaneState']>>): void {
    if (this.programState) {
      const [gl, enabled, nx = 0, ny = 0, nz = 1, d = 0, capR = 0.2, capG = 0.2, capB = 0.2] = args;
      setClipPlaneStateImpl(gl, this.programState, enabled, nx, ny, nz, d, capR, capG, capB);
    }
  }

  public setBlockSeed(seed: number): void {
    if (this.programState) this.programState.currentBlockSeed = seed;
  }

  public drawMesh(...args: Parameters<RenderPassContext['drawMesh']>): void {
    if (!this.programState) return;
    const [gl, mesh, tx, ty, tz, sx, sy, sz, r, g, b, a = 1, rotX = 0, rotZ = 0, style = 0, uv = null] = args;
    drawMeshWithStateCache(
      gl,
      this.programState,
      this.getOrCreateMeshHandle(gl, mesh),
      tx,
      ty,
      tz,
      sx,
      sy,
      sz,
      r,
      g,
      b,
      a,
      rotX,
      rotZ,
      style,
      uv
    );
  }

  public drawMeshInstanced(
    gl: WebGL2RenderingContext,
    mesh: MeshData,
    instanceData: Float32Array,
    instanceCount: number,
    alpha = 1.0,
    materialStyle = 0
  ): void {
    if (!this.programState || instanceCount <= 0) return;
    drawMeshInstancedWithStateCache(
      gl,
      this.programState,
      mesh,
      this.getOrCreateMeshHandle(gl, mesh),
      instanceData,
      instanceCount,
      alpha,
      materialStyle
    );
  }

  public drawAtlasBadge(...args: Parameters<RenderPassContext['drawAtlasBadge']>): void {
    drawAtlasBadgeImpl(this, this.atlasData, ...args);
  }

  public clearPathTraces(): void {
    this.activePathTraces.length = 0;
    this.activeGateBursts.length = 0;
  }

  public drawNumberBadges(...args: Parameters<RenderPassContext['drawNumberBadges']>): void {
    drawNumberBadgesImpl(this, ...args);
  }

  public drawBadgeMedallion3D(...args: Parameters<RenderPassContext['drawBadgeMedallion3D']>): number {
    return drawBadgeMedallion3DImpl(this, ...args);
  }

  private renderWebGL2(board: BoardState, options: RenderSceneOptions, dtSec = 1 / 60): void {
    const gl = this.gl;
    if (!gl || !this.programState) return;
    const trayId = options.equippedTray ?? 'industrial_slate';
    const skinId = options.equippedSkin ?? 'classic_studs';
    const highContrast = Boolean(options.highContrast);
    const colorblind = Boolean(options.colorblindSymbols);
    const palette = this.getEffectiveTrayPalette(trayId, highContrast);
    const timeSec = options.timeSec ?? (performance.now() - this.startTimeMs) * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 6.0);
    const blueprintMix = Math.max(0, Math.min(1, options.blueprintMix ?? 0));
    prepareWebGL2FrameStateImpl(
      this,
      gl,
      this.programState,
      this.atlasTexture,
      board,
      trayId,
      skinId,
      highContrast,
      Boolean(options.reducedMotion),
      timeSec,
      blueprintMix
    );

    // PASS 1..4: Courtyard, Gates & Barriers, Reticles, Blocks, and GPU-Instanced Particles
    renderPass1Courtyard(this, gl, board, palette, highContrast, colorblind, timeSec);
    renderPass1WallsAndGates(this, gl, board, palette, highContrast, colorblind, timeSec);
    renderPass1PortcullisBarriers(this, gl, board, palette, timeSec);
    renderPass2ReticleAndPromptsImpl(this, gl, board, options, highContrast, pulse);
    renderPass3BlocksImpl(this, gl, board, options, skinId, highContrast, colorblind, pulse, timeSec, dtSec);
    if (blueprintMix < 0.999 && this.activeRelicPlateCount > 0) {
      renderRelicPlatesWebGL2Impl(this, gl, this.mainProgram);
    }
    if (blueprintMix < 0.999 && this.activeParticleCount + this.activeSmokeCount > 0) {
      renderPass4ParticlesImpl(
        this,
        gl,
        this.getParticleDrawHandles(),
        this.getParticleStyleCode(options.equippedParticle ?? 'micro_cubes')
      );
    }
  }

  public getParticleStyleCode(style: ParticleStyleId = 'micro_cubes'): number {
    return getParticleStyleCodeForId(style);
  }

  public dispose(): void {
    this.resetTransientFx();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.canvas.removeEventListener('webglcontextlost', this.onContextLostBound);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestoredBound);
    this.releaseWebGLResources();
  }
}
