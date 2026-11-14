// @ts-expect-error Node built-in module resolved at runtime by Vitest
import fs from 'node:fs';
// @ts-expect-error Node built-in module resolved at runtime by Vitest
import path from 'node:path';
import { describe, expect, it } from 'vitest';

declare const process: { cwd: () => string };

import { playFilteredNoiseBurstVoice, prewarmSharedNoiseBuffer } from '../../src/audio/synth-voices';
import { Camera3D } from '../../src/render/camera-3d';
import { warmUpWebGLPipelinesImpl } from '../../src/render/relic-awakening-fx';
import type { RenderPassContext } from '../../src/render/render-types';
import { prewarmDialogsLayout } from '../../src/ui/dialogs-template';
import { prewarmVictoryModalFx } from '../../src/ui/victory-modal-fx';

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
});
