export type PhaseNumber = 1 | 2 | 3 | 4

export type PreviewRun = {
  id: string
  model: string
  title?: string
  previewPath?: string
  previewStage?: PhaseNumber
  previews?: Partial<Record<`${PhaseNumber}`, string>>
}

export function getRunTitle(run: PreviewRun) {
  return run.title ?? run.model
}

export function floorScore(score: number) {
  return Math.floor(score)
}

export function getPreviewPath(run: PreviewRun, phase: PhaseNumber) {
  const configuredPath = run.previews?.[String(phase) as `${PhaseNumber}`]
  if (configuredPath) return configuredPath
  if (run.previewStage === phase) return run.previewPath
  if (!run.previewStage && phase === 4) return run.previewPath
  return undefined
}

export function getAvailablePhases(run: PreviewRun) {
  return ([1, 2, 3, 4] as const).filter((phase) => Boolean(getPreviewPath(run, phase)))
}

export function getLatestPhase(run: PreviewRun) {
  const availablePhases = getAvailablePhases(run)
  return availablePhases.at(-1)
}

export function parseViewerSearch(search: string, runs: PreviewRun[]) {
  const params = new URLSearchParams(search)
  const run = runs.find((candidate) => candidate.id === params.get('run'))
  if (!run) return null

  const requestedPhase = Number(params.get('phase'))
  const phase = ([1, 2, 3, 4].includes(requestedPhase) && getPreviewPath(run, requestedPhase as PhaseNumber))
    ? requestedPhase as PhaseNumber
    : getLatestPhase(run)

  return phase ? { run, phase } : null
}

export function createViewerUrl(currentUrl: string, runId: string, phase: PhaseNumber) {
  const url = new URL(currentUrl)
  url.searchParams.set('run', runId)
  url.searchParams.set('phase', String(phase))
  url.hash = ''
  return url
}

export function clearViewerUrl(currentUrl: string) {
  const url = new URL(currentUrl)
  url.searchParams.delete('run')
  url.searchParams.delete('phase')
  return url
}
