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
- **Missing transcripts never fail a seal or score.** The command prints a loud `⚠` warning naming the follow-up command, records `status: "missing"` with the reason in the manifest, and still seals the artifact. A transcript that cannot be scrubbed safely is also a warning plus a recorded gap, never a partial write into the manifest.

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

The historical import below redacted **1,109 account identifiers** and **125 email addresses** (the operator's address in the agents' system context, plus third-party sample-library contact addresses quoted from web pages). No API keys, tokens, auth headers, cookies, private keys, `.env`/`auth.json` contents, or credential env assignments were present in any matched transcript; an independent `rg` sweep of the decompressed archives for the patterns above, the operator's address, and the account-ID fields returns zero hits. The only token-shaped strings left are coincidental substrings inside Codex `encrypted_content` blobs.

## Historical import (2026-11-17)

The 27 leaderboard runs predate automatic archiving, so their sessions were recovered from the operator machine's local stores. A file was matched to a run and phase only when its recorded cwd was that run's phase workspace (`~/.stagebench/stagebench-cacd547e/work/<id>/stage<N>`) and its timestamps fell inside the phase's `startedAt`→`completedAt` window; evaluator sessions were matched by mapping each blind handle back to its run with `blindRunCode(id)` (`eval/run-<hex>/stage<N>`). Sessions in the stagebench repository itself (harness and gallery work) are not candidate runs and were not archived. The in-progress `gpt-6-2-*` runs are not on the leaderboard and are excluded.

| Run (started) | Harness | Phase 1 | Phase 2 | Phase 3 | Candidate source | Evaluator transcripts | Gap reason |
|---|---|---|---|---|---|---|---|
| `claude-fable-5` (2026-07-01) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Claude Code ~30-day session retention (oldest surviving: 2026-10-19) |
| `composer-2-5-fast` (2026-07-04) | Cursor | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Cursor agent transcripts on this machine start 2026-10-26 |
| `claude-opus-4-8` (2026-07-04) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Claude Code ~30-day session retention (oldest surviving: 2026-10-19) |
| `claude-haiku-4-5-20251001` (2026-07-04) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Claude Code ~30-day session retention (oldest surviving: 2026-10-19) |
| `gpt5-5-high` (2026-07-04) | Codex | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Codex session stores on this machine start 2026-09-27 |
| `gpt-5-6-sol-high` (2026-07-09) | Codex | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Codex session stores on this machine start 2026-09-27 |
| `gpt-5-6-luna-3` (2026-07-09) | Codex | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Codex session stores on this machine start 2026-09-27 |
| `gpt-5-6-terra-high` (2026-07-09) | Codex | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Codex session stores on this machine start 2026-09-27 |
| `grok-4-5` (2026-07-10) | opencode | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | no opencode session store on this machine |
| `kimi-k3` (2026-07-17) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Claude Code ~30-day session retention (oldest surviving: 2026-10-19) |
| `claude-opus-5` (2026-07-24) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Claude Code ~30-day session retention (oldest surviving: 2026-10-19) |
| `grok-4-6-high` (2026-08-14) | Cursor | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Cursor agent transcripts on this machine start 2026-10-26 |
| `deepseek-v4-flash-0731` (2026-08-14) | Omp | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | no Omp session store on this machine |
| `gemini-3-7-flash-high` (2026-08-15) | Cursor | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Cursor agent transcripts on this machine start 2026-10-26 |
| `claude-fable-5-1` (2026-09-02) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Claude Code ~30-day session retention (oldest surviving: 2026-10-19) |
| `gpt-6-astra` (2026-09-05) | codex | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Codex session stores on this machine start 2026-09-27 |
| `muse-spark-1-3` (2026-09-05) | opencode | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | no opencode session store on this machine |
| `claude-opus-5-5` (2026-09-22) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Claude Code ~30-day session retention (oldest surviving: 2026-10-19) |
| `gpt-6-luna` (2026-09-22) | Codex | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Codex session stores on this machine start 2026-09-27 |
| `gpt-6-sol` (2026-09-23) | Codex | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Codex session stores on this machine start 2026-09-27 |
| `grok-4-7-high` (2026-09-23) | Cursor | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Cursor agent transcripts on this machine start 2026-10-26 |
| `gpt-6-1-sol` (2026-09-29) | Codex | ✅ 2 sessions<br>4.6 → 0.9 MB | ✅ 1 session<br>3.1 → 1.1 MB | ✅ 1 session<br>3.4 → 0.9 MB | `~/.codex-personal/sessions/YYYY/MM/DD/` | ❌ missing | evaluator sessions (Claude Code) pruned by ~30-day retention |
| `claude-sonnet-5-5` (2026-09-29) | Claude Code | ❌ missing | ❌ missing | ❌ missing | — | ❌ missing | Claude Code ~30-day session retention (oldest surviving: 2026-10-19) |
| `claude-haiku-5-5` (2026-10-20) | Claude Code | ✅ 1 session<br>8.1 → 1.8 MB | ✅ 1 session<br>20.6 → 2.0 MB | ✅ 1 session<br>21.5 → 3.6 MB | `~/.claude-personal/projects/<workspace-slug>/` | ✅ P1–P3: 6 sessions<br>31.6 → 5.4 MB | — |
| `gpt-6-1-terra` (2026-10-26) | Codex | ✅ 1 session<br>1.6 → 0.6 MB | ✅ 1 session<br>3.0 → 0.7 MB | ✅ 1 session<br>4.2 → 1.3 MB | `~/.codex-personal/sessions/YYYY/MM/DD/` | ✅ P1–P3: 5 sessions<br>21.2 → 5.4 MB | — |
| `deepseek-v41-flash-1017-max` (2026-10-26) | Cursor | ✅ 2 sessions<br>1.7 → 0.4 MB | ✅ 1 session<br>2.4 → 0.6 MB | ✅ 1 session<br>2.0 → 0.4 MB | `~/.cursor/projects/<workspace-slug>/agent-transcripts/` | ✅ P1–P3: 8 sessions<br>36.1 → 8.6 MB | — |
| `claude-fable-5-2` (2026-11-10) | Claude Code | ✅ 1 session<br>50.1 → 12.9 MB | ✅ 1 session<br>13.2 → 3.0 MB | ✅ 1 session<br>13.8 → 2.9 MB | `~/.claude-personal/projects/<workspace-slug>/` | ✅ P1–P3: 6 sessions<br>52.4 → 15.8 MB | — |

