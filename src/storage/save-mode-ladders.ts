import type { LevelRecord, ModeLadderState, ModeStateMap, PlayMode, SavePayloadV1 } from '../core/types';

export const PLAY_MODES: ReadonlyArray<PlayMode> = ['CHALLENGE', 'ZEN', 'TIMED'];
const MAX_MODE_LEVEL = 999_999;

export const MODE_SPLIT_TRAILER_MAGIC_0 = 0xa6;
export const MODE_SPLIT_TRAILER_MAGIC_1 = 0x4d; // 'M' — distinguishes mode-split trailer from synthetic test trailers
export const UNDER_PAR_TRAILER_MAGIC_0 = 0xa7;
export const UNDER_PAR_TRAILER_MAGIC_1 = 0x55; // 'U' — optional sparse Under-Par Oracle trailer (`UNDER-PAR-ORACLE-01`)
export const UNDER_PAR_ORACLE_COINS = 50;

export function createDefaultModeState(): ModeStateMap {
  return {
    CHALLENGE: { currentLevelId: 1, highestUnlocked: 1 },
    ZEN: { currentLevelId: 1, highestUnlocked: 1 },
    TIMED: { currentLevelId: 1, highestUnlocked: 1 },
  };
}

export function cloneModeState(ms: ModeStateMap): ModeStateMap {
  return {
    CHALLENGE: { ...ms.CHALLENGE },
    ZEN: { ...ms.ZEN },
    TIMED: { ...ms.TIMED },
  };
}

function clampLadderNum(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(MAX_MODE_LEVEL, Math.max(1, Math.floor(v)));
}

function sanitizeSingleLadder(raw: unknown): ModeLadderState {
  if (!raw || typeof raw !== 'object') {
    return { currentLevelId: 1, highestUnlocked: 1 };
  }
  const obj = raw as Partial<Record<string, unknown>>;
  const highestUnlocked = clampLadderNum(obj.highestUnlocked, 1);
  const currentLevelId = clampLadderNum(obj.currentLevelId, highestUnlocked);
  return { currentLevelId, highestUnlocked };
}

export function sanitizeModeState(raw: unknown): ModeStateMap {
  if (!raw || typeof raw !== 'object') {
    return createDefaultModeState();
  }
  const obj = raw as Partial<Record<PlayMode, unknown>>;
  return {
    CHALLENGE: sanitizeSingleLadder(obj.CHALLENGE),
    ZEN: sanitizeSingleLadder(obj.ZEN),
    TIMED: sanitizeSingleLadder(obj.TIMED),
  };
}

export function computeGlobalHighestUnlocked(modeState: ModeStateMap, currentHighest = 1): number {
  return Math.max(
    1,
    Math.floor(currentHighest || 1),
    modeState.CHALLENGE.highestUnlocked,
    modeState.ZEN.highestUnlocked,
    modeState.TIMED.highestUnlocked
  );
}

/**
 * Reconciles top-level `highestLevelUnlocked` / `currentLevelId` edits (e.g. imported JSON backups or
 * debug patches that bumped the envelope without editing `modeState`) into the active mode's ladder,
 * without ever cross-contaminating inactive mode ladders during normal multi-mode play.
 */
export function reconcileModeStateWithEnvelope(payload: SavePayloadV1): void {
  const activeMode = payload.settings.playMode;
  const maxLadder = Math.max(
    payload.modeState.CHALLENGE.highestUnlocked,
    payload.modeState.ZEN.highestUnlocked,
    payload.modeState.TIMED.highestUnlocked
  );
  if (payload.highestLevelUnlocked > maxLadder) {
    payload.modeState[activeMode].highestUnlocked = payload.highestLevelUnlocked;
    if (
      payload.currentLevelId >= 1 &&
      payload.currentLevelId <= payload.highestLevelUnlocked &&
      payload.modeState[activeMode].currentLevelId < payload.currentLevelId
    ) {
      payload.modeState[activeMode].currentLevelId = payload.currentLevelId;
    }
  } else if (
    payload.currentLevelId > 1 &&
    payload.modeState[activeMode].currentLevelId === 1 &&
    payload.currentLevelId <= payload.modeState[activeMode].highestUnlocked
  ) {
    payload.modeState[activeMode].currentLevelId = payload.currentLevelId;
  }
  payload.highestLevelUnlocked = computeGlobalHighestUnlocked(
    payload.modeState,
    payload.highestLevelUnlocked
  );
}

