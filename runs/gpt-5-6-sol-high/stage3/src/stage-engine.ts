import { processEffect, processEffectChain, renderPianoNote } from './dsp'
import { effectiveEffectChain, effectiveOrganLayer, effectiveSynthLayer, renderOrganNote, renderSynthNote, voicePlan } from './phase3-dsp'
import { morphedValue, routeLayerGain } from './programs'
import { SAMPLE_BANKS, type InstrumentState, type LayerAddress, type LayerId, type SynthLayerId } from './instrument'
import type { NoteSnapshot, PianoStatus, PlayablePianoEngine, VoiceHandle } from './piano'

interface LayerRack {
  input: GainNode
  mod1: BiquadFilterNode
  mod2: BiquadFilterNode
  delay: DelayNode
  delayDry: GainNode
  delayWet: GainNode
  feedback: GainNode
  feedbackFilter: BiquadFilterNode
  amp: BiquadFilterNode
  compressor: DynamicsCompressorNode
  reverbDry: GainNode
  reverbWet: GainNode
  convolver: ConvolverNode
  reverbTone: BiquadFilterNode
  rotary: StereoPannerNode
  level: GainNode
}

interface BrowserAudioWindow extends Window { webkitAudioContext?: typeof AudioContext }

const ramp = (parameter: AudioParam, value: number, now: number) => {
  parameter.cancelScheduledValues(now)
  parameter.setValueAtTime(parameter.value, now)
  parameter.linearRampToValueAtTime(value, now + .018)
}

class StageAudioGraph {
  readonly context: AudioContext
  private readonly master: GainNode
  private readonly limiter: DynamicsCompressorNode
  private readonly racks: Record<LayerId, LayerRack>
  private state: InstrumentState
  private handles = new Set<VoiceHandle>()
  private reverbTypes: Record<LayerId, string> = { A: '', B: '' }

  constructor(state: InstrumentState, Context: typeof AudioContext) {
    this.state = state
    this.context = new Context()
    this.master = this.context.createGain()
    this.limiter = this.context.createDynamicsCompressor()
    this.limiter.threshold.value = -2
    this.limiter.knee.value = 2
    this.limiter.ratio.value = 18
    this.limiter.attack.value = .003
    this.limiter.release.value = .08
    this.master.connect(this.limiter).connect(this.context.destination)
    this.racks = { A: this.createRack(), B: this.createRack() }
    this.update(state)
  }

  private createRack(): LayerRack {
    const context = this.context
    const input = context.createGain()
    const mod1 = context.createBiquadFilter()
    const mod2 = context.createBiquadFilter()
    const delay = context.createDelay(1.5)
    const delayDry = context.createGain()
    const delayWet = context.createGain()
    const feedback = context.createGain()
    const feedbackFilter = context.createBiquadFilter()
    const amp = context.createBiquadFilter()
    const compressor = context.createDynamicsCompressor()
    const reverbDry = context.createGain()
    const reverbWet = context.createGain()
    const convolver = context.createConvolver()
    const reverbTone = context.createBiquadFilter()
    const rotary = context.createStereoPanner()
    const level = context.createGain()
    convolver.buffer = this.impulseResponse(.7)
    input.connect(mod1).connect(mod2)
    mod2.connect(delayDry).connect(amp)
    mod2.connect(delay).connect(delayWet).connect(amp)
    delay.connect(feedbackFilter).connect(feedback).connect(delay)
    amp.connect(compressor)
    compressor.connect(reverbDry).connect(rotary)
    compressor.connect(convolver).connect(reverbTone).connect(reverbWet).connect(rotary)
    rotary.connect(level).connect(this.master)
    return { input, mod1, mod2, delay, delayDry, delayWet, feedback, feedbackFilter, amp, compressor, reverbDry, reverbWet, convolver, reverbTone, rotary, level }
  }

