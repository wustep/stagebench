import { describe, expect, it } from 'vitest'
import { PianoEngine } from './engine'
import type { StorageLike } from './performance'
import { PROGRAM_STORAGE_KEY, SPLIT_POSITIONS } from './performance'
import { meanAbsDiff, renderPiano, rms, testAudioBoundary, zeroCrossings } from '../test/renderAudio'

function memory(): StorageLike & { raw(): string | null } {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    raw: () => map.get(PROGRAM_STORAGE_KEY) ?? null,
  }
}

function organReady(engine: PianoEngine, model = 0) {
  engine.setSectionOn(false)
  engine.setOrganOn(true)
  engine.pressOrganLayer('A')
  engine.setOrganModel(model)
}

function synthReady(engine: PianoEngine) {
  engine.setSectionOn(false)
  engine.setSynthOn(true)
  engine.pressSynthLayer('A')
  engine.patchSynth({ samples: false, arpRun: false, voiceMode: 0 })
}

async function hear(setup: (engine: PianoEngine) => void, note = 60, seconds = 0.6) {
  return renderPiano((engine) => {
    engine.setMasterLevel(80)
    setup(engine)
    engine.noteOn(note, 0.9, 0)
  }, seconds)
}

describe('programs.roundtrip', () => {
  it('restores organ, synth, effects, split, scene, morph, clock, and transpose, and keeps master level out', () => {
    const engine = new PianoEngine(testAudioBoundary())
    engine.setMasterLevel(37)
    engine.setOrganOn(true)
    engine.setOrganModel(2)
    engine.setDrawbar(0, 3)
    engine.setSynthOn(true)
    engine.patchSynth({ waveform: 11, oscCtrl: 20, filterType: 2 })
    engine.setSplitPoint('mid', 6, 12, true)
    engine.setScene('II')
    engine.pressOrganLayer('A')
    engine.setScene('I')
    engine.assignMorph('wheel', 'organ-level-a', 100, 10)
    engine.setTempo(144)
    engine.setTranspose(3, true)
    engine.setManualFocus('piano')
    engine.writeFx({ delay: { mix: 40 } })
    expect(engine.isProgramDirty()).toBe(true)
    const before = engine.programDocument()
    engine.armStore()
    engine.selectProgram(5)
    engine.armStore()
    engine.setMasterLevel(90)
    engine.selectProgram(1)
    expect(engine.programDocument().organ.layers.A.model).not.toBe(2)
    engine.selectProgram(5)
    const after = engine.programDocument()
    expect(after.organ.layers.A.model).toBe(before.organ.layers.A.model)
    expect(after.organ.layers.A.drawbars[0]).toBe(3)
    expect(after.synth.layers.A.waveform).toBe(11)
    expect(after.synth.layers.A.filterType).toBe(2)
    expect(after.split.points[1]).toEqual({ enabled: true, position: 6, crossfade: 12 })
    expect(after.scenes.II.organA).toBe(true)
    expect(after.morph.wheel.map((item) => item.id)).toContain('organ-level-a')
    expect(after.clockBpm).toBe(144)
    expect(after.transpose).toBe(3)
    expect(after.piano.fx.A.delay.mix).toBe(40)
    expect(engine.getMasterLevel()).toBe(90)
    expect(engine.isProgramDirty()).toBe(false)
    expect(engine.loadProgramNames().filter((name, index, all) => all.indexOf(name) === index).length).toBeGreaterThanOrEqual(8)
  })
})

describe('programs.store-live', () => {
  it('names a program with Store As and reloads Live edits from storage', () => {
    const storage = memory()
    const engine = new PianoEngine(testAudioBoundary(), { storage })
    engine.armStoreAs()
    engine.nudgeProgram(1)
    const draft = String(engine.getProgramView().nameDraft)
    expect(draft.length).toBeGreaterThan(0)
    engine.armStore()
    engine.selectProgram(7)
    engine.armStore()
    engine.selectProgram(0)
    engine.selectProgram(7)
    expect(engine.programDocument().name).toBe(draft.trim() || draft)

    engine.setLiveMode(true)
    engine.setTempo(132)
    engine.patchSynth({ waveform: 9 })
    expect(engine.isProgramDirty()).toBe(false)
    const saved = storage.raw()
    expect(saved).toContain('132')
    const next = new PianoEngine(testAudioBoundary(), { storage })
    next.setLiveMode(true)
    expect(next.getTempo()).toBe(132)
    expect(next.programDocument().synth.layers.A.waveform).toBe(9)
    expect(next.isProgramDirty()).toBe(false)
  })
})

