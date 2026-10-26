import { describe, expect, it } from 'vitest'
import { arpNote, morphValue, splitPositions, zoneGains } from './performance'
describe('performance calculations', () => {
 it('routes notes through split points and crossfades', () => {
  expect(splitPositions).toHaveLength(11)
  expect(zoneGains(59, [{note: 60, width: 0}])).toEqual([1, 0])
  expect(zoneGains(60, [{note: 60, width: 0}])).toEqual([0, 1])
  expect(zoneGains(60, [{note: 60, width: 6}])).toEqual([.5, .5])
  expect(zoneGains(48, [{note: 48, width: 12}, {note: 72, width: 0}])).toEqual([.5, .5, 0])
 })
 it('interpolates in both directions and clamps source', () => {
  expect(morphValue({start: 10, end: 2}, .25)).toBe(8)
  expect(morphValue({start: 0, end: 10}, 2)).toBe(10)
 })
 it('produces deterministic ordered arpeggios', () => {
  expect(Array.from({length: 6}, (_, i) => arpNote([64, 60, 67], i, 1, 'Up/Down'))).toEqual([60, 64, 67, 64, 60, 64])
  expect(arpNote([60, 64], 9, 2, 'Random')).toBe(arpNote([60, 64], 9, 2, 'Random'))
 })
})
