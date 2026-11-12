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

const BOLT_TRACE_BUF = new Float32Array(64);

function drawJawCoronaFlash3D(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  cx: number,
  cy: number,
  z: number,
  halfLen: number,
  coronaRadius: number,
  rotZ: number,
  cyanR: number,
  cyanG: number,
  cyanB: number,
  tintR: number,
  tintG: number,
  tintB: number,
  coreBoost: number,
  alpha: number,
  seed: number
): void {
  if (alpha <= 0.008) return;
  const scaleX = halfLen * 2 + coronaRadius * 2;
  const scaleY = coronaRadius * 2;
  const ux = Math.cos(rotZ);
  const uy = Math.sin(rotZ);
  const px = -uy;
  const py = ux;
  const qx = cx - ux * scaleX * 0.5 - px * scaleY * 0.5;
  const qy = cy - uy * scaleX * 0.5 - py * scaleY * 0.5;
  gl.uniform1i(rctx.uTraceCount, 0);
  gl.uniform3f(rctx.uCapColor, tintR, tintG, tintB);
  gl.uniform4f(rctx.uClipPlane, halfLen, coronaRadius, coreBoost, seed);
  rctx.drawMesh(
    gl,
    ENVIRONMENT_MESHES.overlayQuad,
    qx,
    qy,
    z,
    scaleX,
    scaleY,
    1,
    cyanR,
    cyanG,
    cyanB,
    alpha,
    0,
    rotZ,
    9
  );
}

interface BoltTreeParams {
  rootX: number;
  rootY: number;
  z: number;
  dirAngle: number;
  totalLen: number;
  reach: number;
  rootGlowR: number;
  cyanR: number;
  cyanG: number;
  cyanB: number;
  tintR: number;
  tintG: number;
  tintB: number;
  alpha: number;
  strikeSeed: number;
  timeAge: number;
  channelPhase: number;
  pulsePos: number;
  pulseStrength: number;
  erodeRootFrac: number;
  withForks: boolean;
}

