# Playing "Für Elise" on a RESONANCE board

RESONANCE isn't a music toy bolted onto a tower-defense — the board **is** an
instrument. Every node plays a real, in-tune note, and you steer that note with
the same four controls the retune popup gives you:

| Control | What it does | Für Elise needs it for |
|---|---|---|
| **Row** | top row = high, bottom row = low (one scale step per row) | rough register |
| **PITCH ▼ / ▲** | free transpose, ±1 scale step at a time | landing on the exact degree |
| **OCT ▼ / ▲** | jump a clean octave (pitch-class kept) | the 5th-octave melody |
| **♭ / ♮ / ♯** | bend ±1 semitone (chromatic notes) | the **D#** and **G#** |

The whole phrase is **17 nodes**. `tools/furelise.js` builds exactly this board,
simulates it, and asserts every frequency matches concert pitch (A4 = 440 Hz).

## How a note's pitch is computed

```
degree   = rowToDegree(row) + TYPE.degOff + (level - 1) + PITCH
semitone = scaleDegreeToSemitone(degree, A-minor) + ACCIDENTAL + KEY_OFFSET(12)
           + 12 * (OCT + buffOctaves)        ← buffOctaves = 0 while composing
freq     = 110 Hz (A2) * 2 ^ (semitone / 12)
```

Scale degrees in A natural minor: `0=A  1=B  2=C  3=D  4=E  5=F  6=G  7=A(+8va)`.
So **D# = degree 3 + ♯**, and **G# = degree 6 + ♯**.

## The score, note by note

The famous opening: **E5 D#5 E5 D#5 E5 B4 D5 C5 A4 · C4 E4 A4 B4 · E4 G#4 B4 C5**

Use **Pulsers** (the default melodic voice, `degOff = 0`). Drop them on the bottom
two rows. Because the bottom row is degree 0 by itself, the **PITCH** knob below
*is* the scale degree; the **OCT** knob lifts the upper-octave notes.

| # | Note | Degree (PITCH) | OCT | Accidental | Why |
|--:|:----:|:--------------:|:---:|:----------:|---|
| 1 | E5  | 4 (E) | +1 | ♮ | the hook |
| 2 | D#5 | 3 (D) | +1 | **♯** | chromatic neighbour |
| 3 | E5  | 4 (E) | +1 | ♮ | |
| 4 | D#5 | 3 (D) | +1 | **♯** | |
| 5 | E5  | 4 (E) | +1 | ♮ | |
| 6 | B4  | 1 (B) | +1 | ♮ | |
| 7 | D5  | 3 (D) | +1 | ♮ | |
| 8 | C5  | 2 (C) | +1 | ♮ | |
| 9 | A4  | 0 (A) | +1 | ♮ | the 440 Hz anchor |
| 10 | C4 | 2 (C) | 0  | ♮ | drops to the low octave |
| 11 | E4 | 4 (E) | 0  | ♮ | |
| 12 | A4 | 0 (A) | +1 | ♮ | climbs back |
| 13 | B4 | 1 (B) | +1 | ♮ | |
| 14 | E4 | 4 (E) | 0  | ♮ | |
| 15 | G#4| 6 (G) | 0  | **♯** | leading tone |
| 16 | B4 | 1 (B) | +1 | ♮ | |
| 17 | C5 | 2 (C) | +1 | ♮ | resolves up |

## Spreading a melody across the 8-step bar

One bar is **8 steps** (an eighth-note grid). A single node can only fire on the
steps you light in its beat grid, so a *fast* run of 17 notes is played the way a
real sequencer does it: **stagger the nodes' steps**. Put note 1 on step 0, note 2
on step 1, … wrapping every 8 steps into the next bar, and let each node fire on
its one assigned step. The melody then "walks" left-to-right across the board, one
node lighting up per pulse — you literally **see** the tune travel as you hear it.

(In practice you'd play a slower, loopable motif and let the **MAESTRO** arranger
voice the rest — Für Elise here is the *proof of range*, not the recommended build.
The point: the instrument is real enough to play a 200-year-old melody in tune.)
