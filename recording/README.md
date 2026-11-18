# recording/ — StageBench countdown videos

This pipeline turns StageBench previews into a feed-ready video. Each preview plays a song on its own on-screen keybed, one keyboard at a time, and the video counts down the StageBench ranking to #1 while the music plays on continuously.

The first show is `shows/etude6-countdown.json`, which renders `output/etude6-countdown.mp4`. It plays Philip Glass's Étude No. 6 across nine models, counting down to #1, in 88 s. The second is `shows/demo-v2-alla-turca.json` (Mozart's Rondo Alla Turca, eight models by rank, ending on #1); see [Demo v2](#demo-v2-mozart-rondo-alla-turca).

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
| `pickupInIntro` | Optional, with an `intro`. The first model's picture starts on `startBar`'s downbeat like every other turn. Its `idle` and pickup play under the last moments of the intro instead of padding its turn. The intro must be at least that long. |
| `last` | `"to-end"` means the last model plays every remaining bar. A number means that many bars. If omitted, the last model gets `barsPerModel` bars and lands on the next downbeat. |
| `lastBarBeats` | Optional. The film's final bar plays only its first N beats, for a cadence whose bar also holds the next section's pickup (Alla Turca: the march's A-major chord on beat 1 of bar 192, with the coda's pickup on beat 2). Without it the last model plays into the next downbeat. |
| `finalHold` | Optional, with `lastBarBeats`. The notes struck on that final beat are held this many seconds from the beat, like a fermata, then released into `breathe`. Keys in the picture hold too. It is part of the performance: changing it means re-recording the last model. |
| `idle`, `breathe` | Idle keyboard before the first note (0.4 s), and the last model's picture after the last note lifts (2.5 s). An end card's `crossfade` takes the last seconds of `breathe`. |
| `ringOut` | Optional. Seconds the audio runs on past the last model's picture, so the closing chord's reverb decays under the end card instead of being cut. Compose fades the audio out from the start of the end card's crossfade (or the cut) to the end of the ring-out. |
| `cutSlack` | Optional, in frames (0 by default). A cut between turns may move this many frames off its downbeat's frame to even out how long each turn is on screen. The plan picks the moves that shrink the longest-minus-shortest spread, and a move has to buy at least a frame of it. The audio still switches on the downbeat, so a moved cut has the picture lead it by up to about 2 frames or trail it by up to 1. `--plan`, the compose log and the report (`cutShiftFrames`, `cutOffsetMs`) name each moved cut. |
| `caption` | Top-right `title`, `subtitle` and `date`. `fadeOut: [start, gone]` fades it out by `gone` seconds; the default is `[3.5, 5]`. |
| `labels` | Optional `{ "<run-id>": "Display name" }` overrides. |
| `failOnMiss` | Optional. A take in which the keybed refused any note fails and is retried (exit 2, like a page crash) instead of reaching compose. Off by default, because a keybed shorter than the song's range skips notes by design (Luna Max in the Étude). Demo v2 sets it. |
| `placeholderLabels` | Optional names for models that have no run record in this checkout yet (placeholder slots), used only until the run's own title is available. |
| `intro`, `endCard` | Optional cards: `intro` before the first model (the caption then comes on with the first model), `endCard` after the last. Each card has an `image` (a path relative to `recording/`), optionally `title`, `subtitle`, `date` and `footer`, and runs for `secs` seconds. Placement:<br>• `"frame": "first-model"` (the intro): the image, a keyed photo, is scaled and placed so its chassis lands on the first model's chassis as composed. Compose measures both, so the cut into the first turn keeps the keyboard in place. The title and subtitle sit above it, the date and footer below.<br>• Otherwise (the end card): the image is centered, with the type beneath it. An SVG is drawn at `imageScale`, a whole-number multiple of its own `width`/`height` (or at `imageWidth`), on even pixels. `imageFilter` is CSS applied to it, with lengths at 1× that scale with it.<br>Each part fades on its own schedule: `fades: { "image": [in at, in for], "title": [in at, in for, out at, out for], … }`. The image fades from black and the type in alpha. An end card with `crossfade` (seconds) dissolves in from the last model instead of starting on black. An intro with `crossfade` dissolves into the first model over its last seconds, with the first model's label and the caption dissolving in too. The first model is fully up on its downbeat either way, so its turn on screen doesn't change. Compose renders the cards, so `make.mjs` (or `--compose`) includes them, and saves each finished card as `output/<show>.intro.png` / `.end-card.png`. `compose.mjs --show … --cards` renders just the cards and card-only clips (`.takes/<show>/_work/<card>-preview.mp4`). Card type is house style (below). |
| `titleCardSecs` | Legacy text intro (the caption on a black card). `intro` replaces it; 0 in the current shows. |
| `loudness.targetLufs` | Final integrated loudness (−14). |
| `leveling` | Gentle per-block nudges: `strength` 0.4, `deadbandDb` 2, `maxBoostDb` 3, `maxCutDb` 1.5. Each `barsPerModel` block more than `deadbandDb` from the median moves `strength` of its distance toward it, within the caps. Gains ramp inside a model's turn and step at cuts. Keep it gentle; the song's dynamics are the point. |
| `previewBase`, `stage` | Where previews load from and which phase. A URL prefix (production by default), or `"local"`: serve this checkout's `public/` with `python3 -m http.server` on a free localhost port, started and stopped by each script (`scripts/lib/serve.mjs`). Local is reproducible offline and can film previews that aren't deployed. With `"local"`, a model with no run record or no `public/previews/<id>/stage<N>/` becomes a placeholder slot (see [Placeholders](#placeholders)). |

**Duration.** Duration is roughly `models × barsPerModel × (seconds per bar)` plus the last model's extra bars. At this tempo one 8-bar cycle is about 7 s. Use `--plan` to see the exact timeline before recording.

**Choosing start and end.** Start on something strong. In the Étude that's an octave-hit cycle (`song.json` → `sections`). End with #1 on strong material or on the song's real ending.

## Demo v2: Mozart, Rondo Alla Turca

`shows/demo-v2-alla-turca.json` renders `output/demo-v2-alla-turca.mp4` and its report. It's a draft and isn't used on the site. Eight models play the last third of Mozart's Rondo Alla Turca in the show's listed order, which runs by live rank from the lowest up to #1:

- one 8-bar phrase each, from the start of the A-minor theme's return (bar 129) through the C-major episode, the theme's return and the janissary march;
- it opens on a 3.5 s intro: the real Nord Stage 4 photo on black, framed exactly like the first model's keyboard, with "StageBench", "Eight AI models rebuild the Nord Stage 4" and "November 2026". The type fades out as the theme's one-beat pickup starts under the photo (`pickupInIntro`), then the photo dissolves into the first model over 0.2 s (`intro.crossfade`), which is fully up on bar 129's downbeat;
- the last model stops on the march's A-major cadence (bar 192, beat 1, `lastBarBeats`), holds that chord 0.6 s (`finalHold`), and 0.2 s after the release dissolves into the end card over 0.37 s;
- it closes on a 4 s end card: the StageBench keyboard illustration from wustep.me at 8×, with "StageBench" and the link at full opacity 0.5 s in. The chord's reverb rings out under the card (`ringOut`).

It runs about 66 s, in the house style below. Every cut lands on a phrase boundary, and every turn is one phrase, on screen for 7.20–7.47 s.
- **Tempo:** the phrases themselves run 7.20–7.56 s, because the march bars are about 0.945 s against about 0.90 s for the theme.
- **`cutSlack: 1`** evens that out by moving two cuts one frame. The cut into the seventh turn (bar 177, GPT 6.2 Astra) comes 29 ms after its downbeat and the cut into the last (bar 185, Fable) 63 ms before it, while the audio switches stay on the downbeats. The moves belong to the phrase slots, not the models, so reordering the models leaves them where they are.
- **Last turn:** it is on screen as long as the others, its held chord included.

```sh
cd recording
node scripts/make.mjs --show shows/demo-v2-alla-turca.json --plan   # timeline, computed ranks, placeholder slots
node scripts/make.mjs --show shows/demo-v2-alla-turca.json          # record every filmable model, prep, compose (~25 min)
node scripts/make.mjs --show shows/demo-v2-alla-turca.json --compose   # prep + compose from existing takes
node scripts/qa.mjs --show shows/demo-v2-alla-turca.json --grabs output/demo-v2-qa   # contact sheet, card frames, timing/level checks
node scripts/site-compare.mjs --show shows/demo-v2-alla-turca.json \
  --frame output/demo-v2-qa/end-card-faded-in.png --out output/demo-v2-qa/site-svg-vs-end-card.png   # needs network
```

- **Song.** `songs/mozart-rondo-alla-turca/` is the third movement of the Piano Sonata K. 331. Mozart died in 1791 and the sonata was published in 1784, so the composition is public domain. The MIDI is from Stephen's library, with a dynamics pass from this repo:
  - `dynamics.mjs` reads the original, which it never writes, and changes only note-on velocities. It verifies that every other byte is identical and prints a before/after. It refuses to write over a file that holds the original's bytes.
  - The pass rebuilds each velocity as a section level that moves through the phrase (hairpins: the A-minor theme swells between ~52 and ~66, the march builds from ~96 to ~114), plus voicing (melody on top, a doubled inner voice 8 under it, the accompaniment 16 under), plus 0.6× the performer's own deviation, plus accents (march downbeats +10, their rolled grace chords −10). In the film's bars the theme averages 52 and the march 95, where the original had 70 and 86.
  - `make-song.mjs` bakes the pedal into the audio file and writes the written-length picture file.
  - Every note is D2–E6, inside every keybed, so nothing is skipped.
- **Grid.** 2/4, counted through the performance with every repeat played. The file opens on a one-beat pickup (`"pickupBeats": 1` in `song.json`). Its 1/4 time signatures are only the half bars where a section's end meets the next pickup, so the downbeats stay on a steady 2/4 grid. Turns are 8-bar phrases.
- **Order and ranks.** The models play in the order the show lists them, which since round 5 is by live rank: the lowest first, #1 (Fable 5.2) last, straight into the end card. The `#N` on each turn is computed when the show loads, from `src/data/runs.json`, as described under `models` above. Nothing in the show, the overlays or this README stores a rank.
  - **Why a hand-kept list, not `"order": "countdown"`.** A take is a performance of one phrase, so a model that moves to another slot has to be re-recorded. With a fixed list, a rank change can't silently move a model onto bars it wasn't recorded for. `--plan` warns when the list no longer counts up by live rank, and compose refuses a take recorded for other bars (`take covers bars …, plan needs …; re-record it`).
  - **Reordering.** Edit the list, run `--plan`, then `make.mjs --models <the models whose bars changed>`. The phrases stay in musical order; only who plays which one changes. Round 5 re-recorded Sonnet 5.5, GPT 6.2 Sol, Opus 5.5 and GPT 6.2 Astra this way and reused the other four takes.
- **Previews are local** (`"previewBase": "local"`). Each script that opens a preview serves this checkout's `public/` itself, so recording needs no network and no separately started server.
- **Caption.** "Rondo alla Turca" over "Wolfgang Amadeus Mozart", on with the first model. It has no project line or date, since the intro just said both.
- **Levels.** Each piano is level-matched on the same reference bars (177–200, the march into the coda). This show's block leveling uses a 3 dB deadband, not 2, so that only a real outlier gets nudged. That keeps the theme return's piano from being lifted toward the forte march, which would undo the dynamics pass. In round 5's rank order one turn moves. Opus 5.5 has the steepest velocity curve of the eight, and its phrase is now the soft theme return (bars 169–176, velocities from ~44 rising to ~82). It measures −26.1 LUFS against the −19.3 median, so it is lifted +2.7 dB (0.4 × 6.8 dB, under the +3 dB cap) for its whole turn. GPT 6.1 Sol (−22.1) stays inside the deadband. In round 4, with Sonnet on that phrase and Opus on the march, no turn moved.
- **Known jumps at the cuts.** GPT-6 Sol, GPT-6 Astra and both GPT 6.2 builds play at a fixed velocity, so the score's piano bars sound at their forte level. Where a fixed-velocity turn hands a piano phrase to a velocity-sensitive one, or the other way round, the cut jumps even though the score doesn't. These are measured as short-term loudness over 1 s either side of the downbeat:
  - GPT 6.2 Sol (bars 161–168, ending piano) into Opus (169, piano) drops about 10 dB, even with the nudge (about 13 dB without it).
  - GPT 6.1 Sol's soft ending into Sonnet rises about 6 dB, against about 8 dB into GPT 6.2 Sol in round 4.
  - Score-shaped trims would give a fixed-velocity piano dynamics it doesn't have, and round 4 found they make other cuts jump, so the jumps are left as the pianos play them.
- **Same piano, same reverb.** Every model plays its acoustic grand with every other effect off, and its reverb is matched to Opus 5.5's own default by measurement, not by knob value (see [Reverb parity](#reverb-parity)). GPT-6 Sol is the exception: its reverb produces no real tail, so it plays dry.
- **End card art.** `assets/stagebench-keyboard.svg` is the StageBench keyboard from wustep.me, vendored from `github.com/wustep/me` (`components/AboutPage.tsx` `StageBenchArt` for the geometry, `AboutPage.module.css` `.stagebench` for the colours). It uses the light-theme colours, which are the site's default: `--sb-body #c4202f`, not dark mode's duller `#b31c2a`. It's static, in its idle pose, without the site's card or hover animation.
  - **Shadow.** The site's `drop-shadow(0 2px 5px rgba(0, 0, 0, 0.18))` comes from the show's `endCard.imageFilter`, scaled with the art.
  - **Scale.** Compose draws it as a vector at 8× its 132×50 site size (1056×400), at an even position. At 8× every quarter-unit coordinate of the art (key edges, keybed, screen) lands on a whole pixel, so those edges are exact rather than anti-aliased. In the keybed, 0.5% of pixels are blends (the rounded corners), against 5.3% at round 2's 640 px, a 4.85× scale.
  - **Edges and red in the video.** The frame is converted to 4:2:0 once, with an area filter (see Encode under house style), so the red/black edge is one pixel wide in a browser-style bilinear decode. Rounds 2–3 converted each layer separately and smeared it over 3–4 px, with a chroma overshoot. The red plays as `#c3202e` in Chrome and `#c2202e` in Safari/WebKit against the site's `#c4202f`; `#c3202e` is the nearest value 8-bit BT.709 video can carry.
  - **Comparison.** `scripts/site-compare.mjs` screenshots the live site card at the same scale and puts it beside a frame of the film.
- **Intro photo.** `assets/nord-stage-4-on-black.png` (1922×624) is the Nord Stage 4 product photo from wustep.me, keyed off its white studio background onto black by `scripts/key-photo.mjs --width 1920`. Compose scales it down so it lands on the first model's chassis.
  - **Source.** The 11600×3866 source (`nord-stage-4-wustep-me.png`, ~19 MB) is kept out of git. To regenerate the asset, put the source in `recording/` and run the script.
  - **Keying.** The script flood-fills the background from the border, so the light-gray white keys are never touched. It unmixes the edge pixels against the nearest solid colour, which leaves no white fringe or gray matte, then reports a fringe count.

### Placeholders

A show model is a placeholder slot when it has no run record (not in `src/data/runs.json` and no `runs/<id>/run.json`) or, with local previews, no `public/previews/<id>/stage<N>/index.html`. A placeholder never stops the show:

- `--plan` marks it `[placeholder: <reason>]`;
- `make.mjs` skips it when recording;
- compose keeps its bars and timing, showing a black frame with its label (the NEW pill, "not yet ranked on StageBench" and the name from `placeholderLabels`) and a centered "Take pending" line in the caption's subtitle style;
- its audio is silent, and it's left out of the leveling.

Every other turn is unaffected. `qa.mjs` lists placeholder slots but has no take to check for them.

### Dropping in GPT 6.2 Sol and Astra (protocol 3)

`gpt-6-2-sol-p3` and `gpt-6-2-astra-p3` were placeholders until their stage-3 previews existed.
- **Filmed:** both were filmed on 2026-11-18 from their grading checkouts through `STAGEBENCH_EXTRA_CHECKOUTS`, with fixtures in `models.json`.
- **Published:** both runs were published the same day (#51), and this branch was rebased onto that, so their runs, previews and ranks now come from this checkout. The variable is no longer needed.
- **Missing runs:** if a show model's run or preview goes missing while a take exists for it, compose stops with an error rather than filming it as a placeholder.
- **Stage:** they're filmed at stage 3 like everyone else; there's no fallback to an earlier stage.

Once a run has a sealed stage 3:

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
- **Cuts:** hard picture cuts on the frame at or before each downbeat, or up to `cutSlack` frames off it.
- **Audio switches:** 30 ms equal-power crossfade ending exactly on the downbeat, with no fades.
- **Encode:** H.264 High CRF 16, AAC 256 kbps at 48 kHz. Gentle block leveling, then −14 LUFS through a −1.7 dBFS lookahead limiter.
  - **Picture.** Every layer (takes, labels, caption, cards) is composited in RGB and converted to video once: yuv420p, limited range, BT.709 matrix and primaries, and the sRGB transfer, all tagged. The 4:2:0 chroma uses an area filter.
  - **Why the sRGB transfer tag.** Every source is sRGB, so colour-managed players show the frames as rendered. A BT.709 transfer tag plays a few steps bright in both Chrome and Safari. Round 3's untagged full-range BT.601 file played its reds visibly off in Chrome (end card `#d0312d`).
  - **Limiter load.** The report's `limiter` is the gain reduction the limiter actually applied: premaster with make-up against the master, at the stereo peak, in 10 ms blocks. Rounds 1–3 estimated it from a mono fold-down. That overstated it for correlated pianos ("Fable 31%", really at most 0.4 dB) and missed the wide ones (GPT-6 Sol, really up to 2.9 dB).
- **Type:** SF Pro via `-apple-system`. Compose checks which platform fonts actually rendered, records them in the report (`fonts`), and fails if a non-house face shows up. The one exception is the end card's title.
- **Cards (intro, end card):** the image on black, with no box or frame around anything.
  - **Type.** The title is Crimson Pro at 76 px, weight 500, in warm white (`#f6eee2`). The rest is SF Pro: the subtitle at 32 px in 70% white, the date at 21 px caps in 50% white, and the link at 30 px in 64% white. Round 4 raised these from 58/26/18/22 px so the cards hold up at phone size and the film's title isn't smaller than a model's name.
  - **Intro.** The image covers the first model's chassis. The title and subtitle sit 64 px above that chassis and the date 52 px below it.
  - **End card.** Art and type are one group centered on the frame, with 64 px between the art and the title.
  - **Fades.** The image fades in first, then the type.
  - **Font checks.** Crimson Pro is wustep.me's heading serif (SIL OFL), vendored in `assets/fonts/` with its license. Compose fails if a card title doesn't render in it, and records each card's faces in the report (`intro.fonts`, `endCard.fonts`).
  - **Banned faces.** Inter, Instrument Serif, Fraunces, Bricolage Grotesque, Space Grotesk, Sora, Young Serif, Bodoni, Geist and Syne are never used.
- **Into the end card:** a dissolve of whole frames (`endCard.crossfade`), with the audio fading out under it. Out of a framed intro: optionally the same (`intro.crossfade`).

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
2. Read the report's controls list and add a fixture to `models.json`. It should give just the grand on Piano A: organ, synth, Piano B, unison and mod effects off. Turn reverb on only if the tail test shows a real tail, then match it to the reference with `scripts/reverb.mjs` (see [Reverb parity](#reverb-parity)).
3. Run `scripts/latency.mjs --model <id>`. Output latency should be steady, with a spread under about 20 ms, because prep aligns each take on its first note.
4. Record the model alone: `make.mjs --models <id>`. Check its `meta.json` for `setup`, `miss` and `schedLateMs`, and look at `still.png`.

## Setup steps (models.json, run by `scripts/lib/setup.mjs`)

- `pressIfOff: <selector>` clicks if `aria-pressed` isn't `true`.
- `pressOffIfOn: <selector>` clicks if `aria-pressed` is `true`.
- `select: [<selector>, <option label>]` chooses an option.
- `cycleTo: [<selector>, <label regex>]` clicks a cycling button until its `aria-label` (plus its `title`, where a preview keeps the state there) matches. The log says `NOT REACHED` if it never does.
- `setValue: [<selector>, <target>, <regex?>]` steps a slider or knob with the arrow keys to a target, such as a reverb amount.
- `click: <selector>` clicks once, for cycle buttons with no readable state. Verify it with `abtest.mjs`.

**Target sound: just the grand plus the same reverb.** Every other effect is off, and pinned off where the preview ships the switch. Reverb is on only where the tail test shows it works, and matched by measurement (next section). Some previews render toggles as cycle buttons whose `aria-pressed` is always `true`, such as Kimi's Piano Unison, Dyn Comp and Timbre. `pressIfOff`/`pressOffIfOn` would toggle those blindly: the old Kimi fixture's "unison off" step actually switched unison **on**. A/B any step with `scripts/abtest.mjs` before trusting it.

## Reverb parity

The same knob value is not the same sound. At dry/wet 3.5 of 10, Fable 5.2's reverb was still 16 dB over Opus 5.5's one second after the keys lifted. GPT 6.1 Sol's Room at 0.35 was almost dry. So the fixtures match what the reverb sounds like:

```sh
node scripts/reverb.mjs --show shows/<name>.json                       # every filmable model, with its fixture
node scripts/reverb.mjs --show shows/<name>.json --model <id> --steps '[{"setValue":["[aria-label=\"Reverb Dry/Wet\"]",1]}]'   # try a value
```

The test plays one staccato C-major chord (C3–G4, velocity 80, 150 ms) and records the page's own output. It reports:
- the chord's level;
- the tail's level 0.1, 0.3, 0.6, 1, 1.5 and 2 s after release, relative to the chord's peak;
- the times to −40 and −60 dB;
- the wet energy over the first second and over the whole tail, relative to the chord;
- the mismatch against the reference: the RMS dB difference of the tail out to 1.5 s, and the wet-1 s difference.

The reference is Opus 5.5's own default: Hall at 35%. Each model gets the reverb type and amount it ships that comes closest, and its fixture's `audit` records the numbers. The level itself needs no matching here, because prep sets every take to the same loudness on the same reference bars.

| Model | Setting | Tail RMS vs reference | Notes |
|---|---|---|---|
| Opus 5.5 | Hall, 35% (default) | reference | −14.5 / −22.6 / −32.6 dB at 0.3 / 0.6 / 1 s, −60 dB at 2.1 s |
| Sonnet 5.5 | Hall, 3.5 / 10 | ~3 dB | already the same type |
| GPT 6.1 Sol | Stage, 45 | 3.7 dB | Room at 35 was nearly dry; Hall at 45 rings longer (5.0 dB) |
| GPT-6 Astra | Hall, 50% | 4.2 dB | Room at 30% was short; the reverb lowers its dry level ~5 dB, which the level match absorbs |
| GPT 6.2 Sol | Hall, dry/wet 5 (50%) | 1.5 dB | Ships bypassed as Spring at 60%, which is short. Hall 5's tail reaches −60 dB at 2.1 s, like the reference; Hall 4 is 2.4 dB off, and Stage and Room die within 1 s. |
| GPT 6.2 Astra | Stage, mix 60 | 1.5 dB | Ships off as Room at 45%, gone by 1 s. Its Hall rings longer than the reference (4.0–7.9 dB); Stage 55 is 1.9 dB off. |
| Fable 5.2 | 1.0 / 10 | 7.3 dB | Its type button is decorative and its one impulse decays about 3× slower than the Hall, so it can only be turned down. 1.0 is the best fit (0.5: 9.2, 1.5: 7.9, 2.0: 9.4): 7–9 dB drier early, 5–10 dB longer late. The old 3.5 was 16–33 dB over from 1 s on. |
| GPT-6 Sol | dry | n/a | Its reverb makes no real tail, even as Hall at Amount 80: 25–30 dB under the reference, and it cuts the dry level up to 14 dB. |

## Hard-won details

- **Slow engines.** Kimi K3 builds each note on first use: about 90 ms of main-thread work per pitch and almost per exact velocity. The pre-warm handles the pitch cost, but humanized velocities still miss the cache and fall seconds behind. `quantizeVelocity: 8` snaps them to 8 levels. That choice is disclosed and was Stephen's call. The probe flags this pattern.
- **Renderer crashes.** A key-up in the same tick as its key-down crashed Fable 5's renderer within about 100 presses, so the recorder always holds notes. Fable 5 also crashes intermittently in dense passages: its octave-hit reference pass crashed 2 of 3 times. The recorder exits with code 2 on a page crash rather than hanging, and `make.mjs` retries such a take twice.
- **Fixed-width layouts.** Sol (1500 px), Luna (1600 px) and Kimi (1400 px) get a smaller CSS viewport and a higher DPR. They render natively at about 2400 device px instead of being upscaled.
- **Keybed ranges.** A Stage 4 73 is E1–E7 (MIDI 28–100), and notes outside it are skipped. Luna Max's keybed is labeled E2–D♯8, so it also skips E1–D♯2. That's part of its recreation, so it's left alone.
- **Sample failures.** A sample-based engine can degrade without failing the page. `record.mjs` fails a take, which `make.mjs` retries, in three cases (four with `failOnMiss`, a missed note): a request fails at the network level, a response is HTTP ≥ 400, or the page shows "sample error" text, such as GPT-6 Sol's OLED reading "SAMPLE ERROR · FALLBACK". GPT-6 Astra's "Grand synthesis fallback" is the name of its only piano model, not an error, so the check doesn't match it.
- **Serving local previews.** Plain `python3 -m http.server` listens with a backlog of 5. GPT-6 Sol fetches its 56 samples in one burst, so some connections were reset, and its engine fell back to synthesis (its OLED reads "SAMPLE ERROR · FALLBACK"). Sample-based engines can degrade like this without failing the page. `scripts/lib/serve.mjs` runs the same handler on a threaded server with a 256-deep backlog. `record.mjs` also fails a take, which `make.mjs` retries, if any request fails at the network level, and it records `failedRequests` in `meta.json`.
- **Self-scaling instruments.** Fable 5.2 lays its panel out at 9013 px and scales `#instrument` with its own inline `transform`, which the recorder's centering would clear. A fixture can name the root to center instead (`"instrument": ".instrument-frame"`).
- **ffmpeg `apad`.** A bare `apad` pads forever; it once wrote about 1 TB. Always use `apad=whole_dur=…` plus an output `-t`.
- **Keys in the picture.** They show the written note lengths, so they lift like fingers while the baked pedal in the audio keeps the sound ringing. Both MIDI files must share onsets, pitches and velocities; `record.mjs` checks this.
