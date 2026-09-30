/**
 * One synth voice: oscillator unit(s) → drive → filter → amp envelope → level. All modulation (pitch bus, Osc Ctrl bus,
 * filter-cutoff bus) is audio-rate and native (ConstantSource envelopes and looping LFO tables feeding AudioParams).
 *
 * Signal path and units
 *  - pitch bus (cents): LFO→pitch, vibrato, oscillator envelope (ENV TO PITCH), pitch stick, glide → every oscillator `detune`
 *  - Osc Ctrl bus (knob units, 1 = full knob): LFO→ctrl, oscillator envelope → the category's own parameter
 *      Sync   : synced-oscillator ratio 1..7  (master saw → k·(s+1) → wave-shaper curve frac(8·x): a real hard-sync waveform)
 *      Multi  : detune spread of 3 saws (0..40 ct) / 4 saws at octaves (0..25 ct)
 *      Super  : 7-oscillator stack spread 0..36 ct and stereo width
 *      FM-H   : modulation index 0..8 of a 2:1 two-operator FM pair
 *      Pure   : none (documented: no effect)
 *  - filter bus (cents): filter envelope, LFO→filter → both filter stages' `detune`; keyboard tracking is their static detune
 */
import { midiToHz } from '../pianoDsp'
import { ramp } from '../effects/rig'
import {
  TRACKING_AMOUNT,
  UNISON_DETUNE_CENTS,
  UNISON_VOICES,
  cutoffHz,
  filterEnvOctaves,
  glideSeconds,
  lfoHzFor,
  resonanceQ,
  velocitySensitivity,
  vibratoCents,
  waveformInfo,
  type SynthPatch,
} from '../../engine/synth'
import type { AudioContextLike, AudioNodeLike, AudioParamLike, BiquadLike, ConstantSourceLike, GainNodeLike, OscillatorLike, StereoPannerLike, WaveShaperLike } from '../types'
import { Envelope, shapeFromKnobs } from './envelope'
import { LFO_TABLE_LENGTH, SH_STEPS, SYNC_MAX_RATIO, SYNC_RATIO_SPAN, type Tables } from './tables'

/** linear level of one voice at velocity 127 and zone gain 1 (six of them stay below ±1) */
export const VOICE_LEVEL = 0.16
export const FM_RATIO = 2
export const FM_MAX_INDEX = 8
export const TRACKING_REFERENCE_NOTE = 60
export const LFO_PITCH_CENTS = 700
export const LFO_FILTER_CENTS = 3600
export const ENV_PITCH_CENTS = 2400
export const DELAYED_VIBRATO_DELAY = 0.5
export const DELAYED_VIBRATO_FADE = 0.5

type Src = { start(when?: number, offset?: number): void; stop(when?: number): void; onended: (() => void) | null }

export interface VoiceEnv {
  ctx: AudioContextLike
  tables: Tables
  out: AudioNodeLike
  /** phase 0..1 of the layer's LFO cycle at time t (keeps every voice on the same free-running LFO) */
  lfoPhase(t: number): number
}

export interface VoiceParams {
  patch: SynthPatch
  bpm: number
  modWheel: number
  bendCents: number
}

interface Unit {
  out: AudioNodeLike
  setFreq(hz: number, t: number): void
  setCtrl(c: number, live: boolean): void
}

const noteHz = (note: number, patch: SynthPatch) => midiToHz(note + patch.coarse + patch.fine / 100)
const trackCents = (note: number, patch: SynthPatch) => TRACKING_AMOUNT[patch.filter.tracking] * (note - TRACKING_REFERENCE_NOTE) * 100
const velocityFactor = (velocity: number, level: number) => Math.pow(Math.max(1, velocity) / 127, velocitySensitivity(level))
/** cycles per second of the LFO table: Sample & Hold walks SH_STEPS values per cycle */
export const lfoCycleHz = (patch: SynthPatch, bpm: number): number => lfoHzFor(patch.lfo, bpm) / (patch.lfo.waveform === 4 ? SH_STEPS : 1)

