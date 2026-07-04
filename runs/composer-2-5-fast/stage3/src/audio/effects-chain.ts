import type { EffectsState, EffectUnitState } from './types'

const RAMP = 0.015

export class LayerEffectChain {
  readonly input: GainNode
  readonly output: GainNode
  readonly layerLevel: GainNode
  private ctx: BaseAudioContext
  private mod1Dry: GainNode
  private mod1Wet: GainNode
  private mod1Lfo: OscillatorNode
  private mod1LfoGain: GainNode
  private mod2Delay: DelayNode
  private mod2Feedback: GainNode
  private mod2Dry: GainNode
  private mod2Wet: GainNode
  private delayNode: DelayNode
  private delayFeedback: GainNode
  private delayFilter: BiquadFilterNode
  private delayDry: GainNode
  private delayWet: GainNode
  private ampDrive: WaveShaperNode
  private ampDry: GainNode
  private ampWet: GainNode
  private eqLow: BiquadFilterNode
  private eqMid: BiquadFilterNode
  private eqHigh: BiquadFilterNode
  private comp: DynamicsCompressorNode
  private compDry: GainNode
  private compWet: GainNode
  private reverbConvolver: ConvolverNode
  private reverbDry: GainNode
  private reverbWet: GainNode
  private bypassGain: GainNode
  private chainGain: GainNode
  private toRotarySend: GainNode
  private mod1Type = 0
  private mod2Type = 0
  private ampType = 0
  private reverbType = 0
  private bypassed = false
  private toRotary = false

  constructor(ctx: BaseAudioContext, destination: AudioNode, rotarySend: GainNode) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.layerLevel = ctx.createGain()
    this.layerLevel.gain.value = 1
    this.bypassGain = ctx.createGain()
    this.chainGain = ctx.createGain()
    this.toRotarySend = ctx.createGain()
    this.toRotarySend.gain.value = 0

    this.mod1Dry = ctx.createGain()
    this.mod1Wet = ctx.createGain()
    this.mod1Lfo = ctx.createOscillator()
    this.mod1LfoGain = ctx.createGain()
    this.mod1Lfo.type = 'sine'
    this.mod1Lfo.frequency.value = 4
    this.mod1LfoGain.gain.value = 0
    this.mod1Lfo.connect(this.mod1LfoGain)
    this.mod1LfoGain.connect(this.mod1Wet.gain)
    this.mod1Lfo.start()

    this.mod2Delay = ctx.createDelay(0.05)
    this.mod2Feedback = ctx.createGain()
    this.mod2Feedback.gain.value = 0.3
    this.mod2Dry = ctx.createGain()
    this.mod2Wet = ctx.createGain()

    this.delayNode = ctx.createDelay(2)
    this.delayFeedback = ctx.createGain()
    this.delayFilter = ctx.createBiquadFilter()
    this.delayDry = ctx.createGain()
    this.delayWet = ctx.createGain()

    this.ampDrive = ctx.createWaveShaper()
    this.ampDrive.curve = makeDriveCurve(20)
    this.ampDry = ctx.createGain()
    this.ampWet = ctx.createGain()
    this.eqLow = ctx.createBiquadFilter()
    this.eqLow.type = 'lowshelf'
    this.eqLow.frequency.value = 100
    this.eqMid = ctx.createBiquadFilter()
    this.eqMid.type = 'peaking'
    this.eqMid.frequency.value = 1000
    this.eqHigh = ctx.createBiquadFilter()
    this.eqHigh.type = 'highshelf'
    this.eqHigh.frequency.value = 4000

    this.comp = ctx.createDynamicsCompressor()
    this.comp.threshold.value = -24
    this.comp.ratio.value = 4
    this.compDry = ctx.createGain()
    this.compWet = ctx.createGain()

    this.reverbConvolver = ctx.createConvolver()
    this.reverbConvolver.buffer = buildImpulse(ctx, 0.8)
    this.reverbDry = ctx.createGain()
    this.reverbWet = ctx.createGain()

    const node: AudioNode = this.input

    node.connect(this.mod1Dry)
    node.connect(this.mod1Wet)
    this.mod1Dry.connect(this.mod2Dry)
    this.mod1Wet.connect(this.mod2Dry)
    this.mod1Wet.connect(this.mod2Wet)

    this.mod2Delay.connect(this.mod2Feedback)
    this.mod2Feedback.connect(this.mod2Delay)
    this.mod2Dry.connect(this.delayDry)
    this.mod2Wet.connect(this.delayDry)
    this.mod2Wet.connect(this.delayWet)

    this.delayNode.connect(this.delayFilter)
    this.delayFilter.connect(this.delayFeedback)
    this.delayFeedback.connect(this.delayNode)
    this.delayDry.connect(this.ampDry)
    this.delayWet.connect(this.ampWet)

