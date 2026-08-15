/**
 * The audio boundary. Phase 1 provides exactly one dependable, honestly
 * synthesized piano-like voice. The engine is pure DSP (deterministic, sample
 * accurate, no platform audio required) so tests can render and measure actual
 * output without a device, network, or real audio output.
 */

export interface RenderResult {
  /** mono PCM samples for the requested block. */
  samples: Float32Array
  /** peak magnitude of the block (0..1). */
  peak: number
}

/** A single sounding voice, internal to the engine. */
export interface Voice {
  id: number
  midi: number
  /** 0..1 normalized velocity. */
  velocity: number
  /** true while the physical key is down. */
  held: boolean
  /** true when held and the sustain pedal is down. */
  sustained: boolean
  /** sample clock position of voice onset for stealing order. */
  onset: number
}

/**
 * Injectable timing boundary. The default uses performance.now() so steady
 * real-time scheduling can be modeled; tests supply a manual clock.
 */
export interface Clock {
  now(): number
}

export interface EngineEvents {
  /** called when the engine starts a new voice (useful for status/LEDs). */
  onVoiceStart?(voice: Voice): void
  /** called when a voice is silenced (stolen, released, or all-notes-off). */
  onVoiceEnd?(voice: Voice): void
}