function drawBranchingBoltTree3D(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  p: BoltTreeParams
): void {
  if (p.alpha <= 0.008 || p.reach <= 0.02) return;

  let segIdx = 0;
  let minX = p.rootX;
  let maxX = p.rootX;
  let minY = p.rootY;
  let maxY = p.rootY;
  let maxGlowR = p.rootGlowR;

  const pushSeg = (
    x0: number,
    y0: number,
    s0: number,
    w0: number,
    x1: number,
    y1: number,
    s1: number,
    w1: number
  ): void => {
    if (segIdx >= 8) return;
    if (Math.hypot(x1 - x0, y1 - y0) < 0.012) return;
    const base = segIdx * 8;
    BOLT_TRACE_BUF[base + 0] = x0;
    BOLT_TRACE_BUF[base + 1] = y0;
    BOLT_TRACE_BUF[base + 2] = s0;
    BOLT_TRACE_BUF[base + 3] = w0;
    BOLT_TRACE_BUF[base + 4] = x1;
    BOLT_TRACE_BUF[base + 5] = y1;
    BOLT_TRACE_BUF[base + 6] = s1;
    BOLT_TRACE_BUF[base + 7] = w1;
    segIdx++;
    if (x0 < minX) minX = x0;
    if (x0 > maxX) maxX = x0;
    if (x1 < minX) minX = x1;
    if (x1 > maxX) maxX = x1;
    if (y0 < minY) minY = y0;
    if (y0 > maxY) maxY = y0;
    if (y1 < minY) minY = y1;
    if (y1 > maxY) maxY = y1;
    if (w0 > maxGlowR) maxGlowR = w0;
    if (w1 > maxGlowR) maxGlowR = w1;
  };

  const segCount = 4;
  const ux = Math.cos(p.dirAngle);
  const uy = Math.sin(p.dirAngle);
  const px = -uy;
  const py = ux;
  let prevX = p.rootX;
  let prevY = p.rootY;
  let prevW = p.rootGlowR;

  for (let s = 1; s <= segCount; s++) {
    const segStartFrac = (s - 1) / segCount;
    if (p.reach <= segStartFrac) break;
    const localReach = Math.min(1, (p.reach - segStartFrac) * segCount);
    const fullFrac = s / segCount;
    const h = Math.sin(p.strikeSeed * 12.9898 + s * 78.233) * 43758.5453;
    const jitter01 = h - Math.floor(h);
    const kinkSign = (s + p.strikeSeed) % 2 === 0 ? 1 : -1;
    const baseKink = (s === segCount ? 0.08 : 0.13 + jitter01 * 0.15) * kinkSign;
    const livePhase = p.timeAge * 34.0 + p.channelPhase + s * 1.95;
    const liveWrithe = (Math.sin(livePhase) * 0.055 + Math.cos(livePhase * 1.73 - s) * 0.032) * fullFrac;
    const latOffset = (baseKink * 0.38 + liveWrithe) * p.totalLen;

    const targetX = p.rootX + ux * (p.totalLen * fullFrac) + px * latOffset;
    const targetY = p.rootY + uy * (p.totalLen * fullFrac) + py * latOffset;
    const curX = prevX + (targetX - prevX) * localReach;
    const curY = prevY + (targetY - prevY) * localReach;
    const endFrac = segStartFrac + (fullFrac - segStartFrac) * localReach;
    const nextW = p.rootGlowR * (1.0 - 0.46 * fullFrac);
    const curW = prevW + (nextW - prevW) * localReach;

    pushSeg(prevX, prevY, segStartFrac, prevW, curX, curY, endFrac, curW);

    if (p.withForks && localReach >= 0.98 && (s === 1 || s === 2)) {
      const forkSign = s === 2 ? -kinkSign : kinkSign;
      const forkFlutter = Math.sin(livePhase * 1.32 + 1.4) * 0.11;
      const forkAng = p.dirAngle + forkSign * (0.5 + jitter01 * 0.28) + forkFlutter;
      const forkLen = p.totalLen * (s === 1 ? 0.56 : 0.44);
      const forkReach = Math.min(1, (p.reach - fullFrac) * 2.3);
      if (forkReach > 0.06) {
        const fux = Math.cos(forkAng);
        const fuy = Math.sin(forkAng);
        const fpx = -fuy;
        const fpy = fux;
        if (s === 1) {
          const midReach = Math.min(1, forkReach * 1.9);
          const fx1 = curX + (fux * forkLen * 0.52 + fpx * (-forkSign * 0.1)) * midReach;
          const fy1 = curY + (fuy * forkLen * 0.52 + fpy * (-forkSign * 0.1)) * midReach;
          const fw1 = curW * 0.78;
          const fs1 = Math.min(1, fullFrac + 0.24 * midReach);
          pushSeg(curX, curY, fullFrac, curW * 0.88, fx1, fy1, fs1, fw1);
          if (forkReach > 0.52) {
            const tipReach = Math.min(1, (forkReach - 0.52) / 0.48);
            const fx2 = fx1 + (fux * forkLen * 0.48 + fpx * (forkSign * 0.13)) * tipReach;
            const fy2 = fy1 + (fuy * forkLen * 0.48 + fpy * (forkSign * 0.13)) * tipReach;
            const fs2 = Math.min(1, fs1 + 0.26 * tipReach);
            pushSeg(fx1, fy1, fs1, fw1, fx2, fy2, fs2, fw1 * 0.64);
            if (tipReach > 0.35) {
              const twigAng = forkAng - forkSign * 0.6 + forkFlutter * 0.8;
              const tx2 = fx1 + Math.cos(twigAng) * forkLen * 0.34 * tipReach;
              const ty2 = fy1 + Math.sin(twigAng) * forkLen * 0.34 * tipReach;
              pushSeg(fx1, fy1, fs1, fw1 * 0.82, tx2, ty2, Math.min(1, fs1 + 0.22 * tipReach), fw1 * 0.54);
            }
          }
        } else {
          const fx = curX + (fux * forkLen + fpx * (forkSign * 0.09)) * forkReach;
          const fy = curY + (fuy * forkLen + fpy * (forkSign * 0.09)) * forkReach;
          pushSeg(
            curX,
            curY,
            fullFrac,
            curW * 0.84,
            fx,
            fy,
            Math.min(1, fullFrac + 0.36 * forkReach),
            curW * 0.52
          );
        }
      }
    }

    prevX = curX;
    prevY = curY;
    prevW = curW;
  }

  if (segIdx === 0) return;
  const pad = maxGlowR * 1.42;
  gl.uniform1i(rctx.uTraceCount, segIdx);
  gl.uniform4fv(rctx.uTracePts, BOLT_TRACE_BUF, 0, segIdx * 8);
  gl.uniform3f(rctx.uCapColor, p.tintR, p.tintG, p.tintB);
  gl.uniform4f(rctx.uClipPlane, p.pulsePos, p.pulseStrength, p.erodeRootFrac, p.channelPhase);
  rctx.drawMesh(
    gl,
    ENVIRONMENT_MESHES.overlayQuad,
    minX - pad,
    minY - pad,
    p.z,
    maxX - minX + pad * 2,
    maxY - minY + pad * 2,
    1,
    p.cyanR,
    p.cyanG,
    p.cyanB,
    p.alpha,
    0,
    0,
    9
  );
}

