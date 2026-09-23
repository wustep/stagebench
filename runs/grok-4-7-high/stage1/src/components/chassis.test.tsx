import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VARIANT } from '../model/variant'
import { renderApp } from '../test/renderApp'

const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')

describe('regression.chassis', () => {
  it('is a single instrument with the variant keybed and no marketing hero', () => {
    renderApp()
    expect(document.querySelectorAll('[data-testid="instrument"]')).toHaveLength(1)
    expect(document.querySelector('[data-testid="instrument"]')).toHaveAttribute('data-variant', 'stage-4-73')
    expect(document.querySelector('[data-testid="instrument"]')).toHaveAttribute('data-aspect', String(VARIANT.aspectRatio))
    expect(document.querySelector('.hero, .marketing, [data-hero]')).toBeNull()
    const heading = document.querySelector('h1')
    expect(heading).toHaveClass('sr-only')
    expect(heading).toHaveTextContent('Nord Stage 4 73')
    const keys = document.querySelectorAll('.key')
    expect(keys).toHaveLength(73)
    expect(document.querySelectorAll('.white-key')).toHaveLength(43)
    expect(document.querySelectorAll('.black-key')).toHaveLength(30)
    const black = document.querySelector<HTMLElement>('.black-key')
    expect(black?.style.height).toBe('61%')
    expect(document.body.innerHTML).not.toMatch(/buy now|learn more|sign up/i)
  })

  it('sizes the instrument to the desktop band and the narrow viewport without a second chassis', () => {
    renderApp()
    expect(css).toMatch(/94vw/)
    expect(css).toMatch(/97vw/)
    expect(css).toMatch(/3\.0951/)
    expect(css).toMatch(/54%/)
    expect(css).toMatch(/46%/)
    expect(document.querySelectorAll('.chassis')).toHaveLength(1)
  })
})