export interface UnisonPlan {
  copies: number
  cents: number[]
  pans: number[]
}
export function unisonPlan(level: number): UnisonPlan {
  const copies = UNISON_VOICES[Math.min(3, Math.max(0, level))]
  const spread = UNISON_DETUNE_CENTS[Math.min(3, Math.max(0, level))]
  const at = (i: number) => (copies === 1 ? 0 : (i / (copies - 1)) * 2 - 1)
  return { copies, cents: Array.from({ length: copies }, (_, i) => at(i) * spread), pans: Array.from({ length: copies }, (_, i) => at(i) * 0.8) }
}

export class SynthVoice {
  note: number
  velocity: number
  zoneGain: number
  readonly startedAt: number
  released = false
  /** kept sounding by KB Hold after its key was lifted */
  held = false
  /** produced by the arpeggiator (not by a key) */
  arp = false
  disposed = false
  /** absolute audio time at which the voice is silent for good (null while the key is down) */
  endTime: number | null = null

  private readonly ctx: AudioContextLike
  private readonly nodes: AudioNodeLike[] = []
  private readonly sources: Src[] = []
  private readonly units: Unit[] = []
  private readonly ampEnv: Envelope
  private readonly oscEnv: Envelope
  private readonly fltEnv: Envelope
  private readonly ampGain: GainNodeLike
  private readonly out: GainNodeLike
  private readonly oscPitch: GainNodeLike
  private readonly oscCtrl: GainNodeLike
  private readonly fltEnvGain: GainNodeLike
  private readonly lfoGains: { pitch: GainNodeLike; filter: GainNodeLike; ctrl: GainNodeLike }
  private readonly vibGain: GainNodeLike
  private vibSrc!: Src & { playbackRate?: AudioParamLike }
  private lfoSrc!: Src & { playbackRate?: AudioParamLike }
  private lfoWave: number
  private readonly bendCS: ConstantSourceLike
  private readonly glideCS: ConstantSourceLike
  private glide: { from: number; start: number; dur: number } | null = null
  private readonly filters: [BiquadLike, BiquadLike]
  private readonly filterPath: GainNodeLike
  private readonly bypassPath: GainNodeLike
  private readonly drive: WaveShaperLike
  private driveLevel = -1
  private readonly lfoTarget: AudioNodeLike[]

