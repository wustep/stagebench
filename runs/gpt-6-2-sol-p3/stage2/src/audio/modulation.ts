import type { Chain } from '../piano/settings'
import { branch, connect, curve, Insert, selectBranch } from './graph'
import type { Branch, Graph } from './graph'

function lfoPan(graph: Graph, stereo = false) {
  const pan = graph.pan()
  const lfo = graph.oscillator('sine')
  const depth = graph.depth(lfo, pan.pan)
  if (!stereo) {
    // A-Pan should move the stereo piano's whole image, including its direct signal.
    const mono = graph.gain()
    mono.channelCount = 1
    mono.channelCountMode = 'explicit'
    mono.connect(pan)
    return branch(graph, mono, pan, (rate, amount) => {
      graph.set(lfo.frequency, rate)
      graph.set(depth, 0.95 * amount)
    })
  }
  return branch(graph, pan, pan, (rate, amount) => {
    graph.set(lfo.frequency, rate, 0.17)
    graph.set(depth, amount * 0.8)
  })
}

function amplitudeMod(graph: Graph, type: 'Tremolo' | 'Ring Mod' | 'Pump') {
  const gain = graph.gain()
  const lfo = graph.oscillator(type === 'Pump' ? 'triangle' : 'sine')
  const modulation = type === 'Pump'
    ? graph.shape(curve((x) => 2 * ((x + 1) * 0.5) ** 3 - 1))
    : lfo
  if (modulation !== lfo) lfo.connect(modulation)
  const depth = graph.depth(modulation, gain.gain)
  return branch(graph, gain, gain, (rate, amount) => {
    graph.set(lfo.frequency, rate)
    graph.set(gain.gain, 1 - amount * (type === 'Ring Mod' ? 1 : 0.48))
    graph.set(depth, amount * (type === 'Ring Mod' ? 1 : 0.48))
  })
}

function wah(graph: Graph, automatic: boolean) {
  const input = graph.gain()
  const filter = graph.filter(automatic ? 'bandpass' : 'lowpass', automatic ? 430 : 1300, automatic ? 1.5 : 4.4)
  input.connect(filter)
  if (automatic) {
    const rectify = graph.shape(curve(Math.abs))
    const smooth = graph.filter('lowpass', 19, 0.55)
    connect(input, rectify, smooth)
    const depth = graph.depth(smooth, filter.frequency)
    return branch(graph, input, filter, (rate, amount) => {
      graph.set(depth, (3600 + rate * 5600) * (0.4 + amount * 0.6))
    })
  }
  const lfo = graph.oscillator('sine')
  const depth = graph.depth(lfo, filter.frequency)
  return branch(graph, input, filter, (rate, amount) => {
    graph.set(lfo.frequency, rate)
    graph.set(depth, 1120 * (0.35 + amount * 0.65))
  })
}

export function mod1(graph: Graph) {
  const insert = new Insert(graph)
  const branches = {
    'A-Pan': lfoPan(graph),
    Tremolo: amplitudeMod(graph, 'Tremolo'),
    'Ring Mod': amplitudeMod(graph, 'Ring Mod'),
    'A-Wah': wah(graph, true),
    Wah: wah(graph, false),
    Pump: amplitudeMod(graph, 'Pump'),
  }
  wireBranches(insert, branches)
  return {
    ...insert,
    update(s: Chain['mod1'], on: boolean, clockBpm: number) {
      const division = [0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8][s.rate] ?? 1
      const rate = s.type === 'Ring Mod' ? 24 * 2 ** (s.rate / 2.1)
        : s.type === 'A-Wah' ? s.rate / 10
          : s.sync ? clockBpm / 60 * division : 0.18 * 2 ** (s.rate / 1.85)
      const wet = s.type === 'A-Wah' || s.type === 'Wah' || s.type === 'A-Pan' ? s.amount / 10 : 1
      selectBranch(graph, insert, branches, s.type, on && s.on, rate, s.amount / 10, wet)
    },
  }
}

function wireBranches(insert: Insert, branches: Record<string, Branch>) {
  for (const unit of Object.values(branches)) {
    insert.send.connect(unit.input)
    unit.output.connect(insert.wet)
  }
}

