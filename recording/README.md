# recording/ — StageBench countdown videos

This pipeline turns StageBench previews into a feed-ready video. Each preview plays a song on its own on-screen keybed, one keyboard at a time, and the video counts down the StageBench ranking to #1 while the music plays on continuously.

The first show is `shows/etude6-countdown.json`, which renders `output/etude6-countdown.mp4`. It plays Philip Glass's Étude No. 6 across nine models, counting down to #1, in 88 s. The second is `shows/demo-v2-alla-turca.json` (Mozart's Rondo Alla Turca, eight models in a fixed order); see [Demo v2](#demo-v2-mozart-rondo-alla-turca).

This is separate from `.claude/skills/bench-video`, which records full-screen segments that restart the song for each model. The Claude skill for this pipeline is `.claude/skills/countdown-video`.

## Run it

Requirements:

- **macOS.** The type is SF Pro through `-apple-system`; rendering elsewhere substitutes a different font.
- **Node 24 and pnpm 11.** Newer Node works too (`engines` is advisory; pnpm's engine-strict is off).
- **ffmpeg 7+ on PATH** with `ebur128` and `alimiter`, such as Homebrew's. drawtext isn't needed, because all text is rendered from HTML. Set `FFMPEG`/`FFPROBE` to override the binary.

```sh
pnpm -C recording install
pnpm -C recording exec playwright install chromium   # the Chromium that matches the Playwright pinned in package.json

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
| `models` | Run ids. Labels and ranks come from the gallery's data, `src/data/runs.json` (`title`, `score`): one combined leaderboard of every scored run, ranked exactly as the gallery ranks it (`src/runs-data.ts`): highest score first, newest first on a tie, numbered by position. They're computed whenever a show loads, never stored, so the film always shows the repo's current leaderboard. Run `pnpm bench reindex` after changing `runs/*/run.json`. A run not in that file is unranked (NEW pill); its title comes from `runs/<id>/run.json`. Every filmed model needs a `models.json` fixture. |
| `order` | `"countdown"` sorts from the lowest rank up to #1. Anything else keeps the listed order. |
| `startBar`, `barsPerModel` | Where the video starts, and how long each model plays. Cut on the song's grid (`song.json` → `grid`; a song that opens on an anacrusis sets `pickupBeats`, and bar 1 starts after it). |
| `pickupBeats` | Optional. The first model also plays this many beats before `startBar`, so a phrase that starts on a pickup opens the film whole. |
| `last` | `"to-end"` means the last model plays every remaining bar. A number means that many bars. If omitted, the last model gets `barsPerModel` bars and lands on the next downbeat. |
| `idle`, `breathe` | Idle keyboard before the first note (0.4 s), and the hold after the last note lifts (2.5 s). |
| `caption` | Top-right `title`, `subtitle` and `date`. `fadeOut: [start, gone]` fades it out by `gone` seconds; the default is `[3.5, 5]`. |
| `labels` | Optional `{ "<run-id>": "Display name" }` overrides. |
| `placeholderLabels` | Optional names for models that have no run record in this checkout yet (placeholder slots), used only until the run's own title is available. |
| `titleCardSecs` | Optional intro card in the same style. It's 0 in the current shows, meaning no intro slide. |
| `endCard` | Optional closing card after the last model: an `image` (path relative to `recording/`, shown 960 px wide) above `title`, `subtitle` and `footer` in the title card's type, plus `secs` and `fadeIn` (from black, over silence). Rendered by compose, so `make.mjs` (or `--compose`) includes it; compose also saves it as `output/<show>.end-card.png`. |
| `loudness.targetLufs` | Final integrated loudness (−14). |
| `leveling` | Gentle per-block nudges: `strength` 0.4, `deadbandDb` 2, `maxBoostDb` 3, `maxCutDb` 1.5. Each `barsPerModel` block more than `deadbandDb` from the median moves `strength` of its distance toward it, within the caps. Gains ramp inside a model's turn and step at cuts. Keep it gentle; the song's dynamics are the point. |
| `previewBase`, `stage` | Where previews load from and which phase. A URL prefix (production by default), or `"local"`: serve this checkout's `public/` with `python3 -m http.server` on a free localhost port, started and stopped by each script (`scripts/lib/serve.mjs`). Local is reproducible offline and can film previews that aren't deployed. With `"local"`, a model with no run record or no `public/previews/<id>/stage<N>/` becomes a placeholder slot (see [Placeholders](#placeholders)). |

**Duration.** Duration is roughly `models × barsPerModel × (seconds per bar)` plus the last model's extra bars. At this tempo one 8-bar cycle is about 7 s. Use `--plan` to see the exact timeline before recording.

**Choosing start and end.** Start on something strong. In the Étude that's an octave-hit cycle (`song.json` → `sections`). End with #1 on strong material or on the song's real ending.

## Demo v2: Mozart, Rondo Alla Turca

`shows/demo-v2-alla-turca.json` renders `output/demo-v2-alla-turca.mp4` and its report. It's a draft and isn't used on the site. Eight models play the last third of Mozart's Rondo Alla Turca in the show's listed order, not a countdown:

- eight bars each from the A-minor theme (bar 137, with its pickup), through the C-major episode and the janissary march;
- the last model plays the coda to the final chord;
- then a short StageBench end card.

It runs about 87 s, in the house style below.

```sh
cd recording
node scripts/make.mjs --show shows/demo-v2-alla-turca.json --plan   # timeline, computed ranks, placeholder slots
node scripts/make.mjs --show shows/demo-v2-alla-turca.json          # record every filmable model, prep, compose (~25 min)
node scripts/qa.mjs --show shows/demo-v2-alla-turca.json            # contact sheet + timing/level checks
```

- **Song.** `songs/mozart-rondo-alla-turca/` is the third movement of the Piano Sonata K. 331. Mozart died in 1791 and the sonata was published in 1784, so the composition is public domain. The MIDI is from Stephen's library, with a dynamics pass from this repo:
  - `dynamics.mjs` reads the original, which it never writes, and changes only note-on velocities. It verifies that every other byte is identical and prints a before/after.
  - `make-song.mjs` bakes the pedal into the audio file and writes the written-length picture file.
  - Every note is D2–E6, inside every keybed, so nothing is skipped.
- **Grid.** 2/4, counted through the performance with every repeat played. The file opens on a one-beat pickup (`"pickupBeats": 1` in `song.json`). Its 1/4 time signatures are only the half bars where a section's end meets the next pickup, so the downbeats stay on a steady 2/4 grid. Turns are 8-bar phrases.
- **Order and ranks.** The models play in the order the show lists them. The `#N` on each turn is computed when the show loads, from `src/data/runs.json`, as described under `models` above. Nothing in the show, the overlays or this README stores a rank.
- **Previews are local** (`"previewBase": "local"`). Each script that opens a preview serves this checkout's `public/` itself, so recording needs no network and no separately started server.

### Placeholders

A show model is a placeholder slot when it has no run record (not in `src/data/runs.json` and no `runs/<id>/run.json`) or, with local previews, no `public/previews/<id>/stage<N>/index.html`. A placeholder never stops the show:

- `--plan` marks it `[placeholder: <reason>]`;
- `make.mjs` skips it when recording;
- compose keeps its bars and timing, showing a black frame with its label (the NEW pill, "not yet ranked on StageBench" and the name from `placeholderLabels`) and a centered "Take pending" line in the caption's subtitle style;
- its audio is silent, and it's left out of the leveling.

Every other turn is unaffected. `qa.mjs` lists placeholder slots but has no take to check for them.

### Dropping in GPT 6.2 Sol and Astra (protocol 3)

`gpt-6-2-sol-p3` and `gpt-6-2-astra-p3` are placeholders until their stage-3 previews exist. They're filmed at stage 3 like everyone else; there's no fallback to an earlier stage. Once a run has a sealed stage 3:

1. **Make it visible to the loader.** Copy `runs/<id>/` and `public/previews/<id>/stage3/` into this checkout. Don't commit them, or a reindexed `src/data/runs.json`, on this branch: they reach the gallery only through the normal publishing PR. Alternatively, read them in place from the grading checkout without copying anything:
   ```sh
   export STAGEBENCH_EXTRA_CHECKOUTS=~/Projects/stagebench-sol-p3:~/Projects/stagebench-astra-p3
   ```
   Checkouts in that list are searched, read-only, after this one for `runs/<id>/run.json` and `public/previews/<id>/stage<N>/`, and served by the same local server.
2. **Check the plan.** Run `node scripts/make.mjs --show shows/demo-v2-alla-turca.json --plan`. The slot should no longer be marked as a placeholder.
3. **Add a fixture.** Run `node scripts/probe.mjs --model <id> --base local`, then `scripts/audit.mjs` and `scripts/abtest.mjs` (see [Adding a model](#adding-a-model)), and add the `models.json` entry.
4. **Record and compose.** `node scripts/make.mjs --show shows/demo-v2-alla-turca.json --models <id>` records just that model, then preps every take and recomposes the film with it in its slot.
5. **Update the ranks.** Until the run is in `src/data/runs.json` it shows NEW. Once it's published and reindexed, run `--compose` again. Its `#N` appears, and the ranks of the models it outscores move with it.

## House style (don't change per show)

The style lives in `scripts/compose.mjs`:

- **Frame:** 1920×1080 at 30 fps on black.
- **Keyboard:** one at a time, fitted to a 1800×610 box centered at y = 610.
- **Top-left:** `#N` at 60 px bold in `#f6eee2`, then "on StageBench" at 30 px in 62% white, then the model name at 84 px, weight 650. A model without a rank gets a "NEW" pill instead.
- **Top-right caption:** title 30 px / 600, subtitle 22 px / 500, date 18 px caps. It fades out by 5 s.
- **Cuts:** hard picture cuts on the frame at or before each downbeat.
- **Audio switches:** 30 ms equal-power crossfade ending exactly on the downbeat, with no fades.
- **Encode:** H.264 High CRF 16, AAC 256 kbps at 48 kHz. Gentle block leveling, then −14 LUFS through a −1.7 dBFS lookahead limiter.
- **Type:** SF Pro via `-apple-system`, with no web fonts. Compose checks which platform fonts actually rendered, records them in the report (`fonts`), and fails if a non-house face shows up.

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

1. Run `node scripts/probe.mjs --model <run-id>` (add `--base local` to probe this checkout's `public/previews/` instead of production), then `scripts/audit.mjs` (everything switched on after setup, and the effect/reverb amounts) and `scripts/abtest.mjs` (prove whether a control changes the sound). It reports the keybed range, fluid or fixed layout (with a suggested viewport), the sound-relevant controls as the page reports them, key-press cost, velocity response and the reverb tail test.
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
- **Serving local previews.** Plain `python3 -m http.server` listens with a backlog of 5. GPT-6 Sol fetches its 56 samples in one burst, so some connections were reset, and its engine fell back to synthesis (its OLED reads "SAMPLE ERROR · FALLBACK"). Sample-based engines can degrade like this without failing the page. `scripts/lib/serve.mjs` runs the same handler on a threaded server with a 256-deep backlog. `record.mjs` also fails a take, which `make.mjs` retries, if any request fails at the network level, and it records `failedRequests` in `meta.json`.
- **Self-scaling instruments.** Fable 5.2 lays its panel out at 9013 px and scales `#instrument` with its own inline `transform`, which the recorder's centering would clear. A fixture can name the root to center instead (`"instrument": ".instrument-frame"`).
- **ffmpeg `apad`.** A bare `apad` pads forever; it once wrote about 1 TB. Always use `apad=whole_dur=…` plus an output `-t`.
- **Keys in the picture.** They show the written note lengths, so they lift like fingers while the baked pedal in the audio keeps the sound ringing. Both MIDI files must share onsets, pitches and velocities; `record.mjs` checks this.
