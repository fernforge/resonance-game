# PROGRESS — RESONANCE

## Goal
Polished playable web game: **RESONANCE** — tower-defense + automation + generative-music
roguelite. Pure static files (HTML/Canvas/WebAudio), zero runtime deps. See DESIGN.md.

Core systems (done, see Log): pitch=colour=tone=damage smooth blend (run 13); Shifter enemy +
the LEAK FIX reshaping CONSONANCE so mono leaks & rainbow covers (run 14, rainbow>mono 14/14);
BOARD SHARE CODES (run 15, js/sharecode.js).

## RUN 17 — SHIPPED LIVE + FÜR ELISE DEMO LINK (the deliverable).
The whole game is now PUBLIC on GitHub Pages and the Für Elise board has a real, clickable link.
- **Live game:** https://fernforge.github.io/resonance-game/  (repo: github.com/fernforge/resonance-game)
- **Für Elise demo (short):** https://fernforge.github.io/resonance-game/furelise.html  → JS-redirects to
  `index.html?board=R1~AQ0JABEA…BQ9BVQ` (full code in FUR-ELISE.md / `node tools/furelise-link.js <base>`).
- New: `tools/furelise-link.js` builds the 17-note Für Elise board, encodes via RShare, asserts a
  bit-identical round-trip (note name + freq), prints CODE/REL/LINK. `furelise.html` = redirect page.
- VERIFIED in real Chromium/Playwright: link auto-loads `?board=` at boot → building state, all 17
  nodes present, names = E5 D#5 E5 D#5 E5 B4 D5 C5 A4 C4 E4 A4 B4 E4 G#4 B4 C5, zero console errors.
- Deploy = git push to `main` (Pages serves `/` from main). Account: fernforge (GH_TOKEN in env).
  To redeploy: edit files → `git add -A && git commit && git push`; Pages rebuilds in ~30–60s.

## RUN 16 COMPLETE — ONE-CLICK SHARE LINKS (closes the share loop). 265 green.
`?board=R1~…` URL → instant playable song. Pure helpers added to RShare (js/sharecode.js):
- `boardFromUrl(url|search|hash|rawCode)` → board code or null (regex `[?&#]board=…`, decodeURIComponent).
- `buildShareUrl(base, code)` → `base?board=code` (strips existing query/hash; null if not a code).
Wiring in js/game.js: `maybeLoadFromUrl()` runs at boot (after renderTitleMeta) — reads
`root.location.search+hash`, auto-loads via startGameFromCode. Exported on RUI. ⧉ COPY BOARD now
copies a full one-click LINK when `location.href` exists (falls back to bare R1~ code headlessly).
Tests: sharecode-smoke +12 (URL parse + link round-trips freq-for-freq) = 27; dom-smoke +6
(uses `dom.reconfigure({url})` to set ?board=, asserts auto-load lands on building screen) = 70.
index.html how-to updated ("one-click link"). ⚠ dom-smoke COPY test now expects a LINK not raw code.

## RUN 15 — BOARD SHARE CODES (the viral hook, reproducible).
New file `js/sharecode.js` (RShare): encodes a composed board → short `R1~…` base64url code
and rebuilds it. A board's song is fully determined by board size + each node's
{type,c,r,level,pitch,octave,accidental,steps}; we pack 7 bytes/node, own base64url (env-safe).
- `encodeBoard(G)` → string · `decodeBoard(str)` → {cols,rows,nodes} (pure, null on junk) ·
  `applyBoard(data,Game,seed)` → fresh loadable G (sizes board via setBoardSize, unlocks all
  types, places nodes; drops off-board/core/colliding) · `loadCode(str,Game,seed)` convenience.
- UI: `⧉ COPY BOARD` button (bottom controls) copies the live board's code to clipboard;
  `⧉ LOAD CODE` on the title screen prompts for a code → `startGameFromCode` (exported on RUI)
  swaps G to the rebuilt board in building state. Wired in js/game.js right after btn-go-menu.
