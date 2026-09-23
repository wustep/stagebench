# recording/ — StageBench countdown videos

This pipeline turns StageBench previews into a feed-ready video. Each preview plays a song on its own on-screen keybed, one keyboard at a time, and the video counts down the StageBench ranking to #1 while the music plays on continuously.

The first show is `shows/etude6-countdown.json`, which renders `output/etude6-countdown.mp4`. It plays Philip Glass's Étude No. 6 across nine models, from #9 up to #1, in 88 s.

This is separate from `.claude/skills/bench-video`, which records full-screen segments that restart the song for each model. The Claude skill for this pipeline is `.claude/skills/countdown-video`.

## Run it

Requirements:

- **macOS.** The type is SF Pro through `-apple-system`; rendering elsewhere substitutes a different font.
- **Node 24 and pnpm 11.**
- **ffmpeg 7+ on PATH** with `ebur128` and `alimiter`, such as Homebrew's. drawtext isn't needed, because all text is rendered from HTML. Set `FFMPEG`/`FFPROBE` to override the binary.

```sh
pnpm -C recording install
pnpm -C recording exec playwright install chromium   # Playwright is pinned to 1.48.0 (Chromium 130), which the takes were made with

cd recording
node scripts/make.mjs --show shows/etude6-countdown.json --plan      # timeline + duration only
node scripts/make.mjs --show shows/etude6-countdown.json             # record all, prep, compose (~25 min)
node scripts/make.mjs --show shows/etude6-countdown.json --models kimi-k3   # re-record one, recompose
node scripts/make.mjs --show shows/etude6-countdown.json --compose   # recompose from existing takes
```

Output goes to `output/<show>.mp4`, and `output/<show>.report.json` records the timeline, levels, limiter load and each take's misses and lateness. Raw takes go to `.takes/<show>/<model>/`, which is gitignored and holds a few hundred MB of JPEG frames per show.

Record serially and leave the machine alone while the audio passes run. They play in real time, so CPU contention shows up as late notes. `record.mjs` fails a take whose p95 scheduling lateness is over 50 ms.

## Levers (show config)

| Key | What it does |
|---|---|
| `song` | Folder under `songs/`. Each song has a `song.json`, plus MIDI for audio (pedal baked into note lengths) and for the picture (written lengths, same onsets). |
| `models` | Run ids from `runs/`. Labels and ranks come from `runs/<id>/run.json` (`title`, `evaluation.score`), so the ranks are always the repo's current leaderboard. Every model needs a `models.json` fixture. |
| `order` | `"countdown"` sorts from the lowest rank up to #1. Anything else keeps the listed order. |
| `startBar`, `barsPerModel` | Where the video starts, and how long each model plays. Cut on the song's grid (`song.json` → `grid`). |
| `last` | `"to-end"` means the last model plays every remaining bar. A number means that many bars. If omitted, the last model gets `barsPerModel` bars and lands on the next downbeat. |
| `idle`, `breathe` | Idle keyboard before the first note (0.4 s), and the hold after the last note lifts (2.5 s). |
| `caption` | Top-right `title`, `subtitle` and `date`. `fadeOut: [start, gone]` fades it out by `gone` seconds; the default is `[3.5, 5]`. |
| `labels` | Optional `{ "<run-id>": "Display name" }` overrides. |
| `titleCardSecs` | Optional intro card in the same style. It's 0 in the current show, meaning no intro slide. |
| `loudness.targetLufs` | Final integrated loudness (−14). |
| `leveling` | Gentle per-block nudges: `strength` 0.4, `deadbandDb` 2, `maxBoostDb` 3, `maxCutDb` 1.5. Each `barsPerModel` block more than `deadbandDb` from the median moves `strength` of its distance toward it, within the caps. Gains ramp inside a model's turn and step at cuts. Keep it gentle; the song's dynamics are the point. |
| `previewBase`, `stage` | Where previews load from (production by default) and which phase. |

**Duration.** Duration is roughly `models × barsPerModel × (seconds per bar)` plus the last model's extra bars. At this tempo one 8-bar cycle is about 7 s. Use `--plan` to see the exact timeline before recording.

**Choosing start and end.** Start on something strong. In the Étude that's an octave-hit cycle (`song.json` → `sections`). End with #1 on strong material or on the song's real ending.

## House style (don't change per show)

The style lives in `scripts/compose.mjs`:

- **Frame:** 1920×1080 at 30 fps on black.
- **Keyboard:** one at a time, fitted to a 1800×610 box centered at y = 610.
- **Top-left:** `#N` at 60 px bold in `#f6eee2`, then "on StageBench" at 30 px in 62% white, then the model name at 84 px, weight 650. A model without a rank gets a "NEW" pill instead.
- **Top-right caption:** title 30 px / 600, subtitle 22 px / 500, date 18 px caps. It fades out by 5 s.
- **Cuts:** hard picture cuts on the frame at or before each downbeat.
- **Audio switches:** 30 ms equal-power crossfade ending exactly on the downbeat, with no fades.
- **Encode:** H.264 High CRF 16, AAC 256 kbps at 48 kHz. Gentle block leveling, then −14 LUFS through a −1.7 dBFS lookahead limiter.

## How a take is made (`scripts/record.mjs`)

