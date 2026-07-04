# Showcase functionality audit — 2026-07-04

A full functionality audit of the showcase Nord Stage 4 against the extracted
user manual (`reference/manual.txt` via `pnpm bench fetch` + `pdftotext`), the
machine-readable specs in `specs/`, the SHOWCASE.md iteration log, and the
running artifact. Method: four parallel audit lenses (state layer, audio
engine, UI/input, manual feature coverage), each finding then re-verified by
hand against the actual code path — several candidate findings were **rejected**
during re-verification and are listed at the end so they don't get re-reported.
Gates were run on a fresh Linux checkout; live checks ran against the built
artifact in headless Chromium (key press → voice, zero console errors).

Line numbers refer to the tree at commit time of this audit.

---

## A. Gate status on a fresh (Linux) environment

The published gate story ("all green") does not reproduce on a clean Linux
machine. Two tooling issues, both worth fixing before the next iteration round:

### A1. `pnpm test` is red: the delay-feedback-filter render test fails deterministically — HIGH

`src/audio/render-effects.test.ts` › "the Delay feedback filter reshapes
successive repeats, not the first tap" fails **3/3 runs at file level** on this
environment (Node 22, Linux, node-web-audio-api), while passing when run alone
with `-t`. Full suite: 498/499. The failure is a razor-thin margin miss:

```
AssertionError: expected 0.7086010787214689 to be greater than 0.7097054147414249
```

i.e. `lateBalance(filtered) / lateBalance(open)` ≈ 1.398 against the required
1.4×. SHOWCASE.md (iterations 40/42/43) characterizes this as a parallel-run
flake that "passes in isolation every time" — on this machine it fails even
with the file run serially by itself, so the characterization doesn't hold
cross-platform. The interference is within-file (earlier renders in the same
file shift the numbers), pointing at residual load-order sensitivity in the
offline render harness (`src/test/offline.ts`) that the iteration-9 dispose
fix narrowed but didn't eliminate.

**Proposed fix:** make the assertion structurally robust rather than
margin-tuned — e.g. compare the high-band ratio of the *last* repeat window
only (where the loop filter has been applied 3+ times, the divergence is much
larger), or drive the test with a deterministic buffer source instead of a
piano sample whose decoded state depends on prior tests. Alternatively find
and fix the residual cross-render leakage in the harness; the test is the
symptom either way.

### A2. `pnpm verify:layout` only runs on macOS — MEDIUM

`scripts/verify-layout.mjs` hardcodes the Chromium discovery to
`~/Library/Caches/ms-playwright` + `chrome-mac-arm64/Google Chrome for
Testing.app/...` (`findChromium`, lines 40–51). On Linux it throws even with
Playwright's Chromium installed (`~/.cache/ms-playwright/chromium-*/
chrome-linux64/chrome`). Compounding it, when the script fails after spawning
`vite preview` it never kills the child (no try/finally around the launch),
so the *next* run dies with the misleading "vite preview exited early"
(port 4873 still held).

**Proposed fix:** probe both cache roots (`~/.cache/ms-playwright`,
`~/Library/Caches/ms-playwright`) and both bundle layouts
(`chrome-linux64/chrome`, `chrome-linux/chrome`, the mac path), and wrap the
whole run in try/finally that kills the preview server. ~10 lines, makes the
12-check layout gate usable in CI and cloud agents.

---

## B. Audio-engine bugs (all code-verified)

### B1. Every store commit can cancel in-flight envelopes on sounding voices — HIGH

`rampTo` (engine.ts 3280–3287) starts with `param.cancelScheduledValues(now)`.
`applyState` → `updateSynthVoiceLive` (1375–1458) calls it on every sounding
voice's filter `frequency`/`Q` on **every** state commit — so any unrelated
edit (master level nudge, morph wheel motion, program browse, FX-focus press)
kills a scheduled filter-envelope sweep mid-flight and snaps the cutoff to the
static base. Same mechanism truncates osc-envelope `toPitch` ramps via
`applyBendToVoices`/live Osc Ctrl retargeting (1394–1397, 2409–2416,
2989–2994), and it breaks the documented decay=127 hold-at-peak behavior for
the filter envelope. This is the iteration-42 deferred item ("store-change
cancelling in-flight filter/pitch envelopes") — confirmed still present.

**Proposed fix:** per-voice cache of last-applied filter/pitch params; diff
before touching AudioParams, and only cancel+reschedule when the parameters
that shape that voice's envelope actually changed.

### B2. Legato glide breaks non-1:1 source ratios (Sub Osc, FM-I, FM index) — HIGH

`glideSynthVoice` (engine.ts 1616–1636) sets **every** synth source's
`frequency` to the same target:

```1627:1632:showcase/src/audio/engine.ts
    for (const source of voice.sources) {
      if (source.kind !== 'synth') continue
      // FM-H's modulator tracks the carrier 1:1 (algorithm A); every source
      // here (including unison duplicates) glides at the same rate.
      source.node.frequency.setTargetAtTime(targetFrequency, now, timeConstant)
    }
