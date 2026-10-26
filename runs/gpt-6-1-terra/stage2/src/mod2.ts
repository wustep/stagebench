/** Modulated delay/all-pass stage for chorus, flanger, phase and spin colours. */
export class Mod2 {
  readonly input: GainNode
  readonly output: GainNode
  private dry: GainNode
  private wet: GainNode
  private delay: DelayNode
  private delay2: DelayNode
  private delay3: DelayNode
  private ensemble2: GainNode
  private ensemble3: GainNode
  private cross2: GainNode
  private cross3: GainNode
  private depth2: GainNode
  private depth3: GainNode
  private phase: BiquadFilterNode
  private pan: StereoPannerNode
  private feedback: GainNode
  private lfo: OscillatorNode
  private delayDepth: GainNode
  private phaseDepth: GainNode
  private panDepth: GainNode
  private nodes: AudioNode[]
  private type = 0
  private on = false
  private rate = .5
  private amount = .5
  constructor(private context: AudioContext) {
    this.input=context.createGain(); this.output=context.createGain(); this.dry=context.createGain(); this.wet=context.createGain(); this.wet.gain.value=0
    this.delay=context.createDelay(.1); this.delay2=context.createDelay(.1); this.delay3=context.createDelay(.1); this.ensemble2=context.createGain(); this.ensemble3=context.createGain(); this.cross2=context.createGain(); this.cross3=context.createGain(); this.depth2=context.createGain(); this.depth3=context.createGain(); this.ensemble2.gain.value=0; this.ensemble3.gain.value=0; this.cross2.gain.value=0; this.cross3.gain.value=0; this.phase=context.createBiquadFilter(); this.phase.type='allpass'; this.pan=context.createStereoPanner(); this.feedback=context.createGain()
    this.lfo=context.createOscillator(); this.delayDepth=context.createGain(); this.phaseDepth=context.createGain(); this.panDepth=context.createGain()
    this.input.connect(this.dry); this.dry.connect(this.output); this.input.connect(this.delay); this.delay.connect(this.phase); this.phase.connect(this.pan); this.pan.connect(this.wet); this.wet.connect(this.output)
    this.delay.connect(this.feedback); this.feedback.connect(this.delay)
    this.input.connect(this.delay2); this.input.connect(this.delay3); this.delay2.connect(this.ensemble2); this.delay3.connect(this.ensemble3); this.ensemble2.connect(this.phase); this.ensemble3.connect(this.phase); this.delay2.connect(this.cross2); this.cross2.connect(this.delay3); this.delay3.connect(this.cross3); this.cross3.connect(this.delay2)
    this.lfo.connect(this.delayDepth); this.delayDepth.connect(this.delay.delayTime); this.lfo.connect(this.phaseDepth); this.phaseDepth.connect(this.phase.frequency); this.lfo.connect(this.panDepth); this.panDepth.connect(this.pan.pan)
    this.lfo.connect(this.depth2); this.depth2.connect(this.delay2.delayTime); this.lfo.connect(this.depth3); this.depth3.connect(this.delay3.delayTime)
    this.lfo.start(); this.nodes=[this.input,this.output,this.dry,this.wet,this.delay,this.delay2,this.delay3,this.ensemble2,this.ensemble3,this.cross2,this.cross3,this.depth2,this.depth3,this.phase,this.pan,this.feedback,this.lfo,this.delayDepth,this.phaseDepth,this.panDepth]; this.update()
  }
  private ramp(p: AudioParam,v: number) { p.setTargetAtTime(v,this.context.currentTime,.02) }
  setOn(v:boolean) { this.on=v; this.update() }
  setType(v:number) { this.type=v%6; this.update() }
  setRate(v:number) { this.rate=v; this.update() }
  setAmount(v:number) { this.amount=v; this.update() }
  private update() {
    const {type, amount, rate}=this
    this.ramp(this.dry.gain,this.on ? 1-amount*.5 : 1); this.ramp(this.wet.gain,this.on ? amount*.7 : 0)
    this.lfo.frequency.setTargetAtTime(.1 + rate * (type === 5 ? 5 : 7), this.context.currentTime, type === 5 ? 1 : .02)
    this.ramp(this.delay.delayTime,[.023,.004,.001,.006,.032,.012][type])
    this.ramp(this.delayDepth.gain,amount*[.006,.003,.0002,.003,.012,.004][type])
    this.ramp(this.delay2.delayTime,.021); this.ramp(this.delay3.delayTime,.043); this.ramp(this.depth2.gain, type===4?amount*.007:type===0?amount*.004:0); this.ramp(this.depth3.gain, type===4?-amount*.009:0); this.ramp(this.ensemble2.gain,type===4?.35:type===0?Math.max(0,(amount-.6)*.75):0); this.ramp(this.ensemble3.gain,type===4?.35:0); this.ramp(this.cross2.gain,type===4?amount*.12:0); this.ramp(this.cross3.gain,type===4?amount*.12:0)
    this.ramp(this.feedback.gain,type===1?amount*.7:type===2?amount*.25:type===3?amount*.3:0)
    this.ramp(this.phase.frequency,type===2?1200:type===3?750:18000)
    this.ramp(this.phase.Q,type===2||type===3?4:.7)
    this.ramp(this.phaseDepth.gain,(type===2?1000:type===3?600:0)*amount)
    this.ramp(this.panDepth.gain,(type===4?.7:type===5?.9:type===0?.4:0)*amount)
  }
  close() { this.lfo.stop(); this.nodes.forEach(node=>node.disconnect()) }
}
