/** Per-layer tone, compressor and reverb stages; bypasses ramp between dry and wet. */
export class ToneEffects {
  readonly input: GainNode
  readonly output: GainNode
  private nodes: AudioNode[] = []
  private bypass: {dry: GainNode; wet: GainNode}[] = []
  private bass: BiquadFilterNode
  private mid: BiquadFilterNode
  private treble: BiquadFilterNode
  private drives: WaveShaperNode[]
  private driveGains: GainNode[]
  private driveIndex = 0
  private filter1: BiquadFilterNode
  private filter2: BiquadFilterNode
  private ampType = 0
  private driveAmount = .5
  private compressor: DynamicsCompressorNode
  private convolvers: ConvolverNode[]
  private convolverGains: GainNode[]
  private reverbInput: GainNode
  private reverbIndex = 0
  private reverbColor: BiquadFilterNode
  private fast = false
  private midFrequency = 1000
  private reverbMix = .5
  private reverbOn = false
  constructor(private context: AudioContext) {
    this.input = context.createGain(); this.output = context.createGain()
    this.bass = context.createBiquadFilter(); this.bass.type = 'lowshelf'; this.bass.frequency.value = 100
    this.mid = context.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1000
    this.treble = context.createBiquadFilter(); this.treble.type = 'highshelf'; this.treble.frequency.value = 4000
    this.drives = [context.createWaveShaper(), context.createWaveShaper()]; this.driveGains = [context.createGain(), context.createGain()]; this.driveGains[1].gain.value = 0
    this.filter1 = context.createBiquadFilter(); this.filter2 = context.createBiquadFilter()
    this.compressor = context.createDynamicsCompressor()
    this.reverbInput = context.createGain(); this.convolvers = [context.createConvolver(), context.createConvolver()]; this.convolverGains = [context.createGain(), context.createGain()]; this.convolverGains[1].gain.value = 0
    this.reverbColor = context.createBiquadFilter(); this.reverbColor.type = 'lowpass'; this.reverbColor.frequency.value = 12000
    this.convolvers.forEach((node, i) => { this.reverbInput.connect(node); node.connect(this.convolverGains[i]); this.convolverGains[i].connect(this.reverbColor) }); this.setReverbType(0)
    this.bass.connect(this.mid); this.mid.connect(this.treble); this.drives.forEach((node, i) => { this.treble.connect(node); node.connect(this.driveGains[i]); this.driveGains[i].connect(this.filter1) }); this.filter1.connect(this.filter2); this.updateAmp()
    const eqOut = this.stage(this.input, this.bass, this.filter2)
    const compOut = this.stage(eqOut, this.compressor, this.compressor)
    const reverbOut = this.stage(compOut, this.reverbInput, this.reverbColor)
    reverbOut.connect(this.output)
    this.nodes.push(this.input, this.output, this.bass, this.mid, this.treble, ...this.drives, ...this.driveGains, this.filter1, this.filter2, this.compressor, this.reverbInput, ...this.convolvers, ...this.convolverGains, this.reverbColor)
  }
  private stage(source: AudioNode, first: AudioNode, last: AudioNode) {
    const dry = this.context.createGain(), wet = this.context.createGain(), out = this.context.createGain()
    wet.gain.value = 0; dry.gain.value = 1
    source.connect(dry); dry.connect(out); source.connect(first); last.connect(wet); wet.connect(out)
    this.bypass.push({dry, wet}); this.nodes.push(dry, wet, out)
    return out
  }
  private ramp(param: AudioParam, value: number) { param.setTargetAtTime(value, this.context.currentTime, .015) }
  setOn(unit: number, on: boolean) {
    if (unit === 2) { this.reverbOn = on; this.setReverbMix(this.reverbMix); return }
    const stage = this.bypass[unit]; this.ramp(stage.dry.gain, on ? 0 : 1); this.ramp(stage.wet.gain, on ? 1 : 0)
  }
  setAmpType(type: number) { this.ampType = type; this.updateAmp() }
  setDrive(value: number) { this.driveAmount = value; this.updateAmp() }
  private updateAmp() {
    const type = this.ampType, amount = this.driveAmount
    const curve = new Float32Array(1025), strength = type >= 1 && type <= 3 ? [1, 2, 4, 8][type] * amount : 0
    for (let i = 0; i < curve.length; i++) { const x = i / 512 - 1; curve[i] = strength ? Math.tanh(x * (1 + strength)) / Math.tanh(1 + strength) : x }
    const next = 1 - this.driveIndex; this.drives[next].curve = curve
    this.ramp(this.driveGains[this.driveIndex].gain, 0); this.ramp(this.driveGains[next].gain, 1); this.driveIndex = next
    for (const filter of [this.filter1, this.filter2]) { filter.type = type === 5 ? 'highpass' : 'lowpass'; this.ramp(filter.frequency, type === 4 || type === 5 ? this.midFrequency : type === 1 ? 6500 : type === 2 ? 9000 : type === 3 ? 3500 : 20000); this.ramp(filter.Q, type === 4 || type === 5 ? 2 : .7) }
  }
  setEq(band: 'bass' | 'mid' | 'treble', value: number) { if (band === 'mid' && (this.ampType === 4 || this.ampType === 5)) { this.ramp(this.filter1.Q, .5 + value * 9); this.ramp(this.filter2.Q, .5 + value * 9) } else this.ramp(this[band].gain, (value - .5) * 30) }
  setFrequency(value: number) { this.midFrequency = 200 * 40 ** value; this.ramp(this.mid.frequency, this.midFrequency); if (this.ampType === 4 || this.ampType === 5) { this.ramp(this.filter1.frequency, this.midFrequency); this.ramp(this.filter2.frequency, this.midFrequency) } }
  setFast(on: boolean) { this.fast = on; this.ramp(this.compressor.release, on ? .05 : .18) }
  setBrightness(bright: boolean) { this.ramp(this.reverbColor.frequency, bright ? 12000 : 2500) }
  setCompression(value: number) { this.ramp(this.compressor.threshold, -5 - 40 * value); this.ramp(this.compressor.ratio, 1 + 11 * value); this.ramp(this.compressor.attack, .015); this.ramp(this.compressor.release, this.fast ? .05 : .18) }
  setReverbMix(value: number) { this.reverbMix = value; const stage = this.bypass[2]; if (!stage) return; this.ramp(stage.dry.gain, this.reverbOn ? 1 - value : 1); this.ramp(stage.wet.gain, this.reverbOn ? value : 0) }
  setReverbType(type: number) {
    const seconds = [0.8, .25, 1.4, 1.8, 3, 5][type] ?? .8
    const frames = Math.floor(this.context.sampleRate * seconds), buffer = this.context.createBuffer(2, frames, this.context.sampleRate)
    for (let channel = 0; channel < 2; channel++) { const data = buffer.getChannelData(channel); let seed = 12345 + channel * 7919 + type * 1009
      for (let i = 0; i < frames; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; const decay = Math.exp(-6 * i / frames); data[i] = ((seed / 2147483648) - 1) * decay * .12; if (type === 2 && i % 1100 === 0) data[i] += .3 * decay }
    }
    const next = 1 - this.reverbIndex; this.convolvers[next].buffer = buffer
    this.ramp(this.convolverGains[this.reverbIndex].gain, 0); this.ramp(this.convolverGains[next].gain, 1); this.reverbIndex = next
  }
  close() { this.nodes.forEach(node => node.disconnect()) }
}
