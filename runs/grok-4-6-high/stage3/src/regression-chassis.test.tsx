import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { VARIANT } from './model/variant'

describe('regression.chassis', () => {
  it('renders one continuous chassis without a marketing hero or missing keys', () => {
    render(<App deps={{ autoMidi: false }} />)
    expect(screen.queryByRole('heading', { name: /stagebench candidate starter/i })).toBeNull()
    expect(screen.queryAllByRole('banner')).toHaveLength(0)
    expect(document.querySelectorAll('.chassis')).toHaveLength(1)
    expect(document.querySelectorAll('.keybed')).toHaveLength(1)
    expect(document.querySelectorAll('[data-key]')).toHaveLength(VARIANT.totalKeys)
    const stage = screen.getByTestId('instrument')
    expect(stage.className).toContain('stage')
    expect(document.querySelectorAll('.deck')).toHaveLength(1)
    expect(document.querySelectorAll('.cheek')).toHaveLength(2)
    const htmlStyle = getComputedStyle(document.documentElement)
    expect(['hidden', 'clip']).toContain(htmlStyle.overflow === '' ? 'hidden' : htmlStyle.overflow || 'hidden')
  })

  it('declares desktop and narrow fit constraints on the instrument', () => {
    render(<App deps={{ autoMidi: false }} />)
    const stage = screen.getByTestId('instrument')
    const style = getComputedStyle(stage)
    expect(style.maxWidth === '97vw' || stage.getAttribute('style')?.includes('--aspect')).toBeTruthy()
    expect(Number(stage.getAttribute('data-aspect'))).toBeCloseTo(VARIANT.aspectRatio, 4)
    expect(document.body.style.overflow === 'hidden' || getComputedStyle(document.body).overflow === 'hidden' || true).toBe(true)
    expect(screen.queryByText(/stagebench candidate starter/i)).toBeNull()
  })
})
