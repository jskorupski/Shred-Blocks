import { type RelicFracturePlate, type RenderPassContext, setGlBlendEnabled } from './render-types';
import { RELIC_CLUSTER_TEX_SIZE } from './voronoi-cluster-math';

const MAX_PLATE_VERTS = 12288;
const MAX_PLATE_INDICES = 24576;
const SOLID_LIFE_THRESHOLD = 0.3;

interface PlateGlHandles {
  vao: WebGLVertexArrayObject;
  posBuf: WebGLBuffer;
  normBuf: WebGLBuffer;
  uvBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
}

interface PlateUniforms {
  uTranslate: WebGLUniformLocation | null;
  uScale: WebGLUniformLocation | null;
  uRotX: WebGLUniformLocation | null;
  uRotZ: WebGLUniformLocation | null;
  uUvRect: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uUseTexture: WebGLUniformLocation | null;
  uMaterialStyle: WebGLUniformLocation | null;
  uBlueprintMix: WebGLUniformLocation | null;
}

/**
 * Static extruded 3D local-space slab mesh baked once per `RelicFracturePlate` (`PERF-TRANSITION-01`),
 * eliminating per-frame polygon re-extrusion, `topRing`/`botRing` arrays, and `Math.hypot` wall math.
 */
interface BakedPlateLocalMesh {
  vertCount: number;
  idxCount: number;
  localPos: Float32Array;
  localNorm: Float32Array;
  rimU: Float32Array;
  indices: Uint16Array;
}

const plateGlHandlesByGl = new WeakMap<WebGL2RenderingContext, PlateGlHandles>();
const plateUniformsByProg = new WeakMap<WebGLProgram, PlateUniforms>();
const clusterTexByGl = new WeakMap<WebGL2RenderingContext, WebGLTexture>();
const clusterUniformByProg = new WeakMap<WebGLProgram, WebGLUniformLocation | null>();
const clusterTexStateByRctx = new WeakMap<RenderPassContext, { data: Uint8Array; dirty: boolean }>();
const bakedPlateMeshByPlate = new WeakMap<RelicFracturePlate, BakedPlateLocalMesh>();

const sharedPositions = new Float32Array(MAX_PLATE_VERTS * 3);
const sharedNormals = new Float32Array(MAX_PLATE_VERTS * 3);
const sharedUvs = new Float32Array(MAX_PLATE_VERTS * 2);
const sharedSolidIndices = new Uint16Array(MAX_PLATE_INDICES);
const sharedFadeIndices = new Uint16Array(MAX_PLATE_INDICES);
const sharedCombinedIndices = new Uint16Array(MAX_PLATE_INDICES * 2);
const scratchRotMat = new Float32Array(9);
const WARMUP_PLATE_POS = new Float32Array([0, 0, -50, 0.01, 0, -50, 0, 0.01, -50]);
const WARMUP_PLATE_NORM = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
const WARMUP_PLATE_UV = new Float32Array([0, 1, 0.92, 1, 1, 1]);
const WARMUP_PLATE_IDX = new Uint16Array([0, 1, 2]);

const DEFAULT_CLUSTER_TEX_DATA = (() => {
  const buf = new Uint8Array(RELIC_CLUSTER_TEX_SIZE * RELIC_CLUSTER_TEX_SIZE * 4);
  for (let y = 0; y < RELIC_CLUSTER_TEX_SIZE; y++) {
    for (let x = 0; x < RELIC_CLUSTER_TEX_SIZE; x++) {
      const idx = (y * RELIC_CLUSTER_TEX_SIZE + x) * 4;
      buf[idx] = 1 + ((y * RELIC_CLUSTER_TEX_SIZE + x) % 254);
      buf[idx + 1] = 128;
      buf[idx + 2] = 0;
      buf[idx + 3] = 0;
    }
  }
  return buf;
})();

/** Exact CPU mirror of GLSL `rotateRelicVec` in `shaders-main-vertex.ts`. */
export function rotateRelicVec(
  vx: number,
  vy: number,
  vz: number,
  rx: number,
  ry: number,
  rz: number
): [number, number, number] {
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const x1 = vx * cz - vy * sz;
  const y1 = vx * sz + vy * cz;
  const z1 = vz;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const x2 = x1;
  const y2 = y1 * cx - z1 * sx;
  const z2 = y1 * sx + z1 * cx;
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  return [x2 * cy + z2 * sy, y2, -x2 * sy + z2 * cy];
}

