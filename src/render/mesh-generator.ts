import { POLYOMINO_SHAPES, type PolyominoShape } from '../core/polyomino';
import type { SkinId } from '../core/types';

export const STD_INSET = 0.04;
export const CORE_INSET = 0.16;
export const BLOCK_HEIGHT = 0.58;

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

export interface PolyominoMeshEntry {
  shapeId: string;
  /** Standard outer shell (`p_std = 0.04` Euclidean perimeter normal inset) */
  meshOuter: MeshData;
  /** Inner nested core shell (`p_core = 0.16` Euclidean perimeter normal inset) */
  meshInnerCore: MeshData;
  /** Outer shell with top cylindrical studs (`classic_studs` skin) */
  meshOuterStudded: MeshData;
  /** Inner nested core shell with top cylindrical studs (`classic_studs` skin) */
  meshInnerCoreStudded: MeshData;
}

class MeshBuilder {
  public readonly positions: number[] = [];
  public readonly normals: number[] = [];
  public readonly uvs: number[] = [];
  public readonly indices: number[] = [];

  public addVertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number
  ): number {
    const idx = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    return idx;
  }

  /**
   * Adds a quad whose 4 vertices `(v0, v1, v2, v3)` are wound so that in screen space
   * (where `+X` is right, `+Y` is down, `+Z` is up toward the camera) its outward face
   * is Counter-Clockwise (`gl_FrontFacing == true` under default `gl.CCW`).
   */
  public addQuad(
    x0: number,
    y0: number,
    z0: number,
    u0: number,
    v0: number,
    x1: number,
    y1: number,
    z1: number,
    u1: number,
    v1: number,
    x2: number,
    y2: number,
    z2: number,
    u2: number,
    v2: number,
    x3: number,
    y3: number,
    z3: number,
    u3: number,
    v3: number,
    nx: number,
    ny: number,
    nz: number
  ): void {
    const i0 = this.addVertex(x0, y0, z0, nx, ny, nz, u0, v0);
    const i1 = this.addVertex(x1, y1, z1, nx, ny, nz, u1, v1);
    const i2 = this.addVertex(x2, y2, z2, nx, ny, nz, u2, v2);
    const i3 = this.addVertex(x3, y3, z3, nx, ny, nz, u3, v3);
    this.indices.push(i0, i1, i2, i0, i2, i3);
  }

  public toMeshData(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      indices: new Uint16Array(this.indices),
    };
  }
}

function gridLineX(gx: number, p: number): number {
  const c = Math.floor(gx / 3);
  const rem = gx % 3;
  if (rem === 0) return c;
  if (rem === 1) return c + p;
  return c + 1 - p;
}

function gridLineY(gy: number, p: number): number {
  const r = Math.floor(gy / 3);
  const rem = gy % 3;
  if (rem === 0) return r;
  if (rem === 1) return r + p;
  return r + 1 - p;
}

/**
 * Generates a morphological 3D polyomino shell using the Constant Euclidean Perimeter Normal
 * Inset theorem on a `3 × 3` sub-cell decomposition per occupied cell `(dr, dc)`:
 * - Every exterior perimeter edge (convex or concave) is inset along its exact inward Euclidean
 *   normal by `inset` (`p_std = 0.04` for outer shell, `p_core = 0.16` for inner core shell).
 * - Includes vertical side skirts (`Z = zBottom .. zTop - bevelZ`), 45-degree 3D edge chamfers,
 *   beveled top cap, and optional top cylindrical studs (`withStuds`).
 */
