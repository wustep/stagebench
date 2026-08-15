# Stagebench Phase 2 Visual Audit & Evidence Report

## 1. Hardware Variant & Measurements
- **Variant**: `stage-4-73` (Nord Stage 4 73, Hammer Action keybed)
- **Target Dimensions & Aspect Ratio**:
  - Measured bounds on reference image: 9013 x 2912 px (aspect ratio ~3.095:1)
  - Desktop presentation at 1440x900: Width 93% (~1380px max-width), Height 440px (aspect ratio ~3.14:1)
  - Zero vertical scrolling at 1440x900; instrument centered on studio backdrop.
  - Narrow viewport (390x844): Full instrument inspectable horizontally without clipping, text overflow, or control collision.

## 2. Vertical Allocation
- **Control Deck (including top rail)**: 54% (0.54)
- **Keybed (including bottom rail)**: 46% (0.46)
- **Deck-to-Keybed Separator**: Continuous black & red beveled rail separating control deck and keybed.

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
   - Landmarks: Nord Stage 4 branding badge, Master Level knob (0–10, functional audio control), wooden Pitch Stick (functional ±2 semitone pitch bend), knurled Modulation Wheel.
   - Prohibitions verified: No dark inset plate, no OLED display.
2. **Organ Section**: 20% width
   - Surface: Dark inset panel (`#3c424d` / `#22262c`) with red perimeter.
   - Landmarks: 9 physical drawbars (16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1') with color-coded caps and 8-segment LED ladder meters, Organ Model selector & LED matrix, Percussion controls, Rotary controls, Octave Shift buttons.
   - Status: Honestly decorative for Phase 2.
3. **Piano Section**: 8.5% width
   - Surface: Dark inset panel with red perimeter.
   - Landmarks:
     * Layer A & Layer B Enable buttons, Level faders with LED meters, focus highlights, and Octave Shift (-/+) buttons.
     * Piano Type selector with 6 LED indicators (Grand, Upright, Electric, Clav, Digital, Misc).
     * Model selector dial (1–9).
     * Performance detail switches: KB Touch (Off, T1, T2, T3), Timbre (Off, Soft, Mid, Bright, Dyno 1, Dyno 2), Dyn Comp (Off, C1, C2, C3), Unison (Off, U1, U2, U3), Soft Release, String Res.
     * Section switches: SUSTPED toggle, PSTICK toggle.
   - Status: Fully functional dual-layer real-time sound engine with offline multi-sample library and physical synthesis.
4. **Program and Morph Section**: 12.5% width
   - Surface: Central red and dark control area.
   - Landmarks: Primary Program OLED screen (128x64 graphic display showing program name, tempo, live piano type & model feedback, layer status), large rotary Program dial, Program 1–8 preset buttons, Page navigation buttons (< / >), Live Mode button, Layer Scene 1/2 button, Store button, Split button, Morph assign buttons (Wheel, Aftertouch, CtrlPed).
   - Prohibitions verified: Single primary OLED only.
5. **Synth Section**: 25% width
   - Surface: Dark inset panel with red perimeter.
   - Landmarks: Secondary primary Synth OLED screen (128x64 graphic display), Layer A/B/C Level faders with LED meters, Oscillator controls, Filter controls, Amp & Mod Envelopes, LFO & Arpeggiator controls.
   - Status: Honestly decorative for Phase 2.
6. **Layer Effects Section**: 20% width
   - Surface: Dark inset panel with red perimeter.
   - Landmarks:
     * Master Layer Effects ON button (all-effects master bypass).
     * Focus selectors: Piano, Organ, Synth focus buttons + Piano Group mode button.
     * Effect 1: Unit On, Type button (A-Pan, Trem, RM, A-Wah, Wah, Pump), Rate and Amount knobs.
     * Effect 2: Unit On, Type button (Chorus, Flang, Phas, Vibe, Ens, Spin), Rate and Amount knobs.
     * Delay: Unit On, Ping-Pong toggle, Feedback Filter mode (Off, LP, HP, BP), Global toggle, Tempo, Feedback, and Mix knobs.
     * Amp Sim / EQ: Unit On, Model selector (EQ only, Twin, JC, Small, LP24, HP24, To Rotary), Drive, Bass, Mid, Mid Freq, and Treble knobs.
     * Compressor: Unit On, Fast recovery toggle, Global toggle, Amount knob.
     * Reverb: Unit On, Type selector (Booth, Room, Stage, Hall, Cath, Spring), Bright toggle, Global toggle, Decay and Mix knobs.
   - Status: Fully functional per-layer real-time audio DSP graph with click-free bypass, dry/wet, and shared rotary routing.

## 5. Material & Color Fidelity
- **Chassis Red**: `#851a25` (mid), `#5a0c13` (dark), `#9e2330` (highlight)
- **Panel Dark**: `#3c424d` (slate blue-gray) and `#22262c`
- **End Cheeks**: Dark rich wood tone (`#3d140e`) with grain gradient and metallic bevels.
- **OLED Displays**: `#061014` backdrop with blue-green pixel text (`#33e6d9` / `#00f0ff`) and subtle glow.
- **LEDs**: Crisp red (`#ff2a2a`), green (`#2aff54`), and amber (`#ffaa00`) with glow effects.
- **Keybed**: Pristine white keys (`#ededed`) and deep matte black keys (`#111315`) with mechanical depression feedback.
