# Stagebench

A benchmark that asks coding agents to recreate the Nord Stage 4 as an interactive browser instrument, plus a React gallery for comparing the results. The task, phases, feature IDs, and scoring live in [BENCHMARK.md](./BENCHMARK.md).

## Repository layout

- `BENCHMARK.md` — the task: three phases, feature IDs, evidence, scoring.
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
pnpm bench fetch                                # Nord manual + product photos (gitignored, not redistributed)
pnpm bench new --model <id> --target <1|2|3>
pnpm bench start <run-id>                       # per phase: isolated workspace for the implementation agent
pnpm bench exec <run-id> --command "pnpm test"  # optional: run candidate commands inside Docker
pnpm bench seal <run-id> [--cost-usd N --input-tokens N --output-tokens N]   # import, check, capture, verify, seal
pnpm bench score <run-id>                       # per phase: template first, then registers the filled assessment
```

`pnpm bench status <run-id>` prints the next command and telemetry. Wall time is recorded automatically per phase; pass cost/token usage at seal time (or later via `pnpm bench telemetry`). Runs recorded before the current schema appear in the gallery as Legacy with their frozen scores and reports.

## Private deployment protection

The Vercel deployment uses server-side authentication through `middleware.js`. The password is stored as the sensitive Vercel environment variable `STAGEBENCH_PASSWORD` for Preview and Production; it is never bundled into the React app or saved in browser storage. Successful login creates a signed, seven-day, HttpOnly, Secure cookie. The middleware fails closed with a `503` if the variable is missing, and failed logins are rate-limited (10 attempts per IP per hour).

## Reference material & attribution

Stagebench is an independent, non-commercial benchmark for studying browser UI/audio reconstruction. It is **not affiliated with, authorized, or endorsed by Clavia DMI AB**. "Nord" and "Nord Stage" are trademarks of Clavia DMI AB, used here only to identify the product being studied. The Nord Stage 4 user manual and product photography are copyrighted by Clavia DMI AB and are **not redistributed** in this repository — `pnpm bench fetch` downloads them from Nord's official servers into the gitignored `reference/` directory for local evaluation only. Do not commit, re-host, or redistribute them.
