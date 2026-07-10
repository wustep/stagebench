/** Per-layer effects chain + shared rotary — Web Audio nodes */

import type {
  AmpEqState,
  AmpType,
  CompressorState,
  DelayFilter,
  DelayState,
  EffectChainState,
  EffectsSectionState,
  Mod1State,
  Mod1Type,
  Mod2State,
  Mod2Type,
  ReverbState,
  ReverbType,
  RotaryState,
} from '../model/piano-types'

const RAMP = 0.012

function ramp(param: AudioParam, value: number, now: number) {
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(value, now + RAMP)
}

export interface ChainNodes {
  input: GainNode
  output: GainNode
  /** dry path when unit bypassed is handled by wet/dry gains */
  mod1: Mod1Nodes
  mod2: Mod2Nodes
  delay: DelayNodes
  ampEq: AmpEqNodes
  compressor: CompressorNodes
  reverb: ReverbNodes
  toRotary: GainNode
  directOut: GainNode
}

interface Mod1Nodes {
  input: GainNode
  output: GainNode
  bypass: GainNode
  wet: GainNode
  lfo: OscillatorNode
  lfoGain: GainNode
  // type-specific
  pan: StereoPannerNode
  tremolo: GainNode
  ring: GainNode
  ringOsc: OscillatorNode
  wah: BiquadFilterNode
  pump: GainNode
}

interface Mod2Nodes {
  input: GainNode
  output: GainNode
  bypass: GainNode
  wet: GainNode
  delayL: DelayNode
  delayR: DelayNode
  fbL: GainNode
  fbR: GainNode
  lfo: OscillatorNode
  lfoGain: GainNode
  dry: GainNode
}

interface DelayNodes {
  input: GainNode
  output: GainNode
  bypass: GainNode
  wet: GainNode
  dry: GainNode
  delay: DelayNode
  feedback: GainNode
  filter: BiquadFilterNode
}

interface AmpEqNodes {
  input: GainNode
  output: GainNode
  bypass: GainNode
  wet: GainNode
  drive: WaveShaperNode
  preGain: GainNode
  bass: BiquadFilterNode
  mid: BiquadFilterNode
  treble: BiquadFilterNode
  lp: BiquadFilterNode
  hp: BiquadFilterNode
}

interface CompressorNodes {
  input: GainNode
  output: GainNode
  bypass: GainNode
  wet: GainNode
  comp: DynamicsCompressorNode
  makeup: GainNode
}

interface ReverbNodes {
  input: GainNode
  output: GainNode
  bypass: GainNode
  wet: GainNode
  dry: GainNode
  convolver: ConvolverNode
  tone: BiquadFilterNode
}

export interface RotaryNodes {
  input: GainNode
  output: GainNode
  hornDelay: DelayNode
  bassFilter: BiquadFilterNode
  lfoHorn: OscillatorNode
  lfoBass: OscillatorNode
  lfoHornGain: GainNode
  lfoBassGain: GainNode
  drive: WaveShaperNode
  pre: GainNode
  wet: GainNode
  bypass: GainNode
}

function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 256
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  const k = 1 + amount * 40
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x))
  }
  return curve
}

function impulseReverb(ctx: BaseAudioContext, type: ReverbType, bright: boolean): AudioBuffer {
  const lengths: Record<ReverbType, number> = {
    Booth: 0.15,
    Room: 0.35,
    Spring: 0.45,
    Stage: 0.9,
    Hall: 1.6,
    Cathedral: 2.8,
  }
  const dur = lengths[type]
  const sr = ctx.sampleRate
  const n = Math.floor(sr * dur)
  const buf = ctx.createBuffer(2, Math.max(1, n), sr)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) {
      const t = i / sr
      let env = Math.exp(-t * (3.5 / dur))
      if (type === 'Spring') {
        env *= 0.7 + 0.3 * Math.sin(t * 55 + ch)
        d[i] = (Math.random() * 2 - 1) * env * (i % 37 === 0 ? 1.8 : 0.6)
      } else {
        d[i] = (Math.random() * 2 - 1) * env * (bright ? 1 : 0.7)
      }
    }
  }
  return buf
}

