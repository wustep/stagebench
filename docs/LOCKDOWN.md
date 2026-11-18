# Lockdown: a structural boundary for candidate runs

Status: the candidate boundary of [protocol 3](./PROTOCOL-3.md), working on macOS (Apple silicon) with Podman. Codex runs in it end to end, offline; Claude Code is wired and verified up to authentication. Red-team results are in [LOCKDOWN-REDTEAM.md](./LOCKDOWN-REDTEAM.md).

This document is the design of the boundary. What protocol 3 builds on it — offline packages, the sample pack, what a seal enforces, operator templates, the seal ledger, boxed grading — is in [PROTOCOL-3.md](./PROTOCOL-3.md).

## Why

In the GPT 6.2 Astra and Sol runs the operator prompt banned writes outside the workspace and said nothing about reads, and the Codex sandbox allowed reading the whole disk. Both models copied 89 finished piano samples from a neighbouring project, one read a line of `bench/rubric.json` and built its self-check to match, both read harness code, and one harness's MCP tool calls ran outside its sandbox altogether.

A stricter prompt and a stricter Codex profile (the `fix/candidate-isolation` branch) fix that incident. They do not fix the class: every harness has its own sandbox with its own defaults, flags, and gaps, and a prompt is a request. The lockdown replaces "each harness is asked to stay inside" with "there is no outside": the candidate, whichever harness drives it, runs somewhere the rubric, the other runs, the operator's disk, and the internet do not exist.

Two rules follow from the audits, and the design is built to make both structurally true rather than asked for:

1. **A candidate never runs on a host where the StageBench repository or a sibling workspace is readable.** Not "is told not to read it": the machine the candidate's processes run on does not have those files. The box has no mounts, and the VM underneath it has none of the operator's disk either; a session refuses to open if that second part is not true.
2. **Grading is blind all the way down.** Nothing a grader is given names the run. That starts with the candidate, which is no longer told which run it is and so cannot write it into its artifact.

A third rule came with protocol 3, and it is what made the first two cheap to state:

3. **Nothing comes in from the internet.** The first version of this design let a box read the npm registry and a browser CDN through logged mirrors. That was a read channel: sample packs are published on npm. Now packages come from a hashed mirror inside the image, the browser is in the image, and recordings are one shared pack. A candidate's only egress is its own model API.

## Where things stand without it

The harness does not launch candidates. `pnpm bench start` builds a workspace directory under `~/.stagebench/`, and the operator (a person, or an orchestrating agent following the `run-nord-benchmark` skill) starts "a fresh implementation agent whose working directory is that workspace" with whatever harness the run is about. The 27 runs so far used Claude Code (10), Codex (9), Cursor (5), OpenCode (2), and Omp (1). So what a candidate can reach is whatever that harness allows a process running as the operator's user:

- **Files.** The workspace is outside the repository tree, which stops a relative `../..` and nothing else. Every absolute path the operator can read is readable unless the harness's own sandbox says otherwise: the repo (`bench/rubric.json`, `runs/`, `showcase/`), sibling worktrees, `~/.stagebench/*/eval/`, other projects, and the session stores of every earlier run. Codex's default sandbox restricts writes and network, not reads, which is what the GPT 6.2 runs showed. A harness run with its permission prompts bypassed, the usual way to run one unattended, restricts nothing.
- **Network.** Per harness: off for Codex shell commands, on for its built-in web search; on for most others. The repository is public, so any path to the internet is a path to the rubric and to every sealed run.
- **Tools.** MCP servers, skills, and memory configured for the operator's own use are inherited, and MCP servers run outside the harness's sandbox.
- **Seal and score.** `seal` runs the candidate's `pnpm install`, tests, and build on the host, as the operator. `score --sandbox` used Docker with an open bridge network.
- **`pnpm bench exec`** ran a command in Docker with the workspace bind-mounted. It boxed the commands an agent chose to send through it, and Docker was not installed on the machine the official runs used.

## What a candidate can reach in the lockdown