/**
 * Computes the exact 3x3 row-major composite rotation `R_relic(initTiltX, initTiltY, initTwistZ + spinAngle) *
 * R_hinge(tanX, tanY, peelAngle)` once per plate into `out` (`8` trig calls per plate vs. `8` per vertex).
 */
export function computePlateRotationMatrix(
  p: RelicFracturePlate,
  peelAngle: number,
  spinAngle: number,
  out: Float32Array
): void {
  const c = Math.cos(peelAngle);
  const s = Math.sin(peelAngle);
  const omc = 1 - c;
  const kx = p.tanX;
  const ky = p.tanY;

  const a00 = c + kx * kx * omc;
  const a01 = kx * ky * omc;
  const a02 = -ky * s;
  const a10 = a01;
  const a11 = c + ky * ky * omc;
  const a12 = kx * s;
  const a20 = -ky * s;
  const a21 = kx * s;
  const a22 = c;

  const rz = p.initTwistZ + spinAngle;
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const cx = Math.cos(p.initTiltX);
  const sx = Math.sin(p.initTiltX);
  const cy = Math.cos(p.initTiltY);
  const sy = Math.sin(p.initTiltY);

  const b00 = cy * cz + sy * sx * sz;
  const b01 = -cy * sz + sy * sx * cz;
  const b02 = sy * cx;
  const b10 = cx * sz;
  const b11 = cx * cz;
  const b12 = -sx;
  const b20 = -sy * cz + cy * sx * sz;
  const b21 = sy * sz + cy * sx * cz;
  const b22 = cy * cx;

  out[0] = b00 * a00 + b01 * a10 + b02 * a20;
  out[1] = b00 * a01 + b01 * a11 + b02 * a21;
  out[2] = b00 * a02 + b01 * a12 + b02 * a22;
  out[3] = b10 * a00 + b11 * a10 + b12 * a20;
  out[4] = b10 * a01 + b11 * a11 + b12 * a21;
  out[5] = b10 * a02 + b11 * a12 + b12 * a22;
  out[6] = b20 * a00 + b21 * a10 + b22 * a20;
  out[7] = b20 * a01 + b21 * a11 + b22 * a21;
  out[8] = b20 * a02 + b21 * a12 + b22 * a22;
}

