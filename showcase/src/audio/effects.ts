import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  DelayNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from './boundaries'
import {
  mappings,
  type AmpEqState,
  type CompState,
  type DelayState,
  type Mod1State,
  type Mod2State,
  type ReverbState,
  type RotarySpeed,
  type VibratoType,
} from '../state/instrument'

/**
 * Real Web Audio effect units. Every unit processes the audio that flows
 * through it — nothing here is a label, enum or disconnected node. Each unit
 * follows the same shell: input → dry path + wet path → output, with
 * click-free crossfaded bypass and short parameter ramps.
 *
 * Reverb impulse responses are GENERATED algorithmically (deterministic
 * xorshift noise); they are declared as generated DSP, never as recordings.
 */

const RAMP = 0.02

function setParam(param: AudioParamLike, value: number, now: number, tau = RAMP): void {
  param.cancelScheduledValues(now)
  param.setTargetAtTime(value, now, tau)
}

export interface EffectUnit<S> {
  readonly input: AudioNodeLike
  readonly output: AudioNodeLike
  update(state: S, on: boolean, now: number): void
  /** Live control-pedal position 0..1 (Mod 1's PED mode, manual p. 49);
   *  injected by the engine before each update — never part of `S`. */
  setPedal?(value: number): void
  dispose(): void
}

interface Shell {
  input: GainNodeLike
  dry: GainNodeLike
  wetIn: GainNodeLike
  wetOut: GainNodeLike
  output: GainNodeLike
  /** dryLevel/wetLevel are the levels used while the unit is ON. */
  setActive(on: boolean, dryLevel: number, wetLevel: number, now: number): void
  dispose(extra: AudioNodeLike[]): void
}

function makeShell(ctx: AudioContextLike): Shell {
  const input = ctx.createGain()
  const dry = ctx.createGain()
  const wetIn = ctx.createGain()
  const wetOut = ctx.createGain()
  const output = ctx.createGain()
  input.connect(dry)
  dry.connect(output)
  input.connect(wetIn)
  wetOut.connect(output)
  dry.gain.value = 1
  wetOut.gain.value = 0
  return {
    input,
    dry,
    wetIn,
    wetOut,
    output,
    setActive(on, dryLevel, wetLevel, now) {
      setParam(dry.gain, on ? dryLevel : 1, now)
      setParam(wetOut.gain, on ? wetLevel : 0, now)
    },
    dispose(extra) {
      for (const node of [input, dry, wetIn, wetOut, output, ...extra]) {
        try {
          node.disconnect()
        } catch {
          /* detached */
        }
      }
    },
  }
}

interface Lfo {
  osc: OscillatorNodeLike
  depth: GainNodeLike
  nodes: AudioNodeLike[]
}

function makeLfo(ctx: AudioContextLike, target: AudioParamLike, type = 'sine'): Lfo {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.value = 1
  const depth = ctx.createGain()
  depth.gain.value = 0
  osc.connect(depth)
  depth.connect(target)
  osc.start(0)
  return { osc, depth, nodes: [osc, depth] }
}

function stopAndDisconnect(nodes: AudioNodeLike[]): void {
  for (const node of nodes) {
    try {
      ;(node as OscillatorNodeLike).stop?.(0)
    } catch {
      /* not startable or already stopped */
    }
    try {
      node.disconnect()
    } catch {
      /* detached */
    }
  }
}

/* -------------------------------------------------------------- Mod 1 -- */

