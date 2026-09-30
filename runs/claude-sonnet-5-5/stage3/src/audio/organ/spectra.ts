/**
 * Organ spectra: pure functions from (model, drawbars) to a harmonic series of the 16' fundamental (the pitch one octave below the
 * played key, so the 8' partial IS the played pitch). One PeriodicWave per note reproduces every registration exactly.
 *
 *  B3       nine sine partials at 16' 5⅓' 8' 4' 2⅔' 2' 1⅗' 1⅓' 1' (tonewheels), levels from the drawbars (3 dB per step)
 *  B3 Bass  the same with only the 16' and 8' drawbars
 *  Vox      seven register partials built from thin, hollow square waves (odd harmonics), then two mix drawbars that
 *           blend a dark (low-passed) and a bright (unfiltered) path
 *  Farf     nine register switches (on when pulled past half); each switch is a fixed spectrum: flutes, strings, reeds, brilliant
 *  Pipe 1   nine flue-pipe ranks 16'…1' plus a mixture: each rank is a principal spectrum with a natural harmonic roll-off
 *  Pipe 2   the same ranks with a brighter principal spectrum
 */
import { B3_PARTIALS, PIPE_PARTIALS, VOX_PARTIALS, drawbarActive, drawbarGain, farfSwitchOn, type OrganModel } from '../../engine/organ'

/** harmonics above this frequency are dropped (the browser also band-limits, this keeps the tests deterministic too) */
export const MAX_PARTIAL_HZ = 15000
export const MAX_HARMONIC = 96

export type Spectrum = Float32Array // index = harmonic number of the 16' fundamental (0 unused)

const add = (spec: Spectrum, harmonic: number, amp: number, baseHz: number) => {
  if (harmonic < 1 || harmonic > MAX_HARMONIC || amp === 0) return
  if (harmonic * baseHz > MAX_PARTIAL_HZ) return
  spec[harmonic] += amp
}

/** a register of `partial` (multiple of the 16' fundamental) with its own overtones h·partial and amplitudes shape(h) */
const addRegister = (spec: Spectrum, baseHz: number, partial: number, level: number, shape: Array<[number, number]>) => {
  for (const [h, a] of shape) add(spec, partial * h, level * a, baseHz)
}

const SINE: Array<[number, number]> = [[1, 1]]
/** hollow square-ish register: odd harmonics 1/h */
const SQUARE_SHAPE: Array<[number, number]> = [1, 3, 5, 7, 9, 11].map((h) => [h, 1 / h])
const principal = (exponent: number, count: number): Array<[number, number]> => Array.from({ length: count }, (_, i) => [i + 1, Math.pow(i + 1, -exponent)] as [number, number])

const FARF_REGISTERS: Array<{ partial: number; level: number; shape: Array<[number, number]> }> = [
  { partial: 1, level: 0.9, shape: [[1, 1], [2, 0.18]] }, // 16' bass
  { partial: 2, level: 0.8, shape: [[1, 1], [3, 0.3]] }, // 8' flute
  { partial: 4, level: 0.7, shape: [[1, 1], [2, 0.16]] }, // 4' flute
  { partial: 8, level: 0.55, shape: SINE }, // 2' flute
  { partial: 2, level: 0.45, shape: principal(0.8, 12) }, // strings 8'
  { partial: 2, level: 0.5, shape: [[1, 0.3], [3, 0.9], [5, 1], [7, 0.8], [9, 0.4], [11, 0.2]] }, // oboe: nasal odd formant
  { partial: 2, level: 0.42, shape: [[1, 0.6], [2, 1], [3, 0.9], [4, 0.7], [5, 0.5], [6, 0.3]] }, // trumpet
  { partial: 4, level: 0.34, shape: principal(0.45, 16) }, // brilliant
  { partial: 1, level: 0.5, shape: SQUARE_SHAPE }, // bass
]

/** which per-model mix drawbars exist (Vox filtered/unfiltered) */
export interface VoxMix {
  filtered: number
  unfiltered: number
}
export const voxMix = (drawbars: readonly number[]): VoxMix => ({ filtered: drawbarGain(drawbars[7] ?? 0), unfiltered: drawbarGain(drawbars[8] ?? 0) })

/** harmonic amplitudes of the 16' fundamental (sine components) for a registration */
export function organSpectrum(model: OrganModel, drawbars: readonly number[], baseHz: number): Spectrum {
  const spec: Spectrum = new Float32Array(MAX_HARMONIC + 1)
  switch (model) {
    case 'B3':
    case 'B3 Bass':
      B3_PARTIALS.forEach((partial, i) => {
        if (drawbarActive(model, i)) addRegister(spec, baseHz, partial, drawbarGain(drawbars[i] ?? 0), SINE)
      })
      break
    case 'Vox':
      VOX_PARTIALS.forEach((partial, i) => addRegister(spec, baseHz, partial, drawbarGain(drawbars[i] ?? 0), SQUARE_SHAPE))
      break
    case 'Farf':
      FARF_REGISTERS.forEach((reg, i) => {
        if (farfSwitchOn(drawbars[i] ?? 0)) addRegister(spec, baseHz, reg.partial, reg.level, reg.shape)
      })
      break
    case 'Pipe 1':
    case 'Pipe 2': {
      const bright = model === 'Pipe 2'
      PIPE_PARTIALS.forEach((partial, i) => {
        const level = drawbarGain(drawbars[i] ?? 0)
        if (i === 8) {
          // mixture rank: three quint/tierce-like pipes sounding together
          for (const p of [8, 10, 12]) addRegister(spec, baseHz, p, level * 0.6, principal(bright ? 0.9 : 1.4, 3))
        } else {
          addRegister(spec, baseHz, partial, level, principal(bright ? 0.75 : 1.5, bright ? 10 : 7))
        }
      })
      break
    }
  }
  return spec
}

/** sum of amplitudes: an upper bound of the waveform peak, used for headroom */
export const spectrumPeak = (spec: Spectrum): number => spec.reduce((a, b) => a + Math.abs(b), 0)
export const spectrumPower = (spec: Spectrum): number => Math.sqrt(spec.reduce((a, b) => a + b * b, 0) / 2)

/** stable text key for caching periodic waves */
export const spectrumKey = (model: OrganModel, drawbars: readonly number[]): string =>
  `${model}:${(model === 'Farf' ? drawbars.map((d) => (farfSwitchOn(d) ? 1 : 0)) : drawbars.map((d) => Math.round(d))).join('')}`