| | In the lockdown |
| --- | --- |
| Operator's filesystem (`~/Projects`, the repo, `~/.stagebench`, `~/.codex*`, `~/.claude*`, other worktrees) | Not mounted. The paths do not exist. |
| `bench/rubric.json`, `eval/` workspaces, other runs, the harness | Not present anywhere in the box. |
| Its own workspace | `WORKSPACE.md` and `inputs/` read-only (the sample pack included); `candidate/` read-write. |
| Internet | No route, no external DNS. |
| Operator's machine over the network (dev servers, the container engine) | No route. |
| Its own model API | Yes, through the gateway: exact paths only, hosted tools removed. This is the only egress there is. |
| npm registry, Playwright browser builds, any other download | No. Packages install from a fixed mirror baked into the image (484 packages, each tarball pinned by sha512) and served on loopback inside the box; Chromium is in the image. |
| Recorded samples | The pack in `inputs/samples/`, and nothing else. |
| The harness's tools: shell, MCP servers, REPLs, subprocesses, sub-agents, nested agents | All run inside the same box. There is no second place for a tool to run. |

## Design

```
 operator's machine                      container engine (a VM with no host directories shared)
┌────────────────────┐   tar stream   ┌──────────────────────────────────────────────────────────┐
│ pnpm bench start   │ ─────────────▶ │  volumes: ws (ro)  cand (rw)  home (rw)  honey (decoys)  │
│ pnpm bench agent   │                │           samples (ro, shared)                           │
│ pnpm bench seal    │ ◀───────────── │  ┌────────────────────┐ internal network ┌────────────┐  │
│                    │   tar stream   │  │ box: harness +     │ (no route out,   │  gateway   │  │
│ runs/<id>/…        │                │  │ every tool it runs │  no ext. DNS)    │  one door, │──┼──▶ model API (exact paths)
│ (never mounted)    │                │  │ uid 1000, no caps  │ ───────────────▶ │ hash-chain │  │
└────────────────────┘                │  │ npm mirror on      │                  │ log        │  │
                                      │  │ loopback, Chromium │                  └────────────┘  │
                                      │  └────────────────────┘                                  │
                                      │  gates · capture · sample check: boxes with NO network   │
                                      └──────────────────────────────────────────────────────────┘
```

**The box.** One container image (`bench/lockdown/image/Containerfile`) holds Node 24, pnpm, Playwright with Chromium, git, ripgrep, Python, ffmpeg, the harness CLIs at pinned versions, and the offline npm mirror with the small loopback registry that serves it (`npm-mirror.mjs`; the entrypoint starts it). The agent runs in it as uid 1000 with every capability dropped, `no-new-privileges`, a read-only root filesystem, and resource limits. The harness's own sandbox is switched off, because the container is the sandbox: this is what makes the boundary the same for every harness, and what puts MCP servers and REPLs inside it rather than beside it.

**No bind mounts.** The workspace is copied into named volumes when the session opens and copied back out at seal, as a tar stream through a throwaway container. Nothing on the operator's disk is ever mounted, so there is no path, relative or absolute, that leads out. Once a session is open the candidate's source lives only in its volume; the host workspace holds a marker file, so there is no directory for an un-boxed agent to work in. A consequence worth having: the engine can be on another machine (`STAGEBENCH_CONTAINER_RUNTIME="podman --connection <remote>"`) with no change to anything else.

**The gateway.** An agent's box sits on an internal network: no default route, no external DNS, no path to the host. The only other member is the gateway (`bench/lockdown/image/gateway.mjs`, one file with no dependencies). For a candidate or an evaluator it is configured with one door, the model API host, and logs every use of it. The code has three kinds of door:

1. *Mirrors.* GET-only reverse proxies to fixed upstream prefixes. **A protocol-3 session is given none**: its gateway answers `404` to every mirror path, and a seal refuses a session whose log shows a mirror fetch. The door remains in the code for one purpose, re-running in a box the gates of a run sealed before protocol 3 (`bench/lockdown/mirrors.json`), whose lockfiles name packages the offline mirror does not carry.
2. *Inspected hosts.* For the model API host, TLS terminates at the gateway under a per-session CA that is name-constrained to that host and trusted only inside the box. Each request is checked, and anything that cannot be checked is refused:
   - the method is `GET`, `HEAD`, or `POST`, and the path, compared exactly as sent, is one of a short list of endpoints (never a prefix; dot segments and encoded separators are refused outright);
   - a body must be a JSON object, and what is forwarded is the gateway's own serialization of what it inspected, not the bytes it was sent;
   - any tool the provider would execute on the internet (web search, web fetch, code interpreters, hosted shells, remote MCP connectors) is removed, wherever the harness declares it, along with the request switches that do the same (`mcp_servers`, `search_parameters`, `web_search_options`);
   - a content block that points the provider at a URL (an image, document, or file by address rather than inline) is refused, because the provider would fetch it;
   - websocket upgrades are refused, and the model can be pinned.

   Request and response bodies are stored.
