import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTROLS } from '../src/model/hardware'
import { VARIANT } from '../src/model/variant'
import { PianoEngine } from '../src/audio/piano-engine'
import { Instrument } from '../src/components/Instrument'
import { createMockContextFactory } from '../src/test/mock-audio'
import { hardwareStore } from '../src/state/hardware-store'
import fs from 'node:fs'
import path from 'node:path'

describe('regression.phase1', () => {
  afterEach(() => {
    cleanup()
    hardwareStore.reset()
  })

  it('keeps Phase 1 surface: 73 keys, six sections, control IDs', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    render(<Instrument engine={engine} enableMidi={false} />)
    expect(screen.getByTestId('keybed')).toHaveAttribute('data-key-count', '73')
    expect(document.querySelectorAll('[data-key-midi]').length).toBe(VARIANT.keyboard.totalKeys)
    for (const s of ['performance', 'organ', 'piano', 'program', 'synth', 'effects']) {
      expect(screen.getByTestId(`section-${s}`)).toBeInTheDocument()
    }
    for (const c of CONTROLS) {
      if (c.kind === 'oled') continue
      expect(document.querySelector(`[data-control-id="${c.id}"]`)).toBeTruthy()
    }
    expect(screen.getByTestId('phase1-honesty')).toHaveTextContent(/decorative/i)
    engine.dispose()
  })

  it('Phase 1 feature-matrix entries still map to existing test files', () => {
    const matrixPath = path.join(process.cwd(), 'tests/feature-matrix.json')
    const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as {
      features: { id: string; tests: string[] }[]
    }
    const phase1 = [
      'visual.key-count',
      'visual.section-layout',
      'visual.control-inventory',
      'interaction.keys',
      'interaction.decorative-controls',
      'accessibility.controls',
      'piano.basic-note-lifecycle',
      'piano.basic-inputs',
      'piano.basic-sustain-polyphony',
      'piano.basic-status-cleanup',
      'regression.chassis',
    ]
    for (const id of phase1) {
      const feat = matrix.features.find((f) => f.id === id)
      expect(feat, id).toBeTruthy()
      for (const t of feat!.tests) {
        expect(fs.existsSync(path.join(process.cwd(), t)), t).toBe(true)
      }
    }
  })
})