/**
 * Sequential forward migration (`SAVE-COMPAT-01`, `ECON-V2`, `MAP-MODE-SPLIT-01`, `ZEN-STARS-01`):
 * 1. Runs Economy v1 -> v2 migration (`migrateEconomyStep`), capturing pre-migration `playMode` & `economyVersion`.
 * 2. Upgrades `modeLadderVersion: 0 -> 1` once, attributing existing stars/records to the appropriate
 *    mode ladder without losing any unlocked stage, seeding Zen Stars (`1 ★ / 3 clears`) and Zen Blessings
 *    (`1 / 4 clears`, cap `3`), and ensuring `totalStars` is monotonically non-decreasing.
 * 3. For `modeLadderVersion >= 1` saves, reconciles envelope `highestLevelUnlocked` edits cleanly.
 */
export function migrateSavePayload(
  payload: SavePayloadV1,
  migrateEconomyStep: (p: SavePayloadV1) => SavePayloadV1
): SavePayloadV1 {
  const originalPlayMode = payload.settings.playMode;
  const wasLegacyV1 = (payload.economyVersion ?? 1) < 2;
  const migrated = migrateEconomyStep(payload);

  if ((migrated.modeLadderVersion ?? 0) >= 1) {
    reconcileModeStateWithEnvelope(migrated);
    return migrated;
  }

  let maxChallengeCleared = 0;
  let maxTimedCleared = 0;
  let maxZenTouched = 0;
  let uniqueZenClears = 0;
  let sumChallengeStars = 0;
  let sumTimedStars = 0;

  const starTargetMode: 'CHALLENGE' | 'TIMED' =
    !wasLegacyV1 && originalPlayMode === 'TIMED' ? 'TIMED' : 'CHALLENGE';

  for (const [key, rec] of Object.entries(migrated.levelRecords)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 1) continue;

    if (rec.stars > 0 && !rec.skipped) {
      if (starTargetMode === 'TIMED') {
        rec.timedStars = Math.max(rec.timedStars ?? 0, rec.stars);
        if (rec.bestTimeSec > 0) {
          rec.timedBestTimeSec = rec.bestTimeSec;
        }
        maxTimedCleared = Math.max(maxTimedCleared, id);
      } else {
        rec.challengeStars = Math.max(rec.challengeStars ?? 0, rec.stars);
        if (rec.bestMoves > 0) {
          rec.challengeBestMoves = rec.bestMoves;
        }
        maxChallengeCleared = Math.max(maxChallengeCleared, id);
      }
    }

    if (rec.skipped) {
      rec.zenSkipped = true;
      maxZenTouched = Math.max(maxZenTouched, id);
    }

    if (rec.zenCleared) {
      uniqueZenClears++;
      if (rec.bestMoves > 0 && rec.zenBestMoves === undefined) {
        rec.zenBestMoves = rec.bestMoves;
      }
      maxZenTouched = Math.max(maxZenTouched, id);
    }

    sumChallengeStars += rec.challengeStars ?? 0;
    sumTimedStars += rec.timedStars ?? 0;
  }

  const activeMode = migrated.settings.playMode;
  const envelopeHighest = Math.max(1, migrated.highestLevelUnlocked || 1);
  const envelopeCurrent = Math.min(envelopeHighest, Math.max(1, migrated.currentLevelId || envelopeHighest));

  const chHighest =
    activeMode === 'CHALLENGE'
      ? Math.max(envelopeHighest, maxChallengeCleared + 1)
      : Math.max(1, maxChallengeCleared + 1);
  const zenHighest =
    !wasLegacyV1 && activeMode === 'ZEN'
      ? Math.max(envelopeHighest, maxZenTouched + 1)
      : Math.max(1, maxZenTouched + 1);
  const tmHighest =
    activeMode === 'TIMED'
      ? Math.max(envelopeHighest, maxTimedCleared + 1)
      : Math.max(1, maxTimedCleared + 1);

  migrated.modeState = {
    CHALLENGE: {
      highestUnlocked: chHighest,
      currentLevelId: activeMode === 'CHALLENGE' ? Math.min(chHighest, envelopeCurrent) : chHighest,
    },
    ZEN: {
      highestUnlocked: zenHighest,
      currentLevelId:
        !wasLegacyV1 && activeMode === 'ZEN' ? Math.min(zenHighest, envelopeCurrent) : zenHighest,
    },
    TIMED: {
      highestUnlocked: tmHighest,
      currentLevelId: activeMode === 'TIMED' ? Math.min(tmHighest, envelopeCurrent) : tmHighest,
    },
  };

  const zenStarsEarned = Math.floor(uniqueZenClears / 3);
  migrated.zenStarsEarned = zenStarsEarned;
  migrated.zenStarProgress = uniqueZenClears % 3;
  migrated.zenBlessings = Math.min(3, Math.floor(uniqueZenClears / 4));
  migrated.zenBlessingProgress = uniqueZenClears % 4;
  migrated.totalStars = Math.max(
    (migrated.totalStars || 0) + zenStarsEarned,
    sumChallengeStars + sumTimedStars + zenStarsEarned
  );
  migrated.highestLevelUnlocked = computeGlobalHighestUnlocked(migrated.modeState, envelopeHighest);
  migrated.currentLevelId = migrated.modeState[activeMode].currentLevelId;
  migrated.modeLadderVersion = 1;

  return migrated;
}

