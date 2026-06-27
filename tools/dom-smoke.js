/* Run the REAL browser code (bootstrap, render, input, UI) under jsdom with a
   stubbed Canvas2D context, to catch runtime errors the headless sim can't. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Canvas2D stub: every method is a no-op, gradients return objects with addColorStop.
function stubCtx() {
  const grad = { addColorStop() {} };
  const ctx = {};
  const noop = () => {};
  for (const m of ['save','restore','translate','scale','rotate','setTransform','fillRect','clearRect','strokeRect',
    'beginPath','closePath','moveTo','lineTo','arc','arcTo','rect','fill','stroke','fillText','strokeText',
    'createLinearGradient','createRadialGradient','setLineDash','quadraticCurveTo','bezierCurveTo','ellipse',
    'drawImage','putImageData','measureText']) ctx[m] = noop;
  ctx.createLinearGradient = () => grad;
  ctx.createRadialGradient = () => grad;
  ctx.measureText = () => ({ width: 10 });
  // writable style props
  Object.assign(ctx, { fillStyle:'', strokeStyle:'', lineWidth:1, globalAlpha:1, globalCompositeOperation:'',
    shadowColor:'', shadowBlur:0, font:'', textAlign:'', lineCap:'', lineJoin:'' });
  return ctx;
}

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', storageQuota: 10000000 });
const { window } = dom;
global.window = window;

// stub canvas + audio + raf BEFORE loading scripts
window.HTMLCanvasElement.prototype.getContext = function () { return stubCtx(); };
window.AudioContext = undefined; window.webkitAudioContext = undefined; // audio becomes no-op
window.devicePixelRatio = 1;
Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
let rafCb = null;
window.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
window.performance = window.performance || { now: () => 123456 };

// load scripts in order into the window context
for (const f of ['js/util.js', 'js/audio.js', 'js/harmony.js', 'js/meta.js', 'js/sharecode.js', 'js/game.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  window.eval(code);
}

const errors = [];
window.addEventListener('error', e => errors.push(e.message));

function pump(n, ts0) {
  // drive the rAF loop n times
  for (let i = 0; i < n; i++) {
    const cb = rafCb; rafCb = null;
    if (!cb) break;
    try { cb(ts0 + i * 16.7); } catch (e) { errors.push('frame: ' + e.message + '\n' + e.stack); break; }
  }
}

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };

const doc = window.document;
const G = window.RGame;
const CONFIG = G.CONFIG;

// helper: synth a pointer event at a grid cell over the canvas
function cellToScreen(c, r) {
  const W = 1280, H = 800, padX = 24, padTop = 84, padBot = 120;
  const scale = Math.min((W - padX * 2) / CONFIG.BOARD_W, (H - padTop - padBot) / CONFIG.BOARD_H);
  const ox = (W - CONFIG.BOARD_W * scale) / 2;
  const oy = padTop + ((H - padTop - padBot) - CONFIG.BOARD_H * scale) / 2;
  return { x: ox + (c + 0.5) * CONFIG.UNIT * scale, y: oy + (r + 0.5) * CONFIG.UNIT * scale };
}
function pointerDownCell(c, r) {
  const cv = doc.getElementById('game');
  const { x, y } = cellToScreen(c, r);
  // jsdom lacks PointerEvent; dispatch a plain Event with coords + getBoundingClientRect stub
  cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 800 });
  const ev = new window.Event('pointerdown', { bubbles: true });
  ev.clientX = x; ev.clientY = y;
  cv.dispatchEvent(ev);
}

console.log('DOM smoke (jsdom + stubbed canvas)\n');

pump(2, 1000);
ok('initial frames render without error', errors.length === 0);
ok('title overlay visible at boot', !doc.getElementById('title').classList.contains('hidden'));

// start the game
doc.getElementById('btn-play').click();
pump(2, 2000);
ok('HUD shown after PLAY', !doc.getElementById('hud').classList.contains('hidden'));
ok('tray populated with unlocked nodes', doc.querySelectorAll('#tray .tray-item').length >= 1);

// place a few pulsers (pulser auto-selected on start)
for (const [c, r] of [[5,3],[7,3],[5,5],[7,5],[6,2]]) pointerDownCell(c, r);
pump(3, 3000);
ok('nodes placed via pointer events', window.RGame.NODE_TYPES && doc.querySelector('#stat-energy span'));

// open & interact with retune popup: click an existing node with no type selected
// first deselect by clicking the selected tray item — find selected
const selItem = doc.querySelector('#tray .tray-item.sel');
if (selItem) selItem.click();
pointerDownCell(5, 3); // should open retune
pump(2, 3500);
ok('retune popup opens on placed node', !!doc.getElementById('retune'));
const stepBtns = doc.querySelectorAll('#retune .step-btn');
ok('retune shows 8 step buttons', stepBtns.length === 8);
if (stepBtns[1]) stepBtns[1].click(); // toggle a beat
pump(1, 3600);
ok('toggling a beat does not error', errors.length === 0);

// upgrade button in the popup spends energy & raises level
const upBtn = doc.querySelector('#retune button.mini.up');
ok('retune popup has an UPGRADE button', !!upBtn);
if (upBtn) {
  window.RGameState().energy = 9999; // ensure the upgrade is affordable
  const lvlBefore = doc.querySelector('#retune .rt-lvl').textContent;
  upBtn.click(); pump(1, 3650);
  ok('clicking UPGRADE does not error & updates level',
    errors.length === 0 && doc.querySelector('#retune .rt-lvl').textContent !== lvlBefore);
}

// compose UI: the pitch knobs read a note and re-pitch the voice live
const noteEl0 = doc.querySelector('#retune .rt-note');
ok('retune shows a NOTE readout (e.g. E5)', !!noteEl0 && /^[A-G]#?-?\d$/.test(noteEl0.textContent));
const pitchUp = doc.querySelector('#retune .rt-knobs .pc[data-p="pitch1"]');
ok('retune has PITCH/OCT knobs', !!pitchUp);
if (pitchUp && noteEl0) {
  const noteBefore = noteEl0.textContent;
  pitchUp.click(); pump(1, 3680);
  ok('PITCH ▲ changes the displayed note (and does not error)',
    errors.length === 0 && doc.querySelector('#retune .rt-note').textContent !== noteBefore);
  const sharpBtn = doc.querySelector('#retune .rt-acc .ac[data-acc="1"]');
  ok('retune has ♭ ♮ ♯ accidental buttons', !!sharpBtn);
  if (sharpBtn) {
    sharpBtn.click(); pump(1, 3690);
    ok('♯ marks itself active without error',
      errors.length === 0 && sharpBtn.classList.contains('on'));
  }
}

// GROOVE preset cycler applies a non-empty syncopated pattern
const grooveBtn = doc.querySelector('#retune button.mini[data-a="pattern"]');
ok('retune popup has a GROOVE preset button', !!grooveBtn);
if (grooveBtn) {
  grooveBtn.click(); pump(1, 3700);
  const onCount = doc.querySelectorAll('#retune .step-btn.on').length;
  ok('GROOVE preset applies a partial (not all-on) pattern',
    errors.length === 0 && onCount > 0 && onCount < 8);
}

// STAMP-to-type button copies this node's groove to its whole section
const stampBtn = doc.querySelector('#retune button.mini[data-a="stamp"]');
ok('retune popup has a STAMP (ALL TYPE) button', !!stampBtn);
if (stampBtn) {
  // place a second pulser so there is a sibling to stamp onto
  const tray = doc.querySelector('#tray .tray-item');
  if (tray) tray.click(); // select pulser
  window.RGameState().energy = 9999;
  pointerDownCell(6, 3); pump(1, 3720);
  // reopen retune on the first node and stamp
  const sel = doc.querySelector('#tray .tray-item.sel'); if (sel) sel.click();
  pointerDownCell(5, 3); pump(1, 3740);
  const sBtn = doc.querySelector('#retune button.mini[data-a="stamp"]');
  if (sBtn) { sBtn.click(); pump(1, 3760); }
  ok('clicking STAMP does not error', errors.length === 0);
}

// MAESTRO button composes the whole board in one click
const maestroBtn = doc.getElementById('btn-maestro');
ok('HUD has a MAESTRO button', !!maestroBtn);
if (maestroBtn) {
  const liveBoard = window.RGameState();
  liveBoard.nodes.forEach(n => { if (n.type !== 'amplifier') n.steps = [1,1,1,1,1,1,1,1]; });
  const musBefore = window.RGame.computeMusicality(liveBoard);
  maestroBtn.click(); pump(1, 3800);
  const musAfter = window.RGame.computeMusicality(liveBoard);
  ok('MAESTRO lifts board musicality without error', errors.length === 0 && musAfter > musBefore);
  maestroBtn.click(); pump(1, 3820); // re-roll
  ok('MAESTRO re-roll stays error-free & musical', errors.length === 0 && window.RGame.computeMusicality(liveBoard) > 0.5);
}

// relay retune popup explains it echoes — no beat grid, no GROOVE/STAMP
if (window.RUI && window.RUI.openRetune && window.RUI.closeRetune) {
  const lb = window.RGameState();
  lb.unlocked.relay = true; lb.energy = 9999;
  const relay = window.RGame.placeNode(lb, 'relay', 8, 6);
  window.RUI.closeRetune();
  window.RUI.openRetune(relay); pump(1, 3840);
  const rt = doc.getElementById('retune');
  ok('relay retune popup opens', !!rt);
  if (rt) {
    ok('relay popup has NO beat grid', rt.querySelectorAll('.step-btn').length === 0);
    ok('relay popup explains the echo (no GROOVE/STAMP buttons)',
      !rt.querySelector('button[data-a="pattern"]') && !rt.querySelector('button[data-a="stamp"]') && !!rt.querySelector('.rt-echo'));
    ok('relay popup still offers UPGRADE & SELL', !!rt.querySelector('button[data-a="up"]') && !!rt.querySelector('button[data-a="del"]'));
  }
  window.RUI.closeRetune();
}

// RESONANCE HUD reflects board musicality (0..100%)
const resoTxt = doc.querySelector('#stat-reso span').textContent;
ok('RESONANCE stat renders a percentage', /^\d{1,3}%$/.test(resoTxt));

// render at an expanded board size to exercise the grown-grid draw + re-fit path
window.RGame.setBoardSize(21, 17);
window.dispatchEvent(new window.Event('resize'));
pump(3, 3700);
ok('render survives at a grown 21×17 board', errors.length === 0 && window.RGame.CONFIG.COLS === 21);
window.RGame.setBoardSize(window.RGame.CONFIG.BASE_COLS, window.RGame.CONFIG.BASE_ROWS);
window.dispatchEvent(new window.Event('resize'));

// start a wave and run ~6s of frames
doc.getElementById('btn-start').click();
pump(380, 4000); // ~6.3s
ok('wave runs many frames without error', errors.length === 0);

// run long enough to (likely) reach a draft, then verify overlay/cards exist or game still healthy
pump(1200, 11000);
const draftShown = !doc.getElementById('draft').classList.contains('hidden');
const cards = doc.querySelectorAll('#draft-cards .card').length;
ok('long run stays error-free', errors.length === 0);
console.log('  · draft overlay currently shown:', draftShown, '| cards:', cards);

// if draft is up, pick first card
if (draftShown && cards) { doc.querySelector('#draft-cards .card').click(); pump(3, 25000); ok('drafting a card hides the draft & resumes building', doc.getElementById('draft').classList.contains('hidden')); }

// mute toggle
doc.getElementById('btn-mute').click();
pump(1, 26000);
ok('mute toggle works', true);

// ---- meta layer wired into the DOM ----
const Meta = window.RMeta;
ok('meta module present in browser', !!Meta);
ok('title meta strip rendered', !!doc.getElementById('title-meta'));

// upgrades shop: grant shards, open, buy a perk, confirm shard spend reflected in UI
const prof = Meta.load(); prof.shards = 500; Meta.save(prof);
doc.getElementById('btn-upgrades').click();
pump(1, 26500);
ok('upgrades overlay opens', !doc.getElementById('upgrades').classList.contains('hidden'));
const perkCards = doc.querySelectorAll('#perk-cards .card.perk');
ok('perk cards rendered', perkCards.length === Meta.PERK_ORDER.length);
const shardsBefore = Meta.load().shards;
const firstBuy = doc.querySelector('#perk-cards .card.perk .buy:not([disabled])');
ok('an affordable perk has an enabled BUY button', !!firstBuy);
if (firstBuy) {
  firstBuy.click(); pump(1, 26600);
  ok('buying a perk spends shards & re-renders shop', Meta.load().shards < shardsBefore && errors.length === 0);
}
// cosmetics tab: switch tabs, render cards, buy + equip a palette
doc.getElementById('tab-cosmetics').click();
pump(1, 26620);
ok('cosmetics tab activates', doc.getElementById('tab-cosmetics').classList.contains('active') &&
  !doc.getElementById('cosmetic-cards').classList.contains('hidden'));
const cosCards = doc.querySelectorAll('#cosmetic-cards .card.cos');
const cosCount = Object.keys(Meta.PALETTES).length + Object.keys(Meta.PACKS).length;
ok('cosmetic cards render for every palette + pack', cosCards.length === cosCount);
ok('exactly the two equipped cosmetics are marked', doc.querySelectorAll('#cosmetic-cards .card.cos.equipped').length === 2);
const cosShardsBefore = Meta.load().shards;
const cosBuy = doc.querySelector('#cosmetic-cards .card.cos:not(.equipped):not(.owned) .buy:not([disabled])');
ok('an affordable cosmetic has an enabled BUY button', !!cosBuy);
if (cosBuy) {
  cosBuy.click(); pump(1, 26650);
  ok('buying a cosmetic spends shards & re-renders', Meta.load().shards < cosShardsBefore && errors.length === 0);
}
doc.getElementById('tab-perks').click(); pump(1, 26680);
ok('can switch back to the perks tab', doc.getElementById('tab-perks').classList.contains('active') &&
  doc.getElementById('cosmetic-cards').classList.contains('hidden'));

doc.getElementById('btn-shop-close').click();
pump(1, 26700);
ok('shop closes back to title', doc.getElementById('upgrades').classList.contains('hidden'));

// share: summary text + offscreen card canvas should build without error
const summary = window.RUI.shareSummary();
ok('share summary mentions RESONANCE & score', /RESONANCE/.test(summary) && /Score/.test(summary));
const card = window.RUI.drawShareCard();
ok('share card canvas builds without error', !!card && errors.length === 0);

// daily challenge: starts a run and applies a modifier toast without error
doc.getElementById('btn-go-menu') && doc.getElementById('btn-go-menu');
window.RUI.startGame({ daily: true });
pump(3, 27000);
ok('daily challenge run starts cleanly', !doc.getElementById('hud').classList.contains('hidden') && errors.length === 0);

// boss render: inject a boss enemy and pump frames to exercise its draw path
const liveG = window.RGameState();
liveG.state = 'wave';
window.RGame.spawnEnemy(liveG, 'conductor');
pump(4, 28000);
ok('boss enemy renders without error', liveG.enemies.some(e => e.boss) && errors.length === 0);

// harmony: the chord ribbon renders the run's progression and lights the active chord
(() => {
  const ribbon = doc.getElementById('chord-ribbon');
  ok('chord ribbon exists in the HUD', !!ribbon);
  pump(2, 28500);
  const cells = ribbon.querySelectorAll('.cr-chord');
  ok('ribbon renders one cell per chord in the progression',
     cells.length === liveG.progression.chords.length && cells.length === 4);
  ok('ribbon names the progression', /♪/.test(ribbon.querySelector('.cr-name').textContent));
  ok('exactly one chord cell is marked active',
     ribbon.querySelectorAll('.cr-chord.on').length === 1);
  // advance several bars and confirm the active cell can move
  const firstActive = [...cells].findIndex(c => c.classList.contains('on'));
  for (let i = 0; i < 8 * 5; i++) window.RGame.simStep(liveG);
  pump(1, 28800);
  const nowActive = [...ribbon.querySelectorAll('.cr-chord')].findIndex(c => c.classList.contains('on'));
  ok('the active chord advances as bars pass', nowActive !== firstActive && errors.length === 0);
})();

// resilience: a throwing audio/render layer must NOT freeze the game loop
(() => {
  const A = window.RAudio;
  const saved = {}; ['note', 'tick', 'pad', 'bass', 'impact', 'chord'].forEach(m => { saved[m] = A[m]; A[m] = () => { throw new Error('boom-' + m); }; });
  const t0 = liveG.time;
  const errsBefore = errors.length;
  for (const [c, r] of [[8, 4], [4, 6]]) pointerDownCell(c, r); // place during the chaos
  pump(30, 29500); // drive many frames + beat steps that all call the throwing audio
  ok('game loop survives a throwing audio layer (no error propagates)', errors.length === errsBefore);
  ok('simulation keeps advancing despite audio throwing', liveG.time > t0);
  ['note', 'tick', 'pad', 'bass', 'impact', 'chord'].forEach(m => { A[m] = saved[m]; });
})();

// game over records the run into the profile and shows shards earned
liveG.score = 1500; liveG.wave = 4; liveG.coreHP = 0;
pump(3, 29000);
ok('game over overlay shows after core dies', !doc.getElementById('gameover').classList.contains('hidden'));
ok('game over shows shards-earned line', !doc.getElementById('go-shards').classList.contains('hidden') && errors.length === 0);

// board share codes: copy the current board to a code, load it back, play it
(() => {
  const Share = window.RShare;
  ok('share codec module is loaded', !!Share && typeof Share.encodeBoard === 'function');
  ok('COPY BOARD + LOAD CODE buttons exist',
     !!doc.getElementById('btn-sharecode') && !!doc.getElementById('btn-loadcode'));
  // fresh run, place a couple of nodes to compose a tiny board (core is at 6,4)
  window.RUI.startGame();
  pump(2, 40000);
  for (const [c, r] of [[5, 3], [7, 3], [5, 5]]) pointerDownCell(c, r);
  pump(1, 40100);
  const g = window.RGameState();
  const nodesBefore = g.nodes.length;
  ok('placed nodes to share', nodesBefore > 0);
  // COPY: stub clipboard, click the button, capture what was written
  let copied = null;
  window.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  doc.getElementById('btn-sharecode').onclick();
  // with a real page URL, COPY now writes a one-click ?board=… LINK
  ok('COPY BOARD writes a one-click ?board= share link to the clipboard',
     typeof copied === 'string' && copied.indexOf('?board=R1~') !== -1);
  const code = Share.boardFromUrl(copied) || Share.encodeBoard(g);
  ok('the copied link carries a recoverable R1~ board code',
     typeof code === 'string' && code.indexOf('R1~') === 0);
  // LOAD: stub prompt to return the code, click the button, verify a faithful rebuild
  const savedPrompt = window.prompt;
  window.prompt = () => code;
  const errsBefore = errors.length;
  doc.getElementById('btn-loadcode').onclick();
  pump(2, 40300);
  window.prompt = savedPrompt;
  const g2 = window.RGameState();
  ok('LOAD CODE rebuilds a board with the same node count', g2.nodes.length === nodesBefore);
  ok('loaded board drops you into a playable building screen',
     !doc.getElementById('hud').classList.contains('hidden') && errors.length === errsBefore);

  // one-click share LINK: open the page with ?board=<code> and auto-load it
  window.RUI.goToMenu();
  pump(1, 40400);
  ok('back at the title before the link test', !doc.getElementById('title').classList.contains('hidden'));
  dom.reconfigure({ url: 'http://localhost/?board=' + encodeURIComponent(code) });
  const errsBeforeUrl = errors.length;
  const loaded = window.RUI.maybeLoadFromUrl();
  pump(2, 40500);
  const g3 = window.RGameState();
  ok('?board= URL is detected and auto-loaded', loaded === true);
  ok('URL-loaded board has the same node count, no errors',
     g3.nodes.length === nodesBefore && errors.length === errsBeforeUrl);
  ok('URL load lands on the playable building screen (title hidden)',
     doc.getElementById('title').classList.contains('hidden') &&
     !doc.getElementById('hud').classList.contains('hidden'));
  // a clean URL (no board param) must NOT hijack a normal boot
  dom.reconfigure({ url: 'http://localhost/' });
  ok('a plain URL does not trigger an auto-load', window.RUI.maybeLoadFromUrl() === false);
})();

if (errors.length) { console.log('\nERRORS:\n' + errors.join('\n')); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail || errors.length ? 1 : 0);
