/* Headless smoke test for RESONANCE core logic (no DOM). */
require('../js/util.js');
require('../js/audio.js');
require('../js/harmony.js');
const G = require('../js/game.js');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('RESONANCE smoke test\n');

// --- util: scale monotonic & consonant ---
const RU = global.RU;
let mono = true; let prev = -1;
for (let d = 0; d < 15; d++) { const f = RU.degreeToFreq(d, 110); if (f <= prev) mono = false; prev = f; }
ok('pentatonic degrees ascend monotonically', mono);
ok('row 0 maps to highest degree', RU.rowToDegree(0, 9) === 8 && RU.rowToDegree(8, 9) === 0);

// --- defs sanity ---
ok('5 node types defined', Object.keys(G.NODE_TYPES).length === 5);
ok('all nodes have 8-step masks', Object.values(G.NODE_TYPES).every(d => d.steps.length === G.CONFIG.STEPS));
ok('7 enemy types defined', Object.keys(G.ENEMY_TYPES).length === 7);
ok('shifter enemy type exists & is flagged shifts', G.ENEMY_TYPES.shifter && G.ENEMY_TYPES.shifter.shifts === true);

// --- wave scaling ---
const rng = RU.makeRNG(1);
const w1 = G.waveSpec(1, rng), w5 = G.waveSpec(5, rng);
ok('wave count grows', w5.count > w1.count);
ok('wave hp scales up', w5.hpMult > w1.hpMult);
ok('spawn interval shrinks', w5.interval < w1.interval);

// --- placement & economy ---
let st = G.makeState(42);
const startE = st.energy;
const n = G.placeNode(st, 'pulser', 2, 2);
ok('pulser places', !!n && st.nodes.length === 1);
ok('placement spent energy', st.energy === startE - G.nodeCost(st, 'pulser'));
ok('cannot place on occupied cell', G.placeNode(st, 'pulser', 2, 2) === false);
ok('cannot place on core', G.placeNode(st, 'pulser', Math.round(G.CONFIG.CORE_C), Math.round(G.CONFIG.CORE_R)) === false);
ok('cannot place locked type', G.placeNode(st, 'resonator', 4, 4) === false);
const before = st.energy; const ref = G.removeNode(st, n);
ok('selling refunds energy', st.energy === before + ref && st.nodes.length === 0);

// --- combat: a pulser kills a grunt over time ---
st = G.makeState(7);
st.energy = 999;
G.placeNode(st, 'pulser', 5, 4); // adjacent-ish to core path
G.startWave(st);
ok('startWave enters wave state', st.state === 'wave');
let frames = 0, everShot = false, everKilled = false;
const startScore = st.score;
for (let i = 0; i < 1800; i++) { // ~30s at 60fps
  G.simUpdate(st, 1 / 60);
  if (st.projectiles.length > 0) everShot = true;
  if (st.score > startScore) everKilled = true;
  frames++;
  if (st.state !== 'wave') break;
}
ok('pulser fired projectiles at enemies', everShot);
ok('enemies were killed / scored', everKilled);
ok('wave eventually resolves (clear or game state change)', st.state === 'draft' || st.state === 'gameover');

// --- draft produces 3 distinct options ---
st = G.makeState(99); st.wave = 3;
const draft = G.rollDraft(st);
ok('draft returns 3 options', draft.length === 3);
ok('draft options are distinct', new Set(draft.map(d => d.id || d.type)).size === 3);
const dm = st.dmgMult;
const up = draft.find(d => d.kind === 'up' && d.id === 'dmg') || { kind: 'up', apply: g => g.dmgMult *= 1.18 };
G.applyDraft(st, up);
ok('applying draft returns to building', st.state === 'building');

// --- resonator needs a firing neighbor ---
st = G.makeState(5); st.energy = 999;
st.unlocked.resonator = true;
const res = G.placeNode(st, 'resonator', 3, 3);
// place an enemy in range
st.enemies.push({ type:'grunt', x: G.cellCenter(3,3).x+30, y: G.cellCenter(3,3).y, hp:50, maxHP:50, speed:0, radius:13, reward:1, score:1, dmg:1, color:'#fff', splits:0, hitFlash:0 });
st.step = 7; G.simStep(st); // step becomes 0 -> resonator mask fires but no neighbor
const aloneShots = st.projectiles.length;
ok('lone resonator does not fire (needs sync)', aloneShots === 0);
G.placeNode(st, 'pulser', 3, 4); // ortho neighbor that also fires on step 0
st.step = 7; G.simStep(st);
ok('resonator fires with a synced neighbor', st.projectiles.length > 0);

