import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoardState } from '../../src/core/board';
import { getLevelSpec } from '../../src/levels/catalog';
import type { AppViewContext } from '../../src/ui/catalog-meta';
import {
  checkForPwaUpdateImpl,
  SW_ACTIVATED_SETTLE_MS,
  SW_ACTIVATION_RELOAD_FALLBACK_MS,
  setupPwaAndServiceWorkerImpl,
  syncPwaUpdateBannerImpl,
} from '../../src/ui/pwa-update-lifecycle';

class MockWorker extends EventTarget {
  public state: ServiceWorkerState;
  public postedMessages: unknown[] = [];

  constructor(initialState: ServiceWorkerState) {
    super();
    this.state = initialState;
  }

  public postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  public transitionTo(nextState: ServiceWorkerState): void {
    this.state = nextState;
    this.dispatchEvent(new Event('statechange'));
  }
}

class MockRegistration extends EventTarget {
  public installing: MockWorker | null = null;
  public waiting: MockWorker | null = null;
  public active: MockWorker | null = null;
  public update = vi.fn(() => Promise.resolve());
}

class MockButton extends EventTarget {
  public hidden = false;
  public disabled = false;
}

class MockBannerElement {
  public hidden = true;
  public previousElementSibling: unknown = null;
}

interface PwaTestHarness {
  app: AppViewContext;
  swContainer: EventTarget & {
    controller: MockWorker | null;
    register: ReturnType<typeof vi.fn>;
  };
  registration: MockRegistration;
  updateBtn: MockButton;
  dismissBtn: MockButton;
  toastEl: MockBannerElement;
  reloadSpy: ReturnType<typeof vi.fn>;
  docTarget: EventTarget & {
    hidden: boolean;
    visibilityState: DocumentVisibilityState;
  };
  navigatorState: { onLine: boolean };
  toastMessages: string[];
  flushMicrotasks: () => Promise<void>;
}

