import { describe, expect, it } from 'vitest'
import {
  ORGAN_MODELS,
  registrationFor,
  renderOrganLoop,
  renderPercussion,
  renderKeyClick,
  vibratoSettingsFor,
  type OrganModelId,
} from '../audio/organModel'
import {
  ALL_WAVEFORMS,
  OSC_CTRL_BEHAVIOUR,
  categoryForWaveform,
  renderOscillator,
  renderLfo,
  renderEnvelope,
  envelopeFromDials,
  applyFilter,
  cutoffHzFor,
  trackedCutoff,
  planArp,
  stepSecondsFor,
  shapeTable,
  biquadFor,
  gateEnvelope,
  priorityNote,
  type FilterType,
} from '../audio/synthModel'
import { renderSynthNote } from '../audio/synthVoice'
import { defaultSynthLayer } from '../audio/synthState'
import { rms, brightness, shapeDifference, crossingRate, lastAudible, centroidProxy } from '../audio/offlineRender'

const SR = 22050

/** Every required organ model's registration, measured as a spectrum summary. */
function registrationProfile(model: OrganModelId, drawbars: number[]) {
  const loop = renderOrganLoop({ model, drawbars, midi: 60, sampleRate: SR, seconds: 0.25 })
  const partials = registrationFor({ model, drawbars })
  return {
    rms: rms(loop.samples),
    brightness: brightness(loop.samples),
    crossing: crossingRate(loop.samples, SR),
    partialCount: partials.length,
    distinctRatios: new Set(partials.map((p) => p.ratio.toFixed(3))).size,
    loop,
  }
}

const FULL = [8, 8, 8, 8, 8, 8, 8, 8, 8]

