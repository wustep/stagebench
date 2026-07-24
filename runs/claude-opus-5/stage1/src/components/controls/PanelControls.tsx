import {
  useCallback,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useControl, type ControlHandle } from '../../state/HardwareContext'

/**
 * Every control in this file is decorative in Phase 1: it moves, lights, exposes its value to
 * assistive technology, and changes nothing else. `data-functional="false"` marks that claim in
 * the DOM so it can be inspected and asserted rather than merely promised in prose.
 */

/* ------------------------------------------------------------------ shared behaviour */

const DRAG_RANGE_PX = 140

function useSliderBehaviour(handle: ControlHandle, invert = false) {
  const dragRef = useRef<{ pointerId: number; startY: number; startValue: number } | null>(null)
  const { spec, set, value } = handle

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      event.currentTarget.focus()
      dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startValue: value }
      event.preventDefault()
    },
    [value],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const travel = (drag.startY - event.clientY) / DRAG_RANGE_PX
      const delta = travel * (spec.max - spec.min) * (invert ? -1 : 1)
      set(drag.startValue + delta)
    },
    [invert, set, spec.max, spec.min],
  )

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }, [])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const big = (spec.max - spec.min) / 10
      switch (event.key) {
        case 'ArrowUp':
        case 'ArrowRight':
          handle.nudge(1)
          break
        case 'ArrowDown':
        case 'ArrowLeft':
          handle.nudge(-1)
          break
        case 'PageUp':
          set(value + big)
          break
        case 'PageDown':
          set(value - big)
          break
        case 'Home':
          set(spec.min)
          break
        case 'End':
          set(spec.max)
          break
        default:
          return
      }
      event.preventDefault()
      event.stopPropagation()
    },
    [handle, set, spec.max, spec.min, value],
  )

  return {
    sliderProps: {
      role: 'slider' as const,
      tabIndex: 0,
      'aria-label': spec.name,
      'aria-valuemin': spec.min,
      'aria-valuemax': spec.max,
      'aria-valuenow': value,
      'aria-valuetext': handle.valueText,
      'data-control-id': spec.id,
      'data-functional': 'false',
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
    },
  }
}

/* ------------------------------------------------------------------ indicators */

export type LedColor = 'red' | 'green' | 'amber'

export function Led({ on = false, color = 'red', shape = 'round' }: { on?: boolean; color?: LedColor; shape?: 'round' | 'square' }) {
  return <span aria-hidden="true" className={`led led--${color} led--${shape}`} data-on={on ? 'true' : 'false'} />
}

export function LedLabel({
  label,
  on = false,
  color = 'red',
  side = 'right',
}: {
  label: ReactNode
  on?: boolean
  color?: LedColor
  side?: 'left' | 'right'
}) {
  return (
    <span className={`led-label led-label--${side}`}>
      {side === 'right' ? (
        <>
          <Led on={on} color={color} />
          <span className="legend">{label}</span>
        </>
      ) : (
        <>
          <span className="legend">{label}</span>
          <Led on={on} color={color} />
        </>
      )}
    </span>
  )
}

/** The green level graph printed beside every layer fader and drawbar. */
export function LedLadder({ steps = 12, level = 0, color = 'green', numbered }: { steps?: number; level?: number; color?: LedColor; numbered?: boolean }) {
  const lit = Math.round(level * steps)
  return (
    <span aria-hidden="true" className="ladder">
      {Array.from({ length: steps }, (_, index) => {
        const fromTop = steps - index
        return (
          <span key={index} className="ladder__row">
            {numbered ? <span className="ladder__num">{fromTop <= 8 ? fromTop : ''}</span> : null}
            <span className={`ladder__cell ladder__cell--${color}`} data-on={fromTop <= lit ? 'true' : 'false'} />
          </span>
        )
      })}
    </span>
  )
}

/** Printed silk-screen text. */
export function Legend({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`legend ${className}`.trim()}>{children}</span>
}

/* ------------------------------------------------------------------ buttons */

export type ButtonVariant = 'dark' | 'light' | 'red' | 'wide'

