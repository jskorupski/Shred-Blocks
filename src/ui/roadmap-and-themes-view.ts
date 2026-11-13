import {
  getCampaignRoadmapMeta,
  getLevelRoadmapMeta,
  type LevelRoadmapMeta,
  TOTAL_CAMPAIGN_LEVELS,
} from '../levels/catalog';
import {
  type AppViewContext,
  BOOSTER_DEBUT_NOTES,
  getChapterMetaForLevel,
  getPlayModeMeta,
  getThemeItemPrice,
  PARTICLE_CATALOG,
  SKIN_CATALOG,
  TRAY_CATALOG,
} from './catalog-meta';

export function computeEndlessTierChips(
  unlockedMax: number,
  activeCurrentId: number
): Array<[number, number]> {
  if (unlockedMax <= TOTAL_CAMPAIGN_LEVELS) return [];
  const endlessStart = TOTAL_CAMPAIGN_LEVELS + 1;
  const totalBuckets = Math.max(1, Math.ceil((unlockedMax - TOTAL_CAMPAIGN_LEVELS) / 50));
  const selectedIndices = new Set<number>();

  if (totalBuckets <= 12) {
    for (let b = 0; b < totalBuckets; b++) selectedIndices.add(b);
  } else {
    selectedIndices.add(0);
    if (activeCurrentId >= endlessStart) {
      const curBucket = Math.floor((activeCurrentId - endlessStart) / 50);
      for (let b = Math.max(0, curBucket - 1); b <= Math.min(totalBuckets - 1, curBucket + 1); b++) {
        selectedIndices.add(b);
      }
    }
    for (let b = Math.max(0, totalBuckets - 6); b < totalBuckets; b++) {
      selectedIndices.add(b);
    }
  }

  return Array.from(selectedIndices)
    .sort((a, b) => a - b)
    .map((b) => [endlessStart + b * 50, endlessStart + b * 50 + 49]);
}

function syncRoadmapFilterChips(app: AppViewContext, unlockedMax: number, activeCurrentId: number): void {
  const pillsContainer = document.querySelector<HTMLElement>('.filter-pills');
  if (!pillsContainer) return;

  const hadFocusInPills = pillsContainer.contains(document.activeElement);
  const existingDynamic = new Map<string, HTMLButtonElement>();
  for (const el of pillsContainer.querySelectorAll<HTMLButtonElement>('[data-endless-tier-chip="true"]')) {
    if (el.dataset.range) existingDynamic.set(el.dataset.range, el);
    else el.remove();
  }

  const desiredRanges = computeEndlessTierChips(unlockedMax, activeCurrentId);
  const desiredKeys = new Set<string>();
  for (const [tStart, tEnd] of desiredRanges) {
    const key = `${tStart}-${tEnd}`;
    desiredKeys.add(key);
    let chip = existingDynamic.get(key);
    if (!chip) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip-filter';
      chip.dataset.range = key;
      chip.dataset.endlessTierChip = 'true';
      chip.textContent = `${tStart}–${tEnd}`;
    }
    pillsContainer.appendChild(chip);
  }
  for (const [key, staleChip] of existingDynamic) {
    if (!desiredKeys.has(key)) staleChip.remove();
  }

  const allChips = Array.from(pillsContainer.querySelectorAll<HTMLButtonElement>('.chip-filter[data-range]'));
  if (!allChips.some((c) => c.dataset.range === app.activeRoadmapRange)) {
    app.activeRoadmapRange = 'all';
  }
  let activeChipEl: HTMLButtonElement | null = null;
  for (const chip of allChips) {
    const isActive = chip.dataset.range === app.activeRoadmapRange;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    if (isActive) activeChipEl = chip;
  }
  if (app.activeRoadmapRange === 'all') {
    pillsContainer.scrollLeft = 0;
  }
  if (hadFocusInPills && !pillsContainer.contains(document.activeElement) && activeChipEl) {
    activeChipEl.focus({ preventScroll: true });
  }
}

let pendingRoadmapScrollRaf1 = 0;
let pendingRoadmapScrollRaf2 = 0;