  constructor(
    private readonly env: VoiceEnv,
    note: number,
    velocity: number,
    zoneGain: number,
    when: number,
    p: VoiceParams,
  ) {
    const ctx = (this.ctx = env.ctx)
    this.note = note
    this.velocity = velocity
    this.zoneGain = zoneGain
    this.startedAt = when
    this.lfoWave = p.patch.lfo.waveform
    const { patch } = p

    const gain = (v = 1): GainNodeLike => {
      const g = ctx.createGain()
      g.gain.value = v
      this.nodes.push(g)
      return g
    }
    const constant = (v = 0): ConstantSourceLike => {
      const c = ctx.createConstantSource()
      c.offset.value = v
      this.nodes.push(c)
      this.sources.push(c)
      return c
    }

    const pitchBus = gain(1)
    const ctrlBus = gain(1)
    const fltBus = gain(1)

    // envelopes as audio-rate signals
    const oscCS = constant(0)
    const fltCS = constant(0)
    this.ampGain = gain(0)
    this.ampEnv = new Envelope(this.ampGain.gain)
    this.oscEnv = new Envelope(oscCS.offset)
    this.fltEnv = new Envelope(fltCS.offset)
    this.oscPitch = gain(0)
    this.oscCtrl = gain(0)
    this.fltEnvGain = gain(0)
    oscCS.connect(this.oscPitch)
    oscCS.connect(this.oscCtrl)
    this.oscPitch.connect(pitchBus)
    this.oscCtrl.connect(ctrlBus)
    fltCS.connect(this.fltEnvGain)
    this.fltEnvGain.connect(fltBus)

    // pitch stick and glide
    this.bendCS = constant(p.bendCents)
    this.glideCS = constant(0)
    this.bendCS.connect(pitchBus)
    this.glideCS.connect(pitchBus)

    // LFO (shared phase through the layer clock) and vibrato
    this.lfoGains = { pitch: gain(0), filter: gain(0), ctrl: gain(0) }
    this.lfoGains.pitch.connect(pitchBus)
    this.lfoGains.filter.connect(fltBus)
    this.lfoGains.ctrl.connect(ctrlBus)
    this.lfoTarget = [this.lfoGains.pitch, this.lfoGains.filter, this.lfoGains.ctrl]
    this.startLfo(when, p)
    this.vibGain = gain(0)
    this.vibGain.connect(pitchBus)
    const vib = ctx.createBufferSource()
    vib.buffer = env.tables.sine()
    vib.loop = true
    this.nodes.push(vib)
    this.sources.push(vib)
    vib.connect(this.vibGain)
    this.vibSrc = vib

    // oscillator units (one per unison copy)
    const plan = unisonPlan(patch.voice.unison)
    const oscMix = gain(1 / Math.sqrt(plan.copies))
    const freq = noteHz(note, patch)
    for (let i = 0; i < plan.copies; i++) {
      const unit = this.buildUnit(patch.waveform, pitchBus, ctrlBus, plan.cents[i], patch.oscCtrl, plan.copies > 1, freq)
      this.units.push(unit)
      if (plan.copies > 1) {
        const pan = ctx.createStereoPanner() as StereoPannerLike
        pan.pan.value = plan.pans[i]
        this.nodes.push(pan)
        unit.out.connect(pan)
        pan.connect(oscMix)
      } else unit.out.connect(oscMix)
    }

    // drive → filter (or bypass) → amp → level
    this.drive = ctx.createWaveShaper()
    this.drive.oversample = '2x'
    this.nodes.push(this.drive)
    const pre = gain(1)
    const post = gain(1)
    this.filterPath = gain(1)
    this.bypassPath = gain(0)
    const f1 = ctx.createBiquadFilter()
    const f2 = ctx.createBiquadFilter()
    this.nodes.push(f1, f2)
    this.filters = [f1, f2]
    oscMix.connect(this.drive)
    this.drive.connect(pre)
    pre.connect(this.filterPath)
    this.filterPath.connect(f1)
    f1.connect(f2)
    f2.connect(post)
    pre.connect(this.bypassPath)
    this.bypassPath.connect(post)
    post.connect(this.ampGain)
    this.out = gain(0)
    this.ampGain.connect(this.out)
    this.out.connect(env.out)
    for (const f of this.filters) {
      const d = (f as BiquadLike & { detune?: AudioParamLike }).detune
      if (d) fltBus.connect(d)
    }

    this.applyParams(p, false)
    for (const s of this.sources) s.start(when)
    // LFO and vibrato tables were created above and started here at phase offsets
    this.restartPhaseSources(when, p)
    this.triggerAll(when, p.patch)
    this.applyVibratoEnvelope(when, p, true)
  }

  // --- construction helpers ---------------------------------------------------------------------------
  private startLfo(when: number, p: VoiceParams) {
    const src = this.ctx.createBufferSource()
    src.buffer = this.env.tables.lfoTable(p.patch.lfo.waveform)
    src.loop = true
    this.nodes.push(src)
    src.connect(this.lfoGains.pitch)
    src.connect(this.lfoGains.filter)
    src.connect(this.lfoGains.ctrl)
    this.lfoSrc = src
  }

  /** LFO/vibrato tables start inside their cycle: the LFO at the layer's phase, vibrato at 0 */
  private restartPhaseSources(when: number, p: VoiceParams) {
    const seconds = (LFO_TABLE_LENGTH / this.ctx.sampleRate) * this.env.lfoPhase(when)
    this.lfoSrc.start(when, seconds)
    this.sources.push(this.lfoSrc)
    void p
  }

  private buildUnit(waveform: number, pitchBus: AudioNodeLike, ctrlBus: AudioNodeLike, fixedCents: number, ctrl0: number, reduced: boolean, hz: number): Unit {
    const ctx = this.ctx
    const info = waveformInfo(waveform)
    const nodes = this.nodes
    const gain = (v: number): GainNodeLike => {
      const g = ctx.createGain()
      g.gain.value = v
      nodes.push(g)
      return g
    }
    const osc = (type: string, detune: number, freq: number): OscillatorLike => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = freq
      if (o.detune) {
        o.detune.value = detune
        pitchBus.connect(o.detune)
      }
      nodes.push(o)
      this.sources.push(o)
      return o
    }
    const setF = (o: OscillatorLike, f: number, t: number) => {
      o.frequency.cancelScheduledValues(t)
      o.frequency.setValueAtTime(f, t)
    }
    const setP = (param: AudioParamLike, v: number, live: boolean) => {
      if (live) ramp(ctx, param, v)
      else param.value = v
    }
    const RMS_FIX: Record<string, number> = { sine: 0.8, triangle: 1, saw: 1, square: 0.58, pulse33: 0.58, pulse10: 0.58, noise: 1, 'sync-saw': 1, 'sync-square': 0.58, 'fm-2op': 0.8 }

