import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { getControl } from '../model/hardware'
import {
  PresentationStore,
  usePresentationCycle,
  usePresentationPressed,
  usePresentationToggle,
  usePresentationValue,
} from '../state/presentation'

interface ControlProps {
  store: PresentationStore
  id: string
  className?: string
  children?: ReactNode
}

const STEP_KEYS = new Set(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End'])

function useContinuous(store: PresentationStore, id: string) {
  const control = getControl(id)
  const value = usePresentationValue(store, id)
  const min = control.min ?? 0
  const max = control.max ?? 127
  const range = Math.max(1, max - min)
  const drag = useRef<{ pointerId: number; lastX: number; lastY: number; value: number } | null>(null)

  const commit = (next: number) => store.setValue(id, next)

  const onKeyDown = (event: KeyboardEvent) => {
    const step = Math.max(1, Math.round(range / 32))
    let next: number | null = null
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = value + step
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = value - step
    else if (event.key === 'PageUp') next = value + step * 4
    else if (event.key === 'PageDown') next = value - step * 4
    else if (event.key === 'Home') next = min
    else if (event.key === 'End') next = max
    if (next === null) return
    event.preventDefault()
    commit(next)
  }

  const onKeyUp = control.springLoaded
    ? (event: KeyboardEvent) => {
        if (STEP_KEYS.has(event.key)) store.setValue(id, control.initial ?? 0)
      }
    : undefined

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (drag.current) return
    event.currentTarget.focus()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* jsdom */
    }
    drag.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, value }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    let delta = current.lastY - event.clientY
    if (control.type === 'drawbar') delta = -delta
    if (control.type === 'stick') delta = event.clientX - current.lastX
    current.lastX = event.clientX
    current.lastY = event.clientY
    const gain = event.shiftKey ? 0.25 : 1
    current.value = Math.min(max, Math.max(min, current.value + (delta / 200) * range * gain))
    commit(current.value)
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (control.springLoaded) store.setValue(id, control.initial ?? 0)
  }

  const latest = useRef({ value, range })
  useEffect(() => {
    latest.current = { value, range }
  })
  const wheelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || control.springLoaded) return undefined
      const onWheel = (event: WheelEvent) => {
        event.preventDefault()
        const step = event.shiftKey ? 1 : Math.max(1, Math.round(latest.current.range / 64))
        store.setValue(id, latest.current.value + -Math.sign(event.deltaY) * step)
      }
      node.addEventListener('wheel', onWheel, { passive: false })
      return () => node.removeEventListener('wheel', onWheel)
    },
    [control.springLoaded, id, store],
  )

  const sliderProps = {
    ref: wheelRef,
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': control.label,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': value,
    'aria-orientation': (control.type === 'stick' ? 'horizontal' : 'vertical') as 'horizontal' | 'vertical',
    'data-control-id': id,
    'data-panel-control': 'true',
    'data-decorative': 'true',
    'data-type': control.type,
    onKeyDown,
    onKeyUp,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  }
  return { control, value, min, max, range, sliderProps }
}

export function Knob({ store, id, className, children }: ControlProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const angle = -135 + ((value - min) / range) * 270
  return (
    <div {...sliderProps} className={`knob ${className ?? ''}`}>
      <div className="knob-cap" style={{ transform: `rotate(${angle}deg)` }}>
        <span className="knob-index" />
      </div>
      {children ? <span className="legend" aria-hidden="true">{children}</span> : null}
    </div>
  )
}

export function Encoder({ store, id, className, children }: ControlProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const angle = ((value - min) / range) * 300
  return (
    <div {...sliderProps} className={`encoder ${className ?? ''}`}>
      <div className="encoder-cap" style={{ transform: `rotate(${angle}deg)` }} />
      {children ? <span className="legend" aria-hidden="true">{children}</span> : null}
    </div>
  )
}