3. *Tunnels.* An opaque TLS tunnel to an allowlisted host. Nothing inside it can be checked, so no built-in adapter uses it. It exists for harnesses with a proprietary protocol.

Everything else is refused and logged. The log is a hash chain (each line carries the SHA-256 of the one before), and its head is written into the verification record at seal.

**Credentials stay outside.** With an API key or a Claude subscription token, the box is given a random placeholder and the gateway swaps in the real credential, in a credential header only, on the way to the one host it belongs to. The candidate never holds it. A ChatGPT login works the same way with one extra step, because Codex reads and decodes its tokens itself: the box gets an `auth.json` whose JWTs are stand-ins with the same header and non-identifying claims and a random signature, and the gateway swaps the real access token in. The refresh and id tokens never leave the host. The account id, which Codex checks against the provider's own account list and which authenticates nothing, is real.

**Seal runs the candidate's code in the box too, with no network.** `pnpm install`, the tests, and the build are candidate-authored code. Running them on the host at seal would hand a candidate, one step later, everything the box withheld (a test that copies `~/Projects/nordstage4`, a Vite plugin that reads the rubric). For a locked phase the four gates run in fresh containers on `--network none`: there is no gateway, because there is nothing to reach; packages come from the image's mirror. Each gate is its own container, so pass or fail is the process exit status and nothing a script prints can forge it. Each gate also starts from the tree as install left it: before any candidate code runs, the image's own `cp` copies the installed tree into a volume made for that container and removed with it, and the sealed sources are copied over the tree again after install, so one gate cannot rewrite `package.json` or plant a fake `pnpm` for the next. This is plain container behaviour, identical on Docker and Podman (Podman's overlay mounts would be faster and are deliberately not used). `score` reruns the gates the same way.

**Capture and the sample check run there as well.** Canonical screenshots are taken by the image's Chromium, with the image's fonts, of the build served inside a network-less box, so every run is measured by identical bits and a candidate's page cannot reach anything from the capture browser. The acoustic sample check runs in a box that holds the pack and a copy of the sealed tree. The tools' code is written into those boxes from the harness; it is never candidate code.

**What crosses back is treated as data.** The export is measured before it is copied and refused past a size limit. Every symlink and special file is removed and reported: a link that dangles in the box can be live on the host (`public/samples -> ~/Projects/nordstage4/…`), and the next host-side build would follow it. The tree and the built `dist/` are searched, contents and file names, for the session's credential and the decoy token.

**A broken record stops the seal.** A locked phase is not sealed if the session's gateway log is missing or fails its hash chain, if that log shows anything fetched through a package mirror, or if a credential or decoy token is in the tree or the build. (And a session does not open in the first place on an engine whose VM can see the host.)

**Detection, for what prevention cannot show.** Decoy scoring files with a per-session token are mounted at `/srv/stagebench`; seal records whether they were read and whether the token appears in the artifact or the transcript. Every bundled binary asset is hashed and compared against every other run's sealed assets and any library named in `STAGEBENCH_ASSET_LIBRARIES`; a byte-identical match is an advisory finding on the verification record. This check runs on unlocked seals as well, and is the one that would have flagged the 89 copied samples.

