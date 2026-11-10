import { memo, useRef, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { DRAWBAR, SIZE } from '../hardware/builder'
import { fraction, valueText, type HardwareStore } from '../hardware/store'
import type { ButtonDef, KnobScale, LabelDef, LedDef, PlateDef, RangeDef } from '../hardware/types'

/** ID of the visually hidden sentence every panel control points at with aria-describedby. */
export const DECORATIVE_NOTE_ID = 'decorative-note'
export const DECORATIVE_NOTE = 'Decorative in Phase 1: it moves, but it does not change the sound.'

function box(def: { x: number; y: number; w: number; h: number }): CSSProperties {
  return { left: def.x - def.w / 2, top: def.y - def.h / 2, width: def.w, height: def.h }
}

function useValue(store: HardwareStore, id: string): number {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getValue(id),
    () => store.getValue(id),
  )
}

// ── Buttons ───────────────────────────────────────────────────────────────────

interface ButtonProps {
  def: ButtonDef
  store: HardwareStore
}

/** How long after a pointer/keyboard release a native `click` is treated as its echo. */
const CLICK_ECHO_MS = 700

export const ButtonControl = memo(function ButtonControl({ def, store }: ButtonProps) {
  const step = useValue(store, def.id)
  const pressed = useSyncExternalStore(
    store.subscribe,
    () => store.isPressed(def.id),
    () => store.isPressed(def.id),
  )
  const presses = useSyncExternalStore(
    store.subscribe,
    () => store.getPressCount(def.id),
    () => store.getPressCount(def.id),
  )
  /** Time of the last pointer or keyboard release we handled ourselves, committed or not. */
  const lastHandled = useRef(-Infinity)

  const letGo = (timeStamp: number, commit: boolean) => {
    lastHandled.current = timeStamp
    store.release(def.id, commit)
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    store.press(def.id)
  }
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!store.isPressed(def.id)) return
    const rect = event.currentTarget.getBoundingClientRect()
    const measurable = rect.width > 0 && rect.height > 0
    const inside =
      !measurable ||
      (event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom)
    // Letting go outside the cap cancels the press, like sliding a finger off a real button.
    letGo(event.timeStamp, inside)
  }
  const cancel = () => store.release(def.id, false)

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    if (!event.repeat) store.press(def.id)
  }
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    if (store.isPressed(def.id)) letGo(event.timeStamp, true)
  }
  // Assistive technology and scripted clicks arrive as a bare `click` with no press before it.
  // A click that merely echoes a release we already handled (including a cancelled one) is ignored.
  const onClick = (event: { timeStamp: number }) => {
    if (store.isPressed(def.id)) return
    if (event.timeStamp - lastHandled.current < CLICK_ECHO_MS) return
    store.activate(def.id)
  }

  const isToggle = def.steps === 2 && !def.stepLabels?.some((label) => label !== 'Off' && label !== 'On')
  const position = def.stepLabels?.[step]
  const description =
    def.steps > 2 || (def.steps === 2 && !isToggle)
      ? `Indicator at ${position} (${step + 1} of ${def.steps}). ${DECORATIVE_NOTE}`
      : DECORATIVE_NOTE

  return (
    <button
      type="button"
      id={def.id}
      className={[
        'ctl',
        'btn',
        `btn--${def.look}`,
        `btn--${def.orientation}`,
        def.surround ? 'btn--surround' : '',
        pressed ? 'is-down' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={box(def)}
      aria-label={def.name}
      aria-pressed={isToggle ? step === 1 : undefined}
      aria-description={description}
      data-control-id={def.id}
      data-kind="button"
      data-decorative="true"
      data-step={def.steps > 0 ? step : undefined}
      data-step-label={position}
      data-pressed={pressed ? 'true' : 'false'}
      data-presses={presses}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onBlur={cancel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onClick={onClick}
    />
  )
})

// ── Knobs, dials, faders, drawbars, wheel, stick ──────────────────────────────

interface RangeProps {
  def: RangeDef
  store: HardwareStore
}

interface Drag {
  pointerId: number
  startX: number
  startY: number
  startValue: number
  /** Screen px of pointer travel that covers the control's whole range. */
  travel: number
}

/** Screen px of drag for a knob's full sweep, independent of zoom. */
const KNOB_TRAVEL = 150

function isHorizontal(def: RangeDef): boolean {
  return def.kind === 'stick'
}

/** Sign of "value goes up" for an upward drag. Drawbars pull toward the player, so down is more. */
function dragSign(def: RangeDef): number {
  return def.kind === 'drawbar' ? -1 : 1
}

function measureTravel(def: RangeDef, rect: { width: number; height: number }): number {
  switch (def.kind) {
    case 'fader':
      return rect.height > 0 ? rect.height * (1 - SIZE.faderCapH / def.h) : 100
    case 'drawbar':
      return rect.height > 0 ? rect.height * ((DRAWBAR.perStep * DRAWBAR.steps) / def.h) : 100
    case 'wheel':
      return rect.height > 0 ? rect.height * 0.7 : 100
    case 'stick':
      return rect.width > 0 ? rect.width : 100
    default:
      return KNOB_TRAVEL
  }
}

export const RangeControl = memo(function RangeControl({ def, store }: RangeProps) {
  const value = useValue(store, def.id)
  const drag = useRef<Drag | null>(null)
  const frac = fraction(def, value)

  const spring = () => {
    if (def.springTo !== undefined) store.setValue(def.id, def.springTo)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startValue: store.getValue(def.id),
      travel: measureTravel(def, event.currentTarget.getBoundingClientRect()),
    }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const delta = isHorizontal(def)
      ? event.clientX - current.startX
      : (current.startY - event.clientY) * dragSign(def)
    store.setValue(def.id, current.startValue + (delta / current.travel) * (def.max - def.min))
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    spring()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const up = def.kind === 'drawbar' ? 'ArrowDown' : 'ArrowUp'
    const down = def.kind === 'drawbar' ? 'ArrowUp' : 'ArrowDown'
    let handled = true
    if (event.key === up || event.key === 'ArrowRight') store.nudge(def.id, def.keyStep)
    else if (event.key === down || event.key === 'ArrowLeft') store.nudge(def.id, -def.keyStep)
    else if (event.key === 'PageUp') store.nudge(def.id, def.bigStep)
    else if (event.key === 'PageDown') store.nudge(def.id, -def.bigStep)
    else if (event.key === 'Home') store.setValue(def.id, def.min)
    else if (event.key === 'End') store.setValue(def.id, def.max)
    else handled = false
    if (handled) event.preventDefault()
  }
  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key.startsWith('Arrow') || event.key.startsWith('Page')) spring()
  }

  const common = {
    id: def.id,
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': def.name,
    'aria-valuemin': def.min,
    'aria-valuemax': def.max,
    'aria-valuenow': value,
    'aria-valuetext': valueText(def, value),
    'aria-orientation': isHorizontal(def) ? ('horizontal' as const) : ('vertical' as const),
    'aria-describedby': DECORATIVE_NOTE_ID,
    'data-control-id': def.id,
    'data-kind': def.kind,
    'data-decorative': 'true',
    'data-value': value,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
    onBlur: spring,
    onKeyDown,
    onKeyUp,
    onDoubleClick: () => store.setValue(def.id, def.initial),
  }

  switch (def.kind) {
    case 'knob':
      return (
        <div {...common} className={`ctl knob knob--${def.scale}${def.onLight ? ' knob--on-light' : ''}`} style={box(def)}>
          <KnobScaleMarks scale={def.scale} size={def.w} />
          <span className="knob__cap" style={{ transform: `rotate(${-135 + frac * 270}deg)` }}>
            <span className="knob__pointer" />
          </span>
        </div>
      )
    case 'encoder':
      return (
        <div {...common} className={`ctl knob knob--dial${def.ring ? ' knob--ring' : ''}`} style={box(def)}>
          <span className="knob__cap" style={{ transform: `rotate(${(value / (def.max + 1)) * 360}deg)` }}>
            <span className="knob__dimple" />
          </span>
        </div>
      )
    case 'fader':
      return (
        <>
          <FaderLadder def={def} frac={frac} />
          <div {...common} className="ctl fader" style={box(def)}>
            <span className="fader__slot" />
            <span className="fader__cap" style={{ top: (1 - frac) * (def.h - SIZE.faderCapH) }} />
          </div>
        </>
      )
    case 'drawbar':
      return (
        <>
          <DrawbarGraph def={def} value={value} />
          <div {...common} className="ctl drawbar" style={box(def)}>
            <span className="drawbar__slot" />
            <span className={`drawbar__cap drawbar__cap--${def.cap}`} style={{ top: value * DRAWBAR.perStep }} />
          </div>
        </>
      )
    case 'wheel':
      return (
        <div {...common} className="ctl wheel" style={{ ...box(def), transform: `rotate(${def.tilt ?? 0}deg)` }}>
          <span className="wheel__body">
            <span className="wheel__notch" style={{ top: `${72 - frac * 58}%` }} />
          </span>
        </div>
      )
    case 'stick':
      return (
        <div {...common} className="ctl stick" style={{ ...box(def), transform: `rotate(${def.tilt ?? 0}deg)` }}>
          <span className="stick__wood" style={{ transform: `translateX(${(value / 100) * 34}px)` }} />
        </div>
      )
  }
})

