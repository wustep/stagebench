import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { isNumeric, isSelector, type ControlSpec, type NumericControl, type SelectorControl, type SwitchControl } from '../hardware/types'
import type { PresentationStore } from '../hardware/presentation'

/**
 * Every visible physical input renders through one of the components in this file.
 *
 * All of them are real focusable widgets with an accessible name, role and value:
 * ranges are `role="slider"`, toggles are `role="switch"`, selectors are
 * `role="radiogroup"`, momentary buttons are `role="button"`. Pointer, wheel and
 * keyboard all drive the same presentation store, and nothing they change leaves it.
 */

export interface ControlViewProps {
  control: ControlSpec
  store: PresentationStore
  value: number | boolean
  pressed: boolean
  compact?: boolean
}

const BIG_STEP = 10

function ariaValueTextFor(control: NumericControl, value: number): string {
  if (control.kind === 'drawbar') return `${value} of ${control.max}`
  if (control.scale) return `${value.toFixed(1)} (${control.scale[0]} to ${control.scale[1]})`
  return `${value}`
}

/** Shared drag behaviour: vertical drag changes the value, like the physical control. */
function useDragValue(
  store: PresentationStore,
  control: NumericControl,
  value: number,
  onDone: () => void,
) {
  const drag = useRef<{ startY: number; startValue: number; pointerId: number } | null>(null)
  const range = control.max - control.min

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return
      drag.current = { startY: event.clientY, startValue: value, pointerId: event.pointerId }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      event.preventDefault()
    },
    [value],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current
      if (!state || state.pointerId !== event.pointerId) return
      // 160 px of travel covers the whole range; drawbars are stepped so they feel indexed.
      const pixels = 160
      const delta = ((state.startY - event.clientY) / pixels) * range
      store.set(control.id, state.startValue + delta, 'pointer')
    },
    [control.id, range, store],
  )

  const finish = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current
      if (!state || state.pointerId !== event.pointerId) return
      drag.current = null
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      onDone()
    },
    [onDone],
  )

  return { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish }
}

interface RangeProps {
  control: NumericControl
  store: PresentationStore
  value: number
  compact?: boolean
}

export function RangeControl({ control, store, value, compact }: RangeProps) {
  const onDone = useCallback(() => {
    if (control.spring) store.releaseSpring(control.id)
  }, [control.id, control.spring, store])
  const drag = useDragValue(store, control, value, onDone)

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const step = control.step || 0.01
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        store.set(control.id, value + step, 'keyboard')
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        store.set(control.id, value - step, 'keyboard')
        break
      case 'PageUp':
        store.set(control.id, value + (control.max - control.min) / BIG_STEP, 'keyboard')
        break
      case 'PageDown':
        store.set(control.id, value - (control.max - control.min) / BIG_STEP, 'keyboard')
        break
      case 'Home':
        store.set(control.id, control.min, 'keyboard')
        break
      case 'End':
        store.set(control.id, control.max, 'keyboard')
        break
      case ' ':
      case 'Enter':
        // Press-and-release on a spring control is a real gesture; on others it is inert.
        if (control.spring) store.set(control.id, control.max, 'keyboard')
        else store.set(control.id, value, 'keyboard')
        break
      default:
        return
    }
    event.preventDefault()
  }

  const percent = ((value - control.min) / (control.max - control.min)) * 100
  const classes = ['ctl', `ctl-${control.kind}`, `ctl-${control.size ?? 'md'}`]
  if (compact) classes.push('ctl-compact')
  const rotary = control.kind === 'knob' || control.kind === 'dial'

  return (
    <div className={classes.join(' ')} data-control-id={control.id} data-kind={control.kind}>
      <div className="ctl-body">
        {control.leds ? <LedLadder value={value} max={control.max} leds={control.leds} /> : null}
        <div
          className="ctl-track"
          role="slider"
          tabIndex={0}
          aria-label={control.name}
          aria-valuemin={control.min}
          aria-valuemax={control.max}
          aria-valuenow={value}
          aria-valuetext={ariaValueTextFor(control, value)}
          aria-orientation={rotary ? 'horizontal' : 'vertical'}
          data-testid={`control-${control.id}`}
          onKeyDown={onKeyDown}
          {...drag}
          onDoubleClick={() => store.set(control.id, control.value, 'pointer')}
          style={{
            // `--ctl-pct` drives the cap position and the knob rotation in one place.
            ['--ctl-pct' as string]: `${percent}`,
            ['--ctl-inv' as string]: `${100 - percent}`,
            ['--ctl-angle' as string]: `${-135 + (percent / 100) * 270}deg`,
          }}
        >
          <span className={`ctl-cap cap-${control.cap ?? 'black'}`} aria-hidden="true" />
          <span className="ctl-indicator" aria-hidden="true" />
        </div>
      </div>
      <span className="ctl-legend" aria-hidden="true">
        {control.legend}
      </span>
      {control.scale ? (
        <span className="ctl-scale" aria-hidden="true">
          <span>{control.scale[0]}</span>
          <span>{control.scale[1]}</span>
        </span>
      ) : null}
    </div>
  )
}

