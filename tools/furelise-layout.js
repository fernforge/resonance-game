/* Shared layout for the Für Elise demo board.
 *
 * The notes used to be dumped left-to-right onto the bottom two rows, so the
 * famous melody was invisible and the board looked like a barcode. Instead we
 * lay each note out as a POINT ON THE MELODIC CONTOUR: x = position in the
 * phrase (left → right in playback order), y = pitch (higher note = higher on
 * the board). You can literally see Für Elise drawn across the board.
 *
 * Position is purely cosmetic here: each node's true pitch is dialled in with
 * the player-facing PITCH/OCT/ACCIDENTAL controls (see furelise-link.js), so we
 * are free to place a node anywhere and compensate its `pitch` offset. */

// The opening phrase: [name, scaleDegree, octave, accidental, realHz].
const PHRASE = [
  ['E5', 4, 1, 0, 659.26], ['D#5', 3, 1, 1, 622.25], ['E5', 4, 1, 0, 659.26],
  ['D#5', 3, 1, 1, 622.25], ['E5', 4, 1, 0, 659.26], ['B4', 1, 1, 0, 493.88],
  ['D5', 3, 1, 0, 587.33], ['C5', 2, 1, 0, 523.25], ['A4', 0, 1, 0, 440.00],
  ['C4', 2, 0, 0, 261.63], ['E4', 4, 0, 0, 329.63], ['A4', 0, 1, 0, 440.00],
  ['B4', 1, 1, 0, 493.88], ['E4', 4, 0, 0, 329.63], ['G#4', 6, 0, 1, 415.30],
  ['B4', 1, 1, 0, 493.88], ['C5', 2, 1, 0, 523.25],
];

// Compute a {c,r} for every note: c spreads across the board in phrase order,
// r tracks pitch (top row = highest). Collisions (and the core cell) are nudged
// to a free neighbouring row so every note still gets a distinct, on-board cell.
function layout(cols, rows, coreC, coreR) {
  const N = PHRASE.length;
  const freqs = PHRASE.map(p => p[4]);
  const fmin = Math.min(...freqs), fmax = Math.max(...freqs);
  const rTop = 1, rBot = rows - 2;            // keep a one-cell margin top & bottom
  const used = new Set();
  const taken = (c, r) => used.has(c + ',' + r) ||
    (Math.round(coreC) === c && Math.round(coreR) === r) ||
    c < 0 || c >= cols || r < 0 || r >= rows;

  return PHRASE.map((p, i) => {
    const c = Math.round(i * (cols - 1) / (N - 1));
    // higher frequency -> smaller row index (higher up the board)
    let r = Math.round(rBot - (p[4] - fmin) / (fmax - fmin) * (rBot - rTop));
    // resolve a clash by stepping outward to the nearest free row, then column
    if (taken(c, r)) {
      let placed = false;
      for (let d = 1; d <= rows && !placed; d++) {
        for (const rr of [r - d, r + d]) {
          if (!taken(c, rr)) { r = rr; placed = true; break; }
        }
      }
      if (!placed) {
        for (let dc = 1; dc < cols && !placed; dc++) {
          for (const cc of [c - dc, c + dc]) {
            if (!taken(cc, r)) { return finalize(cc, r); }
          }
        }
      }
    }
    return finalize(c, r);
    function finalize(fc, fr) { used.add(fc + ',' + fr); return { c: fc, r: fr, p }; }
  });
}

module.exports = { PHRASE, layout };
