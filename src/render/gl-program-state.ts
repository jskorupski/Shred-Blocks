import type { AtlasUVRegion } from './atlas-3d';
import type { MeshData } from './mesh-generator';
import { type GLMeshHandle, setGlBlendEnabled } from './render-types';

/** Floats per instance for `drawMeshInstanced`: `(tx, ty, tz, sx, sy, sz, r, g, b)`. */
export const MESH_INSTANCE_STRIDE = 9;

export interface MainProgramUniforms {
  uViewProj: WebGLUniformLocation | null;
  uTranslate: WebGLUniformLocation | null;
  uScale: WebGLUniformLocation | null;
  uRotX: WebGLUniformLocation | null;
  uRotZ: WebGLUniformLocation | null;
  uUvRect: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uCapColor: WebGLUniformLocation | null;
  uClipPlane: WebGLUniformLocation | null;
  uUseClipPlane: WebGLUniformLocation | null;
  uBlockSeed: WebGLUniformLocation | null;
  uUseTexture: WebGLUniformLocation | null;
  uMaterialStyle: WebGLUniformLocation | null;
  uAtlas: WebGLUniformLocation | null;
  uBlueprintMix: WebGLUniformLocation | null;
  uBoardInfo: WebGLUniformLocation | null;
  uStoneTint: WebGLUniformLocation | null;
  uTrayMaterial: WebGLUniformLocation | null;
  uHighContrast: WebGLUniformLocation | null;
  uTraceCount: WebGLUniformLocation | null;
  uTracePts: WebGLUniformLocation | null;
}

export interface SolidProgramUniforms {
  uViewProj: WebGLUniformLocation | null;
  uTranslate: WebGLUniformLocation | null;
  uScale: WebGLUniformLocation | null;
  uRotX: WebGLUniformLocation | null;
  uRotZ: WebGLUniformLocation | null;
  uUvRect: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uBlockSeed: WebGLUniformLocation | null;
  uMaterialStyle: WebGLUniformLocation | null;
  uBoardInfo: WebGLUniformLocation | null;
  uStoneTint: WebGLUniformLocation | null;
  uTrayMaterial: WebGLUniformLocation | null;
  uHighContrast: WebGLUniformLocation | null;
}

interface ProgramUniformCache {
  frameSynced: boolean;
  rotX: number;
  rotZ: number;
  materialStyle: number;
  useTexture: number;
  uv0: number;
  uv1: number;
  uv2: number;
  uv3: number;
  blockSeed: number;
}

export interface InstancedMeshHandle {
  vao: WebGLVertexArrayObject;
  instBuf: WebGLBuffer;
  capacityFloats: number;
  indexCount: number;
}

export interface GlProgramState {
  mainProgram: WebGLProgram;
  solidProgram: WebGLProgram | null;
  mainUniforms: MainProgramUniforms;
  solidUniforms: SolidProgramUniforms | null;
  mainCache: ProgramUniformCache;
  solidCache: ProgramUniformCache;
  instancedHandles: Map<MeshData, InstancedMeshHandle>;
  activeProgram: WebGLProgram | null;
  activeVao: WebGLVertexArrayObject | null;
  clipPlaneActive: boolean;
  currentBlockSeed: number;
  frameBlueprintMix: number;
  // Frame-constant values cached for lazy upload on first `solidProgram` draw
  viewProj: Float32Array;
  boardCenterX: number;
  boardCenterY: number;
  shaderTime: number;
  stoneTintR: number;
  stoneTintG: number;
  stoneTintB: number;
  trayMatCode: number;
  highContrastInt: number;
  shakeX: number;
  shakeY: number;
}

function createEmptyCache(): ProgramUniformCache {
  return {
    frameSynced: false,
    rotX: Number.NaN,
    rotZ: Number.NaN,
    materialStyle: -1,
    useTexture: -1,
    uv0: Number.NaN,
    uv1: Number.NaN,
    uv2: Number.NaN,
    uv3: Number.NaN,
    blockSeed: Number.NaN,
  };
}