    // pure oscillators ------------------------------------------------------------------------------------
    if (info.category === 'Pure' && info.id !== 'noise') {
      const o = osc(info.id === 'saw' ? 'sawtooth' : info.id === 'triangle' ? 'triangle' : info.id === 'square' ? 'square' : 'sine', fixedCents, hz)
      if (info.id === 'pulse33' || info.id === 'pulse10') {
        o.setPeriodicWave(this.env.tables.pulse(info.id === 'pulse33' ? 0.33 : 0.1))
      }
      const out = gain(RMS_FIX[info.id] ?? 1)
      o.connect(out)
      return { out, setFreq: (f, t) => setF(o, f, t), setCtrl: () => undefined }
    }
    if (info.id === 'noise') {
      const src = ctx.createBufferSource()
      src.buffer = this.env.tables.noise()
      src.loop = true
      nodes.push(src)
      this.sources.push(src)
      const out = gain(RMS_FIX.noise)
      src.connect(out)
      return { out, setFreq: () => undefined, setCtrl: () => undefined }
    }

    // hard sync ------------------------------------------------------------------------------------------
    if (info.category === 'Sync') {
      const master = osc('sawtooth', fixedCents, hz)
      const kSrc = ctx.createConstantSource()
      kSrc.offset.value = (1 + SYNC_RATIO_SPAN * ctrl0) / (2 * SYNC_MAX_RATIO)
      nodes.push(kSrc)
      this.sources.push(kSrc)
      const kGain = gain(0)
      const sum = gain(1)
      const shaper = ctx.createWaveShaper()
      shaper.curve = this.env.tables.syncCurve(info.id === 'sync-saw' ? 'saw' : 'square')
      shaper.oversample = '4x'
      nodes.push(shaper)
      const out = gain(RMS_FIX[info.id])
      master.connect(kGain)
      kSrc.connect(kGain.gain)
      kGain.connect(sum)
      kSrc.connect(sum)
      sum.connect(shaper)
      shaper.connect(out)
      const ctrlToK = gain(SYNC_RATIO_SPAN / (2 * SYNC_MAX_RATIO))
      ctrlBus.connect(ctrlToK)
      ctrlToK.connect(kSrc.offset)
      return {
        out,
        setFreq: (f, t) => setF(master, f, t),
        setCtrl: (c, live) => setP(kSrc.offset, (1 + SYNC_RATIO_SPAN * c) / (2 * SYNC_MAX_RATIO), live),
      }
    }

    // FM-H: two-operator FM, modulator at FM_RATIO × carrier ----------------------------------------------
    if (info.category === 'FM-H') {
      const carrier = osc('sine', fixedCents, hz)
      const mod = osc('sine', fixedCents, hz * FM_RATIO)
      const modGain = gain(ctrl0 * FM_MAX_INDEX * hz * FM_RATIO)
      const ctrlToIndex = gain(FM_MAX_INDEX * hz * FM_RATIO)
      const out = gain(RMS_FIX['fm-2op'])
      mod.connect(modGain)
      modGain.connect(carrier.frequency)
      ctrlBus.connect(ctrlToIndex)
      ctrlToIndex.connect(modGain.gain)
      carrier.connect(out)
      let ctrl = ctrl0
      let curF = hz
      return {
        out,
        setFreq: (f, t) => {
          curF = f
          setF(carrier, f, t)
          setF(mod, f * FM_RATIO, t)
          modGain.gain.setValueAtTime(ctrl * FM_MAX_INDEX * f * FM_RATIO, t)
          ctrlToIndex.gain.setValueAtTime(FM_MAX_INDEX * f * FM_RATIO, t)
        },
        setCtrl: (c, live) => {
          ctrl = c
          setP(modGain.gain, c * FM_MAX_INDEX * curF * FM_RATIO, live)
        },
      }
    }

