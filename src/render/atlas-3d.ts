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
  // Row 0: Colorblind Symbols 0..5
  {
    keys: ['CB_0', '▨', 'STONE'],
    glyph: '▨',
    drawCustom: (ctx, cx, cy, r) => {
      const s = r * 0.72;
      ctx.strokeRect(cx - s, cy - s, s * 2, s * 2);
      ctx.fillRect(cx - s, cy - s, s * 2, s * 2);
      ctx.save();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.7, cy - s * 0.2);
      ctx.lineTo(cx - s * 0.2, cy - s * 0.7);
      ctx.moveTo(cx - s * 0.6, cy + s * 0.6);
      ctx.lineTo(cx + s * 0.6, cy - s * 0.6);
      ctx.moveTo(cx + s * 0.2, cy + s * 0.7);
      ctx.lineTo(cx + s * 0.7, cy + s * 0.2);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    keys: ['CB_1', '●', 'CIRCLE'],
    glyph: '●',
    drawCustom: (ctx, cx, cy, r) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
    },
  },
  {
    keys: ['CB_2', '▲', 'TRIANGLE'],
    glyph: '▲',
    drawCustom: (ctx, cx, cy, r) => {
      drawPolygon(ctx, cx, cy + r * 0.08, r * 0.76, 3, -Math.PI / 2);
    },
  },
  {
    keys: ['CB_3', '■', 'SQUARE'],
    glyph: '■',
    drawCustom: (ctx, cx, cy, r) => {
      const s = r * 0.62;
      ctx.beginPath();
      ctx.rect(cx - s, cy - s, s * 2, s * 2);
      ctx.stroke();
      ctx.fill();
    },
  },
  {
    keys: ['CB_4', '★', 'STAR_SYM'],
    glyph: '★',
    drawCustom: (ctx, cx, cy, r) => {
      drawStarPolygon(ctx, cx, cy + r * 0.04, r * 0.78, r * 0.34, 5);
    },
  },
  {
    keys: ['CB_5', '◆', 'DIAMOND'],
    glyph: '◆',
    drawCustom: (ctx, cx, cy, r) => {
      drawPolygon(ctx, cx, cy, r * 0.76, 4, -Math.PI / 2);
    },
  },

  // Row 1: Colorblind Symbols 6..9 + Axis-Lock Chevrons
  {
    keys: ['CB_6', '✚', 'CROSS'],
    glyph: '✚',
    drawCustom: (ctx, cx, cy, r) => {
      const w = r * 0.28;
      const l = r * 0.72;
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
      ctx.stroke();
      ctx.fill();
    },
  },
  {
    keys: ['CB_7', '⬢', 'HEX'],
    glyph: '⬢',
    drawCustom: (ctx, cx, cy, r) => {
      drawPolygon(ctx, cx, cy, r * 0.74, 6, -Math.PI / 2);
    },
  },
  {
    keys: ['CB_8', '♥', 'HEART'],
    glyph: '♥',
    drawCustom: (ctx, cx, cy, r) => {
      const s = r * 0.72;
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.85);
      ctx.bezierCurveTo(cx - s * 1.2, cy + s * 0.1, cx - s * 0.95, cy - s * 0.85, cx, cy - s * 0.3);
      ctx.bezierCurveTo(cx + s * 0.95, cy - s * 0.85, cx + s * 1.2, cy + s * 0.1, cx, cy + s * 0.85);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    },
  },
  {
    keys: ['CB_9', '═', 'BARS'],
    glyph: '═',
    drawCustom: (ctx, cx, cy, r) => {
      const w = r * 0.72;
      const h = r * 0.18;
      const gap = r * 0.28;
      ctx.beginPath();
      ctx.rect(cx - w, cy - gap - h, w * 2, h * 2);
      ctx.rect(cx - w, cy + gap - h, w * 2, h * 2);
      ctx.stroke();
      ctx.fill();
    },
  },
  {
    keys: ['LOCK_H', '↔', 'AXIS_H'],
    glyph: '↔',
    drawCustom: (ctx, cx, cy, r) => {
      // Pill-free sculpted architectural double-headed chevron arrow (`Pillar 2`)
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
      // Pill-free sculpted architectural double-headed chevron arrow (`Pillar 2`)
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
      ctx.fillStyle = '#FFFDF9';
      ctx.strokeStyle = 'rgba(18, 22, 38, 0.65)';
      ctx.lineWidth = 4.0;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      if (slot.drawCustom) {
        slot.drawCustom(ctx, cx, cy, radius);
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
