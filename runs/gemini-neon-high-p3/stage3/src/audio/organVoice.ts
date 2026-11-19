import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  BiquadFilterNodeLike,
  DelayNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from './boundaries'
import { midiToFrequency } from './pianoVoice'
import type {
  DrawbarTuple,
  OrganLayerId,
  OrganLayerState,
  OrganModelId,
  OrganVibChorusType,
} from '../model/organSynthTypes'

const RAMP_TC = 0.012

// B3 drawbar harmonic numbers relative to the 16' sub-fundamental (baseHz / 2):
// 16'=1, 5 1/3'=3, 8'=2, 4'=4, 2 2/3'=6, 2'=8, 1 3/5'=10, 1 1/3'=12, 1'=16
const B3_HARMONICS: readonly number[] = [1, 3, 2, 4, 6, 8, 10, 12, 16]

// Vox Continental 7 footage harmonics (relative to 16' sub-fundamental):
// 16'=1, 8'=2, 4'=4, 2 2/3'=6, 2'=8, 1 3/5'=10, 1'=16; drawbars 8 & 9 control Sine/Reed mix
const VOX_HARMONICS: readonly number[] = [1, 2, 4, 6, 8, 10, 16]

// Farfisa Compact 9 register switches (pulled >= 5/8 = ON):
// Bass16, Str16, Flute8, Oboe8, Trmp8, Str8, Flute4, Str4, 2 2/3
const FARF_REGISTER_HARMONICS: readonly (readonly [number, number][])[] = [
  [[1, 1.0], [2, 0.35], [3, 0.2]],
  [[1, 0.7], [2, 0.55], [3, 0.45], [5, 0.3], [7, 0.22]],
  [[2, 1.0], [4, 0.15]],
  [[2, 0.65], [4, 0.7], [6, 0.6], [8, 0.45], [10, 0.3]],
  [[2, 0.7], [4, 0.85], [6, 0.8], [8, 0.7], [10, 0.55], [12, 0.45]],
  [[2, 0.6], [4, 0.5], [6, 0.48], [8, 0.42], [10, 0.35], [14, 0.28]],
  [[4, 1.0], [8, 0.2]],
  [[4, 0.7], [8, 0.55], [12, 0.45], [16, 0.35]],
  [[6, 0.9], [12, 0.5], [18, 0.3]],
]

const PIPE_RANK_HARMONICS: readonly number[] = [1, 3, 2, 4, 6, 8, 10, 12, 16]

const noiseBufferCache = new WeakMap<AudioContextLike, AudioBufferLike>()

function getOrganNoiseBuffer(ctx: AudioContextLike): AudioBufferLike | null {
  if (typeof ctx.createBuffer !== 'function') return null
  const cached = noiseBufferCache.get(ctx)
  if (cached) return cached
  const sr = ctx.sampleRate || 44100
  const len = Math.floor(sr * 0.12)
  const buf = ctx.createBuffer(1, len, sr)
  const ch = buf.getChannelData?.(0)
  if (!ch) return null
  let seed = 0x51a9e041
  for (let i = 0; i < len; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    ch[i] = (seed / 4294967296) * 2 - 1
  }
  noiseBufferCache.set(ctx, buf)
  return buf
}

export interface OrganWaveSpec {
  readonly real: Float32Array
  readonly imag: Float32Array
}

