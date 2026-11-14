import type { Benchmark120HzResult, PerfTelemetry, QualityTier } from '../core/types';

/** Options supplied by the main `requestAnimationFrame` loop on each vsync tick. */
export interface RafTickTelemetryOptions {
  /** True when user input, drag, block bounce, particles, or transition motion is active. */
  isInteractiveMotion: boolean;
  /** True while a top-layer `<dialog>` (`Pause`, `Victory`, `Failure`, `Save`) is open. */
  isModalOpen: boolean;
  /** True when off-board (`Home` / `Themes`) or paused/frozen (`render` suppressed). */
  isSuspended: boolean;
}

const WORK_BUFFER_SIZE = 120;
const RAF_BUFFER_SIZE = 72;
const BALANCED_60_RENDER_MIN_INTERVAL_MS = 12.5;
const ACTIVE_REFRESH_HYSTERESIS_THRESHOLD_HZ = 78;

/**
 * Two-Tier Adaptive `120fps / 60fps` Quality Governor (`VER-03`).
 *
 * Combines three signals so both CPU-bound, GPU-bound, and 60Hz-locked mobile browsers behave properly:
 * 1. `workDurationMs` ring (`p95WorkMs`): catches heavy JS/GL submission bottlenecks (> 7.8ms).
 * 2. Active `requestAnimationFrame` cadence (`activeRafRing`): distinguishes genuine high-refresh
 *    screens (e.g. S24 Ultra LTPO 120Hz during touch/motion) from 60Hz-locked WebKit/PWA environments
 *    (e.g. iPhone 13 Pro Safari WebApp with "Prefer Page Rendering Updates near 60fps"), ignoring idle
 *    static screens and open dialogs so LTPO idle refresh drops never erase active 120fps telemetry.
 * 3. Active missed-vsync ratio (`missedFrameRatio`): detects GPU raster/fillrate stalls even when async
 *    WebGL draw calls return quickly to JavaScript.
 */
export class QualityGovernor {
  private readonly workRing = new Float32Array(WORK_BUFFER_SIZE);
  private readonly workScratch = new Float32Array(WORK_BUFFER_SIZE);
  private workWriteCursor = 0;
  private workSampleCount = 0;

  private readonly activeRafRing = new Float32Array(RAF_BUFFER_SIZE);
  private readonly rafScratch = new Float32Array(RAF_BUFFER_SIZE);
  private rafWriteCursor = 0;
  private rafSampleCount = 0;

  private cachedWorkStats = { avgWorkMs: 0.8, p95WorkMs: 1.2, p99WorkMs: 1.5, maxWorkMs: 1.8 };
  private workStatsDirty = false;
  private cachedRafStats = { displayHz: 120, medianDeltaMs: 8.33, missedRatio: 0 };
  private rafStatsDirty = false;

  private preferredTier: QualityTier = 'AUTO';
  private activeTier: 'ULTRA_120' | 'BALANCED_60' = 'ULTRA_120';
  private backend: 'WEBGPU' | 'WEBGL2' | 'CANVAS2D' = 'WEBGL2';
  private activeParticles = 0;
  private dpr = 1;

  private lastRafTimestamp = 0;
  private lastRenderedRafTimestamp = 0;
  private measuredFps = 60;
  private hasMeasuredFpsSample = false;
  private measuredRenderFps = 60;
  private hasMeasuredRenderFps = false;
  private totalRafTicksObserved = 0;
  private evalCooldownTicks = 0;
  private autoUpgradeCooldownTicks = 0;
  private downgradeCount = 0;
  private pendingRenderDtSec = 0;
  private benchmarkRunner: ((frames: number) => Promise<Benchmark120HzResult>) | null = null;

  public setPreference(tier: QualityTier): void {
    this.preferredTier = tier;
    if (tier === 'ULTRA_120') {
      this.activeTier = 'ULTRA_120';
      this.autoUpgradeCooldownTicks = 0;
    } else if (tier === 'BALANCED_60') {
      this.activeTier = 'BALANCED_60';
    } else {
      this.evaluateAutoTier();
    }
  }

  public getPreferredTier(): QualityTier {
    return this.preferredTier;
  }

  public setBackend(backend: 'WEBGPU' | 'WEBGL2' | 'CANVAS2D'): void {
    this.backend = backend;
  }

  public setActiveParticles(count: number): void {
    this.activeParticles = count;
  }

  public setDpr(dpr: number): void {
    this.dpr = dpr;
  }