export function buildMorphologicalPolyominoMesh(
  shape: PolyominoShape,
  inset: number,
  options: {
    zBottom?: number;
    zTop?: number;
    bevelXY?: number;
    bevelZ?: number;
    recessedInnerCavity?: boolean;
    withStuds?: boolean;
    studRadius?: number;
  } = {}
): MeshData {
  const zBottom = options.zBottom ?? 0.0;
  const zTop = options.zTop ?? BLOCK_HEIGHT;
  const bevelXY = options.bevelXY ?? 0.036;
  const bevelZ = options.bevelZ ?? 0.055;
  const recessedInnerCavity = options.recessedInnerCavity ?? false;
  const withStuds = options.withStuds ?? false;
  const studRadius = options.studRadius ?? 0.18;

  const { rows, cols, cells } = shape;
  const occSet = new Set<string>();
  for (const [r, c] of cells) {
    occSet.add(`${r},${c}`);
  }
  const hasCell = (r: number, c: number): boolean => occSet.has(`${r},${c}`);

  const subRows = rows * 3;
  const subCols = cols * 3;
  const activeSub = new Uint8Array(subRows * subCols);

  for (const [r, c] of cells) {
    const hasT = hasCell(r - 1, c);
    const hasB = hasCell(r + 1, c);
    const hasL = hasCell(r, c - 1);
    const hasR = hasCell(r, c + 1);
    const hasTL = hasCell(r - 1, c - 1);
    const hasTR = hasCell(r - 1, c + 1);
    const hasBL = hasCell(r + 1, c - 1);
    const hasBR = hasCell(r + 1, c + 1);

    const setSub = (sr: number, sc: number, val: boolean) => {
      if (val) {
        activeSub[(r * 3 + sr) * subCols + (c * 3 + sc)] = 1;
      }
    };

    // Center sub-cell is always occupied
    setSub(1, 1, true);
    // Orthogonal bridge strips
    setSub(0, 1, hasT);
    setSub(2, 1, hasB);
    setSub(1, 0, hasL);
    setSub(1, 2, hasR);
    // Corner bridge quads (occupied only at interior 2x2 junctions)
    setSub(0, 0, hasT && hasL && hasTL);
    setSub(0, 2, hasT && hasR && hasTR);
    setSub(2, 0, hasB && hasL && hasBL);
    setSub(2, 2, hasB && hasR && hasBR);
  }

  const isSubActive = (gr: number, gc: number): boolean => {
    if (gr < 0 || gr >= subRows || gc < 0 || gc >= subCols) return false;
    return activeSub[gr * subCols + gc] === 1;
  };

  const pOuter = inset;
  const pBevel = Math.min(0.46, inset + bevelXY);
  const zShoulder = Math.max(zBottom + 0.05, zTop - bevelZ);

  const builder = new MeshBuilder();
  const invCols = 1 / Math.max(1, cols);
  const invRows = 1 / Math.max(1, rows);
  const invSqrt2 = Math.SQRT1_2;

  // 1. Exterior Perimeter Side Skirts & 3D Chamfered Bevel Rim
  for (let gr = 0; gr < subRows; gr++) {
    for (let gc = 0; gc < subCols; gc++) {
      if (!isSubActive(gr, gc)) continue;

      const x0Outer = gridLineX(gc, pOuter);
      const x1Outer = gridLineX(gc + 1, pOuter);
      const y0Outer = gridLineY(gr, pOuter);
      const y1Outer = gridLineY(gr + 1, pOuter);

      const x0Bev = gridLineX(gc, pBevel);
      const x1Bev = gridLineX(gc + 1, pBevel);
      const y0Bev = gridLineY(gr, pBevel);
      const y1Bev = gridLineY(gr + 1, pBevel);

      // TOP exterior boundary (normal = [0, -1, 0])
      if (!isSubActive(gr - 1, gc)) {
        // Side skirt (zBottom -> zShoulder)
        builder.addQuad(
          x0Outer,
          y0Outer,
          zShoulder,
          x0Outer * invCols,
          0,
          x1Outer,
          y0Outer,
          zShoulder,
          x1Outer * invCols,
          0,
          x1Outer,
          y0Outer,
          zBottom,
          x1Outer * invCols,
          1,
          x0Outer,
          y0Outer,
          zBottom,
          x0Outer * invCols,
          1,
          0,
          -1,
          0
        );
        // Chamfer bevel (zShoulder -> zTop)
        builder.addQuad(
          x0Bev,
          y0Bev,
          zTop,
          x0Bev * invCols,
          y0Bev * invRows,
          x1Bev,
          y0Bev,
          zTop,
          x1Bev * invCols,
          y0Bev * invRows,
          x1Outer,
          y0Outer,
          zShoulder,
          x1Outer * invCols,
          y0Outer * invRows,
          x0Outer,
          y0Outer,
          zShoulder,
          x0Outer * invCols,
          y0Outer * invRows,
          0,
          -invSqrt2,
          invSqrt2
        );
      }

      // BOTTOM exterior boundary (normal = [0, +1, 0])
      if (!isSubActive(gr + 1, gc)) {
        builder.addQuad(
          x0Outer,
          y1Outer,
          zBottom,
          x0Outer * invCols,
          1,
          x1Outer,
          y1Outer,
          zBottom,
          x1Outer * invCols,
          1,
          x1Outer,
          y1Outer,
          zShoulder,
          x1Outer * invCols,
          0,
          x0Outer,
          y1Outer,
          zShoulder,
          x0Outer * invCols,
          0,
          0,
          1,
          0
        );
        builder.addQuad(
          x0Outer,
          y1Outer,
          zShoulder,
          x0Outer * invCols,
          y1Outer * invRows,
          x1Outer,
          y1Outer,
          zShoulder,
          x1Outer * invCols,
          y1Outer * invRows,
          x1Bev,
          y1Bev,
          zTop,
          x1Bev * invCols,
          y1Bev * invRows,
          x0Bev,
          y1Bev,
          zTop,
          x0Bev * invCols,
          y1Bev * invRows,
          0,
          invSqrt2,
          invSqrt2
        );
      }

      // LEFT exterior boundary (normal = [-1, 0, 0])
      if (!isSubActive(gr, gc - 1)) {
        builder.addQuad(
          x0Outer,
          y0Outer,
          zBottom,
          y0Outer * invRows,
          1,
          x0Outer,
          y1Outer,
          zBottom,
          y1Outer * invRows,
          1,
          x0Outer,
          y1Outer,
          zShoulder,
          y1Outer * invRows,
          0,
          x0Outer,
          y0Outer,
          zShoulder,
          y0Outer * invRows,
          0,
          -1,
          0,
          0
        );
        builder.addQuad(
          x0Outer,
          y0Outer,
          zShoulder,
          x0Outer * invCols,
          y0Outer * invRows,
          x0Outer,
          y1Outer,
          zShoulder,
          x0Outer * invCols,
          y1Outer * invRows,
          x0Bev,
          y1Bev,
          zTop,
          x0Bev * invCols,
          y1Bev * invRows,
          x0Bev,
          y0Bev,
          zTop,
          x0Bev * invCols,
          y0Bev * invRows,
          -invSqrt2,
          0,
          invSqrt2
        );
      }

      // RIGHT exterior boundary (normal = [+1, 0, 0])
      if (!isSubActive(gr, gc + 1)) {
        builder.addQuad(
          x1Outer,
          y0Outer,
          zShoulder,
          y0Outer * invRows,
          0,
          x1Outer,
          y1Outer,
          zShoulder,
          y1Outer * invRows,
          0,
          x1Outer,
          y1Outer,
          zBottom,
          y1Outer * invRows,
          1,
          x1Outer,
          y0Outer,
          zBottom,
          y0Outer * invRows,
          1,
          1,
          0,
          0
        );
        builder.addQuad(
          x1Bev,
          y0Bev,
          zTop,
          x1Bev * invCols,
          y0Bev * invRows,
          x1Bev,
          y1Bev,
          zTop,
          x1Bev * invCols,
          y1Bev * invRows,
          x1Outer,
          y1Outer,
          zShoulder,
          x1Outer * invCols,
          y1Outer * invRows,
          x1Outer,
          y0Outer,
          zShoulder,
          x1Outer * invCols,
          y0Outer * invRows,
          invSqrt2,
          0,
          invSqrt2
        );
      }
    }
  }

  // 2. Top Surface Cap (with optional recessed collar lip for outer shell)
  if (recessedInnerCavity && pBevel < CORE_INSET - 0.015) {
    const pCollarInner = CORE_INSET - 0.008;
    const pCavityFloor = CORE_INSET + 0.005;
    const zCavity = zTop - 0.032;

    for (let gr = 0; gr < subRows; gr++) {
      for (let gc = 0; gc < subCols; gc++) {
        if (!isSubActive(gr, gc)) continue;

        const x0A = gridLineX(gc, pBevel);
        const x1A = gridLineX(gc + 1, pBevel);
        const y0A = gridLineY(gr, pBevel);
        const y1A = gridLineY(gr + 1, pBevel);

        const x0B = gridLineX(gc, pCollarInner);
        const x1B = gridLineX(gc + 1, pCollarInner);
        const y0B = gridLineY(gr, pCollarInner);
        const y1B = gridLineY(gr + 1, pCollarInner);

        const x0C = gridLineX(gc, pCavityFloor);
        const x1C = gridLineX(gc + 1, pCavityFloor);
        const y0C = gridLineY(gr, pCavityFloor);
        const y1C = gridLineY(gr + 1, pCavityFloor);

        // Recessed inner floor at zCavity
        builder.addQuad(
          x0C,
          y0C,
          zCavity,
          x0C * invCols,
          y0C * invRows,
          x0C,
          y1C,
          zCavity,
          x0C * invCols,
          y1C * invRows,
          x1C,
          y1C,
          zCavity,
          x1C * invCols,
          y1C * invRows,
          x1C,
          y0C,
          zCavity,
          x1C * invCols,
          y0C * invRows,
          0,
          0,
          1
        );

        // Raised outer collar rim along exterior edges
        if (!isSubActive(gr - 1, gc)) {
          builder.addQuad(
            x0A,
            y0A,
            zTop,
            x0A * invCols,
            y0A * invRows,
            x0B,
            y0B,
            zTop,
            x0B * invCols,
            y0B * invRows,
            x1B,
            y0B,
            zTop,
            x1B * invCols,
            y0B * invRows,
            x1A,
            y0A,
            zTop,
            x1A * invCols,
            y0A * invRows,
            0,
            0,
            1
          );
          builder.addQuad(
            x0B,
            y0B,
            zTop,
            x0B * invCols,
            y0B * invRows,
            x0C,
            y0C,
            zCavity,
            x0C * invCols,
            y0C * invRows,
            x1C,
            y0C,
            zCavity,
            x1C * invCols,
            y0C * invRows,
            x1B,
            y0B,
            zTop,
            x1B * invCols,
            y0B * invRows,
            0,
            invSqrt2,
            invSqrt2
          );
        }
        if (!isSubActive(gr + 1, gc)) {
          builder.addQuad(
            x0B,
            y1B,
            zTop,
            x0B * invCols,
            y1B * invRows,
            x0A,
            y1A,
            zTop,
            x0A * invCols,
            y1A * invRows,
            x1A,
            y1A,
            zTop,
            x1A * invCols,
            y1A * invRows,
            x1B,
            y1B,
            zTop,
            x1B * invCols,
            y1B * invRows,
            0,
            0,
            1
          );
          builder.addQuad(
            x0C,
            y1C,
            zCavity,
            x0C * invCols,
            y1C * invRows,
            x0B,
            y1B,
            zTop,
            x0B * invCols,
            y1B * invRows,
            x1B,
            y1B,
            zTop,
            x1B * invCols,
            y1B * invRows,
            x1C,
            y1C,
            zCavity,
            x1C * invCols,
            y1C * invRows,
            0,
            -invSqrt2,
            invSqrt2
          );
        }
        if (!isSubActive(gr, gc - 1)) {
          builder.addQuad(
            x0A,
            y0A,
            zTop,
            x0A * invCols,
            y0A * invRows,
            x0A,
            y1A,
            zTop,
            x0A * invCols,
            y1A * invRows,
            x0B,
            y1B,
            zTop,
            x0B * invCols,
            y1B * invRows,
            x0B,
            y0B,
            zTop,
            x0B * invCols,
            y0B * invRows,
            0,
            0,
            1
          );
          builder.addQuad(
            x0B,
            y0B,
            zTop,
            x0B * invCols,
            y0B * invRows,
            x0B,
            y1B,
            zTop,
            x0B * invCols,
            y1B * invRows,
            x0C,
            y1C,
            zCavity,
            x0C * invCols,
            y1C * invRows,
            x0C,
            y0C,
            zCavity,
            x0C * invCols,
            y0C * invRows,
            invSqrt2,
            0,
            invSqrt2
          );
        }
        if (!isSubActive(gr, gc + 1)) {
          builder.addQuad(
            x1B,
            y0B,
            zTop,
            x1B * invCols,
            y0B * invRows,
            x1B,
            y1B,
            zTop,
            x1B * invCols,
            y1B * invRows,
            x1A,
            y1A,
            zTop,
            x1A * invCols,
            y1A * invRows,
            x1A,
            y0A,
            zTop,
            x1A * invCols,
            y0A * invRows,
            0,
            0,
            1
          );
          builder.addQuad(
            x1C,
            y0C,
            zCavity,
            x1C * invCols,
            y0C * invRows,
            x1C,
            y1C,
            zCavity,
            x1C * invCols,
            y1C * invRows,
            x1B,
            y1B,
            zTop,
            x1B * invCols,
            y1B * invRows,
            x1B,
            y0B,
            zTop,
            x1B * invCols,
            y0B * invRows,
            -invSqrt2,
            0,
            invSqrt2
          );
        }
      }
    }
  } else {
    for (let gr = 0; gr < subRows; gr++) {
      for (let gc = 0; gc < subCols; gc++) {
        if (!isSubActive(gr, gc)) continue;
        const x0 = gridLineX(gc, pBevel);
        const x1 = gridLineX(gc + 1, pBevel);
        const y0 = gridLineY(gr, pBevel);
        const y1 = gridLineY(gr + 1, pBevel);

        builder.addQuad(
          x0,
          y0,
          zTop,
          x0 * invCols,
          y0 * invRows,
          x0,
          y1,
          zTop,
          x0 * invCols,
          y1 * invRows,
          x1,
          y1,
          zTop,
          x1 * invCols,
          y1 * invRows,
          x1,
          y0,
          zTop,
          x1 * invCols,
          y0 * invRows,
          0,
          0,
          1
        );
      }
    }
  }

  // 3. Optional Top Cylindrical Studs (`classic_studs` skin)
  if (withStuds) {
    const studBaseZ = recessedInnerCavity ? zTop - 0.032 : zTop;
    const studTopZ = studBaseZ + 0.075;
    const segments = 12;
    for (const [r, c] of cells) {
      const cx = c + 0.5;
      const cy = r + 0.5;
      addCylinderCapToBuilder(
        builder,
        cx,
        cy,
        studBaseZ,
        studTopZ,
        studRadius,
        segments,
        invCols,
        invRows
      );
    }
  }

  return builder.toMeshData();
}

