# Phase 3 audit — Nord Stage 4 73

Phase 3 completes the instrument: the **Organ** engine, the **Synth** engine and the **Program /
performance system**. The Phase 1 surface and the Phase 2 piano, sample library and effect chains
are carried forward unchanged; this document records what was measured, what was exercised by
hand in a real browser, and — in full — what is still not implemented and why.

## Gates

| Gate | Result |
| --- | --- |
| `pnpm test` | 290 passed across 21 files (200 inherited + 90 new), 0 failed |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean, 0 warnings |
| `pnpm build` | clean (`dist/assets/index-*.js` 392 kB, 111 kB gzip) |

`tests/feature-matrix.json` maps the eighteen Phase 3 feature IDs from `TASK.md` onto the test
files that actually exercise them, alongside the twenty inherited Phase 1 and Phase 2 IDs.

## Measurements

### Control inventory

Measured live in Chrome at 1600×1000 against the running dev build:

- 147 control ids in the DOM, exactly one node each (unchanged from Phase 1/2).
- `data-functional="true"` on **138**, `data-functional="false"` on **9**. Phase 2 was 48/99.
- `document.elementFromPoint` sweep over the centre of every control: **0 unreachable**, 0
  zero-sized, 0 covered by an overlay or a clipped plate.
- The same sweep over the front lip of all 73 keys: **0 unreachable**.
- Console during the whole interaction pass: **0 errors** other than a `GET /favicon.ico 404`,
  which is the dev server having no favicon and is not produced by the artifact.

### Audio, measured through an analyser tapped onto the destination

Peak / RMS read from a `Float32Array` of the live destination signal, and band energy from
`getFloatFrequencyData`:

| Flow | Measurement |
| --- | --- |
| Program 1.1 Grand Piano, C4 held | peak 0.236, RMS 0.093; low −63.9 dB, mid −70.3, high −89.3 |
| Program 1.3 B3 Perc Fast, C4 held | peak 0.893, RMS 0.428 (rotary and percussion audible) |
| Drawbar 9 pulled fully in **while C4 was still held** | band energy moved (mid −49.1 → −46.6 dB) with no re-trigger — the sounding note followed the drawbar |
| Program 1.6 Super Saw Lead | Synth OLED reads `SUPER SAW · SUPER · OSC CTRL = SPREAD`; peak 0.081 |
| Program 1.7 FM Bell Arp, C4 held | peak sampled every 90 ms: 0.244, 0.247, 0.247, **0.0001**, 0.241, 0.243, 0.242, **0.0001** — a real gated arpeggio, not a sustained note |
| Program 1.8 Split B3 + Piano | one split LED above the keybed; A2 (organ zone) peak 0.864, D#5 (piano zone) peak 0.119 |
| Computer keyboard `KeyA` | peak 0.176 — note input via `KeyboardEvent.code`, as this artifact matches |
| SHIFT + TRANSPOSE (Panic) | destination peak and RMS both fall to exactly 0 |

### Morph, measured on the panel and in the engine

Assign flow exercised by hand: hold `MORPH ASSIGN WHEEL`, drive `synth.filter.freq` to 10,
release the source, then move the wheel.

| Wheel | `synth.filter.freq` shown | `data-morphed` |
| --- | --- | --- |
| after release, 0 | 6.4 (back to the start value) | `true` |
| 1.0 | 10 | `true` |
| 0.5 | 8.2 (exact midpoint) | `true` |
| after SHIFT + WHEEL (clear) | 6.4 | `false` |

## Flows exercised by hand in the browser

1. Start audio with a pointer press on a key; recorded sample sets load (`data-sample-fallback="false"`).
2. Recall factory programs 1.1, 1.3, 1.6, 1.7 and 1.8 from the Program buttons; the OLED headline
   tracks each one (`1.3 B3 PERC FAST` …).
3. Edit a recalled program and watch the `E` dirty indicator appear, then disappear on a program
   change (edits discarded, as the manual specifies).
4. Pull a drawbar while a note is held and hear the ringing note change.
5. Play the split program in both zones and confirm the split-point LED strip above the keybed.
6. Enter Live Mode (`LIVE 1`), edit, and confirm the edit is auto-stored; reload and confirm the
   Live slot came back from `localStorage`.
7. Assign, interpolate and clear a Wheel morph.
8. Panic (SHIFT + TRANSPOSE) with notes and sustain held: everything stops immediately.
9. Play from the computer keyboard, which matches on `KeyboardEvent.code`.

## Deliberate deviations, declared

