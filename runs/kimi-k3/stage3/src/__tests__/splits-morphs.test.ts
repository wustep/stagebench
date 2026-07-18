import { describe, expect, it } from 'vitest'
import { makeRig } from '../test-helpers'
import { rms } from '../audio/fake-backend'
import { zoneGain, zoneOfNote, SPLIT_POSITION_MIDI, type SplitState } from '../state/program-state'
import { defaultSplitState } from '../state/program-state'

function splitWith(mut: (s: SplitState) => void): SplitState {
  const s = defaultSplitState()
  mut(s)
  return s
}

describe('splits.zones', () => {
  it('the 11 documented split positions are C2..C7 F-and-C only', () => {
    const positions = Object.keys(SPLIT_POSITION_MIDI)
    expect(positions).toEqual(['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'])
    expect(SPLIT_POSITION_MIDI.C4).toBe(60)
    expect(SPLIT_POSITION_MIDI.F3).toBe(53)
  })

  it('up to 4 zones from 3 split points; notes map to the right zone', () => {
    const s = splitWith((sp) => {
      sp.on = true
      sp.points.Low.enabled = true
      sp.points.Low.position = 2 // C3
      sp.points.Mid.enabled = true
      sp.points.Mid.position = 4 // C4
      sp.points.High.enabled = true
      sp.points.High.position = 6 // C5
    })
    expect(zoneOfNote(s, 28)).toBe(0)
    expect(zoneOfNote(s, 48)).toBe(1)
    expect(zoneOfNote(s, 60)).toBe(2)
    expect(zoneOfNote(s, 72)).toBe(3)
    expect(zoneOfNote(s, 100)).toBe(3)
  })

  it('zone assignment gates notes: layers outside their range stay silent', async () => {
    const { engine, backend } = await makeRig()
    engine.setSectionOn(false)
    engine.update(() => {
      engine.organ.sectionOn = true
      engine.split.on = true
      engine.split.points.Mid.enabled = true
      engine.split.points.Mid.position = 4 // C4
      engine.split.zones.organA = { lo: 0, hi: 0 } // organ only below C4
    })
    // Below the split: organ sounds.
    engine.noteOn(48, 0.9)
    backend.advance(0.02)
    expect(rms(backend.renderMix(0.3))).toBeGreaterThan(0.001)
    engine.allNotesOff()
    // Above the split: the organ is gated out — no voice, no sound.
    engine.noteOn(72, 0.9)
    backend.advance(0.02)
    expect(rms(backend.renderMix(0.3))).toBeLessThan(1e-5)
    expect(backend.activeVoiceCount()).toBe(0) // gated out: no voice started
  })

  it('crossfade Off switches hard; ±6/±12 fade across the window', () => {
    const mk = (xfade: number) =>
      splitWith((sp) => {
        sp.on = true
        sp.points.Mid.enabled = true
        sp.points.Mid.position = 4 // C4 = 60
        sp.points.Mid.xfade = xfade
        sp.zones.pianoA = { lo: 1, hi: 1 } // upper zone only
      })
    // Off: immediate switch.
    const off = mk(0)
    expect(zoneGain(off, 'pianoA', 59)).toBe(0)
    expect(zoneGain(off, 'pianoA', 60)).toBe(1)
    // ±6: at the boundary gain 0.5, full at +6; the fade tail extends
    // ±6 across the boundary (54 → 0).
    const six = mk(1)
    expect(zoneGain(six, 'pianoA', 60)).toBeCloseTo(0.5, 5)
    expect(zoneGain(six, 'pianoA', 63)).toBeCloseTo(0.75, 5)
    expect(zoneGain(six, 'pianoA', 66)).toBe(1)
    expect(zoneGain(six, 'pianoA', 54)).toBe(0)
    expect(zoneGain(six, 'pianoA', 57)).toBeCloseTo(0.25, 5)
    // ±12: wider window.
    const twelve = mk(2)
    expect(zoneGain(twelve, 'pianoA', 54)).toBeCloseTo(0.25, 5)
    expect(zoneGain(twelve, 'pianoA', 48)).toBe(0)
    expect(zoneGain(twelve, 'pianoA', 60)).toBeCloseTo(0.5, 5)
    expect(zoneGain(twelve, 'pianoA', 72)).toBe(1)
  })

  it('crossfade gains are observable in rendered audio', async () => {
    const { engine, backend } = await makeRig()
    engine.update(() => {
      engine.split.on = true
      engine.split.points.Mid.enabled = true
      engine.split.points.Mid.position = 4
      engine.split.points.Mid.xfade = 1 // ±6
      engine.split.zones.pianoA = { lo: 1, hi: 1 }
    })
    engine.noteOn(61, 0.9) // inside the fade window: partial gain (~0.58)
    backend.advance(0.02)
    const faded = backend.renderMix(0.3)
    engine.allNotesOff()
    engine.update(() => {
      engine.split.points.Mid.xfade = 0 // hard switch: same note = full
    })
    engine.noteOn(61, 0.9)
    backend.advance(0.02)
    const full = backend.renderMix(0.3)
    expect(rms(faded)).toBeLessThan(rms(full) * 0.9)
  })

  it('split point enable/position edits are canonical state (round-tripable)', async () => {
    const { engine } = await makeRig()
    engine.update(() => {
      engine.split.on = true
      engine.split.points.High.enabled = true
      engine.split.points.High.position = 10 // C7
      engine.split.points.High.xfade = 2
    })
    engine.storeTo(9, 'Split Test')
    engine.loadSlot(0)
    engine.loadSlot(9)
    expect(engine.split.points.High.enabled).toBe(true)
    expect(engine.split.points.High.position).toBe(10)
    expect(engine.split.points.High.xfade).toBe(2)
  })
})