Each model is recorded on one prepared page, with Playwright driving a headless Chromium.

1. **Load the preview.** Wait for `load`, not `networkidle`: some previews never go network-idle.
2. **Set up the sound.** Run the fixture's setup steps. These only ever press the preview's own controls.
3. **Strip the page down.** DOM surgery hides everything except the instrument, sets a black background, and centers the instrument by translation only. Overhang clipped by `overflow: hidden` is excluded from the crop.
4. **Warm up.** Play one note to start the engine. Models flagged `prewarm` instead get every (pitch, velocity) pair the take will use, each held 30 ms, then the sound decays.
5. **Reference pass.** Play the song's `levelReferenceBars` once and record it to `calib.webm`. The same bars on every model set its level.
6. **Audio pass.** Play the model's bars in real time through the keybed (`data-note`/`data-midi`), plus a 2-bar lead-in so ringing notes exist at its first downbeat. Every `AudioContext` is tapped and recorded with MediaRecorder.
7. **Visual pass.** For each 1/30 s frame, apply the written-length key state and take a CDP screenshot clipped to the instrument at device pixels. The CDP screencast was tried first but tops out near 10 fps at this size.

**Velocity.** Velocity goes in as strike depth along the key (front is louder) and as pointer pressure. Models that ignore both play a fixed velocity; that's the model's own behavior.

**Alignment.** `prep.mjs` detects the first played note's onset, which lags the scheduler by 70–90 ms, and moves it onto the video clock. Each model then gets one linear gain that brings its reference passage to −18 LUFS. Pianos match each other while the song keeps its own dynamics.

## Adding a model

1. Run `node scripts/probe.mjs --model <run-id>`, then `scripts/audit.mjs` (everything switched on after setup, and the effect/reverb amounts) and `scripts/abtest.mjs` (prove whether a control changes the sound). It reports the keybed range, fluid or fixed layout (with a suggested viewport), the sound-relevant controls as the page reports them, key-press cost, velocity response and the reverb tail test.
2. Read the report's controls list and add a fixture to `models.json`. It should give just the grand on Piano A: organ, synth, Piano B, unison and mod effects off. Turn reverb on only if the tail test shows a real tail, and leave amounts at the model's defaults.
3. Run `scripts/latency.mjs --model <id>`. Output latency should be steady, with a spread under about 20 ms, because prep aligns each take on its first note.
4. Record the model alone: `make.mjs --models <id>`. Check its `meta.json` for `setup`, `miss` and `schedLateMs`, and look at `still.png`.

## Setup steps (models.json, run by `scripts/lib/setup.mjs`)

- `pressIfOff: <selector>` clicks if `aria-pressed` isn't `true`.
- `pressOffIfOn: <selector>` clicks if `aria-pressed` is `true`.
- `select: [<selector>, <option label>]` chooses an option.
- `cycleTo: [<selector>, <aria-label regex>]` clicks a cycling button until its label matches.
- `setValue: [<selector>, <target>, <regex?>]` steps a slider or knob with the arrow keys to a target. It's used to set reverb to about 35%.
- `click: <selector>` clicks once, for cycle buttons with no readable state. Verify it with `abtest.mjs`.

**Target sound: just the grand plus basic reverb.** Reverb is on only where the tail test shows it works, and set to about 35% of its dry/wet range, which is Opus 5.5's default. Some previews render toggles as cycle buttons whose `aria-pressed` is always `true`, such as Kimi's Piano Unison, Dyn Comp and Timbre. `pressIfOff`/`pressOffIfOn` would toggle those blindly: the old Kimi fixture's "unison off" step actually switched unison **on**. A/B any step with `scripts/abtest.mjs` before trusting it.

## Hard-won details

- **Slow engines.** Kimi K3 builds each note on first use: about 90 ms of main-thread work per pitch and almost per exact velocity. The pre-warm handles the pitch cost, but humanized velocities still miss the cache and fall seconds behind. `quantizeVelocity: 8` snaps them to 8 levels. That choice is disclosed and was Stephen's call. The probe flags this pattern.
- **Renderer crashes.** A key-up in the same tick as its key-down crashed Fable 5's renderer within about 100 presses, so the recorder always holds notes. Fable 5 also crashes intermittently in dense passages: its octave-hit reference pass crashed 2 of 3 times. The recorder exits with code 2 on a page crash rather than hanging, and `make.mjs` retries such a take twice.
- **Fixed-width layouts.** Sol (1500 px), Luna (1600 px) and Kimi (1400 px) get a smaller CSS viewport and a higher DPR. They render natively at about 2400 device px instead of being upscaled.
- **Keybed ranges.** A Stage 4 73 is E1–E7 (MIDI 28–100), and notes outside it are skipped. Luna Max's keybed is labeled E2–D♯8, so it also skips E1–D♯2. That's part of its recreation, so it's left alone.
- **ffmpeg `apad`.** A bare `apad` pads forever; it once wrote about 1 TB. Always use `apad=whole_dur=…` plus an output `-t`.
- **Keys in the picture.** They show the written note lengths, so they lift like fingers while the baked pedal in the audio keeps the sound ringing. Both MIDI files must share onsets, pitches and velocities; `record.mjs` checks this.
