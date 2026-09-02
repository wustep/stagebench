import { CHEEK_FRACTION, DECK_FRACTION, INSTRUMENT_ASPECT, KEYBED_FRACTION, SECTIONS } from '../hardware/sections'
import { STAGE_4_73 } from '../hardware/keybed'
import { Keybed } from './Keybed'
import { SplitLeds } from './SplitLeds'
import { EffectsSection } from './sections/EffectsSection'
import { OrganSection } from './sections/OrganSection'
import { PerformanceSection } from './sections/PerformanceSection'
import { PianoSection } from './sections/PianoSection'
import { ProgramSection } from './sections/ProgramSection'
import { SynthSection } from './sections/SynthSection'

const SECTION_COMPONENTS = {
  performance: PerformanceSection,
  organ: OrganSection,
  piano: PianoSection,
  program: ProgramSection,
  synth: SynthSection,
  effects: EffectsSection,
} as const

const JACK_POSITIONS = [2.4, 5.2, 16.2, 18.2, 20.2, 22.2, 24.2, 26.2, 28.2, 30.2, 36.5, 38.5, 40.5, 42.5, 44.5, 52.3, 61.5, 68.5, 82.6, 86.2]

/** One continuous red chassis: top rail, six deck sections at the documented widths, keybed, lip. */
export function Instrument() {
  let offset = 0
  return (
    <div
      id="instrument"
      className="instrument"
      role="group"
      aria-label={`Nord Stage 4 73 (${STAGE_4_73.keyAction})`}
      data-variant={STAGE_4_73.id}
      data-aspect={INSTRUMENT_ASPECT.toFixed(4)}
      style={{ aspectRatio: `${9013} / ${2912}` }}
    >
      <div className="chassis" id="chassis" aria-hidden="true" />
      <div className="deck" id="deck" style={{ height: `${DECK_FRACTION * 100}%` }} data-fraction={DECK_FRACTION}>
        <div className="jacks" aria-hidden="true">
          {JACK_POSITIONS.map((x, i) => (
            <i key={i} style={{ left: `${x}%` }} className={i === 15 ? 'jack jack-hex' : 'jack'} />
          ))}
        </div>
        <div className="deck-body">
          {SECTIONS.map((section) => {
            const left = offset
            offset += section.fraction
            const Component = SECTION_COMPONENTS[section.id]
            return (
              <section
                key={section.id}
                id={`section-${section.id}`}
                className={`section section-${section.id}`}
                aria-label={`${section.label} section`}
                data-section={section.id}
                data-fraction={section.fraction}
                style={{ left: `${left * 100}%`, width: `${section.fraction * 100}%` }}
              >
                <Component />
              </section>
            )
          })}
          <div className="deck-foot" aria-hidden="true">
            {[9, 18, 28, 37, 47, 57, 66, 76, 86, 95].map((x, i) => (
              <i key={i} className={i === 2 ? 'foot-led lit' : 'foot-screw'} style={{ left: `${x}%` }} />
            ))}
          </div>
        </div>
      </div>
      <div className="keybed" id="keybed" style={{ height: `${KEYBED_FRACTION * 100}%` }} data-fraction={KEYBED_FRACTION}>
        <div className="keybed-inner" style={{ left: `${CHEEK_FRACTION * 100}%`, right: `${CHEEK_FRACTION * 100}%` }}>
          <SplitLeds />
          <Keybed />
        </div>
        <div className="lip" aria-hidden="true" />
      </div>
      <div className="cheek cheek-left" aria-hidden="true" style={{ width: `${CHEEK_FRACTION * 100}%` }} />
      <div className="cheek cheek-right" aria-hidden="true" style={{ width: `${CHEEK_FRACTION * 100}%` }} />
    </div>
  )
}
