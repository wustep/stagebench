import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, fakeStorageBoundary, FakeGain, FakeOscillator } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore, mappings, SYNTH_WAVEFORMS } from '../state/instrument'
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

  it('Mono retrigger resumes the amp envelope from the sounding level, never from silence (manual p. 34)', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.cycleSynthVoiceMode() // Poly -> Mono
    store.setSynthAmpEnvelope({ decay: 127 }) // sustain at peak between notes

    engine.noteOn(60, 0.8)
    const before = context.nodes.length
    engine.noteOn(64, 0.8) // retrigger while 60 is still at full level
    const newGains = context.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain)
    const envelopeGain = newGains.find((g) => g.gain.events.some((e) => e.kind === 'exp'))!
    const firstSet = envelopeGain.gain.events.find((e) => e.kind === 'set')!
    expect(firstSet.value!).toBeGreaterThan(0.01) // resumed near the previous level, not 0.0001
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

  it('a legato glide keeps each source’s frequency ratio: the Sub Osc stays an octave down (audit B2)', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    const subIndex = SYNTH_WAVEFORMS.findIndex((w) => w.name === 'Saw Sub')
    store.selectSynthWaveform(subIndex)
    store.cycleSynthVoiceMode() // Poly -> Mono
    store.cycleSynthVoiceMode() // Mono -> Legato
    store.setSynthGlide(80)

    const before = context.nodes.length
    engine.noteOn(60, 0.8)
    const voiceOscillators = voiceSourcesFor(context, before)
    engine.noteOn(72, 0.8) // overlapped: glide up an octave
    const targets = voiceOscillators
      .map((o) => o.frequency.events.filter((e) => e.kind === 'target').at(-1)?.value)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b)
    expect(targets).toHaveLength(2) // main + sub both glide
    // The sub's glide target is exactly half the main oscillator's.
    expect(targets[0]!).toBeCloseTo(targets[1]! / 2, 6)
    engine.noteOff(72)
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
    // The layer's always-running vibrato oscillator (spec voice.vibrato.menu:
    // "Rate 2.0-8.0 Hz", panel-editable; default layer rate maps to ~5.5 Hz).
    const defaultRateHz = mappings.vibratoRateHz(store.getState().synth.layers.A.voice.vibratoRate)
    expect(defaultRateHz).toBeCloseTo(5.5, 1)
    const vibratoOsc = context.oscillators().find((o) => o.type === 'sine' && Math.abs(o.frequency.value - defaultRateHz) < 0.01)!
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

  it('vibratoRate/vibratoAmount round-trip through the program snapshot (spec voice.vibrato.menu)', () => {
    const { store } = makeSystem()
    store.setSynthVibratoRate(0) // -> 2.0 Hz
    store.setSynthVibratoAmount(127) // -> displayed 10
    expect(store.getState().programs.dirty).toBe(true)
    store.storePress()
    store.storePress() // store into 1.1
    store.setSynthVibratoRate(64)
    store.setSynthVibratoAmount(0)
    store.selectProgram(1)
    store.selectProgram(0)
    const voice = store.getState().synth.layers.A.voice
    expect(voice.vibratoRate).toBe(0)
    expect(voice.vibratoAmount).toBe(127)
    expect(mappings.vibratoRateHz(voice.vibratoRate)).toBeCloseTo(2.0, 5)
    expect(mappings.vibratoAmountDisplay(voice.vibratoAmount)).toBeCloseTo(10, 5)
  })

  it("the vibrato LFO's oscillator frequency follows the mapped Rate (2.0 Hz .. 8.0 Hz endpoints)", () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    store.setSynthVibratoRate(0)
    const diagnosticsA = engine.diagnostics().synthChannels!.A
    const osc = diagnosticsA.vibrato.osc as unknown as FakeOscillator
    expect(osc.frequency.value).toBeCloseTo(2.0, 5)
    store.setSynthVibratoRate(127)
    expect(osc.frequency.value).toBeCloseTo(8.0, 5)
  })

  it('vibrato depth scales with the mapped Amount for every mode (On/Delayed/Wheel/Pedal)', () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    const diagnosticsA = engine.diagnostics().synthChannels!.A

    // On: depth is directly proportional to vibratoAmount.
    store.cycleSynthVibratoMode() // Off -> On
    store.setSynthVibratoAmount(0)
    engine.noteOn(60, 0.8)
    const depthAtZeroAmount = diagnosticsA.vibrato.depth.gain.value
    expect(depthAtZeroAmount).toBe(0)
    store.setSynthVibratoAmount(127)
    const depthAtFullAmount = diagnosticsA.vibrato.depth.gain.value
    expect(depthAtFullAmount).toBeGreaterThan(depthAtZeroAmount)
    engine.noteOff(60)

    // Wheel: live wheel position scaled DOWN by a low Amount vs a high one.
    store.cycleSynthVibratoMode() // On -> Wheel
    store.setSynthVibratoAmount(20)
    engine.noteOn(61, 0.8)
    store.setMorphSource('wheel', 127)
    const wheelDepthLowAmount = diagnosticsA.vibrato.depth.gain.value
    store.setSynthVibratoAmount(120)
    const wheelDepthHighAmount = diagnosticsA.vibrato.depth.gain.value
    expect(wheelDepthHighAmount).toBeGreaterThan(wheelDepthLowAmount)
    engine.noteOff(61)

    // Pedal: same scaling relationship as Wheel.
    store.cycleSynthVibratoMode() // Wheel -> Delayed
    store.cycleSynthVibratoMode() // Delayed -> Pedal
    store.setSynthVibratoAmount(20)
    engine.noteOn(62, 0.8)
    store.setMorphSource('pedal', 127)
    const pedalDepthLowAmount = diagnosticsA.vibrato.depth.gain.value
    store.setSynthVibratoAmount(120)
    const pedalDepthHighAmount = diagnosticsA.vibrato.depth.gain.value
    expect(pedalDepthHighAmount).toBeGreaterThan(pedalDepthLowAmount)
    engine.noteOff(62)
  })

  it('the VIBRATO MENU button toggles the Rate/Amount edit mode; dial 1 changes the displayed rate', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Synth Section On' }))
    const menuButton = screen.getByRole('button', { name: 'Synth Vibrato Menu' })
    fireEvent.click(menuButton)
    expect(screen.getByTestId('oled-synth-vibrato-line').textContent).toMatch(/Rate 5\.5 Hz/)
    const dial1 = screen.getByRole('slider', { name: 'Synth Display Dial 1' })
    fireEvent.keyDown(dial1, { key: 'End' }) // dial to max -> 8.0 Hz
    expect(screen.getByTestId('oled-synth-vibrato-line').textContent).toMatch(/Rate 8\.0 Hz/)
    // Closing the menu returns the OLED to its normal oscillator waveform view.
    fireEvent.click(menuButton)
    expect(screen.queryByTestId('oled-synth-vibrato-line')).toBeNull()
    expect(screen.getByTestId('oled-synth-ctrl-line')).toBeInTheDocument()
  })

  it('the VIBRATO MENU edit mode and an envelope edit mode are mutually exclusive', () => {
    const { store } = makeSystem()
    store.setSynthVibratoEdit(true)
    expect(store.getState().synthVibratoEdit).toBe(true)
    store.setSynthEnvEdit('amp')
    expect(store.getState().synthVibratoEdit).toBe(false) // engaging an envelope edit closes it
    expect(store.getState().synthEnvEdit).toBe('amp')
    store.setSynthVibratoEdit(true)
    expect(store.getState().synthEnvEdit).toBe(null) // and vice versa
    expect(store.getState().synthVibratoEdit).toBe(true)
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

  it('KB HOLD EXCLUDE (Shift + KB Hold) lets the focused layer release on key-up (manual p. 36)', () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    store.toggleKbHold()
    engine.noteOn(60, 0.8)
    engine.noteOff(60)
    expect(engine.isNoteActive(60)).toBe(true) // KB HOLD keeps it sounding
    store.toggleKbHoldExclude() // focused layer A opts out
    expect(store.getState().synth.layers.A.kbHoldExclude).toBe(true)
    engine.noteOn(64, 0.8)
    engine.noteOff(64)
    expect(engine.isNoteActive(64)).toBe(false) // excluded: releases normally
    expect(engine.isNoteActive(60)).toBe(true) // the earlier held note keeps ringing
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

  it('keys pressed WHILE Gate runs still sound (Gate gates played notes, never swallows them)', () => {
    const { engine, store, timers, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setArpRate(127)
    store.cycleArpMode() // Arp -> Poly
    store.cycleArpMode() // Poly -> Gate
    store.toggleArpRun()
    timers.advance(60000 / 300 + 1)
    const before = context.nodes.length
    engine.noteOn(62, 0.8) // pressed while the gate is already running
    expect(voiceSourcesFor(context, before).length).toBeGreaterThan(0)
    expect(engine.isNoteActive(62)).toBe(true)
    engine.noteOff(62)
    expect(engine.isNoteActive(62)).toBe(false)
  })

  it('the gate pulses a dedicated stage — the amp envelope’s scheduled ramps survive (audit B5)', () => {
    const { engine, store, timers, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setArpRate(127)
    store.cycleArpMode()
    store.cycleArpMode() // Gate
    store.setSynthAmpEnvelope({ decay: 60 })
    const before = context.nodes.length
    engine.noteOn(60, 0.8)
    // The voice's envelope gain: first gain node created for the press.
    const created = (context.nodes as unknown[]).slice(before)
    const envelopeGain = created.find((n) => (n as { kind?: string }).kind === 'gain') as {
      gain: { events: Array<{ kind: string }> }
    }
    const scheduled = envelopeGain.gain.events.length
    store.toggleArpRun()
    timers.advance(60000 / 300 + 1)
    timers.advance(60000 / 300 + 1)
    // Gate pulses never cancel anything on the envelope gain.
    expect(envelopeGain.gain.events.slice(scheduled).filter((e) => e.kind === 'cancel')).toHaveLength(0)
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

  it('half-step ranges add "a fifth on top" (manual p. 35): range 1.5 steps the root then a fifth up', () => {
    const { engine, store, timers, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setArpRate(127)
    store.setArpRange(21) // 7-step knob: this lands on 1.5 = 1 octave + a 5th
    expect(store.getState().synth.arp.range).toBe(1.5)
    expect(store.getState().lastEdit).toMatch(/1 octave \+ a 5th/)
    store.toggleArpRun()
    engine.noteOn(60, 0.8)

    const fundamentals: number[] = []
    for (let i = 0; i < 2; i++) {
      const before = context.nodes.length
      timers.advance(60000 / 300 + 1)
      const created = voiceSourcesFor(context, before)
      expect(created).toHaveLength(1)
      fundamentals.push(created[0]!.frequency.value)
    }
    expect(fundamentals[1]! / fundamentals[0]!).toBeCloseTo(Math.pow(2, 7 / 12), 3) // a perfect fifth up
    engine.noteOff(60)
  })

  it('ARP RUN off stops the scheduler: no further steps sound', () => {
    const { engine, store, timers, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setArpRate(127)
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    timers.advance(60000 / 300 + 1)
    expect(timers.pendingCount()).toBeGreaterThan(0)
    store.toggleArpRun()
    // Run-off releases the arp's voice and re-sounds the held key normally
    // (its release/cleanup timers may be pending) — but the STEP timer is
    // gone: advancing far past several step intervals starts no arp notes.
    timers.advance(60000) // flush every pending cleanup
    const before = context.nodes.length
    timers.advance((60000 / 300) * 8)
    expect(voiceSourcesFor(context, before)).toHaveLength(0)
    expect(timers.pendingCount()).toBe(0)
    engine.noteOff(60)
  })

  it('ARP RUN off releases the scheduler’s sounding note and re-sounds held keys (audit B3)', () => {
    const { engine, store, timers } = makeSystem()
    engine.ensureStarted()
    store.setArpRate(127)
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    timers.advance(60000 / 300 + 1) // one arp step is sounding
    store.toggleArpRun()
    // Default Poly voice mode: both held keys sound normally again, and
    // nothing hangs when the keys lift.
    expect(engine.isNoteActive(60)).toBe(true)
    expect(engine.isNoteActive(64)).toBe(true)
    engine.noteOff(60)
    engine.noteOff(64)
    expect(engine.isNoteActive(60)).toBe(false)
    expect(engine.isNoteActive(64)).toBe(false)
  })
})

describe('synth.arp — KBS keyboard sync (manual p. 41)', () => {
  it('KBS On: the first key on a silent keyboard restarts the clock — the step sounds NOW', () => {
    const { engine, store, timers, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setArpRate(127) // step = 200 ms
    store.cycleMasterClockKbs() // Off -> On
    expect(store.getState().masterClock.kbs).toBe('On')
    store.toggleArpRun()
    timers.advance(50) // scheduler mid-interval, keyboard silent

    let before = context.nodes.length
    engine.noteOn(60, 0.8)
    const immediate = voiceSourcesFor(context, before)
    expect(immediate).toHaveLength(1) // sounded on the key press, not the old grid

    // The beat re-anchored to the key press: the next step is a full
    // interval later, not on the old scheduler's phase.
    before = context.nodes.length
    timers.advance(60000 / 300 - 2)
    expect(voiceSourcesFor(context, before)).toHaveLength(0)
    timers.advance(4)
    expect(voiceSourcesFor(context, before)).toHaveLength(1)
    engine.noteOff(60)
  })

  it('KBS Soft: the pattern restarts from step one at the NEXT beat — clock phase untouched', () => {
    const { engine, store, timers, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setArpRate(127)
    store.cycleMasterClockKbs() // Off -> On
    store.cycleMasterClockKbs() // On -> Soft
    expect(store.getState().synth.arp.run).toBe(false)
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)
    let before = context.nodes.length
    timers.advance(60000 / 300 + 1) // step: sounds 60, step index moves to 1
    const first = voiceSourcesFor(context, before)
    expect(first).toHaveLength(1)
    const rootHz = first[0]!.frequency.value

    // New phrase mid-interval: release everything, press again.
    engine.noteOff(60)
    engine.noteOff(64)
    engine.noteOff(67)
    timers.advance(50)
    before = context.nodes.length
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)
    expect(voiceSourcesFor(context, before)).toHaveLength(0) // Soft: nothing sounds early

    // The next beat sounds the FIRST step (60) again — without KBS the
    // preserved step counter would have sounded 64 here.
    timers.advance(60000 / 300)
    const next = voiceSourcesFor(context, before)
    expect(next).toHaveLength(1)
    expect(next[0]!.frequency.value).toBeCloseTo(rootHz, 3)
    engine.noteOff(60)
    engine.noteOff(64)
    engine.noteOff(67)
  })

  it('KBS Off keeps the step counter across a new phrase (the pre-KBS behavior)', () => {
    const { engine, store, timers, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setArpRate(127)
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)
    let before = context.nodes.length
    timers.advance(60000 / 300 + 1) // sounds 60, index -> 1
    const rootHz = voiceSourcesFor(context, before)[0]!.frequency.value

    engine.noteOff(60)
    engine.noteOff(64)
    engine.noteOff(67)
    timers.advance(50)
    before = context.nodes.length
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)
    timers.advance(60000 / 300)
    const next = voiceSourcesFor(context, before)
    expect(next).toHaveLength(1)
    expect(next[0]!.frequency.value / rootHz).toBeCloseTo(Math.pow(2, 4 / 12), 3) // 64: the counter kept walking
    engine.noteOff(60)
    engine.noteOff(64)
    engine.noteOff(67)
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

describe('synth.arp — Arpeggiator Menu page 1: Direction / Zig Zag (manual p. 35)', () => {
  it('Zig Zag on, Up, held {60,64,67,71}: notes jump two steps forward then one back', () => {
    const { engine, store, timers } = makeSystem()
    engine.ensureStarted()
    store.setArpRate(127)
    store.setArpZigZag(true)
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)
    engine.noteOn(71, 0.8)

    const heard: number[] = []
    for (let i = 0; i < 8; i++) {
      timers.advance(60000 / 300 + 1)
      const sounding = [60, 64, 67, 71].filter((m) => engine.isNoteActive(m))
      if (sounding.length > 0) heard.push(sounding[0]!)
    }
    // Manual p. 35: "played notes will jump by two steps and then back one,
    // in a given direction" — the walked positions over [60,64,67,71] are
    // 0,2,1,3,2,4,3,5,… wrapping modulo the sequence length.
    expect(heard).toEqual([60, 67, 64, 71, 67, 60, 71, 64])
  })

  it('Zig Zag off keeps the existing plain Up order over the same held set', () => {
    const { engine, store, timers } = makeSystem()
    engine.ensureStarted()
    store.setArpRate(127)
    store.toggleArpRun()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)
    engine.noteOn(71, 0.8)

    const heard: number[] = []
    for (let i = 0; i < 8; i++) {
      timers.advance(60000 / 300 + 1)
      const sounding = [60, 64, 67, 71].filter((m) => engine.isNoteActive(m))
      if (sounding.length > 0) heard.push(sounding[0]!)
    }
    expect(heard).toEqual([60, 64, 67, 71, 60, 64, 67, 71])
  })

  it('Random direction stays reproducible for a fixed seed with Zig Zag on (draw path untouched)', () => {
    function runOnce(zigZag: boolean): number[] {
      const { engine, store, timers } = makeSystem()
      engine.ensureStarted()
      store.setArpRate(127)
      store.setArpZigZag(zigZag)
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
    // Zig Zag has no defined order to apply to a fresh random draw each
    // step, so the xorshift sequence must be byte-identical either way.
    expect(runOnce(true)).toEqual(runOnce(false))
  })

  it('the MENU button latches the OLED dials onto page/Direction/Zig Zag; dial 1 stays on the one implemented page', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Synth Section On' }))
    const menuButton = screen.getByRole('button', { name: 'Arpeggiator Menu' })
    fireEvent.click(menuButton)
    const line = () => screen.getByTestId('oled-synth-arp-menu-line').textContent
    expect(line()).toMatch(/ARP MENU 1\/1 · DIR Up · ZIG ZAG Off/)
    const dial2 = screen.getByRole('slider', { name: 'Synth Display Dial 2' })
    fireEvent.keyDown(dial2, { key: 'End' }) // absolute list position -> Random
    expect(line()).toMatch(/DIR Random/)
    fireEvent.keyDown(dial2, { key: 'Home' }) // -> Up
    expect(line()).toMatch(/DIR Up ·/)
    const dial3 = screen.getByRole('slider', { name: 'Synth Display Dial 3' })
    fireEvent.keyDown(dial3, { key: 'End' })
    expect(line()).toMatch(/ZIG ZAG On/)
    // Dial 1 navigates menu pages; only page 1 (Direction/Zig Zag) is
    // implemented, so navigation truthfully stays on 1/1.
    const dial1 = screen.getByRole('slider', { name: 'Synth Display Dial 1' })
    fireEvent.keyDown(dial1, { key: 'End' })
    expect(line()).toMatch(/ARP MENU 1\/1/)
    // Closing the menu returns the OLED to its normal waveform view.
    fireEvent.click(menuButton)
    expect(screen.queryByTestId('oled-synth-arp-menu-line')).toBeNull()
    expect(screen.getByTestId('oled-synth-ctrl-line')).toBeInTheDocument()
  })

  it('the ARP MENU edit mode is mutually exclusive with the other latched dial modes', () => {
    const { store } = makeSystem()
    store.setSynthArpMenuEdit(true)
    expect(store.getState().synthArpMenuEdit).toBe(true)
    store.setSynthEnvEdit('amp')
    expect(store.getState().synthArpMenuEdit).toBe(false) // engaging an envelope edit closes it
    store.setSynthArpMenuEdit(true)
    expect(store.getState().synthEnvEdit).toBe(null) // and vice versa
    store.setSynthVibratoEdit(true)
    expect(store.getState().synthArpMenuEdit).toBe(false)
    store.setSynthArpMenuEdit(true)
    expect(store.getState().synthVibratoEdit).toBe(false)
    store.setSynthOscPitchEdit(true)
    expect(store.getState().synthArpMenuEdit).toBe(false)
    store.setSynthArpMenuEdit(true)
    expect(store.getState().synthOscPitchEdit).toBe(false)
  })

  it('arp.zigZag round-trips through the program snapshot', () => {
    const { store } = makeSystem()
    store.setArpZigZag(true)
    expect(store.getState().programs.dirty).toBe(true)
    store.storePress()
    store.storePress() // store into the current slot
    store.setArpZigZag(false)
    store.selectProgram(1)
    store.selectProgram(0)
    expect(store.getState().synth.arp.zigZag).toBe(true)
  })

  it('an old persisted snapshot whose arp lacks zigZag backfills to Off', () => {
    const seed = new InstrumentStore()
    const strip = (slot: { name: string; snapshot: unknown }) => {
      const snapshot = JSON.parse(JSON.stringify(slot.snapshot)) as { synth: { arp: Record<string, unknown> } }
      delete snapshot.synth.arp.zigZag
      return { name: slot.name, snapshot }
    }
    const rawBank = seed.getState().programs.bank.map(strip)
    const rawLive = seed.getState().programs.live.map(strip)
    const storage = fakeStorageBoundary({
      'stagebench.programs.v1': JSON.stringify({ version: 1, bank: rawBank, live: rawLive, liveMode: false, current: 0 }),
    })
    expect(() => new InstrumentStore(storage)).not.toThrow()
    const restored = new InstrumentStore(storage)
    expect(restored.getState().synth.arp.zigZag).toBe(false)
    restored.selectProgram(3)
    expect(restored.getState().synth.arp.zigZag).toBe(false)
  })
})