export function PanelButton({
  id,
  variant = 'dark',
  className = '',
}: {
  id: string
  variant?: ButtonVariant
  className?: string
}) {
  const handle = useControl(id)
  const { spec, value } = handle
  const pressedRef = useRef(false)

  const isToggle = Boolean(spec.toggle)
  const label = spec.options ? `${spec.name}: ${handle.valueText}` : spec.name

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    pressedRef.current = true
    event.currentTarget.dataset.pressed = 'true'
  }, [])

  const release = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    pressedRef.current = false
    event.currentTarget.dataset.pressed = 'false'
  }, [])

  return (
    <button
      type="button"
      className={`pbtn pbtn--${variant} ${className}`.trim()}
      aria-label={label}
      aria-pressed={isToggle ? value >= 0.5 : undefined}
      data-control-id={spec.id}
      data-functional="false"
      data-value={handle.valueText}
      onClick={handle.activate}
      onPointerDown={onPointerDown}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      <span aria-hidden="true" className="pbtn__cap" />
    </button>
  )
}

/* ------------------------------------------------------------------ knob */

const KNOB_SWEEP = 270

export function Knob({
  id,
  size = 'md',
  ticks,
  caption,
  className = '',
}: {
  id: string
  size?: 'sm' | 'md' | 'lg'
  /** Printed index ring, drawn around the knob exactly like the reference silk screen. */
  ticks?: readonly string[]
  caption?: ReactNode
  className?: string
}) {
  const handle = useControl(id)
  const { sliderProps } = useSliderBehaviour(handle)
  const angle = -KNOB_SWEEP / 2 + handle.position * KNOB_SWEEP

  return (
    <span className={`knob-wrap knob-wrap--${size} ${className}`.trim()}>
      <span aria-hidden="true" className="knob-ring">
        {ticks?.map((tick, index) => {
          const tickAngle = -KNOB_SWEEP / 2 + (index / Math.max(1, ticks.length - 1)) * KNOB_SWEEP
          const style = { '--tick-angle': `${tickAngle}deg` } as CSSProperties
          return (
            <span key={`${tick}-${index}`} className="knob-ring__tick" style={style}>
              <span className="knob-ring__text">{tick}</span>
            </span>
          )
        })}
      </span>
      <span {...sliderProps} className="knob" style={{ '--knob-angle': `${angle}deg` } as CSSProperties}>
        <span aria-hidden="true" className="knob__pointer" />
      </span>
      {caption ? <span className="control-caption">{caption}</span> : null}
    </span>
  )
}

/* ------------------------------------------------------------------ endless dial */

export function Encoder({ id, size = 'md', caption }: { id: string; size?: 'sm' | 'md' | 'lg'; caption?: ReactNode }) {
  const handle = useControl(id)
  const { spec, value } = handle
  const dragRef = useRef<{ pointerId: number; startY: number; startValue: number } | null>(null)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      event.currentTarget.focus()
      dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startValue: value }
      event.preventDefault()
    },
    [value],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const steps = Math.round((drag.startY - event.clientY) / 12)
      handle.set(drag.startValue + steps * spec.step)
    },
    [handle, spec.step],
  )

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }, [])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') handle.nudge(1)
      else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') handle.nudge(-1)
      else return
      event.preventDefault()
      event.stopPropagation()
    },
    [handle],
  )

  return (
    <span className={`dial-wrap dial-wrap--${size}`}>
      <span
        role="spinbutton"
        tabIndex={0}
        aria-label={spec.name}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value}
        aria-valuetext={handle.valueText}
        data-control-id={spec.id}
        data-functional="false"
        className="dial"
        style={{ '--knob-angle': `${value * 24}deg` } as CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <span aria-hidden="true" className="dial__grip" />
      </span>
      {caption ? <span className="control-caption">{caption}</span> : null}
    </span>
  )
}

/* ------------------------------------------------------------------ faders and drawbars */

export function Fader({ id, ladderSteps = 12 }: { id: string; ladderSteps?: number }) {
  const handle = useControl(id)
  const { sliderProps } = useSliderBehaviour(handle)
  return (
    <span className="fader-wrap">
      <span {...sliderProps} aria-orientation="vertical" className="fader">
        <span aria-hidden="true" className="fader__slot" />
        <span aria-hidden="true" className="fader__cap" style={{ bottom: `${handle.position * 74}%` }} />
      </span>
      <LedLadder steps={ladderSteps} level={handle.position} />
    </span>
  )
}

