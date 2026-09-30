# Phase 3 visual and interaction audit — Stage 4 73

Reference: `inputs/reference/nord-stage-4-73.jpg`. Assigned sources: `inputs/specs/nord-stage-4.visual.json`, `nord-stage-4.piano.json`, `nord-stage-4.effects.json`, `nord-stage-4.programs.json`, `nord-stage-4.organ.json`, `nord-stage-4.synth.json` and `benchmark-phases.json`, all under `inputs/specs/`.

Canonical Phase 3 PNG/JSON captures and the sealed verification digest belong to the operator harness: `pnpm bench seal gpt-6-1-sol`. No workspace-local capture harness was created or run. `stage3-review-desktop.png` and `stage3-review-narrow.png` were taken directly with the Playwright screenshot CLI solely for local visual inspection, not as canonical captures. All inherited Phase 1–2 evidence is retained.

## Visual comparison

The complete red chassis remains continuous. The 73 E1–E7 keys retain 43 white/30 black keys and the inherited black/white spacing, heights and shadows. Deck/keybed allocation remains 54/46, chassis aspect 3.0951, and ordered section fractions remain Performance 14%, Organ 20%, Piano 8.5%, Program 12.5%, Synth 25%, Effects 20%. Performance and Program retain exposed red rather than inset full-width dark plates. Organ remains the nine-drawbar bank; Piano remains a compact narrow band; effects retain separated groups. Program and Synth remain the only two primary OLEDs.

At 1440×900, the whole chassis, utility inputs, collapsed settings, scope notes and credits fit in the initial viewport. The direct desktop screenshot was inspected against the assigned photo and inherited layout. The initial 390×844 screenshot also shows the entire chassis without horizontal overflow or clipped keys; the collapsed summaries and scope link remain visible. Inspect scales the chassis within its scroll container; scrolling reaches E7 and Fit restores the overview. Native browser tests assert key/control counts, aspect allocation, reachability of every physical control, and page bounds.

Visible additions are canonical feedback: Program slot/name/E/Live/scene/tempo/transpose; Synth waveform/category/filter/voice mode and amplifier envelope curve; active split LEDs; four zone LEDs per layer; green morph indicators and assigned drawbar/fader ranges. These are embedded into the existing panel. Store naming/destination, numeric list, and detailed sound/performance controls appear outside the chassis. The detailed settings are closed initially.

Inherited limitations remain explicit: grouped micro-legends and some secondary controls are compact reference approximations, rather than a pixel-exact hardware transcription. Initial desktop header spacing was reduced modestly to accommodate the two added collapsed disclosure rows while preserving a 900-pixel page. At phone fit scale, fine legends are intentionally inspected through enlargement. The inherited compact Synth Mix/Shape/Sustain labels are disclosed aliases for coarse pitch, oscillator envelope amount, and envelope velocity; maximum decay is sustain mode. The [complete control audit](stage3-control-audit.md) records every physical ID.

## Browser pass and audio evidence

The production browser interaction pass exercises factory Organ/Synth programs, layer enables/focus, drawbars, Store As character insertion/deletion, destination audition/confirm/cancel, pages/buttons/dial/numeric list, Live slot reload, editable split points/crossfades/zones/LEDs, scenes, both morph sources/indicators/clearing, master tempo, arpeggiator and Shift+Transpose Panic. An additional gesture pass checks held Master Clock plus dial, held Wheel assignment, double-tap latch, long-press split editing, Escape, desktop/narrow bounds and all 140 control hit targets. No browser console errors are accepted.

Audio tests use the exact production streaming DSP and native OfflineAudioContext with real AudioWorklets. They compare all four required Organ spectra and all fourteen Synth waveforms; drawbars/register thresholds, percussion/click/chorus/vibrato; category-correct Osc Ctrl; filters/tracking/resonance/drive; all three envelopes, velocity and LFO waveforms/destinations/sync; voice modes/priority/glide/unison/vibrato; deterministic arp/poly/gate/rate/direction/range/hold/run. Native combined renders prove seven-layer ownership, six chains, five engine processors, one shared Rotary, one injected context, Master mute, section effects/bypass, split gains, morph audio and release tails. Panic/dispose returns voice maps, sample caches, acknowledgement queues, ports, graph arrays and input reset listeners to baseline. Limiter latency is allowed before evaluating release-tail silence.

All inherited tests and feature mappings remain. Two Phase 2-only assertions were advanced to Phase 3 semantics: the honesty text now says the new engines are active, and the decorative-control browser check uses the still-excluded Organ Preset instead of the now-functional Organ Model. No regression test was removed. All 18 Phase 3 IDs map to nonempty tests.

## Candidate gates

Final verification inside `candidate/`:

- `pnpm test`: **passed**, 7 test files / 65 tests, including every inherited case. Browser test servers use separate Vite caches to avoid dependency-optimizer races.
- `pnpm typecheck`: **passed**.
- `pnpm lint`: **passed**, no warnings.
- `pnpm build`: **passed**, Vite produces `dist/index.html` with relative base `./` and bundled sample/DSP assets.

The final interaction/gesture passes accepted no browser console errors. All 140 physical controls are accounted for: 137 canonical bindings, 3 explicit spec exclusions. Every inherited feature mapping and all 18 Phase 3 IDs are present. The source, built artifact and written evidence are ready for operator sealing. Canonical operator capture remains pending by design.
