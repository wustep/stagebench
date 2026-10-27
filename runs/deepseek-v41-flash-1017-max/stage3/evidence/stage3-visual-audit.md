# Stage 3 visual and audio audit — Nord Stage 4 73

Every number below was produced by `scripts/capture.mjs` against the production build
(`vite build`, `base: './'`, served by `vite preview`) in Chromium, at the two canonical
viewports, and is stored machine-readably in `evidence/stage3-capture.json`. Audio numbers
come from rendering the **shipped** audio modules in that same browser through
`harness.html`, not from a copy of the DSP.

Reference: `inputs/reference/nord-stage-4-73.jpg` (11600 × 3866), instrument bounds
x 1292, y 410, w 9013, h 2912 → aspect **3.0951** (`specs/nord-stage-4.variants.json`).

Phase 1 and 2 evidence is retained unchanged: `evidence/stage1-*` and `evidence/stage2-*`.

---

## 1. What changed on the surface, and what did not

The surface is deliberately unchanged. Phase 3 adds behaviour behind 147 of the 167 controls
and changes only what the two OLEDs *say*, because what they say must now be true.

| | Phase 2 | Phase 3 |
| --- | --- | --- |
| Controls | 167 | 167 (identical IDs) |
| Sections | 6, same order and widths | unchanged |
| Displays | 2 (Program, Synth) | 2 (same locations) |
| Functional controls | 51 | 147 bound, 20 explicitly unsupported |
| Program display | phase, model, FX focus | + real slot, name and dirty indicator, engine set, split points, scene, transpose, per-engine voice counts |
| Synth display | "not available in this phase" | the real waveform, its category and what Osc Ctrl means, plus filter, voice mode, envelope, LFO and arp state |

One element was **added** to the surface, inside the deck: a collapsed
`SPLIT / ZONES / MORPH` strip. It opens an overlay with the split-point selects, the
7 × 4 zone grid, the two morph sources and the unsupported-control notes. It was needed
because the hardware reaches split points and morph recording with press-and-hold and Shift
gestures that a browser cannot discover; the overlay writes the *identical* canonical state,
and it sits inside the deck so the deck/keybed split and the keybed itself are untouched.
The capture measures both states: `interactionPass.editors` records it open, and the
desktop screenshot (taken after the interaction pass closes it) shows the deck as it was.

## 2. Instrument bounds and viewport occupancy (1440 × 900)

| Measurement | Value | Requirement | Result |
| --- | --- | --- | --- |
| Instrument width fraction | **0.948** | 0.88 – 0.97 | pass |
| Aspect ratio | **3.0952** | 3.0951 | pass (Δ 0.0001) |
| Page scroll width | 1440 px | no horizontal overflow | pass |
| Chassis children | deck then keybed | continuous chassis | pass |

No marketing hero, no `<h1>`/`<h2>`, no `<img>` elements.

## 3. Deck / keybed split

| Band | Share of instrument | Required | Result |
| --- | --- | --- | --- |
| Control deck (incl. rear rail) | **0.5400** | 0.54 ± 0.025 | pass |
| Keybed (incl. front rail) | **0.4600** | 0.46 ± 0.025 | pass |

## 4. Section widths and content

| Section | Declared | Rendered | Controls | Displays | Blocks |
| --- | --- | --- | --- | --- | --- |
| performance | 0.14 | **0.1400** | 11 | 0 | 3 |
| organ | 0.20 | **0.2000** | 33 | 0 | 5 |
| piano | 0.085 | **0.0850** | 23 | 0 | 5 |
| program | 0.125 | **0.1250** | 26 | 1 | 5 |
| synth | 0.25 | **0.2500** | 35 | 1 | 9 |
| effects | 0.20 | **0.2000** | 39 | 0 | 7 |

Every section reports `overflowing = 0` and `zeroSized = 0` at both viewports.

## 5. Keybed

