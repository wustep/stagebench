import type { MorphDestination, MorphState } from './program-types'

export function interpolateMorphValue(dest: MorphDestination, amount: number): number {
  const t = Math.max(0, Math.min(1, amount))
  return dest.start + (dest.end - dest.start) * t
}

export function applyMorphToValue(
  controlId: string,
  base: number,
  morph: MorphState,
  wheelAmount: number,
  pedalAmount: number,
): number {
  let value = base
  for (const dest of morph.wheel) {
    if (dest.controlId === controlId) value = interpolateMorphValue(dest, wheelAmount / 127)
  }
  for (const dest of morph.pedal) {
    if (dest.controlId === controlId) {
      const morphed = interpolateMorphValue(dest, pedalAmount / 127)
      value = dest.controlId === controlId ? morphed : value
    }
  }
  return value
}

export function clearMorphSource(morph: MorphState, source: 'wheel' | 'pedal'): MorphState {
  return {
    ...morph,
    [source]: [],
  }
}

export function addMorphDestination(
  morph: MorphState,
  source: 'wheel' | 'pedal',
  dest: MorphDestination,
): MorphState {
  const list = [...morph[source].filter((d) => d.controlId !== dest.controlId), dest]
  return { ...morph, [source]: list }
}

export function bpmFromTapTimes(times: number[]): number | null {
  if (times.length < 2) return null
  const intervals: number[] = []
  for (let i = 1; i < times.length; i++) intervals.push(times[i]! - times[i - 1]!)
  const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length
  if (avgMs <= 0) return null
  return Math.max(30, Math.min(300, Math.round(60000 / avgMs)))
}

export function clockSubdivisionSeconds(bpm: number, rateKnob: number): number {
  const divisions = [1, 0.5, 0.25, 0.125, 0.0625, 1 / 3, 1 / 6, 1 / 12]
  const idx = Math.floor((rateKnob / 127) * (divisions.length - 1))
  const beat = 60 / bpm
  return beat * (divisions[idx] ?? 0.25)
}
