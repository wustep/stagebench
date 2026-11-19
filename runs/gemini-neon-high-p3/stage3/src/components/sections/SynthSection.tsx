import {
  getControlMorphTarget,
  type InstrumentAction,
  type StageInstrumentState,
} from '../../model/instrumentState'
import { getMorphIndicatorInfo } from '../../model/morphs'
import {
  SYNTH_KB_TRACK_LABELS,
  type SynthOledView,
} from '../../model/organSynthTypes'
import {
  cycleLayerZone,
  formatZoneRangeLabel,
  getActiveZoneCount,
} from '../../model/splits'
import {
  HardwareButton,
  HardwareFader,
  HardwareKnob,
  LedDot,
  type SectionProps,
} from '../PanelControls'

export interface SynthSectionProps extends SectionProps {
  readonly instrumentState: StageInstrumentState
  readonly dispatchInstrument: (action: InstrumentAction) => void
}

function renderSynthOledContent(
  instrumentState: StageInstrumentState,
  view: SynthOledView,
): { bar: string; title: string; sub: string; encLabels: readonly [string, string, string] } {
  const layerId = instrumentState.synth.focusedLayer
  const layer = instrumentState.synth.layers[layerId]
  const modeTag =
    layer.mode === 'Analog'
      ? 'ANALOG'
      : layer.mode === 'Extern'
        ? 'EXT UNSUP'
        : 'SMP UNSUP'

  if (view === 'osc-pitch') {
    const coarse = layer.pitchCoarse >= 0 ? `+${layer.pitchCoarse}` : `${layer.pitchCoarse}`
    const fine = layer.pitchFine >= 0 ? `+${layer.pitchFine}` : `${layer.pitchFine}`
    return {
      bar: `SYN ${layerId} · PITCH`,
      title: `C:${coarse}st F:${fine}c`,
      sub: `ENV>PTCH ${layer.oscEnv.toPitch ? 'ON' : 'OFF'}`,
      encLabels: ['COAR', 'FINE', 'E>PT'],
    }
  }

  if (view === 'osc-env') {
    const dec = layer.oscEnv.decay >= 99 ? 'SUST' : `${layer.oscEnv.decay}`
    return {
      bar: `SYN ${layerId} · OSC ENV`,
      title: `A${layer.oscEnv.attack} D${dec} R${layer.oscEnv.release}`,
      sub: `VEL:${layer.oscEnv.velocity ? 'ON' : 'OFF'} ${layer.oscEnv.toPitch ? 'PITCH' : 'CTRL'}`,
      encLabels: ['ATK', 'DEC', 'REL'],
    }
  }

  if (view === 'filter') {
    return {
      bar: `SYN ${layerId} · FILTER`,
      title: `${layer.filter.type} · DRV ${layer.filter.drive === 0 ? 'OFF' : layer.filter.drive}`,
      sub: `KBTRK ${SYNTH_KB_TRACK_LABELS[layer.filter.kbTrack]}`,
      encLabels: ['TYPE', 'KBTK', 'DRV'],
    }
  }

  if (view === 'filter-env') {
    const dec = layer.filterEnv.decay >= 99 ? 'SUST' : `${layer.filterEnv.decay}`
    return {
      bar: `SYN ${layerId} · FLT ENV`,
      title: `A${layer.filterEnv.attack} D${dec} R${layer.filterEnv.release}`,
      sub: `VEL:${layer.filterEnv.velocity ? 'ON' : 'OFF'} AMT:${layer.filter.envAmt}`,
      encLabels: ['ATK', 'DEC', 'REL'],
    }
  }

  if (view === 'amp-env') {
    const dec = layer.ampEnv.decay >= 99 ? 'SUST' : `${layer.ampEnv.decay}`
    return {
      bar: `SYN ${layerId} · AMP ENV`,
      title: `A${layer.ampEnv.attack} D${dec} R${layer.ampEnv.release}`,
      sub: `VEL:${layer.ampEnv.velocity === 0 ? 'OFF' : layer.ampEnv.velocity}`,
      encLabels: ['ATK', 'DEC', 'REL'],
    }
  }

  if (view === 'arp') {
    return {
      bar: `SYN ${layerId} · ARP/GATE`,
      title: `${layer.arp.mode.toUpperCase()} ${layer.arp.direction}`,
      sub: `${layer.arp.clockSync ? 'CLK' : 'FREE'} · ${layer.arp.range} OCT`,
      encLabels: ['DIR', 'SYNC', 'OCT'],
    }
  }

  if (view === 'voice-vib') {
    return {
      bar: `SYN ${layerId} · VIB/PRI`,
      title: `${layer.vibrato.rateHz.toFixed(1)}Hz AMT ${layer.vibrato.amount}`,
      sub: `PRI:${layer.voice.priority.toUpperCase()} · ${layer.voice.mode.toUpperCase()}`,
      encLabels: ['RATE', 'AMT', 'PRI'],
    }
  }

  return {
    bar: `SYN ${layerId} · ${modeTag}`,
    title: layer.oscWaveform,
    sub: `${layer.oscCategory.toUpperCase()} · CTRL ${Math.round(layer.oscCtrl / 10)}`,
    encLabels: ['CAT', 'WAVE', 'COAR'],
  }
}

