import { describe, expect, it } from 'vitest'
import { zoneGain, type SplitPointSound } from '../src/audio/dsp/params'
import { programDisplay } from '../src/state/display'
import { SPLIT_POSITIONS, XFADE_WIDTHS, zoneChoices, zoneLeds } from '../src/state/model'
import { noteLabel } from '../src/state/store'
import { mountApp } from './support/app'
import { db } from './support/fxbench'
import { down, kernelOf, keys, oled, press, shiftPress, start } from './support/panel'
import { makeRig, noteHz, slice } from './support/rig'
import { magnitudeAt, mono, rms } from './support/signal'

/**
 * Feature: splits.zones
 * Editable split points at the 11 documented positions, up to 4 zones, note routing,
 * Off/±6/±12 crossfade gains.
 */

const point = (note: number, xfade = 0, on = true): SplitPointSound => ({ on, note, xfade })
const OFF = point(60, 0, false)

/** A rig with organ (sine-like 8 foot) and synth (sine) on beside the piano, for telling layers apart by ear. */
function threeSections() {
  const rig = makeRig()
  rig.press('organ-on')
  rig.press('synth-on')
  rig.stage.setOrganLayer(0, (layer) => {
    layer.drawbars = [0, 0, 8, 0, 0, 0, 0, 0, 0]
    layer.vibOn = false
  })
  rig.stage.setSynthLayer(0, (layer) => {
    layer.wave = 0
    layer.filter.on = false
    layer.voice.unison = 0
    layer.oscEnv.amount = 0
    layer.ampEnv.velocity = 0
  })
  return rig
}
/** Which engines sound for a key: [piano voices, organ keys, synth voices]. */
function sounding(rig: ReturnType<typeof makeRig>, note: number): number[] {
  rig.down(note)
  const counts = [rig.kernel.layerVoiceCount(0), rig.kernel.organLayer(0).keyCount, rig.kernel.synthLayer(0).voiceCount]
  rig.up(note)
  rig.kernel.allNotesOff()
  rig.render(0.3)
  return counts.map((count) => (count > 0 ? 1 : 0))
}