function resetCache(c: ProgramUniformCache, synced: boolean): void {
  c.frameSynced = synced;
  c.rotX = Number.NaN;
  c.rotZ = Number.NaN;
  c.materialStyle = -1;
  c.useTexture = -1;
  c.uv0 = Number.NaN;
  c.uv1 = Number.NaN;
  c.uv2 = Number.NaN;
  c.uv3 = Number.NaN;
  c.blockSeed = Number.NaN;
}

export function extractMainProgramUniforms(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram
): MainProgramUniforms {
  return {
    uViewProj: gl.getUniformLocation(prog, 'u_viewProj'),
    uTranslate: gl.getUniformLocation(prog, 'u_translate'),
    uScale: gl.getUniformLocation(prog, 'u_scale'),
    uRotX: gl.getUniformLocation(prog, 'u_rotX'),
    uRotZ: gl.getUniformLocation(prog, 'u_rotZ'),
    uUvRect: gl.getUniformLocation(prog, 'u_uvRect'),
    uColor: gl.getUniformLocation(prog, 'u_color'),
    uCapColor: gl.getUniformLocation(prog, 'u_capColor'),
    uClipPlane: gl.getUniformLocation(prog, 'u_clipPlane'),
    uUseClipPlane: gl.getUniformLocation(prog, 'u_useClipPlane'),
    uBlockSeed: gl.getUniformLocation(prog, 'u_blockSeed'),
    uUseTexture: gl.getUniformLocation(prog, 'u_useTexture'),
    uMaterialStyle: gl.getUniformLocation(prog, 'u_materialStyle'),
    uAtlas: gl.getUniformLocation(prog, 'u_atlas'),
    uBlueprintMix: gl.getUniformLocation(prog, 'u_blueprintMix'),
    uBoardInfo: gl.getUniformLocation(prog, 'u_boardInfo'),
    uStoneTint: gl.getUniformLocation(prog, 'u_stoneTint'),
    uTrayMaterial: gl.getUniformLocation(prog, 'u_trayMaterial'),
    uHighContrast: gl.getUniformLocation(prog, 'u_highContrast'),
    uTraceCount: gl.getUniformLocation(prog, 'u_traceCount'),
    uTracePts: gl.getUniformLocation(prog, 'u_tracePts[0]') ?? gl.getUniformLocation(prog, 'u_tracePts'),
  };
}

export function extractSolidProgramUniforms(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram
): SolidProgramUniforms {
  return {
    uViewProj: gl.getUniformLocation(prog, 'u_viewProj'),
    uTranslate: gl.getUniformLocation(prog, 'u_translate'),
    uScale: gl.getUniformLocation(prog, 'u_scale'),
    uRotX: gl.getUniformLocation(prog, 'u_rotX'),
    uRotZ: gl.getUniformLocation(prog, 'u_rotZ'),
    uUvRect: gl.getUniformLocation(prog, 'u_uvRect'),
    uColor: gl.getUniformLocation(prog, 'u_color'),
    uBlockSeed: gl.getUniformLocation(prog, 'u_blockSeed'),
    uMaterialStyle: gl.getUniformLocation(prog, 'u_materialStyle'),
    uBoardInfo: gl.getUniformLocation(prog, 'u_boardInfo'),
    uStoneTint: gl.getUniformLocation(prog, 'u_stoneTint'),
    uTrayMaterial: gl.getUniformLocation(prog, 'u_trayMaterial'),
    uHighContrast: gl.getUniformLocation(prog, 'u_highContrast'),
  };
}

