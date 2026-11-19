import { ORGAN_DRAWBAR_SPECS } from '../../model/controls'
import {
  HardwareButton,
  HardwareDrawbar,
  HardwareFader,
  LedDot,
  type SectionProps,
} from '../PanelControls'

const DRAWBAR_TOP_LABELS = ['BASS16', 'STR16', 'FLUTE8', 'OBOE8', 'TRMP8', 'STR8', 'FLUTE4', 'STR4', '2 2/3'] as const

export function OrganSection({ state, dispatch }: SectionProps) {
  const sectionOn = (state['organ-section-on'] ?? 1) > 0
  const layerAOn = (state['organ-layer-a-on'] ?? 1) > 0
  const layerBOn = (state['organ-layer-b-on'] ?? 1) > 0
  const modelIdx = state['organ-model-select'] ?? 0
  const vibIdx = state['organ-vib-type'] ?? 5
  const vibOn = (state['organ-vib-on'] ?? 1) > 0
  const percSoft = (state['organ-perc-soft'] ?? 0) > 0
  const percFast = (state['organ-perc-fast'] ?? 1) > 0
  const percThird = (state['organ-perc-third'] ?? 1) > 0
  const percOn = (state['organ-perc-on'] ?? 0) > 0

  return (
    <section
      className="ns4-section ns4-section-organ"
      data-section="organ"
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
            <LedDot on={false} color="amber" size="xs" />
            <span className="ns4-header-tag">ON</span>
            <LedDot on={sectionOn} color="red" size="xs" />
            <HardwareButton id="organ-section-on" state={state} dispatch={dispatch} size="sm" />
            <span className="ns4-header-tag">SOLO</span>
          </div>
        </div>

        <div className="ns4-organ-body">
          {/* Left layer strip */}
          <div className="ns4-layer-strip">
            <div className="ns4-faders-row">
              <HardwareFader id="organ-layer-a-fader" state={state} dispatch={dispatch} layerLetter="A" />
              <HardwareFader id="organ-layer-b-fader" state={state} dispatch={dispatch} layerLetter="B" />
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
                <span className="ns4-legend-micro">SUSTPED</span>
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
                <span className="ns4-legend-micro">PSTICK</span>
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
              <div className="ns4-kb-zone-leds" aria-hidden="true">
                <LedDot on={false} color="green" size="xs" />
                <LedDot on={true} color="green" size="xs" />
                <LedDot on={true} color="green" size="xs" />
              </div>
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
              {ORGAN_DRAWBAR_SPECS.map((db, idx) => (
                <HardwareDrawbar
                  key={db.id}
                  id={db.id}
                  state={state}
                  dispatch={dispatch}
                  topLabel={DRAWBAR_TOP_LABELS[idx]}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
