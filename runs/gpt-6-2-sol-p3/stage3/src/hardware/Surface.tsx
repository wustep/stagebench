import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { initialPanelState, sectionBands } from './model'
import type { Box, Control, RangeControl } from './model'
import type { Settings } from '../piano/settings'
import { models } from '../piano/settings'
import type { AudioStatus } from '../piano/sound'
import { panelLamp, panelValue } from './bindings'
import { organState, synthState } from './engineBindings'
import { address } from '../instrument/programs'
import { effectiveSettings, isMorphed, morphEditState } from '../instrument/morph'
import { envelopeTime, morphSources, waves } from '../instrument/parameters'
import type { Envelope } from '../instrument/parameters'
import type { ProgramControls } from '../instrument/usePrograms'
import { shiftExclusions, unsupportedControls } from './panelActions'
import type { PanelActions } from './panelActions'
import { connectorLegends, panelControls, panels } from './panels'

const deckHeight = 314
const controlAreaWidth = 1720
const chassisWidth = 1800
const rangeKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']

function boxPosition(sectionStart: number, sectionWidth: number) {
  return ([x, y, width, height]: Box): CSSProperties => ({
    left: `${(x - sectionStart) * 100 / sectionWidth}%`,
    top: `${y * 100 / deckHeight}%`,
    width: width ? `${width * 100 / sectionWidth}%` : undefined,
    height: height ? `${height * 100 / deckHeight}%` : undefined,
  })
}

function Led({ color, on }: { color: string; on: boolean }) {
  return <i className={`led led--${color}${on ? ' led--lit' : ''}`} aria-hidden="true" />
}

function Graph({ control, effective, morphRange }: {
  control: RangeControl; effective: number; morphRange?: readonly [number, number]
}) {
  const drawbar = control.type === 'drawbar'
  const steps = drawbar ? 8 : 12
  return (
    <span className="level-graph" aria-hidden="true">
      {Array.from({ length: steps }, (_, index) => {
        const step = drawbar ? index + 1 : steps - index
        const active = step <= Math.round(effective)
        const assigned = morphRange && step > Math.round(morphRange[0]) && step <= Math.round(morphRange[1])
        const style = [active && 'level-graph__lit', assigned && 'level-graph__morph'].filter(Boolean).join(' ')
        return (
          <span className={style} key={index}>
            {drawbar && <small>{index + 1}</small>}
          </span>
        )
      })}
    </span>
  )
}

interface ControlProps {
  control: Control
  style: CSSProperties
  value: number | boolean
  text?: string
  effective?: number | boolean
  morphed?: boolean
  morphRange?: readonly [number, number]
  actions: PanelActions
  now(): number
  update: (id: string, value: number | boolean, shift?: boolean, keyboard?: boolean) => void
}

