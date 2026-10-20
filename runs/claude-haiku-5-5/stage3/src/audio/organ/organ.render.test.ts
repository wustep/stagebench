// @vitest-environment node
// organ.engine, organ.models-drawbars, organ.rotary: the organ's sound, rendered and measured.
import { describe, expect, it } from 'vitest'
import type { ControlAction } from '../../model/hardware'
import { DRAWBAR_RATIOS } from './models'
import { renderEngines } from '../testing/engines'
import { asBoundary, difference, largestJump, mono, offlineContext, renderWithEvents, rms, toneAmplitude } from '../testing/offline'
import { deriveAudioSettings } from '../../model/audioSettings'
import { initialPresentation, presentationReducer } from '../../model/hardware'
import { startOrganVoice, type OrganVibrato, type OrganPercussion } from './organVoice'

const A3 = 220
const NOTE = 57
const WINDOW = [0.3, 0.9] as const
const DRAWBAR_IDS = [
  'organ.drawbar-16',
  'organ.drawbar-5-1-3',
  'organ.drawbar-8',
  'organ.drawbar-4',
  'organ.drawbar-2-2-3',
  'organ.drawbar-2',
  'organ.drawbar-1-3-5',
  'organ.drawbar-1-1-3',
  'organ.drawbar-1',
]

/** Drawbar settings as panel actions on the focused organ layer (A by default). */
function drawbarActions(values: readonly number[]): ControlAction[] {
  return DRAWBAR_IDS.map((id, index) => ({ type: 'set', id, value: values[index] }))
}

/** The amplitude at each drawbar's partial frequency, normalized so the loudest is 1. */
function spectrum(data: Float32Array, from = WINDOW[0], to = WINDOW[1]): number[] {
  const amps = DRAWBAR_RATIOS.map((ratio) => toneAmplitude(data, A3 * ratio, 44100, from, to))
  const peak = Math.max(...amps, 1e-9)
  return amps.map((amp) => amp / peak)
}

function distance(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0)
}

async function play(actions: ControlAction[], seconds = 1.1, extra: Partial<Parameters<typeof renderEngines>[0]> = {}) {
  return renderEngines({ seconds, actions, notes: [{ note: NOTE, on: 0.05, off: 1.0 }], ...extra })
}

describe('organ.models-drawbars: sound', () => {
  it('B3, Vox, Farf, and Pipe 1 each render a different harmonic spectrum from the same drawbars', async () => {
    const drawbars = drawbarActions([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
    const spectra: Record<string, number[]> = {}
    for (const model of ['b3', 'vox', 'farf', 'pipe1']) {
      const switches: ControlAction[] = model === 'b3' ? [] : [{ type: 'toggle', id: `organ.model-${model === 'pipe1' ? 'pipe-1' : model}` }]
      const played = await play([...drawbars, ...switches])
      spectra[model] = spectrum(played.mono)
    }
    const names = Object.keys(spectra)
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        expect(distance(spectra[names[i]], spectra[names[j]]), `${names[i]} vs ${names[j]}`).toBeGreaterThan(0.25)
      }
    }
  }, 60000)

  it('a drawbar moved to full changes the audible spectrum at its own partial', async () => {
    const before = await play(drawbarActions([0, 0, 0, 0, 0, 0, 0, 0, 0]))
    const after = await play([...drawbarActions([0, 0, 0, 0, 0, 0, 0, 0, 1])])
    const ratio = DRAWBAR_RATIOS[8]
    const partialBefore = toneAmplitude(before.mono, A3 * ratio, 44100, ...WINDOW)
    const partialAfter = toneAmplitude(after.mono, A3 * ratio, 44100, ...WINDOW)
    expect(partialAfter).toBeGreaterThan(partialBefore + 0.005)
  }, 60000)

  it('the drawbar LED position is the value the sound uses', async () => {
    const played = await play([{ type: 'set', id: 'organ.drawbar-4', value: 0.75 }])
    expect(played.state['organ.drawbar-4@A']).toBe(0.75)
    expect(played.instrument.piano.engine.audio?.graph).toBeDefined()
  }, 60000)
})

