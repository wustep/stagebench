# Composer 2.5 Fast — Stagebench evaluation

- Run: `composer-2-5-fast`
- Status: complete
- Aggregate: **58/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 68 |
| 2 | Piano library and working effects | 58 |
| 3 | Complete Stage 4 system | 52 |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Phase 1 basic piano via honest additive synthesis (triangle + sine overtone oscillators with AD envelope). No recorded samples in Phase 1.
- Generated sound sources: basic-piano-voice
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Phase 1 uses live Web Audio synthesis only; recorded sample sets are Phase 2 scope.
- Audio note: Polyphony limit 32 with deterministic oldest-voice stealing.
- Audio note: Sustain pedal supported via note lifecycle and MIDI CC64.

### Phase 2: Piano library and working effects

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `node-web-audio-api` ^2.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One AudioContext with Piano A/B layer buses, per-layer effect chains (Mod1→Mod2→Delay→Amp/EQ→Compressor→Reverb), shared Rotary via To Rotary, master gain and limiter. Grand/Upright/Electric/Clav/Digital/Misc use programmatically synthesized offline sample sets (not field recordings).
- Generated sound sources: piano-sample-sets; synth-fallback-voice; effects-impulse-responses
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Grand, Upright, and Electric are audibly distinct synthesized sample sets — honestly declared as generated, not recordings.
- Audio note: Organ, Synth, and Program controls remain presentation-only (Phase 1 honesty preserved).
- Audio note: Master Level knob scales master gain; Panic via blur/all-notes-off clears voices.
- Audio note: Sustain honors per-layer SUSTPED toggle.
- Audio note: Polyphony limit 32 with deterministic oldest-voice stealing per layer pool.

### Phase 3: Complete Stage 4 system

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `node-web-audio-api` ^2.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One AudioContext with Piano A/B layer buses, shared Organ bus + effect chain, Synth A/B/C independent effect chains, inherited Mod1→Mod2→Delay→Amp/EQ→Compressor→Reverb order, shared Rotary, master gain and limiter. Piano Grand/Upright/Electric use programmatically synthesized offline sample sets. Organ uses live additive synthesis (tonewheel/transistor/pipe models). Synth uses live Web Audio oscillators with filters, envelopes, LFO, and deterministic arpeggiator.
- Generated sound sources: piano-sample-sets; organ-additive-engines; synth-oscillator-engines; effects-impulse-responses
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Grand, Upright, and Electric are audibly distinct synthesized sample sets — honestly declared as generated, not recordings.
- Audio note: Organ and Synth are live synthesis engines, not sample playback.
- Audio note: Programs serialize all supported state except Master Level; 32 slots + 8 Live auto-store slots.
- Audio note: Spec-excluded controls listed in unsupported-controls.ts remain presentation-only.
- Audio note: Panic (Shift+Transpose) sends all-notes-off and resets transpose/mod wheel/control pedal.

## Phase 1: Complete surface and basic piano

**68/100**

A structurally honest but visually thin Phase 1. The chassis silhouette, red/dark-inset palette, 54/46 deck-keybed split, and a full 73-key E-E keybed (43 white / 30 black, correct black-key pattern and 61% height) are all in place, and a real dual-oscillator additive piano voice (triangle + sine overtone, velocity-scaled AD envelope) is truthfully declared as synthesis in IMPLEMENTATION_DETAILS.json with no recorded-sample claims. The honesty boundary is clean: every panel control is a presentation-only range/switch/button that only mutates a normalized presentation-state map, the two OLEDs (Program + Synth only) show static 'Init Program'/'Init Synth' with no fabricated feature reporting, and a test verifies toggling an Organ switch leaves 'Piano: ready' unchanged. The note lifecycle is complete and well-factored across injectable audio/MIDI/timing boundaries: pointer/multitouch/computer-key (with repeat suppression via e.repeat and code-keyed held set) / MIDI note+velocity+CC64 sustain, denied/disconnected MIDI ignored, deterministic oldest-voice stealing at a 32-voice cap, sustain latch, and blur/disconnect/unmount all-notes-off cleanup. The dominant weakness is visual fidelity: sections are rendered as a uniform flex-wrap grid of identical dark label-boxes with text captions, which is exactly the 'single undifferentiated control grid' / 'uniform repeated knob matrix' the visual spec lists as forbidden for organ, synth, and effects. There is no drawbar-bank rendering, no LED ladders, no distinct knob/dial industrial forms, and the program dial is a tiny slider. Section widths use the older 13/21/15/9/21/21 fractions (piano too wide, program/synth too narrow) that the current visual spec explicitly corrected as photo-contradicted, though the stage-1 prompt still instructed those values. A second real gap is test depth: the entire Web Audio backend is mocked with no-op oscillator/gain nodes and a MockOfflineAudioContext whose startRendering returns a fixed 440Hz sine regardless of input, so no test proves rendered output differs from silence or that velocity/sustain move the actual signal; the unused measureOutputLevel helper would return a constant under those mocks. Audio behavior is asserted only through voice-count and gain-math checks.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 61 |
| Basic Piano functionality | 25% | 75 |
| Surface interaction and honesty | 15% | 86 |
| Engineering quality | 15% | 61 |

### Priority issues

- Panel sections render as a uniform flex-wrap grid of identical dark label-boxes with no drawbar bank, LED ladders, or distinct knob/dial forms, matching the visual spec's explicitly forbidden 'single undifferentiated control grid' / 'uniform repeated knob matrix' for organ, synth, and effects.
- Section widths use the pre-correction fractions (13/21/15/9/21/21) that the current visual spec flags as photo-contradicted (piano too wide, program/synth too narrow); the stage-1 prompt still lists those older values, so the candidate followed its prompt but drifts from the authoritative reference photo.
- All audio tests run against no-op mock nodes and a MockOfflineAudioContext returning a fixed sine, so no test proves rendered output differs from silence or that velocity/sustain/release change the actual signal; the real measureOutputLevel helper is unused. Voice behavior is asserted only via counts and gain math.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**58/100**

