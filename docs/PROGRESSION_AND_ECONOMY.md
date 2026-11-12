# 300-Level Progression, Ludological Core & Economy v2

On-demand reference for **campaign & endless generation (`RAMP-01`–`05`)**, **solver-verified difficulty tiers**, **the formal Ludological Core & Mode Isolation invariants (`LUDO-CORE-01`, `MODE-ISOLATION-01`, `ZEN-SKIP-GUARD-01`, `STREAK-INTEGRITY-01`)**, **play modes (`CHALLENGE`, `ZEN`, `TIMED`)**, and **Economy v2 (`ECON-01`–`04`, `ECON-V2`)**. Read this before modifying `src/levels/*`, `src/core/board*.ts`, `src/ui/modals-and-save-transfer.ts`, `src/ui/boosters-controller.ts`, or economy/reward logic in `src/storage/*`.

---

## 1. 6 Architectural Epochs & Spatial Challenge Ramp (`1..300`, Endless `301+`)

Every curated level (`1..300` in [`src/levels/catalog.ts`](../src/levels/catalog.ts)) and seeded `Mulberry32` Endless level (`301+` in [`src/levels/generator.ts`](../src/levels/generator.ts)) must be **100% solvable without boosters** (`solveBoard()` in [`src/levels/solver.ts`](../src/levels/solver.ts)) with zero overlapping initial cells.

- **6 Courtyard Epochs**:
  - **Epoch I (`L1–15`, `5×5`)**: Onboarding Sanctuary (`3–6` blocks, `5` on breathers, `2–3` colors, Axis-Lock `L11`, Sculpted `CROSS_ATRIUM` `L14`).
  - **Epoch II (`L16–40`, `6×6` & `8×6` Tall Portrait)**: Courtyard Expansion (`6–13` blocks, Stepped-Edge Gates `L18`, Cutouts & Pillars `L21`, Multi-Room Portcullis `L25`, **Sealed Mystery Vaults** `L28`, Multi-Layer `L31`, Hourglass Vault Island `L38`).
  - **Epoch III (`L41–80`, `6×7`, `8×6` & `9×7` Tall Portrait)**: Tactical Chambers (`7–16` blocks via High-Density Packing `DENSITY-01`, Ice `L41`, Stars `L51`, Keys `L61`, Neutral Stone `L71`, Quad Vault `L74`).
  - **Epoch IV (`L81–140`, `7×7` & `9×7` Tall Portrait)**: Grand Plaza (`7–11` blocks, Crates `L81`, Bombs `L91`, Glued Groups `L101`, Ropes `L111`, Color Queue Gates `L121`, Frozen Gates `L131`).
  - **Epoch V (`L141–220`, `7×8`, `8×8` & `9×7` Tall Portrait)**: Kinetic Machinery (`8–12` blocks, Shutters `L141/145`, Sliding/Resizing Gates `L151/155`, Generators `L161`, Floor Paths `L171`, Elevators `L181`, Milestone `L200`).
  - **Epoch VI (`L221–300`, `8×8`, `9×9` & `10×8` Tall Portrait)**: Monumental Mastery (`9–14` blocks, `4–6` colors, Milestone `L250`, `14`-block `9×9` Grand Citadel Finale at `L300`, Endless Mastery `L301+`).
- **3-Tier Onboarding vs. Gridlock Ramp**:
  - **`L1–12` (`UX-03` First-Move Safety)**: Every legal first move leads to a solvable board (`verifyFirstMoveSafety()`).
  - **`L13–25` (Guided Blocker Parking)**: Introduces `2–3` move cross-corridor blocker parking (`populateCandidateBlocks`) with `ONBOARDING_RESCUE_MAX_LEVEL = 25` dynamic-gate/queue rescues active.
  - **`L26+` (Authentic Spatial Gridlock)**: Enforces tight `2–4` cell gate apertures, multi-step blocker staging (`stagingMoves = minMoves - shredLayers`), `canBlockStepAnyDirection` deadlock pruning, and disables silent dynamic-gate/queue bailouts on normal moves (while keeping `C1-03` rescues active on `createBoardState` and Booster strikes).
- **Pacing & Modifier Budgets (`RAMP-01`–`RAMP-05`)**:
  - **Breathers (`RAMP-01`)**: `decPos === 6` waves (`16, 26, 36, ...`) use `difficulty: 'NORMAL'`, `4`-cell gates, zero bombs/tight shutters, `1` primary mechanic, and `5 -> 9` blocks across Epochs I–VI.
  - **Modifiers & Fuses (`RAMP-02`–`05`)**: Never stack two immobilizers or two center payloads on one block (`canAddBlockModifier`), cap obstacle families to `1..3` by epoch, keep `spanLength >= maxPerpendicularBlockSpan`, and calibrate bomb fuses (`>= 9`, scaled `1.75 / 1.5 / 1.35` across `NORMAL / HARD / SUPER_HARD`).