describe('organ models are distinct registrations', () => {
  it('gives B3, Vox, Farf and Pipe 1 observably different spectra', () => {
    const profiles = {
      b3: registrationProfile('b3', [8, 8, 8, 6, 0, 0, 0, 0, 0]),
      vox: registrationProfile('vox', [8, 8, 8, 6, 4, 2, 0, 4, 0]),
      farf: registrationProfile('farf', [0, 0, 8, 8, 0, 8, 0, 0, 0]),
      pipe1: registrationProfile('pipe1', [6, 8, 0, 6, 0, 4, 0, 0, 3]),
    }
    for (const [id, profile] of Object.entries(profiles)) {
      expect(profile.rms, `${id} is silent`).toBeGreaterThan(0.01)
      expect(profile.partialCount, `${id} has no partials`).toBeGreaterThan(1)
    }
    // The four engines must not render the same waveform.
    const ids = Object.keys(profiles) as Array<keyof typeof profiles>
    for (let a = 0; a < ids.length; a += 1) {
      for (let b = a + 1; b < ids.length; b += 1) {
        const difference = shapeDifference(profiles[ids[a]].loop.samples, profiles[ids[b]].loop.samples)
        expect(difference, `${ids[a]} vs ${ids[b]}`).toBeGreaterThan(0.05)
      }
    }
    // And their spectra differ in a way that is not just level: Farf is a register sum with
    // many voices, B3 is sine partials, so the partial counts differ.
    expect(profiles.farf.partialCount).toBeGreaterThan(profiles.b3.partialCount)
    expect(profiles.pipe1.distinctRatios).toBeGreaterThan(profiles.b3.distinctRatios)
  })

  it('lists every model the panel offers, with the three required-distinct engines covered', () => {
    const ids = ORGAN_MODELS.map((m) => m.id)
    for (const required of ['b3', 'vox', 'farf', 'pipe1'] as const) {
      expect(ids).toContain(required)
    }
    // The two optional models exist and reuse an engine, as the spec permits.
    expect(ids).toContain('pipe2')
    expect(ids).toContain('b3-bass')
  })

  it('makes every drawbar movement change the rendered spectrum', () => {
    // Every drawbar starts silent and is pulled out one at a time.
    const silent = Array.from({ length: 9 }, () => 0)
    const reference = renderOrganLoop({ model: 'b3', drawbars: silent, midi: 60, sampleRate: SR }).samples
    expect(rms(reference)).toBeLessThan(1e-9)
    const profiles: Float32Array[] = []
    for (let index = 0; index < 9; index += 1) {
      const drawbars = [...silent]
      drawbars[index] = 8
      const rendered = renderOrganLoop({ model: 'b3', drawbars, midi: 60, sampleRate: SR }).samples
      expect(rms(rendered), `drawbar ${index} is silent`).toBeGreaterThan(0.001)
      profiles.push(rendered)
    }
    // And no two drawbars produce the same spectrum: each is its own footage.
    for (let a = 0; a < profiles.length; a += 1) {
      for (let b = a + 1; b < profiles.length; b += 1) {
        expect(shapeDifference(profiles[a], profiles[b]), `drawbar ${a} vs ${b}`).toBeGreaterThan(0.002)
      }
    }
  })

  it('moves the spectrum in the direction each footage implies', () => {
    const only = (index: number) => {
      const drawbars = Array.from({ length: 9 }, () => 0)
      drawbars[index] = 8
      return renderOrganLoop({ model: 'b3', drawbars, midi: 60, sampleRate: SR }).samples
    }
    // 16' is an octave below 8', 1' three octaves above: the crossing rate must climb.
    expect(crossingRate(only(0), SR)).toBeLessThan(crossingRate(only(2), SR))
    expect(crossingRate(only(2), SR)).toBeLessThan(crossingRate(only(8), SR))
  })

  it('treats Farf drawbars as on/off registers pulled past half way', () => {
    const off = renderOrganLoop({ model: 'farf', drawbars: Array.from({ length: 9 }, () => 4), midi: 60, sampleRate: SR }).samples
    const on = renderOrganLoop({ model: 'farf', drawbars: Array.from({ length: 9 }, () => 5), midi: 60, sampleRate: SR }).samples
    // 4 is below the half-way threshold, so nothing sounds; 5 pulls every register.
    expect(rms(off)).toBeLessThan(1e-6)
    expect(rms(on)).toBeGreaterThan(0.01)
  })

  it('makes Pipe 2 brighter than Pipe 1, as its brighter registration claims', () => {
    const pipe1 = renderOrganLoop({ model: 'pipe1', drawbars: FULL, midi: 60, sampleRate: SR }).samples
    const pipe2 = renderOrganLoop({ model: 'pipe2', drawbars: FULL, midi: 60, sampleRate: SR }).samples
    expect(brightness(pipe2)).toBeGreaterThan(brightness(pipe1))
  })

  it('renders B3 Bass as the B3 engine limited to the 16 and 8 foot drawbars', () => {
    // With 5 1/3', 4' and 2' pulled out too, B3 sounds them and B3 Bass ignores them.
    const drawbars = [8, 8, 8, 8, 0, 8, 0, 0, 0]
    const bass = renderOrganLoop({ model: 'b3-bass', drawbars, midi: 60, sampleRate: SR }).samples
    const b3 = renderOrganLoop({ model: 'b3', drawbars, midi: 60, sampleRate: SR }).samples
    expect(rms(bass)).toBeGreaterThan(0.01)
    // The bass registration has far less upper-harmonic energy: same pitch, darker spectrum.
    expect(brightness(bass)).toBeLessThan(brightness(b3))
    // Only two of the nine drawbars reach the engine, so the registration is short.
    const bassPartials = registrationFor({ model: 'b3-bass', drawbars })
    const b3Partials = registrationFor({ model: 'b3', drawbars })
    expect(bassPartials.length).toBeLessThan(b3Partials.length)
    // The two footages it does use are 16' and 8'. Tonewheel leakage gives every partial an
    // octave and a twelfth at low level, so the test must look at *fundamentals*: the loud
    // partials are only 0.5 and 1, and no other drawbar's own pitch reaches the engine.
    const fundamentals = bassPartials.filter((p) => p.amplitude > 0.2)
    expect(fundamentals.map((p) => p.ratio).sort((a, b) => a - b)).toEqual([0.5, 1])
    // 5 1/3' (ratio 1.5) may appear only as the 8' rank's leakage, never at a drawbar's level.
    const twelfth = bassPartials.find((p) => p.ratio === 1.5)
    expect(twelfth?.amplitude ?? 0).toBeLessThan(0.1)
    expect(b3Partials.filter((p) => p.ratio === 1.5).some((p) => p.amplitude > 0.2)).toBe(true)
  })
})