describe('splits.zones: split points', () => {
  it('there are 11 positions, every C and F from C2 to C7, and three crossfade widths', () => {
    expect(SPLIT_POSITIONS.map(noteLabel)).toEqual(['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'])
    expect([...XFADE_WIDTHS]).toEqual([0, 6, 12])
  })

  it('Split On gives one split, Mid at C4, and lights its LEDs', () => {
    const rig = makeRig()
    expect(rig.sound().keyboard.points.map((each) => each.on)).toEqual([false, false, false])
    rig.press('split')
    expect(rig.sound().keyboard.points).toEqual([point(48, 0, false), point(60), point(72, 0, false)])
    expect(rig.led('split')).toBe('on')
    expect([rig.led('split-low'), rig.led('split-high')]).toEqual(['off', 'off'])
    expect(rig.state().notice).toBe('Split On: Mid C4')
    rig.press('split')
    expect(rig.sound().keyboard.points.map((each) => each.on)).toEqual([false, false, false])
    expect(rig.led('split')).toBe('off')
    rig.dispose()
  })

  it('the Keyboard Split page moves each point over all 11 positions and switches it off', () => {
    const rig = makeRig()
    rig.press('split')
    rig.shiftPress('split')
    expect(rig.state().ui.mode).toBe('split')
    // Program 3 selects Mid; the dial walks it down to C2, through Off, and up to C7.
    rig.press('program-3')
    rig.turn('program-dial', -20)
    expect(rig.state().split.points[1].on).toBe(false)
    const visited: number[] = []
    for (let detent = 0; detent < 12; detent += 1) {
      rig.turn('program-dial', 1)
      visited.push(rig.state().split.points[1].note)
    }
    expect(visited.slice(0, 11)).toEqual([...SPLIT_POSITIONS])
    expect(visited[11]).toBe(96)
    expect(rig.sound().keyboard.points[1]).toEqual(point(96))
    // Selecting the selected point again switches it off, and on again.
    rig.press('program-3')
    expect(rig.state().split.points[1].on).toBe(false)
    rig.press('program-3')
    expect(rig.state().split.points[1].on).toBe(true)
    rig.dispose()
  })

  it('pressing and holding Split opens the Keyboard Split page; a short press only switches the split', () => {
    const rig = makeRig()
    // Held for 0.8 s: the hold function, and the split is not toggled.
    rig.hardware.press('split')
    rig.clock.now += 800
    rig.hardware.release('split', true)
    expect(rig.state().ui.mode).toBe('split')
    expect(rig.state().split.on).toBe(false)
    rig.exit()
    // A quick press toggles and opens nothing.
    rig.hardware.press('split')
    rig.clock.now += 120
    rig.hardware.release('split', true)
    expect(rig.state().ui.mode).toBe('play')
    expect(rig.state().split.on).toBe(true)
    // A hold that slides off the button is neither.
    rig.hardware.press('split')
    rig.clock.now += 900
    rig.hardware.release('split', false)
    expect(rig.state().ui.mode).toBe('play')
    expect(rig.state().split.on).toBe(true)
    rig.dispose()
  })

  it('three points make four zones, and they stay in order', () => {
    const rig = makeRig()
    rig.press('split')
    rig.shiftPress('split')
    rig.press('program-2') // Low
    rig.turn('program-dial', 3) // Off -> C2 -> F2 -> C3
    rig.press('program-4') // High
    rig.turn('program-dial', 4) // Off -> F4 -> C5 -> F5 -> C6: only positions above Mid are offered
    expect(rig.sound().keyboard.points).toEqual([point(48), point(60), point(84)])
    expect([rig.led('split-low'), rig.led('split'), rig.led('split-high')]).toEqual(['on', 'on', 'on'])
    expect(zoneChoices(rig.state())).toHaveLength(10)
    // Low cannot be pushed up to or past Mid.
    rig.press('program-2')
    rig.turn('program-dial', 5)
    expect(rig.state().split.points[0].note).toBe(53)
    expect(rig.state().notice).toBe('Low must stay below Mid (C4)')
    // High cannot come down to Mid: below F4 the dial goes straight to Off, and back up to F4.
    rig.press('program-4')
    rig.turn('program-dial', -3)
    expect(rig.state().split.points[2]).toMatchObject({ on: true, note: 65 })
    rig.turn('program-dial', -1)
    expect(rig.state().split.points[2].on).toBe(false)
    rig.turn('program-dial', 1)
    expect(rig.state().split.points[2]).toMatchObject({ on: true, note: 65 })
    // The store refuses an out-of-order point however it is asked.
    rig.stage.setSplitPoint(2, { note: 48 })
    expect(rig.state().split.points[2].note).toBe(65)
    expect(rig.state().notice).toBe('High must stay above Mid (C4)')
    rig.dispose()
  })

  it('the xFade row sets Off, ±6, or ±12 for each point', () => {
    const rig = makeRig()
    rig.press('split')
    rig.shiftPress('split')
    rig.press('program-1')
    expect(rig.state().ui.split.row).toBe('xfade')
    rig.press('program-3')
    rig.turn('program-dial', 1)
    expect(rig.sound().keyboard.points[1].xfade).toBe(6)
    rig.turn('program-dial', 5)
    expect(rig.sound().keyboard.points[1].xfade).toBe(12)
    rig.turn('program-dial', -1)
    expect(rig.sound().keyboard.points[1].xfade).toBe(6)
    // On the xFade row, selecting a point never switches it off.
    rig.press('program-3')
    expect(rig.state().split.points[1].on).toBe(true)
    const view = programDisplay(rig.state(), rig.stage.bank)
    expect(view.header).toBe('KEYBOARD SPLIT')
    expect(view.rows[0]).toContain('[±6]')
    expect(view.rows[1]).toContain('C4')
    rig.dispose()
  })
})