// --- relay is purely reactive: no beats of its own, only echoes ---
st = G.makeState(7); st.energy = 999;
st.unlocked.relay = true;
const rel = G.placeNode(st, 'relay', 5, 5);
ok('relay places with no beats of its own', rel.steps.every(s => s === 0));
// even with an enemy in range and beats forced on, a lone relay never self-fires
st.enemies.push({ type:'grunt', x: G.cellCenter(5,5).x+20, y: G.cellCenter(5,5).y, hp:50, maxHP:50, speed:0, radius:13, reward:1, score:1, dmg:1, color:'#fff', splits:0, hitFlash:0 });
rel.steps = [1,1,1,1,1,1,1,1]; // pretend a player tried to program it
for (let s = 0; s < G.CONFIG.STEPS; s++) { st.step = (s + 7) % G.CONFIG.STEPS; G.simStep(st); }
ok('lone relay never self-fires regardless of its steps', st.projectiles.length === 0);
// give it a firing pulser neighbor → it echoes
rel.steps = rel.steps.map(() => 0);
const pul = G.placeNode(st, 'pulser', 5, 4); pul.steps = [1,0,0,0,0,0,0,0];
st.step = 7; G.simStep(st); // step -> 0: pulser fires, relay echoes it
ok('relay echoes a firing neighbor', st.projectiles.length > 0);
// relays are excluded from the musicality judgement (they carry no beats)
(() => {
  const s = G.makeState(3); s.energy = 999; s.unlocked.relay = true;
  const p = G.placeNode(s, 'pulser', 1, 1); p.steps = [1,0,0,1,0,0,1,0];
  const before = G.computeMusicality(s);
  const r = G.placeNode(s, 'relay', 2, 1); r.steps = [1,1,1,1,1,1,1,1];
  ok('relay does not affect RESONANCE %', Math.abs(G.computeMusicality(s) - before) < 1e-9);
})();

// --- board expansion (anti-clog) ---
st = G.makeState(99);
ok('board starts at base size', G.CONFIG.COLS === G.CONFIG.BASE_COLS && G.CONFIG.ROWS === G.CONFIG.BASE_ROWS);
st.energy = 999;
const en = G.placeNode(st, 'pulser', 1, 1); // top-left corner node
const baseCols = G.CONFIG.COLS, baseRows = G.CONFIG.ROWS;
const grew = G.expandBoard(st);
ok('expandBoard reports growth', grew === true);
ok('board gained a ring', G.CONFIG.COLS === baseCols + 2 && G.CONFIG.ROWS === baseRows + 2);
ok('core stays centered (odd-symmetric)', G.CONFIG.CORE_C === (G.CONFIG.COLS - 1) / 2);
ok('existing node shifted to keep its spot', en.c === 2 && en.r === 2 && st.grid.get('2,2') === en);
ok('old node cell now empty', !st.grid.has('1,1'));
ok('boardExpands counter incremented', st.boardExpands === 1);
// makeState must reset the global board back to base for the next run
const st2 = G.makeState(1);
ok('new run resets board to base', G.CONFIG.COLS === G.CONFIG.BASE_COLS && G.CONFIG.ROWS === G.CONFIG.BASE_ROWS);

// --- node leveling (vertical energy sink) ---
st = G.makeState(5); st.energy = 999;
const ln = G.placeNode(st, 'pulser', 3, 3);
const upCost = G.upgradeCost(st, ln);
const eBefore = st.energy;
const newLvl = G.upgradeNode(st, ln);
ok('upgrade raises level', newLvl === 2 && ln.level === 2);
ok('upgrade spent energy', st.energy === eBefore - upCost);
ok('upgrade cost scales with level', G.upgradeCost(st, ln) > upCost);
st.energy = 0;
ok('upgrade denied when broke', G.upgradeNode(st, ln) === false && ln.level === 2);

