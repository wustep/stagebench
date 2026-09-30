/** Small line graphics for the Synth display: one cycle of the selected waveform and an envelope curve. Pure geometry. */
import { decayIsSustain, envSeconds, oscCtrlDisplay, type WaveformInfo } from '../engine/synth'

const W = 60
const H = 14

const saw = (t: number) => 2 * (t - Math.floor(t)) - 1
const tri = (t: number) => 1 - 4 * Math.abs(Math.round(t - 0.25) - (t - 0.25))
const sqr = (t: number, duty = 0.5) => (t - Math.floor(t) < duty ? 1 : -1)

/** deterministic pseudo noise */
const noise = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return 2 * (x - Math.floor(x)) - 1
}

/** y in -1..1 for phase t (one cycle = 0..1) and Osc Ctrl 0..1 */
export function waveSample(wave: WaveformInfo, t: number, ctrl: number, i: number): number {
  switch (wave.id) {
    case 'sine':
      return Math.sin(2 * Math.PI * t)
    case 'triangle':
      return tri(t)
    case 'saw':
      return saw(t)
    case 'square':
      return sqr(t)
    case 'pulse33':
      return sqr(t, 0.33)
    case 'pulse10':
      return sqr(t, 0.1)
    case 'noise':
      return noise(i)
    case 'sync-saw':
      return saw(t * (1 + ctrl * 4))
    case 'sync-square':
      return sqr(t * (1 + ctrl * 4))
    case 'multi-saw':
      return (saw(t) + saw(t * (1 + ctrl * 0.06)) + saw(t * (1 - ctrl * 0.06))) / 3
    case 'multi-saw-8ve':
      return (saw(t) + saw(t * 2 * (1 + ctrl * 0.03)) + saw(t * 4)) / 2.2
    case 'super-saw':
      return (saw(t) + saw(t * (1 + ctrl * 0.1)) + saw(t * (1 - ctrl * 0.1)) + saw(t * (1 + ctrl * 0.05))) / 3
    case 'super-square':
      return (sqr(t) + sqr(t * (1 + ctrl * 0.1)) + sqr(t * (1 - ctrl * 0.1))) / 2.4
    case 'fm-2op':
      return Math.sin(2 * Math.PI * t + ctrl * 8 * Math.sin(4 * Math.PI * t))
    default:
      return 0
  }
}

/** SVG points for one cycle of the waveform in a 60 x 14 box */
export function waveformPoints(wave: WaveformInfo, ctrl: number): string {
  const n = 96
  const pts: string[] = []
  for (let i = 0; i <= n; i++) {
    const y = Math.max(-1, Math.min(1, waveSample(wave, i / n, ctrl, i)))
    pts.push(`${((i / n) * W).toFixed(1)},${(H / 2 - y * (H / 2 - 1)).toFixed(1)}`)
  }
  return pts.join(' ')
}

/** SVG points for an attack-decay-release envelope (decay at maximum = sustain) */
export function envelopePoints(attack: number, decay: number, release: number): string {
  const a = envSeconds(attack)
  const d = envSeconds(decay)
  const r = envSeconds(release)
  const sustain = decayIsSustain(decay)
  const hold = 0.35 // the key stays down for a fixed slice of the picture
  const total = a + (sustain ? hold * (a + d + r) : d) + r
  const x = (t: number) => ((t / total) * W).toFixed(1)
  const y = (v: number) => (H - 1 - v * (H - 2)).toFixed(1)
  const pts = [`0,${y(0)}`, `${x(a)},${y(1)}`]
  if (sustain) {
    pts.push(`${x(a + hold * (a + d + r))},${y(1)}`)
    pts.push(`${x(a + hold * (a + d + r) + r)},${y(0)}`)
  } else {
    pts.push(`${x(a + d)},${y(0.02)}`)
    pts.push(`${x(a + d + r)},${y(0)}`)
  }
  return pts.join(' ')
}

export const oscCtrlText = (v: number): string => oscCtrlDisplay(v).toFixed(1)