A genuinely connected, honest audio phase built on a thin, schematic surface. The shared graph is real and correct — one AudioContext, per-layer Piano A/B buses, an ordered Mod1→Mod2→Delay→Amp/EQ→Comp→Reverb chain, To-Rotary send, master gain and limiter, one destination — with real dry/wet crossfades, per-unit and all-effects bypass, delay feedback+filter, and panel controls actually wired into the engine via presentationToAudioState/updateState. Real-boundary offline-render tests prove instrument distinction, velocity, layers, master level, SUSTPED, fallback, reverb wet, and combined bypass. The decisive limitation for this phase is honesty-correct but requirement-missing: Grand/Upright/Electric are OfflineAudioContext-synthesized tone sets, truthfully declared as 'synthesized' (sampleSources: []), not the bundled recorded sample sets the phase requires — so instrumentBreadth is capped low though it is NOT the 0 reserved for generated buffers presented as recordings. Secondary gaps: within-unit effect types are largely undifferentiated (Mod1's six types collapse to one tremolo; Amp's seven types are drive-scaled; LP24/HP24 not real filters), no tests exercise Mod1/Mod2/Delay/Amp/Comp individually or per-type distinction, both layers always share one effect-state object (resolveEffectsForLayer returns the same fx in every branch), and the surface is a wireframe far from the reference photo with a narrow layout that collapses to unusable overlap.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual and interaction retention | 10% | 50 |
| Piano library and performance | 35% | 53 |
| Effects and signal graph | 30% | 56 |
| System behavior and UX | 10% | 62 |
| Engineering quality | 15% | 75 |

### Priority issues

- Phase-2 hard requirement unmet (but declared honestly): Grand/Upright/Electric are OfflineAudioContext-synthesized tone sets, not bundled recorded sample sets. samples.ts stamps provenance 'synthesized' and IMPLEMENTATION_DETAILS.json sets sampleSources: [] and calls them 'not recordings' — so this is not the score-0 case of generated buffers presented as recordings, but the required recorded/redistributable-file provenance is absent, capping instrumentBreadth.
- Within-unit effect-type distinction is largely unimplemented: Mod1's six spec types collapse to one sine tremolo (only Ring Mod boosts depth), Amp/EQ's seven types are drive-scaled with LP24/HP24 not realized as filters, and no rendered test proves per-type audible difference, so the spec's 'every listed effect type audibly distinct' is not satisfied.
- resolveEffectsForLayer returns the same fx object in every branch, so Piano A and B always share one effect-state; group/global-mode flags exist but do not change per-chain state, and there are no rendered tests for focus/group/global routing.
- The surface is a schematic wireframe far from reference/nord-stage-4-73.jpg (plain sliders/labeled boxes rather than knobs/rockers/LED ladders/drawbars), and the 390x844 narrow layout collapses the deck into overlapping, truncated controls.
- The live component never calls engine.dispose() on unmount (only lifecycle.dispose), so the AudioContext is not closed — a resource-cleanup gap not covered by tests.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**52/100**

A genuinely distinct, honestly-declared audio core sits atop a Program/performance layer that is implemented as tested pure functions but is entirely disconnected from the rendered instrument. Organ (B3/Vox/Farf/Pipe additive) and Synth (Pure/Sync/Multi/Super/FM-H) engines are real, category-distinct topologies wired to the keybed through one shared AudioContext and effect path, with real-boundary rendered-audio tests. But createProgramSystem/saveToCurrentSlot/selectProgram, addMorphDestination/clearMorphSource, bpmFromTapTimes, and engine.panic() are never imported or called by App/instrument/components: the panel's program buttons, Store, list view, scene toggles, morph-assign, split, tap-tempo, and Panic are silent no-ops, and several read keys mismatch their control IDs (program-split-on vs program-split, scene-i-active vs scene-i, unread synth-filter-type). All four technical gates pass. Visual fidelity is low versus the reference (generic slider grid, no LED drawbar graphs, truncated labels), narrow layout loses controls, and the Phase 2 and Phase 3 desktop captures are pixel-identical.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Final visual fidelity | 5% | 25 |
| Complete feature system | 35% | 43 |
| Audio quality and integration | 30% | 76 |
| Full-system behavior | 20% | 40 |
| Engineering quality | 10% | 56 |

### Priority issues

- Program/performance subsystem (programs.ts, morph assignment, tap-clock, Panic) is fully implemented and unit-tested but never imported by App/instrument/components — program buttons, Store/Store As, Live mode, list view, scenes, morph-assign, split editor, tap-tempo, and Panic are non-functional from the running instrument.
- Control-ID vs read-key mismatches make several panel controls silent no-ops: program-split (read as program-split-on), program-scene-i/ii (read as *-active), program-clock-bpm (no emitting control), and synth-filter-type is never read.
- hardware.bindings test only checks a prefix predicate (isFunctionalControl) and does not prove canonical behavior, so many no-op controls pass; undeclared no-op fallbacks are not listed as unsupported.
- Arp scheduling (scheduleArp) spawns notes on a timer but never issues note-off for them, risking stuck/accumulating voices under sustained arp play.
- Visual fidelity is low versus reference (generic slider grid, truncated labels, no LED drawbar graphs); Phase 2 and Phase 3 captures are byte-identical and narrow layout drops most controls.

### Technical gate

Passed.
