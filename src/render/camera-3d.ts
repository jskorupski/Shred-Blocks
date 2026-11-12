/**
 * High-angle (~78° pitch, FOV = 34°) 3D perspective tabletop camera for ShredBlocks: Color Jam.
 *
 * Coordinate System Convention:
 * - World X = continuous board column `col` (`0 .. cols`, increasing left -> right)
 * - World Y = continuous board row `row` (`0 .. rows`, increasing top -> bottom)
 * - World Z = height above the tray floor (`Z = 0` is tray floor, `Z = 0.58` is standard block top,
 *   lifted blocks rise by `+0.35Z`).
 *
 * Constant-Plane Ray Unprojection (`PERF-01`):
 * `screenToBoardRayPlane` always intersects the pointer ray with the constant horizontal
 * reference plane `Z_ref = 0.58` regardless of whether a block is resting or lifted,
 * eliminating perspective feedback oscillation during drag.
 */

export const REFERENCE_PLANE_Z = 0.58;
export const BLOCK_TOP_Z = 0.58;
export const BLOCK_LIFT_DELTA_Z = 0.46;
export const DEFAULT_PITCH_DEG = 78;
export const DEFAULT_FOV_DEG = 34;

export function computeBoardTargetAspect(rows: number, cols: number): number {
  return rows === cols ? 1 : Math.max(0.65, Math.min(1.25, (cols + 1.55) / (rows + 1.55)));
}

export function measureStageContentBox(
  canvas: HTMLCanvasElement,
  fallbackW: number,
  fallbackH: number
): [number, number] {
  const stage = canvas.parentElement;
  if (stage && typeof window !== 'undefined') {
    const sr = stage.getBoundingClientRect();
    if (sr.width > 1 && sr.height > 1) {
      const cs = window.getComputedStyle(stage);
      const padX = (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0);
      const padY = (Number.parseFloat(cs.paddingTop) || 0) + (Number.parseFloat(cs.paddingBottom) || 0);
      return [Math.max(1, sr.width - padX), Math.max(1, sr.height - padY)];
    }
  }
  return [fallbackW, fallbackH];
}

export function computeBoardBleedFraming(
  rows: number,
  cols: number,
  canvasCssW: number,
  canvasCssH: number,
  stageContentW = canvasCssW,
  stageContentH = canvasCssH
): { boardAspect: number; scaleX: number; scaleY: number } {
  const safeW = Math.max(1, canvasCssW);
  const safeH = Math.max(1, canvasCssH);
  const cqw = stageContentW > 1 ? stageContentW : safeW;
  const cqh = stageContentH > 1 ? stageContentH : safeH;
  const boardAspect = computeBoardTargetAspect(rows, cols);
  const boardBoxW = Math.min(0.96 * cqw, 0.82 * cqh * boardAspect, 550 * boardAspect);
  const boardBoxH = boardBoxW / boardAspect;
  const fitMul = Math.min(1, safeW / Math.max(1, boardBoxW), safeH / Math.max(1, boardBoxH));
  return {
    boardAspect,
    scaleX: (boardBoxW * fitMul) / safeW,
    scaleY: (boardBoxH * fitMul) / safeH,
  };
}

export class Camera3D {
  private rows = 6;
  private cols = 6;
  private aspect = 1;
  private scaleX = 1;
  private scaleY = 1;
  private pitchDeg = DEFAULT_PITCH_DEG;
  private fovDeg = DEFAULT_FOV_DEG;
  private near = 0.5;
  private far = 60.0;
  private distance = 14.5;

  private readonly viewMatrix = new Float32Array(16);
  private readonly projMatrixWebGL = new Float32Array(16);
  private readonly projMatrixWebGPU = new Float32Array(16);
  private readonly vpMatrixWebGL = new Float32Array(16);
  private readonly vpMatrixWebGPU = new Float32Array(16);

  private eyeX = 3;
  private eyeY = 5.5;
  private eyeZ = 14.0;

  constructor(rows = 6, cols = 6, aspect = 1) {
    this.setBoardAndViewport(rows, cols, aspect);
  }

  /**
   * Updates the camera framing for a `rows × cols` board tray, inner board `aspect = boxW / boxH`,
   * and optional particle-bleed canvas focal scales `(scaleX = boxW / canvasW, scaleY = boxH / canvasH)`.
   */
  public setBoardAndViewport(rows: number, cols: number, aspect: number, scaleX = 1, scaleY = 1): void {
    const safeRows = Math.max(1, rows);
    const safeCols = Math.max(1, cols);
    const safeAspect = Number.isFinite(aspect) && aspect > 0.05 ? aspect : 1;
    const safeScaleX = Number.isFinite(scaleX) && scaleX > 0.05 ? scaleX : 1;
    const safeScaleY = Number.isFinite(scaleY) && scaleY > 0.05 ? scaleY : 1;

    if (
      this.rows === safeRows &&
      this.cols === safeCols &&
      Math.abs(this.aspect - safeAspect) < 1e-6 &&
      Math.abs(this.scaleX - safeScaleX) < 1e-6 &&
      Math.abs(this.scaleY - safeScaleY) < 1e-6 &&
      this.viewMatrix[15] === 1
    ) {
      return;
    }

    this.rows = safeRows;
    this.cols = safeCols;
    this.aspect = safeAspect;
    this.scaleX = safeScaleX;
    this.scaleY = safeScaleY;
    this.recomputeMatrices();
  }

