# GPT-6 Sol High — Stagebench evaluation

- Run: `gpt-6-sol`
- Status: complete
- Aggregate: **82/100**
- Coverage: 3/3 phases


## Publishing note

Official published scores for this run include a **minimal post-run artifact fix**, not a model re-implementation:

1. Rebound unbound `fetch` used as an instance method (`this.fetchAsset`) so sample libraries could load.
2. Replaced one undecodable truncated electric sample (`ab6mp.ogg`) with a valid sibling file from the same set.

Sealed digests and blind evaluations correspond to the fixed artifacts. Phase scores: **89.6 / 74.2 / 75.9** (aggregate **82**).

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 89 |
| 2 | Piano library and working effects | 74 |
| 3 | Complete Stage 4 system | 75 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Live additive Web Audio synthesis for one basic piano-like voice. No recorded samples or external audio assets are used in Phase 1.
- Generated sound sources: Basic synthesized piano — Three sine partials per note with velocity-dependent amplitude and brightness, attack/decay envelope, and note release.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: No bundled recorded piano samples are claimed; Phase 1 permits an honestly described synthesized voice.
- Audio note: Panel controls are decorative and do not alter the signal path.

### Phase 2: Piano library and working effects

- Audio strategy: One lazy Web Audio context; two Piano layer buses through ordered per-layer effects and a shared rotary into master gain and limiter. Grand, Upright, Electric use bundled recorded samples. Clav, Digital, Misc and loading/error fallback use live synthesis.
- Generated sound sources: Clav, Digital, Misc and playable sample fallback — Live oscillator synthesis with note envelope, timbre filter, unison and resonance oscillator; no generated buffer is described as a recording.; Reverb impulse responses — Deterministic synthetic impulse data generated in AudioBuffer.
- Recorded sample provenance: Grand — AKAI Splendid Steinway — https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano (Public Domain); Upright — FreePats Kawai KW — https://github.com/freepats/upright-piano-KW (CC0 1.0); Electric — Greg Sullivan Wurlitzer EP200 — https://github.com/smpldsnds/sfzinstruments-greg-sullivan-e-pianos (CC BY 3.0 Unported)
- Bundled audio: 77 files (12.7 MB)
- Audio note: Electric uses Greg Sullivan Wurlitzer EP200 under CC BY 3.0 Unported; credit and license apply to redistributed sample files.
- Audio note: The original FLAC sources for Upright are retained alongside compressed OGG playback derivatives.
- Audio note: The sampled sets have multiple root pitches and recorded velocity layers. Grand upper register reuses a single recorded soft layer where no hard source file exists.
- Audio note: If any playback sample fails to fetch/decode, status reports sample error and synthesized fallback remains playable.
- Audio note: Electric recordings are by Greg Sullivan and distributed under CC BY 3.0 Unported. The bundled OGG files came from the smpldsnds mirror of the original sfzinstruments/GregSullivan.E-Pianos repository.
- Audio note: Upright OGG playback files were derived from the listed FreePats FLAC sources using FFmpeg mono Opus, retaining the first nine seconds. Both originals and derivatives are listed in the Upright set.

### Phase 3: Complete Stage 4 system