export function createMod1(ctx: AudioContextLike): EffectUnit<Mod1State> {
  const shell = makeShell(ctx)
  let built: { type: Mod1State['type']; nodes: AudioNodeLike[]; apply(state: Mod1State, now: number): void } | null = null
  /** Control-pedal position 0..1, injected by the engine (PED mode). */
  let pedalPosition = 0

  function build(type: Mod1State['type']): void {
    if (built) stopAndDisconnect(built.nodes)
    try {
      shell.wetIn.disconnect()
    } catch {
      /* detached */
    }
    switch (type) {
      case 'A-Pan': {
        const panner = ctx.createStereoPanner()
        shell.wetIn.connect(panner)
        panner.connect(shell.wetOut)
        const lfo = makeLfo(ctx, panner.pan)
        built = {
          type,
          nodes: [panner, ...lfo.nodes],
          apply(state, now) {
            setParam(lfo.osc.frequency, mappings.lfoRateHz(state.rate), now)
            setParam(lfo.depth.gain, (state.amount / 127) * 0.95, now)
          },
        }
        break
      }
      case 'Tremolo':
      case 'Pump': {
        const amp = ctx.createGain()
        shell.wetIn.connect(amp)
        amp.connect(shell.wetOut)
        const lfo = makeLfo(ctx, amp.gain, type === 'Pump' ? 'sawtooth' : 'sine')
        built = {
          type,
          nodes: [amp, ...lfo.nodes],
          apply(state, now) {
            const depth = (state.amount / 127) * (type === 'Pump' ? 0.9 : 0.85)
            setParam(amp.gain, 1 - depth / 2, now)
            setParam(lfo.depth.gain, type === 'Pump' ? -depth / 2 : depth / 2, now)
            setParam(lfo.osc.frequency, mappings.lfoRateHz(state.rate) * (type === 'Pump' ? 0.4 : 1), now)
          },
        }
        break
      }
      case 'Ring Mod': {
        const ring = ctx.createGain()
        ring.gain.value = 0
        shell.wetIn.connect(ring)
        ring.connect(shell.wetOut)
        const carrier = ctx.createOscillator()
        carrier.type = 'sine'
        carrier.connect(ring.gain)
        carrier.start(0)
        built = {
          type,
          nodes: [ring, carrier],
          apply(state, now) {
            setParam(carrier.frequency, 40 + Math.pow(state.rate / 127, 2) * 1800, now)
          },
        }
        break
      }
      case 'Wah':
      case 'A-Wah': {
        const filter = ctx.createBiquadFilter()
        // Spec: Wah is an LFO-driven resonant LOW-PASS sweep; band-pass is
        // the envelope-followed A-Wah's characteristic.
        filter.type = type === 'Wah' ? 'lowpass' : 'bandpass'
        filter.frequency.value = 600
        filter.Q.value = type === 'Wah' ? 6 : 4
        shell.wetIn.connect(filter)
        filter.connect(shell.wetOut)
        // PED mode (manual p. 49): the sweep source (LFO / envelope
        // follower) is silenced and the filter position follows the control
        // pedal instead — an exponential 250..2500 Hz pedal-wah sweep.
        const pedalFrequency = () => 250 * Math.pow(10, pedalPosition)
        if (type === 'Wah') {
          const lfo = makeLfo(ctx, filter.frequency)
          built = {
            type,
            nodes: [filter, ...lfo.nodes],
            apply(state, now) {
              if (state.ped) {
                setParam(lfo.depth.gain, 0, now)
                setParam(filter.frequency, pedalFrequency(), now)
                return
              }
              setParam(filter.frequency, 600, now)
              setParam(lfo.osc.frequency, mappings.lfoRateHz(state.rate), now)
              setParam(lfo.depth.gain, 480, now)
            },
          }
        } else {
          // Envelope follower: |x| -> slow lowpass -> scaled into filter frequency.
          const rectifier = ctx.createWaveShaper()
          const curve = new Float32Array(1024)
          for (let i = 0; i < curve.length; i++) curve[i] = Math.abs((i / (curve.length - 1)) * 2 - 1)
          rectifier.curve = curve
          const follower = ctx.createBiquadFilter()
          follower.type = 'lowpass'
          follower.frequency.value = 12
          const scale = ctx.createGain()
          shell.wetIn.connect(rectifier)
          rectifier.connect(follower)
          follower.connect(scale)
          scale.connect(filter.frequency)
          built = {
            type,
            nodes: [filter, rectifier, follower, scale],
            apply(state, now) {
              if (state.ped) {
                setParam(scale.gain, 0.0001, now)
                setParam(filter.frequency, pedalFrequency(), now)
                return
              }
              setParam(filter.frequency, 600, now)
              setParam(scale.gain, 800 + (state.rate / 127) * 7000, now)
            },
          }
        }
        break
      }
    }
  }

  return {
    input: shell.input,
    output: shell.output,
    update(state, on, now) {
      if (!built || built.type !== state.type) build(state.type)
      built!.apply(state, now)
      // A-Pan/Trem/Pump process the whole signal; RM and wahs blend by amount.
      const blend = state.type === 'Ring Mod' || state.type === 'Wah' || state.type === 'A-Wah'
      const wet = blend ? state.amount / 127 : 1
      shell.setActive(on, blend ? 1 - wet * 0.75 : 0, wet, now)
    },
    setPedal(value) {
      pedalPosition = Math.max(0, Math.min(1, value))
    },
    dispose() {
      if (built) stopAndDisconnect(built.nodes)
      shell.dispose([])
    },
  }
}

/* -------------------------------------------------------------- Mod 2 -- */

