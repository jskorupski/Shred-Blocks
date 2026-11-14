import type { Benchmark120HzResult, PerfTelemetry, QualityTier } from '../core/types';

/** Options supplied by the main `requestAnimationFrame` loop on each vsync tick. */
export interface RafTickTelemetryOptions {
  /** True when user input, drag, block bounce, particles, or transition motion is active. */
  isInteractiveMotion: boolean;
  /** True while a pointer or drag is actively engaged on the board (when Android Chrome/LTPO boosts to 120Hz). */
  isPointerEngaged?: boolean;
  /** True while a top-layer `<dialog>` (`Pause`, `Victory`, `Failure`, `Save`) is open. */
  isModalOpen: boolean;
  /** True when off-board (`Home` / `Themes`) or paused/frozen (`render` suppressed). */
  isSuspended: boolean;
}

const WORK_BUFFER_SIZE = 120;
const RAF_BUFFER_SIZE = 72;
const BALANCED_60_RENDER_MIN_INTERVAL_MS = 12.5;
const HIGH_RATE_RAF_THRESHOLD_MS = 10.5;
const SUB_60_STALL_THRESHOLD_MS = 22.0;

/**
 * Two-Tier Adaptive `120fps / 60fps` Quality Governor (`VER-03`).
 *
 * Mobile LTPO / ProMotion browsers (e.g. Android Chrome on S24 Ultra) dynamically step `rAF` between
 * `120Hz` (`8.33ms`) during active touch-drag and `60Hz` (`16.67ms`) immediately on finger lift.
 * Rather than guessing panel refresh caps from mixed 60/120Hz intervals:
 * 1. `AUTO` defaults to `ULTRA_120` (unthrottled vsync, crisp `2.5` DPR, `60` particles) and ONLY steps
 *    down to `BALANCED_60` when genuine sub-60fps distress occurs (`>= 20%` of active frames `> 22ms`,
 *    or `p95WorkMs > 11ms`). Both `120Hz` (`8.33ms`) and `60Hz` (`16.67ms`) count as 100% healthy.
 * 2. Manual/active `BALANCED_60` paces renders using the instantaneous live `rAF` interval (`< 10.5ms`),
 *    cleanly halving `120Hz` drags to `60fps` while never dropping `60Hz` frames.
 * 3. `cadenceRing` samples active pointer/drag and high-rate ticks separately from finger-up cooldowns so
 *    reaching for Settings (`#dialog-pause`) never decays `120fps (120Hz)` telemetry down to `60`.
 */
export class QualityGovernor {
  private readonly workRing = new Float32Array(WORK_BUFFER_SIZE);
  private readonly workScratch = new Float32Array(WORK_BUFFER_SIZE);
  private workWriteCursor = 0;
  private workSampleCount = 0;

  private readonly activeRafRing = new Float32Array(RAF_BUFFER_SIZE);
  private rafWriteCursor = 0;
  private rafSampleCount = 0;

  private readonly cadenceRing = new Float32Array(RAF_BUFFER_SIZE);
  private readonly rafScratch = new Float32Array(RAF_BUFFER_SIZE);
  private cadenceWriteCursor = 0;
  private cadenceSampleCount = 0;

  private cachedWorkStats = { avgWorkMs: 0.8, p95WorkMs: 1.2, p99WorkMs: 1.5, maxWorkMs: 1.8 };
  private workStatsDirty = false;
  private cachedRafStats = { displayHz: 120, medianDeltaMs: 8.33, sub60StallRatio: 0 };
  private rafStatsDirty = false;

  private preferredTier: QualityTier = 'AUTO';
  private activeTier: 'ULTRA_120' | 'BALANCED_60' = 'ULTRA_120';
  private backend: 'WEBGPU' | 'WEBGL2' | 'CANVAS2D' = 'WEBGL2';
  private activeParticles = 0;
  private dpr = 1;

