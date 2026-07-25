# Phase 2 audit — Nord Stage 4 73 (Piano library and Layer Effects)

Variant: `stage-4-73`. Specs read in full: `specs/nord-stage-4.visual.json` v1.2.0,
`specs/nord-stage-4.piano.json` v2.0.0, `specs/nord-stage-4.effects.json` v2.0.0.
Manual pages used: 23–26 (Piano) and 48–53 (Layer Effects, Rotary).

Phase 1's audit (`evidence/stage1-visual-audit.md`) still stands for the geometry: this phase did
not move the chassis, the section fractions, the keybed or any control position. What follows is
what I measured, changed and checked *this* phase. Every number below is either measured off the
running app, measured off a rendered audio signal, or declared as a deviation. Nothing here
describes behaviour that is not implemented.

---

## 1. Surface changes, and what was checked against Phase 1

Only one control was added to the deck: **`piano.sustped`** (147 controls, up from 146). The
piano spec requires a per-layer SUSTPED routing toggle; Phase 1 had drawn SUSTPED and PSTICK as
inert LED legends in the layer column. The SUSTPED cell now carries a real button next to its LED,
in the same cell, at the same place. PSTICK stays an LED only, because nothing bends pitch yet.

Indicators that were static in Phase 1 and now report real state (no layout change):

| Indicator | Now shows |
| --- | --- |
| Piano layer A/B ON LEDs | the actual layer on/off state (they were hard-coded lit) |
| Piano layer letter A/B | focus highlight on the focused layer |
| OCTAVE SHIFT legend | the focused layer's shift, e.g. `+1`, when it is not zero |
| PIANO SELECT model line | the selected model's name, e.g. `Concert Grand YDP` |
| FX Focus Piano GROUP LED | group mode on/off |
| Delay / Comp / Reverb GLOBAL LEDs | that unit's global mode |
| COMP ACTIVE LED | the compressor being switched on with Layer Effects on |
| ROTARY SPEAKER ON LED | some layer actually being routed into the rotary via To Rotary |
| Program OLED | focused layer, type, model name, octave, and whether the sound is recorded, the fallback, or synthesis |

Two CSS changes touch the whole deck, both about pointer targets rather than looks (section 4
explains what they fixed): decorative elements no longer take pointer events, and the dense
plates show their own controls instead of clipping them, with controls painting above the plate
boxes. Nothing moved: the section fractions, plate boxes and control positions are Phase 1's, and
no control or plate extends beyond the chassis (measured: 0 elements outside the instrument box,
no horizontal page scroll).

Regression checks I ran by hand in the browser at 1472x642 and at 390x844: one continuous
chassis, rail attached, keybed full width, no horizontal scroll, no clipped section, no overlap
introduced by the new SUSTPED button or the new legends. The automated Phase 1 regression tests
(`src/components/regression.test.tsx`, `surface.test.tsx`) cover the 1440x900 and 390x844 cases
and are green.

---

## 2. Sample library: what I measured

The three recorded sets are built by `tools/build-samples.py` from named upstream releases
(YDP-GrandPiano CC BY 3.0, UprightPianoKW CC0, FluidR3 Rhodes MIT) and are listed file by file in
`src/audio/sampleManifest.json`.

| Set | Files | Root notes | Range | Worst stretch | Velocity layers | Size |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| Grand | 28 | 14 | MIDI 27–105 | ±3 semitones | 2 (split at 80/81) | 4.06 MB |
| Upright | 30 | 17 | MIDI 27–105 | ±3 semitones | 2 (split at 80/81) | 3.80 MB |
| Electric | 13 | 13 | MIDI 24–96 | ±4 semitones | 1 | 1.40 MB |

- Every note on the 73-key bed (MIDI 28–100) is within 4 semitones of a recorded root; a test
  walks the whole keybed and asserts it.
- The build script measures each sample's pitch class by autocorrelation and fails the build if it
  is more than 0.75 semitones from the declared root. It verified 20/28 grand, 23/30 upright and
  11/13 electric files; worst measured drift 0.35, 0.11 and 0.05 semitones respectively. Outside
  MIDI 30–84 the estimator is not dependable (weak fundamentals low down, too few samples per
  period high up), so those roots rest on the upstream metadata and the manifest records them as
  unverified rather than pretending they were checked.
- Distinctness was measured, not assumed: rendering the same note through each set and comparing
  the signals gives a relative difference above 0.5 for all three pairs (Grand/Upright,
  Grand/Electric, Upright/Electric). All six types are pairwise distinct above 0.25.

---

## 3. Audio measurements behind the control claims

All measured on rendered signals from the offline renderer (`src/audio/offline.ts`), at 16 kHz
except the spectral tests, which run at 32 kHz so the bands sit clear of Nyquist. The master level
is turned down in the effect tests so the master limiter is out of the measurement path.

