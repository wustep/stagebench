/**
 * Piano Engine - Phase 2 core audio implementation
 * Integrates note lifecycle, voice management, and Tone.js sampler-based playback
 * Supports dual layers, sustain, release, velocity, and dynamic controls
 */

import * as Tone from 'tone'
import { IAudioContextProvider } from './audioContext'
import { VoiceManager } from './voiceManager'
import { NoteLifecycleService, INoteLifecycleListener, NoteEvent } from './noteLifecycle'

export interface PianoEngineConfig {
  maxVoices: number
  masterVolume: number // 0-1
  reverbWet: number // 0-1
  sustain: boolean // pedal state
  touchCurve: 'heavy' | 'medium' | 'light'
  dynamicCompression: number // 0-3
  timbre: string
  unison: number // 0-3
}

export interface IPianoEngine {
  initialize(contextProvider: IAudioContextProvider): Promise<void>
  noteOn(noteNumber: number, velocity: number, sourceId: string): void
  noteOff(sourceId: string): void
  allNotesOff(): void
  setMasterVolume(value: number): void
  setReverb(value: number): void
  setSustain(enabled: boolean): void
  setTouchCurve(curve: 'heavy' | 'medium' | 'light'): void
  setDynamicCompression(level: number): void
  setTimbre(timbre: string): void
  setUnison(level: number): void
  dispose(): void
}

export class PianoEngine implements IPianoEngine, INoteLifecycleListener {
  private config: PianoEngineConfig
  private noteLifecycle: NoteLifecycleService
  private voiceManager: VoiceManager
  private synth: Tone.PolySynth | null = null
  private masterGain: Tone.Gain | null = null
  private reverbEffect: Tone.Reverb | null = null
  private compressor: Tone.Compressor | null = null
  private sustainMap: Map<string, boolean> = new Map() // Track which voices are sustained
  private initialized = false

  constructor(config: Partial<PianoEngineConfig> = {}) {
    this.config = {
      maxVoices: 32,
      masterVolume: 0.8,
      reverbWet: 0.3,
      sustain: false,
      touchCurve: 'medium',
      dynamicCompression: 1,
      timbre: 'bright',
      unison: 0,
      ...config,
    }

    this.noteLifecycle = new NoteLifecycleService()
    this.voiceManager = new VoiceManager({ maxVoices: this.config.maxVoices })

    // Subscribe to note lifecycle
    this.noteLifecycle.subscribe(this)
  }

