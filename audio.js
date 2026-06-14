(() => {
  'use strict';

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.volume = 0.35;
      this.initialized = false;
    }

    init() {
      if (this.initialized) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.initialized = true;
    }

    async resume() {
      this.init();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    }

    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
      return this.muted;
    }

    _now() {
      return this.ctx.currentTime;
    }

    _tone(freq, duration, type = 'square', gain = 0.08, detune = 0) {
      if (!this.initialized || this.muted) return;
      const t = this._now();
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    }

    _noise(duration, gain = 0.06, filterFreq = 800) {
      if (!this.initialized || this.muted) return;
      const t = this._now();
      const bufferSize = this.ctx.sampleRate * duration;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = filterFreq;
      filter.Q.value = 1;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + duration);
      src.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      src.start(t);
      src.stop(t + duration + 0.02);
    }

    move() {
      this._tone(220, 0.04, 'square', 0.04);
    }

    rotate() {
      this._tone(330, 0.06, 'triangle', 0.05);
      this._tone(440, 0.04, 'triangle', 0.03, 50);
    }

    softDrop() {
      this._tone(180, 0.025, 'square', 0.025);
    }

    hardDrop() {
      this._tone(90, 0.12, 'sawtooth', 0.1);
      this._noise(0.08, 0.04, 400);
    }

    lock() {
      this._tone(120, 0.08, 'square', 0.07);
      this._tone(80, 0.1, 'sine', 0.05);
    }

    hold() {
      this._tone(520, 0.07, 'sine', 0.05);
      this._tone(780, 0.05, 'sine', 0.03);
    }

    levelUp() {
      if (!this.initialized || this.muted) return;
      const t = this._now();
      [523, 659, 784, 1047].forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        const start = t + i * 0.08;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(0.06, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
        osc.connect(g);
        g.connect(this.master);
        osc.start(start);
        osc.stop(start + 0.25);
      });
    }

    gameOver() {
      [400, 320, 260, 180].forEach((freq, i) => {
        setTimeout(() => this._tone(freq, 0.25, 'sawtooth', 0.07), i * 120);
      });
    }

    start() {
      this._tone(440, 0.1, 'square', 0.06);
      setTimeout(() => this._tone(660, 0.15, 'square', 0.06), 80);
    }

    laser(lineCount = 1) {
      if (!this.initialized || this.muted) return;
      const t = this._now();
      const intensity = Math.min(lineCount, 4);

      const osc = this.ctx.createOscillator();
      const sweep = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1200 + intensity * 200, t);
      osc.frequency.exponentialRampToValueAtTime(200, t + 0.35 + intensity * 0.05);

      sweep.type = 'sine';
      sweep.frequency.setValueAtTime(80, t);
      sweep.frequency.linearRampToValueAtTime(40, t + 0.4);

      filter.type = 'highpass';
      filter.frequency.value = 600;

      g.gain.setValueAtTime(0.12 + intensity * 0.02, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45 + intensity * 0.05);

      osc.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.5);

      this._noise(0.15 + intensity * 0.03, 0.05 + intensity * 0.01, 2000 + intensity * 500);

      const ping = this.ctx.createOscillator();
      const pingG = this.ctx.createGain();
      ping.type = 'sine';
      ping.frequency.setValueAtTime(2400, t);
      ping.frequency.exponentialRampToValueAtTime(800, t + 0.08);
      pingG.gain.setValueAtTime(0.08, t);
      pingG.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      ping.connect(pingG);
      pingG.connect(this.master);
      ping.start(t);
      ping.stop(t + 0.15);

      if (lineCount >= 4) {
        setTimeout(() => {
          [880, 1100, 1320].forEach((f, i) => {
            setTimeout(() => this._tone(f, 0.15, 'square', 0.05), i * 60);
          });
        }, 200);
      }
    }
  }

  window.AudioEngine = AudioEngine;
})();
