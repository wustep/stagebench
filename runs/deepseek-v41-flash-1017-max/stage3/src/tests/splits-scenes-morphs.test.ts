import { describe, expect, it } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'
import {
  CROSSFADE_WIDTHS,
  SPLIT_POSITION_MIDI,
  SPLIT_POSITIONS,
  SPLIT_POINT_IDS,
  applySceneToProgram,
  recordActiveScene,
  clearMorph,
  cloneProgramState,
  defaultMorph,
  defaultProgramState,
  defaultScenes,
  defaultSplit,
  interpolate,
  layerGainForNote,
  morphPosition,
  zoneBounds,
  zoneGainForNote,
  zoneIndexForNote,
  type MorphState,
  type ProgramState,
  type SplitState,
} from '../audio/programState'
import { createPianoSession, type PianoSession } from '../audio/noteSession'
import { createManualClock } from '../audio/clock'
import { createRecordingEngine } from '../audio/fakes'
import { VARIANT } from '../hardware/variant'
import { createChain, buildRotary, createRotaryReturn } from '../audio/effectGraph'
import { defaultEffectState } from '../audio/effectState'
import { createToneSource, rms } from '../audio/offlineRender'
import { renderOrganLoop } from '../audio/organModel'
import { renderSynthNote } from '../audio/synthVoice'
import { defaultSynthLayer, defaultSynthState } from '../audio/synthState'
import { defaultOrganState } from '../audio/organState'
import { defaultPianoState } from '../audio/pianoState'

/**
 * splits.zones — editable split points at the eleven documented positions, up to four
 * zones, real note routing, and the Off/±6/±12 crossfade gains.
 *
 * Two kinds of proof:
 *
 *  1. The zone maths is asserted directly, because it is arithmetic and can be checked
 *     exactly.
 *  2. Routing is asserted through the session with a recording engine (which layer sounded
 *     which note), and the crossfade is measured on rendered audio so "the fade is audible"
 *     is not merely a claim about a number.
 */

const MIDI = VARIANT
const lowest = VARIANT.lowestMidi
const highest = VARIANT.highestMidi

function splitWith(overrides: Partial<SplitState> = {}): SplitState {
  return { ...defaultSplit(), on: true, ...overrides }
}

function sessionWith(program: ProgramState): { session: PianoSession; engine: ReturnType<typeof createRecordingEngine> } {
  const engine = createRecordingEngine()
  const session = createPianoSession({
    engine,
    clock: createManualClock(),
    lowestMidi: lowest,
    highestMidi: highest,
    // Read the *same* object the test mutates, so a zone or scene change is visible to the
    // session exactly as a store update would be.
    pianoState: () => program.piano,
    organState: () => program.organ,
    synthState: () => program.synth,
    programState: () => program,
  })
  return { session, engine }
}

describe('splits.zones — the documented positions', () => {
  it('offers exactly the eleven documented split positions, in keyboard order', () => {
    expect(SPLIT_POSITIONS).toEqual([
      'C2',
      'F2',
      'C3',
      'F3',
      'C4',
      'F4',
      'C5',
      'F5',
      'C6',
      'F6',
      'C7',
    ])
    // Each has a MIDI note, and the notes ascend.
    const midis = SPLIT_POSITIONS.map((position) => SPLIT_POSITION_MIDI[position])
    expect(midis).toHaveLength(11)
    for (let i = 1; i < midis.length; i += 1) expect(midis[i]).toBeGreaterThan(midis[i - 1])
    // C4 is the conventional default the manual names.
    expect(SPLIT_POSITION_MIDI.C4).toBe(60)
  })

  it('offers exactly the three crossfade widths', () => {
    expect([...CROSSFADE_WIDTHS]).toEqual([0, 6, 12])
  })

  it('names three split points, which create four zones', () => {
    expect(SPLIT_POINT_IDS).toEqual(['Low', 'Mid', 'High'])
    const bounds = zoneBounds(splitWith(), lowest, highest)
    expect(bounds).toHaveLength(4)
    // And one zone when the split is off.
    expect(zoneBounds({ ...splitWith(), on: false }, lowest, highest)).toHaveLength(1)
  })
})

