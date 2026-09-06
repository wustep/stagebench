# Stage 3 control-binding audit (Stage 4 73)

Every Phase 1 hardware ID (`src/hardware/sections.ts` `CONTROLS`) is either
functionally bound (same movement moves the knob and the sound) or listed
under unsupported (spec-excluded) in the UI notes strip (`p3-unsupported-*`)
and in `src/state/program.ts` `UNSUPPORTED_CONTROLS`. Verified by
`src/integration.test.tsx` › `hardware.bindings` (all IDs present; every
non-excluded ID covered by a bridge or a `p3-*` strip; every unsupported ID
rendered with its reason).

Bridge paths: Phase 2 `usePianoFxBridge` (master/pitch/rotary-speed/stop/drive),
Phase 3 `usePhase3Bridge` (`src/state/bridges.tsx`), `p3-*` strips
(`src/components/stage3panels.tsx`). Morphable controls capture morph
destinations when a morph source is armed and light the green morph LED
(`data-morph="true"`) once assigned.

## Performance

| ID | Binding |
| --- | --- |
| `perf-pitch-stick` | Phase 2 bridge: bend ±2 st (PSTICK-gated per layer) |
| `perf-mod-wheel` | Phase 3 bridge: live Wheel morph position 0..10 (live-only, never dirty); drives Wheel vibrato |
| `perf-master-level` | Phase 2 bridge: master gain (not stored in programs) |
| `perf-rotary-speed` | Phase 2 bridge: rotary slow/fast |
| `perf-rotary-stop` | Phase 2 bridge (extended): rotary stop/slow (optional credit, working) |
| `perf-rotary-drive` | Phase 2 bridge: rotary drive |

## Organ

| ID | Binding |
| --- | --- |
| `organ-drawbar-1..9` | Focused organ layer drawbars 0..8 (audible spectrum per model; LED graph; morphable) |
| `organ-volume` | Focused organ layer level (morphable) |
| `organ-perc-1` | Percussion harmonic third (2nd/3rd) |
| `organ-perc-2` | Percussion decay fast (slow/fast) |
| `organ-perc-3` | Percussion volume soft (normal/soft) |
| `organ-perc-4` | Percussion on (single-triggered shared envelope) |
| `organ-model-1..5` | Models B3 / Vox / Farf / Pipe 1 / Pipe 2 on the focused layer (Pipe 2 = brighter principal registration over the Pipe 1 engine, as documented) |
| `organ-vib-1..5` | V1 / V2 / V3 / C1 / C2 on the focused layer + vib on; C3/V3/V1.. reachable in the `p3-*` strip (all six C1–C3/V1–V3) |
| `organ-on-a` / `organ-on-b` | Layer A/B enable |
| `organ-level-a` / `organ-level-b` | Layer A/B level faders (LED ladder; morphable) |

Note: the five hardware model buttons cover B3..Pipe 2 except B3 Bass, and the
five vib buttons cover V1..C2 except C3/V3 — the `p3-organ-*-model-*` listbox
(all six models incl. B3 Bass) and `p3-organ-*-vib-*` listbox (all six
positions) complete the required sets; the hardware buttons select the five
they label.

## Piano

