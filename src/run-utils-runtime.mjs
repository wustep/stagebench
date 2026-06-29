export function getRunTitle(run) {
  return run.title ?? run.model
}

export function floorScore(score) {
  return Math.floor(score)
}

export function getPreviewPath(run, phase) {
  const configuredPath = run.previews?.[String(phase)]
  if (configuredPath) return configuredPath
  if (run.previewStage === phase) return run.previewPath
  if (!run.previewStage && phase === 4) return run.previewPath
  return undefined
}

export function getAvailablePhases(run) {
  return [1, 2, 3, 4].filter((phase) => Boolean(getPreviewPath(run, phase)))
}

export function getLatestPhase(run) {
  return getAvailablePhases(run).at(-1)
}

export function parseViewerSearch(search, runs) {
  const params = new URLSearchParams(search)
  const run = runs.find((candidate) => candidate.id === params.get('run'))
  if (!run) return null

  const requestedPhase = Number(params.get('phase'))
  const phase = [1, 2, 3, 4].includes(requestedPhase) && getPreviewPath(run, requestedPhase)
    ? requestedPhase
    : getLatestPhase(run)

  return phase ? { run, phase } : null
}

export function createViewerUrl(currentUrl, runId, phase) {
  const url = new URL(currentUrl)
  url.searchParams.set('run', runId)
  url.searchParams.set('phase', String(phase))
  url.hash = ''
  return url
}

export function clearViewerUrl(currentUrl) {
  const url = new URL(currentUrl)
  url.searchParams.delete('run')
  url.searchParams.delete('phase')
  return url
}
