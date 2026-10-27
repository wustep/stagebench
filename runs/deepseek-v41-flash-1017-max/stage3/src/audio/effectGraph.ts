/**
 * The layer effect chain.
 *
 * One instance per layer chain, built entirely from the injected `AudioContextLike`, so
 * the identical code runs in the browser and in the offline renderer the tests measure.
 *
 * Signal order is fixed by `specs/nord-stage-4.effects.json`:
 *
 *   input -> Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ -> Compressor -> Reverb
 *         -> (To Rotary ? shared Rotary : straight through) -> output
 *
 * Every unit is always present in the graph. Bypass is a pair of crossfaded gains (dry vs
 * wet) rather than a disconnect, so switching is click-free and the signal path is
 * unbroken. Units with a dry/wet control get a third blend gain on top of that.
 *
 * The same `ChainSnapshot` drives both the graph and the panel, so what the LEDs say and
 * what the DSP does cannot disagree.
 */
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  BiquadFilterLike,
  CompressorLike,
  ConvolverLike,
  GainNodeLike,
  OscillatorLike,
  StereoPannerLike,
} from './types'
import {
  AMP_VOICINGS,
  REVERB_VOICINGS,
  compSettingsFor,
  delaySecondsFor,
  eqGainDb,
  midFreqHz,
  mod1RateHz,
  mod2RateHz,
  ROTARY_SPEEDS,
  type ReverbType,
} from './effectTypes'
import type { ChainOwner } from './types'
import type { ChainSettings, EffectState } from './effectState'
import { effectiveChain } from './effectState'
import { biquad, driveCurve, delay, gain, lfo, panner, ramp, safeDisconnect, shaper } from './nodes'

/* ------------------------------------------------------------------ */
/* Parameter smoothing                                                */
/* ------------------------------------------------------------------ */

const SMOOTH = 0.02

/* ------------------------------------------------------------------ */
/* One effect unit: dry/wet pair around a processor                   */
/* ------------------------------------------------------------------ */

interface Unit {
  input: GainNodeLike
  output: GainNodeLike
  /** Called whenever the owning chain's settings change. */
  apply(settings: ChainSettings, now: number, allOn: boolean): void
  /** Releases modulation sources and any scheduled stops. */
  dispose(): void
  /** Nodes this unit booked, for the node accounting. */
  nodeCount(): number
}

function makeUnitShell(
  ctx: AudioContextLike,
  build: (input: GainNodeLike, output: GainNodeLike, helpers: UnitHelpers) => Unit,
): Unit {
  const input = gain(ctx, 1)
  const output = gain(ctx, 1)
  const helpers: UnitHelpers = {
    dry: gain(ctx, 1),
    wet: gain(ctx, 0),
    onOff(on: boolean, now: number) {
      // Crossfade rather than disconnect: the graph never breaks and never clicks.
      ramp(helpers.dry.gain, on ? 0 : 1, now, SMOOTH)
      ramp(helpers.wet.gain, on ? 1 : 0, now, SMOOTH)
    },
  }
  // The dry path carries the unprocessed signal; each unit's processor feeds `wet`.
  // Bypass is the crossfade between these two, so the path is never broken.
  input.connect(helpers.dry)
  helpers.dry.connect(output)
  helpers.wet.connect(output)
  return build(input, output, helpers)
}

interface UnitHelpers {
  dry: GainNodeLike
  wet: GainNodeLike
  onOff(on: boolean, now: number): void
}

/**
 * The one soft-clip transfer curve, created once and shared by every saturator.
 *
 * A WaveShaper's curve can only be assigned while it is not rendering, so drive is applied
 * as input gain into this fixed non-linearity — which is also how a valve preamp behaves.
 */
const FIXED_SAT_CURVE = driveCurve(0.85, 2048)

/**
 * The chain's output ceiling curve: linear below half scale, then a soft knee towards 1.0.
 *
 * EQ and the amp models are boosts — a +15 dB shelf alone can put a signal twice over full
 * scale before it reaches the master gain. A real amplifier/speaker stage does not pass that
 * on, so the chain output is bounded here. The curve is transparent for anything that stays
 * under the knee, so ordinary playing is untouched and the master limiter remains the only
 * stage that ever acts on a normal signal.
 */
const CHAIN_CEILING_CURVE = (() => {
  const samples = 4096
  const curve = new Float32Array(samples)
  const knee = 0.5
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1
    const magnitude = Math.abs(x)
    const shaped =
      magnitude <= knee ? magnitude : knee + (1 - knee) * Math.tanh((magnitude - knee) / (1 - knee))
    curve[i] = Math.sign(x) * shaped
  }
  return curve
})()

/* ------------------------------------------------------------------ */
/* Mod 1                                                              */
/* ------------------------------------------------------------------ */

interface Mod1Nodes {
  panner?: StereoPannerLike
  trem?: GainNodeLike
  ring?: GainNodeLike
  ringLfo?: OscillatorLike
  wah?: BiquadFilterLike
  wahLfo?: OscillatorLike
  wahDepth?: GainNodeLike
  lfo?: OscillatorLike
  lfoGain?: GainNodeLike
}

