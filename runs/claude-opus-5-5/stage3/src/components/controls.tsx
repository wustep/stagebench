// Panel controls. Each one moves/presses/lights through the normalized hardware store. Functional
// controls are bound to canonical instrument state by the store's binding and describe what they
// control; unsupported (spec-excluded) controls move/press only and say why.
import { memo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { HardwareAction } from '../model/hardwareStore'
import type {
  ButtonControl,
  ControlDef,
  DrawbarControl,
  EncoderControl,
  FaderControl,
  GraphDef,
  KnobControl,
  LedDef,
  StickControl,
  WheelControl,
} from '../model/panelTypes'
import { useControlState, useDescription, useHardwareStore, useIndicator, useMorphRange, useUnsupported, useValueText } from './hardwareContext'

export const DECORATIVE_NOTE = 'Unsupported: moves only, changes no sound or program state.'

/** Accessible description + title suffix: functional controls say what they control. */
function useNote(id: string): { note: string; functional: boolean; title: string } {
  const what = useDescription(id)
  const why = useUnsupported(id)
  if (what) return { note: `Functional: ${what}.`, functional: true, title: 'functional' }
  return { note: why ? `Unsupported (${why}): moves only, changes no sound or program state.` : DECORATIVE_NOTE, functional: false, title: 'unsupported' }
}

function box(def: { x: number; y: number; w: number; h: number }, left: number): CSSProperties {
  return { left: def.x - def.w / 2 - left, top: def.y - def.h / 2, width: def.w, height: def.h }
}

interface DragState {
  id: number
  x: number
  y: number
  start: number
  k: number
}

/** Pointer drag reporting deltas in design units (independent of the stage scale). */
function useDrag(def: ControlDef, onDelta: (dx: number, dy: number, start: number) => void) {
  const store = useHardwareStore()
  const drag = useRef<DragState | null>(null)
  const end = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    store.dispatch({ type: 'release', id: def.id })
  }
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const el = e.currentTarget
      const rect = el.getBoundingClientRect()
      const k = rect.width > 0 && def.w > 0 ? Math.max(rect.width, rect.height) / Math.max(def.w, def.h) : 1
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: store.get(def.id)?.value ?? 0, k }
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // Synthetic pointers (tests) cannot be captured.
      }
      el.focus({ preventScroll: true })
      store.dispatch({ type: 'press', id: def.id })
      e.preventDefault()
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      onDelta((e.clientX - d.x) / d.k, (e.clientY - d.y) / d.k, d.start)
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  }
}

function sliderKeys(
  dispatch: (a: HardwareAction) => void,
  id: string,
  min: number,
  max: number,
  step: number,
  page: number,
  onRelease?: () => void,
) {
  return {
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      let action: HardwareAction | null = null
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowRight':
          action = { type: 'step', id, delta: step }
          break
        case 'ArrowDown':
        case 'ArrowLeft':
          action = { type: 'step', id, delta: -step }
          break
        case 'PageUp':
          action = { type: 'step', id, delta: page }
          break
        case 'PageDown':
          action = { type: 'step', id, delta: -page }
          break
        case 'Home':
          action = { type: 'set', id, value: min }
          break
        case 'End':
          action = { type: 'set', id, value: max }
          break
      }
      if (action) {
        e.preventDefault()
        dispatch(action)
      }
    },
    onKeyUp: onRelease
      ? (e: KeyboardEvent<HTMLElement>) => {
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) onRelease()
        }
      : undefined,
  }
}

export const PanelButton = memo(function PanelButton({ def, left }: { def: ButtonControl; left: number }) {
  const store = useHardwareStore()
  const s = useControlState(def.id)
  const multi = def.states.length > 2
  const toggle = def.states.length === 2
  const lit = def.states[s.value]?.length > 0
  const n = useNote(def.id)
  const desc = def.states.length > 1 ? `${n.note} Indicator: ${def.stateNames[s.value]}.` : `${n.note} Momentary.`
  const press = () => store.dispatch({ type: 'press', id: def.id })
  const release = () => store.dispatch({ type: 'release', id: def.id })
  return (
    <button
      type="button"
      id={def.id}
      className={`hw hw-btn hw-btn-${def.style}${def.outline ? ' hw-outlined' : ''}${s.pressed ? ' is-pressed' : ''}${lit ? ' is-lit' : ''}`}
      style={box(def, left)}
      aria-label={def.label}
      aria-pressed={toggle ? s.value === 1 : undefined}
      aria-description={desc}
      data-kind="button"
      data-state={multi ? def.stateNames[s.value] : undefined}
      title={`${def.label} (${n.title})`}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onBlur={release}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) press()
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') release()
      }}
      onClick={() => store.dispatch({ type: 'activate', id: def.id })}
    />
  )
})

