import type { ParticleStyleId } from '../core/types';
import { ENVIRONMENT_MESHES } from './mesh-generator';
import type { RenderPassContext } from './render-types';

/**
 * Outward-Branching 3D Gate Lightning Shocks & WCAG 2.3.3 Reduced-Motion Gate Seals (`SHRED-STYLE-01`).
 * Rendered at the end of Pass 3 (`z = 0.72` for additive plasma arcs, `z = 0.48` for seals) so
 * high-voltage branching shocks radiate prominently outward from any gate jaw (`TOP`, `BOTTOM`,
 * `LEFT`, `RIGHT`) or interior booster strike without block occlusion.
 */

export interface VisualGateBurst {
  cx: number;
  cy: number;
  z: number;
  r: number;
  g: number;
  b: number;
  age: number;
  maxAge: number;
  spanLength: number;
  isHoriz: boolean;
  nx: number;
  ny: number;
  style: ParticleStyleId;
  mode: 'PLASMA_ARCS' | 'REDUCED_MOTION_SEAL';
  seed: number;
}

export function spawnGateBurst(rctx: RenderPassContext, burst: VisualGateBurst): void {
  if (rctx.activeGateBursts.length >= 16) {
    rctx.activeGateBursts.shift();
  }
  rctx.activeGateBursts.push(burst);
}

export function stepGateBurstsImpl(rctx: RenderPassContext, dt: number): void {
  for (let i = rctx.activeGateBursts.length - 1; i >= 0; i--) {
    const gb = rctx.activeGateBursts[i];
    gb.age += dt;
    if (gb.age >= gb.maxAge) {
      rctx.activeGateBursts.splice(i, 1);
    }
  }
}

function drawPlasmaSegment3D(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z: number,
  width: number,
  r: number,
  g: number,
  b: number,
  alpha: number
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.015 || alpha <= 0.01) return;
  const mx = (x0 + x1) * 0.5;
  const my = (y0 + y1) * 0.5;
  const rotZ = Math.atan2(dy, dx);
  // Outer additive ionized plasma sheath + overlapping joint pad
  rctx.drawMesh(
    gl,
    ENVIRONMENT_MESHES.unitParticleCube,
    mx,
    my,
    z,
    len + width * 0.75,
    width * 2.85,
    0.024,
    r,
    g,
    b,
    alpha * 0.48,
    0,
    rotZ,
    0
  );
  // Inner incandescent white-cyan arc filament
  rctx.drawMesh(
    gl,
    ENVIRONMENT_MESHES.unitParticleCube,
    mx,
    my,
    z + 0.016,
    len + width * 0.36,
    width * 0.82,
    0.03,
    0.92,
    0.99,
    1.0,
    Math.min(1, alpha * 0.98),
    0,
    rotZ,
    0
  );
}