  public getEyePosition(): readonly [number, number, number] {
    return [this.eyeX, this.eyeY, this.eyeZ];
  }

  public getRows(): number {
    return this.rows;
  }

  public getCols(): number {
    return this.cols;
  }

  public getAspect(): number {
    return this.aspect;
  }

  private recomputeMatrices(): void {
    const halfFovRad = (this.fovDeg * Math.PI) / 360;
    const tanHalfFovY = Math.tan(halfFovRad);
    const tanHalfFovX = tanHalfFovY * this.aspect;

    // Frame the full rows x cols board plus perimeter walls, gates, and rollers (~1.55 cells margin)
    const spanY = this.rows + 1.55;
    const spanX = this.cols + 1.55;

    const pitchRad = (this.pitchDeg * Math.PI) / 180;
    const sinPitch = Math.sin(pitchRad);
    const cosPitch = Math.cos(pitchRad);

    const frontDepthOffset = spanY * 0.5 * cosPitch + 0.65 * sinPitch;
    const distForY = (spanY * 0.5 * sinPitch) / tanHalfFovY + frontDepthOffset + 0.35;
    const distForX = (spanX * 0.5) / Math.max(0.05, tanHalfFovX) + frontDepthOffset + 0.35;
    this.distance = Math.max(8.5, distForX, distForY);

    // Center the view on the board midpoint at the block mid-plane
    const targetX = this.cols * 0.5;
    const targetY = this.rows * 0.5 + 0.08;
    const targetZ = REFERENCE_PLANE_Z * 0.5;

    this.eyeX = targetX;
    this.eyeY = targetY + this.distance * cosPitch;
    this.eyeZ = targetZ + this.distance * sinPitch;

    // Orthonormal camera basis in world coordinates (worldX = col, worldY = row, worldZ = height):
    // right   = [1, 0, 0]
    // up      = [0, -sinPitch, cosPitch]  (points toward row=0 TOP edge and +Z height)
    // back    = [0, cosPitch, sinPitch]   (points from target toward camera eye)
    const rx = 1;
    const ry = 0;
    const rz = 0;

    const ux = 0;
    const uy = -sinPitch;
    const uz = cosPitch;

    const bx = 0;
    const by = cosPitch;
    const bz = sinPitch;

    const vm = this.viewMatrix;
    vm[0] = rx;
    vm[1] = ux;
    vm[2] = bx;
    vm[3] = 0;

    vm[4] = ry;
    vm[5] = uy;
    vm[6] = by;
    vm[7] = 0;

    vm[8] = rz;
    vm[9] = uz;
    vm[10] = bz;
    vm[11] = 0;

    vm[12] = -(rx * this.eyeX + ry * this.eyeY + rz * this.eyeZ);
    vm[13] = -(ux * this.eyeX + uy * this.eyeY + uz * this.eyeZ);
    vm[14] = -(bx * this.eyeX + by * this.eyeY + bz * this.eyeZ);
    vm[15] = 1;

    const f = 1.0 / tanHalfFovY;
    const near = this.near;
    const far = this.far;
    const nf = 1.0 / (near - far);

    // WebGL2 [-1, +1] Z clip space projection matrix
    const pmGL = this.projMatrixWebGL;
    pmGL.fill(0);
    pmGL[0] = (f / this.aspect) * this.scaleX;
    pmGL[5] = f * this.scaleY;
    pmGL[10] = (far + near) * nf;
    pmGL[11] = -1;
    pmGL[14] = 2 * far * near * nf;

    // WebGPU [0, 1] Z clip space projection matrix
    const pmGPU = this.projMatrixWebGPU;
    pmGPU.fill(0);
    pmGPU[0] = (f / this.aspect) * this.scaleX;
    pmGPU[5] = f * this.scaleY;
    pmGPU[10] = far * nf;
    pmGPU[11] = -1;
    pmGPU[14] = far * near * nf;

    multiplyMat4(this.vpMatrixWebGL, pmGL, vm);
    multiplyMat4(this.vpMatrixWebGPU, pmGPU, vm);
  }

  public getProjectionMatrix(zeroToOneDepth: boolean): Float32Array {
    return zeroToOneDepth ? this.projMatrixWebGPU : this.projMatrixWebGL;
  }

  public getViewMatrix(): Float32Array {
    return this.viewMatrix;
  }