function addCylinderCapToBuilder(
  builder: MeshBuilder,
  cx: number,
  cy: number,
  z0: number,
  z1: number,
  radius: number,
  segments: number,
  invCols: number,
  invRows: number
): void {
  const centerTopIdx = builder.addVertex(cx, cy, z1, 0, 0, 1, cx * invCols, cy * invRows);
  const zBevel = z0 + (z1 - z0) * 0.65;
  const topRadius = radius * 0.82;

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const cos0 = Math.cos(a0);
    const sin0 = Math.sin(a0);
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);

    const x0 = cx + cos0 * radius;
    const y0 = cy + sin0 * radius;
    const x1 = cx + cos1 * radius;
    const y1 = cy + sin1 * radius;

    const tx0 = cx + cos0 * topRadius;
    const ty0 = cy + sin0 * topRadius;
    const tx1 = cx + cos1 * topRadius;
    const ty1 = cy + sin1 * topRadius;

    const midCos = (cos0 + cos1) * 0.5;
    const midSin = (sin0 + sin1) * 0.5;

    // Lower vertical skirt quad
    builder.addQuad(
      x0,
      y0,
      zBevel,
      i / segments,
      0.35,
      x1,
      y1,
      zBevel,
      (i + 1) / segments,
      0.35,
      x1,
      y1,
      z0,
      (i + 1) / segments,
      1,
      x0,
      y0,
      z0,
      i / segments,
      1,
      midCos,
      midSin,
      0.18
    );

    // Upper chamfered bevel ring (catches 360-degree directional rim light and shadow)
    builder.addQuad(
      tx0,
      ty0,
      z1,
      i / segments,
      0,
      tx1,
      ty1,
      z1,
      (i + 1) / segments,
      0,
      x1,
      y1,
      zBevel,
      (i + 1) / segments,
      0.35,
      x0,
      y0,
      zBevel,
      i / segments,
      0.35,
      midCos * 0.58,
      midSin * 0.58,
      0.81
    );

    // Top fan triangle with subtle outward rim normal for crisp circular stud highlight
    const v0 = builder.addVertex(
      tx1,
      ty1,
      z1,
      cos1 * 0.22,
      sin1 * 0.22,
      0.975,
      tx1 * invCols,
      ty1 * invRows
    );
    const v1 = builder.addVertex(
      tx0,
      ty0,
      z1,
      cos0 * 0.22,
      sin0 * 0.22,
      0.975,
      tx0 * invCols,
      ty0 * invRows
    );
    builder.indices.push(centerTopIdx, v0, v1);
  }
}

