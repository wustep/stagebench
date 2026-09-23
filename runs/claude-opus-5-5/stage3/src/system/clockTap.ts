// Master Clock tap tempo (programs spec clockAndPerformance.masterClock): four or more taps set the
// tempo from the average of the recent intervals; a pause longer than 2 s starts a new tap run.

export const BPM_MIN = 30
export const BPM_MAX = 300
const MAX_GAP_MS = 2000
const MIN_TAPS = 4

export class ClockTap {
  private taps: number[] = []

  /** Register a tap at `nowMs`; returns the new BPM once four or more taps agree, else null. */
  tap(nowMs: number): number | null {
    const last = this.taps[this.taps.length - 1]
    if (last !== undefined && nowMs - last > MAX_GAP_MS) this.taps = []
    this.taps.push(nowMs)
    if (this.taps.length > 8) this.taps.shift()
    if (this.taps.length < MIN_TAPS) return null
    const intervals: number[] = []
    for (let i = 1; i < this.taps.length; i++) intervals.push(this.taps[i] - this.taps[i - 1])
    const recent = intervals.slice(-3)
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length
    // Taps faster than 300 BPM are not a tempo (e.g. an accidental burst): ignored, not clamped.
    if (mean < 60000 / BPM_MAX) return null
    return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(60000 / mean)))
  }

  reset(): void {
    this.taps = []
  }
}
