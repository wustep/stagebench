import { KernelHost, PROCESSOR_NAME, type EngineMessage } from './dsp/host'

/** AudioWorklet shell around the piano kernel. All synthesis happens in KernelHost. */
class StagePianoProcessor extends AudioWorkletProcessor {
  private readonly host: KernelHost
  private readonly spare = new Float32Array(128)

  constructor() {
    super()
    this.host = new KernelHost({ sampleRate }, (report) => this.port.postMessage(report))
    this.port.onmessage = (event: MessageEvent<EngineMessage>) => this.host.handle(event.data)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    if (!output || !output[0]) return true
    const left = output[0]
    // Mono destination: render the right channel into a scratch buffer of the same length.
    const right = output[1] ?? (this.spare.length === left.length ? this.spare : new Float32Array(left.length))
    this.host.process(left, right)
    return true
  }
}

registerProcessor(PROCESSOR_NAME, StagePianoProcessor)