describe('programs.undo-cancel', () => {
  it('discards a dirty edit on program change and undo restores it', () => {
    const engine = new PianoEngine(testAudioBoundary())
    engine.setOrganModel(3)
    expect(engine.isProgramDirty()).toBe(true)
    engine.selectProgram(2)
    expect(engine.programDocument().organ.layers.A.model).not.toBe(3)
    expect(engine.isProgramDirty()).toBe(false)
    engine.undoProgram()
    expect(engine.programDocument().organ.layers.A.model).toBe(3)
    engine.armStore()
    engine.selectProgram(4)
    engine.cancelStore()
    expect(engine.storeMode()).toBe('play')
    expect(engine.getProgramView().index).not.toBe(4)
  })
})

describe('programs.navigation', () => {
  it('moves by button index, page, and dial across 32 slots', () => {
    const engine = new PianoEngine(testAudioBoundary())
    engine.selectProgram(9)
    expect(engine.getProgramView().page).toBe(1)
    expect(engine.getProgramView().button).toBe(1)
    engine.setProgramPage(3)
    expect(engine.getProgramView().page).toBe(3)
    expect(engine.getProgramView().button).toBe(1)
    engine.nudgeProgram(1)
    expect(engine.getProgramView().index).toBe(26)
    engine.nudgeProgram(-1)
    expect(engine.getProgramView().index).toBe(25)
    engine.setProgramList(true)
    expect(engine.getProgramView().listOpen).toBe(true)
    expect(engine.loadProgramNames()).toHaveLength(32)
  })
})

describe('layers.routing', () => {
  it('routes enable, focus, level, and octave for organ and synth layers', async () => {
    const quiet = await hear((engine) => {
      synthReady(engine)
      engine.pressSynthLayer('B')
      engine.setSynthLevel('A', 0)
      engine.setSynthLevel('B', 0)
      engine.setSynthLevel('C', 0)
    })
    const loud = await hear((engine) => {
      synthReady(engine)
      engine.setSynthLevel('A', 100)
    })
    expect(rms(quiet.channel, 2000, 16000)).toBeLessThan(0.002)
    expect(rms(loud.channel, 2000, 16000)).toBeGreaterThan(0.02)

    const low = await hear((engine) => {
      synthReady(engine)
      engine.nudgeSynthOctave(-1)
    })
    const high = await hear((engine) => {
      synthReady(engine)
      engine.nudgeSynthOctave(1)
    })
    expect(zeroCrossings(high.channel, 3000, 12000)).toBeGreaterThan(zeroCrossings(low.channel, 3000, 12000))

    const engine = new PianoEngine(testAudioBoundary())
    engine.setManualFocus('organ')
    engine.setEffectsOn(true)
    expect(engine.programDocument().organ.effectsOn).toBe(true)
    engine.pressSynthLayer('B')
    engine.setManualFocus('synth')
    engine.setEffectsOn(true)
    expect(engine.programDocument().synth.layers.B.effectsOn).toBe(true)
    expect(engine.programDocument().synth.focus).toBe('B')
  })
})

