import { useCallback, useRef } from 'react'
import type { ControlDef } from '../hardware/controls'
import { getControlValue, setControlValue, useHardwareState } from '../state/hardware-store'
import { useEngine } from '../state/app-context'
import { isFunctionalControl, pressFunctionalControl, programDialDelta, recordMorphMove, syncFunctionalControls } from '../state/panel-bindings'

/**
 * Control renderers. Every control:
 *  - has a stable data-control-id and an accessible name/role/value;
 *  - responds to pointer (drag) and keyboard (arrows / PageUp / PageDown /
 *    Home / End / Enter / Space);
 *  - writes to the presentation store;
 *  - and, when it is a FUNCTIONAL control, also writes through to the
 *    engine's canonical state. Spec-excluded controls move and do nothing
 *    (they are listed in UNSUPPORTED_CONTROLS and the UI notes).
 */

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

interface CommonProps {
  def: ControlDef
}

/** Write a control value; if functional, sync engine state immediately after. */
function useSetControl(def: ControlDef) {
  const engine = useEngine()
  return useCallback(
    (value: number) => {
      const prev = getControlValue(def.id)
      setControlValue(def.id, value)
      // Morph assignment: while a source button is held/latched, moving a
      // destination control records the from→to range.
      recordMorphMove(engine, def.id, value)
      if (def.id === 'program.dial') {
        programDialDelta(engine, value - prev)
        setControlValue(def.id, 0) // endless dial: recenters
        return
      }
      if (isFunctionalControl(def.id)) syncFunctionalControls(engine)
    },
    [def.id, engine],
  )
}

function useDragAdjust(def: ControlDef, pixelsForFullRange: number) {
  const setControl = useSetControl(def)
  const drag = useRef<{ startY: number; startValue: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      drag.current = { startY: e.clientY, startValue: getControlValue(def.id) }
    },
    [def.id],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!drag.current) return
      const dy = drag.current.startY - e.clientY
      const range = def.max - def.min
      const next = clamp(drag.current.startValue + (dy / pixelsForFullRange) * range, def.min, def.max)
      setControl(Math.round(next / def.step) * def.step)
    },
    [def, pixelsForFullRange, setControl],
  )
  const onPointerEnd = useCallback((e: React.PointerEvent<HTMLElement>) => {
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd }
}

function useContinuousKeys(def: ControlDef) {
  const setControl = useSetControl(def)
  return useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const cur = getControlValue(def.id)
      const big = (def.max - def.min) / 10
      let next: number | null = null
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = cur + def.step
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = cur - def.step
      else if (e.key === 'PageUp') next = cur + big
      else if (e.key === 'PageDown') next = cur - big
      else if (e.key === 'Home') next = def.max
      else if (e.key === 'End') next = def.min
      if (next !== null) {
        e.preventDefault()
        setControl(clamp(Math.round(next / def.step) * def.step, def.min, def.max))
      }
    },
    [def, setControl],
  )
}

/** Green morph LED: lit when the control is a morph destination. */
function MorphLed({ id }: { id: string }) {
  const engine = useEngine()
  useHardwareState()
  const assigned = engine.morphAssignedControls().has(id)
  return <span className={`morph-led ${assigned ? 'led-on' : ''}`} data-morph-led={id} aria-hidden="true" />
}

export function KnobControl({ def }: CommonProps) {
  useHardwareState()
  const value = getControlValue(def.id)
  const drag = useDragAdjust(def, 150)
  const onKeyDown = useContinuousKeys(def)
  const frac = (value - def.min) / (def.max - def.min)
  const angle = -135 + frac * 270
  return (
    <div
      className="ctl ctl-knob"
      role="slider"
      tabIndex={0}
      aria-label={def.label}
      aria-valuemin={def.min}
      aria-valuemax={def.max}
      aria-valuenow={value}
      data-control-id={def.id}
      data-functional={isFunctionalControl(def.id) ? 'true' : undefined}
      onKeyDown={onKeyDown}
      {...drag}
    >
      <div className="knob-body">
        <div className="knob-pointer" style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <MorphLed id={def.id} />
      {def.legend ? <span className="ctl-legend">{def.legend}</span> : null}
    </div>
  )
}

export function FaderControl({ def }: CommonProps) {
  useHardwareState()
  const value = getControlValue(def.id)
  const drag = useDragAdjust(def, 90)
  const onKeyDown = useContinuousKeys(def)
  const frac = (value - def.min) / (def.max - def.min)
  const leds = 8
  const lit = Math.round(frac * leds)
  return (
    <div
      className="ctl ctl-fader"
      role="slider"
      tabIndex={0}
      aria-label={def.label}
      aria-valuemin={def.min}
      aria-valuemax={def.max}
      aria-valuenow={value}
      aria-orientation="vertical"
      data-control-id={def.id}
      data-functional={isFunctionalControl(def.id) ? 'true' : undefined}
      onKeyDown={onKeyDown}
      {...drag}
    >
      <div className="fader-leds">
        {Array.from({ length: leds }, (_, i) => (
          <span key={i} className={`led ${i < lit ? 'led-on' : ''} ${i >= leds - 1 ? 'led-red' : ''}`} />
        ))}
      </div>
      <div className="fader-track">
        <div className="fader-cap" style={{ bottom: `${frac * 78}%` }} />
      </div>
      <MorphLed id={def.id} />
    </div>
  )
}

