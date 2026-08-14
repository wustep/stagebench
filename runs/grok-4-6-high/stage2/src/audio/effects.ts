import { makeDriveCurve } from './software-context'
import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  DelayNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  StereoPannerNodeLike,
  WaveShaperNodeLike,
} from './types'
import type { InstrumentState, LayerFx, LayerId } from '../model/instrument-state'
import { delayTimeSec } from '../model/instrument-state'

const RAMP = 0.012

export function rampTo(param: AudioParamLike, value: number, time: number, seconds = RAMP): void {
  const current = param.getValueAtTime?.(time) ?? param.value
  try {
    param.cancelScheduledValues(time)
    param.setValueAtTime(Number.isFinite(current) ? current : value, time)
    param.linearRampToValueAtTime(value, time + seconds)
  } catch {
    param.value = value
  }
}

function absCurve(): Float32Array {
  const n = 256
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) c[i] = Math.abs((i / (n - 1)) * 2 - 1)
  return c
}

interface Lfo {
  osc: OscillatorNodeLike
  depth: GainNodeLike
}

function startLfo(ctx: AudioContextLike, freq: number): Lfo {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, ctx.currentTime)
  const depth = ctx.createGain()
  depth.gain.setValueAtTime(0, ctx.currentTime)
  osc.connect(depth)
  osc.start(0)
  return { osc, depth }
}

export interface LayerGraph {
  input: GainNodeLike
  level: GainNodeLike
  rotarySend: GainNodeLike
  apply: (state: InstrumentState, layer: LayerId, time: number) => void
  dispose: () => void
}

interface Mod1Nodes {
  dry: GainNodeLike
  wet: GainNodeLike
  mix: GainNodeLike
  panner: StereoPannerNodeLike
  trem: GainNodeLike
  ring: GainNodeLike
  ringOsc: OscillatorNodeLike
  wah: BiquadFilterNodeLike
  env: WaveShaperNodeLike
  envLp: BiquadFilterNodeLike
  envGain: GainNodeLike
  lfo: Lfo
  panGain: GainNodeLike
  tremPath: GainNodeLike
  ringPath: GainNodeLike
  wahPath: GainNodeLike
}

function createMod1(ctx: AudioContextLike, input: GainNodeLike): { output: GainNodeLike; nodes: Mod1Nodes } {
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const mix = ctx.createGain()
  const panner = ctx.createStereoPanner()
  const trem = ctx.createGain()
  const ring = ctx.createGain()
  const ringOsc = ctx.createOscillator()
  ringOsc.type = 'sine'
  ringOsc.frequency.setValueAtTime(80, 0)
  ringOsc.start(0)
  const wah = ctx.createBiquadFilter()
  wah.type = 'bandpass'
  wah.frequency.setValueAtTime(800, 0)
  wah.Q.setValueAtTime(4, 0)
  const env = ctx.createWaveShaper()
  env.curve = absCurve()
  const envLp = ctx.createBiquadFilter()
  envLp.type = 'lowpass'
  envLp.frequency.setValueAtTime(12, 0)
  const envGain = ctx.createGain()
  envGain.gain.setValueAtTime(0, 0)
  const lfo = startLfo(ctx, 4)

  const panGain = ctx.createGain()
  const tremPath = ctx.createGain()
  const ringPath = ctx.createGain()
  const wahPath = ctx.createGain()
  panGain.gain.setValueAtTime(0, 0)
  tremPath.gain.setValueAtTime(0, 0)
  ringPath.gain.setValueAtTime(0, 0)
  wahPath.gain.setValueAtTime(0, 0)
  input.connect(dry)
  input.connect(panner)
  input.connect(trem)
  input.connect(ring)
  input.connect(wah)
  input.connect(env)
  env.connect(envLp)
  envLp.connect(envGain)
  envGain.connect(wah.frequency)
  lfo.depth.connect(panner.pan)
  lfo.depth.connect(trem.gain)
  lfo.depth.connect(wah.frequency)
  ringOsc.connect(ring.gain)
  panner.connect(panGain)
  trem.connect(tremPath)
  ring.connect(ringPath)
  wah.connect(wahPath)
  panGain.connect(wet)
  tremPath.connect(wet)
  ringPath.connect(wet)
  wahPath.connect(wet)
  dry.connect(mix)
  wet.connect(mix)
  dry.gain.setValueAtTime(1, 0)
  wet.gain.setValueAtTime(0, 0)
  trem.gain.setValueAtTime(1, 0)
  ring.gain.setValueAtTime(0, 0)
  return {
    output: mix,
    nodes: {
      dry,
      wet,
      mix,
      panner,
      trem,
      ring,
      ringOsc,
      wah,
      env,
      envLp,
      envGain,
      lfo,
      panGain,
      tremPath,
      ringPath,
      wahPath,
    },
  }
}

