// Organ models: how the nine drawbars become partials. Each model has its own spectral rule, so the
// four engines are distinct, not one oscillator with different names.
//
//   B3       tonewheel: a sine per drawbar, level linear in the drawbar position, percussion and key click.
//   Vox      transistor: seven flat partials (a bright, even spectrum), and the ninth drawbar dulls the upper ones.
//   Farf     transistor switches: a register is on when its drawbar is pulled past half; on registers
//            are odd-weighted, so the spectrum has the square-wave hollowness of a Farfisa.
//   Pipe 1   pipe ranks: an amplitude of 1/ratio per rank (a sawtooth-like series), 16' to 1'.
//   Pipe 2   the same pipe rule with a brighter principal slope (1/ratio^0.7). It reuses the Pipe 1 engine.

export type OrganModel = 'b3' | 'vox' | 'farf' | 'pipe1' | 'pipe2'

/** Frequency ratio of each drawbar to the played pitch, in drawbar order: 16' 5⅓' 8' 4' 2⅔' 2' 1⅗' 1⅓' 1'. */
export const DRAWBAR_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8] as const

/** Vox uses seven partials on its first seven drawbars; these are their ratios in drawbar order. */
const VOX_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5] as const

export interface Partial {
  /** Multiple of the played frequency. */
  ratio: number
  /** Amplitude, 0..1 before the overall normalization. */
  amp: number
}

/** A drawbar's 0..8 position, quantized as the panel's LED ladder shows it. */
export function drawbarStep(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 8)
}

/** The partials a model makes from nine drawbar values (0..1). Zero-amplitude partials are dropped. */
export function modelPartials(model: OrganModel, drawbars: readonly number[]): Partial[] {
  const steps = drawbars.map((value) => drawbarStep(value) / 8)
  const partials: Partial[] = []
  switch (model) {
    case 'b3':
      DRAWBAR_RATIOS.forEach((ratio, index) => partials.push({ ratio, amp: steps[index] }))
      break
    case 'vox': {
      const mix = steps[8]
      // Flat across the partials: the transistor's bright, even spectrum, which the pipe's falling slope is not.
      VOX_RATIOS.forEach((ratio, index) => {
        const dull = ratio >= 3 ? 1 - 0.7 * mix : 1
        partials.push({ ratio, amp: steps[index] * dull })
      })
      break
    }
    case 'farf':
      DRAWBAR_RATIOS.forEach((ratio, index) => {
        const on = drawbars[index] >= 0.5
        const oddWeight = Math.round(ratio) % 2 === 1 ? 1 : 0.35
        partials.push({ ratio, amp: on ? oddWeight / Math.max(1, ratio) : 0 })
      })
      break
    case 'pipe1':
      DRAWBAR_RATIOS.forEach((ratio, index) => partials.push({ ratio, amp: steps[index] / Math.max(1, ratio) }))
      break
    case 'pipe2':
      DRAWBAR_RATIOS.forEach((ratio, index) => partials.push({ ratio, amp: steps[index] / Math.pow(Math.max(1, ratio), 0.7) }))
      break
  }
  return partials.filter((partial) => partial.amp > 1e-6)
}

/**
 * Scales partial amplitudes so their sum is at most `peak`. A partial set that is all zero stays silent.
 * The normalization keeps loud registrations from clipping while leaving their relative balance intact.
 */
export function normalizePartials(partials: readonly Partial[], peak: number): Partial[] {
  const total = partials.reduce((sum, partial) => sum + partial.amp, 0)
  if (total <= peak) return [...partials]
  const scale = peak / total
  return partials.map((partial) => ({ ratio: partial.ratio, amp: partial.amp * scale }))
}

export const ORGAN_MODELS: readonly OrganModel[] = ['b3', 'vox', 'farf', 'pipe1', 'pipe2']

/** The model a set of organ model switches selects: the first lit switch, B3 by default. */
export function modelFromSwitches(switches: Readonly<Record<OrganModel, number>>): OrganModel {
  return ORGAN_MODELS.find((model) => (switches[model] ?? 0) >= 0.5) ?? 'b3'
}
