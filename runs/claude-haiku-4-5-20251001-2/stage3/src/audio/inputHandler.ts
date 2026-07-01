/**
 * Input Handler — Routes all input sources to the audio engine
 * Supports: Pointer (desktop), Touch (mobile), Keyboard (QWERTY), MIDI (Web MIDI API)
 * All inputs funnel through NoteLifecycleService for deterministic audio
 */

import { NoteLifecycleService } from './noteLifecycle'

/**
 * QWERTY to MIDI note mapping
 * Maps computer keyboard to piano notes in C4 octave (middle C)
 */
const QWERTY_MIDI_MAP: Record<string, number> = {
  // White keys (top row)
  'q': 60,  // C4
  'w': 62,  // D4
  'e': 64,  // E4
  'r': 65,  // F4
  't': 67,  // G4
  'y': 69,  // A4
  'u': 71,  // B4
  'i': 72,  // C5
  'o': 74,  // D5
  'p': 76,  // E5

  // Black keys (middle row)
  'a': 61,  // C#4
  's': 63,  // D#4
  'd': 66,  // F#4
  'f': 68,  // G#4
  'g': 70,  // A#4
  'h': 73,  // C#5
  'j': 75,  // D#5
  'k': 78,  // F#5
  'l': 80,  // G#5
}

/**
 * Input Handler manages all input sources and routes them to audio engine
 */
export class InputHandler {
  private noteLifecycle: NoteLifecycleService
  private keyStateMap: Map<string, number> = new Map() // key -> MIDI note tracking
  private touchMap: Map<number, { noteNumber: number }> = new Map() // touch ID -> note info
  private octaveOffset = 0 // For keyboard octave control

  constructor(noteLifecycle: NoteLifecycleService) {
    this.noteLifecycle = noteLifecycle
  }

