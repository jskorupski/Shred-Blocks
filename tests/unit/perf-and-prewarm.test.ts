// @ts-expect-error Node built-in module resolved at runtime by Vitest
import fs from 'node:fs';
// @ts-expect-error Node built-in module resolved at runtime by Vitest
import path from 'node:path';
import { describe, expect, it } from 'vitest';

declare const process: { cwd: () => string };

import { playFilteredNoiseBurstVoice, prewarmSharedNoiseBuffer } from '../../src/audio/synth-voices';
import { Camera3D } from '../../src/render/camera-3d';
import { QualityGovernor } from '../../src/render/quality-governor';
import { warmUpWebGLPipelinesImpl } from '../../src/render/relic-awakening-fx';
import type { RenderPassContext } from '../../src/render/render-types';
import { prewarmDialogsLayout } from '../../src/ui/dialogs-template';
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
    expect(drawnStyles).toEqual(expect.arrayContaining([0, 4, 7, 8, 9]));
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

  it('QualityGovernor AUTO adapts cleanly to 60Hz browsers, GPU missed-vsync stalls, and LTPO modal freeze', () => {
    const gov = new QualityGovernor();
    gov.setPreference('AUTO');

    // 1. High-refresh 120Hz active play stays ULTRA_120 and preserves 120fps telemetry when Pause modal opens on LTPO
    let t = 1000;
    for (let i = 0; i < 40; i++) {
      t += 8.33;
      gov.recordRafTick(t, { isInteractiveMotion: true, isModalOpen: false, isSuspended: false });
      gov.recordFrameWork(1.4, t, false);
      gov.markFrameRendered(t, true);
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

    // 2. 60Hz-locked WebKit/Safari environment selects BALANCED_60 cleanly so DPR caps at 1.75
    const safariGov = new QualityGovernor();
    safariGov.setPreference('AUTO');
    t = 2000;
    for (let i = 0; i < 40; i++) {
      t += 16.67;
      safariGov.recordRafTick(t, { isInteractiveMotion: true, isModalOpen: false, isSuspended: false });
      safariGov.recordFrameWork(1.8, t, false);
      safariGov.markFrameRendered(t, true);
    }
    expect(safariGov.getActiveTier()).toBe('BALANCED_60');
    expect(safariGov.getTargetMaxDpr()).toBe(1.75);
    expect(safariGov.getTelemetry().displayHz).toBe(60);
    expect(safariGov.getTelemetry().fps).toBe(60);

    // 3. GPU-bound 120Hz device with tiny JS work (1.2ms) but frequent missed vsyncs (>25%) drops to BALANCED_60 cleanly
    const gpuStalledGov = new QualityGovernor();
    gpuStalledGov.setPreference('AUTO');
    t = 3000;
    for (let i = 0; i < 52; i++) {
      // Nominal 8.33ms cadence with 30% missed-vsync spikes (16.67ms) even though JS work is only 1.2ms
      t += i % 3 === 0 ? 16.67 : 8.33;
      gpuStalledGov.recordRafTick(t, { isInteractiveMotion: true, isModalOpen: false, isSuspended: false });
      gpuStalledGov.recordFrameWork(1.2, t, false);
    }
    expect(gpuStalledGov.getActiveTier()).toBe('BALANCED_60');
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

    // Open Victory dialog suspends settled 3D background rendering cleanly once forceSettle drains
    const settledVictoryDt = gov.consumeRenderStep(t + 40, 0.016, {
      canvasVisible: true,
      modalOpen: true,
      victoryOpen: true,
      hasVisualFx: true,
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
    const rafQueue: Array<(ms: number) => void> = [];

    const makeMockCtx = () => ({
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      setTransform: () => {},
      clearRect: () => {},
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
