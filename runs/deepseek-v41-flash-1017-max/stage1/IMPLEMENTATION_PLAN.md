# Phase 1 implementation plan — Nord Stage 4 73

Assigned specs (authoritative for this phase):

- `specs/nord-stage-4.visual.json` — deck geometry, section widths, landmarks, forbidden hardware, presentation bounds.
- `specs/nord-stage-4.piano.json` — note lifecycle, sustain, polyphony, truthful status (Phase 1 subset = "one dependable basic piano voice").
- `specs/nord-stage-4.variants.json` — variant `stage-4-73`: 73 keys, 43 white / 30 black, E1–E7, hammer action, aspect 3.0951, black key height 0.61.
- `specs/benchmark-phases.json` — Phase 1 outcome, inclusions, exclusions, hard gates.

Where the prose prompt and a spec disagree, the spec wins when it documents a photo measurement.
`nord-stage-4.visual.json` `horizontalSectionsNote` records that 13/21/15/9/21/21 was the superseded
coarse reading and that 14/20/8.5/12.5/25/20 is the photo-measured correction. This build uses the
corrected values. The manual (`reference/manual.pdf` pp. 23–26) supplies control names, layer
behaviour and the honest meaning of each printed legend.

## Phase 1 hard gates (copied from `specs/benchmark-phases.json`)

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Order of work

1. **`candidate/IMPLEMENTATION_PLAN.md`** (this file) and the feature matrix skeleton.
2. **Normalized typed hardware + key data.** `src/hardware/` holds one flat, typed catalog of every
   visible physical input with a stable dotted ID (`organ.drawbar.16`), a printed legend, an accessible
   name, a range/step/default and a section. The keybed is derived from the variant: MIDI 28..100,
   43 white + 30 black keys, black keys 0.61 of white-key length, white geometry computed from the
   white-key index so the pattern is exact rather than decorative.
3. **Chassis + sections.** One continuous red chassis, deck 0.54 / keybed 0.46, six ordered sections at
   0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20 of the instrument width. Program and Synth carry the only
   two primary OLEDs; the Program display reports only what is true (engine status, active voice name),
   the Synth display reports the Synth section as not available in Phase 1.
4. **Decorative controls.** Every catalog entry renders as a real focusable widget (slider/button) whose
   value lives in one normalized presentation store. Moving it changes presentation state and nothing
   else — no audio call, no program/effect state, no display claiming unimplemented behaviour.
5. **Injectable boundaries.** Audio system, Web MIDI access, and the clock are injected:
   `createAudioSystem({ createContext })`, `createMidiAccess()`, `now()`. Tests supply fakes; nothing
   needs a device, a network, or real audio output.
6. **Note lifecycle then the voice.** One `PianoSession` owns every note source. Pointer/touch (with
   independent multi-touch), the mapped computer keyboard (repeat suppressed, blur cleanup) and Web MIDI
   (note/velocity, CC64 sustain, denied/disconnected states) all enter the same `noteOn/noteOff` path.
   One voice: a deterministic additive piano model (honest synthesis, declared as such — no recordings),
   velocity response, per-note release, sustain, 16-voice polyphony with deterministic stealing, and
   all-notes-off on blur / MIDI disconnect / unmount.
7. **Tests, browser pass, captures, provenance.** Every feature ID from `TASK.md` maps to at least one
   real test file in `tests/feature-matrix.json`; audible claims are proved by rendering the voice model
   through the shared master stage and measuring samples, not by inspecting state alone.

## Honesty notes for this phase

- The piano voice is **synthesised**, not sampled. `IMPLEMENTATION_DETAILS.json` says so and lists no
  sample sources. The Program display labels it "Modelled piano (no samples)".
- Every panel control is presentation-only. Nothing in the deck audio path is reachable from a knob, a
  fader, a drawbar or a button in Phase 1.
- A `fallback` audio state is surfaced in the Program display when Web Audio is unavailable: the keybed
  still responds, and the display says it is silent instead of pretending to play.
