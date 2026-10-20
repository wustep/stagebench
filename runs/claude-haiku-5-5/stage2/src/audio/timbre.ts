// Piano Timbre: a fixed four-stage filter on each layer's input. Only its values change between
// steps: a low-pass for Soft's dampened highs, a low shelf and a presence peak for the midrange
// emphasis, and a high shelf for Bright. The electric Dyno steps are preamp/EQ approximations
// (manual p. 26), not measured curves.

import type { AudioContextLike, AudioNodeLike, BiquadFilterNodeLike, GainNodeLike } from './audioBoundary'
import { NodeBag, ramp } from './effects/nodes'

export type TimbreStepName = 'Off' | 'Soft' | 'Mid' | 'Bright' | 'Dyno 1' | 'Dyno 2'

export interface TimbreFilterValues {
  lowpassHz: number
  bassDb: number
  presenceHz: number
  presenceDb: number
  presenceQ: number
  trebleHz: number
  trebleDb: number
}

const OPEN_LOWPASS_HZ = 22000

export const TIMBRE_VALUES: Record<TimbreStepName, TimbreFilterValues> = {
  Off: { lowpassHz: OPEN_LOWPASS_HZ, bassDb: 0, presenceHz: 1500, presenceDb: 0, presenceQ: 0.9, trebleHz: 5000, trebleDb: 0 },
  Soft: { lowpassHz: 1800, bassDb: 2, presenceHz: 1500, presenceDb: 0, presenceQ: 0.9, trebleHz: 1500, trebleDb: -9 },
  Mid: { lowpassHz: OPEN_LOWPASS_HZ, bassDb: -3, presenceHz: 1500, presenceDb: 5, presenceQ: 0.9, trebleHz: 4000, trebleDb: -4 },
  Bright: { lowpassHz: OPEN_LOWPASS_HZ, bassDb: 0, presenceHz: 1500, presenceDb: 0, presenceQ: 0.9, trebleHz: 1200, trebleDb: 9 },
  'Dyno 1': { lowpassHz: OPEN_LOWPASS_HZ, bassDb: 0, presenceHz: 1600, presenceDb: 6, presenceQ: 1.2, trebleHz: 2500, trebleDb: 5 },
  'Dyno 2': { lowpassHz: OPEN_LOWPASS_HZ, bassDb: 5, presenceHz: 1600, presenceDb: 5, presenceQ: 1.2, trebleHz: 3000, trebleDb: 2 },
}

export class TimbreFilter {
  readonly input: GainNodeLike
  readonly output: AudioNodeLike
  private readonly context: AudioContextLike
  private readonly lowpass: BiquadFilterNodeLike
  private readonly bass: BiquadFilterNodeLike
  private readonly presence: BiquadFilterNodeLike
  private readonly treble: BiquadFilterNodeLike

  constructor(context: AudioContextLike, bag: NodeBag, input: GainNodeLike) {
    this.context = context
    this.input = input
    this.lowpass = bag.add(context.createBiquadFilter())
    this.lowpass.type = 'lowpass'
    this.bass = bag.add(context.createBiquadFilter())
    this.bass.type = 'lowshelf'
    this.bass.frequency.setValueAtTime(150, context.currentTime)
    this.presence = bag.add(context.createBiquadFilter())
    this.presence.type = 'peaking'
    this.treble = bag.add(context.createBiquadFilter())
    this.treble.type = 'highshelf'
    this.input.connect(this.lowpass)
    this.lowpass.connect(this.bass)
    this.bass.connect(this.presence)
    this.presence.connect(this.treble)
    this.output = this.treble
  }

  setValues(values: TimbreFilterValues): void {
    ramp(this.context, this.lowpass.frequency, values.lowpassHz)
    ramp(this.context, this.bass.gain, values.bassDb)
    ramp(this.context, this.presence.frequency, values.presenceHz)
    ramp(this.context, this.presence.gain, values.presenceDb)
    ramp(this.context, this.presence.Q, values.presenceQ)
    ramp(this.context, this.treble.frequency, values.trebleHz)
    ramp(this.context, this.treble.gain, values.trebleDb)
  }
}
