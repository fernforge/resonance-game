/* RESONANCE — game.js : simulation + rendering + input + loop. */
(function (root) {
  'use strict';
  const RU = root.RU;
  const Harmony = root.RHarmony;
  const RawAudio = root.RAudio || {
    init(){}, resume(){}, note(){}, tick(){}, impact(){}, chord(){}, bass(){}, pad(){}, setPack(){}, setMuted(){}, isMuted(){return false;}, ready:false,
  };
  // Safe audio facade: audio is purely cosmetic, so NO sound call from any path
  // (the beat loop, placement, buttons, the shop) may ever throw and freeze the
  // game. Every method forwards to the real engine inside a try/catch.
  const Audio = (() => {
    const safe = {};
    for (const m of ['init', 'resume', 'note', 'tick', 'impact', 'chord', 'bass', 'pad', 'setPack', 'setMuted']) {
      safe[m] = function () { try { return RawAudio[m].apply(RawAudio, arguments); } catch (e) { return undefined; } };
    }
    safe.isMuted = function () { try { return RawAudio.isMuted(); } catch (e) { return false; } };
    Object.defineProperty(safe, 'ready', { get() { try { return RawAudio.ready; } catch (e) { return false; } } });
    return safe;
  })();
  const { clamp, lerp, dist, TAU, makeRNG, degreeToFreq, rowToDegree,
          SCALES, scaleDegreeToSemitone, semitoneToFreq, noteName,
          pitchClassOf, consonance, pcHue, pcColor } = RU;

  /* =======================================================================
   *  CONFIG & DEFINITIONS
   * ===================================================================== */
  const BASE_COLS = 13, BASE_ROWS = 9;
  const CONFIG = {
    COLS: BASE_COLS, ROWS: BASE_ROWS, UNIT: 64,
    BASE_COLS, BASE_ROWS,
    EXPAND_EVERY: 5,     // grow the board a ring every N cleared waves
    MAX_COLS: 21, MAX_ROWS: 17,
    STEPS: 8,            // eighth notes per bar
    BPM: 100,
    CORE_HP: 100,
    START_ENERGY: 40,
    PROJ_SPEED: 640,     // world units / sec
    BASE_HZ: 110,        // tonic = A2
    SCALE: 'minor',      // A natural minor — 7 notes, melody-capable, single-key consonant
    KEY_OFFSET: 12,      // global transpose (semitones) so a mid-row pulser sits ~A3/A4
  };
  // board dimensions are mutable (the board grows over a run) — recompute derived sizes
  function setBoardSize(cols, rows) {
    CONFIG.COLS = cols; CONFIG.ROWS = rows;
    CONFIG.BOARD_W = cols * CONFIG.UNIT;
    CONFIG.BOARD_H = rows * CONFIG.UNIT;
    CONFIG.CORE_C = (cols - 1) / 2;
    CONFIG.CORE_R = (rows - 1) / 2;
  }
  setBoardSize(BASE_COLS, BASE_ROWS);
  const stepDur = () => 60 / CONFIG.BPM / 2;

  /* =======================================================================
   *  RHYTHM ECONOMY — "silence is power" (fixes the fire-every-beat problem)
   *  A) Per-node: consecutive notes lose punch (falloff); rests charge a node
   *     so the next hit after silence crits. Syncopated, spaced phrases out-
   *     damage a flat wall of sound.
   *  C) Board-wide: a Musicality/Resonance quality (sparsity + syncopation +
   *     part-variety) scales the Groove cap. A monotone all-on board can never
   *     climb the multiplier; a well-composed one can.
   * ===================================================================== */
  // consecutive-fire damage falloff (index = notes already played in a row)
  const FALLOFF = [1, 0.78, 0.62, 0.52, 0.46];
  const REST_CRIT_PER = 0.32, REST_CRIT_MAX = 4; // up to +128% after 4 rests
  const falloffAt = c => FALLOFF[Math.min(c | 0, FALLOFF.length - 1)];
  const restBonus = r => 1 + REST_CRIT_PER * Math.min(r | 0, REST_CRIT_MAX);
  // the per-note damage modifier a node earns from its current rhythm state
  function rhythmMod(n) { return falloffAt(n.consecFires || 0) * restBonus(n.restCharge || 0); }

  // board Musicality in [0,1]: sparsity (peak ~40% fill), syncopation, variety
  function computeMusicality(G) {
    // amps are silent; relays have no beats of their own — judge the programmed voices
    const nodes = G.nodes.filter(n => n.type !== 'amplifier' && n.type !== 'relay');
    const STEPS = CONFIG.STEPS;
    let totalNotes = 0, withNotes = 0, offbeat = 0;
    const masks = new Map();
    for (const n of nodes) {
      let cnt = 0;
      for (let i = 0; i < STEPS; i++) if (n.steps[i]) { cnt++; if (i % 2 === 1) offbeat++; }
      if (cnt === 0) continue;
      withNotes++; totalNotes += cnt;
      const k = n.steps.join('');
      masks.set(k, (masks.get(k) || 0) + 1);
    }
    if (withNotes === 0 || totalNotes === 0) return 0.5; // nothing to judge yet
    const avgFill = totalNotes / (withNotes * STEPS);
    const densityScore = clamp(1 - Math.abs(avgFill - 0.4) / 0.5, 0, 1);
    const offRatio = offbeat / totalNotes;
    const syncScore = clamp(1 - Math.abs(offRatio - 0.5) * 2, 0, 1);
    const varietyScore = withNotes <= 1
      ? 0.55
      : clamp(masks.size / Math.min(withNotes, 4), 0, 1);
    return clamp(0.55 * densityScore + 0.20 * syncScore + 0.25 * varietyScore, 0, 1);
  }

  /* ----- ensemble tuning: make dozens of nodes painless -------------------
   * Two pure, headless-testable helpers:
   *   autoArrange(G, variant) — MAESTRO: composes the whole board at once,
   *     giving each node a rhythmic ROLE by type and a phase by position so
   *     parts interlock instead of stacking. Tries several offsets/strategies
   *     and keeps the one computeMusicality scores highest. `variant` re-rolls
   *     to a different (still optimized) arrangement.
   *   applyPatternToType(G, n) — STAMP: copy one node's groove to its whole
   *     section (every node of the same type). Tune one, shape the section.
   * --------------------------------------------------------------------- */
  // each attacking type gets a default rhythmic "voice" in the ensemble
  // (relays have no beats of their own — they echo, so they get no role here)
  const ROLE_PATTERNS = {
    pulser:    [1,0,0,0,1,0,0,0], // the backbone — anchors the downbeats
    splitter:  [0,0,1,0,0,0,1,0], // offbeat stabs across the swarm
    resonator: [1,0,0,0,0,0,1,0], // sparse, heavy accents
  };
  const rotPattern = (p, k) => {
    const S = p.length; k = ((k % S) + S) % S;
    const out = new Array(S);
    for (let i = 0; i < S; i++) out[i] = p[(i - k + S) % S];
    return out;
  };
  // how symmetric the board LOOKS and SOUNDS: fraction of nodes that have a
  // same-type partner mirrored across the vertical centre column, weighted up
  // when that partner also matches pitch (a true mirror) — in [0,1].
  function symmetryScore(G) {
    const nodes = G.nodes;
    if (!nodes.length) return 0;
    const center = CONFIG.CORE_C;
    let score = 0;
    for (const n of nodes) {
      const mc = (CONFIG.COLS - 1) - n.c;     // mirrored column
      if (mc === n.c) { score += 1; continue; } // sits on the axis → self-mirrored
      const m = G.grid.get(key(mc, n.r));
      if (m && m.type === n.type) {
        const pitchMirror = (m.level === n.level) && ((m.pitch || 0) === (n.pitch || 0))
          && ((m.octave || 0) === (n.octave || 0)) && ((m.accidental || 0) === (n.accidental || 0));
        score += pitchMirror ? 1 : 0.6;
      }
    }
    return clamp(score / nodes.length, 0, 1);
  }
  // MAESTRO's quality target blends a good rhythm (musicality) with a balanced,
  // mirror-symmetric layout (symmetry) — so it composes parts that both groove
  // and look/sound balanced about the Core.
  function blendScore(G) {
    return clamp(0.7 * computeMusicality(G) + 0.3 * symmetryScore(G), 0, 1);
  }
  // lay a symmetric PITCH ARCH over the board: voices equidistant from the
  // centre column share a pitch, peaking in the middle and easing outward — a
  // shape that is balanced both to the ear and to the eye.
  function applyPitchArch(G) {
    const center = CONFIG.CORE_C;
    for (const n of G.nodes) {
      if (n.type === 'amplifier') continue;
      n.pitch = clamp(Math.round(2 - Math.abs(n.c - center)), -4, 2);
    }
  }
  function autoArrange(G, variant) {
    variant = variant | 0;
    // only nodes with their own beats get arranged; relays echo, amps stay silent
    const attackers = G.nodes.filter(n => n.type !== 'amplifier' && n.type !== 'relay');
    if (!attackers.length) { applyPitchArch(G); return blendScore(G); }
    const center = CONFIG.CORE_C;
    const half = CONFIG.STEPS >> 1;
    // index nodes within their own type so multiple pulsers don't all stack
    const perType = {};
    let best = null, bestScore = -1;
    // candidate strategies: spread phase by within-type index and/or by row,
    // each offset by `variant` so re-rolls explore a different good arrangement
    const strategies = [
      (n, ti) => ti,                 // fan out same-type nodes across the bar
      (n, ti) => ti * 2,             // wider spread
      (n) => n.r,                    // phase by board row (spatial polyrhythm)
      (n, ti) => ti + ((n.c + n.r) & 1) * 2, // checkerboard interleave
      // call-and-response: mirrored halves answer each other half a bar apart,
      // so the board's left and right sides trade phrases (position → rhythm)
      (n, ti) => ti + (n.c < center ? 0 : half),
    ];
    for (let s = 0; s < strategies.length; s++) {
      for (const ti in perType) delete perType[ti];
      const phaseOf = strategies[s];
      const assign = attackers.map(n => {
        const idx = (perType[n.type] = (perType[n.type] || 0) + 1) - 1;
        const base = ROLE_PATTERNS[n.type] || ROLE_PATTERNS.pulser;
        return rotPattern(base, phaseOf(n, idx) + variant);
      });
      const saved = attackers.map(n => n.steps);
      attackers.forEach((n, i) => { n.steps = assign[i]; });
      const sc = computeMusicality(G);
      attackers.forEach((n, i) => { n.steps = saved[i]; });
      if (sc > bestScore) { bestScore = sc; best = assign; }
    }
    attackers.forEach((n, i) => { n.steps = best[i].slice(); n.presetIdx = null; });
    applyPitchArch(G); // MAESTRO accounts for position/symmetry, not just rhythm
    return blendScore(G);
  }
  function applyPatternToType(G, n) {
    let count = 0;
    for (const m of G.nodes) {
      if (m.type === n.type && m !== n) { m.steps = n.steps.slice(); m.presetIdx = n.presetIdx; count++; }
    }
    return count;
  }

  // node archetypes — the build space
  const NODE_TYPES = {
    pulser:    { key:'pulser',    name:'PULSER',    icon:'◈', color:'#36e0c8', cost:8,
      dmg:9,  range:2.7, shots:1, pierce:0, voice:'pulser',    degOff:0,
      steps:[1,0,1,0,1,0,1,0], unlocked:true,
      desc:'Fires at the nearest enemy on its beats. Your bread-and-butter voice.' },
    splitter:  { key:'splitter',  name:'SPLITTER',  icon:'✳', color:'#6ad1ff', cost:15,
      dmg:6,  range:2.4, shots:3, pierce:0, voice:'splitter',  degOff:2,
      steps:[1,0,0,0,1,0,0,0], unlocked:false,
      desc:'Strikes up to 3 enemies at once. Great for swarms; bright staccato.' },
    relay:     { key:'relay',     name:'RELAY',     icon:'◇', color:'#b48cff', cost:11,
      dmg:5,  range:2.3, shots:1, pierce:1, voice:'relay',     degOff:4,
      steps:[0,0,0,0,0,0,0,0], unlocked:false,
      desc:'Has no beats of its own — echoes any neighbor that fires. Chain them for dense polyrhythms.' },
    amplifier: { key:'amplifier', name:'AMP',       icon:'▲', color:'#ffd166', cost:13,
      dmg:0,  range:0,   shots:0, pierce:0, voice:'amplifier', degOff:-5,
      steps:[1,0,0,0,1,0,0,0], unlocked:false,
      desc:'No attack. Boosts every adjacent node (+30% dmg & pierce). Warm pad.' },
    resonator: { key:'resonator', name:'RESONATOR', icon:'✦', color:'#ff5ea8', cost:20,
      dmg:26, range:2.5, shots:1, pierce:2, voice:'resonator', degOff:-3,
      steps:[1,0,0,0,1,0,0,0], unlocked:false,
      desc:'You set its beats, but it only strikes when a neighbor fires on that same beat. Huge hit — Sync = +60%.' },
  };

  const ENEMY_TYPES = {
    grunt:    { key:'grunt',    hp:18, speed:30, radius:13, reward:3, score:10, dmg:6,  color:'#ff6b9d' },
    fast:     { key:'fast',     hp:12, speed:62, radius:10, reward:3, score:12, dmg:5,  color:'#ffa24b' },
    tank:     { key:'tank',     hp:64, speed:19, radius:21, reward:8, score:42, dmg:14, color:'#c66bff' },
    splitter: { key:'splitter', hp:30, speed:27, radius:16, reward:5, score:26, dmg:8,  color:'#7affb0', splits:2 },
    mini:     { key:'mini',     hp:8,  speed:48, radius:9,  reward:1, score:4,  dmg:3,  color:'#9bffd0' },
    // shifter — re-tunes its pitch class every couple seconds, recolouring as it
    // goes, so the note that shatters it keeps changing. Rewards a varied board.
    shifter:  { key:'shifter',  hp:34, speed:33, radius:14, reward:6, score:34, dmg:9,  color:'#5ad1ff', shifts:true },
    // boss — appears on every 10th wave. Huge, slow, pays out big, shatters into a fast swarm.
    conductor:{ key:'conductor',hp:240,speed:16, radius:30, reward:45, score:500, dmg:34, color:'#ffd166', splits:4, splitInto:'fast', boss:true },
  };

  /* =======================================================================
   *  PURE HELPERS
   * ===================================================================== */
  const key = (c, r) => c + ',' + r;
  const cellCenter = (c, r) => ({ x: (c + 0.5) * CONFIG.UNIT, y: (r + 0.5) * CONFIG.UNIT });
  const coreXY = () => cellCenter(CONFIG.CORE_C, CONFIG.CORE_R);

  function waveSpec(wave, rng) {
    const isBoss = wave % 10 === 0;
    // boss waves carry a lighter trash escort so the boss is the centerpiece
    const count = Math.min(80, Math.floor((5 + wave * 2.2) * (isBoss ? 0.6 : 1)));
    // gentle early floor, steep late ceiling
    const hpMult = 1 + 0.14 * (wave - 1) + 0.03 * (wave - 1) * (wave - 1);
    const speedMult = 1 + Math.min(1.3, 0.02 * (wave - 1));
    const queue = [];
    for (let i = 0; i < count; i++) {
      const roll = rng.next();
      let t = 'grunt';
      if (wave >= 6 && roll > 0.88) t = 'shifter';
      else if (wave >= 5 && roll > 0.85) t = 'splitter';
      else if (wave >= 4 && roll > 0.7) t = 'tank';
      else if (wave >= 2 && roll > 0.48) t = 'fast';
      queue.push(t);
    }
    let q = rng.shuffle(queue);
    if (isBoss) q = [...q, 'conductor']; // boss arrives last, after its escort
    const interval = Math.max(0.3, 1.35 - wave * 0.055);
    return { count, hpMult, speedMult, queue: q, interval, isBoss };
  }

  function makeState(seed) {
    const rng = makeRNG(seed || 12345);
    setBoardSize(BASE_COLS, BASE_ROWS); // every new run starts at the base board
    const progression = Harmony ? Harmony.pickProgression(rng) : null;
    return {
      rng, state: 'building', wave: 0,
      boardExpands: 0,
      coreHP: CONFIG.CORE_HP, coreMaxHP: CONFIG.CORE_HP,
      energy: CONFIG.START_ENERGY, score: 0,
      nodes: [], grid: new Map(),
      enemies: [], projectiles: [], particles: [], floats: [],
      step: -1, beatAcc: 0, sinceStep: 0, beatFlash: 0,
      // harmonic backbone: a seeded chord progression that advances as the run
      // builds, so every run is its own evolving song (Harmony module)
      progression,
      bar: 0, chordIdx: 0, chord: progression ? progression.chords[0] : 'Am',
      chordFlash: 0,
      spawnQueue: [], spawnTimer: 0, spawnInterval: 1.2, hpMult: 1, speedMult: 1,
      bossWave: false, bossesFelled: 0,
      grooveCombo: 0, grooveTimer: 0, grooveMult: 1, musicality: 0.5,
      shake: 0, time: 0,
      // run modifiers (from drafts)
      dmgMult: 1, projSpeedMult: 1, rangeMult: 1, nodeCostMult: 1,
      energyBonus: 0, grooveCap: 6,
      unlocked: { pulser: true, splitter: false, relay: false, amplifier: false, resonator: false },
      selType: null, hover: null,
      pendingDraft: null,
    };
  }

  // adjacency helpers
  function neighborsOf(G, n, diag) {
    const out = [];
    const offs = diag
      ? [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]
      : [[0,-1],[-1,0],[1,0],[0,1]];
    for (const [dc, dr] of offs) {
      const m = G.grid.get(key(n.c + dc, n.r + dr));
      if (m) out.push(m);
    }
    return out;
  }
  function ampBuff(G, n) {
    let count = 0;
    for (const m of neighborsOf(G, n, true)) if (m.type === 'amplifier') count++;
    return 1 + 0.3 * count;
  }
  function ampPierce(G, n) {
    for (const m of neighborsOf(G, n, true)) if (m.type === 'amplifier') return 1;
    return 0;
  }
  /* =======================================================================
   *  PITCH MODEL — the note a node plays is the SUM of legible contributions,
   *  every one of which the player can read and steer. All defaults are fully
   *  consonant in A minor; only level / pitch / accidental change pitch-CLASS
   *  (deliberate compose controls), while every buff effect is OCTAVE-based so
   *  it can never turn a tune sour.
   *
   *    degree(n) = rowToDegree(row) + TYPE.degOff + (level-1) + pitch
   *    semitone  = scaleDegreeToSemitone(degree) + accidental + KEY_OFFSET
   *                + 12 * ( octave + buffOctaves )
   *    freq      = semitoneToFreq(semitone, A2=110)
   *
   *  • LEVEL ▲ raises the note one scale step (and keeps its damage). To build a
   *    powerful LOW voice: level up for power, then PITCH ▼ to drop it back down.
   *  • PITCH ▼/▲ is the player's free scale-step transpose (the "move down").
   *  • OCT ▼/▲ jumps a clean octave (pitch-class preserved).
   *  • ACCIDENTAL ♭/♮/♯ bends ±1 semitone for chromatic notes (D#, G#, …).
   *  • Adjacent AMPs add +1 octave each (cap 2) — buffing literally lifts the
   *    voice; and when the whole board is singing (RESONANCE ≥ 75%) everything
   *    lifts one more octave (the "resonance lift"). Octaves stay melody-safe.
   * ===================================================================== */
  function noteDegree(n) {
    const def = NODE_TYPES[n.type];
    return rowToDegree(n.r, CONFIG.ROWS) + def.degOff + ((n.level || 1) - 1) + (n.pitch || 0);
  }
  function buffOctaves(G, n) {
    if (!G) return 0;
    let amps = 0;
    for (const m of neighborsOf(G, n, true)) if (m.type === 'amplifier') amps++;
    let oct = Math.min(2, amps);              // each adjacent AMP lifts an octave (cap 2)
    if (G.musicality >= 0.75) oct += 1;       // RESONANCE LIFT — a singing board rises an octave
    return oct;
  }
  function semiOf(n, G) {
    const scale = SCALES[CONFIG.SCALE] || SCALES.minor;
    let semi = scaleDegreeToSemitone(noteDegree(n), scale) + (n.accidental || 0) + CONFIG.KEY_OFFSET;
    semi += 12 * ((n.octave || 0) + buffOctaves(G, n));
    return semi;
  }
  function freqOf(n, G) { return semitoneToFreq(semiOf(n, G), CONFIG.BASE_HZ); }
  function noteNameOf(G, n) { return noteName(semiOf(n, G), CONFIG.BASE_HZ); }
  // compose controls (mutate + return the new value so callers can re-play)
  function pitchShift(G, n, delta) { n.pitch = clamp((n.pitch || 0) + delta, -14, 14); return n.pitch; }
  function octaveShift(G, n, delta) { n.octave = clamp((n.octave || 0) + delta, -3, 3); return n.octave; }
  function setAccidental(n, a) { n.accidental = clamp(a | 0, -1, 1); return n.accidental; }

  function acquire(G, n, def, count) {
    const range = def.range * CONFIG.UNIT * G.rangeMult;
    const r2 = range * range;
    const c = cellCenter(n.c, n.r);
    const cand = [];
    for (const e of G.enemies) {
      const dx = e.x - c.x, dy = e.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) cand.push({ e, d2 });
    }
    cand.sort((a, b) => a.d2 - b.d2);
    return cand.slice(0, count).map(o => o.e);
  }

  function spawnProjectile(G, n, target, dmg, pierce, def, note) {
    const c = cellCenter(n.c, n.r);
    const dx = target.x - c.x, dy = target.y - c.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = CONFIG.PROJ_SPEED * G.projSpeedMult;
    // the pulse carries its NOTE — colour by pitch class so the screen fills
    // with streams of coloured notes, and so on impact we can score consonance.
    const pc = pitchClassOf(note);
    G.projectiles.push({
      x: c.x, y: c.y, vx: dx / d * sp, vy: dy / d * sp,
      dmg, pierce, note, pc, color: pcColor(pc, 66), life: 1.6, hitSet: new Set(), trail: [],
    });
  }

  function hasFiringNeighbor(G, n, maskFires) {
    for (const m of neighborsOf(G, n, true)) {
      if (m.type !== 'amplifier' && maskFires.get(m)) return true;
    }
    return false;
  }
  function neighborFiredOrtho(G, n, firedSet) {
    for (const m of neighborsOf(G, n, false)) if (firedSet.has(key(m.c, m.r))) return true;
    return false;
  }

  function doFire(G, n, step, scale, sync, aMod) {
    aMod = aMod == null ? 1 : aMod;
    n.firedStep = step; // for the render pulse (relays have no steps[] of their own)
    const def = NODE_TYPES[n.type];
    // rested/crit hits play louder; flat repetition plays softer — you hear the rhythm
    const vel = clamp((0.4 + G.grooveMult * 0.06) * (0.78 + 0.34 * aMod), 0.36, 1.0);
    Audio.note(freqOf(n, G), def.voice, vel * scale);
    if (aMod > 1.25) n.critFlash = 1; // visual accent on a rested hit
    if (def.dmg <= 0) return;
    const dmg = def.dmg * (n.level || 1) * ampBuff(G, n) * G.dmgMult * scale * (sync ? 1.6 : 1) * aMod;
    const pierce = def.pierce + ampPierce(G, n);
    const note = semiOf(n, G);
    const targets = acquire(G, n, def, def.shots);
    for (const t of targets) spawnProjectile(G, n, t, dmg, pierce, def, note);
  }

  // advance one beat-step
  function simStep(G) {
    G.step = (G.step + 1) % CONFIG.STEPS;
    const accent = G.step % 4 === 0;
    Audio.tick(accent);
    G.beatFlash = accent ? 1.0 : 0.6;
    const step = G.step;

    // ---- harmonic backbone ----
    // when the bar turns over, advance the chord progression. The bass plays the
    // root on the bar's two strong beats; when the chord itself changes we swell
    // a pad and flash the board in the chord's colour — the run becomes a song.
    if (Harmony && G.progression) {
      if (step === 0) {
        G.bar++;
        const idx = Harmony.chordIndexAt(G.progression, G.bar, Harmony.BARS_PER_CHORD);
        if (idx !== G.chordIdx || G.bar === 1) {
          G.chordIdx = idx;
          G.chord = G.progression.chords[idx];
          Audio.pad(Harmony.padFreqs(G.chord, 220), 0.5);
          G.chordFlash = 1;
        }
        Audio.bass(Harmony.bassFreq(G.chord, 55), 0.9);     // downbeat root
      } else if (step === 4) {
        Audio.bass(Harmony.bassFreq(G.chord, 55), 0.7);     // mid-bar root
      } else if (step === 6 && (G.bar % 2 === 0)) {
        // occasional fifth on the &-of-3 for a little walking motion
        Audio.bass(Harmony.bassFreq(G.chord, 82.5), 0.55);
      }
    }

    // nodes that play their own programmed beats (amps are silent support;
    // relays have NO beats of their own — they only echo, handled below)
    const selfShooters = G.nodes.filter(n => n.type !== 'amplifier' && n.type !== 'relay');
    const maskFires = new Map();
    for (const n of selfShooters) maskFires.set(n, !!n.steps[step]);

    const fired = new Set();
    const firedNodes = new Set();
    for (const n of selfShooters) {
      if (!maskFires.get(n)) continue;
      let sync = false;
      if (n.type === 'resonator') {
        if (!hasFiringNeighbor(G, n, maskFires)) continue;
        sync = true;
      }
      doFire(G, n, step, 1, sync, rhythmMod(n));
      fired.add(key(n.c, n.r)); firedNodes.add(n);
    }
    // relays are purely reactive: each echoes once whenever an orthogonal
    // neighbor fired this step (including an earlier relay, so chains ripple)
    for (const n of G.nodes) {
      if (n.type !== 'relay') continue;
      if (fired.has(key(n.c, n.r))) continue;
      if (neighborFiredOrtho(G, n, fired)) {
        doFire(G, n, step, 0.6, false, rhythmMod(n));
        fired.add(key(n.c, n.r)); firedNodes.add(n);
      }
    }
    // per-node rest/charge bookkeeping: silence charges, repetition fatigues
    // (tracks every attacking node, relays included)
    const tracked = G.nodes.filter(n => n.type !== 'amplifier');
    for (const n of tracked) {
      if (firedNodes.has(n)) { n.consecFires = (n.consecFires || 0) + 1; n.restCharge = 0; }
      else { n.consecFires = 0; n.restCharge = Math.min(REST_CRIT_MAX, (n.restCharge || 0) + 1); }
    }
    // amplifier texture
    for (const n of G.nodes) {
      if (n.type === 'amplifier' && n.steps[step]) Audio.note(freqOf(n, G), 'amplifier', 0.35);
    }
  }

  /* =======================================================================
   *  ACTIONS
   * ===================================================================== */
  function nodeCost(G, type) {
    return Math.round(NODE_TYPES[type].cost * G.nodeCostMult);
  }
  function canPlace(G, c, r) {
    if (c < 0 || r < 0 || c >= CONFIG.COLS || r >= CONFIG.ROWS) return false;
    if (Math.round(CONFIG.CORE_C) === c && Math.round(CONFIG.CORE_R) === r) return false;
    return !G.grid.has(key(c, r));
  }
  function placeNode(G, type, c, r) {
    if (!G.unlocked[type]) return false;
    if (!canPlace(G, c, r)) return false;
    const cost = nodeCost(G, type);
    if (G.energy < cost) return false;
    const def = NODE_TYPES[type];
    const n = { type, c, r, level: 1, steps: def.steps.slice(), born: G.time,
      pitch: 0, octave: 0, accidental: 0,
      consecFires: 0, restCharge: 0, critFlash: 0 };
    G.nodes.push(n);
    G.grid.set(key(c, r), n);
    G.energy -= cost;
    Audio.note(freqOf(n, G), def.voice, 0.7);
    return n;
  }
  function removeNode(G, n) {
    const refund = Math.round((nodeCost(G, n.type) * 0.5) * (n.level || 1));
    G.energy += refund;
    G.grid.delete(key(n.c, n.r));
    const i = G.nodes.indexOf(n);
    if (i >= 0) G.nodes.splice(i, 1);
    return refund;
  }

  // energy sink: pour energy into a placed node to raise its level (more damage)
  function upgradeCost(G, n) {
    return Math.round(NODE_TYPES[n.type].cost * 0.8 * (n.level || 1) * G.nodeCostMult);
  }
  function upgradeNode(G, n) {
    const cost = upgradeCost(G, n);
    if (G.energy < cost) return false;
    G.energy -= cost;
    n.level = (n.level || 1) + 1;
    return n.level;
  }

  // grow the board by a ring on every side, keeping the Core centered and shifting
  // all existing nodes outward so they stay where the player put them.
  function expandBoard(G) {
    if (CONFIG.COLS >= CONFIG.MAX_COLS && CONFIG.ROWS >= CONFIG.MAX_ROWS) return false;
    const newCols = Math.min(CONFIG.MAX_COLS, CONFIG.COLS + 2);
    const newRows = Math.min(CONFIG.MAX_ROWS, CONFIG.ROWS + 2);
    const dc = (newCols - CONFIG.COLS) >> 1; // 1 when we add a column each side
    const dr = (newRows - CONFIG.ROWS) >> 1;
    setBoardSize(newCols, newRows);
    G.grid.clear();
    for (const n of G.nodes) { n.c += dc; n.r += dr; G.grid.set(key(n.c, n.r), n); }
    // nothing is in flight during the draft pause, but clear for a clean re-fit
    G.projectiles.length = 0; G.particles.length = 0; G.floats.length = 0;
    G.boardExpands = (G.boardExpands || 0) + 1;
    return true;
  }

  function startWave(G) {
    if (G.state !== 'building') return;
    G.wave += 1;
    const spec = waveSpec(G.wave, G.rng);
    let queue = spec.queue;
    let hpMult = spec.hpMult, speedMult = spec.speedMult;
    // daily-challenge modifiers (set by RMeta.applyDailyModifier)
    const dm = G.dailyMods;
    if (dm) {
      if (dm.countMult && dm.countMult !== 1) {
        const extra = [];
        const trash = queue.filter(t => t !== 'conductor');
        const reps = Math.max(0, Math.round(dm.countMult) - 1);
        for (let r = 0; r < reps; r++) for (const t of trash) extra.push(t);
        // keep the boss (if any) at the very end
        const boss = queue.filter(t => t === 'conductor');
        queue = [...trash, ...extra, ...boss];
      }
      if (dm.hpMult) hpMult *= dm.hpMult;
      if (dm.speedMult) speedMult *= dm.speedMult;
    }
    G.spawnQueue = queue;
    G.spawnInterval = spec.interval;
    G.hpMult = hpMult;
    G.speedMult = speedMult;
    G.spawnTimer = 0.4;
    G.bossWave = !!spec.isBoss;
    G.state = 'wave';
  }

  // Pick the pitch an enemy is tuned to. Mostly drawn from the live chord's
  // tones (so the swarm spells the current chord and its colour-theme shifts as
  // the progression turns over); occasionally a wider scale tone for variety.
  // This is the pitch you must MATCH with a node's note to shatter it.
  function enemyPitchClass(G) {
    let pcs = (Harmony && G.chord) ? Harmony.chordPitchClasses(G.chord) : [0, 3, 7];
    if (G.rng.chance(0.22)) {
      // a scale tone off the chord — needs a different node to answer it
      const scale = SCALES[CONFIG.SCALE] || SCALES.minor;
      pcs = scale.map(s => ((s % 12) + 12) % 12);
    }
    return G.rng.pick(pcs);
  }

  function spawnEnemy(G, type) {
    const def = ENEMY_TYPES[type];
    const core = coreXY();
    // pick an edge just outside the board
    const side = G.rng.int(0, 3);
    const m = 30;
    let x, y;
    if (side === 0) { x = G.rng.range(0, CONFIG.BOARD_W); y = -m; }
    else if (side === 1) { x = CONFIG.BOARD_W + m; y = G.rng.range(0, CONFIG.BOARD_H); }
    else if (side === 2) { x = G.rng.range(0, CONFIG.BOARD_W); y = CONFIG.BOARD_H + m; }
    else { x = -m; y = G.rng.range(0, CONFIG.BOARD_H); }
    const hp = Math.round(def.hp * G.hpMult);
    const pc = enemyPitchClass(G);
    G.enemies.push({
      type, x, y, hp, maxHP: hp, speed: def.speed * (G.speedMult || 1), radius: def.radius,
      reward: def.reward, score: def.score, dmg: def.dmg,
      // pitch is the enemy's identity: pc (0..11) → colour you can read & match
      pc, color: pcColor(pc, def.boss ? 70 : 60), baseColor: def.color,
      splits: def.splits || 0, splitInto: def.splitInto, boss: !!def.boss,
      // shifters re-tune on a timer; shiftFlash pulses the moment the colour flips
      shifts: !!def.shifts, shiftTimer: def.shifts ? 2.4 : 0, shiftIdx: 0, shiftFlash: 0,
      hitFlash: 0, resFlash: 0, dissFlash: 0, _dx: core.x - x, _dy: core.y - y,
    });
  }

  function killEnemy(G, e, onBeat, resonant) {
    // a resonant (in-tune) shatter is worth more — playing the right note pays
    const mult = G.grooveMult * (resonant ? 1.5 : 1);
    const sc = Math.round(e.score * mult);
    G.score += sc;
    G.energy += e.reward + G.energyBonus;
    // groove — an in-tune kill swings harder
    G.grooveCombo += (onBeat ? 2 : 1) + (resonant ? 1 : 0);
    G.grooveTimer = 2.0;
    burst(G, e.x, e.y, e.color, e.boss ? 60 : (resonant ? 30 : onBeat ? 22 : 14), resonant || onBeat || e.boss);
    addFloat(G, e.x, e.y, (resonant ? '♪ ' : '') + '+' + sc, e.boss ? '#ffd166' : (resonant ? e.color : onBeat ? '#ffd166' : '#e8ecff'));
    Audio.impact(e.type === 'tank' || e.boss);
    G.shake = Math.min(e.boss ? 26 : 14, G.shake + (e.boss ? 24 : e.type === 'tank' ? 8 : 3));
    if (e.boss) {
      G.bossesFelled = (G.bossesFelled || 0) + 1;
      Audio.chord([
        degreeToFreq(0, 110), degreeToFreq(2, 110), degreeToFreq(4, 110), degreeToFreq(0, 220),
      ], 'resonator');
    }
    if (e.splits > 0) {
      const childKey = e.splitInto || 'mini';
      const cd = ENEMY_TYPES[childKey];
      const chp = Math.round(cd.hp * G.hpMult);
      const spread = e.radius + 6;
      for (let i = 0; i < e.splits; i++) {
        const ang = (i / e.splits) * TAU + G.rng.next() * 0.5;
        // children inherit the parent's pitch — a tank shattering into shards
        // that all ring the same note (a chord falling apart into its overtone)
        const cpc = e.pc == null ? enemyPitchClass(G) : e.pc;
        G.enemies.push({
          type: childKey, x: e.x + Math.cos(ang) * spread, y: e.y + Math.sin(ang) * spread,
          hp: chp, maxHP: chp,
          speed: cd.speed * (G.speedMult || 1), radius: cd.radius,
          reward: cd.reward, score: cd.score, dmg: cd.dmg,
          pc: cpc, color: pcColor(cpc, 60), baseColor: cd.color,
          splits: 0, hitFlash: 0, resFlash: 0, dissFlash: 0,
        });
      }
    }
  }

  /* =======================================================================
   *  UPDATE
   * ===================================================================== */
  function simUpdate(G, dt) {
    G.time += dt;
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 26);
    if (G.beatFlash > 0) G.beatFlash = Math.max(0, G.beatFlash - dt * 3.2);
    if (G.chordFlash > 0) G.chordFlash = Math.max(0, G.chordFlash - dt * 1.4);

    // beat clock runs in building & wave for live composition
    if (G.state === 'building' || G.state === 'wave') {
      G.beatAcc += dt; G.sinceStep += dt;
      const sd = stepDur();
      let guard = 0;
      while (G.beatAcc >= sd && guard++ < 8) { G.beatAcc -= sd; G.sinceStep = 0; simStep(G); }
    }

    // board musicality (smoothed) gates how high Groove can climb
    const targetMus = computeMusicality(G);
    G.musicality += (targetMus - G.musicality) * Math.min(1, dt * 3);
    const effCap = 1 + (G.grooveCap - 1) * G.musicality; // monotony => low ceiling

    // groove decay
    if (G.grooveTimer > 0) { G.grooveTimer -= dt; }
    else if (G.grooveCombo > 0) { G.grooveCombo = Math.max(0, G.grooveCombo - 1); G.grooveTimer = 0.35; }
    G.grooveMult = clamp(1 + G.grooveCombo * 0.04, 1, effCap);
    for (const n of G.nodes) if (n.critFlash > 0) n.critFlash = Math.max(0, n.critFlash - dt * 2.4);

    if (G.state === 'wave') {
      // spawning
      if (G.spawnQueue.length > 0) {
        G.spawnTimer -= dt;
        if (G.spawnTimer <= 0) { spawnEnemy(G, G.spawnQueue.shift()); G.spawnTimer = G.spawnInterval; }
      }
    }

    // enemies move toward core
    const core = coreXY();
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 5);
      if (e.resFlash > 0) e.resFlash = Math.max(0, e.resFlash - dt * 3);
      if (e.dissFlash > 0) e.dissFlash = Math.max(0, e.dissFlash - dt * 6);
      if (e.shiftFlash > 0) e.shiftFlash = Math.max(0, e.shiftFlash - dt * 2.5);
      // shifters re-tune to a new chord tone — colour flips, so the answering note
      // changes. DETERMINISTIC (cycles the live chord's tones, no G.rng draw) so it
      // never pollutes the seeded stream or the A/B balance proof.
      if (e.shifts && G.state === 'wave') {
        e.shiftTimer -= dt;
        if (e.shiftTimer <= 0) {
          const pcs = (Harmony && G.chord) ? Harmony.chordPitchClasses(G.chord) : [0, 3, 7];
          e.shiftIdx = (e.shiftIdx + 1) % pcs.length;
          let npc = pcs[e.shiftIdx];
          if (npc === e.pc && pcs.length > 1) { e.shiftIdx = (e.shiftIdx + 1) % pcs.length; npc = pcs[e.shiftIdx]; }
          e.pc = npc; e.color = pcColor(npc, 60); e.shiftFlash = 1;
          e.shiftTimer = 2.6;
          Audio.note(semitoneToFreq(npc + CONFIG.KEY_OFFSET + 12, CONFIG.BASE_HZ), 'pad', 0.18);
        }
      }
      const dx = core.x - e.x, dy = core.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.x += dx / d * e.speed * dt;
      e.y += dy / d * e.speed * dt;
      if (d < CONFIG.UNIT * 0.5) {
        G.coreHP -= e.dmg;
        G.shake = Math.min(20, G.shake + 10);
        burst(G, e.x, e.y, '#ff5ea8', 16, false);
        addFloat(G, core.x, core.y - 20, '-' + e.dmg, '#ff5ea8');
        G.grooveCombo = Math.floor(G.grooveCombo * 0.4); // breaking the groove
        G.enemies.splice(i, 1);
      }
    }

    // projectiles
    for (let i = G.projectiles.length - 1; i >= 0; i--) {
      const p = G.projectiles[i];
      p.trail.push(p.x, p.y); if (p.trail.length > 8) p.trail.splice(0, 2);
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      let dead = p.life <= 0 || p.x < -40 || p.y < -40 || p.x > CONFIG.BOARD_W + 40 || p.y > CONFIG.BOARD_H + 40;
      if (!dead) {
        for (const e of G.enemies) {
          if (p.hitSet.has(e)) continue;
          const rr = e.radius + 5;
          if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= rr * rr) {
            // THE BLEND: damage = base × consonance(pulse note, enemy note).
            // In tune (unison) ⇒ resonance, the enemy shatters. Out of tune
            // (minor-2nd / tritone) ⇒ dissonance, the pulse barely scratches.
            const res = consonance((p.note || 0) - (e.pc || 0));
            e.hp -= p.dmg * res; e.hitFlash = 1;
            p.hitSet.add(e);
            if (res >= 1.7) {            // RESONANT strike — bright, loud, in the enemy's colour
              e.resFlash = 1;
              if (!G.taughtResonant) G.taughtResonant = 1; // browser shows a one-time teaching toast
              burst(G, p.x, p.y, e.color, 9, true);
              Audio.note(semitoneToFreq((e.pc || 0) + CONFIG.KEY_OFFSET + 12, CONFIG.BASE_HZ), 'resonator', 0.5);
            } else if (res < 0.75) {     // DISSONANT — the note clashes, shielded clink
              e.dissFlash = 1;
              burst(G, p.x, p.y, '#7a8499', 3, false);
            } else {
              burst(G, p.x, p.y, p.color, 4, false);
            }
            Audio.impact(false);
            if (e.hp <= 0) {
              const onBeat = G.sinceStep < 0.14;
              killEnemy(G, e, onBeat, res >= 1.7);
              const ei = G.enemies.indexOf(e); if (ei >= 0) G.enemies.splice(ei, 1);
            }
            if (p.pierce <= 0) { dead = true; break; }
            p.pierce -= 1;
          }
        }
      }
      if (dead) G.projectiles.splice(i, 1);
    }

    // particles
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const pt = G.particles[i];
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.92; pt.vy *= 0.92; pt.life -= dt;
      if (pt.life <= 0) G.particles.splice(i, 1);
    }
    // floats
    for (let i = G.floats.length - 1; i >= 0; i--) {
      const f = G.floats[i]; f.y += f.vy * dt; f.life -= dt;
      if (f.life <= 0) G.floats.splice(i, 1);
    }

    // wave clear
    if (G.state === 'wave' && G.spawnQueue.length === 0 && G.enemies.length === 0) {
      G.state = 'draft';
      G.coreHP = Math.min(G.coreMaxHP, G.coreHP + 8);
      // every EXPAND_EVERY cleared waves, grow the board so it never fully clogs
      if (G.wave % CONFIG.EXPAND_EVERY === 0) { G.expandedThisDraft = expandBoard(G); }
      G.pendingDraft = rollDraft(G);
      Audio.chord([
        degreeToFreq(0, 110), degreeToFreq(2, 110), degreeToFreq(4, 110), degreeToFreq(5, 110),
      ], 'resonator');
    }
    // game over
    if (G.coreHP <= 0 && G.state !== 'gameover') {
      G.coreHP = 0; G.state = 'gameover';
    }
  }

  function burst(G, x, y, color, n, big) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = (big ? 180 : 110) * (0.4 + Math.random());
      G.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.5, maxlife: 0.9,
        color, size: (big ? 4 : 2.5) * (0.6 + Math.random()),
      });
    }
  }
  function addFloat(G, x, y, text, color) {
    G.floats.push({ x, y, text, color, life: 1.0, vy: -42 });
  }

  /* =======================================================================
   *  DRAFT
   * ===================================================================== */
  function rollDraft(G) {
    const pool = [];
    // unlocks
    for (const k of Object.keys(NODE_TYPES)) {
      if (!G.unlocked[k]) pool.push({ kind: 'unlock', type: k, weight: 3 });
    }
    // upgrades
    const ups = [
      { kind:'up', id:'dmg',   icon:'⚔', name:'OVERTONE',   tag:'+18% DAMAGE',
        desc:'All nodes deal 18% more damage.', weight:3, apply:g=>g.dmgMult*=1.18 },
      { kind:'up', id:'range', icon:'◎', name:'WIDE FIELD', tag:'+15% RANGE',
        desc:'All nodes reach 15% farther.', weight:2, apply:g=>g.rangeMult*=1.15 },
      { kind:'up', id:'speed', icon:'»', name:'STACCATO',   tag:'+25% PROJ SPEED',
        desc:'Projectiles travel 25% faster.', weight:2, apply:g=>g.projSpeedMult*=1.25 },
      { kind:'up', id:'eco',   icon:'⚡', name:'HARVEST',    tag:'+1 ENERGY / KILL',
        desc:'Earn +1 bonus energy per kill.', weight:2, apply:g=>g.energyBonus+=1 },
      { kind:'up', id:'cost',  icon:'%', name:'EFFICIENCY',  tag:'-15% NODE COST',
        desc:'Nodes cost 15% less to place.', weight:2, apply:g=>g.nodeCostMult*=0.85 },
      { kind:'up', id:'heal',  icon:'✚', name:'REPAIR',     tag:'+35 CORE & +15 MAX',
        desc:'Heal the Core and raise its max HP.', weight:2,
        apply:g=>{g.coreMaxHP+=15; g.coreHP=Math.min(g.coreMaxHP,g.coreHP+35);} },
    ];
    // relics (rarer, build-defining)
    const relics = [
      { kind:'relic', id:'poly',  icon:'✦', name:'POLYRHYTHM', tag:'+1 BEAT ALL NODES',
        desc:'Every placed node gains one extra firing beat. Denser music, more shots.', weight:1,
        apply:g=>{ for(const n of g.nodes){ const off=g.rng.int(0,CONFIG.STEPS-1); n.steps[off]=1; } } },
      { kind:'relic', id:'echo',  icon:'◇', name:'ECHO CHAMBER', tag:'RELAYS DOUBLED',
        desc:'Relays deal double damage and pierce one extra enemy.', weight:1,
        apply:g=>{ NODE_TYPES.relay.dmg*=2; NODE_TYPES.relay.pierce+=1; } },
      { kind:'relic', id:'cresc', icon:'△', name:'CRESCENDO', tag:'GROOVE CAP +3',
        desc:'Your Groove multiplier can climb three steps higher.', weight:1,
        apply:g=>{ g.grooveCap+=3; } },
      { kind:'relic', id:'over',  icon:'☢', name:'OVERDRIVE', tag:'+40% DMG / FASTER FOES',
        desc:'+40% damage, but enemies move 12% faster. High risk, high tempo.', weight:1,
        apply:g=>{ g.dmgMult*=1.4; for(const k in ENEMY_TYPES) ENEMY_TYPES[k].speed*=1.12; } },
    ];
    pool.push(...ups);
    if (G.wave >= 2) pool.push(...relics);
    // weighted pick 3 distinct
    const chosen = [];
    const work = pool.slice();
    while (chosen.length < 3 && work.length) {
      let total = work.reduce((s, o) => s + o.weight, 0);
      let r = G.rng.next() * total, idx = 0;
      for (let i = 0; i < work.length; i++) { r -= work[i].weight; if (r <= 0) { idx = i; break; } }
      chosen.push(work.splice(idx, 1)[0]);
    }
    return chosen;
  }

  function applyDraft(G, opt) {
    if (opt.kind === 'unlock') { G.unlocked[opt.type] = true; }
    else { opt.apply(G); }
    G.pendingDraft = null;
    G.state = 'building';
  }

  /* =======================================================================
   *  EXPORTS (headless-testable core)
   * ===================================================================== */
  const Game = {
    CONFIG, NODE_TYPES, ENEMY_TYPES, stepDur,
    makeState, waveSpec, simStep, simUpdate,
    placeNode, removeNode, canPlace, nodeCost, startWave, spawnEnemy, killEnemy,
    rollDraft, applyDraft, freqOf, cellCenter, coreXY, acquire, doFire, ampBuff,
    setBoardSize, expandBoard, upgradeNode, upgradeCost,
    computeMusicality, rhythmMod, falloffAt, restBonus,
    autoArrange, applyPatternToType, ROLE_PATTERNS,
    noteDegree, buffOctaves, semiOf, noteNameOf,
    pitchShift, octaveShift, setAccidental, symmetryScore,
    Harmony,
  };
  root.RGame = Game;
  if (typeof module !== 'undefined' && module.exports) module.exports = Game;

  /* =======================================================================
   *  BROWSER: RENDER + INPUT + UI  (only when a DOM exists)
   * ===================================================================== */
  if (typeof document === 'undefined') return;

  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  let DPR = Math.min(2, root.devicePixelRatio || 1);
  let W = 0, H = 0, view = { scale: 1, ox: 0, oy: 0 };

  function resize() {
    DPR = Math.min(2, root.devicePixelRatio || 1);
    W = root.innerWidth; H = root.innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const padX = 24, padTop = 84, padBot = 120;
    const availW = W - padX * 2, availH = H - padTop - padBot;
    const scale = Math.min(availW / CONFIG.BOARD_W, availH / CONFIG.BOARD_H);
    view.scale = scale;
    view.ox = (W - CONFIG.BOARD_W * scale) / 2;
    view.oy = padTop + (availH - CONFIG.BOARD_H * scale) / 2;
  }
  root.addEventListener('resize', resize);

  const w2sX = x => view.ox + x * view.scale;
  const w2sY = y => view.oy + y * view.scale;
  const s2wX = x => (x - view.ox) / view.scale;
  const s2wY = y => (y - view.oy) / view.scale;

  const Meta = root.RMeta;
  let profile = Meta ? Meta.load() : null;
  let runMode = null; // null = normal run, or { daily:true, date, modifier, seed }
  let runRecorded = false; // guard so a run is folded into the profile exactly once

  // active visual theme (palette). Swapped from the equipped cosmetic; render reads this.
  let THEME = (Meta && Meta.PALETTES && Meta.PALETTES.aurora) ||
    { bg0:'#0a0e1d', bg1:'#05060f', accent:'#36e0c8', accentRGB:'54,224,200' };
  const acc = (a) => `rgba(${THEME.accentRGB},${a})`;   // accent colour at alpha a
  function applyCosmetics() {
    if (!Meta || !profile) return;
    THEME = Meta.equippedPalette(profile);
    Audio.setPack && Audio.setPack(Meta.equippedPack(profile).voices);
  }

  let G = makeState((Date.now ? 1 : 1)); // seed fixed-ish; reseeded on new game
  function reseed() { G = makeState(Math.floor(performance.now() * 1000) % 2147483647 || 7); }
  root.RGameState = () => G; // debug / test hook into the live run state

  function todayParts() {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate() };
  }

  /* ---------------- DOM refs ---------------- */
  const $ = sel => document.querySelector(sel);
  const hud = $('#hud'), titleEl = $('#title'), draftEl = $('#draft'), howtoEl = $('#howto'), goEl = $('#gameover');
  const trayEl = $('#tray'), toastEl = $('#toast');
  const elWave = $('#stat-wave span'), elCore = $('#stat-core span'), elEnergy = $('#stat-energy span'),
        elScore = $('#stat-score span'), elGroove = $('#stat-groove span'),
        elReso = $('#stat-reso span'), elResoBox = $('#stat-reso');
  const elChordRibbon = $('#chord-ribbon');
  const btnStart = $('#btn-start'), btnMute = $('#btn-mute'), btnMaestro = $('#btn-maestro');

  let retuneEl = null, retuneNode = null;

  /* ---------------- HUD / tray ---------------- */
  function buildTray() {
    trayEl.innerHTML = '';
    for (const k of Object.keys(NODE_TYPES)) {
      if (!G.unlocked[k]) continue;
      const def = NODE_TYPES[k];
      const cost = nodeCost(G, k);
      const el = document.createElement('div');
      el.className = 'tray-item' + (G.selType === k ? ' sel' : '') + (G.energy < cost ? ' poor' : '');
      el.innerHTML = `<div class="ic" style="color:${def.color}">${def.icon}</div>
        <div class="nm">${def.name}</div><div class="cost">${cost}</div>`;
      el.onclick = () => { G.selType = (G.selType === k ? null : k); closeRetune(); buildTray(); };
      trayEl.appendChild(el);
    }
  }
  function toast(msg) {
    const el = document.createElement('div'); el.className = 'toast-msg'; el.textContent = msg;
    toastEl.appendChild(el); setTimeout(() => el.remove(), 2200);
  }
  // the chord ribbon: progression name + four chord cells, current one lit. Cells
  // are rebuilt only when the progression changes; the active highlight + colour
  // pulse update live each frame as the song advances.
  let ribbonSig = null;
  function syncChordRibbon() {
    if (!elChordRibbon || !Harmony || !G.progression) return;
    const prog = G.progression;
    if (ribbonSig !== prog.name) {
      ribbonSig = prog.name;
      elChordRibbon.innerHTML =
        `<span class="cr-name">♪ ${prog.name}</span>` +
        prog.chords.map(c => {
          const rgb = Harmony.chordRGB(c);
          return `<span class="cr-chord" data-chord="${c}" style="--cc:rgb(${rgb[0]},${rgb[1]},${rgb[2]})">${c}</span>`;
        }).join('');
    }
    const cells = elChordRibbon.querySelectorAll('.cr-chord');
    for (let i = 0; i < cells.length; i++) {
      const on = i === G.chordIdx;
      cells[i].classList.toggle('on', on);
      if (on) cells[i].style.opacity = String(0.85 + 0.15 * (G.chordFlash || 0));
      else cells[i].style.opacity = '';
    }
  }

  function syncHUD() {
    elWave.textContent = G.wave; elCore.textContent = Math.max(0, Math.ceil(G.coreHP));
    elEnergy.textContent = Math.floor(G.energy); elScore.textContent = G.score;
    elGroove.textContent = 'x' + G.grooveMult.toFixed(1);
    const mus = Math.round(G.musicality * 100);
    elReso.textContent = mus + '%';
    elResoBox.classList.toggle('low', G.musicality < 0.4);
    elResoBox.classList.toggle('high', G.musicality >= 0.75);
    syncChordRibbon();
    const running = G.state === 'wave';
    btnStart.classList.toggle('running', running);
    btnStart.textContent = running ? '◼ WAVE ' + G.wave : '▶ START WAVE ' + (G.wave + 1);
    btnStart.disabled = running;
  }

  /* ---------------- retune popup ---------------- */
  // hand-picked syncopated grooves the GROOVE ⟳ button cycles (encourages variety)
  const GROOVE_PRESETS = [
    [1,0,0,1,0,0,1,0], // tresillo
    [1,0,1,0,0,1,0,0], // skip
    [1,0,0,0,1,0,1,0], // backbeat lean
    [0,1,0,1,0,1,0,1], // pure offbeat
    [1,0,1,0,1,0,1,0], // straight eighths
  ];
  function openRetune(n) {
    closeRetune();
    retuneNode = n;
    const el = document.createElement('div'); el.id = 'retune';
    const def = NODE_TYPES[n.type];
    // relays echo their neighbors — they have no beats of their own to program
    const reactive = n.type === 'relay';
    el.innerHTML = `<div class="rt-title" style="color:${def.color}">${def.name} <span class="rt-lvl">Lv ${n.level || 1}</span> · ${reactive ? 'ECHO' : 'BEATS'}</div>
      ${reactive
        ? `<div class="rt-echo">No beats of its own — it echoes any neighbor that fires (60% power). Place it touching busy nodes and chain relays for dense polyrhythms.</div>`
        : `<div class="steps"></div>`}
      <div class="rt-pitch">
        <span class="rt-note" title="the note this voice plays">${noteNameOf(G, n)}</span>
        <span class="rt-knobs">
          <button class="pc" data-p="oct-1" title="down an octave">8⤓</button>
          <button class="pc" data-p="pitch-1" title="down one scale step">♪▼</button>
          <button class="pc" data-p="pitch1" title="up one scale step">♪▲</button>
          <button class="pc" data-p="oct1" title="up an octave">8⤒</button>
          <span class="rt-acc">
            <button class="ac" data-acc="-1" title="flat">♭</button>
            <button class="ac" data-acc="0" title="natural">♮</button>
            <button class="ac" data-acc="1" title="sharp">♯</button>
          </span>
        </span>
      </div>
      <div class="rt-hint"><span class="rt-swatch" style="background:${pcColor(pitchClassOf(semiOf(n, G)), 60, 90)}"></span> this is the note's <b>colour</b> — pulses shatter enemies wearing the <b>same</b> colour, glance off clashing ones.</div>
      <div class="rt-actions">
        <button class="mini up" data-a="up">UPGRADE · <b class="up-cost">${upgradeCost(G, n)}</b>⚡</button>
        ${reactive ? '' : `<button class="mini" data-a="clear">CLEAR</button>
        <button class="mini" data-a="pattern">GROOVE ⟳</button>
        <button class="mini" data-a="stamp" title="copy this groove to every ${def.name} on the board">⬢ ALL ${def.name}</button>`}
        <button class="mini del" data-a="del">SELL</button>
      </div>`;
    const steps = el.querySelector('.steps');
    if (steps) for (let i = 0; i < CONFIG.STEPS; i++) {
      const b = document.createElement('button');
      b.className = 'step-btn' + (n.steps[i] ? ' on' : '');
      b.dataset.i = i;
      b.onclick = () => { n.steps[i] = n.steps[i] ? 0 : 1; b.classList.toggle('on'); Audio.note(freqOf(n, G), def.voice, 0.6); };
      steps.appendChild(b);
    }
    // ---- pitch knobs: read the note, transpose by step/octave, bend ±1 semitone
    const noteEl = el.querySelector('.rt-note');
    const swatchEl = el.querySelector('.rt-swatch');
    const refreshSwatch = () => { if (swatchEl) swatchEl.style.background = pcColor(pitchClassOf(semiOf(n, G)), 60, 90); };
    const refreshNote = () => {
      noteEl.textContent = noteNameOf(G, n);
      refreshSwatch();
      el.querySelectorAll('.rt-acc .ac').forEach(b => b.classList.toggle('on', (+b.dataset.acc) === (n.accidental || 0)));
      Audio.note(freqOf(n, G), def.voice, 0.6);
    };
    el.querySelectorAll('.rt-knobs .pc').forEach(btn => {
      btn.onclick = () => {
        const p = btn.dataset.p;
        if (p === 'pitch-1') pitchShift(G, n, -1);
        else if (p === 'pitch1') pitchShift(G, n, 1);
        else if (p === 'oct-1') octaveShift(G, n, -1);
        else if (p === 'oct1') octaveShift(G, n, 1);
        refreshNote();
      };
    });
    el.querySelectorAll('.rt-acc .ac').forEach(btn => {
      btn.onclick = () => { setAccidental(n, +btn.dataset.acc); refreshNote(); };
    });
    el.querySelectorAll('.rt-acc .ac').forEach(b => b.classList.toggle('on', (+b.dataset.acc) === (n.accidental || 0)));
    el.querySelectorAll('.rt-actions button').forEach(btn => {
      btn.onclick = () => {
        const a = btn.dataset.a;
        if (a === 'clear') n.steps = n.steps.map(() => 0);
        else if (a === 'pattern') {
          n.presetIdx = ((n.presetIdx == null ? -1 : n.presetIdx) + 1) % GROOVE_PRESETS.length;
          n.steps = GROOVE_PRESETS[n.presetIdx].slice();
        }
        else if (a === 'up') {
          const lvl = upgradeNode(G, n);
          if (!lvl) { toast('Not enough energy'); buildTray(); return; }
          Audio.note(freqOf(n, G), def.voice, 0.8);
          el.querySelector('.rt-lvl').textContent = 'Lv ' + lvl;
          if (noteEl) noteEl.textContent = noteNameOf(G, n); // level raises the note
          refreshSwatch();
          el.querySelector('.up-cost').textContent = upgradeCost(G, n);
          buildTray(); syncHUD();
          return;
        }
        else if (a === 'stamp') {
          const cnt = applyPatternToType(G, n);
          G.musicality = computeMusicality(G);
          Audio.note(freqOf(n, G), def.voice, 0.7);
          toast(cnt ? 'Stamped to ' + cnt + ' more ' + def.name : 'No other ' + def.name + ' to stamp');
          syncHUD();
          return;
        }
        else if (a === 'del') { const ref = removeNode(G, n); toast('Sold +' + ref + '⚡'); closeRetune(); buildTray(); return; }
        // refresh buttons
        el.querySelectorAll('.step-btn').forEach((b, i) => b.classList.toggle('on', !!n.steps[i]));
      };
    });
    document.getElementById('app').appendChild(el);
    const c = cellCenter(n.c, n.r);
    el.style.left = clamp(w2sX(c.x) - el.offsetWidth / 2, 8, W - el.offsetWidth - 8) + 'px';
    el.style.top = clamp(w2sY(c.y) - el.offsetHeight - 18, 8, H - el.offsetHeight - 8) + 'px';
    retuneEl = el;
  }
  function closeRetune() { if (retuneEl) { retuneEl.remove(); retuneEl = null; retuneNode = null; } }

  /* ---------------- input ---------------- */
  function pointerCell(ev) {
    const rect = cv.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    const wx = s2wX(sx), wy = s2wY(sy);
    return { c: Math.floor(wx / CONFIG.UNIT), r: Math.floor(wy / CONFIG.UNIT), wx, wy };
  }
  cv.addEventListener('pointermove', ev => {
    const { c, r } = pointerCell(ev);
    G.hover = (c >= 0 && r >= 0 && c < CONFIG.COLS && r < CONFIG.ROWS) ? { c, r } : null;
  });
  cv.addEventListener('pointerleave', () => { G.hover = null; });
  cv.addEventListener('pointerdown', ev => {
    Audio.resume();
    if (G.state !== 'building' && G.state !== 'wave') return;
    const { c, r } = pointerCell(ev);
    if (c < 0 || r < 0 || c >= CONFIG.COLS || r >= CONFIG.ROWS) { closeRetune(); return; }
    const existing = G.grid.get(key(c, r));
    if (G.selType) {
      if (existing) { toast('Cell occupied'); return; }
      const cost = nodeCost(G, G.selType);
      if (G.energy < cost) { toast('Not enough energy'); buildTray(); return; }
      const n = placeNode(G, G.selType, c, r);
      if (n) { buildTray(); syncHUD(); }
    } else if (existing) {
      openRetune(existing);
    } else {
      closeRetune();
    }
  });

  /* ---------------- buttons / overlays ---------------- */
  function show(el, on) { el.classList.toggle('hidden', !on); }

  function startGame(opts) {
    Audio.init(); Audio.resume();
    applyCosmetics();
    opts = opts || {};
    runMode = null;
    if (opts.daily && Meta) {
      const ch = Meta.dailyChallenge(todayParts());
      runMode = { daily: true, date: ch.dateStr, modifier: ch.modifier, seed: ch.seed };
      G = makeState(ch.seed);
    } else {
      reseed();
    }
    // permanent perks first, then today's daily twist
    if (Meta && profile) Meta.applyPerks(G, profile);
    if (runMode && Meta) Meta.applyDailyModifier(G, runMode.modifier.id);
    runRecorded = false;
    show(titleEl, false); show(goEl, false); show(draftEl, false); show($('#upgrades'), false);
    hud.classList.remove('hidden');
    G.selType = 'pulser';
    buildTray(); syncHUD();
    if (runMode) toast('◷ DAILY · ' + runMode.modifier.name + ' — ' + runMode.modifier.desc);
    else toast('Place nodes, then START WAVE');
  }

  function renderTitleMeta() {
    if (!Meta) return;
    profile = Meta.load();
    const el = $('#title-meta');
    if (!el) return;
    const ch = Meta.dailyChallenge(todayParts());
    const dailyDone = profile.daily.date === ch.dateStr ? ` · today's best ${profile.daily.bestScore}` : '';
    el.innerHTML =
      `<span>✦ <b>${profile.shards}</b> shards</span>` +
      `<span>★ best <b>${profile.bestScore}</b> · wave <b>${profile.bestWave}</b></span>` +
      `<span>◷ today: <b>${ch.modifier.name}</b>${dailyDone}</span>`;
  }

  function goToMenu() {
    show(goEl, false); show($('#upgrades'), false); show(howtoEl, false); show(draftEl, false);
    hud.classList.add('hidden');
    renderTitleMeta();
    show(titleEl, true);
  }

  // ---- board share codes: play a friend's EXACT composition ----
  function startGameFromCode(code) {
    const Share = root.RShare;
    const data = Share ? Share.decodeBoard(code) : null;
    if (!data) { toast('That board code is not valid'); return; }
    Audio.init(); Audio.resume(); applyCosmetics();
    runMode = null;
    G = Share.applyBoard(data, Game, 12345);
    if (Meta && profile) Meta.applyPerks(G, profile);
    runRecorded = false;
    show(titleEl, false); show(goEl, false); show(draftEl, false); show($('#upgrades'), false);
    hud.classList.remove('hidden');
    G.selType = 'pulser';
    buildTray(); syncHUD();
    toast('Loaded a shared board (' + data.nodes.length + ' nodes) — press START WAVE to hear it');
  }

  // One-click share: if the page was opened with ?board=R1~…, load that board
  // straight into building state so the link IS the playable song.
  function maybeLoadFromUrl() {
    const Share = root.RShare;
    if (!Share || !root.location) return false;
    const url = (root.location.search || '') + (root.location.hash || '');
    const code = Share.boardFromUrl(url);
    if (!code) return false;
    startGameFromCode(code);
    return true;
  }

  $('#btn-play').onclick = () => startGame();
  $('#btn-retry').onclick = () => startGame(runMode && runMode.daily ? { daily: true } : {});
  $('#btn-daily').onclick = () => startGame({ daily: true });
  $('#btn-go-menu').onclick = goToMenu;
  const btnLoadCode = $('#btn-loadcode');
  if (btnLoadCode) btnLoadCode.onclick = () => {
    let code = null;
    try { code = root.prompt && root.prompt('Paste a board code (starts with R1~):'); } catch (e) {}
    if (code && code.trim()) startGameFromCode(code.trim());
  };
  const btnShareCode = $('#btn-sharecode');
  if (btnShareCode) btnShareCode.onclick = async () => {
    const Share = root.RShare;
    if (!Share || !G || !G.nodes || !G.nodes.length) { toast('Place some nodes first'); return; }
    const code = Share.encodeBoard(G);
    // prefer a one-click link when we have a real URL; fall back to the bare code
    let payload = code, isLink = false;
    try {
      const base = root.location && root.location.href;
      const link = base && Share.buildShareUrl(base, code);
      if (link) { payload = link; isLink = true; }
    } catch (e) {}
    let copied = false;
    try {
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
        await root.navigator.clipboard.writeText(payload); copied = true;
      }
    } catch (e) {}
    if (!copied) { try { root.prompt && root.prompt('Copy your board ' + (isLink ? 'link' : 'code') + ':', payload); copied = true; } catch (e) {} }
    toast(copied ? (isLink ? 'Share link copied — paste it to a friend!' : 'Board code copied — share it!') : 'Board: ' + payload);
  };
  $('#btn-howto').onclick = () => show(howtoEl, true);
  $('#btn-howto-close').onclick = () => show(howtoEl, false);
  $('#btn-help').onclick = () => show(howtoEl, true);
  btnStart.onclick = () => { Audio.resume(); if (G.state === 'building') { closeRetune(); startWave(G); if (G.bossWave) { toast('☢ BOSS WAVE — THE CONDUCTOR APPROACHES'); Audio.chord([degreeToFreq(0,55), degreeToFreq(0,110), degreeToFreq(3,110)], 'resonator'); } syncHUD(); } };
  btnMute.onclick = () => { Audio.setMuted(!Audio.isMuted()); btnMute.textContent = Audio.isMuted() ? '🔇' : '🔊'; };
  // MAESTRO — one click composes the whole board; click again to re-roll
  let maestroVariant = 0;
  btnMaestro.onclick = () => {
    Audio.resume();
    // only nodes with their own beats can be composed (relays echo, amps are silent)
    const attackers = G.nodes.filter(n => n.type !== 'amplifier' && n.type !== 'relay');
    if (!attackers.length) { toast('Place some beat-making nodes first'); return; }
    maestroVariant = (maestroVariant + 1) % CONFIG.STEPS;
    const mus = autoArrange(G, maestroVariant);
    G.musicality = mus; // reflect instantly in the HUD
    if (retuneEl && retuneNode) { // keep an open popup in sync
      retuneEl.querySelectorAll('.step-btn').forEach((b, i) => b.classList.toggle('on', !!retuneNode.steps[i]));
    }
    auditionArrangement(attackers);
    syncHUD();
    toast('✦ MAESTRO · RESONANCE ' + Math.round(mus * 100) + '%  (click to re-roll)');
  };
  // play one bar of the freshly-arranged board so the player hears the groove
  function auditionArrangement(attackers) {
    const sample = attackers.slice(0, 10); // cap voices so it stays musical
    for (let i = 0; i < CONFIG.STEPS; i++) {
      setTimeout(() => {
        for (const n of sample) {
          if (n.steps[i]) Audio.note(freqOf(n, G), NODE_TYPES[n.type].voice, 0.35);
        }
      }, i * 90);
    }
  }

  function openDraft() {
    const cards = $('#draft-cards'); cards.innerHTML = '';
    for (const opt of G.pendingDraft) {
      const el = document.createElement('div');
      let icon, name, tag, desc, cls = 'card';
      if (opt.kind === 'unlock') {
        const d = NODE_TYPES[opt.type]; icon = d.icon; name = 'UNLOCK ' + d.name; tag = 'NEW NODE · ' + nodeCost(G, opt.type) + '⚡'; desc = d.desc;
      } else if (opt.kind === 'up') { icon = opt.icon; name = opt.name; tag = opt.tag; desc = opt.desc; cls += ' up'; }
      else { icon = opt.icon; name = opt.name; tag = opt.tag; desc = opt.desc; cls += ' relic'; }
      el.className = cls;
      el.innerHTML = `<div class="cic">${icon}</div><h3>${name}</h3><p>${desc}</p><div class="tagline">${tag}</div>`;
      el.onclick = () => { applyDraft(G, opt); show(draftEl, false); buildTray(); syncHUD(); toast('Acquired: ' + name); };
      cards.appendChild(el);
    }
    show(draftEl, true);
  }

  function openGameOver() {
    const s = $('#go-stats');
    const bosses = G.bossesFelled || 0;
    const song = G.progression ? G.progression.name : '—';
    s.innerHTML = `
      <div class="go-row big"><span>SCORE</span><span>${G.score}</span></div>
      <div class="go-row"><span>WAVE REACHED</span><span>${G.wave}</span></div>
      <div class="go-row"><span>YOUR SONG</span><span>♪ ${song}</span></div>
      <div class="go-row"><span>NODES BUILT</span><span>${G.nodes.length}</span></div>
      <div class="go-row"><span>BOSSES FELLED</span><span>${bosses}</span></div>
      <div class="go-row"><span>PEAK GROOVE</span><span>x${G.grooveCap.toFixed(1)}</span></div>`;
    const goTitle = $('#go-title');
    // record the run into the persistent profile (once)
    const shardEl = $('#go-shards');
    if (Meta && profile && !runRecorded) {
      runRecorded = true;
      const stats = { score: G.score, wave: G.wave, bosses };
      const res = Meta.recordRun(profile, stats, runMode && runMode.daily ? { daily: true, date: runMode.date } : null);
      let line = `<div class="shard-earn">+${res.shards} ✦ shards earned <span>(${profile.shards} total)</span></div>`;
      if (res.best) line += `<div class="newbest">★ NEW BEST SCORE!</div>`;
      if (runMode && runMode.daily) {
        goTitle.textContent = 'DAILY · ' + runMode.modifier.name;
        line += `<div class="daily-line">Today's best: ${profile.daily.bestScore}</div>`;
      } else {
        goTitle.textContent = 'THE MUSIC STOPPED';
      }
      shardEl.innerHTML = line; show(shardEl, true);
    } else if (shardEl) { show(shardEl, false); }
    show(goEl, true);
  }

  /* ---------------- upgrades shop ---------------- */
  let shopTab = 'perks';
  function openShop() {
    if (!Meta) return;
    profile = Meta.load();
    $('#shop-shards').textContent = profile.shards;
    renderPerkTab();
    renderCosmeticTab();
    setShopTab(shopTab);
    show($('#upgrades'), true);
  }
  function setShopTab(which) {
    shopTab = which;
    const perks = $('#perk-cards'), cos = $('#cosmetic-cards');
    const tp = $('#tab-perks'), tc = $('#tab-cosmetics');
    if (!perks || !cos) return;
    show(perks, which === 'perks'); show(cos, which === 'cosmetics');
    if (tp) tp.classList.toggle('active', which === 'perks');
    if (tc) tc.classList.toggle('active', which === 'cosmetics');
  }

  function renderPerkTab() {
    const wrap = $('#perk-cards'); wrap.innerHTML = '';
    for (const id of Meta.PERK_ORDER) {
      const def = Meta.PERKS[id];
      const lvl = Meta.perkLevel(profile, id);
      const cost = Meta.perkNextCost(profile, id);
      const maxed = cost == null;
      const afford = !maxed && profile.shards >= cost;
      const el = document.createElement('div');
      el.className = 'card perk' + (maxed ? ' maxed' : afford ? '' : ' poor');
      const pips = Array.from({ length: def.max }, (_, i) =>
        `<span class="pip${i < lvl ? ' on' : ''}"></span>`).join('');
      el.innerHTML =
        `<div class="cic">${def.icon}</div><h3>${def.name}</h3>` +
        `<p>${def.desc}</p>` +
        `<div class="perk-pips">${pips}</div>` +
        `<div class="perk-per">${def.per} <span class="lvl">Lv ${lvl}/${def.max}</span></div>` +
        `<button class="buy" ${maxed || !afford ? 'disabled' : ''}>${maxed ? 'MAXED' : 'BUY · ' + cost + ' ✦'}</button>`;
      const buyBtn = el.querySelector('.buy');
      buyBtn.onclick = () => {
        if (Meta.buyPerk(profile, id)) {
          Audio.resume(); Audio.chord([degreeToFreq(0, 220), degreeToFreq(2, 220), degreeToFreq(4, 220)], 'resonator');
          openShop();
        } else { toast('Not enough shards'); }
      };
      wrap.appendChild(el);
    }
  }

  const COSMETIC_TABS = [
    { kind: 'palette', label: '◈ PALETTES', hint: 'Retint the board, glow & background.' },
    { kind: 'pack',    label: '♪ INSTRUMENT PACKS', hint: 'Swap the synth voices your nodes play.' },
  ];
  function renderCosmeticTab() {
    const wrap = $('#cosmetic-cards'); if (!wrap) return; wrap.innerHTML = '';
    for (const grp of COSMETIC_TABS) {
      const sec = document.createElement('div'); sec.className = 'cos-group';
      const head = document.createElement('div'); head.className = 'cos-head';
      head.innerHTML = `<span>${grp.label}</span><em>${grp.hint}</em>`;
      sec.appendChild(head);
      const row = document.createElement('div'); row.className = 'cards';
      const defs = Meta.cosmeticDefs(grp.kind);
      for (const id of Object.keys(defs)) {
        const def = defs[id];
        const owned = Meta.cosmeticOwned(profile, grp.kind, id);
        const equipped = profile.equipped[grp.kind] === id;
        const afford = profile.shards >= def.cost;
        const el = document.createElement('div');
        el.className = 'card cos' + (equipped ? ' equipped' : owned ? ' owned' : afford ? '' : ' poor');
        const swatch = grp.kind === 'palette'
          ? `<span class="cos-swatch" style="background:${def.swatch};box-shadow:0 0 14px ${def.swatch}"></span>`
          : `<span class="cos-glyph">${def.swatch}</span>`;
        let btn;
        if (equipped) btn = `<button class="buy" disabled>EQUIPPED</button>`;
        else if (owned) btn = `<button class="buy equip">EQUIP</button>`;
        else btn = `<button class="buy" ${afford ? '' : 'disabled'}>BUY · ${def.cost} ✦</button>`;
        el.innerHTML = `<div class="cic">${swatch}</div><h3>${def.name}</h3><p>${def.desc}</p>${btn}`;
        const b = el.querySelector('.buy');
        if (b && !b.disabled) b.onclick = () => {
          if (owned) {
            Meta.equipCosmetic(profile, grp.kind, id);
            previewCosmetic(grp.kind, id);
            openShop();
          } else if (Meta.buyCosmetic(profile, grp.kind, id)) {
            previewCosmetic(grp.kind, id);
            Audio.resume(); Audio.chord([degreeToFreq(0, 220), degreeToFreq(2, 220), degreeToFreq(4, 330)], 'resonator');
            toast(def.name + ' unlocked & equipped');
            openShop();
          } else { toast('Not enough shards'); }
        };
        row.appendChild(el);
      }
      sec.appendChild(row); wrap.appendChild(sec);
    }
  }
  // immediately reflect an equip choice (theme + audio audition)
  function previewCosmetic(kind, id) {
    if (kind === 'palette') THEME = Meta.PALETTES[id] || THEME;
    if (kind === 'pack') {
      Audio.init && Audio.init();
      Audio.setPack && Audio.setPack((Meta.PACKS[id] || {}).voices);
      Audio.resume && Audio.resume();
      // audition: a quick pentatonic flourish in the chosen pack
      [0, 2, 4, 6].forEach((d, i) => setTimeout(() => Audio.note(degreeToFreq(d, 220), 'pulser', 0.8), i * 110));
    }
  }
  $('#tab-perks') && ($('#tab-perks').onclick = () => setShopTab('perks'));
  $('#tab-cosmetics') && ($('#tab-cosmetics').onclick = () => setShopTab('cosmetics'));
  $('#btn-upgrades').onclick = () => { Audio.resume(); openShop(); };
  $('#btn-shop-close').onclick = () => { show($('#upgrades'), false); renderTitleMeta(); };
  $('#btn-shop-reset').onclick = () => {
    if (root.confirm && !root.confirm('Erase ALL progress — shards, perks, and bests?')) return;
    profile = Meta.reset(); openShop(); renderTitleMeta();
    toast('Progress reset');
  };

  /* ---------------- shareable run card (the viral hook) ---------------- */
  function shareSummary() {
    const tag = runMode && runMode.daily ? `DAILY ${runMode.date} · ${runMode.modifier.name}` : 'ENDLESS';
    const song = G.progression ? ` · ♪ ${G.progression.name}` : '';
    return [
      `RESONANCE — I built a machine that fought to a beat 🎶`,
      `${tag}${song}`,
      `★ Score ${G.score} · Wave ${G.wave} · ${G.bossesFelled || 0} bosses felled · peak Groove x${G.grooveCap.toFixed(1)}`,
      `Can you out-play my run?`,
    ].join('\n');
  }

  function drawShareCard() {
    const w = 640, h = 360, can = document.createElement('canvas');
    can.width = w; can.height = h;
    const c = can.getContext('2d');
    // bg
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0c1226'); g.addColorStop(1, '#05060f');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    // glow rings echoing the board
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      c.strokeStyle = acc(0.05 + i * 0.015); c.lineWidth = 2;
      c.beginPath(); c.arc(w - 90, h - 70, 40 + i * 26, 0, TAU); c.stroke();
    }
    c.restore();
    // frame
    c.strokeStyle = acc(0.5); c.lineWidth = 2;
    c.strokeRect(14, 14, w - 28, h - 28);
    // title
    c.textAlign = 'left'; c.fillStyle = '#eaf6ff';
    c.font = '800 46px Segoe UI, Arial, sans-serif';
    c.fillText('RES', 40, 86);
    c.fillStyle = '#36e0c8'; c.fillText('O', 40 + c.measureText('RES').width, 86);
    c.fillStyle = '#eaf6ff'; c.fillText('NANCE', 40 + c.measureText('RESO').width, 86);
    c.font = '500 15px Segoe UI, Arial, sans-serif'; c.fillStyle = 'rgba(180,200,230,0.8)';
    c.fillText('a machine that fights to a beat', 42, 112);
    // mode chip
    const tag = runMode && runMode.daily ? `◷ DAILY · ${runMode.modifier.name}` : '∞ ENDLESS';
    const song = G.progression ? `   ♪ ${G.progression.name}` : '';
    c.font = '700 14px Segoe UI, Arial, sans-serif'; c.fillStyle = '#ffd166';
    c.fillText(tag, 42, 150);
    if (song) { c.fillStyle = '#9b8cff'; c.fillText(song, 42 + c.measureText(tag).width, 150); }
    // big score
    c.fillStyle = '#fff'; c.font = '800 92px Segoe UI, Arial, sans-serif';
    c.fillText(String(G.score), 38, 248);
    c.font = '600 18px Segoe UI, Arial, sans-serif'; c.fillStyle = 'rgba(180,200,230,0.9)';
    c.fillText('SCORE', 42, 274);
    // stat strip
    const stats = [['WAVE', G.wave], ['BOSSES', G.bossesFelled || 0], ['GROOVE', 'x' + G.grooveCap.toFixed(1)], ['NODES', G.nodes.length]];
    c.textAlign = 'center';
    stats.forEach(([k, v], i) => {
      const x = 320 + i * 78;
      c.fillStyle = THEME.accent; c.font = '800 26px Segoe UI, Arial, sans-serif';
      c.fillText(String(v), x, 250);
      c.fillStyle = 'rgba(160,180,210,0.8)'; c.font = '600 12px Segoe UI, Arial, sans-serif';
      c.fillText(k, x, 270);
    });
    // footer
    c.textAlign = 'left'; c.fillStyle = 'rgba(150,170,200,0.7)'; c.font = '500 14px Segoe UI, Arial, sans-serif';
    c.fillText('play it · generative tower-defense roguelite 🎧', 42, h - 30);
    return can;
  }

  async function shareResult() {
    const text = shareSummary();
    const can = drawShareCard();
    // copy the text to the clipboard if we can
    let copied = false;
    try {
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
        await root.navigator.clipboard.writeText(text); copied = true;
      }
    } catch (e) { /* ignore */ }
    // try the native share sheet with the image (mobile / supported browsers)
    let shared = false;
    try {
      if (can.toBlob && root.navigator && root.navigator.canShare) {
        const blob = await new Promise(res => can.toBlob(res, 'image/png'));
        const file = new File([blob], 'resonance.png', { type: 'image/png' });
        if (blob && root.navigator.canShare({ files: [file] })) {
          await root.navigator.share({ files: [file], text, title: 'RESONANCE' });
          shared = true;
        }
      }
    } catch (e) { /* user cancelled or unsupported */ }
    if (!shared) {
      // fall back to a downloadable image card
      try {
        const url = can.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url; a.download = 'resonance-run.png';
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { /* canvas tainted / unsupported */ }
    }
    toast(shared ? 'Shared!' : copied ? 'Result copied · card image saved' : 'Run card saved');
  }
  $('#btn-share').onclick = () => { Audio.resume(); shareResult(); };

  // expose a few DOM helpers for tests
  root.RUI = { openShop, shareSummary, drawShareCard, renderTitleMeta, startGame, goToMenu, openRetune, closeRetune,
    startGameFromCode, maybeLoadFromUrl, maestro: () => btnMaestro.onclick() };

  /* ---------------- RENDER ---------------- */
  function drawRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function render() {
    // background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, THEME.bg0); g.addColorStop(1, THEME.bg1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (G.shake > 0) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);

    const sc = view.scale;
    const bx = w2sX(0), by = w2sY(0), bw = CONFIG.BOARD_W * sc, bh = CONFIG.BOARD_H * sc;

    // board panel with beat-synced glow
    const fl = G.beatFlash;
    drawRoundRect(bx - 10, by - 10, bw + 20, bh + 20, 18);
    ctx.fillStyle = 'rgba(12,16,32,0.9)'; ctx.fill();
    ctx.lineWidth = 2 + boardFlash * 4;
    ctx.strokeStyle = boardFlash > 0
      ? `rgba(255,209,102,${clamp(0.3 + boardFlash * 0.6, 0, 1)})`
      : acc(0.15 + fl * 0.4);
    if (boardFlash > 0) { ctx.save(); ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 40 * boardFlash; ctx.stroke(); ctx.restore(); }
    else ctx.stroke();

    // grid
    ctx.strokeStyle = 'rgba(120,140,220,0.08)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= CONFIG.COLS; c++) { const x = w2sX(c * CONFIG.UNIT); ctx.moveTo(x, by); ctx.lineTo(x, by + bh); }
    for (let r = 0; r <= CONFIG.ROWS; r++) { const y = w2sY(r * CONFIG.UNIT); ctx.moveTo(bx, y); ctx.lineTo(bx + bw, y); }
    ctx.stroke();

    // hover / placement preview
    if (G.hover && (G.state === 'building' || G.state === 'wave')) {
      const { c, r } = G.hover;
      const ok = G.selType && canPlace(G, c, r) && G.energy >= nodeCost(G, G.selType);
      const cx = w2sX((c + 0.5) * CONFIG.UNIT), cy = w2sY((r + 0.5) * CONFIG.UNIT);
      if (G.selType) {
        const def = NODE_TYPES[G.selType];
        ctx.fillStyle = ok ? acc(0.12) : 'rgba(255,94,168,0.12)';
        drawRoundRect(w2sX(c * CONFIG.UNIT) + 2, w2sY(r * CONFIG.UNIT) + 2, CONFIG.UNIT * sc - 4, CONFIG.UNIT * sc - 4, 8); ctx.fill();
        if (ok && def.range > 0) {
          ctx.strokeStyle = acc(0.25); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(cx, cy, def.range * CONFIG.UNIT * G.rangeMult * sc, 0, TAU); ctx.stroke();
        }
      }
    }

    // playhead strip (top of board)
    const pw = bw / CONFIG.STEPS;
    for (let i = 0; i < CONFIG.STEPS; i++) {
      const on = i === G.step;
      ctx.fillStyle = on ? acc(0.55 + fl * 0.4) : (i % 4 === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)');
      const dotw = pw * 0.5, x = bx + i * pw + (pw - dotw) / 2;
      drawRoundRect(x, by - 22, dotw, 5, 2.5); ctx.fill();
    }

    // nodes
    ctx.lineWidth = 2;
    for (const n of G.nodes) {
      const def = NODE_TYPES[n.type];
      const lvl = n.level || 1;
      const cx = w2sX((n.c + 0.5) * CONFIG.UNIT), cy = w2sY((n.r + 0.5) * CONFIG.UNIT);
      const rad = CONFIG.UNIT * (0.34 + Math.min(0.12, (lvl - 1) * 0.03)) * sc;
      const firing = (n.steps[G.step] || n.firedStep === G.step) && G.sinceStep < 0.12;
      // pitch-tinted colour: the note this node plays paints the node, so the
      // melody/arch is visible at a glance (brighter+hue-shifted = higher note)
      const pcol = pitchColor(n, G, 1, firing ? 8 : 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = (firing ? 0.9 : 0.3) + Math.min(0.25, (lvl - 1) * 0.06);
      ctx.shadowColor = pcol; ctx.shadowBlur = (firing ? 28 : 12) + (lvl - 1) * 3;
      ctx.fillStyle = pcol; ctx.globalAlpha = glow;
      drawNodeShape(n.type, cx, cy, rad * (firing ? 1.12 : 1));
      ctx.fill();
      // thin type-coloured core keeps node TYPE identity readable under the tint
      ctx.globalAlpha = glow * 0.9; ctx.shadowBlur = 0; ctx.fillStyle = def.color;
      drawNodeShape(n.type, cx, cy, rad * (firing ? 1.12 : 1) * 0.5);
      ctx.fill();
      // charged-hit halo: a rested node just landed a crit
      if (n.critFlash > 0) {
        ctx.globalAlpha = n.critFlash * 0.8;
        ctx.shadowColor = '#fff'; ctx.shadowBlur = 30;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, cy, rad * (1.5 + (1 - n.critFlash) * 0.8), 0, TAU); ctx.stroke();
      }
      ctx.restore();
      // ring tinted by pitch (so the note reads even when the node isn't firing)
      ctx.globalAlpha = 0.55; ctx.strokeStyle = pcol;
      ctx.beginPath(); ctx.arc(cx, cy, rad + 4, 0, TAU); ctx.stroke();
      // PITCH-CLASS AURA — drawn in the SAME colour space as enemies (pcColor),
      // so this halo's hue == the hue of the enemies this node shatters. This is
      // the whole teaching: match the node's aura to an enemy's colour to resonate.
      const nodePc = pitchClassOf(semiOf(n, G));
      const acol = pcColor(nodePc, 60, 90);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = acol; ctx.shadowBlur = firing ? 16 : 8;
      ctx.globalAlpha = firing ? 0.9 : 0.5; ctx.lineWidth = firing ? 3 : 2;
      ctx.strokeStyle = acol;
      ctx.beginPath(); ctx.arc(cx, cy, rad + 8, 0, TAU); ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1; ctx.lineWidth = 2;
      // level pip (extra concentric rings for upgraded nodes)
      if (lvl > 1) {
        ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.strokeStyle = def.color;
        for (let k = 1; k < Math.min(lvl, 5); k++) {
          ctx.beginPath(); ctx.arc(cx, cy, rad + 4 + k * 3, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.lineWidth = 2;
        ctx.fillStyle = '#0a0e1d';
        ctx.beginPath(); ctx.arc(cx + rad * 0.7, cy - rad * 0.7, 7 * Math.max(0.7, sc) * 0.9, 0, TAU); ctx.fill();
        ctx.fillStyle = def.color; ctx.textAlign = 'center';
        ctx.font = '700 ' + Math.round(10 * Math.max(0.75, sc)) + 'px Segoe UI, sans-serif';
        ctx.fillText(lvl, cx + rad * 0.7, cy - rad * 0.7 + 3.5 * Math.max(0.75, sc));
      }
    }

    // projectiles
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of G.projectiles) {
      ctx.strokeStyle = p.color; ctx.lineWidth = 3; ctx.shadowColor = p.color; ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(w2sX(p.x), w2sY(p.y));
      const tx = p.trail.length >= 2 ? p.trail[p.trail.length - 2] : p.x - p.vx * 0.02;
      const ty = p.trail.length >= 2 ? p.trail[p.trail.length - 1] : p.y - p.vy * 0.02;
      ctx.lineTo(w2sX(tx - p.vx * 0.01), w2sY(ty - p.vy * 0.01));
      ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(w2sX(p.x), w2sY(p.y), 3, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // enemies
    for (const e of G.enemies) {
      const cx = w2sX(e.x), cy = w2sY(e.y), rad = e.radius * sc;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = e.color; ctx.shadowBlur = 14;
      ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color;
      ctx.globalAlpha = 0.9;
      drawEnemyShape(e.type, cx, cy, rad, G.time);
      ctx.fill();
      // RESONANT strike — a bright expanding ring in the enemy's OWN colour, the
      // visual payoff of a matched note shattering it (colour == pitch == damage).
      if (e.resFlash > 0) {
        const rf = e.resFlash;
        ctx.globalAlpha = rf * 0.9; ctx.lineWidth = 2 + rf * 3;
        ctx.shadowColor = e.color; ctx.shadowBlur = 24;
        ctx.strokeStyle = e.color;
        ctx.beginPath(); ctx.arc(cx, cy, rad + 4 + (1 - rf) * rad * 2.4, 0, TAU); ctx.stroke();
        ctx.globalAlpha = rf * 0.5;
        ctx.fillStyle = '#ffffff';
        drawEnemyShape(e.type, cx, cy, rad * (1 + (1 - rf) * 0.5), G.time); ctx.fill();
      }
      // SHIFTER tuning ring — a rotating dashed halo, brightening the instant it
      // re-tunes, so you can see its colour (its answering note) is about to change.
      if (e.shifts) {
        ctx.globalAlpha = 0.45 + e.shiftFlash * 0.55; ctx.lineWidth = 1.6 + e.shiftFlash * 2.5;
        ctx.strokeStyle = e.color; ctx.shadowColor = e.color; ctx.shadowBlur = 10 + e.shiftFlash * 20;
        ctx.setLineDash([4 * sc, 4 * sc]); ctx.lineDashOffset = -G.time * 30;
        ctx.beginPath(); ctx.arc(cx, cy, rad + 5 + e.shiftFlash * rad * 1.6, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
      // DISSONANT clink — a dull grey shield arc: the note clashed and glanced off.
      if (e.dissFlash > 0) {
        ctx.save();
        ctx.globalAlpha = e.dissFlash * 0.7; ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(180,190,205,0.9)';
        ctx.beginPath(); ctx.arc(cx, cy, rad + 3 + e.dissFlash * 4, -0.9, 0.9); ctx.stroke();
        ctx.restore();
      }
      // hp ring
      if (e.hp < e.maxHP) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, cy, rad + 4, -Math.PI / 2, -Math.PI / 2 + TAU * (e.hp / e.maxHP)); ctx.stroke();
      }
    }

    // core
    const core = coreXY(); const ccx = w2sX(core.x), ccy = w2sY(core.y);
    const pulse = 1 + Math.sin(G.time * 4) * 0.05 + fl * 0.15;
    const crad = CONFIG.UNIT * 0.42 * sc * pulse;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = THEME.accent; ctx.shadowBlur = 30;
    const grad = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, crad);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.5, THEME.accent); grad.addColorStop(1, acc(0));
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(ccx, ccy, crad, 0, TAU); ctx.fill();
    // chord aura — a ring in the current chord's colour that blooms when the
    // progression turns over, so the harmony is something you can *see* move
    if (Harmony && G.progression) {
      const rgb = Harmony.chordRGB(G.chord);
      const cf = G.chordFlash || 0;
      const rr = crad + 10 + cf * crad * 1.4;
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.12 + cf * 0.5})`;
      ctx.lineWidth = 2 + cf * 4;
      ctx.beginPath(); ctx.arc(ccx, ccy, rr, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    // core hp ring
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.arc(ccx, ccy, crad + 6, 0, TAU); ctx.stroke();
    const hpFrac = clamp(G.coreHP / G.coreMaxHP, 0, 1);
    ctx.strokeStyle = hpFrac > 0.3 ? THEME.accent : '#ff5ea8';
    ctx.beginPath(); ctx.arc(ccx, ccy, crad + 6, -Math.PI / 2, -Math.PI / 2 + TAU * hpFrac); ctx.stroke();

    // particles
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const pt of G.particles) {
      ctx.globalAlpha = clamp(pt.life / pt.maxlife, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(w2sX(pt.x), w2sY(pt.y), pt.size * sc * 0.5 + 0.5, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // floating text
    ctx.textAlign = 'center'; ctx.font = '700 ' + Math.round(15 * Math.max(0.7, sc)) + 'px Segoe UI, sans-serif';
    for (const f of G.floats) {
      ctx.globalAlpha = clamp(f.life, 0, 1); ctx.fillStyle = f.color;
      ctx.fillText(f.text, w2sX(f.x), w2sY(f.y));
    }
    ctx.globalAlpha = 1;

    // groove flair — when high, draw an aura ring around board
    if (G.grooveMult > 1.6) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const a = (G.grooveMult - 1.6) / 4;
      ctx.strokeStyle = `rgba(255,209,102,${clamp(a, 0, 0.5) * (0.6 + fl)})`;
      ctx.lineWidth = 3 + fl * 4;
      drawRoundRect(bx - 12, by - 12, bw + 24, bh + 24, 20); ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  // --- pitch → colour --------------------------------------------------
  // Map a node's absolute semitone to a tinted version of its type colour so
  // the *melody* is legible on the board: higher notes shift hue + brighten,
  // octaves cycle the hue wheel. Type identity stays readable because we shift
  // a bounded amount around the base hue rather than replacing it.
  function hexToHSL(hex) {
    const m = hex.replace('#', '');
    const r = parseInt(m.substr(0, 2), 16) / 255, g = parseInt(m.substr(2, 2), 16) / 255, b = parseInt(m.substr(4, 2), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0; const l = (mx + mn) / 2; const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s, l];
  }
  // pitch tint: returns a css hsl() string for a node's current pitch.
  // semiRef ~ a mid pulser (KEY_OFFSET). +1 octave = +30° hue & +light.
  function pitchColor(n, G, satMul, lightAdd) {
    const def = NODE_TYPES[n.type];
    const [h0, s0, l0] = hexToHSL(def.color);
    const rel = semiOf(n, G) - CONFIG.KEY_OFFSET; // semitones above tonic-row baseline
    const hue = (h0 + rel * 7) % 360;             // ~one octave (12) ≈ 84° sweep
    const sat = clamp((s0 * (satMul || 1)) * 100, 25, 100);
    const light = clamp((l0 * 100) + (lightAdd || 0) + clamp(rel, -12, 24) * 1.1, 28, 86);
    return `hsl(${(hue + 360) % 360},${sat}%,${light}%)`;
  }

  function drawNodeShape(type, x, y, r) {
    ctx.beginPath();
    if (type === 'pulser') { // diamond
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    } else if (type === 'splitter') { // 4-point star
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU - Math.PI / 2; const rr = i % 2 ? r * 0.45 : r; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath();
    } else if (type === 'relay') { // hexagon ring
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath();
    } else if (type === 'amplifier') { // triangle
      ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.92, y + r * 0.7); ctx.lineTo(x - r * 0.92, y + r * 0.7); ctx.closePath();
    } else { // resonator — 6-point star
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU - Math.PI / 2; const rr = i % 2 ? r * 0.5 : r; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath();
    }
  }
  function drawEnemyShape(type, x, y, r, t) {
    ctx.beginPath();
    if (type === 'fast' || type === 'mini') { // arrow/triangle
      ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.85, y + r * 0.7); ctx.lineTo(x - r * 0.85, y + r * 0.7); ctx.closePath();
    } else if (type === 'tank') { // hexagon
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + t * 0.4; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath();
    } else if (type === 'splitter') { // square
      const s = r * 0.8; ctx.rect(x - s, y - s, s * 2, s * 2);
    } else if (type === 'shifter') { // pentagon — spins as it re-tunes
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + t * 1.1 - Math.PI / 2; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath();
    } else if (type === 'conductor') { // boss — slowly rotating gear/crown
      const spikes = 10;
      for (let i = 0; i < spikes * 2; i++) {
        const a = i / (spikes * 2) * TAU + t * 0.5;
        const rr = i % 2 ? r * 0.62 : r;
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
    } else { // grunt — circle
      ctx.arc(x, y, r, 0, TAU);
    }
  }

  /* ---------------- main loop ---------------- */
  let last = 0, stateBefore = 'building', lastBoardExpands = 0, boardFlash = 0;
  let loopErrShown = false;
  // The game loop must NEVER die: a single render/sim hiccup used to freeze the
  // whole board (nodes vanish, HUD stops updating). Each stage is isolated and
  // rAF is always re-scheduled, so the game keeps running no matter what.
  function safely(label, fn) {
    try { fn(); }
    catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('[RESONANCE] ' + label + ' error:', e);
      if (!loopErrShown) { loopErrShown = true; try { toast('⚠ ' + label + ' glitch (recovered)'); } catch (_) {} }
    }
  }
  function frame(ts) {
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;

    if (G.state === 'building' || G.state === 'wave') safely('sim', () => simUpdate(G, dt));

    // board grew this frame → re-fit the view and celebrate
    if (G.boardExpands !== lastBoardExpands) {
      lastBoardExpands = G.boardExpands;
      closeRetune(); resize();
      boardFlash = 1.2;
      toast('◳ BOARD EXPANDED — ' + CONFIG.COLS + '×' + CONFIG.ROWS);
      Audio.chord([
        degreeToFreq(0, 110), degreeToFreq(4, 110), degreeToFreq(2, 220), degreeToFreq(0, 330),
      ], 'amplifier');
    }
    if (boardFlash > 0) boardFlash = Math.max(0, boardFlash - dt * 1.6);

    // first time a pulse matches an enemy's colour, teach the blend once
    if (G.taughtResonant === 1) {
      G.taughtResonant = 2;
      toast('✦ RESONANT! the note matched the enemy\'s colour — it SHATTERED. Match colours to kill faster.');
    }

    // state transitions → overlays
    if (G.state !== stateBefore) {
      if (G.state === 'draft') openDraft();
      else if (G.state === 'gameover') openGameOver();
      stateBefore = G.state;
    }
    if (G.state === 'building' && !draftEl.classList.contains('hidden')) show(draftEl, false);

    safely('render', render);
    if (!hud.classList.contains('hidden')) safely('hud', syncHUD);
    requestAnimationFrame(frame);
  }

  resize();
  applyCosmetics();   // reflect the saved palette on the title screen
  renderTitleMeta();
  maybeLoadFromUrl();  // ?board=R1~… → one-click load of a friend's song
  requestAnimationFrame(frame);
})(typeof window !== 'undefined' ? window : globalThis);