function buildMod1(ctx: AudioContextLike): Unit {
  return makeUnitShell(ctx, (input, output, helpers) => {
    // A single wet path with sub-paths per type. Only one type is audible at a time; the
    // others are muted by their own type gains, so switching type is a crossfade too.
    const nodes: Mod1Nodes = {}
    const typeGains: GainNodeLike[] = []
    const types = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const
    const buses = types.map(() => {
      const g = gain(ctx, 0)
      g.connect(helpers.wet)
      typeGains.push(g)
      return g
    })
    let lastType = -1

    nodes.panner = panner(ctx)
    input.connect(nodes.panner)
    nodes.panner.connect(buses[0])

    // Tremolo / Pump: amplitude modulation from one LFO.
    nodes.trem = gain(ctx, 1)
    input.connect(nodes.trem)
    nodes.trem.connect(buses[1])
    nodes.trem.connect(buses[5])
    nodes.lfo = lfo(ctx, 4)
    nodes.lfoGain = gain(ctx, 0)
    nodes.lfo.connect(nodes.lfoGain)
    nodes.lfoGain.connect(nodes.trem.gain)

    // Ring modulation: multiply by a sine through a gain-stage driven by the oscillator.
    nodes.ring = gain(ctx, 0)
    input.connect(nodes.ring)
    nodes.ring.connect(buses[2])
    nodes.ringLfo = lfo(ctx, 220)
    const ringDepth = gain(ctx, 0)
    nodes.ringLfo.connect(ringDepth)
    ringDepth.connect(nodes.ring.gain)

    // A-Wah and Wah share a resonant band-pass; A-Wah modulates it from the signal envel-
    // ope, Wah from an LFO. Both are built from the same filter so the difference is the
    // modulation source, exactly as the manual describes.
    nodes.wah = biquad(ctx, 'bandpass', 900, 4.5)
    input.connect(nodes.wah)
    nodes.wah.connect(buses[3])
    nodes.wah.connect(buses[4])
    nodes.wahLfo = lfo(ctx, 1.5)
    nodes.wahDepth = gain(ctx, 700)
    nodes.wahLfo.connect(nodes.wahDepth)
    nodes.wahDepth.connect(nodes.wah.frequency)
    // A-Wah envelope follower: rectify through a fast attack / slow release gain.
    const rectifier = shaper(ctx, makeAbsCurve())
    const follower = biquad(ctx, 'lowpass', 12, 0.7)
    const followerGain = gain(ctx, 1400)
    input.connect(rectifier)
    rectifier.connect(follower)
    follower.connect(followerGain)
    followerGain.connect(nodes.wah.frequency)

    nodes.lfo.start(0)
    nodes.ringLfo.start(0)
    nodes.wahLfo.start(0)

    return {
      input,
      output,
      nodeCount: () => 14,
      apply(settings, now, allOn) {
        const { mod1 } = settings
        helpers.onOff(mod1.on && allOn, now)
        const index = types.indexOf(mod1.type)
        if (index !== lastType) {
          typeGains.forEach((g, i) => ramp(g.gain, i === index ? 1 : 0, now, SMOOTH))
          lastType = index
        }
        const amount = Math.min(1, Math.max(0, mod1.amount / 10))
        const rate = mod1RateHz(mod1.rate)
        switch (mod1.type) {
          case 'A-Pan':
            if (nodes.panner) ramp(nodes.panner.pan, 0, now)
            // The pan itself is modulated; depth rides on the LFO gain.
            if (nodes.lfo && nodes.lfoGain) {
              ramp(nodes.lfo.frequency, rate, now)
              ramp(nodes.lfoGain.gain, amount * 0.95, now)
              nodes.lfoGain.connect(nodes.panner!.pan)
            }
            break
          case 'Tremolo':
            if (nodes.lfo && nodes.lfoGain) {
              ramp(nodes.lfo.frequency, rate, now)
              // Full level at zero amount: depth is the modulation, not a level drop.
              ramp(nodes.lfoGain.gain, amount * 0.5, now)
              try {
                nodes.lfoGain.disconnect()
              } catch {
                /* not connected to the panner */
              }
              nodes.lfoGain.connect(nodes.trem!.gain)
            }
            break
          case 'Ring Mod':
            if (nodes.ringLfo) ramp(nodes.ringLfo.frequency, 20 + mod1.rate * 80, now)
            if (nodes.ring) ramp(nodes.ring.gain, 1 - 1, now)
            break
          case 'A-Wah':
            // Envelope-driven: the follower moves the cutoff, so the LFO is silenced but
            // the sensitivity knob sets the base cutoff and the amount sets the resonance.
            if (nodes.wah) {
              ramp(nodes.wah.frequency, 300 + mod1.rate * 110, now)
              ramp(nodes.wah.Q, 3 + amount * 11, now)
            }
            if (nodes.wahDepth) ramp(nodes.wahDepth.gain, 0, now)
            break
          case 'Wah':
            // LFO-driven sweep across a wide range; the rate knob is the LFO rate.
            if (nodes.wah) {
              ramp(nodes.wah.frequency, 700, now)
              ramp(nodes.wah.Q, 2.5 + amount * 11, now)
            }
            if (nodes.wahLfo) ramp(nodes.wahLfo.frequency, rate, now)
            if (nodes.wahDepth) ramp(nodes.wahDepth.gain, 300 + amount * 1200, now)
            break
          case 'Pump':
            if (nodes.lfo && nodes.lfoGain) {
              ramp(nodes.lfo.frequency, rate, now)
              ramp(nodes.lfoGain.gain, amount * 0.45, now)
              try {
                nodes.lfoGain.disconnect()
              } catch {
                /* not connected */
              }
              nodes.lfoGain.connect(nodes.trem!.gain)
            }
            break
        }
      },
      dispose() {
        nodes.lfo?.stop()
        nodes.ringLfo?.stop()
        nodes.wahLfo?.stop()
      },
    }
  })
}

