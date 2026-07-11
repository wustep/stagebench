// Canonical telemetry vocabulary shared by the bench harness (per-stage
// rollups, the runs.json projection, and the CLI usage flags) and the gallery
// (runs.json normalization). Kept as a dependency-free leaf module — no Node or
// DOM imports — so both the Node harness and the Vite client bundle can import
// it directly and can never drift out of sync. It stays plain JS (with a
// sibling .d.mts for types) rather than TypeScript because the bench harness
// imports it under whatever Node the shell provides, which may predate native
// type stripping.

// The order here is the canonical field order for run.json telemetry totals.
export const TELEMETRY_FIELDS = [
  'wallTimeSeconds',
  'totalTokens',
  'costUsd',
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'toolCalls',
]

// Kebab-case CLI flag → telemetry field (e.g. `--cost-usd` → `costUsd`).
// Derived from TELEMETRY_FIELDS so adding a field automatically exposes a flag
// with no second list to maintain. The flag names are a public CLI surface —
// a lock test (tests/telemetry-jsonl.test.mjs) pins the exact strings so a
// field rename can't silently change them.
export const TELEMETRY_FLAGS = Object.fromEntries(
  TELEMETRY_FIELDS.map((field) => [field.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`), field]),
)

// Canonical rounding for telemetry values (4 decimals — sub-cent costs). Used
// by both the run-store rollup and the JSONL recompute so recorded values and
// totals always agree in precision.
export function roundTelemetryValue(value) {
  return Math.round(value * 10000) / 10000
}
