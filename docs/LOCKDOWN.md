# Lockdown: a structural boundary for candidate runs

Status: prototype, working on macOS (Apple silicon) with Podman. Codex runs in it end to end; Claude Code is wired and verified up to authentication. Red-team results are in [LOCKDOWN-REDTEAM.md](./LOCKDOWN-REDTEAM.md).

## Why

In the GPT 6.2 Astra and Sol runs the operator prompt banned writes outside the workspace and said nothing about reads, and the Codex sandbox allowed reading the whole disk. Both models copied 89 finished piano samples from a neighbouring project, one read a line of `bench/rubric.json` and built its self-check to match, both read harness code, and one harness's MCP tool calls ran outside its sandbox altogether.

A stricter prompt and a stricter Codex profile (the `fix/candidate-isolation` branch) fix that incident. They do not fix the class: every harness has its own sandbox with its own defaults, flags, and gaps, and a prompt is a request. The lockdown replaces "each harness is asked to stay inside" with "there is no outside": the candidate, whichever harness drives it, runs somewhere the rubric, the other runs, the operator's disk, and the internet do not exist.

Two rules follow from the audits, and the design is built to make both structurally true rather than asked for:

1. **A candidate never runs on a host where the StageBench repository or a sibling workspace is readable.** Not "is told not to read it": the machine the candidate's processes run on does not have those files. The box has no mounts, and the VM underneath it has none of the operator's disk either; a session refuses to open if that second part is not true.
2. **Grading is blind all the way down.** Nothing a grader is given names the run. That starts with the candidate, which is no longer told which run it is and so cannot write it into its artifact.

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
| Its own workspace | `WORKSPACE.md` and `inputs/` read-only; `candidate/` read-write. |
| Internet | No route, no external DNS. |
| Operator's machine over the network (dev servers, the container engine) | No route. |
| Its own model API | Yes, through the gateway: exact paths only, hosted tools removed. |
| npm registry, Playwright browser builds | Yes, through read-only mirrors on the gateway; every object fetched is hashed and logged. |
| The harness's tools: shell, MCP servers, REPLs, subprocesses, sub-agents, nested agents | All run inside the same box. There is no second place for a tool to run. |

## Design

```
 operator's machine                      container engine (a VM with no host directories shared)
┌────────────────────┐   tar stream   ┌──────────────────────────────────────────────────────────┐
│ pnpm bench start   │ ─────────────▶ │  volumes: ws (ro)  cand (rw)  home (rw)  honey (decoys)  │
│ pnpm bench agent   │                │        │                                                 │
│ pnpm bench seal    │ ◀───────────── │  ┌─────┴──────────────┐ internal network ┌────────────┐  │
│                    │   tar stream   │  │ box: harness +     │ (no route out,   │  gateway   │──┼──▶ model API (exact paths)
│ runs/<id>/…        │                │  │ every tool it runs │  no ext. DNS)    │ 3 doors,   │──┼──▶ registry.npmjs.org (GET)
│ (never mounted)    │                │  │ uid 1000, no caps  │ ───────────────▶ │ hash-chain │──┼──▶ cdn.playwright.dev (GET)
└────────────────────┘                │  └────────────────────┘                  │ log        │  │
                                      │                                          └────────────┘  │
                                      └──────────────────────────────────────────────────────────┘
```

**The box.** One container image (`bench/lockdown/image/Containerfile`) holds Node 24, pnpm, Playwright with Chromium, git, ripgrep, Python, ffmpeg, and the harness CLIs at pinned versions. The agent runs in it as uid 1000 with every capability dropped, `no-new-privileges`, a read-only root filesystem, and resource limits. The harness's own sandbox is switched off, because the container is the sandbox: this is what makes the boundary the same for every harness, and what puts MCP servers and REPLs inside it rather than beside it.

**No bind mounts.** The workspace is copied into named volumes when the session opens and copied back out at seal, as a tar stream through a throwaway container. Nothing on the operator's disk is ever mounted, so there is no path, relative or absolute, that leads out. Once a session is open the candidate's source lives only in its volume; the host workspace holds a marker file, so there is no directory for an un-boxed agent to work in. A consequence worth having: the engine can be on another machine (`STAGEBENCH_CONTAINER_RUNTIME="podman --connection <remote>"`) with no change to anything else.