```

- Sub Osc's sub is built at `frequency / 2` (2281) — a legato glide slams it
  up an octave onto the fundamental.
- FM-I's modulator is built at `frequency * 1.414` (synth-oscillators.ts 135)
  — the inharmonic ratio collapses to 1:1 on the first glide.
- `synthLive.carrierFrequency` is never updated, so the FM modulation index
  (`fmModulationIndex(oscCtrl, live.carrierFrequency)`, 1407–1408) stays
  scaled for the old pitch after any glide.

**Proposed fix:** store each source's frequency *ratio* at build time and
glide to `targetFrequency * ratio`; update `synthLive.carrierFrequency` (and
retarget the mod-index gain) in both `glideSynthVoice` and the bend path.

### B3. Turning ARP RUN off strands sounding arp voices — HIGH

`stopArp` (engine.ts 1659–1668) clears the timer and `arpSoundingMidi` but
releases nothing. The arp starts voices through `startSynthVoice` for
octave-*expanded* notes (e.g. held C4 range 2 → sounding C5) that correspond
to no physical key, so no later `noteOff` can ever reach them. With a
sustain-mode amp envelope (decay 127 = hold at peak), toggling ARP RUN off at
the wrong moment leaves a note ringing until Panic. Honesty-contract issue:
a control release that audibly misbehaves.

**Proposed fix:** in `stopArp`, release each layer's `arpSoundingMidi` voice
(and, for Poly mode, any voice whose midi is not in the physically-held set).

### B4. MST CLK sync ignores the Rate/Tempo knobs — no subdivisions — HIGH

The manual is explicit that in MST CLK mode the rate knobs select
*subdivisions* of the clock ("the Rate is presented as subdivisions of the
Master Clock tempo… ½ equals half notes… Set the subdivision to 1/8", manual
p. 17/35/49/51). The engine instead pins everything to a fixed quarter note
and the knobs go dead:

```1680:1684:showcase/src/audio/engine.ts
  private arpStepMs(): number {
    const arp = this.state.synth.arp
    const bpm = arp.mstClk ? this.state.masterClock.bpm : mappings.arpRateBpm(arp.rate)
    return 60000 / Math.max(1, bpm)
  }
