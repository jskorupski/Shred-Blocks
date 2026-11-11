/**
 * Procedural 512 × 512 RGBA Texture Atlas Generator (`ENG-01`).
 *
 * Bakes crisp, high-contrast vector icons, colorblind accessibility symbols,
 * directional axis-lock chevrons, obstacle/item badges, and tabular countdown digits
 * into a single 512 × 512 offscreen 2D canvas at boot.
 */

export interface AtlasUVRegion {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface AtlasTextureData {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  regions: Record<string, AtlasUVRegion>;
}

const ATLAS_SIZE = 512;
const GRID_COLS = 6;
const GRID_ROWS = 6;
const CELL_SIZE = 84;
const PADDING = 6;

interface GlyphSlotSpec {
  keys: string[];
  glyph: string;
  drawCustom?: (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => void;
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotOffset = -Math.PI / 2
): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotOffset + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

function drawStarPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  points = 5
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

const ATLAS_SLOTS: GlyphSlotSpec[] = [
  // Row 0: Sacred-Geometry Colorblind Sigils 0..5 (`AX-01` — collision-free, topologically distinct)
  {
    keys: ['CB_0', '▨', 'STONE'],
    glyph: '▨',
    drawCustom: (ctx, cx, cy, r) => {
      const s = r * 0.64;
      ctx.beginPath();
      ctx.rect(cx - s, cy - s, s * 2, s * 2);
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = 'rgba(10, 14, 26, 0.9)';
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.72, cy - s * 0.18);
      ctx.lineTo(cx - s * 0.18, cy - s * 0.72);
      ctx.moveTo(cx - s * 0.64, cy + s * 0.64);
      ctx.lineTo(cx + s * 0.64, cy - s * 0.64);
      ctx.moveTo(cx + s * 0.18, cy + s * 0.72);
      ctx.lineTo(cx + s * 0.72, cy + s * 0.18);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    keys: ['CB_1', '◯', 'RING'],
    glyph: '◯',
    drawCustom: (ctx, cx, cy, r) => {
      // Solar Ring: crisp concentric open ring (distinct from every filled polygon)
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2, false);
      ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    },
  },
  {
    keys: ['CB_2', '▲', 'TRIANGLE'],
    glyph: '▲',
    drawCustom: (ctx, cx, cy, r) => {
      // Sanctuary Delta: sharp equilateral upward triangle
      const topY = cy - r * 0.72;
      const botY = cy + r * 0.56;
      const halfW = r * 0.74;
      ctx.beginPath();
      ctx.moveTo(cx, topY);
      ctx.lineTo(cx + halfW, botY);
      ctx.lineTo(cx - halfW, botY);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    keys: ['CB_3', '■', 'SQUARE'],
    glyph: '■',
    drawCustom: (ctx, cx, cy, r) => {
      // Jade Tablet: crisp 90-degree solid square with tiny inner pinpoint for refined jeweler balance
      const s = r * 0.58;
      ctx.beginPath();
      ctx.rect(cx - s, cy - s, s * 2, s * 2);
      ctx.fill();
    },
  },
  {
    keys: ['CB_4', '═', 'BARS'],
    glyph: '═',
    drawCustom: (ctx, cx, cy, r) => {
      // Twin Sun Bars: two bold horizontal bars (replaces ★ so Star Blocks/Gates never collide!)
      const w = r * 0.68;
      const h = r * 0.17;
      const gap = r * 0.31;
      ctx.beginPath();
      ctx.roundRect(cx - w, cy - gap - h, w * 2, h * 2, h * 0.65);
      ctx.roundRect(cx - w, cy + gap - h, w * 2, h * 2, h * 0.65);
      ctx.fill();
    },
  },
  {
    keys: ['CB_5', '◆'],
    glyph: '◆',
    drawCustom: (ctx, cx, cy, r) => {
      // Astral Lozenge: tall faceted 4-point diamond (rx=0.52, ry=0.80 so it never blurs into ■)
      const rx = r * 0.52;
      const ry = r * 0.8;
      ctx.beginPath();
      ctx.moveTo(cx, cy - ry);
      ctx.lineTo(cx + rx, cy);
      ctx.lineTo(cx, cy + ry);
      ctx.lineTo(cx - rx, cy);
      ctx.closePath();
      ctx.fill();
    },
  },

  // Row 1: Sacred-Geometry Colorblind Sigils 6..9 + Axis-Lock Chevrons
  {
    keys: ['CB_6', '✚', 'CROSS'],
    glyph: '✚',
    drawCustom: (ctx, cx, cy, r) => {
      // Greek Cross: bold orthogonal +
      const w = r * 0.25;
      const l = r * 0.74;
      ctx.beginPath();
      ctx.moveTo(cx - w, cy - l);
      ctx.lineTo(cx + w, cy - l);
      ctx.lineTo(cx + w, cy - w);
      ctx.lineTo(cx + l, cy - w);
      ctx.lineTo(cx + l, cy + w);
      ctx.lineTo(cx + w, cy + w);
      ctx.lineTo(cx + w, cy + l);
      ctx.lineTo(cx - w, cy + l);
      ctx.lineTo(cx - w, cy + w);
      ctx.lineTo(cx - l, cy + w);
      ctx.lineTo(cx - l, cy - w);
      ctx.lineTo(cx - w, cy - w);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    keys: ['CB_7', '✖', 'SALTIRE'],
    glyph: '✖',
    drawCustom: (ctx, cx, cy, r) => {
      // Saltire Cross: bold 45-degree diagonal X (replaces ⬢ hexagon which blurred into ●)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI * 0.25);
      const w = r * 0.23;
      const l = r * 0.78;
      ctx.beginPath();
      ctx.moveTo(-w, -l);
      ctx.lineTo(w, -l);
      ctx.lineTo(w, -w);
      ctx.lineTo(l, -w);
      ctx.lineTo(l, w);
      ctx.lineTo(w, w);
      ctx.lineTo(w, l);
      ctx.lineTo(-w, l);
      ctx.lineTo(-w, w);
      ctx.lineTo(-l, w);
      ctx.lineTo(-l, -w);
      ctx.lineTo(-w, -w);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  },
  {
    keys: ['CB_8', '☾', 'CRESCENT'],
    glyph: '☾',
    drawCustom: (ctx, cx, cy, r) => {
      // Astrolabe Crescent Moon: sweeping asymmetric crescent silhouette
      const outerR = r * 0.7;
      const cutR = r * 0.56;
      const cutDx = r * 0.34;
      const cutDy = -r * 0.06;
      // Compute exact intersection angles of the two circles for a razor-sharp vector crescent
      const d = Math.hypot(cutDx, cutDy);
      const baseAngle = Math.atan2(cutDy, cutDx);
      const a1 = Math.acos((outerR * outerR + d * d - cutR * cutR) / (2 * outerR * d));
      const a2 = Math.acos((cutR * cutR + d * d - outerR * outerR) / (2 * cutR * d));
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, baseAngle + a1, baseAngle - a1 + Math.PI * 2, false);
      ctx.arc(cx + cutDx, cy + cutDy, cutR, baseAngle + Math.PI - a2, baseAngle + Math.PI + a2, true);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    keys: ['CB_9', '∴', 'TRIAD'],
    glyph: '∴',
    drawCustom: (ctx, cx, cy, r) => {
      // Trinity Pearls: 3 sacred-geometry circular pips in an equilateral triad
      const dotR = r * 0.23;
      const orbitR = r * 0.44;
      const cyShift = cy + r * 0.06;
      for (let k = 0; k < 3; k++) {
        const ang = -Math.PI * 0.5 + (k * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * orbitR, cyShift + Math.sin(ang) * orbitR, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    keys: ['LOCK_H', '↔', 'AXIS_H'],
    glyph: '↔',
    drawCustom: (ctx, cx, cy, r) => {
      // Pill-free sculpted architectural double-headed chevron arrow (`UX-10`, `R3D-07`)
      const l = r * 0.94;
      const ah = r * 0.48;
      const bh = r * 0.2;
      ctx.save();
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = 'rgba(18, 22, 38, 0.58)';
      ctx.fillStyle = '#FFFDF9';
      ctx.beginPath();
      ctx.moveTo(cx - l, cy);
      ctx.lineTo(cx - l + ah, cy - ah);
      ctx.lineTo(cx - l + ah, cy - bh);
      ctx.lineTo(cx + l - ah, cy - bh);
      ctx.lineTo(cx + l - ah, cy - ah);
      ctx.lineTo(cx + l, cy);
      ctx.lineTo(cx + l - ah, cy + ah);
      ctx.lineTo(cx + l - ah, cy + bh);
      ctx.lineTo(cx - l + ah, cy + bh);
      ctx.lineTo(cx - l + ah, cy + ah);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    },
  },
  {
    keys: ['LOCK_V', '↕', 'AXIS_V'],
    glyph: '↕',
    drawCustom: (ctx, cx, cy, r) => {
      // Pill-free sculpted architectural double-headed chevron arrow (`UX-10`, `R3D-07`)
      const l = r * 0.94;
      const ah = r * 0.48;
      const bw = r * 0.2;
      ctx.save();
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = 'rgba(18, 22, 38, 0.58)';
      ctx.fillStyle = '#FFFDF9';
      ctx.beginPath();
      ctx.moveTo(cx, cy - l);
      ctx.lineTo(cx + ah, cy - l + ah);
      ctx.lineTo(cx + bw, cy - l + ah);
      ctx.lineTo(cx + bw, cy + l - ah);
      ctx.lineTo(cx + ah, cy + l - ah);
      ctx.lineTo(cx, cy + l);
      ctx.lineTo(cx - ah, cy + l - ah);
      ctx.lineTo(cx - bw, cy + l - ah);
      ctx.lineTo(cx - bw, cy - l + ah);
      ctx.lineTo(cx - ah, cy - l + ah);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    },
  },

  // Row 2: Obstacle & Item Badges (Key, Scissors, Star, Padlock, Bomb, Ice)
  {
    keys: ['BADGE_KEY', '🔑', 'KEY'],
    glyph: '🔑',
    drawCustom: (ctx, cx, cy, r) => {
      ctx.beginPath();
      ctx.arc(cx - r * 0.32, cy, r * 0.34, 0, Math.PI * 2);
      ctx.rect(cx - r * 0.02, cy - r * 0.1, r * 0.78, r * 0.2);
      ctx.rect(cx + r * 0.35, cy + r * 0.1, r * 0.14, r * 0.24);
      ctx.rect(cx + r * 0.58, cy + r * 0.1, r * 0.14, r * 0.28);
      ctx.stroke();
      ctx.fill();
    },
  },
  {
    keys: ['BADGE_SCISSORS', '✂️', 'SCISSORS'],
    glyph: '✂',
    drawCustom: (ctx, cx, cy, r) => {
      ctx.beginPath();
      ctx.arc(cx - r * 0.38, cy - r * 0.32, r * 0.24, 0, Math.PI * 2);
      ctx.arc(cx - r * 0.38, cy + r * 0.32, r * 0.24, 0, Math.PI * 2);
      ctx.moveTo(cx - r * 0.18, cy - r * 0.22);
      ctx.lineTo(cx + r * 0.72, cy + r * 0.38);
      ctx.lineTo(cx + r * 0.72, cy + r * 0.2);
      ctx.lineTo(cx - r * 0.12, cy - r * 0.34);
      ctx.closePath();
      ctx.moveTo(cx - r * 0.18, cy + r * 0.22);
      ctx.lineTo(cx + r * 0.72, cy - r * 0.38);
      ctx.lineTo(cx + r * 0.72, cy - r * 0.2);
      ctx.lineTo(cx - r * 0.12, cy + r * 0.34);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    },
  },
  {
    keys: ['BADGE_STAR', '⭐', 'STAR'],
    glyph: '★',
    drawCustom: (ctx, cx, cy, r) => {
      drawStarPolygon(ctx, cx, cy + r * 0.04, r * 0.82, r * 0.38, 5);
    },
  },
  {
    keys: ['BADGE_LOCK', '🔒', 'PADLOCK'],
    glyph: '🔒',
    drawCustom: (ctx, cx, cy, r) => {
      // Shackle
      ctx.save();
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.18, r * 0.34, Math.PI, 0, false);
      ctx.strokeStyle = '#0F172A';
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
      ctx.restore();
      // Body
      const w = r * 0.56;
      const h = r * 0.46;
      ctx.beginPath();
      ctx.rect(cx - w, cy - r * 0.12, w * 2, h * 1.45);
      ctx.stroke();
      ctx.fill();
    },
  },
  {
    keys: ['BADGE_BOMB', '💣', 'BOMB'],
    glyph: '💣',
    drawCustom: (ctx, cx, cy, r) => {
      ctx.beginPath();
      ctx.arc(cx - r * 0.06, cy + r * 0.1, r * 0.58, 0, Math.PI * 2);
      ctx.rect(cx + r * 0.22, cy - r * 0.45, r * 0.28, r * 0.22);
      ctx.stroke();
      ctx.fill();
    },
  },
  {
    keys: ['BADGE_ICE', '❄️', 'ICE'],
    glyph: '❄',
    drawCustom: (ctx, cx, cy, r) => {
      drawStarPolygon(ctx, cx, cy, r * 0.78, r * 0.26, 6);
    },
  },

  // Row 3: Shutter Gem, Generator, Digits 0..3
  {
    keys: ['BADGE_GEM', '💎', 'SHUTTER_GEM'],
    glyph: '💎',
    drawCustom: (ctx, cx, cy, r) => {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.45, cy - r * 0.55);
      ctx.lineTo(cx + r * 0.45, cy - r * 0.55);
      ctx.lineTo(cx + r * 0.78, cy - r * 0.12);
      ctx.lineTo(cx, cy + r * 0.72);
      ctx.lineTo(cx - r * 0.78, cy - r * 0.12);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    },
  },
  {
    keys: ['BADGE_GENERATOR', '⚡', 'GENERATOR'],
    glyph: '⚡',
    drawCustom: (ctx, cx, cy, r) => {
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.15, cy - r * 0.8);
      ctx.lineTo(cx - r * 0.5, cy + r * 0.08);
      ctx.lineTo(cx + r * 0.02, cy + r * 0.08);
      ctx.lineTo(cx - r * 0.18, cy + r * 0.8);
      ctx.lineTo(cx + r * 0.5, cy - r * 0.08);
      ctx.lineTo(cx - r * 0.02, cy - r * 0.08);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    },
  },
  { keys: ['DIGIT_0', '0'], glyph: '0' },
  { keys: ['DIGIT_1', '1'], glyph: '1' },
  { keys: ['DIGIT_2', '2'], glyph: '2' },
  { keys: ['DIGIT_3', '3'], glyph: '3' },

  // Row 4: Digits 4..9
  { keys: ['DIGIT_4', '4'], glyph: '4' },
  { keys: ['DIGIT_5', '5'], glyph: '5' },
  { keys: ['DIGIT_6', '6'], glyph: '6' },
  { keys: ['DIGIT_7', '7'], glyph: '7' },
  { keys: ['DIGIT_8', '8'], glyph: '8' },
  { keys: ['DIGIT_9', '9'], glyph: '9' },

  // Row 5: Solid White & Utility Regions
  {
    keys: ['WHITE', 'SOLID'],
    glyph: '',
    drawCustom: (ctx, cx, cy, r) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    },
  },
  {
    keys: ['BADGE_PORTCULLIS', 'PORTCULLIS'],
    glyph: '⛩',
    drawCustom: (ctx, cx, cy, r) => {
      // Sacred-geometry arched portcullis gate with iron-gold vertical bars and bottom spikes
      const w = r * 0.78;
      const topY = cy - r * 0.72;
      const botY = cy + r * 0.68;
      ctx.lineWidth = 4.5;
      // Outer arch frame
      ctx.beginPath();
      ctx.moveTo(cx - w, botY);
      ctx.lineTo(cx - w, cy - r * 0.12);
      ctx.arc(cx, cy - r * 0.12, w, Math.PI, 0, false);
      ctx.lineTo(cx + w, botY);
      ctx.stroke();

      // Horizontal portcullis crossbars
      for (const yf of [-0.15, 0.25]) {
        const py = cy + r * yf;
        ctx.beginPath();
        ctx.moveTo(cx - w * 0.92, py);
        ctx.lineTo(cx + w * 0.92, py);
        ctx.strokeStyle = 'rgba(18, 22, 38, 0.75)';
        ctx.lineWidth = 6.5;
        ctx.stroke();
        ctx.strokeStyle = '#FFFDF9';
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }

      // Vertical portcullis spears with pointed tips
      for (const xf of [-0.46, 0, 0.46]) {
        const px = cx + w * xf;
        const barTop = topY + Math.abs(xf) * r * 0.22;
        ctx.beginPath();
        ctx.moveTo(px, barTop);
        ctx.lineTo(px, botY + r * 0.1);
        ctx.strokeStyle = 'rgba(18, 22, 38, 0.75)';
        ctx.lineWidth = 6.5;
        ctx.stroke();
        ctx.strokeStyle = '#FFFDF9';
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }
    },
  },
  {
    // Dedicated architectural pillar capstone emblem (`pass1-courtyard.ts`), decoupled from `CB_5`
    keys: ['DIAMOND', 'PILLAR_DIAMOND'],
    glyph: '◆',
    drawCustom: (ctx, cx, cy, r) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(11, 15, 29, 0.88)';
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = 'rgba(255, 250, 235, 0.72)';
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = '#FFFDF9';
      ctx.strokeStyle = 'rgba(8, 12, 24, 0.94)';
      ctx.lineWidth = 4.4;
      drawPolygon(ctx, cx, cy, r * 0.86 * 0.76, 4, -Math.PI / 2);
      ctx.restore();
    },
  },
];

let cachedAtlasData: AtlasTextureData | null = null;

export function createAtlasTextureData(): AtlasTextureData {
  if (cachedAtlasData) {
    return cachedAtlasData;
  }

  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;

  const ctx = canvas.getContext('2d');
  const regions: Record<string, AtlasUVRegion> = {};

  if (ctx) {
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }

  for (let i = 0; i < ATLAS_SLOTS.length; i++) {
    const slot = ATLAS_SLOTS[i];
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    if (row >= GRID_ROWS) break;

    const x0 = col * CELL_SIZE + PADDING;
    const y0 = row * CELL_SIZE + PADDING;
    const w = CELL_SIZE - PADDING * 2;
    const h = CELL_SIZE - PADDING * 2;
    const cx = x0 + w * 0.5;
    const cy = y0 + h * 0.5;
    const radius = w * 0.45;

    if (ctx) {
      ctx.save();
      const isColorblindGlyph = slot.keys[0]?.startsWith('CB_') ?? false;
      if (isColorblindGlyph) {
        // Refined cloisonne enamel seal: deep velvet disc + warm champagne-ivory inner fillet ring
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.96, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(9, 13, 24, 0.78)';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255, 248, 226, 0.86)';
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = '#FFFDF9';
      ctx.strokeStyle = isColorblindGlyph ? 'rgba(6, 10, 20, 0.92)' : 'rgba(18, 22, 38, 0.65)';
      ctx.lineWidth = isColorblindGlyph ? 3.2 : 4.0;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      if (slot.drawCustom) {
        slot.drawCustom(ctx, cx, cy, isColorblindGlyph ? radius * 0.88 : radius);
      } else if (slot.glyph) {
        ctx.font = '900 48px "Inter", "SF Pro Rounded", system-ui, -apple-system, sans-serif';
        ctx.strokeText(slot.glyph, cx, cy + 2);
        ctx.fillText(slot.glyph, cx, cy + 2);
      }
      ctx.restore();
    }

    const region: AtlasUVRegion = {
      u0: x0 / ATLAS_SIZE,
      v0: y0 / ATLAS_SIZE,
      u1: (x0 + w) / ATLAS_SIZE,
      v1: (y0 + h) / ATLAS_SIZE,
    };

    for (const key of slot.keys) {
      regions[key] = region;
    }
  }

  cachedAtlasData = {
    canvas,
    width: ATLAS_SIZE,
    height: ATLAS_SIZE,
    regions,
  };

  return cachedAtlasData;
}
