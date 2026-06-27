/* RESONANCE — sharecode.js : encode a composed board into a short pasteable
 * code and rebuild it. This is the viral hook in its most reproducible form —
 * not a screenshot of your run but the actual INSTRUMENT, so a friend can paste
 * your code and HEAR the exact song your board plays.
 *
 * A board's song is fully determined by: board size (rowToDegree depends on ROWS)
 * + every node's {type, c, r, level, pitch, octave, accidental, steps}. We pack
 * those into bytes, base64url them, and prefix "R1~". Pure + headless-testable;
 * no DOM, no Game dependency for encode/decode (applyBoard takes Game in).
 */
(function (root) {
  'use strict';

  const VERSION = 1;
  const TYPE_ORDER = ['pulser', 'splitter', 'relay', 'amplifier', 'resonator'];
  const PREFIX = 'R1~';

  // ---- base64url over a plain byte array (env-independent) ----
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const B64I = (() => { const m = {}; for (let i = 0; i < B64.length; i++) m[B64[i]] = i; return m; })();
  function bytesToB64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      const has1 = i + 1 < bytes.length, has2 = i + 2 < bytes.length;
      const n = (b0 << 16) | ((has1 ? b1 : 0) << 8) | (has2 ? b2 : 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
      out += has1 ? B64[(n >> 6) & 63] : '';
      out += has2 ? B64[n & 63] : '';
    }
    return out;
  }
  function b64ToBytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i += 4) {
      const c0 = B64I[str[i]], c1 = B64I[str[i + 1]];
      const c2 = str[i + 2] !== undefined ? B64I[str[i + 2]] : undefined;
      const c3 = str[i + 3] !== undefined ? B64I[str[i + 3]] : undefined;
      if (c0 === undefined || c1 === undefined) break;
      const n = (c0 << 18) | (c1 << 12) | ((c2 || 0) << 6) | (c3 || 0);
      bytes.push((n >> 16) & 255);
      if (c2 !== undefined) bytes.push((n >> 8) & 255);
      if (c3 !== undefined) bytes.push(n & 255);
    }
    return bytes;
  }

  const clamp8 = v => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

  // ---- encode ----
  // Per node = 7 bytes: type, c, r, level, pitch+14, (octave+3)<<4|(acc+1), steps-mask
  function encodeBoard(G) {
    const cols = G.cols || (root.RGame && root.RGame.CONFIG.COLS) || 13;
    const rows = G.rows || (root.RGame && root.RGame.CONFIG.ROWS) || 11;
    const nodes = G.nodes || [];
    const bytes = [VERSION, clamp8(cols), clamp8(rows),
      (nodes.length >> 8) & 255, nodes.length & 255];
    for (const n of nodes) {
      const ti = Math.max(0, TYPE_ORDER.indexOf(n.type));
      let mask = 0;
      const steps = n.steps || [];
      for (let s = 0; s < 8; s++) if (steps[s]) mask |= (1 << s);
      bytes.push(
        ti,
        clamp8(n.c), clamp8(n.r),
        clamp8(Math.max(1, n.level || 1)),
        clamp8((n.pitch || 0) + 14),
        clamp8((((n.octave || 0) + 3) << 4) | (((n.accidental || 0) + 1) & 15)),
        mask & 255,
      );
    }
    return PREFIX + bytesToB64(bytes);
  }

  // ---- decode (pure data, no Game needed) ----
  function decodeBoard(str) {
    if (typeof str !== 'string') return null;
    let s = str.trim();
    if (s.indexOf(PREFIX) === 0) s = s.slice(PREFIX.length);
    s = s.replace(/\s+/g, '');
    const bytes = b64ToBytes(s);
    if (bytes.length < 5 || bytes[0] !== VERSION) return null;
    const cols = bytes[1], rows = bytes[2];
    const count = (bytes[3] << 8) | bytes[4];
    const nodes = [];
    let p = 5;
    for (let i = 0; i < count; i++) {
      if (p + 7 > bytes.length) break;
      const ti = bytes[p], c = bytes[p + 1], r = bytes[p + 2];
      const level = bytes[p + 3], pitch = bytes[p + 4] - 14;
      const oa = bytes[p + 5], octave = (oa >> 4) - 3, accidental = (oa & 15) - 1;
      const mask = bytes[p + 6];
      const steps = [];
      for (let st = 0; st < 8; st++) steps.push((mask >> st) & 1);
      nodes.push({
        type: TYPE_ORDER[ti] || 'pulser',
        c, r, level, pitch, octave, accidental, steps,
      });
      p += 7;
    }
    return { version: VERSION, cols, rows, nodes };
  }

  // ---- rebuild a loadable game state from decoded data ----
  // Returns a fresh G (via Game.makeState) with the board sized, all node types
  // unlocked, and every node placed. Drops nodes that fall outside the board or
  // collide. seed only colours the harmonic backbone; the notes come from data.
  function applyBoard(data, Game, seed) {
    if (!data || !Game) return null;
    const G = Game.makeState(seed || 12345);
    Game.setBoardSize(data.cols, data.rows);
    G.cols = data.cols; G.rows = data.rows;
    for (const k in G.unlocked) G.unlocked[k] = true;
    G.nodes = []; G.grid = new Map();
    const key = (c, r) => c + ',' + r;
    for (const d of data.nodes) {
      if (d.c < 0 || d.c >= data.cols || d.r < 0 || d.r >= data.rows) continue;
      if (d.c === Game.CONFIG.CORE_C && d.r === Game.CONFIG.CORE_R) continue;
      if (G.grid.has(key(d.c, d.r))) continue;
      const def = Game.NODE_TYPES[d.type] || Game.NODE_TYPES.pulser;
      const n = {
        type: d.type, c: d.c, r: d.r,
        level: Math.max(1, d.level || 1),
        steps: (d.steps && d.steps.length === 8) ? d.steps.slice() : def.steps.slice(),
        born: 0, pitch: d.pitch || 0, octave: d.octave || 0, accidental: d.accidental || 0,
        consecFires: 0, restCharge: 0, critFlash: 0,
      };
      G.nodes.push(n);
      G.grid.set(key(d.c, d.r), n);
    }
    return G;
  }

  // round-trip helper used by tests + the load button
  function loadCode(str, Game, seed) {
    const data = decodeBoard(str);
    return data ? applyBoard(data, Game, seed) : null;
  }

  // ---- one-click share links ----
  // Pull a board code out of a URL / query / hash string. Accepts a full URL,
  // a bare "?board=…" search, a "#board=…" hash, or even the raw code. Returns
  // the code string (still prefixed R1~) or null. Pure — testable without a DOM.
  function boardFromUrl(urlOrSearch) {
    if (typeof urlOrSearch !== 'string' || !urlOrSearch) return null;
    // raw code pasted straight in
    if (urlOrSearch.indexOf(PREFIX) === 0) return urlOrSearch.trim();
    const m = urlOrSearch.match(/[?&#]board=([^&#\s]+)/);
    if (!m) return null;
    let v;
    try { v = decodeURIComponent(m[1]); } catch (e) { v = m[1]; }
    v = v.trim();
    return v.indexOf(PREFIX) === 0 ? v : null;
  }

  // Build a shareable link: base origin+path, board code in the query. We keep
  // the code unencoded (base64url + "R1~" are all URL-safe) so links stay short
  // and human-legible.
  function buildShareUrl(base, code) {
    if (typeof code !== 'string' || code.indexOf(PREFIX) !== 0) return null;
    let b = (typeof base === 'string' && base) ? base : '';
    b = b.split('#')[0].split('?')[0]; // drop any existing query/hash
    return b + '?board=' + code;
  }

  const Share = { VERSION, PREFIX, TYPE_ORDER, encodeBoard, decodeBoard, applyBoard, loadCode,
    boardFromUrl, buildShareUrl, bytesToB64, b64ToBytes };
  root.RShare = Share;
  if (typeof module !== 'undefined' && module.exports) module.exports = Share;
})(typeof window !== 'undefined' ? window : globalThis);
