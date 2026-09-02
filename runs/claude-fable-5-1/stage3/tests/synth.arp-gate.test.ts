import { describe, expect, it } from 'vitest'
import { maxAbsDifference, rms } from '../src/dsp/analysis'
import { renderEvents, type TimedEvent } from '../src/dsp/offline'
import { SynthLayerUnit, type ArpLogEntry } from '../src/dsp/synth'
import { ARP_SUBDIVISIONS, arpKnobToBpm, defaultSynthLayerParams, subdivisionFromKnob, subdivisionSeconds, type SynthEvent, type SynthLayerParams } from '../src/dsp/synthTypes'

const SR = 22050

type Overrides = { [K in keyof SynthLayerParams]?: SynthLayerParams[K] extends object ? Partial<SynthLayerParams[K]> : SynthLayerParams[K] }

/** A plucky sustained patch so gated / arpeggiated amplitude is easy to read; modulation off. */
function patch(overrides: Overrides = {}): SynthLayerParams {
  const base = defaultSynthLayerParams({ on: true })
  const clean: Overrides = {
    wave: { type: 0, category: 0, index: 2, partial: 1 },
    filter: { on: false },
    lfo: { destination: 3 },
    vibrato: { mode: 0 },
    ampEnv: { attack: 0, decay: 127, release: 5, velocity: 0 },
    oscEnv: { amount: 0, toPitch: false },
    voice: { mode: 0, priority: 0, glide: 0 },
    arp: { run: true, mode: 0, rate: 5, sync: false, range: 0, direction: 0, kbHold: false, kbSync: false },
    unison: 0,
    bpm: 120,
  }
  const out: Record<string, unknown> = { ...base }
  for (const layer of [clean, overrides]) {
    for (const [k, v] of Object.entries(layer)) {
      const cur = out[k]
      out[k] = v && typeof v === 'object' && cur && typeof cur === 'object' ? { ...(cur as object), ...(v as object) } : v
    }
  }
  return out as unknown as SynthLayerParams
}

const on = (midi: number, at: number, velocity = 100): TimedEvent<SynthEvent> => ({ at, event: { type: 'on', midi, velocity, gain: 1 } })
const off = (midi: number, at: number): TimedEvent<SynthEvent> => ({ at, event: { type: 'off', midi } })
const CHORD = [60, 64, 67]
const chordOn = (at = 0) => CHORD.map((m) => on(m, at))
const chordOff = (at: number) => CHORD.map((m) => off(m, at))

function run(overrides: Overrides, events: TimedEvent<SynthEvent>[], seconds = 1): { unit: SynthLayerUnit; l: Float32Array; r: Float32Array; log: ArpLogEntry[] } {
  const unit = new SynthLayerUnit(SR)
  unit.setParams(patch(overrides))
  const buf = renderEvents(unit, events, seconds, SR)
  return { unit, l: buf.l, r: buf.r, log: [...unit.arpLog] }
}

const ons = (log: ArpLogEntry[]) => log.filter((e) => e.on)
const stepSamples = (rate: number) => Math.round((60 / arpKnobToBpm(rate) / 2) * SR)
const slice = (x: Float32Array, from: number, to: number) => x.subarray(Math.round(from * SR), Math.round(to * SR))

