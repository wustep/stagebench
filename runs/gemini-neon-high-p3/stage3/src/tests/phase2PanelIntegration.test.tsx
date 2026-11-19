import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { MidiProvider, PianoEngineStatusSnapshot, PianoVoiceBackend } from '../audio/boundaries'
import type { StageInstrumentState } from '../model/instrumentState'

function createCaptureBackend(overrideStatus?: Partial<PianoEngineStatusSnapshot>) {
  let latestState: StageInstrumentState | null = null
  const applyInstrumentState = vi.fn((s: StageInstrumentState) => {
    latestState = s
  })
  const status: PianoEngineStatusSnapshot = {
    status: 'ready',
    loadedSamples: 170,
    totalSamples: 170,
    usingFallback: false,
    message: 'Salamander Grand ready (78/78 samples)',
    audioContextState: 'running',
    failedBanks: [],
    ...overrideStatus,
  }
  const backend: PianoVoiceBackend = {
    unlock: async () => undefined,
    triggerNote: vi.fn(),
    releaseNote: vi.fn(),
    stopAllImmediate: vi.fn(),
    getActiveNodeCount: () => 0,
    getStatus: () => status,
    subscribeStatus: () => () => undefined,
    dispose: vi.fn(),
    applyInstrumentState,
  }
  return { backend, applyInstrumentState, getLatestState: () => latestState }
}

const unsupportedMidi: MidiProvider = {
  isSupported: () => false,
  requestAccess: async () => {
    throw new Error('unsupported')
  },
}

afterEach(() => {
  cleanup()
})

describe('Phase 2 panel bindings, Program OLED sync, FX Focus/Group/Global, and missing-model UI', () => {
  it('syncs Piano type, model dial, layers A/B, FX focus/group/global, and Master Level to engine state and OLED', () => {
    const { backend, getLatestState } = createCaptureBackend()
    const { container } = render(<App pianoBackend={backend} midiProvider={unsupportedMidi} />)

    const oled = container.querySelector('#program-oled')!
    expect(oled.textContent).toContain('A: Salamander Grand')

    // Cycle Piano Type from Grand -> Upright -> Electric and step Model Dial Rhodes -> Wurli
    const typeBtn = container.querySelector<HTMLButtonElement>('#piano-type-select')!
    fireEvent.click(typeBtn) // Upright
    expect(oled.textContent).toContain('Kawai Upright KW')
    fireEvent.click(typeBtn) // Electric
    expect(oled.textContent).toContain('EP1 Mk I Rhodes')

    const modelDial = container.querySelector<HTMLElement>('#piano-model-dial')!
    fireEvent.keyDown(modelDial, { key: 'ArrowRight' })
    expect(oled.textContent).toContain('EP2 Wurli 200')
    expect(getLatestState()?.piano.layers.A.type).toBe('Electric')
    expect(getLatestState()?.piano.layers.A.modelIndex).toBe(1)

    // Enable Piano Layer B -> focus moves to B and FX Focus follows to pianoB
    const layerBBtn = container.querySelector<HTMLButtonElement>('#piano-layer-b-on')!
    fireEvent.click(layerBBtn)
    expect(container.querySelector('[data-section="piano"]')?.getAttribute('data-focused-layer')).toBe('B')
    expect(container.querySelector('[data-section="effects"]')?.getAttribute('data-fx-focus')).toBe('pianoB')

    // Shift + FX Focus Piano activates Piano Group Mode
    fireEvent.click(container.querySelector<HTMLButtonElement>('#fx-shift')!)
    fireEvent.click(container.querySelector<HTMLButtonElement>('#fx-focus-piano')!)
    expect(container.querySelector('[data-section="effects"]')?.getAttribute('data-fx-group-piano')).toBe('on')
    expect(oled.textContent).toContain('FX: PNO GRP')

    // Shift + Reverb On activates Global Reverb Mode
    fireEvent.click(container.querySelector<HTMLButtonElement>('#fx-shift')!)
    fireEvent.click(container.querySelector<HTMLButtonElement>('#fx-reverb-on')!)
    expect(container.querySelector('[data-section="effects"]')?.getAttribute('data-fx-global-reverb')).toBe('on')

    // SUSTPED and PSTICK buttons update canonical state
    fireEvent.click(container.querySelector<HTMLButtonElement>('#piano-sustped')!)
    expect(getLatestState()?.piano.sustped).toBe(false)
    fireEvent.click(container.querySelector<HTMLButtonElement>('#piano-pstick')!)
    expect(getLatestState()?.piano.pstick).toBe(false)

    // Master Level updates canonical state
    fireEvent.keyDown(container.querySelector<HTMLElement>('#perf-master-level')!, { key: 'End' })
    expect(getLatestState()?.masterLevel).toBe(100)
  })

  it('flashes Type LED and displays MISSING alert in Program OLED when sample bank fails to load', () => {
    const { backend } = createCaptureBackend({
      status: 'fallback',
      usingFallback: true,
      failedBanks: ['grand'],
      message: 'Salamander Grand missing — playable synth fallback active',
    })
    const { container } = render(<App pianoBackend={backend} midiProvider={unsupportedMidi} />)

    expect(container.querySelector('.ns4-piano-select-box')?.classList.contains('is-missing-model')).toBe(true)
    expect(container.querySelector('#program-oled')?.textContent).toMatch(/MISSING:\s*Salamander Grand/i)
  })
})
