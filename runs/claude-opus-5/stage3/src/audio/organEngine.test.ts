import { describe, expect, it } from 'vitest'
import { engineRig, settingsWith } from '../test/engineRig'
import { bandEnergy, peak, relativeDifference, rms } from './offline'
import {
  B3_RATIOS,
  activeDrawbarIndexes,
  drawbarGain,
  farfRegisterOn,
  organVoiceShape,
  percussionShape,
  vibChorusShape,
  type OrganModelId,
} from './organVoice'
import type { EngineSettings } from './settings'

/**
 * Organ engine, asserted on rendered audio from the deterministic offline renderer.
 *
 * Features: organ.models, organ.drawbars, organ.percussion, organ.vibrato-chorus,
 * organ.rotary, organ.layers
 */

function organSettings(patch: Record<string, unknown> = {}): EngineSettings {
  return settingsWith({
    sectionOn: false,
    layers: { a: { enabled: false }, b: { enabled: false } },
    organ: {
      sectionOn: true,
      layers: { a: { enabled: true, level: 0.8 }, b: { enabled: false } },
      toRotary: false,
      ...patch,
    },
  })
}

function renderOrgan(settings: EngineSettings, midi = 60, seconds = 0.5): Float32Array {
  const rig = engineRig({ settings })
  rig.engine.noteOn('test', midi, 0.8)
  return rig.graph.render(seconds)
}

const MODELS: readonly OrganModelId[] = ['b3', 'vox', 'farf', 'pipe1']

