import { delayDivisions, delayFilters, effectiveUnit, layers } from '../piano/settings'
import type { Chain, Layer, Settings } from '../piano/settings'
import { connect, curve, Graph, Insert } from './graph'
import { mod1, mod2 } from './modulation'

export function delayEffect(graph: Graph) {
  const insert = new Insert(graph)
  const echo = graph.delay(6.2, 0.5)
  const feedback = graph.gain(0)
  const filters = [
    undefined, graph.filter('lowpass', 2150), graph.filter('highpass', 630), graph.filter('bandpass', 1180, 0.9),
  ]
  const paths = filters.map((filter) => {
    const path = graph.gain(0)
    if (filter) connect(echo, filter, path, feedback)
    else connect(echo, path, feedback)
    return path
  })
  connect(insert.send, echo, insert.wet)
  feedback.connect(echo)
  return {
    input: insert.input,
    output: insert.output,
    update(s: Chain['delay'], on: boolean, clockBpm: number) {
      const active = on && s.on
      insert.mix(active, s.mix / 10)
      graph.set(echo.delayTime, s.sync ? 60 / clockBpm * delayDivisions[s.division][0] : 60 / s.bpm, 0.05)
      graph.set(feedback.gain, active && s.mix > 0 ? 0.86 * s.feedback / 10 : 0)
      for (const [index, path] of paths.entries()) graph.set(path.gain, Number(delayFilters[index] === s.filter))
    },
  }
}

const ampProfiles = {
  Twin: { highpass: 74, lowpass: 4800, peak: 1130, color: -2.5, saturation: 1.3 },
  JC: { highpass: 94, lowpass: 6800, peak: 1910, color: 2.8, saturation: 0.65 },
  Small: { highpass: 245, lowpass: 3100, peak: 860, color: 4.5, saturation: 2.6 },
} as const

function shaper(graph: Graph, factor: number) {
  return graph.shape(curve((x) => Math.tanh(x * factor) / factor), '2x')
}

export const midFrequency = (position: number) => 200 * 40 ** (position / 10)

function amplifier(graph: Graph) {
  const insert = new Insert(graph)
  const bass = graph.filter('lowshelf', 100)
  const mid = graph.filter('peaking', 1200, 0.95)
  const treble = graph.filter('highshelf', 4000)
  connect(insert.send, bass, mid, treble)
  const direct = graph.gain(0)
  connect(treble, direct, insert.wet)
  const amps = Object.entries(ampProfiles).map(([type, spec]) => {
    const preamp = graph.gain(0)
    const color = graph.filter('peaking', spec.peak, 0.9)
    color.gain.value = spec.color
    const loudness = graph.gain(0)
    connect(treble, preamp, shaper(graph, spec.saturation), graph.filter('highpass', spec.highpass),
      color, graph.filter('lowpass', spec.lowpass), loudness, insert.wet)
    return { type, preamp, loudness }
  })
  const filters = (['LP24 Filter', 'HP24 Filter'] as const).map((type) => {
    const mode = type === 'LP24 Filter' ? 'lowpass' : 'highpass'
    const send = graph.gain(0)
    const first = graph.filter(mode, 1000, -5.33)
    const second = graph.filter(mode, 1000, 2.32)
    const level = graph.gain(0)
    connect(insert.send, send, first, second, level, insert.wet)
    return { type, send, first, second, level }
  })
  return {
    input: insert.input,
    output: insert.output,
    update(s: Chain['amp'], on: boolean) {
      insert.mix(on && s.on && s.type !== 'To Rotary')
      graph.set(bass.gain, (s.bass - 5) * 3)
      graph.set(mid.gain, (s.mid - 5) * 3)
      graph.set(mid.frequency, midFrequency(s.frequency))
      graph.set(treble.gain, (s.treble - 5) * 3)
      graph.set(direct.gain, Number(s.type === 'EQ only'))
      for (const { type, preamp, loudness } of amps) {
        const gain = 1 + 4 * (s.drive / 10) ** 1.4
        graph.set(preamp.gain, s.type === type ? gain : 0)
        graph.set(loudness.gain, s.type === type ? gain ** -0.62 : 0)
      }
      for (const { type, send, first, second, level } of filters) {
        const active = s.type === type
        graph.set(send.gain, Number(active))
        graph.set(level.gain, Number(active))
        graph.set(first.frequency, midFrequency(s.frequency))
        graph.set(second.frequency, midFrequency(s.frequency))
        // Biquad low-pass and high-pass Q is expressed in dB in Web Audio.
        graph.set(second.Q, 2.32 + (s.mid - 5) * 1.35)
      }
    },
  }
}