---

## 2. Independent Mode Ladders, Clean-Reset Isolation, Skip Guards & Undo Integrity (`MAP-MODE-SPLIT-01`, `MODE-ISOLATION-01`, `ZEN-SKIP-GUARD-01`, `STREAK-INTEGRITY-01`, `ZEN-STARS-01`)

- **Independent Per-Mode Ladders (`modeState[mode]`) & Genuine-Clear Global Unlocks (`ZEN-SKIP-GUARD-01`)**:
  - `modeState` tracks `{ currentLevelId, highestUnlocked }` independently from Level 1 for `'CHALLENGE'`, `'ZEN'`, and `'TIMED'`. `#level-jump-input` and `#btn-next-level` clamp strictly to `1 .. modeState[activeMode].highestUnlocked`.
  - **Genuine-Clear Progression (`isRecordGenuinelyCleared`, `countUniqueClearedLevels`)**: A `LevelRecord` counts as genuinely cleared iff `(challengeStars ?? 0) > 0 || (timedStars ?? 0) > 0 || zenCleared === true || earnedStars > 0` (`zenSkipped: true` alone **never** counts).
  - **Power-Up Unlocks (`getEffectiveBoosterUnlockLevel`)**: Effective unlock tier is `max(1, nonZenBoardLvl, CHALLENGE.highestUnlocked, TIMED.highestUnlocked, countUniqueClearedLevels(save) + 1)` — preserving non-skipping Challenge/Timed frontiers while ensuring Zen skips without clearing stages can never unlock `HINT (L2)`, `HAMMER (L8)`, `ROCKET (L18)`, or `VACUUM (L30)`.
  - **Milestone Chests (`10` Unique Clears)**: Trigger strictly when `floor(countUniqueClearedLevels / 10)` crosses a new `10`-stage bucket above `milestoneChestLevel` (e.g., `10, 20, 30, ...`), preserving debut booster guarantees (`L10 -> HAMMER`, `L20 -> ROCKET`, `L30 -> VACUUM`) even if an honest player skipped stage 10 and achieved their 10th genuine clear on stage 11.
  - `totalStars` sums per-stage `challengeStars` (`1–3★`) + `timedStars` (`1–3★`) + `zenStarsEarned`, feeding 25-Star Reliquary Chests (`+90c + 1 Power-Up`, gated on `getEffectiveBoosterUnlockLevel`).
- **`'CHALLENGE'` (Default — Tactical Move Budget)**:
  - `moveLimit = computeDefaultMoveLimit(parMoves, difficulty, levelId)`: `par + 6` (`L1–12`) $\rightarrow$ `+5 / +4` (`L13–25`) $\rightarrow$ `+5` breathers or `+4 / +3 / +2` for `NORMAL / HARD / SUPER_HARD` (`L26+`). Buzzer-beater wins (`movesRemaining === 0 && isBoardWon`) succeed before `OUT_OF_MOVES`.
  - **Touch-Move Coalescing & Final-Touch Grace (`FINAL-TOUCH-01`)**: Consecutive drags of `lastMovedBlockId === block.id && !lastMoveDidShred` count as **`1` move tick**. At `0` moves remaining, if that last-moved unshredded block can still reach an eligible gate (`hasFinalTouchGrace`), finishing it is a free coalesced touch while any other block move is rejected.