describe('splits.zones', () => {
  it('uses the 11 positions, hard cuts, and ±6/±12 crossfades', async () => {
    const engine = new PianoEngine(testAudioBoundary())
    expect(SPLIT_POSITIONS.map((point) => point.name)).toEqual(['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'])
    engine.setSplitPoint('low', 0, 0, true)
    engine.setSplitPoint('mid', 4, 0, true)
    engine.setSplitPoint('high', 10, 0, true)
    engine.setLayerZone('piano', 'A', 0, 0)
    engine.setLayerZone('synth', 'A', 2, 2)
    expect(engine.zoneGain('piano', 'A', 36)).toBe(0)
    expect(engine.zoneGain('piano', 'A', 35)).toBe(1)
    expect(engine.zoneGain('synth', 'A', 70)).toBe(1)
    expect(engine.zoneGain('piano', 'A', 70)).toBe(0)
    engine.setSplitPoint('low', 0, 0, false)
    engine.setSplitPoint('high', 10, 0, false)
    engine.setSplitPoint('mid', 4, 12, true)
    engine.setLayerZone('piano', 'A', 0, 0)
    engine.setLayerZone('synth', 'A', 1, 1)
    const edge = engine.zoneGain('piano', 'A', 54)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(1)
    expect(engine.zoneGain('synth', 'A', 54)).toBeGreaterThan(0)
    expect(engine.zoneGain('synth', 'A', 54)).toBeLessThan(1)

    const below = await hear((eng) => {
      synthReady(eng)
      eng.setSplitPoint('mid', 4, 0, true)
      eng.setLayerZone('synth', 'A', 1, 1)
    }, 48)
    const above = await hear((eng) => {
      synthReady(eng)
      eng.setSplitPoint('mid', 4, 0, true)
      eng.setLayerZone('synth', 'A', 1, 1)
    }, 72)
    expect(rms(below.channel, 2000, 12000)).toBeLessThan(0.002)
    expect(rms(above.channel, 2000, 12000)).toBeGreaterThan(0.02)
    expect(engine.activeSplitMidis()).toEqual([60])
  })
})

describe('morph.assignments', () => {
  it('interpolates wheel and pedal assignments and clears them', async () => {
    const down = await hear((engine) => {
      organReady(engine, 0)
      engine.assignMorph('wheel', 'organ-level-a', 100, 0)
      engine.setModWheel(127)
    })
    const up = await hear((engine) => {
      organReady(engine, 0)
      engine.assignMorph('wheel', 'organ-level-a', 100, 0)
      engine.setModWheel(0)
    })
    expect(rms(up.channel, 2000, 12000)).toBeGreaterThan(rms(down.channel, 2000, 12000) * 4)
    const engine = new PianoEngine(testAudioBoundary())
    engine.assignMorph('pedal', 'filter-freq', 10, 120)
    engine.setControlPedal(64)
    expect(engine.morphControlIds()).toContain('filter-freq')
    engine.clearMorph('pedal')
    engine.clearMorph('wheel')
    expect(engine.morphControlIds()).toEqual([])
  })
})

describe('scenes.switching', () => {
  it('toggles enables and keeps the sound parameters', () => {
    const engine = new PianoEngine(testAudioBoundary())
    engine.setOrganOn(true)
    engine.pressOrganLayer('A')
    engine.setOrganModel(2)
    engine.setDrawbar(4, 7)
    engine.setScene('II')
    expect(engine.getScene()).toBe('II')
    expect(engine.programDocument().organ.layers.A.model).toBe(2)
    expect(engine.programDocument().organ.layers.A.drawbars[4]).toBe(7)
    expect(engine.programDocument().scenes.II.organA).toBe(false)
    engine.setScene('I')
    expect(engine.programDocument().scenes.I.organA).toBe(true)
    expect(engine.programDocument().organ.layers.A.model).toBe(2)
  })
})

describe('organ.engine', () => {
  it('plays two layers into one graph and returns to silence', async () => {
    const both = await hear((engine) => {
      organReady(engine, 0)
      engine.pressOrganLayer('B')
      engine.setOrganLevel('A', 80)
      engine.setOrganLevel('B', 80)
    })
    const onlyA = await hear((engine) => {
      organReady(engine, 0)
      engine.setOrganLevel('B', 0)
    })
    expect(rms(both.channel, 2000, 14000)).toBeGreaterThan(rms(onlyA.channel, 2000, 14000))
    const { engine } = await renderPiano((eng) => {
      organReady(eng, 0)
      eng.noteOn(60, 0.8, 0)
      expect(eng.organVoiceCount()).toBe(1)
      eng.noteOff(60, 0.05)
      eng.allNotesOff()
      expect(eng.organVoiceCount()).toBe(0)
      expect(eng.contextCount()).toBe(1)
      expect(eng.destinationFeedCount()).toBe(1)
    }, 0.3)
    engine.dispose()
  })
})

