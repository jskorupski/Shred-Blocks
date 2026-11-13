import type { BoosterType, LevelRecord, ParticleStyleId, SavePayloadV1, SkinId, TrayId } from '../core/types';
import { decodeSaveCode, encodeSaveCode, validateSavePayloadV1 } from './save-code';
import {
  BOOSTER_COIN_COSTS,
  BOOSTER_RARITY,
  BOOSTER_UNLOCK_LEVEL,
  type BoosterRarity,
  CONTINUE_COIN_COST,
  extractImportCodeFromHash,
  isBoosterUnlocked,
  pickRarityWeightedBooster,
  THEME_TIER_PRICES,
} from './save-economy-tables';
import {
  applyZenOnlySkip,
  canSkipZenLevel,
  cloneModeState,
  countTrailingUnclearedStages,
  countUniqueClearedLevels,
  createDefaultModeState,
  evaluateModeLevelWin,
  getEffectiveBoosterUnlockLevel,
  isRecordGenuinelyCleared,
  migrateSavePayload,
  UNDER_PAR_ORACLE_COINS,
  ZEN_MAX_CONSECUTIVE_SKIPS,
} from './save-mode-ladders';

export {
  BOOSTER_COIN_COSTS,
  BOOSTER_RARITY,
  BOOSTER_UNLOCK_LEVEL,
  type BoosterRarity,
  CONTINUE_COIN_COST,
  canSkipZenLevel,
  countTrailingUnclearedStages,
  countUniqueClearedLevels,
  extractImportCodeFromHash,
  getEffectiveBoosterUnlockLevel,
  isBoosterUnlocked,
  isRecordGenuinelyCleared,
  pickRarityWeightedBooster,
  THEME_TIER_PRICES,
  UNDER_PAR_ORACLE_COINS,
  ZEN_MAX_CONSECUTIVE_SKIPS,
};

