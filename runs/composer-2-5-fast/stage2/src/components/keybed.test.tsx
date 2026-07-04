import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { Keybed } from './keybed'
import { CONTROLS } from '../model/hardware'
import { useInstrument } from '../state/instrument'

function KeybedHarness() {
  const instrument = useInstrument()
  return <Keybed instrument={instrument} />
}

function renderApp() {
  return render(<App />)
}

describe('interaction.keys', () => {
  it('handles pointer press and release on keys', async () => {
    render(<KeybedHarness />)
    const keybed = screen.getByTestId('keybed')
    const e4 = within(keybed).getByLabelText('E4 key')
    await act(async () => {
      fireEvent.pointerDown(e4, { pointerId: 1, clientY: 10, buttons: 1 })
    })
    expect(e4).toHaveAttribute('aria-pressed', 'true')
    await act(async () => {
      fireEvent.pointerUp(e4, { pointerId: 1 })
    })
    expect(e4).toHaveAttribute('aria-pressed', 'false')
  })

  it('supports independent multi-touch on different keys', async () => {
    render(<KeybedHarness />)
    const keybed = screen.getByTestId('keybed')
    const c4 = within(keybed).getByLabelText('C4 key')
    const d4 = within(keybed).getByLabelText('D4 key')
    await act(async () => {
      fireEvent.pointerDown(c4, { pointerId: 1, clientY: 10, buttons: 1 })
      fireEvent.pointerDown(d4, { pointerId: 2, clientY: 10, buttons: 1 })
    })
    expect(c4).toHaveAttribute('aria-pressed', 'true')
    expect(d4).toHaveAttribute('aria-pressed', 'true')
    await act(async () => {
      fireEvent.pointerUp(c4, { pointerId: 1 })
    })
    expect(c4).toHaveAttribute('aria-pressed', 'false')
    expect(d4).toHaveAttribute('aria-pressed', 'true')
  })

  it('cancels on pointer cancel', async () => {
    render(<KeybedHarness />)
    const keybed = screen.getByTestId('keybed')
    const key = within(keybed).getByLabelText('G4 key')
    await act(async () => {
      fireEvent.pointerDown(key, { pointerId: 5, clientY: 10, buttons: 1 })
      fireEvent.pointerCancel(key, { pointerId: 5 })
    })
    expect(key).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('interaction.decorative-controls', () => {
  it('updates presentation state without affecting piano status', async () => {
    renderApp()
    const instrument = screen.getByTestId('instrument')
    const organBtn = within(instrument).getByRole('switch', { name: /B3 Model/i })
    await act(async () => {
      fireEvent.click(organBtn)
    })
    expect(organBtn).toHaveAttribute('aria-checked', 'true')
    expect(within(instrument).getByText(/Piano: (ready|loading|fallback)/i)).toBeInTheDocument()
  })

  it('renders every control with stable data-control-id', () => {
    const { container } = renderApp()
    for (const control of CONTROLS) {
      expect(container.querySelector(`[data-control-id="${control.id}"]`)).toBeTruthy()
    }
  })
})

describe('accessibility.controls', () => {
  it('exposes aria labels on keybed and panel controls', () => {
    renderApp()
    const instrument = screen.getByTestId('instrument')
    expect(within(instrument).getByLabelText('73-key keyboard E1 to E7')).toBeInTheDocument()
    expect(within(instrument).getAllByRole('button', { name: / key$/i })).toHaveLength(73)
    expect(within(instrument).getByRole('status', { name: /Program OLED/i })).toBeInTheDocument()
    expect(within(instrument).getByRole('status', { name: /Synth OLED/i })).toBeInTheDocument()
  })
})

describe('regression.chassis', () => {
  it('renders full instrument without hero heading', () => {
    renderApp()
    expect(screen.queryByRole('heading', { name: /stagebench candidate starter/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('instrument')).toBeInTheDocument()
    expect(screen.getByTestId('keybed')).toBeInTheDocument()
    expect(screen.getByText(/Nord Stage 4/i)).toBeInTheDocument()
  })
})
