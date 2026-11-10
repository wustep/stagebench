import { describe, expect, it } from 'vitest'
import {
  FilterType,
  LfoDest,
  LfoWave,
  NotePriority,
  SynthWave,
  VibratoMode,
  VoiceMode,
  clockDivision,
  type SynthLayerSound,
} from '../src/audio/dsp/params'
import { SYNTH_MAX_VOICES } from '../src/audio/dsp/synth'
import { LFO_DESTS, LFO_WAVES, VIBRATO_MODES, VOICE_MODES } from '../src/synth/catalog'
import { crossingRate, makeRig, noteHz, renderKernel, retune, slice, synthKernel } from './support/rig'
import { brightness, equal, magnitudeAt, mono, rms } from './support/signal'
import { correlation, difference } from './support/stage'

/**
 * Feature: synth.voice-modes
 * Poly/mono/legato, priority, glide, unison, vibrato, and LFO behavior.
 */

const sine = (layer: SynthLayerSound) => {
  layer.osc.wave = SynthWave.Sine
}
const playing = (kernel: ReturnType<typeof synthKernel>) =>
  kernel
    .synthLayer(0)
    .describe()
    .filter((voice) => !voice.released)
    .map((voice) => voice.note)

describe('synth.voice-modes: poly, mono, legato', () => {
  it('Poly: every key gets its own voice, up to the limit, with the oldest stolen first', () => {
    const kernel = synthKernel(sine)
    for (const note of [48, 52, 55]) kernel.noteOn(note, 0.8)
    expect(playing(kernel)).toEqual([48, 52, 55])
    kernel.noteOff(52)
    expect(playing(kernel)).toEqual([48, 55])
    for (let note = 60; note < 60 + SYNTH_MAX_VOICES; note += 1) kernel.noteOn(note, 0.8)
    expect(kernel.synthLayer(0).voiceCount).toBe(SYNTH_MAX_VOICES)
    // The two oldest held notes were the ones taken.
    expect(playing(kernel)).not.toContain(48)
    expect(playing(kernel)).toContain(60 + SYNTH_MAX_VOICES - 1)
    expect(VOICE_MODES).toEqual(['Poly', 'Mono', 'Legato'])
  })

  it('Mono and Legato: one voice, however many keys are down; releasing falls back to a held key', () => {
    for (const mode of [VoiceMode.Mono, VoiceMode.Legato]) {
      const kernel = synthKernel((layer) => {
        sine(layer)
        layer.voice.mode = mode
      })
      kernel.noteOn(48, 0.8)
      kernel.noteOn(55, 0.8)
      kernel.noteOn(60, 0.8)
      expect(kernel.synthLayer(0).voiceCount).toBe(1)
      expect(playing(kernel)).toEqual([60])
      kernel.noteOff(60)
      expect(playing(kernel)).toEqual([55])
      kernel.noteOff(48)
      expect(playing(kernel)).toEqual([55])
      kernel.noteOff(55)
      expect(playing(kernel)).toEqual([])
      renderKernel(kernel, 0.4)
      expect(kernel.voiceCount).toBe(0)
    }
  })

  it('Mono restarts the envelopes on a legato note; Legato lets them run on', () => {
    // A filter envelope makes a retrigger audible: the note gets its bright attack again.
    const second = (mode: number) => {
      const kernel = synthKernel((layer) => {
        layer.osc.wave = SynthWave.Saw
        layer.voice.mode = mode
        layer.filter = { on: true, type: FilterType.LP24, freq: 0.3, res: 0.1, envAmt: 0.8, track: 0, drive: 0 }
        layer.filterEnv = { attack: 0.001, decay: 0.15, release: 0.1, sustain: false, velocity: false }
      })
      kernel.noteOn(45, 0.8)
      renderKernel(kernel, 0.8)
      kernel.noteOn(47, 0.8)
      return brightness(slice(mono(renderKernel(kernel, 0.2)), 0.005, 0.05))
    }
    expect(second(VoiceMode.Mono)).toBeGreaterThan(second(VoiceMode.Legato) * 4)
  })

  it('note priority: last note, Low, or High decides which held key the voice plays', () => {
    const choose = (priority: number, order: number[]) => {
      const kernel = synthKernel((layer) => {
        sine(layer)
        layer.voice.mode = VoiceMode.Mono
        layer.voice.priority = priority
      })
      for (const note of order) kernel.noteOn(note, 0.8)
      return playing(kernel)[0]
    }
    expect(choose(NotePriority.Last, [60, 48, 55])).toBe(55)
    expect(choose(NotePriority.Low, [60, 48, 55])).toBe(48)
    expect(choose(NotePriority.High, [60, 48, 55])).toBe(60)
    // And it is what is heard.
    const kernel = synthKernel((layer) => {
      sine(layer)
      layer.voice.mode = VoiceMode.Mono
      layer.voice.priority = NotePriority.Low
    })
    kernel.noteOn(69, 0.8)
    kernel.noteOn(57, 0.8)
    kernel.noteOn(64, 0.8)
    const out = slice(mono(renderKernel(kernel, 0.4)), 0.1, 0.4)
    expect(magnitudeAt(out, 220)).toBeGreaterThan(magnitudeAt(out, 440) * 20)
    expect(magnitudeAt(out, 220)).toBeGreaterThan(magnitudeAt(out, noteHz(64)) * 20)
  })
})