  public setBenchmarkRunner(runner: (frames: number) => Promise<Benchmark120HzResult>): void {
    this.benchmarkRunner = runner;
  }

  public resetWorkSamples(): void {
    this.workSampleCount = 0;
    this.workWriteCursor = 0;
    this.workStatsDirty = false;
    this.cachedWorkStats = { avgWorkMs: 0.8, p95WorkMs: 1.2, p99WorkMs: 1.5, maxWorkMs: 1.8 };
  }

  /**
   * Records genuine `requestAnimationFrame` intervals during active gameplay motion and updates
   * `activeFps`, `displayHz`, and `AUTO` quality selection. Open dialogs & suspended off-board views
   * freeze FPS/refresh readings so static LTPO power-saving never overwrites gameplay telemetry.
   */
  public recordRafTick(rafTimestampMs: number, opts: RafTickTelemetryOptions): void {
    const prevTs = this.lastRafTimestamp;
    this.lastRafTimestamp = rafTimestampMs;
    if (prevTs <= 0) return;

    const delta = rafTimestampMs - prevTs;
    // Ignore background-tab resumes or degenerate duplicate callbacks
    if (delta < 3 || delta > 200) return;

    if (opts.isModalOpen || opts.isSuspended) {
      return;
    }

    this.totalRafTicksObserved++;
    const inStartupWarmup = this.totalRafTicksObserved <= 24;
    if (opts.isInteractiveMotion || inStartupWarmup) {
      const instFps = 1000 / delta;
      if (!this.hasMeasuredFpsSample) {
        this.measuredFps = instFps;
        this.hasMeasuredFpsSample = true;
      } else {
        const blend = instFps > this.measuredFps ? 0.24 : 0.14;
        this.measuredFps = this.measuredFps * (1 - blend) + instFps * blend;
      }

      this.activeRafRing[this.rafWriteCursor] = delta;
      this.rafWriteCursor = (this.rafWriteCursor + 1) % RAF_BUFFER_SIZE;
      if (this.rafSampleCount < RAF_BUFFER_SIZE) this.rafSampleCount++;
      this.rafStatsDirty = true;
    }

    if (this.autoUpgradeCooldownTicks > 0) {
      this.autoUpgradeCooldownTicks--;
    }
    if (this.evalCooldownTicks > 0) {
      this.evalCooldownTicks--;
    } else if (this.preferredTier === 'AUTO' && (this.rafSampleCount >= 24 || this.workSampleCount >= 24)) {
      this.evalCooldownTicks = 16;
      this.evaluateAutoTier();
    }
  }

  /**
   * Decides whether a given `rAF` tick should submit a full scene render.
   * When `BALANCED_60` is active on a high-refresh screen (`>= 78Hz`), skips intermediate 120Hz
   * sub-frames (`< 12.5ms` since last render) while preserving every single frame on 60Hz screens.
   */
  public shouldRenderOnRaf(rafTimestampMs: number, forceImmediate = false): boolean {
    if (forceImmediate || this.activeTier === 'ULTRA_120' || this.lastRenderedRafTimestamp <= 0) {
      return true;
    }
    const rafStats = this.getRafStats();
    if (rafStats.displayHz < ACTIVE_REFRESH_HYSTERESIS_THRESHOLD_HZ) {
      return true;
    }
    return rafTimestampMs - this.lastRenderedRafTimestamp >= BALANCED_60_RENDER_MIN_INTERVAL_MS;
  }

  public markFrameRendered(rafTimestampMs: number, updateRenderFps = true): void {
    const prevRenderTs = this.lastRenderedRafTimestamp;
    this.lastRenderedRafTimestamp = rafTimestampMs;
    if (!updateRenderFps || prevRenderTs <= 0) return;
    const renderDelta = rafTimestampMs - prevRenderTs;
    if (renderDelta < 3 || renderDelta > 200) return;
    const instRenderFps = 1000 / renderDelta;
    if (!this.hasMeasuredRenderFps) {
      this.measuredRenderFps = instRenderFps;
      this.hasMeasuredRenderFps = true;
    } else {
      const blend = instRenderFps > this.measuredRenderFps ? 0.24 : 0.14;
      this.measuredRenderFps = this.measuredRenderFps * (1 - blend) + instRenderFps * blend;
    }
  }

