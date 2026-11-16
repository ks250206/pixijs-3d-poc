import type { GameEvent, WorldState } from './types';

/** Small, asset-free synth. The context is created only after a user gesture. */
export class GameAudio {
  enabled = true;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastEvents: GameEvent[] | null = null;
  private lastHitAt = 0;

  constructor() {
    try { this.enabled = localStorage.getItem('null-uprising-sound') !== 'off'; } catch { /* Private browsing may deny storage. */ }
  }

  unlock(): void {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.context = new Ctor();
        this.master = this.context.createGain();
        this.master.gain.value = 0.22;
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -14;
        limiter.ratio.value = 6;
        this.master.connect(limiter);
        limiter.connect(this.context.destination);
        this.noise = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * 0.25), this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch {
      // A browser without usable audio can still run the game.
      this.context = null;
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try { localStorage.setItem('null-uprising-sound', this.enabled ? 'on' : 'off'); } catch { /* Optional preference. */ }
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.enabled ? 0.22 : 0, this.context.currentTime, 0.025);
    if (this.enabled) this.unlock();
    return this.enabled;
  }

  private tone(from: number, to: number, duration: number, volume = 0.3, type: OscillatorType = 'triangle', delay = 0): void {
    if (!this.context || !this.master) return;
    const t = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, from), t);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(t);
    oscillator.stop(t + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  private burst(duration: number, frequency: number, volume: number): void {
    if (!this.context || !this.master || !this.noise) return;
    const t = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency, t);
    filter.frequency.exponentialRampToValueAtTime(100, t + duration);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.master);
    source.start(t); source.stop(t + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  update(world: WorldState): void {
    if (world.events === this.lastEvents) return;
    this.lastEvents = world.events;
    if (!this.enabled || !this.context || this.context.state !== 'running' || document.hidden || world.phase === 'paused') return;
    // A large smash can hit many enemies at once; cap synthesis work per frame.
    for (const event of world.events.slice(0, 6)) {
      switch (event.type) {
        case 'hit': {
          if (this.context.currentTime - this.lastHitAt < 0.035) break;
          this.lastHitAt = this.context.currentTime;
          this.tone(150 + (event.intensity ?? 1) * 30, 45, 0.12, 0.48, 'square');
          this.burst(0.09, 3500, 0.34);
          break;
        }
        case 'jump': this.tone(170, 400, 0.14, 0.11); break;
        case 'dodge': this.burst(0.12, 2200, 0.12); break;
        case 'smash': this.tone(95, 32, 0.3, 0.58, 'sawtooth'); this.burst(0.22, 5800, 0.5); break;
        case 'special': this.tone(740, 120, 0.32, 0.22, 'sawtooth'); this.tone(110, 900, 0.18, 0.16); break;
        case 'grab': this.tone(200, 140, 0.07, 0.2, 'square'); break;
        case 'throw': this.tone(350, 65, 0.2, 0.34); this.burst(0.1, 2600, 0.2); break;
        case 'ko':
          this.burst(0.23, 7000, 0.52);
          this.tone(70, 28, 0.45, 0.5, 'sawtooth');
          [440, 660, 880].forEach((note, i) => this.tone(note, note * 0.95, 0.18, 0.13, 'sine', i * 0.07));
          break;
        case 'wave': [220, 330, 440].forEach((note, i) => this.tone(note, note, 0.16, 0.14, 'triangle', i * 0.09)); break;
        case 'boss': this.tone(90, 45, 0.8, 0.35, 'sawtooth'); this.tone(92, 46, 0.8, 0.2, 'sawtooth'); break;
        case 'win': [261.6, 329.6, 392, 523.2].forEach((note, i) => this.tone(note, note, 0.5, 0.2, 'triangle', i * 0.12)); break;
        case 'lose': [260, 220, 146, 73].forEach((note, i) => this.tone(note, note * 0.85, 0.45, 0.16, 'triangle', i * 0.17)); break;
      }
    }
  }

  dispose(): void {
    this.master?.disconnect();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
  }
}
