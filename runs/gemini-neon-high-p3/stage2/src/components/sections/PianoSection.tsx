import type { PianoEngineStatusSnapshot } from '../../audio/boundaries'
import { getPianoModel, type PianoSectionState } from '../../model/instrumentState'
import {
  HardwareButton,
  HardwareFader,
  HardwareKnob,
  LedDot,
  type SectionProps,
} from '../PanelControls'

export interface PianoSectionProps extends SectionProps {
  readonly pianoState: PianoSectionState
  readonly audioStatus: PianoEngineStatusSnapshot
}

export function PianoSection({ state, dispatch, pianoState, audioStatus }: PianoSectionProps) {
  const sectionOn = pianoState.sectionOn
  const focused = pianoState.layers[pianoState.focusedLayer]
  const layerAOn = pianoState.layers.A.enabled
  const layerBOn = pianoState.layers.B.enabled
  const timbreIdx = state['piano-timbre'] ?? 0
  const unisonIdx = focused.unison
  const kbTouchIdx = state['piano-kb-touch'] ?? 1
  const dynCompIdx = focused.dynComp
  const typeIdx = state['piano-type-select'] ?? 0

  const focusedModel = getPianoModel(focused.type, focused.modelIndex)
  const modelLoadFailed = Boolean(
    focusedModel.sampleBankId && audioStatus.failedBanks?.includes(focusedModel.sampleBankId),
  )
  // Soft Release is disabled for Clav-type sounds (manual p. 25)
  const softReleaseActive = focused.softRelease && focused.type !== 'Clav'
  const stringResActive = focused.stringRes

  return (
    <section
      className="ns4-section ns4-section-piano"
      data-section="piano"
      data-focused-layer={pianoState.focusedLayer}
      data-sustped={pianoState.sustped ? 'on' : 'off'}
      data-pstick={pianoState.pstick ? 'on' : 'off'}
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
          {/* Left column: A/B faders, on/off + focus, SUST/PSTK, Timbre, Octave */}
          <div className="ns4-piano-left">
            <div className="ns4-faders-row">
              <div className={pianoState.focusedLayer === 'A' ? 'ns4-fader-focus is-focused' : 'ns4-fader-focus'}>
                <HardwareFader id="piano-layer-a-fader" state={state} dispatch={dispatch} layerLetter="A" />
              </div>
              <div className={pianoState.focusedLayer === 'B' ? 'ns4-fader-focus is-focused' : 'ns4-fader-focus'}>
                <HardwareFader id="piano-layer-b-fader" state={state} dispatch={dispatch} layerLetter="B" />
              </div>
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
                <div className="ns4-micro-toggle-row">
                  <LedDot on={pianoState.sustped} color="red" size="xs" />
                  <HardwareButton
                    id="piano-sustped"
                    state={state}
                    dispatch={dispatch}
                    className="ns4-micro-btn"
                    size="xs"
                  >
                    SUST
                  </HardwareButton>
                </div>
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
                <div className="ns4-micro-toggle-row">
                  <LedDot on={pianoState.pstick} color="red" size="xs" />
                  <HardwareButton
                    id="piano-pstick"
                    state={state}
                    dispatch={dispatch}
                    className="ns4-micro-btn"
                    size="xs"
                  >
                    PSTK
                  </HardwareButton>
                </div>
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
                  <LedDot on={timbreIdx === 3 || timbreIdx === 5} color="red" size="xs" />
                  <span>BRT</span>
                </div>
                <div className="ns4-led-label-line">
                  <LedDot on={timbreIdx === 2 || timbreIdx === 4 || timbreIdx === 5} color="red" size="xs" />
                  <span>MID</span>
                </div>
                <div className="ns4-led-label-line">
                  <LedDot on={timbreIdx === 1 || timbreIdx === 4 || timbreIdx === 5} color="red" size="xs" />
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
                <LedDot on={focused.octave < 0} color="amber" size="xs" />
                <LedDot on={focused.octave === 0} color="green" size="xs" />
                <LedDot on={focused.octave > 0} color="amber" size="xs" />
              </div>
            </div>
          </div>

          {/* Right column: Acoustics, Unison, KB Touch, Dyn Comp, Piano Select + Model Dial */}
          <div className="ns4-piano-right">
            <div className="ns4-piano-detail-grid">
              <div className="ns4-piano-detail-cell">
                <span className="ns4-legend-micro">ACOUST</span>
                <div className="ns4-led-pair">
                  <LedDot on={softReleaseActive} color="red" size="xs" />
                  <LedDot on={stringResActive} color="red" size="xs" />
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

            <div className={`ns4-piano-select-box ${modelLoadFailed ? 'is-missing-model' : ''}`}>
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
