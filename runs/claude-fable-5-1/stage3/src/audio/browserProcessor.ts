/**
 * Browser DSP host. Preferred path: an AudioWorkletNode running src/dsp/worklet.ts (bundled by Vite as a
 * separate script). Fallback when `audioWorklet` is missing or the module fails to load: a
 * ScriptProcessorNode running the very same DSP classes on the main thread (higher latency, reported
 * truthfully in the status strip). Never imported by tests.
 */
import { createHost, PROCESSOR_NAME } from '../dsp/host'
import type { AudioContextLike, ProcessorKind, ProcessorNodeLike } from './boundaries'

const moduleLoads = new WeakMap<object, Promise<boolean>>()

async function ensureWorklet(ctx: AudioContext): Promise<boolean> {
  if (!ctx.audioWorklet) return false
  let pending = moduleLoads.get(ctx)
  if (!pending) {
    pending = import('../dsp/worklet?worker&url')
      .then((m) => ctx.audioWorklet.addModule(m.default))
      .then(
        () => true,
        (err) => {
          console.warn('AudioWorklet unavailable, falling back to the main thread:', err)
          return false
        },
      )
    moduleLoads.set(ctx, pending)
  }
  return pending
}

export async function createBrowserProcessor(ctxLike: AudioContextLike, kind: ProcessorKind): Promise<ProcessorNodeLike> {
  const ctx = ctxLike as unknown as AudioContext
  // The returned object IS the real AudioNode (augmented), so native nodes can connect to it and it to them.
  if (await ensureWorklet(ctx)) {
    const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { kind },
    })
    const augmented = node as unknown as AudioWorkletNode & { kind: ProcessorKind; mode: 'worklet'; onMeter: ProcessorNodeLike['onMeter']; setParams(p: object): void; send(e: object): void; dispose(): void }
    augmented.kind = kind
    augmented.mode = 'worklet'
    augmented.onMeter = null
    augmented.setParams = (params) => node.port.postMessage({ type: 'params', params })
    augmented.send = (event) => node.port.postMessage({ type: 'event', event })
    augmented.dispose = () => {
      node.port.postMessage({ type: 'dispose' })
      node.port.onmessage = null
      node.disconnect()
    }
    node.port.onmessage = (e: MessageEvent<{ type: string; meter?: Record<string, number> }>) => {
      if (e.data?.type === 'meter' && e.data.meter) augmented.onMeter?.(e.data.meter)
    }
    return augmented as unknown as ProcessorNodeLike
  }
  // Main-thread fallback: same DSP object, larger blocks.
  const host = createHost(kind, ctx.sampleRate)
  const node = ctx.createScriptProcessor(1024, 2, 2)
  const augmented = node as unknown as ScriptProcessorNode & { kind: ProcessorKind; mode: 'main-thread'; onMeter: ProcessorNodeLike['onMeter']; setParams(p: object): void; send(e: object): void; dispose(): void }
  let alive = true
  let meterCountdown = 0
  node.onaudioprocess = (e) => {
    const l = e.outputBuffer.getChannelData(0)
    const r = e.outputBuffer.getChannelData(1)
    const n = l.length
    if (alive) {
      l.set(e.inputBuffer.getChannelData(0))
      r.set(e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : e.inputBuffer.getChannelData(0))
      host.unit.process(l, r, n)
      meterCountdown -= n
      if (meterCountdown <= 0) {
        meterCountdown = Math.round(ctx.sampleRate * 0.05)
        augmented.onMeter?.(host.meter())
      }
    } else {
      l.fill(0)
      r.fill(0)
    }
  }
  augmented.kind = kind
  augmented.mode = 'main-thread'
  augmented.onMeter = null
  augmented.setParams = (params) => host.unit.setParams(params as never)
  augmented.send = (event) => host.unit.handle?.(event as never)
  augmented.dispose = () => {
    alive = false
    node.onaudioprocess = null
    node.disconnect()
  }
  return augmented as unknown as ProcessorNodeLike
}
