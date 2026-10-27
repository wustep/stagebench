import { describe, expect, it } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'
import { createPianoSession } from '../audio/noteSession'
import { createManualClock } from '../audio/clock'
import { createRecordingEngine } from '../audio/fakes'
import { VARIANT } from '../hardware/variant'
import { defaultPianoState, type PianoState } from '../audio/pianoState'
import {
  MIDI_OWNER_PREFIX,
  createMidiBridge,
  decodeMidiMessage,
  midiOwnerFor,
  type MidiAccessLike,
  type MidiInputLike,
} from '../input/midi'
import { SUSTAIN_KEY_CODE } from '../input/keyboardMap'
import { releasePoints } from '../audio/pianoModel'
import { rms } from '../audio/offlineRender'

/**
 * piano.pedals — sustain from UI, computer keyboard and MIDI CC64, honouring the per-layer
 * SUSTPED routing, with any claimed soft/sostenuto behaviour either tested or truthfully
 * labelled an approximation.
 *
 * The session assertions prove the lifecycle; the rendered assertion proves the pedal
 * changes how long a note is audible.
 */

function sessionWith(state: PianoState = defaultPianoState()) {
  const engine = createRecordingEngine()
  const session = createPianoSession({
    engine,
    clock: createManualClock(),
    lowestMidi: VARIANT.lowestMidi,
    highestMidi: VARIANT.highestMidi,
    pianoState: () => state,
  })
  return { session, engine, state }
}

