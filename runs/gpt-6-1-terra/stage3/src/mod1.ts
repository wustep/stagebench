/** First modulation stage: a filter, panner and amplitude modulator in a parallel wet path. */
export class Mod1 {
  readonly input: GainNode
  readonly output: GainNode
  private dry: GainNode
  private wet: GainNode
  private filter: BiquadFilterNode
  private pan: StereoPannerNode
  private amp: GainNode
  private lfo: OscillatorNode
  private panDepth: GainNode
  private filterDepth: GainNode
  private ampDepth: GainNode
  private detector: WaveShaperNode
  private detectorSmooth: BiquadFilterNode
  private detectorDepth: GainNode
  private nodes: AudioNode[]
  private type = 0
  private on = false
  private rate = .5
  private amount = .5
  constructor(private context: AudioContext) {
    this.input = context.createGain(); this.output = context.createGain(); this.dry = context.createGain(); this.wet = context.createGain(); this.wet.gain.value = 0
    this.filter = context.createBiquadFilter(); this.filter.type = 'lowpass'; this.pan = context.createStereoPanner(); this.amp = context.createGain()
    this.lfo = context.createOscillator(); this.panDepth = context.createGain(); this.filterDepth = context.createGain(); this.ampDepth = context.createGain()
    this.detector = context.createWaveShaper(); this.detector.curve = Float32Array.from({length: 1025}, (_, i) => Math.abs(i / 512 - 1))
    this.detectorSmooth = context.createBiquadFilter(); this.detectorSmooth.type = 'lowpass'; this.detectorSmooth.frequency.value = 15
    this.detectorDepth = context.createGain()
    this.input.connect(this.dry); this.dry.connect(this.output)
    this.input.connect(this.filter); this.filter.connect(this.pan); this.pan.connect(this.amp); this.amp.connect(this.wet); this.wet.connect(this.output)
    this.lfo.connect(this.panDepth); this.panDepth.connect(this.pan.pan); this.lfo.connect(this.filterDepth); this.filterDepth.connect(this.filter.frequency); this.lfo.connect(this.ampDepth); this.ampDepth.connect(this.amp.gain)
    this.input.connect(this.detector); this.detector.connect(this.detectorSmooth); this.detectorSmooth.connect(this.detectorDepth); this.detectorDepth.connect(this.filter.frequency)
    this.lfo.start(); this.nodes = [this.input,this.output,this.dry,this.wet,this.filter,this.pan,this.amp,this.lfo,this.panDepth,this.filterDepth,this.ampDepth,this.detector,this.detectorSmooth,this.detectorDepth]
    this.update()
  }
  private ramp(p: AudioParam, v: number) { p.setTargetAtTime(v, this.context.currentTime, .015) }
  setOn(on: boolean) { this.on = on; this.update() }
  setType(type: number) { this.type = type % 6; this.update() }
  setClockRate(hz: number) { this.ramp(this.lfo.frequency, hz) }
  setRate(rate: number) { this.rate = rate; this.update() }
  setAmount(amount: number) { this.amount = amount; this.update() }
  private update() {
    const {type, amount, rate} = this
    this.ramp(this.dry.gain, this.on ? 0 : 1); this.ramp(this.wet.gain, this.on ? 1 : 0)
    this.ramp(this.lfo.frequency, type === 2 ? 25 + rate * 1200 : .15 + rate * 9)
    this.ramp(this.panDepth.gain, type === 0 ? amount : 0)
    this.ramp(this.filter.frequency, type === 3 ? 400 : type === 4 ? 1500 : 20000)
    this.ramp(this.filter.Q, type === 3 || type === 4 ? 6 : .7)
    this.ramp(this.filterDepth.gain, type === 4 ? amount * 1200 : 0)
    this.ramp(this.detectorDepth.gain, type === 3 ? amount * (3000 + rate * 8000) : 0)
    this.ramp(this.amp.gain, type === 2 ? 1 - amount : type === 1 || type === 5 ? 1 - amount * .5 : 1)
    this.ramp(this.ampDepth.gain, type === 2 ? amount : type === 1 ? amount * .5 : type === 5 ? -amount * .5 : 0)
  }
  close() { this.lfo.stop(); this.nodes.forEach(node => node.disconnect()) }
}