export const SAVE_STORAGE_KEY = 'shredblocks.save.v1';
export const PRE_IMPORT_BACKUP_KEY = 'shredblocks.save.pre_import_backup';
export const IDB_DB_NAME = 'ShredBlocksDB';
export const IDB_STORE_NAME = 'saves';
export const IDB_PRIMARY_KEY = 'primary';

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
  zenStarAwarded?: boolean;
  zenStarProgress?: number;
  zenBlessingAwarded?: boolean;
  zenBlessingsTotal?: number;
  zenBlessingProgress?: number;
  underPar?: boolean;
  firstUnderPar?: boolean;
  underParMovesSaved?: number;
  underParCoins?: number;
  underParBooster?: BoosterType | null;
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
    modeLadderVersion: 1,
    modeState: createDefaultModeState(),
    zenStarsEarned: 0,
    zenStarProgress: 0,
    zenBlessings: 0,
    zenBlessingProgress: 0,
    boosters: {
      UNDO: 3,
      HINT: 2,
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

function migrateEconomyStep(payload: SavePayloadV1): SavePayloadV1 {
  if ((payload.economyVersion ?? 1) >= 2) return payload;
  if (payload.settings.playMode === 'ZEN') {
    payload.settings.playMode = 'CHALLENGE';
  }
  if (payload.coins > 600) {
    payload.coins = Math.min(payload.coins, 600 + Math.round((payload.coins - 600) ** 0.72 * 3.5));
  }
  payload.starReliquaryLevel = Math.floor((payload.totalStars || 0) / 25) * 25;
  payload.economyVersion = 2;
  return payload;
}

/**
 * Forward-migration pipeline (`SAVE-COMPAT-01`, `ECON-V2`, `MAP-MODE-SPLIT-01`, `ZEN-STARS-01`):
 * - Upgrades Economy v1 -> v2 (`ZEN` -> `CHALLENGE`, soft-scales `> 600` coin balances, sets `starReliquaryLevel`)
 * - Upgrades `modeLadderVersion: 0 -> 1` (per-mode ladders, additive stars, Zen Stars & Zen Blessings)
 */
export function migrateLegacyEconomy(payload: SavePayloadV1): SavePayloadV1 {
  return migrateSavePayload(clonePayload(payload), migrateEconomyStep);
}

function clonePayload(payload: SavePayloadV1): SavePayloadV1 {
  const records: Record<number, LevelRecord> = {};
  for (const [k, v] of Object.entries(payload.levelRecords)) {
    records[Number(k)] = { ...v };
  }
  return {
    ...payload,
    modeState: cloneModeState(payload.modeState),
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
    const prevMode = this.payload.settings.playMode;
    this.payload.settings = {
      ...this.payload.settings,
      ...partial,
    };
    const nextMode = this.payload.settings.playMode;
    if (nextMode !== prevMode) {
      this.payload.currentLevelId = this.payload.modeState[nextMode].currentLevelId;
    }
    return this.save();
  }

  public setCurrentLevel(levelId: number, allowJump = false): SavePayloadV1 {
    const cleanId = Math.max(1, Math.floor(levelId));
    const ladder = this.payload.modeState[this.payload.settings.playMode];
    const nextId = allowJump ? cleanId : Math.min(cleanId, ladder.highestUnlocked);
    ladder.currentLevelId = nextId;
    this.payload.currentLevelId = nextId;
    return this.save();
  }

  /**
   * Economy v2, Per-Mode Progression & Under-Par Oracle Bounty (`ECON-V2`, `MAP-MODE-SPLIT-01`, `UNDER-PAR-ORACLE-01`):
   * - Challenge / Rush Clear (`1..3` Gold Stars per mode): `15/25/40` base (`20%` replay), `+5c/★`, Flow Streak (`+5..+25`),
   *   Shredder (`100` -> `+50c + Booster`), Milestone (`10` unique -> `+75c + Booster`), Reliquary (`25★` -> `+90c + Booster`),
   *   and first-time pure Under-Par Bounty (`+50c + 1 Uncommon+ Booster` once per stage when `moves < parMoves` booster-free).
   * - Zen Clear: `+10c` (`+2c` replay), `+1★ / 3` unique clears, `+1 🌿 / 4` unique clears (cap `3`), and shared chests.
   */
  public recordLevelWin(
    levelId: number,
    moves: number,
    timeSec: number,
    blocksShredded: number,
    earnedStars?: 0 | 1 | 2 | 3,
    parMoves?: number,
    difficulty: 'NORMAL' | 'HARD' | 'SUPER_HARD' = 'NORMAL',
    zenClear = false,
    pureBoosterFreeRun = false
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

    const prevUniqueClears = countUniqueClearedLevels(this.payload);
    const wasStageAlreadyCleared = isRecordGenuinelyCleared(this.payload.levelRecords[levelId]);
    const evalWin = evaluateModeLevelWin(
      this.payload,
      levelId,
      moves,
      timeSec,
      stars,
      isZenRun,
      pureBoosterFreeRun,
      parMoves
    );
    const { isFirstClear, starsImproved, zenStarAwarded, zenBlessingAwarded } = evalWin;

    // STREAK-INTEGRITY-01: Only genuine first-clears in Challenge / Speed Rush advance Flow Streak
    if (!isZenRun && isFirstClear) {
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
    const nextUniqueClears = wasStageAlreadyCleared ? prevUniqueClears : prevUniqueClears + 1;
    const effectiveBoosterLevel = Math.max(
      getEffectiveBoosterUnlockLevel(this.payload, isZenRun ? 1 : levelId),
      nextUniqueClears + 1
    );

    this.payload.totalBlocksShredded += Math.max(0, blocksShredded);
    this.payload.totalMovesCommitted += Math.max(0, moves);
    this.payload.shredderChestProgress += Math.max(0, blocksShredded);

    while (this.payload.shredderChestProgress >= 100) {
      this.payload.shredderChestProgress -= 100;
      shredderChestsOpened++;
      chestCoins += 50;
      const bType = pickRarityWeightedBooster(
        this.payload.totalBlocksShredded + shredderChestsOpened * 37,
        effectiveBoosterLevel,
        false
      );
      this.payload.boosters[bType] = (this.payload.boosters[bType] || 0) + 1;
      rewardedBoosters.push(bType);
    }

    // ZEN-SKIP-GUARD-01: Milestone Chest opens strictly every 10 unique non-skipped stage clears
    const prevBucket = Math.floor(prevUniqueClears / 10) * 10;
    const nextBucket = Math.floor(nextUniqueClears / 10) * 10;
    if (prevBucket < nextBucket && nextBucket > (this.payload.milestoneChestLevel || 0)) {
      this.payload.milestoneChestLevel = nextBucket;
      milestoneChestOpened = true;
      chestCoins += 75;
      const chestLvl =
        nextBucket === 10 || nextBucket === 20 || nextBucket === 30
          ? nextBucket
          : Math.max(nextBucket, effectiveBoosterLevel);
      const bType = pickRarityWeightedBooster(nextBucket * 97, chestLvl, true);
      this.payload.boosters[bType] = (this.payload.boosters[bType] || 0) + 1;
      rewardedBoosters.push(bType);
    }

    this.payload.totalStars += starsImproved;
    while (this.payload.totalStars >= (this.payload.starReliquaryLevel || 0) + 25) {
      this.payload.starReliquaryLevel = (this.payload.starReliquaryLevel || 0) + 25;
      starReliquaryChestsOpened++;
      chestCoins += 90;
      const bType = pickRarityWeightedBooster(
        this.payload.starReliquaryLevel * 131,
        effectiveBoosterLevel,
        true
      );
      this.payload.boosters[bType] = (this.payload.boosters[bType] || 0) + 1;
      rewardedBoosters.push(bType);
    }

    let underParCoins = 0;
    let underParBooster: BoosterType | null = null;
    if (evalWin.firstUnderPar) {
      underParCoins = UNDER_PAR_ORACLE_COINS;
      underParBooster = pickRarityWeightedBooster(levelId * 313 + moves, effectiveBoosterLevel, true);
      this.payload.boosters[underParBooster] = (this.payload.boosters[underParBooster] || 0) + 1;
      rewardedBoosters.push(underParBooster);
    }

    const totalCoinsEarned = baseCoins + starCoins + streakCoins + chestCoins + underParCoins;
    this.payload.coins += totalCoinsEarned;

    evalWin.commitRecordAndLadders();
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
      zenStarAwarded,
      zenStarProgress: this.payload.zenStarProgress,
      zenBlessingAwarded,
      zenBlessingsTotal: this.payload.zenBlessings,
      zenBlessingProgress: this.payload.zenBlessingProgress,
      underPar: evalWin.underPar,
      firstUnderPar: evalWin.firstUnderPar,
      underParMovesSaved: evalWin.underParMovesSaved,
      underParCoins,
      underParBooster,
    };
  }

  public recordLevelLoss(): void {
    this.payload.winStreak = 0;
    this.save();
  }

  /**
   * Zen-Only Free Skip Level (`0` coins cost): unlocks `levelId + 1` in `modeState.ZEN` with `zenSkipped: true`.
   * Strict no-op when `playMode !== 'ZEN'`.
   */
  public recordLevelSkip(levelId: number): SavePayloadV1 {
    if (!applyZenOnlySkip(this.payload, levelId)) {
      return this.getPayload();
    }
    return this.save();
  }

  public consumeZenBlessing(): boolean {
    if ((this.payload.zenBlessings || 0) <= 0) return false;
    this.payload.zenBlessings -= 1;
    this.save();
    return true;
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

    const migrated = migrateLegacyEconomy(backup);
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
