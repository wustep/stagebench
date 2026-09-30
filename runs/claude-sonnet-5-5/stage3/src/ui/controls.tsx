import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { LIGHT_LED_IDS } from '../hardware/layout'
import { sectionById } from '../hardware/geometry'
import type { ButtonSpec, DrawbarSpec, EncoderSpec, FaderSpec, KnobSpec, LedRule, LedSpec, SectionId, WheelSpec } from '../hardware/types'
import { box, u, useControlState, useHardware } from './context'

const isLit = (rule: LedRule, value: number, held: boolean): boolean =>
  rule === 'on' ? value > 0 : rule === 'held' ? held : Array.isArray(rule) ? rule.includes(value) : value === rule

const capture = (e: PointerEvent<HTMLElement>) => {
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId)
  } catch {
    // capture is best-effort (synthetic pointers in tests)
  }
}

// --- LED -------------------------------------------------------------------------------------------
export function Led({ led, lit, section, light, blink = false }: { led: LedSpec; lit: boolean; section: SectionId; light: boolean; blink?: boolean }) {
  const size = led.shape && led.shape !== 'dot' ? 2.4 : 2.7
  const dot = <span className={`led led--${led.color} led--${led.shape ?? 'dot'}${lit ? ' is-lit' : ''}${lit && blink ? ' is-blinking' : ''}`} style={{ width: u(size), height: u(size) }} />
  if (!led.text) {
    return (
      <span className="led-slot" aria-hidden="true" style={box(led.x, led.y, size, size)}>
        {dot}
      </span>
    )
  }
  const right = led.textSide !== 'l'
  const sectionWidth = sectionById(section).width
  const style = right
    ? { position: 'absolute' as const, left: u(led.x - size / 2), top: u(led.y - 2), height: u(4) }
    : { position: 'absolute' as const, right: u(sectionWidth - led.x - size / 2), top: u(led.y - 2), height: u(4) }
  return (
    <span className={`led-tag led-tag--${right ? 'r' : 'l'}${light ? ' on-light' : ''}`} aria-hidden="true" style={style}>
      {!right && <span className="led-text">{led.text}</span>}
      {dot}
      {right && <span className="led-text">{led.text}</span>}
    </span>
  )
}

