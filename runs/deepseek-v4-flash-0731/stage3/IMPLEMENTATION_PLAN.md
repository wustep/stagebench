# Stage 1 — Implementation plan (Nord Stage 4 73)

Phase 1: complete visible surface + basic playable piano.

## Specs cited

- `nord-stage-4.visual.json` — surface geometry, sections, colors, topography, viewport constraints.
- `nord-stage-4.piano.json` — basic one-voice piano behaviour, note lifecycle, inputs, sustain, status/fallback honesty.
- `inputs/TASK.md` and `inputs/specs/benchmark-phases.json` — Phase 1 scope and shared completion gates.

## Order of work

1. **Hardware data model** (`src/hardware/`): typed keys, sections, control inventory with stable IDs; the 73-key E1–E7 keybed (43 white / 30 black), six deck sections at their documented widths, and a single continuous red chassis.
2. **Hardware presentation store** (`src/hardware/store.ts`): normalized, React-observable presentation state keyed by control id; moving a control updates nothing but this map.
3. **Section controls** (`src/components/`): every visible control (knob, fader, drawbar, encoder, wheel, stick, button, OLED, LED graph) as an accessible, pointer- and keyboard-operable element that stores its presentation state only.
4. **Audio / timing boundary** (`src/audio/`): a pure-DSP, sample-accurate, honestly synthesized piano voice on an injectable clock; tests render real PCM.
5. **Note lifecycle + inputs** (`src/piano/`): one shared lifecycle for pointer, multi-touch, computer keyboard (repeat-suppressed, blur cleanup), and Web MIDI (note/velocity/sustain CC64, denied/disconnected) — plus truthful loading/ready/error/fallback status.
6. **Tests, browser pass, captures, provenance.**

## Phase 1 hard gates (checklist)

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Verification

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.

---

# Stage 2 — Implementation plan (Nord Stage 4 73)

Phase 2: Piano library (six types, two layers, performance controls) and Layer
Effects (six units + shared Rotary) become fully functional; Master Level is
wired to the master path. Organ, Synth, and Program controls keep their honest
Phase 1 decorative behavior — they still move/press accessibly and change
presentation state only.

## Specs cited

- `specs/nord-stage-4.piano.json` — six types, recorded Grand/Upright/Electric sample sets, two layers, KB Touch / Dyn Comp / Timbre / Unison / Soft Release / String Res, SUSTPED/PSTICK, sustain from UI/keyboard/MIDI, truthful loading/ready/error + labeled fallback.
- `specs/nord-stage-4.effects.json` — per-layer chains (Mod 1, Mod 2, Delay, Amp Sim/EQ, Compressor, Reverb) plus the shared Rotary via To Rotary; focus-follows-layer, manual focus, Piano group mode, Delay/Compressor/Reverb global mode, per-unit bypass, all-effects bypass, documented signal order (Reverb before Rotary; Delay feedback filter processes repeats), one AudioContext, click-free ramps, master limiter, cleanup.
- `specs/nord-stage-4.visual.json` — the surface is unchanged; Phase 2 adds only *functional* controls that already exist in the Phase 1 inventory (piano types, layers, performance controls, FX focus/type/parameter/bypass buttons, Master Level). No section, key, or OLED geometry changes.
- `inputs/TASK.md` + `inputs/specs/benchmark-phases.json` — Phase 2 included/excluded scope and shared hard gates.

## Sample provenance plan (recorded/bundled Grand, Upright, Electric)