export function createMod2(ctx: AudioContextLike): EffectUnit<Mod2State> {
  const shell = makeShell(ctx)
  let built: { type: Mod2State['type']; nodes: AudioNodeLike[]; apply(state: Mod2State, now: number): void } | null = null

  function buildAllpassBank(stages: number[], deep: boolean) {
    const filters: BiquadFilterNodeLike[] = stages.map((freq) => {
      const filter = ctx.createBiquadFilter()
      filter.type = 'allpass'
      filter.frequency.value = freq
      filter.Q.value = 0.6
      return filter
    })
    let head: AudioNodeLike = shell.wetIn
    for (const filter of filters) {
      head.connect(filter)
      head = filter
    }
    head.connect(shell.wetOut)
    const lfoTargets = filters.map((f) => f.frequency)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.start(0)
    const depths = lfoTargets.map((target, i) => {
      const depth = ctx.createGain()
      depth.gain.value = 0
      osc.connect(depth)
      depth.connect(target)
      return { depth, base: stages[i]! }
    })
    return { nodes: [...filters, osc, ...depths.map((d) => d.depth)], osc, depths, deep }
  }

  function buildModDelays(specs: Array<{ base: number; mod: number; rateScale: number }>) {
    const nodes: AudioNodeLike[] = []
    const oscs: OscillatorNodeLike[] = []
    const depths: Array<{ depth: GainNodeLike; mod: number }> = []
    for (const spec of specs) {
      const delay = ctx.createDelay(0.1)
      delay.delayTime.value = spec.base
      shell.wetIn.connect(delay)
      delay.connect(shell.wetOut)
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.start(0)
      const depth = ctx.createGain()
      depth.gain.value = 0
      osc.connect(depth)
      depth.connect(delay.delayTime)
      nodes.push(delay, osc, depth)
      oscs.push(osc)
      depths.push({ depth, mod: spec.mod })
    }
    return { nodes, oscs, depths, specs }
  }

  function build(type: Mod2State['type']): void {
    if (built) stopAndDisconnect(built.nodes)
    try {
      shell.wetIn.disconnect()
    } catch {
      /* detached */
    }
    switch (type) {
      case 'Phaser':
      case 'Vibe': {
        const bank = buildAllpassBank(type === 'Phaser' ? [350, 700, 1200, 2200] : [220, 500, 1600, 3400], type === 'Vibe')
        built = {
          type,
          nodes: bank.nodes,
          apply(state, now) {
            setParam(bank.osc.frequency, mappings.lfoRateHz(state.rate), now)
            for (const { depth, base } of bank.depths) {
              setParam(depth.gain, base * (bank.deep ? 0.8 : 0.55) * (state.amount / 127), now)
            }
          },
        }
        break
      }
      case 'Flanger': {
        const bank = buildModDelays([{ base: 0.004, mod: 0.0025, rateScale: 1 }])
        const feedback = ctx.createGain()
        feedback.gain.value = 0
        // Flanger feedback: the delayed signal recirculates into the delay.
        const flangeDelay = bank.nodes[0] as DelayNodeLike
        flangeDelay.connect(feedback)
        feedback.connect(flangeDelay)
        built = {
          type,
          nodes: [...bank.nodes, feedback],
          apply(state, now) {
            setParam(bank.oscs[0]!.frequency, mappings.lfoRateHz(state.rate) * 0.5, now)
            setParam(bank.depths[0]!.depth.gain, 0.0025 * (0.3 + (state.amount / 127) * 0.7), now)
            setParam(feedback.gain, (state.amount / 127) * 0.55, now)
          },
        }
        break
      }
      case 'Chorus': {
        const bank = buildModDelays([{ base: 0.018, mod: 0.007, rateScale: 1 }])
        built = {
          type,
          nodes: bank.nodes,
          apply(state, now) {
            const hz = mappings.lfoRateHz(state.rate) * 0.35
            setParam(bank.oscs[0]!.frequency, hz, now)
            // Delay-line modulation reads out as pitch (deviation ≈ 2πf·depth),
            // so a FIXED delay swing detunes more the faster the LFO runs — the
            // old constant swing warbled ±44 cents at default knobs and ±2.5
            // semitones at max (the scanner-vibrato bug class, here in Mod 2).
            // Solve the swing from a target detune instead: ±10..±26 cents
            // across the Amount range, capped so slow rates stay chorus-sized.
            const ratio = 0.006 + (state.amount / 127) * 0.009
            setParam(bank.depths[0]!.depth.gain, Math.min(0.008, ratio / (2 * Math.PI * hz)), now)
          },
        }
        break
      }
      case 'Ensemble': {
        const bank = buildModDelays([
          { base: 0.014, mod: 0.004, rateScale: 0.9 },
          { base: 0.022, mod: 0.005, rateScale: 1.1 },
          { base: 0.03, mod: 0.006, rateScale: 1.25 },
        ])
        built = {
          type,
          nodes: bank.nodes,
          apply(state, now) {
            // Same pitch-anchored depth as Chorus, per line: each of the three
            // cross-connected lines holds ±(11..25)-cent detune scaled by its
            // spec.mod share, instead of a fixed swing that reached ±3
            // semitones on the widest line at max Rate/Amount.
            bank.oscs.forEach((osc, i) => {
              const spec = bank.specs[i]!
              const hz = mappings.lfoRateHz(state.rate) * 0.4 * spec.rateScale
              setParam(osc.frequency, hz, now)
              const ratio = (0.004 + (state.amount / 127) * 0.008) * (spec.mod / 0.005)
              setParam(bank.depths[i]!.depth.gain, Math.min(0.006, ratio / (2 * Math.PI * hz)), now)
            })
          },
        }
        break
      }
      case 'Spin': {
        const panner = ctx.createStereoPanner()
        const amp = ctx.createGain()
        shell.wetIn.connect(amp)
        amp.connect(panner)
        panner.connect(shell.wetOut)
        const panLfo = makeLfo(ctx, panner.pan)
        const ampLfo = makeLfo(ctx, amp.gain)
        built = {
          type,
          nodes: [panner, amp, ...panLfo.nodes, ...ampLfo.nodes],
          apply(state, now) {
            const hz = mappings.lfoRateHz(state.rate)
            // Ramping speed changes come free via setTargetAtTime inertia.
            setParam(panLfo.osc.frequency, hz, now, 0.35)
            setParam(ampLfo.osc.frequency, hz, now, 0.35)
            setParam(panLfo.depth.gain, (state.amount / 127) * 0.85, now)
            setParam(amp.gain, 1 - (state.amount / 127) * 0.3, now)
            setParam(ampLfo.depth.gain, (state.amount / 127) * 0.3, now)
          },
        }
        break
      }
    }
  }

  return {
    input: shell.input,
    output: shell.output,
    update(state, on, now) {
      if (!built || built.type !== state.type) build(state.type)
      built!.apply(state, now)
      const mix = state.type === 'Phaser' || state.type === 'Vibe' ? 0.5 + (state.amount / 127) * 0.2 : Math.min(1, 0.35 + (state.amount / 127) * 0.65)
      shell.setActive(on, state.type === 'Vibe' ? 0.25 : 1 - mix * 0.5, mix, now)
    },
    dispose() {
      if (built) stopAndDisconnect(built.nodes)
      shell.dispose([])
    },
  }
}

