import { SECTION_LAYOUT, controlsForSection, type SectionId } from '../model/hardware'
import { ControlWidget } from './ControlWidget'

function Section({ id, label }: { id: SectionId; label: string }) {
  const controls = controlsForSection(id)
  const oleds = controls.filter((c) => c.kind === 'oled')
  const drawbars = controls.filter((c) => c.kind === 'drawbar')
  const rest = controls.filter((c) => c.kind !== 'oled' && c.kind !== 'drawbar')

  return (
    <section
      className={`deck-section section-${id}`}
      data-section={id}
      data-testid={`section-${id}`}
      aria-label={label}
    >
      <div className="section-header">
        <span className="section-title">{label}</span>
      </div>
      {id === 'performance' && (
        <div className="brand-block" data-testid="nord-branding">
          <span className="brand-nord">NORD</span>
          <span className="brand-stage">STAGE 4</span>
        </div>
      )}
      {oleds.map((c) => (
        <ControlWidget key={c.id} control={c} />
      ))}
      {drawbars.length > 0 && (
        <div className="drawbar-bank" data-testid="drawbar-bank">
          {drawbars.map((c) => (
            <ControlWidget key={c.id} control={c} />
          ))}
        </div>
      )}
      <div className="section-controls">
        {rest.map((c) => (
          <ControlWidget key={c.id} control={c} />
        ))}
      </div>
    </section>
  )
}

export function ControlDeck() {
  return (
    <div
      className="control-deck"
      data-testid="control-deck"
      style={{ flex: SECTION_LAYOUT.length }}
    >
      {SECTION_LAYOUT.map((s) => (
        <div
          key={s.id}
          className="section-slot"
          data-section-slot={s.id}
          style={{ flex: s.fraction * 1000 }}
        >
          <Section id={s.id} label={s.label} />
        </div>
      ))}
    </div>
  )
}
