> Moved here from the Étude 6 working folder, where the files lived under `midi/` and the generator was `scripts/etude6-dynamics.mjs`. In this folder, everything sits side by side and the generator is `etude6-dynamics.mjs`. The video uses the v5 files: `glass-etude-6-v5-yuja-form-keybed.mid` for audio and `glass-etude-6-v5-yuja-form.mid` for the picture.

# Glass Étude No. 6: MIDI v2 and v3

- **v2** (`glass-etude-6-v2.mid`): my dynamics plan, based on the structure of the MIDI. Details start below.
- **v3** (`glass-etude-6-v3.mid`, `glass-etude-6-v3-yuja-form.mid`): dynamics and tempo measured from Yuja Wang's recording. See [v3](#v3-after-yuja-wang).
- **v4** (`glass-etude-6-v4.mid`, `glass-etude-6-v4-yuja-form.mid`): v3 re-measured on a beat-tracked grid, with a tempo change every bar, wider dynamics and humanized timing and articulation. See [v4](#v4-beat-level-pass).
- **v5** (`glass-etude-6-v5[-yuja-form][-keybed].mid`): v4 plus sustain pedal estimated from her recording, a smooth tempo curve, smooth dynamics and correlated timing drift. **This is the current best version.** Use the `-keybed` files with `record-take.mjs`. See [v5](#v5-pedal-and-smoothing).

---

# v2 (dynamics and phrasing)

**Output:** `midi/glass-etude-6-v2.mid`
**Generator:** `scripts/etude6-dynamics.mjs`. Run `node scripts/etude6-dynamics.mjs` to rebuild. The output is deterministic because the jitter is seeded.
**Use:** local demo only. The piece is under copyright, so don't upload or publish this file.

## Before / after

| | v1 `glass-etude-6.mid` | v2 `glass-etude-6-v2.mid` |
|---|---|---|
| Duration | 282.91 s | 283.45 s (+0.54 s from breaths and the final rit.) |
| Notes | 5590 | 5590 (pitches and onsets identical, verified) |
| Velocity min / median / max | 7 / 50 / 66 | 12 / 71 / 113 |
| LH (`Grand Piano`) | 38 flat | 62 median, range 12–90 |
| RH (`Grand Piano 2`) | 50 flat | 80 median, range 12–110 |
| Octave hits (`Grand Piano 3`) | 66 flat | 97 median, range 82–113 |
| Tempo | 196 bpm constant | 196 bpm with 34 small changes (see below) |

## Sources compared

- `midi/glass-etude-6.mid` and `midi/philip-glass-etude-6-download.mid` are **byte-identical** (same SHA-1). I only had one source to work from.
- There was no score in `midi/score/`, and I didn't fetch one from the web. The phrasing comes from the structure of the MIDI itself: its 8-bar phrases, 2-bar harmonic units and the textures in each section. The dynamic plan below is my interpretation and was not copied from printed markings. If a score is added later, update the `SECTIONS` table in the script to match its markings and re-run.

## What the source looked like

The file looks like a notation-software export. It has 3/4 at quarter = 196, three tracks, and every note in a track has the same velocity. The only exception is a written fade in the last bar. There are no CCs, pedal or pitch bends. I checked for artifacts and found no zero-length notes, no stacked duplicates at the same pitch and onset, and no overlapping same-pitch notes. So there was nothing to clean up. The 42 back-to-back same-pitch restrikes (for example, a hit-layer F3 ending exactly when the LH F3 starts) are legitimate. `record-take.mjs` sorts note-offs before note-ons at the same time, so they replay cleanly.

Track roles:
- **Grand Piano (LH):** broken-chord eighths (dyad, top note, dyad, …) from F3 to C4. This is the constant ostinato.
- **Grand Piano 2 (RH):** the figure changes by section: repeated staccato eighths, triplet arpeggios, a stepwise oscillation or a scale figure.
- **Grand Piano 3:** a downbeat layer used only in the "C" sections. It plays a bass octave in the low register plus a high octave, or a chord, on beat 1 of every other bar.

## Form (inferred)

Every section is built from 8-bar phrases, starting at bar 5.

| Bars | Section | Dynamic plan (RH velocity) |
|---|---|---|
| 1–4 | Intro: LH ostinato alone | p (48→52) |
| 5–20 | A1: RH enters on repeated F | p → mp |
| 21–36 | A1: RH line rises to C5/C#5 | mp → mf |
| 37–52 | B1: triplet arpeggios | mf, growing |
| 53–68 | C1: octave hits | f |
| 69–100 | A2: opening material returns | subito mp → mf |
| 101–116 | B2 | mf → f |
| 117–132 | C2 | f |
| 133–148 | D1: new harmony (F / E-aug / D7 / C7), F–G oscillation | subito mp → mf |
| 149–164 | D1: five-note scale figure | mf → f |
| 165–180 | C3 | f → nearly ff |
| 181–196 | B3 | drops back to mf, then builds |
| 197–212 | C4 | f |
| 213–228 | D2 | mp → mf |
| 229–244 | D2: scale figure | long crescendo to ff |
| 245–260 | C5 | **ff: the climax** |
| 261–276 | B4 | f → mf, receding |
| 277–292 | A3: rising line | mf → mp |
| 293–308 | Coda: repeated F | p → pp, then the source's own final-bar fade |

## Dynamics strategy

The main interpretive choice is **terraced dynamics between sections, with gradual changes inside them**, which suits Glass's block-repetition writing. Each section interpolates between its start and end levels bar by bar. The returning material (A2, D1, B3, D2) drops back down, so the piece builds in waves, and the largest wave peaks at C5.

Several smaller layers sit on top of the section levels:
1. **Phrase arc:** each 8-bar phrase swells toward bar 6 and eases on bar 8, the dominant (E–G–Bb) bar that turns back to F (−2 … +3).
2. **Hypermeter:** the first bar of each 2-bar harmonic unit gets +1.
3. **Metric weight:** beat 1 gets +5, beat 3 +2 and beat 2 +1. Off-beat eighths and inner triplet notes get −2, so the 3/4 pulse is audible without accents.
4. **Hand balance:** the LH plays at about 80% of the RH level so the RH figures sit on top. In the intro the LH is alone and plays at full level.
5. **Voicing:** in RH octaves and chords, the top note gets +2 and the others −2. In LH dyads the bass note gets +2. RH notes also get a small pitch-contour term (±3 at most), so scale runs and arpeggio tops rise slightly.
6. **Octave-hit layer:** the bass octave plays at the section level +8 and the high octave at +6, so the hits land as accents.
7. **Humanization:** ±2 velocity jitter from a seeded PRNG, so repeated notes aren't machine-identical.
8. **Clamp:** velocities stay between 24 and 118. The recorder maps velocity to pointer `pressure` with a floor of 0.2, which is about 25, so anything quieter can't be heard in the keybed demo anyway. Only the final-bar fade goes below 24, down to 12.

## Phrasing and timing

- **Onsets and pitches are untouched.** I didn't requantize, because the source is already on the grid.
- **Breaths:** on the last beat before most section changes, the tempo eases to 90–96% and then snaps back to 196 on the downbeat. The deepest breaths (90%) come before the subito drops at bars 69, 133, 181 and 213. The RH notes on that beat are also shortened to 70% of their length, so the phrase lifts off. 34 notes are affected in total.
- **Final ritardando:** bars 305–308 slow to 194, 190, 184 and 176 bpm, under the existing fade.
- **No sustain pedal and no CCs.** The source had none, and pedal would blur the ostinato. The recorder doesn't read CCs either.

## Adjusting it

All the interpretive choices live in the `D`, `SECTIONS`, `PHRASE_ARC` and `RIT` tables at the top of the script. If the subito drops feel too steep, raise the `a:` values for A2, D1, B3 and D2. If the demo clips feel too loud overall, lower `D`.

## Demo notes

- Recorded clips are 20–30 s long, so they cover roughly bars 1–30: the p intro, the RH entry and the start of the rising line. That stretch has a gentle crescendo from about 48 to 70 in the RH.
- **I did not repoint `midi/etude6.mid`.** It still points to v1, because the video work in progress (the `etude6-opus55` session) records from it, and switching files between takes would make the stitched pairs inconsistent. To use v2, set `MIDI_PATH=midi/glass-etude-6-v2.mid` for a single run, or run `ln -sf glass-etude-6-v2.mid midi/etude6.mid` once the video pairs are finished.

---

# v3: after Yuja Wang

**Source:** Yuja Wang's performance, from the YouTube upload `pjizB3A5g_0` ("Romantic Scores", 162 s). I pulled the audio into a temporary folder, measured it and then deleted it. The only thing kept is `midi/yuja-profile.json`, which holds per-bar loudness and tempo numbers. The video also shows the score, but I didn't capture any frames, in line with the brief's no-score-from-the-web rule.

**Method.** I split the audio into bars using the 8-bar harmonic cycle (F → F/C# → C → Eb → E°, about 7 s each). The cycle boundaries come from where the chroma changes from the E chord to F. I identified each cycle's section from its chord content, loudness, triplet onsets and high-register octave hits. Then I measured each bar's loudness, corrected it for how many notes that bar has in the MIDI, and converted it to velocity at 2.4 velocity steps per dB around mp = 60. Bars she doesn't play borrow the shape of a same-type passage she does play. As a check, cutting the MIDI to her form and applying her tempos gives 159.7 s, against about 159.6 s from her first note to her last bar.

## What she does, and what v3 copies

| Idea | Her recording | v2 | v3 |
|---|---|---|---|
| Form | 180 bars. She plays bars 1–76, 85–92, 101–108, 117–180, 261–268, 277–284 and 301–308, and skips most repeats. | all 308 | all 308; `-yuja-form` has her 180 |
| Tempo | Averages about 203 bpm. Broadens to about 190–196 in the octave-hit sections and pushes to about 213 in the soft middle (D) section. The opening and the returns of the opening material run at 207–214. | 196 steady | per-section tempos taken from her timings |
| Octave-hit sections (C) | Subito f, about 10 dB above everything else. **Every C section is at the same level**, so there's no single climax. The last bar of each 8 is slightly softer. | builds to ff at C5 | flat f terraces, same level each time |
| Rising line (bars 21–36 etc.) | Large swell to the high C#5 in bars 5–6 of each phrase (+6–8 dB), then falls away on bars 7–8. | ±3 arc | her per-bar shape (RH about 49 → 68 → 51) |
| D section (new harmony) | Enters mf and fades over its first 8 bars, then **stays p**, with no crescendo. A slight dip right before the octave hits come in makes their entry sharper. | mp → f crescendo | her shape |
| Intro | LH alone, very soft, about 7 dB under the first A phrase. | p | LH about 44–49, and the RH enters on top |
| Ending | **In tempo, no rit., no fade.** The last phrase grows slightly, the final bar leans on beats 2–3, and then there's a clean release. | rit. + fade to pp | in tempo, +8 on beats 2–3 of bar 308 |
| Breaths | Too small to measure from her audio. | 34 tempo eases | none |

The v2 layers that the recording can't measure are kept: metric weight, LH at 80% of the RH, top/bottom voicing, pitch contour and ±2 jitter.

## Before / after

| | v1 | v2 | v3 (full) | v3 (her form) |
|---|---|---|---|---|
| Duration | 282.91 s | 283.45 s | 273.27 s | 159.69 s |
| Notes | 5590 | 5590 | 5590 | 3234 |
| Velocity min / median / max | 7 / 50 / 66 | 12 / 71 / 113 | 30 / 56 / 98 | 30 / 57 / 98 |

v3 is quieter overall than v2 (median 56 against 71). Most of her performance sits around mp, with the C sections as the exception. To make it louder on the Nord, raise `D.mp` (the centre level) or `VEL_PER_DB` in the script.

## Limits

- The loudness measurements cover both hands together, so the LH/RH balance still comes from v2's rule and was not measured.
- Pedalling and articulation can't be measured from the audio.
- Bar boundaries are interpolated inside each cycle, so bar-level loudness is accurate to about ±1 dB and section tempos to about ±3 bpm.
- The first 5 bars may be misaligned by about a bar, because her loudness jumps at MIDI bar 6 rather than at bar 5 where the RH enters.

Regenerate with `node scripts/etude6-dynamics.mjs --style=yuja [--form=yuja]`. `etude6.mid` still points to v1.

---

# v4: beat-level pass

**Goal:** more dynamic and more natural, closer to her performance, and not locked to the grid. Regenerate with `node scripts/etude6-dynamics.mjs --style=yuja4 [--form=yuja]`. I re-downloaded the audio for this pass, measured it and deleted it again. The new numbers were added to `midi/yuja-profile.json` as the `t4`, `bpm4` and `rel4` fields. v3's fields are unchanged, and v2 and v3 still regenerate byte-identical.

## What's new

**Beat tracking.** A dynamic-programming beat tracker runs on the onset envelope (5.8 ms resolution). Each 8-bar cycle is anchored at its chord-change downbeat and must contain exactly 24 beats. An unanchored first pass drifted by 1–2 beats in the sections where her tempo changes most. The result is 541 beats, and every one of her 180 bars has its own start time.

**Her bar-to-bar tempo** (used directly as one tempo event per bar, lightly smoothed within each phrase, range 182–231 bpm):
- **The octave-hit entries broaden a lot.** The first hit bars drop to about 180–190 bpm, then she speeds back up to about 200–210 over the second 8 bars.
- **She pushes forward after the hits.** The returning A material starts at about 224 bpm, and the D section starts at about 231, then settles to about 212.
- **The ending stays in tempo** at about 210, even speeding up slightly over the last phrase. There's no ritardando.
- **Beats are even within the bar** (each beat is 33.3% ± 1% of the bar), so her rubato happens between bars, not inside them. v4 therefore doesn't stretch individual beats.

**Wider dynamics.** Her per-bar loudness is re-measured on the exact bar grid, which also fixes v3's misaligned opening. It is mapped at 3.2 velocity steps per dB instead of 2.4, so her roughly 20 dB loud/soft contrast comes through:

| | v3 | v4 |
|---|---|---|
| RH per-bar average, softest → loudest | ~49 → ~86 | ~39 → ~98 |
| Overall velocity min / median / max | 30 / 56 / 98 | 26 / 57 / 110 |
| Octave hits | 74–98 | 81–110 |

The intro now matches her: the LH starts very softly, and the RH enters quietly at bar 5 and grows into bar 6. Bar 1 of the upload fades in, so bar 1 is given the same level as bar 2.

**Timing and articulation.** These use a seeded random generator, so the output is identical on every run.
- **Note starts sit slightly off the grid.** Notes that sound together in one hand share one random offset (about ±4 ms), and each note then gets a further ±1.5 ms, so chords spread a little. The RH leads the LH by about 4 ms on average, a common pianist trait. Offsets are clamped to ±15 ms. In practice 95% of notes land within −10 to +5 ms.
- **RH staccato lengths vary** from 85% to 115% of the written length, and RH triplet lengths from 92% to 104%.
- **LH broken-chord eighths** play at 93–101% of their length in most sections and 86–94% in the octave-hit sections, which makes them crisper under the hits.
- **Same-key safety:** after the offsets are applied, every note is released at least 6 ticks before the same key is struck again, in any track. There are 0 same-key overlaps and 0 zero-length notes.

## Checks

- Same pitches as v1 (5590 notes). Only start times (±15 ms), lengths and velocities differ.
- `v4-yuja-form` runs **159.52 s**, against **159.56 s** from her first beat to the end of her last bar.
- `v4` (all 308 bars) runs 272.6 s.

## What I tried and dropped

**Measuring her accents within the bar.** I measured loudness at each eighth or triplet position for every section type. Beats consistently came out quieter than off-beats, which is an artifact: sustained notes ringing into the next position, and triplet positions picking up the LH off-beat eighth. It isn't a real accent pattern, so v4 keeps the generic beat weights (+5 / +1 / +2, off-beats −2).

## Tuning

`VEL_PER_DB` (3.2 for v4) sets the loud/soft contrast, and `D.mp` sets the overall level. The spread of the humanization is set by `HAND` (ms per hand) and the ±15 ms clamp in the "v4 humanization" block of the script. The per-bar tempo comes from `bpm4`; to flatten it, make `yujaSeries(prof, 'bpm4', …)` smooth more strongly.

---

# v5: pedal and smoothing

Regenerate with `node scripts/etude6-dynamics.mjs --style=yuja5 [--form=yuja] [--pedal=baked]`. For this pass I downloaded the audio a third time, measured it and deleted it again.

| File | Form | Pedal | Use |
|---|---|---|---|
| `glass-etude-6-v5.mid` | all 308 bars, 272.6 s | CC64 on all 3 channels | DAW or sampler playback |
| `glass-etude-6-v5-keybed.mid` | all 308 bars | baked into note lengths | `record-take.mjs` / on-screen keybed |
| `glass-etude-6-v5-yuja-form.mid` | her 180 bars, 159.5 s | CC64 | DAW or sampler playback |
| `glass-etude-6-v5-yuja-form-keybed.mid` | her 180 bars | baked | `record-take.mjs` |

## Pedal: what the recording shows

v2–v4 had **no pedal at all**, so every note stopped dead at its written length. I tested several pedal models against her audio:

1. **Fitting whole pedal patterns** (dry; re-pedal every beat, every bar, at each chord change, every 4 bars, every 8 bars; each in full and half depth). Every cycle preferred the longest pedal. That test is biased, though: hall reverb and the piano's slow decay also favour long notes, so this result alone proves nothing.
2. **How fast released notes fade.** I took 130 left-hand releases whose frequency no other sounding note shares. After the key comes up, the pitch fades at a median of about −1 to −9 dB/s, depending on the section, and about 0 ± 3 dB/s in the cleanest cases (the middle section's harmony changes). A damped note in that hall fades at about **−34 dB/s**, measured from the final release of the piece. So the notes keep ringing after release: **she keeps the pedal down.**
3. **Drops at harmony changes.** At 123 harmony-change downbeats, the previous harmony's pitches fade by only **0.4 ± 0.4 dB** across the downbeat. Re-pedalling there would give about 10 dB. So she **does not re-pedal with each bass change.** That contradicts the unsourced summary pasted in chat, which said she times pedal changes to the bass notes.

The measurements can't show where she does change the pedal, or whether she uses half or full depth. v5 therefore uses:
- **A long pedal, changed once per 8-bar cycle** (bars 5, 13, 21, …). It uses legato pedalling: the pedal lifts 8 ticks after the downbeat and goes back down about 45 ms later, so the new downbeat still gets caught.
- **Depth CC64 = 100** (about 79%). Players that support continuous pedal play this as a partial pedal; most samplers treat any value of 64 or more as full.
- **The `-keybed` variant** has no CC. Each note is held until the point where the pedal would lift, capped at 2 bars past its written end. Any key that's about to be struck again is released 6 ticks before the new strike, because the keybed can't re-strike a key that's still down. At most 20 keys are held at once, and 95% of note lengths are under 1.9 s.

If the sustain sounds muddy on a given piano, the obvious knobs are: change the pedal every 4 bars (`b += 8` → `b += 4` in the pedal block), lower `DEPTH`, or shorten the 2-bar cap for the keybed variant.

## Other v5 changes

- **Smooth tempo curve.** There's a tempo event on every beat (924 in total), interpolated between her bar tempos. Inside sections the tempo moves at most about 5 bpm from beat to beat, where v4 stepped at every barline. Steps stay only where she makes them between sections. The largest is 29 bpm at the start of the middle section (bar 133), where she jumps from about 195 to about 225.
- **Smooth dynamics.** Each bar's level is placed at the bar's midpoint and interpolated to each note, so crescendos build through the bar. For example, the RH per beat in bars 23–26 goes 50 → 72. Sudden changes stay only at section boundaries.
- **Correlated timing drift.** Each hand's timing offset now drifts gradually from note to note (an AR(1) process with ρ = 0.9, same ±4 ms spread and 4 ms RH lead), instead of jumping independently on every note.
- **Stronger RH downbeats in the octave-hit sections** (+3 on top of the beat-1 weight). This is the one within-bar accent from the note-level fit that was both significant (+7.5 ± 2.5 dB) and plausible.

## Note-level fit: what didn't work

I fitted every note's loudness to her spectrogram (a score-informed NMF: harmonic templates per pitch, with decay envelopes at her beat-tracked onsets). It explains 72% of the spectral energy, but the per-note loudness estimates are ambiguous. A new strike of a key overlaps the ringing of its previous strike, octave pairs share harmonics, and the left hand's F3 has a harmonic at the right hand's F4. The within-bar offsets came out at ±2–8 dB with some implausible patterns, such as the RH beat 1 7 dB softer than beat 2 in the opening material. Apart from the octave-hit downbeat above, v5 keeps the generic beat weights and v4's hand balance. The fit did confirm that the LH follows the overall dynamics: the same LH keys are about 13 dB louder in the octave-hit sections than in the opening, against about 11 dB for the whole mix.

## Checks

- Pitches are identical to v1; there are no same-key overlaps and no zero-length notes.
- `v5-yuja-form` runs 159.52 s, against her 159.56 s.
- v2, v3 and v4 still rebuild byte-identical, and v5 rebuilds deterministically.
