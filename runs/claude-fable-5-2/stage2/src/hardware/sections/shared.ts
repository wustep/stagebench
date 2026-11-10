import type { Pt, SectionBuilder } from '../builder'
import type { LedColor } from '../types'

type TileFn = (x: number, y: number) => Pt

export interface LayerStripConfig {
  /** Control ID prefix, e.g. `organ`. */
  prefix: string
  /** Section name used in accessible names, e.g. `Organ`. */
  sectionName: string
  letter: 'A' | 'B' | 'C'
  /** Fader slot centre x and slot top y, in tile px. */
  x: number
  y: number
  level: number
  on: boolean
  color: LedColor
}

/**
 * One layer strip: level fader (with its LED ladder), the "A · AUX KB" row,
 * the ON/OFF pill with its LED, and the light layer button.
 * Offsets are the photo measurements shared by the Organ, Piano, and Synth strips.
 */
export function layerStrip(s: SectionBuilder, t: TileFn, config: LayerStripConfig): void {
  const { prefix, sectionName, letter, x, y, level, on, color } = config
  const lower = letter.toLowerCase()
  s.fader(`${prefix}-layer-${lower}-level`, `${sectionName} Layer ${letter} level`, t(x, y), t(x, y + 400), level)
  s.label(letter, t(x - 21, y + 437), { font: 'wide', size: 30 })
  s.label('AUX KB', t(x + 42, y + 438), { tone: 'dim', size: 27 })
  s.led(`${prefix}-layer-${lower}-aux-kb`, t(x + 103, y + 437), 'red', false)
  s.plate('light', t(x - 28, y + 462), t(x + 118, y + 499), 6)
  s.label('ON/OFF ▼', t(x + 57, y + 481), { tone: 'dark', size: 26 })
  s.toggle(
    `${prefix}-layer-${lower}`,
    `${sectionName} Layer ${letter} On/Off`,
    t(x + 40, y + 546),
    t(x - 6, y + 480),
    { look: 'light', color, initial: on ? 1 : 0 },
  )
}

/** The paired Octave Shift buttons and the four KB Zone LEDs under them. `x` is the pair centre. */
export function octaveShift(
  s: SectionBuilder,
  t: TileFn,
  prefix: string,
  sectionName: string,
  x: number,
  y: number,
  zones: readonly [boolean, boolean, boolean, boolean],
): void {
  s.label('◀ OCTAVE SHIFT ▶', t(x, y - 57))
  s.button(`${prefix}-octave-down`, `${sectionName} Octave Shift down`, t(x - 68, y))
  s.button(`${prefix}-octave-up`, `${sectionName} Octave Shift up`, t(x + 68, y))
  s.label('◀ KB ZONE ▶', t(x, y + 53))
  zones.forEach((lit, index) => {
    s.led(`${prefix}-kb-zone-${index + 1}`, t(x - 63 + index * 42, y + 88), 'green', lit)
  })
}
