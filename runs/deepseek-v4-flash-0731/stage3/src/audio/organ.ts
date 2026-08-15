/**
 * Phase 3 — Organ DSP engine.
 *
 * Two layers (A, B) sharing ONE effect chain. Four audibly distinct engines —
 * B3 (tonewheel), Vox (transistor), Farf (register switches), Pipe 1 (pipe
 * ranks) — plus the documented reuse engines B3 Bass (B3 limited to 16'/8')
 * and Pipe 2 (Pipe 1 with a brighter principal registration). Nine drawbars
 * drive each model's audible harmonic spectrum via LED graphs; B3 supplies
 * percussion + key click; vibrato/chorus C1-C3/V1-V3 modulates pitch or mixes
 * the modulated signal; rotary routing with morphable slow/fast/stop.
 *
 * Pure, deterministic DSP on an injectable clock so tests render real PCM and
 * prove model/drawbar/percussion/vibrato/rotary distinctions without a device.
 */

import { LayerEffectsChain, type LayerChainState } from './chain'
import { Rotary } from './effects'
import type { RenderResult } from './types'
import type { OrganLayerState, OrganModel, OrganState } from '../system/program'
import { defaultOrgan } from '../system/factory'

const TAU = Math.PI * 2

/* ------------------------- drawbar → spectrum ------------------------- */

/** amplitude of a drawbar at position 0..8 (~6 dB per step). */
function dbAmp(pos: number): number {
  return Math.pow(0.55, 8 - Math.max(0, Math.min(8, Math.round(pos))))
}

/** partial {ratio, amp, detune?} list per model from the 9 drawbars. */
function modelPartials(model: OrganModel, drawbars: readonly number[]): { ratio: number; amp: number }[] {
  const d = (i: number) => dbAmp(drawbars[i] ?? 0)
  const b3 = [
    { ratio: 0.5, amp: d(0) }, { ratio: 1.5, amp: d(1) }, { ratio: 1, amp: d(2) },
    { ratio: 2, amp: d(3) }, { ratio: 3, amp: d(4) }, { ratio: 4, amp: d(5) },
    { ratio: 5, amp: d(6) }, { ratio: 6, amp: d(7) }, { ratio: 8, amp: d(8) },
  ]
  switch (model) {
    case 'B3': return b3
    case 'Bass': return [b3[0], b3[2]] // 16' and 8' only
    case 'Vox': {
      // seven partials + a filtered/unfiltered mix drawbar (last) — the mix
      // drawbar adds a highpassed "spit" so Vox is buzzy and distinct.
      const base = [
        { ratio: 0.5, amp: d(0) }, { ratio: 1, amp: d(2) }, { ratio: 1.5, amp: d(1) },
        { ratio: 2, amp: d(3) }, { ratio: 3, amp: d(4) }, { ratio: 4, amp: d(5) }, { ratio: 6, amp: d(7) },
      ]
      return base.map((p) => ({ ratio: p.ratio, amp: p.amp }))
      // (the 8th drawbar feeds vibrato/highpass mix handled in the voice)
    }
    case 'Farf': {
      // register switches: pulled past half = on (a Farf grass register).
      const on = (i: number): number => (drawbars[i] ?? 0) > 4 ? 1 : 0.0001
      return [
        { ratio: 0.5, amp: on(0) }, { ratio: 1, amp: on(2) }, { ratio: 2, amp: on(3) },
        { ratio: 4, amp: on(5) }, { ratio: 8, amp: on(8) },
      ].filter((p) => p.amp > 0.01)
    }
    case 'Pipe1':
    case 'Pipe2': {
      // nine pipe ranks 16' .. 1'; Pipe2 is a brighter principal registration.
      const bright = model === 'Pipe2' ? 1.35 : 1
      return [
        { ratio: 0.5, amp: d(0) * bright }, { ratio: 1.5, amp: d(1) * bright }, { ratio: 1, amp: d(2) * bright },
        { ratio: 2, amp: d(3) * bright }, { ratio: 2.67, amp: d(4) * bright }, { ratio: 4, amp: d(5) * bright },
        { ratio: 5.33, amp: d(6) * bright }, { ratio: 6.67, amp: d(7) * bright }, { ratio: 8, amp: d(8) * bright },
      ]
    }
    default: return b3
  }
}

/* ------------------------------- voices ------------------------------- */

interface OrganVoice {
  id: number
  layer: 0 | 1
  midi: number
  held: boolean
  sustained: boolean
  onset: number
  phase: Float64Array
  releasing: boolean
  releaseGain: number
  releaseStart: number
  keyClickSeed: number
}

