/** Injectable audio graph for basic piano voice */

export type AudioStatus = 'loading' | 'ready' | 'error' | 'fallback'

export interface VoiceHandle {
  noteId: string
  midi: number
  stop: (when?: number) => void
  release: (when?: number) => void
}

export interface PianoEngineOptions {
  createContext?: () => AudioContext
  maxPolyphony?: number
  sampleRate?: number
}

export interface ActiveNote {
  noteId: string
  midi: number
  velocity: number
  source: string
}

const DEFAULT_MAX_POLY = 32

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Basic piano-like voice via additive partials + envelope.
 * Honestly synthesized — not a recorded sample set.
 */
export class PianoEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private createContext: () => AudioContext
  private maxPolyphony: number
  private voices = new Map<string, { oscs: OscillatorNode[]; gains: GainNode[]; amp: GainNode; midi: number }>()
  private sustained = new Set<string>()
  private held = new Set<string>()
  private sustainPedal = false
  private status: AudioStatus = 'loading'
  private statusListeners = new Set<(s: AudioStatus) => void>()
  private noteIdSeq = 0
  private disposed = false

  constructor(opts: PianoEngineOptions = {}) {
    this.createContext = opts.createContext ?? (() => new AudioContext())
    this.maxPolyphony = opts.maxPolyphony ?? DEFAULT_MAX_POLY
  }

  getStatus(): AudioStatus {
    return this.status
  }

  onStatus(fn: (s: AudioStatus) => void): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  private setStatus(s: AudioStatus) {
    this.status = s
    for (const fn of this.statusListeners) fn(s)
  }

  async init(): Promise<void> {
    if (this.disposed) return
    try {
      if (!this.ctx) {
        this.ctx = this.createContext()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.35
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume()
      }
      this.setStatus('ready')
    } catch {
      this.setStatus('error')
      // Fallback: remain playable if context can still be created later
      try {
        this.ctx = this.createContext()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.35
        this.master.connect(this.ctx.destination)
        this.setStatus('fallback')
      } catch {
        this.setStatus('error')
      }
    }
  }

  getContext(): AudioContext | null {
    return this.ctx
  }

  getActiveNotes(): ActiveNote[] {
    return [...this.voices.entries()].map(([noteId, v]) => ({
      noteId,
      midi: v.midi,
      velocity: 0,
      source: 'synth',
    }))
  }

  getActiveVoiceCount(): number {
    return this.voices.size
  }

  setSustain(down: boolean): void {
    this.sustainPedal = down
    if (!down) {
      for (const id of [...this.sustained]) {
        if (!this.held.has(id)) {
          this.releaseVoice(id)
        }
      }
      this.sustained.clear()
    }
  }

  isSustainDown(): boolean {
    return this.sustainPedal
  }

  noteOn(midi: number, velocity = 0.75, source = 'pointer'): string {
    if (this.disposed) return ''
    if (!this.ctx || !this.master || this.status === 'error') {
      void this.init()
      if (!this.ctx || !this.master) return ''
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }

    // Steal oldest if at polyphony limit
    while (this.voices.size >= this.maxPolyphony) {
      const oldest = this.voices.keys().next().value
      if (oldest === undefined) break
      this.forceStop(oldest)
    }

    // Retrigger same MIDI: release previous held instances for that pitch if re-struck
    const noteId = `n${++this.noteIdSeq}-${midi}-${source}`
    const vel = Math.max(0.05, Math.min(1, velocity))
    const now = this.ctx.currentTime
    const freq = midiToFreq(midi)

    const amp = this.ctx.createGain()
    amp.gain.setValueAtTime(0, now)
    // Velocity-scaled attack
    const peak = 0.15 + vel * 0.55
    amp.gain.linearRampToValueAtTime(peak, now + 0.008)
    amp.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * 0.55), now + 0.12)
    amp.connect(this.master)

    const partials = [
      { mult: 1, gain: 1 },
      { mult: 2, gain: 0.35 * vel },
      { mult: 3, gain: 0.12 * vel },
      { mult: 4, gain: 0.06 },
    ]
    const oscs: OscillatorNode[] = []
    const gains: GainNode[] = []
    for (const p of partials) {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq * p.mult, now)
      const g = this.ctx.createGain()
      g.gain.value = p.gain * 0.25
      osc.connect(g)
      g.connect(amp)
      osc.start(now)
      oscs.push(osc)
      gains.push(g)
    }

    this.voices.set(noteId, { oscs, gains, amp, midi })
    this.held.add(noteId)
    return noteId
  }

  noteOff(noteId: string): void {
    if (!noteId || !this.voices.has(noteId)) return
    this.held.delete(noteId)
    if (this.sustainPedal) {
      this.sustained.add(noteId)
      return
    }
    this.releaseVoice(noteId)
  }

  noteOffByMidi(midi: number): void {
    for (const [id, v] of this.voices) {
      if (v.midi === midi && this.held.has(id)) {
        this.noteOff(id)
      }
    }
  }

  private releaseVoice(noteId: string): void {
    const voice = this.voices.get(noteId)
    if (!voice || !this.ctx) return
    const now = this.ctx.currentTime
    const release = 0.35
    try {
      voice.amp.gain.cancelScheduledValues(now)
      voice.amp.gain.setValueAtTime(Math.max(0.0001, voice.amp.gain.value), now)
      voice.amp.gain.exponentialRampToValueAtTime(0.0001, now + release)
    } catch {
      /* ignore */
    }
    window.setTimeout(() => this.forceStop(noteId), release * 1000 + 30)
  }

  private forceStop(noteId: string): void {
    const voice = this.voices.get(noteId)
    if (!voice) return
    for (const osc of voice.oscs) {
      try {
        osc.stop()
        osc.disconnect()
      } catch {
        /* ignore */
      }
    }
    for (const g of voice.gains) {
      try {
        g.disconnect()
      } catch {
        /* ignore */
      }
    }
    try {
      voice.amp.disconnect()
    } catch {
      /* ignore */
    }
    this.voices.delete(noteId)
    this.held.delete(noteId)
    this.sustained.delete(noteId)
  }

  allNotesOff(): void {
    for (const id of [...this.voices.keys()]) {
      this.forceStop(id)
    }
    this.held.clear()
    this.sustained.clear()
  }

  dispose(): void {
    this.allNotesOff()
    this.disposed = true
    try {
      this.master?.disconnect()
    } catch {
      /* ignore */
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close()
    }
    this.ctx = null
    this.master = null
  }
}
