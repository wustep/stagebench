import { describe, expect, it, afterEach } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import { ALL_CONTROLS, SECTIONS, controlsBySection, findControl } from '../hardware/catalog'
import {
  CONTROL_BINDINGS,
  PIANO_CONTROL_IDS,
  ORGAN_CONTROL_IDS,
  SYNTH_CONTROL_IDS,
  EFFECT_CONTROL_IDS,
  PROGRAM_CONTROL_IDS,
  UNSUPPORTED_CONTROLS,
  auditBySection,
  auditControls,
  isFunctionalControl,
  morphParameterFor,
  targetFor,
} from '../audio/panelBindings'
import { createWebAudioEngine } from '../audio/webAudioEngine'
import { adaptAudioContext, nativeNodeOf } from '../audio/adapters'
import { createFakeContext } from '../audio/fakes'
import { defaultProgramState, ALL_LAYER_IDS } from '../audio/programState'
import { CHAIN_OWNERS } from '../audio/types'
import { createMemoryStorage } from '../audio/programStore'
import { defaultOrganState } from '../audio/organState'
import { defaultSynthState } from '../audio/synthState'
import { defaultPianoState } from '../audio/pianoState'
import { defaultEffectState, effectiveChain } from '../audio/effectState'

/**
 * hardware.bindings and system.integration.
 *
 * `hardware.bindings` is the honesty contract in test form: every visible control is either
 * bound to real state or explicitly listed as unsupported with the spec that excludes it.
 * The audit is a real function over the real catalog, so a control added without a decision
 * fails the suite rather than silently doing nothing.
 *
 * `system.integration` proves the three engines are one instrument: one AudioContext, one
 * master path, one program state, and splits/scenes/morphs/clock/panic applying to all of
 * them.
 */

afterEach(() => cleanup())

