import { getAllCampaignLevels, getLevelSpec, TOTAL_CAMPAIGN_LEVELS } from '../levels/catalog';
import {
  type AppViewContext,
  BOOSTER_DEBUT_NOTES,
  getChapterMetaForLevel,
  PARTICLE_CATALOG,
  SKIN_CATALOG,
  THEME_UNLOCK_PRICE,
  TRAY_CATALOG,
} from './catalog-meta';

export function renderRoadmapImpl(app: AppViewContext): void {
  const container = document.getElementById('roadmap-list');
  if (!container) return;

  const save = app.saveManager.getPayload();
  const allCampaign = getAllCampaignLevels();
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
    banner.setAttribute('role', 'presentation');

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

  let lastChapterNum = '';

  for (const spec of levelsToShow) {
    const ch = getChapterMetaForLevel(spec.id);
    if (ch.chapterNum !== lastChapterNum) {
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

    const isUnlocked = spec.id <= unlockedMax;
    const isCurrent = spec.id === save.currentLevelId;
    const isCompleted = isUnlocked && !isCurrent && spec.id < save.currentLevelId;
    const record = save.levelRecords[spec.id];
    const milestoneNote = spec.unlockNote ?? BOOSTER_DEBUT_NOTES[spec.id];
    const isMilestone = Boolean(milestoneNote);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'listitem');
    btn.dataset.levelId = String(spec.id);
    btn.className = [
      'level-node-card',
      `tier-${spec.difficulty.toLowerCase()}`,
      isCurrent ? 'current-level' : '',
      isCompleted ? 'completed-level' : '',
      isMilestone ? 'milestone-node' : '',
      !isUnlocked ? 'locked-level' : '',
    ]
      .filter(Boolean)
      .join(' ');

    let starDisplay = isUnlocked ? '☆☆☆' : '🔒';
    if (record) {
      if (record.skipped && record.stars === 0) {
        starDisplay = 'Skipped';
      } else if (record.stars > 0) {
        starDisplay = '★'.repeat(record.stars) + '☆'.repeat(3 - record.stars);
      }
    }

    const topRow = document.createElement('div');
    topRow.className = 'node-top-row';

    const numSpan = document.createElement('span');
    numSpan.className = 'node-level-num';
    numSpan.textContent = isCurrent ? `✦ STAGE #${spec.id}` : `#${spec.id}`;

    const badgeSpan = document.createElement('span');
    badgeSpan.className = `badge-difficulty diff-${spec.difficulty.toLowerCase()}`;
    badgeSpan.textContent = spec.difficulty.replace('_', ' ');

    const starsSpan = document.createElement('span');
    starsSpan.className = 'node-stars';
    starsSpan.textContent = starDisplay;

    topRow.append(numSpan, badgeSpan, starsSpan);

    const nameDiv = document.createElement('div');
    nameDiv.className = 'node-name';
    const archPrefix =
      spec.barriers && spec.barriers.length > 0
        ? '⛩️ '
        : (spec.layoutId && spec.layoutId !== 'RECTANGLE') || (spec.cutouts && spec.cutouts.length > 0)
          ? '🏛️ '
          : '';
    nameDiv.textContent = `${archPrefix}${spec.name}`;

    btn.append(topRow, nameDiv);

    if (milestoneNote) {
      const noteDiv = document.createElement('div');
      noteDiv.className = 'node-unlock-note';
      noteDiv.textContent = `✦ ${milestoneNote}`;
      btn.appendChild(noteDiv);
    }

    btn.addEventListener('click', () => {
      if (!isUnlocked) {
        app.sound.playWallClack();
        app.showGameToast(`🔒 Clear or Skip up to Level ${spec.id} to unlock!`);
        return;
      }
      app.sound.playButtonTap();
      app.loadLevel(spec.id, true);
    });

    fragment.appendChild(btn);
  }

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
      for (let eid = wStart; eid <= wEnd; eid++) {
        const spec = getLevelSpec(eid);
        const isUnlocked = eid <= unlockedMax || app.activeRoadmapRange === 'endless';
        const isCurrent = eid === save.currentLevelId;
        const isCompleted = isUnlocked && !isCurrent && eid < unlockedMax;
        const record = save.levelRecords[eid];

        let starDisplay = isUnlocked ? '☆☆☆' : '🔒';
        if (record) {
          if (record.skipped && record.stars === 0) {
            starDisplay = 'Skipped';
          } else if (record.stars > 0) {
            starDisplay = '★'.repeat(record.stars) + '☆'.repeat(3 - record.stars);
          }
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'listitem');
        btn.dataset.levelId = String(eid);
        btn.className = [
          'level-node-card',
          `tier-${spec.difficulty.toLowerCase()}`,
          isCurrent ? 'current-level' : '',
          isCompleted ? 'completed-level' : '',
          !isUnlocked ? 'locked-level' : '',
        ]
          .filter(Boolean)
          .join(' ');

        const topRow = document.createElement('div');
        topRow.className = 'node-top-row';

        const numSpan = document.createElement('span');
        numSpan.className = 'node-level-num';
        numSpan.textContent = isCurrent ? `✦ STAGE #${eid}` : `♾️ #${eid}`;

        const badgeSpan = document.createElement('span');
        badgeSpan.className = `badge-difficulty diff-${spec.difficulty.toLowerCase()}`;
        badgeSpan.textContent = spec.difficulty.replace('_', ' ');

        const starsSpan = document.createElement('span');
        starsSpan.className = 'node-stars';
        starsSpan.textContent = starDisplay;

        topRow.append(numSpan, badgeSpan, starsSpan);

        const nameDiv = document.createElement('div');
        nameDiv.className = 'node-name';
        const endlessPrefix =
          spec.barriers && spec.barriers.length > 0
            ? '⛩️ '
            : (spec.layoutId && spec.layoutId !== 'RECTANGLE') || (spec.cutouts && spec.cutouts.length > 0)
              ? '🏛️ '
              : '';
        nameDiv.textContent = `${endlessPrefix}${spec.name}`;

        btn.append(topRow, nameDiv);

        btn.addEventListener('click', () => {
          if (!isUnlocked) {
            app.sound.playWallClack();
            app.showGameToast(`🔒 Clear or Skip up to Level ${eid} to unlock!`);
            return;
          }
          app.sound.playButtonTap();
          app.loadLevel(eid, true);
        });

        fragment.appendChild(btn);
      }
      prevEnd = wEnd;
    }
  }

  container.replaceChildren(fragment);

  // Auto-focus the player's Current Sanctuary Stage in the scrollable map trail
  // when beyond Level 1 so the map opens directly to their active journey progression.
  if (app.activeRoadmapRange === 'all' && save.currentLevelId > 1) {
    const scrollCurrentStageIntoView = () => {
      const currentNode = container.querySelector<HTMLElement>('.level-node-card.current-level');
      if (currentNode && container.clientHeight > 0) {
        const containerRect = container.getBoundingClientRect();
        const nodeRect = currentNode.getBoundingClientRect();
        const relativeTop = nodeRect.top - containerRect.top + container.scrollTop;
        container.scrollTop = Math.max(0, Math.round(relativeTop - container.clientHeight * 0.14));
      }
    };
    scrollCurrentStageIntoView();
    requestAnimationFrame(scrollCurrentStageIntoView);
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
    onAction: (id: T) => void
  ) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const frag = document.createDocumentFragment();
    for (const item of items) {
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
      btn.textContent = isEquipped
        ? '✦ Equipped'
        : isUnlocked
          ? 'Equip'
          : `Unlock · ${THEME_UNLOCK_PRICE} Coins`;

      btn.addEventListener('click', () => onAction(item.id));
      card.append(topDiv, btn);
      frag.appendChild(card);
    }
    container.replaceChildren(frag);
  };

  buildCategoryGrid('themes-skins-grid', SKIN_CATALOG, save.unlockedSkins, save.equippedSkin, (skinId) => {
    if (app.saveManager.unlockOrEquipSkin(skinId, THEME_UNLOCK_PRICE)) {
      app.sound.playButtonTap();
      app.renderThemesStudio();
      app.renderNow();
    } else {
      app.sound.playWallClack();
      app.showGameToast(`Need ${THEME_UNLOCK_PRICE} Coins to unlock this cosmetic!`);
    }
  });

  buildCategoryGrid('themes-trays-grid', TRAY_CATALOG, save.unlockedTrays, save.equippedTray, (trayId) => {
    if (app.saveManager.unlockOrEquipTray(trayId, THEME_UNLOCK_PRICE)) {
      app.sound.playButtonTap();
      app.renderThemesStudio();
      app.renderNow();
    } else {
      app.sound.playWallClack();
      app.showGameToast(`Need ${THEME_UNLOCK_PRICE} Coins to unlock this cosmetic!`);
    }
  });

  buildCategoryGrid(
    'themes-particles-grid',
    PARTICLE_CATALOG,
    save.unlockedParticles,
    save.equippedParticle,
    (particleId) => {
      if (app.saveManager.unlockOrEquipParticle(particleId, THEME_UNLOCK_PRICE)) {
        app.sound.playButtonTap();
        app.renderThemesStudio();
        app.renderNow();
      } else {
        app.sound.playWallClack();
        app.showGameToast(`Need ${THEME_UNLOCK_PRICE} Coins to unlock this cosmetic!`);
      }
    }
  );
}
