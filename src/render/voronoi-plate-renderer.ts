import type { RelicFracturePlate, RenderPassContext } from './render-types';
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

const plateGlHandlesByGl = new WeakMap<WebGL2RenderingContext, PlateGlHandles>();
const plateUniformsByProg = new WeakMap<WebGLProgram, PlateUniforms>();
const clusterTexByGl = new WeakMap<WebGL2RenderingContext, WebGLTexture>();
const clusterUniformByProg = new WeakMap<WebGLProgram, WebGLUniformLocation | null>();
const clusterTexStateByRctx = new WeakMap<RenderPassContext, { data: Uint8Array; dirty: boolean }>();

const sharedPositions = new Float32Array(MAX_PLATE_VERTS * 3);
const sharedNormals = new Float32Array(MAX_PLATE_VERTS * 3);
const sharedUvs = new Float32Array(MAX_PLATE_VERTS * 2);
const sharedSolidIndices = new Uint16Array(MAX_PLATE_INDICES);
const sharedFadeIndices = new Uint16Array(MAX_PLATE_INDICES);

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

function rotateAxisAngle(
  vx: number,
  vy: number,
  vz: number,
  kx: number,
  ky: number,
  angle: number
): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kDotV = kx * vx + ky * vy;
  const cxX = -ky * vz;
  const cxY = kx * vz;
  const cxZ = kx * vy - ky * vx;
  return [vx * c + cxX * s + kx * kDotV * (1 - c), vy * c + cxY * s + ky * kDotV * (1 - c), vz * c + cxZ * s];
}

function transformPlatePoint(
  p: RelicFracturePlate,
  lx: number,
  ly: number,
  lz: number,
  peelAngle: number,
  spinAngle: number
): [number, number, number] {
  const [hx, hy, hz] = rotateAxisAngle(lx * p.scale, ly * p.scale, lz * p.scale, p.tanX, p.tanY, peelAngle);
  const [rx, ry, rz] = rotateRelicVec(hx, hy, hz, p.initTiltX, p.initTiltY, p.initTwistZ + spinAngle);
  return [p.posX + rx, p.posY + ry, p.posZ + rz];
}

