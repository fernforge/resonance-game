/* RESONANCE — util.js : math, seeded RNG, music theory. Pure, headless-testable. */
(function (root) {
  'use strict';

  // ---- math ----
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
  const TAU = Math.PI * 2;

  // ---- seeded RNG (mulberry32) ----
  function makeRNG(seed) {
    let s = seed >>> 0;
    const next = () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      range: (a, b) => a + next() * (b - a),
      int: (a, b) => Math.floor(a + next() * (b - a + 1)),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p,
      shuffle: (arr) => {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
    };
  }

  // ---- music: scales, always consonant within a single key ----
  // semitone offsets of a scale within one octave (A is the tonic, 0 semitones).
  // `minor` = A natural minor (7 notes → real melodies); `penta` = the old
  // minor-pentatonic (kept for harmony/chord helpers and back-compat).
  const SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10], // A B C D E F G
    penta: [0, 3, 5, 7, 10],       // A C D E G
  };
  const PENTA = SCALES.penta;

  // Map a scale "degree" (0 = tonic; may be negative or > scale length, octave-
  // wrapping) to a chromatic semitone offset from the tonic.
  function scaleDegreeToSemitone(degree, scale) {
    const s = scale || SCALES.minor;
    const oct = Math.floor(degree / s.length);
    const idx = ((degree % s.length) + s.length) % s.length;
    return s[idx] + 12 * oct;
  }
  // semitone offset (from baseHz) → frequency. baseHz is the tonic (A2 = 110).
  function semitoneToFreq(semi, baseHz) {
    return (baseHz || 110) * Math.pow(2, semi / 12);
  }
  // Human-readable note name for a semitone offset above baseHz, e.g. "E5".
  // baseHz 110 = A2 (MIDI 45); names are absolute, octave-correct.
  function noteName(semi, baseHz) {
    const freq = semitoneToFreq(semi, baseHz || 110);
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  // Legacy pentatonic degree → frequency (used by harmony chord/ribbon code).
  function degreeToFreq(degree, baseHz) {
    return semitoneToFreq(scaleDegreeToSemitone(degree, PENTA), baseHz || 110);
  }

  // ---- the smooth blend: pitch is colour, tone AND combat all at once ----
  // A pitch's *class* (0..11, octave-folded) is the single quantity the whole
  // game reads three ways: you SEE it (hue), you HEAR it (the note), and you
  // PLAY it (how much damage a pulse does to an enemy of that pitch).
  function pitchClassOf(semi) { return ((Math.round(semi) % 12) + 12) % 12; }

  // CONSONANCE — how hard a pulse of pitch A hits an enemy tuned to pitch B,
  // indexed by their interval in semitones (0..11). UNISON SHATTERS (resonance);
  // everything else — *including the chord-internal consonances* like the 4th and
  // 5th — only scratches. This sharp, near-unison-only peak is deliberate: a
  // one-note ("mono") board sits on the root, so it shatters the root-coloured
  // third of the swarm but under-damages the other two thirds (it meets them at
  // a 4th/6th, ≈0.85×) and they LEAK to the Core. A board that spreads its notes
  // across the scale answers every colour and survives. So variety isn't flavour,
  // it's how you stop the leak. (Asymmetric on purpose — a real consonance table
  // isn't a mirror; m3-up 1.5 ≠ M6-down 0.98.) Mean ≈ 1.2× (so the base curve is
  // as hard as before — only its SHAPE changed: a tall unison spike over a low,
  // flat plateau, where before the plateau rose to meet the chord's own 4th/5th).
  //               P1   m2    M2   m3   M3    P4    TT    P5   m6   M6    m7   M7
  const CONSONANCE = [3.3, 0.58, 0.8, 1.5, 1.55, 0.98, 0.63, 1.2, 1.5, 0.98, 0.8, 0.58];
  function consonance(semiInterval) { return CONSONANCE[pitchClassOf(semiInterval)]; }

  // Absolute pitch-class → hue, laid out around the CIRCLE OF FIFTHS so that
  // *consonant* pitches get *similar* colours (a fifth apart ⇒ 30° apart) and a
  // tritone sits opposite on the wheel. Tonic A (pc 0) ≈ 200° (cyan-blue) to
  // match the Am chord tint. Used for enemies, projectiles AND node auras, so a
  // node and an enemy of the same note read as the SAME colour → "match the
  // colour to shatter it" is the whole low-floor teaching.
  const PC_HUE_BASE = 200;
  function pcHue(pc) { return (((pitchClassOf(pc) * 7) % 12) * 30 + PC_HUE_BASE) % 360; }
  function pcColor(pc, light, sat) {
    return 'hsl(' + pcHue(pc) + ',' + (sat == null ? 85 : sat) + '%,' + (light == null ? 62 : light) + '%)';
  }
  // Rows are top(high) -> bottom(low). Convert a grid row to a scale degree.
  function rowToDegree(row, rows) {
    // invert so the top row is the highest pitch
    return (rows - 1 - row);
  }

  const U = {
    clamp, lerp, dist, dist2, TAU,
    makeRNG, PENTA, SCALES, scaleDegreeToSemitone, semitoneToFreq, noteName,
    degreeToFreq, rowToDegree,
    pitchClassOf, consonance, CONSONANCE, pcHue, pcColor,
  };

  root.RU = U;
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
})(typeof window !== 'undefined' ? window : globalThis);
