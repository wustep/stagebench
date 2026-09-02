import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Led } from './Led'
import { useControl, valueText } from './useControl'

export interface PanelButtonProps {
  id: string
  /** Where the associated LED + legend sits relative to the button. */
  led?: 'above' | 'left' | 'right' | 'none'
  ledLegend?: string
  legendAbove?: ReactNode
  legendBelow?: ReactNode
  className?: string
  /** Extra visual frame (synth function buttons carry a red frame). */
  frame?: 'red' | 'light'
}

/**
 * Every panel button: toggles expose aria-pressed, selectors describe the current option, momentary
 * buttons hold their value while pressed. Pointer and keyboard (Space/Enter) both work.
 */
export function PanelButton({ id, led = 'above', ledLegend, legendAbove, legendBelow, className = '', frame }: PanelButtonProps) {
  const handle = useControl(id)
  const spec = handle.spec
  if (spec.kind !== 'button') return null
  const isMomentary = spec.mode === 'momentary'
  const lit = spec.mode === 'select' ? false : handle.value === 1
  const stateId = `${id}-state`
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    handle.press()
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerUp = () => handle.release()
  const onClick = () => {
    if (!isMomentary) handle.activate()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) handle.press()
  }
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') handle.release()
  }
  const legend = ledLegend ?? spec.ledLegend
  const showLed = led !== 'none' && (legend !== undefined || spec.mode === 'toggle' || spec.mode === 'radio')
  const ledEl = showLed ? <Led lit={lit} color={spec.ledColor ?? 'red'} legend={legend} side={led === 'above' ? 'right' : led} className={`btn-led btn-led-${led}`} /> : null
  return (
    <span className={`pbtn-wrap pbtn-led-${led} ${className}`}>
      {legendAbove ? <span className="lgd pbtn-legend-above">{legendAbove}</span> : null}
      {led === 'above' ? ledEl : null}
      <span className={`pbtn-row${frame ? ` frame-${frame}` : ''}`}>
        {led === 'left' ? ledEl : null}
        <button
          id={id}
          type="button"
          className={`pbtn pbtn-${spec.style}${handle.pressed || (isMomentary && handle.value === 1) ? ' is-pressed' : ''}${lit ? ' is-lit' : ''}`}
          aria-label={spec.name}
          aria-pressed={spec.mode === 'toggle' || spec.mode === 'radio' ? lit : undefined}
          aria-describedby={spec.mode === 'select' ? stateId : undefined}
          data-control-kind="button"
          data-mode={spec.mode}
          data-value={handle.value}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={onPointerUp}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={onPointerUp}
        >
          <i className="pbtn-cap" />
        </button>
        {led === 'right' ? ledEl : null}
      </span>
      {spec.mode === 'select' ? (
        <span id={stateId} className="sr-only">
          {valueText(handle)} selected
        </span>
      ) : null}
      {legendBelow ? <span className="lgd pbtn-legend-below">{legendBelow}</span> : null}
    </span>
  )
}

/**
 * Selector LED block: the options of a select button rendered as LEDs with printed labels.
 * `matrix` = two columns of three (labels outside), `stack` = vertical list, `row` = horizontal.
 */
export function SelectorLeds({ id, layout = 'stack', color = 'red', labels, className = '' }: { id: string; layout?: 'matrix' | 'stack' | 'row' | 'stack-right'; color?: 'red' | 'green' | 'yellow'; labels?: (string | null)[]; className?: string }) {
  const handle = useControl(id)
  const spec = handle.spec
  if (spec.kind !== 'button' || spec.mode !== 'select') return null
  const options = spec.options ?? []
  const names = labels ?? options
  if (layout === 'matrix') {
    const half = Math.ceil(options.length / 2)
    const left = options.slice(0, half)
    const right = options.slice(half)
    return (
      <span className={`sel-matrix ${className}`} aria-hidden="true">
        <span className="sel-col sel-col-left">
          {left.map((_, i) => (
            <span key={i} className="lgd">
              {names[i]}
            </span>
          ))}
        </span>
        <span className="sel-leds">
          {left.map((_, i) => (
            <span key={i} className="sel-led-row">
              <i className={`led led-tri led-tri-left led-${color}${handle.value === i ? ' lit' : ''}`} />
              <i className={`led led-tri led-tri-right led-${color}${handle.value === i + half ? ' lit' : ''}`} />
            </span>
          ))}
        </span>
        <span className="sel-col sel-col-right">
          {right.map((_, i) => (
            <span key={i} className="lgd">
              {names[i + half]}
            </span>
          ))}
        </span>
      </span>
    )
  }
  return (
    <span className={`sel-${layout} ${className}`} aria-hidden="true">
      {options.map((_, i) =>
        names[i] === null ? null : (
          <span key={i} className={`sel-item${handle.value === i ? ' is-on' : ''}`}>
            {layout === 'stack-right' ? <span className="lgd">{names[i]}</span> : null}
            <i className={`led led-${color}${handle.value === i ? ' lit' : ''}`} />
            {layout !== 'stack-right' ? <span className="lgd">{names[i]}</span> : null}
          </span>
        ),
      )}
    </span>
  )
}
