import { isBoardRunStarted } from '../core/board';
import {
  type AppViewContext,
  type BeforeInstallPromptEvent,
  installNativeAppZoomLock,
  isStandaloneDisplayMode,
  PWA_INSTALLED_STORAGE_KEY,
} from './catalog-meta';
import { refreshThemesPreviewIfActive } from './themes-studio-view';

declare const __SHREDBLOCKS_LAN_DEVTOOLS__: boolean | undefined;

export const SW_UPDATE_THROTTLE_MS = 60_000;
export const SW_COLD_BOOT_AUTO_UPDATE_WINDOW_MS = 1_600;
export const SW_LONG_IDLE_AUTO_UPDATE_MS = 30 * 60 * 1000;
export const SW_ACTIVATED_SETTLE_MS = 60;
export const SW_ACTIVATION_RELOAD_FALLBACK_MS = 1_500;

export interface PwaLifecycleOptions {
  /** Override reload callback for deterministic unit testing of SW update transitions. */
  reloadPage?: () => void;
}

function setInstalledStorageFlag(installed: boolean): void {
  try {
    if (installed) window.localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
    else window.localStorage.removeItem(PWA_INSTALLED_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export async function promptNativeInstall(app: AppViewContext): Promise<'handled' | 'fallback'> {
  const deferred = app.deferredInstallPrompt;
  if (!deferred) return 'fallback';
  try {
    await deferred.prompt();
    const choice = await deferred.userChoice;
    app.deferredInstallPrompt = null;
    if (choice.outcome === 'accepted') app.markPwaInstalled();
    else app.syncInstallUiVisibility();
    app.closeAllModals();
    return 'handled';
  } catch {
    app.deferredInstallPrompt = null;
    app.syncInstallUiVisibility();
    return 'fallback';
  }
}

export function isPwaInstalledImpl(app: AppViewContext): boolean {
  if (typeof window === 'undefined') return false;
  if (isStandaloneDisplayMode()) {
    app.pwaInstalledDetected = true;
    setInstalledStorageFlag(true);
    return true;
  }

  try {
    if (window.localStorage.getItem(PWA_INSTALLED_STORAGE_KEY) === '1') {
      return true;
    }
  } catch {
    // Ignore storage errors
  }

  return app.pwaInstalledDetected;
}

export function markPwaInstalledImpl(app: AppViewContext): void {
  app.pwaInstalledDetected = true;
  setInstalledStorageFlag(true);
  app.syncInstallUiVisibility();
}

export function syncInstallUiVisibilityImpl(app: AppViewContext): void {
  const installed = app.isPwaInstalled();
  const headerInstallBtn = document.getElementById('btn-install-header');
  const titleInstallBtn = document.getElementById('btn-title-install');
  const pauseInstallBtn = document.getElementById('btn-pause-install');
  if (headerInstallBtn) {
    headerInstallBtn.hidden = installed || !app.deferredInstallPrompt;
  }
  if (titleInstallBtn) titleInstallBtn.hidden = installed;
  if (pauseInstallBtn) pauseInstallBtn.hidden = installed;
}

export async function handleInstallActionImpl(app: AppViewContext): Promise<void> {
  app.sound.playButtonTap();
  if ((await promptNativeInstall(app)) === 'handled') return;
  app.openModal('install');
}

export function syncViewportGeometryImpl(app: AppViewContext): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const docEl = document.documentElement;
  const clientH = docEl.clientHeight || window.innerHeight || 0;
  const innerH = window.innerHeight || clientH;
  const vv = window.visualViewport;
  const unzoomedVv = !vv || !(vv.scale > 0) || Math.abs(vv.scale - 1) < 0.02;
  const vvH = vv && vv.height > 0 && unzoomedVv ? vv.height : innerH;
  const vvOffsetTop = vv && vv.offsetTop > 0 && unzoomedVv ? Math.round(vv.offsetTop) : 0;

  const rawMinH = Math.min(clientH, innerH, vvH);
  let effectiveHeight =
    clientH > 0 && Math.abs(rawMinH - clientH) <= 1 ? Math.round(clientH) : Math.round(rawMinH);
  const isMobileOrStandalone =
    app.isPwaInstalled() || (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false);
  const screenH = window.screen?.height ?? 0;
  const availH = window.screen?.availHeight ?? 0;
  if (
    isMobileOrStandalone &&
    screenH > 0 &&
    availH > 0 &&
    effectiveHeight >= screenH - 4 &&
    availH < effectiveHeight &&
    screenH - availH <= 96
  ) {
    effectiveHeight = Math.min(effectiveHeight, availH);
  }

  if (effectiveHeight > 0) {
    docEl.style.setProperty('--app-height', `${effectiveHeight}px`);
  }
  docEl.style.setProperty('--vv-offset-top', `${vvOffsetTop}px`);
  const appShell = document.getElementById('app-shell');
  if (appShell) appShell.dataset.standalone = isStandaloneDisplayMode() ? 'true' : 'false';

  if (app.activeScreen === 'game' || app.titleOverlayOpen) {
    app.renderer.resize();
  }
}

export function syncPwaUpdateBannerImpl(app: AppViewContext): void {
  const toast = document.getElementById('pwa-update-toast');
  if (!toast) return;

  const shouldShow = app.pwaUpdateAvailable && !app.pwaUpdateDismissedInSession;
  if (app.titleOverlayOpen) {
    const titleOverlay = document.getElementById('title-overlay');
    const crestBanner = titleOverlay?.querySelector('.title-crest-banner');
    if (titleOverlay && crestBanner && toast.previousElementSibling !== crestBanner) {
      crestBanner.after(toast);
    }
    toast.hidden = !shouldShow;
    return;
  }

  // Mount as a flush sub-header banner directly below `.top-economy-bar` on active menu screens
  // (outside `#map-mode-tabs`/`#map-mode-panel` while keeping the top app bar stationary)
  const activeSectionId = app.activeScreen === 'themes' ? 'screen-themes' : 'screen-home';
  const topBar = document.querySelector(`#${activeSectionId} > .top-economy-bar`);
  if (topBar && toast.previousElementSibling !== topBar) {
    topBar.after(toast);
  }
  const wasHidden = toast.hidden;
  const showOnMenuShell = shouldShow && app.activeScreen !== 'game';
  toast.hidden = !showOnMenuShell;
  if (wasHidden !== toast.hidden && app.activeScreen === 'themes') {
    refreshThemesPreviewIfActive(app);
  }
}

/**
 * Distinguishes genuine SW upgrades from initial first-time installation across Safari WebClips
 * and Chrome Apps even if `navigator.serviceWorker.controller` briefly booted as `null`.
 */
function hasExistingActiveController(
  reg: ServiceWorkerRegistration,
  candidateWorker: ServiceWorker
): boolean {
  const controller = typeof navigator !== 'undefined' ? (navigator.serviceWorker?.controller ?? null) : null;
  return Boolean(controller || (reg.active && reg.active !== candidateWorker));
}

/**
 * Resolves only a live `'installed'` waiting worker, preferring `reg.waiting` over cached references
 * and pruning stale `'activated'`/`'redundant'` pointers so Update clicks never post to dead workers.
 */
function resolveLiveWaitingWorker(app: AppViewContext): ServiceWorker | null {
  const regWaiting = app.swRegistration?.waiting ?? null;
  if (regWaiting && regWaiting.state === 'installed') {
    app.waitingServiceWorker = regWaiting;
    return regWaiting;
  }
  const cached = app.waitingServiceWorker;
  if (cached) {
    if (cached.state === 'installed') {
      return cached;
    }
    if (cached.state === 'activated' || cached.state === 'redundant') {
      app.waitingServiceWorker = null;
    }
  }
  return null;
}

export function checkForPwaUpdateImpl(app: AppViewContext, force = false): void {
  if (!app.titleOverlayOpen && app.activeScreen === 'game') {
    return;
  }
  const reg = app.swRegistration;
  if (reg?.waiting && reg.waiting.state === 'installed' && hasExistingActiveController(reg, reg.waiting)) {
    app.waitingServiceWorker = reg.waiting;
    app.pwaUpdateAvailable = true;
  } else if (
    app.waitingServiceWorker &&
    (app.waitingServiceWorker.state === 'activated' || app.waitingServiceWorker.state === 'redundant')
  ) {
    app.waitingServiceWorker = reg?.waiting && reg.waiting.state === 'installed' ? reg.waiting : null;
  }
  app.syncPwaUpdateBanner();

  if (!reg) return;
  const now = Date.now();
  if (!force && now - app.lastSwUpdateCheckMs < SW_UPDATE_THROTTLE_MS) {
    return;
  }
  app.lastSwUpdateCheckMs = now;
  void reg.update().catch(() => {
    // Ignore offline or restricted environment update errors
  });
}

function shouldAutoApplyWaitingWorker(app: AppViewContext): boolean {
  if (isBoardRunStarted(app.board) || app.isAnyModalOpen()) {
    return false;
  }
  const isUntouchedColdBootOnTitle =
    app.titleOverlayOpen &&
    !app.hasUserInteracted &&
    typeof performance !== 'undefined' &&
    performance.now() <= SW_COLD_BOOT_AUTO_UPDATE_WINDOW_MS;
  const isLongIdleResumeOnMenu =
    (app.titleOverlayOpen || app.activeScreen !== 'game') &&
    app.lastBackgroundedAtMs > 0 &&
    Date.now() - app.lastBackgroundedAtMs >= SW_LONG_IDLE_AUTO_UPDATE_MS;
  return isUntouchedColdBootOnTitle || isLongIdleResumeOnMenu;
}

/**
 * Binds viewport resize/zoom locks, PWA install prompts, and cross-environment Service Worker
 * update handling (`controllerchange` + `statechange === 'activated'` + stall fallback timer).
 */
export function setupPwaAndServiceWorkerImpl(app: AppViewContext, options: PwaLifecycleOptions = {}): void {
  installNativeAppZoomLock(() => app.syncViewportGeometry());
  app.syncViewportGeometry();
  app.syncInstallUiVisibility();
  app.syncPwaUpdateBanner();

  const onViewportChange = () => app.syncViewportGeometry();
  window.addEventListener('resize', onViewportChange, { passive: true });
  window.addEventListener('orientationchange', onViewportChange, { passive: true });
  window.visualViewport?.addEventListener('resize', onViewportChange, { passive: true });
  window.visualViewport?.addEventListener('scroll', onViewportChange, { passive: true });

  const markInteracted = () => {
    app.hasUserInteracted = true;
  };
  window.addEventListener('pointerdown', markInteracted, { once: true, passive: true });
  window.addEventListener('keydown', markInteracted, { once: true, passive: true });

  let refreshing = false;
  let swActivationApproved = false;
  let activationFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let activatedSettleTimer: ReturnType<typeof setTimeout> | null = null;
  const trackedWorkers = new WeakSet<ServiceWorker>();
  const activationListeningWorkers = new WeakSet<ServiceWorker>();
  const reloadPage = options.reloadPage ?? (() => window.location.reload());

  const clearReloadTimers = () => {
    if (activationFallbackTimer !== null) {
      clearTimeout(activationFallbackTimer);
      activationFallbackTimer = null;
    }
    if (activatedSettleTimer !== null) {
      clearTimeout(activatedSettleTimer);
      activatedSettleTimer = null;
    }
  };

  const performReload = () => {
    if (refreshing) return;
    refreshing = true;
    clearReloadTimers();
    reloadPage();
  };

  const trackWorkerLifecycle = (worker: ServiceWorker) => {
    if (trackedWorkers.has(worker)) return;
    trackedWorkers.add(worker);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        if (app.waitingServiceWorker === worker) {
          const nextWaiting = app.swRegistration?.waiting ?? null;
          app.waitingServiceWorker = nextWaiting?.state === 'installed' ? nextWaiting : null;
        }
      }
    });
  };

  const armFallbackReloadTimer = (delayMs: number) => {
    if (activationFallbackTimer !== null) return;
    activationFallbackTimer = setTimeout(performReload, delayMs);
  };

  const watchActivatingWorker = (worker: ServiceWorker, userInitiated: boolean) => {
    if (activationListeningWorkers.has(worker)) return;
    activationListeningWorkers.add(worker);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        // Yield briefly so a queued `controllerchange` fires first, while still reloading standalone
        // PWAs/WebClips that suppress `controllerchange`.
        if (activatedSettleTimer === null) {
          activatedSettleTimer = setTimeout(performReload, SW_ACTIVATED_SETTLE_MS);
        }
      } else if (worker.state === 'redundant') {
        if (resolveLiveWaitingWorker(app)) {
          triggerWaitingWorkerActivation(userInitiated);
        } else {
          performReload();
        }
      }
    });
  };

  const triggerWaitingWorkerActivation = (userInitiated: boolean): boolean => {
    const waitingWorker = resolveLiveWaitingWorker(app);
    if (waitingWorker) {
      swActivationApproved = true;
      watchActivatingWorker(waitingWorker, userInitiated);
      armFallbackReloadTimer(SW_ACTIVATION_RELOAD_FALLBACK_MS);
      try {
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      } catch {
        performReload();
      }
      return true;
    }

    // Handle an update clicked right after `updatefound` while the worker is still installing/activating
    const activatingOrCached =
      app.waitingServiceWorker?.state === 'activating'
        ? app.waitingServiceWorker
        : app.swRegistration?.active?.state === 'activating'
          ? app.swRegistration.active
          : null;
    if (activatingOrCached) {
      swActivationApproved = true;
      watchActivatingWorker(activatingOrCached, userInitiated);
      armFallbackReloadTimer(SW_ACTIVATION_RELOAD_FALLBACK_MS);
      return true;
    }

    const installingWorker = app.swRegistration?.installing ?? null;
    if (
      installingWorker &&
      (installingWorker.state === 'installing' || installingWorker.state === 'parsed')
    ) {
      swActivationApproved = true;
      armFallbackReloadTimer(SW_ACTIVATION_RELOAD_FALLBACK_MS * 2);
      if (!activationListeningWorkers.has(installingWorker)) {
        activationListeningWorkers.add(installingWorker);
        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed') {
            triggerWaitingWorkerActivation(userInitiated);
          } else if (installingWorker.state === 'activated' || installingWorker.state === 'redundant') {
            performReload();
          }
        });
      }
      return true;
    }

    // No live waiting worker remains (already activated in background by another tab/idle cycle or redundant)
    app.waitingServiceWorker = null;
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    const hasController = Boolean(sw?.controller || app.swRegistration?.active);
    if (typeof navigator !== 'undefined' && navigator.onLine === false && !hasController) {
      app.pwaUpdateAvailable = true;
      app.syncPwaUpdateBanner();
      app.showGameToast('Offline — reconnect to finish updating.');
      return false;
    }

    if (userInitiated || app.swRegistration || sw?.controller) {
      performReload();
      return true;
    }
    return false;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      app.lastBackgroundedAtMs = Date.now();
      return;
    }
    app.syncViewportGeometry();
    if (app.titleOverlayOpen || app.activeScreen !== 'game') {
      const hasPendingUpdate = Boolean(resolveLiveWaitingWorker(app) || app.pwaUpdateAvailable);
      if (hasPendingUpdate && shouldAutoApplyWaitingWorker(app)) {
        triggerWaitingWorkerActivation(false);
        return;
      }
      app.checkForPwaUpdate(false);
    }
  });

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    app.deferredInstallPrompt = e as BeforeInstallPromptEvent;
    app.pwaInstalledDetected = false;
    setInstalledStorageFlag(false);
    app.syncInstallUiVisibility();
  });

  window.addEventListener('appinstalled', () => {
    app.deferredInstallPrompt = null;
    app.markPwaInstalled();
    app.closeAllModals();
    app.showGameToast('✦ ShredBlocks installed to your device!');
  });

  try {
    window.matchMedia('(display-mode: standalone)').addEventListener('change', () => {
      app.syncInstallUiVisibility();
      app.syncViewportGeometry();
    });
  } catch {
    // Ignore on legacy browsers
  }

  const navWithRelated = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<Array<{ id?: string; platform?: string; url?: string }>>;
  };
  if (typeof navWithRelated.getInstalledRelatedApps === 'function') {
    void navWithRelated
      .getInstalledRelatedApps()
      .then((apps) => {
        if (Array.isArray(apps) && apps.length > 0) {
          app.markPwaInstalled();
        }
      })
      .catch(() => {
        // Ignore unsupported or cross-origin frame errors
      });
  }

  const handleWaitingWorkerReady = (worker: ServiceWorker) => {
    if (worker.state === 'redundant') return;
    if (worker.state === 'activated') {
      app.waitingServiceWorker = null;
      app.pwaUpdateAvailable = true;
      app.pwaUpdateDismissedInSession = false;
      if (shouldAutoApplyWaitingWorker(app)) {
        performReload();
        return;
      }
      app.syncPwaUpdateBanner();
      return;
    }
    trackWorkerLifecycle(worker);
    app.waitingServiceWorker = worker;
    app.pwaUpdateAvailable = true;
    app.pwaUpdateDismissedInSession = false;
    if (shouldAutoApplyWaitingWorker(app)) {
      triggerWaitingWorkerActivation(false);
      return;
    }
    app.syncPwaUpdateBanner();
  };

  if ('serviceWorker' in navigator) {
    if (typeof __SHREDBLOCKS_LAN_DEVTOOLS__ !== 'undefined' && __SHREDBLOCKS_LAN_DEVTOOLS__) {
      // Never cache shell/assets behind a Service Worker on the `:8443` LAN Vite dev server
      void navigator.serviceWorker
        .getRegistrations?.()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
      if (typeof caches !== 'undefined') {
        void caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {});
      }
      return;
    }
    let swRegistered = false;
    let lastKnownController: ServiceWorker | null = navigator.serviceWorker.controller ?? null;

    const registerSw = () => {
      if (swRegistered) return;
      swRegistered = true;
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          app.swRegistration = reg;
          app.lastSwUpdateCheckMs = Date.now();
          if (reg.waiting && hasExistingActiveController(reg, reg.waiting)) {
            handleWaitingWorkerReady(reg.waiting);
          }

          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && hasExistingActiveController(reg, newWorker)) {
                handleWaitingWorkerReady(newWorker);
              }
            });
          });
        })
        .catch(() => {
          // Ignore SW errors in restricted test environments
        });
    };

    if (document.readyState === 'complete') {
      registerSw();
    } else {
      window.addEventListener('load', registerSw, { once: true });
      // Fallback so a hanging edge-injected third-party script can never block SW registration
      window.setTimeout(registerSw, 1_200);
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const nextController = navigator.serviceWorker.controller ?? null;
      if (swActivationApproved) {
        lastKnownController = nextController;
        performReload();
        return;
      }
      if (lastKnownController === null) {
        // First-ever SW install claiming an initially uncontrolled document is not an upgrade
        lastKnownController = nextController;
        return;
      }
      if (nextController && nextController !== lastKnownController) {
        // Background controller swap (e.g., Chrome App tab close or idle wake) leaves this window
        // running stale in-memory JS/HTML, so keep/surface the Update prompt and reload immediately on tap
        lastKnownController = nextController;
        app.waitingServiceWorker = null;
        app.pwaUpdateAvailable = true;
        app.pwaUpdateDismissedInSession = false;
        if (shouldAutoApplyWaitingWorker(app)) {
          performReload();
          return;
        }
        app.syncPwaUpdateBanner();
      }
    });
  }

  const updateNowBtn = document.getElementById('btn-pwa-update-now') as HTMLButtonElement | null;
  updateNowBtn?.addEventListener('click', () => {
    app.sound.playButtonTap();
    if (updateNowBtn) updateNowBtn.disabled = true;
    app.pwaUpdateAvailable = false;
    app.syncPwaUpdateBanner();
    const activated = triggerWaitingWorkerActivation(true);
    if (!activated && updateNowBtn) {
      updateNowBtn.disabled = false;
    }
  });

  document.getElementById('btn-pwa-update-dismiss')?.addEventListener('click', () => {
    app.sound.playButtonTap();
    app.pwaUpdateDismissedInSession = true;
    app.syncPwaUpdateBanner();
  });
}
