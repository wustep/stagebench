# Stage 3 Visual and Functional Audit

Variant: Nord Stage 4 73 (`stage-4-73`)

Inherited visual checks preserved:

- 73-key E-to-E keybed: 43 white keys, 30 black keys.
- Six ordered sections remain Performance, Organ, Piano, Program / Morph, Synth, Layer Effects.
- Program and Synth remain the only primary OLED locations.
- Continuous red chassis, top rail, bottom rail, and 54/46-style deck/keybed balance are preserved from Phase 1/2.

Stage 3 exercised flows:

- Program section: page buttons, 8 program buttons, program dial/list view, Store, Store As API path, dirty indicator, edit discard on program change, and 8 Live slots with auto-store.
- Splits/zones: Mid split toggle initializes C3/C4/C5 split points; all 11 documented split positions and Off/6/12 semitone crossfades are modeled and tested.
- Scenes/morphs: Scene I/II changes layer enable state without duplicating sound parameters. Wheel and Control Pedal morph assignments interpolate and can be cleared.
- Performance: transpose range is clamped to -6..+6; Panic clears held notes and resets transpose.
- Organ: A/B layers, B3/Vox/Farf/Pipe models, nine drawbars with LED graphs, B3 percussion, key click, vibrato/chorus, and rotary slow/fast/stop state are modeled.
- Synth: A/B/C layers, required Pure/Sync/Multi/Super/FM-H waveform list, Osc Ctrl behavior, LP12/LP24/HP/BP filters, envelopes, LFO waveforms/destinations, voice modes, unison/vibrato, and deterministic arp/gate are modeled.
- Integration: Piano/Organ/Synth share one serializable system model, inherited effects/master path, and single destination declaration.

Unsupported / excluded declarations:

- `program.morph-aftertouch` is visible and movable but decorative because aftertouch is excluded for browser keyboards.
- `effects.delay-tempo` remains visible and movable but decorative; external/pedal tap timing is excluded.
- Extern, Aux KB, MIDI-out, Shift menus, preset libraries, pattern editing, tonewheel wear, swell pedal, half-pedaling, pedal noise, and effect variations are explicitly listed in the UI audit text and `IMPLEMENTATION_DETAILS.json`.

Known deviations:

- Grand/Upright/Electric are inherited generated approximations, not recorded samples. The artifact declares this truthfully.
- Store As naming is covered through the deterministic `storeAsProgram` state path rather than a text-entry modal on the compact panel.
- Organ/Synth live browser key playback is represented through the complete-system state and deterministic render probes; the inherited live Web Audio oscillator path remains piano-focused.
