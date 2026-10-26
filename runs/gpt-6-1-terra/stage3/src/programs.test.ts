import { describe, expect, it } from 'vitest'
import { ProgramBank } from './programs'
describe('program bank', () => {
 it('stores independent snapshots, reports dirty and discards edits on selection', () => {
  const bank = new ProgramBank({layers: [1, 2], tempo: 120})
  bank.edit({layers: [3, 4], tempo: 90}); expect(bank.dirty).toBe(true)
  bank.store(31, 'Test'); expect(bank.dirty).toBe(false)
  bank.edit({layers: [5, 6], tempo: 110}); bank.select(0)
  expect(bank.select(31)).toEqual({layers: [3, 4], tempo: 90})
  expect(bank.selected.name).toBe('Test')
 })
 it('auto-stores live edits and round trips the bank', () => {
  const bank = new ProgramBank({value: 0}); bank.mode(true); bank.select(7); bank.edit({value: 9})
  const restored = new ProgramBank({value: 0}, JSON.parse(bank.serialize()))
  restored.mode(true); expect(restored.select(7)).toEqual({value: 9}); expect(restored.dirty).toBe(false)
 })
})
it('round-trips every regular and live slot independently', () => {
 const bank = new ProgramBank({organ: {drawbars: [0, 1]}, synth: {filter: 'LP12'}, split: [60], scene: 0, effects: {delay: 0}})
 for (let i = 0; i < 32; i++) { bank.edit({organ: {drawbars: [i, i + 1]}, synth: {filter: `filter${i}`}, split: [i], scene: i % 2, effects: {delay: i}}); bank.store(i, `Slot ${i}`) }
 for (let i = 0; i < 32; i++) expect(bank.select(i).organ.drawbars).toEqual([i, i + 1])
 bank.mode(true)
 for (let i = 0; i < 8; i++) { bank.select(i); bank.edit({organ: {drawbars: [i, 0]}, synth: {filter: 'Live'}, split: [], scene: 1, effects: {delay: i}}) }
 const reloaded = new ProgramBank(bank.current, JSON.parse(bank.serialize())); reloaded.mode(true)
 for (let i = 0; i < 8; i++) expect(reloaded.select(i).effects.delay).toBe(i)
})
