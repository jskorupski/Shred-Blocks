import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { playFilteredNoiseBurstVoice, prewarmSharedNoiseBuffer } from '../../src/audio/synth-voices';
import { createBoardState } from '../../src/core/board';
import { getLevelSpec } from '../../src/levels/catalog';
import { Camera3D } from '../../src/render/camera-3d';
import {
  spawnBombDetonationBurstImpl,
  spawnParticlesAtImpl,
  stepParticlesImpl,
} from '../../src/render/particle-fx';
import { QualityGovernor } from '../../src/render/quality-governor';
import { warmUpWebGLPipelinesImpl } from '../../src/render/relic-awakening-fx';
import {
  INSTANCE_STRIDE,
  MAX_PARTICLES,
  MAX_SMOKE_PUFFS,
  PARTICLE_STRIDE,
  type RenderPassContext,
} from '../../src/render/render-types';
import { prewarmDialogsLayout } from '../../src/ui/dialogs-template';
import {
  BOMB_DETONATION_BEAT_MS,
  cancelPendingOutcomeTransition,
  FAILURE_SETTLE_BEAT_MS,
  flushPendingOutcomeTransition,
  isOutcomeTransitionPending,
  VICTORY_MODAL_BEAT_MS,
} from '../../src/ui/outcome-modals-view';
import {
  prewarmVictoryModalFx,
  startVictoryModalFx,
  stopVictoryModalFx,
} from '../../src/ui/victory-modal-fx';

function createMockDialog(open: boolean, ops: string[], id: string) {
  const classes = new Set<string>();
  return {
    open,
    classList: {
      add(name: string) {
        classes.add(name);
        ops.push(`${id}:add:${name}`);
      },
      remove(name: string) {
        classes.delete(name);
        ops.push(`${id}:remove:${name}`);
      },
      contains(name: string) {
        return classes.has(name);
      },
    },
    get offsetHeight() {
      ops.push(`${id}:layout:${classes.has('dialog-prewarm')}`);
      return 320;
    },
  };
}

