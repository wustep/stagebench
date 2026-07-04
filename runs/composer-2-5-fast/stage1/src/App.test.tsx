import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('exports the Nord Stage 4 instrument surface', () => {
    expect(App).toBeTypeOf('function')
  })
})
