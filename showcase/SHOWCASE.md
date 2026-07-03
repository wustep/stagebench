# Stagebench showcase — the "perfect" Nord Stage 4

This is **not a benchmark run.** It was seeded from the best-scoring artifact
(`claude-fable-5` Phase 2, sealed 2026-07-02, Phase 1 scored 96/100) and is
iterated on continuously — using the evaluation findings, the reference
photography, and the manual — beyond what any single-run protocol allows.
Its numbers must never be compared with the runs in the gallery.

Rules that still apply: the honesty contract (no control fakes behavior),
truthful `IMPLEMENTATION_DETAILS.json` provenance, and green
`test` / `typecheck` / `lint` / `build` gates before publishing.

Publish to the gallery with `pnpm bench showcase` (builds and copies to
`public/previews/showcase/`).

## Iteration log

### 1 — seed + evaluation-issue fixes (2026-07-02)

- Seeded from `runs/claude-fable-5/stage2` (excluding evidence/plan).
- Fixed `legend-truncation-desktop`: legends wrap like the printed panel
  instead of ellipsis-truncating (`RATE/TIME` breaks at the slash via `<wbr>`);
  the Synth OLED widened from 30% to 40% of its row with resized type and
  stacked dial captions, so `OSC WAVEFORM` / `Super Saw` render in full.
  Verified at 1440x900: zero truncated legends, zero caption collisions.
- Fixed `first-note-warmup-latency`: the engine warms during idle time after
  mount (context created suspended, graph built, samples decoded), so the
  first key press only resumes the context. Injected test boundaries keep the
  lazy path; offline render contexts are never resumed early.
- Still open for a future iteration: `narrow-legend-legibility` (sub-pixel
  legends at 390x844 — needs an inspect/zoom affordance).

### 2 — complete piano library + pedal routing (2026-07-02)

Worked through the Phase 2 evaluation's priority issues (89/100, piano
library was the weak category at 73):

- **All six piano types now bundle a recorded model.** Clav = GM Clavinet,
  Digital = GM Electric Piano 2 (FM/DX character), Misc = GM Vibraphone
  (mallet, per the spec's Misc source rule) — same MIT MIDI-JS-Soundfonts
  provenance chain as the existing Upright/Electric sets, 19 roots × 1 layer
  each, synced by `scripts/sync-samples.mjs` and declared in
  `IMPLEMENTATION_DETAILS.json` / `public/samples/SOURCES.md`. Rendered-audio
  tests prove all six audibly distinct; live-browser analyser sweep confirmed
  distinct zero-crossing/RMS signatures per type. "Piano not found" is now
  reached only through load failure — the type LED flashes for a failed load
  (spec `missingModelState`), and recovery restores samples.
- **SUSTPED and PSTICK are functional** exactly as the manual specifies
  (p. 23): Shift + Layer A routes/unroutes the sustain pedal for the Piano
  section, Shift + Layer B gates the pitch stick (±2 st). Their panel LEDs now
  show routing state; toggling mid-note releases held voices / re-applies the
  bend. No new physical controls invented — the photo-measured surface is
  unchanged.
- **On-screen sustain pedal** (latching, accessible, in the status strip —
  off-chassis) completes the spec's required UI/keyboard/MIDI sustain trio.
- **Soft Release is disabled for Clav** (manual p. 25), tested.
- Fixed a real dev-only bug found while verifying in the browser: StrictMode's
  simulated unmount disposes the engine and detached its store subscription
  permanently, freezing every panel control's audio effect in dev (production
  unaffected). `attachStore` now re-attaches on mount, with a StrictMode
  regression test.
- Fixed `typecheck` portability: `@types/node` is now a direct devDependency,
  so `tsc --noEmit` passes on an isolated copy (verified on a scratch clone
  with a frozen-lockfile install).
- Gates: 211/211 tests, typecheck, lint, build all green.
- Still open: `narrow-legend-legibility` (above) and the evaluation's note
  about spec-excluded extras (half-pedaling, pedal noise, delay feedback-loop
  effects, Analog mode) staying functional — kept intentionally in the
  showcase, declared honestly.

### 3 — Organ section (2026-07-02)

First step past the sealed Phase 2 scope: the Organ section is functional,
modeled on `specs/nord-stage-4.organ.json` and manual p. 18-22.

- **Four generated engines, audibly distinct** (rendered pairwise similarity
  < 0.8): B3 (nine sine tonewheel partials, key click, vib/chorus scanner),
  Vox (sawtooth partials + filtered/unfiltered tone-mix drawbar), Farf
  (square/saw register switches — pulled past half engages), Pipe 1 (detuned
  sine ranks + chiff). All declared as digital models in
  `IMPLEMENTATION_DETAILS.json`; B3 Bass and Pipe 2 LEDs exist unlit.
- **Drawbars are live**: the nine panel drawbars write canonical per-layer
  state, drive the LED graphs, and retune *sounding* voices immediately
  (rendered proof: a mid-note 1′ pull brightens the spectrum in place).
- **B3 percussion** (single-triggered, volume soft / decay fast / harmonic
  third) and the **C1-C3/V1-V3 scanner** (per-layer on/off, V deeper than C,
  depth grows 1→3) measurably change rendered audio.
- **Two layers** with enable/focus/level/octave; organ SUSTPED/PSTICK via
  Shift + Layer A/B (manual p. 18); organs ignore velocity (authentic);
  ~20 ms declick releases; per-section pitch-stick gating.
- **Rotary routing**: the ORGAN source button in the Rotary strip crossfades
  the organ into the single shared rotary instance and lights the strip LED.
- Organ channels build lazily on first use so a piano-only session pays no
  scanner-LFO cost; hardened the offline render harness against a
  load-dependent `OfflineAudioContext.suspend` flake (retry with a fresh
  context — pre-existing, reproduced on the untouched tree).
- 20 new tests (12 graph/state + 8 rendered). Deliberately not yet built:
  organ layers through the per-layer effect chains (spec wants a shared organ
  chain — declared, not pretended), percussion POLY mode, KB zones/splits.

### 4 — Programs (2026-07-02)

The Programs cluster from `specs/nord-stage-4.programs.json` (manual p. 13,
38-45), minus splits/scenes/morphs/master-clock (still decorative):

- **32 bank slots (4 pages × 8) + 8 Live slots.** A program snapshots every
  supported piece of state — piano, organ, chains, focus/routing, rotary —
  and deliberately excludes Master Level (per spec). Snapshots are parameter
  JSON, serializable and persisted through a new injectable
  `StorageBoundary` (localStorage in the browser), so programs and Live
  edits survive reload.
- **Navigation**: the 8 Program buttons select within the page, PAGE ◂ ▸
  moves across the four pages, the Program dial browses all 32, and
  Shift + dial opens the numeric list view on the Program display
  (dropping Shift exits, manual p. 41).
- **Store flows per the manual (p. 13/41)**: STORE captures the edited
  sound, navigation *auditions* the destination slot, STORE confirms,
  Shift/Exit aborts and restores the edited sound at the origin. STORE AS
  opens naming first — dial picks the character, PAGE moves the cursor.
  The store LED and destination program LED flash while pending.
