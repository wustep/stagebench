import type { LayerId } from '../../engine/state'
import type { EngineState } from '../../engine/state'
import { percussionDecaySeconds, percussionLevel, percussionPartial, vibDepthStep, vibIsChorus, type OrganLayerState, type OrganModel, type VibMode } from '../../engine/organ'
import type { EngineDeps, LayerVoiceEngine } from '../engineTypes'
import { ramp, Rig } from '../effects/rig'
import { midiToHz } from '../pianoDsp'
import type { AudioBufferLike, AudioContextLike, AudioNodeLike, BiquadLike, BufferSourceLike, GainNodeLike, OscillatorLike, PeriodicWaveLike, Scheduler } from '../types'
import { organSpectrum, spectrumKey, spectrumPeak, spectrumPower, voxMix, type Spectrum } from './spectra'

export const ORGAN_STEAL_FADE_S = 0.02
const ORGAN_MAX_VOICES = 32

/** attack / release of the key contact per model: tonewheel contacts are quick, pipes speak slowly */
const ENVELOPE: Record<OrganModel, { attack: number; release: number }> = {
  B3: { attack: 0.006, release: 0.03 },
  'B3 Bass': { attack: 0.008, release: 0.05 },
  Vox: { attack: 0.01, release: 0.045 },
  Farf: { attack: 0.014, release: 0.07 },
  'Pipe 1': { attack: 0.055, release: 0.22 },
  'Pipe 2': { attack: 0.045, release: 0.18 },
}

/** vibrato/chorus depth (peak cents) for steps 1..3, as on the scanner vibrato */
const VIB_CENTS = [0, 6, 12, 20]
const VIB_HZ = 6.8
const VIB_BASE_DELAY = 0.0008
const centsToDelayDepth = (cents: number): number => cents / (1731 * 2 * Math.PI * VIB_HZ)

export const organLevelTarget = (spec: Spectrum): number => {
  const power = Math.max(0.35, spectrumPower(spec))
  const gain = 0.085 / Math.pow(power, 0.65)
  return Math.min(gain, 0.55 / Math.max(1, spectrumPeak(spec)))
}

interface OrganVoice {
  layer: LayerId
  note: number
  model: OrganModel
  env: GainNodeLike
  /** registration level (restored after the unit-peak periodic wave) */
  trim: GainNodeLike
  osc: OscillatorLike
  spectrumSig: string
  /** Vox: dark and bright paths */
  paths: { dark: GainNodeLike; bright: GainNodeLike } | null
  sources: Array<OscillatorLike | BufferSourceLike>
  nodes: AudioNodeLike[]
  timer: number | null
  releasing: boolean
  done: boolean
}

interface VibUnit {
  input: GainNodeLike
  dry: GainNodeLike
  wet: GainNodeLike
  lfoDepth: GainNodeLike
  rig: Rig
  /** the sweep oscillator exists only once the unit has been switched on */
  lfoStarted: boolean
}

/**
 * Organ engine: two layers (A, B), one PeriodicWave oscillator per note carrying the whole drawbar registration of the layer's
 * model, plus the extras of each model (B3 percussion and key click, pipe chiff). Each layer passes through a scanner-style
 * vibrato/chorus unit and then goes to `outputs[layer]` (the graph's per-layer organ level, then the one shared effect chain).
 */
export class OrganEngine implements LayerVoiceEngine<LayerId> {
  private readonly ctx: AudioContextLike
  private readonly scheduler: Scheduler
  private readonly rig: Rig
  private readonly voices = new Set<OrganVoice>()
  private readonly held = new Map<LayerId, Set<number>>([
    ['A', new Set()],
    ['B', new Set()],
  ])
  private readonly buses: Record<LayerId, GainNodeLike>
  private readonly vib: Record<LayerId, VibUnit>
  private readonly waves = new Map<string, PeriodicWaveLike>()
  private noise: AudioBufferLike | null = null
  private clickSeq = 0x4e6f72
  private state: EngineState
  private disposed = false

