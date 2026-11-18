# Stage 4 73 Phase 3 visual and control audit

The default captures retain the six section positions, deck and keybed proportions, and two OLED locations from Phase 2. The new expression pedal sits in the row below the instrument. The full instrument fits both viewports. Inspect controls still magnifies the panel and exposes both ends of the keybed on narrow screens. The cropped product reference was used for the chassis and panel comparison. Printed legends and individual control profiles remain drawn approximations.

| Measurement | Desktop | Narrow |
| --- | ---: | ---: |
| Viewport and document | 1440 × 900 px | 390 × 844 px |
| Instrument origin | (47.52, 209.03) px | (9.75, 309.78) px |
| Instrument width × height | 1344.95 × 434.53 px | 370.50 × 119.70 px |
| Deck height | 234.64 px (54%) | 64.63 px (54%) |
| Keybed height | 199.88 px (46%) | 55.06 px (46%) |
| White key width × height | 29.47 × 188.39 px | 8.11 × 51.91 px |
| Black key width × height | 18.56 × 114.91 px | 5.11 × 31.66 px |

The browser check reached all 163 panel controls and 73 keys at desktop size. The keybed has 43 white keys and 30 black keys, E1–E7. Both canonical captures reported zero console messages and page errors. The capture environment reported denied MIDI permission. A separate Chromium test supplied Web MIDI input and measured audio after the first page click. [Capture manifest](stage3-capture.json) · [Desktop](stage3-desktop.png) · [Narrow](stage3-narrow.png)

## Control bindings

The binding test checks each panel ID against its canonical setting, program or editor action, or named unsupported feature. The table records how the supported controls are operated.

| Section | Controls and behavior |
| --- | --- |
| Performance | Master Level feeds the output limiter. Pitch Stick bends layers with PSTICK on. The Modulation Wheel drives assigned morphs and wheel vibrato. Rotary has on, Organ routing, drive, slow/fast, and stop controls. |
| Organ | Section on/off, A/B switches, focus, level, octave, sustain, pitch stick, and zones. Nine faders update the drawbar spectrum and ladders. The model and vibrato/chorus switches drive the registration and modulation selectors. B3 percussion has on, soft, fast, and third harmonic switches. |
| Piano | Section and layer controls retain the Phase 2 bindings. The type switch selects six sources and the model dial opens the available model list. Acoustics, touch, unison, timbre, and dynamic compression update the focused layer. The octave buttons edit zones when shifted. |
| Program and Morph | Buttons and dial select slots. Pages move through groups of eight. Program View and Shift+Dial open the numeric list. Store auditions the selected destination, confirms with a second press, and exits with Shift or Escape. Shift+Store opens name entry. Live switches to eight automatically saved slots. Hold Split or use Shift+Split to set points, fades, and layer zones. The scene button switches the seven layer enables. The morph buttons support hold or double-tap assignment and Shift clearing. The lower Control Pedal and MIDI CC11 both drive its source. Four clock taps set tempo. Hold Clock to edit the tempo with the dial. Hold Transpose to set the interval, and use Shift+Transpose for Panic. |
| Synth | Section and layer controls select independent A/B/C settings. The OLED dials browse analog categories and waveforms or edit envelopes when selected. Oscillator Pitch opens coarse and fine tuning. Amp, filter, and oscillator buttons select their envelope, with Shift editing velocity. Filter Resonance opens tracking and drive with Shift or hold. Shift+LFO Wave opens clock sync. Arp Menu opens direction and sync. The other arp controls set run, keyboard hold, mode, rate, and range or gate hardness. The voice button sets mode and selects priority with Shift. Glide, Unison, Vibrato, and the Vibrato Menu drive their dedicated parameters. |
| Layer Effects | Layer focus follows editing, and each section can be targeted from the FX strip. Shift on Piano or Synth focus groups the corresponding chains. Shift on Delay, Compressor, or Reverb On selects Global. All six units retain their type and parameter controls, with bypass on each unit and across the section. Delay and Mod 1 accept the shared clock. |

The Program OLED shows slot, name, selected scene, section sounds, edited state, and Store feedback. The Synth OLED follows layer and waveform selection and draws the selected envelope. Split markers appear above the keys. Zone lamps and layer focus lamps show the active assignments. Morph destinations show a green lamp or the changed portion of the drawbar or level ladder.

## Unsupported controls and implementation choices

- The unsupported primary buttons are Aftertouch morph, Organ Preset/Drawbar Sync, the three section preset libraries, Section Edit/Layer Init, Monitor/Copy/Paste/Swap, Solo/Undo, and Delay feedback-loop effects. They are marked in the DOM and listed in Playing & credits. Optional Solo, Undo, additional Program View modes and sorting, and Delay Ping Pong are omitted.
- Unsupported secondary gestures include additional banks, Num Pad, the system menus, Aux KB, Extern/MIDI out, pedal and external clock tap, Scene pedal switching, Organ Swell, tonewheel wear, trigger-point and rotary tuning, Piano size classes, INFO, pedal noise and half-pedaling, Triple Pedal and downloads, Synth Samples mode and additional oscillator/filter types, Sound Init, Group modes for Filter/LFO/Arp, KB Hold Exclude, pattern editing and advanced arp options, extra Synth vibrato modes, FX variations and Chorale, Delay Analog mode, Mod 1 pedal modes, and Rotary Close Mic and stop angle. Reverb precedes Rotary in the signal path.
- Nine factory programs demonstrate sources, layers, zones, and arpeggiation. Storage uses the browser’s local library for this origin. The current wheel, expression pedal, pitch stick, and Master Level stay outside the saved sound. Scene I/II shares tone and effects settings.
- Organ ranks, click, and percussion are synthesized. Vox uses two brightness paths, Farf drawbars switch registers past halfway, and Pipe 2 uses brighter ranks than Pipe 1. The shared Organ chain takes the two independently leveled sends. Hard-sync Synth shapes use Fourier tables with interpolated slave ratios. The LFO sample-and-hold uses a repeating seeded sequence.

## Verification

The rendered-audio tests cover source spectra, live drawbar and rotary changes, oscillator and filter modulation, envelopes, voice modes, note priority, glide, unison, vibrato, arp/gate timing, split fades, transpose, morph level, sustain, routing, and teardown. The Chromium workflows cover program navigation, Store and Store As audition/cancel/confirm, local storage reload, Live edits, splits and scenes, morph assignment and CC11, the master clock and Synth dials, sustained arpeggios, and Panic. All inherited test mappings remain in the matrix. [Feature matrix](../tests/feature-matrix.json) · [Audio declarations](../IMPLEMENTATION_DETAILS.json)
