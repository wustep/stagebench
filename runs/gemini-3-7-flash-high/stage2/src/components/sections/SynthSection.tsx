import React from 'react';
import { OledDisplay } from '../controls/OledDisplay';
import { Fader } from '../controls/Fader';
import { Knob } from '../controls/Knob';
import { Button } from '../controls/Button';
import { HardwareState, SYNTH_OSC_TYPES, SYNTH_FILTER_TYPES } from '../../model/hardware';

interface SynthSectionProps {
  state: HardwareState;
  updateState: (updater: (prev: HardwareState) => HardwareState) => void;
}

export const SynthSection: React.FC<SynthSectionProps> = ({ state, updateState }) => {
  return (
    <section
      id="section-synth"
      aria-label="Synth Section"
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
            id="synth-unison-btn"
            label="UNISON"
            active={state.synth_unison}
            onClick={() => updateState((prev) => ({ ...prev, synth_unison: !prev.synth_unison }))}
          />
          <Button
            id="synth-vibrato-btn"
            label="VIBRATO"
            active={state.synth_vibrato}
            onClick={() => updateState((prev) => ({ ...prev, synth_vibrato: !prev.synth_vibrato }))}
          />
        </div>
      </div>

      <div className="synth-main-grid">
        {/* Layer A / B / C Level Faders */}
        <div className="synth-layers-col">
          <span className="group-label">LAYERS</span>
          <div className="synth-faders-row">
            <div className="synth-layer-strip">
              <Button
                id="synth-layer-a-on"
                label="A"
                active={state.synth_layer_a_on}
                onClick={() =>
                  updateState((prev) => ({ ...prev, synth_layer_a_on: !prev.synth_layer_a_on }))
                }
              />
              <Fader
                id="synth-layer-a-level"
                label="A"
                value={state.synth_layer_a_level}
                hasLedLadder={true}
                ledCount={6}
                onChange={(val) =>
                  updateState((prev) => ({ ...prev, synth_layer_a_level: val }))
                }
              />
            </div>
            <div className="synth-layer-strip">
              <Button
                id="synth-layer-b-on"
                label="B"
                active={state.synth_layer_b_on}
                onClick={() =>
                  updateState((prev) => ({ ...prev, synth_layer_b_on: !prev.synth_layer_b_on }))
                }
              />
              <Fader
                id="synth-layer-b-level"
                label="B"
                value={state.synth_layer_b_level}
                hasLedLadder={true}
                ledCount={6}
                onChange={(val) =>
                  updateState((prev) => ({ ...prev, synth_layer_b_level: val }))
                }
              />
            </div>
            <div className="synth-layer-strip">
              <Button
                id="synth-layer-c-on"
                label="C"
                active={state.synth_layer_c_on}
                onClick={() =>
                  updateState((prev) => ({ ...prev, synth_layer_c_on: !prev.synth_layer_c_on }))
                }
              />
              <Fader
                id="synth-layer-c-level"
                label="C"
                value={state.synth_layer_c_level}
                hasLedLadder={true}
                ledCount={6}
                onChange={(val) =>
                  updateState((prev) => ({ ...prev, synth_layer_c_level: val }))
                }
              />
            </div>
          </div>
        </div>

        {/* OLED and Oscillator Group */}
        <div className="synth-osc-display-col">
          <OledDisplay
            id="synth-oled"
            title="SYNTH ENGINE"
            badge={SYNTH_OSC_TYPES[state.synth_osc_type]}
            lines={[
              `Osc: ${SYNTH_OSC_TYPES[state.synth_osc_type]} 2-Saw`,
              `Filter: ${SYNTH_FILTER_TYPES[state.synth_filter_type]} LP`,
              `LFO: 4.0 Hz | Arp: Off`,
            ]}
          />
          <div className="osc-controls-row">
            <Button
              id="synth-osc-type-btn"
              label="OSC"
              subLabel={SYNTH_OSC_TYPES[state.synth_osc_type]}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  synth_osc_type: (prev.synth_osc_type + 1) % SYNTH_OSC_TYPES.length,
                }))
              }
            />
            <Knob
              id="synth-osc-mod"
              label="OSC MOD"
              value={state.synth_osc_mod}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, synth_osc_mod: val }))}
            />
          </div>
        </div>

        {/* Filter Section */}
        <div className="synth-filter-col">
          <span className="group-label">FILTER</span>
          <div className="filter-controls-matrix">
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
            <Knob
              id="synth-filter-cutoff"
              label="FREQ"
              value={state.synth_filter_cutoff}
              onChange={(val) => updateState((prev) => ({ ...prev, synth_filter_cutoff: val }))}
            />
            <Knob
              id="synth-filter-resonance"
              label="RES"
              value={state.synth_filter_resonance}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, synth_filter_resonance: val }))}
            />
            <Knob
              id="synth-filter-drive"
              label="DRIVE"
              value={state.synth_filter_drive}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, synth_filter_drive: val }))}
            />
            <Knob
              id="synth-filter-env-amt"
              label="KB/ENV"
              value={state.synth_filter_env_amt}
              min={-10}
              max={10}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, synth_filter_env_amt: val }))}
            />
          </div>
        </div>

        {/* Envelopes (Amp & Mod) & LFO/Arp */}
        <div className="synth-envelopes-col">
          <div className="amp-env-group">
            <span className="group-label">AMP ENVELOPE</span>
            <div className="knob-line">
              <Knob
                id="synth-amp-attack"
                label="ATT"
                value={state.synth_amp_attack}
                size="sm"
                onChange={(val) => updateState((prev) => ({ ...prev, synth_amp_attack: val }))}
              />
              <Knob
                id="synth-amp-decay"
                label="DEC"
                value={state.synth_amp_decay}
                size="sm"
                onChange={(val) => updateState((prev) => ({ ...prev, synth_amp_decay: val }))}
              />
              <Knob
                id="synth-amp-sustain"
                label="SUS"
                value={state.synth_amp_sustain}
                size="sm"
                onChange={(val) => updateState((prev) => ({ ...prev, synth_amp_sustain: val }))}
              />
              <Knob
                id="synth-amp-release"
                label="REL"
                value={state.synth_amp_release}
                size="sm"
                onChange={(val) => updateState((prev) => ({ ...prev, synth_amp_release: val }))}
              />
            </div>
          </div>

          <div className="mod-env-lfo-group">
            <div className="mod-env-subgroup">
              <span className="group-label">MOD ENV</span>
              <div className="knob-line">
                <Knob
                  id="synth-mod-attack"
                  label="ATT"
                  value={state.synth_mod_attack}
                  size="sm"
                  onChange={(val) => updateState((prev) => ({ ...prev, synth_mod_attack: val }))}
                />
                <Knob
                  id="synth-mod-decay"
                  label="DEC"
                  value={state.synth_mod_decay}
                  size="sm"
                  onChange={(val) => updateState((prev) => ({ ...prev, synth_mod_decay: val }))}
                />
                <Knob
                  id="synth-mod-release"
                  label="REL"
                  value={state.synth_mod_release}
                  size="sm"
                  onChange={(val) => updateState((prev) => ({ ...prev, synth_mod_release: val }))}
                />
              </div>
            </div>

            <div className="lfo-arp-subgroup">
              <span className="group-label">LFO & ARP</span>
              <div className="knob-line">
                <Knob
                  id="synth-lfo-rate"
                  label="RATE"
                  value={state.synth_lfo_rate}
                  size="sm"
                  onChange={(val) => updateState((prev) => ({ ...prev, synth_lfo_rate: val }))}
                />
                <Knob
                  id="synth-lfo-amount"
                  label="LFO AMT"
                  value={state.synth_lfo_amount}
                  size="sm"
                  onChange={(val) => updateState((prev) => ({ ...prev, synth_lfo_amount: val }))}
                />
                <Button
                  id="synth-arp-run"
                  label="ARP RUN"
                  active={state.synth_arp_run}
                  onClick={() => updateState((prev) => ({ ...prev, synth_arp_run: !prev.synth_arp_run }))}
                />
                <Knob
                  id="synth-arp-rate"
                  label="ARP RATE"
                  value={state.synth_arp_rate}
                  size="sm"
                  onChange={(val) => updateState((prev) => ({ ...prev, synth_arp_rate: val }))}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
