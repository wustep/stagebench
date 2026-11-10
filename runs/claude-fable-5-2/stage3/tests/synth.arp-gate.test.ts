import { describe, expect, it } from 'vitest'
import { ArpDirection, ArpMode, SynthWave, arpBpm, arpOctaves, clockDivision, type SynthLayerSound } from '../src/audio/dsp/params'
import { ARP_DIRECTIONS, ARP_MODES } from '../src/synth/catalog'
import { envelope } from './support/fxbench'
import { makeRig, noteHz, renderKernel, retune, slice, synthKernel } from './support/rig'
import { SR, equal, magnitudeAt, mono, rms } from './support/signal'

/**
 * Feature: synth.arp-gate
 * Deterministic rate, clock sync, range, direction, hold, and run.
 *
 * The arpeggiator runs inside the DSP kernel on the sample clock, so the tests read its steps
 * (`arpSteps`: the sample each step fell on and the notes it played) and the audio it makes.
 */

const CHORD = [48, 52, 55]

function arp(configure?: (layer: SynthLayerSound) => void, chord: number[] = CHORD) {
  const kernel = synthKernel((layer) => {
    layer.osc.wave = SynthWave.Sine
    layer.ampEnv = { attack: 0.001, decay: 1, release: 0.01, sustain: true, velocity: 0 }
    layer.arp = { run: true, mode: ArpMode.Arp, rate: 8, range: 1, hardness: 1, direction: ArpDirection.Up, kbSync: true }
    configure?.(layer)
  })
  for (const note of chord) kernel.noteOn(note, 0.8)
  return kernel
}
const steps = (kernel: ReturnType<typeof synthKernel>) => kernel.synthLayer(0).arpSteps
const notes = (kernel: ReturnType<typeof synthKernel>) => steps(kernel).map((step) => step.notes[0])

describe('synth.arp-gate: rate and timing', () => {
  it('steps land exactly on the sample clock at the set rate', () => {
    const kernel = arp()
    renderKernel(kernel, 2)
    const times = steps(kernel).map((step) => step.time)
    expect(times.length).toBe(16)
    expect(times[0]).toBe(0)
    // 8 steps a second at 48 kHz: every 6000 samples, to the sample.
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBe(SR / 8)
  })

  it('a rate that does not divide the sample rate keeps its long-run tempo: no drift', () => {
    const kernel = arp((layer) => {
      layer.arp.rate = 7
    })
    renderKernel(kernel, 10)
    const times = steps(kernel).map((step) => step.time)
    expect(times.length).toBe(70)
    const last = times[times.length - 1]
    expect(Math.abs(last - (69 * SR) / 7)).toBeLessThanOrEqual(1)
    for (let i = 1; i < times.length; i += 1) expect(Math.abs(times[i] - times[i - 1] - SR / 7)).toBeLessThanOrEqual(1)
  })

  it('is deterministic: the same keys and settings give the same steps and the same samples', () => {
    const run = () => {
      const kernel = arp((layer) => {
        layer.arp.direction = ArpDirection.Random
        layer.arp.range = 3
      })
      const out = renderKernel(kernel, 3)
      return { out, steps: steps(kernel).map((step) => `${step.time}:${step.notes.join(',')}`) }
    }
    const first = run()
    const second = run()
    expect(first.steps).toEqual(second.steps)
    expect(equal(first.out.left, second.out.left)).toBe(true)
    expect(rms(first.out.left)).toBeGreaterThan(0.01)
  })

  it('what the log says is what sounds: each step plays its note and stops before the next', () => {
    // Three notes far enough apart to tell from one another in a tenth of a second.
    const wide = [60, 67, 76]
    const kernel = arp((layer) => {
      layer.arp.rate = 4
    }, wide)
    const out = mono(renderKernel(kernel, 0.75))
    wide.forEach((note, index) => {
      const window = slice(out, index * 0.25 + 0.02, index * 0.25 + 0.13)
      for (const other of wide) {
        const level = magnitudeAt(window, noteHz(other))
        if (other === note) expect(level, `step ${index}`).toBeGreaterThan(0.05)
        else expect(level, `step ${index} should not play ${other}`).toBeLessThan(0.01)
      }
      // A step sounds for 60 % of its length: the last fifth of it is silent.
      expect(rms(slice(out, index * 0.25 + 0.21, index * 0.25 + 0.245))).toBeLessThan(0.002)
    })
    expect(kernel.synthLayer(0).voiceCount).toBeLessThanOrEqual(1)
  })

  it('the Rate knob is quarter-note BPM (it plays eighth notes), 30 to 300', () => {
    expect(arpBpm(0)).toBeCloseTo(30)
    expect(arpBpm(10)).toBeCloseTo(300)
    const rig = makeRig()
    rig.press('synth-on')
    rig.set('synth-arp-rate', 5)
    const bpm = arpBpm(5)
    expect(rig.sound().synth.layers[0].arp.rate).toBeCloseTo((bpm / 60) * 2, 9)
    expect(rig.text('synth-arp-rate')).toBe(`Arp Rate ${Math.round(bpm)} BPM`)
    rig.set('synth-arp-rate', 8)
    expect(rig.sound().synth.layers[0].arp.rate).toBeGreaterThan((bpm / 60) * 2 * 1.5)
    rig.dispose()
  })
})