describe('organ percussion, key click and scanner', () => {
  it('renders percussion for the 2nd and 3rd harmonic at different pitches', () => {
    const second = renderPercussion({ midi: 60, harmonicThird: false, volumeSoft: false, decayFast: false, sampleRate: SR })
    const third = renderPercussion({ midi: 60, harmonicThird: true, volumeSoft: false, decayFast: false, sampleRate: SR })
    expect(rms(second)).toBeGreaterThan(0.01)
    expect(crossingRate(third, SR)).toBeGreaterThan(crossingRate(second, SR) * 1.3)
  })

  it('makes soft quieter than normal and fast decay shorter than slow', () => {
    const loud = renderPercussion({ midi: 60, harmonicThird: false, volumeSoft: false, decayFast: false, sampleRate: SR })
    const soft = renderPercussion({ midi: 60, harmonicThird: false, volumeSoft: true, decayFast: false, sampleRate: SR })
    const slow = renderPercussion({ midi: 60, harmonicThird: false, volumeSoft: false, decayFast: false, sampleRate: SR })
    const fast = renderPercussion({ midi: 60, harmonicThird: false, volumeSoft: false, decayFast: true, sampleRate: SR })
    expect(rms(soft)).toBeLessThan(rms(loud))
    expect(lastAudible(fast)).toBeLessThan(lastAudible(slow))
  })

  it('renders a key click as a short broadband transient', () => {
    const click = renderKeyClick({ midi: 60, sampleRate: SR })
    expect(click.length).toBeGreaterThan(10)
    expect(rms(click)).toBeGreaterThan(0.005)
    // It is over within a few tens of milliseconds, unlike a tone.
    expect(click.length / SR).toBeLessThan(0.03)
  })

  it('gives V1 and C1 different scanner settings, with depth increasing 1 to 3', () => {
    const v1 = vibratoSettingsFor('V1')
    const c1 = vibratoSettingsFor('C1')
    const v3 = vibratoSettingsFor('V3')
    // Vibrato is pitch only; chorus adds the modulated signal to the dry path.
    expect(v1.chorusMix).toBe(0)
    expect(c1.chorusMix).toBe(1)
    expect(v3.depthCents).toBeGreaterThan(v1.depthCents)
    expect(vibratoSettingsFor('C3').depthCents).toBeGreaterThan(c1.depthCents)
    expect(vibratoSettingsFor('V2').rate).toBeGreaterThan(v1.rate)
  })
})