export function DrawbarControl({ def }: CommonProps) {
  useHardwareState()
  const value = getControlValue(def.id)
  const drag = useDragAdjust(def, 72)
  const onKeyDown = useContinuousKeys(def)
  const frac = (value - def.min) / (def.max - def.min)
  // Drawbar out = handle toward player (down); value 0 = fully in (up).
  return (
    <div
      className="ctl ctl-drawbar"
      role="slider"
      tabIndex={0}
      aria-label={def.label}
      aria-valuemin={def.min}
      aria-valuemax={def.max}
      aria-valuenow={value}
      aria-orientation="vertical"
      data-control-id={def.id}
      data-functional={isFunctionalControl(def.id) ? 'true' : undefined}
      onKeyDown={onKeyDown}
      {...drag}
    >
      <div className="drawbar-leds" data-drawbar-leds={def.id}>
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className={`led ${8 - i <= value ? 'led-on' : ''}`} />
        ))}
      </div>
      <div className="drawbar-track">
        <div className="drawbar-cap" style={{ top: `${(1 - frac) * 74}%` }} />
      </div>
      <MorphLed id={def.id} />
    </div>
  )
}

export function WheelControl({ def }: CommonProps) {
  useHardwareState()
  const value = getControlValue(def.id)
  const drag = useDragAdjust(def, 90)
  const onKeyDown = useContinuousKeys(def)
  const frac = (value - def.min) / (def.max - def.min)
  return (
    <div
      className={`ctl ctl-wheel ${def.kind === 'pitchstick' ? 'ctl-pitchstick' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={def.label}
      aria-valuemin={def.min}
      aria-valuemax={def.max}
      aria-valuenow={value}
      aria-orientation="vertical"
      data-control-id={def.id}
      data-functional={isFunctionalControl(def.id) ? 'true' : undefined}
      onKeyDown={onKeyDown}
      {...drag}
    >
      {def.kind === 'pitchstick' ? (
        <div className="pitchstick-body">
          <div className="pitchstick-lever" style={{ transform: `rotate(${frac * 56 - 28}deg)` }} />
        </div>
      ) : (
        <div className="wheel-body">
          <div className="wheel-rib" style={{ top: `${(1 - frac) * 66}%` }} />
        </div>
      )}
      {def.legend ? <span className="ctl-legend">{def.legend}</span> : null}
    </div>
  )
}

export function ButtonControl({ def }: CommonProps) {
  useHardwareState()
  const engine = useEngine()
  const setControl = useSetControl(def)
  const value = getControlValue(def.id)
  const optionCount = def.options?.length ?? 0

  const press = useCallback(() => {
    // Selector buttons cycle their options; plain buttons toggle.
    if (optionCount > 0) {
      setControl((getControlValue(def.id) + 1) % optionCount)
    } else if (def.momentary) {
      setControlValue(def.id, 1)
      if (isFunctionalControl(def.id)) pressFunctionalControl(engine, def.id)
      return
    } else if (def.id === 'fx.focusA' || def.id === 'fx.focusB') {
      // Mutually-exclusive focus pair: pressing one selects it, clears the other.
      const other = def.id === 'fx.focusA' ? 'fx.focusB' : 'fx.focusA'
      setControlValue(other, 0)
      setControlValue(def.id, 1)
      if (isFunctionalControl(def.id)) syncFunctionalControls(engine)
      pressFunctionalControl(engine, def.id)
      return
    } else {
      setControl(getControlValue(def.id) === 0 ? 1 : 0)
    }
    if (isFunctionalControl(def.id)) pressFunctionalControl(engine, def.id)
  }, [def.id, def.momentary, optionCount, setControl, engine])

  // jsdom (and some browsers) fire a synthetic `click` after Space keydown on
  // buttons — guard against double-toggling by ignoring a click that follows
  // a keyboard press within the same task.
  const kbPressed = useRef(0)
  const onClick = useCallback(() => {
    if (kbPressed.current > 0) {
      kbPressed.current = 0
      return
    }
    press()
  }, [press])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        kbPressed.current = 1
        press()
      }
    },
    [press],
  )

  const pressed = optionCount > 0 ? true : value === 1
  const optionIndex = optionCount > 0 ? Math.round(value) % optionCount : -1

  return (
    <button
      type="button"
      className={`ctl ctl-button ${pressed ? 'ctl-button-active' : ''}`}
      aria-label={def.label}
      aria-pressed={pressed}
      data-control-id={def.id}
      data-option={optionIndex >= 0 ? def.options?.[optionIndex] : undefined}
      data-functional={isFunctionalControl(def.id) ? 'true' : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span className={`button-led ${pressed ? 'led-on' : ''}`} />
      {def.legend ? <span className="ctl-legend">{def.legend}</span> : null}
      {optionCount > 0 ? (
        <span className="button-options" aria-hidden="true">
          {def.options!.map((opt, i) => (
            <span key={opt} className={`option-led ${i === optionIndex ? 'led-on' : ''}`} title={opt} />
          ))}
        </span>
      ) : null}
    </button>
  )
}

export function ControlView({ def }: CommonProps) {
  switch (def.kind) {
    case 'knob':
      return <KnobControl def={def} />
    case 'fader':
      return <FaderControl def={def} />
    case 'drawbar':
      return <DrawbarControl def={def} />
    case 'wheel':
    case 'pitchstick':
      return <WheelControl def={def} />
    case 'button':
      return <ButtonControl def={def} />
  }
}
