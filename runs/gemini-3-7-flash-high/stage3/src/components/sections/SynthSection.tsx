import React from 'react';
import { Knob } from '../controls/Knob';
import { Button } from '../controls/Button';
import { Fader } from '../controls/Fader';
import { OledDisplay } from '../controls/OledDisplay';
import {
  HardwareState,
  SYNTH_OSC_CATEGORIES,
  SYNTH_WAVEFORMS,
  SYNTH_FILTER_TYPES,
  SYNTH_LFO_WAVEFORMS,
  SYNTH_LFO_DESTINATIONS,
  SYNTH_VOICE_MODES,
  SYNTH_ARP_MODES,
  SYNTH_ARP_DIRECTIONS,
} from '../../model/hardware';
import { hasMorphAssignment } from '../../model/morph';

interface SynthSectionProps {
  state: HardwareState;
  updateState: (updater: (prev: HardwareState) => HardwareState) => void;
}

export const SynthSection: React.FC<SynthSectionProps> = ({ state, updateState }) => {
  const morphState = {
    wheelValue: state.mod_wheel,
    ctrlPedValue: state.ctrl_pedal,
    activeMorphEditSource: state.morph_edit_source,
    assignments: state.morph_assignments,
  };

  const currentCategory = SYNTH_OSC_CATEGORIES[state.synth_osc_category] || 'Pure';
  const availableWaveforms = SYNTH_WAVEFORMS[currentCategory] || ['Sine'];
  const currentWaveformName =
    availableWaveforms[state.synth_waveform % availableWaveforms.length] || 'Sine';

  const oscCtrlLabels: Record<string, string> = {
    Pure: 'Wave Shape / Spread',
    Sync: 'Slave Pitch (Sync)',
    Multi: 'Multi Detune Amount',
    Super: 'Super Saw Spread',
    'FM-H': 'FM Mod Index / Depth',
  };

  const currentOscCtrlLabel = oscCtrlLabels[currentCategory] || 'Osc Ctrl';

  return (
    <section
      id="section-synth"
      aria-label="Synthesizer Section"
      className="panel-section dark-inset-section section-synth"
    >
      <div className="section-title-bar">
        <Button
          id="synth-on"
          label="SYNTH"
          active={state.synth_on}
          ledColor="red"
          onClick={() => updateState((prev) => ({ ...prev, synth_on: !prev.synth_on }))}
        />
        <div className="section-title-text">SYNTHESIZER</div>
        <div className="section-flags">
          <Button
            id="synth-group-btn"
            label="GROUP"
            active={state.effects_group_synth}
            onClick={() =>
              updateState((prev) => ({
                ...prev,
                effects_group_synth: !prev.effects_group_synth,
              }))
            }
          />
          <Button
            id="synth-sustain-btn"
            label="SUSTPED"
            active={state.synth_sustain}
            onClick={() => updateState((prev) => ({ ...prev, synth_sustain: !prev.synth_sustain }))}
          />
          <Button
            id="synth-pstick-btn"
            label="PSTICK"
            active={state.synth_pstick}
            onClick={() => updateState((prev) => ({ ...prev, synth_pstick: !prev.synth_pstick }))}
          />
        </div>
      </div>

      <div className="synth-content-grid">
        {/* Layer Strips: A, B, C */}
        <div className="synth-layers-strip">
          {/* Layer A */}
          <div className={`synth-layer-channel ${state.synth_layer_a_focus ? 'focused' : ''}`}>
            <div className="layer-header">
              <Button
                id="synth-layer-a-on"
                label="A"
                active={state.synth_layer_a_on}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_layer_a_on: !prev.synth_layer_a_on,
                    synth_layer_a_focus: true,
                    synth_layer_b_focus: false,
                    synth_layer_c_focus: false,
                  }))
                }
              />
              <span
                className="layer-tag"
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_layer_a_focus: true,
                    synth_layer_b_focus: false,
                    synth_layer_c_focus: false,
                  }))
                }
                style={{ cursor: 'pointer' }}
              >
                LAYER A {state.synth_layer_a_focus ? '★' : ''}
              </span>
              <div className="layer-tools">
                <Button
                  id="synth-layer-a-oct-down"
                  label="-"
                  subLabel={`${state.synth_layer_a_octave}`}
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      synth_layer_a_octave: Math.max(-2, prev.synth_layer_a_octave - 1),
                    }))
                  }
                />
                <Button
                  id="synth-layer-a-oct-up"
                  label="+"
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      synth_layer_a_octave: Math.min(2, prev.synth_layer_a_octave + 1),
                    }))
                  }
                />
              </div>
            </div>
            <Fader
              id="synth-layer-a-level"
              label="LEVEL"
              value={state.synth_layer_a_level}
              hasMorph={hasMorphAssignment('synth_layer_a_level', morphState)}
              onChange={(val) => updateState((prev) => ({ ...prev, synth_layer_a_level: val }))}
            />
          </div>

          {/* Layer B */}
          <div className={`synth-layer-channel ${state.synth_layer_b_focus ? 'focused' : ''}`}>
            <div className="layer-header">
              <Button
                id="synth-layer-b-on"
                label="B"
                active={state.synth_layer_b_on}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_layer_b_on: !prev.synth_layer_b_on,
                    synth_layer_a_focus: false,
                    synth_layer_b_focus: true,
                    synth_layer_c_focus: false,
                  }))
                }
              />
              <span
                className="layer-tag"
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_layer_a_focus: false,
                    synth_layer_b_focus: true,
                    synth_layer_c_focus: false,
                  }))
                }
                style={{ cursor: 'pointer' }}
              >
                LAYER B {state.synth_layer_b_focus ? '★' : ''}
              </span>
              <div className="layer-tools">
                <Button
                  id="synth-layer-b-oct-down"
                  label="-"
                  subLabel={`${state.synth_layer_b_octave}`}
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      synth_layer_b_octave: Math.max(-2, prev.synth_layer_b_octave - 1),
                    }))
                  }
                />
                <Button
                  id="synth-layer-b-oct-up"
                  label="+"
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      synth_layer_b_octave: Math.min(2, prev.synth_layer_b_octave + 1),
                    }))
                  }
                />
              </div>
            </div>
            <Fader
              id="synth-layer-b-level"
              label="LEVEL"
              value={state.synth_layer_b_level}
              hasMorph={hasMorphAssignment('synth_layer_b_level', morphState)}
              onChange={(val) => updateState((prev) => ({ ...prev, synth_layer_b_level: val }))}
            />
          </div>

          {/* Layer C */}
          <div className={`synth-layer-channel ${state.synth_layer_c_focus ? 'focused' : ''}`}>
            <div className="layer-header">
              <Button
                id="synth-layer-c-on"
                label="C"
                active={state.synth_layer_c_on}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_layer_c_on: !prev.synth_layer_c_on,
                    synth_layer_a_focus: false,
                    synth_layer_b_focus: false,
                    synth_layer_c_focus: true,
                  }))
                }
              />
              <span
                className="layer-tag"
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_layer_a_focus: false,
                    synth_layer_b_focus: false,
                    synth_layer_c_focus: true,
                  }))
                }
                style={{ cursor: 'pointer' }}
              >
                LAYER C {state.synth_layer_c_focus ? '★' : ''}
              </span>
              <div className="layer-tools">
                <Button
                  id="synth-layer-c-oct-down"
                  label="-"
                  subLabel={`${state.synth_layer_c_octave}`}
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      synth_layer_c_octave: Math.max(-2, prev.synth_layer_c_octave - 1),
                    }))
                  }
                />
                <Button
                  id="synth-layer-c-oct-up"
                  label="+"
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      synth_layer_c_octave: Math.min(2, prev.synth_layer_c_octave + 1),
                    }))
                  }
                />
              </div>
            </div>
            <Fader
              id="synth-layer-c-level"
              label="LEVEL"
              value={state.synth_layer_c_level}
              hasMorph={hasMorphAssignment('synth_layer_c_level', morphState)}
              onChange={(val) => updateState((prev) => ({ ...prev, synth_layer_c_level: val }))}
            />
          </div>
        </div>

        {/* Oscillator & Waveform Block */}
        <div className="synth-osc-block">
          <div className="synth-oled-row">
            <OledDisplay
              id="synth-oled"
              title={`OSC: ${currentCategory}`}
              badge={`Wave: ${currentWaveformName}`}
              lines={[
                `Ctrl: ${state.synth_osc_mod.toFixed(1)} (${currentOscCtrlLabel})`,
                `Filter: ${SYNTH_FILTER_TYPES[state.synth_filter_type]} | Cutoff: ${state.synth_filter_cutoff.toFixed(1)}`,
                `Voice: ${SYNTH_VOICE_MODES[state.synth_voice_mode]} | Arp: ${state.synth_arp_run ? 'RUN' : 'OFF'}`,
              ]}
              subInfo={`LFO: ${SYNTH_LFO_WAVEFORMS[state.synth_lfo_waveform]} -> ${SYNTH_LFO_DESTINATIONS[state.synth_lfo_destination]}`}
            />
          </div>

          <div className="osc-controls-row">
            <div className="osc-type-buttons">
              <Button
                id="synth-osc-category-btn"
                label="CATEGORY"
                subLabel={currentCategory}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_osc_category: (prev.synth_osc_category + 1) % SYNTH_OSC_CATEGORIES.length,
                    synth_waveform: 0,
                  }))
                }
              />
              <Button
                id="synth-osc-waveform-btn"
                label="WAVE"
                subLabel={currentWaveformName}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_waveform: (prev.synth_waveform + 1) % availableWaveforms.length,
                  }))
                }
              />
            </div>
            <Knob
              id="synth-osc-mod"
              label="OSC CTRL"
              value={state.synth_osc_mod}
              min={0}
              max={10}
              hasMorph={hasMorphAssignment('synth_osc_mod', morphState)}
              onChange={(val) => updateState((prev) => ({ ...prev, synth_osc_mod: val }))}
            />
          </div>
        </div>

        {/* Filter Block */}
        <div className="synth-filter-block">
          <div className="filter-header-row">
            <span className="block-title">FILTER</span>
            <Button
              id="synth-filter-type-btn"
              label="TYPE"
              subLabel={SYNTH_FILTER_TYPES[state.synth_filter_type]}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  synth_filter_type: (prev.synth_filter_type + 1) % SYNTH_FILTER_TYPES.length,
                }))
              }
            />
            <Button
              id="synth-filter-kbtrack-btn"
              label="KB TRACK"
              subLabel={['OFF', '1/3', '2/3', '1:1'][state.synth_filter_kb_tracking]}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  synth_filter_kb_tracking: (prev.synth_filter_kb_tracking + 1) % 4,
                }))
              }
            />
          </div>
          <div className="filter-knobs-row">
            <Knob
              id="synth-filter-cutoff"
              label="FREQ"
              value={state.synth_filter_cutoff}
              min={0}
              max={10}
              hasMorph={hasMorphAssignment('synth_filter_cutoff', morphState)}
              onChange={(val) => updateState((prev) => ({ ...prev, synth_filter_cutoff: val }))}
            />
            <Knob
              id="synth-filter-resonance"
              label="RES"
              value={state.synth_filter_resonance}
              min={0}
              max={10}
              hasMorph={hasMorphAssignment('synth_filter_resonance', morphState)}
              onChange={(val) => updateState((prev) => ({ ...prev, synth_filter_resonance: val }))}
            />
            <Knob
              id="synth-filter-env-amt"
              label="ENV AMT"
              value={state.synth_filter_env_amt}
              min={-10}
              max={10}
              onChange={(val) => updateState((prev) => ({ ...prev, synth_filter_env_amt: val }))}
            />
            <Button
              id="synth-filter-drive-btn"
              label="DRIVE"
              subLabel={state.synth_filter_drive === 0 ? 'OFF' : `${state.synth_filter_drive}`}
              active={state.synth_filter_drive > 0}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  synth_filter_drive: (prev.synth_filter_drive + 1) % 4,
                }))
              }
            />
          </div>
        </div>

        {/* Envelopes Block: Amp ADR, Mod ADR */}
        <div className="synth-envelopes-block">
          <div className="envelope-column">
            <span className="block-title">AMP ENVELOPE</span>
            <div className="envelope-knobs">
              <Knob
                id="synth-amp-attack"
                label="ATTACK"
                value={state.synth_amp_attack}
                min={0}
                max={10}
                size="sm"
                onChange={(val) => updateState((prev) => ({ ...prev, synth_amp_attack: val }))}
              />
              <Knob
                id="synth-amp-decay"
                label="DECAY"
                value={state.synth_amp_decay}
                min={0}
                max={10}
                size="sm"
                onChange={(val) => updateState((prev) => ({ ...prev, synth_amp_decay: val }))}
              />
              <Knob
                id="synth-amp-release"
                label="REL"
                value={state.synth_amp_release}
                min={0}
                max={10}
                size="sm"
                onChange={(val) => updateState((prev) => ({ ...prev, synth_amp_release: val }))}
              />
            </div>
            <div className="envelope-flags">
              <Button
                id="synth-amp-vel-btn"
                label="VELOCITY"
                subLabel={state.synth_amp_velocity === 0 ? 'OFF' : `${state.synth_amp_velocity}`}
                active={state.synth_amp_velocity > 0}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_amp_velocity: (prev.synth_amp_velocity + 1) % 4,
                  }))
                }
              />
            </div>
          </div>

          <div className="envelope-column">
            <span className="block-title">MOD ENVELOPE</span>
            <div className="envelope-knobs">
              <Knob
                id="synth-mod-attack"
                label="ATTACK"
                value={state.synth_mod_attack}
                min={0}
                max={10}
                size="sm"
                onChange={(val) => updateState((prev) => ({ ...prev, synth_mod_attack: val }))}
              />
              <Knob
                id="synth-mod-decay"
                label="DEC/REL"
                value={state.synth_mod_decay}
                min={0}
                max={10}
                size="sm"
                onChange={(val) => updateState((prev) => ({ ...prev, synth_mod_decay: val }))}
              />
              <Knob
                id="synth-mod-env-amt"
                label="AMOUNT"
                value={state.synth_mod_env_amt}
                min={-10}
                max={10}
                size="sm"
                onChange={(val) => updateState((prev) => ({ ...prev, synth_mod_env_amt: val }))}
              />
            </div>
            <div className="envelope-flags">
              <Button
                id="synth-mod-to-pitch-btn"
                label="TO PITCH"
                active={state.synth_mod_to_pitch}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_mod_to_pitch: !prev.synth_mod_to_pitch,
                  }))
                }
              />
              <Button
                id="synth-mod-vel-btn"
                label="VELOCITY"
                active={state.synth_mod_velocity}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_mod_velocity: !prev.synth_mod_velocity,
                  }))
                }
              />
            </div>
          </div>
        </div>

        {/* LFO Block */}
        <div className="synth-lfo-block">
          <div className="lfo-header-row">
            <span className="block-title">LFO</span>
            <Button
              id="synth-lfo-wave-btn"
              label="SHAPE"
              subLabel={SYNTH_LFO_WAVEFORMS[state.synth_lfo_waveform]}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  synth_lfo_waveform: (prev.synth_lfo_waveform + 1) % SYNTH_LFO_WAVEFORMS.length,
                }))
              }
            />
            <Button
              id="synth-lfo-dest-btn"
              label="DEST"
              subLabel={SYNTH_LFO_DESTINATIONS[state.synth_lfo_destination]}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  synth_lfo_destination: (prev.synth_lfo_destination + 1) % SYNTH_LFO_DESTINATIONS.length,
                }))
              }
            />
            <Button
              id="synth-lfo-mstclk-btn"
              label="MST CLK"
              active={state.synth_lfo_clock_sync}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  synth_lfo_clock_sync: !prev.synth_lfo_clock_sync,
                }))
              }
            />
          </div>
          <div className="lfo-knobs-row">
            <Knob
              id="synth-lfo-rate"
              label="RATE"
              value={state.synth_lfo_rate}
              min={0}
              max={10}
              hasMorph={hasMorphAssignment('synth_lfo_rate', morphState)}
              onChange={(val) => updateState((prev) => ({ ...prev, synth_lfo_rate: val }))}
            />
            <Knob
              id="synth-lfo-amount"
              label="AMOUNT"
              value={state.synth_lfo_amount}
              min={0}
              max={10}
              hasMorph={hasMorphAssignment('synth_lfo_amount', morphState)}
              onChange={(val) => updateState((prev) => ({ ...prev, synth_lfo_amount: val }))}
            />
          </div>
        </div>

        {/* Voice & Arpeggiator Block */}
        <div className="synth-voice-arp-block">
          <div className="voice-mode-column">
            <span className="block-title">VOICE</span>
            <div className="voice-buttons">
              <Button
                id="synth-voice-mode-btn"
                label="MODE"
                subLabel={SYNTH_VOICE_MODES[state.synth_voice_mode]}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_voice_mode: (prev.synth_voice_mode + 1) % SYNTH_VOICE_MODES.length,
                  }))
                }
              />
              <Button
                id="synth-unison-btn"
                label="UNISON"
                subLabel={state.synth_unison_level === 0 ? 'OFF' : `${state.synth_unison_level}`}
                active={state.synth_unison_level > 0}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_unison_level: (prev.synth_unison_level + 1) % 4,
                  }))
                }
              />
              <Button
                id="synth-vibrato-btn"
                label="VIBRATO"
                subLabel={['OFF', 'ON', 'WHEEL'][state.synth_vibrato_mode]}
                active={state.synth_vibrato_mode > 0}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_vibrato_mode: (prev.synth_vibrato_mode + 1) % 3,
                  }))
                }
              />
            </div>
            <Knob
              id="synth-glide"
              label="GLIDE"
              value={state.synth_glide}
              min={0}
              max={10}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, synth_glide: val }))}
            />
          </div>

          <div className="arp-column">
            <span className="block-title">ARPEGGIATOR</span>
            <div className="arp-buttons">
              <Button
                id="synth-arp-run-btn"
                label="ARP RUN"
                active={state.synth_arp_run}
                ledColor="green"
                onClick={() =>
                  updateState((prev) => ({ ...prev, synth_arp_run: !prev.synth_arp_run }))
                }
              />
              <Button
                id="synth-arp-mode-btn"
                label="TYPE"
                subLabel={SYNTH_ARP_MODES[state.synth_arp_mode]}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_arp_mode: (prev.synth_arp_mode + 1) % SYNTH_ARP_MODES.length,
                  }))
                }
              />
              <Button
                id="synth-arp-dir-btn"
                label="DIR"
                subLabel={SYNTH_ARP_DIRECTIONS[state.synth_arp_direction]}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_arp_direction: (prev.synth_arp_direction + 1) % SYNTH_ARP_DIRECTIONS.length,
                  }))
                }
              />
              <Button
                id="synth-arp-range-btn"
                label="OCT"
                subLabel={`${state.synth_arp_range}`}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_arp_range: (prev.synth_arp_range % 4) + 1,
                  }))
                }
              />
              <Button
                id="synth-arp-kbhold-btn"
                label="KB HOLD"
                active={state.synth_arp_kb_hold}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_arp_kb_hold: !prev.synth_arp_kb_hold,
                  }))
                }
              />
              <Button
                id="synth-arp-mstclk-btn"
                label="MST CLK"
                active={state.synth_arp_clock_sync}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    synth_arp_clock_sync: !prev.synth_arp_clock_sync,
                  }))
                }
              />
            </div>
            <Knob
              id="synth-arp-rate"
              label="RATE"
              value={state.synth_arp_rate}
              min={0}
              max={10}
              size="sm"
              hasMorph={hasMorphAssignment('synth_arp_rate', morphState)}
              onChange={(val) => updateState((prev) => ({ ...prev, synth_arp_rate: val }))}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