**The gateway.** The box sits on an internal network: no default route, no external DNS, no path to the host. The only other member is the gateway (`bench/lockdown/image/gateway.mjs`, one file with no dependencies), which offers three doors and logs every use of each:

1. *Mirrors.* GET-only reverse proxies to fixed upstream prefixes, listed in `bench/lockdown/mirrors.json`: the npm registry and the Playwright browser CDN (with the one storage prefix that CDN redirects into). Tarball URLs in package metadata are rewritten to come back through the mirror. A redirect to anywhere else is refused. Each object is hashed.
2. *Inspected hosts.* For the model API host, TLS terminates at the gateway under a per-session CA that is name-constrained to that host and trusted only inside the box. Each request is checked, and anything that cannot be checked is refused:
   - the method is `GET`, `HEAD`, or `POST`, and the path, compared exactly as sent, is one of a short list of endpoints (never a prefix; dot segments and encoded separators are refused outright);
   - a body must be a JSON object, and what is forwarded is the gateway's own serialization of what it inspected, not the bytes it was sent;
   - any tool the provider would execute on the internet (web search, web fetch, code interpreters, hosted shells, remote MCP connectors) is removed, wherever the harness declares it, along with the request switches that do the same (`mcp_servers`, `search_parameters`, `web_search_options`);
   - a content block that points the provider at a URL (an image, document, or file by address rather than inline) is refused, because the provider would fetch it;
   - websocket upgrades are refused, and the model can be pinned.

   Request and response bodies are stored.
3. *Tunnels.* An opaque TLS tunnel to an allowlisted host. Nothing inside it can be checked, so no built-in adapter uses it. It exists for harnesses with a proprietary protocol.

Everything else is refused and logged. The log is a hash chain (each line carries the SHA-256 of the one before), and its head is written into the verification record at seal.

**Credentials stay outside.** With an API key or a Claude subscription token, the box is given a random placeholder and the gateway swaps in the real credential, in a credential header only, on the way to the one host it belongs to. The candidate never holds it. A ChatGPT login is the exception: it is a set of tokens Codex reads and inspects itself, so a copy of `auth.json` goes in with its refresh token removed.

**Seal runs the candidate's code in the box too.** `pnpm install`, the tests, and the build are candidate-authored code. Running them on the host at seal would hand a candidate, one step later, everything the box withheld (a test that copies `~/Projects/nordstage4`, a Vite plugin that reads the rubric). For a locked phase the four gates run in a fresh box with the registry mirror as its only network. Each gate is its own container, so pass or fail is the process exit status and nothing a script prints can forge it. Each gate also starts from the tree as install left it: the gate tree and home directory are mounted as overlays whose writes are discarded when the gate exits, and the sealed sources are copied over the tree again after install, so one gate cannot rewrite `package.json` or plant a fake `pnpm` for the next. What the gates fetched goes into its own hash-chained log, kept with the run. `score` reruns them the same way.

**What crosses back is treated as data.** The export is measured before it is copied and refused past a size limit. Every symlink and special file is removed and reported: a link that dangles in the box can be live on the host (`public/samples -> ~/Projects/nordstage4/…`), and the next host-side build would follow it. The tree and the built `dist/` are searched, contents and file names, for the session's credential and the decoy token.

**A broken record stops the seal.** A locked phase is not sealed if the session's gateway log or the gates' log is missing or fails its hash chain, or if a credential or decoy token is in the tree or the build. (And a session does not open in the first place on an engine whose VM can see the host.)

**Detection, for what prevention cannot show.** Decoy scoring files with a per-session token are mounted at `/srv/stagebench`; seal records whether they were read and whether the token appears in the artifact or the transcript. Every bundled binary asset is hashed and compared against every other run's sealed assets and any library named in `STAGEBENCH_ASSET_LIBRARIES`; a byte-identical match is an advisory finding on the verification record. This check runs on unlocked seals as well, and is the one that would have flagged the 89 copied samples.

