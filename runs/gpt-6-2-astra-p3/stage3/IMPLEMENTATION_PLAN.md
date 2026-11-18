# Stage 4 73 implementation plan

1. Model the E1–E7 hammer-action keybed, individual hardware controls, and six panel bands. Follow the selected photograph and the corrected fractions in nord-stage-4.visual.json.
2. Recreate the metalwork, printed legends, controls and two OLED windows. Bind the panel to presentation state only.
3. Implement a shared note lifecycle and a velocity-sensitive piano according to the Phase 1 subset of nord-stage-4.piano.json.
4. Exercise inputs, audio and layout, capture both viewports, measure the finished instrument, and record audio provenance.

## Phase 1 hard gates

- [ ] The exact keybed count and range for the assigned variant are modeled and playable.
- [ ] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [ ] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [ ] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

Assigned specs: `nord-stage-4.visual.json`, `nord-stage-4.piano.json`

## Phase 2 implementation

Retain the recorded Salamander roots and their provenance. Map the upright KW dynamics and the Rhodes roots from the pack, trim attacks, level and encode each source separately. Record exact pack paths, processing, roots, dynamics and licenses in IMPLEMENTATION_DETAILS.json.

```
Piano A/B voices → layer buses → Mod 1 → Mod 2 → Delay → Amp/EQ
 → Compressor → Reverb → shared rotary modulation when routed
 → layer faders → master gain → limiter → destination
```

Connect the physical controls to layer and routing state. Verify the graph using rendered signals, exercise the panel in Chromium, and compare the canonical captures with Phase 1.

## Phase 2 hard gates

- [ ] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [ ] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [ ] Each effect unit and type processes real audio with working bypass and dry/wet.
- [ ] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [ ] The Phase 1 surface, keybed, and input behavior remain regression-free.

Assigned specs: `nord-stage-4.visual.json`, `nord-stage-4.piano.json`, `nord-stage-4.effects.json`
# Phase 3 hard gates

Paste the checklist below into `IMPLEMENTATION_PLAN.md` exactly as it is. The seal checks that every sentence
appears there word for word (line wrapping does not matter; rewording does), and that the plan names each
assigned spec file.

```markdown
## Phase 3 hard gates

- [ ] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [ ] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [ ] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [ ] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [ ] All inherited visual, piano, effects, and input behavior remains regression-free.

Assigned specs: `nord-stage-4.visual.json`, `nord-stage-4.piano.json`, `nord-stage-4.effects.json`, `nord-stage-4.programs.json`, `nord-stage-4.organ.json`, `nord-stage-4.synth.json`
```

## Implementation order

Use a versioned bank of named snapshots. Each snapshot owns piano parameters, organ registrations, synth patches, shared and independent effect settings, zone ranges, split boundaries, scene masks, morph endpoints, tempo and transposition. Master gain and physical input positions belong to the session. Edit a working copy and compare it with its stored slot. Commit Live edits immediately.

Feed zone-weighted notes into the existing piano voices and generated organ/synth buses, then through the same rack and limiter. Audit the physical inventory against bindings, OLED actions and explicit exclusions. Exercise the complete input path, slot lifecycle and rendered signals before capturing both viewport sizes.
