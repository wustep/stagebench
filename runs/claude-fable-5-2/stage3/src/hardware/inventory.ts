import { SECTION_ORDER } from './geometry'
import { buildEffects } from './sections/effects'
import { buildOrgan } from './sections/organ'
import { buildPerformance } from './sections/performance'
import { buildPiano } from './sections/piano'
import { buildProgram } from './sections/program'
import { buildSynth } from './sections/synth'
import type { ControlDef, LedDef, OledDef, SectionId, SectionInventory } from './types'

const BUILDERS: Record<SectionId, () => SectionInventory> = {
  performance: buildPerformance,
  organ: buildOrgan,
  piano: buildPiano,
  program: buildProgram,
  synth: buildSynth,
  effects: buildEffects,
}

export interface Inventory {
  sections: readonly SectionInventory[]
  controls: readonly ControlDef[]
  leds: readonly LedDef[]
  oleds: readonly OledDef[]
  controlById: ReadonlyMap<string, ControlDef>
}

/** Builds the whole panel and checks the invariants every consumer relies on. */
export function buildInventory(): Inventory {
  const sections = SECTION_ORDER.map((id) => BUILDERS[id]())
  const controls = sections.flatMap((section) => section.controls)
  const leds = sections.flatMap((section) => section.leds)
  const oleds = sections.flatMap((section) => section.oleds)

  const seen = new Set<string>()
  const claim = (id: string) => {
    if (seen.has(id)) throw new Error(`Duplicate hardware id: ${id}`)
    seen.add(id)
  }
  controls.forEach((control) => claim(control.id))
  leds.forEach((led) => claim(led.id))
  oleds.forEach((oled) => claim(oled.id))

  const controlById = new Map(controls.map((control) => [control.id, control]))
  for (const led of leds) {
    if (led.binding.type !== 'step') continue
    const owner = controlById.get(led.binding.control)
    if (!owner || owner.kind !== 'button') {
      throw new Error(`${led.id} is bound to ${led.binding.control}, which is not a button`)
    }
    for (const step of led.binding.on) {
      if (step < 0 || step >= owner.steps) throw new Error(`${led.id} lights on step ${step}, outside ${owner.id}`)
    }
  }
  for (const control of controls) {
    if (control.kind === 'button') {
      if (control.initial < 0 || (control.steps > 0 && control.initial >= control.steps)) {
        throw new Error(`${control.id}: initial step out of range`)
      }
    } else if (control.initial < control.min || control.initial > control.max) {
      throw new Error(`${control.id}: initial value out of range`)
    }
  }
  return { sections, controls, leds, oleds, controlById }
}

export const INVENTORY: Inventory = buildInventory()

export function sectionInventory(id: SectionId): SectionInventory {
  const found = INVENTORY.sections.find((section) => section.id === id)
  if (!found) throw new Error(`Unknown section ${id}`)
  return found
}