| ID | Binding |
| --- | --- |
| `piano-level-a` / `piano-level-b` | Piano layer levels (morphable) |
| `piano-on` | Piano section on/off |
| `piano-type-1..6` | Grand / Upright / Electric / Clav / Digital / Misc on the focused layer |
| `piano-model` | Model dial (caps at the type's model count) |
| `piano-timbre` | Timbre table per family |
| `piano-detail-1..6` | KB Touch / Dyn Comp / Soft Release / String Res / SUSTPED / PSTICK |
| `piano-octave` | Octave shift ±12 st |

## Program / morph

| ID | Binding |
| --- | --- |
| `program-display` | Status readout (slot/name + dirty E + store destination; never claims unbuilt features) |
| `program-aux` | Auxiliary page readout |
| `program-dial` | Program browse (wraps the bank); auditions the destination while storing |
| `program-slot-1..8` | Page slot select; destination audition while storing |
| `program-fn-1` / `program-fn-2` | Page down / up (4 pages × 8) |
| `program-fn-3` | Live Mode (8 auto-storing slots) |
| `program-fn-4` / `program-fn-5` | Layer Scene I / II |
| `program-fn-6` | Store (second press confirms; tunes to naming when armed backward); Store As via the `p3-*` strip |
| `program-fn-7` | Split on/off (single Mid C4 by default; per-point editing in the strip) |
| `program-fn-8` | Transpose arm (steps ±1 st; Shift-step resets to 0); full ±6 editor in the strip |
| `program-fn-9` | Solo audition (optional credit, working) |
| `program-fn-10` | Panic (also the status-bar button: All Notes Off + performance reset) |
| `program-morph-1` | Wheel morph arm/latch (double-press semantics: press arms, press again captures) |
| `program-morph-2` | Control Pedal morph arm/latch |
| `program-morph-3` | DECORATIVE — Aftertouch (programs spec excluded; listed as unsupported) |

## Synth

| ID | Binding |
| --- | --- |
| `synth-display` | Status readout (wave/category; never claims unbuilt features) |
| `synth-level-a` / `synth-level-b` | Synth A/B levels (morphable; C in the strip) |
| `synth-osc-wave` | Waveform dial (all 14 required waves) |
| `synth-osc-shape` | Osc Ctrl (category-correct; morphable; LFO/osc-env modulatable) |
| `synth-osc-oct` | Layer octave ±12 st |
| `synth-filter-cutoff` / `synth-filter-res` / `synth-filter-env` | Filter freq/res/env-amt (morphable freq+res) |
| `synth-amp-attack` / `-decay` / `-sustain` / `-release` | Amp ADR + sustain level |
| `synth-lfo-rate` / `synth-lfo-amount` | LFO rate/amount (morphable) |
| `synth-fn-1` / `synth-fn-2` | Synth A/B on |
| `synth-fn-3` | Unison cycle |
| `synth-fn-4` | Arp run (starts Arp mode if off) |
| `synth-fn-5` | Master Clock tap |
| `synth-fn-6` | Vibrato on/off |

## Layer effects

| ID | Binding |
| --- | --- |
| `fx-organ-amount` / `fx-organ-rate` | Organ chain Mod 1 amount/rate (morphable) |
| `fx-piano-amount` / `fx-piano-rate` | Focused piano chain Mod 2 amount/rate (morphable amount) |
| `fx-organ-focus-a` / `fx-organ-focus-b` | Organ layer focus |
| `fx-delay-time` / `fx-delay-feedback` | Focused piano chain Delay tempo/feedback (morphable) |
| `fx-reverb-decay` | Focused piano chain Reverb wet (morphable) |
| `fx-amp-drive` | Focused piano chain Amp drive (morphable) |
| `fx-eq-treble` | Focused piano chain EQ treble / mid-freq (morphable freq) |
| `fx-comp-amount` | Focused piano chain Compressor amount |
| `fx-on-1` | Organ chain Mod 1 on |
| `fx-on-2` | Focused piano chain Mod 2 on |
| `fx-on-3` | Focused piano chain Delay on |
| `fx-on-4` / `fx-on-5` | Focused piano chain Amp/EQ on |
| `fx-on-6` | Focused piano chain Compressor on |
| `fx-on-7` | Focused piano chain Reverb on |

## Unsupported (spec-excluded; rendered in the UI notes strip)

Preset library, banks beyond one / 512 layout / Organize, Num Pad,
Monitor/Copy/Paste/Swap, Section Edit, Layer Init, Aux KB / Extern, all
Shift-menus + memory protection, external MIDI clock + pedal tap, Prog View
extra modes, alphabetic sorting/categories, Drawbar Live modes + sync, Swell
pedal, tonewheel wear / trigger point / Sound-menu rotary tuning, synth
Extern + MIDI-out, arp pattern editing + zig-zag + accent + pan + per-layer
KB Hold exclude, Filter/LFO/Arp Group modes, Samples mode + extra osc/filter
categories + Sound Init, piano excluded list, effects excluded list.
Aftertouch morph (`program-morph-3`) is the only decorative hardware control.
