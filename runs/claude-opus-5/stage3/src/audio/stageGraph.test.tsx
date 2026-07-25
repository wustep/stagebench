import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import App from '../App'
import { createRig } from '../test/harness'
import { engineRig, settingsWith } from '../test/engineRig'
import { LayerChain } from './layer'
import { peak, relativeDifference, rms } from './offline'
import { StageEngine } from './pianoEngine'
import type { EngineSettings } from './settings'

/**
 * One instrument, one AudioContext, one destination.
 *
 * Features: graph.single-context, graph.section-routing, graph.cleanup, program.panel-audio
 */

function everything(): EngineSettings {
  return settingsWith({
    organ: { sectionOn: true, layers: { a: { enabled: true } } },
    synth: { sectionOn: true, layers: { a: { enabled: true } } },
  })
}

describe('one audio graph for the whole instrument', () => {
  it('builds every section on the context it was handed and connects to the destination once', () => {
    const rig = engineRig({ settings: everything() })
    const connect = vi.spyOn(rig.graph.destination, 'connect')
    // Touching every section must not create a context or a second destination connection.
    rig.engine.noteOn('test', 60, 0.9)
    // Identity checks are compared as booleans: the graph objects are cyclic and enormous, and
    // handing them to `expect` directly makes the reporter try to serialise the whole instrument.
    expect(rig.engine.organ.chain instanceof LayerChain).toBe(true)
    expect(rig.engine.synth('a').chain instanceof LayerChain).toBe(true)
    expect(rig.engine.organ.output !== undefined).toBe(true)
    expect(connect).not.toHaveBeenCalled()
    expect(rig.engine.context === rig.graph).toBe(true)
  })

  it('gives the organ and each synth layer the documented six-unit chain', () => {
    const rig = engineRig({ settings: everything() })
    expect(LayerChain.ORDER).toEqual(['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'])
    for (const chain of [rig.engine.organ.chain, rig.engine.synth('a').chain, rig.engine.synth('b').chain]) {
      expect(chain.mod1 !== undefined).toBe(true)
      expect(chain.reverb !== undefined).toBe(true)
    }
    // Three synth layers really are three independent chains (synth spec).
    expect(rig.engine.synth('a').chain === rig.engine.synth('b').chain).toBe(false)
    expect(rig.engine.synth('b').chain === rig.engine.synth('c').chain).toBe(false)
  })

  it('sends the organ and the synth through the effect chain and the master path', () => {
    const dry = engineRig({ settings: everything() })
    dry.engine.noteOn('test', 60, 0.9)
    const plain = dry.graph.render(0.5)
    expect(peak(plain)).toBeGreaterThan(0)

    const wet = engineRig({
      settings: settingsWith(
        {
          organ: { chain: { reverb: { on: true, mix: 0.9 } } },
          synth: { layers: { a: { chain: { delay: { on: true, mix: 0.8 } } } } },
        },
        everything(),
      ),
    })
    wet.engine.noteOn('test', 60, 0.9)
    expect(relativeDifference(plain, wet.graph.render(0.5))).toBeGreaterThan(0.05)

    // Master Level is downstream of everything, including the two new sections.
    const silent = engineRig({ settings: settingsWith({ masterLevel: 0 }, everything()) })
    silent.engine.noteOn('test', 60, 0.9)
    expect(peak(silent.graph.render(0.5), 4000)).toBe(0)
  })

  it('switches each section off independently and silences only that section', () => {
    const organOnly = engineRig({
      settings: settingsWith({ synth: { sectionOn: false } }, everything()),
    })
    organOnly.engine.noteOn('test', 60, 0.9)
    const organAudio = organOnly.graph.render(0.4)

    const synthOnly = engineRig({
      settings: settingsWith({ organ: { sectionOn: false } }, everything()),
    })
    synthOnly.engine.noteOn('test', 60, 0.9)
    const synthAudio = synthOnly.graph.render(0.4)

    expect(rms(organAudio)).toBeGreaterThan(0)
    expect(rms(synthAudio)).toBeGreaterThan(0)
    expect(relativeDifference(organAudio, synthAudio)).toBeGreaterThan(0.3)

    const nothing = engineRig({
      settings: settingsWith(
        { sectionOn: false, organ: { sectionOn: false }, synth: { sectionOn: false } },
        everything(),
      ),
    })
    nothing.engine.noteOn('test', 60, 0.9)
    expect(peak(nothing.graph.render(0.4))).toBe(0)
  })

  it('reaps every voice and releases every node on dispose', () => {
    const rig = engineRig({ settings: everything() })
    const baseline = rig.graph.liveNodeCount
    for (let note = 0; note < 6; note += 1) rig.engine.noteOn(`n${note}`, 55 + note, 0.8)
    expect(rig.graph.liveNodeCount).toBeGreaterThan(baseline)
    rig.engine.allNotesOff()
    rig.scheduler.advance(5000)
    expect(rig.engine.activeVoiceCount).toBe(0)
    rig.engine.dispose()
    expect(rig.engine.activeVoiceCount).toBe(0)
    // A disposed engine ignores further settings, rather than rebuilding nodes behind our back.
    const after = rig.graph.liveNodeCount
    rig.engine.applySettings(everything())
    expect(rig.graph.liveNodeCount).toBe(after)
  })

  it('is still one engine class: the Phase 2 name is an alias, not a second engine', () => {
    const rig = engineRig()
    expect(rig.engine instanceof StageEngine).toBe(true)
  })
})

