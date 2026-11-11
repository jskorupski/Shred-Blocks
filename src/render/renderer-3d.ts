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
import { type AtlasTextureData, type AtlasUVRegion, createAtlasTextureData } from './atlas-3d';
import { Camera3D } from './camera-3d';
import { renderCanvas2DFallbackImpl } from './canvas2d-fallback';
import { ENVIRONMENT_MESHES, type MeshData, POLYOMINO_MESH_CATALOG } from './mesh-generator';
import {
  detectAutomaticShredEventsImpl,
  getRoomVisualStateImpl,
  spawnAmbientCourtyardMotesImpl,
  spawnBlockShredBurstImpl,
  spawnParticlesAtImpl,
  spawnShockwaveImpl,
  spawnVictoryCelebrationBurstImpl,
  stepParticlesImpl,
} from './particle-fx';
import { renderPass1Courtyard } from './pass1-courtyard';
import { renderPass1WallsAndGates } from './pass1-gates-barriers';
import {
  renderPass1PortcullisBarriers,
  renderPass2ReticleAndPromptsImpl,
} from './pass2-barriers-and-reticles';
import { renderPass3BlocksImpl } from './pass3-block-shells';
import {
  renderPass4ParticlesImpl,
  spawnRelicAwakeningBurstImpl,
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
  getStoneThemeMineralTint,
  getTrayMaterialCode,
  HIGH_CONTRAST_TRAY_PALETTES,
  INSTANCE_STRIDE,
  MAX_PARTICLES,
  MAX_SMOKE_PUFFS,
  PARTICLE_STRIDE,
  QualityGovernor,
  type RenderPassContext,
  type RenderSceneOptions,
  TRAY_PALETTES,
  type TrayPalette,
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
} from './shaders-3d';

export * from './render-types';

export class Renderer3D implements RenderPassContext {
  public readonly canvas: HTMLCanvasElement;
  public readonly camera: Camera3D;
  public readonly qualityGovernor: QualityGovernor;

  public gl: WebGL2RenderingContext | null = null;
  public ctx2d: CanvasRenderingContext2D | null = null;
  private contextLost = false;

  private mainProgram: WebGLProgram | null = null;
  private particleProgram: WebGLProgram | null = null;
  private atlasTexture: WebGLTexture | null = null;
  private atlasData: AtlasTextureData;

  private meshHandles = new Map<MeshData, GLMeshHandle>();
  private particleHandle: ParticleInstancedVaoHandle | null = null;
  private smokeHandle: ParticleInstancedVaoHandle | null = null;

  // Uniform locations for main program
  private uViewProj: WebGLUniformLocation | null = null;
  private uTranslate: WebGLUniformLocation | null = null;
  private uScale: WebGLUniformLocation | null = null;
  private uRotX: WebGLUniformLocation | null = null;
  private uRotZ: WebGLUniformLocation | null = null;
  private uUvRect: WebGLUniformLocation | null = null;
  private uColor: WebGLUniformLocation | null = null;
  public uCapColor: WebGLUniformLocation | null = null;
  public uClipPlane: WebGLUniformLocation | null = null;
  public uUseClipPlane: WebGLUniformLocation | null = null;
  public uBlockSeed: WebGLUniformLocation | null = null;
  private uUseTexture: WebGLUniformLocation | null = null;
  private uMaterialStyle: WebGLUniformLocation | null = null;
  private uAtlas: WebGLUniformLocation | null = null;
  private uBlueprintMix: WebGLUniformLocation | null = null;
  private uBoardInfo: WebGLUniformLocation | null = null;
  private uStoneTint: WebGLUniformLocation | null = null;
  private uTrayMaterial: WebGLUniformLocation | null = null;
  private uHighContrast: WebGLUniformLocation | null = null;

  // Uniform locations for particle program
  private uPartViewProj: WebGLUniformLocation | null = null;
  private uPartStyle: WebGLUniformLocation | null = null;

