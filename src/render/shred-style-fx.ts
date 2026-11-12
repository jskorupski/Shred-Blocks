import { fxRandom } from '../core/fx-random';
import { getGateOutwardNormal } from '../core/gate-clearance';
import type { ColorId, GateState, ParticleStyleId } from '../core/types';
import { allocParticleSlot, type RenderPassContext } from './render-types';
import {
  renderGateBursts3D,
  renderGateBurstsCanvas2D,
  spawnGateBurst,
  stepGateBurstsImpl,
  type VisualGateBurst,
} from './shred-gate-bursts';

export {
  renderGateBursts3D,
  renderGateBurstsCanvas2D,
  spawnGateBurst,
  stepGateBurstsImpl,
  type VisualGateBurst,
};

/**
 * Distinct 5-Style Shredder Particle Physics & Shockwave Dispatch (`SHRED-STYLE-01`).
 * Outward-branching gate plasma arcs and WCAG 2.3.3 Reduced-Motion Gate Seals live in
 * `shred-gate-bursts.ts`. All cosmetic randomness routes strictly through `fxRandom()`.
 */

export function getStyleTagForParticle(style: ParticleStyleId = 'micro_cubes'): number {
  switch (style) {
    case 'star_confetti':
      return 1;
    case 'pixel_sparks':
      return 2;
    case 'soap_bubbles':
      return 3;
    case 'lightning_bolts':
      return 4;
    default:
      return 0;
  }
}

export function computeGateShredContactPoint(
  blockX: number,
  blockY: number,
  shapeCols: number,
  shapeRows: number,
  gate?: GateState
): { emitX: number; emitY: number; nx: number; ny: number } {
  if (!gate) {
    return { emitX: blockX + shapeCols * 0.5, emitY: blockY + shapeRows * 0.5, nx: 0, ny: 0 };
  }
  const [nx, ny] = getGateOutwardNormal(gate.edge);
  if (gate.edge === 'TOP' || gate.edge === 'BOTTOM') {
    const ox0 = Math.max(blockX, gate.spanStart);
    const ox1 = Math.min(blockX + shapeCols, gate.spanStart + gate.spanLength);
    const emitX = ox1 > ox0 ? (ox0 + ox1) * 0.5 : gate.spanStart + gate.spanLength * 0.5;
    const emitY = gate.edge === 'TOP' ? gate.edgeLine - 0.08 : gate.edgeLine + 1 + 0.08;
    return { emitX, emitY, nx, ny };
  }
  const oy0 = Math.max(blockY, gate.spanStart);
  const oy1 = Math.min(blockY + shapeRows, gate.spanStart + gate.spanLength);
  const emitY = oy1 > oy0 ? (oy0 + oy1) * 0.5 : gate.spanStart + gate.spanLength * 0.5;
  const emitX = gate.edge === 'LEFT' ? gate.edgeLine - 0.08 : gate.edgeLine + 1 + 0.08;
  return { emitX, emitY, nx, ny };
}