function encOptStar(v: number | undefined): number {
  return v === undefined ? 0 : (Math.min(3, Math.max(0, Math.floor(v))) + 1) & 7;
}

function decOptStar(code: number): number | undefined {
  return code >= 1 && code <= 4 ? code - 1 : undefined;
}

function encOptBool(v: boolean | undefined): number {
  return v === undefined ? 0 : v ? 2 : 1;
}

function decOptBool(code: number): boolean | undefined {
  return code === 2 ? true : code === 1 ? false : undefined;
}

/**
 * Appends the `[0xa6, 0x4d]` Mode-Split binary trailer after the `0xa5` Economy v2 trailer.
 * When `modeLadderVersion < 1` (unmigrated v1 snapshot), nothing is emitted so v1 byte streams round-trip verbatim.
 */
export function packModeSplitTrailer(
  out: number[],
  payload: SavePayloadV1,
  ids: ReadonlyArray<number>,
  telemetryCutoffIdx: number,
  writeVarint: (out: number[], value: number) => void
): void {
  if ((payload.modeLadderVersion ?? 0) < 1) return;

  out.push(MODE_SPLIT_TRAILER_MAGIC_0, MODE_SPLIT_TRAILER_MAGIC_1);
  writeVarint(out, payload.modeLadderVersion);

  let activeLaddersMask = 0;
  for (let m = 0; m < PLAY_MODES.length; m++) {
    const ladder = payload.modeState[PLAY_MODES[m]];
    if (ladder.highestUnlocked !== 1 || ladder.currentLevelId !== 1) {
      activeLaddersMask |= 1 << m;
    }
  }
  out.push(activeLaddersMask);
  for (let m = 0; m < PLAY_MODES.length; m++) {
    if ((activeLaddersMask & (1 << m)) === 0) continue;
    const ladder = payload.modeState[PLAY_MODES[m]];
    writeVarint(out, ladder.highestUnlocked);
    const diff = ladder.highestUnlocked - ladder.currentLevelId;
    writeVarint(out, diff >= 0 ? diff * 2 : -diff * 2 - 1);
  }

  writeVarint(out, payload.zenStarsEarned || 0);
  const packedZenMeta =
    ((payload.zenStarProgress || 0) & 3) |
    (((payload.zenBlessings || 0) & 3) << 2) |
    (((payload.zenBlessingProgress || 0) & 3) << 4);
  out.push(packedZenMeta);

  // 1 lossless byte per record when any record carries explicit per-mode stars/skip state:
  // bits 0..2 = challengeStars, bits 3..5 = timedStars, bits 6..7 = zenSkipped
  const packedRecBytes: number[] = [];
  let hasAnyPerModeRec = false;
  for (let i = 0; i < ids.length; i++) {
    const rec = payload.levelRecords[ids[i]];
    const packedRec =
      encOptStar(rec?.challengeStars) |
      (encOptStar(rec?.timedStars) << 3) |
      (encOptBool(rec?.zenSkipped) << 6);
    packedRecBytes.push(packedRec);
    if (packedRec !== 0) hasAnyPerModeRec = true;
  }
  out.push(hasAnyPerModeRec ? 1 : 0);
  if (hasAnyPerModeRec) {
    for (let i = 0; i < packedRecBytes.length; i++) {
      out.push(packedRecBytes[i]);
    }
  }

  // Sparse per-mode bestMoves / bestTimeSec overrides within the active telemetry window
  const overrides: Array<{ idx: number; rec: LevelRecord; mask: number }> = [];
  for (let i = telemetryCutoffIdx; i < ids.length; i++) {
    const rec = payload.levelRecords[ids[i]];
    if (!rec) continue;
    const mask =
      (rec.challengeBestMoves !== undefined ? 1 : 0) |
      (rec.timedBestTimeSec !== undefined ? 2 : 0) |
      (rec.zenBestMoves !== undefined ? 4 : 0);
    if (mask !== 0) {
      overrides.push({ idx: i, rec, mask });
    }
  }

  writeVarint(out, overrides.length);
  let prevIdx = telemetryCutoffIdx;
  for (const item of overrides) {
    writeVarint(out, item.idx - prevIdx);
    prevIdx = item.idx;
    out.push(item.mask);
    if ((item.mask & 1) !== 0) {
      writeVarint(out, Math.max(0, Math.round(item.rec.challengeBestMoves ?? 0)));
    }
    if ((item.mask & 2) !== 0) {
      const t = Math.max(0, item.rec.timedBestTimeSec ?? 0);
      const tenths = Math.round(t * 10);
      const encodedTime = tenths % 10 === 0 ? Math.round(t) * 2 : tenths * 2 + 1;
      writeVarint(out, encodedTime);
    }
    if ((item.mask & 4) !== 0) {
      writeVarint(out, Math.max(0, Math.round(item.rec.zenBestMoves ?? 0)));
    }
  }

  // Optional `[0xa7, 0x55]` ('U') Under-Par Oracle trailer (`UNDER-PAR-ORACLE-01`):
  // Omitted when zero stages have `underParCleared` so existing save streams stay byte-identical.
  const underParIds: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (payload.levelRecords[ids[i]]?.underParCleared) {
      underParIds.push(ids[i]);
    }
  }
  if (underParIds.length > 0) {
    out.push(UNDER_PAR_TRAILER_MAGIC_0, UNDER_PAR_TRAILER_MAGIC_1);
    writeVarint(out, underParIds.length);
    let prevUpId = 0;
    for (const id of underParIds) {
      writeVarint(out, id - prevUpId);
      prevUpId = id;
    }
  }
}

