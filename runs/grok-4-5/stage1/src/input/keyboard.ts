/** Computer keyboard → MIDI note mapping with repeat suppression */

/** Two-row piano mapping starting at E (matches Stage 4 73 lowest white key region around middle) */
const KEY_MAP: Record<string, number> = {
  // Lower row (white-ish): Z row → starting near E3/A3 region
  KeyZ: 40, // E2
  KeyX: 42, // F#2
  KeyC: 43, // G2
  KeyV: 45, // A2
  KeyB: 47, // B2
  KeyN: 48, // C3
  KeyM: 50, // D3
  Comma: 52, // E3
  Period: 53, // F3
  Slash: 55, // G3
  // Home row
  KeyA: 52, // E3
  KeyS: 54, // F#3
  KeyD: 55, // G3
  KeyF: 57, // A3
  KeyG: 59, // B3
  KeyH: 60, // C4
  KeyJ: 62, // D4
  KeyK: 64, // E4
  KeyL: 65, // F4
  Semicolon: 67, // G4
  Quote: 69, // A4
  // Top row
  KeyQ: 64, // E4
  KeyW: 66, // F#4
  KeyE: 67, // G4
  KeyR: 69, // A4
  KeyT: 71, // B4
  KeyY: 72, // C5
  KeyU: 74, // D5
  KeyI: 76, // E5
  KeyO: 77, // F5
  KeyP: 79, // G5
  BracketLeft: 81, // A5
  BracketRight: 83, // B5
  // Number row black keys helpers
  Digit2: 65,
  Digit3: 67,
  Digit4: 69,
  Digit5: 71,
  Digit6: 72,
  Digit7: 74,
  Digit8: 76,
  Digit9: 77,
  // Sustain
  Space: -1, // special: sustain
}

export function midiFromComputerKey(code: string): number | null {
  if (code in KEY_MAP) {
    const v = KEY_MAP[code]
    return v === -1 ? null : v
  }
  return null
}

export function isSustainKey(code: string): boolean {
  return code === 'Space'
}

export interface KeyboardInputOptions {
  onNoteOn: (midi: number, velocity: number) => void
  onNoteOff: (midi: number) => void
  onSustain: (down: boolean) => void
  target?: Window | Document | HTMLElement
}

/**
 * Attach keyboard listeners with key-repeat suppression and blur cleanup.
 */
export function attachKeyboardInput(opts: KeyboardInputOptions): () => void {
  const target = opts.target ?? window
  const heldCodes = new Set<string>()
  const codeToMidi = new Map<string, number>()

  const onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent
    if (ke.metaKey || ke.ctrlKey || ke.altKey) return
    if (isSustainKey(ke.code)) {
      if (!heldCodes.has(ke.code)) {
        heldCodes.add(ke.code)
        opts.onSustain(true)
      }
      ke.preventDefault()
      return
    }
    const midi = midiFromComputerKey(ke.code)
    if (midi === null) return
    // Repeat suppression
    if (ke.repeat || heldCodes.has(ke.code)) {
      ke.preventDefault()
      return
    }
    heldCodes.add(ke.code)
    codeToMidi.set(ke.code, midi)
    opts.onNoteOn(midi, 0.8)
    ke.preventDefault()
  }

  const onKeyUp = (e: Event) => {
    const ke = e as KeyboardEvent
    if (isSustainKey(ke.code)) {
      heldCodes.delete(ke.code)
      opts.onSustain(false)
      return
    }
    if (!heldCodes.has(ke.code)) return
    heldCodes.delete(ke.code)
    const midi = codeToMidi.get(ke.code)
    codeToMidi.delete(ke.code)
    if (midi !== undefined) opts.onNoteOff(midi)
  }

  const onBlur = () => {
    for (const midi of codeToMidi.values()) {
      opts.onNoteOff(midi)
    }
    codeToMidi.clear()
    if (heldCodes.has('Space')) {
      opts.onSustain(false)
    }
    heldCodes.clear()
  }

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  return () => {
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    onBlur()
  }
}
