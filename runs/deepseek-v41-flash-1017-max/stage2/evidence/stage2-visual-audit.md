# Stage 2 visual and audio audit — Nord Stage 4 73

Every number below was produced by `scripts/capture.mjs` against the production build
(`vite build`, `base: './'`, served by `vite preview`) in Chromium, at the two canonical
viewports, and is stored machine-readably in `evidence/stage2-capture.json`. Audio numbers
come from rendering the **shipped** audio modules in that same browser through
`harness.html`, not from a copy of the DSP.

Reference: `inputs/reference/nord-stage-4-73.jpg` (11600 × 3866), instrument bounds
x 1292, y 410, w 9013, h 2912 → aspect **3.0951** (`specs/nord-stage-4.variants.json`).

Phase 1 evidence is retained unchanged: `evidence/stage1-capture.json`,
`evidence/stage1-desktop.png`, `evidence/stage1-narrow.png`, `evidence/stage1-visual-audit.md`.

---

## 1. What changed on the surface, and what did not

The surface is deliberately unchanged. Phase 2 adds behaviour behind 51 of the 167 controls
and changes only what the two OLEDs *say*, because what they say must now be true.

| | Phase 1 | Phase 2 |
| --- | --- | --- |
| Controls | 167 | 167 (identical IDs) |
| Sections | 6, same order and widths | unchanged |
| Displays | 2 (Program, Synth) | 2 (same locations) |
| Functional controls | keybed + sustain only | 51, listed below |
| Program display | phase, engine, voices | + selected type/model with recorded-vs-modelled, per-layer chips, FX focus, active units, library state |

Functional this phase, by section:

- **Piano (18):** section on, layer A/B on and level, octave down/up, SUSTPED, PSTICK, Soft Release,
  String Res, Unison, KB Touch, Dyn Comp, Type, Model, Timbre.
- **Performance (4):** Master Level, and the Rotary block's on / drive / speed.
- **Layer Effects (29):** Mod 1 (type, rate, amount, on), Mod 2 (type, rate, amount, on), Delay
  (tempo, feedback, dry/wet, filter, ping-pong, on), Amp/EQ (model, drive, bass, mid, freq, treble,
  on), Compressor (amount, fast, on), Reverb (dry/wet, type, tone, on), and the two Piano
  focus buttons (a latched A/B pair).

Everything else — all of Organ (33), all of Synth (35), all of Program (26), the remaining
Piano controls (INFO, zones, PED NOISE), the excluded effect controls (variations, Chorale,
pedal modes, close mic, stop angle), the pitch stick and mod wheel, and the Organ/Synth focus
buttons — still moves or presses and writes only to the presentation store. That set is
named explicitly in `PIANO_CONTROL_IDS` / `EFFECT_CONTROL_IDS`, and
`regression.phase1` asserts the Organ, Synth and Program bands are *entirely* decorative.

## 2. Instrument bounds and viewport occupancy (1440 × 900)

| Measurement | Value | Requirement | Result |
| --- | --- | --- | --- |
| Instrument width | 1365.13 px | — | — |
| Instrument height | 441.05 px | — | — |
| Width fraction of viewport | **0.948** | 0.88 – 0.97 | pass |
| Aspect ratio | **3.0952** | 3.0951 | pass (Δ 0.0001) |
| Page scroll width | 1440 px | no horizontal overflow | pass |
| Page scroll height | 900 px | no vertical scroll | pass |
| Chassis children | deck then keybed | continuous chassis | pass |

No marketing hero, no `<h1>`/`<h2>`, no `<img>` elements: the photograph is not used as a
background.

## 3. Deck / keybed split

| Band | Share of instrument | Required | Result |
| --- | --- | --- | --- |
| Control deck (incl. rear rail) | **0.5400** | 0.54 ± 0.025 | pass |
| Keybed (incl. front rail) | **0.4600** | 0.46 ± 0.025 | pass |

## 4. Section widths and content