- Loaded into jsdom + browser via `<script src="js/sharecode.js">` (BEFORE game.js) and dom-smoke
  load list. PROOF: `tools/sharecode-smoke.js` (15 tests, in npm test) builds a varied board,
  round-trips it, asserts every node field + note NAME + fired FREQ are bit-identical (max err 0).
- Docs: index.html how-to "Share your song" bullet. Tests now: smoke 119·meta 41·dom 64·furelise
  8·sharecode 15 = 247 green. balance still 14/14 both theses. ⚠ GOTCHA found this run:
  `noteNameOf(G,n)` but `freqOf(n,G)`/`semiOf(n,G)` — arg order DIFFERS, easy to swap.

## LEAK FIX (run 14, kept for the rationale) — why CONSONANCE is shaped as it is
The CONSONANCE curve is a TALL UNISON SPIKE over a LOW FLAT field (mean ≈1.2):
`CONSONANCE = [3.3,0.58,0.8,1.5,1.55,0.98,0.63,1.2,1.5,0.98,0.8,0.58]` (js/util.js ~87). A flat
plateau (old P4=1.7/P5=1.8) let a root-parked mono board meet a chord internally-consonant, so
monotony went unpunished. With the spike, mono shatters only its own colour & LEAKS the rest at
≈0.85–0.98× while rainbow covers every colour. DON'T re-flatten it. In-combat RESONANT flash
(`res>=1.7`, game.js ~758) thus fires ONLY on exact unison. Shifter = 7th enemy, re-tunes its
pc every 2.6s via DETERMINISTIC `shiftIdx++` (no G.rng draw — would desync the A/B arms).

## Current state (run 16 COMPLETE — all 265 tests green, npm test exit 0)
Engine + music + compose UI + board-share codes + one-click share links shipped & tested. Tally:
smoke 119 · meta 41 · dom 70 · furelise 8 · sharecode 27. `node tools/balance.js` proves BOTH
theses: sparse>all-on 14/14 AND rainbow>mono 14/14 (re-verified this run).
- **Loop:** 8-step/bar pulse, grid board (grows a ring every 5 waves → 21×17 cap), Core,
  energy, 5 node types, 7 enemies + boss, projectiles, juice, meta/cosmetics/daily/share.
- **Music — the board is a real instrument.** A note = legible pitch ladder:
  `degree = rowToDegree + TYPE.degOff + (level-1) + pitch`;
  `semi = scaleDegreeToSemitone(deg, A-minor) + accidental + KEY_OFFSET(12) + 12*(octave+buffOctaves)`;
  `freq = 110·2^(semi/12)`. Compose controls per node (retune popup): NOTE readout, PITCH ▼▲,
  OCT ▼▲, ♭♮♯. Level raises note +1 step; adjacent AMP +1 octave (cap2); RESONANCE≥75% lifts
  +1 octave. Seeded 4-chord progression + bass + pad + chord ribbon underneath (harmony.js).
  Nodes are **hue-tinted by pitch** so the melody is visible (`pitchColor`, game.js ~1682).
  MAESTRO `autoArrange` composes rhythm + symmetric pitch arch; scores blend(musicality,symmetry).
- **Proof:** `tools/furelise.js` builds the Für Elise opening on a board, simulates, and asserts
  every fired freq matches concert pitch (A4=440) within 0.5 Hz. `FUR-ELISE.md` = human walkthrough.

## KEY FILES
- `js/util.js` — math/RNG, SCALES{minor,penta}, scaleDegreeToSemitone, semitoneToFreq, noteName.
- `js/game.js` (~1700 lines) — sim+render+UI, loaded in node AND browser (guard browser code
  behind `typeof document`). Pitch model: noteDegree/semiOf/freqOf(n,G)/noteNameOf, buffOctaves,
  pitchShift/octaveShift/setAccidental, symmetryScore, autoArrange. All exported on RGame.
