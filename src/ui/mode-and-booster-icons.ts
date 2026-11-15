import type { BoosterType, PlayMode } from '../core/types';

export type ButtonActionGlyphKind =
  | 'play'
  | 'restart'
  | 'back'
  | 'forward'
  | 'plus'
  | 'bolt'
  | 'spark'
  | 'eye';

export interface StructuredButtonParts {
  mode?: PlayMode;
  modeIcon?: string;
  actionGlyph?: string;
  actionKind?: ButtonActionGlyphKind;
  label: string;
  trailingGlyph?: string;
  trailingKind?: ButtonActionGlyphKind;
}

export const BOOSTER_TOKENS: Record<BoosterType, string> = {
  UNDO: '↩️',
  HINT: '💡',
  HAMMER: '🔨',
  ROCKET: '🚀',
  VACUUM: '🧲',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const INLINE_JEWEL_TOKEN_RE = /(⚔️?|🌿|⏱️?|↩️?|💡|🔨|🚀|🧲)/g;

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

type VectorPathTuple = readonly [d: string, fillOp?: string, strokeW?: string];

interface ChiseledIconSpec {
  sw: string;
  dial?: readonly [cx: string, cy: string, r: string, dash?: string, fillOp?: string];
  core?: readonly [cx: string, cy: string, r: string];
  paths: readonly VectorPathTuple[];
}

const MODE_ICON_SHAPES: Record<PlayMode, ChiseledIconSpec> = {
  ZEN: {
    sw: '2',
    paths: [
      ['M5.5 18.5C5.5 10.5 11.2 5.2 20 4C18.8 12.8 13.5 18.5 5.5 18.5Z', '0.24'],
      ['M3.5 20.5C6.8 17.2 10.8 13.2 15.4 8.6'],
      ['M9.8 14.2V10.8M9.8 14.2H13.2', undefined, '1.75'],
    ],
  },
  TIMED: {
    sw: '2.05',
    dial: ['12', '13.3', '7.7', undefined, '0.2'],
    paths: [
      ['M12 13.3V8.3A5 5 0 0 1 16.3 10.8Z', '0.34', '0'],
      ['M9.5 2.5h5M12 2.5v3M17.6 7.7l1.9-1.9'],
      ['M12 13.3V8.5M12 13.3l3.6-2.1'],
    ],
  },
  CHALLENGE: {
    sw: '1.9',
    paths: [
      ['M3.5 3.5L8.5 5L15.5 12L12 15.5L5 8.5Z', '0.24'],
      ['M10.5 17L17 10.5M13.8 13.8L19.5 19.5'],
      ['M20.5 3.5L15.5 5L8.5 12L12 15.5L19 8.5Z', '0.24'],
      ['M13.5 17L7 10.5M10.2 13.8L4.5 19.5'],
    ],
  },
};

const BOOSTER_ICON_SHAPES: Record<BoosterType, ChiseledIconSpec> = {
  UNDO: {
    sw: '2.25',
    paths: [['M9 14 4 9l5-5'], ['M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11']],
  },
  HINT: {
    sw: '2.1',
    paths: [
      [
        'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
        '0.24',
      ],
      ['M12 7.5v3.2', undefined, '1.8'],
      ['M9 18h6'],
      ['M10 22h4'],
    ],
  },
  HAMMER: {
    sw: '2.15',
    paths: [
      ['m14 13-8.5 8.5a1.5 1.5 0 0 1-2-2L12 11'],
      ['m16 6 3 3'],
      ['M9.5 6.5 14 2l8 8-4.5 4.5-8-8Z', '0.24'],
    ],
  },
  ROCKET: {
    sw: '2.15',
    paths: [['M12 2 19 14 12 11 5 14Z', '0.26'], ['M12 11v11'], ['m8 18 4-3 4 3']],
  },
  VACUUM: {
    sw: '2.1',
    dial: ['12', '12', '9', '3 3'],
    core: ['12', '12', '2.3'],
    paths: [['M12 5 19 12 12 19 5 12Z', '0.24']],
  },
};

function buildChiseledSvg(spec: ChiseledIconSpec, className: string): SVGSVGElement {
  const svg = createSvgElement('svg', {
    class: className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': spec.sw,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  if (spec.dial) {
    const [cx, cy, r, dash, fillOp] = spec.dial;
    const dialAttrs: Record<string, string> = { cx, cy, r };
    if (fillOp) {
      dialAttrs.fill = 'currentColor';
      dialAttrs['fill-opacity'] = fillOp;
    }
    if (dash) dialAttrs['stroke-dasharray'] = dash;
    svg.appendChild(createSvgElement('circle', dialAttrs));
  }
  for (const [d, fillOp, strokeW] of spec.paths) {
    const attrs: Record<string, string> = { d };
    if (fillOp) {
      attrs.fill = 'currentColor';
      attrs['fill-opacity'] = fillOp;
    }
    if (strokeW === '0') attrs.stroke = 'none';
    else if (strokeW) attrs['stroke-width'] = strokeW;
    svg.appendChild(createSvgElement('path', attrs));
  }
  if (spec.core) {
    const [cx, cy, r] = spec.core;
    svg.appendChild(createSvgElement('circle', { cx, cy, r, fill: 'currentColor', stroke: 'none' }));
  }
  return svg;
}

/** Builds the Chiseled Line + Inlay SVG emblem (`viewBox="0 0 24 24"`, pure DOM, zero `innerHTML`). */
export function createModeIconSvg(mode: PlayMode): SVGSVGElement {
  return buildChiseledSvg(MODE_ICON_SHAPES[mode], 'mode-svg-icon');
}

/** Builds the matching Power-Up Chiseled Line + Inlay SVG emblem for jewel toasts and banners. */
export function createBoosterIconSvg(type: BoosterType): SVGSVGElement {
  return buildChiseledSvg(BOOSTER_ICON_SHAPES[type], 'mode-svg-icon booster-svg-icon');
}

/**
 * Renders a monochromatic `currentColor` Chiseled Line + Inlay SVG directly inside an interactive
 * mode icon slot (folder tab, HUD wing, Keystone pill, Bottom Nav tab).
 */
export function setModeIconElement(el: HTMLElement | null, mode: PlayMode): void {
  if (!el) return;
  if (el.dataset.modeSvgRendered === mode && el.getAttribute('data-mode-glyph') === mode) return;
  el.dataset.modeSvgRendered = mode;
  el.setAttribute('data-mode-glyph', mode);
  el.replaceChildren(createModeIconSvg(mode));
}

/** Creates a faceted glowing jewel crest wrapping a mode SVG for informational, toast & reward surfaces. */
export function createInlineModeIconSpan(mode: PlayMode): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'inline-mode-icon';
  span.setAttribute('data-mode-glyph', mode);
  span.setAttribute('aria-hidden', 'true');
  span.appendChild(createModeIconSvg(mode));
  return span;
}

/** Creates a rarity/powerup-tinted faceted glowing jewel crest matching the `#booster-dock` SVG. */
export function createInlineBoosterIconSpan(type: BoosterType): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'inline-mode-icon inline-booster-icon';
  span.setAttribute('data-booster-glyph', type);
  span.setAttribute('aria-hidden', 'true');
  span.appendChild(createBoosterIconSvg(type));
  return span;
}