| Section | Declared | Rendered | Width | Controls | Displays | Blocks |
| --- | --- | --- | --- | --- | --- | --- |
| performance | 0.14 | **0.1400** | 191.11 px | 11 | 0 | 3 |
| organ | 0.20 | **0.2000** | 273.02 px | 33 | 0 | 5 |
| piano | 0.085 | **0.0850** | 116.03 px | 23 | 0 | 5 |
| program | 0.125 | **0.1250** | 170.64 px | 26 | 1 | 5 |
| synth | 0.25 | **0.2500** | 341.28 px | 35 | 1 | 9 |
| effects | 0.20 | **0.2000** | 273.02 px | 39 | 0 | 7 |

Every section reports `overflowing = 0` and `zeroSized = 0` at both viewports.

## 5. Keybed

| Measurement | Value | Requirement | Result |
| --- | --- | --- | --- |
| Total keys | **73** | 73 | pass |
| White / black | **43 / 30** | 43 / 30 | pass |
| Range | MIDI 28–100 (E1–E7) | E to E | pass |
| White key width | 31.734 px | uniform | pass |
| Black key width | 19.672 px (0.62 × white) | — | pass |
| Black/white height ratio | **0.6099** | 0.61 | pass |
| Keys outside the keybed box | 0 | 0 | pass |

Unchanged from Phase 1; the keybed now fans one press out to up to two layer voices.

## 6. Forbidden hardware

Counted with the `forbiddenDetection` rules at 1440 × 900, unscrolled:

| Rule | Count | Result |
| --- | --- | --- |
| `OLED display` in performance | 0 | pass |
| `OLED display` in effects | 0 | pass |
| `wide OLED display` in organ / piano / synth / effects | 0 | pass |
| `multiple primary displays` in program | 0 | pass (1 display, area ratio 1.0) |
| `drawbar bank` in piano | 0 | pass (2 tall controls, threshold 6) |
| `full dark inset plate` in performance | 0 | pass (transparent background, no painted plate) |
| `generic equal-width control grid` in organ | 0 | pass (11 drawbar-shaped controls) |
| `uniform repeated knob matrix` in synth | 0 | pass (grid pitch irregular) |
| `single undifferentiated control grid` in effects | 0 | pass (7 separately labelled groups) |

One correction was needed in my own measurement: the rule tests a *painted* dark fill, and a
transparent section background reads as `rgba(0,0,0,0)`, which the first version of the
meter wrongly counted as a dark plate. Alpha is now checked. The DOM was not changed.

## 7. Audio library and provenance

Three recorded sets are bundled and loaded from the bundle (no network at runtime). All 235
files are declared individually in `src/audio/sample-manifest.json`.

| Type | Library | Author | Licence | Files | Root notes | Velocity layers | Max playback shift |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Grand | Salamander Grand Piano V3 (Yamaha C5) | Alexander Holm | CC BY 3.0 | 78 | 26 (MIDI 24–99) | 3 | 2 semitones |
| Upright | VSCO 2 CE "Upright Piano" | Simon Dalzell (Ivy Audio) / Versilian Studios | CC0 1.0 | 57 | 19 (MIDI 29–101) | 3 | 2 semitones |
| Electric | Greg Sullivan's E-Pianos — Yamaha CP80 | Greg Sullivan | CC BY 3.0 | 100 | 28 (MIDI 27–104) | 4 | 2 semitones |

Clav, Digital and Misc are **modelled**, and are labelled `(modelled)` in the display and in
`IMPLEMENTATION_DETAILS.json`. Reverb impulse responses are generated at runtime; no recorded
IRs are bundled. Licence texts and an attribution notice ship in `public/samples/`.

Loaded through the production loader in the browser: **78/78 grand files, 0 failures**
(`audio/libraryGrand`), out of 235 files across the three sets (209 original recordings,
26 derived roots). Measured rendered output of the three recorded types at the same
note, proving they are different recordings rather than one sound relabelled:

| Type | RMS | Brightness |
| --- | --- | --- |
| grand | 0.08557 | 0.08502 |
| upright | 0.08513 | **0.07634** |
| electric | 0.05531 | **0.05619** |

and the six types through the shipping voice code, where the three modelled types are
plainly their own voices:

| Type | Source | RMS | Brightness |
| --- | --- | --- | --- |
| Grand | recorded | 0.07229 | 0.08073 |
| Upright | recorded | 0.07243 | 0.07204 |
| Electric | recorded | 0.05476 | 0.04949 |
| Clav | modelled | 0.04960 | 0.07005 |
| Digital | modelled | 0.08770 | 0.04573 |
| Misc | modelled | 0.05987 | 0.92286 |

**Fallback.** With every sample fetch rejected: 72 failures, status
`{state: fallback, detail: "Piano not found — playing the modelled fallback"}`, and the note
still starts a voice. `piano.fallback` covers this, including that a modelled type reports
`ready` with no files to load and that the fallback clears on a successful load.

## 8. Effect processing, measured

Each unit was rendered through the production chain with a 220 Hz sawtooth (or an impulse /
click train where the time domain is what matters). `bypass:reference` is the same chain with
every unit off: RMS 0.17528, brightness 0.19285.

| Unit / type | RMS | Brightness | Stereo corr. | What proves it processes |
| --- | --- | --- | --- | --- |
| Mod 1: A-Pan | 0.11638 | 0.19531 | **0.6887** | pans between channels |
| Mod 1: Tremolo | 0.17834 | 0.19264 | 0.9998 | level modulation |
| Mod 1: Ring Mod | 0.05534 | **0.27392** | 0.9988 | inharmonic content |
| Mod 1: A-Wah | 0.05342 | 0.23869 | 0.9990 | envelope-driven band-pass |
| Mod 1: Wah | 0.05535 | 0.23305 | 0.9990 | LFO-driven band-pass |
| Mod 1: Pump | 0.17760 | 0.19275 | 0.9998 | ducking contour |
| Mod 2: Chorus | 0.30496 | 0.16381 | **0.5585** | widened image |
| Mod 2: Flanger | 0.22182 | 0.18393 | 1.0000 | comb filtering |
| Mod 2: Phaser | 0.20828 | 0.18764 | 1.0000 | all-pass sweep |
| Mod 2: Vibe | 0.17580 | 0.18813 | 1.0000 | staggered phasing |
| Mod 2: Ensemble | 0.30223 | 0.16343 | **0.5488** | three delay lines |
| Mod 2: Spin | 0.19966 | 0.19015 | **0.8256** | rotary-like motion |
| Amp/EQ: EQ only | 0.17912 | 0.19134 | 0.9997 | bass shelf applied |
| Amp/EQ: Twin | 0.63447 | 0.11661 | 0.9997 | drive + cabinet |
| Amp/EQ: JC | 0.88401 | 0.11602 | 0.9997 | distinct tone stack |
| Amp/EQ: Small | 0.47369 | **0.07883** | 0.9995 | boxy cabinet |
| Amp/EQ: LP24 | 0.25795 | **0.08471** | 0.9999 | low-pass |
| Amp/EQ: HP24 | 0.17950 | **0.22733** | 0.9998 | high-pass |
| Compressor | 0.38980 | 0.31589 | 1.0000 | narrows dynamic range |
| Reverb: Hall | 0.02208 | 0.23249 | **0.1127** | stereo tail |
| Delay | 0.13225 | 0.25060 | 1.0000 | repeats |

**Reverb decay length**, measured as time above a fixed threshold after an impulse:

| Booth | Room | Spring | Stage | Hall | Cathedral |
| --- | --- | --- | --- | --- | --- |
| **0.454 s** | 0.961 s | 1.202 s | 1.721 s | 2.733 s | **4.348 s** |

Booth is shortest and Cathedral longest, exactly as the manual describes; Spring has its own
length and a dispersive character rather than being a copy of Room.

**Delay repeats** at 190 ms with feedback 8 and the LP feedback filter: 0.243435 → 0.070862 →
0.054607 → 0.043940. Each repeat is quieter than the last, and each is darker than the last,
which is only possible if the filter sits inside the feedback loop.

**All-effects bypass.** With Mod 1, Amp and Reverb engaged the chain measures 0.07087; turning
Layer Effects ON off measures 0.17414 against a fully dry 0.17601 — within 1.1%, i.e. the
bypass really does reach the graph.