function createPwaTestHarness(initialController: MockWorker | null = null): PwaTestHarness {
  const registration = new MockRegistration();
  if (initialController) registration.active = initialController;

  const swTarget = new EventTarget();
  const swContainer = Object.assign(swTarget, {
    controller: initialController,
    register: vi.fn((_url: string, _opts?: RegistrationOptions) =>
      Promise.resolve(registration as unknown as ServiceWorkerRegistration)
    ),
  });

  const navigatorState = { onLine: true };
  const fakeNavigator = {
    serviceWorker: swContainer,
    get onLine() {
      return navigatorState.onLine;
    },
  };

  const toastEl = new MockBannerElement();
  const updateBtn = new MockButton();
  const dismissBtn = new MockButton();
  const topBarSentinel = {
    after: vi.fn(() => {
      toastEl.previousElementSibling = topBarSentinel;
    }),
  };

  const winTarget = new EventTarget();
  const fakeWindow = Object.assign(winTarget, {
    innerHeight: 800,
    screen: { height: 800, availHeight: 800 },
    navigator: fakeNavigator,
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    scrollTo: vi.fn(),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });

  const docTarget = Object.assign(new EventTarget(), {
    hidden: false,
    visibilityState: 'visible' as DocumentVisibilityState,
    readyState: 'complete' as DocumentReadyState,
    referrer: '',
    documentElement: { clientHeight: 800, style: { setProperty: vi.fn() } },
    getElementById: (id: string) => {
      if (id === 'pwa-update-toast') return toastEl;
      if (id === 'btn-pwa-update-now') return updateBtn;
      if (id === 'btn-pwa-update-dismiss') return dismissBtn;
      return null;
    },
    querySelector: (selector: string) => {
      if (selector.includes('.top-economy-bar') || selector.includes('.title-crest-banner')) {
        return topBarSentinel;
      }
      return null;
    },
  });

  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', docTarget);
  vi.stubGlobal('navigator', fakeNavigator);
  vi.stubGlobal('performance', { now: () => 5_000 });

  const reloadSpy = vi.fn();
  const toastMessages: string[] = [];

  const app = {
    board: createBoardState(getLevelSpec(1)),
    boardPlayMode: 'CHALLENGE',
    activeScreen: 'home',
    titleOverlayOpen: false,
    swRegistration: null,
    waitingServiceWorker: null,
    pwaUpdateAvailable: false,
    pwaUpdateDismissedInSession: false,
    lastSwUpdateCheckMs: 0,
    lastBackgroundedAtMs: 0,
    hasUserInteracted: true,
    deferredInstallPrompt: null,
    pwaInstalledDetected: false,
    sound: { playButtonTap: vi.fn() },
    renderer: { resize: vi.fn() },
    isAnyModalOpen: () => false,
    isPwaInstalled: () => false,
    markPwaInstalled: vi.fn(),
    closeAllModals: vi.fn(),
    showGameToast: (msg: string) => {
      toastMessages.push(msg);
    },
    syncInstallUiVisibility: vi.fn(),
    syncViewportGeometry: vi.fn(),
    syncPwaUpdateBanner: () => syncPwaUpdateBannerImpl(app),
    checkForPwaUpdate: (force = false) => checkForPwaUpdateImpl(app, force),
  } as unknown as AppViewContext;

  setupPwaAndServiceWorkerImpl(app, { reloadPage: reloadSpy });

  return {
    app,
    swContainer,
    registration,
    updateBtn,
    dismissBtn,
    toastEl,
    reloadSpy,
    docTarget,
    navigatorState,
    toastMessages,
    flushMicrotasks: async () => {
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('PWA Update Lifecycle Across Installation Environments (PWA-UPDATE-01)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('registers /sw.js with updateViaCache: "none" and activates live waiting worker cleanly via SKIP_WAITING -> controllerchange', async () => {
    const swV1 = new MockWorker('activated');
    const swV2 = new MockWorker('installed');
    const env = createPwaTestHarness(swV1);
    env.registration.waiting = swV2;
    await env.flushMicrotasks();

    expect(env.swContainer.register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
    expect(env.app.pwaUpdateAvailable).toBe(true);
    expect(env.toastEl.hidden).toBe(false);

    env.updateBtn.dispatchEvent(new Event('click'));
    expect(swV2.postedMessages).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(env.reloadSpy).not.toHaveBeenCalled();

    // New worker takes control -> exactly one reload
    env.swContainer.controller = swV2;
    swV2.transitionTo('activated');
    env.swContainer.dispatchEvent(new Event('controllerchange'));
    env.swContainer.dispatchEvent(new Event('controllerchange'));
    expect(env.reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('macOS Chrome App regression: reloads immediately when cached waitingServiceWorker already activated in background and reg.waiting is null', async () => {
    const swV1 = new MockWorker('activated');
    const swV2 = new MockWorker('installed');
    const env = createPwaTestHarness(swV1);
    env.registration.waiting = swV2;
    await env.flushMicrotasks();
    expect(env.app.pwaUpdateAvailable).toBe(true);
    expect(env.toastEl.hidden).toBe(false);

    // Another Chrome window or idle promotion activates swV2 while swActivationApproved === false
    env.registration.waiting = null;
    env.registration.active = swV2;
    env.swContainer.controller = swV2;
    swV2.transitionTo('activated');
    env.swContainer.dispatchEvent(new Event('controllerchange'));

    // Stale window has NOT reloaded yet, so the banner must remain visible without a stale worker handle
    expect(env.reloadSpy).not.toHaveBeenCalled();
    expect(env.app.pwaUpdateAvailable).toBe(true);
    expect(env.toastEl.hidden).toBe(false);
    expect(env.app.waitingServiceWorker).toBeNull();

    // Even if waitingServiceWorker somehow still held the activated reference, clicking Update must reload immediately
    env.app.waitingServiceWorker = swV2 as unknown as ServiceWorker;
    env.updateBtn.dispatchEvent(new Event('click'));
    expect(swV2.postedMessages).toEqual([]);
    expect(env.reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('promotes a newer live reg.waiting worker when cached waitingServiceWorker became redundant', async () => {
    const swV1 = new MockWorker('activated');
    const swV2 = new MockWorker('installed');
    const swV3 = new MockWorker('installed');
    const env = createPwaTestHarness(swV1);
    env.registration.waiting = swV2;
    await env.flushMicrotasks();

    // Deploy v3 supersedes waiting v2 before the user clicks Update
    swV2.transitionTo('redundant');
    env.registration.waiting = swV3;

    env.updateBtn.dispatchEvent(new Event('click'));
    expect(swV2.postedMessages).toEqual([]);
    expect(swV3.postedMessages).toEqual([{ type: 'SKIP_WAITING' }]);

    env.swContainer.controller = swV3;
    env.swContainer.dispatchEvent(new Event('controllerchange'));
    expect(env.reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads via statechange === "activated" settle timer and 1,500ms stall fallback when controllerchange never fires', async () => {
    vi.useFakeTimers();

    // Case A: worker activates cleanly but host suppresses controllerchange
    const swV1 = new MockWorker('activated');
    const swV2 = new MockWorker('installed');
    const envA = createPwaTestHarness(swV1);
    envA.registration.waiting = swV2;
    await envA.flushMicrotasks();

    envA.updateBtn.dispatchEvent(new Event('click'));
    expect(envA.reloadSpy).not.toHaveBeenCalled();
    swV2.transitionTo('activated');
    vi.advanceTimersByTime(SW_ACTIVATED_SETTLE_MS);
    expect(envA.reloadSpy).toHaveBeenCalledTimes(1);

    // Case B: hung Chromium SKIP_WAITING due to lingering background fetch -> fallback timer reloads
    const swB1 = new MockWorker('activated');
    const swB2 = new MockWorker('installed');
    const envB = createPwaTestHarness(swB1);
    envB.registration.waiting = swB2;
    await envB.flushMicrotasks();

    envB.updateBtn.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(SW_ACTIVATION_RELOAD_FALLBACK_MS - 10);
    expect(envB.reloadSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(envB.reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('distinguishes first-time install claim from background upgrades and handles Safari WebClip controller === null updates', async () => {
    // 1. Brand-new first install (controller null -> swV1 claim) must never trigger update banner or reload
    const env = createPwaTestHarness(null);
    await env.flushMicrotasks();
    const swV1 = new MockWorker('installed');
    env.registration.installing = swV1;
    env.registration.dispatchEvent(new Event('updatefound'));
    swV1.transitionTo('installed');
    expect(env.app.pwaUpdateAvailable).toBe(false);

    env.registration.installing = null;
    env.registration.active = swV1;
    swV1.transitionTo('activated');
    env.swContainer.controller = swV1;
    env.swContainer.dispatchEvent(new Event('controllerchange'));
    expect(env.app.pwaUpdateAvailable).toBe(false);
    expect(env.reloadSpy).not.toHaveBeenCalled();

    // 2. Background controller swap (swV1 -> swV2) sets pwaUpdateAvailable without interrupting gameplay
    env.app.activeScreen = 'game';
    const swV2 = new MockWorker('activated');
    env.swContainer.controller = swV2;
    env.registration.active = swV2;
    env.swContainer.dispatchEvent(new Event('controllerchange'));
    expect(env.app.pwaUpdateAvailable).toBe(true);
    expect(env.reloadSpy).not.toHaveBeenCalled();

    // 3. Un-claimed update edge case (iOS WebClip): controller transiently null while reg.active === swV2 and waiting === swV3
    env.app.pwaUpdateAvailable = false;
    env.app.activeScreen = 'home';
    env.swContainer.controller = null;
    const swV3 = new MockWorker('installed');
    env.registration.waiting = swV3;
    env.app.checkForPwaUpdate(false);
    expect(env.app.pwaUpdateAvailable).toBe(true);
    expect(env.app.waitingServiceWorker).toBe(swV3);
  });

  it('guards uncontrolled offline devices cleanly instead of reloading into a browser offline error', async () => {
    const env = createPwaTestHarness(null);
    await env.flushMicrotasks();
    env.navigatorState.onLine = false;
    env.app.pwaUpdateAvailable = true;
    env.app.syncPwaUpdateBanner();

    env.updateBtn.dispatchEvent(new Event('click'));
    expect(env.reloadSpy).not.toHaveBeenCalled();
    expect(env.updateBtn.disabled).toBe(false);
    expect(env.toastMessages[0]).toContain('Offline');
  });
});
