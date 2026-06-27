/* RESONANCE — meta-smoke.js : headless tests for the persistence / meta layer. */
require('../js/util.js');           // populates global.RU for game.js
const Meta = require('../js/meta.js');
const Game = require('../js/game.js');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

// --- fresh profile ---
Meta.reset();
let p = Meta.load();
ok('fresh profile has zero shards', p.shards === 0 && p.runs === 0);
ok('fresh profile has empty perks', Object.keys(p.perks).length === 0);

// --- shard math ---
ok('shardsFor scales with score/wave/bosses',
  Meta.shardsFor({ score: 1200, wave: 8, bosses: 1 }) === Math.floor(1200 / 120) + 16 + 12);
ok('zero run yields zero shards', Meta.shardsFor({}) === 0);

// --- recordRun folds stats & persists ---
const r1 = Meta.recordRun(p, { score: 2400, wave: 11, bosses: 1 });
ok('recordRun returns gained shards', r1.shards === Meta.shardsFor({ score: 2400, wave: 11, bosses: 1 }));
ok('recordRun marks a best on first run', r1.best === true);
ok('profile accrued shards', p.shards === r1.shards);
ok('bestScore recorded', p.bestScore === 2400 && p.bestWave === 11);
ok('runs incremented', p.runs === 1 && p.bossesFelled === 1);
// reload from storage proves persistence
let p2 = Meta.load();
ok('profile persisted across load()', p2.shards === p.shards && p2.bestScore === 2400);
const r2 = Meta.recordRun(p2, { score: 100, wave: 2, bosses: 0 });
ok('lower score is not a new best', r2.best === false && p2.bestScore === 2400);

// --- perks ---
p = Meta.load();
p.shards = 1000; Meta.save(p);
const cost0 = Meta.perkNextCost(p, 'energy');
ok('perk has a next cost at level 0', cost0 === Meta.PERKS.energy.cost(0));
const lvl = Meta.buyPerk(p, 'energy');
ok('buying a perk raises its level', lvl === 1 && Meta.perkLevel(p, 'energy') === 1);
ok('buying a perk spends shards', p.shards === 1000 - cost0);
ok('next cost rises after purchase', Meta.perkNextCost(p, 'energy') > cost0);
// max out a capped perk
p.shards = 99999;
const opener1 = Meta.buyPerk(p, 'opener');
ok('one-time perk reaches max', opener1 === 1 && Meta.perkNextCost(p, 'opener') === null);
ok('maxed perk cannot be bought again', Meta.buyPerk(p, 'opener') === false);
// broke
p.shards = 0;
ok('cannot buy when broke', Meta.buyPerk(p, 'core') === false && Meta.perkLevel(p, 'core') === 0);

// --- applyPerks mutates a run state ---
p = Meta.load(); p.perks = { energy: 2, core: 1, groove: 2, harvest: 1, opener: 1 };
const G = Game.makeState(1);
const e0 = G.energy, hp0 = G.coreMaxHP, gc0 = G.grooveCap, eb0 = G.energyBonus;
Meta.applyPerks(G, p);
ok('PRELUDE adds start energy', G.energy === e0 + 8 * 2);
ok('BULWARK adds core max hp', G.coreMaxHP === hp0 + 12 * 1);
ok('SWING raises groove cap', G.grooveCap === gc0 + 2);
ok('TIP JAR adds energy bonus', G.energyBonus === eb0 + 1);
ok('OPENING ACT unlocks splitter', G.unlocked.splitter === true);

// --- daily challenge determinism ---
const d = { y: 2026, m: 6, day: 24 };
const c1 = Meta.dailyChallenge(d);
const c2 = Meta.dailyChallenge(d);
ok('daily seed is deterministic for a date', c1.seed === c2.seed && c1.dateStr === '2026-06-24');
const cNext = Meta.dailyChallenge({ y: 2026, m: 6, day: 25 });
ok('different days produce different seeds', cNext.seed !== c1.seed);
ok('daily picks a modifier', !!c1.modifier && typeof c1.modifier.id === 'string');

// --- daily modifier application ---
const Gs = Game.makeState(c1.seed);
Meta.applyDailyModifier(Gs, 'swarm');
Game.startWave(Gs);
const Gn = Game.makeState(c1.seed); // same seed, no modifier
Game.startWave(Gn);
ok('swarm modifier inflates the spawn queue', Gs.spawnQueue.length > Gn.spawnQueue.length);
const Gr = Game.makeState(7); Meta.applyDailyModifier(Gr, 'rich');
ok('rich modifier weakens the core & boosts harvest', Gr.coreMaxHP < Game.CONFIG.CORE_HP && Gr.energyBonus >= 2);

// --- daily best tracking via recordRun ---
Meta.reset(); p = Meta.load();
Meta.recordRun(p, { score: 500, wave: 5, bosses: 0 }, { daily: true, date: '2026-06-24' });
Meta.recordRun(p, { score: 900, wave: 7, bosses: 0 }, { daily: true, date: '2026-06-24' });
ok('daily best is tracked', p.daily.bestScore === 900 && p.daily.runs === 2 && p.daily.date === '2026-06-24');

// --- cosmetics: ownership, purchase, equip, audio pack shape ---
Meta.reset(); p = Meta.load();
ok('default palette+pack owned & equipped on fresh profile',
  Meta.cosmeticOwned(p, 'palette', 'aurora') && Meta.cosmeticOwned(p, 'pack', 'synth') &&
  p.equipped.palette === 'aurora' && p.equipped.pack === 'synth');
ok('a locked cosmetic is not owned by default', !Meta.cosmeticOwned(p, 'palette', 'ember'));
ok('cannot buy a cosmetic without shards', Meta.buyCosmetic(p, 'palette', 'ember') === false);
p.shards = 500; Meta.save(p);
const sBefore = p.shards;
ok('buying a cosmetic succeeds when affordable', Meta.buyCosmetic(p, 'palette', 'ember') === true);
ok('purchase spends exactly its cost & auto-equips',
  p.shards === sBefore - Meta.cosmeticCost('palette', 'ember') &&
  Meta.cosmeticOwned(p, 'palette', 'ember') && p.equipped.palette === 'ember');
ok('cannot re-buy an owned cosmetic', Meta.buyCosmetic(p, 'palette', 'ember') === false);
Meta.buyCosmetic(p, 'pack', 'chip');
ok('equip switches the equipped id without spending', (() => {
  const sh = p.shards;
  const okEq = Meta.equipCosmetic(p, 'palette', 'aurora');
  return okEq && p.equipped.palette === 'aurora' && p.shards === sh;
})());
ok('cannot equip an unowned cosmetic', Meta.equipCosmetic(p, 'pack', 'mellow') === false);
ok('cosmetics persist across load()', (() => {
  const p2 = Meta.load();
  return Meta.cosmeticOwned(p2, 'palette', 'ember') && Meta.cosmeticOwned(p2, 'pack', 'chip');
})());
const pal = Meta.equippedPalette(p), pak = Meta.equippedPack(Meta.load());
ok('equippedPalette returns a usable theme', pal && pal.accentRGB && pal.bg0 && pal.bg1);
ok('a non-default pack carries voice overrides', pak.id === 'chip' && pak.voices && pak.voices.pulser);
// old saves (no cosmetics field) still get the free defaults
Meta.save(Object.assign(Meta.freshProfile(), { cosmetics: undefined, equipped: undefined }));
const pOld = Meta.load();
ok('legacy profile heals to owning the defaults',
  Meta.cosmeticOwned(pOld, 'palette', 'aurora') && pOld.equipped.pack === 'synth');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