describe('synth.arp-gate: direction and range', () => {
  it('Up, Down, Up/Down, and Random order the held notes as their names say', () => {
    expect(ARP_DIRECTIONS).toEqual(['Up', 'Down', 'Up/Down', 'Random'])
    const order = (direction: number) => {
      const kernel = arp((layer) => {
        layer.arp.direction = direction
      })
      renderKernel(kernel, 1)
      return notes(kernel)
    }
    expect(order(ArpDirection.Up)).toEqual([48, 52, 55, 48, 52, 55, 48, 52])
    expect(order(ArpDirection.Down)).toEqual([55, 52, 48, 55, 52, 48, 55, 52])
    // Up/Down does not repeat the top or the bottom note.
    expect(order(ArpDirection.UpDown)).toEqual([48, 52, 55, 52, 48, 52, 55, 52])
    const random = order(ArpDirection.Random)
    expect(new Set(random).size).toBeGreaterThan(1)
    for (const note of random) expect(CHORD).toContain(note)
    expect(random).not.toEqual(order(ArpDirection.Up))
  })

  it('the order follows pitch, not the order the keys went down', () => {
    const kernel = arp(undefined, [55, 48, 52])
    renderKernel(kernel, 0.45)
    expect(notes(kernel)).toEqual([48, 52, 55, 48])
  })

  it('Range repeats the chord in higher octaves: 1 to 4', () => {
    const kernel = arp((layer) => {
      layer.arp.range = 3
    })
    renderKernel(kernel, 1.2)
    expect(notes(kernel).slice(0, 9)).toEqual([48, 52, 55, 60, 64, 67, 72, 76, 79])
    const four = arp((layer) => {
      layer.arp.range = 4
      layer.arp.direction = ArpDirection.Down
    })
    renderKernel(four, 0.5)
    expect(notes(four).slice(0, 4)).toEqual([91, 88, 84, 79])
    // The knob's scale: 1 at the "1" mark, 4 at the "4" mark.
    expect([2.56, 4.19, 5.8, 7.44].map(arpOctaves)).toEqual([1, 2, 3, 4])
    expect(arpOctaves(0)).toBe(1)
    expect(arpOctaves(10)).toBe(4)
  })

  it('Poly mode plays the whole chord on every step, moving through the octaves of the range', () => {
    expect(ARP_MODES).toEqual(['Arp', 'Gate', 'Poly'])
    const kernel = arp((layer) => {
      layer.arp.mode = ArpMode.Poly
      layer.arp.range = 2
    })
    renderKernel(kernel, 0.45)
    expect(steps(kernel).map((step) => step.notes)).toEqual([
      [48, 52, 55],
      [60, 64, 67],
      [48, 52, 55],
      [60, 64, 67],
    ])
  })
})