## 9. Signal order and the master path

`audio/graph`:

| Property | Value |
| --- | --- |
| Contexts created | **1** |
| Chains | 2 (`piano.a`, `piano.b`), each `mod1 → mod2 → delay → ampEq → compressor → reverb` |
| Shared rotary instances | **1** |
| Connections to the destination | **1** |
| Live nodes with one voice playing | 178 (idle baseline 174) |
| After `stopAll()` | 174 — **back to baseline**, 0 voices |

Reverb-before-Rotary is measured, not asserted from wiring: an impulse through
Hall → To Rotary leaves a tail whose level contour is *modulated* well after the impulse
(`effects.processing`, "puts Reverb before the Rotary"). Global reverb is out of scope, so no
post-rotary reverb path exists.

## 10. Piano performance controls, measured against the instrument's own default

Reference: RMS 0.04984, brightness 0.06386.

| Control | RMS ratio | Brightness ratio | Note |
| --- | --- | --- | --- |
| KB Touch HEAVY | **0.795** | 1.000 | quieter for the same strike |
| KB Touch LIGHT | **1.178** | 1.000 | louder for the same strike |
| Dyn Comp 3 | **1.118** | 1.000 | lifts, does not recolour |
| Timbre MID | 1.074 | **1.222** | mid presence |
| Timbre BRIGHT | 0.931 | **1.172** | treble emphasis |
| Timbre SOFT vs unvoiced | — | **0.920** | damps the highs |
| Soft Release | — | — | tail 0.807 s vs 0.579 s |
| Unison 1 | mono RMS 0.03802 | corr **0.9094** | widening begins |
| Unison 3 | mono RMS 0.02657 | corr **0.2394** | obvious wide detune |

Master Level is linear below the limiter: 0.9 vs 0.3 measures a ratio of **2.79** (0.51654 vs
0.18545), which is 3× minus the limiter's action on the louder setting.

## 11. Interaction pass

Run in Chromium on the production build; every step below is in the capture.

| Step | Result |
| --- | --- |
| Every visible control operated through its own widget | **167 / 167**, 0 failures |
| Piano section / layer A / SUSTPED restored after the sweep | true / true / true |
| Pointer chord of three fingers | **3** keys held |
| Sustained after all three pointers lift (pedal down) | **3** keys sustained |
| Keys still lit after pedal up | **0** |
| Computer-keyboard chord (Z, C, B) | **3** keys held |
| Master level Home → End | **0 → 100** |
| Keys lit after Panic | **0** |
| Manual Piano B focus, then back to A | **FX PIANO A** |
| Each piano type selected in turn | Grand/Upright/Electric → `SAMPLES READY`; Clav/Digital/Misc → `MODELLED` with `(modelled)` in the model line |
| Each effect unit switched on in turn | MOD1 → +MOD2 → +DLY → +AMP → +CMP → +REV, all reflected in the display's active-unit line |

**Console: 0 errors and 0 page errors** across the desktop page, the narrow page and the
audio harness. The 16 recorded messages per page are Chromium's own
"AudioContext was not allowed to start before a user gesture" advisory, which is expected for
a browser that constructs the context on first interaction.

## 12. Narrow profile — 390 × 844

| Measurement | Value |
| --- | --- |
| Page scroll width | **390 px** (no horizontal overflow) |
| Page scroll height | 4121 px (vertical scrolling by design) |
| Sections with clipped or overflowing controls | **0 of 6** |
| Controls outside the viewport width | 0 of 167 |
| Deck / keybed share | 0.948 / 0.052 (stacked) |
| Console errors | 0 |

The narrow silhouette is the same deliberate deviation Phase 1 documented and is unchanged:
at 390 px the six sections stack so every landmark and control stays inspectable and
operable, rather than the instrument being scaled to illegibility.

## 13. Defects found and fixed during this phase

The audio boundary is where most of them were, and each was found by measuring rather than by
reading code:

1. **Every sampled voice was silent.** The timbre filter chain was wired
   `output → bass → … → treble` instead of `voice → bass → … → treble → output`, and the
   voice's summing gain was never raised. Found by `audio/types` measuring 0 for all three
   recorded types. Both fixed.
