---
name: bench-video
description: >-
  Record a side-by-side comparison video of Stagebench run previews playing the
  same piece — one full-screen segment per model, with title and per-phase
  telemetry overlays. Use when the user asks to make, remake, or update a
  Stagebench comparison/demo video of model runs.
---

# bench-video — Stagebench comparison videos

Produces a 1920×1080 MP4: a title card, then one segment per model, each showing that
model's phase-N preview playing the same piece with its real captured Web Audio.

## Always ask first

Never assume the three parameters. Ask them in **one** `AskUserQuestion` call (three
questions, single-select unless noted):

1. **Song** — options: `Bach — Prelude in C (BWV 846)` *(recommended; the proven default)*,
   `Ode to Joy`, `Für Elise (uses black keys)`, `Twinkle`, and let the user type a new one.
   Read `assets/songs.json` and use each song's `why` field as the option description.
   If they want something not in the library, add it to `songs.json` first (see
   **Adding a song**) rather than hand-rolling a one-off.
2. **Models** — `multiSelect: true`. Build the option list from the actual registry, not
   memory: `node -e 'require("./src/data/runs.json").forEach(r=>console.log(r.id, r.title, r.score))'`.
   Offer them highest-score-first. Ask about **order** too, or default to descending score.
3. **Phase** — `1 · Surface + Piano`, `2 · Pianos + FX` *(recommended — piano is live and
   effects exist, so there's something to hear)*, `3 · Complete system`.

## Pipeline

```sh
# 0. serve the previews (see "Serving" — this is a real trap)
cd <repo>/public && python3 -m http.server 4173 &

# 1. record one segment per model (pre-flights each artifact, then films it)
node .claude/skills/bench-video/scripts/record.mjs \
  --runs claude-fable-5,kimi-k3 --phase 2 --song bach-prelude-c \
  --out /tmp/bench-video/raw --repo "$PWD" --base http://127.0.0.1:4173

# 2. compose title card + segments (writes to ~/Desktop by default)
FF=./node_modules/ffmpeg-static/ffmpeg \
  .claude/skills/bench-video/scripts/compose.sh \
  --raw /tmp/bench-video/raw --order claude-fable-5,kimi-k3 --phase 2
```

**Raw captures go to scratch; the finished video goes to the Desktop.** Point `record.mjs
--out` at the session scratchpad — raw `.webm` files are large and not worth keeping.
`compose.sh` then defaults its output to
`~/Desktop/stagebench-<a>-vs-<b>-phase<N>.mp4` (falling back to `$PWD` if there's no
Desktop), so **omit `--out` unless the user asks for a specific path**. This default exists
because the scratchpad lives under a sandboxed `/private/tmp/...` path that is awkward to
open and gets cleaned up — never hand over a deliverable sitting there.
Run the commands with **cwd = repo root**: `record.mjs` resolves `playwright` from the repo's `node_modules`, so invoking it
from elsewhere fails with `ERR_MODULE_NOT_FOUND` even though `--repo` is set (that flag only
locates `run.json`). Use Node 24:
`export PATH="$(ls -d $HOME/.nvm/versions/node/v24.*/bin | sort -V | tail -1):$PATH"`.
Set `FFDEBUG=1` on `compose.sh` to see ffmpeg's stderr when a segment fails to encode.

## Hard-won details — do not rediscover these

**Serving.** Use `python3 -m http.server` from `public/`, or the running dev server on
5173. Do **not** use `npx serve`: it 301-redirects `/…/index.html` → `/…/`, which strips the
trailing path segment so the build's relative `./assets/*` URLs resolve one directory too
high. The page loads with HTTP 200 and a completely empty body — it looks like the artifact
is broken when it is only mis-served.

**Pre-flight before filming.** `record.mjs` loads each artifact once, un-recorded, counts
`requestAnimationFrame` ticks over 4s, and counts key elements. It has **two distinct failure
modes — do not conflate them**:

- *Doesn't paint* (<100 frames/4s, or a >750ms stall) → **the artifact's problem.** A run once
  blocked its main thread ~16s on load; the driver's own `page.evaluate` calls silently
  absorbed the stall, so the capture *looked* plausible while the audio was garbage. Stop and
  investigate the artifact — never work around it in the capture.
- *Zero key elements* while painting fine → **almost always this tool's problem.** Inspect the
  DOM and widen the selector; don't conclude the artifact lacks a keybed.

**Keys are not always `<button>`.** We match `button, [role="button"]` with a class matching
`/(^|[ -])key/i`. One run ships an ARIA-correct `<div role="button" class="key white-key"
data-note="28">` keybed; an earlier tag-locked selector reported 0 keys and aborted a
perfectly good artifact. If a new run finds no keys, widen `KEY_SELECTOR` first.

**Per-PHASE telemetry, never run totals.** The overlay must show the phase's own numbers.
A run whose total was 132.9M tokens / $43.04 / 4h02m had a phase-2 slice of
60.4M / $17.72 / 1h46m — using the total would overstate a phase-2 video by ~2×.
`record.mjs` reads `runs/<id>/run.json` → `stages[]` matching `--phase`. Cross-check with
`pnpm bench status <id>`. It warns on **every** missing field, and again if the overlay would
carry fewer than two. Some phases have only `wallTimeSeconds`, which would otherwise render a
bare `9m` that looks like a bug rather than a data gap. Supply missing values by hand and
label estimates (`~$25 est.`) rather than printing a number you can't source.

**Effects bypass: an entry existing does not mean bypass works.** `FX_DEFAULTS` in
`record.mjs` maps run id → `{label, want}` steps; labels were confirmed identical on phases 2
and 3. `record.mjs` now **verifies** the resulting `aria-pressed` and warns when the toggle
did not land. Actual state across the ten runs:

| status | runs |
|---|---|
| bypass verified working | `sol`, `fable`, `kimi`, `luna`, `gpt5-5-high`, `opus` |
| control present but **decorative** — always films wet | `grok-4-5`, `claude-haiku-4-5-20251001` |
| six per-unit toggles, no `aria-pressed`, unverifiable | `composer-2-5-fast` |
| no bypass control at all (effects decorative) | `gpt-5-6-terra-high` (entry `[]`) |

So a comparison that mixes the first group with `grok`/`haiku` is **not** audio-comparable, and
no code change can fix it — those controls do nothing when clicked by real mouse, synthetic
`el.click()`, or full pointer/mouse event dispatch (all three tried). Say so in the copy.

Conventions: `[]` means *verified: nothing to bypass* and counts as covered; a run **missing**
from the map films wet and warns. Never add an entry from label discovery alone — click it and
confirm the state changes, or you will log "handled" while effects stay live.

**Loudness is matched across segments.** Artifacts ship wildly different output levels — a
**27.7 dB spread** measured across runs (−12.8 to −40.5 LUFS), which makes quiet models
inaudible beside loud ones and biases any listening comparison. `compose.sh` measures each
segment and applies a **single static gain** to reach `TARGET_LUFS` (default −16), clamped by
true peak so it can never clip. No compression, limiting, or EQ — pitch, timing and dynamics
are untouched; it is exactly a volume knob. Every measurement and applied gain is printed and
summarised at the end. Set `LOUDNORM=0` to keep raw levels.

This is a deliberate, disclosed transform, not sweetening. But it *does* hide one real
difference: an artifact that is 25 dB quiet has a genuine gain-staging problem. If the video
is published alongside any claim about output level, say that levels were matched.

**Normalize the framing.** Models render the instrument at very different sizes — one filled
94% of frame width while others sat at ~72% and looked far away. `record.mjs` measures the
instrument's bounding box and emits a per-artifact `crop`, so each fills the frame equally
with its top edge at y≈228 (clearing the title card). An artifact already ≥94% wide gets no
crop. Tune via `TARGET_WIDTH_FRAC` / `TITLE_CLEAR_Y` in `record.mjs`; don't hand-write crops.

*Known limitation:* the box is derived from the key elements, so an artifact whose keybed
**overflows its chassis or the viewport** measures far too wide (one run reported 2236×88 in a
1920px viewport) and therefore gets no crop, leaving it small and off-centre in frame. The
capture is still honest — it shows a genuinely broken layout — but it will not match the
framing of well-formed runs. Note it in the surrounding copy rather than hand-cropping it.

**Notes are addressed by MIDI number**, resolved from each key button's `data-note` /
`data-midi`, falling back to parsing the `aria-label` (`"C4 key"`, `"Piano key C4"`,
`"C4 piano key"` all work). Do not index white keys by position — that silently breaks on
accidentals and on any keybed with a different low note.

**Audio.** Captured by monkey-patching `AudioNode.prototype.connect` to tee anything bound
for the destination into a `MediaStreamDestination` + `MediaRecorder`. The recorder start
offset is written to the meta file and `compose.sh` uses it to align A/V. If a segment's
audio is <5KB, `record.mjs` flags it as possibly silent — investigate before composing.

**Headless is correct.** The capture runs headless and Playwright injects events directly
into the page, so your own typing cannot leak into the recording. If notes sound wrong,
it is the artifact, not keyboard bleed.

## Honesty

These videos document what each model actually built. **Never sweeten a segment.** Do not
retune, pitch-correct, replace, or mute audio to make an artifact sound better, and do not
patch an artifact to film it. If a model's piano plays out of tune or its timing is wrong,
that is the finding — capture it as-is and say so in the surrounding copy. If an artifact is
too broken to film (pre-flight fails), report that rather than producing a misleading video.

If a previously-filmed artifact has since been fixed in the repo, the old video no longer
matches what the gallery serves. Say so and offer a re-record; don't silently mix versions.

## Adding a song

Append to `assets/songs.json`:

- `noteMs` — base note duration; `gateRatio` — fraction held before release (0.82 is lively,
  0.9 legato)
- `phrases[]` — `{ pedal, repeat, seq }` where `seq` is an array of simultaneous-MIDI arrays
  (`[[60],[64]]` = two single notes; `[[60,64,67]]` = a chord). `pedal: true` holds sustain
  for that phrase.
- `finalChord` — struck with independent pointer ids so it's genuinely simultaneous
- `segmentSeconds` — per-segment length; keep every song's total under it or it gets cut

Prefer public-domain material. Verify the range fits the keybed — `record.mjs` fails fast if
the song needs notes outside it.
