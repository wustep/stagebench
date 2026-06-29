import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { HardwareControl } from '../model/hardware'

type KnobStyle = CSSProperties & { '--turn': string }

const clamp = (value: number) => Math.min(100, Math.max(0, value))

export function ButtonControl({ id, label, initial = false }: { id: string; label: string; initial?: boolean }) {
  const [active, setActive] = useState(initial)
  return (
    <div className="control control-button">
      <span className="control-label">{label}</span>
      <span className="led" data-testid={`${id}-led`} data-lit={active} aria-hidden="true" />
      <button
        className="hardware-button"
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={() => setActive((value) => !value)}
      >
        <span aria-hidden="true" />
      </button>
      <span className="sr-only" role="status" aria-live="polite">{label} {active ? 'on' : 'off'}</span>
    </div>
  )
}

export function KnobControl({ id, label, initial = 50, large = false }: { id: string; label: string; initial?: number; large?: boolean }) {
  const [value, setValue] = useState(clamp(initial))
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

function FaderControl({ label, initial = 50, tone = 'white' }: { label: string; initial?: number; tone?: HardwareControl['tone'] }) {
  const [value, setValue] = useState(clamp(initial))
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

function DisplayControl({ id, label, wide = false }: { id: string; label: string; wide?: boolean }) {
  const lines = id.includes('program')
    ? ['A:11', 'Nord Stage 4', 'Royal Grand 3D']
    : id.includes('synth')
      ? ['OSC · FILTER', 'Super Saw', 'LP 24 dB']
      : id.includes('organ')
        ? ['B3', 'DRAWBAR LIVE', 'PERC FAST']
        : id.includes('effects')
          ? ['FX FOCUS', 'PIANO A', 'HALL 2']
          : ['GRAND', 'Royal Grand', 'Stockholm']
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

function WheelControl({ label, initial = 40 }: { label: string; initial?: number }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="control control-wheel">
      <span className="control-label">{label}</span>
      <input type="range" min="0" max="100" value={value} aria-label={label} onChange={(event) => setValue(Number(event.target.value))} />
    </div>
  )
}

export function HardwareControlView({ control }: { control: HardwareControl }) {
  switch (control.type) {
    case 'button': return <ButtonControl id={control.id} label={control.label} initial={Boolean(control.initial)} />
    case 'knob': return <KnobControl id={control.id} label={control.label} initial={Number(control.initial)} large={control.size === 'large'} />
    case 'encoder': return <KnobControl id={control.id} label={control.label} initial={Number(control.initial)} large />
    case 'fader': return <FaderControl label={control.label} initial={Number(control.initial)} tone={control.tone} />
    case 'display': return <DisplayControl id={control.id} label={control.label} wide={control.size === 'wide'} />
    case 'meter': return <MeterControl label={control.label} />
    case 'wheel': return <WheelControl label={control.label} initial={Number(control.initial)} />
  }
}
