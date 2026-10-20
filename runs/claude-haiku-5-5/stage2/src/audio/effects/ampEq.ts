// Amp Sim / EQ: one unit with seven types. Five of them shape tone (EQ only, Twin, JC, Small) or
// filter it (LP24, HP24); "To Rotary" is EQ only and the layer graph routes it into the Rotary.
// Twin, JC, and Small differ in their drive curve and their speaker-style colouring, so they do not
// sound alike even at the same Drive setting.

import type { AudioContextLike, AudioNodeLike, BiquadFilterNodeLike, GainNodeLike, WaveShaperNodeLike } from '../audioBoundary'
import { BranchSelector, EffectSlot } from './slot'
import { asymmetricCurve, clamp01, expRange, gainNode, hardClipCurve, NodeBag, ramp, softClipCurve } from './nodes'
import type { AmpSettings } from './types'

const BASS_HZ = 100
const TREBLE_HZ = 4000

/** Bass, mid, and treble controls: a low shelf, a peaking mid, and a high shelf, each ±15 dB. */
interface Eq {
  input: AudioNodeLike
  output: AudioNodeLike
  update(bass: number, mid: number, midFreq: number, treble: number): void
}

function equaliser(context: AudioContextLike, bag: NodeBag): Eq {
  const low: BiquadFilterNodeLike = bag.add(context.createBiquadFilter())
  low.type = 'lowshelf'
  low.frequency.setValueAtTime(BASS_HZ, context.currentTime)
  const mid: BiquadFilterNodeLike = bag.add(context.createBiquadFilter())
  mid.type = 'peaking'
  mid.Q.setValueAtTime(1, context.currentTime)
  const high: BiquadFilterNodeLike = bag.add(context.createBiquadFilter())
  high.type = 'highshelf'
  high.frequency.setValueAtTime(TREBLE_HZ, context.currentTime)
  low.connect(mid)
  mid.connect(high)
  return {
    input: low,
    output: high,
    update(bass, midGain, midFreq, treble) {
      ramp(context, low.gain, dbFromControl(bass))
      ramp(context, mid.gain, dbFromControl(midGain))
      ramp(context, mid.frequency, expRange(midFreq, 200, 8000))
      ramp(context, high.gain, dbFromControl(treble))
    },
  }
}

/** 0..1 control to -15..+15 dB, centred at 0.5. */
export function dbFromControl(value: number): number {
  return (clamp01(value) * 2 - 1) * 15
}

interface AmpBranch {
  build(context: AudioContextLike, bag: NodeBag, input: AudioNodeLike): { output: AudioNodeLike; update(s: AmpSettings): void }
}

const eqOnly: AmpBranch = {
  build(context, bag, input) {
    const eq = equaliser(context, bag)
    input.connect(eq.input)
    return {
      output: eq.output,
      update: (s) => eq.update(s.bass, s.mid, s.midFreq, s.treble),
    }
  },
}

/** A shaped amp: a waveshaper for drive, a tone filter, a speaker colouring peak, then the EQ. */
function ampBranch(curve: (drive: number) => Float32Array, tone: { type: 'lowpass' | 'highshelf'; hz: number; db?: number }, speaker?: { hz: number; db: number }): AmpBranch {
  return {
    build(context, bag, input) {
      const shaper: WaveShaperNodeLike = bag.add(context.createWaveShaper())
      shaper.oversample = '4x'
      input.connect(shaper)
      const toneNode: BiquadFilterNodeLike = bag.add(context.createBiquadFilter())
      toneNode.type = tone.type
      toneNode.frequency.setValueAtTime(tone.hz, context.currentTime)
      if (tone.db !== undefined) toneNode.gain.setValueAtTime(tone.db, context.currentTime)
      shaper.connect(toneNode)
      let last: AudioNodeLike = toneNode
      if (speaker) {
        const peak: BiquadFilterNodeLike = bag.add(context.createBiquadFilter())
        peak.type = 'peaking'
        peak.frequency.setValueAtTime(speaker.hz, context.currentTime)
        peak.gain.setValueAtTime(speaker.db, context.currentTime)
        peak.Q.setValueAtTime(1.2, context.currentTime)
        last.connect(peak)
        last = peak
      }
      const eq = equaliser(context, bag)
      last.connect(eq.input)
      return {
        output: eq.output,
        update(s) {
          shaper.curve = curve(s.drive)
          eq.update(s.bass, s.mid, s.midFreq, s.treble)
        },
      }
    },
  }
}

const twin = ampBranch((d) => softClipCurve(d * 0.6), { type: 'lowpass', hz: 7000 }, { hz: 2500, db: 3 })
const jc = ampBranch((d) => asymmetricCurve(d * 0.7), { type: 'highshelf', hz: 3000, db: 3 })
const small = ampBranch((d) => hardClipCurve(d), { type: 'lowpass', hz: 3500 }, { hz: 1000, db: 5 })

function filterBranch(type: 'lowpass' | 'highpass'): AmpBranch {
  return {
    build(context, bag, input) {
      // Two identical biquad stages make a 24 dB/octave slope. Gain/Res sets the resonance.
      const first: BiquadFilterNodeLike = bag.add(context.createBiquadFilter())
      const second: BiquadFilterNodeLike = bag.add(context.createBiquadFilter())
      first.type = type
      second.type = type
      input.connect(first)
      first.connect(second)
      return {
        output: second,
        update(s) {
          const hz = expRange(s.midFreq, 80, 12000)
          const q = 0.7 + 9 * clamp01(s.mid)
          ramp(context, first.frequency, hz)
          ramp(context, second.frequency, hz)
          ramp(context, first.Q, q)
          ramp(context, second.Q, q)
        },
      }
    },
  }
}

const AMP_BRANCHES: readonly AmpBranch[] = [
  eqOnly,
  twin,
  jc,
  small,
  filterBranch('lowpass'),
  filterBranch('highpass'),
  eqOnly, // To Rotary: the same tone as EQ only; the graph does the routing.
]

/** The Amp Sim / EQ unit: a branch per type, then an output level. */
export class AmpEqUnit {
  readonly slot: EffectSlot
  private readonly context: AudioContextLike
  private selector: BranchSelector | undefined
  private level: GainNodeLike | undefined
  private readonly updaters: ((s: AmpSettings) => void)[] = []

  constructor(context: AudioContextLike) {
    this.context = context
    this.slot = new EffectSlot(context, {
      build: (ctx, bag, wetIn) => {
        const selector = new BranchSelector(ctx, bag, AMP_BRANCHES.length)
        this.selector = selector
        AMP_BRANCHES.forEach((branch, index) => {
          const built = branch.build(ctx, bag, wetIn)
          built.output.connect(selector.inputFor(index))
          this.updaters.push(built.update)
        })
        const level = gainNode(ctx, bag, 1)
        selector.output.connect(level)
        this.level = level
        return level
      },
    })
  }

  apply(settings: AmpSettings): void {
    this.slot.setOn(settings.on)
    this.selector?.select(settings.type)
    for (const update of this.updaters) update(settings)
    if (this.level) ramp(this.context, this.level.gain, 0.5 + settings.level)
  }

  dispose(): void {
    this.slot.dispose()
  }
}
