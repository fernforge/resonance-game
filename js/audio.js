/* RESONANCE — audio.js : WebAudio generative synth engine. */
(function (root) {
  'use strict';

  function createAudio() {
    let ctx = null, master = null, delay = null, fb = null, wet = null, comp = null;
    let muted = false, ready = false;

    function init() {
      if (ready) return;
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.7;
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
      // spacey ping-pong-ish delay bus
      delay = ctx.createDelay(1.0); delay.delayTime.value = 0.34;
      fb = ctx.createGain(); fb.gain.value = 0.32;
      wet = ctx.createGain(); wet.gain.value = 0.28;
      delay.connect(fb); fb.connect(delay); delay.connect(wet);
      wet.connect(master);
      master.connect(comp); comp.connect(ctx.destination);
      ready = true;
    }

    function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

    const now = () => (ctx ? ctx.currentTime : 0);

    // waveform per node "voice" — BASE is the built-in pack; VOICE is the live table
    const BASE_VOICE = {
      pulser:    { type: 'triangle', a: 0.005, d: 0.18, sus: 0.0, gain: 0.22, detune: 0,  send: 0.5 },
      splitter:  { type: 'square',   a: 0.004, d: 0.14, sus: 0.0, gain: 0.13, detune: 4,  send: 0.5 },
      relay:     { type: 'sine',     a: 0.002, d: 0.12, sus: 0.0, gain: 0.16, detune: 0,  send: 0.7 },
      amplifier: { type: 'sawtooth', a: 0.02,  d: 0.5,  sus: 0.0, gain: 0.07, detune: 0,  send: 0.6 },
      resonator: { type: 'sawtooth', a: 0.006, d: 0.6,  sus: 0.0, gain: 0.20, detune: 6,  send: 0.6 },
      // harmonic backbone — global, not a node type (packs don't override these)
      bass:      { type: 'triangle', a: 0.01,  d: 0.42, sus: 0.0, gain: 0.30, detune: 0,  send: 0.18 },
    };
    let VOICE = BASE_VOICE;

    // swap the instrument pack: `voices` is a map nodeType -> partial override (or null to reset)
    function setPack(voices) {
      if (!voices) { VOICE = BASE_VOICE; return; }
      const next = {};
      for (const k of Object.keys(BASE_VOICE)) next[k] = Object.assign({}, BASE_VOICE[k], voices[k] || {});
      VOICE = next;
    }

    function note(freq, voiceName, vel) {
      if (!ready || muted) return;
      if (!(freq > 0)) return; // never feed a bad frequency to WebAudio (would throw)
      try {
      const v = VOICE[voiceName] || VOICE.pulser;
      const t = now();
      const amp = (vel == null ? 1 : vel) * v.gain;

      const o = ctx.createOscillator();
      o.type = v.type; o.frequency.value = freq; o.detune.value = v.detune;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t + v.a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + v.a + v.d);

      // gentle lowpass to keep it warm
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = Math.min(8000, freq * 6 + 800);

      o.connect(lp); lp.connect(g);
      g.connect(master);
      const s = ctx.createGain(); s.gain.value = v.send; g.connect(s); s.connect(delay);

      o.start(t); o.stop(t + v.a + v.d + 0.05);
      o.onended = () => { o.disconnect(); g.disconnect(); lp.disconnect(); s.disconnect(); };
      } catch (e) { /* audio is cosmetic — never let it break the game loop */ }
    }

    // percussive beat tick — soft kick + click, accent on the downbeat
    function tick(accent) {
      if (!ready || muted) return;
      try {
      const t = now();
      // kick
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(accent ? 150 : 110, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(accent ? 0.32 : 0.16, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.2);
      o.onended = () => { o.disconnect(); g.disconnect(); };
      } catch (e) { /* cosmetic */ }
    }

    // bright noise burst for kills / impacts
    function impact(big) {
      if (!ready || muted) return;
      try {
      const t = now();
      const len = big ? 0.25 : 0.09;
      const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = big ? 700 : 2200; bp.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = big ? 0.22 : 0.12;
      src.connect(bp); bp.connect(g); g.connect(master);
      const s = ctx.createGain(); s.gain.value = 0.4; g.connect(s); s.connect(delay);
      src.start(t);
      src.onended = () => { src.disconnect(); bp.disconnect(); g.disconnect(); s.disconnect(); };
      } catch (e) { /* cosmetic */ }
    }

    // warm pad swell for menus / wave clear
    function chord(degrees, voiceName) {
      if (!ready || muted) return;
      degrees.forEach((f, i) => setTimeout(() => note(f, voiceName || 'amplifier', 0.5), i * 70));
    }

    // low plucked bass root that follows the chord progression's backbone
    function bass(freq, vel) {
      note(freq, 'bass', vel == null ? 0.85 : vel);
    }

    // sustained harmonic pad — a soft sawtooth chord that swells & fades when the
    // progression turns over. Held longer than a node note so it reads as harmony.
    function pad(freqs, vel) {
      if (!ready || muted || !freqs || !freqs.length) return;
      try {
      const t = now();
      const amp = (vel == null ? 0.5 : vel) * 0.06;
      freqs.forEach((freq, i) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = (i - 1) * 5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t + 0.18);
        g.gain.setValueAtTime(Math.max(0.0002, amp), t + 1.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = Math.min(3200, freq * 4 + 500);
        o.connect(lp); lp.connect(g); g.connect(master);
        const s = ctx.createGain(); s.gain.value = 0.55; g.connect(s); s.connect(delay);
        o.start(t); o.stop(t + 2.1);
        o.onended = () => { o.disconnect(); g.disconnect(); lp.disconnect(); s.disconnect(); };
      });
      } catch (e) { /* cosmetic */ }
    }

    function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.7; }
    function isMuted() { return muted; }

    return { init, resume, note, tick, impact, chord, bass, pad, setPack, setMuted, isMuted, get ready() { return ready; } };
  }

  root.RAudio = createAudio();
  if (typeof module !== 'undefined' && module.exports) module.exports = { createAudio };
})(typeof window !== 'undefined' ? window : globalThis);
