import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

describe('Stage 4 surface', () => {
  afterEach(cleanup)

  it('models the 73 E-to-E keys and the only two OLED status screens', () => {
    render(<App />)
    expect(screen.getAllByRole('button', { name: /piano key$/i })).toHaveLength(73)
    expect(screen.getByRole('button', { name: 'E1 piano key' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'E7 piano key' })).toBeInTheDocument()
    expect(screen.getAllByRole('status')).toHaveLength(2)
  })

  it('makes decorative hardware keyboard-accessible presentation state', () => {
    render(<App />)
    const live = screen.getByRole('button', { name: /live mode/i })
    expect(live).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(live)
    expect(live).toHaveAttribute('aria-pressed', 'true')
    const dial = screen.getByLabelText('Program Dial') as HTMLInputElement
    fireEvent.change(dial, { target: { value: '82' } })
    expect(dial.value).toBe('31')
  })

  it('depresses and releases a pointer-played piano note', () => {
    render(<App />)
    const key = screen.getByRole('button', { name: 'E1 piano key' })
    fireEvent.pointerDown(key, { pointerId: 1 })
    expect(key).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(key, { pointerId: 1 })
    expect(key).toHaveAttribute('aria-pressed', 'false')
  })

  it('handles mapped keyboard notes and sustains with Space', () => {
    render(<App />)
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ' })
    expect(screen.getByRole('button', { name: 'C3 piano key' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { key: 'z', code: 'KeyZ' })
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(screen.getByRole('button', { name: 'SUSTAIN · SPACE' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
  })

  it('owns functional Piano A/B layer controls and exposes the fallback state', () => {
    render(<App />)
    expect(screen.getByText(/sample assets unavailable/i)).toBeInTheDocument()
    const layerB = screen.getByRole('button', { name: 'B' })
    expect(layerB).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(layerB)
    expect(layerB).toHaveAttribute('aria-pressed', 'true')
    const type = screen.getByRole('button', { name: 'Piano Type' })
    fireEvent.click(type)
    expect(type).toHaveTextContent('Clav')
    const level = screen.getByLabelText('Piano Layer B Level') as HTMLInputElement
    fireEvent.change(level, { target: { value: '23' } })
    expect(level.value).toBe('23')
  })

  it('switches effect focus and keeps unit bypass and type controls live', () => {
    render(<App />)
    const pianoB = screen.getByRole('button', { name: 'PIANO B' })
    fireEvent.click(pianoB)
    expect(pianoB).toHaveAttribute('aria-pressed', 'true')
    const mod = screen.getByRole('button', { name: 'MOD1' })
    fireEvent.click(mod)
    expect(mod).toHaveAttribute('aria-pressed', 'true')
    const type = screen.getByLabelText('mod1 type') as HTMLSelectElement
    fireEvent.change(type, { target: { value: 'Ring Mod' } })
    expect(type.value).toBe('Ring Mod')
    const all = screen.getByRole('button', { name: 'LAYER FX ON' })
    fireEvent.click(all)
    expect(all).toHaveAttribute('aria-pressed', 'false')
  })

  it('stores, navigates and restores a named program with a truthful edited indicator', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'STORE AS' }))
    const name = screen.getByLabelText('Program name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Test Split' } })
    fireEvent.click(screen.getByRole('button', { name: /1.*Concert Grand/i }))
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Test Split')
    fireEvent.click(screen.getByRole('button', { name: 'SPLIT ON/SET' }))
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('E')
    fireEvent.click(screen.getByRole('button', { name: /2.*Tine Stack/i }))
    expect(screen.getAllByRole('status')[0]).not.toHaveTextContent('Test Split')
  })

  it('has four-zone splits, scenes, morph sources and panic', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'SPLIT ON/SET' }))
    expect(screen.getByLabelText('Mid split point')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SCENE II' }))
    expect(screen.getByRole('button', { name: 'SCENE II' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'WHEEL MORPH' }))
    fireEvent.change(screen.getByLabelText('Morph wheel position'), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: 'PANIC' }))
  })

  it('binds organ engines, drawbars and rotary controls', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'ORG A' }))
    expect(screen.getByRole('button', { name: 'ORG A' })).toHaveAttribute('aria-pressed', 'true')
    const drawbar = screen.getByLabelText('Organ drawbar 1') as HTMLInputElement
    fireEvent.change(drawbar, { target: { value: '2' } })
    expect(drawbar.value).toBe('2')
    fireEvent.change(screen.getByLabelText('Organ rotary speed'), { target: { value: 'Fast' } })
    expect((screen.getByLabelText('Organ rotary speed') as HTMLSelectElement).value).toBe('Fast')
  })

  it('binds synth waveform, filter, LFO and deterministic arp controls', () => {
    render(<App />)
    const layer = document.querySelector<HTMLButtonElement>('#synth-layer-a')!
    const waveform = document.querySelector<HTMLSelectElement>('[aria-label="Synth waveform"]')!
    const filter = document.querySelector<HTMLSelectElement>('[aria-label="Synth filter type"]')!
    const lfo = document.querySelector<HTMLSelectElement>('[aria-label="Synth LFO destination"]')!
    const arp = document.querySelector<HTMLButtonElement>('#synth-arp-run')!
    fireEvent.click(layer)
    fireEvent.change(waveform, { target: { value: 'FM 2-op (algorithm A)' } })
    expect(waveform.value).toBe('FM 2-op (algorithm A)')
    fireEvent.change(filter, { target: { value: 'BP' } })
    fireEvent.change(lfo, { target: { value: 'Filter Freq' } })
    fireEvent.click(arp)
    expect(arp).toHaveAttribute('aria-pressed', 'true')
  })
})
