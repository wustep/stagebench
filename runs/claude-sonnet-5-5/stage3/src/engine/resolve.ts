import { resolveMorph } from './morph'
import type { EngineState } from './state'

/**
 * The effective state the audio follows: the stored (program) state with every morph applied at the current source
 * position and, when SOLO is on, every section but the soloed one silenced.
 */
export function resolveState(s: EngineState): EngineState {
  const morphed = resolveMorph(s)
  if (!morphed.solo) return morphed
  const solo = morphed.solo
  const zero = <T extends { level: number }>(rec: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, { ...v, level: 0 }]))
  return {
    ...morphed,
    layers: solo === 'piano' ? morphed.layers : (zero(morphed.layers) as EngineState['layers']),
    organ: solo === 'organ' ? morphed.organ : { ...morphed.organ, layers: zero(morphed.organ.layers) as EngineState['organ']['layers'] },
    synth: solo === 'synth' ? morphed.synth : (zero(morphed.synth) as EngineState['synth']),
  }
}
