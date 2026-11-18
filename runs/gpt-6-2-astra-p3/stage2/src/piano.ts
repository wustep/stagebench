import { Rack } from './effects'
import { defaults, layers, type Settings, type LayerId } from './settings'
import zones from './zones.json'
export interface Voice {
  release: (fast?: boolean) => void
}
export interface VoiceOutput {
  start: (
    note: number,
    velocity: number,
    ended: () => void,
  ) => Voice | undefined
}
interface Owned {
  key: string
  note: number
  domain: string
  state: 'down' | 'sustained' | 'released'
  voice?: Voice
}

/** Keep pending note-offs in FIFO order even after an older voice has been stolen. */
export class Piano {
  private voices = new Map<number, Owned>()
  private pending = new Map<string, number[]>()
  private pedals = new Set<string>()
  private heldNotes = new Map<number, number>()
  private sequence = 0
  constructor(
    private output: VoiceOutput,
    private notify: () => void,
    private limit = 32,
  ) {}
  get count() {
    return this.voices.size
  }
  get undamped() {
    return [...this.voices.values()]
      .filter((v) => v.state !== 'released')
      .map((v) => v.note)
  }
  get sustained() {
    return this.pedals.size > 0
  }
  hasPedal(domain: string) {
    return this.pedals.has(domain)
  }
  private holds(domain: string) {
    return (
      this.hasPedal(domain) ||
      this.hasPedal('global') ||
      this.hasPedal('switch')
    )
  }
  get pressed() {
    return new Set(this.heldNotes.values())
  }
  on(key: string, note: number, velocity: number, domain = 'local') {
    if (velocity <= 0) {
      this.off(key)
      return
    }
    if (this.voices.size >= this.limit) {
      const entries = [...this.voices.entries()]
      const [id, v] =
        entries.find(([, v]) => v.state === 'released') ??
        entries.find(([, v]) => v.state === 'sustained') ??
        entries[0]
      v.voice?.release(true)
      this.voices.delete(id)
    }
    const id = ++this.sequence
    this.heldNotes.set(id, note)
    const v: Owned = { key, note, domain, state: 'down' }
    v.voice = this.output.start(
      note,
      Math.max(1, Math.min(127, velocity)),
      () => {
        if (this.voices.delete(id)) this.notify()
      },
    )
    if (v.voice) this.voices.set(id, v)
    const queue = this.pending.get(key) ?? []
    queue.push(id)
    this.pending.set(key, queue)
    this.notify()
  }
  off(key: string) {
    const queue = this.pending.get(key),
      id = queue?.shift()
    if (!queue?.length) this.pending.delete(key)
    const v = id === undefined ? undefined : this.voices.get(id)
    if (id !== undefined) this.heldNotes.delete(id)
    if (!v) {
      if (id !== undefined) this.notify()
      return
    }
    if (this.holds(v.domain)) v.state = 'sustained'
    else {
      v.state = 'released'
      v.voice?.release()
    }
    this.notify()
  }
  pedal(domain: string, down: boolean) {
    if (down) this.pedals.add(domain)
    else this.pedals.delete(domain)
    for (const v of this.voices.values())
      if (v.state === 'sustained' && !this.holds(v.domain)) {
        v.state = 'released'
        v.voice?.release()
      }
    this.notify()
  }
  silence() {
    for (const v of this.voices.values()) v.voice?.release(true)
    this.voices.clear()
  }
  clear() {
    this.silence()
    this.heldNotes.clear()
    this.pending.clear()
    this.pedals.clear()
    this.notify()
  }
}

export const rootFor = (note: number) =>
  Math.max(27, Math.min(99, Math.round(note / 3) * 3))
export interface AudioBoundary {
  context: () => AudioContext
  load: (file: string, signal: AbortSignal) => Promise<ArrayBuffer>
}
export const browserAudio: AudioBoundary = {
  context: () => new AudioContext({ latencyHint: 'interactive' }),
  load: async (file, signal) => {
    const response = await fetch(file, { signal })
    if (!response.ok) throw Error('Sample unavailable')
    return response.arrayBuffer()
  },
}
export type Keys = Pick<
  Piano,
  'on' | 'off' | 'clear' | 'pedal' | 'pressed' | 'hasPedal' | 'sustained'
