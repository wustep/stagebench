import { connect } from './graph'
import { frequency, noiseBuffer, NoteGraph } from './noteGraph'
import type { OrganLayer } from '../instrument/parameters'

const harmonics = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8]
const pipeWeights = [0.88, 0.45, 1, 0.77, 0.57, 0.69, 0.43, 0.41, 0.36]
const farfWeights = [0.46, 0.31, 0.62, 0.37, 0.32, 0.51, 0.29, 0.26, 0.23]

function gainFor(state: OrganLayer, index: number) {
  const level = state.drawbars[index] / 8
  switch (state.model) {
    case 'B3 Bass': return index === 0 || index === 2 ? level ** 1.7 : 0
    case 'B3': return level ** 1.7
    case 'Farf': return Number(level > 0.5) * farfWeights[index]
    case 'Vox': return index < 7 ? level ** 1.3 * 0.8 : 0
    default: return level ** 1.25 * pipeWeights[index]
  }
}

/** The oscillator waveform describes a rank; the drawbar chooses its pitch and gain. */
export class OrganWaves {
  readonly click: AudioBuffer
  private readonly waves = new Map<string, PeriodicWave>()

  constructor(private readonly context: BaseAudioContext) {
    this.click = noiseBuffer(context, Math.ceil(context.sampleRate * 0.013), 393173)
  }

  wave(model: OrganLayer['model'], index: number) {
    if (model === 'B3' || model === 'B3 Bass') return undefined
    const key = `${model}:${index}`
    let wave = this.waves.get(key)
    if (wave) return wave
    const partials = new Float32Array(18)
    partials[1] = 1
    for (let order = 2; order < partials.length; order++) {
      if (model === 'Vox') partials[order] = (order % 2 ? 0.72 : 0.17) / order ** 0.84
      else if (model === 'Farf') partials[order] = (index % 3 === 0 && order % 2 === 0 ? 0.12 : 1.14) / order ** 0.8
      else {
        const principal = model === 'Pipe 2'
        partials[order] = (order % 2 ? 1 : 0.48) *
          (principal ? 0.95 : 0.42 + 0.045 * index) / order ** (principal ? 1.35 : 1.95)
      }
    }
    wave = this.context.createPeriodicWave(new Float32Array(partials.length), partials)
    this.waves.set(key, wave)
    return wave
  }
}

export class OrganVoice {
  readonly model: OrganLayer['model']
  private readonly graph: NoteGraph
  private readonly partials: { gain: GainNode; pitch: OscillatorNode }[] = []
  private readonly level: GainNode
  private readonly placement: GainNode
  private readonly strike: number
  private readonly mix: { dry: GainNode; wet: GainNode }
  private readonly vox?: { clean: GainNode; reed: GainNode }
  private readonly depth: AudioParam
  private percussion?: OscillatorNode
  private readonly time: number
  private readonly attack: number
  private releasedAt?: number
  private releaseLevel = 0
  private releaseTime = 0

