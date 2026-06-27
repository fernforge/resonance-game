/* ============================================================================
 *  SHARE CODE — round-trip proof for the board-share codec (js/sharecode.js).
 *
 *  The viral hook is "paste my code, hear my exact song". That only holds if a
 *  decoded board fires the IDENTICAL frequencies as the original. We build a
 *  varied board (every control exercised: type, level, pitch, octave, accidental,
 *  custom rhythm), encode it to a string, decode+rebuild, and assert the rebuilt
 *  board is note-for-note and freq-for-freq identical to the source.
 * ========================================================================== */
require('../js/util.js');
require('../js/audio.js');
require('../js/harmony.js');
const Game = require('../js/game.js');
const Share = require('../js/sharecode.js');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('SHARE CODE — board codec round-trip\n');

const SEED = 4242;
const src = Game.makeState(SEED);
for (const k in src.unlocked) src.unlocked[k] = true;
src.energy = 99999;

// place a deliberately varied board: each node touches a different control
const plan = [
  // type        c  r  level pitch oct acc  steps
  ['pulser',     3, 4, 1,  0,  0,  0, null],
  ['splitter',   5, 6, 3, -2,  1,  1, [1,0,1,0,0,0,1,0]],
  ['relay',      7, 3, 2,  4, -1, -1, [0,0,1,0,0,0,0,1]],
  ['amplifier',  4, 5, 1,  0,  2,  0, null],
  ['resonator',  8, 8, 5,  1, -2,  1, [1,1,0,0,1,0,0,0]],
  ['pulser',     2, 2, 4, -4,  3,  0, [1,0,0,1,1,0,0,1]],
];
const placed = [];
for (const [type, c, r, level, pitch, octave, accidental, steps] of plan) {
  const n = Game.placeNode(src, type, c, r);
  if (!n) { ok('placed ' + type + ' @ ' + c + ',' + r, false); continue; }
  n.level = level; n.pitch = pitch; n.octave = octave; n.accidental = accidental;
  if (steps) n.steps = steps.slice();
  placed.push(n);
}
ok('all 6 nodes placed on the source board', placed.length === 6);

// snapshot source: note name + exact freq for every node
const srcSnap = placed.map(n => ({
  type: n.type, c: n.c, r: n.r, level: n.level, pitch: n.pitch,
  octave: n.octave, accidental: n.accidental, steps: n.steps.join(''),
  note: Game.noteNameOf(src, n), freq: Game.freqOf(n, src),
}));

// encode → decode → rebuild
const code = Share.encodeBoard(src);
ok('code is a non-empty string with the R1~ prefix', typeof code === 'string' && code.indexOf('R1~') === 0);
ok('code is reasonably short (< 200 chars for 6 nodes)', code.length < 200);

const data = Share.decodeBoard(code);
ok('decode returns structured data', !!data && data.nodes.length === 6);
ok('decoded board size survives', data && data.cols === Game.CONFIG.COLS && data.rows === Game.CONFIG.ROWS);

const rebuilt = Share.applyBoard(data, Game, SEED);
ok('rebuilt state has all 6 nodes', rebuilt && rebuilt.nodes.length === 6);

// the proof: every rebuilt node matches the source note-for-note AND freq-for-freq
let allFieldsMatch = true, allNotesMatch = true, allFreqMatch = true, maxErr = 0;
for (const s of srcSnap) {
  const m = rebuilt.nodes.find(n => n.c === s.c && n.r === s.r);
  if (!m) { allFieldsMatch = allNotesMatch = allFreqMatch = false; continue; }
  if (m.type !== s.type || m.level !== s.level || m.pitch !== s.pitch ||
      m.octave !== s.octave || m.accidental !== s.accidental || m.steps.join('') !== s.steps) {
    allFieldsMatch = false;
  }
  if (Game.noteNameOf(rebuilt, m) !== s.note) allNotesMatch = false;
  const err = Math.abs(Game.freqOf(m, rebuilt) - s.freq);
  maxErr = Math.max(maxErr, err);
  if (err > 1e-6) allFreqMatch = false;
}
ok('every node field survives the round-trip (type/level/pitch/oct/acc/steps)', allFieldsMatch);
ok('every node names the SAME note after rebuild', allNotesMatch);
ok('every fired frequency is bit-identical after rebuild (max err ' + maxErr.toExponential(1) + ')', allFreqMatch);

// the rebuilt board actually simulates without error (it is playable, not just data)
let ran = true;
try {
  Game.startWave(rebuilt);
  for (let i = 0; i < 240; i++) Game.simUpdate(rebuilt, 1 / 60);
} catch (e) { ran = false; console.log('    sim error: ' + e.message); }
ok('rebuilt board runs a live wave without error', ran);

// robustness: junk in → null out, never a throw
let safe = true;
try {
  ok('garbage string decodes to null', Share.decodeBoard('not a code') === null);
  ok('empty string decodes to null', Share.decodeBoard('') === null);
  ok('wrong-version bytes decode to null', Share.decodeBoard('R1~' + Share.bytesToB64([9, 13, 11, 0, 0])) === null);
  ok('non-string decodes to null', Share.decodeBoard(null) === null);
} catch (e) { safe = false; }
ok('codec never throws on bad input', safe);

// ---- one-click share links (boardFromUrl / buildShareUrl) ----
const link = Share.buildShareUrl('https://example.com/play/index.html', code);
ok('buildShareUrl makes an ?board= link from a code', typeof link === 'string' && link === 'https://example.com/play/index.html?board=' + code);
ok('buildShareUrl strips a pre-existing query/hash', Share.buildShareUrl('https://x.io/g?foo=1#bar', code) === 'https://x.io/g?board=' + code);
ok('buildShareUrl rejects a non-code', Share.buildShareUrl('https://x.io/', 'nope') === null);

ok('boardFromUrl reads the code back out of its own link', Share.boardFromUrl(link) === code);
ok('boardFromUrl reads a bare ?board= search', Share.boardFromUrl('?board=' + code) === code);
ok('boardFromUrl reads a #board= hash', Share.boardFromUrl('#board=' + code) === code);
ok('boardFromUrl accepts a raw R1~ code', Share.boardFromUrl(code) === code);
ok('boardFromUrl handles a percent-encoded value', Share.boardFromUrl('?board=' + encodeURIComponent(code)) === code);
ok('boardFromUrl ignores other params', Share.boardFromUrl('?seed=9&board=' + code + '&x=2') === code);
ok('boardFromUrl returns null when no board param', Share.boardFromUrl('https://x.io/?seed=9') === null);
ok('boardFromUrl returns null on junk / non-string', Share.boardFromUrl('?board=garbage') === null && Share.boardFromUrl(null) === null);

// the full link round-trips back into a playable, identical board
const fromLink = Share.loadCode(Share.boardFromUrl(link), Game, SEED);
let linkFreqMatch = fromLink && fromLink.nodes.length === 6;
if (linkFreqMatch) for (const s of srcSnap) {
  const m = fromLink.nodes.find(n => n.c === s.c && n.r === s.r);
  if (!m || Math.abs(Game.freqOf(m, fromLink) - s.freq) > 1e-6) linkFreqMatch = false;
}
ok('a shared LINK rebuilds the exact same board, freq-for-freq', linkFreqMatch);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