describe('synth.voice-modes: glide', () => {
  const glide = (amount: number, mode: number, legato: boolean) => {
    const kernel = synthKernel((layer) => {
      sine(layer)
      layer.voice.mode = mode
      layer.voice.glide = amount
    })
    kernel.noteOn(45, 0.8)
    renderKernel(kernel, 0.3)
    if (!legato) {
      kernel.noteOff(45)
      renderKernel(kernel, 0.3)
    }
    kernel.noteOn(57, 0.8)
    return { kernel, out: mono(renderKernel(kernel, 1.5)) }
  }

  it('slides the pitch from the last note at a constant rate', () => {
    const { kernel, out } = glide(0.7, VoiceMode.Legato, true)
    // An octave up from 110 Hz: on the way the pitch is in between, at the end it has arrived.
    const early = crossingRate(slice(out, 0.02, 0.1))
    expect(early).toBeGreaterThan(112)
    expect(early).toBeLessThan(200)
    expect(crossingRate(slice(out, 1.2, 1.5))).toBeCloseTo(220, -1)
    expect(kernel.synthLayer(0).describe()[0].pitch).toBe(57)
    // Constant rate: twice the distance takes twice as long.
    const time = (interval: number) => {
      const k = synthKernel((layer) => {
        sine(layer)
        layer.voice.mode = VoiceMode.Legato
        layer.voice.glide = 0.6
      })
      k.noteOn(48, 0.8)
      renderKernel(k, 0.1)
      k.noteOn(48 + interval, 0.8)
      let blocks = 0
      while (k.synthLayer(0).describe()[0].pitch !== 48 + interval && blocks < 4000) {
        renderKernel(k, 128 / 48000)
        blocks += 1
      }
      return blocks
    }
    expect(time(12) / time(6)).toBeGreaterThan(1.8)
    expect(time(12) / time(6)).toBeLessThan(2.2)
  })

  it('more Glide is slower; zero is no glide at all', () => {
    const settled = (amount: number) => crossingRate(slice(glide(amount, VoiceMode.Legato, true).out, 0.02, 0.1))
    // (An 80 ms window reads pitch to within about 12 Hz.)
    expect(Math.abs(settled(0) - 220)).toBeLessThan(15)
    expect(settled(0.4)).toBeGreaterThan(settled(0.8) + 10)
  })

  it('Legato glides only when notes overlap; Mono glides from the previous note either way', () => {
    const detachedLegato = crossingRate(slice(glide(0.7, VoiceMode.Legato, false).out, 0.02, 0.1))
    const detachedMono = crossingRate(slice(glide(0.7, VoiceMode.Mono, false).out, 0.02, 0.1))
    expect(Math.abs(detachedLegato - 220)).toBeLessThan(15)
    expect(detachedMono).toBeLessThan(200)
    // Poly never glides.
    const poly = synthKernel((layer) => {
      sine(layer)
      layer.voice.glide = 0.9
    })
    poly.noteOn(45, 0.8)
    poly.noteOn(57, 0.8)
    expect(poly.synthLayer(0).describe().map((voice) => voice.pitch)).toEqual([45, 57])
  })
})