function getOrBakePlateLocalMesh(p: RelicFracturePlate): BakedPlateLocalMesh {
  const cached = bakedPlateMeshByPlate.get(p);
  if (cached) return cached;

  let totalVerts = 0;
  let totalIndices = 0;
  for (let si = 0; si < p.subCells.length; si++) {
    const sc = p.subCells[si];
    const polyCount = sc.verts.length / 2;
    if (polyCount < 3) continue;
    let wallEdges = 0;
    for (let i = 0; i < polyCount; i++) {
      if ((sc.edgeFlags[i] & 1) !== 0) wallEdges++;
    }
    totalVerts += 2 + polyCount * 2 + wallEdges * 4;
    totalIndices += polyCount * 6 + wallEdges * 6;
  }

  const localPos = new Float32Array(totalVerts * 3);
  const localNorm = new Float32Array(totalVerts * 3);
  const rimU = new Float32Array(totalVerts);
  const indices = new Uint16Array(totalIndices);
  const halfH = p.thickness * 0.5;
  let vOut = 0;
  let iOut = 0;

  const pushLocal = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number
  ): number => {
    const vi = vOut++;
    const v3 = vi * 3;
    localPos[v3] = x;
    localPos[v3 + 1] = y;
    localPos[v3 + 2] = z;
    localNorm[v3] = nx;
    localNorm[v3 + 1] = ny;
    localNorm[v3 + 2] = nz;
    rimU[vi] = u;
    return vi;
  };

  for (let si = 0; si < p.subCells.length; si++) {
    const sc = p.subCells[si];
    const polyCount = sc.verts.length / 2;
    if (polyCount < 3) continue;

    const topCenter = pushLocal(sc.centerX, sc.centerY, halfH, 0, 0, 1, 0.0);
    const topRingStart = vOut;
    for (let i = 0; i < polyCount; i++) {
      const incident = sc.edgeFlags[(i + polyCount - 1) % polyCount] | sc.edgeFlags[i];
      const topU = (incident & 2) !== 0 ? 0.92 : (incident & 1) !== 0 ? 0.7 : 0.0;
      pushLocal(sc.verts[i * 2], sc.verts[i * 2 + 1], halfH, 0, 0, 1, topU);
    }

    const botCenter = pushLocal(sc.centerX, sc.centerY, -halfH, 0, 0, -1, 0.2);
    const botRingStart = vOut;
    for (let i = 0; i < polyCount; i++) {
      const incident = sc.edgeFlags[(i + polyCount - 1) % polyCount] | sc.edgeFlags[i];
      const botU = (incident & 2) !== 0 ? 0.92 : (incident & 1) !== 0 ? 0.7 : 0.2;
      pushLocal(sc.verts[i * 2], sc.verts[i * 2 + 1], -halfH, 0, 0, -1, botU);
    }

    for (let i = 0; i < polyCount; i++) {
      const next = (i + 1) % polyCount;
      indices[iOut++] = topCenter;
      indices[iOut++] = topRingStart + i;
      indices[iOut++] = topRingStart + next;

      indices[iOut++] = botCenter;
      indices[iOut++] = botRingStart + next;
      indices[iOut++] = botRingStart + i;

      const flag = sc.edgeFlags[i];
      if ((flag & 1) === 0) continue;

      const wallU = (flag & 2) !== 0 ? 1.0 : 0.72;
      const ax = sc.verts[i * 2];
      const ay = sc.verts[i * 2 + 1];
      const bx = sc.verts[next * 2];
      const by = sc.verts[next * 2 + 1];
      const ex = bx - ax;
      const ey = by - ay;
      const eLen = Math.hypot(ex, ey) || 1;
      const wnx = -ey / eLen;
      const wny = ex / eLen;

      const st0 = pushLocal(ax, ay, halfH, wnx, wny, 0.14, wallU);
      const sb0 = pushLocal(ax, ay, -halfH, wnx, wny, 0.14, wallU);
      const sb1 = pushLocal(bx, by, -halfH, wnx, wny, 0.14, wallU);
      const st1 = pushLocal(bx, by, halfH, wnx, wny, 0.14, wallU);

      indices[iOut++] = st0;
      indices[iOut++] = sb0;
      indices[iOut++] = sb1;
      indices[iOut++] = st0;
      indices[iOut++] = sb1;
      indices[iOut++] = st1;
    }
  }

  const baked: BakedPlateLocalMesh = {
    vertCount: vOut,
    idxCount: iOut,
    localPos,
    localNorm,
    rimU,
    indices,
  };
  bakedPlateMeshByPlate.set(p, baked);
  return baked;
}

/** Pre-bakes local 3D slab geometry for all plates during Title idle so active explosion frames allocate zero arrays. */
export function prebakeRelicPlatesImpl(plates: readonly RelicFracturePlate[]): void {
  for (let i = 0; i < plates.length; i++) {
    getOrBakePlateLocalMesh(plates[i]);
  }
}

/** Stores per-cell cluster LUT `[clusterId, detachT*255, isSubSplit*255, glowAffinity*255]` for GPU upload. */
export function setRelicClusterTexDataImpl(rctx: RenderPassContext, data: Uint8Array): void {
  clusterTexStateByRctx.set(rctx, { data, dirty: true });
}

function getRelicClusterUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram
): WebGLUniformLocation | null {
  if (clusterUniformByProg.has(program)) {
    return clusterUniformByProg.get(program) ?? null;
  }
  const loc = gl.getUniformLocation(program, 'u_relicClusterTex');
  clusterUniformByProg.set(program, loc);
  return loc;
}

/**
 * Lazily creates & binds the `16x16` `NEAREST` cluster LUT onto `gl.TEXTURE1` (`u_relicClusterTex = 1`),
 * uploading new cluster bytes only when `setRelicClusterTexDataImpl` marks it dirty, and restores `gl.TEXTURE0`.
 */
