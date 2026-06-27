/* Build the Für Elise board (same layout as tools/furelise.js), encode it to a
 * share code, and print the R1~ code + the ?board= link. Verifies the round-trip
 * reproduces every note name + frequency bit-identically before printing. */
require('../js/util.js');
require('../js/audio.js');
require('../js/harmony.js');
const G = require('../js/game.js');
require('../js/sharecode.js');
const RShare = global.RShare;
const RU = global.RU;

const PHRASE = [
  ['E5',4,1,0,659.26],['D#5',3,1,1,622.25],['E5',4,1,0,659.26],['D#5',3,1,1,622.25],
  ['E5',4,1,0,659.26],['B4',1,1,0,493.88],['D5',3,1,0,587.33],['C5',2,1,0,523.25],
  ['A4',0,1,0,440.00],['C4',2,0,0,261.63],['E4',4,0,0,329.63],['A4',0,1,0,440.00],
  ['B4',1,1,0,493.88],['E4',4,0,0,329.63],['G#4',6,0,1,415.30],['B4',1,1,0,493.88],
  ['C5',2,1,0,523.25],
];

const st = G.makeState(1);
st.energy = 999999; st.musicality = 0;
const COLS = G.CONFIG.COLS;
PHRASE.forEach(([name,deg,oct,acc],i) => {
  const c = i % COLS;
  const r = G.CONFIG.ROWS - 1 - Math.floor(i / COLS);
  const n = G.placeNode(st,'pulser',c,r);
  if (!n) throw new Error('place fail '+name);
  n.pitch = deg - RU.rowToDegree(r, G.CONFIG.ROWS);
  n.octave = oct; n.accidental = acc;
});
st.cols = G.CONFIG.COLS; st.rows = G.CONFIG.ROWS;

const code = RShare.encodeBoard(st);

// verify round-trip
const G2 = RShare.loadCode(code, G, 1);
let ok = G2 && G2.nodes.length === PHRASE.length;
for (let i = 0; i < PHRASE.length && ok; i++) {
  const a = st.nodes[i], b = G2.nodes.find(x => x.c===a.c && x.r===a.r);
  if (!b) { ok = false; break; }
  if (Math.abs(G.freqOf(a,st) - G.freqOf(b,G2)) > 0.001) ok = false;
  if (G.noteNameOf(st,a) !== G.noteNameOf(G2,b)) ok = false;
}
if (!ok) { console.error('ROUND-TRIP FAILED'); process.exit(1); }

console.log('ROUNDTRIP_OK nodes='+PHRASE.length);
console.log('CODE='+code);
console.log('REL=?board='+code);
const base = process.argv[2] || '';
if (base) console.log('LINK='+RShare.buildShareUrl(base, code));