export function buildOrganHarmonicCoeffs(
  model: OrganModelId,
  drawbars: DrawbarTuple,
  midi: number,
): OrganWaveSpec {
  const size = 33
  const real = new Float32Array(size)
  const imag = new Float32Array(size)

  if (model === 'B3' || model === 'B3 Bass') {
    const activeCount = model === 'B3 Bass' ? 2 : 9
    for (let i = 0; i < activeCount; i++) {
      const dbIndex = model === 'B3 Bass' ? (i === 0 ? 0 : 2) : i
      const val =
        model === 'B3 Bass' && i === 1
          ? Math.max(drawbars[2], drawbars[1])
          : drawbars[dbIndex]
      if (val <= 0) continue
      const amp = (val / 8) * (model === 'B3 Bass' ? 0.55 : 0.28)
      let h = B3_HARMONICS[dbIndex]
      while (midi + 12 * Math.log2(h / 2) > 114 && h >= 2) {
        h = Math.max(1, Math.floor(h / 2))
      }
      if (h < size) {
        imag[h] += amp
      }
    }
    return { real, imag }
  }

  if (model === 'Vox') {
    const fluteMix = 0.25 + (drawbars[7] / 8) * 0.75
    const reedMix = 0.15 + (drawbars[8] / 8) * 1.15
    for (let i = 0; i < 7; i++) {
      const val = drawbars[i]
      if (val <= 0) continue
      const baseAmp = (val / 8) * 0.26
      const h = VOX_HARMONICS[i]
      if (h < size) {
        imag[h] += baseAmp * (fluteMix * 0.7 + reedMix * 0.45)
        if (h * 2 < size) imag[h * 2] += baseAmp * reedMix * 0.42
        if (h * 3 < size) real[h * 3] += baseAmp * reedMix * 0.34
        if (h * 4 < size) imag[h * 4] += baseAmp * reedMix * 0.2
      }
    }
    return { real, imag }
  }

  if (model === 'Farf') {
    for (let i = 0; i < 9; i++) {
      if (drawbars[i] < 5) continue
      const partials = FARF_REGISTER_HARMONICS[i]
      for (const [h, w] of partials) {
        if (h < size) {
          imag[h] += w * 0.2
          if (h % 2 === 1) real[h] += w * 0.12
        }
      }
    }
    return { real, imag }
  }

  const isPipe2 = model === 'Pipe 2'
  for (let i = 0; i < 9; i++) {
    const val = drawbars[i]
    if (val <= 0) continue
    const amp = (val / 8) * 0.24
    const h = PIPE_RANK_HARMONICS[i]
    if (h < size) {
      imag[h] += amp * (isPipe2 ? 0.85 : 1.0)
      if (h * 2 < size) imag[h * 2] += amp * (isPipe2 ? 0.56 : 0.32)
      if (h * 3 < size) real[h * 3] += amp * (isPipe2 ? 0.38 : 0.16)
      if (isPipe2 && h * 4 < size) imag[h * 4] += amp * 0.24
    }
  }
  return { real, imag }
}

export class OrganLayerBus {
  readonly layerId: OrganLayerId
  readonly input: GainNodeLike
  readonly output: GainNodeLike

  private readonly ctx: AudioContextLike
  private readonly modelEqLow: BiquadFilterNodeLike
  private readonly modelEqMid: BiquadFilterNodeLike
  private readonly modelEqHigh: BiquadFilterNodeLike
  private readonly vcDryGain: GainNodeLike
  private readonly vcWetGain: GainNodeLike
  private readonly vcDelay: DelayNodeLike | null
  private readonly vcLfo: OscillatorNodeLike | null
  private readonly vcDepth: GainNodeLike | null
  private readonly levelGain: GainNodeLike
  private readonly nodes: AudioNodeLike[] = []
  private lfoStarted = false

  constructor(ctx: AudioContextLike, layerId: OrganLayerId) {
    this.ctx = ctx
    this.layerId = layerId
    const now = ctx.currentTime

    this.input = ctx.createGain()
    this.modelEqLow = ctx.createBiquadFilter()
    this.modelEqLow.type = 'lowshelf'
    this.modelEqLow.frequency.setValueAtTime(160, now)

    this.modelEqMid = ctx.createBiquadFilter()
    this.modelEqMid.type = 'peaking'
    this.modelEqMid.frequency.setValueAtTime(1600, now)
    this.modelEqMid.Q.setValueAtTime(1.4, now)

    this.modelEqHigh = ctx.createBiquadFilter()
    this.modelEqHigh.type = 'highshelf'
    this.modelEqHigh.frequency.setValueAtTime(4200, now)

    this.vcDryGain = ctx.createGain()
    this.vcWetGain = ctx.createGain()
    this.levelGain = ctx.createGain()
    this.output = ctx.createGain()

    this.input.connect(this.modelEqLow)
    this.modelEqLow.connect(this.modelEqMid)
    this.modelEqMid.connect(this.modelEqHigh)
    this.modelEqHigh.connect(this.vcDryGain)
    this.vcDryGain.connect(this.levelGain)

    this.nodes.push(
      this.input,
      this.modelEqLow,
      this.modelEqMid,
      this.modelEqHigh,
      this.vcDryGain,
      this.vcWetGain,
      this.levelGain,
      this.output,
    )

    if (typeof ctx.createDelay === 'function') {
      const delay = ctx.createDelay(0.04)
      delay.delayTime.setValueAtTime(0.005, now)
      const lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.setValueAtTime(6.8, now)
      const depth = ctx.createGain()
      depth.gain.setValueAtTime(0.0005, now)
      lfo.connect(depth)
      depth.connect(delay.delayTime)

      this.modelEqHigh.connect(delay)
      delay.connect(this.vcWetGain)
      this.vcWetGain.connect(this.levelGain)

      this.vcDelay = delay
      this.vcLfo = lfo
      this.vcDepth = depth
      this.nodes.push(delay, lfo, depth)

      if (ctx.state !== 'suspended') {
        this.ensureLfoStarted()
      }
    } else {
      this.vcDelay = null
      this.vcLfo = null
      this.vcDepth = null
    }

    this.levelGain.connect(this.output)
  }