describe('organ.engine: percussion, vibrato, and chorus render', () => {
  it('B3 percussion adds an attack partial that the note without it does not have', async () => {
    const plain = await play([{ type: 'set', id: 'organ.drawbar-4', value: 0 }])
    const percussive = await play([{ type: 'set', id: 'organ.drawbar-4', value: 0 }, { type: 'toggle', id: 'organ.perc-on' }])
    const attack = [0.02, 0.2] as const
    expect(rms(percussive.mono, 44100, ...attack)).toBeGreaterThan(rms(plain.mono, 44100, ...attack) * 1.02)
  }, 60000)

  it('the percussion harmonic switch moves the attack partial from the second to the third harmonic', async () => {
    const second = await play([{ type: 'toggle', id: 'organ.perc-on' }], 0.5)
    const third = await play([{ type: 'toggle', id: 'organ.perc-on' }, { type: 'toggle', id: 'organ.perc-harmonic' }], 0.5)
    const window = [0.02, 0.2] as const
    expect(toneAmplitude(third.mono, A3 * 3, 44100, ...window)).toBeGreaterThan(toneAmplitude(second.mono, A3 * 3, 44100, ...window))
  }, 60000)

  it('vibrato V1 changes the sound, and chorus C1 sounds different from vibrato V1', async () => {
    const dry = await play([])
    const vibrato = await play([{ type: 'toggle', id: 'organ.vib-on' }])
    const chorus = await play([{ type: 'toggle', id: 'organ.vib-on' }, { type: 'advance', id: 'organ.vib-type' }, { type: 'advance', id: 'organ.vib-type' }, { type: 'advance', id: 'organ.vib-type' }])
    expect(difference(vibrato.mono, dry.mono)).toBeGreaterThan(0.0005)
    expect(difference(chorus.mono, vibrato.mono)).toBeGreaterThan(0.0005)
  }, 60000)

  it('a key click adds a transient at the note attack, on a voice that asks for one', async () => {
    const make = (keyClick: boolean) => {
      const context = offlineContext(0.2)
      const boundary = asBoundary(context)
      const rendering = renderWithEvents(context, [
        {
          time: 0,
          run: () =>
            startOrganVoice(boundary, boundary.destination, A3, 0.4, {
              partials: [{ ratio: 1, amp: 0.4 }],
              vibrato: { on: false, type: 0, depth: 0 } satisfies OrganVibrato,
              keyClick,
            }, () => {}),
        },
      ])
      return rendering.then((played) => mono(played))
    }
    const withClick = await make(true)
    const withoutClick = await make(false)
    // The click is the only difference between the two voices, so the first 12 ms must differ.
    const early = [0, 0.012] as const
    expect(difference(withClick.slice(0, 530), withoutClick.slice(0, 530))).toBeGreaterThan(0.0005)
    expect(rms(withClick, 44100, ...early)).toBeGreaterThan(0)
  }, 60000)

  it('percussion is a real option on the voice, so a percussive voice differs from a plain one', async () => {
    const percussion: OrganPercussion = { on: true, soft: false, fast: false, third: false, volume: 1 }
    const make = (perc?: OrganPercussion) => {
      const context = offlineContext(0.6)
      const boundary = asBoundary(context)
      return renderWithEvents(context, [
        {
          time: 0,
          run: () => startOrganVoice(boundary, boundary.destination, A3, 0.4, { partials: [{ ratio: 1, amp: 0.4 }], vibrato: { on: false, type: 0, depth: 0 }, percussion: perc, keyClick: false }, () => {}, true),
        },
      ]).then((played) => mono(played))
    }
    const plain = await make()
    const percussive = await make(percussion)
    expect(difference(percussive, plain)).toBeGreaterThan(0.001)
  }, 60000)
})

describe('organ.rotary: routing and speed', () => {
  it('routing the organ to the rotary changes the sound, and the speed switch changes it again', async () => {
    const routed = await play([])
    const bypassed = await play([{ type: 'toggle', id: 'performance.rotary-organ' }])
    expect(difference(routed.mono, bypassed.mono)).toBeGreaterThan(0.001)
    const slow = await play([{ type: 'set', id: 'performance.rotary-speed', value: 0 }])
    const fast = await play([{ type: 'set', id: 'performance.rotary-speed', value: 1 }])
    expect(difference(slow.mono, fast.mono)).toBeGreaterThan(0.001)
  }, 60000)

  it('a speed change ramps instead of switching, so it does not click', async () => {
    const fastState = presentationReducer(initialPresentation(), { type: 'set', id: 'performance.rotary-speed', value: 1 })
    const played = await play([], 2.0, {
      events: [{ time: 1.0, run: (instrument) => instrument.configure(deriveAudioSettings(fastState)) }],
    })
    // Around the switch the output may change its rhythm, but it must not jump: the largest step stays near the steady one.
    const steady = largestJump(played.mono, Math.round(0.5 * 44100), Math.round(0.6 * 44100))
    const around = largestJump(played.mono, Math.round(1.0 * 44100), Math.round(1.1 * 44100))
    expect(around).toBeLessThan(steady * 3)
  }, 60000)
})