describe('splits.zones — zone boundaries', () => {
  it('lays out four zones that cover the whole keyboard without gaps', () => {
    const split = splitWith()
    split.points.Low = { position: 'C3', crossfade: 0 }
    split.points.Mid = { position: 'C4', crossfade: 0 }
    split.points.High = { position: 'C5', crossfade: 0 }
    const bounds = zoneBounds(split, lowest, highest)
    expect(bounds).toHaveLength(4)
    expect(bounds[0].from).toBe(lowest)
    expect(bounds[3].to).toBe(highest)
    // Every zone starts one semitone above the previous zone's end, so nothing is missing.
    for (let i = 1; i < bounds.length; i += 1) {
      expect(bounds[i].from).toBe(bounds[i - 1].to + 1)
    }
    expect(bounds[0].to).toBe(47) // up to B2, below C3
    expect(bounds[1].from).toBe(48) // C3
    expect(bounds[1].to).toBe(59) // up to B3
    expect(bounds[2].from).toBe(60) // C4
  })

  it('keeps the zones in keyboard order even when the points are set out of order', () => {
    const split = splitWith()
    // Deliberately inverted: Low above High.
    split.points.Low = { position: 'C6', crossfade: 0 }
    split.points.Mid = { position: 'C4', crossfade: 0 }
    split.points.High = { position: 'C5', crossfade: 0 }
    const bounds = zoneBounds(split, lowest, highest)
    for (let i = 1; i < bounds.length; i += 1) {
      expect(bounds[i].from).toBeGreaterThan(bounds[i - 1].from)
    }
    // Every note still falls in exactly one zone.
    for (let midi = lowest; midi <= highest; midi += 1) {
      const matches = bounds.filter((zone) => midi >= zone.from && midi <= zone.to)
      expect(matches, `midi ${midi}`).toHaveLength(1)
    }
  })
})