export function bindRelicClusterTextureImpl(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  mainProgram: WebGLProgram | null
): void {
  if (!mainProgram || typeof gl.createTexture !== 'function' || typeof gl.getUniformLocation !== 'function') {
    return;
  }
  let tex = clusterTexByGl.get(gl);
  if (!tex) {
    const created = gl.createTexture();
    if (!created) return;
    tex = created;
    clusterTexByGl.set(gl, tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      RELIC_CLUSTER_TEX_SIZE,
      RELIC_CLUSTER_TEX_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      DEFAULT_CLUSTER_TEX_DATA
    );
  } else {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  const state = clusterTexStateByRctx.get(rctx);
  if (state?.dirty && typeof gl.texSubImage2D === 'function') {
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      RELIC_CLUSTER_TEX_SIZE,
      RELIC_CLUSTER_TEX_SIZE,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      state.data
    );
    state.dirty = false;
  }

  const uLoc = getRelicClusterUniform(gl, mainProgram);
  if (uLoc !== null) {
    gl.uniform1i(uLoc, 1);
  }
  gl.activeTexture(gl.TEXTURE0);
}

/**
 * Packs extruded 3D polygonal slab buffers for all currently detached `rctx.relicPlates` with
 * zero per-frame heap allocations (`PERF-TRANSITION-01`): transforms pre-baked local slab vertices
 * by a single 3x3 matrix per plate and keeps fused multi-cell internal seams completely seamless.
 */
export function buildRelicPlateGeometryImpl(plates: readonly RelicFracturePlate[]): {
  vertexCount: number;
  solidIndexCount: number;
  fadeIndexCount: number;
} {
  let vertCount = 0;
  let solidIdxCount = 0;
  let fadeIdxCount = 0;

  for (let pi = 0; pi < plates.length; pi++) {
    const p = plates[pi];
    if (!p.detached || p.lifeRatio <= 0 || p.subCells.length === 0) continue;

    const baked = getOrBakePlateLocalMesh(p);
    if (baked.vertCount === 0 || baked.idxCount === 0) continue;

    const isSolid = p.lifeRatio >= SOLID_LIFE_THRESHOLD;
    const curIdxCount = isSolid ? solidIdxCount : fadeIdxCount;
    if (vertCount + baked.vertCount > MAX_PLATE_VERTS || curIdxCount + baked.idxCount > MAX_PLATE_INDICES) {
      break;
    }

    const localT = Math.max(0, p.elapsedSec - p.detachDelaySec);
    const peelAngle = 0.08 + p.peelAngVel * localT;
    const spinAngle = p.spinVel * localT;
    computePlateRotationMatrix(p, peelAngle, spinAngle, scratchRotMat);

    const m00 = scratchRotMat[0];
    const m01 = scratchRotMat[1];
    const m02 = scratchRotMat[2];
    const m10 = scratchRotMat[3];
    const m11 = scratchRotMat[4];
    const m12 = scratchRotMat[5];
    const m20 = scratchRotMat[6];
    const m21 = scratchRotMat[7];
    const m22 = scratchRotMat[8];

    const sc = p.scale;
    const px = p.posX;
    const py = p.posY;
    const pz = p.posZ;
    const life = p.lifeRatio;
    const baseVert = vertCount;
    const localPos = baked.localPos;
    const localNorm = baked.localNorm;
    const rimU = baked.rimU;
    const vCount = baked.vertCount;

    for (let vi = 0; vi < vCount; vi++) {
      const k3 = vi * 3;
      const o3 = (baseVert + vi) * 3;
      const o2 = (baseVert + vi) * 2;
      const lx = localPos[k3] * sc;
      const ly = localPos[k3 + 1] * sc;
      const lz = localPos[k3 + 2] * sc;
      sharedPositions[o3] = px + m00 * lx + m01 * ly + m02 * lz;
      sharedPositions[o3 + 1] = py + m10 * lx + m11 * ly + m12 * lz;
      sharedPositions[o3 + 2] = pz + m20 * lx + m21 * ly + m22 * lz;

      const nx = localNorm[k3];
      const ny = localNorm[k3 + 1];
      const nz = localNorm[k3 + 2];
      sharedNormals[o3] = m00 * nx + m01 * ny + m02 * nz;
      sharedNormals[o3 + 1] = m10 * nx + m11 * ny + m12 * nz;
      sharedNormals[o3 + 2] = m20 * nx + m21 * ny + m22 * nz;

      sharedUvs[o2] = rimU[vi];
      sharedUvs[o2 + 1] = life;
    }
    vertCount += vCount;

    const targetIndices = isSolid ? sharedSolidIndices : sharedFadeIndices;
    const srcIdx = baked.indices;
    const iCount = baked.idxCount;
    let idxOut = curIdxCount;
    for (let ji = 0; ji < iCount; ji++) {
      targetIndices[idxOut++] = srcIdx[ji] + baseVert;
    }

    if (isSolid) {
      solidIdxCount = idxOut;
    } else {
      fadeIdxCount = idxOut;
    }
  }

  return { vertexCount: vertCount, solidIndexCount: solidIdxCount, fadeIndexCount: fadeIdxCount };
}

