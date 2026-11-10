import { describe, expect, it } from 'vitest'
import { PROGRAM_STORAGE_KEY } from '../src/programs/bank'
import { extractProgram, sceneEnables, type ProgramData } from '../src/state/model'
import { StageStore } from '../src/state/store'
import { mountApp } from './support/app'
import { FakeStorage } from './support/fakes'
import { down, kernelOf, led, oled, press, render, start, up } from './support/panel'
import { makeRig } from './support/rig'
import { rms } from './support/signal'

/**
 * Feature: scenes.switching
 * Scene I/II toggles layer enable state without duplicating sound parameters.
 */

/** A program with its enable switches and the scene block taken out: everything a scene must not hold. */
function sound(program: ProgramData): string {
  const copy = structuredClone(program) as unknown as Record<string, Record<string, unknown>>
  delete (copy as Record<string, unknown>).scene
  for (const section of ['organ', 'piano', 'synth']) {
    delete copy[section].on
    // Focus follows whichever layer is on, so it is not a sound parameter either.
    delete copy[section].focus
    for (const layer of copy[section].layers as Array<Record<string, unknown>>) delete layer.on
  }
  delete (copy.fx as Record<string, unknown>).focus
  return JSON.stringify(copy)
}

describe('scenes.switching: two sets of on/off switches', () => {
  it('Layer Scene II starts as a copy of Scene I, and the button and its LED switch between them', () => {
    const rig = makeRig()
    expect(rig.state().scene.active).toBe(0)
    expect(rig.led('layer-scene')).toBe('off')
    expect(rig.state().scene.other).toEqual(sceneEnables(rig.state()))
    rig.press('layer-scene')
    expect(rig.state().scene.active).toBe(1)
    expect(rig.led('layer-scene')).toBe('on')
    expect(rig.state().notice).toBe('Layer Scene II')
    expect(sceneEnables(rig.state())).toEqual(rig.state().scene.other)
    rig.press('layer-scene')
    expect(rig.state().scene.active).toBe(0)
    expect(rig.led('layer-scene')).toBe('off')
    rig.dispose()
  })

  it('each scene keeps its own section and layer switches', () => {
    const rig = makeRig()
    // Scene I: piano A alone (the start-up state). Scene II: organ A+B and synth A, piano off.
    rig.press('layer-scene')
    rig.press('piano-on')
    rig.press('organ-on')
    rig.press('organ-layer-b')
    rig.press('synth-on')
    const second = sceneEnables(rig.state())
    expect(second).toEqual({
      organ: { on: true, layers: [true, true] },
      piano: { on: false, layers: [true, false] },
      synth: { on: true, layers: [true, false, false] },
    })
    rig.press('layer-scene')
    expect(sceneEnables(rig.state())).toEqual({
      organ: { on: false, layers: [true, false] },
      piano: { on: true, layers: [true, false] },
      synth: { on: false, layers: [true, false, false] },
    })
    expect(rig.state().scene.other).toEqual(second)
    // The panel follows: section LEDs, layer LEDs.
    expect([rig.led('organ-on'), rig.led('piano-on'), rig.led('synth-on')]).toEqual(['off', 'on', 'off'])
    expect(rig.led('organ-layer-b')).toBe('off')
    rig.press('layer-scene')
    expect([rig.led('organ-on'), rig.led('piano-on'), rig.led('synth-on')]).toEqual(['on', 'off', 'on'])
    expect(rig.led('organ-layer-b')).not.toBe('off')
    expect(sceneEnables(rig.state())).toEqual(second)
    rig.dispose()
  })

  it('what sounds follows the scene', () => {
    const rig = makeRig()
    rig.press('layer-scene')
    rig.press('piano-on')
    rig.press('organ-on')
    const play = () => {
      rig.down(60)
      const counts = [rig.kernel.layerVoiceCount(0), rig.kernel.organLayer(0).keyCount]
      const level = rms(rig.render(0.3).left)
      rig.up(60)
      rig.kernel.allNotesOff()
      rig.render(0.3)
      return { counts: counts.map((count) => (count > 0 ? 1 : 0)), level }
    }
    expect(play().counts).toEqual([0, 1])
    rig.press('layer-scene')
    const first = play()
    expect(first.counts).toEqual([1, 0])
    expect(first.level).toBeGreaterThan(0.005)
    rig.dispose()
  })

  it('switching scenes while keys are held lets go of the layers that turn off, and only those', () => {
    const rig = makeRig()
    rig.press('layer-scene') // Scene II, so far the same as Scene I: the piano
    rig.press('organ-on') // Scene II: piano + organ
    rig.down(55)
    expect([rig.kernel.layerVoiceCount(0) > 0, rig.kernel.organLayer(0).keyCount]).toEqual([true, 1])
    rig.press('layer-scene') // Scene I: organ off
    expect(rig.kernel.organLayer(0).keyCount).toBe(0)
    expect(rig.kernel.describeVoices().some((voice) => voice.key === 55 && voice.state === 1)).toBe(true)
    rig.dispose()
  })
})

