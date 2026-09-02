/**
 * AudioWorklet entry: hosts one src/dsp object per node (a LayerChain, the shared RotaryUnit, the MasterUnit, the
 * OrganUnit or a SynthLayerUnit). Parameters and note events arrive as plain objects over the message port; meters are reported back
 * roughly every 50 ms. The same classes run offline in tests (src/dsp/offline.ts) and, as a fallback,
 * on the main thread (src/audio/browserProcessor.ts), so the browser never runs code the tests did not.
 * This file is only ever evaluated inside an AudioWorkletGlobalScope (bundled by Vite via `?worker&url`).
 */
import { createHost, PROCESSOR_NAME, type Host } from './host'

/* Minimal AudioWorkletGlobalScope declarations (not part of lib.dom). */
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}
declare function registerProcessor(name: string, ctor: unknown): void
declare const sampleRate: number

class StagebenchProcessor extends AudioWorkletProcessor {
  private host: Host
  private alive = true
  private meterCountdown = 0

  constructor(options?: { processorOptions?: { kind?: string } }) {
    super(options)
    this.host = createHost(options?.processorOptions?.kind ?? 'layer', sampleRate)
    this.port.onmessage = (e: MessageEvent<{ type: string; params?: object; event?: object }>) => {
      const msg = e.data
      if (msg.type === 'params' && msg.params) this.host.unit.setParams(msg.params as never)
      else if (msg.type === 'event' && msg.event) this.host.unit.handle?.(msg.event as never)
      else if (msg.type === 'reset') this.host.unit.reset()
      else if (msg.type === 'dispose') this.alive = false
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    if (!out || out.length === 0) return this.alive
    const n = out[0].length
    const inp = inputs[0]
    const l = out[0]
    const r = out[1] ?? out[0]
    if (inp && inp.length > 0) {
      l.set(inp[0])
      if (out[1]) r.set(inp[1] ?? inp[0])
    } else {
      l.fill(0)
      if (out[1]) r.fill(0)
    }
    this.host.unit.process(l, r, n)
    this.meterCountdown -= n
    if (this.meterCountdown <= 0) {
      this.meterCountdown = Math.round(sampleRate * 0.05)
      this.port.postMessage({ type: 'meter', meter: this.host.meter() })
    }
    return this.alive
  }
}

registerProcessor(PROCESSOR_NAME, StagebenchProcessor)