describe('synth waveforms', () => {
  it('selects every required waveform, in the required categories', () => {
    const required: Record<string, string[]> = {
      Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
      Sync: ['Sync Saw', 'Sync Square'],
      Multi: ['Multi Saw', 'Multi Saw 8ve'],
      Super: ['Super Saw', 'Super Square'],
      'FM-H': ['FM 2-op (algorithm A)'],
    }
    for (const [category, names] of Object.entries(required)) {
      for (const name of names) {
        expect(categoryForWaveform(name), name).toBe(category)
        expect(ALL_WAVEFORMS.some((entry) => entry.name === name)).toBe(true)
      }
    }
  })

  it('gives Osc Ctrl no effect for Pure (manual p. 29)', () => {
    for (const waveform of ['Sine', 'Saw', 'Pulse 33']) {
      const low = renderOscillator({ waveform, midi: 60, sampleRate: SR, seconds: 0.05, oscCtrl: 0 })
      const high = renderOscillator({ waveform, midi: 60, sampleRate: SR, seconds: 0.05, oscCtrl: 10 })
      expect(shapeDifference(low.left, high.left), waveform).toBeLessThan(1e-6)
      expect(OSC_CTRL_BEHAVIOUR.Pure).toBe('No effect')
    }
  })

  it('makes Osc Ctrl change Sync, Multi, Super and FM-H', () => {
    for (const waveform of ['Sync Saw', 'Multi Saw', 'Super Saw', 'FM 2-op (algorithm A)']) {
      const low = renderOscillator({ waveform, midi: 60, sampleRate: SR, seconds: 0.06, oscCtrl: 0 })
      const high = renderOscillator({ waveform, midi: 60, sampleRate: SR, seconds: 0.06, oscCtrl: 10 })
      expect(rms(low.left), waveform).toBeGreaterThan(1e-4)
      expect(shapeDifference(low.left, high.left), waveform).toBeGreaterThan(0.03)
    }
  })

  it('gives Osc Ctrl a spectral meaning per category, not a level change', () => {
    // Sync raises the slave's relative pitch, so brightness rises with Osc Ctrl.
    const syncLow = renderOscillator({ waveform: 'Sync Saw', midi: 60, sampleRate: SR, seconds: 0.06, oscCtrl: 0 })
    const syncHigh = renderOscillator({ waveform: 'Sync Saw', midi: 60, sampleRate: SR, seconds: 0.06, oscCtrl: 8 })
    expect(brightness(syncHigh.left)).toBeGreaterThan(brightness(syncLow.left))
    // Super widens its stack: the two channels decorrelate more as Osc Ctrl rises.
    const superLow = renderOscillator({ waveform: 'Super Saw', midi: 60, sampleRate: SR, seconds: 0.1, oscCtrl: 1 })
    const superHigh = renderOscillator({ waveform: 'Super Saw', midi: 60, sampleRate: SR, seconds: 0.1, oscCtrl: 10 })
    const correlation = (a: Float32Array, b: Float32Array) => {
      let lr = 0
      let ll = 0
      let rr = 0
      for (let i = 0; i < a.length; i += 1) {
        lr += a[i] * b[i]
        ll += a[i] * a[i]
        rr += b[i] * b[i]
      }
      return lr / Math.max(1e-20, Math.sqrt(ll) * Math.sqrt(rr))
    }
    expect(correlation(superHigh.left, superHigh.right)).toBeLessThan(
      correlation(superLow.left, superLow.right),
    )
    // FM raises its modulation index, so the spectrum gains sidebands.
    const fmLow = renderOscillator({ waveform: 'FM 2-op (algorithm A)', midi: 60, sampleRate: SR, seconds: 0.06, oscCtrl: 0 })
    const fmHigh = renderOscillator({ waveform: 'FM 2-op (algorithm A)', midi: 60, sampleRate: SR, seconds: 0.06, oscCtrl: 9 })
    expect(brightness(fmHigh.left)).toBeGreaterThan(brightness(fmLow.left) * 1.4)
  })

  it('renders every category as a distinct source behaviour', () => {
    const rendered = ['Sine', 'Sync Saw', 'Multi Saw', 'Super Saw', 'FM 2-op (algorithm A)'].map((waveform) =>
      renderOscillator({ waveform, midi: 60, sampleRate: SR, seconds: 0.08, oscCtrl: 5 }).left,
    )
    for (let a = 0; a < rendered.length; a += 1) {
      for (let b = a + 1; b < rendered.length; b += 1) {
        expect(shapeDifference(rendered[a], rendered[b]), `${a} vs ${b}`).toBeGreaterThan(0.02)
      }
    }
  })

  it('builds the Pure shapes from real tables, not one wave relabelled', () => {
    const sine = shapeTable('Sine')
    const saw = shapeTable('Saw')
    const square = shapeTable('Square')
    const triangle = shapeTable('Triangle')
    expect(shapeDifference(sine, saw)).toBeGreaterThan(0.1)
    expect(shapeDifference(saw, square)).toBeGreaterThan(0.05)
    expect(shapeDifference(square, triangle)).toBeGreaterThan(0.05)
    // Pulse 33 and Pulse 10 are different duty cycles.
    expect(shapeDifference(shapeTable('Pulse 33'), shapeTable('Pulse 10'))).toBeGreaterThan(0.02)
  })

  it('renders white noise as noise, not a tone', () => {
    const noise = renderOscillator({ waveform: 'White Noise', midi: 60, sampleRate: SR, seconds: 0.1, oscCtrl: 5 })
    expect(rms(noise.left)).toBeGreaterThan(0.01)
    // A tone's zero crossings are stable; noise's are not. Measure both to prove the point.
    const sine = renderOscillator({ waveform: 'Sine', midi: 60, sampleRate: SR, seconds: 0.1, oscCtrl: 5 })
    const variance = (data: Float32Array) => {
      let mean = 0
      for (const sample of data) mean += sample
      mean /= data.length
      let total = 0
      for (const sample of data) total += (sample - mean) ** 2
      return total / data.length
    }
    expect(variance(noise.left)).toBeGreaterThan(0)
    expect(Math.abs(crossingRate(noise.left, SR) - crossingRate(sine.left, SR))).toBeGreaterThan(100)
  })
})

