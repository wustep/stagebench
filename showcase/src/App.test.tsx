import { StrictMode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { renderApp } from './test/renderApp'
import { fakeAssetBoundary, fakeAudioBoundary, fakeMidiBoundary, fakeStorageBoundary, FakeGain, FakeMidiAccess } from './test/fakes'

// Inherited starter smoke test, updated to the replaced Phase 1 surface
// (the starter explicitly instructs replacing its placeholder markup).
describe('candidate application', () => {
  it('renders the Nord Stage 4 73 instrument surface', () => {
    renderApp()
    expect(screen.getByRole('region', { name: /nord stage 4 73/i })).toBeInTheDocument()
    expect(screen.getByTestId('keybed')).toBeInTheDocument()
  })

  it('reports a truthful initial audio status', () => {
    renderApp()
    expect(screen.getByTestId('engine-status').getAttribute('data-status')).toBe('idle')
    expect(screen.getByTestId('engine-status').textContent).toMatch(/first key press/i)
  })

  it('panel state still reaches the engine after a StrictMode remount cycle', () => {
    // Regression: StrictMode's simulated unmount disposes the engine and
    // detaches its store subscription; the mount effect must re-attach it or
    // every panel control silently stops changing the audio graph in dev.
    const setup = fakeAudioBoundary()
    render(
      <StrictMode>
        <App
          audioBoundary={setup.boundary}
          midiBoundary={fakeMidiBoundary(new FakeMidiAccess())}
          assetBoundary={fakeAssetBoundary()}
          storageBoundary={fakeStorageBoundary()}
        />
      </StrictMode>,
    )
    fireEvent.pointerDown(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
    fireEvent.pointerUp(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
    const context = setup.getContext()!
    const master = context.nodes.find((n): n is FakeGain => n instanceof FakeGain)!
    const before = master.gain.value
    const masterKnob = screen.getByRole('slider', { name: 'Master Level' })
    fireEvent.keyDown(masterKnob, { key: 'Home' }) // Master Level -> 0
    expect(master.gain.value).toBeLessThan(before)
    expect(master.gain.value).toBeLessThanOrEqual(0.001)
  })
})