function drawBranchingBoltTree3D(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  rootX: number,
  rootY: number,
  z: number,
  dirAngle: number,
  totalLen: number,
  reach: number,
  rootWidth: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
  seed: number,
  withForks: boolean
): void {
  const segCount = 4;
  const ux = Math.cos(dirAngle);
  const uy = Math.sin(dirAngle);
  const px = -uy;
  const py = ux;
  let prevX = rootX;
  let prevY = rootY;

  for (let s = 1; s <= segCount; s++) {
    const segStartFrac = (s - 1) / segCount;
    if (reach <= segStartFrac) break;
    const localReach = Math.min(1, (reach - segStartFrac) * segCount);
    const fullFrac = s / segCount;
    const h = Math.sin(seed * 12.9898 + s * 78.233) * 43758.5453;
    const jitter01 = h - Math.floor(h);
    const kinkSign = (s + seed) % 2 === 0 ? 1 : -1;
    const kinkMag = s === segCount ? 0.08 : 0.14 + jitter01 * 0.16;
    const targetX = rootX + ux * (totalLen * fullFrac) + px * (kinkSign * kinkMag * totalLen * 0.42);
    const targetY = rootY + uy * (totalLen * fullFrac) + py * (kinkSign * kinkMag * totalLen * 0.42);
    const curX = prevX + (targetX - prevX) * localReach;
    const curY = prevY + (targetY - prevY) * localReach;
    const segW = rootWidth * (1.0 - 0.56 * (segStartFrac + 0.12));
    drawPlasmaSegment3D(rctx, gl, prevX, prevY, curX, curY, z, segW, r, g, b, alpha);

    // Outward forked daughter branches at joints s = 1, 2, and 3
    if (withForks && localReach >= 0.99 && (s === 1 || s === 2 || s === 3)) {
      const forkSign = s === 2 ? -kinkSign : kinkSign;
      const forkAng = dirAngle + forkSign * (0.52 + jitter01 * 0.28);
      const forkLen = totalLen * (s === 1 ? 0.56 : s === 2 ? 0.46 : 0.34);
      const forkReach = Math.min(1, (reach - fullFrac) * 2.4);
      if (forkReach > 0.05) {
        const fux = Math.cos(forkAng);
        const fuy = Math.sin(forkAng);
        const fpx = -fuy;
        const fpy = fux;
        const midReach = Math.min(1, forkReach * 2.0);
        const fx1 = curX + (fux * forkLen * 0.52 + fpx * (-forkSign * 0.11)) * midReach;
        const fy1 = curY + (fuy * forkLen * 0.52 + fpy * (-forkSign * 0.11)) * midReach;
        drawPlasmaSegment3D(rctx, gl, curX, curY, fx1, fy1, z, segW * 0.74, r, g, b, alpha * 0.94);
        if (forkReach > 0.5) {
          const tipReach = (forkReach - 0.5) * 2.0;
          const fx2 = fx1 + (fux * forkLen * 0.48 + fpx * (forkSign * 0.14)) * tipReach;
          const fy2 = fy1 + (fuy * forkLen * 0.48 + fpy * (forkSign * 0.14)) * tipReach;
          drawPlasmaSegment3D(rctx, gl, fx1, fy1, fx2, fy2, z, segW * 0.5, r, g, b, alpha * 0.88);
          if (s === 1 && tipReach > 0.4) {
            const twigAng = forkAng - forkSign * 0.62;
            const tx2 = fx1 + Math.cos(twigAng) * forkLen * 0.32 * tipReach;
            const ty2 = fy1 + Math.sin(twigAng) * forkLen * 0.32 * tipReach;
            drawPlasmaSegment3D(rctx, gl, fx1, fy1, tx2, ty2, z, segW * 0.38, r, g, b, alpha * 0.85);
          }
        }
      }
    }

    prevX = curX;
    prevY = curY;
  }
}