  private impulseResponse(seconds: number, spring = false): AudioBuffer {
    const length = Math.floor(this.context.sampleRate * seconds)
    const buffer = this.context.createBuffer(2, length, this.context.sampleRate)
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel)
      let seed = 17 + channel * 31
      for (let index = 0; index < length; index += 1) {
        seed = (seed * 16807) % 2147483647
        const color = spring ? Math.sin(index * .071) * .72 + .28 : 1
        data[index] = ((seed / 2147483647) * 2 - 1) * (1 - index / length) ** 2 * color
      }
    }
    return buffer
  }

  start(layerId: LayerId, note: number, velocity: number, voiceId: number): VoiceHandle {
    const layer = this.state.layers[layerId]
    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    const roots = layer.type in SAMPLE_BANKS ? SAMPLE_BANKS[layer.type as keyof typeof SAMPLE_BANKS].roots : [36, 48, 60, 72, 84, 96]
    const root = roots.reduce((best, value) => Math.abs(value - note) < Math.abs(best - note) ? value : best, roots[0])
    const rendered = renderPianoNote(layer.type, root, velocity, 2.4, this.context.sampleRate, { ...layer, level: 1 })
    const buffer = this.context.createBuffer(1, rendered.length, this.context.sampleRate)
    const pcm = new Float32Array(rendered.length)
    pcm.set(rendered)
    buffer.copyToChannel(pcm, 0)
    source.buffer = buffer
    source.playbackRate.value = 2 ** ((note + layer.octave - root + (layer.pstick ? this.state.pitchBend * 2 : 0)) / 12)
    source.detune.value = (voiceId % 3 - 1) * .5
    const now = this.context.currentTime
    gain.gain.setValueAtTime(.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(.001, velocity * .8), now + .006)
    source.connect(gain).connect(this.racks[layerId].input)
    source.start(now)
    let stopped = false
    const finish = (seconds: number) => {
      if (stopped) return
      stopped = true
      const at = this.context.currentTime
      gain.gain.cancelScheduledValues(at)
      gain.gain.setValueAtTime(Math.max(.0001, gain.gain.value), at)
      gain.gain.exponentialRampToValueAtTime(.0001, at + seconds)
      source.stop(at + seconds + .025)
      globalThis.setTimeout(() => {
        source.disconnect()
        gain.disconnect()
        this.handles.delete(handle)
      }, (seconds + .05) * 1000)
    }
    const handle = { release: () => finish(layer.softRelease && layer.type !== 'Clav' ? 1.1 : .52), stop: () => finish(.015) }
    this.handles.add(handle)
    return handle
  }

  startOrgan(layerId: LayerId, note: number, velocity: number, voiceId: number, routedGain: number): VoiceHandle {
    const layer = effectiveOrganLayer(this.state, layerId)
    let rendered = renderOrganNote({ ...layer, level: 1 }, note + this.state.transpose + (layer.pstick ? this.state.pitchBend * 2 : 0), velocity, 2.4, this.context.sampleRate)
    rendered = processEffectChain(rendered, effectiveEffectChain(this.state, 'organ', this.state.organ.effects), this.context.sampleRate, this.state.masterClockBpm)
    if (this.state.organ.rotaryRouted && this.state.rotaryOn) {
      rendered = processEffect(rendered, 'mod2', this.state.rotaryFast ? 'Spin' : 'Vibe', this.state.rotaryStopped ? 0 : .25 + this.state.rotaryDrive * .55, this.context.sampleRate)
    }
    return this.startRendered(rendered, routedGain * morphedValue(this.state, `organ:${layerId}`, layer.level), voiceId, layer.keyClick ? .004 : .012, .04)
  }

  startSynth(layerId: SynthLayerId, note: number, velocity: number, voiceId: number, routedGain: number, previousNote?: number): VoiceHandle {
    const layer = effectiveSynthLayer(this.state, layerId)
    let rendered = renderSynthNote({ ...layer, level: 1 }, note + this.state.transpose + (layer.pstick ? this.state.pitchBend * 2 : 0), velocity, 2.4, this.context.sampleRate, this.state.masterClockBpm, previousNote)
    rendered = processEffectChain(rendered, effectiveEffectChain(this.state, `synth:${layerId}`, this.state.synth.effects[layerId]), this.context.sampleRate, this.state.masterClockBpm)
    if (this.state.synth.effects[layerId].ampEq.on && this.state.synth.effects[layerId].ampEq.type === 'To Rotary' && this.state.rotaryOn) {
      rendered = processEffect(rendered, 'mod2', this.state.rotaryFast ? 'Spin' : 'Vibe', this.state.rotaryStopped ? 0 : .3 + this.state.rotaryDrive * .5, this.context.sampleRate)
    }
    return this.startRendered(rendered, routedGain * morphedValue(this.state, `synth:${layerId}`, layer.level), voiceId, .006, .035)
  }

  private startRendered(rendered: Float32Array, level: number, voiceId: number, attack: number, release: number): VoiceHandle {
    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    const buffer = this.context.createBuffer(1, rendered.length, this.context.sampleRate)
    buffer.copyToChannel(new Float32Array(rendered), 0)
    source.buffer = buffer
    const now = this.context.currentTime
    gain.gain.setValueAtTime(.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, level), now + attack)
    source.connect(gain).connect(this.master)
    source.start(now)
    let stopped = false
    const finish = (seconds: number) => {
      if (stopped) return
      stopped = true
      const at = this.context.currentTime
      gain.gain.cancelScheduledValues(at)
      gain.gain.setValueAtTime(Math.max(.0001, gain.gain.value), at)
      gain.gain.exponentialRampToValueAtTime(.0001, at + seconds)
      source.stop(at + seconds + .025)
      globalThis.setTimeout(() => {
        source.disconnect(); gain.disconnect(); this.handles.delete(handle)
      }, (seconds + .05) * 1000)
    }
    const handle = { release: () => finish(release), stop: () => finish(.015) }
    this.handles.add(handle)
    return handle
  }

  update(state: InstrumentState): void {
    this.state = state
    const now = this.context.currentTime
    ramp(this.master.gain, state.masterLevel, now)
    for (const layerId of ['A', 'B'] as LayerId[]) {
      const rack = this.racks[layerId]
      const chain = effectiveEffectChain(state, `piano:${layerId}`, state.effects[layerId])
      const bypass = chain.allBypass
      const mod1On = chain.mod1.on && !bypass
      const mod1Index = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'].indexOf(chain.mod1.type)
      rack.mod1.type = chain.mod1.type.includes('Wah') ? 'bandpass' : chain.mod1.type === 'Ring Mod' ? 'highpass' : 'lowpass'
      const mod1Rate = chain.mod1.fast ? Math.min(1, state.masterClockBpm / 300) : chain.mod1.rate
      ramp(rack.mod1.frequency, mod1On ? 360 + mod1Rate * (2300 + Math.max(0, mod1Index) * 850) : 20000, now)
      rack.mod1.Q.value = mod1On ? .7 + chain.mod1.amount * (4 + Math.max(0, mod1Index) * 1.7) : .0001
      const mod2Index = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'].indexOf(chain.mod2.type)
      rack.mod2.type = chain.mod2.type === 'Phaser' || chain.mod2.type === 'Vibe' ? 'allpass' : 'peaking'
      rack.mod2.frequency.value = chain.mod2.on && !bypass ? 180 + chain.mod2.rate * (1500 + Math.max(0, mod2Index) * 610) : 1000
      rack.mod2.Q.value = chain.mod2.on && !bypass ? .5 + Math.max(0, mod2Index) * .55 : .0001
      rack.mod2.gain.value = chain.mod2.on && !bypass ? (chain.mod2.amount - .4) * (8 + Math.max(0, mod2Index) * 2) : 0
      const delayOn = chain.delay.on && !bypass
      const delaySeconds = .045 + chain.delay.rate * .72
      const beat = 60 / state.masterClockBpm
      const syncedDelay = [.25, .5, .75, 1, 1.5].map((value) => value * beat).reduce((best, value) => Math.abs(value - delaySeconds) < Math.abs(best - delaySeconds) ? value : best, beat)
      ramp(rack.delay.delayTime, delayOn ? (chain.delay.fast ? syncedDelay : delaySeconds) : 0, now)
      ramp(rack.delayDry.gain, 1, now)
      ramp(rack.delayWet.gain, delayOn ? chain.delay.mix : 0, now)
      ramp(rack.feedback.gain, delayOn ? Math.min(.88, chain.delay.feedback) : 0, now)
      rack.feedbackFilter.type = chain.delay.filter === 'HP' ? 'highpass' : chain.delay.filter === 'BP' ? 'bandpass' : 'lowpass'
      rack.feedbackFilter.frequency.value = chain.delay.filter === 'Off' ? 20000 : chain.delay.filter === 'LP' ? 2400 : 650
      const ampOn = chain.ampEq.on && !bypass
      const ampIndex = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'].indexOf(chain.ampEq.type)
      rack.amp.type = chain.ampEq.type === 'HP24 Filter' ? 'highpass' : chain.ampEq.type === 'LP24 Filter' ? 'lowpass' : chain.ampEq.type === 'To Rotary' ? 'allpass' : 'peaking'
      rack.amp.frequency.value = ampOn ? 200 + chain.ampEq.feedback * (7600 + Math.max(0, ampIndex) * 340) : 1000
      rack.amp.Q.value = ampOn ? .4 + chain.ampEq.bright * 5 + Math.max(0, ampIndex) * .25 : .0001
      rack.amp.gain.value = ampOn ? chain.ampEq.amount * (8 + Math.max(0, ampIndex)) + chain.ampEq.mix * 6 - 7 : 0
      const compOn = chain.compressor.on && !bypass
      rack.compressor.threshold.value = compOn ? -8 - chain.compressor.amount * 34 : 0
      rack.compressor.ratio.value = compOn ? 2 + chain.compressor.amount * 14 : 1
      rack.compressor.attack.value = chain.compressor.fast ? .001 : .018
      const reverbOn = chain.reverb.on && !bypass
      rack.reverbTone.type = 'lowpass'
      ramp(rack.reverbTone.frequency, 900 + chain.reverb.bright * 14500, now)
      if (this.reverbTypes[layerId] !== chain.reverb.type) {
        const lengths: Record<string, number> = { Room: .32, Booth: .12, Spring: .48, Stage: .7, Hall: 1.1, Cathedral: 1.65 }
        rack.convolver.buffer = this.impulseResponse(lengths[chain.reverb.type] ?? .5, chain.reverb.type === 'Spring')
        this.reverbTypes[layerId] = chain.reverb.type
      }
      ramp(rack.reverbDry.gain, reverbOn ? 1 - chain.reverb.mix : 1, now)
      ramp(rack.reverbWet.gain, reverbOn ? chain.reverb.mix : 0, now)
      const toRotary = chain.ampEq.on && chain.ampEq.type === 'To Rotary' && state.rotaryOn && !bypass
      rack.rotary.pan.value = toRotary ? Math.sin(now * (state.rotaryFast ? 7 : 1.2)) * .7 : 0
      ramp(rack.level.gain, state.sectionOn && state.layers[layerId].enabled ? morphedValue(state, `piano:${layerId}`, state.layers[layerId].level) : 0, now)
    }
  }

  stopAll(): void { for (const handle of [...this.handles]) handle.stop(); this.handles.clear() }
  async dispose(): Promise<void> {
    this.stopAll()
    for (const rack of Object.values(this.racks)) for (const node of Object.values(rack)) node.disconnect()
    this.master.disconnect(); this.limiter.disconnect()
    if (this.context.state !== 'closed') await this.context.close()
  }
}