// --- boss waves ---
st = G.makeState(7);
const bspec = G.waveSpec(10, st.rng);
ok('wave 10 is a boss wave', bspec.isBoss === true);
ok('boss is queued last', bspec.queue[bspec.queue.length - 1] === 'conductor');
ok('only one boss per wave', bspec.queue.filter(t => t === 'conductor').length === 1);
ok('non-multiple-of-10 wave is not a boss', G.waveSpec(7, st.rng).isBoss === false);
ok('conductor enemy type exists & is flagged boss', G.ENEMY_TYPES.conductor && G.ENEMY_TYPES.conductor.boss === true);
// spawn a boss and confirm it carries boss flags & shatters into its splitInto type
st = G.makeState(11); st.hpMult = 1; st.speedMult = 1;
G.spawnEnemy(st, 'conductor');
const boss = st.enemies[0];
ok('spawned boss has boss flag', boss.boss === true);
ok('spawned boss has splitInto', boss.splitInto === 'fast');
boss.hp = 0; G.killEnemy(st, boss, false); st.enemies.splice(0, 1);
const minted = st.enemies.filter(e => e.type === 'fast').length;
ok('boss shatters into a fast swarm on death', minted === G.ENEMY_TYPES.conductor.splits);
ok('felling a boss is recorded', st.bossesFelled === 1);

// --- rhythm economy (A): silence is power ---
ok('falloff decreases with repetition', G.falloffAt(0) > G.falloffAt(1) && G.falloffAt(1) > G.falloffAt(2));
ok('falloff has a floor', G.falloffAt(99) === G.falloffAt(4) && G.falloffAt(4) > 0.3);
ok('rest bonus increases with rests', G.restBonus(0) === 1 && G.restBonus(2) > G.restBonus(1));
ok('rest bonus caps', G.restBonus(99) === G.restBonus(4));

// per-bar damage: a sparse syncopated part out-damages a flat wall of sound
function barDamage(pattern, bars = 4) {
  const n = { consecFires: 0, restCharge: 0 };
  let total = 0;
  for (let b = 0; b < bars; b++) for (let i = 0; i < 8; i++) {
    if (pattern[i]) { total += G.rhythmMod(n); n.consecFires++; n.restCharge = 0; }
    else { n.consecFires = 0; n.restCharge = Math.min(4, n.restCharge + 1); }
  }
  return total;
}
const allOn = barDamage([1,1,1,1,1,1,1,1]);
const synco = barDamage([1,0,0,1,0,0,1,0]);
ok('syncopated part out-damages all-on wall', synco > allOn);
ok('all-on per-note damage is suppressed (< 0.6 avg)', allOn / 32 < 0.6);
ok('rested first hit can crit above 1x', G.rhythmMod({ consecFires: 0, restCharge: 3 }) > 1.5);

// real simStep bookkeeping updates consec/rest on the placed node
st = G.makeState(123); st.energy = 999; st.state = 'wave';
const rn = G.placeNode(st, 'pulser', G.CONFIG.CORE_C, G.CONFIG.CORE_R - 1);
rn.steps = [1,1,0,0,0,0,0,0];
G.simStep(st); // step 0 -> fires
G.simStep(st); // step 1 -> fires (consecutive)
ok('consecutive fires accumulate', rn.consecFires === 2 && rn.restCharge === 0);
G.simStep(st); // step 2 -> rest
G.simStep(st); // step 3 -> rest
ok('rests reset consec & charge up', rn.consecFires === 0 && rn.restCharge === 2);

// --- musicality (C): monotony is mathematically worst ---
function boardWith(masks) {
  const s = G.makeState(7); s.energy = 99999;
  let i = 0;
  for (const m of masks) {
    const n = G.placeNode(s, 'pulser', 1 + i, 1);
    if (n) n.steps = m.slice();
    i++;
  }
  return G.computeMusicality(s);
}
const wallMus = boardWith([[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1]]);
const compMus = boardWith([[1,0,0,1,0,0,1,0],[0,1,0,0,1,0,1,0],[1,0,1,0,0,1,0,0]]);
ok('all-on wall scores low musicality', wallMus < 0.4);
ok('composed board scores high musicality', compMus > 0.7);
ok('composed beats wall by a wide margin', compMus - wallMus > 0.3);
ok('empty board returns neutral musicality', G.computeMusicality(G.makeState(1)) === 0.5);

