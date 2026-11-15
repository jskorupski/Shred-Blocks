import { describe, expect, it } from 'vitest';
import { createBoardState } from '../../src/core/board';
import { getLevelSpec } from '../../src/levels/catalog';
import { deriveKeystoneHudState, formatClockCompact } from '../../src/ui/hud-keystone';
import { buildNodesWithModeIcons, formatCompactLevelRef } from '../../src/ui/mode-and-booster-icons';

const DEFAULT_SAVE = {
  zenBlessings: 1,
  zenStarProgress: 2,
};

describe('HUD Keystone view-model derivation (HUD-KEYSTONE-01)', () => {
  it('formats Speed Rush clocks cleanly at boundaries', () => {
    expect(formatClockCompact(90)).toBe('1:30');
    expect(formatClockCompact(41.2)).toBe('0:42');
    expect(formatClockCompact(5.0)).toBe('0:05');
    expect(formatClockCompact(4.1)).toBe('0:05');
    expect(formatClockCompact(0.01)).toBe('0:01');
    expect(formatClockCompact(0)).toBe('0:00');
    expect(formatClockCompact(-2)).toBe('0:00');
  });

  it('derives Challenge urgency, star cutoffs, Final Touch, free moves, and continue cap', () => {
    const board = createBoardState(getLevelSpec(1));
    const initial = deriveKeystoneHudState(board, DEFAULT_SAVE, 'CHALLENGE', false);
    expect(initial.urgency).toBe('normal');
    expect(initial.metricKind).toBe('MOVES');
    expect(initial.heroValue).toBe('8');
    expect(initial.heroUnit).toBe('Moves Left');
    expect(initial.metaPrimary).toBe('★★★');
    expect(initial.metaSecondary).toBe('Par 2 · 0/4');
    expect(initial.tick3Pct).toBe(50);
    expect(initial.tick2Pct).toBe(25);

    board.freeMovesRemaining = 2;
    const bonus = deriveKeystoneHudState(board, DEFAULT_SAVE, 'CHALLENGE', false);
    expect(bonus.urgency).toBe('bonus');
    expect(bonus.modBadge).toBe('+2 Free');

    board.freeMovesRemaining = 0;
    board.movesRemaining = 3;
    board.movesCommitted = 5;
    const warn = deriveKeystoneHudState(board, DEFAULT_SAVE, 'CHALLENGE', false);
    expect(warn.urgency).toBe('warn');
    expect(warn.heroValue).toBe('3');
    expect(warn.heroUnit).toBe('⚠️ Moves Left');
    expect(warn.metaPrimary).toBe('★★☆');
    expect(warn.metaSecondary).toBe('Par 2 · 5/6');

    board.movesRemaining = 1;
    board.movesCommitted = 7;
    const critical = deriveKeystoneHudState(board, DEFAULT_SAVE, 'CHALLENGE', false);
    expect(critical.urgency).toBe('critical');
    expect(critical.heroValue).toBe('1');
    expect(critical.heroUnit).toBe('⚠️ Last Move');
    expect(critical.metaPrimary).toBe('★☆☆');
    expect(critical.metaSecondary).toBe('1★ Clear · Par 2');

    // Final Touch: 0 moves left while last-moved block still aligns with a clearable gate on Level 1
    board.movesRemaining = 0;
    board.movesCommitted = 8;
    board.lastMovedBlockId = 1;
    const finalTouch = deriveKeystoneHudState(board, DEFAULT_SAVE, 'CHALLENGE', false);
    expect(finalTouch.urgency).toBe('critical');
    expect(finalTouch.heroValue).toBe('0+');
    expect(finalTouch.heroUnit).toBe('Final Touch');
    expect(finalTouch.modBadge).toBe('✦ Slide block');
    expect(finalTouch.metaSecondary).toBe('Finish to gate');
    expect(finalTouch.gaugeScale).toBe(0.04);

    // After purchasing Continue: stars cap at 1★ and cutoff ticks disappear
    board.movesRemaining = 4;
    board.continuesUsed = 1;
    const continued = deriveKeystoneHudState(board, DEFAULT_SAVE, 'CHALLENGE', false);
    expect(continued.metaPrimary).toBe('★☆☆');
    expect(continued.metaSecondary).toBe('1★ Cap · Par 2');
    expect(continued.tick3Pct).toBeNull();
    expect(continued.tick2Pct).toBeNull();
  });

  it('derives Speed Rush countdown, staged <=15s / <=5s urgency, freeze, bombs, and calm title ring', () => {
    const board = createBoardState(getLevelSpec(1));
    const ready = deriveKeystoneHudState(board, DEFAULT_SAVE, 'TIMED', false);
    expect(ready.urgency).toBe('normal');
    expect(ready.metricKind).toBe('TIMER');
    expect(ready.heroValue).toBe('1:30');
    expect(ready.heroUnit).toBe('Time Left');
    expect(ready.modBadge).toBe('Ready');
    expect(ready.metaPrimary).toBe('★★★');
    expect(ready.metaSecondary).toBe('3★≥0:26');
    expect(ready.tick3Pct).toBe(28);
    expect(ready.tick2Pct).toBe(12);

    board.timerRunning = true;
    board.movesCommitted = 1;
    board.timeRemainingSec = 14.2;
    const warn = deriveKeystoneHudState(board, DEFAULT_SAVE, 'TIMED', false);
    expect(warn.urgency).toBe('warn');
    expect(warn.boardRingUrgency).toBe('warn');
    expect(warn.heroValue).toBe('0:15');
    expect(warn.heroUnit).toBe('⏰ Low Time');
    expect(warn.metaPrimary).toBe('★★☆');
    expect(warn.metaSecondary).toBe('2★≥0:11');

    board.timeRemainingSec = 4.4;
    const critical = deriveKeystoneHudState(board, DEFAULT_SAVE, 'TIMED', false);
    expect(critical.urgency).toBe('critical');
    expect(critical.boardRingUrgency).toBe('critical');
    expect(critical.heroValue).toBe('0:05');
    expect(critical.heroUnit).toBe('⚠️ Hurry!');
    expect(critical.metaPrimary).toBe('★☆☆');
    expect(critical.metaSecondary).toBe('1★ Clear');

    // Title overlay open calms the peripheral board ring even if saved clock is critical
    const behindTitle = deriveKeystoneHudState(board, DEFAULT_SAVE, 'TIMED', true);
    expect(behindTitle.boardRingUrgency).toBe('calm');

    // Hint freeze overrides red/amber stress with bonus frost state
    board.freezeRemainingSec = 9.2;
    const frozen = deriveKeystoneHudState(board, DEFAULT_SAVE, 'TIMED', false);
    expect(frozen.urgency).toBe('bonus');
    expect(frozen.heroUnit).toBe('Frozen');
    expect(frozen.modBadge).toBe('❄️ 10s');

    // Active bombs surface tightest fuse count in secondary readout
    board.blocks[0].bombMax = 5;
    board.blocks[0].bombCount = 3;
    const withBomb = deriveKeystoneHudState(board, DEFAULT_SAVE, 'TIMED', false);
    expect(withBomb.metaSecondary).toBe('1★ Clear · 💣3');
  });

  it('keeps Zen Mode calm and pressure-free even with bombs and high move counts', () => {
    const board = createBoardState(getLevelSpec(1));
    board.movesCommitted = 42;
    board.timeRemainingSec = 2;
    const calmFlow = deriveKeystoneHudState(board, DEFAULT_SAVE, 'ZEN', false);
    expect(calmFlow.urgency).toBe('calm');
    expect(calmFlow.boardRingUrgency).toBe('calm');
    expect(calmFlow.heroValue).toBe('∞');
    expect(calmFlow.heroUnit).toBe('No Limit');
    expect(calmFlow.modBadge).toBe('Moves 42');
    expect(calmFlow.metaPrimary).toBe('🌿 Calm Flow');
    expect(calmFlow.metaSecondary).toBe('★ 2/3 · 🌿 1/3');
    expect(calmFlow.gaugeScale).toBe(1);
    expect(calmFlow.tick3Pct).toBeNull();
    expect(calmFlow.tick2Pct).toBeNull();

    board.blocks[0].bombMax = 4;
    board.blocks[0].bombCount = 1;
    const inertBombs = deriveKeystoneHudState(board, { zenBlessings: 3, zenStarProgress: 0 }, 'ZEN', false);
    expect(inertBombs.urgency).toBe('calm');
    expect(inertBombs.metaPrimary).toBe('🌿 Bombs Inert');
    expect(inertBombs.metaSecondary).toBe('★ 0/3 · 🌿 3/3');
  });

  it('formats multi-digit compact level refs and upgrades mode + booster tokens into jewel crests', () => {
    expect(formatCompactLevelRef(1)).toBe('Lvl 1');
    expect(formatCompactLevelRef(99)).toBe('Lvl 99');
    expect(formatCompactLevelRef(100)).toBe('#100');
    expect(formatCompactLevelRef(177)).toBe('#177');
    expect(formatCompactLevelRef(2501)).toBe('#2501');
    expect(formatCompactLevelRef(99999)).toBe('#99999');

    interface MockNode {
      kind: 'text' | 'el';
      tag?: string;
      text?: string;
      attrs: Record<string, string>;
      children: MockNode[];
      className: string;
      setAttribute: (k: string, v: string) => void;
      appendChild: (child: MockNode) => MockNode;
    }
    const makeEl = (tag: string): MockNode => {
      const node: MockNode = {
        kind: 'el',
        tag,
        attrs: {},
        children: [],
        className: '',
        setAttribute(k: string, v: string) {
          this.attrs[k] = v;
        },
        appendChild(child: MockNode) {
          this.children.push(child);
          return child;
        },
      };
      return node;
    };
    const prevDoc = globalThis.document;
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tag: string) => makeEl(tag),
      createElementNS: (_ns: string, tag: string) => makeEl(tag),
      createTextNode: (text: string) => ({
        kind: 'text',
        text,
        attrs: {},
        children: [],
        className: '',
        setAttribute: () => {},
        appendChild: (c: MockNode) => c,
      }),
    };
    try {
      const nodes = buildNodesWithModeIcons(
        '💡 Hint · 🔨 Crush · 🚀 Blast · 🧲 Pull · ↩️ Undo · 🌿 Zen'
      ) as unknown as MockNode[];
      const spans = nodes.filter((n) => n.kind === 'el' && n.tag === 'span');
      expect(spans.map((s) => s.attrs['data-booster-glyph'] ?? s.attrs['data-mode-glyph'])).toEqual([
        'HINT',
        'HAMMER',
        'ROCKET',
        'VACUUM',
        'UNDO',
        'ZEN',
      ]);
      for (const s of spans) {
        expect(s.children[0]?.tag).toBe('svg');
      }
    } finally {
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }
  });
});
