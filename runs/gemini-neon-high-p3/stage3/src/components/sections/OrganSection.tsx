import { ORGAN_DRAWBAR_SPECS } from '../../model/controls'
import {
  getControlMorphTarget,
  type InstrumentAction,
  type StageInstrumentState,
} from '../../model/instrumentState'
import { getMorphIndicatorInfo } from '../../model/morphs'
import {
  cycleLayerZone,
  formatZoneRangeLabel,
  getActiveZoneCount,
} from '../../model/splits'
import {
  HardwareButton,
  HardwareDrawbar,
  HardwareFader,
  LedDot,
  type SectionProps,
} from '../PanelControls'

const DRAWBAR_TOP_LABELS = [
  'BASS16',
  'STR16',
  'FLUTE8',
  'OBOE8',
  'TRMP8',
  'STR8',
  'FLUTE4',
  'STR4',
  '2 2/3',
] as const

export interface OrganSectionProps extends SectionProps {
  readonly instrumentState: StageInstrumentState
  readonly dispatchInstrument: (action: InstrumentAction) => void
}

export function OrganSection({
  state,
  dispatch,
  instrumentState,
  dispatchInstrument,
}: OrganSectionProps) {
  const organ = instrumentState.organ
  const focused = organ.layers[organ.focusedLayer]
  const sectionOn = organ.sectionOn
  const layerAOn = organ.layers.A.enabled
  const layerBOn = organ.layers.B.enabled
  const fxFocused = instrumentState.effects.focusedChain === 'organ'
  const modelIdx = state['organ-model-select'] ?? 0
  const vibIdx = state['organ-vib-type'] ?? 5
  const vibOn = focused.vibChorusOn
  const percSoft = focused.percussion.soft
  const percFast = focused.percussion.fast
  const percThird = focused.percussion.third
  const percOn = focused.percussion.on

  const zoneCount = getActiveZoneCount(instrumentState.split)
  const zoneLabel = formatZoneRangeLabel(focused.zone, instrumentState.split)
  const zoneLedLit = (slot: number) => {
    if (zoneCount <= 1) return true
    return slot >= focused.zone.lowZone && slot <= focused.zone.highZone
  }

  const morphInfoFor = (controlId: string, baseVal: number) =>
    getMorphIndicatorInfo(getControlMorphTarget(instrumentState, controlId), instrumentState.morphs, baseVal)

  const faderAMorph = morphInfoFor('organ-layer-a-fader', organ.layers.A.level)
  const faderBMorph = morphInfoFor('organ-layer-b-fader', organ.layers.B.level)

  return (
    <section
      className="ns4-section ns4-section-organ"
      data-section="organ"
      data-focused-layer={organ.focusedLayer}
      data-organ-model={focused.model}
      data-organ-zone={zoneLabel}
      data-sustped={organ.sustped ? 'on' : 'off'}
      data-pstick={organ.pstick ? 'on' : 'off'}
      aria-label="Organ section"
    >
      <div className="ns4-plate">
        <div className="ns4-plate-header">
          <div className="ns4-plate-title-group">
            <span className="ns4-plate-title">ORGAN</span>
            <span className="ns4-plate-subtitle">SECTION</span>
          </div>
          <div className="ns4-plate-header-right">
            <span className="ns4-header-tag">FX FOCUS</span>
            <LedDot on={fxFocused} color="amber" size="xs" />
            <span className="ns4-header-tag">ON</span>
            <LedDot on={sectionOn} color="red" size="xs" />
            <HardwareButton id="organ-section-on" state={state} dispatch={dispatch} size="sm" />
            <span className="ns4-header-tag">
              {instrumentState.program.soloSection === 'organ' ? 'SOLO*' : 'SOLO'}
            </span>
          </div>
        </div>

        <div className="ns4-organ-body">
          {/* Left layer strip */}
          <div className="ns4-layer-strip">
            <div className="ns4-faders-row">
              <div className={organ.focusedLayer === 'A' ? 'ns4-layer-focused' : ''}>
                <HardwareFader
                  id="organ-layer-a-fader"
                  state={state}
                  dispatch={dispatch}
                  layerLetter="A"
                  morphAssigned={faderAMorph.assigned}
                  morphRange={
                    faderAMorph.assigned ? [faderAMorph.rangeStart, faderAMorph.rangeEnd] : undefined
                  }
                />
              </div>
              <div className={organ.focusedLayer === 'B' ? 'ns4-layer-focused' : ''}>
                <HardwareFader
                  id="organ-layer-b-fader"
                  state={state}
                  dispatch={dispatch}
                  layerLetter="B"
                  morphAssigned={faderBMorph.assigned}
                  morphRange={
                    faderBMorph.assigned ? [faderBMorph.rangeStart, faderBMorph.rangeEnd] : undefined
                  }
                />
              </div>
            </div>

            <div className="ns4-layer-btns-row">
              <div className="ns4-layer-btn-cell">
                <span className="ns4-onoff-pill">
                  <LedDot on={layerAOn} color="green" size="xs" />
                  <span>ON</span>
                </span>
                <HardwareButton
                  id="organ-layer-a-on"
                  state={state}
                  dispatch={dispatch}
                  variant="light"
                  size="xs"
                />
                <span className="ns4-legend-micro">{organ.sustped ? 'SUST*' : 'SUSTPED'}</span>
              </div>
              <div className="ns4-layer-btn-cell">
                <span className="ns4-onoff-pill">
                  <LedDot on={layerBOn} color="green" size="xs" />
                  <span>ON</span>
                </span>
                <HardwareButton
                  id="organ-layer-b-on"
                  state={state}
                  dispatch={dispatch}
                  variant="light"
                  size="xs"
                />
                <span className="ns4-legend-micro">{organ.pstick ? 'PSTK*' : 'PSTICK'}</span>
              </div>
            </div>

            <div className="ns4-organ-preset-row">
              <span className="ns4-legend-micro">PRESET</span>
              <HardwareButton id="organ-preset" state={state} dispatch={dispatch} size="xs" />
              <span className="ns4-legend-micro">SYNC</span>
            </div>

            <div className="ns4-octave-block">
              <span className="ns4-legend-micro">◀ OCTAVE SHIFT ▶</span>
              <div className="ns4-octave-btns">
                <HardwareButton id="organ-octave-down" state={state} dispatch={dispatch} size="xs" />
                <HardwareButton id="organ-octave-up" state={state} dispatch={dispatch} size="xs" />
              </div>
              <button
                type="button"
                className="ns4-kb-zone-leds ns4-kb-zone-btn"
                aria-label={`Organ Layer ${organ.focusedLayer} KB Zone ${zoneLabel}`}
                title="Cycle KB Zone assignment (or Shift + Octave)"
                onClick={() =>
                  dispatchInstrument({
                    type: 'set-layer-zone',
                    section: 'organ',
                    layer: organ.focusedLayer,
                    zone: cycleLayerZone(focused.zone, instrumentState.split, 1),
                  })
                }
              >
                <LedDot on={zoneLedLit(0)} color="green" size="xs" />
                <LedDot on={zoneLedLit(1)} color="green" size="xs" />
                <LedDot on={zoneLedLit(2)} color="green" size="xs" />
              </button>
            </div>
          </div>

          {/* Right main organ controls */}
          <div className="ns4-organ-main">
            {/* Upper 3 boxed clusters: ORGAN MODEL, VIB/CHORUS, B3 PERCUSSION */}
            <div className="ns4-organ-top-row">
              <div className="ns4-subbox ns4-organ-model-box">
                <div className="ns4-subbox-title">ORGAN MODEL</div>
                <div className="ns4-six-led-grid">
                  <div className="ns4-six-led-row">
                    <span>FARF</span>
                    <LedDot on={modelIdx === 2} color="red" size="xs" />
                    <LedDot on={modelIdx === 3} color="red" size="xs" />
                    <span>PIPE1</span>
                  </div>
                  <div className="ns4-six-led-row">
                    <span>VOX</span>
                    <LedDot on={modelIdx === 1} color="red" size="xs" />
                    <LedDot on={modelIdx === 4} color="red" size="xs" />
                    <span>PIPE2</span>
                  </div>
                  <div className="ns4-six-led-row">
                    <span>B3</span>
                    <LedDot on={modelIdx === 0} color="red" size="xs" />
                    <LedDot on={modelIdx === 5} color="red" size="xs" />
                    <span>BASS</span>
                  </div>
                </div>
                <HardwareButton id="organ-model-select" state={state} dispatch={dispatch} size="sm" />
              </div>

              <div className="ns4-subbox ns4-organ-vib-box">
                <div className="ns4-subbox-title">VIB / CHORUS</div>
                <div className="ns4-vib-top">
                  <HardwareButton id="organ-vib-type" state={state} dispatch={dispatch} size="xs" />
                  <div className="ns4-vib-leds">
                    <div className="ns4-vib-led-row">
                      <span>C2</span>
                      <span>V3</span>
                      <span>C3</span>
                    </div>
                    <div className="ns4-vib-dot-row">
                      <LedDot on={vibIdx === 3} color="red" size="xs" />
                      <LedDot on={vibIdx === 4} color="red" size="xs" />
                      <LedDot on={vibIdx === 5} color="red" size="xs" />
                    </div>
                    <div className="ns4-vib-dot-row">
                      <LedDot on={vibIdx === 2} color="red" size="xs" />
                      <LedDot on={vibIdx === 1} color="red" size="xs" />
                      <LedDot on={vibIdx === 0} color="red" size="xs" />
                    </div>
                    <div className="ns4-vib-led-row">
                      <span>V2</span>
                      <span>C1</span>
                      <span>V1</span>
                    </div>
                  </div>
                </div>
                <div className="ns4-vib-on-row">
                  <span className="ns4-legend-micro">ON</span>
                  <LedDot on={vibOn} color="red" size="xs" />
                  <HardwareButton
                    id="organ-vib-on"
                    state={state}
                    dispatch={dispatch}
                    variant="light"
                    size="xs"
                  />
                </div>
              </div>

              <div className="ns4-subbox ns4-organ-perc-box">
                <div className="ns4-subbox-title">B3 PERCUSSION</div>
                <div className="ns4-perc-btns">
                  <div className="ns4-perc-cell">
                    <span className="ns4-legend-micro">SOFT</span>
                    <LedDot on={percSoft} color="red" size="xs" />
                    <HardwareButton id="organ-perc-soft" state={state} dispatch={dispatch} size="xs" />
                  </div>
                  <div className="ns4-perc-cell">
                    <span className="ns4-legend-micro">FAST</span>
                    <LedDot on={percFast} color="red" size="xs" />
                    <HardwareButton id="organ-perc-fast" state={state} dispatch={dispatch} size="xs" />
                  </div>
                  <div className="ns4-perc-cell">
                    <span className="ns4-legend-micro">THIRD</span>
                    <LedDot on={percThird} color="red" size="xs" />
                    <HardwareButton id="organ-perc-third" state={state} dispatch={dispatch} size="xs" />
                  </div>
                </div>
                <div className="ns4-perc-on-row">
                  <span className="ns4-legend-micro">POLY</span>
                  <div className="ns4-vib-on-row">
                    <span className="ns4-legend-micro">ON</span>
                    <LedDot on={percOn} color="red" size="xs" />
                    <HardwareButton
                      id="organ-perc-on"
                      state={state}
                      dispatch={dispatch}
                      variant="light"
                      size="xs"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Lower 9 physical drawbars + red LED ladders */}
            <div className="ns4-drawbars-bank" role="group" aria-label="Organ Drawbars">
              {ORGAN_DRAWBAR_SPECS.map((db, idx) => {
                const mInfo = morphInfoFor(db.id, focused.drawbars[idx])
                return (
                  <HardwareDrawbar
                    key={db.id}
                    id={db.id}
                    state={state}
                    dispatch={dispatch}
                    topLabel={DRAWBAR_TOP_LABELS[idx]}
                    morphAssigned={mInfo.assigned}
                    morphRange={mInfo.assigned ? [mInfo.rangeStart, mInfo.rangeEnd] : undefined}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
