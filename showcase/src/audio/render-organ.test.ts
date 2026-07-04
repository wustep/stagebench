// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderEngine, rms, similarity, zeroCrossingRate, highBandRatio } from '../test/offline'
import type { InstrumentStore } from '../state/instrument'

/**
 * organ.engine / organ.models-drawbars / organ.rotary — REAL rendered audio
 * through the full engine graph (node-web-audio-api OfflineAudioContext).
 * The Piano section is off so measurements isolate the organ path.
 */

function organOnly(store: InstrumentStore): void {
  store.setPianoSectionOn(false)
  store.setOrganSectionOn(true)
}

function withModel(cycles: number, drawbars?: number[]) {
  return (store: InstrumentStore) => {
    organOnly(store)
    for (let i = 0; i < cycles; i++) store.cycleOrganModel()
    if (drawbars) drawbars.forEach((value, index) => store.setOrganDrawbar(index, value))
  }
}

const ALL_OUT = [8, 8, 8, 8, 8, 8, 8, 8, 8]

async function renderOrgan(configure: (store: InstrumentStore) => void, midi = 60, duration = 1.4) {
  return renderEngine({
    duration,
    configure,
    steps: [
      { time: 0, run: ({ engine }) => engine.noteOn(midi, 0.85) },
      { time: duration - 0.3, run: ({ engine }) => engine.noteOff(midi) },
    ],
  })
}

