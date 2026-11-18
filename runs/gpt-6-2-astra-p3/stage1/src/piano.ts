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
  clear() {
    for (const v of this.voices.values()) v.voice?.release(true)
    this.voices.clear()
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
export class Grand implements VoiceOutput {
  private context?: AudioContext
  private master?: GainNode
  private bank = new Map<string, AudioBuffer>()
  private state = 'Loading · synth fallback'
  private abort = new AbortController()
  private fallbackWave?: PeriodicWave
  private active = new Set<() => void>()
  constructor(
    private status: (s: string) => void,
    private boundary = browserAudio,
  ) {}
  private report() {
    if (!this.abort.signal.aborted)
      this.status(
        this.context?.state === 'running'
          ? this.state
          : this.state === 'Audio unavailable'
            ? this.state
            : this.state + ' · touch to enable',
      )
  }
  async load() {
    this.report()
    try {
      const ctx = this.boundary.context()
      this.context = ctx
      ctx.onstatechange = () => this.report()
      this.master = ctx.createGain()
      this.master.gain.value = 0.31
      this.master.connect(ctx.destination)
      this.fallbackWave = ctx.createPeriodicWave(
        new Float32Array(6),
        new Float32Array([0, 1, 0.38, 0.18, 0.09, 0.04]),
      )
      const buffers = await Promise.all(
        Array.from({ length: 50 }, async (_, i) => {
          const root = 27 + 3 * Math.floor(i / 2),
            layer = i % 2 ? 10 : 4,
            id = root + '-' + layer
          const bytes = await this.boundary.load(
            import.meta.env.BASE_URL + 'samples/grand-' + id + '.ogg',
            this.abort.signal,
          )
          return [id, await ctx.decodeAudioData(bytes)] as const
        }),
      )
      if (this.abort.signal.aborted) return
      this.bank = new Map(buffers)
      this.state = 'Piano ready'
    } catch {
      this.state = this.master
        ? 'Sample error · synth fallback'
        : 'Audio unavailable'
    }
    this.report()
  }
  unlock() {
    const ctx = this.context
    if (ctx && ctx.state === 'suspended')
      void ctx.resume().then(
        () => this.report(),
        () => this.status('Audio blocked · touch to retry'),
      )
  }
  start(note: number, velocity: number, ended: () => void) {
    const ctx = this.context,
      master = this.master
    if (!ctx || !master || ctx.state === 'closed') return
    this.unlock()
    const now = ctx.currentTime,
      root = rootFor(note)
    const buffer = this.bank.get(root + '-' + (velocity < 70 ? 4 : 10))
    const source = buffer ? ctx.createBufferSource() : ctx.createOscillator()
    const level = Math.pow(velocity / 127, 1.65) * (buffer ? 1 : 0.52)
    const envelope = ctx.createGain(),
      damper = ctx.createGain()
    source.connect(envelope)
    envelope.connect(damper)
    damper.connect(master)
    envelope.gain.setValueAtTime(0.00001, now)
    envelope.gain.linearRampToValueAtTime(level, now + 0.003)
    if ('buffer' in source && buffer) {
      source.buffer = buffer
      source.playbackRate.value = 2 ** ((note - root) / 12)
    } else if ('frequency' in source) {
      if (this.fallbackWave) source.setPeriodicWave(this.fallbackWave)
      source.frequency.value = 440 * 2 ** ((note - 69) / 12)
      envelope.gain.exponentialRampToValueAtTime(
        Math.max(0.00001, level * 0.36),
        now + 0.45,
      )
      envelope.gain.exponentialRampToValueAtTime(0.00001, now + 6)
    }
    const cleanup = () => {
      if (!this.active.delete(cleanup)) return
      source.onended = null
      source.disconnect()
      envelope.disconnect()
      damper.disconnect()
      ended()
    }
    this.active.add(cleanup)
    source.onended = cleanup
    source.start(now)
    if (!buffer) source.stop(now + 6.01)
    return {
      release: (fast = false) => {
        if (!this.active.has(cleanup)) return
        const time = ctx.currentTime,
          duration = fast ? 0.015 : 0.19
        damper.gain.cancelAndHoldAtTime(time)
        damper.gain.exponentialRampToValueAtTime(0.00001, time + duration)
        source.stop(time + duration + 0.002)
      },
    }
  }
  dispose() {
    this.abort.abort()
    for (const cleanup of this.active) cleanup()
    this.bank.clear()
    this.master?.disconnect()
    if (this.context) {
      this.context.onstatechange = null
      void this.context.close()
    }
  }
}