- **Truthful dirty state**: any program-captured edit raises the display's
  E flag; changing programs discards edits (SOLO UNDO brings the discarded
  edit state back once — the spec's optional single-level undo).
- **Live Mode** auto-stores every edit instantly (no E flag), and Store
  copies content between Live and bank slots by toggling LIVE MODE during
  the destination step (manual p. 44).
- **8 factory programs** (Royal Grand, Tine Stack, Full House B3,
  Continental Vox, Chapel Pipes, Clav Funk, FM Ballad, Night Vibes) — all
  honest snapshots of currently-functional state; no synth or split factory
  programs because those engines don't exist yet.
- 14 new tests; the two tests that pinned Program controls as decorative
  evolved to today's truthful functional/decorative split.

### 5 — Splits, zones and Layer Scenes (2026-07-02)

The keyboard-routing cluster from the programs spec (manual p. 39, 43):

- **Splits**: SPLIT ON/SET toggles a single Mid split at C4; Shift+Split
  opens a panel split editor (our declared adaptation of the manual's
  press-and-hold menu): the Program dial picks among the 11 documented
  positions (C2…C7), PAGE selects Low/Mid/High, PROG 1 toggles the point,
  PROG 2 cycles the crossfade Off/±6/±12. Active points render as red
  markers above the keybed.
- **Zones**: up to 4 zones from the active points; every piano/organ layer
  carries a contiguous KB ZONE assignment stepped with Shift+Octave ◂ ▸
  (manual p. 39), shown on the per-section zone LEDs. The engine routes
  notes per zone — crossfades scale adjacent layers complementarily (they
  sum to 1 across a boundary) and a hard split switches exactly at the
  point. Rendered proof: a high-zoned layer is silent below the split and
  a ±12 boundary note renders at half level.
- **Layer Scenes I/II**: swaps the piano/organ layer-enable configuration
  while every sound parameter stays shared; the LAYER SCENE II button LED
  shows the active scene. Scene configs and splits are program state and
  round-trip through Store.
- New factory program **2.1 "Bass & Tines"**: B3 bass registration below a
  ±6 C3 split, tine EP above — the spec's split demo, now honest.
- 13 new tests (11 state/graph + 2 rendered). Still decorative: morph
  assignment, Master Clock, Transpose.

### 6 — Morph assignment (2026-07-02)

Wheel and Control Pedal morphs from the programs spec (manual p. 38-39);
the A.T. button stays decorative (aftertouch is spec-excluded — browsers
have no aftertouch):

- **Assignment**: latch WHEEL or CTRLPED, then move any morphable
  destination — the edit records its start→end range (first edit captures
  the pre-edit value as start; later edits move the end; returning a
  control to its start removes that one assignment). Shift + source button
  clears the whole source. Assigned controls show a green morph dot.
- **Destinations** (all engines that exist): piano/organ layer levels,
  all nine drawbars (bound to the layer focused at assignment time),
  rotary speed (slow below half, fast above — the spec's morphable speed),
  and Mod 1 rate/amount, Mod 2 amount, delay tempo/feedback/mix,
  EQ mid-freq, drive, reverb mix. One source can raise one destination
  while lowering another.
- **Sources**: the mod wheel is now functional as the Wheel source; the
  Control Pedal source is driven by a new on-screen CTRL PEDAL slider in
  the status strip and by MIDI CC11, per the spec's controlPedalInput.
- **Performance semantics**: moving a source interpolates destinations
  through canonical state (the engine hears it live) but never raises the
  dirty flag and never churns Live-slot auto-store; assignments themselves
  are program state and round-trip through Store.
- Hardened the offline render harness once more: a silently skipped
  suspend step now forces a retry (steps-ran accounting), closing the
  remaining load-dependent flake path.
- 10 new tests. Simplification declared: fader/drawbar LED graphs don't
  yet display the morphed *range* (spec indicator nicety) — assigned
  controls get the green dot instead.

### 7 — Master Clock and Transpose (2026-07-02)

The last two `clockAndPerformance` controls from the programs spec
(manual p. 40), both now functional and program-stored:

- **Master Clock**: MST CLK TAP/SET taps 4+ times to derive a BPM from the
  average interval (fewer taps only prompt "tap 4+ times to set"); Shift +
  the button opens a dial-edit mode (our declared adaptation of the
  manual's press-and-hold menu) where the Program dial sweeps 30–300 BPM
  and PROG 1/PROG 2 toggle the Delay/Mod 1 sync flags for the focused
  chain. Split-edit, clock-edit and transpose-edit are mutually exclusive —
  entering one closes the others.
- **Sync mapping**: a synced Delay's tempo becomes the quarter-note
  interval (`60000 / BPM` ms) and a synced Mod 1's rate becomes one LFO
  cycle per beat (`BPM / 60` Hz), computed once per `applyState()` tick and
  substituted into each chain that has its MST CLK flag on; a lit red
  `MST CLK` tag under the Delay Tempo and Mod 1 Rate knobs shows which
  chains are synced.
- **Transpose**: TRANSPOSE ON/SET is a latching on/off toggle (−6..+6
  semitones, `+0`/`+2`/`-3` display); Shift opens its own dial-edit mode.
  The offset shifts sounding pitch for both piano voices (sample playback
  rate) and organ voices (partial frequencies) — including the minimal
  fallback voice — but keyboard-zone routing keeps evaluating the raw
  played MIDI note, so a transposed note can still land in a zone its
  transposed pitch would never naturally reach.
- Both `masterClock` and `transpose` are program-snapshot keys and
  round-trip through Store/undo/Live exactly like every other sound
  parameter.
- 11 new tests (9 state/panel/engine + 2 rendered): tap-tempo threshold,
  dial-edit BPM/sync toggles, rendered delay-time-vs-BPM proof, rendered
  transpose pitch-shift proof, and the zone-vs-transpose split case.

### 8 — Minimal page chrome (2026-07-02)

Presentation-only iteration — the instrument and its honesty contract are
untouched:

- The status strip below the instrument now defaults to a **minimal** view:
  one slim row with the on-screen SUSTAIN PEDAL, the CTRL PEDAL morph
  slider, and a small ⓘ INFO toggle.
- The full strip (engine/MIDI/pedal status lines and the functional-scope
  note) expands with the toggle; the preference persists via the injectable
  storage boundary (`stagebench.ui.v1`).
- The informational elements stay in the DOM (CSS-collapsed), so the
  aria-live status region and every existing status assertion keep working
  unchanged; 4 new tests cover default, toggle, persistence, and truthful
  reporting while minimal.

### 9 — Shared organ effect chain (2026-07-02)

Closes the gap iteration 8's implementation notes declared rather than
pretended (manual p. 18: "Both Organ Layers share the same effects chain"):

- **One chain, both layers**: a single Mod 1 → Mod 2 → Delay → Amp/EQ →
  Comp → Reverb chain (same units, same order as a Piano layer chain) now
  sits between the organ layers' scanners and the master/rotary sends —
  each layer's level feeds the shared chain's input; the chain's own
  Amp-unit "To Rotary" mode (or the ORGAN rotary-source button) routes the
  whole organ, post-reverb, into the single rotary instance, exactly like a
  Piano layer.
- **FX focus follows the section you're playing**: pressing an Organ layer
  button (or Organ Focus) moves the panel's effect knobs, buttons, Group
  mirroring, Global mirroring and morph capture onto the shared organ
  chain; pressing a Piano layer button (or the FX Focus Group cycle) moves
  focus back to the focused Piano layer's chain — matching the manual's
  "focus follows the layer" behavior for the Organ side too. A new
  `focusedChain()` store helper and the FX FOCUS column's ORGAN A/B LEDs
  (previously decorative placeholders) make the active focus visible.
- **Global mode now reaches the organ**: entering Delay/Comp/Reverb Global
  mode (Shift + On) mirrors the focused Piano layer's unit onto chain A,
  chain B, *and* the organ chain in one motion, so a global reverb setting
  is genuinely global.
- `organChain` and `fxSection` are new program-snapshot keys — they
  round-trip through Store/Store As/undo/Live exactly like every other
  chain.
- 9 new tests (7 state/panel/engine in `organ-chain.test.ts` + 2 rendered
  in `render-organ-chain.test.ts`): focus-follows-layer with LED
  verification, organ-focused edits landing on `organChain` only,
  per-unit bypass, Global mirroring onto the organ chain, To-Rotary routing
  via the organ chain's Amp unit, program round-trip, and rendered proof
  that the organ audibly passes through the shared chain's Reverb (longer
  post-noteOff tail) and Mod 1 Tremolo (amplitude wobble).
- **Repair**: `pnpm test` was intermittently red on the full suite only
  (never in isolation) — `render-organ.test.ts`'s model-distinctness and
  vibrato-depth checks and `render-effects.test.ts`'s drive-saturation check
  would occasionally see near-zero divergence between renders that are
  bitwise-verified distinct in isolation. Root cause: `src/test/offline.ts`
  never disposed the `PianoEngine`/`OfflineAudioContext` it built for each
  render, so a 34-file, 290-test run left dozens of undisposed native
  contexts and oscillator graphs live at once — the actual bug was the
  leak, not the measurements. `renderEngineOnce` now copies the rendered
  channels out and calls `engine.dispose()` before returning (shimming a
  no-op `close()` onto the offline context, which has none); six
  consecutive full-suite runs came back clean after the fix (roughly 2 of
  5 runs failed before it). No test assertions were weakened.

### 10 — Synth part 1: sources and layers (2026-07-02)

The Synth section starts becoming real (spec: `nord-stage-4.synth.json`,
Analog-mode oscillator scope) — three layers, the exact required waveform
list, category-correct Osc Ctrl behavior, and the amp envelope:

- **Three layers, real state**: `SynthState` mirrors the Organ pattern —
  layers A/B/C with enable/focus/level/octave/zones and per-section
  SUSTPED/PSTICK (Shift + Layer A/B, same convention as Piano/Organ); layer A
  starts enabled so SYNTH ON is immediately audible, matching the reference
  power-on pose. `synth` is a new program-snapshot key (old snapshots
  lacking it — pre-existing localStorage payloads — are tolerated: the
  spread semantics that already protect every other key cover it too, now
  proven by a dedicated test). Layer Scenes I/II now swap the synth layer
  enables alongside piano/organ.
- **The exact waveform list, generated honestly**: `SYNTH_WAVEFORMS` is the
  spec's ordered Pure/Sync/Multi/Super/FM-H list. WAVEFORM SELECT cycles
  categories; the Synth OLED's dial 2 picks an exact waveform, mirroring the
  piano-model encoder mapping. Every waveform is a real, generated Web Audio
  source (`src/audio/synth-oscillators.ts`): Pure uses native oscillator
  types plus PeriodicWave-built Pulse 33/10 and a looping generated
  White-Noise buffer; **Sync Saw/Square are a DECLARED spectral
  approximation** of hard sync — not the real two-oscillator reset
  mechanism, but a PeriodicWave whose harmonic energy is shaped by a
  gaussian resonance bump that Osc Ctrl sweeps across the spectrum, which
  reproduces the audible signature (a moving formant) honestly labeled as an
  approximation; Multi Saw/8ve are 3-4 real detuned sawtooths; Super
  Saw/Square are a real 7-oscillator unison stack with alternating stereo
  pan; FM 2-op is genuine two-operator FM — a 1:1 modulator's gain feeds the
  carrier's `frequency` AudioParam directly. Osc Ctrl follows the spec's
  per-category table exactly (no effect on Pure; detune/width/index/sync-peak
  on the other four) and retargets live on sounding voices when it moves.
- **Amp envelope**: attack/decay/release shape every voice's gain node
  (decay at 127 holds at the attack peak, per the manual's sustain-mode
  rule); velocity Off/1/2/3 scales how much played velocity affects the
  peak. The AMP ENVELOPE button latches the three Synth OLED dials onto
  editing attack/decay/release (`synthEnvEdit`, panel-only state) — while
  latched, dial 2 no longer picks a waveform; releasing it restores the
  waveform-list mapping.
- **Real OLED, real LEDs**: the Synth display now shows the selected
  waveform's name and category, OSC CTRL as 0.0–10.0 (one decimal), and the
  A/D/R readout while the amp envelope is being edited; the Mode box lights
  ANALOG (the only implemented mode; SAMPLES/EXTERN and the mode button stay
  decorative per spec exclusions); SUSTPED/PSTICK LEDs and the shared
  KB ZONE LED row (extended to a synth variant) reflect real state.
- **Still honestly decorative**: filters, the oscillator and filter
  envelopes, LFO, voice modes (mono/legato/glide/unison/vibrato) and the
  arpeggiator/gate — every one of their panel controls still moves and lights
  but writes nothing; the status note and `IMPLEMENTATION_DETAILS.json` say
  so explicitly. These arrive in later Synth iterations.
- 20 new tests (15 fake-level in `src/audio/synth.test.ts` covering section
  gating, per-layer ownership, waveform navigation, oscillator construction
  per category — including asserting the FM modulator's gain is connected to
  the carrier's frequency `AudioParam` — live Osc Ctrl retargeting, the amp
  envelope and velocity scaling, SUSTPED routing, and program round-trip
  including the missing-key tolerance case; 5 rendered in
  `src/audio/render-synth.test.ts` proving Pure/Sync/Multi/Super/FM-H are
  pairwise distinct, Osc Ctrl audibly sweeps Sync and Super, Pulse 33/10/
  Square are distinct, and a slow attack measurably softens the onset).
  `src/model/hardware.test.ts`, `src/components/decorative-controls.test.tsx`
  and `src/components/accessibility.test.tsx` evolved to reflect the new
  functional ids and the truthful synth-layer-a power-on pressed state —
  no existing behavior check was deleted.

### 11 — Synth part 2: filters, envelopes, LFO (2026-07-02)

The Synth engine gains its filter, all three envelopes and its LFO (spec:
`nord-stage-4.synth.json` filter/envelopes/lfo) — every one of these panel
controls now writes real state that measurably changes the rendered signal:

- **Per-voice filter, not a label**: `SynthFilterState` (on/type/freq/res/
  tracking/drive/envAmount/envelope) drives a real per-voice chain — a
  `WaveShaperNode` drive stage (Off/1/2/3, the same tanh-saturation curve
  shape as the Rotary Speaker's drive) feeds one `BiquadFilterNode` for
  LP12/HP/BP or two cascaded lowpass stages in series for LP24 (a genuine
  24 dB/octave slope, not a steeper Q on a single stage). FILTER TYPE cycles
  LP12→LP24→HP→BP→LP12; **Shift + FILTER TYPE cycles keyboard tracking**
  (Off/1-3/2-3/1 — a manual adaptation, documented in the action's comment,
  since the hardware's own tracking control has no dedicated panel button
  here) and scales the base cutoff by `2^(tracking/3 * (midi-60)/12)`, so
  higher notes open brighter under full tracking. **Shift + FILTER ENVELOPE
  cycles drive** (Off/1/2/3, same pairing convention). FILTER ON is now a
  real latching gate — the whole filter/drive stage is skipped entirely when
  off, and it starts lit (the spec default).
- **All three envelopes, one shared dial trio**: the Amp envelope from Part 1
  is joined by the Filter envelope (attack/decay/release/velocity/envAmount)
  and the Oscillator envelope (attack/decay/release/velocity/toPitch/bipolar
  amount, 64 = 0). AMP/FILTER/OSC ENVELOPE are three latching buttons —
  `synthEnvEdit` is now `'amp' | 'filter' | 'osc' | null` — and whichever one
  is lit is the target the three Synth OLED dials edit; the OLED's envelope
  line and menu now show whichever envelope is selected, not just Amp. The
  filter envelope schedules a real cutoff ramp from the tracked base toward
  an envAmount-scaled peak (up to +4 octaves) and back, decay=127 holding at
  the peak per the existing sustain-mode convention. The oscillator
  envelope's **Env To Pitch** toggle (`toggleOscEnvToPitch`, bound to Shift +
  OSC ENVELOPE — the same pairing convention again) switches its target
  between real pitch (every source oscillator's `detune`, bipolar ±12
  semitones) and the same **live Osc Ctrl target** that Osc Ctrl itself
  already retargets live: FM-H's true modulation-index gain directly, or —
  since Sync/Multi/Super's Osc Ctrl math is JS-computed detune/width/
  sync-peak arithmetic with no single linear AudioParam — a declared
  approximation gain summed into their oscillator(s)' detune. This keeps
  every connection real and audible while being honest that three of the
  five categories get an approximation, not the literal per-category
  mechanism.
- **One standing LFO per synth layer**: built alongside each layer's channel
  and always running (mirroring the effect chain's always-on Mod 1/2 LFOs),
  with five real waveforms — Triangle/Saw Up/Square are native oscillator
  types, Saw Down is the same oscillator through an inverting gain, and
  Sample & Hold is a looping GENERATED xorshift stepped-random buffer — muted
  and unmuted between per-source select gains so a waveform change never
  reconnects the live graph mid-note. Its depth gain connects directly to
  the chosen destination's real AudioParam(s) at voice build: every source
  oscillator's `detune` (Osc Pitch), every filter stage's `frequency` (Filter
  Freq), or the category's live Osc Ctrl target param (Osc Ctrl) — Off (no
  lit destination) means depth 0, matching the manual's "off but keeps its
  settings." LFO WAVEFORM cycles the waveform; **Shift + LFO WAVEFORM
  toggles master-clock rate sync** (the brief's own note: Shift + the Rate
  knob would be awkward, so the pairing moves to the waveform button),
  substituting `mappings.hzToLfoRate(masterClock.bpm / 60)` — the same
  substitution pattern Mod 1/Delay already use. With no dedicated
  destination button in the panel model, **dial 3 selects the destination by
  absolute position** (Off/Osc Pitch/Osc Ctrl/Filter Freq) whenever no
  envelope is latched — the same "dial = absolute list position" convention
  dial 2 already uses for the waveform list — while `cycleSynthLfoDestination`
  remains available as the underlying single-step action.
- **Old-snapshot tolerance, fixed properly**: a persisted (or factory)
  program from before this iteration has a `synth.layers.X` object that
  lacks `filter`/`oscEnvelope`/`lfo` entirely. The previous "missing key"
  tolerance only covered a wholly absent `synth` key; discovering (via a new
  test) that a *present* `synth` missing only the newer per-layer fields
  actually crashed `applyState` and silently dropped the whole engine into
  the reduced fallback path, `cloneSnapshot` (the single function every
  program load/store/undo/Live-copy path routes through) now normalizes
  every synth layer's filter/oscEnvelope/lfo against current defaults before
  it reaches canonical state, and `restorePrograms` was switched onto the
  same helper instead of a bare JSON round-trip.
- New functional ids: `filter-type`, `filter-envelope`, `filter-on`,
  `filter-freq`, `filter-res`, `filter-env-amt`, `osc-envelope`,
  `osc-env-amt`, `lfo-waveform`, `lfo-rate`, `lfo-mod-amt`. Only Synth's
  voice modes and the arpeggiator/gate remain decorative now.
- 16 new tests (10 fake-level in `src/audio/synth-filter.test.ts` covering
  filter node types/cascade per filter type, keyboard tracking scaling
  cutoff with the played note, drive curve presence/absence, FILTER ON
  gating the whole stage, envelope-target selection routing dial edits to
  the right envelope, the standing per-layer LFO existing, LFO destination
  switching connecting the depth gain to the right real param, master-clock
  rate substitution, and program round-trip of the new fields including the
  fixed old-snapshot tolerance case exercised through a real `noteOn`; 6
  rendered in `src/audio/render-synth2.test.ts` proving LP24 FREQ darkens
  the spectrum, HP vs LP24 render distinct spectra, resonance 127 vs 0
  differ, a high filter-envelope amount audibly sweeps open then back,
  LFO→Filter Freq wobbles windowed brightness far more than the LFO off, and
  LFO rate genuinely follows two different master-clock BPMs when synced).
  `src/model/hardware.test.ts` and `src/components/accessibility.test.tsx`
  evolved for the new functional ids and `filter-on`'s truthful lit-at-
  power-on state — no existing behavior check was deleted.

### 12 — Synth part 3: performance and integration (2026-07-02)

The Synth engine's last scope arrives (spec: `nord-stage-4.synth.json`
voice/arpeggiatorGate/acceptance) — voice modes, note priority, glide,
unison, vibrato, and a deterministic arpeggiator/gate, plus one independent
effect chain per synth layer instead of the straight-to-master routing every
earlier Synth iteration used:

- **Mono, Legato, priority — one real held-note machine, not three labels**:
  `SynthVoiceState` (mode/priority/glide/unison/vibrato/vibratoAmount) drives
  a per-layer held-note stack the engine tracks on every `noteOn`/`noteOff`.
  Poly is unchanged (each note gets its own voice). Mono always retriggers
  the layer's single sounding voice's envelope on a new note, releasing
  whatever it was on. Legato reuses the sounding voice when notes overlap —
  no envelope retrigger, no new oscillator nodes — instead gliding every
  source oscillator's frequency to the new note with `setTargetAtTime`
  (`mappings.glideTimeConstant`, a real constant-rate portamento) and
  renaming the voice's map key so a later `noteOff` addresses it correctly.
  Priority Low/High only matters in Mono/Legato: while a note sounds, an
  incoming lower/higher note only takes over if it wins per the setting —
  losing notes still join the held stack — and releasing the winner returns
  to the next-priority still-held note (`synthKeyUp`'s min/max-of-held pick).
  VOICE MODE cycles Poly→Mono→Legato; **Shift + VOICE MODE cycles priority**
  (manual adaptation: Priority shares the Voice button's menu, no dedicated
  panel control here).
- **Unison and vibrato, real and reused**: SYNTH UNISON (Off/1/2/3) adds 2/4/6
  detuned, panned duplicate oscillators of the layer's fundamental waveform
  feeding the same voice envelope — the exact detune/pan/gain math the piano
  section's own unison already uses, declared as a simplified single-
  oscillator-type duplicate rather than a full per-category rebuild (Sync/
  Multi/Super/FM-H all duplicate as a plain sawtooth). VIBRATO MODE cycles
  Off→On→Wheel: a fixed 5.5 Hz sine LFO per layer (spec: the menu rate is
  fixed, only Amount is panel-editable) whose depth gain — `vibratoAmount`
  when On, the live `morphValues.wheel` position when Wheel — connects to
  every sounding voice's source detune params at voice build.
- **The arpeggiator/gate: a deterministic scheduler on the injected clock,
  not a fake LED**: `synth.arp` (run/mode/rate/mstClk/range/direction/hold)
  is section-level and drives every enabled synth layer from one combined
  held-note set. The scheduler is a self-rescheduling `setTimeout` chain on
  `this.boundary.timers` (cleared on ARP RUN off or engine dispose), stepping
  every `60000/bpm` ms where bpm is either `mappings.arpRateBpm(rate)` or the
  master clock's BPM (**Shift + ARP RUN toggles that MST CLK substitution**
  — the brief's own note that Shift + the Rate knob is impossible on a
  knob). Arp mode expands the held set over 1-4 octaves (RANGE) in Up/Down/
  Up-Down/Random order — Random draws from a small xorshift PRNG reseeded
  deterministically on every run-start, so a fixed clock and note set replay
  identically — releasing its own previous step's voice before starting the
  next. Poly mode retriggers every held note in place each step. Gate mode
  starts no new voices at all: it pulses every already-sounding voice's gain
  between full and a hardness floor derived from RANGE (repurposed per spec:
  "Gate mode repurposes the knob as gate envelope hardness"). Every step
  plays through the ordinary `startSynthVoice` path, so zones, sustain and
  the per-voice filter/LFO/vibrato stay consistent with hand-played notes.
  KB HOLD keeps the held-note set (and the arp's cycle through it) alive
  after physical key-up — Panic and ARP RUN off both clear it. ARP MODE
  cycles Arp→Poly→Gate; **Shift + ARP MODE cycles direction** (same shared-
  menu convention as Voice/Priority).
- **Three independent synth effect chains, not one shared bus**: each synth
  layer now gets its own full Mod 1→Mod 2→Delay→Amp/EQ→Comp→Reverb chain
  (`synthChains: Record<SynthLayerId, EffectChainState>`) built and updated
  exactly like a Piano layer's chain — including its own To-Rotary routing —
  where Organ's is the one shared chain. `fxSection` already typed
  `'piano'|'organ'|'synth'`; **FX FOCUS SYNTH** is now functional, cycling
  A→B→C→Group (mirroring FX FOCUS PIANO's A→B→Group) via the new
  `setSynthFxFocus`/`toggleFxGroupSynth`. Morph capture on a synth-chain
  destination now records `layer: 'SA'|'SB'|'SC'` (the `MorphAssignment`
  type's new variants) so an assignment made while FX focus is on Synth
  survives program storage and re-interpolates the right layer's chain.
- **Old-snapshot tolerance, extended again**: `normalizeSynthLayer` backfills
  `voice`, `normalizeSynthState` backfills `arp`, and `cloneSnapshot` now
  also backfills a missing `synthChains` record and the new top-level
  `fxGroupSynth`/`kbHold` flags — the same "every snapshot spread routes
  through one normalizer" discipline Part 2 established for filter/
  oscEnvelope/lfo.
- New functional ids: `voice-mode`, `glide`, `synth-unison`, `vibrato-mode`,
  `arp-run`, `arp-mode`, `arp-rate`, `arp-range`, `kb-hold`, `fx-focus-synth`.
  Every Synth panel control is functional now except Synth Mode's Extern/
  Samples positions (spec-excluded) and the menu-only Arp/Vibrato buttons
  (no dedicated per-field panel control). Three "Init Grand" filler slots
  became honest synth programs: 2.2 "Super Saw Pad" (unison+vibrato Super
  Saw, slow attack, Cathedral reverb), 2.3 "FM Keys" (FM 2-op through a
  clock-synced delay), 2.4 "Gate Pulse" (Square voice, arpeggiator Gate mode
  synced to the master clock, KB Hold on).
- 18 new tests (14 fake-level in `src/audio/synth-voice.test.ts` covering
  Mono retrigger, Legato's zero-new-nodes glide with real `setTargetAtTime`
  events, priority Low/High win/return-to-held, unison's exact duplicate
  oscillator count, vibrato Wheel depth following `morphValues.wheel` live,
  and the arp's determinism against injectable `ManualTimers` — a fixed
  clock and held set {C,E,G} at range 1 reproduces the exact Up sequence,
  Down reversed, Up-Down as a non-repeating palindrome, Random identical
  across two runs of the same seed, KB HOLD stepping after key-up, Gate mode
  modulating gain with zero new oscillators, and ARP RUN off returning the
  timer boundary's pending count to baseline; 3 rendered in
  `src/audio/render-synth3.test.ts` proving a Legato glide's zero-crossing
  rate rises across the glide rather than stepping, 240 vs 60 BPM onset
  spacing renders a measurably different onset count in the same window —
  driven through the identical `startSynthVoice` path the real scheduler
  uses, since the offline render harness's timer boundary is a deliberate
  no-op for voice-cleanup GC and cannot drive the internal `setTimeout`
  chain — and a synth layer's own delay chain audibly rings after `noteOff`.
  Plus a `system.integration` test in `src/state/programs.test.ts`: a
  program storing edited Piano/Organ/all-three-Synth-layers-with-their-own-
  chains/split/scene/morph/arp/KB-Hold state round-trips completely through
  Store and reload, and the restored state drives a real note through the
  engine without falling back. `src/model/hardware.test.ts` evolved for the
  newly-functional ids (including `fx-focus-synth` moving out of the
  decorative set) — no existing behavior check was deleted.

### 13 — Polish: section zoom, perc POLY, B3 Bass/Pipe 2, morph ranges (2026-07-02)

Four small, independent polish items instead of one big feature:

- **Section-inspect/zoom overlay** closes the oldest open issue from
  iteration 1 (`narrow-legend-legibility`): each section's plate-title
  (Organ, Piano, Synth, Layer Effects — the ones with a title bar) is now
  also a real button ("Inspect \<Section\> section", visible focus ring,
  present at every width) that opens a `role="dialog"` overlay portaled
  under `.stage-app`. The overlay renders the *exact same section
  component* again inside a fresh `container-type: inline-size` context
  sized much wider than its usual slice of the deck — every panel size in
  this app is expressed in `cqw` (1% of the nearest container-query
  ancestor's inline size), so the clone's legends/knobs/LEDs recompute
  larger in absolute pixels while staying fully real and operable (same
  `store`/`instrument`/`engine`). Escape or the close button dismisses;
  initial focus traps on the close button. The default control-deck DOM is
  untouched — the affordance is strictly additive/opt-in, verified by
  re-running the chassis regression assertions after opening and closing
  the overlay.
- **Organ percussion POLY mode** (spec optional, manual p. 20): Shift +
  Percussion Volume now toggles `organ.percussion.poly` (the panel already
  printed a dim "POLY ▿" legend next to the ON button referencing exactly
  this Shift pairing). With POLY on, `allowPercussion` in the engine's
  `noteOn` no longer gates on "no organ key already down" — every new key
  gets its own percussion partial, including legato additions under a held
  chord.
- **B3 Bass and Pipe 2** (both spec-optional, "may reuse the B3/Pipe 1
  engine") extend `ORGAN_MODELS` to a 6-model cycle. B3 Bass reuses B3's
  tonewheel partials and key click but wires only the 16'+8' drawbars —
  every other drawbar is silently absent, and percussion is unavailable,
  matching a stripped bass registration. Pipe 2 reuses Pipe 1's ranks and
  chiff with a brighter principal registration: triangle waveform on the
  bottom three ranks (vs. sine), boosted level and wider ensemble detune on
  the top five ranks — audibly distinct from Pipe 1 (rendered similarity
  < 0.9) even with identical drawbar registration. Both LEDs in the model
  grid, previously hardcoded unlit, now light correctly.
- **Morph range on LED graphs** — the simplification iteration 6 declared
  ("fader/drawbar LED graphs don't yet display the morphed range") is
  closed: `LedLadder` gained an optional `rangeLit` prop rendering LEDs
  between a captured start→end at a dim, half-opacity `data-range="true"`
  state. `LayerFaderColumn` and `DrawbarColumn` compute it through a new
  `presentation.morphRange(id, ledCount)`, which resolves the same
  layer/chain context `setValue`'s capture path used (organ focused layer
  for drawbars/organ levels) and maps the assignment's raw start/end onto
  LED indices; unassigned controls show no range LEDs. The store caches by
  assignment identity so `useSyncExternalStore` snapshots stay referentially
  stable (avoids a render loop the naive always-new-object version hit).
- 12 new tests: 4 in `src/components/section-zoom.test.tsx` (opens/closes
  via button + Escape, the overlay's live drawbar write reaches canonical
  state and updates the OLED outside the dialog, default DOM/chassis
  assertions still pass with the overlay opened-and-closed once), 1 poly
  test extending `src/audio/organ.test.ts`, 2 fake-level model tests (B3
  Bass voices only 2 oscillators with every drawbar pulled out; Pipe 2's
  oscillator types differ from Pipe 1's), 1 rendered-distinctness extension
  in `src/audio/render-organ.test.ts` (Pipe 2 vs Pipe 1 < 0.9 similarity,
  B3 Bass non-silent), and 2 morph-range panel tests in
  `src/state/morph.test.ts`. `ORGAN_MODELS`'s model-cycle label helper
  (`organModelLabel`) now handles "B3 Bass"/"Pipe 2" panel-display spacing.
- Gates: 353/353 tests, typecheck, lint, build all green.
- Deviation, disclosed: while reconciling this iteration's edits, an errant
  `git checkout <file>` on `tests/feature-matrix.json` and
  `IMPLEMENTATION_DETAILS.json` reverted those two tracked-but-uncommitted
  files to the iteration-2 commit, discarding iterations 3–12's doc edits
  (SHOWCASE.md and all source/tests were unaffected — the checkout was
  scoped to those two paths only). Both were reconstructed from this
  session's own prior tool output, this file's intact iteration log, and
  the current source/tests as ground truth, then re-validated
  (`python3 -m json.tool`) and cross-checked against the codebase; nothing
  in `src/`, `tests/*.test.*`, or this file was lost. Noted here rather than
  silently smoothed over.

### 14 — Keybed material accuracy pass (2026-07-02)

Visual-only pass in `src/styles.css`, checked side-by-side against
`reference/nord-stage-4-73.jpg`. No geometry, DOM, data attributes, or
component logic changed — `blackKeyHeightFraction` (0.61) and the key
model in `src/model/keys.ts` are untouched, and the keybed geometry/chassis
regression suites pass unmodified.

- **White keys** were too gray/warm; the reference reads as a bright,
  near-uniform near-white body with only a subtle darkening in the last
  ~8% (the rounded front edge) and a faint cool shadow in the top ~4%
  (where the key enters the slot under the panel). Replaced the 6-stop
  `.white-key` gradient with `#d8d8d5 → #f2f2ef 5% → #f6f6f3 55% → #f1f1ee
  90% → #d9d8d4 96% → #b9b8b4 100%`, and gave `[data-pressed='true']` a
  proportionally darkened version of the same scheme (same stops, same
  transform/shadow). Softened the gap `border-left` from a heavy near-black
  rule to `rgba(40, 36, 32, 0.4)` — the reference shows fine light shadow
  lines between white keys, not hard black rules.
- **Black keys**: the reference shows a matte-dark top slab with a
  pronounced glossy, beveled front nose in the last ~12% of the key — a
  distinctly lighter gray tip with rounded bottom corners and bright
  specular highlights at the two bottom shoulders. `.black-key`'s body
  gradient is now the flatter matte slab (`#262626 → #0a0a0a 30% → #050505
  82%`); the nose is a new `::after` (absolute, `left/right: 6%`, bottom
  13% of the key height, asymmetric `border-radius` for rounded bottom
  corners, its own lighter gradient `#1a1a1a → #3f3f3f 45% → #565656 75% →
  #2c2c2c 100%`, plus inset specular highlights at both edges). The
  full-length side highlights on the slab itself were strengthened from
  0.08/0.05 to a matched 0.10/0.10 alpha. Pressed state darkens the nose
  gradient (~25%) via `.black-key[data-pressed='true']::after` and keeps
  the existing press transform/shadow on the slab.
- **Under-key lip**: the reference shows a thin black strip (the keybed
  frame front) directly under the white key fronts, above the red chassis
  rail. Added as `.bottom-rail::before` — 18% of the rail's height, full
  width, `#0d0b0a` with a faint inset top highlight line — purely additive,
  no layout change (the rail's own height/flex/background are untouched).
- **Key slot shadow**: deepened `.keybed`'s inset top shadow (blur
  0.35cqw → 0.55cqw, alpha 0.55 → 0.62) so keys read as emerging from a
  darker slot, matching the photo.
- Untouched, as directed: focus-visible outline, split-marker styles, key
  sizing/positions, and `.keybed`'s own background color.
- Verification: grepped the built `src/styles.css` to confirm each of the
  four touched selectors (`.white-key`, `.white-key[data-pressed='true']`,
  `.black-key`, `.black-key::after`, `.black-key[data-pressed='true']`,
  `.black-key[data-pressed='true']::after`, `.bottom-rail`,
  `.bottom-rail::before`, `.keybed`) appears exactly once.
- Gates: 353/353 tests, typecheck, lint, build all green. No
  `tests/feature-matrix.json` or `IMPLEMENTATION_DETAILS.json` changes —
  this iteration is visual-only and touches no control behavior.

### 15 — Review-panel fixes (2026-07-02)

Six independent findings from a review pass, fixed in place rather than as
one feature:

- **B3 Bass drawbar bug**: the recipe wired drawbars 1+2 (16'+5⅓') via
  `B3_RATIOS.slice(0, 2)` instead of the spec's 16'+8' only. Fixed to two
  explicit partials, `{drawbar: 0, ratio: 0.5}` (16') and `{drawbar: 2,
  ratio: 1}` (8'), in `organ-models.ts`. The existing B3 Bass test in
  `organ.test.ts` now asserts the two correct partial frequencies directly
  (0.5x and 1x the fundamental) and that a partial at 1.5x (drawbar 1, 5⅓')
  never appears, even with every drawbar pulled out.
- **Synth morph destinations, completed**: `MORPH_DESTINATIONS` gained
  `synth-level-a/b/c`, `osc-ctrl`, `filter-freq`, `filter-res`, `lfo-rate`,
  `lfo-mod-amt`, and `arp-rate` (spec `levelIsMorphable`/`oscCtrlKnob`/
  filter/LFO morphable fields, plus the programs-spec Arp/Gate Rate).
  `applyMorphWrite` gained matching branches — synth-level writes read their
  layer out of the control id itself (not the captured `layer`), the voice/
  filter/LFO knobs write the captured synth layer's own state, and arp-rate
  writes the section-wide `synth.arp.rate`. `setValue`'s morph-capture layer
  resolution and the read-back `morphLayerFor` both route these controls to
  the focused synth layer (`'S'+focusedLayer`) or a fixed `'SA'` don't-care
  for the layer-agnostic destinations, so LED range indicators and capture
  agree. No engine changes — `setSynthFilterParam`/`setSynthLfoRate`/etc.
  already live-apply through the same state path Part 2 wired. 3 new tests
  in `morph.test.ts` (wheel→filter-freq on the focused layer, pedal→
  synth-level-b with a program-snapshot round-trip, wheel→arp-rate).
- **False claim fixed**: `feature-matrix.json`'s `synth.filter-envelopes`
  note claimed a rendered osc-envelope pitch-sweep proof that didn't exist.
  Added it to `render-synth2.test.ts`: a `toPitch` envelope at max upward
  amount with a fast decay shows a measurably higher early-window
  zero-crossing rate than its late window (pitch falls as the envelope
  decays), with a centered-amount (64 = 0) control render showing a much
  smaller early/late ratio. The note is now true as written.
- **Eight coverage gaps closed**: White Noise (buffer source, not an
  oscillator) and Sync Square (a periodic wave distinct from Sync Saw's) at
  both the fake and rendered level; the LFO's Saw Up/Square/S&H waveforms
  reconfigure the same standing per-layer LFO node in place (verified by
  capturing it once and watching its type/select-gate gains change across
  every cycle), plus one S&H-vs-Triangle filter-freq rendered assertion;
  Arp Poly mode (3 new voices per step vs. Arp mode's 1) and range (range 2
  Up with one held note alternates an octave apart, exact frequencies
  asserted); Vibrato On vs. Off (fixed depth and detune connection vs. none);
  descriptively-correct Unison 1→2→3 coverage — deviation noted below;
  a synth layer zoned to the upper half doesn't voice below the split, and
  `toggleLayerScene` swaps synth layer enables and remembers Scene II's
  configuration; an organ layer-A/B model mix (B3 sine vs. Vox sawtooth)
  sounding together from one `noteOn`; and `organ-chain.test.ts`/
  `render-organ-chain.test.ts` added to `organ.engine`'s feature-matrix
  `tests` array (both already existed and cover exactly that entry's shared
  chain, just weren't listed).
- **Stale docs corrected**: `App.tsx`'s status-note span and
  `model/hardware.ts`'s module doc now both describe the current
  functional/decorative split truthfully (nearly everything is functional;
  the decorative remainder is Synth Mode's Extern/Samples positions, the
  preset-library buttons, the Prog View/Section Edit/Layer Init/Mon·Copy
  menus, Morph A.T., and the Organ preset button — not the old "Synth
  doesn't exist yet" framing). `feature-matrix.json`'s `programs.navigation`
  note now says 12 factory programs including the Bass & Tines split demo
  and the three synth demos, instead of claiming synth/split programs don't
  exist. Iteration 12's old-snapshot normalizer claim is now backed by a
  test: `programs.test.ts` strips `synth`/`synthChains` from every one of
  the 32 bank + 8 Live slots' serialized snapshots, reloads a store over
  that payload, and asserts it backfills defaults and plays a note without
  throwing or falling back.
- Deviation, disclosed: item 4e's premise ("oscillator count strictly
  increases from unison 1→2→3") doesn't hold for this engine — the unison
  stack is always exactly 2 detuned duplicates (`for side in [-1, 1]`)
  regardless of level; only the detune/gain/pan spread scales with level
  1..3 (see the "simplified single-oscillator stack per duplicate" comment
  in `engine.ts`). Writing a test that asserted a strictly increasing count
  would have been false. Instead, `synth-voice.test.ts` locks in the real,
  honest behavior: constant oscillator count (3, main + 2 duplicates) with
  strictly widening detune spread across levels 1→2→3.
- 18 new tests: 1 in `organ.test.ts` (rewritten B3 Bass test), 3 in
  `morph.test.ts`, 1 in `render-synth2.test.ts` (osc-envelope pitch sweep),
  2 fake + 2 rendered in `synth.test.ts`/`render-synth.test.ts` (White
  Noise, Sync Square), 1 fake + 1 rendered in `synth-filter.test.ts`/
  `render-synth2.test.ts` (LFO waveforms), 4 in `synth-voice.test.ts` (Poly,
  range, vibrato On, unison spread), 2 in `scenes-splits.test.ts` (synth
  zone, synth scene swap), 1 in `organ.test.ts` (different models per
  layer), 1 in `programs.test.ts` (old-snapshot synth tolerance); plus the
  traceability-only `feature-matrix.json` array edit (no new test file).
- Gates: 371/371 tests, typecheck, lint, build all green.

### 16 — Orchestrator UI pass: synth density and keybed nose (2026-07-02)

Fable-side review fixes after the workflow's feature landings:

- The Synth section's newly-bound legends (voice priority, arp direction,
  MST CLK tags, envelope readouts) had outgrown the dense boxes: 28
  overflowing elements and three group-box collisions at 1440x900. Reweighted
  the arp row's flex distribution, tightened gaps/paddings/knob sizes across
  synth-top/arp/voice/vibrato/synth-bottom, restored the intended
  0.9/0.95/1.35 LFO/OSC/FILTER width split (a stray `flex: 1` had been
  overriding it), and shortened the priority legend. Zero text overflows or
  collisions remain (only the panel-authentic printed-title straddles).
- The Delay and Reverb effect boxes' wrapped content had outgrown their
  fixed grid tracks (the Reverb ON/GLOBAL cell wrapped 14px past the clipped
  plate). Slimmed both; every effects box now fits its track exactly.
- The black-key front nose from iteration 14 read as a detached blob (too
  tall, too bright, hard seam). Reworked: 10% height, gradient that blends up
  from the slab tone, softer specular shoulders — matching the reference
  photo's subtle glossy tip.
- Verified live: five synth source categories audibly distinct at the master
  analyser, arp stepping under a 240 BPM master clock, organ FX focus
  following the layer buttons with an audible shared-chain reverb tail, and
  the section-zoom dialog opening/operating/closing per spec.

### 17 — Keybed regression fix: black-key positioning (2026-07-02)

- Iteration 14's `.black-key` rule had added `position: relative` (assumed
  necessary for the `::after` nose), overriding the `position: absolute`
  every key inherits from `.key` — all 30 black keys fell out of the key
  model's absolute layout into document flow, visually scattering them.
  jsdom tests assert the model (73 keys E1-E7, 43/30 split) but never
  computed layout, so nothing failed. Removed the override with a comment
  explaining the constraint; the `::after` anchors to the absolute `.key`
  box, which was already a positioned ancestor.
- Verified with a computed-layout audit in the live browser: 43 whites +
  30 blacks, zero misplaced (all inside the keybed at 0.61 height), first
  key E1, last key E7, first black F#1, last black D#7 — plus a full-page
  screenshot showing the correct 2-3 grouping.

### 18 — Computed-layout regression harness (2026-07-02)

The black-key incident showed the jsdom gates are structurally blind to
computed CSS layout. New `pnpm verify:layout` (scripts/verify-layout.mjs,
playwright-core against the built artifact, self-served via vite preview):

- Keybed geometry from real layout, not the model: 43+30 keys, E1..E7 ends,
  every black key straddling its two white neighbours inside the keybed,
  black-height fraction within 0.57..0.65 of the spec's 0.61.
- Per-section text-overflow audit at 1440x900 (printed title straddles,
  round-control overhangs and deliberate OLED ellipsis clipping excluded),
  group-box collision audit, effects boxes fitting their grid tracks, and
  no horizontal page scroll.
- Narrow 390x844 retention: all 73 keys inside the chassis, six sections
  rendered, no horizontal scroll. Zero console errors on load.
- First runs immediately caught two leftovers (the filter FREQ knob
  overflowing its legend-width flex cell — now sized with its siblings —
  and flagged the OLED's deliberate ellipsis before the audit learned to
  exempt intentional clipping). 12/12 checks green; runs in ~6s.
- Deliberately a separate script rather than a fifth package gate: it needs
  a real browser, and the benchmark contract requires the four package
  gates to run deterministically without devices.

### 19 — Optional synth scope (2026-07-02)

The synth spec's `scope.optional` items land — every one either works
canonically or stays truthfully decorative, per the honesty contract:

- **Sound Init**: the `sound-init` button (decorative until now) resets the
  FOCUSED layer's sound parameters — waveform (Saw), Osc Ctrl (64), all
  three envelopes, filter, LFO, voice, and mode (Analog) — to
  `defaultSynthLayer`'s init pose while PRESERVING enabled/level/octave/
  zone. `synthSoundInit()`, lastEdit `Sound Init — Synth <layer>`.
- **LP M and LP+HP filter types**: the cycle grows to LP12→LP24→HP→BP→
  LP M→LP+HP. LP M is a DECLARED ladder-style approximation: two cascaded
  lowpass biquads like LP24, but the second stage's resonance maps ~1.5x
  hotter and a fixed gentle tanh pre-shaper saturates ahead of the
  stages — rendered proof shows it differs measurably from LP24 at
  identical settings. LP+HP is a lowpass at the cutoff in series with a
  highpass fixed 2 octaves below — a wider, shallower band emphasis than
  BP's single resonant stage (rendered proof again).
- **Six new oscillator categories** appended to SYNTH_WAVEFORMS (existing
  indices untouched — factory programs reference them by position):
  Sub Osc ('Saw Sub'/'Square Sub': a real square sub one octave down whose
  gain IS Osc Ctrl, live), Shape ('Shape Pulse': duty 0.05..0.5 follows
  Osc Ctrl, PeriodicWave rebuilt on quantized steps like Sync) and the
  SEPARATE ShapeSine category ('Shape Sine': a sine through a wavefolding
  waveshaper, Osc Ctrl = live pre-shaper drive gain, fold curve per
  quantized step — kept as its own category, not merged with Shape, per
  spec.scope.optional's explicit "Shape, Shape Sine" listing), Wave ('Wave
  Organ'/'Wave Formant': two fixed digital PeriodicWaves, Osc Ctrl
  spec-consistently inert like Pure), and FM-I ('FM 2-op B': the same true
  2-op FM as FM-H at an inharmonic 1.414 ratio).
- **Samples mode (per-layer)**: `mode: 'Analog' | 'Samples'` on
  SynthLayerState (snapshot-covered; old snapshots — whether missing the
  whole `synth` key or just each layer's `mode` field — backfill 'Analog'
  through the existing normalizer). Two small bundled RECORDED sets — GM
  String Ensemble 1 and GM Choir Aahs from the MIDI-JS Soundfonts
  collection (MIT) via npm web-music-score-samples, synced to
  public/samples/synth-strings and synth-choir with full provenance in
  SOURCES.md/IMPLEMENTATION_DETAILS.json. The `synth-mode` button becomes
  functional (Analog↔Samples for the focused layer; EXTERN stays
  spec-excluded and unreachable), the Mode LEDs bind truthfully, and in
  Samples mode the OLED WAVE list selects between the two sets (waveform
  index reused, clamped) with OSC CTRL showing '—'. Engine-side, Samples
  voices are AudioBufferSources (nearest root + playbackRate shift through
  the same cache/status machinery as the piano library, including each
  set's own declared gain) and everything downstream still applies: the
  shared filter, amp envelope, and unison (detuned duplicate buffer
  sources, mirroring the piano unison pattern), plus zones/scenes/arp/
  voice-mode/glide/sustain, all through the same shared Voice machinery.
  DECLARED LIMITATION: the oscillator envelope's toPitch mode and the
  vibrato/LFO "Osc Pitch" destination retarget a sample voice's
  `playbackRate` (not detune — there is no pitch-cents AudioParam on a
  buffer source) through a small per-source cents-to-rate-ratio translator
  gain fed by the SAME cents-shaped depth gains the Analog path uses,
  rather than dropping the destination; Osc Ctrl and the non-toPitch
  oscillator-envelope/LFO "Osc Ctrl" destination have no effect in Samples
  mode, since there is no per-category Osc Ctrl target for a recorded
  voice.
- **Delayed and Pedal vibrato**: the cycle grows to Off→On→Wheel→Delayed→
  Pedal (Aftertouch stays excluded). Delayed is On with a per-voice depth
  ramp gain that `setTargetAtTime`-ramps 0→full over ~700 ms after that
  voice's own note-on (every other mode's ramp gain is a fixed 1 pass-
  through, so already-sounding voices are unaffected by a mode change);
  Pedal follows `morphValues.pedal` live, exactly as Wheel follows the mod
  wheel.
- Also fixed while finishing this scope: Samples-mode voices now apply
  each sample set's own declared gain (previously connected straight to
  the voice gain, unscaled); the decorative-controls probe test that used
  to click Synth Mode Select (now functional) moved to Preset Library
  Synth, with a new dedicated test asserting Synth Mode Select's canonical
  effect on the OLED's WAVE name readout.
- Tests: 391 passing (up from 371 before this scope; ~20 new/evolved
  across synth.test.ts, synth-filter.test.ts, synth-voice.test.ts,
  render-synth.test.ts, programs.test.ts, library.test.ts,
  hardware.test.ts and decorative-controls.test.tsx). All five gates green:
  `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`,
  `pnpm verify:layout` (12/12 checks).

### 20 — Reference-fidelity pass: headers, branding, performance zone (2026-07-02)

Orchestrator-side visual pass against reference/nord-stage-4-73.jpg crops:

- **Section headers**: every section (and the Rotary Speaker tab) now wears
  the reference's full-width light gray-lavender band with dark navy title,
  SECTION subtitle, FX FOCUS, ON and SOLO — previously dark-with-white-text.
  Panel slate lifted slightly toward the reference tint.
- **Branding**: "nord stage 4" renders on ONE line in a rounded logotype
  approximation (locally-available rounded faces; no webfont — the artifact
  stays self-contained), bottom-left of the red zone, with HAMMER ACTION 73
  letter-spaced to span exactly the logo width beneath it.
- **Performance zone geography** now matches the photo: wooden pitch stick
  high at top-left, bright ribbed mod wheel in its slot below-right,
  MASTER LEVEL (label above knob) at the top of the right column tight
  against the Organ section, Rotary Speaker strip directly beneath it.
- Fixed the status-strip note that still called Synth Samples mode
  visual-only (iteration 19 made it functional; only Extern is excluded).
- Gates: 391/391, typecheck, lint, build, verify:layout 12/12.

### 21 — Second piano models, SOLO, vibrato menu, bundled logotype face (2026-07-03)

- **Second piano models + model LIST view** (spec nord-stage-4.piano.json
  scope.optional "More than one model per type and the model list view"):
  Clav and Misc each gain a second bundled recorded model — Harpsichord
  (GM Harpsichord, `006-harpsichord`) and Marimba (GM Marimba,
  `012-marimba`), same MIDI-JS Soundfonts/MIT provenance chain as every
  other GM-derived set, added to `scripts/sync-samples.mjs` and
  `src/audio/library.ts`'s `INSTRUMENTS` (8 sets total; `instrumentsOfType`
  now returns 2 for Clav and Misc). While Shift is latched, turning the
  Piano Model dial now shows a model list for the focused layer's type on
  the Program OLED (`▸ Clav / Harpsichord`, etc.) — a non-snapshot
  `modelListView` flag on `InstrumentState`, wired exactly like the
  existing Shift + Program dial numeric list view (same precedence slot,
  same clear-on-Shift-release path).
- **SOLO** (manual p. 18: "Press the On button for roughly half a second to
  perform a SOLO operation, which activates only [that section]"): a new
  `soloSection('piano' | 'organ' | 'synth')` store action turns the target
  section on and the other two off (ordinary snapshot state, so it
  round-trips through Store/recall). Two input paths: holding a section's
  ON button for >= 500 ms (`PanelButton` gained an optional `holdAction`
  prop, wired through `SectionHeader`'s new `onSoloHold`, with a quick
  click still performing the normal toggle), and Shift + click on the same
  button (mirrors the existing SUSTPED shift pattern) for keyboards that
  can't long-press.
- **Synth vibrato menu values** (spec voice.vibrato.menu: Rate 2.0-8.0 Hz,
  Amount 0-10): the per-layer vibrato LFO gained a panel-editable
  `vibratoRate` (0..127 -> 2.0..8.0 Hz linear, alongside the existing
  `vibratoAmount`, displayed 0..10) — old snapshots backfill the new field
  through the same `voice: {...defaults.voice, ...layer?.voice}` path
  already used for post-hoc synth fields. The previously decorative
  `vibrato-menu` MENU button is now FUNCTIONAL (moved into
  `FUNCTIONAL_CONTROL_IDS`): it latches the Synth OLED's dials 1/2 onto
  Rate/Amount editing, copying the `synthEnvEdit` dial-repurposing pattern
  exactly (mutually exclusive with it — engaging one clears the other).
  Engine-side, the vibrato oscillator's frequency now follows the mapped
  Rate directly, and depth scales with the mapped Amount across every mode
  including Wheel/Pedal/Delayed (previously Wheel/Pedal ignored Amount
  entirely).
- **Bundled logotype face**: `@fontsource/comfortaa` (SIL OFL 1.1, The
  Comfortaa Project Authors) is now imported in `src/main.tsx`
  (`@fontsource/comfortaa/700.css`), so the brand-line's rounded wordmark
  renders identically fully offline with no system-font or network-font
  dependency — vite inlines the woff2 into `dist/assets/`. `.brand-line`
  puts Comfortaa first, keeping the prior rounded-font stack as fallback;
  font-size nudged down slightly (1.08cqw -> 0.98cqw) so the new face's
  wider glyphs still fit the branding container without reflow
  (`no-text-overflows-desktop` and a direct `scrollWidth <= clientWidth`
  check on `.brand-line` both pass).
- Tests: 403 passing (up from 391 before this scope; 12 net new/evolved
  across library.test.ts, render-library.test.ts, piano-controls.test.ts,
  scenes-splits.test.ts, synth-voice.test.ts, synth-filter.test.ts,
  hardware.test.ts). One pinned assertion evolved truthfully rather than
  weakened: synth-voice.test.ts's "vibrato Off..." test used to match the
  vibrato oscillator by an exact fixed 5.5 Hz; it now matches by the
  mapped default rate (`mappings.vibratoRateHz` of the default
  `vibratoRate`, which still resolves to ~5.5 Hz) since the rate is no
  longer hardcoded. hardware.test.ts's functional/decorative inventory
  gained `vibrato-menu` in the Synth functional set.
- Gates: typecheck, test (403/403), lint, build, verify:layout (12/12) —
  all green.

### 22 — Measured section widths, FX FOCUS strip, Program rail (2026-07-03)

Layout surgery driven by pixel-measurement of the reference photo (red-vs-
slate column segmentation across the deck's full height), correcting three
user-reported issues: the Piano section rendered nearly double its true
width, the Program strip was starved (MORPH ASSIGN clipping), and the FX
FOCUS column didn't match the reference.

- **Section fractions remeasured**: `SECTIONS` in `src/model/variant.ts` is
  now 14/20/8.5/12.5/25/20% (was 13/21/15/9/21/21). The Piano plate is
  genuinely the narrowest on the panel (~8.5%) and the Synth plate the
  widest (~25%). The deck also keeps the photo's bare-red right margin
  (~4.6% of the instrument width) as `.control-deck` padding, with a
  matching narrow left margin. The `hardware.test.ts` fraction pin and the
  feature-matrix chassis note evolved with the measurement rationale.
- **FX FOCUS strip redesigned to the reference**: it is a standalone strip
  on exposed red chassis BETWEEN the Synth and Layer Effects plates (not a
  column inside the effects plate), with its own light header tab. The
  ORGAN entry now has ONE yellow focus LED captioned "A B" — both organ
  layers share the single organ FX chain, so separate A/B LEDs were wrong.
  PIANO keeps two LEDs and SYNTH three (focus/group semantics unchanged,
  colors corrected green -> yellow per the photo). `organ-chain.test.ts`
  and `effects-routing.test.ts` LED probes evolved to the new structure.
- **Second Shift/Exit button**: the reference shows TWO physical
  Shift/Exit buttons — one on the Program section's right rail, one at the
  FX FOCUS strip's foot on a light tab. Added `shift-2` (functional,
  effects section) mirroring the same latched modifier: pressing either
  lights both; browser-verified that `shift-2` latches and `shift`
  unlatches the shared state.
- **Program section restructured to the reference's three-column design**:
  Morph Assign joins Split/Mst Clk/Transp on the top row; a left rail
  (Store cluster, Program dial, Page/Cat, Live Mode, Layer Scene II); a
  center column (Preset Library, the OLED, the Program 8-button grid); and
  a right utility rail (Prog View, Solo/Undo, Section Edit, Layer Init,
  Mon|Copy — legends printed on the panel beside plain button caps, as on
  the hardware — with Shift/Exit pinned at the keybed edge). With the
  corrected 12.5% width, MORPH ASSIGN no longer clips.
- **Piano plate density pass** for the corrected 8.5% width: one size
  class smaller throughout (like the Program strip), `minmax(0,1fr)`
  columns so single-word legends can't blow out the grid, and the narrow
  header drops the FX FOCUS / ON text labels (LEDs remain) exactly as the
  photo does at this width. Reverb/Comp boxes tightened so the narrower
  effects plate keeps every box inside its grid track.
- Verification: computed-layout audit 12/12 (overflow scan clean at both
  desktop and 390px), typecheck, lint, build green; tests 403/403 with the
  two FX-focus LED probes and the fraction pin evolved truthfully.