describe('organ tone generation', () => {
  it('gives every model its own partial recipe rather than one renamed oscillator', () => {
    const drawbars = [8, 8, 8, 8, 8, 8, 8, 8, 8]
    const shapes = MODELS.map((model) => organVoiceShape(model, drawbars, 261.63))
    const fingerprints = shapes.map((shape) =>
      shape.partials.map((partial) => `${partial.type}@${partial.ratio.toFixed(3)}`).join('|'),
    )
    expect(new Set(fingerprints).size).toBe(MODELS.length)

    // B3 is pure sines with a key click; the transistor models are not; Pipe has a chiff.
    expect(shapes[0].partials.every((partial) => partial.type === 'sine')).toBe(true)
    expect(shapes[0].click).toBeGreaterThan(0)
    expect(shapes[1].partials.some((partial) => partial.type === 'sawtooth')).toBe(true)
    expect(shapes[2].partials.some((partial) => partial.type === 'square')).toBe(true)
    expect(shapes[3].chiff).toBeGreaterThan(0)
    expect(shapes[3].attack).toBeGreaterThan(shapes[0].attack)
  })

  it('follows the printed B3 footages and the documented reuse models', () => {
    expect(B3_RATIOS).toEqual([0.5, 1.5, 1, 2, 3, 4, 5, 6, 8])
    // B3 Bass is the B3 engine limited to 16' and 8' (organ spec, models[].engine).
    expect(activeDrawbarIndexes('b3bass')).toEqual([0, 2])
    const bass = organVoiceShape('b3bass', [8, 8, 8, 8, 8, 8, 8, 8, 8], 130)
    expect(bass.partials.map((partial) => partial.ratio).sort()).toEqual([0.5, 1])
    // Pipe 2 reuses Pipe 1 with a brighter principal registration.
    const pipe1 = organVoiceShape('pipe1', [8, 8, 8, 8, 8, 8, 8, 8, 8], 261)
    const pipe2 = organVoiceShape('pipe2', [8, 8, 8, 8, 8, 8, 8, 8, 8], 261)
    const top = (shape: typeof pipe1) => shape.partials[shape.partials.length - 1].gain
    expect(top(pipe2)).toBeGreaterThan(top(pipe1))
  })

  it('makes a drawbar a real level: 0 is silent, 8 is full, and steps taper', () => {
    expect(drawbarGain(0)).toBe(0)
    expect(drawbarGain(8)).toBeCloseTo(1, 6)
    expect(drawbarGain(4)).toBeLessThan(drawbarGain(6))
    // A Farfisa register switches on past half travel.
    expect(farfRegisterOn(4)).toBe(false)
    expect(farfRegisterOn(5)).toBe(true)
  })

  it('gives B3, Vox, Farf and Pipe 1 audibly distinct rendered output', () => {
    const drawbars = [8, 6, 8, 6, 5, 5, 4, 3, 6]
    const rendered = MODELS.map((model) => renderOrgan(organSettings({ layers: { a: { model, drawbars } } })))
    for (const audio of rendered) expect(peak(audio)).toBeGreaterThan(0.001)
    for (let i = 0; i < rendered.length; i += 1) {
      for (let j = i + 1; j < rendered.length; j += 1) {
        expect(
          relativeDifference(rendered[i], rendered[j]),
          `${MODELS[i]} vs ${MODELS[j]} must differ`,
        ).toBeGreaterThan(0.2)
      }
    }
    // With one 8' rank drawn, the B3 tonewheel is a near-pure sine while the Farfisa reed is a
    // square: the harmonic content above the fundamental separates them by an order of magnitude.
    const harmonics = (audio: Float32Array) => bandEnergy(audio, 16000, 650, 2200)
    const b3Eight = renderOrgan(organSettings({ layers: { a: { model: 'b3', drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0] } } }))
    const farfOboe = renderOrgan(organSettings({ layers: { a: { model: 'farf', drawbars: [0, 0, 0, 8, 0, 0, 0, 0, 0] } } }))
    expect(harmonics(farfOboe)).toBeGreaterThan(harmonics(b3Eight) * 3)
    const upper = (audio: Float32Array) => bandEnergy(audio, 16000, 1500, 6000)
    expect(upper(rendered[1])).toBeGreaterThan(upper(rendered[0]))
  })

  it('changes the audible spectrum when a drawbar moves', () => {
    const base = [8, 0, 8, 0, 0, 0, 0, 0, 0]
    const withUpper = [8, 0, 8, 0, 0, 0, 0, 0, 8]
    const quiet = renderOrgan(organSettings({ layers: { a: { drawbars: base } } }))
    const bright = renderOrgan(organSettings({ layers: { a: { drawbars: withUpper } } }))
    const band = (audio: Float32Array) => bandEnergy(audio, 16000, 1800, 4000)
    expect(band(bright)).toBeGreaterThan(band(quiet) * 2)

    // Pulling every drawbar in leaves only the key click, which is a transient, not a tone.
    const silent = renderOrgan(organSettings({ layers: { a: { drawbars: Array.from({ length: 9 }, () => 0) } } }))
    expect(rms(silent)).toBeLessThan(rms(quiet) * 0.3)
  })

  it('adds a measurable percussion attack that is single triggered', () => {
    expect(percussionShape({ on: false, soft: false, fast: true, third: true })).toBeNull()
    const soft = percussionShape({ on: true, soft: true, fast: true, third: true })!
    const loud = percussionShape({ on: true, soft: false, fast: false, third: false })!
    expect(loud.gain).toBeGreaterThan(soft.gain)
    expect(loud.decay).toBeGreaterThan(soft.decay)
    expect(loud.ratio).toBe(2)
    expect(soft.ratio).toBe(3)

    const drawbars = [8, 0, 8, 0, 0, 0, 0, 0, 0]
    const plain = renderOrgan(organSettings({ layers: { a: { drawbars } } }), 60, 0.4)
    const percussive = renderOrgan(
      organSettings({
        layers: { a: { drawbars, percussion: { on: true, soft: false, fast: false, third: false } } },
      }),
      60,
      0.4,
    )
    expect(relativeDifference(plain, percussive)).toBeGreaterThan(0.05)
    expect(peak(percussive)).toBeGreaterThan(peak(plain))

    // Single triggered: a second key held down while the first is still sounding gets no
    // percussion of its own.
    const rig = engineRig({ settings: organSettings({ layers: { a: { drawbars, percussion: { on: true, soft: false, fast: false, third: false } } } }) })
    rig.engine.noteOn('first', 60, 0.8)
    rig.engine.noteOn('second', 67, 0.8)
    const both = rig.graph.render(0.4)
    rig.engine.panic()
    rig.engine.noteOn('lonely', 67, 0.8)
    const alone = rig.graph.render(0.4)
    expect(peak(alone)).toBeGreaterThan(0)
    expect(relativeDifference(both, alone)).toBeGreaterThan(0.1)
  })

  it('separates vibrato from chorus and deepens across 1-2-3', () => {
    expect(vibChorusShape('v1').dryMix).toBe(0)
    expect(vibChorusShape('c1').dryMix).toBeGreaterThan(0)
    expect(vibChorusShape('v3').depth).toBeGreaterThan(vibChorusShape('v1').depth)
    expect(vibChorusShape('c3').depth).toBeGreaterThan(vibChorusShape('c1').depth)

    const drawbars = [8, 0, 8, 0, 0, 0, 0, 0, 0]
    const dry = renderOrgan(organSettings({ layers: { a: { drawbars, vibratoOn: false } } }), 60, 0.6)
    const v1 = renderOrgan(
      organSettings({ vibChorus: 'v1', layers: { a: { drawbars, vibratoOn: true } } }),
      60,
      0.6,
    )
    const c1 = renderOrgan(
      organSettings({ vibChorus: 'c1', layers: { a: { drawbars, vibratoOn: true } } }),
      60,
      0.6,
    )
    expect(relativeDifference(dry, v1)).toBeGreaterThan(0.02)
    expect(relativeDifference(v1, c1)).toBeGreaterThan(0.02)
  })

  it('routes the organ into the shared rotary and accelerates between speeds', () => {
    const drawbars = [8, 0, 8, 0, 0, 0, 0, 0, 0]
    const dry = renderOrgan(organSettings({ layers: { a: { drawbars } }, toRotary: false }), 60, 0.6)
    const routed = renderOrgan(organSettings({ layers: { a: { drawbars } }, toRotary: true }), 60, 0.6)
    expect(relativeDifference(dry, routed)).toBeGreaterThan(0.1)

    const rig = engineRig({
      settings: settingsWith(
        { rotary: { speed: 'slow' } },
        organSettings({ layers: { a: { drawbars } }, toRotary: true }),
      ),
    })
    expect(rig.engine.rotary.hornRateHz).toBeCloseTo(0.8, 3)
    rig.engine.applySettings(
      settingsWith({ rotary: { speed: 'fast' } }, organSettings({ layers: { a: { drawbars } }, toRotary: true })),
    )
    expect(rig.engine.rotary.hornRateHz).toBeCloseTo(6.6, 3)
    // Stop Mode parks the rotors instead of running them slowly.
    rig.engine.applySettings(
      settingsWith(
        { rotary: { speed: 'slow', stopMode: true } },
        organSettings({ layers: { a: { drawbars } }, toRotary: true }),
      ),
    )
    expect(rig.engine.rotary.hornRateHz).toBe(0)
  })

  it('runs both organ layers through one shared effect chain and one output', () => {
    const drawbars = [8, 0, 8, 0, 0, 0, 0, 0, 0]
    const settings = organSettings({
      layers: {
        a: { enabled: true, level: 0.7, drawbars },
        b: { enabled: true, level: 0.7, octave: 12, drawbars },
      },
    })
    const rig = engineRig({ settings })
    const section = rig.engine.organ
    // One chain, one output: the layers meet before the effects, not after.
    expect(section.chain).toBe(rig.engine.organ.chain)
    rig.engine.noteOn('test', 60, 0.8)
    const both = rig.graph.render(0.4)
    const single = renderOrgan(organSettings({ layers: { a: { drawbars } } }), 60, 0.4)
    expect(relativeDifference(single, both)).toBeGreaterThan(0.1)
  })

  it('runs a full two-layer note lifecycle and returns every count to baseline', () => {
    const drawbars = [8, 8, 8, 0, 0, 0, 0, 0, 0]
    const rig = engineRig({
      settings: organSettings({
        layers: {
          a: { enabled: true, level: 0.8, drawbars },
          b: { enabled: true, level: 0.8, octave: 12, drawbars },
        },
      }),
    })
    // The layer's own chain is built on first use and then stays; the baseline for voice
    // cleanup is the steady state after one note has come and gone.
    rig.engine.noteOn('warm', 55, 0.8)
    rig.engine.noteOff('warm')
    rig.graph.render(1.5)
    rig.scheduler.advance(2000)
    const baseline = rig.graph.liveNodeCount

    rig.engine.noteOn('one', 60, 0.8)
    rig.engine.noteOn('two', 64, 0.8)
    // Two keys across two enabled layers: one voice each, four in all.
    expect(rig.engine.activeVoiceCount).toBe(4)
    expect(rig.engine.soundingNotes()).toEqual([60, 64])
    expect(rig.graph.liveNodeCount).toBeGreaterThan(baseline)
    expect(peak(rig.graph.render(0.25))).toBeGreaterThan(0)

    // A repeated note-on for a key that is already held does not stack more voices.
    rig.engine.noteOn('one', 60, 0.8)
    expect(rig.engine.activeVoiceCount).toBe(4)

    rig.engine.noteOff('one')
    rig.engine.noteOff('two')
    rig.graph.render(1.5)
    rig.scheduler.advance(2000)
    expect(rig.engine.activeVoiceCount).toBe(0)
    expect(rig.graph.liveNodeCount).toBe(baseline)
  })

  it('gives each organ layer its own level and its own keyboard zone', () => {
    const drawbars = [8, 8, 8, 0, 0, 0, 0, 0, 0]
    const atLevel = (level: number): EngineSettings =>
      organSettings({ layers: { a: { enabled: true, level, drawbars }, b: { enabled: false } } })
    expect(rms(renderOrgan(atLevel(0.9), 60, 0.3))).toBeGreaterThan(rms(renderOrgan(atLevel(0.25), 60, 0.3)))

    // A note outside a layer's keyboard zone builds no voice for that layer at all.
    const zoned = settingsWith(
      {
        zones: {
          'organ.a': { low: 0, high: 59, fadeLow: 0, fadeHigh: 0 },
          'organ.b': { low: 60, high: 127, fadeLow: 0, fadeHigh: 0 },
        },
      },
      organSettings({
        layers: {
          a: { enabled: true, level: 0.8, drawbars },
          b: { enabled: true, level: 0.8, octave: 12, drawbars },
        },
      }),
    )
    const low = engineRig({ settings: zoned })
    low.engine.noteOn('low', 48, 0.8)
    expect(low.engine.activeVoiceCount).toBe(1)
    const high = engineRig({ settings: zoned })
    high.engine.noteOn('high', 72, 0.8)
    expect(high.engine.activeVoiceCount).toBe(1)
    expect(peak(low.graph.render(0.3))).toBeGreaterThan(0)
    expect(peak(high.graph.render(0.3))).toBeGreaterThan(0)
  })

  it('cleans up every organ node when the engine is disposed', () => {
    const drawbars = [8, 8, 8, 8, 8, 8, 8, 8, 8]
    const rig = engineRig({ settings: organSettings({ layers: { a: { drawbars } } }) })
    const baseline = rig.graph.liveNodeCount
    rig.engine.noteOn('test', 60, 0.8)
    expect(rig.graph.liveNodeCount).toBeGreaterThan(baseline)
    rig.engine.dispose()
    expect(rig.engine.activeVoiceCount).toBe(0)
  })
})