describe('organ.models-drawbars', () => {
  it('keeps B3, Vox, Farf, and Pipe distinct, with drawbars, percussion, click, and vibrato', async () => {
    const play = (model: number, edit?: (engine: PianoEngine) => void) =>
      hear((engine) => {
        organReady(engine, model)
        edit?.(engine)
      }, 60, 0.5)
    const b3 = await play(0)
    const vox = await play(1)
    const farf = await play(2)
    const pipe = await play(3)
    const b3rms = rms(b3.channel, 3000, 16000)
    expect(b3rms).toBeGreaterThan(0.01)
    expect(meanAbsDiff(b3.channel, vox.channel)).toBeGreaterThan(0.01)
    expect(meanAbsDiff(b3.channel, farf.channel)).toBeGreaterThan(0.01)
    expect(meanAbsDiff(b3.channel, pipe.channel)).toBeGreaterThan(0.01)
    expect(meanAbsDiff(vox.channel, farf.channel)).toBeGreaterThan(0.005)
    const closed = await play(0, (engine) => {
      for (let index = 0; index < 9; index++) engine.setDrawbar(index, 0)
    })
    const open = await play(0, (engine) => {
      for (let index = 0; index < 9; index++) engine.setDrawbar(index, 8)
    })
    expect(rms(open.channel, 3000, 14000)).toBeGreaterThan(rms(closed.channel, 3000, 14000) * 2)
    expect(rms(closed.channel, 0, 800)).toBeGreaterThan(0.0005)
    const perc = await play(0, (engine) => engine.setOrganPercussion({ percOn: true, percThird: true }))
    expect(meanAbsDiff(b3.channel, perc.channel)).toBeGreaterThan(0.003)
    const vibrato = await play(0, (engine) => engine.setOrganVibrato(0, true))
    const chorus = await play(0, (engine) => engine.setOrganVibrato(3, true))
    expect(meanAbsDiff(vibrato.channel, chorus.channel)).toBeGreaterThan(0.004)
  })
})

describe('organ.rotary', () => {
  it('routes the organ to a slow, fast, and stopped speaker and morphs the speed', async () => {
    const direct = await hear((engine) => organReady(engine, 0), 60, 1.2)
    const slow = await hear((engine) => {
      organReady(engine, 0)
      engine.setRotarySource(true)
      engine.setRotary(false, false, 40)
    }, 60, 1.2)
    const fast = await hear((engine) => {
      organReady(engine, 0)
      engine.setRotarySource(true)
      engine.setRotary(true, false, 40)
    }, 60, 1.2)
    const stopped = await hear((engine) => {
      organReady(engine, 0)
      engine.setRotarySource(true)
      engine.setRotary(false, true, 40)
    }, 60, 1.2)
    expect(meanAbsDiff(direct.channel, slow.channel)).toBeGreaterThan(0.004)
    expect(meanAbsDiff(slow.channel, fast.channel)).toBeGreaterThan(0.004)
    expect(meanAbsDiff(fast.channel, stopped.channel)).toBeGreaterThan(0.004)
    const morphed = await hear((engine) => {
      organReady(engine, 0)
      engine.setRotarySource(true)
      engine.setRotary(false, false, 40)
      engine.assignMorph('wheel', 'rotary-speed', 0, 127)
      engine.setModWheel(127)
    }, 60, 1.2)
    expect(meanAbsDiff(slow.channel, morphed.channel)).toBeGreaterThan(0.004)
    const driven = await hear((engine) => {
      organReady(engine, 0)
      engine.setRotarySource(true)
      engine.setRotary(true, false, 127)
    }, 60, 1.2)
    expect(meanAbsDiff(fast.channel, driven.channel)).toBeGreaterThan(0.002)
  })
})

