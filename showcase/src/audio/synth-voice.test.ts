import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, FakeGain, FakeOscillator } from '../test/fakes'
import { InstrumentStore } from '../state/instrument'
import { PianoEngine } from './engine'

/**
 * synth.voice-modes / synth.arp-gate — fake-level state + graph tests for the
 * Synth engine's part 3 scope (spec: nord-stage-4.synth.json voice,
 * arpeggiatorGate): mono/legato/priority/glide/unison/vibrato voice
 * behavior, and a deterministic arpeggiator/gate scheduler on injected
 * timers. Rendered-audio proof lives in render-synth3.test.ts.
 */
function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  store.setPianoSectionOn(false)
  store.setSynthSectionOn(true)
  return { ...setup, store, engine }
}

function voiceSourcesFor(context: { nodes: unknown[] }, before: number): Array<FakeOscillator> {
  return (context.nodes as unknown[]).slice(before).filter((n): n is FakeOscillator => n instanceof FakeOscillator)
}

describe('synth.voice — Mono/Legato single-voice behavior', () => {
  it('Mono retriggers a fresh envelope: one sounding voice, releasing the previous note', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.cycleSynthVoiceMode() // Poly -> Mono

    engine.noteOn(60, 0.8)
    expect(engine.layerVoiceCount('A', 'synth')).toBe(1)
    engine.noteOn(64, 0.8) // Mono retriggers: the new note takes over
    expect(engine.heldVoiceCount()).toBe(1) // only one voice sounding at a time
    expect(engine.isNoteActive(64)).toBe(true)
    expect(engine.isNoteActive(60)).toBe(false)
    void context
    engine.noteOff(64)
    engine.noteOff(60)
  })

  it('Legato does not retrigger the envelope when played overlapped, and glides the frequency', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.cycleSynthVoiceMode() // Poly -> Mono
    store.cycleSynthVoiceMode() // Mono -> Legato
    store.setSynthGlide(80)

    engine.noteOn(60, 0.8)
    const before = context.nodes.length
    engine.noteOn(64, 0.8) // overlapped: glides in place, no new envelope/oscillator
    const created = voiceSourcesFor(context, before)
    expect(created).toHaveLength(0) // no new oscillator built for the glide
    expect(engine.isNoteActive(64)).toBe(true)
    expect(engine.isNoteActive(60)).toBe(false) // the sounding voice's key renamed to 64

    const oscillator = context.oscillators().find((o) => o.started && !o.stopped)!
    const glideEvents = oscillator.frequency.events.filter((e) => e.kind === 'target')
    expect(glideEvents.length).toBeGreaterThan(0) // setTargetAtTime portamento, not a step

    engine.noteOff(64)
    engine.noteOff(60)
  })

  it('priority Low: a lower incoming note wins while held; releasing it returns to the held note', () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    store.cycleSynthVoiceMode() // Mono
    store.cycleSynthVoicePriority() // Off -> Low

    engine.noteOn(64, 0.8)
    expect(engine.isNoteActive(64)).toBe(true)
    engine.noteOn(60, 0.8) // lower: wins under Low priority
    expect(engine.isNoteActive(60)).toBe(true)
    expect(engine.isNoteActive(64)).toBe(false)
    engine.noteOn(67, 0.8) // higher than the sounding 60: does not win, joins the held stack
    expect(engine.isNoteActive(60)).toBe(true)
    expect(engine.isNoteActive(67)).toBe(false)

    engine.noteOff(60) // releasing the winner returns to a still-held note
    expect(engine.isNoteActive(64) || engine.isNoteActive(67)).toBe(true)
    engine.noteOff(64)
    engine.noteOff(67)
  })

  it('priority High: a higher incoming note wins while held', () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    store.cycleSynthVoiceMode() // Mono
    store.cycleSynthVoicePriority()
    store.cycleSynthVoicePriority() // Off -> Low -> High

    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8) // higher: wins under High priority
    expect(engine.isNoteActive(64)).toBe(true)
    engine.noteOn(55, 0.8) // lower than sounding 64: does not win
    expect(engine.isNoteActive(64)).toBe(true)
    expect(engine.isNoteActive(55)).toBe(false)
    engine.noteOff(64)
    engine.noteOff(60)
    engine.noteOff(55)
  })
})