- **`'ZEN'` (Sanctuary Flow — `ZEN-CALM-01`, `ZEN-STARS-01`, `ZEN-SKIP-GUARD-01`)**:
  - Unlimited moves, untimed, advances `modeState.ZEN.highestUnlocked`, sets `zenCleared: true` (`🌿 Zen` badge, pauses rather than resets `winStreak`), and marks `board.bombsInert = true` (fuses never tick or detonate).
  - **Zen-Only Skips & 3-Skip Consecutive Cap (`ZEN_MAX_CONSECUTIVE_SKIPS = 3`)**: Stage skips (`#btn-skip-hud`, `#btn-pause-skip`, `recordLevelSkip`) exist **only** in `'ZEN'` (and only while `#screen-game` is active with `boardPlayMode === 'ZEN'`). `canSkipZenLevel(save, targetLevelId)` counts consecutive un-cleared stages (`!isRecordGenuinelyCleared`) trailing downward from `targetLevelId - 1` and blocks further skips once `trailingUncleared >= 3` until at least one stage is genuinely cleared.
  - **Zen Stars & Zen Blessings**: Every `3` unique non-skipped Zen clears (`zenStarProgress: 0..2`) awards `+1 ★` (`zenStarsEarned++`, `+5c`, Reliquary progress). Every `4` unique non-skipped Zen clears (`zenBlessingProgress: 0..3`) banks `+1 🌿 Zen Blessing` (cap `3`), redeemable via `#btn-use-zen-blessing` on `#dialog-failure` in `'CHALLENGE'`/`'TIMED'` for a free `+5 Moves` / `+20s` Continue (`0 Coins`, `continuesUsed++` `1★` cap).
- **`'TIMED'` (Speed Rush — `TIMED-BOMB-01`)**:
  - Countdown `round(minMoves * secPerMove + 12)` (`4.6 / 4.0 / 3.5s` per move). Bombs tick once per `getTimedBombTickSec(board)` (`max(2.5s, timeLimitSec / parMoves)` — never `1/sec`). Booster targeting never pauses the clock; only modals, Pause, and Title do.
- **Clean-Reset Mode Isolation & Non-Clobbering Frontier Bookmarks (`MODE-ISOLATION-01`)**:
  - **Always Clean Move-0 Reset**: Every mode switch (`switchPlayModeImpl` from HUD, Map tab, or `#btn-failure-zen`, plus `popstate` and save import/restore) cancels active pointer drags/targeting (`cancelTargeting()` + `dragBoardRef === board` guard), tracks `ctx.boardPlayMode = nextMode`, and loads a **clean Move-0 board** (`undoStack = []`, `preRestartSnapshot = null`, `freeMovesRemaining = 0`, `freezeRemainingSec = 0`, `continuesUsed = 0`). Off-screen switches (`#screen-home`, `#screen-themes`, `#title-overlay`) unconditionally load `nextMode`'s `frontierId` even when `board.levelId === frontierId` so `bombsInert` / `moveLimit` can never leak across modes.
  - **Frontier Bookmark Preservation**: Replaying an earlier stage `L < ladder.currentLevelId` in `nextMode` (`persistBookmark = targetLevelId >= nextLadder.currentLevelId`) or clearing an earlier replay in `evaluateModeLevelWin` (`max(ladder.currentLevelId, min(levelId + 1, highestUnlocked))`) **never** clobbers a higher frontier bookmark.
- **Flow Streak Conservation (`STREAK-INTEGRITY-01`)**:
  - `winStreak` increments (`+1`) **only** when `!isZenRun && isFirstClear` (replaying Level 1 in `CHALLENGE` or `TIMED` never farms streak).
  - Normal in-mode `Restart` and `‹ Map` exits preserve `winStreak` (honest fat-finger forgiveness), whereas actual failure (`OUT_OF_MOVES` / `TIME_UP` / `BOMB_DETONATED`) **or** switching modes mid-attempt (`isBoardRunStarted(board)` in `'CHALLENGE'` or `'TIMED'`) invokes `recordLevelLoss()` (`winStreak = 0`), blocking mid-loss Zen bailout smuggling.
- **Slack-Scaled Stars (`STARS-SLACK-01`, `computeEarnedStars`)**:
  - `CHALLENGE`: `slack = moveLimit - parMoves`; `3★ <= par + floor(slack/3)`, `2★ <= par + floor(2*slack/3)`, else `1★`. `TIMED`: `3★ >= 28%` / `2★ >= 12%` time left. Any Continue (`continuesUsed > 0`) caps at `1★`.
- **Undo & Stuck Detection (`F-08`, `UNDO-RES-01`, `STUCK-01`)**:
  - 3 free Undos per level + accidental restart recovery (`preRestartSnapshot`, forfeited on committed moves and wiped on mode switches). `carryLiveResourcesIntoUndo` carries forward live clock, `timerRunning` (`Boolean(restored.timerRunning || live.timerRunning)` so Undoing Move 1 $\rightarrow$ Move 0 in `'TIMED'` never freezes the Speed Rush clock), fuses, Free Moves, freeze seconds, and `continuesUsed`. Executing `HAMMER`, `ROCKET`, or `VACUUM` clears `undoStack`.
  - Idle `scheduleStuckBoardCheckImpl` warns only when gridlocked or `solveBoard` sets `searchExhausted === true` without a solution (never on search-budget timeouts).