interface OwnedInput {
  note: number
  held: boolean
  voices: Partial<Record<LayerAddress, VoiceHandle>>
}

export class StagePianoEngine implements PlayablePianoEngine {
  private graph: StageAudioGraph | null = null
  private voices = new Map<string, OwnedInput>()
  private listeners = new Set<(snapshot: NoteSnapshot) => void>()
  private statusListeners = new Set<(status: PianoStatus) => void>()
  private status: PianoStatus
  private voiceId = 0
  private synthPrevious: Partial<Record<SynthLayerId, number>> = {}

  constructor(private state: InstrumentState) {
    const available = typeof window !== 'undefined' && Boolean(window.AudioContext || (window as BrowserAudioWindow).webkitAudioContext)
    this.status = available
      ? { state: 'ready', label: 'Complete Stage 4 engine ready · audio starts on first note' }
      : { state: 'fallback', label: 'Audio unavailable · playable controls in silent fallback' }
  }

  updateState(state: InstrumentState): void {
    const previous = this.state
    this.state = { ...state, sustainDown: this.state.sustainDown }
    const enabled = (candidate: InstrumentState, address: LayerAddress) => {
      const [section, layer] = address.split(':') as ['organ' | 'piano' | 'synth', SynthLayerId]
      if (section === 'organ') return candidate.organ.sectionOn && candidate.organ.layers[layer as LayerId].enabled
      if (section === 'piano') return candidate.sectionOn && candidate.layers[layer as LayerId].enabled
      return candidate.synth.sectionOn && candidate.synth.layers[layer].enabled
    }
    for (const address of ['organ:A', 'organ:B', 'piano:A', 'piano:B', 'synth:A', 'synth:B', 'synth:C'] as LayerAddress[]) {
      if (enabled(previous, address) && !enabled(state, address)) {
        for (const input of this.voices.values()) { input.voices[address]?.stop(); delete input.voices[address] }
      }
    }
    this.graph?.update(this.state)
    this.emit()
  }