function createInlineTokenJewel(token: string): HTMLSpanElement | null {
  if (token.startsWith('🌿')) return createInlineModeIconSpan('ZEN');
  if (token.startsWith('⏱')) return createInlineModeIconSpan('TIMED');
  if (token.startsWith('⚔')) return createInlineModeIconSpan('CHALLENGE');
  if (token.startsWith('↩')) return createInlineBoosterIconSpan('UNDO');
  if (token === '💡') return createInlineBoosterIconSpan('HINT');
  if (token === '🔨') return createInlineBoosterIconSpan('HAMMER');
  if (token === '🚀') return createInlineBoosterIconSpan('ROCKET');
  if (token === '🧲') return createInlineBoosterIconSpan('VACUUM');
  return null;
}

/**
 * Converts text containing mode (`⚔️`/`🌿`/`⏱️`) or power-up (`↩️`/`💡`/`🔨`/`🚀`/`🧲`) tokens into
 * pure DOM nodes with faceted glowing jewel crests while keeping plain prose intact (`SAVE-SEC-01`).
 */
export function buildNodesWithModeIcons(text: string): Node[] {
  const nodes: Node[] = [];
  let lastIndex = 0;
  INLINE_JEWEL_TOKEN_RE.lastIndex = 0;
  let match = INLINE_JEWEL_TOKEN_RE.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const jewel = createInlineTokenJewel(match[0]);
    nodes.push(jewel ?? document.createTextNode(match[0]));
    lastIndex = match.index + match[0].length;
    match = INLINE_JEWEL_TOKEN_RE.exec(text);
  }
  if (lastIndex < text.length || nodes.length === 0) {
    nodes.push(document.createTextNode(text.slice(lastIndex)));
  }
  return nodes;
}

