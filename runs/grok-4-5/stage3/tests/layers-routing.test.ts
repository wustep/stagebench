import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'
import type { FxLayerFocus } from '../src/model/piano-types'

async function makeEngine() {
  const { createContext } = createMockContextFactory()
  const engine = new PianoEngine({ useInlineSamples: true, createContext })
  await engine.init()
  return engine
}

describe('layers.routing', () => {
  describe('piano A/B', () => {
    it('enable gates independent layer voice ownership', async () => {
      const engine = await makeEngine()
      engine.setOrganState({ sectionOn: false })
      engine.setSynthState({ sectionOn: false })
      engine.setPianoState({
        sectionOn: true,
        layers: {
          A: { enabled: true, level: 0.9, octave: 0, sustped: true, pstick: false, zones: [true, true, true, true] },
          B: { enabled: false, level: 0, octave: 0, sustped: true, pstick: false, zones: [true, true, true, true] },
        },
      })
      engine.noteOn(60, 0.8)
      expect(engine.getLayerVoiceCount('A')).toBe(1)
      expect(engine.getLayerVoiceCount('B')).toBe(0)
      engine.allNotesOff()

      engine.updateLayer('A', { enabled: false })
      engine.updateLayer('B', { enabled: true, level: 0.8 })
      engine.noteOn(62, 0.8)
      expect(engine.getLayerVoiceCount('A')).toBe(0)
      expect(engine.getLayerVoiceCount('B')).toBe(1)
      engine.allNotesOff()

      engine.updateLayer('A', { enabled: true, level: 0.7 })
      engine.noteOn(64, 0.8)
      expect(engine.getLayerVoiceCount('A')).toBe(1)
      expect(engine.getLayerVoiceCount('B')).toBe(1)
      engine.dispose()
    })

    it('focus, level, octave, and effect-target route per layer', async () => {
      const engine = await makeEngine()
      engine.setPianoState({ focus: 'A' })
      engine.setEffectsState({ layerFocus: 'PianoA', focusSection: 'Piano' })
      expect(engine.getPianoState().focus).toBe('A')
      expect(engine.getEffectsState().layerFocus).toBe('PianoA')

      engine.setPianoState({ focus: 'B' })
      engine.setEffectsState({ layerFocus: 'PianoB', focusSection: 'Piano' })
      expect(engine.getPianoState().focus).toBe('B')
      expect(engine.getEffectsState().layerFocus).toBe('PianoB')
      expect(engine.getEffectsState().focusSection).toBe('Piano')

      engine.updateLayer('A', { level: 0.42, octave: -1, enabled: true })
      engine.updateLayer('B', { level: 0.77, octave: 1, enabled: true })
      expect(engine.getPianoState().layers.A.level).toBeCloseTo(0.42)
      expect(engine.getPianoState().layers.B.level).toBeCloseTo(0.77)
      expect(engine.getPianoState().layers.A.octave).toBe(-1)
      expect(engine.getPianoState().layers.B.octave).toBe(1)

      engine.setOrganState({ sectionOn: false })
      engine.setSynthState({ sectionOn: false })
      engine.updateLayer('B', { enabled: false })
      engine.noteOn(60, 0.9)
      const notesA = engine.getActiveNotes()
      expect(notesA.some((n) => n.midi === 48 && n.layer === 'A')).toBe(true) // 60 - 12
      engine.allNotesOff()

      engine.updateLayer('A', { enabled: false })
      engine.updateLayer('B', { enabled: true })
      engine.noteOn(60, 0.9)
      const notesB = engine.getActiveNotes()
      expect(notesB.some((n) => n.midi === 72 && n.layer === 'B')).toBe(true) // 60 + 12
      engine.allNotesOff()

      // effect chains exist per piano layer target
      engine.updateChain('PianoA', (c) => ({ ...c, reverb: { ...c.reverb, on: true, mix: 0.55 } }))
      engine.updateChain('PianoB', (c) => ({ ...c, delay: { ...c.delay, on: true, mix: 0.4 } }))
      expect(engine.getEffectsState().chains.PianoA.reverb.on).toBe(true)
      expect(engine.getEffectsState().chains.PianoB.delay.on).toBe(true)
      engine.dispose()
    })
  })

  describe('organ A/B', () => {
    it('enable gates independent layer voice ownership', async () => {
      const engine = await makeEngine()
      engine.setPianoState({ sectionOn: false })
      engine.setSynthState({ sectionOn: false })
      engine.setOrganState({ sectionOn: true })
      engine.updateOrganLayer('A', { enabled: true, level: 0.9 })
      engine.updateOrganLayer('B', { enabled: false, level: 0 })
      engine.noteOn(60, 0.8)
      expect(engine.getOrganVoiceCount()).toBe(1)
      engine.allNotesOff()
      expect(engine.getOrganVoiceCount()).toBe(0)

      engine.updateOrganLayer('A', { enabled: false })
      engine.updateOrganLayer('B', { enabled: true, level: 0.7 })
      engine.noteOn(62, 0.8)
      expect(engine.getOrganVoiceCount()).toBe(1)
      engine.allNotesOff()

      engine.updateOrganLayer('A', { enabled: true, level: 0.6 })
      engine.noteOn(64, 0.8)
      expect(engine.getOrganVoiceCount()).toBe(2)
      engine.panic()
      expect(engine.getOrganVoiceCount()).toBe(0)
      engine.dispose()
    })

    it('focus, level, octave, and effect-target route per layer', async () => {
      const engine = await makeEngine()
      engine.setOrganState({ focus: 'A', sectionOn: true })
      engine.setEffectsState({ layerFocus: 'OrganA', focusSection: 'Organ' })
      expect(engine.getOrganState().focus).toBe('A')
      expect(engine.getEffectsState().layerFocus).toBe('OrganA')

      engine.setOrganState({ focus: 'B' })
      engine.setEffectsState({ layerFocus: 'OrganB', focusSection: 'Organ' })
      expect(engine.getOrganState().focus).toBe('B')
      expect(engine.getEffectsState().layerFocus).toBe('OrganB')
      expect(engine.getEffectsState().focusSection).toBe('Organ')

      engine.updateOrganLayer('A', { level: 0.35, octave: 1, enabled: true })
      engine.updateOrganLayer('B', { level: 0.88, octave: -1, enabled: true })
      expect(engine.getOrganState().layers.A.level).toBeCloseTo(0.35)
      expect(engine.getOrganState().layers.B.level).toBeCloseTo(0.88)
      expect(engine.getOrganState().layers.A.octave).toBe(1)
      expect(engine.getOrganState().layers.B.octave).toBe(-1)

      // shared organ effect chain is the effect target for both layers
      engine.updateChain('Organ', (c) => ({
        ...c,
        reverb: { ...c.reverb, on: true, mix: 0.6 },
      }))
      expect(engine.getEffectsState().chains.Organ.reverb.on).toBe(true)
      expect(engine.getGraphInfo().hasChainOrgan).toBe(true)

      engine.setPianoState({ sectionOn: false })
      engine.setSynthState({ sectionOn: false })
      engine.updateOrganLayer('B', { enabled: false })
      engine.noteOn(60, 0.8)
      expect(engine.getOrganVoiceCount()).toBe(1)
      engine.allNotesOff()
      engine.dispose()
    })
  })

  describe('synth A/B/C', () => {
    it('enable gates independent layer voice ownership', async () => {
      const engine = await makeEngine()
      engine.setPianoState({ sectionOn: false })
      engine.setOrganState({ sectionOn: false })
      engine.setSynthState({ sectionOn: true })

      for (const layer of ['A', 'B', 'C'] as const) {
        engine.updateSynthLayer('A', { enabled: layer === 'A', level: layer === 'A' ? 0.8 : 0 })
        engine.updateSynthLayer('B', { enabled: layer === 'B', level: layer === 'B' ? 0.8 : 0 })
        engine.updateSynthLayer('C', { enabled: layer === 'C', level: layer === 'C' ? 0.8 : 0 })
        engine.noteOn(60, 0.8)
        expect(engine.getSynthVoiceCount()).toBe(1)
        engine.allNotesOff()
        expect(engine.getSynthVoiceCount()).toBe(0)
      }

      engine.updateSynthLayer('A', { enabled: true, level: 0.7 })
      engine.updateSynthLayer('B', { enabled: true, level: 0.5 })
      engine.updateSynthLayer('C', { enabled: true, level: 0.4 })
      engine.noteOn(64, 0.8)
      expect(engine.getSynthVoiceCount()).toBe(3)
      engine.panic()
      expect(engine.getSynthVoiceCount()).toBe(0)
      engine.dispose()
    })

    it('focus, level, octave, and effect-target route per layer', async () => {
      const engine = await makeEngine()
      engine.setSynthState({ sectionOn: true })

      const targets: { layer: 'A' | 'B' | 'C'; focus: FxLayerFocus }[] = [
        { layer: 'A', focus: 'SynthA' },
        { layer: 'B', focus: 'SynthB' },
        { layer: 'C', focus: 'SynthC' },
      ]

      for (const { layer, focus } of targets) {
        engine.setSynthState({ focus: layer })
        engine.setEffectsState({ layerFocus: focus, focusSection: 'Synth' })
        expect(engine.getSynthState().focus).toBe(layer)
        expect(engine.getEffectsState().layerFocus).toBe(focus)
        expect(engine.getEffectsState().focusSection).toBe('Synth')
      }

      engine.updateSynthLayer('A', { level: 0.31, octave: -1, enabled: true })
      engine.updateSynthLayer('B', { level: 0.55, octave: 0, enabled: true })
      engine.updateSynthLayer('C', { level: 0.92, octave: 2, enabled: true })
      expect(engine.getSynthState().layers.A.level).toBeCloseTo(0.31)
      expect(engine.getSynthState().layers.B.level).toBeCloseTo(0.55)
      expect(engine.getSynthState().layers.C.level).toBeCloseTo(0.92)
      expect(engine.getSynthState().layers.A.octave).toBe(-1)
      expect(engine.getSynthState().layers.B.octave).toBe(0)
      expect(engine.getSynthState().layers.C.octave).toBe(2)

      // dedicated effect chains per synth layer
      engine.updateChain('SynthA', (c) => ({ ...c, mod1: { ...c.mod1, on: true } }))
      engine.updateChain('SynthB', (c) => ({ ...c, mod2: { ...c.mod2, on: true } }))
      engine.updateChain('SynthC', (c) => ({ ...c, compressor: { ...c.compressor, on: true } }))
      expect(engine.getEffectsState().chains.SynthA.mod1.on).toBe(true)
      expect(engine.getEffectsState().chains.SynthB.mod2.on).toBe(true)
      expect(engine.getEffectsState().chains.SynthC.compressor.on).toBe(true)
      expect(engine.getGraphInfo().hasChainSynthA).toBe(true)

      engine.setPianoState({ sectionOn: false })
      engine.setOrganState({ sectionOn: false })
      engine.noteOn(60, 0.8)
      expect(engine.getSynthVoiceCount()).toBe(3)
      engine.allNotesOff()
      engine.dispose()
    })
  })

  it('effect-target routing spans every layer of every engine', async () => {
    const engine = await makeEngine()
    const map: { section: 'Piano' | 'Organ' | 'Synth'; focus: FxLayerFocus }[] = [
      { section: 'Piano', focus: 'PianoA' },
      { section: 'Piano', focus: 'PianoB' },
      { section: 'Organ', focus: 'OrganA' },
      { section: 'Organ', focus: 'OrganB' },
      { section: 'Synth', focus: 'SynthA' },
      { section: 'Synth', focus: 'SynthB' },
      { section: 'Synth', focus: 'SynthC' },
    ]
    for (const { section, focus } of map) {
      engine.setEffectsState({ focusSection: section, layerFocus: focus })
      expect(engine.getEffectsState().layerFocus).toBe(focus)
      expect(engine.getEffectsState().focusSection).toBe(section)
    }
    engine.dispose()
  })
})
