import { memo, useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { getControl } from '../model/hardware'
import { PresentationStore, usePresentationToggle, usePresentationValue } from '../state/presentation'

/**
 * Decorative panel hardware widgets. Every widget is pointer- and
 * keyboard-operable, exposes role/name/value, and writes ONLY to the
 * presentation store — never to audio or canonical instrument state.
 */

interface ContinuousProps {
  store: PresentationStore
  id: string
  /** Extra class for sizing variants. */
  className?: string
}

function useContinuous(store: PresentationStore, id: string) {
  const control = getControl(id)
  const value = usePresentationValue(store, id)
  const min = control.min ?? 0
  const max = control.max ?? 127
  const range = max - min
  const dragState = useRef<{ pointerId: number; startY: number; startValue: number } | null>(null)

  const onKeyDown = (event: ReactKeyboardEvent) => {
    let next: number | null = null
    const step = Math.max(1, Math.round(range / 32))
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = value + step
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = value - step
    else if (event.key === 'PageUp') next = value + step * 4
    else if (event.key === 'PageDown') next = value - step * 4
    else if (event.key === 'Home') next = min
    else if (event.key === 'End') next = max
    if (next !== null) {
      event.preventDefault()
      store.setValue(id, next)
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragState.current = { pointerId: event.pointerId, startY: event.clientY, startValue: value }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    let deltaY = drag.startY - event.clientY
    // Drawbars are pulled out (toward the player, i.e. downward) to increase.
    if (control.type === 'drawbar') deltaY = -deltaY
    store.setValue(id, drag.startValue + (deltaY / 120) * range)
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId === event.pointerId) dragState.current = null
    if (control.springLoaded) store.setValue(id, control.initial ?? 0)
  }

  const sliderProps = {
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': control.label,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': value,
    'aria-orientation': 'vertical' as const,
    'data-control-id': id,
    'data-decorative': 'true',
    onKeyDown,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  }
  return { control, value, min, max, range, sliderProps }
}

export const Knob = memo(function Knob({ store, id, className }: ContinuousProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const angle = -135 + ((value - min) / range) * 270
  return (
    <div {...sliderProps} className={`knob ${className ?? ''}`}>
      <div className="knob-cap" style={{ transform: `rotate(${angle}deg)` }}>
        <div className="knob-index" />
      </div>
    </div>
  )
})

export const Encoder = memo(function Encoder({ store, id, className }: ContinuousProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const angle = ((value - min) / range) * 330
  return (
    <div {...sliderProps} className={`encoder ${className ?? ''}`}>
      <div className="encoder-cap" style={{ transform: `rotate(${angle}deg)` }}>
        <div className="knob-index" />
      </div>
    </div>
  )
})

export const Fader = memo(function Fader({ store, id, className }: ContinuousProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const travel = (1 - (value - min) / range) * 100
  return (
    <div {...sliderProps} className={`fader ${className ?? ''}`}>
      <div className="fader-track" />
      <div className="fader-cap" style={{ top: `calc(${travel}% - ${travel / 100} * var(--fader-cap-h))` }} />
    </div>
  )
})

export const Drawbar = memo(function Drawbar({ store, id, className }: ContinuousProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  // Drawbar pulled OUT (toward the player) = higher value = cap travels down.
  const travel = ((value - min) / range) * 100
  return (
    <div {...sliderProps} className={`drawbar ${className ?? ''}`}>
      <div className="drawbar-shaft" style={{ height: `${travel}%` }} />
      <div className="drawbar-cap" style={{ top: `calc(${travel}% - ${travel / 100} * var(--drawbar-cap-h))` }}>
        <span className="drawbar-line" />
      </div>
    </div>
  )
})

export const Wheel = memo(function Wheel({ store, id, className }: ContinuousProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const travel = (0.5 - (value - min) / range) * 40
  return (
    <div {...sliderProps} className={`wheel ${className ?? ''}`}>
      <div className="wheel-face" style={{ backgroundPosition: `50% calc(50% + ${travel}%)` }} />
    </div>
  )
})

export const PitchStick = memo(function PitchStick({ store, id, className }: ContinuousProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const tilt = ((value - min) / range - 0.5) * -36
  return (
    <div {...sliderProps} className={`pitch-stick ${className ?? ''}`}>
      <div className="pitch-stick-lever" style={{ transform: `rotate(${tilt}deg)` }} />
    </div>
  )
})

export interface PanelButtonProps {
  store: PresentationStore
  id: string
  className?: string
  /** Small legend printed on/next to the button. */
  children?: ReactNode
  led?: 'green' | 'red' | 'yellow' | 'none'
}

export const PanelButton = memo(function PanelButton({ store, id, className, children, led = 'none' }: PanelButtonProps) {
  const control = getControl(id)
  const lit = usePresentationToggle(store, id)
  const latching = control.latching === true
  return (
    <button
      type="button"
      className={`panel-button ${className ?? ''}`}
      data-control-id={id}
      data-decorative="true"
      aria-label={control.label}
      aria-pressed={latching ? lit : undefined}
      data-lit={latching && lit ? 'true' : undefined}
      onClick={() => store.toggle(id)}
    >
      {led !== 'none' && <span className={`btn-led led-${led}`} data-on={latching && lit ? 'true' : 'false'} aria-hidden="true" />}
      <span className="panel-button-cap" aria-hidden="true">{children}</span>
    </button>
  )
})

/* ------------------------------------------------------- passive detail -- */

export function Led({ color = 'green', on = false, className }: { color?: 'green' | 'red' | 'yellow'; on?: boolean; className?: string }) {
  return <span className={`led led-${color} ${className ?? ''}`} data-on={on ? 'true' : 'false'} aria-hidden="true" />
}

export function LedLadder({
  count = 10,
  lit = 0,
  color = 'green',
  fill = 'up',
  className,
}: {
  count?: number
  lit?: number
  color?: 'green' | 'red'
  /** 'up' lights from the bottom (level meters); 'down' from the top (drawbar amount). */
  fill?: 'up' | 'down'
  className?: string
}) {
  return (
    <span className={`led-ladder ${className ?? ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`led led-${color}`} data-on={(fill === 'up' ? i >= count - lit : i < lit) ? 'true' : 'false'} />
      ))}
    </span>
  )
}

export function Legend({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`legend ${className ?? ''}`}>{children}</span>
}

export function GroupBox({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`group-box ${className ?? ''}`} role="group" aria-label={title}>
      <span className="group-box-title" aria-hidden="true">{title}</span>
      {children}
    </div>
  )
}

export function Oled({ section, lines, className }: { section: 'program' | 'synth'; lines: ReactNode[]; className?: string }) {
  return (
    <div className={`oled ${className ?? ''}`} data-oled-section={section} data-testid={`oled-${section}`} role="img" aria-label={`${section === 'program' ? 'Program' : 'Synth'} display`}>
      {lines.map((line, i) => (
        <div key={i} className="oled-line">{line}</div>
      ))}
    </div>
  )
}
