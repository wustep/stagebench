/**
 * Every boundary between the app and the browser. The app only ever talks to these
 * interfaces; `browser.ts` binds them to the real browser, tests bind them to fakes.
 * Nothing in `src/` outside `src/platform/browser.ts` touches `window`, `navigator`,
 * `AudioContext`, `localStorage`, or global timers directly.
 */

// ── Audio ─────────────────────────────────────────────────────────────────────

export interface AudioNodeLike {
  connect(destination: unknown): unknown
  disconnect(): void
}

export interface MessagePortLike {
  postMessage(message: unknown): void
  onmessage: ((event: { data: unknown }) => void) | null
}

export interface WorkletNodeLike extends AudioNodeLike {
  port: MessagePortLike
}

export interface AudioProcessEventLike {
  outputBuffer: {
    numberOfChannels: number
    getChannelData(channel: number): Float32Array
  }
}

export interface ScriptNodeLike extends AudioNodeLike {
  onaudioprocess: ((event: AudioProcessEventLike) => void) | null
}

export interface AudioContextLike {
  readonly sampleRate: number
  readonly state: string
  readonly destination: unknown
  onstatechange: (() => void) | null
  resume(): Promise<void>
  close(): Promise<void>
  audioWorklet?: { addModule(url: string): Promise<void> }
  createScriptProcessor?(bufferSize: number, inputChannels: number, outputChannels: number): ScriptNodeLike
}

export interface AudioBoundary {
  /** Returns null when the browser has no Web Audio at all. */
  createContext(): AudioContextLike | null
  /** URL of the bundled worklet module, or null when the build has none. */
  workletUrl: string | null
  createWorkletNode(context: AudioContextLike, processorName: string): WorkletNodeLike
}

// ── MIDI ──────────────────────────────────────────────────────────────────────

export interface MidiMessageEventLike {
  data: ArrayLike<number> | null
}

export interface MidiInputLike {
  id: string
  name?: string | null
  state?: string
  onmidimessage: ((event: MidiMessageEventLike) => void) | null
}

export interface MidiAccessLike {
  inputs: { forEach(callback: (input: MidiInputLike) => void): void }
  onstatechange: ((event: unknown) => void) | null
}

export interface MidiBoundary {
  /** Null when the browser has no Web MIDI. */
  requestAccess: (() => Promise<MidiAccessLike>) | null
}

// ── Events, timing, storage ───────────────────────────────────────────────────

export type Unsubscribe = () => void

export interface KeyEventLike {
  code: string
  key: string
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  target: unknown
  preventDefault(): void
}

export interface EventsBoundary {
  onKeyDown(handler: (event: KeyEventLike) => void): Unsubscribe
  onKeyUp(handler: (event: KeyEventLike) => void): Unsubscribe
  /** Window lost focus. */
  onBlur(handler: () => void): Unsubscribe
  /** Page became hidden (tab switch, minimise). */
  onHidden(handler: () => void): Unsubscribe
  onResize(handler: () => void): Unsubscribe
  viewport(): { width: number; height: number }
}

export interface TimingBoundary {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface StorageBoundary {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface Platform {
  audio: AudioBoundary
  midi: MidiBoundary
  events: EventsBoundary
  timing: TimingBoundary
  storage: StorageBoundary
}
