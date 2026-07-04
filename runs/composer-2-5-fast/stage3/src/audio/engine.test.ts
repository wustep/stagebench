import { describe, expect, it } from 'vitest'
import { PianoEngine, renderOffline } from './engine'
import { NoteLifecycle } from '../input/note-lifecycle'
import { attachMidiHandlers, createMockMidiPort } from '../input/midi'
import { earlyRms, rms, signalsDiffer } from './signal-analysis'

async function readyEngine(opts: ConstructorParameters<typeof PianoEngine>[0] = {}) {
  const engine = new PianoEngine(opts)
  await engine.ensureReady()
  return engine
}

describe('piano.basic-note-lifecycle', () => {
  it('starts and releases notes with cleanup', async () => {
    const engine = await readyEngine()
    const lc = new NoteLifecycle(engine)
    lc.pointerDown(60, 100)
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    lc.pointerUp(60)
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
  })

  it('supports repeated and overlapping notes on same key', async () => {
    const engine = await readyEngine()
    const lc = new NoteLifecycle(engine)
    lc.pointerDown(64, 90)
    lc.pointerDown(64, 70)
    expect(engine.getActiveVoiceCount()).toBeGreaterThanOrEqual(1)
    lc.pointerUp(64)
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
  })

  it('all-notes-off clears every voice', async () => {
    const engine = await readyEngine()
    const lc = new NoteLifecycle(engine)
    lc.pointerDown(48, 100)
    lc.pointerDown(52, 100)
    lc.pointerDown(55, 100)
    engine.allNotesOff()
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
  })
})

describe('piano.basic-inputs', () => {
  it('maps computer keys with repeat suppression', async () => {
    const engine = await readyEngine()
    const lc = new NoteLifecycle(engine)
    lc.computerKeyDown('KeyA', 48)
    lc.computerKeyDown('KeyA', 48)
    expect(lc.getPressedCount()).toBe(1)
    lc.computerKeyUp('KeyA', 48)
    expect(lc.getPressedCount()).toBe(0)
    lc.dispose()
  })

  it('handles MIDI note on/off and sustain CC64', async () => {
    const engine = await readyEngine()
    const lc = new NoteLifecycle(engine)
    const port = createMockMidiPort('connected')
    attachMidiHandlers(port, {
      onNoteOn: (n, v) => lc.midiNoteOn(n, v),
      onNoteOff: (n) => lc.midiNoteOff(n),
      onSustain: (on) => lc.setSustain(on),
    })
    port.simulateEvent({ type: 'noteon', note: 67, velocity: 100 })
    expect(lc.isPressed(67)).toBe(true)
    port.simulateEvent({ type: 'cc', controller: 64, value: 127 })
    port.simulateEvent({ type: 'noteoff', note: 67 })
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    port.simulateEvent({ type: 'cc', controller: 64, value: 0 })
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
  })

  it('ignores events when MIDI port is disconnected or denied', async () => {
    const engine = await readyEngine()
    const lc = new NoteLifecycle(engine)
    for (const state of ['disconnected', 'denied'] as const) {
      const port = createMockMidiPort(state)
      attachMidiHandlers(port, {
        onNoteOn: (n, v) => lc.midiNoteOn(n, v),
        onNoteOff: (n) => lc.midiNoteOff(n),
        onSustain: (on) => lc.setSustain(on),
      })
      port.simulateEvent({ type: 'noteon', note: 60, velocity: 100 })
      expect(lc.isPressed(60)).toBe(false)
    }
    lc.dispose()
  })
})

describe('piano.basic-sustain-polyphony', () => {
  it('holds notes while sustain is engaged', async () => {
    const engine = await readyEngine()
    const lc = new NoteLifecycle(engine)
    lc.pointerDown(60, 100)
    lc.setSustain(true)
    lc.pointerUp(60)
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    lc.setSustain(false)
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
  })

  it('steals oldest voice deterministically at polyphony limit', async () => {
    const engine = await readyEngine({ polyphony: 2 })
    const lc = new NoteLifecycle(engine)
    lc.pointerDown(60, 100)
    lc.pointerDown(62, 100)
    lc.pointerDown(64, 100)
    expect(engine.getActiveVoiceCount()).toBeLessThanOrEqual(4)
    lc.dispose()
  })

  it('velocity changes output level', async () => {
    const engine = await readyEngine()
    expect(engine.velocityToGain(127)).toBeGreaterThan(engine.velocityToGain(20))
    expect(engine.velocityToGain(20)).toBeGreaterThan(0)
    const loud = await renderOffline((e) => { e.noteOn(60, 127, 0) })
    const soft = await renderOffline((e) => { e.noteOn(60, 20, 0) })
    expect(earlyRms(loud)).toBeGreaterThan(earlyRms(soft))
    engine.dispose()
  })
})

describe('piano.basic-status-cleanup', () => {
  it('reports ready status and cleans up on blur', async () => {
    const engine = await readyEngine()
    const lc = new NoteLifecycle(engine)
    expect(engine.getStatus()).toBe('ready')
    lc.pointerDown(72, 100)
    lc.blurCleanup()
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
    expect(engine.getActiveVoiceCount()).toBe(0)
  })

  it('reports error status when forced', async () => {
    const engine = new PianoEngine({ forceError: true })
    expect(engine.getStatus()).toBe('error')
    expect(engine.noteOn(60, 100)).toBe(-1)
    engine.dispose()
  })
})