export function createMod1(ctx: BaseAudioContext): Mod1Nodes {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const bypass = ctx.createGain()
  const wet = ctx.createGain()
  bypass.gain.value = 1
  wet.gain.value = 0

  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 4
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 0
  lfo.connect(lfoGain)
  lfo.start()

  const pan = ctx.createStereoPanner()
  const tremolo = ctx.createGain()
  tremolo.gain.value = 1
  const ring = ctx.createGain()
  ring.gain.value = 0
  const ringOsc = ctx.createOscillator()
  ringOsc.type = 'sine'
  ringOsc.frequency.value = 200
  ringOsc.connect(ring.gain)
  ringOsc.start()
  const wah = ctx.createBiquadFilter()
  wah.type = 'bandpass'
  wah.frequency.value = 800
  wah.Q.value = 4
  const pump = ctx.createGain()
  pump.gain.value = 1

  // parallel type paths all from input; wet sums them — active path selected by gains in apply
  input.connect(bypass)
  bypass.connect(output)

  input.connect(pan)
  pan.connect(wet)
  input.connect(tremolo)
  tremolo.connect(wet)
  input.connect(ring)
  ring.connect(wet)
  input.connect(wah)
  wah.connect(wet)
  input.connect(pump)
  pump.connect(wet)
  wet.connect(output)

  lfoGain.connect(pan.pan)
  lfoGain.connect(tremolo.gain)
  lfoGain.connect(wah.frequency)
  lfoGain.connect(pump.gain)

  return { input, output, bypass, wet, lfo, lfoGain, pan, tremolo, ring, ringOsc, wah, pump }
}

export function createMod2(ctx: BaseAudioContext): Mod2Nodes {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const bypass = ctx.createGain()
  const wet = ctx.createGain()
  const dry = ctx.createGain()
  bypass.gain.value = 1
  wet.gain.value = 0
  dry.gain.value = 1

  const delayL = ctx.createDelay(0.05)
  const delayR = ctx.createDelay(0.05)
  delayL.delayTime.value = 0.012
  delayR.delayTime.value = 0.016
  const fbL = ctx.createGain()
  const fbR = ctx.createGain()
  fbL.gain.value = 0.2
  fbR.gain.value = 0.2

  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 1.2
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 0.002
  lfo.connect(lfoGain)
  lfo.start()
  lfoGain.connect(delayL.delayTime)
  lfoGain.connect(delayR.delayTime)

  input.connect(bypass)
  bypass.connect(output)
  input.connect(dry)
  dry.connect(output)
  input.connect(delayL)
  input.connect(delayR)
  delayL.connect(fbL)
  fbL.connect(delayL)
  delayR.connect(fbR)
  fbR.connect(delayR)
  delayL.connect(wet)
  delayR.connect(wet)
  wet.connect(output)

  return { input, output, bypass, wet, delayL, delayR, fbL, fbR, lfo, lfoGain, dry }
}

export function createDelay(ctx: BaseAudioContext): DelayNodes {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const bypass = ctx.createGain()
  const wet = ctx.createGain()
  const dry = ctx.createGain()
  bypass.gain.value = 1
  wet.gain.value = 0
  dry.gain.value = 1

  const delay = ctx.createDelay(2)
  delay.delayTime.value = 0.3
  const feedback = ctx.createGain()
  feedback.gain.value = 0.3
  const filter = ctx.createBiquadFilter()
  filter.type = 'allpass'
  filter.frequency.value = 8000

  input.connect(bypass)
  bypass.connect(output)
  input.connect(dry)
  dry.connect(output)
  // feedback filter processes repeats: delay → filter → feedback → delay
  input.connect(delay)
  delay.connect(filter)
  filter.connect(feedback)
  feedback.connect(delay)
  filter.connect(wet)
  wet.connect(output)

  return { input, output, bypass, wet, dry, delay, feedback, filter }
}

