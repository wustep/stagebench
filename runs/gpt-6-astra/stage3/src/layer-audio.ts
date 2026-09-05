import processorUrl from './processor.ts?worker&url'
import { PianoEngine, type AudioBoundary, type VoiceHandle } from './audio'
import { PianoLibrary } from './library'
import { initialState, type EffectSettings, type InstrumentState, type LayerId, type PianoLayer, type UnitId } from './phase2-state'
import type { DSPMessage } from './dsp'
export interface LayerAudioBoundary {
  library: PianoLibrary
  start(): Promise<void>
  voice(layer: LayerId, midi: number, velocity: number, ended: () => void): VoiceHandle
  configure(state: InstrumentState): void
  pedal(layer: LayerId, down: boolean): void
  extraVoice?(layer: import('./system-state').ExtraId, midi: number, velocity: number, ended: () => void): VoiceHandle
  clear(): void
  close(): void
}
export class LayerAudio implements LayerAudioBoundary {
  private context?: AudioContext; private node?: AudioWorkletNode; private starting?: Promise<void>; private generation = 0
  private barriers = new Map<number, () => void>();
  private state = initialState(); private nextId = 1; private handles = new Map<number, () => void>()
  constructor(readonly library = new PianoLibrary(), private factory: () => AudioContext = () => new AudioContext(), private nodeFactory = (ctx: AudioContext) => new AudioWorkletNode(ctx, 'stage-piano', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })) {}
  get diagnostics() { return { contexts: this.context ? 1 : 0, nodes: this.node ? 1 : 0, voices: this.handles.size, listeners: this.node?.port.onmessage ? 1 : 0, timers: 0 } }
  async start() {
    if (this.starting) return this.starting
    const generation = this.generation
    const start = async () => {
      if (!this.context) this.context = this.factory()
      const ctx = this.context
      if (ctx.state !== 'running') await ctx.resume()
      if (ctx.state !== 'running') throw new Error('Audio could not resume')
      if (!this.node) {
        await ctx.audioWorklet.addModule(processorUrl)
        if (generation !== this.generation) return
        await this.library.load(data => ctx.decodeAudioData(data))
        if (generation !== this.generation) return
        this.node = this.nodeFactory(ctx)
        this.node.port.onmessage = e => { if (e.data.ack !== undefined) { this.barriers.get(e.data.ack)?.(); this.barriers.delete(e.data.ack) }; for (const id of e.data.ended ?? []) { const ended = this.handles.get(id); this.handles.delete(id); ended?.() } }
        this.node.connect(ctx.destination)
        this.send({ kind: 'samples', samples: this.library.samples })
        this.configure(this.state)
      }
    }
    this.starting = start().finally(() => { if (generation === this.generation) this.starting = undefined })
    return this.starting
  }
  private send(message: DSPMessage | { kind: 'barrier'; id: number }) { this.node?.port.postMessage(message) }
  flush() { if (!this.node) return Promise.resolve(); const id = this.nextId++; return new Promise<void>(resolve => { this.barriers.set(id, resolve); this.send({ kind: 'barrier', id }) }) }
  configure(state: InstrumentState) { this.state = structuredClone(state); this.send({ kind: 'state', state: this.state }) }
  pedal(layer: LayerId, down: boolean) { this.send({ kind: 'pedal', layer, down }) }
  voice(layer: LayerId, midi: number, velocity: number, ended: () => void) {
    if (!this.node) throw new Error('Audio has not started')
    const id = this.nextId++; this.handles.set(id, ended); this.send({ kind: 'on', id, layer, midi, velocity })
    let released = false
    return { release: () => { if (!released && this.handles.has(id)) { released = true; this.send({ kind: 'off', id }) } }, stop: () => { if (this.handles.delete(id)) { this.send({ kind: 'stop', id }); ended() } } }
  }
  extraVoice(layer: import('./system-state').ExtraId, midi: number, velocity: number, ended: () => void) {
    if (!this.node) throw new Error('Audio has not started')
    const id = this.nextId++; this.handles.set(id, ended); this.send({ kind: 'extraOn', id, layer, midi, velocity })
    return { release: () => this.send({ kind: 'off', id }), stop: () => { if (this.handles.delete(id)) { this.send({ kind: 'stop', id }); ended() } } }
  }
  clear() { this.send({ kind: 'clear' }); const callbacks = [...this.handles.values()]; this.handles.clear(); callbacks.forEach(ended => ended()) }
  close() { this.generation++; this.clear(); this.barriers.forEach(resolve => resolve()); this.barriers.clear(); if (this.node) { this.node.port.onmessage = null; this.node.port.close(); this.node.disconnect() }; this.node = undefined; void this.context?.close().catch(() => {}); this.context = undefined; this.starting = undefined }
}
/** Two independent inherited owner lifecycles, sharing exactly one audio boundary. */
export class LayeredPianoEngine extends PianoEngine {
  state = initialState(); readonly layers: Record<LayerId, PianoEngine>
  private observers = new Set<() => void>(); private unsubs: (() => void)[] = []; private revision = 0; private lastTap?: number
  constructor(readonly output: LayerAudioBoundary = new LayerAudio(), private now: () => number = () => performance.now()) {
    // Retain the Phase 1 injectable engine contract for InputController and regression fixtures.
    const unused: AudioBoundary = { start: async () => {}, voice: () => ({ release() {}, stop() {} }), close() {} }
    super(unused)
    const make = (layer: LayerId) => new PianoEngine({ start: () => output.start(), voice: (midi, velocity, ended) => output.voice(layer, midi, velocity, ended), close() {} })
    this.layers = { A: make('A'), B: make('B') }
    this.unsubs = Object.values(this.layers).map(engine => engine.subscribe(() => this.sync()))
    output.configure(this.state)
  }
  override subscribe = (listener: () => void) => { if (!this.unsubs.length) this.unsubs = Object.values(this.layers).map(engine => engine.subscribe(() => this.sync())); this.observers.add(listener); return () => { this.observers.delete(listener) } }
  private sync() { this.notes.clear(); for (const id of ['A', 'B'] as const) for (const [owner, note] of this.layers[id].notes) this.notes.set(`${id}:${owner}`, note); this.emit() }
  private emit() { for (const listener of this.observers) listener() }
  protected commit() { this.output.configure(this.state); this.emit() }
  override async activate() {
    if (this.status === 'ready') return
    const revision = this.revision
    this.status = 'loading'; this.emit()
    try { await this.output.start(); if (revision === this.revision) { this.status = 'ready'; this.error = this.output.library.error; this.emit() } }
    catch (e) { if (revision === this.revision) { this.status = 'error'; this.error = String(e); this.allOff() } }
  }
  override async on(owner: string, midi: number, velocity = 96) {
    if (!this.state.sectionOn) return
    const revision = this.revision
    // Child engines reserve ownership synchronously, preserving release-during-load behavior.
    const tasks = (['A', 'B'] as const).filter(id => this.state.layers[id].enabled).map(id => {
      const p = this.state.layers[id]
      return this.layers[id].on(owner, midi + p.octave * 12, velocity)
    })
    await Promise.all([this.activate(), ...tasks])
    if (revision === this.revision) { for (const id of ['A', 'B'] as const) { this.output.pedal(id, this.state.layers[id].sustped && !!this.pedals.size); if (this.layers[id].status === 'error') { this.status = 'error'; this.error = this.layers[id].error } }; this.sync() }
  }
  override off(owner: string) { this.layers.A.off(owner); this.layers.B.off(owner) }
  override sustain(owner: string, down: boolean) {
    if (down) this.pedals.add(owner); else this.pedals.delete(owner)
    for (const id of ['A', 'B'] as const) { this.layers[id].sustain(owner, down && this.state.layers[id].sustped); this.output.pedal(id, this.state.layers[id].sustped && !!this.pedals.size) }
    this.emit()
  }
  override allOff() { this.layers.A.allOff(); this.layers.B.allOff(); this.pedals.clear(); this.output.clear(); this.sync() }
  override dispose() { this.revision++; this.allOff(); this.unsubs.forEach(fn => fn()); this.unsubs = []; this.output.close(); this.status = 'idle'; this.observers.clear() }
  setLayer(id: LayerId, patch: Partial<Omit<PianoLayer, 'effects'>>) {
    Object.assign(this.state.layers[id], patch)
    if (patch.enabled === false) this.layers[id].allOff()
    if (patch.enabled === true) for (const owner of this.pedals) this.layers[id].sustain(owner, this.state.layers[id].sustped)
    if (patch.sustped !== undefined) {
      for (const owner of this.pedals) this.layers[id].sustain(owner, patch.sustped)
      this.output.pedal(id, patch.sustped && !!this.pedals.size)
    }
    this.commit()
  }
  focus(id: LayerId) { this.state.focus = id; this.state.fxFocus = id; this.state.fxSection = 'Piano'; this.commit() }
  focusEffects(section: InstrumentState['fxSection'], layer = this.state.fxFocus) { this.state.fxSection = section; this.state.fxFocus = layer; this.commit() }
  set(patch: Partial<Omit<InstrumentState, 'layers'>>) {
    Object.assign(this.state, patch)
    if (patch.sectionOn === false) this.allOff()
    this.commit()
  }
  effect(unit: UnitId, patch: Partial<EffectSettings>) {
    if (this.state.fxSection !== 'Piano') return
    const global = unit in this.state.globals && this.state.globals[unit as keyof typeof this.state.globals]
    const targets: LayerId[] = this.state.group || global ? ['A', 'B'] : [this.state.fxFocus]
    for (const id of targets) Object.assign(this.state.layers[id].effects[unit], patch)
    this.commit()
  }
  group(on: boolean) { this.state.group = on; if (on) { const source = this.state.layers[this.state.fxFocus].effects; for (const id of ['A', 'B'] as const) this.state.layers[id].effects = structuredClone(source) }; this.commit() }
  global(unit: keyof InstrumentState['globals'], on: boolean) { this.state.globals[unit] = on; if (on) { const source = this.state.layers[this.state.fxFocus].effects[unit]; for (const id of ['A', 'B'] as const) this.state.layers[id].effects[unit] = { ...source } }; this.commit() }
  tap() { const time = this.now(); if (this.lastTap !== undefined) { const delta = time - this.lastTap; if (delta >= 250 && delta <= 2000) { this.state.bpm = 60000 / delta; this.effect('delay', { rate: Math.max(0, Math.min(1, (delta / 1000 - .06) / 1.44)) }) } }; this.lastTap = time; this.commit() }
}
