import {
  AMBIENT_PRESETS,
  AMBIENT_ROTATION_BARS,
  type AmbientChord,
  type AmbientPreset,
  type AmbientPresetId,
  type DrumToken,
  getTapeCurve,
  type MusicScene,
  prewarmAmbientMusicBuffer,
  SCENE_ROTATION_POOLS,
} from './ambient-presets';

export {
  AMBIENT_PRESETS,
  AMBIENT_ROTATION_BARS,
  type AmbientChord,
  type AmbientPreset,
  type AmbientPresetId,
  type DrumToken,
  type MusicScene,
  prewarmAmbientMusicBuffer,
  SCENE_ROTATION_POOLS,
};

function setParam(param: AudioParam | undefined, value: number, time: number): void {
  if (!param) return;
  if (typeof param.setValueAtTime === 'function') {
    param.setValueAtTime(value, time);
  } else {
    param.value = value;
  }
}

function targetParam(param: AudioParam | undefined, value: number, time: number, tc: number): void {
  if (!param) return;
  if (typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, time, tc);
  } else {
    setParam(param, value, time);
  }
}

function disconnectAll(nodes: ReadonlyArray<AudioNode>): void {
  for (const node of nodes) {
    try {
      node.disconnect();
    } catch {}
  }
}

interface MasterMusicGraph {
  readonly ctx: AudioContext;
  readonly musicGain: GainNode;
  readonly warmthFilter: BiquadFilterNode;
  readonly drumTapeFilter: BiquadFilterNode;
  readonly wetInput: GainNode;
  readonly wetOutput: GainNode;
  readonly ownedNodes: ReadonlyArray<AudioNode>;
}

interface PresetBus {
  readonly padMelBus: GainNode;
  readonly drumBus: GainNode;
  readonly wetBus: GainNode;
  readonly leadGain: GainNode;
  readonly beatDryGain: GainNode;
  readonly beatWetGain: GainNode;
}

interface NoiseLayerSpec {
  readonly buffer: AudioBuffer;
  readonly offset: number;
  readonly when: number;
  readonly readDur: number;
  readonly stopAt: number;
  readonly peak: number;
  readonly attack: number;
  readonly decay: number;
  readonly wetGain: number;
  readonly filters: ReadonlyArray<{
    readonly type: BiquadFilterType;
    readonly freq: number;
    readonly q: number;
  }>;
}

/**
 * Mode-attuned procedural Web Audio chill soundtrack controller with warm tape drums,
 * pure-pentatonic pads, felt-mallet motifs, and bar-aligned 32-bar palette rotation.
 */
export class AmbientMusicController {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private graph: MasterMusicGraph | null = null;
  private activeBus: PresetBus | null = null;
  private readonly fadeTimers = new Set<ReturnType<typeof setTimeout>>();

  private currentScene: MusicScene = 'MENU';
  private rotationIndex = 0;
  private activePresetId: AmbientPresetId = 'astrolabe';
  private barsInCurrentTrack = 0;
  private stepIndex = 0;
  private chordIndex = 0;
  private nextNoteTime = 0;

  public getScene(): MusicScene {
    return this.currentScene;
  }

  public getActivePresetId(): AmbientPresetId {
    return this.activePresetId;
  }

  public getBarsInCurrentTrack(): number {
    return this.barsInCurrentTrack;
  }

  public isRunning(): boolean {
    return this.timerId !== null;
  }

  private getPresetById(id: AmbientPresetId): AmbientPreset {
    return AMBIENT_PRESETS.find((p) => p.id === id) ?? AMBIENT_PRESETS[0];
  }

  /** Switches mood pool opener on scene changes; repeated calls in the same scene stay uninterrupted. */
  public setScene(
    scene: MusicScene,
    ctx: AudioContext | null,
    musicGain: GainNode | null,
    playing: boolean
  ): void {
    if (scene === this.currentScene) return;
    this.currentScene = scene;
    this.rotationIndex = 0;
    this.barsInCurrentTrack = 0;
    const opener = SCENE_ROTATION_POOLS[scene][0];
    if (opener === this.activePresetId) return;

    this.activePresetId = opener;
    this.stepIndex = 0;
    this.chordIndex = 0;
    if (playing && ctx && musicGain) {
      const graph = this.ensureGraph(ctx, musicGain);
      const preset = this.getPresetById(opener);
      this.createPresetBus(ctx, graph, preset, ctx.currentTime);
      this.nextNoteTime = ctx.currentTime + 0.06;
    }
  }