describe('splits.zones: zone assignment', () => {
  it('KB Zone (Shift + Octave Shift) steps a layer through the zones the split offers', () => {
    const rig = makeRig()
    // No split: nothing to assign.
    rig.shiftPress('piano-octave-up')
    expect(rig.state().notice).toBe('KB Zone: turn Split on first')
    rig.press('split')
    const seen: string[] = []
    for (let presses = 0; presses < 3; presses += 1) {
      rig.shiftPress('piano-octave-up')
      seen.push(rig.sound().layers[0].zone.join('-'))
    }
    // One split: lower half, upper half, then everywhere again.
    expect(seen).toEqual(['0-1', '2-3', '0-3'])
    rig.shiftPress('piano-octave-down')
    expect(rig.sound().layers[0].zone).toEqual([2, 3])
    expect(rig.state().notice).toBe('Layer A KB Zone 3-4')
    // The octave itself did not move.
    expect(rig.sound().layers[0].octave).toBe(0)
    rig.dispose()
  })

  it('the four KB Zone LEDs of each section show the focused layer\'s zones', () => {
    const rig = makeRig()
    const leds = (section: string) => [1, 2, 3, 4].map((zone) => rig.led(`${section}-kb-zone-${zone}`))
    expect(leds('piano')).toEqual(['on', 'on', 'on', 'on'])
    rig.press('split')
    rig.shiftPress('piano-octave-up')
    expect(leds('piano')).toEqual(['on', 'on', 'off', 'off'])
    rig.press('synth-on')
    rig.shiftPress('synth-octave-down')
    expect(leds('synth')).toEqual(['off', 'off', 'on', 'on'])
    expect(leds('organ')).toEqual(['on', 'on', 'on', 'on'])
    // Each layer has its own assignment.
    rig.press('piano-layer-b')
    expect(leds('piano')).toEqual(['on', 'on', 'on', 'on'])
    rig.press('piano-layer-a')
    expect(leds('piano')).toEqual(['on', 'on', 'off', 'off'])
    expect(zoneLeds(rig.state(), [0, 1])).toEqual([true, true, false, false])
    rig.dispose()
  })

  it('with three points any layer can take any contiguous run of the four zones', () => {
    const rig = makeRig()
    rig.stage.edit((state) => {
      state.split.on = true
      state.split.points = [
        { on: true, note: 48, xfade: 0 },
        { on: true, note: 60, xfade: 0 },
        { on: true, note: 72, xfade: 0 },
      ]
    })
    const seen = new Set<string>()
    for (let presses = 0; presses < 10; presses += 1) {
      rig.shiftPress('piano-octave-up')
      seen.add(rig.sound().layers[0].zone.join('-'))
    }
    expect([...seen].sort()).toEqual(['0-0', '0-1', '0-2', '0-3', '1-1', '1-2', '1-3', '2-2', '2-3', '3-3'])
    rig.dispose()
  })
})