| Measurement | Value | Requirement | Result |
| --- | --- | --- | --- |
| Total keys | **73** | 73 | pass |
| White / black | **43 / 30** | 43 / 30 | pass |
| Range | MIDI 28–100 (E1–E7) | E to E | pass |
| Black/white height ratio | **0.6099** | 0.61 | pass |
| Keys outside the keybed box | 0 | 0 | pass |

Unchanged from Phase 1; the keybed now fans one press out to up to seven layer voices across
three engines.

## 6. Forbidden hardware

Counted with the `forbiddenDetection` rules at 1440 × 900, unscrolled. All twelve rules
resolve to **0**:

`OLED display` in performance and in effects; `wide OLED display` in organ, piano, synth and
effects; `multiple primary displays` in program (1 display, area ratio 1.0); `drawbar bank`
in piano; `full dark inset plate` in performance; `generic equal-width control grid` in
organ; `uniform repeated knob matrix` in synth; `single undifferentiated control grid` in
effects.

## 7. Audio library and provenance

Unchanged from Phase 2: three recorded sets, 235 files, declared per file in
`src/audio/sample-manifest.json`. Loaded through the production loader in the browser:
78/78 grand files, 0 failures.

Rendered output of the three recorded types at the same note, proving they are different
recordings rather than one sound relabelled:

| Type | RMS | Brightness |
| --- | --- | --- |
| grand | 0.08557 | 0.08502 |
| upright | 0.08513 | **0.07634** |
| electric | 0.05531 | **0.05619** |

**Organ and Synth contain no recorded audio at all.** Every organ loop, percussion hit, key
click and synth note is generated at runtime from `src/audio/organModel.ts` and
`src/audio/synthModel.ts`, and `IMPLEMENTATION_DETAILS.json` declares each generator
individually rather than describing it as a sample.

## 8. The Organ engine, measured

### 8.1 The four required-distinct models

Each rendered from its own registration at C4, 0.25 s loop, 48 kHz:

| Model | Partials | Distinct ratios | Highest ratio | RMS | Brightness | Crossing rate |
| --- | --- | --- | --- | --- | --- | --- |
| B3 | 12 | 8 | 6 | 0.30257 | **0.04422** | 1046 Hz |
| Vox | 12 | 9 | 10 | 0.27830 | 0.06915 | 1043 Hz |
| Farf | 19 | 9 | 9 | 0.34468 | 0.06040 | 523 Hz |
| Pipe 1 | 25 | **17** | 40 | 0.22960 | 0.12392 | 1570 Hz |
| Pipe 2 | 42 | **27** | 56 | 0.18349 | **0.26482** | 4186 Hz |
| B3 Bass | 6 | 5 | 3 | 0.39918 | 0.02938 | 523 Hz |

The distinctions are structural, not cosmetic. B3 is a sine-partial tonewheel: 12 partials
at 8 distinct ratios, because nine drawbars plus leakage produce octave and twelfth
overtones. Vox is a reedy formant sum. Farf sums 19 partials because each *register* is its
own voice. Pipe 1 and Pipe 2 are rank sums with a full harmonic series each, which is why
their partial and ratio counts are three to four times B3's — and Pipe 2 is roughly twice as
bright as Pipe 1, exactly as its brighter principal registration claims.

B3 Bass is the B3 engine limited to two drawbars: 6 partials, the darkest of the six, and
its two loud fundamentals are only 16' and 8'.

### 8.2 Every drawbar changes the spectrum

Each of the nine drawbars pulled alone from a silent registration:

| Drawbar | Footage | Brightness | Crossing rate |
| --- | --- | --- | --- |
| 0 | 16' | 0.01741 | 262 Hz |
| 1 | 5⅓' | 0.05223 | 785 Hz |
| 2 | 8' | 0.03482 | 523 Hz |
| 3 | 4' | 0.06962 | 1046 Hz |
| 4 | 2⅔' | 0.10441 | 1570 Hz |
| 5 | 2' | 0.13914 | 2093 Hz |
| 6 | 1⅗' | 0.17386 | 2616 Hz |
| 7 | 1⅓' | 0.20849 | 3139 Hz |
| 8 | 1' | 0.27755 | 4186 Hz |

