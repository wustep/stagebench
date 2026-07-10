import type { ControlDef } from '../model/hardware'
import { useControlValue, usePressButton, useSetControl } from '../state/hardware-store'

interface Props {
  control: ControlDef
}

export function ControlWidget({ control }: Props) {
  const value = useControlValue(control.id)
  const setValue = useSetControl()
  const press = usePressButton()

  const baseProps = {
    id: control.id,
    'data-control-id': control.id,
    'data-section': control.section,
    'data-kind': control.kind,
    'aria-label': control.label,
  }

  if (control.kind === 'oled') {
    return (
      <div
        {...baseProps}
        className="oled"
        role="status"
        aria-live="polite"
        data-primary-oled="true"
      >
        <span className="oled-text">
          {control.id === 'program-oled' ? 'Init Program' : 'Synth A'}
        </span>
      </div>
    )
  }

  if (control.kind === 'button') {
    const on = value > 0.5
    return (
      <button
        type="button"
        {...baseProps}
        className={`ctrl-btn${on ? ' is-on' : ''}`}
        aria-pressed={control.momentary ? undefined : on}
        onClick={() => press(control.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            press(control.id)
          }
        }}
      >
        <span className="ctrl-btn-led" aria-hidden />
        <span className="ctrl-btn-label">{control.label}</span>
      </button>
    )
  }

  if (control.kind === 'knob' || control.kind === 'encoder') {
    const deg = -135 + value * 270
    return (
      <div className="ctrl-knob-wrap">
        <button
          type="button"
          {...baseProps}
          className="ctrl-knob"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(value * 100)}
          style={{ ['--knob-rot' as string]: `${deg}deg` }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId)
            const startY = e.clientY
            const startVal = value
            const onMove = (ev: PointerEvent) => {
              const dy = startY - ev.clientY
              setValue(control.id, startVal + dy / 100)
            }
            const onUp = () => {
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
              e.preventDefault()
              setValue(control.id, value + 0.05)
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
              e.preventDefault()
              setValue(control.id, value - 0.05)
            } else if (e.key === 'Home') {
              e.preventDefault()
              setValue(control.id, 0)
            } else if (e.key === 'End') {
              e.preventDefault()
              setValue(control.id, 1)
            }
          }}
        >
          <span className="ctrl-knob-marker" aria-hidden />
        </button>
        <span className="ctrl-label">{control.label}</span>
      </div>
    )
  }

  if (control.kind === 'fader' || control.kind === 'drawbar') {
    const isDrawbar = control.kind === 'drawbar'
    return (
      <div className={`ctrl-fader-wrap${isDrawbar ? ' is-drawbar' : ''}`}>
        <div
          {...baseProps}
          className="ctrl-fader"
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(value * 100)}
          aria-orientation="vertical"
          onPointerDown={(e) => {
            const el = e.currentTarget
            el.setPointerCapture?.(e.pointerId)
            const rect = el.getBoundingClientRect()
            const update = (clientY: number) => {
              const t = rect.height > 0 ? (clientY - rect.top) / rect.height : 0
              // drawbars: pulled out = higher (from top); faders: up = higher
              const v = isDrawbar ? Math.max(0, Math.min(1, t)) : Math.max(0, Math.min(1, 1 - t))
              setValue(control.id, v)
            }
            update(e.clientY)
            const onMove = (ev: PointerEvent) => update(ev.clientY)
            const onUp = () => {
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
          onKeyDown={(e) => {
            const step = 0.1
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setValue(control.id, isDrawbar ? value - step : value + step)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setValue(control.id, isDrawbar ? value + step : value - step)
            }
          }}
        >
          <div className="ctrl-fader-track">
            {isDrawbar && (
              <div className="drawbar-leds" aria-hidden>
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} className={`drawbar-led${value > i / 8 ? ' on' : ''}`} />
                ))}
              </div>
            )}
            <div
              className="ctrl-fader-cap"
              style={{ top: isDrawbar ? `${value * 100}%` : `${(1 - value) * 100}%` }}
            />
          </div>
        </div>
        <span className="ctrl-label">{isDrawbar ? control.label.replace('Drawbar ', '') : control.label}</span>
      </div>
    )
  }

  if (control.kind === 'wheel') {
    return (
      <div className="ctrl-wheel-wrap">
        <div
          {...baseProps}
          className="ctrl-wheel"
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(value * 100)}
          aria-orientation="vertical"
          onPointerDown={(e) => {
            const el = e.currentTarget
            el.setPointerCapture?.(e.pointerId)
            const rect = el.getBoundingClientRect()
            const update = (clientY: number) => {
              const t = rect.height > 0 ? 1 - (clientY - rect.top) / rect.height : 0
              setValue(control.id, Math.max(0, Math.min(1, t)))
            }
            update(e.clientY)
            const onMove = (ev: PointerEvent) => update(ev.clientY)
            const onUp = () => {
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setValue(control.id, value + 0.05)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setValue(control.id, value - 0.05)
            }
          }}
        >
          <div className="ctrl-wheel-notch" style={{ bottom: `${value * 100}%` }} />
        </div>
        <span className="ctrl-label">{control.label}</span>
      </div>
    )
  }

  if (control.kind === 'stick') {
    const x = (value - 0.5) * 2
    return (
      <div className="ctrl-stick-wrap">
        <div
          {...baseProps}
          className="ctrl-stick"
          role="slider"
          tabIndex={0}
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={Math.round(x * 100)}
          onPointerDown={(e) => {
            const el = e.currentTarget
            el.setPointerCapture?.(e.pointerId)
            const rect = el.getBoundingClientRect()
            const update = (clientX: number) => {
              const t = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5
              setValue(control.id, Math.max(0, Math.min(1, t)))
            }
            update(e.clientX)
            const onMove = (ev: PointerEvent) => update(ev.clientX)
            const onUp = () => {
              setValue(control.id, 0.5)
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              setValue(control.id, value - 0.1)
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              setValue(control.id, value + 0.1)
            } else if (e.key === 'Home') {
              e.preventDefault()
              setValue(control.id, 0.5)
            }
          }}
        >
          <div className="ctrl-stick-handle" style={{ left: `${value * 100}%` }} />
        </div>
        <span className="ctrl-label">{control.label}</span>
      </div>
    )
  }

  return null
}
