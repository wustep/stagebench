/** Per-layer delay. The feedback filter sits inside the repeat loop. */
export class DelayUnit {
  readonly input: GainNode
  readonly output: GainNode
  private dry: GainNode
  private wet: GainNode
  private delay: DelayNode
  private feedback: GainNode
  private filter: BiquadFilterNode
  private on = false
  private amount = .5
  constructor(private context: AudioContext) {
    this.input = context.createGain(); this.output = context.createGain()
    this.dry = context.createGain(); this.wet = context.createGain()
    this.delay = context.createDelay(4); this.feedback = context.createGain(); this.filter = context.createBiquadFilter()
    this.delay.delayTime.value = .35; this.feedback.gain.value = .35
    this.filter.type = 'lowpass'; this.filter.frequency.value = 20000
    this.dry.gain.value = 1; this.wet.gain.value = 0
    this.input.connect(this.dry); this.dry.connect(this.output)
    this.input.connect(this.delay); this.delay.connect(this.wet); this.wet.connect(this.output)
    this.delay.connect(this.filter); this.filter.connect(this.feedback); this.feedback.connect(this.delay)
  }
  private ramp(param: AudioParam, value: number) { param.setTargetAtTime(value, this.context.currentTime, .015) }
  setOn(on: boolean) { this.on = on; this.mix() }
  setAmount(amount: number) { this.amount = Math.max(0, Math.min(1, amount)); this.mix() }
  private mix() { this.ramp(this.dry.gain, this.on ? 1 - this.amount : 1); this.ramp(this.wet.gain, this.on ? this.amount : 0) }
  setSeconds(seconds: number) { this.ramp(this.delay.delayTime, Math.max(.08, Math.min(4, seconds))) }
  setTempo(value: number) { this.ramp(this.delay.delayTime, .08 + Math.max(0, Math.min(1, value)) * .92) }
  setFeedback(value: number) { this.ramp(this.feedback.gain, Math.max(0, Math.min(.9, value * .9))) }
  setFilter(type: 'off' | 'lowpass' | 'highpass' | 'bandpass') {
    this.filter.type = type === 'off' ? 'lowpass' : type
    this.ramp(this.filter.frequency, type === 'off' ? 20000 : type === 'lowpass' ? 1600 : type === 'highpass' ? 650 : 1100)
  }
  close() { for (const node of [this.input, this.output, this.dry, this.wet, this.delay, this.feedback, this.filter]) node.disconnect() }
}