function scaleLabels(scale: KnobControl['scale']): string[] {
  switch (scale) {
    case 'unit':
      return ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
    case 'bipolar':
      return ['-10', '-5', '0', '5', '10']
    case 'eq':
      return ['-15', '-10', '-5', '0', '5', '10', '15']
    case 'range':
      return ['1', '2', '3', '4']
    case 'freq':
      return ['200', '250', '400', '600', '1K', '2K', '4K', '8K']
    default:
      return []
  }
}

const KnobScale = memo(function KnobScale({ def }: { def: KnobControl }) {
  const labels = scaleLabels(def.scale)
  const r = def.w / 2
  const pad = 7
  const size = def.w + pad * 2
  const c = size / 2
  const rt = r + 3.3
  return (
    <svg className="knob-scale" aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ left: -pad, top: -pad }}>
      {def.halo && def.scale === 'range' ? (
        <path d={arcPath(c, c, r + 1.8, -135, 135)} className="knob-arc" />
      ) : null}
      {labels.map((label, i) => {
        const a = ((-135 + (270 * i) / Math.max(1, labels.length - 1)) * Math.PI) / 180
        return (
          <text key={label + i} x={c + rt * Math.sin(a)} y={c - rt * Math.cos(a)} className="knob-num">
            {label}
          </text>
        )
      })}
    </svg>
  )
})

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (deg: number) => {
    const a = (deg * Math.PI) / 180
    return `${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}`
  }
  return `M ${p(a0)} A ${r} ${r} 0 1 1 ${p(a1)}`
}

export const Knob = memo(function Knob({ def, left }: { def: KnobControl; left: number }) {
  const store = useHardwareStore()
  const s = useControlState(def.id)
  const n = useNote(def.id)
  const range = def.max - def.min
  const drag = useDrag(def, (_dx, dy, start) => store.dispatch({ type: 'set', id: def.id, value: start - (dy * range) / 60 }))
  const angle = -135 + (270 * (s.value - def.min)) / range
  const pct = Math.round(((s.value - def.min) / range) * 100)
  return (
    <div
      id={def.id}
      role="slider"
      tabIndex={0}
      className={`hw hw-knob scale-${def.tone}${def.halo ? ' has-halo' : ''}${s.pressed ? ' is-pressed' : ''}`}
      style={box(def, left)}
      aria-label={def.label}
      aria-valuemin={def.min}
      aria-valuemax={def.max}
      aria-valuenow={s.value}
      aria-valuetext={n.functional ? `${pct}%` : `${pct}% (knob position only)`}
      aria-description={n.note}
      data-kind="knob"
      title={`${def.label} (${n.title})`}
      {...drag}
      {...sliderKeys(store.dispatch, def.id, def.min, def.max, Math.max(1, Math.round(range / 32)), Math.max(1, Math.round(range / 8)))}
    >
      {def.halo && def.scale !== 'range' ? <span className="knob-halo" aria-hidden="true" /> : null}
      <KnobScale def={def} />
      <span className="knob-cap" aria-hidden="true" style={{ transform: `rotate(${angle}deg)` }}>
        <span className="knob-pointer" />
      </span>
    </div>
  )
})

export const Encoder = memo(function Encoder({ def, left }: { def: EncoderControl; left: number }) {
  const store = useHardwareStore()
  const s = useControlState(def.id)
  const n = useNote(def.id)
  const text = useValueText(def.id)
  const drag = useDrag(def, (_dx, dy, start) => store.dispatch({ type: 'set', id: def.id, value: start - dy / 3 }))
  return (
    <div
      id={def.id}
      role="spinbutton"
      tabIndex={0}
      className={`hw hw-encoder${s.pressed ? ' is-pressed' : ''}`}
      style={box(def, left)}
      aria-label={def.label}
      aria-valuenow={s.value}
      aria-valuetext={n.functional ? (text ?? `model ${s.value + 1}`) : `${s.value} detents (endless encoder, position only)`}
      aria-description={n.note}
      data-kind="encoder"
      title={`${def.label} (${n.title})`}
      {...drag}
      onKeyDown={(e) => {
        const delta = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : e.key === 'PageUp' ? 8 : e.key === 'PageDown' ? -8 : 0
        if (delta) {
          e.preventDefault()
          store.dispatch({ type: 'step', id: def.id, delta })
        }
      }}
    >
      <span className="encoder-cap" aria-hidden="true" style={{ transform: `rotate(${s.value * 15}deg)` }}>
        <span className="encoder-dot" />
      </span>
    </div>
  )
})

