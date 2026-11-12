# 300-Level Progression, Play Modes & Economy v2

On-demand reference for **campaign & endless generation (`RAMP-01`–`05`)**, **solver-verified difficulty tiers**, **play modes (`CHALLENGE`, `ZEN`, `TIMED`)**, **star/bomb/undo integrity**, and **Economy v2 (`ECON-01`–`04`, `ECON-V2`)**. Read this before modifying `src/levels/*`, `src/core/board*.ts`, or economy/reward logic in `src/storage/save-manager.ts`.

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

## 2. Independent Mode Ladders, Zen Stars/Blessings, Coalescing & Undo Integrity (`MAP-MODE-SPLIT-01`, `ZEN-STARS-01`)

- **Independent Per-Mode Ladders (`modeState[mode]`) & Additive Stars**:
  - `modeState` tracks `{ currentLevelId, highestUnlocked }` independently from Level 1 for `'CHALLENGE'`, `'ZEN'`, and `'TIMED'`. Global `highestLevelUnlocked = max(modeState.*.highestUnlocked)` unlocks boosters (`L2/8/18/30`) across all modes and triggers Level-10 Milestone Chests once per global decade (`levelId % 10 === 0 && levelId > milestoneChestLevel`).
  - `totalStars` sums per-stage `challengeStars` (`1–3★`) + `timedStars` (`1–3★`) + `zenStarsEarned`, feeding 25-Star Reliquary Chests (`+90c + 1 Power-Up`). `#level-jump-input` is locked to `1 .. modeState[activeMode].highestUnlocked`.
- **`'CHALLENGE'` (Default — Tactical Move Budget)**:
  - `moveLimit = computeDefaultMoveLimit(parMoves, difficulty, levelId)`: `par + 6` (`L1–12`) $\rightarrow$ `+5 / +4` (`L13–25`) $\rightarrow$ `+5` breathers or `+4 / +3 / +2` for `NORMAL / HARD / SUPER_HARD` (`L26+`). Buzzer-beater wins (`movesRemaining === 0 && isBoardWon`) succeed before `OUT_OF_MOVES`.
  - **Touch-Move Coalescing**: Consecutive drags of `lastMovedBlockId === block.id && !lastMoveDidShred` (including sliding into position then pulling into a gate) count as **`1` move tick**.
  - **Final-Touch Grace (`FINAL-TOUCH-01`)**: At `0` moves remaining, if the last-moved unshredded block can still reach an eligible gate (`hasFinalTouchGrace`), finishing that block is a free coalesced touch while any other block move is rejected.
- **`'ZEN'` (Sanctuary Flow — `ZEN-CALM-01`, `ZEN-STARS-01`)**:
  - Unlimited moves, untimed, advances `modeState.ZEN.highestUnlocked`, sets `zenCleared: true` (`🌿 Zen` badge, pauses rather than resets `winStreak`), and marks `board.bombsInert = true` (fuses never tick or detonate).
  - **Zen-Only Skips**: Stage skips (`#btn-skip-hud`, `#btn-pause-skip`, `recordLevelSkip`) exist **only** in `'ZEN'` (`zenSkipped: true`, hidden/no-op in `'CHALLENGE'` & `'TIMED'`, and never overwrite `zenCleared`).
  - **Zen Stars & Zen Blessings**: Every `3` unique non-skipped Zen clears (`zenStarProgress: 0..2`) awards `+1 ★` (`zenStarsEarned++`, `+5c`, Reliquary progress). Every `4` unique non-skipped Zen clears (`zenBlessingProgress: 0..3`) banks `+1 🌿 Zen Blessing` (cap `3`), redeemable via `#btn-use-zen-blessing` on `#dialog-failure` in `'CHALLENGE'`/`'TIMED'` for a free `+5 Moves` / `+20s` Continue (`0 Coins`, `continuesUsed++` `1★` cap).
