import { describe, expect, it } from 'vitest'
import { ManualScheduler } from './graph'
import { engineRig, settingsWith } from '../test/engineRig'
import { bandEnergy, peak, relativeDifference, rms } from './offline'
import { ArpRunner } from './arp'
import {
  WAVEFORMS,
  arpSteps,
  attackSeconds,
  decaySeconds,
  driveAmount,
  filterHz,
  filterStages,
  isSustainDecay,
  oscCtrlValue,
  syncedHz,
  trackedCutoff,
  unisonVoices,
  waveformName,
} from './synthVoice'
import type { EngineSettings, OscCategory } from './settings'

/**
 * Synth engine, asserted on rendered audio and on the deterministic arpeggiator clock.
 *
 * Features: synth.sources, synth.filter, synth.envelopes, synth.lfo, synth.voice, synth.arp
 */

function synthSettings(layer: Record<string, unknown> = {}): EngineSettings {
  return settingsWith({
    sectionOn: false,
    layers: { a: { enabled: false }, b: { enabled: false } },
    synth: {
      sectionOn: true,
      layers: { a: { enabled: true, level: 0.9, ...layer } },
    },
  })
}

function renderSynth(settings: EngineSettings, midi = 60, seconds = 0.5): Float32Array {
  const rig = engineRig({ settings })
  rig.engine.noteOn('test', midi, 0.9)
  return rig.graph.render(seconds)
}

describe('synth oscillator sources', () => {
  it('offers exactly the required waveform list', () => {
    expect(WAVEFORMS.pure).toEqual([
      'Sine',
      'Triangle',
      'Saw',
      'Square',
      'Pulse 33',
      'Pulse 10',
      'White Noise',
    ])
    expect(WAVEFORMS.sync).toEqual(['Sync Saw', 'Sync Square'])
    expect(WAVEFORMS.multi).toEqual(['Multi Saw', 'Multi Saw 8ve'])
    expect(WAVEFORMS.super).toEqual(['Super Saw', 'Super Square'])
    expect(WAVEFORMS.fmh).toEqual(['FM 2-op (algorithm A)'])
    expect(waveformName('pure', 99)).toBe('White Noise')
  })

  it('renders the five categories as audibly distinct sources', () => {
    const categories: OscCategory[] = ['pure', 'sync', 'multi', 'super', 'fmh']
    const rendered = categories.map((category) =>
      renderSynth(synthSettings({ category, waveform: 0, oscCtrl: 0.6, filter: { on: false } })),
    )
    for (const audio of rendered) expect(peak(audio)).toBeGreaterThan(0.001)
    for (let i = 0; i < rendered.length; i += 1) {
      for (let j = i + 1; j < rendered.length; j += 1) {
        expect(
          relativeDifference(rendered[i], rendered[j]),
          `${categories[i]} vs ${categories[j]} must differ`,
        ).toBeGreaterThan(0.2)
      }
    }
  })

  it('gives every Pure waveform its own spectrum, including both pulse widths and noise', () => {
    const rendered = WAVEFORMS.pure.map((_, waveform) =>
      renderSynth(synthSettings({ category: 'pure', waveform, filter: { on: false } })),
    )
    for (let i = 0; i < rendered.length; i += 1) {
      for (let j = i + 1; j < rendered.length; j += 1) {
        expect(
          relativeDifference(rendered[i], rendered[j]),
          `${WAVEFORMS.pure[i]} vs ${WAVEFORMS.pure[j]}`,
        ).toBeGreaterThan(0.1)
      }
    }
    // Noise has no pitch: its energy is spread, not concentrated at the fundamental.
    const sine = bandEnergy(rendered[0], 16000, 240, 280)
    const noise = bandEnergy(rendered[6], 16000, 240, 280)
    expect(sine).toBeGreaterThan(noise * 3)
  })

  it('acts on Osc Ctrl per category and leaves Pure alone, as the manual says', () => {
    expect(oscCtrlValue('pure', 1)).toBe(0)
    expect(oscCtrlValue('sync', 0)).toBe(1)
    expect(oscCtrlValue('sync', 1)).toBe(8)
    expect(oscCtrlValue('multi', 1)).toBe(40)
    expect(oscCtrlValue('super', 1)).toBe(70)
    expect(oscCtrlValue('fmh', 1)).toBe(8)

    for (const category of ['sync', 'multi', 'super', 'fmh'] as OscCategory[]) {
      const low = renderSynth(synthSettings({ category, waveform: 0, oscCtrl: 0.05, filter: { on: false } }))
      const high = renderSynth(synthSettings({ category, waveform: 0, oscCtrl: 0.95, filter: { on: false } }))
      expect(relativeDifference(low, high), `${category} Osc Ctrl`).toBeGreaterThan(0.05)
    }
    // Pure: the knob is documented as having no effect, and it really has none.
    const pureLow = renderSynth(synthSettings({ category: 'pure', waveform: 2, oscCtrl: 0, filter: { on: false } }))
    const pureHigh = renderSynth(synthSettings({ category: 'pure', waveform: 2, oscCtrl: 1, filter: { on: false } }))
    expect(relativeDifference(pureLow, pureHigh)).toBe(0)
  })
})

