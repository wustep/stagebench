// Canonical implementation of the preview/URL helpers, shared by the Vite app
// (src/run-utils.ts re-exports these) and the node:test suite, which imports
// this file directly — Node 24 strips the type annotations at load time. Written
// in TypeScript so the types live with the implementation and cannot drift from
// a separate hand-written declaration file.
import type { PhaseNumber, RunEntry } from './types'

// The subset of a run the preview/URL helpers actually need.
export type PreviewRun = Pick<RunEntry, 'id' | 'model' | 'title' | 'previewPath' | 'previewStage' | 'previews'>

const ALL_PHASES: PhaseNumber[] = [1, 2, 3, 4]

export function getRunTitle(run: PreviewRun): string {
  return run.title ?? run.model
}

export function floorScore(score: number): number {
  return Math.floor(score)
}

export function getPreviewPath(run: PreviewRun, phase: PhaseNumber): string | null | undefined {
  const configuredPath = run.previews?.[`${phase}`]
  if (configuredPath) return configuredPath
  if (run.previewStage === phase) return run.previewPath
  if (!run.previewStage && phase === 4) return run.previewPath
  return undefined
}

export function getAvailablePhases(run: PreviewRun): PhaseNumber[] {
  return ALL_PHASES.filter((phase) => Boolean(getPreviewPath(run, phase)))
}

export function getLatestPhase(run: PreviewRun): PhaseNumber | undefined {
  return getAvailablePhases(run).at(-1)
}

const RUN_ID_PATTERN = /^[a-z0-9-]+$/

// Generic over the run type so callers passing a fuller shape (RunEntry) get it
// back unchanged, instead of a widened PreviewRun they must cast away.
export function parseViewerSearch<T extends PreviewRun>(
  search: string,
  runs: T[],
): { run: T; phase: PhaseNumber } | null {
  const params = new URLSearchParams(search)

  // Reject malformed run ids before touching the registry; a garbage id can
  // never match a real run, so treat it as no viewer rather than undefined.
  const runId = params.get('run')
  if (!runId || !RUN_ID_PATTERN.test(runId)) return null
  const run = runs.find((candidate) => candidate.id === runId)
  if (!run) return null

  // phase must be an integer in the valid range; anything else (floats,
  // out-of-range, non-numeric) falls back to the latest available phase.
  const rawPhase = params.get('phase')
  const requestedPhase = Number(rawPhase)
  const validPhase = rawPhase !== null && Number.isInteger(requestedPhase) && ALL_PHASES.includes(requestedPhase as PhaseNumber)
  const phase = validPhase && getPreviewPath(run, requestedPhase as PhaseNumber)
    ? (requestedPhase as PhaseNumber)
    : getLatestPhase(run)

  return phase ? { run, phase } : null
}

export function createViewerUrl(currentUrl: string, runId: string, phase: PhaseNumber): URL {
  const url = new URL(currentUrl)
  url.searchParams.set('run', runId)
  url.searchParams.set('phase', String(phase))
  url.hash = ''
  return url
}

export function clearViewerUrl(currentUrl: string): URL {
  const url = new URL(currentUrl)
  url.searchParams.delete('run')
  url.searchParams.delete('phase')
  return url
}