const LADDER_SEGMENTS = 12

/** Twelve-segment level ladder printed beside each layer fader; follows the fader position. */
function FaderLadder({ def, frac }: { def: RangeDef; frac: number }) {
  const lit = Math.round(frac * LADDER_SEGMENTS)
  return (
    <span
      className="ladder"
      aria-hidden="true"
      data-ladder-for={def.id}
      data-lit={lit}
      style={{ left: def.x + 70, top: def.y - def.h / 2 + 12, height: def.h - 42 }}
    >
      {Array.from({ length: LADDER_SEGMENTS }, (_, index) => (
        <i key={index} className={LADDER_SEGMENTS - index <= lit ? 'is-lit' : undefined} />
      ))}
    </span>
  )
}

/** Eight numbered LEDs beside each drawbar; lit from the top down to the drawbar's value. */
function DrawbarGraph({ def, value }: { def: RangeDef; value: number }) {
  const top = def.y - def.h / 2 - 120
  return (
    <span
      className="bar-graph"
      aria-hidden="true"
      data-graph-for={def.id}
      data-lit={value}
      style={{ left: def.x + 18, top }}
    >
      {Array.from({ length: DRAWBAR.steps }, (_, index) => (
        <span key={index} className="bar-graph__row">
          <b>{index + 1}</b>
          <i className={index < value ? 'is-lit' : undefined} />
        </span>
      ))}
    </span>
  )
}

