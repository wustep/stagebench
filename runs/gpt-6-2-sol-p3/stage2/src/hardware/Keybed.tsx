import { useEffect, useRef } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import type { KeyState } from '../piano/notes'
import { keys, variant, whiteKeyCount } from './model'

interface KeybedProps {
  state: KeyState
  press(token: string, note: number, velocity: number): void
  release(token: string): void
  tap(note: number): void
}

const whiteWidth = 100 / whiteKeyCount
const voiceKeys = [' ', 'Enter']
const blackOffsets: Record<number, number> = { 1: -0.07, 3: 0.07, 6: -0.08, 8: 0, 10: 0.08 }

function keyNumber(target: Element | null) {
  const key = target?.closest<HTMLButtonElement>('.piano-key')
  return key ? Number(key.dataset.note) : undefined
}

function pointerVelocity(event: PointerEvent<HTMLDivElement>) {
  if (event.pointerType === 'pen' && event.pressure > 0) return Math.round(42 + event.pressure * 85)
  return 89
}

export function Keybed({ state, press, release, tap }: KeybedProps) {
  const pointerNotes = useRef(new Map<number, number>())

  useEffect(() => {
    const clear = () => pointerNotes.current.clear()
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('blur', clear)
      clear()
    }
  }, [])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pointerNotes.current.has(event.pointerId)) return
    const note = keyNumber(event.target instanceof Element ? event.target : null)
    if (note === undefined) return
    event.preventDefault()
    pointerNotes.current.set(event.pointerId, note)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    press(`pointer:${event.pointerId}`, note, pointerVelocity(event))
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointerNotes.current.has(event.pointerId)) return
    const hit = event.currentTarget.ownerDocument.elementFromPoint?.(event.clientX, event.clientY)
    const note = keyNumber(hit ?? null)
    if (note === undefined || note === pointerNotes.current.get(event.pointerId)) return
    const token = `pointer:${event.pointerId}`
    release(token)
    pointerNotes.current.set(event.pointerId, note)
    press(token, note, pointerVelocity(event))
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    if (pointerNotes.current.delete(event.pointerId)) release(`pointer:${event.pointerId}`)
  }

  function focusedKey(event: KeyboardEvent<HTMLButtonElement>, note: number, down: boolean) {
    if (!voiceKeys.includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const token = `focus:${note}:${event.key}`
    if (!down) release(token)
    else if (!event.repeat) press(token, note, 86)
  }

  return (
    <section className="keybed" data-keybed data-key-action={variant.action}
      aria-label="73 hammer-action keys, E1 through E7">
      <div className="keybed__well">
        <div className="keybed__keys" style={{ '--black-height': `${variant.blackHeight * 100}%` } as CSSProperties}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer}
          onPointerCancel={endPointer} onLostPointerCapture={endPointer}>
          {keys.map((key) => (
            <button
              key={key.id} id={key.id} type="button" className={`piano-key piano-key--${key.black ? 'black' : 'white'}`}
              data-control-id={key.id} data-control-kind="key" data-note={key.note} data-key={key.note}
              data-held={state.held.has(key.note)} data-sustained={state.sustained.has(key.note)}
              aria-label={key.label}
              style={{
                '--key-left': `${(key.whiteIndex + (key.black ? blackOffsets[key.note % 12] : 0)) * whiteWidth}%`,
                '--key-width': `${whiteWidth * (key.black ? 0.63 : 1)}%`,
              } as CSSProperties}
              onKeyDown={(event) => focusedKey(event, key.note, true)}
              onKeyUp={(event) => focusedKey(event, key.note, false)}
              onBlur={() => { for (const code of voiceKeys) release(`focus:${key.note}:${code}`) }}
              onClick={(event) => { if (event.detail === 0) tap(key.note) }}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