export function createAmpEq(ctx: BaseAudioContext): AmpEqNodes {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const bypass = ctx.createGain()
  const wet = ctx.createGain()
  bypass.gain.value = 1
  wet.gain.value = 0

  const preGain = ctx.createGain()
  preGain.gain.value = 1
  const drive = ctx.createWaveShaper()
  drive.curve = makeDistortionCurve(0.2)
  drive.oversample = '2x'
  const bass = ctx.createBiquadFilter()
  bass.type = 'lowshelf'
  bass.frequency.value = 100
  const mid = ctx.createBiquadFilter()
  mid.type = 'peaking'
  mid.frequency.value = 1000
  mid.Q.value = 1
  const treble = ctx.createBiquadFilter()
  treble.type = 'highshelf'
  treble.frequency.value = 4000
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 8000
  lp.Q.value = 0.7
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 80
  hp.Q.value = 0.7

  input.connect(bypass)
  bypass.connect(output)
  input.connect(preGain)
  preGain.connect(drive)
  drive.connect(bass)
  bass.connect(mid)
  mid.connect(treble)
  treble.connect(lp)
  lp.connect(hp)
  hp.connect(wet)
  wet.connect(output)

  return { input, output, bypass, wet, drive, preGain, bass, mid, treble, lp, hp }
}

export function createCompressor(ctx: BaseAudioContext): CompressorNodes {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const bypass = ctx.createGain()
  const wet = ctx.createGain()
  bypass.gain.value = 1
  wet.gain.value = 0
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -24
  comp.knee.value = 12
  comp.ratio.value = 4
  comp.attack.value = 0.01
  comp.release.value = 0.2
  const makeup = ctx.createGain()
  makeup.gain.value = 1

  input.connect(bypass)
  bypass.connect(output)
  input.connect(comp)
  comp.connect(makeup)
  makeup.connect(wet)
  wet.connect(output)

  return { input, output, bypass, wet, comp, makeup }
}

export function createReverb(ctx: BaseAudioContext): ReverbNodes {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const bypass = ctx.createGain()
  const wet = ctx.createGain()
  const dry = ctx.createGain()
  bypass.gain.value = 1
  wet.gain.value = 0
  dry.gain.value = 1
  const convolver = ctx.createConvolver()
  convolver.buffer = impulseReverb(ctx, 'Hall', true)
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 10000

  input.connect(bypass)
  bypass.connect(output)
  input.connect(dry)
  dry.connect(output)
  input.connect(convolver)
  convolver.connect(tone)
  tone.connect(wet)
  wet.connect(output)

  return { input, output, bypass, wet, dry, convolver, tone }
}

export function createRotary(ctx: BaseAudioContext): RotaryNodes {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const bypass = ctx.createGain()
  const wet = ctx.createGain()
  bypass.gain.value = 1
  wet.gain.value = 0
  const pre = ctx.createGain()
  pre.gain.value = 1
  const drive = ctx.createWaveShaper()
  drive.curve = makeDistortionCurve(0.15)
  const hornDelay = ctx.createDelay(0.02)
  hornDelay.delayTime.value = 0.008
  const bassFilter = ctx.createBiquadFilter()
  bassFilter.type = 'lowpass'
  bassFilter.frequency.value = 600
  const lfoHorn = ctx.createOscillator()
  lfoHorn.type = 'sine'
  lfoHorn.frequency.value = 1
  const lfoBass = ctx.createOscillator()
  lfoBass.type = 'sine'
  lfoBass.frequency.value = 0.8
  const lfoHornGain = ctx.createGain()
  lfoHornGain.gain.value = 0.003
  const lfoBassGain = ctx.createGain()
  lfoBassGain.gain.value = 80
  lfoHorn.connect(lfoHornGain)
  lfoHornGain.connect(hornDelay.delayTime)
  lfoBass.connect(lfoBassGain)
  lfoBassGain.connect(bassFilter.frequency)
  lfoHorn.start()
  lfoBass.start()

  input.connect(bypass)
  bypass.connect(output)
  input.connect(pre)
  pre.connect(drive)
  drive.connect(hornDelay)
  drive.connect(bassFilter)
  hornDelay.connect(wet)
  bassFilter.connect(wet)
  wet.connect(output)

  return {
    input,
    output,
    hornDelay,
    bassFilter,
    lfoHorn,
    lfoBass,
    lfoHornGain,
    lfoBassGain,
    drive,
    pre,
    wet,
    bypass,
  }
}