describe('synth.sources', () => {
  it('separates Pure, Sync, Multi, Super, and FM, and Osc Ctrl follows the category', async () => {
    const tone = (waveform: number, oscCtrl: number) =>
      hear((engine) => {
        synthReady(engine)
        engine.patchSynth({ waveform, oscCtrl, unison: 0 })
      }, 60, 0.45)
    const saw = await tone(2, 0)
    const sync = await tone(7, 0)
    const multi = await tone(9, 0)
    const superSaw = await tone(11, 0)
    const fm = await tone(13, 80)
    expect(meanAbsDiff(saw.channel, sync.channel)).toBeGreaterThan(0.01)
    expect(meanAbsDiff(saw.channel, multi.channel)).toBeGreaterThan(0.008)
    expect(meanAbsDiff(saw.channel, superSaw.channel)).toBeGreaterThan(0.008)
    expect(meanAbsDiff(saw.channel, fm.channel)).toBeGreaterThan(0.01)
    const pureLow = await tone(2, 0)
    const pureHigh = await tone(2, 127)
    const syncHigh = await tone(7, 127)
    const fmHigh = await tone(13, 127)
    expect(meanAbsDiff(pureLow.channel, pureHigh.channel)).toBeLessThan(0.002)
    expect(meanAbsDiff(sync.channel, syncHigh.channel)).toBeGreaterThan(0.008)
    expect(meanAbsDiff(fm.channel, fmHigh.channel)).toBeGreaterThan(0.004)
    const samples = await hear((engine) => {
      synthReady(engine)
      engine.patchSynth({ samples: true })
    })
    expect(rms(samples.channel, 0, 8000)).toBeLessThan(0.001)
  })
})

describe('synth.filter-envelopes', () => {
  it('changes filter type, resonance, drive, tracking, and the three envelopes', async () => {
    const shaped = (edit: (engine: PianoEngine) => void) =>
      hear((engine) => {
        synthReady(engine)
        engine.patchSynth({ filterOn: true, waveform: 2 })
        edit(engine)
      }, 60, 0.5)
    const lp = await shaped((engine) => engine.patchSynth({ filterType: 0, filterFreq: 40 }))
    const hp = await shaped((engine) => engine.patchSynth({ filterType: 2, filterFreq: 40 }))
    const bp = await shaped((engine) => engine.patchSynth({ filterType: 3, filterFreq: 50 }))
    expect(meanAbsDiff(lp.channel, hp.channel)).toBeGreaterThan(0.01)
    expect(meanAbsDiff(lp.channel, bp.channel)).toBeGreaterThan(0.008)
    const res = await shaped((engine) => engine.patchSynth({ filterType: 0, filterFreq: 50, filterRes: 120 }))
    expect(meanAbsDiff(lp.channel, res.channel)).toBeGreaterThan(0.004)
    const driven = await shaped((engine) => engine.patchSynth({ filterDrive: 3, filterFreq: 90 }))
    const clean = await shaped((engine) => engine.patchSynth({ filterDrive: 0, filterFreq: 90 }))
    expect(meanAbsDiff(driven.channel, clean.channel)).toBeGreaterThan(0.004)
    const tracked = await hear((engine) => {
      synthReady(engine)
      engine.patchSynth({ filterOn: true, waveform: 2, filterTrack: 3, filterFreq: 30, filterType: 0 })
    }, 84, 0.5)
    const untracked = await hear((engine) => {
      synthReady(engine)
      engine.patchSynth({ filterOn: true, waveform: 2, filterTrack: 0, filterFreq: 30, filterType: 0 })
    }, 84, 0.5)
    expect(meanAbsDiff(tracked.channel, untracked.channel)).toBeGreaterThan(0.004)
    const slowAmp = await shaped((engine) => engine.patchSynth({ ampEnv: { attack: 110, decay: 80, release: 40, velocity: 2 } }))
    const fastAmp = await shaped((engine) => engine.patchSynth({ ampEnv: { attack: 0, decay: 80, release: 40, velocity: 2 } }))
    expect(rms(fastAmp.channel, 0, 1500)).toBeGreaterThan(rms(slowAmp.channel, 0, 1500))
    const env = await shaped((engine) => engine.patchSynth({ filterEnvAmt: 120, filterEnv: { attack: 0, decay: 20, release: 20, velocity: 0 }, filterFreq: 30 }))
    const flat = await shaped((engine) => engine.patchSynth({ filterEnvAmt: 0, filterFreq: 30 }))
    expect(meanAbsDiff(env.channel, flat.channel)).toBeGreaterThan(0.004)
    const osc = await shaped((engine) => engine.patchSynth({ waveform: 13, oscEnvAmt: 127, oscEnv: { attack: 0, decay: 30, release: 20, velocity: 0 } }))
    const still = await shaped((engine) => engine.patchSynth({ waveform: 13, oscEnvAmt: 0 }))
    expect(meanAbsDiff(osc.channel, still.channel)).toBeGreaterThan(0.004)
  })
})

