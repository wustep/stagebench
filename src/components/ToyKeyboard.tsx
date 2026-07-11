// The playable toy instrument in the page header. It owns all high-frequency
// interaction state (held notes, pitch bend, mod depth, octave shift) plus the
// Web Audio graph, so playing it re-renders only this subtree — never the run
// leaderboard. The benchmark readouts it shows (run count, active count,
// running model) are module-constant, read directly from runs-data.
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { activeCount, phaseNames, runningModel, visibleRuns } from '../runs-data'

const knobAngles = [-86, -22, 43]
const noteOffsets = [0, 2, 4, 5, 7, 9, 11]
const noteNames = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const sharpNotes = new Set(['C', 'D', 'F', 'G', 'A'])
const headerKeys = Array.from({ length: 28 }, (_, index) => {
  const octave = 3 + Math.floor(index / 7)
  const noteIndex = index % 7
  const note = noteNames[noteIndex]
  const midi = 48 + Math.floor(index / 7) * 12 + noteOffsets[noteIndex]

  return {
    white: { midi, name: `${note}${octave}` },
    black: sharpNotes.has(note) ? { midi: midi + 1, name: `${note}♯${octave}` } : null,
  }
})
const computerKeyboardNotes: Record<string, { label: string; midi: number }> = {
  KeyZ: { label: 'Z', midi: 48 },
  KeyS: { label: 'S', midi: 49 },
  KeyX: { label: 'X', midi: 50 },
  KeyD: { label: 'D', midi: 51 },
  KeyC: { label: 'C', midi: 52 },
  KeyV: { label: 'V', midi: 53 },
  KeyG: { label: 'G', midi: 54 },
  KeyB: { label: 'B', midi: 55 },
  KeyH: { label: 'H', midi: 56 },
  KeyN: { label: 'N', midi: 57 },
  KeyJ: { label: 'J', midi: 58 },
  KeyM: { label: 'M', midi: 59 },
  KeyQ: { label: 'Q', midi: 60 },
  Digit2: { label: '2', midi: 61 },
  KeyW: { label: 'W', midi: 62 },
  Digit3: { label: '3', midi: 63 },
  KeyE: { label: 'E', midi: 64 },
  KeyR: { label: 'R', midi: 65 },
  Digit5: { label: '5', midi: 66 },
  KeyT: { label: 'T', midi: 67 },
  Digit6: { label: '6', midi: 68 },
  KeyY: { label: 'Y', midi: 69 },
  Digit7: { label: '7', midi: 70 },
  KeyU: { label: 'U', midi: 71 },
  KeyI: { label: 'I', midi: 72 },
  Digit9: { label: '9', midi: 73 },
  KeyO: { label: 'O', midi: 74 },
  Digit0: { label: '0', midi: 75 },
  KeyP: { label: 'P', midi: 76 },
}
const computerKeyLabels = new Map(
  Object.values(computerKeyboardNotes).map(({ label, midi }) => [midi, label]),
)
// The QWERTY map covers 29 semitones of the 48-key rail; the octave shift
// buttons (or -/= keys) slide it up so every note is reachable from the
// computer keyboard: shift 0 starts at C3, +2 tops out at the rail's B6.
const OCTAVE_SHIFT_MAX = 2
const HEADER_MIDI_MAX = 95
const headerNoteNames = Object.fromEntries(
  headerKeys.flatMap(({ white, black }) => black
    ? [[white.midi, white.name], [black.midi, black.name]]
    : [[white.midi, white.name]]),
) as Record<number, string>

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// Miniature take on the Stage 4 pitch stick: drag sideways to bend held
// notes, springs back to center on release (pointer, keyboard, or focus loss).
function PitchStick({ bend, onBend }: { bend: number; onBend: (value: number) => void }) {
  const dragOriginRef = useRef<number | null>(null)

  return (
    <div
      aria-label="Pitch stick, bends held notes"
      aria-orientation="horizontal"
      aria-valuemax={1}
      aria-valuemin={-1}
      aria-valuenow={Math.round(bend * 100) / 100}
      className="toy-pitch-stick"
      role="slider"
      tabIndex={0}
      onBlur={() => onBend(0)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); onBend(bend - 0.25) }
        else if (event.key === 'ArrowRight') { event.preventDefault(); onBend(bend + 0.25) }
        else if (event.key === 'Home') { event.preventDefault(); onBend(0) }
      }}
      onKeyUp={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') onBend(0)
      }}
      onLostPointerCapture={() => { dragOriginRef.current = null; onBend(0) }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        dragOriginRef.current = event.clientX
      }}
      onPointerMove={(event) => {
        if (dragOriginRef.current === null) return
        onBend((event.clientX - dragOriginRef.current) / 44)
      }}
    >
      <span aria-hidden="true" className="toy-pitch-lever" style={{ transform: `translateX(${bend * 32}%)` }} />
    </div>
  )
}

