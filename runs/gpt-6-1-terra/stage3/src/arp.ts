import { arpNote, type Direction } from './performance'
export type ArpSettings = { run: boolean; hold: boolean; direction: Direction; range: number; rate: number; sync: boolean; division: number; mode: 'Arp' | 'Poly' | 'Gate' }
export const defaultArp = (): ArpSettings => ({run: false, hold: false, direction: 'Up', range: 1, rate: 120, sync: false, division: 1, mode: 'Arp'})
export type TimerBoundary = { set: (fn: () => void, milliseconds: number) => number; clear: (id: number) => void }
export class Arpeggiator {
 private held = new Map<string, number>()
 private latched = new Map<string, number>()
 private timer: number | undefined
 private step = 0
 private settings = defaultArp()
 private bpm = 120
 constructor(private play: (notes: number[]) => void, private silence: () => void, private timers: TimerBoundary = {set: (fn, ms) => window.setInterval(fn, ms), clear: id => window.clearInterval(id)}) {}
 configure(settings: ArpSettings, bpm: number) { const restart = JSON.stringify(settings) !== JSON.stringify(this.settings) || bpm !== this.bpm; this.settings = {...settings}; this.bpm = bpm; if (!settings.hold) this.latched.clear(); if (restart) this.restart() }
 on(id: string, note: number) { if (this.settings.hold && this.held.size === 0) this.latched.clear(); this.held.set(id, note); this.latched.set(id, note); if (this.settings.run && this.timer === undefined) this.restart() }
 off(id: string) { this.held.delete(id); if (!this.settings.hold) this.latched.delete(id); if (!this.latched.size) { this.silence(); this.cancel() } }
 tick() { const notes = [...this.latched.values()]; if (!notes.length) return; if (this.settings.mode === 'Arp') { const note = arpNote(notes, this.step++, this.settings.range, this.settings.direction); if (note !== undefined) this.play([note]) } else this.play(notes) }
 private cancel() { if (this.timer !== undefined) this.timers.clear(this.timer); this.timer = undefined }
 private restart() { this.cancel(); this.silence(); if (!this.settings.run || !this.latched.size) return; this.step = 0; this.tick(); const bpm = this.settings.sync ? this.bpm : this.settings.rate; this.timer = this.timers.set(() => this.tick(), 60000 / Math.max(30, bpm) * (this.settings.sync ? this.settings.division : 1)) }
 stop() { this.cancel(); this.silence(); this.held.clear(); this.latched.clear(); this.step = 0 }
}
