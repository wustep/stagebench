import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { GLOBAL_UNITS, type ControlAction, type ControlSpec } from '../model/hardware'
import { legendOf } from '../model/legends'

export interface ControlProps {
  spec: ControlSpec
  value: number
  dispatch: (action: ControlAction) => void
  /** Global mode is on for this control's unit, so its settings apply to every layer. */
  global?: boolean
}

const LED_COUNT = 8

function sizeClass(spec: ControlSpec): string {
  return `size-${spec.size ?? 'sm'}`
}

function ledsLit(value: number, count: number): number {
  return Math.round(value * count)
}

/** Keyboard operation for continuous controls: arrows step, Page keys step coarsely, Home and End jump. */
const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowUp: 0.02,
  ArrowRight: 0.02,
  ArrowDown: -0.02,
  ArrowLeft: -0.02,
  PageUp: 0.1,
  PageDown: -0.1,
}

export function Control({ spec, value, dispatch, global }: ControlProps) {
  switch (spec.kind) {
    case 'button':
      return <ButtonControl spec={spec} value={value} dispatch={dispatch} global={global} />
    case 'cycle':
      return <CycleControl spec={spec} value={value} dispatch={dispatch} />
    case 'fader':
      return <FaderControl spec={spec} value={value} dispatch={dispatch} />
    case 'drawbar':
      return <DrawbarControl spec={spec} value={value} dispatch={dispatch} />
    case 'wheel':
      return <WheelControl spec={spec} value={value} dispatch={dispatch} />
    case 'pitch':
      return <PitchControl spec={spec} value={value} dispatch={dispatch} />
    case 'dial':
      return <KnobControl spec={spec} value={value} dispatch={dispatch} variant="dial" />
    case 'knob':
      return <KnobControl spec={spec} value={value} dispatch={dispatch} variant="knob" />
  }
}

/**
 * Pointer and keyboard operation shared by every continuous control.
 * Vertical drag is measured against the control's own height, so a fader moves over its full travel.
 */
function useContinuous(spec: ControlSpec, value: number, dispatch: ControlProps['dispatch']) {
  const drag = useRef<{ pointerId: number; startY: number; startValue: number; span: number } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.focus()
    const height = event.currentTarget.getBoundingClientRect().height
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startValue: value, span: height > 0 ? height : 120 }
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const next = active.startValue + (active.startY - event.clientY) / active.span
    dispatch({ type: 'set', id: spec.id, value: next })
  }

  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (spec.kind === 'pitch') {
      dispatch({ type: 'set', id: spec.id, value: 0.5 })
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Home') {
      event.preventDefault()
      dispatch({ type: 'set', id: spec.id, value: 0 })
    } else if (event.key === 'End') {
      event.preventDefault()
      dispatch({ type: 'set', id: spec.id, value: 1 })
    } else if (event.key in KEY_STEPS) {
      event.preventDefault()
      dispatch({ type: 'nudge', id: spec.id, delta: KEY_STEPS[event.key] })
    }
  }

  return { onPointerDown, onPointerMove, onPointerEnd, onKeyDown }
}

function sliderAria(spec: ControlSpec, value: number) {
  return {
    role: 'slider' as const,
    'aria-label': spec.label,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round(value * 100),
    'aria-valuetext': `${Math.round(value * 100)} percent`,
    tabIndex: 0,
  }
}

function KnobControl({ spec, value, dispatch, variant }: ControlProps & { variant: 'knob' | 'dial' }) {
  const handlers = useContinuous(spec, value, dispatch)
  const angle = -135 + value * 270
  return (
    <div className={`control knob${variant === 'dial' ? ' dial' : ''} ${sizeClass(spec)}`} id={spec.id} data-kind={spec.kind} {...sliderAria(spec, value)} {...handlers}>
      <div className="knob-face" style={{ transform: `rotate(${angle}deg)` } as CSSProperties}>
        <span className="knob-mark" />
      </div>
      <span className="legend" aria-hidden="true">{legendOf(spec.id, spec.label)}</span>
    </div>
  )
}