interface Mod2Nodes {
  dry: GainNodeLike
  wet: GainNodeLike
  mix: GainNodeLike
  delay: DelayNodeLike
  delay2: DelayNodeLike
  delay3: DelayNodeLike
  fb: GainNodeLike
  ap1: BiquadFilterNodeLike
  ap2: BiquadFilterNodeLike
  ap3: BiquadFilterNodeLike
  lfo: Lfo
  lfo2: Lfo
  spinFilter: BiquadFilterNodeLike
}

function createMod2(ctx: AudioContextLike, input: GainNodeLike): { output: GainNodeLike; nodes: Mod2Nodes } {
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const mix = ctx.createGain()
  const delay = ctx.createDelay(0.08)
  const delay2 = ctx.createDelay(0.08)
  const delay3 = ctx.createDelay(0.08)
  const fb = ctx.createGain()
  const ap1 = ctx.createBiquadFilter()
  const ap2 = ctx.createBiquadFilter()
  const ap3 = ctx.createBiquadFilter()
  ap1.type = 'allpass'
  ap2.type = 'allpass'
  ap3.type = 'allpass'
  ap1.frequency.setValueAtTime(500, 0)
  ap2.frequency.setValueAtTime(900, 0)
  ap3.frequency.setValueAtTime(1400, 0)
  const spinFilter = ctx.createBiquadFilter()
  spinFilter.type = 'lowpass'
  spinFilter.frequency.setValueAtTime(4000, 0)
  const lfo = startLfo(ctx, 1.2)
  const lfo2 = startLfo(ctx, 0.85)
  input.connect(dry)
  input.connect(delay)
  input.connect(delay2)
  input.connect(delay3)
  input.connect(ap1)
  delay.connect(fb)
  fb.connect(delay)
  delay.connect(wet)
  delay2.connect(wet)
  delay3.connect(wet)
  ap1.connect(ap2)
  ap2.connect(ap3)
  ap3.connect(spinFilter)
  spinFilter.connect(wet)
  lfo.depth.connect(delay.delayTime)
  lfo2.depth.connect(delay2.delayTime)
  lfo.depth.connect(ap1.frequency)
  dry.connect(mix)
  wet.connect(mix)
  dry.gain.setValueAtTime(1, 0)
  wet.gain.setValueAtTime(0, 0)
  fb.gain.setValueAtTime(0, 0)
  delay.delayTime.setValueAtTime(0.012, 0)
  delay2.delayTime.setValueAtTime(0.017, 0)
  delay3.delayTime.setValueAtTime(0.023, 0)
  return { output: mix, nodes: { dry, wet, mix, delay, delay2, delay3, fb, ap1, ap2, ap3, lfo, lfo2, spinFilter } }
}

interface DelayNodes {
  dry: GainNodeLike
  wet: GainNodeLike
  mix: GainNodeLike
  delay: DelayNodeLike
  fb: GainNodeLike
  filter: BiquadFilterNodeLike
}