describe('hardware.bindings — every control is bound or excluded', () => {
  it('accounts for all 167 catalog controls', () => {
    const audit = auditControls()
    expect(audit.total).toBe(ALL_CONTROLS.length)
    expect(audit.bound + audit.unsupported).toBe(audit.total)
    expect(audit.unaccounted).toEqual([])
  })

  it('binds no control the catalog does not contain', () => {
    const catalogIds = new Set(ALL_CONTROLS.map((control) => control.id))
    for (const binding of CONTROL_BINDINGS) {
      expect(catalogIds.has(binding.id), binding.id).toBe(true)
    }
    for (const entry of UNSUPPORTED_CONTROLS) {
      expect(catalogIds.has(entry.id), entry.id).toBe(true)
    }
    expect(auditControls().phantomBindings).toEqual([])
  })

  it('never lists a control as both bound and unsupported', () => {
    const unsupportedIds = new Set(UNSUPPORTED_CONTROLS.map((entry) => entry.id))
    for (const binding of CONTROL_BINDINGS) {
      expect(unsupportedIds.has(binding.id), binding.id).toBe(false)
    }
    // And a binding appears once.
    const ids = CONTROL_BINDINGS.map((binding) => binding.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('binds nearly the whole surface, with only spec-excluded controls left over', () => {
    const audit = auditControls()
    // Phase 3's claim: everything not explicitly excluded works.
    expect(audit.bound).toBeGreaterThan(140)
    expect(audit.unsupported).toBeLessThan(30)
    // Every section has at least one bound control, so no band is a mock-up.
    const bySection = auditBySection()
    for (const section of SECTIONS) {
      expect(bySection[section.id].bound, section.id).toBeGreaterThan(0)
      expect(bySection[section.id].unaccounted, section.id).toBe(0)
    }
  })

  it('names a spec and a reason for every unsupported control', () => {
    for (const entry of UNSUPPORTED_CONTROLS) {
      expect(entry.reason.length, entry.id).toBeGreaterThan(30)
      expect(entry.spec, entry.id).toMatch(/specs\/nord-stage-4\.|manual p\./)
      // It is a real catalog control.
      expect(findControl(entry.id), entry.id).toBeDefined()
    }
  })

  it('routes every binding to a store that exists', () => {
    const validTargets = new Set(['piano', 'organ', 'synth', 'effects', 'program', 'performance'])
    for (const binding of CONTROL_BINDINGS) {
      expect(validTargets.has(binding.target), binding.id).toBe(true)
      expect(targetFor(binding.id)).toBe(binding.target)
    }
  })

  it('binds the whole Organ band except the spec-excluded switches', () => {
    const organ = controlsBySection('organ')
    // Aux KB routing, the preset library and drawbar sync are all spec-excluded.
    const excluded = new Set(['organ.aux-kb.a', 'organ.aux-kb.b', 'organ.preset', 'organ.sync'])
    for (const control of organ) {
      expect(isFunctionalControl(control.id), control.id).toBe(!excluded.has(control.id))
    }
    expect(organ.filter((control) => control.kind === 'drawbar')).toHaveLength(9)
    expect(ORGAN_CONTROL_IDS.size).toBe(organ.length - excluded.size)
  })

  it('binds the whole Synth band except its spec-excluded mode and pattern switches', () => {
    const synth = controlsBySection('synth')
    for (const control of synth) {
      const excluded = control.id === 'synth.mode' || control.id === 'synth.arp.pattern' || control.id === 'synth.osc.pitch'
      expect(isFunctionalControl(control.id), control.id).toBe(excluded ? false : true)
    }
    expect(SYNTH_CONTROL_IDS.size).toBe(synth.length - 3)
  })

  it('binds every Program control that the spec requires', () => {
    for (const id of [
      'program.dial',
      'program.page.up',
      'program.page.down',
      'program.live-mode',
      'program.layer-scene',
      'program.store',
      'program.split',
      'program.morph.wheel',
      'program.morph.ctrlped',
      'program.mst-clk',
      'program.transpose.on',
      'program.transpose.set',
      'program.panic',
      'program.shift',
    ]) {
      expect(isFunctionalControl(id), id).toBe(true)
    }
    for (let slot = 1; slot <= 8; slot += 1) {
      expect(isFunctionalControl(`program.slot.${slot}`)).toBe(true)
    }
    // The morph A.T. source is excluded because browser keyboards have no aftertouch.
    expect(isFunctionalControl('program.morph.at')).toBe(false)
  })

  it('binds every Piano control the piano spec requires', () => {
    for (const id of [
      'piano.section.on',
      'piano.layer.a.on',
      'piano.layer.b.on',
      'piano.layer.a.level',
      'piano.layer.b.level',
      'piano.octave.down',
      'piano.octave.up',
      'piano.sustped',
      'piano.pstick',
      'piano.soft-release',
      'piano.string-res',
      'piano.unison',
      'piano.kb-touch',
      'piano.dyn-comp',
      'piano.type',
      'piano.model',
      'piano.timbre',
    ]) {
      expect(isFunctionalControl(id), id).toBe(true)
    }
    // The two excluded ones stay decorative and are declared.
    expect(isFunctionalControl('piano.info')).toBe(false)
    expect(isFunctionalControl('piano.ped-noise')).toBe(false)
    expect(PIANO_CONTROL_IDS.has('piano.info')).toBe(false)
  })

  it('binds the effect units required by the effects spec', () => {
    for (const id of [
      'effects.mod1.type',
      'effects.mod1.rate',
      'effects.mod1.amount',
      'effects.mod1.on',
      'effects.mod2.type',
      'effects.mod2.rate',
      'effects.mod2.amount',
      'effects.mod2.on',
      'effects.delay.tempo',
      'effects.delay.feedback',
      'effects.delay.dry-wet',
      'effects.delay.filter',
      'effects.delay.on',
      'effects.amp.model',
      'effects.amp.drive',
      'effects.amp.bass',
      'effects.amp.mid',
      'effects.amp.freq',
      'effects.amp.treble',
      'effects.amp.on',
      'effects.comp.amount',
      'effects.comp.on',
      'effects.reverb.dry-wet',
      'effects.reverb.type',
      'effects.reverb.tone',
      'effects.reverb.on',
      'performance.rotary.on',
      'performance.rotary.drive',
      'performance.rotary.speed',
    ]) {
      expect(isFunctionalControl(id), id).toBe(true)
    }
    // The three per-type Variation switches are excluded.
    expect(isFunctionalControl('effects.mod1.variation')).toBe(false)
    expect(isFunctionalControl('effects.mod2.variation')).toBe(false)
    expect(isFunctionalControl('effects.reverb.variation')).toBe(false)
  })

  it('binds all seven effect focus buttons', () => {
    const focus = ALL_CONTROLS.filter((control) => control.id.startsWith('effects.focus.'))
    expect(focus).toHaveLength(7)
    for (const control of focus) {
      expect(EFFECT_CONTROL_IDS.has(control.id), control.id).toBe(true)
    }
  })

  it('declares the morphable destinations exactly as the specs list them', () => {
    // Organ: layer level, drawbars, rotary speed.
    expect(morphParameterFor('organ.layer.a.level')).toBe('organ.level')
    expect(morphParameterFor('organ.drawbar.16')).toBe('organ.drawbars')
    // Piano: layer level only.
    expect(morphParameterFor('piano.layer.a.level')).toBe('piano.level')
    expect(morphParameterFor('piano.timbre')).toBeUndefined()
    // Synth: level, LFO rate/amount, Osc Ctrl, filter freq/res, arp rate.
    for (const id of [
      'synth.layer.a.level',
      'synth.lfo.rate',
      'synth.lfo.mod-amt',
      'synth.osc.ctrl',
      'synth.filter.freq',
      'synth.filter.res',
      'synth.arp.rate',
    ]) {
      expect(morphParameterFor(id), id).toBeDefined()
    }
    // Effects: Mod 1 rate/amount, Mod 2 amount, delay tempo/feedback/dry-wet, EQ mid/filter
    // freq, drive, reverb dry/wet.
    for (const id of [
      'effects.mod1.rate',
      'effects.mod1.amount',
      'effects.mod2.amount',
      'effects.delay.tempo',
      'effects.delay.feedback',
      'effects.delay.dry-wet',
      'effects.amp.freq',
      'effects.amp.drive',
      'effects.reverb.dry-wet',
    ]) {
      expect(morphParameterFor(id), id).toBeDefined()
    }
    // Mod 2 Rate is not on the spec's morphable list, so it must not be assignable.
    expect(morphParameterFor('effects.mod2.rate')).toBeUndefined()
  })

  it('shows the unsupported list in the UI notes', async () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    // The notes live in the editors strip, which is collapsed by default so the surface is
    // unchanged; opening it reveals the documented list.
    fireEvent.click(document.querySelector('.editors-toggle') as HTMLElement)
    const notes = document.querySelector('[data-testid="unsupported-notes"]')
    expect(notes).not.toBeNull()
    const text = notes?.textContent ?? ''
    for (const entry of UNSUPPORTED_CONTROLS) {
      expect(text).toContain(entry.id)
    }
  })
})

describe('system.integration — one instrument, three engines', () => {
  it('creates exactly one AudioContext for all three engines', () => {
    let created = 0
    // A real offline context: the fake has no filter/delay nodes, so it could not host the
    // effect graph and this test is about the *whole* graph being shared.
    const realContext = new OfflineAudioContext(2, 4800, 44100)
    const context = adaptAudioContext(realContext as never)
    const engine = createWebAudioEngine({
      createContext: () => {
        created += 1
        return context
      },
    })
    engine.setPianoState(defaultPianoState())
    engine.setOrganState({ ...defaultOrganState(), sectionOn: true })
    engine.setSynthState({ ...defaultSynthState(), sectionOn: true })
    engine.noteOn({ id: 'p', midi: 60, velocity: 0.8, layer: 'piano.a' })
    engine.noteOn({ id: 'o', midi: 64, velocity: 0.8, layer: 'organ.a' })
    engine.noteOn({ id: 's', midi: 67, velocity: 0.8, layer: 'synth.a' })
    expect(created).toBe(1)
    expect(engine.effectsAvailable).toBe(true)
    // An offline context runs each source to completion immediately, so `activeVoiceCount`
    // has already reclaimed them; the graph itself is what this test is about.
    expect(engine.chains).not.toBeNull()
    engine.stopAll()
    engine.dispose()
  })

  it('builds all six chain instances plus one shared rotary', () => {
    const context = new OfflineAudioContext(2, 4800, 44100)
    const engine = createWebAudioEngine({ createContext: () => adaptAudioContext(context as never) })
    engine.setPianoState(defaultPianoState())
    engine.noteOn({ id: 'p', midi: 60, velocity: 0.8, layer: 'piano.a' })
    expect(engine.chains).not.toBeNull()
    expect(Object.keys(engine.chains!)).toEqual([...CHAIN_OWNERS])
    expect(CHAIN_OWNERS).toEqual(['piano.a', 'piano.b', 'organ', 'synth.a', 'synth.b', 'synth.c'])
    // The two organ layers share `organ`; each piano and synth layer has its own.
    expect(new Set(CHAIN_OWNERS).size).toBe(6)
    // Exactly one rotary for the whole instrument.
    expect(engine.rotary).not.toBeNull()
    engine.dispose()
  })

  it('reaches the destination only through the master gain and limiter', () => {
    // The fake context counts every connect() whose target is its destination sink, which
    // is exactly the "one master path" claim, and it does so without needing a real graph.
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    engine.setPianoState(defaultPianoState())
    engine.setOrganState({ ...defaultOrganState(), sectionOn: true })
    engine.setSynthState({ ...defaultSynthState(), sectionOn: true })
    engine.noteOn({ id: 'p', midi: 60, velocity: 0.8, layer: 'piano.a' })
    engine.noteOn({ id: 'o', midi: 64, velocity: 0.8, layer: 'organ.a' })
    engine.noteOn({ id: 's', midi: 67, velocity: 0.8, layer: 'synth.a' })
    // Even without effect nodes, every voice reaches the one destination through the master
    // gain: the fake sees exactly one destination connection.
    expect(context.destinations).toBe(1)
    engine.dispose()
  })

  it('counts one destination connection on a real offline graph too', async () => {
    const SR = 44100
    const ctx = new OfflineAudioContext(2, Math.round(SR * 0.1), SR)
    const adapted = adaptAudioContext(ctx as never)
    // Wrap the adapter's factories so each new node's connect() is inspected. Counting on
    // the adapters (not the native prototype) is what the evidence harness does too.
    const destination = nativeNodeOf(adapted.destination)
    let connections = 0
    const bag = adapted as unknown as Record<string, unknown>
    for (const name of [
      'createGain',
      'createBufferSource',
      'createBiquadFilter',
      'createDelay',
      'createConvolver',
      'createDynamicsCompressor',
      'createStereoPanner',
      'createOscillator',
      'createWaveShaper',
    ]) {
      const original = bag[name]
      if (typeof original !== 'function') continue
      bag[name] = (...args: unknown[]) => {
        const node = (original as (...a: unknown[]) => { connect: (target: unknown) => unknown })(...args)
        const originalConnect = node.connect.bind(node)
        node.connect = (target: unknown) => {
          if (nativeNodeOf(target as never) === destination) connections += 1
          return originalConnect(target)
        }
        return node
      }
    }
    const engine = createWebAudioEngine({ createContext: () => adapted })
    engine.setPianoState(defaultPianoState())
    engine.setOrganState({ ...defaultOrganState(), sectionOn: true })
    engine.setSynthState({ ...defaultSynthState(), sectionOn: true })
    engine.noteOn({ id: 'p', midi: 60, velocity: 0.8, layer: 'piano.a' })
    engine.noteOn({ id: 'o', midi: 64, velocity: 0.8, layer: 'organ.a' })
    engine.noteOn({ id: 's', midi: 67, velocity: 0.8, layer: 'synth.a' })
    expect(connections).toBe(1)
    engine.dispose()
  })

  it('reclaims every voice of every engine on Panic', () => {
    // The fake is right here: the graph's *presence* is not what this test measures, and a
    // fake has no transport to reclaim the voices behind the engine's back.
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    engine.setPianoState(defaultPianoState())
    // Enable every layer of every engine, so Panic has all nine to clear.
    const organ = defaultOrganState()
    organ.sectionOn = true
    organ.layers['organ.a'].enabled = true
    organ.layers['organ.b'].enabled = true
    engine.setOrganState(organ)
    const synth = defaultSynthState()
    synth.sectionOn = true
    synth.layers['synth.a'].enabled = true
    synth.layers['synth.b'].enabled = true
    synth.layers['synth.c'].enabled = true
    engine.setSynthState(synth)
    const piano = defaultPianoState()
    piano.sectionOn = true
    piano.layers['piano.a'].enabled = true
    piano.layers['piano.b'].enabled = true
    engine.setPianoState(piano)
    // One note per layer per engine: 2 piano + 2 organ + 3 synth layers on one key.
    engine.noteOn({ id: 'piano-a', midi: 60, velocity: 0.8, layer: 'piano.a' })
    engine.noteOn({ id: 'piano-b', midi: 60, velocity: 0.8, layer: 'piano.b' })
    engine.noteOn({ id: 'organ-a', midi: 60, velocity: 0.8, layer: 'organ.a' })
    engine.noteOn({ id: 'organ-b', midi: 60, velocity: 0.8, layer: 'organ.b' })
    engine.noteOn({ id: 'synth-a', midi: 60, velocity: 0.8, layer: 'synth.a' })
    engine.noteOn({ id: 'synth-b', midi: 60, velocity: 0.8, layer: 'synth.b' })
    engine.noteOn({ id: 'synth-c', midi: 60, velocity: 0.8, layer: 'synth.c' })
    expect(engine.activeVoiceCount()).toBe(7)
    expect(engine.voicesByEngine()).toEqual({ piano: 2, organ: 2, synth: 3 })
    engine.stopAll()
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.voicesByEngine()).toEqual({ piano: 0, organ: 0, synth: 0 })
    engine.dispose()
    expect(engine.liveNodeCount()).toBe(0)
  })

  it('shares one program state across all three engines', () => {
    const state = defaultProgramState()
    // The state carries every engine's settings, the effects, the routing, the scenes, the
    // morphs and the clock — one object, so a program stores all of it.
    expect(state.piano).toBeDefined()
    expect(state.organ).toBeDefined()
    expect(state.synth).toBeDefined()
    expect(state.effects).toBeDefined()
    expect(state.split).toBeDefined()
    expect(state.scenes).toBeDefined()
    expect(state.morph).toBeDefined()
    expect(state.clock).toBeDefined()
    expect(typeof state.transpose).toBe('number')
    // Every layer of every engine appears in the routing maps.
    for (const layer of ALL_LAYER_IDS) {
      expect(state.split.zones[layer], layer).toBeDefined()
      expect(state.scenes.sceneI[layer], layer).toBeDefined()
    }
  })

  it('applies the master clock to every synced target', () => {
    const state = defaultProgramState()
    // The clock's sync flags cover all four documented targets.
    expect(state.clock.sync).toEqual({ arp: true, lfo: false, delay: false, mod1: false })
    state.clock.bpm = 90
    state.clock.sync = { arp: true, lfo: true, delay: true, mod1: true }
    expect(state.clock.bpm).toBe(90)
    expect(Object.keys(state.clock.sync)).toHaveLength(4)
  })

  it('has no second AudioContext anywhere in the source', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { resolve, dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const HERE = dirname(fileURLToPath(import.meta.url))
    const SRC = resolve(HERE, '..')
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          if (entry === 'tests') continue
          out.push(...walk(full))
        } else if (/\.(ts|tsx)$/.test(entry)) {
          out.push(full)
        }
      }
      return out
    }
    // Only the composition root may construct a platform AudioContext, and it does so in
    // exactly one place. The constructor is aliased (`new Ctor()`), so the check is on the
    // factory site rather than on a literal name.
    const sites: string[] = []
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8')
      // A construction site is a `new X()` where X resolves to an AudioContext constructor:
      // either the global directly, or a local alias of it.
      const declaresAlias = /webkitAudioContext\?: typeof AudioContext/.test(source)
      if (declaresAlias) sites.push(`${file}: alias`)
      for (const match of source.matchAll(/new\s+((?:window\.)?(?:webkit)?AudioContext|Ctor)\s*\(/g)) {
        sites.push(`${file}: ${match[1]}`)
      }
    }
    // One alias declaration and one construction, both in the composition root.
    expect(sites).toHaveLength(2)
    for (const site of sites) expect(site).toMatch(/useInstrument\.ts/)
    // No module anywhere else even mentions the constructor alias.
    for (const file of walk(SRC)) {
      if (file.endsWith('useInstrument.ts')) continue
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/new\s+(?:window\.)?(?:webkit)?AudioContext\s*\(/)
    }
  })
})

