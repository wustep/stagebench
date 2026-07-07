import { memo, useCallback, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { getControl } from '../model/hardware'
import { PresentationStore, usePresentationPressed, usePresentationToggle, usePresentationValue } from '../state/presentation'

/**
 * Panel hardware widgets. Every widget is pointer- and keyboard-operable and
 * exposes role/name/value. All writes go through the panel store front door,
 * which forwards FUNCTIONAL controls (Piano/effects/rotary/master/Panic) to
 * canonical instrument state and keeps DECORATIVE controls presentation-only.
 */

interface ContinuousProps {
  store: PresentationStore
  id: string
  /** Extra class for sizing variants. */
  className?: string
}

function useContinuous(store: PresentationStore, id: string) {
  const control = getControl(id)
  const value = usePresentationValue(store, id)
  // Morph destination indicator (manual p. 39): sources assigned to this control.
  const morphTag = useSyncExternalStore(store.subscribe, () => store.morphTag(id))
  const min = control.min ?? 0
  const max = control.max ?? 127
  const range = max - min
  const dragState = useRef<{ pointerId: number; lastX: number; lastY: number; value: number } | null>(null)

  const onKeyDown = (event: ReactKeyboardEvent) => {
    let next: number | null = null
    const step = Math.max(1, Math.round(range / 32))
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = value + step
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = value - step
    else if (event.key === 'PageUp') next = value + step * 4
    else if (event.key === 'PageDown') next = value - step * 4
    else if (event.key === 'Home') next = min
    else if (event.key === 'End') next = max
    if (next !== null) {
      event.preventDefault()
      store.setValue(id, next)
    }
  }
  // Spring-loaded controls (pitch stick): releasing the key is releasing the
  // stick — it springs back to center, exactly like the pointer path. Without
  // this, arrow keys would park a bend the hardware can never hold.
  const onKeyUp = control.springLoaded
    ? (event: ReactKeyboardEvent) => {
        if (SLIDER_STEP_KEYS.has(event.key)) {
          store.setValue(id, control.initial ?? 0)
        }
      }
    : undefined

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    // A second pointer must not hijack (and spring-recenter) an active drag.
    if (dragState.current) return
    event.currentTarget.focus()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // A pointer can be gone by the time capture is requested (touch
      // cancellation, synthetic events); the drag still tracks via move events.
    }
    event.currentTarget.setAttribute('data-dragging', 'true')
    dragState.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, value }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    let delta = drag.lastY - event.clientY
    // Drawbars are pulled out (toward the player, i.e. downward) to increase.
    if (control.type === 'drawbar') delta = -delta
    // The pitch stick moves SIDE TO SIDE on the hardware (right = bend up).
    if (control.type === 'stick') delta = event.clientX - drag.lastX
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    // Shift while dragging = fine adjust (quarter-speed). Applied to each
    // increment — never to the whole accumulated travel — so toggling Shift
    // mid-drag changes speed without the value jumping.
    const gain = event.shiftKey ? 0.25 : 1
    drag.value = Math.min(max, Math.max(min, drag.value + (delta / 200) * range * gain))
    store.setValue(id, drag.value)
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId !== event.pointerId) return
    dragState.current = null
    event.currentTarget.removeAttribute('data-dragging')
    if (control.springLoaded) store.setValue(id, control.initial ?? 0)
  }

  // Double-click resets knobs/dials to their initial position — a standard
  // continuous-control affordance (drawbars/faders keep their registration).
  const onDoubleClick =
    control.type === 'knob' || control.type === 'encoder'
      ? () => store.setValue(id, control.initial ?? min)
      : undefined

  // Scroll-wheel stepping. Attached as a NATIVE non-passive listener via a
  // ref callback: React's synthetic onWheel rides the root's passive listener,
  // so preventDefault there cannot reliably stop the page from scrolling.
  const latest = useRef({ value, range })
  latest.current = { value, range }
  const wheelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return undefined
      const onWheel = (event: WheelEvent) => {
        event.preventDefault()
        const { value: current, range: span } = latest.current
        // Shift = fine adjust (single-unit steps).
        const step = event.shiftKey ? 1 : Math.max(1, Math.round(span / 64))
        store.setValue(id, current + -Math.sign(event.deltaY) * step)
      }
      node.addEventListener('wheel', onWheel, { passive: false })
      return () => node.removeEventListener('wheel', onWheel)
    },
    [store, id],
  )

  const sliderProps = {
    // Spring-loaded controls (pitch stick) skip the wheel: a discrete wheel
    // tick has no "release" gesture, so honoring it would honestly have to
    // leave the bend parked off-center — the hardware stick can never rest
    // there, so we skip wheel input rather than fake an auto-return.
    ref: control.springLoaded ? undefined : wheelRef,
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': control.label,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': value,
    'aria-orientation': (control.type === 'stick' ? 'horizontal' : 'vertical') as 'horizontal' | 'vertical',
    'data-control-id': id,
    'data-decorative': control.decorative ? 'true' : 'false',
    'data-morphed': morphTag ?? undefined,
    onKeyDown,
    onKeyUp,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick,
  }
  return { control, value, min, max, range, sliderProps }
}