const FADER_CAP_H = 10

export const Fader = memo(function Fader({ def, left }: { def: FaderControl; left: number }) {
  const store = useHardwareStore()
  const s = useControlState(def.id)
  const n = useNote(def.id)
  const travel = def.h - FADER_CAP_H
  const drag = useDrag(def, (_dx, dy, start) => store.dispatch({ type: 'set', id: def.id, value: start - (dy / travel) * (def.max - def.min) }))
  const capTop = (1 - (s.value - def.min) / (def.max - def.min)) * travel
  return (
    <div
      id={def.id}
      role="slider"
      tabIndex={0}
      className={`hw hw-fader${s.pressed ? ' is-pressed' : ''}`}
      style={box(def, left)}
      aria-label={def.label}
      aria-orientation="vertical"
      aria-valuemin={def.min}
      aria-valuemax={def.max}
      aria-valuenow={s.value}
      aria-valuetext={`${Math.round((s.value / def.max) * 100)}%${n.functional ? '' : ' (fader position only)'}`}
      aria-description={n.note}
      data-kind="fader"
      title={`${def.label} (${n.title})`}
      {...drag}
      {...sliderKeys(store.dispatch, def.id, def.min, def.max, 4, 16)}
    >
      <span className="fader-slot" aria-hidden="true" />
      <span className="fader-cap" aria-hidden="true" style={{ top: capTop, height: FADER_CAP_H }} />
    </div>
  )
})

const DRAWBAR_CAP_H = 38
const DRAWBAR_STEP = 4.56