export function renderGateBursts3D(rctx: RenderPassContext, gl: WebGL2RenderingContext): void {
  if (rctx.activeGateBursts.length === 0) return;

  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);

  for (const gb of rctx.activeGateBursts) {
    const t = Math.min(1, gb.age / gb.maxAge);
    if (gb.mode === 'PLASMA_ARCS') {
      // Two crisp high-voltage discharges (primary 0..0.44 + secondary re-strike 0.28..1.0):
      // branch width tapers to 0 while alpha stays >= 0.80 so bolts stay incandescent (zero grey fade)
      const isRestrike = t > 0.32;
      const surgePrimary = t < 0.46 ? Math.sin(Math.min(1, t / 0.08) * Math.PI * 0.5) * (1 - t / 0.46) : 0;
      const surgeRestrike =
        t > 0.28 ? Math.sin(Math.min(1, (t - 0.28) / 0.07) * Math.PI * 0.5) * (1 - (t - 0.28) / 0.72) : 0;
      const surgePower = Math.max(surgePrimary, surgeRestrike * 0.92);
      if (surgePower <= 0.04) continue;

      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const reach = isRestrike ? Math.min(1, (t - 0.28) / 0.1) : Math.min(1, t / 0.11);
      const widthScale = 0.28 + 0.78 * Math.sqrt(surgePower);
      const boltAlpha = Math.min(1, 0.78 + 0.22 * surgePower);
      const activeSeed = isRestrike ? gb.seed + 97 : gb.seed;
      const cyanR = 0.38;
      const cyanG = 0.96;
      const cyanB = 1.0;
      const mixR = Math.min(1, gb.r * 0.52 + 0.48);
      const mixG = Math.min(1, gb.g * 0.48 + 0.52);
      const mixB = Math.min(1, gb.b * 0.44 + 0.56);

      // Subtle compact ionized flash at the gate contact point
      const flareScale = 0.46 + 0.34 * reach;
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.shockwaveRingMesh,
        gb.cx,
        gb.cy,
        gb.z - 0.02,
        flareScale,
        flareScale,
        1,
        cyanR,
        cyanG,
        cyanB,
        surgePower * 0.42,
        0,
        0,
        4
      );

      const hasOutward = Math.hypot(gb.nx, gb.ny) > 0.1;
      if (hasOutward) {
        const baseAng = Math.atan2(gb.ny, gb.nx);
        const tx = -gb.ny;
        const ty = gb.nx;
        const jawSpan = Math.min(2.15, Math.max(0.95, gb.spanLength * 0.8));
        const outwardSpecs: ReadonlyArray<[number, number, number, number, boolean]> = [
          [-0.44, -0.98, 1.66, 0.078, true],
          [-0.22, -0.46, 1.82, 0.086, true],
          [0.0, 0.03, 2.02, 0.096, true],
          [0.22, 0.48, 1.8, 0.086, true],
          [0.44, 0.98, 1.66, 0.078, true],
          [-0.3, -2.24, 0.98, 0.064, false],
          [0.3, 2.24, 0.98, 0.064, false],
        ];
        for (let k = 0; k < outwardSpecs.length; k++) {
          const [latFrac, angOff, len, width, forks] = outwardSpecs[k];
          const useTint = k % 2 === 1;
          drawBranchingBoltTree3D(
            rctx,
            gl,
            gb.cx + tx * (latFrac * jawSpan),
            gb.cy + ty * (latFrac * jawSpan),
            gb.z + (k % 3) * 0.012,
            baseAng + angOff,
            len * (isRestrike ? 1.06 : 1.0),
            reach,
            width * widthScale,
            useTint ? mixR : cyanR,
            useTint ? mixG : cyanG,
            useTint ? mixB : cyanB,
            boltAlpha,
            activeSeed + k * 31,
            forks
          );
        }
      } else {
        for (let k = 0; k < 6; k++) {
          const ang = (k * Math.PI) / 3 + (gb.seed % 17) * 0.12;
          const useTint = k % 2 === 1;
          drawBranchingBoltTree3D(
            rctx,
            gl,
            gb.cx,
            gb.cy,
            gb.z + (k % 2) * 0.012,
            ang,
            1.68,
            reach,
            0.086 * widthScale,
            useTint ? mixR : cyanR,
            useTint ? mixG : cyanG,
            useTint ? mixB : cyanB,
            boltAlpha,
            activeSeed + k * 37,
            true
          );
        }
      }

      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      continue;
    }

    const primarySurge = Math.sin(Math.min(1, t * 4.2) * Math.PI * 0.5) * (1 - t);
    const alpha = Math.min(1, primarySurge);
    if (alpha <= 0.01) continue;

    // Stationary WCAG 2.3.3 Reduced-Motion Gate Seals (distinct per equipped Shred Animation)
    const sealAlpha = (1 - t * t) * 0.86;
    const halfSpan = Math.min(0.75, gb.spanLength * 0.36);
    if (gb.style === 'soap_bubbles') {
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.shockwaveRingMesh,
        gb.cx,
        gb.cy,
        gb.z,
        1.15,
        1.15,
        1,
        Math.min(1, gb.r * 0.6 + 0.4),
        Math.min(1, gb.g * 0.6 + 0.45),
        Math.min(1, gb.b * 0.6 + 0.5),
        sealAlpha,
        0,
        0,
        4
      );
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.shockwaveRingMesh,
        gb.cx,
        gb.cy,
        gb.z + 0.02,
        0.64,
        0.64,
        1,
        0.82,
        0.97,
        1.0,
        sealAlpha * 0.9,
        0,
        0,
        4
      );
    } else if (gb.style === 'star_confetti') {
      rctx.drawAtlasBadge(gl, 'BADGE_STAR', gb.cx, gb.cy, gb.z + 0.03, 0.62, 1.0, 0.88, 0.38, sealAlpha);
      for (const sgn of [-1, 1]) {
        const ox = gb.isHoriz ? sgn * halfSpan : 0;
        const oy = gb.isHoriz ? 0 : sgn * halfSpan;
        rctx.drawAtlasBadge(
          gl,
          'BADGE_STAR',
          gb.cx + ox,
          gb.cy + oy,
          gb.z + 0.02,
          0.42,
          gb.r,
          gb.g,
          gb.b,
          sealAlpha * 0.92
        );
      }
    } else if (gb.style === 'pixel_sparks') {
      for (let k = 0; k < 4; k++) {
        const ang = (k * Math.PI) / 2 + Math.PI * 0.25;
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          gb.cx + Math.cos(ang) * 0.32,
          gb.cy + Math.sin(ang) * 0.32,
          gb.z,
          0.34,
          0.085,
          0.05,
          k % 2 === 0 ? 1.0 : gb.r,
          k % 2 === 0 ? 0.96 : gb.g,
          k % 2 === 0 ? 0.78 : gb.b,
          sealAlpha,
          0,
          ang,
          0
        );
      }
    } else if (gb.style === 'lightning_bolts') {
      for (const sgn of [-1, 1]) {
        const bx = gb.cx + (gb.isHoriz ? sgn * halfSpan * 0.55 : 0);
        const by = gb.cy + (gb.isHoriz ? 0 : sgn * halfSpan * 0.55);
        const rot = (gb.isHoriz ? 0 : Math.PI * 0.5) + sgn * 0.34;
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          bx,
          by,
          gb.z,
          0.56,
          0.09,
          0.055,
          0.44,
          0.95,
          1.0,
          sealAlpha,
          0,
          rot,
          0
        );
      }
    } else {
      // micro_cubes: 4 stationary beveled voxel studs framing the threshold
      const offsets: ReadonlyArray<[number, number]> = [
        [-0.24, -0.24],
        [0.24, -0.24],
        [-0.24, 0.24],
        [0.24, 0.24],
      ];
      for (const [ox, oy] of offsets) {
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          gb.cx + ox,
          gb.cy + oy,
          gb.z,
          0.16,
          0.16,
          0.12,
          gb.r,
          gb.g,
          gb.b,
          sealAlpha,
          0,
          0,
          0
        );
      }
    }
  }

  gl.enable(gl.CULL_FACE);
  gl.depthMask(true);
}