export function LedLadder({ value, max, leds }: { value: number; max: number; leds: number }) {
  const lit = max === 0 ? 0 : Math.round((value / max) * leds)
  return (
    <span className="led-ladder" aria-hidden="true">
      {Array.from({ length: leds }, (_, i) => (
        <span key={i} className={`led-ladder-dot ${i < lit ? 'lit' : ''}`} />
      ))}
    </span>
  )
}

interface ToggleProps {
  control: SwitchControl
  store: PresentationStore
  value: boolean
  pressed: boolean
  compact?: boolean
}

export function ToggleControl({ control, store, value, pressed, compact }: ToggleProps) {
  const momentary = control.momentary === true
  const classes = ['ctl', 'ctl-toggle', `ctl-${control.size ?? 'sm'}`]
  if (momentary) classes.push('ctl-momentary')
  if (compact) classes.push('ctl-compact')

  const activate = () => {
    if (momentary) return
    store.set(control.id, !value, 'pointer')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (momentary) {
        store.setPressed(control.id, true)
        return
      }
      store.set(control.id, !value, 'keyboard')
    }
  }
  const onKeyUp = (event: React.KeyboardEvent<HTMLElement>) => {
    if (momentary && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault()
      store.setPressed(control.id, false)
    }
  }

  const common = {
    tabIndex: 0,
    'aria-label': control.name,
    'data-testid': `control-${control.id}`,
    className: `ctl-track ctl-track-toggle ${control.led && control.led !== 'none' ? `led-${control.led}` : ''} ${
      value && !momentary ? 'is-on' : ''
    } ${pressed ? 'is-pressed' : ''}`,
    onKeyDown,
    onKeyUp,
    onBlur: () => {
      if (momentary) store.setPressed(control.id, false)
    },
  }

  return (
    <div className={classes.join(' ')} data-control-id={control.id} data-kind={control.kind}>
      <div className="ctl-body">
        {momentary ? (
          <button
            type="button"
            {...common}
            role="button"
            aria-pressed={pressed}
            onPointerDown={(event) => {
              if (event.button !== 0 && event.pointerType === 'mouse') return
              event.currentTarget.setPointerCapture?.(event.pointerId)
              store.setPressed(control.id, true)
            }}
            onPointerUp={() => store.setPressed(control.id, false)}
            onPointerCancel={() => store.setPressed(control.id, false)}
            onPointerLeave={(event) => {
              if (event.buttons === 0) store.setPressed(control.id, false)
            }}
            onClick={(event) => {
              // A click is the accessible "activate" path; pointer already handled press.
              if (event.detail === 0) store.setPressed(control.id, false)
            }}
          >
            {control.led && control.led !== 'none' ? <span className={`led led-${control.led}`} aria-hidden="true" /> : null}
            <span className="ctl-face" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" {...common} role="switch" aria-checked={value} onClick={activate}>
            {control.led && control.led !== 'none' ? <span className={`led led-${control.led}`} aria-hidden="true" /> : null}
            <span className="ctl-face" aria-hidden="true" />
          </button>
        )}
      </div>
      <span className="ctl-legend" aria-hidden="true">
        {control.legend}
      </span>
    </div>
  )
}

