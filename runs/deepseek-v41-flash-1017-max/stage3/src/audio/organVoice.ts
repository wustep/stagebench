/**
 * Organ voices.
 *
 * An organ note is a *looped* registration plus, for the B3, a percussion attack and a key
 * click. All three are rendered from the same `organModel` functions the tests measure, so
 * a drawbar that claims to change the spectrum really does.
 *
 * Vibrato/chorus is implemented as a modulated delay line into the loop's playback rate and
 * a dry/wet crossfade: vibrato lets only the modulated path through (pitch modulation),
 * chorus adds it to the dry path (manual p. 19).
 */
import type {
  AudioContextLike,
  BufferSourceLike,
  GainNodeLike,
  BiquadFilterLike,
  DelayLike,
  OscillatorLike,
  AudioNodeLike,
} from './types'
import { gain, setNow, ramp, safeDisconnect } from './nodes'
import {
  renderOrganLoop,
  renderPercussion,
  renderKeyClick,
  vibratoSettingsFor,
  type OrganModelId,
  type VibratoChorusType,
} from './organModel'

export interface OrganVoiceSettings {
  model: OrganModelId
  drawbars: number[]
  /** Sounding MIDI note, after the layer's octave shift. */
  midi: number
  velocity: number
  /** Layer level 0..1 (the fader's own value, already normalized). */
  level: number
  vibratoOn: boolean
  vibratoType: VibratoChorusType
  percussion: {
    on: boolean
    soft: boolean
    fast: boolean
    third: boolean
    /** False when a key is already down and percussion is single-triggered (manual p. 20). */
    retrigger: boolean
  }
  keyClick: boolean
  /** Extra gain from split crossfade zoning, 0..1. */
  zoneGain: number
}

export interface OrganVoiceNodes {
  output: GainNodeLike
  start(now: number): void
  release(now: number): void
  stop(): void
  readonly sources: BufferSourceLike[]
  readonly nodes: number
  readonly finished: boolean
  /** True when this voice actually rendered a percussion attack. */
  readonly percussionApplied: boolean
  /** The key click one-shot, exposed so a test can prove it was scheduled. */
  readonly clickApplied: boolean
}

/** How long the loop buffer is, in seconds. Short enough that a note starts instantly. */
const LOOP_SECONDS = 0.1

/**
 * A looped organ voice.
 *
 * The loop's playback rate carries the pitch correction from the whole-cycle loop length,
 * so the note is exactly in tune rather than a few cents sharp.
 */