  /**
   * Accumulates frame `dtSec` and returns the combined delta to render on this rAF tick, or `0` when
   * off-board, settled behind an open top-layer modal, or intentionally paced at 60Hz under `BALANCED_60`.
   */
  public consumeRenderStep(
    rafTimestampMs: number,
    dtSec: number,
    state: {
      canvasVisible: boolean;
      modalOpen: boolean;
      victoryOpen: boolean;
      hasVisualFx: boolean;
      forceSettle: boolean;
    }
  ): number {
    if (!state.canvasVisible) {
      this.pendingRenderDtSec = 0;
      return 0;
    }
    this.pendingRenderDtSec = Math.min(0.1, this.pendingRenderDtSec + dtSec);
    const shouldDrawBehindModal =
      !state.modalOpen || state.forceSettle || (!state.victoryOpen && state.hasVisualFx);
    if (!shouldDrawBehindModal || !this.shouldRenderOnRaf(rafTimestampMs, state.forceSettle)) {
      return 0;
    }
    const stepDt = this.pendingRenderDtSec > 0 ? this.pendingRenderDtSec : dtSec;
    this.pendingRenderDtSec = 0;
    return stepDt;
  }

  public resetPendingRenderDt(): void {
    this.pendingRenderDtSec = 0;
  }

  /**
   * Records CPU/WebGL submission work for a rendered frame. Non-rAF renders pass `trackRafDelta = false`
   * so synchronous UI/resize redraws never distort measured FPS.
   */
  public recordFrameWork(workDurationMs: number, nowMs = performance.now(), trackRafDelta = true): void {
    const clampedWork = Math.max(0.01, workDurationMs);
    this.workRing[this.workWriteCursor] = clampedWork;
    this.workWriteCursor = (this.workWriteCursor + 1) % WORK_BUFFER_SIZE;
    if (this.workSampleCount < WORK_BUFFER_SIZE) this.workSampleCount++;
    this.workStatsDirty = true;

    if (trackRafDelta) {
      this.recordRafTick(nowMs, { isInteractiveMotion: true, isModalOpen: false, isSuspended: false });
      return;
    }

    if (this.preferredTier === 'AUTO' && this.evalCooldownTicks === 0 && this.workSampleCount >= 24) {
      this.evalCooldownTicks = 16;
      this.evaluateAutoTier();
    }
  }

  private evaluateAutoTier(): void {
    if (this.preferredTier === 'ULTRA_120') {
      this.activeTier = 'ULTRA_120';
      return;
    }
    if (this.preferredTier === 'BALANCED_60') {
      this.activeTier = 'BALANCED_60';
      return;
    }

    const work = this.getWorkStats();
    const hasRafEvidence = this.rafSampleCount >= 24;
    const raf = this.getRafStats();

    const cpuOverBudget = this.workSampleCount >= 24 && work.p95WorkMs > 7.8;
    const confirmedSixtyHzCap = hasRafEvidence && raf.displayHz <= 72;
    const gpuJankOverBudget =
      hasRafEvidence &&
      this.rafSampleCount >= 36 &&
      raf.displayHz > 75 &&
      this.activeTier === 'ULTRA_120' &&
      raf.missedRatio >= 0.16;

    if (cpuOverBudget || confirmedSixtyHzCap || gpuJankOverBudget) {
      if (this.activeTier === 'ULTRA_120') {
        this.activeTier = 'BALANCED_60';
        if (cpuOverBudget || gpuJankOverBudget) {
          this.downgradeCount++;
          // Exponential hold prevents thrashing 60 <-> 120Hz on thermal/GPU-limited devices
          this.autoUpgradeCooldownTicks = Math.min(1800, 240 * 2 ** (this.downgradeCount - 1));
        }
      }
      return;
    }

    if (this.activeTier === 'BALANCED_60' && this.autoUpgradeCooldownTicks === 0) {
      const displaySupportsUltra = !hasRafEvidence || raf.displayHz >= 85;
      const cpuHealthy = this.workSampleCount < 24 || work.p95WorkMs < 4.8;
      const gpuHealthy = !hasRafEvidence || raf.missedRatio < 0.06;
      if (displaySupportsUltra && cpuHealthy && gpuHealthy) {
        this.activeTier = 'ULTRA_120';
      }
    }
  }

  public getActiveTier(): 'ULTRA_120' | 'BALANCED_60' {
    return this.activeTier;
  }

  public getBurstParticleCount(reducedMotion = false): number {
    if (reducedMotion) return 14;
    return this.activeTier === 'ULTRA_120' ? 60 : 36;
  }

  public getMaxActiveParticles(): number {
    return this.activeTier === 'ULTRA_120' ? 1024 : 384;
  }

