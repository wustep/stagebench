# Stage 3 visual, binding, and interaction audit

## Sources and regression baseline

Audited against `nord-stage-4.visual.json`, `nord-stage-4.piano.json`, `nord-stage-4.effects.json`, `nord-stage-4.programs.json`, `nord-stage-4.organ.json`, `nord-stage-4.synth.json`, and variant `stage-4-73`. The inherited continuous 3.0951:1 chassis, 54/46 deck/keybed allocation, 14/20/8.5/12.5/25/20 section widths, 73-key E1–E7 geometry, and exactly two primary OLEDs are unchanged. The optional copyrighted reference photograph is not present in `inputs/reference/`, so no new pixel-trace claim is made.

The parent capture harness remains responsible for canonical `stage3-desktop.png`, `stage3-narrow.png`, and `stage3-capture.json` during sealing. Phase 1 and Phase 2 captures, metadata, and audits remain intact.

## Complete-system interaction pass

- Program OLED shows page.button or Live slot, name, BPM, transpose, Store destination, and a truthful `E` dirty indicator.
- All 32 program memories are reachable through four pages, the value dial, or the numeric list overlay. Store is a confirmable destination flow; Store As presents an in-panel naming form. Eight Live buttons auto-store through a versioned `localStorage` boundary.
- Low/Mid/High split point controls cycle all 11 documented positions. The selected point cycles Off/±6/±12 crossfade, and the focused engine layer cycles contiguous zone ranges across the four zones. Active split state is visible on the Program controls.
- Layer Scene I/II buttons apply independent seven-layer enable maps while sound parameters remain shared. Wheel and Control Pedal morph buttons latch assignment; assigned destinations show a green indicator; source movement interpolates audio parameters; double activation clears a source. MIDI CC11 drives Control Pedal.
- Master Clock supports a 30–300 BPM dial and four-tap tempo. Synced Synth LFO/arp and Effect Mod 1/Delay use the same BPM. Transpose covers −6…+6. Panic clears notes, sustain, pitch, Wheel, and Control Pedal.
- Organ A/B expose enable/focus/level/octave/zone/SUSTPED/PSTICK, six model selections (the four required distinct families plus permitted variants), nine live drawbars with LED rails, B3 percussion variants, key click, per-layer vibrato/chorus, shared effects, Rotary route/drive, and Slow/Fast/Stop.
- Synth A/B/C expose enable/focus/level/octave/zone/SUSTPED/PSTICK, all 14 required waveforms in five categories, category-correct Osc Ctrl, four filters, tracking/resonance/drive, oscillator/filter/amplifier envelopes, five LFO waves and three destinations, Poly/Mono/Legato priority/glide/unison/vibrato, and deterministic Arp/Poly/Gate rate/sync/range/direction/hold/run.
- Effects manual focus now selects Organ, Piano, or Synth and A/B/C as applicable. Organ shares one target; Piano A/B and Synth A/B/C own independent targets. Global, section group, bypass, Rotary, and all inherited unit controls remain live.

## Control-binding audit

The DOM contains one accessible input for every stable hardware ID. Required controls carry `data-functional="true"`; morph-capable destinations additionally expose `data-morph-assigned`. The following visible controls are deliberately tactile but carry `data-functional="false"`, include “unsupported” in the accessible name, and never mutate audio/system state:

- Performance Monitor Level and Panel Lock: not behaviorally specified in assigned scope.
- Program Aftertouch morph: explicitly excluded by the programs spec.
- Synth Shape: optional category not claimed by this implementation.

All other spec-excluded systems are listed in the UI footer and `IMPLEMENTATION_DETAILS.json`; no success state is faked.

## Audio and cleanup audit

One lazy `AudioContext` owns the inherited Piano racks, the Organ shared target, three Synth targets, shared Rotary, master gain, limiter, and sole destination. Deterministic rendered-audio tests prove required model/source distinctions, every drawbar, percussion/click/vibrato, Osc Ctrl categories, filters/tracking/resonance/drive, envelopes/LFO, voice plans/glide, arp/gate controls, clock changes, effects, splits, morphs, transpose, and master output. Seven simultaneously enabled engine layers create seven owned handles; Panic, blur, MIDI disconnect, layer disable, and unmount return counts to baseline.

## Responsive and accessibility regression

The desktop instrument remains 94vw with a 1380 px cap; narrow remains 96vw. Added controls stay inside the fixed hardware sections using denser hardware-scaled grids and in-panel overlays, without creating a marketing hero or detached UI rail. Native buttons/ranges and the naming form preserve accessible roles, names, values, keyboard operation, pressed state, and visible cyan focus treatment. Reduced-motion behavior remains inherited.

## Known deviations

- No redistributable recorded acoustic-piano assets were supplied. Grand, Upright, and Electric remain inherited, audibly distinct generated multi-root/multi-velocity PCM plans and are labeled as generated. The Phase 2 recorded-sample hard gate is not claimed.
- The optional reference photograph is absent, so typography and micro-placement follow the machine-readable geometry/landmarks and inherited captures rather than a new photo trace.
- Optional features are not claimed: single-level program undo, alphabetic categories, Samples mode, extra oscillators/filters, percussion poly mode, distinct B3 Bass/Pipe 2 engine families, and Rotary close-mic/stop-angle controls.
- Canonical Phase 3 browser PNG/JSON capture evidence is deferred to the required parent-owned sealing harness; the candidate-authored deterministic interaction suite completes without console instrumentation.
