import { memo } from 'react'
import {
  ASPECT_RATIO,
  DECK_FRACTION,
  DECK_HEIGHT_U,
  HEIGHT_U,
  SECTIONS,
} from '../hardware/geometry'
import { CONTROLS, FRAMES, INDICATORS, JACKS, LEGENDS, OLEDS } from '../hardware/layout'
import type { ControlSpec, FrameSpec, IndicatorSpec, LegendSpec, SectionId } from '../hardware/types'
import { Button, Drawbar, Encoder, Fader, Knob, Wheel } from './controls'
import { box, u, useIndicator } from './context'
import Keybed from './Keybed'
import Oled from './Oled'

function Control({ spec }: { spec: ControlSpec }) {
  switch (spec.kind) {
    case 'knob':
      return <Knob spec={spec} />
    case 'encoder':
      return <Encoder spec={spec} />
    case 'fader':
      return <Fader spec={spec} />
    case 'drawbar':
      return <Drawbar spec={spec} />
    case 'wheel':
      return <Wheel spec={spec} />
    case 'button':
      return <Button spec={spec} />
  }
}

function Frame({ f }: { f: FrameSpec }) {
  const hasTab = f.title && f.titleTone === 'light' && f.tone === 'well'
  return (
    <div className={`frame frame--${f.tone}`} style={{ ...box(f.x, f.y, f.w, f.h, false), borderRadius: f.radius !== undefined ? (f.radius >= 6 ? '50% 50% 6% 6% / 34% 34% 6% 6%' : u(f.radius)) : undefined, ...(f.radius !== undefined && f.radius >= 6 ? { border: 'none' } : {}) }} aria-hidden="true">
      {f.title && (
        <span className={`frame-title${hasTab ? ' frame-title--tab' : ''}${f.tone === 'light' ? ' frame-title--light' : ''}`} style={{ fontSize: u(f.titleSize ?? 2.4) }}>
          {f.title}
        </span>
      )}
    </div>
  )
}

function Legend({ l }: { l: LegendSpec }) {
  const align = l.align === 'l' ? '0%' : l.align === 'r' ? '-100%' : '-50%'
  return (
    <span
      className={`legend legend--${l.tone}${l.font === 'brand' ? ' legend--brand' : ''}`}
      aria-hidden="true"
      style={{
        left: u(l.x),
        top: u(l.y),
        fontSize: u(l.size),
        fontWeight: l.weight === 'black' ? 900 : l.weight === 'normal' ? 400 : 700,
        letterSpacing: l.spacing !== undefined ? `${l.spacing}em` : undefined,
        transform: `translate(${align}, -50%)${l.rotate ? ` rotate(${l.rotate}deg)` : ''}`,
      }}
    >
      {l.text}
    </span>
  )
}

function Indicator({ i }: { i: IndicatorSpec }) {
  const lit = useIndicator(i.id)
  return <span className={`led led--${i.color} led--dot indicator${lit ? ' is-lit' : ''}`} aria-hidden="true" data-indicator={i.id} style={box(i.x, i.y, 2.7, 2.7)} />
}

const SectionView = memo(function SectionView({ id }: { id: SectionId }) {
  const section = SECTIONS.find((s) => s.id === id)!
  return (
    <section
      className={`section section--${id}`}
      data-section={id}
      data-fraction={section.fraction}
      aria-label={section.label}
      style={{ left: u(section.left), width: u(section.width), height: u(DECK_HEIGHT_U) }}
    >
      {FRAMES.filter((f) => f.section === id).map((f, i) => (
        <Frame key={i} f={f} />
      ))}
      {LEGENDS.filter((l) => l.section === id).map((l, i) => (
        <Legend key={i} l={l} />
      ))}
      {INDICATORS.filter((x) => x.section === id).map((x, i) => (
        <Indicator key={i} i={x} />
      ))}
      {JACKS.filter((j) => j.section === id).map((j, i) => (
        <span key={i} className="jack" aria-hidden="true" style={{ left: u(j.x - 4), top: u(4.6) }} />
      ))}
      {OLEDS.filter((o) => o.section === id).map((o) => (
        <Oled key={o.id} spec={o} />
      ))}
      {CONTROLS.filter((c) => c.section === id).map((c) => (
        <Control key={c.id} spec={c} />
      ))}
    </section>
  )
})

/** The complete Stage 4 73: chassis, six deck sections, keybed. */
export default function InstrumentView() {
  return (
    <div className="instrument" data-testid="instrument" data-variant="stage-4-73" data-aspect-ratio={ASPECT_RATIO} style={{ aspectRatio: String(ASPECT_RATIO) }}>
      <div className="ear ear--left" aria-hidden="true" />
      <div className="ear ear--right" aria-hidden="true" />
      <div className="chassis" aria-hidden="true" />
      <div className="deck" data-testid="deck" style={{ height: `${DECK_FRACTION * 100}%` }}>
        <div className="deck-lip" aria-hidden="true" style={{ top: u(DECK_HEIGHT_U - 14) }} />
        {[212, 447, 700, 890].map((x) => (
          <span key={x} className="rail-dot" aria-hidden="true" style={{ left: u(x), top: u(DECK_HEIGHT_U - 13.4) }} />
        ))}
        {SECTIONS.map((s) => (
          <SectionView key={s.id} id={s.id} />
        ))}
      </div>
      <div className="keybed-zone" data-testid="keybed-zone" style={{ top: `${DECK_FRACTION * 100}%`, height: `${(1 - DECK_FRACTION) * 100}%` }} data-height-u={HEIGHT_U}>
        <Keybed />
        <div className="bottom-rail" aria-hidden="true" />
      </div>
    </div>
  )
}