export function createGlProgramState(
  gl: WebGL2RenderingContext,
  mainProgram: WebGLProgram,
  solidProgram: WebGLProgram | null
): GlProgramState {
  return {
    mainProgram,
    solidProgram,
    mainUniforms: extractMainProgramUniforms(gl, mainProgram),
    solidUniforms: solidProgram ? extractSolidProgramUniforms(gl, solidProgram) : null,
    mainCache: createEmptyCache(),
    solidCache: createEmptyCache(),
    instancedHandles: new Map(),
    activeProgram: null,
    activeVao: null,
    clipPlaneActive: false,
    currentBlockSeed: 0,
    frameBlueprintMix: 0,
    viewProj: new Float32Array(16),
    boardCenterX: 3,
    boardCenterY: 3,
    shaderTime: 0,
    stoneTintR: 1,
    stoneTintG: 1,
    stoneTintB: 1,
    trayMatCode: 0,
    highContrastInt: 0,
    shakeX: 0,
    shakeY: 0,
  };
}

/**
 * Resets per-frame shader state cache right after `prepareWebGL2FrameStateImpl` has uploaded
 * `mainProgram`'s frame uniforms and bound `mainProgram`.
 */
export function syncFrameProgramState(
  state: GlProgramState,
  viewProj: Float32Array,
  boardCenterX: number,
  boardCenterY: number,
  shaderTime: number,
  stoneTintR: number,
  stoneTintG: number,
  stoneTintB: number,
  trayMatCode: number,
  highContrastInt: number,
  blueprintMix: number,
  shakeX: number,
  shakeY: number
): void {
  state.viewProj = viewProj;
  state.boardCenterX = boardCenterX;
  state.boardCenterY = boardCenterY;
  state.shaderTime = shaderTime;
  state.stoneTintR = stoneTintR;
  state.stoneTintG = stoneTintG;
  state.stoneTintB = stoneTintB;
  state.trayMatCode = trayMatCode;
  state.highContrastInt = highContrastInt;
  state.frameBlueprintMix = blueprintMix;
  state.shakeX = shakeX;
  state.shakeY = shakeY;
  state.activeProgram = state.mainProgram;
  state.activeVao = null;
  state.clipPlaneActive = false;
  state.currentBlockSeed = 0;
  resetCache(state.mainCache, true);
  state.mainCache.blockSeed = 0;
  resetCache(state.solidCache, false);
}

export function bindMainProgramImpl(gl: WebGL2RenderingContext, state: GlProgramState): void {
  if (state.activeProgram !== state.mainProgram) {
    gl.useProgram(state.mainProgram);
    state.activeProgram = state.mainProgram;
  }
}

export function setClipPlaneStateImpl(
  gl: WebGL2RenderingContext,
  state: GlProgramState,
  enabled: boolean,
  nx = 0,
  ny = 0,
  nz = 1,
  d = 0,
  capR = 0.2,
  capG = 0.2,
  capB = 0.2
): void {
  if (!enabled) {
    if (!state.clipPlaneActive) return;
    bindMainProgramImpl(gl, state);
    gl.uniform1i(state.mainUniforms.uUseClipPlane, 0);
    state.clipPlaneActive = false;
    return;
  }
  bindMainProgramImpl(gl, state);
  if (!state.clipPlaneActive) {
    gl.uniform1i(state.mainUniforms.uUseClipPlane, 1);
    state.clipPlaneActive = true;
  }
  gl.uniform4f(state.mainUniforms.uClipPlane, nx, ny, nz, d);
  gl.uniform3f(state.mainUniforms.uCapColor, capR, capG, capB);
}

function selectAndBindProgram(gl: WebGL2RenderingContext, state: GlProgramState, useSolid: boolean): boolean {
  if (useSolid && state.solidProgram && state.solidUniforms) {
    if (state.activeProgram !== state.solidProgram) {
      gl.useProgram(state.solidProgram);
      state.activeProgram = state.solidProgram;
    }
    if (!state.solidCache.frameSynced) {
      const su = state.solidUniforms;
      gl.uniformMatrix4fv(su.uViewProj, false, state.viewProj);
      gl.uniform3f(su.uBoardInfo, state.boardCenterX, state.boardCenterY, state.shaderTime);
      gl.uniform3f(su.uStoneTint, state.stoneTintR, state.stoneTintG, state.stoneTintB);
      gl.uniform1i(su.uTrayMaterial, state.trayMatCode);
      gl.uniform1i(su.uHighContrast, state.highContrastInt);
      state.solidCache.frameSynced = true;
    }
    return true;
  }
  bindMainProgramImpl(gl, state);
  return false;
}