/** Cached DOM updater for non-interactive informational text that may contain mode/booster tokens. */
export function setRichModeText(el: HTMLElement | null, text: string): void {
  if (!el) return;
  if (el.dataset.richModeSig === text) return;
  el.dataset.richModeSig = text;
  el.replaceChildren(...buildNodesWithModeIcons(text));
}

function createBridgeSpace(): HTMLSpanElement {
  const sp = document.createElement('span');
  sp.className = 'btn-space';
  sp.setAttribute('aria-hidden', 'true');
  sp.textContent = ' ';
  return sp;
}

/**
 * Renders an icon + label button using pure DOM spans (`SAVE-SEC-01`, zero `innerHTML`) so CSS
 * flex gap and optical icon scaling align monochromatic SVGs & action glyphs uniformly.
 */
export function setButtonIconLabel(el: HTMLElement | null, parts: StructuredButtonParts): void {
  if (!el) return;
  const sig = [
    parts.mode ?? '',
    parts.mode ? 'svg' : (parts.modeIcon ?? ''),
    parts.actionKind ?? '',
    parts.actionGlyph ?? '',
    parts.label,
    parts.trailingKind ?? '',
    parts.trailingGlyph ?? '',
  ].join('\u0001');
  if (el.dataset.btnIconSig === sig && el.classList.contains('btn-structured')) return;
  el.dataset.btnIconSig = sig;
  el.classList.add('btn-structured');

  const children: Node[] = [];
  const hasSvgMode = Boolean(parts.mode);

  const appendModeEmblem = (): HTMLSpanElement => {
    const modeSpan = document.createElement('span');
    modeSpan.className = 'btn-mode-emblem';
    modeSpan.setAttribute('aria-hidden', 'true');
    if (parts.mode) {
      modeSpan.setAttribute('data-mode-glyph', parts.mode);
      modeSpan.appendChild(createModeIconSvg(parts.mode));
    } else if (parts.modeIcon) {
      modeSpan.textContent = parts.modeIcon;
    }
    return modeSpan;
  };

  if ((parts.mode || parts.modeIcon) && parts.actionGlyph) {
    const cluster = document.createElement('span');
    cluster.className = 'btn-icon-cluster';
    cluster.setAttribute('aria-hidden', 'true');

    const modeSpan = appendModeEmblem();
    const actSpan = document.createElement('span');
    actSpan.className = 'btn-action-glyph';
    if (parts.actionKind) actSpan.setAttribute('data-glyph', parts.actionKind);
    actSpan.textContent = parts.actionGlyph;

    if (hasSvgMode) {
      cluster.append(modeSpan, actSpan);
    } else {
      cluster.append(modeSpan, createBridgeSpace(), actSpan);
    }
    children.push(cluster, createBridgeSpace());
  } else if (parts.mode || parts.modeIcon) {
    children.push(appendModeEmblem());
    if (!hasSvgMode) {
      children.push(createBridgeSpace());
    }
  } else if (parts.actionGlyph) {
    const actSpan = document.createElement('span');
    actSpan.className = 'btn-action-glyph';
    actSpan.setAttribute('aria-hidden', 'true');
    if (parts.actionKind) actSpan.setAttribute('data-glyph', parts.actionKind);
    actSpan.textContent = parts.actionGlyph;
    children.push(actSpan, createBridgeSpace());
  }

  const labelSpan = document.createElement('span');
  labelSpan.className = 'btn-label-text';
  labelSpan.textContent = parts.label;
  children.push(labelSpan);

  if (parts.trailingGlyph) {
    const trailSpan = document.createElement('span');
    trailSpan.className = 'btn-action-glyph';
    trailSpan.setAttribute('aria-hidden', 'true');
    if (parts.trailingKind) trailSpan.setAttribute('data-glyph', parts.trailingKind);
    trailSpan.textContent = parts.trailingGlyph;
    children.push(createBridgeSpace(), trailSpan);
  }

  el.replaceChildren(...children);
}

