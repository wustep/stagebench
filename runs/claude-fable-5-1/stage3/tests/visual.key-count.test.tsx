import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InstrumentContext } from '../src/ui/context'
import { Instrument } from '../src/ui/Instrument'
import { KEYBED, STAGE_4_73, buildKeybed, isBlackMidi, keybedSummary, midiToName } from '../src/hardware/keybed'
import { createServices } from '../src/ui/createServices'
import { makeWorld, engineOptions } from './helpers'

describe('visual.key-count — Stage 4 73 keybed', () => {
  it('models exactly 73 keys from E1 to E7 with 43 white and 30 black keys', () => {
    const summary = keybedSummary()
    expect(summary).toEqual({ total: 73, white: 43, black: 30, lowest: 'E1', highest: 'E7' })
    expect(KEYBED[0].midi).toBe(28)
    expect(KEYBED[KEYBED.length - 1].midi).toBe(100)
    expect(STAGE_4_73.range).toBe('E to E')
    expect(STAGE_4_73.keyAction).toBe('hammer action')
  })

  it('follows the white/black pattern of a real keyboard and names keys scientifically', () => {
    for (const key of KEYBED) {
      expect(key.color).toBe(isBlackMidi(key.midi) ? 'black' : 'white')
      expect(key.name).toBe(midiToName(key.midi))
    }
    expect(midiToName(60)).toBe('C4')
    expect(midiToName(28)).toBe('E1')
    expect(midiToName(100)).toBe('E7')
    // Two black keys never touch: every black key sits between two white keys.
    for (const b of KEYBED.filter((k) => k.color === 'black')) {
      expect(isBlackMidi(b.midi - 1)).toBe(false)
      expect(isBlackMidi(b.midi + 1)).toBe(false)
    }
  })

  it('tiles the white keys across the full keybed width and shortens black keys to the spec fraction', () => {
    const whites = KEYBED.filter((k) => k.color === 'white')
    const pitch = 100 / 43
    whites.forEach((k, i) => {
      expect(k.x).toBeCloseTo(i * pitch, 6)
      expect(k.w).toBeCloseTo(pitch, 6)
      expect(k.h).toBe(100)
    })
    expect(whites[whites.length - 1].x + whites[whites.length - 1].w).toBeCloseTo(100, 6)
    for (const b of KEYBED.filter((k) => k.color === 'black')) {
      expect(b.h).toBeCloseTo(STAGE_4_73.blackKeyHeightFraction * 100, 6)
      expect(b.w).toBeLessThan(pitch)
      expect(b.x).toBeGreaterThan(0)
      expect(b.x + b.w).toBeLessThan(100)
      const boundary = (b.whiteIndex + 1) * pitch
      expect(b.x).toBeLessThan(boundary)
      expect(b.x + b.w).toBeGreaterThan(boundary)
    }
    expect(new Set(KEYBED.map((k) => k.id)).size).toBe(73)
    expect(buildKeybed()).toEqual(KEYBED)
  })

  it('renders every key once with a stable id, note name and colour, in ascending order', () => {
    const services = createServices(makeWorld().boundaries, engineOptions)
    const { container } = render(
      <InstrumentContext.Provider value={services}>
        <Instrument />
      </InstrumentContext.Provider>,
    )
    const keys = [...container.querySelectorAll('.key')] as HTMLElement[]
    expect(keys).toHaveLength(73)
    expect(container.querySelector('#keys')?.getAttribute('data-key-count')).toBe('73')
    const midis = keys.map((k) => Number(k.dataset.midi))
    expect(midis).toEqual(KEYBED.map((k) => k.midi))
    expect(keys.filter((k) => k.dataset.color === 'white')).toHaveLength(43)
    expect(keys.filter((k) => k.dataset.color === 'black')).toHaveLength(30)
    for (const key of keys) {
      const spec = KEYBED.find((k) => k.midi === Number(key.dataset.midi))!
      expect(key.id).toBe(spec.id)
      expect(key.getAttribute('aria-label')).toBe(`Key ${spec.name}`)
      expect(key.style.left).toBe(`${spec.x}%`)
      expect(key.style.width).toBe(`${spec.w}%`)
      expect(key.style.height).toBe(`${spec.h}%`)
    }
    // the keybed sits inside the instrument, under the deck
    const instrument = container.querySelector('#instrument')!
    expect(instrument.contains(container.querySelector('#keybed'))).toBe(true)
    expect(instrument.querySelector('#deck')!.compareDocumentPosition(instrument.querySelector('#keybed')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