export interface UnpackedModeSplitFields {
  modeLadderVersion: number;
  modeState: ModeStateMap;
  zenStarsEarned: number;
  zenStarProgress: number;
  zenBlessings: number;
  zenBlessingProgress: number;
}

export function unpackModeSplitTrailer(
  rawBytes: Uint8Array,
  getPos: () => number,
  advancePos: (delta: number) => void,
  readByte: () => number,
  readVarint: () => number,
  ids: ReadonlyArray<number>,
  telemetryCutoffIdx: number,
  levelRecords: Record<number, LevelRecord>,
  onCorrupt: (msg: string) => never
): UnpackedModeSplitFields {
  const startPos = getPos();
  if (
    startPos + 1 >= rawBytes.length ||
    rawBytes[startPos] !== MODE_SPLIT_TRAILER_MAGIC_0 ||
    rawBytes[startPos + 1] !== MODE_SPLIT_TRAILER_MAGIC_1
  ) {
    return {
      modeLadderVersion: 0,
      modeState: createDefaultModeState(),
      zenStarsEarned: 0,
      zenStarProgress: 0,
      zenBlessings: 0,
      zenBlessingProgress: 0,
    };
  }

  advancePos(2);
  const modeLadderVersion = readVarint();
  const modeState = createDefaultModeState();
  const activeLaddersMask = readByte();
  if (activeLaddersMask > 7) {
    onCorrupt('Invalid mode-split ladder presence mask.');
  }
  for (let m = 0; m < PLAY_MODES.length; m++) {
    if ((activeLaddersMask & (1 << m)) === 0) continue;
    const highestUnlocked = readVarint();
    const zz = readVarint();
    const diff = zz % 2 === 0 ? zz / 2 : -((zz + 1) / 2);
    const currentLevelId = highestUnlocked - diff;
    if (currentLevelId < 1) {
      onCorrupt('Invalid mode-split currentLevelId delta.');
    }
    modeState[PLAY_MODES[m]] = { highestUnlocked, currentLevelId };
  }

  const zenStarsEarned = readVarint();
  const packedZenMeta = readByte();
  const zenStarProgress = packedZenMeta & 3;
  const zenBlessings = (packedZenMeta >>> 2) & 3;
  const zenBlessingProgress = (packedZenMeta >>> 4) & 3;

  const hasAnyPerModeRec = readByte();
  if (hasAnyPerModeRec > 1) {
    onCorrupt('Invalid mode-split per-record presence flag.');
  }
  if (hasAnyPerModeRec === 1) {
    for (let i = 0; i < ids.length; i++) {
      const packedRec = readByte();
      const rec = levelRecords[ids[i]];
      if (!rec) continue;
      const chStars = decOptStar(packedRec & 7);
      const tmStars = decOptStar((packedRec >>> 3) & 7);
      const zSkip = decOptBool((packedRec >>> 6) & 3);
      if (chStars !== undefined) rec.challengeStars = chStars;
      if (tmStars !== undefined) rec.timedStars = tmStars;
      if (zSkip !== undefined) rec.zenSkipped = zSkip;
    }
  }

  const overrideCount = readVarint();
  if (overrideCount > ids.length) {
    onCorrupt('Mode-split telemetry override count exceeds record count.');
  }
  let idx = telemetryCutoffIdx;
  for (let k = 0; k < overrideCount; k++) {
    const delta = readVarint();
    if (k > 0 && delta < 1) {
      onCorrupt('Non-monotonic mode-split telemetry override delta.');
    }
    idx += delta;
    if (idx < 0 || idx >= ids.length) {
      onCorrupt('Mode-split telemetry override index out of bounds.');
    }
    const mask = readByte();
    const rec = levelRecords[ids[idx]];
    const chMoves = (mask & 1) !== 0 ? readVarint() : undefined;
    const rawT = (mask & 2) !== 0 ? readVarint() : undefined;
    const zMoves = (mask & 4) !== 0 ? readVarint() : undefined;
    if (rec) {
      if (chMoves !== undefined) rec.challengeBestMoves = chMoves;
      if (rawT !== undefined) {
        rec.timedBestTimeSec = rawT % 2 === 1 ? Math.floor(rawT / 2) / 10 : Math.floor(rawT / 2);
      }
      if (zMoves !== undefined) rec.zenBestMoves = zMoves;
    }
  }

  const upPos = getPos();
  if (
    upPos + 1 < rawBytes.length &&
    rawBytes[upPos] === UNDER_PAR_TRAILER_MAGIC_0 &&
    rawBytes[upPos + 1] === UNDER_PAR_TRAILER_MAGIC_1
  ) {
    advancePos(2);
    const upCount = readVarint();
    if (upCount > ids.length) {
      onCorrupt('Under-par trailer count exceeds record count.');
    }
    let prevUpId = 0;
    for (let i = 0; i < upCount; i++) {
      const delta = readVarint();
      if (delta < 1 || prevUpId + delta > MAX_MODE_LEVEL) {
        onCorrupt('Invalid under-par trailer ID delta.');
      }
      prevUpId += delta;
      if (levelRecords[prevUpId]) {
        levelRecords[prevUpId].underParCleared = true;
      }
    }
  }

  return {
    modeLadderVersion,
    modeState,
    zenStarsEarned,
    zenStarProgress,
    zenBlessings,
    zenBlessingProgress,
  };
}