/* -------------------------------------------------------------- Delay -- */

export function createDelay(ctx: AudioContextLike): EffectUnit<DelayState> {
  const shell = makeShell(ctx)
  const delay = ctx.createDelay(2)
  delay.delayTime.value = 0.35

  // Feedback loop: everything below affects REPEATS only, never the dry path.
  const fbFilter = ctx.createBiquadFilter()
  fbFilter.type = 'allpass' // neutral until a filter is selected
  fbFilter.frequency.value = 1200
  fbFilter.Q.value = 0.5
  const analogShaper = ctx.createWaveShaper()
  const analogCurve = new Float32Array(1024)
  for (let i = 0; i < analogCurve.length; i++) {
    const x = (i / (analogCurve.length - 1)) * 2 - 1
    analogCurve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4)
  }
  const analogTone = ctx.createBiquadFilter()
  analogTone.type = 'lowpass'
  analogTone.frequency.value = 18000
  // In-loop modulated micro-delay: the Delay "effects" (Chorus/Vibe/Ensemble/
  // Flam/Space approximations) processing only the feedback path.
  const fbEffectDelay = ctx.createDelay(0.2)
  fbEffectDelay.delayTime.value = 0.0001
  const fbLfo = makeLfo(ctx, fbEffectDelay.delayTime)
  const fbDiffusion = ctx.createBiquadFilter()
  fbDiffusion.type = 'allpass'
  fbDiffusion.frequency.value = 900
  const fbGain = ctx.createGain()
  fbGain.gain.value = 0.4

  // Ping Pong topology (manual p. 51, Shift + Filter): a second delay B in
  // series makes each hop land on the other side — tap A pans left, tap B
  // (one more delay time later) pans right, and the feedback loop is fed
  // from B so the alternation continues. Gain gates switch between the
  // centered single-delay wiring and the A→L / B→R wiring without rebuilding
  // the graph.
  const delayB = ctx.createDelay(2)
  delayB.delayTime.value = 0.35
  const centerTap = ctx.createGain() // plain mode: delay -> wet (centered)
  centerTap.gain.value = 1
  const pingATap = ctx.createGain() // ping mode: delay A -> left
  pingATap.gain.value = 0
  const toB = ctx.createGain() // ping mode: delay A -> delay B
  toB.gain.value = 0
  const panL = ctx.createStereoPanner()
  panL.pan.value = -0.85
  const panR = ctx.createStereoPanner()
  panR.pan.value = 0.85
  const fbFromA = ctx.createGain() // plain mode feedback source
  fbFromA.gain.value = 1
  const fbFromB = ctx.createGain() // ping mode feedback source
  fbFromB.gain.value = 0

  shell.wetIn.connect(delay)
  delay.connect(centerTap)
  centerTap.connect(shell.wetOut)
  delay.connect(pingATap)
  pingATap.connect(panL)
  panL.connect(shell.wetOut)
  delay.connect(toB)
  toB.connect(delayB)
  delayB.connect(panR)
  panR.connect(shell.wetOut)
  delay.connect(fbFromA)
  delayB.connect(fbFromB)
  fbFromA.connect(fbFilter)
  fbFromB.connect(fbFilter)
  fbFilter.connect(analogTone)
  analogTone.connect(analogShaper)
  analogShaper.connect(fbEffectDelay)
  fbEffectDelay.connect(fbDiffusion)
  fbDiffusion.connect(fbGain)
  fbGain.connect(delay)

  return {
    input: shell.input,
    output: shell.output,
    update(state, on, now) {
      setParam(delay.delayTime, mappings.delayTempoMs(state.tempo) / 1000, now, state.analog ? 0.08 : 0.02)
      setParam(delayB.delayTime, mappings.delayTempoMs(state.tempo) / 1000, now, state.analog ? 0.08 : 0.02)
      const ping = state.pingPong
      setParam(centerTap.gain, ping ? 0.0001 : 1, now)
      setParam(pingATap.gain, ping ? 1 : 0.0001, now)
      setParam(toB.gain, ping ? 1 : 0.0001, now)
      setParam(fbFromA.gain, ping ? 0.0001 : 1, now)
      setParam(fbFromB.gain, ping ? 1 : 0.0001, now)
      setParam(fbGain.gain, Math.min(0.92, (state.feedback / 127) * 0.92), now)
      switch (state.filter) {
        case 'Off':
          fbFilter.type = 'allpass'
          setParam(fbFilter.frequency, 1200, now)
          break
        case 'Low Pass':
          fbFilter.type = 'lowpass'
          setParam(fbFilter.frequency, 1600, now)
          break
        case 'High Pass':
          fbFilter.type = 'highpass'
          setParam(fbFilter.frequency, 700, now)
          break
        case 'Band Pass':
          fbFilter.type = 'bandpass'
          setParam(fbFilter.frequency, 1000, now)
          break
      }
      // Feedback-path effect: modulation depth/character per selected effect.
      const effectDepth: Record<DelayState['effect'], [number, number]> = {
        Off: [0.00005, 0.1],
        Chorus: [0.004, 0.4],
        Vibe: [0.006, 0.9],
        Ensemble: [0.005, 0.25],
        Flam: [0.03, 0.05],
        Space: [0.012, 0.18],
      }
      const [depth, rate] = effectDepth[state.effect]
      setParam(fbEffectDelay.delayTime, state.effect === 'Flam' ? 0.03 : 0.0001, now)
      setParam(fbLfo.depth.gain, state.effect === 'Flam' ? 0 : depth, now)
      setParam(fbLfo.osc.frequency, rate, now)
      analogTone.frequency.value = state.analog ? 3800 : 18000
      analogShaper.curve = state.analog ? analogCurve : null
      const wet = state.mix / 127
      shell.setActive(on, Math.cos(wet * Math.PI * 0.5), Math.sin(wet * Math.PI * 0.5), now)
    },
    dispose() {
      stopAndDisconnect(fbLfo.nodes)
      shell.dispose([delay, delayB, centerTap, pingATap, toB, panL, panR, fbFromA, fbFromB, fbFilter, analogShaper, analogTone, fbEffectDelay, fbDiffusion, fbGain])
    },
  }
}

