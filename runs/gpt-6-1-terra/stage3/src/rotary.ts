/** One shared pair of rotor motors drives separate horn and bass paths for both layers. */
export class Rotary {
  readonly inputs: GainNode[]
  readonly outputs: GainNode[]
  private dry: GainNode[] = []
  private wet: GainNode[] = []
  private drives: WaveShaperNode[][] = []
  private driveGains: GainNode[][] = []
  private driveIndex = 0
  private hornMotor: OscillatorNode
  private bassMotor: OscillatorNode
  private nodes: AudioNode[] = []
  constructor(private context: AudioContext, channels = 2) {
    this.hornMotor = context.createOscillator(); this.hornMotor.frequency.value = .8; this.hornMotor.start()
    this.bassMotor = context.createOscillator(); this.bassMotor.frequency.value = .65; this.bassMotor.start()
    this.nodes.push(this.hornMotor, this.bassMotor)
    this.inputs = Array.from({length: channels}, () => context.createGain()); this.outputs = Array.from({length: channels}, () => context.createGain())
    for (let i = 0; i < channels; i++) {
      const dry = context.createGain(), wet = context.createGain(), drive = [context.createWaveShaper(), context.createWaveShaper()], driveGain = [context.createGain(), context.createGain()], driveOut = context.createGain(); driveGain[1].gain.value = 0
      const horn = context.createBiquadFilter(), bass = context.createBiquadFilter(), pan = context.createStereoPanner()
      const hornAmp = context.createGain(), bassAmp = context.createGain(), panDepth = context.createGain(), hornDepth = context.createGain(), bassDepth = context.createGain()
      wet.gain.value = 0; horn.type = 'highpass'; bass.type = 'lowpass'; horn.frequency.value = bass.frequency.value = 800
      hornAmp.gain.value = .8; bassAmp.gain.value = .85; panDepth.gain.value = .75; hornDepth.gain.value = .2; bassDepth.gain.value = .15
      this.inputs[i].connect(dry); dry.connect(this.outputs[i]); drive.forEach((node, j) => { this.inputs[i].connect(node); node.connect(driveGain[j]); driveGain[j].connect(driveOut) })
      driveOut.connect(horn); horn.connect(pan); pan.connect(hornAmp); hornAmp.connect(wet)
      driveOut.connect(bass); bass.connect(bassAmp); bassAmp.connect(wet); wet.connect(this.outputs[i])
      this.hornMotor.connect(panDepth); panDepth.connect(pan.pan); this.hornMotor.connect(hornDepth); hornDepth.connect(hornAmp.gain)
      this.bassMotor.connect(bassDepth); bassDepth.connect(bassAmp.gain)
      this.dry.push(dry); this.wet.push(wet); this.drives.push(drive); this.driveGains.push(driveGain)
      this.nodes.push(this.inputs[i], this.outputs[i], dry, wet, ...drive, ...driveGain, driveOut, horn, bass, pan, hornAmp, bassAmp, panDepth, hornDepth, bassDepth)
    }
    this.setDrive(0)
  }
  setOn(layer: number, on: boolean) { const now = this.context.currentTime; this.dry[layer].gain.setTargetAtTime(on ? 0 : 1, now, .02); this.wet[layer].gain.setTargetAtTime(on ? 1 : 0, now, .02) }
  setFast(fast: boolean) { this.setSpeed(fast ? 1 : 0) }
  setSpeed(value: number) { const now = this.context.currentTime; const amount = Math.max(-1, Math.min(1, value)); this.hornMotor.frequency.setTargetAtTime(amount < 0 ? .001 : .8 + 5.2 * amount, now, 1.2); this.bassMotor.frequency.setTargetAtTime(amount < 0 ? .001 : .65 + 4.35 * amount, now, 1.8) }
  setDrive(value: number) { const amount = value * 5, curve = Float32Array.from({length: 1025}, (_, i) => { const x = i / 512 - 1; return amount ? Math.tanh(x * (1 + amount)) / Math.tanh(1 + amount) : x }); const next = 1 - this.driveIndex; this.drives.forEach((drive, i) => { drive[next].curve = curve; this.driveGains[i][this.driveIndex].gain.setTargetAtTime(0, this.context.currentTime, .015); this.driveGains[i][next].gain.setTargetAtTime(1, this.context.currentTime, .015) }); this.driveIndex = next }
  close() { this.hornMotor.stop(); this.bassMotor.stop(); this.nodes.forEach(node => node.disconnect()) }
}