**The record.** A locked seal writes `isolation` into `runs/<id>/verifications/stage<N>.json`: engine and image IDs and whether the VM could see the host, the offline toolchain (the mirror lock's digest, pinned versions) and the sample pack's digest, each launch (harness, version, auth mode, whether a usable credential was in the box, MCP servers, the message template and its hash, and the text of any follow-up), what the gateway saw (requests by model, tools stripped, refusals by target, token usage), how the gates were isolated and that they had no network, where capture ran, what was dropped on export, and the honeytoken result. The gateway log is kept at `runs/<id>/lockdown/stage<N>.gateway.jsonl`. Harness session files from inside the box go to the transcript archive from #45, and every `agent` launch is appended to the operator log.

**None of that record reaches the grader.** It names the harness, its version, the model the gateway saw, and the provider's endpoints. The grader's copy of the verification file keeps the gates, the contract, and the evidence, with asset provenance reduced to a count.

### Why this option

It is the only one considered that makes the property independent of the harness. A container is something every agent CLI already runs in; the gateway needs only that a CLI honours `HTTPS_PROXY` and a CA bundle, which enterprise deployments already require of all of them. Per-harness knowledge shrinks to a small adapter (login location, model host, unattended flags), and an adapter that is wrong produces a harness that cannot reach its model, not a candidate that can reach the host.

## Running a locked-down candidate

One-time setup (creates a Podman machine named `stagebench` with no host directories shared, builds both images, and checks the boundary):

```sh
brew install podman            # or any Docker-compatible engine
pnpm bench lockdown-setup
pnpm bench fetch               # manual, photos, and the sample pack
pnpm bench redteam             # about 120 escape attempts from inside; expect every one blocked
```

A run:

```sh
pnpm bench new --model <id> --target <1|2|3>          # lockdown is the default; --isolation none opts out, on the record
pnpm bench start <run-id>
pnpm bench agent <run-id> --harness codex --model <model> --effort high
#   or: scripts/bench-lockdown-run <run-id> --harness codex …
pnpm bench seal <run-id>             # tokens and cost come from the gateway log
pnpm bench score <run-id>                              # builds the blind evaluator workspace
pnpm bench evaluator <run-id> --harness claude         # the grader, in a box of its own
pnpm bench score <run-id>                              # gates rerun in a box; registers the assessment
```

- **Follow-ups.** `pnpm bench agent <run-id> --harness codex --message continue` or `--message seal-failure` resumes the same session with a fixed template (the second carries the failed seal's own output). The message is recorded in the operator log and the isolation record. Your own words go in only as `--off-protocol-message "…"`, which marks the phase.
- **Interactive.** `--interactive` attaches the harness's TUI to your terminal. It is off-protocol (what you type is not a template) and is recorded as such. (Wired; not exercised.)
- **A command in the box.** `pnpm bench exec <run-id> --command "pnpm test"`. No network.
- **Credentials.**

  | Harness | Preferred | Also works |
  | --- | --- | --- |
  | Codex | `STAGEBENCH_OPENAI_API_KEY` (held by the gateway) | ChatGPT login: `CODEX_HOME=~/.codex-personal`. The gateway holds the access token; the box gets unusable stand-ins. Refresh the login on the host first if it is old. |
  | Claude Code | `STAGEBENCH_ANTHROPIC_API_KEY`, or `STAGEBENCH_CLAUDE_OAUTH_TOKEN` from `claude setup-token` (held by the gateway) | — |
  | Anything else | `--harness custom --egress <host> --secret-env NAME=<host> --command '…'` | `--egress <host>=tunnel` for a proprietary protocol |

- **Model pinning.** `--pin-models a,b` refuses any request for another model. Off by default because harnesses call auxiliary models (titles, compaction) that differ by vendor; the gateway log shows which were used.
- **MCP servers.** None are inherited from your own config. One that is added to the box's harness config runs in the box.
- **Opting out.** `--isolation none` at `new`, or `seal --unlocked` for a run created to require the lockdown. Either is recorded as `isolation: none` on the stage.
- **Cleaning up.** `pnpm bench clean <run-id> --force` removes a session's volumes; `clean --all` removes every session this checkout created.

## Blind grading

The grader works from a blind handle, but a handle is only as blind as everything else in the workspace. Three places gave the run away, and each is changed here:

- **The candidate was told.** `WORKSPACE.md` was titled with the run id and ended with `pnpm bench seal <run-id>`, the workspace path contained it, and a run id is a model slug. Whatever a candidate writes into its plan or its audit reaches the grader. `WORKSPACE.md` no longer names the run, and inside the box the working directory is `/workspace` and the harness's `workspace.json` is not copied in.
- **The seal record would have told.** The isolation record identifies the producer outright, asset provenance names other runs, and the gateway's `usage` and `budget` blocks name the model it served. `blindVerification` builds the grader's `inputs/verification.json` from an allowlist of the fields that describe the artifact, so none of these, nor any field added later, reaches the grader, and scrubs every known model and run name from the text that remains. A guard then reads back everything the harness gave the grader and fails grading if a known model or run name is in it. (The first version was a denylist, and `usage` and `budget` got through: see [PROTOCOL-3.md](./PROTOCOL-3.md#changelog).) A test fails if a model, harness, provider, other run, usage figure, or operator message survives.
- **The artifact can still tell.** Seal now records an advisory finding when the run id appears in the sealed tree. It cannot be removed without changing the artifact, and a model that signs its work by name rather than by run id is not caught.

Protocol 3 finished this: the evaluator workspace path no longer contains the checkout's name, the blind handle is keyed so it cannot be worked back to a run id, agent instruction files and the producer's name are removed from the grader's copy of the artifact, a seal refuses an artifact that names its producer, and the evaluator runs in a box whose only contents are that workspace (`pnpm bench evaluator`). See [PROTOCOL-3.md](./PROTOCOL-3.md#6-blind-boxed-grading).

## The candidate's identity

The candidate is not told which model or run it is: nothing the launcher writes into the box (prompts, templates, environment, paths, hostname, container names, git config, the workspace) names either, and a relayed seal failure has both names removed. Only the harness's own configuration and command line carry the model id, because the CLI must send it; the model's own system prompt and training are outside the launcher's reach. `pnpm bench redteam` checks this from inside a real session. Details and what cannot be hidden: [PROTOCOL-3.md, section 13](./PROTOCOL-3.md#13-the-candidate-is-not-told-which-model-or-run-it-is).

## A real phase, start to seal

(This section describes the first prototype, which still had the online package mirror. The same check under protocol 3, fully offline, is in [LOCKDOWN-REDTEAM.md](./LOCKDOWN-REDTEAM.md#an-offline-phase-start-to-seal).)

To check that a candidate can actually do the work in there, Codex CLI 0.169.0 (GPT 6.2 Sol, medium effort) was given Phase 1 in the lockdown with the standard prompt. It is not a benchmark entry and is not in this change. It built the 73-key panel and a synthesized piano, ran its browser pass against the box's Chromium, and passed its four gates; `seal` then exported it, ran install and the gates in a box (8 seconds), captured, verified, and archived the session.

| | |
| --- | --- |
| Agent time | about 12 minutes across three launches |
| Model requests seen by the gateway | 37 turns, all `gpt-6.2-sol`; 2.1M input and 28k output tokens |
| Packages and browser builds fetched through the mirrors | 143 objects, 505 MB, each hashed (most of the bytes are one Chromium download made while fixing item 2 below) |
| Refused | 96 requests: Codex's own plugin and hosted-MCP lookups, and websocket attempts. Nothing the candidate tried. |
| Honeytoken | not read |
| Operator messages | 2, both recorded with their text |

It took three launches because the run exposed three things the red-team could not, each now fixed:

1. **Codex died with exit 101 nine minutes in,** while echoing a failing test's output. It reproduces exactly: a command that prints more than about 64 KB in one burst (one pipe buffer) kills a headless Codex in the box, and its log stops at that size. The container's attach stream drains more slowly than a local pipe, so the likely cause is a write to a full pipe failing; the error itself was not captured. Headless launches now write their console to a file in the box and `tail` relays it, and the same reproduction prints all 600 KB and exits 0.
2. **A newer Playwright could not download its browser.** The browser CDN redirects Chrome for Testing builds to a storage bucket, and the mirror refuses off-prefix redirects. The one storage prefix is now declared in `mirrors.json`. Browsers also now download into the home volume rather than into the candidate's source tree, and the image's pinned Chromium is found without a download.
3. **Seal failed on a missing `evidence/stage1-visual-audit.md`.** Nothing in the task says where evidence goes; candidates have been learning it by reading the harness. In the box the candidate mirrored the capture harness's own layout (`runs/local/stage1/evidence/`). The inputs now carry a one-command capture (`node ../inputs/harness/capture-evidence.mjs --phase N`) that writes to `evidence/`, and say that is where evidence lives. This one was relayed to the agent as an operator message, the way a seal failure normally is.

## Threat model

The adversary is the candidate: a capable agent that will use whatever it can reach, as Astra and Sol did, up to and including one that is trying. The operator is trusted; the aim there is that their interventions are on the record.

| Threat | In the lockdown | What remains |
| --- | --- | --- |
| Reading the host: rubric, harness, `runs/`, `eval/`, other worktrees, other projects, agent session stores | Nothing is mounted, in the box or in the VM under it; a session will not open on a VM that shares the host. | A container escape (kernel or engine bug) lands in a VM that has nothing of the host, but that VM holds other sessions' volumes. Use one VM per run for paired runs. On an engine that cannot be asked about its VM, the second wall is recorded as `unknown`. |
| Writing outside `candidate/` | Inputs are a read-only mount; the root filesystem is read-only; everything else is a volume that is discarded. | — |
| Fetching from the internet: the public repo, the gallery, sample packs, reference implementations, npm | No route. The gateway's only door is the model API; it has no mirrors. Packages come from a fixed mirror in the image whose lock step refuses any tarball that ships audio. | What is in the image's mirror is readable by design: 484 reviewed packages, listed for the candidate up front. |
| The model API as a way out: hosted web search, remote MCP, the provider fetching a URL named in the request, the provider's other endpoints | Exact endpoints and methods; hosted tools and search switches removed; URL-referenced content refused; unparseable requests refused; no websockets. Two of these were real holes found during the build (red-team findings 1 and 3). | A provider adding a new way to reach the internet under an allowed endpoint, switched on by a request field the gateway does not know. Request bodies are stored, so it is auditable after the fact. |
| MCP servers, REPLs, subprocesses, sub-agents, nested agents | All run in the box. A nested agent has the same gateway in front of it. | Handing work to a different model of the same provider, unless models are pinned. |
| Evaluator and rubric leakage | Not in the box; nothing of `STAGEBENCH_HOME` is mounted. The evaluator runs in a box of its own. | A boxed Claude evaluator has not run a turn yet (no usable token on the machine this was built on). |
| Copying assets | The neighbouring library is unreachable, and so is everything else: the only recordings in the box are the sample pack. Seal requires every bundled audio file to be declared and matches each pack-derived one acoustically against the recording it names. | Adjacent velocity layers of one key can be too alike to tell apart; pitch- or time-altered derivations are declared, not verified. |
| Deferred execution: code that waits for seal or score to run on the host | Gates run in a box at seal and at score, with no network. Canonical capture runs in a box with no network. The evaluator opens the build inside its own box. Symlinks do not cross. | Gallery thumbnails are shot by the host's browser after scoring; the published preview is served to the public, as any site is. |
| Forging a gate result | Exit status per container; each gate runs on its own copy of the tree with its own home; scripts run as sealed. The same on Docker and Podman. A test suite that passes by skipping itself is caught separately: a feature needs a test that ran. | What `pnpm install` does is the candidate's to decide (its dependencies and their install scripts run first and persist), as it is anywhere. |
| Naming itself to the grader | The candidate is not told its run id; the grader's copy of the seal record has no producer details; seal refuses an artifact that contains the run id or the model's name, however punctuated; agent instruction files and any producer name are removed from the grader's copy. | A model that describes itself without naming itself. |
| Credentials | Held by the gateway behind placeholders (API key, Claude token, ChatGPT-login access token), substituted only in a credential header for the credential's own host. | ChatGPT-login mode: the account id (an identifier, not a credential) and what the provider's account endpoints return about the account are visible in the box. |
| Operator coaching | Messages are fixed templates; a seal failure is relayed from the harness's own record of it; every launch is recorded with its template and text; transcripts are required at seal. | An `--interactive` session and `--off-protocol-message` are possible and are marked on the run. Deliberate operator misconduct is out of scope. |
| Tampering with the evidence | The gateway log is outside the box and hash-chained; the harness transcript is inside it and is therefore evidence to read, not to trust; the launcher's console log is written outside. Sealed digests go into a hash-chained ledger; a sealed phase cannot be re-sealed, `redigest` cannot move a current digest, and a patch is a new labelled run. | The operator can still rewrite a log and its recorded head together. Publishing the head at seal time would close that. |

## Fairness across harnesses

- **One toolchain.** Node, pnpm, Chromium, and the userland are fixed by the image, whose ID is in the record. Today they are whatever the operator's machine has (this Mac's default `node` is 26; the repo wants 24).
- **One network.** Every harness gets its own model API and nothing else: the same offline package mirror, the same browser, the same sample pack. No harness has web search; before, that depended on the harness and its flags.
- **No inherited extras.** The box starts with an empty home directory: no operator skills, no MCP servers, no memory files, no session history. In the audited runs both models read the operator's global skills, and one used an operator-configured MCP REPL.
- **Uniform telemetry.** The gateway counts requests and reads token usage from the responses of any inspected harness, independent of what the harness reports.
- **What differs.** Harnesses whose provider API is proprietary (Cursor) need a tunnel, so hosted tools cannot be stripped and the model cannot be pinned for them. A run made that way should be marked. Refusing websockets costs Codex about seven seconds of retries at session start before it falls back to HTTPS.
- **One browser.** The candidate's browser, canonical capture, and the boxed evaluator's browser are the same Linux Chromium with the same fonts, from the same image.

## Alternatives considered

| Option | Verdict | Why |
| --- | --- | --- |
| Prompt-only ("do not look outside") | Necessary, not sufficient | It worked on the two unofficial Phase 1 copies. It is a request, and it does nothing about a tool that runs elsewhere. Keep the sentence. |
| Harness-native sandbox profiles (`fix/candidate-isolation`: a Codex permission profile that denies reads outside the workspace, plus `scripts/verify-candidate-sandbox.sh`) | Good immediate layer; keep as the fallback for `--isolation none` | One profile per harness, each with different semantics, and the harness decides what is inside it: MCP servers were not. A path allowlist on the real filesystem is one mistake away from the neighbours. No control over hosted tools. |
| `sandbox-exec` around the whole agent | Rejected as the primary boundary | Already on the machine and covers every tool, but it is a deprecated API, macOS-only, cannot filter network by name, and everything the agent needs (toolchains, caches, Keychain) must be allowlisted on the real disk. Harnesses that sandbox themselves cannot nest inside it. |
| A separate macOS user | Rejected | Needs admin, leaves a permanent account, and world-readable files stay readable. No network control. |
| The old `bench exec`: Docker with the workspace bind-mounted, `--network none` or bridge | Replaced | It boxed the commands the agent chose to route through it, not the agent. `registry` mode was the open internet. |
| Container with an ordinary network | Rejected | The repo and the gallery are public. |
| Container with no network at all | Not possible | The harness has to reach its model. |
| Running the harness outside and only its tools inside | Rejected | This is what failed: every harness needs its own tool-routing adapter, and anything not routed (MCP, hosted tools) is outside. |
| Apple `container` (a VM per container) | Worth evaluating as a second runtime | Stronger isolation between sessions than a shared VM. Needs its own handling of internal networks. Nothing in the design is Podman-specific any more. |
| A full VM per run (Tart, UTM), or a separate machine | Compatible, heavier | The same images and gateway run there; since nothing is bind-mounted, pointing the CLI at a remote engine is the whole change. Best answer to cross-session escape. |
| Encrypting the rubric and `eval/`, or moving them to another machine | Unnecessary inside the lockdown; still sensible for un-boxed evaluators | Addresses one file class and not samples, other runs, or the network. |
| An online, logged package mirror on the gateway | Built first, then replaced | It kept a candidate's choice of dependencies and logged every tarball, and it was an open read channel: npm hosts sample packs. Protocol 3 replaced it with a fixed, hashed mirror inside the image. The set is fixed in advance, published to the candidate, and covers everything any earlier run used. |
| Detection only (canaries, transcripts, hashing) | Kept as the second layer | Finds cheating after the run is spent. Used here for what prevention cannot show. |

## The audit's thirteen weaknesses

| # | Weakness | Under the lockdown |
| --- | --- | --- |
| 1 | Sandbox lets candidates read the whole disk | Closed: nothing is mounted. |
| 2 | Operator prompt dropped the read ban | No longer load-bearing. The default `bench agent` prompt is fixed in code, and each launch records its prompt hash. |
| 3 | Prompts name a capture harness that is not shipped | Closed: `inputs/harness/` carries a self-contained copy and a one-command wrapper that writes to `evidence/`; the prompts name it, and nothing a candidate is given points at the repository. |
| 4 | `eval/` sits beside `work/` and is readable | Closed: neither is mounted, and evaluator workspaces now live under their own neutral path. |
| 5 | Stale homes under `~/.stagebench` are readable | Closed for candidates. `clean --all` now also removes sessions. |
| 6 | No shared-asset rules; a finished library next door | Closed: one raw sample pack for everyone, and no other source of recordings. |
| 7 | Provenance check does not detect copied assets | Closed: every bundled audio file is declared and matched against the pack recording it names; seal-time asset hashing against other runs remains as an advisory. |
| 8 | Seal gates silently skip conditional tests | Closed: a feature passes only if the seal's own test run executed one of its tests and it passed. |
| 9 | `rg` over `bench/` leaks rubric lines | Closed: there is no `bench/` to search. The visual spec no longer points at the rubric either; it states the reachability method itself. |
| 10 | No transcript archive | Done in #45; under protocol 3 a phase is not sealed without it. |
| 11 | MCP tools bypass the sandbox | Closed: they run in the box (verified with a deliberately dangerous MCP REPL). |
| 12 | Verbatim hard-gate text gets fixed by the operator | Closed: the gates ship as a block to paste (`inputs/hard-gates.md`), and a seal failure is relayed by template, not by an operator's paraphrase. |
| 13 | Operator help is unrecorded | Closed: messages are fixed templates, recorded with their text. |

## Migration

Done in protocol 3: the lockdown is the default and the requirement for new runs; the protocol version was bumped; Phase 2 samples come from one shared pack; the evaluator is boxed and capture runs in the image; `fix/candidate-isolation` is merged into this branch, its read ban is in `WORKSPACE.md`, and its Codex profile is the documented fallback for `--isolation none`.

Still to do on each operator machine: install an engine, `pnpm bench lockdown-setup`, `pnpm bench fetch`, `pnpm bench redteam`. And once, anywhere: run one full Claude Code phase and one boxed Claude evaluation with a token the gateway can hold, to finish verifying that adapter.

## Still unsolved

- **Claude Code is verified only up to authentication** (a request through the gateway with a substituted placeholder, answered `401` for a deliberately invalid key). No usable token was available on this machine: the subscription login lives in the Keychain, which the launcher does not and should not read. This covers the boxed evaluator too, whose pinned model is Claude.
- **API-key and Claude-token modes have not met a live key.** They are implemented and unit-tested, and the substitution was observed on the wire with an invalid key. The ChatGPT-login mode, which now works the same way, has run real phases.
- **Provider API drift.** The request policy strips what it knows to be hosted. A strict per-API allowlist of top-level request fields would be tighter and more brittle.
- **Cursor, Grok, OpenCode** have presets for the generic adapter and have not been run.
- **Docker has not been exercised.** Nothing in the design is Podman-specific any more, and the host-exposure check works the same way on both, but only Podman was installed here. Docker Desktop shares the operator's home directory with its VM, which a session refuses.
- **Shared VM.** Sessions are isolated from each other by the container boundary only. Use one VM per run for paired runs.
- **The gateway speaks HTTP/1.1 to the box.** A harness that requires HTTP/2 or websockets to its model would need tunnel mode.
- **`--interactive` is wired and was not exercised.**

## Cost

Measured on this machine (M-series, VM with 8 CPUs and 16 GB):

- Images: 2.9 GB (candidate: Chromium and its libraries, the harness CLIs, plus the 229 MB package mirror) and 264 MB (gateway). First build takes a few minutes and is the only step that reads the npm registry.
- The sample pack: 501 MB as published (432 MB in the operator's store, where WAV recordings are kept as FLAC-coded samples), loaded into the engine once and then shared read-only.
- Opening a session and running a command: about 8 seconds.
- `pnpm install` of the starter from the image's mirror, with no network: under a second.
- Seal of the starter: 43 seconds, of which 28 are its own lint walking `node_modules`. Seal of the real Phase 1 above: 18 seconds.
- The red-team probe with its positive control: about 2 minutes.

## Layout

```
bench/lockdown/
  image/Containerfile     both images, and the stage that builds the mirror
  image/gateway.mjs       the egress gateway (also imported by the tests)
  image/npm-mirror.mjs    builds the offline npm mirror at image build; serves it on loopback in the box
  image/npm-mirror.lock.json  every tarball the mirror holds, pinned by sha512
  image/entrypoint.sh     trusts the gateway CA and starts the loopback registry
  offline/packages.json   the reviewed list the mirror is resolved from
  offline/lock.mjs        `pnpm bench offline-lock`: resolve, verify, and write the lock
  mirrors.json            legacy: what the gateway may fetch when re-running pre-protocol-3 gates
  messages.mjs            the fixed operator message templates
  runtime.mjs             engine detection, images, tar copy in/out, export sanitizing
  session.mjs             candidate and evaluator sessions, gateway lifecycle, launches, exec, export, boxed gates, capture, sample check
  harnesses.mjs           Codex, Claude Code, and generic adapters
  seal.mjs                seal-side glue and the isolation record
  provenance.mjs          asset hashing
  setup.mjs               lockdown-setup
  redteam/                probe, prompts, MCP REPL, runner
tests/lockdown.test.mjs   policy, the gateway over real sockets and TLS, adapters, export
```