/* --------------------------------------------------------- Amp Sim/EQ -- */

export function createAmpEq(ctx: AudioContextLike): EffectUnit<AmpEqState> {
  const shell = makeShell(ctx)
  const pre = ctx.createGain()
  const shaper = ctx.createWaveShaper()
  const voicing = ctx.createBiquadFilter() // amp-model coloration / LP24-HP24 first stage
  voicing.type = 'peaking'
  voicing.frequency.value = 1000
  voicing.gain.value = 0
  const stage2 = ctx.createBiquadFilter() // LP24/HP24 second stage (24 dB/oct total)
  stage2.type = 'peaking'
  stage2.frequency.value = 1000
  stage2.gain.value = 0
  const bass = ctx.createBiquadFilter()
  bass.type = 'lowshelf'
  bass.frequency.value = 100
  const mid = ctx.createBiquadFilter()
  mid.type = 'peaking'
  mid.frequency.value = 1000
  mid.Q.value = 0.9
  const treble = ctx.createBiquadFilter()
  treble.type = 'highshelf'
  treble.frequency.value = 4000
  const post = ctx.createGain()

  shell.wetIn.connect(pre)
  pre.connect(shaper)
  shaper.connect(voicing)
  voicing.connect(stage2)
  stage2.connect(bass)
  bass.connect(mid)
  mid.connect(treble)
  treble.connect(post)
  post.connect(shell.wetOut)

  let currentDriveKey = ''

  return {
    input: shell.input,
    output: shell.output,
    update(state, on, now) {
      const driveAmount = state.drive / 127
      const isFilter = state.type === 'LP24 Filter' || state.type === 'HP24 Filter'
      const ampColor = state.type === 'Twin' ? 1.5 : state.type === 'JC' ? 1.2 : state.type === 'Small' ? 0.8 : 1
      const k = 0.5 + driveAmount * 14 * ampColor
      const preGain = 1 + driveAmount * 1.5
      const hasCurve = driveAmount >= 0.02 || state.type === 'Twin' || state.type === 'JC' || state.type === 'Small'
      const key = `${state.type}:${state.drive}`
      if (key !== currentDriveKey) {
        currentDriveKey = key
        if (!hasCurve) {
          shaper.curve = null
        } else {
          const curve = new Float32Array(2048)
          for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1
            curve[i] = Math.tanh(x * k) / Math.tanh(k)
          }
          shaper.curve = curve
        }
      }
      setParam(pre.gain, preGain, now)
      // Gain staging: the normalized tanh curve's small-signal slope is
      // k/tanh(k) ≈ k, which un-compensated boosted everything ~8x (+18 dB)
      // at the default knob. Anchor unity gain (plus a gentle 1..1.25x knob
      // rise) at a nominal program level instead — quieter material still
      // comes up compressor-style, peaks cap at the curve ceiling, and the
      // drive knob adds saturation rather than raw level.
      const nominal = 0.25
      const makeup = hasCurve
        ? ((1 + driveAmount * 0.25) * nominal * Math.tanh(k)) / Math.tanh(k * nominal * preGain)
        : 1
      setParam(post.gain, makeup, now)

      if (isFilter) {
        const lp = state.type === 'LP24 Filter'
        voicing.type = lp ? 'lowpass' : 'highpass'
        stage2.type = lp ? 'lowpass' : 'highpass'
        const cutoff = mappings.filterFreqHz(state.freq)
        setParam(voicing.frequency, cutoff, now)
        setParam(stage2.frequency, cutoff, now)
        // Gain/Res (the MID knob, spec ampSimEq.filterModes): resonance for
        // the 24 dB filter modes — center = mild, right = screaming.
        const resonance = 0.5 + Math.pow(state.mid / 127, 2) * 11.5
        setParam(voicing.Q, resonance, now)
        setParam(stage2.Q, 0.7, now)
        setParam(mid.gain, 0, now)
      } else {
        // Neutral EQ / amp models / To Rotary: voicing shapes the amp character.
        voicing.type = 'peaking'
        stage2.type = 'peaking'
        setParam(stage2.gain, 0, now)
        setParam(voicing.Q, 0.8, now)
        if (state.type === 'Twin') {
          setParam(voicing.frequency, 3200, now)
          setParam(voicing.gain, 4.5, now)
        } else if (state.type === 'JC') {
          setParam(voicing.frequency, 2200, now)
          setParam(voicing.gain, 3.5, now)
        } else if (state.type === 'Small') {
          setParam(voicing.frequency, 900, now)
          setParam(voicing.gain, 3, now)
        } else {
          setParam(voicing.gain, 0, now)
        }
        setParam(mid.frequency, mappings.midFreqHz(state.freq), now)
        setParam(mid.gain, mappings.eqGainDb(state.mid), now)
      }
      setParam(bass.gain, mappings.eqGainDb(state.bass), now)
      setParam(treble.gain, mappings.eqGainDb(state.treble), now)
      shell.setActive(on, 0, 1, now)
    },
    dispose() {
      shell.dispose([pre, shaper, voicing, stage2, bass, mid, treble, post])
    },
  }
}

