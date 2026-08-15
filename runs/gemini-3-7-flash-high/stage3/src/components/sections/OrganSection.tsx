import React from 'react';
import { Drawbar } from '../controls/Drawbar';
import { Button } from '../controls/Button';
import { Fader } from '../controls/Fader';
import { HardwareState, ORGAN_MODELS, ORGAN_VIBRATO_MODES } from '../../model/hardware';
import { hasMorphAssignment } from '../../model/morph';

interface OrganSectionProps {
  state: HardwareState;
  updateState: (updater: (prev: HardwareState) => HardwareState) => void;
}

export const OrganSection: React.FC<OrganSectionProps> = ({ state, updateState }) => {
  const drawbars = [
    { id: 'organ-db-16', label: "16'", key: 'organ_db_16' as const, morphKey: 'organ_db_16' as const, color: 'brown' as const },
    { id: 'organ-db-5-1-3', label: "5⅓'", key: 'organ_db_5_1_3' as const, morphKey: 'organ_db_5_1_3' as const, color: 'brown' as const },
    { id: 'organ-db-8', label: "8'", key: 'organ_db_8' as const, morphKey: 'organ_db_8' as const, color: 'white' as const },
    { id: 'organ-db-4', label: "4'", key: 'organ_db_4' as const, morphKey: 'organ_db_4' as const, color: 'white' as const },
    { id: 'organ-db-2-2-3', label: "2⅔'", key: 'organ_db_2_2_3' as const, morphKey: 'organ_db_2_2_3' as const, color: 'black' as const },
    { id: 'organ-db-2', label: "2'", key: 'organ_db_2' as const, morphKey: 'organ_db_2' as const, color: 'white' as const },
    { id: 'organ-db-1-3-5', label: "1⅗'", key: 'organ_db_1_3_5' as const, morphKey: 'organ_db_1_3_5' as const, color: 'black' as const },
    { id: 'organ-db-1-1-3', label: "1⅓'", key: 'organ_db_1_1_3' as const, morphKey: 'organ_db_1_1_3' as const, color: 'black' as const },
    { id: 'organ-db-1', label: "1'", key: 'organ_db_1' as const, morphKey: 'organ_db_1' as const, color: 'white' as const },
  ];

  const morphState = {
    wheelValue: state.mod_wheel,
    ctrlPedValue: state.ctrl_pedal,
    activeMorphEditSource: state.morph_edit_source,
    assignments: state.morph_assignments,
  };

  return (
    <section
      id="section-organ"
      aria-label="Organ Section"
      className="panel-section dark-inset-section section-organ"
    >
      <div className="section-title-bar">
        <Button
          id="organ-on"
          label="ORGAN"
          active={state.organ_on}
          ledColor="red"
          onClick={() => updateState((prev) => ({ ...prev, organ_on: !prev.organ_on }))}
        />
        <div className="section-title-text">ORGAN</div>
        <div className="section-flags">
          <Button
            id="organ-sustain-btn"
            label="SUSTPED"
            active={state.organ_sustain}
            onClick={() => updateState((prev) => ({ ...prev, organ_sustain: !prev.organ_sustain }))}
          />
          <Button
            id="organ-pstick-btn"
            label="PSTICK"
            active={state.organ_pstick}
            onClick={() => updateState((prev) => ({ ...prev, organ_pstick: !prev.organ_pstick }))}
          />
        </div>
      </div>

      <div className="organ-content-grid">
        {/* Layer A and Layer B Channels */}
        <div className="organ-layers-group">
          {/* Layer A Channel */}
          <div className={`organ-layer-channel ${state.organ_layer_a_focus ? 'focused' : ''}`}>
            <div className="layer-header">
              <Button
                id="organ-layer-a-on"
                label="A"
                active={state.organ_layer_a_on}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_layer_a_on: !prev.organ_layer_a_on,
                    organ_layer_a_focus: true,
                    organ_layer_b_focus: false,
                  }))
                }
              />
              <span
                className="layer-tag"
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_layer_a_focus: true,
                    organ_layer_b_focus: false,
                  }))
                }
                style={{ cursor: 'pointer' }}
              >
                LAYER A {state.organ_layer_a_focus ? '★' : ''}
              </span>
              <div className="layer-tools">
                <Button
                  id="organ-layer-a-oct-down"
                  label="-"
                  subLabel={`${state.organ_layer_a_octave}`}
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      organ_layer_a_octave: Math.max(-2, prev.organ_layer_a_octave - 1),
                    }))
                  }
                />
                <Button
                  id="organ-layer-a-oct-up"
                  label="+"
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      organ_layer_a_octave: Math.min(2, prev.organ_layer_a_octave + 1),
                    }))
                  }
                />
              </div>
            </div>
            <Fader
              id="organ-layer-a-level"
              label="LEVEL"
              value={state.organ_layer_a_level}
              hasMorph={hasMorphAssignment('organ_layer_a_level', morphState)}
              onChange={(val) =>
                updateState((prev) => ({ ...prev, organ_layer_a_level: val }))
              }
            />
          </div>

          {/* Layer B Channel */}
          <div className={`organ-layer-channel ${state.organ_layer_b_focus ? 'focused' : ''}`}>
            <div className="layer-header">
              <Button
                id="organ-layer-b-on"
                label="B"
                active={state.organ_layer_b_on}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_layer_b_on: !prev.organ_layer_b_on,
                    organ_layer_a_focus: false,
                    organ_layer_b_focus: true,
                  }))
                }
              />
              <span
                className="layer-tag"
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_layer_a_focus: false,
                    organ_layer_b_focus: true,
                  }))
                }
                style={{ cursor: 'pointer' }}
              >
                LAYER B {state.organ_layer_b_focus ? '★' : ''}
              </span>
              <div className="layer-tools">
                <Button
                  id="organ-layer-b-oct-down"
                  label="-"
                  subLabel={`${state.organ_layer_b_octave}`}
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      organ_layer_b_octave: Math.max(-2, prev.organ_layer_b_octave - 1),
                    }))
                  }
                />
                <Button
                  id="organ-layer-b-oct-up"
                  label="+"
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      organ_layer_b_octave: Math.min(2, prev.organ_layer_b_octave + 1),
                    }))
                  }
                />
              </div>
            </div>
            <Fader
              id="organ-layer-b-level"
              label="LEVEL"
              value={state.organ_layer_b_level}
              hasMorph={hasMorphAssignment('organ_layer_b_level', morphState)}
              onChange={(val) =>
                updateState((prev) => ({ ...prev, organ_layer_b_level: val }))
              }
            />
          </div>
        </div>

        {/* Drawbars bank */}
        <div className="drawbar-bank" role="group" aria-label="Nine Physical Drawbars">
          {drawbars.map((db) => (
            <Drawbar
              key={db.id}
              id={db.id}
              harmonic={db.label}
              value={state[db.key]}
              colorClass={db.color}
              hasMorph={hasMorphAssignment(db.morphKey, morphState)}
              onChange={(val) =>
                updateState((prev) => ({ ...prev, [db.key]: val }))
              }
            />
          ))}
        </div>

        {/* Model, Preset, Percussion and Rotary controls */}
        <div className="organ-subcontrols-col">
          <div className="model-select-group">
            <span className="group-label">MODEL</span>
            <div className="model-led-matrix">
              {ORGAN_MODELS.map((model, idx) => (
                <div
                  key={model}
                  className={`model-indicator ${state.organ_model === idx ? 'active' : ''}`}
                >
                  <span className="model-led" />
                  <span className="model-name">{model}</span>
                </div>
              ))}
            </div>
            <Button
              id="organ-model-btn"
              label="MODEL"
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  organ_model: (prev.organ_model + 1) % ORGAN_MODELS.length,
                }))
              }
            />
          </div>

          <div className="vibrato-chorus-group">
            <span className="group-label">VIBRATO/CHORUS</span>
            <div className="vibrato-buttons-row">
              <Button
                id="organ-vibrato-on-btn"
                label="V/C ON"
                active={state.organ_vibrato_on}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_vibrato_on: !prev.organ_vibrato_on,
                  }))
                }
              />
              <Button
                id="organ-vibrato-mode-btn"
                label="TYPE"
                subLabel={ORGAN_VIBRATO_MODES[state.organ_vibrato_mode]}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_vibrato_mode: (prev.organ_vibrato_mode + 1) % ORGAN_VIBRATO_MODES.length,
                  }))
                }
              />
            </div>
          </div>

          <div className="percussion-rotary-group">
            <span className="group-label">PERCUSSION & ROTARY</span>
            <div className="percussion-buttons">
              <Button
                id="organ-perc-on"
                label="PERC ON"
                active={state.organ_percussion_on}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_percussion_on: !prev.organ_percussion_on,
                  }))
                }
              />
              <Button
                id="organ-perc-soft"
                label="SOFT"
                active={state.organ_percussion_soft}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_percussion_soft: !prev.organ_percussion_soft,
                  }))
                }
              />
              <Button
                id="organ-perc-fast"
                label="FAST"
                active={state.organ_percussion_fast}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_percussion_fast: !prev.organ_percussion_fast,
                  }))
                }
              />
              <Button
                id="organ-perc-third"
                label="3RD"
                active={state.organ_percussion_third}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_percussion_third: !prev.organ_percussion_third,
                  }))
                }
              />
            </div>
            <div className="rotary-buttons">
              <Button
                id="organ-rotary-stop"
                label="STOP"
                active={state.organ_rotary_stop}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_rotary_stop: !prev.organ_rotary_stop,
                  }))
                }
              />
              <Button
                id="organ-rotary-speed"
                label="SLOW/FAST"
                active={state.organ_rotary_speed}
                ledColor="green"
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    organ_rotary_speed: !prev.organ_rotary_speed,
                  }))
                }
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
