// Canonical telemetry vocabulary shared by the bench harness (per-stage
// rollups, the runs.json projection, and the CLI usage flags) and the gallery
// (runs.json normalization). Kept as a dependency-free leaf module — no Node or
// DOM imports — so both the Node harness and the Vite client bundle can import
// it directly and can never drift out of sync. Types live in the sibling
// .d.mts (the same pattern as run-utils-runtime.mjs).

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
// with no second list to maintain.
export const TELEMETRY_FLAGS = Object.fromEntries(
  TELEMETRY_FIELDS.map((field) => [field.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`), field]),
)