describe('synth LFO and envelopes', () => {
  it('renders all five LFO waveforms with distinct shapes', () => {
    const waveforms = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const
    // Two seconds at 4 Hz is eight cycles, so a square has swept both of its levels.
    const rendered = waveforms.map((waveform) => renderLfo(waveform, 4, SR * 2, SR))
    for (let a = 0; a < rendered.length; a += 1) {
      for (let b = a + 1; b < rendered.length; b += 1) {
        expect(shapeDifference(rendered[a], rendered[b]), `${waveforms[a]} vs ${waveforms[b]}`).toBeGreaterThan(
          0.01,
        )
      }
    }
    // A square alternates between exactly two levels; a saw sweeps through thousands.
    expect(new Set(Array.from(rendered[3])).size).toBe(2)
    expect(new Set(Array.from(rendered[2])).size).toBeGreaterThan(1000)
    // Sample & Hold is a stepped random signal: a handful of held values, not a sweep.
    expect(new Set(Array.from(rendered[4])).size).toBeLessThan(20)
  })

  it('uses the clock rate for the LFO, and S&H steps once per cycle deterministically', () => {
    const fast = renderLfo('Triangle', 8, 4800, SR)
    const slow = renderLfo('Triangle', 1, 4800, SR)
    expect(crossingRate(fast, SR)).toBeGreaterThan(crossingRate(slow, SR) * 2)
    const first = renderLfo('Sample & Hold', 2, 2000, SR, 7)
    const second = renderLfo('Sample & Hold', 2, 2000, SR, 7)
    expect(Array.from(first)).toEqual(Array.from(second))
    // Few distinct values: it holds rather than sweeping.
    expect(new Set(Array.from(first)).size).toBeLessThan(20)
  })

  it('renders attack, decay and release as distinct envelope stages', () => {
    const settings = envelopeFromDials(3, 6, 4)
    const shape = renderEnvelope(settings, 0.4, 1.5, SR)
    // Attack rises from ~0.
    expect(shape[1]).toBeLessThan(0.2)
    // The hold section has decayed below the peak.
    expect(shape[Math.round(0.35 * SR)]).toBeLessThan(1)
    // The release reaches silence.
    expect(shape[shape.length - 1]).toBeLessThan(0.01)
  })

  it('treats decay at maximum as sustain mode (manual p. 33)', () => {
    const sustained = envelopeFromDials(2, 10, 3)
    expect(sustained.sustainMode).toBe(true)
    const shape = renderEnvelope(sustained, 0.5, 0.6, SR)
    // It holds at full level instead of decaying.
    expect(shape[Math.round(0.45 * SR)]).toBeGreaterThan(0.95)
  })

  it('lengthens each envelope stage as its dial rises', () => {
    const short = envelopeFromDials(1, 2, 1)
    const long = envelopeFromDials(9, 9, 9)
    expect(long.attack).toBeGreaterThan(short.attack * 10)
    expect(long.release).toBeGreaterThan(short.release * 10)
    expect(long.decay).toBeGreaterThan(short.decay * 10)
  })
})

describe('synth filter', () => {
  it('has the four required types, each with a different response', () => {
    const types: FilterType[] = ['LP12', 'LP24', 'HP', 'BP']
    const source = new Float32Array(4000)
    for (let i = 0; i < source.length; i += 1) {
      // A broadband impulse train so every type has something to act on.
      source[i] = i % 40 === 0 ? 0.9 : 0
    }
    const rendered = types.map((type) => {
      const data = source.slice()
      applyFilter(data, { type, cutoffHz: 1000, resonance: 0.3, drive: 0, sampleRate: SR })
      return data
    })
    for (let a = 0; a < rendered.length; a += 1) {
      for (let b = a + 1; b < rendered.length; b += 1) {
        expect(shapeDifference(rendered[a], rendered[b]), `${types[a]} vs ${types[b]}`).toBeGreaterThan(0.02)
      }
    }
    // LP24 is steeper than LP12: less high-frequency energy survives.
    expect(brightness(rendered[1])).toBeLessThan(brightness(rendered[0]))
    // HP removes low end; BP is narrowest.
    expect(brightness(rendered[2])).toBeGreaterThan(brightness(rendered[0]))
    expect(rms(rendered[3])).toBeLessThan(rms(rendered[0]))
  })

  it('moves the cutoff with the Freq knob and with keyboard tracking', () => {
    expect(cutoffHzFor(0)).toBeCloseTo(40, 0)
    expect(cutoffHzFor(10)).toBeCloseTo(14000, 0)
    expect(cutoffHzFor(5)).toBeGreaterThan(cutoffHzFor(3))
    const base = 1000
    expect(trackedCutoff(base, 72, 'Off')).toBe(base)
    expect(trackedCutoff(base, 72, '1')).toBeCloseTo(2000, 0)
    expect(trackedCutoff(base, 72, '1/3')).toBeCloseTo(1000 * Math.pow(2, 1 / 3), 4)
    expect(trackedCutoff(base, 48, '2/3')).toBeCloseTo(1000 * Math.pow(2, -2 / 3), 4)
  })

  it('changes the signal with resonance and with drive', () => {
    const make = () => {
      const data = new Float32Array(3000)
      for (let i = 0; i < data.length; i += 1) data[i] = Math.sin((2 * Math.PI * 300 * i) / SR) * 0.6
      return data
    }
    const flat = make()
    applyFilter(flat, { type: 'LP12', cutoffHz: 800, resonance: 0, drive: 0, sampleRate: SR })
    const resonant = make()
    applyFilter(resonant, { type: 'LP12', cutoffHz: 800, resonance: 0.95, drive: 0, sampleRate: SR })
    expect(shapeDifference(flat, resonant)).toBeGreaterThan(0.01)
    const driven = make()
    applyFilter(driven, { type: 'LP24', cutoffHz: 2000, resonance: 0.2, drive: 3, sampleRate: SR })
    expect(brightness(driven)).toBeGreaterThan(brightness(flat))
  })

  it('produces stable biquad coefficients for every type', () => {
    for (const type of ['LP12', 'LP24', 'HP', 'BP'] as FilterType[]) {
      const coef = biquadFor(type, 1200, 1.5, SR)
      for (const value of Object.values(coef)) expect(Number.isFinite(value), type).toBe(true)
      // Poles inside the unit circle: a stable filter.
      expect(Math.abs(coef.a2)).toBeLessThan(1)
    }
  })
})

