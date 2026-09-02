# Stage 2 visual audit — Nord Stage 4 73

Captures (all in `evidence/`): `stage2-desktop.png` (1440×900), `stage2-narrow.png` (390×844), measurements, the browser
interaction pass and an in-browser DSP proof in `stage2-capture.json`. Produced by `scripts/capture.mjs` (playwright-core 1.62
driving the locally installed Google Chrome 151, `pnpm build` output served over a local HTTP port). The parent capture harness
named in the phase prompt is not present in this workspace, so the script reproduces its outputs: `stage2-capture.json` carries
the parent shape (`profiles[]` with viewport, file, bytes, console messages, page errors) alongside the local measurements.
The Phase 1 evidence (`stage1-*`) is kept untouched next to it.

## Visual regression against Phase 1

The control surface is Phase 1's surface; Phase 2 changed only what the state now drives. Measured at 1440×900 (identical
to `stage1-capture.json` within rounding):

| Measure | Phase 1 | Phase 2 |
| --- | --- | --- |
| Instrument box | 1353.6 × 437.3 px, 0.940 of the viewport, aspect 3.095 | 1354 × 437 px, 0.940, aspect 3.095 |
| Document scroll height | 900 px (no vertical scroll) | 900 px |
| Deck / keybed split | 0.540 / 0.460 | 0.540 / 0.460 |
| Section widths (measured = documented) | 0.140 / 0.200 / 0.085 / 0.125 / 0.250 / 0.200 | same |
| Keys | 73 (43 white / 30 black), E1–E7, black/white length 0.610 | same |
| Controls with stable ids | 146, 0 missing names, 0 duplicate ids | 146, 0, 0 (the Amp Sim/EQ model selector gained its "EQ only" position; no control was added or removed) |
| Displays | `program.oled` and `synth.oled` only; none in performance / organ / piano / effects | same |
| Forbidden-hardware rules | all zero (drawbar-like controls: organ 11, piano 2, synth 3) | same |
| Console / page errors | 0 / 0 | 0 / 0 |

Narrow 390×844: instrument 374 × 121 px (0.96 of the viewport width), document scroll width 390 px, no clipping, 0 console
errors — unchanged from Phase 1.

Deliberate visual differences (all state-driven, none structural):

- The Program OLED shows the focused Piano layer's type and model ("Grand · Salamander C5"), both layers' library state,
  the audio / MIDI / effects-focus line and the held keys, instead of Phase 1's "Basic piano" text. The Synth OLED still
  says "Decorative · No synth engine runs yet".
- Piano section: the type LED now lights the model that is actually loaded (Grand on the GRAND position — the printed order
  ELECTRIC / UPRIGHT / GRAND / CLAV / DIGITAL / MISC follows the photograph, Phase 1 had lit the top-left position);
  SUSTPED lit (on by default), PSTICK off, PED NOISE off (pedal noise is an excluded feature, so its LED no longer claims to
  be on), the focused layer's ON/OFF LED blinks when both layers are on, the type LED flashes while a model is missing.
- Layer Effects: the FX FOCUS block lights Piano A (or A + B in Group mode), Organ / Synth when those are focused; GLOBAL
  LEDs, the compressor FAST / ACTIVE LEDs and the delay TAP LED (pulsing at the delay time while the delay is on) follow the
  state; the Rotary Speaker ON LED lights when a Piano layer is routed To Rotary.
- Status strip: adds a "Piano library" line (per-layer model, source kind, load state) and an "Effects" pill naming the live
  DSP host (AudioWorklet, main-thread fallback, or unavailable with the reason).
- Page header text says Phase 2.

## Reachability fix found by the interaction pass

The first Phase 2 pass could not click the Piano layer B button: at desktop scale the ACOUSTICS / KB TOUCH stacks (dense
printed blocks inherited from Phase 1) overlapped the layer buttons and intercepted the pointer. Layout boxes, printed
legends, LEDs and selector LED blocks are now transparent to the pointer (`pointer-events: none`) while every control
element receives presses (`pointer-events: auto`). Nothing moved visually; every control is reachable by pointer, touch and
keyboard.

## Interaction pass (desktop, `stage2-capture.json` → `interaction.steps`)

- Library state on load: Grand · Salamander C5 ready (120/120 files decoded) before any gesture; layer B off.
- Mouse press on C4 depressed the key and created one layer-A voice from the recorded set (`source: recorded-samples`).
- After the first gesture: audio `ready`, context running at 44.1 kHz, effects host `worklet`, MIDI `denied` (headless Chrome).
- Computer-keyboard chord with Shift held sustained, then released; two-finger touch registered independently.
- Cycling the TYPE button loaded every set in turn — Upright (66 files), Wurlitzer EP200 (47), Harpsichord (28), TX81Z FM Piano
  (66), Marimba (30) and back to Grand (120) — each reported `ready` with `recorded-samples`, and the Program display headline
  followed ("Upright · Kawai Upright KW", …).
- Enabling layer B with the Electric piano (Wurlitzer) and playing F4 produced one voice per layer, each from its own recorded
  set; focus moved to B.
- Effects: Mod 2, Delay and a reverb type change were applied to the focused chain; Master Level moved by keyboard (7 → 6.8,
  engine master gain 0.56); Shift + Delay ON set Global, Shift + Piano focus set Group, Amp model "To rotary" lit the Rotary
  ON LED.
- In-browser DSP proof: the same worklet script the app loads was run in an `OfflineAudioContext` on a 0.3 s sawtooth burst:
  reverb and delay add a tail where the bypass has none (tail rms 0.0086 and 0.035 vs 0), Layer Effects OFF is bit-identical
  to the bypass, the rotary decorrelates the stereo channels, and the master limiter keeps the peak ≤ 1.
- Knob by keyboard (6 → 6.2), drawbar and fader drags (8 → 3, 45 → 95 with layer B level following), a decorative organ
  toggle / selector / momentary button behaved as in Phase 1 and left the engine untouched (0 voices), Tab focus showed a
  solid outline, window blur released everything.

## Known deviations (unchanged from Phase 1 unless noted)

- Legends render at ≈4.9 px at desktop scale; neighbouring legends touch in the dense piano left column and the delay / reverb
  right columns. Knob scale numerals are ≈2 px. Fonts are system sans.
- The rear-panel jack row, wooden cheeks, screw row and rear labels are stylised; no photograph is used as a background.
- The Program OLED is 75 px wide at desktop scale, so the headline is ellipsised ("Grand · Sa…"); the full text is in the DOM
  and in the status strip.
- MIDI reports `denied` in headless Chrome, which is the truthful state of that environment.
