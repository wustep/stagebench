/**
 * DSP host factory shared by the AudioWorklet entry (src/dsp/worklet.ts) and the main-thread fallback
 * (src/audio/browserProcessor.ts). Pure: no AudioWorkletGlobalScope globals, so it is safe to import anywhere.
 */
import { LayerChain } from './chain'
import { MasterUnit } from './master'
import { OrganUnit } from './organ'
import { RotaryUnit } from './rotary'
import { SynthLayerUnit } from './synth'
import type { StereoProcessor } from './types'

export const PROCESSOR_NAME = 'stagebench-dsp'

export interface Host {
  unit: StereoProcessor & { setParams(p: never): void; handle?(event: never): void }
  meter(): Record<string, number>
}

export function createHost(kind: string, sr: number): Host {
  if (kind === 'rotary') {
    const unit = new RotaryUnit(sr)
    return { unit, meter: () => ({ hornRate: unit.hornRate, rotorRate: unit.rotorRate }) }
  }
  if (kind === 'master') {
    const unit = new MasterUnit(sr)
    return { unit, meter: () => ({ gainReduction: unit.gainReduction }) }
  }
  if (kind === 'organ') {
    const unit = new OrganUnit(sr)
    return { unit, meter: () => ({ voices: unit.voiceCount, percussion: unit.percussionLevel }) }
  }
  if (kind === 'synth') {
    const unit = new SynthLayerUnit(sr)
    return { unit, meter: () => ({ voices: unit.voiceCount, arpStep: unit.arpStep, lfo: unit.lfoValue }) }
  }
  const unit = new LayerChain(sr)
  return { unit, meter: () => ({ gainReduction: unit.unit('compressor').gainReduction }) }
}