describe('synth.voice-modes: unison', () => {
  const unison = (level: number) => {
    const kernel = synthKernel((layer) => {
      layer.osc.wave = SynthWave.Saw
      layer.voice.unison = level
    })
    kernel.noteOn(57, 0.8)
    return renderKernel(kernel, 1.2)
  }

  it('adds detuned oscillators without using more voices, wider at each level', () => {
    const width = (out: { left: Float32Array; right: Float32Array }) => 1 - correlation(slice(out.left, 0.1, 1.2), slice(out.right, 0.1, 1.2))
    const renders = [0, 1, 2, 3].map(unison)
    expect(equal(renders[0].left, renders[0].right)).toBe(true)
    const widths = renders.map(width)
    expect(widths[0]).toBeLessThan(1e-9)
    expect(widths[1]).toBeGreaterThan(0.01)
    expect(widths[2]).toBeGreaterThan(widths[1] * 1.5)
    expect(widths[3]).toBeGreaterThan(widths[2])
    for (let level = 1; level <= 3; level += 1) expect(difference(mono(renders[0]), mono(renders[level]))).toBeGreaterThan(0.2)
    const kernel = synthKernel((layer) => {
      layer.voice.unison = 3
    })
    kernel.noteOn(57, 0.8)
    expect(kernel.synthLayer(0).voiceCount).toBe(1)
  })
})

describe('synth.voice-modes: vibrato', () => {
  /** How far the pitch swings: spread of the zero-crossing rate over short windows. */
  const swing = (out: Float32Array, from: number, to: number) => {
    const rates: number[] = []
    for (let t = from; t + 0.04 <= to; t += 0.02) rates.push(crossingRate(slice(out, t, t + 0.04)))
    return Math.max(...rates) - Math.min(...rates)
  }
  const vibrato = (mode: number, wheel = 0, pedal = 0, amount = 1) => {
    const kernel = synthKernel((layer, sound) => {
      sine(layer)
      layer.voice.vibrato = mode
      layer.voice.vibAmount = amount
      layer.voice.vibRate = 6
      sound.synth.wheel = wheel
      sound.synth.pedal = pedal
    })
    kernel.noteOn(81, 0.8) // 880 Hz: fine pitch resolution in short windows
    return mono(renderKernel(kernel, 2))
  }

  it('On: the pitch wavers as soon as the note is played, by the menu Amount', () => {
    expect(VIBRATO_MODES).toEqual(['Off', 'On', 'Delay', 'Wheel', 'Pedal'])
    const off = swing(vibrato(VibratoMode.Off), 0.1, 1)
    const on = swing(vibrato(VibratoMode.On), 0.1, 1)
    expect(off).toBeLessThan(30)
    expect(on).toBeGreaterThan(off + 40)
    expect(swing(vibrato(VibratoMode.On, 0, 0, 0.3), 0.1, 1)).toBeLessThan(on * 0.7)
  })

  it('Wheel: the modulation wheel sets the depth, from none to full', () => {
    const none = swing(vibrato(VibratoMode.Wheel, 0), 0.1, 1)
    const half = swing(vibrato(VibratoMode.Wheel, 0.5), 0.1, 1)
    const full = swing(vibrato(VibratoMode.Wheel, 1), 0.1, 1)
    expect(none).toBeLessThan(30)
    expect(half).toBeGreaterThan(none + 20)
    expect(full).toBeGreaterThan(half + 20)
    // The control pedal does the same in Pedal mode, and the wheel does nothing there.
    expect(swing(vibrato(VibratoMode.Pedal, 1, 0), 0.1, 1)).toBeLessThan(30)
    expect(swing(vibrato(VibratoMode.Pedal, 0, 1), 0.1, 1)).toBeGreaterThan(none + 40)
  })

  it('Delay: the vibrato comes in a moment after the note starts', () => {
    const delayed = vibrato(VibratoMode.Delay)
    expect(swing(delayed, 0.05, 0.45)).toBeLessThan(30)
    expect(swing(delayed, 1.2, 2)).toBeGreaterThan(swing(delayed, 0.05, 0.45) + 40)
  })

  it('the Vibrato menu sets rate (2 to 8 Hz) and amount from the panel', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.press('synth-vibrato-menu')
    expect(rig.state().ui.synthPage).toBe('vibrato')
    rig.turn('synth-osc-dial-1', 30)
    expect(rig.sound().synth.layers[0].voice.vibRate).toBe(8)
    rig.turn('synth-osc-dial-1', -30)
    expect(rig.sound().synth.layers[0].voice.vibRate).toBe(2)
    rig.turn('synth-osc-dial-2', 4)
    expect(rig.sound().synth.layers[0].voice.vibAmount).toBeCloseTo(0.7)
    // The selector steps Off, On, Delay, Wheel, Pedal and skips the aftertouch position.
    const seen: number[] = []
    for (let presses = 0; presses < 5; presses += 1) {
      rig.press('synth-vibrato-mode')
      seen.push(rig.sound().synth.layers[0].voice.vibrato)
    }
    expect(seen).toEqual([VibratoMode.On, VibratoMode.Delay, VibratoMode.Wheel, VibratoMode.Pedal, VibratoMode.Off])
    rig.dispose()
  })
})