export function createChain(ctx: BaseAudioContext): ChainNodes {
  const mod1 = createMod1(ctx)
  const mod2 = createMod2(ctx)
  const delay = createDelay(ctx)
  const ampEq = createAmpEq(ctx)
  const compressor = createCompressor(ctx)
  const reverb = createReverb(ctx)
  const input = ctx.createGain()
  const output = ctx.createGain()
  const toRotary = ctx.createGain()
  const directOut = ctx.createGain()
  toRotary.gain.value = 0
  directOut.gain.value = 1

  // Order: source → Mod1 → Mod2 → Delay → Amp → Comp → Reverb → (to rotary | direct)
  input.connect(mod1.input)
  mod1.output.connect(mod2.input)
  mod2.output.connect(delay.input)
  delay.output.connect(ampEq.input)
  ampEq.output.connect(compressor.input)
  compressor.output.connect(reverb.input)
  reverb.output.connect(toRotary)
  reverb.output.connect(directOut)
  directOut.connect(output)
  // toRotary is connected externally to shared rotary

  return { input, output, mod1, mod2, delay, ampEq, compressor, reverb, toRotary, directOut }
}

function setBypass(bypass: GainNode, wet: GainNode, on: boolean, now: number, wetLevel = 1) {
  if (on) {
    ramp(bypass.gain, 0, now)
    ramp(wet.gain, wetLevel, now)
  } else {
    ramp(bypass.gain, 1, now)
    ramp(wet.gain, 0, now)
  }
}

export function applyMod1(nodes: Mod1Nodes, state: Mod1State, now: number, allBypass: boolean) {
  const on = state.on && !allBypass
  const amount = state.amount
  setBypass(nodes.bypass, nodes.wet, on, now, on ? Math.max(0.15, amount) : 0)
  const rateHz = 0.2 + state.rate * 12
  ramp(nodes.lfo.frequency, rateHz, now)
  // mute unused paths by zeroing intermediate — keep simple: LFO amount drives active effect
  const type = state.type
  let lfoDepth = 0
  if (type === 'A-Pan') lfoDepth = amount
  else if (type === 'Tremolo') lfoDepth = amount * 0.5
  else if (type === 'Wah') lfoDepth = 400 + amount * 2000
  else if (type === 'A-Wah') lfoDepth = 300 + amount * 1500
  else if (type === 'Pump') lfoDepth = amount * 0.7
  else if (type === 'Ring Mod') {
    ramp(nodes.ringOsc.frequency, 40 + state.rate * 800, now)
    lfoDepth = 0
    ramp(nodes.ring.gain, on ? amount : 0, now)
  }
  if (type !== 'Ring Mod') ramp(nodes.ring.gain, 0, now)
  ramp(nodes.lfoGain.gain, on ? lfoDepth : 0, now)
  // tremolo base
  if (type === 'Tremolo' && on) {
    nodes.tremolo.gain.setValueAtTime(1 - amount * 0.5, now)
  }
}

export function applyMod2(nodes: Mod2Nodes, state: Mod2State, now: number, allBypass: boolean) {
  const on = state.on && !allBypass
  setBypass(nodes.bypass, nodes.wet, on, now, on ? state.amount * 0.8 : 0)
  if (on) ramp(nodes.dry.gain, 1 - state.amount * 0.4, now)
  else ramp(nodes.dry.gain, 1, now)
  ramp(nodes.lfo.frequency, 0.2 + state.rate * 6, now)
  const type = state.type
  let depth = 0.001 + state.amount * 0.004
  let fb = 0.1
  if (type === 'Flanger') {
    depth = 0.001 + state.amount * 0.003
    fb = 0.3 + state.amount * 0.4
    ramp(nodes.delayL.delayTime, 0.003, now)
  } else if (type === 'Phaser') {
    depth = 0.002 + state.amount * 0.005
    fb = 0.4
  } else if (type === 'Chorus') {
    depth = 0.002 + state.amount * 0.006
    fb = 0.15
  } else if (type === 'Vibe') {
    depth = 0.003 + state.amount * 0.005
    fb = 0.2
  } else if (type === 'Ensemble') {
    depth = 0.004 + state.amount * 0.008
    fb = 0.25
  } else if (type === 'Spin') {
    depth = 0.002 + state.amount * 0.004
    fb = 0.1
    ramp(nodes.lfo.frequency, 0.4 + state.rate * 3, now)
  }
  ramp(nodes.lfoGain.gain, on ? depth : 0, now)
  ramp(nodes.fbL.gain, on ? fb : 0, now)
  ramp(nodes.fbR.gain, on ? fb : 0, now)
}

