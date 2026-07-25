import type {
  GraphBiquad,
  GraphContext,
  GraphGain,
  GraphNode,
  GraphOscillator,
  GraphParam,
} from './graph'
import type {
  AmpSettings,
  CompressorSettings,
  DelaySettings,
  Mod1Settings,
  Mod1Type,
  Mod2Settings,
  Mod2Type,
  ReverbSettings,
  ReverbType,
  RotarySettings,
} from './settings'

/**
 * The six Layer Effects units plus the shared Rotary, built from real Web Audio nodes.
 *
 * Every unit is an insert with an input gain, a dry path and a wet path, so "on" and "bypass"
 * are gain ramps rather than reconnections — that is what keeps switching click-free while
 * still genuinely changing the signal. Type changes rebuild the wet path and dispose the old
 * nodes; nothing is left connected or running.
 *
 * Nothing here is decorative: if a control is wired to one of these units, moving it changes the
 * rendered signal, and the effects tests measure exactly that.
 */

const RAMP_SECONDS = 0.02

/** A parameter whose current value is known, so every change can be a short, click-free ramp. */
export class Ramped {
  private current: number

  constructor(
    private readonly param: GraphParam,
    initial: number,
  ) {
    this.current = initial
    param.value = initial
  }

  get value(): number {
    return this.current
  }

  set(target: number, context: GraphContext, seconds = RAMP_SECONDS): void {
    if (Math.abs(target - this.current) < 1e-9) return
    const now = context.currentTime
    this.param.cancelScheduledValues(now)
    this.param.setValueAtTime(this.current, now)
    this.param.linearRampToValueAtTime(target, now + seconds)
    this.current = target
  }
}

export interface EffectUnit {
  readonly input: GraphGain
  readonly output: GraphGain
  dispose(): void
}

abstract class BaseUnit implements EffectUnit {
  readonly input: GraphGain
  readonly output: GraphGain
  protected readonly dry: Ramped
  protected readonly wet: Ramped
  protected readonly dryGain: GraphGain
  protected readonly wetGain: GraphGain
  private readonly fixed: GraphNode[] = []
  private wetNodes: GraphNode[] = []
  private wetSources: GraphOscillator[] = []

  constructor(protected readonly context: GraphContext) {
    this.input = context.createGain()
    this.output = context.createGain()
    this.dryGain = context.createGain()
    this.wetGain = context.createGain()
    this.fixed.push(this.input, this.output, this.dryGain, this.wetGain)
    this.input.connect(this.dryGain)
    this.dryGain.connect(this.output)
    this.wetGain.connect(this.output)
    this.dry = new Ramped(this.dryGain.gain, 1)
    this.wet = new Ramped(this.wetGain.gain, 0)
  }

  /** Registers a node that belongs to the current wet path. */
  protected keep<T extends GraphNode>(node: T): T {
    this.wetNodes.push(node)
    return node
  }

  /** Registers a node that lives for the whole life of the unit, across type changes. */
  protected keepFixed<T extends GraphNode>(node: T): T {
    this.fixed.push(node)
    return node
  }

  protected keepSource(node: GraphOscillator): GraphOscillator {
    this.wetSources.push(node)
    this.wetNodes.push(node)
    return node
  }

  protected clearWet(): void {
    for (const source of this.wetSources) {
      try {
        source.stop(this.context.currentTime)
      } catch {
        // A source that already stopped throws in some implementations; nothing to do.
      }
    }
    for (const node of this.wetNodes) node.disconnect()
    this.wetNodes = []
    this.wetSources = []
  }

  protected mix(dry: number, wet: number): void {
    this.dry.set(dry, this.context)
    this.wet.set(wet, this.context)
  }

  dispose(): void {
    this.clearWet()
    for (const node of this.fixed) node.disconnect()
  }
}

function lfo(context: GraphContext, type: string, frequency: number): GraphOscillator {
  const oscillator = context.createOscillator()
  oscillator.type = type
  oscillator.frequency.value = frequency
  // Started at 0 so the modulation is running for the whole life of the graph: a real context
  // clamps a past start time to "now", and the offline renderer starts at zero.
  oscillator.start(0)
  return oscillator
}

function gainOf(context: GraphContext, value: number): GraphGain {
  const node = context.createGain()
  node.gain.value = value
  return node
}

function filterOf(
  context: GraphContext,
  type: string,
  frequency: number,
  q = 0.7,
  gainDb = 0,
): GraphBiquad {
  const node = context.createBiquadFilter()
  node.type = type
  node.frequency.value = frequency
  node.Q.value = q
  node.gain.value = gainDb
  return node
}

/** Wave-shaping curve for a rectifier: |x|, used by the envelope followers. */
function rectifierCurve(size = 1024): Float32Array {
  const curve = new Float32Array(size)
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1
    curve[i] = Math.abs(x)
  }
  return curve
}

