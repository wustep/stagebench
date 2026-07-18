import type { AudioBackend } from './engine'

/**
 * Honest silent fallback: used when Web Audio is unavailable. The keybed
 * still moves and status truthfully reports the fallback; no sound is
 * produced and nothing pretends otherwise.
 */
export class SilentBackend implements AudioBackend {
  private clock = 0
  private active = new Set<number>()
  private nextHandle = 1

  now(): number {
    return this.clock
  }
  startVoice(): number {
    const h = this.nextHandle++
    this.active.add(h)
    return h
  }
  releaseVoice(): void {}
  stopVoice(handle: number): void {
    this.active.delete(handle)
  }
  activeVoiceCount(): number {
    return this.active.size
  }
  configure(): void {}
  dispose(): void {
    this.active.clear()
  }
}
