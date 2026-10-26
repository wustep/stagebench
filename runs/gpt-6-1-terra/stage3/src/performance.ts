/** Pure performance calculations, independent of audio and browser timing. */
export const splitPositions = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96] as const
export type Split = { note: number; width: 0 | 6 | 12 }
/** Crossfade through an ordered set of active split points. */
export function zoneGains(note: number, splits: Split[]): number[] {
  const ordered = [...splits].sort((a, b) => a.note - b.note).slice(0, 3)
  const gains = Array(ordered.length + 1).fill(0) as number[]
  let remainder = 1
  ordered.forEach((split, i) => {
    const right = split.width === 0 ? Number(note >= split.note) : Math.max(0, Math.min(1, (note - (split.note - split.width)) / (2 * split.width)))
    gains[i] = remainder * (1 - right)
    remainder *= right
  })
  gains[ordered.length] = remainder
  return gains
}
export type MorphAssignment = { start: number; end: number }
export function morphValue(assignment: MorphAssignment, position: number) {
  const amount = Math.max(0, Math.min(1, position))
  return assignment.start + (assignment.end - assignment.start) * amount
}
export type Direction = 'Up' | 'Down' | 'Up/Down' | 'Random'
/** Fixed seed makes random ordering reproducible for a given step. */
export function arpNote(notes: number[], step: number, range: number, direction: Direction): number | undefined {
  const sorted = [...new Set(notes)].sort((a, b) => a - b)
  const expanded = Array.from({length: Math.max(1, Math.min(4, Math.floor(range)))}, (_, octave) => sorted.map(n => n + 12 * octave)).flat()
  if (!expanded.length) return undefined
  const n = expanded.length
  if (direction === 'Down') return expanded[n - 1 - (step % n)]
  if (direction === 'Up/Down') { const period = Math.max(1, 2 * n - 2); const p = step % period; return expanded[p < n ? p : period - p] }
  if (direction === 'Random') { let x = (step + 1) | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return expanded[(x >>> 0) % n] }
  return expanded[step % n]
}