1. **Rotary source.** The organ always feeds the shared rotary speaker, as it does on the
   instrument. The `ORGAN` / `CLOSE MIC` button therefore chooses the microphone perspective
   (close mic raises the horn's amplitude-modulation depth from 0.25 to 0.42 and its highpass
   from 780 Hz to 1150 Hz) rather than switching the feed off. Both positions are audible; neither
   is a no-op.
2. **Stop Mode / Angle.** `Stop Mode` makes the Slow position a full stop with the rotors
   decelerating over 2.2 s; `Angle` additionally parks the horn off-axis (static pan +0.62). The
   manual's stop-angle menu is reduced to these two states.
3. **Split editing.** The hardware opens the split editor with a press-and-hold. A browser
   press-and-hold is unreliable, so the editor is `SHIFT + SPLIT`, which steps Low → Mid → High →
   off. The Program dial then sets the point's key and the Page buttons set its crossfade.
4. **Morph assignment.** The hardware assigns while the source button is held. This build uses the
   documented double-tap latch instead: one press arms, one press releases. Releasing returns
   every assigned destination to its start value, exactly as releasing the hardware button does.
5. **Zone assignment.** `KB ZONE` is `SHIFT` + that layer's ON/OFF button, cycling whole keyboard
   → zone 1 → zone 2 → … → whole keyboard. The four zone LEDs under each layer show the result.
6. **The three dials under the Synth OLED are context sensitive**, as they are on the instrument.
   With no envelope page open they are Filter Drive, Oscillator Category and Waveform; with one of
   the three ENVELOPE buttons lit they are that envelope's Attack, Decay and Release. The OLED
   prints which, live. Their accessible names say both roles.
7. **Vibrato menu.** The synth spec asks for a Rate 2.0–8.0 Hz and Amount 0–10 menu. This build
   offers four documented rate/amount pairs (2.0 Hz/2.5, 5.5 Hz/5, 6.5 Hz/7.5, 8.0 Hz/10) stepped
   by the VIBRATO MENU button, rather than two free continuous parameters. That is a reduction and
   is declared as one.
8. **Hard sync is a wavetable.** `OscillatorNode` has no phase reset, so Sync Saw and Sync Square
   are single-cycle wavetables generated at note-on and looped. They are deliberately not band
   limited, so they alias at the top of the keybed — audible, honest, and recorded in
   `IMPLEMENTATION_DETAILS.json`.
9. **Transpose editing.** `TRANSPOSE ON/SET` toggles transpose on; while it is on, the Program
   dial sets the amount (−6…+6) instead of browsing programs. The hardware uses press-and-hold.
10. **STORE keeps the program's name; STORE AS renames.** Naming uses the Program dial for the
    character and the Page buttons for the cursor.
11. **Transpose applies to notes as they start.** A note already sounding keeps its pitch when
    transpose changes, which is what the instrument does.
12. **Pitch stick bends the Synth section only.** Organ and piano voices are not bent; the PSTICK
    indicators on those two layer strips stay unlit and this is listed below.

## Still not implemented — the complete list

### The nine decorative controls

Each is decorative because an assigned spec puts its behaviour under `scope.excluded` (or, for
Solo/Undo, under `scope.optional`). They move, light, report their value through
`aria-valuetext` / `data-value`, and change nothing else. The reasons are carried in code, in
`UNSUPPORTED_CONTROL_IDS` (`src/model/controls.ts`), and a test asserts that this list and the
`functional` flag agree in both directions.

| Control | Why |
| --- | --- |
| `fx.delay.effects` | effects spec, `scope.excluded` — the delay feedback-loop effects |
| `organ.preset` | organ spec, `scope.excluded` — Preset / Drawbar Live modes are physical-drawbar concepts |
| `program.morph.aftertouch` | programs spec, `scope.excluded` — browser keyboards have no aftertouch |
| `program.preset.organ` | programs spec, `scope.excluded` — the preset library |
| `program.preset.piano` | programs spec, `scope.excluded` — the preset library |
| `program.preset.synth` | programs spec, `scope.excluded` — the preset library |
| `program.solo` | programs spec, `scope.optional` — Solo and single-level Undo, neither implemented |
| `program.section-edit` | programs spec, `scope.excluded` — Section Edit / Layer Init |
| `program.mon-copy` | programs spec, `scope.excluded` — Monitor / Copy / Paste / Swap |

### Indicator-only legends with no control behind them

