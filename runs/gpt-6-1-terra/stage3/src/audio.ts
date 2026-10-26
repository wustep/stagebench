import samples from './samples.json'
import { DelayUnit } from './delay'
import { ToneEffects } from './tone-effects'
import { Mod1 } from './mod1'
import { Mod2 } from './mod2'
import { Rotary } from './rotary'

export const pianoTypes = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const
export type PianoType = typeof pianoTypes[number]
export interface Voice { release(): void; stop(): void; retune?(note: number, glide: number): void }
export interface AudioBackend { start(note: number, velocity: number, gain?: number): Voice; stopAll?(): void; close(): void }

export class PianoEngine {
  private voices = new Map<string, { voice: Voice; note: number; held: boolean; order: number }>()
  private serial = 0
  private pedal = false
  constructor(private backend: AudioBackend, private limit = 32) {}
  on(id: string, note: number, velocity: number, gain = 1) {
    const previous = this.voices.get(id)
    if (previous) {
      this.voices.delete(id)
      if (this.pedal) { previous.held = false; this.voices.set(`sustained-${this.serial++}`, previous) }
      else previous.voice.release()
    }
    if (this.voices.size >= this.limit) {
      const oldest = [...this.voices.entries()].sort((a, b) => a[1].order - b[1].order)[0]
      oldest[1].voice.stop(); this.voices.delete(oldest[0])
    }
    this.voices.set(id, { voice: gain === 1 ? this.backend.start(note, velocity) : this.backend.start(note, velocity, gain), note, held: true, order: this.serial++ })
  }
  off(id: string) {
    const item = this.voices.get(id)
    if (!item) return
    item.held = false
    if (!this.pedal) { item.voice.release(); this.voices.delete(id) }
  }
  sustain(down: boolean) {
    this.pedal = down
    if (!down) for (const [id, item] of this.voices) if (!item.held) { item.voice.release(); this.voices.delete(id) }
  }
  allOff() { for (const item of this.voices.values()) item.voice.stop(); this.voices.clear(); this.backend.stopAll?.(); this.pedal = false }
  close() { this.allOff(); this.backend.close() }
}