export interface ModeWinEvaluation {
  targetMode: PlayMode;
  isFirstClear: boolean;
  starsImproved: number;
  zenStarAwarded: boolean;
  zenBlessingAwarded: boolean;
  underPar: boolean;
  firstUnderPar: boolean;
  underParMovesSaved: number;
  commitRecordAndLadders: () => void;
}

/**
 * Evaluates per-mode first-clear status, additive per-mode star improvements (`Challenge` + `Timed` + `Zen`),
 * Zen Stars (`1 ★ / 3 unique clears`, `ZEN-STARS-01`), Zen Blessings (`1 / 4 unique clears`, cap `3`),
 * and pure booster-free Under-Par Oracle feats (`UNDER-PAR-ORACLE-01`).
 */
export function evaluateModeLevelWin(
  payload: SavePayloadV1,
  levelId: number,
  moves: number,
  timeSec: number,
  stars: 0 | 1 | 2 | 3,
  isZenRun: boolean,
  pureUnderParEligible = false,
  parMoves?: number
): ModeWinEvaluation {
  const targetMode: PlayMode = isZenRun
    ? 'ZEN'
    : payload.settings.playMode === 'TIMED'
      ? 'TIMED'
      : 'CHALLENGE';
  const prev = payload.levelRecords[levelId];

  const prevChallengeStars =
    prev?.challengeStars ?? (!prev?.skipped && prev?.timedStars === undefined ? (prev?.stars ?? 0) : 0);
  const prevTimedStars = prev?.timedStars ?? 0;
  const wasZenCleared = prev?.zenCleared === true;

  let isFirstClear = false;
  let starsImproved = 0;
  let zenStarAwarded = false;
  let zenBlessingAwarded = false;

  if (isZenRun) {
    isFirstClear = !wasZenCleared;
    if (isFirstClear) {
      const nextStarProg = (payload.zenStarProgress || 0) + 1;
      if (nextStarProg >= 3) {
        payload.zenStarProgress = nextStarProg - 3;
        payload.zenStarsEarned = (payload.zenStarsEarned || 0) + 1;
        zenStarAwarded = true;
        starsImproved = 1;
      } else {
        payload.zenStarProgress = nextStarProg;
      }

      const nextBlessProg = (payload.zenBlessingProgress || 0) + 1;
      if (nextBlessProg >= 4) {
        payload.zenBlessingProgress = nextBlessProg - 4;
        if ((payload.zenBlessings || 0) < 3) {
          payload.zenBlessings = (payload.zenBlessings || 0) + 1;
          zenBlessingAwarded = true;
        }
      } else {
        payload.zenBlessingProgress = nextBlessProg;
      }
    }
  } else if (targetMode === 'TIMED') {
    isFirstClear = prevTimedStars === 0;
    starsImproved = Math.max(0, stars - prevTimedStars);
  } else {
    isFirstClear = prevChallengeStars === 0;
    starsImproved = Math.max(0, stars - prevChallengeStars);
  }

  const underParMovesSaved =
    !isZenRun &&
    pureUnderParEligible &&
    stars === 3 &&
    parMoves !== undefined &&
    parMoves > 1 &&
    moves > 0 &&
    moves < parMoves
      ? parMoves - moves
      : 0;
  const underPar = underParMovesSaved > 0;
  const firstUnderPar = underPar && !prev?.underParCleared;

  return {
    targetMode,
    isFirstClear,
    starsImproved,
    zenStarAwarded,
    zenBlessingAwarded,
    underPar,
    firstUnderPar,
    underParMovesSaved,
    commitRecordAndLadders: () => {
      const nextChallengeStars =
        targetMode === 'CHALLENGE' ? Math.max(prevChallengeStars, stars) : prev?.challengeStars;
      const nextTimedStars = targetMode === 'TIMED' ? Math.max(prevTimedStars, stars) : prev?.timedStars;
      const mergedStars = Math.max(
        prev && !prev.skipped ? prev.stars : 0,
        nextChallengeStars ?? 0,
        nextTimedStars ?? 0,
        stars
      );

      const nextRecord: LevelRecord = {
        stars: mergedStars,
        bestMoves: prev && prev.bestMoves > 0 ? Math.min(prev.bestMoves, moves) : moves,
        bestTimeSec: prev && prev.bestTimeSec > 0 ? Math.min(prev.bestTimeSec, timeSec) : timeSec,
        skipped: false,
      };
      if (nextChallengeStars !== undefined) nextRecord.challengeStars = nextChallengeStars;
      if (targetMode === 'CHALLENGE') {
        nextRecord.challengeBestMoves =
          prev?.challengeBestMoves && prev.challengeBestMoves > 0
            ? Math.min(prev.challengeBestMoves, moves)
            : moves;
      } else if (prev?.challengeBestMoves !== undefined) {
        nextRecord.challengeBestMoves = prev.challengeBestMoves;
      }

      if (nextTimedStars !== undefined) nextRecord.timedStars = nextTimedStars;
      if (targetMode === 'TIMED') {
        nextRecord.timedBestTimeSec =
          prev?.timedBestTimeSec && prev.timedBestTimeSec > 0
            ? Math.min(prev.timedBestTimeSec, timeSec)
            : timeSec;
      } else if (prev?.timedBestTimeSec !== undefined) {
        nextRecord.timedBestTimeSec = prev.timedBestTimeSec;
      }

      if (isZenRun || wasZenCleared) {
        nextRecord.zenCleared = true;
      }
      if (isZenRun) {
        nextRecord.zenBestMoves =
          prev?.zenBestMoves && prev.zenBestMoves > 0 ? Math.min(prev.zenBestMoves, moves) : moves;
      } else {
        if (prev?.zenBestMoves !== undefined) nextRecord.zenBestMoves = prev.zenBestMoves;
        if (prev?.zenSkipped) nextRecord.zenSkipped = true;
      }
      if (underPar || prev?.underParCleared) {
        nextRecord.underParCleared = true;
      }

      payload.levelRecords[levelId] = nextRecord;

      const ladder = payload.modeState[targetMode];
      if (levelId + 1 > ladder.highestUnlocked) {
        ladder.highestUnlocked = levelId + 1;
      }
      ladder.currentLevelId = Math.min(
        ladder.highestUnlocked,
        Math.max(ladder.currentLevelId || 1, levelId + 1)
      );
      if (payload.settings.playMode === targetMode) {
        payload.currentLevelId = ladder.currentLevelId;
      }
      payload.highestLevelUnlocked = computeGlobalHighestUnlocked(
        payload.modeState,
        payload.highestLevelUnlocked
      );
    },
  };
}

