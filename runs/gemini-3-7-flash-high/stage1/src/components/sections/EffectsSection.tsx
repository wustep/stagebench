import React from 'react';
import { Knob } from '../controls/Knob';
import { Button } from '../controls/Button';
import {
  HardwareState,
  EFFECT_1_TYPES,
  EFFECT_2_TYPES,
  AMP_TYPES,
  REVERB_TYPES,
} from '../../model/hardware';

interface EffectsSectionProps {
  state: HardwareState;
  updateState: (updater: (prev: HardwareState) => HardwareState) => void;
}

export const EffectsSection: React.FC<EffectsSectionProps> = ({ state, updateState }) => {
  return (
    <section
      id="section-effects"
      aria-label="Layer Effects Section"
      className="panel-section dark-inset-section section-effects"
    >
      <div className="section-title-bar">
        <div className="section-title-text">LAYER EFFECTS</div>
        <div className="layer-focus-group" role="group" aria-label="Effect Layer Focus">
          <Button
            id="focus-piano"
            label="PIANO"
            subLabel="FOCUS"
            active={state.layer_focus_piano}
            onClick={() =>
              updateState((prev) => ({
                ...prev,
                layer_focus_piano: true,
                layer_focus_organ: false,
                layer_focus_synth: false,
              }))
            }
          />
          <Button
            id="focus-organ"
            label="ORGAN"
            subLabel="FOCUS"
            active={state.layer_focus_organ}
            onClick={() =>
              updateState((prev) => ({
                ...prev,
                layer_focus_piano: false,
                layer_focus_organ: true,
                layer_focus_synth: false,
              }))
            }
          />
          <Button
            id="focus-synth"
            label="SYNTH"
            subLabel="FOCUS"
            active={state.layer_focus_synth}
            onClick={() =>
              updateState((prev) => ({
                ...prev,
                layer_focus_piano: false,
                layer_focus_organ: false,
                layer_focus_synth: true,
              }))
            }
          />
        </div>
      </div>

      <div className="effects-grid-layout">
        {/* Effect 1: Mod / Trem / Wah */}
        <div className="effect-unit-block">
          <div className="unit-header">
            <Button
              id="effect-1-on"
              label="EFFECT 1"
              active={state.effect_1_on}
              onClick={() => updateState((prev) => ({ ...prev, effect_1_on: !prev.effect_1_on }))}
            />
            <Button
              id="effect-1-type-btn"
              label="TYPE"
              subLabel={EFFECT_1_TYPES[state.effect_1_type]}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  effect_1_type: (prev.effect_1_type + 1) % EFFECT_1_TYPES.length,
                }))
              }
            />
          </div>
          <div className="unit-knobs">
            <Knob
              id="effect-1-rate"
              label="RATE"
              value={state.effect_1_rate}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, effect_1_rate: val }))}
            />
            <Knob
              id="effect-1-amount"
              label="AMT"
              value={state.effect_1_amount}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, effect_1_amount: val }))}
            />
          </div>
        </div>

        {/* Effect 2: Phaser / Chorus / Flanger */}
        <div className="effect-unit-block">
          <div className="unit-header">
            <Button
              id="effect-2-on"
              label="EFFECT 2"
              active={state.effect_2_on}
              onClick={() => updateState((prev) => ({ ...prev, effect_2_on: !prev.effect_2_on }))}
            />
            <Button
              id="effect-2-type-btn"
              label="TYPE"
              subLabel={EFFECT_2_TYPES[state.effect_2_type]}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  effect_2_type: (prev.effect_2_type + 1) % EFFECT_2_TYPES.length,
                }))
              }
            />
          </div>
          <div className="unit-knobs">
            <Knob
              id="effect-2-rate"
              label="RATE"
              value={state.effect_2_rate}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, effect_2_rate: val }))}
            />
            <Knob
              id="effect-2-amount"
              label="AMT"
              value={state.effect_2_amount}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, effect_2_amount: val }))}
            />
          </div>
        </div>

        {/* Delay */}
        <div className="effect-unit-block">
          <div className="unit-header">
            <Button
              id="delay-on"
              label="DELAY"
              active={state.delay_on}
              onClick={() => updateState((prev) => ({ ...prev, delay_on: !prev.delay_on }))}
            />
            <Button
              id="delay-pingpong"
              label="P-PONG"
              active={state.delay_pingpong}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  delay_pingpong: !prev.delay_pingpong }))
              }
            />
          </div>
          <div className="unit-knobs">
            <Knob
              id="delay-tempo"
              label="TEMPO"
              value={state.delay_tempo}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, delay_tempo: val }))}
            />
            <Knob
              id="delay-feedback"
              label="FB"
              value={state.delay_feedback}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, delay_feedback: val }))}
            />
            <Knob
              id="delay-amount"
              label="MIX"
              value={state.delay_amount}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, delay_amount: val }))}
            />
          </div>
        </div>

        {/* Amp Simulator / EQ */}
        <div className="effect-unit-block">
          <div className="unit-header">
            <Button
              id="amp-eq-on"
              label="AMP/EQ"
              active={state.amp_eq_on}
              onClick={() => updateState((prev) => ({ ...prev, amp_eq_on: !prev.amp_eq_on }))}
            />
            <Button
              id="amp-type-btn"
              label="MODEL"
              subLabel={AMP_TYPES[state.amp_type]}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  amp_type: (prev.amp_type + 1) % AMP_TYPES.length,
                }))
              }
            />
          </div>
          <div className="unit-knobs">
            <Knob
              id="amp-drive"
              label="DRIVE"
              value={state.amp_drive}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, amp_drive: val }))}
            />
            <Knob
              id="eq-bass"
              label="BASS"
              value={state.eq_bass}
              min={-10}
              max={10}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, eq_bass: val }))}
            />
            <Knob
              id="eq-mid"
              label="MID"
              value={state.eq_mid}
              min={-10}
              max={10}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, eq_mid: val }))}
            />
            <Knob
              id="eq-treble"
              label="TREB"
              value={state.eq_treble}
              min={-10}
              max={10}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, eq_treble: val }))}
            />
          </div>
        </div>

        {/* Compressor */}
        <div className="effect-unit-block">
          <div className="unit-header">
            <Button
              id="compressor-on"
              label="COMP"
              active={state.compressor_on}
              onClick={() =>
                updateState((prev) => ({ ...prev, compressor_on: !prev.compressor_on }))
              }
            />
            <Button
              id="compressor-fast"
              label="FAST"
              active={state.compressor_fast}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  compressor_fast: !prev.compressor_fast,
                }))
              }
            />
          </div>
          <div className="unit-knobs">
            <Knob
              id="compressor-amount"
              label="AMOUNT"
              value={state.compressor_amount}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, compressor_amount: val }))}
            />
          </div>
        </div>

        {/* Reverb */}
        <div className="effect-unit-block">
          <div className="unit-header">
            <Button
              id="reverb-on"
              label="REVERB"
              active={state.reverb_on}
              onClick={() => updateState((prev) => ({ ...prev, reverb_on: !prev.reverb_on }))}
            />
            <Button
              id="reverb-type-btn"
              label="TYPE"
              subLabel={REVERB_TYPES[state.reverb_type]}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  reverb_type: (prev.reverb_type + 1) % REVERB_TYPES.length,
                }))
              }
            />
          </div>
          <div className="unit-knobs">
            <Knob
              id="reverb-decay"
              label="DECAY"
              value={state.reverb_decay}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, reverb_decay: val }))}
            />
            <Knob
              id="reverb-amount"
              label="MIX"
              value={state.reverb_amount}
              size="sm"
              onChange={(val) => updateState((prev) => ({ ...prev, reverb_amount: val }))}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