A clean harmonic ladder: 16' is an octave below 8', 8' is the reference, and 1' is three
octaves above it, with the crossing rate rising monotonically in footage order. The
registration is silence when every drawbar is at zero and audible for each one alone.

### 8.3 Percussion and key click

| Setting | RMS | Crossing rate | Audible length |
| --- | --- | --- | --- |
| 2nd harmonic, slow, normal | 0.07467 | 1046 Hz | 2.480 s |
| 3rd harmonic, slow, normal | 0.07467 | **1569 Hz** | 2.480 s |
| 2nd harmonic, slow, **soft** | **0.03235** | 1046 Hz | 2.480 s |
| 2nd harmonic, **fast**, normal | 0.07334 | 1046 Hz | **0.480 s** |
| Key click | 0.09245 | — | **0.012 s** |

The harmonic switch changes the pitch by exactly 3:2 (1046 → 1569 Hz) rather than only the
level; soft is 43 % of normal; fast decay is one fifth the length; and the key click is a
12 ms transient rather than a tone.

### 8.4 Vibrato and chorus

The six scanner settings are declared as rate, depth in cents, chorus mix and delay length.
Vibrato is pitch only (`chorusMix = 0`); chorus adds the modulated signal to the dry path
(`chorusMix = 1`); depth grows from 1 to 3 in both families and the rate rises with depth,
so V1 and C1 are audibly different effects rather than the same one relabelled.

### 8.5 Two layers, one chain

`audio/organ/layers` records the chains the engine built: **six**, in the order
`piano.a, piano.b, organ, synth.a, synth.b, synth.c`. Both organ layers resolve to the one
`organ` chain; the level stage sums their faders (capped at 1), so a layer at zero is silent
while the other plays. A test asserts that two organ notes are booked against that single
chain.

## 9. The Synth engine, measured

### 9.1 The required waveforms

Each rendered through the oscillator generator at the same note:

| Waveform | RMS | Brightness |
| --- | --- | --- |
| Sine | 0.70751 | 0.03420 |
| Triangle | 0.57782 | 0.03753 |
| Saw | 0.57454 | 0.17915 |
| Square | 0.99573 | 0.14602 |
| Pulse 33 | 0.46870 | 0.15613 |
| Pulse 10 | 0.29707 | 0.24922 |
| Sync Saw / Sync Square | see §9.2 | — |
| Multi Saw / Multi Saw 8ve | see §9.2 | — |
| Super Saw / Super Square | see §9.2 | — |
| FM 2-op (algorithm A) | see §9.2 | — |

### 9.2 Osc Ctrl acts per category

| Waveform | Osc Ctrl 0 → 10 brightness | Shape difference | Stereo correlation 0 → 10 |
| --- | --- | --- | --- |
| Saw (Pure) | 0.1792 → **0.1792** | **0.0000** | 1.00 → 1.00 |
| Sync Saw | 0.2539 → **0.7069** | 0.6190 | 1.00 → 1.00 |
| Multi Saw | 0.1837 → 0.1620 | 0.6784 | **0.16 → 0.53** |
| Super Saw | 0.1687 → 0.1692 | 0.6884 | **0.91 → 0.14** |
| FM 2-op | 0.0342 → **0.3319** | 0.7167 | 1.00 → 1.00 |

Pure is exactly unaffected by Osc Ctrl, which is what the spec says it should be. Sync
nearly triples its brightness because the slave's relative pitch rises. FM nearly
decuples it because the modulation index rises. Super's *level* barely moves while its two
channels decorrelate from 0.91 to 0.14, which is exactly what "width" means; Multi's
channels move the other way because raising the detune pulls its three saws through a
series of beating relationships, which the difference measure records as a large shape
change.

### 9.3 Filters, envelopes, voice modes and the arpeggiator

