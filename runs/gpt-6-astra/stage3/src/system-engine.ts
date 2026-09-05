import { PianoEngine } from './audio'
import { LayerAudio, LayeredPianoEngine, type LayerAudioBoundary } from './layer-audio'
import { type EffectSettings, type InstrumentState, type LayerId, type UnitId } from './phase2-state'
import { allIds, effectiveState, extraIds, factories, fullState, readPath, snapshot, sound, zoneGain, type ExtraId, type Morph, type OrganLayer, type Program, type SoundId, type SynthLayer, type SystemState } from './system-state'
export interface StorageBoundary { getItem(key: string): string | null; setItem(key: string, value: string): void }
export class SystemEngine extends LayeredPianoEngine {
  extra: Record<ExtraId, PianoEngine>; slots: Program[]; liveSlots: Program[]; selected = 0; live = false; page = 0
  storePending?: { program: Program; destination: number; live: boolean }; naming = false; nameDraft = ''; list = false; editor = ''; shift = false; morphSource?: Morph['source']; storageError = ''; panicInputs?: () => void; undoProgram?: Program; private tapTimes: number[] = []; private performanceRevision = 0
  private ready = false
  constructor(output: LayerAudioBoundary = new LayerAudio(), readonly storage: StorageBoundary | undefined = typeof localStorage === 'undefined' ? undefined : localStorage, private clock: () => number = () => performance.now()) {
    super(output, clock)
    this.state = fullState(); this.slots = factories(); this.liveSlots = factories().slice(0, 8)
    try { const raw = storage?.getItem('stage4-programs-v1'); if (raw) { const data = JSON.parse(raw); if (data.slots?.length === 32 && data.liveSlots?.length === 8 && data.slots.every((p: Program) => p.state.system?.version === 1)) { this.slots = data.slots; this.liveSlots = data.liveSlots } } } catch { this.storageError = 'Storage unavailable; edits remain in memory' }
    this.extra = Object.fromEntries(extraIds.map(id => [id, new PianoEngine({ start: () => output.start(), voice: (midi, velocity, ended) => { if (!output.extraVoice) throw new Error('Organ/Synth audio boundary unavailable'); return output.extraVoice(id, midi, velocity, ended) }, close() {} })])) as Record<ExtraId, PianoEngine>
    for (const id of extraIds) this.extra[id].subscribe(() => { this.syncExtra(); super.commit(); this.output.configure(effectiveState(this.state)) })
    this.ready = true; this.restore(this.slots[0])
  }
  get system() { return this.state.system! }
  get current() { return (this.live ? this.liveSlots : this.slots)[this.selected] }
  get dirty() { return JSON.stringify(snapshot(this.state)) !== JSON.stringify(this.current.state) }
  get displayName() { return `${this.live ? 'LIVE ' : ''}${Math.floor(this.selected / 8) + 1}.${this.selected % 8 + 1} ${this.current.name}${this.dirty ? ' E' : ''}` }
  private syncExtra() { for (const key of [...this.notes.keys()]) if (key.startsWith('X:')) this.notes.delete(key); for (const id of extraIds) for (const [owner, note] of this.extra[id].notes) this.notes.set(`X:${id}:${owner}`, note) }
  protected override commit() {
    if (!this.ready) { super.commit(); return }
    this.system.scenes[this.system.scene] = Object.fromEntries(allIds.map(id => [id, sound(this.state, id).enabled])) as Record<SoundId, boolean>
    super.commit(); this.output.configure(effectiveState(this.state)); this.syncExtra()
    if (this.live && !this.storePending) { this.liveSlots[this.selected] = { name: this.current.name, state: snapshot(this.state) }; this.persist() }
  }
  private persist() { try { this.storage?.setItem('stage4-programs-v1', JSON.stringify({ slots: this.slots, liveSlots: this.liveSlots })) } catch { this.storageError = 'Storage write failed; edits remain in memory' } }
  edit(action: (s: SystemState) => void) { action(this.system); this.commit() }
  extraLayer(id: ExtraId, patch: Partial<OrganLayer> | Partial<SynthLayer>) { Object.assign(sound(this.state, id), patch); if (patch.enabled === false) this.extra[id].allOff(); if (patch.sustped !== undefined) for (const owner of this.pedals) this.extra[id].sustain(owner, patch.sustped); this.commit() }
  focusExtra(id: ExtraId) { if (id === 'Oa' || id === 'Ob') { this.system.organFocus = id; this.state.fxSection = 'Organ' } else { this.system.synthFocus = id; this.state.fxSection = 'Synth' }; this.system.fxExtra = id; this.commit() }
  override focusEffects(section: InstrumentState['fxSection'], layer: LayerId = this.state.fxFocus) { this.state.fxSection = section; this.state.fxFocus = layer; this.system.fxExtra = section === 'Organ' ? this.system.organFocus : this.system.synthFocus; this.commit() }
  chain() { return this.state.fxSection === 'Piano' ? this.state.layers[this.state.fxFocus].effects : this.state.fxSection === 'Organ' ? this.system.organEffects : this.system.synth[this.system.fxExtra as 'Sa' | 'Sb' | 'Sc'].effects }
  override effect(unit: UnitId, patch: Partial<EffectSettings>) {
    const global = unit in this.state.globals && this.state.globals[unit as keyof typeof this.state.globals]
    const chains = global ? [this.state.layers.A.effects, this.state.layers.B.effects, this.system.organEffects, ...Object.values(this.system.synth).map(p => p.effects)] : this.state.fxSection === 'Piano' && this.state.group ? [this.state.layers.A.effects, this.state.layers.B.effects] : this.state.fxSection === 'Synth' && this.system.synthGroup ? Object.values(this.system.synth).map(p => p.effects) : [this.chain()]
    for (const c of chains) Object.assign(c[unit], patch)
    this.commit()
  }
  override global(unit: keyof InstrumentState['globals'], on: boolean) { this.state.globals[unit] = on; if (on) this.effect(unit, { ...this.chain()[unit] }); else this.commit() }
  override group(on: boolean) { if (this.state.fxSection === 'Piano') super.group(on); else { this.system.synthGroup = on; if (on && this.state.fxSection === 'Synth') { const source = structuredClone(this.chain()); for (const p of Object.values(this.system.synth)) p.effects = structuredClone(source) }; this.commit() } }
  private restore(program: Program) { const master = this.state.master; this.allOff(); this.state = { ...structuredClone(program.state), master, bend: 0 }; this.commit() }
  select(index: number) {
    index = Math.max(0, Math.min(this.live ? 7 : 31, index))
    if (this.storePending) { this.storePending.destination = index; this.storePending.live = this.live; this.selected = index; this.page = Math.floor(index / 8); this.restore(this.current); return }
    if (this.dirty) this.undoProgram = { name: this.current.name, state: snapshot(this.state) }
    this.selected = index; this.page = Math.floor(index / 8); this.restore(this.current)
  }
  browsePage(delta: number) { if (!this.live) this.select(((this.page + delta + 4) % 4) * 8 + this.selected % 8) }
  toggleLive() { this.live = !this.live; this.selected %= 8; this.page = 0; if (this.storePending) { this.storePending.live = this.live; this.storePending.destination = this.selected }; this.restore(this.current) }
  store(as = false) {
    if (this.storePending) { const p = this.storePending; (p.live ? this.liveSlots : this.slots)[p.destination] = structuredClone(p.program); this.storePending = undefined; this.naming = false; this.persist(); this.restore(this.current); return }
    this.storePending = { program: { name: this.current.name, state: snapshot(this.state) }, destination: this.selected, live: this.live }; this.nameDraft = this.current.name; this.naming = as; this.commit()
  }
  finishName() { if (this.storePending) this.storePending.program.name = this.nameDraft.trim().slice(0, 32) || 'Untitled'; this.naming = false; this.commit() }
  cancel() { if (this.storePending) { const p = this.storePending.program; this.storePending = undefined; this.naming = false; this.restore(p) }; this.editor = ''; this.list = false; this.shift = false; this.commit() }
  undo() { if (this.undoProgram) { const p = this.undoProgram; this.undoProgram = undefined; this.restore(p) } }
  scene(scene: 0 | 1) { if (scene === this.system.scene) return; this.allOff(); this.system.scene = scene; for (const id of allIds) sound(this.state, id).enabled = this.system.scenes[scene][id]; this.commit() }
  assign(source: Morph['source'], path: string, end: number) { const start = readPath(this.state, path); if (typeof start !== 'number' || !Number.isFinite(end)) return; this.system.morphs = this.system.morphs.filter(m => !(m.source === source && m.path === path)); if (start !== end) this.system.morphs.push({ source, path, start, end }); this.commit() }
  clearMorph(source: Morph['source']) { this.system.morphs = this.system.morphs.filter(m => m.source !== source); this.commit() }
  morph(source: Morph['source'], value: number) { this.system[source === 'Wheel' ? 'wheel' : 'pedal'] = Math.max(0, Math.min(1, value)); super.commit(); this.output.configure(effectiveState(this.state)) }
  controlChange(cc: number, value: number) { if (cc === 11) this.morph('Control Pedal', value / 127); if (cc === 1) this.morph('Wheel', value / 127) }
  masterTap() { const t = this.clock(); this.tapTimes.push(t); this.tapTimes = this.tapTimes.filter(v => t - v < 8000).slice(-4); if (this.tapTimes.length === 4) this.set({ bpm: Math.max(30, Math.min(300, 180000 / (t - this.tapTimes[0]))) }); else this.commit() }
  override async on(owner: string, midi: number, velocity = 96) {
    const revision = this.performanceRevision, s = this.system, tasks: Promise<void>[] = []
    for (const id of allIds) {
      const p = sound(this.state, id), sectionOn = id === 'A' || id === 'B' ? this.state.sectionOn : id.startsWith('O') ? s.organOn : s.synthOn
      if (!p.enabled || !sectionOn || zoneGain(s, id, midi) <= 0) continue
      const child = id === 'A' || id === 'B' ? this.layers[id] : this.extra[id]
      tasks.push(child.on(owner, midi + p.octave * 12 + s.transpose, velocity))
    }
    await Promise.all([this.activate(), ...tasks]); if (revision === this.performanceRevision) { this.syncExtra(); this.output.configure(effectiveState(this.state)) }
  }
  override off(owner: string) { super.off(owner); if (this.extra) for (const id of extraIds) this.extra[id].off(owner) }
  override sustain(owner: string, down: boolean) { super.sustain(owner, down); if (this.extra) for (const id of extraIds) this.extra[id].sustain(owner, down && sound(this.state, id).sustped); this.syncExtra() }
  panic() { if (this.panicInputs) this.panicInputs(); else this.allOff() }
  override allOff() { this.performanceRevision++; if (this.extra) for (const id of extraIds) this.extra[id].allOff(); super.allOff(); if (this.state.system) { this.system.wheel = 0; this.system.pedal = 0; this.state.bend = 0; this.output.configure(this.state) } }
  override dispose() { super.dispose(); if (this.extra) Object.values(this.extra).forEach(e => e.dispose()) }
}