/**
 * Generates a beveled 3D box mesh spanning `[x0, x1] × [y0, y1] × [z0, z1]`.
 */
export function createBeveledBoxMesh(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  bevel = 0.03
): MeshData {
  const builder = new MeshBuilder();
  const b = Math.min(bevel, (x1 - x0) * 0.25, (y1 - y0) * 0.25, (z1 - z0) * 0.35);
  const bx0 = x0 + b;
  const bx1 = x1 - b;
  const by0 = y0 + b;
  const by1 = y1 - b;
  const bz1 = z1 - b;
  const s = Math.SQRT1_2;

  // Top face
  builder.addQuad(bx0, by0, z1, 0, 0, bx0, by1, z1, 0, 1, bx1, by1, z1, 1, 1, bx1, by0, z1, 1, 0, 0, 0, 1);

  // 4 Chamfered top edges
  // Top-North (-Y)
  builder.addQuad(bx0, by0, z1, 0, 0, bx1, by0, z1, 1, 0, x1, y0, bz1, 1, 1, x0, y0, bz1, 0, 1, 0, -s, s);
  // Top-South (+Y)
  builder.addQuad(x0, y1, bz1, 0, 1, x1, y1, bz1, 1, 1, bx1, by1, z1, 1, 0, bx0, by1, z1, 0, 0, 0, s, s);
  // Top-West (-X)
  builder.addQuad(x0, y0, bz1, 0, 1, x0, y1, bz1, 1, 1, bx0, by1, z1, 1, 0, bx0, by0, z1, 0, 0, -s, 0, s);
  // Top-East (+X)
  builder.addQuad(bx1, by0, z1, 0, 0, bx1, by1, z1, 1, 0, x1, y1, bz1, 1, 1, x1, y0, bz1, 0, 1, s, 0, s);

  // 4 Vertical sides
  // North (-Y)
  builder.addQuad(x0, y0, bz1, 0, 0, x1, y0, bz1, 1, 0, x1, y0, z0, 1, 1, x0, y0, z0, 0, 1, 0, -1, 0);
  // South (+Y)
  builder.addQuad(x0, y1, z0, 0, 1, x1, y1, z0, 1, 1, x1, y1, bz1, 1, 0, x0, y1, bz1, 0, 0, 0, 1, 0);
  // West (-X)
  builder.addQuad(x0, y0, z0, 0, 1, x0, y1, z0, 1, 1, x0, y1, bz1, 1, 0, x0, y0, bz1, 0, 0, -1, 0, 0);
  // East (+X)
  builder.addQuad(x1, y0, bz1, 0, 0, x1, y1, bz1, 1, 0, x1, y1, z0, 1, 1, x1, y0, z0, 0, 1, 1, 0, 0);

  return builder.toMeshData();
}