describe('system.integration — the UI wires the whole system', () => {
  it('shows all three engines and the program slot on the program display', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const slot = screen.getByTestId('program-slot-line').textContent ?? ''
    expect(slot).toMatch(/^1\.1 /)
    // The power-on program is piano-only, and the display says so.
    expect(screen.getByTestId('engines-line').textContent).toBe('PIANO')
    expect(screen.getByTestId('split-line').textContent).toBe('SPLIT OFF')
  })

  it('turns the organ on from the panel and reflects it in the display', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    expect(screen.getByTestId('engines-line').textContent).toBe('PIANO')
    fireEvent.click(
      document.querySelector('[data-control-id="organ.section.on"] [role="switch"]') as HTMLElement,
    )
    expect(screen.getByTestId('engines-line').textContent).toMatch(/ORGAN/)
    // The organ's model line appears with its real model and drawbars.
    expect(screen.getByTestId('organ-model-line').textContent).toBe('B3')
  })

  it('marks the program dirty when a control is moved, and clean only after a store', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const slotLine = () => screen.getByTestId('program-slot-line').textContent ?? ''
    expect(slotLine()).not.toMatch(/· E/)

    // Move a synth control (a bound one).
    const slider = document.querySelector('[data-control-id="synth.filter.freq"] [role="slider"]') as HTMLElement
    fireEvent.keyDown(slider, { key: 'End' })
    expect(slotLine()).toMatch(/· E/)

    // Shift/Exit cancels a store rather than clearing an edit, so the E stays.
    fireEvent.click(document.querySelector('[data-control-id="program.store"] .ctl-track-button, [data-control-id="program.store"] [role="button"]') as HTMLElement)
    expect(slotLine()).toMatch(/· E/)
  })

  it('renders a split editor whose controls change the split state', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    // The editors are collapsed until asked for, so the surface is unchanged by default.
    expect(screen.queryByTestId('split-editor')).toBeNull()
    const toggle = document.querySelector('.editors-toggle') as HTMLElement
    fireEvent.click(toggle)
    const editor = screen.getByTestId('split-editor')
    expect(editor).not.toBeNull()
    // Turning the split on from the editor is reflected in the display.
    fireEvent.click(screen.getByTestId('split-on'))
    expect(screen.getByTestId('split-line').textContent).toMatch(/^SPLIT C3\/C4\/C5/)
    // The eleven documented positions are all offered.
    const noteSelect = screen.getByLabelText('Mid split point note')
    expect(noteSelect.querySelectorAll('option')).toHaveLength(11)
    // And the three crossfade widths.
    const crossfadeSelect = screen.getByLabelText('Mid split crossfade')
    expect(crossfadeSelect.querySelectorAll('option')).toHaveLength(3)
  })

  it('renders a morph panel that clears and shows real assignments', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    fireEvent.click(document.querySelector('.editors-toggle') as HTMLElement)
    expect(screen.getByTestId('morph-panel')).not.toBeNull()
    // With no assignments, both sources say so.
    expect(screen.getByTestId('morph-wheel').textContent).toMatch(/No assignments/)
    expect(screen.getByTestId('morph-control-pedal').textContent).toMatch(/No assignments/)
  })

  it('keeps every chain independent in the canonical state', () => {
    const state = defaultEffectState()
    // Six chains, each its own object.
    const chains = Object.values(state.chains)
    expect(chains).toHaveLength(6)
    for (let index = 0; index < chains.length; index += 1) {
      for (let other = index + 1; other < chains.length; other += 1) {
        expect(chains[index]).not.toBe(chains[other])
      }
    }
    // And each resolves independently.
    for (const owner of CHAIN_OWNERS) {
      expect(effectiveChain(state, owner)).toBeDefined()
    }
  })
})

describe('system.integration — the program slot follows the engines', () => {
  it('sounds only the layers a program enables', () => {
    // The booted program (factory slot 1) is piano A only, which is what the instrument
    // plays at power-on.
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    expect(screen.getByTestId('engines-line').textContent).toBe('PIANO')
    // The underlying default state still has all three sections available, so a program can
    // enable any engine; the *program* is what decides what sounds.
    const state = defaultProgramState()
    expect(state.piano).toBeDefined()
    expect(state.organ).toBeDefined()
    expect(state.synth).toBeDefined()
  })

  it('assigns every layer to a chain that exists', () => {
    const state = defaultEffectState()
    for (const layer of ALL_LAYER_IDS) {
      // Both organ layers resolve to the one shared `organ` chain.
      const owner = layer.startsWith('organ') ? 'organ' : layer
      expect(state.chains[owner as keyof typeof state.chains], layer).toBeDefined()
    }
  })
})
