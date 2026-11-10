import type { ColorId } from './types';

export interface PolyominoShape {
  id: string;
  family:
    | 'MONO'
    | 'DOMINO'
    | 'TROMINO_I'
    | 'SMALL_L'
    | 'TETRO_I'
    | 'SQUARE_O'
    | 'STD_L'
    | 'STD_J'
    | 'TETRO_T'
    | 'SKEW_SZ'
    | 'PLUS'
    | 'BIG_L'
    | 'U_BLOCK';
  rows: number;
  cols: number;
  /** List of (dr, dc) constituent cells relative to top-left (0, 0) */
  cells: ReadonlyArray<readonly [number, number]>;
  /** Anchor cell index in `cells` used for center badge placement (Zone B) */
  anchorCellIndex: number;
  /** True if bounding box contains non-occupied concave pocket cells */
  isNonConvex: boolean;
}

function defineShape(
  id: string,
  family: PolyominoShape['family'],
  cells: ReadonlyArray<readonly [number, number]>,
  anchorCellIndex = 0
): PolyominoShape {
  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of cells) {
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  const rows = maxR + 1;
  const cols = maxC + 1;
  const isNonConvex = cells.length < rows * cols;
  return {
    id,
    family,
    rows,
    cols,
    cells,
    anchorCellIndex,
    isNonConvex,
  };
}

/**
 * Complete catalog of 33 canonical polyomino orientations across 14 shape families.
 * Remember the No Rotation Rule: shapes never rotate during gameplay; their orientation is fixed.
 */
export const POLYOMINO_SHAPES: Record<string, PolyominoShape> = {
  // 1. Monomino (1x1)
  '1x1': defineShape('1x1', 'MONO', [[0, 0]], 0),

  // 2. Dominoes (1x2, 2x1)
  '1x2': defineShape(
    '1x2',
    'DOMINO',
    [
      [0, 0],
      [0, 1],
    ],
    0
  ),
  '2x1': defineShape(
    '2x1',
    'DOMINO',
    [
      [0, 0],
      [1, 0],
    ],
    0
  ),

  // 3. Straight Trominoes (1x3, 3x1)
  '1x3': defineShape(
    '1x3',
    'TROMINO_I',
    [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
    1
  ),
  '3x1': defineShape(
    '3x1',
    'TROMINO_I',
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    1
  ),

  // 4. Corner Small-L Trominoes (2x2 minus 1 corner — 4 orientations)
  L3_BL: defineShape(
    'L3_BL',
    'SMALL_L',
    [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    1
  ), // └
  L3_TL: defineShape(
    'L3_TL',
    'SMALL_L',
    [
      [0, 0],
      [0, 1],
      [1, 0],
    ],
    0
  ), // ┌
  L3_TR: defineShape(
    'L3_TR',
    'SMALL_L',
    [
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    1
  ), // ┐
  L3_BR: defineShape(
    'L3_BR',
    'SMALL_L',
    [
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    2
  ), // ┘

  // 5. Straight Tetrominoes (1x4, 4x1)
  '1x4': defineShape(
    '1x4',
    'TETRO_I',
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ],
    1
  ),
  '4x1': defineShape(
    '4x1',
    'TETRO_I',
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    1
  ),

  // 6. Square O-Block (2x2)
  '2x2': defineShape(
    '2x2',
    'SQUARE_O',
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    0
  ),

  // 7. Standard L-Blocks (4 orientations)
  L4_0: defineShape(
    'L4_0',
    'STD_L',
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
    ],
    2
  ),
  L4_90: defineShape(
    'L4_90',
    'STD_L',
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
    ],
    0
  ),
  L4_180: defineShape(
    'L4_180',
    'STD_L',
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    1
  ),
  L4_270: defineShape(
    'L4_270',
    'STD_L',
    [
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    3
  ),

  // 8. Standard J-Blocks (4 orientations)
  J4_0: defineShape(
    'J4_0',
    'STD_J',
    [
      [0, 1],
      [1, 1],
      [2, 0],
      [2, 1],
    ],
    3
  ),
  J4_90: defineShape(
    'J4_90',
    'STD_J',
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    1
  ),
  J4_180: defineShape(
    'J4_180',
    'STD_J',
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 0],
    ],
    0
  ),
  J4_270: defineShape(
    'J4_270',
    'STD_J',
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
    ],
    2
  ),

  // 9. T-Blocks (4 orientations)
  T4_D: defineShape(
    'T4_D',
    'TETRO_T',
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
    ],
    1
  ), // ┬
  T4_U: defineShape(
    'T4_U',
    'TETRO_T',
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    2
  ), // ┴
  T4_R: defineShape(
    'T4_R',
    'TETRO_T',
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 0],
    ],
    1
  ), // ├
  T4_L: defineShape(
    'T4_L',
    'TETRO_T',
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
    2
  ), // ┤

  // 10. Skew S/Z-Blocks (4 orientations)
  S4_H: defineShape(
    'S4_H',
    'SKEW_SZ',
    [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ],
    3
  ),
  S4_V: defineShape(
    'S4_V',
    'SKEW_SZ',
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
    1
  ),
  Z4_H: defineShape(
    'Z4_H',
    'SKEW_SZ',
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
    1
  ),
  Z4_V: defineShape(
    'Z4_V',
    'SKEW_SZ',
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
    ],
    2
  ),

  // 11. Pentomino Plus / Cross (+)
  PLUS_5: defineShape(
    'PLUS_5',
    'PLUS',
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 1],
    ],
    2
  ),

  // 12. Pentomino Big-L (3x3 corner — 4 orientations)
  BIGL_BL: defineShape(
    'BIGL_BL',
    'BIG_L',
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
    ],
    2
  ),
  BIGL_TL: defineShape(
    'BIGL_TL',
    'BIG_L',
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [2, 0],
    ],
    0
  ),
  BIGL_TR: defineShape(
    'BIGL_TR',
    'BIG_L',
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ],
    2
  ),
  BIGL_BR: defineShape(
    'BIGL_BR',
    'BIG_L',
    [
      [0, 2],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ],
    4
  ),

  // 13. Pentomino U-Blocks (4 orientations)
  U5_U: defineShape(
    'U5_U',
    'U_BLOCK',
    [
      [0, 0],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    3
  ), // ∪
  U5_D: defineShape(
    'U5_D',
    'U_BLOCK',
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 2],
    ],
    1
  ), // ∩
  U5_L: defineShape(
    'U5_L',
    'U_BLOCK',
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 0],
      [2, 1],
    ],
    2
  ), // ⊃
  U5_R: defineShape(
    'U5_R',
    'U_BLOCK',
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 0],
      [2, 1],
    ],
    2
  ), // ⊂
};

export function getShape(shapeId: string): PolyominoShape {
  const s = POLYOMINO_SHAPES[shapeId];
  if (!s) {
    throw new Error(`Unknown Polyomino shapeId: ${shapeId}`);
  }
  return s;
}

export function getActiveColor(colorStack: ColorId[], colorCursor: number): ColorId {
  const idx = Math.min(colorCursor, colorStack.length - 1);
  return colorStack[idx] ?? 1;
}

export function getLayersRemaining(colorStack: ColorId[], colorCursor: number): number {
  return Math.max(0, colorStack.length - colorCursor);
}
