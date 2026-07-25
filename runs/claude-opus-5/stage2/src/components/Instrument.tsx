import { SECTION_LAYOUT, TOP_RAIL_LEGENDS } from '../model/layout'
import { VARIANT } from '../model/variant'
import type { NoteSource } from '../audio/pianoEngine'
import { Keybed } from './Keybed'
import { EffectsSection } from './sections/EffectsSection'
import { OrganSection } from './sections/OrganSection'
import { PerformanceSection } from './sections/PerformanceSection'
import { PianoSection } from './sections/PianoSection'
import { ProgramSection, type ProgramDisplayState } from './sections/ProgramSection'
import { SynthSection } from './sections/SynthSection'

/** Rear-panel jacks and legends printed across the top rail. */
function TopRail() {
  return (
    <div className="rail" aria-hidden="true">
      <div className="rail__lip" />
      <div className="rail__jacks">
        {TOP_RAIL_LEGENDS.map((legend, index) => (
          <span key={legend} className="rail__jack" style={{ left: `${5 + index * 5.2}%` }}>
            <span className="rail__socket" />
            <span className="rail__legend">{legend}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export interface InstrumentProps {
  readonly heldNotes: ReadonlySet<number>
  readonly display: ProgramDisplayState
  noteOn(source: NoteSource, key: string | number, midi: number, velocity?: number): void
  noteOff(source: NoteSource, key: string | number): void
}

const SECTION_CONTENT = {
  performance: <PerformanceSection />,
  organ: <OrganSection />,
  piano: <PianoSection />,
  synth: <SynthSection />,
  effects: <EffectsSection />,
} as const

/**
 * One continuous red chassis: top rail plus six sections across 54% of the height, keybed across
 * the remaining 46%, at the variant's measured 3.0951 aspect ratio.
 */
export function Instrument({ heldNotes, display, noteOn, noteOff }: InstrumentProps) {
  return (
    <div
      className="instrument"
      style={{ aspectRatio: String(VARIANT.aspectRatio) }}
      data-variant={VARIANT.id}
      data-aspect-ratio={VARIANT.aspectRatio}
    >
      <div className="chassis">
        <div className="chassis__cheek chassis__cheek--left" aria-hidden="true" />
        <div className="chassis__cheek chassis__cheek--right" aria-hidden="true" />
        <div className="deck" data-deck-fraction="0.54">
          <TopRail />
          <div className="deck__sections">
            {SECTION_LAYOUT.map((section) => (
              <section
                key={section.id}
                className={`section section--${section.id} section--surface-${section.surface}`}
                style={{ width: `${section.fraction * 100}%` }}
                aria-label={section.label}
                data-section={section.id}
                data-fraction={section.fraction}
                data-primary-oled={section.primaryOled ? 'true' : 'false'}
              >
                {section.id === 'program' ? (
                  <ProgramSection display={display} />
                ) : (
                  SECTION_CONTENT[section.id as keyof typeof SECTION_CONTENT]
                )}
              </section>
            ))}
          </div>
        </div>
        <div className="keybed-zone" data-keybed-fraction="0.46">
          <Keybed heldNotes={heldNotes} noteOn={noteOn} noteOff={noteOff} />
        </div>
      </div>
    </div>
  )
}