  ensureLfoStarted(): void {
    if (this.lfoStarted || !this.vcLfo) return
    this.lfoStarted = true
    try {
      this.vcLfo.start(this.ctx.currentTime)
    } catch {
      // already started
    }
  }

  apply(layer: OrganLayerState, sectionOn: boolean, immediate = false): void {
    const now = this.ctx.currentTime
    const set = (
      p:
        | {
            setValueAtTime(v: number, t: number): unknown
            setTargetAtTime(v: number, t: number, tc: number): unknown
          }
        | undefined,
      v: number,
    ) => {
      if (!p) return
      if (immediate) p.setValueAtTime(v, now)
      else p.setTargetAtTime(v, now, RAMP_TC)
    }
    const levelNorm = sectionOn && layer.enabled ? Math.max(0, Math.min(1, layer.level / 100)) : 0
    set(this.levelGain.gain, levelNorm * 0.85)

    if (layer.model === 'B3') {
      set(this.modelEqLow.gain, 1.5)
      set(this.modelEqMid.frequency, 1200)
      set(this.modelEqMid.gain, 0)
      set(this.modelEqHigh.gain, -1.5)
    } else if (layer.model === 'B3 Bass') {
      set(this.modelEqLow.gain, 6.0)
      set(this.modelEqMid.frequency, 900)
      set(this.modelEqMid.gain, -3.0)
      set(this.modelEqHigh.gain, -7.0)
    } else if (layer.model === 'Vox') {
      set(this.modelEqLow.gain, -2.0)
      set(this.modelEqMid.frequency, 1950)
      set(this.modelEqMid.gain, 5.5)
      set(this.modelEqHigh.gain, 3.0)
    } else if (layer.model === 'Farf') {
      set(this.modelEqLow.gain, -3.5)
      set(this.modelEqMid.frequency, 2850)
      set(this.modelEqMid.gain, 8.0)
      set(this.modelEqHigh.gain, 4.5)
    } else if (layer.model === 'Pipe 1') {
      set(this.modelEqLow.gain, 3.0)
      set(this.modelEqMid.frequency, 1050)
      set(this.modelEqMid.gain, -1.5)
      set(this.modelEqHigh.gain, 1.5)
    } else {
      set(this.modelEqLow.gain, 1.5)
      set(this.modelEqMid.frequency, 2400)
      set(this.modelEqMid.gain, 3.5)
      set(this.modelEqHigh.gain, 5.5)
    }

    const vcOn = layer.vibChorusOn && layer.model !== 'B3 Bass'
    if (!vcOn || !this.vcDepth || !this.vcLfo || !this.vcDelay) {
      set(this.vcDryGain.gain, 1)
      set(this.vcWetGain.gain, 0)
      if (this.vcDepth) set(this.vcDepth.gain, 0)
      return
    }

    const vcType: OrganVibChorusType = layer.vibChorusType
    const isChorus = vcType.startsWith('C')
    const levelNum = Number(vcType.slice(1))
    const depthSec = levelNum === 1 ? 0.00045 : levelNum === 2 ? 0.00105 : 0.0019

    if (layer.model === 'Pipe 1' || layer.model === 'Pipe 2') {
      set(this.vcLfo.frequency, 1.4 + levelNum * 0.55)
      set(this.vcDepth.gain, depthSec * 0.75)
      set(this.vcDryGain.gain, 0.72)
      set(this.vcWetGain.gain, 0.55)
    } else if (isChorus) {
      set(this.vcLfo.frequency, 6.75)
      set(this.vcDepth.gain, depthSec)
      set(this.vcDryGain.gain, 0.68)
      set(this.vcWetGain.gain, 0.68)
    } else {
      set(this.vcLfo.frequency, 6.85)
      set(this.vcDepth.gain, depthSec)
      set(this.vcDryGain.gain, 0)
      set(this.vcWetGain.gain, 1.0)
    }
  }