describe('the rendered panel drives the new sections', () => {
  it('makes the Organ section audible from the panel and moves a drawbar in the signal', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} store={null} />)
    const key = container.querySelector('#key-60')! as HTMLElement

    // Piano off, Organ on, straight from the panel.
    fireEvent.click(container.querySelector('[data-control-id="piano.section-on"]')!)
    fireEvent.click(container.querySelector('[data-control-id="organ.section-on"]')!)
    await waitFor(() =>
      expect(container.querySelector('[data-control-id="organ.section-on"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )

    fireEvent.pointerDown(key, { pointerId: 1, button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 })
    const before = rig.graph.render(0.4)
    expect(peak(before)).toBeGreaterThan(0)

    const drawbar = container.querySelector('[data-control-id="organ.drawbar.9"]')! as HTMLElement
    fireEvent.keyDown(drawbar, { key: 'Home' })
    await waitFor(() => expect(Number(drawbar.getAttribute('aria-valuenow'))).toBe(0))
    expect(relativeDifference(before, rig.graph.render(0.4))).toBeGreaterThan(0.02)
  })

  it('makes the Synth section audible from the panel and moves the filter in the signal', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} store={null} />)
    const key = container.querySelector('#key-60')! as HTMLElement

    fireEvent.click(container.querySelector('[data-control-id="piano.section-on"]')!)
    fireEvent.click(container.querySelector('[data-control-id="synth.section-on"]')!)
    await waitFor(() =>
      expect(container.querySelector('[data-control-id="synth.section-on"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )

    fireEvent.pointerDown(key, { pointerId: 2, button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 })
    const before = rig.graph.render(0.4)
    expect(peak(before)).toBeGreaterThan(0)

    const freq = container.querySelector('[data-control-id="synth.filter.freq"]')! as HTMLElement
    fireEvent.keyDown(freq, { key: 'Home' })
    await waitFor(() => expect(Number(freq.getAttribute('aria-valuenow'))).toBe(0))
    expect(relativeDifference(before, rig.graph.render(0.4))).toBeGreaterThan(0.05)
  })

  it('recalls a factory program from the panel and hears the difference', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} store={null} />)
    const key = container.querySelector('#key-60')! as HTMLElement
    fireEvent.pointerDown(key, { pointerId: 3, button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 })
    const piano = rig.graph.render(0.4)

    // Program 1.3 is the B3 factory program: press its Program button.
    fireEvent.click(container.querySelector('[data-control-id="program.slot.3"]')!)
    await waitFor(() =>
      expect(container.querySelector('[data-oled="program"]')?.textContent).toMatch(/B3 PERC FAST/i),
    )
    fireEvent.pointerUp(window, { pointerId: 3 })
    fireEvent.pointerDown(key, { pointerId: 4, button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 })
    expect(relativeDifference(piano, rig.graph.render(0.4))).toBeGreaterThan(0.2)
  })

  it('shows a truthful E indicator as soon as the panel differs from the stored program', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} store={null} />)
    const oled = container.querySelector('[data-program-line="headline"]')!
    expect(oled.textContent).toBe('1.1 GRAND PIANO')
    fireEvent.click(container.querySelector('[data-control-id="fx.reverb.on"]')!)
    await waitFor(() => expect(oled.textContent).toBe('1.1 GRAND PIANO E'))
  })
})
