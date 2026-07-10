import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTROLS } from '../src/model/hardware'
import { hardwareStore } from '../src/state/hardware-store'
import { PianoEngine } from '../src/audio/piano-engine'
import { Instrument } from '../src/components/Instrument'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('interaction.decorative-controls', () => {
  afterEach(() => {
    cleanup()
    hardwareStore.reset()
  })

  it('every visible control has a stable ID and updates presentation only', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ createContext })
    await engine.init()
    const voicesBefore = engine.getActiveVoiceCount()
    render(<Instrument engine={engine} enableMidi={false} />)

    for (const c of CONTROLS) {
      if (c.kind === 'oled') continue
      const el = document.querySelector(`[data-control-id="${c.id}"]`) as HTMLElement | null
      expect(el, `missing control ${c.id}`).toBeTruthy()
      expect(el!.getAttribute('aria-label') || el!.textContent).toBeTruthy()
    }

    // Toggle a piano type button — decorative, no audio change
    const grand = document.querySelector('[data-control-id="piano-type-upright"]') as HTMLElement
    fireEvent.click(grand)
    expect(hardwareStore.getValue('piano-type-upright')).toBe(1)
    expect(engine.getActiveVoiceCount()).toBe(voicesBefore)

    // Knob presentation
    const knob = document.querySelector('[data-control-id="perf-master-level"]') as HTMLElement
    fireEvent.keyDown(knob, { key: 'ArrowUp' })
    expect(hardwareStore.getValue('perf-master-level')).toBeGreaterThan(0.75)

    // Drawbar slides
    const db = document.querySelector('[data-control-id="organ-drawbar-1"]') as HTMLElement
    fireEvent.keyDown(db, { key: 'ArrowDown' })
    expect(hardwareStore.getValue('organ-drawbar-1')).not.toBe(0.8)

    // Fader
    const fader = document.querySelector('[data-control-id="piano-level-a"]') as HTMLElement
    fireEvent.keyDown(fader, { key: 'ArrowDown' })
    expect(hardwareStore.getValue('piano-level-a')).toBeLessThan(0.85)
  })

  it('does not claim unimplemented program/effect state as working', () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ createContext })
    render(<Instrument engine={engine} enableMidi={false} />)
    expect(screen.getByTestId('phase1-honesty')).toHaveTextContent(/decorative/i)
    const programOled = document.querySelector('[data-control-id="program-oled"]')
    expect(programOled?.textContent).toMatch(/Init Program/i)
  })
})
