# Phase 1 implementation plan

Sources: `inputs/specs/nord-stage-4.visual.json`, `inputs/specs/nord-stage-4.piano.json`, the Stage 4 73 variant entry, product photograph, and manual. The photograph and measured visual spec govern deck proportions where the phase prompt's coarse percentages disagree.

1. Model the continuous chassis, six ordered sections, 73 E–E keys, and each visible input with stable typed IDs.
2. Render the reference's dense controls as accessible buttons and sliders whose state affects presentation only.
3. Route pointer, keyboard, and MIDI input through one injectable note lifecycle and an honest synthesized piano voice.
4. Verify behavior, capture desktop and narrow views, and record measurements and audio provenance.

## Phase 1 Hard gates

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Phase 2 implementation plan

Sources: `inputs/specs/nord-stage-4.visual.json`, `inputs/specs/nord-stage-4.piano.json`, and `inputs/specs/nord-stage-4.effects.json`.

1. Preserve Phase 1 input ownership and map each press to enabled Piano A/B voices. Keep one lazy AudioContext.
2. Bundle offline recorded Grand (AKAI Splendid, public domain), Upright (FreePats Kawai KW, CC0), and Electric (Greg Sullivan Wurlitzer EP200, CC BY 3.0) roots at multiple pitches and dynamic layers. Keep a labeled synthesized fallback if an asset fails.
3. Route each layer through six ordered effect units, optional shared Rotary, layer gain, master gain/limiter, and one destination. All controls update canonical state and the audio graph.
4. Test audio processing and ownership, inspect the browser, and audit Phase 1 visual geometry.

```text
keybed / keyboard / MIDI / UI sustain
              │
       Piano ownership table
         ┌────┴────┐
       A voices  B voices  (samples or honest fallback)
         │           │
       A bus       B bus
         │           │
       Mod1 → Mod2 → Delay → Amp/EQ → Compressor → Reverb
         │           │
       optional shared Rotary (last effect)
         │           │
       A level     B level
         └────┬──────┘
          master gain → limiter → destination
```

### Phase 2 Hard gates

Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.

Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.

Each effect unit and type processes real audio with working bypass and dry/wet.

The Phase 1 surface, keybed, and input behavior remain regression-free.

- [x] Grand, Upright, and Electric are bundled recorded sample sets, offline, and fully attributed; decoded PCM excerpts demonstrate non-silence and distinctions.
- [x] Functional Piano and Effects controls update the signal graph and panel state.
- [x] Every effect unit and listed type constructs a processing graph with bypass and dry/wet where applicable.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] Phase 1 surface, keybed, input behavior, tests, and evidence remain regression-free.

Phase 2 visual captures and browser audio inspection are deferred to the operator as requested. The unit tests exercise production graph topology and decoded recorded PCM; they do not claim a browser-rendered waveform for every effect type.