// Miniature mod wheel: drag up for vibrato depth; the value latches like the
// hardware wheel (no spring back).
function ModWheel({ mod, onMod }: { mod: number; onMod: (value: number) => void }) {
  const dragStateRef = useRef<{ originY: number; startValue: number } | null>(null)

  return (
    <div
      aria-label="Mod wheel, adds vibrato"
      aria-orientation="vertical"
      aria-valuemax={1}
      aria-valuemin={0}
      aria-valuenow={Math.round(mod * 100) / 100}
      className="toy-mod-wheel"
      role="slider"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') { event.preventDefault(); onMod(mod + 0.1) }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') { event.preventDefault(); onMod(mod - 0.1) }
        else if (event.key === 'Home') { event.preventDefault(); onMod(0) }
        else if (event.key === 'End') { event.preventDefault(); onMod(1) }
      }}
      onLostPointerCapture={() => { dragStateRef.current = null }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        dragStateRef.current = { originY: event.clientY, startValue: mod }
      }}
      onPointerMove={(event) => {
        const drag = dragStateRef.current
        if (!drag) return
        onMod(drag.startValue + (drag.originY - event.clientY) / 56)
      }}
    >
      <span aria-hidden="true" className="toy-wheel-face">
        <i className="toy-wheel-dimple" style={{ top: `${84 - mod * 68}%` }} />
      </span>
    </div>
  )
}