- Audio strategy: One lazy Web Audio context: recorded Piano A/B, live additive Organ A/B with one shared effect chain, live Synth A/B/C with independent effect chains, shared rotary, master gain, limiter, and one destination.
- Generated sound sources: Clav, Digital, Misc and playable sample fallback — Live oscillator synthesis with note envelope, timbre filter, unison and resonance oscillator; no generated buffer is described as a recording.; Reverb impulse responses — Deterministic synthetic impulse data generated in AudioBuffer.; Organ and Synth live synthesis — Live Web Audio oscillators, harmonic drawbar/register mixes, FM frequency modulation, detune stacks, noise buffers, filters, envelopes, vibrato and LFO. White Noise buffer is generated at runtime; no generated buffer is described as a recording.
- Recorded sample provenance: Grand — AKAI Splendid Steinway — https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano (Public Domain); Upright — FreePats Kawai KW — https://github.com/freepats/upright-piano-KW (CC0 1.0); Electric — Greg Sullivan Wurlitzer EP200 — https://github.com/smpldsnds/sfzinstruments-greg-sullivan-e-pianos (CC BY 3.0 Unported)
- Bundled audio: 77 files (12.7 MB)
- Audio note: Electric uses Greg Sullivan Wurlitzer EP200 under CC BY 3.0 Unported; credit and license apply to redistributed sample files.
- Audio note: The original FLAC sources for Upright are retained alongside compressed OGG playback derivatives.
- Audio note: The sampled sets have multiple root pitches and recorded velocity layers. Grand upper register reuses a single recorded soft layer where no hard source file exists.
- Audio note: If any playback sample fails to fetch/decode, status reports sample error and synthesized fallback remains playable.
- Audio note: Electric recordings are by Greg Sullivan and distributed under CC BY 3.0 Unported. The bundled OGG files came from the smpldsnds mirror of the original sfzinstruments/GregSullivan.E-Pianos repository.
- Audio note: Upright OGG playback files were derived from the listed FreePats FLAC sources using FFmpeg mono Opus, retaining the first nine seconds. Both originals and derivatives are listed in the Upright set.
- Audio note: sampleSources entries each represent an instrument set with name, source, and license; files list the members of each set for checksum verification.

## Phase 1: Complete surface and basic piano

**89/100**

A complete, recognizable Stage 4 73 surface with a genuinely working basic piano. Geometry is essentially exact: 73 keys (43/30), MIDI 28-100, 73/73 inside the keybed, black-key height 0.6099 vs 0.61, aspect 3.09514 vs 3.0951, width 0.940, and the six section fractions hit 0.14/0.20/0.085/0.125/0.25/0.20 with zero deviation. Measured against the served build, every Phase 1 input reaches one note lifecycle: pointer, real multi-touch, computer keyboard with repeat suppression, and Web MIDI with velocity (RMS 0.0050 at v20 vs 0.0906 at v127), CC64 sustain, oldest-first stealing at exactly 24 of 30 notes, and blur/disconnect returning output to exactly 0.0. The decorative boundary is honest under test and the declared source matches runtime (3 sine partials, one context, no audio assets). Weaknesses: the voice is three fixed sine partials with one decay shape - clearly not a piano to a trained ear; effects.eq-mid is fully buried under effects.compressor-amount and pointer-unreachable; and the silkscreen is barely legible - every legend renders at 5.2 px and 93 of 115 collide with a neighbour. Zero console errors throughout.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 85 |
| Playability & control | 55% | 93 |
| Feature completeness | 20% | 83 |

### Priority issues

- **major** — EQ Mid knob is completely buried and cannot be operated by pointer: At 1440x900 unscrolled, a 5x5 document.elementFromPoint grid across effects.eq-mid (x 1236.2, y 380.2, 46.7x33.7) resolves to effects.compressor-amount at all 25 points: the two controls are authored at overlapping coordinates in src/hardware.ts (Compressor Amount at 50,67 and EQ Mid at 49,67). 114/115 controls are pointer-reachable. The control remains keyboard-operable (focus + ArrowRight moved 45 -> 47), so it is present but reachable by one modality only. The Phase 1 hard gate requires every visible control to move or press accessibly, and evidence/stage1-visual-audit.md does not disclose the collision.
- **minor** — 65 of 115 control legends overlap, so much of the silkscreen is unreadable: Pairwise bounding-box comparison of the 115 .control-label elements at 1440x900 found 65 overlapping pairs, and 8 control boxes overlap each other. Rendered output shows runs such as 'DRAWBAR1DRAWBAR2...', 'LAYER SCENE1LAYER SCENE 2' and 'PITCH STICKMODULATIC WHEEL' (scratch/desktop.png). Accessible names are unaffected - all 115 controls carry correct aria-labels - but visually the controls are hard to identify.
- **minor** — 24-voice polyphony ceiling steals sustained notes: src/piano.ts sets maxVoices = 24 and pedal-held voices count against it. Holding CC64 and playing MIDI 40-69 left exactly notes 46-69 sounding; the six oldest were cut. The stealing itself is correct and deterministic, but a pianist pedalling a passage will hear notes disappear well before the hardware would.
- **minor** — Program band controls crowd and overflow the inset plate: In the rendered desktop capture the Program/Morph inset plate is narrower than its section (red chassis shows through on the left), program buttons 5-8 straddle the plate's bottom edge, the three morph-assign buttons sit at the very bottom of the deck, and the program OLED's '73 KEY HAMMER ACTION' line spills past its bezel onto the page-navigation row. All controls are present and reachable; the placement is simply tight.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**74/100**

