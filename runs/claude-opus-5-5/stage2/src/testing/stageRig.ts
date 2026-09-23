// Test rig for the Phase 2 engine: the real piano library (bundled packs read from public/),
// the real StageAudio graph and LayeredEngine, rendered by the Web Audio simulator (tests only).
import { LayeredEngine } from '../audio/layeredEngine'
import { PianoLibrary } from '../audio/library'
import { StageAudio } from '../audio/stageAudio'
import { HIGHEST_NOTE, LOWEST_NOTE } from '../model/keys'
import { defaultSound, type SoundState } from '../model/sound'
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
  render: (seconds: number) => Float32Array
}

export async function makeStageRig(options: { failAssets?: string[]; sound?: (s: SoundState) => SoundState; maxZoneSeconds?: number } = {}): Promise<StageRig> {
  const ctx = new SimAudioContext(16000)
  const library = new PianoLibrary({
    fetchAsset: (p) => (options.failAssets?.includes(p) ? Promise.reject(new Error(`asset ${p} unavailable`)) : Promise.resolve(readPublicAsset(p))),
    toneOptions: { sampleRate: 8000, durationScale: 0.12 },
    lowNote: LOWEST_NOTE,
    highNote: HIGHEST_NOTE,
    yieldToEventLoop: () => Promise.resolve(),
    maxZoneSeconds: options.maxZoneSeconds ?? 0.8,
  })
  await library.load()
  const stage = new StageAudio({ createContext: () => ctx, library, irScale: 0.1 })
  let sound = options.sound ? options.sound(defaultSound()) : defaultSound()
  const engine = new LayeredEngine({ A: stage.voices('A'), B: stage.voices('B') }, sound, (l, d) => stage.setLayerSustain(l, d))
  stage.apply(sound)
  stage.unlock()
  const set = (update: (s: SoundState) => SoundState) => {
    sound = update(sound)
    stage.apply(sound)
    engine.setSound(sound)
  }
  const render = (seconds: number) => ctx.render(seconds)
  const play = (note: number, velocity = 100, hold = 0.3, tail = 0.1) => {
    engine.noteOn(note, velocity, 'test')
    const a = ctx.render(hold)
    engine.noteOff(note, 'test')
    const b = ctx.render(tail)
    const out = new Float32Array(a.length + b.length)
    out.set(a)
    out.set(b, a.length)
    return out
  }
  return { ctx, stage, engine, library, sound: () => sound, set, play, render }
}