function createDelayUnit(ctx: AudioContextLike, input: GainNodeLike): { output: GainNodeLike; nodes: DelayNodes } {
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const mix = ctx.createGain()
  const delay = ctx.createDelay(2)
  const fb = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(18000, 0)
  input.connect(dry)
  input.connect(delay)
  delay.connect(filter)
  filter.connect(fb)
  fb.connect(delay)
  filter.connect(wet)
  dry.connect(mix)
  wet.connect(mix)
  dry.gain.setValueAtTime(1, 0)
  wet.gain.setValueAtTime(0, 0)
  fb.gain.setValueAtTime(0.25, 0)
  delay.delayTime.setValueAtTime(0.3, 0)
  return { output: mix, nodes: { dry, wet, mix, delay, fb, filter } }
}

interface AmpNodes {
  dry: GainNodeLike
  wet: GainNodeLike
  mix: GainNodeLike
  bass: BiquadFilterNodeLike
  mid: BiquadFilterNodeLike
  treble: BiquadFilterNodeLike
  lp1: BiquadFilterNodeLike
  lp2: BiquadFilterNodeLike
  drive: WaveShaperNodeLike
}

function createAmp(ctx: AudioContextLike, input: GainNodeLike): { output: GainNodeLike; nodes: AmpNodes } {
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const mix = ctx.createGain()
  const bass = ctx.createBiquadFilter()
  bass.type = 'lowshelf'
  bass.frequency.setValueAtTime(100, 0)
  const mid = ctx.createBiquadFilter()
  mid.type = 'peaking'
  mid.frequency.setValueAtTime(800, 0)
  const treble = ctx.createBiquadFilter()
  treble.type = 'highshelf'
  treble.frequency.setValueAtTime(4000, 0)
  const lp1 = ctx.createBiquadFilter()
  const lp2 = ctx.createBiquadFilter()
  lp1.type = 'lowpass'
  lp2.type = 'lowpass'
  lp1.frequency.setValueAtTime(18000, 0)
  lp2.frequency.setValueAtTime(18000, 0)
  const drive = ctx.createWaveShaper()
  drive.curve = makeDriveCurve(0.2)
  input.connect(dry)
  input.connect(bass)
  bass.connect(mid)
  mid.connect(treble)
  treble.connect(lp1)
  lp1.connect(lp2)
  lp2.connect(drive)
  drive.connect(wet)
  dry.connect(mix)
  wet.connect(mix)
  dry.gain.setValueAtTime(1, 0)
  wet.gain.setValueAtTime(0, 0)
  return { output: mix, nodes: { dry, wet, mix, bass, mid, treble, lp1, lp2, drive } }
}

interface CompNodes {
  dry: GainNodeLike
  wet: GainNodeLike
  mix: GainNodeLike
  comp: DynamicsCompressorNodeLike
}

function createComp(ctx: AudioContextLike, input: GainNodeLike): { output: GainNodeLike; nodes: CompNodes } {
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const mix = ctx.createGain()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.setValueAtTime(-24, 0)
  comp.ratio.setValueAtTime(6, 0)
  input.connect(dry)
  input.connect(comp)
  comp.connect(wet)
  dry.connect(mix)
  wet.connect(mix)
  dry.gain.setValueAtTime(1, 0)
  wet.gain.setValueAtTime(0, 0)
  return { output: mix, nodes: { dry, wet, mix, comp } }
}

interface ReverbNodes {
  dry: GainNodeLike
  wet: GainNodeLike
  mix: GainNodeLike
  d1: DelayNodeLike
  d2: DelayNodeLike
  d3: DelayNodeLike
  d4: DelayNodeLike
  fb1: GainNodeLike
  fb2: GainNodeLike
  fb3: GainNodeLike
  fb4: GainNodeLike
  tone: BiquadFilterNodeLike
}

