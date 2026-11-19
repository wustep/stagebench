import {
  HardwareButton,
  HardwareFader,
  HardwareKnob,
  LedDot,
  type SectionProps,
} from '../PanelControls'

export function SynthSection({ state, dispatch }: SectionProps) {
  const sectionOn = (state['synth-section-on'] ?? 1) > 0
  const layerAOn = (state['synth-layer-a-on'] ?? 1) > 0
  const layerBOn = (state['synth-layer-b-on'] ?? 1) > 0
  const layerCOn = (state['synth-layer-c-on'] ?? 1) > 0
  const modeIdx = state['synth-mode'] ?? 1
  const arpIdx = state['synth-arp-mode'] ?? 1
  const voiceIdx = state['synth-voice-mode'] ?? 0
  const vibIdx = state['synth-vibrato-mode'] ?? 0
  const lfoDestIdx = state['synth-lfo-dest'] ?? 2
  const filterOn = (state['synth-filter-on'] ?? 1) > 0
  const unisonIdx = state['synth-unison'] ?? 1

  return (
    <section
      className="ns4-section ns4-section-synth"
      data-section="synth"
      aria-label="Synth section"
    >
      <div className="ns4-plate">
        <div className="ns4-plate-header">
          <div className="ns4-plate-title-group">
            <span className="ns4-plate-title">SYNTH</span>
            <span className="ns4-plate-subtitle">SECTION</span>
          </div>
          <div className="ns4-plate-header-right">
            <span className="ns4-header-tag">FX FOCUS</span>
            <LedDot on={true} color="amber" size="xs" />
            <span className="ns4-header-tag">ON</span>
            <LedDot on={sectionOn} color="red" size="xs" />
            <HardwareButton id="synth-section-on" state={state} dispatch={dispatch} size="sm" />
            <span className="ns4-header-tag">SOLO</span>
          </div>
        </div>

        <div className="ns4-synth-body">
          {/* Left 3-layer fader strip (A, B, C) */}
          <div className="ns4-synth-left">
            <div className="ns4-faders-row ns4-faders-row-3">
              <HardwareFader id="synth-layer-a-fader" state={state} dispatch={dispatch} layerLetter="A" />
              <HardwareFader id="synth-layer-b-fader" state={state} dispatch={dispatch} layerLetter="B" />
              <HardwareFader id="synth-layer-c-fader" state={state} dispatch={dispatch} layerLetter="C" />
            </div>

            <div className="ns4-layer-btns-row ns4-layer-btns-3">
              <div className="ns4-layer-btn-cell">
                <span className="ns4-onoff-pill">
                  <LedDot on={layerAOn} color="amber" size="xs" />
                </span>
                <HardwareButton
                  id="synth-layer-a-on"
                  state={state}
                  dispatch={dispatch}
                  variant="light"
                  size="xs"
                />
              </div>
              <div className="ns4-layer-btn-cell">
                <span className="ns4-onoff-pill">
                  <LedDot on={layerBOn} color="amber" size="xs" />
                </span>
                <HardwareButton
                  id="synth-layer-b-on"
                  state={state}
                  dispatch={dispatch}
                  variant="light"
                  size="xs"
                />
              </div>
              <div className="ns4-layer-btn-cell">
                <span className="ns4-onoff-pill">
                  <LedDot on={layerCOn} color="amber" size="xs" />
                </span>
                <HardwareButton
                  id="synth-layer-c-on"
                  state={state}
                  dispatch={dispatch}
                  variant="light"
                  size="xs"
                />
              </div>
            </div>

            <div className="ns4-synth-hold-row">
              <div className="ns4-synth-hold-cell">
                <span className="ns4-red-pill">KB HOLD</span>
                <HardwareButton id="synth-kb-hold" state={state} dispatch={dispatch} size="xs" />
              </div>
              <div className="ns4-synth-hold-cell">
                <span className="ns4-legend-micro">ARP RUN</span>
                <HardwareButton
                  id="synth-arp-run"
                  state={state}
                  dispatch={dispatch}
                  variant="red"
                  size="xs"
                />
              </div>
            </div>

            <div className="ns4-octave-block">
              <span className="ns4-legend-micro">◀ OCTAVE SHIFT ▶</span>
              <div className="ns4-octave-btns">
                <HardwareButton id="synth-octave-down" state={state} dispatch={dispatch} size="xs" />
                <HardwareButton id="synth-octave-up" state={state} dispatch={dispatch} size="xs" />
              </div>
              <div className="ns4-kb-zone-leds" aria-hidden="true">
                <LedDot on={false} color="green" size="xs" />
                <LedDot on={true} color="green" size="xs" />
                <LedDot on={true} color="green" size="xs" />
              </div>
            </div>
          </div>

          {/* Right main synth surface */}
          <div className="ns4-synth-main">
            {/* Upper zone: narrow Synth OLED + 3 encoders | MODE | ARPEGGIATOR/GATE + VOICE + VIBRATO */}
            <div className="ns4-synth-upper">
              <div className="ns4-synth-oled-cluster">
                <div
                  id="synth-oled"
                  className="ns4-oled-synth"
                  aria-label="Synth OLED display"
                >
                  <div className="ns4-oled-synth-bar">SYNTH · PHASE 1</div>
                  <div className="ns4-oled-synth-title">Decorative</div>
                  <div className="ns4-oled-synth-sub">AUDIO IN PHASE 3</div>
                </div>
                <div className="ns4-synth-enc-lines" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="ns4-synth-encoders">
                  <HardwareKnob
                    id="synth-enc-type"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    variant="encoder"
                    label="INFO"
                  />
                  <HardwareKnob
                    id="synth-enc-cat"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    variant="encoder"
                    label="LIST"
                  />
                  <HardwareKnob
                    id="synth-enc-wave"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    variant="encoder"
                    label="LIST"
                  />
                </div>
              </div>

              <div className="ns4-synth-mode-col">
                <div className="ns4-synth-mode-card">
                  <span className="ns4-card-head">MODE</span>
                  <div className="ns4-led-label-line">
                    <LedDot on={modeIdx === 0} color="red" size="xs" />
                    <span>SMP</span>
                  </div>
                  <div className="ns4-led-label-line">
                    <LedDot on={modeIdx === 1} color="red" size="xs" />
                    <span>ANLG</span>
                  </div>
                  <HardwareButton id="synth-mode" state={state} dispatch={dispatch} size="xs" />
                  <div className="ns4-led-label-line">
                    <LedDot on={modeIdx === 2} color="red" size="xs" />
                    <span>EXT</span>
                  </div>
                </div>
                <div className="ns4-synth-wave-init">
                  <span className="ns4-legend-micro">WAVE</span>
                  <HardwareButton
                    id="synth-waveform-btn"
                    state={state}
                    dispatch={dispatch}
                    variant="red-frame"
                    size="xs"
                  />
                </div>
              </div>

              <div className="ns4-synth-arp-voice-col">
                <div className="ns4-subbox ns4-arp-box">
                  <div className="ns4-subbox-title">ARPEGGIATOR / GATE</div>
                  <div className="ns4-arp-row">
                    <HardwareKnob
                      id="synth-arp-rate"
                      state={state}
                      dispatch={dispatch}
                      size="sm"
                      label="RATE"
                    />
                    <div className="ns4-arp-mode-cell">
                      <div className="ns4-led-label-line">
                        <span>ARP</span>
                        <LedDot on={arpIdx === 1} color="red" size="xs" />
                      </div>
                      <HardwareButton id="synth-arp-mode" state={state} dispatch={dispatch} size="xs" />
                    </div>
                    <HardwareKnob
                      id="synth-arp-range"
                      state={state}
                      dispatch={dispatch}
                      size="sm"
                      variant="red-ring"
                      label="RANGE"
                    />
                    <HardwareButton
                      id="synth-arp-menu"
                      state={state}
                      dispatch={dispatch}
                      variant="red-frame"
                      size="xs"
                    />
                  </div>
                </div>

                <div className="ns4-voice-vib-row">
                  <div className="ns4-subbox ns4-voice-box">
                    <div className="ns4-subbox-title">VOICE</div>
                    <div className="ns4-voice-inner">
                      <div className="ns4-voice-leds">
                        <div className="ns4-led-label-line">
                          <LedDot on={voiceIdx === 1} color="red" size="xs" />
                          <span>MONO</span>
                        </div>
                        <div className="ns4-led-label-line">
                          <LedDot on={voiceIdx === 2} color="red" size="xs" />
                          <span>LEG</span>
                        </div>
                        <HardwareButton id="synth-voice-mode" state={state} dispatch={dispatch} size="xs" />
                      </div>
                      <HardwareKnob
                        id="synth-voice-glide"
                        state={state}
                        dispatch={dispatch}
                        size="sm"
                        label="GLIDE"
                      />
                    </div>
                  </div>

                  <div className="ns4-subbox ns4-vib-box">
                    <div className="ns4-subbox-title">VIBRATO</div>
                    <div className="ns4-vib-inner">
                      <div className="ns4-voice-leds">
                        <div className="ns4-led-pair">
                          <LedDot on={vibIdx === 1} color="red" size="xs" />
                          <LedDot on={vibIdx === 2} color="red" size="xs" />
                          <LedDot on={vibIdx >= 3} color="red" size="xs" />
                        </div>
                        <HardwareButton id="synth-vibrato-mode" state={state} dispatch={dispatch} size="xs" />
                      </div>
                      <HardwareButton
                        id="synth-vibrato-menu"
                        state={state}
                        dispatch={dispatch}
                        variant="red-frame"
                        size="xs"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom grouped slate cards: LFO | OSCILLATORS | FILTER | AMP & UNISON */}
            <div className="ns4-synth-modules">
              <div className="ns4-slate-card ns4-mod-lfo">
                <div className="ns4-card-head">LFO</div>
                <div className="ns4-card-row">
                  <HardwareButton
                    id="synth-lfo-wave"
                    state={state}
                    dispatch={dispatch}
                    variant="red-frame"
                    size="xs"
                  />
                  <HardwareKnob
                    id="synth-lfo-amt"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="AMT"
                  />
                </div>
                <div className="ns4-card-row">
                  <HardwareKnob
                    id="synth-lfo-rate"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="RATE"
                  />
                  <div className="ns4-lfo-dest-cell">
                    <div className="ns4-led-pair">
                      <LedDot on={lfoDestIdx === 0} color="red" size="xs" />
                      <LedDot on={lfoDestIdx === 1} color="red" size="xs" />
                      <LedDot on={lfoDestIdx === 2} color="red" size="xs" />
                    </div>
                    <HardwareButton id="synth-lfo-dest" state={state} dispatch={dispatch} size="xs" />
                  </div>
                </div>
              </div>

              <div className="ns4-slate-card ns4-mod-osc">
                <div className="ns4-card-head">OSCILLATORS</div>
                <div className="ns4-card-row">
                  <HardwareButton
                    id="synth-osc-pitch"
                    state={state}
                    dispatch={dispatch}
                    variant="red-frame"
                    size="xs"
                  />
                  <HardwareButton
                    id="synth-osc-env"
                    state={state}
                    dispatch={dispatch}
                    variant="red-frame"
                    size="xs"
                  />
                </div>
                <div className="ns4-card-row">
                  <HardwareKnob
                    id="synth-osc-ctrl"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="CTRL"
                  />
                  <HardwareKnob
                    id="synth-osc-env-amt"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="ENV"
                  />
                </div>
              </div>

              <div className="ns4-slate-card ns4-mod-filter">
                <div className="ns4-card-head">FILTER</div>
                <div className="ns4-card-row">
                  <HardwareButton
                    id="synth-filter-type"
                    state={state}
                    dispatch={dispatch}
                    variant="red-frame"
                    size="xs"
                  />
                  <HardwareButton
                    id="synth-filter-env"
                    state={state}
                    dispatch={dispatch}
                    variant="red-frame"
                    size="xs"
                  />
                  <HardwareKnob
                    id="synth-filter-env-amt"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="ENV"
                  />
                </div>
                <div className="ns4-card-row">
                  <HardwareKnob
                    id="synth-filter-freq"
                    state={state}
                    dispatch={dispatch}
                    size="md"
                    label="FREQ"
                  />
                  <HardwareKnob
                    id="synth-filter-res"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="RES"
                  />
                  <div className="ns4-filter-on-cell">
                    <LedDot on={filterOn} color="red" size="xs" />
                    <HardwareButton
                      id="synth-filter-on"
                      state={state}
                      dispatch={dispatch}
                      variant="tall-dark"
                      size="xs"
                    />
                  </div>
                </div>
              </div>

              <div className="ns4-mod-amp-col">
                <div className="ns4-slate-card ns4-mod-amp">
                  <div className="ns4-card-head">AMP</div>
                  <HardwareButton
                    id="synth-amp-env"
                    state={state}
                    dispatch={dispatch}
                    variant="red-frame"
                    size="xs"
                  />
                  <span className="ns4-legend-micro-dark">VEL</span>
                </div>
                <div className="ns4-unison-mini">
                  <span className="ns4-legend-micro">UNISON</span>
                  <div className="ns4-led-trio">
                    <LedDot on={unisonIdx === 1} color="red" size="xs" />
                    <LedDot on={unisonIdx === 2} color="red" size="xs" />
                    <LedDot on={unisonIdx === 3} color="red" size="xs" />
                  </div>
                  <HardwareButton id="synth-unison" state={state} dispatch={dispatch} size="xs" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
