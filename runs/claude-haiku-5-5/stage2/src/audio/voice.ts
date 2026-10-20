// Shared voice contract. A voice sink starts one note and hands back a handle; the note controller
// uses the handle to release, cut, or bend that note. Every voice kind (sample, synthesized, fallback)
// implements this same shape, so the note lifecycle never needs to know what makes the sound.

export interface VoiceHandle {
  /** Begins the release tail. Calling it again, or after the voice has ended, does nothing. */
  release(): void
  /** Cuts the voice immediately (a few milliseconds of fade to avoid clicks). */
  stop(): void
  /** Pitch-stick bend in cents, applied to the voice's oscillators or sample playback. */
  setBend?(cents: number): void
}

export interface VoiceSink {
  start(note: number, velocity: number, onEnded: () => void): VoiceHandle
}
