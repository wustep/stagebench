# Stage 1 visual audit

The selected target is Nord Stage 4 73. The surface is a single continuous 3.095:1 red chassis, matching the source photo's measured 9013 / 2912 aspect ratio. At 1440 × 900 its width is `min(94vw, 1400px)`, or 1354px (94%), with a resulting height of about 437px: fully visible without vertical scrolling. The deck/keybed allocation is 54% / 46%.

The source's photo-measured deck fractions are used in order: Performance 14%, Organ 20%, Piano 8.5%, Program 12.5%, Synth 25%, Layer Effects 20%. This corrects the prompt prose's older coarse split. The 73-key keybed models MIDI 28–100 (E1–E7), with 43 white and 30 black keys; black keys are 61% of white-key height.

At 390 × 844 the instrument keeps its complete 1060px inspection canvas and uses horizontal scrolling rather than clipping the chassis. Corrections made during implementation: primary OLEDs are restricted to Program and Synth; Organ/Piano/Effects use no OLED; the performance region remains exposed red rather than an inset plate. Known deviation: the native physical panels are rendered as responsive semantic controls rather than photo textures, and the Phase 1 piano is explicitly a generated fallback rather than a sample library.
