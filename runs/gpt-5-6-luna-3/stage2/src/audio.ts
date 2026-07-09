export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'
export type LayerName = 'A' | 'B'
export type EffectUnitName = 'mod1' | 'mod2' | 'delay' | 'ampEq' | 'compressor' | 'reverb'

export type LayerSettings = {
  enabled: boolean
  focus: boolean
  level: number
  octave: -1 | 0 | 1
  sustainPed: boolean
  pitchStick: boolean
}

export type EffectSettings = {
  on: boolean
  type?: string
  amount: number
  rate: number
  dryWet: number
  feedback: number
  bright: number
  drive: number
  global: boolean
  fast: boolean
  toRotary?: boolean
}

export type EngineState = {
  sectionOn: boolean
  type: PianoType
  kbTouch: 'Heavy' | 'Medium' | 'Light'
  dynComp: 0 | 1 | 2 | 3
  timbre: number
  unison: 0 | 1 | 2 | 3
  softRelease: boolean
  stringRes: boolean
  masterLevel: number
  pianoGroup: boolean
  effectsBypass: boolean
  rotaryOn: boolean
  rotaryDrive: number
  layers: Record<LayerName, LayerSettings>
  effects: Record<LayerName, Record<EffectUnitName, EffectSettings>>
}

type RuntimeVoice = {
  id: number
  note: number
  layer: LayerName
  oscillators: OscillatorNode[]
  gain: GainNode
  released: boolean
  sustained: boolean
}

type UnitRuntime = {
  dry: GainNode
  wet: GainNode
  mix: GainNode
  processor: AudioNode
  delayFeedback?: GainNode
  delayFilter?: BiquadFilterNode
}

const PROFILE: Record<PianoType, { harmonics: number[]; wave: OscillatorType; brightness: number }> = {
  Grand: { harmonics: [1, 0.22, 0.08, 0.025], wave: 'triangle', brightness: 1.0 },
  Upright: { harmonics: [1, 0.34, 0.16, 0.06], wave: 'triangle', brightness: 0.72 },
  Electric: { harmonics: [1, 0.08, 0.3, 0.18], wave: 'sine', brightness: 1.2 },
  Clav: { harmonics: [1, 0.6, 0.42, 0.2], wave: 'square', brightness: 1.6 },
  Digital: { harmonics: [1, 0.18, 0.02, 0.1], wave: 'sine', brightness: 1.45 },
  Misc: { harmonics: [1, 0.42, 0.12, 0.3], wave: 'sine', brightness: 1.8 },
}

const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump']
const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin']
const AMP_TYPES = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary']
const REVERB_TYPES = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral']

function curveFor(kind: string, amount: number) {
  const curve = new Float32Array(256)
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / 127.5) - 1
    const shaped = kind.includes('Ring') ? Math.sin(x * Math.PI * (2 + amount * 12)) * Math.abs(x) : Math.tanh(x * (1 + amount * 8))
    curve[index] = kind.includes('Wah') || kind.includes('Filter') ? shaped * (0.65 + Math.abs(x) * amount) : shaped
  }
  return curve
}

function impulse(context: BaseAudioContext, seconds: number, bright: number) {
  const length = Math.max(256, Math.floor(context.sampleRate * seconds))
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < length; index += 1) {
      const decay = Math.pow(1 - index / length, 2.4)
      data[index] = (Math.random() * 2 - 1) * decay * (channel === 0 ? 1 : bright)
    }
  }
  return buffer
}

export class PianoAudioEngine {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private readonly layerInputs = new Map<LayerName, GainNode>()
  private readonly layerLevels = new Map<LayerName, GainNode>()
  private readonly units = new Map<LayerName, Map<EffectUnitName, UnitRuntime>>()
  private readonly layerRotary = new Map<LayerName, GainNode>()
  private readonly voices: RuntimeVoice[] = []
  private nextVoiceId = 1
  private sustain = false
  private state: EngineState
  private readonly onStatus: (message: string) => void

  constructor(state: EngineState, onStatus: (message: string) => void) {
    this.state = state
    this.onStatus = onStatus
  }

  private createContext() {
    const windowWithWebkit = window as Window & { webkitAudioContext?: typeof AudioContext }
    const AudioContextConstructor = window.AudioContext ?? windowWithWebkit.webkitAudioContext
    if (!AudioContextConstructor) throw new Error('Web Audio is not available; playable fallback remains available.')
    return new AudioContextConstructor()
  }

