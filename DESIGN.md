# RESONANCE — Design Document

## Part 1 — What does a $100M+ game actually require?

Studying breakout hits (Vampire Survivors, Balatro, Hades, Tetris, Slay the Spire,
Among Us, Minecraft, Plants vs Zombies, Stardew), the shared DNA is:

1. **A one-sentence hook that is also a fantasy.** "I am a survivor mowing down
   thousands." "I build a poker hand that breaks the math." The pitch sells itself.
2. **Easy to learn, deep to master.** A trivial first 30 seconds; a skill/knowledge
   ceiling that takes hundreds of hours. Low floor, high ceiling.
3. **A tight, juicy core loop measured in seconds.** Action → feedback → reward,
   with screen shake, sound, particles. The "one more run" compulsion.
4. **Emergent depth from simple rules.** Combinatorial systems (synergies, builds)
   so the *player* generates the content. Cheap to make, infinite to play.
5. **Run-based / replayable structure.** Procedural variety + meta-progression so
   no two sessions are identical and every session leaves you stronger/smarter.
6. **A strong, ownable aesthetic identity.** Instantly recognizable in a 6-second
   clip. Distinct palette, motion language, and *sound*.
7. **Built-in shareability / virality.** Every run produces a unique, screenshot-
   or clip-worthy artifact. Watching it is fun (streamable).
8. **Accessibility & reach.** Runs on weak hardware, web + mobile + desktop, no
   install friction, instant to start.
9. **Ethical, durable monetization.** Cosmetics, expansions, content drops — not
   pay-to-win. Respects the player so the community evangelizes it.
10. **An emotional / sensory payoff** beyond winning — beauty, rhythm, mastery,
    self-expression.

## Part 2 — The idea: RESONANCE

> **Hook: "Build a living machine that fights to a beat — and every battle you win
> composes its own music."**

A real-time roguelite that fuses **tower-defense + automation + a generative music
sequencer**. You place **Nodes** on a grid. A global **Pulse** (metronome) ticks.
On the beats they're tuned to, nodes fire energy pulses that destroy incoming
**Dissonance**. Crucially: *every node firing plays a musical note.* Row = pitch
(locked to a pentatonic scale so it always sounds good), node type = timbre. As your
machine grows, your defense literally becomes an evolving piece of music. Win and
your board is a song you wrote without trying.

### Why it hits the requirements
- **Hook/fantasy (1,10):** "your defense is a song." Sensory payoff is built in.
- **Low floor (2):** place a node, watch it shoot on the beat. Instantly legible.
- **High ceiling (2,4):** beat-timing, chaining relays, amplifier auras, polyrhythms,
  element/timbre synergies → enormous build space.
- **Juicy loop (3):** every beat = light + particles + a note. Constant feedback.
- **Run-based (5):** waves + draft-a-node roguelite + meta unlocks.
- **Aesthetic (6):** neon synth-grid, beat-synced bloom, clean geometric motion.
- **Shareable (7):** every run is a unique audiovisual clip — perfect for TikTok.
- **Reach (8):** vanilla JS + Canvas + WebAudio, runs anywhere, instant load.
- **Monetization (9):** cosmetic node skins, palettes, new "instrument" packs,
  campaign expansions. Never pay-to-win.

### Core systems
- **The Pulse:** global BPM, beats cycle 1..STEPS (a bar). UI shows the playhead.
- **Grid board:** hex-feel square grid; a **Core** the enemies want to reach.
- **Nodes (the build space):**
  - *Pulser* — fires a pulse outward on its beats. Pitch by row.
  - *Splitter* — fires in multiple directions.
  - *Relay* — has **no beats of its own**; purely reactive — echoes any neighbor that
    fires at 60% power (chains, polyrhythm). Its retune popup explains this instead of
    offering a beat grid.
  - *Amplifier* — buffs adjacent nodes (+30% dmg & pierce); silent support / warm pad.
  - *Resonator* — you set its beats, but it only strikes on a beat where a neighbor
    *also* fires (sync, +60% — rewards composition).
