# Run transcripts

Every leaderboard run's record includes the agent sessions that produced it, alongside `run.json` (state and telemetry), `verifications/`, and `evaluations/`. The candidate transcripts, the operator's messages and approvals, and the evaluator/reviewer sessions live in `runs/<id>/transcripts/`. They are **sidecar records**: they sit beside the sealed `stage<N>/` trees, never inside them, so they are not part of any artifact digest and are never copied into an evaluator workspace or export bundle.

## Layout

```
runs/<id>/transcripts/
  manifest.json                    # per phase: archived sessions (or the recorded gap), sizes, sha256, redactions
  operator.jsonl                   # harness operator log: start / seal / score / transcripts / historical-import events
  phase-<N>/
    <session>.jsonl.zst            # candidate session, original filename (Codex rollout-*.jsonl, Claude Code <uuid>.jsonl, Cursor <chat-id>.jsonl)
    <session>/subagents/*.jsonl.zst    # Claude Code subagent transcripts, same relative layout as the source
    <session>/tool-results/*.txt.zst   # Claude Code tool output offloaded from the transcript
    operator.jsonl                 # derived: operator messages, interrupts, approvals/rejections, permission/approval-policy changes
  eval/phase-<N>/                  # evaluator + reviewer sessions for the scored phase (same shape)
```