Phase 2 is genuinely implemented, not declared. Serving build/ on :4292 and driving it with Playwright, one AudioContext feeds A/B buses -> ordered units -> layer level -> master gain -> limiter -> a single destination; 56 OGG files are fetched and decoded offline ('Recorded pianos ready'). Grand/Upright/Electric are real, audibly distinct recordings (centroid 1825/759/1256 Hz; pairwise band-L1 0.67-0.84). Every required piano control moves the signal, 12-note polyphony through the hottest amp peaked 0.484 with no clipping, and failures degrade visibly ('SAMPLE ERROR - FALLBACK', still playable). The weak half is character: Reverb is measurable but inaudible (fully wet peak 4.02e-4 vs dry 0.1011, -48 dB) so one required unit effectively does not work; Amp Sim types differ mostly by 11-20 dB of makeup gain; A-Wah is an LFO bandpass, not an envelope follower; Clav/Digital/Misc are bare saw/triangle/sine. Three panel controls in functional sections are silently inert and no gaps section is declared.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 66 |
| Playability & control | 20% | 82 |
| Feature completeness | 25% | 85 |

### Priority issues

- **major** — Amp Sim types differ mainly by makeup gain: With one C4 note, Amp Sim Twin/JC/Small take rms from the 0.01347 baseline to 0.0882/0.0488/0.1318 (peak 0.101 -> 0.439/0.313/0.466), i.e. +11 to +20 dB. The normalised tanh curve in artifact/src/stage.ts:143-145 divides by tanh(grit*...), which is effectively a large makeup gain, so the three 'distinct colorations' are dominated by level and the master limiter has to absorb the rest under polyphony.
- **major** — Clav, Digital and Misc are bare oscillators with no namesake character: artifact/src/stage.ts:241 selects sawtooth for Clav, triangle for Digital and sine for Misc, all sharing the same piano envelope and timbre filter. Measured Digital vs Misc band-L1 distance is only 0.176. Misc is specified as mallet character (marimba/vibraphone) but is an unmodified sine - the same waveform used for the sample-failure fallback - so the type has no recognisable identity.
- **major** — Reverb is inaudible at every dry/wet setting: At wet=100 the rendered output collapses to peak 4.02e-4 against a dry peak of 0.1011 (-48 dB) for all six types; at the default wet=0.35 the only change is the dry attenuation (rms 0.65x, band-L1 0.002 for Room) with a tail 53 dB under the note. The IR in artifact/src/stage.ts:151-154 is sin(i*9.73)*sin(i*2.17), a deterministic two-tone product rather than noise, and ConvolverNode's default normalisation then scales it far below the dry path. Decay ordering Booth<Room<Spring<Stage<Hall<Cathedral is correct, so the structure is right and only the level is wrong - but as shipped, the reverb knob reads as a volume kill rather than a room, while the delay by comparison sits a usable -22 dB under the dry note.
- **minor** — Timbre Bright is practically inaudible: stage.ts:228 sets a 12 kHz lowpass for Bright against 9.5 kHz for Off. Onset-aligned 350 ms windows averaged over four repeats give a >4 kHz energy fraction of 0.0715 (Bright) vs 0.0605 (Off), about 1.5 dB, while Soft drops it to 0.0355. The spec asks Bright to emphasize treble.
- **minor** — Three inert controls in functional sections are undeclared: 'piano.piano-model', 'performance.rotary-select' and 'performance.modulation-wheel' have no branch in the update() handler in artifact/src/App.tsx; driving each produced no state, audio or panel change (zero new audio-graph edges). The only honesty notice in the UI says 'Organ, Synth, and Program controls are decorative' and only those three sections get the ', decorative' aria-valuetext, so these dead controls inside declared-functional sections are never disclosed. IMPLEMENTATION_DETAILS.json has no unsupported/gaps section either, although both specs require excluded controls to be listed as unsupported.
- **minor** — String Res is a fixed octave sine, not sympathetic resonance: stage.ts:245 adds an oscillator at 440*2^((note-57)/12) - exactly one octave above the struck note - at gain 0.012, rising to 0.028 only when any other voice is live. It does not follow which notes or pedal are actually held, so the resonance does not change with the held chord as the manual describes.
- **minor** — Most effect parameters live off-panel: The modeled chassis exposes only the seven unit On buttons, twelve knobs and the three focus buttons. Effect type selection, dry/wet, delay feedback filter, Global, Compressor Fast and Reverb Bright are reachable only from the auxiliary settings strip rendered below the instrument, which the artifact's own visual audit acknowledges is not a photo-matched panel feature.
- **minor** — Layer level is applied before Rotary: In artifact/src/stage.ts:262 the To Rotary path is chain output -> level[id] -> rotary input -> master, whereas the spec's requiredOrder is Rotary when routed, then Layer level, then master gain/limiter. Audible effect is small but layer level then also scales the rotary drive.
- **minor** — Phase 2 visual audit carries no candidate measurement: artifact/evidence/stage2-visual-audit.md states that 'the Phase 2 browser capture and interaction pass is deferred' to the operator seal step and that 'No Phase 2 visual measurement or console result is claimed here'. The shipped stage2-desktop.png, stage2-narrow.png and stage2-capture.json were indeed produced by that seal step (capturedAt 2026-09-23T01:18:59.829Z against verification.json verifiedAt 01:18:59.916Z), so the audit is honest rather than contradictory - but Phase 2 ships with no candidate-run visual or console verification of its own, unlike Phase 1.
- **minor** — 12 MB of unused FLAC originals ship in the build: build/samples contains 56 OGG files that are fetched and 21 FLAC files that are never requested (the probe recorded exactly 56 sample fetches and 56 decodeAudioData calls). The upright FLAC set alone accounts for about 12 MB of the 13 MB sample payload.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**75/100**