/** Formats dynamic CTA level references concisely for 3+ digit campaign/endless stages. */
export function formatCompactLevelRef(levelId: number): string {
  const safeId = Math.max(1, Math.trunc(levelId));
  return safeId >= 100 ? `#${safeId}` : `Lvl ${safeId}`;
}

/**
 * Formats the persistent Bottom Nav Play/Resume label with responsive sub-spans (`Lvl ` hides only
 * when resuming on ultra-compact containers <= 78px, while 3+ digit stages use compact `#N` notation).
 */
export function renderNavPlayLabel(
  labelEl: HTMLElement | null,
  btnEl: HTMLElement | null,
  levelId: number,
  resumable: boolean
): void {
  const safeId = Math.max(1, Math.trunc(levelId));
  if (btnEl) {
    btnEl.setAttribute('data-resumable', resumable ? 'true' : 'false');
    btnEl.setAttribute('data-level-digits', String(String(safeId).length));
  }
  if (!labelEl) return;
  const sig = `${safeId}:${resumable ? 1 : 0}`;
  if (labelEl.dataset.navPlaySig === sig) return;
  labelEl.dataset.navPlaySig = sig;

  const verbSpan = document.createElement('span');
  verbSpan.className = 'tab-play-verb';
  verbSpan.textContent = resumable ? 'Resume ' : 'Play ';

  const numSpan = document.createElement('span');
  numSpan.className = 'tab-play-num';
  numSpan.textContent = safeId >= 100 ? `#${safeId}` : String(safeId);

  if (safeId < 100) {
    const lvlWordSpan = document.createElement('span');
    lvlWordSpan.className = 'tab-play-lvl-word';
    lvlWordSpan.textContent = 'Lvl ';
    labelEl.replaceChildren(verbSpan, lvlWordSpan, numSpan);
  } else {
    labelEl.replaceChildren(verbSpan, numSpan);
  }
}

/**
 * Formats onboarding unlock notes and contextual helper toasts with a highlighted semantic lead
 * (`<strong class="banner-kicker">`) and glowing jewel crests using pure DOM nodes (`SAVE-SEC-01`).
 */
export function renderStructuredBannerText(el: HTMLElement, text: string): void {
  delete el.dataset.richModeSig;
  let splitEnd = -1;
  const exclIdx = text.indexOf('! ');
  const colonIdx = text.indexOf(': ');
  const dashIdx = text.indexOf(' — ');

  if (exclIdx > 0 && exclIdx <= 48 && (colonIdx === -1 || exclIdx - colonIdx <= 28)) {
    splitEnd = exclIdx + 1;
  } else if (colonIdx > 0 && colonIdx <= 48) {
    splitEnd = colonIdx + 1;
  } else if (dashIdx > 0 && dashIdx <= 46) {
    splitEnd = dashIdx + 2;
  }

  if (splitEnd > 0 && splitEnd < text.length - 2) {
    const lead = document.createElement('strong');
    lead.className = 'banner-kicker';
    lead.replaceChildren(...buildNodesWithModeIcons(text.slice(0, splitEnd)));
    el.replaceChildren(lead, ...buildNodesWithModeIcons(text.slice(splitEnd)));
  } else {
    el.replaceChildren(...buildNodesWithModeIcons(text));
  }
}
