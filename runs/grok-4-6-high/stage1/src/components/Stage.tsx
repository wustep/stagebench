import type { CSSProperties } from 'react'
import { CONTROLS, OLED_CONTROLS } from '../model/controls'
import { SECTION_FRACTIONS, SECTION_ORDER, VARIANT, VERTICAL_SPLIT } from '../model/variant'
import { useInstrument } from '../state/instrument-context'
import { Keybed } from './Keybed'
import {
  EffectsSection,
  OrganSection,
  PerformanceSection,
  PianoSection,
  ProgramSection,
  SynthSection,
} from './sections'

export function Stage() {
  const { audioStatus, audioDetail, midiState, sustain, setSustain } = useInstrument()
  const stageStyle = {
    ['--deck']: VERTICAL_SPLIT.deck,
    ['--keybed']: VERTICAL_SPLIT.keybed,
    ['--aspect']: VARIANT.aspectRatio,
    ['--sec-performance']: SECTION_FRACTIONS.performance,
    ['--sec-organ']: SECTION_FRACTIONS.organ,
    ['--sec-piano']: SECTION_FRACTIONS.piano,
    ['--sec-program']: SECTION_FRACTIONS.program,
    ['--sec-synth']: SECTION_FRACTIONS.synth,
    ['--sec-effects']: SECTION_FRACTIONS.effects,
  } as CSSProperties

  return (
    <div className="viewport">
      <div
        className="stage"
        data-testid="instrument"
        data-variant={VARIANT.id}
        data-aspect={VARIANT.aspectRatio}
        data-deck-fraction={VERTICAL_SPLIT.deck}
        data-keybed-fraction={VERTICAL_SPLIT.keybed}
        data-oled-count={OLED_CONTROLS.length}
        data-control-count={CONTROLS.length}
        style={stageStyle}
      >
        <div className="chassis" data-testid="chassis">
          <div className="deck" data-testid="deck" data-sections={SECTION_ORDER.join(',')}>
            <PerformanceSection />
            <OrganSection />
            <PianoSection />
            <ProgramSection />
            <SynthSection />
            <EffectsSection />
          </div>
          <div className="keybed-shell" data-testid="keybed-shell">
            <div className="cheek cheek-left" aria-hidden="true" />
            <Keybed />
            <div className="cheek cheek-right" aria-hidden="true" />
          </div>
        </div>
      </div>
      <div className="web-inputs">
        <button
          type="button"
          id="sustain-pedal"
          className={`sustain-pedal ${sustain ? 'is-on' : ''}`}
          aria-label="Sustain pedal"
          aria-pressed={sustain}
          onPointerDown={(event) => {
            event.preventDefault()
            setSustain(true)
          }}
          onPointerUp={() => setSustain(false)}
          onPointerCancel={() => setSustain(false)}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault()
              setSustain(!sustain)
            }
          }}
        >
          Sustain
        </button>
        <p className="status-line" data-audio-status={audioStatus} data-midi-state={midiState} role="status">
          {audioDetail}. MIDI {midiState}. Panel controls are decorative.
        </p>
      </div>
    </div>
  )
}