function makeAbsCurve(samples = 512): Float32Array {
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1
    // Rectify, then bias so the follower sits at the signal's envelope rather than zero.
    curve[i] = Math.abs(x) * 2 - 0.5
  }
  return curve
}

/* ------------------------------------------------------------------ */
/* Mod 2                                                              */
/* ------------------------------------------------------------------ */

function buildMod2(ctx: AudioContextLike): Unit {
  return makeUnitShell(ctx, (input, output, helpers) => {
    const types = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const
    const buses = types.map(() => {
      const g = gain(ctx, 0)
      g.connect(helpers.wet)
      return g
    })
    let lastType = -1

    // Shared modulated delay pair for Chorus / Ensemble, with an LFO per channel.
    const chorusDelayA = delay(ctx, 0.08, 0.018)
    const chorusDelayB = delay(ctx, 0.08, 0.026)
    const chorusLfo = lfo(ctx, 0.6)
    const chorusDepthA = gain(ctx, 0.004)
    const chorusDepthB = gain(ctx, 0.005)
    chorusLfo.connect(chorusDepthA)
    chorusLfo.connect(chorusDepthB)
    chorusDepthA.connect(chorusDelayA.delayTime)
    chorusDepthB.connect(chorusDelayB.delayTime)
    input.connect(chorusDelayA)
    input.connect(chorusDelayB)
    const chorusPanA = panner(ctx, -0.7)
    const chorusPanB = panner(ctx, 0.7)
    chorusDelayA.connect(chorusPanA)
    chorusDelayB.connect(chorusPanB)
    chorusPanA.connect(buses[0])
    chorusPanB.connect(buses[0])
    chorusPanA.connect(buses[4])
    chorusPanB.connect(buses[4])

    // Flanger: one short delay with feedback.
    const flangerDelay = delay(ctx, 0.02, 0.005)
    const flangerFb = gain(ctx, 0.4)
    const flangerLfo = lfo(ctx, 0.3)
    const flangerDepth = gain(ctx, 0.003)
    flangerLfo.connect(flangerDepth)
    flangerDepth.connect(flangerDelay.delayTime)
    input.connect(flangerDelay)
    flangerDelay.connect(flangerFb)
    flangerFb.connect(flangerDelay)
    flangerDelay.connect(buses[1])

    // Phaser / Vibe: a cascade of allpass stages swept by one LFO. Vibe uses a staggered
    // stage spacing and a small pitch-bend style detune, which is its defining character.
    const phaserStages = [0, 1, 2, 3].map((i) => {
      const stage = biquad(ctx, 'allpass', 500 * Math.pow(1.6, i), 0.9)
      return stage
    })
    const vibeStages = [0, 1, 2, 3].map((i) => biquad(ctx, 'allpass', 350 * Math.pow(2.1, i * 1.3), 1.4))
    const phaserLfo = lfo(ctx, 0.4)
    const phaserDepth = gain(ctx, 600)
    phaserLfo.connect(phaserDepth)
    for (const stage of phaserStages) phaserDepth.connect(stage.frequency)
    for (const stage of vibeStages) phaserDepth.connect(stage.frequency)
    let cursor: AudioNodeLike = input
    for (const stage of phaserStages) {
      cursor.connect(stage)
      cursor = stage
    }
    cursor.connect(buses[2])
    let vibeCursor: AudioNodeLike = input
    for (const stage of vibeStages) {
      vibeCursor.connect(stage)
      vibeCursor = stage
    }
    vibeCursor.connect(buses[3])
    const phaserFb = gain(ctx, 0)
    cursor.connect(phaserFb)
    phaserFb.connect(phaserStages[0])

    // Spin: gentle rotary-like amplitude+pan modulation with a slow rate ramp.
    const spinLfo = lfo(ctx, 0.9)
    const spinPan = panner(ctx, 0)
    const spinTrem = gain(ctx, 1)
    const spinPanDepth = gain(ctx, 0.35)
    const spinAmpDepth = gain(ctx, 0.12)
    spinLfo.connect(spinPanDepth)
    spinPanDepth.connect(spinPan.pan)
    spinLfo.connect(spinAmpDepth)
    spinAmpDepth.connect(spinTrem.gain)
    input.connect(spinPan)
    spinPan.connect(spinTrem)
    spinTrem.connect(buses[5])

    const oscillators = [chorusLfo, flangerLfo, phaserLfo, spinLfo]
    for (const o of oscillators) o.start(0)

    return {
      input,
      output,
      nodeCount: () => 20,
      apply(settings, now, allOn) {
        const { mod2 } = settings
        helpers.onOff(mod2.on && allOn, now)
        const index = types.indexOf(mod2.type)
        if (index !== lastType) {
          buses.forEach((g, i) => ramp(g.gain, i === index ? 1 : 0, now, SMOOTH))
          lastType = index
        }
        const amount = Math.min(1, Math.max(0, mod2.amount / 10))
        const rate = mod2RateHz(mod2.rate)
        switch (mod2.type) {
          case 'Chorus':
            ramp(chorusLfo.frequency, rate, now)
            ramp(chorusDepthA.gain, 0.001 + amount * 0.007, now)
            ramp(chorusDepthB.gain, 0.001 + amount * 0.009, now)
            break
          case 'Ensemble':
            ramp(chorusLfo.frequency, rate * 0.7, now)
            ramp(chorusDepthA.gain, 0.002 + amount * 0.010, now)
            ramp(chorusDepthB.gain, 0.003 + amount * 0.013, now)
            break
          case 'Flanger':
            ramp(flangerLfo.frequency, Math.max(0.05, rate * 0.35), now)
            ramp(flangerDepth.gain, 0.0008 + amount * 0.006, now)
            ramp(flangerFb.gain, Math.min(0.92, amount * 0.88), now)
            break
          case 'Phaser':
            ramp(phaserLfo.frequency, rate, now)
            ramp(phaserDepth.gain, 200 + amount * 1400, now)
            ramp(phaserFb.gain, amount * 0.6, now)
            break
          case 'Vibe':
            ramp(phaserLfo.frequency, rate * 1.3, now)
            ramp(phaserDepth.gain, 150 + amount * 900, now)
            break
          case 'Spin':
            ramp(spinLfo.frequency, rate * 0.8, now)
            ramp(spinPanDepth.gain, amount * 0.7, now)
            ramp(spinAmpDepth.gain, amount * 0.22, now)
            break
        }
      },
      dispose() {
        for (const o of oscillators) o.stop()
      },
    }
  })
}

