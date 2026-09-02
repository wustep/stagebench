import type { KeyboardEvent } from 'react'
import { LedLadder } from './Led'
import { sliderKey, useControl, valueText } from './useControl'
import { useDrag } from './useDrag'
import { useMorphedValue, useMorphTitle } from '../morph'

/** Placeholder range so hooks run unconditionally even for a mis-wired (button) id. */
const NO_RANGE = { min: 0, max: 1, initial: 0 }

/** Layer level fader: physical slider plus a 12-step green LED graph (the graph shows the morphed level, manual p. 39). */
export function Fader({ id, className = '' }: { id: string; className?: string }) {
  const handle = useControl(id)
  const spec = handle.spec
  const range = spec.kind === 'button' ? NO_RANGE : spec
  const drag = useDrag({ axis: 'y', travelPx: 60, min: range.min, max: range.max, getValue: () => handle.value, setValue: handle.setValue })
  const morphed = useMorphedValue(id)
  const morphTitle = useMorphTitle(id)
  if (spec.kind === 'button') return null
  const fraction = (handle.value - spec.min) / (spec.max - spec.min)
  const shown = morphed ?? handle.value
  const ladderFraction = (shown - spec.min) / (spec.max - spec.min)
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (sliderKey(e.key, handle)) e.preventDefault()
  }
  return (
    <span className={`fader-wrap ${className}${morphed !== null ? ' has-morph' : ''}`} title={morphTitle}>
      <span
        id={id}
        role="slider"
        tabIndex={0}
        className="fader"
        aria-label={spec.name}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={handle.value}
        aria-valuetext={valueText(handle)}
        aria-orientation="vertical"
        data-control-kind="fader"
        data-morph={morphed !== null ? 'true' : undefined}
        data-shown={Math.round(shown)}
        onKeyDown={onKeyDown}
        {...drag}
      >
        <i className="fader-track" />
        <i className="fader-cap" style={{ bottom: `${fraction * 100}%` }} />
      </span>
      <LedLadder steps={12} litSteps={Math.round(ladderFraction * 12)} color="green" />
    </span>
  )
}

/**
 * Organ drawbar: 8-step red LED graph with printed numbers plus the sliding drawbar cap. The graph shows the morphed
 * value while a morph is performed; in Farf register mode LEDs 1–4 light for an inactive register and 5–8 for an
 * active one (manual p. 21).
 */
export function Drawbar({ id, topLegend, className = '', farf = false }: { id: string; topLegend?: string; className?: string; farf?: boolean }) {
  const handle = useControl(id)
  const spec = handle.spec
  const range = spec.kind === 'button' ? NO_RANGE : spec
  // Pulling a drawbar out (down on the panel) increases its value.
  const drag = useDrag({ axis: 'y', travelPx: -70, min: range.min, max: range.max, getValue: () => handle.value, setValue: handle.setValue })
  const morphed = useMorphedValue(id)
  const morphTitle = useMorphTitle(id)
  if (spec.kind === 'button') return null
  const fraction = (handle.value - spec.min) / (spec.max - spec.min)
  const shown = Math.round(morphed ?? handle.value)
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (sliderKey(e.key, handle)) e.preventDefault()
  }
  return (
    <span className={`drawbar-wrap ${className}${morphed !== null ? ' has-morph' : ''}${farf ? ' is-farf' : ''}`} title={morphTitle}>
      {topLegend ? <span className="lgd drawbar-top">{topLegend}</span> : null}
      <span className="drawbar-body">
        {farf ? <LedLadder steps={8} litSteps={0} color="red" numbered from="top" farfOn={shown > 4} /> : <LedLadder steps={8} litSteps={shown} color="red" numbered from="top" />}
        <span
          id={id}
          role="slider"
          tabIndex={0}
          className={`drawbar cap-${spec.cap ?? 'black'}`}
          aria-label={spec.name}
          aria-valuemin={spec.min}
          aria-valuemax={spec.max}
          aria-valuenow={handle.value}
          aria-valuetext={farf ? `${valueText(handle)} (register ${handle.value > 4 ? 'on' : 'off'})` : valueText(handle)}
          aria-orientation="vertical"
          data-control-kind="drawbar"
          data-morph={morphed !== null ? 'true' : undefined}
          data-shown={shown}
          onKeyDown={onKeyDown}
          {...drag}
        >
          <i className="drawbar-track" />
          <i className="drawbar-cap" style={{ top: `${fraction * 62}%` }} />
        </span>
      </span>
      <span className="lgd drawbar-foot">{spec.legend}</span>
    </span>
  )
}

/** Modulation wheel: vertical chrome wheel in a slot (the Wheel morph source and the synth Wheel vibrato). */
export function Wheel({ id, className = '' }: { id: string; className?: string }) {
  const handle = useControl(id)
  const spec = handle.spec
  const range = spec.kind === 'button' ? NO_RANGE : spec
  const drag = useDrag({ axis: 'y', travelPx: 90, min: range.min, max: range.max, getValue: () => handle.value, setValue: handle.setValue })
  if (spec.kind === 'button') return null
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (sliderKey(e.key, handle)) e.preventDefault()
  }
  return (
    <span
      id={id}
      role="slider"
      tabIndex={0}
      className={`wheel ${className}`}
      aria-label={spec.name}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      aria-valuenow={handle.value}
      aria-valuetext={valueText(handle)}
      aria-orientation="vertical"
      data-control-kind="wheel"
      style={{ ['--pos' as string]: `${handle.value * 100}%` }}
      onKeyDown={onKeyDown}
      {...drag}
    >
      <i className="wheel-face" />
    </span>
  )
}

/** Pitch stick: wooden lever that springs back to centre when released. */
export function PitchStick({ id, className = '' }: { id: string; className?: string }) {
  const handle = useControl(id)
  const spec = handle.spec
  const range = spec.kind === 'button' ? NO_RANGE : spec
  const drag = useDrag({ axis: 'x', travelPx: 80, min: range.min, max: range.max, getValue: () => handle.value, setValue: handle.setValue, onRelease: () => handle.setValue(range.initial) })
  if (spec.kind === 'button') return null
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (sliderKey(e.key, handle)) e.preventDefault()
  }
  const onKeyUp = () => {
    if (spec.springBack) handle.setValue(spec.initial)
  }
  return (
    <span
      id={id}
      role="slider"
      tabIndex={0}
      className={`pitch-stick ${className}`}
      aria-label={spec.name}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      aria-valuenow={handle.value}
      aria-valuetext={valueText(handle)}
      aria-orientation="horizontal"
      data-control-kind="stick"
      style={{ ['--bend' as string]: `${handle.value * 22}deg` }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      {...drag}
    >
      <i className="stick-lever" />
    </span>
  )
}