/* --------------------------------------------------------- Compressor -- */

export function createComp(ctx: AudioContextLike): EffectUnit<CompState> {
  const shell = makeShell(ctx)
  let compressor: ReturnType<NonNullable<AudioContextLike['createDynamicsCompressor']>> | null = null
  try {
    compressor = ctx.createDynamicsCompressor?.() ?? null
  } catch {
    compressor = null
  }
  const makeup = ctx.createGain()
  if (compressor) {
    shell.wetIn.connect(compressor)
    compressor.connect(makeup)
  } else {
    // Boundary without a compressor node: honest gain-reduction approximation.
    shell.wetIn.connect(makeup)
  }
  makeup.connect(shell.wetOut)

  return {
    input: shell.input,
    output: shell.output,
    update(state, on, now) {
      const amount = state.amount / 127
      if (compressor) {
        setParam(compressor.threshold, -8 - amount * 34, now)
        setParam(compressor.ratio, 2 + amount * 8, now)
        setParam(compressor.knee, 12, now)
        setParam(compressor.attack, 0.004, now)
        setParam(compressor.release, state.fast ? 0.08 : 0.3, now)
      }
      setParam(makeup.gain, 1 + amount * (compressor ? 1.1 : -0.4), now)
      shell.setActive(on, 0, 1, now)
    },
    dispose() {
      shell.dispose(compressor ? [compressor, makeup] : [makeup])
    },
  }
}

/* ------------------------------------------------------------- Reverb -- */

/** Deterministic xorshift32 noise for generated impulse responses. */
function makeImpulse(ctx: AudioContextLike, seconds: number, decay: number, predelay: number, springy: boolean): AudioBufferLike {
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(seconds * rate))
  const buffer = ctx.createBuffer(2, length, rate)
  let seed = 0x9e3779b9
  const random = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    return seed / 0xffffffff
  }
  const preSamples = Math.floor(predelay * rate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = preSamples; i < length; i++) {
      const t = (i - preSamples) / rate
      let value = (random() * 2 - 1) * Math.exp(-t * decay)
      if (springy) value *= 0.6 + 0.4 * Math.sin(2 * Math.PI * 41 * t + channel * 1.7)
      data[i] = value
    }
  }
  return buffer
}

const REVERB_PROFILES: Record<ReverbState['type'], { seconds: number; decay: number; predelay: number; springy: boolean }> = {
  Booth: { seconds: 0.45, decay: 11, predelay: 0.004, springy: false },
  Room: { seconds: 0.9, decay: 6.5, predelay: 0.008, springy: false },
  Stage: { seconds: 1.4, decay: 4.2, predelay: 0.012, springy: false },
  Hall: { seconds: 2.4, decay: 2.4, predelay: 0.02, springy: false },
  Spring: { seconds: 1.6, decay: 4.5, predelay: 0.002, springy: true },
  Cathedral: { seconds: 3.6, decay: 1.4, predelay: 0.03, springy: false },
}

export function createReverb(ctx: AudioContextLike): EffectUnit<ReverbState> {
  const shell = makeShell(ctx)
  const convolver = ctx.createConvolver()
  const tone = ctx.createBiquadFilter()
  tone.type = 'highshelf'
  tone.frequency.value = 3200
  shell.wetIn.connect(convolver)
  convolver.connect(tone)
  tone.connect(shell.wetOut)
  const impulses = new Map<ReverbState['type'], AudioBufferLike>()
  let currentType: ReverbState['type'] | null = null

  return {
    input: shell.input,
    output: shell.output,
    update(state, on, now) {
      if (currentType !== state.type) {
        currentType = state.type
        let impulse = impulses.get(state.type)
        if (!impulse) {
          const profile = REVERB_PROFILES[state.type]
          impulse = makeImpulse(ctx, profile.seconds, profile.decay, profile.predelay, profile.springy)
          impulses.set(state.type, impulse)
        }
        convolver.buffer = impulse
      }
      setParam(tone.gain, state.bright ? 0 : -9, now)
      const wet = state.mix / 127
      shell.setActive(on, Math.cos(wet * Math.PI * 0.5), Math.sin(wet * Math.PI * 0.5) * 0.9, now)
    },
    dispose() {
      shell.dispose([convolver, tone])
    },
  }
}

/* ------------------------------------------------------------- Rotary -- */

/** Sound menu 8-11 (manual p. 58): rotor/horn speed and acceleration trims. */
export interface RotaryTuning {
  rotorSpeed: 'Low' | 'Normal' | 'High'
  rotorAcc: 'Low' | 'Normal' | 'High'
  hornSpeed: 'Low' | 'Normal' | 'High'
  hornAcc: 'Low' | 'Normal' | 'High'
}

export interface RotaryState {
  speed: RotarySpeed
  drive: number
  /** CLOSE MIC (manual p. 54): the close-miked model — wider stereo image
   *  and a stronger sense of motion on the horn band. */
  closeMic?: boolean
  /** ANGLE (manual p. 54): 'Free' lets the horn/rotor park wherever they
   *  happen to be when Stop Mode engages; a fixed angle (degrees) parks the
   *  amp/pan pose deterministically so Stop Mode always sounds the same. */
  stopAngle?: 'Free' | number
  /** Global Sound-menu tuning; omitted = Normal everywhere. */
  tuning?: RotaryTuning
}