describe('synth.arp-gate: run, hold, and KB sync', () => {
  it('Arp Run starts and stops it; stopped, the held keys sound as a plain chord', () => {
    const kernel = arp()
    renderKernel(kernel, 0.45)
    expect(steps(kernel).length).toBe(4)
    retune(kernel, (sound) => {
      sound.synth.layers[0].arp.run = false
    })
    renderKernel(kernel, 0.45)
    expect(steps(kernel).length).toBe(4)
    // The three held keys are simply sounding now.
    expect(kernel.synthLayer(0).describe().filter((voice) => !voice.released).map((voice) => voice.note).sort()).toEqual(CHORD)
    retune(kernel, (sound) => {
      sound.synth.layers[0].arp.run = true
    })
    renderKernel(kernel, 0.45)
    expect(steps(kernel).length).toBe(8)
    for (const note of CHORD) kernel.noteOff(note)
    renderKernel(kernel, 0.45)
    expect(steps(kernel).length).toBe(8)
    expect(kernel.voiceCount).toBe(0)
  })

  it('KB Hold keeps the arpeggio running after the keys are lifted, until it is switched off', () => {
    const kernel = arp(undefined, [])
    retune(kernel, (sound) => {
      sound.synth.hold = true
    })
    for (const note of CHORD) kernel.noteOn(note, 0.8)
    renderKernel(kernel, 0.2)
    for (const note of CHORD) kernel.noteOff(note)
    renderKernel(kernel, 1)
    expect(steps(kernel).length).toBe(10)
    expect(notes(kernel).slice(-3)).toEqual([52, 55, 48])
    expect(kernel.synthLayer(0).heldCount).toBe(3)
    // A new chord replaces the held one.
    kernel.noteOn(60, 0.8)
    kernel.noteOn(64, 0.8)
    kernel.noteOff(60)
    kernel.noteOff(64)
    expect(kernel.synthLayer(0).heldCount).toBe(2)
    renderKernel(kernel, 0.5)
    expect(notes(kernel).slice(-2).every((note) => note === 60 || note === 64)).toBe(true)
    // Hold off: the notes are let go and the arpeggio stops.
    retune(kernel, (sound) => {
      sound.synth.hold = false
    })
    const before = steps(kernel).length
    renderKernel(kernel, 0.5)
    expect(steps(kernel).length).toBe(before)
    expect(kernel.voiceCount).toBe(0)
  })

  it('without Hold the arpeggio stops when the keys are lifted', () => {
    const kernel = arp()
    renderKernel(kernel, 0.3)
    for (const note of CHORD) kernel.noteOff(note)
    const before = steps(kernel).length
    renderKernel(kernel, 1)
    expect(steps(kernel).length).toBe(before)
    expect(kernel.voiceCount).toBe(0)
    expect(kernel.layerAsleep(3)).toBe(true)
  })

  it('KB Sync restarts the pattern on the first key; without it new notes wait for the running grid', () => {
    const start = (kbSync: boolean) => {
      const kernel = arp((layer) => {
        layer.arp.kbSync = kbSync
        layer.arp.rate = 4
      }, [])
      // Play, lift, wait a little off the grid, play again.
      kernel.noteOn(48, 0.8)
      renderKernel(kernel, 0.3)
      kernel.noteOff(48)
      renderKernel(kernel, 0.1)
      const at = kernel.synthLayer(0).time
      kernel.noteOn(60, 0.8)
      renderKernel(kernel, 0.4)
      const first = steps(kernel).find((step) => step.notes[0] === 60)!
      return first.time - at
    }
    // With sync the new note starts at once.
    expect(start(true)).toBe(0)
    // Without it, it waits for the next quarter-second grid line: 0.4 s in, that is 0.1 s away.
    const waited = start(false)
    expect(waited).toBeGreaterThan(0.05 * SR)
    expect(waited).toBeLessThan(0.15 * SR)
  })
})

describe('synth.arp-gate: gate mode', () => {
  const gated = (hardness: number, rate = 4) => {
    const kernel = arp((layer) => {
      layer.arp.mode = ArpMode.Gate
      layer.arp.rate = rate
      layer.arp.hardness = hardness
    })
    return { kernel, out: mono(renderKernel(kernel, 1)) }
  }

  it('chops the held chord in time: open for the first half of each step, shut for the second', () => {
    const { kernel, out } = gated(1)
    for (let step = 0; step < 4; step += 1) {
      const open = rms(slice(out, step * 0.25 + 0.03, step * 0.25 + 0.11))
      const shut = rms(slice(out, step * 0.25 + 0.16, step * 0.25 + 0.24))
      expect(open).toBeGreaterThan(0.03)
      expect(shut).toBeLessThan(open * 0.05)
    }
    // The notes are the held chord, all three, and they are never re-struck.
    expect(steps(kernel).map((step) => step.notes)).toEqual([CHORD, CHORD, CHORD, CHORD])
    expect(kernel.synthLayer(0).voiceCount).toBe(3)
  })

  it('the Range knob becomes the gate envelope: soft swells, hard chops', () => {
    const edge = (hardness: number) => {
      const env = envelope(gated(hardness).out, 0.002)
      // Time for the first step to reach half its level.
      const peak = Math.max(...env.slice(0, 60))
      return env.findIndex((value) => value > peak / 2)
    }
    expect(edge(0)).toBeGreaterThan(edge(1) + 5)
    const soft = gated(0).out
    const hard = gated(1).out
    expect(rms(slice(soft, 0.002, 0.012))).toBeLessThan(rms(slice(hard, 0.002, 0.012)) * 0.5)
  })

  it('follows the rate like the arpeggiator does', () => {
    const count = (rate: number) => steps(gated(1, rate).kernel).length
    expect(count(4)).toBe(4)
    expect(count(8)).toBe(8)
  })
})