| Measurement | Value |
| --- | --- |
| LP12 brightness | 0.11797 |
| LP24 brightness | **0.09363** (steeper, as a 4-pole should be) |
| HP brightness | **0.30984** (keeps the highs) |
| BP RMS | **0.06665** (narrowest) |
| Filter env amount 0 → 9 | brightness 0.02769 → **0.07512** |
| Release 0.15 s / 2.0 s | audible 0.349 s / **2.187 s** |
| Velocity 0.2 / 1.0 | RMS 0.1607 / **0.3443** (ratio 2.14) |
| Unison Off / 3 | shape difference **0.6142** at comparable level |
| Glide from C3 to C5, first 50 ms | 540 crossings vs **1040** without a glide |

The arpeggiator is deterministic. With the notes C4/E4/G4 and a 0.25 s step:

- **Up**: 60, 64, 67, 60, 64, 67
- **Down**: 67, 64, 60, 67, 64, 60
- **Up/Down**: 60, 64, 67, 64, 60, 64
- **Three octaves**: 60, 64, 72, 76, 84, 88

## 10. Control-binding audit

`auditControls()` over the real 167-control catalog:

| Section | Bound | Unsupported | Unaccounted |
| --- | --- | --- | --- |
| performance | 7 | 4 | 0 |
| organ | 29 | 4 | 0 |
| piano | 21 | 2 | 0 |
| program | 22 | 4 | 0 |
| synth | 32 | 3 | 0 |
| effects | 36 | 3 | 0 |
| **total** | **147** | **20** | **0** |

Phantom bindings (a binding naming a control the catalog does not contain): **0**.

The 20 unsupported controls, each with the spec bullet that excludes it, are listed in the
UI's own notes (`interactionPass.editors.unsupportedCount = 20`) as well as in
`IMPLEMENTATION_DETAILS.json`. They are: the A.T. morph source; the three per-section preset
library buttons; the Organ preset and drawbar sync; aux-keyboard routing on both Organ
layers; Piano INFO and PED NOISE; the Synth Samples/Extern selector, its pitch page switch
and its arp PATTERN button; the three per-type Variations; the rotary close-mic and
stop-angle switches; and the monitor-head input.

## 11. Programs, splits, scenes and morphs

### 11.1 The program system

| Check | Value |
| --- | --- |
| Program slots | **32** |
| Live slots | **8** |
| Factory programs with real names | **11** (of 12 designed; the rest are `Init n.m`) |
| Boot slot / name | 1 / `Init Stage` |
| Dirty on boot | **false** |
| Dirty after one edit | **true** |
| Dirty after Store | **false** |
| Stored value round-trip | level 41 stored, still 41 after moving to slot 19 and back (the untouched program reads 80) |
| Live slot auto-store | transpose −4 stored with no Store press, `dirty = false` |

The panel pass confirms the same behaviour through the real UI: programs 1.1–1.8 each
select a different named program, Page ▲ moves to `BANK 1 · PAGE 2` and program button 1
then selects `2.1 Sync Lead`, the dial's End reaches `4.8 Init 4.8`, LIVE MODE switches the
readout to `LIVE` and the buttons to `L1…L8`, and a control edit lights the `· E`
indicator.

### 11.2 Splits and crossfades

Zone gains at the four crossfade settings, with the Low point at C4 and a lower layer in
zone 0 and an upper layer in zone 1. Both layers' gains are shown for notes G3–F♯4:

| Note | Off (lower/upper) | ±6 (lower/upper) | ±12 (lower/upper) |
| --- | --- | --- | --- |
| G3 (54) | 1.00 / 0.00 | 1.00 / 0.00 | **0.75 / 0.25** |
| A3 (57) | 1.00 / 0.00 | 0.75 / 0.25 | 0.63 / 0.38 |
| C4 (60) | **0.00 / 1.00** | **0.50 / 0.50** | **0.50 / 0.50** |
| D♯4 (63) | 0.00 / 1.00 | 0.25 / 0.75 | 0.38 / 0.63 |
| F♯4 (66) | 0.00 / 1.00 | **0.00 / 1.00** | 0.25 / 0.75 |