/**
 * Generates a fluted 3D shredder roller cylinder along the X axis (`[-0.5, +0.5]`, radius `1.0`)
 * so that rotating around its local axis produces visible mechanical shredder teeth rotation.
 */
export function createShredderRollerMesh(segments = 16): MeshData {
  const builder = new MeshBuilder();
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    // Alternate flute ridge radius for visible mechanical gear teeth
    const r0 = i % 2 === 0 ? 1.0 : 0.78;
    const r1 = (i + 1) % 2 === 0 ? 1.0 : 0.78;

    const y0 = Math.cos(a0) * r0;
    const z0 = Math.sin(a0) * r0;
    const y1 = Math.cos(a1) * r1;
    const z1 = Math.sin(a1) * r1;

    const ny = Math.cos((a0 + a1) * 0.5);
    const nz = Math.sin((a0 + a1) * 0.5);

    builder.addQuad(
      -0.48,
      y1,
      z1,
      0,
      (i + 1) / segments,
      -0.48,
      y0,
      z0,
      0,
      i / segments,
      0.48,
      y0,
      z0,
      1,
      i / segments,
      0.48,
      y1,
      z1,
      1,
      (i + 1) / segments,
      0,
      ny,
      nz
    );
  }
  return builder.toMeshData();
}

/**
 * Generates a unit flat 3D quad `[0, 1] × [0, 1]` at `Z = 0` for 3-Zone Surface Overlays,
 * floor reticles, and alignment beams.
 */
