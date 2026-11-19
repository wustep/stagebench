import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { PANEL_CONTROL_BY_ID } from '../model/controls'
import { formatControlValueText, type HardwareAction, type HardwarePresentationState } from '../model/hardwareState'

export interface SectionProps {
  readonly state: HardwarePresentationState
  readonly dispatch: (action: HardwareAction) => void
}

export function LedDot({
  on,
  color = 'red',
  size = 'sm',
}: {
  readonly on: boolean
  readonly color?: 'red' | 'green' | 'amber'
  readonly size?: 'xs' | 'sm'
}) {
  return (
    <span
      className={`ns4-led ns4-led-${size} ${on ? `ns4-led-${color}-on` : 'ns4-led-off'}`}
      aria-hidden="true"
    />
  )
}

function handleSliderKeyDown(
  e: KeyboardEvent<HTMLElement>,
  id: string,
  min: number,
  max: number,
  dispatch: (action: HardwareAction) => void,
) {
  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowRight':
      e.preventDefault()
      e.stopPropagation()
      dispatch({ type: 'step', id, delta: 1 })
      break
    case 'ArrowDown':
    case 'ArrowLeft':
      e.preventDefault()
      e.stopPropagation()
      dispatch({ type: 'step', id, delta: -1 })
      break
    case 'PageUp':
      e.preventDefault()
      e.stopPropagation()
      dispatch({ type: 'step', id, delta: 5 })
      break
    case 'PageDown':
      e.preventDefault()
      e.stopPropagation()
      dispatch({ type: 'step', id, delta: -5 })
      break
    case 'Home':
      e.preventDefault()
      e.stopPropagation()
      dispatch({ type: 'set', id, value: min })
      break
    case 'End':
      e.preventDefault()
      e.stopPropagation()
      dispatch({ type: 'set', id, value: max })
      break
  }
}

