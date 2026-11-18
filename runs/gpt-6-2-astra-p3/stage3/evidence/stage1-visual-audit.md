# Stage 4 73 visual audit

The canonical captures show the full instrument at its initial 100% magnification. Measurements below are CSS pixels from the production build at the capture viewport sizes.

| Measurement | Desktop | Narrow |
| --- | ---: | ---: |
| Viewport | 1440 × 900 | 390 × 844 |
| Instrument origin (x, y) | 48.95, 208.42 | 11.70, 169.09 |
| Instrument width × height | 1342.08 × 433.94 | 366.59 × 118.53 |
| Viewport width occupied | 93.20% | 94.00% |
| Instrument aspect ratio | 3.093 | 3.093 |
| Deck height, including rail | 231.88 | 63.34 |
| Keybed height, including rail | 202.06 | 55.19 |
| White / black playing length | 190.87 / 116.31 | 52.14 / 31.77 |
| Page scroll dimensions | 1440 × 900 | 390 × 844 |

The selected photograph has a measured aspect ratio of 3.0951. The deck and keybed occupy 53.44% and 46.56% of the reconstruction. Black key length is 60.94% of white key length. There are 43 white and 30 black keys across E1–E7, inclusive. The red cheeks connect the upper surface to the front rail.

## Control surface

| Band | Model allocation within the six bands | Panel controls | Visible landmarks |
| --- | ---: | ---: | --- |
| Performance | 14.16% | 7 | Exposed red metal, wooden pitch stick, wheel, master level and rotary block |
| Organ | 19.65% | 24 | Two level faders, nine numbered drawbars and LED ladders, model, chorus and percussion groups |
| Piano | 8.55% | 14 | Two layer faders, type and model selectors, timbre and detail switches |
| Program and morph | 12.66% | 28 | Program OLED and dial, eight numbered buttons, page pair and morph assign row |
| Synth | 25.03% | 40 | Three faders, narrow OLED, voice, arpeggiator, LFO, oscillator, filter and amp groups |
| Layer effects | 19.94% | 33 | Focus column, two modulation blocks, amp/EQ, delay, compressor and reverb |

The remaining space to the right of the effects plate is exposed chassis, as in the photograph. The absolute coordinates follow the photograph and the corrected allocations in the visual spec. Rotary Speaker sits below Master Level on the red performance band.

## Corrections and interaction pass

The first capture showed diagonal shading across individual keys. The final build uses longitudinal shading and bevels at the key fronts. The final panel also has numbered drawbar ladders, additional printed secondary legends and distinct layer-selector strips.

At desktop size the centre of every panel control's hit area resolves to that control or a descendant. The browser pass operated all 146 controls by keyboard and checked their resulting accessible values. It also exercised pointer drag, two simultaneous touches, independent lift, touch cancellation, computer keys, blur, sustain, MIDI and zoom. Both canonical captures report empty console-message and page-error arrays.

## Known deviations

The model uses vector shapes and gradients for the paint, mouldings and wood. The photograph contains finer surface grain, reflections, irregular shadows and more detailed brand lettering. The OLEDs show a simplified piano identification and idle synth screen. Small secondary legends are abbreviated. At phone overview scale, the smallest lettering requires magnification. The zoom buttons enlarge the instrument in a horizontally scrollable view while the complete chassis fits at 100%.
