/** Offline-rendering harness for the synth engine tests: the real SynthEngine on node-web-audio-api's OfflineAudioContext. */
import { OfflineAudioContext } from 'node-web-audio-api'
import { defaultState, type EngineState } from '../../engine/state'
import type { SynthLayerId, SynthPatch } from '../../engine/synth'
import { FakeScheduler } from '../../test-utils/fakes'
import type { AudioContextLike, AudioNodeLike, GainNodeLike } from '../types'
import { SynthEngine } from './engine'

export const SR = 44100

export interface SynthRig {
  engine: SynthEngine
  ctx: OfflineAudioContext
  scheduler: FakeScheduler
  state: EngineState
  outputs: Record<SynthLayerId, GainNodeLike>
  render(): Promise<{ left: Float32Array; right: Float32Array; mono: Float32Array }>
}

/** the default state with layer A enabled and `edit` applied */
export const synthState = (edit: (s: EngineState) => EngineState = (s) => s): EngineState => {
  const s0 = defaultState()
  return edit({ ...s0, synthOn: true, synth: { ...s0.synth, A: { ...s0.synth.A, enabled: true } } })
}

export const withPatch = (s: EngineState, layer: SynthLayerId, fn: (p: SynthPatch) => SynthPatch): EngineState => ({
  ...s,
  synth: { ...s.synth, [layer]: { ...s.synth[layer], patch: fn(s.synth[layer].patch) } },
})

export function createSynthRig(seconds: number, edit?: (s: EngineState) => EngineState): SynthRig {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR)
  const acx = ctx as unknown as AudioContextLike
  const master = acx.createGain()
  master.connect(ctx.destination as unknown as AudioNodeLike)
  const outputs = {} as Record<SynthLayerId, GainNodeLike>
  for (const id of ['A', 'B', 'C'] as const) {
    outputs[id] = acx.createGain()
    outputs[id].connect(master)
  }
  const scheduler = new FakeScheduler()
  const state = synthState(edit)
  const engine = new SynthEngine({ ctx: acx, scheduler, outputs, state })
  return {
    engine,
    ctx,
    scheduler,
    state,
    outputs,
    async render() {
      const buffer = await ctx.startRendering()
      const left = buffer.getChannelData(0).slice()
      const right = buffer.getChannelData(1).slice()
      const mono = new Float32Array(left.length)
      for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (left[i] + right[i])
      return { left, right, mono }
    },
  }
}

/** build a rig, let `play` schedule the performance, render, dispose */
export async function renderSynth(
  seconds: number,
  edit: ((s: EngineState) => EngineState) | undefined,
  play: (rig: SynthRig) => void,
): Promise<{ left: Float32Array; right: Float32Array; mono: Float32Array; rig: SynthRig }> {
  const rig = createSynthRig(seconds, edit)
  play(rig)
  const out = await rig.render()
  return { ...out, rig }
}
