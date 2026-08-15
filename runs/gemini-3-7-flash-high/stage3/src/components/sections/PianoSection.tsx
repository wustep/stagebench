import React from 'react';
import { Fader } from '../controls/Fader';
import { Button } from '../controls/Button';
import { Knob } from '../controls/Knob';
import { HardwareState, PIANO_TYPES } from '../../model/hardware';

interface PianoSectionProps {
  state: HardwareState;
  updateState: (updater: (prev: HardwareState) => HardwareState) => void;
}

export const PianoSection: React.FC<PianoSectionProps> = ({ state, updateState }) => {
  return (
    <section
      id="section-piano"
      aria-label="Piano Section"
      className="panel-section dark-inset-section section-piano"
    >
      <div className="section-title-bar">
        <Button
          id="piano-on"
          label="PIANO"
          active={state.piano_on}
          ledColor="red"
          onClick={() => updateState((prev) => ({ ...prev, piano_on: !prev.piano_on }))}
        />
        <div className="section-title-text">PIANO</div>
        <div className="section-flags">
          <Button
            id="piano-sustain-btn"
            label="SUSTPED"
            active={state.piano_sustain}
            onClick={() => updateState((prev) => ({ ...prev, piano_sustain: !prev.piano_sustain }))}
          />
          <Button
            id="piano-pstick-btn"
            label="PSTICK"
            active={state.piano_pstick}
            onClick={() => updateState((prev) => ({ ...prev, piano_pstick: !prev.piano_pstick }))}
          />
        </div>
      </div>

      <div className="piano-content-layout">
        {/* Layer A & B Faders */}
        <div className="piano-layers-group">
          <div className={`piano-layer-channel ${state.piano_layer_a_focus ? 'focused' : ''}`}>
            <div className="layer-header">
              <Button
                id="piano-layer-a-on"
                label="A"
                active={state.piano_layer_a_on}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    piano_layer_a_on: !prev.piano_layer_a_on,
                    piano_layer_a_focus: true,
                    piano_layer_b_focus: false,
                  }))
                }
              />
              <span
                className="layer-tag"
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    piano_layer_a_focus: true,
                    piano_layer_b_focus: false,
                  }))
                }
                style={{ cursor: 'pointer' }}
              >
                LAYER A {state.piano_layer_a_focus ? '★' : ''}
              </span>
              <div className="octave-controls" style={{ display: 'flex', gap: '2px', marginLeft: 'auto' }}>
                <Button
                  id="piano-layer-a-oct-down"
                  label="-"
                  subLabel={`${state.piano_layer_a_octave}`}
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      piano_layer_a_octave: Math.max(-2, prev.piano_layer_a_octave - 1),
                    }))
                  }
                />
                <Button
                  id="piano-layer-a-oct-up"
                  label="+"
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      piano_layer_a_octave: Math.min(2, prev.piano_layer_a_octave + 1),
                    }))
                  }
                />
              </div>
            </div>
            <Fader
              id="piano-layer-a-level"
              label="LEVEL"
              value={state.piano_layer_a_level}
              onChange={(val) =>
                updateState((prev) => ({ ...prev, piano_layer_a_level: val }))
              }
            />
          </div>

          <div className={`piano-layer-channel ${state.piano_layer_b_focus ? 'focused' : ''}`}>
            <div className="layer-header">
              <Button
                id="piano-layer-b-on"
                label="B"
                active={state.piano_layer_b_on}
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    piano_layer_b_on: !prev.piano_layer_b_on,
                    piano_layer_a_focus: false,
                    piano_layer_b_focus: true,
                  }))
                }
              />
              <span
                className="layer-tag"
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    piano_layer_a_focus: false,
                    piano_layer_b_focus: true,
                  }))
                }
                style={{ cursor: 'pointer' }}
              >
                LAYER B {state.piano_layer_b_focus ? '★' : ''}
              </span>
              <div className="octave-controls" style={{ display: 'flex', gap: '2px', marginLeft: 'auto' }}>
                <Button
                  id="piano-layer-b-oct-down"
                  label="-"
                  subLabel={`${state.piano_layer_b_octave}`}
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      piano_layer_b_octave: Math.max(-2, prev.piano_layer_b_octave - 1),
                    }))
                  }
                />
                <Button
                  id="piano-layer-b-oct-up"
                  label="+"
                  hasLed={false}
                  onClick={() =>
                    updateState((prev) => ({
                      ...prev,
                      piano_layer_b_octave: Math.min(2, prev.piano_layer_b_octave + 1),
                    }))
                  }
                />
              </div>
            </div>
            <Fader
              id="piano-layer-b-level"
              label="LEVEL"
              value={state.piano_layer_b_level}
              onChange={(val) =>
                updateState((prev) => ({ ...prev, piano_layer_b_level: val }))
              }
            />
          </div>
        </div>

        {/* Type selector & Model dial */}
        <div className="piano-type-model-col">
          <div className="piano-types-matrix">
            <span className="group-label">TYPE</span>
            <div className="type-leds">
              {PIANO_TYPES.map((t, idx) => (
                <div
                  key={t}
                  className={`type-indicator ${state.piano_type === idx ? 'active' : ''}`}
                >
                  <span className="type-led" />
                  <span className="type-name">{t}</span>
                </div>
              ))}
            </div>
            <Button
              id="piano-type-btn"
              label="TYPE"
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  piano_type: (prev.piano_type + 1) % PIANO_TYPES.length,
                }))
              }
            />
          </div>

          <div className="piano-model-dial-container">
            <Knob
              id="piano-model-dial"
              label="MODEL"
              value={state.piano_model}
              min={1}
              max={9}
              step={1}
              size="sm"
              subLabel={`#${state.piano_model}`}
              onChange={(val) => updateState((prev) => ({ ...prev, piano_model: val }))}
            />
          </div>
        </div>

        {/* Details & Performance buttons */}
        <div className="piano-details-col">
          <div className="detail-buttons-grid">
            <Button
              id="piano-kb-touch"
              label="KB TOUCH"
              active={state.piano_kb_touch > 0}
              subLabel={state.piano_kb_touch === 0 ? 'OFF' : `T${state.piano_kb_touch}`}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  piano_kb_touch: (prev.piano_kb_touch + 1) % 4,
                }))
              }
            />
            <Button
              id="piano-timbre"
              label="TIMBRE"
              active={state.piano_timbre > 0}
              subLabel={['OFF', 'SOFT', 'MID', 'BRT', 'DY1', 'DY2'][state.piano_timbre]}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  piano_timbre: (prev.piano_timbre + 1) % 6,
                }))
              }
            />
            <Button
              id="piano-dyn-comp"
              label="DYN COMP"
              active={state.piano_dyn_comp > 0}
              subLabel={state.piano_dyn_comp === 0 ? 'OFF' : `C${state.piano_dyn_comp}`}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  piano_dyn_comp: (prev.piano_dyn_comp + 1) % 4,
                }))
              }
            />
            <Button
              id="piano-unison"
              label="UNISON"
              active={state.piano_unison > 0}
              subLabel={state.piano_unison === 0 ? 'OFF' : `U${state.piano_unison}`}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  piano_unison: (prev.piano_unison + 1) % 4,
                }))
              }
            />
            <Button
              id="piano-soft-release"
              label="SOFT REL"
              active={state.piano_soft_release}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  piano_soft_release: !prev.piano_soft_release,
                }))
              }
            />
            <Button
              id="piano-string-res"
              label="STRING RES"
              active={state.piano_string_res}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  piano_string_res: !prev.piano_string_res,
                }))
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
};