  private ensureGraph() {
    if (this.context) return this.context
    const context = this.createContext()
    this.context = context
    this.master = context.createGain()
    this.limiter = context.createDynamicsCompressor()
    this.limiter.threshold.value = -1
    this.limiter.knee.value = 3
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.003
    this.limiter.release.value = 0.15
    this.master.connect(this.limiter).connect(context.destination)

    for (const layer of ['A', 'B'] as LayerName[]) {
      const input = context.createGain()
      const level = context.createGain()
      input.gain.value = 1
      input.connect(level)
      level.connect(this.master)
      this.layerInputs.set(layer, input)
      this.layerLevels.set(layer, level)
      this.units.set(layer, this.buildUnits(context, input, level, layer))
    }
    this.applyState()
    this.onStatus('library ready · bundled model set / playable fallback')
    return context
  }

  private buildUnits(context: AudioContext, input: GainNode, level: GainNode, layer: LayerName) {
    const names: EffectUnitName[] = ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb']
    const units = new Map<EffectUnitName, UnitRuntime>()
    let current: AudioNode = input
    for (const name of names) {
      const dry = context.createGain()
      const wet = context.createGain()
      const mix = context.createGain()
      const processor: AudioNode = name === 'delay' ? context.createDelay(2.5)
        : name === 'compressor' ? context.createDynamicsCompressor()
          : name === 'reverb' ? context.createConvolver()
            : name === 'mod1' || name === 'mod2' || name === 'ampEq' ? context.createWaveShaper()
              : context.createGain()
      current.connect(dry)
      current.connect(processor)
      processor.connect(wet)
      dry.connect(mix)
      wet.connect(mix)
      current = mix
      const runtime: UnitRuntime = { dry, wet, mix, processor }
      if (name === 'delay') {
        const feedback = context.createGain()
        const filter = context.createBiquadFilter()
        filter.type = 'lowpass'
        processor.connect(filter).connect(feedback).connect(processor)
        runtime.delayFeedback = feedback
        runtime.delayFilter = filter
      }
      units.set(name, runtime)
    }
    current.connect(level)
    // The final rotary is represented by one phase-coherent panner per layer. Both
    // layer sends share the same master path and are never connected to destination directly.
    const rotary = context.createGain()
    current.connect(rotary)
    rotary.gain.value = 0
    rotary.connect(this.master as GainNode)
    this.layerRotary.set(layer, rotary)
    return units
  }

  setState(state: EngineState) {
    this.state = state
    if (this.context) this.applyState()
  }

  private applyState() {
    if (!this.context || !this.master) return
    const now = this.context.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.linearRampToValueAtTime(Math.max(0.0001, this.state.masterLevel), now + 0.02)
    for (const layer of ['A', 'B'] as LayerName[]) {
      const settings = this.state.layers[layer]
      const layerEffects = this.state.effects[layer]
      const rotaryActive = this.state.rotaryOn || layerEffects.ampEq.toRotary === true
      this.layerLevels.get(layer)?.gain.linearRampToValueAtTime(settings.enabled && this.state.sectionOn && !rotaryActive ? settings.level : 0, now + 0.02)
      this.layerRotary.get(layer)?.gain.linearRampToValueAtTime(settings.enabled && this.state.sectionOn && rotaryActive ? Math.max(0.0001, settings.level * (0.55 + this.state.rotaryDrive * 0.45)) : 0, now + 0.03)
      const runtimeMap = this.units.get(layer)
      if (!runtimeMap) continue
      for (const name of ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'] as EffectUnitName[]) {
        const effect = layerEffects[name]
        const runtime = runtimeMap.get(name)
        if (!effect || !runtime) continue
        const wet = this.state.effectsBypass || !effect.on ? 0 : Math.max(0, Math.min(1, effect.dryWet || effect.amount))
        runtime.dry.gain.setTargetAtTime(this.state.effectsBypass || !effect.on ? 1 : 1 - wet, now, 0.01)
        runtime.wet.gain.setTargetAtTime(wet, now, 0.01)
        if (runtime.processor instanceof WaveShaperNode) {
          const type = effect.type ?? name
          runtime.processor.curve = curveFor(type, effect.amount)
          runtime.processor.oversample = '2x'
        }
        if (name === 'delay' && runtime.processor instanceof DelayNode) {
          runtime.processor.delayTime.setTargetAtTime(0.08 + effect.rate * 0.72, now, 0.01)
          runtime.delayFeedback?.gain.setTargetAtTime(effect.feedback * 0.78, now, 0.02)
          if (runtime.delayFilter) runtime.delayFilter.frequency.setTargetAtTime(effect.bright < 0.34 ? 850 : effect.bright > 0.66 ? 7200 : 2600, now, 0.02)
        }
        if (name === 'compressor' && runtime.processor instanceof DynamicsCompressorNode) {
          runtime.processor.threshold.setTargetAtTime(-6 - effect.amount * 42, now, 0.02)
          runtime.processor.ratio.setTargetAtTime(1 + effect.amount * 11, now, 0.02)
          runtime.processor.attack.setTargetAtTime(effect.fast ? 0.002 : 0.02, now, 0.02)
        }
        if (name === 'reverb' && runtime.processor instanceof ConvolverNode) {
          const durations: Record<string, number> = { Booth: 0.18, Room: 0.45, Spring: 0.72, Stage: 1.1, Hall: 1.8, Cathedral: 3.2 }
          runtime.processor.buffer = impulse(this.context, durations[effect.type ?? 'Room'] ?? 0.45, effect.bright > 0.5 ? 1 : 0.55)
        }
      }
    }
  }

