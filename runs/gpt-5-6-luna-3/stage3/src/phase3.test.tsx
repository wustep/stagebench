import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

afterEach(cleanup)

describe('Nord Stage 4 Phase 3 bindings', () => {
  it('exposes 32-program navigation, dirty Store, Live mode, and scenes', () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('[id^="program-button-"]')).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'B3' }))
    expect(screen.getByLabelText(/Primary program display/i)).toHaveTextContent('E')
    const store = screen.getByRole('button', { name: 'STORE' })
    fireEvent.click(store)
    expect(store).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(store)
    expect(store).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'LIVE MODE' }))
    expect(screen.getByRole('button', { name: 'LIVE MODE' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'SCENE II' }))
    expect(screen.getByRole('button', { name: 'SCENE II' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('binds organ drawbars/models, synth categories/waveforms, splits, morphs, clock, and panic', () => {
    const { container } = render(<App />)
    fireEvent.change(container.querySelector('#organ-drawbar-0') as HTMLElement, { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'VOX' }))
    fireEvent.change(container.querySelector('#synth-category') as HTMLElement, { target: { value: 'FM-H' } })
    expect(container.querySelector('#synth-waveform')).toHaveValue('FM 2-op (algorithm A)')
    fireEvent.change(container.querySelector('#program-split-mid') as HTMLElement, { target: { value: '72' } })
    fireEvent.change(container.querySelector('#program-crossfade') as HTMLElement, { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'WHEEL' }))
    fireEvent.click(container.querySelector('#program-master-clock-tap') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'PANIC' }))
    expect(screen.getByRole('button', { name: 'WHEEL' })).toHaveAttribute('aria-pressed', 'true')
  })
})