export class WebAudioBackend implements AudioBackend {
  private active = new Map<() => void, number>()
  private cleanups = new Map<() => void, () => void>()
  private master: GainNode
  private layerBuses: GainNode[]
  private layerInputs: GainNode[]
  private delays: (DelayUnit | null)[]
  private mod1: (Mod1 | null)[]
  private mod2: (Mod2 | null)[]
  private toneEffects: (ToneEffects | null)[]
  private limiter: DynamicsCompressorNode | null = null
  private rotary: Rotary | null = null
  private fxEnabled = Array(6).fill(true) as boolean[]
  private unitEnabled = Array.from({length: 6}, () => 0).map(() => ({mod1: false, mod2: false, delay: false, eq: false, comp: false, reverb: false}))
  private ampTypes = Array(6).fill(0) as number[]
  private eqEnabled = Array(6).fill(false) as boolean[]
  private buffers = new Map<string, AudioBuffer>()
  private ready = new Set<PianoType>()
  private pedals = [false, false]
  private bendEnabled = [true, true]
  private bend = 0
  private pitchParams = new Map<AudioParam, {layer: number; offset: number}>()
  private settings = [0, 1].map(() => ({ touch: 1, compression: 0, timbre: 0, softRelease: false, unison: 0, stringRes: false }))
  private pianoTypes: PianoType[] = ['Grand', 'Grand']
  private loadTokens = [0, 0]
  private closed = false
  constructor(private context: AudioContext, level = 0.5) {
    this.master = context.createGain()
    this.master.gain.value = level
    if (typeof context.createDynamicsCompressor === 'function') {
      this.limiter = context.createDynamicsCompressor()
      this.limiter.threshold.value = -3; this.limiter.ratio.value = 20; this.limiter.attack.value = .003; this.limiter.release.value = .1
      this.master.connect(this.limiter); this.limiter.connect(context.destination)
    } else this.master.connect(context.destination)
    this.layerBuses = Array.from({length: 6}, () => context.createGain())
    this.layerInputs = Array.from({length: 6}, () => context.createGain())
    if (typeof context.createStereoPanner === 'function') { this.rotary = new Rotary(context, 6); this.rotary.outputs.forEach((output, i) => output.connect(this.layerBuses[i])) }
    this.toneEffects = this.layerInputs.map((_, index) => {
      if (typeof context.createBiquadFilter !== 'function' || typeof context.createConvolver !== 'function') return null
      const effects = new ToneEffects(context); effects.output.connect(this.rotary?.inputs[index] ?? this.layerBuses[index]); return effects
    })
    this.delays = this.layerInputs.map((_, index) => {
      if (typeof context.createDelay !== 'function') return null
      const delay = new DelayUnit(context); delay.output.connect(this.toneEffects[index]?.input ?? this.layerBuses[index]); return delay
    })
    this.mod2 = this.layerInputs.map((_, index) => {
      const next = this.delays[index]?.input ?? this.toneEffects[index]?.input ?? this.layerBuses[index]
      if (typeof context.createStereoPanner !== 'function') return null
      const unit = new Mod2(context); unit.output.connect(next); return unit
    })
    this.mod1 = this.layerInputs.map((input, index) => {
      const next = this.mod2[index]?.input ?? this.delays[index]?.input ?? this.toneEffects[index]?.input ?? this.layerBuses[index]
      if (typeof context.createStereoPanner !== 'function') { input.connect(next); return null }
      const unit = new Mod1(context); input.connect(unit.input); unit.output.connect(next); return unit
    })
    this.layerBuses.forEach(bus => { bus.gain.value = .5; bus.connect(this.master) })
  }
  extraAudioTarget() { return { context: this.context, input: this.layerInputs[2], inputs: this.layerInputs.slice(2) } }
  setMaster(level: number) {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), this.context.currentTime, 0.015)
  }
  async selectType(type: PianoType, report: (message: string) => void, layer = 0) {
    this.pianoTypes[layer] = type
    const token = ++this.loadTokens[layer]
    if (pianoTypes.indexOf(type) >= 3) { report(`${type} · synthesized`); return }
    const rows = samples.filter(sample => sample.file.includes(`/${type.toLowerCase()}/`))
    report(`${type} loading · synthesized fallback`)
    try {
      await Promise.all(rows.map(async sample => {
        if (this.buffers.has(sample.file)) return
        const response = await fetch(`${import.meta.env.BASE_URL}${sample.file.replace(/^public\//, '')}`)
        if (!response.ok) throw new Error('sample fetch failed')
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer())
        if (!this.closed) this.buffers.set(sample.file, buffer)
      }))
      if (!this.closed) this.ready.add(type)
      if (!this.closed && token === this.loadTokens[layer]) report(`${type} · recorded samples ready`)
    } catch {
      if (!this.closed && token === this.loadTokens[layer]) report(`${type} sample error · playable synthesized fallback`)
    }
  }
  setClockRate(layer: number, hz: number) { this.mod1[layer]?.setClockRate(hz) }
  setDelaySeconds(layer: number, seconds: number) { this.delays[layer]?.setSeconds(seconds) }
  setMod2(layer: number, key: 'on' | 'type' | 'rate' | 'amount', value: number) {
    const unit = this.mod2[layer]; if (!unit) return
    if (key === 'on') { this.unitEnabled[layer].mod2 = !!value; unit.setOn(!!value && this.fxEnabled[layer]) } else if (key === 'type') unit.setType(value); else if (key === 'rate') unit.setRate(value); else unit.setAmount(value)
  }
  setMod1(layer: number, key: 'on' | 'type' | 'rate' | 'amount', value: number) {
    const unit = this.mod1[layer]; if (!unit) return
    if (key === 'on') { this.unitEnabled[layer].mod1 = !!value; unit.setOn(!!value && this.fxEnabled[layer]) } else if (key === 'type') unit.setType(value); else if (key === 'rate') unit.setRate(value); else unit.setAmount(value)
  }
  setDelay(layer: number, setting: 'on' | 'amount' | 'tempo' | 'feedback' | 'filter', value: number) {
    const delay = this.delays[layer]; if (!delay) return
    if (setting === 'on') { this.unitEnabled[layer].delay = !!value; delay.setOn(!!value && this.fxEnabled[layer]) }
    else if (setting === 'amount') delay.setAmount(value)
    else if (setting === 'tempo') delay.setTempo(value)
    else if (setting === 'feedback') delay.setFeedback(value)
    else delay.setFilter((['off', 'lowpass', 'highpass', 'bandpass'] as const)[Math.max(0, Math.min(3, value))])
  }
  setTone(layer: number, key: 'eqOn' | 'compOn' | 'reverbOn' | 'bass' | 'mid' | 'treble' | 'compression' | 'reverbMix' | 'reverbType' | 'ampType' | 'drive' | 'frequency' | 'fast' | 'brightness', value: number) {
    const unit = this.toneEffects[layer]; if (!unit) return
    if (key === 'ampType') { this.ampTypes[layer] = value; unit.setAmpType(value); this.rotary?.setOn(layer, value === 6 && this.eqEnabled[layer] && this.fxEnabled[layer]); return }
    if (key === 'drive') { unit.setDrive(value); return }
    if (key === 'frequency') { unit.setFrequency(value); return }
    if (key === 'fast') { unit.setFast(!!value); return }
    if (key === 'brightness') { unit.setBrightness(!!value); return }
    if (key === 'eqOn') { this.eqEnabled[layer] = !!value; this.unitEnabled[layer].eq = !!value; this.rotary?.setOn(layer, !!value && this.fxEnabled[layer] && this.ampTypes[layer] === 6) }
    if (key === 'compOn') this.unitEnabled[layer].comp = !!value
    if (key === 'reverbOn') this.unitEnabled[layer].reverb = !!value
    if (key === 'eqOn' || key === 'compOn' || key === 'reverbOn') unit.setOn(key === 'eqOn' ? 0 : key === 'compOn' ? 1 : 2, !!value && this.fxEnabled[layer])
    else if (key === 'bass' || key === 'mid' || key === 'treble') unit.setEq(key, value)
    else if (key === 'compression') unit.setCompression(value)
    else if (key === 'reverbMix') unit.setReverbMix(value)
    else unit.setReverbType(value)
  }
  setEffectsEnabled(layer: number, on: boolean) {
    this.fxEnabled[layer] = on; const u = this.unitEnabled[layer]
    this.mod1[layer]?.setOn(on && u.mod1); this.mod2[layer]?.setOn(on && u.mod2); this.delays[layer]?.setOn(on && u.delay)
    this.toneEffects[layer]?.setOn(0, on && u.eq); this.toneEffects[layer]?.setOn(1, on && u.comp); this.toneEffects[layer]?.setOn(2, on && u.reverb)
    this.rotary?.setOn(layer, on && u.eq && this.ampTypes[layer] === 6)
  }
  setRotary(key: 'fast' | 'drive', value: number) { if (key === 'fast') this.rotary?.setSpeed(value); else this.rotary?.setDrive(value) }
  setOrganRotary(on: boolean) { this.rotary?.setOn(2, on) }
  private trackPitch(param: AudioParam | undefined, layer: number, offset = 0) { if (!param) return; this.pitchParams.set(param, {layer, offset}); param.value = offset + (this.bendEnabled[layer] ? this.bend : 0) }
  setPitch(value: number) { this.bend = Math.max(-200, Math.min(200, value)); this.refreshPitch() }
  setPitchEnabled(layer: number, enabled: boolean) { this.bendEnabled[layer] = enabled; this.refreshPitch() }
  private refreshPitch() { for (const [param, info] of this.pitchParams) param.setTargetAtTime(info.offset + (this.bendEnabled[info.layer] ? this.bend : 0), this.context.currentTime, .015) }
  setPedal(layer: number, down: boolean) { this.pedals[layer] = down }
  setPianoSetting(layer: number, setting: 'touch' | 'compression' | 'timbre' | 'softRelease' | 'unison' | 'stringRes', value: number) {
    const state = this.settings[layer]
    if (setting === 'softRelease' || setting === 'stringRes') state[setting] = !!value
    else state[setting] = value
  }
  setLayerLevel(layer: number, value: number) { this.layerBuses[layer].gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.context.currentTime, .015) }
  start(note: number, velocity: number, layer = 0, amplitude = 1): Voice {
    const pianoType = this.pianoTypes[layer]
    const settings = this.settings[layer]
    const raw = velocity / 127
    const curved = raw ** ([1.5, 1, .7][settings.touch] ?? 1)
    const loudness = curved ** (1 / (1 + settings.compression * .35)) * amplitude
    const target = velocity < 64 ? 'soft' : 'hard'
    const rows = this.ready.has(pianoType) ? samples.filter(sample => sample.file.includes(`/${pianoType.toLowerCase()}/`) && this.buffers.has(sample.file)) : []
    rows.sort((a, b) => {
      const score = (row: typeof a) => Math.abs(note - row.root) + (row.velocity.includes(target) ? 0 : 3)
      return score(a) - score(b)
    })
    const selected = rows[0]
    const color = typeof this.context.createBiquadFilter === 'function' ? this.context.createBiquadFilter() : null
    if (color) { color.type = settings.timbre === 1 ? 'lowpass' : 'highshelf'; color.frequency.value = settings.timbre === 1 ? 1400 : 2500; color.gain.value = settings.timbre === 2 ? 4 : settings.timbre === 3 ? 9 : settings.timbre === 4 ? 12 : settings.timbre === 5 ? 15 * raw : 0; color.connect(this.layerInputs[layer]) }
    const targetNode = color ?? this.layerInputs[layer]
    const releaseTime = settings.softRelease && pianoType !== 'Clav' ? .2 : .12
    if (selected) {
      const t = this.context.currentTime
      const source = this.context.createBufferSource()
      const gain = this.context.createGain()
      source.buffer = this.buffers.get(selected.file)!
      source.playbackRate.value = 2 ** ((note - selected.root) / 12)
      this.trackPitch(source.detune, layer)
      source.connect(gain); gain.connect(targetNode)
      gain.gain.setValueAtTime(Math.max(.001, loudness * .3), t)
      source.start(t)
      const doubled = settings.unison ? this.context.createBufferSource() : null
      const unisonPan = doubled && typeof this.context.createStereoPanner === 'function' ? this.context.createStereoPanner() : null
      if (unisonPan) { unisonPan.pan.value = .65; unisonPan.connect(gain) }
      if (doubled) { doubled.buffer = source.buffer; doubled.playbackRate.value = source.playbackRate.value; this.trackPitch(doubled.detune, layer, settings.unison * 5); doubled.connect(unisonPan ?? gain); doubled.start(t) }
      const resonance = settings.stringRes && ([...this.active.values()].includes(layer) || this.pedals[layer]) ? this.context.createOscillator() : null
      const resonanceGain = resonance ? this.context.createGain() : null
      if (resonance && resonanceGain) { resonance.type = 'sine'; resonance.frequency.value = 440 * 2 ** ((note - 69) / 12) * 2; resonanceGain.gain.value = .08; resonance.connect(resonanceGain); resonanceGain.connect(gain); resonance.start(t) }
      let stopped = false
      const force = (quick = false) => {
        if (stopped) return
        stopped = true
        const now = this.context.currentTime
        gain.gain.cancelScheduledValues(now)
        gain.gain.setTargetAtTime(.0001, now, quick ? .005 : releaseTime)
        const end = now + (quick ? .04 : .8)
        source.stop(end); doubled?.stop(end); resonance?.stop(end)
      }
      const stop = () => force(true)
      const cleanup = () => { this.active.delete(stop); this.cleanups.delete(stop); this.pitchParams.delete(source.detune); if (doubled) this.pitchParams.delete(doubled.detune); source.disconnect(); doubled?.disconnect(); unisonPan?.disconnect(); resonance?.disconnect(); resonanceGain?.disconnect(); gain.disconnect(); color?.disconnect() }
      source.onended = () => { if (!stopped) { try { doubled?.stop(); resonance?.stop() } catch { /* Already ended. */ } }; stopped = true; cleanup() }
      this.active.set(stop, layer); this.cleanups.set(stop, cleanup)
      return { release: () => force(), stop }
    }
    const t = this.context.currentTime
    const gain = this.context.createGain()
    const fundamental = this.context.createOscillator()
    const overtone = this.context.createOscillator()
    const overtoneGain = this.context.createGain()
    const hz = 440 * 2 ** ((note - 69) / 12)
    this.trackPitch(fundamental.detune, layer); this.trackPitch(overtone.detune, layer)
    fundamental.type = pianoType === 'Clav' ? 'sawtooth' : pianoType === 'Digital' ? 'square' : pianoType === 'Misc' ? 'sine' : 'triangle'; fundamental.frequency.value = hz
    overtone.type = 'sine'; overtone.frequency.value = hz * (pianoType === 'Misc' ? 4 : 2)
    overtoneGain.gain.value = 0.22
    fundamental.connect(gain); overtone.connect(overtoneGain); overtoneGain.connect(gain); gain.connect(targetNode)
    const level = Math.max(0.001, loudness * 0.23)
    gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(level, t + 0.008)
    gain.gain.exponentialRampToValueAtTime(level * (pianoType === 'Misc' ? .03 : .24), t + (pianoType === 'Misc' ? .35 : 1.2))
    fundamental.start(); overtone.start()
    const doubled = settings.unison ? this.context.createOscillator() : null
    const unisonPan = doubled && typeof this.context.createStereoPanner === 'function' ? this.context.createStereoPanner() : null
    if (unisonPan) { unisonPan.pan.value = .65; unisonPan.connect(gain) }
    if (doubled) { doubled.type = fundamental.type; doubled.frequency.value = hz; this.trackPitch(doubled.detune, layer, settings.unison * 5); doubled.connect(unisonPan ?? gain); doubled.start() }
    const resonance = settings.stringRes && ([...this.active.values()].includes(layer) || this.pedals[layer]) ? this.context.createOscillator() : null
    const resonanceGain = resonance ? this.context.createGain() : null
    if (resonance && resonanceGain) { resonance.type = 'sine'; resonance.frequency.value = hz * 3; resonanceGain.gain.value = .08; resonance.connect(resonanceGain); resonanceGain.connect(gain); resonance.start() }
    let stopped = false
    const end = (quick: boolean) => {
      if (stopped && !quick) return
      stopped = true
      const now = this.context.currentTime
      gain.gain.cancelScheduledValues(now); gain.gain.setTargetAtTime(0.0001, now, quick ? 0.005 : releaseTime)
      const finish = now + (quick ? 0.04 : 0.8)
      fundamental.stop(finish); overtone.stop(finish); doubled?.stop(finish); resonance?.stop(finish)
    }
    const force = () => end(true)
    const cleanup = () => { this.active.delete(force); this.cleanups.delete(force); this.pitchParams.delete(fundamental.detune); this.pitchParams.delete(overtone.detune); if (doubled) this.pitchParams.delete(doubled.detune); fundamental.disconnect(); overtone.disconnect(); doubled?.disconnect(); unisonPan?.disconnect(); resonance?.disconnect(); resonanceGain?.disconnect(); overtoneGain.disconnect(); gain.disconnect(); color?.disconnect() }
    fundamental.onended = cleanup
    this.active.set(force, layer); this.cleanups.set(force, cleanup)
    return { release: () => end(false), stop: force }
  }
  diagnostics() { return { activeVoices: this.active.size, pitchParameters: this.pitchParams.size, closed: this.closed } }
  stopAll() { for (const stop of this.active.keys()) stop() }
  close() { this.closed = true; this.pitchParams.clear(); this.loadTokens = this.loadTokens.map(token => token + 1); this.stopAll(); for (const cleanup of this.cleanups.values()) cleanup(); this.layerInputs.forEach(bus => bus.disconnect()); this.mod1.forEach(unit => unit?.close()); this.mod2.forEach(unit => unit?.close()); this.delays.forEach(delay => delay?.close()); this.toneEffects.forEach(effects => effects?.close()); this.rotary?.close(); this.layerBuses.forEach(bus => bus.disconnect()); this.master.disconnect(); this.limiter?.disconnect(); void this.context.close() }
}

