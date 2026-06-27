/* ============================================================================
 *  FÜR ELISE — a proof that RESONANCE's pitch model is a real instrument.
 *
 *  We build a board whose nodes spell out the recognisable opening phrase of
 *  Beethoven's "Für Elise", run the live simulation over it, and ASSERT that the
 *  frequencies the engine actually fires match real, equal-tempered concert
 *  pitches (A4 = 440 Hz) to within a fraction of a hertz. If this passes, the
 *  whole pitch ladder — row → degree, level, PITCH, OCT, ACCIDENTAL — is sound.
 *
 *  See FUR-ELISE.md for the human "how you'd actually play this on the board".
 * ========================================================================== */
require('../js/util.js');
require('../js/audio.js');
require('../js/harmony.js');
const G = require('../js/game.js');
const RU = global.RU;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('FÜR ELISE — pitch-model fidelity test\n');

// The opening phrase, in order. Each note is expressed in the SAME controls a
// player has in the retune popup: a scale DEGREE (0 = A, 1 = B, 2 = C, ...), an
// OCTAVE jump, and an ACCIDENTAL (+1 = sharp). D#  = D(deg 3) + sharp;
// G#  = G(deg 6) + sharp. Real freqs are equal temperament, A4 = 440 Hz.
const PHRASE = [
  // name   deg oct acc   realHz
  ['E5',  4, 1, 0, 659.26],
  ['D#5', 3, 1, 1, 622.25],
  ['E5',  4, 1, 0, 659.26],
  ['D#5', 3, 1, 1, 622.25],
  ['E5',  4, 1, 0, 659.26],
  ['B4',  1, 1, 0, 493.88],
  ['D5',  3, 1, 0, 587.33],
  ['C5',  2, 1, 0, 523.25],
  ['A4',  0, 1, 0, 440.00],
  ['C4',  2, 0, 0, 261.63],
  ['E4',  4, 0, 0, 329.63],
  ['A4',  0, 1, 0, 440.00],
  ['B4',  1, 1, 0, 493.88],
  ['E4',  4, 0, 0, 329.63],
  ['G#4', 6, 0, 1, 415.30],
  ['B4',  1, 1, 0, 493.88],
  ['C5',  2, 1, 0, 523.25],
];

// Build the board. We lay the melody out on the bottom rows of a fresh board
// and dial every node to its target with PITCH / OCT / ACCIDENTAL — exactly the
// player-facing controls. Musicality is pinned to 0 so the "resonance lift"
// octave never kicks in and we measure the bare, deliberate pitch.
const st = G.makeState(1);
st.energy = 999999;
st.musicality = 0;

const COLS = G.CONFIG.COLS;
const nodes = [];
PHRASE.forEach(([name, deg, oct, acc], i) => {
  const c = i % COLS;
  const r = G.CONFIG.ROWS - 1 - Math.floor(i / COLS); // fill row 8, then row 7
  const n = G.placeNode(st, 'pulser', c, r);
  if (!n) { ok('placed ' + name + ' @(' + c + ',' + r + ')', false); return; }
  // Solve PITCH so the node's degree lands on `deg` regardless of which row it
  // sits in: degree = rowToDegree(r) + degOff(0) + (level-1=0) + pitch.
  n.pitch = deg - RU.rowToDegree(r, G.CONFIG.ROWS);
  n.octave = oct;
  n.accidental = acc;
  nodes.push({ n, name, realHz: PHRASE[i][4] });
});

ok('all ' + PHRASE.length + ' notes placed on the board', nodes.length === PHRASE.length);

// 1) Every node reports the correct note NAME and FREQUENCY.
let allNames = true, allFreqs = true, maxErr = 0;
for (const { n, name, realHz } of nodes) {
  const gotName = G.noteNameOf(st, n);
  const gotHz = G.freqOf(n, st);
  const err = Math.abs(gotHz - realHz);
  if (err > maxErr) maxErr = err;
  if (gotName !== name) { allNames = false; console.log('      name mismatch: want ' + name + ', got ' + gotName); }
  if (err > 0.5)        { allFreqs = false; console.log('      freq mismatch: ' + name + ' want ' + realHz + ', got ' + gotHz.toFixed(2)); }
}
ok('every node names its note exactly (E5, D#5, ...)', allNames);
ok('every frequency matches concert pitch within 0.5 Hz (max err ' + maxErr.toFixed(3) + ')', allFreqs);

// 2) The melody is an ARC, then resolves — sanity-check the contour matches the
//    real tune (the famous E–D#–E wobble, the descent to A4, the lift back up).
const seq = nodes.map(x => G.freqOf(x.n, st));
ok('opens on the E5 / D#5 trill (note 1 > note 2, note 3 > note 4)',
   seq[0] > seq[1] && seq[2] > seq[3]);
ok('descends to its lowest point at C4 (note 10 is the floor)',
   seq[9] === Math.min(...seq));
ok('A4 = exactly 440 Hz (the tuning anchor)',
   Math.abs(seq[8] - 440) < 1e-6);

// 3) The live simulation runs over this board without crashing, and when a node
//    fires it emits its true pitch (audio is captured through a stub).
const fired = [];
const realNote = global.RAudio.note;
global.RAudio.note = (f) => { if (f > 0) fired.push(f); };
try {
  G.startWave(st);
  for (let i = 0; i < 240; i++) { G.simUpdate(st, 1 / 60); if (st.state !== 'wave') break; }
} finally {
  global.RAudio.note = realNote;
}
ok('the simulation runs the Für Elise board without error', st.time > 0);
ok('firing nodes emit pitches drawn from the phrase',
   fired.length > 0 && fired.every(f => seq.some(s => Math.abs(s - f) < 0.5)));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
