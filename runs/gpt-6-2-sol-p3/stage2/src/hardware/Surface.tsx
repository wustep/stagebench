import { memo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { initialPanelState, sectionBands } from './model'
import type { Box, Control, RangeControl } from './model'
import type { Settings } from '../piano/settings'
import { models } from '../piano/settings'
import type { AudioStatus } from '../piano/sound'
import { panelLamp, panelUpdate, panelValue, tapDelay } from './bindings'
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

function Graph({ control, value }: { control: RangeControl; value: number }) {
  const drawbar = control.type === 'drawbar'
  return (
    <span className="level-graph" aria-hidden="true">
      {Array.from({ length: drawbar ? 8 : 12 }, (_, index) => {
        const on = drawbar ? index < value : index >= 12 - value
        return (
          <span className={on ? 'level-graph__lit' : undefined} key={index}>
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
  update: (id: string, value: number | boolean, shift?: boolean) => void
}

function Range({ control, style, value, text, update }: ControlProps & { control: RangeControl; value: number }) {
  const gesture = useRef<{ pointer: number; x: number; y: number; value: number } | null>(null)
  const isTrack = control.type === 'fader' || control.type === 'drawbar'
  const drawbar = control.type === 'drawbar'
  const top = drawbar ? 0.22 : 0.08
  const travel = 1 - 2 * top
  const set = (next: number) => update(control.id, Math.round(Math.max(0, Math.min(control.maximum, next))))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rangeKeys.includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') set(0)
    else if (event.key === 'End') set(control.maximum)
    else if (event.key === 'PageUp') set(value + 3)
    else if (event.key === 'PageDown') set(value - 3)
    else set(value + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1))
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
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, value: start }
    if (trackClick) set(start)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current
    if (!start || start.pointer !== event.pointerId) return
    const dy = start.y - event.clientY
    const dx = event.clientX - start.x
    const rect = event.currentTarget.getBoundingClientRect()
    if (isTrack) {
      const direction = drawbar ? -1 : 1
      set(start.value + direction * dy * control.maximum / (rect.height * travel))
    } else {
      set(start.value + (dy + dx * 0.65) * control.maximum / Math.max(38, rect.width * 2))
    }
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointer !== event.pointerId) return
    gesture.current = null
    if (control.type === 'stick') set(control.maximum / 2)
  }
  const percent = value / control.maximum

  return (
    <div
      id={control.id} data-control-id={control.id} data-control-kind={control.type}
      className={`control range range--${control.type} range--${control.style ?? 'standard'}`}
      role="slider" tabIndex={0} aria-label={control.name}
      aria-orientation={isTrack || control.type === 'wheel' ? 'vertical' : 'horizontal'}
      aria-valuemin={0} aria-valuemax={control.maximum} aria-valuenow={value}
      aria-valuetext={text} title={text ? `${control.name} · ${text}` : undefined}
      style={{
        ...style,
        '--turn': `${-138 + percent * 276}deg`,
        '--travel': `${(top + (drawbar ? percent : 1 - percent) * travel) * 100}%`,
        '--position': percent,
      } as CSSProperties}
      onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    >
      {isTrack && <><span className="range-slot" aria-hidden="true" /><Graph control={control} value={value} /></>}
      <span className="range-cap" aria-hidden="true" />
    </div>
  )
}

function PhysicalControl({ control, style, value, text, update }: ControlProps) {
  if (control.type !== 'button') {
    return <Range control={control} style={style} value={Number(value)} text={text} update={update} />
  }
  const on = Boolean(value)
  return (
    <button
      id={control.id} data-control-id={control.id} data-control-kind="button"
      type="button" aria-label={control.name} aria-pressed={on}
      aria-description={text} title={text ? `${control.name} · ${text}` : undefined}
      className={`control panel-button panel-button--${control.style ?? 'black'}`}
      style={style}
      onClick={(event) => update(control.id, !on, event.shiftKey)}
    >
      <span className="panel-button__cap" aria-hidden="true" />
      <Led color={control.led ?? 'red'} on={on} />
    </button>
  )
}

function Readout({ kind, style, settings, status }: {
  kind: 'program' | 'synth'
  style: CSSProperties
  settings: Settings
  status: AudioStatus
}) {
  const model = models[settings.layers[settings.focus].type]
  const detail = status === 'fallback' ? 'Synth fallback' : status === 'loading' ? 'Loading samples' : status === 'error' ? 'Output error' : model
  return kind === 'program' ? (
    <div id="program-oled" className="oled oled--program" data-display="program" style={style} aria-hidden="true">
      <div className="oled__line">A:11 <small>· PANEL</small></div>
      <div className="oled__name">Nord Stage 4</div>
      <div className="oled__detail"><b>O</b> B3 Soulful</div>
      <div className="oled__detail" data-piano-model={model} data-piano-layer={settings.focus}
        data-piano-status={status}><b>P{settings.focus}</b> {detail}</div>
      <div className="oled__detail"><b>S</b> Vista Pad Whl</div>
    </div>
  ) : (
    <div id="synth-oled" className="oled oled--synth" data-display="synth" style={style} aria-hidden="true">
      <div className="oled__banner">OSC WAVEFORM · PANEL</div>
      <div className="oled__name">Super Saw</div>
      <div className="oled__detail">DETUNE: 3.4</div>
      <div className="oled__wave"><i /><i /><i /><i /><i /></div>
      <div className="oled__footer"><span>ANALOG<br /><b>TYPE</b></span><span>SUPER<br /><b>CAT</b></span><span>1 (5)<br /><b>WAVE</b></span></div>
    </div>
  )
}

interface DeckProps {
  settings: Settings
  status: AudioStatus
  configure(settings: Settings): void
  now(): number
}

export const ControlDeck = memo(function ControlDeck({ settings, status, configure, now }: DeckProps) {
  const lastTap = useRef<number | undefined>(undefined)
  const [values, setValues] = useState(() => initialPanelState(panelControls))
  function update(id: string, value: number | boolean, modifier = false) {
    const shift = modifier || (id.startsWith('effects-') && Boolean(values['effects-shift']))
    const next = panelUpdate(settings, id, value, shift)
    if (next) {
      if (id === 'effects-delay-tap' && !shift) {
        const time = now()
        const elapsed = time - (lastTap.current ?? -Infinity)
        lastTap.current = time
        if (elapsed >= 250 && elapsed <= 1500) configure(tapDelay(settings, Math.round(60000 / elapsed)))
      } else if (id === 'effects-delay-tap') {
        const sync = panelValue(settings, 'effects-delay-sync')?.value
        configure(panelUpdate(settings, 'effects-delay-sync', !sync, false) ?? settings)
      } else configure(next)
      return
    }
    setValues((current) => current[id] === value ? current : { ...current, [id]: value })
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
                  ? panelLamp(settings, controlId) ?? Boolean(panelValue(settings, controlId)?.value ?? values[controlId])
                  : on ?? false
                const failed = active && controlId?.startsWith('piano-type:') && status === 'fallback'
                return (
                  <span key={index} className={`legend-lamp${failed ? ' legend-lamp--failed' : ''}`}
                    style={position([left, top, 0, 0])} aria-hidden="true">
                    <Led color={color} on={active} />
                  </span>
                )
              })}
              {readout && <Readout kind={readout.kind} settings={settings} status={status} style={position(readout.box)} />}
              {controls.map((control) => {
                const binding = panelValue(settings, control.id)
                return <PhysicalControl key={control.id} control={control} value={binding?.value ?? values[control.id]}
                  text={binding?.text} style={position(control.box)} update={update} />
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
