import { describe, expect, it } from 'vitest';
import { createBoardState } from '../../src/core/board';
import { getLevelSpec } from '../../src/levels/catalog';
import { Camera3D } from '../../src/render/camera-3d';
import {
  createGlProgramState,
  disposeGlProgramState,
  drawMeshInstancedWithStateCache,
  drawMeshWithStateCache,
  MESH_INSTANCE_STRIDE,
  setClipPlaneStateImpl,
  syncFrameProgramState,
} from '../../src/render/gl-program-state';
import { ENVIRONMENT_MESHES } from '../../src/render/mesh-generator';
import { getRoomVisualStateImpl } from '../../src/render/particle-fx';
import { getOrBuildStaticPass1Topology } from '../../src/render/pass1-board-cache';
import { renderPass1Courtyard } from '../../src/render/pass1-courtyard';
import { renderPass1WallsAndGates } from '../../src/render/pass1-gates-barriers';
import { warmUpWebGLPipelinesImpl } from '../../src/render/relic-awakening-fx';
import { type GLMeshHandle, type RenderPassContext, TRAY_PALETTES } from '../../src/render/render-types';
import {
  MAIN_FRAGMENT_SHADER,
  MAIN_VERTEX_SHADER,
  SOLID_OPAQUE_FRAGMENT_SHADER,
  SOLID_OPAQUE_VERTEX_SHADER,
} from '../../src/render/shaders-3d';

function createMockGl() {
  const counts = {
    useProgram: 0,
    bindVertexArray: 0,
    drawElements: 0,
    drawElementsInstanced: 0,
    uniform1i: 0,
    uniform1f: 0,
    uniform4f: 0,
    deletedPrograms: 0,
    deletedVaos: 0,
    deletedBuffers: 0,
  };
  const programsUsed: unknown[] = [];
  const blendStates: boolean[] = [];
  const noop = () => {};
  const gl = {
    BLEND: 0x0be2,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    TRIANGLES: 4,
    UNSIGNED_SHORT: 0x1403,
    isContextLost: () => false,
    enable: (cap: number) => {
      if (cap === 0x0be2) blendStates.push(true);
    },
    disable: (cap: number) => {
      if (cap === 0x0be2) blendStates.push(false);
    },
    useProgram: (p: unknown) => {
      counts.useProgram++;
      programsUsed.push(p);
    },
    bindVertexArray: () => {
      counts.bindVertexArray++;
    },
    drawElements: () => {
      counts.drawElements++;
    },
    drawElementsInstanced: () => {
      counts.drawElementsInstanced++;
    },
    uniform1i: () => {
      counts.uniform1i++;
    },
    uniform1f: () => {
      counts.uniform1f++;
    },
    uniform4f: () => {
      counts.uniform4f++;
    },
    uniform3f: noop,
    uniformMatrix4fv: noop,
    bindBuffer: noop,
    bufferData: noop,
    bufferSubData: noop,
    enableVertexAttribArray: noop,
    vertexAttribPointer: noop,
    vertexAttribDivisor: noop,
    createVertexArray: () => ({ id: 'instVao' }),
    createBuffer: () => ({ id: 'instBuf' }),
    deleteProgram: () => {
      counts.deletedPrograms++;
    },
    deleteVertexArray: () => {
      counts.deletedVaos++;
    },
    deleteBuffer: () => {
      counts.deletedBuffers++;
    },
    getUniformLocation: (prog: unknown, name: string) => ({ prog, name }),
  } as unknown as WebGL2RenderingContext;
  return { gl, counts, programsUsed, blendStates };
}