function Range({ control, style, value, text, effective, morphed, morphRange, now, actions, update }: ControlProps & { control: RangeControl; value: number }) {
  const gesture = useRef<{ pointer: number; x: number; y: number; value: number; since: number; moved: boolean } | null>(null)
  const isTrack = control.type === 'fader' || control.type === 'drawbar'
  const drawbar = control.type === 'drawbar'
  const top = drawbar ? 0.22 : 0.08
  const travel = 1 - 2 * top
  const set = (next: number, shift = false) => update(control.id, Math.round(Math.max(0, Math.min(control.maximum, next))), shift)
  const { maximum } = control
  const label = text ?? ''
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && ['piano-model', 'synth-osc-type', 'synth-filter-resonance'].includes(control.id)) {
      event.preventDefault()
      update(control.id, value, event.shiftKey || control.id === 'synth-filter-resonance', true)
      return
    }
    if (!rangeKeys.includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') set(0, event.shiftKey)
    else if (event.key === 'End') set(control.maximum, event.shiftKey)
    else if (event.key === 'PageUp') set(value + (maximum === 270 ? 10 : 3), event.shiftKey)
    else if (event.key === 'PageDown') set(value - (maximum === 270 ? 10 : 3), event.shiftKey)
    else set(value + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1), event.shiftKey)
  }

  const position = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = (event.clientY - rect.top) / rect.height
    const fraction = Math.max(0, Math.min(1, (offset - top) / travel))
    return control.maximum * (drawbar ? fraction : 1 - fraction)
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gesture.current) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const trackClick = isTrack && !(event.target as HTMLElement).closest('.range-cap')
    const start = trackClick ? position(event) : value
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, value: start, since: now(), moved: false }
    if (trackClick) set(start, event.shiftKey)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current
    if (!start || start.pointer !== event.pointerId) return
    const dy = start.y - event.clientY
    const dx = event.clientX - start.x
    if (Math.abs(dx) + Math.abs(dy) < 2 && !start.moved) return
    start.moved = true
    const rect = event.currentTarget.getBoundingClientRect()
    if (isTrack) {
      const direction = drawbar ? -1 : 1
      set(start.value + direction * dy * control.maximum / (rect.height * travel), event.shiftKey)
    } else {
      set(start.value + (dy + dx * 0.65) * control.maximum / Math.max(38, rect.width * 2), event.shiftKey)
    }
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current
    if (start?.pointer !== event.pointerId) return
    gesture.current = null
    if (control.type === 'stick') set(control.maximum / 2)
    else if (event.type === 'pointerup' && !start.moved && now() - start.since >= 420) actions.longPress(control.id)
  }
  const percent = maximum > 0 ? value / maximum : 0

  return (
    <div
      id={control.id} data-control-id={control.id} data-control-kind={control.type}
      className={`control range range--${control.type} range--${control.style ?? 'standard'}`}
      role="slider" tabIndex={0} aria-label={control.name}
      aria-orientation={isTrack || control.type === 'wheel' ? 'vertical' : 'horizontal'}
      aria-valuemin={0} aria-valuemax={control.maximum} aria-valuenow={value}
      aria-valuetext={text} title={label ? `${control.name} · ${label}` : undefined}
      data-morphed={morphed || undefined} data-unsupported={unsupportedControls[control.id] || undefined}
      style={{
        ...style,
        '--turn': `${-138 + percent * 276}deg`,
        '--travel': `${(top + (drawbar ? percent : 1 - percent) * travel) * 100}%`,
        '--position': percent,
      } as CSSProperties}
      onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    >
      {isTrack && <><span className="range-slot" aria-hidden="true" /><Graph control={control} effective={Number(effective ?? value)} morphRange={morphRange} /></>}
      <span className="range-cap" aria-hidden="true" />
      {morphed && !isTrack && <span className="morph-lamp"><Led color="green" on /></span>}
    </div>
  )
}

function PhysicalControl(props: ControlProps) {
  const { control, style, value, text, morphed, actions, update } = props
  const timer = useRef<{ viewport: Window; id: number } | undefined>(undefined)
  const consumed = useRef(false)
  const cancelHold = () => {
    if (timer.current) timer.current.viewport.clearTimeout(timer.current.id)
    timer.current = undefined
  }
  useEffect(() => cancelHold, [])
  if (control.type !== 'button') {
    return <Range {...props} control={control} value={Number(value)} />
  }
  const on = Boolean(value)
  return (
    <button
      id={control.id} data-control-id={control.id} data-control-kind="button"
      type="button" aria-label={control.name} aria-pressed={on}
      aria-description={text} title={text ? `${control.name} · ${text}` : undefined}
      data-unsupported={unsupportedControls[control.id]} data-shift-unsupported={shiftExclusions[control.id]}
      data-morphed={morphed || undefined}
      className={`control panel-button panel-button--${control.style ?? 'black'}`}
      style={style}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        consumed.current = false
        const viewport = event.currentTarget.ownerDocument.defaultView
        if (viewport && !event.shiftKey && actions.supportsHold(control.id)) {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          cancelHold()
          const id = viewport.setTimeout(() => {
            consumed.current = actions.longPress(control.id)
            timer.current = undefined
          }, 420)
          timer.current = { viewport, id }
        }
        if (actions.isMorphSource(control.id)) {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          actions.pressMorph(control.id, true, event.shiftKey)
        }
      }}
      onPointerUp={(event) => {
        actions.pressMorph(control.id, false, event.shiftKey)
        cancelHold()
      }}
      onPointerCancel={() => { cancelHold(); actions.pressMorph(control.id, false, false) }}
      onLostPointerCapture={() => { cancelHold(); actions.pressMorph(control.id, false, false) }}
      onClick={(event) => {
        if (consumed.current && event.detail > 0) { consumed.current = false; return }
        update(control.id, !on, event.shiftKey, event.detail === 0)
      }}
    >
      <span className="panel-button__cap" aria-hidden="true" />
      <Led color={control.led ?? 'red'} on={on} />
      {morphed && <span className="morph-lamp"><Led color="green" on /></span>}
    </button>
  )
}

