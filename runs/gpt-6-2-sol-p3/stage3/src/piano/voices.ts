import { connect } from '../audio/graph'
import type { Graph } from '../audio/graph'
import type { PianoSample } from './library'
import { isRecorded } from './settings'
import type { PianoLayer, PianoType } from './settings'

export function velocityGain(velocity: number) {
  return 0.025 + 0.975 * (velocity / 127) ** 1.33
}

export function strikeVelocity(velocity: number, touch: PianoLayer['touch']) {
  return 127 * (velocity / 127) ** (touch === 'Heavy' ? 1.65 : touch === 'Light' ? 0.63 : 1)
}

const eq = {
  Off: { low: 0, mid: 0, high: 0, highHz: 2300 },
  Soft: { low: 0, mid: 0, high: -11, highHz: 1600 },
  Mid: { low: 0, mid: 6, high: 0, highHz: 2300 },
  Bright: { low: 0, mid: 0, high: 8, highHz: 2300 },
  'Dyno 1': { low: 0, mid: 1.5, high: 12.5, highHz: 1150 },
  'Dyno 2': { low: -11, mid: -3, high: 5, highHz: 3300 },
} as const

/** Color the layer bus so edits also affect notes that are already ringing. */
export function timbreBus(graph: Graph) {
  const input = graph.filter('lowshelf', 440)
  const mid = graph.filter('peaking', 1150, 0.83)
  const output = graph.filter('highshelf', 2300)
  connect(input, mid, output)
  return {
    input, output,
    update(layer: PianoLayer) {
      const color = eq[layer.timbre.startsWith('Dyno') && layer.type !== 'Electric' ? 'Off' : layer.timbre]
      graph.set(input.gain, color.low)
      graph.set(mid.gain, color.mid)
      graph.set(output.frequency, color.highHz)
      graph.set(output.gain, color.high)
    },
  }
}

export class LayerVoice {
  private readonly nodes: AudioNode[] = []
  private readonly sources: AudioBufferSourceNode[] = []
  private readonly pitches: { param: AudioParam; cents: number }[] = []
  private readonly resonate: OscillatorNode[] = []
  private readonly placement: GainNode
  private readonly damper: GainNode
  private readonly resonanceGain?: GainNode
  private readonly start: number
  private readonly amplitude: number
  private startRelease?: number
  private releaseLevel = 0
  private releaseDuration = 0
  private disposed = false
  private pendingSources = 0
  readonly type: PianoType
  private bend?: number
  private zone: number
  private coupling?: number
  keyed = true
  sustained = false
  pedal = false

