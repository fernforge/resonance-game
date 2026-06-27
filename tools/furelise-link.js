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
const { PHRASE, layout } = require('./furelise-layout.js');

const st = G.makeState(1);
st.energy = 999999; st.musicality = 0;
// lay the melody out as a contour (x = phrase order, y = pitch) instead of
// dumping every node onto the bottom rows — see tools/furelise-layout.js.
const cells = layout(G.CONFIG.COLS, G.CONFIG.ROWS, G.CONFIG.CORE_C, G.CONFIG.CORE_R);
cells.forEach(({ c, r, p }) => {
  const [name, deg, oct, acc] = p;
  const n = G.placeNode(st, 'pulser', c, r);
  if (!n) throw new Error('place fail ' + name + ' @(' + c + ',' + r + ')');
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