2. **Sharp-named samples 404'd.** `F#1-v1.mp3` in a URL starts a fragment, so every sharp root
   silently fetched `index.html` and fell into the fallback. The names now use `s` (`Fs1`), the
   loader encodes path segments, and a test asserts no shipped file contains `#`.
3. **The effect graph could never have worked in a browser.** `adaptAudioContext` wrapped only
   the Phase 1 node factories, and its `connect()` rejected AudioParams — so every LFO
   connection would have thrown. Both fixed; the failure is now reported instead of swallowed
   (`effectGraphError`).
4. **Layer Effects ON did nothing to the signal.** Each unit read only its own `on` flag. The
   all-effects flag now reaches every unit, and bypass measures within 1.1% of dry.
5. **The shared rotary fed both layer faders.** Its output was connected into both layers'
   level stages. There is now one rotary return to the master path, with the layer fader before
   the send.
6. **Amp boosts could leave the chain 4× over full scale.** The clipper's *level* is nearly
   independent of input gain, so post-gain compensation was wrong. The amp models are now
   unity-gain, and the chain output has a soft ceiling that is transparent below the knee.
7. **Ping-pong was two panners fed by one mono delay.** It is now two delay lines with crossed
   feedback, so consecutive repeats alternate sides.
8. **The panel and the instrument used two different presentation stores.** `App` created its
   own, so every real control looked connected while its edits went nowhere. There is now one
   store, owned by the instrument.
9. **`usingFallback` was permanent after any single failed file.** It now tracks failed models,
   and clears when the model loads.
10. **Disabling a layer silenced it without updating the snapshot.** The session now owns
    `releaseLayer`, so voice counts and audio agree.
11. **Timbre position 0 was a no-op.** The printed panel has no "Off" position; its first is
    SOFT, and the per-family mapping now starts there.
12. **The measurement harness was wrong in four places**, each fixed rather than worked
    around: a transparent background counted as a dark plate; destination connections were
    counted on the wrong side of the adapter; the timbre reference compared two identical
    voicings; and a synthetic `PointerEvent` has no capture target, so the pedal's
    `setPointerCapture` threw a page error.

## 14. Known deviations, unchanged or new

Inherited from Phase 1 and still true: the narrow viewport stacks rather than preserving
3.0951; desktop legends are 4–5 px at 1440 × 900; knob bezels are CSS approximations; the rear
rail is a printed strip; sub-legends are simplified.

New this phase:

1. **Amp models are documented approximations,** as the effects spec permits: a tone stack, a
   cabinet corner pair and a shared tanh clipper, not measured impulse responses. Twin, JC and
   Small are measurably distinct (brightness 0.1166 / 0.1160 / 0.0788) but they are not
   emulations of specific circuits.
2. **String Res is a simulation, not pedal-down samples.** It is honoured for acoustic models
   only and declared as simulated in `IMPLEMENTATION_DETAILS.json`.
3. **Modelled types are additive synthesis.** Clav, Digital and Misc are allowed to be honest
   synthesis by the piano spec, and are labelled `(modelled)` everywhere they appear.
4. **Derived sample roots.** Where a library's own recordings leave a gap wider than four
   semitones, a root was derived by re-pitching a neighbouring recording by at most four
   semitones, and is marked `kind: "derived"` with its source root in the manifest. 235 files:
   209 original recordings, 26 derived. The spec's requirement is that uniform pitch-shifting
   of one note is not audible; every key is within two semitones of a root, which it is.
5. **The rotary has one instance, not per-layer**, exactly as the manual describes, so a
   routed layer's drive depends on the level arriving at it. That matches the manual's own
   note about rotary drive and level interaction.

## 15. Evidence inventory

- `evidence/stage2-desktop.png` — 1440 × 900 viewport screenshot after the interaction pass.
- `evidence/stage2-narrow.png` — 390 × 844 full-page screenshot.
- `evidence/stage2-capture.json` — every number quoted above, machine-readable, including the
  interaction pass, the audio measurements and the console record.
- `evidence/stage1-*` — the Phase 1 captures and audit, preserved unchanged.
