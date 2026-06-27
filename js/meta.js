/* RESONANCE — meta.js : persistent profile, shards, perks, daily challenge.
 * Pure logic + a tiny storage shim so it runs (and tests) headlessly. */
(function (root) {
  'use strict';

  const KEY = 'resonance.profile.v1';

  // localStorage if present, else an in-memory fallback (node / private mode)
  const mem = {};
  const store = (typeof root !== 'undefined' && root.localStorage) ? root.localStorage : {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
  };

  function freshProfile() {
    return {
      version: 1,
      runs: 0, bestScore: 0, bestWave: 0, totalScore: 0, bossesFelled: 0,
      shards: 0, totalShards: 0,
      perks: {},                 // id -> level
      daily: { date: null, score: 0, wave: 0, bestScore: 0, runs: 0 },
      cosmetics: { palette: ['aurora'], pack: ['synth'] },   // kind -> [owned ids]
      equipped: { palette: 'aurora', pack: 'synth' },
    };
  }

  function load() {
    try {
      const raw = store.getItem(KEY);
      if (!raw) return freshProfile();
      const p = JSON.parse(raw);
      const base = freshProfile();
      const merged = Object.assign(base, p);
      merged.perks = Object.assign({}, p.perks || {});
      merged.daily = Object.assign(base.daily, p.daily || {});
      // cosmetics — keep the free defaults owned even on old saves
      const cz = p.cosmetics || {};
      merged.cosmetics = {
        palette: Array.from(new Set(['aurora'].concat(cz.palette || []))),
        pack: Array.from(new Set(['synth'].concat(cz.pack || []))),
      };
      const eq = p.equipped || {};
      merged.equipped = {
        palette: PALETTES[eq.palette] ? eq.palette : 'aurora',
        pack: PACKS[eq.pack] ? eq.pack : 'synth',
      };
      return merged;
    } catch (e) { return freshProfile(); }
  }
  function save(p) {
    try { store.setItem(KEY, JSON.stringify(p)); } catch (e) { /* ignore quota */ }
    return p;
  }
  function reset() { try { store.removeItem(KEY); } catch (e) {} return freshProfile(); }

  /* ----- perks: permanent, shard-bought head starts ----- */
  const PERKS = {
    energy: { id:'energy', name:'PRELUDE',     icon:'⚡', max:5,
      desc:'Begin every run with more energy.',  per:'+8 start energy',
      cost: lvl => 18 + lvl * 14,
      apply: (G, lvl) => { G.energy += 8 * lvl; } },
    core:   { id:'core',   name:'BULWARK',     icon:'✚', max:5,
      desc:'Reinforce the Core before the music starts.', per:'+12 Core max HP',
      cost: lvl => 24 + lvl * 18,
      apply: (G, lvl) => { G.coreMaxHP += 12 * lvl; G.coreHP += 12 * lvl; } },
    groove: { id:'groove', name:'SWING',       icon:'△', max:4,
      desc:'Let your Groove multiplier climb higher.', per:'+1 Groove cap',
      cost: lvl => 30 + lvl * 26,
      apply: (G, lvl) => { G.grooveCap += lvl; } },
    opener: { id:'opener', name:'OPENING ACT', icon:'✳', max:1,
      desc:'Start with the SPLITTER node already unlocked.', per:'Splitter unlocked',
      cost: () => 70,
      apply: (G, lvl) => { if (lvl > 0) G.unlocked.splitter = true; } },
    harvest:{ id:'harvest',name:'TIP JAR',     icon:'$', max:3,
      desc:'Squeeze a little more energy from every kill.', per:'+1 energy / kill',
      cost: lvl => 40 + lvl * 30,
      apply: (G, lvl) => { G.energyBonus += lvl; } },
  };
  const PERK_ORDER = ['energy', 'core', 'groove', 'harvest', 'opener'];

  function perkLevel(p, id) { return (p.perks && p.perks[id]) || 0; }
  function perkNextCost(p, id) {
    const def = PERKS[id]; const lvl = perkLevel(p, id);
    if (lvl >= def.max) return null;
    return def.cost(lvl);
  }
  function canBuyPerk(p, id) {
    const c = perkNextCost(p, id);
    return c != null && p.shards >= c;
  }
  function buyPerk(p, id) {
    const c = perkNextCost(p, id);
    if (c == null || p.shards < c) return false;
    p.shards -= c;
    p.perks[id] = perkLevel(p, id) + 1;
    save(p);
    return p.perks[id];
  }
  // mutate a fresh run-state G so it reflects all owned perks
  function applyPerks(G, p) {
    for (const id of PERK_ORDER) {
      const lvl = perkLevel(p, id);
      if (lvl > 0) PERKS[id].apply(G, lvl);
    }
    return G;
  }

  /* ----- cosmetics: palettes (look) + instrument packs (sound) -----
   * Bought once with shards, then equipped for free. Palettes retint the
   * board/background/accent; packs swap the synth voices for each node type. */
  const PALETTES = {
    aurora: { id:'aurora', name:'AURORA', cost:0,  swatch:'#36e0c8',
      desc:'The original teal-on-midnight glow.',
      bg0:'#0a0e1d', bg1:'#05060f', accent:'#36e0c8', accentRGB:'54,224,200' },
    ember:  { id:'ember', name:'EMBER', cost:55, swatch:'#ff7a4b',
      desc:'Warm coals against a smouldering dusk.',
      bg0:'#190a0c', bg1:'#0c0404', accent:'#ff8a52', accentRGB:'255,138,82' },
    nebula: { id:'nebula', name:'NEBULA', cost:80, swatch:'#b48cff',
      desc:'Deep violets and starlit magenta.',
      bg0:'#120a22', bg1:'#070411', accent:'#b48cff', accentRGB:'180,140,255' },
    lagoon: { id:'lagoon', name:'LAGOON', cost:80, swatch:'#4be0ff',
      desc:'Electric cyan over a tropical deep.',
      bg0:'#06141c', bg1:'#02090f', accent:'#4be0ff', accentRGB:'75,224,255' },
    mono:   { id:'mono', name:'BLANC', cost:120, swatch:'#e8ecff',
      desc:'A stark monochrome stage. For purists.',
      bg0:'#14161d', bg1:'#070809', accent:'#dfe6ff', accentRGB:'223,230,255' },
  };
  // pack.voices: nodeType -> partial override of audio VOICE (type/detune/gain/d…)
  const PACKS = {
    synth:  { id:'synth', name:'SYNTH', cost:0, swatch:'△',
      desc:'The default analog-style voices.', voices:null },
    glass:  { id:'glass', name:'GLASS', cost:70, swatch:'◇',
      desc:'Pure sines & bells — crystalline and airy.',
      voices:{ pulser:{type:'sine',d:0.5,send:0.7}, splitter:{type:'sine',detune:9,d:0.4,send:0.7},
               relay:{type:'sine',d:0.6,send:0.85}, amplifier:{type:'triangle',d:0.7},
               resonator:{type:'sine',detune:5,d:0.9,send:0.8} } },
    chip:   { id:'chip', name:'8-BIT', cost:70, swatch:'▦',
      desc:'Square-wave arcade nostalgia.',
      voices:{ pulser:{type:'square',d:0.12}, splitter:{type:'square',detune:0,d:0.1},
               relay:{type:'square',d:0.1,send:0.4}, amplifier:{type:'square',d:0.18},
               resonator:{type:'square',detune:8,d:0.16} } },
    mellow: { id:'mellow', name:'MELLOW', cost:95, swatch:'◠',
      desc:'Soft triangles with long, warm tails.',
      voices:{ pulser:{type:'triangle',d:0.55,send:0.7}, splitter:{type:'triangle',detune:3,d:0.5},
               relay:{type:'triangle',d:0.6,send:0.8}, amplifier:{type:'triangle',d:0.9},
               resonator:{type:'triangle',detune:4,d:1.0,send:0.75} } },
  };
  const COSMETICS = { palette: PALETTES, pack: PACKS };
  const COSMETIC_KINDS = ['palette', 'pack'];

  function cosmeticDefs(kind) { return COSMETICS[kind] || {}; }
  function cosmeticOwned(p, kind, id) {
    const list = (p.cosmetics && p.cosmetics[kind]) || [];
    return list.indexOf(id) !== -1;
  }
  function cosmeticCost(kind, id) {
    const def = cosmeticDefs(kind)[id];
    return def ? def.cost : null;
  }
  function buyCosmetic(p, kind, id) {
    const def = cosmeticDefs(kind)[id];
    if (!def || cosmeticOwned(p, kind, id) || p.shards < def.cost) return false;
    p.shards -= def.cost;
    if (!p.cosmetics[kind]) p.cosmetics[kind] = [];
    p.cosmetics[kind].push(id);
    p.equipped[kind] = id;            // auto-equip on purchase
    save(p);
    return true;
  }
  function equipCosmetic(p, kind, id) {
    if (!cosmeticDefs(kind)[id] || !cosmeticOwned(p, kind, id)) return false;
    p.equipped[kind] = id;
    save(p);
    return true;
  }
  function equippedPalette(p) { return PALETTES[(p.equipped && p.equipped.palette)] || PALETTES.aurora; }
  function equippedPack(p) { return PACKS[(p.equipped && p.equipped.pack)] || PACKS.synth; }

  /* ----- shards: the between-run currency ----- */
  function shardsFor(stats) {
    const score = stats.score || 0, wave = stats.wave || 0, bosses = stats.bosses || 0;
    return Math.floor(score / 120) + wave * 2 + bosses * 12;
  }

  // fold a finished run into the profile; returns { shards, best } for UI
  function recordRun(p, stats, opts) {
    const gained = shardsFor(stats);
    p.runs += 1;
    p.totalScore += stats.score || 0;
    p.bossesFelled += stats.bosses || 0;
    p.shards += gained;
    p.totalShards += gained;
    const best = (stats.score || 0) > p.bestScore;
    if (best) p.bestScore = stats.score || 0;
    if ((stats.wave || 0) > p.bestWave) p.bestWave = stats.wave || 0;
    if (opts && opts.daily && opts.date) {
      if (p.daily.date !== opts.date) { p.daily = { date: opts.date, score: 0, wave: 0, bestScore: 0, runs: 0 }; }
      p.daily.runs += 1;
      if ((stats.score || 0) > p.daily.bestScore) p.daily.bestScore = stats.score || 0;
      p.daily.score = stats.score || 0; p.daily.wave = stats.wave || 0;
    }
    save(p);
    return { shards: gained, best };
  }

  /* ----- daily challenge: a deterministic seed + modifier per calendar day ----- */
  function dateStr(d) {
    // d: {y,m,day} or a Date-like; default supplied by caller (no Date.now in tests)
    if (!d) return '1970-01-01';
    const y = d.y, m = String(d.m).padStart(2, '0'), day = String(d.day).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const DAILY_MODIFIERS = [
    { id:'pure',    name:'PURE TONE',    desc:'No modifier — a clean run for the leaderboard.' },
    { id:'rich',    name:'RICH VEIN',    desc:'+50% energy from kills, but the Core is frail (-25 HP).' },
    { id:'swarm',   name:'SWARM',        desc:'Twice the foes, each with less health.' },
    { id:'presto',  name:'PRESTO',       desc:'Everything moves faster. Stay on the beat.' },
    { id:'fortissimo', name:'FORTISSIMO', desc:'All nodes hit +30% harder, but enemies are tougher.' },
  ];
  // returns { dateStr, seed, modifier }
  function dailyChallenge(d) {
    const ds = dateStr(d);
    const seed = hashStr('resonance|' + ds) || 1;
    const modifier = DAILY_MODIFIERS[seed % DAILY_MODIFIERS.length];
    return { dateStr: ds, seed, modifier };
  }
  // apply a daily modifier to a fresh run-state
  function applyDailyModifier(G, modId) {
    switch (modId) {
      case 'rich':    G.energyBonus += 2; G.coreMaxHP -= 25; G.coreHP -= 25; break;
      case 'swarm':   G.dailyMods = { countMult: 2, hpMult: 0.6 }; break;
      case 'presto':  G.dailyMods = { speedMult: 1.25 }; break;
      case 'fortissimo': G.dmgMult *= 1.3; G.dailyMods = { hpMult: 1.4 }; break;
      default: break; // 'pure'
    }
    return G;
  }

  const Meta = {
    KEY, freshProfile, load, save, reset,
    PERKS, PERK_ORDER, perkLevel, perkNextCost, canBuyPerk, buyPerk, applyPerks,
    PALETTES, PACKS, COSMETICS, COSMETIC_KINDS, cosmeticDefs, cosmeticOwned,
    cosmeticCost, buyCosmetic, equipCosmetic, equippedPalette, equippedPack,
    shardsFor, recordRun,
    DAILY_MODIFIERS, dateStr, hashStr, dailyChallenge, applyDailyModifier,
  };
  root.RMeta = Meta;
  if (typeof module !== 'undefined' && module.exports) module.exports = Meta;
})(typeof window !== 'undefined' ? window : globalThis);