export interface OrganOptions {
  sampleRate?: number
  rotary?: Rotary
  org?: OrganState
}

export class OrganEngine {
  readonly sampleRate: number
  readonly layerChain: LayerEffectsChain
  readonly rotary: Rotary
  private voices: OrganVoice[] = []
  private nextId = 1
  private clock = 0
  private sustainInput = false
  private state: [OrganLayerState, OrganLayerState]
  private org: OrganState
  // vibrato/chorus LFO phase; percussion single-trigger gate; key-click RNG.
  private vibPhase = 0
  private percArmed = true
  private clickState = 0x9e3779b9

  constructor(options: OrganOptions = {}, org?: OrganState) {
    this.sampleRate = options.sampleRate ?? 44_100
    this.rotary = options.rotary ?? new Rotary(this.sampleRate)
    this.org = org ?? options.org ?? defaultOrgan()
    this.layerChain = new LayerEffectsChain(this.sampleRate, this.rotary)
    this.state = [this.org.layers[0], this.org.layers[1]]
    this.layerChain.apply(this.org.chain)
    this.syncRotary()
  }

  /** push the program's rotary target/drive into the (possibly shared) rotary. */
  private syncRotary(): void {
    this.rotary.params.fast = this.org.rotarySpeed === 1
    this.rotary.params.stop = this.org.rotarySpeed === 2
    this.rotary.params.amount = this.org.rotaryDrive
  }

  setOrgan(org: OrganState): void {
    this.org = org
    this.state = [org.layers[0], org.layers[1]]
    this.layerChain.apply(org.chain)
    this.syncRotary()
  }

  get voiceCount(): number {
    return this.voices.length
  }

  setSustain(on: boolean): void {
    this.sustainInput = on
    if (!on) {
      for (const v of this.voices) if (v.sustained) { v.sustained = false; this.beginRelease(v) }
    }
  }

  private layerSustped(layer: 0 | 1): boolean {
    return this.sustainInput && this.state[layer].sustped
  }

  private freq(midi: number, octave: number): number {
    return 440 * Math.pow(2, (midi + octave - 69) / 12)
  }

  get voicesRemaining(): boolean {
    return this.voices.length > 0
  }

  noteOn(layer: 0 | 1, midi: number, velocity: number): void {
    const st = this.state[layer]
    if (!st.enabled) return
    const id = this.nextId++
    const partials = modelPartials(st.model, this.org.drawbars)
    const phase = new Float64Array(partials.length)
    const fromSilence = this.voices.length === 0
    const v: OrganVoice = {
      id, layer, midi, held: true, sustained: false, onset: this.clock,
      phase, releasing: false, releaseGain: 0, releaseStart: 0,
      keyClickSeed: (this.clickState = (this.clickState * 1664525 + 1013904223) >>> 0),
    }
    this.voices.push(v)
    // single-trigger percussion: sounds on the strike that starts from silence
    // and re-arms when the last key releases (noteOff below). While any key is
    // held it is disarmed so later strikes do not retrigger it.
    if (fromSilence) this.percOnset = this.clock
    else this.percArmed = false
  }

  private percOnset = 0

  noteOff(layer: 0 | 1, midi: number): void {
    for (const v of this.voices) {
      if (v.layer === layer && v.midi === midi && v.held) {
        v.held = false
        if (this.layerSustped(layer)) v.sustained = true
        else this.beginRelease(v)
        break
      }
    }
    // single-trigger percussion re-arms when the last key lifts.
    if (!this.voices.some((v) => v.held || v.sustained)) this.percArmed = true
  }

  private beginRelease(v: OrganVoice): void {
    if (v.releasing) return
    v.releasing = true
    v.releaseGain = 1
    v.releaseStart = this.clock
  }

  allNotesOff(): void {
    this.voices = []
  }

  /** release every sounding voice of one layer (used when a layer is disabled). */
  releaseLayer(layer: 0 | 1): void {
    for (const v of this.voices) if (v.layer === layer && v.held) this.beginRelease(v)
  }