/** Soft saturation curve; `hardness` sets how quickly it clips. */
function driveCurve(hardness: number, size = 1024, asymmetry = 0): Float32Array {
  const curve = new Float32Array(size)
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1
    const bias = x + asymmetry * x * x
    curve[i] = Math.tanh(bias * hardness) / Math.tanh(hardness)
  }
  return curve
}

/* ------------------------------------------------------------------ Mod 1 */

const MOD1_RATE_HZ: readonly [number, number] = [0.3, 9]

export class Mod1Unit extends BaseUnit {
  private type: Mod1Type | null = null
  private apply: ((settings: Mod1Settings) => void) | null = null

  update(settings: Mod1Settings, enabled: boolean): void {
    if (settings.type !== this.type) {
      this.clearWet()
      this.apply = this.build(settings.type)
      this.type = settings.type
    }
    this.apply?.(settings)
    const on = enabled && settings.on
    if (!on) {
      this.mix(1, 0)
      return
    }
    // Ring modulation is mixed in by amount; the rest are inserts.
    if (settings.type === 'ringmod') this.mix(1 - 0.85 * settings.amount, settings.amount)
    else this.mix(0, 1)
  }

  private build(type: Mod1Type): (settings: Mod1Settings) => void {
    const context = this.context
    const rateHz = (value: number) => MOD1_RATE_HZ[0] + value * (MOD1_RATE_HZ[1] - MOD1_RATE_HZ[0])

    switch (type) {
      case 'apan': {
        const panner = this.keep(context.createStereoPanner())
        const oscillator = this.keepSource(lfo(context, 'sine', 1))
        const depth = this.keep(gainOf(context, 0.5))
        oscillator.connect(depth)
        depth.connect(panner.pan)
        this.input.connect(panner)
        panner.connect(this.wetGain)
        const rate = new Ramped(oscillator.frequency, 1)
        const amount = new Ramped(depth.gain, 0.5)
        return (settings) => {
          rate.set(rateHz(settings.rate), context)
          amount.set(settings.amount, context)
        }
      }
      case 'tremolo': {
        const tremolo = this.keep(gainOf(context, 1))
        const oscillator = this.keepSource(lfo(context, 'sine', 1))
        const depth = this.keep(gainOf(context, 0))
        oscillator.connect(depth)
        depth.connect(tremolo.gain)
        this.input.connect(tremolo)
        tremolo.connect(this.wetGain)
        const rate = new Ramped(oscillator.frequency, 1)
        const depthAmount = new Ramped(depth.gain, 0)
        const centre = new Ramped(tremolo.gain, 1)
        return (settings) => {
          rate.set(rateHz(settings.rate), context)
          // Full level at zero amount (manual p. 49): the LFO only ever ducks the signal.
          depthAmount.set(settings.amount * 0.5, context)
          centre.set(1 - settings.amount * 0.5, context)
        }
      }
      case 'ringmod': {
        const ring = this.keep(gainOf(context, 0))
        const oscillator = this.keepSource(lfo(context, 'sine', 200))
        oscillator.connect(ring.gain)
        this.input.connect(ring)
        ring.connect(this.wetGain)
        const rate = new Ramped(oscillator.frequency, 200)
        return (settings) => {
          // Rate sets the pitch of the modulating sine (manual p. 49).
          rate.set(30 * Math.pow(50, settings.rate), context)
        }
      }
      case 'awah': {
        const band = this.keep(filterOf(context, 'bandpass', 420, 4.5))
        const rectifier = this.keep(context.createWaveShaper())
        rectifier.curve = rectifierCurve()
        const smoother = this.keep(filterOf(context, 'lowpass', 12, 0.7))
        const sensitivity = this.keep(gainOf(context, 3000))
        this.input.connect(band)
        this.input.connect(rectifier)
        rectifier.connect(smoother)
        smoother.connect(sensitivity)
        sensitivity.connect(band.frequency)
        band.connect(this.wetGain)
        const sense = new Ramped(sensitivity.gain, 3000)
        const resonance = new Ramped(band.Q, 4.5)
        return (settings) => {
          // The rate knob acts as sensitivity for the envelope follower (manual p. 49).
          sense.set(1200 + settings.rate * 9000, context)
          resonance.set(2 + settings.amount * 8, context)
        }
      }
      case 'wah': {
        const band = this.keep(filterOf(context, 'lowpass', 900, 7))
        const oscillator = this.keepSource(lfo(context, 'sine', 1))
        const sweep = this.keep(gainOf(context, 600))
        oscillator.connect(sweep)
        sweep.connect(band.frequency)
        this.input.connect(band)
        band.connect(this.wetGain)
        const rate = new Ramped(oscillator.frequency, 1)
        const depth = new Ramped(sweep.gain, 600)
        const resonance = new Ramped(band.Q, 7)
        return (settings) => {
          rate.set(rateHz(settings.rate), context)
          depth.set(200 + settings.amount * 1500, context)
          resonance.set(3 + settings.amount * 9, context)
        }
      }
      default: {
        // Pump: side-chain-style ducking driven by a sawtooth LFO (manual p. 49).
        const duck = this.keep(gainOf(context, 1))
        const oscillator = this.keepSource(lfo(context, 'sawtooth', 2))
        const depth = this.keep(gainOf(context, 0))
        oscillator.connect(depth)
        depth.connect(duck.gain)
        this.input.connect(duck)
        duck.connect(this.wetGain)
        const rate = new Ramped(oscillator.frequency, 2)
        const depthAmount = new Ramped(depth.gain, 0)
        const centre = new Ramped(duck.gain, 1)
        return (settings) => {
          rate.set(0.5 + settings.rate * 7, context)
          depthAmount.set(settings.amount * 0.45, context)
          centre.set(1 - settings.amount * 0.45, context)
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ Mod 2 */

export class Mod2Unit extends BaseUnit {
  private type: Mod2Type | null = null
  private apply: ((settings: Mod2Settings) => void) | null = null

  update(settings: Mod2Settings, enabled: boolean): void {
    if (settings.type !== this.type) {
      this.clearWet()
      this.apply = this.build(settings.type)
      this.type = settings.type
    }
    this.apply?.(settings)
    if (!(enabled && settings.on)) this.mix(1, 0)
    else this.mix(1, 0.4 + 0.6 * settings.amount)
  }

  /** One modulated delay line, the building block of every Mod 2 type. */
  private line(rateHz: number, baseSeconds: number, depthSeconds: number, pan: number) {
    const context = this.context
    const delay = this.keep(context.createDelay(0.2))
    delay.delayTime.value = baseSeconds
    const oscillator = this.keepSource(lfo(context, 'sine', rateHz))
    const depth = this.keep(gainOf(context, depthSeconds))
    oscillator.connect(depth)
    depth.connect(delay.delayTime)
    const panner = this.keep(context.createStereoPanner())
    panner.pan.value = pan
    this.input.connect(delay)
    delay.connect(panner)
    panner.connect(this.wetGain)
    return {
      rate: new Ramped(oscillator.frequency, rateHz),
      depth: new Ramped(depth.gain, depthSeconds),
      base: new Ramped(delay.delayTime, baseSeconds),
      delay,
    }
  }

  private build(type: Mod2Type): (settings: Mod2Settings) => void {
    const context = this.context

    switch (type) {
      case 'chorus': {
        const first = this.line(0.6, 0.014, 0.002, -0.6)
        const second = this.line(0.83, 0.021, 0.0025, 0.6)
        return (settings) => {
          first.rate.set(0.2 + settings.rate * 2.4, context)
          second.rate.set(0.28 + settings.rate * 3.1, context)
          first.depth.set(0.0008 + settings.amount * 0.003, context)
          // High amounts bring the second delay line up (manual p. 50).
          second.depth.set(settings.amount * 0.004, context)
        }
      }
      case 'flanger': {
        const line = this.line(0.4, 0.0026, 0.0018, 0)
        const feedback = this.keep(gainOf(context, 0.5))
        line.delay.connect(feedback)
        feedback.connect(line.delay)
        const feedbackAmount = new Ramped(feedback.gain, 0.5)
        return (settings) => {
          line.rate.set(0.1 + settings.rate * 2.2, context)
          line.depth.set(0.0006 + settings.amount * 0.0022, context)
          feedbackAmount.set(0.2 + settings.amount * 0.65, context)
        }
      }
      case 'phaser': {
        const stages = [280, 640, 1450, 3200].map((frequency) =>
          this.keep(filterOf(context, 'allpass', frequency, 1.1)),
        )
        const oscillator = this.keepSource(lfo(context, 'sine', 0.5))
        const sweeps = stages.map((stage, index) => {
          const sweep = this.keep(gainOf(context, 200 * (index + 1)))
          oscillator.connect(sweep)
          sweep.connect(stage.frequency)
          return new Ramped(sweep.gain, 200 * (index + 1))
        })
        this.input.connect(stages[0])
        for (let index = 1; index < stages.length; index += 1) stages[index - 1].connect(stages[index])
        const last = stages[stages.length - 1]
        const feedback = this.keep(gainOf(context, 0))
        last.connect(feedback)
        feedback.connect(stages[0])
        last.connect(this.wetGain)
        const rate = new Ramped(oscillator.frequency, 0.5)
        const feedbackAmount = new Ramped(feedback.gain, 0)
        return (settings) => {
          rate.set(0.1 + settings.rate * 3, context)
          sweeps.forEach((sweep, index) => sweep.set((120 + settings.amount * 460) * (index + 1), context))
          feedbackAmount.set(settings.amount * 0.55, context)
        }
      }
      case 'vibe': {
        // Staggered phase filters plus a little amplitude wobble (manual p. 50).
        const stages = [220, 900, 2600].map((frequency) =>
          this.keep(filterOf(context, 'allpass', frequency, 2.2)),
        )
        const oscillator = this.keepSource(lfo(context, 'triangle', 0.7))
        const sweeps = stages.map((stage, index) => {
          const sweep = this.keep(gainOf(context, 150 * (index + 1)))
          oscillator.connect(sweep)
          sweep.connect(stage.frequency)
          return new Ramped(sweep.gain, 150 * (index + 1))
        })
        this.input.connect(stages[0])
        stages[0].connect(stages[1])
        stages[1].connect(stages[2])
        const wobble = this.keep(gainOf(context, 0.85))
        const wobbleDepth = this.keep(gainOf(context, 0.15))
        oscillator.connect(wobbleDepth)
        wobbleDepth.connect(wobble.gain)
        stages[2].connect(wobble)
        wobble.connect(this.wetGain)
        const rate = new Ramped(oscillator.frequency, 0.7)
        const wobbleAmount = new Ramped(wobbleDepth.gain, 0.15)
        return (settings) => {
          rate.set(0.2 + settings.rate * 5.5, context)
          sweeps.forEach((sweep, index) => sweep.set((90 + settings.amount * 700) * (index + 1), context))
          wobbleAmount.set(0.05 + settings.amount * 0.3, context)
        }
      }
      case 'ensemble': {
        // Three cross-connected modulated delay lines (manual p. 50).
        const lines = [
          this.line(0.42, 0.017, 0.0022, -0.8),
          this.line(0.71, 0.023, 0.0018, 0),
          this.line(1.13, 0.029, 0.0026, 0.8),
        ]
        const cross = this.keep(gainOf(context, 0.25))
        lines[0].delay.connect(cross)
        cross.connect(lines[2].delay)
        const rates = [0.42, 0.71, 1.13]
        return (settings) => {
          lines.forEach((line, index) => {
            line.rate.set(rates[index] * (0.4 + settings.rate * 1.8), context)
            line.depth.set(0.0009 + settings.amount * 0.0032, context)
          })
        }
      }
      default: {
        // Spin: gentle rotary-like modulation whose rate changes ramp gradually (manual p. 50).
        const line = this.line(0.9, 0.006, 0.0009, 0)
        const panner = this.keep(this.context.createStereoPanner())
        const spinDepth = this.keep(gainOf(context, 0.7))
        const spinLfo = this.keepSource(lfo(context, 'sine', 0.9))
        spinLfo.connect(spinDepth)
        spinDepth.connect(panner.pan)
        line.delay.connect(panner)
        panner.connect(this.wetGain)
        const spinRate = new Ramped(spinLfo.frequency, 0.9)
        const spinAmount = new Ramped(spinDepth.gain, 0.7)
        return (settings) => {
          const target = 0.4 + settings.rate * 4.5
          // "Rate changes ramp gradually": a 1.2s glide instead of a jump.
          line.rate.set(target, context, 1.2)
          spinRate.set(target, context, 1.2)
          spinAmount.set(0.3 + settings.amount * 0.7, context)
          line.depth.set(0.0004 + settings.amount * 0.0016, context)
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ Delay */

const DELAY_MIN_SECONDS = 0.06
const DELAY_MAX_SECONDS = 1.1

export function delayTempoSeconds(tempo: number): number {
  const clamped = Math.min(1, Math.max(0, tempo))
  return DELAY_MIN_SECONDS + clamped * (DELAY_MAX_SECONDS - DELAY_MIN_SECONDS)
}

export class DelayUnit extends BaseUnit {
  private readonly delay
  private readonly feedbackGain
  private readonly filter: GraphBiquad
  private readonly time: Ramped
  private readonly feedback: Ramped
  private readonly filterFrequency: Ramped
  private filterKind = ''

  constructor(context: GraphContext) {
    super(context)
    this.delay = context.createDelay(DELAY_MAX_SECONDS + 0.1)
    this.delay.delayTime.value = delayTempoSeconds(0.35)
    this.feedbackGain = gainOf(context, 0)
    this.filter = filterOf(context, 'lowpass', 3200, 0.9)

    this.input.connect(this.delay)
    this.delay.connect(this.wetGain)
    // The feedback path passes the filter, so each successive repeat is filtered again while
    // the dry signal and the first tap are not (manual p. 51).
    this.delay.connect(this.filter)
    this.filter.connect(this.feedbackGain)
    this.feedbackGain.connect(this.delay)

    this.keep(this.delay)
    this.keep(this.feedbackGain)
    this.keep(this.filter)
    this.time = new Ramped(this.delay.delayTime, delayTempoSeconds(0.35))
    this.feedback = new Ramped(this.feedbackGain.gain, 0)
    this.filterFrequency = new Ramped(this.filter.frequency, 3200)
  }

  get delaySeconds(): number {
    return this.time.value
  }

  update(settings: DelaySettings, enabled: boolean): void {
    const on = enabled && settings.on
    this.time.set(delayTempoSeconds(settings.tempo), this.context, 0.08)
    this.feedback.set(on ? Math.min(0.85, settings.feedback * 0.85) : 0, this.context)
    if (settings.filter !== this.filterKind) {
      this.filterKind = settings.filter
      this.filter.type = settings.filter === 'lp' ? 'lowpass' : settings.filter === 'hp' ? 'highpass' : 'bandpass'
    }
    this.filterFrequency.set(
      settings.filter === 'lp' ? 2600 : settings.filter === 'hp' ? 700 : 1200,
      this.context,
    )
    this.filter.Q.value = settings.filter === 'bp' ? 1.6 : 0.9
    if (!on) {
      this.mix(1, 0)
      return
    }
    const angle = (Math.min(1, Math.max(0, settings.mix)) * Math.PI) / 2
    this.mix(Math.cos(angle), Math.sin(angle))
  }
}

/* ------------------------------------------------------------------ Amp Sim / EQ */

export class AmpEqUnit extends BaseUnit {
  private readonly bass: GraphBiquad
  private readonly mid: GraphBiquad
  private readonly treble: GraphBiquad
  private readonly bassGain: Ramped
  private readonly midGain: Ramped
  private readonly midFrequency: Ramped
  private readonly trebleGain: Ramped
  private setStage: ((drive: number, midFrequency: number, resonance: number) => void) | null = null
  private stageType = ''

  constructor(context: GraphContext) {
    super(context)
    // The three-band EQ is always in circuit; only the amp/filter colouring after it changes.
    this.bass = this.keepFixed(filterOf(context, 'lowshelf', 100, 0.7, 0))
    this.mid = this.keepFixed(filterOf(context, 'peaking', 1000, 1, 0))
    this.treble = this.keepFixed(filterOf(context, 'highshelf', 4000, 0.7, 0))
    this.input.connect(this.bass)
    this.bass.connect(this.mid)
    this.mid.connect(this.treble)
    this.bassGain = new Ramped(this.bass.gain, 0)
    this.midGain = new Ramped(this.mid.gain, 0)
    this.midFrequency = new Ramped(this.mid.frequency, 1000)
    this.trebleGain = new Ramped(this.treble.gain, 0)
  }

  update(settings: AmpSettings, enabled: boolean): void {
    if (settings.type !== this.stageType) {
      this.clearWet()
      this.treble.disconnect()
      this.setStage = this.buildStage(settings.type)
      this.stageType = settings.type
    }
    const filterType = settings.type === 'lp24' || settings.type === 'hp24'
    // On the filter types the Mid knob is resonance and Freq is the cutoff (manual p. 52).
    this.bassGain.set(filterType ? 0 : settings.bass, this.context)
    this.midGain.set(filterType ? 0 : settings.mid, this.context)
    this.midFrequency.set(settings.midFrequency, this.context)
    this.trebleGain.set(filterType ? 0 : settings.treble, this.context)
    this.setStage?.(settings.drive, settings.midFrequency, settings.mid)
    const on = enabled && settings.on
    this.mix(on ? 0 : 1, on ? 1 : 0)
  }

  private buildStage(
    type: AmpSettings['type'],
  ): (drive: number, midFrequency: number, resonance: number) => void {
    const context = this.context
    const trim = this.keep(gainOf(context, 1))

    switch (type) {
      case 'jc': {
        // Clean transistor combo: scooped mids, bright top, very late break-up.
        const preTrim = this.keep(gainOf(context, 1))
        const scoop = this.keep(filterOf(context, 'peaking', 700, 1.1, -6))
        const air = this.keep(filterOf(context, 'highshelf', 3200, 0.7, 4))
        const drive = this.keep(context.createWaveShaper())
        this.treble.connect(preTrim)
        preTrim.connect(scoop)
        scoop.connect(air)
        air.connect(drive)
        drive.connect(trim)
        trim.connect(this.wetGain)
        return (amount) => {
          drive.curve = driveCurve(1 + amount * 4)
          preTrim.gain.value = 1 + amount * 2.5
          trim.gain.value = 1 / (1 + amount * 1.4)
        }
      }
      case 'small': {
        // Small speaker: no deep bass, a strong mid honk and early break-up.
        const preTrim = this.keep(gainOf(context, 1))
        const cut = this.keep(filterOf(context, 'highpass', 260, 0.8))
        const honk = this.keep(filterOf(context, 'peaking', 1500, 1.4, 7))
        const roll = this.keep(filterOf(context, 'lowpass', 3600, 0.9))
        const drive = this.keep(context.createWaveShaper())
        this.treble.connect(preTrim)
        preTrim.connect(cut)
        cut.connect(honk)
        honk.connect(drive)
        drive.connect(roll)
        roll.connect(trim)
        trim.connect(this.wetGain)
        return (amount) => {
          drive.curve = driveCurve(2.5 + amount * 12, 1024, 0.25)
          preTrim.gain.value = 1 + amount * 5
          trim.gain.value = 1 / (1 + amount * 2.2)
        }
      }
      case 'lp24':
      case 'hp24': {
        // Two cascaded 12 dB biquads make the 24 dB/octave resonant filter.
        const kind = type === 'lp24' ? 'lowpass' : 'highpass'
        const first = this.keep(filterOf(context, kind, 1000, 0.7))
        const second = this.keep(filterOf(context, kind, 1000, 0.7))
        this.treble.connect(first)
        first.connect(second)
        second.connect(trim)
        trim.connect(this.wetGain)
        return (amount, frequency, resonance) => {
          first.frequency.value = frequency
          second.frequency.value = frequency
          const q = 0.5 + Math.max(0, resonance) * 0.6
          first.Q.value = q
          second.Q.value = q
          trim.gain.value = 1 + amount * 0.6
        }
      }
      case 'rotary': {
        // "To Rotary" has no colouring stage of its own: the layer is routed into the shared
        // Rotary by the chain, and the other units stay in front of it (manual p. 52).
        this.treble.connect(trim)
        trim.connect(this.wetGain)
        return () => undefined
      }
      default: {
        // Twin: bright American combo, tight lows, presence peak, gradual break-up.
        const preTrim = this.keep(gainOf(context, 1))
        const tighten = this.keep(filterOf(context, 'highpass', 90, 0.7))
        const presence = this.keep(filterOf(context, 'peaking', 3000, 1.2, 5))
        const drive = this.keep(context.createWaveShaper())
        this.treble.connect(preTrim)
        preTrim.connect(tighten)
        tighten.connect(presence)
        presence.connect(drive)
        drive.connect(trim)
        trim.connect(this.wetGain)
        return (amount) => {
          drive.curve = driveCurve(1.6 + amount * 7)
          preTrim.gain.value = 1 + amount * 3.5
          trim.gain.value = 1 / (1 + amount * 1.8)
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ Compressor */

/**
 * A real feed-forward compressor built from nodes: rectify the signal, smooth it into an
 * envelope, map the envelope through a gain-reduction curve, and drive the gain of the audio
 * path with it. Higher amounts reduce the dynamic range; the tests measure the crest factor.
 */
export class CompressorUnit extends BaseUnit {
  private readonly amplifier: GraphGain
  private readonly makeup: GraphGain
  private readonly shaper
  private amount = -1

  constructor(context: GraphContext) {
    super(context)
    this.amplifier = gainOf(context, 0)
    this.makeup = gainOf(context, 1)
    const rectifier = context.createWaveShaper()
    rectifier.curve = rectifierCurve()
    // Two cascaded poles: fast enough to catch a piano transient, smooth enough that the
    // envelope does not follow the waveform itself.
    const smootherA = filterOf(context, 'lowpass', 55, 0.7)
    const smootherB = filterOf(context, 'lowpass', 55, 0.7)
    this.shaper = context.createWaveShaper()
    this.shaper.curve = compressionCurve(0)

    this.input.connect(this.amplifier)
    this.input.connect(rectifier)
    rectifier.connect(smootherA)
    smootherA.connect(smootherB)
    smootherB.connect(this.shaper)
    this.shaper.connect(this.amplifier.gain)
    // Make-up gain lives after the reduction, so it lifts the whole signal instead of the peak.
    this.amplifier.connect(this.makeup)
    this.makeup.connect(this.wetGain)

    this.keep(this.amplifier)
    this.keep(this.makeup)
    this.keep(rectifier)
    this.keep(smootherA)
    this.keep(smootherB)
    this.keep(this.shaper)
  }

  update(settings: CompressorSettings, enabled: boolean): void {
    if (settings.amount !== this.amount) {
      this.amount = settings.amount
      this.shaper.curve = compressionCurve(settings.amount)
      this.makeup.gain.value = 1 + settings.amount * 1.6
    }
    const on = enabled && settings.on
    this.mix(on ? 0 : 1, on ? 1 : 0)
  }
}

/**
 * Envelope (0–1) mapped to a gain multiplier of at most 1: this curve only ever *reduces* gain,
 * and the make-up gain that follows it is a separate node, so louder settings cannot inflate the
 * transient they are supposed to be holding down.
 */
export function compressionCurve(amount: number, size = 1024): Float32Array {
  const curve = new Float32Array(size)
  const ratio = 1 + amount * 7
  const threshold = 0.05
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1
    const envelope = Math.max(1e-4, Math.abs(x))
    const over = envelope / threshold
    curve[i] = over <= 1 ? 1 : Math.pow(over, 1 / ratio - 1)
  }
  return curve
}

/* ------------------------------------------------------------------ Reverb */

interface ReverbShape {
  readonly combs: readonly number[]
  readonly feedback: number
  readonly allpass: readonly number[]
  readonly damping: number
  readonly bandpass?: { frequency: number; q: number }
}

/** Decay grows from Booth (very short) to Cathedral (very long); Spring is its own animal. */
export const REVERB_SHAPES: Readonly<Record<ReverbType, ReverbShape>> = {
  booth: { combs: [0.0121, 0.0149, 0.0173, 0.0201], feedback: 0.42, allpass: [0.0051, 0.0017], damping: 3600 },
  room: { combs: [0.0231, 0.0277, 0.0311, 0.0353], feedback: 0.68, allpass: [0.0059, 0.0021], damping: 3400 },
  spring: {
    combs: [0.0083, 0.0111, 0.0129],
    feedback: 0.79,
    allpass: [0.0037, 0.0043, 0.0051, 0.0061],
    damping: 2600,
    bandpass: { frequency: 1400, q: 1.4 },
  },
  stage: { combs: [0.0367, 0.0411, 0.0473, 0.0529], feedback: 0.8, allpass: [0.0067, 0.0023], damping: 3000 },
  hall: { combs: [0.0501, 0.0587, 0.0643, 0.0719], feedback: 0.87, allpass: [0.0071, 0.0029], damping: 2600 },
  cathedral: { combs: [0.0743, 0.0839, 0.0931, 0.1039], feedback: 0.93, allpass: [0.0089, 0.0031], damping: 2000 },
}

export class ReverbUnit extends BaseUnit {
  private type: ReverbType | null = null
  private tone = ''
  private dampers: GraphBiquad[] = []

  update(settings: ReverbSettings, enabled: boolean): void {
    if (settings.type !== this.type) {
      this.clearWet()
      this.dampers = []
      this.buildTank(settings.type)
      this.type = settings.type
      this.tone = ''
    }
    if (settings.tone !== this.tone) {
      this.tone = settings.tone
      const shape = REVERB_SHAPES[settings.type]
      const factor = settings.tone === 'bright' ? 2.1 : settings.tone === 'dark' ? 0.45 : 1
      for (const damper of this.dampers) damper.frequency.value = shape.damping * factor
    }
    if (!(enabled && settings.on)) {
      this.mix(1, 0)
      return
    }
    // Fully wet at maximum (manual p. 52).
    const angle = (Math.min(1, Math.max(0, settings.mix)) * Math.PI) / 2
    this.mix(Math.cos(angle), Math.sin(angle))
  }

  private buildTank(type: ReverbType): void {
    const context = this.context
    const shape = REVERB_SHAPES[type]
    const merge = this.keep(gainOf(context, 1 / shape.combs.length))
    let source: GraphNode = this.input
    if (shape.bandpass) {
      const band = this.keep(filterOf(context, 'bandpass', shape.bandpass.frequency, shape.bandpass.q))
      this.input.connect(band)
      source = band
    }
    for (const seconds of shape.combs) {
      const delay = this.keep(context.createDelay(0.3))
      delay.delayTime.value = seconds
      const damper = this.keep(filterOf(context, 'lowpass', shape.damping, 0.7))
      const feedback = this.keep(gainOf(context, shape.feedback))
      source.connect(delay)
      delay.connect(damper)
      damper.connect(feedback)
      feedback.connect(delay)
      delay.connect(merge)
      this.dampers.push(damper)
    }
    let tail: GraphNode = merge
    for (const seconds of shape.allpass) {
      const delay = this.keep(context.createDelay(0.05))
      delay.delayTime.value = seconds
      const feedback = this.keep(gainOf(context, 0.6))
      const forward = this.keep(gainOf(context, -0.6))
      const sum = this.keep(gainOf(context, 1))
      tail.connect(delay)
      tail.connect(forward)
      delay.connect(sum)
      delay.connect(feedback)
      feedback.connect(delay)
      forward.connect(sum)
      tail = sum
    }
    tail.connect(this.wetGain)
  }
}

/* ------------------------------------------------------------------ Rotary */

/**
 * The shared rotary speaker: a horn and a bass rotor turning at their own speeds, with a drive
 * stage. Speed changes accelerate smoothly rather than jumping (manual p. 53).
 */
export class RotaryUnit implements EffectUnit {
  readonly input: GraphGain
  readonly output: GraphGain
  private readonly nodes: GraphNode[] = []
  private readonly hornLfo: GraphOscillator
  private readonly bassLfo: GraphOscillator
  private readonly hornRate: Ramped
  private readonly bassRate: Ramped
  private readonly drive
  private readonly preDrive: GraphGain
  private readonly postDrive: GraphGain
  private lastDrive = -1

  constructor(private readonly context: GraphContext) {
    this.input = context.createGain()
    this.output = context.createGain()
    this.preDrive = gainOf(context, 1)
    this.postDrive = gainOf(context, 1)
    this.drive = context.createWaveShaper()
    this.drive.curve = driveCurve(1.2)

    const horn = filterOf(context, 'highpass', 780, 0.7)
    const hornAmplitude = gainOf(context, 0.75)
    const hornPan = context.createStereoPanner()
    const hornDoppler = context.createDelay(0.01)
    hornDoppler.delayTime.value = 0.0022
    const bass = filterOf(context, 'lowpass', 780, 0.7)
    const bassAmplitude = gainOf(context, 0.85)
    const bassPan = context.createStereoPanner()

    this.hornLfo = lfo(context, 'sine', 0.8)
    this.bassLfo = lfo(context, 'sine', 0.65)
    const hornDepth = gainOf(context, 0.25)
    const hornPanDepth = gainOf(context, 0.85)
    const hornDopplerDepth = gainOf(context, 0.0012)
    const bassDepth = gainOf(context, 0.15)
    const bassPanDepth = gainOf(context, 0.5)

    this.input.connect(this.preDrive)
    this.preDrive.connect(this.drive)
    this.drive.connect(this.postDrive)
    this.postDrive.connect(horn)
    this.postDrive.connect(bass)

    horn.connect(hornDoppler)
    hornDoppler.connect(hornAmplitude)
    hornAmplitude.connect(hornPan)
    hornPan.connect(this.output)
    bass.connect(bassAmplitude)
    bassAmplitude.connect(bassPan)
    bassPan.connect(this.output)

    this.hornLfo.connect(hornDepth)
    hornDepth.connect(hornAmplitude.gain)
    this.hornLfo.connect(hornPanDepth)
    hornPanDepth.connect(hornPan.pan)
    this.hornLfo.connect(hornDopplerDepth)
    hornDopplerDepth.connect(hornDoppler.delayTime)
    this.bassLfo.connect(bassDepth)
    bassDepth.connect(bassAmplitude.gain)
    this.bassLfo.connect(bassPanDepth)
    bassPanDepth.connect(bassPan.pan)

    this.nodes.push(
      this.input,
      this.output,
      this.preDrive,
      this.postDrive,
      this.drive,
      horn,
      hornAmplitude,
      hornPan,
      hornDoppler,
      bass,
      bassAmplitude,
      bassPan,
      this.hornLfo,
      this.bassLfo,
      hornDepth,
      hornPanDepth,
      hornDopplerDepth,
      bassDepth,
      bassPanDepth,
    )

    this.hornRate = new Ramped(this.hornLfo.frequency, 0.8)
    this.bassRate = new Ramped(this.bassLfo.frequency, 0.65)
  }

  update(settings: RotarySettings): void {
    // Morph is a Phase 3 feature (morph sources are not implemented yet), so it holds the
    // current speed rather than pretending to follow a wheel.
    if (settings.speed === 'slow') {
      this.hornRate.set(0.8, this.context, 1.4)
      this.bassRate.set(0.65, this.context, 1.6)
    } else if (settings.speed === 'fast') {
      this.hornRate.set(6.6, this.context, 1.1)
      this.bassRate.set(5.4, this.context, 1.8)
    }
    if (settings.drive !== this.lastDrive) {
      this.lastDrive = settings.drive
      this.drive.curve = driveCurve(1 + settings.drive * 9)
      this.preDrive.gain.value = 1 + settings.drive * 3
      this.postDrive.gain.value = 1 / (1 + settings.drive * 1.6)
    }
  }

  get hornRateHz(): number {
    return this.hornRate.value
  }

  dispose(): void {
    for (const oscillator of [this.hornLfo, this.bassLfo]) {
      try {
        oscillator.stop(this.context.currentTime)
      } catch {
        // already stopped
      }
    }
    for (const node of this.nodes) node.disconnect()
  }
}
