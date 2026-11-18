import type { OrganLayer } from '../instrument/parameters'
import { clamp } from '../instrument/parameters'
import type { NotePart } from './notePart'
import { Graph } from './graph'
import { OrganVoice, OrganWaves } from './organ'

interface OrganKey {
  keyed: boolean
  sustained: boolean
  note: number
  voice: OrganVoice
}

export class OrganChannel {
  private readonly voices = new Set<OrganKey>()
  private readonly graph: Graph
  private readonly level: GainNode
  private state: OrganLayer

  constructor(
    private readonly context: BaseAudioContext, output: AudioNode, private readonly bank: OrganWaves,
    initial: OrganLayer, private readonly clock: () => number,
  ) {
    this.state = initial
    this.graph = new Graph(context, clock)
    this.level = this.graph.gain()
    this.level.connect(output)
  }

  update(state: OrganLayer, on: boolean, bend: number, zoneFor: (note: number) => number) {
    this.state = state
    this.graph.set(this.level.gain, on ? (state.level / 12) ** 1.45 : 0)
    for (const key of this.voices) {
      key.voice.update(state, bend, zoneFor(key.note))
      if (!on || key.voice.model !== state.model) this.release(key, 0.025)
      else if (key.sustained && !state.sustain) this.release(key)
    }
  }

  play(note: number, zone: number, velocity: number, transpose: number, bend: number, ended: () => void): NotePart {
    const trigger = ![...this.voices].some((key) => key.keyed)
    const voice = new OrganVoice(this.context, this.level, this.bank, this.state,
      clamp(note + transpose + this.state.octave * 12, 0, 127), velocity, trigger, zone, bend, this.clock,
      () => { this.voices.delete(key); ended() })
    const key: OrganKey = { voice, note, keyed: true, sustained: false }
    this.voices.add(key)
    return {
      keyUp: (pedal) => {
        if (!key.keyed) return false
        key.keyed = false
        key.sustained = pedal && this.state.sustain
        if (!key.sustained) this.release(key)
        return key.sustained
      },
      isSustained: () => key.sustained,
      release: (seconds) => this.release(key, seconds),
      stop: () => voice.stop(),
    }
  }

  dispose() {
    for (const key of this.voices) key.voice.stop()
    this.graph.dispose()
  }

  private release(key: OrganKey, seconds?: number) {
    key.keyed = false
    key.sustained = false
    key.voice.release(seconds)
  }
}
