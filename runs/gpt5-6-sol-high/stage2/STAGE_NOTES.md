# Stage 1 implementation notes

## Run

```bash
pnpm install
pnpm dev
```

Production preview: `pnpm build && pnpm preview`.

## What is implemented

- Responsive, proportion-preserving Nord Stage 4 Compact 73 surface built with React and TypeScript.
- Full 73-key E1–E7 keyboard with accurate black-key grouping and pointer/keyboard depression states.
- Industrial red chassis, end cheeks, panel overlays, legends, dividers, front lip, highlights, gradients, and hardware shadows.
- Organ section with two layers, nine physical drawbars, LED graphs, organ models, percussion, vibrato/chorus, drive, and rotary controls.
- Piano section with two layers, library categories, selection encoder, timbre, resonance, compression, pedal, unison, and preset controls.
- Central Program section with illuminated program OLED, encoder, program/page keys, scene, split, morph, store, shift, and live controls.
- Three-layer Synth section with OLED waveform, oscillator selection, LFO, envelopes, filter, unison, glide, vibrato, and arp controls.
- Layer Effects area covering modulation, delay, amp/EQ, compressor, reverb, and layer focus controls.
- Master level, pitch stick, modulation wheel, LEDs, faders, potentiometers, rotary encoders, buttons, and display power.
- Every rendered hardware control is interactive: buttons toggle, LEDs follow state, knobs drag vertically and support arrow/Home/End keys, ranges move, displays switch, and keys depress.
- Focus-visible, hover, pressed, touch, and reduced-motion states.
- Vite is configured with `base: './'` for embedded preview routes.

## Verification

- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm build` — passed with Vite 8.1.0.
- Dev-server and built-asset HTTP smoke checks — passed.
- Parent browser verification at desktop and a 487 px narrow viewport identified and confirmed a keybed overflow caused by browser-default button sizing. White and black keys now explicitly reset `min-width` and `padding`, allowing the 73-key row to shrink within the instrument frame without horizontal overflow.
- The canonical Nord top-down photograph was inspected at full resolution and the Nord Stage 4 manual v1.4x overview/panel-control sections were used for proportions, section naming, and control taxonomy.

## Known limitation

The initial isolated subagent session had no available in-app browser window. Parent browser verification subsequently covered desktop and narrow rendering and supplied the responsive overflow finding documented above. The implementation uses no external runtime assets or network requests.

No audio code is included in Stage 1.

---

# Stage 2 implementation notes

## Piano engine

- Added a network-free multisample piano engine built on Web Audio. Seven root-note stereo `AudioBuffer` samples are rendered locally during idle time and pitch-mapped across the 73-key E1–E7 range; no remote assets or network requests are needed.
- Voices use velocity-scaled level, velocity/timbre-scaled filtering, short attack ramps, configurable normal/soft release envelopes, a 48-voice ceiling with voice stealing, and safe cleanup of ended nodes.
- Repeated notes are tracked by input-source identity, so retriggering a note releases the previous source voice cleanly while simultaneous sources remain independent.
- Piano A and B are independently enabled and leveled. The active Piano layer selects its type and model variation; type, variation, timbre, unison, mono, string resonance, dynamic compression, pedal noise, and soft release all affect playback.
- Sustain supports computer Space-bar and MIDI CC64 input. Key-up voices are deferred per layer while the pedal is down and released when it lifts. MIDI CC120/123, the on-screen ALL NOTES OFF control, window blur, page hide, and document visibility loss provide stuck-note protection.
- The master-level hardware control feeds the output stage. Reverb ON, type, size, and mix now control an internally generated stereo convolution response, with separate dry/send routing and output compression.

## Input and interface

- Pointer input derives strike velocity from the vertical hit position. Pointer IDs are tracked separately for true multitouch chords and clean pointer-cancel/lost-capture release.
- Computer mapping covers two-plus octaves (`Z–M` and `Q–P`, including number-row accidentals), with Shift for forte velocity and Space for momentary sustain. Mapped keys are identified on the physical keybed.
- Web MIDI inputs are discovered and rebound on device-state changes. Note on/off velocity, all channels, sustain CC64, and all-notes-off CC120/123 are handled; unavailable/denied/no-device states are shown without blocking the instrument.
- White keys retain Enter/Space accessible operation. Knobs and faders retain drag, arrow, Shift-step, Home, and End editing, now with controlled value support for the functional Piano/master/reverb paths.
- The program OLED is contextual: it shows active layer/model, the most recently edited parameter, the alternate layer, timbre, and reverb mix. The footer reports audio/MIDI state and exposes an accessible all-notes-off action.
- Organ and Synth visuals and Stage 1 interactions remain present and intentionally produce no audio.

## Verification

- `pnpm install` — completed; 0 vulnerabilities.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm build` — passed with Vite 8.1.0; Vite base remains `./`.
- Development-server HTTP smoke check at `127.0.0.1:5174` — passed.
- `git diff --check` — passed.
- Source-level checks covered pointer cancellation/capture, independent source retrigger, sustain deferral/release, MIDI note-on velocity-zero handling, MIDI CC120/123, blur/pagehide/visibility all-notes-off, and controlled Piano/reverb parameter wiring.
- The isolated run had no attached in-app browser (`iab` browser list was empty), so desktop/narrow screenshots, audible output, physical MIDI hardware, and live console inspection could not be performed in this session. Stage 1's proportional `cqw` layout and its existing narrow-screen rules were preserved unchanged apart from the responsive status footer and non-layout key legends.

## Audio activation regression fix

- Parent live-browser validation found that the idle-created `AudioContext` remained suspended because the first-gesture fast path returned the primed engine without calling `resume()`.
- `ensureEngine()` now uses one shared in-flight activation promise for concurrent note gestures, always resumes either a primed or newly created context, applies pending sustain state, and reports `Audio ready · sampled piano` only after the resume completes.
- The activation promise clears after success or failure. This preserves first-gesture concurrency safety while allowing a later gesture to resume the context again if the browser suspends it subsequently.
- Re-ran `pnpm typecheck`, `pnpm lint`, and `pnpm build` after the fix; all passed.

## Reference fidelity revision

- Adopted the supplied Nord Stage 4 73 top-down image as the primary visual reference and removed the incorrect “Compact” model label without changing Piano behavior.
- Rebalanced the control deck to the measured six-section proportions and reduced its rendered height relative to the keybed.
- Preserved a continuous red chassis around the panel and all 73 keys, with more visible red separators and more accurate slate, metal, red, ivory, black, LED, and OLED material roles.
- Rebuilt after the visual revision; Piano input, Web Audio, sustain, MIDI handling, and safety-release code are unchanged.
