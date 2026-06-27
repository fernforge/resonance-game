/* Auto-play balance harness: a greedy AI builds & drafts, we log the curve. */
require('../js/util.js');
require('../js/audio.js');
const G = require('../js/game.js');
const RU = global.RU;

// rhythm strategies to compare (verifies "fire every beat" is no longer optimal)
const PRESETS = [[1,0,0,1,0,0,1,0],[0,1,0,0,1,0,1,0],[1,0,1,0,0,1,0,0],[1,0,0,0,1,0,1,0]];
// force a node onto a target pitch CLASS by picking the n.pitch offset (near 0)
// whose resulting note lands on that class — lets us build a board of known colours.
function forcePC(st, n, targetPc) {
  let best = 0, bestD = 99;
  for (let p = -12; p <= 12; p++) {
    n.pitch = p;
    const pc = RU.pitchClassOf(G.semiOf(n, st));
    if (pc === targetPc && Math.abs(p) < bestD) { bestD = Math.abs(p); best = p; }
  }
  n.pitch = best;
}
// the minor scale's pitch classes — the colours enemies actually wear (chord
// tones + the occasional off-chord scale tone). A "rainbow" board spreads its
// notes across exactly these, so every incoming colour meets a matching node.
const SCALE_PCS = (RU.SCALES.minor).map(s => ((s % 12) + 12) % 12);
function retune(st, tune) {
  if (!tune) return;
  let i = 0;
  for (const n of st.nodes) {
    if (n.type === 'amplifier') continue;
    if (tune === 'allon') n.steps = [1,1,1,1,1,1,1,1];
    else if (tune === 'sparse') n.steps = PRESETS[i % PRESETS.length].slice();
    // PITCH strategies — both fire every beat (rhythm held constant) so the ONLY
    // variable is the colour/pitch of the notes vs the colour/pitch of the enemies.
    // rainbow COVERS the scale (answers every enemy colour); mono sits on the root
    // (shatters root-coloured foes, but the rest of the swarm leaks past it).
    else if (tune === 'rainbow') { n.steps = [1,1,1,1,1,1,1,1]; forcePC(st, n, SCALE_PCS[i % SCALE_PCS.length]); }
    else if (tune === 'mono')    { n.steps = [1,1,1,1,1,1,1,1]; forcePC(st, n, 0); }
    i++;
  }
}

function autoPlay(seed, verbose, tune) {
  const st = G.makeState(seed);
  // spread starting nodes near the core ring
  const ring = [[5,3],[7,3],[5,5],[7,5],[6,3],[6,5],[5,4],[7,4]];
  let ri = 0;
  const placeAffordable = () => {
    // place unlocked shooters we can afford, prefer resonator>splitter>pulser>relay
    const order = ['resonator','splitter','pulser','relay','amplifier'];
    let placed = true;
    while (placed) {
      placed = false;
      for (const t of order) {
        if (!st.unlocked[t]) continue;
        if (st.energy < G.nodeCost(st, t)) continue;
        // find a free ring cell, else any free near center
        let cell = null;
        for (let k = 0; k < ring.length; k++) { const [c, r] = ring[(ri + k) % ring.length]; if (G.canPlace(st, c, r)) { cell = [c, r]; ri = (ri + k + 1) % ring.length; break; } }
        if (!cell) { // scan grid (full board, prefer cells nearer core)
          let best = null, bd = 1e9;
          for (let c = 0; c < G.CONFIG.COLS; c++) for (let r = 0; r < G.CONFIG.ROWS; r++) {
            if (!G.canPlace(st, c, r)) continue;
            const d = (c - G.CONFIG.CORE_C) ** 2 + (r - G.CONFIG.CORE_R) ** 2;
            if (d < bd) { bd = d; best = [c, r]; }
          }
          cell = best;
        }
        if (cell && G.placeNode(st, t, cell[0], cell[1])) { placed = true; break; }
      }
    }
  };

  let guard = 0;
  const log = [];
  while (st.state !== 'gameover' && guard++ < 80) {
    placeAffordable();
    retune(st, tune);
    if (st.state === 'building') G.startWave(st);
    // run the wave
    let f = 0;
    while (st.state === 'wave' && f++ < 60 * 90) G.simUpdate(st, 1 / 60);
    log.push({ wave: st.wave, core: Math.ceil(st.coreHP), nodes: st.nodes.length, energy: Math.floor(st.energy), score: st.score });
    if (st.state === 'draft') {
      // greedy: prefer unlocks, then damage, then anything
      const d = st.pendingDraft;
      const pick = d.find(o => o.kind === 'unlock') || d.find(o => o.id === 'dmg') || d[0];
      G.applyDraft(st, pick);
    }
  }
  if (verbose) {
    for (const l of log) console.log(`  W${String(l.wave).padStart(2)}  core ${String(l.core).padStart(3)}  nodes ${String(l.nodes).padStart(2)}  energy ${String(l.energy).padStart(3)}  score ${l.score}`);
  }
  return { wave: st.wave, score: st.score, nodes: st.nodes.length, mus: st.musicality };
}

