/** Runs in Chromium via Vite; uses the production graph with offline time. */
import { Grand } from '../src/piano'
import { Rack } from '../src/effects'
import {
  defaults,
  editEffect,
  order,
  types,
  type Settings,
  type Layer,
  type Unit,
  type Effect,
} from '../src/settings'

const rate = 24000
const energy = (x: Float32Array) =>
  Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length))
const distance = (a: Float32Array, b: Float32Array) =>
  energy(a.map((v, i) => v - b[i]))
const stereo = (buffer: AudioBuffer) =>
  new Float32Array([...buffer.getChannelData(0), ...buffer.getChannelData(1)])

type Configure = (s: Settings) => void
async function signal(configure: Configure, lane: 0 | 1 = 0) {
  const c = new OfflineAudioContext(2, rate * 1.25, rate)
  const rack = new Rack(c),
    s = defaults()
  s.layers[1].enabled = true
  s.layers[1].level = s.layers[0].level
  configure(s)
  rack.apply(s, true)
  const data = c.createBuffer(1, rate * 0.6, rate)
  for (let i = 0; i < data.length; i++) {
    const t = i / rate
    data.getChannelData(0)[i] =
      Math.sin(2 * Math.PI * 223 * t) * 0.34 * (0.6 + 0.38 * Math.sin(t * 16)) +
      0.13 * Math.sin(2540 * t) +
      0.08 * Math.sin(17000 * t)
  }
  const src = c.createBufferSource()
  src.buffer = data
  src.connect(rack.lanes[lane].input)
  src.start(0.09)
  const result = await c.startRendering()
  rack.dispose()
  src.disconnect()
  return stereo(result)
}
const configure =
  (unit: Unit, patch: Partial<Effect> = {}): Configure =>
  (s) =>
    editEffect(s, unit, { on: true, ...patch })
export async function processors() {
  const dry = await signal(() => {})
  const scores: Record<string, number> = {}
  for (const id of order) {
    const previous = [dry]
    for (let i = 0; i < types[id].length; i++) {
      const rendered = await signal(configure(id, { type: i }))
      scores[id + ' ' + types[id][i]] = Math.min(
        ...previous.map((w) => distance(w, rendered)),
      )
      previous.push(rendered)
    }
    const zero = await signal(configure(id, { mix: 0 })),
      bypass = await signal(configure(id, { on: false }))
    scores[id + ' dry error'] = distance(dry, zero)
    scores[id + ' bypass error'] = distance(dry, bypass)
  }
  return scores
}
export async function parameters() {
  const pairs: [Unit, Partial<Effect>, Partial<Effect>][] = [
    ['mod1', {}, { rate: 98 }],
    ['mod1', {}, { amount: 5 }],
    ['mod2', {}, { rate: 99 }],
    ['mod2', {}, { amount: 98 }],
    ['delay', {}, { rate: 80 }],
    ['delay', { rate: 78 }, { rate: 78, feedback: 90 }],
    ['delay', { rate: 60 }, { rate: 60, sync: true }],
    ['amp', { type: 3 }, { type: 3, amount: 0 }],
    ['amp', {}, { bass: 5 }],
    ['amp', {}, { mid: 95 }],
    ['amp', { type: 4 }, { type: 4, freq: 95 }],
    ['amp', {}, { treble: 99 }],
    ['compressor', {}, { amount: 95 }],
    ['compressor', { amount: 80 }, { amount: 80, fast: true }],
    ['reverb', {}, { tone: 2 }],
  ]
  const scores = []
  for (const [u, a, b] of pairs)
    scores.push(
      distance(await signal(configure(u, a)), await signal(configure(u, b))),
    )
  return scores
}
export async function routing() {
  const dry = await signal(() => {}),
    routed: Configure = (s) => editEffect(s, 'amp', { on: true, type: 6 })
  const a = await signal(routed),
    b = await signal(routed, 1)
  const linked: Configure = (s) => {
    s.group = true
    routed(s)
  }
  const global: Configure = (s) => {
    s.globals = ['reverb']
    editEffect(s, 'reverb', { on: true })
  }
  return {
    laneA: distance(a, dry),
    laneB: distance(b, dry),
    group: distance(dry, await signal(linked, 1)),
    global: distance(dry, await signal(global, 1)),
    allBypass: distance(
      dry,
      await signal((s) => {
        linked(s)
        global(s)
        s.effects = false
      }),
    ),
    speed: distance(
      a,
      await signal((s) => {
        routed(s)
        s.speed = true
      }),
    ),
    drive: distance(
      a,
      await signal((s) => {
        routed(s)
        s.drive = 95
      }),
    ),
    master: energy(
      await signal((s) => {
        global(s)
        linked(s)
        s.master = 0
      }),
    ),
    fader: energy(
      await signal((s) => {
        linked(s)
        s.layers[1].level = 0
      }, 1),
    ),
  }
}
export async function echoes() {
  async function impulse(filter: number) {
    const c = new OfflineAudioContext(1, rate, rate),
      rack = new Rack(c),
      s = defaults()
    editEffect(s, 'delay', {
      on: true,
      mix: 100,
      rate: 83,
      sync: true,
      feedback: 85,
      filter,
    })
    rack.apply(s, true)
    const b = c.createBuffer(1, 32, rate)
    for (let i = 0; i < 32; i++)
      b.getChannelData(0)[i] = 0.5 * Math.sin((i * Math.PI) / 2)
    const source = c.createBufferSource()
    source.buffer = b
    source.connect(rack.lanes[0].input)
    source.start(0.15)
    const data = (await c.startRendering()).getChannelData(0)
    rack.dispose()
    return [0.275, 0.4, 0.525].map((t) =>
      energy(data.subarray((t - 0.009) * rate, (t + 0.025) * rate)),
    )
  }
  const off = await impulse(0),
    lp = await impulse(1)
  return { off, ratios: lp.map((x, i) => x / off[i]) }
}