function uploadDrawUniforms(
  gl: WebGL2RenderingContext,
  state: GlProgramState,
  isSolid: boolean,
  tx: number,
  ty: number,
  tz: number,
  sx: number,
  sy: number,
  sz: number,
  r: number,
  g: number,
  b: number,
  a: number,
  rotX: number,
  rotZ: number,
  materialStyle: number,
  uvRegion: AtlasUVRegion | null
): void {
  const uv0 = uvRegion ? uvRegion.u0 : 0;
  const uv1 = uvRegion ? uvRegion.v0 : 0;
  const uv2 = uvRegion ? uvRegion.u1 : 1;
  const uv3 = uvRegion ? uvRegion.v1 : 1;

  if (isSolid && state.solidUniforms) {
    const u = state.solidUniforms;
    const c = state.solidCache;
    gl.uniform3f(u.uTranslate, tx, ty, tz);
    gl.uniform3f(u.uScale, sx, sy, sz);
    gl.uniform4f(u.uColor, r, g, b, a);
    if (c.rotX !== rotX) {
      gl.uniform1f(u.uRotX, rotX);
      c.rotX = rotX;
    }
    if (c.rotZ !== rotZ) {
      gl.uniform1f(u.uRotZ, rotZ);
      c.rotZ = rotZ;
    }
    if (c.materialStyle !== materialStyle) {
      gl.uniform1i(u.uMaterialStyle, materialStyle);
      c.materialStyle = materialStyle;
    }
    if (c.uv0 !== uv0 || c.uv1 !== uv1 || c.uv2 !== uv2 || c.uv3 !== uv3) {
      gl.uniform4f(u.uUvRect, uv0, uv1, uv2, uv3);
      c.uv0 = uv0;
      c.uv1 = uv1;
      c.uv2 = uv2;
      c.uv3 = uv3;
    }
    if (c.blockSeed !== state.currentBlockSeed) {
      gl.uniform1f(u.uBlockSeed, state.currentBlockSeed);
      c.blockSeed = state.currentBlockSeed;
    }
    return;
  }

  const u = state.mainUniforms;
  const c = state.mainCache;
  const useTex = uvRegion ? 1 : 0;
  gl.uniform3f(u.uTranslate, tx, ty, tz);
  gl.uniform3f(u.uScale, sx, sy, sz);
  gl.uniform4f(u.uColor, r, g, b, a);
  if (c.rotX !== rotX) {
    gl.uniform1f(u.uRotX, rotX);
    c.rotX = rotX;
  }
  if (c.rotZ !== rotZ) {
    gl.uniform1f(u.uRotZ, rotZ);
    c.rotZ = rotZ;
  }
  if (c.materialStyle !== materialStyle) {
    gl.uniform1i(u.uMaterialStyle, materialStyle);
    c.materialStyle = materialStyle;
  }
  if (c.useTexture !== useTex) {
    gl.uniform1i(u.uUseTexture, useTex);
    c.useTexture = useTex;
  }
  if (c.uv0 !== uv0 || c.uv1 !== uv1 || c.uv2 !== uv2 || c.uv3 !== uv3) {
    gl.uniform4f(u.uUvRect, uv0, uv1, uv2, uv3);
    c.uv0 = uv0;
    c.uv1 = uv1;
    c.uv2 = uv2;
    c.uv3 = uv3;
  }
  if (c.blockSeed !== state.currentBlockSeed) {
    gl.uniform1f(u.uBlockSeed, state.currentBlockSeed);
    c.blockSeed = state.currentBlockSeed;
  }
}