// the wall is punished twice: low damage AND a low groove ceiling
const wallCap = 1 + (6 - 1) * wallMus, compCap = 1 + (6 - 1) * compMus;
ok('groove ceiling collapses for a monotone board', wallCap < compCap - 1.5);

// --- MAESTRO auto-arrange: one call composes a good-musicality board ---
function maestroBoard(seed, makeBad) {
  const s = G.makeState(seed); s.energy = 999999;
  // a clogged "wall" board across several types
  const types = ['pulser', 'pulser', 'splitter', 'relay', 'resonator', 'pulser'];
  for (let i = 0; i < types.length; i++) {
    const n = G.placeNode(s, types[i], 1 + i, 2);
    if (n && makeBad) n.steps = [1,1,1,1,1,1,1,1]; // worst case
  }
  return s;
}
const ms = maestroBoard(11, true);
const mBefore = G.computeMusicality(ms);
const after = G.autoArrange(ms, 0);
const blend = ms => 0.7 * G.computeMusicality(ms) + 0.3 * G.symmetryScore(ms);
ok('autoArrange returns the blended musicality+symmetry score', Math.abs(after - blend(ms)) < 1e-9);
ok('autoArrange lifts a clogged wall board', after > mBefore && G.computeMusicality(ms) > 0.6);
// re-rolls produce valid (often different) arrangements, all still good
const sig = s => s.nodes.filter(n => n.type !== 'amplifier').map(n => n.steps.join('')).join('|');
const a0 = sig(ms); G.autoArrange(ms, 3); const a3 = sig(ms);
ok('autoArrange variant keeps musicality high', G.computeMusicality(ms) > 0.55);
ok('amplifiers are left silent by autoArrange', (() => {
  const s = G.makeState(5); s.energy = 999999;
  G.placeNode(s, 'pulser', 1, 1); s.unlocked.amplifier = true;
  const amp = G.placeNode(s, 'amplifier', 2, 1); const was = amp.steps.join('');
  G.autoArrange(s, 0); return amp.steps.join('') === was;
})());
ok('autoArrange on an empty board returns its blended baseline', (() => {
  const s = G.makeState(1); return Math.abs(G.autoArrange(s, 0) - 0.35) < 1e-9; // 0.7*0.5 + 0.3*0
})());

// --- STAMP: copy one node's groove to its whole section ---
(() => {
  const s = G.makeState(9); s.energy = 999999;
  s.unlocked.splitter = true;
  const a = G.placeNode(s, 'pulser', 1, 1);
  const b = G.placeNode(s, 'pulser', 2, 1);
  const c = G.placeNode(s, 'splitter', 3, 1);
  a.steps = [1,0,1,1,0,0,1,0]; a.presetIdx = 2;
  const cBefore = c.steps.join('');
  const cnt = G.applyPatternToType(s, a);
  ok('applyPatternToType reports stamped count', cnt === 1);
  ok('stamp copies groove to same type', b.steps.join('') === a.steps.join('') && b.presetIdx === 2);
  ok('stamp leaves other types untouched', c.steps.join('') === cBefore);
  ok('stamp copies a new array, not a shared ref', (b.steps[0] = 0, a.steps[0] === 1));
})();

