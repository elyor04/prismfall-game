// Fully procedural audio: every sound effect is synthesised with WebAudio and
// the soundtrack is a small generative sequencer whose layers open up as the
// run gets more intense. No audio files ship with the game.

export type Sfx =
  | "shoot" | "hit" | "kill" | "boom" | "pickup" | "levelup" | "hurt" | "dash"
  | "nova" | "zap" | "missile" | "warn" | "ui" | "uiBack" | "victory" | "heal" | "elite";

const MIN_GAP: Partial<Record<Sfx, number>> = {
  shoot: 0.045, hit: 0.03, kill: 0.028, pickup: 0.018, zap: 0.06, missile: 0.05, boom: 0.08, elite: 0.2,
};

// A minor: Am F C G, boss: Am Bb Am E (MIDI root notes, octave 2).
const PROG_NORMAL = [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]];
const PROG_BOSS = [[45, 48, 52], [46, 50, 53], [45, 48, 52], [40, 44, 47]];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private last = new Map<Sfx, number>();
  private vol = { master: 0.8, music: 0.6, sfx: 0.8 };

  private seqTimer: number | null = null;
  private nextStepTime = 0;
  private step = 0;
  private bpm = 116;
  intensity = 0;
  boss = false;
  private muffled = true;
  sfxEnabled = true;

  /** Must be called from a user gesture on first use (autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: "interactive" });
      this.ctx = ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = "lowpass";
      this.musicFilter.frequency.value = 900;
      this.musicFilter.Q.value = 0.7;
      this.musicBus = ctx.createGain();
      this.musicBus.connect(this.musicFilter).connect(this.master);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.noise = this.makeNoise(ctx);
      this.applyVolumes();
      this.setMuffled(this.muffled);
    }
    if (this.needsResume()) void this.ctx.resume();
    if (this.seqTimer === null) this.startMusic();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.vol = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx * 0.9, t, 0.05);
  }

  /** Muffle the soundtrack behind menus and pause screens. */
  setMuffled(m: boolean) {
    this.muffled = m;
    if (!this.ctx) return;
    this.musicFilter.frequency.setTargetAtTime(m ? 750 : 16000, this.ctx.currentTime, 0.25);
  }

  suspend() {
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.needsResume()) void this.ctx.resume();
  }

  /** WebKit uses "interrupted" after calls/Siri; anything but running or closed needs a resume. */
  private needsResume() {
    const st = this.ctx?.state as string | undefined;
    return st !== undefined && st !== "running" && st !== "closed";
  }

  private makeNoise(ctx: AudioContext) {
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private osc(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, out: AudioNode, attack = 0.004) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    this.env(g, t, peak, attack, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.02);
  }

  private noiseBurst(t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1: number, out: AudioNode, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = ctx.createBiquadFilter();
    flt.type = filter;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.003, dur);
    src.connect(flt).connect(g).connect(out);
    // Random offset into the 1 s noise buffer, leaving room for the whole burst.
    const room = (this.noise?.duration ?? 1) - (dur + 0.05) * src.playbackRate.value;
    src.start(t, Math.random() * Math.max(0, Math.min(0.5, room)));
    src.stop(t + dur + 0.05);
  }

  play(name: Sfx, pitch = 1, vol = 1) {
    if (!this.ctx || this.ctx.state !== "running" || !this.sfxEnabled) return;
    const now = this.ctx.currentTime;
    const gap = MIN_GAP[name];
    if (gap) {
      const l = this.last.get(name) ?? 0;
      if (now - l < gap) return;
      this.last.set(name, now);
    }
    const out = this.sfxBus;
    const t = now + 0.005;
    switch (name) {
      case "shoot":
        this.osc("square", 1300 * pitch, 520 * pitch, t, 0.06, 0.05 * vol, out);
        break;
      case "hit":
        this.noiseBurst(t, 0.045, 0.09 * vol, "bandpass", 2600 * pitch, 1400, out, 2);
        break;
      case "kill":
        this.osc("triangle", 340 * pitch, 60, t, 0.16, 0.16 * vol, out);
        this.noiseBurst(t, 0.12, 0.1 * vol, "lowpass", 3000, 300, out);
        break;
      case "boom":
        this.osc("sine", 130, 32, t, 0.6, 0.45 * vol, out);
        this.noiseBurst(t, 0.7, 0.35 * vol, "lowpass", 2400, 90, out);
        break;
      case "pickup": {
        // Rising pentatonic chime; pitch is the chain index.
        const steps = [0, 2, 4, 7, 9];
        const i = Math.floor(pitch);
        const semis = steps[i % 5] + 12 * Math.floor(i / 5);
        const f = midi(79 + Math.min(semis, 24));
        this.osc("sine", f, f, t, 0.09, 0.07 * vol, out);
        this.osc("triangle", f * 2, f * 2, t, 0.05, 0.02 * vol, out);
        break;
      }
      case "levelup": {
        const notes = [69, 73, 76, 81, 85];
        notes.forEach((n, i) => this.osc("triangle", midi(n), midi(n), t + i * 0.06, 0.28, 0.12 * vol, out));
        this.noiseBurst(t, 0.5, 0.05, "highpass", 6000, 9000, out);
        break;
      }
      case "hurt":
        this.osc("sawtooth", 220, 70, t, 0.28, 0.2 * vol, out);
        this.noiseBurst(t, 0.2, 0.18 * vol, "lowpass", 1800, 200, out);
        break;
      case "dash":
        this.noiseBurst(t, 0.2, 0.14 * vol, "bandpass", 600, 4200, out, 1.5);
        break;
      case "nova":
        this.osc("sine", 160, 40, t, 0.45, 0.32 * vol, out);
        this.noiseBurst(t, 0.4, 0.15 * vol, "bandpass", 400, 2400, out, 0.8);
        break;
      case "zap":
        this.osc("sawtooth", 1800 * pitch, 300, t, 0.09, 0.06 * vol, out);
        this.noiseBurst(t, 0.07, 0.06 * vol, "highpass", 3000, 6000, out);
        break;
      case "missile":
        this.noiseBurst(t, 0.12, 0.05 * vol, "bandpass", 1200, 3000, out, 3);
        break;
      case "warn":
        for (let i = 0; i < 3; i++) {
          this.osc("square", 440, 440, t + i * 0.42, 0.18, 0.08 * vol, out);
          this.osc("square", 330, 330, t + i * 0.42 + 0.2, 0.18, 0.08 * vol, out);
        }
        break;
      case "ui":
        this.osc("triangle", 900, 1200, t, 0.05, 0.06 * vol, out);
        break;
      case "uiBack":
        this.osc("triangle", 700, 450, t, 0.06, 0.05 * vol, out);
        break;
      case "victory": {
        const chord = [57, 64, 69, 73, 76];
        chord.forEach((n, i) => this.osc("sawtooth", midi(n), midi(n), t + i * 0.09, 1.6, 0.05 * vol, out, 0.05));
        break;
      }
      case "heal":
        [72, 76, 79].forEach((n, i) => this.osc("sine", midi(n), midi(n), t + i * 0.05, 0.2, 0.09 * vol, out));
        break;
      case "elite":
        this.osc("square", 220, 880, t, 0.3, 0.05 * vol, out);
        break;
    }
  }

  // ---------------------------------------------------------------- music

  private startMusic() {
    if (!this.ctx) return;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.seqTimer = window.setInterval(() => this.schedule(), 25);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextStepTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, sd: number) {
    const out = this.musicBus;
    const I = this.intensity;
    const prog = this.boss ? PROG_BOSS : PROG_NORMAL;
    const chord = prog[Math.floor(step / 16) % 4];
    const s = step % 16;

    // Pad: a soft detuned chord at the start of each bar.
    if (s === 0) {
      for (const n of chord) {
        for (const det of [-6, 6]) {
          const o = this.ctx!.createOscillator();
          const g = this.ctx!.createGain();
          o.type = "sawtooth";
          o.frequency.value = midi(n + 12);
          o.detune.value = det;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.018, t + sd * 4);
          g.gain.linearRampToValueAtTime(0.0001, t + sd * 16);
          o.connect(g).connect(out);
          o.start(t);
          o.stop(t + sd * 16 + 0.05);
        }
      }
    }

    // Kick
    const kick = I > 0.22 ? s % 4 === 0 : s === 0 || s === 8;
    if (kick) this.osc("sine", 150, 42, t, 0.22, 0.5 * (I > 0.22 ? 1 : 0.5), out, 0.002);

    // Clap
    if (I > 0.45 && (s === 4 || s === 12)) this.noiseBurst(t, 0.12, 0.12, "bandpass", 1500, 1100, out, 1.2);

    // Hats
    if (I > 0.12 && (s % 4 === 2 || (I > 0.72 && s % 2 === 1))) {
      this.noiseBurst(t, 0.03, s % 4 === 2 ? 0.05 : 0.025, "highpass", 8000, 8000, out);
    }

    // Bass: off-beat pulse on the root.
    if (s % 2 === 1 || (this.boss && s % 2 === 0)) {
      const f = midi(chord[0] - 12);
      const ctx = this.ctx!;
      const o = ctx.createOscillator();
      const flt = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.value = f;
      flt.type = "lowpass";
      flt.frequency.setValueAtTime(300 + I * 900, t);
      flt.frequency.exponentialRampToValueAtTime(120, t + sd * 0.9);
      this.env(g, t, 0.09 + I * 0.05, 0.004, sd * 0.9);
      o.connect(flt).connect(g).connect(out);
      o.start(t);
      o.stop(t + sd + 0.02);
    }

    // Arpeggio: opens up with intensity.
    const arpEvery = I > 0.6 || this.boss ? 1 : 2;
    if (I > 0.3 && s % arpEvery === 0) {
      const pattern = [0, 1, 2, 1, 2, 0, 1, 2];
      const idx = pattern[(s / arpEvery) % pattern.length];
      const oct = s >= 8 && I > 0.55 ? 24 : 12;
      const n = chord[idx] + oct + 12;
      this.osc(this.boss ? "sawtooth" : "square", midi(n), midi(n), t, sd * 0.8, 0.022 + I * 0.012, out);
    } else if (I <= 0.3 && s % 4 === 0) {
      // Gentle menu arpeggio.
      const n = chord[(s / 4) % 3] + 24;
      this.osc("triangle", midi(n), midi(n), t, sd * 3, 0.03, out, 0.01);
    }
  }
}