export function createOverlayQuadMesh(): MeshData {
  const builder = new MeshBuilder();
  builder.addQuad(0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1);
  return builder.toMeshData();
}

/**
 * Generates a centered flat 3D annulus/ring (`[-0.5, 0.5]^2` at `Z = 0`) for expanding knock-on
 * and shredding shockwaves (`PLAN-06`).
 */
export function createShockwaveRingMesh(
  segments = 24,
  innerRadius = 0.37,
  outerRadius = 0.5
): MeshData {
  const builder = new MeshBuilder();
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    builder.addQuad(
      c0 * innerRadius,
      s0 * innerRadius,
      0,
      0,
      0,
      c0 * outerRadius,
      s0 * outerRadius,
      0,
      0,
      1,
      c1 * outerRadius,
      s1 * outerRadius,
      0,
      1,
      1,
      c1 * innerRadius,
      s1 * innerRadius,
      0,
      1,
      0,
      0,
      0,
      1
    );
  }
  return builder.toMeshData();
}

/**
 * Generates a centered unit micro-cube (`[-0.5, 0.5]^3`) for GPU-instanced 3D shredder particles.
 */
export function createUnitParticleCubeMesh(): MeshData {
  return createBeveledBoxMesh(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.08);
}

export interface ReusableEnvironmentMeshes {
  trayFloorTile: MeshData;
  wallSegment: MeshData;
  gateHousing: MeshData;
  rollerMesh: MeshData;
  pillarMesh: MeshData;
  crateMesh: MeshData;
  elevatorMesh: MeshData;
  generatorMesh: MeshData;
  weldClampMesh: MeshData;
  unitParticleCube: MeshData;
  overlayQuad: MeshData;
  shockwaveRingMesh: MeshData;
}

