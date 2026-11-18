import {
  delayTime,
  order,
  type Effect,
  type Settings,
  type Unit,
} from './settings'

function glide(
  p: AudioParam,
  value: number,
  ctx: BaseAudioContext,
  time = 0.008,
) {
  p.cancelAndHoldAtTime(ctx.currentTime)
  p.setTargetAtTime(value, ctx.currentTime, time)
}

/** Own all nodes (including modulation sources) belonging to one processor. */
class Network {
  nodes: AudioNode[] = []
  sources: OscillatorNode[] = []
  private pending: OscillatorNode[] = []
  private startPending = () => {
    if (this.ctx.state !== 'running') return
    for (const source of this.pending) {
      source.start()
      this.sources.push(source)
    }
    this.pending = []
    this.ctx.removeEventListener('statechange', this.startPending)
  }
  constructor(readonly ctx: BaseAudioContext) {}
  keep<T extends AudioNode>(n: T) {
    this.nodes.push(n)
    return n
  }
  gain(v = 1) {
    const n = this.keep(this.ctx.createGain())
    n.gain.value = v
    return n
  }
  filter(type: BiquadFilterType, hz: number, q = 0.707) {
    const f = this.keep(this.ctx.createBiquadFilter())
    f.type = type
    f.frequency.value = hz
    f.Q.value = q
    return f
  }
  lfo(type: OscillatorType, hz: number) {
    const n = this.keep(this.ctx.createOscillator())
    n.type = type
    n.frequency.value = hz
    if (this.ctx.state === 'running' || 'startRendering' in this.ctx) {
      this.sources.push(n)
      n.start()
    } else {
      this.pending.push(n)
      this.ctx.addEventListener('statechange', this.startPending)
    }
    return n
  }
  dispose() {
    this.ctx.removeEventListener('statechange', this.startPending)
    this.pending = []
    for (const o of this.sources) o.stop()
    for (const n of this.nodes) n.disconnect()
    this.nodes = []
    this.sources = []
  }
}
function saturate(net: Network, drive: number) {
  const n = net.keep(net.ctx.createWaveShaper())
  n.curve = Float32Array.from(
    { length: 1025 },
    (_, i) => Math.tanh((i / 512 - 1) * drive) / Math.tanh(drive),
  )
  return n
}
const responses = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>()
function response(ctx: BaseAudioContext, type: number) {
  const cache = responses.get(ctx) ?? new Map<number, AudioBuffer>()
  responses.set(ctx, cache)
  const cached = cache.get(type)
  if (cached) return cached
  const duration = [0.85, 0.27, 1.65, 1.95, 3.1, 5][type],
    rate = ctx.sampleRate
  const b = ctx.createBuffer(2, Math.ceil(duration * rate), rate)
  for (let ch = 0; ch < 2; ch++) {
    let seed = 725 + ch * 115,
      last = 0
    const data = b.getChannelData(ch)
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const t = i / rate
      last = 0.48 * last + 0.52 * (seed / 2147483648 - 1)
      data[i] =
        Math.exp((-6 * t) / duration) *
        (type === 2
          ? 0.38 * last +
            0.62 * Math.sin(t * 2600 + 50 * Math.sin(t * 32)) * Math.exp(-4 * t)
          : last)
    }
  }
  cache.set(type, b)
  return b
}
type Adjust = (e: Effect) => void
function processor(
  net: Network,
  id: Unit,
  type: number,
  input: GainNode,
  output: GainNode,
): Adjust {
  const c = net.ctx,
    set = (p: AudioParam, v: number) => glide(p, v, c)
  if (id === 'mod1') {
    const osc = net.lfo(type === 5 ? 'sawtooth' : 'sine', 2),
      depth = net.gain()
    osc.connect(depth)
    if (type === 0) {
      const pan = net.keep(c.createStereoPanner())
      input.connect(pan).connect(output)
      depth.connect(pan.pan)
    } else if (type === 3 || type === 4) {
      const filter = net.filter(type === 3 ? 'bandpass' : 'lowpass', 350, 3.4)
      input.connect(filter).connect(output)
      if (type === 3) {
        const rect = net.keep(c.createWaveShaper())
        rect.curve = Float32Array.from({ length: 513 }, (_, i) =>
          Math.abs(i / 256 - 1),
        )
        const follower = net.filter('lowpass', 20)
        osc.disconnect()
        input.connect(rect).connect(follower).connect(depth)
      }
      depth.connect(filter.frequency)
    } else {
      const volume = net.gain(type === 2 ? 0 : 0.55)
      input.connect(volume).connect(output)
      depth.connect(volume.gain)
    }
    return (e) => {
      const r = e.rate / 100
      set(
        osc.frequency,
        type === 2
          ? 24 * 2 ** (5 * r)
          : e.sync
            ? 1 / delayTime(e.rate, true)
            : 0.17 * 2 ** (6 * r),
      )
      set(
        depth.gain,
        type === 3
          ? 1200 + 15000 * r
          : type === 4
            ? 310
            : type === 1 || type === 5
              ? 0.45
              : 1,
      )
    }
  }
  if (id === 'mod2') {
    const count = [2, 1, 4, 3, 3, 1][type]
    const oscillators: OscillatorNode[] = [],
      lines: DelayNode[] = []
    const depths: GainNode[] = []
    let tail: AudioNode = input
    let second: GainNode | undefined, feedback: GainNode | undefined
    const blend = net.gain(type === 2 || type === 3 ? 0.65 : 1 / count)
    blend.connect(output)
    for (let i = 0; i < count; i++) {
      const osc = net.lfo(type === 3 ? 'triangle' : 'sine', 1)
      const depth = net.gain()
      osc.connect(depth)
      oscillators.push(osc)
      depths.push(depth)
      if (type === 2 || type === 3) {
        const f = net.filter('allpass', (type === 2 ? 340 : 190) * 1.85 ** i, 1)
        depth.connect(f.frequency)
        tail.connect(f)
        tail = f
      } else {
        const d = net.keep(c.createDelay(0.1))
        lines.push(d)
        d.delayTime.value = [0.017, 0.003, 0, 0, 0.031, 0.006][type] + 0.002 * i
        depth.connect(d.delayTime)
        const pan = net.keep(c.createStereoPanner())
        if (count > 1) pan.pan.value = (2 * i) / (count - 1) - 1
        if (type === 5) osc.connect(net.gain(0.82)).connect(pan.pan)
        input.connect(d).connect(pan)
        if (type === 0 && i === 1) {
          second = net.gain(0)
          pan.connect(second).connect(blend)
        } else pan.connect(blend)
        if (type === 1) {
          feedback = net.gain()
          d.connect(feedback).connect(d)
        }
      }
    }
    if (type === 2) {
      feedback = net.gain()
      const memory = net.keep(c.createDelay(0.01))
      memory.delayTime.value = 1 / c.sampleRate
      tail.connect(memory).connect(feedback).connect(input)
    }
    if (type === 3) {
      const vibrato = net.keep(c.createDelay(0.02))
      vibrato.delayTime.value = 0.003
      oscillators[0].connect(net.gain(0.0022)).connect(vibrato.delayTime)
      tail.connect(vibrato)
      tail = vibrato
    }
    if (type === 4)
      lines.forEach((line, i) =>
        line.connect(net.gain(0.14)).connect(lines[(i + 1) % 3]),
      )
    if (type === 2 || type === 3) tail.connect(blend)
    if (type !== 5) input.connect(net.gain(0.55)).connect(output)
    return (e) => {
      const amount = e.amount / 100
      if (second) set(second.gain, Math.max(0, 2 * amount - 1))
      if (feedback) set(feedback.gain, (type === 2 ? 0.5 : 0.78) * amount)
      oscillators.forEach((o, i) => {
        glide(
          o.frequency,
          (0.08 + 5 * (e.rate / 100) ** 2) * (1 + 0.17 * i),
          c,
          type === 5 ? 0.22 : 0.015,
        )
        set(
          depths[i].gain,
          [0.004, 0.0028, 310, 165, 0.005, 0.003][type] * amount,
        )
      })
    }
  }
  if (id === 'delay') {
    const delay = net.keep(c.createDelay(2)),
      feedback = net.gain(),
      filters = [
        net.gain(),
        net.filter('lowpass', 1550),
        net.filter('highpass', 670),
        net.filter('bandpass', 1050),
      ]
    input.connect(delay).connect(output)
    const returns = filters.map((filter, i) => {
      const gain = net.gain(i === 0 ? 1 : 0)
      delay.connect(filter).connect(gain).connect(feedback)
      return gain
    })
    feedback.connect(delay)
    return (e) => {
      returns.forEach((gain, i) => set(gain.gain, e.filter === i ? 1 : 0))
      set(delay.delayTime, delayTime(e.rate, e.sync))
      set(feedback.gain, (0.9 * e.feedback) / 100)
    }
  }
  if (id === 'amp') {
    const bass = net.filter('lowshelf', 100),
      mid = net.filter('peaking', 1000, 1),
      treble = net.filter('highshelf', 4000)
    input.connect(bass).connect(mid).connect(treble)
    const drive = net.gain()
    treble.connect(drive)
    const filters: BiquadFilterNode[] = []
    if (type === 4 || type === 5) {
      let previous: AudioNode = drive
      for (let i = 0; i < 2; i++) {
        const f = net.filter(type === 4 ? 'lowpass' : 'highpass', 800)
        previous.connect(f)
        previous = f
        filters.push(f)
      }
      previous.connect(output)
    } else if (type > 0 && type < 4) {
      const cabinet = net.filter('lowpass', [0, 3800, 6500, 1700][type], 0.9)
      drive
        .connect(saturate(net, [1, 2.6, 1.3, 5][type]))
        .connect(cabinet)
        .connect(output)
    } else drive.connect(output)
    return (e) => {
      set(bass.gain, 0.3 * (e.bass - 50))
      set(mid.gain, 0.3 * (e.mid - 50))
      set(treble.gain, 0.3 * (e.treble - 50))
      set(mid.frequency, 200 * 40 ** (e.freq / 100))
      set(drive.gain, 1 + (e.amount / 100) * (type === 0 ? 0.65 : 3))
      for (const f of filters) {
        set(f.frequency, 65 * 160 ** (e.freq / 100))
        set(f.Q, 0.5 + (7 * e.mid) / 100)
      }
    }
  }
  if (id === 'compressor') {
    const n = net.keep(c.createDynamicsCompressor())
    input.connect(n).connect(output)
    return (e) => {
      set(n.threshold, -4 - 0.48 * e.amount)
      set(n.ratio, 1 + 0.16 * e.amount)
      set(n.attack, e.fast ? 0.002 : 0.018)
      set(n.release, e.fast ? 0.055 : 0.36)
    }
  }
  const conv = net.keep(c.createConvolver()),
    color = net.filter('highshelf', 2500)
  conv.buffer = response(c, type)
  input.connect(conv).connect(color).connect(output)
  return (e) => set(color.gain, [0, 7, -10][e.tone])
}

