import { buildKeybed } from './keys'
import { instrumentSpec } from './sections'
import type { ControlSpec, InstrumentSpec, KeySpec, SectionSpec } from './types'

let cached: InstrumentSpec | null = null

/** Assemble the full instrument spec: sections + the 73-key variant keybed. */
export function buildInstrument(): InstrumentSpec {
  if (cached) return cached
  const keybed = buildKeybed(instrumentSpec.keybed.blackKeyHeightFraction)
  cached = { ...instrumentSpec, keybed }
  return cached
}

/** Same as buildInstrument() but always a fresh object (for tests). */
export function buildInstrumentFresh(): InstrumentSpec {
  return { ...instrumentSpec, keybed: buildKeybed(instrumentSpec.keybed.blackKeyHeightFraction) }
}

export function getKeys(): KeySpec[] {
  return buildInstrument().keybed.keys
}

export function getSections(): SectionSpec[] {
  return buildInstrument().sections
}

export function getAllControls(): ControlSpec[] {
  return getSections().flatMap((section) => section.controls)
}

export function getControlById(id: string): ControlSpec | undefined {
  return getAllControls().find((control) => control.id === id)
}

/** Count how many primary OLED displays exist (must be exactly two: Program, Synth). */
export function countPrimaryDisplays(): number {
  return getSections()
    .filter((section) => section.controls.some((control) => control.kind === 'oled'))
    .length
}