export function SynthSection({
  state,
  dispatch,
  instrumentState,
  dispatchInstrument,
}: SynthSectionProps) {
  const synth = instrumentState.synth
  const focused = synth.layers[synth.focusedLayer]
  const sectionOn = synth.sectionOn
  const layerAOn = synth.layers.A.enabled
  const layerBOn = synth.layers.B.enabled
  const layerCOn = synth.layers.C.enabled
  const fxFocused = instrumentState.effects.focusedChain.startsWith('synth')
  const modeIdx = state['synth-mode'] ?? 1
  const arpIdx = state['synth-arp-mode'] ?? 1
  const voiceIdx = state['synth-voice-mode'] ?? 0
  const vibIdx = state['synth-vibrato-mode'] ?? 0
  const filterOn = focused.filter.on
  const unisonIdx = focused.voice.unison
  const lfoDest = focused.lfo.destination

  const zoneCount = getActiveZoneCount(instrumentState.split)
  const zoneLabel = formatZoneRangeLabel(focused.zone, instrumentState.split)
  const zoneLedLit = (slot: number) => {
    if (zoneCount <= 1) return true
    return slot >= focused.zone.lowZone && slot <= focused.zone.highZone
  }

  const oled = renderSynthOledContent(instrumentState, instrumentState.synthOledView)

  const morphFor = (controlId: string, baseVal: number) =>
    getMorphIndicatorInfo(getControlMorphTarget(instrumentState, controlId), instrumentState.morphs, baseVal)

  const mFaderA = morphFor('synth-layer-a-fader', synth.layers.A.level)
  const mFaderB = morphFor('synth-layer-b-fader', synth.layers.B.level)
  const mFaderC = morphFor('synth-layer-c-fader', synth.layers.C.level)
  const mArpRate = morphFor('synth-arp-rate', focused.arp.rate)
  const mLfoAmt = morphFor('synth-lfo-amt', focused.lfo.amount)
  const mLfoRate = morphFor('synth-lfo-rate', focused.lfo.rate)
  const mOscCtrl = morphFor('synth-osc-ctrl', focused.oscCtrl)
  const mFiltFreq = morphFor('synth-filter-freq', focused.filter.freq)
  const mFiltRes = morphFor('synth-filter-res', focused.filter.res)

  return (
    <section
      className="ns4-section ns4-section-synth"
      data-section="synth"
      data-focused-layer={synth.focusedLayer}
      data-synth-waveform={focused.oscWaveform}
      data-synth-category={focused.oscCategory}
      data-synth-zone={zoneLabel}
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
            <LedDot on={fxFocused} color="amber" size="xs" />
            <span className="ns4-header-tag">ON</span>
            <LedDot on={sectionOn} color="red" size="xs" />
            <HardwareButton id="synth-section-on" state={state} dispatch={dispatch} size="sm" />
            <span className="ns4-header-tag">
              {instrumentState.program.soloSection === 'synth' ? 'SOLO*' : 'SOLO'}
            </span>
          </div>
        </div>

        <div className="ns4-synth-body">
          {/* Left 3-layer fader strip (A, B, C) */}
          <div className="ns4-synth-left">
            <div className="ns4-faders-row ns4-faders-row-3">
              <div className={synth.focusedLayer === 'A' ? 'ns4-layer-focused' : ''}>
                <HardwareFader
                  id="synth-layer-a-fader"
                  state={state}
                  dispatch={dispatch}
                  layerLetter="A"
                  morphAssigned={mFaderA.assigned}
                  morphRange={mFaderA.assigned ? [mFaderA.rangeStart, mFaderA.rangeEnd] : undefined}
                />
              </div>
              <div className={synth.focusedLayer === 'B' ? 'ns4-layer-focused' : ''}>
                <HardwareFader
                  id="synth-layer-b-fader"
                  state={state}
                  dispatch={dispatch}
                  layerLetter="B"
                  morphAssigned={mFaderB.assigned}
                  morphRange={mFaderB.assigned ? [mFaderB.rangeStart, mFaderB.rangeEnd] : undefined}
                />
              </div>
              <div className={synth.focusedLayer === 'C' ? 'ns4-layer-focused' : ''}>
                <HardwareFader
                  id="synth-layer-c-fader"
                  state={state}
                  dispatch={dispatch}
                  layerLetter="C"
                  morphAssigned={mFaderC.assigned}
                  morphRange={mFaderC.assigned ? [mFaderC.rangeStart, mFaderC.rangeEnd] : undefined}
                />
              </div>
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
                <span className="ns4-red-pill">
                  <LedDot on={focused.arp.kbHold} color="red" size="xs" /> KB HOLD
                </span>
                <HardwareButton id="synth-kb-hold" state={state} dispatch={dispatch} size="xs" />
              </div>
              <div className="ns4-synth-hold-cell">
                <span className="ns4-legend-micro">
                  <LedDot on={focused.arp.run} color="red" size="xs" /> ARP RUN
                </span>
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
              <button
                type="button"
                className="ns4-kb-zone-leds ns4-kb-zone-btn"
                aria-label={`Synth Layer ${synth.focusedLayer} KB Zone ${zoneLabel}`}
                title="Cycle KB Zone assignment (or Shift + Octave)"
                onClick={() =>
                  dispatchInstrument({
                    type: 'set-layer-zone',
                    section: 'synth',
                    layer: synth.focusedLayer,
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

          {/* Right main synth surface */}
          <div className="ns4-synth-main">
            {/* Upper zone: narrow Synth OLED + 3 encoders | MODE | ARPEGGIATOR/GATE + VOICE + VIBRATO */}
            <div className="ns4-synth-upper">
              <div className="ns4-synth-oled-cluster">
                <div
                  id="synth-oled"
                  className="ns4-oled-synth"
                  role="status"
                  aria-live="polite"
                  aria-label="Synth OLED display"
                >
                  <div className="ns4-oled-synth-bar">{oled.bar}</div>
                  <div className="ns4-oled-synth-title">{oled.title}</div>
                  <div className="ns4-oled-synth-sub">{oled.sub}</div>
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
                    label={oled.encLabels[0]}
                  />
                  <HardwareKnob
                    id="synth-enc-cat"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    variant="encoder"
                    label={oled.encLabels[1]}
                  />
                  <HardwareKnob
                    id="synth-enc-wave"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    variant="encoder"
                    label={oled.encLabels[2]}
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
                      label={focused.arp.clockSync ? 'CLK' : 'RATE'}
                      morphAssigned={mArpRate.assigned}
                    />
                    <div className="ns4-arp-mode-cell">
                      <div className="ns4-led-label-line">
                        <span>{focused.arp.mode.toUpperCase()}</span>
                        <LedDot on={arpIdx === 1 || arpIdx === 2} color="red" size="xs" />
                      </div>
                      <HardwareButton id="synth-arp-mode" state={state} dispatch={dispatch} size="xs" />
                    </div>
                    <HardwareKnob
                      id="synth-arp-range"
                      state={state}
                      dispatch={dispatch}
                      size="sm"
                      variant="red-ring"
                      label={focused.arp.mode === 'Gate' ? 'ENV' : 'RANGE'}
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
                <div className="ns4-card-head">
                  LFO {focused.lfo.clockSync ? '·CLK' : ''}
                </div>
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
                    morphAssigned={mLfoAmt.assigned}
                  />
                </div>
                <div className="ns4-card-row">
                  <HardwareKnob
                    id="synth-lfo-rate"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="RATE"
                    morphAssigned={mLfoRate.assigned}
                  />
                  <div className="ns4-lfo-dest-cell">
                    {/* No destination LED lit means LFO is Off (manual p. 34) */}
                    <div className="ns4-led-pair">
                      <LedDot on={lfoDest === 'Osc Pitch'} color="red" size="xs" />
                      <LedDot on={lfoDest === 'Osc Ctrl'} color="red" size="xs" />
                      <LedDot on={lfoDest === 'Filter Freq'} color="red" size="xs" />
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
                    morphAssigned={mOscCtrl.assigned}
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
                <div className="ns4-card-head">FILTER · {focused.filter.type}</div>
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
                    morphAssigned={mFiltFreq.assigned}
                  />
                  <HardwareKnob
                    id="synth-filter-res"
                    state={state}
                    dispatch={dispatch}
                    size="sm"
                    label="RES"
                    morphAssigned={mFiltRes.assigned}
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
                  <span className="ns4-legend-micro-dark">
                    VEL {focused.ampEnv.velocity === 0 ? '-' : focused.ampEnv.velocity}
                  </span>
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