  noteOn(note: number, velocity: number) {
    try {
      const context = this.ensureGraph()
      void context.resume()
      while (this.voices.length >= 24) this.releaseVoice(this.voices[0], 0.018)
      const now = context.currentTime
      const profile = PROFILE[this.state.type]
      const touch = this.state.kbTouch === 'Heavy' ? Math.pow(velocity / 127, 1.35) : this.state.kbTouch === 'Light' ? Math.sqrt(velocity / 127) : velocity / 127
      const dyn = this.state.dynComp ? 0.56 + (touch * 0.44) / (1 + this.state.dynComp * 0.32) : touch
      for (const layer of ['A', 'B'] as LayerName[]) {
        const settings = this.state.layers[layer]
        if (!this.state.sectionOn || !settings.enabled) continue
        const shifted = note + settings.octave * 12
        const gain = context.createGain()
        gain.gain.setValueAtTime(0.0001, now)
        const peak = Math.max(0.012, dyn * settings.level * 0.15)
        gain.gain.exponentialRampToValueAtTime(peak, now + 0.012)
        gain.connect(this.layerInputs.get(layer) as GainNode)
        const detunes = this.state.unison ? [-1, 1, 0].slice(0, this.state.unison + 1) : [0]
        const oscillators = detunes.flatMap((detune, index) => profile.harmonics.map((harmonic, harmonicIndex) => {
          const oscillator = context.createOscillator()
          const partialGain = context.createGain()
          oscillator.type = profile.wave
          oscillator.frequency.value = 440 * Math.pow(2, (shifted - 69) / 12) * (harmonicIndex + 1) * Math.pow(2, detune / 1200)
          const timbreShape = harmonicIndex === 0 ? 1 : Math.max(0.22, 0.48 + (this.state.timbre - 0.5) * (harmonicIndex * 0.7))
          partialGain.gain.value = harmonic * profile.brightness * timbreShape / (index === 0 ? 1 : 2.7)
          oscillator.connect(partialGain).connect(gain)
          oscillator.start(now)
          return oscillator
        }))
        this.voices.push({ id: this.nextVoiceId++, note, layer, oscillators, gain, released: false, sustained: false })
      }
      if (this.state.stringRes && this.sustain) this.triggerResonance(note, now)
    } catch (error) {
      this.onStatus(error instanceof Error ? `fallback active · ${error.message}` : 'fallback active · audio unavailable')
    }
  }

  private triggerResonance(note: number, now: number) {
    if (!this.context) return
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 440 * Math.pow(2, (note - 69) / 12) * 2
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.018, now + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9)
    oscillator.connect(gain).connect(this.layerInputs.get('A') as GainNode)
    oscillator.start(now)
    oscillator.stop(now + 0.95)
  }

  noteOff(note: number) {
    const matching = [...this.voices].reverse().find((voice) => voice.note === note && !voice.released)
    if (!matching) return
    const sameNote = this.voices.filter((voice) => voice.note === note && !voice.released)
    sameNote.forEach((voice) => { if (this.sustain && this.state.layers[voice.layer].sustainPed) voice.sustained = true; else this.releaseVoice(voice, this.state.softRelease && this.state.type !== 'Clav' ? 0.58 : 0.35) })
  }

  setSustain(pressed: boolean) {
    this.sustain = pressed
    if (!pressed) this.voices.filter((voice) => voice.sustained && !voice.released).forEach((voice) => this.releaseVoice(voice, 0.35))
  }

  allNotesOff() { this.sustain = false; this.voices.slice().forEach((voice) => this.releaseVoice(voice, 0.025)) }

  dispose() {
    this.allNotesOff()
    const context = this.context
    this.context = null
    this.master = null
    if (context) void context.close()
  }

  private releaseVoice(voice: RuntimeVoice | undefined, duration: number) {
    if (!voice || voice.released) return
    voice.released = true
    if (!this.context) return
    const now = this.context.currentTime
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now)
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    voice.oscillators.forEach((oscillator) => oscillator.stop(now + duration + 0.02))
    window.setTimeout(() => {
      voice.oscillators.forEach((oscillator) => oscillator.disconnect())
      voice.gain.disconnect()
      const index = this.voices.findIndex((candidate) => candidate.id === voice.id)
      if (index >= 0) this.voices.splice(index, 1)
    }, (duration + 0.04) * 1000)
  }
}

export { MOD1_TYPES, MOD2_TYPES, AMP_TYPES, REVERB_TYPES }
