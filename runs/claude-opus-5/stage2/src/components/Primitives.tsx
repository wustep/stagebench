import type { CSSProperties, ReactNode } from 'react'
import { useControl } from '../state/HardwareContext'
import { Led, PanelButton } from './controls/PanelControls'

/** The amber layer indicator: lit exactly when that layer is switched on. */
function LayerOnLed({ id }: { id: string }) {
  const handle = useControl(id)
  return <Led on={handle.value >= 0.5} color="amber" />
}

/**
 * Absolute placement helper. Every coordinate in the section components is a percentage of the
 * enclosing box, taken from measurements on `reference/nord-stage-4-73.jpg` — see
 * evidence/stage1-visual-audit.md for the pixel figures behind them.
 */
export function At({
  l,
  t,
  w,
  h,
  r,
  b,
  className = '',
  style,
  children,
}: {
  l?: number
  t?: number
  w?: number
  h?: number
  r?: number
  b?: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <div
      className={`at ${className}`.trim()}
      style={{
        left: l === undefined ? undefined : `${l}%`,
        top: t === undefined ? undefined : `${t}%`,
        right: r === undefined ? undefined : `${r}%`,
        bottom: b === undefined ? undefined : `${b}%`,
        width: w === undefined ? undefined : `${w}%`,
        height: h === undefined ? undefined : `${h}%`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** The light header plate carrying the section name, FX FOCUS, the On button and SOLO. */
export function SectionHeader({
  title,
  onId,
  fxFocus = false,
  fxFocusOn = false,
}: {
  title: string
  onId: string
  fxFocus?: boolean
  fxFocusOn?: boolean
}) {
  const sectionOn = useControl(onId)
  return (
    <div className="section-header">
      <span className="section-header__title">
        {title}
        <em>SECTION</em>
      </span>
      {fxFocus ? (
        <span className="section-header__fx">
          <span className="legend">FX FOCUS</span>
          <Led on={fxFocusOn} color="amber" />
        </span>
      ) : null}
      <span className="section-header__on">
        <span className="legend">ON</span>
        <Led on={sectionOn.value >= 0.5} color="red" />
      </span>
      <PanelButton id={onId} variant="dark" className="pbtn--section" />
      <span className="legend section-header__solo">SOLO ▾</span>
    </div>
  )
}

/**
 * The layer strip shared by the Organ, Piano and Synth sections: level faders with LED graphs,
 * AUX KB indicators, layer On/Off buttons, SUSTPED / PSTICK indicators, Octave Shift and the
 * KB Zone LEDs.
 */
export function LayerColumn({
  layers,
  faders,
  octaveDownId,
  octaveUpId,
  secondRow,
  extras,
  focused,
  octaveLabel,
}: {
  layers: readonly { id: string; letter: string; onId: string }[]
  faders: ReactNode
  octaveDownId: string
  octaveUpId: string
  /** Section specific indicator row printed under the layer buttons. */
  secondRow?: readonly { label: string; on: boolean; controlId?: string }[]
  extras?: ReactNode
  /** Layer id that currently has focus, highlighted the way the panel highlights it. */
  focused?: string
  /** Printed octave shift position, e.g. "+1", when the section's shift is functional. */
  octaveLabel?: string
}) {
  return (
    <>
      <At l={0} t={0} w={100} h={35} className="layer-faders">
        {faders}
      </At>
      <At l={0} t={36} w={100} h={6} className="layer-row">
        {layers.map((layer) => (
          <span key={layer.id} className="layer-row__cell">
            <strong className={`layer-letter${focused === layer.id ? ' layer-letter--focused' : ''}`}>
              {layer.letter}
            </strong>
            <span className="legend">AUX KB</span>
            <Led />
          </span>
        ))}
      </At>
      <At l={0} t={42} w={100} h={5} className="layer-row">
        {layers.map((layer) => (
          <span key={layer.id} className="layer-row__cell pill">
            <LayerOnLed id={layer.onId} />
            <span className="legend">ON/OFF ▾</span>
          </span>
        ))}
      </At>
      <At l={0} t={47} w={100} h={8} className="layer-row">
        {layers.map((layer) => (
          <PanelButton key={layer.id} id={layer.onId} variant="light" />
        ))}
      </At>
      {secondRow ? (
        <At l={0} t={56} w={100} h={5} className="layer-row">
          {secondRow.map((entry) => (
            <span key={entry.label} className="layer-row__cell">
              <Led on={entry.on} />
              <span className="legend">{entry.label}</span>
              {entry.controlId ? <PanelButton id={entry.controlId} variant="dark" /> : null}
            </span>
          ))}
        </At>
      ) : null}
      {extras}
      <At l={0} t={74} w={100} h={5} className="layer-row layer-row--centre">
        <span className="legend">
          ◀ OCTAVE SHIFT ▶{octaveLabel ? <span className="legend--active"> {octaveLabel}</span> : null}
        </span>
      </At>
      <At l={4} t={79} w={92} h={8} className="layer-row layer-row--centre">
        <PanelButton id={octaveDownId} variant="dark" className="pbtn--wide" />
        <PanelButton id={octaveUpId} variant="dark" className="pbtn--wide" />
      </At>
      <At l={0} t={88} w={100} h={5} className="layer-row layer-row--centre">
        <span className="legend">◀ KB ZONE ▶</span>
      </At>
      <At l={0} t={93} w={100} h={5} className="layer-row layer-row--centre led-strip">
        <Led color="green" />
        <Led color="green" />
        <Led on color="green" />
        <Led on color="green" />
      </At>
    </>
  )
}