**The record.** A locked seal writes `isolation` into `runs/<id>/verifications/stage<N>.json`: engine and image IDs and whether the VM could see the host, each launch (harness, version, auth mode, MCP servers, prompt hash, and the text of any follow-up message), what the gateway saw (requests by model, tools stripped, refusals by target, packages fetched, token usage), how the gates were isolated and what they fetched, what was dropped on export, and the honeytoken result. The gateway logs are kept at `runs/<id>/lockdown/stage<N>.gateway.jsonl` and `stage<N>.gates.gateway.jsonl`. Harness session files from inside the box go to the transcript archive from #45, and every `agent` launch is appended to the operator log.

**None of that record reaches the grader.** It names the harness, its version, the model the gateway saw, and the provider's endpoints. The grader's copy of the verification file keeps the gates, the contract, and the evidence, with asset provenance reduced to a count.

### Why this option

It is the only one considered that makes the property independent of the harness. A container is something every agent CLI already runs in; the gateway needs only that a CLI honours `HTTPS_PROXY` and a CA bundle, which enterprise deployments already require of all of them. Per-harness knowledge shrinks to a small adapter (login location, model host, unattended flags), and an adapter that is wrong produces a harness that cannot reach its model, not a candidate that can reach the host.

## Running a locked-down candidate

One-time setup (creates a Podman machine named `stagebench` with no host directories shared, builds both images, and checks the boundary):

```sh
brew install podman            # or any Docker-compatible engine
pnpm bench lockdown-setup
pnpm bench redteam             # about ninety escape attempts from inside; expect every one blocked
```

A run:

```sh
pnpm bench new --model <id> --target <1|2|3>          # lockdown is the default; --isolation none opts out, on the record
pnpm bench start <run-id>
pnpm bench agent <run-id> --harness codex --model <model> --effort high
#   or: scripts/bench-lockdown-run <run-id> --harness codex …
pnpm bench seal <run-id> --cost-usd … --input-tokens …
pnpm bench score <run-id>                              # gates rerun in the box
```

- **Follow-ups.** `pnpm bench agent <run-id> --harness codex --prompt "…"` resumes the same session. The message is recorded in the operator log and the isolation record. Use this, not a terminal in the box, to relay a seal failure.
- **Interactive.** `--interactive` attaches the harness's TUI to your terminal. (Wired; not exercised in this prototype.)
- **A command in the box.** `pnpm bench exec <run-id> --command "pnpm test"`.
- **Credentials.**

  | Harness | Preferred | Also works |
  | --- | --- | --- |
  | Codex | `STAGEBENCH_OPENAI_API_KEY` (held by the gateway) | ChatGPT login: `CODEX_HOME=~/.codex-personal`; a copy of `auth.json` without its refresh token goes in the box. Refresh it on the host first if it is old. |
  | Claude Code | `STAGEBENCH_ANTHROPIC_API_KEY`, or `STAGEBENCH_CLAUDE_OAUTH_TOKEN` from `claude setup-token` (held by the gateway) | — |
  | Anything else | `--harness custom --egress <host> --secret-env NAME=<host> --command '…'` | `--egress <host>=tunnel` for a proprietary protocol |

- **Model pinning.** `--pin-models a,b` refuses any request for another model. Off by default because harnesses call auxiliary models (titles, compaction) that differ by vendor; the gateway log shows which were used.
- **MCP servers.** None are inherited from your own config. One that is added to the box's harness config runs in the box.
- **Opting out.** `--isolation none` at `new`, or `seal --unlocked` for a run created to require the lockdown. Either is recorded as `isolation: none` on the stage.
- **Cleaning up.** `pnpm bench clean <run-id> --force` removes a session's volumes; `clean --all` removes every session this checkout created.

## Blind grading

The grader works from a blind handle, but a handle is only as blind as everything else in the workspace. Three places gave the run away, and each is changed here:

- **The candidate was told.** `WORKSPACE.md` was titled with the run id and ended with `pnpm bench seal <run-id>`, the workspace path contained it, and a run id is a model slug. Whatever a candidate writes into its plan or its audit reaches the grader. `WORKSPACE.md` no longer names the run, and inside the box the working directory is `/workspace` and the harness's `workspace.json` is not copied in.
- **The seal record would have told.** The new isolation record identifies the producer outright, and asset provenance names other runs. `blindVerification` strips both from the grader's `inputs/verification.json`; a test fails if a model, harness, provider, other run, or operator message survives.
- **The artifact can still tell.** Seal now records an advisory finding when the run id appears in the sealed tree. It cannot be removed without changing the artifact, and a model that signs its work by name rather than by run id is not caught.

What remains: the evaluator workspace path contains the checkout's directory name (`~/.stagebench/<checkout>-<hash>/eval/…`), so a worktree named after a model leaks it; and the evaluator itself runs un-boxed. Running the evaluator in a box with the evaluator workspace as its only volume fixes both, and is the next step in the migration.

## A real phase, start to seal

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
| Fetching from the internet: the public repo, the gallery, sample packs, reference implementations | No route. The gateway refuses every host and path not listed. | The npm registry is readable by design. Anything published there, including sample packs, is reachable; every fetch is logged with its hash. |
| The model API as a way out: hosted web search, remote MCP, the provider fetching a URL named in the request, the provider's other endpoints | Exact endpoints and methods; hosted tools and search switches removed; URL-referenced content refused; unparseable requests refused; no websockets. Two of these were real holes found during the build (red-team findings 1 and 3). | A provider adding a new way to reach the internet under an allowed endpoint, switched on by a request field the gateway does not know. Request bodies are stored, so it is auditable after the fact. |
| MCP servers, REPLs, subprocesses, sub-agents, nested agents | All run in the box. A nested agent has the same gateway in front of it. | Handing work to a different model of the same provider, unless models are pinned. |
| Evaluator and rubric leakage | Not in the box; nothing of `STAGEBENCH_HOME` is mounted. | The evaluator itself still runs un-boxed on the host. It can be boxed the same way (not built). |
| Copying assets | The neighbouring library is unreachable. Seal hashes every asset against other runs and named libraries. | Assets fetched from npm that another run also fetched will match; the check is advisory. |
| Deferred execution: code that waits for seal or score to run on the host | Gates run in the box at seal and at score. Symlinks do not cross. | The built app still loads in a host browser for canonical capture and for the evaluator. That is the browser's sandbox, with network access. |
| Forging a gate result | Exit status per container; gates cannot write to each other's tree, home, or PATH; scripts run as sealed. | What `pnpm install` does is the candidate's to decide (its dependencies and their install scripts run first and persist), as it is anywhere. On an engine without overlay mounts the gates share one tree, and the record says so. |
| Naming itself to the grader | The candidate is not told its run id; the grader's copy of the seal record has no producer details; seal flags an artifact that contains the run id. | A model that names itself anyway. Candidate-authored agent instruction files (`CLAUDE.md`, `AGENTS.md`) travel with the artifact into the evaluator's workspace, where an un-boxed evaluator's harness may load them. |
| Credentials | Held by the gateway behind placeholders (API key, Claude token), substituted only in a credential header for the credential's own host. | ChatGPT-login mode: the access token is readable in the box. It cannot be sent anywhere but its own provider; seal refuses a tree or build that contains it verbatim (an encoding that survives the build is not caught). |
| Operator coaching | Every prompt sent through `bench agent` is recorded with its text; transcripts are archived. | An operator typing into an `--interactive` session is in the transcript, not the operator log. Deliberate operator misconduct is out of scope. |
| Tampering with the evidence | The gateway log is outside the box and hash-chained; the harness transcript is inside it and is therefore evidence to read, not to trust. | The operator can still rewrite a log and its recorded head together. Publishing the head at seal time would close that. |

## Fairness across harnesses

