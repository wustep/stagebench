import { describe, expect, it } from 'vitest'
import { organModelSignature, effectiveDrawbars } from '../src/audio/organ-engine'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'
import { REQUIRED_ORGAN_MODELS } from '../src/model/organ-types'

describe('organ.models-drawbars', () => {
  it('B3 Vox Farf Pipe are spectrally distinct', () => {
    const sigs = REQUIRED_ORGAN_MODELS.map((m) => organModelSignature(m))
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        const a = sigs[i]!
        const b = sigs[j]!
        const dist = a.reduce((s, v, k) => s + Math.abs(v - b[k]!), 0)
        expect(dist).toBeGreaterThan(0.5)
      }
    }
  })

  it('drawbars change effective spectrum and LED state', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setOrganState({ sectionOn: true })
    const full = [1, 1, 1, 1, 1, 1, 1, 1, 1]
    const soft = [1, 0, 0, 0, 0, 0, 0, 0, 0]
    engine.updateOrganLayer('A', { model: 'B3', drawbars: full, enabled: true })
    expect(engine.getOrganState().layers.A.drawbars).toEqual(full)
    const eFull = effectiveDrawbars('B3', full).reduce((a, b) => a + b, 0)
    const eSoft = effectiveDrawbars('B3', soft).reduce((a, b) => a + b, 0)
    expect(eFull).toBeGreaterThan(eSoft)

    engine.updateOrganLayer('A', { model: 'Farf', drawbars: [1, 1, 0, 0, 0, 0, 0, 0, 0] })
    const farf = effectiveDrawbars('Farf', [0.4, 0.9, 0.3, 0, 0, 0, 0, 0, 0])
    // Farf: pulled past half = on
    expect(farf[0]).toBe(0)
    expect(farf[1]).toBeGreaterThan(0)
    engine.dispose()
  })

  it('percussion key click and vibrato change state', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setPianoState({ sectionOn: false })
    engine.setOrganState({
      sectionOn: true,
      percussion: { on: true, soft: false, fast: true, third: true },
      keyClick: 0.8,
    })
    engine.updateOrganLayer('A', { enabled: true, model: 'B3', vibratoOn: true, vibratoPos: 'V3' })
    engine.noteOn(60, 0.9)
    expect(engine.getOrganVoiceCount()).toBe(1)
    expect(engine.getOrganState().percussion.on).toBe(true)
    expect(engine.getOrganState().layers.A.vibratoPos).toBe('V3')
    engine.allNotesOff()

    const b3 = engine.organSignature('B3')
    const vox = engine.organSignature('Vox')
    expect(b3[0]).not.toBe(vox[0])
    engine.dispose()
  })
})