function compressor(graph: Graph) {
  const insert = new Insert(graph)
  const node = graph.own(graph.context.createDynamicsCompressor())
  const makeup = graph.gain()
  connect(insert.send, node, makeup, insert.wet)
  return {
    input: insert.input,
    output: insert.output,
    update(s: Chain['compressor'], on: boolean) {
      const amount = s.amount / 10
      insert.mix(on && s.on && amount > 0)
      graph.set(node.threshold, -9 - 27 * amount)
      graph.set(node.ratio, 1 + 11 * amount)
      graph.set(node.knee, 12)
      graph.set(node.attack, s.fast ? 0.003 : 0.022)
      graph.set(node.release, s.fast ? 0.055 : 0.32)
      graph.set(makeup.gain, 1 + 0.6 * amount)
    },
  }
}

const rooms = {
  Booth: { duration: 0.26, early: 0.007, damping: 4.9 },
  Room: { duration: 0.63, early: 0.012, damping: 3.7 },
  Spring: { duration: 1.42, early: 0.021, damping: 4.5 },
  Stage: { duration: 1.32, early: 0.025, damping: 3.4 },
  Hall: { duration: 2.45, early: 0.038, damping: 3.1 },
  Cathedral: { duration: 4.2, early: 0.067, damping: 2.8 },
} as const

type Room = keyof typeof rooms

function impulse(context: BaseAudioContext, name: Room) {
  const { duration, early, damping } = rooms[name]
  const rate = context.sampleRate
  const buffer = context.createBuffer(2, Math.ceil(duration * rate), rate)
  for (let side = 0; side < 2; side++) {
    const channel = buffer.getChannelData(side)
    let seed = 192781 + side * 3197
    let smooth = 0
    for (let i = Math.round(early * rate); i < channel.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const noise = seed / 2147483648 - 1
      const t = i / rate - early
      smooth += (noise - smooth) * (name === 'Cathedral' ? 0.22 : 0.45)
      const envelope = Math.exp(-damping * t / (duration * 0.45)) * Math.min(1, t / 0.024)
      const spring = Math.sin(2 * Math.PI * (1200 * Math.log1p(t * 1.5) + 100 * t))
        * (0.55 + 0.45 * Math.cos(2 * Math.PI * t * 19))
      channel[i] = (name === 'Spring' ? 0.49 * spring + 0.28 * smooth : smooth) * envelope
    }
    for (let n = 0; n < 6; n++) {
      const index = Math.round((early + 0.0025 * side + n * early * 0.73) * rate)
      channel[index] += (n % 2 ? -1 : 1) * 0.69 ** n
    }
  }
  return buffer
}

function reverb(graph: Graph, impulses: Map<Room, AudioBuffer>) {
  const insert = new Insert(graph)
  const tone = graph.filter('highshelf', 3100)
  tone.connect(insert.wet)
  const paths = new Map<Room, { send: GainNode; level: GainNode }>()
  return {
    input: insert.input,
    output: insert.output,
    update(s: Chain['reverb'], on: boolean) {
      const active = on && s.on && s.mix > 0
      insert.mix(active, s.mix / 10)
      graph.set(tone.gain, s.tone === 'Bright' ? 8 : s.tone === 'Dark' ? -14 : 0)
      if (active && !paths.has(s.type)) {
        const convolver = graph.own(graph.context.createConvolver())
        let buffer = impulses.get(s.type)
        if (!buffer) {
          buffer = impulse(graph.context, s.type)
          impulses.set(s.type, buffer)
        }
        convolver.buffer = buffer
        const send = graph.gain(0)
        const level = graph.gain(0)
        // Prime the ramp targets so selecting a new IR while playing fades it in.
        graph.set(send.gain, 0)
        graph.set(level.gain, 0)
        connect(insert.send, send, convolver, level, tone)
        paths.set(s.type, { send, level })
      }
      for (const [type, lane] of paths) {
        const selected = Number(active && s.type === type)
        graph.set(lane.send.gain, selected)
        graph.set(lane.level.gain, selected)
      }
    },
  }
}

