import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  DelayNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  WaveShaperNodeLike,
} from './boundaries'
import type { AmpType, DelayFilter, LayerId, Mod1Type, Mod2Type, ReverbType, Timbre } from './labels'

export type ExtraBusId = 'organ' | 'synthA' | 'synthB' | 'synthC'
import { SIGNAL_ORDER } from './labels'

interface WetProcessor {
  input: AudioNodeLike
  output: AudioNodeLike
  nodes: AudioNodeLike[]
  oscs: OscillatorNodeLike[]
  update: (rate: number, amount: number, time: number) => void
}

function setParam(param: AudioParamLike, value: number, time: number) {
  try {
    if (time <= 0.0001) {
      param.cancelScheduledValues(0)
      param.value = value
      param.setValueAtTime(value, 0)
      return
    }
    param.cancelScheduledValues(time)
    param.setValueAtTime(param.value, time)
    param.linearRampToValueAtTime(value, time + 0.015)
  } catch {
    param.value = value
  }
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function driveCurve(amount: number): Float32Array {
  const n = 512
  const curve = new Float32Array(n)
  const k = 1 + amount * 48
  const norm = Math.tanh(k)
  for (let index = 0; index < n; index++) {
    const x = (index / (n - 1)) * 2 - 1
    curve[index] = Math.tanh(k * x) / norm
  }
  return curve
}

function hash(seed: number) {
  let state = seed >>> 0 || 1
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function makeImpulse(ctx: AudioContextLike, seconds: number, color: 'bright' | 'dark' | 'spring'): AudioBufferLike {
  const length = Math.max(8, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  const next = hash(Math.round(seconds * 1000) + (color === 'dark' ? 17 : color === 'spring' ? 29 : 3))
  let low = 0
  const decaySec = Math.max(0.05, seconds * 0.34)
  for (let index = 0; index < length; index++) {
    const noise = next() * 2 - 1
    const decay = Math.exp(-index / (ctx.sampleRate * decaySec))
    if (color === 'dark') {
      low += 0.12 * (noise - low)
      data[index] = low * decay
    } else {
      data[index] = noise * decay
    }
  }
  if (color === 'spring') {
    for (const delay of [0.029, 0.061, 0.097, 0.143]) {
      const offset = Math.floor(delay * ctx.sampleRate)
      for (let index = offset; index < length; index++) data[index] += (data[index - offset] ?? 0) * 0.42
    }
  }
  let peak = 0.0001
  for (let index = 0; index < length; index++) peak = Math.max(peak, Math.abs(data[index] ?? 0))
  for (let index = 0; index < length; index++) data[index] = ((data[index] ?? 0) / peak) * 0.7
  return buffer
}

const REVERB_SECONDS: Record<ReverbType, number> = {
  Booth: 0.22,
  Room: 0.48,
  Spring: 0.7,
  Stage: 1.15,
  Hall: 1.85,
  Cathedral: 3.1,
}

class Insert {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly dry: GainNodeLike
  private readonly wetIn: GainNodeLike
  private readonly wetReturn: GainNodeLike
  private processor: WetProcessor | null = null
  private links: AudioNodeLike[] = []

  constructor(private readonly ctx: AudioContextLike) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.dry = ctx.createGain()
    this.wetIn = ctx.createGain()
    this.wetReturn = ctx.createGain()
    this.dry.gain.value = 1
    this.wetIn.gain.value = 0
    this.wetReturn.gain.value = 0
    this.input.connect(this.dry)
    this.dry.connect(this.output)
    this.input.connect(this.wetIn)
    this.wetReturn.connect(this.output)
  }

  setBlend(dry: number, wet: number, time: number) {
    setParam(this.dry.gain, dry, time)
    setParam(this.wetIn.gain, wet, time)
    setParam(this.wetReturn.gain, wet > 0.0001 ? 1 : 0, time)
  }

  mount(processor: WetProcessor) {
    this.clearProcessor()
    this.processor = processor
    this.wetIn.connect(processor.input)
    processor.output.connect(this.wetReturn)
    this.links = [processor.input, processor.output]
  }

  update(rate: number, amount: number, time: number) {
    this.processor?.update(rate, amount, time)
  }

  private clearProcessor() {
    try {
      this.wetIn.disconnect()
    } catch {
      /* already clear */
    }
    if (this.processor) {
      for (const osc of this.processor.oscs) {
        try {
          osc.stop()
        } catch {
          /* already stopped */
        }
      }
      for (const node of this.processor.nodes) {
        try {
          node.disconnect()
        } catch {
          /* already disconnected */
        }
      }
    }
    this.processor = null
    this.links = []
  }

  dispose() {
    this.clearProcessor()
    for (const node of [this.input, this.output, this.dry, this.wetIn, this.wetReturn]) {
      try {
        node.disconnect()
      } catch {
        /* closed */
      }
    }
  }
}

function lfo(ctx: AudioContextLike, rateHz: number, time: number): OscillatorNodeLike {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = rateHz
  osc.start(Math.max(0, time))
  return osc
}

function gain(ctx: AudioContextLike, value = 1): GainNodeLike {
  const node = ctx.createGain()
  node.gain.value = value
  return node
}

function biquad(ctx: AudioContextLike, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNodeLike {
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.value = frequency
  filter.Q.value = q
  return filter
}

function mod1Processor(ctx: AudioContextLike, type: Mod1Type, rate: number, amount: number, time: number, stereo: boolean): WetProcessor {
  const input = gain(ctx)
  const output = gain(ctx)
  const nodes: AudioNodeLike[] = [input, output]
  const oscs: OscillatorNodeLike[] = []
  const rateHz = 0.2 + rate * 11
  const depth = clamp01(amount)

  const finish = (update: WetProcessor['update']): WetProcessor => ({ input, output, nodes, oscs, update })

  if (type === 'A-Pan' && stereo && ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner()
    const osc = lfo(ctx, rateHz, time)
    const depthGain = gain(ctx, depth)
    osc.connect(depthGain)
    depthGain.connect(panner.pan)
    input.connect(panner)
    panner.connect(output)
    oscs.push(osc)
    nodes.push(panner, depthGain, osc)
    return finish((nextRate, nextAmount, when) => {
      setParam(osc.frequency, 0.2 + nextRate * 11, when)
      setParam(depthGain.gain, clamp01(nextAmount), when)
    })
  }

  if (type === 'Tremolo' || type === 'A-Pan' || type === 'Pump') {
    const amp = gain(ctx, 1)
    const osc = lfo(ctx, type === 'Pump' ? Math.max(0.4, rateHz * 0.55) : rateHz, time)
    if (type === 'Pump') osc.type = 'square'
    const depthGain = gain(ctx, depth * (type === 'Pump' ? 0.85 : 0.5))
    osc.connect(depthGain)
    depthGain.connect(amp.gain)
    amp.gain.value = 1 - depth * (type === 'Pump' ? 0.45 : 0.25)
    input.connect(amp)
    amp.connect(output)
    oscs.push(osc)
    nodes.push(amp, depthGain, osc)
    return finish((nextRate, nextAmount, when) => {
      const nextDepth = clamp01(nextAmount)
      setParam(osc.frequency, type === 'Pump' ? Math.max(0.4, (0.2 + nextRate * 11) * 0.55) : 0.2 + nextRate * 11, when)
      setParam(depthGain.gain, nextDepth * (type === 'Pump' ? 0.85 : 0.5), when)
      setParam(amp.gain, 1 - nextDepth * (type === 'Pump' ? 0.45 : 0.25), when)
    })
  }

  if (type === 'Ring Mod') {
    const ring = gain(ctx, 1 - depth)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 30 + rate * 740
    const depthGain = gain(ctx, depth)
    osc.connect(depthGain)
    depthGain.connect(ring.gain)
    osc.start(Math.max(0, time))
    input.connect(ring)
    ring.connect(output)
    oscs.push(osc)
    nodes.push(ring, depthGain, osc)
    return finish((nextRate, nextAmount, when) => {
      const nextDepth = clamp01(nextAmount)
      setParam(osc.frequency, 30 + nextRate * 740, when)
      setParam(depthGain.gain, nextDepth, when)
      setParam(ring.gain, 1 - nextDepth, when)
    })
  }

  if (type === 'Wah' || type === 'A-Wah') {
    const filter = biquad(ctx, type === 'Wah' ? 'lowpass' : 'bandpass', 800, type === 'A-Wah' ? 6 : 4)
    input.connect(filter)
    filter.connect(output)
    nodes.push(filter)
    if (type === 'Wah') {
      const osc = lfo(ctx, rateHz, time)
      const depthGain = gain(ctx, 200 + depth * 2200)
      osc.connect(depthGain)
      depthGain.connect(filter.frequency)
      oscs.push(osc)
      nodes.push(depthGain, osc)
      return finish((nextRate, nextAmount, when) => {
        setParam(osc.frequency, 0.2 + nextRate * 11, when)
        setParam(depthGain.gain, 200 + clamp01(nextAmount) * 2200, when)
      })
    }
    const shaper = ctx.createWaveShaper()
    const curve = new Float32Array(256)
    for (let index = 0; index < curve.length; index++) curve[index] = Math.abs((index / (curve.length - 1)) * 2 - 1)
    shaper.curve = curve
    const smooth = biquad(ctx, 'lowpass', 12, 0.7)
    const sens = gain(ctx, 400 + (0.2 + rate) * depth * 2800)
    input.connect(shaper)
    shaper.connect(smooth)
    smooth.connect(sens)
    sens.connect(filter.frequency)
    filter.frequency.value = 280
    nodes.push(shaper, smooth, sens)
    return finish((nextRate, nextAmount, when) => {
      setParam(sens.gain, 400 + (0.2 + nextRate) * clamp01(nextAmount) * 2800, when)
    })
  }

  input.connect(output)
  return finish(() => undefined)
}

function mod2Processor(ctx: AudioContextLike, type: Mod2Type, rate: number, amount: number, time: number): WetProcessor {
  const input = gain(ctx)
  const output = gain(ctx)
  const nodes: AudioNodeLike[] = [input, output]
  const oscs: OscillatorNodeLike[] = []
  const depth = clamp01(amount)
  const rateHz = 0.08 + rate * 6

  const modulatedDelay = (seconds: number, lfoHz: number, feedback: number) => {
    const delay = ctx.createDelay(0.08)
    delay.delayTime.value = seconds
    const osc = lfo(ctx, lfoHz, time)
    const depthGain = gain(ctx, seconds * 0.45 * Math.max(0.05, depth))
    osc.connect(depthGain)
    depthGain.connect(delay.delayTime)
    const fb = gain(ctx, feedback)
    delay.connect(fb)
    fb.connect(delay)
    oscs.push(osc)
    nodes.push(delay, depthGain, fb, osc)
    return { delay, osc, depthGain, fb, seconds }
  }

  if (type === 'Chorus' || type === 'Spin' || type === 'Ensemble' || type === 'Flanger') {
    const base = type === 'Flanger' ? 0.003 : type === 'Spin' ? 0.028 : 0.018
    const feedback = type === 'Flanger' ? 0.72 * depth : type === 'Chorus' && depth > 0.66 ? 0.25 : 0.04
    const primary = modulatedDelay(base, type === 'Spin' ? rateHz * 0.45 : rateHz, feedback)
    input.connect(primary.delay)
    const wet = gain(ctx, 0.65)
    primary.delay.connect(wet)
    wet.connect(output)
    const dry = gain(ctx, type === 'Flanger' ? 0.55 : 0.75)
    input.connect(dry)
    dry.connect(output)
    nodes.push(wet, dry)
    const extras: { osc: OscillatorNodeLike; seconds: number }[] = []
    if (type === 'Ensemble' || (type === 'Chorus' && depth > 0.55)) {
      for (const [mult, seconds] of [
        [1.37, base * 1.4],
        [0.71, base * 1.9],
      ] as const) {
        const extra = modulatedDelay(seconds, rateHz * mult, 0.05)
        input.connect(extra.delay)
        const extraGain = gain(ctx, 0.33)
        extra.delay.connect(extraGain)
        extraGain.connect(output)
        nodes.push(extraGain)
        extras.push(extra)
      }
    }
    return {
      input,
      output,
      nodes,
      oscs,
      update(nextRate, nextAmount, when) {
        const nextDepth = clamp01(nextAmount)
        const nextHz = 0.08 + nextRate * 6
        const ramp = type === 'Spin' ? 0.6 : 0.02
        const apply = (param: AudioParamLike, value: number) => {
          if (type === 'Spin' && when > 0) {
            try {
              param.cancelScheduledValues(when)
              param.setValueAtTime(param.value, when)
              param.linearRampToValueAtTime(value, when + ramp)
              return
            } catch {
              /* fall through */
            }
          }
          setParam(param, value, when)
        }
        apply(primary.osc.frequency, type === 'Spin' ? nextHz * 0.45 : nextHz)
        setParam(primary.depthGain.gain, primary.seconds * 0.45 * Math.max(0.05, nextDepth), when)
        setParam(primary.fb.gain, type === 'Flanger' ? 0.72 * nextDepth : type === 'Chorus' && nextDepth > 0.66 ? 0.25 : 0.04, when)
        extras.forEach((extra, index) => {
          const mult = index === 0 ? 1.37 : 0.71
          apply(extra.osc.frequency, nextHz * mult)
        })
      },
    }
  }

  if (type === 'Phaser') {
    const filter = biquad(ctx, 'bandpass', 1600, 6)
    const osc = lfo(ctx, rateHz, time)
    const depthGain = gain(ctx, 500 + depth * 2200)
    osc.connect(depthGain)
    depthGain.connect(filter.frequency)
    input.connect(filter)
    const wet = gain(ctx, 0.85)
    const dry = gain(ctx, 0.4)
    filter.connect(wet)
    wet.connect(output)
    input.connect(dry)
    dry.connect(output)
    oscs.push(osc)
    nodes.push(filter, depthGain, osc, wet, dry)
    return {
      input,
      output,
      nodes,
      oscs,
      update(nextRate, nextAmount, when) {
        setParam(osc.frequency, 0.08 + nextRate * 6, when)
        setParam(depthGain.gain, 500 + clamp01(nextAmount) * 2200, when)
      },
    }
  }

  const filter = biquad(ctx, 'lowpass', 700, 9)
  const osc = lfo(ctx, Math.max(0.15, rateHz * 0.28), time)
  osc.type = 'triangle'
  const depthGain = gain(ctx, 80 + depth * 420)
  osc.connect(depthGain)
  depthGain.connect(filter.frequency)
  const trem = lfo(ctx, 5.5, time)
  const tremDepth = gain(ctx, 0.45 * Math.max(0.2, depth))
  const amp = gain(ctx, 0.55)
  trem.connect(tremDepth)
  tremDepth.connect(amp.gain)
  input.connect(filter)
  filter.connect(amp)
  amp.connect(output)
  oscs.push(osc, trem)
  nodes.push(filter, depthGain, osc, trem, tremDepth, amp)
  return {
    input,
    output,
    nodes,
    oscs,
    update(nextRate, nextAmount, when) {
      const nextDepth = clamp01(nextAmount)
      setParam(osc.frequency, Math.max(0.15, (0.08 + nextRate * 6) * 0.28), when)
      setParam(depthGain.gain, 80 + nextDepth * 420, when)
      setParam(tremDepth.gain, 0.45 * Math.max(0.2, nextDepth), when)
    },
  }
}

interface DelayBundle {
  insert: Insert
  delay: DelayNodeLike
  fb: GainNodeLike
  fbDry: GainNodeLike
  fbWet: GainNodeLike
  filter: BiquadFilterNodeLike
}

function createDelay(ctx: AudioContextLike): DelayBundle {
  const insert = new Insert(ctx)
  const delay = ctx.createDelay(2.5)
  delay.delayTime.value = 0.32
  const fb = gain(ctx, 0.35)
  const fbDry = gain(ctx, 1)
  const fbWet = gain(ctx, 0)
  const filter = biquad(ctx, 'lowpass', 1200, 0.7)
  const sum = gain(ctx, 1)
  delay.connect(fbDry)
  fbDry.connect(sum)
  delay.connect(filter)
  filter.connect(fbWet)
  fbWet.connect(sum)
  sum.connect(fb)
  fb.connect(delay)
  const wetOut = gain(ctx, 1)
  delay.connect(wetOut)
  insert.mount({
    input: delay,
    output: wetOut,
    nodes: [delay, fb, fbDry, fbWet, filter, sum, wetOut],
    oscs: [],
    update: () => undefined,
  })
  return { insert, delay, fb, fbDry, fbWet, filter }
}

function applyDelayFilter(bundle: DelayBundle, mode: DelayFilter, time: number) {
  if (mode === 'Off') {
    setParam(bundle.fbDry.gain, 1, time)
    setParam(bundle.fbWet.gain, 0, time)
    return
  }
  bundle.filter.type = mode === 'HP' ? 'highpass' : mode === 'BP' ? 'bandpass' : 'lowpass'
  bundle.filter.frequency.value = mode === 'HP' ? 900 : mode === 'BP' ? 1100 : 1400
  bundle.filter.Q.value = mode === 'BP' ? 1.4 : 0.7
  setParam(bundle.fbDry.gain, 0, time)
  setParam(bundle.fbWet.gain, 1, time)
}

class LayerBus {
  readonly input: GainNodeLike
  readonly level: GainNodeLike
  private readonly timbreDry: GainNodeLike
  private readonly timbreWet: GainNodeLike
  private readonly timbreFilter: BiquadFilterNodeLike
  private readonly postTimbre: GainNodeLike
  private readonly bypass: GainNodeLike
  private readonly chainIn: GainNodeLike
  private readonly chainOut: GainNodeLike
  readonly mod1: Insert
  readonly mod2: Insert
  readonly delay: DelayBundle
  readonly amp: Insert
  private ampShaper: WaveShaperNodeLike
  private readonly ampBass: BiquadFilterNodeLike
  private readonly ampMid: BiquadFilterNodeLike
  private readonly ampTreble: BiquadFilterNodeLike
  private readonly ampLp: BiquadFilterNodeLike
  private readonly ampLp2: BiquadFilterNodeLike
  private readonly ampHp: BiquadFilterNodeLike
  private readonly ampHp2: BiquadFilterNodeLike
  private readonly ampDriveGain: GainNodeLike
  readonly comp: Insert
  private readonly compressor: NonNullable<ReturnType<NonNullable<AudioContextLike['createDynamicsCompressor']>>>
  readonly reverb: Insert
  private readonly convolver: AudioNodeLike & { buffer: AudioBufferLike | null }
  readonly direct: GainNodeLike
  readonly send: GainNodeLike
  private mod1Type: Mod1Type = 'A-Pan'
  private mod2Type: Mod2Type = 'Chorus'
  private reverbType: ReverbType = 'Room'
  private reverbBright = true

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly stereo: boolean,
    private readonly impulses: Map<string, AudioBufferLike>,
  ) {
    this.input = gain(ctx)
    this.timbreDry = gain(ctx, 1)
    this.timbreWet = gain(ctx, 0)
    this.timbreFilter = biquad(ctx, 'peaking', 1200, 0.7)
    this.postTimbre = gain(ctx)
    this.bypass = gain(ctx, 1)
    this.chainIn = gain(ctx, 0)
    this.chainOut = gain(ctx, 0)
    this.level = gain(ctx, 1)
    this.direct = gain(ctx, 1)
    this.send = gain(ctx, 0)
    this.input.connect(this.timbreDry)
    this.timbreDry.connect(this.postTimbre)
    this.input.connect(this.timbreFilter)
    this.timbreFilter.connect(this.timbreWet)
    this.timbreWet.connect(this.postTimbre)
    this.postTimbre.connect(this.bypass)
    this.postTimbre.connect(this.chainIn)
    this.bypass.connect(this.level)
    this.chainOut.connect(this.level)
    this.level.connect(this.direct)
    this.level.connect(this.send)

    this.mod1 = new Insert(ctx)
    this.mod2 = new Insert(ctx)
    this.delay = createDelay(ctx)
    this.amp = new Insert(ctx)
    this.comp = new Insert(ctx)
    this.reverb = new Insert(ctx)
    this.chainIn.connect(this.mod1.input)
    this.mod1.output.connect(this.mod2.input)
    this.mod2.output.connect(this.delay.insert.input)
    this.delay.insert.output.connect(this.amp.input)
    this.amp.output.connect(this.comp.input)
    this.comp.output.connect(this.reverb.input)
    this.reverb.output.connect(this.chainOut)

    this.mountMod1(0)
    this.mountMod2(0)

    this.ampDriveGain = gain(ctx, 1)
    this.ampShaper = ctx.createWaveShaper()
    this.ampShaper.curve = driveCurve(1)
    this.ampDriveGain.connect(this.ampShaper)
    this.ampBass = biquad(ctx, 'lowshelf', 100, 0.7)
    this.ampMid = biquad(ctx, 'peaking', 900, 0.9)
    this.ampTreble = biquad(ctx, 'highshelf', 4000, 0.7)
    this.ampLp = biquad(ctx, 'lowpass', 18000, 0.7)
    this.ampLp2 = biquad(ctx, 'lowpass', 18000, 0.7)
    this.ampHp = biquad(ctx, 'highpass', 20, 0.7)
    this.ampHp2 = biquad(ctx, 'highpass', 20, 0.7)
    const ampTrim = gain(ctx, 0.62)
    this.ampShaper.connect(this.ampBass)
    this.ampBass.connect(this.ampMid)
    this.ampMid.connect(this.ampTreble)
    this.ampTreble.connect(this.ampLp)
    this.ampLp.connect(this.ampLp2)
    this.ampLp2.connect(this.ampHp)
    this.ampHp.connect(this.ampHp2)
    this.ampHp2.connect(ampTrim)
    this.amp.mount({
      input: this.ampDriveGain,
      output: ampTrim,
      nodes: [this.ampShaper, this.ampBass, this.ampMid, this.ampTreble, this.ampLp, this.ampLp2, this.ampHp, this.ampHp2, ampTrim],
      oscs: [],
      update: () => undefined,
    })

    const compressor = ctx.createDynamicsCompressor?.()
    if (!compressor) throw new Error('DynamicsCompressor is required')
    this.compressor = compressor
    this.compressor.threshold.value = 0
    this.compressor.knee.value = 8
    this.compressor.ratio.value = 1
    this.compressor.attack.value = 0.02
    this.compressor.release.value = 0.25
    this.comp.mount({
      input: this.compressor,
      output: this.compressor,
      nodes: [this.compressor],
      oscs: [],
      update: () => undefined,
    })

    const convolver = ctx.createConvolver()
    this.convolver = convolver
    convolver.buffer = this.impulse('Room', true)
    this.reverb.mount({
      input: convolver,
      output: convolver,
      nodes: [convolver],
      oscs: [],
      update: () => undefined,
    })
  }

  private impulse(type: ReverbType, bright: boolean): AudioBufferLike {
    const key = `${type}:${bright ? 'bright' : 'dark'}`
    const cached = this.impulses.get(key)
    if (cached) return cached
    const buffer = makeImpulse(this.ctx, REVERB_SECONDS[type], type === 'Spring' ? 'spring' : bright ? 'bright' : 'dark')
    this.impulses.set(key, buffer)
    return buffer
  }

  private mountMod1(time: number) {
    this.mod1.mount(mod1Processor(this.ctx, this.mod1Type, 0.5, 0.7, time, this.stereo))
  }

  private mountMod2(time: number) {
    this.mod2.mount(mod2Processor(this.ctx, this.mod2Type, 0.4, 0.6, time, ))
  }

  setEffectsEnabled(on: boolean, time: number) {
    setParam(this.bypass.gain, on ? 0 : 1, time)
    setParam(this.chainIn.gain, on ? 1 : 0, time)
    setParam(this.chainOut.gain, on ? 1 : 0, time)
  }

  setTimbre(timbre: Timbre, time: number) {
    if (timbre === 'Off') {
      setParam(this.timbreDry.gain, 1, time)
      setParam(this.timbreWet.gain, 0, time)
      return
    }
    setParam(this.timbreDry.gain, 0, time)
    setParam(this.timbreWet.gain, 1, time)
    if (timbre === 'Soft') {
      this.timbreFilter.type = 'lowpass'
      this.timbreFilter.frequency.value = 1400
      this.timbreFilter.Q.value = 0.6
      this.timbreFilter.gain.value = 0
    } else if (timbre === 'Mid') {
      this.timbreFilter.type = 'peaking'
      this.timbreFilter.frequency.value = 900
      this.timbreFilter.Q.value = 0.9
      this.timbreFilter.gain.value = 9
    } else if (timbre === 'Bright') {
      this.timbreFilter.type = 'highshelf'
      this.timbreFilter.frequency.value = 2800
      this.timbreFilter.gain.value = 8
    } else if (timbre === 'Dyno 1') {
      this.timbreFilter.type = 'peaking'
      this.timbreFilter.frequency.value = 1800
      this.timbreFilter.Q.value = 1.3
      this.timbreFilter.gain.value = 8
    } else {
      this.timbreFilter.type = 'highshelf'
      this.timbreFilter.frequency.value = 2400
      this.timbreFilter.gain.value = 11
    }
  }

  setMod1(type: Mod1Type, rate: number, amount: number, on: boolean, time: number) {
    if (type !== this.mod1Type) {
      this.mod1Type = type
      this.mountMod1(time)
    }
    this.mod1.update(rate, amount, time)
    this.mod1.setBlend(on ? 0 : 1, on ? 1 : 0, time)
  }

  setMod2(type: Mod2Type, rate: number, amount: number, on: boolean, time: number) {
    if (type !== this.mod2Type) {
      this.mod2Type = type
      this.mountMod2(time)
    }
    this.mod2.update(rate, amount, time)
    this.mod2.setBlend(on ? 0.15 : 1, on ? 0.85 : 0, time)
  }

  setDelay(tempo: number, feedback: number, mix: number, filter: DelayFilter, on: boolean, time: number) {
    const seconds = 0.04 + (1 - clamp01(tempo)) * 0.9
    setParam(this.delay.delay.delayTime, seconds, time)
    setParam(this.delay.fb.gain, clamp01(feedback) * 0.82, time)
    applyDelayFilter(this.delay, filter, time)
    const wet = on ? clamp01(mix) : 0
    this.delay.insert.setBlend(on ? 1 - wet : 1, wet, time)
  }

  setDelayTime(seconds: number, time: number) {
    setParam(this.delay.delay.delayTime, Math.min(1.8, Math.max(0.03, seconds)), time)
  }

  setAmp(
    type: AmpType,
    drive: number,
    bass: number,
    mid: number,
    freq: number,
    treble: number,
    on: boolean,
    time: number,
  ) {
    const driveAmount = type === 'EQ' || type === 'LP24' || type === 'HP24' || type === 'Rotary' ? 0.2 + drive * 0.35 : 0.3 + drive * (type === 'Small' ? 1.55 : type === 'Twin' ? 1.15 : type === 'JC' ? 0.65 : 0.9)
    setParam(this.ampDriveGain.gain, driveAmount, time)
    const bassDb = (bass - 0.5) * 18
    const midDb = (mid - 0.5) * 18
    const trebleDb = (treble - 0.5) * 18
    const midHz = 200 * 2 ** (clamp01(freq) * Math.log2(8000 / 200))
    this.ampBass.frequency.value = 100
    this.ampBass.gain.value = type === 'LP24' || type === 'HP24' ? 0 : type === 'Small' ? bassDb + 4 : type === 'Twin' ? bassDb + 1 : bassDb
    this.ampMid.frequency.value = midHz
    this.ampMid.gain.value = type === 'LP24' || type === 'HP24' ? 0 : type === 'Twin' ? midDb - 6 : type === 'JC' ? midDb + 2 : type === 'Small' ? midDb + 3 : midDb
    this.ampMid.Q.value = 0.9
    this.ampTreble.frequency.value = 4000
    this.ampTreble.gain.value = type === 'LP24' || type === 'HP24' ? 0 : type === 'JC' ? trebleDb + 6 : type === 'Small' ? trebleDb - 5 : type === 'Twin' ? trebleDb + 2 : trebleDb
    const cutoff = 80 + clamp01(freq) * 8000
    const q = 0.5 + clamp01(mid) * 12
    if (type === 'LP24') {
      this.ampLp.frequency.value = cutoff
      this.ampLp2.frequency.value = cutoff
      this.ampLp.Q.value = q
      this.ampLp2.Q.value = q
      this.ampHp.frequency.value = 20
      this.ampHp2.frequency.value = 20
    } else if (type === 'HP24') {
      this.ampHp.frequency.value = cutoff
      this.ampHp2.frequency.value = cutoff
      this.ampHp.Q.value = q
      this.ampHp2.Q.value = q
      this.ampLp.frequency.value = 18000
      this.ampLp2.frequency.value = 18000
    } else if (type === 'Small') {
      this.ampLp.frequency.value = 2400
      this.ampLp2.frequency.value = 3200
      this.ampHp.frequency.value = 80
      this.ampHp2.frequency.value = 80
    } else if (type === 'Twin') {
      this.ampLp.frequency.value = 5200
      this.ampLp2.frequency.value = 7000
      this.ampHp.frequency.value = 50
      this.ampHp2.frequency.value = 50
    } else if (type === 'Rotary') {
      this.ampLp.frequency.value = 4500
      this.ampLp2.frequency.value = 6000
      this.ampHp.frequency.value = 90
      this.ampHp2.frequency.value = 90
    } else {
      this.ampLp.frequency.value = 14000
      this.ampLp2.frequency.value = 16000
      this.ampHp.frequency.value = 30
      this.ampHp2.frequency.value = 30
    }
    this.amp.setBlend(on ? 0 : 1, on ? 1 : 0, time)
  }

  setComp(amount: number, fast: boolean, on: boolean, time: number) {
    const level = clamp01(amount)
    setParam(this.compressor.threshold, on ? -6 - level * 30 : 0, time)
    setParam(this.compressor.ratio, on ? 1 + level * 10 : 1, time)
    setParam(this.compressor.attack, fast ? 0.002 : 0.018, time)
    setParam(this.compressor.release, fast ? 0.045 : 0.28, time)
    this.compressor.knee.value = fast ? 2 : 10
    this.comp.setBlend(on ? 0 : 1, on ? 1 : 0, time)
  }

  setReverb(type: ReverbType, mix: number, bright: boolean, on: boolean, time: number) {
    if (type !== this.reverbType || bright !== this.reverbBright) {
      this.reverbType = type
      this.reverbBright = bright
      this.convolver.buffer = this.impulse(type, bright && type !== 'Spring')
    }
    const wet = on ? clamp01(mix) : 0
    this.reverb.setBlend(on ? 1 - wet : 1, wet, time)
  }

  setRoute(toRotary: boolean, time: number) {
    setParam(this.direct.gain, toRotary ? 0 : 1, time)
    setParam(this.send.gain, toRotary ? 1 : 0, time)
  }

  setLevel(value: number, time: number) {
    setParam(this.level.gain, Math.max(0, value), time)
  }
}

export class InstrumentGraph {
  readonly order = SIGNAL_ORDER
  readonly layers: Record<LayerId, LayerBus>
  readonly extra: Record<ExtraBusId, LayerBus>
  private readonly master: GainNodeLike
  private readonly limiter: AudioNodeLike
  private readonly rotaryInput: GainNodeLike
  private readonly horn: OscillatorNodeLike
  private readonly bass: OscillatorNodeLike
  private readonly hornDepth: GainNodeLike
  private readonly bassDepth: GainNodeLike
  private readonly rotaryDriveGain: GainNodeLike
  private readonly drive: WaveShaperNodeLike
  private destinationLinks = 1

  constructor(private readonly ctx: AudioContextLike) {
    const stereo = (ctx.destination.channelCount ?? 1) > 1
    const impulses = new Map<string, AudioBufferLike>()
    this.layers = {
      A: new LayerBus(ctx, stereo, impulses),
      B: new LayerBus(ctx, stereo, impulses),
    }
    this.extra = {
      organ: new LayerBus(ctx, stereo, impulses),
      synthA: new LayerBus(ctx, stereo, impulses),
      synthB: new LayerBus(ctx, stereo, impulses),
      synthC: new LayerBus(ctx, stereo, impulses),
    }
    this.master = gain(ctx, 0.85)
    this.rotaryInput = gain(ctx, 1)
    this.layers.A.send.connect(this.rotaryInput)
    this.layers.B.send.connect(this.rotaryInput)
    for (const bus of Object.values(this.extra)) bus.send.connect(this.rotaryInput)
    const low = biquad(ctx, 'lowpass', 700, 0.7)
    const high = biquad(ctx, 'highpass', 700, 0.7)
    this.rotaryInput.connect(low)
    this.rotaryInput.connect(high)
    const bassAmp = gain(ctx, 1)
    const hornAmp = gain(ctx, 1)
    this.bass = lfo(ctx, 0.7, 0)
    this.horn = lfo(ctx, 0.9, 0)
    this.bassDepth = gain(ctx, 0.45)
    this.hornDepth = gain(ctx, 0.55)
    this.bass.connect(this.bassDepth)
    this.horn.connect(this.hornDepth)
    this.bassDepth.connect(bassAmp.gain)
    this.hornDepth.connect(hornAmp.gain)
    bassAmp.gain.value = 0.8
    hornAmp.gain.value = 0.75
    low.connect(bassAmp)
    high.connect(hornAmp)
    const sum = gain(ctx, 1)
    bassAmp.connect(sum)
    hornAmp.connect(sum)
    this.rotaryDriveGain = gain(ctx, 0.4)
    this.drive = ctx.createWaveShaper()
    this.drive.curve = driveCurve(1)
    sum.connect(this.rotaryDriveGain)
    this.rotaryDriveGain.connect(this.drive)
    this.drive.connect(this.master)
    this.layers.A.direct.connect(this.master)
    this.layers.B.direct.connect(this.master)
    for (const bus of Object.values(this.extra)) bus.direct.connect(this.master)

    const limiter = ctx.createDynamicsCompressor?.()
    if (limiter) {
      limiter.threshold.value = -12
      limiter.knee.value = 6
      limiter.ratio.value = 8
      limiter.attack.value = 0.003
      limiter.release.value = 0.15
      this.master.connect(limiter)
      limiter.connect(ctx.destination)
      this.limiter = limiter
    } else {
      this.master.connect(ctx.destination)
      this.limiter = this.master
    }
  }

  input(layer: LayerId): GainNodeLike {
    return this.layers[layer].input
  }

  extraInput(id: ExtraBusId): GainNodeLike {
    return this.extra[id].input
  }

  private extraBus(id: ExtraBusId): LayerBus {
    return this.extra[id]
  }

  destinationFeedCount() {
    return this.destinationLinks
  }

  setMasterLevel(knob: number, time: number) {
    setParam(this.master.gain, (knob / 100) * 0.85, time)
  }

  setLayerLevel(layer: LayerId, knob: number, time: number) {
    this.layers[layer].setLevel(knob / 100, time)
  }

  setEffectsEnabled(on: boolean, time: number) {
    this.layers.A.setEffectsEnabled(on, time)
    this.layers.B.setEffectsEnabled(on, time)
  }

  setTimbre(layer: LayerId, timbre: Timbre, time: number) {
    this.layers[layer].setTimbre(timbre, time)
  }

  setMod1(layer: LayerId, type: Mod1Type, rate: number, amount: number, on: boolean, time: number) {
    this.layers[layer].setMod1(type, rate / 127, amount / 127, on, time)
  }

  setMod2(layer: LayerId, type: Mod2Type, rate: number, amount: number, on: boolean, time: number) {
    this.layers[layer].setMod2(type, rate / 127, amount / 127, on, time)
  }

  setDelay(layer: LayerId, tempo: number, feedback: number, mix: number, filter: DelayFilter, on: boolean, time: number) {
    this.layers[layer].setDelay(tempo / 127, feedback / 127, mix / 127, filter, on, time)
  }

  setDelaySeconds(layer: LayerId, seconds: number, time: number) {
    this.layers[layer].setDelayTime(seconds, time)
  }

  setAmp(
    layer: LayerId,
    type: AmpType,
    drive: number,
    bass: number,
    mid: number,
    freq: number,
    treble: number,
    on: boolean,
    time: number,
  ) {
    this.layers[layer].setAmp(type, drive / 127, bass / 127, mid / 127, freq / 127, treble / 127, on, time)
  }

  setComp(layer: LayerId, amount: number, fast: boolean, on: boolean, time: number) {
    this.layers[layer].setComp(amount / 127, fast, on, time)
  }

  setReverb(layer: LayerId, type: ReverbType, mix: number, bright: boolean, on: boolean, time: number) {
    this.layers[layer].setReverb(type, mix / 127, bright, on, time)
  }

  setRotarySend(layer: LayerId, on: boolean, time: number) {
    this.layers[layer].setRoute(on, time)
  }

  setRotary(fast: boolean, stopped: boolean, drive: number, time: number) {
    this.setRotaryAmount(fast ? 1 : 0, stopped, drive, time)
  }

  /** amount 0 is slow, 1 is fast. Speed changes ramp so the rotor accelerates. */
  setRotaryAmount(amount: number, stopped: boolean, drive: number, time: number) {
    const span = Math.max(0, Math.min(1, amount))
    const hornHz = stopped ? 0.15 : 0.8 + span * 5.8
    const bassHz = stopped ? 0.1 : 0.62 + span * 4.6
    const depth = stopped ? 0.02 : 0.42 + span * 0.22
    const when = Math.max(time, 0)
    const glide = when <= 0.0001 ? 0 : 0.85
    const rampHz = (param: AudioParamLike, value: number) => {
      if (glide === 0) {
        setParam(param, value, 0)
        return
      }
      try {
        param.cancelScheduledValues(when)
        param.setValueAtTime(param.value, when)
        param.linearRampToValueAtTime(value, when + glide)
      } catch {
        param.value = value
      }
    }
    rampHz(this.horn.frequency, hornHz)
    rampHz(this.bass.frequency, bassHz)
    setParam(this.hornDepth.gain, depth, time)
    setParam(this.bassDepth.gain, depth * 0.8, time)
    setParam(this.rotaryDriveGain.gain, 0.25 + (drive / 127) * 2.4, time)
  }

  setExtraChain(
    id: ExtraBusId,
    fx: {
      effectsOn: boolean
      mod1Type: Mod1Type
      mod1Rate: number
      mod1Amount: number
      mod1On: boolean
      mod2Type: Mod2Type
      mod2Rate: number
      mod2Amount: number
      mod2On: boolean
      delayTempo: number
      delayFeedback: number
      delayMix: number
      delayFilter: DelayFilter
      delayOn: boolean
      delaySeconds?: number
      ampType: AmpType
      ampDrive: number
      ampBass: number
      ampMid: number
      ampFreq: number
      ampTreble: number
      ampOn: boolean
      compAmount: number
      compFast: boolean
      compOn: boolean
      reverbType: ReverbType
      reverbMix: number
      reverbBright: boolean
      reverbOn: boolean
      toRotary: boolean
      level: number
    },
    time: number,
  ) {
    const bus = this.extraBus(id)
    bus.setEffectsEnabled(fx.effectsOn, time)
    bus.setLevel(fx.level, time)
    bus.setMod1(fx.mod1Type, fx.mod1Rate, fx.mod1Amount, fx.mod1On, time)
    bus.setMod2(fx.mod2Type, fx.mod2Rate, fx.mod2Amount, fx.mod2On, time)
    bus.setDelay(fx.delayTempo, fx.delayFeedback, fx.delayMix, fx.delayFilter, fx.delayOn, time)
    if (fx.delaySeconds !== undefined) bus.setDelayTime(fx.delaySeconds, time)
    bus.setAmp(fx.ampType, fx.ampDrive, fx.ampBass, fx.ampMid, fx.ampFreq, fx.ampTreble, fx.ampOn, time)
    bus.setComp(fx.compAmount, fx.compFast, fx.compOn, time)
    bus.setReverb(fx.reverbType, fx.reverbMix, fx.reverbBright, fx.reverbOn, time)
    bus.setRoute(fx.toRotary, time)
  }

  dispose() {
    for (const osc of [this.horn, this.bass]) {
      try {
        osc.stop()
      } catch {
        /* already stopped */
      }
    }
    const buses = [this.layers.A, this.layers.B, ...Object.values(this.extra)]
    for (const bus of buses) {
      bus.mod1.dispose()
      bus.mod2.dispose()
      bus.delay.insert.dispose()
      bus.amp.dispose()
      bus.comp.dispose()
      bus.reverb.dispose()
    }
    try {
      this.master.disconnect()
      this.limiter.disconnect()
    } catch {
      /* closed */
    }
    this.destinationLinks = 0
  }
}
