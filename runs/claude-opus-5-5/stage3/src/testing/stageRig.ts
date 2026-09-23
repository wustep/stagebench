// Test rig for the engine: the real piano library (bundled packs read from public/), the real
// StageAudio graph (all sections) and LayeredEngine, rendered by the Web Audio simulator (tests only).
import { LayeredEngine } from '../audio/layeredEngine'
import { PianoLibrary } from '../audio/library'
import { StageAudio } from '../audio/stageAudio'
import { synthLayerParams } from '../audio/synthParams'
import { HIGHEST_NOTE, LOWEST_NOTE } from '../model/keys'
import { defaultSound, SLOTS, type SlotId, type SoundState } from '../model/sound'
import { readPublicAsset } from './fakes'
import { SimAudioContext } from './simAudio'

export interface StageRig {
  ctx: SimAudioContext
  stage: StageAudio
  engine: LayeredEngine
  library: PianoLibrary
  sound: () => SoundState
  set: (update: (s: SoundState) => SoundState) => void
  /** Play a note for `hold` seconds, then render `tail` more seconds; returns mono output. */
  play: (note: number, velocity?: number, hold?: number, tail?: number) => Float32Array
  /** Play several notes together. */
  chord: (notes: number[], velocity?: number, hold?: number, tail?: number) => Float32Array
  render: (seconds: number) => Float32Array
  /** Render in 5 ms chunks, advancing the arpeggiators at every chunk. */
  renderTicking: (seconds: number) => Float32Array
}

const PIANO_ONLY: SlotId[] = ['A', 'B']

export async function makeStageRig(
  options: { failAssets?: string[]; sound?: (s: SoundState) => SoundState; maxZoneSeconds?: number; slots?: 'piano' | 'all'; sampleRate?: number; loadPiano?: boolean } = {},
): Promise<StageRig> {
  const ctx = new SimAudioContext(options.sampleRate ?? 16000)
  const library = new PianoLibrary({
    fetchAsset: (p) => (options.failAssets?.includes(p) ? Promise.reject(new Error(`asset ${p} unavailable`)) : Promise.resolve(readPublicAsset(p))),
    toneOptions: { sampleRate: 8000, durationScale: 0.12 },
    lowNote: LOWEST_NOTE,
    highNote: HIGHEST_NOTE,
    yieldToEventLoop: () => Promise.resolve(),
    maxZoneSeconds: options.maxZoneSeconds ?? 0.8,
  })
  if (options.slots !== 'all' || options.loadPiano) await library.load()
  const stage = new StageAudio({ createContext: () => ctx, library, irScale: 0.1 })
  let sound = options.sound ? options.sound(defaultSound()) : defaultSound()
  const slots = options.slots === 'all' ? SLOTS : PIANO_ONLY
  const factories = Object.fromEntries(slots.map((s) => [s, stage.voices(s)]))
  const engine = new LayeredEngine(factories, sound, (l, d) => stage.setLayerSustain(l, d), {
    synthParams: (slot, s) => synthLayerParams(slot, s, 0),
    now: () => ctx.currentTime,
    onGate: (slot, t, step) => stage.gateStep(slot, t, step),
  })
  stage.apply(sound)
  stage.unlock()
  const set = (update: (s: SoundState) => SoundState) => {
    sound = update(sound)
    stage.apply(sound)
    engine.setSound(sound)
  }
  const render = (seconds: number) => ctx.render(seconds)
  const join = (a: Float32Array, b: Float32Array) => {
    const out = new Float32Array(a.length + b.length)
    out.set(a)
    out.set(b, a.length)
    return out
  }
  const renderTicking = (seconds: number) => {
    let out = new Float32Array(0)
    const chunk = 0.005
    let left = seconds
    while (left > 1e-9) {
      engine.tick(ctx.currentTime)
      const d = Math.min(chunk, left)
      out = join(out, ctx.render(d))
      left -= d
    }
    return out
  }
  const chord = (notes: number[], velocity = 100, hold = 0.3, tail = 0.1) => {
    for (const n of notes) engine.noteOn(n, velocity, 'test')
    const a = ctx.render(hold)
    for (const n of notes) engine.noteOff(n, 'test')
    return join(a, ctx.render(tail))
  }
  const play = (note: number, velocity = 100, hold = 0.3, tail = 0.1) => chord([note], velocity, hold, tail)
  return { ctx, stage, engine, library, sound: () => sound, set, play, chord, render, renderTicking }
}