export function drawMeshWithStateCache(
  gl: WebGL2RenderingContext,
  state: GlProgramState,
  handle: GLMeshHandle,
  tx: number,
  ty: number,
  tz: number,
  sx: number,
  sy: number,
  sz: number,
  r: number,
  g: number,
  b: number,
  a: number,
  rotX: number,
  rotZ: number,
  materialStyle: number,
  uvRegion: AtlasUVRegion | null
): void {
  const needsBlend = uvRegion !== null || a < 0.999 || materialStyle === 4 || materialStyle >= 8;
  setGlBlendEnabled(gl, needsBlend);
  const canUseSolid =
    !needsBlend && state.solidProgram !== null && state.frameBlueprintMix <= 0.001 && !state.clipPlaneActive;
  const isSolid = selectAndBindProgram(gl, state, canUseSolid);
  if (state.activeVao !== handle.vao) {
    gl.bindVertexArray(handle.vao);
    state.activeVao = handle.vao;
  }
  uploadDrawUniforms(
    gl,
    state,
    isSolid,
    tx + state.shakeX,
    ty + state.shakeY,
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
    materialStyle,
    uvRegion
  );
  gl.drawElements(gl.TRIANGLES, handle.indexCount, gl.UNSIGNED_SHORT, 0);
}

function getOrCreateInstancedMeshHandle(
  gl: WebGL2RenderingContext,
  state: GlProgramState,
  mesh: MeshData,
  baseHandle: GLMeshHandle,
  minFloats: number
): InstancedMeshHandle {
  const existing = state.instancedHandles.get(mesh);
  if (existing) {
    if (minFloats > existing.capacityFloats) {
      const nextCap = Math.max(minFloats, existing.capacityFloats * 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, existing.instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, nextCap * 4, gl.DYNAMIC_DRAW);
      existing.capacityFloats = nextCap;
    }
    return existing;
  }

  const vao = gl.createVertexArray();
  const instBuf = gl.createBuffer();
  if (!vao || !instBuf) {
    throw new Error('Failed to allocate instanced WebGL2 mesh handle');
  }
  const capacityFloats = Math.max(minFloats, 128 * MESH_INSTANCE_STRIDE);

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, baseHandle.posBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, baseHandle.normBuffer);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, baseHandle.uvBuffer);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, capacityFloats * 4, gl.DYNAMIC_DRAW);
  const strideBytes = MESH_INSTANCE_STRIDE * 4;
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, strideBytes, 0);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 3, gl.FLOAT, false, strideBytes, 12);
  gl.vertexAttribDivisor(4, 1);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 3, gl.FLOAT, false, strideBytes, 24);
  gl.vertexAttribDivisor(5, 1);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, baseHandle.indexBuffer);
  gl.bindVertexArray(null);
  state.activeVao = null;

  const created: InstancedMeshHandle = {
    vao,
    instBuf,
    capacityFloats,
    indexCount: baseHandle.indexCount,
  };
  state.instancedHandles.set(mesh, created);
  return created;
}

/**
 * Draws `instanceCount` copies of `mesh` in a single `gl.drawElementsInstanced` call (`PERF-GPU-01`),
 * sharing `mesh`'s static vertex/index buffers and reusing the exact same `solidProgram`/`mainProgram`
 * lighting, shake, and Title-crust shaders with zero pixel divergence.
 */
export function drawMeshInstancedWithStateCache(
  gl: WebGL2RenderingContext,
  state: GlProgramState,
  mesh: MeshData,
  baseHandle: GLMeshHandle,
  instanceData: Float32Array,
  instanceCount: number,
  alpha = 1.0,
  materialStyle = 0
): void {
  if (instanceCount <= 0) return;
  const floatCount = instanceCount * MESH_INSTANCE_STRIDE;
  const instHandle = getOrCreateInstancedMeshHandle(gl, state, mesh, baseHandle, floatCount);

  gl.bindBuffer(gl.ARRAY_BUFFER, instHandle.instBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData.subarray(0, floatCount));

  const needsBlend = alpha < 0.999 || materialStyle === 4 || materialStyle >= 8;
  setGlBlendEnabled(gl, needsBlend);
  const canUseSolid =
    !needsBlend && state.solidProgram !== null && state.frameBlueprintMix <= 0.001 && !state.clipPlaneActive;
  const isSolid = selectAndBindProgram(gl, state, canUseSolid);
  if (state.activeVao !== instHandle.vao) {
    gl.bindVertexArray(instHandle.vao);
    state.activeVao = instHandle.vao;
  }
  uploadDrawUniforms(
    gl,
    state,
    isSolid,
    state.shakeX,
    state.shakeY,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    alpha,
    0,
    0,
    materialStyle,
    null
  );
  gl.drawElementsInstanced(gl.TRIANGLES, instHandle.indexCount, gl.UNSIGNED_SHORT, 0, instanceCount);
}