>
export class Grand implements VoiceOutput {
  private context?: AudioContext
  private rack?: Rack
  private bank = new Map<string, AudioBuffer>()
  private loading = new Map<number, Promise<void>>()
  private ready = new Set<number>()
  private failed = new Set<number>()
  private abort = new AbortController()
  private active = new Map<
    () => void,
    { layer: LayerId; bend: (cents: number) => void }
  >()
  settings = defaults()
  private pedals = new Set<string>()
  private owners: Piano[]
  constructor(
    private status: (s: string) => void,
    private boundary = browserAudio,
    notify = () => {},
  ) {
    this.owners = layers.map(
      (i) =>
        new Piano(
          { start: (n, v, end) => this.startLayer(i, n, v, end) },
          notify,
        ),
    )
  }
  get pressed() {
    return this.owners[0].pressed
  }
  get sustained() {
    return this.pedals.size > 0
  }
  hasPedal(d: string) {
    return this.pedals.has(d)
  }
  on(key: string, n: number, v: number, domain = 'local') {
    for (const p of this.owners) p.on(key, n, v, domain)
  }
  off(key: string) {
    for (const p of this.owners) p.off(key)
  }
  pedal(d: string, on: boolean) {
    if (on) this.pedals.add(d)
    else this.pedals.delete(d)
    this.owners.forEach((p, i) =>
      p.pedal(d, on && this.settings.layers[i].pedal),
    )
  }
  clear() {
    this.pedals.clear()
    this.owners.forEach((p) => p.clear())
    if (!this.abort.signal.aborted) this.rack?.flush(this.settings)
  }
  get count() {
    return this.active.size
  }
  modelState(type: number) {
    return type >= 3 || this.ready.has(type)
      ? 'Piano ready'
      : this.failed.has(type)
        ? 'Sample error · synth fallback'
        : 'Loading · synth fallback'
  }
  private report() {
    if (this.abort.signal.aborted) return
    const types = this.settings.layers
      .filter((l, i) => l.enabled || i === this.settings.focus)
      .map((l) => l.type)
    const states = types.map((t) => this.modelState(t))
    const state =
      states.find((s) => s.startsWith('Sample error')) ??
      states.find((s) => s.startsWith('Loading')) ??
      'Piano ready'
    this.status(
      this.rack
        ? state +
            (this.context?.state === 'running' ? '' : ' · touch to enable')
        : 'Audio unavailable',
    )
  }
  async load() {
    if (this.abort.signal.aborted) return
    if (this.context) return this.prepare()
    try {
      const c = this.boundary.context()
      this.context = c
      this.rack = new Rack(c)
      this.rack.apply(this.settings, true)
      c.onstatechange = () => this.report()
      await this.prepare()
    } catch {
      this.report()
    }
  }
  async prepare() {
    const c = this.context
    if (!c) return
    this.report()
    await Promise.all(
      this.settings.layers.map(async (l) => {
        const type = l.type
        if (type >= 3) return
        if (!this.loading.has(type)) {
          const files = zones.filter((z) => z.type === type)
          const load = async () => {
            while (files.length && !this.abort.signal.aborted) {
              const z = files.shift()!
              const bytes = await this.boundary.load(
                import.meta.env.BASE_URL + z.file,
                this.abort.signal,
              )
              const audio = await c.decodeAudioData(bytes)
              if (!this.abort.signal.aborted) this.bank.set(z.file, audio)
            }
          }
          const promise = Promise.all(Array.from({ length: 6 }, load)).then(
            () => {
              this.ready.add(type)
            },
            () => {
              this.failed.add(type)
            },
          )
          this.loading.set(type, promise)
        }
        await this.loading.get(type)
      }),
    )
    this.report()
  }
  apply(s: Settings) {
    const prev = this.settings
    this.settings = s
    this.rack?.apply(s)
    this.owners.forEach((p, i) => {
      if (
        (prev.section && !s.section) ||
        (prev.layers[i].enabled && !s.layers[i].enabled)
      )
        p.silence()
      if (s.layers[i].pedal !== prev.layers[i].pedal)
        for (const d of this.pedals) p.pedal(d, s.layers[i].pedal)
    })
    for (const voice of this.active.values()) {
      if (
        s.bend !== prev.bend ||
        s.layers[voice.layer].stick !== prev.layers[voice.layer].stick
      )
        voice.bend(s.layers[voice.layer].stick ? (s.bend - 50) * 4 : 0)
    }
    if (s.layers.some((l, i) => l.type !== prev.layers[i].type))
      void this.prepare()
    else this.report()
  }
  unlock() {
    const c = this.context
    if (c?.state === 'suspended' && !('startRendering' in c))
      void c.resume().then(
        () => this.report(),
        () => this.status('Audio blocked · touch to retry'),
      )
  }
  start(n: number, v: number, end: () => void) {
    return this.startLayer(0, n, v, end)
  }
  private startLayer(
    i: LayerId,
    note: number,
    velocity: number,
    ended: () => void,
  ) {
    const c = this.context,
      rack = this.rack,
      s = this.settings,
      l = s.layers[i]
    if (!c || !rack || !s.section || !l.enabled || c.state === 'closed') return
    this.unlock()
    note += 12 * l.octave
    const now = c.currentTime,
      v = (velocity / 127) ** [1.45, 1, 0.65][l.touch]
    const high = v * 127 >= (l.type === 1 ? 81 : 70)
    const available = zones.filter(
      (z) => z.type === l.type && (l.type === 2 || z.high === high),
    )
    const zone = available.sort(
      (a, b) => Math.abs(a.root - note) - Math.abs(b.root - note),
    )[0]
    const buffer =
      this.ready.has(l.type) && zone ? this.bank.get(zone.file) : undefined
    const level = v ** (1.65 - 0.34 * l.dyn) * (buffer ? 1 : 0.52)
    const nodes: AudioNode[] = [],
      sources: (AudioBufferSourceNode | OscillatorNode)[] = []
    const keep = <T extends AudioNode>(node: T) => {
      nodes.push(node)
      return node
    }
    const envelope = keep(c.createGain()),
      damper = keep(c.createGain()),
      color = keep(c.createBiquadFilter())
    color.type = (
      [
        'peaking',
        'lowpass',
        'peaking',
        'highshelf',
        'peaking',
        'highshelf',
      ] as const
    )[l.timbre]
    color.frequency.value = [15000, 1350, 1200, 2500, 2700, 950][l.timbre]
    color.Q.value = 0.85
    color.gain.value = [0, 0, 6, 7, 10, 10][l.timbre]
    envelope.connect(color).connect(damper).connect(rack.lanes[i].input)
    const brightness = keep(c.createBiquadFilter())
    brightness.type = 'lowpass'
    brightness.frequency.value =
      l.type === 2 ? 450 + 11500 * v * v : Math.min(c.sampleRate * 0.48, 20000)
    brightness.connect(envelope)
    const frequency = 440 * 2 ** ((note - 69) / 12)
    const detunes = l.unison ? [0, -5 * l.unison, 5 * l.unison] : [0]
    let live = detunes.length
    const cleanup = () => {
      if (!this.active.delete(cleanup)) return
      for (const src of sources) {
        src.onended = null
        try {
          src.stop()
        } catch {
          /* already ended */
        }
      }
      for (const node of nodes) node.disconnect()
      ended()
    }
    const tuning = new Map<AudioParam, number>()
    const tune = (
      src: OscillatorNode | AudioBufferSourceNode,
      offset: number,
    ) => {
      tuning.set(src.detune, offset)
      src.detune.value = offset + (l.stick ? (s.bend - 50) * 4 : 0)
    }
    this.active.set(cleanup, {
      layer: i,
      bend: (cents) => {
        for (const [p, offset] of tuning) {
          p.cancelAndHoldAtTime(c.currentTime)
          p.setTargetAtTime(cents + offset, c.currentTime, 0.008)
        }
      },
    })
    detunes.forEach((detune, j) => {
      const src = buffer
        ? keep(c.createBufferSource())
        : keep(c.createOscillator())
      if ('buffer' in src && buffer) {
        src.buffer = buffer
        src.playbackRate.value = 2 ** ((note - zone.root) / 12)
        if (zone.loopStart !== undefined && zone.loopEnd !== undefined) {
          src.loop = true
          src.loopStart = zone.loopStart
          src.loopEnd = Math.min(zone.loopEnd, buffer.duration)
        }
      } else if ('frequency' in src) {
        const harmonics =
          l.type === 3
            ? [0, 1, 0.32, 0.48, 0.14, 0.23, 0.15, 0.08, 0.12]
            : l.type === 4
              ? [0, 1, 0.1, 0.22, 0, 0.11, 0, 0.09]
              : l.type === 5
                ? [0, 1, 0, 0, 0.42, 0, 0, 0, 0.12]
                : [0, 1, 0.38, 0.18, 0.09, 0.04]
        src.setPeriodicWave(
          c.createPeriodicWave(
            new Float32Array(harmonics.length),
            new Float32Array(harmonics),
          ),
        )
        src.frequency.value = frequency
        if (l.type === 4 || l.type === 5) {
          // A bright attack decays into a quieter fundamental. Noninteger
          // mallet modes give the short rosewood voice its hollow strike.
          const partial = keep(c.createOscillator()),
            depth = keep(c.createGain())
          partial.frequency.value = frequency * (l.type === 4 ? 2 : 3.96)
          tune(partial, detune)
          depth.gain.setValueAtTime(
            l.type === 4 ? frequency * (0.4 + v) : 0.6 * v,
            now,
          )
          depth.gain.exponentialRampToValueAtTime(
            0.00001,
            now + (l.type === 4 ? 1.2 : 0.29),
          )
          partial.connect(depth)
          if (l.type === 4) depth.connect(src.frequency)
          else depth.connect(brightness)
          partial.start(now)
          partial.stop(now + 1.21)
          sources.push(partial)
        }
      }
      tune(src, detune)
      const pan = keep(c.createStereoPanner())
      pan.pan.value = j === 1 ? -0.82 : j === 2 ? 0.82 : 0
      src.connect(pan).connect(brightness)
      src.onended = () => {
        if (--live === 0) cleanup()
      }
      sources.push(src)
      src.start(now)
      if (!buffer) src.stop(now + 6.01)
      else if (zone.loopStart !== undefined) src.stop(now + 28.01)
    })
    envelope.gain.setValueAtTime(0.00001, now)
    const peak = level / Math.sqrt(detunes.length)
    envelope.gain.linearRampToValueAtTime(peak, now + 0.003)
    if (buffer && zone.loopStart !== undefined) {
      const hold = zone.loopStart / 2 ** ((note - zone.root) / 12)
      envelope.gain.setValueAtTime(peak, now + Math.min(20, hold))
      envelope.gain.exponentialRampToValueAtTime(0.00001, now + 28)
    }
    if (!buffer) {
      envelope.gain.exponentialRampToValueAtTime(
        peak * (l.type === 3 ? 0.12 : l.type === 5 ? 0.075 : 0.36),
        now + 0.45,
      )
      envelope.gain.exponentialRampToValueAtTime(0.00001, now + 6)
    }
    const openStrings = l.res && l.type < 2 ? this.owners[i].undamped : []
    if (
      l.res &&
      l.type < 2 &&
      (this.owners[i].sustained || openStrings.length)
    ) {
      // Excite a partial of an undamped string near the struck string's second harmonic.
      const fundamental = openStrings.length
        ? 440 *
          2 ** ((openStrings[openStrings.length - 1] + 12 * l.octave - 69) / 12)
        : frequency
      const partial = Math.max(
        1,
        Math.min(8, Math.round((2 * frequency) / fundamental)),
      )
      const ring = keep(c.createOscillator()),
        gain = keep(c.createGain())
      ring.frequency.value = Math.min(
        c.sampleRate * 0.45,
        fundamental * partial,
      )
      gain.gain.setValueAtTime(0.00001, now)
      gain.gain.linearRampToValueAtTime(0.12 * level, now + 0.045)
      gain.gain.exponentialRampToValueAtTime(0.00001, now + 2)
      tune(ring, 0)
      ring.connect(gain).connect(damper)
      ring.start(now)
      ring.stop(now + 2)
      sources.push(ring)
    }
    return {
      release: (fast = false) => {
        if (!this.active.has(cleanup)) return
        const time = c.currentTime,
          duration = fast ? 0.014 : l.soft && l.type !== 3 ? 0.48 : 0.19
        damper.gain.cancelAndHoldAtTime(time)
        damper.gain.exponentialRampToValueAtTime(0.00001, time + duration)
        for (const src of sources) src.stop(time + duration + 0.002)
      },
    }
  }
  dispose() {
    this.abort.abort()
    this.clear()
    for (const cleanup of this.active.keys()) cleanup()
    this.bank.clear()
    this.rack?.dispose()
    this.rack = undefined
    if (this.context) {
      this.context.onstatechange = null
      if (!('startRendering' in this.context)) void this.context.close()
      this.context = undefined
    }
  }
}