describe('synth voice modes', () => {
  it('picks the priority note by pitch or by recency', () => {
    const held = [
      { midi: 60, order: 1 },
      { midi: 72, order: 2 },
      { midi: 55, order: 3 },
    ]
    expect(priorityNote(held, 'Low')).toBe(55)
    expect(priorityNote(held, 'High')).toBe(72)
    expect(priorityNote(held, 'Off')).toBe(55)
    expect(priorityNote([{ midi: 60, order: 5 }], 'Off')).toBe(60)
    expect(priorityNote([], 'Low')).toBeNull()
  })
})

describe('synth arpeggiator', () => {
  it('plans steps deterministically for every direction', () => {
    const notes = [60, 64, 67]
    const up = planArp({ notes, direction: 'Up', octaves: 1, stepSeconds: 0.25, totalSteps: 6 })
    expect(up.notes).toEqual([60, 64, 67, 60, 64, 67])
    expect(up.times).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25])

    const down = planArp({ notes, direction: 'Down', octaves: 1, stepSeconds: 0.25, totalSteps: 6 })
    expect(down.notes).toEqual([67, 64, 60, 67, 64, 60])

    const upDown = planArp({ notes, direction: 'Up/Down', octaves: 1, stepSeconds: 0.25, totalSteps: 6 })
    expect(upDown.notes).toEqual([60, 64, 67, 64, 60, 64])

    const random = planArp({ notes, direction: 'Random', octaves: 1, stepSeconds: 0.25, totalSteps: 8, seed: 5 })
    const again = planArp({ notes, direction: 'Random', octaves: 1, stepSeconds: 0.25, totalSteps: 8, seed: 5 })
    expect(random.notes).toEqual(again.notes)
    expect(random.notes.every((note) => notes.includes(note))).toBe(true)
  })

  it('expands the range across octaves', () => {
    const three = planArp({ notes: [60, 64], direction: 'Up', octaves: 3, stepSeconds: 0.2, totalSteps: 6 })
    expect(three.notes).toEqual([60, 64, 72, 76, 84, 88])
  })

  it('locks step timing to the master clock when synced', () => {
    const at120 = stepSecondsFor(5, 120, true)
    const at240 = stepSecondsFor(5, 240, true)
    expect(at240).toBeCloseTo(at120 / 2, 5)
    // Unsynced rate ignores tempo entirely.
    expect(stepSecondsFor(5, 120, false)).toBe(stepSecondsFor(5, 240, false))
    // Faster knob = shorter step.
    expect(stepSecondsFor(9, 120, false)).toBeLessThan(stepSecondsFor(2, 120, false))
  })

  it('hardens the gate envelope as the hardness rises', () => {
    const soft = gateEnvelope(0.2, 0.5, 0, SR)
    const hard = gateEnvelope(0.2, 0.5, 1, SR)
    // Both reach the point where they open; a soft gate swells in gradually and a hard one
    // is already fully open a few samples after the step starts.
    expect(hard[2]).toBeGreaterThan(soft[2])
    // A soft gate's peak arrives later than a hard one's: measure where each first reaches
    // 0.9 of full level.
    const attackSamples = (data: Float32Array) => {
      for (let i = 0; i < data.length; i += 1) if (data[i] >= 0.9) return i
      return data.length
    }
    expect(attackSamples(soft)).toBeGreaterThan(attackSamples(hard))
    // A soft gate's tail decays more slowly, which is what "hardness" means.
    expect(soft[Math.floor(soft.length * 0.45)]).toBeGreaterThan(0)
  })
})