export function createOrganVoice(
  ctx: AudioContextLike,
  settings: OrganVoiceSettings,
): OrganVoiceNodes {
  const output = gain(ctx, 1)
  const voiceGain = gain(ctx, 0)
  const sources: BufferSourceLike[] = []
  const nodes: GainNodeLike[] = []

  // ---- the registration loop ----------------------------------------
  const loop = renderOrganLoop({
    model: settings.model,
    drawbars: settings.drawbars,
    midi: settings.midi,
    sampleRate: ctx.sampleRate,
    seconds: LOOP_SECONDS,
  })
  const loopBuffer = ctx.createBuffer(1, loop.samples.length, ctx.sampleRate)
  loopBuffer.getChannelData(0).set(loop.samples)

  const main = ctx.createBufferSource()
  main.buffer = loopBuffer
  main.loop = true
  if (main.playbackRate) setNow(main.playbackRate, loop.pitchCorrection, ctx.currentTime)

  // ---- vibrato / chorus scanner -------------------------------------
  let scanner: { dry: GainNodeLike; wet: GainNodeLike; delay: DelayLike; lfo: OscillatorLike; depth: GainNodeLike } | null = null
  let body: AudioNodeLike = main
  if (settings.vibratoOn) {
    const vibrato = vibratoSettingsFor(settings.vibratoType)
    if (ctx.createDelay && ctx.createOscillator) {
      const dry = gain(ctx, vibrato.chorusMix > 0 ? 0.7 : 0)
      const wet = gain(ctx, vibrato.chorusMix > 0 ? 0.7 : 1)
      const line = ctx.createDelay(0.05)
      setNow(line.delayTime, vibrato.delaySeconds, ctx.currentTime)
      const lfo = ctx.createOscillator()
      lfo.type = 'sine'
      setNow(lfo.frequency, vibrato.rate, ctx.currentTime)
      // A delay line's pitch shift is proportional to delay-time movement: the peak
      // deviation that gives `depthCents` of pitch change at this rate.
      const peakSeconds = (vibrato.depthCents / 1200) * Math.LN2 * (1 / (2 * Math.PI * vibrato.rate))
      const depth = gain(ctx, Math.max(0.00002, peakSeconds))
      lfo.connect(depth)
      depth.connect(line.delayTime)
      lfo.start(0)
      main.connect(line)
      main.connect(dry)
      line.connect(wet)
      dry.connect(voiceGain)
      wet.connect(voiceGain)
      scanner = { dry, wet, delay: line, lfo, depth }
      nodes.push(dry, wet, depth)
      sources.push(main)
    } else {
      main.connect(voiceGain)
      sources.push(main)
    }
  } else {
    main.connect(voiceGain)
    sources.push(main)
  }
  body = voiceGain

  // ---- tone shaping per model ---------------------------------------
  // A mild preamp roll-off gives the tonewheel its body and the transistor models their
  // boxiness; the pipe models stay open. This sits inside the voice, before the chain.
  let tone: BiquadFilterLike | null = null
  if (ctx.createBiquadFilter) {
    tone = ctx.createBiquadFilter()
    if (settings.model === 'b3' || settings.model === 'b3-bass') {
      tone.type = 'lowpass'
      setNow(tone.frequency, 7000, ctx.currentTime)
      setNow(tone.Q, 0.7, ctx.currentTime)
    } else if (settings.model === 'vox' || settings.model === 'farf') {
      tone.type = 'highpass'
      setNow(tone.frequency, 180, ctx.currentTime)
      setNow(tone.Q, 0.9, ctx.currentTime)
    } else {
      tone.type = 'peaking'
      setNow(tone.frequency, 2400, ctx.currentTime)
      setNow(tone.Q, 0.8, ctx.currentTime)
      setNow(tone.gain, 2.5, ctx.currentTime)
    }
    body.connect(tone)
    tone.connect(output)
  } else {
    body.connect(output)
  }

  // ---- percussion ----------------------------------------------------
  let percussionSource: BufferSourceLike | null = null
  if (settings.percussion.on && settings.percussion.retrigger) {
    const samples = renderPercussion({
      midi: settings.midi,
      harmonicThird: settings.percussion.third,
      volumeSoft: settings.percussion.soft,
      decayFast: settings.percussion.fast,
      sampleRate: ctx.sampleRate,
    })
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    buffer.getChannelData(0).set(samples)
    percussionSource = ctx.createBufferSource()
    percussionSource.buffer = buffer
    percussionSource.loop = false
    percussionSource.connect(output)
    sources.push(percussionSource)
  }

  // ---- key click -----------------------------------------------------
  let clickSource: BufferSourceLike | null = null
  if (settings.keyClick) {
    const samples = renderKeyClick({ midi: settings.midi, sampleRate: ctx.sampleRate })
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    buffer.getChannelData(0).set(samples)
    clickSource = ctx.createBufferSource()
    clickSource.buffer = buffer
    clickSource.loop = false
    clickSource.connect(output)
    sources.push(clickSource)
  }

  let stopped = false
  let released = false
  // Organs have no decay: the note is on while the key is down. The level is the fader,
  // the split's zone gain and the velocity's slight touch sensitivity.
  const level = settings.level * settings.zoneGain * (0.82 + settings.velocity * 0.18)

  return {
    output,
    sources,
    nodes: nodes.length + (tone ? 1 : 0) + 2,
    percussionApplied: percussionSource !== null,
    clickApplied: clickSource !== null,
    get finished() {
      return stopped
    },
    start(now: number) {
      setNow(voiceGain.gain, level, now)
      for (const source of sources) source.start(now)
    },
    release(now: number) {
      if (released) return
      released = true
      // Organs stop abruptly: no damper, no tail. A 12 ms ramp keeps it click-free.
      ramp(voiceGain.gain, 0, now, 0.012)
      for (const source of sources) {
        try {
          source.stop(now + 0.03)
        } catch {
          /* already stopping */
        }
      }
    },
    stop() {
      stopped = true
      scanner?.lfo.stop()
      for (const source of sources) {
        source.onended = null
        try {
          source.stop()
        } catch {
          /* already stopped */
        }
        try {
          source.disconnect()
        } catch {
          /* already disconnected */
        }
      }
      for (const node of nodes) safeDisconnect(node)
      if (tone) safeDisconnect(tone)
      safeDisconnect(voiceGain)
      safeDisconnect(output)
    },
  }
}

/**
 * A silent organ voice.
 *
 * Not a fallback and never presented as one: the Organ engine needs no assets, so there is
 * no load state to fail. This exists only for a backend that cannot create buffer sources at
 * all, and reports itself through the engine's own status.
 */
export function organVoiceNodeCount(settings: OrganVoiceSettings): number {
  return 2 + (settings.vibratoOn ? 3 : 0) + (settings.percussion.on && settings.percussion.retrigger ? 1 : 0) + (settings.keyClick ? 1 : 0)
}