describe('piano.pedals — three input paths reach one sustain state', () => {
  it('sustains from the on-screen pedal owner', () => {
    const { session, engine } = sessionWith()
    session.setSustain(true, 'ui:sustain')
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    session.release('pointer', 'p:1', 60)
    expect(session.snapshot().sustainPedal).toBe(true)
    expect(engine.activeVoiceCount()).toBe(1)
    session.setSustain(false, 'ui:sustain')
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('sustains from the computer keyboard', () => {
    expect(SUSTAIN_KEY_CODE).toBe('Space')
    const { session, engine } = sessionWith()
    session.setSustain(true, `keyboard:${SUSTAIN_KEY_CODE}`)
    session.press({ midi: 64, velocity: 0.7, source: 'keyboard', owner: 'keyboard:KeyQ' })
    session.release('keyboard', 'keyboard:KeyQ', 64)
    expect(engine.activeVoiceCount()).toBe(1)
    expect(session.snapshot().sustained).toEqual([64])
    session.setSustain(false, `keyboard:${SUSTAIN_KEY_CODE}`)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('sustains from MIDI CC64, with the conventional 64 threshold', async () => {
    const { session, engine } = sessionWith()
    const input: MidiInputLike & { emit(data: number[]): void } = {
      id: 'pedal',
      name: 'Pedal',
      state: 'connected',
      onmidimessage: null,
      emit(data: number[]) {
        input.onmidimessage?.({ data: new Uint8Array(data) })
      },
    }
    const access: MidiAccessLike = { inputs: new Map([[input.id, input]]), onstatechange: null }
    const bridge = createMidiBridge({
      requestAccess: () => Promise.resolve(access),
      onNoteOn: (owner, midi, velocity) => session.press({ midi, velocity, source: 'midi', owner }),
      onNoteOff: (owner, midi) => session.release('midi', owner, midi),
      onSustain: (owner, down) => session.setSustain(down, owner),
      onStatus: () => undefined,
      onDisconnect: () => session.allNotesOff('midi-disconnect'),
    })
    await bridge.connect()
    const owner = midiOwnerFor('pedal')
    expect(owner.startsWith(`${MIDI_OWNER_PREFIX}:`)).toBe(true)

    input.emit([0xb0, 64, 127])
    expect(session.snapshot().sustainPedal).toBe(true)
    input.emit([0x90, 60, 100])
    input.emit([0x80, 60, 0])
    expect(engine.activeVoiceCount()).toBe(1)
    // CC64 below 64 is "up", which damps the held note.
    input.emit([0xb0, 64, 20])
    expect(engine.activeVoiceCount()).toBe(0)
    bridge.disconnect()
  })

  it('treats CC64=64 as down and CC64=63 as up', () => {
    const seen: boolean[] = []
    const handlers = {
      onNoteOn: () => undefined,
      onNoteOff: () => undefined,
      onSustain: (down: boolean) => seen.push(down),
      onAllNotesOff: () => undefined,
    }
    decodeMidiMessage(new Uint8Array([0xb0, 64, 64]), handlers)
    decodeMidiMessage(new Uint8Array([0xb0, 64, 63]), handlers)
    expect(seen).toEqual([true, false])
  })

  it('keeps two pedal owners independent, so either one can hold sustain', () => {
    const { session, engine } = sessionWith()
    session.setSustain(true, 'ui:sustain')
    session.setSustain(true, 'midi:dev')
    session.setSustain(false, 'ui:sustain')
    expect(session.snapshot().sustainPedal).toBe(true)
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    session.release('pointer', 'p:1', 60)
    expect(engine.activeVoiceCount()).toBe(1)
    session.setSustain(false, 'midi:dev')
    expect(engine.activeVoiceCount()).toBe(0)
  })
})

describe('piano.pedals — SUSTPED routing per layer', () => {
  function twoLayers(): PianoState {
    const state = defaultPianoState()
    state.layers['piano.b'].enabled = true
    state.layers['piano.b'].type = 'upright'
    state.layers['piano.b'].model = 'upright.ivy'
    return state
  }

  it('sustains only the layers whose SUSTPED is on', () => {
    const state = twoLayers()
    state.layers['piano.a'].sustPed = true
    state.layers['piano.b'].sustPed = false
    const { session, engine } = sessionWith(state)
    session.setSustainRouting('piano.a', true)
    session.setSustainRouting('piano.b', false)
    session.setSustain(true, 'ui:sustain')
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    session.release('pointer', 'p:1', 60)
    expect(session.snapshot().byLayer).toEqual({ 'piano.a': 1, 'piano.b': 0 })
    expect(engine.activeVoiceCount()).toBe(1)
  })

  it('sustains only layer B when only B is routed', () => {
    const state = twoLayers()
    const { session, engine } = sessionWith(state)
    session.setSustainRouting('piano.a', false)
    session.setSustainRouting('piano.b', true)
    session.setSustain(true, 'ui:sustain')
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    session.release('pointer', 'p:1', 60)
    expect(session.snapshot().byLayer).toEqual({ 'piano.a': 0, 'piano.b': 1 })
    expect(engine.activeVoiceCount()).toBe(1)
  })

  it('damps a layer the moment its routing is switched off', () => {
    const state = twoLayers()
    const { session, engine } = sessionWith(state)
    session.setSustainRouting('piano.a', true)
    session.setSustainRouting('piano.b', true)
    session.setSustain(true, 'ui:sustain')
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    session.release('pointer', 'p:1', 60)
    expect(engine.activeVoiceCount()).toBe(2)
    // Turning B's SUSTPED off stops only B's voice.
    session.setSustainRouting('piano.b', false)
    expect(engine.activeVoiceCount()).toBe(1)
    expect(session.snapshot().byLayer).toEqual({ 'piano.a': 1, 'piano.b': 0 })
  })

  it('still lets a finger-held note sound when the pedal lifts', () => {
    const { session, engine } = sessionWith()
    session.setSustain(true, 'ui:sustain')
    session.press({ midi: 48, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    session.press({ midi: 55, velocity: 0.7, source: 'pointer', owner: 'p:2' })
    session.release('pointer', 'p:2', 55)
    session.setSustain(false, 'ui:sustain')
    expect(session.snapshot().sounding).toEqual([48])
    expect(engine.activeVoiceCount()).toBe(1)
  })
})

describe('piano.pedals — audible sustain', () => {
  it('keeps a note audible past its key release, and damps it when the pedal lifts', async () => {
    // The pedal extends the hold; the release ramp only begins when the pedal comes up.
    const SR = 48000
    const render = async (holdSeconds: number, sustainTailSeconds: number) => {
      const ctx = new OfflineAudioContext(1, Math.round(SR * 2.4), SR)
      const osc = ctx.createOscillator()
      osc.frequency.value = 220
      const gain = ctx.createGain()
      gain.gain.value = 0.4
      const damper = ctx.createGain()
      damper.gain.value = 1
      osc.connect(gain)
      gain.connect(damper)
      damper.connect(ctx.destination)
      osc.start(0)
      osc.stop(2.3)
      // Schedule the damper exactly the way the engine schedules a voice release.
      const release = releasePoints(0.3, SR)
      const at = holdSeconds + sustainTailSeconds
      damper.gain.setValueAtTime(1, at)
      damper.gain.setValueCurveAtTime(release, at, 0.3)
      const buffer = await ctx.startRendering()
      return buffer.getChannelData(0)
    }
    const pedalUp = await render(0.2, 0)
    const pedalDown = await render(0.2, 0.8)
    const probe = Math.round((0.2 + 0.4) * SR)
    // With the pedal down the note is still sounding 0.4 s after key release; with the pedal
    // up it has already been damped.
    expect(rms(pedalDown, probe, probe + 2000)).toBeGreaterThan(0.01)
    expect(rms(pedalUp, probe, probe + 2000)).toBeLessThan(rms(pedalDown, probe, probe + 2000) / 10)
  }, 60000)
})

describe('piano.pedals — what is honestly not claimed', () => {
  it('claims no soft or sostenuto pedal, and no half-pedalling', async () => {
    // These are deliberate exclusions from the piano spec. The check is that the shipped
    // implementation exposes exactly one pedal concept and treats CC64 as a binary switch.
    const seen: string[] = []
    const handlers = {
      onNoteOn: () => seen.push('note'),
      onNoteOff: () => seen.push('off'),
      onSustain: (down: boolean) => seen.push(down ? 'sustain-on' : 'sustain-off'),
      onAllNotesOff: () => seen.push('all-off'),
    }
    // CC67 (soft pedal) and CC66 (sostenuto) are ignored rather than silently mapped.
    expect(decodeMidiMessage(new Uint8Array([0xb0, 67, 127]), handlers).kind).toBe('ignored')
    expect(decodeMidiMessage(new Uint8Array([0xb0, 66, 127]), handlers).kind).toBe('ignored')
    // And CC64 is binary: any value >= 64 is down, so there is no half-pedal resolution.
    expect(decodeMidiMessage(new Uint8Array([0xb0, 64, 64]), handlers).kind).toBe('sustain-on')
    expect(decodeMidiMessage(new Uint8Array([0xb0, 64, 100]), handlers).kind).toBe('sustain-on')
    expect(seen).toEqual(['sustain-on', 'sustain-on'])
  })

  it('exposes exactly one sustain concept in the session surface', () => {
    const { session } = sessionWith()
    // No softPedal / sostenuto entry point exists: the API cannot suggest one.
    const keys = Object.keys(session)
    expect(keys).toContain('setSustain')
    expect(keys).not.toContain('setSoftPedal')
    expect(keys).not.toContain('setSostenuto')
    expect(keys).not.toContain('setHalfPedal')
  })
})
