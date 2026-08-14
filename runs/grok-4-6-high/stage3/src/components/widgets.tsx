import { useCallback, type KeyboardEvent, type PointerEvent } from 'react'
import type { ControlDef } from '../model/controls'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

export function controlAriaValue(def: ControlDef, value: number): string {
  if (def.kind === 'button') return value >= 1 ? 'on' : 'off'
  if (def.kind === 'drawbar') return String(Math.round(value))
  return value.toFixed(2)
}

export function applyKeyDelta(def: ControlDef, value: number, key: string): number | null {
  if (def.kind === 'oled') return null
  if (def.kind === 'button') {
    if (key === ' ' || key === 'Enter') return value >= 1 ? 0 : 1
    return null
  }
  const span = def.max - def.min
  const step = def.step || span / 100
  const page = step * 10
  if (key === 'ArrowUp' || key === 'ArrowRight') return clamp(roundToStep(value + step, step), def.min, def.max)
  if (key === 'ArrowDown' || key === 'ArrowLeft') return clamp(roundToStep(value - step, step), def.min, def.max)
  if (key === 'PageUp') return clamp(roundToStep(value + page, step), def.min, def.max)
  if (key === 'PageDown') return clamp(roundToStep(value - page, step), def.min, def.max)
  if (key === 'Home') return def.min
  if (key === 'End') return def.max
  return null
}

interface SharedProps {
  def: ControlDef
  value: number
  onChange: (id: string, value: number) => void
}

function useControlKeys({ def, value, onChange }: SharedProps) {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const next = applyKeyDelta(def, value, event.key)
      if (next == null) return
      event.preventDefault()
      onChange(def.id, next)
    },
    [def, onChange, value],
  )
}

function useDragValue({ def, value, onChange }: SharedProps, axis: 'y' | 'x' = 'y') {
  return useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const target = event.currentTarget
      target.setPointerCapture?.(event.pointerId)
      const start = axis === 'y' ? event.clientY : event.clientX
      const origin = value
      const span = def.max - def.min
      const move = (ev: globalThis.PointerEvent) => {
        const pos = axis === 'y' ? ev.clientY : ev.clientX
        const delta = axis === 'y' ? start - pos : pos - start
        const next = clamp(origin + (delta / 110) * span, def.min, def.max)
        onChange(def.id, roundToStep(next, def.step || 0.01))
      }
      const up = (ev: globalThis.PointerEvent) => {
        target.releasePointerCapture?.(ev.pointerId)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [def, onChange, value, axis],
  )
}

export function Knob({ def, value, onChange, size = 'md' }: SharedProps & { size?: 'sm' | 'md' | 'lg' }) {
  const onKeyDown = useControlKeys({ def, value, onChange })
  const onPointerDown = useDragValue({ def, value, onChange })
  const t = (value - def.min) / (def.max - def.min || 1)
  const angle = -135 + t * 270
  return (
    <div className={`ctrl knob knob-${size}`}>
      <button
        type="button"
        id={def.id}
        data-control-id={def.id}
        className="knob-cap"
        role="slider"
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={controlAriaValue(def, value)}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        style={{ ['--knob-angle' as string]: `${angle}deg` }}
      />
      <span className="ctrl-label">{def.label}</span>
    </div>
  )
}

export function LedButton({ def, value, onChange, flash }: SharedProps & { flash?: boolean }) {
  const onKeyDown = useControlKeys({ def, value, onChange })
  const on = value >= 1
  return (
    <button
      type="button"
      id={def.id}
      data-control-id={def.id}
      className={`led-btn ${on ? 'is-on' : ''} ${flash ? 'is-flash' : ''}`}
      aria-label={def.label}
      aria-pressed={on}
      onKeyDown={onKeyDown}
      onClick={() => onChange(def.id, on ? 0 : 1)}
    >
      <span className="led-dot" />
      <span className="led-text">{shortLabel(def.label)}</span>
    </button>
  )
}