export const ZEN_MAX_CONSECUTIVE_SKIPS = 3;

/**
 * Returns `true` iff `rec` represents a genuine non-skipped clear in at least one mode (`ZEN-SKIP-GUARD-01`).
 */
export function isRecordGenuinelyCleared(rec: LevelRecord | undefined): boolean {
  if (!rec) return false;
  return (
    (rec.challengeStars ?? 0) > 0 ||
    (rec.timedStars ?? 0) > 0 ||
    rec.zenCleared === true ||
    (!rec.skipped && (rec.stars ?? 0) > 0)
  );
}

/**
 * Counts unique stage IDs genuinely cleared (non-skipped) across Challenge, Zen, and Speed Rush.
 */
export function countUniqueClearedLevels(payload: SavePayloadV1): number {
  let count = 0;
  for (const [key, rec] of Object.entries(payload.levelRecords)) {
    const id = Number(key);
    if (Number.isInteger(id) && id >= 1 && isRecordGenuinelyCleared(rec)) {
      count++;
    }
  }
  return count;
}

/**
 * Counts consecutive un-cleared stages immediately preceding `levelId` (`levelId - 1, levelId - 2, ... >= 1`).
 */
export function countTrailingUnclearedStages(payload: SavePayloadV1, levelId: number): number {
  const cleanId = Math.max(1, Math.floor(levelId));
  let trailing = 0;
  for (let id = cleanId - 1; id >= 1; id--) {
    if (isRecordGenuinelyCleared(payload.levelRecords[id])) {
      break;
    }
    trailing++;
    if (trailing >= ZEN_MAX_CONSECUTIVE_SKIPS) {
      break;
    }
  }
  return trailing;
}