function createReverb(ctx: AudioContextLike, input: GainNodeLike): { output: GainNodeLike; nodes: ReverbNodes } {
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const mix = ctx.createGain()
  const d1 = ctx.createDelay(2)
  const d2 = ctx.createDelay(2)
  const d3 = ctx.createDelay(2)
  const d4 = ctx.createDelay(2)
  const fb1 = ctx.createGain()
  const fb2 = ctx.createGain()
  const fb3 = ctx.createGain()
  const fb4 = ctx.createGain()
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.setValueAtTime(6000, 0)
  input.connect(dry)
  input.connect(d1)
  input.connect(d2)
  input.connect(d3)
  input.connect(d4)
  d1.connect(fb1)
  fb1.connect(d2)
  d2.connect(fb2)
  fb2.connect(d3)
  d3.connect(fb3)
  fb3.connect(d4)
  d4.connect(fb4)
  fb4.connect(d1)
  d1.connect(tone)
  d2.connect(tone)
  d3.connect(tone)
  d4.connect(tone)
  tone.connect(wet)
  dry.connect(mix)
  wet.connect(mix)
  dry.gain.setValueAtTime(1, 0)
  wet.gain.setValueAtTime(0, 0)
  fb1.gain.setValueAtTime(0.35, 0)
  fb2.gain.setValueAtTime(0.32, 0)
  fb3.gain.setValueAtTime(0.28, 0)
  fb4.gain.setValueAtTime(0.25, 0)
  d1.delayTime.setValueAtTime(0.029, 0)
  d2.delayTime.setValueAtTime(0.037, 0)
  d3.delayTime.setValueAtTime(0.043, 0)
  d4.delayTime.setValueAtTime(0.053, 0)
  return { output: mix, nodes: { dry, wet, mix, d1, d2, d3, d4, fb1, fb2, fb3, fb4, tone } }
}

export interface RotaryGraph {
  input: GainNodeLike
  output: GainNodeLike
  apply: (state: InstrumentState, time: number, active: boolean) => void
  dispose: () => void
}

export function createRotary(ctx: AudioContextLike): RotaryGraph {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const horn = ctx.createDelay(0.02)
  const rotor = ctx.createBiquadFilter()
  rotor.type = 'lowpass'
  rotor.frequency.setValueAtTime(800, 0)
  const drive = ctx.createWaveShaper()
  drive.curve = makeDriveCurve(0.3)
  const lfo = startLfo(ctx, 1)
  const lfoFast = startLfo(ctx, 6)
  input.connect(dry)
  input.connect(drive)
  drive.connect(horn)
  drive.connect(rotor)
  horn.connect(wet)
  rotor.connect(wet)
  lfo.depth.connect(horn.delayTime)
  lfoFast.depth.connect(rotor.frequency)
  dry.connect(output)
  wet.connect(output)
  dry.gain.setValueAtTime(1, 0)
  wet.gain.setValueAtTime(0, 0)
  horn.delayTime.setValueAtTime(0.004, 0)
  return {
    input,
    output,
    apply(state, time, active) {
      const on = active && state.rotaryOn
      rampTo(dry.gain, on ? 0.15 : 1, time)
      rampTo(wet.gain, on ? 0.9 : 0, time)
      const hz = 0.8 + state.rotarySpeed * 6.5
      rampTo(lfo.osc.frequency, hz, time, 0.18)
      rampTo(lfoFast.osc.frequency, hz * 1.4, time, 0.18)
      rampTo(lfo.depth.gain, on ? 0.003 : 0, time)
      rampTo(lfoFast.depth.gain, on ? 280 : 0, time)
      drive.curve = makeDriveCurve(0.15 + state.rotaryDrive * 0.7)
    },
    dispose() {
      try {
        lfo.osc.stop()
        lfoFast.osc.stop()
      } catch {
        /* already stopped */
      }
    },
  }
}

