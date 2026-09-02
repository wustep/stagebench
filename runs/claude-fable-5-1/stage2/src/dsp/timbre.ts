/**
 * Piano TIMBRE (manual p. 26): fixed EQ curves per family.
 *  acoustic — Soft: −6 dB high shelf @ 3 kHz + 2 dB low shelf @ 150 Hz (subdued, intimate);
 *             Mid: −3 dB shelves @ 200 Hz / 5 kHz + 4 dB peak @ 1.2 kHz (focused, cutting mid-range);
 *             Bright: +5 dB high shelf @ 3 kHz + 2 dB peak @ 6 kHz.
 *  electric — Soft: −6 dB high shelf @ 2.5 kHz (less bell); Mid: +4 dB peak @ 1.8 kHz (presence);
 *             Bright: +3 dB peak @ 2.5 kHz + 4 dB high shelf @ 5 kHz; Dyno 1: +6 dB bell @ 3.5 kHz, −2 dB @ 500 Hz;
 *             Dyno 2: Dyno 1 + 4 dB low shelf @ 120 Hz − 4 dB @ 800 Hz (mid-scooped preamp/EQ emulation).
 * Off is an exact pass-through; the acoustic family treats the Dyno settings as Off. Setting changes fade over 5 ms.
 */
import { clamp, type StereoProcessor, type TimbreParams } from './types'
import { Biquad, SwitchFade } from './util'

interface Stage {
  kind: 'peak' | 'lowShelf' | 'highShelf'
  f: number
  db: number
  q?: number
}

const ACOUSTIC: Stage[][] = [
  [],
  [
    { kind: 'highShelf', f: 3000, db: -6 },
    { kind: 'lowShelf', f: 150, db: 2 },
  ],
  [
    { kind: 'lowShelf', f: 200, db: -3 },
    { kind: 'highShelf', f: 5000, db: -3 },
    { kind: 'peak', f: 1200, db: 4, q: 1 },
  ],
  [
    { kind: 'highShelf', f: 3000, db: 5 },
    { kind: 'peak', f: 6000, db: 2, q: 1 },
  ],
]

const ELECTRIC: Stage[][] = [
  [],
  [{ kind: 'highShelf', f: 2500, db: -6 }],
  [{ kind: 'peak', f: 1800, db: 4, q: 1 }],
  [
    { kind: 'peak', f: 2500, db: 3, q: 1 },
    { kind: 'highShelf', f: 5000, db: 4 },
  ],
  [
    { kind: 'peak', f: 3500, db: 6, q: 1.2 },
    { kind: 'peak', f: 500, db: -2, q: 1 },
  ],
  [
    { kind: 'peak', f: 3500, db: 6, q: 1.2 },
    { kind: 'peak', f: 500, db: -2, q: 1 },
    { kind: 'lowShelf', f: 120, db: 4 },
    { kind: 'peak', f: 800, db: -4, q: 1 },
  ],
]

export const MAX_TIMBRE_STAGES = 4

/** The setting that is actually applied: acoustic pianos have no Dyno settings. */
export function effectiveTimbreSetting(family: TimbreParams['family'], setting: number): number {
  const s = clamp(Math.round(setting), 0, 5)
  return family === 'acoustic' && s > 3 ? 0 : s
}

export class TimbreUnit implements StereoProcessor {
  private readonly l: Biquad[] = []
  private readonly r: Biquad[] = []
  private count = 0
  private family: TimbreParams['family'] = 'acoustic'
  private setting = 0
  private reqFamily: TimbreParams['family'] = 'acoustic'
  private reqSetting = 0
  private started = false
  private readonly fade: SwitchFade

  constructor(private readonly sr: number) {
    for (let i = 0; i < MAX_TIMBRE_STAGES; i++) {
      this.l.push(new Biquad())
      this.r.push(new Biquad())
    }
    this.fade = new SwitchFade(sr, 2.5)
  }

  /** Setting currently processing (after any pending fade). */
  get activeSetting() {
    return this.setting
  }

  get activeFamily() {
    return this.family
  }

  /** True when the unit is an exact pass-through (Off, no fade pending). */
  get idle() {
    return this.fade.idle && this.count === 0
  }

  setParams(p: TimbreParams) {
    const s = effectiveTimbreSetting(p.family, p.setting)
    if (s === this.reqSetting && p.family === this.reqFamily) return
    this.reqFamily = p.family
    this.reqSetting = s
    if (!this.started) this.configure(p.family, s)
    else this.fade.request(() => this.configure(p.family, s))
  }

  private configure(family: TimbreParams['family'], s: number) {
    const stages = (family === 'electric' ? ELECTRIC : ACOUSTIC)[s] ?? []
    for (let i = 0; i < MAX_TIMBRE_STAGES; i++) {
      const st = stages[i]
      const a = this.l[i]
      if (!st) a.identity()
      else if (st.kind === 'peak') a.peaking(this.sr, st.f, st.q ?? 1, st.db)
      else if (st.kind === 'lowShelf') a.lowShelf(this.sr, st.f, st.db)
      else a.highShelf(this.sr, st.f, st.db)
      a.reset()
      this.r[i].copyFrom(a)
      this.r[i].reset()
    }
    this.count = stages.length
    this.family = family
    this.setting = s
  }

  process(l: Float32Array, r: Float32Array, n: number) {
    this.started = true
    if (this.fade.idle && this.count === 0) return
    for (let i = 0; i < n; i++) {
      const g = this.fade.next()
      if (this.count === 0) continue
      const xl = l[i]
      const xr = r[i]
      let yl = xl
      let yr = xr
      for (let k = 0; k < this.count; k++) {
        yl = this.l[k].process(yl)
        yr = this.r[k].process(yr)
      }
      if (g === 1) {
        l[i] = yl
        r[i] = yr
      } else {
        l[i] = xl + (yl - xl) * g
        r[i] = xr + (yr - xr) * g
      }
    }
  }

  reset() {
    for (const b of this.l) b.reset()
    for (const b of this.r) b.reset()
    this.fade.reset()
  }
}
