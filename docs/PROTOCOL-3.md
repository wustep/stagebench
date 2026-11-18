# Protocol 3.0

Protocol 3 changes the conditions a candidate works under and the rules a run is held to. It does not change what is asked (the task and its three phases) or how it is scored (the rubric stays at 2.0.0).

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
| Grader | On the host, in a path containing the checkout name, with a handle derivable from the run id, reading whatever the candidate left for it. | In a box that holds only the blind workspace. Neutral path, keyed handle, agent instruction files and producer names removed from its copy. |
| Gallery | Score and harness. | Also protocol version, isolation mode, and footnotes. |

Runs made under protocol 2.0 and earlier keep their scores and their labels. They are not held to any of this retroactively: every new rule binds by the protocol version recorded in a run when it was created. The gallery ranks protocol 2.0 and 3.0 runs in separate tiers even though the rubric is the same, because the conditions were not.

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

Recorded but not blocking: agent instruction files in the artifact, assets byte-identical to another run's, decoys read, audio embedded as data URIs, a build that opens in quirks mode.

## 4. Operator messages

An operator does not write to a boxed agent. They pick a template, and the launcher fills it in:

| `--message` | When | What is sent |
| --- | --- | --- |
| (first launch) | Start of a phase | The fixed initial prompt. |
| `continue` | The session ended early (timeout, crash, usage limit) | "Continue… finish the phase as WORKSPACE.md describes." |
| `seal-failure` | The seal failed | The seal's own output, verbatim, taken from the harness's record of the failure, with host paths and the run's name removed. The operator cannot edit it. |

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
- **The seal record the grader sees** has no isolation record, no operator messages, no host paths, and no pointer to whatever gave a producer away. It keeps gates, contract, evidence, and where the samples came from.
- **The grader runs in a box**: `pnpm bench evaluator <run> --phase N --harness claude`. Its only volumes are the blind workspace (artifact, build, and inputs read-only; the assessment and a scratch directory writable); its only network is its own model API. The rubric pins the model. Panel members get separate boxes and each starts from the blank template. Its transcripts and its gateway's record are archived when the score is registered.

## 7. Docker and Podman

The lockdown used one Podman-only feature: overlay volume mounts, to give each seal gate a tree whose writes were discarded. On Docker the gates shared one writable tree. Protocol 3 does not use it on either engine. Each gate starts by copying the installed tree into a volume of its own, made for that container and removed with it; the copy is made by the image's `cp` before any candidate code runs. It costs a few seconds per gate and is exactly the same on both.

The second wall (can the engine's VM see the operator's disk?) is now asked the same way of every engine: try to bind-mount the operator's home directory into a throwaway container. A session refuses to open if that works. Podman's default machine and Docker Desktop both share `/Users`; `pnpm bench lockdown-setup` creates a Podman machine that does not. Docker Desktop has no supported way to stop sharing the home directory, so on macOS use the dedicated Podman machine or point `STAGEBENCH_CONTAINER_RUNTIME` at an engine on another host. Docker itself was not installed on the machine this was built on; the Docker path is the same code and was not exercised.

## 8. ChatGPT login

Under #47 as first proposed, a Codex run on a ChatGPT login put a copy of `auth.json` in the box: no refresh token, but a working access token. Now the box gets token-shaped stand-ins. Each JWT keeps its header and the claims a client reads (expiry, issuer, scopes, plan) with every personal identifier replaced and a random signature; the provider would reject it. The gateway swaps the real access token in, in the `Authorization` header, on the way to `chatgpt.com` and nowhere else. The refresh token and id token never leave the host.

One identifier remains: the account id. Codex checks it against the provider's own account list before it sends a turn, and fails with "selected workspace missing from routing discovery" if it is made up. It authenticates nothing without the token. The provider's account endpoints also return the account's name and plan to the client, as they did before.

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
pnpm bench agent <run-id> --harness codex --model <model> --effort high
pnpm bench seal <run-id> --cost-usd … --input-tokens …
#   if the seal fails:  pnpm bench agent <run-id> --harness codex --message seal-failure   then seal again
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