/**
 * Pre-warms `solidProgram` (regular + instanced VAOs) during boot's 1x1 scissored warmup pass
 * so mobile Vulkan/ANGLE PSOs compile upfront with zero first-gameplay-frame hitch.
 */
export function warmUpSolidProgramImpl(
  gl: WebGL2RenderingContext,
  state: GlProgramState,
  quadMesh: MeshData,
  quadHandle: GLMeshHandle
): void {
  if (!state.solidProgram || !state.solidUniforms) return;
  const su = state.solidUniforms;
  gl.useProgram(state.solidProgram);
  state.activeProgram = state.solidProgram;
  gl.uniformMatrix4fv(su.uViewProj, false, state.viewProj);
  gl.uniform3f(su.uBoardInfo, 3, 3, 0);
  gl.uniform3f(su.uStoneTint, 1, 1, 1);
  gl.uniform1i(su.uTrayMaterial, 0);
  gl.uniform1i(su.uHighContrast, 0);
  gl.uniform1f(su.uBlockSeed, 0);
  gl.uniform1f(su.uRotX, 0);
  gl.uniform1f(su.uRotZ, 0);
  gl.uniform4f(su.uUvRect, 0, 0, 1, 1);
  gl.uniform3f(su.uTranslate, 0, 0, 0);
  gl.uniform3f(su.uScale, 1, 1, 1);
  gl.uniform4f(su.uColor, 0.5, 0.5, 0.5, 1.0);

  setGlBlendEnabled(gl, false);
  gl.depthMask(true);
  gl.bindVertexArray(quadHandle.vao);
  state.activeVao = quadHandle.vao;
  for (const style of [0, 1, 2, 3, 5, 6, 7]) {
    gl.uniform1i(su.uMaterialStyle, style);
    gl.drawElements(gl.TRIANGLES, quadHandle.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  // Also warm the instanced vertex layout (locations 3..5) on `solidProgram`
  const instHandle = getOrCreateInstancedMeshHandle(gl, state, quadMesh, quadHandle, MESH_INSTANCE_STRIDE);
  gl.bindBuffer(gl.ARRAY_BUFFER, instHandle.instBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([0, 0, 0, 1, 1, 1, 0.5, 0.5, 0.5]));
  gl.bindVertexArray(instHandle.vao);
  state.activeVao = instHandle.vao;
  gl.uniform3f(su.uScale, 0, 0, 0);
  gl.uniform4f(su.uColor, 0, 0, 0, 1.0);
  gl.uniform1i(su.uMaterialStyle, 5);
  gl.drawElementsInstanced(gl.TRIANGLES, instHandle.indexCount, gl.UNSIGNED_SHORT, 0, 1);
  gl.bindVertexArray(null);
  state.activeVao = null;
}

export function disposeGlProgramState(gl: WebGL2RenderingContext | null, state: GlProgramState | null): void {
  if (!state) return;
  if (gl && !gl.isContextLost()) {
    for (const h of state.instancedHandles.values()) {
      gl.deleteVertexArray(h.vao);
      gl.deleteBuffer(h.instBuf);
    }
    if (state.solidProgram) {
      gl.deleteProgram(state.solidProgram);
    }
  }
  state.instancedHandles.clear();
}
