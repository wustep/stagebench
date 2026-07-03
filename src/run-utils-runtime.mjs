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

const RUN_ID_PATTERN = /^[a-z0-9-]+$/

export function parseViewerSearch(search, runs) {
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
  const validPhase = rawPhase !== null && Number.isInteger(requestedPhase) && [1, 2, 3, 4].includes(requestedPhase)
  const phase = validPhase && getPreviewPath(run, requestedPhase)
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