/**
 * Enforces `ZEN-SKIP-GUARD-01`: Zen Free Skips are only permitted in `'ZEN'` mode and can never advance
 * more than `ZEN_MAX_CONSECUTIVE_SKIPS` (`3`) consecutive un-cleared stages ahead of a genuinely cleared stage.
 */
export function canSkipZenLevel(payload: SavePayloadV1, levelId: number): boolean {
  if (payload.settings.playMode !== 'ZEN') return false;
  const cleanId = Math.max(1, Math.floor(levelId));
  if (isRecordGenuinelyCleared(payload.levelRecords[cleanId])) return true;
  return countTrailingUnclearedStages(payload, cleanId) < ZEN_MAX_CONSECUTIVE_SKIPS;
}

/**
 * Computes the effective progression level for global Power-Up unlocks (`L2/8/18/30`) and chest drop pools
 * (`ZEN-SKIP-GUARD-01`): ignores un-cleared Zen skip inflation so Power-Ups unlock strictly via genuine clears.
 */
export function getEffectiveBoosterUnlockLevel(payload: SavePayloadV1, activeBoardLevelId = 1): number {
  const nonZenBoardLvl =
    payload.settings.playMode === 'ZEN' ? 1 : Math.max(1, Math.floor(activeBoardLevelId || 1));
  return Math.max(
    1,
    nonZenBoardLvl,
    payload.modeState.CHALLENGE.highestUnlocked,
    payload.modeState.TIMED.highestUnlocked,
    countUniqueClearedLevels(payload) + 1
  );
}

