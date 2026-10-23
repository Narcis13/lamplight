/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · gem duel sounds
   Every sound of the gem duel, synthesised with WebAudio on the app's
   SFX context (its master gain and noise buffer): glassy chimes for
   matches that climb with the cascade, whooshes, thumps and crackles
   for the specials, a jingle per booster. Silent unless SFX is on.
   ════════════════════════════════════════════════════════════════════ */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
const hz = semi => 523.25 * 2 ** (semi / 12); // semitones above C5

export class M3Sfx {
  constructor(sfx) { this.sfx = sfx; this.last = {}; this.bus = null; }
  get ok() { return !!(this.sfx && this.sfx.ok && this.sfx.noiseBuf); }
  /** True at most once every `ms` for `key`, so a cascade of the same sound never piles up. */
  gate(key, ms) {
    const now = performance.now();
    if (now - (this.last[key] || 0) < ms) return false;
    this.last[key] = now;
    return true;
  }
  /** A dry bus into the master plus a soft, dark echo that gives the chimes their shimmer. */
  out() {
    const c = this.sfx.ctx;
    if (this.bus && this.bus.context === c) return this.bus;
    const bus = c.createGain(), d = c.createDelay(1), fb = c.createGain(), lp = c.createBiquadFilter(), wet = c.createGain();
    d.delayTime.value = 0.17; fb.gain.value = 0.3; lp.type = 'lowpass'; lp.frequency.value = 2400; wet.gain.value = 0.2;
    bus.connect(this.sfx.master); bus.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.connect(this.sfx.master);
    return (this.bus = bus);
  }
  env(g, now, peak, a, dur) {
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + a);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  }
  tone({ t = 0, f = 440, to = 0, dur = 0.2, type = 'sine', gain = 0.08, a = 0.005, lp = 0, q = 0.7, detune = 0 }) {
    const c = this.sfx.ctx, top = c.sampleRate * 0.45; // a chime's upper partials can climb past what the context can play
    if (f > top) return;
    const now = c.currentTime + t, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, now); o.detune.value = detune;
    if (to) o.frequency.exponentialRampToValueAtTime(Math.min(to, top), now + dur);
    this.env(g, now, gain, a, dur);
    let n = o;
    if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; fl.Q.value = q; o.connect(fl); n = fl; }
    n.connect(g); g.connect(this.out());
    o.start(now); o.stop(now + dur + 0.05);
  }
  noise({ t = 0, dur = 0.1, f = 2000, to = 0, q = 1, type = 'bandpass', gain = 0.06, a = 0.004 }) {
    const c = this.sfx.ctx, now = c.currentTime + t, src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.sfx.noiseBuf; src.loop = true;
    fl.type = type; fl.frequency.setValueAtTime(f, now); fl.Q.value = q;
    if (to) fl.frequency.exponentialRampToValueAtTime(to, now + dur);
    this.env(g, now, gain, a, dur);
    src.connect(fl); fl.connect(g); g.connect(this.out());
    src.start(now, Math.random() * 0.3); src.stop(now + dur + 0.05);
  }
  /** A glassy bell: a sine with two inharmonic partials. */
  chime(t, f, gain = 0.05, dur = 0.5) {
    this.tone({ t, f, dur, gain, a: 0.003 });
    this.tone({ t, f: f * 2.76, dur: dur * 0.45, gain: gain * 0.3, a: 0.002 });
    this.tone({ t, f: f * 5.4, dur: dur * 0.22, gain: gain * 0.12, a: 0.002 });
  }
  sparkle(t = 0, n = 5, gain = 0.02) {
    for (let k = 0; k < n; k++) this.chime(t + k * 0.035 + Math.random() * 0.02, hz(24 + PENTA[(Math.random() * 7) | 0]), gain, 0.18);
  }
  crackle(t, dur, gain = 0.035, n = 8) {
    for (let k = 0; k < n; k++) this.noise({ t: t + Math.random() * dur, dur: 0.018 + Math.random() * 0.03, f: 2500 + Math.random() * 5000, q: 5, gain });
  }
  arp(t, semis, step, gain = 0.045, dur = 0.5, type = 'sine') {
    semis.forEach((s, k) => (type === 'sine' ? this.chime(t + k * step, hz(s), gain, dur) : this.tone({ t: t + k * step, f: hz(s), dur, type, gain, a: 0.008 })));
  }

  /* ───── on the board ───── */
  select() { if (!this.ok) return; this.chime(0, hz(19), 0.03, 0.16); this.noise({ dur: 0.03, f: 6500, q: 2, gain: 0.02 }); }
  swap() {
    if (!this.ok) return;
    this.noise({ dur: 0.17, f: 500, to: 2600, q: 1.1, gain: 0.05 });
    this.tone({ f: 330, to: 520, dur: 0.13, type: 'triangle', gain: 0.035 });
  }
  bad() {
    if (!this.ok) return;
    this.tone({ f: 220, to: 175, dur: 0.11, type: 'square', gain: 0.03, lp: 900 });
    this.tone({ t: 0.1, f: 196, to: 140, dur: 0.15, type: 'square', gain: 0.026, lp: 700 });
  }
  /** A cleared match: the deeper the cascade, the higher the chime. */
  match(depth = 0) {
    if (!this.ok || !this.gate('match', 45)) return;
    const k = Math.min(Math.max(0, depth), PENTA.length - 3);
    this.chime(0, hz(PENTA[k]), 0.05, 0.42);
    this.chime(0.05, hz(PENTA[k + 2]), 0.035, 0.38);
    this.noise({ dur: 0.07, f: 7000, q: 0.8, type: 'highpass', gain: 0.022 });
  }
  /** A special piece was made. */
  special(kind) {
    if (!this.ok || !this.gate('special', 60)) return;
    this.arp(0, [7, 12, 16, 19], 0.045, 0.035, 0.45);
    if (kind === 'bomb') this.tone({ f: 150, to: 70, dur: 0.22, gain: 0.07 });
    else if (kind === 'bolt') this.crackle(0.04, 0.22, 0.025, 6);
    else if (kind === 'h' || kind === 'v') this.tone({ t: 0.03, f: 700, to: 1900, dur: 0.16, type: 'sawtooth', gain: 0.016, lp: 2600 });
    else this.sparkle(0.08, 4, 0.018);
  }
  arrow() {
    if (!this.ok || !this.gate('arrow', 60)) return;
    this.tone({ f: 320, to: 2400, dur: 0.2, type: 'sawtooth', gain: 0.025, lp: 3200 });
    this.noise({ dur: 0.26, f: 1500, to: 8000, q: 0.9, type: 'highpass', gain: 0.045 });
  }
  bomb(big = false) {
    if (!this.ok || !this.gate('bomb', 70)) return;
    const d = big ? 0.8 : 0.45;
    this.tone({ f: 150, to: 38, dur: d, gain: big ? 0.26 : 0.2, a: 0.004 });
    this.noise({ dur: d, f: 1400, to: 160, q: 0.6, type: 'lowpass', gain: big ? 0.2 : 0.15 });
    if (big) { this.tone({ t: 0.02, f: 90, to: 30, dur: 0.9, type: 'triangle', gain: 0.12 }); this.crackle(0.08, 0.5, 0.025, 10); }
  }
  bolt() {
    if (!this.ok || !this.gate('bolt', 80)) return;
    this.crackle(0, 0.32, 0.05, 9);
    this.tone({ f: 110, dur: 0.28, type: 'sawtooth', gain: 0.045, lp: 1400, a: 0.01 });
    this.tone({ f: 2200, to: 600, dur: 0.18, type: 'square', gain: 0.012, lp: 3000 });
  }
  combo() {
    if (!this.ok || !this.gate('combo', 120)) return;
    this.arp(0, [0, 4, 7, 12, 16, 19, 24], 0.03, 0.035, 0.5);
    this.noise({ dur: 0.5, f: 300, to: 5000, q: 0.8, gain: 0.06 });
    this.tone({ f: 110, to: 55, dur: 0.5, gain: 0.12 });
  }
  land() {
    if (!this.ok || !this.gate('land', 70)) return;
    this.tone({ f: 170, to: 90, dur: 0.07, gain: 0.04 });
    this.noise({ dur: 0.035, f: 1000, q: 0.7, type: 'lowpass', gain: 0.025 });
  }
  collect() {
    if (!this.ok || !this.gate('collect', 40)) return;
    this.chime(0, hz(19 + PENTA[(Math.random() * 6) | 0]), 0.018, 0.16);
  }
  /** A gem reached your booster meter; `frac` 0..1 how far along. */
  charge(frac = 0) {
    if (!this.ok || !this.gate('charge', 45)) return;
    const f = hz(7 + Math.round(Math.max(0, Math.min(1, frac)) * 17));
    this.tone({ f, to: f * 1.5, dur: 0.12, type: 'triangle', gain: 0.03 });
    this.chime(0.02, f * 2, 0.018, 0.2);
  }
  ready() {
    if (!this.ok) return;
    this.arp(0, [0, 4, 7, 11, 12, 16, 19], 0.06, 0.04, 0.6);
    this.sparkle(0.4, 6, 0.02);
  }
  boost(key) {
    if (!this.ok) return;
    switch (key) {
      case 'ember': // a spark whistles down and catches
        this.tone({ f: 1800, to: 300, dur: 0.4, type: 'sine', gain: 0.04 });
        this.noise({ dur: 0.45, f: 600, to: 3000, q: 0.7, gain: 0.04 });
        this.crackle(0.25, 0.35, 0.03, 8);
        break;
      case 'sweep': // a lantern drifts by: air and a warm chord
        this.noise({ dur: 0.8, f: 380, to: 1700, q: 0.6, gain: 0.05, a: 0.15 });
        [0, 4, 7].forEach(s => this.tone({ f: hz(s - 12), dur: 0.9, type: 'triangle', gain: 0.03, a: 0.12 }));
        this.sparkle(0.3, 4, 0.015);
        break;
      case 'beams': // two laser zaps
        [0, 0.12].forEach((t, k) => {
          this.tone({ t, f: 2400 - k * 400, to: 260, dur: 0.24, type: 'sawtooth', gain: 0.04, lp: 4000 });
          this.tone({ t, f: 1200 - k * 200, to: 130, dur: 0.24, type: 'square', gain: 0.025, lp: 2000 });
        });
        break;
      case 'prism': // a rainbow of glass bells, falling
        this.arp(0, [31, 28, 24, 19, 16, 12, 7], 0.045, 0.035, 0.5);
        this.noise({ dur: 0.5, f: 6000, q: 3, gain: 0.02, a: 0.08 });
        break;
      case 'volt': // a coil winding up
        this.tone({ f: 80, to: 320, dur: 0.4, type: 'sawtooth', gain: 0.045, lp: 1500, a: 0.05 });
        this.crackle(0.15, 0.3, 0.05, 9);
        break;
      case 'hat': // a magician's glissando and a ta-da
        this.arp(0, [0, 2, 4, 7, 9, 12, 14, 16], 0.025, 0.025, 0.3);
        [12, 16, 19].forEach(s => this.tone({ t: 0.26, f: hz(s), dur: 0.45, type: 'triangle', gain: 0.035 }));
        this.sparkle(0.3, 5, 0.018);
        break;
      default: this.combo();
    }
  }
  hammer() {
    if (!this.ok) return;
    this.tone({ f: 130, to: 48, dur: 0.28, gain: 0.2 });
    this.noise({ dur: 0.14, f: 900, q: 0.6, type: 'lowpass', gain: 0.18 });
    [523, 1337, 2210].forEach((f, k) => this.tone({ t: 0.005, f, dur: 0.25 - k * 0.05, gain: 0.04 - k * 0.01 }));
    this.noise({ t: 0.02, dur: 0.1, f: 5000, q: 0.7, type: 'highpass', gain: 0.04 });
  }
  shuffle() {
    if (!this.ok) return;
    this.noise({ dur: 0.35, f: 400, to: 2200, q: 1, gain: 0.075, a: 0.05 });
    this.noise({ t: 0.33, dur: 0.35, f: 2200, to: 500, q: 1, gain: 0.07 });
    for (let k = 0; k < 9; k++) this.tone({ t: 0.05 + k * 0.06 + Math.random() * 0.02, f: 1800 + Math.random() * 900, dur: 0.03, type: 'triangle', gain: 0.03 });
  }
  extra() {
    if (!this.ok) return;
    this.chime(0, hz(12), 0.05, 0.4); this.chime(0.11, hz(19), 0.05, 0.6);
    this.sparkle(0.15, 4, 0.018);
  }

  /* ───── around the board (the room calls these) ───── */
  yourTurn() { if (!this.ok) return; this.arp(0, [7, 12, 16], 0.09, 0.04, 0.6); }
  theirTurn() { if (!this.ok) return; this.chime(0, hz(4), 0.03, 0.4); this.chime(0.12, hz(0), 0.028, 0.55); }
  round(n = 1, final = false) {
    if (!this.ok) return;
    this.tone({ f: 98, dur: 1.4, gain: 0.08, a: 0.01 }); this.tone({ f: 196, dur: 1.1, gain: 0.04, a: 0.01 });
    if (final) this.arp(0.1, [0, 7, 12, 19, 24], 0.08, 0.04, 0.9);
    else for (let k = 0; k < Math.min(5, n); k++) this.chime(0.1 + k * 0.12, hz(12), 0.035, 0.35);
  }
  tick() {
    if (!this.ok) return;
    this.tone({ f: 1250, dur: 0.045, type: 'triangle', gain: 0.045 });
    this.noise({ dur: 0.025, f: 2600, q: 5, gain: 0.03 });
  }
  win() {
    if (!this.ok) return;
    this.arp(0, [0, 4, 7, 12], 0.1, 0.06, 0.55, 'triangle');
    [12, 16, 19, 24].forEach(s => this.tone({ t: 0.45, f: hz(s), dur: 1.2, type: 'triangle', gain: 0.035, a: 0.02 }));
    this.sparkle(0.5, 8, 0.02);
  }
  lose() {
    if (!this.ok) return;
    this.arp(0, [7, 3, 0, -5], 0.16, 0.045, 0.5, 'triangle');
    this.tone({ t: 0.5, f: hz(-17), dur: 1, gain: 0.05, a: 0.02 });
  }
  draw() {
    if (!this.ok) return;
    [[0, 7], [2, 9]].forEach((ch, k) => ch.forEach(s => this.tone({ t: k * 0.3, f: hz(s), dur: 0.6, type: 'triangle', gain: 0.035, a: 0.01 })));
  }
  emote() {
    if (!this.ok) return;
    this.tone({ f: 420, to: 900, dur: 0.09, gain: 0.05 }); this.tone({ t: 0.07, f: 650, to: 1300, dur: 0.1, gain: 0.04 });
  }
}
