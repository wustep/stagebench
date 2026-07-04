# Stage 2 Visual and Interaction Audit

Scope checked against `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, and `specs/nord-stage-4.effects.json`.

What changed:

- The inherited Stage 4 73 chassis, E-to-E 73-key keybed, section order, Program/Synth OLED placement, and decorative Organ/Synth/Program behavior remain in place.
- Piano controls now bind to canonical state for section/layer enable, layer focus, layer level, octave, SUSTPED/PSTICK, six types, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, and String Res.
- Layer Effects controls now bind to Piano A/B effect state for Mod 1, Mod 2, Delay, Amp Sim/EQ, Compressor, Reverb, and shared Rotary. Organ/Synth FX focus and Delay Tap/Tempo are visible decorative controls in this phase.
- Master Level is functional and feeds the master gain/probe output.

Audio/evidence:

- `src/App.test.tsx` exercises Phase 1 regression behavior plus rendered Float32Array probes for six piano types, two-layer voice ownership, pedal routing, performance controls, effect graph order, bypass/group/global state, every listed effect unit/type, master level, fallback status, and cleanup.
- `IMPLEMENTATION_DETAILS.json` declares all generated piano approximations and their license/provenance. No generated buffer is described as a recording.

Known deviations:

- The prompt asks for recorded Grand/Upright/Electric sample sets. No redistributable recorded assets were available inside candidate, so this implementation uses truthful generated offline approximations. The visible status and details file state that they are not recordings.
- Delay Tap/Tempo is decorative; delay time/rate, feedback, mix, global flag, and feedback filter are functional.
- Organ, Synth, Program, splits, scenes, and morphs remain decorative per Phase 2 scope.