`manifest.json` records, for each `candidate` and `eval` phase, either `status: "archived"` with one entry per file — `harness`, `sessionId`, `cwd`, `model`, `startedAt`/`endedAt`, `firstPrompt` (truncated), `source` (home-relative path in the agent's session store), `rawBytes`, `scrubbedBytes`, `compressedBytes`, `sha256` of the **scrubbed** bytes, and `redactions` (counts per kind) — or `status: "missing"` with the reason and the session stores that were searched.

The two operator logs are different things. `transcripts/operator.jsonl` is written by the harness itself (`pnpm bench start` / `seal` / `score` / `transcripts` append one structured event each: command, phase, workspace, any `--transcripts` paths, what was archived, and an approval summary). `phase-<N>/operator.jsonl` is derived from that phase's transcripts: every message the operator sent the agent (including mid-run nudges such as "sealing failed with …"), interrupts, tool rejections, approval events, and Codex approval/sandbox policy or Claude Code permission-mode changes, in time order. Both are plain JSON Lines so they diff and review normally.

## Reading a transcript

Transcripts are JSON Lines compressed with zstd (level 12, long-distance matching; the window fits zstd's default decompression limit, so no `--long` flag is needed):

```sh
zstd -dc runs/gpt-6-1-terra/transcripts/phase-2/rollout-2026-10-26T12-32-37-01a179b3-52b5-7111-9ac9-2597789c5bb9.jsonl.zst | head
zstdcat runs/claude-haiku-5-5/transcripts/phase-1/*.jsonl.zst | jq -c 'select(.type == "user")' | head
node -e 'process.stdout.write(require("zlib").zstdDecompressSync(require("fs").readFileSync(process.argv[1])))' <file.zst>
```

`sha256sum` of the decompressed bytes matches the manifest's `sha256`.

## How transcripts are archived

- **`pnpm bench seal <id>`** archives the phase's candidate sessions after the digest is recorded and before the workspace is removed. Sessions are discovered by working directory: any Codex rollout (`$CODEX_HOME/sessions`, `~/.codex-personal/sessions`, `~/.codex*/sessions`, plus `archived_sessions/`), Claude Code project session (`$CLAUDE_CONFIG_DIR/projects`, `~/.claude-personal/projects`, `~/.claude*/projects`, keyed by the cwd), or Cursor agent transcript (`~/.cursor/chats/*/*/meta.json` → `~/.cursor/projects/*/agent-transcripts/`) whose cwd is the phase workspace `<home>/work/<id>/stage<N>` or its `candidate/` subdirectory, and whose activity overlaps the phase (from its `startedAt`, with an hour of slack). Add files discovery misses with `--transcripts <file[,file...]>` (comma-separated, like `telemetry --from-jsonl`).
- **`pnpm bench score <id>`** (the registering call) archives the evaluator/reviewer sessions that ran in the blind workspace `<home>/eval/<handle>/stage<N>` into `eval/phase-<N>/` before that workspace is removed.
- **`pnpm bench transcripts <id> --phase <N> [--eval] [--transcripts <files>] [--workspace <path>]`** archives after the fact (e.g. a harness whose sessions live elsewhere: export them and pass the files). Archiving is additive — a session with the same filename is replaced, nothing already archived for the phase is dropped — and a call that finds nothing never overwrites an archived phase with a gap.
- **Under protocol 3, a phase is not sealed without its transcript.** A locked phase's harness session files come out of the box with the candidate tree, together with the launcher's own console log of each launch (`lockdown-console-<n>.log`, written outside the box, so the candidate could not edit it); a phase sealed outside the lockdown needs a discovered or named session. Evaluator sessions from a boxed evaluation are archived the same way at registration.
- **Before protocol 3, missing transcripts never failed a seal**, and they still never fail a score. The command prints a loud `⚠` warning naming the follow-up command, records `status: "missing"` with the reason in the manifest, and goes on. A transcript that cannot be scrubbed safely is also a warning plus a recorded gap, never a partial write into the manifest.
- **Blind handles are keyed since protocol 3.** `blindRunCode(id)` now mixes in a key that stays in the operator's Stagebench home, so a handle can no longer be recomputed from a run id by anyone else. The mapping for each evaluation is in the run's `transcripts/operator.jsonl` (`"command":"score"`, `blindHandle`). The handles named below are from before the key existed and were plain hashes of the run id.

## Secret scrubbing

Nothing is written under `transcripts/` until it has passed `bench/lib/scrub.mjs` (tests: `tests/transcripts.test.mjs`). JSON Lines are scrubbed structurally — every line is parsed and every string value scrubbed, so secrets inside escaped JSON-in-JSON tool output are seen unescaped — and a line with no hits keeps its original bytes. Every hit is replaced with a stable `***REDACTED_<KIND>***` placeholder; only counts per kind are ever reported.

| Kind | What it matches |
|---|---|
| `ANTHROPIC_KEY`, `OPENAI_KEY`, `GITHUB_TOKEN`, `SLACK_TOKEN`, `AWS_ACCESS_KEY`, `GOOGLE_API_KEY`, `STRIPE_KEY`, `NPM_TOKEN`, `HF_TOKEN`, `VERCEL_TOKEN`, `JWT`, `PRIVATE_KEY` | Vendor-prefixed tokens (`sk-ant-`, `sk-`/`sk-proj-`, `ghp_`/`gho_`/`github_pat_`, `xox?-`, `AKIA…`, `AIza…`, `sk_live_`, `npm_`, `hf_`, `vercel_`), three-part JWTs, PEM private-key blocks |
| `AUTH_HEADER`, `API_KEY_HEADER`, `COOKIE` | `Authorization:` / `Proxy-Authorization:` / `Bearer …`, `x-api-key:`-style headers, `Cookie:` / `Set-Cookie:` values |
| `SECRET_ASSIGNMENT` | `NAME=value` / `"name": "value"` where the name contains `api_key`, `secret`, `token`, `password`, `private_key`, `access_key`, `client_secret`, `credential`, `session_key`, or `cookie` — unless the value is plainly not a credential (a number, a path, a digit-free identifier or member expression, an env-var reference) |
| `URL_CREDENTIALS` | `scheme://user:password@host` |
| `EMAIL` | Email addresses other than `noreply@…`, `@users.noreply.github.com`, `@example.*`, `@anthropic.com`, `@openai.com` |
| `ACCOUNT_ID` | Account identifiers the agent runtimes stamp into session metadata (Codex `creator_user_id`/`creator_account_id`, Claude Code `accountUuid`/`organizationUuid`, …) |

Base64 image payloads (`{"type": "base64", "data": …}`, `data:image/…;base64,…`) and provider-encrypted reasoning (`encrypted_content`) are opaque bytes and are left untouched — regexes over them only produce false positives. Workspace paths such as `/Users/<operator>/.stagebench/…` are kept on purpose: they are what ties a session to its run and phase. After scrubbing, a second pass must find nothing (scrubbing is idempotent), or the file is refused.

The first historical import redacted **1,109 account identifiers** and **125 email addresses** (the operator's address in the agents' system context, plus third-party sample-library contact addresses quoted from web pages) and found no API keys. The wuBook / Grok-computer backfill below added **134 email addresses** and **2 OpenAI API keys** (both in `gpt-6-luna`, replaced with `***REDACTED_OPENAI_KEY***`). Combined totals in the manifests: **1,109** `ACCOUNT_ID`, **259** `EMAIL`, **2** `OPENAI_KEY`. No auth headers, cookies, private keys, `.env`/`auth.json` contents, or other vendor tokens were present. A residual scan of the 119 newly archived files (decompress, then `residualSecretKinds`) returned zero hits. The only token-shaped strings left in the earlier Codex archives are coincidental substrings inside `encrypted_content` blobs.

## Historical import (2026-11-17)

The 27 leaderboard runs predate automatic archiving, so their sessions were recovered in two passes. The first pass searched the operator machine (wuMini) only: a file was matched to a run and phase only when its recorded cwd was that run's phase workspace (`~/.stagebench/stagebench-cacd547e/work/<id>/stage<N>`) and its timestamps fell inside the phase's `startedAt`→`completedAt` window; evaluator sessions were matched by mapping each blind handle back to its run with `blindRunCode(id)` (`eval/run-<hex>/stage<N>`). That recovered five runs (`gpt-6-1-sol` candidates, `claude-haiku-5-5`, `gpt-6-1-terra`, `deepseek-v41-flash-1017-max`, `claude-fable-5-2`). Sessions in the stagebench repository itself (harness and gallery work) are not candidate runs and were not archived. The in-progress `gpt-6-2-*` runs are not on the leaderboard and are excluded.

The same day, a second pass searched **wuBook** and the **Grok computer** (the shared agent box) for the 22 runs that still had no transcripts, plus the missing `gpt-6-1-sol` evaluator sessions. Files were imported with `pnpm bench transcripts <id> --phase N [--eval] --transcripts …` so they went through the same scrubber. Matching rules:

- On the Grok computer, Claude Code and Codex sessions used cwd `/home/box/.stagebench/stagebench-bcbbe128/work/<id>/stage<N>` (or the corresponding `eval/run-<hex>/stage<N>`) and timestamps that overlap the official phase window. This is a snapshot of the session stores from when those September runs were executed on that machine; file mtimes are all 2026-11-14 (the snapshot copy), but the timestamps inside the transcripts are the original ones.
- `gpt-6-sol` is a special case: `run.json` records 30–60 second phase seals on 2026-09-23T01:17Z, after the actual implementation work. The archived candidate and evaluator sessions are the 2026-09-22 work that ran in the official workspace path and official blind eval handle `run-b3a8d61da40c`. A first-turn aborted Codex launch is kept alongside the real phase 1 session, as with `gpt-6-1-sol`.
- `gpt-6-luna` phase 1 and `gpt-6-astra` phase 3 also keep a short extra session (aborted or early attempt) plus the main session.
- On wuBook, Cursor agent transcripts for `grok-4-6-high` and `gemini-3-7-flash-high` lived under the Cursor project for the stagebench repo or the `orca/workspaces/stagebench/nexty` workspace, not the isolated `~/.stagebench/.../work/<id>/stage<N>` path. They were matched by chat timestamps falling inside each phase window. The parent operator chats ("Nord Benchmark Cursor" / "Nord Benchmark Gemini") and between-phase subagent chats were not archived. An 2026-08-15 Cursor session titled "Fable Stage Three" in the `anotha` workspace is *not* the July `claude-fable-5` run and was not archived.
- A Claude Code eval tree `eval/run-880ed6337ca1/` exists on the Grok computer (2026-09-23T01:20–02:08Z) but that handle is not `blindRunCode` of any leaderboard run id, so it was not imported.

| Run (started) | Harness | Phase 1 | Phase 2 | Phase 3 | Candidate source | Evaluator transcripts | Gap reason |
|---|---|---|---|---|---|---|---|
| `claude-fable-5` (2026-07-01) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | not on wuMini, wuBook, or the Grok computer (Claude Code retention / no leftover project dir) |
| `composer-2-5-fast` (2026-07-04) | Cursor | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | wuBook Cursor transcripts begin 2026-08-13; no July composer sessions |
| `claude-opus-4-8` (2026-07-04) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | not on wuMini, wuBook, or the Grok computer |
| `claude-haiku-4-5-20251001` (2026-07-04) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | not on wuMini, wuBook, or the Grok computer |
| `gpt5-5-high` (2026-07-04) | Codex | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | wuBook Codex sessions begin 2026-07-29; none had a StageBench cwd |
| `gpt-5-6-sol-high` (2026-07-09) | Codex | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | wuBook Codex sessions begin 2026-07-29; none had a StageBench cwd |
| `gpt-5-6-luna-3` (2026-07-09) | Codex | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | wuBook Codex sessions begin 2026-07-29; none had a StageBench cwd |
| `gpt-5-6-terra-high` (2026-07-09) | Codex | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | wuBook Codex sessions begin 2026-07-29; none had a StageBench cwd |
| `grok-4-5` (2026-07-10) | opencode | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | no StageBench sessions in wuBook or Grok-computer OpenCode stores |
| `kimi-k3` (2026-07-17) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | not on wuMini, wuBook, or the Grok computer |
| `claude-opus-5` (2026-07-24) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | not on wuMini, wuBook, or the Grok computer |
| `grok-4-6-high` (2026-08-14) | Cursor | ✅ 1 session<br>0.2 → 0.0 MB | ✅ 1 session<br>0.2 → 0.0 MB | ✅ 1 session<br>0.2 → 0.0 MB | wuBook `~/.cursor/projects/…-stagebench/agent-transcripts/` (phase-window match; repo cwd) | ❌ missing | evaluator sessions not found |
| `deepseek-v4-flash-0731` (2026-08-14) | Omp | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | wuBook `~/.omp/agent/sessions/-Projects-stagebench` exists but is empty |
| `gemini-3-7-flash-high` (2026-08-15) | Cursor | ✅ 1 session<br>0.3 → 0.0 MB | ✅ 1 session<br>0.3 → 0.1 MB | ✅ 1 session<br>0.5 → 0.1 MB | wuBook `~/.cursor/projects/…-stagebench-nexty/agent-transcripts/` (phase-window match) | ❌ missing | evaluator sessions not found |
| `claude-fable-5-1` (2026-09-02) | Claude Code | ✅ 1 session<br>23.2 → 8.2 MB | ✅ 1 session<br>12.2 → 3.7 MB | ✅ 1 session<br>8.1 → 1.9 MB | Grok computer `~/.claude/projects/…-work-claude-fable-5-1-stage<N>/` | ✅ P1–P3: 6 sessions<br>17.2 → 5.4 MB | — |
| `gpt-6-astra` (2026-09-05) | Codex | ✅ 1 session<br>2.0 → 0.7 MB | ✅ 1 session<br>1.9 → 0.5 MB | ✅ 2 sessions<br>2.3 → 0.4 MB | Grok computer `~/.codex-20xx` + `~/.codex-wustep` sessions | ✅ P1–P3: 5 sessions<br>16.8 → 5.4 MB | — |
| `muse-spark-1-3` (2026-09-05) | opencode | ❌ missing | ❌ missing | ❌ missing | — | ✅ P1–P3: 6 sessions<br>11.1 → 3.0 MB | candidate (opencode) sessions not found; evaluator sessions recovered from the Grok computer |
| `claude-opus-5-5` (2026-09-22) | Claude Code | ✅ 3 sessions<br>11.0 → 3.3 MB | ✅ 3 sessions<br>8.0 → 1.8 MB | ✅ 3 sessions<br>6.6 → 1.5 MB | Grok computer `~/.claude/projects/…-work-claude-opus-5-5-stage<N>/` | ✅ P1–P3: 11 sessions<br>23.6 → 7.3 MB | — |
| `gpt-6-luna` (2026-09-22) | Codex | ✅ 2 sessions<br>4.0 → 0.6 MB | ✅ 1 session<br>6.2 → 1.3 MB | ✅ 1 session<br>7.0 → 1.3 MB | Grok computer `~/.codex-personal/sessions/2026/09/22/` | ✅ P1–P3: 6 sessions<br>19.5 → 6.0 MB | — |
| `gpt-6-sol` (2026-09-23) | Codex | ✅ 2 sessions<br>4.2 → 0.8 MB | ✅ 1 session<br>2.0 → 0.4 MB | ✅ 1 session<br>1.6 → 0.3 MB | Grok computer `~/.codex-personal/sessions/2026/09/22/` (actual work; official seals are 30s re-seals the next day) | ✅ P1–P3: 7 sessions<br>17.2 → 5.0 MB | — |
| `grok-4-7-high` (2026-09-23) | Cursor | ❌ missing | ❌ missing | ❌ missing | — | ✅ P1–P3: 6 sessions<br>14.6 → 4.0 MB | candidate (Cursor) sessions not found; evaluator sessions recovered from the Grok computer |
| `gpt-6-1-sol` (2026-09-29) | Codex | ✅ 2 sessions<br>4.6 → 0.9 MB | ✅ 1 session<br>3.1 → 1.1 MB | ✅ 1 session<br>3.4 → 0.9 MB | wuMini `~/.codex-personal/sessions/YYYY/MM/DD/` | ❌ missing | evaluator sessions not on wuMini, wuBook, or the Grok computer |
| `claude-sonnet-5-5` (2026-09-29) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | not on wuMini, wuBook, or the Grok computer |
| `claude-haiku-5-5` (2026-10-20) | Claude Code | ✅ 1 session<br>8.1 → 1.8 MB | ✅ 1 session<br>20.6 → 2.0 MB | ✅ 1 session<br>21.5 → 3.6 MB | wuMini `~/.claude-personal/projects/<workspace-slug>/` | ✅ P1–P3: 6 sessions<br>31.6 → 5.4 MB | — |
| `gpt-6-1-terra` (2026-10-26) | Codex | ✅ 1 session<br>1.6 → 0.6 MB | ✅ 1 session<br>3.0 → 0.7 MB | ✅ 1 session<br>4.2 → 1.3 MB | wuMini `~/.codex-personal/sessions/YYYY/MM/DD/` | ✅ P1–P3: 5 sessions<br>21.2 → 5.4 MB | — |
| `deepseek-v41-flash-1017-max` (2026-10-26) | Cursor | ✅ 2 sessions<br>1.7 → 0.4 MB | ✅ 1 session<br>2.4 → 0.6 MB | ✅ 1 session<br>2.0 → 0.4 MB | wuMini `~/.cursor/projects/<workspace-slug>/agent-transcripts/` | ✅ P1–P3: 8 sessions<br>36.1 → 8.6 MB | — |
| `claude-fable-5-2` (2026-11-10) | Claude Code | ✅ 1 session<br>50.1 → 12.9 MB | ✅ 1 session<br>13.2 → 3.0 MB | ✅ 1 session<br>13.8 → 2.9 MB | wuMini `~/.claude-personal/projects/<workspace-slug>/` | ✅ P1–P3: 6 sessions<br>52.4 → 15.8 MB | — |

**Totals:** candidate transcripts for **36 of 81** phases (255.2 MB raw → 60.1 MB zstd); evaluator transcripts for **33 of 81** scored phases (261.1 MB → 71.2 MB). Total archive: 131.2 MB compressed from 516.3 MB scrubbed-raw.

**Missing candidate phases (45):** claude-fable-5 P1, claude-fable-5 P2, claude-fable-5 P3, composer-2-5-fast P1, composer-2-5-fast P2, composer-2-5-fast P3, claude-opus-4-8 P1, claude-opus-4-8 P2, claude-opus-4-8 P3, claude-haiku-4-5-20251001 P1, claude-haiku-4-5-20251001 P2, claude-haiku-4-5-20251001 P3, gpt5-5-high P1, gpt5-5-high P2, gpt5-5-high P3, gpt-5-6-sol-high P1, gpt-5-6-sol-high P2, gpt-5-6-sol-high P3, gpt-5-6-luna-3 P1, gpt-5-6-luna-3 P2, gpt-5-6-luna-3 P3, gpt-5-6-terra-high P1, gpt-5-6-terra-high P2, gpt-5-6-terra-high P3, grok-4-5 P1, grok-4-5 P2, grok-4-5 P3, kimi-k3 P1, kimi-k3 P2, kimi-k3 P3, claude-opus-5 P1, claude-opus-5 P2, claude-opus-5 P3, deepseek-v4-flash-0731 P1, deepseek-v4-flash-0731 P2, deepseek-v4-flash-0731 P3, muse-spark-1-3 P1, muse-spark-1-3 P2, muse-spark-1-3 P3, grok-4-7-high P1, grok-4-7-high P2, grok-4-7-high P3, claude-sonnet-5-5 P1, claude-sonnet-5-5 P2, claude-sonnet-5-5 P3.

The remaining gaps were not on wuMini, wuBook, or the Grok computer. Claude Code still prunes local sessions after about 30 days (wuMini's oldest surviving session was 2026-10-19; wuBook had some September Claude project dirs, but none for StageBench work or eval workspaces). wuBook Codex sessions go back to 2026-07-29, but no rollout had a StageBench cwd. wuBook Cursor transcripts go back to 2026-08-13, which recovered `grok-4-6-high` and `gemini-3-7-flash-high` but not the July `composer-2-5-fast` run. No StageBench OpenCode sessions turned up (the Grok computer's `opencode.db` only has matchmake workspaces). The wuBook Omp store has an empty `-Projects-stagebench` session dir. Evaluators always run in Claude Code; the Grok computer's snapshot recovered evaluator sessions for the September runs that were executed there, but not for earlier runs or for `gpt-6-1-sol`. Short extra sessions kept as part of the record: `gpt-6-1-sol` / `gpt-6-luna` / `gpt-6-sol` phase 1 each include an aborted first-turn Codex launch; `gpt-6-astra` phase 3 includes a short early attempt plus the main session; `deepseek-v41-flash-1017-max` phase 1 includes a Cursor chat that ended on a usage-quota error. Going forward, `seal` and `score` archive sessions while they still exist, so these gaps stop growing.

## Storage

The archives are committed as ordinary git binaries (`.gitattributes` marks `runs/*/transcripts/**/*.zst` as `binary`), not Git LFS: the largest file is still 12.9 MB (`claude-fable-5-2` phase 1). The first import added 68 MB; this backfill brings the archive to 131.2 MB. If it grows enough to warrant LFS, migrate with `git lfs track 'runs/*/transcripts/**/*.zst'` (and `git lfs migrate import --include='runs/*/transcripts/**/*.zst'` for history). The manifests and operator logs stay plain text either way.
