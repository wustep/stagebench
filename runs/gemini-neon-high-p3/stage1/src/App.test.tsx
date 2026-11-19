import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { MidiProvider, PianoEngineStatusSnapshot, PianoVoiceBackend } from './audio/boundaries'

function createMockBackend() {
  const triggerNote = vi.fn()
  const releaseNote = vi.fn()
  const stopAllImmediate = vi.fn()
  const dispose = vi.fn()
  const status: PianoEngineStatusSnapshot = {
    status: 'ready',
    loadedSamples: 78,
    totalSamples: 78,
    usingFallback: false,
    message: 'Salamander Grand V3 ready (78/78 samples)',
    audioContextState: 'running',
  }
  const backend: PianoVoiceBackend = {
    unlock: vi.fn(async () => undefined),
    triggerNote,
    releaseNote,
    stopAllImmediate,
    getActiveNodeCount: () => 0,
    getStatus: () => status,
    subscribeStatus: () => () => undefined,
    dispose,
  }
  return { backend, triggerNote, releaseNote, stopAllImmediate, dispose }
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

describe('Nord Stage 4 73 Phase 1 end-to-end integration', () => {
  it('renders the full instrument, plays notes from the keybed, toggles credits attribution, and cleans up on unmount', () => {
    const { backend, triggerNote, stopAllImmediate } = createMockBackend()
    const { unmount } = render(<App pianoBackend={backend} midiProvider={unsupportedMidi} />)

    expect(screen.getByRole('region', { name: /nord stage 4 73 instrument/i })).toBeInTheDocument()

    // Play C4 via keybed button
    const c4 = screen.getByRole('button', { name: 'Piano key C4' })
    fireEvent.pointerDown(c4, { pointerId: 1, button: 0, pointerType: 'mouse' })
    expect(triggerNote).toHaveBeenCalledTimes(1)
    expect(triggerNote.mock.calls[0][1]).toBe(60)

    // Open CC-BY-3.0 sample credits disclosure
    const creditsBtn = screen.getByRole('button', { name: /credits & phase 1 scope/i })
    fireEvent.click(creditsBtn)
    expect(screen.getByText(/Salamander Grand Piano V3 by Alexander Holm/i)).toBeInTheDocument()

    // Unmount stops every active voice cleanly
    unmount()
    expect(stopAllImmediate).toHaveBeenCalled()
  })
})