describe('synth filter', () => {
  it('maps the four required types onto different biquad stacks', () => {
    expect(filterStages('lp12')).toHaveLength(1)
    expect(filterStages('lp24')).toHaveLength(2)
    expect(filterStages('hp')[0].type).toBe('highpass')
    expect(filterStages('bp')[0].type).toBe('bandpass')
    // LP M resonates in both sections, so it is not an LP24 under another name.
    expect(filterStages('lpm').every((stage) => stage.role === 'main')).toBe(true)
  })

  it('renders LP12, LP24, HP and BP differently from each other', () => {
    const types = ['lp12', 'lp24', 'hp', 'bp'] as const
    const rendered = types.map((type) =>
      renderSynth(synthSettings({ category: 'pure', waveform: 2, filter: { on: true, type, freq: 0.4, res: 0.4 } })),
    )
    for (let i = 0; i < rendered.length; i += 1) {
      for (let j = i + 1; j < rendered.length; j += 1) {
        expect(relativeDifference(rendered[i], rendered[j]), `${types[i]} vs ${types[j]}`).toBeGreaterThan(0.15)
      }
    }
  })

  it('moves the spectrum with cutoff, resonance, tracking, drive and envelope amount', () => {
    const base = { category: 'pure' as const, waveform: 2 }
    const dark = renderSynth(synthSettings({ ...base, filter: { on: true, freq: 0.2, envAmount: 0 } }))
    const bright = renderSynth(synthSettings({ ...base, filter: { on: true, freq: 0.9, envAmount: 0 } }))
    const band = (audio: Float32Array) => bandEnergy(audio, 16000, 1500, 5000)
    expect(band(bright)).toBeGreaterThan(band(dark) * 2)

    const flat = renderSynth(synthSettings({ ...base, filter: { on: true, freq: 0.4, res: 0, envAmount: 0 } }))
    const resonant = renderSynth(synthSettings({ ...base, filter: { on: true, freq: 0.4, res: 0.95, envAmount: 0 } }))
    expect(relativeDifference(flat, resonant)).toBeGreaterThan(0.1)

    // Keyboard tracking scales the cutoff with the played note.
    expect(trackedCutoff(1000, 72, 0)).toBeCloseTo(1000, 6)
    expect(trackedCutoff(1000, 72, 3)).toBeCloseTo(2000, 6)
    const trackOff = renderSynth(
      synthSettings({ ...base, filter: { on: true, freq: 0.35, tracking: 0, envAmount: 0 } }),
      84,
    )
    const trackFull = renderSynth(
      synthSettings({ ...base, filter: { on: true, freq: 0.35, tracking: 3, envAmount: 0 } }),
      84,
    )
    expect(relativeDifference(trackOff, trackFull)).toBeGreaterThan(0.05)

    expect(driveAmount(0)).toBe(0)
    expect(driveAmount(3)).toBeGreaterThan(driveAmount(1))
    const clean = renderSynth(synthSettings({ ...base, filter: { on: true, drive: 0, envAmount: 0 } }))
    const driven = renderSynth(synthSettings({ ...base, filter: { on: true, drive: 3, envAmount: 0 } }))
    expect(relativeDifference(clean, driven)).toBeGreaterThan(0.05)

    const noEnv = renderSynth(synthSettings({ ...base, filter: { on: true, freq: 0.25, envAmount: 0 } }))
    const swept = renderSynth(synthSettings({ ...base, filter: { on: true, freq: 0.25, envAmount: 0.9 } }))
    expect(relativeDifference(noEnv, swept)).toBeGreaterThan(0.05)
  })

  it('maps cutoff positions onto a rising frequency scale', () => {
    expect(filterHz(0)).toBeCloseTo(22, 6)
    expect(filterHz(1)).toBeGreaterThan(filterHz(0.5))
    expect(filterHz(0.5)).toBeGreaterThan(filterHz(0))
  })
})

