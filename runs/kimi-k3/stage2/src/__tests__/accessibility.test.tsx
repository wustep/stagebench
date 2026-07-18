import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { PianoEngine } from '../audio/engine'
import { FakeAudioBackend } from '../audio/fake-backend'
import { CONTROLS } from '../hardware/controls'

function setup() {
  const engine = new PianoEngine(new FakeAudioBackend())
  return render(<App engine={engine} disableMidi />)
}

describe('accessibility.controls', () => {
  it('every continuous control exposes slider role with accessible name and value', () => {
    setup()
    for (const c of CONTROLS.filter((x) => x.kind !== 'button')) {
      const el = screen.getByRole('slider', { name: c.label })
      expect(el, c.id).toHaveAttribute('aria-valuemin', String(c.min))
      expect(el, c.id).toHaveAttribute('aria-valuemax', String(c.max))
      expect(el, c.id).toHaveAttribute('aria-valuenow')
      expect(el, c.id).toHaveAttribute('tabindex', '0') // keyboard operable
    }
  })

  it('every button exposes an accessible name and pressed state', () => {
    setup()
    for (const c of CONTROLS.filter((x) => x.kind === 'button')) {
      const el = screen.getByRole('button', { name: c.label })
      expect(el, c.id).toHaveAttribute('aria-pressed')
    }
  })

  it('all 73 keys have accessible names', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Piano key E1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Piano key E7' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Piano key C4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Piano key F#4' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Piano key / }).length).toBe(73)
  })

  it('the keybed group is labeled with count and range', () => {
    setup()
    expect(screen.getByRole('group', { name: /73 keys, E1 to E7/ })).toBeInTheDocument()
  })

  it('OLEDs are polite status regions with names', () => {
    setup()
    expect(screen.getByRole('status', { name: 'Program display' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Synth display' })).toBeInTheDocument()
  })

  it('status bar reports audio and MIDI state via a live region', () => {
    const { container } = setup()
    const bar = container.querySelector('.statusbar')!
    expect(bar).toHaveAttribute('aria-live', 'polite')
    expect(bar.textContent).toMatch(/Piano voice:/)
    expect(bar.textContent).toMatch(/MIDI:/)
  })

  it('controls have visible focus styling', async () => {
    setup()
    // The stylesheet defines a focus-visible ring for controls and keys.
    const styles = (await import('../styles.css?inline')) as Record<string, string>
    const css = styles.default ?? Object.values(styles).join('\n')
    expect(css).toMatch(/:focus-visible/)
  })
})
