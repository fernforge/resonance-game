# RESONANCE 🎛️🎵

> **Build a living machine that fights to a beat — and every battle composes its own music.**

A browser game prototype: a fusion of **tower-defense + automation + a generative
music sequencer**, wrapped in a **roguelite** run structure. You place **Nodes** on a
grid; a global **Pulse** ticks; on the beats they're tuned to, nodes fire at incoming
**Dissonance** *and* play a musical note. Your defense literally becomes an evolving
song. Win a wave, draft a new node or upgrade, go as far as you can.

It was designed against an explicit checklist of what $100M+ games share — see
[`DESIGN.md`](DESIGN.md) for the requirements analysis and why this concept fits.

## Play

```bash
./run.sh          # or: python3 -m http.server 8000
# open http://localhost:8000  (headphones recommended 🎧)
```

No build step, no dependencies — the game is pure static HTML/CSS/JS (Canvas + WebAudio).

## How it plays
- Pick a node from the tray, click a cell to place it (costs **energy**).
- Each node fires on its **beats** at the nearest enemy and plays a note (row = pitch,
  locked to a minor pentatonic so it always sounds good; node type = timbre).
- **Dissonance** flows toward your **Core** — don't let it through.
- **Silence is power:** a node that **rests** charges up and its next shot **crits**;
  firing the *same* node every beat fatigues it (each repeat hits softer). Spaced,
  syncopated parts out-damage a flat wall of sound.
- **RESONANCE** (top bar) rates how musical your board is — sparsity, syncopation and
  variety between parts. It sets how high **Groove** can climb, so "everything on every
  beat" is the *weakest* build, not the strongest. Compose interlocking rhythms.
- Kill **on the beat** to build **Groove**: a score multiplier and visual intensity.
- Synergies: **Amplifiers** buff neighbors, **Relays** echo nearby fire into
  polyrhythms, **Resonators** hit huge but only when they fire *in sync*.
- Click a placed node to **retune** which beats it plays, or **UPGRADE** it with energy —
  leveled nodes hit harder, a deep late-game sink so you grow *taller*, not just wider.
- The **board grows a ring bigger every 5 waves** (Core stays centered, your nodes keep
  their spots) — it never fully clogs, and your machine visibly expands as you climb.
- Clear a wave → **draft** a node, upgrade, or build-defining **relic**.
- Every **10th wave is a BOSS wave**: the **Conductor** arrives last and shatters into a
  fast swarm when felled — big risk, big payout.

## Between runs (meta-progression)
- Every run banks **Resonance Shards** (from score, waves cleared, and bosses felled),
  saved to `localStorage` — they persist forever.
- Spend them in **UPGRADES** on permanent perks: more starting energy, a tougher Core,
  a higher Groove ceiling, bonus energy per kill, or a node unlocked from the start.
- **Daily Challenge**: a deterministic seed + a rotating twist (Swarm, Presto, Rich Vein,
  Fortissimo…) that's identical for everyone that calendar day. Beat your own best.
- **Share** your result: the game renders a score card (PNG download or native share
  sheet) and copies a summary to your clipboard — the viral loop.

## Project layout
```
index.html          # shell + HUD + overlays
css/style.css       # neon synth-grid UI
js/util.js          # math, seeded RNG, pentatonic music theory  (headless-safe)
js/audio.js         # WebAudio generative synth (voices, delay bus, percussion)
js/meta.js          # persistent profile: shards, perks, daily challenge  (headless-safe)
js/game.js          # simulation + render + input + UI  (sim is DOM-free & testable)
tools/smoke.js      # headless logic tests (node tools/smoke.js)
tools/meta-smoke.js # headless tests for the persistence / meta layer
tools/balance.js    # auto-play difficulty-curve harness
tools/dom-smoke.js  # full browser code path under jsdom + stubbed canvas
DESIGN.md           # the $100M-game checklist + concept rationale
PROGRESS.md         # build log / handoff notes
```

## Tests
```bash
node tools/smoke.js       # 58 core-logic assertions (boss waves + rhythm economy)
node tools/meta-smoke.js  # 41 persistence / perk / daily / cosmetics assertions
node tools/dom-smoke.js   # 37 DOM/render/input assertions (needs `npm i jsdom`)
node tools/balance.js     # difficulty curve + all-on-vs-sparse A/B proof
node tools/balance.js     # prints the difficulty curve from a greedy auto-player
```

## Roadmap
**Shipped**
- ✅ Boss waves — the Conductor every 10th wave.
- ✅ Meta-progression between runs — Resonance Shards + permanent perks (localStorage).
- ✅ Daily seeded challenge with rotating modifiers + per-day best tracking.
- ✅ Shareable result card (PNG / native share + clipboard summary) — the viral hook.
- ✅ Cosmetics: 5 board **palettes** + 4 **instrument packs**, shard-bought & equipped,
  with live preview/audition in the shop. Retint the whole game and re-voice its music.
- ✅ **Harmonic backbone** — a seeded **chord progression** (6 named loops, all diatonic to
  A-minor so the pentatonic melody always fits) advances as the battle builds: a bassline
  follows the root, pads swell and the board flashes the chord's colour on every turnover,
  and the run's song name (♪ AURORA…) rides the HUD ribbon, share card & game-over. Each
  run is now its own evolving song, not just consonant blips.

**Next**
- More cosmetics: per-node skins, particle styles, board frames.
- Shareable run-*replay* clip export (record the generated audio + visuals).
- More node archetypes, enemy types, multiple distinct bosses, and relics.
- Mobile touch polish, controller support, accessibility (colorblind palettes,
  reduced-motion, rhythm-assist).
- Cosmetic-only monetization, content-drop expansions, online leaderboards.
