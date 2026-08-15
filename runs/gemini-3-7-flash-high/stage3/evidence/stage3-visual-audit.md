# Stagebench Phase 3 Visual Audit & Evidence Report

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
   - Landmarks: Nord Stage 4 branding badge, Master Level knob (0–10, functional audio control), wooden Pitch Stick (functional ±2 semitone pitch bend), knurled Modulation Wheel (morph controller).
   - Prohibitions verified: No dark inset plate, no OLED display.

2. **Organ Section**: 20% width
   - Surface: Dark inset panel (`#3c424d` / `#22262c`) with red perimeter.
   - Landmarks:
     * 9 physical drawbars (16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1') with color-coded caps, 8-segment LED ladder meters, and green morph indicators.
     * Layer A & Layer B Enable buttons, Level faders with LED meters and morph indicators, Octave Shift (-/+) buttons, and focus star tags.
     * Organ Model selector with LED matrix: B3, Vox, Farf, Pipe 1, Pipe 2, B3 Bass.
     * Percussion controls: ON, SOFT, FAST, 3RD with single-trigger harmonic synthesis.
     * Vibrato / Chorus Scanner: ON and Type selector (C1, C2, C3, V1, V2, V3).
     * Rotary unit controls: STOP and SLOW/FAST with green speed LED.
     * Section switches: SUSTPED toggle, PSTICK toggle.
   - Status: Fully functional dual-layer organ sound engine with distinct B3 tonewheel, transistor, and pipe models sharing one effect chain.

3. **Piano Section**: 8.5% width
   - Surface: Dark inset panel with red perimeter.
   - Landmarks:
     * Layer A & Layer B Enable buttons, Level faders with LED meters and morph indicators, focus highlights, and Octave Shift (-/+) buttons.
     * Piano Type selector with 6 LED indicators (Grand, Upright, Electric, Clav, Digital, Misc).
     * Model selector dial (1–9).
     * Performance detail switches: KB Touch (Off, T1, T2, T3), Timbre (Off, Soft, Mid, Bright, Dyno 1, Dyno 2), Dyn Comp (Off, C1, C2, C3), Unison (Off, U1, U2, U3), Soft Release, String Res.
     * Section switches: SUSTPED toggle, PSTICK toggle.
   - Status: Fully functional dual-layer real-time sound engine with offline multi-sample library and physical synthesis.

4. **Program and Performance Section**: 12.5% width
   - Surface: Central red and dark control area.
   - Landmarks:
     * Primary Program OLED screen (128x64 graphic display showing slot, program name, dirty indicator `[E]`, active layers, scene, split status, tempo BPM, and transpose).
     * Rotary Program dial (1–32) and Page navigation buttons (< / >).
     * Program 1–8 preset buttons with illuminated LED indicators.
     * Numeric List View toggle and full 32-program scrollable overlay.
     * Store & Store As buttons with character name entry field.
     * Live Mode toggle (8 auto-storing Live slots).
     * Layer Scene 1/2 toggle.
     * Keyboard Split toggle and Split Points / Crossfade configuration modal (Low, Mid, High split points at 11 positions with Off/±6/±12 crossfades).
     * Morph Assign buttons: WHEEL, A-TOUCH (truthfully labeled unsupported per spec), and CTRLPED with clearing shortcuts.
     * Master Clock (MST CLK) tap tempo button (30–300 BPM).
     * Transpose button (±6 semitones) and Panic (All-Notes-Off).
   - Prohibitions verified: Single primary OLED only in this section.

5. **Synth Section**: 25% width
   - Surface: Dark inset panel with red perimeter.
   - Landmarks:
     * Secondary primary Synth OLED screen (128x64 graphic display showing Oscillator Category, Waveform, Osc Ctrl parameter and value, Filter type, Cutoff, Voice mode, and Arp status).
     * Layer A, B, C Enable buttons, Level faders with LED meters and morph indicators, Octave Shift buttons, and Group Synth toggle.
     * Oscillator block: Category selector (Pure, Sync, Multi, Super, FM-H), Waveform selector, and Osc Ctrl knob with morph indicator.
     * Filter block: Type selector (LP12, LP24, HP, BP), KB Tracking (Off, 1/3, 2/3, 1), Cutoff knob (morphable), Resonance knob (morphable), Env Amount knob, and Drive button (Off, 1, 2, 3).
     * Envelopes block: Amp ADR with velocity, Mod ADR with velocity and To Pitch toggle.
     * LFO block: Shape (Triangle, Saw Down, Saw Up, Square, S&H), Destination (Osc Pitch, Osc Ctrl, Filter Freq), Rate knob (morphable), Amount knob (morphable), and MST CLK sync button.
     * Voice block: Mode (Poly, Mono, Legato), Unison (Off, 1, 2, 3), Vibrato (Off, On, Wheel), and Glide knob.
     * Arpeggiator block: Arp Run button, Type (Arp, Poly, Gate), Direction (Up, Down, Up/Down, Random), Range (1–4 octaves), KB Hold button, MST CLK sync button, and Rate knob (morphable).
   - Status: Fully functional 3-layer synthesizer sound engine with independent 6-unit effect chains.

6. **Layer Effects Section**: 20% width
   - Surface: Dark inset panel with red perimeter.
   - Landmarks:
     * Master Layer Effects ON button (all-effects master bypass).
     * Focus selectors: Piano, Organ, Synth focus buttons + Piano Group and Synth Group buttons.
     * Effect 1: Unit On, Type button (A-Pan, Trem, RM, A-Wah, Wah, Pump), Rate and Amount knobs (morphable).
     * Effect 2: Unit On, Type button (Chorus, Flang, Phas, Vibe, Ens, Spin), Rate and Amount knobs (morphable).
     * Delay: Unit On, Ping-Pong toggle, Feedback Filter mode (Off, LP, HP, BP), Global toggle, Tempo, Feedback, and Mix knobs (morphable).
     * Amp Sim / EQ: Unit On, Model selector (EQ only, Twin, JC, Small, LP24, HP24, To Rotary), Drive, Bass, Mid, Mid Freq (morphable), and Treble knobs.
     * Compressor: Unit On, Fast recovery toggle, Global toggle, Amount knob.
     * Reverb: Unit On, Type selector (Booth, Room, Stage, Hall, Cath, Spring), Bright toggle, Global toggle, Decay and Mix knobs (morphable).
   - Status: Fully functional 6-unit DSP effect graph with 6 separate chains, click-free bypass, dry/wet, and shared rotary routing.

## 5. Material & Color Fidelity
- **Chassis Red**: `#851a25` (mid), `#5a0c13` (dark), `#9e2330` (highlight)
- **Panel Dark**: `#3c424d` (slate blue-gray) and `#22262c`
- **End Cheeks**: Dark rich wood tone (`#3d140e`) with grain gradient and metallic bevels.
- **OLED Displays**: `#061014` backdrop with blue-green pixel text (`#33e6d9` / `#00f0ff`) and subtle glow.
- **LEDs**: Crisp red (`#ff2a2a`), green (`#2aff54`), and amber (`#ffaa00`) with glow effects.
- **Morph Indicators**: Bright green LED indicators illuminate on knobs, faders, and drawbars when assigned to Wheel or Control Pedal morph sources.
- **Keybed**: Pristine white keys (`#ededed`) and deep matte black keys (`#111315`) with mechanical depression feedback.