describe('morph.assignments', () => {
  it('assignment interpolates destinations between from and to', async () => {
    const { engine } = await makeRig()
    expect(engine.assignMorph('wheel', 'synth.filterCutoff', 20, 120)).toBe(true)
    const at0 = engine.setMorphPosition('wheel', 0)
    expect(at0).toEqual([{ controlId: 'synth.filterCutoff', value: 20 }])
    const atHalf = engine.setMorphPosition('wheel', 0.5)
    expect(atHalf[0].value).toBeCloseTo(70, 5)
    const at1 = engine.setMorphPosition('wheel', 1)
    expect(at1[0].value).toBeCloseTo(120, 5)
  })

  it('a morph may increase one destination while decreasing another', async () => {
    const { engine } = await makeRig()
    engine.assignMorph('wheel', 'synth.filterCutoff', 0, 127)
    engine.assignMorph('wheel', 'organ.level', 127, 0)
    const moves = engine.setMorphPosition('wheel', 0.5)
    const cutoff = moves.find((m) => m.controlId === 'synth.filterCutoff')!
    const level = moves.find((m) => m.controlId === 'organ.level')!
    expect(cutoff.value).toBeCloseTo(63.5, 1)
    expect(level.value).toBeCloseTo(63.5, 1)
    expect(cutoff.value).toBeGreaterThan(0)
    expect(level.value).toBeLessThan(127)
  })

  it('multiple destinations per source; sources are independent', async () => {
    const { engine } = await makeRig()
    engine.assignMorph('wheel', 'synth.filterCutoff', 0, 127)
    engine.assignMorph('ctrlPedal', 'synth.filterResonance', 0, 100)
    const wheelMoves = engine.setMorphPosition('wheel', 1)
    expect(wheelMoves.length).toBe(1)
    expect(wheelMoves[0].controlId).toBe('synth.filterCutoff')
    const pedalMoves = engine.setMorphPosition('ctrlPedal', 1)
    expect(pedalMoves[0].controlId).toBe('synth.filterResonance')
  })

  it('morph indicators: assigned controls report their LED', async () => {
    const { engine } = await makeRig()
    expect(engine.morphAssignedControls().size).toBe(0)
    engine.assignMorph('wheel', 'synth.lfoRate', 10, 100)
    expect(engine.morphAssignedControls().has('synth.lfoRate')).toBe(true)
  })

  it('clearing: per-source clear removes all; zeroing removes a single assignment', async () => {
    const { engine } = await makeRig()
    engine.assignMorph('wheel', 'synth.filterCutoff', 0, 127)
    engine.assignMorph('wheel', 'organ.level', 100, 20)
    engine.assignMorph('ctrlPedal', 'synth.filterCutoff', 30, 90)
    // Zero a single control (from === to removes it).
    engine.assignMorph('wheel', 'organ.level', 50, 50)
    expect(engine.morphs.wheel.length).toBe(1)
    expect(engine.morphs.ctrlPedal.length).toBe(1)
    engine.clearMorph('wheel')
    expect(engine.morphs.wheel.length).toBe(0)
    expect(engine.morphs.ctrlPedal.length).toBe(1)
  })

  it('non-morphable destinations are rejected (no silent no-op)', async () => {
    const { engine } = await makeRig()
    expect(engine.assignMorph('wheel', 'perf.masterLevel', 0, 127)).toBe(false)
    expect(engine.assignMorph('wheel', 'synth.oscMix', 0, 127)).toBe(false)
    expect(engine.morphs.wheel.length).toBe(0)
  })

  it('morph assignments round-trip through programs', async () => {
    const { engine } = await makeRig()
    engine.assignMorph('ctrlPedal', 'fx.reverbAmount', 10, 110)
    engine.storeTo(12, 'Morphy')
    engine.clearMorph('ctrlPedal')
    expect(engine.morphs.ctrlPedal.length).toBe(0)
    engine.loadSlot(12)
    expect(engine.morphs.ctrlPedal).toEqual([{ controlId: 'fx.reverbAmount', from: 10, to: 110 }])
  })

  it('wheel position drives Wheel-mode vibrato in rendered synth audio', async () => {
    const { engine, backend } = await makeRig()
    engine.update(() => {
      engine.synth.sectionOn = true
      engine.synth.layers.A.vibrato = 2 // Wheel
      engine.synth.layers.A.vibratoAmount = 100
    })
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    const noWheel = backend.renderMix(0.6)
    engine.setMorphPosition('wheel', 1)
    const wheel = backend.renderMix(0.6)
    expect(rms(wheel)).toBeGreaterThan(0.001)
    // Vibrato changes the waveform (pitch modulation decorrelates).
    let dot = 0, ea = 0, eb = 0
    for (let i = 0; i < noWheel.length; i++) {
      dot += noWheel[i] * wheel[i]
      ea += noWheel[i] ** 2
      eb += wheel[i] ** 2
    }
    expect(dot / Math.max(1e-12, Math.sqrt(ea * eb))).toBeLessThan(0.99)
  })
})

