import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { HardwareControl } from '../model/hardware'

type KnobStyle = CSSProperties & { '--turn': string }

const clamp = (value: number) => Math.min(100, Math.max(0, value))

export interface ControlBinding {
  value?: number
  onValueChange?: (value: number) => void
  active?: boolean
  onActiveChange?: (active: boolean) => void
  displayLines?: string[]
}

export function ButtonControl({ id, label, initial = false, active: controlledActive, onActiveChange }: { id: string; label: string; initial?: boolean; active?: boolean; onActiveChange?: (active: boolean) => void }) {
  const [localActive, setLocalActive] = useState(initial)
  const active = controlledActive ?? localActive
  const toggle = () => {
    const next = !active
    if (controlledActive === undefined) setLocalActive(next)
    onActiveChange?.(next)
  }
  return (
    <div className="control control-button">
      <span className="control-label">{label}</span>
      <span className="led" data-testid={`${id}-led`} data-lit={active} aria-hidden="true" />
      <button
        id={id}
        className="hardware-button"
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={toggle}
      >
        <span aria-hidden="true" />
      </button>
      <span className="sr-only" role="status" aria-live="polite">{label} {active ? 'on' : 'off'}</span>
    </div>
  )
}

export function KnobControl({ id, label, initial = 50, large = false, value: controlledValue, onValueChange }: { id: string; label: string; initial?: number; large?: boolean; value?: number; onValueChange?: (value: number) => void }) {
  const [localValue, setLocalValue] = useState(clamp(initial))
  const value = controlledValue === undefined ? localValue : clamp(controlledValue)
  const setValue = (next: number) => {
    const clamped = clamp(next)
    if (controlledValue === undefined) setLocalValue(clamped)
    onValueChange?.(clamped)
  }
  const drag = useRef<{ y: number; value: number } | null>(null)
  const updateFromKey = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | undefined
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = value + 5
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = value - 5
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = 100
    if (next !== undefined) {
      event.preventDefault()
      setValue(clamp(next))
    }
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { y: event.clientY, value }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    setValue(clamp(drag.current.value + (drag.current.y - event.clientY)))
  }
  const stopDrag = () => { drag.current = null }
  const turn = -135 + (value / 100) * 270

  return (
    <div className={`control control-knob${large ? ' is-large' : ''}`}>
      <span className="control-label">{label}</span>
      <div
        id={id}
        className="knob-shell"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        style={{ '--turn': `${turn}deg` } as KnobStyle}
        onKeyDown={updateFromKey}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <span className="knob-index" />
      </div>
    </div>
  )
}

function FaderControl({ label, initial = 50, tone = 'white', value: controlledValue, onValueChange }: { label: string; initial?: number; tone?: HardwareControl['tone']; value?: number; onValueChange?: (value: number) => void }) {
  const [localValue, setLocalValue] = useState(clamp(initial))
  const value = controlledValue === undefined ? localValue : clamp(controlledValue)
  const setValue = (next: number) => {
    const clamped = clamp(next)
    if (controlledValue === undefined) setLocalValue(clamped)
    onValueChange?.(clamped)
  }
  return (
    <div className="control control-fader">
      <span className="control-label">{label}</span>
      <div className="fader-scale" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <input
        className={`fader fader-${tone}`}
        type="range"
        min="0"
        max="100"
        value={value}
        aria-label={label}
        onChange={(event) => setValue(Number(event.target.value))}
      />
    </div>
  )
}

function DisplayControl({ id, label, wide = false, displayLines }: { id: string; label: string; wide?: boolean; displayLines?: string[] }) {
  const lines = displayLines ?? (id.includes('program')
    ? ['A:11', 'Nord Stage 4', 'Royal Grand 3D']
    : id.includes('synth')
      ? ['OSC · FILTER', 'Super Saw', 'LP 24 dB']
      : id.includes('organ')
        ? ['B3', 'DRAWBAR LIVE', 'PERC FAST']
        : id.includes('effects')
          ? ['FX FOCUS', 'PIANO A', 'HALL 2']
      : ['GRAND', 'Royal Grand', 'Stockholm'])
  return (
    <div className={`control control-display${wide ? ' is-wide' : ''}`}>
      <span className="control-label">{label}</span>
      <div className="oled" id={id} role="img" aria-label={`${label}, illuminated`}>
        {lines.map((line) => <span key={line}>{line}</span>)}
      </div>
    </div>
  )
}

function MeterControl({ label }: { label: string }) {
  return (
    <div className="control control-meter" role="meter" aria-label={label} aria-valuenow={72} aria-valuemin={0} aria-valuemax={100}>
      <span className="control-label">{label}</span>
      <span className="meter-leds" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => <i key={i} className={i > 5 ? 'hot' : ''} />)}
      </span>
    </div>
  )
}

function WheelControl({ label, initial = 40, value: controlledValue, onValueChange }: { label: string; initial?: number; value?: number; onValueChange?: (value: number) => void }) {
  const [localValue, setLocalValue] = useState(initial)
  const value = controlledValue ?? localValue
  const setValue = (next: number) => { if (controlledValue === undefined) setLocalValue(next); onValueChange?.(next) }
  return (
    <div className="control control-wheel">
      <span className="control-label">{label}</span>
      <input type="range" min="0" max="100" value={value} aria-label={label} onChange={(event) => setValue(Number(event.target.value))} />
    </div>
  )
}

export function HardwareControlView({ control, binding = {} }: { control: HardwareControl; binding?: ControlBinding }) {
  switch (control.type) {
    case 'button': return <ButtonControl id={control.id} label={control.label} initial={Boolean(control.initial)} active={binding.active} onActiveChange={binding.onActiveChange} />
    case 'knob': return <KnobControl id={control.id} label={control.label} initial={Number(control.initial)} large={control.size === 'large'} value={binding.value} onValueChange={binding.onValueChange} />
    case 'encoder': return <KnobControl id={control.id} label={control.label} initial={Number(control.initial)} large value={binding.value} onValueChange={binding.onValueChange} />
    case 'fader': return <FaderControl label={control.label} initial={Number(control.initial)} tone={control.tone} value={binding.value} onValueChange={binding.onValueChange} />
    case 'display': return <DisplayControl id={control.id} label={control.label} wide={control.size === 'wide'} displayLines={binding.displayLines} />
    case 'meter': return <MeterControl label={control.label} />
    case 'wheel': return <WheelControl label={control.label} initial={Number(control.initial)} value={binding.value} onValueChange={binding.onValueChange} />
  }
}