- **One toolchain.** Node, pnpm, Chromium, and the userland are fixed by the image, whose ID is in the record. Today they are whatever the operator's machine has (this Mac's default `node` is 26; the repo wants 24).
- **One network.** Every harness gets the same mirrors and nothing else. No harness has web search; today that depends on the harness and its flags.
- **No inherited extras.** The box starts with an empty home directory: no operator skills, no MCP servers, no memory files, no session history. In the audited runs both models read the operator's global skills, and one used an operator-configured MCP REPL.
- **Uniform telemetry.** The gateway counts requests and reads token usage from the responses of any inspected harness, independent of what the harness reports.
- **What differs.** Harnesses whose provider API is proprietary (Cursor) need a tunnel, so hosted tools cannot be stripped and the model cannot be pinned for them. A run made that way should be marked. Refusing websockets costs Codex about seven seconds of retries at session start before it falls back to HTTPS.
- **A real difference from today.** The candidate's browser is Linux Chromium with Linux fonts; canonical capture and the evaluator still use the host's. Moving both into the image would make every measurement use identical bits.

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
| Apple `container` (a VM per container) | Worth evaluating as a second runtime | Stronger isolation between sessions than a shared VM. Needs its own handling of internal networks; the one Podman-specific thing the design uses is overlay mounts for gate isolation. |
| A full VM per run (Tart, UTM), or a separate machine | Compatible, heavier | The same images and gateway run there; since nothing is bind-mounted, pointing the CLI at a remote engine is the whole change. Best answer to cross-session escape. |
| Encrypting the rubric and `eval/`, or moving them to another machine | Unnecessary inside the lockdown; still sensible for un-boxed evaluators | Addresses one file class and not samples, other runs, or the network. |
| A prebuilt dependency cache instead of a mirror | Rejected for now | Candidates choose their dependencies. A cache fixes the set in advance; the mirror keeps the choice and logs it. A pinned snapshot is possible later. |
| Detection only (canaries, transcripts, hashing) | Kept as the second layer | Finds cheating after the run is spent. Used here for what prevention cannot show. |

## The audit's thirteen weaknesses

| # | Weakness | Under the lockdown |
| --- | --- | --- |
| 1 | Sandbox lets candidates read the whole disk | Closed: nothing is mounted. |
| 2 | Operator prompt dropped the read ban | No longer load-bearing. The default `bench agent` prompt is fixed in code, and each launch records its prompt hash. |
| 3 | Prompts name a capture harness that is not shipped | Closed: `inputs/harness/` carries a self-contained copy and a one-command wrapper that writes to `evidence/` (all runs, locked or not). |
| 4 | `eval/` sits beside `work/` and is readable | Closed for candidates: neither is mounted. |
| 5 | Stale homes under `~/.stagebench` are readable | Closed for candidates. `clean --all` now also removes sessions. |
| 6 | No shared-asset rules; a finished library next door | The library is unreachable. The rule about where samples may come from is still undecided (below). |
| 7 | Provenance check does not detect copied assets | Added: seal-time asset hashing against other runs and named libraries (all runs). |
| 8 | Seal gates silently skip conditional tests | Not addressed. The gate environment is at least identical for every run now. |
| 9 | `rg` over `bench/` leaks rubric lines | Closed: there is no `bench/` to search. |
| 10 | No transcript archive | Done in #45; locked seals hand it the session files from the box, and add the gateway's own log. |
| 11 | MCP tools bypass the sandbox | Closed: they run in the box (verified with a deliberately dangerous MCP REPL). |
| 12 | Verbatim hard-gate text gets fixed by the operator | Not addressed (a prompt and materials question). |
| 13 | Operator help is unrecorded | Follow-ups through `bench agent` are recorded with their text. |

## Migration