export function spawnStyledShredShockwavesAndGateFx(
  rctx: RenderPassContext,
  cx: number,
  cy: number,
  colorId: ColorId,
  gate?: GateState,
  particleStyle: ParticleStyleId = 'micro_cubes'
): void {
  const hc = Boolean(rctx.lastOptions.highContrast);
  const cbMode = Boolean(rctx.lastOptions.colorblindSymbols);
  const reduced = Boolean(rctx.lastOptions.reducedMotion);
  const [cr, cg, cb] = rctx.getColorRgb(colorId, hc, cbMode);

  let nx = 0;
  let ny = 0;
  let isHoriz = true;
  let spanLength = 1.6;
  let gx = cx;
  let gy = cy;
  if (gate) {
    [nx, ny] = getGateOutwardNormal(gate.edge);
    isHoriz = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
    spanLength = Math.max(1, gate.spanLength);
    gx = isHoriz
      ? gate.spanStart + gate.spanLength * 0.5
      : gate.edge === 'LEFT'
        ? gate.edgeLine
        : gate.edgeLine + 1;
    gy = !isHoriz
      ? gate.spanStart + gate.spanLength * 0.5
      : gate.edge === 'TOP'
        ? gate.edgeLine
        : gate.edgeLine + 1;
  }

  if (reduced) {
    // WCAG 2.3.3: stationary non-strobing Gate Seal per style (0 flying projectiles)
    spawnGateBurst(rctx, {
      cx: gate ? gx - nx * 0.14 : cx,
      cy: gate ? gy - ny * 0.14 : cy,
      z: 0.48,
      r: cr,
      g: cg,
      b: cb,
      age: 0.001,
      maxAge: 0.36,
      spanLength: gate ? spanLength : 1.2,
      isHoriz,
      nx,
      ny,
      style: particleStyle,
      mode: 'REDUCED_MOTION_SEAL',
      seed: Math.floor(fxRandom() * 1000),
    });
    return;
  }

  const sx = gate ? cx + nx * 0.08 : cx;
  const sy = gate ? cy + ny * 0.08 : cy;

  if (particleStyle === 'star_confetti') {
    rctx.spawnShockwave(sx, sy, 0.45, cr, cg, cb, 0.32, 1.95, 0.48);
    rctx.spawnShockwave(sx, sy, 0.49, 1.0, 0.88, 0.38, 0.18, 1.38, 0.42);
  } else if (particleStyle === 'pixel_sparks') {
    rctx.spawnShockwave(sx, sy, 0.48, 1.0, 0.96, 0.82, 0.16, 1.35, 0.24);
    rctx.spawnShockwave(sx, sy, 0.44, cr, cg, cb, 0.3, 2.05, 0.38);
  } else if (particleStyle === 'soap_bubbles') {
    rctx.spawnShockwave(
      sx,
      sy,
      0.46,
      Math.min(1, cr * 0.55 + 0.45),
      Math.min(1, cg * 0.55 + 0.48),
      Math.min(1, cb * 0.55 + 0.52),
      0.24,
      1.86,
      0.64
    );
    rctx.spawnShockwave(sx, sy, 0.5, 0.84, 0.98, 1.0, 0.14, 1.18, 0.48);
  } else if (particleStyle === 'lightning_bolts') {
    rctx.spawnShockwave(sx, sy, 0.49, 0.42, 0.96, 1.0, 0.16, 1.02, 0.17);
    rctx.spawnShockwave(sx, sy, 0.45, cr, cg, cb, 0.18, 0.78, 0.14);
    spawnGateBurst(rctx, {
      cx: gate ? cx : sx,
      cy: gate ? cy : sy,
      z: 0.72,
      r: cr,
      g: cg,
      b: cb,
      age: 0.001,
      maxAge: 0.68,
      spanLength: gate ? spanLength : 1.5,
      isHoriz,
      nx,
      ny,
      style: 'lightning_bolts',
      mode: 'PLASMA_ARCS',
      seed: Math.floor(fxRandom() * 1000),
    });
  } else {
    rctx.spawnShockwave(sx, sy, 0.45, cr, cg, cb, 0.3, 1.85, 0.42);
  }
}

