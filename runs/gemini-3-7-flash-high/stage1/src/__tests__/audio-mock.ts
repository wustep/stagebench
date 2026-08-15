export class MockAudioParam {
  public value: number;
  public scheduledValues: Array<{ type: string; value: number; time: number }> = [];

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

  cancelScheduledValues(time: number): void {
    this.scheduledValues = this.scheduledValues.filter(s => s.time < time);
  }
}

export class MockAudioNode {
  public context: MockAudioContext;
  public connectedTo: MockAudioNode[] = [];
  public isDisconnected = false;

  constructor(context: MockAudioContext) {
    this.context = context;
    context.allCreatedNodes.push(this);
  }

  connect(destination: MockAudioNode): void {
    this.connectedTo.push(destination);
    this.isDisconnected = false;
  }

  disconnect(): void {
    this.connectedTo = [];
    this.isDisconnected = true;
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
  public type: OscillatorType = 'sine';
  public isStarted = false;
  public isStopped = false;

  constructor(context: MockAudioContext) {
    super(context);
    this.frequency = new MockAudioParam(440);
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
  public type: BiquadFilterType = 'lowpass';

  constructor(context: MockAudioContext) {
    super(context);
    this.frequency = new MockAudioParam(350);
    this.Q = new MockAudioParam(1);
  }
}

export class MockAudioContext {
  public currentTime: number = 0;
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
    return this.allCreatedNodes.filter(n => !n.isDisconnected).length;
  }
}