export function Fader({ store, id, className, children }: ControlProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const norm = (value - min) / range
  const lit = Math.round(norm * 8)
  return (
    <div {...sliderProps} className={`fader ${className ?? ''}`}>
      <span className="led-ladder" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <i key={index} className={index >= 8 - lit ? 'on' : ''} />
        ))}
      </span>
      <span className="fader-track">
        <span className="fader-cap" style={{ top: `${(1 - norm) * 78}%` }} />
      </span>
      {children ? <span className="legend" aria-hidden="true">{children}</span> : null}
    </div>
  )
}

export function Drawbar({ store, id, className, color = 'white', children }: ControlProps & { color?: string }) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const norm = (value - min) / range
  const lit = Math.round(norm * 8)
  return (
    <div {...sliderProps} className={`drawbar drawbar-${color} ${className ?? ''}`}>
      <span className="drawbar-leds" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <i key={index} className={index >= 8 - lit ? 'on' : ''} />
        ))}
      </span>
      <span className="drawbar-slot">
        <span className="drawbar-cap" style={{ top: `${6 + norm * 72}%` }} />
      </span>
      {children ? <span className="legend" aria-hidden="true">{children}</span> : null}
    </div>
  )
}

export function Wheel({ store, id, className }: ControlProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const norm = (value - min) / range
  return (
    <div {...sliderProps} className={`mod-wheel ${className ?? ''}`}>
      <span className="wheel-well" aria-hidden="true">
        <span className="wheel-rubber" style={{ backgroundPositionY: `${40 - norm * 70}%` }}>
          <span className="wheel-notch" style={{ top: `${78 - norm * 58}%` }} />
        </span>
      </span>
    </div>
  )
}

export function PitchStick({ store, id, className }: ControlProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const travel = ((value - min) / range - 0.5) * 42
  return (
    <div {...sliderProps} className={`pitch-stick ${className ?? ''}`}>
      <span className="stick-well" aria-hidden="true">
        <span className="stick-lever" style={{ transform: `translateX(${travel}%)` }} />
      </span>
    </div>
  )
}

export function PanelButton({ store, id, className, children }: ControlProps) {
  const control = getControl(id)
  const lit = usePresentationToggle(store, id)
  const pressed = usePresentationPressed(store, id)
  const cycleIndex = usePresentationCycle(store, id)
  const latching = control.latching === true
  const cycleLabels = control.cycleLabels
  const fromKeyboard = useRef(false)

  const activate = () => {
    if (cycleLabels && cycleLabels.length > 0) store.cycle(id)
    else if (latching) store.toggle(id)
  }

  return (
    <button
      type="button"
      className={`panel-button ${className ?? ''} ${lit ? 'is-lit' : ''} ${pressed ? 'is-pressed' : ''}`}
      aria-label={control.label}
      aria-pressed={latching ? lit : pressed}
      data-control-id={id}
      data-panel-control="true"
      data-decorative="true"
      data-cycle={cycleLabels ? cycleIndex : undefined}
      onPointerDown={(event) => {
        event.preventDefault()
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          /* jsdom */
        }
        store.press(id)
      }}
      onPointerUp={() => store.release(id)}
      onPointerCancel={() => store.release(id)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (!event.repeat) store.press(id)
      }}
      onKeyUp={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        fromKeyboard.current = true
        store.release(id)
        activate()
      }}
      onClick={() => {
        if (fromKeyboard.current) {
          fromKeyboard.current = false
          return
        }
        activate()
      }}
      onBlur={() => store.release(id)}
    >
      <span className={`btn-led ${lit ? 'on' : ''}`} aria-hidden="true" />
      <span className="btn-face">{children}</span>
    </button>
  )
}

export function CycleLeds({ store, id, className }: { store: PresentationStore; id: string; className?: string }) {
  const control = getControl(id)
  const index = usePresentationCycle(store, id)
  const labels = control.cycleLabels ?? []
  return (
    <span className={`cycle-leds ${className ?? ''}`} aria-hidden="true">
      {labels.map((label, led) => (
        <i key={label} data-on={led === index ? 'true' : 'false'} title={label}>
          <em>{label}</em>
        </i>
      ))}
    </span>
  )
}
