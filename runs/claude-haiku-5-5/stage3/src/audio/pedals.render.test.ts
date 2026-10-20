// @vitest-environment node
// piano.pedals: sustain from the UI, the keyboard, and MIDI CC64 holds the notes, and only when SUSTPED routes it.
import { describe, expect, it } from 'vitest'
import { createPianoInstrument } from '../instrument/pianoInstrument'
import { deriveAudioSettings } from '../model/audioSettings'
import { initialPresentation, presentationReducer, type ControlAction } from '../model/hardware'
import { play } from './testing/scenario'
import { asBoundary, diskSampleLoader, mono, offlineContext, renderWithEvents, rms } from './testing/offline'

const CUT = [0.3, 1.2] as const
/** Level in the window after the key is released and before any pedal could be lifted. */
const TAIL = (signal: Float32Array) => rms(signal, 44100, 0.7, 1.1)

async function held(pedal: { time: number; on: boolean; source?: string }[], actions: ControlAction[] = []) {
  const played = await play({
    seconds: 1.8,
    notes: [{ note: 60, velocity: 100, off: CUT[0] }],
    pedal,
    actions,
  })
  return mono(played.rendered)
}

describe('piano.pedals render', () => {
  it('the UI pedal holds a released note until the pedal lifts', async () => {
    const plain = await held([])
    const pedalled = await held([
      { time: 0.1, on: true },
      { time: CUT[1], on: false },
    ])
    expect(TAIL(pedalled)).toBeGreaterThan(TAIL(plain) * 4)
  }, 60000)

  it('the keyboard Shift sustain does the same job as the pedal', async () => {
    const plain = await held([])
    const shifted = await held([
      { time: 0.1, on: true, source: 'key:sustain' },
      { time: CUT[1], on: false, source: 'key:sustain' },
    ])
    expect(TAIL(shifted)).toBeGreaterThan(TAIL(plain) * 4)
  }, 60000)

  it('lifting the pedal releases the held note, so it decays again', async () => {
    const lifted = await held([
      { time: 0.1, on: true },
      { time: 0.9, on: false },
    ])
    const stillDown = await held([{ time: 0.1, on: true }])
    // Both have the note held past 0.9 s. Only the lifted one has released, so its late level is far lower.
    expect(rms(lifted, 44100, 1.3, 1.8)).toBeLessThan(rms(stillDown, 44100, 1.3, 1.8) * 0.5)
  }, 60000)

  it('SUSTPED off: the pedal reaches no notes in the section', async () => {
    const pedal = [
      { time: 0.1, on: true },
      { time: CUT[1], on: false },
    ]
    const routed = await held(pedal)
    const unrouted = await held(pedal, [{ type: 'toggle', id: 'piano.sustped' } as ControlAction])
    expect(TAIL(routed)).toBeGreaterThan(TAIL(unrouted) * 4)
  }, 60000)

  it('MIDI CC64 holds notes from the Web MIDI input, and releases them when it lifts', async () => {
    const input: { id: string; state: 'connected'; onmidimessage: ((event: { data: Uint8Array }) => void) | null } = {
      id: 'test-keyboard',
      state: 'connected',
      onmidimessage: null,
    }
    const access = { inputs: new Map([[input.id, input]]), onstatechange: null }
    const context = offlineContext(1.8)
    const instrument = createPianoInstrument({
      audioFactory: () => asBoundary(context),
      sampleLoader: diskSampleLoader(),
      midiRequest: () => Promise.resolve(access),
    })
    instrument.configure(deriveAudioSettings(initialPresentation()))
    await instrument.ready()
    instrument.connectMidi()
    await Promise.resolve()
    await Promise.resolve()
    expect(input.onmidimessage).not.toBeNull()
    const send = (...data: number[]) => input.onmidimessage?.({ data: new Uint8Array(data) })

    const rendered = await renderWithEvents(context, [
      { time: 0, run: () => send(0x90, 60, 100) },
      { time: 0.1, run: () => send(0xb0, 64, 127) },
      { time: CUT[0], run: () => send(0x80, 60, 0) },
      { time: CUT[1], run: () => send(0xb0, 64, 0) },
    ])
    expect(TAIL(mono(rendered))).toBeGreaterThan(0.001)
  }, 60000)
})

describe('piano.pedals: state and routing', () => {
  it('reports the sustain pedal as active only while SUSTPED routes it', () => {
    const state = initialPresentation()
    expect(deriveAudioSettings(state).sustainRouted).toBe(true)
    const off = presentationReducer(state, { type: 'toggle', id: 'piano.sustped' })
    expect(deriveAudioSettings(off).sustainRouted).toBe(false)
  })
})