  public start(ctx: AudioContext, musicGain: GainNode): void {
    if (this.timerId !== null) return;
    const graph = this.ensureGraph(ctx, musicGain);
    if (!this.activeBus) {
      this.createPresetBus(ctx, graph, this.getPresetById(this.activePresetId), ctx.currentTime);
    }
    this.nextNoteTime = ctx.currentTime + 0.05;
    this.timerId = setInterval(() => this.tickLookahead(ctx, musicGain), 45);
    if (ctx.state === 'running') {
      this.tickLookahead(ctx, musicGain);
    }
  }

  public stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.activeBus && this.graph) {
      const ctx = this.graph.ctx;
      const t = ctx.currentTime;
      const old = this.activeBus;
      this.activeBus = null;
      this.fadeOutBus(ctx, old, t, 360);
    }
  }

  public destroy(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    for (const tid of this.fadeTimers) {
      clearTimeout(tid);
    }
    this.fadeTimers.clear();
    if (this.activeBus) {
      disconnectAll([this.activeBus.padMelBus, this.activeBus.drumBus, this.activeBus.wetBus]);
      this.activeBus = null;
    }
    if (this.graph) {
      disconnectAll(this.graph.ownedNodes);
      this.graph = null;
    }
  }

  private ensureGraph(ctx: AudioContext, musicGain: GainNode): MasterMusicGraph {
    if (this.graph && this.graph.ctx === ctx && this.graph.musicGain === musicGain) {
      return this.graph;
    }
    if (this.graph) {
      disconnectAll(this.graph.ownedNodes);
      this.graph = null;
      this.activeBus = null;
    }

    const owned: AudioNode[] = [];
    const preset = this.getPresetById(this.activePresetId);
    const busOut = ctx.createGain();
    setParam(busOut.gain, 1.0, ctx.currentTime);
    owned.push(busOut);

    const warmthFilter = ctx.createBiquadFilter();
    warmthFilter.type = 'lowpass';
    setParam(warmthFilter.frequency, preset.warmthHz, ctx.currentTime);
    setParam(warmthFilter.Q, 0.55, ctx.currentTime);
    warmthFilter.connect(busOut);
    owned.push(warmthFilter);

    const drumTapeFilter = ctx.createBiquadFilter();
    drumTapeFilter.type = 'lowpass';
    setParam(drumTapeFilter.frequency, 2900, ctx.currentTime);
    setParam(drumTapeFilter.Q, 0.65, ctx.currentTime);
    owned.push(drumTapeFilter);

    if (typeof ctx.createWaveShaper === 'function') {
      const shaper = ctx.createWaveShaper();
      shaper.curve = getTapeCurve();
      shaper.oversample = '2x';
      drumTapeFilter.connect(shaper);
      shaper.connect(busOut);
      owned.push(shaper);
    } else {
      drumTapeFilter.connect(busOut);
    }

    const wetInput = ctx.createGain();
    setParam(wetInput.gain, 1.0, ctx.currentTime);
    const wetOutput = ctx.createGain();
    setParam(wetOutput.gain, preset.wetMix, ctx.currentTime);
    wetOutput.connect(busOut);
    owned.push(wetInput, wetOutput);

    if (typeof ctx.createDelay === 'function') {
      const makeWashLeg = (delaySec: number) => {
        const d = ctx.createDelay(1.5);
        setParam(d.delayTime, delaySec, ctx.currentTime);
        const damp = ctx.createBiquadFilter();
        damp.type = 'lowpass';
        setParam(damp.frequency, 720, ctx.currentTime);
        setParam(damp.Q, 0.5, ctx.currentTime);
        const fb = ctx.createGain();
        setParam(fb.gain, 0.26, ctx.currentTime);
        const tap = ctx.createGain();
        setParam(tap.gain, 0.58, ctx.currentTime);
        d.connect(damp);
        damp.connect(fb);
        damp.connect(tap);
        tap.connect(wetOutput);
        owned.push(d, damp, fb, tap);
        return { d, fb };
      };
      const legA = makeWashLeg(0.34);
      const legB = makeWashLeg(0.53);
      wetInput.connect(legA.d);
      legA.fb.connect(legB.d);
      legB.fb.connect(legA.d);
    } else {
      wetInput.connect(wetOutput);
    }

    if (typeof ctx.createDynamicsCompressor === 'function') {
      const guard = ctx.createDynamicsCompressor();
      setParam(guard.threshold, -9, ctx.currentTime);
      setParam(guard.ratio, 3, ctx.currentTime);
      busOut.connect(guard);
      guard.connect(musicGain);
      owned.push(guard);
    } else {
      busOut.connect(musicGain);
    }

    this.graph = { ctx, musicGain, warmthFilter, drumTapeFilter, wetInput, wetOutput, ownedNodes: owned };
    return this.graph;
  }

  private fadeOutBus(ctx: AudioContext, bus: PresetBus, startAt: number, cleanupMs: number): void {
    const start = Math.max(ctx.currentTime, startAt);
    const stems = [bus.padMelBus, bus.drumBus, bus.wetBus];
    for (const node of stems) {
      node.gain.cancelScheduledValues?.(start);
      setParam(node.gain, Math.max(0.0001, node.gain.value || 1.0), start);
      node.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
    }
    const delayMs = Math.max(cleanupMs, Math.ceil((start - ctx.currentTime + 0.44) * 1000));
    const tid = setTimeout(() => {
      this.fadeTimers.delete(tid);
      disconnectAll(stems);
    }, delayMs);
    this.fadeTimers.add(tid);
  }

  private createPresetBus(
    ctx: AudioContext,
    graph: MasterMusicGraph,
    preset: AmbientPreset,
    downbeatTime: number
  ): PresetBus {
    const now = ctx.currentTime;
    const rampStart = Math.max(now, downbeatTime - 0.08);
    const rampTo = downbeatTime <= now + 0.01 ? now + 0.18 : downbeatTime;
    const drumTo = downbeatTime <= now + 0.01 ? now + 0.12 : downbeatTime;
    const rampOrigin = downbeatTime <= now + 0.01 ? now : rampStart;

    const makeStem = (target: AudioNode, endAt: number) => {
      const stem = ctx.createGain();
      stem.gain.setValueAtTime(0.0001, rampOrigin);
      stem.gain.linearRampToValueAtTime(1.0, endAt);
      stem.connect(target);
      return stem;
    };
    const padMelBus = makeStem(graph.warmthFilter, rampTo);
    const drumBus = makeStem(graph.drumTapeFilter, drumTo);
    const wetBus = makeStem(graph.wetInput, rampTo);

    const leadGain = ctx.createGain();
    setParam(leadGain.gain, 0.78, rampStart);
    const drySend = ctx.createGain();
    setParam(drySend.gain, 0.44, rampStart);
    const wetSend = ctx.createGain();
    setParam(wetSend.gain, 0.66, rampStart);
    leadGain.connect(drySend);
    leadGain.connect(wetSend);
    drySend.connect(padMelBus);
    wetSend.connect(wetBus);

    const beatDryGain = ctx.createGain();
    setParam(beatDryGain.gain, 1.0, rampStart);
    beatDryGain.connect(drumBus);

    const beatWetGain = ctx.createGain();
    setParam(beatWetGain.gain, 1.0, rampStart);
    beatWetGain.connect(wetBus);

    const prev = this.activeBus;
    if (prev) {
      this.fadeOutBus(ctx, prev, Math.max(now, downbeatTime - 0.04), 440);
    }

    const nextBus: PresetBus = { padMelBus, drumBus, wetBus, leadGain, beatDryGain, beatWetGain };
    this.activeBus = nextBus;
    targetParam(graph.warmthFilter.frequency, preset.warmthHz, rampStart, 0.1);
    targetParam(graph.wetOutput.gain, preset.wetMix, rampStart, 0.1);
    return nextBus;
  }

  private tickLookahead(ctx: AudioContext, musicGain: GainNode): void {
    if (ctx.state !== 'running') return;
    if (this.nextNoteTime < ctx.currentTime) {
      this.nextNoteTime = ctx.currentTime + 0.03;
    }
    while (this.nextNoteTime < ctx.currentTime + 0.26) {
      this.nextNoteTime += this.advanceStep(ctx, musicGain, this.nextNoteTime);
    }
  }

  /** Advances the scheduler by one 16th/12th step and returns its step duration in seconds. */
  public advanceStep(ctx: AudioContext, musicGain: GainNode, time: number): number {
    const graph = this.ensureGraph(ctx, musicGain);
    let preset = this.getPresetById(this.activePresetId);
    const initialBarLen = preset.pattern.length;
    const initialStepInBar = this.stepIndex % initialBarLen;

    if (initialStepInBar === 0 && this.stepIndex > 0 && this.barsInCurrentTrack >= AMBIENT_ROTATION_BARS) {
      const pool = SCENE_ROTATION_POOLS[this.currentScene];
      this.rotationIndex = (this.rotationIndex + 1) % pool.length;
      this.activePresetId = pool[this.rotationIndex];
      this.barsInCurrentTrack = 0;
      this.stepIndex = 0;
      this.chordIndex = 0;
      preset = this.getPresetById(this.activePresetId);
      this.createPresetBus(ctx, graph, preset, time);
    }

    const bus = this.activeBus ?? this.createPresetBus(ctx, graph, preset, time);
    const barLen = preset.pattern.length;
    const stepInBar = this.stepIndex % barLen;
    const chord = preset.chords[this.chordIndex % preset.chords.length];
    const swingShift = preset.swingSec > 0 && barLen === 16 && stepInBar % 2 === 1 ? preset.swingSec : 0;
    const eventTime = Math.max(ctx.currentTime + 0.01, time + swingShift);

    if (stepInBar === 0) {
      this.schedulePadBar(ctx, bus, preset, chord, barLen, eventTime);
    }
    if (stepInBar === 0 || stepInBar === Math.floor(barLen / 2)) {
      this.schedulePillowBass(ctx, bus, preset, chord, stepInBar === 0, eventTime);
    }

    this.scheduleDrumHit(ctx, bus, preset.drumPattern[stepInBar], eventTime, this.stepIndex);

    const patSlot = preset.pattern[stepInBar];
    const playChance =
      patSlot >= 0 && ((this.stepIndex * 37 + this.chordIndex * 13) % 100) / 100 < preset.rubatoChance;
    if (playChance) {
      this.scheduleFeltMalletNote(ctx, bus, preset, chord, patSlot, eventTime);
    }

    this.stepIndex += 1;
    if (this.stepIndex % barLen === 0) {
      this.chordIndex = (this.chordIndex + 1) % preset.chords.length;
      this.barsInCurrentTrack += 1;
    }
    return preset.stepSec;
  }

  private schedulePadBar(
    ctx: AudioContext,
    bus: PresetBus,
    preset: AmbientPreset,
    chord: AmbientChord,
    barLen: number,
    eventTime: number
  ): void {
    const barDur = preset.stepSec * barLen * 1.45;
    const freqs = [chord.root, ...chord.pad];
    for (let i = 0; i < freqs.length; i++) {
      const detuneVals = i === 1 ? [0, 2] : [0];
      const baseAmp = preset.padAmp / (detuneVals.length * Math.sqrt(freqs.length) * 1.15);
      const voiceAmp = i === 0 ? baseAmp * 0.55 : baseAmp;
      for (const dt of detuneVals) {
        const osc = ctx.createOscillator();
        const lp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        osc.type = i === 0 ? 'sine' : preset.padWave;
        setParam(osc.frequency, freqs[i], eventTime);
        if (dt !== 0) setParam(osc.detune, dt, eventTime);

        lp.type = 'lowpass';
        setParam(lp.frequency, preset.padCutoff, eventTime);
        setParam(lp.Q, 0.55, eventTime);

        g.gain.setValueAtTime(0.0003, eventTime);
        g.gain.linearRampToValueAtTime(voiceAmp, eventTime + barDur * 0.28);
        g.gain.linearRampToValueAtTime(voiceAmp * 0.86, eventTime + barDur * 0.74);
        g.gain.exponentialRampToValueAtTime(0.0003, eventTime + barDur);

        osc.connect(lp);
        lp.connect(g);
        g.connect(bus.padMelBus);
        if (preset.wetMix > 0) {
          const send = ctx.createGain();
          setParam(send.gain, 0.2, eventTime);
          g.connect(send);
          send.connect(bus.wetBus);
        }
        osc.start(eventTime);
        osc.stop(eventTime + barDur + 0.06);
      }
    }
  }

  private schedulePillowBass(
    ctx: AudioContext,
    bus: PresetBus,
    preset: AmbientPreset,
    chord: AmbientChord,
    isBeatOne: boolean,
    eventTime: number
  ): void {
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'triangle';
    setParam(osc.frequency, isBeatOne ? chord.root : chord.pad[0], eventTime);
    lp.type = 'lowpass';
    setParam(lp.frequency, 240, eventTime);
    setParam(lp.Q, 0.6, eventTime);

    const bassDur = Math.max(0.32, preset.stepSec * 4.5);
    g.gain.setValueAtTime(0.0002, eventTime);
    g.gain.linearRampToValueAtTime(0.0756, eventTime + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0002, eventTime + bassDur);

    osc.connect(lp);
    lp.connect(g);
    g.connect(bus.padMelBus);
    osc.start(eventTime);
    osc.stop(eventTime + bassDur + 0.05);
  }

  private scheduleFeltMalletNote(
    ctx: AudioContext,
    bus: PresetBus,
    preset: AmbientPreset,
    chord: AmbientChord,
    patSlot: number,
    nt: number
  ): void {
    const noteFreq = chord.motif[patSlot % chord.motif.length];
    const rel = preset.stepSec * preset.arpReleaseMul;
    const endT = nt + Math.max(preset.arpAttack + 0.14, rel);

    const noteLp = ctx.createBiquadFilter();
    noteLp.type = 'lowpass';
    setParam(noteLp.frequency, preset.noteLpHz, nt);
    noteLp.frequency.exponentialRampToValueAtTime(Math.max(380, preset.noteLpHz * 0.68), nt + 0.24);
    setParam(noteLp.Q, 0.55, nt);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0002, nt);
    g.gain.linearRampToValueAtTime(preset.arpAmp * 0.35, nt + preset.arpAttack * 0.45);
    g.gain.linearRampToValueAtTime(preset.arpAmp, nt + preset.arpAttack);
    g.gain.exponentialRampToValueAtTime(0.0002, endT);

    const osc = ctx.createOscillator();
    osc.type = preset.arpWave;
    setParam(osc.frequency, noteFreq, nt);
    osc.connect(noteLp);

    const warmTwin = ctx.createOscillator();
    const warmGain = ctx.createGain();
    warmTwin.type = 'sine';
    setParam(warmTwin.frequency, noteFreq * 1.001155, nt);
    setParam(warmGain.gain, 0.25, nt);
    warmTwin.connect(warmGain);
    warmGain.connect(noteLp);

    noteLp.connect(g);
    g.connect(bus.leadGain);
    osc.start(nt);
    warmTwin.start(nt);
    osc.stop(endT + 0.06);
    warmTwin.stop(endT + 0.06);
  }

  private playFilteredNoiseLayer(ctx: AudioContext, bus: PresetBus, spec: NoiseLayerSpec): void {
    const src = ctx.createBufferSource();
    src.buffer = spec.buffer;
    let tail: AudioNode = src;
    for (const f of spec.filters) {
      const node = ctx.createBiquadFilter();
      node.type = f.type;
      setParam(node.frequency, f.freq, spec.when);
      setParam(node.Q, f.q, spec.when);
      tail.connect(node);
      tail = node;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0002, spec.when);
    g.gain.linearRampToValueAtTime(spec.peak, spec.when + spec.attack);
    g.gain.exponentialRampToValueAtTime(0.0002, spec.when + spec.decay);
    tail.connect(g);
    g.connect(bus.beatDryGain);
    if (spec.wetGain > 0) {
      const wetSend = ctx.createGain();
      setParam(wetSend.gain, spec.wetGain, spec.when);
      g.connect(wetSend);
      wetSend.connect(bus.beatWetGain);
    }
    src.start(spec.when, spec.offset, spec.readDur);
    src.stop(spec.stopAt);
  }

  private scheduleDrumHit(
    ctx: AudioContext,
    bus: PresetBus,
    token: DrumToken,
    nt: number,
    stepNum: number
  ): void {
    if (token === '.') return;
    const buffer = prewarmAmbientMusicBuffer(ctx);
    const offset = (stepNum * 0.17) % 0.55;

    if (token === 'K' || token === 'k') {
      const scale = token === 'K' ? 1.0 : 0.58;
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = 'triangle';
      setParam(osc.frequency, 150, nt);
      osc.frequency.exponentialRampToValueAtTime(72, nt + 0.032);
      osc.frequency.exponentialRampToValueAtTime(49, nt + 0.16);
      lp.type = 'lowpass';
      setParam(lp.frequency, 260, nt);
      setParam(lp.Q, 0.7, nt);
      g.gain.setValueAtTime(0.0002, nt);
      g.gain.linearRampToValueAtTime(0.4 * scale, nt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0002, nt + 0.21);
      osc.connect(lp);
      lp.connect(g);
      g.connect(bus.beatDryGain);
      osc.start(nt);
      osc.stop(nt + 0.23);

      this.playFilteredNoiseLayer(ctx, bus, {
        buffer,
        offset,
        when: nt,
        readDur: 0.04,
        stopAt: nt + 0.035,
        peak: 0.13 * scale,
        attack: 0.002,
        decay: 0.024,
        wetGain: 0,
        filters: [{ type: 'bandpass', freq: 380, q: 1.2 }],
      });
      return;
    }

    if (token === 'S') {
      const sOsc = ctx.createOscillator();
      const sGain = ctx.createGain();
      sOsc.type = 'sine';
      setParam(sOsc.frequency, 225, nt);
      sOsc.frequency.exponentialRampToValueAtTime(122, nt + 0.042);
      sGain.gain.setValueAtTime(0.0002, nt);
      sGain.gain.linearRampToValueAtTime(0.23, nt + 0.003);
      sGain.gain.exponentialRampToValueAtTime(0.0002, nt + 0.085);
      sOsc.connect(sGain);
      sGain.connect(bus.beatDryGain);
      sOsc.start(nt);
      sOsc.stop(nt + 0.1);

      this.playFilteredNoiseLayer(ctx, bus, {
        buffer,
        offset,
        when: nt,
        readDur: 0.15,
        stopAt: nt + 0.13,
        peak: 0.21,
        attack: 0.003,
        decay: 0.115,
        wetGain: 0.16,
        filters: [
          { type: 'bandpass', freq: 1450, q: 0.75 },
          { type: 'lowpass', freq: 2600, q: 0.6 },
        ],
      });
      return;
    }

    if (token === 'R' || token === 'r') {
      const scale = token === 'R' ? 1.0 : 0.5;
      const kOsc = ctx.createOscillator();
      const kLp = ctx.createBiquadFilter();
      const kGain = ctx.createGain();
      kOsc.type = 'triangle';
      setParam(kOsc.frequency, 360, nt);
      kOsc.frequency.exponentialRampToValueAtTime(170, nt + 0.022);
      kLp.type = 'lowpass';
      setParam(kLp.frequency, 950, nt);
      setParam(kLp.Q, 0.7, nt);
      kGain.gain.setValueAtTime(0.0002, nt);
      kGain.gain.linearRampToValueAtTime(0.19 * scale, nt + 0.0025);
      kGain.gain.exponentialRampToValueAtTime(0.0002, nt + 0.05);
      kOsc.connect(kLp);
      kLp.connect(kGain);
      kGain.connect(bus.beatDryGain);
      kOsc.start(nt);
      kOsc.stop(nt + 0.065);

      this.playFilteredNoiseLayer(ctx, bus, {
        buffer,
        offset,
        when: nt,
        readDur: 0.07,
        stopAt: nt + 0.06,
        peak: 0.12 * scale,
        attack: 0.002,
        decay: 0.045,
        wetGain: 0.14,
        filters: [{ type: 'bandpass', freq: 1650, q: 1.1 }],
      });
      return;
    }

    const dec = token === 'O' ? 0.095 : 0.038;
    this.playFilteredNoiseLayer(ctx, bus, {
      buffer,
      offset,
      when: nt,
      readDur: dec + 0.03,
      stopAt: nt + dec + 0.02,
      peak: token === 'H' ? 0.08 : token === 'O' ? 0.07 : 0.045,
      attack: 0.0025,
      decay: dec,
      wetGain: token === 'O' ? 0.1 : 0,
      filters: [
        { type: 'highpass', freq: 1800, q: 0.6 },
        { type: 'lowpass', freq: 3200, q: 0.6 },
      ],
    });
  }
}
