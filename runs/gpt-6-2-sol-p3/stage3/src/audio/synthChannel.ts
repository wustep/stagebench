import { clamp, synthPeriod } from '../instrument/parameters'
import type { SynthLayer } from '../instrument/parameters'
import type { NotePart } from './notePart'
import { SynthVoice, SynthWaves } from './synth'

export interface Scheduler {
  set(callback: () => void, milliseconds: number): number
  clear(id: number): void
}

export const browserScheduler: Scheduler = {
  set: (callback, ms) => globalThis.setTimeout(callback, ms) as unknown as number,
  clear: (id) => globalThis.clearTimeout(id),
}

interface Strike { note: number; velocity: number; zone: number }
interface Latched extends Strike { voice?: SynthVoice }
interface Key extends Latched { ended: () => void; down: boolean; sustained: boolean }
type Patch = {
  state: SynthLayer; on: boolean; transpose: number; bend: number; wheel: number; tempo: number; epoch: number; keyboardSync: boolean
}

export function arpeggioStep<T extends Strike>(notes: readonly T[], arp: SynthLayer['arp'], step: number): Strike[] {
  if (!notes.length) return []
  const sorted = [...notes].sort((a, b) => a.note - b.note)
  const octaves = Math.floor(clamp(arp.range, 0, 3)) + 1
  const add = (strike: Strike, octave: number) => ({ ...strike, note: clamp(strike.note + 12 * octave, 0, 127) })
  const pool = arp.mode === 'Poly'
    ? Array.from({ length: octaves }, (_, octave) => sorted.map((key) => add(key, octave)))
    : Array.from({ length: octaves }, (_, octave) => sorted.map((key) => [add(key, octave)])).flat()
  const length = pool.length
  switch (arp.direction) {
    case 'Down': return pool[length - 1 - step % length]
    case 'Up/Down': {
      const span = Math.max(1, length * 2 - 2)
      const position = step % span
      return pool[position < length ? position : span - position]
    }
    case 'Random': {
      let seed = Math.imul(step + 1, 0x9e3779b1)
      seed = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b)
      return pool[(seed >>> 0) % length]
    }
    default: return pool[step % length]
  }
}

export function priorityKey<T extends Strike>(keys: readonly T[], priority: SynthLayer['voice']['priority']) {
  return keys.reduce<T | undefined>((choice, next) => {
    if (!choice || priority === 'Off') return next
    return (priority === 'Low' ? next.note <= choice.note : next.note >= choice.note) ? next : choice
  }, undefined)
}

/** Owns note priority, the latched arpeggio chord, and the single clock timer for one Synth layer. */
export class SynthChannel {
  private readonly keys = new Set<Key>()
  private readonly voices = new Set<SynthVoice>()
  private mono?: { key: Latched; voice: SynthVoice }
  private latched: Latched[] = []
  private steps: SynthVoice[] = []
  private timer?: number
  private next = 0
  private step = 0
  private gateOpen = true

  constructor(
    private readonly context: BaseAudioContext, private readonly output: AudioNode, private readonly bank: SynthWaves,
    private patch: Patch, private readonly clock: () => number, private readonly scheduler: Scheduler,
    private readonly zoneFor: (note: number) => number,
  ) {}

  press(strike: Strike, ended: () => void): NotePart {
    const { state } = this.patch
    if (state.arp.hold && ![...this.keys].some((key) => key.down)) {
      this.clearLatch()
      this.stopClock()
    }
    const key = { ...strike, down: true, sustained: false, ended }
    this.keys.add(key)
    this.refresh()
    return {
      keyUp: (pedal) => {
        if (!this.keys.has(key)) return false
        key.down = false
        key.sustained = pedal && this.patch.state.sustain
        if (!key.sustained) this.remove(key)
        return key.sustained
      },
      isSustained: () => key.sustained,
      release: (seconds) => this.remove(key, seconds, seconds === undefined),
      stop: () => this.remove(key, 0.006, false),
    }
  }

  update(patch: Patch) {
    const previous = this.patch
    this.patch = patch
    if (!patch.on) {
      this.clear()
      return
    }
    const { state } = patch
    const { arp } = state
    let reset = false
    if (previous.state.arp.run !== arp.run || previous.state.arp.mode !== arp.mode ||
      previous.state.voice.mode !== state.voice.mode ||
      previous.state.category !== state.category || previous.state.wave !== state.wave ||
      previous.state.voice.unison !== state.voice.unison) {
      this.clearSound()
      this.stopClock()
      reset = true
    }
    if (!arp.hold) this.clearLatch()
    const configurationChanged = previous.state.arp.sync !== arp.sync || previous.epoch !== patch.epoch
    if (this.timer !== undefined) {
      if (configurationChanged) this.stopClock()
      else {
        const before = synthPeriod(previous.state.arp.rate, arp.sync, previous.tempo, true)
        const after = this.period()
        if (Math.abs(before - after) > 0.0001) {
          const now = this.clock()
          this.next = now + Math.max(0, this.next - now) / before * after
          this.scheduler.clear(this.timer)
          this.timer = this.scheduler.set(this.tick, Math.max(4, (this.next - now) * 1000))
        }
      }
    }
    for (const key of this.keys) {
      if (key.sustained && !state.sustain) this.remove(key, undefined, false)
      else key.zone = this.zoneFor(key.note)
    }
    for (const strike of this.latched) strike.zone = this.zoneFor(strike.note)
    for (const voice of this.voices) voice.update(state, patch)
    if (this.mono) this.mono.voice.retarget(this.pitch(this.mono.key.note), this.mono.key.velocity,
      this.mono.key.zone, state, patch, true)
    for (const key of [...this.keys, ...this.latched]) key.voice?.retarget(this.pitch(key.note), key.velocity, key.zone, state, patch, true)
    if (reset || (this.timer === undefined && arp.run) || previous.state.arp.hold !== arp.hold ||
      previous.state.voice.priority !== state.voice.priority) this.refresh()
  }

