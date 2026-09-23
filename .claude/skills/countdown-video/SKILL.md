---
name: countdown-video
description: >-
  Make a feed-ready StageBench countdown video: previews play one continuous song on their own
  keybeds, one keyboard at a time, counting down the StageBench ranking to #1, in the fixed house
  style of recording/ (1920x1080, name + "#N on StageBench" top-left, caption top-right). Use when
  the user asks for a countdown / Twitter / feed video of Stagebench models playing a song, wants to
  remake the Glass Étude countdown with different models, song or length, or wants to add a model
  or song to recording/. For side-by-side or full-segment comparison videos use bench-video.
---

# countdown-video

The pipeline, fixtures and docs live in `recording/`. Read `recording/README.md` first: it has the levers, the house style and the hard-won capture details. This skill covers how to drive it.

## 1. Pin down the levers

Start from `recording/shows/etude6-countdown.json` and copy it to `recording/shows/<new-name>.json`. Ask about any of these the user hasn't settled, in one `AskUserQuestion`:

- **Song.** Pick a folder under `recording/songs/`. For a new song, see step 4.
- **Models and order.**
  - Build the options from the repo, not from memory: `node -e 'for (const d of require("fs").readdirSync("runs")) { try { const r = require("./runs/"+d+"/run.json"); if (r.evaluation?.score) console.log(d, r.title, r.evaluation.score) } catch {} }'`.
  - `"order": "countdown"` goes from lowest rank to #1. Ranks and labels come from `runs/<id>/run.json`, so the video always shows the repo's current leaderboard.
- **Length.** Set `startBar`, `barsPerModel` and `last`.
  - Cut on the song's grid (`song.json` → `grid`); one cycle per model is about 7 s for the Étude.
  - Start on strong material (`song.json` → `sections`).
  - End with #1 on strong material or on the song's real ending (`"last": "to-end"`).
  - For Twitter, 45–90 s is the target.
- **Caption and date.** Set `caption.title`, `caption.subtitle` and `caption.date`. Use today's date unless told otherwise.

Keep the house style exactly as it is: fonts, sizes, positions, colors, 1920x1080, −14 LUFS, and no ring or "Now playing" tag. Change it only if the user explicitly asks for a style change.

## 2. Plan, then check every model has a fixture

```sh
export PATH="$(ls -d $HOME/.nvm/versions/node/v24.*/bin | sort -V | tail -1):$PATH"   # Node 24
pnpm -C recording install && pnpm -C recording exec playwright install chromium
cd recording && node scripts/make.mjs --show shows/<name>.json --plan
```

`--plan` prints each model's bars and seconds and the total length. Show it to the user before recording anything long.

If a model has no entry in `models.json`, the loader warns. Probe it with `node scripts/probe.mjs --model <id>` and write a fixture:

- **Just the grand plus basic reverb.** Piano A only; organ, synth, Piano B, unison and mod effects off. Use only controls the preview ships. Confirm with `scripts/audit.mjs`, and use `scripts/abtest.mjs` to prove a control really changes the sound. Some cycle buttons always report `aria-pressed=true`, so a blind toggle can switch things **on**.
- **Reverb.** Turn it on only when the probe's tail test shows a real tail. Set it to about 35% dry/wet with a `setValue` step.
- **Fixed-width layouts.** Use the suggested viewport, which gets a higher DPR instead of upscaling.
- **Flagged key cost.** If the probe flags a high key cost (a note built per velocity), `quantizeVelocity` may be needed. That changes the input, so **ask the user** first and disclose it.
- **Record the reasoning.** Put what you found in the fixture's `audit` string.

## 3. Record, compose, QA

```sh
node scripts/make.mjs --show shows/<name>.json          # ~2-3 min per model, serial; leave the machine idle
node scripts/qa.mjs --show shows/<name>.json            # contact sheet + timing/level checks
```

Run long jobs in the background and wait on the process. A stalled preview shows up as a model with no progress for minutes at 0% CPU.

`record.mjs` exits instead of hanging in these cases:
- the page crashed
- no instrument was found
- the p95 scheduling lateness was over 50 ms

Diagnose the cause (see README "Hard-won details"). Don't paper over it in the capture.

**QA checklist.** Look at the contact sheet image yourself, and check that:
- each frame shows one keyboard with no page chrome, and the right name, rank and caption;
- the first note is within about 10 ms of plan;
- no cut shows a gap (a big dip) or a double hit;
- the tail has decayed below about −50 dB;
- the misses and lateness in the report make sense. Notes below a keybed's range are skipped by design; name them.

Also run `node scripts/latency.mjs --show …`. Each model's latency spread should stay under about 20 ms, so first-note alignment holds for the whole turn. Report the leveling nudges (in `output/<show>.report.json`) and the limiter load per model. If the user says a part is too quiet or too loud, adjust the show's `leveling` gently; don't flatten the song. Velocity-sensitive pianos (Opus 5.5) take the most limiting at −14 LUFS.

You can't listen to the result. Tell the user to watch it with sound before posting.

## 4. Adding a song

Create `recording/songs/<song>/` containing:
- **`song.json`:** `title`, `audioMidi`, `visualMidi`, `beatsPerBar`, `grid` (`bars`, `firstBar`), `sections`, `levelReferenceBars` and `rights`.
- **The audio MIDI,** with sustain baked into note lengths. The keybed has no pedal, so a CC64-only file sounds dry.
- **The visual MIDI,** with written note lengths but the same onsets, pitches and velocities. It can be the same file if there's no pedal. `record.mjs` checks that the two match.

Find the grid from the music: phrase or harmonic cycles, and loud sections. Print per-bar note counts and velocities to see the structure. Check the key range against the models' keybeds, because a Stage 73 is E1–E7.

Copyrighted MIDI: ask before committing it to the repo, which is public.

## 5. Deliver

- The video is `recording/output/<name>.mp4`; the report sits next to it.
- `open` the output folder, then give the absolute path and the duration.
- Summarize the timeline and any fairness caveats: skipped notes, quantized velocity, models whose reverb or velocity doesn't work.
- Commit the show config, any new fixtures and the video on a branch, and open a PR if asked. Don't merge it.