export function spawnStyledParticlesImpl(
  rctx: RenderPassContext,
  worldX: number,
  worldY: number,
  worldZ: number,
  colorId: ColorId,
  count?: number,
  dirX = 0,
  dirY = 0,
  particleStyle: ParticleStyleId = 'micro_cubes'
): void {
  if (rctx.lastOptions.reducedMotion) {
    return;
  }

  const [r, g, b] = rctx.getColorRgb(
    colorId,
    Boolean(rctx.lastOptions.highContrast),
    Boolean(rctx.lastOptions.colorblindSymbols)
  );
  const baseCount = count ?? rctx.qualityGovernor.getBurstParticleCount(false);
  const styleTag = getStyleTagForParticle(particleStyle);

  const countMul =
    particleStyle === 'soap_bubbles'
      ? 1.85
      : particleStyle === 'lightning_bolts'
        ? 0.64
        : particleStyle === 'pixel_sparks'
          ? 1.12
          : 1.0;
  const burstCount = Math.max(8, Math.round(baseCount * countMul));

  const hasDir = Math.hypot(dirX, dirY) > 0.1;
  const tanX = hasDir ? -dirY : 1;
  const tanY = hasDir ? dirX : 0;

  for (let i = 0; i < burstCount; i++) {
    const idx = allocParticleSlot(rctx);
    const angle = (i / burstCount) * Math.PI * 2 + i * 1.6180339 + fxRandom() * 0.25;
    const lateralOffset = (((i * 11) % 19) / 9.0 - 1.0) * 0.62;
    const jitterRadius = 0.04 + ((i * 5) % 9) * 0.025;

    const px =
      worldX +
      (hasDir ? tanX * lateralOffset * 0.72 + dirX * 0.08 : Math.cos(angle) * jitterRadius) +
      (hasDir ? Math.cos(angle) * jitterRadius * 0.35 : 0);
    const py =
      worldY +
      (hasDir ? tanY * lateralOffset * 0.72 + dirY * 0.08 : Math.sin(angle) * jitterRadius) +
      (hasDir ? Math.sin(angle) * jitterRadius * 0.35 : 0);
    const pz = worldZ + (((i * 3) % 7) - 3) * 0.038;

    let vx: number;
    let vy: number;
    let vz: number;
    let pr = r;
    let pg = g;
    let pb = b;
    let scale: number;
    let maxAge: number;
    let rotAngle = angle;
    let rotSpeed = (i % 2 === 0 ? 1 : -1) * (5.5 + (i % 5));

    if (particleStyle === 'star_confetti') {
      const rad = 0.62 + ((i * 7) % 13) * 0.16;
      const fwd = 1.65 + ((i * 13) % 11) * 0.24;
      vx = dirX * fwd + (hasDir ? tanX * lateralOffset * 1.72 : 0) + Math.cos(angle) * rad;
      vy = dirY * fwd + (hasDir ? tanY * lateralOffset * 1.72 : 0) + Math.sin(angle) * rad;
      vz = 2.65 + ((i * 5) % 11) * 0.21;
      if (i % 3 === 0) {
        pr = 1.0;
        pg = 0.86;
        pb = 0.36;
      } else {
        const sh = 0.92 + ((i * 7) % 5) * 0.04;
        pr = Math.min(1, r * sh + 0.06);
        pg = Math.min(1, g * sh + 0.05);
        pb = Math.min(1, b * sh + 0.04);
      }
      scale = 0.105 + ((i * 3) % 5) * 0.018;
      maxAge = 0.86 + ((i * 9) % 7) * 0.068;
      rotSpeed = (i % 2 === 0 ? 1 : -1) * (6.2 + (i % 4) * 1.3);
    } else if (particleStyle === 'pixel_sparks') {
      const rad = 0.92 + ((i * 7) % 13) * 0.26;
      const fwd = 2.85 + ((i * 13) % 11) * 0.42;
      vx = dirX * fwd + (hasDir ? tanX * lateralOffset * 1.85 : 0) + Math.cos(angle) * rad;
      vy = dirY * fwd + (hasDir ? tanY * lateralOffset * 1.85 : 0) + Math.sin(angle) * rad;
      vz = 1.68 + ((i * 5) % 9) * 0.24;
      if (i % 5 === 0) {
        pr = 1.0;
        pg = 0.95;
        pb = 0.76;
      } else {
        pr = Math.min(1, r * 1.12 + 0.08);
        pg = Math.min(1, g * 1.12 + 0.08);
        pb = Math.min(1, b * 1.12 + 0.08);
      }
      scale = 0.078 + ((i * 3) % 4) * 0.014;
      maxAge = 0.48 + ((i * 7) % 6) * 0.048;
      rotAngle = Math.atan2(vy, vx);
      rotSpeed = 0;
    } else if (particleStyle === 'soap_bubbles') {
      // Abundant multi-size effervescent bubbles: soft initial puff that lingers on swirling air currents
      const rad = 0.32 + ((i * 7) % 11) * 0.075;
      const fwd = 0.44 + ((i * 13) % 9) * 0.065;
      vx = dirX * fwd + (hasDir ? tanX * lateralOffset * 0.96 : 0) + Math.cos(angle) * rad;
      vy = dirY * fwd + (hasDir ? tanY * lateralOffset * 0.96 : 0) + Math.sin(angle) * rad;
      vz = 0.52 + ((i * 5) % 9) * 0.09;
      pr = Math.min(1, r * 0.76 + 0.24);
      pg = Math.min(1, g * 0.76 + 0.26);
      pb = Math.min(1, b * 0.76 + 0.3);
      const tier = i % 5;
      scale =
        tier <= 1
          ? 0.068 + ((i * 3) % 4) * 0.007
          : tier <= 3
            ? 0.114 + ((i * 5) % 4) * 0.01
            : 0.168 + ((i * 7) % 3) * 0.016;
      maxAge = 1.85 + ((i * 9) % 10) * 0.105;
      rotSpeed = (i % 2 === 0 ? 1 : -1) * (1.25 + (i % 7) * 0.28);
    } else if (particleStyle === 'lightning_bolts') {
      const rad = 1.25 + ((i * 7) % 13) * 0.34;
      const fwd = 3.25 + ((i * 13) % 11) * 0.52;
      vx = dirX * fwd + (hasDir ? tanX * lateralOffset * 2.85 : 0) + Math.cos(angle) * rad;
      vy = dirY * fwd + (hasDir ? tanY * lateralOffset * 2.85 : 0) + Math.sin(angle) * rad;
      vz = 1.45 + ((i * 5) % 9) * 0.24;
      if (i % 3 === 0) {
        pr = 0.08;
        pg = 0.82;
        pb = 1.0;
      } else {
        pr = Math.min(1, r * 0.9 + 0.14);
        pg = Math.min(1, g * 0.9 + 0.18);
        pb = Math.min(1, b * 0.9 + 0.22);
      }
      scale = 0.086 + ((i * 3) % 5) * 0.018;
      maxAge = 0.38 + ((i * 7) % 5) * 0.048;
      rotAngle = Math.atan2(vy, vx);
      rotSpeed = i % 2 === 0 ? 1 : -1;
    } else {
      // micro_cubes: tactile beveled 3D voxel cubes with courtyard bounce & outward glide
      const rad = 0.54 + ((i * 7) % 13) * 0.16;
      const fwd = 1.85 + ((i * 13) % 11) * 0.28;
      vx = dirX * fwd + (hasDir ? tanX * lateralOffset * 1.48 : 0) + Math.cos(angle) * rad;
      vy = dirY * fwd + (hasDir ? tanY * lateralOffset * 1.48 : 0) + Math.sin(angle) * rad;
      vz = 1.85 + ((i * 5) % 11) * 0.22;
      const shade = 0.86 + ((i * 11) % 7) * 0.038;
      pr = Math.min(1, r * shade);
      pg = Math.min(1, g * shade);
      pb = Math.min(1, b * shade);
      scale = 0.086 + ((i * 3) % 5) * 0.018;
      maxAge = 0.68 + ((i * 9) % 7) * 0.068;
    }

    // Gate shreds spray strictly outward from the shredder jaw — never backward onto board blocks
    if (hasDir) {
      const outDot = vx * dirX + vy * dirY;
      if (outDot < 0.55) {
        const push = 0.55 - outDot;
        vx += dirX * push;
        vy += dirY * push;
        if (particleStyle === 'pixel_sparks' || particleStyle === 'lightning_bolts') {
          rotAngle = Math.atan2(vy, vx);
        }
      }
    }

    rctx.particlePool[idx + 0] = px;
    rctx.particlePool[idx + 1] = py;
    rctx.particlePool[idx + 2] = pz;
    rctx.particlePool[idx + 3] = vx;
    rctx.particlePool[idx + 4] = vy;
    rctx.particlePool[idx + 5] = vz;
    rctx.particlePool[idx + 6] = pr;
    rctx.particlePool[idx + 7] = pg;
    rctx.particlePool[idx + 8] = pb;
    rctx.particlePool[idx + 9] = scale;
    rctx.particlePool[idx + 10] = 0.001;
    rctx.particlePool[idx + 11] = maxAge;
    rctx.particlePool[idx + 12] = rotAngle;
    rctx.particlePool[idx + 13] = rotSpeed;
    rctx.particlePool[idx + 14] = styleTag;
  }
}