  clear() {
    this.stopClock()
    this.latched = []
    for (const key of this.keys) {
      key.sustained = false
      key.ended()
    }
    this.keys.clear()
    for (const voice of this.voices) voice.stop()
    this.voices.clear()
    this.steps = []
    this.mono = undefined
  }

  private clearSound() {
    for (const voice of this.voices) voice.release(0.02)
    for (const key of [...this.keys, ...this.latched]) key.voice = undefined
    this.mono = undefined
    this.steps = []
    this.gateOpen = true
  }

  private remove(key: Key, seconds?: number, allowHold = true) {
    if (!this.keys.delete(key)) return
    const { arp } = this.patch.state
    const keep = allowHold && arp.hold && !this.latched.some((strike) => strike.note === key.note)
    if (keep) {
      const held: Latched = { note: key.note, velocity: key.velocity, zone: key.zone, voice: key.voice }
      this.latched.push(held)
      if (this.mono?.key === key) this.mono.key = held
    } else {
      key.voice?.release(seconds)
      if (this.mono?.key === key && seconds !== undefined && !this.keys.size && !this.latched.length) {
        this.mono.voice.release(seconds)
        this.mono = undefined
      }
    }
    key.sustained = false
    key.voice = undefined
    key.ended()
    this.refresh()
  }

  private clearLatch() {
    for (const key of this.latched) key.voice?.release(0.035)
    if (this.mono && this.latched.includes(this.mono.key)) {
      this.mono.voice.release(0.035)
      this.mono = undefined
    }
    this.latched = []
  }

  private pitch(note: number) {
    return clamp(note + this.patch.transpose + this.patch.state.octave * 12, 0, 127)
  }

  private start(strike: Strike) {
    let voice: SynthVoice
    voice = new SynthVoice(this.context, this.output, this.bank, this.patch.state,
      this.pitch(strike.note), strike.velocity, strike.zone, this.patch, this.clock, () => this.voices.delete(voice))
    this.voices.add(voice)
    return voice
  }

  private refresh() {
    const { state } = this.patch
    const { arp } = state
    const held = this.heldChord()
    if (!arp.run || arp.mode === 'Gate') {
      const keys = [...this.latched, ...this.keys].filter((key) => key.zone > 0)
      if (state.voice.mode === 'Poly') {
        for (const key of keys) if (!key.voice) {
          key.voice = this.start(key)
          if (arp.run && !this.gateOpen) key.voice.gate(false, arp.range, this.period())
        }
      } else {
        const chosen = priorityKey(keys, state.voice.priority)
        if (!chosen) {
          this.mono?.voice.release()
          this.mono = undefined
        } else if (!this.mono) {
          this.mono = { key: chosen, voice: this.start(chosen) }
          if (arp.run && !this.gateOpen) this.mono.voice.gate(false, arp.range, this.period())
        } else if (this.mono.key !== chosen) {
          this.mono.voice.retarget(this.pitch(chosen.note), chosen.velocity, chosen.zone, state, this.patch,
            state.voice.mode === 'Legato')
          this.mono.key = chosen
        }
      }
    }
    if (arp.run && held.length) {
      if (this.timer === undefined) {
        const now = this.clock()
        const period = this.period()
        const phase = ((now - this.patch.epoch) % period + period) % period
        this.next = arp.sync && !this.patch.keyboardSync && phase > 0.004 ? now + period - phase : now
        this.tick()
      }
    } else {
      this.stopClock()
      for (const voice of this.steps) voice.release(0.02)
      this.steps = []
      if (!arp.run && !this.gateOpen) this.toggleGate(true)
    }
  }

  private heldChord() {
    const notes = new Map(this.latched.map((strike) => [strike.note, strike]))
    for (const key of this.keys) notes.set(key.note, key)
    return [...notes.values()].filter((key) => key.zone > 0)
  }

  private period() {
    const { state, tempo } = this.patch
    return synthPeriod(state.arp.rate, state.arp.sync, tempo, true)
  }

  private tick = () => {
    this.timer = undefined
    const { state } = this.patch
    if (!state.arp.run || !this.patch.on) return
    const notes = this.heldChord()
    if (!notes.length) return
    const period = this.period()
    const now = this.clock()
    if (now + 0.003 >= this.next) {
      if (state.arp.mode === 'Gate') {
        this.toggleGate(this.step % 2 === 0)
        this.next += period * 0.5
      } else {
        for (const voice of this.steps) voice.release(0.025)
        this.steps = arpeggioStep(notes, state.arp, this.step).map((key) => this.start(key))
        for (const voice of this.steps) voice.scheduleRelease(now + period * 0.73, Math.min(0.07, period * 0.24))
        this.next += period
      }
      this.step++
      if (this.next <= now) this.next = now + period * (state.arp.mode === 'Gate' ? 0.5 : 1)
    }
    this.timer = this.scheduler.set(this.tick, Math.max(4, (this.next - this.clock()) * 1000))
  }

  private toggleGate(open: boolean) {
    this.gateOpen = open
    const voices = [...this.keys, ...this.latched].flatMap((key) => key.voice ? [key.voice] : []).concat(this.steps)
    if (this.mono) voices.push(this.mono.voice)
    for (const voice of voices) voice.gate(open, this.patch.state.arp.range, this.period())
  }

  private stopClock() {
    if (this.timer !== undefined) this.scheduler.clear(this.timer)
    this.timer = undefined
    this.step = 0
  }
}