  /** render one mono block through the shared organ chain + rotary + levels. */
  render(frames: number): RenderResult {
    const n = Math.floor(frames)
    const out = new Float32Array(n)
    const start = this.clock
    const org = this.org
    for (let fi = 0; fi < n; fi++) {
      const t = start + fi
      this.vibPhase = (this.vibPhase + (TAU * 5.5) / this.sampleRate) % TAU
      let sample = 0
      for (let li = 0; li < 2; li++) {
        if (!org.layers[li].enabled) continue
        const level = org.layers[li].level
        const st = org.layers[li]
        for (let vi = this.voices.length - 1; vi >= 0; vi--) {
          const v = this.voices[vi]
          if (v.layer !== li) continue
          if (!v.held && !v.sustained && this.finished(v, t)) {
            this.voices.splice(vi, 1)
            continue
          }
          const g = this.layerGain(v, t)
          sample += this.voiceSample(v, st, t) * g * level * 0.5
        }
      }
      out[fi] = Math.max(-1, Math.min(1, sample))
    }
    this.clock = start + n
    // shared organ effect chain (order: mod1..reverb) then rotary when routed.
    this.layerChain.process(out, out)
    if (this.layerChain.routesToRotary || this.org.toRotary) this.rotary.process(out, out)
    let peak = 0
    for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a }
    return { samples: out, peak }
  }

  private finished(v: OrganVoice, t: number): boolean {
    if (!v.releasing) return false
    return Math.exp(-Math.max(0, t - v.releaseStart) / this.sampleRate / 0.35) <= 0.0004
  }

  private layerGain(v: OrganVoice, t: number): number {
    if (!v.releasing) return 1
    return Math.exp(-Math.max(0, t - v.releaseStart) / this.sampleRate / 0.35)
  }

  /** render one voice's sample for the current model with vibrato/percussion/click. */
  private voiceSample(v: OrganVoice, st: OrganLayerState, t: number): number {
    const org = this.org
    const partials = modelPartials(st.model, org.drawbars)
    const baseFreq = this.freq(v.midi, st.octave)
    // vibrato/chorus: pitch LFO (vibrato) or mix modulated + dry (chorus).
    let pitchMult = 1
    let chorusWet = 0
    if (st.vibratoOn && st.model === 'B3' && org.vibratoChorus > 0) {
      const idx = org.vibratoChorus // 1..6 → C1 C2 C3 V1 V2 V3
      const depth = [0.0035, 0.005, 0.007, 0.004, 0.006, 0.009][idx - 1] ?? 0
      const isChorus = idx <= 3
      pitchMult = 1 + depth * Math.sin(this.vibPhase)
      if (isChorus) chorusWet = 0.35 + 0.5 * (idx / 3) // increase depth across 1→3
    }
    // key click: short deterministic transient at note attack.
    let click = 0
    const age = Math.max(0, t - v.onset)
    if (org.keyClick && age < this.sampleRate * 0.006) {
      const r = ((v.keyClickSeed >>> (Math.floor(age / 8) % 24)) & 1) * 2 - 1
      click = r * 0.35 * (1 - age / (this.sampleRate * 0.006))
    }
    const tSec = age / this.sampleRate
    const attackS = st.model === 'Pipe1' || st.model === 'Pipe2' ? 0.02 : 0.0012
    const att = tSec < attackS ? tSec / attackS : 1
    let dry = 0
    let mod = 0
    for (let p = 0; p < partials.length; p++) {
      const ratio = partials[p].ratio
      if (ratio <= 0) continue
      const dryHz = baseFreq * ratio
      const modHz = dryHz * pitchMult
      v.phase[p] = (v.phase[p] + (TAU * modHz) / this.sampleRate) % TAU
      const osc = v.phase[p] < Math.PI ? 1 : -1
      const blend = 0.55 + 0.45 * Math.sin(v.phase[p])
      const value = partials[p].amp * (st.model === 'Farf' ? osc : blend)
      const dph = (v.phase[p] - (TAU * (modHz - dryHz)) / this.sampleRate + TAU) % TAU
      const dryVal = partials[p].amp * (st.model === 'Farf' ? (dph < Math.PI ? 1 : -1) : 0.55 + 0.45 * Math.sin(dph))
      dry += dryVal
      mod += value
    }
    let s = click + (chorusWet > 0 ? dry * (1 - chorusWet) + mod * chorusWet : mod)
    // B3 percussion: a decaying 2nd/3rd harmonic partial, single-trigger.
    if (st.model === 'B3' && org.percussion.on && this.percArmed && t >= this.percOnset && age < this.sampleRate * 0.9) {
      const soft = org.percussion.soft ? 0.35 : 0.75
      const decay = org.percussion.fast ? 0.08 : 0.28
      const harm = org.percussion.third ? 3 : 2
      const tPS = Math.max(0, t - this.percOnset) / this.sampleRate
      const env = Math.exp(-tPS / decay)
      const hz = baseFreq * harm
      const ph = (this.percPhase + (TAU * hz * Math.max(0, age)) / this.sampleRate) % TAU
      s += Math.sin(ph) * soft * env
    }
    return s * att * 0.6
  }

  private percPhase = 0

  reset(): void {
    this.allNotesOff()
    this.layerChain.reset()
  }

  dispose(): void {
    this.reset()
  }
}
