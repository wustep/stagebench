export class MockAudioParam {
  public value: number;
  public scheduledValues: Array<{ type: string; value: number; time: number; timeConstant?: number }> = [];

  constructor(defaultValue: number = 0) {
    this.value = defaultValue;
  }

  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.scheduledValues.push({ type: 'setValueAtTime', value, time });
  }

  exponentialRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.scheduledValues.push({ type: 'exponentialRampToValueAtTime', value, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.scheduledValues.push({ type: 'linearRampToValueAtTime', value, time });
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): void {
    this.value = target;
    this.scheduledValues.push({ type: 'setTargetAtTime', value: target, time: startTime, timeConstant });
  }

  cancelScheduledValues(time: number): void {
    this.scheduledValues = this.scheduledValues.filter((s) => s.time < time);
  }
}

export class MockAudioNode {
  public context: MockAudioContext;
  public connectedTo: (MockAudioNode | MockAudioParam)[] = [];
  public isDisconnected = false;

  constructor(context: MockAudioContext) {
    this.context = context;
    context.allCreatedNodes.push(this);
  }

  connect(destination: MockAudioNode | MockAudioParam): void {
    this.connectedTo.push(destination);
    this.isDisconnected = false;
  }

  disconnect(destination?: MockAudioNode | MockAudioParam): void {
    if (destination) {
      this.connectedTo = this.connectedTo.filter((d) => d !== destination);
    } else {
      this.connectedTo = [];
      this.isDisconnected = true;
    }
  }
}

export class MockGainNode extends MockAudioNode {
  public gain: MockAudioParam;

  constructor(context: MockAudioContext) {
    super(context);
    this.gain = new MockAudioParam(1.0);
  }
}

export class MockOscillatorNode extends MockAudioNode {
  public frequency: MockAudioParam;
  public detune: MockAudioParam;
  public type: OscillatorType = 'sine';
  public isStarted = false;
  public isStopped = false;

  constructor(context: MockAudioContext) {
    super(context);
    this.frequency = new MockAudioParam(440);
    this.detune = new MockAudioParam(0);
  }

  start(_time?: number): void {
    this.isStarted = true;
  }

  stop(_time?: number): void {
    this.isStopped = true;
  }
}

export class MockBiquadFilterNode extends MockAudioNode {
  public frequency: MockAudioParam;
  public Q: MockAudioParam;
  public gain: MockAudioParam;
  public type: BiquadFilterType = 'lowpass';

  constructor(context: MockAudioContext) {
    super(context);
    this.frequency = new MockAudioParam(350);
    this.Q = new MockAudioParam(1);
    this.gain = new MockAudioParam(0);
  }
}

export class MockDelayNode extends MockAudioNode {
  public delayTime: MockAudioParam;

  constructor(context: MockAudioContext, _maxDelayTime: number = 1.0) {
    super(context);
    this.delayTime = new MockAudioParam(0);
    this.delayTime.value = 0;
  }
}

export class MockStereoPannerNode extends MockAudioNode {
  public pan: MockAudioParam;

  constructor(context: MockAudioContext) {
    super(context);
    this.pan = new MockAudioParam(0);
  }
}

export class MockDynamicsCompressorNode extends MockAudioNode {
  public threshold: MockAudioParam;
  public knee: MockAudioParam;
  public ratio: MockAudioParam;
  public attack: MockAudioParam;
  public release: MockAudioParam;

  constructor(context: MockAudioContext) {
    super(context);
    this.threshold = new MockAudioParam(-24);
    this.knee = new MockAudioParam(30);
    this.ratio = new MockAudioParam(12);
    this.attack = new MockAudioParam(0.003);
    this.release = new MockAudioParam(0.25);
  }
}

export class MockConvolverNode extends MockAudioNode {
  public buffer: AudioBuffer | null = null;
  public normalize: boolean = true;

  constructor(context: MockAudioContext) {
    super(context);
  }
}

export class MockWaveShaperNode extends MockAudioNode {
  public curve: Float32Array | null = null;
  public oversample: OverSampleType = 'none';

  constructor(context: MockAudioContext) {
    super(context);
  }
}

export class MockBufferSourceNode extends MockAudioNode {
  public buffer: AudioBuffer | null = null;
  public playbackRate: MockAudioParam;
  public detune: MockAudioParam;
  public loop: boolean = false;
  public isStarted = false;
  public isStopped = false;

  constructor(context: MockAudioContext) {
    super(context);
    this.playbackRate = new MockAudioParam(1.0);
    this.detune = new MockAudioParam(0);
  }

  start(_time?: number): void {
    this.isStarted = true;
  }

  stop(_time?: number): void {
    this.isStopped = true;
  }
}

export class MockAudioBuffer {
  public numberOfChannels: number;
  public length: number;
  public sampleRate: number;
  public duration: number;
  private channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = [];
    for (let i = 0; i < numberOfChannels; i++) {
      this.channels.push(new Float32Array(length));
    }
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel] || this.channels[0];
  }
}

export class MockAudioContext {
  public currentTime: number = 0;
  public sampleRate: number = 44100;
  public state: AudioContextState = 'running';
  public destination: MockAudioNode;
  public allCreatedNodes: MockAudioNode[] = [];

  constructor() {
    this.destination = new MockAudioNode(this);
  }

  createGain(): MockGainNode {
    return new MockGainNode(this);
  }

  createOscillator(): MockOscillatorNode {
    return new MockOscillatorNode(this);
  }

  createBiquadFilter(): MockBiquadFilterNode {
    return new MockBiquadFilterNode(this);
  }

  createDelay(_maxDelayTime?: number): MockDelayNode {
    return new MockDelayNode(this, _maxDelayTime);
  }

  createStereoPanner(): MockStereoPannerNode {
    return new MockStereoPannerNode(this);
  }

  createDynamicsCompressor(): MockDynamicsCompressorNode {
    return new MockDynamicsCompressorNode(this);
  }

  createConvolver(): MockConvolverNode {
    return new MockConvolverNode(this);
  }

  createWaveShaper(): MockWaveShaperNode {
    return new MockWaveShaperNode(this);
  }

  createBufferSource(): MockBufferSourceNode {
    return new MockBufferSourceNode(this);
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    return new MockAudioBuffer(numberOfChannels, length, sampleRate) as unknown as AudioBuffer;
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  getActiveNodeCount(): number {
    return this.allCreatedNodes.filter((n) => !n.isDisconnected).length;
  }
}

export function createMockAudioContext(): AudioContext {
  return new MockAudioContext() as unknown as AudioContext;
}