  /** `keyClick: false` exists so tests can hear what the fixed-level B3 key click adds; the instrument always leaves it on */
  constructor(
    deps: EngineDeps<LayerId>,
    private readonly options: { keyClick?: boolean } = {},
  ) {
    this.ctx = deps.ctx
    this.scheduler = deps.scheduler
    this.state = deps.state
    this.rig = new Rig(deps.ctx)
    this.buses = { A: this.rig.gain(1), B: this.rig.gain(1) }
    this.vib = { A: this.buildVib(this.buses.A, deps.outputs.A), B: this.buildVib(this.buses.B, deps.outputs.B) }
    this.setState(deps.state, true)
  }

  // --- vibrato / chorus ---------------------------------------------------------------------------------------
  private buildVib(input: AudioNodeLike, output: AudioNodeLike): VibUnit {
    const rig = new Rig(this.ctx)
    const inGain = rig.gain(1)
    const dry = rig.gain(1)
    const wet = rig.gain(0)
    const delay = rig.delay(0.02, VIB_BASE_DELAY)
    const lfoDepth = rig.gain(0)
    input.connect(inGain)
    inGain.connect(dry)
    inGain.connect(delay)
    delay.connect(wet)
    lfoDepth.connect(delay.delayTime)
    dry.connect(output)
    wet.connect(output)
    return { input: inGain, dry, wet, lfoDepth, rig, lfoStarted: false }
  }

  private applyVib(layer: LayerId, unit: VibUnit, on: boolean, mode: VibMode) {
    const step = vibDepthStep(mode)
    const chorus = vibIsChorus(mode)
    if (on && !unit.lfoStarted) {
      // the sweep oscillator is only built once vibrato/chorus is first switched on
      unit.lfoStarted = true
      unit.rig.osc('sine', VIB_HZ).connect(unit.lfoDepth)
    }
    ramp(this.ctx, unit.lfoDepth.gain, on ? centsToDelayDepth(VIB_CENTS[step]) : 0, 0.03)
    // vibrato = only the swept path, chorus = swept path mixed with the original
    ramp(this.ctx, unit.dry.gain, !on ? 1 : chorus ? 0.72 : 0, 0.03)
    ramp(this.ctx, unit.wet.gain, !on ? 0 : chorus ? 0.72 : 1, 0.03)
    void layer
  }

  // --- state ---------------------------------------------------------------------------------------------------
  setState(state: EngineState, initial = false): void {
    if (this.disposed) return
    const previous = this.state
    this.state = state
    for (const layer of ['A', 'B'] as const) {
      const l = state.organ.layers[layer]
      if (initial || previous.organ.layers[layer].vibOn !== l.vibOn || previous.organ.vibMode !== state.organ.vibMode) this.applyVib(layer, this.vib[layer], l.vibOn, state.organ.vibMode)
    }
    for (const v of this.voices) {
      if (v.done) continue
      const l = state.organ.layers[v.layer]
      if (v.osc.detune) ramp(this.ctx, v.osc.detune, l.pitchStick ? state.pitchBend * 200 : 0, 0.02)
      // a drawbar move re-shapes sounding notes (only while the voice's model is still the layer's model)
      if (v.model === l.model) {
        const sig = spectrumKey(l.model, l.drawbars)
        if (sig !== v.spectrumSig) {
          v.osc.setPeriodicWave(this.wave(l.model, l.drawbars, v.note))
          ramp(this.ctx, v.trim.gain, this.registrationLevel(l.model, l.drawbars, v.note), 0.02)
          v.spectrumSig = sig
        }
        if (v.paths) {
          const mix = voxMix(l.drawbars)
          ramp(this.ctx, v.paths.dark.gain, mix.filtered, 0.02)
          ramp(this.ctx, v.paths.bright.gain, mix.unfiltered, 0.02)
        }
      }
    }
  }

