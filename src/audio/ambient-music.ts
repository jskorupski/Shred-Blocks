import {
  AMBIENT_PRESETS,
  AMBIENT_ROTATION_BARS,
  type AmbientChord,
  type AmbientPreset,
  type AmbientPresetId,
  type AnalogArpConfig,
  type JunoPadOpts,
  type MoogBassOpts,
  type MusicScene,
  SCENE_ROTATION_POOLS,
} from './ambient-presets';

export {
  AMBIENT_PRESETS,
  AMBIENT_ROTATION_BARS,
  type AmbientChord,
  type AmbientPreset,
  type AmbientPresetId,
  type MusicScene,
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

function linearRamp(param: AudioParam | undefined, value: number, time: number): void {
  if (!param) return;
  if (typeof param.linearRampToValueAtTime === 'function') {
    param.linearRampToValueAtTime(value, time);
  } else {
    setParam(param, value, time);
  }
}

function expRamp(param: AudioParam | undefined, value: number, time: number): void {
  if (!param) return;
  if (typeof param.exponentialRampToValueAtTime === 'function') {
    param.exponentialRampToValueAtTime(value, time);
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

function stopOscs(oscs: ReadonlyArray<OscillatorNode>): void {
  for (const osc of oscs) {
    try {
      osc.stop();
    } catch {}
  }
}

interface MasterSynthwaveGraph {
  readonly ctx: AudioContext;
  readonly musicGain: GainNode;
  readonly dryBus: GainNode;
  readonly chorusIn: GainNode;
  readonly washIn: GainNode;
  readonly wowDepthGain: GainNode;
  readonly ownedNodes: ReadonlyArray<AudioNode>;
  readonly ownedOscs: ReadonlyArray<OscillatorNode>;
}

interface PresetStem {
  readonly dry: GainNode;
  readonly wet: GainNode;
  readonly chorus: GainNode;
}

/**
 * Mode-attuned drumless Warm Analog Synthwave controller featuring Juno-60 stereo chorus,
 * 860 Hz vintage tape echo, analog wow modulation, pure-pentatonic stacks, and 32-bar rotation.
 */
export class AmbientMusicController {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private graph: MasterSynthwaveGraph | null = null;
  private activeStem: PresetStem | null = null;
  private readonly fadeTimers = new Set<ReturnType<typeof setTimeout>>();

  private currentScene: MusicScene = 'MENU';
  private rotationIndex = 0;
  private activePresetId: AmbientPresetId = SCENE_ROTATION_POOLS.MENU[0];
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
      this.createPresetStem(ctx, graph, ctx.currentTime);
      this.nextNoteTime = ctx.currentTime + 0.06;
    }
  }

  public start(ctx: AudioContext, musicGain: GainNode): void {
    if (this.timerId !== null) return;
    const graph = this.ensureGraph(ctx, musicGain);
    if (!this.activeStem) {
      this.createPresetStem(ctx, graph, ctx.currentTime);
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
    if (this.activeStem && this.graph) {
      const ctx = this.graph.ctx;
      const old = this.activeStem;
      this.activeStem = null;
      this.fadeOutStem(ctx, old, ctx.currentTime);
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
    if (this.activeStem) {
      disconnectAll([this.activeStem.dry, this.activeStem.wet, this.activeStem.chorus]);
      this.activeStem = null;
    }
    if (this.graph) {
      stopOscs(this.graph.ownedOscs);
      disconnectAll(this.graph.ownedNodes);
      this.graph = null;
    }
  }

  private ensureGraph(ctx: AudioContext, musicGain: GainNode): MasterSynthwaveGraph {
    if (this.graph && this.graph.ctx === ctx && this.graph.musicGain === musicGain) {
      return this.graph;
    }
    if (this.graph) {
      stopOscs(this.graph.ownedOscs);
      disconnectAll(this.graph.ownedNodes);
      this.graph = null;
      this.activeStem = null;
    }

    const now = ctx.currentTime;
    const ownedNodes: AudioNode[] = [];
    const ownedOscs: OscillatorNode[] = [];

    const dryBus = ctx.createGain();
    setParam(dryBus.gain, 1.0, now);
    ownedNodes.push(dryBus);

    if (typeof ctx.createDynamicsCompressor === 'function') {
      const comp = ctx.createDynamicsCompressor();
      setParam(comp.threshold, -4, now);
      setParam(comp.ratio, 3, now);
      dryBus.connect(comp);
      comp.connect(musicGain);
      ownedNodes.push(comp);
    } else {
      dryBus.connect(musicGain);
    }

    // Analog Tape Wow LFO (0.31 Hz, +-2.5 cents on sustained pads)
    const wowLfo = ctx.createOscillator();
    const wowDepthGain = ctx.createGain();
    wowLfo.type = 'sine';
    setParam(wowLfo.frequency, 0.31, now);
    setParam(wowDepthGain.gain, 2.5, now);
    wowLfo.connect(wowDepthGain);
    wowLfo.start();
    ownedOscs.push(wowLfo);
    ownedNodes.push(wowLfo, wowDepthGain);

    // Juno-60 Stereo Chorus (I+II)
    const chorusIn = ctx.createGain();
    const chorusOut = ctx.createGain();
    setParam(chorusIn.gain, 1.0, now);
    setParam(chorusOut.gain, 0.84, now);
    chorusIn.connect(chorusOut);
    chorusOut.connect(dryBus);
    ownedNodes.push(chorusIn, chorusOut);

    const chorusLp = ctx.createBiquadFilter();
    chorusLp.type = 'lowpass';
    setParam(chorusLp.frequency, 1750, now);
    chorusIn.connect(chorusLp);
    ownedNodes.push(chorusLp);

    if (typeof ctx.createDelay === 'function') {
      const voices = [
        { delay: 0.013, rate: 0.38, pan: -0.6 },
        { delay: 0.019, rate: 0.49, pan: 0.6 },
      ];
      for (const voice of voices) {
        const d = ctx.createDelay(0.1);
        setParam(d.delayTime, voice.delay, now);
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.type = 'sine';
        setParam(lfo.frequency, voice.rate, now);
        setParam(lfoGain.gain, 0.0024, now);
        lfo.connect(lfoGain);
        lfoGain.connect(d.delayTime);
        lfo.start();
        ownedOscs.push(lfo);

        const g = ctx.createGain();
        setParam(g.gain, 0.42, now);
        chorusLp.connect(d);
        d.connect(g);
        ownedNodes.push(d, lfo, lfoGain, g);

        if (typeof ctx.createStereoPanner === 'function') {
          const pan = ctx.createStereoPanner();
          setParam(pan.pan, voice.pan, now);
          g.connect(pan);
          pan.connect(chorusOut);
          ownedNodes.push(pan);
        } else {
          g.connect(chorusOut);
        }
      }
    }

    // Vintage Tape Echo / Horizon Wash
    const washIn = ctx.createGain();
    const washOut = ctx.createGain();
    setParam(washIn.gain, 1.0, now);
    setParam(washOut.gain, 0.48, now);
    washOut.connect(dryBus);
    ownedNodes.push(washIn, washOut);

    if (typeof ctx.createDelay === 'function') {
      const delayA = ctx.createDelay(1.5);
      const delayB = ctx.createDelay(1.5);
      setParam(delayA.delayTime, 0.31, now);
      setParam(delayB.delayTime, 0.46, now);

      const dampA = ctx.createBiquadFilter();
      const dampB = ctx.createBiquadFilter();
      dampA.type = 'lowpass';
      dampB.type = 'lowpass';
      setParam(dampA.frequency, 860, now);
      setParam(dampB.frequency, 860, now);

      const fbA = ctx.createGain();
      const fbB = ctx.createGain();
      setParam(fbA.gain, 0.34, now);
      setParam(fbB.gain, 0.34, now);

      washIn.connect(delayA);
      delayA.connect(dampA);
      dampA.connect(fbA);
      fbA.connect(delayB);
      delayB.connect(dampB);
      dampB.connect(fbB);
      fbB.connect(delayA);
      ownedNodes.push(delayA, delayB, dampA, dampB, fbA, fbB);

      if (typeof ctx.createStereoPanner === 'function') {
        const pA = ctx.createStereoPanner();
        const pB = ctx.createStereoPanner();
        setParam(pA.pan, -0.45, now);
        setParam(pB.pan, 0.45, now);
        dampA.connect(pA);
        dampB.connect(pB);
        pA.connect(washOut);
        pB.connect(washOut);
        ownedNodes.push(pA, pB);
      } else {
        dampA.connect(washOut);
        dampB.connect(washOut);
      }
    } else {
      washIn.connect(washOut);
    }

    this.graph = { ctx, musicGain, dryBus, chorusIn, washIn, wowDepthGain, ownedNodes, ownedOscs };
    return this.graph;
  }

  private fadeOutStem(ctx: AudioContext, stem: PresetStem, startAt: number): void {
    const start = Math.max(ctx.currentTime, startAt);
    const nodes = [stem.dry, stem.wet, stem.chorus];
    for (const node of nodes) {
      node.gain.cancelScheduledValues?.(start);
      setParam(node.gain, Math.max(0.0001, node.gain.value || 1.0), start);
      expRamp(node.gain, 0.0001, start + 0.36);
    }
    const delayMs = Math.max(420, Math.ceil((start - ctx.currentTime + 0.42) * 1000));
    const tid = setTimeout(() => {
      this.fadeTimers.delete(tid);
      disconnectAll(nodes);
    }, delayMs);
    this.fadeTimers.add(tid);
  }

  private createPresetStem(ctx: AudioContext, graph: MasterSynthwaveGraph, downbeatTime: number): PresetStem {
    const now = ctx.currentTime;
    const rampStart = downbeatTime <= now + 0.01 ? now : Math.max(now, downbeatTime - 0.04);
    const makeGain = (target: AudioNode) => {
      const g = ctx.createGain();
      setParam(g.gain, 0.0001, rampStart);
      linearRamp(g.gain, 1.0, rampStart + 0.22);
      g.connect(target);
      return g;
    };

    const nextStem: PresetStem = {
      dry: makeGain(graph.dryBus),
      wet: makeGain(graph.washIn),
      chorus: makeGain(graph.chorusIn),
    };
    const prev = this.activeStem;
    if (prev) {
      this.fadeOutStem(ctx, prev, Math.max(now, downbeatTime - 0.04));
    }
    this.activeStem = nextStem;
    return nextStem;
  }

  private tickLookahead(ctx: AudioContext, musicGain: GainNode): void {
    if (ctx.state !== 'running') return;
    if (this.nextNoteTime < ctx.currentTime) {
      this.nextNoteTime = ctx.currentTime + 0.03;
    }
    while (this.nextNoteTime < ctx.currentTime + 0.24) {
      this.nextNoteTime += this.advanceStep(ctx, musicGain, this.nextNoteTime);
    }
  }

  /** Advances the step scheduler by one 16th note and returns its step duration in seconds. */
  public advanceStep(ctx: AudioContext, musicGain: GainNode, time: number): number {
    const graph = this.ensureGraph(ctx, musicGain);
    let preset = this.getPresetById(this.activePresetId);
    const initialBarLen = preset.arpPattern.length;
    const initialStepInBar = this.stepIndex % initialBarLen;

    if (initialStepInBar === 0 && this.stepIndex > 0 && this.barsInCurrentTrack >= AMBIENT_ROTATION_BARS) {
      const pool = SCENE_ROTATION_POOLS[this.currentScene];
      this.rotationIndex = (this.rotationIndex + 1) % pool.length;
      this.activePresetId = pool[this.rotationIndex];
      this.barsInCurrentTrack = 0;
      this.stepIndex = 0;
      this.chordIndex = 0;
      preset = this.getPresetById(this.activePresetId);
      this.createPresetStem(ctx, graph, time);
    }

    const stem = this.activeStem ?? this.createPresetStem(ctx, graph, time);
    const barLen = preset.arpPattern.length;
    const stepInBar = this.stepIndex % barLen;
    const chord = preset.chords[this.chordIndex % preset.chords.length];
    const nt = Math.max(ctx.currentTime + 0.01, time);
    const barDur = preset.stepSec * barLen;
    const slot = preset.arpPattern[stepInBar];

    this.schedulePresetStep(ctx, graph, stem, preset, chord, stepInBar, barDur, slot, nt);

    this.stepIndex += 1;
    if (this.stepIndex % barLen === 0) {
      this.chordIndex = (this.chordIndex + 1) % preset.chords.length;
      this.barsInCurrentTrack += 1;
    }
    return preset.stepSec;
  }

  private schedulePresetStep(
    ctx: AudioContext,
    graph: MasterSynthwaveGraph,
    stem: PresetStem,
    preset: AmbientPreset,
    chord: AmbientChord,
    stepInBar: number,
    barDur: number,
    slot: number,
    nt: number
  ): void {
    if (stepInBar === 0) {
      this.playJunoPad(ctx, graph, stem, chord.pad, nt, barDur, preset.pad);
    } else if (stepInBar === 8 && preset.innerPadStep8) {
      this.playJunoPad(ctx, graph, stem, [chord.pad[0], chord.pad[2]], nt, barDur, preset.innerPadStep8);
    }

    if (stepInBar % preset.bass.stepMod === 0) {
      const bassDur = preset.bass.fixedDur ?? barDur * (preset.bass.durScale ?? 1.0);
      const amp = stepInBar % 4 === 0 ? preset.bass.amp : preset.bass.ampOff;
      this.playMoogBass(ctx, stem, chord.bass, nt, bassDur, preset.bass, amp);
    }

    if (preset.lead) {
      if (stepInBar === preset.lead.stepA && chord.leadA !== null) {
        this.playAnalogLeadSigh(ctx, stem, chord.leadA, nt, barDur * preset.lead.durA, preset.lead.ampA);
      } else if (preset.lead.stepB !== undefined && stepInBar === preset.lead.stepB && chord.leadB !== null) {
        const durB = preset.lead.durB ?? preset.lead.durA;
        const ampB = preset.lead.ampB ?? preset.lead.ampA;
        this.playAnalogLeadSigh(ctx, stem, chord.leadB, nt, barDur * durB, ampB);
      }
    }

    if (slot >= 0) {
      const noteFreq = preset.arp[slot % preset.arp.length];
      if (preset.arpVoice === 'pluck') {
        this.playHorizonPluck(ctx, stem, noteFreq, nt);
      } else {
        this.playAnalogArp(ctx, stem, noteFreq, nt, preset.arpVoice);
      }
    }
  }

  private playJunoPad(
    ctx: AudioContext,
    graph: MasterSynthwaveGraph,
    stem: PresetStem,
    freqs: ReadonlyArray<number>,
    when: number,
    barDur: number,
    opts: JunoPadOpts
  ): void {
    const dur = barDur * opts.durScale;
    const cutPeak = opts.cutPeak ?? opts.cutStart;
    const cutEnd = opts.cutEnd ?? opts.cutStart;

    for (const freq of freqs) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      setParam(lp.frequency, opts.cutStart, when);
      if (cutPeak !== opts.cutStart) {
        linearRamp(lp.frequency, cutPeak, when + opts.attack);
        expRamp(lp.frequency, Math.max(200, cutEnd), when + dur * 0.85);
      }
      setParam(lp.Q, 0.6, when);

      const g = ctx.createGain();
      setParam(g.gain, 0.0002, when);
      linearRamp(g.gain, opts.amp, when + opts.attack);
      linearRamp(g.gain, opts.amp * 0.85, when + dur * 0.76);
      expRamp(g.gain, 0.0002, when + dur);

      const stack: ReadonlyArray<{
        readonly type: OscillatorType;
        readonly dt: number;
        readonly gain: number;
      }> = [
        { type: 'sawtooth', dt: -7, gain: 0.34 },
        { type: 'sawtooth', dt: 7, gain: 0.34 },
        { type: 'triangle', dt: 0, gain: 0.44 },
      ];
      for (const voice of stack) {
        const osc = ctx.createOscillator();
        const vg = ctx.createGain();
        osc.type = voice.type;
        setParam(osc.frequency, freq, when);
        setParam(osc.detune, voice.dt, when);
        graph.wowDepthGain.connect(osc.detune);
        setParam(vg.gain, voice.gain, when);
        osc.connect(vg);
        vg.connect(lp);
        osc.start(when);
        osc.stop(when + dur + 0.06);
      }

      lp.connect(g);
      g.connect(stem.chorus);
      const ws = ctx.createGain();
      setParam(ws.gain, opts.wetAmt, when);
      g.connect(ws);
      ws.connect(stem.wet);
    }
  }

  private playMoogBass(
    ctx: AudioContext,
    stem: PresetStem,
    freq: number,
    when: number,
    dur: number,
    opts: MoogBassOpts,
    amp: number
  ): void {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    setParam(lp.frequency, opts.cutoff, when);
    setParam(lp.Q, 0.75, when);

    const g = ctx.createGain();
    setParam(g.gain, 0.0002, when);
    linearRamp(g.gain, amp, when + opts.attack);
    linearRamp(g.gain, amp * 0.82, when + dur * 0.7);
    expRamp(g.gain, 0.0002, when + dur);

    const sub = ctx.createOscillator();
    const subG = ctx.createGain();
    sub.type = 'sine';
    setParam(sub.frequency, freq, when);
    setParam(subG.gain, 0.85, when);
    sub.connect(subG);
    subG.connect(lp);

    if (opts.sawAmt > 0) {
      const saw = ctx.createOscillator();
      const sawG = ctx.createGain();
      saw.type = 'sawtooth';
      setParam(saw.frequency, freq, when);
      setParam(sawG.gain, opts.sawAmt, when);
      saw.connect(sawG);
      sawG.connect(lp);
      saw.start(when);
      saw.stop(when + dur + 0.04);
    }

    lp.connect(g);
    g.connect(stem.dry);
    sub.start(when);
    sub.stop(when + dur + 0.04);
  }

  private playAnalogArp(
    ctx: AudioContext,
    stem: PresetStem,
    freq: number,
    when: number,
    opts: AnalogArpConfig
  ): void {
    const lfoPhase = this.stepIndex * opts.cutLfoRate;
    const lfoVal = opts.cutLfoFn === 'cos' ? Math.cos(lfoPhase) : Math.sin(lfoPhase);
    const cutHi = opts.cutBase + opts.cutLfoAmp * lfoVal;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    setParam(lp.frequency, cutHi, when);
    expRamp(lp.frequency, opts.cutLo, when + Math.min(opts.decay * 0.72, 0.44));
    setParam(lp.Q, opts.q, when);

    const g = ctx.createGain();
    setParam(g.gain, 0.0002, when);
    linearRamp(g.gain, opts.amp, when + opts.attack);
    expRamp(g.gain, 0.0002, when + opts.decay);

    const tri = ctx.createOscillator();
    const saw = ctx.createOscillator();
    const sawG = ctx.createGain();
    tri.type = 'triangle';
    saw.type = 'sawtooth';
    setParam(tri.frequency, freq, when);
    setParam(saw.frequency, freq, when);
    setParam(saw.detune, 3.5, when);
    setParam(sawG.gain, opts.sawMix, when);

    tri.connect(lp);
    saw.connect(sawG);
    sawG.connect(lp);
    lp.connect(g);
    g.connect(stem.chorus);

    const ws = ctx.createGain();
    setParam(ws.gain, opts.wetAmt, when);
    g.connect(ws);
    ws.connect(stem.wet);

    tri.start(when);
    saw.start(when);
    tri.stop(when + opts.decay + 0.05);
    saw.stop(when + opts.decay + 0.05);
  }

  private playHorizonPluck(ctx: AudioContext, stem: PresetStem, freq: number, when: number): void {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    setParam(lp.frequency, 660, when);
    expRamp(lp.frequency, 310, when + 0.55);
    setParam(lp.Q, 0.6, when);

    const g = ctx.createGain();
    setParam(g.gain, 0.0002, when);
    linearRamp(g.gain, 0.072, when + 0.042);
    expRamp(g.gain, 0.0002, when + 1.05);

    const tri = ctx.createOscillator();
    const oct = ctx.createOscillator();
    const octG = ctx.createGain();
    tri.type = 'triangle';
    oct.type = 'sine';
    setParam(tri.frequency, freq, when);
    setParam(oct.frequency, freq * 2, when);
    setParam(octG.gain, 0.14, when);

    tri.connect(lp);
    oct.connect(octG);
    octG.connect(lp);
    lp.connect(g);
    g.connect(stem.chorus);

    const ws = ctx.createGain();
    setParam(ws.gain, 0.85, when);
    g.connect(ws);
    ws.connect(stem.wet);

    tri.start(when);
    oct.start(when);
    tri.stop(when + 1.1);
    oct.stop(when + 1.1);
  }

  private playAnalogLeadSigh(
    ctx: AudioContext,
    stem: PresetStem,
    freq: number,
    when: number,
    dur: number,
    amp: number
  ): void {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    setParam(lp.frequency, 820, when);
    setParam(lp.Q, 0.7, when);

    const g = ctx.createGain();
    setParam(g.gain, 0.0002, when);
    linearRamp(g.gain, amp, when + 0.42);
    linearRamp(g.gain, amp * 0.72, when + dur * 0.65);
    expRamp(g.gain, 0.0002, when + dur);

    const vib = ctx.createOscillator();
    const vibG = ctx.createGain();
    vib.type = 'sine';
    setParam(vib.frequency, 4.6, when);
    setParam(vibG.gain, freq * 0.004, when);
    vib.connect(vibG);

    const stack: ReadonlyArray<{
      readonly type: OscillatorType;
      readonly dt: number;
      readonly gain: number;
    }> = [
      { type: 'triangle', dt: -3.5, gain: 0.65 },
      { type: 'sawtooth', dt: 3.5, gain: 0.32 },
    ];
    for (const voice of stack) {
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = voice.type;
      setParam(osc.frequency, freq, when);
      setParam(osc.detune, voice.dt, when);
      vibG.connect(osc.frequency);
      setParam(og.gain, voice.gain, when);
      osc.connect(og);
      og.connect(lp);
      osc.start(when);
      osc.stop(when + dur + 0.06);
    }

    lp.connect(g);
    g.connect(stem.chorus);
    const ws = ctx.createGain();
    setParam(ws.gain, 0.75, when);
    g.connect(ws);
    ws.connect(stem.wet);

    vib.start(when);
    vib.stop(when + dur + 0.06);
  }
}
