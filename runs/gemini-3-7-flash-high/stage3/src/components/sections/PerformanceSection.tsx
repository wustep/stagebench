import React from 'react';
import { Knob } from '../controls/Knob';
import { PitchStick, ModWheel } from '../controls/PerformanceWheel';
import { HardwareState } from '../../model/hardware';

interface PerformanceSectionProps {
  state: HardwareState;
  updateState: (updater: (prev: HardwareState) => HardwareState) => void;
}

export const PerformanceSection: React.FC<PerformanceSectionProps> = ({ state, updateState }) => {
  return (
    <section
      id="section-performance"
      aria-label="Performance Controls"
      className="panel-section section-performance"
    >
      <div className="section-header">
        <div className="nord-branding">
          <span className="nord-logo-main">nord stage 4</span>
          <span className="nord-logo-sub">HA73 • STAGEBENCH</span>
        </div>
      </div>

      <div className="performance-controls-layout">
        <div className="master-level-container">
          <Knob
            id="master-level"
            label="MASTER LEVEL"
            value={state.master_level}
            size="lg"
            min={0}
            max={10}
            step={0.1}
            onChange={(val) => updateState((prev) => ({ ...prev, master_level: val }))}
          />
        </div>

        <div className="wheels-container">
          <PitchStick
            id="pitch-stick"
            value={state.pitch_stick}
            onChange={(val) => updateState((prev) => ({ ...prev, pitch_stick: val }))}
          />
          <ModWheel
            id="mod-wheel"
            value={state.mod_wheel}
            onChange={(val) => updateState((prev) => ({ ...prev, mod_wheel: val }))}
          />
        </div>
      </div>
    </section>
  );
};
