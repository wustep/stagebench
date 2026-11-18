# Phase 3 control audit

The inventory test enumerates every physical control ID. It resolves each ID through its sound binding, performance command, delay tap handler or the named exclusion table. The keyboard-access test checks the full deck for reachable hit targets.

| Panel | Binding and feedback |
| --- | --- |
| Performance | Master gain, pitch stick, wheel, organ routing, drive, continuous rotor speed and stop feed the common rack. Shift plus Transpose clears notes and pedals. |
| Organ | A/B switches, faders, octave and section switch select and route the layers. Model, nine drawbars, percussion switches and vibrato controls change the current registration. The registration editor also exposes key click. Both layers feed the same effect chain. |
| Piano | The inherited layer and instrument controls edit both piano layers. The Model dial opens the editor for the single supplied model of each type. |
| Program | Four pages, eight slot buttons, dial, numeric list, naming, two-press Store, Live recall, Scene, Solo, Shift, Transpose and clock use the program bank. Store keeps the source while other slots are auditioned. Shift/Exit cancels. |
| Performance assignments | Hold Split or Shift-click it to edit points and zone ranges. Shift plus an octave button also opens zones. Assign Wheel or Ctrlped, move a destination and release or unlatch the source. Shift plus the source clears it. The green destination lamp and moving ladders display assignments. The virtual pedal and MIDI CC11 drive pedal morphs. |
| Synth | A/B/C controls select independent patches and chains. The waveform and category dials select the analog source. Envelope buttons select the OLED attack, decay and release dial page. Press the envelope button again to leave the page, or Shift-click to open the full editor. The pitch, voice, filter, vibrato, LFO and arp settings feed the generator. The Arp menu includes rate sync, direction and range. |
| Effects | Focus follows each layer fader or can be selected manually. Piano and Synth have independent group switches. Delay, compressor and reverb can link all six chains globally. Delay tap, feedback filter, ping-pong, compressor speed, tone, clock sync and all six wet/dry balances are available in the editors. |

## Unsupported hardware

The A.T. morph source, three Program preset-library buttons, Organ preset, Section Edit, Mon/Copy and Delay variation are presentation controls. Each has an accessible unsupported description. The editor includes unsupported feature notes. The complete excluded secondary functions are listed under surface.unsupported in IMPLEMENTATION_DETAILS.json.