  constructor(
    context: BaseAudioContext,
    output: AudioNode,
    readonly note: number,
    velocity: number,
    layer: PianoLayer,
    recordings: { sample: PianoSample; weight: number }[],
    tone: AudioBuffer | undefined,
    pitch: number,
    private readonly clock: () => number,
    private readonly ended: () => void,
    readonly keyNote = note, zone = 1,
  ) {
    this.start = clock()
    this.zone = zone
    this.type = layer.type
    const filter = this.own(context.createBiquadFilter())
    filter.type = 'lowpass'
    filter.frequency.value = Math.min(context.sampleRate * 0.46, 3000 + 14500 * (velocity / 127) ** 1.65)
    filter.Q.value = 0.2
    this.damper = this.own(context.createGain())
    this.placement = this.own(context.createGain())
    this.placement.gain.value = zone
    this.damper.connect(this.placement)
    this.placement.connect(output)
    this.amplitude = velocityGain(127 * (velocity / 127) ** (1 - layer.dynamics * 0.19))
    this.damper.gain.setValueAtTime(0, this.start)
    this.damper.gain.linearRampToValueAtTime(this.amplitude, this.start + 0.004)
    filter.connect(this.damper)

    const takes = recordings.length ? recordings : [{ sample: { buffer: tone!, root: note, loop: undefined }, weight: 1 }]
    const cents = [0, 3.5, 8.5, 16][layer.unison]
    const spread = [0, 0.38, 0.69, 0.94][layer.unison]
    const voices = layer.unison ? [
      { cents: 0, pan: 0, level: 0.54 }, { cents: -cents, pan: -spread, level: 0.31 },
      { cents, pan: spread, level: 0.31 },
    ] : [{ cents: 0, pan: 0, level: 1 }]
    for (const take of takes) {
      for (const copy of voices) {
        const source = this.own(context.createBufferSource())
        const gain = this.own(context.createGain())
        source.buffer = take.sample.buffer
        if (take.sample.loop) {
          source.loop = true
          source.loopStart = take.sample.loop[0]
          source.loopEnd = take.sample.loop[1]
        }
        source.playbackRate.value = 2 ** ((note - take.sample.root) / 12)
        gain.gain.value = copy.level * take.weight
        this.pitches.push({ param: source.detune, cents: copy.cents })
        source.connect(gain)
        if (copy.pan) {
          const pan = this.own(context.createStereoPanner())
          pan.pan.value = copy.pan
          gain.connect(pan)
          pan.connect(filter)
        } else gain.connect(filter)
        this.sources.push(source)
      }
    }

    if (isRecorded(layer.type) && layer.type !== 'Electric') {
      this.resonanceGain = this.own(context.createGain())
      this.resonanceGain.gain.value = 0
      this.resonanceGain.connect(filter)
      for (const [multiple, weight] of [[2, 0.31], [3.002, 0.18]]) {
        const mode = this.own(context.createOscillator())
        const decay = this.own(context.createGain())
        mode.frequency.value = Math.min(context.sampleRate * 0.44, multiple * 440 * 2 ** ((note - 69) / 12))
        this.pitches.push({ param: mode.detune, cents: 0 })
        decay.gain.setValueAtTime(weight, this.start)
        decay.gain.setTargetAtTime(0, this.start, 0.59)
        mode.connect(decay)
        decay.connect(this.resonanceGain)
        this.resonate.push(mode)
      }
    }

    this.setPitch(pitch)
    this.pendingSources = this.sources.length
    for (const source of this.sources) {
      source.onended = () => {
        this.pendingSources--
        if (this.pendingSources === 0) this.dispose()
      }
      source.start(this.start)
    }
    for (const mode of this.resonate) mode.start(this.start)
  }

  setZone(zone: number) {
    if (zone === this.zone) return
    this.zone = zone
    const now = this.clock()
    this.placement.gain.cancelScheduledValues(now)
    this.placement.gain.setTargetAtTime(zone, now, 0.01)
  }

  setPitch(cents: number) {
    if (this.bend === cents) return
    for (const pitch of this.pitches) {
      if (this.bend === undefined) pitch.param.value = pitch.cents + cents
      else {
        const now = this.clock()
        pitch.param.cancelScheduledValues(now)
        pitch.param.setTargetAtTime(pitch.cents + cents, now, 0.009)
      }
    }
    this.bend = cents
  }

  setResonance(coupling: number) {
    if (!this.resonanceGain || coupling === this.coupling) return
    this.coupling = coupling
    const now = this.clock()
    const gain = this.resonanceGain.gain
    gain.cancelScheduledValues(now)
    gain.setTargetAtTime(coupling, now, 0.025)
  }

  release(seconds: number) {
    if (this.disposed) return
    this.keyed = false
    this.sustained = false
    const now = this.clock()
    if (this.startRelease !== undefined && now + seconds >= this.startRelease + this.releaseDuration) return
    const level = this.startRelease === undefined
      ? this.amplitude * Math.min(1, Math.max(0, (now - this.start) / 0.004))
      : this.releaseLevel * Math.exp(-5.5 * (now - this.startRelease) / this.releaseDuration)
    this.startRelease = now
    this.releaseLevel = level
    this.releaseDuration = seconds
    const gain = this.damper.gain
    gain.cancelScheduledValues(now)
    if (now < this.start + 0.004) gain.linearRampToValueAtTime(level, now)
    else gain.setValueAtTime(level, now)
    gain.setTargetAtTime(0, now, seconds / 5.5)
    for (const source of this.sources) source.stop(now + seconds)
  }

  stop() {
    if (this.disposed) return
    for (const source of this.sources) source.stop()
    this.dispose()
  }

  private own<T extends AudioNode>(node: T) {
    this.nodes.push(node)
    return node
  }

  private dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const source of this.sources) source.onended = null
    for (const mode of this.resonate) mode.stop()
    for (const node of this.nodes) node.disconnect()
    this.ended()
  }
}