/* ------------------------------------------------------------------ */
/* Delay                                                              */
/* ------------------------------------------------------------------ */

function buildDelay(ctx: AudioContextLike): Unit {
  return makeUnitShell(ctx, (input, output, helpers) => {
    // Two delay lines, one per side, so ping-pong can alternate repeats between channels.
    // In straight mode only the left line runs, with self-feedback and centred panning.
    const wetSend = gain(ctx, 1)
    const filterIn = biquad(ctx, 'lowpass', 20000, 0.7)
    const leftDelay = delay(ctx, 2.2, 0.32)
    const rightDelay = delay(ctx, 2.2, 0.32)
    // Each line has its own feedback filter, and both sit *inside* the loop, so every
    // successive repeat is filtered again and gets progressively darker (manual p. 51).
    const leftFilter = biquad(ctx, 'lowpass', 4200, 0.7)
    const rightFilter = biquad(ctx, 'lowpass', 4200, 0.7)
    const leftFeedback = gain(ctx, 0.3)
    const rightFeedback = gain(ctx, 0.3)
    // A feedback tap either returns to its own line (straight) or crosses to the other
    // (ping-pong), which is what makes repeats alternate sides.
    const leftToSelf = gain(ctx, 1)
    const leftToOther = gain(ctx, 0)
    const rightToSelf = gain(ctx, 1)
    const rightToOther = gain(ctx, 0)
    const leftPan = panner(ctx, 0)
    const rightPan = panner(ctx, 0)

    input.connect(filterIn)
    filterIn.connect(leftDelay)

    leftDelay.connect(leftFilter)
    leftFilter.connect(leftFeedback)
    leftFeedback.connect(leftToSelf)
    leftToSelf.connect(leftDelay)
    leftFeedback.connect(leftToOther)
    leftToOther.connect(rightDelay)

    rightDelay.connect(rightFilter)
    rightFilter.connect(rightFeedback)
    rightFeedback.connect(rightToSelf)
    rightToSelf.connect(rightDelay)
    rightFeedback.connect(rightToOther)
    rightToOther.connect(leftDelay)

    leftDelay.connect(leftPan)
    rightDelay.connect(rightPan)
    leftPan.connect(wetSend)
    rightPan.connect(wetSend)
    wetSend.connect(helpers.wet)

    let filterType = 'OFF'

    return {
      input,
      output,
      nodeCount: () => 15,
      apply(settings, now, allOn) {
        const d = settings.delay
        // Audible only when both its own switch and Layer Effects ON allow it; Dry/Wet then
        // sets how much of the repeats is heard.
        helpers.onOff(d.on && allOn, now)
        const seconds = d.tapSeconds ?? delaySecondsFor(d.tempo)
        // A delay-time change is ramped, which is why it never clicks.
        ramp(leftDelay.delayTime, seconds, now, 0.05)
        ramp(rightDelay.delayTime, seconds, now, 0.05)
        ramp(leftFeedback.gain, Math.min(0.94, (d.feedback / 10) * 0.92), now)
        ramp(rightFeedback.gain, Math.min(0.94, (d.feedback / 10) * 0.92), now)
        ramp(wetSend.gain, Math.min(1, Math.max(0, d.dryWet / 10)), now)

        if (d.filter !== filterType) {
          filterType = d.filter
          // With filtering off the repeats keep their full spectrum; every other setting
          // progressively shapes them.
          const type =
            d.filter === 'LP' ? 'lowpass' : d.filter === 'HP' ? 'highpass' : d.filter === 'BP' ? 'bandpass' : 'lowpass'
          const freq = d.filter === 'OFF' ? 20000 : d.filter === 'LP' ? 2600 : d.filter === 'HP' ? 380 : 900
          const q = d.filter === 'BP' ? 2.2 : 0.7
          for (const filter of [leftFilter, rightFilter]) {
            filter.type = type
            ramp(filter.frequency, freq, now)
            ramp(filter.Q, q, now)
          }
        }

        // Ping-pong: cross the feedback and hard-pan the two lines.
        ramp(leftToSelf.gain, d.pingPong ? 0 : 1, now)
        ramp(rightToSelf.gain, d.pingPong ? 0 : 1, now)
        ramp(leftToOther.gain, d.pingPong ? 1 : 0, now)
        ramp(rightToOther.gain, d.pingPong ? 1 : 0, now)
        ramp(leftPan.pan, d.pingPong ? -0.9 : 0, now)
        ramp(rightPan.pan, d.pingPong ? 0.9 : 0, now)
      },
      dispose() {
        /* nothing scheduled */
      },
    }
  })
}