export function Fader({ def, value, onChange }: SharedProps) {
  const onKeyDown = useControlKeys({ def, value, onChange })
  const onPointerDown = useDragValue({ def, value, onChange })
  const t = (value - def.min) / (def.max - def.min || 1)
  return (
    <div className="ctrl fader">
      <LedLadder value={t} />
      <button
        type="button"
        id={def.id}
        data-control-id={def.id}
        className="fader-track"
        role="slider"
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-orientation="vertical"
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={controlAriaValue(def, value)}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
      >
        <span className="fader-cap" style={{ bottom: `${t * 78}%` }} />
      </button>
      <span className="ctrl-label">{shortLabel(def.label)}</span>
    </div>
  )
}

export function Drawbar({ def, value, onChange }: SharedProps) {
  const onKeyDown = useControlKeys({ def, value, onChange })
  const onPointerDown = useDragValue({ def, value, onChange })
  const t = value / 8
  return (
    <div className="ctrl drawbar">
      <LedLadder value={t} />
      <button
        type="button"
        id={def.id}
        data-control-id={def.id}
        className="drawbar-slot"
        role="slider"
        aria-label={def.label}
        aria-valuemin={0}
        aria-valuemax={8}
        aria-orientation="vertical"
        aria-valuenow={Math.round(value)}
        aria-valuetext={String(Math.round(value))}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
      >
        <span className="drawbar-cap" style={{ top: `${t * 62}%` }} />
      </button>
      <span className="ctrl-label">{shortLabel(def.label)}</span>
    </div>
  )
}

export function Wheel({ def, value, onChange }: SharedProps) {
  const onKeyDown = useControlKeys({ def, value, onChange })
  const onPointerDown = useDragValue({ def, value, onChange })
  return (
    <div className="ctrl wheel">
      <button
        type="button"
        id={def.id}
        data-control-id={def.id}
        className="wheel-body"
        role="slider"
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-orientation="vertical"
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={controlAriaValue(def, value)}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
      >
        <span className="wheel-grip" style={{ transform: `translateY(${(0.5 - value) * 28}px)` }} />
      </button>
      <span className="ctrl-label">{def.label}</span>
    </div>
  )
}

export function Stick({ def, value, onChange }: SharedProps) {
  const onKeyDown = useControlKeys({ def, value, onChange })
  const onPointerDown = useDragValue({ def, value, onChange })
  return (
    <div className="ctrl stick">
      <button
        type="button"
        id={def.id}
        data-control-id={def.id}
        className="stick-body"
        role="slider"
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-orientation="vertical"
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={controlAriaValue(def, value)}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={() => onChange(def.id, 0)}
        onPointerCancel={() => onChange(def.id, 0)}
        onBlur={() => onChange(def.id, 0)}
      >
        <span className="stick-paddle" style={{ transform: `rotate(${value * 28}deg)` }} />
      </button>
      <span className="ctrl-label">{def.label}</span>
    </div>
  )
}

export function Oled({ def, lines }: { def: ControlDef; lines: string[] }) {
  return (
    <div
      id={def.id}
      data-control-id={def.id}
      className="oled"
      role="status"
      aria-label={def.label}
      aria-live="off"
    >
      {lines.map((line) => (
        <div key={line} className="oled-line">
          {line}
        </div>
      ))}
    </div>
  )
}

function LedLadder({ value }: { value: number }) {
  const lit = Math.round(value * 8)
  return (
    <div className="led-ladder" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className={`led-rung ${8 - i <= lit ? 'is-lit' : ''}`} />
      ))}
    </div>
  )
}

function shortLabel(label: string): string {
  return label
    .replace(/^(Organ|Piano|Synth|Program|Effect|Effects)\s+/i, '')
    .replace(/^Drawbar\s+/, '')
    .replace(/^Morph assign\s+/i, '')
}