These are printed silk screen and LEDs, not inputs, and they are inert by construction: `AUX KB`,
`NUM PAD`, `PEDAL TAP`, `MIDI` / `EXTERN` on the Program plate, `PRESET NAME`, the organ
`POLY ▽` percussion legend, the synth `EXCLUDE ▽` / `KB SYNC ▽` / `GROUP ▽` / `PATTERN ▽`
legends, and the Comp `FAST` legend (this panel carries no button for it).

### Behaviour that is not there

- **Organ SUSTPED.** The organ does not answer the sustain pedal; its SUSTPED indicator stays
  unlit rather than implying otherwise. The organ spec mentions the toggle but the control
  inventory has no button for it.
- **Pitch stick on Organ and Piano.** Only the Synth section is bent (±2 semitones). The PSTICK
  indicators on the Organ and Piano layer strips stay unlit.
- **Synth Samples and Extern modes.** Both are excluded or optional in the synth spec. Selecting
  either silences the layer and the Synth OLED prints `(UNSUPPORTED — SILENT)`. The layer is not
  quietly left on Analog pretending to be something else.
- **Master Clock keyboard sync.** The clock's `keyboardSync` flag is carried in the program state
  and round-trips, but nothing consumes it; no panel control sets it.
- **Arpeggiator pattern editing, zig-zag, accent, pan, per-layer KB Hold exclude, Filter/LFO/Arp
  Group modes.** All excluded by the synth spec.
- **Banks beyond one, the 512-program factory layout, Organize swap/move, Num Pad, Aux KB,
  Extern, memory protection, every Shift menu, external MIDI clock sync and pedal tap.** All
  excluded by the programs spec.
- **Tonewheel wear modes, keyboard trigger point, Sound-menu rotary tuning, swell pedal.** All
  excluded by the organ spec.

## Inherited assertions that changed, and why

Four inherited assertions encoded a Phase 2 truth that Phase 3 makes false. Each keeps its
invariant; only the fact it asserts moved.

1. `src/model/controls.test.ts` — "marks exactly the Phase 2 controls functional" asserted that
   every Organ, Synth and Program control was decorative. Those sections now have engines. The
   test still asserts the same two-directional invariant, now against
   `UNSUPPORTED_CONTROL_IDS`: the decorative set and the `functional` flag agree exactly, and each
   decorative control names the spec clause that excludes it.
2. `src/components/interaction.test.tsx` — the same section-level claim, plus
   `expect(moved).toBeGreaterThan(90)`. It now asserts that each of the three sections carries
   functional controls, that every control's `data-functional` matches the declared list, and that
   operating **all** the decorative controls (now 9) still leaves the graph and its output
   untouched. The silence assertion is unchanged.
3. `src/components/surface.test.tsx` — the status-strip wording it matched described the Phase 2
   split of live and decorative sections. It now matches the Phase 3 wording.
4. `src/state/deck.test.tsx` — "leaves decorative controls out of the engine settings entirely"
   drove Organ/Synth/Program controls. It now drives every id in `UNSUPPORTED_CONTROL_IDS` and
   asserts the derived settings are byte-identical, which is the same invariant on the true set.

No test was weakened or deleted, and no lint or tsconfig rule was loosened.

## Coverage written for the required feature IDs

Four of the required IDs were not honestly covered by the tests as first written, so tests were
added rather than the matrix bent to fit:

- `hardware.bindings` — `src/state/bindings.test.ts` operates **every** functional control and
  requires it to change either the settings the engine is driven from or deck state outside its
  own position. The control's own value and its layer bank are excluded from the comparison, so a
  control that merely remembers where it was set fails the test. The four modal controls (SHIFT on
  both plates, TRANSPOSE, and Sound Init, which needs something to reset) are declared in the file
  and asserted individually, and the nine decorative controls are asserted to change nothing.
- `layers.routing` — `src/state/routing.test.ts` asserts enable, level, octave and effect target
  for each of the seven layers, hears each one only while it is enabled, and checks that an effect
  edit lands on the focused layer and not its sibling.
- `splits.zones` — two tests added to `src/state/program.test.ts`: every one of the eleven
  documented positions is reached from the editor, and three points build four zones with a layer
  walked into each and note routing asserted at both boundaries.
- `organ.engine` — two tests added to `src/audio/organEngine.test.ts`: a full two-layer note
  lifecycle whose voice and node counts return to the steady-state baseline, and per-layer level
  and keyboard zone.

`programs.navigation` was extended in place with dial browsing in both directions and the list
view opened from both SHIFT + dial and the printed PROG VIEW button.

## Captures

`evidence/stage1-*.png` and `evidence/stage2-*.png` are the inherited captures. The Phase 3
captures are produced by the parent capture harness at seal time; the browser session above was
run against the same dev build at 1600×1000.
