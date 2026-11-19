import {
  HardwareButton,
  HardwareFader,
  HardwareKnob,
  LedDot,
  type SectionProps,
} from '../PanelControls'

export function PianoSection({ state, dispatch }: SectionProps) {
  const sectionOn = (state['piano-section-on'] ?? 1) > 0
  const layerAOn = (state['piano-layer-a-on'] ?? 1) > 0
  const layerBOn = (state['piano-layer-b-on'] ?? 0) > 0
  const timbreIdx = state['piano-timbre'] ?? 0
  const acousticsIdx = state['piano-acoustics'] ?? 2
  const unisonIdx = state['piano-unison'] ?? 0
  const kbTouchIdx = state['piano-kb-touch'] ?? 1
  const dynCompIdx = state['piano-dyn-comp'] ?? 0
  const typeIdx = state['piano-type-select'] ?? 0

  return (
    <section
      className="ns4-section ns4-section-piano"
      data-section="piano"
      aria-label="Piano section"
    >
      <div className="ns4-plate">
        <div className="ns4-plate-header">
          <div className="ns4-plate-title-group">
            <span className="ns4-plate-title">PIANO</span>
            <span className="ns4-plate-subtitle">SECTION</span>
          </div>
          <div className="ns4-plate-header-right">
            <span className="ns4-header-tag">ON</span>
            <LedDot on={sectionOn} color="red" size="xs" />
            <HardwareButton id="piano-section-on" state={state} dispatch={dispatch} size="xs" />
          </div>
        </div>

        <div className="ns4-piano-body">
          {/* Left column: A/B faders, on/off, Timbre, Octave */}
          <div className="ns4-piano-left">
            <div className="ns4-faders-row">
              <HardwareFader id="piano-layer-a-fader" state={state} dispatch={dispatch} layerLetter="A" />
              <HardwareFader id="piano-layer-b-fader" state={state} dispatch={dispatch} layerLetter="B" />
            </div>

            <div className="ns4-layer-btns-row">
              <div className="ns4-layer-btn-cell">
                <span className="ns4-onoff-pill">
                  <LedDot on={layerAOn} color="green" size="xs" />
                </span>
                <HardwareButton
                  id="piano-layer-a-on"
                  state={state}
                  dispatch={dispatch}
                  variant="light"
                  size="xs"
                />
                <span className="ns4-legend-micro">SUST</span>
              </div>
              <div className="ns4-layer-btn-cell">
                <span className="ns4-onoff-pill">
                  <LedDot on={layerBOn} color="green" size="xs" />
                </span>
                <HardwareButton
                  id="piano-layer-b-on"
                  state={state}
                  dispatch={dispatch}
                  variant="light"
                  size="xs"
                />
                <span className="ns4-legend-micro">PSTK</span>
              </div>
            </div>

            <div className="ns4-piano-timbre-row">
              <HardwareButton
                id="piano-timbre"
                state={state}
                dispatch={dispatch}
                variant="tall-dark"
                size="xs"
              />
              <div className="ns4-piano-timbre-leds">
                <span className="ns4-legend-micro">TIMBRE</span>
                <div className="ns4-led-label-line">
                  <LedDot on={timbreIdx === 3} color="red" size="xs" />
                  <span>BRT</span>
                </div>
                <div className="ns4-led-label-line">
                  <LedDot on={timbreIdx === 2 || timbreIdx === 4} color="red" size="xs" />
                  <span>MID</span>
                </div>
                <div className="ns4-led-label-line">
                  <LedDot on={timbreIdx === 1 || timbreIdx === 5} color="red" size="xs" />
                  <span>SFT</span>
                </div>
              </div>
            </div>

            <div className="ns4-octave-block">
              <span className="ns4-legend-micro">◀ OCT ▶</span>
              <div className="ns4-octave-btns">
                <HardwareButton id="piano-octave-down" state={state} dispatch={dispatch} size="xs" />
                <HardwareButton id="piano-octave-up" state={state} dispatch={dispatch} size="xs" />
              </div>
              <div className="ns4-kb-zone-leds" aria-hidden="true">
                <LedDot on={true} color="green" size="xs" />
                <LedDot on={true} color="green" size="xs" />
                <LedDot on={true} color="green" size="xs" />
              </div>
            </div>
          </div>

          {/* Right column: Acoustics, Unison, KB Touch, Dyn Comp, Piano Select + Model Dial */}
          <div className="ns4-piano-right">
            <div className="ns4-piano-detail-grid">
              <div className="ns4-piano-detail-cell">
                <span className="ns4-legend-micro">ACOUST</span>
                <div className="ns4-led-pair">
                  <LedDot on={acousticsIdx === 1 || acousticsIdx === 3} color="red" size="xs" />
                  <LedDot on={acousticsIdx === 2 || acousticsIdx === 3} color="red" size="xs" />
                </div>
                <HardwareButton id="piano-acoustics" state={state} dispatch={dispatch} size="xs" />
              </div>

              <div className="ns4-piano-detail-cell">
                <span className="ns4-legend-micro">UNISON</span>
                <div className="ns4-led-trio">
                  <LedDot on={unisonIdx === 1} color="red" size="xs" />
                  <LedDot on={unisonIdx === 2} color="red" size="xs" />
                  <LedDot on={unisonIdx === 3} color="red" size="xs" />
                </div>
                <HardwareButton id="piano-unison" state={state} dispatch={dispatch} size="xs" />
              </div>

              <div className="ns4-piano-detail-cell">
                <span className="ns4-legend-micro">TOUCH</span>
                <div className="ns4-led-trio">
                  <LedDot on={kbTouchIdx === 0} color="red" size="xs" />
                  <LedDot on={kbTouchIdx === 1} color="red" size="xs" />
                  <LedDot on={kbTouchIdx === 2} color="red" size="xs" />
                </div>
                <HardwareButton id="piano-kb-touch" state={state} dispatch={dispatch} size="xs" />
              </div>

              <div className="ns4-piano-detail-cell">
                <span className="ns4-legend-micro">COMP</span>
                <div className="ns4-led-trio">
                  <LedDot on={dynCompIdx === 1} color="red" size="xs" />
                  <LedDot on={dynCompIdx === 2} color="red" size="xs" />
                  <LedDot on={dynCompIdx === 3} color="red" size="xs" />
                </div>
                <HardwareButton id="piano-dyn-comp" state={state} dispatch={dispatch} size="xs" />
              </div>
            </div>

            <div className="ns4-piano-select-box">
              <div className="ns4-subbox-title">PIANO SELECT</div>
              <div className="ns4-six-led-grid ns4-six-led-compact">
                <div className="ns4-six-led-row">
                  <span>EL</span>
                  <LedDot on={typeIdx === 2} color="red" size="xs" />
                  <LedDot on={typeIdx === 3} color="red" size="xs" />
                  <span>CLV</span>
                </div>
                <div className="ns4-six-led-row">
                  <span>UP</span>
                  <LedDot on={typeIdx === 1} color="red" size="xs" />
                  <LedDot on={typeIdx === 4} color="red" size="xs" />
                  <span>DIG</span>
                </div>
                <div className="ns4-six-led-row">
                  <span>GR</span>
                  <LedDot on={typeIdx === 0} color="red" size="xs" />
                  <LedDot on={typeIdx === 5} color="red" size="xs" />
                  <span>MSC</span>
                </div>
              </div>
              <HardwareButton id="piano-type-select" state={state} dispatch={dispatch} size="xs" />
              <div className="ns4-piano-model-dial">
                <HardwareKnob
                  id="piano-model-dial"
                  state={state}
                  dispatch={dispatch}
                  size="sm"
                  variant="encoder"
                  label="MODEL"
                  subLabel="LIST"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