| Control | What was measured |
| --- | --- |
| KB Touch | same 0.45 stroke: Heavy < Normal < Light in rendered RMS |
| Dyn Comp | soft stroke +50% or more at level 3; loud/soft ratio narrows against Off |
| Timbre | Soft cuts 2.2–6 kHz to under 70% of Off; Bright lifts it above 140%; Mid lifts 0.9–1.8 kHz; Dyno 2 on an electric lifts 2.8–6 kHz above 130% |
| Unison | detuned copies beat: windowed-RMS spread rises against Unison Off; relative difference > 0.2 |
| Soft Release | released-note tail gets longer; on a Clav type it is unchanged, as the spec requires |
| String Res | pedal down with two notes held: signal differs and RMS rises; a single note with no pedal is bit-identical to String Res off |
| Master Level | 0.8 vs 0.2 gives more than 3x the RMS; zero renders digital silence |
| Section On | off: no voice is built and the render is silent |
| Mod 1 / Mod 2 | six types each, every one differs from dry and from each other; A-Pan swings the stereo image by >30% imbalance; Tremolo at amount 0 is bit-identical to dry |
| Delay | feedback 0.95 still ringing at 2–3 s where feedback 0.1 has gone; 1.0 s tempo leaves a silent gap the 0.06 s tempo fills; LP repeats keep their low end, HP repeats lose it; later repeats are duller than earlier ones (each pass through the filter), while the dry attack is identical between filters |
| Amp Sim/EQ | five tone types pairwise distinct; Small has ≤85% of the Twin's 60–200 Hz energy; ±12 dB on each band moves its own band by ≥1.3x; drive lowers the crest factor |
| Compressor | body-to-tail ratio drops to ≤85% at full amount; the loud/soft stroke ratio narrows; the curve never exceeds unity gain |
| Reverb | late (1.6–3.6 s) energy of a released note grows Booth < Room < Hall < Cathedral; Bright tail has more 1.5–5 kHz than Dark; fully wet at max softens the attack; every type differs from every other |
| Rotary | Slow vs Fast differ and Fast has more level swings per second; drive lowers the crest factor; a speed change ramps (the horn LFO frequency glides over ~1.1–1.4 s) |
| Layer Effects On | with all six units on, bypassing everything is bit-identical to having no unit on |

---

## 4. Flows I exercised by hand in the browser

Served the production build (`vite preview`, Chrome, 1472x642 then 390x844):

1. Load, press **Start audio** — status goes to "Audio engine running", then
   "Recorded sample sets ready"; 28 grand files fetched, all 200.
2. Click a key — plays, Program OLED shows `PIANO A · GRAND / CONCERT GRAND YDP /
   RECORDED SAMPLES`.
3. **Reverb On** — button reports `aria-pressed=true`, LED lights.
4. **Piano Type → Upright** — the upright set fetches and loads, the OLED switches to
   `UPRIGHT / UPRIGHT KW`, still `RECORDED SAMPLES`, no fallback.
5. **Layer B On** — focus moves to B, the FX Focus Piano LED follows, and B's panel shows B's own
   bank: still Grand, reverb off, while A keeps Upright with reverb on.
6. **Amp Sim type → To Rotary**, then **Amp Sim/EQ On** — the ROTARY SPEAKER ON LED lights, and
   only while a layer is actually routed there (it is dark with the type on Twin).
7. Computer keyboard and the on-screen sustain button behave as in Phase 1.
8. Console: no errors, no warnings, at any point in the pass. Network: no failed requests.
9. Hit-test sweep over the whole deck (below) at 1472x700 and 2400x1000: every one of the 147
   controls and all 73 keys receive the pointer at their own centre.

**Two real bugs this pass caught.**

*Unclickable controls.* Sweeping every control with `document.elementFromPoint` at its own centre
found eight controls that could not be clicked at all — six of them functional in this phase:

```js
for (const control of document.querySelectorAll('[data-control-id]')) {
  const box = control.getBoundingClientRect()
  const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
  if (!(hit === control || control.contains(hit))) console.log(control.dataset.controlId, hit)
}
```

Three causes, all inherited from Phase 1 where every panel control was decorative and nobody
could tell: decorative overlays (the chassis cheeks, knob caption boxes, silk-screen legends) sat
on top of controls and swallowed the pointer; the densest Layer Effects plates laid their rows a
few pixels wider or taller than the plate, and `overflow: hidden` clipped the Mod 1 On, Amp Sim
type, Delay Tap, Delay Dry/Wet and Delay On buttons out of existence; and in the Program section
the SHIFT plate was drawn on top of the MON/COPY button while the Organ header's Section On
button sat outside its own slot. Fixed by making decorative elements `pointer-events: none`,
letting plates show their own controls instead of clipping them, painting controls above the
plate boxes, and shortening the Program edit group so SHIFT no longer covers MON/COPY. The sweep
now reports zero. This is a hit-testing property, so it is verified in a real browser: jsdom has
no layout engine and could not catch it.