  dispose(): void {
    if (this.lfoStarted && this.vcLfo) {
      try {
        this.vcLfo.stop()
      } catch {
        // already stopped
      }
    }
    for (const node of this.nodes) {
      try {
        node.disconnect()
      } catch {
        // already disconnected
      }
    }
  }
}

export interface ActiveOrganVoice {
  readonly layerId: OrganLayerId
  readonly baseMidi: number
  readonly effectiveMidi: number
  readonly model: OrganModelId
  readonly gainNode: GainNodeLike
  readonly mainOsc: OscillatorNodeLike
  readonly detuneOsc: OscillatorNodeLike | null
  readonly nodes: AudioNodeLike[]
  readonly stopTargets: Array<OscillatorNodeLike | AudioBufferSourceNodeLike>
  readonly pitchTargets: Array<{ readonly node: OscillatorNodeLike; readonly baseHz: number }>
  released: boolean
}

export function spawnOrganVoice(
  ctx: AudioContextLike,
  bus: OrganLayerBus,
  layer: OrganLayerState,
  baseMidi: number,
  effectiveMidi: number,
  zoneGain: number,
  bendFactor: number,
  triggerPercussion: boolean,
  now: number,
): ActiveOrganVoice | null {
  if (zoneGain <= 0.0005) return null
  const hasActiveDrawbar =
    layer.model === 'Farf'
      ? layer.drawbars.some((v) => v >= 5)
      : layer.model === 'B3 Bass'
        ? layer.drawbars[0] > 0 || layer.drawbars[1] > 0 || layer.drawbars[2] > 0
        : layer.drawbars.some((v) => v > 0)

  const nodes: AudioNodeLike[] = []
  const stopTargets: Array<OscillatorNodeLike | AudioBufferSourceNodeLike> = []
  const pitchTargets: Array<{ readonly node: OscillatorNodeLike; readonly baseHz: number }> = []

  const voiceGain = ctx.createGain()
  const baseHz = midiToFrequency(effectiveMidi)
  const subHz = baseHz / 2

  const isPipe = layer.model === 'Pipe 1' || layer.model === 'Pipe 2'
  const attackSec = isPipe ? 0.022 : 0.004
  const targetGain = 0.42 * zoneGain

  voiceGain.gain.setValueAtTime(0.0001, now)
  voiceGain.gain.linearRampToValueAtTime(hasActiveDrawbar ? targetGain : 0.0001, now + attackSec)
  nodes.push(voiceGain)

  const mainOsc = ctx.createOscillator()
  mainOsc.frequency.setValueAtTime(subHz * bendFactor, now)
  const waveSpec = buildOrganHarmonicCoeffs(layer.model, layer.drawbars, effectiveMidi)
  if (typeof ctx.createPeriodicWave === 'function' && typeof mainOsc.setPeriodicWave === 'function') {
    const wave = ctx.createPeriodicWave(waveSpec.real, waveSpec.imag, { disableNormalization: true })
    mainOsc.setPeriodicWave(wave)
  } else {
    mainOsc.type = layer.model === 'Farf' ? 'sawtooth' : layer.model === 'Vox' ? 'triangle' : 'sine'
  }
  mainOsc.connect(voiceGain)
  mainOsc.start(now)
  nodes.push(mainOsc)
  stopTargets.push(mainOsc)
  pitchTargets.push({ node: mainOsc, baseHz: subHz })

  let detuneOsc: OscillatorNodeLike | null = null
  if (isPipe && layer.vibChorusOn) {
    const vcLevel = Number(layer.vibChorusType.slice(1))
    const cents = vcLevel === 1 ? 4.5 : vcLevel === 2 ? 9.5 : 15
    const detuneRatio = Math.pow(2, cents / 1200)
    detuneOsc = ctx.createOscillator()
    detuneOsc.frequency.setValueAtTime(subHz * detuneRatio * bendFactor, now)
    if (typeof ctx.createPeriodicWave === 'function' && typeof detuneOsc.setPeriodicWave === 'function') {
      const wave = ctx.createPeriodicWave(waveSpec.real, waveSpec.imag, { disableNormalization: true })
      detuneOsc.setPeriodicWave(wave)
    } else {
      detuneOsc.type = 'triangle'
    }
    const detGain = ctx.createGain()
    detGain.gain.setValueAtTime(0.45, now)
    detuneOsc.connect(detGain)
    detGain.connect(voiceGain)
    detuneOsc.start(now)
    nodes.push(detuneOsc, detGain)
    stopTargets.push(detuneOsc)
    pitchTargets.push({ node: detuneOsc, baseHz: subHz * detuneRatio })
  }

  if (layer.model === 'B3' && layer.percussion.on && triggerPercussion) {
    const percOsc = ctx.createOscillator()
    percOsc.type = 'sine'
    const percMult = layer.percussion.third ? 3 : 2
    const percHz = baseHz * percMult
    percOsc.frequency.setValueAtTime(percHz * bendFactor, now)

    const percGain = ctx.createGain()
    const percPeak = (layer.percussion.soft ? 0.16 : 0.36) * zoneGain
    const percDecay = layer.percussion.fast ? 0.14 : 0.48
    percGain.gain.setValueAtTime(0.0001, now)
    percGain.gain.linearRampToValueAtTime(percPeak, now + 0.003)
    percGain.gain.exponentialRampToValueAtTime(0.0001, now + percDecay)

    percOsc.connect(percGain)
    percGain.connect(bus.input)
    percOsc.start(now)
    percOsc.stop(now + percDecay + 0.02)
    nodes.push(percOsc, percGain)
    stopTargets.push(percOsc)
    pitchTargets.push({ node: percOsc, baseHz: percHz })
  }

  if ((layer.model === 'B3' || layer.model === 'B3 Bass') && layer.keyClick && hasActiveDrawbar) {
    const noiseBuf = getOrganNoiseBuffer(ctx)
    if (noiseBuf) {
      const clickSrc = ctx.createBufferSource()
      clickSrc.buffer = noiseBuf
      const clickBp = ctx.createBiquadFilter()
      clickBp.type = 'bandpass'
      clickBp.frequency.setValueAtTime(2700, now)
      clickBp.Q.setValueAtTime(1.8, now)
      const clickGain = ctx.createGain()
      clickGain.gain.setValueAtTime(0.55 * zoneGain, now)
      clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.011)
      clickSrc.connect(clickBp)
      clickBp.connect(clickGain)
      clickGain.connect(bus.input)
      clickSrc.start(now)
      clickSrc.stop(now + 0.012)
      nodes.push(clickSrc, clickBp, clickGain)
      stopTargets.push(clickSrc)
    }
  }

  if (isPipe && hasActiveDrawbar) {
    const noiseBuf = getOrganNoiseBuffer(ctx)
    if (noiseBuf) {
      const chiffSrc = ctx.createBufferSource()
      chiffSrc.buffer = noiseBuf
      const chiffBp = ctx.createBiquadFilter()
      chiffBp.type = 'bandpass'
      chiffBp.frequency.setValueAtTime(
        Math.min(5500, baseHz * (layer.model === 'Pipe 2' ? 4.2 : 2.8)),
        now,
      )
      chiffBp.Q.setValueAtTime(2.6, now)
      const chiffGain = ctx.createGain()
      chiffGain.gain.setValueAtTime(0.0001, now)
      chiffGain.gain.linearRampToValueAtTime(
        (layer.model === 'Pipe 2' ? 0.14 : 0.1) * zoneGain,
        now + 0.008,
      )
      chiffGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.042)

      chiffSrc.connect(chiffBp)
      chiffBp.connect(chiffGain)
      chiffGain.connect(bus.input)
      chiffSrc.start(now)
      chiffSrc.stop(now + 0.05)
      nodes.push(chiffSrc, chiffBp, chiffGain)
      stopTargets.push(chiffSrc)
    }
  }

  voiceGain.connect(bus.input)

  return {
    layerId: bus.layerId,
    baseMidi,
    effectiveMidi,
    model: layer.model,
    gainNode: voiceGain,
    mainOsc,
    detuneOsc,
    nodes,
    stopTargets,
    pitchTargets,
    released: false,
  }
}

export function updateLiveOrganVoiceDrawbars(
  ctx: AudioContextLike,
  voice: ActiveOrganVoice,
  layer: OrganLayerState,
): void {
  if (voice.released) return
  const waveSpec = buildOrganHarmonicCoeffs(layer.model, layer.drawbars, voice.effectiveMidi)
  if (typeof ctx.createPeriodicWave === 'function' && typeof voice.mainOsc.setPeriodicWave === 'function') {
    const wave = ctx.createPeriodicWave(waveSpec.real, waveSpec.imag, { disableNormalization: true })
    voice.mainOsc.setPeriodicWave(wave)
    if (voice.detuneOsc && typeof voice.detuneOsc.setPeriodicWave === 'function') {
      voice.detuneOsc.setPeriodicWave(wave)
    }
  }
}