describe('splits.zones — crossfade gains', () => {
  it('switches immediately with crossfade Off', () => {
    const split = splitWith()
    split.points.Low = { position: 'C3', crossfade: 0 }
    const bounds = zoneBounds(split, lowest, highest)
    // Below the point the lower zone is at full level and the upper at zero.
    expect(zoneGainForNote(bounds[0], 47)).toBe(1)
    expect(zoneGainForNote(bounds[1], 47)).toBe(0)
    // At and above it, the reverse.
    expect(zoneGainForNote(bounds[0], 48)).toBe(0)
    expect(zoneGainForNote(bounds[1], 48)).toBe(1)
  })

  it('fades across six semitones on each side for ±6', () => {
    const split = splitWith()
    split.points.Low = { position: 'C4', crossfade: 6 }
    split.points.Mid = { position: 'C5', crossfade: 0 }
    split.points.High = { position: 'C6', crossfade: 0 }
    const bounds = zoneBounds(split, lowest, highest)
    const below = bounds[0]
    const above = bounds[1]
    // The band spans six semitones either side of the boundary: from G3 to F#4.
    // At the split point both zones are at half level, which makes the seam level.
    expect(zoneGainForNote(below, 60)).toBeCloseTo(0.5, 5)
    expect(zoneGainForNote(above, 60)).toBeCloseTo(0.5, 5)
    // Six semitones below the point the fade has not started: the lower zone is alone.
    expect(zoneGainForNote(below, 54)).toBeCloseTo(1, 5)
    expect(zoneGainForNote(above, 54)).toBeCloseTo(0, 5)
    // Three semitones below the point is a quarter of the way through the band.
    expect(zoneGainForNote(below, 57)).toBeCloseTo(0.75, 5)
    expect(zoneGainForNote(above, 57)).toBeCloseTo(0.25, 5)
    // Above the point, zone 0 fades out and zone 1 fades in, reaching its own full level six
    // semitones above.
    expect(zoneGainForNote(above, 66)).toBeCloseTo(1, 5)
    expect(zoneGainForNote(below, 66)).toBeCloseTo(0, 5)
    expect(zoneGainForNote(below, 63)).toBeCloseTo(0.25, 5)
    expect(zoneGainForNote(above, 63)).toBeCloseTo(0.75, 5)
    // And the two gains always sum to 1 through the fade region, so the seam is level.
    for (let midi = 54; midi <= 66; midi += 1) {
      expect(zoneGainForNote(below, midi) + zoneGainForNote(above, midi)).toBeCloseTo(1, 5)
    }
  })

  it('fades across twelve semitones on each side for ±12', () => {
    const split = splitWith()
    split.points.Low = { position: 'C4', crossfade: 12 }
    split.points.Mid = { position: 'C5', crossfade: 0 }
    split.points.High = { position: 'C6', crossfade: 0 }
    const bounds = zoneBounds(split, lowest, highest)
    expect(zoneGainForNote(bounds[0], 60)).toBeCloseTo(0.5, 5)
    expect(zoneGainForNote(bounds[0], 48)).toBeCloseTo(1, 5)
    // The wider band reaches an octave above the boundary rather than six semitones: at 71
    // the upper zone is still fading in, reaching full at its own top note.
    expect(zoneGainForNote(bounds[1], 71)).toBeCloseTo(23 / 24, 5)
    // Note 72 is C5, which is the *next* boundary, so it belongs to zone 2 — which no layer
    // is assigned to in this configuration, hence silence rather than a partial gain.
    expect(zoneGainForNote(bounds[1], 72)).toBe(0)
    // A 12-wide fade is shallower than a 6-wide one at the same distance above the point.
    const sixSplit = splitWith()
    sixSplit.points.Low = { position: 'C4', crossfade: 6 }
    sixSplit.points.Mid = { position: 'C5', crossfade: 0 }
    sixSplit.points.High = { position: 'C6', crossfade: 0 }
    const sixBounds = zoneBounds(sixSplit, lowest, highest)
    expect(zoneGainForNote(bounds[0], 66)).toBeGreaterThan(zoneGainForNote(sixBounds[0], 66))
    // At ±6 the fade is complete six semitones out; at ±12 it is only half way.
    expect(zoneGainForNote(sixBounds[0], 66)).toBeCloseTo(0, 5)
    expect(zoneGainForNote(bounds[0], 66)).toBeCloseTo(0.25, 5)
  })
})