const cache = new Map<string, Promise<ArrayBuffer>>()
async function instrument(
  layer: Partial<Layer>,
  opts: {
    master?: number
    chord?: boolean
    pedal?: boolean
    velocity?: number
    dual?: boolean
    muteA?: boolean
    stick?: number
    fail?: boolean
  } = {},
) {
  const c = new OfflineAudioContext(2, rate * 0.85, rate)
  let contexts = 0
  const states: string[] = []
  const g = new Grand((s) => states.push(s), {
    context: () => {
      contexts++
      return c as unknown as AudioContext
    },
    load: async (path) => {
      if (opts.fail) throw Error('missing')
      if (!cache.has(path))
        cache.set(
          path,
          fetch(path).then((r) => r.arrayBuffer()),
        )
      return (await cache.get(path)!).slice(0)
    },
  })
  const s = defaults()
  Object.assign(s.layers[0], layer)
  s.master = opts.master ?? 81
  s.bend = opts.stick ?? 50
  if (opts.dual) {
    Object.assign(s.layers[1], {
      ...s.layers[0],
      enabled: true,
      pedal: false,
      octave: 1,
    })
  }
  g.settings = s
  await g.load()
  if (opts.chord) g.on('other', 64, 58)
  g.on('a', 60, opts.velocity ?? 65)
  g.pedal('global', !!opts.pedal)
  const stop = c.suspend(0.23),
    lift = c.suspend(0.62)
  const rendering = c.startRendering()
  await stop
  if (opts.muteA) {
    const next = structuredClone(s)
    next.layers[0].enabled = false
    g.apply(next)
  }
  g.off('a')
  g.off('other')
  void c.resume()
  await lift
  g.pedal('global', false)
  void c.resume()
  const result = await rendering
  await new Promise((resolve) => setTimeout(resolve, 0))
  const count = g.count
  g.dispose()
  return { data: stereo(result), count, contexts, states }
}
export async function instruments() {
  const waves = [],
    scores = []
  for (let type = 0; type < 6; type++) {
    const r = await instrument({ type })
    scores.push(
      Math.min(energy(r.data), ...waves.map((w) => distance(w, r.data))),
    )
    waves.push(r.data)
  }
  const base = waves[0],
    render = async (
      layer: Partial<Layer>,
      opts: Parameters<typeof instrument>[1] = {},
    ) => (await instrument(layer, opts)).data
  const changes = []
  for (const patch of [
    { touch: 0 },
    { touch: 2 },
    { dyn: 3 },
    { timbre: 1 },
    { timbre: 2 },
    { timbre: 3 },
    { unison: 3 },
    { octave: 1 },
    { soft: true },
  ]) {
    changes.push(distance(base, await render(patch)))
  }
  const held = await render({}, { pedal: true }),
    pedalOff = await render({ pedal: false }, { pedal: true })
  const tail = (data: Float32Array) =>
    energy(data.subarray(0.47 * rate, 0.58 * rate))
  const fallback = await instrument({ type: 1 }, { fail: true })
  return {
    scores,
    changes,
    resonance: distance(
      await render({ res: true }, { chord: true }),
      await render({}, { chord: true }),
    ),
    dual: distance(base, await render({}, { dual: true })),
    pedal: tail(held),
    noPedal: tail(pedalOff),
    muteA: tail(await render({}, { dual: true, pedal: true, muteA: true })),
    master: energy(await render({}, { master: 0 })),
    fader: energy(await render({ level: 0 })),
    louder: energy(await render({ dyn: 3 })) / energy(base),
    stick: distance(base, await render({}, { stick: 100 })),
    stickOff: distance(base, await render({ stick: false }, { stick: 100 })),
    fallback: energy(fallback.data),
    states: fallback.states,
    count: fallback.count,
    contexts: fallback.contexts,
  }
}