  // --- waves -----------------------------------------------------------------------------------------------------
  private wave(model: OrganModel, drawbars: readonly number[], note: number): PeriodicWaveLike {
    const baseHz = midiToHz(note) / 2
    // partial content depends on how many harmonics fit under the limit, so the key includes the note's register bucket
    const bucket = Math.floor(note / 6)
    const key = `${spectrumKey(model, drawbars)}@${bucket}`
    const hit = this.waves.get(key)
    if (hit) return hit
    const spec = organSpectrum(model, drawbars, midiToHz(bucket * 6 + 5) / 2)
    const peak = Math.max(1e-6, spectrumPeak(spec))
    void baseHz
    const real = new Float32Array(spec.length)
    const imag = new Float32Array(spec.length)
    // normalised to a unit peak; the voice gain restores the level (Web Audio normalisation is disabled)
    for (let i = 1; i < spec.length; i++) imag[i] = spec[i] / peak
    const wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: true })
    this.waves.set(key, wave)
    if (this.waves.size > 400) {
      const oldest = this.waves.keys().next().value
      if (oldest !== undefined) this.waves.delete(oldest)
    }
    return wave
  }

  /** linear level that restores the real amplitude of a unit-peak wave for this registration */
  private registrationLevel(model: OrganModel, drawbars: readonly number[], note: number): number {
    const spec = organSpectrum(model, drawbars, midiToHz(Math.floor(note / 6) * 6 + 5) / 2)
    return organLevelTarget(spec) * spectrumPeak(spec)
  }

  private noiseBuffer(): AudioBufferLike | null {
    if (this.noise) return this.noise
    try {
      const n = Math.floor(this.ctx.sampleRate * 0.4)
      const buffer = this.ctx.createBuffer(1, n, this.ctx.sampleRate)
      const data = buffer.getChannelData(0)
      let s = 0x2545f491
      for (let i = 0; i < n; i++) {
        s ^= s << 13
        s ^= s >>> 17
        s ^= s << 5
        data[i] = ((s >>> 0) / 0xffffffff) * 2 - 1
      }
      this.noise = buffer
    } catch {
      this.noise = null
    }
    return this.noise
  }

  // --- notes -------------------------------------------------------------------------------------------------------
  noteOn(layer: LayerId, note: number, _velocity: number, gain: number): void {
    if (this.disposed) return
    const state = this.state
    const l: OrganLayerState = state.organ.layers[layer]
    const ctx = this.ctx
    const now = ctx.currentTime
    const held = this.held.get(layer)!
    const anyHeld = this.heldTotal() > 0
    // re-strike: the previous voice of the same key ends
    for (const v of this.voices) if (!v.done && v.layer === layer && v.note === note && !v.releasing) this.begin(v, ORGAN_STEAL_FADE_S)
    held.add(note)
    while (this.liveVoiceCount() >= ORGAN_MAX_VOICES) {
      const victim = [...this.voices].find((v) => !v.done)
      if (!victim) break
      this.begin(victim, ORGAN_STEAL_FADE_S)
      this.voices.delete(victim)
    }

    const model = l.model
    const level = this.registrationLevel(model, l.drawbars, note)
    const shape = ENVELOPE[model]

    const env = ctx.createGain()
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(gain, now + shape.attack)
    const trim = ctx.createGain()
    trim.gain.value = level
    trim.connect(env)
    const osc = ctx.createOscillator()
    osc.setPeriodicWave(this.wave(model, l.drawbars, note))
    osc.frequency.value = midiToHz(note) / 2
    if (osc.detune) osc.detune.value = l.pitchStick ? state.pitchBend * 200 : 0
    const voice: OrganVoice = { layer, note, model, env, trim, osc, spectrumSig: spectrumKey(model, l.drawbars), paths: null, sources: [osc], nodes: [env, trim], timer: null, releasing: false, done: false }

    if (model === 'Vox') {
      // Vox: a dark (low-passed) and a bright path, blended by the two mix drawbars
      const mix = voxMix(l.drawbars)
      const dark = ctx.createGain()
      dark.gain.value = mix.filtered
      const bright = ctx.createGain()
      bright.gain.value = mix.unfiltered
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 900
      lp.Q.value = 0.8
      osc.connect(lp)
      lp.connect(dark)
      osc.connect(bright)
      dark.connect(trim)
      bright.connect(trim)
      voice.paths = { dark, bright }
      voice.nodes.push(dark, bright, lp)
    } else {
      osc.connect(trim)
    }
    env.connect(this.buses[layer])
    osc.start(now)

    // B3 percussion: one decaying partial, single-triggered (only when no other key is down) unless poly
    if (model === 'B3' && state.organ.perc.on && (state.organ.perc.poly || !anyHeld)) {
      const p = state.organ.perc
      const perc = ctx.createOscillator()
      perc.frequency.value = midiToHz(note) * percussionPartial(p.third)
      const pe = ctx.createGain()
      const peak = 0.13 * gain * percussionLevel(p.soft) * (p.third ? 0.8 : 1)
      pe.gain.setValueAtTime(0, now)
      pe.gain.linearRampToValueAtTime(peak, now + 0.002)
      pe.gain.setTargetAtTime(0, now + 0.002, percussionDecaySeconds(p.fast) / 3)
      perc.connect(pe)
      pe.connect(env)
      perc.start(now)
      voice.sources.push(perc)
      voice.nodes.push(pe)
    }
    // key click: a short random noise transient at a fixed level (B3 family)
    if ((model === 'B3' || model === 'B3 Bass') && this.options.keyClick !== false) this.transient(voice, env, now, { hz: 2600, q: 0.9, seconds: 0.012, level: 0.09 * gain })
    // pipe chiff: breath noise at the start of the speech
    if (model === 'Pipe 1' || model === 'Pipe 2') this.transient(voice, env, now, { hz: Math.min(7000, midiToHz(note) * 3), q: 1.6, seconds: 0.06, level: 0.16 * gain * (model === 'Pipe 2' ? 1.2 : 1) })

    this.voices.add(voice)
  }

  private transient(voice: OrganVoice, out: AudioNodeLike, now: number, o: { hz: number; q: number; seconds: number; level: number }) {
    const buffer = this.noiseBuffer()
    if (!buffer) return
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const bp = this.ctx.createBiquadFilter() as BiquadLike
    bp.type = 'bandpass'
    bp.frequency.value = o.hz
    bp.Q.value = o.q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(o.level, now)
    g.gain.linearRampToValueAtTime(0, now + o.seconds)
    src.connect(bp)
    bp.connect(g)
    g.connect(out)
    // each transient starts at a different place in the noise: no two clicks are alike
    this.clickSeq = (this.clickSeq * 1103515245 + 12345) >>> 0
    const offset = (this.clickSeq / 0xffffffff) * 0.3
    src.start(now, offset)
    src.stop(now + o.seconds + 0.02)
    voice.sources.push(src)
    voice.nodes.push(bp, g)
  }

  noteOff(layer: LayerId, note: number): void {
    if (this.disposed) return
    this.held.get(layer)?.delete(note)
    for (const v of this.voices) {
      if (!v.done && v.layer === layer && v.note === note && !v.releasing) this.begin(v, ENVELOPE[v.model].release)
    }
  }

  stealNote(layer: LayerId, note: number): void {
    this.held.get(layer)?.delete(note)
    for (const v of this.voices) if (!v.done && v.layer === layer && v.note === note) this.begin(v, ORGAN_STEAL_FADE_S)
  }

  panic(): void {
    for (const set of this.held.values()) set.clear()
    for (const v of this.voices) if (!v.done) this.begin(v, ORGAN_STEAL_FADE_S)
  }

  private heldTotal(): number {
    let n = 0
    for (const set of this.held.values()) n += set.size
    return n
  }

  /** fade the voice out over `seconds`, then free its nodes */
  private begin(v: OrganVoice, seconds: number) {
    if (v.done) return
    if (v.releasing && seconds >= ORGAN_STEAL_FADE_S * 2) return
    if (v.timer !== null) this.scheduler.clearTimeout(v.timer)
    v.releasing = true
    const now = this.ctx.currentTime
    const p = v.env.gain
    p.cancelScheduledValues(now)
    p.setValueAtTime(p.value, now)
    p.linearRampToValueAtTime(0, now + seconds)
    v.timer = this.scheduler.setTimeout(() => this.free(v), Math.ceil(seconds * 1000) + 40)
  }

  private free(v: OrganVoice) {
    if (v.done) return
    v.done = true
    if (v.timer !== null) this.scheduler.clearTimeout(v.timer)
    v.timer = null
    for (const s of v.sources) {
      s.onended = null
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    for (const n of [...v.sources, ...v.nodes]) {
      try {
        n.disconnect()
      } catch {
        // already disconnected
      }
    }
    this.voices.delete(v)
  }

  liveVoiceCount(): number {
    let n = 0
    for (const v of this.voices) if (!v.done) n++
    return n
  }

  pendingTimerCount(): number {
    let n = 0
    for (const v of this.voices) if (v.timer !== null) n++
    return n
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const v of this.voices) this.free(v)
    for (const unit of Object.values(this.vib)) unit.rig.dispose()
    this.rig.dispose()
    this.waves.clear()
  }
}