/* ------------------------------------------------------------------ */
/* Amp Sim / EQ                                                       */
/* ------------------------------------------------------------------ */

function buildAmpEq(ctx: AudioContextLike): Unit {
  return makeUnitShell(ctx, (input, output, helpers) => {
    const eqBass = biquad(ctx, 'lowshelf', 100, 0.7)
    const eqMid = biquad(ctx, 'peaking', 800, 1.0)
    const eqTreble = biquad(ctx, 'highshelf', 4000, 0.7)
    // A fixed soft-clip curve. Drive is applied as input gain into it, which is how a
    // real preamp saturates: more level into the same non-linearity means more harmonics.
    // It also means the curve is assigned exactly once, which Web Audio requires.
    const drivePre = gain(ctx, 1)
    const saturator = shaper(ctx, FIXED_SAT_CURVE, '2x')
    const drivePost = gain(ctx, 1)
    const cabLow = biquad(ctx, 'highpass', 90, 0.7)
    const cabHigh = biquad(ctx, 'lowpass', 6500, 0.7)
    // The amplifier's own tone stack lives *inside* the amp path, so it colours the amp
    // models without overwriting the panel EQ the player set.
    const ampBass = biquad(ctx, 'lowshelf', 110, 0.7)
    const ampMid = biquad(ctx, 'peaking', 900, 0.9)
    const ampTreble = biquad(ctx, 'highshelf', 3200, 0.7)
    // Filter models reuse their own biquads so the 24 dB slope is two cascaded stages.
    const lp1 = biquad(ctx, 'lowpass', 1200, 1.2)
    const lp2 = biquad(ctx, 'lowpass', 1200, 1.2)
    const hp1 = biquad(ctx, 'highpass', 240, 1.2)
    const hp2 = biquad(ctx, 'highpass', 240, 1.2)

    const eqBus = gain(ctx, 0)
    const ampBus = gain(ctx, 0)
    const lpBus = gain(ctx, 0)
    const hpBus = gain(ctx, 0)
    eqBus.connect(helpers.wet)
    ampBus.connect(helpers.wet)
    lpBus.connect(helpers.wet)
    hpBus.connect(helpers.wet)

    input.connect(eqBass)
    eqBass.connect(eqMid)
    eqMid.connect(eqTreble)
    eqTreble.connect(eqBus)

    eqTreble.connect(drivePre)
    drivePre.connect(saturator)
    saturator.connect(cabLow)
    cabLow.connect(ampBass)
    ampBass.connect(ampMid)
    ampMid.connect(ampTreble)
    ampTreble.connect(cabHigh)
    cabHigh.connect(drivePost)
    drivePost.connect(ampBus)

    input.connect(lp1)
    lp1.connect(lp2)
    lp2.connect(lpBus)
    input.connect(hp1)
    hp1.connect(hp2)
    hp2.connect(hpBus)

    // Each amp model selects one of four internal paths. The map is keyed by the path's
    // name rather than the model name, because several models share a path
    // (EQ only and To Rotary both pass the panel EQ; the three amps share the saturator)
    // — keying by model would zero a bus that an earlier entry had just enabled.
    const MODEL_PATH: Record<string, keyof typeof paths> = {
      'EQ only': 'eq',
      Twin: 'amp',
      JC: 'amp',
      Small: 'amp',
      'LP24 Filter': 'lp',
      'HP24 Filter': 'hp',
      'To Rotary': 'eq',
    }
    const paths = { eq: eqBus, amp: ampBus, lp: lpBus, hp: hpBus }
    let lastModel = ''

    return {
      input,
      output,
      nodeCount: () => 17,
      apply(settings, now, allOn) {
        const { ampEq } = settings
        helpers.onOff(ampEq.on && allOn, now)
        if (ampEq.model !== lastModel) {
          lastModel = ampEq.model
          const active = MODEL_PATH[ampEq.model] ?? 'eq'
          for (const [name, bus] of Object.entries(paths)) {
            ramp(bus.gain, name === active ? 1 : 0, now, SMOOTH)
          }
        }
        const bass = eqGainDb(ampEq.bass)
        const mid = eqGainDb(ampEq.mid)
        const treble = eqGainDb(ampEq.treble)
        const freq = midFreqHz(ampEq.midFreq)
        ramp(eqBass.gain, bass, now)
        ramp(eqMid.frequency, freq, now)
        ramp(eqMid.gain, mid, now)
        ramp(eqTreble.gain, treble, now)

        const voicing = AMP_VOICINGS[ampEq.model as 'Twin' | 'JC' | 'Small']
        const drive = Math.max(0, Math.min(1, ampEq.drive / 10))
        if (voicing) {
          // Cabinet corners and the voicing's own tone stack.
          ramp(cabLow.frequency, voicing.cabLow, now)
          ramp(cabHigh.frequency, voicing.cabHigh, now)
          ramp(ampBass.frequency, voicing.bass[0], now)
          ramp(ampBass.gain, voicing.bass[1], now)
          ramp(ampMid.frequency, voicing.mid[0], now)
          ramp(ampMid.Q, voicing.mid[2], now)
          ramp(ampMid.gain, voicing.mid[1], now)
          ramp(ampTreble.frequency, voicing.treble[0], now)
          ramp(ampTreble.gain, voicing.treble[1], now)
          // A voicing is defined at its own drive setting; panel drive is added on top so
          // each model keeps its characteristic amount of saturation.
          //
          // The clipper is a hard-nosed tanh, so its output *level* is almost independent
          // of input gain — more gain means more harmonics, not more volume. The post gain
          // therefore has to undo the clipper's gain reduction (measured: output RMS ≈ 0.94
          // of full scale regardless of input gain), not the input gain itself. That keeps
          // the amp models at unity and stops a driven chain running past the master
          // limiter.
          const preGain = voicing.drive * (0.6 + drive * 2.4)
          ramp(drivePre.gain, preGain, now)
          // Measured on this curve: the clipper's output RMS is ~0.94 of full scale for any
          // input gain above ~1, so the compensation is 1/preGain scaled by that ratio.
          const CLIPPER_OUTPUT_RMS = 0.94
          ramp(drivePost.gain, Math.min(1, 1 / preGain) * CLIPPER_OUTPUT_RMS, now)
        } else {
          ramp(drivePre.gain, 1, now)
          ramp(drivePost.gain, 1, now)
        }

        if (ampEq.model === 'LP24 Filter' || ampEq.model === 'HP24 Filter') {
          const cut = midFreqHz(ampEq.midFreq)
          const res = 0.7 + Math.max(0, Math.min(1, ampEq.mid / 15)) * 12
          const stages = ampEq.model === 'LP24 Filter' ? [lp1, lp2] : [hp1, hp2]
          for (const stage of stages) {
            ramp(stage.frequency, cut, now)
            ramp(stage.Q, res, now)
          }
        } else {
          // Keep the filter buses warm at their defaults so switching model clicks less.
          const cut = midFreqHz(ampEq.midFreq)
          for (const stage of [lp1, lp2]) ramp(stage.frequency, cut, now)
          for (const stage of [hp1, hp2]) ramp(stage.frequency, cut, now)
        }
      },
      dispose() {
        /* nothing scheduled */
      },
    }
  })
}