export interface RotaryUnit {
  readonly input: AudioNodeLike
  readonly output: AudioNodeLike
  update(state: RotaryState, now: number): void
  dispose(): void
}

/* --------------------------------------------- Organ vib/chorus scanner -- */

export interface ScannerState {
  type: VibratoType
}

/**
 * Organ vibrato/chorus scanner approximation (manual p. 19): a modulated
 * delay line. Vibrato (V1-V3) outputs the modulated signal only; Chorus
 * (C1-C3) mixes it with the original. Depth increases across 1-3; V1 and C1
 * are audibly distinct effects (wet-only pitch wobble vs dry+wet shimmer).
 */
export function createScanner(ctx: AudioContextLike): EffectUnit<ScannerState> {
  const shell = makeShell(ctx)
  const delay = ctx.createDelay(0.05)
  delay.delayTime.value = 0.0045
  shell.wetIn.connect(delay)
  delay.connect(shell.wetOut)
  const lfo = makeLfo(ctx, delay.delayTime)
  lfo.osc.frequency.value = 6.9 // classic scanner rate

  return {
    input: shell.input,
    output: shell.output,
    update(state, on, now) {
      const level = Number(state.type[1]) // 1..3
      const chorus = state.type[0] === 'C'
      // Delay-line modulation reads out as pitch: deviation ≈ depth × 2πf,
      // so depth = cents/(2π·6.9·(2^(c/1200)−1)) ≈ c × 1.33e-5 s. Levels 1-3
      // target ±7/±14/±21 cents — an audible scan, not a two-semitone warble.
      setParam(lfo.depth.gain, level * 0.000095, now)
      if (chorus) shell.setActive(on, 1, 0.5 + level * 0.12, now)
      else shell.setActive(on, 0.0001, 1, now)
    },
    dispose() {
      stopAndDisconnect(lfo.nodes)
      shell.dispose([delay])
    },
  }
}

/**
 * Single rotary-speaker instance (last in the signal path). Horn and rotor
 * bands rotate at independent rates with realistic acceleration inertia:
 * speed changes ramp the LFO frequencies via setTargetAtTime (horn spins up
 * faster than the bass rotor), matching slow/fast/stop behavior.
 */