// Each layer owns its voices; a shared backend owns the AudioContext and buses.
export class LayeredPiano {
  private engines: PianoEngine[]
  private enabled = [true, false]
  private sectionEnabled = true
  private sustainEnabled = [true, true]
  private octaves = [0, 0]
  private pedal = false
  constructor(private backend: WebAudioBackend) {
    this.engines = [0, 1].map(layer => new PianoEngine({
      start: (note, velocity, gain) => backend.start(note + this.octaves[layer] * 12, velocity, layer, gain),
      close: () => {},
    }))
  }
  setSectionEnabled(enabled: boolean) { this.sectionEnabled = enabled; if (!enabled) this.allOff() }
  setEnabled(layer: number, enabled: boolean) { this.enabled[layer] = enabled; if (!enabled) this.engines[layer].allOff() }
  setSustainEnabled(layer: number, enabled: boolean) { this.sustainEnabled[layer] = enabled; this.engines[layer].sustain(this.pedal && enabled); this.backend.setPedal(layer, this.pedal && enabled) }
  setOctave(layer: number, octave: number) { this.octaves[layer] = octave }
  on(id: string, note: number, velocity: number, gains = [1, 1]) { this.engines.forEach((engine, i) => { if (this.sectionEnabled && this.enabled[i] && gains[i] > 0) engine.on(id, note, velocity, gains[i]) }) }
  off(id: string) { this.engines.forEach(engine => engine.off(id)) }
  sustain(down: boolean) { this.pedal = down; this.engines.forEach((engine, i) => { engine.sustain(down && this.sustainEnabled[i]); this.backend.setPedal(i, down && this.sustainEnabled[i]) }) }
  allOff() { this.engines.forEach(engine => engine.allOff()); this.backend.stopAll(); this.pedal = false; this.backend.setPedal(0, false); this.backend.setPedal(1, false) }
  close() { this.allOff(); this.backend.close() }
}
