# PROGRESS — RESONANCE

## Goal
Polished playable web game: **RESONANCE** — tower-defense + automation + generative-music
roguelite. Pure static files (HTML/Canvas/WebAudio), zero runtime deps. See DESIGN.md.

## Current state (run 18 shipped; 265 tests green, npm test exit 0)
Full game live on GitHub Pages + Für Elise share-link demo. Recent user complaint ("Für Elise
nodes all at the bottom, game super slow & laggy") FIXED in run 18:
- **Perf:** removed per-frame `ctx.shadowBlur` (the canvas killer) from node/enemy/projectile
  render; replaced with cached glow sprites `glowSprite`/`stampGlow` (js/game.js ~1593). Measured
  in real Chromium: 4.8fps → 60fps on build screen; 60fps under 50-enemy/300-particle stress.
- **Für Elise layout:** `tools/furelise-layout.js` lays the 17 notes as a MELODIC CONTOUR
  (x = phrase order, y = pitch, top=high) instead of piled on bottom rows. New share code
  regenerated + synced into `furelise.html` + `FUR-ELISE.md`. Changing layout changes the R1~ code.
- Both pushed to `main` (Pages redeploys ~30-60s).

Systems all done & tested: 8-step pulse loop, growing grid board (→21×17), Core, energy, 5 node
types, 7 enemies + boss, projectiles, juice, meta/cosmetics/daily. Music = real instrument
(pitch=colour=tone=damage smooth blend; per-node compose: PITCH/OCT/♭♮♯; seeded chord progression
+ bass + pad). Board SHARE CODES (`R1~…`) + one-click `?board=` links. MAESTRO autoArrange.

Live: https://fernforge.github.io/resonance-game/ · Demo: …/furelise.html (redirects to ?board=…).
Repo: github.com/fernforge/resonance-game (account fernforge, GH_TOKEN in env).

## What's left (none blocking — optional polish / future content)
- Optionally route core glow + groove-aura + projectile trails through stampGlow (already 60fps).
- More bosses/enemy types/content; per-node skins/particle styles; mobile/controller/accessibility.
- Shareable run *replay clip*; online leaderboards.

## Next concrete step
Run 18 fix is shipped & verified. If continuing: confirm the live Pages deploy renders the Für
Elise contour correctly (Playwright via Chromium IS available — see below), then add enemy/boss
content (testable in smoke.js). Lower priority: more render through stampGlow.

## Key decisions & why
- Natural minor (not pentatonic) melody range — single-key consonant; type degOffs + MAESTRO bias
  keep casual play sweet.
- Only level/pitch/accidental change pitch-CLASS (deliberate compose); every BUFF is OCTAVE-based
  so it can never sour a tune.
- CONSONANCE is a TALL UNISON SPIKE over a low flat field (js/util.js ~87) so monotone boards leak
  and rainbow boards cover — DON'T re-flatten it (run-14 leak fix).
- Audio/particles cosmetic & try/caught — can NEVER freeze the loop. game.js stays headless-safe;
  export new logic on RGame for node tests.

## Gotchas
- PERF RULE: NEVER use `ctx.shadowBlur` in the per-frame loop. Use `stampGlow(hslColor,x,y,rad,
  alpha)` (cached sprites). It expects an `hsl(...)` string; hex/rgb fall back to transparent fade.
- `freqOf(n,G)`/`semiOf(n,G)` vs `noteNameOf(G,n)` — arg ORDER differs. Easy to swap.
- Locked node types: only `pulser` unlocked in fresh makeState — set `s.unlocked.X=true` in tests.
- `js/sharecode.js` must load BEFORE game.js (index.html + dom-smoke list).
- Für Elise layout change ⇒ R1~ code changes; update furelise.html + FUR-ELISE.md in sync.
- Chromium IS available for Playwright (NODE_PATH=$(npm root -g)); jsdom+node tools also fine.

## How to run / test
- Play: `./run.sh` (or `npm start`) → http://localhost:8000 (click 🎧 for audio).
- Test: `npm test` (5 suites: smoke 119 · meta 41 · dom 70 · furelise 8 · sharecode 27 = 265;
  run in BACKGROUND, check exit 0). `npm run balance` = consonance curve + A/B proof (14/14 both).

## Log
- Dated RUN blocks: `.cb/log/progress-archive-20260627.md` (run 14–18) and
  `.cb/log/progress-archive-20260626.md` (run 1–13). Write-only — not read back.
