import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value))

type KnobProps = {
  label: string
  initial?: number
  value?: number
  onChange?: (value: number) => void
  size?: 'tiny' | 'small' | 'medium' | 'large'
  encoder?: boolean
  morph?: boolean
}

export function Knob({ label, initial = 50, value: controlledValue, onChange, size = 'medium', encoder = false, morph = false }: KnobProps) {
  const [internalValue, setInternalValue] = useState(initial)
  const value = controlledValue ?? internalValue
  const drag = useRef<{ y: number; value: number } | null>(null)
  const angle = -140 + (value / 100) * 280
  const setValue = (next: number | ((current: number) => number)) => {
    const resolved = clamp(typeof next === 'function' ? next(value) : next)
    if (controlledValue === undefined) setInternalValue(resolved)
    onChange?.(resolved)
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { y: event.clientY, value }
  }
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return
    setValue(clamp(drag.current.value + (drag.current.y - event.clientY) * 0.75))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      setValue((current) => clamp(current + (event.shiftKey ? 10 : 2)))
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setValue((current) => clamp(current - (event.shiftKey ? 10 : 2)))
    }
    if (event.key === 'Home') setValue(0)
    if (event.key === 'End') setValue(100)
  }

  return (
    <div className={`control knob-control ${size}`}>
      <button
        className={`knob ${encoder ? 'encoder' : ''}`}
        type="button"
        aria-label={`${label}: ${Math.round(value)}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        role="slider"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onKeyDown={onKeyDown}
        style={{ '--angle': `${angle}deg` } as CSSProperties}
      >
        <span className="knob-cap"><span className="knob-marker" /></span>
      </button>
      {morph && <span className="morph-led" aria-hidden="true" />}
      <span className="control-label">{label}</span>
    </div>
  )
}

type ButtonProps = {
  label: string
  initial?: boolean
  active?: boolean
  red?: boolean
  led?: boolean
  compact?: boolean
  onToggle?: (active: boolean) => void
}

export function PanelButton({ label, initial = false, active: controlledActive, red = false, led = true, compact = false, onToggle }: ButtonProps) {
  const [internalActive, setInternalActive] = useState(initial)
  const active = controlledActive ?? internalActive
  const toggle = () => {
    if (controlledActive === undefined) setInternalActive((current) => !current)
    onToggle?.(!active)
  }
  return (
    <button
      type="button"
      className={`panel-button ${active ? 'active' : ''} ${red ? 'red' : ''} ${compact ? 'compact' : ''}`}
      aria-pressed={active}
      onClick={toggle}
    >
      {led && <span className="button-led" aria-hidden="true" />}
      <span>{label}</span>
    </button>
  )
}

export function Indicator({ label, on = true, color = 'green' }: { label?: string; on?: boolean; color?: 'green' | 'red' | 'amber' }) {
  return (
    <span className="indicator-wrap">
      <span className={`indicator ${on ? 'on' : ''} ${color}`} aria-hidden="true" />
      {label && <span className="micro-label">{label}</span>}
    </span>
  )
}

export function Drawbar({ label, initial = 4, dark = true }: { label: string; initial?: number; dark?: boolean }) {
  const [value, setValue] = useState(initial)
  const id = useId()
  return (
    <label className="drawbar" htmlFor={id}>
      <span className="drawbar-scale">8<br />7<br />6<br />5<br />4<br />3<br />2<br />1</span>
      <input
        id={id}
        type="range"
        min="0"
        max="8"
        step="1"
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
        style={{ '--draw': `${value * 0.78}cqw` } as CSSProperties}
      />
      <span className={`drawbar-handle ${dark ? 'dark' : 'light'}`} />
      <span className="drawbar-leds" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => <i className={index < value ? 'lit' : ''} key={index} />)}
      </span>
      <span className="drawbar-label">{label}</span>
    </label>
  )
}

export function Fader({ label, initial = 70, value: controlledValue, onChange }: { label: string; initial?: number; value?: number; onChange?: (value: number) => void }) {
  const [internalValue, setInternalValue] = useState(initial)
  const value = controlledValue ?? internalValue
  const setValue = (next: number) => {
    if (controlledValue === undefined) setInternalValue(next)
    onChange?.(next)
  }
  const id = useId()
  return (
    <label className="fader" htmlFor={id}>
      <span className="fader-leds" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => <i className={index < Math.round(value / 10) ? 'lit' : ''} key={index} />)}
      </span>
      <input id={id} type="range" min="0" max="100" value={value} onChange={(event) => setValue(Number(event.target.value))} />
      <span className="fader-handle" style={{ '--fader': `${value * 0.028}cqw` } as CSSProperties} />
      <span className="control-label">{label}</span>
    </label>
  )
}

export function OLED({ children, title, lit = true, className = '' }: { children: ReactNode; title: string; lit?: boolean; className?: string }) {
  return (
    <div className={`oled ${lit ? 'lit' : ''} ${className}`} role="img" aria-label={title}>
      <div className="oled-glare" />
      <div className="oled-content">{children}</div>
    </div>
  )
}

export function Wheel({ label, pitch = false }: { label: string; pitch?: boolean }) {
  const [value, setValue] = useState(pitch ? 50 : 22)
  return (
    <label className={`wheel-control ${pitch ? 'pitch' : ''}`}>
      <input type="range" min="0" max="100" value={value} onChange={(event) => setValue(Number(event.target.value))} />
      <span className="wheel"><span className="wheel-ridges" /></span>
      <span className="control-label">{label}</span>
    </label>
  )
}