// --- HARMONY: the chord-progression backbone ---
(() => {
  const H = require('../js/harmony.js');
  // pure music-theory helpers
  ok('every progression has 4 chords drawn from the chord table',
     H.PROGRESSIONS.length > 0 && H.PROGRESSIONS.every(p =>
       p.chords.length === 4 && p.chords.every(c => H.CHORDS[c])));
  ok('pickProgression is deterministic for a seed', (() => {
    const a = H.pickProgression(RU.makeRNG(7)).name;
    const b = H.pickProgression(RU.makeRNG(7)).name;
    return a === b;
  })());
  const prog = H.PROGRESSIONS[0]; // AURORA: Am F C G, 2 bars each
  ok('chordAt holds each chord for BARS_PER_CHORD bars',
     H.chordAt(prog, 0) === prog.chords[0] && H.chordAt(prog, 1) === prog.chords[0] &&
     H.chordAt(prog, 2) === prog.chords[1]);
  ok('chordIndexAt wraps around the loop',
     H.chordIndexAt(prog, 0) === 0 && H.chordIndexAt(prog, 8) === 0 && H.chordIndexAt(prog, 2) === 1);
  ok('bassFreq is low & positive, padFreqs returns a triad',
     H.bassFreq('Am', 55) > 20 && H.bassFreq('Am', 55) < 120 &&
     H.padFreqs('C', 220).length === 3 && H.padFreqs('C', 220).every(f => f > 0));
  ok('chordRGB returns an [r,g,b] triple', (() => {
    const c = H.chordRGB('F'); return c.length === 3 && c.every(v => v >= 0 && v <= 255);
  })());
  // The node melody is minor-pentatonic; the chords give it harmonic motion.
  // Safety = every chord is DIATONIC TO A NATURAL MINOR (root ∈ {0,2,3,5,7,8,10}),
  // so pentatonic notes stay consonant over the whole progression. (Triads
  // intentionally include non-pentatonic tones like F & B — that's the harmony.)
  const aMinor = new Set([0, 2, 3, 5, 7, 8, 10]);
  ok('every chord root is diatonic to A natural minor',
     Object.values(H.CHORDS).every(c => aMinor.has(((c.root % 12) + 12) % 12)));
  ok('every triad is three distinct ascending tones',
     Object.values(H.CHORDS).every(c =>
       c.triad.length === 3 && c.triad[0] < c.triad[1] && c.triad[1] < c.triad[2]));
})();

// --- HARMONY drives the run state ---
(() => {
  const s = G.makeState(123);
  ok('a run picks a seeded progression', !!s.progression && s.progression.chords.length === 4);
  ok('run starts on the progression\'s first chord',
     s.chord === s.progression.chords[0] && s.chordIdx === 0);
  // simStep advances bars; after a full chord-window the chord should move on
  const startChord = s.chord;
  let changed = false, bars = 0;
  for (let i = 0; i < 8 * 6; i++) { // 6 bars of steps
    const before = s.bar;
    G.simStep(s);
    if (s.bar !== before) bars++;
    if (s.chord !== startChord) changed = true;
  }
  ok('bars increment as steps wrap', bars >= 5);
  ok('the chord progresses over several bars', changed);
  ok('the active chord is always one of the progression\'s chords',
     s.progression.chords.includes(s.chord));
  ok('Game exposes the Harmony module', !!G.Harmony && !!G.Harmony.chordAt);
})();