---

## 3. Economy v2, Closed-Loop Faucet/Sink Equilibrium & Ludological Gate (`LUDO-CORE-01`, `ECON-01`–`04`, `ECON-V2`)

- **5 Progressive Power-Ups** (`120` starter coins + `1` unit each on `economyVersion: 2`):
  - `UNDO` (`COMMON`, Lvl 1, `60c`), `HINT` (`UNCOMMON`, Lvl 2, `80c` — highlights `hintMove` + grants **`+2` Free Moves** pausing `movesRemaining` & Bombs in `CHALLENGE`/`ZEN`, or `+10s` clock/bomb freeze + `hintMove` in `TIMED`), `HAMMER` (`RARE`, Lvl 8, `140c`), `ROCKET` (`EPIC`, Lvl 18, `220c`), `VACUUM` (`LEGENDARY`, Lvl 30, `350c`). Charge boosters/Continues before (or roll back with) their effect.
- **Closed-Loop Faucet vs. Sink Conservation Table (`LUDO-CORE-01`)**:
  - **Bounded Primary Faucets (Unique Progression)**: First Gold clear `15 / 25 / 40c` (`NORMAL / HARD / SUPER_HARD`) + `+5c` per newly earned Gold Star + first-clear **Flow Streak** (`+5..+25c`); first Zen clear `+10c`, `+1★` (`+5c`) per `3` unique Zen clears, `+1 🌿` (cap `3`) per `4` unique Zen clears; Milestone Chest (`+75c + 1 Booster` per `10` unique clears); 25-Star Reliquary Chest (`+90c + 1 Booster` per `25` total Stars).
  - **Damped Replay Faucets (Anti-Grind)**: Replaying an already-cleared stage pays `max(3c, floor(0.2 * baseCoins))` (`+2c` in Zen), `0` additional stars once `3★` is achieved, `0` Flow Streak increments (`STREAK-INTEGRITY-01`), and only incremental Shredder Chest progress (`+50c + 1 Booster` per `100` genuinely shredded blocks).
  - **Calibrated Sinks**: Boosters (`60c / 80c / 140c / 220c / 350c`), Failure Continue (`150c` or `1 🌿`, capped at `1★`), and 15 Theme Cosmetics (`THEME_TIER_PRICES = [0, 250, 450, 750, 1200]`). Legacy `v1` saves soft-compress balances above `600` once and migrate default `'ZEN'` $\rightarrow$ `'CHALLENGE'`.
- **Mandatory 5-Question Ludological Impact Review Checklist (`LUDO-CORE-01`)**:
  1. **Zero Infinite Faucets**: Does any loop of `Restart`, `Undo`, `Skip`, `Replay`, or `Switch Mode` mint Coins, Stars, Zen Blessings, Streaks, or Chests without genuine spatial puzzle clears? *(Must be impossible; covered by [`tests/unit/mode-ladders-and-blessings.test.ts`](../tests/unit/mode-ladders-and-blessings.test.ts) & [`tests/e2e/mode-ambience-and-progression.spec.ts`](../tests/e2e/mode-ambience-and-progression.spec.ts)).*
  2. **Strict Mode State Isolation (`MODE-ISOLATION-01`)**: Can any mutable attempt state (`undoStack`, `preRestartSnapshot`, `freeMovesRemaining`, `freezeRemainingSec`, `bombsInert`, `timerRunning`, `continuesUsed`, or active pointer drag) cross from one `PlayMode` into another? *(Must clean-reset to Move 0 on every switch).*
  3. **Skip & Replay Non-Inflation (`ZEN-SKIP-GUARD-01`, `STREAK-INTEGRITY-01`)**: Are `0`-cost Zen skips bounded (`<= 3` consecutive) and excluded from `countUniqueClearedLevels`, `getEffectiveBoosterUnlockLevel`, Milestone Chests, Zen Star/Blessing counters, and `winStreak`? *(Must hold across UI & storage).*
  4. **100% Booster-Free Solvability & Meaningful Scarcity**: Does `solveBoard()` still clear every stage without boosters (`UX-03`, `RAMP-01..05`) while keeping booster/Continue prices meaningful relative to 10-stage net coin income (`~320–420c` per 10 first-clear Challenge stages)?
  5. **Backward Save Conservation (`SAVE-COMPAT-01`)**: Do existing player saves (`v1`, `0xa5`, `[0xa6, 0x4d]`) round-trip and forward-migrate without losing earned progress or opening duplicate chests?