function applyDelayFilter(filter: BiquadFilterNode, mode: DelayFilter, now: number) {
  if (mode === 'Off') {
    filter.type = 'allpass'
    ramp(filter.frequency, 10000, now)
  } else if (mode === 'LP') {
    filter.type = 'lowpass'
    ramp(filter.frequency, 1200, now)
  } else if (mode === 'HP') {
    filter.type = 'highpass'
    ramp(filter.frequency, 800, now)
  } else {
    filter.type = 'bandpass'
    ramp(filter.frequency, 1500, now)
    filter.Q.value = 2
  }
}

export function applyDelay(nodes: DelayNodes, state: DelayState, now: number, allBypass: boolean) {
  const on = state.on && !allBypass
  setBypass(nodes.bypass, nodes.wet, on, now, on ? state.mix : 0)
  ramp(nodes.dry.gain, on ? 1 - state.mix * 0.7 : 1, now)
  const time = 0.05 + state.tempo * 0.7
  ramp(nodes.delay.delayTime, time, now)
  ramp(nodes.feedback.gain, on ? state.feedback * 0.85 : 0, now)
  applyDelayFilter(nodes.filter, state.filter, now)
}

export function applyAmpEq(nodes: AmpEqNodes, state: AmpEqState, now: number, allBypass: boolean) {
  const on = state.on && !allBypass
  // To Rotary still runs amp path before routing
  setBypass(nodes.bypass, nodes.wet, on, now, on ? 1 : 0)
  const type = state.type
  const driveAmt = state.drive
  nodes.drive.curve = makeDistortionCurve(
    type === 'Twin' ? driveAmt * 0.8 : type === 'JC' ? driveAmt * 0.5 : type === 'Small' ? driveAmt * 1.1 : driveAmt * 0.2,
  )
  ramp(nodes.preGain.gain, 1 + driveAmt * (type === 'EQ only' ? 0 : 1.5), now)

  const bassDb = (state.bass - 0.5) * 30
  const midDb = (state.mid - 0.5) * 30
  const trebleDb = (state.treble - 0.5) * 30
  ramp(nodes.bass.gain, on ? bassDb : 0, now)
  ramp(nodes.mid.gain, on ? midDb : 0, now)
  ramp(nodes.treble.gain, on ? trebleDb : 0, now)
  ramp(nodes.mid.frequency, 200 + state.midFreq * 7800, now)

  if (type === 'LP24 Filter') {
    nodes.lp.type = 'lowpass'
    ramp(nodes.lp.frequency, 200 + state.midFreq * 8000, now)
    nodes.lp.Q.value = 0.5 + state.mid * 8
    ramp(nodes.hp.frequency, 20, now)
  } else if (type === 'HP24 Filter') {
    nodes.hp.type = 'highpass'
    ramp(nodes.hp.frequency, 40 + state.midFreq * 4000, now)
    nodes.hp.Q.value = 0.5 + state.mid * 8
    ramp(nodes.lp.frequency, 18000, now)
  } else {
    // amp coloring
    if (type === 'Twin') {
      ramp(nodes.lp.frequency, 6000, now)
      ramp(nodes.hp.frequency, 60, now)
    } else if (type === 'JC') {
      ramp(nodes.lp.frequency, 9000, now)
      ramp(nodes.hp.frequency, 80, now)
    } else if (type === 'Small') {
      ramp(nodes.lp.frequency, 4000, now)
      ramp(nodes.hp.frequency, 120, now)
    } else {
      ramp(nodes.lp.frequency, 16000, now)
      ramp(nodes.hp.frequency, 20, now)
    }
  }
}