describe('synth.voice-modes: the LFO', () => {
  const lfo = (wave: number, dest: number, rate = 4, amount = 1) => {
    const kernel = synthKernel((layer) => {
      layer.osc.wave = SynthWave.Saw
      layer.filter = { on: true, type: FilterType.LP24, freq: 0.45, res: 0.1, envAmt: 0, track: 0, drive: 0 }
      layer.lfo = { wave, dest, rate, amount }
    })
    kernel.noteOn(57, 0.8)
    return mono(renderKernel(kernel, 2))
  }
  /** Brightness in successive 25 ms windows: the shape the LFO draws on the filter. */
  const trace = (out: Float32Array) => {
    const values: number[] = []
    for (let t = 0.05; t + 0.025 <= 2; t += 0.025) values.push(brightness(slice(out, t, t + 0.025)))
    return values
  }

  it('has five waveforms, each drawing a different shape', () => {
    expect(LFO_WAVES).toEqual(['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'])
    const renders = [LfoWave.Triangle, LfoWave.SawDown, LfoWave.SawUp, LfoWave.Square, LfoWave.SampleHold].map((wave) => lfo(wave, LfoDest.Filter))
    for (let a = 0; a < renders.length; a += 1) {
      for (let b = a + 1; b < renders.length; b += 1) expect(difference(renders[a], renders[b]), `${a} vs ${b}`).toBeGreaterThan(0.2)
    }
    // Saw down falls through each cycle and saw up rises: within a cycle they move in opposite directions.
    const down = trace(lfo(LfoWave.SawDown, LfoDest.Filter, 1))
    const up = trace(lfo(LfoWave.SawUp, LfoDest.Filter, 1))
    expect(down[2]).toBeGreaterThan(down[30])
    expect(up[2]).toBeLessThan(up[30])
    // A square has two levels and nothing in between.
    const square = trace(lfo(LfoWave.Square, LfoDest.Filter, 1, 0.4))
    // (Levels are read at the quartiles, so the one window that straddles each switch does not count.)
    const twoLevel = (values: number[]) => {
      const sorted = [...values].sort((x, y) => x - y)
      const low = sorted[Math.floor(sorted.length * 0.25)]
      const high = sorted[Math.floor(sorted.length * 0.75)]
      return values.filter((value) => Math.abs(Math.log2(value / low)) < 0.3 || Math.abs(Math.log2(value / high)) < 0.3).length / values.length
    }
    expect(twoLevel(square)).toBeGreaterThan(0.9)
    expect(twoLevel(trace(lfo(LfoWave.SawUp, LfoDest.Filter, 1, 0.4)))).toBeLessThan(twoLevel(square))
    // Sample & Hold steps to a new level each cycle and stays there.
    const hold = trace(lfo(LfoWave.SampleHold, LfoDest.Filter, 2))
    expect(new Set(hold.slice(2).map((value) => Math.round(Math.log2(value) * 2))).size).toBeGreaterThan(2)
  })

  it('has three destinations — pitch, Osc Ctrl, filter — and an off state that keeps its settings', () => {
    expect(LFO_DESTS).toEqual(['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'])
    const off = lfo(LfoWave.Triangle, LfoDest.Off)
    const still = lfo(LfoWave.Triangle, LfoDest.Off, 9, 0.2)
    // Off: rate and amount are kept but do nothing.
    expect(equal(off, still)).toBe(true)
    const pitch = lfo(LfoWave.Triangle, LfoDest.Pitch)
    const filter = lfo(LfoWave.Triangle, LfoDest.Filter)
    // To pitch: the note itself moves.
    const rates = [0.06, 0.19].map((at) => crossingRate(slice(pitch, at - 0.03, at + 0.03)))
    expect(Math.abs(rates[0] - rates[1])).toBeGreaterThan(40)
    // To filter: the pitch stays, the brightness moves.
    const bright = trace(filter)
    expect(Math.max(...bright) / Math.min(...bright)).toBeGreaterThan(10)
    expect(Math.max(...trace(off)) / Math.min(...trace(off))).toBeLessThan(1.5)
    // To Osc Ctrl on a Pure wave: nothing, because Pure has no Osc Ctrl; on FM it changes the timbre.
    expect(equal(lfo(LfoWave.Triangle, LfoDest.Ctrl), off)).toBe(true)
    const fm = (dest: number) => {
      const kernel = synthKernel((layer) => {
        layer.osc.wave = SynthWave.Fm2Op
        layer.osc.ctrl = 0.4
        layer.lfo = { wave: LfoWave.Triangle, dest, rate: 4, amount: 1 }
      })
      kernel.noteOn(57, 0.8)
      return mono(renderKernel(kernel, 1))
    }
    expect(difference(fm(LfoDest.Off), fm(LfoDest.Ctrl))).toBeGreaterThan(0.3)
  })

  it('Rate and Mod Amt set how fast and how far it moves', () => {
    const cycles = (rate: number) => {
      const values = trace(lfo(LfoWave.Square, LfoDest.Filter, rate))
      const middle = Math.sqrt(Math.max(...values) * Math.min(...values))
      let flips = 0
      for (let i = 1; i < values.length; i += 1) if (values[i - 1] > middle !== values[i] > middle) flips += 1
      return flips / 2 / 1.925
    }
    expect(cycles(2)).toBeGreaterThan(1.6)
    expect(cycles(2)).toBeLessThan(2.4)
    expect(cycles(4)).toBeGreaterThan(3.4)
    expect(cycles(4)).toBeLessThan(4.6)
    const depth = (amount: number) => {
      const values = trace(lfo(LfoWave.Triangle, LfoDest.Filter, 4, amount))
      return Math.max(...values) / Math.min(...values)
    }
    expect(depth(1)).toBeGreaterThan(depth(0.4) * 2)
    expect(depth(0.4)).toBeGreaterThan(depth(0.05) * 1.5)
  })

  it('locks to the Master Clock: the knob then picks a subdivision of the tempo', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.set('synth-lfo-rate', 5)
    const free = rig.sound().synth.layers[0].lfo.rate
    // Shift + turning the knob clockwise locks it; the knob's own position stays where it was.
    rig.shiftSet('synth-lfo-rate', 6)
    expect(rig.state().synth.layers[0].lfo.sync).toBe(true)
    expect(rig.state().synth.layers[0].lfo.rate).toBe(5)
    expect(rig.led('synth-lfo-mst-clk')).toBe('on')
    // Knob at 5 of 10 is the middle subdivision, 1/8: two cycles per beat at 120 BPM is 4 Hz.
    expect(clockDivision(5).label).toBe('1/8')
    expect(rig.sound().synth.layers[0].lfo.rate).toBeCloseTo(4, 9)
    expect(rig.sound().synth.layers[0].lfo.rate).not.toBeCloseTo(free, 3)
    rig.stage.setBpm(90)
    expect(rig.sound().synth.layers[0].lfo.rate).toBeCloseTo(3, 9)
    rig.set('synth-lfo-rate', 0)
    expect(rig.text('synth-lfo-rate')).toBe('LFO Rate 1/2 at 90 BPM')
    expect(rig.sound().synth.layers[0].lfo.rate).toBeCloseTo(0.75, 9)
    // Anticlockwise with Shift frees it again.
    rig.set('synth-lfo-rate', 5)
    rig.shiftSet('synth-lfo-rate', 4)
    expect(rig.state().synth.layers[0].lfo.sync).toBe(false)
    expect(rig.led('synth-lfo-mst-clk')).toBe('off')
    rig.dispose()
  })

  it('the panel steps the waveform and destination, and Voice mode, priority, unison, and glide', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.press('synth-lfo-waveform')
    expect(rig.state().ui.synthPage).toBe('lfo')
    expect(rig.sound().synth.layers[0].lfo.wave).toBe(LfoWave.Triangle)
    rig.press('synth-lfo-waveform')
    expect(rig.sound().synth.layers[0].lfo.wave).toBe(LfoWave.SawDown)
    const dests: number[] = []
    for (let presses = 0; presses < 4; presses += 1) {
      rig.press('synth-lfo-dest')
      dests.push(rig.sound().synth.layers[0].lfo.dest)
    }
    expect(dests).toEqual([LfoDest.Pitch, LfoDest.Ctrl, LfoDest.Filter, LfoDest.Off])
    rig.set('synth-lfo-amount', 2.5)
    expect(rig.sound().synth.layers[0].lfo.amount).toBeCloseTo(0.25)

    rig.press('synth-voice-mode')
    expect(rig.sound().synth.layers[0].voice.mode).toBe(VoiceMode.Mono)
    expect(rig.led('synth-voice-mode-mono')).toBe('on')
    rig.press('synth-voice-mode')
    expect(rig.sound().synth.layers[0].voice.mode).toBe(VoiceMode.Legato)
    rig.shiftPress('synth-voice-mode')
    expect(rig.sound().synth.layers[0].voice.priority).toBe(NotePriority.Low)
    expect([rig.led('synth-voice-lo'), rig.led('synth-voice-hi')]).toEqual(['on', 'off'])
    rig.shiftPress('synth-voice-mode')
    expect([rig.led('synth-voice-lo'), rig.led('synth-voice-hi')]).toEqual(['off', 'on'])
    rig.press('synth-unison')
    expect(rig.sound().synth.layers[0].voice.unison).toBe(3)
    rig.set('synth-glide', 2)
    expect(rig.sound().synth.layers[0].voice.glide).toBeCloseTo(0.2)
    rig.dispose()
  })

  it('changing voice mode while keys are held hands the notes over without leaving any stuck', () => {
    const kernel = synthKernel(sine)
    kernel.noteOn(48, 0.8)
    kernel.noteOn(55, 0.8)
    retune(kernel, (sound) => {
      sound.synth.layers[0].voice.mode = VoiceMode.Mono
    })
    expect(playing(kernel)).toEqual([55])
    kernel.noteOff(48)
    kernel.noteOff(55)
    renderKernel(kernel, 0.5)
    expect(kernel.voiceCount).toBe(0)
    expect(rms(renderKernel(kernel, 0.1).left)).toBe(0)
  })
})