A complete and largely working Stage 4. All three engines are genuinely distinct (spectral distances 0.75-0.97), the four organ models and all 14 synth waveforms are separate sources with category-correct Osc Ctrl, and one AudioContext feeds shared per-section effect chains, rotary (1.05/5.79 Hz), master gain and a limiter into one destination. Programs (32+8 Live), splits, transpose, panic, morphs, glide, unison and a clock-synced arpeggiator all measurably change rendered audio; pointer, keyboard and Web MIDI reach one note lifecycle and all 115 panel controls are keyboard-operable. Geometry is near-exact: aspect 3.09514, deck 0.53921, width 0.94000, section deviation 0.00001, 73/73 keys inside the keybed, 5/5 colours matched, 33/33 landmarks, 0 forbidden. Held back by real defects: an uncaught AudioNode.disconnect exception on every graph rebuild; a reload that boots factory state while falsely flagging it dirty; Layer Scenes that share continuous parameters; three engine ON LEDs lit in both states with aria-pressed inverted against the audible state; and legends at 5.25 px with 65 overlapping labels. EQ Mid is fully buried under Compressor Amount.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 75 |
| Playability & control | 20% | 66 |
| Feature completeness | 35% | 82 |

### Priority issues

- **major** — Uncaught AudioNode.disconnect exception on every audio-graph rebuild: "Failed to execute 'disconnect' on 'AudioNode': the given destination is not connected" is thrown as an uncaught pageerror once per section toggle and once per drawbar move (scratch/verify.mjs: 1 error per organ.organ-on click, 1 per drawbar input, 2 for two further toggles). Reproduced with no evaluator instrumentation attached (scratch/notap.mjs). Audio keeps working, but the shared completion gate requires an error-free console during the interaction pass.
- **major** — Reload boots the factory edit buffer and falsely reports the program as dirty: Storing an edit to slot 1.1 writes it to localStorage (the value is present in the 369018-byte 'stage4-programs-v3' payload), but after reload the app shows '1.1 CONCERT GRAND E' with factory Grand instead of the stored Clav. The 'E' dirty indicator is lit with no user edit, and the stored program only loads after navigating one slot away and back (scratch/persist.mjs).
- **major** — Layer Scenes do not hold independent continuous parameters and the panel does not follow them: Piano Level A set to 25 under Scene I and 95 under Scene II leaves both scenes reading 95 with matching audio; only layer on/off is scened (Scene II organ on 0.03085 rms vs Scene I 0.01722). The panel also does not repaint - organ.organ-on still reads aria-pressed=true in the scene where the organ is silent (scratch/scenes2.mjs, scratch/scenes3.mjs).
- **major** — Engine ON buttons are permanently lit and their pressed state is inverted: organ.organ-on, piano.piano-on and synth.synth-on carry the 'accent' class and render a lit LED in both states (off rgb(255,91,45) + 2.69px glow, on rgb(252,98,46) + 4.04px glow), so a player cannot read which engines are active; effects.delay-on by contrast goes dark rgb(65,25,27) when off. The reported state is also inverted: at boot piano.piano-on reads aria-pressed=false while the piano is the sounding layer (tapped rms 0.01784); one click sets aria-pressed=true and the rendered output drops to exactly 0.00000; a second click returns aria-pressed=false and rms 0.01800 (scratch/rv_led.mjs, scratch/rv_inv.mjs). The panel reports the opposite of what the instrument is doing on its three most prominent switches.
- **major** — Silkscreen legends overlap and truncate at rendered size: All 115 .control-label elements are 5.25 px and 65 label-box pairs overlap at 1440x900. The organ 'DRAWBARS' legend is struck through the model switches, drawbar legends clip to 'DRAWBA', LEVEL A/B is buried under PRESET 1/2, and the program OLED's text overflows its bezel onto the panel (scratch/typo.mjs, scratch/crop_organ.png).
- **minor** — Two Layer Effects / Piano controls are stacked on top of each other: effects.eq-mid (1236.2,199.4,46.7x33.7) is completely covered by effects.compressor-amount (1239,199,47x34) - all 25 hit-test points resolve to the compressor, so EQ Mid can never be operated by pointer. piano.piano-layer-b is partly covered by piano.timbre; its centre is unreachable and a Playwright click on it times out, although its left edge still passes the grid test.
- **minor** — Key click inaudible and rotary Stop not a distinct speed: Toggling keyClick changes the rendered spectrum by 0.040 and the attack/sustain ratio by 1.008 vs 1.012 - no measurable click, where percussion moves the same measures to 0.758/1.196. performance.rotary-slow-stop only clears rotaryFast, so Slow and Stop both measure 1.05 Hz pan modulation instead of the three speeds the organ spec requires.
- **minor** — Page overflows horizontally at 390x844 and legends drop to 4.09 px: documentElement.scrollWidth is 543 px against a 390 px viewport, so the whole page pans rather than just the instrument scroller; control labels render at 4.09 px and only 37 of 115 controls are reachable without scrolling.
- **minor** — Limiter allows overs under extreme polyphony: 48 simultaneous MIDI notes across all three engines peak at 1.0709 with 4 full-scale samples; the DynamicsCompressor before the destination reduces but does not prevent clipping.

### Technical gate

Passed.
