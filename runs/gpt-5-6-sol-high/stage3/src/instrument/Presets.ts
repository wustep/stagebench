import type { OrganSnapshot } from './OrganEngine'
import type { SynthSnapshot } from './SynthEngine'
import type { LayerSnapshot } from './LayerSystem'
import type { EffectsSnapshot } from './Effects'
import type { MorphAssignment } from './Morph'
export interface ProgramState { name: string; layers: LayerSnapshot; organ: OrganSnapshot; synth: SynthSnapshot; effects: EffectsSnapshot; morphs: MorphAssignment[] }
export interface PresetSummary { id: string; name: string }
const copy = <T>(value: T): T => structuredClone(value)
export class PresetLibrary {
  private programs = new Map<string, ProgramState>()
  private next = 1
  constructor(factoryPrograms: ProgramState[] = []) { for (const program of factoryPrograms) this.save(program, `factory-${this.next++}`) }
  save(program: ProgramState, id = `user-${this.next++}`) { this.programs.set(id, copy(program)); return id }
  load(id: string) { const program = this.programs.get(id); return program ? copy(program) : null }
  list(): PresetSummary[] { return [...this.programs].map(([id, program]) => ({ id, name: program.name })) }
}
