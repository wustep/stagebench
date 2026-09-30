import type { EngineState, SceneFlags } from './state'

/** the enable state currently in force (sections and layers): what a Layer Scene stores */
export const liveSceneFlags = (s: EngineState): SceneFlags => ({
  sections: { piano: s.pianoOn, organ: s.organOn, synth: s.synthOn },
  layers: {
    'piano.A': s.layers.A.enabled,
    'piano.B': s.layers.B.enabled,
    'organ.A': s.organ.layers.A.enabled,
    'organ.B': s.organ.layers.B.enabled,
    'synth.A': s.synth.A.enabled,
    'synth.B': s.synth.B.enabled,
    'synth.C': s.synth.C.enabled,
  },
})

const sameFlags = (a: SceneFlags, b: SceneFlags): boolean => JSON.stringify(a) === JSON.stringify(b)

/** write the live enable state into the active scene so that both scenes are complete and serialisable */
export function commitScene(s: EngineState): EngineState {
  const live = liveSceneFlags(s)
  if (sameFlags(live, s.scenes[s.scene])) return s
  const scenes: EngineState['scenes'] = s.scene === 0 ? [live, s.scenes[1]] : [s.scenes[0], live]
  return { ...s, scenes }
}