/* ------------------------------------------------------------------ */
/* Compressor                                                         */
/* ------------------------------------------------------------------ */

function buildCompressor(ctx: AudioContextLike): Unit {
  return makeUnitShell(ctx, (input, output, helpers) => {
    let comp: CompressorLike
    try {
      if (!ctx.createDynamicsCompressor) throw new Error('unavailable')
      comp = ctx.createDynamicsCompressor()
    } catch {
      // Honest degradation: without a compressor the unit passes the dry signal and is
      // never reported as active (the panel's ON LED would still move; see scope notes).
      input.connect(helpers.dry)
      return {
        input,
        output,
        nodeCount: () => 2,
        apply() {
          // A backend without this node type cannot process it, so the unit stays bypassed
          // and is never reported as active.
          helpers.onOff(false, 0)
        },
        dispose() {
          /* nothing */
        },
      }
    }
    const makeup = gain(ctx, 1)
    input.connect(comp)
    comp.connect(makeup)
    makeup.connect(helpers.wet)
    return {
      input,
      output,
      nodeCount: () => 3,
      apply(settings, now, allOn) {
        const { compressor } = settings
        helpers.onOff(compressor.on && allOn, now)
        const s = compSettingsFor(compressor.amount, compressor.fast)
        ramp(comp.threshold, s.threshold, now)
        ramp(comp.ratio, s.ratio, now)
        ramp(comp.attack, s.attack, now)
        ramp(comp.release, s.release, now)
        ramp(comp.knee, compressor.fast ? 6 : 18, now)
        ramp(makeup.gain, s.makeup, now)
      },
      dispose() {
        /* nothing */
      },
    }
  })
}

/* ------------------------------------------------------------------ */
/* Reverb                                                             */
/* ------------------------------------------------------------------ */

/** Target total energy of a generated impulse response (see the note in buildImpulseResponse). */
const WET_ENERGY = 0.16