const SCALES: Record<KnobScale, ReadonlyArray<readonly [string, number]>> = {
  none: [],
  master: [],
  'zero-to-ten': Array.from({ length: 11 }, (_, index) => [String(index), -130 + index * 26] as const),
  'bipolar-10': [
    ['-10', -130],
    ['-5', -65],
    ['0', 0],
    ['5', 65],
    ['10', 130],
  ],
  'bipolar-15': [
    ['-15', -130],
    ['-10', -87],
    ['-5', -43],
    ['0', 0],
    ['5', 43],
    ['10', 87],
    ['15', 130],
  ],
  'eq-freq': [
    ['200', -130],
    ['250', -98],
    ['400', -65],
    ['600', -33],
    ['1K', 0],
    ['2K', 33],
    ['4K', 65],
    ['6K', 98],
    ['8K', 130],
  ],
  'arp-range': [
    ['0', -130],
    ['1', -66],
    ['2', -22],
    ['3', 22],
    ['4', 66],
    ['10', 130],
  ],
}

/** Numerals printed around a knob. Part of the legend, not part of the control's box. */
function KnobScaleMarks({ scale, size }: { scale: KnobScale; size: number }) {
  const marks = SCALES[scale]
  if (marks.length === 0) return null
  const radius = size / 2 + 15
  return (
    <span className="knob__scale" aria-hidden="true">
      {scale === 'arp-range' ? <span className="knob__arc" /> : null}
      {marks.map(([text, angle]) => {
        const radians = (angle * Math.PI) / 180
        return (
          <span
            key={text + angle}
            style={{ left: size / 2 + Math.sin(radians) * radius, top: size / 2 - Math.cos(radians) * radius }}
          >
            {text}
          </span>
        )
      })}
    </span>
  )
}

// ── LEDs, legends, plates ─────────────────────────────────────────────────────

export const Led = memo(function Led({ def, store }: { def: LedDef; store: HardwareStore }) {
  const lit = useSyncExternalStore(
    store.subscribe,
    () => store.isLedLit(def),
    () => store.isLedLit(def),
  )
  return (
    <span
      id={def.id}
      aria-hidden="true"
      className={`led led--${def.color} led--${def.shape}${lit ? ' is-lit' : ''}`}
      data-lit={lit ? 'true' : 'false'}
      style={{ left: def.x, top: def.y }}
    />
  )
})

/**
 * Legends are set a touch smaller than measured (and narrowed in CSS) so their printed
 * widths match the photo's condensed face and never run into the LED beside them.
 */
const LEGEND_FIT = 0.97

export const Label = memo(function Label({ def }: { def: LabelDef }) {
  const classes = ['lbl', `lbl--${def.font}`, `lbl--${def.tone}`]
  if (def.box !== 'none') classes.push(`lbl--${def.box}`)
  if (def.align !== 'center') classes.push(`lbl--${def.align}`)
  if (def.vertical) classes.push('lbl--vertical')
  return (
    <span
      id={def.id}
      aria-hidden="true"
      className={classes.join(' ')}
      style={{ left: def.x, top: def.y, fontSize: def.font === 'legend' ? def.size * LEGEND_FIT : def.size }}
    >
      {def.text}
    </span>
  )
})

export const Plate = memo(function Plate({ def }: { def: PlateDef }) {
  return (
    <span
      aria-hidden="true"
      className={`plate plate--${def.style}`}
      style={{ left: def.x, top: def.y, width: def.w, height: def.h, borderRadius: def.radius }}
    />
  )
})