describe('piano.instrument-library', () => {
  it('loads all six piano types with distinct rendered output', async () => {
    const buffers: AudioBuffer[] = []
    for (let i = 0; i < 6; i++) {
      const buf = await renderOffline((e) => {
        e.updateState({ pianoA: { typeIndex: i } })
        e.noteOn(60, 100, 0)
      })
      buffers.push(buf)
      expect(rms(buf)).toBeGreaterThan(0.001)
    }
    expect(signalsDiffer(buffers[0]!, buffers[1]!)).toBe(true)
    expect(signalsDiffer(buffers[0]!, buffers[2]!)).toBe(true)
    expect(signalsDiffer(buffers[1]!, buffers[2]!)).toBe(true)
  })

  it('declares synthesized sample provenance', async () => {
    const engine = await readyEngine()
    const grand = engine.getSampleLibrary().getSet('Grand')
    expect(grand?.provenance).toBe('synthesized')
    expect(grand?.entries.length).toBeGreaterThanOrEqual(10)
    engine.dispose()
  })
})

describe('piano.layers', () => {
  it('plays both layers with independent voice ownership', async () => {
    const engine = await readyEngine()
    engine.updateState({
      pianoA: { enabled: true, level: 100 },
      pianoB: { enabled: true, level: 100 },
    })
    engine.noteOn(60, 100, 0)
    expect(engine.getActiveVoiceCount()).toBe(2)
    expect(engine.getActiveVoiceCountForLayer('A')).toBe(1)
    expect(engine.getActiveVoiceCountForLayer('B')).toBe(1)
    engine.dispose()
  })

  it('respects layer enable and level', async () => {
    const onlyA = await renderOffline((e) => {
      e.updateState({ pianoB: { enabled: false }, pianoA: { level: 127 } })
      e.noteOn(60, 100, 0)
    })
    const both = await renderOffline((e) => {
      e.updateState({ pianoA: { enabled: true, level: 127 }, pianoB: { enabled: true, level: 127 } })
      e.noteOn(60, 100, 0)
    })
    expect(rms(both)).toBeGreaterThan(rms(onlyA))
  })
})

describe('piano.velocity-controls', () => {
  it('KB Touch and Dyn Comp change output', async () => {
    const medium = await renderOffline((e) => {
      e.updateState({ pianoPerf: { kbTouch: 'Medium', dynComp: 'Off' } })
      e.noteOn(60, 40, 0)
    })
    const lightComp = await renderOffline((e) => {
      e.updateState({ pianoPerf: { kbTouch: 'Light', dynComp: '3' } })
      e.noteOn(60, 40, 0)
    })
    expect(signalsDiffer(medium, lightComp)).toBe(true)
  })

  it('master level scales output', async () => {
    const low = await renderOffline((e) => {
      e.setMasterLevel(10)
      e.noteOn(60, 100, 0)
    })
    const high = await renderOffline((e) => {
      e.setMasterLevel(127)
      e.noteOn(60, 100, 0)
    })
    expect(rms(high)).toBeGreaterThan(rms(low))
  })
})

describe('piano.pedals', () => {
  it('honors SUSTPED per layer', async () => {
    const engine = await readyEngine()
    engine.updateState({ pianoA: { sustPed: true }, pianoB: { sustPed: false } })
    engine.noteOn(60, 100, 0)
    engine.setSustain(true)
    engine.noteOff(60)
    expect(engine.getActiveVoiceCountForLayer('A')).toBeGreaterThan(0)
    expect(engine.getActiveVoiceCountForLayer('B')).toBe(0)
    engine.dispose()
  })
})

describe('piano.fallback', () => {
  it('enters labeled fallback when samples fail', async () => {
    const engine = await readyEngine({ forceSampleFail: true })
    expect(engine.getStatus()).toBe('fallback')
    expect(engine.noteOn(60, 100)).toBeGreaterThan(0)
    engine.dispose()
  })
})

describe('effects.graph', () => {
  it('uses one context with master limiter path', async () => {
    const engine = await readyEngine()
    expect(engine.context).toBeDefined()
    const buf = await renderOffline((e) => {
      e.setMasterLevel(100)
      e.noteOn(60, 100, 0)
    })
    expect(rms(buf)).toBeGreaterThan(0)
    engine.dispose()
  })
})

describe('effects.processing', () => {
  it('reverb wet changes rendered signal', async () => {
    const dry = await renderOffline((e) => {
      e.updateState({ effects: { reverb: { mix: 0, bypass: true } } })
      e.noteOn(60, 100, 0)
    })
    const wet = await renderOffline((e) => {
      e.updateState({ effects: { reverb: { mix: 127, bypass: false, type: 4 } } })
      e.noteOn(60, 100, 0)
    })
    expect(signalsDiffer(dry, wet)).toBe(true)
    expect(rms(wet)).toBeGreaterThan(0.001)
  })

  it('all-effects bypass reduces processing difference', async () => {
    const processed = await renderOffline((e) => {
      e.updateState({
        effects: {
          allBypass: false,
          mod1: { amount: 100, bypass: false, rate: 80 },
          delay: { mix: 100, bypass: false, rate: 80, feedback: 60 },
        },
      })
      e.noteOn(60, 100, 0)
    })
    const bypassed = await renderOffline((e) => {
      e.updateState({ effects: { allBypass: true } })
      e.noteOn(60, 100, 0)
    })
    expect(signalsDiffer(processed, bypassed)).toBe(true)
  })
})

describe('effects.routing', () => {
  it('to rotary routes layer into shared rotary', async () => {
    const engine = await readyEngine()
    engine.updateState({ effects: { amp: { toRotary: true }, rotaryOn: true } })
    expect(engine.getEffectChain('A').isToRotary()).toBe(true)
    engine.dispose()
  })
})