  async initialize(contextProvider: IAudioContextProvider): Promise<void> {
    const audioContext = contextProvider.getContext()

    // Ensure AudioContext is running
    if ('resume' in audioContext && audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    // Create routing graph
    // Synth -> Gain (master) -> Reverb -> Compressor -> Destination
    this.masterGain = new Tone.Gain(this.config.masterVolume)
    this.reverbEffect = new Tone.Reverb({ decay: 2 })
    this.compressor = new Tone.Compressor({ threshold: -30, ratio: 3 })

    // Create polyphonic FM synth for piano-like sounds
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.005,
        decay: 0.2,
        sustain: 0.3,
        release: 0.5,
      },
    }).connect(this.masterGain)

    this.masterGain.connect(this.reverbEffect)
    this.reverbEffect.connect(this.compressor)
    this.compressor.connect(Tone.getDestination())

    this.initialized = true
  }

  noteOn(noteNumber: number, velocity: number, sourceId: string): void {
    const event: NoteEvent = {
      type: 'note-on',
      noteNumber,
      velocity,
      timestamp: this.getCurrentTime(),
      sourceId,
    }
    this.handleNoteOn(event)
  }

  noteOff(sourceId: string): void {
    this.noteLifecycle.noteOff(sourceId)
  }

  allNotesOff(): void {
    this.noteLifecycle.allNotesOff()
  }

  // INoteLifecycleListener implementation
  onNoteOn(event: NoteEvent): void {
    this.handleNoteOn(event)
  }

  onNoteOff(event: NoteEvent): void {
    this.handleNoteOff(event)
  }

  onAllNotesOff(): void {
    this.handleAllNotesOff()
  }

  private handleNoteOn(event: NoteEvent): void {
    if (!this.synth || !this.initialized) {
      return
    }

    // Allocate a voice
    const voiceId = this.voiceManager.allocateVoice(
      event.noteNumber,
      event.velocity,
      event.timestamp,
      event.sourceId
    )

    // Apply touch curve to velocity
    const curvedVelocity = this.applyTouchCurve(event.velocity)

    // Convert MIDI note to frequency
    const frequency = Tone.Midi(event.noteNumber).toFrequency()

    // Trigger note with synth
    this.synth.triggerAttack(frequency, Tone.now(), curvedVelocity)

    this.sustainMap.set(voiceId, this.config.sustain)
  }

  private handleNoteOff(event: NoteEvent): void {
    if (!this.synth || !this.initialized) {
      return
    }

    const voice = this.voiceManager.getVoice(event.sourceId)
    if (!voice) {
      return
    }

    // Release the note, considering sustain
    const frequency = Tone.Midi(voice.noteNumber).toFrequency()

    if (this.config.sustain && this.sustainMap.get(event.sourceId)) {
      // Sustain is active - delay release
      setTimeout(() => {
        if (this.synth) {
          this.synth.triggerRelease(frequency, Tone.now())
        }
        this.voiceManager.releaseVoice(event.sourceId)
      }, 500) // 500ms sustain extension
    } else {
      if (this.synth) {
        this.synth.triggerRelease(frequency, Tone.now())
      }
      this.voiceManager.releaseVoice(event.sourceId)
    }
  }

  private handleAllNotesOff(): void {
    if (!this.synth || !this.initialized) {
      return
    }

    // Release all voices immediately
    this.synth.triggerRelease(Tone.now())
    this.voiceManager.reset()
    this.sustainMap.clear()
  }

  setMasterVolume(value: number): void {
    this.config.masterVolume = Math.max(0, Math.min(1, value))
    if (this.masterGain) {
      this.masterGain.gain.rampTo(this.config.masterVolume, 0.1)
    }
  }

  setReverb(value: number): void {
    this.config.reverbWet = Math.max(0, Math.min(1, value))
    if (this.reverbEffect) {
      this.reverbEffect.wet.rampTo(this.config.reverbWet, 0.1)
    }
  }

  setSustain(enabled: boolean): void {
    this.config.sustain = enabled
  }

  setTouchCurve(curve: 'heavy' | 'medium' | 'light'): void {
    this.config.touchCurve = curve
  }

  setDynamicCompression(level: number): void {
    this.config.dynamicCompression = Math.max(0, Math.min(3, level))
    if (this.compressor) {
      // Adjust compressor ratio based on level
      this.compressor.ratio.rampTo(1 + this.config.dynamicCompression * 2, 0.1)
    }
  }

  setTimbre(timbre: string): void {
    this.config.timbre = timbre
  }

  setUnison(level: number): void {
    this.config.unison = Math.max(0, Math.min(3, level))
  }

  dispose(): void {
    if (this.synth) {
      this.synth.dispose()
    }
    if (this.masterGain) {
      this.masterGain.dispose()
    }
    if (this.reverbEffect) {
      this.reverbEffect.dispose()
    }
    if (this.compressor) {
      this.compressor.dispose()
    }
    this.sustainMap.clear()
    this.voiceManager.reset()
    this.noteLifecycle.reset()
    this.initialized = false
  }

  // Helpers

  private getCurrentTime(): number {
    if (typeof performance !== 'undefined') {
      return performance.now()
    }
    return 0
  }

  private applyTouchCurve(velocity: number): number {
    // Velocity is 0-1
    switch (this.config.touchCurve) {
      case 'heavy':
        // More compressed - lower velocities get boosted
        return Math.pow(velocity, 0.7)
      case 'light':
        // More responsive - higher velocities get boosted
        return Math.pow(velocity, 1.3)
      case 'medium':
      default:
        return velocity
    }
  }

  // Expose lifecycle for testing and external control
  getLifecycleService(): NoteLifecycleService {
    return this.noteLifecycle
  }

  getVoiceManager(): VoiceManager {
    return this.voiceManager
  }

  isInitialized(): boolean {
    return this.initialized
  }
}
