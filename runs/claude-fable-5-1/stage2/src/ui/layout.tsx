import type { CSSProperties, ReactNode } from 'react'
import { Led } from './controls/Led'
import { PanelButton } from './controls/PanelButton'

export interface AtProps {
  x: number
  y: number
  w?: number
  h?: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
  title?: string
}

/** Absolutely positioned box: x/w in percent of the section width, y/h in percent of the deck height. */
export function At({ x, y, w, h, className = '', style, children, title }: AtProps) {
  return (
    <div className={`at ${className}`} title={title} style={{ left: `${x}%`, top: `${y}%`, width: w === undefined ? undefined : `${w}%`, height: h === undefined ? undefined : `${h}%`, ...style }}>
      {children}
    </div>
  )
}

/** Framed control group with a printed title knocked into the top border (ORGAN MODEL, VIB/CHORUS, …). */
export function Group({ title, className = '', children, ...at }: AtProps & { title: string }) {
  return (
    <At {...at} className={`group ${className}`}>
      <span className="group-title">{title}</span>
      {children}
    </At>
  )
}

/** Light header strip at the top of an inset panel: section name, FX FOCUS led, ON button, SOLO. */
export function SectionStrip({ title, onId, fxFocus = true, fxLit = false, className = '', wide = false, compact = false }: { title: string; onId: string; fxFocus?: boolean; fxLit?: boolean; className?: string; wide?: boolean; compact?: boolean }) {
  return (
    <div className={`strip ${wide ? 'strip-wide' : ''} ${compact ? 'strip-compact' : ''} ${className}`}>
      <span className="strip-title">
        <b>{title}</b>
        {wide ? null : <small>SECTION</small>}
      </span>
      {fxFocus ? <Led legend="FX FOCUS" lit={fxLit} color="yellow" side="left" className="strip-fx" /> : null}
      <PanelButton id={onId} led="left" className="strip-on" />
      {wide ? null : <span className="lgd strip-solo">SOLO ▾</span>}
    </div>
  )
}

export function Lgd({ children, className = '', box = false, red = false }: { children: ReactNode; className?: string; box?: boolean; red?: boolean }) {
  return <span className={`lgd ${box ? 'lgd-box' : ''} ${red ? 'lgd-red' : ''} ${className}`}>{children}</span>
}
