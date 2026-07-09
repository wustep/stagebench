# Stage 2 visual and interaction audit

## Sources and regression baseline

Audited against `nord-stage-4.visual.json`, `nord-stage-4.piano.json`, `nord-stage-4.effects.json`, the supplied Stage 4 73 reference photograph, and the inherited `stage1-desktop.png` / `stage1-narrow.png`. The Phase 1 continuous 3.0951:1 chassis, 54/46 deck/keybed allocation, 14/20/8.5/12.5/25/20 section widths, 73-key E1–E7 geometry, and exactly two primary OLEDs remain unchanged.

The parent capture harness remains responsible for canonical `stage2-desktop.png`, `stage2-narrow.png`, and capture metadata during sealing.

## Functional panel pass

- Master Level is now a functional accessible range input connected to master gain before the limiter.
- Piano A and B expose enable/focus, independent level, octave ±12, SUSTPED, PSTICK, type/model, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, and String Res feedback.
- The Program OLED truthfully mirrors the focused live Piano model while every Program button remains decorative.
- Layer Effects exposes Piano A/B focus, group mode, per-unit on/bypass, every required type, parameters, Delay/Compressor/Reverb global toggles, feedback filter, shared Rotary, and all-effects bypass.
- Organ, Program, and Synth controls retain `data-functional="false"`; Piano, Layer Effects, and Master controls expose `data-functional="true"`.
- UI sustain, Space, and MIDI CC64 share the same engine pedal lifecycle.

## Audio graph pass

The browser graph creates one lazy `AudioContext`. Both Piano sources enter independent ordered chains, converge only after layer level, and then pass through master gain and limiter to one destination. Reverb precedes optional Rotary. Delay repeats traverse the feedback filter on every loop. Audible gain/bypass/parameter changes use 18 ms ramps. Blur, visibility loss, MIDI disconnect, all-notes-off, layer disable, and unmount clean owned handles.

Rendered-audio tests use deterministic signals and compare tolerant signal relationships rather than browser-specific exact waveforms. They cross the DSP boundary for all piano families, performance controls, every Mod 1/Mod 2/Amp/Reverb type, Delay filters, Compressor, bypass, dry/wet, order, Rotary routing, layer level, and Master Level.

## Responsive and accessibility regression

The inherited desktop width remains 94vw (maximum 1380 px), and narrow width remains 96vw. No new outer layout or fixed-width element was introduced. Functional controls reuse the inherited native button/range focus treatment and maintain unique IDs, accessible names, pressed/value feedback, and keyboard operation.

## Known deviations

- No redistributable acoustic-piano recordings were present in the isolated workspace. Grand, Upright, and Electric use audibly distinct generated multi-root/multi-velocity PCM banks and are explicitly labeled as generated, so the recorded-sample hard gate is not claimed.
- The small Piano section necessarily compresses legends at the 390 px full-chassis view; keyboard focus and browser zoom remain the practical inspection path, as in Phase 1.
- Canonical Phase 2 PNG/JSON captures are deferred to the required parent-owned capture harness at seal time.
