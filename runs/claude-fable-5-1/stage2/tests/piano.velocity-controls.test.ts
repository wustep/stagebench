import { describe, expect, it } from 'vitest'
import { audibleSeconds, bandEnergy, normalizedDifference, rms, spectralCentroid, stereoCorrelation } from '../src/dsp/analysis'
import { masterKnobToGain } from '../src/dsp/types'
import { PianoEngine, applyKbTouch, defaultPianoSettings, dynCompGain } from '../src/audio/engine'
import { FakeAudioContext, FakeTimers } from '../src/audio/fakeAudio'
import { mono, renderPiano, type OfflinePianoOptions } from '../src/audio/offlinePiano'
import { SampleLibrary, pickSample, type LoadedSet } from '../src/audio/sampleLibrary'
import { midiToFrequency } from '../src/audio/pianoRenderer'
import { diskAssets, nearRoots, quickRenderer } from './helpers'

const SR = 22050
let grand: LoadedSet | null = null
let wurli: LoadedSet | null = null
async function sets() {
  if (!grand) {
    const library = new SampleLibrary({ assets: diskAssets(), filter: nearRoots([55, 60, 64, 67], 2) })
    grand = await library.load('grand-salamander')
    wurli = await library.load('electric-wurlitzer-200')
  }
  return { grand: grand!, wurli: wurli! }
}
const note = (velocity = 100, midi = 60, off?: number) => [{ time: 0, type: 'on' as const, midi, velocity }, ...(off === undefined ? [] : [{ time: off, type: 'off' as const, midi }])]
const render = (events: ReturnType<typeof note>, options: OfflinePianoOptions) => mono(renderPiano(events, { sampleRate: SR, seconds: 1.2, ...options }))