function waveformGraphic(wave: string) {
  const points = Array.from({ length: 33 }, (_, i) => {
    const phase = i / 32
    const x = 100 * phase
    let y: number
    if (wave.includes('Noise')) y = (Math.sin(i * 21.9) + Math.cos(i * 7.4)) * 0.45
    else if (wave.includes('Square') || wave.includes('Pulse')) {
      const width = wave.includes('10') ? 0.1 : wave.includes('33') ? 0.33 : 0.5
      y = (phase * 2 % 1) < width ? 0.8 : -0.8
    } else if (wave.includes('Saw')) y = 2 * (phase * (wave.includes('Sync') ? 5.7 : 2) % 1) - 1
    else if (wave === 'Triangle') y = 1 - 4 * Math.abs((phase * 2 % 1) - 0.5)
    else y = Math.sin(phase * 4 * Math.PI + (wave.includes('FM') ? Math.sin(phase * 8 * Math.PI) * 1.8 : 0))
    return [x, 50 - y * 39]
  })
  return plot(points)
}

function plot(points: number[][]) {
  const outline = [
    ...points.map(([x, y]) => `${x}% ${y}%`),
    ...[...points].reverse().map(([x, y]) => `${x}% ${Math.min(100, y + 6)}%`),
  ]
  return { clipPath: `polygon(${outline.join(',')})` }
}

function envelopeGraphic(envelope: Envelope) {
  const held = envelope.decay === 10
  const attack = Math.sqrt(envelopeTime(envelope.attack))
  const decay = held ? 0.3 : Math.sqrt(envelopeTime(envelope.decay))
  const release = Math.sqrt(envelopeTime(envelope.release))
  const total = attack + decay + release
  const top = attack / total * 100
  const midpoint = (attack + decay) / total * 100
  return plot([[0, 93], [top, 9], [midpoint, held ? 9 : 77], [100, 93]])
}

function Readout({ kind, style, settings, status, program, actions }: {
  kind: 'program' | 'synth'
  style: CSSProperties
  settings: Settings
  status: AudioStatus
  program: ProgramControls
  actions: PanelActions
}) {
  const model = models[settings.layers[settings.focus].type]
  const detail = status === 'fallback' ? 'Synth fallback' : status === 'loading' ? 'Loading samples' : status === 'error' ? 'Output error' : model
  const synth = synthState(settings)
  const wave = waves[synth.category][synth.wave]
  const editor = actions.editor
  const envelope = editor === 'osc' || editor === 'filter' || editor === 'amp' ? synth[editor] : undefined
  const preview = program.store && (program.selected.bank !== program.location.bank || program.selected.index !== program.location.index)
  if (kind === 'program') return (
    <div id="program-oled" className="oled oled--program" data-display="program" style={style}
      data-dirty={program.dirty} data-store={Boolean(program.store)} aria-hidden="true">
      <div className="oled__line">{preview ? address(program.selected) : program.label} <small>· {settings.scene}</small></div>
      <div className="oled__name">{preview ? program.selectedSlot.name : program.current.name}</div>
      <div className="oled__detail"><b>O{settings.organ.focus}</b> {settings.organ.on ? organState(settings).model : 'Off'}</div>
      <div className="oled__detail" data-piano-model={model} data-piano-layer={settings.focus}
        data-piano-status={status}><b>P{settings.focus}</b> {settings.on ? detail : 'Off'}</div>
      <div className="oled__detail"><b>S{settings.synth.focus}</b> {settings.synth.on ? wave : 'Off'}</div>
    </div>
  )
  return (
    <div id="synth-oled" className="oled oled--synth" data-display="synth" style={style} aria-hidden="true">
      <div className="oled__banner">SYNTH {settings.synth.focus} · {envelope ? 'ENVELOPE' : 'OSC WAVEFORM'}</div>
      <div className="oled__name">{envelope ? `${editor?.toUpperCase()} Contour` : wave}</div>
      <div className="oled__detail">{envelope ? (envelope.decay === 10 ? 'SUSTAIN' : 'A / D / R') : synth.category === 'Pure' ? 'PURE ANALOG' : `OSC CTRL ${synth.control.toFixed(1)}`}</div>
      <div className="oled__trace" style={envelope ? envelopeGraphic(envelope) : waveformGraphic(wave)} />
      <div className="oled__footer">{(envelope
        ? [['ATTACK', envelope.attack], ['DECAY', envelope.decay], ['RELEASE', envelope.release]]
        : [['TYPE', 'ANALOG'], ['CAT', synth.category.toUpperCase()], ['WAVE', `${synth.wave + 1} (${waves[synth.category].length})`]]
      ).map(([label, value]) => <span key={label}>{value}<br /><b>{label}</b></span>)}</div>
    </div>
  )
}

interface DeckProps {
  settings: Settings
  status: AudioStatus
  program: ProgramControls
  actions: PanelActions
  now(): number
}

