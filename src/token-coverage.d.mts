// Type declarations for token-coverage.mjs, shared by the bench harness
// projection and the gallery so partial token sums cannot drift apart.
import type { Telemetry, TokenCoverage } from './types'

export const TOKEN_COVERAGE_FIELDS: readonly ['totalTokens', 'inputTokens', 'outputTokens', 'reasoningTokens']

export type { TokenCoverage }

export function tokenCoverageFromStages(
  stages: Array<{ number: number; telemetry?: Partial<Telemetry> | null }> | null | undefined,
): TokenCoverage

export function partialPhaseLabel(phases: readonly number[] | null | undefined, phaseCount: number): string | null

export type TokenHeadline =
  | { kind: 'total'; value: number }
  | { kind: 'partial'; phases: number[]; phaseCount: number; label: string }
  | { kind: 'unknown' }

export function tokenHeadline(
  telemetry: Partial<Telemetry> | null | undefined,
  coverage: TokenCoverage | null | undefined,
): TokenHeadline