export function applyCompressor(
  nodes: CompressorNodes,
  state: CompressorState,
  now: number,
  allBypass: boolean,
) {
  const on = state.on && !allBypass
  setBypass(nodes.bypass, nodes.wet, on, now, on ? 1 : 0)
  const amt = state.amount
  nodes.comp.threshold.value = -12 - amt * 30
  nodes.comp.ratio.value = 2 + amt * 10
  nodes.comp.attack.value = state.fast ? 0.003 : 0.02
  nodes.comp.release.value = state.fast ? 0.05 : 0.25
  ramp(nodes.makeup.gain, on ? 1 + amt * 0.6 : 1, now)
}

export function applyReverb(nodes: ReverbNodes, state: ReverbState, now: number, allBypass: boolean) {
  const on = state.on && !allBypass
  setBypass(nodes.bypass, nodes.wet, on, now, on ? state.mix : 0)
  ramp(nodes.dry.gain, on ? 1 - state.mix * 0.85 : 1, now)
  // rebuild impulse when type changes — always refresh for honesty of distinct types
  const ctx =
    (nodes.convolver as ConvolverNode & { context?: BaseAudioContext }).context ??
    (nodes.input as GainNode & { context?: BaseAudioContext }).context
  if (ctx) {
    nodes.convolver.buffer = impulseReverb(ctx, state.type, state.bright)
  }
  ramp(nodes.tone.frequency, state.bright ? 12000 : 3500, now)
}

export function applyRotary(nodes: RotaryNodes, state: RotaryState, now: number) {
  const on = state.on
  setBypass(nodes.bypass, nodes.wet, on, now, on ? 1 : 0)
  const speed = state.fast ? 6.5 : 0.9
  ramp(nodes.lfoHorn.frequency, speed, now)
  ramp(nodes.lfoBass.frequency, speed * 0.85, now)
  nodes.drive.curve = makeDistortionCurve(state.drive)
  ramp(nodes.pre.gain, 1 + state.drive, now)
}

export function applyChain(
  nodes: ChainNodes,
  chain: EffectChainState,
  now: number,
  allBypass: boolean,
  rotaryRouted: boolean,
) {
  applyMod1(nodes.mod1, chain.mod1, now, allBypass)
  applyMod2(nodes.mod2, chain.mod2, now, allBypass)
  applyDelay(nodes.delay, chain.delay, now, allBypass)
  applyAmpEq(nodes.ampEq, chain.ampEq, now, allBypass)
  applyCompressor(nodes.compressor, chain.compressor, now, allBypass)
  applyReverb(nodes.reverb, chain.reverb, now, allBypass)
  // To Rotary: amp type routes layer into rotary after reverb
  const toRot = rotaryRouted && chain.ampEq.type === 'To Rotary'
  ramp(nodes.toRotary.gain, toRot ? 1 : 0, now)
  ramp(nodes.directOut.gain, toRot ? 0 : 1, now)
}

export function resolveChainState(
  fx: EffectsSectionState,
  layer: 'Organ' | 'PianoA' | 'PianoB' | 'SynthA' | 'SynthB' | 'SynthC',
): EffectChainState {
  // group mode: B shares A's settings
  const base =
    fx.pianoGroup && layer === 'PianoB' ? fx.chains.PianoA : fx.chains[layer]
  const chain: EffectChainState = {
    mod1: { ...base.mod1 },
    mod2: { ...base.mod2 },
    delay: { ...base.delay },
    ampEq: { ...base.ampEq },
    compressor: { ...base.compressor },
    reverb: { ...base.reverb },
  }
  if (chain.delay.global || fx.globalDelay.on) {
    chain.delay = { ...fx.globalDelay, on: fx.globalDelay.on || chain.delay.on, global: true }
  }
  if (chain.compressor.global || fx.globalCompressor.on) {
    chain.compressor = {
      ...fx.globalCompressor,
      on: fx.globalCompressor.on || chain.compressor.on,
      global: true,
    }
  }
  if (chain.reverb.global || fx.globalReverb.on) {
    chain.reverb = { ...fx.globalReverb, on: fx.globalReverb.on || chain.reverb.on, global: true }
  }
  return chain
}

export type {
  AmpType,
  DelayFilter,
  EffectsSectionState,
  Mod1Type,
  Mod2Type,
  ReverbType,
}