  /**
   * Attach pointer input (desktop click/drag)
   * Returns an unsubscribe function
   */
  attachPointer(element: HTMLElement): () => void {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (target && target.hasAttribute('data-key-index')) {
        const keyIndexStr = target.getAttribute('data-key-index')
        if (keyIndexStr) {
          const keyIndex = parseInt(keyIndexStr, 10)
          const noteNumber = this.keyIndexToMidi(keyIndex)
          const velocity = this.pointerYToVelocity(event, target)
          const sourceId = `pointer-${keyIndex}`

          this.noteLifecycle.noteOn(noteNumber, velocity, sourceId)
        }
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (target && target.hasAttribute('data-key-index')) {
        const keyIndexStr = target.getAttribute('data-key-index')
        if (keyIndexStr) {
          const keyIndex = parseInt(keyIndexStr, 10)
          const sourceId = `pointer-${keyIndex}`
          this.noteLifecycle.noteOff(sourceId)
        }
      }
    }

    const handlePointerLeave = (event: PointerEvent) => {
      // If pointer left element while pressed, trigger note-off
      const target = event.target as HTMLElement
      if (target && target.hasAttribute('data-key-index')) {
        const keyIndexStr = target.getAttribute('data-key-index')
        if (keyIndexStr) {
          const keyIndex = parseInt(keyIndexStr, 10)
          const sourceId = `pointer-${keyIndex}`
          this.noteLifecycle.noteOff(sourceId)
        }
      }
    }

    element.addEventListener('pointerdown', handlePointerDown)
    element.addEventListener('pointerup', handlePointerUp)
    element.addEventListener('pointerleave', handlePointerLeave)

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown)
      element.removeEventListener('pointerup', handlePointerUp)
      element.removeEventListener('pointerleave', handlePointerLeave)
    }
  }

  /**
   * Attach touch input (mobile multi-touch)
   * Returns an unsubscribe function
   */
  attachTouch(element: HTMLElement): () => void {
    const handleTouchStart = (event: TouchEvent) => {
      for (let i = 0; i < event.touches.length; i++) {
        const touch = event.touches[i]!
        const target = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement
        if (target && target.hasAttribute('data-key-index')) {
          const keyIndexStr = target.getAttribute('data-key-index')
          if (keyIndexStr) {
            const keyIndex = parseInt(keyIndexStr, 10)
            const noteNumber = this.keyIndexToMidi(keyIndex)
            const velocity = this.touchToVelocity(touch, target)
            const sourceId = `touch-${touch.identifier}`

            this.noteLifecycle.noteOn(noteNumber, velocity, sourceId)
            this.touchMap.set(touch.identifier, { noteNumber })
          }
        }
      }
    }

    const handleTouchEnd = (event: TouchEvent) => {
      for (let i = 0; i < event.changedTouches.length; i++) {
        const touch = event.changedTouches[i]!
        const sourceId = `touch-${touch.identifier}`
        this.noteLifecycle.noteOff(sourceId)
        this.touchMap.delete(touch.identifier)
      }
    }

    element.addEventListener('touchstart', handleTouchStart)
    element.addEventListener('touchend', handleTouchEnd)

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchend', handleTouchEnd)
    }
  }

  /**
   * Attach keyboard input (QWERTY mapping)
   * Returns an unsubscribe function
   */
  attachKeyboard(): () => void {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      // Octave control
      if (key === 'z') {
        this.octaveOffset -= 12
        return
      }
      if (key === 'x') {
        this.octaveOffset += 12
        return
      }

      // Sustain pedal (spacebar)
      if (key === ' ') {
        event.preventDefault()
        this.noteLifecycle.setSustain(true)
        return
      }

      // All-notes-off (Escape)
      if (key === 'escape') {
        this.noteLifecycle.allNotesOff()
        return
      }

      // Note on (QWERTY mapping)
      if (QWERTY_MIDI_MAP[key] !== undefined) {
        // Prevent repeat key events (only first down-event triggers note-on)
        if (this.keyStateMap.has(key)) {
          return // Already pressed
        }

        const baseNote = QWERTY_MIDI_MAP[key]
        const noteNumber = baseNote + this.octaveOffset
        const sourceId = `keyboard-${key}`

        this.noteLifecycle.noteOn(noteNumber, 0.7, sourceId) // Default velocity 0.7
        this.keyStateMap.set(key, noteNumber)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      // Sustain release
      if (key === ' ') {
        event.preventDefault()
        this.noteLifecycle.setSustain(false)
        return
      }

      // Note off (QWERTY mapping)
      if (this.keyStateMap.has(key)) {
        const sourceId = `keyboard-${key}`
        this.noteLifecycle.noteOff(sourceId)
        this.keyStateMap.delete(key)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }

  /**
   * Attach MIDI input (Web MIDI API)
   * Returns an unsubscribe function
   */
  async attachMIDI(): Promise<() => void> {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not available')
      return () => {}
    }

    try {
      const midiAccess = await navigator.requestMIDIAccess()

      const handleMIDIMessage = (event: Event) => {
        const midiEvent = event as unknown as { data: { data: Uint8Array } }
        const data = (midiEvent.data as any).data as Uint8Array
        const [status, note, velocity] = data
        const channel = (status & 0x0f) + 1
        const command = status & 0xf0

        // Note-on (0x90) or Note-off (0x80)
        if (command === 0x90 && velocity > 0) {
          // Note-on
          const normalizedVelocity = velocity / 127 // Normalize to 0-1
          const sourceId = `midi-${channel}-${note}`
          this.noteLifecycle.noteOn(note, normalizedVelocity, sourceId)
        } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
          // Note-off
          const sourceId = `midi-${channel}-${note}`
          this.noteLifecycle.noteOff(sourceId)
        } else if (command === 0xb0) {
          // Control Change
          const cc = note // In CC messages, note byte holds CC number
          const ccValue = velocity

          // CC 64: Sustain Pedal
          if (cc === 64) {
            this.noteLifecycle.setSustain(ccValue >= 64)
          }
        }
      }

      // Attach listener to all input ports
      const inputs: MIDIInput[] = []
      midiAccess.inputs.forEach((input: MIDIInput) => {
        inputs.push(input)
        input.addEventListener('midimessage', handleMIDIMessage)
      })

      // Listen for new ports being connected
      const handleMIDIConnectionChange = (event: Event) => {
        const connEvent = event as unknown as { port: { type: string; state: string } }
        if (connEvent.port.type === 'input' && connEvent.port.state === 'connected') {
          (connEvent.port as MIDIInput).addEventListener('midimessage', handleMIDIMessage)
        }
      }

      midiAccess.addEventListener('statechange', handleMIDIConnectionChange)

      return () => {
        for (const input of inputs) {
          input.removeEventListener('midimessage', handleMIDIMessage)
        }
        midiAccess.removeEventListener('statechange', handleMIDIConnectionChange)
      }
    } catch (error) {
      console.warn('MIDI access denied or not available:', error)
      return () => {}
    }
  }

  // Helper methods

  /**
   * Convert keyboard key index (0-42 for white keys) to MIDI note
   * E4 (40) to E5 (52) mapped to indices 0-42
   */
  private keyIndexToMidi(keyIndex: number): number {
    // Map white key index to MIDI note
    // 73 keys starting at E (MIDI 40)
    // Pattern: E, F, G, A, B, C, D repeats
    const baseNote = 40 // E4
    const pattern = [0, 2, 4, 5, 7, 9, 11] // E, F#, G#, A#, B, C#, D#

    const octave = Math.floor(keyIndex / 7)
    const noteInOctave = keyIndex % 7
    return baseNote + octave * 12 + pattern[noteInOctave]
  }

  /**
   * Convert pointer Y position to velocity (0-127 scale, normalized to 0-1)
   * Top of key = loud (velocity ~1), bottom = soft (velocity ~0.3)
   */
  private pointerYToVelocity(event: PointerEvent, element: HTMLElement): number {
    const rect = element.getBoundingClientRect()
    const relativeY = event.clientY - rect.top
    const normalized = 1 - relativeY / rect.height // Invert: top = 1, bottom = 0
    const clamped = Math.max(0.3, Math.min(1, normalized)) // Clamp to 0.3-1 range
    return clamped
  }

  /**
   * Convert touch pressure to velocity
   * Fallback to Y position if pressure unavailable
   */
  private touchToVelocity(touch: Touch, element: HTMLElement): number {
    // If touch force available, use it
    if ('force' in touch && (touch as any).force) {
      return Math.max(0.3, Math.min(1, (touch as any).force))
    }

    // Fallback: use Y position
    const rect = element.getBoundingClientRect()
    const relativeY = touch.clientY - rect.top
    const normalized = 1 - relativeY / rect.height
    const clamped = Math.max(0.3, Math.min(1, normalized))
    return clamped
  }
}
