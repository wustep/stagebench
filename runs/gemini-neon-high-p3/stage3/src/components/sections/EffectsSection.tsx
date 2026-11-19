import {
  getControlMorphTarget,
  getDisplayedEffectChain,
  type EffectsSectionState,
  type StageInstrumentState,
} from '../../model/instrumentState'
import { getMorphIndicatorInfo } from '../../model/morphs'
import { HardwareButton, HardwareKnob, LedDot, type SectionProps } from '../PanelControls'

export interface EffectsSectionProps extends SectionProps {
  readonly effectsState: EffectsSectionState
  readonly instrumentState?: StageInstrumentState
}

export function EffectsSection({
  state,
  dispatch,
  effectsState,
  instrumentState,
}: EffectsSectionProps) {
  const sectionOn = effectsState.allOn
  const focusOrgan = effectsState.focusedChain === 'organ'
  const focusPianoA =
    effectsState.focusedChain === 'pianoA' ||
    (effectsState.pianoGroupMode && effectsState.focusedChain === 'pianoB')
  const focusPianoB =
    effectsState.focusedChain === 'pianoB' ||
    (effectsState.pianoGroupMode && effectsState.focusedChain === 'pianoA')
  const focusSynthAny = effectsState.focusedChain.startsWith('synth')
  const focusSynthA =
    effectsState.focusedChain === 'synthA' || (effectsState.synthGroupMode && focusSynthAny)
  const focusSynthB =
    effectsState.focusedChain === 'synthB' || (effectsState.synthGroupMode && focusSynthAny)
  const focusSynthC =
    effectsState.focusedChain === 'synthC' || (effectsState.synthGroupMode && focusSynthAny)
  const shiftOn = effectsState.shiftActive

  const disp = getDisplayedEffectChain(effectsState)
  const isMorphed = (controlId: string, baseVal: number): boolean =>
    instrumentState
      ? getMorphIndicatorInfo(
          getControlMorphTarget(instrumentState, controlId),
          instrumentState.morphs,
          baseVal,
        ).assigned
      : false

  const mod1Type = state['fx-mod1-type'] ?? 0
  const mod1On = (state['fx-mod1-on'] ?? 0) > 0
  const mod2Type = state['fx-mod2-type'] ?? 0
  const mod2On = (state['fx-mod2-on'] ?? 0) > 0
  const ampType = state['fx-amp-type'] ?? 0
  const ampOn = (state['fx-amp-on'] ?? 0) > 0

  const delayFilter = state['fx-delay-type'] ?? 0
  const delayPingPong = (state['fx-delay-pingpong'] ?? 0) > 0
  const delayOn = (state['fx-delay-on'] ?? 0) > 0
  const compFast = (state['fx-comp-fast'] ?? 0) > 0
  const compOn = (state['fx-comp-on'] ?? 0) > 0
  const reverbTone = state['fx-reverb-tone'] ?? 0
  const reverbType = state['fx-reverb-type'] ?? 1
  const reverbOn = (state['fx-reverb-on'] ?? 1) > 0

  return (
    <section
      className="ns4-section ns4-section-effects"
      data-section="effects"
      data-fx-focus={effectsState.focusedChain}
      data-fx-group-piano={effectsState.pianoGroupMode ? 'on' : 'off'}
      data-fx-group-synth={effectsState.synthGroupMode ? 'on' : 'off'}
      data-fx-global-delay={effectsState.global.delayGlobal ? 'on' : 'off'}
      data-fx-global-comp={effectsState.global.compGlobal ? 'on' : 'off'}
      data-fx-global-reverb={effectsState.global.reverbGlobal ? 'on' : 'off'}
      aria-label="Layer effects"
    >
      <div className="ns4-plate ns4-effects-plate">
        <div className="ns4-plate-header">
          <div className="ns4-plate-title-group">
            <span className="ns4-plate-title">LAYER EFFECTS</span>
          </div>
          <div className="ns4-plate-header-right">
            <span className="ns4-header-tag">ON</span>
            <LedDot on={sectionOn} color="red" size="xs" />
            <HardwareButton id="fx-section-on" state={state} dispatch={dispatch} size="sm" />
          </div>
        </div>

        <div className="ns4-effects-body">
          {/* Left red-chassis FX FOCUS strip */}
          <div className="ns4-fx-focus-rail" role="group" aria-label="FX Focus controls">
            <span className="ns4-fx-focus-head">FX FOCUS</span>

            <div className="ns4-fx-focus-cell">
              <span className="ns4-legend-micro">ORGAN</span>
              <div className="ns4-led-pair">
                <LedDot on={focusOrgan} color="amber" size="xs" />
                <LedDot on={focusOrgan} color="amber" size="xs" />
              </div>
              <HardwareButton id="fx-focus-organ" state={state} dispatch={dispatch} size="xs" />
            </div>

            <div className="ns4-fx-focus-cell">
              <span className="ns4-legend-micro">
                {effectsState.pianoGroupMode ? 'PNO GRP' : 'PIANO'}
              </span>
              <div className="ns4-led-pair">
                <LedDot on={focusPianoA} color="amber" size="xs" />
                <LedDot on={focusPianoB} color="amber" size="xs" />
              </div>
              <HardwareButton id="fx-focus-piano" state={state} dispatch={dispatch} size="xs" />
            </div>

            <div className="ns4-fx-focus-cell">
              <span className="ns4-legend-micro">
                {effectsState.synthGroupMode ? 'SYN GRP' : 'SYNTH'}
              </span>
              <div className="ns4-led-trio">
                <LedDot on={focusSynthA} color="amber" size="xs" />
                <LedDot on={focusSynthB} color="amber" size="xs" />
                <LedDot on={focusSynthC} color="amber" size="xs" />
              </div>
              <HardwareButton id="fx-focus-synth" state={state} dispatch={dispatch} size="xs" />
            </div>

            <div className="ns4-fx-shift-wrap">
              <LedDot on={shiftOn} color="amber" size="xs" />
              <span className="ns4-shift-tag">SHIFT</span>
              <HardwareButton
                id="fx-shift"
                state={state}
                dispatch={dispatch}
                variant="tall-light"
                size="xs"
              />
            </div>
          </div>

          {/* Two visibly separated effect groups divided by crisp vertical border */}
          <div className="ns4-fx-groups">
            {/* Group 1: MOD 1, MOD 2, AMP SIM/EQ */}
            <div className="ns4-fx-col ns4-fx-col-left" role="group" aria-label="Modulation, Amp Sim and EQ">
              {/* MOD 1 */}
              <div className="ns4-fx-unit">
                <div className="ns4-fx-unit-title">
                  MOD 1 {disp.mod1.clockSync ? '• CLK' : ''}
                </div>
                <div className="ns4-fx-unit-row">
                  <HardwareKnob
                    id="fx-mod1-rate"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="RATE"
                    morphAssigned={isMorphed('fx-mod1-rate', disp.mod1.rate)}
                  />
                  <HardwareKnob
                    id="fx-mod1-amount"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="AMT"
                    morphAssigned={isMorphed('fx-mod1-amount', disp.mod1.amount)}
                  />
                  <div className="ns4-fx-selector">
                    <div className="ns4-six-led-mini">
                      <LedDot on={mod1Type === 0} color="red" size="xs" />
                      <LedDot on={mod1Type === 3} color="red" size="xs" />
                      <LedDot on={mod1Type === 1} color="red" size="xs" />
                      <LedDot on={mod1Type === 4} color="red" size="xs" />
                      <LedDot on={mod1Type === 2} color="red" size="xs" />
                      <LedDot on={mod1Type === 5} color="red" size="xs" />
                    </div>
                    <HardwareButton id="fx-mod1-type" state={state} dispatch={dispatch} size="xs" />
                  </div>
                  <div className="ns4-fx-on-col">
                    <LedDot on={mod1On} color="red" size="xs" />
                    <HardwareButton
                      id="fx-mod1-on"
                      state={state}
                      dispatch={dispatch}
                      variant="tall-light"
                      size="xs"
                    />
                  </div>
                </div>
              </div>

              {/* MOD 2 */}
              <div className="ns4-fx-unit">
                <div className="ns4-fx-unit-title">MOD 2</div>
                <div className="ns4-fx-unit-row">
                  <HardwareKnob id="fx-mod2-rate" state={state} dispatch={dispatch} size="sm" label="RATE" />
                  <HardwareKnob
                    id="fx-mod2-amount"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="AMT"
                    morphAssigned={isMorphed('fx-mod2-amount', disp.mod2.amount)}
                  />
                  <div className="ns4-fx-selector">
                    <div className="ns4-six-led-mini">
                      <LedDot on={mod2Type === 0} color="red" size="xs" />
                      <LedDot on={mod2Type === 3} color="red" size="xs" />
                      <LedDot on={mod2Type === 1} color="red" size="xs" />
                      <LedDot on={mod2Type === 4} color="red" size="xs" />
                      <LedDot on={mod2Type === 2} color="red" size="xs" />
                      <LedDot on={mod2Type === 5} color="red" size="xs" />
                    </div>
                    <HardwareButton id="fx-mod2-type" state={state} dispatch={dispatch} size="xs" />
                  </div>
                  <div className="ns4-fx-on-col">
                    <LedDot on={mod2On} color="red" size="xs" />
                    <HardwareButton
                      id="fx-mod2-on"
                      state={state}
                      dispatch={dispatch}
                      variant="tall-light"
                      size="xs"
                    />
                  </div>
                </div>
              </div>

              {/* AMP SIM / EQ */}
              <div className="ns4-fx-unit ns4-fx-amp-eq">
                <div className="ns4-fx-unit-title">AMP SIM / EQ</div>
                <div className="ns4-fx-unit-row">
                  <HardwareKnob
                    id="fx-amp-drive"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="DRV"
                    morphAssigned={isMorphed('fx-amp-drive', disp.ampEq.drive)}
                  />
                  <HardwareKnob
                    id="fx-amp-freq"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="FREQ"
                    morphAssigned={isMorphed('fx-amp-freq', disp.ampEq.midFreq)}
                  />
                  <div className="ns4-fx-selector">
                    <div className="ns4-six-led-mini">
                      <LedDot on={ampType === 1} color="red" size="xs" />
                      <LedDot on={ampType === 4} color="red" size="xs" />
                      <LedDot on={ampType === 2} color="red" size="xs" />
                      <LedDot on={ampType === 5} color="red" size="xs" />
                      <LedDot on={ampType === 3} color="red" size="xs" />
                      <LedDot on={ampType === 6} color="amber" size="xs" />
                    </div>
                    <HardwareButton id="fx-amp-type" state={state} dispatch={dispatch} size="xs" />
                  </div>
                  <div className="ns4-fx-on-col">
                    <LedDot on={ampOn} color="red" size="xs" />
                    <HardwareButton
                      id="fx-amp-on"
                      state={state}
                      dispatch={dispatch}
                      variant="tall-light"
                      size="xs"
                    />
                  </div>
                </div>
                <div className="ns4-eq-row">
                  <HardwareKnob id="fx-eq-bass" state={state} dispatch={dispatch} size="sm" label="BASS" />
                  <HardwareKnob id="fx-eq-mid" state={state} dispatch={dispatch} size="sm" label="MID" />
                  <HardwareKnob id="fx-eq-treble" state={state} dispatch={dispatch} size="sm" label="TREB" />
                </div>
              </div>
            </div>

            {/* Group 2: DELAY, COMP, REVERB */}
            <div className="ns4-fx-col ns4-fx-col-right" role="group" aria-label="Delay, Compressor and Reverb">
              {/* DELAY */}
              <div className="ns4-fx-unit ns4-fx-delay">
                <div className="ns4-fx-unit-title">
                  DELAY {effectsState.global.delayGlobal ? '• GLB' : ''}
                  {disp.delay.clockSync ? ' • CLK' : ''}
                </div>
                <div className="ns4-fx-unit-row">
                  <HardwareKnob
                    id="fx-delay-tempo"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="TMPO"
                    morphAssigned={isMorphed('fx-delay-tempo', disp.delay.tempo)}
                  />
                  <div className="ns4-fx-selector">
                    <div className="ns4-led-trio">
                      <LedDot on={delayFilter === 1} color="red" size="xs" />
                      <LedDot on={delayFilter === 2} color="red" size="xs" />
                      <LedDot on={delayFilter === 3} color="red" size="xs" />
                    </div>
                    <HardwareButton id="fx-delay-type" state={state} dispatch={dispatch} size="xs" />
                  </div>
                  <HardwareKnob
                    id="fx-delay-feedback"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="FDBK"
                    morphAssigned={isMorphed('fx-delay-feedback', disp.delay.feedback)}
                  />
                </div>
                <div className="ns4-fx-unit-row">
                  <div className="ns4-tap-card">
                    <span className="ns4-legend-micro-dark">TAP</span>
                    <HardwareButton id="fx-delay-tap" state={state} dispatch={dispatch} size="xs" />
                  </div>
                  <HardwareKnob
                    id="fx-delay-dry-wet"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="WET"
                    morphAssigned={isMorphed('fx-delay-dry-wet', disp.delay.dryWet)}
                  />
                  <div className="ns4-fx-delay-right">
                    <div className="ns4-vib-on-row">
                      <LedDot on={delayPingPong} color="amber" size="xs" />
                      <HardwareButton id="fx-delay-pingpong" state={state} dispatch={dispatch} size="xs" />
                    </div>
                    <div className="ns4-vib-on-row">
                      <LedDot on={delayOn} color="red" size="xs" />
                      <HardwareButton
                        id="fx-delay-on"
                        state={state}
                        dispatch={dispatch}
                        variant="light"
                        size="xs"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom split: COMP + REVERB */}
              <div className="ns4-fx-bottom-split">
                <div className="ns4-fx-unit ns4-fx-comp">
                  <div className="ns4-fx-unit-title">
                    COMP {effectsState.global.compGlobal ? '• G' : ''}
                  </div>
                  <HardwareKnob id="fx-comp-amount" state={state} dispatch={dispatch} size="sm" label="AMT" />
                  <div className="ns4-vib-on-row">
                    <LedDot on={compFast} color="amber" size="xs" />
                    <HardwareButton id="fx-comp-fast" state={state} dispatch={dispatch} size="xs" />
                  </div>
                  <div className="ns4-vib-on-row">
                    <LedDot on={compOn} color="red" size="xs" />
                    <HardwareButton id="fx-comp-on" state={state} dispatch={dispatch} size="xs" />
                  </div>
                </div>

                <div className="ns4-fx-unit ns4-fx-reverb">
                  <div className="ns4-fx-unit-title">
                    REVERB {effectsState.global.reverbGlobal ? '• GLB' : ''}
                  </div>
                  <div className="ns4-fx-unit-row">
                    <div className="ns4-fx-selector">
                      <div className="ns4-led-pair">
                        <LedDot on={reverbTone === 1} color="red" size="xs" />
                        <LedDot on={reverbTone === 2} color="red" size="xs" />
                      </div>
                      <HardwareButton id="fx-reverb-tone" state={state} dispatch={dispatch} size="xs" />
                    </div>
                    <div className="ns4-fx-selector">
                      <div className="ns4-six-led-mini">
                        <LedDot on={reverbType === 0} color="red" size="xs" />
                        <LedDot on={reverbType === 3} color="red" size="xs" />
                        <LedDot on={reverbType === 1} color="red" size="xs" />
                        <LedDot on={reverbType === 4} color="red" size="xs" />
                        <LedDot on={reverbType === 2} color="red" size="xs" />
                        <LedDot on={reverbType === 5} color="red" size="xs" />
                      </div>
                      <HardwareButton id="fx-reverb-type" state={state} dispatch={dispatch} size="xs" />
                    </div>
                  </div>
                  <div className="ns4-fx-unit-row">
                    <HardwareKnob
                      id="fx-reverb-dry-wet"
                      state={state}
                      dispatch={dispatch}
                      size="sm"
                      label="WET"
                      morphAssigned={isMorphed('fx-reverb-dry-wet', disp.reverb.dryWet)}
                    />
                    <div className="ns4-vib-on-row">
                      <LedDot on={reverbOn} color="red" size="xs" />
                      <HardwareButton
                        id="fx-reverb-on"
                        state={state}
                        dispatch={dispatch}
                        variant="light"
                        size="xs"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <span className="ns4-sweden-mark" aria-hidden="true">
        HANDMADE IN SWEDEN BY CLAVIA DMI AB
      </span>
    </section>
  )
}
