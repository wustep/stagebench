import { describe, expect, it } from 'vitest'
import { MorphMatrix } from './Morph'

describe('morph assignments', () => {
  it('assigns and interpolates multiple bounded destinations', () => {
    const morphs = new MorphMatrix()
    morphs.assign({ source: 'wheel', target: 'synth.filter', from: 20, to: 90, min: 0, max: 100 })
    morphs.assign({ source: 'wheel', target: 'organ.drawbar.1', from: 8, to: 0, min: 0, max: 8 })
    expect(morphs.values('wheel', 0.5)).toEqual({ 'synth.filter': 55, 'organ.drawbar.1': 4 })
    expect(morphs.values('wheel', 3)['synth.filter']).toBe(90)
  })

  it('replaces a destination assignment and removes it cleanly', () => {
    const morphs = new MorphMatrix()
    morphs.assign({ source: 'aftertouch', target: 'reverb.mix', from: 0, to: 1, min: 0, max: 1 })
    morphs.assign({ source: 'aftertouch', target: 'reverb.mix', from: 0.2, to: 0.8, min: 0, max: 1 })
    expect(morphs.snapshot()).toHaveLength(1)
    expect(morphs.remove('aftertouch', 'reverb.mix')).toBe(true)
    expect(morphs.values('aftertouch', 1)).toEqual({})
  })
})