  private lastRafTimestamp = 0;
  private lastValidRafDeltaMs = 0;
  private lastRenderedRafTimestamp = 0;
  private seenPointerOrHighRate = false;
  private lastTickSampledCadence = false;
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
      if (this.hasMeasuredRenderFps && this.measuredRenderFps > 60) {
        this.measuredRenderFps = 60;
      }
      if (this.hasMeasuredFpsSample && this.measuredFps > 60) {
        this.measuredFps = 60;
      }
    } else {
      this.evaluateAutoTier();
    }
  }

  public getPreferredTier(): QualityTier {
    return this.preferredTier;
  }

  public didLastTickSampleCadence(): boolean {
    return this.lastTickSampledCadence;
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
   * Records genuine `requestAnimationFrame` intervals during active gameplay motion.
   * - `activeRafRing` tracks sub-60fps frame stalls (`> 22ms`) for `AUTO` fallback.
   * - `cadenceRing` tracks active touch/drag and high-rate (`> 95Hz`) intervals so finger-up LTPO
   *   `60Hz` power-saving never decays active `120fps (120Hz)` telemetry before opening Settings.
   */
  public recordRafTick(rafTimestampMs: number, opts: RafTickTelemetryOptions): void {
    const prevTs = this.lastRafTimestamp;
    this.lastRafTimestamp = rafTimestampMs;
    this.lastTickSampledCadence = false;
    if (prevTs <= 0) return;

    const delta = rafTimestampMs - prevTs;
    // Ignore background-tab resumes or degenerate duplicate callbacks
    if (delta < 3 || delta > 200) return;
    this.lastValidRafDeltaMs = delta;

    if (opts.isModalOpen || opts.isSuspended) {
      return;
    }

    this.totalRafTicksObserved++;
    if (opts.isInteractiveMotion) {
      this.activeRafRing[this.rafWriteCursor] = delta;
      this.rafWriteCursor = (this.rafWriteCursor + 1) % RAF_BUFFER_SIZE;
      if (this.rafSampleCount < RAF_BUFFER_SIZE) this.rafSampleCount++;
      this.rafStatsDirty = true;

      const isHighRateTick = delta < HIGH_RATE_RAF_THRESHOLD_MS;
      if (opts.isPointerEngaged || isHighRateTick) {
        this.seenPointerOrHighRate = true;
      }
      const shouldSampleCadence =
        Boolean(opts.isPointerEngaged) || isHighRateTick || !this.seenPointerOrHighRate;
      if (shouldSampleCadence) {
        this.lastTickSampledCadence = true;
        const instFps = 1000 / delta;
        if (!this.hasMeasuredFpsSample) {
          this.measuredFps = instFps;
          this.hasMeasuredFpsSample = true;
        } else {
          const blend = instFps > this.measuredFps ? 0.24 : 0.14;
          this.measuredFps = this.measuredFps * (1 - blend) + instFps * blend;
        }

        this.cadenceRing[this.cadenceWriteCursor] = delta;
        this.cadenceWriteCursor = (this.cadenceWriteCursor + 1) % RAF_BUFFER_SIZE;
        if (this.cadenceSampleCount < RAF_BUFFER_SIZE) this.cadenceSampleCount++;
      }
    } else if (!this.hasMeasuredFpsSample && this.totalRafTicksObserved === 2) {
      this.measuredFps = 1000 / delta;
      this.hasMeasuredFpsSample = true;
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
   * When `BALANCED_60` is active and the live `rAF` interval itself is high-rate (`< 10.5ms`, `> 95Hz`),
   * skips intermediate sub-frames (`< 12.5ms` since last render) while never skipping 60Hz ticks.
   */
  public shouldRenderOnRaf(rafTimestampMs: number, forceImmediate = false): boolean {
    if (forceImmediate || this.activeTier === 'ULTRA_120' || this.lastRenderedRafTimestamp <= 0) {
      return true;
    }
    const liveDelta =
      this.lastRafTimestamp > 0 && rafTimestampMs > this.lastRafTimestamp
        ? rafTimestampMs - this.lastRafTimestamp
        : this.lastValidRafDeltaMs;
    const isHighRateTick = liveDelta > 0 && liveDelta < HIGH_RATE_RAF_THRESHOLD_MS;
    if (!isHighRateTick) {
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
   * off-board, settled behind an open top-layer modal (`!hasVisualFx`), or paced at 60Hz under `BALANCED_60`.
   */
  public consumeRenderStep(
    rafTimestampMs: number,
    dtSec: number,
    state: {
      canvasVisible: boolean;
      modalOpen: boolean;
      victoryOpen?: boolean;
      hasVisualFx: boolean;
      forceSettle: boolean;
    }
  ): number {
    if (!state.canvasVisible) {
      this.pendingRenderDtSec = 0;
      return 0;
    }
    this.pendingRenderDtSec = Math.min(0.1, this.pendingRenderDtSec + dtSec);
    // OUTCOME-TRANSITION-01: keep stepping residual airborne FX behind outcome modals until dissolved, then sleep at 0fps
    const shouldDrawBehindModal = !state.modalOpen || state.forceSettle || state.hasVisualFx;
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
    const raf = this.getRafStats();

    // Downgrade ONLY on genuine sub-60fps distress (>22ms frame stalls or heavy >11ms JS/GL work)
    const cpuOverBudget = this.workSampleCount >= 24 && work.p95WorkMs > 11.0;
    const sub60StallOverBudget = this.rafSampleCount >= 36 && raf.sub60StallRatio >= 0.2;

    if (cpuOverBudget || sub60StallOverBudget) {
      if (this.activeTier === 'ULTRA_120') {
        this.activeTier = 'BALANCED_60';
        this.downgradeCount++;
        // Exponential hold prevents thrashing on thermally-limited or overloaded devices
        this.autoUpgradeCooldownTicks = Math.min(1800, 240 * 2 ** (this.downgradeCount - 1));
      }
      return;
    }

    if (this.activeTier === 'BALANCED_60' && this.autoUpgradeCooldownTicks === 0) {
      const cpuHealthy = this.workSampleCount < 24 || work.p95WorkMs < 6.5;
      const stallsCleared = this.rafSampleCount < 24 || raf.sub60StallRatio < 0.05;
      if (cpuHealthy && stallsCleared) {
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

    const activeCount = this.rafSampleCount;
    let stalls = 0;
    for (let i = 0; i < activeCount; i++) {
      if (this.activeRafRing[i] > SUB_60_STALL_THRESHOLD_MS) stalls++;
    }
    const sub60StallRatio = activeCount > 0 ? stalls / activeCount : 0;

    const cadCount = this.cadenceSampleCount;
    const srcRing = cadCount >= 4 ? this.cadenceRing : this.activeRafRing;
    const count = cadCount >= 4 ? cadCount : activeCount;
    if (count < 4) {
      this.cachedRafStats = { ...this.cachedRafStats, sub60StallRatio };
      return this.cachedRafStats;
    }

    for (let i = 0; i < count; i++) {
      this.rafScratch[i] = srcRing[i];
    }
    const sub = this.rafScratch.subarray(0, count);
    sub.sort();

    const nomIdx = Math.min(count - 1, Math.floor(count * 0.25));
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

    this.cachedRafStats = {
      displayHz: Math.min(240, Math.max(30, snappedHz)),
      medianDeltaMs,
      sub60StallRatio,
    };
    return this.cachedRafStats;
  }

  public getTelemetry(): PerfTelemetry {
    const stats = this.getWorkStats();
    const raf = this.getRafStats();
    const hasCadence = this.cadenceSampleCount >= 4 || this.rafSampleCount >= 4;
    const effectiveDisplayHz = hasCadence ? raf.displayHz : 60;
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
