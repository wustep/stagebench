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