describe('synth.voice-modes', () => {
  it('covers poly, mono, legato, priority, glide, unison, vibrato, and LFO destinations', async () => {
    const { engine } = await renderPiano((eng) => {
      synthReady(eng)
      eng.noteOn(60, 0.8, 0)
      eng.noteOn(64, 0.8, 0)
      expect(eng.synthVoiceCount()).toBe(2)
      eng.patchSynth({ voiceMode: 1, priority: 2 })
      eng.allNotesOff()
      eng.noteOn(60, 0.8, 0.05)
      eng.noteOn(67, 0.8, 0.08)
      expect(eng.synthVoiceCount()).toBeGreaterThanOrEqual(1)
      expect(eng.synthVoiceCount()).toBeLessThan(4)
    }, 0.4)
    engine.dispose()

    const lowPri = await hear((eng) => {
      synthReady(eng)
      eng.patchSynth({ voiceMode: 1, priority: 1, glide: 0 })
      eng.noteOn(72, 0.8, 0)
      eng.noteOn(48, 0.8, 0.02)
    })
    const highPri = await hear((eng) => {
      synthReady(eng)
      eng.patchSynth({ voiceMode: 1, priority: 2, glide: 0 })
      eng.noteOn(72, 0.8, 0)
      eng.noteOn(48, 0.8, 0.02)
    })
    expect(zeroCrossings(highPri.channel, 4000, 14000)).toBeGreaterThan(zeroCrossings(lowPri.channel, 4000, 14000))

    const glide = await hear((eng) => {
      synthReady(eng)
      eng.patchSynth({ voiceMode: 2, glide: 100, priority: 0 })
      eng.noteOn(48, 0.8, 0)
      eng.noteOn(72, 0.8, 0.05)
    }, 60, 0.7)
    const jump = await hear((eng) => {
      synthReady(eng)
      eng.patchSynth({ voiceMode: 2, glide: 0, priority: 0 })
      eng.noteOn(48, 0.8, 0)
      eng.noteOn(72, 0.8, 0.05)
    }, 60, 0.7)
    expect(meanAbsDiff(glide.channel, jump.channel)).toBeGreaterThan(0.004)

    const wide = await hear((eng) => {
      synthReady(eng)
      eng.patchSynth({ unison: 3, waveform: 2 })
    })
    const single = await hear((eng) => {
      synthReady(eng)
      eng.patchSynth({ unison: 0, waveform: 2 })
    })
    expect(meanAbsDiff(wide.channel, single.channel)).toBeGreaterThan(0.008)

    const vib = await hear((eng) => {
      synthReady(eng)
      eng.patchSynth({ vibratoMode: 1, vibratoAmount: 100, vibratoRate: 80 })
    }, 60, 0.8)
    const dry = await hear((eng) => {
      synthReady(eng)
      eng.patchSynth({ vibratoMode: 0 })
    }, 60, 0.8)
    expect(meanAbsDiff(vib.channel, dry.channel)).toBeGreaterThan(0.004)

    const pitch = await hear((eng) => {
      synthReady(eng)
      eng.patchSynth({ lfoDest: 1, lfoAmount: 110, lfoWave: 3, lfoRate: 90 })
    }, 60, 0.7)
    const filter = await hear((eng) => {
      synthReady(eng)
      eng.patchSynth({ lfoDest: 3, lfoAmount: 110, lfoWave: 3, lfoRate: 90, filterFreq: 40 })
    }, 60, 0.7)
    const hold = await hear((eng) => {
      synthReady(eng)
      eng.patchSynth({ lfoDest: 0, lfoAmount: 110, lfoWave: 4 })
    }, 60, 0.7)
    expect(meanAbsDiff(pitch.channel, hold.channel)).toBeGreaterThan(0.004)
    expect(meanAbsDiff(filter.channel, pitch.channel)).toBeGreaterThan(0.004)
  })
})

