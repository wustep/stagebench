import { Generator, type ToneKey } from './synthesis'
import type { Settings } from './settings'
declare const sampleRate: number
declare class AudioWorkletProcessor {
  port: MessagePort
}
declare function registerProcessor(
  name: string,
  ctor: typeof AudioWorkletProcessor,
): void
class StageProcessor extends AudioWorkletProcessor {
  layers = Array.from({ length: 5 }, () => new Generator(sampleRate))
  running = true
  constructor() {
    super()
    this.port.onmessage = ({ data }) => {
      if (data.barrier) {
        this.port.postMessage(data.barrier)
        return
      }
      if (data.settings) {
        const s: Settings = data.settings
        this.layers.forEach((g, i) => {
          const l = i < 2 ? s.organ[i] : s.synth[i - 2]
          if (i < 2) g.organ = s.organ[i].patch
          else g.setPatch(s.synth[i - 2].patch)
          if (!l.enabled || !(i < 2 ? s.organOn : s.synthOn)) g.clear()
          g.bpm = s.bpm
          g.wheel = s.wheel
          g.bend = l.stick ? (s.bend - 50) / 25 : 0
          g.sync = s.kbSync
        })
      } else if (data.on) this.layers[data.layer].on(data.on as ToneKey)
      else if (data.off !== undefined)
        this.layers[data.layer].off(data.off, data.fast)
      else {
        this.layers.forEach((g) => g.clear())
        if (data.dispose) this.running = false
      }
    }
  }
  process(_: unknown, outputs: Float32Array[][]) {
    this.layers.forEach((g, i) => g.render(outputs[i][0]))
    return this.running
  }
}
registerProcessor('stage-generators', StageProcessor)