  public getViewProjectionMatrix(zeroToOneDepth: boolean): Float32Array {
    return zeroToOneDepth ? this.vpMatrixWebGPU : this.vpMatrixWebGL;
  }

  /**
   * Unprojects a screen pointer `(clientX, clientY)` onto the constant horizontal reference
   * plane `Z_ref = 0.58` (`PERF-01`). Because `Z_ref` is invariant to whether a block is
   * resting or lifted (`+0.35Z`), dragging never suffers from perspective feedback oscillation.
   */
  public screenToBoardRayPlane(
    clientX: number,
    clientY: number,
    canvasRect: DOMRect,
    rows: number,
    cols: number,
    scaleX = 1,
    scaleY = 1,
    boardAspect?: number
  ): { boardX: number; boardY: number } {
    const width = Math.max(1, canvasRect.width);
    const height = Math.max(1, canvasRect.height);
    this.setBoardAndViewport(rows, cols, boardAspect ?? width / height, scaleX, scaleY);

    const ndcX = ((clientX - canvasRect.left) / width) * 2 - 1;
    const ndcY = 1 - ((clientY - canvasRect.top) / height) * 2;

    const pitchRad = (this.pitchDeg * Math.PI) / 180;
    const sinPitch = Math.sin(pitchRad);
    const cosPitch = Math.cos(pitchRad);

    // Exact inverse of projMatrixWebGL focal scales on the z_cam = -1 plane
    const dirCamX = ndcX / this.projMatrixWebGL[0];
    const dirCamY = ndcY / this.projMatrixWebGL[5];
    const dirCamZ = -1;

    // Transform direction to world space via transpose of view rotation
    // right = [1, 0, 0], up = [0, -sinPitch, cosPitch], back = [0, cosPitch, sinPitch]
    const rayDirX = dirCamX;
    const rayDirY = -sinPitch * dirCamY + cosPitch * dirCamZ;
    const rayDirZ = cosPitch * dirCamY + sinPitch * dirCamZ;

    // Intersect ray `eye + t * rayDir` with horizontal plane `Z = REFERENCE_PLANE_Z` (0.58)
    const safeRayZ = Math.abs(rayDirZ) < 1e-6 ? -1e-6 : rayDirZ;
    const t = (REFERENCE_PLANE_Z - this.eyeZ) / safeRayZ;

    const boardX = this.eyeX + t * rayDirX;
    const boardY = this.eyeY + t * rayDirY;

    return { boardX, boardY };
  }

  /**
   * Projects a 3D board coordinate `(boardX, boardY, worldZ)` using the current `vpMatrixWebGL`
   * into a `(left, top, width, height)` screen/canvas rectangle.
   */
  public projectToRect(
    boardX: number,
    boardY: number,
    worldZ: number,
    left: number,
    top: number,
    width: number,
    height: number
  ): { x: number; y: number } {
    const vp = this.vpMatrixWebGL;
    const clipX = vp[0] * boardX + vp[4] * boardY + vp[8] * worldZ + vp[12];
    const clipY = vp[1] * boardX + vp[5] * boardY + vp[9] * worldZ + vp[13];
    const clipW = vp[3] * boardX + vp[7] * boardY + vp[11] * worldZ + vp[15];

    const invW = Math.abs(clipW) > 1e-6 ? 1.0 / clipW : 1.0;
    const ndcX = clipX * invW;
    const ndcY = clipY * invW;

    return {
      x: left + (ndcX * 0.5 + 0.5) * width,
      y: top + (0.5 - ndcY * 0.5) * height,
    };
  }

  /**
   * Projects a 3D board coordinate `(boardX, boardY, worldZ)` into client screen coordinates `(x, y)`.
   */
  public boardToScreen(
    boardX: number,
    boardY: number,
    worldZ: number,
    canvasRect: DOMRect,
    rows: number,
    cols: number,
    scaleX = 1,
    scaleY = 1,
    boardAspect?: number
  ): { x: number; y: number } {
    const width = Math.max(1, canvasRect.width);
    const height = Math.max(1, canvasRect.height);
    this.setBoardAndViewport(rows, cols, boardAspect ?? width / height, scaleX, scaleY);
    return this.projectToRect(boardX, boardY, worldZ, canvasRect.left, canvasRect.top, width, height);
  }
}

function multiplyMat4(out: Float32Array, a: Float32Array, b: Float32Array): void {
  const a00 = a[0],
    a01 = a[1],
    a02 = a[2],
    a03 = a[3];
  const a10 = a[4],
    a11 = a[5],
    a12 = a[6],
    a13 = a[7];
  const a20 = a[8],
    a21 = a[9],
    a22 = a[10],
    a23 = a[11];
  const a30 = a[12],
    a31 = a[13],
    a32 = a[14],
    a33 = a[15];

  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4];
    const b1 = b[col * 4 + 1];
    const b2 = b[col * 4 + 2];
    const b3 = b[col * 4 + 3];

    out[col * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[col * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[col * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[col * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
}