interface SelectorProps {
  control: SelectorControl
  store: PresentationStore
  value: number
  compact?: boolean
}

/**
 * A multi-position selector. Rendered as a radiogroup so each printed position has its
 * own accessible name and LED, which is how the hardware reads.
 */
export function SelectorControlView({ control, store, value, compact }: SelectorProps) {
  const groupId = useId()
  const classes = ['ctl', 'ctl-selector', `ctl-selector-${control.orientation ?? 'row'}`]
  if (compact) classes.push('ctl-compact')

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const vertical = control.orientation === 'column'
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        store.set(control.id, value - 1, 'keyboard')
        break
      case 'ArrowDown':
      case 'ArrowRight':
        store.set(control.id, value + 1, 'keyboard')
        break
      case 'Home':
        store.set(control.id, 0, 'keyboard')
        break
      case 'End':
        store.set(control.id, control.options.length - 1, 'keyboard')
        break
      default:
        void vertical
        return
    }
    event.preventDefault()
  }

  return (
    <div
      className={classes.join(' ')}
      data-control-id={control.id}
      data-kind="selector"
      role="radiogroup"
      aria-label={control.name}
      onKeyDown={onKeyDown}
    >
      <div className="ctl-body ctl-selector-options">
        {control.options.map((option, index) => {
          const active = index === value
          return (
            <button
              key={`${control.id}.${option}`}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${control.name}: ${option}`}
              tabIndex={active ? 0 : -1}
              className={`ctl-option ${active ? 'is-on' : ''}`}
              data-testid={`control-${control.id}.${slug(option)}`}
              onClick={() => store.set(control.id, index, 'pointer')}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault()
                  store.set(control.id, index, 'keyboard')
                }
              }}
            >
              {control.led ? (
                <span
                  className={`led led-${control.led} ${active ? 'lit' : ''}`}
                  aria-hidden="true"
                  data-led-for={`${groupId}-${index}`}
                />
              ) : null}
              <span className="ctl-option-label" aria-hidden="true">
                {option}
              </span>
            </button>
          )
        })}
      </div>
      <span className="ctl-legend" aria-hidden="true">
        {control.legend}
      </span>
    </div>
  )
}

export function ControlView({ control, store, value, pressed, compact }: ControlViewProps) {
  if (isNumeric(control)) {
    return <RangeControl control={control} store={store} value={Number(value)} compact={compact} />
  }
  if (isSelector(control)) {
    return <SelectorControlView control={control} store={store} value={Number(value)} compact={compact} />
  }
  return (
    <ToggleControl control={control} store={store} value={Boolean(value)} pressed={pressed} compact={compact} />
  )
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Subscribes a component to one store value without re-rendering on unrelated changes. */
export function useControlValue(store: PresentationStore, id: string): number | boolean {
  const [value, setValue] = useState<number | boolean>(() => store.value(id) ?? 0)
  useEffect(() => {
    setValue(store.value(id) ?? 0)
    return store.subscribe((state) => {
      const next = state.values[id]
      if (next !== undefined) setValue(next)
    })
  }, [id, store])
  return value
}

export function usePressed(store: PresentationStore, id: string): boolean {
  const [pressed, setPressed] = useState(() => store.getState().pressed[id] === true)
  useEffect(() => {
    setPressed(store.getState().pressed[id] === true)
    return store.subscribe((state) => setPressed(state.pressed[id] === true))
  }, [id, store])
  return pressed
}