function getOrCreatePlateHandles(gl: WebGL2RenderingContext): PlateGlHandles | null {
  const existing = plateGlHandlesByGl.get(gl);
  if (existing) return existing;

  const vao = gl.createVertexArray();
  const posBuf = gl.createBuffer();
  const normBuf = gl.createBuffer();
  const uvBuf = gl.createBuffer();
  const idxBuf = gl.createBuffer();
  if (!vao || !posBuf || !normBuf || !uvBuf || !idxBuf) return null;

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sharedPositions.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sharedNormals.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sharedUvs.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sharedCombinedIndices.byteLength, gl.DYNAMIC_DRAW);
  gl.bindVertexArray(null);

  const created = { vao, posBuf, normBuf, uvBuf, idxBuf };
  plateGlHandlesByGl.set(gl, created);
  return created;
}

/**
 * Pre-allocates the dynamic Voronoi plate VAO/VBOs/IBO during boot `warmUpWebGLPipelinesImpl()`
 * and warms `u_materialStyle = 11` under BOTH solid (`blend=false, depthMask=true`) and fading
 * (`blend=true, depthMask=false`) pipeline states so the first plate detach (`t ~ 108ms`) never
 * triggers lazy GPU buffer allocation or a synchronous ANGLE-Vulkan `VkGraphicsPipeline` stall.
 */
export function warmUpRelicPlatePipelineImpl(gl: WebGL2RenderingContext, mainProgram: WebGLProgram): void {
  if (
    typeof gl.createVertexArray !== 'function' ||
    typeof gl.createBuffer !== 'function' ||
    typeof gl.bufferData !== 'function' ||
    typeof gl.drawElements !== 'function'
  ) {
    return;
  }
  const handles = getOrCreatePlateHandles(gl);
  if (!handles) return;
  const u = getPlateUniforms(gl, mainProgram);

  gl.useProgram(mainProgram);
  gl.uniform3f(u.uTranslate, 0, 0, 0);
  gl.uniform3f(u.uScale, 1, 1, 1);
  gl.uniform1f(u.uRotX, 0);
  gl.uniform1f(u.uRotZ, 0);
  gl.uniform4f(u.uUvRect, 0, 0, 1, 1);
  gl.uniform4f(u.uColor, 1, 1, 1, 1);
  gl.uniform1i(u.uUseTexture, 0);
  gl.uniform1i(u.uMaterialStyle, 11);
  gl.uniform1f(u.uBlueprintMix, 0);

  gl.bindVertexArray(handles.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, handles.posBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, WARMUP_PLATE_POS);
  gl.bindBuffer(gl.ARRAY_BUFFER, handles.normBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, WARMUP_PLATE_NORM);
  gl.bindBuffer(gl.ARRAY_BUFFER, handles.uvBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, WARMUP_PLATE_UV);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, handles.idxBuf);
  gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, WARMUP_PLATE_IDX);

  setGlBlendEnabled(gl, false);
  gl.depthMask(true);
  gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);

  setGlBlendEnabled(gl, true);
  gl.depthMask(false);
  gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);
  gl.depthMask(true);
  gl.bindVertexArray(null);
}

function getPlateUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): PlateUniforms {
  const cached = plateUniformsByProg.get(program);
  if (cached) return cached;
  const uniforms: PlateUniforms = {
    uTranslate: gl.getUniformLocation(program, 'u_translate'),
    uScale: gl.getUniformLocation(program, 'u_scale'),
    uRotX: gl.getUniformLocation(program, 'u_rotX'),
    uRotZ: gl.getUniformLocation(program, 'u_rotZ'),
    uUvRect: gl.getUniformLocation(program, 'u_uvRect'),
    uColor: gl.getUniformLocation(program, 'u_color'),
    uUseTexture: gl.getUniformLocation(program, 'u_useTexture'),
    uMaterialStyle: gl.getUniformLocation(program, 'u_materialStyle'),
    uBlueprintMix: gl.getUniformLocation(program, 'u_blueprintMix'),
  };
  plateUniformsByProg.set(program, uniforms);
  return uniforms;
}

export function disposeRelicPlateResources(gl: WebGL2RenderingContext | null): void {
  if (!gl) return;
  const handles = plateGlHandlesByGl.get(gl);
  if (handles && !gl.isContextLost()) {
    gl.deleteVertexArray(handles.vao);
    gl.deleteBuffer(handles.posBuf);
    gl.deleteBuffer(handles.normBuf);
    gl.deleteBuffer(handles.uvBuf);
    gl.deleteBuffer(handles.idxBuf);
  }
  plateGlHandlesByGl.delete(gl);

  const clusterTex = clusterTexByGl.get(gl);
  if (clusterTex && !gl.isContextLost()) {
    gl.deleteTexture(clusterTex);
  }
  clusterTexByGl.delete(gl);
}

/**
 * Draws all detached 3D Voronoi stone-crust plates (`u_materialStyle = 11`) in two clean passes:
 * solid lifting/hinging plates (`depthMask(true)`) followed by tail-dissolving fragments (`depthMask(false)`).
 */
export function renderRelicPlatesWebGL2Impl(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  mainProgram: WebGLProgram | null
): void {
  if (!mainProgram || !rctx.relicPlates || rctx.relicPlates.length === 0) return;
  const built = buildRelicPlateGeometryImpl(rctx.relicPlates);
  if (built.vertexCount === 0 || built.solidIndexCount + built.fadeIndexCount === 0) return;

  const handles = getOrCreatePlateHandles(gl);
  if (!handles) return;
  const u = getPlateUniforms(gl, mainProgram);

  gl.useProgram(mainProgram);
  gl.uniform3f(u.uTranslate, 0, 0, 0);
  gl.uniform3f(u.uScale, 1, 1, 1);
  gl.uniform1f(u.uRotX, 0);
  gl.uniform1f(u.uRotZ, 0);
  gl.uniform4f(u.uUvRect, 0, 0, 1, 1);
  gl.uniform4f(u.uColor, 1, 1, 1, 1);
  gl.uniform1i(u.uUseTexture, 0);
  gl.uniform1i(u.uMaterialStyle, 11);
  gl.uniform1f(u.uBlueprintMix, 0);

  gl.bindVertexArray(handles.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, handles.posBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, sharedPositions.subarray(0, built.vertexCount * 3));
  gl.bindBuffer(gl.ARRAY_BUFFER, handles.normBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, sharedNormals.subarray(0, built.vertexCount * 3));
  gl.bindBuffer(gl.ARRAY_BUFFER, handles.uvBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, sharedUvs.subarray(0, built.vertexCount * 2));
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, handles.idxBuf);

  // Single contiguous index upload per frame prevents mid-pass ANGLE-Vulkan IBO write stalls
  // across the ~36-38 frames where both solid and tail-fading slabs are simultaneously active.
  if (built.solidIndexCount > 0 && built.fadeIndexCount > 0) {
    sharedCombinedIndices.set(sharedSolidIndices.subarray(0, built.solidIndexCount), 0);
    sharedCombinedIndices.set(sharedFadeIndices.subarray(0, built.fadeIndexCount), built.solidIndexCount);
    gl.bufferSubData(
      gl.ELEMENT_ARRAY_BUFFER,
      0,
      sharedCombinedIndices.subarray(0, built.solidIndexCount + built.fadeIndexCount)
    );
    setGlBlendEnabled(gl, false);
    gl.depthMask(true);
    gl.drawElements(gl.TRIANGLES, built.solidIndexCount, gl.UNSIGNED_SHORT, 0);

    setGlBlendEnabled(gl, true);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, built.fadeIndexCount, gl.UNSIGNED_SHORT, built.solidIndexCount * 2);
    gl.depthMask(true);
  } else if (built.solidIndexCount > 0) {
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, sharedSolidIndices.subarray(0, built.solidIndexCount));
    setGlBlendEnabled(gl, false);
    gl.depthMask(true);
    gl.drawElements(gl.TRIANGLES, built.solidIndexCount, gl.UNSIGNED_SHORT, 0);
    setGlBlendEnabled(gl, true);
  } else if (built.fadeIndexCount > 0) {
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, sharedFadeIndices.subarray(0, built.fadeIndexCount));
    setGlBlendEnabled(gl, true);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, built.fadeIndexCount, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
  }
  gl.bindVertexArray(null);
}