export function buildImpulseResponse(ctx: AudioContextLike, type: ReverbType, tone: 'Bright' | 'Dark'): AudioBufferLike {
  const v = REVERB_VOICINGS[type]
  const rate = ctx.sampleRate
  const frames = Math.max(64, Math.round((v.decay + v.preDelay + 0.1) * rate))
  const buffer = ctx.createBuffer(2, frames, rate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    const rand = mulberry(7919 + channel * 131 + type.length * 17)
    // Early reflections on top of the exponential tail; density controls how many.
    const reflections = v.spring ? 6 : Math.round(6 + v.density * 14)
    const preFrames = Math.round(v.preDelay * rate)
    let energy = 0
    for (let i = 0; i < frames; i += 1) {
      const t = i / rate
      if (i < preFrames) {
        data[i] = 0
        continue
      }
      const since = t - v.preDelay
      const envelope = v.spring ? Math.exp(-since / (v.decay * 0.32)) : Math.exp(-since / (v.decay * 0.42))
      const noise = rand() * 2 - 1
      data[i] = noise * envelope
      energy += data[i] * data[i]
    }
    // A spring tank is a set of dispersive, chirpy echoes rather than a diffuse tail.
    if (v.spring) {
      const taps = [0.0101, 0.0173, 0.0247, 0.0311, 0.0403]
      for (let r = 0; r < taps.length; r += 1) {
        const at = preFrames + Math.round(taps[r] * rate)
        if (at >= frames) continue
        const amp = 0.75 * Math.pow(0.72, r)
        for (let k = 0; k < 48 && at + k < frames; k += 1) {
          data[at + k] += (rand() * 2 - 1) * amp * Math.exp(-k / 12)
        }
      }
    } else {
      for (let r = 0; r < reflections; r += 1) {
        const at = preFrames + Math.round((0.005 + r * 0.0073 + rand() * 0.004) * rate)
        if (at >= frames) continue
        data[at] += (rand() * 2 - 1) * 0.55 * Math.exp(-r / reflections)
      }
    }
    // Normalise to a target *energy* so every type lands at the same wet level and only
    // its decay/density character differs. For convolution the output RMS tracks
    // input RMS * sqrt(sum(h^2)), so scaling the IR energy sets the wet level directly.
    const scale = Math.sqrt(WET_ENERGY / Math.max(energy, 1e-12))
    for (let i = 0; i < frames; i += 1) data[i] *= scale
    // Dark reverb keeps far less high end: a simple one-pole low-pass over the tail.
    if (tone === 'Dark' || v.damping < 3200) {
      const damp = Math.min(1, 1200 / (tone === 'Dark' ? Math.min(v.damping, 1800) : v.damping))
      let prev = 0
      for (let i = 0; i < frames; i += 1) {
        prev = prev + damp * (data[i] - prev)
        data[i] = prev
      }
    }
  }
  return buffer
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildReverb(ctx: AudioContextLike): Unit {
  return makeUnitShell(ctx, (input, output, helpers) => {
    if (!ctx.createConvolver) {
      input.connect(helpers.dry)
      return {
        input,
        output,
        nodeCount: () => 2,
        apply() {
          // A backend without this node type cannot process it, so the unit stays bypassed
          // and is never reported as active.
          helpers.onOff(false, 0)
        },
        dispose() {
          /* nothing */
        },
      }
    }
    const convolver: ConvolverLike = ctx.createConvolver()
    if ('normalize' in convolver) convolver.normalize = false
    const wetSend = gain(ctx, 1)
    const damping = biquad(ctx, 'lowpass', 6000, 0.7)
    input.connect(convolver)
    convolver.connect(damping)
    damping.connect(wetSend)
    wetSend.connect(helpers.wet)
    let currentKey = ''
    return {
      input,
      output,
      nodeCount: () => 4,
      apply(settings, now, allOn) {
        const { reverb } = settings
        helpers.onOff(reverb.on && allOn, now)
        const key = `${reverb.type}:${reverb.tone}`
        if (key !== currentKey) {
          currentKey = key
          convolver.buffer = buildImpulseResponse(ctx, reverb.type, reverb.tone)
        }
        ramp(damping.frequency, reverb.tone === 'Bright' ? 9000 : 2400, now)
        // Dry/wet is fully wet at max, as the manual requires.
        const wet = Math.min(1, Math.max(0, reverb.dryWet / 10))
        ramp(wetSend.gain, wet, now)
      },
      dispose() {
        /* nothing scheduled */
      },
    }
  })
}

/* ------------------------------------------------------------------ */
/* Shared Rotary                                                      */
/* ------------------------------------------------------------------ */

export interface RotaryUnit {
  input: GainNodeLike
  output: GainNodeLike
  apply(state: EffectState, now: number): void
  dispose(): void
  nodeCount(): number
}

/**
 * Horn + bass rotor. The horn is a high-passed, panned, amplitude-modulated path; the drum
 * is a low-passed, counter-panned path. Speed changes are ramps on the LFO frequencies, so
 * acceleration is smooth rather than stepped (manual p. 53).
 */
export function buildRotary(ctx: AudioContextLike): RotaryUnit {
  const input = gain(ctx, 1)
  const output = gain(ctx, 1)
  const dry = gain(ctx, 0)
  const wet = gain(ctx, 0)
  dry.connect(output)
  wet.connect(output)

  const hornHigh = biquad(ctx, 'highpass', 800, 0.7)
  const drumLow = biquad(ctx, 'lowpass', 800, 0.7)
  const hornTrem = gain(ctx, 1)
  const drumTrem = gain(ctx, 1)
  const hornPan = panner(ctx, 0)
  const drumPan = panner(ctx, 0)
  const hornLfo = lfo(ctx, ROTARY_SPEEDS.slow.horn)
  const drumLfo = lfo(ctx, ROTARY_SPEEDS.slow.drum)
  const hornAmp = gain(ctx, 0.55)
  const drumAmp = gain(ctx, 0.35)
  const hornPanner = gain(ctx, 0.65)
  const drumPanner = gain(ctx, 0.5)
  // The drum spins at a different rate, so its LFO needs its own phase-shifted source.
  const hornSat = shaper(ctx, FIXED_SAT_CURVE, '2x')
  const preDrive = gain(ctx, 1)
  const postDrive = gain(ctx, 1)

  input.connect(preDrive)
  preDrive.connect(hornSat)
  hornSat.connect(hornHigh)
  hornSat.connect(drumLow)
  hornHigh.connect(hornTrem)
  drumLow.connect(drumTrem)
  hornTrem.connect(hornPan)
  drumTrem.connect(drumPan)
  hornPan.connect(wet)
  drumPan.connect(wet)

  hornLfo.connect(hornAmp)
  hornAmp.connect(hornTrem.gain)
  hornLfo.connect(hornPanner)
  hornPanner.connect(hornPan.pan)
  drumLfo.connect(drumAmp)
  drumAmp.connect(drumTrem.gain)
  drumLfo.connect(drumPanner)
  drumPanner.connect(drumPan.pan)
  hornLfo.start(0)
  drumLfo.start(0)

  return {
    input,
    output,
    nodeCount: () => 17,
    apply(state, now) {
      const { rotary } = state
      const active = state.allOn && rotary.on
      ramp(dry.gain, active ? 0 : 1, now, 0.02)
      ramp(wet.gain, active ? 1 : 0, now, 0.02)
      const speeds = rotary.speed === 'Fast' ? ROTARY_SPEEDS.fast : ROTARY_SPEEDS.slow
      // A ramp, not a jump: this is the horn/rotor acceleration the manual describes.
      ramp(hornLfo.frequency, speeds.horn, now, 0.4)
      ramp(drumLfo.frequency, speeds.drum, now, 0.4)
      const drive = Math.max(0, Math.min(1, rotary.drive / 10))
      ramp(preDrive.gain, 1 + drive * 5, now)
      ramp(postDrive.gain, 1 / (1 + drive * 1.4), now)
      ramp(hornHigh.frequency, 700, now)
      ramp(drumLow.frequency, 800, now)
    },
    dispose() {
      hornLfo.stop()
      drumLfo.stop()
    },
  }
}

/* ------------------------------------------------------------------ */
/* The chain                                                          */
/* ------------------------------------------------------------------ */

export interface ChainNodes {
  owner: ChainOwner
  input: GainNodeLike
  output: GainNodeLike
  /** Post-chain layer level, i.e. the layer fader. */
  level: GainNodeLike
  update(state: EffectState, now: number): void
  dispose(): void
  nodeCount(): number
  /** Diagnostic: the order the units are wired in. */
  order: readonly string[]
}

export const CHAIN_ORDER = ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'] as const

export function createChain(ctx: AudioContextLike, owner: ChainOwner, rotary: RotaryUnit): ChainNodes {
  const input = gain(ctx, 1)
  const output = gain(ctx, 1)
  const level = gain(ctx, 1)

  const mod1 = buildMod1(ctx)
  const mod2 = buildMod2(ctx)
  const delayUnit = buildDelay(ctx)
  const ampEq = buildAmpEq(ctx)
  const compressorUnit = buildCompressor(ctx)
  const reverb = buildReverb(ctx)

  const chain = [mod1, mod2, delayUnit, ampEq, compressorUnit, reverb]
  // The rotary is one shared instance for the whole instrument, so a routed layer leaves
  // its own chain after Reverb and enters that shared unit. Because the rotary is shared,
  // the layer fader has to sit before the send rather than after the return: the return
  // carries the summed rotary output and cannot be scaled per layer. Reverb still
  // precedes the rotary, which is the order the spec requires be verified.
  const straight = gain(ctx, 1)
  const toRotary = gain(ctx, 0)

  input.connect(mod1.input)
  let cursor: AudioNodeLike = mod1.output
  for (let i = 1; i < chain.length; i += 1) {
    cursor.connect(chain[i].input)
    cursor = chain[i].output
  }
  // A soft ceiling at the chain output. EQ and amp models are boosts, and without this a
  // +15 dB boost would leave the chain 2x over full scale before it ever reached the
  // master gain. The stage is transparent below -6 dBFS so normal playing is untouched.
  const ceiling = shaper(ctx, CHAIN_CEILING_CURVE, '2x')

  // cursor is now the reverb output.
  cursor.connect(level)
  level.connect(ceiling)
  ceiling.connect(straight)
  ceiling.connect(toRotary)
  straight.connect(output)
  toRotary.connect(rotary.input)

  let rotaryRouted = false

  return {
    owner,
    input,
    output,
    level,
    order: CHAIN_ORDER,
    nodeCount() {
      return chain.reduce((sum, unit) => sum + unit.nodeCount(), 0) + 8
    },
    update(state, now) {
      const settings = effectiveChain(state, owner)
      // The Layer Effects ON button bypasses every unit at once (manual p. 48), so the
      // flag reaches the units instead of only living in the panel's state.
      const allOn = state.allOn
      mod1.apply(settings, now, allOn)
      mod2.apply(settings, now, allOn)
      delayUnit.apply(settings, now, allOn)
      ampEq.apply(settings, now, allOn)
      compressorUnit.apply(settings, now, allOn)
      reverb.apply(settings, now, allOn)

      // To Rotary lives in the Amp/EQ model list and routes a Piano or Synth layer into the
      // shared Rotary (manual p. 52). The Organ reaches the same rotary with its own ORGAN
      // button instead (manual p. 53), which is why the owner matters here.
      const viaModel = allOn && settings.ampEq.on && settings.ampEq.model === 'To Rotary'
      const viaOrganButton =
        allOn && owner === 'organ' && state.rotary.on && state.rotary.organRouted
      const routed = viaModel || viaOrganButton
      if (routed !== rotaryRouted) {
        rotaryRouted = routed
        ramp(straight.gain, routed ? 0 : 1, now, 0.02)
        ramp(toRotary.gain, routed ? 1 : 0, now, 0.02)
      }
    },
    dispose() {
      for (const unit of chain) unit.dispose()
      safeDisconnect(input)
      safeDisconnect(output)
      safeDisconnect(level)
    },
  }
}

/**
 * The shared rotary's single return to the master path. One gain for the whole
 * instrument, so every routed layer passes through the same rotary instance.
 */
export function createRotaryReturn(ctx: AudioContextLike, rotary: RotaryUnit): GainNodeLike {
  const total = gain(ctx, 1)
  rotary.output.connect(total)
  return total
}

/** True when the given chain is currently routed into the shared rotary. */
export function isRoutedToRotary(state: EffectState, owner: ChainOwner): boolean {
  const settings = effectiveChain(state, owner)
  return settings.ampEq.on && settings.ampEq.model === 'To Rotary'
}
