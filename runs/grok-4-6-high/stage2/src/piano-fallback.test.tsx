import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { PianoEngine, rms, renderPianoScript } from './audio/piano-engine'
import { createAudioContext } from './audio/software-context'

describe('piano.fallback', () => {
  it('enters a labeled playable fallback without reporting the library ready', async () => {
    const engine = new PianoEngine({
      context: createAudioContext({ offline: true, durationSec: 0.35 }),
      failSamples: true,
    })
    await engine.init()
    expect(engine.getStatus()).toBe('fallback')
    expect(engine.getStatus()).not.toBe('ready')
    expect(engine.getStatusDetail().toLowerCase()).toMatch(/fallback/)
    expect(engine.getStatusDetail().toLowerCase()).not.toMatch(/libraries loaded/)
    engine.dispose()

    const samples = await renderPianoScript(0.3, (eng) => {
      eng.noteOn(60, 0.8, 0)
    })
    expect(rms(samples)).toBeGreaterThan(0.001)
  })

  it('surfaces the failure on the program display when forced', async () => {
    render(
      <App
        deps={{
          autoMidi: false,
          createAudioContext: () => {
            throw new Error('no audio')
          },
        }}
      />,
    )
    await waitFor(() => {
      expect(screen.getByLabelText('Program display').textContent?.toLowerCase()).toMatch(
        /fail|fallback|error/,
      )
    })
  })
})
