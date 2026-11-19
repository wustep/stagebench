import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { MidiProvider, PianoEngineStatusSnapshot, PianoVoiceBackend } from '../audio/boundaries'
import { PANEL_CONTROLS } from '../model/controls'

function createSpyBackend() {
  const triggerNote = vi.fn()
  const releaseNote = vi.fn()
  const stopAllImmediate = vi.fn()
  const status: PianoEngineStatusSnapshot = {
    status: 'ready',
    loadedSamples: 78,
    totalSamples: 78,
    usingFallback: false,
    message: 'Salamander Grand V3 ready (78/78 samples)',
    audioContextState: 'running',
  }
  const backend: PianoVoiceBackend = {
    unlock: async () => undefined,
    triggerNote,
    releaseNote,
    stopAllImmediate,
    getActiveNodeCount: () => 0,
    getStatus: () => status,
    subscribeStatus: () => () => undefined,
    dispose: () => undefined,
  }
  return { backend, triggerNote, releaseNote, stopAllImmediate }
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

describe('interaction.decorative-controls — presentation-only panel control movement', () => {
  it('moves/toggles controls across all 6 sections via pointer & keyboard without triggering any audio', () => {
    const { backend, triggerNote, releaseNote } = createSpyBackend()
    const { container } = render(<App pianoBackend={backend} midiProvider={unsupportedMidi} />)

    // 1. Knob (Master Level): ArrowRight increments value
    const masterKnob = container.querySelector<HTMLElement>('#perf-master-level')!
    const masterBefore = Number(masterKnob.getAttribute('aria-valuenow'))
    fireEvent.keyDown(masterKnob, { key: 'ArrowRight' })
    expect(Number(masterKnob.getAttribute('aria-valuenow'))).toBeGreaterThan(masterBefore)

    // 2. Pitch Stick & Mod Wheel: keyboard arrows move value
    const pitchStick = container.querySelector<HTMLElement>('#perf-pitch-stick')!
    fireEvent.keyDown(pitchStick, { key: 'ArrowRight' })
    expect(Number(pitchStick.getAttribute('aria-valuenow'))).toBeGreaterThan(0)

    const modWheel = container.querySelector<HTMLElement>('#perf-mod-wheel')!
    fireEvent.keyDown(modWheel, { key: 'End' })
    expect(Number(modWheel.getAttribute('aria-valuenow'))).toBe(100)

    // 3. Organ Drawbar: ArrowDown decrements, Home sets 0, End sets 8
    const drawbar1 = container.querySelector<HTMLElement>('#organ-drawbar-1')!
    fireEvent.keyDown(drawbar1, { key: 'Home' })
    expect(drawbar1.getAttribute('aria-valuenow')).toBe('0')
    fireEvent.keyDown(drawbar1, { key: 'End' })
    expect(drawbar1.getAttribute('aria-valuenow')).toBe('8')

    // 4. Piano Type Selector button cycles options without affecting audio
    const pianoTypeBtn = container.querySelector<HTMLButtonElement>('#piano-type-select')!
    const initialLabel = pianoTypeBtn.getAttribute('aria-label')
    fireEvent.click(pianoTypeBtn)
    expect(pianoTypeBtn.getAttribute('aria-label')).not.toBe(initialLabel)

    // 5. Program 2 button toggles aria-pressed cleanly
    const prog2 = container.querySelector<HTMLButtonElement>('#program-btn-2')!
    expect(prog2.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(prog2)
    expect(prog2.getAttribute('aria-pressed')).toBe('true')

    // 6. Synth Layer A Fader & Filter Freq knob
    const synthFader = container.querySelector<HTMLElement>('#synth-layer-a-fader')!
    fireEvent.keyDown(synthFader, { key: 'PageDown' })
    expect(Number(synthFader.getAttribute('aria-valuenow'))).toBeLessThan(90)

    const filterKnob = container.querySelector<HTMLElement>('#synth-filter-freq')!
    fireEvent.keyDown(filterKnob, { key: 'ArrowUp' })
    expect(Number(filterKnob.getAttribute('aria-valuenow'))).toBeGreaterThan(35)

    // 7. Layer Effects Reverb Wet & On toggle
    const reverbWet = container.querySelector<HTMLElement>('#fx-reverb-dry-wet')!
    fireEvent.keyDown(reverbWet, { key: 'Home' })
    expect(reverbWet.getAttribute('aria-valuenow')).toBe('0')
    const reverbOn = container.querySelector<HTMLButtonElement>('#fx-reverb-on')!
    fireEvent.click(reverbOn)
    expect(reverbOn.getAttribute('aria-pressed')).toBe('false')

    // Critical Phase 1 honesty assertion: ZERO audio events triggered by any panel control!
    expect(triggerNote).not.toHaveBeenCalled()
    expect(releaseNote).not.toHaveBeenCalled()
  })
})

describe('accessibility.controls — names, roles, value attributes, and keyboard operation', () => {
  it('gives every visible panel control an accessible name, valid ARIA role, value metadata, and keyboard focusability', () => {
    const { backend } = createSpyBackend()
    const { container } = render(<App pianoBackend={backend} midiProvider={unsupportedMidi} />)

    for (const spec of PANEL_CONTROLS) {
      const el = container.querySelector<HTMLElement>(`[data-control-id="${spec.id}"]`)
      expect(el, `missing ${spec.id}`).not.toBeNull()
      const ariaLabel = el!.getAttribute('aria-label')
      expect(ariaLabel && ariaLabel.trim().length > 0, `${spec.id} missing aria-label`).toBe(true)

      if (spec.kind === 'button') {
        expect(el!.tagName).toBe('BUTTON')
      } else {
        expect(el!.getAttribute('role')).toBe('slider')
        expect(el!.tabIndex).toBe(0)
        expect(el!.getAttribute('aria-valuemin')).toBe(String(spec.min))
        expect(el!.getAttribute('aria-valuemax')).toBe(String(spec.max))
        expect(el!.getAttribute('aria-valuenow')).not.toBeNull()
        expect(el!.getAttribute('aria-valuetext')).not.toBeNull()
      }
    }
  })

  it('gives every keybed key an accessible name, button semantics, and aria-pressed state', () => {
    const { backend } = createSpyBackend()
    const { container } = render(<App pianoBackend={backend} midiProvider={unsupportedMidi} />)

    const keys = container.querySelectorAll<HTMLButtonElement>('[data-key-midi]')
    expect(keys).toHaveLength(73)
    for (const key of keys) {
      expect(key.getAttribute('aria-label')).toMatch(/^Piano key [A-G]#?\d$/)
      expect(key.getAttribute('aria-pressed')).toBe('false')
    }
  })
})
