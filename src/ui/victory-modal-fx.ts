import { fxRandom } from '../core/fx-random';
import type { ParticleStyleId } from '../core/types';

type ModalParticleKind = 'cube' | 'star4' | 'diamond' | 'spark' | 'bubble';

interface ModalFxParticle {
  kind: ModalParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  size: number;
  rot: number;
  vRot: number;
  delay: number;
  age: number;
  life: number;
  color: string;
  accent: string;
  twinklePhase: number;
}

interface ModalShockRing {
  x: number;
  y: number;
  r0: number;
  r1: number;
  delay: number;
  dur: number;
  color: string;
  lineWidth: number;
  glyphs: 'diamonds' | 'stars' | 'none';
}

interface ModalLightningBolt {
  pts: Array<[number, number]>;
  delay: number;
  dur: number;
  color: string;
}

const SANCTUARY_JEWELS: ReadonlyArray<readonly [string, string]> = [
  ['#f6ce76', '#fffbeb'],
  ['#5eead4', '#ecfeff'],
  ['#fb7185', '#fff1f2'],
  ['#60a5fa', '#eff6ff'],
  ['#c084fc', '#faf5ff'],
];

const ORACLE_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#7ef7eb', '#ecfeff'],
  ['#fde047', '#fffbeb'],
  ['#38bdf8', '#e0f2fe'],
  ['#e879f9', '#fdf4ff'],
];

let activeRafId: number | null = null;

function drawStar4(ctx: CanvasRenderingContext2D, r: number): void {
  const inner = r * 0.34;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 === 0 ? r : inner;
    const ang = (i * Math.PI) / 4;
    const px = Math.cos(ang) * rad;
    const py = Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawDiamond(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.72, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.72, 0);
  ctx.closePath();
}

/**
 * Stops any in-flight Victory Modal celebration loop and clears `#victory-fx-canvas`.
 * Invoked automatically when `#dialog-victory` closes or when `freezeTime()` runs for deterministic goldens.
 */
