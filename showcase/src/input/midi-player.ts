import type { InstrumentController } from './controller'
import type { ParsedMidiFile } from './midi-file'

export type MidiPlayerStatus = 'idle' | 'playing' | 'paused' | 'ended'

export interface MidiPlayerState {
  status: MidiPlayerStatus
  name: string | null
  positionSec: number
  durationSec: number
  /** Notes in the loaded file that fall outside the keybed and won't sound. */
  outOfRangeNotes: number
}

const IDLE_STATE: MidiPlayerState = {
  status: 'idle',
  name: null,
  positionSec: 0,
  durationSec: 0,
  outOfRangeNotes: 0,
}

/** Position emits are throttled to this cadence while playing (ms). */
const POSITION_EMIT_MS = 100

/** Catch-up guard: a note-on whose scheduled time is already this far in the
 *  past when the loop sees it (main-thread stall, background tab pausing
 *  rAF) is skipped instead of fired — otherwise resuming after a long gap
 *  dispatches every missed note as one giant synchronous chord. Note-offs
 *  and sustain events always dispatch so held/pedal state stays consistent. */
const MAX_NOTE_LAG_SEC = 0.25

/**
 * Drives a parsed MIDI file through the {@link InstrumentController} in real
 * time: a requestAnimationFrame loop dispatches note on/off (and sustain)
 * events whose time has arrived, so the file plays through whatever sound is
 * currently selected on the panel. Supports play / pause / restart, always
 * releasing its own ('file') notes and lifting any sustain it engaged.
 */
export class MidiFilePlayer {
  private state: MidiPlayerState = IDLE_STATE
  private file: ParsedMidiFile | null = null
  private index = 0
  private positionSec = 0
  private startClock = 0
  private raf = 0
  private lastEmit = 0
  private sustainEngaged = false
  private readonly listeners = new Set<() => void>()

  private readonly now: () => number
  private readonly requestFrame: (cb: () => void) => number
  private readonly cancelFrame: (id: number) => void

  constructor(private readonly controller: InstrumentController) {
    this.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
    this.requestFrame =
      typeof requestAnimationFrame === 'function'
        ? (cb) => requestAnimationFrame(cb)
        : (cb) => setTimeout(cb, 16) as unknown as number
    this.cancelFrame =
      typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): MidiPlayerState => this.state

  /** Load a parsed file and begin playing it from the start. */
  loadAndPlay(file: ParsedMidiFile): void {
    this.stopLoop()
    this.releaseOwnNotes()
    this.file = file
    this.index = 0
    this.positionSec = 0
    this.setState({
      status: 'idle',
      name: file.name,
      positionSec: 0,
      durationSec: file.durationSec,
      outOfRangeNotes: file.outOfRangeNotes,
    })
    this.play()
  }

  play(): void {
    if (!this.file || this.state.status === 'playing') return
    // Empty files (no playable notes) have nothing to do.
    if (this.file.events.length === 0) {
      this.finish()
      return
    }
    // Restart from the top if we were sitting at the end.
    if (this.state.status === 'ended') {
      this.index = 0
      this.positionSec = 0
    }
    this.controller.engine.ensureStarted()
    this.startClock = this.now() - this.positionSec * 1000
    this.setStatus('playing')
    this.lastEmit = this.now()
    this.raf = this.requestFrame(this.tick)
  }

  pause(): void {
    if (this.state.status !== 'playing') return
    this.stopLoop()
    this.releaseOwnNotes()
    this.setState({ ...this.state, status: 'paused', positionSec: this.positionSec })
  }

  restart(): void {
    if (!this.file) return
    this.stopLoop()
    this.releaseOwnNotes()
    this.index = 0
    this.positionSec = 0
    this.setState({ ...this.state, status: 'paused', positionSec: 0 })
    this.play()
  }

  toggle(): void {
    if (this.state.status === 'playing') this.pause()
    else this.play()
  }

  /** Unload the file entirely and return to the idle (no-transport) state. */
  close(): void {
    this.stopLoop()
    this.releaseOwnNotes()
    this.file = null
    this.index = 0
    this.positionSec = 0
    this.setState(IDLE_STATE)
  }

  dispose(): void {
    this.stopLoop()
    this.releaseOwnNotes()
    this.listeners.clear()
  }

  private tick = (): void => {
    if (!this.file) return
    const nowSec = (this.now() - this.startClock) / 1000
    const { events, durationSec } = this.file
    if (this.index < events.length && events[this.index].time <= nowSec) {
      const staleBefore = nowSec - MAX_NOTE_LAG_SEC
      // One controller notification per frame, not one per event — a chord
      // stack otherwise re-runs every key/pedal subscriber once per note.
      this.controller.batch(() => {
        while (this.index < events.length && events[this.index].time <= nowSec) {
          const event = events[this.index]
          this.index += 1
          if (event.type === 'noteOn' && event.time < staleBefore) continue
          this.dispatch(event)
        }
      })
    }
    this.positionSec = Math.min(nowSec, durationSec)
    if (this.index >= events.length && nowSec >= durationSec) {
      this.finish()
      return
    }
    const clockNow = this.now()
    if (clockNow - this.lastEmit >= POSITION_EMIT_MS) {
      this.lastEmit = clockNow
      this.setState({ ...this.state, positionSec: this.positionSec })
    }
    this.raf = this.requestFrame(this.tick)
  }

  private dispatch(event: ParsedMidiFile['events'][number]): void {
    if (event.type === 'noteOn') {
      this.controller.noteOn(event.midi, event.value, 'file')
    } else if (event.type === 'noteOff') {
      this.controller.noteOff(event.midi, 'file')
    } else {
      // Sustain (CC64): track engagement so pause/stop can lift it cleanly.
      this.sustainEngaged = event.value >= 0.5
      this.controller.setSustain(event.value)
    }
  }

  private finish(): void {
    this.stopLoop()
    this.releaseOwnNotes()
    this.positionSec = this.file?.durationSec ?? 0
    this.setState({ ...this.state, status: 'ended', positionSec: this.positionSec })
  }

  private releaseOwnNotes(): void {
    this.controller.releaseSource('file')
    if (this.sustainEngaged) {
      this.sustainEngaged = false
      this.controller.setSustain(false)
    }
  }

  private stopLoop(): void {
    if (this.raf) {
      this.cancelFrame(this.raf)
      this.raf = 0
    }
  }

  private setStatus(status: MidiPlayerStatus): void {
    this.setState({ ...this.state, status })
  }

  private setState(next: MidiPlayerState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}
