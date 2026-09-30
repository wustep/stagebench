import type { SynthKind } from './library/catalog'
import { sampleGain, UNISON_CENTS, UNISON_PAN, unisonGain } from './params'
import { midiToHz, renderPianoNote, RENDER_SAMPLE_RATE, velocityGain, velocityLayer, VELOCITY_LAYERS } from './pianoDsp'
import type { Level3 } from '../engine/state'
import type { LoadedModel } from './library/sampleLibrary'
import type { AudioBufferLike, AudioContextLike, AudioNodeLike, AudioParamLike, BufferSourceLike, GainNodeLike, OscillatorLike } from './types'

/** what kind of sound a voice actually produces; the UI status is derived from this, never guessed */
export type VoiceOrigin = 'recorded' | 'synth' | 'generated' | 'oscillator'

/** One sounding note on one layer: source(s) → envelope gain → the layer bus. */
export class Voice {
  readonly sources: Array<BufferSourceLike | OscillatorLike> = []
  readonly nodes: AudioNodeLike[] = []
  /** params that follow the pitch stick, with the cents they were created at */
  readonly bend: Array<{ param: AudioParamLike; base: number }> = []
  private done = false

  constructor(
    readonly origin: VoiceOrigin,
    readonly env: GainNodeLike,
    private readonly ctx: AudioContextLike,
  ) {
    this.nodes.push(env)
  }

  get ended(): boolean {
    return this.done
  }

  /** current pitch-stick offset in cents */
  setBend(cents: number) {
    const now = this.ctx.currentTime
    for (const b of this.bend) {
      b.param.cancelScheduledValues(now)
      b.param.setValueAtTime(b.base + cents, now)
    }
  }

  fade(seconds: number) {
    const now = this.ctx.currentTime
    const p = this.env.gain
    p.cancelScheduledValues(now)
    p.setValueAtTime(p.value, now)
    p.linearRampToValueAtTime(0, now + seconds)
  }

