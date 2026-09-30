/**
 * Transient panel modes that decide what a control means right now and what the two OLEDs show. They are not part of a
 * program: nothing here is saved, and they all reset on Panic or when the panel is unmounted.
 */
import type { MorphSource } from './morph'
import type { SplitPointId } from './zones'

export type SynthPage = 'osc' | 'oscEnv' | 'filterEnv' | 'ampEnv' | 'filter' | 'lfo' | 'vibrato' | 'arp'
export type ProgView = 'main' | 'detail'

export interface UiMode {
  /** split point being edited (hold SPLIT ON/SET), or null */
  splitEdit: SplitPointId | null
  /** morph source in assign mode (hold, or double-tap to latch) */
  morph: { source: MorphSource; latched: boolean } | null
  /** which page of the Synth OLED the three dials edit */
  synthPage: SynthPage
  progView: ProgView
  /** a transient line on the Program OLED (tap tempo BPM, clock, transpose…) */
  status: string | null
}

export const initialUiMode = (): UiMode => ({ splitEdit: null, morph: null, synthPage: 'osc', progView: 'main', status: null })

export interface UiModeStore {
  get(): UiMode
  update(patch: Partial<UiMode>): void
  subscribe(listener: () => void): () => void
  listenerCount(): number
}

export function createUiModeStore(): UiModeStore {
  let mode = initialUiMode()
  const listeners = new Set<() => void>()
  return {
    get: () => mode,
    update(patch) {
      const next = { ...mode, ...patch }
      if ((Object.keys(next) as Array<keyof UiMode>).every((k) => JSON.stringify(next[k]) === JSON.stringify(mode[k]))) return
      mode = next
      for (const l of Array.from(listeners)) l()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    listenerCount: () => listeners.size,
  }
}