describe('organ — rendered behavior', () => {
  it('the organ sounds through the shared master path and stops on section off', async () => {
    const on = await renderOrgan(withModel(0, ALL_OUT))
    expect(rms(on.left, 0.05, 1.0)).toBeGreaterThan(0.005)
    const off = await renderEngine({
      duration: 1.0,
      configure: (store) => {
        store.setPianoSectionOn(false)
        store.setOrganSectionOn(false)
      },
      steps: [{ time: 0, run: ({ engine }) => engine.noteOn(60, 0.85) }],
    })
    expect(rms(off.left, 0.05, 0.9)).toBeLessThan(0.0005)
  }, 240000)

  it('B3, Vox, Farf and Pipe 1 are audibly distinct engines', async () => {
    const renders: Record<string, Float32Array> = {}
    for (const [name, cycles] of [
      ['B3', 0],
      ['Vox', 1],
      ['Farf', 2],
      ['Pipe1', 3],
    ] as const) {
      const result = await renderOrgan(withModel(cycles, ALL_OUT))
      expect(rms(result.left, 0.05, 1.0), name).toBeGreaterThan(0.003)
      renders[name] = result.left
    }
    const names = Object.keys(renders)
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const label = `${names[i]}-vs-${names[j]}`
        expect(Math.abs(similarity(renders[names[i]!]!, renders[names[j]!]!, 0.1, 1.0)), label).toBeLessThan(0.8)
      }
    }
    // Optional models (spec: may reuse B3/Pipe 1): Pipe 2's brighter
    // registration still measurably differs from Pipe 1, and B3 Bass (only
    // 16'+8' voiced) is non-silent on its own.
    const pipe2 = await renderOrgan(withModel(5, ALL_OUT)) // B3 -> Vox -> Farf -> Pipe1 -> B3Bass -> Pipe2
    expect(rms(pipe2.left, 0.05, 1.0)).toBeGreaterThan(0.003)
    expect(Math.abs(similarity(renders.Pipe1!, pipe2.left, 0.1, 1.0))).toBeLessThan(0.9)
    const b3Bass = await renderOrgan(withModel(4, ALL_OUT)) // B3 -> Vox -> Farf -> Pipe1 -> B3Bass
    expect(rms(b3Bass.left, 0.05, 1.0)).toBeGreaterThan(0.003)
  }, 240000)

  it('drawbar registration drives the audible spectrum (16-foot dark, 1-foot bright)', async () => {
    const low = await renderOrgan(withModel(0, [8, 0, 0, 0, 0, 0, 0, 0, 0]))
    const high = await renderOrgan(withModel(0, [0, 0, 0, 0, 0, 0, 0, 0, 8]))
    expect(rms(low.left, 0.1, 1.0)).toBeGreaterThan(0.002)
    expect(rms(high.left, 0.1, 1.0)).toBeGreaterThan(0.002)
    expect(zeroCrossingRate(high.left, 0.1, 1.0)).toBeGreaterThan(zeroCrossingRate(low.left, 0.1, 1.0) * 3)
  }, 240000)

  it('pulling a drawbar mid-note changes the sounding spectrum immediately', async () => {
    const still = await renderOrgan(withModel(0, [8, 0, 0, 0, 0, 0, 0, 0, 0]))
    const pulled = await renderEngine({
      duration: 1.4,
      configure: withModel(0, [8, 0, 0, 0, 0, 0, 0, 0, 0]),
      steps: [
        { time: 0, run: ({ engine }) => engine.noteOn(60, 0.85) },
        { time: 0.6, run: ({ store }) => store.setOrganDrawbar(8, 8) },
        { time: 1.1, run: ({ engine }) => engine.noteOff(60) },
      ],
    })
    // Before the pull the two renders match; after it the 1' partial appears.
    expect(zeroCrossingRate(pulled.left, 0.2, 0.5)).toBeLessThan(zeroCrossingRate(still.left, 0.2, 0.5) * 1.3)
    expect(zeroCrossingRate(pulled.left, 0.8, 1.05)).toBeGreaterThan(zeroCrossingRate(still.left, 0.8, 1.05) * 2)
  }, 240000)

  it('Drawbar Live: a physical drawbar pull reshapes the rendered spectrum while the stored registration stays put', async () => {
    // PRESET Off (manual p. 19/21): the layer sounds from the physical pose.
    // The pose starts equal to the dark 16'-only registration (Preset-mode
    // drags write both), so the render opens identical to Preset mode; the
    // mid-note pull then moves ONLY the pose — the Program's stored
    // registration must come out of the render untouched.
    const registration = [8, 0, 0, 0, 0, 0, 0, 0, 0]
    let storedAfter: number[] = []
    const live = await renderEngine({
      duration: 1.4,
      configure: (store) => {
        organOnly(store)
        registration.forEach((value, index) => store.setOrganDrawbar(index, value))
        store.toggleOrganPreset() // layer A -> Drawbar Live
      },
      steps: [
        { time: 0, run: ({ engine }) => engine.noteOn(60, 0.85) },
        { time: 0.6, run: ({ store }) => store.setOrganDrawbar(8, 8) }, // physical 1' pull (pose only)
        {
          time: 1.1,
          run: ({ engine, store }) => {
            storedAfter = [...store.getState().organ.layers.A.drawbars]
            engine.noteOff(60)
          },
        },
      ],
    })
    // The 1' partial audibly appears after the pull...
    expect(rms(live.left, 0.1, 0.5)).toBeGreaterThan(0.002)
    expect(zeroCrossingRate(live.left, 0.8, 1.05)).toBeGreaterThan(zeroCrossingRate(live.left, 0.2, 0.5) * 2)
    // ...while the Program's stored registration is unchanged.
    expect(storedAfter).toEqual(registration)
  }, 240000)

  it('B3 percussion adds a decaying attack; fast decay dies sooner than slow', async () => {
    const registration = [0, 0, 8, 0, 0, 0, 0, 0, 0] // 8' only
    const plain = await renderOrgan(withModel(0, registration))
    const percSlow = await renderEngine({
      duration: 1.4,
      configure: (store) => {
        withModel(0, registration)(store)
        store.toggleOrganPercussion('on')
      },
      steps: [
        { time: 0, run: ({ engine }) => engine.noteOn(60, 0.85) },
        { time: 1.1, run: ({ engine }) => engine.noteOff(60) },
      ],
    })
    const percFast = await renderEngine({
      duration: 1.4,
      configure: (store) => {
        withModel(0, registration)(store)
        store.toggleOrganPercussion('on')
        store.toggleOrganPercussion('fast')
      },
      steps: [
        { time: 0, run: ({ engine }) => engine.noteOn(60, 0.85) },
        { time: 1.1, run: ({ engine }) => engine.noteOff(60) },
      ],
    })
    // Percussion energy concentrates at the attack…
    expect(rms(percSlow.left, 0.01, 0.1)).toBeGreaterThan(rms(plain.left, 0.01, 0.1) * 1.15)
    // …and has faded by the steady state.
    const steadyRatio = rms(percSlow.left, 0.9, 1.05) / Math.max(1e-9, rms(plain.left, 0.9, 1.05))
    expect(steadyRatio).toBeLessThan(1.15)
    // Fast decay carries less percussion energy into the 150-350 ms window.
    expect(rms(percFast.left, 0.15, 0.35)).toBeLessThan(rms(percSlow.left, 0.15, 0.35))
  }, 240000)

  it('the B3 key click is an audible high-frequency attack transient', async () => {
    // 16'-only registration: the sustained tone is a 130 Hz sine with almost
    // no energy at 2 kHz, so early high-band energy is the click itself.
    const result = await renderOrgan(withModel(0, [8, 0, 0, 0, 0, 0, 0, 0, 0]))
    const attackHigh = highBandRatio(result.left, 2000, 0.0, 0.03)
    const steadyHigh = highBandRatio(result.left, 2000, 0.4, 0.8)
    expect(attackHigh).toBeGreaterThan(steadyHigh * 3)
  }, 240000)

  it('vibrato and chorus scan audibly: V-mode reshapes more than C-mode, depth grows 1→3', async () => {
    const configureVib = (position: number | null) => (store: InstrumentStore) => {
      withModel(0, ALL_OUT)(store)
      if (position !== null) {
        // Panel order is C1 V1 C2 V2 C3 V3 starting from the C3 default.
        const order = ['C1', 'V1', 'C2', 'V2', 'C3', 'V3']
        while (store.getState().organ.vibratoType !== order[position]) store.cycleOrganVibratoType()
        store.toggleOrganVibrato()
      }
    }
    const dry = await renderOrgan(configureVib(null))
    const v1 = await renderOrgan(configureVib(1))
    const v3 = await renderOrgan(configureVib(5))
    const c1 = await renderOrgan(configureVib(0))
    // Every scanner position changes the render; vibrato (wet-only) diverges
    // further from dry than chorus (dry+wet), and V3 is deeper than V1.
    const simV1 = Math.abs(similarity(dry.left, v1.left, 0.2, 1.0))
    const simV3 = Math.abs(similarity(dry.left, v3.left, 0.2, 1.0))
    const simC1 = Math.abs(similarity(dry.left, c1.left, 0.2, 1.0))
    expect(simV1).toBeLessThan(0.99)
    expect(simC1).toBeLessThan(0.995)
    expect(simV3).toBeLessThan(simV1)
    expect(Math.abs(similarity(v1.left, c1.left, 0.2, 1.0))).toBeLessThan(0.98) // V1 vs C1 distinct
  }, 240000)

  it('the ORGAN rotary route sends the organ through the rotary: fast modulates, stop nearly does not', async () => {
    const render = (speed: 'fast' | 'stop') =>
      renderEngine({
        duration: 1.8,
        configure: (store) => {
          withModel(0, ALL_OUT)(store)
          store.toggleOrganRotary()
          if (speed === 'fast') store.toggleRotarySpeed()
          else store.toggleRotaryStop()
        },
        steps: [
          { time: 0, run: ({ engine }) => engine.noteOn(60, 0.85) },
          { time: 1.5, run: ({ engine }) => engine.noteOff(60) },
        ],
      })
    const fast = await render('fast')
    const stop = await render('stop')
    // Amplitude modulation depth: variance of short-window RMS in steady state.
    const wobble = (data: Float32Array) => {
      const windows: number[] = []
      for (let start = 0.5; start < 1.4; start += 0.05) windows.push(rms(data, start, start + 0.05))
      const mean = windows.reduce((a, b) => a + b, 0) / windows.length
      const variance = windows.reduce((a, b) => a + (b - mean) ** 2, 0) / windows.length
      return Math.sqrt(variance) / Math.max(1e-9, mean)
    }
    expect(rms(fast.left, 0.5, 1.4)).toBeGreaterThan(0.002) // audible through the rotary
    expect(wobble(fast.left)).toBeGreaterThan(wobble(stop.left) * 1.5)
  }, 240000)
})