// --- Knob ------------------------------------------------------------------------------------------
const TICK_RADIUS = 14.6
export function Knob({ spec }: { spec: KnobSpec }) {
  const store = useHardware()
  const { value, note, morph } = useControlState(spec.id)
  const drag = useRef<{ y: number; v: number } | null>(null)
  const display = spec.min + value * (spec.max - spec.min)
  const shown = Math.round(display * 10) / 10
  const angle = -135 + value * 270

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const coarse = e.key === 'PageUp' || e.key === 'PageDown'
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'PageUp') store.step(spec.id, 1, coarse)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'PageDown') store.step(spec.id, -1, coarse)
    else if (e.key === 'Home') store.home(spec.id, 'min')
    else if (e.key === 'End') store.home(spec.id, 'max')
    else return
    e.preventDefault()
  }

  const ticks = spec.ticks === 'none' ? [] : spec.ticks
  return (
    <div
      className="ctl knob"
      role="slider"
      tabIndex={0}
      aria-label={spec.label}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      aria-valuenow={shown}
      aria-valuetext={String(shown)}
      aria-description={morph ? `${note ? `${note}. ` : ''}Morph assigned` : note}
      data-control-id={spec.id}
      data-kind="knob"
      data-section={spec.section}
      data-value={value}
      data-morph={morph ? 'true' : undefined}
      style={box(spec.x, spec.y, spec.size, spec.size)}
      onPointerDown={(e) => {
        capture(e)
        drag.current = { y: e.clientY, v: value }
        e.currentTarget.focus?.()
      }}
      onPointerMove={(e) => {
        if (drag.current) store.set(spec.id, drag.current.v + (drag.current.y - e.clientY) / 150)
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={onKey}
      onWheel={(e) => store.step(spec.id, e.deltaY < 0 ? 1 : -1)}
    >
      {ticks.length > 0 && (
        <svg className="knob-ticks" viewBox="-25 -25 50 50" aria-hidden="true" style={{ width: u(spec.size * 2.5), height: u(spec.size * 2.5), left: u(-spec.size * 0.75), top: u(-spec.size * 0.75) }}>
          {spec.ringTone && <path className="knob-ring" d="M -13.98 3.77 A 14.5 14.5 0 1 1 13.98 3.77" />}
          {ticks.map((t, i) => {
            const a = ((-135 + (270 * i) / Math.max(1, ticks.length - 1)) * Math.PI) / 180
            return (
              <text key={t + i} x={TICK_RADIUS * Math.sin(a)} y={-TICK_RADIUS * Math.cos(a) + 1.6} textAnchor="middle">
                {t}
              </text>
            )
          })}
        </svg>
      )}
      <div className="knob-body" style={{ transform: `rotate(${angle}deg)` }}>
        <span className="knob-mark" />
      </div>
      {morph && <span className="morph-led is-lit" aria-hidden="true" />}
    </div>
  )
}

// --- Encoder (endless dial) ----------------------------------------------------------------------
export function Encoder({ spec }: { spec: EncoderSpec }) {
  const store = useHardware()
  const { value, note } = useControlState(spec.id)
  const drag = useRef<{ y: number; v: number } | null>(null)
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') store.step(spec.id, 1)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') store.step(spec.id, -1)
    else if (e.key === 'PageUp') store.step(spec.id, 1, true)
    else if (e.key === 'PageDown') store.step(spec.id, -1, true)
    else if (e.key === 'Home') store.home(spec.id, 'min')
    else return
    e.preventDefault()
  }
  return (
    <div
      className="ctl encoder"
      role="slider"
      tabIndex={0}
      aria-label={spec.label}
      aria-valuemin={0}
      aria-valuemax={spec.detents - 1}
      aria-valuenow={value}
      aria-valuetext={`Detent ${value + 1} of ${spec.detents}`}
      aria-description={note}
      data-control-id={spec.id}
      data-kind="encoder"
      data-section={spec.section}
      data-value={value}
      style={box(spec.x, spec.y, spec.size, spec.size)}
      onPointerDown={(e) => {
        capture(e)
        drag.current = { y: e.clientY, v: value }
        e.currentTarget.focus?.()
      }}
      onPointerMove={(e) => {
        if (drag.current) store.set(spec.id, drag.current.v + (drag.current.y - e.clientY) / 8)
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={onKey}
      onWheel={(e) => store.step(spec.id, e.deltaY < 0 ? 1 : -1)}
    >
      <div className="knob-body encoder-body" style={{ transform: `rotate(${value * (360 / spec.detents)}deg)` }}>
        <span className="encoder-mark" />
      </div>
    </div>
  )
}

// --- Fader with LED ladder -----------------------------------------------------------------------
const LADDER_STEP = 3.2
export function Fader({ spec }: { spec: FaderSpec }) {
  const store = useHardware()
  const { value, note, morph } = useControlState(spec.id)
  const drag = useRef<{ y: number; v: number; h: number } | null>(null)
  const percent = Math.round(value * 100)
  const lit = Math.round(value * spec.ladderLeds)
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'PageUp') store.step(spec.id, 1, e.key === 'PageUp')
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'PageDown') store.step(spec.id, -1, e.key === 'PageDown')
    else if (e.key === 'Home') store.home(spec.id, 'min')
    else if (e.key === 'End') store.home(spec.id, 'max')
    else return
    e.preventDefault()
  }
  const top = spec.y - spec.travel / 2 - spec.capH / 2
  return (
    <>
      <div
        className="ctl fader"
        role="slider"
        tabIndex={0}
        aria-label={spec.label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} percent`}
        aria-description={morph ? `${note ? `${note}. ` : ''}Morph assigned: ${Math.round(morph.from * 100)} to ${Math.round(morph.to * 100)} percent` : note}
        data-control-id={spec.id}
        data-kind="fader"
        data-section={spec.section}
        data-value={value}
        data-morph={morph ? `${morph.from}:${morph.to}` : undefined}
        style={{ position: 'absolute', left: u(spec.x - spec.capW / 2), top: u(top), width: u(spec.capW), height: u(spec.travel + spec.capH) }}
        onPointerDown={(e) => {
          capture(e)
          const h = e.currentTarget.getBoundingClientRect().height
          drag.current = { y: e.clientY, v: value, h: h > 0 ? h * (spec.travel / (spec.travel + spec.capH)) : 100 }
          e.currentTarget.focus?.()
        }}
        onPointerMove={(e) => {
          if (drag.current) store.set(spec.id, drag.current.v + (drag.current.y - e.clientY) / drag.current.h)
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKey}
      >
        <span className="fader-track" />
        <span className="fader-cap" style={{ top: u((1 - value) * spec.travel), height: u(spec.capH) }} />
      </div>
      <div className="ladder" aria-hidden="true" style={{ position: 'absolute', left: u(spec.x + spec.ladderDx - 2), top: u(spec.y - (spec.ladderLeds * LADDER_STEP) / 2), width: u(4), height: u(spec.ladderLeds * LADDER_STEP) }}>
        {Array.from({ length: spec.ladderLeds }, (_, i) => {
          const fromBottom = spec.ladderLeds - 1 - i
          const lo = morph ? Math.round(Math.min(morph.from, morph.to) * spec.ladderLeds) : 0
          const hi = morph ? Math.round(Math.max(morph.from, morph.to) * spec.ladderLeds) : 0
          const inMorph = !!morph && fromBottom >= lo && fromBottom < hi
          return <span key={i} className={`ladder-led${fromBottom < lit ? ' is-lit' : ''}${inMorph ? ' is-morph' : ''}${fromBottom >= spec.ladderLeds - 2 ? ' is-hot' : ''}`} style={{ height: u(2.3), top: u(i * LADDER_STEP + 0.4) }} />
        })}
      </div>
    </>
  )
}

// --- Drawbar with red LED ladder ----------------------------------------------------------------
const DRAWBAR_ROW = 4.66
export function Drawbar({ spec }: { spec: DrawbarSpec }) {
  const store = useHardware()
  const { value, note, morph, graph } = useControlState(spec.id)
  const shown = graph ?? value
  const drag = useRef<{ y: number; v: number; h: number } | null>(null)
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    // pulling a drawbar out (towards the player, cap moves down) increases the level
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') store.step(spec.id, 1)
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') store.step(spec.id, -1)
    else if (e.key === 'Home') store.home(spec.id, 'min')
    else if (e.key === 'End') store.home(spec.id, 'max')
    else return
    e.preventDefault()
  }
  const top = spec.y - spec.capH / 2
  return (
    <>
      <div
        className={`ctl drawbar drawbar--${spec.capTone}`}
        role="slider"
        tabIndex={0}
        aria-label={spec.label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={8}
        aria-valuenow={value}
        aria-valuetext={`${value} of 8`}
        aria-description={`${note ? `${note}. ` : ''}${morph ? `Morph assigned: ${Math.round(morph.from)} to ${Math.round(morph.to)}. ` : ''}Arrow Down or Right pulls the drawbar out (louder)`}
        data-control-id={spec.id}
        data-kind="drawbar"
        data-section={spec.section}
        data-value={value}
        data-morph={morph ? `${morph.from}:${morph.to}` : undefined}
        style={{ position: 'absolute', left: u(spec.x - spec.capW / 2), top: u(top), width: u(spec.capW), height: u(spec.travel + spec.capH) }}
        onPointerDown={(e) => {
          capture(e)
          const h = e.currentTarget.getBoundingClientRect().height
          drag.current = { y: e.clientY, v: value, h: h > 0 ? h * (spec.travel / (spec.travel + spec.capH)) : 100 }
          e.currentTarget.focus?.()
        }}
        onPointerMove={(e) => {
          if (drag.current) store.set(spec.id, drag.current.v + ((e.clientY - drag.current.y) / drag.current.h) * 8)
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKey}
      >
        <span className="drawbar-groove" />
        <span className="drawbar-cap" style={{ top: u((value / 8) * spec.travel), height: u(spec.capH) }} />
      </div>
      <div className="drawbar-ladder" aria-hidden="true" style={{ position: 'absolute', left: u(spec.x + 3.2), top: u(spec.y - 5.3), width: u(9.5), height: u(DRAWBAR_ROW * spec.ladderLeds) }}>
        {Array.from({ length: spec.ladderLeds }, (_, i) => (
          <span key={i} className="drawbar-row" style={{ top: u(i * DRAWBAR_ROW), height: u(3.4) }}>
            <span className="drawbar-num">{i + 1}</span>
            <span className={`drawbar-led${i < shown ? ' is-lit' : ''}${morph && i >= Math.round(Math.min(morph.from, morph.to)) && i < Math.round(Math.max(morph.from, morph.to)) ? ' is-morph' : ''}`} />
          </span>
        ))}
      </div>
    </>
  )
}

// --- Wheels ---------------------------------------------------------------------------------------
export function Wheel({ spec }: { spec: WheelSpec }) {
  const store = useHardware()
  const { value, note } = useControlState(spec.id)
  const drag = useRef<{ p: number; v: number } | null>(null)
  const rad = (spec.angle * Math.PI) / 180
  // for a slot rotated by `angle` from the horizontal (mod) or vertical (pitch) the drag axis is along the slot
  const axis = spec.variant === 'mod' ? { x: Math.cos(rad), y: Math.sin(rad) } : { x: Math.sin(-rad), y: -Math.cos(-rad) }
  const project = (e: PointerEvent<HTMLElement>) => e.clientX * axis.x + e.clientY * axis.y
  const pct = Math.round(value * 100)
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') store.step(spec.id, 1)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') store.step(spec.id, -1)
    else if (e.key === 'Home') store.home(spec.id, 'min')
    else if (e.key === 'End') store.home(spec.id, 'max')
    else return
    e.preventDefault()
  }
  const roller = spec.variant === 'mod' ? spec.length * 0.36 : spec.length * 0.22
  const offset = (value - 0.5) * (spec.length - roller)
  return (
    <div
      className={`ctl wheel wheel--${spec.variant}`}
      role="slider"
      tabIndex={0}
      aria-label={spec.label}
      aria-orientation={spec.variant === 'pitch' ? 'vertical' : 'horizontal'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={spec.variant === 'pitch' ? `${pct - 50} from centre` : `${pct} percent`}
      aria-description={note}
      data-control-id={spec.id}
      data-kind="wheel"
      data-section={spec.section}
      data-value={value}
      style={{
        ...box(spec.x, spec.y, spec.variant === 'mod' ? spec.length : spec.width, spec.variant === 'mod' ? spec.width : spec.length),
        transform: `rotate(${spec.angle}deg)`,
      }}
      onPointerDown={(e) => {
        capture(e)
        drag.current = { p: project(e), v: value }
        store.press(spec.id)
        e.currentTarget.focus?.()
      }}
      onPointerMove={(e) => {
        if (drag.current) store.set(spec.id, drag.current.v + (project(e) - drag.current.p) / 90)
      }}
      onPointerUp={() => {
        drag.current = null
        store.release(spec.id)
      }}
      onPointerCancel={() => {
        drag.current = null
        store.release(spec.id)
      }}
      onKeyDown={onKey}
      onKeyUp={() => store.release(spec.id)}
      onBlur={() => store.release(spec.id)}
    >
      <span className="wheel-slot" />
      <span
        className="wheel-roller"
        style={
          spec.variant === 'mod'
            ? { width: u(roller), height: '86%', left: `calc(50% + ${u(offset)} - ${u(roller / 2)})`, top: '7%' }
            : { height: u(roller), width: '90%', top: `calc(50% - ${u(offset)} - ${u(roller / 2)})`, left: '5%' }
        }
      />
    </div>
  )
}

// --- Buttons, rockers, LED tags -------------------------------------------------------------------
export function Button({ spec }: { spec: ButtonSpec }) {
  const store = useHardware()
  const { value, held, note, focused } = useControlState(spec.id)
  const light = LIGHT_LED_IDS.has(spec.id)
  const cycle = spec.mode === 'cycle'
  const name = cycle && spec.options[value] ? `${spec.label}: ${spec.options[value]}` : spec.label

  const down = (shift = false) => store.press(spec.id, { shift })
  const up = () => store.release(spec.id)
  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== undefined && e.button > 0) return
      capture(e)
      down(e.shiftKey)
    },
    onPointerUp: up,
    onPointerCancel: up,
    onLostPointerCapture: up,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        if (!e.repeat && !held) down(e.shiftKey)
      }
    },
    onKeyUp: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        up()
      }
    },
    onBlur: up,
  }

  if (spec.style === 'tag') {
    const led = spec.leds[0]
    const right = led.textSide !== 'l'
    return (
      <button
        type="button"
        className={`ctl tag${held ? ' is-held' : ''}${value > 0 ? ' is-on' : ''}${spec.rim ? ' tag--box' : ''}${light ? ' on-light' : ''}`}
        aria-label={name}
        aria-pressed={spec.mode === 'latch' ? value === 1 : held}
        aria-description={note}
        data-control-id={spec.id}
        data-kind="button"
        data-style="tag"
        data-section={spec.section}
        data-value={value}
        style={{
          position: 'absolute',
          top: u(spec.y - 1.7),
          height: u(3.4),
          ...(right ? { left: u(spec.x - 1.9) } : { right: u(sectionById(spec.section).width - spec.x - 1.9) }),
        }}
        {...handlers}
      >
        <Ledless dot={<span className={`led led--${led.color} led--dot${value > 0 ? ' is-lit' : ''}`} style={{ width: u(2.7), height: u(2.7) }} />} text={led.text ?? ''} right={right} />
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        className={`ctl btn btn--${spec.style}${spec.rim ? ' btn--rim' : ''}${held ? ' is-held' : ''}${value > 0 && spec.mode === 'latch' ? ' is-on' : ''}`}
        aria-label={name}
        aria-pressed={spec.mode === 'latch' ? value === 1 : held}
        aria-description={note}
        data-focused={focused ? 'true' : undefined}
        data-control-id={spec.id}
        data-kind="button"
        data-style={spec.style}
        data-mode={spec.mode}
        data-section={spec.section}
        data-value={value}
        style={box(spec.x, spec.y, spec.w + (spec.rim ? 2 : 0), spec.h + (spec.rim ? 2 : 0))}
        {...handlers}
      >
        <span className="btn-cap" />
      </button>
      {spec.leds.map((led, i) => (
        <Led key={i} led={led} lit={isLit(led.rule, value, held)} section={spec.section} light={light} blink={!!focused} />
      ))}
    </>
  )
}

function Ledless({ dot, text, right }: { dot: React.ReactNode; text: string; right: boolean }) {
  return (
    <>
      {!right && <span className="led-text">{text}</span>}
      {dot}
      {right && <span className="led-text">{text}</span>}
    </>
  )
}
