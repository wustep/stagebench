import React from 'react';
import { OledDisplay } from '../controls/OledDisplay';
import { Button } from '../controls/Button';
import { Knob } from '../controls/Knob';
import { HardwareState } from '../../model/hardware';

interface ProgramSectionProps {
  state: HardwareState;
  updateState: (updater: (prev: HardwareState) => HardwareState) => void;
}

export const ProgramSection: React.FC<ProgramSectionProps> = ({ state, updateState }) => {
  const programButtons = [1, 2, 3, 4, 5, 6, 7, 8];

  return (
    <section
      id="section-program"
      aria-label="Program and Morph Section"
      className="panel-section section-program"
    >
      <div className="section-title-bar">
        <div className="section-title-text">PROGRAM</div>
      </div>

      <div className="program-main-layout">
        {/* Primary Program OLED */}
        <div className="program-display-container">
          <OledDisplay
            id="program-oled"
            title="PROGRAM"
            badge={`P${state.program_number.toString().padStart(2, '0')}`}
            lines={[
              `A:${state.program_number.toString().padStart(2, '0')} Stage Grand 4`,
              'Piano: Concert 3D Lyr',
              'Synth: --  Org: --',
            ]}
            subInfo={`Tempo: 120 BPM | Page ${state.program_page}/8`}
          />
        </div>

        {/* Dial & Navigation */}
        <div className="program-dial-navigation-row">
          <div className="program-dial-container">
            <Knob
              id="program-dial"
              label="PROGRAM DIAL"
              value={state.program_number}
              min={1}
              max={32}
              step={1}
              size="lg"
              onChange={(val) => updateState((prev) => ({ ...prev, program_number: val }))}
            />
          </div>

          <div className="program-nav-buttons">
            <Button
              id="program-page-left"
              label="PAGE <"
              hasLed={false}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  program_page: Math.max(1, prev.program_page - 1),
                }))
              }
            />
            <Button
              id="program-page-right"
              label="PAGE >"
              hasLed={false}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  program_page: Math.min(8, prev.program_page + 1),
                }))
              }
            />
          </div>
        </div>

        {/* 1..8 Program Selection Buttons */}
        <div className="program-buttons-bank" role="group" aria-label="Program 1-8 Selection Buttons">
          {programButtons.map((btnNum) => (
            <Button
              key={btnNum}
              id={`program-btn-${btnNum}`}
              label={`${btnNum}`}
              active={state.program_button === btnNum}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  program_button: btnNum,
                  program_number: (prev.program_page - 1) * 8 + btnNum,
                }))
              }
            />
          ))}
        </div>

        {/* System & Scene & Morph Controls */}
        <div className="program-utility-row">
          <div className="scene-live-group">
            <Button
              id="btn-live-mode"
              label="LIVE"
              active={state.live_mode}
              ledColor="amber"
              onClick={() => updateState((prev) => ({ ...prev, live_mode: !prev.live_mode }))}
            />
            <Button
              id="btn-layer-scene"
              label="SCENE"
              subLabel={`S${state.layer_scene}`}
              active={state.layer_scene === 2}
              onClick={() =>
                updateState((prev) => ({
                  ...prev,
                  layer_scene: prev.layer_scene === 1 ? 2 : 1,
                }))
              }
            />
            <Button
              id="btn-store"
              label="STORE"
              active={state.store}
              ledColor="red"
              onClick={() => updateState((prev) => ({ ...prev, store: !prev.store }))}
            />
            <Button
              id="btn-split"
              label="SPLIT"
              active={state.split}
              ledColor="green"
              onClick={() => updateState((prev) => ({ ...prev, split: !prev.split }))}
            />
          </div>

          <div className="morph-assign-group" role="group" aria-label="Morph Assign">
            <span className="group-label">MORPH</span>
            <div className="morph-buttons">
              <Button
                id="morph-wheel"
                label="WHEEL"
                active={state.morph_wheel}
                ledColor="amber"
                onClick={() => updateState((prev) => ({ ...prev, morph_wheel: !prev.morph_wheel }))}
              />
              <Button
                id="morph-aftertouch"
                label="A-TOUCH"
                active={state.morph_aftertouch}
                ledColor="amber"
                onClick={() =>
                  updateState((prev) => ({
                    ...prev,
                    morph_aftertouch: !prev.morph_aftertouch,
                  }))
                }
              />
              <Button
                id="morph-ctrlped"
                label="CTRLPED"
                active={state.morph_ctrlped}
                ledColor="amber"
                onClick={() =>
                  updateState((prev) => ({ ...prev, morph_ctrlped: !prev.morph_ctrlped }))
                }
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