const KeyboardRail = memo(function KeyboardRail({
  activeNotes,
  octaveShift,
  onNoteOn,
  onNoteOff,
}: {
  activeNotes: Set<number>
  octaveShift: number
  onNoteOn: (midi: number, name: string) => void
  onNoteOff: (midi: number) => void
}) {
  const keyboardHandlers = (midi: number, name: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      onNoteOn(midi, name)
    },
    onPointerUp: () => onNoteOff(midi),
    onPointerCancel: () => onNoteOff(midi),
    onLostPointerCapture: () => onNoteOff(midi),
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
        event.preventDefault()
        onNoteOn(midi, name)
      }
    },
    onKeyUp: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onNoteOff(midi)
      }
    },
    onBlur: () => onNoteOff(midi),
  })

  return (
    <div className="keyboard-rail" role="group" aria-label="Playable benchmark keyboard">
      {headerKeys.map(({ white, black }) => {
        // Key-hint chips follow the octave shift so they always sit on the
        // keys the computer keyboard currently plays.
        const whiteShortcut = computerKeyLabels.get(white.midi - octaveShift * 12)
        const blackShortcut = black ? computerKeyLabels.get(black.midi - octaveShift * 12) : undefined

        return (
          <span className="key-slot" key={white.midi}>
            <button
              aria-label={`Play ${white.name}${whiteShortcut ? `, keyboard ${whiteShortcut}` : ''}`}
              className={`white-key${activeNotes.has(white.midi) ? ' is-active' : ''}`}
              type="button"
              {...keyboardHandlers(white.midi, white.name)}
            >
              {whiteShortcut && <span className="key-label" aria-hidden="true">{whiteShortcut}</span>}
            </button>
            {black && (
              <button
                aria-label={`Play ${black.name}${blackShortcut ? `, keyboard ${blackShortcut}` : ''}`}
                className={`black-key${activeNotes.has(black.midi) ? ' is-active' : ''}`}
                type="button"
                {...keyboardHandlers(black.midi, black.name)}
              >
                {blackShortcut && <span className="key-label" aria-hidden="true">{blackShortcut}</span>}
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
})

export function ToyKeyboard({ overlayOpen }: { overlayOpen: boolean }) {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(() => new Set())
  const [lastPlayed, setLastPlayed] = useState<string | null>(null)
  const [bend, setBend] = useState(0)
  const [mod, setMod] = useState(0)
  const [octaveShift, setOctaveShift] = useState(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  const voicesRef = useRef(new Map<number, { oscillator: OscillatorNode; gain: GainNode; ended: boolean }>())
  // Shared modulation graph: pitch stick detunes every voice directly, the
  // mod wheel scales one vibrato LFO that feeds each oscillator's detune.
  const bendCentsRef = useRef(0)
  const modDepthRef = useRef(0)
  const lfoRef = useRef<{ oscillator: OscillatorNode; gain: GainNode } | null>(null)
  const masterRef = useRef<GainNode | null>(null)
  // Each held computer key remembers the actual MIDI note it started, so a
  // mid-hold octave change still releases the right voice.
  const pressedKeysRef = useRef(new Map<string, number>())
  const octaveShiftRef = useRef(0)

  const stopHeaderNote = useCallback((midi: number) => {
    const voice = voicesRef.current.get(midi)
    if (!voice) return

    const now = voice.gain.context.currentTime
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setTargetAtTime(0.0001, now, 0.04)
    voice.oscillator.stop(now + 0.22)
    voicesRef.current.delete(midi)
    setActiveNotes((current) => {
      const next = new Set(current)
      next.delete(midi)
      return next
    })
  }, [])

  const ensureAudioContext = useCallback(() => {
    const context = audioContextRef.current ?? new AudioContext()
    audioContextRef.current = context
    if (context.state === 'suspended') void context.resume()

    if (!masterRef.current) {
      // Soft-knee limiter keeps big chords from clipping now that the toy
      // encourages mashing many keys with vibrato on top.
      const compressor = context.createDynamicsCompressor()
      compressor.threshold.value = -14
      compressor.knee.value = 20
      compressor.ratio.value = 8
      const master = context.createGain()
      master.gain.value = 0.9
      master.connect(compressor)
      compressor.connect(context.destination)
      masterRef.current = master
    }

    if (!lfoRef.current) {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.value = 5.6
      const gain = context.createGain()
      gain.gain.value = modDepthRef.current * 32
      oscillator.connect(gain)
      oscillator.start()
      lfoRef.current = { oscillator, gain }
    }

    return context
  }, [])

  const applyBend = useCallback((value: number) => {
    const next = clamp(value, -1, 1)
    setBend(next)
    bendCentsRef.current = next * 200
    const context = audioContextRef.current
    if (!context) return
    for (const voice of voicesRef.current.values()) {
      voice.oscillator.detune.setTargetAtTime(bendCentsRef.current, context.currentTime, 0.012)
    }
  }, [])

  const shiftOctave = useCallback((delta: number) => {
    setOctaveShift((current) => {
      const next = clamp(current + delta, 0, OCTAVE_SHIFT_MAX)
      octaveShiftRef.current = next
      return next
    })
  }, [])

  const applyMod = useCallback((value: number) => {
    const next = clamp(value, 0, 1)
    setMod(next)
    modDepthRef.current = next
    const context = audioContextRef.current
    if (context && lfoRef.current) {
      lfoRef.current.gain.gain.setTargetAtTime(next * 32, context.currentTime, 0.05)
    }
  }, [])

  const startHeaderNote = useCallback((midi: number, name: string) => {
    if (voicesRef.current.has(midi)) return

    const context = ensureAudioContext()

    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const now = context.currentTime
    oscillator.type = 'triangle'
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12)
    oscillator.detune.value = bendCentsRef.current
    lfoRef.current?.gain.connect(oscillator.detune)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.018)
    gain.gain.exponentialRampToValueAtTime(0.075, now + 0.8)
    oscillator.connect(gain)
    gain.connect(masterRef.current ?? context.destination)
    const voice = { oscillator, gain, ended: false }
    oscillator.onended = () => {
      voice.ended = true
      lfoRef.current?.gain.disconnect(oscillator.detune)
      oscillator.disconnect()
      gain.disconnect()
    }
    oscillator.start(now)
    voicesRef.current.set(midi, voice)
    setLastPlayed(name)
    setActiveNotes((current) => new Set(current).add(midi))
  }, [ensureAudioContext])

  useEffect(() => {
    const pressedKeys = pressedKeysRef.current
    const releasePressedKeys = () => {
      for (const midi of pressedKeys.values()) {
        stopHeaderNote(midi)
      }
      pressedKeys.clear()
    }

    if (overlayOpen) {
      releasePressedKeys()
      return
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return

      const target = event.target
      if (target instanceof HTMLElement && (
        target.isContentEditable || target.matches('input, textarea, select')
      )) return

      if (event.code === 'Minus' || event.code === 'Equal') {
        event.preventDefault()
        shiftOctave(event.code === 'Minus' ? -1 : 1)
        return
      }

      const note = computerKeyboardNotes[event.code]
      if (!note || pressedKeys.has(event.code)) return

      const midi = note.midi + octaveShiftRef.current * 12
      if (midi > HEADER_MIDI_MAX) return

      event.preventDefault()
      pressedKeys.set(event.code, midi)
      startHeaderNote(midi, headerNoteNames[midi])
    }

    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      const midi = pressedKeys.get(event.code)
      if (midi === undefined) return

      event.preventDefault()
      pressedKeys.delete(event.code)
      stopHeaderNote(midi)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releasePressedKeys)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releasePressedKeys)
      releasePressedKeys()
    }
  }, [overlayOpen, shiftOctave, startHeaderNote, stopHeaderNote])

  useEffect(() => {
    const voices = voicesRef.current
    const audioContext = audioContextRef
    return () => {
      // A voice may already have ended via its onended callback; calling stop()
      // on a stopped oscillator throws, so skip ended voices and guard the rest.
      for (const voice of voices.values()) {
        if (voice.ended) continue
        try {
          voice.oscillator.stop()
        } catch {
          // Oscillator already stopped or context torn down; nothing to do.
        }
      }
      voices.clear()
      if (audioContext.current) void audioContext.current.close()
    }
  }, [])

  return (
    <div className="instrument-shell">
      <div className="toy-top-rail" aria-hidden="true">
        <span>PEDALS</span>
        <span>MIDI</span>
        <span>USB</span>
        <span>MONITOR</span>
        <span>OUTPUT</span>
      </div>

      <div className="control-deck" aria-label="Benchmark status">
        <section className="deck-performance" aria-label="Performance controls">
          <div className="wheel-park">
            <div className="wheel-well">
              <PitchStick bend={bend} onBend={applyBend} />
              <span aria-hidden="true" className="wheel-legend">PITCH</span>
            </div>
            <div className="wheel-well">
              <ModWheel mod={mod} onMod={applyMod} />
              <span aria-hidden="true" className="wheel-legend">MOD</span>
            </div>
            <div className="wheel-well octave-well">
              <div className="octave-buttons">
                <button
                  aria-label="Keyboard octave down, shortcut minus key"
                  disabled={octaveShift === 0}
                  onClick={() => shiftOctave(-1)}
                  type="button"
                >
                  &minus;
                </button>
                <button
                  aria-label="Keyboard octave up, shortcut equals key"
                  disabled={octaveShift === OCTAVE_SHIFT_MAX}
                  onClick={() => shiftOctave(1)}
                  type="button"
                >
                  +
                </button>
              </div>
              <span
                aria-label={`Keyboard octave shift ${octaveShift === 0 ? 'off' : `plus ${octaveShift}`}`}
                className="octave-leds"
                role="status"
              >
                {[0, 1, 2].map((step) => (
                  <i className={step === octaveShift ? 'is-on' : undefined} key={step} />
                ))}
              </span>
              <span aria-hidden="true" className="wheel-legend">OCTAVE</span>
            </div>
          </div>
          <div className="toy-branding" aria-hidden="true">
            <span className="brand-line">stagebench</span>
            <span className="brand-sub">TOY ACTION 48</span>
          </div>
        </section>

        <section className="deck-plate plate-benchmark" aria-label="Benchmark counters">
          <header className="plate-tab" aria-hidden="true">BENCHMARK</header>
          <div className="plate-body readout-body">
            <div className="panel-readout">
              <small>RUNS</small>
              <strong>{String(visibleRuns.length).padStart(2, '0')}</strong>
            </div>
            <div className="panel-readout">
              <small>ACTIVE</small>
              <strong>{String(activeCount).padStart(2, '0')}</strong>
            </div>
          </div>
        </section>

        <section className="deck-plate plate-program" aria-label="Program display">
          <header className="plate-tab" aria-hidden="true">
            PROGRAM
            <span className={`toy-led${activeNotes.size > 0 ? ' is-on' : ''}`} />
          </header>
          <div className="plate-body">
            <div className="oled-display">
              <span>{activeCount > 0 ? 'BENCHMARK RUNNING' : 'SYSTEM READY'}</span>
              <strong aria-live="polite">{activeNotes.size > 0 ? `PLAYING ${lastPlayed}` : lastPlayed ? `LAST NOTE ${lastPlayed}` : activeCount > 0 ? runningModel : 'SELECT MODEL'}</strong>
            </div>
          </div>
        </section>

        <section className="deck-plate plate-phases" aria-label="Benchmark phases">
          <header className="plate-tab" aria-hidden="true">PHASES</header>
          <ol className="stage-controls plate-body">
            {phaseNames.map((name, index) => (
              <li key={name}>
                <div className="knob" aria-hidden="true">
                  <i style={{ transform: `rotate(${knobAngles[index]}deg)` }} />
                </div>
                <span>0{index + 1}</span>
                <strong>{name}</strong>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="toy-keys">
        <div className="end-cheek left" aria-hidden="true" />
        <KeyboardRail activeNotes={activeNotes} octaveShift={octaveShift} onNoteOff={stopHeaderNote} onNoteOn={startHeaderNote} />
        <div className="end-cheek right" aria-hidden="true" />
      </div>
      <div className="toy-bottom-rail" aria-hidden="true" />
      <span className="toy-foot left" aria-hidden="true" />
      <span className="toy-foot right" aria-hidden="true" />
    </div>
  )
}