export function renderRoadmapImpl(app: AppViewContext, focusStageId?: number): void {
  const container = document.getElementById('roadmap-list');
  if (!container) return;
  if (pendingRoadmapScrollRaf1) cancelAnimationFrame(pendingRoadmapScrollRaf1);
  if (pendingRoadmapScrollRaf2) cancelAnimationFrame(pendingRoadmapScrollRaf2);
  pendingRoadmapScrollRaf1 = 0;
  pendingRoadmapScrollRaf2 = 0;

  if (!container.dataset.delegatedBound) {
    container.dataset.delegatedBound = 'true';
    container.addEventListener('click', (e) => {
      const targetEl = e.target as HTMLElement | null;
      const archiveBtn = targetEl?.closest<HTMLButtonElement>('.roadmap-archive-btn[data-archive-start]');
      if (archiveBtn) {
        const expStart = Number(archiveBtn.dataset.archiveStart);
        const expEnd = Number(archiveBtn.dataset.archiveEnd);
        if (Number.isFinite(expStart) && Number.isFinite(expEnd)) {
          app.sound.playButtonTap();
          app.expandedEndlessRanges.push([expStart, expEnd]);
          app.renderRoadmap(expStart);
        }
        return;
      }
      const nodeBtn = targetEl?.closest<HTMLButtonElement>('.level-node-card[data-level-id]');
      if (!nodeBtn) return;
      const levelId = Number(nodeBtn.dataset.levelId);
      if (!Number.isFinite(levelId) || levelId < 1) return;
      if (nodeBtn.dataset.unlocked !== 'true') {
        const curMode = app.saveManager.getPayload().settings.playMode;
        app.sound.playWallClack();
        app.showGameToast(
          curMode === 'ZEN'
            ? `🔒 Clear or Skip up to Level ${levelId} in Zen Mode to unlock!`
            : `🔒 Clear up to Level ${levelId} in ${curMode === 'TIMED' ? 'Speed Rush' : 'Challenge Mode'} to unlock!`
        );
        return;
      }
      app.sound.playButtonTap();
      app.loadLevel(levelId, true);
    });
  }

  const save = app.saveManager.getPayload();
  const playMode = save.settings.playMode;
  const modeInfo = getPlayModeMeta(playMode);
  const modeLadder = save.modeState[playMode];
  const activeCurrentId = Math.max(1, modeLadder.currentLevelId || 1);
  const allCampaign = getCampaignRoadmapMeta();
  const unlockedMax = Math.max(1, modeLadder.highestUnlocked, activeCurrentId);

  syncRoadmapFilterChips(app, unlockedMax, activeCurrentId);

  const getModeStars = (levelId: number): number => {
    const r = save.levelRecords[levelId];
    if (!r) return 0;
    if (playMode === 'ZEN') return 0;
    if (playMode === 'TIMED') return Math.max(0, r.timedStars ?? 0);
    return Math.max(0, r.challengeStars ?? (r.timedStars === undefined && !r.skipped ? (r.stars ?? 0) : 0));
  };

  let levelsToShow = allCampaign;
  let explicitEndlessTier: [number, number] | null = null;
  const rangeMatch = /^(\d+)-(\d+)$/.exec(app.activeRoadmapRange);
  if (rangeMatch) {
    const rStart = Number(rangeMatch[1]);
    const rEnd = Number(rangeMatch[2]);
    if (rEnd <= TOTAL_CAMPAIGN_LEVELS) {
      levelsToShow = allCampaign.filter((l) => l.id >= rStart && l.id <= rEnd);
    } else {
      levelsToShow = [];
      explicitEndlessTier = [rStart, rEnd];
    }
  } else if (app.activeRoadmapRange === 'endless') {
    levelsToShow = [];
  }

  const fragment = document.createDocumentFragment();

  const createChapterBanner = (
    kickerText: string,
    titleText: string,
    subtitleText: string,
    starsText: string
  ) => {
    const banner = document.createElement('div');
    banner.className = 'roadmap-chapter-banner';

    const leftDiv = document.createElement('div');
    leftDiv.className = 'chapter-banner-meta';

    const kicker = document.createElement('span');
    kicker.className = 'chapter-banner-kicker';
    kicker.textContent = kickerText;

    const title = document.createElement('h3');
    title.className = 'chapter-banner-title';
    title.textContent = titleText;

    const sub = document.createElement('p');
    sub.className = 'chapter-banner-sub';
    sub.textContent = subtitleText;

    leftDiv.append(kicker, title, sub);

    const rightDiv = document.createElement('div');
    rightDiv.className = 'chapter-banner-stars';
    rightDiv.textContent = starsText;

    banner.append(leftDiv, rightDiv);
    return banner;
  };

  interface StageNodeBuildInfo {
    btn: HTMLButtonElement;
    isCurrent: boolean;
    isCompleted: boolean;
    isZenCleared: boolean;
    isSkipped: boolean;
    isUnlocked: boolean;
    isMilestone: boolean;
    earnedStars: number;
  }

  const buildLevelNode = (spec: LevelRoadmapMeta, isEndlessNode: boolean): StageNodeBuildInfo => {
    const record = save.levelRecords[spec.id];
    const earnedStars = getModeStars(spec.id);
    const hasClearedStars = playMode !== 'ZEN' && earnedStars > 0;
    const isZenCleared = playMode === 'ZEN' && Boolean(record?.zenCleared);
    const isSkipped = playMode === 'ZEN' && Boolean((record?.zenSkipped ?? record?.skipped) && !isZenCleared);
    const isCurrent = spec.id === activeCurrentId;
    const isUnlocked = spec.id <= unlockedMax || hasClearedStars || isZenCleared || isSkipped;
    const isCompleted = hasClearedStars && !isCurrent;
    const isZenNode = isZenCleared && !isCurrent;
    const milestoneNote = !isEndlessNode ? (spec.unlockNote ?? BOOSTER_DEBUT_NOTES[spec.id]) : undefined;
    const isMilestone = Boolean(milestoneNote);

    const btn = document.createElement('button');
    btn.type = 'button';
    if (isCurrent) {
      btn.setAttribute('aria-current', 'step');
    }
    btn.dataset.levelId = String(spec.id);
    btn.dataset.unlocked = isUnlocked ? 'true' : 'false';
    btn.className = [
      'level-node-card',
      `tier-${spec.difficulty.toLowerCase()}`,
      isCurrent ? 'current-level' : '',
      isCompleted ? 'completed-level' : '',
      isZenNode ? 'zen-cleared-level' : '',
      isSkipped && !isCurrent ? 'skipped-level' : '',
      isUnlocked && !isCurrent && !isCompleted && !isZenNode && !isSkipped ? 'unlocked-level' : '',
      isMilestone ? 'milestone-node' : '',
      !isUnlocked ? 'locked-level' : '',
    ]
      .filter(Boolean)
      .join(' ');

    // Left linked-path step medallion (purely decorative; accessible status is in text spans)
    const markerSpan = document.createElement('span');
    markerSpan.className = 'node-step-marker';
    markerSpan.setAttribute('aria-hidden', 'true');
    markerSpan.textContent = isCurrent
      ? '▶'
      : isCompleted
        ? '✓'
        : isZenNode
          ? '🌿'
          : isSkipped
            ? '»'
            : isUnlocked
              ? '•'
              : '🔒';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'node-content';

    const topRow = document.createElement('div');
    topRow.className = 'node-top-row';

    const leftCluster = document.createElement('div');
    leftCluster.className = 'node-left-cluster';

    const numSpan = document.createElement('span');
    numSpan.className = 'node-level-num';
    numSpan.textContent = isCurrent ? `✦ STAGE #${spec.id}` : isEndlessNode ? `♾️ #${spec.id}` : `#${spec.id}`;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'node-name';
    const archPrefix = spec.hasBarriers ? '⛩️ ' : spec.isSculpted ? '🏛️ ' : '';
    nameDiv.textContent = `${archPrefix}${spec.name}`;

    leftCluster.append(numSpan);
    if (!isCurrent) {
      leftCluster.append(nameDiv);
    }

    const rightCluster = document.createElement('div');
    rightCluster.className = 'node-right-cluster';

    const badgeSpan = document.createElement('span');
    badgeSpan.className = `badge-difficulty diff-${spec.difficulty.toLowerCase()}`;
    badgeSpan.textContent = spec.difficulty.replace('_', ' ');
    rightCluster.append(badgeSpan);

    if (isCompleted) {
      const underPar = Boolean(record?.underParCleared);
      const doneFlag = document.createElement('span');
      doneFlag.className = `node-flag-badge ${underPar ? 'flag-under-par' : 'flag-completed'}`;
      doneFlag.textContent = underPar ? '✦ Under Par' : '✓ Cleared';
      rightCluster.append(doneFlag);
    } else if (isZenNode) {
      const zenFlag = document.createElement('span');
      zenFlag.className = 'node-flag-badge flag-zen';
      zenFlag.textContent = '🌿 Zen';
      rightCluster.append(zenFlag);
    }

    let starDisplay = isUnlocked ? (playMode === 'ZEN' ? '🌿 Open' : '☆☆☆') : '🔒';
    if (hasClearedStars) {
      starDisplay = '★'.repeat(earnedStars) + '☆'.repeat(3 - earnedStars);
    } else if (isZenCleared) {
      starDisplay = '✓ Tranquil';
    } else if (isSkipped) {
      starDisplay = isCurrent ? '🌿 Open' : 'Skipped';
    }

    const starsSpan = document.createElement('span');
    starsSpan.className = `node-stars${isSkipped && !isCurrent ? ' stars-skipped' : ''}`;
    starsSpan.textContent = starDisplay;
    rightCluster.append(starsSpan);

    topRow.append(leftCluster, rightCluster);
    contentDiv.appendChild(topRow);

    if (isCurrent) {
      const currentSubRow = document.createElement('div');
      currentSubRow.className = 'node-current-title-row';
      const playCue = document.createElement('span');
      playCue.className = 'node-play-cue';
      playCue.setAttribute('aria-hidden', 'true');
      playCue.textContent = `${modeInfo.icon} Play ›`;
      currentSubRow.append(nameDiv, playCue);
      contentDiv.appendChild(currentSubRow);
    }

    if (milestoneNote) {
      const noteDiv = document.createElement('div');
      noteDiv.className = 'node-unlock-note';
      noteDiv.textContent = `✦ ${milestoneNote}`;
      contentDiv.appendChild(noteDiv);
    }

    btn.append(markerSpan, contentDiv);

    return {
      btn,
      isCurrent,
      isCompleted: hasClearedStars,
      isZenCleared,
      isSkipped,
      isUnlocked,
      isMilestone,
      earnedStars,
    };
  };

  const anchorStageId = focusStageId ?? activeCurrentId;
  const anchorBucket = Math.floor((anchorStageId - 1) / 5);
  const topVisibleStartBucket = explicitEndlessTier
    ? Math.floor((explicitEndlessTier[0] - 1) / 5)
    : rangeMatch
      ? Math.floor((Number(rangeMatch[1]) - 1) / 5)
      : app.activeRoadmapRange === 'endless'
        ? Math.floor(TOTAL_CAMPAIGN_LEVELS / 5)
        : 0;

  const appendStageGroups = (specs: LevelRoadmapMeta[], isEndlessGroup: boolean) => {
    let idx = 0;
    while (idx < specs.length) {
      const firstId = specs[idx].id;
      const bucketKey = Math.floor((firstId - 1) / 5);
      const groupSpecs: LevelRoadmapMeta[] = [];
      while (idx < specs.length && Math.floor((specs[idx].id - 1) / 5) === bucketKey) {
        groupSpecs.push(specs[idx]);
        idx++;
      }

      const startId = groupSpecs[0].id;
      const endId = groupSpecs[groupSpecs.length - 1].id;
      const builtNodes = groupSpecs.map((s) => buildLevelNode(s, isEndlessGroup));

      const clearedCount = builtNodes.filter((n) => n.isCompleted).length;
      const zenCount = builtNodes.filter((n) => n.isZenCleared).length;
      const skippedCount = builtNodes.filter((n) => n.isSkipped).length;
      const unlockedCount = builtNodes.filter((n) => n.isUnlocked).length;
      const milestoneCount = builtNodes.filter((n) => n.isMilestone).length;
      const hasCurrent = builtNodes.some((n) => n.isCurrent);
      const isNearViewport =
        hasCurrent ||
        Math.abs(bucketKey - anchorBucket) <= 3 ||
        (bucketKey >= topVisibleStartBucket && bucketKey < topVisibleStartBucket + 3);
      const groupStars = builtNodes.reduce((sum, n) => sum + n.earnedStars, 0);
      const maxGroupStars = builtNodes.length * 3;
      const allCleared =
        playMode === 'ZEN' ? zenCount === builtNodes.length : clearedCount === builtNodes.length;
      const allLocked = unlockedCount === 0;

      const groupEl = document.createElement('div');
      groupEl.className = [
        'roadmap-stage-group',
        allCleared ? 'stage-group-cleared' : '',
        hasCurrent ? 'stage-group-active' : '',
        allLocked ? 'stage-group-locked' : '',
        !isNearViewport ? 'stage-group-deferred' : '',
      ]
        .filter(Boolean)
        .join(' ');
      groupEl.setAttribute('role', 'group');
      groupEl.setAttribute(
        'aria-label',
        startId === endId ? `Stage ${startId}` : `Stages ${startId} to ${endId}`
      );

      const headerEl = document.createElement('div');
      headerEl.className = 'stage-group-header';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'stage-group-title';
      titleSpan.textContent =
        startId === endId
          ? `${isEndlessGroup ? 'ENDLESS STAGE' : 'STAGE'} ${startId}`
          : `${isEndlessGroup ? 'ENDLESS STAGES' : 'STAGES'} ${startId}–${endId}`;

      const summarySpan = document.createElement('span');
      if (allCleared) {
        summarySpan.className = 'stage-group-summary summary-cleared';
        summarySpan.textContent =
          playMode === 'ZEN'
            ? `✓ ${zenCount}/${builtNodes.length} Zen Cleared`
            : `✓ ${clearedCount}/${builtNodes.length} Cleared · ★ ${groupStars}/${maxGroupStars}`;
      } else if (allLocked) {
        summarySpan.className = 'stage-group-summary summary-locked';
        summarySpan.textContent = '🔒 Locked';
      } else if (playMode === 'ZEN') {
        summarySpan.className = 'stage-group-summary summary-progress';
        const parts = [`🌿 ${zenCount}/${builtNodes.length} Cleared`];
        if (skippedCount > 0) {
          parts.push(`${skippedCount} Skipped`);
        }
        summarySpan.textContent = parts.join(' · ');
      } else {
        summarySpan.className = 'stage-group-summary summary-progress';
        const parts = [`${clearedCount}/${builtNodes.length} Cleared`];
        if (groupStars > 0) {
          parts.push(`★ ${groupStars}/${maxGroupStars}`);
        }
        summarySpan.textContent = parts.join(' · ');
      }

      headerEl.append(titleSpan, summarySpan);

      const trackEl = document.createElement('div');
      trackEl.className = 'stage-group-track';
      trackEl.setAttribute('role', 'presentation');
      if (!isNearViewport) {
        trackEl.style.setProperty('--flight-count', String(builtNodes.length));
        if (milestoneCount > 0) {
          trackEl.style.setProperty('--milestone-count', String(milestoneCount));
        }
      }
      for (const node of builtNodes) {
        trackEl.appendChild(node.btn);
      }

      groupEl.append(headerEl, trackEl);
      fragment.appendChild(groupEl);
    }
  };

  const formatBoundedRangeMetric = (startId: number, endId: number): string => {
    const count = endId - startId + 1;
    if (playMode === 'ZEN') {
      let zenClears = 0;
      for (let lid = startId; lid <= endId; lid++) {
        if (save.levelRecords[lid]?.zenCleared) zenClears++;
      }
      return `🌿 ${zenClears} / ${count}`;
    }
    let stars = 0;
    for (let lid = startId; lid <= endId; lid++) {
      stars += getModeStars(lid);
    }
    return `★ ${stars} / ${count * 3}`;
  };

  let chapterBatch: LevelRoadmapMeta[] = [];
  let lastChapterNum = '';

  const flushChapterBatch = () => {
    if (chapterBatch.length > 0) {
      appendStageGroups(chapterBatch, false);
      chapterBatch = [];
    }
  };

  for (const spec of levelsToShow) {
    const ch = getChapterMetaForLevel(spec.id);
    if (ch.chapterNum !== lastChapterNum) {
      flushChapterBatch();
      lastChapterNum = ch.chapterNum;
      fragment.appendChild(
        createChapterBanner(
          `${ch.chapterNum} · LEVELS ${ch.startLevel}–${ch.endLevel}`,
          ch.title,
          ch.subtitle,
          formatBoundedRangeMetric(ch.startLevel, ch.endLevel)
        )
      );
    }
    chapterBatch.push(spec);
  }
  flushChapterBatch();

  // Append Procedural Endless Mastery Nodes (O(1) metadata + interactive archive expansion)
  const endlessStart = TOTAL_CAMPAIGN_LEVELS + 1;
  if (explicitEndlessTier) {
    const [tStart, tEnd] = explicitEndlessTier;
    const endlessCh = getChapterMetaForLevel(tStart);
    fragment.appendChild(
      createChapterBanner(
        `${endlessCh.chapterNum} · LEVELS ${tStart}–${tEnd}`,
        endlessCh.title,
        endlessCh.subtitle,
        formatBoundedRangeMetric(tStart, tEnd)
      )
    );
    const tierSpecs: LevelRoadmapMeta[] = [];
    for (let eid = tStart; eid <= tEnd; eid++) {
      tierSpecs.push(getLevelRoadmapMeta(eid));
    }
    appendStageGroups(tierSpecs, true);
  } else if (app.activeRoadmapRange === 'all' || app.activeRoadmapRange === 'endless') {
    const endlessCh = getChapterMetaForLevel(endlessStart);
    let endlessMetric = '∞ Procedural';
    if (unlockedMax > TOTAL_CAMPAIGN_LEVELS) {
      if (playMode === 'ZEN') {
        let endlessZen = 0;
        for (const [k, rec] of Object.entries(save.levelRecords)) {
          if (Number(k) >= endlessStart && rec?.zenCleared) endlessZen++;
        }
        endlessMetric = `🌿 ${endlessZen} · #${unlockedMax}`;
      } else {
        let endlessStars = 0;
        for (const k of Object.keys(save.levelRecords)) {
          const lid = Number(k);
          if (lid >= endlessStart) endlessStars += getModeStars(lid);
        }
        endlessMetric = `★ ${endlessStars} · #${unlockedMax}`;
      }
    }
    fragment.appendChild(
      createChapterBanner(
        `${endlessCh.chapterNum} · LEVEL ${endlessStart}+`,
        endlessCh.title,
        endlessCh.subtitle,
        endlessMetric
      )
    );

    const alignFlightStart = (id: number) => Math.max(endlessStart, Math.floor((id - 1) / 5) * 5 + 1);
    const alignFlightEnd = (id: number) => Math.floor((id - 1) / 5) * 5 + 5;
    const directCap =
      app.activeRoadmapRange === 'endless' ? TOTAL_CAMPAIGN_LEVELS + 150 : TOTAL_CAMPAIGN_LEVELS + 24;

    const rawWindows: Array<[number, number]> = [];
    if (unlockedMax <= directCap) {
      rawWindows.push([endlessStart, Math.max(TOTAL_CAMPAIGN_LEVELS + 6, unlockedMax + 3)]);
    } else {
      rawWindows.push([endlessStart, endlessStart + 9]);
      const focusLevel = activeCurrentId >= endlessStart ? activeCurrentId : unlockedMax;
      rawWindows.push([
        Math.max(endlessStart + 10, alignFlightStart(focusLevel - 10)),
        Math.min(unlockedMax + 3, alignFlightEnd(focusLevel + 10)),
      ]);
      rawWindows.push([Math.max(endlessStart + 10, alignFlightStart(unlockedMax - 10)), unlockedMax + 3]);
      for (const [exStart, exEnd] of app.expandedEndlessRanges) {
        rawWindows.push([Math.max(endlessStart, exStart), Math.min(unlockedMax + 3, exEnd)]);
      }
    }
    rawWindows.sort((a, b) => a[0] - b[0]);
    const windows: Array<[number, number]> = [];
    for (const [wStart, wEnd] of rawWindows) {
      if (wEnd < wStart) continue;
      const prev = windows[windows.length - 1];
      if (prev && wStart <= prev[1] + 1) {
        prev[1] = Math.max(prev[1], wEnd);
      } else {
        windows.push([wStart, wEnd]);
      }
    }

    let prevEnd = endlessStart - 1;
    for (const [wStart, wEnd] of windows) {
      if (wStart > prevEnd + 1) {
        const gapStart = prevEnd + 1;
        const gapEnd = wStart - 1;
        const archivedCount = gapEnd - gapStart + 1;
        const expandStart =
          archivedCount <= 60 ? gapStart : Math.max(gapStart, alignFlightStart(gapEnd - 49));
        let gapProgress = '';
        if (playMode === 'ZEN') {
          let gZen = 0;
          for (let lid = gapStart; lid <= gapEnd; lid++) {
            if (save.levelRecords[lid]?.zenCleared) gZen++;
          }
          gapProgress = `🌿 ${gZen}/${archivedCount}`;
        } else {
          let gStars = 0;
          for (let lid = gapStart; lid <= gapEnd; lid++) {
            gStars += getModeStars(lid);
          }
          gapProgress = `★ ${gStars}`;
        }

        const archiveBtn = document.createElement('button');
        archiveBtn.type = 'button';
        archiveBtn.className = 'roadmap-archive-btn';
        archiveBtn.dataset.archiveStart = String(expandStart);
        archiveBtn.dataset.archiveEnd = String(gapEnd);

        const leftMeta = document.createElement('div');
        leftMeta.className = 'chapter-banner-meta';
        const kicker = document.createElement('span');
        kicker.className = 'chapter-banner-kicker';
        kicker.textContent = `ENDLESS ARCHIVE · STAGES #${gapStart}–#${gapEnd}`;
        const title = document.createElement('span');
        title.className = 'chapter-banner-title';
        title.textContent = `${archivedCount} Earlier Stages (${gapProgress})`;
        const sub = document.createElement('span');
        sub.className = 'chapter-banner-sub';
        sub.textContent =
          expandStart === gapStart
            ? `Tap to reveal all ${archivedCount} stages (#${gapStart}–#${gapEnd}) on the map.`
            : `Tap to reveal 50 stages (#${expandStart}–#${gapEnd}) on the map.`;
        leftMeta.append(kicker, title, sub);

        const ctaSpan = document.createElement('span');
        ctaSpan.className = 'archive-expand-pill';
        ctaSpan.textContent = `▾ Show #${expandStart}–#${gapEnd}`;

        archiveBtn.append(leftMeta, ctaSpan);
        fragment.appendChild(archiveBtn);
      }
      const endlessSpecs: LevelRoadmapMeta[] = [];
      for (let eid = wStart; eid <= wEnd; eid++) {
        endlessSpecs.push(getLevelRoadmapMeta(eid));
      }
      appendStageGroups(endlessSpecs, true);
      prevEnd = wEnd;
    }
  }

  container.replaceChildren(fragment);

  const scrollSelectorIntoView = (selector: string, moveFocus: boolean): boolean => {
    const targetNode = container.querySelector<HTMLElement>(selector);
    if (!targetNode) return false;
    const syncScroll = () => {
      const liveNode = container.querySelector<HTMLElement>(selector);
      if (liveNode && container.clientHeight > 0) {
        const containerRect = container.getBoundingClientRect();
        const nodeRect = liveNode.getBoundingClientRect();
        const relativeTop = nodeRect.top - containerRect.top + container.scrollTop;
        container.scrollTop = Math.max(0, Math.round(relativeTop - container.clientHeight * 0.16));
      }
    };
    syncScroll();
    if (moveFocus) targetNode.focus({ preventScroll: true });
    pendingRoadmapScrollRaf1 = requestAnimationFrame(() => {
      syncScroll();
      pendingRoadmapScrollRaf2 = requestAnimationFrame(syncScroll);
    });
    return true;
  };

  if (
    focusStageId !== undefined &&
    scrollSelectorIntoView(`.level-node-card[data-level-id="${focusStageId}"]`, true)
  ) {
    return;
  }
  if (activeCurrentId === 1 && container.clientHeight >= 160) {
    container.scrollTop = 0;
    return;
  }
  if (!scrollSelectorIntoView('.level-node-card.current-level', false)) {
    container.scrollTop = 0;
  }
}

