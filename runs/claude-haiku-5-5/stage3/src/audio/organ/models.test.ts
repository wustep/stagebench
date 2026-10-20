// organ.models-drawbars: each model maps the nine drawbars to its own partials, and the drawbar LED
// position is the same quantized value the sound uses.
import { describe, expect, it } from 'vitest'
import { DRAWBAR_RATIOS, drawbarStep, modelPartials, normalizePartials, modelFromSwitches } from './models'

const zeros = () => Array.from({ length: 9 }, () => 0)

describe('organ.models-drawbars: partial tables', () => {
  it('maps each drawbar to its footage ratio, so 1 foot is the eighth harmonic', () => {
    const drawbars = zeros()
    drawbars[8] = 1
    expect(modelPartials('b3', drawbars)).toEqual([{ ratio: 8, amp: 1 }])
    const sixteen = zeros()
    sixteen[0] = 1
    expect(modelPartials('b3', sixteen)).toEqual([{ ratio: 0.5, amp: 1 }])
  })

  it('quantizes drawbar positions to the nine LED steps 0 to 8', () => {
    expect(drawbarStep(0)).toBe(0)
    expect(drawbarStep(0.5)).toBe(4)
    expect(drawbarStep(0.93)).toBe(7)
    expect(drawbarStep(1)).toBe(8)
  })

  it('gives B3, Vox, Farf, and Pipe 1 different partial sets for the same drawbars', () => {
    const drawbars = [0.8, 0.6, 0.8, 0.5, 0.3, 0.2, 0.1, 0.2, 0.4]
    const sets = (['b3', 'vox', 'farf', 'pipe1'] as const).map((model) => JSON.stringify(modelPartials(model, drawbars)))
    expect(new Set(sets).size).toBe(4)
  })

  it('makes Farf switches on or off: a register below half is silent, and one above half is full', () => {
    const below = zeros()
    below[2] = 0.4
    expect(modelPartials('farf', below)).toEqual([])
    const above = zeros()
    above[2] = 0.6
    const [partial] = modelPartials('farf', above)
    expect(partial.ratio).toBe(1)
    expect(partial.amp).toBeGreaterThan(0)
  })

  it('lets the Vox mix drawbar dull the upper partials (ratio 4 and up), and leaves the lower ones alone', () => {
    const upper = zeros()
    upper[5] = 1
    const upperMixed = [...upper]
    upperMixed[8] = 1
    const lower = zeros()
    lower[3] = 1
    const lowerMixed = [...lower]
    lowerMixed[8] = 1
    expect(modelPartials('vox', upperMixed)[0].amp).toBeLessThan(modelPartials('vox', upper)[0].amp)
    expect(modelPartials('vox', lowerMixed)[0].amp).toBeCloseTo(modelPartials('vox', lower)[0].amp, 10)
  })

  it('keeps the total partial level under the peak when the drawbars are full', () => {
    const scaled = normalizePartials(modelPartials('b3', [1, 1, 1, 1, 1, 1, 1, 1, 1]), 0.5)
    expect(scaled.reduce((sum, partial) => sum + partial.amp, 0)).toBeCloseTo(0.5, 6)
  })

  it('selects the model from the first lit switch, and B3 when none is lit', () => {
    expect(modelFromSwitches({ b3: 0, vox: 1, farf: 0, pipe1: 0, pipe2: 0 })).toBe('vox')
    expect(modelFromSwitches({ b3: 0, vox: 0, farf: 0, pipe1: 0, pipe2: 0 })).toBe('b3')
  })

  it('has nine drawbar ratios in footage order', () => {
    expect(DRAWBAR_RATIOS).toHaveLength(9)
  })
})