export function createLayerGraph(ctx: AudioContextLike): LayerGraph {
  const input = ctx.createGain()
  const bypassDry = ctx.createGain()
  input.connect(bypassDry)
  const mod1 = createMod1(ctx, input)
  const mod2 = createMod2(ctx, mod1.output)
  const delay = createDelayUnit(ctx, mod2.output)
  const amp = createAmp(ctx, delay.output)
  const comp = createComp(ctx, amp.output)
  const reverb = createReverb(ctx, comp.output)
  const fxBus = ctx.createGain()
  reverb.output.connect(fxBus)
  bypassDry.connect(fxBus)
  bypassDry.gain.setValueAtTime(0, 0)
  const rotarySend = ctx.createGain()
  const local = ctx.createGain()
  const rotary = createRotary(ctx)
  fxBus.connect(rotarySend)
  fxBus.connect(local)
  rotarySend.connect(rotary.input)
  rotarySend.gain.setValueAtTime(0, 0)
  local.gain.setValueAtTime(1, 0)
  const level = ctx.createGain()
  local.connect(level)
  rotary.output.connect(level)

  const lfos: OscillatorNodeLike[] = [
    mod1.nodes.lfo.osc,
    mod1.nodes.ringOsc,
    mod2.nodes.lfo.osc,
    mod2.nodes.lfo2.osc,
  ]

  return {
    input,
    level,
    rotarySend,
    apply(state, layerId, time) {
      const layer = state.layers[layerId]
      const fx = resolveFx(state, layerId)
      const allOn = state.fxSectionOn
      rampTo(bypassDry.gain, allOn ? 0 : 1, time)
      rampTo(mod1.nodes.mix.gain, allOn ? 1 : 0, time)
      applyMod1(mod1.nodes, fx, allOn && fx.mod1On, time)
      applyMod2(mod2.nodes, fx, allOn && fx.mod2On, time)
      applyDelay(delay.nodes, fx, allOn && fx.delayOn, time)
      applyAmp(amp.nodes, fx, allOn && fx.ampOn, time)
      applyComp(comp.nodes, fx, allOn && fx.compOn, time)
      applyReverb(reverb.nodes, fx, allOn && fx.reverbOn, time)
      const toRotary = fx.ampOn && fx.ampType === 'To Rotary'
      rampTo(rotarySend.gain, toRotary ? 1 : 0, time)
      rampTo(local.gain, toRotary ? 0 : 1, time)
      rotary.apply(state, time, toRotary && allOn)
      rampTo(level.gain, Math.max(0.0001, layer.level * (layer.enable && state.pianoOn ? 1 : 0)), time)
    },
    dispose() {
      rotary.dispose()
      for (const osc of lfos) {
        try {
          osc.stop()
        } catch {
          /* already */
        }
      }
    },
  }
}

export function resolveFx(state: InstrumentState, layerId: LayerId): LayerFx {
  const self = state.layers[layerId].fx
  const other = state.layers[layerId === 'A' ? 'B' : 'A'].fx
  const src = state.pianoGroup ? state.layers.A.fx : self
  const fx = { ...src }
  if (state.delayGlobal) {
    fx.delayOn = self.delayOn || other.delayOn || src.delayOn
    fx.delayTempo = src.delayTempo
    fx.delayFeedback = src.delayFeedback
    fx.delayMix = src.delayMix
    fx.delayFilter = src.delayFilter
  }
  if (state.compGlobal) {
    fx.compOn = self.compOn || other.compOn || src.compOn
    fx.compAmount = src.compAmount
    fx.compFast = src.compFast
  }
  if (state.reverbGlobal) {
    fx.reverbOn = self.reverbOn || other.reverbOn || src.reverbOn
    fx.reverbType = src.reverbType
    fx.reverbMix = src.reverbMix
    fx.reverbBright = src.reverbBright
  }
  return fx
}