describe('synth.voice — unison, vibrato', () => {
  it('unison level adds detuned duplicate oscillators to the same voice', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!

    let before = context.nodes.length
    engine.noteOn(60, 0.8)
    const plain = voiceSourcesFor(context, before).length
    engine.noteOff(60)

    store.cycleSynthUnison() // Off -> 1
    before = context.nodes.length
    engine.noteOn(61, 0.8)
    const withUnison = voiceSourcesFor(context, before).length
    engine.noteOff(61)

    expect(withUnison).toBe(plain + 2) // two detuned duplicates (piano unison pattern)
  })

  it('unison 1/2/3 keep a constant oscillator count (2 duplicates) but widen the detune/gain spread each step', () => {
    // The engine's unison stack is always exactly 2 detuned duplicates (side
    // -1/+1) alongside the main oscillator, regardless of level 1..3 — level
    // scales each duplicate's detune/gain/pan width, not the voice count
    // (see engine.ts's "simplified single-oscillator stack per duplicate").
    // This test locks in that real, declared behavior instead of the
    // strictly-increasing-count claim a plain waveform-stacking model (like
    // Multi Saw) would use, which this Analog-mode unison does not.
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!

    store.cycleSynthUnison() // Off -> 1
    let before = context.nodes.length
    engine.noteOn(60, 0.8)
    const level1 = voiceSourcesFor(context, before)
    engine.noteOff(60)

    store.cycleSynthUnison() // 1 -> 2
    before = context.nodes.length
    engine.noteOn(61, 0.8)
    const level2 = voiceSourcesFor(context, before)
    engine.noteOff(61)

    store.cycleSynthUnison() // 2 -> 3
    before = context.nodes.length
    engine.noteOn(62, 0.8)
    const level3 = voiceSourcesFor(context, before)
    engine.noteOff(62)

    expect(level1).toHaveLength(3) // main + 2 duplicates
    expect(level2).toHaveLength(3)
    expect(level3).toHaveLength(3)
    const spread = (oscs: FakeOscillator[]) => Math.max(...oscs.map((o) => o.detune.value)) - Math.min(...oscs.map((o) => o.detune.value))
    expect(spread(level2)).toBeGreaterThan(spread(level1)) // wider detune at level 2
    expect(spread(level3)).toBeGreaterThan(spread(level2)) // wider still at level 3
  })

  it('vibrato Wheel depth follows the live mod-wheel position', () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    store.cycleSynthVibratoMode() // Off -> On
    store.cycleSynthVibratoMode() // On -> Wheel
    engine.noteOn(60, 0.8)

    store.setMorphSource('wheel', 0)
    const diagnosticsA = engine.diagnostics().synthChannels!.A
    const depthAtZero = diagnosticsA.vibrato.depth.gain.value
    store.setMorphSource('wheel', 127)
    const depthAtFull = diagnosticsA.vibrato.depth.gain.value
    expect(depthAtFull).toBeGreaterThan(depthAtZero)
    engine.noteOff(60)
  })

  it('vibrato Off has no depth or connection; On gives a sounding voice a fixed-depth vibrato LFO connection', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    // The layer's always-running vibrato oscillator (5.5 Hz sine, spec voice.vibrato).
    const vibratoOsc = context.oscillators().find((o) => o.type === 'sine' && o.frequency.value === 5.5)!
    expect(vibratoOsc).toBeDefined()
    expect(vibratoOsc.started).toBe(true)

    // Off: depth is 0 and the wheel position has no effect. The shared
    // per-layer depth gain connects through a per-VOICE ramp gain (spec
    // voice.vibrato.optionalModes' Delayed mode needs its own per-voice
    // onset time — see startSynthVoice's vibratoRamp) which is fixed at 1
    // (pass-through) for every mode except Delayed, so the voice's detune
    // is still reachable from the depth gain either way, one hop further.
    expect(store.getState().synth.layers.A.voice.vibrato).toBe('Off')
    engine.noteOn(60, 0.8)
    const voiceOff = context.oscillators().slice(-1)[0]!
    const diagnosticsA = engine.diagnostics().synthChannels!.A
    const depth = diagnosticsA.vibrato.depth as unknown as FakeGain
    expect(depth.gain.value).toBe(0)
    const rampOff = depth.connections.find((n): n is FakeGain => n instanceof FakeGain && n.paramConnections.includes(voiceOff.detune))!
    expect(rampOff).toBeDefined() // connected either way, through the per-voice ramp
    expect(rampOff.gain.value).toBe(1) // pass-through outside Delayed mode
    engine.noteOff(60)

    // On: a fixed depth (voice.vibratoAmount, default 40 -> ~12.6 cents),
    // independent of the mod wheel.
    store.cycleSynthVibratoMode() // Off -> On
    engine.noteOn(62, 0.8)
    const voiceOn = context.oscillators().slice(-1)[0]!
    const depthOn = depth.gain.value
    expect(depthOn).toBeGreaterThan(0)
    const rampOn = depth.connections.find((n): n is FakeGain => n instanceof FakeGain && n.paramConnections.includes(voiceOn.detune))!
    expect(rampOn).toBeDefined()
    expect(rampOn.gain.value).toBe(1)
    store.setMorphSource('wheel', 127) // the wheel must NOT move the depth in On mode
    expect(depth.gain.value).toBe(depthOn)
    engine.noteOff(62)
  })

  it("Delayed vibrato's depth gain ramps (setTargetAtTime) vs On's immediate (unramped) per-voice gain", () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!

    store.cycleSynthVibratoMode() // Off -> On
    engine.noteOn(60, 0.8)
    const voiceOn = context.oscillators().slice(-1)[0]!
    const diagnosticsA = engine.diagnostics().synthChannels!.A
    const depth = diagnosticsA.vibrato.depth as unknown as FakeGain
    const rampOn = depth.connections.find((n): n is FakeGain => n instanceof FakeGain && n.paramConnections.includes(voiceOn.detune))!
    expect(rampOn.gain.events.some((e) => e.kind === 'target')).toBe(false) // On: no per-voice ramp
    engine.noteOff(60)

    store.cycleSynthVibratoMode() // On -> Wheel
    store.cycleSynthVibratoMode() // Wheel -> Delayed
    engine.noteOn(62, 0.8)
    const voiceDelayed = context.oscillators().slice(-1)[0]!
    const rampDelayed = depth.connections.find(
      (n): n is FakeGain => n instanceof FakeGain && n.paramConnections.includes(voiceDelayed.detune) && n !== rampOn,
    )!
    expect(rampDelayed).toBeDefined()
    expect(rampDelayed.gain.events[0]).toMatchObject({ kind: 'set', value: 0 }) // scheduled to start at 0
    expect(rampDelayed.gain.events.some((e) => e.kind === 'target')).toBe(true) // ramps toward full via setTargetAtTime
    engine.noteOff(62)
  })

  it('Pedal vibrato depth follows state.morphValues.pedal (mirrors Wheel)', () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    store.cycleSynthVibratoMode() // Off -> On
    store.cycleSynthVibratoMode() // On -> Wheel
    store.cycleSynthVibratoMode() // Wheel -> Delayed
    store.cycleSynthVibratoMode() // Delayed -> Pedal
    engine.noteOn(60, 0.8)

    store.setMorphSource('pedal', 0)
    const diagnosticsA = engine.diagnostics().synthChannels!.A
    const depthAtZero = diagnosticsA.vibrato.depth.gain.value
    expect(depthAtZero).toBe(0)
    store.setMorphSource('pedal', 127)
    const depthAtFull = diagnosticsA.vibrato.depth.gain.value
    expect(depthAtFull).toBeGreaterThan(depthAtZero)
    // The mod wheel must NOT move the depth in Pedal mode.
    store.setMorphSource('wheel', 0)
    expect(diagnosticsA.vibrato.depth.gain.value).toBe(depthAtFull)
    engine.noteOff(60)
  })
})

