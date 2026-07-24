# Claude Opus 5 High — Stagebench evaluation

- Run: `claude-opus-5`
- Status: in-progress
- Aggregate: **91/100**
- Coverage: 1/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 91 |
| 2 | running | — |
| 3 | queued | — |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/node` ^24.13.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Live Web Audio synthesis. There are no recorded samples and no audio files of any kind in this artifact. Each note builds a voice from three OscillatorNodes (a sine fundamental plus two slightly inharmonic partials at 2.0027x and 3.0142x, each with its own exponential decay), summed into a per-voice GainNode set from velocity, through a per-voice lowpass BiquadFilterNode whose cutoff tracks pitch and velocity, into a shared piano-bus GainNode and then a master GainNode connected to the destination. A short hammer transient is played from one AudioBuffer of deterministic pseudo-random noise generated at engine construction time. Nothing bypasses the master gain.
- Generated sound sources: Piano partials (fundamental plus two inharmonic partials) — An honest approximation of a struck string: partial ratios are stretched slightly to model inharmonicity, upper partials decay faster than the fundamental, harder strikes put more energy into the upper partials and open the filter further, and low notes ring longer than high ones. It is not derived from, modelled on, or measured against any specific instrument or recording.; Hammer strike transient — A 90ms mono buffer of seeded pseudo-random noise (linear congruential generator, fixed seed 0x5eed1234) under a cubic decay envelope, shared by every voice. Deterministic: identical on every load. This is a generated buffer, not a recording of a piano hammer.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No recorded sample sets are used or claimed in Phase 1, and no audio asset files ship in the artifact. The piano spec lets Phase 1 ship either a declared bundled sample set or honestly described synthesis; this artifact ships synthesis. Recorded, bundled, redistributable sample sets for Grand, Upright and Electric are Phase 2 scope and are deliberately absent here.
- Audio note: Only the keybed and the sustain input produce sound. All 146 controls on the six panel sections are presentation state only and are connected to no audio node whatsoever. This is asserted, not merely stated: a test operates every control in the inventory and shows the rendered destination output stays at digital silence and the audio graph node count does not change.
- Audio note: Audio, MIDI and timing are injectable boundaries (src/audio/graph.ts, src/audio/host.ts, src/input/midi.ts). Tests substitute a deterministic offline Web Audio implementation (src/audio/offline.ts) that really evaluates oscillators, buffer playback, parameter automation and the biquad filter sample by sample, so audio claims are asserted on rendered signals rather than on mocks. jsdom ships no Web Audio at all, so that renderer — not a browser audio engine — is what produces the sample data under test.
- Audio note: Reported audio states are only the ones that can really occur: unsupported (no Web Audio in the browser), idle (context suspended pending a user gesture), starting, ready, error. There is no asset download in Phase 1, so no loading progress is invented.
- Audio note: Polyphony is capped at 32 voices with deterministic stealing: the longest-running releasing voice first, then the longest-running sustained voice, then the longest-running sounding voice.

## Phase 1: Complete surface and basic piano

**91/100**

A very strong Phase 1 artifact. The surface is built entirely from hand-written DOM/CSS (0 <img>, 0 background url() in the running page) and hits the assigned geometry numerically: aspect-ratio 3.0951, deck/keybed 0.540/0.460, section fractions exactly 0.14/0.20/0.085/0.125/0.25/0.20, 73 keys (43 white / 30 black, E1-E7), black/white width ratio 0.6500 and height ratio 0.6100, instrument 1368px = 0.950 of a 1440px viewport with no vertical scroll. All 146 panel controls render once each in the right section, with role, accessible name, valuemin/max/now/valuetext, tab focus and a visible focus ring. The basic piano voice is real and dependable: measured on a live analyser tap at the destination, a keybed strike produces rms 0.40-0.50, velocity moves output monotonically (soft strike peak 0.16 vs hard 0.90; MIDI velocity 10 rms 0.017 vs 127 rms 0.483), release drops the tail to 0 within 250ms, sustain (Space, on-screen pedal, MIDI CC64) keeps it at 0.447 at the same delay and damps it on pedal up, and blur/disconnect/CC123/unmount return the graph to digital silence. The honesty contract holds under active testing: operating all 146 controls produced 0 additional AudioNode.connect() calls, and a held note decayed along an rms trajectory identical to four decimal places (0.5165 -> 0.4520, ratio 0.8751) whether or not master level, layer levels, reverb wet, a drawbar and five section On buttons were driven meanwhile. IMPLEMENTATION_DETAILS.json declares live synthesis plus one generated noise buffer and no recordings; the measured spectrum of C4 (partials at 257.8 / 515.6 / 796.9 Hz) matches the declared 1.0 / 2.0027 / 3.0142 ratios exactly. Main weaknesses: the chassis end cheeks are painted over the deck (z-index 6), truncating the right column of Layer Effects and blocking pointer clicks on four controls; ~9% of panel legends are occluded by neighbouring elements; and there is no master limiter, so an 8-note chord peaks at 1.89 and 40 held notes at 3.83 before the destination clamp, i.e. dense chords clip audibly.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 91 |
| Basic Piano functionality | 25% | 90 |
| Surface interaction and honesty | 15% | 86 |
| Engineering quality | 15% | 100 |

### Priority issues

- The chassis end cheeks (.chassis__cheek--left/--right, z-index 6, 23.3px each at 1440px) are painted over the deck instead of beside it. At the right end this truncates the Layer Effects column in the canonical desktop capture (FEEDBACK, FILTER, PING PONG, VAR|CHORALE, and the Reverb STAGE/HALL/CATH column are cut) and blocks pointer clicks at the centre of fx.delay.feedback, fx.delay.filter, fx.delay.on and fx.reverb.on; a real click on fx.delay.on did not toggle it, though Enter on the focused control did.
- No master limiter or polyphony-aware gain staging. Measured at a destination tap: single hard strike peak 0.903, 8-note chord peak 1.893 with 564/2048 samples at or above 0.999, 40 notes peak 3.832. Dense chords clip audibly at the output.
- 25 of 268 panel legends/group titles are occluded at their centre by a neighbouring element (e.g. ON/OFF under a drawbar, PAGE NAME under the program dial, MON/COPY and PASTE under the Shift plate, and the MOD 1 / MOD 2 / AMP SIM/EQ / COMP / REVERB / ARPEGGIATOR-GATE group titles half-hidden behind their group plates), and the Delay MST CLK badge is printed across the TAP/SET button.
- evidence/stage1-visual-audit.md section 2 states 'Every section was also checked programmatically for children escaping its own bounding box; all six report zero horizontal overflow.' My measurement found small overflows in piano (4.6px, the DYN COMP cluster) and program (1.0px, SECTION EDIT). The audit also does not mention the end-cheek occlusion. Both are accuracy slips in a write-up that is otherwise unusually candid; neither claims unimplemented behaviour.
- The on-screen key highlight follows held input keys rather than engine voices, so with more than 32 keys held every key lights although only 32 voices sound.

### Technical gate

Passed.
