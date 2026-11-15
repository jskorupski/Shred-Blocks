import { getBlockRoomId, getGroupAxisLock, getMovedGroupBlocks, isBlockInLockedRoom } from '../core/physics';
import { type BarrierState, type BlockState, COLOR_PALETTE, type ColorId } from '../core/types';
import type { AppViewContext } from './catalog-meta';

function formatColorFilterName(colorId: ColorId, cb: boolean): string {
  const entry = COLOR_PALETTE[colorId];
  if (!entry) return 'matching';
  return cb ? `${entry.cbName} (${entry.symbol})` : entry.name;
}

/**
 * Explains why a tapped block (or any glued sibling in its group) cannot move.
 */
export function handleImmobileBlockTapImpl(app: AppViewContext, block: BlockState): void {
  const members = getMovedGroupBlocks(app.board, block.id);
  const group = members.length > 0 ? members : [block];
  const cb = app.saveManager.getPayload().settings.colorblindSymbols;

  const lockedMember = group.find((m) => isBlockInLockedRoom(app.board, m));
  if (lockedMember) {
    const roomId = getBlockRoomId(app.board, lockedMember);
    const bar = app.board.barriers.find((b) => !b.open && b.unlocksRoomId === roomId);
    if (bar?.lockId && bar.lockId > 0 && bar.shredsRemaining <= 0) {
      app.showGameToast('⛩️ Chamber Sealed! Shred a block with a 🔑 Key to open the Portcullis');
    } else if (bar && bar.shredsRemaining > 0) {
      app.showGameToast(
        `⛩️ Chamber Sealed! Shred ${bar.shredsRemaining} more block(s) to open the Portcullis`
      );
    } else {
      app.showGameToast('⛩️ Chamber Sealed! Open the Portcullis Barrier first');
    }
    return;
  }

  let maxIce = 0;
  let hasChain = false;
  let ropeColor: ColorId = 0;
  for (const m of group) {
    if (m.iceCount > maxIce) maxIce = m.iceCount;
    if (m.chained) hasChain = true;
    if (m.ropeColor > 0 && ropeColor === 0) ropeColor = m.ropeColor;
  }

  if (maxIce > 0) {
    app.showGameToast(`❄️ Frozen! Shred ${maxIce} more block(s) to thaw`);
  } else if (hasChain) {
    app.showGameToast('🔒 Chained! Shred a block carrying a 🔑 Key to unlock');
  } else if (ropeColor > 0) {
    const cName = formatColorFilterName(ropeColor, cb);
    app.showGameToast(`🪢 Tied with ${cName} Rope! Shred matching ✂️ Scissors first`);
  } else if (getGroupAxisLock(group) === 'LOCKED_BOTH') {
    app.showGameToast('🚧 Welded Cross-Rails! Opposing rail tracks lock this group in place');
  }
}

/**
 * Explains non-block board obstacles, floor color-filter paths, and mechanisms when tapped directly.
 */
export function handleBoardFeatureTapImpl(app: AppViewContext, row: number, col: number): void {
  const { board } = app;
  if (row < 0 || row >= board.rows || col < 0 || col >= board.cols) return;
  const idx = row * board.cols + col;
  const occ = board.occupancy[idx];
  const cb = app.saveManager.getPayload().settings.colorblindSymbols;

  if (occ === -3) {
    const bar = board.barriers.find((b) => !b.open && b.cells.some(([r, c]) => r === row && c === col));
    if (bar?.lockId && bar.lockId > 0 && bar.shredsRemaining <= 0) {
      app.showGameToast('⛩️ Portcullis Sealed! Shred a block carrying a 🔑 Key to unlock');
    } else if (bar && bar.shredsRemaining > 0) {
      app.showGameToast(`⛩️ Portcullis Sealed! Shred ${bar.shredsRemaining} more block(s) to open`);
    } else {
      app.showGameToast('⛩️ Portcullis Sealed! Clear required blocks to open');
    }
    return;
  }
  if (occ <= -100) {
    const crateId = -100 - occ;
    const crate = board.crates.find((c) => c.id === crateId && !c.destroyed);
    const hp = crate ? crate.hp : 1;
    app.showGameToast(`📦 Wooden Crate (${hp} HP) — shred an adjacent block to crack!`);
    return;
  }
  if (occ === -4) {
    const gen = board.generators.find((g) => g.row === row && g.col === col);
    if (!gen || gen.state === 'DEPLETED' || gen.queueCursor >= gen.queue.length) {
      app.showGameToast('⚡ Depleted Block Generator — all queued blocks spawned');
    } else {
      app.showGameToast(`⚡ Block Generator — spawns next block in ${gen.cooldown} shred(s)!`);
    }
    return;
  }
  if (occ === -2) {
    app.showGameToast('🏛️ Stone Pillar — fixed courtyard obstacle');
    return;
  }

  const fc = (board.floorColor[idx] ?? 0) as ColorId;
  if (fc > 0) {
    const cName = formatColorFilterName(fc, cb);
    app.showGameToast(`🎨 ${cName} Floor Path — only ${cName} blocks can cross!`);
    return;
  }

  const onElevator = board.elevators.some((e) => {
    const dir = e.atAlternatePos ? -1 : 1;
    const minR = Math.min(e.row, e.row + e.deltaRow * dir);
    const maxR = Math.max(e.row, e.row + e.deltaRow * dir) + e.height - 1;
    const minC = Math.min(e.col, e.col + e.deltaCol * dir);
    const maxC = Math.max(e.col, e.col + e.deltaCol * dir) + e.width - 1;
    return row >= minR && row <= maxR && col >= minC && col <= maxC;
  });
  if (onElevator) {
    app.showGameToast('🛗 Moving Elevator — shifts fully contained blocks after each shred');
  }
}

/**
 * Surfaces the color-filter rule when a dragged block is blocked strictly by a mismatched floor tile.
 */
export function handleFloorPathCollisionImpl(app: AppViewContext, floorColorId: ColorId): void {
  if (floorColorId <= 0) return;
  const cb = app.saveManager.getPayload().settings.colorblindSymbols;
  const cName = formatColorFilterName(floorColorId, cb);
  app.showGameToast(`🎨 ${cName} Floor Path — only ${cName} blocks can cross!`);
}

/**
 * Surfaces Sealed Mystery Vault unlock requirements when tapped directly.
 */
export function handleLockedVaultTapImpl(app: AppViewContext, vault: BarrierState): void {
  if (vault.shredsRemaining > 0 && vault.lockId > 0) {
    app.showGameToast(
      `🔒 Sealed Mystery Vault: Shred ${vault.shredsRemaining} more block${vault.shredsRemaining > 1 ? 's' : ''} + Key #${vault.lockId} to reveal!`
    );
  } else if (vault.shredsRemaining > 0) {
    app.showGameToast(
      `🔒 Sealed Mystery Vault: Shred ${vault.shredsRemaining} more block${vault.shredsRemaining > 1 ? 's' : ''} to reveal hidden blocks!`
    );
  } else if (vault.lockId > 0) {
    app.showGameToast(`🔑 Sealed Mystery Vault: Shred the Key #${vault.lockId} block to reveal!`);
  }
}
