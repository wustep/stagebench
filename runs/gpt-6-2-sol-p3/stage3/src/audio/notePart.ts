export interface NotePart {
  keyUp(pedal: boolean): boolean
  setPedal?(enabled: boolean): void
  isSustained(): boolean
  release(seconds?: number): void
  stop(): void
}