Off switches instantly at the point (C4 belongs wholly to the upper zone); ±6 fades across
six semitones each side, reaching half level at C4 and full a tritone away on each side; ±12
is shallower and reaches an octave each side. The two neighbours sum to 1.00 everywhere in
the band, which is what makes the seam level.

### 11.3 Scenes and morphs

Applying Scene I then Scene II changed the sounding layer set from
`piano.a + synth.b` to `piano.b + organ.a + synth.c` while `parametersUnchanged = true`:
not one level, model, drawbar, timbre or filter value moved.

One morph source driving two destinations in opposite directions:

| Wheel position | Piano A level (20 → 90) | Synth filter freq (8 → 2) |
| --- | --- | --- |
| 0 % | 20 | 8 |
| 50 % | 55 | 5 |
| 100 % | 90 | 2 |

Clearing a single assignment left the other intact.

## 12. One instrument, one context

`audio/graph`, measured on the shipped engine:

| Property | Value |
| --- | --- |
| Contexts created | **1** |
| Chains | **6** (`piano.a`, `piano.b`, `organ`, `synth.a`, `synth.b`, `synth.c`) |
| Chain order | `mod1 → mod2 → delay → ampEq → compressor → reverb` |
| Shared rotary instances | **1** |
| Connections to the destination | **1** |
| Live nodes with one voice playing | 516 (idle baseline 512) |
| After `stopAll()` | **512 — back to baseline**, 0 voices |

A source scan asserts there is exactly **one** `AudioContext` construction site in the whole
tree, in `useInstrument.ts`.

## 13. Interaction pass

Run in Chromium on the production build.

| Step | Result |
| --- | --- |
| Every visible control operated through its own widget | **167 / 167**, 0 failures |
| Pointer chord of three fingers | **3** keys held |
| Sustained after all pointers lift (pedal down) | **3** keys sustained |
| Keys still lit after pedal up | **0** |
| Computer-keyboard chord | **3** keys held |
| Master level Home → End | **0 → 100** |
| Keys lit after Panic | **0** |
| Organ section switched on | display changes `PIANO` → `PIANO + ORGAN` |
| Program buttons 1–8 | eight distinct programs, `1.1` … `1.8` |
| Page ▲ then button 1 | `2.1 Sync Lead` |
| Dial End | `4.8 Init 4.8` |
| LIVE MODE | readout `LIVE`, buttons address `L1…L8` |
| Split on from the editor | `SPLIT C3/C4/C5` |
| Mid point changed to F4 | `SPLIT C3/F4/C5` |
| Zone toggle | `aria-checked = true` |
| Unsupported notes rendered | **20** items |
| Focus buttons | ORGAN → `FX ORGAN`; PIANO A → `FX PIANO A`; SYNTH A → `FX SYNTH A` |
| Synth waveform via the dial | `Sine`, `Pure` category, OSC CTRL 4.0 · no effect |
| Organ display | model `B3`, drawbars `8 0 8 6 3 0 0 0 0` |
| Transpose engaged and stepped | `TRANSP` shown in the display |
| Panic | 0 keys lit |

**Console: 0 errors and 0 page errors** across the desktop page, the narrow page and the
audio harness. The 44 recorded messages per page are Chromium's own "AudioContext was not
allowed to start before a user gesture" advisory, which is expected for a browser that
constructs the context on first interaction.

## 14. Narrow profile — 390 × 844

| Measurement | Value |
| --- | --- |
| Page scroll width | **390 px** (no horizontal overflow) |
| Page scroll height | 4159 px (vertical scrolling by design) |
| Sections with clipped or overflowing controls | **0 of 6** |
| Controls outside the viewport width | 0 of 167 |
| Console errors | 0 |

The narrow silhouette is the same deliberate deviation Phase 1 documented: at 390 px the six
sections stack so every landmark stays inspectable and operable. The split/morph overlay
also stacks and scales its text up to a readable size.

## 15. Defects found and fixed during this phase

Each was found by measuring or by driving the real UI, not by reading code.