describe('Idle Pre-Warming & Zero-Copy 120Hz Contracts', () => {
  it('primes closed dialog Top-Layer layout once without perturbing open modals', () => {
    const ops: string[] = [];
    const dialogs = new Map<string, ReturnType<typeof createMockDialog>>([
      ['dialog-victory', createMockDialog(false, ops, 'dialog-victory')],
      ['dialog-failure', createMockDialog(false, ops, 'dialog-failure')],
      ['dialog-pause', createMockDialog(true, ops, 'dialog-pause')],
      ['dialog-save-transfer', createMockDialog(false, ops, 'dialog-save-transfer')],
      ['dialog-install', createMockDialog(false, ops, 'dialog-install')],
    ]);

    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      body: {},
      getElementById: (id: string) => dialogs.get(id) ?? null,
    };

    try {
      prewarmDialogsLayout();
      for (const [id, dlg] of dialogs) {
        expect(dlg.classList.contains('dialog-prewarm')).toBe(false);
        if (id === 'dialog-pause') {
          expect(ops.some((entry) => entry.startsWith('dialog-pause:'))).toBe(false);
        } else {
          expect(ops).toContain(`${id}:add:dialog-prewarm`);
          expect(ops).toContain(`${id}:layout:true`);
          expect(ops).toContain(`${id}:remove:dialog-prewarm`);
        }
      }

      const opCountAfterFirstWarmup = ops.length;
      prewarmDialogsLayout();
      expect(ops.length).toBe(opCountAfterFirstWarmup);
    } finally {
      if (prevDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDocument;
      }
    }
  });

  it('pre-allocates #victory-fx-canvas backing store cleanly without reallocating sized surfaces', () => {
    const clearedRects: Array<[number, number, number, number]> = [];
    const canvasMock = {
      width: 0,
      height: 0,
      getContext: (kind: string) =>
        kind === '2d'
          ? {
              clearRect(x: number, y: number, w: number, h: number) {
                clearedRects.push([x, y, w, h]);
              },
            }
          : null,
    };

    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      getElementById: (id: string) => (id === 'victory-fx-canvas' ? canvasMock : null),
    };

    try {
      prewarmVictoryModalFx();
      expect(canvasMock.width).toBe(360);
      expect(canvasMock.height).toBe(420);
      expect(clearedRects).toEqual([[0, 0, 1, 1]]);

      canvasMock.width = 720;
      canvasMock.height = 840;
      prewarmVictoryModalFx();
      expect(canvasMock.width).toBe(720);
      expect(canvasMock.height).toBe(840);
    } finally {
      if (prevDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDocument;
      }
    }
  });

  it('pre-builds the shared AudioContext noise buffer once and reuses it across SFX bursts', () => {
    const createdBuffers: Array<{ sampleRate: number; length: number }> = [];
    const startedSources: Array<{ hasBuffer: boolean }> = [];
    const makeParam = () => ({
      value: 0,
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    });

    const mockCtx = {
      currentTime: 2.0,
      sampleRate: 44100,
      createBuffer: (_ch: number, len: number, sampleRate: number) => {
        createdBuffers.push({ sampleRate, length: len });
        return {
          sampleRate,
          length: len,
          getChannelData: () => new Float32Array(len),
        };
      },
      createBufferSource: () => {
        const src = {
          buffer: null as unknown,
          playbackRate: makeParam(),
          connect: () => {},
          start: () => {
            startedSources.push({ hasBuffer: Boolean(src.buffer) });
          },
          stop: () => {},
        };
        return src;
      },
      createBiquadFilter: () => ({
        type: 'bandpass',
        frequency: makeParam(),
        Q: makeParam(),
        connect: () => {},
      }),
      createGain: () => ({
        gain: makeParam(),
        connect: () => {},
      }),
    } as unknown as AudioContext;

    prewarmSharedNoiseBuffer(mockCtx);
    expect(createdBuffers).toHaveLength(1);
    expect(createdBuffers[0].length / createdBuffers[0].sampleRate).toBeGreaterThanOrEqual(0.35);

    playFilteredNoiseBurstVoice(mockCtx, {} as GainNode, 2.0, 0.12, 600, 0.2);
    expect(createdBuffers).toHaveLength(1);
    expect(startedSources).toEqual([{ hasBuffer: true }]);
  });

  it('warms overlay trace smear, special overlay styles, and additive lightning particle shaders in a 1x1 pass', () => {
    const drawnStyles: number[] = [];
    const particleStyles: number[] = [];
    const traceCounts: number[] = [];
    let scissoredRect: [number, number, number, number] | null = null;

    const uStyleLoc = { name: 'uStyle' } as unknown as WebGLUniformLocation;
    const uTraceCountLoc = { name: 'uTraceCount' } as unknown as WebGLUniformLocation;
    const uTracePtsLoc = { name: 'uTracePts' } as unknown as WebGLUniformLocation;

    const gl = {
      SCISSOR_TEST: 0x0c11,
      DEPTH_TEST: 0x0b71,
      LEQUAL: 0x0203,
      CULL_FACE: 0x0b44,
      BACK: 0x0405,
      BLEND: 0x0be2,
      SRC_ALPHA: 0x0302,
      ONE: 1,
      ONE_MINUS_SRC_ALPHA: 0x0303,
      TEXTURE0: 0x84c0,
      TEXTURE_2D: 0x0de1,
      ARRAY_BUFFER: 0x8892,
      TRIANGLES: 4,
      UNSIGNED_SHORT: 0x1403,
      enable: () => {},
      disable: () => {},
      scissor: (x: number, y: number, w: number, h: number) => {
        scissoredRect = [x, y, w, h];
      },
      colorMask: () => {},
      depthMask: () => {},
      depthFunc: () => {},
      cullFace: () => {},
      blendFuncSeparate: () => {},
      useProgram: () => {},
      uniformMatrix4fv: () => {},
      uniform1i: (loc: WebGLUniformLocation | null, v: number) => {
        if (loc === uStyleLoc) particleStyles.push(v);
        if (loc === uTraceCountLoc) traceCounts.push(v);
      },
      uniform1f: () => {},
      uniform4f: () => {},
      uniform4fv: () => {},
      activeTexture: () => {},
      bindTexture: () => {},
      bindVertexArray: () => {},
      bindBuffer: () => {},
      bufferSubData: () => {},
      drawElementsInstanced: () => {},
      flush: () => {},
    } as unknown as WebGL2RenderingContext;

    const rctx = {
      camera: new Camera3D(),
      uUseClipPlane: { name: 'uUseClipPlane' } as unknown as WebGLUniformLocation,
      uClipPlane: { name: 'uClipPlane' } as unknown as WebGLUniformLocation,
      uTraceCount: uTraceCountLoc,
      uTracePts: uTracePtsLoc,
      drawMesh: (...args: unknown[]) => {
        const style = Number(args[args.length - 1]);
        drawnStyles.push(style);
      },
      drawAtlasBadge: () => {},
    } as unknown as RenderPassContext;

    warmUpWebGLPipelinesImpl(
      rctx,
      gl,
      {} as WebGLProgram,
      {} as WebGLUniformLocation,
      {} as WebGLUniformLocation,
      {} as WebGLUniformLocation,
      {} as WebGLTexture,
      {
        program: {} as WebGLProgram,
        vao: {} as WebGLVertexArrayObject,
        instanceBuffer: {} as WebGLBuffer,
        indexCount: 36,
        uViewProj: {} as WebGLUniformLocation,
        uStyle: uStyleLoc,
        smokeVao: {} as WebGLVertexArrayObject,
        smokeInstanceBuffer: {} as WebGLBuffer,
        smokeIndexCount: 6,
      }
    );

    expect(scissoredRect).toEqual([0, 0, 1, 1]);
    expect(traceCounts).toContain(2);
    expect(drawnStyles).toEqual(expect.arrayContaining([0, 4, 7, 8, 9, 10]));
    expect(particleStyles).toEqual(expect.arrayContaining([0, 4]));
  });

  it('enforces zero-backdrop-filter overlays, throttled drag updates, and deferred victory roadmap sync', () => {
    const repoRoot = path.resolve(process.cwd());
    const dialogsCss = fs.readFileSync(path.join(repoRoot, 'src/styles/dialogs.css'), 'utf8');
    const titleCss = fs.readFileSync(path.join(repoRoot, 'src/styles/title-and-a11y.css'), 'utf8');
    const screenGameCss = fs.readFileSync(path.join(repoRoot, 'src/styles/screen-game.css'), 'utf8');
    const pointerTs = fs.readFileSync(path.join(repoRoot, 'src/input/pointer-controller.ts'), 'utf8');
    const rendererTs = fs.readFileSync(path.join(repoRoot, 'src/render/renderer-3d.ts'), 'utf8');
    const mainTs = fs.readFileSync(path.join(repoRoot, 'src/main.ts'), 'utf8');

    expect(dialogsCss).not.toContain('backdrop-filter:');
    expect(titleCss).not.toContain('backdrop-filter:');
    expect(dialogsCss).toContain('dialog.dialog-prewarm');
    expect(dialogsCss).toContain('will-change: rotate');
    expect(screenGameCss).toContain('.sacred-geometry-ornament .ornament-layer');
    expect(screenGameCss).toContain('mix-blend-mode: normal');

    expect(pointerTs).toContain('if (this.callbacks.onDragFrame) this.callbacks.onDragFrame();');
    expect(rendererTs).toContain('now - this.lastRectReadMs > 250');

    const winIdx = mainTs.indexOf('private handleLevelVictory(');
    const failIdx = mainTs.indexOf('private handleLevelFailure(', winIdx);
    expect(winIdx).toBeGreaterThan(-1);
    expect(failIdx).toBeGreaterThan(winIdx);
    const winBody = mainTs.slice(winIdx, failIdx);
    expect(winBody).not.toContain('this.renderRoadmap(');
  });

  it('QualityGovernor AUTO keeps ULTRA_120 on healthy 60Hz/LTPO phones and downgrades only on <60fps distress', () => {
    const gov = new QualityGovernor();
    gov.setPreference('AUTO');

    // 1. High-refresh 120Hz active play stays ULTRA_120 and preserves 120fps telemetry when Pause modal opens on LTPO
    let t = 1000;
    for (let i = 0; i < 40; i++) {
      t += 8.33;
      gov.recordRafTick(t, {
        isInteractiveMotion: true,
        isPointerEngaged: true,
        isModalOpen: false,
        isSuspended: false,
      });
      gov.recordFrameWork(1.4, t, false);
      gov.markFrameRendered(t, gov.didLastTickSampleCadence());
    }
    expect(gov.getActiveTier()).toBe('ULTRA_120');
    expect(gov.getTelemetry().fps).toBeGreaterThanOrEqual(115);
    expect(gov.getTelemetry().displayHz).toBe(120);

    // Simulate Android Chrome dropping rAF to 60Hz for 1.0s on finger-up while shred particles finish & user taps Settings
    for (let i = 0; i < 60; i++) {
      t += 16.67;
      gov.recordRafTick(t, {
        isInteractiveMotion: true,
        isPointerEngaged: false,
        isModalOpen: false,
        isSuspended: false,
      });
      gov.recordFrameWork(0.4, t, false);
      gov.markFrameRendered(t, gov.didLastTickSampleCadence());
    }
    expect(gov.getActiveTier()).toBe('ULTRA_120');
    expect(gov.getTelemetry().fps).toBeGreaterThanOrEqual(115);
    expect(gov.getTelemetry().displayHz).toBe(120);

    // Simulate LTPO dropping to 60Hz while Pause modal is open — active telemetry must NOT decay to 60fps
    for (let i = 0; i < 60; i++) {
      t += 16.67;
      gov.recordRafTick(t, { isInteractiveMotion: false, isModalOpen: true, isSuspended: false });
    }
    expect(gov.getTelemetry().fps).toBeGreaterThanOrEqual(115);
    expect(gov.getTelemetry().displayHz).toBe(120);

    // 2. Healthy 60Hz WebKit/Safari environment (steady 16.67ms, ~1.0ms work) keeps crisp ULTRA_120 quality at 60fps
    const safariGov = new QualityGovernor();
    safariGov.setPreference('AUTO');
    t = 3000;
    for (let i = 0; i < 45; i++) {
      t += 16.67;
      safariGov.recordRafTick(t, {
        isInteractiveMotion: true,
        isPointerEngaged: true,
        isModalOpen: false,
        isSuspended: false,
      });
      safariGov.recordFrameWork(1.0, t, false);
      safariGov.markFrameRendered(t, safariGov.didLastTickSampleCadence());
    }
    expect(safariGov.getActiveTier()).toBe('ULTRA_120');
    expect(safariGov.getTargetMaxDpr()).toBe(2.5);
    expect(safariGov.getTelemetry().displayHz).toBe(60);
    expect(safariGov.getTelemetry().fps).toBe(60);

    // 3. Genuine sub-60fps distress (>22ms frame stalls >=20% of active frames, even with tiny JS work) downgrades to BALANCED_60
    const sub60StalledGov = new QualityGovernor();
    sub60StalledGov.setPreference('AUTO');
    t = 5000;
    for (let i = 0; i < 48; i++) {
      // 33% of frames stall to 28ms (~35fps dropped 60Hz vsyncs)
      t += i % 3 === 0 ? 28.0 : 16.67;
      sub60StalledGov.recordRafTick(t, { isInteractiveMotion: true, isModalOpen: false, isSuspended: false });
      sub60StalledGov.recordFrameWork(1.2, t, false);
    }
    expect(sub60StalledGov.getActiveTier()).toBe('BALANCED_60');
    expect(sub60StalledGov.getTargetMaxDpr()).toBe(1.75);
  });

  it('BALANCED_60 paces renders on 120Hz displays, never drops 60Hz displays, and suspends behind settled modals', () => {
    const gov = new QualityGovernor();
    gov.setPreference('ULTRA_120');
    let t = 5000;
    for (let i = 0; i < 30; i++) {
      t += 8.33;
      gov.recordRafTick(t, { isInteractiveMotion: true, isModalOpen: false, isSuspended: false });
    }
    gov.setPreference('BALANCED_60');

    // First 8.33ms tick after render skips and accumulates dt, second (16.67ms) renders full 16.67ms dt
    gov.markFrameRendered(t, false);
    const skippedDt = gov.consumeRenderStep(t + 8.33, 0.00833, {
      canvasVisible: true,
      modalOpen: false,
      victoryOpen: false,
      hasVisualFx: true,
      forceSettle: false,
    });
    expect(skippedDt).toBe(0);

    const paintedDt = gov.consumeRenderStep(t + 16.67, 0.00834, {
      canvasVisible: true,
      modalOpen: false,
      victoryOpen: false,
      hasVisualFx: true,
      forceSettle: false,
    });
    expect(paintedDt).toBeCloseTo(0.01667, 4);

    // OUTCOME-TRANSITION-01: airborne FX behind an open modal keep stepping until dissolved, then sleep at 0fps
    const dissolvingVictoryDt = gov.consumeRenderStep(t + 40, 0.016, {
      canvasVisible: true,
      modalOpen: true,
      hasVisualFx: true,
      forceSettle: false,
    });
    expect(dissolvingVictoryDt).toBeCloseTo(0.016, 4);
    gov.markFrameRendered(t + 40, false);

    const settledVictoryDt = gov.consumeRenderStep(t + 60, 0.016, {
      canvasVisible: true,
      modalOpen: true,
      hasVisualFx: false,
      forceSettle: false,
    });
    expect(settledVictoryDt).toBe(0);

    // On a 60Hz display under BALANCED_60, never drop any 16.67ms frame even with 1ms jitter
    const gov60 = new QualityGovernor();
    let t60 = 1000;
    for (let i = 0; i < 30; i++) {
      t60 += 16.67;
      gov60.recordRafTick(t60, { isInteractiveMotion: true, isModalOpen: false, isSuspended: false });
    }
    gov60.setPreference('BALANCED_60');
    gov60.markFrameRendered(t60, false);
    const jitter60Dt = gov60.consumeRenderStep(t60 + 15.2, 0.0152, {
      canvasVisible: true,
      modalOpen: false,
      victoryOpen: false,
      hasVisualFx: false,
      forceSettle: false,
    });
    expect(jitter60Dt).toBeCloseTo(0.0152, 4);
  });

  it('startVictoryModalFx executes zero per-frame CanvasGradient or save/restore allocations', () => {
    let gradientAllocations = 0;
    let saveCalls = 0;
    let restoreCalls = 0;
    let drawImageCalls = 0;
    let clearRectCalls = 0;
    const rafQueue: Array<(ms: number) => void> = [];

    const makeMockCtx = () => ({
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      setTransform: () => {},
      clearRect: () => {
        clearRectCalls++;
      },
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      fillRect: () => {},
      drawImage: () => {
        drawImageCalls++;
      },
      save: () => {
        saveCalls++;
      },
      restore: () => {
        restoreCalls++;
      },
      createLinearGradient: () => {
        gradientAllocations++;
        return { addColorStop: () => {} };
      },
    });

    const createCanvasMock = () => ({
      width: 360,
      height: 420,
      dataset: {} as Record<string, string>,
      getContext: () => makeMockCtx(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 420 }),
    });

    const fxCanvas = createCanvasMock();
    const cardMock = {
      clientWidth: 360,
      clientHeight: 420,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 420 }),
    };
    const dialogMock = {
      open: true,
      querySelector: (sel: string) => (sel === '.victory-dialog-card' ? cardMock : null),
    };

    const prevWindow = (globalThis as { window?: unknown }).window;
    const prevDocument = (globalThis as { document?: unknown }).document;
    const prevRaf = globalThis.requestAnimationFrame;
    const prevCancelRaf = globalThis.cancelAnimationFrame;

    (globalThis as { window?: unknown }).window = { devicePixelRatio: 2 };
    (globalThis as { document?: unknown }).document = {
      body: { classList: { contains: () => false } },
      createElement: () => createCanvasMock(),
      getElementById: (id: string) => {
        if (id === 'dialog-victory') return dialogMock;
        if (id === 'victory-fx-canvas') return fxCanvas;
        if (id === 'victory-crest-ornament') {
          return { getBoundingClientRect: () => ({ left: 154, top: 16, width: 52, height: 52 }) };
        }
        return null;
      },
    };
    globalThis.requestAnimationFrame = ((cb: (ms: number) => void) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

    try {
      startVictoryModalFx({
        isUnderPar: true,
        earnedStars: 3,
        equippedParticle: 'pixel_sparks',
        reducedMotion: false,
        frozen: false,
        activeTier: 'ULTRA_120',
      });
      // Two gradients pre-baked once into static sunburst sprite
      const preBakeGradients = gradientAllocations;
      expect(preBakeGradients).toBe(2);

      // Step 20 animated frames across spark bursts + rotating under-par sunburst
      for (let f = 0; f < 20; f++) {
        const cb = rafQueue.shift();
        if (cb) cb(1000 + f * 16.67);
      }

      expect(drawImageCalls).toBeGreaterThanOrEqual(15);
      expect(gradientAllocations).toBe(preBakeGradients);
      expect(saveCalls).toBe(0);
      expect(restoreCalls).toBe(0);

      const repoRoot = path.resolve(process.cwd());
      const outcomeTs = fs.readFileSync(path.join(repoRoot, 'src/ui/outcome-modals-view.ts'), 'utf8');
      expect(outcomeTs).not.toContain('spawnVictoryCelebrationBurst');

      stopVictoryModalFx();

      // Verify 60Hz BALANCED_60 never drops a jittered 12.2ms tick, while 120Hz (8.33ms) BALANCED_60 halves to 60fps
      rafQueue.length = 0;
      startVictoryModalFx({
        isUnderPar: false,
        earnedStars: 3,
        equippedParticle: 'pixel_sparks',
        reducedMotion: false,
        frozen: false,
        activeTier: 'BALANCED_60',
      });
      clearRectCalls = 0;
      rafQueue.shift()?.(2000);
      rafQueue.shift()?.(2012.2);
      expect(clearRectCalls).toBe(2);
      rafQueue.shift()?.(2020.53); // +8.33ms (<10.5ms high-rate tick): skipped
      expect(clearRectCalls).toBe(2);
      rafQueue.shift()?.(2028.86); // +16.66ms since last paint: rendered
      expect(clearRectCalls).toBe(3);
      stopVictoryModalFx();
    } finally {
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = prevWindow;
      if (prevDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = prevDocument;
      globalThis.requestAnimationFrame = prevRaf;
      globalThis.cancelAnimationFrame = prevCancelRaf;
    }
  });

  it('OUTCOME-TRANSITION-01: accelerates particle age decay 1.8x at 1.0x velocity, spawns 3D bomb bursts, and normalizes 0.935x card scale', () => {
    expect(VICTORY_MODAL_BEAT_MS).toBe(290);
    expect(FAILURE_SETTLE_BEAT_MS).toBe(220);
    expect(BOMB_DETONATION_BEAT_MS).toBe(350);
    expect(isOutcomeTransitionPending()).toBe(false);
    cancelPendingOutcomeTransition();
    flushPendingOutcomeTransition();

    const makeMockParticleRctx = (fxDecayMul = 1.0, reducedMotion = false): RenderPassContext => {
      const gov = new QualityGovernor();
      const ctx = {
        canvas: {} as HTMLCanvasElement,
        camera: new Camera3D(),
        qualityGovernor: gov,
        gl: null,
        ctx2d: null,
        uUseClipPlane: null,
        uBlockSeed: null,
        uClipPlane: null,
        uCapColor: null,
        uTraceCount: null,
        uTracePts: null,
        particlePool: new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE),
        particleInstanceData: new Float32Array(MAX_PARTICLES * INSTANCE_STRIDE),
        activeParticleCount: 0,
        hasGameplayParticles: false,
        smokeInstanceData: new Float32Array(MAX_SMOKE_PUFFS * INSTANCE_STRIDE),
        activeSmokeCount: 0,
        particlePoolCount: 0,
        particleWriteCursor: 0,
        lastBoardLevelId: 1,
        lastSessionShredded: 0,
        lastMovesCommitted: 0,
        blockLayerSnapshots: new Map(),
        crateSnapshots: new Map(),
        gateSnapshots: new Map(),
        elevatorSnapshots: new Map(),
        barrierSnapshots: new Map(),
        roomAwakenMap: new Map(),
        activeVisualShreds: [],
        activeShockwaves: [],
        activeGateBursts: [],
        activePathTraces: [],
        blockBounceMap: new Map(),
        boardShakeTimer: 0,
        boardShakeDirX: 0,
        boardShakeDirY: 0,
        ambientMoteAccumSec: 0,
        lastOptions: { fxDecayMul, reducedMotion, equippedParticle: 'micro_cubes' },
        getColorRgb: () => [0.9, 0.25, 0.25] as [number, number, number],
        spawnParticlesAt: (...args: Parameters<RenderPassContext['spawnParticlesAt']>) =>
          spawnParticlesAtImpl(ctx, ...args),
        spawnShockwave: (
          cx: number,
          cy: number,
          z: number,
          r: number,
          g: number,
          b: number,
          minRadius = 0.28,
          maxRadius = 1.65,
          maxAge = 0.42
        ) => {
          if (ctx.lastOptions.reducedMotion) return;
          ctx.activeShockwaves.push({ cx, cy, z, r, g, b, age: 0.001, maxAge, minRadius, maxRadius });
        },
        spawnPathTrace: () => {},
      } as unknown as RenderPassContext;
      return ctx;
    };

    // 1. Compare 1.0x vs 1.8x fxDecayMul: age advances 1.8x faster while physical displacement stays natural
    const ctxNormal = makeMockParticleRctx(1.0, false);
    const ctxDissolve = makeMockParticleRctx(1.8, false);
    ctxNormal.particlePool[0] = 2.0;
    ctxNormal.particlePool[3] = 4.0; // vx = 4.0
    ctxNormal.particlePool[9] = 0.1; // gameplay cube scale
    ctxNormal.particlePool[10] = 0.1; // initial age
    ctxNormal.particlePool[11] = 1.0; // maxAge
    ctxNormal.particlePoolCount = 1;

    ctxDissolve.particlePool.set(ctxNormal.particlePool);
    ctxDissolve.particlePoolCount = 1;

    stepParticlesImpl(ctxNormal, 0.02);
    stepParticlesImpl(ctxDissolve, 0.02);

    expect(ctxDissolve.particlePool[0]).toBeCloseTo(ctxNormal.particlePool[0], 5);
    expect(ctxNormal.particlePool[10]).toBeCloseTo(0.12, 5);
    expect(ctxDissolve.particlePool[10]).toBeCloseTo(0.136, 5);

    // 2. Bomb detonation burst spawns shockwaves, particles, bounce, and recoil (and stationary seal under reducedMotion)
    const bombBoard = createBoardState(getLevelSpec(1));
    bombBoard.blocks[0].bombMax = 6;
    bombBoard.blocks[0].bombCount = 0;

    const ctxBomb = makeMockParticleRctx(1.0, false);
    spawnBombDetonationBurstImpl(ctxBomb, bombBoard);
    expect(ctxBomb.activeShockwaves.length).toBe(2);
    expect(ctxBomb.particlePoolCount).toBeGreaterThan(20);
    expect(ctxBomb.boardShakeTimer).toBeCloseTo(0.24, 5);
    expect(ctxBomb.blockBounceMap.get(bombBoard.blocks[0].id)).toBeCloseTo(0.38, 5);

    const ctxBombReduced = makeMockParticleRctx(1.0, true);
    spawnBombDetonationBurstImpl(ctxBombReduced, bombBoard);
    expect(ctxBombReduced.activeShockwaves.length).toBe(0);
    expect(ctxBombReduced.particlePoolCount).toBe(0);
    expect(ctxBombReduced.boardShakeTimer).toBe(0);
    expect(ctxBombReduced.activeGateBursts.length).toBe(1);
    expect(ctxBombReduced.activeGateBursts[0]?.mode).toBe('REDUCED_MOTION_SEAL');

    // 3. Frame-0 `scale: 0.96` entrance on `.victory-dialog-card` still sizes #victory-fx-canvas to 1.0x layout width
    const fxCanvas = {
      width: 0,
      height: 0,
      dataset: {} as Record<string, string>,
      getContext: () => ({
        clearRect: () => {},
        setTransform: () => {},
        drawImage: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
      }),
    };
    const prevWindow = (globalThis as { window?: unknown }).window;
    const prevDocument = (globalThis as { document?: unknown }).document;
    const prevRaf = globalThis.requestAnimationFrame;
    const prevCancelRaf = globalThis.cancelAnimationFrame;
    (globalThis as { window?: unknown }).window = { devicePixelRatio: 2 };
    (globalThis as { document?: unknown }).document = {
      body: { classList: { contains: () => false } },
      createElement: () => fxCanvas,
      getElementById: (id: string) => {
        if (id === 'dialog-victory') {
          return {
            open: true,
            querySelector: () => ({
              clientWidth: 400,
              clientHeight: 440,
              getBoundingClientRect: () => ({ left: 8, top: 8, width: 384, height: 422.4 }),
            }),
          };
        }
        if (id === 'victory-fx-canvas') return fxCanvas;
        return null;
      },
    };
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    try {
      startVictoryModalFx({
        isUnderPar: false,
        earnedStars: 3,
        equippedParticle: 'micro_cubes',
        reducedMotion: false,
        frozen: false,
        activeTier: 'ULTRA_120',
      });
      expect(fxCanvas.width).toBe(800);
      expect(fxCanvas.height).toBe(880);
      stopVictoryModalFx();
    } finally {
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = prevWindow;
      if (prevDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = prevDocument;
      globalThis.requestAnimationFrame = prevRaf;
      globalThis.cancelAnimationFrame = prevCancelRaf;
    }
  });
});