export function renderGateBurstsCanvas2D(
  rctx: RenderPassContext,
  ctx: CanvasRenderingContext2D,
  project: (wx: number, wy: number, wz: number) => { x: number; y: number }
): void {
  if (rctx.activeGateBursts.length === 0) return;
  ctx.save();
  for (const gb of rctx.activeGateBursts) {
    const t = Math.min(1, gb.age / gb.maxAge);
    const alpha = Math.max(0, (1 - t * t) * 0.85);
    const pt = project(gb.cx, gb.cy, gb.z);
    const rr = Math.round(gb.r * 255);
    const gg = Math.round(gb.g * 255);
    const bb = Math.round(gb.b * 255);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = gb.style === 'lightning_bolts' ? 'rgb(108, 242, 255)' : `rgb(${rr}, ${gg}, ${bb})`;
    ctx.fillStyle = `rgb(${rr}, ${gg}, ${bb})`;
    ctx.lineWidth = 2.5;
    if (gb.style === 'soap_bubbles') {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 16, 0, Math.PI * 2);
      ctx.stroke();
    } else if (gb.style === 'lightning_bolts') {
      if (gb.mode === 'PLASMA_ARCS') {
        const base = Math.hypot(gb.nx, gb.ny) > 0.1 ? Math.atan2(gb.ny, gb.nx) : -Math.PI * 0.5;
        for (const off of [-0.65, 0, 0.65]) {
          const a = base + off;
          const mid = project(gb.cx + Math.cos(a + 0.18) * 0.72, gb.cy + Math.sin(a + 0.18) * 0.72, gb.z);
          const tip = project(gb.cx + Math.cos(a) * 1.48, gb.cy + Math.sin(a) * 1.48, gb.z);
          const fork = project(gb.cx + Math.cos(a + 0.52) * 1.22, gb.cy + Math.sin(a + 0.52) * 1.22, gb.z);
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
          ctx.lineTo(mid.x, mid.y);
          ctx.lineTo(tip.x, tip.y);
          ctx.moveTo(mid.x, mid.y);
          ctx.lineTo(fork.x, fork.y);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(pt.x - 16, pt.y - 5);
        ctx.lineTo(pt.x - 4, pt.y + 5);
        ctx.lineTo(pt.x + 5, pt.y - 5);
        ctx.lineTo(pt.x + 16, pt.y + 5);
        ctx.stroke();
      }
    } else if (gb.style === 'star_confetti') {
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - 14);
      ctx.lineTo(pt.x + 4, pt.y - 4);
      ctx.lineTo(pt.x + 14, pt.y);
      ctx.lineTo(pt.x + 4, pt.y + 4);
      ctx.lineTo(pt.x, pt.y + 14);
      ctx.lineTo(pt.x - 4, pt.y + 4);
      ctx.lineTo(pt.x - 14, pt.y);
      ctx.lineTo(pt.x - 4, pt.y - 4);
      ctx.closePath();
      ctx.fill();
    } else if (gb.style === 'pixel_sparks') {
      ctx.beginPath();
      ctx.moveTo(pt.x - 14, pt.y - 10);
      ctx.lineTo(pt.x + 14, pt.y + 10);
      ctx.moveTo(pt.x - 14, pt.y + 10);
      ctx.lineTo(pt.x + 14, pt.y - 10);
      ctx.stroke();
    } else {
      ctx.fillRect(pt.x - 11, pt.y - 11, 9, 9);
      ctx.fillRect(pt.x + 2, pt.y - 11, 9, 9);
      ctx.fillRect(pt.x - 11, pt.y + 2, 9, 9);
      ctx.fillRect(pt.x + 2, pt.y + 2, 9, 9);
    }
  }
  ctx.restore();
}
