/** Serializable slot storage. The caller owns the instrument snapshot. */
export type Program<T> = { name: string; state: T }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export class ProgramBank<T> {
  slots: Program<T>[]
  live: Program<T>[]
  index = 0
  liveMode = false
  current: T
  constructor(initial: T, saved?: { slots: Program<T>[]; live: Program<T>[] }) {
    this.slots = saved?.slots?.length === 32 ? copy(saved.slots) : Array.from({length: 32}, (_, i) => ({name: `Program ${i + 1}`, state: copy(initial)}))
    this.live = saved?.live?.length === 8 ? copy(saved.live) : Array.from({length: 8}, (_, i) => ({name: `Live ${i + 1}`, state: copy(initial)}))
    this.current = copy(this.slots[0].state)
  }
  get selected() { return (this.liveMode ? this.live : this.slots)[this.index] }
  get dirty() { return !this.liveMode && JSON.stringify(this.current) !== JSON.stringify(this.selected.state) }
  edit(state: T) { this.current = copy(state); if (this.liveMode) this.live[this.index].state = copy(state) }
  select(index: number) { this.index = Math.max(0, Math.min(this.liveMode ? 7 : 31, index)); this.current = copy(this.selected.state); return copy(this.current) }
  mode(live: boolean) { this.liveMode = live; return this.select(0) }
  storeTo(live: boolean, index: number, name?: string) { const list = live ? this.live : this.slots; const target = Math.max(0, Math.min(list.length - 1, index)); list[target] = {name: name?.trim() || list[target].name, state: copy(this.current)}; if (live === this.liveMode) this.index = target }
  store(index: number, name?: string) { this.storeTo(this.liveMode, index, name) }
  serialize() { return JSON.stringify({slots: this.slots, live: this.live}) }
}