- **`'TIMED'` (Speed Rush — `TIMED-BOMB-01`)**:
  - Countdown `round(minMoves * secPerMove + 12)` (`4.6 / 4.0 / 3.5s` per move). Bombs tick once per `getTimedBombTickSec(board)` (`max(2.5s, timeLimitSec / parMoves)` — never `1/sec`). Booster targeting never pauses the clock; only modals, Pause, and Title do.
- **Anti-Cheese Mode Switching (`switchPlayModeImpl`)**:
  - Switching from `#dialog-failure` (`#btn-failure-zen`) or when `board.levelId` is locked/behind frontier in `nextMode` loads `nextMode`'s frontier cleanly at Move 0.
  - Same-stage in-game `Challenge`/`Timed` $\rightarrow$ `Zen` preserves the live board (`runTouchedZen = true`, defusing `0`-count bombs); `Zen` $\rightarrow$ `Challenge`/`Timed` after `movesCommitted > 0 || runTouchedZen` restarts from Move 0. Leaving `TIMED` zeroes `freezeRemainingSec`.
- **Slack-Scaled Stars (`STARS-SLACK-01`, `computeEarnedStars`)**:
  - `CHALLENGE`: `slack = moveLimit - parMoves`; `3★ <= par + floor(slack/3)`, `2★ <= par + floor(2*slack/3)`, else `1★`. `TIMED`: `3★ >= 28%` / `2★ >= 12%` time left. Any Continue (`continuesUsed > 0`) caps at `1★`.
- **Undo & Stuck Detection (`F-08`, `UNDO-RES-01`, `STUCK-01`)**:
  - 3 free Undos per level + accidental restart recovery (`preRestartSnapshot`, forfeited only on a real committed move). `carryLiveResourcesIntoUndo` carries forward live clock, fuses, Free Moves, freeze seconds, and `continuesUsed`. Executing `HAMMER`, `ROCKET`, or `VACUUM` clears `undoStack`.
  - Idle `scheduleStuckBoardCheckImpl` warns only when gridlocked or `solveBoard` sets `searchExhausted === true` without a solution (never on search-budget timeouts).

---

## 3. Economy v2, Power-Ups & Scarcity (`ECON-01`–`04`, `ECON-V2`)

- **5 Progressive Power-Ups** (`120` starter coins + `1` unit each on `economyVersion: 2`):
  - `UNDO` (`COMMON`, Lvl 1, `60c`), `HINT` (`UNCOMMON`, Lvl 2, `80c` — highlights `hintMove` + grants **`+2` Free Moves** pausing `movesRemaining` & Bombs in `CHALLENGE`/`ZEN`, or `+10s` clock/bomb freeze + `hintMove` in `TIMED`), `HAMMER` (`RARE`, Lvl 8, `140c`), `ROCKET` (`EPIC`, Lvl 18, `220c`), `VACUUM` (`LEGENDARY`, Lvl 30, `350c`). Charge boosters/Continues before (or roll back with) their effect.
- **Payouts, Chests & Pricing**:
  - First Gold clear: `15 / 25 / 40c` (`NORMAL / HARD / SUPER_HARD`; `20%` min `3c` replay) + `+5c` per new Gold Star + **Flow Streak** (`+5..+25c`). Zen clear: `+10c` first (`+2c` replay).
  - Rarity-weighted chests (`pickRarityWeightedBooster`): **Shredder** (`+50c + 1 Booster` / `100` blocks), **Milestone** (`+75c + 1 Booster` / `10` levels), **25-Star Reliquary** (`+90c + 1 Booster` / `25` Gold Stars).
  - Cosmetics: `THEME_TIER_PRICES = [0, 250, 450, 750, 1200]`; Failure Continue: `150c` (`+5 Moves` / `+20s`); `#level-jump-input` locked to `1 .. highestLevelUnlocked` (`allowJump = true` only on `__SHREDBLOCKS_DEBUG__.loadLevel`). Legacy `v1` saves soft-compress balances above `600` once and migrate default `'ZEN'` $\rightarrow$ `'CHALLENGE'`.