export function createRotary(ctx: AudioContextLike): RotaryUnit {
  const input = ctx.createGain()
  const drive = ctx.createWaveShaper()
  const driveIn = ctx.createGain()
  const horn = ctx.createBiquadFilter()
  horn.type = 'highpass'
  horn.frequency.value = 800
  const rotor = ctx.createBiquadFilter()
  rotor.type = 'lowpass'
  rotor.frequency.value = 800
  const output = ctx.createGain()

  input.connect(driveIn)
  driveIn.connect(drive)
  drive.connect(horn)
  drive.connect(rotor)

  // Horn: doppler (modulated micro-delay) + amplitude + pan rotation.
  const hornDoppler = ctx.createDelay(0.05)
  hornDoppler.delayTime.value = 0.0008
  const hornAmp = ctx.createGain()
  hornAmp.gain.value = 0.8
  const hornPan = ctx.createStereoPanner()
  horn.connect(hornDoppler)
  hornDoppler.connect(hornAmp)
  hornAmp.connect(hornPan)
  hornPan.connect(output)
  const hornLfo = ctx.createOscillator()
  hornLfo.type = 'sine'
  hornLfo.frequency.value = 0.8
  hornLfo.start(0)
  const hornDopplerDepth = ctx.createGain()
  hornDopplerDepth.gain.value = 0.00045
  const hornAmpDepth = ctx.createGain()
  hornAmpDepth.gain.value = 0.22
  const hornPanDepth = ctx.createGain()
  hornPanDepth.gain.value = 0.75
  hornLfo.connect(hornDopplerDepth)
  hornDopplerDepth.connect(hornDoppler.delayTime)
  hornLfo.connect(hornAmpDepth)
  hornAmpDepth.connect(hornAmp.gain)
  hornLfo.connect(hornPanDepth)
  hornPanDepth.connect(hornPan.pan)

  // Rotor: amplitude + gentle pan at a slower rate.
  const rotorAmp = ctx.createGain()
  rotorAmp.gain.value = 0.85
  const rotorPan = ctx.createStereoPanner()
  rotor.connect(rotorAmp)
  rotorAmp.connect(rotorPan)
  rotorPan.connect(output)
  const rotorLfo = ctx.createOscillator()
  rotorLfo.type = 'sine'
  rotorLfo.frequency.value = 0.7
  rotorLfo.start(0)
  const rotorAmpDepth = ctx.createGain()
  rotorAmpDepth.gain.value = 0.14
  const rotorPanDepth = ctx.createGain()
  rotorPanDepth.gain.value = 0.35
  rotorLfo.connect(rotorAmpDepth)
  rotorAmpDepth.connect(rotorAmp.gain)
  rotorLfo.connect(rotorPanDepth)
  rotorPanDepth.connect(rotorPan.pan)

  let currentDrive = -1

  return {
    input,
    output,
    update(state, now) {
      if (state.drive !== currentDrive) {
        currentDrive = state.drive
        const amount = state.drive / 127
        if (amount < 0.02) {
          drive.curve = null
          setParam(driveIn.gain, 1, now)
        } else {
          // Gain staging: tanh normalized to ±1 has a small-signal slope of
          // k/tanh(k) ≈ k — left uncompensated it amplified quiet material
          // ~6x at the default knob and pinned full chords to the rails
          // (audible as constant crackle on any rotary-routed program). Keep
          // the curve's saturation ceiling instead (0.85 → 0.5 as the knob
          // rises) and solve the input gain from the intended small-signal
          // gain (1..1.8x), so the knob adds growl and squash — not 15 dB.
          const k = 1 + amount * 10
          const ceiling = 0.85 - amount * 0.35
          const smallSignalGain = 1 + amount * 0.8
          const curve = new Float32Array(2048)
          for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1
            curve[i] = (Math.tanh(x * k) / Math.tanh(k)) * ceiling
          }
          drive.curve = curve
          // slope-at-0 of the curve is ceiling·k/tanh(k); pre-gain solves
          // driveIn · slope = smallSignalGain.
          setParam(driveIn.gain, (smallSignalGain * Math.tanh(k)) / (k * ceiling), now)
        }
      }
      // Acceleration inertia: horn ~0.8 s, rotor ~1.9 s time constants.
      // The Sound menu's speed trims scale the rotation targets (not the
      // stopped state) and its acceleration trims scale the inertia (Low
      // acceleration = slower spin-up = longer time constant).
      const speedScale = (level: 'Low' | 'Normal' | 'High' = 'Normal') => (level === 'Low' ? 0.75 : level === 'High' ? 1.3 : 1)
      const accScale = (level: 'Low' | 'Normal' | 'High' = 'Normal') => (level === 'Low' ? 1.8 : level === 'High' ? 0.45 : 1)
      const tuning = state.tuning
      const hornTarget = state.speed === 'fast' ? 6.7 * speedScale(tuning?.hornSpeed) : state.speed === 'slow' ? 0.8 * speedScale(tuning?.hornSpeed) : 0.02
      const rotorTarget = state.speed === 'fast' ? 5.9 * speedScale(tuning?.rotorSpeed) : state.speed === 'slow' ? 0.7 * speedScale(tuning?.rotorSpeed) : 0.02
      hornLfo.frequency.cancelScheduledValues(now)
      hornLfo.frequency.setTargetAtTime(hornTarget, now, 0.8 * accScale(tuning?.hornAcc))
      rotorLfo.frequency.cancelScheduledValues(now)
      rotorLfo.frequency.setTargetAtTime(rotorTarget, now, 1.9 * accScale(tuning?.rotorAcc))
      // CLOSE MIC (manual p. 54): mics moved toward the horn — deeper
      // amplitude modulation and a wider pan sweep on the horn band (the
      // "more pronounced stereo effect and increased sense of motion"), and
      // slightly more of the horn's doppler shimmer. The rotor band is
      // untouched (the mics move at the horn, not the woofer).
      const closeMic = state.closeMic === true
      const hornAmpBase = closeMic ? 0.32 : 0.22
      const hornPanBase = closeMic ? 0.95 : 0.75
      setParam(hornDopplerDepth.gain, closeMic ? 0.0006 : 0.00045, now, 0.5)
      // ANGLE (manual p. 54): with a fixed stop angle the wobble depth goes
      // to zero and the amp/pan pose parks at that angle's projections —
      // Stop Mode then "sounds exactly the same every time". Free keeps the
      // legacy residual drift, so the parked pose varies.
      const fixedAngle = state.speed === 'stop' && state.stopAngle !== undefined && state.stopAngle !== 'Free' ? (state.stopAngle * Math.PI) / 180 : null
      const depthScale = state.speed === 'stop' ? (fixedAngle !== null ? 0 : 0.15) : 1
      setParam(hornAmpDepth.gain, hornAmpBase * depthScale, now, 0.5)
      setParam(hornPanDepth.gain, hornPanBase * depthScale, now, 0.5)
      setParam(rotorAmpDepth.gain, 0.14 * depthScale, now, 0.5)
      setParam(rotorPanDepth.gain, 0.35 * depthScale, now, 0.5)
      // The parked pose rides the params' BASE values (the LFO contribution
      // sums on top and is zero-depth while parked at a fixed angle): amp at
      // cos(angle) — facing the mic = loudest — and pan at sin(angle).
      setParam(hornAmp.gain, 0.8 + (fixedAngle !== null ? hornAmpBase * Math.cos(fixedAngle) : 0), now, 0.5)
      setParam(hornPan.pan, fixedAngle !== null ? hornPanBase * Math.sin(fixedAngle) : 0, now, 0.5)
      setParam(rotorAmp.gain, 0.85 + (fixedAngle !== null ? 0.14 * Math.cos(fixedAngle) : 0), now, 0.5)
      setParam(rotorPan.pan, fixedAngle !== null ? 0.35 * Math.sin(fixedAngle) : 0, now, 0.5)
    },
    dispose() {
      stopAndDisconnect([
        hornLfo,
        rotorLfo,
        input,
        driveIn,
        drive,
        horn,
        rotor,
        hornDoppler,
        hornAmp,
        hornPan,
        hornDopplerDepth,
        hornAmpDepth,
        hornPanDepth,
        rotorAmp,
        rotorPan,
        rotorAmpDepth,
        rotorPanDepth,
        output,
      ])
    },
  }
}
