import { memo, type CSSProperties, type ReactNode } from 'react'
import { DECK_HEIGHT, type SectionDef } from '../model/geometry'
import { PANEL } from '../model/panel'
import type { BoxDef, LegendDef, OledDef, PlateDef } from '../model/panelTypes'
import { Control, Graph, Led } from './controls'

function Plate({ def, left }: { def: PlateDef; left: number }) {
  const main: CSSProperties = { left: def.x1 - left, top: def.y1, width: def.x2 - def.x1, height: def.y2 - def.y1 }
  return (
    <>
      {def.tab ? (
        <span className="plate-tab" aria-hidden="true" style={{ left: def.tab.x1 - left, top: def.tab.y1, width: def.tab.x2 - def.tab.x1, height: def.headerBottom - def.tab.y1 }} />
      ) : null}
      <span className="plate" aria-hidden="true" style={main}>
        <span className="plate-header" style={{ height: def.headerBottom - def.y1 }} />
        {def.redColumn ? (
          <span className="plate-red-column" style={{ left: def.redColumn.x1 - def.x1, width: def.redColumn.x2 - def.redColumn.x1, top: def.headerBottom - def.y1 }} />
        ) : null}
      </span>
    </>
  )
}

function Box({ def, left }: { def: BoxDef; left: number }) {
  return (
    <span
      className={`group-box fill-${def.fill} outline-${def.outline} title-${def.titleStyle}`}
      aria-hidden="true"
      style={{ left: def.x1 - left, top: def.y1, width: def.x2 - def.x1, height: def.y2 - def.y1 }}
    >
      {def.title ? <span className="group-title">{def.title}</span> : null}
    </span>
  )
}

function Legend({ def, left }: { def: LegendDef; left: number }) {
  const translate = def.align === 'center' ? '-50%' : def.align === 'right' ? '-100%' : '0'
  const style: CSSProperties = {
    left: def.x - left,
    top: def.y,
    fontSize: def.size,
    fontWeight: def.weight,
    letterSpacing: def.spacing,
    transform: `translate(${translate}, -50%)${def.rotate ? ` rotate(${def.rotate}deg)` : ''}`,
  }
  if (def.rotate) style.transformOrigin = 'center'
  return (
    <span className={`legend tone-${def.tone}${def.boxed ? ` boxed-${def.boxed}` : ''}${def.font ? ` font-${def.font}` : ''}`} aria-hidden="true" style={style}>
      {def.text}
    </span>
  )
}

export interface OledContent {
  title: string
  lines: string[]
  footer?: string
}

function Oled({ def, left, content }: { def: OledDef; left: number; content: OledContent }) {
  return (
    <div
      id={def.id}
      className="oled"
      role="status"
      aria-label={def.label}
      style={{ left: def.x1 - left, top: def.y1, width: def.x2 - def.x1, height: def.y2 - def.y1 }}
    >
      <div className="oled-title">{content.title}</div>
      {content.lines.map((line, i) => (
        <div key={i} className={i === 0 ? 'oled-big' : 'oled-line'}>
          {line}
        </div>
      ))}
      {content.footer ? <div className="oled-footer">{content.footer}</div> : null}
    </div>
  )
}

const BY_SECTION = (() => {
  const map = new Map<string, { [K in keyof typeof PANEL]: (typeof PANEL)[K] }>()
  for (const key of Object.keys(PANEL) as (keyof typeof PANEL)[]) {
    for (const item of PANEL[key] as { section: string }[]) {
      let entry = map.get(item.section)
      if (!entry) {
        entry = { controls: [], leds: [], legends: [], boxes: [], plates: [], graphs: [], oleds: [], lines: [] }
        map.set(item.section, entry)
      }
      ;(entry[key] as unknown[]).push(item)
    }
  }
  return map
})()

export const PanelSection = memo(function PanelSection({
  section,
  oledContent,
  children,
}: {
  section: SectionDef
  oledContent?: Record<string, OledContent>
  children?: ReactNode
}) {
  const items = BY_SECTION.get(section.id)
  const left = section.left
  if (!items) return null
  return (
    <section
      id={`section-${section.id}`}
      className={`deck-section section-${section.id}`}
      data-section={section.id}
      data-fraction={section.fraction}
      aria-label={`${section.label} section`}
      style={{ left, width: section.width, top: 0, height: DECK_HEIGHT }}
    >
      {items.plates.map((p, i) => (
        <Plate key={i} def={p} left={left} />
      ))}
      {items.boxes.map((b, i) => (
        <Box key={i} def={b} left={left} />
      ))}
      {items.lines.length > 0 ? (
        <svg className="decor-lines" aria-hidden="true" width={section.width} height={DECK_HEIGHT}>
          {items.lines.map((l, i) => (
            <polyline key={i} points={l.points.map(([x, y]) => `${x - left},${y}`).join(' ')} />
          ))}
        </svg>
      ) : null}
      {items.legends.map((l, i) => (
        <Legend key={i} def={l} left={left} />
      ))}
      {items.graphs.map((g) => (
        <Graph key={g.id} def={g} left={left} />
      ))}
      {items.leds.map((l) => (
        <Led key={l.id} def={l} left={left} />
      ))}
      {items.oleds.map((o) => (
        <Oled key={o.id} def={o} left={left} content={oledContent?.[o.id] ?? { title: '', lines: [] }} />
      ))}
      {items.controls.map((c) => (
        <Control key={c.id} def={c} left={left} />
      ))}
      {children}
    </section>
  )
})