export function stopVictoryModalFx(): void {
  if (activeRafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(activeRafId);
    activeRafId = null;
  }
  if (typeof document === 'undefined') return;
  const canvas = document.getElementById('victory-fx-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  canvas.dataset.fxRunning = 'false';
  const ctx = canvas.getContext('2d');
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Pre-acquires the 2D canvas context and allocates the initial backing store for `#victory-fx-canvas`
 * while the Victory dialog is still closed so first-clear fireworks incur zero surface setup stall.
 */
export function prewarmVictoryModalFx(): void {
  if (activeRafId !== null || typeof document === 'undefined') return;
  const canvas = document.getElementById('victory-fx-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (canvas.width < 64 || canvas.height < 64) {
    canvas.width = 360;
    canvas.height = 420;
  }
  ctx.clearRect(0, 0, 1, 1);
}

/**
 * Pre-renders the 8-ray Under-Par Astral Sunburst Crown once onto an offscreen canvas (`280x280` CSS)
 * so every celebration frame draws it via a single composited `drawImage` blit instead of allocating
 * 8 `CanvasGradient` objects and string stops per frame.
 */
function createSunburstSprite(dpr: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const sprite = document.createElement('canvas');
  const scale = Math.min(2, Math.max(1, dpr));
  sprite.width = Math.round(280 * scale);
  sprite.height = Math.round(280 * scale);
  const sctx = sprite.getContext('2d');
  if (!sctx) return null;

  sctx.setTransform(scale, 0, 0, scale, 140 * scale, 140 * scale);
  const evenGrad = sctx.createLinearGradient(0, 0, 0, -135);
  evenGrad.addColorStop(0, 'rgba(126, 247, 235, 0.22)');
  evenGrad.addColorStop(1, 'rgba(126, 247, 235, 0)');
  const oddGrad = sctx.createLinearGradient(0, 0, 0, -135);
  oddGrad.addColorStop(0, 'rgba(253, 224, 71, 0.18)');
  oddGrad.addColorStop(1, 'rgba(253, 224, 71, 0)');

  const rayCount = 8;
  for (let r = 0; r < rayCount; r++) {
    const ang = (r * Math.PI * 2) / rayCount;
    const ca = Math.cos(ang) * scale;
    const sa = Math.sin(ang) * scale;
    sctx.setTransform(ca, sa, -sa, ca, 140 * scale, 140 * scale);
    sctx.fillStyle = r % 2 === 0 ? evenGrad : oddGrad;
    sctx.beginPath();
    sctx.moveTo(-4, -10);
    sctx.lineTo(-18, -135);
    sctx.lineTo(18, -135);
    sctx.lineTo(4, -10);
    sctx.closePath();
    sctx.fill();
  }
  return sprite;
}

/**
 * Renders celebratory 2D sacred-geometry & jewel particle FX directly inside `.victory-dialog-card`
 * (`#victory-fx-canvas`) so players see immediate, zero-delay visual feedback on top of the modal card
 * rather than hidden behind its backdrop (`UNDER-PAR-ORACLE-01`).
 */
export function startVictoryModalFx(options: {
  isUnderPar: boolean;
  earnedStars: number;
  equippedParticle: ParticleStyleId;
  reducedMotion: boolean;
  frozen: boolean;
  activeTier?: 'ULTRA_120' | 'BALANCED_60';
}): void {
  stopVictoryModalFx();
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const dialog = document.getElementById('dialog-victory') as HTMLDialogElement | null;
  const card = dialog?.querySelector<HTMLElement>('.victory-dialog-card') ?? null;
  const canvas = document.getElementById('victory-fx-canvas') as HTMLCanvasElement | null;
  if (!dialog || !card || !canvas) return;

  canvas.dataset.fxMode = options.isUnderPar ? 'under-par' : 'standard';

  const osReduced =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (options.reducedMotion || osReduced || options.frozen) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const isBalancedTier = options.activeTier === 'BALANCED_60';
  const cardRect = card.getBoundingClientRect();
  const fxRect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
  const originRect = fxRect && fxRect.width > 0 ? fxRect : cardRect;
  // Measure `#victory-fx-canvas`'s own layout box (which terminates cleanly above `.dialog-actions`)
  const layoutW = canvas.clientWidth || fxRect?.width || card.clientWidth || cardRect.width || 360;
  const layoutH = canvas.clientHeight || fxRect?.height || card.clientHeight || cardRect.height || 420;
  const scaleInvX = originRect.width > 0 ? layoutW / originRect.width : 1;
  const scaleInvY = originRect.height > 0 ? layoutH / originRect.height : 1;
  const w = Math.max(240, Math.round(layoutW));
  const h = Math.max(160, Math.round(layoutH));
  const dpr = Math.min(isBalancedTier ? 1.75 : 2, Math.max(1, window.devicePixelRatio || 1));
  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const crestRect = document.getElementById('victory-crest-ornament')?.getBoundingClientRect();
  const cx =
    crestRect && crestRect.width > 0
      ? (crestRect.left - originRect.left + crestRect.width * 0.5) * scaleInvX
      : w * 0.5;
  const cy =
    crestRect && crestRect.height > 0
      ? (crestRect.top - originRect.top + crestRect.height * 0.5) * scaleInvY
      : 42;

  const bannerEl = document.getElementById('victory-under-par-banner');
  const bannerRect = bannerEl && !bannerEl.hidden ? bannerEl.getBoundingClientRect() : null;
  const bx = bannerRect && bannerRect.width > 0 ? (bannerRect.left - originRect.left) * scaleInvX : w * 0.14;
  const bw = bannerRect && bannerRect.width > 0 ? bannerRect.width * scaleInvX : w * 0.72;
  const by =
    bannerRect && bannerRect.height > 0
      ? (bannerRect.top - originRect.top + bannerRect.height * 0.5) * scaleInvY
      : 156;

  const highContrast = document.body.classList.contains('high-contrast');
  const enterOffset = options.frozen ? 0 : 0.075;
  const particles: ModalFxParticle[] = [];
  const rings: ModalShockRing[] = [];
  const bolts: ModalLightningBolt[] = [];

  if (options.isUnderPar) {
    rings.push(
      {
        x: cx,
        y: cy,
        r0: 14,
        r1: Math.min(w * 0.62, 230),
        delay: enterOffset,
        dur: 0.76,
        color: '#7ef7eb',
        lineWidth: 2.1,
        glyphs: 'diamonds',
      },
      {
        x: cx,
        y: cy,
        r0: 10,
        r1: Math.min(w * 0.52, 195),
        delay: enterOffset + 0.14,
        dur: 0.78,
        color: '#fde047',
        lineWidth: 1.7,
        glyphs: 'stars',
      }
    );

    // Wave 1: Astrolabe Crest Supernova (52 radial astral stars, diamonds, and comet sparks)
    for (let i = 0; i < 52; i++) {
      const ang = (i / 52) * Math.PI * 2 + (fxRandom() - 0.5) * 0.22;
      const spd = 95 + fxRandom() * 185;
      const [color, accent] = ORACLE_PALETTE[i % ORACLE_PALETTE.length];
      const kind: ModalParticleKind = i % 3 === 0 ? 'star4' : i % 3 === 1 ? 'diamond' : 'spark';
      particles.push({
        kind,
        x: cx + Math.cos(ang) * 8,
        y: cy + Math.sin(ang) * 8,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 24,
        gravity: 135,
        drag: 2.4,
        size: kind === 'spark' ? 4.2 + fxRandom() * 2.4 : 5.4 + fxRandom() * 3.8,
        rot: fxRandom() * Math.PI * 2,
        vRot: (fxRandom() - 0.5) * 6.5,
        delay: enterOffset + fxRandom() * 0.06,
        age: 0,
        life: 1.05 + fxRandom() * 0.55,
        color,
        accent,
        twinklePhase: fxRandom() * Math.PI * 2,
      });
    }

    // Wave 2: Lydian Bell Cascade Fountain from `#victory-under-par-banner` (synced to 0.34s..0.91s bell notes)
    const bellTimes = [0.34, 0.44, 0.54, 0.65, 0.77, 0.91];
    bellTimes.forEach((bt, bIdx) => {
      const rx = bx + bw * ((bIdx + 0.5) / bellTimes.length);
      rings.push({
        x: rx,
        y: by,
        r0: 4,
        r1: 38,
        delay: bt,
        dur: 0.46,
        color: bIdx % 2 === 0 ? '#7ef7eb' : '#fde047',
        lineWidth: 1.35,
        glyphs: 'none',
      });
      for (let k = 0; k < 6; k++) {
        const px = bx + bw * (0.08 + fxRandom() * 0.84);
        const [color, accent] = ORACLE_PALETTE[(bIdx + k) % ORACLE_PALETTE.length];
        particles.push({
          kind: k % 2 === 0 ? 'star4' : 'diamond',
          x: px,
          y: by + (fxRandom() - 0.5) * 10,
          vx: (fxRandom() - 0.5) * 58,
          vy: -(62 + fxRandom() * 78),
          gravity: -12,
          drag: 1.1,
          size: 4.4 + fxRandom() * 3.4,
          rot: fxRandom() * Math.PI * 2,
          vRot: (fxRandom() - 0.5) * 4.2,
          delay: bt + fxRandom() * 0.05,
          age: 0,
          life: 1.05 + fxRandom() * 0.45,
          color,
          accent,
          twinklePhase: fxRandom() * Math.PI * 2,
        });
      }
    });
  } else {
    // Standard Stage Clear: Sacred-Geometry Gold Ring + Equipped Shred Particle Burst
    const count = 24 + Math.max(1, options.earnedStars) * 6;
    rings.push({
      x: cx,
      y: cy,
      r0: 12,
      r1: Math.min(w * 0.48, 165),
      delay: enterOffset,
      dur: 0.62,
      color: '#f6ce76',
      lineWidth: 1.75,
      glyphs: options.earnedStars >= 3 ? 'diamonds' : 'none',
    });

    const style = options.equippedParticle;
    if (style === 'lightning_bolts') {
      for (let b = 0; b < 7; b++) {
        const ang = -Math.PI * 0.92 + (b / 6) * Math.PI * 0.84 + (fxRandom() - 0.5) * 0.18;
        const pts: Array<[number, number]> = [[cx, cy]];
        const len = 58 + fxRandom() * 68;
        for (let s = 1; s <= 5; s++) {
          const t = s / 5;
          const jitter = s < 5 ? (fxRandom() - 0.5) * 16 : 0;
          pts.push([
            cx + Math.cos(ang) * len * t - Math.sin(ang) * jitter,
            cy + Math.sin(ang) * len * t + Math.cos(ang) * jitter + t * 18,
          ]);
        }
        bolts.push({
          pts,
          delay: enterOffset + b * 0.025,
          dur: 0.36,
          color: b % 2 === 0 ? '#7ef7eb' : '#fde047',
        });
      }
    }

    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (fxRandom() - 0.5) * 0.28;
      const isBubble = style === 'soap_bubbles';
      const spd = isBubble ? 45 + fxRandom() * 85 : 80 + fxRandom() * 155;
      const [color, accent] = SANCTUARY_JEWELS[i % SANCTUARY_JEWELS.length];
      const kind: ModalParticleKind =
        style === 'star_confetti'
          ? 'star4'
          : style === 'pixel_sparks' || style === 'lightning_bolts'
            ? 'spark'
            : isBubble
              ? 'bubble'
              : 'cube';
      particles.push({
        kind,
        x: cx + Math.cos(ang) * 6,
        y: cy + Math.sin(ang) * 6,
        vx: Math.cos(ang) * spd,
        vy: isBubble ? -Math.abs(Math.sin(ang) * spd) - 22 : Math.sin(ang) * spd - 18,
        gravity: isBubble ? -34 : 155,
        drag: isBubble ? 1.4 : 2.3,
        size: isBubble ? 5.2 + fxRandom() * 4.4 : 4.4 + fxRandom() * 3.2,
        rot: fxRandom() * Math.PI * 2,
        vRot: (fxRandom() - 0.5) * 7.0,
        delay: enterOffset + fxRandom() * 0.08,
        age: 0,
        life: 0.88 + fxRandom() * 0.45,
        color,
        accent,
        twinklePhase: fxRandom() * Math.PI * 2,
      });
    }
  }

  const sunburstSprite = options.isUnderPar && !highContrast ? createSunburstSprite(dpr) : null;
  const totalDuration = options.isUnderPar ? 2.55 : 1.55;
  let elapsed = 0;
  let prevRafMs = 0;
  let lastPaintMs = 0;
  canvas.dataset.fxRunning = 'true';

  const frame = (nowMs: number) => {
    if (!dialog.open) {
      stopVictoryModalFx();
      return;
    }
    const rafStepMs = prevRafMs > 0 ? nowMs - prevRafMs : 0;
    prevRafMs = nowMs;
    const isHighRateTick = rafStepMs > 0 && rafStepMs < 10.5;
    // Pace to 60fps ONLY when live rAF ticks arrive above ~95Hz (< 10.5ms); never drops 60Hz ticks.
    if (lastPaintMs > 0 && isBalancedTier && isHighRateTick && nowMs - lastPaintMs < 12.5) {
      activeRafId = requestAnimationFrame(frame);
      return;
    }
    const dt = lastPaintMs > 0 ? Math.min(0.05, Math.max(0.001, (nowMs - lastPaintMs) / 1000)) : 1 / 60;
    lastPaintMs = nowMs;
    elapsed += dt;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);

    // 1. Rotating Astral Sunburst Crown on Under-Par clears (single zero-alloc sprite blit)
    if (sunburstSprite && elapsed < 2.15) {
      const crownFade = elapsed < 0.22 ? elapsed / 0.22 : Math.max(0, 1 - (elapsed - 0.22) / (2.15 - 0.22));
      const rot = elapsed * 0.55;
      const ca = Math.cos(rot) * dpr;
      const sa = Math.sin(rot) * dpr;
      ctx.setTransform(ca, sa, -sa, ca, cx * dpr, cy * dpr);
      ctx.globalAlpha = crownFade;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(sunburstSprite, -140, -140, 280, 280);
      ctx.globalCompositeOperation = 'source-over';
    }

    // 2. Sacred-Geometry Shockwave Rings (direct transform matrix — zero save/restore churn)
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      const t = (elapsed - ring.delay) / ring.dur;
      if (t <= 0 || t >= 1) continue;
      const ease = 1 - (1 - t) ** 3;
      const radius = ring.r0 + (ring.r1 - ring.r0) * ease;
      const alpha = (1 - t) ** 1.5 * 0.82;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.lineWidth * (1 - t * 0.45);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      if (ring.glyphs !== 'none') {
        const nodes = ring.glyphs === 'diamonds' ? 8 : 4;
        const gScale = 1 - t * 0.3;
        ctx.fillStyle = ring.color;
        for (let n = 0; n < nodes; n++) {
          const ang = (n * Math.PI * 2) / nodes + ease * 0.45;
          const gx = ring.x + Math.cos(ang) * radius;
          const gy = ring.y + Math.sin(ang) * radius;
          const gRot = ang + Math.PI * 0.5;
          const ca = Math.cos(gRot) * dpr;
          const sa = Math.sin(gRot) * dpr;
          ctx.setTransform(ca, sa, -sa, ca, gx * dpr, gy * dpr);
          if (ring.glyphs === 'diamonds') drawDiamond(ctx, 4.2 * gScale);
          else drawStar4(ctx, 5.2 * gScale);
          ctx.fill();
        }
      }
    }

    // 3. Arcane Lightning Bolts (when `lightning_bolts` particle style is equipped)
    if (bolts.length > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let bi = 0; bi < bolts.length; bi++) {
        const bolt = bolts[bi];
        const t = (elapsed - bolt.delay) / bolt.dur;
        if (t <= 0 || t >= 1) continue;
        ctx.globalAlpha = (1 - t) ** 1.4 * 0.9;
        ctx.strokeStyle = bolt.color;
        ctx.lineWidth = 2.0 * (1 - t * 0.4);
        ctx.beginPath();
        for (let idx = 0; idx < bolt.pts.length; idx++) {
          const pt = bolt.pts[idx];
          if (idx === 0) ctx.moveTo(pt[0], pt[1]);
          else ctx.lineTo(pt[0], pt[1]);
        }
        ctx.stroke();
      }
    }

    // 4. Particles (feathered smoothly above the canvas bottom edge above `.dialog-actions`)
    const bottomSafeY = Math.max(0, h - 24);
    const dampMul = Math.exp(-2.3 * dt);
    const twinkleBase = elapsed * 18;
    for (let pi = 0; pi < particles.length; pi++) {
      const p = particles[pi];
      if (elapsed < p.delay) continue;
      p.age += dt;
      const u = p.age / p.life;
      if (u >= 1) continue;

      const damp = p.drag === 2.3 ? dampMul : Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vRot * dt;

      if (p.x < -16 || p.x > w + 16 || p.y < -16 || p.y > h - 2) continue;
      const bottomMask = p.y > bottomSafeY ? Math.max(0, (h - 2 - p.y) / 22) : 1;
      const twinkle = 0.78 + 0.22 * Math.sin(twinkleBase + p.twinklePhase);
      const alpha = (1 - u * u) * bottomMask * twinkle;
      if (alpha <= 0.02) continue;

      if (p.kind === 'spark') {
        const speedAngle = Math.atan2(p.vy, p.vx);
        const ca = Math.cos(speedAngle) * dpr;
        const sa = Math.sin(speedAngle) * dpr;
        const streak = Math.min(18, Math.max(6, Math.hypot(p.vx, p.vy) * 0.075));
        const halfW = p.size * 0.34;
        const tipX = p.size * 0.55;
        ctx.setTransform(ca, sa, -sa, ca, p.x * dpr, p.y * dpr);
        ctx.globalAlpha = alpha * 0.68;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(-streak, 0);
        ctx.lineTo(0, halfW);
        ctx.lineTo(tipX, 0);
        ctx.lineTo(0, -halfW);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.moveTo(-streak * 0.36, 0);
        ctx.lineTo(0, halfW * 0.56);
        ctx.lineTo(tipX, 0);
        ctx.lineTo(0, -halfW * 0.56);
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === 'bubble') {
        ctx.setTransform(dpr, 0, 0, dpr, p.x * dpr, p.y * dpr);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.35;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.arc(-p.size * 0.24, -p.size * 0.24, p.size * 0.18, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'cube') {
        const ca = Math.cos(p.rot) * dpr;
        const sa = Math.sin(p.rot) * dpr;
        const s = p.size * (1 - u * 0.25);
        ctx.setTransform(ca, sa, -sa, ca, p.x * dpr, p.y * dpr);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
        ctx.fillStyle = p.accent;
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s * 0.34);
      } else if (p.kind === 'diamond') {
        const ca = Math.cos(p.rot) * dpr;
        const sa = Math.sin(p.rot) * dpr;
        const r = p.size * (1 - u * 0.2);
        ctx.setTransform(ca, sa, -sa, ca, p.x * dpr, p.y * dpr);
        ctx.globalAlpha = alpha;
        drawDiamond(ctx, r);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.fillStyle = p.accent;
        drawDiamond(ctx, r * 0.38);
        ctx.fill();
      } else {
        const ca = Math.cos(p.rot) * dpr;
        const sa = Math.sin(p.rot) * dpr;
        const r = p.size * (1 - u * 0.18);
        ctx.setTransform(ca, sa, -sa, ca, p.x * dpr, p.y * dpr);
        ctx.globalAlpha = alpha;
        drawStar4(ctx, r);
        ctx.fillStyle = p.color;
        ctx.fill();
        drawStar4(ctx, r * 0.45);
        ctx.fillStyle = p.accent;
        ctx.fill();
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;

    if (elapsed < totalDuration) {
      activeRafId = requestAnimationFrame(frame);
    } else {
      stopVictoryModalFx();
    }
  };

  activeRafId = requestAnimationFrame(frame);
}
