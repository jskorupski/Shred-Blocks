import { POLYOMINO_SHAPES, type PolyominoShape } from '../core/polyomino';
import type { SkinId } from '../core/types';
import {
  addCylinderCapToBuilder,
  applyPolyominoWearUvs,
  BLOCK_HEIGHT,
  CORE_INSET,
  MeshBuilder,
  type MeshData,
  type PolyominoMeshEntry,
  STD_INSET,
} from './mesh-primitives';

export * from './mesh-primitives';

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
    encodeEdgeWearUv?: boolean;
  } = {}
): MeshData {
  const zBottom = options.zBottom ?? 0.0;
  const zTop = options.zTop ?? BLOCK_HEIGHT;
  const bevelXY = options.bevelXY ?? 0.036;
  const bevelZ = options.bevelZ ?? 0.055;
  const recessedInnerCavity = options.recessedInnerCavity ?? false;
  const withStuds = options.withStuds ?? false;
  const studRadius = options.studRadius ?? 0.18;
  const encodeEdgeWearUv = options.encodeEdgeWearUv ?? false;

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

        if (encodeEdgeWearUv) {
          builder.addFanQuad(x0, y0, x1, y1, zTop, 0, 0, 1);
        } else {
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
  }

  // 3. Optional Top Cylindrical Studs (`classic_studs` skin)
  if (withStuds) {
    const studBaseZ = recessedInnerCavity ? zTop - 0.032 : zTop;
    const studTopZ = studBaseZ + 0.075;
    const segments = 12;
    for (const [r, c] of cells) {
      const cx = c + 0.5;
      const cy = r + 0.5;
      addCylinderCapToBuilder(builder, cx, cy, studBaseZ, studTopZ, studRadius, segments, invCols, invRows);
    }
  }

  if (encodeEdgeWearUv) {
    applyPolyominoWearUvs(builder, cells, inset);
  }

  return builder.toMeshData();
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

    // Relic Stone (`BLOCK-STONE-01`): solid cut-stone slab with wide worn chamfers & per-vertex edge/corner wear UVs
    const meshOuterWorn = buildMorphologicalPolyominoMesh(shape, STD_INSET, {
      zBottom: 0.0,
      zTop: BLOCK_HEIGHT,
      bevelXY: 0.095,
      bevelZ: 0.115,
      recessedInnerCavity: false,
      withStuds: false,
      encodeEdgeWearUv: true,
    });

    const meshInnerCoreWorn = buildMorphologicalPolyominoMesh(shape, CORE_INSET, {
      zBottom: 0.52,
      zTop: BLOCK_HEIGHT + 0.026,
      bevelXY: 0.06,
      bevelZ: 0.07,
      recessedInnerCavity: false,
      withStuds: false,
      encodeEdgeWearUv: true,
    });

    catalog[shapeId] = {
      shapeId,
      meshOuter,
      meshInnerCore,
      meshOuterStudded,
      meshInnerCoreStudded,
      meshOuterWorn,
      meshInnerCoreWorn,
    };
  }
  return catalog;
})();

export function getPolyominoMeshPair(
  shapeId: string,
  skin: SkinId = 'classic_studs'
): { meshOuter: MeshData; meshInnerCore: MeshData } {
  const entry = POLYOMINO_MESH_CATALOG[shapeId] ?? POLYOMINO_MESH_CATALOG['1x1'];
  if (skin === 'classic_studs') {
    return {
      meshOuter: entry.meshOuterStudded,
      meshInnerCore: entry.meshInnerCoreStudded,
    };
  }
  if (skin === 'relic_stone') {
    return { meshOuter: entry.meshOuterWorn, meshInnerCore: entry.meshInnerCoreWorn };
  }
  return {
    meshOuter: entry.meshOuter,
    meshInnerCore: entry.meshInnerCore,
  };
}