  constructor(
    context: BaseAudioContext, output: AudioNode, bank: OrganWaves, state: OrganLayer,
    note: number, velocity: number, triggerPercussion: boolean, zone: number, bend: number,
    private readonly clock: () => number, ended: () => void,
  ) {
    const start = this.time = clock()
    const g = this.graph = new NoteGraph(context, clock, ended, start)
    this.model = state.model
    const pipe = this.model.startsWith('Pipe')
    this.attack = pipe ? 0.042 : this.model === 'Farf' ? 0.004 : 0.007
    const direct = g.gain()
    const tone = g.gain()
    const colour = g.filter('lowpass', 1350)
    if (this.model === 'Vox') {
      this.vox = { clean: g.gain(), reed: g.gain() }
      connect(tone, colour, this.vox.clean, direct)
      connect(tone, this.vox.reed, direct)
    } else tone.connect(direct)
    const delay = g.delay(0.035, pipe ? 0.013 : 0.007)
    const lfo = g.oscillator('sine', pipe ? 4.8 : 6.7)
    this.depth = g.depth(lfo, delay.delayTime)
    this.mix = { dry: g.gain(), wet: g.gain(0) }
    this.level = g.gain(0)
    this.strike = 0.26 + 0.045 * velocity / 127
    const placement = this.placement = g.gain(zone * this.strike)
    connect(direct, this.mix.dry, this.level)
    connect(direct, delay, this.mix.wet, this.level)
    connect(this.level, placement, output)
    this.level.gain.setValueAtTime(0, start)
    this.level.gain.linearRampToValueAtTime(1, start + this.attack)

    for (const [index, harmonic] of harmonics.entries()) {
      const osc = context.createOscillator()
      const wave = bank.wave(state.model, index)
      if (wave) osc.setPeriodicWave(wave)
      const rank = this.model === 'Farf' ? [0.5, 0.5, 1, 1, 1, 1, 2, 2, 4][index] : harmonic
      osc.frequency.value = frequency(note) * rank
      const gain = g.gain(0)
      connect(osc, gain, tone)
      g.source(osc, start)
      this.partials.push({ gain, pitch: osc })
    }
    if (state.model === 'B3' || state.model === 'B3 Bass') {
      const click = context.createBufferSource()
      click.buffer = bank.click
      const level = g.gain(0.16)
      level.gain.setValueAtTime(0.16, start)
      level.gain.setTargetAtTime(0, start, 0.0025)
      connect(click, g.filter('bandpass', 2250 + note * 10, 0.7), level, placement)
      g.source(click, start)
      if (triggerPercussion && state.model === 'B3' && state.percussion.on) {
        const harmonic = this.percussion = context.createOscillator()
        harmonic.frequency.value = frequency(note) * (state.percussion.third ? 3 : 2)
        const gain = g.gain(0)
        const peak = state.percussion.soft ? 0.17 : 0.36
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(peak, start + 0.004)
        gain.gain.setTargetAtTime(0, start + 0.004, state.percussion.fast ? 0.058 : 0.21)
        connect(harmonic, gain, direct)
        g.source(harmonic, start)
      }
    }
    this.update(state, bend, zone)
  }

  update(state: OrganLayer, bend: number, zone: number) {
    this.graph.set(this.placement.gain, zone * this.strike)
    if (this.model !== state.model) return
    for (const [index, { gain, pitch }] of this.partials.entries()) {
      this.graph.set(gain.gain, gainFor(state, index) / 4.5)
      this.graph.set(pitch.detune, bend + (state.model.startsWith('Pipe') ? (index % 3 - 1) * 2 : 0))
    }
    if (this.percussion) this.graph.set(this.percussion.detune, bend)
    if (this.vox) {
      this.graph.set(this.vox.clean.gain, state.drawbars[7] / 8)
      this.graph.set(this.vox.reed.gain, state.drawbars[8] / 8)
    }
    const depth = Number(state.chorus[1])
    const chorus = state.chorus[0] === 'C' && this.model !== 'Farf' && this.model !== 'Vox'
    this.graph.set(this.mix.dry.gain, state.vibrato ? (chorus ? 0.62 : 0) : 1)
    this.graph.set(this.mix.wet.gain, state.vibrato ? (chorus ? 0.62 : 1) : 0)
    this.graph.set(this.depth, depth * (this.model.startsWith('Pipe') ? 0.00053 : 0.00022))
  }

  release(seconds = this.model.startsWith('Pipe') ? 0.25 : 0.065) {
    const now = this.clock()
    const already = this.releasedAt
    if (already !== undefined && now + seconds >= already + this.releaseTime) return
    const level = already === undefined ? Math.min(1, Math.max(0, (now - this.time) / this.attack))
      : this.releaseLevel * Math.exp(-6 * (now - already) / this.releaseTime)
    this.releasedAt = now
    this.releaseTime = seconds
    this.releaseLevel = level
    const gain = this.level.gain
    gain.cancelScheduledValues(now)
    if (now < this.time + this.attack) gain.linearRampToValueAtTime(level, now)
    else gain.setValueAtTime(level, now)
    gain.setTargetAtTime(0, now, seconds / 6)
    this.graph.finish(now + seconds)
  }

  stop() { this.graph.dispose() }
}
