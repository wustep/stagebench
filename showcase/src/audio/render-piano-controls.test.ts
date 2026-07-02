// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { highBandRatio, renderEngine, rms, zeroCrossingRate, type RenderOptions } from '../test/offline'
import type { InstrumentStore } from '../state/instrument'

/**
 * piano.velocity-controls / piano.pedals — rendered-audio proof that the
 * claimed Piano controls measurably alter REAL audio through the full graph.
 * Uses the Electric set (small) plus Grand where velocity layers matter.
 */

function withElectric(store: InstrumentStore): void {
  store.setFocusedLayer('B')
  store.selectPianoType('Electric')
  store.setFocusedLayer('A')
  store.selectPianoType('Electric')
}

function note(midi: number, velocity: number, on: number, off: number): RenderOptions['steps'] {
  return [
    { time: on, run: ({ engine }) => engine.noteOn(midi, velocity) },
    { time: off, run: ({ engine }) => engine.noteOff(midi) },
  ]
}

describe('piano.velocity-controls — rendered', () => {
  it('velocity moves rendered level in the expected direction', async () => {
    const soft = await renderEngine({ duration: 1, configure: withElectric, steps: note(60, 0.2, 0, 0.7) })
    const hard = await renderEngine({ duration: 1, configure: withElectric, steps: note(60, 0.95, 0, 0.7) })
    expect(rms(hard.left, 0.05, 0.6)).toBeGreaterThan(rms(soft.left, 0.05, 0.6) * 1.5)
  }, 60000)

  it('KB Touch Light renders a mid velocity louder than Heavy', async () => {
    const heavy = await renderEngine({ duration: 1, configure: withElectric, steps: note(60, 0.5, 0, 0.7) })
    const light = await renderEngine({
      duration: 1,
      configure: (store) => {
        withElectric(store)
        store.cycleKbTouch()
        store.cycleKbTouch() // Light
      },
      steps: note(60, 0.5, 0, 0.7),
    })
    expect(rms(light.left, 0.05, 0.6)).toBeGreaterThan(rms(heavy.left, 0.05, 0.6) * 1.1)
  }, 60000)

  it('timbre steps measurably reshape the rendered spectrum (Soft darker, Bright brighter)', async () => {
    // Grand at C6: the 3rd partial (~3.1 kHz) sits in the treble-shelf region.
    const renderTimbre = (steps: number) =>
      renderEngine({
        duration: 1,
        configure: (store) => {
          for (let i = 0; i < steps; i++) store.cycleTimbre()
        },
        steps: note(84, 0.85, 0, 0.7),
      })
    const flat = await renderTimbre(0)
    const soft = await renderTimbre(1)
    const bright = await renderTimbre(3)
    // Piano spectra roll off fast above the shelf corner, so the ratio moves
    // by several percent, not octaves — the assertions prove direction and
    // measurability (Soft < Off < Bright), tolerant across decoders.
    const brightness = (data: Float32Array) => highBandRatio(data, 2800, 0.1, 0.6)
    expect(brightness(bright.left)).toBeGreaterThan(brightness(flat.left) * 1.04)
    expect(brightness(soft.left)).toBeLessThan(brightness(flat.left) * 0.96)
  }, 60000)

  it('dynamic compression raises the level of soft playing (reduced dynamic range)', async () => {
    const off = await renderEngine({ duration: 1, configure: withElectric, steps: note(60, 0.25, 0, 0.7) })
    const comp3 = await renderEngine({
      duration: 1,
      configure: (store) => {
        withElectric(store)
        store.cycleDynComp()
        store.cycleDynComp()
        store.cycleDynComp() // level 3
      },
      steps: note(60, 0.25, 0, 0.7),
    })
    expect(rms(comp3.left, 0.05, 0.6)).toBeGreaterThan(rms(off.left, 0.05, 0.6) * 1.15)
  }, 60000)

  it('unison widens the stereo image measurably', async () => {
    const width = (left: Float32Array, right: Float32Array): number => {
      let diff = 0
      let sum = 0
      for (let i = 0; i < left.length; i++) {
        diff += (left[i]! - right[i]!) ** 2
        sum += (left[i]! + right[i]!) ** 2
      }
      return Math.sqrt(diff / Math.max(1e-12, sum))
    }
    const mono = await renderEngine({ duration: 1, configure: withElectric, steps: note(60, 0.8, 0, 0.7) })
    const wide = await renderEngine({
      duration: 1,
      configure: (store) => {
        withElectric(store)
        store.cycleUnison()
        store.cycleUnison()
        store.cycleUnison() // 3
      },
      steps: note(60, 0.8, 0, 0.7),
    })
    expect(width(wide.left, wide.right)).toBeGreaterThan(width(mono.left, mono.right) * 1.5)
  }, 60000)

  it('master volume scales the rendered output and can silence it', async () => {
    const full = await renderEngine({ duration: 1, configure: withElectric, steps: note(60, 0.8, 0, 0.7) })
    const quiet = await renderEngine({
      duration: 1,
      configure: (store) => {
        withElectric(store)
        store.setMasterVolume(40)
      },
      steps: note(60, 0.8, 0, 0.7),
    })
    const muted = await renderEngine({
      duration: 1,
      configure: (store) => {
        withElectric(store)
        store.setMasterVolume(0)
      },
      steps: note(60, 0.8, 0, 0.7),
    })
    expect(rms(quiet.left, 0.05, 0.6)).toBeLessThan(rms(full.left, 0.05, 0.6) * 0.5)
    expect(rms(muted.left, 0.1, 0.6)).toBeLessThan(0.0005)
  }, 60000)

  it('Panic cuts sounding audio almost immediately', async () => {
    const held = await renderEngine({
      duration: 1.4,
      configure: withElectric,
      steps: [{ time: 0, run: ({ engine }) => engine.noteOn(60, 0.9) }],
    })
    const panicked = await renderEngine({
      duration: 1.4,
      configure: withElectric,
      steps: [
        { time: 0, run: ({ engine }) => engine.noteOn(60, 0.9) },
        { time: 0.6, run: ({ controller }) => controller.panic() },
      ],
    })
    expect(rms(held.left, 0.9, 1.3)).toBeGreaterThan(0.002)
    expect(rms(panicked.left, 0.9, 1.3)).toBeLessThan(rms(held.left, 0.9, 1.3) * 0.2)
  }, 60000)

  it('soft release lengthens the rendered decay after note-off', async () => {
    const normal = await renderEngine({ duration: 1.6, configure: withElectric, steps: note(60, 0.9, 0, 0.5) })
    const softRel = await renderEngine({
      duration: 1.6,
      configure: (store) => {
        withElectric(store)
        store.cycleAcoustics() // Soft Release
      },
      steps: note(60, 0.9, 0, 0.5),
    })
    // Window just after the damper falls: the soft release keeps more energy.
    expect(rms(softRel.left, 0.75, 1.1)).toBeGreaterThan(rms(normal.left, 0.75, 1.1) * 1.1)
  }, 60000)

  it('string resonance adds a measurable pedal-down component when enabled', async () => {
    const steps: RenderOptions['steps'] = [
      { time: 0, run: ({ engine }) => engine.setSustain(1) },
      { time: 0.02, run: ({ engine }) => engine.noteOn(48, 0.9) },
      { time: 0.9, run: ({ engine }) => engine.noteOff(48) },
    ]
    // Isolate the String Res difference: both renders share Soft Release.
    const softRelOnly = await renderEngine({
      duration: 1.4,
      configure: (store) => {
        withElectric(store)
        store.cycleAcoustics() // Soft Release only
      },
      steps,
    })
    const resonant = await renderEngine({
      duration: 1.4,
      configure: (store) => {
        withElectric(store)
        store.cycleAcoustics()
        store.cycleAcoustics() // Soft Rel + String Res
      },
      steps,
    })
    let diff = 0
    let base = 0
    const from = Math.floor(0.1 * 44100)
    const to = Math.floor(0.85 * 44100)
    for (let i = from; i < to; i++) {
      diff += (resonant.left[i]! - softRelOnly.left[i]!) ** 2
      base += softRelOnly.left[i]! ** 2
    }
    expect(Math.sqrt(diff / Math.max(1e-12, base))).toBeGreaterThan(0.02)
  }, 60000)

  it('the pitch stick audibly bends sounding notes (±2 semitones)', async () => {
    const straight = await renderEngine({
      duration: 1.2,
      configure: withElectric,
      steps: [{ time: 0, run: ({ engine }) => engine.noteOn(60, 0.9) }],
    })
    const bent = await renderEngine({
      duration: 1.2,
      configure: withElectric,
      steps: [
        { time: 0, run: ({ engine }) => engine.noteOn(60, 0.9) },
        { time: 0.4, run: ({ controller }) => controller.setPitchBend(2) },
      ],
    })
    const zStraight = zeroCrossingRate(straight.left, 0.7, 1.1)
    const zBent = zeroCrossingRate(bent.left, 0.7, 1.1)
    expect(zBent).toBeGreaterThan(zStraight * 1.05)
  }, 60000)

  it('half-pedal keeps more tail than a plain release but less than full sustain', async () => {
    const render = (pedal: number) =>
      renderEngine({
        duration: 1.6,
        configure: withElectric,
        steps: [
          { time: 0, run: ({ engine }) => engine.setSustain(pedal) },
          { time: 0.02, run: ({ engine }) => engine.noteOn(60, 0.9) },
          { time: 0.4, run: ({ engine }) => engine.noteOff(60) },
        ],
      })
    const up = await render(0)
    const half = await render(0.5)
    const down = await render(1)
    const tail = (r: Awaited<ReturnType<typeof render>>) => rms(r.left, 1.0, 1.5)
    expect(tail(half)).toBeGreaterThan(tail(up) * 1.1)
    expect(tail(down)).toBeGreaterThan(tail(half) * 1.05)
  }, 60000)
})