describe('synth envelopes and LFO', () => {
  it('shapes the amplifier envelope, with decay at maximum acting as sustain', () => {
    expect(attackSeconds(0)).toBeLessThan(attackSeconds(1))
    expect(decaySeconds(0)).toBeLessThan(decaySeconds(1))
    expect(isSustainDecay(1)).toBe(true)
    expect(isSustainDecay(0.5)).toBe(false)

    const plucked = renderSynth(synthSettings({ amp: { attack: 0, decay: 0.25, release: 0.1 } }), 60, 0.8)
    const sustained = renderSynth(synthSettings({ amp: { attack: 0, decay: 1, release: 0.1 } }), 60, 0.8)
    const tail = (audio: Float32Array) => rms(audio.subarray(audio.length - 2000))
    expect(tail(sustained)).toBeGreaterThan(tail(plucked) * 3)

    const slow = renderSynth(synthSettings({ amp: { attack: 0.8, decay: 1, release: 0.1 } }), 60, 0.5)
    const fast = renderSynth(synthSettings({ amp: { attack: 0, decay: 1, release: 0.1 } }), 60, 0.5)
    const head = (audio: Float32Array) => rms(audio.subarray(0, 1200))
    expect(head(fast)).toBeGreaterThan(head(slow) * 2)
  })

  it('renders the oscillator envelope and the filter envelope as separate effects', () => {
    const none = renderSynth(
      synthSettings({ category: 'fmh', waveform: 0, oscCtrl: 0.3, oscEnv: { amount: 0 }, filter: { on: false } }),
    )
    const swept = renderSynth(
      synthSettings({
        category: 'fmh',
        waveform: 0,
        oscCtrl: 0.3,
        oscEnv: { amount: 0.9, attack: 0, decay: 0.5 },
        filter: { on: false },
      }),
    )
    expect(relativeDifference(none, swept)).toBeGreaterThan(0.05)

    // Env To Pitch retargets the same envelope from Osc Ctrl to pitch.
    const toPitch = renderSynth(
      synthSettings({
        category: 'fmh',
        waveform: 0,
        oscCtrl: 0.3,
        oscEnv: { amount: 0.9, attack: 0, decay: 0.5, toPitch: true },
        filter: { on: false },
      }),
    )
    expect(relativeDifference(swept, toPitch)).toBeGreaterThan(0.05)
  })

  it('modulates each LFO destination, stays silent when the destination is off, and syncs', () => {
    const off = renderSynth(
      synthSettings({ category: 'pure', waveform: 2, lfo: { destination: 'off', amount: 1, rate: 0.5 } }),
      60,
      0.7,
    )
    for (const destination of ['pitch', 'filter'] as const) {
      const modulated = renderSynth(
        synthSettings({
          category: 'pure',
          waveform: 2,
          filter: { on: true, freq: 0.5, envAmount: 0 },
          lfo: { destination, amount: 1, rate: 0.5 },
        }),
        60,
        0.7,
      )
      const plain = renderSynth(
        synthSettings({
          category: 'pure',
          waveform: 2,
          filter: { on: true, freq: 0.5, envAmount: 0 },
          lfo: { destination: 'off', amount: 1, rate: 0.5 },
        }),
        60,
        0.7,
      )
      expect(relativeDifference(plain, modulated), destination).toBeGreaterThan(0.05)
    }
    // Osc Ctrl as an LFO destination reaches the FM index.
    const fmPlain = renderSynth(
      synthSettings({ category: 'fmh', waveform: 0, oscCtrl: 0.3, filter: { on: false }, lfo: { destination: 'off' } }),
      60,
      0.7,
    )
    const fmModulated = renderSynth(
      synthSettings({
        category: 'fmh',
        waveform: 0,
        oscCtrl: 0.3,
        filter: { on: false },
        lfo: { destination: 'ctrl', amount: 1, rate: 0.5 },
      }),
      60,
      0.7,
    )
    expect(relativeDifference(fmPlain, fmModulated)).toBeGreaterThan(0.05)
    expect(peak(off)).toBeGreaterThan(0)

    // Master-clock sync turns the rate knob into a subdivision of the tempo.
    expect(syncedHz(120, 0)).toBeCloseTo(0.5, 6)
    expect(syncedHz(120, 1)).toBeGreaterThan(syncedHz(120, 0))
    expect(syncedHz(240, 0.5)).toBeCloseTo(syncedHz(120, 0.5) * 2, 6)
  })
})