  /** stop every source and disconnect every node */
  dispose() {
    if (this.done) return
    this.done = true
    for (const s of this.sources) {
      s.onended = null
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    for (const n of [...this.sources, ...this.nodes]) {
      try {
        n.disconnect()
      } catch {
        // already disconnected
      }
    }
  }
}

const startEnvelope = (env: GainNodeLike, now: number, level: number, attack = 0.003) => {
  env.gain.setValueAtTime(0, now)
  env.gain.linearRampToValueAtTime(level, now + attack)
}

// ---------------------------------------------------------------------------------------------------------------
// recorded samples
// ---------------------------------------------------------------------------------------------------------------
export interface SamplePick {
  buffer: AudioBufferLike
  rms: number
  /** cents from the recorded root to the requested note */
  cents: number
  layerVelocity: number
}

/** nearest available velocity layer, then the nearest recorded root inside it */
export function pickSample(model: LoadedModel, note: number, velocity: number): SamplePick | null {
  let best: LoadedModel['layers'][number] | null = null
  for (const layer of model.layers) {
    if (layer.samples.length === 0) continue
    if (!best || Math.abs(layer.velocity - velocity) < Math.abs(best.velocity - velocity)) best = layer
  }
  if (!best) return null
  let sample = best.samples[0]
  for (const s of best.samples) if (Math.abs(s.root - note) < Math.abs(sample.root - note)) sample = s
  return { buffer: sample.buffer, rms: sample.rms, cents: (note - sample.root) * 100 + sample.cents, layerVelocity: best.velocity }
}

export interface StartArgs {
  ctx: AudioContextLike
  out: AudioNodeLike
  note: number
  velocity: number
  /** linear gain applied on top of the voice's own level (dyn comp, headroom) */
  gain: number
  unison: Level3
  bendCents: number
}

export function startSampleVoice(args: StartArgs, model: LoadedModel): Voice | null {
  const { ctx, out, note, velocity, unison, bendCents } = args
  const pick = pickSample(model, note, velocity)
  if (!pick) return null
  const now = ctx.currentTime
  const env = ctx.createGain()
  const voice = new Voice('recorded', env, ctx)
  const level = args.gain * sampleGain(velocity, pick.rms) * unisonGain(unison)
  startEnvelope(env, now, level)
  env.connect(out)
  const sides = unison === 0 ? [0] : [-1, 1]
  for (const side of sides) {
    const src = ctx.createBufferSource()
    src.buffer = pick.buffer
    const base = pick.cents + side * UNISON_CENTS[unison]
    if (src.detune) {
      src.detune.value = base + bendCents
      voice.bend.push({ param: src.detune, base })
    }
    if (side === 0) {
      src.connect(env)
    } else {
      const pan = ctx.createStereoPanner()
      pan.pan.value = side * UNISON_PAN[unison]
      src.connect(pan)
      pan.connect(env)
      voice.nodes.push(pan)
    }
    src.start(now)
    voice.sources.push(src)
  }
  return voice
}

/** quiet, slow-attack copies of other strings' samples: simulated sympathetic resonance, owned by the new voice */
export function addResonance(voice: Voice, args: StartArgs, model: LoadedModel, partners: Array<{ note: number; gain: number }>): void {
  const { ctx } = args
  const now = ctx.currentTime
  for (const p of partners) {
    const pick = pickSample(model, p.note, 40)
    if (!pick) continue
    const src = ctx.createBufferSource()
    src.buffer = pick.buffer
    if (src.detune) src.detune.value = pick.cents
    const g = ctx.createGain()
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1800
    const peak = p.gain * sampleGain(60, pick.rms) * args.gain
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(peak, now + 0.06)
    g.gain.linearRampToValueAtTime(0, now + 2.4)
    src.connect(lp)
    lp.connect(g)
    g.connect(voice.env)
    src.start(now)
    src.stop(now + 2.5)
    voice.sources.push(src)
    voice.nodes.push(g, lp)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// labelled fallbacks: the Phase 1 generated additive voice, then a plain oscillator
// ---------------------------------------------------------------------------------------------------------------
export class GeneratedBufferCache {
  private readonly cache = new Map<string, AudioBufferLike>()
  private static readonly LIMIT = 48
  get(ctx: AudioContextLike, note: number, velocity: number): AudioBufferLike {
    const layer = velocityLayer(velocity)
    const key = `${note}:${layer}`
    const hit = this.cache.get(key)
    if (hit) {
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    const data = renderPianoNote(note, VELOCITY_LAYERS[layer], RENDER_SAMPLE_RATE)
    const buffer = ctx.createBuffer(1, data.length, RENDER_SAMPLE_RATE)
    buffer.getChannelData(0).set(data)
    this.cache.set(key, buffer)
    if (this.cache.size > GeneratedBufferCache.LIMIT) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return buffer
  }
  clear() {
    this.cache.clear()
  }
}

export const VOICE_HEADROOM = 0.4

/** Generated additive-synthesis buffer voice (Phase 1's voice). Throws if buffers cannot be created. */
export function startGeneratedVoice(args: StartArgs, cache: GeneratedBufferCache): Voice {
  const { ctx, out, note, velocity, unison, bendCents } = args
  const buffer = cache.get(ctx, note, velocity)
  const now = ctx.currentTime
  const env = ctx.createGain()
  const voice = new Voice('generated', env, ctx)
  startEnvelope(env, now, velocityGain(velocity) * VOICE_HEADROOM * args.gain * unisonGain(unison))
  env.connect(out)
  for (const side of unison === 0 ? [0] : [-1, 1]) {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const base = side * UNISON_CENTS[unison]
    if (src.detune) {
      src.detune.value = base + bendCents
      voice.bend.push({ param: src.detune, base })
    }
    src.connect(env)
    src.start(now)
    voice.sources.push(src)
  }
  return voice
}

export function startOscillatorVoice(args: StartArgs): Voice {
  const { ctx, out, note, velocity, bendCents } = args
  const now = ctx.currentTime
  const env = ctx.createGain()
  const voice = new Voice('oscillator', env, ctx)
  const level = velocityGain(velocity) * VOICE_HEADROOM * args.gain
  env.gain.setValueAtTime(0, now)
  env.gain.linearRampToValueAtTime(level, now + 0.003)
  env.gain.linearRampToValueAtTime(level * 0.35, now + 0.4)
  env.gain.linearRampToValueAtTime(0, now + 2.6)
  env.connect(out)
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.value = midiToHz(note)
  if (osc.detune) {
    osc.detune.value = bendCents
    voice.bend.push({ param: osc.detune, base: 0 })
  }
  osc.connect(env)
  osc.start(now)
  osc.stop(now + 2.7)
  voice.sources.push(osc)
  return voice
}

// ---------------------------------------------------------------------------------------------------------------
// live synthesis for Clav, Digital and Misc
// ---------------------------------------------------------------------------------------------------------------
export function startSynthVoice(args: StartArgs, kind: SynthKind): Voice {
  const { ctx, out, note, velocity, unison, bendCents } = args
  const now = ctx.currentTime
  const f0 = midiToHz(note)
  const vel = velocityGain(velocity)
  const env = ctx.createGain()
  const voice = new Voice('synth', env, ctx)
  env.connect(out)
  const level = args.gain * 0.6 * unisonGain(unison)
  const track = (o: OscillatorLike) => {
    if (o.detune) {
      o.detune.value = bendCents
      voice.bend.push({ param: o.detune, base: 0 })
    }
    voice.sources.push(o)
    return o
  }
  const osc = (type: string, hz: number, dest: AudioNodeLike, stopAt: number) => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = hz
    o.connect(dest)
    o.start(now)
    o.stop(stopAt)
    return track(o)
  }
  const node = <T extends AudioNodeLike>(n: T): T => {
    voice.nodes.push(n)
    return n
  }
  const gainNode = (v: number) => {
    const g = node(ctx.createGain())
    g.gain.value = v
    return g
  }
  const sides = unison === 0 ? [0] : [-1, 1]
  const detuned = (side: number, hz: number) => hz * Math.pow(2, (side * UNISON_CENTS[unison]) / 1200)
  const pluck = (g: GainNodeLike, peak: number, mid: number, tail: number, holdAt: number, endAt: number) => {
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(peak, now + 0.002)
    g.gain.linearRampToValueAtTime(peak * mid, now + holdAt)
    g.gain.linearRampToValueAtTime(peak * tail, now + endAt * 0.6)
    g.gain.linearRampToValueAtTime(0, now + endAt)
  }
  // amplitude envelope lives on the voice envelope for sustained sounds and on per-part gains for decaying ones
  env.gain.setValueAtTime(0, now)
  env.gain.linearRampToValueAtTime(level, now + 0.002)

  switch (kind) {
    case 'clav-neck':
    case 'clav-bridge':
    case 'clav-both':
    case 'clav-out-of-phase': {
      const strike = node(ctx.createGain())
      pluck(strike, 0.32 * (0.35 + vel), 0.3, 0.09, 0.22, 3.6)
      strike.connect(env)
      const neck = node(ctx.createBiquadFilter())
      neck.type = 'lowpass'
      neck.frequency.value = 2300
      const bridge = node(ctx.createBiquadFilter())
      bridge.type = 'highpass'
      bridge.frequency.value = kind === 'clav-out-of-phase' ? 900 : 320
      const bridgePeak = node(ctx.createBiquadFilter())
      bridgePeak.type = 'peaking'
      bridgePeak.frequency.value = 3400
      bridgePeak.gain.value = 6
      bridge.connect(bridgePeak)
      const string = gainNode(1)
      for (const side of sides) {
        osc('sawtooth', detuned(side, f0), string, now + 3.7)
        osc('sawtooth', detuned(side, f0) * 1.0012, string, now + 3.7)
      }
      // string → pickups (comb-like colouring from the pickup filters) → envelope
      const pickupSum = gainNode(1)
      if (kind === 'clav-neck' || kind === 'clav-both') {
        string.connect(neck)
        neck.connect(pickupSum)
      }
      if (kind !== 'clav-neck') {
        string.connect(bridge)
        bridgePeak.connect(pickupSum)
      }
      // brightness follows the pluck: a low-pass sweeps down after the strike
      const sweep = node(ctx.createBiquadFilter())
      sweep.type = 'lowpass'
      sweep.Q.value = 1.2
      sweep.frequency.setValueAtTime(Math.min(16000, 2500 + vel * 9000 + f0 * 4), now)
      sweep.frequency.linearRampToValueAtTime(Math.max(1400, f0 * 3), now + 0.35)
      pickupSum.connect(sweep)
      sweep.connect(strike)
      break
    }
    case 'digital-fm-ep': {
      const strike = node(ctx.createGain())
      pluck(strike, 0.3 * (0.4 + vel), 0.42, 0.12, 0.9, 5)
      strike.connect(env)
      for (const side of sides) {
        const carrier = ctx.createOscillator()
        carrier.type = 'sine'
        carrier.frequency.value = detuned(side, f0)
        const mod = ctx.createOscillator()
        mod.type = 'sine'
        mod.frequency.value = detuned(side, f0)
        const idx = node(ctx.createGain())
        const peak = f0 * (1.2 + vel * 2.6)
        idx.gain.setValueAtTime(peak, now)
        idx.gain.linearRampToValueAtTime(peak * 0.16, now + 0.7)
        idx.gain.linearRampToValueAtTime(0, now + 5)
        const tine = ctx.createOscillator()
        tine.type = 'sine'
        tine.frequency.value = detuned(side, f0) * 14
        const tineIdx = node(ctx.createGain())
        tineIdx.gain.setValueAtTime(f0 * 2.5 * vel, now)
        tineIdx.gain.linearRampToValueAtTime(0, now + 0.09)
        mod.connect(idx)
        idx.connect(carrier.frequency)
        tine.connect(tineIdx)
        tineIdx.connect(carrier.frequency)
        carrier.connect(strike)
        for (const o of [carrier, mod, tine]) {
          o.start(now)
          o.stop(now + 5.1)
          track(o)
        }
      }
      break
    }
    case 'digital-layered': {
      const piano = node(ctx.createGain())
      pluck(piano, 0.26 * (0.35 + vel), 0.35, 0.05, 0.6, 4.2)
      piano.connect(env)
      const partials = [
        [1, 1],
        [2, 0.5],
        [3, 0.3],
        [4, 0.16],
      ]
      for (const side of sides) for (const [ratio, amp] of partials) osc('sine', detuned(side, f0) * ratio, (() => {
        const g = gainNode(amp)
        g.connect(piano)
        return g
      })(), now + 4.3)
      // soft pad: slow attack, sustains while the key is held
      const pad = node(ctx.createGain())
      pad.gain.setValueAtTime(0, now)
      pad.gain.linearRampToValueAtTime(0.09 * (0.4 + vel), now + 0.35)
      const padFilter = node(ctx.createBiquadFilter())
      padFilter.type = 'lowpass'
      padFilter.frequency.value = 1500
      padFilter.connect(pad)
      pad.connect(env)
      osc('triangle', f0 * Math.pow(2, 7 / 1200), padFilter, now + 12)
      osc('triangle', f0 * Math.pow(2, -7 / 1200), padFilter, now + 12)
      break
    }
    case 'misc-marimba':
    case 'misc-vibes': {
      const marimba = kind === 'misc-marimba'
      const partials = marimba
        ? [
            [1, 1, 1.1],
            [3.93, 0.32, 0.28],
            [9.9, 0.1, 0.1],
          ]
        : [
            [1, 1, 4.2],
            [4, 0.28, 1.7],
            [10.1, 0.07, 0.5],
          ]
      const trackScale = Math.pow(2, -(note - 60) / 30)
      const bar = node(ctx.createGain())
      bar.connect(env)
      if (!marimba) {
        // motor tremolo of the vibraphone
        const trem = ctx.createOscillator()
        trem.type = 'sine'
        trem.frequency.value = 5.2
        const depth = node(ctx.createGain())
        depth.gain.value = 0.22
        bar.gain.value = 0.78
        trem.connect(depth)
        depth.connect(bar.gain)
        trem.start(now)
        trem.stop(now + 7)
        track(trem)
      }
      for (const [ratio, amp, tau] of partials) {
        const decay = Math.min(6, Math.max(0.15, tau * trackScale))
        const g = node(ctx.createGain())
        const peak = 0.34 * (0.3 + vel) * amp
        g.gain.setValueAtTime(0, now)
        g.gain.linearRampToValueAtTime(peak, now + 0.002)
        g.gain.linearRampToValueAtTime(peak * 0.22, now + decay)
        g.gain.linearRampToValueAtTime(0, now + decay * 3.2)
        g.connect(bar)
        for (const side of sides) osc('sine', detuned(side, f0) * ratio, g, now + decay * 3.3)
      }
      break
    }
  }
  return voice
}