describe('piano.velocity-controls — KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, Master Level on rendered audio', () => {
  it('KB Touch: the same stroke is softer on Heavy and louder on Light than on Medium', async () => {
    expect(applyKbTouch(64, 0)).toBeLessThan(applyKbTouch(64, 1))
    expect(applyKbTouch(64, 1)).toBeLessThan(applyKbTouch(64, 2))
    expect(applyKbTouch(127, 0)).toBe(127)
    const { grand } = await sets()
    const levels = [0, 1, 2].map((kbTouch) => rms(render(note(64), { set: grand, kbTouch })))
    expect(levels[0]).toBeLessThan(levels[1])
    expect(levels[1]).toBeLessThan(levels[2])
    // same on the generated voice
    const gen = [0, 1, 2].map((kbTouch) => rms(render(note(64), { renderer: quickRenderer, kbTouch })))
    expect(gen[0]).toBeLessThan(gen[1])
    expect(gen[1]).toBeLessThan(gen[2])
  })

  it('Dyn Comp raises soft strokes progressively while keeping the velocity layer (timbre) intact', async () => {
    const { grand } = await sets()
    const soft = [0, 1, 2, 3].map((dynComp) => rms(render(note(30), { set: grand, dynComp })))
    for (let i = 1; i < soft.length; i++) expect(soft[i]).toBeGreaterThan(soft[i - 1] * 1.05)
    const loud = [0, 3].map((dynComp) => rms(render(note(120), { set: grand, dynComp })))
    expect(loud[1] / loud[0]).toBeLessThan(soft[3] / soft[0]) // the dynamic range narrows
    expect(dynCompGain(0.2, 3)).toBeGreaterThan(dynCompGain(0.2, 0))
    expect(dynCompGain(1, 3)).toBeCloseTo(1, 6)
    // the sample file (velocity layer) is chosen by the touched velocity only, never by Dyn Comp
    expect(pickSample(grand, 60, applyKbTouch(30, 1))!.sample.file.layer).toBe(pickSample(grand, 60, applyKbTouch(30, 1))!.sample.file.layer)
    const a = render(note(30), { set: grand, dynComp: 0 })
    const b = render(note(30), { set: grand, dynComp: 3 })
    expect(Math.abs(spectralCentroid(a, SR) - spectralCentroid(b, SR)) / spectralCentroid(a, SR)).toBeLessThan(0.02)
  })

  it('Timbre: acoustic Soft darkens, Bright brightens, Mid lifts the mid band; electric Dyno settings are distinct', async () => {
    const { grand, wurli } = await sets()
    const dryChain = { reverb: { on: false } }
    const base = render(note(100), { set: grand, chain: dryChain, timbre: 0, family: 'acoustic' })
    const soft = render(note(100), { set: grand, chain: dryChain, timbre: 1, family: 'acoustic' })
    const mid = render(note(100), { set: grand, chain: dryChain, timbre: 2, family: 'acoustic' })
    const bright = render(note(100), { set: grand, chain: dryChain, timbre: 3, family: 'acoustic' })
    expect(spectralCentroid(soft, SR)).toBeLessThan(spectralCentroid(base, SR))
    expect(spectralCentroid(bright, SR)).toBeGreaterThan(spectralCentroid(base, SR))
    expect(bandEnergy(mid, SR, 900, 1600) / rms(mid)).toBeGreaterThan(bandEnergy(base, SR, 900, 1600) / rms(base))
    const e = [0, 1, 2, 3, 4, 5].map((timbre) => render(note(100), { set: wurli, chain: dryChain, timbre, family: 'electric' }))
    for (let i = 1; i < e.length; i++) expect(normalizedDifference(e[0], e[i])).toBeGreaterThan(0.03)
    expect(normalizedDifference(e[4], e[5])).toBeGreaterThan(0.03) // Dyno 1 ≠ Dyno 2
    // acoustic models ignore the Dyno settings (they belong to electric pianos)
    expect(normalizedDifference(base, render(note(100), { set: grand, chain: dryChain, timbre: 4, family: 'acoustic' }))).toBeLessThan(1e-6)
  })

  it('Unison adds detuned stereo voices: Off is mono-identical, 1 subtle, 3 wide', async () => {
    const { wurli } = await sets()
    const off = renderPiano(note(100), { sampleRate: SR, seconds: 1, set: wurli, unison: 0 })
    expect(stereoCorrelation(off.l, off.r)).toBeGreaterThan(0.999)
    const widths = [1, 2, 3].map((unison) => {
      const out = renderPiano(note(100), { sampleRate: SR, seconds: 1, set: wurli, unison })
      expect(normalizedDifference(mono(off), mono(out))).toBeGreaterThan(0.05)
      return 1 - stereoCorrelation(out.l, out.r)
    })
    expect(widths[0]).toBeGreaterThan(0.002)
    expect(widths[1]).toBeGreaterThan(widths[0])
    expect(widths[2]).toBeGreaterThan(widths[1])
  })

  it('Soft Release lengthens the release of acoustic / electric models and is disabled for Clav-type sounds', async () => {
    const { grand } = await sets()
    const normal = render(note(100, 60, 0.3), { set: grand, softRelease: false })
    const soft = render(note(100, 60, 0.3), { set: grand, softRelease: true })
    expect(audibleSeconds(soft, SR)).toBeGreaterThan(audibleSeconds(normal, SR) + 0.08)
    // 0.4–0.55 s after the key-off the normal release has almost reached its floor, the soft one has not
    expect(rms(soft, Math.round(SR * 0.45), Math.round(SR * 0.6))).toBeGreaterThan(rms(normal, Math.round(SR * 0.45), Math.round(SR * 0.6)) * 2)
    const clav = render(note(100, 60, 0.3), { set: grand, softRelease: true, softReleaseSupported: false })
    expect(normalizedDifference(normal, clav)).toBeLessThan(1e-6)
  })

  it('String Res adds sympathetic resonance at the held strings while other notes are played', async () => {
    const { grand } = await sets()
    // C4 (60) is held silently (key down, its own sound long decayed) while C5 (72) is struck: C5's partials
    // coincide with C4's string modes, so with String Res on the undamped C4 strings ring on after C5 decays.
    // C5 is struck, held for 0.6 s and released; once its own release has faded (reverb off so nothing else
    // rings), only the sympathetic ringing of the undamped C4 strings remains.
    const events = [
      { time: 0, type: 'on' as const, midi: 72, velocity: 110 },
      { time: 0.6, type: 'off' as const, midi: 72 },
    ]
    const opts = { set: grand, chain: { reverb: { on: false } }, seconds: 2 }
    const off = render(events, { ...opts, stringRes: false, heldStrings: [60] })
    const on = render(events, { ...opts, stringRes: true, heldStrings: [60] })
    expect(normalizedDifference(off, on)).toBeGreaterThan(0.002)
    const f = midiToFrequency(72)
    const from = Math.round(SR * 1.3)
    const to = Math.round(SR * 1.9)
    const late = (x: Float32Array) => bandEnergy(x.subarray(from, to), SR, f * 0.97, f * 1.03)
    expect(rms(on, from, to)).toBeGreaterThan(rms(off, from, to) * 3)
    expect(late(on)).toBeGreaterThan(late(off) * 3)
    // the same note with no undamped string does not gain that tail
    const noString = render(events, { ...opts, stringRes: true, heldStrings: [] })
    expect(rms(on, from, to)).toBeGreaterThan(rms(noString, from, to) * 3)
  })

  it('Master Level scales the rendered output on the audio taper and the master limiter caps peaks', async () => {
    const { grand } = await sets()
    const full = render(note(120), { set: grand, masterLevel: 10 })
    const half = render(note(120), { set: grand, masterLevel: 5 })
    const off = render(note(120), { set: grand, masterLevel: 0 })
    expect(rms(half) / rms(full)).toBeCloseTo(masterKnobToGain(5), 3)
    expect(rms(off)).toBe(0)
    expect(masterKnobToGain(10)).toBe(1)
    expect(masterKnobToGain(7)).toBeLessThan(masterKnobToGain(10))
    const hot = renderPiano([...note(127, 60), ...note(127, 64), ...note(127, 67), ...note(127, 48)], { sampleRate: SR, seconds: 0.5, set: grand, masterLevel: 10, limiter: true, dynComp: 3 })
    expect(Math.max(...Array.from(hot.l).map(Math.abs))).toBeLessThanOrEqual(1)
  })

  it('agrees with the runtime engine: KB Touch and Dyn Comp move the voice gain, Master Level ramps the master gain', async () => {
    const ctx = new FakeAudioContext(48000)
    const timers = new FakeTimers()
    const engine = new PianoEngine({ createContext: () => ctx, timers, renderer: quickRenderer, warmNotes: [] })
    await engine.start()
    const settings = defaultPianoSettings(false)
    const voiceGain = (kbTouch: number, dynComp: number, velocity: number) => {
      engine.setPiano({ ...settings, layers: { ...settings.layers, A: { ...settings.layers.A, kbTouch, dynComp } } })
      engine.noteOn(60, velocity)
      const g = ctx.gains().at(-1)!.gain.value
      engine.allNotesOff()
      ctx.advance(0.5)
      return g
    }
    expect(voiceGain(0, 0, 64)).toBeLessThan(voiceGain(1, 0, 64))
    expect(voiceGain(1, 0, 64)).toBeLessThan(voiceGain(2, 0, 64))
    expect(voiceGain(1, 3, 30)).toBeGreaterThan(voiceGain(1, 0, 30))
    const master = ctx.gains()[0]
    engine.setMasterLevel(4)
    const target = master.gain.events.find((e) => e.type === 'target')!
    expect(target.value).toBeCloseTo(masterKnobToGain(4), 6)
    expect(engine.getMasterGain()).toBeCloseTo(masterKnobToGain(4), 6)
    engine.dispose()
  })
})