    this.ampDry.connect(this.eqLow)
    this.ampWet.connect(this.ampDrive)
    this.ampDrive.connect(this.eqLow)
    this.eqLow.connect(this.eqMid)
    this.eqMid.connect(this.eqHigh)
    this.eqHigh.connect(this.compDry)
    this.eqHigh.connect(this.comp)

    this.comp.connect(this.compWet)
    this.compDry.connect(this.reverbDry)
    this.compWet.connect(this.reverbDry)
    this.compWet.connect(this.reverbWet)
    this.reverbConvolver.connect(this.reverbWet)

    this.reverbDry.connect(this.chainGain)
    this.reverbWet.connect(this.chainGain)

    this.input.connect(this.bypassGain)
    this.chainGain.connect(this.output)
    this.bypassGain.connect(this.output)

    this.output.connect(this.toRotarySend)
    this.output.connect(this.layerLevel)
    this.layerLevel.connect(destination)
    this.toRotarySend.connect(rotarySend)

    this.setDefaults()
  }

  private setDefaults(): void {
    this.mod1Dry.gain.value = 1
    this.mod1Wet.gain.value = 0
    this.mod2Dry.gain.value = 1
    this.mod2Wet.gain.value = 0
    this.delayDry.gain.value = 1
    this.delayWet.gain.value = 0
    this.ampDry.gain.value = 1
    this.ampWet.gain.value = 0
    this.compDry.gain.value = 1
    this.compWet.gain.value = 0
    this.reverbDry.gain.value = 1
    this.reverbWet.gain.value = 0
    this.bypassGain.gain.value = 0
    this.chainGain.gain.value = 1
  }

  applyState(fx: EffectsState, allBypass: boolean): void {
    const t = this.ctx.currentTime
    const bypass = allBypass || fx.allBypass
    this.bypassed = bypass
    this.bypassGain.gain.setTargetAtTime(bypass ? 1 : 0, t, RAMP)
    this.chainGain.gain.setTargetAtTime(bypass ? 0 : 1, t, RAMP)

    this.applyMod1(fx.mod1, t)
    this.applyMod2(fx.mod2, t)
    this.applyDelay(fx.delay, t)
    this.applyAmp(fx.amp, t)
    this.applyComp(fx.comp, t)
    this.applyReverb(fx.reverb, t)

    this.toRotary = fx.amp.toRotary ?? false
    this.toRotarySend.gain.setTargetAtTime(this.toRotary ? 1 : 0, t, RAMP)
    if (this.toRotary) {
      this.layerLevel.gain.setTargetAtTime(0, t, RAMP)
    }
  }

  setLayerLevel(level: number): void {
    if (this.toRotary) return
    const t = this.ctx.currentTime
    this.layerLevel.gain.setTargetAtTime(level / 127, t, RAMP)
  }

  private applyMod1(s: EffectUnitState, t: number): void {
    this.mod1Type = s.type
    const on = !s.bypass && s.amount > 0
    const wet = on ? (s.amount / 127) * 0.6 : 0
    this.mod1Dry.gain.setTargetAtTime(1 - wet, t, RAMP)
    this.mod1Wet.gain.setTargetAtTime(wet, t, RAMP)
    const rate = 0.5 + (s.rate / 127) * 8
    this.mod1Lfo.frequency.setTargetAtTime(rate, t, RAMP)
    this.mod1LfoGain.gain.setTargetAtTime(wet * 0.8, t, RAMP)
    if (s.type === 2) {
      this.mod1LfoGain.gain.setTargetAtTime(wet * 2, t, RAMP)
    }
  }

  private applyMod2(s: EffectUnitState, t: number): void {
    this.mod2Type = s.type
    const on = !s.bypass && s.amount > 0
    const wet = on ? (s.amount / 127) * 0.5 : 0
    this.mod2Dry.gain.setTargetAtTime(1 - wet, t, RAMP)
    this.mod2Wet.gain.setTargetAtTime(wet, t, RAMP)
    const delayTime = 0.003 + (s.rate / 127) * 0.015
    this.mod2Delay.delayTime.setTargetAtTime(delayTime, t, RAMP)
    this.mod2Feedback.gain.setTargetAtTime(0.2 + wet, t, RAMP)
  }

  private applyDelay(s: EffectUnitState, t: number): void {
    const on = !s.bypass && s.mix > 0
    const wet = on ? (s.mix / 127) * 0.7 : 0
    this.delayDry.gain.setTargetAtTime(1 - wet, t, RAMP)
    this.delayWet.gain.setTargetAtTime(wet, t, RAMP)
    const time = 0.05 + (s.rate / 127) * 0.45
    this.delayNode.delayTime.setTargetAtTime(time, t, RAMP)
    this.delayFeedback.gain.setTargetAtTime((s.feedback / 127) * 0.75, t, RAMP)
    const filterModes: BiquadFilterType[] = ['allpass', 'lowpass', 'highpass', 'bandpass']
    this.delayFilter.type = filterModes[s.type % 4] ?? 'lowpass'
    this.delayFilter.frequency.setTargetAtTime(800 + (s.amount / 127) * 4000, t, RAMP)
  }

  private applyAmp(s: EffectUnitState, t: number): void {
    this.ampType = s.type
    const on = !s.bypass
    const drive = s.amount / 127
    const wet = on && drive > 0.05 ? drive * 0.6 : 0
    this.ampDry.gain.setTargetAtTime(1 - wet * 0.5, t, RAMP)
    this.ampWet.gain.setTargetAtTime(wet * (1 + s.type * 0.15), t, RAMP)
    this.eqLow.gain.setTargetAtTime((s.rate / 127 - 0.5) * 12, t, RAMP)
    this.eqMid.gain.setTargetAtTime((s.amount / 127 - 0.5) * 10, t, RAMP)
    this.eqHigh.gain.setTargetAtTime((s.mix / 127 - 0.5) * 12, t, RAMP)
  }

  private applyComp(s: EffectUnitState, t: number): void {
    const on = !s.bypass && s.amount > 0
    const wet = on ? s.amount / 127 : 0
    this.compDry.gain.setTargetAtTime(1 - wet * 0.5, t, RAMP)
    this.compWet.gain.setTargetAtTime(wet, t, RAMP)
    this.comp.threshold.setTargetAtTime(-10 - wet * 30, t, RAMP)
    this.comp.ratio.setTargetAtTime(2 + wet * 8, t, RAMP)
    this.comp.attack.value = s.fastMode ? 0.003 : 0.015
  }

  private applyReverb(s: EffectUnitState, t: number): void {
    this.reverbType = s.type
    const on = !s.bypass && s.mix > 0
    const wet = on ? s.mix / 127 : 0
    this.reverbDry.gain.setTargetAtTime(1 - wet, t, RAMP)
    this.reverbWet.gain.setTargetAtTime(wet, t, RAMP)
    const decays = [0.4, 0.15, 0.6, 1.0, 1.8, 3.0]
    const decay = decays[s.type % decays.length] ?? 1
    if (this.reverbConvolver.buffer?.duration !== decay) {
      this.reverbConvolver.buffer = buildImpulse(this.ctx, decay, s.type)
    }
  }

  getMod1Type(): number { return this.mod1Type }
  getMod2Type(): number { return this.mod2Type }
  getAmpType(): number { return this.ampType }
  getReverbType(): number { return this.reverbType }
  isBypassed(): boolean { return this.bypassed }
  isToRotary(): boolean { return this.toRotary }

  dispose(): void {
    try { this.mod1Lfo.stop() } catch { /* already stopped */ }
    this.input.disconnect()
    this.output.disconnect()
  }
}