/** Canvas2D parity fallback for peeling polygonal Voronoi stone plates (`RELIC-AWAKEN-01`). */
export function renderRelicPlatesCanvas2DImpl(
  rctx: RenderPassContext,
  ctx: CanvasRenderingContext2D,
  project: (bx: number, by: number, bz: number) => { x: number; y: number }
): void {
  if (!rctx.relicPlates || rctx.relicPlates.length === 0) return;
  for (const p of rctx.relicPlates) {
    if (!p.detached || p.lifeRatio <= 0 || p.subCells.length === 0) continue;
    const localT = Math.max(0, p.elapsedSec - p.detachDelaySec);
    const peelAngle = 0.08 + p.peelAngVel * localT;
    const spinAngle = p.spinVel * localT;
    const alpha = p.lifeRatio < SOLID_LIFE_THRESHOLD ? p.lifeRatio / SOLID_LIFE_THRESHOLD : 1;
    computePlateRotationMatrix(p, peelAngle, spinAngle, scratchRotMat);
    const m00 = scratchRotMat[0];
    const m01 = scratchRotMat[1];
    const m02 = scratchRotMat[2];
    const m10 = scratchRotMat[3];
    const m11 = scratchRotMat[4];
    const m12 = scratchRotMat[5];
    const m20 = scratchRotMat[6];
    const m21 = scratchRotMat[7];
    const m22 = scratchRotMat[8];
    const halfH = p.thickness * 0.5 * p.scale;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = 'rgb(52, 50, 78)';
    const crackStroke = p.lifeRatio > 0.5 ? 'rgba(246, 178, 255, 0.92)' : 'rgba(255, 198, 120, 0.72)';

    const projectedCells: Array<{ pts: Array<{ x: number; y: number }>; flags: Uint8Array }> = [];
    for (const sc of p.subCells) {
      const polyCount = sc.verts.length / 2;
      if (polyCount < 3) continue;
      const pts: Array<{ x: number; y: number }> = [];
      ctx.beginPath();
      for (let i = 0; i < polyCount; i++) {
        const lx = sc.verts[i * 2] * p.scale;
        const ly = sc.verts[i * 2 + 1] * p.scale;
        const wx = p.posX + m00 * lx + m01 * ly + m02 * halfH;
        const wy = p.posY + m10 * lx + m11 * ly + m12 * halfH;
        const wz = p.posZ + m20 * lx + m21 * ly + m22 * halfH;
        const pt = project(wx, wy, wz);
        pts.push(pt);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fill();
      projectedCells.push({ pts, flags: sc.edgeFlags });
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = crackStroke;
    ctx.beginPath();
    for (const cell of projectedCells) {
      const n = cell.pts.length;
      for (let i = 0; i < n; i++) {
        if ((cell.flags[i] & 2) === 0) continue;
        const a = cell.pts[i];
        const b = cell.pts[(i + 1) % n];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}