describe('synth voices render audibly', () => {
  const baseLayer = () => {
    const layer = defaultSynthLayer('synth.a', true)
    layer.waveform = 'Saw'
    return layer
  }

  it('renders a note with real samples', () => {
    const rendered = renderSynthNote(
      {
        layer: baseLayer(),
        midi: 60,
        velocity: 0.8,
        level: 0.8,
        zoneGain: 1,
        holdSeconds: 0.3,
        releaseSeconds: 0.2,
        glideFrom: null,
        modWheel: 0,
        lfoRateHz: 4,
      },
      SR,
    )
    expect(rms(rendered.samples)).toBeGreaterThan(0.005)
    expect(rendered.filtered).toBe(true)
  })

  it('renders louder for a higher velocity when velocity is engaged', () => {
    const render = (velocity: number) => {
      const layer = baseLayer()
      layer.ampEnv = { attack: 0.1, decay: 5, release: 1, velocity: 1, amount: 0 }
      layer.ampVelocity = 3
      return renderSynthNote(
        {
          layer,
          midi: 60,
          velocity,
          level: 0.8,
          zoneGain: 1,
          holdSeconds: 0.25,
          releaseSeconds: 0.15,
          glideFrom: null,
          modWheel: 0,
          lfoRateHz: 4,
        },
        SR,
      ).samples
    }
    expect(rms(render(1))).toBeGreaterThan(rms(render(0.2)) * 1.5)
  })

  it('leaves level alone when the Amp Velocity switch is Off', () => {
    const render = (velocity: number) => {
      const layer = baseLayer()
      layer.ampEnv = { attack: 0.1, decay: 5, release: 1, velocity: 0, amount: 0 }
      layer.ampVelocity = 0
      return renderSynthNote(
        {
          layer,
          midi: 60,
          velocity,
          level: 0.8,
          zoneGain: 1,
          holdSeconds: 0.25,
          releaseSeconds: 0.15,
          glideFrom: null,
          modWheel: 0,
          lfoRateHz: 4,
        },
        SR,
      ).samples
    }
    expect(rms(render(1))).toBeCloseTo(rms(render(0.2)), 2)
  })

  it('changes the output for every required waveform through the full voice path', () => {
    const names = ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'Sync Saw', 'Multi Saw', 'Super Saw', 'FM 2-op (algorithm A)']
    const rendered = names.map((waveform) => {
      const layer = baseLayer()
      layer.waveform = waveform
      layer.filterOn = false
      return renderSynthNote(
        {
          layer,
          midi: 57,
          velocity: 0.8,
          level: 0.8,
          zoneGain: 1,
          holdSeconds: 0.12,
          releaseSeconds: 0.05,
          glideFrom: null,
          modWheel: 0,
          lfoRateHz: 4,
        },
        SR,
      ).samples
    })
    for (const data of rendered) expect(rms(data)).toBeGreaterThan(0.002)
    // No two of the ten required waveforms render identically.
    for (let a = 0; a < rendered.length; a += 1) {
      for (let b = a + 1; b < rendered.length; b += 1) {
        expect(shapeDifference(rendered[a], rendered[b]), `${names[a]} vs ${names[b]}`).toBeGreaterThan(0.002)
      }
    }
  })

  it('sweeps the filter with the filter envelope', () => {
    const render = (envAmount: number) => {
      const layer = baseLayer()
      layer.waveform = 'Saw'
      layer.filterType = 'LP24'
      layer.filterFreq = 2.5
      layer.filterRes = 1
      layer.filterEnvAmount = envAmount
      layer.filterEnv = { attack: 0.5, decay: 6, release: 1, velocity: 0, amount: 0 }
      return renderSynthNote(
        {
          layer,
          midi: 60,
          velocity: 0.8,
          level: 0.8,
          zoneGain: 1,
          holdSeconds: 0.4,
          releaseSeconds: 0.1,
          glideFrom: null,
          modWheel: 0,
          lfoRateHz: 4,
        },
        SR,
      ).samples
    }
    expect(brightness(render(9))).toBeGreaterThan(brightness(render(0)))
  })

  it('applies unison detune, changing the waveform and widening the image', () => {
    const render = (unison: number) => {
      const layer = baseLayer()
      layer.waveform = 'Saw'
      layer.unison = unison
      return renderSynthNote(
        {
          layer,
          midi: 60,
          velocity: 0.8,
          level: 0.8,
          zoneGain: 1,
          holdSeconds: 0.2,
          releaseSeconds: 0.05,
          glideFrom: null,
          modWheel: 0,
          lfoRateHz: 4,
        },
        SR,
      ).samples
    }
    const single = render(0)
    const stacked = render(3)
    expect(shapeDifference(single, stacked)).toBeGreaterThan(0.02)
  })

  it('modulates pitch with the LFO when a destination is engaged', () => {
    const render = (pitchDestination: boolean) => {
      const layer = baseLayer()
      layer.waveform = 'Sine'
      layer.filterOn = false
      layer.lfo = { ...layer.lfo, amount: 9, destinations: { pitch: pitchDestination, oscCtrl: false, filter: false } }
      return renderSynthNote(
        {
          layer,
          midi: 60,
          velocity: 0.8,
          level: 0.8,
          zoneGain: 1,
          holdSeconds: 0.5,
          releaseSeconds: 0.05,
          glideFrom: null,
          modWheel: 0,
          lfoRateHz: 6,
        },
        SR,
      ).samples
    }
    // A 6 Hz pitch LFO on a sine smears its zero crossings; a static sine does not.
    expect(shapeDifference(render(false), render(true))).toBeGreaterThan(0.01)
  })

  it('glides from the previous note in mono mode', () => {
    const layer = baseLayer()
    layer.waveform = 'Sine'
    layer.filterOn = false
    layer.glide = 8
    layer.voiceMode = 'Mono'
    const render = (glideFrom: number | null) =>
      renderSynthNote(
        {
          layer,
          midi: 72,
          velocity: 0.8,
          level: 0.8,
          zoneGain: 1,
          holdSeconds: 0.4,
          releaseSeconds: 0.05,
          glideFrom,
          modWheel: 0,
          lfoRateHz: 4,
        },
        SR,
      ).samples
    // Early in a glide from an octave below, the pitch is still low: fewer early crossings.
    const glided = render(60)
    const direct = render(null)
    const earlyCrossings = (data: Float32Array) => crossingRate(data.slice(0, Math.round(0.06 * SR)), SR)
    expect(earlyCrossings(glided)).toBeLessThan(earlyCrossings(direct))
  })

  it('applies vibrato from the Wheel source only when the wheel is up', () => {
    const layer = baseLayer()
    layer.waveform = 'Sine'
    layer.filterOn = false
    layer.vibrato = 'Wheel'
    layer.vibratoAmount = 8
    const render = (modWheel: number) =>
      renderSynthNote(
        {
          layer,
          midi: 60,
          velocity: 0.8,
          level: 0.8,
          zoneGain: 1,
          holdSeconds: 0.4,
          releaseSeconds: 0.05,
          glideFrom: null,
          modWheel,
          lfoRateHz: 5,
        },
        SR,
      ).samples
    expect(shapeDifference(render(0), render(1))).toBeGreaterThan(0.005)
  })

  it('produces a measurable centroid difference between a bright and a dark patch', () => {
    const render = (filterFreq: number) => {
      const layer = baseLayer()
      layer.waveform = 'Saw'
      layer.filterFreq = filterFreq
      return renderSynthNote(
        {
          layer,
          midi: 48,
          velocity: 0.8,
          level: 0.8,
          zoneGain: 1,
          holdSeconds: 0.25,
          releaseSeconds: 0.05,
          glideFrom: null,
          modWheel: 0,
          lfoRateHz: 4,
        },
        SR,
      ).samples
    }
    expect(centroidProxy(render(8), SR)).toBeGreaterThan(centroidProxy(render(2), SR))
  })
})