describe('synth.arp — deterministic scheduler', () => {
  it('Arp mode, range 1, Up: repeats the held set C·E·G in ascending order', () => {
    const { engine, store, timers } = makeSystem()
    engine.ensureStarted()
    store.setArpRate(127) // fastest schedule for a tight test loop
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)

    const heard: number[] = []
    for (let i = 0; i < 6; i++) {
      timers.advance(60000 / 300 + 1) // fastest possible BPM (300) step
      const sounding = [60, 64, 67].filter((m) => engine.isNoteActive(m))
      if (sounding.length > 0) heard.push(sounding[0]!)
    }
    expect(heard.slice(0, 3)).toEqual([60, 64, 67])
    expect(heard.slice(3, 6)).toEqual([60, 64, 67]) // repeats
  })

  it('Down direction reverses the sequence', () => {
    const { engine, store, timers } = makeSystem()
    engine.ensureStarted()
    store.setArpRate(127)
    store.cycleArpMode() // Arp stays Arp (no-op cycle target check below)
    store.cycleArpMode()
    store.cycleArpMode() // back to Arp after Poly/Gate
    store.cycleArpDirection() // Up -> Down
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)

    const heard: number[] = []
    for (let i = 0; i < 3; i++) {
      timers.advance(60000 / 300 + 1)
      const sounding = [60, 64, 67].filter((m) => engine.isNoteActive(m))
      if (sounding.length > 0) heard.push(sounding[0]!)
    }
    expect(heard).toEqual([67, 64, 60])
  })

  it('UpDown is a palindrome without repeating the turnaround notes', () => {
    const { engine, store, timers } = makeSystem()
    engine.ensureStarted()
    store.setArpRate(127)
    store.cycleArpDirection() // Up -> Down
    store.cycleArpDirection() // Down -> UpDown
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)

    const heard: number[] = []
    for (let i = 0; i < 4; i++) {
      timers.advance(60000 / 300 + 1)
      const sounding = [60, 64, 67].filter((m) => engine.isNoteActive(m))
      if (sounding.length > 0) heard.push(sounding[0]!)
    }
    expect(heard).toEqual([60, 64, 67, 64])
  })

  it('Random direction is reproducible for a fixed seed across two runs', () => {
    function runOnce(): number[] {
      const { engine, store, timers } = makeSystem()
      engine.ensureStarted()
      store.setArpRate(127)
      store.cycleArpDirection() // Up -> Down
      store.cycleArpDirection() // Down -> UpDown
      store.cycleArpDirection() // UpDown -> Random
      store.toggleArpRun()
      engine.noteOn(60, 0.8)
      engine.noteOn(64, 0.8)
      engine.noteOn(67, 0.8)
      const heard: number[] = []
      for (let i = 0; i < 5; i++) {
        timers.advance(60000 / 300 + 1)
        const sounding = [60, 64, 67].filter((m) => engine.isNoteActive(m))
        if (sounding.length > 0) heard.push(sounding[0]!)
      }
      return heard
    }
    expect(runOnce()).toEqual(runOnce()) // same fixed per-run seed both times
  })

  it('kbHold keeps the arp stepping after physical key-up', () => {
    const { engine, store, timers } = makeSystem()
    engine.ensureStarted()
    store.setArpRate(127)
    store.toggleKbHold()
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOff(60) // key lifted, but KB HOLD keeps it in the arp's set
    engine.noteOff(64)

    const heard = new Set<number>()
    for (let i = 0; i < 6; i++) {
      timers.advance(60000 / 300 + 1)
      for (const m of [60, 64]) if (engine.isNoteActive(m)) heard.add(m)
    }
    expect(heard.has(60)).toBe(true)
    expect(heard.has(64)).toBe(true)
  })

  it('Gate mode modulates the sounding voice gain without starting new voices', () => {
    const { engine, store, timers, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setArpRate(127)
    store.cycleArpMode() // Arp -> Poly
    store.cycleArpMode() // Poly -> Gate
    // A sustaining amp envelope so the voice is still audible between gate pulses.
    store.setSynthAmpEnvelope({ decay: 127 })
    engine.noteOn(60, 0.8)
    store.toggleArpRun() // arm the scheduler only once the note is already sounding
    const before = context.nodes.length
    timers.advance(60000 / 300 + 1)
    timers.advance(60000 / 300 + 1)
    const createdOscillators = voiceSourcesFor(context, before)
    expect(createdOscillators).toHaveLength(0) // no retrigger — Gate only modulates gain
    expect(engine.isNoteActive(60)).toBe(true)
    engine.noteOff(60)
  })

  it('Poly mode starts one new voice per held note per step, vs Arp mode\'s one note total', () => {
    const { engine, store, timers, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setArpRate(127)
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)

    // Arp mode: one step sounds exactly one note, so exactly one new voice
    // (one Pure-waveform oscillator) is created per step.
    let before = context.nodes.length
    timers.advance(60000 / 300 + 1)
    expect(voiceSourcesFor(context, before)).toHaveLength(1)

    store.cycleArpMode() // Arp -> Poly
    before = context.nodes.length
    timers.advance(60000 / 300 + 1)
    // Poly mode retriggers every held note each step: 3 new voices.
    expect(voiceSourcesFor(context, before)).toHaveLength(3)
    expect(engine.isNoteActive(60)).toBe(true)
    expect(engine.isNoteActive(64)).toBe(true)
    expect(engine.isNoteActive(67)).toBe(true)

    engine.noteOff(60)
    engine.noteOff(64)
    engine.noteOff(67)
  })

  it('range 2, Up, held {60}: alternating started-oscillator fundamentals an octave apart across steps', () => {
    const { engine, store, timers, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setArpRate(127)
    store.setArpRange(50) // range is quantized 1..4; a mid-low value lands on 2
    expect(store.getState().synth.arp.range).toBe(2)
    store.toggleArpRun()
    engine.noteOn(60, 0.8)

    const fundamentals: number[] = []
    for (let i = 0; i < 4; i++) {
      const before = context.nodes.length
      timers.advance(60000 / 300 + 1)
      const created = voiceSourcesFor(context, before)
      expect(created).toHaveLength(1) // one note sounding at a time (Arp mode)
      fundamentals.push(created[0]!.frequency.value)
    }
    // Range 2, Up, single held note 60: the direction-expanded sequence is
    // [60, 72] (an octave apart), stepped in a deterministic repeating order.
    expect(fundamentals[1]! / fundamentals[0]!).toBeCloseTo(2, 3) // 72 is an octave above 60
    expect(fundamentals[2]!).toBeCloseTo(fundamentals[0]!, 3) // repeats
    expect(fundamentals[3]!).toBeCloseTo(fundamentals[1]!, 3)
    engine.noteOff(60)
  })

  it('ARP RUN off stops the scheduler: pending timer count returns to baseline', () => {
    const { engine, store, timers } = makeSystem()
    engine.ensureStarted()
    store.setArpRate(127)
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    timers.advance(60000 / 300 + 1)
    expect(timers.pendingCount()).toBeGreaterThan(0)
    store.toggleArpRun()
    expect(timers.pendingCount()).toBe(0)
    engine.noteOff(60)
  })
})

describe('synth.arp — MST CLK substitution', () => {
  it('Shift + ARP RUN toggles master-clock rate substitution', () => {
    const { store } = makeSystem()
    expect(store.getState().synth.arp.mstClk).toBe(false)
    store.toggleArpClockSync()
    expect(store.getState().synth.arp.mstClk).toBe(true)
  })
})