1. **Every momentary button was inert.** The presentation store reported only the *release*
   edge to the functional sink, so Store, the eight program buttons, the page buttons, the
   focus buttons and Panic were reachable, accessible, and did nothing. Found by the
   browser pass: eight different program buttons all showed the same program. The press edge
   now reports, with a guard so a real pointer gesture does not report twice.
2. **Scene switching was a second gate on top of the layer flags.** A layer button looked
   broken whenever the scene disagreed with it. Scenes now *write* the enable flags, so
   there is one source of truth.
3. **The Organ's shared chain used the maximum fader, not the sum.** A layer at 0 muted the
   other. It now sums (capped at 1), which is what two faders into one bus do.
4. **`layerSounds` checked the wrong layer index** (`'organ.a'` for every organ layer), so
   Organ B never sounded when A was off.
5. **The engine's own enable table never learned about organ or synth layers.** Section and
   layer flags now arrive through `setOrganState`/`setSynthState`, so the engine's gate and
   the panel cannot disagree.
6. **A direct `noteOn` produced no organ or synth voice**, because both voices required a
   per-voice payload only the session supplies. Both now fall back to their own layer state.
7. **The Organ could not reach the rotary.** `createChain` only honoured the Amp/EQ
   To Rotary model; the ORGAN button is now a second route, as the manual describes.
8. **The dirty flag was wrong twice.** Key insertion order made two equal states compare
   unequal, and `masterLevel` made a performance control dirty a program. Comparison is now
   canonical and excludes both the revision counters and Master Level.
9. **Store committed to the selected slot, not the destination.** Choosing a different
   destination with the dial wrote the wrong slot.
10. **The synth's release length was ignored.** The rendered buffer used the envelope dial
    instead of the voice's requested release, so a 0.15 s and a 2 s release sounded
    identical. The session now derives the length from the same helper the envelope uses.
11. **The crossfade was asymmetric.** The first implementation faded only on one side of the
    boundary. A crossfade belongs to a boundary, so a zone's gain is now the product of its
    fade-in and fade-out, and neighbours sum to unity.
12. **The zone filter was wrong for crossfaded layers.** Filtering by "the note's zone index
    is assigned" excluded a layer whose *neighbouring* zone was fading into the note. The
    computed gain is now the only test.
13. **The measurement harness was wrong in three places**, each fixed rather than worked
    around: it compared scene parameters *after* applying a scene, measured a release as a
    fraction of a buffer whose length it had just changed, and read the program's dirty flag
    before booting the live state from a slot.

## 16. Known deviations, unchanged or new

Inherited and still true: the narrow viewport stacks rather than preserving 3.0951; desktop
legends are 4–5 px at 1440 × 900; knob bezels are CSS approximations; the rear rail is a
printed strip; amp models and string resonance are documented approximations.

New this phase:

1. **The Organ and Synth are digital models, not emulations of specific circuits.** B3
   leakage, Vox formants, Farf register voices and Pipe ranks are spectral constructions
   that are measurably distinct; they are not measured impulse responses of the originals.
2. **Organ percussion and key click are generated, not sampled.** That is how the manual
   describes them ("a random contact bounce"), and it is declared as synthesis.
3. **The split/morph overlay is an addition to the surface**, explained in §1. It exists so
   the required state is genuinely editable in a browser, and it does not change the deck's
   geometry or the keybed.
4. **B3 Bass and Pipe 2 reuse their base engines**, which the organ spec explicitly permits.
   Both are measurably different from their bases, not renames.
5. **Aftertouch is not implemented anywhere.** The A.T. morph source and the A.T. vibrato
   mode press and are listed as unsupported, because browser keyboards have no pressure
   sensor.

## 17. Evidence inventory

- `evidence/stage3-desktop.png` — 1440 × 900 viewport screenshot after the interaction pass.
- `evidence/stage3-narrow.png` — 390 × 844 full-page screenshot.
- `evidence/stage3-capture.json` — every number quoted above, machine-readable, including
  the interaction pass, the organ/synth/program/split/scene/morph measurements, the audit
  and the console record.
- `evidence/stage1-*`, `evidence/stage2-*` — the earlier captures and audits, preserved
  unchanged.
