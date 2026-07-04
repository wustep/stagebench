import { SECTIONS, VERTICAL_ALLOCATION, controlsForSection } from '../model/hardware'
import { VARIANT_ID } from '../model/keyboard'
import type { InstrumentApi } from '../state/instrument'
import { SectionPanel } from './controls'
import { Keybed } from './keybed'

interface InstrumentProps {
  instrument: InstrumentApi
}

const SURFACE_MAP = {
  performance: 'exposed',
  organ: 'inset',
  piano: 'inset',
  program: 'exposed',
  synth: 'inset',
  effects: 'inset',
} as const

export function Instrument({ instrument }: InstrumentProps) {
  return (
    <div
      className="instrument"
      data-variant={VARIANT_ID}
      data-testid="instrument"
      aria-label="Nord Stage 4 73"
    >
      <div className="instrument-deck" style={{ flexBasis: `${VERTICAL_ALLOCATION.deck * 100}%` }}>
        <div className="instrument-branding">Nord Stage 4</div>
        <div className="instrument-sections">
          {SECTIONS.map((section) => (
            <div
              key={section.id}
              className="instrument-section-slot"
              data-section={section.id}
              style={{ flexBasis: `${section.fraction * 100}%` }}
            >
              <SectionPanel
                sectionId={section.id}
                label={section.label}
                controls={controlsForSection(section.id)}
                instrument={instrument}
                surface={SURFACE_MAP[section.id]}
              />
            </div>
          ))}
        </div>
        <div className="instrument-status" aria-live="polite">
          Piano: {instrument.pianoStatus}
          {instrument.pianoStatus === 'fallback' ? ' (synth fallback)' : ''}
          · Voices: {instrument.activeVoiceCount}
          {instrument.sustain ? ' · Sustain' : ''}
        </div>
      </div>
      <div className="instrument-keybed-wrap" style={{ flexBasis: `${VERTICAL_ALLOCATION.keybed * 100}%` }}>
        <Keybed instrument={instrument} />
      </div>
    </div>
  )
}
