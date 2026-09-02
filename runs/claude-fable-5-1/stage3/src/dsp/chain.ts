/**
 * One layer's effect chain in the documented signal order (specs/nord-stage-4.effects.json `requiredOrder`):
 * Timbre EQ → String Res → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb.
 * Every unit has a click-free bypass: switching a unit on or off cross-fades (equal power, 10 ms) between its input
 * and its output, a unit keeps running until its fade-out completes (delay and reverb tails fade with it) and is then
 * reset so that re-enabling starts clean. Layer Effects ON = false bypasses Mod 1 … Reverb together; Timbre and
 * String Res are piano-section features and stay active. A fully bypassed chain is bit-transparent.
 */
import { AmpEqUnit } from './ampEq'
import { CompressorUnit } from './compressor'
import { DelayUnit } from './delay'
import { Mod1Unit } from './mod1'
import { Mod2Unit } from './mod2'
import { ReverbUnit } from './reverb'
import { StringResUnit } from './stringRes'
import { TimbreUnit } from './timbre'
import { defaultChainParams, type ChainParams, type StereoProcessor } from './types'
import { HALF_PI } from './util'

export const CHAIN_ORDER = ['timbre', 'stringRes', 'mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'] as const
export type ChainUnitName = (typeof CHAIN_ORDER)[number]

export interface ChainUnits {
  timbre: TimbreUnit
  stringRes: StringResUnit
  mod1: Mod1Unit
  mod2: Mod2Unit
  delay: DelayUnit
  ampEq: AmpEqUnit
  compressor: CompressorUnit
  reverb: ReverbUnit
}

interface Slot {
  name: ChainUnitName
  unit: StereoProcessor
  /** Bypass cross-fade position: 0 = bypassed (unit idle), 1 = fully on. */
  gain: number
  target: 0 | 1
}

export const BYPASS_FADE_MS = 10

export class LayerChain implements StereoProcessor {
  readonly order = CHAIN_ORDER
  private readonly units: ChainUnits
  private readonly slots: Slot[]
  private params: ChainParams
  private readonly fadeStep: number
  private wl = new Float32Array(128)
  private wr = new Float32Array(128)
  private started = false

  constructor(readonly sampleRate: number) {
    this.units = {
      timbre: new TimbreUnit(sampleRate),
      stringRes: new StringResUnit(sampleRate),
      mod1: new Mod1Unit(sampleRate),
      mod2: new Mod2Unit(sampleRate),
      delay: new DelayUnit(sampleRate),
      ampEq: new AmpEqUnit(sampleRate),
      compressor: new CompressorUnit(sampleRate),
      reverb: new ReverbUnit(sampleRate),
    }
    this.slots = CHAIN_ORDER.map((name) => ({ name, unit: this.units[name], gain: 0, target: 0 as const }))
    this.fadeStep = 1 / Math.max(1, Math.round((BYPASS_FADE_MS / 1000) * sampleRate))
    this.params = defaultChainParams()
    this.push(this.params)
    for (const s of this.slots) s.gain = s.target
  }

  unit<K extends ChainUnitName>(name: K): ChainUnits[K] {
    return this.units[name]
  }

  /** Current parameters (the last object passed to setParams). */
  get current(): ChainParams {
    return this.params
  }

  /** Bypass cross-fade position of a unit (0 = bypassed, 1 = on). */
  bypassGain(name: ChainUnitName): number {
    return this.slots.find((s) => s.name === name)?.gain ?? 0
  }

  /** True when every unit is fully bypassed and idle, so process() leaves the audio untouched. */
  get transparent(): boolean {
    return this.slots.every((s) => (s.name === 'timbre' ? this.units.timbre.idle : s.gain === 0 && s.target === 0))
  }

  private targetFor(name: ChainUnitName, p: ChainParams): 0 | 1 {
    switch (name) {
      case 'timbre':
        return 1
      case 'stringRes':
        return p.stringRes.on ? 1 : 0
      default:
        return p.effectsOn && p[name].on ? 1 : 0
    }
  }

  private push(p: ChainParams) {
    this.units.timbre.setParams(p.timbre)
    this.units.stringRes.setParams(p.stringRes)
    this.units.mod1.setParams(p.mod1)
    this.units.mod2.setParams(p.mod2)
    this.units.delay.setParams(p.delay)
    this.units.ampEq.setParams(p.ampEq)
    this.units.compressor.setParams(p.compressor)
    this.units.reverb.setParams(p.reverb)
    for (const s of this.slots) s.target = this.targetFor(s.name, p)
  }

  setParams(p: ChainParams) {
    this.params = p
    this.push(p)
    // Before any audio has passed, bypass states apply immediately instead of fading.
    if (!this.started) for (const s of this.slots) s.gain = s.target
  }

  process(l: Float32Array, r: Float32Array, n: number) {
    this.started = true
    if (this.wl.length < n) {
      this.wl = new Float32Array(n)
      this.wr = new Float32Array(n)
    }
    const wl = this.wl
    const wr = this.wr
    for (const slot of this.slots) {
      if (slot.gain === 0 && slot.target === 0) continue
      if (slot.gain === 1 && slot.target === 1) {
        slot.unit.process(l, r, n)
        continue
      }
      wl.set(l.subarray(0, n))
      wr.set(r.subarray(0, n))
      slot.unit.process(wl, wr, n)
      let g = slot.gain
      const step = this.fadeStep
      for (let i = 0; i < n; i++) {
        g = slot.target === 1 ? Math.min(1, g + step) : Math.max(0, g - step)
        if (g === 1) {
          l[i] = wl[i]
          r[i] = wr[i]
        } else if (g > 0) {
          const a = g * HALF_PI
          const c = Math.cos(a)
          const s = Math.sin(a)
          l[i] = l[i] * c + wl[i] * s
          r[i] = r[i] * c + wr[i] * s
        }
      }
      slot.gain = g
      if (g === 0) slot.unit.reset()
    }
  }

  reset() {
    for (const s of this.slots) {
      s.unit.reset()
      s.gain = s.target
    }
  }
}