/**
 * Pre-generates all `33 × 2 = 66` static morphological 3D polyomino meshes (plus studded variants)
 * at startup (`ENG-04`).
 */
export const POLYOMINO_MESH_CATALOG: Record<string, PolyominoMeshEntry> = (() => {
  const catalog: Record<string, PolyominoMeshEntry> = {};
  for (const [shapeId, shape] of Object.entries(POLYOMINO_SHAPES)) {
    const meshOuter = buildMorphologicalPolyominoMesh(shape, STD_INSET, {
      zBottom: 0.0,
      zTop: BLOCK_HEIGHT,
      bevelXY: 0.036,
      bevelZ: 0.055,
      recessedInnerCavity: true,
      withStuds: false,
    });

    const meshInnerCore = buildMorphologicalPolyominoMesh(shape, CORE_INSET, {
      zBottom: 0.52,
      zTop: BLOCK_HEIGHT + 0.022,
      bevelXY: 0.028,
      bevelZ: 0.032,
      recessedInnerCavity: false,
      withStuds: false,
    });

    const meshOuterStudded = buildMorphologicalPolyominoMesh(shape, STD_INSET, {
      zBottom: 0.0,
      zTop: BLOCK_HEIGHT,
      bevelXY: 0.036,
      bevelZ: 0.055,
      recessedInnerCavity: true,
      withStuds: true,
      studRadius: 0.16,
    });

    const meshInnerCoreStudded = buildMorphologicalPolyominoMesh(shape, CORE_INSET, {
      zBottom: 0.52,
      zTop: BLOCK_HEIGHT + 0.022,
      bevelXY: 0.028,
      bevelZ: 0.032,
      recessedInnerCavity: false,
      withStuds: true,
      studRadius: 0.15,
    });

    catalog[shapeId] = {
      shapeId,
      meshOuter,
      meshInnerCore,
      meshOuterStudded,
      meshInnerCoreStudded,
    };
  }
  return catalog;
})();

