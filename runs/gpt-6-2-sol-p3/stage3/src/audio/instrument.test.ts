// @vitest-environment node
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it, vi } from 'vitest'
import { PianoRack } from '../piano/sound'
import { initialSettings } from '../piano/settings'
import type { Settings } from '../piano/settings'
import { categories, synthPeriod, waves } from '../instrument/parameters'
import { editSplit, switchScene } from '../instrument/programs'
import type { Voice } from '../piano/notes'
import { arpeggioStep, priorityKey } from './synthChannel'
import type { Scheduler } from './synthChannel'

const rate = 24000
type Signal = [Float32Array, Float32Array]
type Edit = (state: Settings) => void
const seconds = 0.72

function rms(data: Float32Array, from = 0.09, to = 0.39) {
  const values = data.subarray(Math.round(from * rate), Math.round(to * rate))
  return Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length)
}

function distance(a: Float32Array, b: Float32Array, from = 0.09, to = 0.39) {
  return rms(a.map((sample, index) => sample - b[index]), from, to)
}

function projection(data: Float32Array, hz: number, from: number, to: number) {
  const values = data.subarray(Math.round(from * rate), Math.round(to * rate))
  let dx = 0
  let dy = 0
  for (let i = 0; i < values.length; i++) {
    const phase = i * 2 * Math.PI * hz / rate
    const value = values[i] * (0.5 - 0.5 * Math.cos(i * 2 * Math.PI / values.length))
    dx += value * Math.cos(phase)
    dy += value * Math.sin(phase)
  }
  return Math.hypot(dx, dy) / values.length
}

interface Session {
  play(note?: number, velocity?: number): Voice | undefined
  at(time: number): void
  configure(state: Settings): void
}

async function render(state: Settings, track: (session: Session) => void = ({ play }) => { play() }): Promise<Signal> {
  const engine = new OfflineAudioContext(2, Math.round(seconds * rate), rate)
  let clock = 0.022
  const rack = new PianoRack(engine as unknown as BaseAudioContext, () => clock)
  rack.configure(state)
  track({
    play: (note = 60, velocity = 104) => rack.play(note, velocity, () => {}),
    at: (time) => { clock = time },
    configure: (patch) => rack.configure(patch),
  })
  try {
    const buffer = await engine.startRendering()
    return [Float32Array.from(buffer.getChannelData(0)), Float32Array.from(buffer.getChannelData(1))]
  } finally {
    rack.dispose()
  }
}

function organ(edit?: Edit) {
  const state = initialSettings()
  state.on = false
  state.organ.on = true
  state.organ.layers.A.level = 12
  state.organ.layers.A.vibrato = false
  edit?.(state)
  return state
}

function synth(edit?: Edit) {
  const state = initialSettings()
  state.on = false
  state.synth.on = true
  Object.assign(state.synth.layers.A, { category: 'Pure', wave: 2 })
  state.synth.layers.A.filter.on = false
  edit?.(state)
  return state
}

async function organSignal(edit?: Edit, sequence?: (session: Session) => void) {
  return (await render(organ(edit), sequence))[0]
}

async function synthSignal(edit?: Edit, sequence?: (session: Session) => void) {
  return (await render(synth(edit), sequence))[0]
}