describe('splits.zones — layer routing', () => {
  it('routes a layer only where its zones are assigned', () => {
    const split = splitWith()
    split.points.Low = { position: 'C3', crossfade: 0 }
    split.points.Mid = { position: 'C4', crossfade: 0 }
    split.points.High = { position: 'C5', crossfade: 0 }
    split.zones['organ.a'] = [true, false, false, false]
    split.zones['synth.a'] = [false, true, true, true]
    // The organ plays only the bottom zone.
    expect(layerGainForNote(split, 'organ.a', 40, lowest, highest)).toBe(1)
    expect(layerGainForNote(split, 'organ.a', 60, lowest, highest)).toBe(0)
    // The synth takes everything from C3 up.
    expect(layerGainForNote(split, 'synth.a', 40, lowest, highest)).toBe(0)
    expect(layerGainForNote(split, 'synth.a', 60, lowest, highest)).toBe(1)
    expect(layerGainForNote(split, 'synth.a', 90, lowest, highest)).toBe(1)
  })

  it('sounds nothing on a layer whose zones are all off', () => {
    const split = splitWith()
    split.zones['piano.a'] = [false, false, false, false]
    for (let midi = lowest; midi <= highest; midi += 1) {
      expect(layerGainForNote(split, 'piano.a', midi, lowest, highest)).toBe(0)
    }
  })

  it('gives a note in a crossfade band partial gain on both layers', () => {
    const split = splitWith()
    split.points.Low = { position: 'C4', crossfade: 6 }
    split.zones['organ.a'] = [true, false, false, false]
    split.zones['synth.a'] = [false, true, false, false]
    // Exactly at C4, both layers are at half gain: the audible crossfade.
    expect(layerGainForNote(split, 'organ.a', 60, lowest, highest)).toBeCloseTo(0.5, 5)
    expect(layerGainForNote(split, 'synth.a', 60, lowest, highest)).toBeCloseTo(0.5, 5)
  })

  it('reports which zone a note falls in', () => {
    const split = splitWith()
    split.points.Low = { position: 'C3', crossfade: 0 }
    split.points.Mid = { position: 'C4', crossfade: 0 }
    split.points.High = { position: 'C5', crossfade: 0 }
    expect(zoneIndexForNote(split, 40, lowest, highest)).toBe(0)
    expect(zoneIndexForNote(split, 52, lowest, highest)).toBe(1)
    expect(zoneIndexForNote(split, 64, lowest, highest)).toBe(2)
    expect(zoneIndexForNote(split, 80, lowest, highest)).toBe(3)
    // With no split there is one zone.
    expect(zoneIndexForNote({ ...split, on: false }, 100, lowest, highest)).toBe(0)
  })

  it('sounds only the layers assigned to the note, through the real session', () => {
    const program = defaultProgramState()
    program.organ.sectionOn = true
    program.organ.layers['organ.a'].enabled = true
    program.synth.sectionOn = true
    program.synth.layers['synth.a'].enabled = true
    program.piano.sectionOn = false
    program.synth.layers['synth.b'].enabled = false
    program.synth.layers['synth.c'].enabled = false
    program.split = splitWith()
    program.split.points.Low = { position: 'C3', crossfade: 0 }
    program.split.points.Mid = { position: 'C4', crossfade: 0 }
    program.split.points.High = { position: 'C5', crossfade: 0 }
    program.split.zones['organ.a'] = [true, false, false, false]
    program.split.zones['synth.a'] = [false, true, true, true]

    const { session, engine } = sessionWith(program)
    // A low note sounds only the organ.
    session.press({ midi: 40, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    expect(engine.startedVoices.map((voice) => voice.layer)).toEqual(['organ.a'])
    session.release('pointer', 'p:1', 40)
    engine.startedVoices.length = 0

    // A high note sounds only the synth.
    session.press({ midi: 72, velocity: 0.7, source: 'pointer', owner: 'p:2' })
    expect(engine.startedVoices.map((voice) => voice.layer)).toEqual(['synth.a'])
    session.release('pointer', 'p:2', 72)
  })

  it('sounds both layers across a crossfade, with the zone gains on the handles', () => {
    const program = defaultProgramState()
    program.organ.sectionOn = true
    program.organ.layers['organ.a'].enabled = true
    program.synth.sectionOn = true
    program.synth.layers['synth.a'].enabled = true
    program.piano.sectionOn = false
    program.synth.layers['synth.b'].enabled = false
    program.synth.layers['synth.c'].enabled = false
    program.split = splitWith()
    program.split.points.Low = { position: 'C4', crossfade: 6 }
    program.split.zones['organ.a'] = [true, false, false, false]
    program.split.zones['synth.a'] = [false, true, false, false]

    const { session, engine } = sessionWith(program)
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    const layers = engine.startedVoices.map((voice) => voice.layer).toSorted()
    expect(layers).toEqual(['organ.a', 'synth.a'])
    // Both handles carry half the zone gain, which is what makes the crossfade audible.
    for (const voice of engine.startedVoices) {
      expect(voice.organSettings?.zoneGain ?? voice.synthSettings?.zoneGain).toBeCloseTo(0.5, 5)
    }
    session.release('pointer', 'p:1', 60)
  })

  it('splits nothing when SPLIT is off, so a layer sounds across the keyboard', () => {
    const program = defaultProgramState()
    program.organ.sectionOn = true
    program.organ.layers['organ.a'].enabled = true
    program.piano.sectionOn = false
    // Only the organ sounds, so a note anywhere is exactly one voice.
    program.synth.sectionOn = false
    program.split = { ...defaultSplit(), on: false }
    const { session, engine } = sessionWith(program)
    for (const midi of [40, 60, 90]) {
      session.press({ midi, velocity: 0.7, source: 'pointer', owner: `p:${midi}` })
    }
    expect(engine.startedVoices).toHaveLength(3)
    expect(engine.startedVoices.every((voice) => voice.layer === 'organ.a')).toBe(true)
  })

  it('re-evaluates the held keys when a zone assignment changes', () => {
    const program = defaultProgramState()
    program.organ.sectionOn = true
    program.organ.layers['organ.a'].enabled = true
    program.piano.sectionOn = false
    program.synth.sectionOn = false
    program.split = splitWith()
    program.split.points.Low = { position: 'C3', crossfade: 0 }
    program.split.zones['organ.a'] = [true, false, false, false]
    const { session, engine } = sessionWith(program)
    session.press({ midi: 40, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    expect(engine.activeVoiceCount()).toBe(1)
    // Un-assigning zone 0 while the key is held stops the note.
    program.split.zones['organ.a'] = [false, false, false, false]
    session.refreshRouting()
    expect(engine.activeVoiceCount()).toBe(0)
    // Re-assigning it while the key is still held starts it again.
    program.split.zones['organ.a'] = [true, false, false, false]
    session.refreshRouting()
    expect(engine.activeVoiceCount()).toBe(1)
  })
})

describe('splits.zones — the crossfade is audible', () => {
  it('renders a note quieter through a half-way crossfade than at full zone gain', () => {
    // The zone gain is a voice-level gain in the engine, so its audible effect is measured
    // on rendered samples at the same settings with the gain the routing produces.
    const drawbars = [8, 8, 8, 6, 0, 0, 0, 0, 0]
    const full = renderOrganLoop({ model: 'b3', drawbars, midi: 60, sampleRate: 44100 }).samples
    const split = splitWith()
    split.points.Low = { position: 'C4', crossfade: 6 }
    split.zones['organ.a'] = [true, false, false, false]
    const gain = layerGainForNote(split, 'organ.a', 60, lowest, highest)
    expect(gain).toBeCloseTo(0.5, 5)
    const faded = Float32Array.from(full, (sample) => sample * gain)
    expect(rms(faded)).toBeLessThan(rms(full) * 0.6)
    expect(rms(faded)).toBeGreaterThan(rms(full) * 0.4)
  })

  it('applies the zone gain to a rendered synth voice', () => {
    const layer = defaultSynthLayer('synth.a', true)
    layer.waveform = 'Saw'
    const base = {
      layer,
      midi: 60,
      velocity: 0.8,
      level: 0.8,
      holdSeconds: 0.2,
      releaseSeconds: 0.05,
      glideFrom: null,
      modWheel: 0,
      lfoRateHz: 4,
    }
    const full = renderSynthNote({ ...base, zoneGain: 1 }, 22050).samples
    const half = renderSynthNote({ ...base, zoneGain: 0.5 }, 22050).samples
    expect(rms(half)).toBeLessThan(rms(full) * 0.7)
    expect(rms(half)).toBeGreaterThan(rms(full) * 0.3)
  })

  it('carries the zone gain into the effect chain, so the crossfade survives routing', async () => {
    const SR = 44100
    const seconds = 0.5
    const render = async (gainValue: number) => {
      const ctx = new OfflineAudioContext(1, Math.round(SR * seconds), SR)
      const rotary = buildRotary(ctx as never)
      const chain = createChain(ctx as never, 'organ', rotary)
      const sink = ctx.createGain()
      chain.output.connect(sink as never)
      createRotaryReturn(ctx as never, rotary).connect(sink as never)
      sink.connect(ctx.destination)
      const state = defaultEffectState()
      chain.update(state, 0)
      rotary.apply(state, 0)
      createToneSource(ctx as never, chain.input as never, { frequency: 220, seconds, gain: gainValue })
      const buffer = await ctx.startRendering()
      chain.dispose()
      rotary.dispose()
      return buffer.getChannelData(0)
    }
    const loud = await render(0.5)
    const quiet = await render(0.25)
    expect(rms(quiet)).toBeLessThan(rms(loud) * 0.7)
    expect(rms(quiet)).toBeGreaterThan(rms(loud) * 0.3)
  })
})

describe('scenes.switching — Scene I and II toggle enable state only', () => {
  it('starts on Scene I with both scenes seeded from the engine defaults', () => {
    const piano = defaultPianoState()
    const organ = defaultOrganState()
    const synth = defaultSynthState()
    const scenes = defaultScenes(piano, organ, synth)
    expect(scenes.second).toBe(false)
    // Scene I reflects what the instrument is actually set to.
    expect(scenes.sceneI['piano.a']).toBe(true)
    expect(scenes.sceneI['piano.b']).toBe(false)
    // Scene II begins as a copy the player can edit.
    expect(scenes.sceneII).toEqual(scenes.sceneI)
  })

  it('applies a scene by writing the layer enable flags, not by gating them separately', () => {
    const program = defaultProgramState()
    program.scenes = {
      second: false,
      sceneI: {
        'piano.a': true,
        'piano.b': false,
        'organ.a': false,
        'organ.b': false,
        'synth.a': false,
        'synth.b': true,
        'synth.c': false,
      },
      sceneII: {
        'piano.a': false,
        'piano.b': true,
        'organ.a': true,
        'organ.b': false,
        'synth.a': false,
        'synth.b': false,
        'synth.c': true,
      },
    }
    // Scene I is a real enable configuration.
    applySceneToProgram(program, false)
    expect(program.piano.layers['piano.a'].enabled).toBe(true)
    expect(program.synth.layers['synth.b'].enabled).toBe(true)
    expect(program.organ.layers['organ.a'].enabled).toBe(false)

    // Scene II is a different one, applied to the same flags.
    applySceneToProgram(program, true)
    expect(program.scenes.second).toBe(true)
    expect(program.piano.layers['piano.a'].enabled).toBe(false)
    expect(program.piano.layers['piano.b'].enabled).toBe(true)
    expect(program.organ.layers['organ.a'].enabled).toBe(true)
    expect(program.synth.layers['synth.c'].enabled).toBe(true)

    // And back: switching does not lose either configuration.
    applySceneToProgram(program, false)
    expect(program.piano.layers['piano.a'].enabled).toBe(true)
    expect(program.synth.layers['synth.b'].enabled).toBe(true)
  })

  it('leaves every sound parameter untouched when a scene is applied', () => {
    const program = defaultProgramState()
    program.piano.timbre = 3
    program.organ.layers['organ.a'].drawbars = [1, 2, 3, 4, 5, 6, 7, 8, 0]
    program.synth.layers['synth.a'].waveform = 'Sync Square'
    program.effects.chains['piano.a'].reverb.on = true
    const parameters = JSON.stringify({
      piano: {
        timbre: program.piano.timbre,
        levels: Object.values(program.piano.layers).map((layer) => layer.level),
        models: Object.values(program.piano.layers).map((layer) => layer.model),
      },
      organDrawbars: program.organ.layers['organ.a'].drawbars,
      synthWaveform: program.synth.layers['synth.a'].waveform,
      reverb: program.effects.chains['piano.a'].reverb.on,
    })
    applySceneToProgram(program, true)
    applySceneToProgram(program, false)
    expect(
      JSON.stringify({
        piano: {
          timbre: program.piano.timbre,
          levels: Object.values(program.piano.layers).map((layer) => layer.level),
          models: Object.values(program.piano.layers).map((layer) => layer.model),
        },
        organDrawbars: program.organ.layers['organ.a'].drawbars,
        synthWaveform: program.synth.layers['synth.a'].waveform,
        reverb: program.effects.chains['piano.a'].reverb.on,
      }),
    ).toBe(parameters)
  })

  it('sounds different layers per scene, through the real session', () => {
    const program = defaultProgramState()
    program.piano.sectionOn = true
    program.synth.sectionOn = true
    program.organ.sectionOn = false
    program.scenes = {
      second: false,
      sceneI: { 'piano.a': true, 'piano.b': false, 'organ.a': false, 'organ.b': false, 'synth.a': false, 'synth.b': false, 'synth.c': false },
      sceneII: { 'piano.a': false, 'piano.b': false, 'organ.a': false, 'organ.b': false, 'synth.a': true, 'synth.b': false, 'synth.c': false },
    }
    applySceneToProgram(program, false)
    const { session, engine } = sessionWith(program)
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    expect(engine.startedVoices.map((voice) => voice.layer)).toEqual(['piano.a'])
    session.release('pointer', 'p:1', 60)
    engine.startedVoices.length = 0

    // Scene II sounds the synth instead, and the layer flags are what changed.
    applySceneToProgram(program, true)
    expect(program.piano.layers['piano.a'].enabled).toBe(false)
    expect(program.synth.layers['synth.a'].enabled).toBe(true)
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:2' })
    expect(engine.startedVoices.map((voice) => voice.layer)).toEqual(['synth.a'])
    session.release('pointer', 'p:2', 60)
  })

  it('records the current layer state into the active scene', () => {
    const program = defaultProgramState()
    program.piano.sectionOn = true
    program.piano.layers['piano.a'].enabled = false
    program.piano.layers['piano.b'].enabled = true
    program.synth.sectionOn = true
    program.synth.layers['synth.a'].enabled = true
    recordActiveScene(program)
    expect(program.scenes.sceneI['piano.a']).toBe(false)
    expect(program.scenes.sceneI['piano.b']).toBe(true)
    expect(program.scenes.sceneI['synth.a']).toBe(true)
    // Scene II is untouched by a Scene I record.
    expect(program.scenes.sceneII['piano.a']).toBe(true)
    // With Scene II active, the record goes there.
    program.scenes.second = true
    program.piano.layers['piano.a'].enabled = true
    recordActiveScene(program)
    expect(program.scenes.sceneII['piano.a']).toBe(true)
    expect(program.scenes.sceneI['piano.a']).toBe(false)
  })

  it('stores the active scene in canonical state so it round-trips', () => {
    const program = defaultProgramState()
    program.scenes.second = true
    const restored = cloneProgramState(program)
    expect(restored.scenes.second).toBe(true)
    expect(JSON.parse(JSON.stringify(program)).scenes.second).toBe(true)
  })
})

describe('morph.assignments — interpolation, indicators and clearing', () => {
  it('interpolates linearly from start to end', () => {
    const assignment = { controlId: 'piano.layer.a.level', start: 20, end: 90 }
    expect(interpolate(assignment, 0)).toBe(20)
    expect(interpolate(assignment, 0.5)).toBe(55)
    expect(interpolate(assignment, 1)).toBe(90)
    // Out of range positions clamp rather than extrapolating.
    expect(interpolate(assignment, -1)).toBe(20)
    expect(interpolate(assignment, 2)).toBe(80 + 10)
  })

  it('can lower a destination as another rises, which the spec requires', () => {
    const up = { controlId: 'synth.filter.freq', start: 2, end: 9 }
    const down = { controlId: 'effects.reverb.dry-wet', start: 8, end: 1 }
    expect(interpolate(up, 1)).toBeGreaterThan(interpolate(up, 0))
    expect(interpolate(down, 1)).toBeLessThan(interpolate(down, 0))
    // Both move in opposite directions from the same source position.
    const position = 0.6
    expect(interpolate(up, position)).toBeCloseTo(2 + 7 * position, 5)
    expect(interpolate(down, position)).toBeCloseTo(8 - 7 * position, 5)
  })

  it('tracks each source position independently', () => {
    const morph: MorphState = {
      wheel: [],
      pedal: [],
      wheelPosition: 0.25,
      pedalPosition: 0.8,
    }
    expect(morphPosition(morph, 'Wheel')).toBe(0.25)
    expect(morphPosition(morph, 'Control Pedal')).toBe(0.8)
  })

  it('clears one source without touching the other', () => {
    const morph: MorphState = {
      ...defaultMorph(),
      wheel: [{ controlId: 'piano.layer.a.level', start: 0, end: 100 }],
      pedal: [{ controlId: 'synth.filter.freq', start: 1, end: 9 }],
    }
    clearMorph(morph, 'Wheel')
    expect(morph.wheel).toHaveLength(0)
    expect(morph.pedal).toHaveLength(1)
  })

  it('clears a single assignment and leaves the rest of that source intact', () => {
    const morph: MorphState = {
      ...defaultMorph(),
      wheel: [
        { controlId: 'piano.layer.a.level', start: 0, end: 100 },
        { controlId: 'synth.filter.freq', start: 1, end: 9 },
      ],
    }
    clearMorph(morph, 'Wheel', 'synth.filter.freq')
    expect(morph.wheel).toHaveLength(1)
    expect(morph.wheel[0].controlId).toBe('piano.layer.a.level')
  })

  it('keeps the assignments and positions in canonical state', () => {
    const program = defaultProgramState()
    program.morph.wheel = [{ controlId: 'piano.layer.a.level', start: 10, end: 80 }]
    program.morph.pedal = [{ controlId: 'synth.filter.freq', start: 9, end: 2 }]
    program.morph.wheelPosition = 0.33
    program.morph.pedalPosition = 0.66
    const restored = cloneProgramState(program)
    expect(restored.morph.wheel).toHaveLength(1)
    expect(restored.morph.wheelPosition).toBeCloseTo(0.33, 5)
    expect(restored.morph.pedalPosition).toBeCloseTo(0.66, 5)
    // The two sources are independent in the stored state too.
    expect(restored.morph.pedal[0].start).toBe(9)
  })

  it('only accepts destinations the specs list as morphable', async () => {
    const { morphParameterFor, recordMorph } = await import('../audio/panelBindings')
    // A morphable destination.
    expect(morphParameterFor('piano.layer.a.level')).toBe('piano.level')
    expect(morphParameterFor('synth.filter.freq')).toBe('synth.filterFreq')
    expect(morphParameterFor('organ.drawbar.16')).toBe('organ.drawbars')
    expect(morphParameterFor('effects.reverb.dry-wet')).toBe('effects.reverbDryWet')
    // A control that is not a morph destination, exactly as the effects spec's `morphable`
    // lists show: Mod 2 Rate is not morphable, only its Amount is.
    expect(morphParameterFor('effects.mod2.rate')).toBeUndefined()
    expect(morphParameterFor('piano.unison')).toBeUndefined()
    expect(morphParameterFor('program.panic')).toBeUndefined()

    const morph = defaultMorph()
    recordMorph(morph, 'Wheel', 'effects.mod2.rate', 0, 10)
    expect(morph.wheel).toHaveLength(0)
    recordMorph(morph, 'Wheel', 'piano.layer.a.level', 10, 90)
    expect(morph.wheel).toHaveLength(1)
  })
})
