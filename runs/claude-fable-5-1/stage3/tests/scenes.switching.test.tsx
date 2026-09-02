import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createFactoryBank } from '../src/state/factoryPrograms'
import { programOf, sceneEnables, scenesExplicit, serializeProgram, toggleScene } from '../src/state/programState'
import { click, el, mountApp, play, release, startAudio, turnDial, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('scenes.switching — Scene I/II toggles layer enable state without duplicating sound parameters', () => {
  it('toggleScene swaps the enable configurations and leaves every other parameter object untouched', () => {
    const p = mountedProgram()
    const p2 = toggleScene(p)
    expect(p2.scenes.active).toBe('II')
    expect(sceneEnables(p2)).toEqual(p.scenes.other)
    expect(p2.scenes.other).toEqual(sceneEnables(p))
    // sound parameters are shared: the drawbars, models, chains and split are the very same objects
    expect(p2.organ.layers.A.drawbars).toBe(p.organ.layers.A.drawbars)
    expect(p2.effects).toBe(p.effects)
    expect(p2.split).toBe(p.split)
    expect(toggleScene(p2)).toMatchObject({ scenes: p.scenes, organ: { on: p.organ.on } })
  })

  it('LAYER SCENE II switches program 2.4 from piano to piano + B3 and back, its LED shows the active scene, and the engine follows', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const procs = await startAudio(mounted)
    turnDial('program.dial', 11) // 2.4 Scene Piano/B3
    expect(state.get().name).toBe('Scene Piano/B3')
    expect(state.get().scenes.active).toBe('I')
    expect(state.get().organ.on).toBe(false)
    expect(state.get().piano.on).toBe(true)
    expect(el('program.layer-scene').getAttribute('aria-pressed')).toBe('false')
    play(mounted, 60)
    expect(procs.organ.heldNotes('A')).toEqual([])
    release(mounted, 60)
    click('program.layer-scene')
    expect(state.get().scenes.active).toBe('II')
    expect(state.get().organ.on).toBe(true)
    expect(state.get().organ.layers.A.on).toBe(true)
    expect(state.get().piano.on).toBe(true)
    expect(el('program.layer-scene').getAttribute('aria-pressed')).toBe('true')
    expect(el('organ.on').getAttribute('aria-pressed')).toBe('true')
    expect((procs.organ.params as { on: boolean }).on).toBe(true)
    play(mounted, 60)
    expect(procs.organ.heldNotes('A')).toEqual([60])
    expect(mounted.services.engine.activeVoices().filter((v) => !v.releasing).map((v) => v.layer)).toEqual(['A'])
    release(mounted, 60)
    // an organ edit made in scene II is the shared sound: scene I → II keeps it
    fireEvent.keyDown(el('organ.drawbar.1'), { key: 'End' })
    click('program.layer-scene')
    expect(state.get().scenes.active).toBe('I')
    expect(state.get().organ.on).toBe(false)
    expect(state.get().organ.layers.A.drawbars[8]).toBe(8)
    click('program.layer-scene')
    expect(state.get().organ.on).toBe(true)
    expect(state.get().organ.layers.A.drawbars[8]).toBe(8)
    expect(el('program.oled').textContent).toMatch(/Scene II/)
  })

  it('each scene is configured by turning sections and layers on or off while it is active; both are stored explicitly with the program', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    // scene I: piano A only (factory 1.1); scene II: add synth + organ B
    click('program.layer-scene')
    click('synth.on')
    click('organ.on')
    click('organ.layer-b.on')
    const explicit = scenesExplicit(programOf(state.get()))
    expect(explicit.I.sections).toEqual({ organ: false, piano: true, synth: false })
    expect(explicit.II.sections).toEqual({ organ: true, piano: true, synth: true })
    expect(explicit.II.layers.organB).toBe(true)
    expect(explicit.I.layers.organB).toBe(false)
    click('program.store')
    click('program.store')
    click('program.button.2')
    click('program.button.1')
    expect(state.get().scenes.active).toBe('II')
    expect(state.get().synth.on).toBe(true)
    click('program.layer-scene')
    expect(state.get().synth.on).toBe(false)
    expect(state.get().organ.on).toBe(false)
    expect(JSON.parse(serializeProgram(state.get().bank.programs[0])).scenes).toMatchObject({ active: 'II', I: explicit.I, II: explicit.II })
  })
})

function mountedProgram() {
  return createFactoryBank(false).programs[11]
}