describe('generated organ through the instrument rack', () => {
  it('renders six registrations and responds to all nine B3 drawbars', async () => {
    const signals: Float32Array[] = []
    for (const model of ['B3', 'Vox', 'Farf', 'Pipe 1', 'B3 Bass', 'Pipe 2'] as const) {
      const signal = await organSignal((s) => { s.organ.layers.A.model = model })
      expect(rms(signal), model).toBeGreaterThan(0.004)
      for (const previous of signals) expect(distance(previous, signal), model).toBeGreaterThan(0.0025)
      signals.push(signal)
    }
    const noDrawbars = await organSignal((s) => { s.organ.layers.A.drawbars.fill(0) })
    expect(rms(noDrawbars)).toBeLessThan(0.00001)
    for (const [index, multiple] of [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8].entries()) {
      const voice = await organSignal((s) => {
        s.organ.layers.A.drawbars.fill(0)
        s.organ.layers.A.drawbars[index] = 8
      })
      expect(projection(voice, 261.626 * multiple, 0.1, 0.35), `drawbar ${index + 1}`).toBeGreaterThan(0.0007)
    }
  }, 15000)

  it('renders the key click, single-trigger percussion controls, and distinct chorus depths', async () => {
    const dryClick = await organSignal((s) => { s.organ.layers.A.drawbars.fill(0) })
    expect(rms(dryClick, 0.025, 0.039)).toBeGreaterThan(0.00005)
    expect(rms(dryClick, 0.08, 0.14)).toBeLessThan(0.00001)
    const perc = (patch: Partial<Settings['organ']['layers']['A']['percussion']>) => organSignal((s) => {
      s.organ.layers.A.drawbars.fill(0)
      Object.assign(s.organ.layers.A.percussion, { on: true }, patch)
    })
    const hit = await perc({})
    expect(rms(hit, 0.07, 0.15)).toBeGreaterThan(rms(await perc({ soft: true }), 0.07, 0.15) * 1.7)
    expect(rms(hit, 0.16, 0.28)).toBeGreaterThan(rms(await perc({ fast: true }), 0.16, 0.28) * 2)
    const third = await perc({ third: true })
    expect(projection(third, 784.88, 0.08, 0.16)).toBeGreaterThan(projection(third, 523.25, 0.08, 0.16) * 5)
    const overlap = await organSignal((s) => {
      s.organ.layers.A.drawbars.fill(0)
      s.organ.layers.A.percussion = { on: true, soft: false, fast: true, third: true }
    }, ({ at, play }) => {
      const first = play(60)!
      at(0.15); const second = play(67)!
      at(0.24); first.keyUp?.(false); second.keyUp?.(false)
      at(0.38); play(67)
    })
    expect(projection(overlap, 1176, 0.17, 0.23)).toBeLessThan(0.0004)
    expect(projection(overlap, 1176, 0.41, 0.48)).toBeGreaterThan(0.001)
    const chorus = async (choice: 'C1' | 'V1' | 'V3') => organSignal((s) => {
      s.organ.layers.A.vibrato = true
      s.organ.layers.A.chorus = choice
    })
    const v1 = await chorus('V1')
    expect(distance(v1, await chorus('C1'))).toBeGreaterThan(0.001)
    expect(distance(v1, await chorus('V3'))).toBeGreaterThan(0.001)
  }, 15000)

  it('uses the shared Organ chain, distinct layer levels, and accelerating Rotary with stop and drive', async () => {
    const dry = await organSignal()
    const b = await organSignal((s) => {
      s.organ.layers.A.on = false
      Object.assign(s.organ.layers.B, { on: true, model: 'Pipe 1', octave: 1, level: 12 })
    })
    expect(distance(dry, b)).toBeGreaterThan(0.005)
    const dryBoth = await organSignal((s) => { s.organ.layers.B.on = true })
    const wetBoth = await organSignal((s) => {
      s.organ.layers.B.on = true
      Object.assign(s.organ.chain.delay, { on: true, mix: 10, bpm: 150, feedback: 0 })
    })
    expect(rms(dryBoth, 0.09, 0.27)).toBeGreaterThan(0.007)
    expect(rms(wetBoth, 0.09, 0.27)).toBeLessThan(0.00001)
    expect(rms(wetBoth, 0.49, 0.67)).toBeGreaterThan(0.007)
    const rotary = (fast: boolean, stop: boolean, drive: number, routed = true) => organ((s) => {
      Object.assign(s.effects.rotary, { on: true, fast, stop, drive, organ: routed })
    })
    const [slow, right] = await render(rotary(false, false, 0))
    expect(distance(slow, right)).toBeGreaterThan(0.001)
    expect(distance(slow, (await render(rotary(true, false, 0)))[0])).toBeGreaterThan(0.002)
    expect(distance(slow, (await render(rotary(false, true, 0)))[0])).toBeGreaterThan(0.001)
    expect(distance(slow, (await render(rotary(false, false, 10)))[0])).toBeGreaterThan(0.003)
    expect(distance(dry, (await render(rotary(true, false, 5, false)))[0])).toBeLessThan(0.00001)

    const slowState = rotary(false, false, 0)
    slowState.morph.wheel['effects.rotary.fast'] = 1
    const engine = new OfflineAudioContext(2, Math.round(seconds * rate), rate)
    const native = engine as unknown as BaseAudioContext
    const ramps: number[][] = []
    const context = new Proxy(native, {
      get(target, key) {
        if (key === 'createOscillator') return () => {
          const osc = target.createOscillator()
          const targetAt = osc.frequency.setTargetAtTime.bind(osc.frequency)
          osc.frequency.setTargetAtTime = (value, start, tau) => {
            ramps.push([value, start, tau])
            return targetAt(value, start, tau)
          }
          return osc
        }
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    let time = 0.02
    const rack = new PianoRack(context, () => time)
    rack.configure(slowState)
    rack.play(60, 104, () => {})
    time = 0.25
    rack.configure({ ...slowState, performance: { wheel: 1, pedal: 0 } })
    expect(ramps).toEqual(expect.arrayContaining([[6.65, time, 0.23], [5.5, time, 0.62]]))
    time = 0.4
    rack.configure({ ...slowState, effects: { ...slowState.effects, rotary: { ...slowState.effects.rotary, stop: true } } })
    expect(ramps).toEqual(expect.arrayContaining([[0, time, 0.23], [0, time, 0.62]]))
    rack.dispose()
  }, 15000)
})

describe('generated synthesizer through the instrument rack', () => {
  it('renders every specified waveform and applies Osc Ctrl by category', async () => {
    const listen = (category: typeof categories[number], wave: number, control: number) => synthSignal((s) => {
      Object.assign(s.synth.layers.A, { category, wave, control })
    })
    const rendered: Float32Array[] = []
    for (const category of categories) for (const [index, title] of waves[category].entries()) {
      const signal = await listen(category, index, 5)
      expect(rms(signal), title).toBeGreaterThan(0.008)
      for (const other of rendered) expect(distance(other, signal), title).toBeGreaterThan(0.0014)
      rendered.push(signal)
    }
    expect(distance(await listen('Pure', 2, 0), await listen('Pure', 2, 10))).toBeLessThan(0.000002)
    for (const category of ['Sync', 'Multi', 'Super', 'FM-H'] as const) {
      expect(distance(await listen(category, 0, 1), await listen(category, 0, 9)), category).toBeGreaterThan(0.006)
    }
  }, 20000)

  it('renders four filters, tracking, resonance and drive with observable envelope behavior', async () => {
    const filtered = (type: Settings['synth']['layers']['A']['filter']['type'], patch = {}) => synthSignal((s) => {
      Object.assign(s.synth.layers.A.filter, { on: true, type, frequency: 6 }, patch)
    }, ({ play }) => { play(72) })
    const responses: Float32Array[] = []
    for (const type of ['LP12', 'LP24', 'HP', 'BP'] as const) {
      const result = await filtered(type)
      expect(rms(result)).toBeGreaterThan(0.004)
      for (const other of responses) expect(distance(other, result)).toBeGreaterThan(0.0025)
      responses.push(result)
    }
    const [lp] = responses
    for (const change of [{ tracking: 3 }, { resonance: 10 }, { drive: 3 }, { frequency: 3 }, { amount: 0, decay: 10 }]) {
      expect(distance(lp, await filtered('LP12', change)), JSON.stringify(change)).toBeGreaterThan(0.003)
    }
    const envelope = (attack: number, decay: number, release: number) => synthSignal((s) => {
      Object.assign(s.synth.layers.A.amp, { attack, decay, release })
    }, ({ play, at }) => {
      const note = play()!
      at(0.35); note.keyUp?.(false)
    })
    const held = await envelope(0, 10, 8)
    expect(rms(held, 0.04, 0.09)).toBeGreaterThan(rms(await envelope(8, 10, 8), 0.04, 0.09) * 4)
    expect(rms(held, 0.14, 0.25)).toBeGreaterThan(rms(await envelope(0, 5, 8), 0.14, 0.25) * 8)
    expect(rms(held, 0.43, 0.53)).toBeGreaterThan(rms(await envelope(0, 10, 2), 0.43, 0.53) + 0.006)
    const osc = (amount: number, velocity: boolean) => synthSignal((s) => {
      Object.assign(s.synth.layers.A, { category: 'FM-H', control: 1 })
      Object.assign(s.synth.layers.A.osc, { amount, velocity, attack: 2, decay: 10 })
    }, ({ play }) => { play(60, 47) })
    const mod = await osc(9, false)
    expect(distance(mod, await osc(5, false))).toBeGreaterThan(0.004)
    expect(distance(mod, await osc(9, true))).toBeGreaterThan(0.004)
    const velocity = (hit: number) => synthSignal(undefined, ({ play }) => { play(60, hit) })
    expect(rms(await velocity(110))).toBeGreaterThan(rms(await velocity(30)) * 3)
  }, 20000)

  it('shapes oscillator and filter attack, decay and release separately from the amplifier', async () => {
    const sequences = ({ play, at }: Session) => {
      const voice = play(60)!
      at(0.32); voice.keyUp?.(false)
    }
    const contour = (target: 'osc' | 'filter', attack: number, decay: number, release: number) =>
      synthSignal((s) => {
        const patch = s.synth.layers.A
        patch.amp.release = 8
        if (target === 'osc') {
          Object.assign(patch, { category: 'FM-H', control: 1 })
          Object.assign(patch.osc, { attack, decay, release, amount: 9 })
        } else {
          Object.assign(patch.filter, { on: true, type: 'LP24', frequency: 3, attack, decay, release, amount: 9 })
        }
      }, sequences)
    for (const target of ['osc', 'filter'] as const) {
      const reference = await contour(target, 0, 10, 8)
      expect(distance(reference, await contour(target, 8, 10, 8), 0.04, 0.11), target).toBeGreaterThan(0.004)
      expect(distance(reference, await contour(target, 0, 5, 8), 0.14, 0.26), target).toBeGreaterThan(0.004)
      expect(distance(reference, await contour(target, 0, 10, 1), 0.36, 0.46), target).toBeGreaterThan(0.003)
    }
  })

  it('renders mono priority, glide and legato, unison, and wheel vibrato', async () => {
    const pair = ({ at, play }: Session) => {
      const a = play(60)!
      at(0.24); const b = play(67)!
      at(0.51); b.keyUp?.(false)
      at(0.63); a.keyUp?.(false)
    }
    const signal = (mode: 'Poly' | 'Mono' | 'Legato', priority: 'High' | 'Low' | 'Off', glide = 0) => synthSignal((s) => {
      s.synth.layers.A.wave = 0
      Object.assign(s.synth.layers.A.voice, { mode, priority, glide })
      s.synth.layers.A.amp.attack = 5
    }, pair)
    const poly = await signal('Poly', 'Off')
    const high = await signal('Mono', 'High')
    const low = await signal('Mono', 'Low')
    expect(projection(poly, 261.63, 0.36, 0.48)).toBeGreaterThan(0.004)
    expect(projection(poly, 392, 0.36, 0.48)).toBeGreaterThan(0.004)
    expect(projection(high, 261.63, 0.36, 0.48)).toBeLessThan(0.0005)
    expect(projection(low, 392, 0.36, 0.48)).toBeLessThan(0.0005)
    expect(projection(high, 261.63, 0.55, 0.62)).toBeGreaterThan(0.004)
    const glide = await signal('Legato', 'Off', 4)
    expect(projection(glide, 392, 0.34, 0.46)).toBeLessThan(projection(high, 392, 0.34, 0.46) * 0.25)
    expect(rms(glide, 0.36, 0.48)).toBeGreaterThan(0.01)
    const sounding = await render(synth((s) => { s.synth.layers.A.voice.unison = 3 }))
    expect(distance(...sounding)).toBeGreaterThan(0.003)
    const vibrato = (mode: 'Off' | 'On' | 'Wheel', wheel: number) => synthSignal((s) => {
      s.performance.wheel = wheel
      s.synth.layers.A.vibrato = { mode, rate: 5.8, amount: 9 }
    })
    const straight = await vibrato('Off', 0)
    expect(distance(straight, await vibrato('Wheel', 0))).toBeLessThan(0.000002)
    expect(distance(straight, await vibrato('Wheel', 1))).toBeGreaterThan(0.006)
    expect(distance(await vibrato('On', 0), await vibrato('Wheel', 1))).toBeLessThan(0.000002)
  }, 20000)

  it('renders the LFO waveforms and destinations and changes period with the shared clock', async () => {
    const make = (wave: Settings['synth']['layers']['A']['lfo']['wave'],
      target: Settings['synth']['layers']['A']['lfo']['target'], tempo = 120, sync = false) =>
      synthSignal((s) => {
        s.effects.clockBpm = tempo
        const patch = s.synth.layers.A
        Object.assign(patch, { category: 'FM-H', control: 3 })
        Object.assign(patch.filter, { on: true, type: 'LP12', frequency: 6 })
        Object.assign(patch.lfo, { wave, target, rate: 8, amount: 8, sync })
      })
    const none = await make('Triangle', 'Off')
    const signals: Float32Array[] = []
    for (const wave of ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const) {
      const signal = await make(wave, 'Osc Pitch')
      expect(distance(none, signal, 0.09, 0.63)).toBeGreaterThan(0.006)
      for (const other of signals) expect(distance(other, signal, 0.09, 0.63)).toBeGreaterThan(0.003)
      signals.push(signal)
    }
    const control = await make('Triangle', 'Osc Ctrl')
    const filter = await make('Triangle', 'Filter Freq')
    expect(distance(none, control)).toBeGreaterThan(0.003)
    expect(distance(none, filter)).toBeGreaterThan(0.003)
    expect(distance(control, filter)).toBeGreaterThan(0.004)
    expect(distance(await make('Triangle', 'Osc Pitch', 60, true), await make('Triangle', 'Osc Pitch', 180, true))).toBeGreaterThan(0.008)
  }, 20000)
})

function testTransport() {
  let time = 0.022
  let next = 0
  const tasks = new Map<number, { time: number; run: () => void }>()
  const scheduler: Scheduler = {
    set(run, wait) {
      tasks.set(++next, { time: time + wait / 1000, run })
      return next
    },
    clear(id) { tasks.delete(id) },
  }
  return {
    scheduler, clock: () => time, count: () => tasks.size,
    advance(t: number) {
      let pending = [...tasks.entries()].sort((a, b) => a[1].time - b[1].time)[0]
      while (pending && pending[1].time <= t) {
        const [id, task] = pending
        time = task.time
        tasks.delete(id)
        task.run()
        pending = [...tasks.entries()].sort((a, b) => a[1].time - b[1].time)[0]
      }
      time = t
    },
  }
}

describe('synth transport and layers', () => {
  it('selects note priorities and deterministic octave, direction and poly steps', () => {
    const notes = [67, 60, 64].map((note) => ({ note, velocity: 100, zone: 1 }))
    const arp = initialSettings().synth.layers.A.arp
    const sequence = (direction: typeof arp.direction, mode: typeof arp.mode = 'Arp') =>
      Array.from({ length: 9 }, (_, index) => arpeggioStep(notes, { ...arp, direction, mode, range: 1 }, index).map(({ note }) => note))
    expect(sequence('Up').flat()).toEqual([60, 64, 67, 72, 76, 79, 60, 64, 67])
    expect(sequence('Down').flat()).toEqual([79, 76, 72, 67, 64, 60, 79, 76, 72])
    expect(sequence('Up/Down').flat()).toEqual([60, 64, 67, 72, 76, 79, 76, 72, 67])
    expect(sequence('Random')).toEqual(sequence('Random'))
    expect(new Set(sequence('Random').flat()).size).toBeGreaterThan(2)
    expect(sequence('Up', 'Poly').slice(0, 2)).toEqual([[60, 64, 67], [72, 76, 79]])
    expect(priorityKey(notes, 'Off')?.note).toBe(64)
    expect(priorityKey(notes, 'Low')?.note).toBe(60)
    expect(priorityKey(notes, 'High')?.note).toBe(67)
    expect(synthPeriod(7, true, 120, true)).toBeCloseTo(0.5)
    expect(synthPeriod(7, true, 240, true)).toBeCloseTo(0.25)
  })

  it('renders arpeggiation and gated gaps, holds notes, restarts run and owns one timer per active layer', async () => {
    const transport = async (mode: 'Arp' | 'Gate', hold: boolean, tempo = 240) => {
      const engine = new OfflineAudioContext(2, Math.round(seconds * rate), rate)
      const clock = testTransport()
      const rack = new PianoRack(engine as unknown as BaseAudioContext, clock.clock, clock.scheduler)
      const state = synth((s) => {
        s.keyboardSync = true
        s.effects.clockBpm = tempo
        s.synth.layers.A.wave = 0
        Object.assign(s.synth.layers.A.arp, { run: true, mode, rate: 7, range: mode === 'Gate' ? 10 : 1, sync: true, hold })
      })
      rack.configure(state)
      const ended = vi.fn()
      const first = rack.play(60, 110, ended)!
      rack.play(64, 110, () => {})
      expect(clock.count()).toBe(1)
      clock.advance(0.1)
      first.keyUp?.(false)
      expect(ended).toHaveBeenCalledOnce()
      clock.advance(0.53)
      const tail = structuredClone(state)
      tail.synth.layers.A.arp.run = false
      rack.configure(tail)
      expect(clock.count()).toBe(0)
      clock.advance(0.57)
      rack.configure(state)
      expect(clock.count()).toBe(1)
      clock.advance(0.7)
      const audio = await engine.startRendering()
      rack.stopAll()
      expect(clock.count()).toBe(0)
      rack.dispose()
      return audio.getChannelData(0)
    }
    const running = await transport('Arp', true)
    expect(projection(running, 261.63, 0.055, 0.16)).toBeGreaterThan(0.004)
    expect(projection(running, 329.63, 0.31, 0.42)).toBeGreaterThan(0.004)
    const noHold = await transport('Arp', false)
    expect(projection(noHold, 659.26, 0.31, 0.42)).toBeGreaterThan(0.004)
    const gated = await transport('Gate', true)
    expect(rms(gated, 0.06, 0.12)).toBeGreaterThan(0.014)
    expect(rms(gated, 0.2, 0.25)).toBeLessThan(0.0003)
    expect(rms(gated, 0.31, 0.38)).toBeGreaterThan(0.014)
    expect(distance(gated, await transport('Gate', true, 170), 0.15, 0.49)).toBeGreaterThan(0.01)
  }, 15000)

  it('runs all three layers through independently assigned post-source effects and octave shifts', async () => {
    const state = synth((s) => {
      s.synth.layers.A.wave = 0
      s.synth.layers.B = { ...s.synth.layers.B, on: true, octave: 1, level: 10, category: 'Pure', wave: 0 }
      s.synth.layers.C = { ...s.synth.layers.C, on: true, octave: -1, level: 10, category: 'Pure', wave: 0 }
      s.synth.layers.B.filter.on = false
      s.synth.layers.C.filter.on = false
      Object.assign(s.synth.layers.B.chain.delay, { on: true, bpm: 150, mix: 10, feedback: 0 })
      s.synth.layers.C.amp.attack = 0
    })
    const [signal] = await render(state)
    expect(projection(signal, 261.63, 0.1, 0.28)).toBeGreaterThan(0.005)
    expect(projection(signal, 130.81, 0.1, 0.28)).toBeGreaterThan(0.004)
    expect(projection(signal, 523.25, 0.1, 0.28)).toBeLessThan(0.0004)
    expect(projection(signal, 523.25, 0.49, 0.62)).toBeGreaterThan(0.004)
  })
})

describe('program performance settings in the audio graph', () => {
  it('routes the split, fades zone edges, switches scenes, transposes, and morphs audible level', async () => {
    const warm = synth((s) => {
      s.synth.layers.A.wave = 0
      s.synth.layers.A.zone = [1, 3]
      s.organ.on = true
      s.organ.layers.A.model = 'B3'
      s.organ.layers.A.vibrato = false
      s.organ.layers.A.drawbars = [0, 0, 0, 0, 8, 0, 0, 0, 0]
      s.organ.layers.A.zone = [0, 0]
      s.otherScene.synthA = false
      s.otherScene.organA = false
      s.morph.wheel['synth.layers.A.level'] = 0
    })
    const state = editSplit(warm, 'Mid', { note: 60, fade: 0 })
    const tune = 261.626
    const note = (key: number) => ({ play }: Session) => { play(key) }
    const [right] = await render(state, note(60))
    expect(projection(right, tune, 0.09, 0.27)).toBeGreaterThan(0.009)
    expect(projection(right, tune * 3, 0.09, 0.27)).toBeLessThan(0.0004)
    const [left] = await render(state, note(48))
    expect(projection(left, tune * 1.5, 0.09, 0.27)).toBeGreaterThan(0.001)
    expect(projection(left, tune * 0.5, 0.09, 0.27)).toBeLessThan(0.0004)
    const [cross] = await render(editSplit(state, 'Mid', { fade: 12 }), note(60))
    expect(projection(cross, tune, 0.09, 0.27)).toBeCloseTo(projection(right, tune, 0.09, 0.27) / 2, 3)
    expect(projection(cross, tune * 3, 0.09, 0.27)).toBeGreaterThan(0.0009)
    const [muted] = await render(switchScene(state), note(60))
    expect(rms(muted)).toBeLessThan(0.00001)
    const [transposed] = await render({ ...state, transpose: { enabled: true, semitones: 6 } }, note(60))
    expect(projection(transposed, tune * Math.SQRT2, 0.09, 0.27)).toBeGreaterThan(0.007)
    const [morphed] = await render({ ...state, performance: { wheel: 0.65, pedal: 0 } }, note(60))
    expect(rms(morphed)).toBeLessThan(rms(right) * 0.3)
    expect(rms(morphed)).toBeGreaterThan(rms(right) * 0.1)
  })

  it('sustains only enabled Organ and Synth layers and clears all layers and timers on Panic', async () => {
    const state = synth((s) => {
      s.on = true
      s.layers.A.type = 'Clav'
      s.layers.A.sustain = false
      s.organ.on = true
      s.organ.layers.A.sustain = true
      s.synth.layers.A.sustain = false
    })
    const dry = (session: Session) => { const first = session.play()!; session.at(0.25); first.keyUp?.(false) }
    const wet = (session: Session) => { const first = session.play()!; session.at(0.25); expect(first.keyUp?.(true)).toBe(true) }
    expect(rms((await render(state, wet))[0], 0.48, 0.6)).toBeGreaterThan(0.006)
    expect(rms((await render(state, dry))[0], 0.48, 0.6)).toBeLessThan(0.00001)

    const engine = new OfflineAudioContext(2, Math.round(seconds * rate), rate)
    const clock = testTransport()
    const native = engine as unknown as BaseAudioContext
    const links = new Map<AudioNode, Set<AudioNode | AudioParam>>()
    let destinations = 0
    const context = new Proxy(native, {
      get(target, key) {
        const value = Reflect.get(target, key, target)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          const node = Reflect.apply(value, target, args) as AudioNode
          if (!node || !('connect' in node)) return node
          const connect = node.connect
          const disconnect = node.disconnect
          const edges = new Set<AudioNode | AudioParam>()
          links.set(node, edges)
          node.connect = ((destination: AudioNode | AudioParam, ...channels: number[]) => {
            edges.add(destination)
            if (destination === target.destination) destinations++
            return Reflect.apply(connect, node, [destination, ...channels])
          }) as typeof connect
          node.disconnect = ((...args: unknown[]) => {
            if (args.length) edges.delete(args[0] as AudioNode)
            else edges.clear()
            return Reflect.apply(disconnect, node, args)
          }) as typeof disconnect
          return node
        }
      },
    })
    const rack = new PianoRack(context, clock.clock, clock.scheduler)
    Object.assign(state.synth.layers.A.arp, { run: true, hold: true })
    rack.configure(state)
    const ended = vi.fn()
    const voice = rack.play(60, 106, ended)!
    voice.keyUp?.(true)
    expect(clock.count()).toBe(1)
    expect(destinations).toBe(1)
    rack.dispose()
    expect(clock.count()).toBe(0)
    expect(ended).toHaveBeenCalledOnce()
    expect([...links.values()].every((edge) => edge.size === 0)).toBe(true)
  })
})
