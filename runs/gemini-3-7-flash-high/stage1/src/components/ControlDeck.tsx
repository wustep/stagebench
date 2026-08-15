import React from 'react';
import { HardwareState } from '../model/hardware';
import { PerformanceSection } from './sections/PerformanceSection';
import { OrganSection } from './sections/OrganSection';
import { PianoSection } from './sections/PianoSection';
import { ProgramSection } from './sections/ProgramSection';
import { SynthSection } from './sections/SynthSection';
import { EffectsSection } from './sections/EffectsSection';

interface ControlDeckProps {
  state: HardwareState;
  updateState: (updater: (prev: HardwareState) => HardwareState) => void;
}

export const ControlDeck: React.FC<ControlDeckProps> = ({ state, updateState }) => {
  return (
    <div
      className="control-deck-surface"
      role="region"
      aria-label="Nord Stage 4 Control Deck (Six Ordered Sections)"
    >
      <div className="deck-section-wrapper deck-section-performance" style={{ flex: '0 0 14%' }}>
        <PerformanceSection state={state} updateState={updateState} />
      </div>

      <div className="deck-section-wrapper deck-section-organ" style={{ flex: '0 0 20%' }}>
        <OrganSection state={state} updateState={updateState} />
      </div>

      <div className="deck-section-wrapper deck-section-piano" style={{ flex: '0 0 8.5%' }}>
        <PianoSection state={state} updateState={updateState} />
      </div>

      <div className="deck-section-wrapper deck-section-program" style={{ flex: '0 0 12.5%' }}>
        <ProgramSection state={state} updateState={updateState} />
      </div>

      <div className="deck-section-wrapper deck-section-synth" style={{ flex: '0 0 25%' }}>
        <SynthSection state={state} updateState={updateState} />
      </div>

      <div className="deck-section-wrapper deck-section-effects" style={{ flex: '0 0 20%' }}>
        <EffectsSection state={state} updateState={updateState} />
      </div>
    </div>
  );
};