describe('Mobile GPU Pipeline, Zero-Discard Solid Shader & Pass 1 Instancing (PERF-GPU-01)', () => {
  it('SOLID_OPAQUE shaders contain zero discard, zero Voronoi/trace bloat, and share exact flat v_color instancing', () => {
    // Hardware Adreno/Mali LRZ Early-Z requires zero `discard` tokens anywhere in the solid fragment shader
    expect(SOLID_OPAQUE_FRAGMENT_SHADER).not.toMatch(/\bdiscard\b/);
    expect(SOLID_OPAQUE_FRAGMENT_SHADER).not.toContain('voronoiRock');
    expect(SOLID_OPAQUE_FRAGMENT_SHADER).not.toContain('u_tracePts');
    expect(SOLID_OPAQUE_FRAGMENT_SHADER).not.toContain('u_atlas');
    expect(SOLID_OPAQUE_FRAGMENT_SHADER).not.toContain('u_relicClusterTex');
    expect(SOLID_OPAQUE_FRAGMENT_SHADER).toContain('flat in vec4 v_color;');
    expect(SOLID_OPAQUE_FRAGMENT_SHADER).toContain('NEON-CYBER-01');
    expect(SOLID_OPAQUE_FRAGMENT_SHADER).toContain('WOOD-GRAIN-01');
    expect(SOLID_OPAQUE_FRAGMENT_SHADER).toContain('BLOCK-STONE-01');
    expect(SOLID_OPAQUE_FRAGMENT_SHADER).toContain('applyTrayMaterial(');

    // Vertex shaders expose locations 3..5 (`a_instTranslate`, `a_instScale`, `a_instColor`) + `flat out vec4 v_color`
    for (const vs of [MAIN_VERTEX_SHADER, SOLID_OPAQUE_VERTEX_SHADER]) {
      expect(vs).toContain('layout(location = 3) in vec3 a_instTranslate;');
      expect(vs).toContain('layout(location = 4) in vec3 a_instScale;');
      expect(vs).toContain('layout(location = 5) in vec3 a_instColor;');
      expect(vs).toContain('flat out vec4 v_color;');
    }
    expect(SOLID_OPAQUE_VERTEX_SHADER).not.toContain('rotateRelicVec');
    expect(MAIN_FRAGMENT_SHADER).toContain('flat in vec4 v_color;');
    expect(MAIN_FRAGMENT_SHADER).not.toContain('u_color');
  });

  it('GlProgramState routes opaque gameplay to solidProgram, caches VAO/uniforms, and guards clip-plane switches', () => {
    const { gl, counts, programsUsed, blendStates } = createMockGl();
    const mainProg = { id: 'main' } as unknown as WebGLProgram;
    const solidProg = { id: 'solid' } as unknown as WebGLProgram;
    const state = createGlProgramState(gl, mainProg, solidProg);

    syncFrameProgramState(state, new Float32Array(16), 3, 3, 1.5, 1, 1, 1, 0, 0, 0, 0, 0);

    const meshHandle: GLMeshHandle = {
      vao: { id: 'cubeVao' } as unknown as WebGLVertexArrayObject,
      posBuffer: {} as WebGLBuffer,
      normBuffer: {} as WebGLBuffer,
      uvBuffer: {} as WebGLBuffer,
      indexBuffer: {} as WebGLBuffer,
      indexCount: 36,
    };

    // 10 consecutive opaque draws of the same mesh & style must bind solidProgram ONCE and VAO ONCE
    for (let i = 0; i < 10; i++) {
      drawMeshWithStateCache(gl, state, meshHandle, i, 0, 0, 1, 1, 1, 0.8, 0.4, 0.2, 1.0, 0, 0, 0, null);
    }
    expect(counts.drawElements).toBe(10);
    expect(counts.useProgram).toBe(1);
    expect(programsUsed[0]).toBe(solidProg);
    expect(counts.bindVertexArray).toBe(1);
    expect(blendStates[blendStates.length - 1]).toBe(false);
    // Repeated identical style/rot/uv/seed uploads must be deduplicated after the first draw
    expect(counts.uniform1i).toBeLessThanOrEqual(4); // uTrayMaterial + uHighContrast + uMaterialStyle once

    // Setting clip-plane OFF when already OFF must be a 0-GL-call no-op
    const u1iBefore = counts.uniform1i;
    const upBefore = counts.useProgram;
    setClipPlaneStateImpl(gl, state, false);
    expect(counts.uniform1i).toBe(u1iBefore);
    expect(counts.useProgram).toBe(upBefore);

    // Enabling clip-plane switches to mainProgram and forces opaque draws onto mainProgram until disabled
    setClipPlaneStateImpl(gl, state, true, 1, 0, 0, 0.2, 0.5, 0.2, 0.1);
    expect(programsUsed[programsUsed.length - 1]).toBe(mainProg);
    drawMeshWithStateCache(gl, state, meshHandle, 0, 0, 0, 1, 1, 1, 0.8, 0.4, 0.2, 1.0, 0, 0, 0, null);
    expect(programsUsed[programsUsed.length - 1]).toBe(mainProg);
    setClipPlaneStateImpl(gl, state, false);

    // Instanced batch draws all instances in a single drawElementsInstanced on solidProgram
    const instData = new Float32Array(25 * MESH_INSTANCE_STRIDE);
    drawMeshInstancedWithStateCache(
      gl,
      state,
      ENVIRONMENT_MESHES.trayFloorTile,
      meshHandle,
      instData,
      25,
      1.0,
      5
    );
    expect(counts.drawElementsInstanced).toBe(1);
    expect(programsUsed[programsUsed.length - 1]).toBe(solidProg);

    // Title mode (`blueprintMix = 1.0`) must keep opaque instanced batches on mainProgram
    syncFrameProgramState(state, new Float32Array(16), 3, 3, 1.5, 1, 1, 1, 0, 0, 1.0, 0, 0);
    drawMeshInstancedWithStateCache(
      gl,
      state,
      ENVIRONMENT_MESHES.trayFloorTile,
      meshHandle,
      instData,
      25,
      1.0,
      5
    );
    expect(counts.drawElementsInstanced).toBe(2);
    expect(state.activeProgram).toBe(mainProg);

    disposeGlProgramState(gl, state);
    expect(counts.deletedPrograms).toBe(1);
    expect(counts.deletedVaos).toBe(1);
    expect(counts.deletedBuffers).toBe(1);
  });

  it('caches static Pass 1 topology per BoardState and slashes Pass 1 draw calls via GPU instancing on L1 & L280', () => {
    for (const levelId of [1, 25, 280]) {
      const board = createBoardState(getLevelSpec(levelId));
      const topo1 = getOrBuildStaticPass1Topology(board);
      const topo2 = getOrBuildStaticPass1Topology(board);
      expect(topo2).toBe(topo1);

      let drawCalls = 0;
      let instancedCalls = 0;
      let totalInstances = 0;
      const rctx = {
        lastOptions: { blueprintMix: 0, reducedMotion: false },
        roomAwakenMap: new Map<number, number>(),
        activeVisualShreds: [],
        activeGateBursts: [],
        getRoomVisualState: (b: typeof board, roomId: number) => getRoomVisualStateImpl(rctx, b, roomId),
        getColorRgb: () => [0.8, 0.3, 0.3] as [number, number, number],
        drawMesh: () => {
          drawCalls++;
        },
        drawMeshInstanced: (_gl: unknown, _mesh: unknown, _data: Float32Array, count: number) => {
          instancedCalls++;
          totalInstances += count;
        },
        drawAtlasBadge: () => {
          drawCalls++;
        },
        drawBadgeMedallion3D: () => {
          drawCalls += 2;
          return 0.65;
        },
        drawNumberBadges: () => {
          drawCalls++;
        },
      } as unknown as RenderPassContext;

      const { gl } = createMockGl();
      renderPass1Courtyard(rctx, gl, board, TRAY_PALETTES.industrial_slate, false, false, 1.0);
      renderPass1WallsAndGates(rctx, gl, board, TRAY_PALETTES.industrial_slate, false, false, 1.0);

      // 4 instanced batches: plinths, floor tiles, perimeter walls+posts, perimeter rim strips
      expect(instancedCalls).toBe(4);
      expect(totalInstances).toBe(
        topo1.plinthSpans.length * 2 +
          topo1.playableTiles.length +
          topo1.wallSegments.length +
          topo1.wallRims.length
      );
      // Even 8x9 L280 collapses 126+ static floor/wall draws into just 4 instanced calls
      if (levelId === 280) {
        expect(drawCalls + instancedCalls).toBeLessThan(60);
      }
    }
  });

  it('getRoomVisualStateImpl returns frozen zero-allocation singletons for common unlocked & locked rooms', () => {
    const board = createBoardState(getLevelSpec(25));
    const rctx = {
      lastOptions: { reducedMotion: false },
      roomAwakenMap: new Map<number, number>(),
    } as unknown as RenderPassContext;

    const u1 = getRoomVisualStateImpl(rctx, board, 0);
    const u2 = getRoomVisualStateImpl(rctx, board, 0);
    expect(u1).toBe(u2);
    expect(u1.zOffset).toBe(0);
    expect(u1.luminanceMul).toBe(1.0);
    expect(u1.isLocked).toBe(false);

    const lockedBarrier = board.barriers.find((b) => !b.open && !b.isVault && b.unlocksRoomId > 0);
    if (lockedBarrier) {
      const l1 = getRoomVisualStateImpl(rctx, board, lockedBarrier.unlocksRoomId);
      const l2 = getRoomVisualStateImpl(rctx, board, lockedBarrier.unlocksRoomId);
      expect(l1).toBe(l2);
      expect(l1.isLocked).toBe(true);
      expect(l1.zOffset).toBe(-0.14);
      expect(l1.luminanceMul).toBe(0.58);
    }
  });

  it('warmUpWebGLPipelinesImpl warms mainProgram, solidProgram (regular + instanced), relic plates, and particles in a 1x1 scissor box', () => {
    const drawnStyles: number[] = [];
    const solidStyles: number[] = [];
    const particleStyles: number[] = [];
    const traceCounts: number[] = [];
    const relicClusterUnits: number[] = [];
    const activeTextures: number[] = [];
    let scissoredRect: [number, number, number, number] | null = null;
    let instancedWarmDraws = 0;

    const mainProg = { id: 'main' } as unknown as WebGLProgram;
    const solidProg = { id: 'solid' } as unknown as WebGLProgram;
    const uStyleLoc = { name: 'uStyle' } as unknown as WebGLUniformLocation;
    const uSolidMatLoc = { name: 'uSolidMatStyle' } as unknown as WebGLUniformLocation;
    const uTraceCountLoc = { name: 'uTraceCount' } as unknown as WebGLUniformLocation;
    const uTracePtsLoc = { name: 'uTracePts' } as unknown as WebGLUniformLocation;
    const uClusterTexLoc = { name: 'u_relicClusterTex' } as unknown as WebGLUniformLocation;

    const noop = () => {};
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
      TEXTURE1: 0x84c1,
      TEXTURE_2D: 0x0de1,
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      NEAREST: 0x2600,
      CLAMP_TO_EDGE: 0x812f,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      ARRAY_BUFFER: 0x8892,
      ELEMENT_ARRAY_BUFFER: 0x8893,
      DYNAMIC_DRAW: 0x88e8,
      FLOAT: 0x1406,
      TRIANGLES: 4,
      UNSIGNED_SHORT: 0x1403,
      scissor: (x: number, y: number, w: number, h: number) => {
        scissoredRect = [x, y, w, h];
      },
      createTexture: () => ({ id: 'clusterTex' }) as unknown as WebGLTexture,
      createVertexArray: () => ({ id: 'vao' }) as unknown as WebGLVertexArrayObject,
      createBuffer: () => ({ id: 'buf' }) as unknown as WebGLBuffer,
      getUniformLocation: (prog: WebGLProgram, name: string) => {
        if (name === 'u_relicClusterTex') return uClusterTexLoc;
        if (name === 'u_traceCount') return uTraceCountLoc;
        if (name === 'u_tracePts[0]') return uTracePtsLoc;
        if (prog === solidProg && name === 'u_materialStyle') return uSolidMatLoc;
        return { prog, name } as unknown as WebGLUniformLocation;
      },
      activeTexture: (unit: number) => {
        activeTextures.push(unit);
      },
      uniform1i: (loc: WebGLUniformLocation | null, v: number) => {
        if (loc === uStyleLoc) particleStyles.push(v);
        if (loc === uSolidMatLoc) solidStyles.push(v);
        if (loc === uTraceCountLoc) traceCounts.push(v);
        if (loc === uClusterTexLoc) relicClusterUnits.push(v);
      },
      drawElementsInstanced: () => {
        instancedWarmDraws++;
      },
    } as unknown as Record<string, unknown>;
    for (const m of (
      'enable disable colorMask depthMask depthFunc cullFace blendFuncSeparate useProgram uniformMatrix4fv ' +
      'uniform1f uniform3f uniform4f uniform4fv texParameteri texImage2D texSubImage2D bindTexture ' +
      'bindVertexArray bindBuffer bufferData bufferSubData enableVertexAttribArray vertexAttribPointer ' +
      'vertexAttribDivisor drawElements flush'
    ).split(' ')) {
      gl[m] = noop;
    }

    const programState = createGlProgramState(gl as unknown as WebGL2RenderingContext, mainProg, solidProg);
    const quadHandle: GLMeshHandle = {
      vao: {} as WebGLVertexArrayObject,
      posBuffer: {} as WebGLBuffer,
      normBuffer: {} as WebGLBuffer,
      uvBuffer: {} as WebGLBuffer,
      indexBuffer: {} as WebGLBuffer,
      indexCount: 6,
    };
    const rctx = {
      camera: new Camera3D(),
      uUseClipPlane: programState.mainUniforms.uUseClipPlane,
      uClipPlane: programState.mainUniforms.uClipPlane,
      uTraceCount: uTraceCountLoc,
      uTracePts: uTracePtsLoc,
      drawMesh: (...args: unknown[]) => {
        drawnStyles.push(Number(args[args.length - 1]));
      },
      drawMeshInstanced: () => {
        instancedWarmDraws++;
      },
      drawAtlasBadge: () => {},
    } as unknown as RenderPassContext;

    warmUpWebGLPipelinesImpl(
      rctx,
      gl as unknown as WebGL2RenderingContext,
      programState,
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
      },
      quadHandle
    );

    expect(scissoredRect).toEqual([0, 0, 1, 1]);
    expect(traceCounts).toContain(2);
    expect(drawnStyles).toEqual(expect.arrayContaining([0, 4, 7, 8, 9, 10, 11]));
    expect(solidStyles).toEqual(expect.arrayContaining([0, 1, 2, 3, 5, 6, 7]));
    expect(particleStyles).toEqual(expect.arrayContaining([0, 4]));
    expect(instancedWarmDraws).toBeGreaterThanOrEqual(6); // 2 main instanced + 1 solid instanced + 3 particle/smoke
    expect(relicClusterUnits).toContain(1);
    expect(activeTextures).toContain(0x84c1);
    expect(activeTextures[activeTextures.length - 1]).toBe(0x84c0);
  });
});
