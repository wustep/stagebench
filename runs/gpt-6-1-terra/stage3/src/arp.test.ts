import { expect, it } from 'vitest'
import { Arpeggiator, defaultArp } from './arp'
it('steps in order on an injected clock and releases its timer', () => {
 let tick = () => {}; let cleared = 0; const heard: number[][] = []
 const arp = new Arpeggiator(n => heard.push(n), () => {}, {set: fn => {tick = fn; return 7}, clear: () => {cleared++}})
 arp.configure({...defaultArp(), run: true}, 120); arp.on('a', 60); arp.on('b', 64); tick(); tick(); expect(heard).toEqual([[60], [64], [60]])
 arp.off('a'); arp.off('b'); expect(cleared).toBe(1); arp.stop()
})