export function Drawbar({ id, upper, lower, footage }: { id: string; upper: string; lower: string; footage: string }) {
  const handle = useControl(id)
  const { sliderProps } = useSliderBehaviour(handle, true)
  const pulled = handle.position
  return (
    <span className="drawbar-wrap">
      <span aria-hidden="true" className="drawbar__caption">
        <span className="drawbar__upper">{upper}</span>
        <span className="drawbar__lower">{lower}</span>
      </span>
      <span className="drawbar__body">
        <span {...sliderProps} aria-orientation="vertical" className="drawbar">
          <span aria-hidden="true" className="drawbar__slot" />
          <span
            aria-hidden="true"
            className={`drawbar__grip drawbar__grip--${Number(id.slice(-1)) % 2 === 0 ? 'white' : 'dark'}`}
            style={{ top: `${pulled * 62}%` }}
          />
        </span>
        <span aria-hidden="true" className="drawbar__ladder">
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} className="drawbar__ladder-row">
              <span className="drawbar__ladder-num">{index + 1}</span>
              <span className="drawbar__ladder-cell" data-on={index + 1 <= Math.round(pulled * 8) ? 'true' : 'false'} />
            </span>
          ))}
        </span>
      </span>
      <span aria-hidden="true" className="drawbar__footage">
        {footage}
      </span>
    </span>
  )
}

/* ------------------------------------------------------------------ wheels */

export function ModWheel({ id }: { id: string }) {
  const handle = useControl(id)
  const { sliderProps } = useSliderBehaviour(handle)
  return (
    <span {...sliderProps} aria-orientation="vertical" className="modwheel">
      <span aria-hidden="true" className="modwheel__body" style={{ '--wheel-pos': handle.position } as CSSProperties} />
    </span>
  )
}

export function PitchStick({ id }: { id: string }) {
  const handle = useControl(id)
  const dragRef = useRef<number | null>(null)
  const { spec, value } = handle

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.focus()
    dragRef.current = event.clientX
    event.preventDefault()
  }, [])

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (dragRef.current === null) return
      handle.set((event.clientX - dragRef.current) / 60)
    },
    [handle],
  )

  // A real pitch stick is spring loaded: it snaps back to centre when released.
  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (dragRef.current === null) return
      dragRef.current = null
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      handle.set(0)
    },
    [handle],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'ArrowRight') handle.nudge(1)
      else if (event.key === 'ArrowLeft') handle.nudge(-1)
      else if (event.key === 'Home' || event.key === 'End') handle.set(0)
      else return
      event.preventDefault()
      event.stopPropagation()
    },
    [handle],
  )

  return (
    <span
      role="slider"
      tabIndex={0}
      aria-label={spec.name}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      aria-valuenow={value}
      aria-valuetext={value === 0 ? 'Centre' : value > 0 ? `Up ${value.toFixed(2)}` : `Down ${Math.abs(value).toFixed(2)}`}
      data-control-id={spec.id}
      data-functional="false"
      className="pitchstick"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true" className="pitchstick__wood" style={{ '--stick-pos': value } as CSSProperties} />
    </span>
  )
}

/* ------------------------------------------------------------------ selector pads */

/**
 * The arrow LED cluster printed between two label columns (Organ Model, Piano Select, Mod type,
 * Reverb type…). Purely an indicator: the adjacent button does the cycling.
 */
export function SelectorPad({ count, active, rows = 3 }: { count: number; active: number; rows?: number }) {
  return (
    <span aria-hidden="true" className="selpad">
      {Array.from({ length: rows }, (_, row) => (
        <span key={row} className="selpad__row">
          <span className="selpad__arrow selpad__arrow--left" data-on={active === row ? 'true' : 'false'} />
          <span
            className="selpad__arrow selpad__arrow--right"
            data-on={active === row + rows && active < count ? 'true' : 'false'}
          />
        </span>
      ))}
    </span>
  )
}

/* ------------------------------------------------------------------ groups */

export function Group({
  title,
  children,
  className = '',
  bordered = true,
}: {
  title?: ReactNode
  children: ReactNode
  className?: string
  bordered?: boolean
}) {
  return (
    <section className={`group ${bordered ? 'group--bordered' : ''} ${className}`.trim()} aria-label={typeof title === 'string' ? title : undefined}>
      {title ? <h3 className="group__title">{title}</h3> : null}
      <div className="group__body">{children}</div>
    </section>
  )
}

export const KNOB_TICKS_0_10 = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] as const
