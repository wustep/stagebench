// Deterministic fakes for the injectable runtime boundaries (tests only).
import type { MidiAccessLike, MidiConnectionEventLike, MidiInputLike, MidiMessageEventLike } from '../input/midi'
import type { ListenerTarget, Runtime, VisibilitySource } from '../runtime'
import { SimAudioContext } from './simAudio'

/** EventTarget that counts live listeners so tests can assert cleanup returns to baseline. */
export class CountingTarget implements ListenerTarget {
  private readonly target = new EventTarget()
  private readonly live = new Set<string>()
  private readonly ids = new WeakMap<object, number>()
  private nextId = 1
  visibilityState = 'visible'

  private key(type: string, listener: object): string {
    let id = this.ids.get(listener)
    if (!id) {
      id = this.nextId++
      this.ids.set(listener, id)
    }
    return `${type}:${id}`
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.live.add(this.key(type, listener))
    this.target.addEventListener(type, listener)
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.live.delete(this.key(type, listener))
    this.target.removeEventListener(type, listener)
  }

  dispatchEvent(event: Event): boolean {
    return this.target.dispatchEvent(event)
  }

  get listenerCount(): number {
    return this.live.size
  }
}

export class FakeMidiInput implements MidiInputLike {
  state = 'connected'
  onmidimessage: ((event: MidiMessageEventLike) => void) | null = null
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
  send(bytes: number[]): void {
    this.onmidimessage?.({ data: new Uint8Array(bytes) })
  }
}

export class FakeMidiAccess implements MidiAccessLike {
  readonly inputMap = new Map<string, FakeMidiInput>()
  onstatechange: ((event: MidiConnectionEventLike) => void) | null = null
  inputs = {
    forEach: (cb: (input: MidiInputLike) => void) => this.inputMap.forEach((input) => cb(input)),
  }
  add(input: FakeMidiInput): void {
    this.inputMap.set(input.id, input)
    this.onstatechange?.({ port: { id: input.id, type: 'input', state: 'connected' } })
  }
  disconnect(id: string): void {
    const input = this.inputMap.get(id)
    if (!input) return
    input.state = 'disconnected'
    this.inputMap.delete(id)
    this.onstatechange?.({ port: { id, type: 'input', state: 'disconnected' } })
  }
}

export interface TestRuntime extends Runtime {
  window: CountingTarget
  doc: CountingTarget & VisibilitySource
  contexts: SimAudioContext[]
  midiAccess: FakeMidiAccess
}

export function makeTestRuntime(options: { audio?: boolean; midi?: 'grant' | 'deny' | 'unsupported'; contextState?: 'running' | 'suspended' } = {}): TestRuntime {
  const win = new CountingTarget()
  const doc = new CountingTarget()
  const contexts: SimAudioContext[] = []
  const midiAccess = new FakeMidiAccess()
  const midi = options.midi ?? 'grant'
  return {
    window: win,
    doc,
    contexts,
    midiAccess,
    createAudioContext:
      options.audio === false
        ? null
        : () => {
            const ctx = new SimAudioContext(16000, options.contextState ?? 'running')
            contexts.push(ctx)
            return ctx
          },
    requestMIDIAccess:
      midi === 'unsupported'
        ? null
        : () => (midi === 'grant' ? Promise.resolve(midiAccess) : Promise.reject(new Error('SecurityError: permission denied'))),
    keyboardTarget: win,
    visibility: doc,
    yieldToEventLoop: () => Promise.resolve(),
    toneOptions: { sampleRate: 8000, durationScale: 0.12 },
  }
}