class Rotary {
  private readonly horn: OscillatorNode
  private readonly drum: OscillatorNode
  private readonly lanes: Record<Layer, ReturnType<Rotary['lane']>>

  constructor(private readonly graph: Graph) {
    this.horn = graph.oscillator('sine', 0.82)
    this.drum = graph.oscillator('triangle', 0.63)
    this.lanes = { A: this.lane(), B: this.lane() }
  }

  private lane() {
    const g = this.graph
    const insert = new Insert(g)
    const preamp = g.gain()
    const cabinet = shaper(g, 1.7)
    connect(insert.send, preamp, cabinet)
    const bringAround = (high: boolean, lfo: OscillatorNode) => {
      const crossover = g.filter(high ? 'highpass' : 'lowpass', 800)
      const doppler = g.delay(0.02, high ? 0.0032 : 0.0022)
      const spin = g.pan()
      const beam = g.gain(high ? 0.67 : 0.63)
      g.depth(lfo, doppler.delayTime, high ? 0.0017 : -0.00085)
      g.depth(lfo, spin.pan, high ? 0.74 : -0.43)
      g.depth(lfo, beam.gain, high ? 0.27 : -0.15)
      connect(cabinet, crossover, doppler, spin, beam, insert.wet)
    }
    bringAround(true, this.horn)
    bringAround(false, this.drum)
    return { insert, preamp }
  }

  getLane(layer: Layer) {
    return this.lanes[layer].insert
  }

  update(settings: Settings) {
    const { on, fast, drive } = settings.effects.rotary
    this.graph.set(this.horn.frequency, fast ? 6.65 : 0.82, 0.23)
    this.graph.set(this.drum.frequency, fast ? 5.5 : 0.63, 0.62)
    for (const layer of layers) {
      const amp = effectiveUnit(settings, layer, 'amp')
      const { insert, preamp } = this.lanes[layer]
      insert.mix(settings.effects.on && on && amp.on && amp.type === 'To Rotary')
      this.graph.set(preamp.gain, 1 + 2.9 * drive / 10)
    }
  }
}

function layerEffects(graph: Graph, rotary: Insert, master: GainNode, impulses: Map<Room, AudioBuffer>) {
  const modOne = mod1(graph)
  const modTwo = mod2(graph)
  const delay = delayEffect(graph)
  const amp = amplifier(graph)
  const comp = compressor(graph)
  const verb = reverb(graph, impulses)
  const level = graph.gain()
  const ordered = [modOne, modTwo, delay, amp, comp, verb, rotary]
  for (let i = 1; i < ordered.length; i++) ordered[i - 1].output.connect(ordered[i].input)
  connect(rotary.output, level, master)

  return {
    input: modOne.input,
    update(settings: Settings, layer: Layer) {
      const { on, clockBpm } = settings.effects
      modOne.update(effectiveUnit(settings, layer, 'mod1'), on, clockBpm)
      modTwo.update(effectiveUnit(settings, layer, 'mod2'), on)
      delay.update(effectiveUnit(settings, layer, 'delay'), on, clockBpm)
      amp.update(effectiveUnit(settings, layer, 'amp'), on)
      comp.update(effectiveUnit(settings, layer, 'compressor'), on)
      verb.update(effectiveUnit(settings, layer, 'reverb'), on)
      const piano = settings.layers[layer]
      graph.set(level.gain, settings.on && piano.on ? (piano.level / 12) ** 1.45 : 0)
    },
  }
}

export class EffectsRack {
  private readonly graph: Graph
  private readonly rotary: Rotary
  private readonly layers: Record<Layer, ReturnType<typeof layerEffects>>

  constructor(master: GainNode, context: BaseAudioContext, clock: () => number, impulses = new Map<Room, AudioBuffer>()) {
    this.graph = new Graph(context, clock)
    this.rotary = new Rotary(this.graph)
    this.layers = {
      A: layerEffects(this.graph, this.rotary.getLane('A'), master, impulses),
      B: layerEffects(this.graph, this.rotary.getLane('B'), master, impulses),
    }
  }

  input(layer: Layer) {
    return this.layers[layer].input
  }

  update(settings: Settings) {
    for (const layer of layers) this.layers[layer].update(settings, layer)
    this.rotary.update(settings)
  }

  dispose() {
    this.graph.dispose()
  }
}