/**
 * Applies a Zen-only Free Skip (`0 Coins`). Returns `false` (strict no-op) if `playMode !== 'ZEN'`
 * or if `ZEN_MAX_CONSECUTIVE_SKIPS` (`3`) consecutive un-cleared stages have already been skipped.
 */
export function applyZenOnlySkip(payload: SavePayloadV1, levelId: number): boolean {
  if (!canSkipZenLevel(payload, levelId)) return false;
  const existing = payload.levelRecords[levelId];
  if (!existing) {
    payload.levelRecords[levelId] = {
      stars: 0,
      bestMoves: 0,
      bestTimeSec: 0,
      skipped: true,
      zenSkipped: true,
    };
  } else if (!existing.zenCleared) {
    payload.levelRecords[levelId] = {
      ...existing,
      skipped: existing.stars === 0 ? true : existing.skipped,
      zenSkipped: true,
    };
  }
  const zenLadder = payload.modeState.ZEN;
  if (levelId + 1 > zenLadder.highestUnlocked) {
    zenLadder.highestUnlocked = levelId + 1;
  }
  zenLadder.currentLevelId = levelId + 1;
  payload.currentLevelId = levelId + 1;
  payload.highestLevelUnlocked = computeGlobalHighestUnlocked(
    payload.modeState,
    payload.highestLevelUnlocked
  );
  return true;
}