  simulateAssetFailure(): void {
    this.setStatus({ state: 'fallback', label: 'PCM library failed · synthesized playable fallback active' })
  }

  noteOn(note: number, velocity: number, sourceId: string): void {
    if (this.voices.has(sourceId)) this.noteOff(sourceId)
    const voices: Partial<Record<LayerAddress, VoiceHandle>> = {}
    for (const layerId of ['A', 'B'] as LayerId[]) {
      if (!this.state.sectionOn || !this.state.layers[layerId].enabled) continue
      const routed = routeLayerGain(this.state, this.state.layers[layerId].zone, note + this.state.transpose)
      if (routed > 0) voices[`piano:${layerId}`] = this.ensureGraph()?.start(layerId, note + this.state.transpose, velocity * routed, ++this.voiceId) ?? { release() {}, stop() {} }
    }
    for (const layerId of ['A', 'B'] as LayerId[]) {
      if (!this.state.organ.sectionOn || !this.state.organ.layers[layerId].enabled) continue
      const routed = routeLayerGain(this.state, this.state.organ.layers[layerId].zone, note + this.state.transpose)
      if (routed > 0) voices[`organ:${layerId}`] = this.ensureGraph()?.startOrgan(layerId, note, velocity, ++this.voiceId, routed) ?? { release() {}, stop() {} }
    }
    for (const layerId of ['A', 'B', 'C'] as SynthLayerId[]) {
      if (!this.state.synth.sectionOn || !this.state.synth.layers[layerId].enabled) continue
      const layer = this.state.synth.layers[layerId]
      if (layer.voiceMode !== 'Poly') {
        const candidates = [...this.voices.values()].filter((input) => input.held).map((input) => input.note).concat(note)
        if (voicePlan(layer, candidates, this.synthPrevious[layerId])[0] !== note) continue
        for (const input of this.voices.values()) { input.voices[`synth:${layerId}`]?.stop(); delete input.voices[`synth:${layerId}`] }
      }
      const routed = routeLayerGain(this.state, this.state.synth.layers[layerId].zone, note + this.state.transpose)
      if (routed > 0) voices[`synth:${layerId}`] = this.ensureGraph()?.startSynth(layerId, note, velocity, ++this.voiceId, routed, this.synthPrevious[layerId]) ?? { release() {}, stop() {} }
      this.synthPrevious[layerId] = note
    }
    this.voices.set(sourceId, { note, held: true, voices })
    this.emit()
  }