```

Same for delay (`syncedDelayTempo = 60000 / bpm`, 1181) and Mod 1 / synth LFO
(one cycle per beat, 1182/1479). A knob that moves but changes nothing while
synced is exactly the class of quiet fake the honesty contract targets.

**Proposed fix:** a subdivision table (1/2, 1/4, 1/8, triplets, 1/16 …) mapped
from each unit's 0–127 knob, applied relative to the master quarter note; OLED
edit line shows the subdivision while synced.

### B5. Gate mode destroys the amp envelope of the voices it gates — MEDIUM

`arpGateStep` (1780–1797) pulses `voice.gain.gain` — the same node carrying
the amp envelope — via `cancelScheduledValues`. A voice in its decay phase has
that trajectory erased on the first gate step and gets re-pinned at the
sampled instantaneous level. The manual's Gate expects the sustained sound
gated on top of its envelope.

**Proposed fix:** a dedicated per-voice `gateGain` node after the envelope
gain (created lazily on first gate step), leaving `voice.gain` untouched.

### B6. Mono retrigger restarts from silence, not from the current level — MEDIUM

Manual p. 34: "In Mono mode both envelopes restart from the point in the
attack phase where the level is equal to the previous note, if the decay or
release phase has been entered." `triggerSynthMonoVoice` (1606–1609) instead
releases the old voice and builds a fresh one from 0.0001 — an audible level
dip on every fast mono line. **Proposed fix:** on mono retrigger, read the
current gain value and start the new attack ramp from it (or reuse the voice
like Legato does but with an envelope restart from the measured level).

### B7. B3 percussion "single trigger" ignores sustained voices — LOW

Manual p. 20: percussion sounds only when no other organ note *is sounding*.
The gate (engine.ts 1530–1537) checks `voice.keyDown` only, so with the
sustain pedal down, re-struck keys after a full release still get percussion
while the previous chord audibly rings. **Fix:** treat any live organ voice
(sounding, not just key-down) as suppressing.

### B8. Layer level sits before the effect chain, spec wants it after — MEDIUM (deferred item, confirmed)

`specs/nord-stage-4.effects.json` `signalContract.requiredOrder`:
`… Reverb → Rotary when routed → Layer level → Master`. The engine connects
`levelGain` *into* `units.mod1.input` (engine.ts 729–750 piano, 786 organ,
844–850 synth), so pulling a fader down also starves the delay/reverb/comp of
input — the tail dies with the fader instead of the trimmed post-chain level.
This is the remaining iteration-42 deferred item. **Fix:** move `levelGain`
after the chain's output split (post-reverb, before the master/rotary sends).

### B9. Global Reverb is not relocated after the Rotary — LOW

Manual p. 52–53: reverb precedes the rotary *"unless the Reverb is set to
Global mode, in which case the Reverb is placed after the Rotary Speaker."*
Global mode currently only mirrors settings across chains; the graph keeps
reverb pre-rotary always. Worth either implementing (shared post-rotary reverb
return) or declaring in the coverage note.

### B10. Arp RANGE is integer-only — LOW

Manual p. 35 allows values *between* octaves ("2 octaves and a fifth");
`arpSequenceFor` (1689–1695) loops whole octaves 1–4 and the state quantizes
to integers. Low priority, but the knob's printed 1–4 arc invites fractional
positions that currently snap silently.

---

## C. State-layer bugs (all code-verified)

### C1. Morph capture layer-mismatch for id-encoded level faders — HIGH (deferred item, confirmed)

The iteration-42 deferred item is still live. Capture
(`presentation.ts` 422–436) records `layer` from the *focused* piano/organ
layer for `piano-level-a/b` / `organ-level-a/b`, but `applyMorphWrite`
(instrument.ts 3520–3533) resolves the layer from the control-id suffix — and
`morphLayerFor` (1871–1887), which drives the LED range indicators and the
green dots, resolves via focus again. Concretely: focus organ A, arm Wheel,
move the **organ B** fader → the assignment stores `layer: 'A'`, interpolation
correctly moves B, but `morphAssignmentFor('organ-level-b')` misses it (no LED
range), and a later capture with B focused duplicates the assignment.
`synth-level-*` already solved this with a fixed don't-care layer; piano/organ
levels need the same id-based resolver used consistently in capture, read-back
and clear.

### C2. Program load / undo / store does not re-apply morph interpolation — MEDIUM

`selectProgram` (1924–1947), `confirmStore`/`cancelStore`, and
`undoProgramChange` spread a fresh snapshot but never call the morph
re-application that arming-exit already does (1794–1796). With the mod wheel
parked high, loading a program with wheel assignments leaves canonical state
(and the engine) at the *unmorphed* snapshot values until the wheel next
moves — the panel and the sound disagree with the wheel position.
**Fix:** re-apply wheel+pedal morphs (no dirty flag) after every snapshot
load.

### C3. `cloneSnapshot` does not backfill all snapshot keys — MEDIUM

`cloneSnapshot` (3371–3403) backfills `presetOn`, synth nested fields,
`synthChains`, `fxGroupSynth`, `kbHold` — but a persisted payload missing any
*other* top-level snapshot key (`morph`, `masterClock`, `split`, `scenes`,
`organ`…) simply doesn't overwrite it in `{ ...this.state, ...cloneSnapshot }`
(1924–1947), silently leaking the *previous program's* value into the loaded
program. The normalizer discipline iterations 11/12 established should be
completed: merge every `PROGRAM_SNAPSHOT_KEYS` entry against
`snapshotOf(baseInstrumentState())` so the clone is always complete.

### C4. Edits made while a Store is pending are silently dropped — LOW

`storePress` freezes `captured` once (2069); `confirmStore` writes
`pending.captured.snapshot` (2120). Tweaking a knob between the two STORE
presses is audible but never stored, with no indication. Either refresh the
capture on program-captured edits while pending, or visibly ignore edits in
store mode. Related: in Live Mode a pending Store also suppresses the auto-
store (`withEditApplied`, 1015–1029), compounding the surprise.

### C5. Panel latch modes survive program changes — LOW

`selectProgram` clears none of `morphArming`, `numPad`, `listView`,
`layerInitEdit` — and `setSectionEdit(true)` / `setLayerInitEdit(true)` don't
clear each other (both LEDs can be lit; the OLED shows only one). Program
changes should drop transient latches the way `setMonCopyMode` already does,
and section-edit/layer-init should be mutually exclusive like the
split/clock/transpose edit trio already is.

---

## D. UI & input bugs (code-verified; D2/D3 also browser-verified)

### D1. External MIDI is missing pitch bend and mod wheel (CC1) — HIGH

`midi.ts` `handleMessage` (128–148) parses note on/off and CC 64/66/67/11
only. A hardware controller's pitch wheel (0xE0) and mod wheel (CC1) do
nothing, while the on-screen stick and wheel work — the exact inputs a
keyboard player reaches for first. The wiring targets already exist
(`setPitchBend`, `setMorphSource('wheel', …)`). Also worth adding while in
there: channel aftertouch (0xD0) — see E10.

### D2. Layer-button semantics contradict the manual — HIGH

Manual (p. 12, 18): pressing an **active** layer's button gives it *focus*;
layers are turned **off by holding** the button ("Layers are turned OFF by
holding down a Layer button for a short moment"); pressing the non-active
button *toggles to* it; enabling a second layer is a simultaneous two-button
press. The showcase toggles enable on every click (`toggleLayerEnabled` /
`toggleOrganLayerEnabled` / `toggleSynthLayerEnabled`) — verified live:
clicking focused-and-enabled Piano A turns the layer off. Selecting an
enabled layer for editing without muting it is impossible via the layer
buttons. The `PanelButton` `holdAction` mechanism (built for section SOLO)
already supports the canonical gesture set: click = focus/enable,
hold = off.

### D3. Voice-priority LO/HI LEDs are hardcoded unlit — MEDIUM

Shift+Voice Mode cycles priority Off→Low→High and it audibly works, but the
two red LEDs under the printed LO ▿ / HI ▿ legends never light
(`sections.tsx` 1541–1546, no `on` prop) — verified live after setting
priority Low. Panel state lies about an implemented feature. One-line fix per
LED (`on={focused.voice.priority === 'Low'}` / `'High'`).

### D4. COMP FAST is unreachable state with a rendered LED — MEDIUM

`CompState.fast` exists, the engine honors it (effects.ts release-time
branch), and the FAST LED renders — but no action anywhere toggles it
(`grep fast` across instrument.ts/presentation.ts: only percussion and rotary
match). Manual p. 52: FAST mode = Shift + Amount knob. Options: wire
Shift+click/drag on `comp-amount` (matching the existing Shift-pairing
conventions), or a small FAST ▿ legend-button; the LED must stop implying an
operable control until then.

### D5. Printed shift legends that silently do nothing — MEDIUM

Three prints look identical to wired ▿ pairings but have no handler, unlike
the declared-decorative ones (CLOSE MIC ▿, PAN ▾) which SHOWCASE/comments
document:

- **PING PONG ▿** (Shift + Delay Filter) — manual p. 51; no `pingPong` in
  `DelayState`, no shift branch on `delay-filter` (presentation.ts 1199).
- **EXCLUDE ▿** (Shift + KB Hold) — manual p. 36 (per-layer KB Hold
  exclusion); no shift branch on `kb-hold` (presentation.ts 915).
- **PED ▿ on Mod 1/2 selectors** (pedal-controlled Wah/etc.) — manual p. 49;
  `mod1-variation` has no shift branch.

Each should either be implemented (ping-pong is a genuinely useful delay
feature and cheap: alternate L/R feedback taps) or visually demoted to the
documented-decorative dim style so print and behavior agree.

### D6. Footer "Coverage" note misstates Section Edit — LOW

App.tsx 555–561 still lists "Section Edit's plain press" as visual-only; it
has been a functional sticky latch since iteration 31 (LED, fan-out edits,
tests). The same sentence is the app's user-facing honesty statement, so it
should be exact. `hardware.test.ts` carries a matching stale comment.

### D7. Section-zoom dialog doesn't inert the background — LOW

`section-zoom.tsx` traps Tab and sets `aria-modal`, but the deck behind the
scrim remains pointer/AT-reachable in some browsers. Set `inert` on the
instrument root while open. Also: the legend-buttons that latch Layer Init
and Paste lack `aria-pressed` state.

---

## E. Missing features worth building (ranked by player value)

The showcase's panel coverage is genuinely near-complete; what's absent now
clusters behind the Program-section menus and MIDI depth. Manual references
in parentheses.

1. **Master Clock depth** (p. 40–41): subdivision selection when synced (see
   B4 — a bug and a feature), external MIDI clock lock, KBS keyboard sync
   (Off/On/Soft), Pedal Tap. Subdivisions first; they make the existing sync
   flags musical.
2. **Shift + PROG 1–8 menu system** (p. 57–63): even a two-menu subset pays
   off — **System** (Memory Protect gating Store, Global Transpose, Fine
   Tune) and **Sound** (Piano pedal-noise/string-res levels, B3 click level,
   rotary rotor/horn speed+acceleration — all parameters the engines already
   have as constants). The OLED dial-edit latch pattern (clock/transpose/
   split editors) is the natural chassis.
3. **Organize view** (p. 45): Swap/Move for program slots (and the manual's
   grid view on the OLED). Pure store-layer work, high daily-driver value,
   pairs with the existing 32-slot bank.
4. **STORE AS completeness** (p. 41): Ins/Del cursor soft-actions and
   category assignment (categories then feed the Preset Library's Cat sort,
   E6).
5. **Broad UNDO** (p. 42–43): the manual's undo covers preset loads,
   Global/Group toggles, morph clear, paste, inits, program change. A single
   pre-operation snapshot stack (the discarded-edit slot generalized) covers
   all of it with one mechanism.
6. **Preset Library Num/Cat sorting** (p. 41–42) and storing user presets
   into the library (p. 42–43) — currently declared limitations.
7. **Bank structure**: 8 banks × 8 pages (A–H, 512 slots) vs today's single
   32-slot bank (p. 11–12). The `A:11` readout and Num Pad already assume the
   hardware numbering; Shift+PAGE = BANK is unwired.
8. **Arpeggiator Pattern pages + GROUP** (p. 35–36): the deterministic
   scheduler already exists; preset patterns are a data table, and GROUP
   (shared arp across layers) is a routing flag.
9. **Mon/Copy Paste↔Swap toggle** (p. 43) and **Split SET KEY nudge**
   (Shift+Split repositioning the active point, p. 39).
10. **Morph A.T. via MIDI aftertouch**: the "no browser aftertouch"
    exclusion is true for computer keyboards, but Web MIDI delivers channel
    pressure (0xD0) from hardware controllers fine. Wiring A.T. as a third
    morph source for MIDI users (decorative otherwise) would upgrade the last
    decorative control honestly.
11. **Rotary menu** (p. 53–54): Close Mic and Stop-Angle — both currently
    documented print-only; both are parameter tweaks to the existing rotary
    unit.
12. **MIDI out / Extern** (p. 54–56, 63): the biggest remaining chapter, and
    reasonable to keep excluded — but worth an explicit line in the coverage
    note, which currently doesn't mention MIDI output at all.

---

## F. Candidate findings rejected during verification

Recorded so future audit rounds don't resurface them:

- **"Poly arp mode leaks voices per step"** — false: `startSynthVoice`
  releases the existing same-key voice first (engine.ts 2032–2033); Poly arp
  is retrigger-in-place, matching the manual.
- **"`organDrawbarPose` should reset on program load"** — the pose models the
  *physical* drawbar positions, which on the real Stage 4 (physical drawbars)
  do not move on program load. Current behavior is canonical.
- **"MIDI running status unsupported"** — Web MIDI delivers complete,
  normalized messages; browsers handle running status upstream.
- **"ARP RUN has no run indicator"** — the button cap itself lights via
  `data-lit` (controls.tsx 380); the hardware's separate LED is a cosmetic
  nicety at most.
- **"Store audition of the origin slot should play the captured edit"** —
  manual p. 41 says the *selected store location* is auditioned; playing the
  stored content at the origin is defensible. Kept only as the C4 dropped-
  edits note.

---

## G. Suggested priority order

| Priority | Items | Character |
|---|---|---|
| 1 | A1, A2 | Make the gates green everywhere (they gate everything else) |
| 2 | B1, C1 | The two iteration-42 deferred bugs — both confirmed, both audible/visible |
| 3 | B2, B3, D1 | Stuck/wrong notes and missing MIDI performance inputs |
| 4 | B4 (+E1) | MST CLK subdivisions — bug fix that unlocks the clock feature set |
| 5 | D2–D6 | Panel honesty: layer buttons, dead LEDs, unwired prints, stale coverage note |
| 6 | B5–B10, C2–C5, D7 | Correctness polish, ordered by audibility |
| 7 | E2–E11 | New scope, roughly in listed order |