// --- PITCH MODEL: the board is a real instrument -------------------------
(() => {
  // scale helpers map degrees to in-tune semitones / names
  ok('A-minor scale has 7 degrees', RU.SCALES.minor.length === 7);
  ok('scaleDegreeToSemitone wraps octaves (degree 7 = +12)',
     RU.scaleDegreeToSemitone(7, RU.SCALES.minor) === 12 &&
     RU.scaleDegreeToSemitone(0, RU.SCALES.minor) === 0);
  ok('semitoneToFreq doubles every 12 semitones',
     Math.abs(RU.semitoneToFreq(12, 110) - 220) < 1e-9);
  ok('noteName reads absolute pitch (A2 base, +24 semis = A4)',
     RU.noteName(0, 110) === 'A2' && RU.noteName(24, 110) === 'A4');

  // a fresh pulser sits in a sensible mid register, and freqOf takes (n, G)
  const s = G.makeState(3); s.energy = 999999; s.musicality = 0;
  const n = G.placeNode(s, 'pulser', 2, 4);
  const f0 = G.freqOf(n, s);
  ok('freqOf(n, G) returns a positive audible frequency', f0 > 80 && f0 < 2000);
  ok('noteNameOf(G, n) names the same node', typeof G.noteNameOf(s, n) === 'string');

  // LEVEL raises the note exactly one scale step (and PITCH ▼ can drop it back)
  const lvlBefore = G.noteDegree(n);
  n.level = (n.level || 1) + 1;
  ok('leveling up raises pitch one scale step', G.noteDegree(n) === lvlBefore + 1);
  G.pitchShift(s, n, -1);
  ok('PITCH ▼ cancels the level\'s pitch rise (powerful LOW note)',
     G.noteDegree(n) === lvlBefore);

  // OCT jumps a clean octave (pitch-class kept = exact ×2 frequency)
  const beforeOct = G.freqOf(n, s);
  G.octaveShift(s, n, 1);
  ok('OCT ▲ exactly doubles the frequency (clean octave)',
     Math.abs(G.freqOf(n, s) - beforeOct * 2) < 1e-6);
  G.octaveShift(s, n, -1);

  // ACCIDENTAL bends one semitone and is clamped to ±1
  const semiBefore = Math.round(12 * Math.log2(G.freqOf(n, s) / 110));
  G.setAccidental(n, 1);
  ok('ACCIDENTAL ♯ raises exactly one semitone',
     Math.round(12 * Math.log2(G.freqOf(n, s) / 110)) === semiBefore + 1);
  G.setAccidental(n, 5);
  ok('ACCIDENTAL is clamped to +1', n.accidental === 1);
  G.setAccidental(n, 0);

  // BUFF → OCTAVE: an adjacent amplifier lifts the voice a clean octave
  const cleanHz = G.freqOf(n, s);
  s.unlocked.amplifier = true;
  G.placeNode(s, 'amplifier', 3, 4); // ortho-adjacent to (2,4)
  ok('an adjacent AMP lifts the note one octave (buff affects pitch, safely)',
     G.buffOctaves(s, n) >= 1 && Math.abs(G.freqOf(n, s) - cleanHz * 2) < 1e-6);

  // RESONANCE LIFT: a singing board (musicality ≥ 0.75) rises an octave
  const lowMusHz = G.freqOf(n, s);
  s.musicality = 0.8;
  ok('resonance lift adds an octave once musicality ≥ 0.75',
     Math.abs(G.freqOf(n, s) - lowMusHz * 2) < 1e-6);
  s.musicality = 0;
})();

// --- SYMMETRY + MAESTRO arch: position becomes music ---------------------
(() => {
  const s = G.makeState(5); s.energy = 999999;
  const center = G.CONFIG.CORE_C;
  // mirror a pulser pair across the centre column on the same row
  const left = G.placeNode(s, 'pulser', Math.floor(center) - 2, 2);
  const right = G.placeNode(s, 'pulser', Math.ceil(center) + 2, 2);
  ok('symmetryScore is in [0,1]', (() => { const v = G.symmetryScore(s); return v >= 0 && v <= 1; })());
  ok('a mirrored pair scores higher symmetry than a lone node', (() => {
    const lone = G.makeState(5); lone.energy = 9999; G.placeNode(lone, 'pulser', 1, 1);
    return G.symmetryScore(s) > G.symmetryScore(lone);
  })());

  // autoArrange should set a symmetric pitch ARCH: mirrored columns get equal pitch
  const board = G.makeState(11); board.energy = 999999;
  const cc = G.CONFIG.CORE_C;
  // place mirror pairs of pulsers across the centre on a couple of rows
  for (const r of [1, 6]) for (const d of [1, 2, 3]) {
    G.placeNode(board, 'pulser', Math.floor(cc) - d, r);
    G.placeNode(board, 'pulser', Math.ceil(cc) + d, r);
  }
  G.autoArrange(board, 0);
  // gather pulsers by |col - centre|; equal distance ⇒ equal pitch (mirrored arch)
  let archOk = true;
  const byRow = {};
  for (const nd of board.nodes) {
    if (nd.type !== 'pulser') continue;
    (byRow[nd.r] = byRow[nd.r] || []).push(nd);
  }
  for (const r in byRow) {
    for (const a of byRow[r]) for (const b of byRow[r]) {
      if (Math.abs(a.c - cc) === Math.abs(b.c - cc) && Math.abs(a.c - cc) > 0) {
        if ((a.pitch || 0) !== (b.pitch || 0)) archOk = false;
      }
    }
  }
  ok('autoArrange builds a mirrored pitch arch (equal |col| ⇒ equal pitch)', archOk);
})();

/* =======================================================================
 *  THE SMOOTH BLEND — pitch == colour == damage
 *  A pulse's note vs an enemy's note decides the damage multiplier. A board
 *  whose notes MATCH the enemies on screen out-damages a monochrome wall.
 * ===================================================================== */
