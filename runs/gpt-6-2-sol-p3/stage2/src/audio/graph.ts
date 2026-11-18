export class Graph {
  private readonly nodes: AudioNode[] = []
  private readonly oscillators: OscillatorNode[] = []
  private readonly targets = new WeakMap<AudioParam, number>()

  constructor(readonly context: BaseAudioContext, private readonly clock = () => context.currentTime) {}

  own<T extends AudioNode>(node: T) {
    this.nodes.push(node)
    return node
  }

  gain(value = 1) {
    const node = this.own(this.context.createGain())
    node.gain.value = value
    return node
  }

  filter(type: BiquadFilterType, hz: number, q = 0.707) {
    const node = this.own(this.context.createBiquadFilter())
    node.type = type
    node.frequency.value = hz
    node.Q.value = q
    return node
  }

  delay(max: number, seconds: number) {
    const node = this.own(this.context.createDelay(max))
    node.delayTime.value = seconds
    return node
  }

  pan(value = 0) {
    const node = this.own(this.context.createStereoPanner())
    node.pan.value = value
    return node
  }

  oscillator(type: OscillatorType, hz = 1) {
    const node = this.own(this.context.createOscillator())
    node.type = type
    node.frequency.value = hz
    node.start()
    this.oscillators.push(node)
    return node
  }

  set(param: AudioParam, value: number, tau = 0.008) {
    if (this.targets.get(param) === value) return
    if (!this.targets.has(param)) {
      param.value = value
    } else {
      const time = this.clock()
      param.cancelScheduledValues(time)
      param.setTargetAtTime(value, time, tau)
    }
    this.targets.set(param, value)
  }

  /** Wire a modulator into a parameter without mixing it into the audible path. */
  depth(lfo: AudioNode, param: AudioParam, value = 0) {
    const node = this.gain(value)
    lfo.connect(node)
    node.connect(param)
    return node.gain
  }

  shape(curve: Float32Array<ArrayBuffer>, oversample: OverSampleType = 'none') {
    const node = this.own(this.context.createWaveShaper())
    node.curve = curve
    node.oversample = oversample
    return node
  }

  dispose() {
    for (const node of this.oscillators) node.stop()
    for (const node of this.nodes) node.disconnect()
    this.nodes.length = 0
    this.oscillators.length = 0
  }
}

export function connect(...nodes: AudioNode[]) {
  for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i])
}

export function curve(transform: (x: number) => number) {
  return Float32Array.from({ length: 2049 }, (_, index) => transform(index / 1024 - 1))
}

/** A parallel insert with a unity bypass and independent input and output gates. */
export class Insert {
  readonly input: GainNode
  readonly output: GainNode
  readonly send: GainNode
  readonly wet: GainNode
  private readonly dry: GainNode

  constructor(private readonly graph: Graph) {
    this.input = graph.gain()
    this.output = graph.gain()
    this.send = graph.gain(0)
    this.wet = graph.gain(0)
    this.dry = graph.gain(1)
    connect(this.input, this.dry, this.output)
    this.input.connect(this.send)
    this.wet.connect(this.output)
  }

  mix(on: boolean, wet = 1) {
    this.graph.set(this.send.gain, on && wet > 0 ? 1 : 0)
    this.graph.set(this.wet.gain, on ? wet : 0)
    this.graph.set(this.dry.gain, on ? 1 - wet : 1)
  }
}

export interface Branch {
  input: GainNode
  output: GainNode
  update(rate: number, amount: number): void
}

export function branch(graph: Graph, input: AudioNode, output: AudioNode, update: Branch['update']): Branch {
  const entry = graph.gain(0)
  const exit = graph.gain(0)
  entry.connect(input)
  output.connect(exit)
  return { input: entry, output: exit, update }
}

export function selectBranch<T extends string>(
  graph: Graph, insert: Insert, branches: Record<T, Branch>, type: T, on: boolean, rate: number, amount: number,
  wet = 1,
) {
  insert.mix(on, wet)
  for (const [name, unit] of Object.entries<Branch>(branches)) {
    const active = name === type
    graph.set(unit.input.gain, Number(active))
    graph.set(unit.output.gain, Number(active))
    if (active) unit.update(rate, amount)
  }
}