export const Drawbar = memo(function Drawbar({ def, left }: { def: DrawbarControl; left: number }) {
  const store = useHardwareStore()
  const s = useControlState(def.id)
  const n = useNote(def.id)
  // Pulling a drawbar toward the player (down) raises its level, as on a tonewheel organ.
  const drag = useDrag(def, (_dx, dy, start) => store.dispatch({ type: 'set', id: def.id, value: start + dy / DRAWBAR_STEP }))
  return (
    <div
      id={def.id}
      role="slider"
      tabIndex={0}
      className={`hw hw-drawbar drawbar-${def.cap}${s.pressed ? ' is-pressed' : ''}`}
      style={box(def, left)}
      aria-label={def.label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={8}
      aria-valuenow={s.value}
      aria-valuetext={`${def.footage} pulled to ${s.value} of 8${n.functional ? '' : ' (position only)'}`}
      aria-description={n.note}
      data-kind="drawbar"
      title={`${def.label} (${n.title})`}
      {...drag}
      {...sliderKeys(store.dispatch, def.id, 0, 8, 1, 4)}
    >
      <span className="drawbar-slot" aria-hidden="true" />
      <span className="drawbar-cap" aria-hidden="true" style={{ top: s.value * DRAWBAR_STEP, height: DRAWBAR_CAP_H }}>
        <span className="drawbar-grip" />
      </span>
    </div>
  )
})

export const PitchStick = memo(function PitchStick({ def, left }: { def: StickControl; left: number }) {
  const store = useHardwareStore()
  const s = useControlState(def.id)
  const n = useNote(def.id)
  const drag = useDrag(def, (dx, _dy, start) => store.dispatch({ type: 'set', id: def.id, value: start + (dx / 9) * 100 }))
  const release = () => store.dispatch({ type: 'release', id: def.id })
  const keys = sliderKeys(store.dispatch, def.id, def.min, def.max, 25, 50, release)
  return (
    <div
      id={def.id}
      role="slider"
      tabIndex={0}
      className={`hw hw-stick${s.pressed ? ' is-pressed' : ''}`}
      style={{ ...box(def, left), transform: `rotate(${def.rotate}deg)` }}
      aria-label={def.label}
      aria-orientation="horizontal"
      aria-valuemin={def.min}
      aria-valuemax={def.max}
      aria-valuenow={s.value}
      aria-valuetext={`${s.value === 0 ? 'centred (spring return, ' : `${s.value > 0 ? 'up' : 'down'} ${Math.abs(s.value)}% (`}${n.functional ? 'bends PSTICK layers' : 'position only'})`}
      aria-description={`${n.note} Springs back to centre when released.`}
      data-kind="pitch-stick"
      title={`${def.label} (${n.title})`}
      {...drag}
      onKeyDown={(e) => {
        if (!e.repeat) store.dispatch({ type: 'press', id: def.id })
        keys.onKeyDown(e)
      }}
      onKeyUp={keys.onKeyUp}
      onBlur={release}
    >
      <span className="stick-wood" aria-hidden="true" style={{ transform: `translateX(${(s.value / 100) * 7}px)` }} />
    </div>
  )
})

export const ModWheel = memo(function ModWheel({ def, left }: { def: WheelControl; left: number }) {
  const store = useHardwareStore()
  const s = useControlState(def.id)
  const n = useNote(def.id)
  const drag = useDrag(def, (_dx, dy, start) => store.dispatch({ type: 'set', id: def.id, value: start - (dy / 48) * 127 }))
  const offset = (s.value / 127) * 40
  return (
    <div
      id={def.id}
      role="slider"
      tabIndex={0}
      className={`hw hw-wheel${s.pressed ? ' is-pressed' : ''}`}
      style={{ ...box(def, left), transform: `rotate(${def.rotate}deg)` }}
      aria-label={def.label}
      aria-orientation="vertical"
      aria-valuemin={def.min}
      aria-valuemax={def.max}
      aria-valuenow={s.value}
      aria-valuetext={`${Math.round((s.value / 127) * 100)}%${n.functional ? '' : ' (position only)'}`}
      aria-description={n.note}
      data-kind="mod-wheel"
      title={`${def.label} (${n.title})`}
      {...drag}
      {...sliderKeys(store.dispatch, def.id, def.min, def.max, 8, 32)}
    >
      <span className="wheel-body" aria-hidden="true" style={{ backgroundPositionY: `${-offset}px` }}>
        <span className="wheel-mark" style={{ top: `${58 - (s.value / 127) * 52}%` }} />
      </span>
    </div>
  )
})

export function Control({ def, left }: { def: ControlDef; left: number }) {
  switch (def.kind) {
    case 'button':
      return <PanelButton def={def} left={left} />
    case 'knob':
      return <Knob def={def} left={left} />
    case 'encoder':
      return <Encoder def={def} left={left} />
    case 'fader':
      return <Fader def={def} left={left} />
    case 'drawbar':
      return <Drawbar def={def} left={left} />
    case 'pitch-stick':
      return <PitchStick def={def} left={left} />
    case 'mod-wheel':
      return <ModWheel def={def} left={left} />
  }
}

export const Led = memo(function Led({ def, left }: { def: LedDef; left: number }) {
  const store = useHardwareStore()
  useControlState(def.owner)
  const ind = useIndicator(def.id)
  const lit = (def.owner ? store.litLeds(def.owner).includes(def.id) : false) || ind === 'on' || ind === 'flash'
  const size = def.shape === 'dot' ? 3.3 : 4
  return (
    <span
      id={def.id}
      className={`led led-${def.color} led-${def.shape}${lit ? ' is-lit' : ''}${ind === 'flash' ? ' is-flash' : ''}`}
      data-lit={lit ? 'true' : 'false'}
      data-flash={ind === 'flash' ? 'true' : undefined}
      aria-hidden="true"
      style={{ left: def.x - size / 2 - left, top: def.y - size / 2, width: size, height: size }}
    />
  )
})

export const Graph = memo(function Graph({ def, left }: { def: GraphDef; left: number }) {
  const s = useControlState(def.owner)
  const store = useHardwareStore()
  const range = useMorphRange(def.owner)
  const owner = store.control(def.owner)
  const max = owner && 'max' in owner ? owner.max : 127
  const toCells = (v: number) => (def.kind === 'drawbar' ? v : Math.round((v / max) * def.cells))
  const lit = toCells(s.value)
  // Morph range (manual p. 39): the cells between the stored value and the morph end value.
  const morph = range ? [Math.min(toCells(range[0]), toCells(range[1])), Math.max(toCells(range[0]), toCells(range[1]))] : null
  const cells = Array.from({ length: def.cells }, (_, i) => i)
  const pitch = (def.y2 - def.y1) / def.cells
  return (
    <span
      className={`graph graph-${def.kind}`}
      id={def.id}
      aria-hidden="true"
      data-lit={lit}
      data-morph={morph ? `${morph[0]}-${morph[1]}` : undefined}
      style={{ left: def.x - def.w / 2 - left, top: def.y1, width: def.w, height: def.y2 - def.y1 }}
    >
      {cells.map((i) => {
        // Drawbar graphs fill from the top (1…8); level ladders fill from the bottom.
        const pos = def.kind === 'drawbar' ? i + 1 : def.cells - i
        const on = pos <= lit
        const inMorph = morph ? pos > morph[0] && pos <= morph[1] : false
        return (
          <span key={i} className={`cell${on ? ' on' : ''}${inMorph ? ' morph' : ''}`} style={{ top: i * pitch, height: pitch - 1.1 }}>
            {def.kind === 'drawbar' ? <span className="cell-num">{i + 1}</span> : null}
          </span>
        )
      })}
    </span>
  )
})