/** Trace actual Web Audio connections while changing topology during playback. */
export async function topology() {
  const edges = new Map<AudioNode, Set<AudioNode | AudioParam>>()
  const originalConnect = AudioNode.prototype.connect,
    originalDisconnect = AudioNode.prototype.disconnect
  AudioNode.prototype.connect = new Proxy(originalConnect, {
    apply(fn, node, args) {
      const result = Reflect.apply(fn, node, args)
      const outputs = edges.get(node) ?? new Set()
      outputs.add(args[0])
      edges.set(node, outputs)
      return result
    },
  })
  AudioNode.prototype.disconnect = new Proxy(originalDisconnect, {
    apply(fn, node, args) {
      const result = Reflect.apply(fn, node, args)
      if (args.length) edges.get(node)?.delete(args[0])
      else edges.delete(node)
      return result
    },
  })
  function reaches(
    from: AudioNode,
    to: AudioNode,
    seen = new Set<AudioNode>(),
  ): boolean {
    if (from === to) return true
    if (seen.has(from)) return false
    seen.add(from)
    return [...(edges.get(from) ?? [])].some(
      (next) => next instanceof AudioNode && reaches(next, to, seen),
    )
  }
  try {
    const c = new OfflineAudioContext(2, rate * 0.9, rate)
    const rack = new Rack(c),
      s = defaults()
    for (const u of order) editEffect(s, u, { on: true })
    editEffect(s, 'amp', { type: 6 })
    rack.apply(s, true)
    const names = ['mod1', 'mod2', 'delay', 'amp', 'compressor', 'reverb']
    const serial = rack.lanes.every((lane) =>
      lane.slots.every(
        (slot, i) =>
          slot.id === names[i] &&
          (i === 0 || edges.get(lane.slots[i - 1].output)?.has(slot.input)),
      ),
    )
    const postReverb = rack.lanes.every(
      (lane) =>
        edges.get(lane.slots[5].output)?.has(rack.cabinetInput) &&
        reaches(rack.cabinetInput, lane.rotating) &&
        edges.get(lane.rotating)?.has(lane.level) &&
        edges.get(lane.level)?.has(rack.master),
    )
    const sinks = [...edges]
      .filter(([, out]) => out.has(c.destination))
      .map(([node]) => node)
    const limited =
      sinks.length === 1 &&
      sinks[0] instanceof DynamicsCompressorNode &&
      edges.get(rack.master)?.has(sinks[0])
    const source = c.createOscillator()
    source.frequency.value = 277
    source.connect(rack.lanes[0].input)
    source.start()
    source.stop(0.55)
    const first = c.suspend(0.2),
      second = c.suspend(0.4),
      rendering = c.startRendering()
    await first
    editEffect(s, 'mod1', { type: 4 })
    editEffect(s, 'reverb', { type: 3 })
    rack.apply(s)
    void c.resume()
    await second
    s.effects = false
    rack.apply(s)
    void c.resume()
    const data = (await rendering).getChannelData(0)
    const live = energy(data.subarray(rate * 0.04, rate * 0.52))
    rack.dispose()
    source.disconnect()
    return {
      serial,
      postReverb,
      limited,
      live,
      connections: [...edges.values()].reduce((n, e) => n + e.size, 0),
    }
  } finally {
    AudioNode.prototype.connect = originalConnect
    AudioNode.prototype.disconnect = originalDisconnect
  }
}
