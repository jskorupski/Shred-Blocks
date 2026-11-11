import type { BoosterType, LevelRecord, ParticleStyleId, SavePayloadV1, SkinId, TrayId } from '../core/types';
import { decodeSaveCode, encodeSaveCode, validateSavePayloadV1 } from './save-code';

export const SAVE_STORAGE_KEY = 'shredblocks.save.v1';
export const PRE_IMPORT_BACKUP_KEY = 'shredblocks.save.pre_import_backup';
export const IDB_DB_NAME = 'ShredBlocksDB';
export const IDB_STORE_NAME = 'saves';
export const IDB_PRIMARY_KEY = 'primary';

export type BoosterRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

export const BOOSTER_RARITY: Record<BoosterType, BoosterRarity> = {
  UNDO: 'COMMON',
  FREEZE: 'UNCOMMON',
  HAMMER: 'RARE',
  ROCKET: 'EPIC',
  VACUUM: 'LEGENDARY',
};

export const BOOSTER_UNLOCK_LEVEL: Record<BoosterType, number> = {
  UNDO: 1,
  FREEZE: 2,
  HAMMER: 8,
  ROCKET: 18,
  VACUUM: 30,
};

export const BOOSTER_COIN_COSTS: Record<BoosterType, number> = {
  UNDO: 60,
  FREEZE: 80,
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
 *   - Milestone Chest (every 10 levels): Guarantees UNCOMMON+ and celebrates newly unlocked tiers.
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
    { type: 'FREEZE', shredWeight: 30, mileWeight: 38 },
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

export interface LevelWinRewardSummary {
  isFirstClear: boolean;
  zenClear: boolean;
  starsEarned: 0 | 1 | 2 | 3;
  starsImproved: number;
  baseCoins: number;
  starCoins: number;
  streakCoins: number;
  chestCoins: number;
  totalCoinsEarned: number;
  shredderChestsOpened: number;
  milestoneChestOpened: boolean;
  starReliquaryChestsOpened: number;
  rewardedBoosters: BoosterType[];
}

export function createDefaultSavePayload(): SavePayloadV1 {
  return {
    schemaVersion: 1,
    appId: 'shredblocks-color-jam',
    writeSeq: 1,
    updatedAt: Date.now(),
    highestLevelUnlocked: 1,
    currentLevelId: 1,
    coins: 120,
    totalStars: 0,
    winStreak: 0,
    bestWinStreak: 0,
    totalBlocksShredded: 0,
    totalMovesCommitted: 0,
    shredderChestProgress: 0,
    milestoneChestLevel: 0,
    starReliquaryLevel: 0,
    economyVersion: 2,
    boosters: {
      UNDO: 3,
      FREEZE: 2,
      HAMMER: 1,
      ROCKET: 1,
      VACUUM: 1,
    },
    unlockedSkins: ['classic_studs'],
    unlockedTrays: ['industrial_slate'],
    unlockedParticles: ['micro_cubes'],
    equippedSkin: 'classic_studs',
    equippedTray: 'industrial_slate',
    equippedParticle: 'micro_cubes',
    settings: {
      playMode: 'CHALLENGE',
      sfxEnabled: true,
      musicEnabled: true,
      hapticsEnabled: true,
      colorblindSymbols: false,
      highContrast: false,
      reducedMotion: false,
      qualityTier: 'AUTO',
    },
    levelRecords: {},
  };
}

/**
 * One-time graceful migration from Economy v1 -> v2 (`ECON-V2`):
 * - Switches legacy default `'ZEN'` -> `'CHALLENGE'` so returning players experience Move Budgets
 * - Soft-scales bloated v1 coin balances (`> 600`) while preserving every unlocked item & star
 * - Initializes `starReliquaryLevel` to current 25-star milestone floor
 */
export function migrateLegacyEconomy(payload: SavePayloadV1): SavePayloadV1 {
  if ((payload.economyVersion ?? 1) >= 2) return payload;
  const migrated = clonePayload(payload);
  if (migrated.settings.playMode === 'ZEN') {
    migrated.settings.playMode = 'CHALLENGE';
  }
  if (migrated.coins > 600) {
    migrated.coins = Math.min(migrated.coins, 600 + Math.round((migrated.coins - 600) ** 0.72 * 3.5));
  }
  migrated.starReliquaryLevel = Math.floor((migrated.totalStars || 0) / 25) * 25;
  migrated.economyVersion = 2;
  return migrated;
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

function clonePayload(payload: SavePayloadV1): SavePayloadV1 {
  const records: Record<number, LevelRecord> = {};
  for (const [k, v] of Object.entries(payload.levelRecords)) {
    records[Number(k)] = { ...v };
  }
  return {
    ...payload,
    boosters: { ...payload.boosters },
    unlockedSkins: [...payload.unlockedSkins],
    unlockedTrays: [...payload.unlockedTrays],
    unlockedParticles: [...payload.unlockedParticles],
    settings: { ...payload.settings },
    levelRecords: records,
  };
}

export class SaveManager {
  private payload: SavePayloadV1;
  private readonly listeners = new Set<(payload: SavePayloadV1) => void>();

  constructor() {
    const local = this.readLocalStorage(SAVE_STORAGE_KEY);
    this.payload = local ? migrateLegacyEconomy(local) : createDefaultSavePayload();
  }

  /**
   * STOR-02 Dual-Store Reconciliation:
   * Reads both `localStorage['shredblocks.save.v1']` and `IndexedDB` (`ShredBlocksDB`),
   * selects whichever valid payload has the higher `writeSeq`, and heals the other store.
   */
  public async init(): Promise<SavePayloadV1> {
    const rawLocal = this.readLocalStorage(SAVE_STORAGE_KEY);
    const rawIdb = await this.readIndexedDB();
    const local = rawLocal ? migrateLegacyEconomy(rawLocal) : null;
    const idb = rawIdb ? migrateLegacyEconomy(rawIdb) : null;

    if (local && idb) {
      if (idb.writeSeq > local.writeSeq) {
        this.payload = idb;
        this.writeLocalStorage(SAVE_STORAGE_KEY, idb);
      } else if (local.writeSeq > idb.writeSeq) {
        this.payload = local;
        await this.writeIndexedDB(local);
      } else {
        this.payload = local;
      }
    } else if (idb && !local) {
      this.payload = idb;
      this.writeLocalStorage(SAVE_STORAGE_KEY, idb);
    } else if (local && !idb) {
      this.payload = local;
      await this.writeIndexedDB(local);
    } else {
      this.writeLocalStorage(SAVE_STORAGE_KEY, this.payload);
      await this.writeIndexedDB(this.payload);
    }

    this.notifyListeners();
    return this.getPayload();
  }

  public getPayload(): SavePayloadV1 {
    return clonePayload(this.payload);
  }

  public onChange(listener: (payload: SavePayloadV1) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const snapshot = this.getPayload();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  public save(): SavePayloadV1 {
    this.payload.writeSeq = (this.payload.writeSeq || 0) + 1;
    this.payload.updatedAt = Date.now();
    this.writeLocalStorage(SAVE_STORAGE_KEY, this.payload);
    void this.writeIndexedDB(this.payload);
    this.notifyListeners();
    return this.getPayload();
  }

  public updateSettings(partial: Partial<SavePayloadV1['settings']>): SavePayloadV1 {
    this.payload.settings = {
      ...this.payload.settings,
      ...partial,
    };
    return this.save();
  }

  public setCurrentLevel(levelId: number, allowJump = false): SavePayloadV1 {
    const cleanId = Math.max(1, Math.floor(levelId));
    this.payload.currentLevelId = allowJump ? cleanId : Math.min(cleanId, this.payload.highestLevelUnlocked);
    return this.save();
  }

  /**
   * Economy v2 Level Clear & Reliquary Progression (`F-10`, `ECON-V2`):
   * - Challenge / Rush Clear (`1..3` Gold Stars): `15 / 25 / 40` base coins (`NORMAL / HARD / SUPER_HARD`; `20%` replay),
   *   `+5 Coins/★` improvement, Flow Streak bonus (`+5..+25`), Shredder Chest (`100` blocks -> `+50c + 1 Booster`),
   *   Milestone Chest (every `10` levels -> `+75c + 1 Booster`), and 25-Star Reliquary Chest (`+90c + 1 Booster`).
   * - Zen Clear (`0` Gold Stars): sets `zenCleared: true`, advances `highestLevelUnlocked`, pauses `winStreak`,
   *   and awards tranquil `+10` (`+2` replay) coins + Shredder Chest progress.
   */
  public recordLevelWin(
    levelId: number,
    moves: number,
    timeSec: number,
    blocksShredded: number,
    earnedStars?: 0 | 1 | 2 | 3,
    parMoves?: number,
    difficulty: 'NORMAL' | 'HARD' | 'SUPER_HARD' = 'NORMAL',
    zenClear = false
  ): LevelWinRewardSummary {
    const isZenRun = zenClear || earnedStars === 0;
    const stars: 0 | 1 | 2 | 3 = isZenRun
      ? 0
      : (earnedStars ??
        (parMoves
          ? moves <= Math.ceil(parMoves * 1.12)
            ? 3
            : moves <= Math.ceil(parMoves * 1.35)
              ? 2
              : 1
          : moves <= 10
            ? 3
            : moves <= 16
              ? 2
              : 1));

    const prevRecord = this.payload.levelRecords[levelId];
    const prevStars = prevRecord && !prevRecord.skipped ? prevRecord.stars : 0;
    const isFirstClear = isZenRun ? prevStars === 0 && !prevRecord?.zenCleared : prevStars === 0;
    const starsImproved = isZenRun ? 0 : Math.max(0, stars - prevStars);

    if (!isZenRun) {
      this.payload.winStreak = (this.payload.winStreak || 0) + 1;
      if (this.payload.winStreak > this.payload.bestWinStreak) {
        this.payload.bestWinStreak = this.payload.winStreak;
      }
    }

    const tierBase = difficulty === 'SUPER_HARD' ? 40 : difficulty === 'HARD' ? 25 : 15;
    const baseCoins = isZenRun
      ? isFirstClear
        ? 10
        : 2
      : isFirstClear
        ? tierBase
        : Math.max(3, Math.round(tierBase * 0.2));
    const starCoins = starsImproved * 5;
    const streakCoins = !isZenRun && isFirstClear ? Math.min(25, (this.payload.winStreak - 1) * 5) : 0;

    let chestCoins = 0;
    let shredderChestsOpened = 0;
    let milestoneChestOpened = false;
    let starReliquaryChestsOpened = 0;
    const rewardedBoosters: BoosterType[] = [];
    const effectiveMaxLevel = Math.max(levelId, this.payload.highestLevelUnlocked || 1);

    this.payload.totalBlocksShredded += Math.max(0, blocksShredded);
    this.payload.totalMovesCommitted += Math.max(0, moves);
    this.payload.shredderChestProgress += Math.max(0, blocksShredded);

    while (this.payload.shredderChestProgress >= 100) {
      this.payload.shredderChestProgress -= 100;
      shredderChestsOpened++;
      chestCoins += 50;
      const bType = pickRarityWeightedBooster(
        this.payload.totalBlocksShredded + shredderChestsOpened * 37,
        effectiveMaxLevel,
        false
      );
      this.payload.boosters[bType] = (this.payload.boosters[bType] || 0) + 1;
      rewardedBoosters.push(bType);
    }

    if (!isZenRun && isFirstClear && levelId % 10 === 0 && levelId > this.payload.milestoneChestLevel) {
      this.payload.milestoneChestLevel = levelId;
      milestoneChestOpened = true;
      chestCoins += 75;
      const bType = pickRarityWeightedBooster(levelId * 97, effectiveMaxLevel, true);
      this.payload.boosters[bType] = (this.payload.boosters[bType] || 0) + 1;
      rewardedBoosters.push(bType);
    }

    this.payload.totalStars += starsImproved;
    while (this.payload.totalStars >= (this.payload.starReliquaryLevel || 0) + 25) {
      this.payload.starReliquaryLevel = (this.payload.starReliquaryLevel || 0) + 25;
      starReliquaryChestsOpened++;
      chestCoins += 90;
      const bType = pickRarityWeightedBooster(this.payload.starReliquaryLevel * 131, effectiveMaxLevel, true);
      this.payload.boosters[bType] = (this.payload.boosters[bType] || 0) + 1;
      rewardedBoosters.push(bType);
    }

    const totalCoinsEarned = baseCoins + starCoins + streakCoins + chestCoins;
    this.payload.coins += totalCoinsEarned;

    const mergedStars = Math.max(prevStars, stars);
    const nextRecord: LevelRecord = {
      stars: mergedStars,
      bestMoves: prevRecord && prevRecord.bestMoves > 0 ? Math.min(prevRecord.bestMoves, moves) : moves,
      bestTimeSec:
        prevRecord && prevRecord.bestTimeSec > 0 ? Math.min(prevRecord.bestTimeSec, timeSec) : timeSec,
      skipped: false,
    };
    if (isZenRun && mergedStars === 0) {
      nextRecord.zenCleared = true;
    }
    this.payload.levelRecords[levelId] = nextRecord;

    if (levelId + 1 > this.payload.highestLevelUnlocked) {
      this.payload.highestLevelUnlocked = levelId + 1;
    }
    this.payload.currentLevelId = levelId + 1;

    this.save();

    return {
      isFirstClear,
      zenClear: isZenRun,
      starsEarned: stars,
      starsImproved,
      baseCoins,
      starCoins,
      streakCoins,
      chestCoins,
      totalCoinsEarned,
      shredderChestsOpened,
      milestoneChestOpened,
      starReliquaryChestsOpened,
      rewardedBoosters,
    };
  }

  public recordLevelLoss(): void {
    this.payload.winStreak = 0;
    this.save();
  }

  /**
   * Free Skip Level (`0` coins cost): unlocks `levelId + 1` with `stars: 0, skipped: true`
   * so no player is ever stuck on any puzzle.
   */
  public recordLevelSkip(levelId: number): SavePayloadV1 {
    const existing = this.payload.levelRecords[levelId];
    // Never overwrite a Zen clear: otherwise Zen clear -> Skip -> Zen clear re-farms first-clear coins & chests
    if (!existing || (existing.stars === 0 && !existing.zenCleared)) {
      this.payload.levelRecords[levelId] = {
        stars: 0,
        bestMoves: 0,
        bestTimeSec: 0,
        skipped: true,
      };
    }
    if (levelId + 1 > this.payload.highestLevelUnlocked) {
      this.payload.highestLevelUnlocked = levelId + 1;
    }
    this.payload.currentLevelId = levelId + 1;
    this.payload.winStreak = 0;
    return this.save();
  }

  public getBoosterCount(type: BoosterType): number {
    return this.payload.boosters[type] ?? 0;
  }

  public spendBooster(type: BoosterType): boolean {
    const count = this.getBoosterCount(type);
    if (count <= 0) return false;
    this.payload.boosters[type] = count - 1;
    this.save();
    return true;
  }

  public addBooster(type: BoosterType, amount = 1): void {
    this.payload.boosters[type] = Math.max(0, (this.payload.boosters[type] ?? 0) + amount);
    this.save();
  }

  public buyBoosterWithCoins(type: BoosterType, customCost?: number): boolean {
    const cost = customCost ?? BOOSTER_COIN_COSTS[type];
    if (this.payload.coins < cost) return false;
    this.payload.coins -= cost;
    this.payload.boosters[type] = (this.payload.boosters[type] ?? 0) + 1;
    this.save();
    return true;
  }

  public unlockOrEquipSkin(skinId: SkinId, costCoins = 200): boolean {
    if (!this.payload.unlockedSkins.includes(skinId)) {
      if (this.payload.coins < costCoins) return false;
      this.payload.coins -= costCoins;
      this.payload.unlockedSkins.push(skinId);
    }
    this.payload.equippedSkin = skinId;
    this.save();
    return true;
  }

  public unlockOrEquipTray(trayId: TrayId, costCoins = 200): boolean {
    if (!this.payload.unlockedTrays.includes(trayId)) {
      if (this.payload.coins < costCoins) return false;
      this.payload.coins -= costCoins;
      this.payload.unlockedTrays.push(trayId);
    }
    this.payload.equippedTray = trayId;
    this.save();
    return true;
  }

  public unlockOrEquipParticle(particleId: ParticleStyleId, costCoins = 200): boolean {
    if (!this.payload.unlockedParticles.includes(particleId)) {
      if (this.payload.coins < costCoins) return false;
      this.payload.coins -= costCoins;
      this.payload.unlockedParticles.push(particleId);
    }
    this.payload.equippedParticle = particleId;
    this.save();
    return true;
  }

  /**
   * Encodes the current save state as a compact `SB1-...` save code string.
   */
  public exportSaveCode(options?: { qrCompact?: boolean }): string {
    return encodeSaveCode(this.payload, options);
  }

  /**
   * Builds a shareable URL containing `#import=SB1-...` for QR codes and cross-device links.
   * Preserves local/LAN origins (`localhost`, `127.0.0.1`, `192.168.*`, `10.*`, `.local`) for
   * local & Wi-Fi testing, and uses canonical `https://shredblocks.skorupski.org/` in production.
   */
  public buildShareUrl(baseUrl?: string, qrCompact = false): string {
    let resolvedBase = baseUrl;
    if (!resolvedBase) {
      if (typeof window !== 'undefined' && window.location) {
        const host = window.location.hostname;
        const isLocalOrLan =
          host === 'localhost' ||
          host === '127.0.0.1' ||
          host === '[::1]' ||
          host.endsWith('.local') ||
          /^192\.168\.\d+\.\d+$/.test(host) ||
          /^10\.\d+\.\d+\.\d+$/.test(host) ||
          /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host);
        resolvedBase = isLocalOrLan
          ? `${window.location.origin}${window.location.pathname}`
          : 'https://shredblocks.skorupski.org/';
      } else {
        resolvedBase = 'https://shredblocks.skorupski.org/';
      }
    }
    const fullCode = this.exportSaveCode({ qrCompact });
    const code = !qrCompact && fullCode.length > 900 ? this.exportSaveCode({ qrCompact: true }) : fullCode;
    return `${resolvedBase}#import=${code}`;
  }

  /**
   * Imports a `SB1-...` save code after backing up the current save to
   * `localStorage['shredblocks.save.pre_import_backup']`.
   */
  public importSaveCode(code: string): SavePayloadV1 {
    const decoded = decodeSaveCode(code);
    return this.applyImportedPayload(decoded);
  }

  /**
   * Exports a human-readable `.json` backup string.
   */
  public exportSaveJson(): string {
    return JSON.stringify(this.payload, null, 2);
  }

  /**
   * Imports a `.json` backup string after backing up the current save to
   * `localStorage['shredblocks.save.pre_import_backup']`.
   */
  public importSaveJson(jsonText: string): SavePayloadV1 {
    const parsed = JSON.parse(jsonText) as unknown;
    const validated = validateSavePayloadV1(parsed);
    return this.applyImportedPayload(validated);
  }

  private applyImportedPayload(incoming: SavePayloadV1): SavePayloadV1 {
    // Save current state to Pre-Import Backup Slot before overwriting
    this.writeLocalStorage(PRE_IMPORT_BACKUP_KEY, this.payload);

    // Run forward-migration pipeline (`SAVE-COMPAT-01`, `ECON-V2`) so older v1 codes/JSON backups migrate cleanly
    const migrated = migrateLegacyEconomy(incoming);
    const nextSeq = Math.max(this.payload.writeSeq || 0, migrated.writeSeq || 0) + 1;
    this.payload = clonePayload({
      ...migrated,
      writeSeq: nextSeq,
      updatedAt: Date.now(),
    });

    this.writeLocalStorage(SAVE_STORAGE_KEY, this.payload);
    void this.writeIndexedDB(this.payload);
    this.notifyListeners();
    return this.getPayload();
  }

  public hasPreImportBackup(): boolean {
    return this.readLocalStorage(PRE_IMPORT_BACKUP_KEY) !== null;
  }

  /**
   * 1-tap Undo Import: restores `localStorage['shredblocks.save.pre_import_backup']`.
   */
  public restorePreImportBackup(): SavePayloadV1 | null {
    const backup = this.readLocalStorage(PRE_IMPORT_BACKUP_KEY);
    if (!backup) return null;

    const nextSeq = Math.max(this.payload.writeSeq || 0, backup.writeSeq || 0) + 1;
    this.payload = clonePayload({
      ...backup,
      writeSeq: nextSeq,
      updatedAt: Date.now(),
    });

    this.writeLocalStorage(SAVE_STORAGE_KEY, this.payload);
    void this.writeIndexedDB(this.payload);
    this.notifyListeners();
    return this.getPayload();
  }

  public downloadSaveJsonFile(filename = 'shredblocks-save-backup.json'): void {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
    const json = this.exportSaveJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private readLocalStorage(key: string): SavePayloadV1 | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      return validateSavePayloadV1(parsed);
    } catch {
      return null;
    }
  }

  private writeLocalStorage(key: string, data: SavePayloadV1): void {
    if (typeof localStorage === 'undefined') return;
    const serialized = JSON.stringify(data);
    try {
      localStorage.setItem(key, serialized);
    } catch {
      // If a massive Infinite Mode save + pre-import backup reaches the 5MB localStorage ceiling,
      // evict the pre-import backup slot so the active primary save snapshot never lags IndexedDB.
      if (key === SAVE_STORAGE_KEY) {
        try {
          localStorage.removeItem(PRE_IMPORT_BACKUP_KEY);
          localStorage.setItem(key, serialized);
        } catch {
          // IndexedDB remains the unbounded primary store
        }
      }
    }
  }

  private openIndexedDB(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
            db.createObjectStore(IDB_STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async readIndexedDB(): Promise<SavePayloadV1 | null> {
    const db = await this.openIndexedDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const getReq = store.get(IDB_PRIMARY_KEY);
        getReq.onsuccess = () => {
          db.close();
          try {
            if (!getReq.result) {
              resolve(null);
              return;
            }
            resolve(validateSavePayloadV1(getReq.result));
          } catch {
            resolve(null);
          }
        };
        getReq.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    });
  }

  private async writeIndexedDB(data: SavePayloadV1): Promise<void> {
    const db = await this.openIndexedDB();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        store.put(clonePayload(data), IDB_PRIMARY_KEY);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        db.close();
        resolve();
      }
    });
  }
}