*Sample URLs.* The first browser run reported "Sample set grand failed to load".
The network log showed `GET /samples/grand/D → 200`: file names contained `#` (as in `D#1`), which
a URL treats as a fragment, so the request was truncated and the decode failed — a bug the
disk-based tests could never see. Fixed at the source: the build script writes sharps as `s`
(`Ds1_27_v80.wav`), and the loader percent-encodes file names as well. Re-ran the pass: all three
sets load.

---

## 5. Known deviations

1. **The effects are approximations built from standard Web Audio nodes**, not models of Clavia's
   DSP. Reverbs are comb/all-pass tanks (Spring gets a band-pass and a longer all-pass chain for
   its boing); the three amps are drive curves plus voicing filters, distinct from each other but
   not measured against real cabinets; the compressor is a rectifier/low-pass envelope follower
   driving a gain node, with the make-up gain after the reduction.
2. **String Res is simulated**, as the spec permits: a bank of four damped comb resonators tuned to
   the notes currently held, opened only while the pedal is down or another note is held. It is not
   pedal-down sample recordings.
3. **Compressor attack.** The envelope follower is two 55 Hz poles (~5 ms). A piano's hammer
   transient is faster than that, so the very first peak passes through less compressed than the
   body of the note — real-compressor behaviour, but it means the crest factor is not the right
   measure of it, and the tests measure the body-to-tail ratio and the soft/loud stroke ratio
   instead.
4. **Electric has one velocity layer.** The upstream Rhodes set has a single recorded stroke per
   root, so velocity moves gain and filter cutoff rather than selecting a different recording.
   Grand and Upright have two recorded strokes each.
5. **Sample tails are trimmed** to between 1.25 s and 3.4 s depending on pitch, with a 0.28 s
   fade-out, to keep the bundle at 9.3 MB. A very long held bass note therefore decays faster than
   the real instrument's string would.
6. **Timbre is a two-biquad stage**, not the instrument's per-model voicing tables. The Dyno
   settings are a bass/treble preamp lift, stronger on Dyno 2.
7. **A second model per recorded type is a voicing of the same recordings** (Mellow, Close,
   Bright), not a second instrument, and the model list says so in the model's own note. The
   MODEL dial stops at the last model the selected type has rather than counting up through
   positions that would select nothing; Clav, Digital and Misc have one model each.
8. **Octave shift travel is ±12 semitones** (one octave each way) per layer, matching the piano
   spec's `octave shift ±12 semitones`.
9. **SUSTPED is one focus-scoped button**, not a button per layer row: it edits the focused layer,
   like the rest of the piano and effect controls. The hardware prints an indicator on each layer
   row.
10. **The offline renderer used by the tests is not a browser audio engine.** It recomputes biquad
    coefficients once per 128-sample block, and a node inside a feedback loop reads the previous
    block (which is what real Web Audio does, with the same one-quantum latency). Absolute sample
    values in a browser will differ; the tests assert relationships, not waveforms.

## 6. Still unimplemented, and honestly declared

These controls move, light and report their value, and are wired to nothing. They are listed in
`FUNCTIONAL_CONTROL_IDS` in `src/model/controls.ts` by their absence, rendered with
`data-functional="false"`, and asserted inert by test.

- **Every Organ, Synth and Program control** — those sections are Phase 3.
- `fx.delay.effects` (Chorus/Vibe/Ensemble/Flam/Space in the delay loop) — excluded by the effects
  spec.
- `fx.focus.organ`, `fx.focus.synth` — no engine to focus until Phase 3. The all-effects bypass is
  on the Layer Effects ON button, which does work.
- `perf.rotary.source` (Organ / Close Mic) and `perf.rotary.stop-mode` — organ routing is Phase 3,
  close mic and stop angle are spec-excluded, and rotary stop mode is spec-optional and not
  implemented.
- Rotary speed position **Morph** — morph sources are Phase 3, so this position holds the current
  speed instead of pretending to follow a wheel.
- `perf.pitch-stick`, the PSTICK indicator and `perf.mod-wheel` — no section is bent or modulated
  yet.
- The **Comp FAST** indicator — this panel carries no button for it, and nothing else on the deck
  was borrowed to fake one.
- Per-type **Variation** buttons and Reverb **Chorale**, Delay **Ping Pong** and **Analog**, Mod 1
  **Pump/Wah pedal modes** — spec-excluded or optional; the printed legends stay dark.
- Piano **INFO** view, model **LIST** view, piano size classes and the preset library — spec-
  excluded.
- Soft and sostenuto pedals — not implemented, and not approximated. Only the sustain pedal exists
  (UI button, computer keyboard, MIDI CC64).
