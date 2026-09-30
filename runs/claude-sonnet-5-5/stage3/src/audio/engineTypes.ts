import type { EngineState } from '../engine/state'
import type { AudioContextLike, AudioNodeLike, Scheduler } from './types'

/**
 * A sound engine for one section (Organ or Synth). The note lifecycle routes each key press to the layers that the
 * zones and scene enable; the sink forwards them here. An engine owns every node it creates and frees them all in
 * `dispose()`; nothing it makes reaches the destination except through the `outputs` it was given.
 */
export interface LayerVoiceEngine<L extends string> {
  /**
   * A key went down on `layer`. `note` is the sounding MIDI note (octave shift and transpose already applied),
   * `velocity` 1..127, `gain` the linear zone-crossfade gain (0..1] that scales the whole voice.
   */
  noteOn(layer: L, note: number, velocity: number, gain: number): void
  /** the key (or the sustain pedal) let go of `note` on `layer`: natural release; the engine decides what that means (hold, arp…) */
  noteOff(layer: L, note: number): void
  /** fast fade of that note's voice(s) — voice stealing */
  stealNote(layer: L, note: number): void
  /** follow the canonical (morph-resolved) state: parameters, pitch stick, mod wheel, clock */
  setState(state: EngineState): void
  /** silence everything immediately-ish (fast fade): held/latched notes, arpeggios, tails */
  panic(): void
  /** voices with live audio nodes; returns to 0 after everything has faded out or been disposed */
  liveVoiceCount(): number
  /** timers the engine still owns (0 after `panic()` has completed and after `dispose()`) */
  pendingTimerCount(): number
  dispose(): void
}

export interface EngineDeps<L extends string> {
  ctx: AudioContextLike
  scheduler: Scheduler
  /** where each layer's summed voices must be connected (the layer bus of the graph) */
  outputs: Record<L, AudioNodeLike>
  /** latest resolved state at construction time */
  state: EngineState
}
