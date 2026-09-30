import { DEFAULT_DRAWBARS } from '../engine/organ'
import type { EngineState } from '../engine/state'
import { renderNotes, type NoteEvent, type OfflineRig } from './offline'

/** helpers to describe an instrument setup as small state edits and render it through the real instrument */
export type Edit = (s: EngineState) => EngineState
export const chain =
  (...edits: Edit[]): Edit =>
  (s) =>
    edits.reduce((acc, e) => e(acc), s)

export const noPiano: Edit = (s) => ({ ...s, layers: { ...s.layers, A: { ...s.layers.A, enabled: false } } })
export const organLayer =
  (id: 'A' | 'B', patch: Partial<EngineState['organ']['layers']['A']> = {}): Edit =>
  (s) => ({
    ...s,
    organOn: true,
    organ: { ...s.organ, layers: { ...s.organ.layers, [id]: { ...s.organ.layers[id], enabled: true, ...patch, drawbars: patch.drawbars ?? (patch.model ? [...DEFAULT_DRAWBARS[patch.model]] : s.organ.layers[id].drawbars) } } },
  })
export const synthLayer =
  (id: 'A' | 'B' | 'C', waveform = 2): Edit =>
  (s) => ({ ...s, synthOn: true, synth: { ...s.synth, [id]: { ...s.synth[id], enabled: true, patch: { ...s.synth[id].patch, waveform } } } })

export const rigs: OfflineRig[] = []
export const disposeRigs = () => {
  while (rigs.length) rigs.pop()!.dispose()
}
export const play = async (seconds: number, notes: NoteEvent[], edit: Edit = (s) => s, extra?: Parameters<typeof renderNotes>[3]) => {
  const out = await renderNotes(seconds, notes, edit, extra)
  rigs.push(out.rig)
  return out
}
export type Played = Awaited<ReturnType<typeof play>>
export const SR = 44100
export const at = (seconds: number) => Math.floor(seconds * SR)