describe('synth.arp-gate — deterministic rate, clock sync, range, direction, hold and run', () => {
  it('is deterministic: the same notes and clock give the same step order, sample timing and audio on every run', () => {
    const a = run({}, chordOn(0))
    const b = run({}, chordOn(0))
    expect(a.log.length).toBeGreaterThan(4)
    expect(a.log).toEqual(b.log)
    expect(maxAbsDifference(a.l, b.l)).toBe(0)
    // 1/8 notes at the Rate BPM: consecutive steps are exactly one step apart (manual p. 36)
    const steps = ons(a.log)
    const expected = stepSamples(5)
    for (let i = 1; i < steps.length; i++) expect(Math.abs(steps[i].sample - steps[i - 1].sample - expected)).toBeLessThanOrEqual(1)
    expect(steps[0].sample).toBe(0)
    // every step is released before the next (gate), and the notes actually sound
    const offs = a.log.filter((e) => !e.on)
    expect(offs.length).toBeGreaterThanOrEqual(steps.length - 1)
    expect(rms(a.l)).toBeGreaterThan(0.02)
  })

  it('Rate changes the step interval; Master Clock sync uses the subdivision at the BPM', () => {
    const fast = ons(run({ arp: { rate: 8 } }, chordOn(0)).log)
    expect(Math.abs(fast[1].sample - fast[0].sample - stepSamples(8))).toBeLessThanOrEqual(1)
    expect(stepSamples(8)).toBeLessThan(stepSamples(5))
    for (const [rate, bpm] of [
      [10, 120],
      [0, 120],
      [5, 90],
    ] as const) {
      const steps = ons(run({ arp: { sync: true, rate }, bpm }, chordOn(0), 2.2).log)
      const sub = subdivisionFromKnob(ARP_SUBDIVISIONS, rate)
      const expected = Math.round(subdivisionSeconds(sub, bpm) * SR)
      expect(steps.length).toBeGreaterThanOrEqual(2)
      expect(Math.abs(steps[1].sample - steps[0].sample - expected), `${sub.label} at ${bpm} BPM`).toBeLessThanOrEqual(1)
    }
    expect(subdivisionFromKnob(ARP_SUBDIVISIONS, 10).label).toBe('1/16T')
    expect(subdivisionFromKnob(ARP_SUBDIVISIONS, 0).label).toBe('1/2')
  })

  it('plays Up, Down, Up/Down and a reproducible Random order over the held notes', () => {
    const order = (direction: number, count: number) => ons(run({ arp: { direction, rate: 9 } }, chordOn(0), 1.5).log).slice(0, count).map((e) => e.midi)
    expect(order(0, 7)).toEqual([60, 64, 67, 60, 64, 67, 60])
    expect(order(1, 7)).toEqual([67, 64, 60, 67, 64, 60, 67])
    expect(order(2, 9)).toEqual([60, 64, 67, 64, 60, 64, 67, 64, 60])
    const random = order(3, 12)
    expect(random).toEqual(order(3, 12))
    expect(random).not.toEqual([60, 64, 67, 60, 64, 67, 60, 64, 67, 60, 64, 67])
    for (const m of random) expect(CHORD).toContain(m)
  })

  it('Range adds octave transpositions of the held notes', () => {
    const notes = (range: number) => new Set(ons(run({ arp: { range, rate: 10 } }, chordOn(0), 2).log).map((e) => e.midi))
    expect([...notes(0)].sort((a, b) => a - b)).toEqual([60, 64, 67])
    expect([...notes(1)].sort((a, b) => a - b)).toEqual([60, 64, 67, 72, 76, 79])
    expect(notes(2).has(84)).toBe(true)
    expect(notes(2).has(91)).toBe(true)
    // one octave and a fifth: the next transposition only up to a fifth above the lowest note
    const fifth = [...notes(1 + 7 / 12)].sort((a, b) => a - b)
    expect(fifth).toEqual([60, 64, 67, 72, 76, 79, 84, 88])
  })

  it('KB Hold keeps the arpeggio running after the keys are lifted; without it the arpeggio stops', () => {
    const events = [...chordOn(0), ...chordOff(0.15)]
    const held = run({ arp: { kbHold: true, rate: 9 } }, events, 1.2)
    expect(ons(held.log).filter((e) => e.sample > 0.6 * SR).length).toBeGreaterThan(3)
    expect(rms(slice(held.l, 0.8, 1.1))).toBeGreaterThan(0.02)
    const released = run({ arp: { kbHold: false, rate: 9 } }, events, 1.2)
    expect(ons(released.log).filter((e) => e.sample > 0.3 * SR)).toHaveLength(0)
    expect(rms(slice(released.l, 0.5, 1.1))).toBeLessThan(1e-4)
    // a new note after all keys were lifted replaces the held set
    const replaced = run({ arp: { kbHold: true, rate: 9 } }, [...events, on(72, 0.5)], 1.2)
    const late = ons(replaced.log).filter((e) => e.sample > 0.7 * SR).map((e) => e.midi)
    expect(late.length).toBeGreaterThan(0)
    expect(new Set(late)).toEqual(new Set([72]))
  })

  it('ARP RUN starts and stops the arpeggiator; with it off the keys play directly', () => {
    const stopped = run({ arp: { run: false } }, [...chordOn(0), ...chordOff(0.5)], 0.8)
    expect(stopped.log).toEqual([])
    expect(rms(slice(stopped.l, 0.1, 0.4))).toBeGreaterThan(0.02)
    expect(stopped.unit.voiceCount).toBe(0)
    // stopping mid-way: no steps after the stop, the arpeggiated voice is released
    const unit = new SynthLayerUnit(SR)
    unit.setParams(patch({ arp: { rate: 9 } }))
    for (const m of CHORD) unit.handle({ type: 'on', midi: m, velocity: 100, gain: 1 })
    const l = new Float32Array(SR)
    const r = new Float32Array(SR)
    unit.process(l, r, SR)
    const before = unit.arpLog.length
    expect(before).toBeGreaterThan(2)
    unit.setParams(patch({ arp: { rate: 9, run: false } }))
    unit.process(l, r, SR)
    expect(unit.arpLog.length).toBe(before)
    // the keys are still held, so they now sound directly (one voice each) instead of being stepped through
    expect(unit.voiceCount).toBe(CHORD.length)
    expect(rms(l.subarray(Math.round(0.2 * SR)))).toBeGreaterThan(0.02)
    for (const m of CHORD) unit.handle({ type: 'off', midi: m })
    unit.process(l, r, SR)
    expect(unit.voiceCount).toBe(0)
    expect(rms(l.subarray(Math.round(0.2 * SR)))).toBeLessThan(1e-4)
  })

  it('Poly mode repeats the whole chord each step and Gate mode gates the sustained sound at the step rate', () => {
    const poly = ons(run({ arp: { mode: 1, rate: 9 } }, chordOn(0), 1).log)
    expect(poly.length).toBeGreaterThanOrEqual(6)
    expect(poly.slice(0, 3).map((e) => e.midi)).toEqual(CHORD)
    expect(poly[0].sample).toBe(poly[2].sample)
    expect(poly[3].sample - poly[0].sample).toBe(stepSamples(9))
    // with a range the chord is transposed step by step
    const polyRange = ons(run({ arp: { mode: 1, rate: 9, range: 1 } }, chordOn(0), 1).log)
    expect(polyRange.slice(3, 6).map((e) => e.midi)).toEqual([72, 76, 79])
    // Gate: the held chord sustains, the amplitude is gated each step (manual p. 35)
    const hard = run({ arp: { mode: 2, rate: 6, range: 4 } }, chordOn(0), 1)
    const gateSteps = hard.log.filter((e) => e.midi === -1)
    expect(gateSteps.length).toBeGreaterThan(3)
    expect(gateSteps[0]).toMatchObject({ sample: 0, on: true })
    expect(gateSteps[1].on).toBe(false)
    expect(gateSteps[2].sample - gateSteps[0].sample).toBe(stepSamples(6))
    expect(hard.unit.voiceCount).toBe(3)
    const step = stepSamples(6)
    const level = (x: Float32Array, from: number, to: number) => rms(x, from, to)
    const openRms = level(hard.l, Math.round(step * 1.05), Math.round(step * 1.45))
    const closedRms = level(hard.l, Math.round(step * 1.6), Math.round(step * 1.95))
    expect(openRms).toBeGreaterThan(0.02)
    expect(closedRms).toBeLessThan(openRms * 0.05)
    // a soft gate (range 0) still modulates but never fully closes; hardness deepens the modulation
    const soft = run({ arp: { mode: 2, rate: 6, range: 0 } }, chordOn(0), 1)
    const softOpen = level(soft.l, Math.round(step * 1.0), Math.round(step * 1.2))
    const softClosed = level(soft.l, Math.round(step * 1.4), Math.round(step * 1.6))
    expect(softClosed).toBeGreaterThan(softOpen * 0.05)
    expect(softClosed).toBeLessThan(softOpen * 0.8)
  })

  it('KB Sync and a clock reset restart the step phase; without KB Sync new notes fall on the running grid', () => {
    const events = [on(60, 0), off(60, 0.15), on(64, 0.2)]
    const blockBoundary = Math.ceil((0.2 * SR) / 128) * 128
    const synced = ons(run({ arp: { kbSync: true } }, events).log)
    expect(synced.map((e) => e.midi)).toContain(64)
    expect(synced.find((e) => e.midi === 64)!.sample).toBe(blockBoundary)
    const grid = ons(run({ arp: { kbSync: false } }, events).log)
    expect(grid.find((e) => e.midi === 64)!.sample).toBe(stepSamples(5))
    // an explicit clock reset (Master Clock keyboard sync) restarts the step immediately
    const reset = ons(run({ arp: { kbSync: false } }, [...events, { at: 0.2, event: { type: 'clockReset' } }]).log)
    expect(reset.find((e) => e.midi === 64)!.sample).toBe(blockBoundary)
    // sustain holds notes in the arpeggio while the pedal is down (SUSTPED)
    const sustained = ons(run({ arp: { rate: 9 } }, [{ at: 0, event: { type: 'sustain', on: true } }, on(60, 0), off(60, 0.1), { at: 0.5, event: { type: 'sustain', on: false } }], 1).log)
    expect(sustained.filter((e) => e.sample > 0.3 * SR && e.sample < 0.5 * SR).length).toBeGreaterThan(0)
    expect(sustained.filter((e) => e.sample > 0.6 * SR)).toHaveLength(0)
    // all notes off silences everything and clears the note set
    const panic = run({ arp: { rate: 9 } }, [...chordOn(0), { at: 0.3, event: { type: 'allOff' } }], 1)
    expect(ons(panic.log).filter((e) => e.sample > 0.4 * SR)).toHaveLength(0)
    expect(rms(slice(panic.l, 0.5, 1))).toBeLessThan(1e-4)
    expect(panic.unit.heldNotes()).toEqual([])
  })
})
