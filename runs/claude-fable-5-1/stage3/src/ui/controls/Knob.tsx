import type { KeyboardEvent } from 'react'
import { Led } from './Led'
import { sliderKey, useControl, valueText } from './useControl'
import { useDrag } from './useDrag'
import { useMorphAssigned, useMorphTitle } from '../morph'

const SCALES: Record<string, string[]> = {
  unipolar: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  level: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  bipolar10: ['-10', '', '-5', '', '', '0', '', '', '5', '', '10'],
  bipolar15: ['-15', '', '-10', '', '-5', '0', '5', '', '10', '', '15'],
  freq: ['200', '250', '400', '600', '1K', '2K', '4K', '6K', '8K'],
  range: ['0', '1', '2', '3', '4'],
}

const START_ANGLE = -150
const END_ANGLE = 150
/** Placeholder range so hooks run unconditionally even for a mis-wired (button) id. */
const NO_RANGE = { min: 0, max: 1, initial: 0 }

export function Knob({ id, size = 'medium', legend, legendBox, className = '' }: { id: string; size?: 'small' | 'medium' | 'large'; legend?: string; legendBox?: string; className?: string }) {
  const handle = useControl(id)
  const spec = handle.spec
  const bounds = spec.kind === 'button' ? NO_RANGE : spec
  const drag = useDrag({ axis: 'y', travelPx: 140, min: bounds.min, max: bounds.max, getValue: () => handle.value, setValue: handle.setValue })
  const morphAssigned = useMorphAssigned(id)
  const morphTitle = useMorphTitle(id)
  if (spec.kind === 'button') return null
  const range = spec.max - spec.min
  const fraction = range ? (handle.value - spec.min) / range : 0
  const angle = START_ANGLE + fraction * (END_ANGLE - START_ANGLE)
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (sliderKey(e.key, handle)) e.preventDefault()
  }
  const scale = SCALES[spec.scale ?? 'unipolar'] ?? SCALES.unipolar
  const ticks = scale.map((label, i) => {
    const a = ((START_ANGLE + (i / (scale.length - 1)) * (END_ANGLE - START_ANGLE)) * Math.PI) / 180
    const r = 46
    return (
      <text key={i} x={50 + r * Math.sin(a)} y={50 - r * Math.cos(a) + 3} className="knob-scale-text" textAnchor="middle">
        {label}
      </text>
    )
  })
  const printed = legend ?? spec.legend
  return (
    <span className={`knob-wrap knob-${size} ${className}${morphAssigned ? ' has-morph' : ''}`} title={morphTitle}>
      <span className="knob-scale" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          {spec.scale === 'range' ? <path d="M 30 84.6 A 40 40 0 0 1 30 15.4" className="knob-range-arc" /> : null}
          {ticks}
        </svg>
      </span>
      {/* Green morph LED: lit once a morph source is assigned to this parameter (manual p. 39). */}
      <Led small color="green" lit={morphAssigned} className="knob-morph-led" />
      <span
        id={id}
        role="slider"
        tabIndex={0}
        className="knob"
        aria-label={spec.name}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={handle.value}
        aria-valuetext={valueText(handle)}
        aria-orientation="vertical"
        data-control-kind="knob"
        data-morph={morphAssigned ? 'true' : undefined}
        style={{ ['--angle' as string]: `${angle}deg` }}
        onKeyDown={onKeyDown}
        {...drag}
      >
        <i className="knob-indicator" />
      </span>
      {printed ? (
        <span className="knob-legend">
          <span className="lgd">{printed}</span>
          {legendBox ? <span className="lgd-box">{legendBox}</span> : null}
        </span>
      ) : null}
    </span>
  )
}

/** Endless encoder (program / model / display dials). Stores an angle; the controller reads its movement. */
export function Dial({ id, size = 'medium', legend, legendBox, className = '' }: { id: string; size?: 'small' | 'medium' | 'large'; legend?: string; legendBox?: string; className?: string }) {
  const handle = useControl(id)
  const spec = handle.spec
  const bounds = spec.kind === 'button' ? NO_RANGE : spec
  const drag = useDrag({ axis: 'y', travelPx: 200, min: bounds.min, max: bounds.max, unitsPerPx: 1.5, getValue: () => handle.value, setValue: handle.setValue })
  if (spec.kind === 'button') return null
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (sliderKey(e.key, handle)) e.preventDefault()
  }
  const printed = legend ?? spec.legend
  return (
    <span className={`dial-wrap dial-${size} ${className}`}>
      <span
        id={id}
        role="slider"
        tabIndex={0}
        className="dial"
        aria-label={spec.name}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={handle.value}
        aria-valuetext={valueText(handle)}
        data-control-kind="dial"
        style={{ ['--angle' as string]: `${handle.value}deg` }}
        onKeyDown={onKeyDown}
        {...drag}
      >
        <i className="dial-notch" />
      </span>
      {printed ? (
        <span className="dial-legend">
          <span className="lgd">{printed}</span>
          {legendBox ? <span className="lgd-box">{legendBox}</span> : null}
        </span>
      ) : null}
    </span>
  )
}