export function renderGateBursts3D(rctx: RenderPassContext, gl: WebGL2RenderingContext): void {
  if (rctx.activeGateBursts.length === 0) return;

  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);

  for (const gb of rctx.activeGateBursts) {
    const t = Math.min(1, gb.age / gb.maxAge);
    if (gb.mode === 'PLASMA_ARCS') {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      const cyanR = 0.08;
      const cyanG = 0.78;
      const cyanB = 1.0;
      const tintR = Math.min(1, gb.r * 0.88 + 0.12);
      const tintG = Math.min(1, gb.g * 0.85 + 0.15);
      const tintB = Math.min(1, gb.b * 0.85 + 0.18);

      const hasOutward = Math.hypot(gb.nx, gb.ny) > 0.1;
      const jawSpan = Math.min(2.15, Math.max(0.95, gb.spanLength * 0.8));
      const jawRot = hasOutward ? Math.atan2(gb.ny, gb.nx) + Math.PI * 0.5 : 0;

      // 1. Gate-jaw arc-welder flash: explosive contact flare + secondary re-strike surges + smooth decay
      const initialFlash = Math.exp(-t * 9.5);
      const dA = (t - 0.24) * 11.0;
      const dB = (t - 0.46) * 11.5;
      const surgeFlashA = 0.52 * Math.exp(-(dA * dA));
      const surgeFlashB = 0.32 * Math.exp(-(dB * dB));
      const jawFlicker = 0.76 + 0.24 * Math.sin(gb.age * 74.0 + gb.seed);
      const jawPower = Math.min(1, (initialFlash + surgeFlashA + surgeFlashB) * jawFlicker * (1 - t * 0.88));
      drawJawCoronaFlash3D(
        rctx,
        gl,
        gb.cx,
        gb.cy,
        gb.z - 0.015,
        hasOutward ? jawSpan * 0.46 : 0.14,
        0.44 + 0.22 * initialFlash,
        jawRot,
        cyanR,
        cyanG,
        cyanB,
        tintR,
        tintG,
        tintB,
        0.52 + 0.48 * initialFlash,
        jawPower * 0.94,
        gb.seed * 0.13
      );

      // 2. Well-separated hero plasma leaders + corner snap arcs (staggered so silhouettes stay crisp, never stacked)
      const outwardSpecs: ReadonlyArray<[number, number, number, number, number, number, boolean]> = [
        // [latFrac, angOff, len, glowR, startDelaySec, durFrac, withForks]
        [-0.38, -0.84, 1.78, 0.36, 0.055, 0.88, true],
        [-0.12, -0.26, 2.08, 0.42, 0.0, 0.98, true],
        [0.16, 0.32, 1.98, 0.4, 0.022, 0.95, true],
        [0.4, 0.86, 1.74, 0.36, 0.078, 0.86, true],
        [-0.44, -2.05, 0.92, 0.26, 0.018, 0.56, false],
        [0.44, 2.05, 0.92, 0.26, 0.095, 0.56, false],
      ];

      const channelCount = hasOutward ? outwardSpecs.length : 4;
      const baseAng = hasOutward ? Math.atan2(gb.ny, gb.nx) : 0;
      const tx = -gb.ny;
      const ty = gb.nx;

      for (let k = 0; k < channelCount; k++) {
        const latFrac = hasOutward ? outwardSpecs[k][0] : 0;
        const angOff = hasOutward ? outwardSpecs[k][1] : (k * Math.PI) / 2 + (gb.seed % 17) * 0.14;
        const baseLen = hasOutward ? outwardSpecs[k][2] : 1.82;
        const baseGlowR = hasOutward ? outwardSpecs[k][3] : 0.38;
        const delaySec = hasOutward ? outwardSpecs[k][4] : (k % 3) * 0.028;
        const durSec = gb.maxAge * (hasOutward ? outwardSpecs[k][5] : 0.92);
        const withForks = hasOutward ? outwardSpecs[k][6] : true;

        const localAge = gb.age - delaySec;
        if (localAge <= 0 || localAge >= durSec) continue;
        const localT = localAge / durSec;

        // Asynchronous stepped-leader re-pathing (5-6 brisk path snaps out of phase across channels)
        const strikePeriod = 0.076 + (k % 3) * 0.016;
        const strikePhase = localAge + (k * 0.029 + (gb.seed % 7) * 0.008);
        const strikeEpoch = Math.floor(strikePhase / strikePeriod);
        const epochFrac = (strikePhase % strikePeriod) / strikePeriod;
        const strikeSeed = gb.seed + k * 41 + strikeEpoch * 137;

        const reach =
          strikeEpoch === 0 ? Math.min(1, localAge / 0.055) : Math.min(1, 0.46 + epochFrac * 0.95);

        // High-contrast AC arc strobe + crisp re-strike flash + smooth nonlinear dissolve fade
        const attack = Math.min(1, localT / 0.048);
        const decay = localT < 0.34 ? 1.0 : Math.max(0, (1.0 - localT) / 0.66) ** 1.85;
        const acWaveA = 0.5 + 0.5 * Math.sin(gb.age * 72.0 + k * 2.45 + gb.seed * 0.3);
        const acWaveB = 0.5 + 0.5 * Math.cos(gb.age * 119.0 - k * 1.75);
        const reStrikeBoost = Math.exp(-epochFrac * 3.6) * 0.42;
        const acFlicker = Math.min(1.15, 0.52 + 0.34 * acWaveA * acWaveB + reStrikeBoost);
        const boltAlpha = Math.min(1, attack * decay * acFlicker);
        if (boltAlpha <= 0.012) continue;

        // Traveling high-voltage surge wave racing from gate jaw (0.0) out to branch tips (1.0)
        const pulsePos = ((localT * 3.15 + k * 0.24) % 1.36) - 0.12;
        const pulseStrength = Math.min(1, (0.62 + 0.38 * acWaveA + reStrikeBoost) * decay);
        const erodeRootFrac = localT > 0.55 ? ((localT - 0.55) / 0.45) * 0.48 : 0;
        const glowScale = 0.48 + 0.56 * Math.sqrt(decay) + reStrikeBoost * 0.26;
        const lenScale = 0.92 + ((strikeEpoch + k) % 3) * 0.07;
        const useBlockAccent = k % 2 === 1;

        drawBranchingBoltTree3D(rctx, gl, {
          rootX: hasOutward ? gb.cx + tx * (latFrac * jawSpan) : gb.cx,
          rootY: hasOutward ? gb.cy + ty * (latFrac * jawSpan) : gb.cy,
          z: gb.z + (k % 3) * 0.01,
          dirAngle: baseAng + angOff,
          totalLen: baseLen * lenScale,
          reach,
          rootGlowR: baseGlowR * glowScale,
          cyanR: useBlockAccent ? Math.min(1, cyanR * 0.52 + tintR * 0.58) : cyanR,
          cyanG: useBlockAccent ? Math.min(1, cyanG * 0.52 + tintG * 0.58) : cyanG,
          cyanB: useBlockAccent ? Math.min(1, cyanB * 0.52 + tintB * 0.58) : cyanB,
          tintR,
          tintG,
          tintB,
          alpha: boltAlpha,
          strikeSeed,
          timeAge: gb.age,
          channelPhase: gb.seed * 0.29 + k * 2.17,
          pulsePos,
          pulseStrength,
          erodeRootFrac,
          withForks,
        });
      }

      gl.uniform1i(rctx.uTraceCount, 0);
      gl.uniform4f(rctx.uClipPlane, 0, 0, 1, 0);
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
        const prevComp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const decay = t < 0.38 ? 1.0 : Math.max(0, (1.0 - t) / 0.62) ** 1.75;
        const flicker = 0.68 + 0.32 * (0.5 + 0.5 * Math.sin(gb.age * 68 + gb.seed));
        const arcAlpha = Math.min(1, Math.min(1, t / 0.06) * decay * flicker);
        const base = Math.hypot(gb.nx, gb.ny) > 0.1 ? Math.atan2(gb.ny, gb.nx) : -Math.PI * 0.5;

        // Soft jaw contact flash
        ctx.globalAlpha = arcAlpha * Math.exp(-t * 6.5) * 0.55;
        ctx.fillStyle = 'rgb(120, 244, 255)';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 18, 0, Math.PI * 2);
        ctx.fill();

        const offsets = [-0.88, -0.42, 0.02, 0.45, 0.88];
        for (let k = 0; k < offsets.length; k++) {
          const strikeEpoch = Math.floor((gb.age + k * 0.03) / 0.1);
          const writhe = Math.sin(gb.age * 40 + k * 2.1 + strikeEpoch * 1.7) * 0.22;
          const a = base + offsets[k];
          const reach = Math.min(1, gb.age / 0.07);
          const p1 = project(
            gb.cx + Math.cos(a + writhe) * 0.78 * reach,
            gb.cy + Math.sin(a + writhe) * 0.78 * reach,
            gb.z
          );
          const p2 = project(
            gb.cx + Math.cos(a - writhe * 0.7) * 1.62 * reach,
            gb.cy + Math.sin(a - writhe * 0.7) * 1.62 * reach,
            gb.z
          );
          const fk = project(
            gb.cx + Math.cos(a + (k % 2 === 0 ? 0.48 : -0.48) + writhe) * 1.32 * reach,
            gb.cy + Math.sin(a + (k % 2 === 0 ? 0.48 : -0.48) + writhe) * 1.32 * reach,
            gb.z
          );
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(fk.x, fk.y);
          ctx.strokeStyle = k % 2 === 1 ? `rgb(${rr}, ${gg}, ${bb})` : 'rgb(72, 232, 255)';
          ctx.globalAlpha = arcAlpha * 0.52;
          ctx.lineWidth = 6.5 * Math.sqrt(decay);
          ctx.stroke();
          ctx.strokeStyle = 'rgb(245, 253, 255)';
          ctx.globalAlpha = arcAlpha * 0.92;
          ctx.lineWidth = 2.0 * Math.sqrt(decay);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = prevComp;
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