export const ControlDeck = memo(function ControlDeck({ settings, status, program, actions, now }: DeckProps) {
  const [values, setValues] = useState(() => initialPanelState(panelControls))
  const effective = effectiveSettings(settings)
  function update(id: string, value: number | boolean, shift = false, keyboard = false) {
    if (actions.update(id, value, shift, keyboard) === 'unsupported') {
      setValues((current) => current[id] === value ? current : { ...current, [id]: value })
    }
  }

  let sectionStart = 0
  const chassisPosition = boxPosition(0, chassisWidth)
  return (
    <div className="control-deck" role="group" aria-label="Control deck">
      <div className="rear-hardware" aria-hidden="true">
        {[52, 107, 310, 338, 371, 418, 462, 496, 527, 550, 690, 778, 898, 1170, 1463, 1521, 1686, 1744].map((x) =>
          <i style={{ left: `${x / 18}%` }} key={x} />)}
        <i className="rear-hardware__mount" /><i className="rear-hardware__mount rear-hardware__mount--right" />
      </div>
      <div className="top-roll" aria-hidden="true" />
      <div className="deck-end deck-end--left" aria-hidden="true" />
      <div className="deck-end deck-end--right" aria-hidden="true" />
      <div className="connector-legends" aria-hidden="true">
        {connectorLegends.map(([x, text]) => <span style={chassisPosition([x, 46, 0, 0])} key={text}>{text}</span>)}
      </div>
      <div className="wordmark" aria-hidden="true">
        <div><strong>nord</strong> stage 4</div>
        <small>HAMMER ACTION 73</small>
      </div>
      <div className="deck-sections" style={{ width: `${controlAreaWidth * 100 / chassisWidth}%` }}>
        {sectionBands.map(({ id, name, fraction }) => {
          const width = controlAreaWidth * fraction
          const position = boxPosition(sectionStart, width)
          sectionStart += width
          const { controls, lamps, legends, plates, readout } = panels[id]
          return (
            <section key={id} id={id} className={`deck-section deck-section--${id}`}
              data-section={id} aria-label={name} style={{ flexBasis: `${fraction * 100}%` }}>
              {plates.map(({ box, title, style }, index) =>
                <div key={index} className={`plate plate--${style ?? 'panel'}`} style={position(box)} aria-hidden="true">
                  {title && <span>{title}</span>}
                </div>)}
              {legends.map(({ x, y, text, style }, index) =>
                <span key={index} className={`legend legend--${style ?? 'normal'}`}
                  style={position([x, y, 0, 0])} aria-hidden="true">{text}</span>)}
              {lamps.map(({ left, top, color, on, controlId }, index) => {
                const active = controlId
                  ? panelLamp(effective, controlId) ?? Boolean(panelValue(settings, controlId)?.value ?? values[controlId])
                  : on ?? false
                const failed = active && controlId?.startsWith('piano-type:') && status === 'fallback'
                return (
                  <span key={index} className={`legend-lamp${failed ? ' legend-lamp--failed' : ''}`}
                    style={position([left, top, 0, 0])} aria-hidden="true">
                    <Led color={color} on={active} />
                  </span>
                )
              })}
              {readout && <Readout kind={readout.kind} settings={effective} status={status} program={program} actions={actions} style={position(readout.box)} />}
              {controls.map((control) => {
                const binding = actions.describe(control.id)
                const range = control.type === 'button' ? control : { ...control, maximum: actions.maximum(control) ?? control.maximum }
                const morphed = isMorphed(settings, control.id)
                let morphRange: readonly [number, number] | undefined
                if (morphed && (control.type === 'fader' || control.type === 'drawbar')) {
                  const base = Number(panelValue(settings, control.id)?.value)
                  const positions = morphSources.map((source) => Number(panelValue(morphEditState(settings, source, control.id), control.id)?.value))
                  morphRange = [Math.min(base, ...positions), Math.max(base, ...positions)]
                }
                return <PhysicalControl key={control.id} control={range} value={binding?.value ?? values[control.id]}
                  text={binding?.text ?? unsupportedControls[control.id]}
                  effective={morphed ? panelValue(effective, control.id)?.value : undefined}
                  morphed={morphed} morphRange={morphRange} style={position(control.box)} actions={actions} now={now} update={update} />
              })}
            </section>
          )
        })}
      </div>
      <div className="deck-fasteners" aria-hidden="true">
        {[246, 523, 642, 736, 919, 1040, 1188, 1378, 1476, 1592].map((x) =>
          <i style={{ left: `${x / 18}%` }} key={x} />)}
      </div>
      <div className="deck-lip" aria-hidden="true" />
    </div>
  )
})
