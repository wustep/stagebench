import type { ControlSpec, ControlValue } from '../../hardware/types'
import { useDragValue } from '../../hooks/useDragValue'
import { hardwareStore } from '../../hardware/store'

interface ControlCommonProps {
  control: ControlSpec
  value: ControlValue
}

/** Readable legend label beneath/above a control. */
function Legend({ control }: { control: ControlSpec }) {
  return (
    <span className={`ctl-legend ctl-legend--${control.kind}`} aria-hidden="true">
      {control.label}
    </span>
  )
}

/** A knob: pointer-drag vertical, keyboard arrows, aria slider. */
function KnobControl({ control, value }: ControlCommonProps) {
  const spec = control as Extract<ControlSpec, { kind: 'knob' }>
  const steps = spec.steps ?? 0
  const n = typeof value === 'number' ? value : 0
  const angle = -135 + n * 270 // -135..+135 degrees
  const drag = useDragValue({
    value: n,
    onChange: (v) => hardwareStore.set(control.id, v),
    step: steps > 0 ? 1 / steps : 0.05,
  })
  const valueText = steps > 0 ? String(Math.round(n * steps)) : `${Math.round(n * 100)}%`
  return (
    <div className="ctl ctl--knob">
      <div
        className={`knob ${steps ? 'knob--stepped' : ''}`}
        role="slider"
        aria-label={control.label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(n.toFixed(3))}
        aria-valuetext={valueText}
        tabIndex={0}
        {...drag}
      >
        <span className="knob-body">
          <span className="knob-pointer" style={{ transform: `rotate(${angle}deg)` }} />
        </span>
        <span className="knob-index" />
      </div>
      <Legend control={control} />
    </div>
  )
}

/** An endless encoder/dial (program dial, model selector). */
function EncoderControl({ control, value }: ControlCommonProps) {
  const n = typeof value === 'number' ? value : 0
  const spin = useDragValue({
    value: n,
    onChange: (v) => hardwareStore.set(control.id, v),
    step: 0.1,
  })
  return (
    <div className="ctl ctl--encoder">
      <div
        className="encoder"
        role="slider"
        aria-label={control.label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(n.toFixed(3))}
        aria-valuetext={String(Math.round(n * 10))}
        tabIndex={0}
        {...spin}
      >
        <span className="encoder-body"><span className="encoder-dot" style={{ transform: `rotate(${-135 + n * 270}deg)` }} /></span>
      </div>
      <Legend control={control} />
      <span className="encoder-value" aria-hidden="true">{Math.round(n * 10)}</span>
    </div>
  )
}

/** A vertical fader with optional LED-ladder segments. */
function FaderControl({ control, value }: ControlCommonProps) {
  const spec = control as Extract<ControlSpec, { kind: 'fader' }>
  const segments = spec.segments ?? 0
  const n = typeof value === 'number' ? value : 0
  // Normalize: when segmented the store holds an integer 0..(segments-1).
  const normalized = segments > 0 && Number.isInteger(n) ? n / (segments - 1) : n
  const drag = useDragValue({
    value: normalized,
    onChange: (v) => hardwareStore.set(control.id, v),
    step: segments > 0 ? 1 / (segments - 1) : 0.05,
  })
  const valueText = segments > 0 ? `${Math.round(n)}/${segments - 1}` : `${Math.round(normalized * 100)}%`
  return (
    <div className="ctl ctl--fader">
      <div
        className="fader"
        role="slider"
        aria-label={control.label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(normalized.toFixed(3))}
        aria-valuetext={valueText}
        tabIndex={0}
        {...drag}
      >
        <span className="fader-rail">
          <span className="fader-cap" style={{ bottom: `${normalized * 100}%` }} />
        </span>
        {segments > 0 && (
          <span className="fader-ladder" aria-hidden="true">
            {Array.from({ length: segments }, (_, i) => (
              <span key={i} className={`ladder-seg ${i < Math.round(normalized * (segments - 1)) ? 'on' : ''}`} />
            ))}
          </span>
        )}
      </div>
      <Legend control={control} />
    </div>
  )
}

/** An organ drawbar: discrete 0..8, slides vertically. */
function DrawbarControl({ control, value }: ControlCommonProps) {
  const n = typeof value === 'number' ? value : 0
  const pos = n / 8
  const drag = useDragValue({
    value: pos,
    onChange: (v) => hardwareStore.set(control.id, v),
    step: 1 / 8,
  })
  return (
    <div className="ctl ctl--drawbar">
      <div
        className="drawbar"
        role="slider"
        aria-label={control.label}
        aria-valuemin={0}
        aria-valuemax={8}
        aria-valuenow={Math.round(n)}
        aria-valuetext={`${Math.round(n)}`}
        tabIndex={0}
        {...drag}
      >
        <span className="drawbar-track">
          <span className="drawbar-handle" style={{ bottom: `${pos * 100}%` }} />
        </span>
        <span className="drawbar-scale" aria-hidden="true">0 … 8</span>
      </div>
      <span className="drawbar-label" aria-hidden="true">{Math.round(n)}</span>
    </div>
  )
}