export function HardwareKnob({
  id,
  state,
  dispatch,
  size = 'md',
  variant = 'knob',
  label,
  subLabel,
  className = '',
}: {
  readonly id: string
  readonly state: HardwarePresentationState
  readonly dispatch: (action: HardwareAction) => void
  readonly size?: 'sm' | 'md' | 'lg'
  readonly variant?: 'knob' | 'encoder' | 'red-ring'
  readonly label?: string
  readonly subLabel?: string
  readonly className?: string
}) {
  const spec = PANEL_CONTROL_BY_ID[id]
  const value = state[id] ?? spec.defaultValue
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null)

  const norm = (value - spec.min) / Math.max(1, spec.max - spec.min)
  const angleDeg = -135 + norm * 270

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { startY: e.clientY, startVal: value }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const dy = dragRef.current.startY - e.clientY
    const range = spec.max - spec.min
    const nextVal = dragRef.current.startVal + (dy / 90) * range
    dispatch({ type: 'set', id, value: nextVal })
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const moved = Math.abs(dragRef.current.startY - e.clientY)
    dragRef.current = null
    if (moved < 3) {
      dispatch({ type: 'step', id, delta: 2 })
    }
  }

  return (
    <div className={`ns4-knob-wrap ns4-knob-${size} ${className}`}>
      <div
        id={spec.id}
        data-control-id={spec.id}
        data-control-kind={spec.kind}
        data-section-id={spec.section}
        role="slider"
        tabIndex={0}
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value}
        aria-valuetext={formatControlValueText(spec, value)}
        className={`ns4-knob-cap ns4-knob-cap-${size} ns4-knob-variant-${variant}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null
        }}
        onKeyDown={(e) => handleSliderKeyDown(e, spec.id, spec.min, spec.max, dispatch)}
      >
        <span className="ns4-knob-ring" aria-hidden="true" />
        <span
          className="ns4-knob-rotor"
          style={{ transform: `rotate(${angleDeg}deg)` }}
          aria-hidden="true"
        >
          <span className="ns4-knob-pointer" />
        </span>
      </div>
      {label ? <span className="ns4-legend">{label}</span> : null}
      {subLabel ? <span className="ns4-legend-sub">{subLabel}</span> : null}
    </div>
  )
}

export function HardwareButton({
  id,
  state,
  dispatch,
  variant = 'dark',
  size = 'md',
  className = '',
  children,
}: {
  readonly id: string
  readonly state: HardwarePresentationState
  readonly dispatch: (action: HardwareAction) => void
  readonly variant?: 'dark' | 'light' | 'red' | 'tall-light' | 'tall-dark' | 'red-frame'
  readonly size?: 'xs' | 'sm' | 'md' | 'wide'
  readonly className?: string
  readonly children?: React.ReactNode
}) {
  const spec = PANEL_CONTROL_BY_ID[id]
  const value = state[id] ?? spec.defaultValue
  const isBinary = !spec.options && spec.max === 1 && spec.min === 0
  const active = value > 0
  const valText = formatControlValueText(spec, value)

  return (
    <button
      type="button"
      id={spec.id}
      data-control-id={spec.id}
      data-control-kind={spec.kind}
      data-section-id={spec.section}
      data-control-value={value}
      aria-label={spec.options ? `${spec.label}: ${valText}` : spec.label}
      aria-pressed={isBinary ? active : undefined}
      className={`ns4-btn ns4-btn-${variant} ns4-btn-${size} ${active ? 'is-active' : ''} ${className}`}
      onClick={(e) => {
        e.stopPropagation()
        dispatch({ type: 'activate', id: spec.id })
      }}
    >
      {children}
    </button>
  )
}

export function HardwareFader({
  id,
  state,
  dispatch,
  layerLetter,
}: {
  readonly id: string
  readonly state: HardwarePresentationState
  readonly dispatch: (action: HardwareAction) => void
  readonly layerLetter: string
}) {
  const spec = PANEL_CONTROL_BY_ID[id]
  const value = state[id] ?? spec.defaultValue
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)

  const norm = (value - spec.min) / Math.max(1, spec.max - spec.min)
  const litSegments = Math.round(norm * 10)

  const updateFromClientY = (clientY: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0) return
    const frac = 1 - (clientY - rect.top) / rect.height
    const next = spec.min + frac * (spec.max - spec.min)
    dispatch({ type: 'set', id: spec.id, value: next })
  }

  return (
    <div className="ns4-fader-unit">
      <div className="ns4-fader-body">
        <div
          ref={trackRef}
          id={spec.id}
          data-control-id={spec.id}
          data-control-kind={spec.kind}
          data-section-id={spec.section}
          role="slider"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={spec.label}
          aria-valuemin={spec.min}
          aria-valuemax={spec.max}
          aria-valuenow={value}
          aria-valuetext={formatControlValueText(spec, value)}
          className="ns4-fader-track"
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            e.currentTarget.focus()
            e.currentTarget.setPointerCapture?.(e.pointerId)
            draggingRef.current = true
            updateFromClientY(e.clientY)
          }}
          onPointerMove={(e) => {
            if (!draggingRef.current) return
            updateFromClientY(e.clientY)
          }}
          onPointerUp={() => {
            draggingRef.current = false
          }}
          onPointerCancel={() => {
            draggingRef.current = false
          }}
          onKeyDown={(e) => handleSliderKeyDown(e, spec.id, spec.min, spec.max, dispatch)}
        >
          <span className="ns4-fader-slot" aria-hidden="true" />
          <span
            className="ns4-fader-cap"
            style={{ bottom: `${Math.max(4, Math.min(84, norm * 80 + 4))}%` }}
            aria-hidden="true"
          />
        </div>
        <div className="ns4-led-ladder-green" aria-hidden="true">
          {Array.from({ length: 10 }, (_, idx) => {
            const segNum = 10 - idx
            return (
              <span
                key={segNum}
                className={`ns4-ladder-seg-g ${segNum <= litSegments ? 'is-lit' : ''}`}
              />
            )
          })}
        </div>
      </div>
      <span className="ns4-fader-letter">{layerLetter}</span>
    </div>
  )
}

export function HardwareDrawbar({
  id,
  state,
  dispatch,
  topLabel,
}: {
  readonly id: string
  readonly state: HardwarePresentationState
  readonly dispatch: (action: HardwareAction) => void
  readonly topLabel: string
}) {
  const spec = PANEL_CONTROL_BY_ID[id]
  const value = state[id] ?? spec.defaultValue
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)

  // Drawbars pull DOWN from 0 (top) to 8 (bottom)
  const norm = value / 8

  const updateFromClientY = (clientY: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0) return
    const frac = (clientY - rect.top) / rect.height
    dispatch({ type: 'set', id: spec.id, value: frac * 8 })
  }

  return (
    <div className="ns4-drawbar-col">
      <span className="ns4-drawbar-top">{topLabel}</span>
      <div className="ns4-drawbar-upper">
        <div className="ns4-drawbar-scale" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
        <div className="ns4-drawbar-leds" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <span key={n} className={`ns4-drawbar-led ${n <= value ? 'is-lit' : ''}`} />
          ))}
        </div>
      </div>
      <div
        ref={trackRef}
        id={spec.id}
        data-control-id={spec.id}
        data-control-kind="drawbar"
        data-section-id="organ"
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={spec.label}
        aria-valuemin={0}
        aria-valuemax={8}
        aria-valuenow={value}
        aria-valuetext={`${value} / 8`}
        className="ns4-drawbar-track"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.focus()
          e.currentTarget.setPointerCapture?.(e.pointerId)
          draggingRef.current = true
          updateFromClientY(e.clientY)
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return
          updateFromClientY(e.clientY)
        }}
        onPointerUp={() => {
          draggingRef.current = false
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
        onKeyDown={(e) => handleSliderKeyDown(e, spec.id, 0, 8, dispatch)}
      >
        <span className="ns4-drawbar-slot" aria-hidden="true" />
        <span
          className={`ns4-drawbar-handle ${spec.capColor === 'white' ? 'is-white' : 'is-black'}`}
          style={{ top: `${Math.max(4, Math.min(62, norm * 58 + 4))}%` }}
          aria-hidden="true"
        />
      </div>
      <span className="ns4-drawbar-foot">{spec.shortLabel}</span>
    </div>
  )
}

export function HardwarePitchStick({ state, dispatch }: SectionProps) {
  const spec = PANEL_CONTROL_BY_ID['perf-pitch-stick']
  const value = state[spec.id] ?? 0
  const dragRef = useRef<{ startX: number; startVal: number } | null>(null)

  const shiftPx = (value / 100) * 8

  return (
    <div
      id={spec.id}
      data-control-id={spec.id}
      data-control-kind="wheel"
      data-section-id="performance"
      role="slider"
      tabIndex={0}
      aria-label={spec.label}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      aria-valuenow={value}
      aria-valuetext={formatControlValueText(spec, value)}
      className="ns4-pitch-stick-well"
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        dragRef.current = { startX: e.clientX, startVal: value }
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return
        const dx = e.clientX - dragRef.current.startX
        dispatch({ type: 'set', id: spec.id, value: dragRef.current.startVal + dx * 4 })
      }}
      onPointerUp={() => {
        if (!dragRef.current) return
        dragRef.current = null
        // Authentic pitch stick springs back to center on pointer release
        dispatch({ type: 'set', id: spec.id, value: 0 })
      }}
      onPointerCancel={() => {
        dragRef.current = null
        dispatch({ type: 'set', id: spec.id, value: 0 })
      }}
      onKeyDown={(e) => handleSliderKeyDown(e, spec.id, spec.min, spec.max, dispatch)}
    >
      <span
        className="ns4-pitch-stick-wood"
        style={{ transform: `translateX(${shiftPx}px)` }}
        aria-hidden="true"
      />
    </div>
  )
}

export function HardwareModWheel({ state, dispatch }: SectionProps) {
  const spec = PANEL_CONTROL_BY_ID['perf-mod-wheel']
  const value = state[spec.id] ?? 0
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)

  const updateFromClientY = (clientY: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0) return
    const frac = 1 - (clientY - rect.top) / rect.height
    dispatch({ type: 'set', id: spec.id, value: frac * 100 })
  }

  return (
    <div
      ref={trackRef}
      id={spec.id}
      data-control-id={spec.id}
      data-control-kind="wheel"
      data-section-id="performance"
      role="slider"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={spec.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value}%`}
      className="ns4-mod-wheel-well"
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        draggingRef.current = true
        updateFromClientY(e.clientY)
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current) return
        updateFromClientY(e.clientY)
      }}
      onPointerUp={() => {
        draggingRef.current = false
      }}
      onPointerCancel={() => {
        draggingRef.current = false
      }}
      onKeyDown={(e) => handleSliderKeyDown(e, spec.id, 0, 100, dispatch)}
    >
      <span
        className="ns4-mod-wheel-drum"
        style={{ backgroundPositionY: `${value * 0.4}px` }}
        aria-hidden="true"
      >
        <span
          className="ns4-mod-wheel-notch"
          style={{ bottom: `${12 + value * 0.68}%` }}
        />
      </span>
    </div>
  )
}
