import { InstrumentDSP, type DSPMessage } from './dsp'
declare const sampleRate: number
declare abstract class AudioWorkletProcessor { readonly port: MessagePort; abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void
class StageProcessor extends AudioWorkletProcessor {
  dsp = new InstrumentDSP(sampleRate)
  constructor() { super(); this.port.onmessage = (e: MessageEvent<DSPMessage | { kind: 'barrier'; id: number }>) => { if (e.data.kind === 'barrier') this.port.postMessage({ ack: e.data.id }); else this.dsp.message(e.data) } }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const output = outputs[0]
    if (output?.length >= 2) this.dsp.render(output[0], output[1])
    if (this.dsp.finished.length) { this.port.postMessage({ ended: this.dsp.finished }); this.dsp.finished = [] }
    return true
  }
}
registerProcessor('stage-piano', StageProcessor)