function transformPlateNormal(
  p: RelicFracturePlate,
  nx: number,
  ny: number,
  nz: number,
  peelAngle: number,
  spinAngle: number
): [number, number, number] {
  const [hx, hy, hz] = rotateAxisAngle(nx, ny, nz, p.tanX, p.tanY, peelAngle);
  return rotateRelicVec(hx, hy, hz, p.initTiltX, p.initTiltY, p.initTwistZ + spinAngle);
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
 * Packs extruded 3D polygonal slab buffers for all currently detached `rctx.relicPlates`,
 * keeping fused multi-cell internal seams completely seamless while glowing & extruding external boundaries.
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

    let plateNeededVerts = 0;
    let plateNeededIndices = 0;
    for (let si = 0; si < p.subCells.length; si++) {
      const n = p.subCells[si].verts.length / 2;
      plateNeededVerts += 2 + n * 6;
      plateNeededIndices += n * 12;
    }

    const isSolid = p.lifeRatio >= SOLID_LIFE_THRESHOLD;
    const curIdxCount = isSolid ? solidIdxCount : fadeIdxCount;
    if (
      vertCount + plateNeededVerts > MAX_PLATE_VERTS ||
      curIdxCount + plateNeededIndices > MAX_PLATE_INDICES
    ) {
      break;
    }

    const localT = Math.max(0, p.elapsedSec - p.detachDelaySec);
    const peelAngle = 0.08 + p.peelAngVel * localT;
    const spinAngle = p.spinVel * localT;
    const halfH = p.thickness * 0.5;
    const targetIndices = isSolid ? sharedSolidIndices : sharedFadeIndices;
    let idxOut = curIdxCount;

    const writeVert = (
      x: number,
      y: number,
      z: number,
      nx: number,
      ny: number,
      nz: number,
      u: number,
      v: number
    ): number => {
      const vi = vertCount++;
      sharedPositions[vi * 3] = x;
      sharedPositions[vi * 3 + 1] = y;
      sharedPositions[vi * 3 + 2] = z;
      sharedNormals[vi * 3] = nx;
      sharedNormals[vi * 3 + 1] = ny;
      sharedNormals[vi * 3 + 2] = nz;
      sharedUvs[vi * 2] = u;
      sharedUvs[vi * 2 + 1] = v;
      return vi;
    };

    const [tnx, tny, tnz] = transformPlateNormal(p, 0, 0, 1, peelAngle, spinAngle);

    for (let si = 0; si < p.subCells.length; si++) {
      const sc = p.subCells[si];
      const polyCount = sc.verts.length / 2;
      if (polyCount < 3) continue;

      const [tcx, tcy, tcz] = transformPlatePoint(p, sc.centerX, sc.centerY, halfH, peelAngle, spinAngle);
      const topCenter = writeVert(tcx, tcy, tcz, tnx, tny, tnz, 0.0, p.lifeRatio);
      const topRing: number[] = [];
      const botRing: number[] = [];

      for (let i = 0; i < polyCount; i++) {
        const prevFlag = sc.edgeFlags[(i + polyCount - 1) % polyCount];
        const curFlag = sc.edgeFlags[i];
        const incident = prevFlag | curFlag;
        const topU = (incident & 2) !== 0 ? 0.92 : (incident & 1) !== 0 ? 0.7 : 0.0;
        const lx = sc.verts[i * 2];
        const ly = sc.verts[i * 2 + 1];
        const [tx, ty, tz] = transformPlatePoint(p, lx, ly, halfH, peelAngle, spinAngle);
        topRing.push(writeVert(tx, ty, tz, tnx, tny, tnz, topU, p.lifeRatio));
      }

      const [bcx, bcy, bcz] = transformPlatePoint(p, sc.centerX, sc.centerY, -halfH, peelAngle, spinAngle);
      const botCenter = writeVert(bcx, bcy, bcz, -tnx, -tny, -tnz, 0.2, p.lifeRatio);
      for (let i = 0; i < polyCount; i++) {
        const prevFlag = sc.edgeFlags[(i + polyCount - 1) % polyCount];
        const curFlag = sc.edgeFlags[i];
        const incident = prevFlag | curFlag;
        const botU = (incident & 2) !== 0 ? 0.92 : (incident & 1) !== 0 ? 0.7 : 0.2;
        const lx = sc.verts[i * 2];
        const ly = sc.verts[i * 2 + 1];
        const [bx, by, bz] = transformPlatePoint(p, lx, ly, -halfH, peelAngle, spinAngle);
        botRing.push(writeVert(bx, by, bz, -tnx, -tny, -tnz, botU, p.lifeRatio));
      }

      for (let i = 0; i < polyCount; i++) {
        const next = (i + 1) % polyCount;
        targetIndices[idxOut++] = topCenter;
        targetIndices[idxOut++] = topRing[i];
        targetIndices[idxOut++] = topRing[next];

        targetIndices[idxOut++] = botCenter;
        targetIndices[idxOut++] = botRing[next];
        targetIndices[idxOut++] = botRing[i];

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
        const [snx, sny, snz] = transformPlateNormal(p, -ey / eLen, ex / eLen, 0.14, peelAngle, spinAngle);

        const [t0x, t0y, t0z] = transformPlatePoint(p, ax, ay, halfH, peelAngle, spinAngle);
        const [b0x, b0y, b0z] = transformPlatePoint(p, ax, ay, -halfH, peelAngle, spinAngle);
        const [b1x, b1y, b1z] = transformPlatePoint(p, bx, by, -halfH, peelAngle, spinAngle);
        const [t1x, t1y, t1z] = transformPlatePoint(p, bx, by, halfH, peelAngle, spinAngle);

        const st0 = writeVert(t0x, t0y, t0z, snx, sny, snz, wallU, p.lifeRatio);
        const sb0 = writeVert(b0x, b0y, b0z, snx, sny, snz, wallU, p.lifeRatio);
        const sb1 = writeVert(b1x, b1y, b1z, snx, sny, snz, wallU, p.lifeRatio);
        const st1 = writeVert(t1x, t1y, t1z, snx, sny, snz, wallU, p.lifeRatio);

        targetIndices[idxOut++] = st0;
        targetIndices[idxOut++] = sb0;
        targetIndices[idxOut++] = sb1;
        targetIndices[idxOut++] = st0;
        targetIndices[idxOut++] = sb1;
        targetIndices[idxOut++] = st1;
      }
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
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sharedSolidIndices.byteLength, gl.DYNAMIC_DRAW);
  gl.bindVertexArray(null);

  const created = { vao, posBuf, normBuf, uvBuf, idxBuf };
  plateGlHandlesByGl.set(gl, created);
  return created;
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

  if (built.solidIndexCount > 0) {
    gl.depthMask(true);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, sharedSolidIndices.subarray(0, built.solidIndexCount));
    gl.drawElements(gl.TRIANGLES, built.solidIndexCount, gl.UNSIGNED_SHORT, 0);
  }
  if (built.fadeIndexCount > 0) {
    gl.depthMask(false);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, sharedFadeIndices.subarray(0, built.fadeIndexCount));
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
        const [wx, wy, wz] = transformPlatePoint(
          p,
          sc.verts[i * 2],
          sc.verts[i * 2 + 1],
          p.thickness * 0.5,
          peelAngle,
          spinAngle
        );
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