describe('synth.arp-gate', () => {
  it('is deterministic and follows rate, clock, range, direction, hold, and run', async () => {
    const run = (edit: (engine: PianoEngine) => void) =>
      hear((engine) => {
        synthReady(engine)
        engine.patchSynth({ arpRun: true, arpMode: 0, arpRate: 90, arpRange: 40, arpDirection: 0, waveform: 2 })
        engine.setClockSync('arp', false)
        edit(engine)
        engine.noteOn(60, 0.85, 0)
        engine.noteOn(64, 0.85, 0)
      }, 60, 1.2)
    const up = await run(() => undefined)
    const again = await run(() => undefined)
    const down = await run((engine) => engine.patchSynth({ arpDirection: 1 }))
    const wide = await run((engine) => engine.patchSynth({ arpRange: 127 }))
    const synced = await run((engine) => {
      engine.setClockSync('arp', true)
      engine.setTempo(72)
    })
    expect(meanAbsDiff(up.channel, again.channel)).toBeLessThan(0.0008)
    expect(meanAbsDiff(up.channel, down.channel)).toBeGreaterThan(0.004)
    expect(meanAbsDiff(up.channel, wide.channel)).toBeGreaterThan(0.004)
    expect(meanAbsDiff(up.channel, synced.channel)).toBeGreaterThan(0.004)
    const held = await renderPiano((engine) => {
      engine.setMasterLevel(80)
      synthReady(engine)
      engine.patchSynth({ arpRun: true, arpHold: true, arpRate: 80, waveform: 2 })
      engine.setClockSync('arp', false)
      engine.noteOn(60, 0.9, 0)
      engine.noteOff(60, 0.05)
    }, 1)
    const dropped = await renderPiano((engine) => {
      engine.setMasterLevel(80)
      synthReady(engine)
      engine.patchSynth({ arpRun: true, arpHold: false, arpRate: 80, waveform: 2 })
      engine.setClockSync('arp', false)
      engine.noteOn(60, 0.9, 0)
      engine.noteOff(60, 0.05)
    }, 1)
    expect(rms(held.channel, 8000, 30000)).toBeGreaterThan(rms(dropped.channel, 8000, 30000))
    const gate = await hear((engine) => {
      synthReady(engine)
      engine.patchSynth({ arpRun: true, arpMode: 2, arpRate: 100, arpRange: 100 })
      engine.setClockSync('arp', false)
    }, 60, 1)
    const open = await hear((engine) => {
      synthReady(engine)
      engine.patchSynth({ arpRun: false })
    }, 60, 1)
    expect(meanAbsDiff(gate.channel, open.channel)).toBeGreaterThan(0.004)
  })
})

describe('system.integration', () => {
  it('shares one context, clock, transpose, and panic across engines', async () => {
    const transposed = await hear((engine) => {
      synthReady(engine)
      engine.setTranspose(6, true)
    })
    const concert = await hear((engine) => synthReady(engine))
    expect(zeroCrossings(transposed.channel, 2000, 12000)).toBeGreaterThan(zeroCrossings(concert.channel, 2000, 12000))
    const { engine } = await renderPiano((eng) => {
      organReady(eng, 0)
      eng.setSynthOn(true)
      eng.pressSynthLayer('A')
      eng.noteOn(60, 0.8, 0)
      expect(eng.contextCount()).toBe(1)
      expect(eng.destinationFeedCount()).toBe(1)
      expect(eng.organVoiceCount()).toBeGreaterThan(0)
      eng.panic()
      expect(eng.organVoiceCount()).toBe(0)
      expect(eng.synthVoiceCount()).toBe(0)
      expect(eng.activeVoiceCount()).toBe(0)
      expect(eng.getProgramView().pedal).toBe(0)
    }, 0.3)
    engine.dispose()
  })
})
