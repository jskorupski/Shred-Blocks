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

export class MeshBuilder {
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

export function addCylinderCapToBuilder(
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
    const v0 = builder.addVertex(tx1, ty1, z1, cos1 * 0.22, sin1 * 0.22, 0.975, tx1 * invCols, ty1 * invRows);
    const v1 = builder.addVertex(tx0, ty0, z1, cos0 * 0.22, sin0 * 0.22, 0.975, tx0 * invCols, ty0 * invRows);
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
 * and shredding shockwaves (`R3D-08`).
 */
export function createShockwaveRingMesh(segments = 24, innerRadius = 0.37, outerRadius = 0.5): MeshData {
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