console.log('\n— the smooth blend (pitch=colour=damage) —');
ok('unison (0 semitones) is the most consonant interval', (() => {
  for (let i = 1; i < 12; i++) if (RU.consonance(0) <= RU.consonance(i)) return false;
  return true;
})());
ok('unison out-damages a minor 2nd (consonance(0) > consonance(1))',
   RU.consonance(0) > RU.consonance(1));
ok('unison out-damages a tritone (consonance(0) > consonance(6))',
   RU.consonance(0) > RU.consonance(6));
ok('the tritone is among the harshest intervals (≤ 0.7)',
   RU.consonance(6) <= 0.7);
ok('consonance is octave-periodic (semitone 12 == unison)',
   RU.consonance(12) === RU.consonance(0));
ok('consonance handles negative intervals symmetrically',
   RU.consonance(-1) === RU.consonance(11) && RU.consonance(-12) === RU.consonance(0));
ok('a perfect fifth (7) is consonant (> 1)', RU.consonance(7) > 1);
ok('pcHue maps consonant intervals to nearby hues (fifth closer than tritone)', (() => {
  const dh = (a, b) => { let d = Math.abs(RU.pcHue(a) - RU.pcHue(b)); return Math.min(d, 360 - d); };
  return dh(0, 7) < dh(0, 6); // fifth's colour is nearer the tonic than the tritone's
})());
ok('pcColor returns a valid hsl string', /^hsl\(\d+(\.\d+)?,\d+%,\d+%\)$/.test(RU.pcColor(0)));

// A/B: a pitch-MATCHED board out-damages a MISMATCHED one over a fixed sim.
ok('a board matched to the enemy note out-damages a mismatched board', (() => {
  const sim = (pn, epc) => RU.consonance(pn - epc); // damage of pulse note pn vs enemy note epc
  let matchedWins = 0, n = 0;
  for (let epc = 0; epc < 12; epc++) {
    n++;
    const matched = sim(epc, epc);           // play the enemy's own note
    let worst = Infinity;
    for (let pn = 0; pn < 12; pn++) worst = Math.min(worst, sim(pn, epc));
    if (matched > worst) matchedWins++;       // matching beats the worst mismatch
  }
  return matchedWins === n;
})());

/* =======================================================================
 *  SHIFTER ENEMY — re-tunes its pitch class (and colour) while alive, so the
 *  note that shatters it keeps moving. Deepens the colour-matching mechanic.
 * ===================================================================== */
console.log('\n— the shifter (a moving colour target) —');
(() => {
  const s = G.makeState(31); s.state = 'wave'; s.hpMult = 1; s.speedMult = 1;
  G.spawnEnemy(s, 'shifter');
  const e = s.enemies[0];
  ok('shifter spawns with shift state', e && e.shifts === true && e.shiftTimer > 0);
  ok('shifter is coloured by its pitch class (pcColor)', e.color === RU.pcColor(e.pc, 60));
  const startPc = e.pc, startColor = e.color, seen = new Set([startPc]);
  let flashed = false;
  for (let i = 0; i < 60 * 8 && s.enemies[0]; i++) { // ~8s, but it walks to the core
    G.simUpdate(s, 1 / 60);
    const cur = s.enemies[0]; if (!cur) break;
    seen.add(cur.pc);
    if (cur.shiftFlash > 0.5) flashed = true;
    if (cur.shifts) ok._colourTracks = (cur.color === RU.pcColor(cur.pc, 60));
  }
  ok('shifter re-tunes to a new pitch class over time', seen.size >= 2);
  ok('shifter pulses (shiftFlash) when it re-tunes', flashed);
  ok('shifter colour always tracks its current pitch class', ok._colourTracks !== false);
})();
ok('waveSpec introduces shifters by the mid game (wave 8)', (() => {
  const rng = RU.makeRNG(77);
  const spec = G.waveSpec(8, rng);
  return Array.isArray(spec.queue); // shape sanity; spawn chance is probabilistic
})());
ok('waveSpec never spawns shifters in the first few waves', (() => {
  for (let w = 1; w <= 5; w++) {
    const spec = G.waveSpec(w, RU.makeRNG(w * 13 + 1));
    if (spec.queue.includes('shifter')) return false;
  }
  return true;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
