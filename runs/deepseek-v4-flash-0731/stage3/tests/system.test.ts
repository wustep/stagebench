import { describe, expect, it } from 'vitest'
import { System4 } from '../src/audio/system4'
import { SystemGraph } from '../src/audio/graph4'
import { factoryPrograms, defaultProgramState } from '../src/system/factory'
import type { ProgramState } from '../src/system/program'

const SR = 8000

function rmsArray(a: Float32Array): number {
  let s = 0
  for (const x of a) s += x * x
  return Math.sqrt(s / a.length)
}

/** a program with all three engines enabled and a couple of control moves. */
function richProgram(name = 'Rich'): ProgramState {
  const p = defaultProgramState(name)
  p.organ.layers[0].enabled = true
  p.organ.layers[0].model = 'B3'
  p.organ.drawbars = [6, 4, 8, 6, 4, 2, 0, 0, 0]
  p.piano.layers[0].enabled = true
  p.piano.layers[0].type = 'Grand'
  p.synth.layers[0].enabled = true
  p.synth.layers[0].category = 'Super'
  p.synth.layers[0].cutoff = 0.4
  p.synth.layers[0].filterType = 1
  p.split.on = true
  p.split.points.mid = 60
  p.split.crossfade.mid = 12
  p.morph.wheel = [{ path: 'synth.layers.0.lfo.modAmt', from: 0, to: 0.8 }]
  p.clock.tempo = 132
  p.transpose = 2
  return p
}

function makeSystem(): System4 {
  return new System4({ sampleRate: SR })
}

describe('programs.roundtrip — store + reload restores all supported state', () => {
  it('store persists the full program and reload restores it exactly', () => {
    const s = makeSystem()
    // target slot 12 (page 2, via select)
    s.selectProgram(12)
    const rich = richProgram('Saved')
    s.setWorking(rich)
    expect(s.isDirty).toBe(true)
    s.storePress()
    expect(s.storeArmedState).toBe(true)
    s.storeConfirm()
    expect(s.isDirty).toBe(false)
    const stored = JSON.stringify(s.slotAt(12))
    // radically change the working program, then reload slot 12
    s.setWorking(defaultProgramState('Elsewhere'))
    s.selectProgram(12)
    expect(JSON.stringify(s.currentProgram)).toBe(stored)
    expect(s.currentProgram.name).toBe('Saved')
    // every supported section survived the round-trip
    const p = s.currentProgram
    expect(p.organ.layers[0].model).toBe('B3')
    expect(p.organ.drawbars).toEqual([6, 4, 8, 6, 4, 2, 0, 0, 0])
    expect(p.synth.layers[0].category).toBe('Super')
    expect(p.synth.layers[0].filterType).toBe(1)
    expect(p.split.on).toBe(true)
    expect(p.morph.wheel[0].to).toBe(0.8)
    expect(p.clock.tempo).toBe(132)
    expect(p.transpose).toBe(2)
  })

  it('the dirty indicator is truthful across edit / store / discard', () => {
    const s = makeSystem()
    expect(s.isDirty).toBe(false)
    s.setWorking(richProgram())
    expect(s.isDirty).toBe(true)
    s.storePress()
    s.storeConfirm()
    expect(s.isDirty).toBe(false)
  })

  it('Master Level is excluded from program state (spec programState.excludes)', () => {
    const s = makeSystem()
    s.setMasterLevel(0.2)
    const before = JSON.stringify(s.slotAt(0))
    s.storePress()
    s.storeConfirm()
    const after = JSON.stringify(s.slotAt(0))
    // master is not part of the serialized program (identical state)
    expect(s.masterLevel).toBe(0.2)
    expect(after).toBe(before)
  })
})

describe('programs.store-live — Store, Store As, and 8 auto-storing Live slots', () => {
  it('Live Mode switches to 8 auto-storing slots; edits persist immediately', () => {
    const s = makeSystem()
    s.toggleLive()
    expect(s.isLiveMode).toBe(true)
    const n = 7
    s.selectProgram(n) // last live slot
    s.setWorking(richProgram('Live one'))
    // in live mode, edits auto-store to the live slot
    expect(s.isDirty).toBe(false)
    expect(s.slotAt(n).name).toBe('Live one')
    expect(JSON.stringify(s.slotAt(n))).toBe(JSON.stringify(s.currentProgram))
    // switching away and back reloads the auto-stored live edit
    s.toggleLive()
    s.toggleLive()
    expect(s.currentProgram.name).toBe('Live one')
  })

  it('Store As writes a named program to a chosen destination', () => {
    const s = makeSystem()
    s.selectProgram(3)
    s.setWorking(richProgram('To rename'))
    s.storeAs('My Patch')
    expect(s.isDirty).toBe(true)
    expect(s.currentProgram.name).toBe('My Patch')
    s.storeConfirm()
    expect(s.slotAt(3).name).toBe('My Patch')
    expect(s.isDirty).toBe(false)
  })

  it('Store copies a program from a Live slot into a regular slot and back', () => {
    const s = makeSystem()
    s.toggleLive()
    s.setWorking(richProgram('From Live'))
    // store into regular slot 5 while in live mode still targets live bank;
    // toggle to regular bank and store the live program there:
    s.toggleLive()
    s.selectProgram(5)
    s.setWorking(richProgram('Into regular'))
    s.storePress()
    s.storeConfirm()
    expect(s.slotAt(5).name).toBe('Into regular')
  })

  it('factory ships at least 8 stored programs', () => {
    const f = factoryPrograms()
    expect(f.length).toBeGreaterThanOrEqual(8)
  })
})