  noteOff(sourceId: string): void {
    const input = this.voices.get(sourceId)
    if (!input) return
    input.held = false
    for (const address of Object.keys(input.voices) as LayerAddress[]) {
      const handle = input.voices[address]
      if (!handle) continue
      const [section, layer] = address.split(':') as ['organ' | 'piano' | 'synth', SynthLayerId]
      const sustped = section === 'organ' ? this.state.organ.layers[layer as LayerId].sustped
        : section === 'piano' ? this.state.layers[layer as LayerId].sustped : this.state.synth.layers[layer].sustped
      const arpHold = section === 'synth' && this.state.synth.layers[layer].arpRun && this.state.synth.layers[layer].arpHold
      if (!(this.state.sustainDown && sustped) && !arpHold) { handle.release(); delete input.voices[address] }
    }
    if (Object.keys(input.voices).length === 0) this.voices.delete(sourceId)
    this.emit()
  }

  setSustain(down: boolean): void {
    if (this.state.sustainDown === down) return
    this.state = { ...this.state, sustainDown: down }
    if (!down) {
      for (const [sourceId, input] of this.voices) {
        if (!input.held) {
          for (const handle of Object.values(input.voices)) handle?.release()
          this.voices.delete(sourceId)
        }
      }
    }
    this.emit()
  }

