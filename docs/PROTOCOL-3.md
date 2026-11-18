# Protocol 3.0

Protocol 3 changes the conditions a candidate works under and the rules a run is held to. It does not change what is asked (the task and its three phases). It comes with rubric 3.0.0, which scores sound from measurements the harness takes rather than from what a grader says it heard (section 9); runs created before rubric 3.0.0 keep rubric 2.0.0.

It exists because of three audits of the runs made under protocols 1 and 2. Candidates read the rubric and the harness, copied finished sample banks from a neighbouring project and from another model's published run, and derived code from the showcase. Graders were shown run ids. Two leaderboard scores rested on artifacts an operator had edited after sealing. Seal gates passed test suites that had skipped themselves. Most runs can no longer be audited because nobody kept the transcript. None of that needed bad faith; the protocol allowed all of it.

Protocol 3 is built on the [lockdown](./LOCKDOWN.md) (a container with none of the operator's filesystem). This document is what the protocol adds on top, and the changelog from 2.0.

## What changed from 2.0

| | Protocol 2.0 | Protocol 3.0 |
| --- | --- | --- |
| Where a candidate runs | On the operator's machine, inside whatever sandbox its harness has. | In the lockdown: none of the operator's disk, in the container or in the VM under it. |
| Internet | Per harness. Usually web search; shell network off or on. | None. The only egress is the harness's own model API, through a gateway: exact endpoints, hosted tools (web search, remote MCP, code interpreters) removed. |
| Packages | The npm registry. | A fixed, hashed mirror baked into the image and served on loopback inside the box: 484 packages, 416 tarballs, 229 MB. Nothing is fetched at run time. |
| Browser | Whatever Playwright downloads. | Chromium for the one Playwright version the mirror carries, in the image. |
| Recorded samples | Whatever the candidate can find and download. | One shared pack of raw, permissively licensed recordings in `inputs/samples/`. Every bundled audio file is declared and checked against it. |
| Capture harness | "Use the parent capture harness" (not shipped). | Shipped in `inputs/harness/`. Nothing a candidate is given points at the repository. |
| Hard gates in the plan | Checked word for word; candidates paraphrased; operators pasted the text in. | Shipped ready to paste in `inputs/hard-gates.md`. |
| Seal gates | On the host, with the registry. | In a box with no network. Each gate runs on its own copy of the tree. |
| Feature tests | A feature passes if its test file exists. | A feature passes only if the seal's own test run executed one of its tests and it passed. |
| Canonical capture | Host browser, with network. | The image's Chromium, in a box with no network. |
| Operator messages | Free text, unrecorded. | Fixed templates, recorded with their text. |
| Transcripts | Archived if found. | Required: no transcript, no seal. |
| Sealed evidence | Edited and re-digested twice. | Append-only seal ledger; a sealed phase cannot be sealed again; a patch is a new, labelled run. |
| Grader | On the host, in a path containing the checkout name, with a handle derivable from the run id, reading whatever the candidate left for it. | In a box that holds only the blind workspace. Neutral path, keyed handle, agent instruction files and producer names removed from its copy, an allowlisted seal record, and a guard that refuses to grade if any input names a model (grader blinding 2). |
| Seal-failure relays | As many as the operator liked. | At most two per phase; then a failing seal seals the phase as it stands, marked failed (section 11). |
| Budget | None. Effort and time were whatever the operator chose. | Pinned effort (`high`), 180 minutes of agent time and 4,000,000 generated tokens per phase, enforced by the launcher and the gateway (section 12). |
| Tokens and cost | Typed in by the operator, when at all. | Read from the gateway's log and priced with a pinned, dated table; typed figures are kept apart as operator-entered (section 12). |
| Model identity | Run ids in prompts and paths. | No model or run id anywhere the candidate can see but the harness's own config; a red-team probe checks (section 13). |
| Sound | Rated by a grader who cannot listen. | Measured by the harness from fixed test notes (section 9); every sound criterion reachable from the pack (section 10). |
| Grader | The model the assessment says. | Also the model id the provider served and its request ids, in the ledger; drift from the pin is flagged (section 14). |
| Gallery | Score and harness. | Also protocol version, isolation mode, footnotes, gateway tokens and cost, budget, seal-failure rounds, and measured audio. |

Runs made under protocol 2.0 and earlier keep their scores and their labels. They are not held to any of this retroactively: every new rule binds by the protocol version recorded in a run when it was created, the rules of sections 11 and 12 by the copy a run takes of them at creation, and the rubric by the version recorded at creation. Every run in the repository was created under rubric 2.0.0 and is scored by it. The gallery ranks each rubric on its own board, and within one rubric ranks protocol 2.0 and 3.0 runs in separate tiers, because the conditions were not the same.

## 1. Candidates are offline

A candidate's box is on an internal network with one other member, the gateway, and the gateway has one door: the harness's model API host. Everything that is not an agent (`bench exec`, the seal's gates, canonical capture, the sample check) runs with no network at all.

**Packages.** The candidate image carries an npm mirror: the tarballs named in `bench/lockdown/image/npm-mirror.lock.json`, each pinned by sha512 and size. The image build downloads exactly those and fails on any mismatch. Inside a box, the entrypoint starts a read-only registry on `127.0.0.1:4874` over those files, and `pnpm` is pointed at it. There is no upstream behind it. `pnpm install` on the starter is frozen against it; `pnpm add <name>` works for anything in the list and answers `404` for anything else.

What is in it: everything the starter's lockfile names, plus a reviewed list of extras (`bench/lockdown/offline/packages.json`): Playwright, Vitest add-ons, Testing Library, `node-web-audio-api`, Tone.js and audio decoders, state libraries, ESLint, Prettier, Biome, Tailwind, Sass, and twenty font packages. Of the 27 earlier runs, every one used the starter set; the only other packages any of them declared were `node-web-audio-api`, Playwright, a decoder, four fonts, and (in two runs) npm sample packs, which are deliberately not here. The lock step refuses a tarball that contains audio.

The candidate is told all of this up front: `inputs/OFFLINE.md` lists every package it can install.

Changing the list is a maintainer step with network, `pnpm bench offline-lock`, which re-resolves the list with pnpm (seeded with the starter's lockfile), records the registry's manifest and publish time for every resolved version, downloads and verifies each Linux tarball, and rewrites the lock. The lock is part of the image's content-addressed tag, so a different mirror is visibly a different image, and it is recorded in every seal (`isolation.toolchain`).

**The browser.** The image holds Chromium for Playwright 1.64.1, and the mirror carries only that Playwright. There is no browser download.

**pnpm.** The image runs the pnpm the starter pins (11.7.0), so nothing is fetched to switch versions.

**What this closes.** In #47 as first proposed, the npm registry was a logged read channel: anything published there, sample packs included, could be installed. Now a candidate session's gateway is configured with no mirrors, and a seal refuses a session whose gateway log shows a mirror fetch. The red-team probe asks for packages every way it can think of; see [LOCKDOWN-REDTEAM.md](./LOCKDOWN-REDTEAM.md).

**What is left.** The read-only package mirror in the gateway still exists in the code, for one purpose: re-running, in a box, the gates of a run sealed before protocol 3 (`pnpm bench score --sandbox`), whose lockfile names packages the offline mirror does not have. It is never given to a candidate session.

## 2. One sample pack

Phase 2 requires recorded sample sets for Grand, Upright, and Electric, and Phase 3 builds an organ. Offline, a candidate has nowhere to get recordings, so the benchmark provides them, the same ones for everyone.

| Directory in `inputs/samples/` | Source | Instrument | Recordings | Size | License |
| --- | --- | --- | ---: | ---: | --- |
| `grand/salamander-grand-v3/` | Salamander Grand Piano V3, Alexander Holm | Yamaha C5 grand. FLAC, 48 kHz, 24-bit, stereo | 401 | 357.2 MB | CC BY 3.0 |
| `upright/upright-piano-kw/` | Upright Piano KW, FreePats project | Kawai upright. FLAC, 44.1 kHz, 24-bit, stereo | 66 | 31.3 MB | CC0 1.0 |
| `electric/greg-sullivan-e-pianos/` | Greg Sullivan's E-Pianos | Wurlitzer EP200 (reed), Hohner Pianet T (reed), Yamaha CP80 (electric grand). FLAC, 44.1 kHz, 16-bit, mono | 172 | 20.5 MB | CC BY 3.0 |
| `electric/learman-rhodes-gm/` | Rhodes Mark I, GM version, Jeff Learman (Discord SFZ GM Bank) | 1977 Rhodes Mark I Stage 73 (tine), from the harp output. WAV, 44.1 kHz, 16-bit, mono, looped by the author | 15 | 5.9 MB | CC0 1.0 |
| `organ/vcsl-pipe-organ/` | VCSL Pipe Organ, Simon Dalzell for Versilian Studios | Pipe organ, two registrations. WAV, 44.1 kHz, 16-bit, stereo | 42 | 86.2 MB | CC0 1.0 |

Pack `stagebench-raw-samples@2.0.0`: 696 recordings, 501.1 MB as published, 737 files with each source's own license statement, `README`, and SFZ mapping where it has one. The manifest (`sample-pack/manifest.json`) pins every file to an upstream commit and a sha256. The audio is not in this repository: `pnpm bench fetch` downloads each file from its pinned commit and verifies it, the way the manual is fetched. (Version 1.0.0, which no recorded run used, had the first three sources and six Salamander layers: 579 recordings, 330.4 MB.)

**Raw means raw.** Every file a candidate sees is byte for byte what its author published. Nothing is trimmed, levelled, re-encoded, or mapped to keys. Which notes and dynamics to keep, where a sample starts and ends, how loud it is, what format it ships in, and how it maps across the keybed are the candidate's work, as they were when candidates downloaded these same libraries themselves. Two sources were cut down for size, and nothing else. The Salamander set has sixteen velocity layers and 714 MB; the pack takes eight of them (v1, v2, v3, v4, v7, v10, v13, v16) for all thirty notes, and every auxiliary recording (key releases, string resonance, pedal noise). The first six were every third layer; measured as mean level over seven notes, the step from v1 to v4 was 8.9 dB and every other step 2.5 to 3.4 dB, so the two added layers are v2 and v3, which leave the largest step at 4.6 dB. The VCSL pipe organ contributes its two manual registrations and leaves out its pedal registrations and blower noise. The other three sources are included whole. The Rhodes was shortened and looped by its own author for a General MIDI bank; that is how he published it.

**What was left out.** jRhodes3d and jRhodes3c, which earlier runs used, license their samples CC BY-NC when redistributed in an application; non-commercial is not permissive, so they are not in the pack. The tine piano in the pack is the same author's separate CC0 release, smaller (fifteen roots, one dynamic); the evidence for its license (his own commits and his public statement) is in `sample-pack/LICENSES.md`. No permissively licensed recording of a tonewheel or combo organ was found; FreePats' organs are renders of software synthesizers, and other candidates were non-commercial, unlicensed, or not single notes. Rendered soundfonts and commercial libraries are not raw recordings. The full list is in `LICENSES.md`.

**Organ and synth.** Phase 3's organ and synth are engines, and the specs describe them as such (tonewheels and drawbars, registers, oscillators); a sampled synth mode is optional. The pack now has a real pipe organ, so the organ may be built from those recordings, from synthesis, or from both, and the Pipe models are where the recordings fit; B3, Vox, and Farfisa still have no recordings to draw on. The synth has none either. Whatever is not cut from the pack is declared as generated.

**How the pack is stored.** The operator's copy (`sample-pack/files/`, filled by `pnpm bench fetch`) keeps every FLAC as published: FLAC is already lossless compression, and on this pack zstd saves 0.8% and a maximum-effort FLAC re-encode 5.2%, at the cost of bytes that no longer match what provenance pins. The 57 WAV recordings (the organ and the Rhodes) are stored with their samples coded as FLAC and the bytes around them (RIFF header, and trailing chunks such as loop points) recorded in the manifest, which takes them from 92.1 MB to 23.0 MB; fetch only keeps a stored file that decodes back to the published sha256, and needs the `flac` command for that (without it, the WAV is kept as published). In all, 432.0 MB is stored for 501.1 MB published.

**How the pack reaches a candidate.** `pnpm bench start` puts it in `inputs/samples/` exactly as published: FLACs are cloned from the store, and each WAV is rebuilt from its stored form and checked against its sha256 before it is written. In the lockdown it is one read-only volume, re-hashed inside the engine against the manifest when it is first loaded, and shared by every session.

**What the seal checks.** `IMPLEMENTATION_DETAILS.json` lists every bundled audio file under `audio.files`, as `"origin": "pack"` with the recording it was cut from, or `"origin": "generated"` with what generates it. The seal:

1. finds every audio file in the sealed tree and its build, by extension and by content, and fails on one that is not declared, and on a declaration that points at nothing;
2. fails on a `pack` entry whose `packFile` is not a recording in the manifest;
3. **compares each pack-derived file with the recording it names** (below);
4. fails on a `generated` file that is byte-identical to a pack recording;
5. fails unless each pack source that was used is credited in `audio.sampleSources` with its real license (ready-made entries ship in `inputs/samples/sample-sources.json`).

The comparison decodes both files with ffmpeg, slides the bundled sample along the recording to find where the waveforms line up, and then measures, in twelve frequency bands, whether the two are the same signal there. Trimming, fades, gain, channel mixing, resampling, and lossy encoding leave a cut of a recording matching it at 0.97 to 1.00 (0.83 at worst, for a 24 kbps Opus encode); the threshold is 0.8. Measured on the pack, the same note from another piano scores 0.32, an additive synthesis of that note 0.55, and a neighbouring key's release noise 0.66. The band step matters: as whole waveforms, the upright's A4 and the grand's A4 correlate at 0.80, because one decaying fundamental dominates both.

A file that was pitch-shifted, time-stretched, or layered is no longer a cut of one recording; it is declared `"verifiable": false` with a reason, and that is recorded and shown to the grader. The check cannot tell adjacent velocity layers of one key apart when they are very alike (Salamander's v7 and v10 at A4 score 0.93; a cut of A4 v2 scores 0.89 against v3 and 0.84 against v1); that is a mislabelled layer, not a recording from somewhere else. On the organ and the Rhodes the check separates as it does on the pianos: a cut of an organ note or a Rhodes note scores 0.95 to 0.99 against its own recording, and 0.20 or less against the next root, the other registration, or the grand.

The check runs in a network-less box that holds the pack and a copy of the sealed tree. Its result goes into the verification record (`sampleProvenance`) and, without the producer's identity, to the grader.

## 3. What a seal enforces

A protocol-3 seal fails, with a message written for the candidate, when:

- a package gate fails (`test`, `typecheck`, `lint`, `build`), run in a box with no network, each on its own copy of the tree;
- **a feature's tests did not run.** After the gates, the seal runs the candidate's suite once more with Vitest's JSON reporter and reads which test files executed and what each test did. Every feature in `tests/feature-matrix.json` must map to at least one test file in which a test ran and passed. A suite behind `describe.runIf(process.env.X)` (every test skipped) does not count; neither does a standalone browser script the runner never loads. Both happened: one sealed artifact's `piano.fallback` mapped only to suites that skipped themselves without an environment variable, and another's `regression.chassis` only to a Node script. If per-file results cannot be collected at all, that is a failure, not a pass;
- a hard gate is not in `IMPLEMENTATION_PLAN.md` word for word (the block to paste ships in `inputs/hard-gates.md`);
- a bundled sample is undeclared or does not come from where it says (section 2);
- **the artifact names its producer.** The run id, the model name, or the run title, compared with punctuation and case removed, anywhere in the tree or its build. Candidates are not told their run id, so this is a model signing its work;
- **there is no transcript.** The harness's session files and the launcher's own console logs come out of the box with the candidate tree and are archived (scrubbed, compressed) before the phase is marked sealed. A phase sealed outside the lockdown needs a discovered or named transcript;
- the lockdown's own record is broken: the gateway log's hash chain does not verify, the gateway served anything from a package mirror, a credential or a decoy's token is in the tree or the build;
- the phase was already sealed (section 5).

Recorded but not blocking: agent instruction files in the artifact, assets byte-identical to another run's, decoys read, audio embedded as data URIs, a build that opens in quirks mode, and the harness's audio measurement (section 9), which is evidence, not a gate.

A seal collects every failure the candidate can fix (gates, contract, feature tests, hard gates, samples, producer name, a capture that fails) and reports them together, so one relayed message carries everything that is wrong. Failures that are the operator's to fix (a broken boundary record, the wrong sample pack in the checkout, a missing transcript, a measurement the harness itself could not take) are never relayed to the candidate and never count as a seal-failure round.

## 4. Operator messages

An operator does not write to a boxed agent. They pick a template, and the launcher fills it in:

| `--message` | When | What is sent |
| --- | --- | --- |
| (first launch) | Start of a phase | The fixed initial prompt. |
| `continue` | The session ended early (timeout, crash, usage limit) | "Continue… finish the phase as WORKSPACE.md describes." |
| `seal-failure` | The seal failed | The seal's own output, verbatim, taken from the harness's record of the failure, with host paths, the run's name, and the model's name removed. The operator cannot edit it. At most two per phase in an official run (section 11). |

Every launch is recorded with its template, the hash of what was sent, and (for anything after the first message) the text, in the run's operator log and in the seal's `isolation.operator`. A message outside the templates can still be sent, by saying so: `--off-protocol-message "…"`. The phase is then marked, and the gallery footnotes it. `--interactive` is off-protocol for the same reason: what is typed into a live session is not a template. Evaluators get the same treatment (`evaluate`, `continue`, `review`).

## 5. Sealed evidence is never edited

Two leaderboard rows carried artifacts changed after sealing: one was replaced by an operator-patched sibling under the same run id (its score went from 77.7 to 82), and one had a hand-written evidence file dropped into three sealed stages and its digests re-recorded (59 to 96.3 on Phase 1). Protocol 3 makes each of those something the harness refuses:

- **A ledger.** Every seal and every scoring appends to `runs/<id>/ledger.jsonl`, each line carrying the hash of the one before. `seal` will not seal a phase the ledger already holds, whatever `run.json` has been edited to say.
- **`redigest` cannot launder.** It re-records a digest only when the artifact definition changed (the stage was hashed under an older definition), and writes that to the ledger. A digest recorded under the current definition that no longer matches its tree is reported as `modified` and left alone.
- **`pnpm bench verify-sealed`** re-hashes every sealed stage against `run.json` and the ledger and exits non-zero on a difference. `score` refuses a stage that no longer matches its digest.
- **A patch is a new run.** `pnpm bench fork <run> --to <new-id> --reason "…"` copies the phases before the patch as sealed and reopens the rest, each starting from the source run's sealed artifact for that phase. The operator makes the change and seals; the seal records exactly which files differ (`runs/<new-id>/patches/`), requires that something does, and the fork is graded on its own. It is titled "(operator patch)", carries a footnote naming the source and the reason, and never replaces the original, which keeps its own score.
- Scoring stamps `registeredAt` itself, rather than trusting a hand-entered evaluation time.

This does not stop someone who rewrites the ledger and `run.json` together. Both are in git, where that shows.

## 6. Blind, boxed grading

- **The candidate is not told its run id**, and its working directory is `/workspace`. What it writes into its artifact therefore cannot name the run unless it names itself, which the seal refuses.
- **The grader's path is neutral**: `~/.stagebench/eval/<hash>/<handle>/stage<N>` on the host (no checkout name: a worktree is routinely named after the model run in it), `/workspace` in the box.
- **The handle is keyed** with a secret that never leaves the operator's Stagebench home, so it cannot be worked back to a run id by someone who knows the scheme and can guess model names.
- **The grader's copy is cleaned** after its digest is checked against the seal: agent instruction files (`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.cursor/`, `.mcp.json`, …) are removed, because a harness loads them on its own and in an artifact they are a message from the candidate to the grader; and the producer's name is redacted wherever it appears (this matters for re-evaluating older runs, four of whose graders were shown "Run `<id>`"). The sealed tree is not touched.
- **The seal record the grader sees** is an allowlist of what describes the artifact: gates, contract, feature coverage, evidence, the measured audio, and where the samples came from. Everything else is left out: the isolation record, operator messages, launches, seal attempts, the gateway's usage and cost, the budget and effort, timestamps, the protocol version, and any field the seal adds later. In the text that remains, the run id becomes the blind handle, and host paths, every known model and run name (in any punctuation, slashed vendor prefix included), and timestamps are scrubbed.
- **A guard fails grading closed.** Everything the harness puts in front of the grader (`EVAL.md`, the assessment template, all of `inputs/`) is read back and checked against every model and run name the repository knows: the price table, every run record, and the model ids in this run's own seal record. The one exception is the pinned grader's own id in the rubric, `EVAL.md`, and the template, which is the same for every run. The grader's copies of the artifact and the build are checked for the producer's own names. A hit refuses the workspace (it is removed), the evaluator launch, and the registration. Each workspace is stamped with the grader-blinding version it was built under (`.blinding.json`), a workspace built under an older one is refused, and every evaluation and ledger score entry records the version it was graded under (`blinding`).
- **The grader runs in a box**: `pnpm bench evaluator <run> --phase N --harness claude`. Its only volumes are the blind workspace (artifact, build, and inputs read-only; the assessment and a scratch directory writable); its only network is its own model API. The rubric pins the model. Panel members get separate boxes and each starts from the blank template. Its transcripts and its gateway's record are archived when the score is registered.

## 7. Docker and Podman

The lockdown used one Podman-only feature: overlay volume mounts, to give each seal gate a tree whose writes were discarded. On Docker the gates shared one writable tree. Protocol 3 does not use it on either engine. Each gate starts by copying the installed tree into a volume of its own, made for that container and removed with it; the copy is made by the image's `cp` before any candidate code runs. It costs a few seconds per gate and is exactly the same on both.

The second wall (can the engine's VM see the operator's disk?) is now asked the same way of every engine: try to bind-mount the operator's home directory into a throwaway container. A session refuses to open if that works. Podman's default machine and Docker Desktop both share `/Users`; `pnpm bench lockdown-setup` creates a Podman machine that does not. Docker Desktop has no supported way to stop sharing the home directory, so on macOS use the dedicated Podman machine or point `STAGEBENCH_CONTAINER_RUNTIME` at an engine on another host. Docker itself was not installed on the machine this was built on; the Docker path is the same code and was not exercised.

## 8. ChatGPT login

Under #47 as first proposed, a Codex run on a ChatGPT login put a copy of `auth.json` in the box: no refresh token, but a working access token. Now the box gets token-shaped stand-ins. Each JWT keeps its header and the claims a client reads (expiry, issuer, scopes, plan) with every personal identifier replaced and a random signature; the provider would reject it. The gateway swaps the real access token in, in the `Authorization` header, on the way to `chatgpt.com` and nowhere else. The refresh token and id token never leave the host.

One identifier remains: the account id. Codex checks it against the provider's own account list before it sends a turn, and fails with "selected workspace missing from routing discovery" if it is made up. It authenticates nothing without the token. The provider's account endpoints also return the account's name and plan to the client, as they did before.

## 9. Harness-measured audio (rubric 3.0.0)

Every audio criterion in rubric 2.0.0 was a grader's rating, and a grader is an agent that cannot listen: "the piano sounds musical" was either invented or inferred from the source. Rubric 3.0.0 scores sound from numbers the harness measures itself, at seal, the same way for every run.

**How.** In a box with no network, the image's Chromium loads the sealed build (`dist/`, served on loopback), with two things injected before any app script runs: a stand-in Web MIDI input (the app gets it from `navigator.requestMIDIAccess()`), and a tap that copies whatever the app connects to its audio destination into an AudioWorklet, frame-accurate on the AudioContext's own clock. The harness clicks once at the page's top-left corner (the only interaction it ever makes), waits for the app to listen for MIDI, warms it up until a note sounds, and then plays a fixed plan. Every phase uses the same plan, `stagebench-audio-1`, against the instrument as it loads:

| Test | MIDI (channel 1) | Measures |
| --- | --- | --- |
| tuning | notes 33, 45, 57, 60, 69, 81, 93 (A1–A6 and middle C), velocity 96, held 1.2 s | pitch of each: YIN with no bias toward the expected note picks the octave, then a zero-padded FFT refines it on the lowest strong partial (YIN alone reads a real piano's stretched partials 7–17 cents sharp); the five mid notes 45–81 are scored |
| velocity | note 60 at velocities 16, 32, 48, 64, 80, 96, 112, 127, held 0.6 s | peak 50 ms level of each |
| release | notes 40, 64, 84, velocity 96, held 1.5 s, 3 s of tail | time to fall 30 dB after note-off; a click at note-off |
| sustain | CC64 127, note 64 on at 0.2 s and off at 0.7 s, CC64 0 at 2.2 s | still sounding 0.5 s after note-off; gone 1 s after pedal-up |
| hold | note 52 held 4 s | clicks while held (sample loops) |
| chord | notes 48, 50, 52, 55, 57, 59, 61, 63, 65, 68 at velocity 100, held 2 s | which of the ten tones are present (distinct pitch classes, none on another's 2nd–8th harmonic); clipping |

Across all of it: clicks, from 30 ms after each attack so attacks are never counted (two rules: an isolated second-difference spike ten times the local level, and a hard stop into digital silence, which the first rule alone caught only two-thirds of the time on a bright note; a 5 ms fade trips neither), clipped output, how many audio contexts produced sound, and note-on-to-sound latency on the audio clock (to the 5 ms envelope step).

**What is scored, and the thresholds.**

| Measurement | Full credit | Zero | Why |
| --- | --- | --- | --- |
| `notesSounding` (of the single test notes) | all | — (ratio, squared) | a note that does not sound is the worst failure |
| `tuningErrorCents` (mean over the five mid notes, each capped at 100) | ≤ 10 | ≥ 50 | 10 cents is about the smallest mistuning heard on a complex tone, and inside a real piano's mid-range stretch tuning; 50 is a quarter tone. Playing 44.1 kHz samples at 48 kHz, the classic bug, is 147 |
| `velocityRisingSteps` | 7 of 7 steps up ≥ 0.5 dB | 0 | velocity must change the level at every step |
| `velocityRangeDb` (127 vs 16) | ≥ 15 dB | ≤ 3 dB | the pack's grand spans about 30 dB; a linear gain curve gives 18; under 3 dB is no velocity response |
| `releasesClean` | 3 of 3 | 0 | a release falls 30 dB within 3 s without a click |
| `clicks` | 0 | 5 (20 points each) | |
| `sustainChecksPassed` | 2 of 2 | 0 | holds (no more than 20 dB down 0.5 s after key-off: a sample piano's own decay can be 12 dB in that time, while a damped note falls 30 dB or more in every build measured), and lets go (20 dB down, or inaudible, 1 s after pedal-up) |
| `latencyMs` (median) | ≤ 20 | ≥ 120 | on the audio clock, so a slow box does not count against the app; what it measures is the app's own scheduling |
| `chordTonesHeard` | 10 of 10 | 0 | polyphony and voice allocation |
| `clippedMs` | 0 | ≥ 50 ms | |
| `extraAudioContexts` (with sound) | 0 | 2 (50 points each) | the contract is one AudioContext |

| Rubric 3.0.0 criterion | Weight | Measurements (weight) |
| --- | --- | --- |
| Phase 1 `sound.pianoVoice` | 60 of sound | notesSounding 25, tuning 25, velocityRisingSteps 15, velocityRangeDb 15, releasesClean 10, clicks 10 |
| Phase 1 `playability.sustainPedal` | 15 of playability | sustainChecksPassed 100 |
| Phase 2 `sound.measuredVoice` | 25 of sound | notesSounding 20, tuning 20, velocityRisingSteps 10, velocityRangeDb 10, releasesClean 10, clicks 10, clippedMs 10, extraAudioContexts 10 |
| Phase 3 `sound.qualityUnderLoad` | 25 of sound | latencyMs 25, chordTonesHeard 25, clippedMs 15, clicks 15, notesSounding 10, tuning 10 |

Phase 3 does not score velocity or release: the instrument may load on an organ or a synth patch, which need not respond to velocity.

**When a measurement cannot be taken.** The record says why, and nothing is skipped silently. If the build gave the harness nothing to measure (it never listened for MIDI, never sounded, a test note never sounded, a pitch could not be found), that measurement scores zero; it is never dropped and the rest re-weighted, as a grader's null is. If the harness itself failed (the browser would not start, the box broke), the seal stops with an operator-side error: nothing about the candidate is known, it is not relayed, and it does not count as a seal-failure round.

**Where it goes.** `evidence/stage<N>-audio.json` in the sealed artifact (so its digest covers it, and the grader sees it in `artifact/evidence/`), a summary in the verification record and the run record (the gallery shows tuning, velocity range, clicks, and latency per phase), and its hash in the seal's ledger entry. The candidate is told that the seal plays test notes over Web MIDI and that the app must request MIDI access on load or on the first click anywhere, and sound without any other interaction (`TASK.md`); it is not given the thresholds. That sentence matters: of the seven protocol-2 Phase 1 builds that worked, four requested MIDI only from an "Enable MIDI" button and measure as `no-midi` without it. The record is reproducible: the plan, the browser, and the analysis are fixed, and `pnpm bench seal` on an unlocked run runs the same code with the host's Playwright.

## 10. Rubric 3.0.0: every sound criterion reachable from the pack

Rubric 2.0.0 was written when candidates found their own samples. Read against the pack they now share, it rewarded sounds no candidate can build from recordings, and a few things the specs exclude. Every phase anchor and criterion was read; these changed, and nothing else did (the panel axis, aggregate weights, technical gate, and every criterion not listed are as in 2.0.0, frozen in `bench/rubrics/2.0.0.json`):

| Where | Rubric 2.0.0 | The problem | Rubric 3.0.0 |
| --- | --- | --- | --- |
| Rating anchors 3 and 4 | "a knowledgeable player would not distinguish from the hardware" | For sound, the hardware is the Nord's own multi-sampled library, which nobody has; a one-dynamic Rhodes or a synthesized B3 could never reach 4 | `ratingScale.soundReachability`: "the hardware" means the best the pack and synthesis can do; a rating never requires a recording the pack does not contain; lists the pack's real content |
| All judged sound criteria | Evidence could be "sounds like" | A grader cannot listen | `ratingScale.listening`: evidence is a measurement of rendered audio or a reading of the source |
| P1 `sound.pianoVoice` (60) | judged | a listening claim | harness-measured (section 9) |
| P1 `sound.sourceHonesty` (40) | "verify by exercising the build" | — | also points the grader at the seal's sample check (which file is cut from which recording) |
| P1 `playability.voiceLifecycle` (35) | velocity, sustain, stealing, cleanup | velocity and sustain are measurable | 20: stealing and cleanup only; new harness criterion `sustainPedal` (15) |
| P1 `playability.inputCoverage` | unchanged weight | — | notes that the harness has already confirmed MIDI |
| P2 `sound.instrumentBreadth` (35) | "grand, upright, electric, clavinet and digital are audibly distinct" | judged against the Nord's multi-velocity electric pianos; omitted Misc | 30: measured distinctness of all six types, each judged against what the pack offers (Salamander 8 layers, Kawai 2, Rhodes one dynamic and 15 roots, Wurlitzer 4, Pianet 2, CP80 4); a Rhodes model is not marked down for velocity layers the pack never had, and velocity made with gain and filtering is credited |
| P2 `sound.effectAudibility` (35) | "A/B each one" | a listening instruction | 30: show each effect in the rendered signal (sidebands, delay taps, decay, compression) |
| P2 `sound.signalGraph` (30) | graph, gain staging, no clipping | clipping and extra contexts are measurable | 15: buses and order; new harness criterion `measuredVoice` (25) measures the default voice, clipping, and contexts |
| P2 `playability.pianoControlDepth` | "string resonance, pedal noise, dynamics, timbre and soft release" | pedal noise is excluded by `specs/nord-stage-4.piano.json` | the spec's six controls: KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res |
| P2 `features.instrumentLibraryCoverage` | "every instrument … actually loads" | — | says which may come from the pack and which may be synthesis, and that one model per type is the requirement |
| P3 `sound.distinctEngines` | "genuinely different engines" | graders compared B3/Vox/Farfisa with sampled tonewheels and combo organs, which the pack does not have | B3, Vox, Farfisa and the synth are synthesized and a well-made synthesis is creditable in full; the pipe organ may be pack, synthesis, or both |
| P3 `sound.qualityUnderLoad` (25) | "latency, polyphony and stability while actually playing" | a listening claim | harness-measured: latency, chord tones, clipping, clicks, notes sounding, tuning |
| P3 `features.organSystem` | "drawbars, models, percussion, rotary, vibrato" | the Pipe drawbars name nine ranks, and the pack has two registrations (Loud, Quiet) | B3/Vox/Farf judged as synthesis; Pipe drawbars may mix and filter the two registrations, use synthesized ranks, or both, and are not marked down for per-rank recordings that do not exist |
| P3 `features.synthSystem` | unchanged scope | — | notes there are no synth recordings and a sampled mode is optional |

The candidate's materials say the same (the Phase 2 prompt now asks for "velocity layers where the pack has them"); the sample pack README already said B3, Vox, and Farfisa are to be synthesized.

## 11. Seal-failure rounds

A failing seal's output can be relayed to the agent (`--message seal-failure`). In an official run that happens **at most twice per phase** (`officialRules.sealFailureRounds` in `specs/benchmark-phases.json`, copied into the run at creation; fixed for official runs). What is counted is precise: a round is one relay of a seal failure to the agent. The first seal attempt is not a round, a `continue` is not a round, and a failure that is the operator's to fix (section 3) is never relayed and never counted.

- Seal attempt 1 fails → relay (round 1) → the agent fixes → attempt 2 fails → relay (round 2) → attempt 3.
- Attempt 3 is final. If it passes, the phase is sealed normally. If it fails, **the phase is sealed as it stands, marked failed**: the artifact is frozen and hashed like any other, its failing verification is kept with every failure listed, the preview is published if it built, and the phase is scored (the technical gate caps it, at 59, or 49 with no build). It is never left unsealed. The launcher refuses a third relay.
- The same happens, sooner, when the budget leaves no room for another launch (section 12): a failure could not be fixed, so the failing seal is final.
- An operator can seal a phase as failed early (`seal --as-failed`), for a harness that cannot continue. That is recorded as the operator's decision, and the phase is not official.

The counts (attempts, relays, the limit, how the phase was finalized) are in the verification record (`seal`), the run record, every seal's ledger entry, and the gallery; each failed attempt is also a `seal-attempt` entry in the ledger, with the hash of what failed.

## 12. Budget and gateway telemetry

**Tokens and cost come from the gateway.** Every model call a boxed agent makes goes through the gateway, which logs each response's usage object in its hash-chained log, reduced to its numbers (OpenAI's per-item attribution would otherwise put tens of kilobytes on every line), merged across a streamed response (Anthropic reports input in `message_start` and output in `message_delta`), with the model id the provider says served it, the provider's request id, and the effort the request asked for. At seal the log is summed per model into input tokens (cached and cache writes included), cached input, cache writes, output, reasoning where the provider reports it (OpenAI does, Anthropic counts thinking as output), and cost. Cost uses `bench/prices.json`, one pinned, dated table (USD per million tokens, read 2026-11-17 from OpenAI's and Anthropic's published prices, long-context rates included); the seal records its date and hash, so a later price change never rewrites an earlier run's cost. A subscription login is priced at its API list-price equivalent. A model missing from the table leaves the cost unknown, never zero; a successful turn whose usage could not be read is counted as a gap. These are the official figures; they replace anything typed.

`--cost-usd`, `--input-tokens`, and the other telemetry flags still work, and what they record is labelled **operator-entered, non-official**: for a boxed phase it is kept beside the gateway's figures (`operatorTelemetry`) and never shown as the run's cost; for a phase with no gateway it is all there is, and says so.

**The budget, per phase, fixed for official runs:**

| | Value | Enforced by |
| --- | --- | --- |
| Reasoning effort | `high` | The launcher passes it to the harness (Codex `model_reasoning_effort`, Claude Code `--effort`) when the operator names none; the gateway records the effort every request actually asked for, and the seal checks the run model's requests against it. Asking for another effort marks the phase unofficial. |
| Agent time | 180 minutes, summed over launches | Each launch's timeout is what is left (or the operator's, if shorter). Time between launches (the operator reading a log, a seal running) is not counted. |
| Generated tokens | 4,000,000 (output, reasoning included) | The gateway: once responses have reported that many, it refuses further model requests (`budget.exhausted` in its log). |

Why these. `high` is the effort most protocol-2 runs recorded (ten of thirteen; two ran at `max`); `xhigh` and `max` buy quality with spending, which a fixed budget exists to take out of the comparison. The slowest phase on record took 108 minutes from start to seal, including the operator's time; 180 minutes of agent time is two-thirds more than that, enough for an offline Phase 3 that has to build its own samples, and still a cap a runaway session hits. Generated tokens per phase in the protocol-2 runs that recorded them ran from 26 thousand to 2.3 million; 4 million is room for the most verbose model on the hardest phase, and stops a loop. Input tokens are not capped: an agentic session re-reads its context every turn, so input mostly measures how a harness caches, not how much work was done.

A phase the budget stops is sealed as it stands and is **still official** (`budget.status: stopped`): the budget is a rule everyone runs under. A phase that ran outside it (another effort, more time or tokens than allowed without being stopped) is `exceeded` and **not official**. Every phase's budget record (limits, agent time, generated tokens, status, what stopped it, the efforts launched and observed) is in its verification record, run record, ledger entry, and the gallery. The candidate is told the budget in `WORKSPACE.md`.

**Official.** A phase is an official protocol-3 result when it was boxed under a run that carries the official rules, every operator message was a template, the budget was not exceeded, the effort matched, and the gateway recorded usage. Each sealed phase records `official` with its reasons; the gallery footnotes a phase that is not.

## 13. The candidate is not told which model or run it is

Nothing the launcher puts in front of a candidate names its model or its run: not the prompts or templates (a relayed seal failure has the run's and the model's names removed, in any punctuation), not the working directory (`/workspace`), environment, filenames, hostname (`stagebench`), container names (a hash), git config (none), or the workspace (`workspace.json`, which names the run, never enters the box). The seal still refuses an artifact that names its producer.

The red team checks this. `pnpm bench redteam` now creates a throwaway run with made-up identifiers in a scratch checkout, starts a real phase workspace, opens a real session, writes each harness's home exactly as a launch would, and dumps from inside the box everything a candidate can read: environment, working directory, hostname, `/etc/hosts`, the container's own records, the process table, git config, every file in the workspace and home, and the messages an operator can send. The host searches that for the identifiers. Any hit outside the harness's own configuration and command line fails the red team.

**What cannot be hidden:**

- The model knows what it is from its training and from the system prompt its harness sends. Codex opens with "You are Codex, an agent based on GPT-6" and lists the current model among its subagent overrides; Claude Code tells the model its name and model id. Changing that means changing the harness, which is the unit under test.
- The harness has to send the model id with every request, so it is in the harness's configuration (Codex: `~/.codex/config.toml`) or on its command line (Claude Code: `--model`), both readable inside the box. The probe reports these as known, not as leaks.
- The harness's session files record the model for every turn, and the provider names the model in every response.

What can be configured away is: nothing names the run anywhere a candidate can see, and nothing names the model outside what the harness itself requires.

## 14. The grader's model id

The rubric pins the grader (`evaluator.model`, and `evaluator.pinnedId` for the exact id). Anthropic publishes no dated snapshot of Claude Opus 5: its full model id is `claude-opus-5` itself, so that is the pin (`evaluator.snapshotNote` says so). For a boxed evaluation the gateway records, for every request, the model id it asked for, the id the response says served it, and the provider's `request-id`. Registration writes to the ledger, for every evaluation: the pin, the served ids (`claude-opus-5 -> claude-opus-5: N`, auxiliary calls such as a harness's small-model titles listed separately), the request ids (count, first, last, and a hash of all of them; the full list is in `runs/<id>/lockdown/stage<N>.evaluators.json`), and the harness and its version. A request for the pinned model served as any other id is **drift**: it is printed, recorded in the evaluation and the ledger, and footnoted in the gallery. An evaluation that was not boxed has no gateway, and its record says the model is unverified.

## Running an official run

One-time, per machine:

```sh
brew install podman
pnpm bench lockdown-setup     # dedicated VM, both images (mirror and Chromium inside), self-tests
pnpm bench fetch              # manual, photos, and the sample pack, each file verified
pnpm bench redteam            # expect every attempt blocked
```

A run:

```sh
pnpm bench new --model <id> --target <1|2|3>                    # protocol 3, lockdown
# per phase:
pnpm bench start <run-id>
pnpm bench agent <run-id> --harness codex --model <model>       # effort is pinned (high); the budget clamps the timeout
pnpm bench seal <run-id>                                        # tokens and cost come from the gateway log
#   if the seal fails:  pnpm bench agent <run-id> --harness codex --message seal-failure   then seal again
#   (twice at most; after that, or once the budget is spent, a failing seal seals the phase as failed)
pnpm bench score <run-id>                                       # builds the blind workspace
pnpm bench evaluator <run-id> --harness claude                  # the grader, in its own box
pnpm bench score <run-id>                                       # registers the assessment
# at the end:
pnpm bench thumbs <run-id>
pnpm bench verify-sealed <run-id>
```

Credentials are as in [LOCKDOWN.md](./LOCKDOWN.md): an API key or Claude subscription token held by the gateway, or a ChatGPT login (section 8).

Opting out is possible and visible: `--isolation none` at `new`, or `seal --unlocked`, records `isolation: none` and footnotes the run as not an official protocol 3 result. For a Codex run made that way, `scripts/bench-candidate-codex` applies the read-restricted `candidate-isolated` profile from `fix/candidate-isolation` (`scripts/verify-candidate-sandbox.sh` checks it); it restricts reads to the workspace and is a fallback, not the lockdown.

## What is still open

- **Claude Code in the box has not run a turn.** The adapter is verified up to authentication. This machine has only a Keychain login, which the launcher does not read; a boxed Claude candidate or evaluator needs `STAGEBENCH_CLAUDE_OAUTH_TOKEN` (`claude setup-token`) or an API key. Until that is run once, the boxed evaluator is verified for its box, mounts, export, and message path, with a stand-in harness, and not with the pinned model.
- **Docker was not exercised** (section 7).
- **Existing runs carry no footnotes from the audits.** The gallery shows a note for each protocol generation and for anything a run's own record says (isolation, operator messages, patches). Attaching the audits' per-run findings is `pnpm bench footnote <run> --add "…" --kind audit`, and is a decision about publication, not a mechanism.
- **A deliberate operator can still cheat.** The ledger, the templates, and the gateway log make interventions visible; they are in a repository the operator controls.
- **The acoustic check has limits** (section 2): adjacent velocity layers of one key, and encodes far below 48 kbps.
- **The model API is still a channel.** A candidate can describe anything to its model. That is the normal case, and request bodies are stored.
- **Thumbnails** are still shot by the host's browser. They are gallery art, made after scoring, and are not evidence or grader input.
- **The grader's served model id has not been seen yet.** The mechanism is in place and tested on recorded logs; it needs one boxed Claude evaluation (above) to show what the Anthropic API returns for `claude-opus-5`.
- **The audio measurement covers the instrument as it loads.** It reaches the app only through Web MIDI, the one input the contract makes universal, so it measures the default voice of each phase. Whether the six piano types, the organ models, and the effects are distinct is still judged, from measurements the grader takes.
- **The audio tap lives in the candidate's page.** The stand-in MIDI port and the tap are injected before the app's scripts, but app code could look for them, and a hostile app could feed the tap something other than what it plays. The record keeps the tap's own frame gaps (`environment.tapGapFrames`) and the grader can render the build independently; a page-proof capture would need Chromium's own audio output, which a headless box does not have.
- **Token caps compare generated tokens across tokenizers.** A model whose tokenizer splits text finer spends its budget faster. The agent-time cap is the one that is the same for everyone.

## Changelog

- **3.0.0** (this PR). Offline lockdown, one sample pack, executed feature tests, template-only operator messages, transcripts required, append-only seal ledger, blind boxed grading (sections 1–8). Then, before any official run: at most two seal-failure rounds per phase, after which a failing seal seals the phase as failed (11); a fixed budget per phase, pinned effort `high`, 180 agent minutes, 4,000,000 generated tokens (12); tokens and cost from the gateway log, priced with `bench/prices.json` (12); the candidate not told its model or run, with a red-team identity probe (13); the grader's served model id and request ids in the ledger, with drift flagged (14).
- **Rubric 3.0.0**. Sound scored from harness measurements (9); every sound criterion reachable from the pack (10); the grader pinned to the exact id `claude-opus-5`. Runs created before it keep rubric 2.0.0, and every run in the repository was.
- **Grader blinding 2** (2026-11-18). A fix to what the grader is shown (6); the protocol, the rubric, and how a phase is scored are unchanged. Under grader blinding 1 the grader's copy of the seal record (`inputs/verification.json`) was built from a denylist. It removed the isolation record, the operator patch, and the provenance details, but passed the `usage` and `budget` blocks through unchanged, and it scrubbed only the run id, so a dotted model id (`gpt-6.2-astra`, `gpt-6.2-sol`) survived. **Every phase graded before this version whose seal record has those blocks gave its grader the producing model's id** (`usage.byModel`, with its `priceId`; `usage.efforts`; `usage.responseModels`; `budget.effort.primaryModel`; `budget.effort.observed`), along with the gateway's token and cost figures, so that grading was not fully blind. In the repository those are the six protocol-3 phases of GPT 6.2 Astra and GPT 6.2 Sol, the only seal records with `usage` and `budget` blocks. The protocol-3 audit found no grader output that refers to the model, the vendor, or the cost. The existing scores are left unchanged: no run was regraded, and no run record, evaluation, or ledger was edited. Since this version the record is an allowlist and the guard fails grading closed (6). An evaluation that records `blinding: 2` was graded under it; one that records no blinding version was graded under blinding 1.