- **Beat tuning:** every *beat-making* node (pulser/splitter/resonator) has a step-mask
  (which of the bar's beats it fires on). Relays echo and amps are silent, so neither is
  programmed. Step-masks drive both combat cadence and the music; relays/amps are excluded
  from the RESONANCE % judgement and from MAESTRO auto-arrange.
- **Enemies (Dissonance):** flow from edges toward the Core; types = grunt, fast,
  tank, splitter. Killing on-beat grants bonus ("groove").
- **Groove meter:** kills/hits that land on the beat build Groove → score multiplier
  + visual intensity. Encourages musical, rhythmic play.
- **Roguelite layer:** after each wave, draft 1 of 3 nodes/upgrades. Energy economy
  to place. Relics that warp rules.
- **Audio:** WebAudio synth, pentatonic scale, per-row pitch, per-type waveform,
  master bus with delay for space. Generative, always-consonant.

### MVP scope (this build)
A complete, polished, playable vertical slice:
- Full grid, Pulse engine, 4+ node types, placement & economy.
- 4 enemy types, wave spawner, escalating difficulty, win/lose.
- Generative pentatonic audio tied to firing.
- Juice: bloom, particles, screen shake, beat-synced background, floating combos.
- Draft/upgrade between waves (roguelite loop).
- Groove/score system + run summary.
- Menu, how-to, restart. Mobile-friendly pointer input.

---

## Board-clog fix — solution brainstorm & decision (wave-scaling update)

**Problem:** the fixed 13×9 board fills with nodes in higher waves. Players accumulate
energy with nowhere to spend it and no room for new strategies — the late game feels
cramped rather than expansive.

### Options considered
1. **Grow the board every 5 waves** (add a ring of cells, core stays centered).
   - *Pros:* directly creates space; reads as visible progression ("my machine is
     growing"); enemies spawn farther out → more reaction time, a gentle late-game relief
     valve; trivial to make satisfying with a flash/toast.
   - *Cons:* cells shrink on screen (auto-fit handles it); needs coordinate remap so the
     core stays centered; if overdone the board could feel sparse.
2. **Node merging / level-in-place** (spend energy to upgrade a placed node instead of
   placing a new one).
   - *Pros:* a *vertical* energy sink — relieves clog from the other side (you need fewer
     cells); adds build depth; reuses the half-wired `level` field & dmg scaling.
   - *Cons:* alone it doesn't add literal room; needs UI.
3. **Hard node cap / puzzle-style scarcity.** *Cons:* fights the power-fantasy; punishing.
4. **Bigger refunds / auto-sell.** *Cons:* doesn't address the core desire for more board.

### Decision — do **1 + 2 together** (they attack the clog from both sides)
- **Board expansion:** every 5 cleared waves the board gains a ring (+2 cols, +2 rows),
  core re-centered, existing nodes shifted to keep their relative spot. Happens during the
  draft pause (no enemies in flight), with a flash + "BOARD EXPANDED" toast and a re-fit.
- **Node leveling:** the node popup gains an UPGRADE button — spend energy to raise a
  node's level (more damage, bigger glyph, level pip). Now late-game energy has a deep
  sink, so you can go *taller* instead of only *wider*.

## Harmonic backbone — making the music actually evolve (run 9, 2026-06-25)

**Gap:** the core promise is "every battle composes its own music," but the build had
node notes locked to a single static A-minor pentatonic scale with **no harmonic motion** —
every run, start to finish, sat on one implied chord. Consonant, but not a *song*. The
hook (#1), aesthetic identity (#6), shareable artifact (#7) and sensory payoff (#10) were
all leaving value on the table.

**Solution — a chord progression underneath the pentatonic melody.**
- `js/harmony.js` (pure): six named four-chord **progressions**, each **diatonic to A
  natural minor** so the existing pentatonic node melodies stay consonant over every chord
  (the classic "minor pentatonic over a I–VI–III–VII loop always works" trick). A run picks
  one by **seed**, so each run is its own song (and the daily challenge's song is fixed for
  everyone that day).
- Each chord holds **2 bars**; on turnover a **pad swells** and the board **flashes the
  chord's colour**. A **bassline** plays the chord root on the bar's strong beats. The
  pentatonic notes are unchanged — the harmony is *added underneath*, never fighting them.
- **Why this and not "let players pick chords"?** Keeping harmony automatic + seeded
  preserves the low floor (#2): the player still only thinks about rhythm/placement, but
  what they hear is now a structured, moving piece. Expression stays in the rhythm layer
  (where Design problem #2's whole economy lives); harmony is the always-good bed under it.
- **Shareability:** the song's name (♪ AURORA, ♪ TIDAL…) rides along on the run summary,
  the share card, and the game-over screen — a tiny identity tag that makes two runs feel
  different at a glance and gives the clip something to caption.

## Design problem #2 — "fill every beat" is the dominant strategy (THE BIG ONE)

**Problem (user-identified):** the objectively best play is to set every node to fire on
*every* step (there's even an "all" button, `game.js:684`). `doFire` damage scales only
with how many beats fire; the Groove multiplier rewards *on-beat* kills, but when you fire
every beat every kill is on-beat — so density wins twice over. The result: the optimal
board is a featureless wall of sound, which **defeats the entire premise** of the game
("compose a living machine that fights to a beat"). Expression and optimization point in
opposite directions; optimization wins; the music dies. This is the most important thing
to fix — without it RESONANCE is just a tower defense with noise on top.

**Root cause:** firing has *only upside*. A note is never a cost and silence is never
worth anything, so there is no in-fiction reason to ever leave a rest. To make rhythm a
real decision, silence must have value — via a cost on notes, a budget on notes, a reward
for musicality, or a target that punishes blanket fire. Four distinct levers:

### Option A — Rests charge / repetition decays (cost is *per consecutive note*)
Each node "charges" while it rests; a hit after rests lands harder (a rested node can crit
×2–3), while firing the same node on consecutive steps suffers damage falloff (1st 100%,
2nd 80%, 3rd 65%…, resets after a rest). 4-on-the-floor on one node becomes weak; punchy
syncopated patterns with space hit hardest.
- *Pros:* silence is literally power; teaches real musical phrasing (rests, syncopation);
  per-node and local, no new global UI; cheap to implement on top of `doFire`.
- *Cons:* mostly fixes *single* nodes — a player could still fire every beat using many
  nodes each on different sparse patterns (which is arguably the *desired* outcome: dense
  music made of interlocking sparse parts, i.e. real composition).

### Option B — Note budget / polyphony cap (scarcity of notes)
A global, upgradeable budget of active note-slots per bar across the whole board (a
"conductor's baton"). You literally cannot make everything fire every beat; you allocate a
scarce number of notes across nodes and time — exactly like scoring for limited
instruments.
- *Pros:* hard structural fix; turns the board into a genuine composition/allocation
  puzzle; very legible ("notes: 23/30"); pairs naturally with meta-progression (buy more
  voices).
- *Cons:* the most restrictive of the four; risks feeling like a leash on the power
  fantasy if the budget is stingy; needs a clear, well-tuned UI and growth curve.

### Option C — Groove rewards *musicality*, not density (make the score target BE music)
Rework the multiplier so it fills from rhythmic *interest* — syncopation, pattern variety
across nodes, hitting accents (downbeats) vs offbeats, call-and-response — and **decays
toward 1× when the board flatlines into monotony** (everything on, every beat). A wall of
sound becomes mathematically the *worst* multiplier, not the best.
- *Pros:* aligns the optimization target with the fantasy directly — "play more musically"
  literally becomes "deal more damage"; no nerf to raw mechanics, purely additive scoring;
  most thematically on-the-nose.
- *Cons:* "musicality" must be defined as a concrete, gameable metric and tuned carefully
  so it's intuitive (a black-box multiplier feels arbitrary); needs good feedback so the
  player *sees* why monotony is punished.

### Option D — Rhythmic enemy shields / vulnerability windows (the target fights back)
Enemies carry a rhythm: they're shielded except on certain beats (or a boss "conducts" a
pattern you must counter). Blanket fire wastes most shots on shields; you want to place
notes *on the beats the enemy is open*, or build a polyrhythm that lines up.
- *Pros:* makes rhythm a combat *puzzle*, not just a self-imposed style; great for boss
  design and readable tells; "fire every beat" becomes actively wasteful, not just neutral.
- *Cons:* the most complex/risky; needs clear telegraphing or it reads as random; can feel
  punishing/fiddly if windows are tight; biggest implementation + balance surface.

### Recommendation (mine, pending user)
**C as the backbone, A layered on top.** C realigns the *goal* of the game with its
fantasy (the thing you optimize literally becomes "make good music"), and A gives that goal
teeth at the per-node level so the moment-to-moment play teaches phrasing. Both are additive
and low-risk. B and D are stronger structural/puzzle fixes but riskier and better as a
follow-up once C+A prove the loop. Final call deferred to user via `cb ask`.

Net effect: more space when you want breadth, a meaningful sink when you want depth.

### DECISION — shipped **C backbone + A on top** (run 5, 2026-06-24)
User: "implement whatever you think is the best fix(es) … while keeping the original
concept." Implemented both recommended levers:

**A — per-node rhythm economy ("silence is power").** Each shooter node tracks
`consecFires` / `restCharge`. A consecutive-fire damage falloff `[1, .78, .62, .52, .46]`
fatigues nodes that fire every step; resting charges a node so its next hit crits
(`+32%` per rest, capped `+128%`). `doFire` takes an `aMod = falloff(consec)·restBonus(rest)`;
bookkeeping runs each `simStep` for every attacking node (relays included, since they
echo). Crit hits play louder
and paint a white halo. *Result:* a spaced syncopated part out-damages a flat wall of
sound per bar (verified in `smoke.js` and `balance.js`).

**C — Musicality gates Groove.** `computeMusicality(G) ∈ [0,1]` scores the board on
sparsity (peak ≈40% fill), syncopation (offbeat balance) and part-variety (distinct
masks). It's smoothed into `G.musicality` and sets `effCap = 1 + (grooveCap−1)·musicality`,
so a monotone all-on board can never climb the multiplier while a composed one reaches the
full cap. Surfaced as a live **RESONANCE %** HUD stat (turns red when low, green when high).

**UX:** the retune popup's old "ALL" trap is replaced with **GROOVE ⟳**, a cycler through
five hand-picked syncopated presets that nudges players toward variety. How-to updated.

**Verification (`tools/balance.js` A/B):** same seeds, all nodes forced all-on vs forced
sparse-syncopated — sparse reaches further and scores ~4× higher, winning ≥ on 13/14 seeds.
"Fire every beat" is no longer optimal; composition is. Default node patterns are already
sparse/syncopated, so a player who never opens the retune popup is rewarded by default.
Tests: smoke 58 · meta 29 · dom 31 (118 total), all green.

## The Pitch Ladder — turning the board into a real instrument (run 11–12, 2026-06-26)

**Problem.** Until now a node's pitch was just its row, locked to a static A-minor
*pentatonic*. It always sounded fine, but it wasn't an *instrument* — you couldn't play a
melody, a buff couldn't change a note, and "level up" had no musical meaning. The operator
asked, repeatedly, for level/buffs to affect the note and for "a nice combination of both
visuals AND sound." So we rebuilt pitch as a **legible ladder**: a node's note is the sum of
contributions you can read and steer, and every contribution is consonant in key by default.

**The model.** Scale is now A *natural minor* (7 notes — melody-capable, still single-key
consonant). A node's note:

```
degree(n) = rowToDegree(row) + TYPE.degOff + (level − 1) + PITCH
semitone  = scaleDegreeToSemitone(degree, A-minor) + ACCIDENTAL + KEY_OFFSET(12)
            + 12 · (OCT + buffOctaves(G, n))
freq      = 110 Hz (A2) · 2^(semitone / 12)
```

New per-node compose controls (all in the retune popup, each re-plays the note live):

- **PITCH ▼/▲** — free scale-step transpose (the operator's "move it down").
- **OCT ▼/▲** — clean octave jump (pitch-class preserved).
- **♭ / ♮ / ♯** — ±1 semitone for chromatic notes (this is what lets the board spell D#/G#).
- **LEVEL ▲** — still buys damage, *and* now raises the note one scale step. To forge a
  *powerful low voice*: level for power, then PITCH ▼ to drop it back down.

**Buffs are octave-based on purpose.** Only level / PITCH / ACCIDENTAL change pitch-*class*
(deliberate composition); every *buff* effect moves whole octaves so it can never sour a
tune. An adjacent **Amplifier** lifts +1 octave (cap 2); a singing board (**RESONANCE ≥ 75%**)
lifts one more — the "**resonance lift**", so playing well literally makes the machine soar.

**You can see the melody.** Node render tints hue + brightness by pitch (octaves cycle the
wheel), so the arch of a melody is legible on the board at a glance — the requested
combination of visuals *and* sound.

**MAESTRO now composes in space too.** `symmetryScore(G) ∈ [0,1]` rewards mirror-paired nodes
across the centre column; `autoArrange` adds a call-and-response strategy, sets a symmetric
**pitch arch** (equal distance from centre ⇒ equal pitch), and scores candidates by
`blend = 0.7·musicality + 0.3·symmetry`. A tidy, mirrored layout now sounds as composed as it
looks — position becomes music.

**Proof it's a real instrument: Für Elise.** `tools/furelise.js` builds a board that spells
the recognisable opening phrase (E5 D#5 E5 D#5 E5 B4 D5 C5 A4 …) purely with the player-facing
controls, runs the live simulation, and asserts every fired frequency matches equal-tempered
concert pitch (A4 = 440 Hz) within 0.5 Hz. `FUR-ELISE.md` is the human walkthrough — which
cell/row/level/pitch/octave/accidental each note needs, and how a fast line is spread across
the 8-step bar by staggering nodes' beats. If a 200-year-old melody plays in tune, the ladder
is sound. Tests: smoke 101 · meta 41 · dom 53 · furelise 8 — all green.

## The Smooth Blend — pitch = colour = tone = damage (run 13, 2026-06-26)

**Problem.** After the pitch ladder shipped, the operator's verdict was blunt: *"changing
pitch doesn't actually do anything"* mechanically — it was audible and visible but it didn't
*matter* to combat. Blend the three layers (visuals, sound, gameplay) so a single quantity
drives all of them. The fix: make **pitch one number read three ways**.

**The model.** Every enemy is now *tuned*. On spawn it's assigned a pitch class `e.pc` drawn
from the live chord (`Harmony.chordPitchClasses`) and **coloured by it** via `pcColor(pc)`,
the exact same hue space nodes glow in. A node's pulse already carries its note — we attach
`p.note` / `p.pc` to the projectile. On impact:

```
damage = base × consonance(p.note − e.pc)
```

`consonance(interval)` indexes a 12-entry chromatic table (`CONSONANCE`, `js/util.js`) that
is the real consonance ordering: **unison/octave = ×2.5** (a *RESONANT* shatter), perfect
fifth/fourth strong (~×1.7–1.8), **minor 2nd / tritone = ×0.5** (a *DISSONANT* glance). So:

- A pulse whose note **matches** an enemy's colour shatters it — bright ring in the enemy's
  own colour, a bell rung at its pitch, ×1.5 score, +groove, a "♪ +N" float.
- A clashing note barely scratches — a dull grey shield clink (`e.dissFlash`).

**Why this blends all three.** Colour you *see*, the bell you *hear*, the damage you *feel* —
all three are the same pitch interval. A monotone board can only efficiently kill **one
colour** of enemy; a varied **rainbow board playing a real chord** covers the whole swarm.
Pitch went from cosmetic to the central combat decision.

**Tuning.** The table's mean is held at **≈1.2**, so average damage (hence overall difficulty)
is essentially unchanged from pre-blend — the mechanic redistributes damage by skill rather
than inflating it. New `js/util.js` exports: `pitchClassOf, consonance, CONSONANCE, pcHue,
pcColor` (`pcHue` walks the circle of fifths so consonant pitches sit at *similar* hues — the
colour wheel itself teaches which notes get along).

## The leak fix — why "rainbow" finally beats "mono" (run 14, 2026-06-26)

**Problem.** The first consonance table (`[2.5, 0.5, 0.7, 1.35, 1.45, 1.7, 0.55, 1.8, 1.4,
1.3, 0.7, 0.5]`) *told* the right story but failed its own A/B proof: a **monochrome board on
the root note out-survived a varied rainbow board** (rainbow won only ~7/14 seeds). The cause
was subtle and worth recording. Enemies are tuned to the live chord's tones, and a chord is by
definition *internally consonant* — so a board parked on the **root** meets its own chord's
third and fifth at a 6th (×1.3) and a 4th (×1.7): comfortably lethal. The old curve's plateau
**rose up to meet exactly the intervals a one-note board uses**, so monotony was never punished
in combat — only by the (softer) Resonance/groove system.

**The shape, not the mean.** The fix was to keep the mean at ≈1.2 but **collapse the plateau**:
a tall unison spike (×3.3) over a low, flat field where even the chord-internal 4th and 5th are
weak (`[3.3, 0.58, 0.8, 1.5, 1.55, 0.98, 0.63, 1.2, 1.5, 0.98, 0.8, 0.58]`). Now a mono-root
board shatters the root-coloured *third* of the swarm but meets the other two thirds at a
4th/6th ≈**0.85–0.98×** — too soft to stop them, so they **leak to the Core**. A board that
spreads its notes across the scale answers every colour and survives. The averages of the two
strategies are nearly identical; the difference is entirely in **leak variance** — which is the
honest mechanical meaning of "you need variety." With the reshape *and* a smarter test (rainbow
now covers the scale's pitch classes, the colours enemies actually wear, instead of a wasteful
chromatic spread over all 12), `tools/balance.js` proves **rainbow ≥ mono in 14/14 seeds** and
**sparse ≥ all-on in 14/14** — both theses clean.

## The Shifter — a moving colour target (run 14)

A seventh enemy, the pentagonal **`shifter`** (hp 34, spd 33, from wave 6 at ~12%), **re-tunes
its own pitch class every 2.6 s** while alive — recolouring to the next chord tone, with a
rotating dashed "tuning" halo that flares (`shiftFlash`) on each flip. The note that shattered
it a beat ago now glances off, so a single perfect note can't hold it; only a board that
*already covers several colours* always has the answer ready. It's the leak-fix mechanic made
flesh — variety stops being a balance proof and becomes a thing on the screen chasing your Core.
Critically the re-tune **cycles the chord deterministically** (`shiftIdx++`, no `G.rng` draw) so
it never desyncs the seeded stream or the A/B arms. Tests: smoke 119 · meta 41 · dom 58 ·
furelise 8 — 226 green.
