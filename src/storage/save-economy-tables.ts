import type { BoosterType } from '../core/types';

export type BoosterRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

export const BOOSTER_RARITY: Record<BoosterType, BoosterRarity> = {
  UNDO: 'COMMON',
  HINT: 'UNCOMMON',
  HAMMER: 'RARE',
  ROCKET: 'EPIC',
  VACUUM: 'LEGENDARY',
};

export const BOOSTER_UNLOCK_LEVEL: Record<BoosterType, number> = {
  UNDO: 1,
  HINT: 2,
  HAMMER: 8,
  ROCKET: 18,
  VACUUM: 30,
};

export const BOOSTER_COIN_COSTS: Record<BoosterType, number> = {
  UNDO: 60,
  HINT: 80,
  HAMMER: 140,
  ROCKET: 220,
  VACUUM: 350,
};

export const CONTINUE_COIN_COST = 150;
export const THEME_TIER_PRICES = [0, 250, 450, 750, 1200] as const;

/**
 * Returns true if the given `BoosterType` is unlocked at `effectiveLevel`
 * (`Math.max(currentLevelId, highestLevelUnlocked)`).
 */
export function isBoosterUnlocked(type: BoosterType, effectiveLevel: number): boolean {
  return Math.max(1, Math.floor(effectiveLevel)) >= BOOSTER_UNLOCK_LEVEL[type];
}

/**
 * Deterministic Rarity-Weighted & Level-Gated Booster Drop Table (`ECON-03`).
 * - Never drops a booster that has not yet been unlocked at `effectiveLevel`.
 * - Enforces strict scarcity weights:
 *   - Shredder Chest: COMMON (42%), UNCOMMON (30%), RARE (16%), EPIC (8%), LEGENDARY (4%).
 *   - Milestone / Oracle Chest: Guarantees UNCOMMON+ and celebrates newly unlocked tiers.
 */
export function pickRarityWeightedBooster(
  seed: number,
  effectiveLevel: number,
  isMilestoneChest = false
): BoosterType {
  const lvl = Math.max(1, Math.floor(effectiveLevel));
  // Milestone debut guarantees: L10 -> HAMMER (Rare), L20 -> ROCKET (Epic), L30 -> VACUUM (Legendary)
  if (isMilestoneChest) {
    if (lvl === 10) return 'HAMMER';
    if (lvl === 20) return 'ROCKET';
    if (lvl === 30) return 'VACUUM';
  }

  const baseWeights: ReadonlyArray<{ type: BoosterType; shredWeight: number; mileWeight: number }> = [
    { type: 'UNDO', shredWeight: 42, mileWeight: 0 },
    { type: 'HINT', shredWeight: 30, mileWeight: 38 },
    { type: 'HAMMER', shredWeight: 16, mileWeight: 32 },
    { type: 'ROCKET', shredWeight: 8, mileWeight: 20 },
    { type: 'VACUUM', shredWeight: 4, mileWeight: 10 },
  ];

  const eligible = baseWeights.filter((entry) => isBoosterUnlocked(entry.type, lvl));
  const pool =
    eligible.length > 0 ? eligible : [{ type: 'UNDO' as const, shredWeight: 100, mileWeight: 100 }];

  const totalWeight = pool.reduce(
    (sum, item) => sum + (isMilestoneChest ? Math.max(1, item.mileWeight) : item.shredWeight),
    0
  );
  // Mulberry-style hash of seed for well-distributed deterministic roll in [0, totalWeight - 1]
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  const roll = (h ^ (h >>> 16)) >>> 0;
  let cursor = roll % totalWeight;

  for (const item of pool) {
    const w = isMilestoneChest ? Math.max(1, item.mileWeight) : item.shredWeight;
    if (cursor < w) {
      return item.type;
    }
    cursor -= w;
  }
  return pool[0].type;
}

/**
 * Extracts a `SB1-...` save code from a URL hash string like `#import=SB1-...`.
 */
export function extractImportCodeFromHash(
  hash = typeof window !== 'undefined' ? window.location.hash : ''
): string | null {
  if (!hash) return null;
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  const fromParam = params.get('import');
  if (fromParam && /^SB1-/i.test(fromParam.trim())) {
    return fromParam.trim();
  }
  const match = trimmed.match(/(?:^|&)import=(SB1-[A-Za-z0-9\-_]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}