export function renderThemesStudioImpl(app: AppViewContext): void {
  const save = app.saveManager.getPayload();
  const particleIcons: Record<string, string> = {
    micro_cubes: '◆',
    star_confetti: '✦',
    pixel_sparks: '✴',
    soap_bubbles: '◎',
    lightning_bolts: '↯',
  };

  const buildCategoryGrid = <T extends string>(
    containerId: string,
    items: ReadonlyArray<{ id: T; name: string; desc: string }>,
    unlockedList: T[],
    equippedId: T,
    onAction: (id: T, price: number) => void
  ) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const itemPrice = getThemeItemPrice(idx);
      const isUnlocked = unlockedList.includes(item.id);
      const isEquipped = equippedId === item.id;

      const card = document.createElement('div');
      card.className = `theme-card ${isEquipped ? 'equipped' : ''}`;

      const topDiv = document.createElement('div');
      topDiv.className = 'theme-card-top';

      const swatchDiv = document.createElement('div');
      swatchDiv.className = `theme-swatch swatch-${item.id}`;
      if (particleIcons[item.id]) {
        swatchDiv.textContent = particleIcons[item.id];
      }

      const metaDiv = document.createElement('div');
      const h4 = document.createElement('h4');
      h4.className = 'theme-card-title';
      h4.textContent = item.name;
      const p = document.createElement('p');
      p.className = 'theme-card-desc';
      p.textContent = item.desc;
      metaDiv.append(h4, p);
      topDiv.append(swatchDiv, metaDiv);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.themeId = item.id;
      btn.className = `btn-tactile btn-compact ${
        isEquipped ? 'btn-primary' : isUnlocked ? 'btn-secondary' : 'btn-warning'
      }`;
      btn.textContent = isEquipped ? '✦ Equipped' : isUnlocked ? 'Equip' : `Unlock · ${itemPrice} Coins`;

      btn.addEventListener('click', () => onAction(item.id, itemPrice));
      card.append(topDiv, btn);
      frag.appendChild(card);
    });
    container.replaceChildren(frag);
  };

  const applyThemeSelection = (ok: boolean, price: number, onSuccessSound: () => void) => {
    if (ok) {
      app.syncAllUiFromSave();
      onSuccessSound();
      app.renderThemesStudio();
      app.renderNow();
    } else {
      app.sound.playWallClack();
      app.showGameToast(`Need ${price} Coins to unlock this cosmetic!`);
    }
  };

  buildCategoryGrid('themes-skins-grid', SKIN_CATALOG, save.unlockedSkins, save.equippedSkin, (id, price) =>
    applyThemeSelection(app.saveManager.unlockOrEquipSkin(id, price), price, () => app.sound.playButtonTap())
  );
  buildCategoryGrid('themes-trays-grid', TRAY_CATALOG, save.unlockedTrays, save.equippedTray, (id, price) =>
    applyThemeSelection(app.saveManager.unlockOrEquipTray(id, price), price, () => app.sound.playButtonTap())
  );
  buildCategoryGrid(
    'themes-particles-grid',
    PARTICLE_CATALOG,
    save.unlockedParticles,
    save.equippedParticle,
    (id, price) =>
      applyThemeSelection(app.saveManager.unlockOrEquipParticle(id, price), price, () =>
        app.sound.playParticlePreview(id)
      )
  );
}
