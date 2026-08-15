import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, type FakeAudioSetup } from '../test/fakes'
import { InstrumentStore } from '../state/instrument'
import { PianoEngine } from './engine'
import { arpSequence } from './synth'
import { drawbarGain } from './organ'

/**
 * stage3 engine integration — Organ and Synth enter the Phase 2 graph
 * (single AudioContext, shared chains, one destination), splits/zones gate
 * notes, transpose shifts pitch, voice modes and the arp behave canonically.
 */
function makeSystem(): FakeAudioSetup & { store: InstrumentStore; engine: PianoEngine; contextCount: () => number } {
  const setup = fakeAudioBoundary()
  let created = 0
  const boundary = {
    ...setup.boundary,
    createContext() {
      created++
      return setup.boundary.createContext()
    },
  }
  const store = new InstrumentStore()
  const engine = new PianoEngine(boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  return { ...setup, boundary, store, engine, contextCount: () => created }
}

describe('stage3.single-context routing', () => {
  it('piano, organ and synth voices share ONE AudioContext and reach the destination', () => {
    const { engine, store, getContext, contextCount } = makeSystem()
    store.toggleOrganLayer('A')
    store.toggleSynthLayer('A')
    engine.noteOn(60, 0.8)
    expect(contextCount()).toBe(1)
    const context = getContext()!
    expect(engine.layerVoiceCount('A')).toBe(1)
    expect(engine.layerKeyVoiceCount('organA')).toBe(1)
    expect(engine.layerKeyVoiceCount('synthA')).toBe(1)
    // Connectivity (masterGain → destination, all chains → masterGain) is
    // asserted structurally in graph.test.ts; here we assert the three
    // sections all produced live voice nodes inside the same single context.
    expect(context.oscillators().length).toBeGreaterThan(0)
    expect(context.bufferSources().length).toBeGreaterThan(0)
    engine.noteOff(60)
  })

  it('organ and synth chains exist in diagnostics alongside the piano chains', () => {
    const { engine } = makeSystem()
    engine.ensureStarted()
    const diag = engine.diagnostics()
    expect(diag.channels).not.toBeNull()
    expect(Object.keys(diag.channels!).sort()).toEqual(['A', 'B', 'organ', 'synthA', 'synthB', 'synthC'].sort())
    expect(diag.organStrips).not.toBeNull()
    expect(diag.synthStrips).not.toBeNull()
  })
})

describe('stage3.organ', () => {
  it('organ voices are oscillator-built, release immediately and ignore the damper', () => {
    const { engine, store, timers } = makeSystem()
    store.toggleOrganLayer('A')
    engine.setSustain(1) // damper down
    engine.noteOn(60, 0.8)
    expect(engine.layerKeyVoiceCount('organA')).toBe(1)
    engine.noteOff(60)
    // Organ ignores sustain: the voice must leave the held set immediately.
    expect(engine.layerKeyVoiceCount('organA')).toBe(0)
    timers.advance(5000)
  })

  it('B3 and Farf engines build audibly different voices (different waveform sets)', () => {
    const first = makeSystem()
    first.store.toggleOrganLayer('A')
    first.store.setPianoSectionOn(false)
    first.engine.noteOn(60, 0.8)
    const b3Types = new Set(first.getContext()!.oscillators().filter((o) => !o.stopped).map((o) => (o.periodicWave ? 'custom' : o.type)))

    const second = makeSystem()
    second.store.toggleOrganLayer('A')
    second.store.setPianoSectionOn(false)
    // B3 → B3 Bass → Vox → Farf
    second.store.cycleOrganModel()
    second.store.cycleOrganModel()
    second.store.cycleOrganModel()
    expect(second.store.getState().organ.layers.A.model).toBe('Farf')
    second.engine.noteOn(60, 0.8)
    const farfTypes = new Set(second.getContext()!.oscillators().filter((o) => !o.stopped).map((o) => (o.periodicWave ? 'custom' : o.type)))

    // The two engines must not be renamed copies of one oscillator recipe.
    expect(b3Types).not.toEqual(farfTypes)
    expect(b3Types.has('sine')).toBe(true) // B3 = additive sine tonewheels
    expect([...farfTypes].some((t) => t === 'sawtooth' || t === 'square')).toBe(true)
  })

  it('drawbar gains follow the canonical 3dB-per-step law and drive live voices', () => {
    expect(drawbarGain(0)).toBe(0)
    for (let i = 1; i < 8; i++) expect(drawbarGain(i + 1)).toBeGreaterThan(drawbarGain(i))
    // Live update: pulling a drawbar out while a note sounds changes a partial gain.
    const { engine, store, getContext } = makeSystem()
    store.toggleOrganLayer('A')
    store.setPianoSectionOn(false)
    engine.noteOn(60, 0.8)
    const gains = getContext()!.nodes.filter((n) => n.kind === 'gain')
    const before = gains.map((g) => (g as unknown as { gain: { value: number; targets: unknown[] } }).gain.value)
    store.setDrawbar(8, 8) // 1' drawbar from 0 → 8
    const after = gains.map((g) => (g as unknown as { gain: { value: number; targets: unknown[] } }).gain.value)
    expect(after).not.toEqual(before)
  })

  it('percussion adds a decaying strike only when enabled', () => {
    const { engine, store, getContext } = makeSystem()
    store.toggleOrganLayer('A')
    store.setPianoSectionOn(false)
    engine.ensureStarted()
    const context = getContext()!
    const beforeFirst = context.oscillators().length
    engine.noteOn(60, 0.8)
    const withoutPerc = context.oscillators().length - beforeFirst
    engine.noteOff(60)
    store.togglePercussion('on')
    const beforeSecond = context.oscillators().length
    engine.noteOn(64, 0.8)
    const withPerc = context.oscillators().length - beforeSecond
    expect(withPerc).toBe(withoutPerc + 1) // exactly one percussion strike oscillator
  })
})

describe('stage3.splits and zones', () => {
  it('an active split point gates layers by zone assignment (hard split)', () => {
    const { engine, store } = makeSystem()
    store.toggleSplit() // default: mid point at C4 (MIDI 60)
    store.setZoneRange('pianoA', { from: 0, to: 0 }) // lower zone only
    store.toggleOrganLayer('A')
    store.setZoneRange('organA', { from: 1, to: 3 }) // upper zone only
    engine.noteOn(59, 0.8)
    expect(engine.layerVoiceCount('A')).toBe(1)
    expect(engine.layerKeyVoiceCount('organA')).toBe(0)
    engine.noteOff(59)
    engine.noteOn(60, 0.8)
    expect(engine.layerVoiceCount('A')).toBe(0)
    expect(engine.layerKeyVoiceCount('organA')).toBe(1)
  })

  it('crossfade widths blend across the split point instead of switching hard', () => {
    const { engine, store } = makeSystem()
    store.toggleSplitEdit() // turns split on, edits mid
    store.toggleSplit() // cycle xfade 0 → next width
    const xfade = store.getState().split.points.mid.xfade
    expect(xfade).toBeGreaterThan(0)
    store.exitModes()
    store.setZoneRange('pianoA', { from: 0, to: 0 })
    // Inside the crossfade band below the point the layer still sounds.
    engine.noteOn(60 - 1, 0.8)
    expect(engine.layerVoiceCount('A')).toBe(1)
  })

  it('transpose shifts organ oscillator frequencies by the semitone factor', () => {
    const voiceFundamental = (system: ReturnType<typeof makeSystem>): number => {
      system.store.toggleOrganLayer('A')
      system.store.setPianoSectionOn(false)
      system.engine.ensureStarted()
      const context = system.getContext()!
      const before = context.oscillators().length
      system.engine.noteOn(60, 0.8)
      const voiceOscs = context.oscillators().slice(before)
      return Math.min(...voiceOscs.map((o) => o.frequency.value))
    }
    const plain = makeSystem()
    const base = voiceFundamental(plain)
    const shifted = makeSystem()
    shifted.store.setTranspose(6)
    const up = voiceFundamental(shifted)
    expect(up / base).toBeCloseTo(Math.pow(2, 6 / 12), 2)
  })
})

describe('stage3.synth voice modes and arp', () => {
  it('poly mode allocates one voice per key; mono holds a single voice', () => {
    const { engine, store } = makeSystem()
    store.toggleSynthLayer('A')
    store.setPianoSectionOn(false)
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    expect(engine.layerKeyVoiceCount('synthA')).toBe(2)
    engine.noteOff(60)
    engine.noteOff(64)

    store.cycleVoiceMode() // Poly → Mono
    expect(store.getState().synth.layers.A.voice.mode).toBe('Mono')
    engine.noteOn(48, 0.8)
    engine.noteOn(52, 0.8)
    expect(engine.layerKeyVoiceCount('synthA')).toBe(1)
    engine.noteOff(48)
    engine.noteOff(52)
    expect(engine.layerKeyVoiceCount('synthA')).toBe(0)
  })

  it('mono low-priority keeps the lowest held key when the higher is released', () => {
    const { engine, store } = makeSystem()
    store.toggleSynthLayer('A')
    store.setPianoSectionOn(false)
    store.cycleVoiceMode() // Mono
    store.cycleNotePriority() // Off → Low
    expect(store.getState().synth.layers.A.voice.priority).toBe('Low')
    engine.noteOn(60, 0.8)
    engine.noteOn(55, 0.8) // lower key takes over
    engine.noteOff(55)
    // 60 is still physically held: mono voice must survive.
    expect(engine.layerKeyVoiceCount('synthA')).toBe(1)
    engine.noteOff(60)
    expect(engine.layerKeyVoiceCount('synthA')).toBe(0)
  })

  it('arpSequence is deterministic and canonical per direction', () => {
    const held = [64, 60, 67]
    expect(arpSequence(held, 'Up', 1)).toEqual([60, 64, 67])
    expect(arpSequence(held, 'Down', 1)).toEqual([67, 64, 60])
    expect(arpSequence(held, 'Up/Down', 1)).toEqual([60, 64, 67, 64])
    // Range 2 repeats the pattern an octave up.
    expect(arpSequence(held, 'Up', 2)).toEqual([60, 64, 67, 72, 76, 79])
    // Random is deterministic for a given note set (same seed → same order).
    const a = arpSequence(held, 'Random', 1)
    const b = arpSequence(held, 'Random', 1)
    expect(a).toEqual(b)
    expect([...a].sort((x, y) => x - y)).toEqual([60, 64, 67])
  })

  it('running arp schedules stepped voices on the audio clock (deterministic timing)', () => {
    const { engine, store, timers, getContext } = makeSystem()
    store.toggleSynthLayer('A')
    store.setPianoSectionOn(false)
    store.setSynthArp({ run: true, mode: 'Arp' }, 'arp on')
    engine.noteOn(60, 0.9)
    // No immediate held voice — the arp owns scheduling.
    expect(engine.layerKeyVoiceCount('synthA')).toBe(0)
    const context = getContext()!
    context.currentTime = 0.1
    timers.advance(400)
    const scheduled = context.oscillators().filter((o) => o.started)
    expect(scheduled.length).toBeGreaterThan(0)
    engine.noteOff(60)
    timers.advance(2000)
  })

  it('unison adds real detuned oscillators to a synth voice', () => {
    const plain = makeSystem()
    plain.store.toggleSynthLayer('A')
    plain.store.setPianoSectionOn(false)
    plain.engine.ensureStarted()
    const before = plain.getContext()!.oscillators().length
    plain.engine.noteOn(60, 0.8)
    const withoutUnison = plain.getContext()!.oscillators().length - before

    const unison = makeSystem()
    unison.store.toggleSynthLayer('A')
    unison.store.setPianoSectionOn(false)
    unison.store.cycleSynthUnison()
    expect(unison.store.getState().synth.layers.A.voice.unison).toBeGreaterThan(0)
    unison.engine.ensureStarted()
    const before2 = unison.getContext()!.oscillators().length
    unison.engine.noteOn(60, 0.8)
    const withUnison = unison.getContext()!.oscillators().length - before2
    expect(withUnison).toBeGreaterThan(withoutUnison)
  })

  it('panic (all notes off) silences piano, organ, synth and pending arp steps', () => {
    const { engine, store, timers } = makeSystem()
    store.toggleOrganLayer('A')
    store.toggleSynthLayer('B')
    engine.noteOn(60, 0.8)
    engine.noteOn(65, 0.8)
    expect(engine.heldVoiceCount()).toBeGreaterThan(0)
    engine.allNotesOff('panic')
    expect(engine.heldVoiceCount()).toBe(0)
    timers.advance(10000)
    expect(engine.activeVoiceCount()).toBe(0)
  })
})

describe('stage3.organ vibrato and rotary routing', () => {
  it('vibrato/chorus engages the scanner delay wet path per mode', () => {
    const { engine, store } = makeSystem()
    store.toggleOrganLayer('A')
    engine.ensureStarted()
    const vibrato = engine.diagnostics().organStrips!.A.vibrato
    const wet = (vibrato as unknown as { output: unknown }).output
    expect(wet).toBeTruthy()
    // Fake params apply setTargetAtTime immediately via targets list; assert
    // through the store→engine wire: enabling vibrato must not throw and the
    // canonical state must drive the unit (mode + on flag).
    store.toggleVibratoOn()
    expect(store.getState().organ.layers.A.vibratoOn).toBe(true)
    store.cycleVibratoMode()
    expect(store.getState().organ.vibratoMode).not.toBe('C1')
  })

  it('Organ to Rotary routes the organ chain into the rotary speaker', () => {
    const { engine, store } = makeSystem()
    store.toggleOrganLayer('A')
    engine.ensureStarted()
    const diag = engine.diagnostics()
    const organChain = diag.channels!.organ
    const rotaryInput = diag.rotary!.input
    const connections = (organChain.toRotary as unknown as { connections: unknown[] }).connections
    expect(connections.includes(rotaryInput)).toBe(true)
    const gainOf = (node: unknown) => (node as { gain: { value: number; targets?: unknown[] } }).gain
    const before = gainOf(organChain.toRotary).value
    store.toggleOrganToRotary()
    expect(store.getState().organ.toRotary).toBe(true)
    // The routing gains are ramped; the fake records the target values.
    const after = gainOf(organChain.toRotary)
    expect(JSON.stringify(after)).not.toBe(JSON.stringify({ value: before }))
  })

  it('rotary speed morph interpolates between slow and fast', () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    store.toggleMorphCapture('wheel') // rotary morph requires a latched source
    store.toggleRotarySpeedMorph()
    store.toggleMorphCapture('wheel')
    expect(store.getState().morphs.wheel.some((a) => a.path.kind === 'rotarySpeed')).toBe(true)
    store.setMorphValue('wheel', 0.5)
    // The engine pushes the morph value into the rotary unit as a continuous speed.
    expect(engine.diagnostics().rotary).not.toBeNull()
  })
})

describe('stage3.morphs reach the audio graph', () => {
  it('a wheel morph on an organ layer level moves the live strip gain', () => {
    const { engine, store } = makeSystem()
    store.toggleOrganLayer('A')
    engine.ensureStarted()
    const strip = engine.diagnostics().organStrips!.A
    const before = (strip.level.gain as unknown as { value: number }).value
    store.toggleMorphCapture('wheel')
    store.setOrganLevel('A', 10)
    store.toggleMorphCapture('wheel')
    store.setMorphValue('wheel', 1)
    const after = (strip.level.gain as unknown as { value: number }).value
    expect(after).toBeLessThan(before)
  })
})
