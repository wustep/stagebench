// Type declarations for run-utils-runtime.mjs, the single canonical
// implementation of the preview/URL helpers shared by the Vite app
// (src/run-utils.ts re-exports these) and the node:test suite.
import type { PhaseNumber, RunEntry } from './types'

// The subset of a run the preview/URL helpers actually need.
export type PreviewRun = Pick<RunEntry, 'id' | 'model' | 'title' | 'previewPath' | 'previewStage' | 'previews'>

export function getRunTitle(run: PreviewRun): string
export function floorScore(score: number): number
export function getPreviewPath(run: PreviewRun, phase: PhaseNumber): string | null | undefined
export function getAvailablePhases(run: PreviewRun): PhaseNumber[]
export function getLatestPhase(run: PreviewRun): PhaseNumber | undefined
export function parseViewerSearch(
  search: string,
  runs: PreviewRun[],
): { run: PreviewRun; phase: PhaseNumber } | null
export function createViewerUrl(currentUrl: string, runId: string, phase: PhaseNumber): URL
export function clearViewerUrl(currentUrl: string): URL
