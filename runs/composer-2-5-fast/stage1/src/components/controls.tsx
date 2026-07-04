import type { ControlDefinition } from '../model/hardware'
import type { InstrumentApi } from '../state/instrument'

interface ControlProps {
  control: ControlDefinition
  value: number | boolean | string
  onChange: (value: number | boolean | string) => void
}

function ariaValue(kind: ControlDefinition['kind'], value: number | boolean | string): string | undefined {
  if (kind === 'display') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}

function roleFor(kind: ControlDefinition['kind']): string {
  switch (kind) {
    case 'button':
      return 'button'
    case 'toggle':
    case 'led':
      return 'switch'
    case 'fader':
    case 'drawbar':
      return 'slider'
    case 'wheel':
    case 'stick':
    case 'knob':
    case 'encoder':
      return 'slider'
    case 'display':
      return 'status'
    default:
      return 'button'
  }
}

export function DecorativeControl({ control, value, onChange }: ControlProps) {
  const common = {
    id: control.id,
    'aria-label': control.label,
    'data-control-id': control.id,
    'data-section': control.section,
    'data-kind': control.kind,
    className: `control control--${control.kind}`,
  }

  if (control.kind === 'display') {
    return (
      <div {...common} role="status" aria-live="polite" className={`${common.className} oled`}>
        <span className="oled-label">{control.label}</span>
        <span className="oled-text">{String(value)}</span>
      </div>
    )
  }

  if (control.kind === 'button') {
    return (
      <button
        type="button"
        {...common}
        aria-pressed={Boolean(value)}
        className={`${common.className} ${value ? 'is-active' : ''}`}
        onClick={() => onChange(!value)}
      >
        {control.label}
      </button>
    )
  }

  if (control.kind === 'toggle' || control.kind === 'led') {
    return (
      <button
        type="button"
        role="switch"
        {...common}
        aria-checked={Boolean(value)}
        className={`${common.className} ${value ? 'is-on' : ''}`}
        onClick={() => onChange(!value)}
      >
        <span className="control-caption">{control.label}</span>
        <span className="led-indicator" aria-hidden="true" />
      </button>
    )
  }

  if (control.kind === 'fader' || control.kind === 'drawbar') {
    const num = typeof value === 'number' ? value : 0
    const min = control.min ?? 0
    const max = control.max ?? 127
    return (
      <label {...common} className={`${common.className} fader-wrap`}>
        <span className="control-caption">{control.label}</span>
        <input
          type="range"
          role="slider"
          aria-label={control.label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={num}
          min={min}
          max={max}
          value={num}
          className={control.kind === 'drawbar' ? 'drawbar-input' : undefined}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
    )
  }

  const num = typeof value === 'number' ? value : 64
  const min = control.min ?? 0
  const max = control.max ?? 127
  return (
    <label {...common} className={`${common.className} knob-wrap`}>
      <span className="control-caption">{control.label}</span>
      <input
        type="range"
        role={roleFor(control.kind)}
        aria-label={control.label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={num}
        aria-valuetext={ariaValue(control.kind, num)}
        min={min}
        max={max}
        value={num}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

interface SectionPanelProps {
  sectionId: string
  label: string
  controls: ControlDefinition[]
  instrument: InstrumentApi
  surface: 'exposed' | 'inset'
}

export function SectionPanel({ sectionId, label, controls, instrument, surface }: SectionPanelProps) {
  return (
    <section
      className={`panel panel--${sectionId} panel--${surface}`}
      aria-label={label}
      data-section={sectionId}
    >
      <header className="panel-header">{label}</header>
      <div className="panel-controls">
        {controls.map((control) => (
          <DecorativeControl
            key={control.id}
            control={control}
            value={instrument.presentation[control.id] ?? control.defaultValue ?? 0}
            onChange={(v) => instrument.interactControl(control, v)}
          />
        ))}
      </div>
    </section>
  )
}