/** A latching or momentary button with a physical light feel. */
function ButtonControl({ control, value }: ControlCommonProps) {
  const on = value === true
  const isMomentary = control.kind === 'momentary'
  const drag = useDragValue({
    value: on ? 1 : 0,
    onChange: (v) => {
      if (isMomentary) return // momentary presses handled via pointer handlers
      hardwareStore.set(control.id, v > 0.5)
    },
    keyToggle: true,
  })
  return (
    <div className="ctl ctl--button">
      <button
        type="button"
        className={`hard-button ${on ? 'on' : ''} ${isMomentary ? 'momentary' : ''}`}
        role={isMomentary ? 'button' : 'switch'}
        aria-checked={!isMomentary ? on : undefined}
        aria-label={control.label}
        aria-pressed={isMomentary ? on : undefined}
        tabIndex={0}
        onPointerDown={(e) => {
          if (isMomentary) hardwareStore.set(control.id, true)
          else {
            // latching button toggles on press
            hardwareStore.set(control.id, !on)
            drag.onPointerDown(e)
          }
        }}
        onPointerUp={(e) => {
          if (isMomentary) hardwareStore.set(control.id, false)
          else drag.onPointerUp(e)
        }}
        onPointerCancel={drag.onPointerCancel}
        onKeyDown={(e) => {
          if (isMomentary) {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              hardwareStore.set(control.id, on ? false : true)
            }
            return
          }
          drag.onKeyDown(e)
        }}
      >
        <span className="hard-button-light" />
      </button>
      <Legend control={control} />
    </div>
  )
}

/** A non-interactive indicator LED. */
function LedControl({ control, value }: ControlCommonProps) {
  const on = value === true
  return (
    <div className="ctl ctl--led" role="status" aria-label={control.label}>
      <span className={`led ${on ? 'on' : ''}`} />
      <Legend control={control} />
    </div>
  )
}

/** A non-interactive LED-ladder graph (readout). */
function GraphControl({ control, value }: ControlCommonProps) {
  const spec = control as Extract<ControlSpec, { kind: 'graph' }>
  const lit = typeof value === 'number' ? value : 0
  return (
    <div className="ctl ctl--graph" role="img" aria-label={control.label}>
      <span className="graph-ladder" aria-hidden="true">
        {Array.from({ length: spec.segments }, (_, i) => (
          <span key={i} className={`ladder-seg ${i < lit ? 'on' : ''}`} />
        ))}
      </span>
      <Legend control={control} />
    </div>
  )
}

/** The blue-green OLED display. */
function OledControl({ control }: ControlCommonProps) {
  const spec = control as Extract<ControlSpec, { kind: 'oled' }>
  return (
    <div className="ctl ctl--oled" role="img" aria-label={control.label}>
      <div className="oled">
        <span className="oled-text">{spec.text ?? ''}</span>
      </div>
    </div>
  )
}

/** A modulation wheel (vertical, stays where you leave it). */
function WheelControl({ control, value }: ControlCommonProps) {
  const n = typeof value === 'number' ? value : 0
  const drag = useDragValue({ value: n, onChange: (v) => hardwareStore.set(control.id, v), step: 0.1 })
  return (
    <div className="ctl ctl--wheel">
      <div
        className="wheel"
        role="slider"
        aria-label={control.label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(n.toFixed(3))}
        tabIndex={0}
        {...drag}
      >
        <span className={`wheel-body ${n > 0.01 ? 'engaged' : ''}`} style={{ transform: `rotate(${n * 90}deg)` }} />
      </div>
      <Legend control={control} />
    </div>
  )
}

/** A pitch stick (springs back to center 0.5). */
function StickControl({ control, value }: ControlCommonProps) {
  const n = typeof value === 'number' ? value : 0.5
  const drag = useDragValue({ value: n, onChange: (v) => hardwareStore.set(control.id, v), step: 0.1 })
  const text = n < 0.45 ? 'Down' : n > 0.55 ? 'Up' : 'Center'
  const onRelease = () => hardwareStore.set(control.id, 0.5) // spring return
  return (
    <div className="ctl ctl--stick">
      <div
        className="stick"
        role="slider"
        aria-label={control.label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(n.toFixed(3))}
        aria-valuetext={text}
        tabIndex={0}
        {...drag}
        onPointerUp={(e) => {
          drag.onPointerUp(e)
          onRelease()
        }}
        onPointerCancel={(e) => {
          drag.onPointerCancel(e)
          onRelease()
        }}
      >
        <span className="stick-body" style={{ bottom: `${n * 100}%` }} />
        <span className="stick-center" />
      </div>
      <Legend control={control} />
    </div>
  )
}

/** Render any control spec as the matching presentation element. */
export function ControlView({ control, value }: ControlCommonProps) {
  switch (control.kind) {
    case 'knob': return <KnobControl control={control} value={value} />
    case 'encoder': return <EncoderControl control={control} value={value} />
    case 'fader': return <FaderControl control={control} value={value} />
    case 'drawbar': return <DrawbarControl control={control} value={value} />
    case 'button':
    case 'momentary': return <ButtonControl control={control} value={value} />
    case 'led': return <LedControl control={control} value={value} />
    case 'graph': return <GraphControl control={control} value={value} />
    case 'oled': return <OledControl control={control} value={value} />
    case 'wheel': return <WheelControl control={control} value={value} />
    case 'stick': return <StickControl control={control} value={value} />
    default: return null
  }
}