import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OfflineAudioContext } from 'node-web-audio-api'
import { createInstrument, type Instrument } from '../audio/instrument'
import type { AudioContextLike } from '../audio/types'
import { createEngineStore, defaultState, type EngineState, type EngineStore } from '../engine/state'
import { FakeEventTarget, FakeScheduler } from './fakes'

/**
 * Renders the REAL engine on a real Web Audio implementation (node-web-audio-api's OfflineAudioContext), decoding the
 * bundled recordings from public/samples. No audio device, no network; deterministic enough for tolerant assertions.
 */
export const SAMPLE_RATE = 44100

/** an OfflineAudioContext that looks like a running realtime context to the engine */
function asRunningContext(ctx: OfflineAudioContext): AudioContextLike {
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'state') return 'running'
      if (prop === 'resume' || prop === 'close') return async () => undefined
      if (prop === 'onstatechange') return null
      const value = (target as unknown as Record<string | symbol, unknown>)[prop]
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, prop, value) {
      if (prop === 'onstatechange') return true
      ;(target as unknown as Record<string | symbol, unknown>)[prop] = value
      return true
    },
  }) as unknown as AudioContextLike
}

export interface Rendered {
  left: Float32Array
  right: Float32Array
  sampleRate: number
  /** mono mix */
  mono: Float32Array
}

export class SkippedEventsError extends Error {}

export interface OfflineRig {
  instrument: Instrument
  state: EngineStore
  scheduler: FakeScheduler
  ctx: OfflineAudioContext
  /** ask for the audio context and wait until every model needed by the enabled layers is decoded */
  ready(): Promise<void>
  /** run `events` at their times and render `seconds` of audio */
  render(seconds: number, events?: Array<{ at: number; run: () => void }>): Promise<Rendered>
  dispose(): void
}

export interface RigOptions {
  seconds?: number
  /** starting state; defaults to the engine defaults */
  state?: EngineState
  /** replaces the on-disk sample loader (to simulate missing assets) */
  loader?: (url: string) => Promise<ArrayBuffer>
}

const loadFromDisk = async (url: string): Promise<ArrayBuffer> => {
  const bytes = readFileSync(resolve(process.cwd(), 'public', url))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function createOfflineRig(opts: RigOptions = {}): OfflineRig {
  const seconds = opts.seconds ?? 3
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE)
  const adapted = asRunningContext(ctx)
  const scheduler = new FakeScheduler()
  const state = createEngineStore(opts.state ?? defaultState())
  let created = 0
  const instrument = createInstrument(
    {
      createAudioContext: () => {
        created++
        if (created > 1) throw new Error('the engine asked for a second AudioContext')
        return adapted
      },
      scheduler,
      loadSample: opts.loader ?? loadFromDisk,
      midi: null,
      keyTarget: new FakeEventTarget(),
      pageWindow: new FakeEventTarget(),
      pageDocument: new FakeEventTarget() as unknown as Parameters<typeof createInstrument>[0]['pageDocument'],
    },
    state,
  )
  return {
    instrument,
    state,
    scheduler,
    ctx,
    async ready() {
      instrument.wake()
      for (let i = 0; i < 400; i++) {
        const phase = instrument.getSnapshot().audio.phase
        if (phase === 'ready' || phase === 'fallback' || phase === 'error') return
        await new Promise((r) => setTimeout(r, 25))
      }
      throw new Error(`audio never became ready: ${instrument.getSnapshot().audio.message}`)
    },
    async render(secs, events = []) {
      const total = Math.ceil(secs * SAMPLE_RATE)
      if (total !== ctx.length) throw new Error(`render(${secs}) must match the rig length ${ctx.length / SAMPLE_RATE}`)
      let executed = 0
      let late = 0
      const at0 = events.filter((e) => e.at <= 0)
      for (const e of at0) {
        e.run()
        executed++
      }
      for (const e of events.filter((x) => x.at > 0).sort((a, b) => a.at - b.at)) {
        void ctx.suspend(e.at).then(() => {
          executed++
          if (ctx.currentTime - e.at > 0.05) late++
          e.run()
          void ctx.resume()
        })
      }
      const buffer = await ctx.startRendering()
      // the suspend callbacks are delivered through the event loop; give any straggler a moment, then insist on all of them
      for (let i = 0; i < 20 && executed < events.length; i++) await new Promise((r) => setTimeout(r, 5))
      if (executed < events.length || late > 0) throw new SkippedEventsError(`${events.length - executed} scheduled event(s) did not run, ${late} ran late`)
      const left = buffer.getChannelData(0).slice()
      const right = buffer.getChannelData(1).slice()
      const mono = new Float32Array(left.length)
      for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (left[i] + right[i])
      return { left, right, mono, sampleRate: SAMPLE_RATE }
    },
    dispose() {
      instrument.dispose()
    },
  }
}

/**
 * One call: build a rig with `edit` applied to the default state, wait for the samples, play `notes`, render.
 * `notes` are [source, midiNote, velocity, atSeconds, releaseAtSeconds?].
 */
export interface NoteEvent {
  note: number
  velocity?: number
  at?: number
  /** seconds at which the key is released; omit to hold to the end */
  off?: number
}

export async function renderNotes(
  seconds: number,
  notes: NoteEvent[],
  edit: (s: EngineState) => EngineState = (s) => s,
  extra: (rig: OfflineRig) => Array<{ at: number; run: () => void }> = () => [],
  loader?: RigOptions['loader'],
): Promise<Rendered & { rig: OfflineRig }> {
  // A render whose scheduled events were dropped by the event loop under heavy machine load is simply repeated.
  for (let attempt = 1; ; attempt++) {
    const rig = createOfflineRig({ seconds, state: edit(defaultState()), loader })
    try {
      await rig.ready()
      const events: Array<{ at: number; run: () => void }> = []
      notes.forEach((n, i) => {
        const src = `t${i}`
        events.push({ at: n.at ?? 0, run: () => void rig.instrument.lifecycle.noteOn(src, n.note, n.velocity ?? 100) })
        if (n.off !== undefined) events.push({ at: n.off, run: () => rig.instrument.lifecycle.noteOff(src) })
      })
      events.push(...extra(rig))
      const out = await rig.render(seconds, events)
      return { ...out, rig }
    } catch (error) {
      rig.dispose()
      if (!(error instanceof SkippedEventsError) || attempt >= 4) throw error
    }
  }
}
