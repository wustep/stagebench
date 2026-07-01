/**
 * Effects Graph — Master effects chain for audio output
 * Manages: Master volume, Reverb, Compression
 * All layers route through this single effects chain
 */

import * as Tone from 'tone'

export interface EffectsGraphConfig {
  masterVolume: number // 0-1
  reverbWet: number // 0-1
  compressionThreshold: number // dB
  compressionRatio: number // compression ratio
}

/**
 * Effects Graph manages the master effects chain
 */
export class EffectsGraph {
  private masterGain: Tone.Gain
  private reverb: Tone.Reverb
  private compressor: Tone.Compressor
  private config: EffectsGraphConfig

  constructor(config: Partial<EffectsGraphConfig> = {}) {
    this.config = {
      masterVolume: 0.8,
      reverbWet: 0.3,
      compressionThreshold: -30,
      compressionRatio: 3,
      ...config,
    }

    // Create audio nodes
    this.masterGain = new Tone.Gain(this.config.masterVolume)
    this.reverb = new Tone.Reverb({
      decay: 2.5,
      wet: this.config.reverbWet,
    })
    this.compressor = new Tone.Compressor({
      threshold: this.config.compressionThreshold,
      ratio: this.config.compressionRatio,
      attack: 0.003,
      release: 0.25,
    })

    // Wire the chain: gain -> reverb -> compressor -> destination
    this.masterGain.connect(this.reverb)
    this.reverb.connect(this.compressor)
    this.compressor.connect(Tone.getDestination())
  }

  /**
   * Get the input node (master gain)
   * Connect synthesizers to this node
   */
  getInputNode(): Tone.Gain {
    return this.masterGain
  }

  /**
   * Set master volume (0-1)
   */
  setMasterVolume(value: number): void {
    const clamped = Math.max(0, Math.min(1, value))
    this.config.masterVolume = clamped
    this.masterGain.gain.rampTo(clamped, 0.1)
  }

  /**
   * Get current master volume
   */
  getMasterVolume(): number {
    return this.config.masterVolume
  }

  /**
   * Set reverb wet mix (0-1, where 0 = dry, 1 = full wet)
   */
  setReverbWet(value: number): void {
    const clamped = Math.max(0, Math.min(1, value))
    this.config.reverbWet = clamped
    this.reverb.wet.rampTo(clamped, 0.1)
  }

  /**
   * Get current reverb wet mix
   */
  getReverbWet(): number {
    return this.config.reverbWet
  }

  /**
   * Set reverb decay time (seconds)
   */
  setReverbDecay(decaySeconds: number): void {
    const clamped = Math.max(0.1, Math.min(10, decaySeconds))
    this.reverb.decay = clamped
  }

  /**
   * Set compression ratio
   */
  setCompressionRatio(ratio: number): void {
    const clamped = Math.max(1, Math.min(20, ratio))
    this.config.compressionRatio = clamped
    this.compressor.ratio.rampTo(clamped, 0.1)
  }

  /**
   * Get current compression ratio
   */
  getCompressionRatio(): number {
    return this.config.compressionRatio
  }

  /**
   * Set compression threshold (dB)
   */
  setCompressionThreshold(thresholdDb: number): void {
    const clamped = Math.max(-60, Math.min(0, thresholdDb))
    this.config.compressionThreshold = clamped
    this.compressor.threshold.rampTo(clamped, 0.1)
  }

  /**
   * Dispose of all nodes (for cleanup)
   */
  dispose(): void {
    this.masterGain.dispose()
    this.reverb.dispose()
    this.compressor.dispose()
  }
}