function applyMod1(n: Mod1Nodes, fx: LayerFx, on: boolean, time: number): void {
  rampTo(n.dry.gain, on ? 0.05 : 1, time)
  rampTo(n.wet.gain, on ? 1 : 0, time)
  const lfoHz = 0.2 + fx.mod1Rate * 10
  const ringHz = 30 + fx.mod1Rate * 700
  rampTo(n.lfo.osc.frequency, lfoHz, time)
  rampTo(n.ringOsc.frequency, ringHz, time)
  n.lfo.osc.type = fx.mod1Type === 'Pump' ? 'square' : 'sine'
  rampTo(n.panner.pan, 0, time)
  rampTo(n.trem.gain, 1, time)
  rampTo(n.ring.gain, 0, time)
  rampTo(n.envGain.gain, 0, time)
  rampTo(n.lfo.depth.gain, 0, time)
  rampTo(n.panGain.gain, 0, time)
  rampTo(n.tremPath.gain, 0, time)
  rampTo(n.ringPath.gain, 0, time)
  rampTo(n.wahPath.gain, 0, time)
  if (!on) return
  if (fx.mod1Type === 'A-Pan') {
    rampTo(n.panGain.gain, 1, time)
    rampTo(n.lfo.depth.gain, fx.mod1Amount, time)
  }
  if (fx.mod1Type === 'Tremolo') {
    rampTo(n.tremPath.gain, 1, time)
    rampTo(n.trem.gain, 1 - fx.mod1Amount * 0.48, time)
    rampTo(n.lfo.depth.gain, fx.mod1Amount * 0.48, time)
  }
  if (fx.mod1Type === 'Pump') {
    rampTo(n.tremPath.gain, 1, time)
    rampTo(n.trem.gain, 1 - fx.mod1Amount * 0.72, time)
    rampTo(n.lfo.depth.gain, -fx.mod1Amount * 0.35, time)
  }
  if (fx.mod1Type === 'Ring Mod') {
    rampTo(n.ringPath.gain, 1, time)
    rampTo(n.ring.gain, fx.mod1Amount * 0.6, time)
  }
  if (fx.mod1Type === 'Wah') {
    rampTo(n.wahPath.gain, 1, time)
    rampTo(n.wah.frequency, 400 + fx.mod1Amount * 900, time)
    rampTo(n.lfo.depth.gain, 500 + fx.mod1Amount * 1400, time)
  }
  if (fx.mod1Type === 'A-Wah') {
    rampTo(n.wahPath.gain, 1, time)
    rampTo(n.wah.frequency, 350 + fx.mod1Rate * 400, time)
    rampTo(n.envGain.gain, 400 + fx.mod1Amount * 2200, time)
  }
}

function applyMod2(n: Mod2Nodes, fx: LayerFx, on: boolean, time: number): void {
  rampTo(n.dry.gain, on ? 0.35 : 1, time)
  rampTo(n.wet.gain, on ? 0.7 : 0, time)
  rampTo(n.lfo.osc.frequency, 0.15 + fx.mod2Rate * 4.5, time)
  rampTo(n.lfo2.osc.frequency, 0.11 + fx.mod2Rate * 3.2, time)
  rampTo(n.fb.gain, 0, time)
  rampTo(n.lfo.depth.gain, 0, time)
  rampTo(n.lfo2.depth.gain, 0, time)
  if (!on) return
  const amt = fx.mod2Amount
  if (fx.mod2Type === 'Chorus') {
    rampTo(n.delay.delayTime, 0.01 + amt * 0.012, time)
    rampTo(n.lfo.depth.gain, 0.003 + amt * 0.006, time)
    rampTo(n.delay2.delayTime, 0.016, time)
    rampTo(n.lfo2.depth.gain, amt > 0.55 ? 0.005 : 0, time)
  } else if (fx.mod2Type === 'Flanger') {
    rampTo(n.delay.delayTime, 0.002 + amt * 0.004, time)
    rampTo(n.lfo.depth.gain, 0.0015 + amt * 0.0025, time)
    rampTo(n.fb.gain, 0.25 + amt * 0.45, time)
  } else if (fx.mod2Type === 'Phaser') {
    rampTo(n.ap1.frequency, 400, time)
    rampTo(n.lfo.depth.gain, 300 + amt * 700, time)
    rampTo(n.ap1.Q, 0.5 + amt * 2.5, time)
  } else if (fx.mod2Type === 'Vibe') {
    rampTo(n.ap1.frequency, 280, time)
    rampTo(n.ap2.frequency, 620, time)
    rampTo(n.ap3.frequency, 1100, time)
    rampTo(n.lfo.depth.gain, 220 + amt * 500, time)
  } else if (fx.mod2Type === 'Ensemble') {
    rampTo(n.delay.delayTime, 0.012, time)
    rampTo(n.delay2.delayTime, 0.019, time)
    rampTo(n.delay3.delayTime, 0.027, time)
    rampTo(n.lfo.depth.gain, 0.004 + amt * 0.006, time)
    rampTo(n.lfo2.depth.gain, 0.005 + amt * 0.007, time)
  } else {
    rampTo(n.spinFilter.frequency, 1800 + amt * 2400, time)
    rampTo(n.lfo.osc.frequency, 0.4 + fx.mod2Rate * 2.2, time, 0.2)
    rampTo(n.lfo.depth.gain, 900, time)
  }
}