function modulatedDelay(graph: Graph, type: 'Chorus' | 'Flanger' | 'Ensemble') {
  const input = graph.gain()
  const output = graph.gain()
  const lfo = graph.oscillator('sine')
  const timings = type === 'Flanger' ? [0.003] : type === 'Chorus' ? [0.017, 0.024] : [0.009, 0.019, 0.031]
  const lines = timings.map((time, index) => {
    const delay = graph.delay(0.09, time)
    const otherLfo = index === 2 ? graph.oscillator('triangle') : lfo
    const depth = graph.depth(otherLfo, delay.delayTime)
    const feedback = graph.gain(0)
    connect(delay, feedback, delay)
    const level = graph.gain(index === 0 && timings.length === 1 ? 1 : 0.55)
    const pan = graph.pan(timings.length === 1 ? 0 : [-0.76, 0.76, 0][index])
    connect(input, delay, level, pan, output)
    return { delay, feedback, level, time, depth, otherLfo }
  })
  if (type === 'Ensemble') {
    lines.forEach(({ delay }, index) => connect(delay, graph.gain(0.12), lines[(index + 1) % lines.length].delay))
  }
  return branch(graph, input, output, (rate, amount) => {
    graph.set(lfo.frequency, rate * (type === 'Flanger' ? 0.72 : 1))
    lines.forEach(({ time, depth, feedback, level, otherLfo }, index) => {
      graph.set(depth, time * (index === 1 ? -1 : 1) * (0.07 + amount * 0.38))
      graph.set(feedback.gain, type === 'Flanger' ? -0.69 * amount : 0)
      if (type === 'Chorus' && index === 1) graph.set(level.gain, 0.55 * Math.min(1, amount * 2))
      if (index === 2) graph.set(otherLfo.frequency, rate * 1.63)
    })
  })
}

function phasing(graph: Graph, vibe: boolean) {
  const input = graph.gain()
  const stages = (vibe ? [190, 450, 1240, 2700] : [440, 650, 870, 1200, 1500, 1800])
    .map((hz) => graph.filter('allpass', hz, vibe ? 0.7 : 1.2))
  const output = stages[stages.length - 1]
  const lfo = graph.oscillator(vibe ? 'triangle' : 'sine')
  const depths = stages.map((node, i) => ({
    frequency: node.frequency.value,
    depth: graph.depth(lfo, node.frequency),
    direction: vibe && i % 2 ? -1 : 1,
  }))
  const feedback = graph.gain(0)
  const feedbackDelay = graph.delay(0.02, 0.006)
  connect(input, ...stages)
  connect(output, feedback, feedbackDelay, input)
  if (!vibe) {
    return branch(graph, input, output, (rate, amount) => {
      graph.set(lfo.frequency, rate)
      for (const { frequency, depth } of depths) graph.set(depth, frequency * (0.18 + amount * 0.65))
      graph.set(feedback.gain, 0.54 * amount)
    })
  }
  const pitch = graph.delay(0.03, 0.009)
  const wobble = graph.depth(lfo, pitch.delayTime)
  output.connect(pitch)
  return branch(graph, input, pitch, (rate, amount) => {
    graph.set(lfo.frequency, rate * 1.45)
    for (const { frequency, depth, direction } of depths) graph.set(depth, direction * frequency * (0.35 + amount * 0.5))
    graph.set(wobble, 0.0025 * amount)
  })
}

export function mod2(graph: Graph) {
  const insert = new Insert(graph)
  const branches = {
    Chorus: modulatedDelay(graph, 'Chorus'),
    Flanger: modulatedDelay(graph, 'Flanger'),
    Phaser: phasing(graph, false),
    Vibe: phasing(graph, true),
    Ensemble: modulatedDelay(graph, 'Ensemble'),
    Spin: lfoPan(graph, true),
  }
  wireBranches(insert, branches)
  return {
    ...insert,
    update(s: Chain['mod2'], on: boolean) {
      selectBranch(graph, insert, branches, s.type, on && s.on, 0.12 * 2 ** (s.rate / 1.8), s.amount / 10,
        s.amount / 10 * (s.type === 'Spin' ? 1 : 0.66))
    },
  }
}