console.log('Balance — single verbose run (seed 7):');
autoPlay(7, true);

console.log('\nBalance — 12 seeds, greedy AI:');
const res = [];
for (let s = 1; s <= 12; s++) res.push(autoPlay(s * 13 + 1, false));
const waves = res.map(r => r.wave).sort((a, b) => a - b);
const avg = waves.reduce((a, b) => a + b, 0) / waves.length;
console.log('  waves reached:', waves.join(', '));
console.log('  min', waves[0], 'median', waves[Math.floor(waves.length / 2)], 'max', waves[waves.length - 1], 'avg', avg.toFixed(1));
console.log('  avg score', Math.round(res.reduce((a, r) => a + r.score, 0) / res.length));

// HEAD-TO-HEAD: is "fire every beat" still the dominant strategy?
console.log('\nRhythm strategy A/B — same seeds, all-on wall vs sparse syncopation:');
let allWaves = 0, allScore = 0, spWaves = 0, spScore = 0, sparseWins = 0, n = 14;
for (let s = 1; s <= n; s++) {
  const seed = s * 29 + 3;
  const a = autoPlay(seed, false, 'allon');
  const b = autoPlay(seed, false, 'sparse');
  allWaves += a.wave; allScore += a.score;
  spWaves += b.wave; spScore += b.score;
  if (b.score >= a.score) sparseWins++;
}
console.log(`  ALL-ON   avg wave ${(allWaves/n).toFixed(1)}  avg score ${Math.round(allScore/n)}`);
console.log(`  SPARSE   avg wave ${(spWaves/n).toFixed(1)}  avg score ${Math.round(spScore/n)}`);
console.log(`  sparse >= all-on on score in ${sparseWins}/${n} seeds`);
console.log(sparseWins > n / 2
  ? '  ✓ blanket fire is NO LONGER optimal — composition wins.'
  : '  ✗ all-on still dominates — needs rebalance.');

// HEAD-TO-HEAD: does PITCH/COLOUR matter? rainbow board (covers every enemy note)
// vs monochrome board (one note). Both fire every beat — only the colour differs.
console.log('\nPitch strategy A/B — same seeds, rainbow (matched) vs monochrome:');
let rW = 0, rS = 0, mW = 0, mS = 0, rainWins = 0, pn = 14;
for (let s = 1; s <= pn; s++) {
  const seed = s * 31 + 5;
  const a = autoPlay(seed, false, 'rainbow');
  const b = autoPlay(seed, false, 'mono');
  rW += a.wave; rS += a.score; mW += b.wave; mS += b.score;
  // survival (waves reached) is the clean proxy: a board that matches the enemy
  // colours kills them and lives; a one-note board whiffs and the Core falls.
  if (a.wave >= b.wave) rainWins++;
}
console.log(`  RAINBOW  avg wave ${(rW/pn).toFixed(1)}  avg score ${Math.round(rS/pn)}`);
console.log(`  MONO     avg wave ${(mW/pn).toFixed(1)}  avg score ${Math.round(mS/pn)}`);
console.log(`  rainbow >= mono on waves survived in ${rainWins}/${pn} seeds`);
console.log(rainWins > pn / 2
  ? '  ✓ matching note-COLOUR to enemies wins — pitch is mechanically real.'
  : '  ✗ pitch matching does not pay off — rebalance consonance table.');
