# Phase 2 Visual Audit — Nord Stage 4 (stage-4-73)

Compared the Phase 2 render against `inputs/reference/nord-stage-4-73.jpg` and the geometry in `inputs/specs/nord-stage-4.visual.json`, at desktop (1440×900) and narrow (390×844). Screenshots captured from the production build served offline: `evidence/browser-desktop.png`, `evidence/browser-mobile.png`. This audit focuses on Phase 2 changes (Piano + Layer Effects now functional, Master Level real) while confirming no Phase 1 visual regression.

## Desktop (1440×900)

- **Chassis & layout unchanged from Phase 1.** One continuous red chassis (`data-variant="stage-4-73"`), the six sections in order (Performance, Organ, Piano, Program, Synth, Layer Effects) at their documented deck fractions, the 54/46 deck/keybed split, and the full 73-key keybed (43 white + 30 black) spanning the full width. No marketing hero, no detached rails, no overflow, no clipped chassis. Program and Synth remain the only primary OLED locations.
- **Performance section.** Master Level knob top-left (now functional), pitch stick + mod wheel, rotary speaker cluster, and the "nord stage 4 / HAMMER ACTION 73" branding — matches the reference badge placement.
- **Piano section (now functional).** Two level faders with LED graphs (A=85%, B=40%), A/B ON-OFF, SUSTPED/PSTICK, OCTAVE ◀▶, ACOUSTICS (SOFT REL / STRING RES / PED NOISE), UNISON, KB TOUCH (Medium lit), DYN COMP (Off), TIMBRE (Off), and PIANO SELECT with the six-LED type list (Grand→Misc) plus INFO and the MODEL dial. Selecting a type moves the lit LED (verified Grand→Upright→Electric→Clav in-browser); the Piano section ON and layer-A ON LEDs are lit by default so the instrument plays out of the box.
- **Layer Effects section (now functional).** FX FOCUS selector (Piano A default) with the manual FOCUS A / FOCUS B / GROUP buttons added, ALL FX OFF, and the section ON pill (lit). Six unit groups render in the reference two-row arrangement: MOD 1, DELAY, MOD 2, COMP, AMP SIM / EQ, REVERB. Each unit shows its knobs, type selector, and a red ON LED; Delay/Comp/Reverb additionally carry an amber GLOBAL toggle. Amp model list includes To Rotary. Engaging units lights their ON LED and (verified in-browser) alters the rendered signal without console errors.
- **Organ / Synth / Program unchanged and still decorative.** Drawbar bank, B3 percussion, vib/chorus, synth oscillator/filter/LFO/arp clusters, both OLEDs, and the program num-pad/store area render exactly as in Phase 1 and remain honestly decorative.

## Narrow (390×844)

- The chassis keeps its true hardware aspect ratio and scrolls horizontally inside its own container (horizontal scrollbar visible under the deck) — the page body itself does not scroll sideways. Performance, Organ, and Piano are visible at the start of the scroll; Layer Effects is reachable by scrolling right. No control is clipped or overlapping; LED graphs, faders, drawbars, and buttons stay legible.
- The keybed and the status strip remain pinned below the deck. The status strip now honestly reads "Piano ready (recorded + synth voices)" and "Phase 2: Piano, Layer Effects, and Master Level are live. Organ, Synth, and Program stay decorative." — no stale Phase-1 wording.

## What is now functional (verified in a real browser)

- Exactly **one AudioContext** exists in the production build (instrumented the `AudioContext` constructor; count = 1, state = running after a gesture).
- Playing keys with the Grand type starts **recorded sample buffer sources** (buffer-source `.start()` count rose with held notes, oscillator count stayed 0). Switching to Clav plays via **oscillators** (synthesis), 0 buffers — matching the honest recorded-vs-synth declaration.
- Engaging Reverb + Delay + Mod 1 + Compressor + Amp Sim/EQ "To Rotary" and playing through the whole chain produced sound with **zero console errors/warnings**.
- Master Level, per-layer level/enable, piano type, and effect toggles all change the audio and agree with their panel LEDs/values.

## Honesty check

- Grand / Upright / Electric are recorded CC-BY 3.0 sample sets bundled under `public/samples/` and load offline; Clav / Digital / Misc are synthesized and labeled as such. No decorative Organ/Synth/Program control produces audio. The status strip never claims recordings the app does not have (it reports a labeled playable fallback if samples fail to load).