  // Pre-allocated 2,048 particle pool (zero per-frame GC allocations)
  public readonly particlePool = new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE);
  public readonly particleInstanceData = new Float32Array(MAX_PARTICLES * INSTANCE_STRIDE);
  public readonly smokeInstanceData = new Float32Array(MAX_SMOKE_PUFFS * INSTANCE_STRIDE);
  public activeParticleCount = 0;
  public activeSmokeCount = 0;
  public particlePoolCount = 0;
  public particleWriteCursor = 0;

  // Automatic state diff tracking for automatic shred particle bursts, knock-on shockwaves, and bounces
  public lastBoardLevelId = -1;
  public lastSessionShredded = 0;
  public lastMovesCommitted = 0;
  public readonly blockLayerSnapshots: RenderPassContext['blockLayerSnapshots'] = new Map();
  public readonly crateSnapshots: RenderPassContext['crateSnapshots'] = new Map();
  public readonly gateSnapshots: RenderPassContext['gateSnapshots'] = new Map();
  public readonly elevatorSnapshots: RenderPassContext['elevatorSnapshots'] = new Map();
  public readonly barrierSnapshots: RenderPassContext['barrierSnapshots'] = new Map();
  public readonly roomAwakenMap = new Map<number, number>();
  public readonly activeVisualShreds: VisualShredAnim[] = [];
  public readonly activeShockwaves: VisualShockwave[] = [];
  public readonly blockBounceMap = new Map<number, number>();
  public boardShakeTimer = 0;
  public boardShakeDirX = 0;
  public boardShakeDirY = 0;
  public ambientMoteAccumSec = 0;

  private resizeObserver: ResizeObserver | null = null;
  private currentDpr = 1;
  private lastAspectRows = 0;
  private lastAspectCols = 0;
  private lastBoard: BoardState | null = null;
  public lastOptions: RenderSceneOptions = {};
  public startTimeMs = performance.now();

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
          : Math.round(
              entry.contentRect.width * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
            );
      const rawPixelH =
        dpc && dpc.length > 0
          ? dpc[0].blockSize
          : Math.round(
              entry.contentRect.height * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
            );

      const scaleCap = rawDpr > maxDpr ? maxDpr / rawDpr : 1;
      const targetW = Math.max(64, Math.round(rawPixelW * scaleCap));
      const targetH = Math.max(64, Math.round(rawPixelH * scaleCap));

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
      for (const h of [this.particleHandle, this.smokeHandle]) {
        if (!h) continue;
        gl.deleteVertexArray(h.vao);
        gl.deleteBuffer(h.posBuf);
        gl.deleteBuffer(h.normBuf);
        gl.deleteBuffer(h.idxBuf);
        gl.deleteBuffer(h.instBuf);
      }
      if (this.atlasTexture) gl.deleteTexture(this.atlasTexture);
      if (this.mainProgram) gl.deleteProgram(this.mainProgram);
      if (this.particleProgram) gl.deleteProgram(this.particleProgram);
    }

    this.meshHandles.clear();
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
    const partProg = createShaderProgram(gl, PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER);

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
    this.uBlockSeed = gl.getUniformLocation(mainProg, 'u_blockSeed');
    this.uUseTexture = gl.getUniformLocation(mainProg, 'u_useTexture');
    this.uMaterialStyle = gl.getUniformLocation(mainProg, 'u_materialStyle');
    this.uAtlas = gl.getUniformLocation(mainProg, 'u_atlas');
    this.uBlueprintMix = gl.getUniformLocation(mainProg, 'u_blueprintMix');
    this.uBoardInfo = gl.getUniformLocation(mainProg, 'u_boardInfo');
    this.uStoneTint = gl.getUniformLocation(mainProg, 'u_stoneTint');
    this.uTrayMaterial = gl.getUniformLocation(mainProg, 'u_trayMaterial');
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
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlasData.canvas);
    }

    // Pre-upload static polyomino meshes (standard, studded, worn stone) + environment meshes
    for (const entry of Object.values(POLYOMINO_MESH_CATALOG)) {
      this.getOrCreateMeshHandle(gl, entry.meshOuter);
      this.getOrCreateMeshHandle(gl, entry.meshInnerCore);
      this.getOrCreateMeshHandle(gl, entry.meshOuterStudded);
      this.getOrCreateMeshHandle(gl, entry.meshInnerCoreStudded);
      this.getOrCreateMeshHandle(gl, entry.meshOuterWorn);
      this.getOrCreateMeshHandle(gl, entry.meshInnerCoreWorn);
    }
    for (const envMesh of Object.values(ENVIRONMENT_MESHES) as MeshData[]) {
      this.getOrCreateMeshHandle(gl, envMesh);
    }

    // Setup GPU-instanced particle & smoke quad VAOs + pre-warm Vulkan/Adreno PSOs
    this.particleHandle = createParticleInstancedVao(gl, this.particleInstanceData.byteLength);
    this.smokeHandle = createSmokeBillboardInstancedVao(gl, this.smokeInstanceData.byteLength);
    warmUpWebGLPipelinesImpl(
      this,
      gl,
      mainProg,
      this.uViewProj,
      this.uBlueprintMix,
      this.uAtlas,
      this.atlasTexture,
      this.getParticleDrawHandles()
    );
  }

  private getParticleDrawHandles() {
    return {
      program: this.particleProgram,
      vao: this.particleHandle?.vao ?? null,
      instanceBuffer: this.particleHandle?.instBuf ?? null,
      indexCount: this.particleHandle?.indexCount ?? 0,
      smokeVao: this.smokeHandle?.vao ?? null,
      smokeInstanceBuffer: this.smokeHandle?.instBuf ?? null,
      smokeIndexCount: this.smokeHandle?.indexCount ?? 0,
      uViewProj: this.uPartViewProj,
      uStyle: this.uPartStyle,
    };
  }

  private getOrCreateMeshHandle(gl: WebGL2RenderingContext, mesh: MeshData): GLMeshHandle {
    const existing = this.meshHandles.get(mesh);
    if (existing) return existing;
    const handle = createMeshHandle(gl, mesh);
    this.meshHandles.set(mesh, handle);
    return handle;
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
    spawnParticlesAtImpl(this, worldX, worldY, worldZ, colorId, count, dirX, dirY, particleStyle);
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
    spawnShockwaveImpl(this, cx, cy, z, r, g, b, minRadius, maxRadius, maxAge);
  }

  public spawnVictoryCelebrationBurst(board: BoardState): void {
    spawnVictoryCelebrationBurstImpl(this, board);
  }

  public spawnRelicAwakeningBurst(board: BoardState): void {
    spawnRelicAwakeningBurstImpl(this, board);
  }

  public spawnBlockShredBurst(
    board: BoardState,
    block: BlockState,
    gate?: GateState,
    colorOverride?: ColorId
  ): void {
    spawnBlockShredBurstImpl(this, board, block, gate, colorOverride);
  }

  public stepParticles(dtSec: number): void {
    stepParticlesImpl(this, dtSec);
  }

  public getRoomVisualState(
    board: BoardState,
    roomId: number
  ): { zOffset: number; luminanceMul: number; isLocked: boolean } {
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

    const maxDpr = this.qualityGovernor.getTargetMaxDpr();
    const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const expectedDpr = Math.min(maxDpr, rawDpr);
    const boardDimsChanged = board.rows !== this.lastAspectRows || board.cols !== this.lastAspectCols;
    if (boardDimsChanged) {
      this.lastAspectRows = board.rows;
      this.lastAspectCols = board.cols;
      const targetAspect =
        board.rows === board.cols
          ? 1
          : Math.max(0.65, Math.min(1.25, (board.cols + 1.55) / (board.rows + 1.55)));
      this.canvas.style.setProperty('--board-aspect', targetAspect.toFixed(4));
      this.resize();
    } else if (Math.abs(expectedDpr - this.currentDpr) > 0.01) {
      this.resize();
    }

    const dtSec = options.dtSec ?? 1 / 60;
    const timeSec = options.timeSec ?? (performance.now() - this.startTimeMs) * 0.001;
    detectAutomaticShredEventsImpl(this, board, options);
    spawnAmbientCourtyardMotesImpl(this, board, options, dtSec, timeSec);
    this.stepParticles(dtSec);

    const aspect =
      this.canvas.width > 0 && this.canvas.height > 0 ? this.canvas.width / this.canvas.height : 1;
    this.camera.setBoardAndViewport(board.rows, board.cols, aspect);

    if (this.gl && !this.contextLost && this.mainProgram && this.particleProgram) {
      this.renderWebGL2(board, options, dtSec);
    } else if (this.ctx2d) {
      renderCanvas2DFallbackImpl(this, board, options, dtSec);
    }

    const nowMs = performance.now();
    const workDurationMs = nowMs - frameStart;
    this.qualityGovernor.recordFrameWork(workDurationMs, nowMs);
  }

  /** VISUAL-GOLDEN-01: drop all in-flight particles, motes, shockwaves, bounces & shakes for deterministic frames */
  public resetTransientFx(): void {
    this.activeParticleCount = 0;
    this.activeSmokeCount = 0;
    this.particlePoolCount = 0;
    this.particleWriteCursor = 0;
    this.activeShockwaves.length = 0;
    this.activeVisualShreds.length = 0;
    this.blockBounceMap.clear();
    this.boardShakeTimer = 0;
    this.ambientMoteAccumSec = 0;
  }

  public getColorRgb(colorId: ColorId, highContrast = false): [number, number, number] {
    const entry = COLOR_PALETTE[colorId] ?? COLOR_PALETTE[0];
    return highContrast ? entry.hcRgb : entry.rgb;
  }

  public getMaterialStyleCode(skin: SkinId = 'classic_studs'): number {
    return getMaterialStyleCodeForSkin(skin);
  }

  public drawMesh(
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

  public drawAtlasBadge(
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
    drawAtlasBadgeImpl(this, this.atlasData, gl, regionKey, cx, cy, z, size, r, g, b, a);
  }

  public drawNumberBadges(
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
    drawNumberBadgesImpl(this, gl, value, cx, cy, z, digitSize, r, g, b);
  }

  public drawBadgeMedallion3D(
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
    return drawBadgeMedallion3DImpl(
      this,
      gl,
      cx,
      cy,
      zBase,
      width,
      height,
      faceR,
      faceG,
      faceB,
      rimR,
      rimG,
      rimB
    );
  }

  private renderWebGL2(board: BoardState, options: RenderSceneOptions, dtSec = 1 / 60): void {
    const gl = this.gl;
    if (!gl) return;
    const trayId = options.equippedTray ?? 'industrial_slate';
    const skinId = options.equippedSkin ?? 'classic_studs';
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
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const blueprintMix = Math.max(0, Math.min(1, options.blueprintMix ?? 0));
    const stoneTint = getStoneThemeMineralTint(trayId, skinId);
    gl.useProgram(this.mainProgram);
    gl.uniformMatrix4fv(this.uViewProj, false, this.camera.getViewProjectionMatrix(false));
    gl.uniform1i(this.uUseClipPlane, 0);
    gl.uniform1f(this.uBlockSeed, 0);
    gl.uniform4f(this.uClipPlane, 0, 0, 1, 0);
    gl.uniform3f(this.uCapColor, 0.2, 0.2, 0.2);
    gl.uniform1f(this.uBlueprintMix, blueprintMix);
    gl.uniform3f(this.uBoardInfo, board.cols * 0.5, board.rows * 0.5, options.reducedMotion ? -1.0 : timeSec);
    gl.uniform3f(this.uStoneTint, stoneTint[0], stoneTint[1], stoneTint[2]);
    gl.uniform1i(this.uTrayMaterial, getTrayMaterialCode(trayId));
    gl.uniform1i(this.uHighContrast, highContrast ? 1 : 0);

    if (this.atlasTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
      gl.uniform1i(this.uAtlas, 0);
    }

    // PASS 1..4: Courtyard, Gates & Barriers, Reticles, Blocks, and GPU-Instanced Particles
    renderPass1Courtyard(this, gl, board, palette, highContrast, colorblind, timeSec);
    renderPass1WallsAndGates(this, gl, board, palette, highContrast, colorblind, timeSec);
    renderPass1PortcullisBarriers(this, gl, board, palette, timeSec);
    renderPass2ReticleAndPromptsImpl(this, gl, board, options, highContrast, pulse);
    renderPass3BlocksImpl(this, gl, board, options, skinId, highContrast, colorblind, pulse, timeSec, dtSec);
    if (blueprintMix < 0.999) {
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
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.canvas.removeEventListener('webglcontextlost', this.onContextLostBound);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestoredBound);
    this.releaseWebGLResources();
  }
}