function applyDelay(n: DelayNodes, fx: LayerFx, on: boolean, time: number): void {
  const mix = on ? fx.delayMix : 0
  rampTo(n.dry.gain, Math.max(0.0001, 1 - mix), time)
  rampTo(n.wet.gain, mix * 1.35, time)
  rampTo(n.delay.delayTime, delayTimeSec(fx.delayTempo), time)
  rampTo(n.fb.gain, fx.delayFeedback * 0.86, time)
  if (fx.delayFilter === 'HP') {
    n.filter.type = 'highpass'
    rampTo(n.filter.frequency, 2400, time)
  } else if (fx.delayFilter === 'BP') {
    n.filter.type = 'bandpass'
    rampTo(n.filter.frequency, 1100, time)
    rampTo(n.filter.Q, 2.2, time)
  } else if (fx.delayFilter === 'LP') {
    n.filter.type = 'lowpass'
    rampTo(n.filter.frequency, 500, time)
  } else {
    n.filter.type = 'lowpass'
    rampTo(n.filter.frequency, 18000, time)
  }
}

function applyAmp(n: AmpNodes, fx: LayerFx, on: boolean, time: number): void {
  rampTo(n.dry.gain, on ? 0 : 1, time)
  rampTo(n.wet.gain, on ? 1 : 0, time)
  const bassDb = (fx.ampBass - 0.5) * 24
  const midDb = (fx.ampMid - 0.5) * 24
  const trebleDb = (fx.ampTreble - 0.5) * 24
  const midHz = 200 + fx.ampMidFreq * 7800
  rampTo(n.mid.frequency, midHz, time)
  n.drive.curve = makeDriveCurve(fx.ampType === 'EQ only' ? 0.02 : fx.ampDrive)
  rampTo(n.lp1.frequency, 18000, time)
  rampTo(n.lp2.frequency, 18000, time)
  n.lp1.type = 'lowpass'
  n.lp2.type = 'lowpass'
  if (fx.ampType === 'Twin') {
    rampTo(n.bass.gain, bassDb + 3, time)
    rampTo(n.mid.gain, midDb - 4, time)
    rampTo(n.treble.gain, trebleDb + 5, time)
  } else if (fx.ampType === 'JC') {
    rampTo(n.bass.gain, bassDb + 1, time)
    rampTo(n.mid.gain, midDb + 2, time)
    rampTo(n.treble.gain, trebleDb + 3, time)
  } else if (fx.ampType === 'Small') {
    rampTo(n.bass.gain, bassDb + 4, time)
    rampTo(n.mid.gain, midDb + 1, time)
    rampTo(n.treble.gain, trebleDb - 6, time)
    rampTo(n.lp1.frequency, 4200, time)
  } else if (fx.ampType === 'LP24 Filter') {
    n.lp1.type = 'lowpass'
    n.lp2.type = 'lowpass'
    rampTo(n.lp1.frequency, 120 + fx.ampMidFreq * 6000, time)
    rampTo(n.lp2.frequency, 120 + fx.ampMidFreq * 6000, time)
    rampTo(n.lp1.Q, 0.4 + fx.ampMid * 8, time)
    rampTo(n.bass.gain, 0, time)
    rampTo(n.mid.gain, 0, time)
    rampTo(n.treble.gain, 0, time)
  } else if (fx.ampType === 'HP24 Filter') {
    n.lp1.type = 'highpass'
    n.lp2.type = 'highpass'
    rampTo(n.lp1.frequency, 80 + fx.ampMidFreq * 4000, time)
    rampTo(n.lp2.frequency, 80 + fx.ampMidFreq * 4000, time)
    rampTo(n.lp1.Q, 0.4 + fx.ampMid * 8, time)
    rampTo(n.bass.gain, 0, time)
    rampTo(n.mid.gain, 0, time)
    rampTo(n.treble.gain, 0, time)
  } else {
    rampTo(n.bass.gain, bassDb, time)
    rampTo(n.mid.gain, midDb, time)
    rampTo(n.treble.gain, trebleDb, time)
  }
}