const SCALE_TEN = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']

/** Keys that step a slider role (shared by every spring-loaded key-up). */
const SLIDER_STEP_KEYS = new Set(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End'])

/** Printed arc scale around a knob (reference: nearly every panel knob wears
 *  a 0-10 numeral arc; EQ knobs are bipolar and the Amp Sim/EQ freq knob is
 *  labeled in Hz). Decorative print only — it never intercepts the pointer.
 *  Memo'd: label arrays are module constants, so the ~30-node SVG print
 *  fully bails while its knob's cap rotates through a drag or morph sweep. */
const KnobScaleArc = memo(function KnobScaleArc({ labels }: { labels: (string | null)[] }) {
  const last = labels.length - 1
  // The svg box matches the knob box (so it never adds scroll size to its
  // flex cell); the print draws OUTSIDE the viewBox with overflow visible.
  return (
    <svg className="knob-scale" viewBox="0 0 100 100" aria-hidden="true">
      {labels.map((label, i) => {
        const angle = ((-135 + (270 * i) / last) * Math.PI) / 180
        const sin = Math.sin(angle)
        const cos = Math.cos(angle)
        return (
          <g key={i}>
            <line x1={50 + sin * 54} y1={50 - cos * 54} x2={50 + sin * 62} y2={50 - cos * 62} />
            {label ? (
              // Numerals hug the ticks (reference print) — a wider radius
              // collides with neighboring knobs' arcs in the dense boxes.
              <text x={50 + sin * 72} y={50 - cos * 72}>
                {label}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
})

export interface KnobProps extends ContinuousProps {
  /** Printed scale: the default 0-10 arc, a custom label list (null = bare
   *  tick), or none (the reference's Master Level knob has no scale). */
  scale?: 'ten' | 'none' | (string | null)[]
}

export const Knob = memo(function Knob({ store, id, className, scale = 'ten' }: KnobProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const angle = -135 + ((value - min) / range) * 270
  const labels = scale === 'none' ? null : scale === 'ten' ? SCALE_TEN : scale
  return (
    <div {...sliderProps} className={`knob ${className ?? ''}`}>
      {labels && <KnobScaleArc labels={labels} />}
      <div className="knob-cap" style={{ transform: `rotate(${angle}deg)` }}>
        <div className="knob-index" />
      </div>
    </div>
  )
})

export const Encoder = memo(function Encoder({ store, id, className }: ContinuousProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const angle = ((value - min) / range) * 330
  // Endless encoders have NO pointer line (reference photo) — the knurled
  // rim rotating is the only visual motion, exactly like the hardware.
  return (
    <div {...sliderProps} className={`encoder ${className ?? ''}`}>
      <div className="encoder-cap" style={{ transform: `rotate(${angle}deg)` }} />
    </div>
  )
})

export const Fader = memo(function Fader({ store, id, className }: ContinuousProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const travel = (1 - (value - min) / range) * 100
  return (
    <div {...sliderProps} className={`fader ${className ?? ''}`}>
      <div className="fader-track" />
      <div className="fader-cap" style={{ top: `calc(${travel}% - ${travel / 100} * var(--fader-cap-h))` }} />
    </div>
  )
})

export const Drawbar = memo(function Drawbar({ store, id, className }: ContinuousProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  // Drawbar pulled OUT (toward the player) = higher value = cap travels
  // down. The travel lives in the full recessed slot (photo): pushed IN
  // the cap tops out beside the ladder's #4 numeral (~24%), and a full
  // pull parks the cap at the slot's bottom lip (~98%; the 1–8 LEDs only
  // label the upper registration band, not the physical travel limit).
  const norm = (value - min) / range
  const travel = norm * 74
  return (
    <div {...sliderProps} className={`drawbar ${className ?? ''}`}>
      <div className="drawbar-shaft" style={{ height: `${travel}%` }} />
      <div className="drawbar-cap" style={{ top: `calc(24% + ${travel}% - ${norm} * var(--drawbar-cap-h))` }}>
        <span className="drawbar-line" />
      </div>
    </div>
  )
})

export const Wheel = memo(function Wheel({ store, id, className }: ContinuousProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  const norm = (value - min) / range
  const travel = (0.5 - norm) * 40
  // The thumb dimple is a feature ON the rubber, so it rolls with the value
  // across most of the visible crown — the main motion cue (the grain tile
  // scrolling alone was too subtle to notice).
  const dimpleTop = 82 - norm * 64
  return (
    <div {...sliderProps} className={`wheel ${className ?? ''}`}>
      <div className="wheel-face" style={{ backgroundPosition: `50% calc(50% + ${travel}%)` }}>
        <span className="wheel-dimple" style={{ top: `${dimpleTop}%` }} aria-hidden="true" />
      </div>
    </div>
  )
})

export const PitchStick = memo(function PitchStick({ store, id, className }: ContinuousProps) {
  const { value, min, range, sliderProps } = useContinuous(store, id)
  // The stick rests centered in its slot and SLIDES side to side with the
  // bend (right = up), like the hardware seen from above. Travel is capped
  // so the wood tip stays inside the pocket at full bend; a slight pivot
  // around the hidden left anchor makes the motion readable at panel scale.
  const travel = ((value - min) / range - 0.5) * 26
  return (
    <div {...sliderProps} className={`pitch-stick ${className ?? ''}`}>
      <div
        className="pitch-stick-lever"
        style={{ transform: `translateX(${travel}%) rotate(${travel * 0.14}deg)` }}
      />
    </div>
  )
})

/** Press-and-hold duration (manual p. 18: "roughly half a second") before a
 *  holdAction fires instead of the normal click toggle. */
const HOLD_MS = 500

export interface PanelButtonProps {
  store: PresentationStore
  id: string
  className?: string
  /** Small legend printed on/next to the button. */
  children?: ReactNode
  led?: 'green' | 'red' | 'yellow' | 'none'
  /** Fires when the button is held for HOLD_MS instead of clicked (manual p.
   *  18 SOLO gesture); a quick click still performs the normal toggle. */
  holdAction?: () => void
}

export const PanelButton = memo(function PanelButton({ store, id, className, children, led = 'none', holdAction }: PanelButtonProps) {
  const control = getControl(id)
  const lit = usePresentationToggle(store, id)
  const pressed = usePresentationPressed(store, id)
  const latching = control.latching === true
  const holdTimer = useRef<number | null>(null)
  const held = useRef(false)

  const clearHoldTimer = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }

  const startHold = () => {
    // A second activation (Enter + Space, pointer + key, second touch) must
    // not leak the first timer — a leaked timer fires the hold action after
    // everything is released.
    clearHoldTimer()
    held.current = false
    holdTimer.current = window.setTimeout(() => {
      held.current = true
      holdTimer.current = null
      holdAction?.()
    }, HOLD_MS)
  }

  // Momentary press visuals go through the SHARED store (not just CSS
  // :active) so the magnifier lens clone and section-zoom render of this
  // same control travel with the press too.
  const onPointerDown = () => {
    store.pressControl(id)
    if (holdAction) startHold()
  }

  const onPointerUp = () => {
    store.releaseControl(id)
    if (holdAction) clearHoldTimer()
  }

  // Keyboard hold parity: holding Enter/Space for HOLD_MS performs the same
  // SOLO gesture as a pointer hold. preventDefault suppresses the browser's
  // native key-activation click (Enter fires it on keydown, before the hold
  // could elapse); a quick press toggles from keyup instead.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (!event.repeat) store.pressControl(id)
    if (!holdAction) return
    event.preventDefault()
    if (event.repeat) return
    startHold()
  }

  const onKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    store.releaseControl(id)
    if (!holdAction) return
    if (held.current) {
      // The hold already fired the solo action; swallow the release.
      held.current = false
      return
    }
    if (holdTimer.current !== null) {
      clearHoldTimer()
      store.toggle(id)
    }
  }

  const onBlur = () => {
    store.releaseControl(id)
    if (holdAction) clearHoldTimer()
  }

  const onClick = () => {
    // A hold already fired the solo action; suppress the trailing click toggle.
    if (held.current) {
      held.current = false
      return
    }
    store.toggle(id)
  }

  return (
    <button
      type="button"
      className={`panel-button ${className ?? ''}`}
      data-control-id={id}
      data-decorative={control.decorative ? 'true' : 'false'}
      aria-label={control.label}
      aria-pressed={latching ? lit : undefined}
      data-lit={latching && lit ? 'true' : undefined}
      data-pressed={pressed ? 'true' : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
      onClick={onClick}
    >
      {led !== 'none' && <span className={`btn-led led-${led}`} data-on={latching && lit ? 'true' : 'false'} aria-hidden="true" />}
      <span className="panel-button-cap" aria-hidden="true">{children}</span>
    </button>
  )
})

/* ------------------------------------------------------- passive detail -- */

export function Led({ color = 'green', on = false, className }: { color?: 'green' | 'red' | 'yellow'; on?: boolean; className?: string }) {
  return <span className={`led led-${color} ${className ?? ''}`} data-on={on ? 'true' : 'false'} aria-hidden="true" />
}

export function LedLadder({
  count = 10,
  lit = 0,
  color = 'green',
  fill = 'up',
  rangeLit,
  className,
}: {
  count?: number
  lit?: number
  color?: 'green' | 'red'
  /** 'up' lights from the bottom (level meters); 'down' from the top (drawbar amount). */
  fill?: 'up' | 'down'
  /** Morph assignment range (manual p. 39 indicator nicety): LEDs between
   *  `from`/`to` (inclusive, 0-indexed from the ladder's lit end) render at a
   *  dim "range" state instead of fully on/off. */
  rangeLit?: { from: number; to: number }
  className?: string
}) {
  const rangeFrom = rangeLit ? Math.min(rangeLit.from, rangeLit.to) : null
  const rangeTo = rangeLit ? Math.max(rangeLit.from, rangeLit.to) : null
  return (
    <span className={`led-ladder ${className ?? ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const position = fill === 'up' ? count - 1 - i : i
        const inRange = rangeFrom !== null && rangeTo !== null && position >= rangeFrom && position <= rangeTo
        return (
          <span
            key={i}
            className={`led led-${color}`}
            data-on={(fill === 'up' ? i >= count - lit : i < lit) ? 'true' : 'false'}
            data-range={inRange ? 'true' : undefined}
          />
        )
      })}
    </span>
  )
}

export function Legend({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`legend ${className ?? ''}`}>{children}</span>
}

export function GroupBox({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`group-box ${className ?? ''}`} role="group" aria-label={title}>
      <span className="group-box-title" aria-hidden="true">{title}</span>
      {children}
    </div>
  )
}

export function Oled({ section, lines, className }: { section: 'program' | 'synth'; lines: ReactNode[]; className?: string }) {
  return (
    <div className={`oled ${className ?? ''}`} data-oled-section={section} data-testid={`oled-${section}`} role="img" aria-label={`${section === 'program' ? 'Program' : 'Synth'} display`}>
      {lines.map((line, i) => (
        <div key={i} className="oled-line">{line}</div>
      ))}
    </div>
  )
}