export class SharedRotary {
  readonly input: GainNode
  readonly output: GainNode
  private ctx: BaseAudioContext
  private lfo: OscillatorNode
  private lfoGain: GainNode
  private dry: GainNode
  private wet: GainNode
  private on = false

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.dry = ctx.createGain()
    this.wet = ctx.createGain()
    this.lfo = ctx.createOscillator()
    this.lfoGain = ctx.createGain()
    this.lfo.type = 'sine'
    this.lfo.frequency.value = 0.8
    this.lfoGain.gain.value = 0.3
    this.lfo.connect(this.lfoGain)
    this.lfoGain.connect(this.wet.gain)
    this.lfo.start()

    this.input.connect(this.dry)
    this.input.connect(this.wet)
    this.dry.connect(this.output)
    this.wet.connect(this.output)
    this.output.connect(destination)
    this.dry.gain.value = 1
    this.wet.gain.value = 0
  }

  apply(on: boolean, speed: 'slow' | 'fast', drive: number): void {
    this.on = on
    const t = this.ctx.currentTime
    const wet = on ? 0.4 + (drive / 127) * 0.4 : 0
    this.dry.gain.setTargetAtTime(1 - wet * 0.5, t, 0.015)
    this.wet.gain.setTargetAtTime(wet, t, 0.015)
    this.lfo.frequency.setTargetAtTime(speed === 'fast' ? 6 : 0.8, t, 0.05)
  }

  isOn(): boolean { return this.on }
  dispose(): void {
    try { this.lfo.stop() } catch { /* noop */ }
    this.input.disconnect()
    this.output.disconnect()
  }
}

function makeDriveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 44100
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x))
  }
  return curve
}

function buildImpulse(ctx: BaseAudioContext, decay: number, type = 0): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.floor(rate * decay)
  const impulse = ctx.createBuffer(2, length, rate)
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c)
    for (let i = 0; i < length; i++) {
      const t = i / rate
      const spring = type === 2 ? Math.sin(t * 80) * Math.exp(-t * 8) * 0.3 : 0
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t / decay) * 0.5 + spring
    }
  }
  return impulse
}