function applyComp(n: CompNodes, fx: LayerFx, on: boolean, time: number): void {
  rampTo(n.dry.gain, on ? 0.1 : 1, time)
  rampTo(n.wet.gain, on ? 1 : 0, time)
  rampTo(n.comp.threshold, -12 - fx.compAmount * 28, time)
  rampTo(n.comp.ratio, 2 + fx.compAmount * 16, time)
  rampTo(n.comp.attack, fx.compFast ? 0.001 : 0.02, time)
  rampTo(n.comp.release, fx.compFast ? 0.04 : 0.22, time)
}

function applyReverb(n: ReverbNodes, fx: LayerFx, on: boolean, time: number): void {
  const mix = on ? fx.reverbMix : 0
  rampTo(n.dry.gain, 1 - mix, time)
  rampTo(n.wet.gain, mix, time)
  const times: Record<string, [number, number, number, number, number]> = {
    Booth: [0.012, 0.016, 0.019, 0.023, 0.18],
    Room: [0.021, 0.027, 0.033, 0.041, 0.28],
    Spring: [0.018, 0.031, 0.026, 0.044, 0.42],
    Stage: [0.029, 0.037, 0.046, 0.059, 0.48],
    Hall: [0.041, 0.053, 0.067, 0.083, 0.62],
    Cathedral: [0.062, 0.079, 0.097, 0.121, 0.78],
  }
  const t = times[fx.reverbType] ?? times.Stage
  rampTo(n.d1.delayTime, t[0], time)
  rampTo(n.d2.delayTime, t[1], time)
  rampTo(n.d3.delayTime, t[2], time)
  rampTo(n.d4.delayTime, t[3], time)
  rampTo(n.fb1.gain, t[4], time)
  rampTo(n.fb2.gain, t[4] * 0.92, time)
  rampTo(n.fb3.gain, t[4] * 0.84, time)
  rampTo(n.fb4.gain, t[4] * 0.76, time)
  rampTo(n.tone.frequency, fx.reverbBright ? 7500 : 2200, time)
  if (fx.reverbType === 'Spring') {
    n.tone.type = 'bandpass'
    rampTo(n.tone.frequency, 1800, time)
    rampTo(n.tone.Q, 4, time)
  } else {
    n.tone.type = 'lowpass'
    rampTo(n.tone.Q, 0.7, time)
  }
}

export function createMaster(ctx: AudioContextLike): {
  sum: GainNodeLike
  master: GainNodeLike
  limiter: DynamicsCompressorNodeLike
} {
  const sum = ctx.createGain()
  const master = ctx.createGain()
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.setValueAtTime(-8, 0)
  limiter.ratio.setValueAtTime(20, 0)
  limiter.attack.setValueAtTime(0.002, 0)
  limiter.release.setValueAtTime(0.08, 0)
  sum.connect(master)
  master.connect(limiter)
  limiter.connect(ctx.destination)
  master.gain.setValueAtTime(0.72, 0)
  return { sum, master, limiter }
}

export function disconnectNode(node: AudioNodeLike): void {
  try {
    node.disconnect()
  } catch {
    /* already */
  }
}
