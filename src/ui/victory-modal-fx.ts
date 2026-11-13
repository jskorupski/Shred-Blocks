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

  const cardRect = card.getBoundingClientRect();
  const w = Math.max(240, Math.round(cardRect.width || card.clientWidth || 360));
  const h = Math.max(220, Math.round(cardRect.height || card.clientHeight || 420));
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const crestRect = document.getElementById('victory-crest-ornament')?.getBoundingClientRect();
  const cx =
    crestRect && crestRect.width > 0 ? crestRect.left - cardRect.left + crestRect.width * 0.5 : w * 0.5;
  const cy = crestRect && crestRect.height > 0 ? crestRect.top - cardRect.top + crestRect.height * 0.5 : 42;

  const bannerEl = document.getElementById('victory-under-par-banner');
  const bannerRect = bannerEl && !bannerEl.hidden ? bannerEl.getBoundingClientRect() : null;
  const bx = bannerRect && bannerRect.width > 0 ? bannerRect.left - cardRect.left : w * 0.14;
  const bw = bannerRect && bannerRect.width > 0 ? bannerRect.width : w * 0.72;
  const by =
    bannerRect && bannerRect.height > 0 ? bannerRect.top - cardRect.top + bannerRect.height * 0.5 : 156;

  const highContrast = document.body.classList.contains('high-contrast');
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
        delay: 0,
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
        delay: 0.14,
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
        delay: fxRandom() * 0.06,
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
      delay: 0,
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
          delay: b * 0.025,
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
        delay: fxRandom() * 0.08,
        age: 0,
        life: 0.88 + fxRandom() * 0.45,
        color,
        accent,
        twinklePhase: fxRandom() * Math.PI * 2,
      });
    }
  }

  const totalDuration = options.isUnderPar ? 2.55 : 1.55;
  let elapsed = 0;
  let lastMs = performance.now();
  canvas.dataset.fxRunning = 'true';

  const frame = (nowMs: number) => {
    if (!dialog.open) {
      stopVictoryModalFx();
      return;
    }
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastMs) / 1000));
    lastMs = nowMs;
    elapsed += dt;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 1. Rotating Astral Sunburst Crown on Under-Par clears
    if (options.isUnderPar && !highContrast && elapsed < 2.15) {
      const crownFade = elapsed < 0.22 ? elapsed / 0.22 : Math.max(0, 1 - (elapsed - 0.22) / (2.15 - 0.22));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(elapsed * 0.55);
      ctx.globalCompositeOperation = 'lighter';
      const rayCount = 8;
      for (let r = 0; r < rayCount; r++) {
        ctx.save();
        ctx.rotate((r * Math.PI * 2) / rayCount);
        const grad = ctx.createLinearGradient(0, 0, 0, -135);
        grad.addColorStop(
          0,
          r % 2 === 0
            ? `rgba(126, 247, 235, ${(0.22 * crownFade).toFixed(3)})`
            : `rgba(253, 224, 71, ${(0.18 * crownFade).toFixed(3)})`
        );
        grad.addColorStop(1, 'rgba(126, 247, 235, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-4, -10);
        ctx.lineTo(-18, -135);
        ctx.lineTo(18, -135);
        ctx.lineTo(4, -10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    // 2. Sacred-Geometry Shockwave Rings
    for (const ring of rings) {
      const t = (elapsed - ring.delay) / ring.dur;
      if (t <= 0 || t >= 1) continue;
      const ease = 1 - (1 - t) ** 3;
      const radius = ring.r0 + (ring.r1 - ring.r0) * ease;
      const alpha = (1 - t) ** 1.5 * 0.82;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.lineWidth * (1 - t * 0.45);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      if (ring.glyphs !== 'none') {
        const nodes = ring.glyphs === 'diamonds' ? 8 : 4;
        ctx.fillStyle = ring.color;
        for (let n = 0; n < nodes; n++) {
          const ang = (n * Math.PI * 2) / nodes + ease * 0.45;
          ctx.save();
          ctx.translate(ring.x + Math.cos(ang) * radius, ring.y + Math.sin(ang) * radius);
          ctx.rotate(ang + Math.PI * 0.5);
          if (ring.glyphs === 'diamonds') drawDiamond(ctx, 4.2 * (1 - t * 0.3));
          else drawStar4(ctx, 5.2 * (1 - t * 0.3));
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // 3. Arcane Lightning Bolts (when `lightning_bolts` particle style is equipped)
    for (const bolt of bolts) {
      const t = (elapsed - bolt.delay) / bolt.dur;
      if (t <= 0 || t >= 1) continue;
      ctx.save();
      ctx.globalAlpha = (1 - t) ** 1.4 * 0.9;
      ctx.strokeStyle = bolt.color;
      ctx.lineWidth = 2.0 * (1 - t * 0.4);
      ctx.beginPath();
      bolt.pts.forEach(([px, py], idx) => {
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }

    // 4. Particles (clipped cleanly above the bottom action button row)
    const bottomSafeY = h - 56;
    for (const p of particles) {
      if (elapsed < p.delay) continue;
      p.age += dt;
      const u = p.age / p.life;
      if (u >= 1) continue;

      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vRot * dt;

      if (p.x < -16 || p.x > w + 16 || p.y < -16 || p.y > h - 10) continue;
      const bottomMask = p.y > bottomSafeY ? Math.max(0, (h - 14 - p.y) / 42) : 1;
      const twinkle = 0.78 + 0.22 * Math.sin(elapsed * 18 + p.twinklePhase);
      const alpha = (1 - u * u) * bottomMask * twinkle;
      if (alpha <= 0.02) continue;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);

      if (p.kind === 'spark') {
        const speedAngle = Math.atan2(p.vy, p.vx);
        ctx.rotate(speedAngle);
        const streak = Math.min(18, Math.max(6, Math.hypot(p.vx, p.vy) * 0.075));
        const grad = ctx.createLinearGradient(-streak, 0, p.size, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.7, p.color);
        grad.addColorStop(1, p.accent);
        ctx.strokeStyle = grad;
        ctx.lineWidth = p.size * 0.52;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-streak, 0);
        ctx.lineTo(p.size * 0.5, 0);
        ctx.stroke();
      } else if (p.kind === 'bubble') {
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
        ctx.rotate(p.rot);
        const s = p.size * (1 - u * 0.25);
        ctx.fillStyle = p.color;
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
        ctx.fillStyle = p.accent;
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s * 0.34);
      } else if (p.kind === 'diamond') {
        ctx.rotate(p.rot);
        const r = p.size * (1 - u * 0.2);
        drawDiamond(ctx, r);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.fillStyle = p.accent;
        drawDiamond(ctx, r * 0.38);
        ctx.fill();
      } else {
        ctx.rotate(p.rot);
        const r = p.size * (1 - u * 0.18);
        drawStar4(ctx, r);
        ctx.fillStyle = p.color;
        ctx.fill();
        drawStar4(ctx, r * 0.45);
        ctx.fillStyle = p.accent;
        ctx.fill();
      }
      ctx.restore();
    }

    if (elapsed < totalDuration) {
      activeRafId = requestAnimationFrame(frame);
    } else {
      stopVictoryModalFx();
    }
  };

  activeRafId = requestAnimationFrame(frame);
}