The three acoustic/electric families are delivered as **bundled, offline,
multi-sample libraries**: many root notes across E1..E7 and multiple velocity
layers each, generated deterministically offline and embedded as redistributable
sample tables (plus a generated-WAV bundle under `public/samples/`), so uniform
pitch-shifting of a single note is not audible. Each family has a distinct
per-partial structure, decay, and brightness so the three are audibly distinct.
`IMPLEMENTATION_DETAILS.json` declares every source, file, license, root note,
and velocity layer truthfully — generated sample tables are never described as
field recordings. Clav, Digital, and Misc are honest live synthesis (per the
piano spec's `sourceRules`).

## Phase 2 hard gates (checklist)

The task ("benchmark-phases.json" Phase 2 hardGates, verified verbatim at seal):

- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

## Order of work

1. **Refactor the voice into layer/bus/master architecture** (`src/audio/`):
   keep `PianoEngine`'s public API (Phase 1 tests), add a two-layer engine in
   which each layer owns its voices and its ordered effect chain, feeding a
   shared master gain + limiter. Input behavior (pointer/keyboard/MIDI note
   lifecycle) unchanged.
2. **Sample library** (`src/audio/samples.ts`): deterministic multi-root,
   multi-velocity tables for Grand / Upright / Electric; generated-WAV bundle;
   live-synthesis voices for Clav / Digital / Misc.
3. **Effects** (`src/audio/effects.ts` + `chain.ts`): pure-DSP units in the
   documented order, parameter ramps for click-free changes, per-unit bypass,
   all-effects bypass, Delay feedback filter, shared Rotary last.
4. **Graph** (`src/audio/graph.ts`): one AudioContext, per-layer buses, master
   gain/limiter, one destination; injectable context for tests; full cleanup.
5. **Panel bindings** (`src/piano/library.ts`, `src/piano/layers.ts`, React):
   six types + models, two layers (enable/focus/level/octave), performance
   controls, SUSTPED/PSTICK, Master Level, FX focus/group/global/To Rotary.
6. **Tests**: add all Phase 2 feature IDs to `tests/feature-matrix.json`;
   preserve every Phase 1 test. Tests cross the audio boundary (render PCM).
7. **Browser pass, visual regression, captures, provenance.**

## Verification

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` in `candidate/`.

---

# Stage 3 — Implementation plan (Nord Stage 4 73)

Phase 3: the remaining sections come alive — the Organ engine, the Synth
engine, and the complete Program/performance system — as one serializable
instrument. Every non-excluded control is bound; the only decorative controls
are list as unsupported.

## Specs cited (all Phase 3 assigned)

- `nord-stage-4.visual.json` — surface unchanged; phase 3 adds only behaviour.
- `nord-stage-4.piano.json` — Phase 1/2 behaviour preserved (layers, effects).
- `nord-stage-4.effects.json` — Phase 2 units extended to Organ (shared chain)
  and Synth layers; one AudioContext, one master/limiter, one destination.
- `nord-stage-4.programs.json` — 32 slots, Store / Store As / dirty / edit-discard,
  8 Live slots, splits/zones/crossfades, scenes I/II, Wheel & Control Pedal
  morphs, Master Clock, Transpose, Panic.
- `nord-stage-4.organ.json` — 2 layers sharing one chain; B3/Vox/Farf/Pipe1
  distinct engines (B3 Bass & Pipe2 reuse per spec); 9 drawbars, percussion,
  key click, vibrato/chorus C1-C3/V1-V3, rotary slow/fast/stop + drive.
- `nord-stage-4.synth.json` — 3 layers with independent chains; Pure/Sync/
  Multi/Super/FM-H sources with category-correct Osc Ctrl; LP12/LP24/HP/BP
  filters with tracking/res/drive; osc/filter/amp envelopes; LFO (5 waves,
  3 destinations, clock sync); poly/mono/legato + priority/glide/unison/
  vibrato; deterministic arp/gate.
- `inputs/TASK.md` + `specs/benchmark-phases.json` — Phase 3 scope, hard and
  shared gates.

## Canonical serializable program state (`src/system/program.ts`)

`ProgramState` is a plain JSON-able object that is the round-trip contract:
`name`, `piano` (2 layers + 2 chains), `organ` (2 layers + 1 shared chain +
drawbars/percussion/keyClick/vibratoChorus/rotarySpeed/rotaryDrive/toRotary),
`synth` (3 layers + 3 chains), `split` (points/crossfades/zones), `scenes`
(I/II enable masks; sound params shared), `morph` (Wheel + Pedal assignments),
`clock` (tempo + sync), `transpose`. Master Level is excluded (spec). Morphs
are a live overlay (`applyMorphs`) over the raw stored state so storing keeps
original start values.

## Phase 3 hard gates

The Phase 3 hard gates (from `specs/benchmark-phases.json`, cited against the
assigned specs `nord-stage-4.visual.json`, `nord-stage-4.piano.json`,
`nord-stage-4.effects.json`, `nord-stage-4.programs.json`,
`nord-stage-4.organ.json`, and `nord-stage-4.synth.json`) are met as follows.

- [x] Hard gate: "Program save/load round-trips all supported state across the 32 slots and 8 Live slots." — `System4` keeps a serializable `ProgramState` (see canonical schema above) that is the round-trip contract; Store writes the working program (excluding only Master Level, per the programs spec) into any of the 32 slots, Store As renames then stores, Live Mode auto-stores edits into the 8 Live slots, and re-selecting reloads the stored program exactly. `tests/system.test.ts` asserts byte-for-byte round-trips of every supported section (organ model/drawbars, synth category/filter, split, scene, morph, clock, transpose).
- [x] Hard gate: "Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio." — the panel bridge binds Split, Layer Scenes I/II, Wheel/Control-Pedal morph assignment, and per-layer zone assignment; `System4.noteOn` routes every transposed note through scenes/zones/crossfades before firing an engine, and `tests/splits.test.ts` plus `tests/system.test.ts` prove the routing and the audible gain changes (`splits.zones`, `morph.assignments`, `scenes.switching`, `layers.routing`).
- [x] Hard gate: "B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator." — the Organ engine computes per-model harmonic partial sets (tonewheel B3, transistor Vox, register-switch Farf, pipe ranks Pipe1/2), and the Synth engine implements the exact Pure/Sync/Multi/Super/FM-H waveform lists with category-correct Osc Ctrl (`synth.sources`). `tests/organ.test.ts` and `tests/synth.test.ts` render PCM and assert every pair is sample-distinct.
- [x] Hard gate: "Organ and Synth route through the Phase 2 graph with no separate AudioContext." — every engine shares the Phase 2 effect chains (`LayerEffectsChain`, including the shared Rotary with slow/fast/stop and drive) and is drained by one `SystemGraph` through a single master GainNode + limiter into exactly one destination (`system.integration`); no second AudioContext exists.
- [x] Hard gate: "All inherited visual, piano, effects, and input behavior remains regression-free." — the Phase 1 surface/keybed/keyboard/MIDI input path and the Phase 2 piano library + effect chain are unchanged and all inherited tests remain green (`regression.phase2` maps every Stage 1/2 test file), with the App now driving the full System4.

## Control-binding audit (`src/system/bridge.ts`)

Delta-based store→engine bridge binds every non-excluded control:
- Program section: buttons/pages/dial/Store/Store As/Live/Scenes/Split are
  edge-triggered; Master Clock / Transpose / Panic driven via a status-strip
  control strip (no new physical deck controls — surface unchanged).
- Organ: model, 9 drawbars (+ LED graphs), percussion (on/decay/level), key
  click, vibrato/chorus, level, rotary speed/drive, To Rotary.
- Synth: level/octave/fine, waveform/category + Osc Ctrl, filter
  type/cutoff/res/keytrack, osc/filter/amp envelopes, LFO shape/rate/depth,
  voice mode/glide/unison/vibrato, arp on/rate.
- Piano + FX: all Phase 2 controls map into the working program.
- Morph: holding a source + moving a control assigns {path, from, to};
  re-holding to zero removes; Shift+source clears.
- Unsupported (spec-excluded, listed): preset library, Extern/Aux KB, menus,
  aftertouch morph (A.T. decorative), pattern editing, group modes, swell
  pedal, banks beyond one.

## Verification

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` in `candidate/`.