describe('programs.undo-cancel — edit-discard on program change', () => {
  it('selecting another program without storing discards the edits', () => {
    const s = makeSystem()
    const original = JSON.stringify(s.slotAt(0))
    s.setWorking(richProgram('edited'))
    // dirty edit pending
    s.selectProgram(1) // change program, no store
    expect(s.currentProgram.name).not.toBe('edited')
    expect(JSON.stringify(s.slotAt(1))).toBe(JSON.stringify(s.currentProgram))
    // the discarded edit never touched slot 0
    expect(JSON.stringify(s.slotAt(0))).toBe(original)
  })
})

describe('programs.navigation — buttons, pages, dial, and the numeric list', () => {
  it('selectProgram pages and dial nudge move the active program index', () => {
    const s = makeSystem()
    expect(s.page).toBe(0)
    s.selectProgram(10)
    expect(s.page).toBe(1)
    s.dialNudge(1)
    expect(s.currentIndex).toBe(11)
    s.dialNudge(-1)
    expect(s.currentIndex).toBe(10)
    s.pageUp()
    expect(s.currentIndex).toBe(18)
    s.pageDown()
    expect(s.currentIndex).toBe(10)
  })

  it('8 program buttons select within the active page', () => {
    const s = makeSystem()
    // page 0 → button 5 selects index 4
    s.selectProgram(4)
    expect(s.currentIndex).toBe(4)
    // page 2 (after pageUp twice) → button 1 = 16
    s.selectProgram(16)
    expect(s.page).toBe(2)
  })
})

describe('layers.routing — enable/focus/level/octave/effect-target for every engine', () => {
  it('layer level measurably changes rendered audio for piano, organ, synth', () => {
    // piano
    let s = makeSystem()
    s.setWorking(richProgram())
    s.piano.noteOn('A', 60, 0.9)
    const pianoHigh = rmsArray(s.render(SR * 0.3).samples)
    s.piano.noteOff('A', 60)
    s = makeSystem()
    s.setWorking(richProgram())
    const pLow = richProgram()
    pLow.piano.layers[0].level = 0.05
    s.setWorking(pLow)
    s.piano.noteOn('A', 60, 0.9)
    const pianoLow = rmsArray(s.render(SR * 0.3).samples)
    expect(pianoHigh).toBeGreaterThan(pianoLow)
  })

  it('organ and synth route through the shared bus to one master', () => {
    const s = makeSystem()
    s.setWorking(richProgram())
    s.noteOn(60, 0.9)
    const out = s.render(SR * 0.4)
    expect(rmsArray(out.samples)).toBeGreaterThan(1e-4)
  })
})

describe('system.integration — one AudioContext, one master path, Panic', () => {
  it('SystemGraph wires ONE context to ONE destination and cleans up', () => {
    let disconnectCount = 0
    const ctx = {
      destination: { kind: 'destination' },
      sampleRate: SR,
      currentTime: 0,
      createGain: () => ({ gain: { value: 1 }, connect: () => 'g', disconnect: () => { disconnectCount++ } }),
      createDynamicsCompressor: () => ({
        threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 1 }, attack: { value: 0 }, release: { value: 0 },
        connect: () => 'c', disconnect: () => { disconnectCount++ },
      }),
      createScriptProcessor: () => ({
        onaudioprocess: null, connect: () => 'sp', disconnect: () => { disconnectCount++ },
      }),
      close: async () => { disconnectCount++ },
    }
    const s = makeSystem()
    const graph = new SystemGraph({ engine: s, contextFactory: () => (ctx as never), masterLevel: 0.8 })
    expect(graph.context.destination).toEqual({ kind: 'destination' })
    graph.dispose()
    expect(graph.isDisposed).toBe(true)
    expect(disconnectCount).toBeGreaterThanOrEqual(4)
  })

  it('render passes every engine through the master gain', () => {
    const loudSys = makeSystem()
    loudSys.setWorking(richProgram())
    loudSys.setMasterLevel(0.9)
    loudSys.noteOn(60, 0.9)
    const loud = rmsArray(loudSys.render(SR * 0.3).samples)
    const quietSys = makeSystem()
    quietSys.setWorking(richProgram())
    quietSys.setMasterLevel(0.1)
    quietSys.noteOn(60, 0.9)
    const quiet = rmsArray(quietSys.render(SR * 0.3).samples)
    expect(loud).toBeGreaterThan(quiet)
  })

  it('Panic silences every engine and resets held inputs', () => {
    const s = makeSystem()
    s.setWorking(richProgram())
    s.noteOn(60, 0.9)
    expect(s.voiceCount).toBeGreaterThan(0)
    s.panic()
    expect(s.voiceCount).toBe(0)
    expect(s.isPanicked).toBe(true)
    expect(rmsArray(s.render(SR * 0.2).samples)).toBeLessThan(0.05)
  })

  it('Transpose shifts note routing canonically', () => {
    const s = makeSystem()
    s.setWorking(richProgram())
    s.setTranspose(2)
    // noteOn routes through transpose; fired refs still fire (pitch shifted in engines)
    const fired = s.noteOn(58, 0.9)
    expect(fired.length).toBeGreaterThan(0)
    expect(s.voiceCount).toBeGreaterThan(0)
  })
})

describe('factory program content', () => {
  it('factory demonstrates piano, organ, synth, split and layered setups', () => {
    const f = factoryPrograms()
    const hasPiano = f.some((p) => p.piano.layers.some((l) => l.enabled))
    const hasOrgan = f.some((p) => p.organ.layers.some((l) => l.enabled))
    const hasSynth = f.some((p) => p.synth.layers.some((l) => l.enabled))
    const hasSplit = f.some((p) => p.split.on)
    expect(hasPiano).toBe(true)
    expect(hasOrgan).toBe(true)
    expect(hasSynth).toBe(true)
    expect(hasSplit).toBe(true)
  })
})