  public getTargetMaxDpr(): number {
    return this.activeTier === 'ULTRA_120' ? 2.5 : 1.75;
  }

  public getVictoryFxMaxDpr(): number {
    return this.activeTier === 'ULTRA_120' ? 2 : 1.75;
  }

  private getWorkStats() {
    if (!this.workStatsDirty) return this.cachedWorkStats;
    this.workStatsDirty = false;
    const count = this.workSampleCount;
    if (count === 0) return this.cachedWorkStats;

    let sum = 0;
    let maxWorkMs = 0;
    for (let i = 0; i < count; i++) {
      const v = this.workRing[i];
      sum += v;
      if (v > maxWorkMs) maxWorkMs = v;
      this.workScratch[i] = v;
    }

    const sub = this.workScratch.subarray(0, count);
    sub.sort();

    const p95Idx = Math.min(count - 1, Math.floor(count * 0.95));
    const p99Idx = Math.min(count - 1, Math.floor(count * 0.99));
    this.cachedWorkStats = {
      avgWorkMs: Number((sum / count).toFixed(3)),
      p95WorkMs: Number(sub[p95Idx].toFixed(3)),
      p99WorkMs: Number(sub[p99Idx].toFixed(3)),
      maxWorkMs: Number(maxWorkMs.toFixed(3)),
    };
    return this.cachedWorkStats;
  }

  private getRafStats() {
    if (!this.rafStatsDirty) return this.cachedRafStats;
    this.rafStatsDirty = false;
    const count = this.rafSampleCount;
    if (count < 4) return this.cachedRafStats;

    for (let i = 0; i < count; i++) {
      this.rafScratch[i] = this.activeRafRing[i];
    }
    const sub = this.rafScratch.subarray(0, count);
    sub.sort();

    // Lower-quartile-biased median resists occasional dropped vsync spikes inflating nominal period
    const nomIdx = Math.min(count - 1, Math.floor(count * 0.35));
    const medianDeltaMs = Math.max(4, sub[nomIdx]);
    const rawHz = 1000 / medianDeltaMs;
    const snappedHz =
      rawHz >= 112 && rawHz <= 128
        ? 120
        : rawHz >= 85 && rawHz <= 95
          ? 90
          : rawHz >= 56 && rawHz <= 64
            ? 60
            : Math.round(rawHz);

    const expectedPeriodMs = 1000 / Math.max(30, snappedHz);
    const stallThresholdMs = expectedPeriodMs * 1.48;
    let missed = 0;
    for (let i = 0; i < count; i++) {
      if (this.activeRafRing[i] > stallThresholdMs) missed++;
    }

    this.cachedRafStats = {
      displayHz: Math.min(240, Math.max(30, snappedHz)),
      medianDeltaMs,
      missedRatio: missed / count,
    };
    return this.cachedRafStats;
  }

  public getTelemetry(): PerfTelemetry {
    const stats = this.getWorkStats();
    const raf = this.getRafStats();
    const effectiveDisplayHz = this.rafSampleCount >= 4 ? raf.displayHz : 60;
    const rawFps = this.hasMeasuredRenderFps
      ? this.measuredRenderFps
      : this.hasMeasuredFpsSample
        ? this.measuredFps
        : effectiveDisplayHz;
    const reportedFps = Math.round(Math.min(240, Math.max(15, rawFps)));
    return {
      fps: reportedFps,
      displayHz: effectiveDisplayHz,
      avgWorkMs: stats.avgWorkMs,
      p95WorkMs: stats.p95WorkMs,
      p99WorkMs: stats.p99WorkMs,
      maxWorkMs: stats.maxWorkMs,
      activeTier: this.activeTier,
      rendererBackend: this.backend,
      activeParticles: this.activeParticles,
      dpr: Number(this.dpr.toFixed(2)),
    };
  }

  public async run120HzBenchmark(frames = 120): Promise<Benchmark120HzResult> {
    if (this.benchmarkRunner) {
      return this.benchmarkRunner(frames);
    }
    const stats = this.getWorkStats();
    return {
      framesExecuted: frames,
      avgWorkMs: stats.avgWorkMs,
      p95WorkMs: stats.p95WorkMs,
      p99WorkMs: stats.p99WorkMs,
      maxWorkMs: stats.maxWorkMs,
      passes120HzBudget: stats.p95WorkMs <= 8.33,
      passes60HzBudget: stats.p95WorkMs <= 16.67,
    };
  }
}