1. Land this with lockdown as the default for new runs. Existing runs have no `isolation` field and are treated as `none`; nothing about them changes.
2. On each operator machine: install an engine, `pnpm bench lockdown-setup`, `pnpm bench redteam`.
3. Decide where Phase 2 recorded samples come from (below), and add it to `mirrors.json` or to `inputs/`.
4. Get credentials that can live in the gateway: an API key per provider, or `claude setup-token`. Run one full Claude Code phase to finish verifying that adapter.
5. Bump the protocol version when the lockdown becomes a requirement for leaderboard entries: candidates lose web search and gain a pinned toolchain, a shipped capture harness, and a stated evidence directory, so locked and unlocked runs are not strictly comparable. (The shipped harness and the `WORKSPACE.md` line about it reach every new workspace as soon as this lands, locked or not.) Show the isolation mode in the gallery.
6. If GPT 6.2 Astra and Sol Phase 2 and 3 are rerun, rerun them in the lockdown.
7. Run evaluator agents in a box with the evaluator workspace as their only volume (the same launcher, a different volume): this is what makes "never on a host where the repository is readable" true of graders as well as candidates, and takes the checkout name out of the path a grader sees. Move canonical capture and thumbnails into the image at the same time.
8. Merge order with `fix/candidate-isolation`: both touch the isolation paragraph of `BENCHMARK.md`, step 2 of the `run-nord-benchmark` skill, and `WORKSPACE.md` generation. Its read-ban sentence should stay in `WORKSPACE.md`; its Codex profile becomes the documented fallback for `--isolation none`.

## Still unsolved

- **Phase 2 samples.** With no internet, a candidate cannot source recorded piano samples except from npm. That needs a decision before a locked Phase 2 is fair: ship one raw, permissively licensed pack in `inputs/` for everyone, or add path-restricted mirrors for a fixed list of libraries. The pack is the recommended option: every run starts from the same material, and trimming, levelling, and layer selection are still the candidate's work.
- **npm is an open read channel.** Anything published is fetchable. It is logged per tarball; it is not restricted.
- **Provider API drift.** The request policy strips what it knows to be hosted. A strict per-API allowlist of top-level request fields would be tighter and more brittle.
- **ChatGPT-login mode keeps a token in the box.** Prefer API keys for official runs.
- **Claude Code is verified only up to authentication** (a request through the gateway with a substituted placeholder, answered `401` for a deliberately invalid key). No usable token was available on this machine: the subscription login lives in the Keychain, which the launcher does not and should not read.
- **Gateway-held credentials have not met a live key.** The API-key and Claude-token modes are implemented and unit-tested, and the substitution was observed on the wire with an invalid key; this machine has only subscription logins. `--interactive` is wired and was not exercised.
- **Cursor, Grok, OpenCode** have presets for the generic adapter and have not been run.
- **Capture and evaluation still run on the host.** That includes the evaluator agent, which reads a copy of the artifact that can contain candidate-written `CLAUDE.md` or `AGENTS.md` files. Boxing the evaluator closes that along with the path leak above.
- **Gate isolation depends on overlay mounts**, which Podman has and Docker does not. On Docker the gates share one writable tree, as they always did on the host.
- **Shared VM.** Sessions are isolated from each other by the container boundary only.
- **Conditional tests and verbatim hard gates** (audit 8 and 12) are untouched.
- **The gateway speaks HTTP/1.1 to the box.** A harness that requires HTTP/2 or websockets to its model would need tunnel mode.

## Cost

Measured on this machine (M-series, VM with 8 CPUs and 16 GB):

- Images: 2.4 GB (candidate, mostly Chromium and its libraries) and 264 MB (gateway). First build takes a few minutes.
- Opening a session and running a command: about 8 seconds.
- `pnpm install` of the starter through the mirror: 3 seconds.
- Seal of the starter: 43 seconds, of which 28 are its own lint walking `node_modules`. Seal of the real Phase 1 above: 18 seconds.
- The red-team probe with its positive control: about 2 minutes.

## Layout

```
bench/lockdown/
  image/Containerfile     both images
  image/gateway.mjs       the egress gateway (also imported by the tests)
  image/entrypoint.sh     trusts the gateway CA inside the box
  mirrors.json            what the mirrors may fetch
  runtime.mjs             engine detection, images, tar copy in/out, export sanitizing
  session.mjs             sessions, gateway lifecycle, agent launch, exec, export, boxed gates
  harnesses.mjs           Codex, Claude Code, and generic adapters
  seal.mjs                seal-side glue and the isolation record
  provenance.mjs          asset hashing
  setup.mjs               lockdown-setup
  redteam/                probe, prompts, MCP REPL, runner
tests/lockdown.test.mjs   policy, the gateway over real sockets and TLS, adapters, export
```