export function getPolyominoMeshPair(
  shapeId: string,
  skin: SkinId = 'smooth_bevel'
): { meshOuter: MeshData; meshInnerCore: MeshData } {
  const entry = POLYOMINO_MESH_CATALOG[shapeId] ?? POLYOMINO_MESH_CATALOG['1x1'];
  if (skin === 'classic_studs') {
    return {
      meshOuter: entry.meshOuterStudded,
      meshInnerCore: entry.meshInnerCoreStudded,
    };
  }
  return {
    meshOuter: entry.meshOuter,
    meshInnerCore: entry.meshInnerCore,
  };
}

export const ENVIRONMENT_MESHES: ReusableEnvironmentMeshes = {
  trayFloorTile: createBeveledBoxMesh(0.02, 0.02, -0.06, 0.98, 0.98, 0.0, 0.015),
  wallSegment: createBeveledBoxMesh(0.0, 0.0, 0.0, 1.0, 1.0, 0.68, 0.04),
  gateHousing: createBeveledBoxMesh(0.0, 0.0, 0.0, 1.0, 1.0, 0.64, 0.035),
  rollerMesh: createShredderRollerMesh(16),
  pillarMesh: createBeveledBoxMesh(0.06, 0.06, 0.0, 0.94, 0.94, 0.66, 0.06),
  crateMesh: createBeveledBoxMesh(0.05, 0.05, 0.0, 0.95, 0.95, 0.6, 0.045),
  elevatorMesh: createBeveledBoxMesh(0.03, 0.03, 0.0, 0.97, 0.97, 0.05, 0.015),
  generatorMesh: createBeveledBoxMesh(0.04, 0.04, 0.0, 0.96, 0.96, 0.72, 0.05),
  weldClampMesh: createBeveledBoxMesh(-0.18, -0.18, 0.54, 0.18, 0.18, 0.62, 0.02),
  unitParticleCube: createUnitParticleCubeMesh(),
  overlayQuad: createOverlayQuadMesh(),
  shockwaveRingMesh: createShockwaveRingMesh(24, 0.37, 0.5),
};