describe('synth voice behaviour', () => {
  it('builds one voice per key in poly and one voice per layer in mono', () => {
    const poly = engineRig({ settings: synthSettings({ voice: { mode: 'poly' } }) })
    poly.engine.noteOn('one', 60)
    poly.engine.noteOn('two', 64)
    expect(poly.engine.activeVoiceCount).toBe(2)

    const mono = engineRig({ settings: synthSettings({ voice: { mode: 'mono' } }) })
    mono.engine.noteOn('one', 60)
    mono.engine.noteOn('two', 64)
    expect(mono.engine.activeVoiceCount).toBe(1)
    expect(mono.engine.soundingNotes()).toEqual([64])
    // Releasing the newer key falls back to the older one, still on one voice.
    mono.engine.noteOff('two')
    expect(mono.engine.soundingNotes()).toEqual([60])
  })

  it('honours note priority when several keys are held', () => {
    for (const [priority, expected] of [
      ['low', 55],
      ['high', 72],
      ['off', 64],
    ] as const) {
      const rig = engineRig({ settings: synthSettings({ voice: { mode: 'mono', priority } }) })
      rig.engine.noteOn('a', 60)
      rig.engine.noteOn('b', 72)
      rig.engine.noteOn('c', 55)
      rig.engine.noteOn('d', 64)
      expect(rig.engine.soundingNotes(), priority).toEqual([expected])
    }
  })

  it('glides between legato notes and stacks unison voices', () => {
    const glide = engineRig({
      settings: synthSettings({ voice: { mode: 'legato', glide: 0.8 }, amp: { decay: 1 } }),
    })
    glide.engine.noteOn('one', 48)
    glide.graph.advanceClock(0.05)
    glide.engine.noteOn('two', 60)
    const glided = glide.graph.render(0.6)

    const stepped = engineRig({
      settings: synthSettings({ voice: { mode: 'legato', glide: 0 }, amp: { decay: 1 } }),
    })
    stepped.engine.noteOn('one', 48)
    stepped.graph.advanceClock(0.05)
    stepped.engine.noteOn('two', 60)
    const hard = stepped.graph.render(0.6)
    expect(relativeDifference(glided, hard)).toBeGreaterThan(0.05)

    expect(unisonVoices(0)).toBe(1)
    expect(unisonVoices(3)).toBe(4)
    const single = renderSynth(synthSettings({ voice: { unison: 0 } }), 60, 0.6)
    const stacked = renderSynth(synthSettings({ voice: { unison: 3 } }), 60, 0.6)
    expect(relativeDifference(single, stacked)).toBeGreaterThan(0.1)
  })

  it('adds vibrato only when a vibrato source is selected', () => {
    const dry = renderSynth(synthSettings({ voice: { vibrato: { mode: 'off', rate: 5.5, amount: 1 } } }), 60, 0.8)
    const wet = renderSynth(synthSettings({ voice: { vibrato: { mode: 'on', rate: 5.5, amount: 1 } } }), 60, 0.8)
    expect(relativeDifference(dry, wet)).toBeGreaterThan(0.05)
  })

  it('bends sounding synth voices from the pitch stick', () => {
    const rig = engineRig({ settings: synthSettings({ amp: { decay: 1 }, filter: { on: false } }) })
    rig.engine.noteOn('test', 60, 0.9)
    const straight = rig.graph.render(0.4)
    rig.engine.applySettings(
      settingsWith({ pitchBend: 2 }, synthSettings({ amp: { decay: 1 }, filter: { on: false } })),
    )
    const bent = rig.graph.render(0.4)
    expect(peak(straight)).toBeGreaterThan(0)
    expect(relativeDifference(straight, bent)).toBeGreaterThan(0.1)
  })

  it('mutes the two synth modes this build does not implement instead of faking them', () => {
    const analog = renderSynth(synthSettings({ mode: 'analog' }))
    expect(peak(analog)).toBeGreaterThan(0)
    for (const mode of ['samples', 'extern'] as const) {
      expect(peak(renderSynth(synthSettings({ mode }))), mode).toBe(0)
    }
  })
})