function FaderControl({ spec, value, dispatch }: ControlProps) {
  const handlers = useContinuous(spec, value, dispatch)
  const lit = ledsLit(value, LED_COUNT)
  return (
    <div className={`control fader ${sizeClass(spec)}`} id={spec.id} data-kind={spec.kind} {...sliderAria(spec, value)} {...handlers}>
      <div className="led-graph" aria-hidden="true">
        {Array.from({ length: LED_COUNT }, (_, index) => (
          <span key={index} className={`led ${index < lit ? 'lit' : ''}`} />
        ))}
      </div>
      <div className="fader-slot" aria-hidden="true">
        <span className="fader-cap" style={{ bottom: `${value * 100}%` }} />
      </div>
      <span className="legend" aria-hidden="true">{legendOf(spec.id, spec.label)}</span>
    </div>
  )
}

function DrawbarControl({ spec, value, dispatch }: ControlProps) {
  const handlers = useContinuous(spec, value, dispatch)
  const lit = ledsLit(value, LED_COUNT)
  return (
    <div className="control drawbar" id={spec.id} data-kind={spec.kind} {...sliderAria(spec, value)} {...handlers}>
      <div className="led-ladder" aria-hidden="true">
        {Array.from({ length: LED_COUNT }, (_, index) => (
          <span key={index} className={`led ${LED_COUNT - 1 - index < lit ? 'lit' : ''}`} />
        ))}
      </div>
      <div className="drawbar-slot" aria-hidden="true">
        <span className="drawbar-cap" style={{ bottom: `${value * 100}%` }} />
      </div>
      <span className="legend" aria-hidden="true">{legendOf(spec.id, spec.label)}</span>
    </div>
  )
}

function WheelControl({ spec, value, dispatch }: ControlProps) {
  const handlers = useContinuous(spec, value, dispatch)
  return (
    <div className={`control wheel ${sizeClass(spec)}`} id={spec.id} data-kind={spec.kind} {...sliderAria(spec, value)} {...handlers}>
      <div className="wheel-well" aria-hidden="true">
        <span className="wheel-grip" style={{ bottom: `${value * 100}%` }} />
      </div>
      <span className="legend" aria-hidden="true">{legendOf(spec.id, spec.label)}</span>
    </div>
  )
}

function PitchControl({ spec, value, dispatch }: ControlProps) {
  const handlers = useContinuous(spec, value, dispatch)
  return (
    <div className={`control pitch ${sizeClass(spec)}`} id={spec.id} data-kind={spec.kind} {...sliderAria(spec, value)} {...handlers}>
      <div className="pitch-well" aria-hidden="true">
        <span className="pitch-stick" style={{ bottom: `${value * 100}%` }} />
      </div>
      <span className="legend" aria-hidden="true">{legendOf(spec.id, spec.label)}</span>
    </div>
  )
}

function ButtonControl({ spec, value, dispatch, global }: ControlProps) {
  const pressed = value >= 0.5
  const globalCapable = spec.id in GLOBAL_UNITS
  return (
    <button
      type="button"
      id={spec.id}
      data-kind={spec.kind}
      data-global={global ? 'on' : undefined}
      className={`control button ${sizeClass(spec)} ${pressed ? 'lit' : ''}`}
      aria-label={spec.label}
      aria-pressed={pressed}
      aria-description={globalCapable ? 'Shift and press to apply this unit to all layers' : undefined}
      onClick={(event) =>
        dispatch(event.shiftKey && globalCapable ? { type: 'global', id: spec.id } : { type: 'toggle', id: spec.id, shiftKey: event.shiftKey })
      }
    >
      <span className="lamp" aria-hidden="true" />
      <span className="legend" aria-hidden="true">{legendOf(spec.id, spec.label)}</span>
      {global && <span className="global-badge" aria-hidden="true">Global</span>}
    </button>
  )
}

function CycleControl({ spec, value, dispatch }: ControlProps) {
  const steps = spec.steps ?? []
  const index = Math.min(steps.length - 1, Math.max(0, Math.round(value)))
  const current = steps[index] ?? ''
  return (
    <button
      type="button"
      id={spec.id}
      data-kind={spec.kind}
      data-step={index}
      className={`control cycle ${sizeClass(spec)}`}
      aria-label={spec.label}
      aria-describedby={`${spec.id}-value`}
      onClick={() => dispatch({ type: 'advance', id: spec.id })}
    >
      <span className="cycle-leds" aria-hidden="true">
        {steps.map((step, stepIndex) => (
          <span key={step} className={`led ${stepIndex === index ? 'lit' : ''}`} />
        ))}
      </span>
      <span className="legend" aria-hidden="true">{legendOf(spec.id, spec.label)}</span>
      <span id={`${spec.id}-value`} className="sr-only">
        {current}
      </span>
    </button>
  )
}
