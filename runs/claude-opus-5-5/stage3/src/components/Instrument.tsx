import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  CHASSIS_TOP,
  DECK_CHEEK_WIDTH,
  DECK_HEIGHT,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  KEYBED_CHEEK_WIDTH,
  SECTIONS,
} from '../model/geometry'
import { RAIL_LEGENDS, REAR_HANDLES, REAR_JACKS } from '../model/panel'
import { Keybed, type KeybedProps } from './Keybed'
import { PanelSection, type OledContent } from './PanelSection'

export interface InstrumentProps extends KeybedProps {
  oledContent: Record<string, OledContent>
}

export function Instrument({ oledContent, held, noteOn, noteOff }: InstrumentProps) {
  return (
    <div
      className="instrument"
      data-variant="stage-4-73"
      role="region"
      aria-label="Nord Stage 4 73 — 73-key hammer action, E to E"
      style={{ width: DESIGN_WIDTH, height: DESIGN_HEIGHT }}
    >
      {REAR_HANDLES.map(([a, b], i) => (
        <span key={`h${i}`} className="rear-handle" aria-hidden="true" style={{ left: a, width: b - a }} />
      ))}
      {REAR_JACKS.map((x, i) => (
        <span key={`j${i}`} className="rear-jack" aria-hidden="true" style={{ left: x - 4 }} />
      ))}
      <div className="chassis" aria-hidden="true" style={{ top: CHASSIS_TOP }}>
        <span className="chassis-deck" style={{ height: DECK_HEIGHT - CHASSIS_TOP }} />
        <span className="chassis-lip" style={{ top: DECK_HEIGHT - CHASSIS_TOP - 3 }} />
      </div>
      <span className="cheek cheek-left cheek-deck" aria-hidden="true" style={{ top: CHASSIS_TOP, width: DECK_CHEEK_WIDTH, height: DECK_HEIGHT - CHASSIS_TOP }} />
      <span className="cheek cheek-right cheek-deck" aria-hidden="true" style={{ top: CHASSIS_TOP, width: DECK_CHEEK_WIDTH, height: DECK_HEIGHT - CHASSIS_TOP }} />
      <span className="cheek cheek-left cheek-keys" aria-hidden="true" style={{ top: DECK_HEIGHT - 2, width: KEYBED_CHEEK_WIDTH, height: DESIGN_HEIGHT - DECK_HEIGHT + 2 }} />
      <span className="cheek cheek-right cheek-keys" aria-hidden="true" style={{ top: DECK_HEIGHT - 2, width: KEYBED_CHEEK_WIDTH, height: DESIGN_HEIGHT - DECK_HEIGHT + 2 }} />
      <div className="rail-legends" aria-hidden="true">
        {RAIL_LEGENDS.map((l, i) => (
          <span key={i} className="rail-legend" style={{ left: l.x, top: l.y }}>
            {l.text.map((t, j) => (
              <span key={j}>{t}</span>
            ))}
          </span>
        ))}
      </div>
      {SECTIONS.map((s) => (
        <PanelSection key={s.id} section={s} oledContent={oledContent} />
      ))}
      <Keybed held={held} noteOn={noteOn} noteOff={noteOff} />
    </div>
  )
}

/**
 * Scales the fixed-size instrument to the stage width as a single unit (no reflow, so the
 * section ratios and key geometry are identical at every viewport).
 */
export function Stage({ zoom, children }: { zoom: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [zoom])

  const scale = width > 0 ? width / DESIGN_WIDTH : 1
  return (
    <div className="stage-scroll" data-zoom={zoom}>
      <div ref={ref} className="stage" style={{ ['--zoom' as string]: zoom }} data-scale={scale.toFixed(4)}>
        <div className="stage-inner" style={{ transform: `scale(${scale})`, visibility: width > 0 || typeof ResizeObserver === 'undefined' ? 'visible' : 'hidden' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