describe('scenes.switching', () => {
  it('Scene I/II toggles only layer enable state, not sound parameters', async () => {
    const { engine } = await makeRig()
    engine.update(() => {
      engine.synth.sectionOn = true
      engine.synth.layers.B.enabled = true
      engine.synth.layers.A.filterFreq = 42
    })
    engine.setScene('II')
    // Scene II has no memory yet: enables stay as they are until edited.
    engine.setSynthLayerEnabled('B', false)
    engine.setOrganSectionOn(true)
    const filterAfterEdits = engine.synth.layers.A.filterFreq
    engine.setScene('I')
    // Scene I memory was stashed at the switch: B enabled again, organ off.
    expect(engine.synth.layers.B.enabled).toBe(true)
    expect(engine.organ.sectionOn).toBe(true) // section on/off is not scene state
    // Sound parameters shared: filter untouched by scene switches.
    expect(engine.synth.layers.A.filterFreq).toBe(filterAfterEdits)
    engine.setScene('II')
    expect(engine.synth.layers.B.enabled).toBe(false)
  })

  it('scene round-trips through programs', async () => {
    const { engine } = await makeRig()
    engine.setScene('II')
    engine.storeTo(15, 'Scene Two')
    engine.setScene('I')
    engine.loadSlot(15)
    expect(engine.scene).toBe('II')
  })
})

describe('clock / transpose / panic', () => {
  it('master clock: 4 taps set the BPM from tap timing', async () => {
    const { engine } = await makeRig()
    const t0 = 1000000
    engine.tapMasterClock(t0)
    engine.tapMasterClock(t0 + 500)
    engine.tapMasterClock(t0 + 1000)
    engine.tapMasterClock(t0 + 1500) // 500 ms avg → 120 BPM
    expect(engine.clock.bpm).toBe(120)
    // Four fresh taps at 250 ms: after the window refills, BPM halves.
    engine.tapMasterClock(t0 + 1750)
    engine.tapMasterClock(t0 + 2000)
    engine.tapMasterClock(t0 + 2250)
    engine.tapMasterClock(t0 + 2500) // last three intervals = 250 ms → 240
    expect(engine.clock.bpm).toBe(240)
  })

  it('master clock dial set clamps to 30..300', async () => {
    const { engine } = await makeRig()
    engine.setBpm(10)
    expect(engine.clock.bpm).toBe(30)
    engine.setBpm(999)
    expect(engine.clock.bpm).toBe(300)
  })

  it('transpose shifts rendered pitch and clamps to ±6', async () => {
    const { engine, backend } = await makeRig()
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    const plain = backend.renderMix(0.4)
    engine.allNotesOff()
    engine.setTranspose(2)
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    const up2 = backend.renderMix(0.4)
    engine.setTranspose(99)
    expect(engine.transpose).toBe(6)
    let dot = 0, ea = 0, eb = 0
    for (let i = 0; i < plain.length; i++) {
      dot += plain[i] * up2[i]
      ea += plain[i] ** 2
      eb += up2[i] ** 2
    }
    expect(dot / Math.max(1e-12, Math.sqrt(ea * eb))).toBeLessThan(0.95)
  })

  it('panic stops every voice across all engines and resets held inputs', async () => {
    const { engine, backend } = await makeRig()
    engine.update(() => {
      engine.organ.sectionOn = true
      engine.synth.sectionOn = true
      engine.synth.layers.A.arpHold = true
    })
    engine.noteOn(60, 0.9)
    engine.setSustain(true)
    expect(backend.activeVoiceCount()).toBeGreaterThan(1)
    engine.noteOff(60)
    expect(engine.getArpNotes('A')).toContain(60)
    engine.panic()
    expect(backend.activeVoiceCount()).toBe(0)
    expect(engine.getVoices().length).toBe(0)
    expect(engine.isSustainDown()).toBe(false)
    expect(engine.getArpNotes('A').length).toBe(0)
  })
})
