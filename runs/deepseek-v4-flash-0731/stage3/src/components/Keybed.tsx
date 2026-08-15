import { useRef } from 'react'
import { useSyncExternalStore } from 'react'
import { getKeys } from '../hardware/instrument'
import type { NoteLifecycle } from '../piano/lifecycle'
import type { KeySpec } from '../hardware/types'

interface KeybedProps {
  lifecycle: NoteLifecycle
  /** presentation only: how white keys/black keys are labelled (none in phase 1). */
}

/**
 * The 73-key bed. Each key binds pointer + touch through the shared note
 * lifecycle so independent fingers and a mouse produce independent presses.
 * Pressed state is derived from the lifecycle's active press set — a key
 * "depresses" for exactly as long as at least one source holds it.
 */
export function Keybed({ lifecycle }: KeybedProps) {
  const version = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshotVersion)
  const pressed = new Set(lifecycle.activeMidis)
  const keys = getKeys()
  void version

  return (
    <div className="keybed" role="group" aria-label="73-key piano keybed (E1 to E7)">
      {/* white keys as base layer */}
      <div className="keys-white">
        {keys.filter((key) => !key.isBlack).map((key) => (
          <KeyView key={key.id} keySpec={key} lifecycle={lifecycle} pressed={pressed.has(key.midi)} />
        ))}
      </div>
      {/* black keys on top */}
      <div className="keys-black">
        {keys.filter((key) => key.isBlack).map((key) => (
          <KeyView key={key.id} keySpec={key} lifecycle={lifecycle} pressed={pressed.has(key.midi)} />
        ))}
      </div>
    </div>
  )
}

function KeyView({ keySpec, lifecycle, pressed }: { keySpec: KeySpec; lifecycle: NoteLifecycle; pressed: boolean }) {
  const pointerRef = useRef<Set<number>>(new Set())
  // stable per-key source so clearSource / multi-touch share one counter
  const source = `key-${keySpec.midi}`

  const onPointerDown = (midi: number) => (event: React.PointerEvent) => {
    event.preventDefault()
    const el = event.currentTarget as HTMLElement & { setPointerCapture?: (id: number) => void }
    if (el.setPointerCapture) el.setPointerCapture(event.pointerId)
    pointerRef.current.add(event.pointerId)
    // first pointer on this key starts the note; others (multi-touch) share the
    // key's source counter so the note only stops after the last lifts.
    if (pointerRef.current.size === 1) lifecycle.noteOn(midi, 0.85, source)
  }

  const onPointerUp = (midi: number) => (event: React.PointerEvent) => {
    const count = pointerRef.current.size
    pointerRef.current.delete(event.pointerId)
    if (count === 1) lifecycle.noteOff(midi, source)
  }

  const onPointerCancel = () => () => {
    pointerRef.current.clear()
    lifecycle.clearSource(source)
  }
  const className = `key ${keySpec.isBlack ? 'key-black' : 'key-white'} ${pressed ? 'pressed' : ''}`
  const style: React.CSSProperties = { left: `${keySpec.x * 100}%`, width: `${keySpec.width * 100}%` }

  return (
    <div
      className={className}
      style={style}
      data-midi={keySpec.midi}
      role="button"
      aria-label={`Key ${keySpec.name} (MIDI ${keySpec.midi})`}
      aria-pressed={pressed}
      tabIndex={0}
      onPointerDown={onPointerDown(keySpec.midi)}
      onPointerUp={onPointerUp(keySpec.midi)}
      onPointerCancel={onPointerCancel()}
    >
      <span className="key-label" aria-hidden="true">{keySpec.name}</span>
    </div>
  )
}