/** Keep the dry rail connected. Swap processor types under a short crossfade. */
class Slot extends Network {
  input = this.gain()
  output = this.gain()
  dry = this.gain()
  branch?: { dispose: () => void; wet: GainNode; adjust: Adjust; type: number }
  last = ''
  retiring = new Map<ConstantSourceNode, () => void>()
  constructor(
    ctx: BaseAudioContext,
    readonly id: Unit,
  ) {
    super(ctx)
    this.input.connect(this.dry).connect(this.output)
  }
  update(e: Effect, enabled: boolean) {
    const key = JSON.stringify([e, enabled])
    if (this.last === key) return
    this.last = key
    const active = e.on && enabled
    const wet = active
      ? (e.mix / 100) * (this.id.startsWith('mod') ? e.amount / 100 : 1)
      : 0
    glide(this.dry.gain, 1 - wet, this.ctx)
    if (this.branch && (!active || this.branch.type !== e.type)) {
      const old = this.branch
      glide(old.wet.gain, 0, this.ctx, 0.003)
      const timer = this.ctx.createConstantSource()
      this.retiring.set(timer, old.dispose)
      timer.onended = () => {
        this.retiring.delete(timer)
        old.dispose()
        timer.disconnect()
      }
      timer.start()
      timer.stop(this.ctx.currentTime + 0.035)
      this.branch = undefined
    }
    if (!active) return
    if (!this.branch) {
      const net = new Network(this.ctx),
        entry = net.gain(),
        wetGain = net.gain(0)
      this.input.connect(entry)
      wetGain.connect(this.output)
      const adjust = processor(net, this.id, e.type, entry, wetGain)
      const dispose = () => {
        this.input.disconnect(entry)
        net.dispose()
      }
      this.branch = { dispose, wet: wetGain, type: e.type, adjust }
    }
    this.branch.adjust(e)
    glide(this.branch.wet.gain, wet, this.ctx)
  }
  dispose() {
    this.branch?.dispose()
    this.branch = undefined
    for (const [t, dispose] of this.retiring) {
      t.onended = null
      t.disconnect()
      dispose()
    }
    this.retiring.clear()
    super.dispose()
  }
}

