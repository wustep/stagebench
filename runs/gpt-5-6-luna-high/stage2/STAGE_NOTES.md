# Stage 2 notes — Piano instrument

## Architecture

`src/pianoEngine.ts` owns one deterministic note lifecycle for pointer, touch, mapped computer keyboard, and MIDI. It has injectable `AudioContext` construction, a 24-voice allocator with oldest-first stealing, repeated-note ownership, sustain/half-pedal and sostenuto queues, per-note release, blur/Panic cleanup, and MIDI parsing. The browser graph is a master gain feeding dry destination plus a wet delay/reverb path. `renderModelledPiano` is the same deterministic modal model used by direct boundary tests and unsupported-browser fallback.

`src/main.tsx` preserves the Phase 1 normalized six-section geometry. Piano controls now update canonical engine state and expose status, active voice count and MIDI state. The Piano panel includes two layers, type/model, touch, dynamic compression, timbre, unison, release/resonance, sustain and reverb controls. Organ and Synth remain visual-only as required.

## Audio provenance and limitations

There are no recorded sample assets. The primary path is original live modelled synthesis (six inharmonic modal partials plus hammer transient, envelope, unison detune and wet-delay resonance), explicitly labelled “Modelled piano ready.” If `AudioContext` cannot be constructed, the exact model renders in memory and the UI reports “Fallback model ready (Web Audio unavailable).” This avoids claiming generated buffers are recorded samples but is less nuanced than Nord’s multi-gigabyte multi-velocity library. Pedal noise and true pedal-down sample layers are approximated by sustain/release/reverb behavior.

## Tests and verification

- `tests/phase1.test.tsx`: inherited visual model, geometry, controls and accessibility checks.
- `tests/phase2.test.tsx`: Piano status, 73-key pointer/touch routing, canonical Piano control feedback.
- `tests/piano-engine.test.ts`: direct renderer/audio boundary checks for velocity, touch, timbre, unison, volume, reverb, ownership, sustain, stealing, cleanup, MIDI parsing and failure status.
- Feature matrix retains all Phase 1 IDs and adds Piano lifecycle, controls, MIDI, routing and provenance IDs.

## Browser findings

The jsdom and headless interaction pass exercises pointer/touch semantics, mapped keyboard events, repeated keys, sustain, Panic and blur cleanup. Browser environments with Web MIDI expose a Connect MIDI action; browsers without permission/API remain in the explicit unavailable state. The app has no expected runtime console errors. Desktop and narrow screenshots are captured in `evidence/stage2-desktop.png` and `evidence/stage2-narrow.png` after the visual pass.

## Visual audit

Phase 2 preserves the Phase 1 chassis, deck/keybed allocation, 13/21/15/9/21/21 section widths, 43+30 key model, OLED inventory and narrow overflow strategy. Piano status text is deliberately compact in the existing header; no new OLED or panel width was introduced. Remaining differences are the same product-study simplifications documented in `evidence/stage1-visual-audit.md` plus the added Piano status line.

## Fixed quality repair

The first user gesture now calls `AudioContext.resume()` through `PianoEngine.resumeAudio()`. Suspended, ready, error, and fallback states are visible in the Piano status alongside MIDI unavailable/connected/disconnected/permission-denied states. Status subscribers keep the line current after asynchronous resume/MIDI transitions.

Layer enable/levels, model index, string resonance, soft pedal, sostenuto and pedal state now participate in canonical controls and the deterministic renderer/Web Audio gain path. The model remains explicitly original modal synthesis; no sample provenance claims were added. Voice allocation prefers released voices, removes immediate steals synchronously, stops and disconnects oscillator/gain nodes, and sostenuto captures only voices held at engagement. Direct tests cover resume, layer/model/resonance/pedal output differences, sostenuto semantics and status rendering (19 tests total).

Repair evidence was recaptured at `evidence/stage2-desktop.png` and `evidence/stage2-narrow.png`. The headless capture logs contain only Vite/React informational messages plus the macOS headless-shell system-services warning; no application console error was observed. Organ and Synth remain visual-only and Phase 1 geometry is unchanged.