    // Multi / Super stacks ---------------------------------------------------------------------------------
    type Member = { ratio: number; off: number; pan: number }
    let members: Member[]
    let spread: number
    let type = 'sawtooth'
    let panWidth = 0
    if (info.id === 'multi-saw') {
      members = [-1, 0, 1].map((off) => ({ ratio: 1, off, pan: 0 }))
      spread = 40
    } else if (info.id === 'multi-saw-8ve') {
      members = [
        { ratio: 0.5, off: -1, pan: 0 },
        { ratio: 1, off: 1, pan: 0 },
        { ratio: 1, off: -1, pan: 0 },
        { ratio: 2, off: 1, pan: 0 },
      ]
      spread = 25
    } else {
      // Super Saw / Super Square: 7 oscillators (3 when unison already stacks copies), stereo spread
      type = info.id === 'super-square' ? 'square' : 'sawtooth'
      const offs = reduced ? [-3, 0, 3] : [-3, -2, -1, 0, 1, 2, 3]
      members = offs.map((off) => ({ ratio: 1, off, pan: off / 3 }))
      spread = 12
      panWidth = 0.75
    }
    const out = gain((info.id === 'super-square' ? 0.58 : 1) / Math.sqrt(members.length))
    const oscs: Array<{ o: OscillatorLike; m: Member }> = []
    const pans: Array<{ p: StereoPannerLike; m: Member }> = []
    for (const m of members) {
      const o = osc(type, fixedCents + m.off * ctrl0 * spread, hz * m.ratio)
      if (o.detune && m.off !== 0) {
        const cg = gain(m.off * spread)
        ctrlBus.connect(cg)
        cg.connect(o.detune)
      }
      oscs.push({ o, m })
      if (panWidth > 0) {
        const pan = ctx.createStereoPanner()
        pan.pan.value = m.pan * (1 - panWidth + panWidth * ctrl0)
        nodes.push(pan)
        if (m.pan !== 0) {
          const pg = gain(m.pan * panWidth)
          ctrlBus.connect(pg)
          pg.connect(pan.pan)
        }
        o.connect(pan)
        pan.connect(out)
        pans.push({ p: pan, m })
      } else o.connect(out)
    }
    return {
      out,
      setFreq: (f, t) => oscs.forEach(({ o, m }) => setF(o, f * m.ratio, t)),
      setCtrl: (c, live) => {
        for (const { o, m } of oscs) if (o.detune) setP(o.detune, fixedCents + m.off * c * spread, live)
        for (const { p, m } of pans) setP(p.pan, m.pan * (1 - panWidth + panWidth * c), live)
      },
    }
  }

  // --- parameters -------------------------------------------------------------------------------------
  /** write every control-derived value; `live` uses short ramps so sounding voices never click */
  applyParams(p: VoiceParams, live: boolean): void {
    const { patch } = p
    const ctx = this.ctx
    const set = (param: AudioParamLike, v: number) => {
      if (live) ramp(ctx, param, v)
      else param.value = v
    }
    const oscVel = patch.oscEnv.velocity ? Math.max(1, this.velocity) / 127 : 1
    const fltVel = patch.filter.velocity ? Math.max(1, this.velocity) / 127 : 1
    set(this.oscPitch.gain, patch.oscEnv.toPitch ? patch.oscEnv.amount * ENV_PITCH_CENTS * oscVel : 0)
    set(this.oscCtrl.gain, patch.oscEnv.toPitch ? 0 : patch.oscEnv.amount * oscVel)
    set(this.fltEnvGain.gain, filterEnvOctaves(patch.filter.envAmount) * 1200 * fltVel)
    set(this.lfoGains.pitch.gain, patch.lfo.dest === 'pitch' ? patch.lfo.amount * LFO_PITCH_CENTS : 0)
    set(this.lfoGains.filter.gain, patch.lfo.dest === 'filter' ? patch.lfo.amount * LFO_FILTER_CENTS : 0)
    set(this.lfoGains.ctrl.gain, patch.lfo.dest === 'ctrl' ? patch.lfo.amount : 0)
    const rate = (lfoCycleHz(patch, p.bpm) * LFO_TABLE_LENGTH) / this.ctx.sampleRate
    if (this.lfoSrc.playbackRate) set(this.lfoSrc.playbackRate, rate)
    if (this.vibSrc.playbackRate) set(this.vibSrc.playbackRate, (patch.voice.vibrato.rate * LFO_TABLE_LENGTH) / this.ctx.sampleRate)
    set(this.bendCS.offset, p.bendCents)
    if (live) this.applyVibratoEnvelope(ctx.currentTime, p, false)
    set(this.out.gain, VOICE_LEVEL * this.zoneGain * velocityFactor(this.velocity, patch.amp.velocity))

    // filter
    const [f1, f2] = this.filters
    const lp24 = patch.filter.type === 'LP24'
    const kind = patch.filter.type === 'HP' ? 'highpass' : patch.filter.type === 'BP' ? 'bandpass' : 'lowpass'
    f1.type = kind
    f2.type = lp24 ? 'lowpass' : 'peaking'
    const hz = cutoffHz(patch.filter.freq)
    const q = resonanceQ(patch.filter.res)
    set(f1.frequency, hz)
    set(f2.frequency, hz)
    set(f1.Q, lp24 ? q / 2 : q)
    set(f2.Q, lp24 ? q / 2 : 0.707)
    set(f2.gain, 0)
    for (const f of this.filters) {
      const d = (f as BiquadLike & { detune?: AudioParamLike }).detune
      if (d) set(d, trackCents(this.note, patch))
    }
    set(this.filterPath.gain, patch.filter.on ? 1 : 0)
    set(this.bypassPath.gain, patch.filter.on ? 0 : 1)
    if (this.driveLevel !== patch.filter.drive) {
      this.driveLevel = patch.filter.drive
      this.drive.curve = this.env.tables.drive(patch.filter.drive)
    }
    for (const u of this.units) u.setCtrl(patch.oscCtrl, live)

    // pitch offsets (coarse/fine) for sounding voices
    if (live) {
      const f = noteHz(this.note, patch)
      for (const u of this.units) u.setFreq(f, ctx.currentTime)
    }

    // LFO waveform changed: swap the table source
    if (live && patch.lfo.waveform !== this.lfoWave) this.swapLfo(ctx.currentTime, p)
  }

  private swapLfo(t: number, p: VoiceParams) {
    this.lfoWave = p.patch.lfo.waveform
    const old = this.lfoSrc
    try {
      old.stop(t)
    } catch {
      // already stopped
    }
    old.onended = null
    try {
      ;(old as unknown as AudioNodeLike).disconnect()
    } catch {
      // not connected
    }
    const src = this.ctx.createBufferSource()
    src.buffer = this.env.tables.lfoTable(p.patch.lfo.waveform)
    src.loop = true
    this.nodes.push(src)
    for (const g of this.lfoTarget) src.connect(g)
    if (src.playbackRate) src.playbackRate.value = (lfoCycleHz(p.patch, p.bpm) * LFO_TABLE_LENGTH) / this.ctx.sampleRate
    src.start(t, (LFO_TABLE_LENGTH / this.ctx.sampleRate) * this.env.lfoPhase(t))
    this.sources.push(src)
    this.lfoSrc = src
  }

  /** vibrato depth: On = full, Wheel = mod wheel, Delay = fades in after ½ s; Off = none */
  private applyVibratoEnvelope(t: number, p: VoiceParams, initial: boolean) {
    const v = p.patch.voice.vibrato
    const cents = vibratoCents(v.amount)
    const g = this.vibGain.gain
    switch (v.mode) {
      case 'off':
        if (initial) g.value = 0
        else ramp(this.ctx, g, 0)
        break
      case 'on':
        if (initial) g.value = cents
        else ramp(this.ctx, g, cents)
        break
      case 'wheel':
        if (initial) g.value = cents * p.modWheel
        else ramp(this.ctx, g, cents * p.modWheel)
        break
      case 'delay': {
        const age = t - this.startedAt
        if (initial) {
          g.value = 0
          g.setValueAtTime(0, this.startedAt + DELAYED_VIBRATO_DELAY)
          g.linearRampToValueAtTime(cents, this.startedAt + DELAYED_VIBRATO_DELAY + DELAYED_VIBRATO_FADE)
        } else if (age > DELAYED_VIBRATO_DELAY + DELAYED_VIBRATO_FADE) ramp(this.ctx, g, cents)
        break
      }
    }
  }

  private triggerAll(t: number, patch: SynthPatch) {
    this.ampEnv.trigger(t, shapeFromKnobs(patch.amp))
    this.oscEnv.trigger(t, shapeFromKnobs(patch.oscEnv))
    this.fltEnv.trigger(t, shapeFromKnobs(patch.filter))
  }

  // --- lifecycle ----------------------------------------------------------------------------------------
  /** the key went up (or the arpeggiator step ended): natural release */
  release(t: number, patch: SynthPatch): void {
    if (this.released) return
    this.released = true
    const amp = shapeFromKnobs(patch.amp)
    this.ampEnv.release(t, amp.release)
    this.oscEnv.release(t, shapeFromKnobs(patch.oscEnv).release)
    this.fltEnv.release(t, shapeFromKnobs(patch.filter).release)
    this.endTime = t + amp.release
    this.stopSourcesAt(this.endTime + 0.05)
  }

  /** fast fade (voice stealing, panic) */
  fade(t: number, seconds: number): void {
    this.released = true
    this.ampEnv.release(t, seconds, true)
    this.endTime = t + seconds
    this.stopSourcesAt(this.endTime + 0.03)
  }

  private stopSourcesAt(when: number) {
    for (const s of this.sources) {
      try {
        s.stop(when)
      } catch {
        // already stopped
      }
    }
  }

  /** audio-time end of this voice's sound, for the engine's cleanup timer */
  get audibleUntil(): number {
    return (this.endTime ?? this.startedAt) + 0.06
  }

  /** re-pitch a sounding voice (mono / legato / priority): optionally retrigger envelopes and glide */
  retune(note: number, velocity: number, t: number, p: VoiceParams, opts: { retrigger: boolean; glide: boolean }): void {
    const old = this.note
    this.note = note
    this.velocity = velocity
    const f = noteHz(note, p.patch)
    for (const u of this.units) u.setFreq(f, t)
    if (opts.glide && p.patch.voice.glide > 0) {
      const residual = this.glideResidual(t)
      const from = (old - note) * 100 + residual
      const dur = Math.max(0.005, Math.min(8, glideSeconds(p.patch.voice.glide) * (Math.abs(old - note) / 12)))
      this.glide = { from, start: t, dur }
      this.glideCS.offset.cancelScheduledValues(t)
      this.glideCS.offset.setValueAtTime(from, t)
      this.glideCS.offset.linearRampToValueAtTime(0, t + dur)
    } else if (this.glide) {
      this.glide = null
      this.glideCS.offset.cancelScheduledValues(t)
      this.glideCS.offset.setValueAtTime(0, t)
    }
    for (const fl of this.filters) {
      const d = (fl as BiquadLike & { detune?: AudioParamLike }).detune
      if (d) {
        d.cancelScheduledValues(t)
        d.setValueAtTime(trackCents(note, p.patch), t)
      }
    }
    if (opts.retrigger) this.triggerAll(t, p.patch)
    this.applyVelocity(p, t)
  }

  /** velocity-dependent gains, written at time t (a retune may be scheduled ahead of the audio clock) */
  private applyVelocity(p: VoiceParams, t: number) {
    const { patch } = p
    const at = (param: AudioParamLike, v: number) => {
      param.cancelScheduledValues(t)
      param.setValueAtTime(v, t)
    }
    const oscVel = patch.oscEnv.velocity ? Math.max(1, this.velocity) / 127 : 1
    const fltVel = patch.filter.velocity ? Math.max(1, this.velocity) / 127 : 1
    at(this.oscPitch.gain, patch.oscEnv.toPitch ? patch.oscEnv.amount * ENV_PITCH_CENTS * oscVel : 0)
    at(this.oscCtrl.gain, patch.oscEnv.toPitch ? 0 : patch.oscEnv.amount * oscVel)
    at(this.fltEnvGain.gain, filterEnvOctaves(patch.filter.envAmount) * 1200 * fltVel)
    at(this.out.gain, VOICE_LEVEL * this.zoneGain * velocityFactor(this.velocity, patch.amp.velocity))
  }

  private glideResidual(t: number): number {
    const g = this.glide
    if (!g) return 0
    return Math.max(0, 1 - (t - g.start) / g.dur) * g.from
  }

  /** stop everything now and free every node */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const s of this.sources) {
      s.onended = null
      try {
        s.stop()
      } catch {
        // never started or already stopped
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect()
      } catch {
        // already disconnected
      }
    }
    this.nodes.length = 0
    this.sources.length = 0
  }

  get level(): number {
    return this.ampEnv.level(this.ctx.currentTime)
  }
}
