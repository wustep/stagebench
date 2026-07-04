# Phase 3 visual audit — Nord Stage 4 (73-key variant)

Compared the production build against `reference/nord-stage-4-73.jpg` and the geometry
in `nord-stage-4.visual.json`. Captures: `stage3-desktop.png` (1440×900) and
`stage3-narrow.png` (390×844). Console during capture: only the standard "AudioContext
must be resumed after a user gesture" autoplay warning — no errors.

## Desktop (1440×900)

- **Full surface present, left→right in the documented order:** Master Level + Pitch/Mod
  wheels + Rotary Speaker + Master Clock cluster · **Organ** section · **Piano** section ·
  **Program/Performance** column (OLED, Program 1–8 page, Live/Scene/Split/Panic, morph
  assign) · **Synth** section · **Layer Effects** rack (Mod 1, Mod 2, Delay, Amp Sim/EQ,
  Comp, Reverb). Section framing, the maroon body, and the "nord stage 4 / HAMMER ACTION 73"
  badge match the reference palette and proportions.
- **73-key keybed** spans the full width (E–E), correct white/black key layout, playable.
- **Organ** shows the nine drawbars with live LED bar-graphs at their footage labels
  (16'…1'), ORGAN MODEL selector (B3/Vox/Farf/Pipe1/Pipe2/B3 Bass), VIB/CHORUS C1–C3/V1–V3,
  and B3 PERCUSSION (Soft/Fast/Third). Drawbar graphs render per-model spectra.
- **Synth** shows the OSC waveform readout ("Super Saw"), MODE, ARP/GATE (rate/dir/range),
  VOICE (Poly/Mono/Legato), VIBRATO, LFO (waveform + destination), AMP SIM/EQ, and the
  OSCILLATORS category list (Pure/Sync/Multi/Super/FM-H) with the WAVE picker.
- **OLED** reads a real program name/page ("1.1 White Grand — Page 1").
- **Honesty strip (corrected this phase):** now reads *"Phase 3: Piano, Organ, Synth, Layer
  Effects, and the Program system are live through one AudioContext. Every control is bound
  or listed as unsupported — nothing fakes success."* (The inherited string still said
  "Phase 2 … Organ, Synth, and Program stay decorative," which was stale/under-claiming now
  that those sections are wired and tested; corrected to tell the truth.)

## Narrow (390×844)

- The instrument deck keeps its true horizontal scale and **scrolls horizontally inside its
  own container** — the page body does not scroll sideways, and section internals stay
  legible rather than reflowing into a broken stack.
- Status strip and voice-count chip wrap below the deck and remain readable.

## Behavior verified beyond the screenshot

- One AudioContext confirmed: Organ and Synth voices (`OrganVoice`/`SynthVoice`) are spawned
  by `organNoteOn`/`synthNoteOn` into the inherited Phase 2 buses → effects → master →
  single destination. No second context is created.
- `organEngine.test.ts` renders B3/Vox/Farf/Pipe with identical drawbars via
  OfflineAudioContext and asserts spectrally distinct output (not one renamed oscillator).
- `program.test.ts` asserts lossless serialize→deserialize round-trips including split zones,
  scenes, and wheel/pedal morph assignments across the 32 + 8 Live slots.

## Not yet perfect / honest gaps

- The Synth OLED "Super Saw" label overflows its readout slightly at 1440px; cosmetic, does
  not obscure adjacent controls.
- Spec-excluded controls are surfaced as unsupported in the UI notes rather than silently
  no-op, per the honesty contract.
