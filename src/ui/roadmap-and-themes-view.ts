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
  getThemeItemPrice,
  PARTICLE_CATALOG,
  SKIN_CATALOG,
  TRAY_CATALOG,
} from './catalog-meta';

export function renderRoadmapImpl(app: AppViewContext): void {
  const container = document.getElementById('roadmap-list');
  if (!container) return;

  const save = app.saveManager.getPayload();
  const allCampaign = getCampaignRoadmapMeta();
  const unlockedMax = Math.max(1, save.highestLevelUnlocked, save.currentLevelId);

  let levelsToShow = allCampaign;
  if (app.activeRoadmapRange === '1-50') {
    levelsToShow = allCampaign.filter((l) => l.id >= 1 && l.id <= 50);
  } else if (app.activeRoadmapRange === '51-100') {
    levelsToShow = allCampaign.filter((l) => l.id >= 51 && l.id <= 100);
  } else if (app.activeRoadmapRange === '101-150') {
    levelsToShow = allCampaign.filter((l) => l.id >= 101 && l.id <= 150);
  } else if (app.activeRoadmapRange === '151-200') {
    levelsToShow = allCampaign.filter((l) => l.id >= 151 && l.id <= 200);
  } else if (app.activeRoadmapRange === '201-250') {
    levelsToShow = allCampaign.filter((l) => l.id >= 201 && l.id <= 250);
  } else if (app.activeRoadmapRange === '251-300') {
    levelsToShow = allCampaign.filter((l) => l.id >= 251 && l.id <= 300);
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
    earnedStars: number;
  }

  const buildLevelNode = (spec: LevelRoadmapMeta, isEndlessNode: boolean): StageNodeBuildInfo => {
    const record = save.levelRecords[spec.id];
    const earnedStars = Math.max(0, record?.stars ?? 0);
    const hasClearedStars = earnedStars > 0;
    const isZenCleared = Boolean(record?.zenCleared && !hasClearedStars);
    const isSkipped = Boolean(record?.skipped && !hasClearedStars && !isZenCleared);
    const isCurrent = spec.id === save.currentLevelId;
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
      const doneFlag = document.createElement('span');
      doneFlag.className = 'node-flag-badge flag-completed';
      doneFlag.textContent = '✓ Cleared';
      rightCluster.append(doneFlag);
    } else if (isZenNode) {
      const zenFlag = document.createElement('span');
      zenFlag.className = 'node-flag-badge flag-zen';
      zenFlag.textContent = '🌿 Zen';
      rightCluster.append(zenFlag);
    }

    let starDisplay = isUnlocked ? '☆☆☆' : '🔒';
    if (hasClearedStars) {
      starDisplay = '★'.repeat(earnedStars) + '☆'.repeat(3 - earnedStars);
    } else if (isZenCleared) {
      starDisplay = '☆☆☆';
    } else if (isSkipped) {
      starDisplay = isCurrent ? '☆☆☆' : 'Skipped';
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
      playCue.textContent = 'Play ›';
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

    btn.addEventListener('click', () => {
      if (!isUnlocked) {
        app.sound.playWallClack();
        app.showGameToast(`🔒 Clear or Skip up to Level ${spec.id} to unlock!`);
        return;
      }
      app.sound.playButtonTap();
      app.loadLevel(spec.id, true);
    });

    return {
      btn,
      isCurrent,
      isCompleted: hasClearedStars,
      isZenCleared,
      isSkipped,
      isUnlocked,
      earnedStars,
    };
  };

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
      const zenCount = builtNodes.filter((n) => n.isZenCleared && !n.isCompleted).length;
      const skippedCount = builtNodes.filter((n) => n.isSkipped && !n.isCompleted).length;
      const unlockedCount = builtNodes.filter((n) => n.isUnlocked).length;
      const hasCurrent = builtNodes.some((n) => n.isCurrent);
      const groupStars = builtNodes.reduce((sum, n) => sum + n.earnedStars, 0);
      const maxGroupStars = builtNodes.length * 3;
      const allCleared = clearedCount === builtNodes.length;
      const allLocked = unlockedCount === 0;

      const groupEl = document.createElement('div');
      groupEl.className = [
        'roadmap-stage-group',
        allCleared ? 'stage-group-cleared' : '',
        hasCurrent ? 'stage-group-active' : '',
        allLocked ? 'stage-group-locked' : '',
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
        summarySpan.textContent = `✓ ${clearedCount}/${builtNodes.length} Cleared · ★ ${groupStars}/${maxGroupStars}`;
      } else if (allLocked) {
        summarySpan.className = 'stage-group-summary summary-locked';
        summarySpan.textContent = '🔒 Locked';
      } else {
        summarySpan.className = 'stage-group-summary summary-progress';
        const parts = [`${clearedCount}/${builtNodes.length} Cleared`];
        if (zenCount > 0) {
          parts.push(`🌿 ${zenCount} Zen`);
        }
        if (skippedCount > 0) {
          parts.push(`${skippedCount} Skipped`);
        }
        if (groupStars > 0) {
          parts.push(`★ ${groupStars}/${maxGroupStars}`);
        }
        summarySpan.textContent = parts.join(' · ');
      }

      headerEl.append(titleSpan, summarySpan);

      const trackEl = document.createElement('div');
      trackEl.className = 'stage-group-track';
      trackEl.setAttribute('role', 'presentation');
      for (const node of builtNodes) {
        trackEl.appendChild(node.btn);
      }

      groupEl.append(headerEl, trackEl);
      fragment.appendChild(groupEl);
    }
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
      let chStars = 0;
      for (let lid = ch.startLevel; lid <= ch.endLevel; lid++) {
        chStars += save.levelRecords[lid]?.stars ?? 0;
      }
      const maxStars = (ch.endLevel - ch.startLevel + 1) * 3;
      fragment.appendChild(
        createChapterBanner(
          `${ch.chapterNum} · LEVELS ${ch.startLevel}–${ch.endLevel}`,
          ch.title,
          ch.subtitle,
          `★ ${chStars} / ${maxStars}`
        )
      );
    }
    chapterBatch.push(spec);
  }
  flushChapterBatch();

  // Append Procedural Endless Mastery Nodes (Windowed so 50,000+ levels render in < 5ms)
  if (app.activeRoadmapRange === 'all' || app.activeRoadmapRange === 'endless') {
    const endlessStart = TOTAL_CAMPAIGN_LEVELS + 1;
    const endlessCh = getChapterMetaForLevel(endlessStart);
    fragment.appendChild(
      createChapterBanner(
        `${endlessCh.chapterNum} · LEVEL ${endlessStart}+`,
        endlessCh.title,
        endlessCh.subtitle,
        '∞ Procedural'
      )
    );

    const rawWindows: Array<[number, number]> = [];
    if (unlockedMax <= TOTAL_CAMPAIGN_LEVELS + 24) {
      rawWindows.push([endlessStart, Math.max(TOTAL_CAMPAIGN_LEVELS + 6, unlockedMax + 3)]);
    } else {
      rawWindows.push([endlessStart, endlessStart + 5]);
      const focusLevel = save.currentLevelId >= endlessStart ? save.currentLevelId : unlockedMax;
      rawWindows.push([
        Math.max(endlessStart + 6, focusLevel - 8),
        Math.min(unlockedMax + 3, focusLevel + 8),
      ]);
      rawWindows.push([Math.max(endlessStart + 6, unlockedMax - 8), unlockedMax + 3]);
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
        const archivedCount = wStart - prevEnd - 1;
        fragment.appendChild(
          createChapterBanner(
            `ENDLESS ARCHIVE · STAGES #${prevEnd + 1}–#${wStart - 1}`,
            `${archivedCount} Cleared Stages Archived`,
            'Enter any stage number in the Lvl # jump box above to replay.',
            `✓ ${archivedCount}`
          )
        );
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

  // Auto-focus the player's Current Sanctuary Stage in the scrollable linked path
  // (or reset to top when viewing Level 1 or a filter range without the active stage).
  const currentNode = container.querySelector<HTMLElement>('.level-node-card.current-level');
  if (currentNode && save.currentLevelId > 1) {
    const scrollCurrentStageIntoView = () => {
      const activeNode = container.querySelector<HTMLElement>('.level-node-card.current-level');
      if (activeNode && container.clientHeight > 0) {
        const containerRect = container.getBoundingClientRect();
        const nodeRect = activeNode.getBoundingClientRect();
        const relativeTop = nodeRect.top - containerRect.top + container.scrollTop;
        container.scrollTop = Math.max(0, Math.round(relativeTop - container.clientHeight * 0.16));
      }
    };
    scrollCurrentStageIntoView();
    requestAnimationFrame(scrollCurrentStageIntoView);
  } else {
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

  buildCategoryGrid(
    'themes-skins-grid',
    SKIN_CATALOG,
    save.unlockedSkins,
    save.equippedSkin,
    (skinId, price) => {
      if (app.saveManager.unlockOrEquipSkin(skinId, price)) {
        app.sound.playButtonTap();
        app.renderThemesStudio();
        app.renderNow();
      } else {
        app.sound.playWallClack();
        app.showGameToast(`Need ${price} Coins to unlock this cosmetic!`);
      }
    }
  );

  buildCategoryGrid(
    'themes-trays-grid',
    TRAY_CATALOG,
    save.unlockedTrays,
    save.equippedTray,
    (trayId, price) => {
      if (app.saveManager.unlockOrEquipTray(trayId, price)) {
        app.sound.playButtonTap();
        app.renderThemesStudio();
        app.renderNow();
      } else {
        app.sound.playWallClack();
        app.showGameToast(`Need ${price} Coins to unlock this cosmetic!`);
      }
    }
  );

  buildCategoryGrid(
    'themes-particles-grid',
    PARTICLE_CATALOG,
    save.unlockedParticles,
    save.equippedParticle,
    (particleId, price) => {
      if (app.saveManager.unlockOrEquipParticle(particleId, price)) {
        app.sound.playButtonTap();
        app.renderThemesStudio();
        app.renderNow();
      } else {
        app.sound.playWallClack();
        app.showGameToast(`Need ${price} Coins to unlock this cosmetic!`);
      }
    }
  );
}
