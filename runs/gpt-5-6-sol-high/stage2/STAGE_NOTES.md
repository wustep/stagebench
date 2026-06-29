# Stage 1 implementation notes

## Visual inventory and measurable contract

- Instrument silhouette: one continuous red chassis at **3.095:1 width-to-height**, centered on a neutral warm-gray product-study surface. Desktop target width is 94vw (within the required 88–97%).
- Vertical allocation: control deck including the top rail is **54%**; keybed including bottom rail is **46%**.
- Horizontal panel allocation: Performance **13%**, Organ **21%**, Piano **15%**, Program/Morph **9%**, Synth **21%**, Layer Effects **21%**.
- Chassis continuity: top rail, lower lip, and both deep red end cheeks are a single outer element. Six blue-gray inset control plates leave narrow strips of chassis red visible between them.
- Keyboard: **73 chromatic keys, E1 through E7**, composed of **43 white and 30 black** keys. Black key height is 61% of the keybed.
- Control hierarchy: tall layer/drawbar faders and primary encoders are largest; secondary rotary knobs are mid-sized; rectangular switches, LED pips, and legends are smallest.
- Dominant colors: chassis `#79232c` / `#721f29`, panel `#3c424d`, white keys `#dcdcdc`, black keys `#0b0b0b`, with red status LEDs, green meters, cyan OLED glass, and white legends.
- Performance density: sparse by design—pitch stick, modulation wheel, master level, two layer-scene buttons, and branding.
- Organ density: nine drawbars, organ OLED, model selector, preset controls, rotary/vibrato/percussion switches, and level meter.
- Piano density: two tall level faders/meters, type/model selectors, timbre/dynamic/unison controls, and small OLED.
- Program/Morph density: central OLED, program encoder, live/program keypad, morph source controls, and shift/store navigation.
- Synth density: layer faders/meters, full-width OLED, oscillator/filter/envelope/arpeggiator knob clusters, and assignment switches.
- Effects density: layer select column plus effect 1/2, amp/EQ, modulation, delay, compressor, and reverb clusters.

## Architecture

The hardware is represented as normalized section and control data with globally stable IDs. Controls retain section-specific type, size, label, grouping, and initial state; React components interpret that map without flattening the distinct hardware clusters.

The 73-key model is derived chromatically from MIDI 28 (E1) through MIDI 100 (E7). White-key position is calculated independently from chromatic index so the 30 black keys can be absolutely placed over a 43-key white-key bed without overflow. Panel geometry is expressed in normalized fractions and the complete instrument uses a fixed `3.0951 / 1` aspect ratio.

## Running and verification

- Development server: `pnpm dev`
- Deterministic tests: `pnpm test`
- Static checks: `pnpm typecheck` and `pnpm lint`
- Embeddable production build: `pnpm build` (Vite `base: './'`)
- Current suite: 4 test files, 10 tests, all passing.
- Feature matrix: all 8 required Stage 1 IDs mapped exactly once to existing tests.

## Visual refinement log

- Preflight comparison corrected the panel geometry from equal-sized generic columns to the measured 13/21/15/9/21/21 allocation.
- The chassis was consolidated into one clipping and shadow context so the top rail, red panel dividers, end cheeks, keybed, and lower lip read as a single physical object.
- All small modeled clusters remain visible. Detail, rotary, morph, arpeggiator, and utility groups are not removed at narrow widths; the whole hardware surface scales as one object.
- Key placement uses the E-to-E pitch model rather than repeating an arbitrary octave strip, preventing the final E7 and end-cheek alignment from drifting.
- Browser correction pass 2 preserved the verified 1353.6×437.3 chassis geometry and 54/46 allocation while restoring the reference material hierarchy: the Performance hardware and logo now sit directly on muted red metal, the six section breaks expose wider red chassis dividers, and the existing top-rail row has stronger red highlight/shadow framing without changing its height.

## Stage boundary

All interactions are visual and deterministic. No audio engine, Web Audio graph, MIDI behavior, or instrument synthesis is introduced in Stage 1.

# Stage 2 implementation notes

## Piano engine

- Added an injectable `PianoEngine` with deterministic note-on, note-off, same-note retrigger, sustain, all-notes-off, 32-voice polyphony, oldest-voice stealing, and cleanup behavior.
- MIDI velocity is clamped to 0–127 and converted through a nonlinear gain curve. Pointer depth produces velocity, computer keys use a stable performance velocity, and MIDI preserves incoming velocity.
- The browser backend uses `AudioBufferSourceNode` sample playback with six locally generated, immutable multi-harmonic piano root samples spanning the keyboard. This keeps startup network-free while still using a sample-playback voice architecture.
- Every voice has a short attack and damped note-release envelope. The audio graph splits to dry and convolved stereo impulse paths before the master output, with equal-power dry/wet reverb mixing and smoothed volume changes.
- If Web Audio is unavailable, a silent deterministic fallback preserves UI and note lifecycle behavior. The audio backend also supports a sample-loader failure path that returns to the built-in sample bank.

## Inputs and functional panel wiring

- Pointer events provide mouse, pen, and multitouch note input; individual pointer capture protects release handling.
- Computer keyboard mapping covers A–' chromatically from C4, suppresses repeat, releases held notes on key-up, and performs panic cleanup on window blur. Space is a momentary sustain pedal outside focused controls.
- Web MIDI accepts note-on, note-off, note-on with velocity zero, and CC64 sustain on every channel. Unsupported, disconnected, denied-permission, and generic error states are reported without throwing.
- Piano type/model, timbre, dynamic compression readout, Piano enable, Piano A level, Master Level, Reverb on/off, and Reverb Dry/Wet are connected to application state and contextual OLED content.
- The status row exposes current model, voice count, sample/fallback state, sustain, MIDI connection, and Panic without adding content above the instrument.

## Verification

- Current deterministic suite: 7 test files, 25 tests, all passing; all 10 inherited Stage 1 tests remain present.
- Feature matrix: 17 unique IDs (8 Stage 1 + 9 Stage 2), each mapped to existing test files.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass. Vite `base: './'` is preserved.
- Live browser verification was unavailable because the in-app browser runtime had no connected backends. Stage 2 evidence PNGs therefore preserve the inherited Stage 1 images as clearly documented no-drift baselines; the visual audit records this limitation rather than claiming fresh captures or console inspection.
