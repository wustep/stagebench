# Stagebench

A benchmark that asks coding agents to recreate the Nord Stage 4 as an interactive browser instrument, plus a React gallery for comparing the results. The candidate-facing task lives in [TASK.md](./TASK.md); the protocol, harness, and scoring docs live in [BENCHMARK.md](./BENCHMARK.md).

## Repository layout

- `TASK.md` — the candidate-facing task: three phases, feature IDs, honesty contract (run workspaces get a phase-filtered copy).
- `BENCHMARK.md` — the protocol for operators and evaluators: running, sealing, scoring, interpreting.
- `prompts/`, `specs/` — per-phase instructions and machine-readable specs (the benchmark inputs).
- `bench/` — all tooling: the `bench` CLI, run/eval libraries, rubric, schemas, and the candidate starter.
- `runs/` — one directory per run; `runs/<id>/run.json` is authoritative.
- `src/` — the gallery app; `src/data/runs.json` is generated.
- `public/previews/`, `public/reports/` — published playable builds and static evaluation reports.

## Gallery

```sh
pnpm install
pnpm dev
```

`pnpm build` for a production build, `pnpm lint` / `pnpm typecheck` for static checks, `pnpm test` for the suite (gallery, bench pipeline, specs, middleware). Node 24 (`.nvmrc`).

## Run the benchmark

```sh
pnpm bench lockdown-setup                       # once: container VM, images (offline npm mirror + Chromium inside)
pnpm bench fetch                                # once: Nord manual PDF, photos, and the sample pack (sha256-checked)
pnpm bench new --model <id> --target <1|2|3>    # protocol 3: lockdown, offline
pnpm bench start <run-id>                       # per phase: workspace for the implementation agent
pnpm bench agent <run-id> --harness codex       # per phase: run the agent inside the lockdown (docs/LOCKDOWN.md)
pnpm bench exec <run-id> --command "pnpm test"  # optional: run a command in the same box (no network)
pnpm bench seal <run-id> [--cost-usd N --input-tokens N --output-tokens N]   # export, gates, capture, sample check, verify, transcripts, seal
pnpm bench score <run-id>                       # per phase: builds the blind evaluator workspace
pnpm bench evaluator <run-id> --harness claude  # per phase: the grader, in a lockdown box of its own
pnpm bench score <run-id>                       # per phase: registers the filled assessment
pnpm bench thumbs <run-id>                      # after seal/score, before commit: gallery hover thumbnail
pnpm bench verify-sealed                        # any time: re-hash sealed stages against run.json and the seal ledger
```

`pnpm bench thumbs` writes `public/previews/<run-id>/stage<N>/thumb.jpg` beside the published preview. The gallery hover card uses that file (it swaps `index.html` for `thumb.jpg` on `previewPath`); without it the row still plays and simply shows no hover image. `pnpm bench status <run-id>` prints the next command and telemetry. Wall time is recorded automatically per phase; pass cost/token usage at seal time (or later via `pnpm bench telemetry`). The gallery Tokens column is full-run usage (input plus output, or a recorded total). Partial phase coverage is labeled incomplete instead of shown as the run total. `seal` and `score` also archive the agent and evaluator transcripts (secret-scrubbed, zstd) into `runs/<run-id>/transcripts/`; under protocol 3 a phase is not sealed without its transcript. See [`runs/TRANSCRIPTS.md`](runs/TRANSCRIPTS.md). The current protocol is 3.0: candidates are offline in a lockdown, build from one shared raw sample pack ([`sample-pack/`](sample-pack/LICENSES.md)), and are graded blind in a box; what changed and why is in [`docs/PROTOCOL-3.md`](docs/PROTOCOL-3.md). A sealed phase is never edited or re-sealed: an operator patch is a new labelled run (`pnpm bench fork`). Runs recorded before the current schema appear in the gallery as Legacy with their frozen scores and reports.

## Private deployment protection

The Vercel deployment uses server-side authentication through `middleware.js`. The password is stored as the sensitive Vercel environment variable `STAGEBENCH_PASSWORD` for Preview and Production; it is never bundled into the React app or saved in browser storage. Successful login creates a signed, seven-day, HttpOnly, Secure cookie. The middleware fails closed with a `503` if the variable is missing, and failed logins are rate-limited (10 attempts per IP per hour).

## Reference material & attribution

Stagebench is an independent, non-commercial benchmark for studying browser UI/audio reconstruction. It is **not affiliated with, authorized, or endorsed by Clavia DMI AB**. "Nord" and "Nord Stage" are trademarks of Clavia DMI AB, used here only to identify the product being studied. The Nord Stage 4 user manual and product photography are copyrighted by Clavia DMI AB.

The sample pack's recordings are not in this repository either: `pnpm bench fetch` downloads them from their authors' pinned upstream commits. They are Creative Commons licensed (CC BY 3.0 and CC0); sources, licenses, and attribution are in [`sample-pack/LICENSES.md`](sample-pack/LICENSES.md).

Product photos (`reference/*.jpg` and `public/reference/*.jpg`) are stored in this repository so the gallery overlay stays reliable when Nord's CDN paths change. The user manual PDF remains gitignored — fetch it locally with `pnpm bench fetch` and do not commit it. Photos remain Clavia's copyright; they are included here only for non-commercial benchmark evaluation.

Production builds run `scripts/prepare-reference-photos.mjs` (via `prebuild`) to ensure JPGs are present under `public/reference/` (copying from committed `reference/` files, fetching only if missing). Middleware serves local files first and falls back to Nord's CDN if a local file is missing.