/** One cabinet processes the two layer sends as discrete channels. Splitting
 * after the rotor preserves independent post-rotary layer levels. */
export class Rack extends Network {
  master = this.gain()
  horn = this.lfo('sine', 0.82)
  drum = this.lfo('sine', 0.67)
  cabinetInput = this.keep(this.ctx.createChannelMerger(2))
  preamp = this.gain()
  lanes = [0, 1].map((i) => {
    const slots = order.map((id) => new Slot(this.ctx, id))
    for (let j = 1; j < slots.length; j++)
      slots[j - 1].output.connect(slots[j].input)
    const end = slots[slots.length - 1].output,
      level = this.gain(),
      direct = this.gain(),
      rotating = this.gain(0)
    end.connect(direct).connect(level)
    end.connect(this.cabinetInput, 0, i)
    rotating.connect(level)
    level.connect(this.master)
    return { input: slots[0].input, slots, level, direct, rotating }
  })
  constructor(c: BaseAudioContext) {
    super(c)
    const drive = saturate(this, 2.1)
    this.cabinetInput.connect(this.preamp).connect(drive)
    for (const [high, osc] of [
      [true, this.horn],
      [false, this.drum],
    ] as const) {
      const band = this.filter(high ? 'highpass' : 'lowpass', 780),
        doppler = this.keep(c.createDelay(0.02))
      const amp = this.gain(0.78),
        channels = this.keep(c.createChannelSplitter(2))
      doppler.delayTime.value = 0.003
      osc.connect(this.gain(high ? 0.0018 : 0.0007)).connect(doppler.delayTime)
      osc.connect(this.gain(high ? 0.22 : 0.14)).connect(amp.gain)
      drive.connect(band).connect(doppler).connect(amp).connect(channels)
      const sweep = this.gain(high ? 0.88 : -0.36)
      osc.connect(sweep)
      this.lanes.forEach((lane, i) => {
        const pan = this.keep(c.createStereoPanner())
        sweep.connect(pan.pan)
        channels.connect(pan, i).connect(lane.rotating)
      })
    }
    const limiter = this.keep(c.createDynamicsCompressor())
    limiter.threshold.value = -4
    limiter.knee.value = 1
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.11
    this.master.connect(limiter).connect(c.destination)
  }
  apply(s: Settings, initial = false) {
    const set = (p: AudioParam, v: number, t = 0.008) =>
      initial ? (p.value = v) : glide(p, v, this.ctx, t)
    set(this.master.gain, (0.5 * s.master) / 100)
    set(this.horn.frequency, s.stopped ? 0 : s.speed ? 6.7 : 0.82, 0.35)
    set(this.drum.frequency, s.stopped ? 0 : s.speed ? 5.4 : 0.67, 0.7)
    set(this.preamp.gain, 0.85 + s.drive * 0.032)
    this.lanes.forEach((l, i) => {
      const layer = s.layers[i],
        amp = layer.fx.amp
      const route = s.effects && amp.on && amp.type === 6 && s.rotary
      set(l.level.gain, layer.enabled && s.section ? layer.level / 100 : 0)
      set(l.direct.gain, route ? 1 - amp.mix / 100 : 1)
      set(l.rotating.gain, route ? amp.mix / 100 : 0)
      l.slots.forEach((slot) => slot.update(layer.fx[slot.id], s.effects))
    })
  }
  flush(s: Settings) {
    for (const [i, lane] of this.lanes.entries()) {
      for (const slot of lane.slots) {
        const effect = s.layers[i].fx[slot.id]
        if (effect.on && s.effects) {
          slot.update(effect, false)
          slot.update(effect, true)
        }
      }
    }
  }
  dispose() {
    responses.delete(this.ctx)
    for (const l of this.lanes) for (const slot of l.slots) slot.dispose()
    super.dispose()
  }
}
