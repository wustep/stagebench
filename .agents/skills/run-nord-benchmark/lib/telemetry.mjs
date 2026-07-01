const FIELDS = [
  'wallTimeSeconds',
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'costUsd',
  'toolCalls',
  'subagents',
  'implementationAttempts',
  'verifierRepairs',
]

export function unavailableMeasurement() {
  return Object.fromEntries(FIELDS.map((field) => [field, { value: null, kind: 'unavailable' }]))
}

export function emptyTelemetry() {
  return { status: 'collecting', totals: unavailableMeasurement(), phases: {} }
}

export function recordMeasurement(telemetry, phase, values, kind = 'measured') {
  if (!['measured', 'estimated', 'unavailable'].includes(kind)) throw new Error('Telemetry kind must be measured, estimated, or unavailable')
  const next = structuredClone(telemetry ?? emptyTelemetry())
  const target = phase ? (next.phases[String(phase)] ?? unavailableMeasurement()) : next.totals
  for (const [field, raw] of Object.entries(values)) {
    if (!FIELDS.includes(field)) throw new Error(`Unknown telemetry field: ${field}`)
    if (raw === undefined) continue
    const value = kind === 'unavailable' ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error(`${field} must be a non-negative number`)
    target[field] = { value, kind }
  }
  if (phase) next.phases[String(phase)] = target
  else next.totals = target
  return next
}

export function recomputeTotals(telemetry) {
  const next = structuredClone(telemetry ?? emptyTelemetry())
  for (const field of FIELDS) {
    const values = Object.values(next.phases).map((phase) => phase[field]).filter((entry) => entry?.value !== null && entry?.value !== undefined)
    next.totals[field] = values.length === 0
      ? { value: null, kind: 'unavailable' }
      : { value: values.reduce((sum, entry) => sum + entry.value, 0), kind: values.some((entry) => entry.kind === 'estimated') ? 'estimated' : 'measured' }
  }
  next.status = Object.keys(next.phases).length === 0 ? 'unavailable' : 'partial'
  return next
}