**Totals:** candidate transcripts for **15 of 81** phases (153.3 MB raw → 33.0 MB zstd); evaluator transcripts for **12 of 81** scored phases (141.2 MB → 35.1 MB). Total archive: 68.1 MB compressed from 294.5 MB scrubbed-raw.

**Missing candidate phases (66):** claude-fable-5 P1, claude-fable-5 P2, claude-fable-5 P3, composer-2-5-fast P1, composer-2-5-fast P2, composer-2-5-fast P3, claude-opus-4-8 P1, claude-opus-4-8 P2, claude-opus-4-8 P3, claude-haiku-4-5-20251001 P1, claude-haiku-4-5-20251001 P2, claude-haiku-4-5-20251001 P3, gpt5-5-high P1, gpt5-5-high P2, gpt5-5-high P3, gpt-5-6-sol-high P1, gpt-5-6-sol-high P2, gpt-5-6-sol-high P3, gpt-5-6-luna-3 P1, gpt-5-6-luna-3 P2, gpt-5-6-luna-3 P3, gpt-5-6-terra-high P1, gpt-5-6-terra-high P2, gpt-5-6-terra-high P3, grok-4-5 P1, grok-4-5 P2, grok-4-5 P3, kimi-k3 P1, kimi-k3 P2, kimi-k3 P3, claude-opus-5 P1, claude-opus-5 P2, claude-opus-5 P3, grok-4-6-high P1, grok-4-6-high P2, grok-4-6-high P3, deepseek-v4-flash-0731 P1, deepseek-v4-flash-0731 P2, deepseek-v4-flash-0731 P3, gemini-3-7-flash-high P1, gemini-3-7-flash-high P2, gemini-3-7-flash-high P3, claude-fable-5-1 P1, claude-fable-5-1 P2, claude-fable-5-1 P3, gpt-6-astra P1, gpt-6-astra P2, gpt-6-astra P3, muse-spark-1-3 P1, muse-spark-1-3 P2, muse-spark-1-3 P3, claude-opus-5-5 P1, claude-opus-5-5 P2, claude-opus-5-5 P3, gpt-6-luna P1, gpt-6-luna P2, gpt-6-luna P3, gpt-6-sol P1, gpt-6-sol P2, gpt-6-sol P3, grok-4-7-high P1, grok-4-7-high P2, grok-4-7-high P3, claude-sonnet-5-5 P1, claude-sonnet-5-5 P2, claude-sonnet-5-5 P3.

Why so many gaps: Claude Code prunes local sessions after about 30 days (the oldest surviving session on the machine is from 2026-10-19), the Codex session stores (`~/.codex`, `~/.codex-personal`, `~/.codex-20xx` — sessions, archived sessions, and the `state_5.sqlite` thread index) begin on 2026-09-27, Cursor's agent transcripts begin on 2026-10-26, and no opencode or Omp session store exists on the machine. Evaluators always run in Claude Code, so every evaluation scored before 2026-10-19 lost its sessions to the same retention window. Two phases hold an extra short session, kept as part of the record: `gpt-6-1-sol` phase 1 starts with a Codex launch that ended after its first turn (the real session began 56 minutes later), and `deepseek-v41-flash-1017-max` phase 1 starts with a Cursor chat that ended immediately on a usage-quota error before the operator relaunched. `gpt-6-1-sol` phase 2's only surviving session begins 73 minutes after `bench start`; no other session with that workspace cwd exists in any store. Going forward, `seal` and `score` archive sessions while they still exist, so these gaps stop growing.

## Storage

The archives are committed as ordinary git binaries (`.gitattributes` marks `runs/*/transcripts/**/*.zst` as `binary`), not Git LFS: the largest file is 12.9 MB and the import adds 68 MB. If the archive grows enough to warrant LFS, migrate with `git lfs track 'runs/*/transcripts/**/*.zst'` (and `git lfs migrate import --include='runs/*/transcripts/**/*.zst'` for history). The manifests and operator logs stay plain text either way.
