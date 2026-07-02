# Fable 5 High — Stagebench evaluation

- Run: `claude-fable-5`
- Status: complete
- Classification: exploratory
- Validity: valid
- Aggregate: **96/100 · exceptional**
- Coverage: 1/1 phases

## Phase scores

| Phase | Scope | Score | Grade |
| --- | --- | ---: | --- |
| 1 | Complete surface and basic piano | 96 | exceptional |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Generated live synthesis (no recorded samples). Each note builds a small stack of detuned oscillator partials (triangle fundamental plus sine partials at 1x, 2x and ~3x) through a velocity- and pitch-keyed lowpass filter and a percussive exponential-decay gain envelope, into a shared master gain and DynamicsCompressor soft limiter, then one destination. Piano-like by design and honestly not a sampled piano.
- Generated sound sources: Basic piano-like oscillator voice
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No recorded, downloaded, or bundled audio samples are used or claimed in Phase 1.
- Audio note: Audio starts lazily on the first key gesture; status is reported truthfully as idle/loading/ready/fallback/error in the status strip below the instrument.
- Audio note: Only keybed note input and the sustain input path (space bar, MIDI CC64) reach the audio graph. Every visible panel control is decorative presentation state only.
- Audio note: All browser boundaries (AudioContext factory, timers, Web MIDI access) are injectable; unit tests run against deterministic fakes and the real graph was exercised in headless Chrome.

## Phase 1: Complete surface and basic piano

**96/100 · exceptional**

Exceptionally strong Phase 1 candidate. The rendered Nord Stage 4 73 surface reproduces the measured reference geometry almost exactly (chassis aspect 3.0951 vs registry 3.0951; 0.94 viewport width fraction; 54/46 deck/keybed split; 13/21/15/9/21/21 section widths verified in live DOM), with a complete, reference-specific six-section hardware inventory (150 panel controls + 73-key E1-E7 keybed, nine LED-laddered drawbars, exactly two OLEDs in Program and Synth, eight Program buttons matching the reference photo). Behavior was verified directly in Chromium: pointer, independent three-point multi-touch, mapped computer keyboard with repeat suppression, and truthful MIDI-denied handling all feed one note lifecycle; analyser taps on the single lazily-created AudioContext confirmed audible output, monotonic velocity response (soft peak RMS 0.107 vs hard 0.294), sustain hold/release, 24-voice deterministic stealing, and silence after blur/release. The decorative boundary is honest and proven: operating knobs/buttons/drawbars before any key press created zero AudioContexts, and the status strip explicitly declares panel controls visual-only and the voice as generated synthesis with no samples. All four technical checks pass (113/113 tests) and a rebuild reproduces the sealed dist byte-for-byte. Remaining gaps are cosmetic: ~10 legend strings ellipsis-truncated at 1440x900 (e.g. Synth OLED 'Super S…', Delay 'EFFECTS: CHOR · VIBE · ENS · FLAM · SPAC…'), sub-pixel illegible legends at 390x844 (structure fully retained, nothing clipped), simplified micro-detail, and a ~200-500ms first-note warm-up latency while the AudioContext starts.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 91 |
| Basic Piano functionality | 25% | 100 |
| Surface interaction and honesty | 15% | 100 |
| Engineering quality | 15% | 100 |

### Priority issues

- Programmatic truncation survey (textOverflow ellipsis + scrollWidth > clientWidth) at 1440x900 and 2x close-up screenshots of the Synth section.
- Narrow-viewport DOM measurements (73/73 keys visible, sections 47.8-77.2px wide) and eval-narrow screenshot.
- Fresh-context RMS sampling at 50ms intervals after the first keyboard and pointer gestures.
- Reference photo crop of the Program section (eight numbered buttons visible) and candidate stage1-visual-audit.md.

### Technical gate

Passed.