describe('synth.arp-gate: the Master Clock', () => {
  it('Shift + turning Rate locks the arpeggiator to the clock; the knob then picks the subdivision', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.press('synth-arp-run')
    rig.set('synth-arp-rate', 5)
    rig.shiftSet('synth-arp-rate', 6)
    expect(rig.state().synth.layers[0].arp.sync).toBe(true)
    expect(rig.state().synth.layers[0].arp.rate).toBe(5)
    expect(rig.led('synth-arp-mst-clk')).toBe('on')
    // 1/8 at 120 BPM: four steps a second.
    expect(clockDivision(5).label).toBe('1/8')
    expect(rig.sound().synth.layers[0].arp.rate).toBeCloseTo(4, 9)
    for (const note of CHORD) rig.down(note)
    rig.render(1)
    let times = rig.kernel.synthLayer(0).arpSteps.map((step) => step.time)
    expect(times.length).toBe(4)
    expect(times[1] - times[0]).toBe(SR / 4)

    // Change the clock and the arpeggiator follows: 150 BPM is five eighth notes a second.
    rig.stage.setBpm(150)
    rig.render(1)
    times = rig.kernel.synthLayer(0).arpSteps.map((step) => step.time)
    expect(times[times.length - 1] - times[times.length - 2]).toBe(SR / 5)

    // The knob steps through 1/2, 1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T.
    const labels = [0, 1.7, 3.4, 5, 6.7, 8.4, 10].map((knob) => clockDivision(knob).label)
    expect(labels).toEqual(['1/2', '1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T'])
    rig.set('synth-arp-rate', 10)
    expect(rig.text('synth-arp-rate')).toBe('Arp Rate 1/16T at 150 BPM')
    expect(rig.sound().synth.layers[0].arp.rate).toBeCloseTo((150 / 60) * 6, 9)
    rig.dispose()
  })

  it('the panel: Run, mode, Hold, KB Sync, direction, and range reach the kernel', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.press('synth-arp-run')
    expect(rig.sound().synth.layers[0].arp.run).toBe(true)
    expect(rig.led('synth-arp-run')).toBe('on')
    rig.shiftPress('synth-arp-run')
    expect(rig.sound().synth.layers[0].arp.kbSync).toBe(true)
    expect(rig.led('synth-kb-sync')).toBe('on')
    expect(rig.sound().synth.layers[0].arp.run).toBe(true)
    rig.press('synth-kb-hold')
    expect(rig.sound().synth.hold).toBe(true)
    expect(rig.led('synth-kb-hold')).toBe('on')
    const modes: number[] = []
    for (let presses = 0; presses < 3; presses += 1) {
      rig.press('synth-arp-mode')
      modes.push(rig.sound().synth.layers[0].arp.mode)
    }
    expect(modes).toEqual([ArpMode.Gate, ArpMode.Poly, ArpMode.Arp])
    // Direction lives on the Arpeggiator menu page, on the first dial.
    rig.press('synth-arp-menu')
    expect(rig.state().ui.synthPage).toBe('arp')
    rig.turn('synth-osc-dial-1', 2)
    expect(rig.sound().synth.layers[0].arp.direction).toBe(ArpDirection.UpDown)
    rig.turn('synth-osc-dial-1', 5)
    expect(rig.sound().synth.layers[0].arp.direction).toBe(ArpDirection.Random)
    rig.set('synth-arp-range', 7.5)
    expect(rig.sound().synth.layers[0].arp.range).toBe(4)
    expect(rig.sound().synth.layers[0].arp.hardness).toBeCloseTo(0.75)
    expect(rig.text('synth-arp-range')).toBe('Arp Range 4 oct')
    rig.dispose()
  })

  it('each Synth layer runs its own arpeggiator', () => {
    const kernel = synthKernel((layer, sound) => {
      layer.arp = { run: true, mode: ArpMode.Arp, rate: 8, range: 1, hardness: 1, direction: ArpDirection.Up, kbSync: true }
      sound.synth.layers[1] = structuredClone(layer)
      sound.synth.layers[1].arp = { ...layer.arp, rate: 2, direction: ArpDirection.Down }
      sound.synth.layers[2] = { ...structuredClone(layer), arp: { ...layer.arp, run: false } }
    })
    for (const note of CHORD) kernel.noteOn(note, 0.8)
    renderKernel(kernel, 1)
    expect(kernel.synthLayer(0).arpSteps.map((step) => step.notes[0])).toEqual([48, 52, 55, 48, 52, 55, 48, 52])
    expect(kernel.synthLayer(1).arpSteps.map((step) => step.notes[0])).toEqual([55, 52])
    expect(kernel.synthLayer(2).arpSteps).toHaveLength(0)
    expect(kernel.synthLayer(2).voiceCount).toBe(3)
  })
})