  allNotesOff(): void { for (const input of this.voices.values()) for (const handle of Object.values(input.voices)) handle?.stop(); this.voices.clear(); this.synthPrevious = {}; this.graph?.stopAll(); this.state = { ...this.state, sustainDown: false }; this.emit() }
  dispose(): void { this.allNotesOff(); void this.graph?.dispose(); this.graph = null; this.listeners.clear(); this.statusListeners.clear() }
  snapshot(): NoteSnapshot { return { activeNotes: [...new Set([...this.voices.values()].map((voice) => voice.note))].sort((a, b) => a - b), activeVoiceCount: [...this.voices.values()].reduce((sum, voice) => sum + Object.keys(voice.voices).length, 0), sustain: this.state.sustainDown } }
  getStatus(): PianoStatus { return this.status }
  subscribe(listener: (snapshot: NoteSnapshot) => void): () => void { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener) }
  subscribeStatus(listener: (status: PianoStatus) => void): () => void { this.statusListeners.add(listener); listener(this.status); return () => this.statusListeners.delete(listener) }
  getInstrumentState(): InstrumentState { return this.state }

  private ensureGraph(): StageAudioGraph | null {
    if (this.graph) { if (this.graph.context.state === 'suspended') void this.graph.context.resume(); return this.graph }
    const Context = window.AudioContext || (window as BrowserAudioWindow).webkitAudioContext
    if (!Context) return null
    try {
      this.setStatus({ state: 'starting', label: 'Starting complete Stage 4 engine…' })
      this.graph = new StageAudioGraph(this.state, Context)
      void this.graph.context.resume().then(() => this.setStatus({ state: 'ready', label: 'Complete Stage 4 engine ready' }), () => this.simulateAssetFailure())
      return this.graph
    } catch { this.simulateAssetFailure(); return null }
  }
  private emit(): void { const snapshot = this.snapshot(); for (const listener of this.listeners) listener(snapshot) }
  private setStatus(status: PianoStatus): void { this.status = status; for (const listener of this.statusListeners) listener(status) }
}