- `js/harmony.js` (chords), `js/audio.js` (safe WebAudio facade), `js/meta.js` (profile/perks).
- `js/sharecode.js` (RShare) — board↔code codec (encode/decode/applyBoard/loadCode) + share-link
  helpers (boardFromUrl/buildShareUrl). Pure; no DOM. game.js maybeLoadFromUrl() auto-loads ?board=.
- Tests: `tools/{smoke,meta-smoke,dom-smoke,furelise,sharecode-smoke}.js` (npm test) + `tools/balance.js`.

## What is left (none blocking — all optional polish / future content)
- Per-node skins/particle styles; shareable run *replay clip* (record audio+visuals).
- More bosses/enemy types/content; mobile + controller + accessibility passes.
- Online leaderboards. (Sandbox can't run Chromium — verify via jsdom + node tools, not pixels.)

## Next concrete step
Share loop complete (run 16: links + auto-load). Pick any item from "What is left". Best next:
(a) more enemy/boss content for depth (testable in smoke.js); (b) a per-node skin/particle pass
for visual variety; (c) shareable replay CLIP (MediaRecorder — NOT headless-testable, skip in
sandbox). Recommend (a) — adds depth and is fully node-testable.

## Key decisions & why
- Natural minor (not pentatonic) for melody range — still single-key consonant; type degOffs +
  MAESTRO bias keep casual play sweet.
- Only level/pitch/accidental change pitch-CLASS (deliberate compose); every BUFF effect is
  OCTAVE-based so it can never sour a tune. Satisfies "buffs/resonance affect the music" safely.
- Audio/particles are cosmetic and fully isolated (try/caught) so they can NEVER freeze the loop
  (run-10 lesson). game.js must stay headless-safe; export new logic on RGame for tests.

## Gotchas
- `freqOf` signature is `freqOf(n, G)` (takes the game state) — all call sites + tests pass G.
- Locked node types: only `pulser` unlocked in a fresh makeState — set `s.unlocked.X=true` in tests.
- Default node patterns are syncopated; balance.js must keep showing composition wins. Don't regress.
- No real-browser screenshots (no Chromium libs) — verify via jsdom + node tools.
- `noteNameOf(G,n)` vs `freqOf(n,G)`/`semiOf(n,G)` — arg ORDER differs between these. Easy to swap.
- sharecode.js must load BEFORE game.js (index.html + dom-smoke list) — startGameFromCode reads root.RShare.

## How to run / test
- Play: `./run.sh` (or `npm start`) → http://localhost:8000 (click 🎧 for audio). `npm test` runs
  all 4 suites (~2 min; run in BACKGROUND, check exit 0). `npm run balance` = curve + A/B proof.

## Log
- run 1–10 history in `.cb/log/progress-archive-20260626.md` (write-only). run 11 = pitch model +
  compose UI. run 12 = pitch hue visuals verified + Für Elise proof + FUR-ELISE.md + expanded
  smoke/dom tests + DESIGN.md/index.html docs. 208 green. run 13 = the smooth blend
(pitch=colour=tone=damage): consonance combat, render polish, teaching. 218 green. run 14 =
Shifter enemy + the LEAK FIX (reshaped CONSONANCE to a unison spike so mono leaks & rainbow
covers; rainbow>mono 14/14, sparse>all-on 14/14). 226 green. run 15 = BOARD SHARE CODES
(js/sharecode.js RShare: encode/decode/applyBoard; COPY BOARD + LOAD CODE buttons; 15-test
round-trip proves note+freq bit-identical). 247 green. run 16 = ONE-CLICK SHARE LINKS
(RShare.boardFromUrl/buildShareUrl; maybeLoadFromUrl auto-loads ?board= at boot; COPY copies a
link; +12 sharecode +6 dom tests). 265 green.