describe('arpeggiator and gate', () => {
  it('produces a deterministic step order for every direction', () => {
    const notes = [60, 64, 67]
    expect(arpSteps(notes, 1, 'up')).toEqual([60, 64, 67])
    expect(arpSteps(notes, 1, 'down')).toEqual([67, 64, 60])
    expect(arpSteps(notes, 1, 'updown')).toEqual([60, 64, 67, 64])
    expect(arpSteps(notes, 2, 'up')).toEqual([60, 64, 67, 72, 76, 79])
    expect(arpSteps(notes, 4, 'up')).toHaveLength(12)
    // Random is seeded from the note set, so it repeats exactly.
    expect(arpSteps(notes, 1, 'random')).toEqual(arpSteps(notes, 1, 'random'))
    expect(new Set(arpSteps(notes, 1, 'random'))).toEqual(new Set(notes))
    expect(arpSteps([], 2, 'up')).toEqual([])
  })

  it('fires steps on the injected clock, in order, and stops when it is switched off', () => {
    const scheduler = new ManualScheduler()
    const fired: number[][] = []
    const runner = new ArpRunner(scheduler, (notes) => fired.push([...notes]))
    runner.setConfig({ mode: 'arp', run: true, stepsPerSecond: 4, range: 1, direction: 'up' })
    runner.setNotes([60, 64, 67])
    scheduler.advance(1)
    for (let step = 0; step < 4; step += 1) scheduler.advance(250)
    expect(fired).toEqual([[60], [64], [67], [60], [64]])

    runner.setConfig({ mode: 'arp', run: false, stepsPerSecond: 4, range: 1, direction: 'up' })
    const before = fired.length
    scheduler.advance(1000)
    expect(fired).toHaveLength(before)
  })

  it('gates every held note at once instead of arpeggiating them', () => {
    const scheduler = new ManualScheduler()
    const fired: number[][] = []
    const runner = new ArpRunner(scheduler, (notes) => fired.push([...notes]))
    runner.setConfig({ mode: 'gate', run: true, stepsPerSecond: 8, range: 2, direction: 'up' })
    runner.setNotes([60, 67])
    scheduler.advance(1)
    scheduler.advance(125)
    expect(fired).toEqual([
      [60, 67],
      [60, 67],
    ])
  })

  it('plays real audio through the engine when ARP RUN is on, and holds notes with KB Hold', () => {
    const rig = engineRig({
      settings: synthSettings({
        arp: { mode: 'arp', run: true, rate: 0.5, range: 1, direction: 'up' },
        amp: { attack: 0, decay: 0.4, release: 0.1 },
      }),
    })
    rig.engine.noteOn('a', 60)
    rig.engine.noteOn('b', 64)
    rig.scheduler.advance(1)
    expect(rig.engine.activeVoiceCount).toBeGreaterThan(0)
    expect(peak(rig.graph.render(0.3))).toBeGreaterThan(0)

    // Without KB Hold, lifting the keys stops the sequence.
    rig.engine.noteOff('a')
    rig.engine.noteOff('b')
    const stepsBefore = rig.engine.arp('a').stepIndex
    rig.scheduler.advance(2000)
    expect(rig.engine.arp('a').stepIndex).toBe(stepsBefore)

    const held = engineRig({
      settings: synthSettings({
        arp: { mode: 'arp', run: true, rate: 0.5, range: 1, direction: 'up', hold: true },
      }),
    })
    held.engine.noteOn('a', 60)
    held.scheduler.advance(1)
    held.engine.noteOff('a')
    const heldBefore = held.engine.arp('a').stepIndex
    held.scheduler.advance(1000)
    expect(held.engine.arp('a').stepIndex).toBeGreaterThan(heldBefore)
  })

  it('locks the arpeggiator to the master clock when sync is on', () => {
    const slow = engineRig({
      settings: settingsWith(
        { clock: { bpm: 60 } },
        synthSettings({ arp: { mode: 'arp', run: true, rate: 0.5, clockSync: true } }),
      ),
    })
    slow.engine.noteOn('a', 60)
    slow.scheduler.advance(1)
    const fast = engineRig({
      settings: settingsWith(
        { clock: { bpm: 240 } },
        synthSettings({ arp: { mode: 'arp', run: true, rate: 0.5, clockSync: true } }),
      ),
    })
    fast.engine.noteOn('a', 60)
    fast.scheduler.advance(1)
    // The manual scheduler only runs timers that were already due, so time moves in slices.
    for (let slice = 0; slice < 20; slice += 1) {
      slow.scheduler.advance(50)
      fast.scheduler.advance(50)
    }
    expect(fast.engine.arp('a').stepIndex).toBeGreaterThan(slow.engine.arp('a').stepIndex)
  })
})
