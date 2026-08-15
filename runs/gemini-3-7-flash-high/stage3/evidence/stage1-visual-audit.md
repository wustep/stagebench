# Stagebench Phase 1 Visual Audit & Evidence Report

## 1. Hardware Variant & Measurements
- **Variant**: `stage-4-73` (Nord Stage 4 73, Hammer Action)
- **Target Dimensions & Aspect Ratio**:
  - Measured bounds on reference image: 9013 x 2912 px (aspect ratio ~3.095:1)
  - Desktop presentation at 1440x900: Width 93% (~1380px max-width), Height 440px (aspect ratio ~3.14:1)
  - Zero vertical scroll at 1440x900 viewport; product centered with studio backdrop.
  - Narrow viewport (390x844): Full instrument inspectable horizontally without clipping or layout breakage.

## 2. Vertical Allocation
- **Control Deck (including top rail)**: 54% (0.54)
- **Keybed (including bottom rail)**: 46% (0.46)
- **Deck-to-Keybed Separator**: Continuous black & red beveled rail separating the control deck and keybed.

## 3. Keybed Geometry & Range
- **Total Keys**: 73 keys
- **Key Range**: E1 (MIDI 28, 41.20 Hz) to E7 (MIDI 100, 2637.02 Hz)
- **White Keys**: 43 keys (width evenly partitioned across 100% keybed width)
- **Black Keys**: 30 keys (positioned over white key boundaries, height = 61% of keybed height per `blackKeyHeightFraction: 0.61`)
- **Key Labels & Keybindings**: Mapped computer keyboard keys displayed on keycaps (lower octave: Z to M, upper octave: Q to P).

## 4. Section Layout & Width Allocations
The 6 ordered horizontal sections adhere strictly to `specs/nord-stage-4.visual.json`:
1. **Performance Section**: 14% width
   - Surface: Exposed continuous red metal chassis (`#851a25` / `#5a0c13`).
   - Landmarks: Nord Stage 4 badge, Master Level knob (0–10), wooden Pitch Stick, knurled Modulation Wheel.
   - Prohibitions verified: No dark inset plate, no OLED display.
2. **Organ Section**: 20% width
   - Surface: Dark inset panel (`#3c424d` / `#22262c`) with red perimeter.
   - Landmarks: 9 physical drawbars (16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1') with color-coded caps (brown, white, black) and 8-segment LED ladder meters, Organ Model selector & LED matrix (B3, Vox, Farfisa, Pipe 1, Pipe 2, B3 Bass), Percussion controls (Soft, Fast, 3rd), Rotary controls (Stop, Slow/Fast), Octave Shift (-/+) buttons.
   - Prohibitions verified: No wide OLED display, no generic equal-width grid.
3. **Piano Section**: 8.5% width
   - Surface: Dark inset panel with red perimeter.
   - Landmarks: Layer A and Layer B Level faders with LED ladders, Piano Type selector with 6 LED indicators (Grand, Upright, Electric, Clav, Digital, Misc), Model selector dial, KB Touch button (Off, 1, 2, 3), Timbre button (Off, Soft, Mid, Bright, Dyno 1, Dyno 2), Dyn Comp button (Off, 1, 2, 3), Unison button, Soft Release button, String Res button, Sustped toggle.
   - Prohibitions verified: No wide OLED display, no drawbar bank.
4. **Program and Morph Section**: 12.5% width
   - Surface: Central red and dark control area.
   - Landmarks: Primary Program OLED screen (128x64 display showing program name, tempo, category), large rotary Program dial, Program 1–8 preset buttons, Page navigation buttons (< / >), Live Mode button, Layer Scene 1/2 button, Store button, Split button, Morph assign buttons (Wheel, Aftertouch, CtrlPed).
   - Prohibitions verified: Single primary OLED only.
5. **Synth Section**: 25% width
   - Surface: Dark inset panel with red perimeter.
   - Landmarks: Secondary primary Synth OLED screen (128x64 display showing synth engine status and filter graph), Layer A/B/C Level faders with LED meters, Oscillator type/mod controls (Classic, Wave, Sample, FM), Filter controls (LP24, LP12, LP/HP, BP, HP + Cutoff, Res, Drive, Env Amt), Amp Envelope knobs (ADSR), Mod Envelope knobs (ADR), LFO & Arpeggiator controls, Unison and Vibrato buttons.
   - Prohibitions verified: No wide display spanning whole section, no uniform repeated knob matrix.
6. **Layer Effects Section**: 20% width
   - Surface: Dark inset panel with red perimeter.
   - Landmarks: Effect 1 (Pan, Trem, RM, Wah, AutoWah, Pump), Effect 2 (Phaser 1/2, Flanger, Chorus 1/2, Vibe, Spin), Delay (Tempo, FB, Mix, PingPong), Amp Sim / EQ (Twin, JC, Small, Brit, Drive, Bass, Mid, Mid Freq, Treble), Compressor (Amount, Fast), Reverb (Booth, Room, Stage, Hall, Cath, Spring, Decay, Mix), Layer focus buttons (Piano, Organ, Synth).
   - Prohibitions verified: No OLED display, differentiated unit groupings.

## 5. Material & Color Fidelity
- **Chassis Red**: `#851a25` (mid), `#5a0c13` (dark), `#9e2330` (highlight)
- **Panel Dark**: `#3c424d` (slate blue-gray) and `#22262c`
- **End Cheeks**: Dark rich wood tone (`#3d140e`) with grain gradient and metallic bevels.
- **OLED Displays**: `#061014` backdrop with blue-green pixel text (`#33e6d9` / `#00f0ff`) and subtle glow.
- **LEDs**: Crisp red (`#ff2a2a`), green (`#2aff54`), and amber (`#ffaa00`) with glow effects.
- **Keybed**: Pristine white keys (`#ededed`) and deep matte black keys (`#111315`) with mechanical depression feedback.

## 6. Exercised Flows & Testing Pass
1. **Keybed Playback**:
   - Pointer click, drag, and multi-touch triggers notes with velocity mapped from vertical hit position.
   - Computer keyboard keys (Z-M, Q-P) trigger notes with repeat suppression.
   - Sustain pedal (Space bar / UI toggle / MIDI CC64) holds notes indefinitely until pedal-up.
2. **Audio Voice & Synthesis**:
   - Real-time Web Audio additive grand piano synthesis with 6 partials, inharmonicity, dynamic biquad filtering, velocity sensitivity, and register-dependent decay and release damping.
   - Polyphony manager supports 32 concurrent voices with deterministic voice stealing.
   - All notes cleanly stopped and nodes disconnected on window blur, visibility change, and unmount.
3. **Decorative Controls & Accessibility**:
   - All knobs, faders, drawbars, buttons, pitch stick, and mod wheel move or toggle state.
   - Full ARIA markup (`role="slider"`, `role="button"`, `aria-label`, `aria-valuenow`, `aria-pressed`, `aria-valuemin`, `aria-valuemax`).
   - High-contrast `:focus-visible` indicators across all interactive elements.

## 7. Known Deviations & Phase 1 Scope Boundary
- Phase 1 strictly bounds functional audio to the basic keybed piano voice and sustain pedal. All other panel controls (Organ drawbars, Synth parameters, Effects units, Program presets) exist visually with full accessible movement, updating presentation state only, without affecting the sound graph, in complete accordance with the benchmark honesty contract.