export function stepStyledParticleSlot(
  pool: Float32Array,
  idx: number,
  dt: number,
  nextAge: number,
  maxAge: number
): number {
  const styleTag = pool[idx + 14];
  const baseTag = styleTag >= 10 ? styleTag - 10 : styleTag;
  const lifeRatio = 1.0 - nextAge / maxAge;

  pool[idx + 0] += pool[idx + 3] * dt;
  pool[idx + 1] += pool[idx + 4] * dt;
  pool[idx + 2] += pool[idx + 5] * dt;

  const clampedLife = Math.max(0, Math.min(1, lifeRatio));
  if (baseTag === 3) {
    // soap_bubbles: air-cushion damping + looping figure-8 thermal eddies + gentle buoyancy + pop swell
    const drag = Math.max(0, 1 - 2.35 * dt);
    const chirality = pool[idx + 13] >= 0 ? 1 : -1;
    const seedPhase = idx * 0.27 + pool[idx + 13] * 1.65;
    const swirlA = nextAge * 2.25 * chirality + seedPhase;
    const swirlB = nextAge * 1.18 - seedPhase * 0.83;
    const breezeX = Math.sin(swirlA) * 4.25 + Math.cos(swirlB) * 2.65;
    const breezeY = Math.cos(swirlA * 0.94) * 3.95 - Math.sin(swirlB * 1.08) * 2.35;
    pool[idx + 3] = pool[idx + 3] * drag + breezeX * dt;
    pool[idx + 4] = pool[idx + 4] * drag + breezeY * dt;
    pool[idx + 5] = pool[idx + 5] * Math.max(0, 1 - 1.32 * dt) + (1.22 + Math.sin(swirlA * 1.35) * 0.62) * dt;
    pool[idx + 12] += pool[idx + 13] * dt;
    const progress = nextAge / maxAge;
    if (progress > 0.84) {
      const popT = (progress - 0.84) / 0.16;
      return 1.0 + Math.sin(popT * Math.PI * 0.72) * 0.38;
    }
    return 0.72 + 0.28 * Math.min(1, progress * 3.5);
  }

  if (baseTag === 1) {
    // star_confetti: featherlight low gravity + side-to-side S-wave flutter
    const drag = Math.max(0, 1 - 1.32 * dt);
    const flutter = nextAge * 9.2 + pool[idx + 12] * 0.5;
    pool[idx + 3] = pool[idx + 3] * drag + Math.cos(flutter) * 2.05 * dt;
    pool[idx + 4] = pool[idx + 4] * drag + Math.sin(flutter * 0.93) * 2.05 * dt;
    pool[idx + 5] -= 1.85 * dt;
    pool[idx + 12] += pool[idx + 13] * dt;
    return 0.2 + 0.8 * Math.sqrt(clampedLife);
  }

  if (baseTag === 2) {
    // pixel_sparks: velocity-aligned streak + energetic courtyard ricochet
    pool[idx + 5] -= 5.2 * dt;
    if (styleTag === 2 && pool[idx + 2] <= 0.035 && pool[idx + 5] < -0.2) {
      pool[idx + 2] = 0.035;
      pool[idx + 5] = -pool[idx + 5] * 0.58;
      pool[idx + 3] *= 0.94;
      pool[idx + 4] *= 0.94;
      pool[idx + 14] = 12;
    }
    pool[idx + 12] = Math.atan2(pool[idx + 4], pool[idx + 3]);
    return 0.18 + 0.82 * clampedLife;
  }

  if (baseTag === 4) {
    // lightning_bolts: live electromagnetic flutter + stepped-leader jolt deflection
    const drag = Math.max(0, 1 - 1.85 * dt);
    const speed = Math.hypot(pool[idx + 3], pool[idx + 4]);
    if (speed > 0.08) {
      const px = -pool[idx + 4] / speed;
      const py = pool[idx + 3] / speed;
      const whip = Math.sin(nextAge * 46.0 + idx * 0.37) * 5.4 * dt;
      pool[idx + 3] = pool[idx + 3] * drag + px * whip;
      pool[idx + 4] = pool[idx + 4] * drag + py * whip;
    } else {
      pool[idx + 3] *= drag;
      pool[idx + 4] *= drag;
    }
    pool[idx + 5] -= 1.25 * dt;
    if (styleTag === 4 && nextAge > maxAge * 0.34) {
      const turn = (pool[idx + 13] >= 0 ? 1 : -1) * 0.46;
      const ct = Math.cos(turn);
      const st = Math.sin(turn);
      const vx0 = pool[idx + 3];
      const vy0 = pool[idx + 4];
      pool[idx + 3] = vx0 * ct - vy0 * st;
      pool[idx + 4] = vx0 * st + vy0 * ct;
      pool[idx + 14] = 14;
    }
    pool[idx + 12] = Math.atan2(pool[idx + 4], pool[idx + 3]);
    return 0.32 + 0.68 * Math.sqrt(clampedLife);
  }

  // micro_cubes (0) or ambient motes (-1): gravity + single courtyard bounce for cubes
  pool[idx + 5] -= 6.8 * dt;
  if (styleTag === 0 && pool[idx + 2] <= 0.045 && pool[idx + 5] < -0.3) {
    pool[idx + 2] = 0.045;
    pool[idx + 5] = -pool[idx + 5] * 0.46;
    pool[idx + 3] *= 0.84;
    pool[idx + 4] *= 0.84;
    pool[idx + 14] = 10;
  }
  pool[idx + 12] += pool[idx + 13] * dt;
  return 0.18 + 0.82 * Math.sqrt(clampedLife);
}