describe('scenes.switching: sound parameters are shared, not duplicated', () => {
  it('a scene holds nothing but switches', () => {
    const rig = makeRig()
    const scene = rig.state().scene
    expect(Object.keys(scene).sort()).toEqual(['active', 'other'])
    expect(Object.keys(scene.other).sort()).toEqual(['organ', 'piano', 'synth'])
    for (const section of Object.values(scene.other)) {
      expect(Object.keys(section).sort()).toEqual(['layers', 'on'])
      expect(typeof section.on).toBe('boolean')
      for (const layer of section.layers) expect(typeof layer).toBe('boolean')
    }
    // 1 + 2 + 1 + 2 + 1 + 3 switches, and nothing else, however elaborate the program.
    expect(JSON.stringify(scene.other).length).toBeLessThan(200)
    rig.dispose()
  })

  it('an edit made in one scene is the same edit in the other: there is one set of parameters', () => {
    const rig = makeRig()
    rig.press('organ-on')
    rig.press('synth-on')
    rig.press('layer-scene')
    // Edit sounds, levels, effects, the split, and a morph while on Scene II.
    rig.set('organ-drawbar-3', 2)
    rig.press('organ-model')
    rig.set('piano-layer-a-level', 55)
    rig.press('piano-type')
    rig.set('synth-filter-freq', 8.2)
    rig.turn('synth-osc-dial-1', 4)
    rig.press('fx-reverb-on')
    rig.set('fx-reverb-mix', 3.3)
    rig.press('split')
    rig.stage.setBpm(141)
    const edited = sound(extractProgram(rig.state()))
    rig.press('layer-scene')
    expect(sound(extractProgram(rig.state()))).toBe(edited)
    expect(rig.state().organ.layers[0].drawbars[2]).toBe(2)
    expect(rig.state().piano.layers[0].level).toBe(55)
    expect(rig.value('synth-filter-freq')).toBe(8.2)
    // And an edit on Scene I shows on Scene II.
    rig.set('organ-drawbar-3', 7)
    rig.press('layer-scene')
    expect(rig.state().organ.layers[0].drawbars[2]).toBe(7)
    rig.dispose()
  })

  it('toggling there and back changes nothing at all', () => {
    const rig = makeRig()
    rig.stage.load({ live: false, slot: 14 }) // "Two Scenes"
    const before = JSON.stringify(extractProgram(rig.state()))
    rig.press('layer-scene')
    expect(JSON.stringify(extractProgram(rig.state()))).not.toBe(before)
    rig.press('layer-scene')
    expect(JSON.stringify(extractProgram(rig.state()))).toBe(before)
    expect(rig.state().nav.dirty).toBe(false)
    rig.dispose()
  })

  it('both scenes, and which one is active, are stored with the program', () => {
    const storage = new FakeStorage()
    const rig = makeRig(storage)
    rig.press('layer-scene')
    rig.press('piano-on')
    rig.press('synth-on')
    rig.press('synth-layer-c')
    rig.press('store')
    rig.turn('program-dial', 18)
    rig.press('store')
    const stored = JSON.parse(storage.data.get(PROGRAM_STORAGE_KEY)!).programs['18']
    expect(stored.scene.active).toBe(1)
    expect(stored.scene.other.piano.on).toBe(true)
    expect(stored.synth.layers[2].on).toBe(true)
    const reloaded = new StageStore({ storage })
    reloaded.load({ live: false, slot: 18 })
    expect(reloaded.getState().scene.active).toBe(1)
    expect(sceneEnables(reloaded.getState())).toEqual({
      organ: { on: false, layers: [true, false] },
      piano: { on: false, layers: [true, false] },
      synth: { on: true, layers: [true, false, true] },
    })
    reloaded.toggleScene()
    expect(sceneEnables(reloaded.getState()).piano.on).toBe(true)
    expect(sceneEnables(reloaded.getState()).synth.on).toBe(false)
    rig.dispose()
  })

  it('focus moves to a layer that is on, and the effect focus and display follow', () => {
    const rig = makeRig()
    rig.stage.load({ live: false, slot: 14 })
    expect(rig.state().ui.section).toBe('piano')
    rig.press('layer-scene')
    // Scene II of "Two Scenes": organ and synth on, piano off.
    expect([rig.state().organ.on, rig.state().piano.on, rig.state().synth.on]).toEqual([true, false, true])
    expect(rig.state().ui.section).not.toBe('piano')
    expect(rig.state()[rig.state().ui.section].on).toBe(true)
    expect(rig.led(`${rig.state().ui.section}-fx-focus`)).toBe('on')
    rig.dispose()
  })
})

describe('scenes.switching: on the instrument', () => {
  it('the factory "Two Scenes" program switches from a piano to an organ and pad at the press of a button', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'page-next')
    press(app, 'program-7')
    expect(app.control('program-oled').querySelector('[data-line="program-name"]')).toHaveTextContent('2.7 Two Scenes')
    expect(led(app, 'layer-scene')).toBe('off')
    const kernel = kernelOf(app)
    down(app, 60)
    render(app, 0.2)
    expect([kernel.layerVoiceCount(0) > 0, kernel.organLayer(0).keyCount, kernel.synthLayer(0).voiceCount]).toEqual([true, 0, 0])
    up(app, 60)
    press(app, 'layer-scene')
    expect(led(app, 'layer-scene')).toBe('on')
    expect(oled(app, 'notice')).toBe('> LAYER SCENE II')
    expect(app.control('piano-on')).toHaveAttribute('aria-pressed', 'false')
    expect(app.control('organ-on')).toHaveAttribute('aria-pressed', 'true')
    render(app, 1.5)
    down(app, 64)
    const out = render(app, 0.4)
    expect(rms(out.left)).toBeGreaterThan(0.003)
    expect([kernel.organLayer(0).keyCount, kernel.synthLayer(0).voiceCount]).toEqual([1, 1])
    expect(kernel.describeVoices().some((voice) => voice.key === 64)).toBe(false)
    // Switching is not an edit when it lands back where the program was stored.
    up(app, 64)
    press(app, 'layer-scene')
    expect(app.control('program-oled').querySelector('[data-line="edited"]')).toBeNull()
  })
})
