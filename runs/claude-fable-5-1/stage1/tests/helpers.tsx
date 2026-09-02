import { render, type RenderResult } from '@testing-library/react'
import { act } from 'react'
import App from '../src/App'
import type { Boundaries, MidiAccessLike, MidiInputLike } from '../src/audio/boundaries'
import type { PianoEngineOptions } from '../src/audio/engine'
import { FakeAudioContext, FakeTimers } from '../src/audio/fakeAudio'
import { midiToFrequency, velocityGain, type PianoRenderParams } from '../src/audio/pianoRenderer'
import type { Services } from '../src/ui/createServices'

/**
 * Cheap deterministic renderer for lifecycle tests: a 2 s decaying sine at the requested sample rate,
 * loudness following the same velocity curve (the real DSP is covered by the audio-signal tests).
 */
export function quickRenderer(params: PianoRenderParams): Float32Array {
  const seconds = Math.min(params.maxSeconds ?? 2, 2)
  const length = Math.round(seconds * params.sampleRate)
  const out = new Float32Array(length)
  const w = (2 * Math.PI * midiToFrequency(params.midi)) / params.sampleRate
  const level = 0.5 * velocityGain(params.velocity)
  for (let i = 0; i < length; i++) out[i] = level * Math.sin(w * i) * Math.exp(-i / (params.sampleRate * 0.8))
  return out
}

export class FakeMidiInput implements MidiInputLike {
  onmidimessage: ((event: { data: Uint8Array | null }) => void) | null = null
  state: 'connected' | 'disconnected' = 'connected'
  type = 'input' as const
  constructor(public id: string, public name: string) {}
  send(bytes: number[]) {
    this.onmidimessage?.({ data: new Uint8Array(bytes) })
  }
}

export class FakeMidiAccess implements MidiAccessLike {
  inputs = new Map<string, MidiInputLike>()
  onstatechange: ((event: { port: MidiInputLike | null }) => void) | null = null
  addInput(input: FakeMidiInput) {
    this.inputs.set(input.id, input)
    this.onstatechange?.({ port: input })
  }
  disconnect(input: FakeMidiInput) {
    input.state = 'disconnected'
    this.onstatechange?.({ port: input })
  }
}

export interface FakeWorld {
  boundaries: Boundaries
  ctx: FakeAudioContext
  timers: FakeTimers
  access: FakeMidiAccess
  input: FakeMidiInput
  contexts: FakeAudioContext[]
}

export function makeWorld(options: { midi?: 'granted' | 'denied' | 'unsupported' | 'error' | 'no-inputs'; audio?: 'ok' | 'unavailable' } = {}): FakeWorld {
  const timers = new FakeTimers()
  const access = new FakeMidiAccess()
  const input = new FakeMidiInput('in-1', 'Fake Keys')
  if (options.midi !== 'no-inputs') access.inputs.set(input.id, input)
  const contexts: FakeAudioContext[] = []
  const ctx = new FakeAudioContext(48000)
  const midiMode = options.midi ?? 'granted'
  const boundaries: Boundaries = {
    createAudioContext: () => {
      if (options.audio === 'unavailable') throw new Error('Web Audio is not available')
      const c = contexts.length === 0 ? ctx : new FakeAudioContext(48000)
      contexts.push(c)
      return c
    },
    timers,
    midi:
      midiMode === 'unsupported'
        ? {}
        : {
            requestAccess: () => {
              if (midiMode === 'denied') return Promise.reject(Object.assign(new Error('Permission denied'), { name: 'SecurityError' }))
              if (midiMode === 'error') return Promise.reject(new Error('MIDI subsystem failure'))
              return Promise.resolve(access)
            },
          },
    windowTarget: window,
  }
  return { boundaries, ctx, timers, access, input, contexts }
}

export const engineOptions: Partial<PianoEngineOptions> = { renderer: quickRenderer, warmNotes: [60, 64] }

export interface Mounted extends RenderResult {
  services: Services
  world: FakeWorld
}

export async function mountApp(options: Parameters<typeof makeWorld>[0] & { midiConnect?: boolean } = {}): Promise<Mounted> {
  const world = makeWorld(options)
  let services: Services | null = null
  const result = render(<App boundaries={world.boundaries} engineOptions={engineOptions} midi={options.midiConnect ?? true} onServices={(s) => (services = s)} />)
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  if (!services) throw new Error('services were not provided')
  return { ...result, services, world }
}

export async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

export function keyEl(midi: number): HTMLElement {
  const el = document.getElementById(`key-${midi}`)
  if (!el) throw new Error(`key-${midi} missing`)
  return el
}
