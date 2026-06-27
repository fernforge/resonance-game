/* RESONANCE — harmony.js : the harmonic backbone.
 *
 * The node notes stay locked to the A-minor pentatonic pool {A C D E G} so they
 * are ALWAYS consonant (see util.js). This module adds the thing that makes a
 * run sound like a *composed song* instead of static blips: a chord progression
 * that advances as the battle builds, plus a bass root that follows it. Every
 * chord here is drawn only from triads whose tones sit inside that same
 * pentatonic pool's harmonic neighbourhood, so the bass/pads never fight the
 * node melody — the whole board always sounds intentional, and now it *moves*.
 *
 * Pure & headless-testable: no WebAudio, no DOM. Just music theory + helpers.
 */
(function (root) {
  'use strict';

  // semitone of each chord root relative to A (the key centre, A = 0).
  // triad = semitone offsets of the three chord tones, voiced low for the bass
  // octave; pad voicings just transpose these up. rgb tints the board per chord.
  const CHORDS = {
    Am: { root: 0,  triad: [0, 3, 7],   rgb: [120, 200, 255] }, // i   — cool blue
    C:  { root: 3,  triad: [3, 7, 10],  rgb: [120, 255, 190] }, // III — mint
    Dm: { root: 5,  triad: [5, 8, 12],  rgb: [180, 160, 255] }, // iv  — violet
    Em: { root: 7,  triad: [7, 10, 14], rgb: [255, 150, 200] }, // v   — rose
    F:  { root: -4, triad: [-4, 0, 3],  rgb: [255, 200, 120] }, // VI  — amber
    G:  { root: -2, triad: [-2, 2, 5],  rgb: [160, 255, 130] }, // VII — green
  };

  // Hand-picked four-chord loops. Each is diatonic to A minor and stays inside
  // the pentatonic-safe neighbourhood, so any pentatonic node melody fits over
  // all of them. The seeded run picks one → every run has its own song.
  const PROGRESSIONS = [
    { name: 'AURORA',  chords: ['Am', 'F', 'C', 'G'] },   // i–VI–III–VII (the anthem)
    { name: 'DRIFT',   chords: ['Am', 'C', 'G', 'F'] },
    { name: 'ASCEND',  chords: ['Am', 'G', 'F', 'G'] },
    { name: 'LONGING', chords: ['Am', 'F', 'Dm', 'G'] },
    { name: 'EMBERS',  chords: ['C', 'G', 'Am', 'F'] },    // relative-major lift
    { name: 'TIDAL',   chords: ['Am', 'Dm', 'F', 'Em'] },
  ];

  const BARS_PER_CHORD = 2; // each chord holds two bars before it turns over

  function pickProgression(rng) {
    // rng is the seeded RU.makeRNG; fall back to the anthem if absent
    if (rng && rng.pick) return rng.pick(PROGRESSIONS);
    return PROGRESSIONS[0];
  }

  // which chord NAME is active on a given (0-based) bar of a progression
  function chordAt(prog, bar, barsPerChord) {
    const bpc = barsPerChord || BARS_PER_CHORD;
    const n = prog.chords.length;
    const idx = Math.floor(Math.max(0, bar) / bpc) % n;
    return prog.chords[idx];
  }

  // index into prog.chords (0..n-1) for a bar — handy for the HUD highlight
  function chordIndexAt(prog, bar, barsPerChord) {
    const bpc = barsPerChord || BARS_PER_CHORD;
    return Math.floor(Math.max(0, bar) / bpc) % prog.chords.length;
  }

  function semiToFreq(semi, baseHz) {
    return (baseHz || 110) * Math.pow(2, semi / 12);
  }

  // bass root frequency for a chord (low octave by default — A1 ≈ 55Hz)
  function bassFreq(chordName, baseHz) {
    const c = CHORDS[chordName] || CHORDS.Am;
    return semiToFreq(c.root, baseHz || 55);
  }

  // the three triad frequencies for a pad swell (warm mid octave by default)
  function padFreqs(chordName, baseHz) {
    const c = CHORDS[chordName] || CHORDS.Am;
    return c.triad.map(s => semiToFreq(s, baseHz || 220));
  }

  function chordRGB(chordName) {
    return (CHORDS[chordName] || CHORDS.Am).rgb;
  }

  // the chord's tones as octave-folded pitch classes (0..11). Enemies are tuned
  // to these so the incoming swarm literally *spells the current chord* — and
  // matching a node's note to an enemy's resolves it (unison = max damage).
  function chordPitchClasses(chordName) {
    const c = CHORDS[chordName] || CHORDS.Am;
    return c.triad.map(s => ((s % 12) + 12) % 12);
  }

  const H = {
    CHORDS, PROGRESSIONS, BARS_PER_CHORD,
    pickProgression, chordAt, chordIndexAt,
    bassFreq, padFreqs, chordRGB, chordPitchClasses, semiToFreq,
  };

  root.RHarmony = H;
  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof window !== 'undefined' ? window : globalThis);