describe('splits.zones: notes go where the zones say', () => {
  it('one split: the lower layer below C4, the upper layer from C4 up', () => {
    const rig = threeSections()
    rig.press('split')
    rig.press('piano-layer-a')
    rig.shiftPress('piano-octave-up') // piano: lower
    rig.shiftPress('synth-octave-down') // synth: upper
    // Organ stays on every zone.
    expect(sounding(rig, 59)).toEqual([1, 1, 0])
    expect(sounding(rig, 60)).toEqual([0, 1, 1])
    expect(sounding(rig, 40)).toEqual([1, 1, 0])
    expect(sounding(rig, 90)).toEqual([0, 1, 1])
    // Split off: every layer plays everywhere again, without losing its assignment.
    rig.press('split')
    expect(sounding(rig, 40)).toEqual([1, 1, 1])
    rig.press('split')
    expect(sounding(rig, 40)).toEqual([1, 1, 0])
    rig.dispose()
  })

  it('moving the split point moves the boundary, audibly', () => {
    const rig = threeSections()
    rig.press('piano-on') // organ and synth only
    rig.press('split')
    rig.shiftPress('organ-octave-up') // organ lower
    rig.shiftPress('synth-octave-down') // synth upper
    const heard = () => {
      rig.down(62)
      const out = slice(mono(rig.render(0.4)), 0.1, 0.4)
      rig.up(62)
      rig.kernel.allNotesOff()
      rig.render(0.3)
      return out
    }
    // D4 is above a split at C4: the synth's pure sine, no organ.
    expect(rig.kernel.organLayer(0).keyCount).toBe(0)
    const above = heard()
    expect(magnitudeAt(above, noteHz(62))).toBeGreaterThan(0.02)
    // Move Mid up to F4: D4 is now below it and plays the organ instead.
    rig.stage.setSplitPoint(1, { note: 65 })
    rig.down(62)
    expect([rig.kernel.organLayer(0).keyCount, rig.kernel.synthLayer(0).voiceCount]).toEqual([1, 0])
    rig.up(62)
    rig.stage.setSplitPoint(1, { note: 53 })
    rig.down(55)
    expect([rig.kernel.organLayer(0).keyCount, rig.kernel.synthLayer(0).voiceCount]).toEqual([0, 1])
    rig.dispose()
  })

  it('four zones route four ways', () => {
    const rig = threeSections()
    rig.press('piano-layer-b')
    rig.stage.edit((state) => {
      state.split.on = true
      state.split.points = [
        { on: true, note: 48, xfade: 0 },
        { on: true, note: 60, xfade: 0 },
        { on: true, note: 72, xfade: 0 },
      ]
      state.organ.layers[0].zone = [0, 0]
      state.piano.layers[0].zone = [1, 1]
      state.piano.layers[1].zone = [2, 2]
      state.synth.layers[0].zone = [3, 3]
    })
    const who = (note: number) => {
      rig.down(note)
      const counts = [rig.kernel.organLayer(0).keyCount, rig.kernel.layerVoiceCount(0), rig.kernel.layerVoiceCount(1), rig.kernel.synthLayer(0).voiceCount].map((count) => (count > 0 ? 1 : 0))
      rig.up(note)
      rig.kernel.allNotesOff()
      rig.render(0.3)
      return counts.join('')
    }
    expect([40, 47, 48, 59, 60, 71, 72, 90].map(who)).toEqual(['1000', '1000', '0100', '0100', '0010', '0010', '0001', '0001'])
    rig.dispose()
  })

  it('zones are decided on the key pressed; transpose and octave shift move the pitch, not the zone', () => {
    const rig = threeSections()
    rig.press('piano-on')
    rig.press('split')
    rig.shiftPress('organ-octave-up')
    rig.shiftPress('synth-octave-down')
    rig.stage.setTranspose(6)
    rig.down(58)
    // A#3 is below C4 and stays with the organ, although it now sounds as E4.
    expect([rig.kernel.organLayer(0).keyCount, rig.kernel.synthLayer(0).voiceCount]).toEqual([1, 0])
    const out = slice(mono(rig.render(0.4)), 0.1, 0.4)
    expect(magnitudeAt(out, noteHz(64))).toBeGreaterThan(magnitudeAt(out, noteHz(58)) * 10)
    rig.dispose()
  })
})

describe('splits.zones: crossfades', () => {
  it('Off switches at the split point; ±6 and ±12 fade across that many semitones on each side', () => {
    const lower = (xfade: number, key: number) => zoneGain([OFF, point(60, xfade), OFF], [0, 1], key)
    const upper = (xfade: number, key: number) => zoneGain([OFF, point(60, xfade), OFF], [2, 3], key)
    expect([58, 59, 60, 61].map((key) => lower(0, key))).toEqual([1, 1, 0, 0])
    expect([58, 59, 60, 61].map((key) => upper(0, key))).toEqual([0, 0, 1, 1])
    for (const width of [6, 12]) {
      // The lower sound reaches `width` notes above the point and is gone after that…
      expect(lower(width, 60 - width)).toBe(1)
      expect(lower(width, 60)).toBeCloseTo(0.5)
      expect(lower(width, 60 + width - 1)).toBeGreaterThan(0)
      expect(lower(width, 60 + width)).toBe(0)
      // …and the upper sound reaches the same distance below it.
      expect(upper(width, 60 + width)).toBe(1)
      expect(upper(width, 60 - width + 1)).toBeGreaterThan(0)
      expect(upper(width, 60 - width)).toBe(0)
      // The two always add up to one, and each changes steadily across the fade.
      for (let key = 60 - width; key <= 60 + width; key += 1) {
        expect(lower(width, key) + upper(width, key)).toBeCloseTo(1)
        if (key > 60 - width) expect(lower(width, key)).toBeLessThan(lower(width, key - 1))
      }
    }
    // A layer on every zone is never faded, and a middle zone is bounded on both sides.
    expect(zoneGain([point(48, 6), point(60, 6), point(72, 6)], [0, 3], 60)).toBe(1)
    expect([44, 48, 54, 60, 66].map((key) => zoneGain([point(48, 6), point(60, 6), OFF], [1, 1], key))).toEqual([expect.closeTo(1 / 6), 0.5, 1, 0.5, 0])
  })

  it('the fade is in the audio: the lower layer gets quieter key by key across the split', () => {
    const level = (xfade: number, key: number) => {
      const rig = threeSections()
      rig.press('piano-on')
      rig.press('synth-on')
      rig.press('split')
      rig.shiftPress('organ-octave-up')
      rig.stage.setSplitPoint(1, { xfade })
      rig.down(key)
      const out = rms(slice(mono(rig.render(0.4)), 0.1, 0.4))
      rig.dispose()
      return out
    }
    // No crossfade: full level just below the point, silence at it.
    expect(level(0, 59)).toBeGreaterThan(0.01)
    expect(level(0, 60)).toBe(0)
    // ±6: half level (-6 dB) at the point, still sounding 5 above, gone 6 above.
    const full = level(6, 54)
    expect(db(level(6, 60) / full)).toBeGreaterThan(-8)
    expect(db(level(6, 60) / full)).toBeLessThan(-4)
    expect(level(6, 65)).toBeGreaterThan(0)
    expect(level(6, 65)).toBeLessThan(level(6, 60) * 0.5)
    expect(level(6, 66)).toBe(0)
    // ±12 reaches twice as far.
    expect(level(12, 66)).toBeGreaterThan(0.001)
    expect(level(12, 72)).toBe(0)
  })

  it('a crossfaded piano note keeps its timbre: only its level is scaled', () => {
    const play = (xfade: number) => {
      const rig = makeRig()
      rig.press('split')
      rig.shiftPress('piano-octave-up')
      rig.stage.setSplitPoint(1, { xfade })
      rig.down(60, 0.9)
      const out = mono(rig.render(0.3))
      rig.dispose()
      return out
    }
    const faded = play(12)
    const reference = (() => {
      const rig = makeRig()
      rig.down(60, 0.9)
      const out = mono(rig.render(0.3))
      rig.dispose()
      return out
    })()
    // Exactly half the level of the unsplit note, sample for sample: same strike, same voice.
    let worst = 0
    for (let i = 0; i < faded.length; i += 1) worst = Math.max(worst, Math.abs(faded[i] - reference[i] * 0.5))
    expect(rms(faded)).toBeGreaterThan(0.001)
    expect(worst).toBeLessThan(rms(reference) * 0.02)
  })
})

