import { defaultState, PERFORMANCE_KEYS, type EngineState, type ProgramData } from './state'
import { commitScene } from './scenes'

export const NAME_MAX = 16
export const NAME_CHARSET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-+&.\'!'

// --- program data ---------------------------------------------------------------------------------------------------
/** the storable part of the state (both scenes committed), deep-copied */
export function programOf(s: EngineState): ProgramData {
  const committed = commitScene(s)
  const copy = structuredClone(committed) as Partial<EngineState>
  for (const key of PERFORMANCE_KEYS) delete copy[key]
  return copy as ProgramData
}

/** state with `data` loaded; performance inputs stay as they are */
export function loadProgramData(s: EngineState, data: ProgramData): EngineState {
  const copy = structuredClone(data)
  return { ...copy, master: s.master, pitchBend: s.pitchBend, modWheel: s.modWheel, pedalPos: s.pedalPos, solo: null }
}

/** order-independent text form, for the edited-state comparison */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

/** fill a template from untrusted JSON: unknown keys dropped, wrong types replaced by the template value */
function mergeInto<T>(template: T, raw: unknown): T {
  if (Array.isArray(template)) {
    if (!Array.isArray(raw)) return template
    if (template.length === 0) return raw.filter((x) => x && typeof x === 'object') as unknown as T // morph assignment lists
    if (raw.length !== template.length) return template
    return template.map((t, i) => mergeInto(t, raw[i])) as unknown as T
  }
  if (template && typeof template === 'object') {
    const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(template as Record<string, unknown>)) out[key] = mergeInto((template as Record<string, unknown>)[key], src[key])
    return out as T
  }
  if (typeof template === 'number') return (typeof raw === 'number' && Number.isFinite(raw) ? raw : template) as T
  if (typeof template === 'boolean') return (typeof raw === 'boolean' ? raw : template) as T
  if (typeof template === 'string') return (typeof raw === 'string' ? raw : template) as T
  return template
}

export function sanitizeProgram(raw: unknown): ProgramData {
  return mergeInto(programOf(defaultState()), raw)
}

export const cleanName = (text: string): string =>
  Array.from(text)
    .filter((c) => NAME_CHARSET.includes(c))
    .join('')
    .slice(0, NAME_MAX)