describe('splits.zones: on the instrument', () => {
  it('the split-point LEDs above the keys show the active positions, and the display shows the split page', async () => {
    const app = mountApp()
    await start(app)
    const lit = () => [...app.container.querySelectorAll('[data-split-led][data-lit="true"]')].map((element) => element.getAttribute('data-split-led'))
    expect(lit()).toEqual([])
    expect(app.container.querySelectorAll('[data-split-led]')).toHaveLength(11)
    press(app, 'split')
    expect(lit()).toEqual(['60'])
    expect(oled(app, 'notice')).toBe('> SPLIT ON: MID C4')
    shiftPress(app, 'split')
    const display = app.control('program-oled')
    expect(display).toHaveAttribute('data-mode', 'split')
    expect(display.querySelector('[data-line="program-name"]')).toHaveTextContent('KEYBOARD SPLIT')
    expect(display.textContent).toContain('[C4]')
    // High point: off, then four detents up to C6 (only positions above Mid are offered).
    press(app, 'program-4')
    keys(app, 'program-dial', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp')
    expect(lit()).toEqual(['60', '84'])
    expect(app.control('led-split-high')).toHaveAttribute('data-mode', 'on')
    expect(app.control('program-oled').textContent).toContain('[C6]')
    shiftPress(app, 'store')
  })

  it('assigning zones from the panel routes keys in the running app', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'synth-on')
    press(app, 'split')
    shiftPress(app, 'synth-octave-down') // synth: upper zones
    press(app, 'piano-layer-a')
    shiftPress(app, 'piano-octave-up') // piano: lower zones
    const kernel = kernelOf(app)
    down(app, 50)
    expect([kernel.layerVoiceCount(0) > 0, kernel.synthLayer(0).voiceCount > 0]).toEqual([true, false])
    down(app, 70)
    expect(kernel.synthLayer(0).voiceCount).toBe(1)
    expect(kernel.getState().keyboard.points[1]).toEqual({ on: true, note: 60, xfade: 0 })
    expect(app.control('led-piano-kb-zone-3')).toHaveAttribute('data-mode', 'off')
    expect(app.control('led-synth-kb-zone-3')).toHaveAttribute('data-mode', 'on')
  })
})
