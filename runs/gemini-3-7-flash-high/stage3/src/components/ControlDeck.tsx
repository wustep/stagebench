import React from 'react';
import { HardwareState } from '../model/hardware';
import { ProgramData } from '../model/programs';
import { PerformanceSection } from './sections/PerformanceSection';
import { OrganSection } from './sections/OrganSection';
import { PianoSection } from './sections/PianoSection';
import { ProgramSection } from './sections/ProgramSection';
import { SynthSection } from './sections/SynthSection';
import { EffectsSection } from './sections/EffectsSection';

interface ControlDeckProps {
  state: HardwareState;
  programsList: ProgramData[];
  currentProgram: ProgramData | null;
  updateState: (updater: (prev: HardwareState) => HardwareState) => void;
  onSelectProgram: (slot: number) => void;
  onSelectLiveSlot: (slot: number) => void;
  onStoreConfirm: () => void;
  onStoreAsConfirm: (name: string) => void;
  onStoreCancel: () => void;
  onTapMasterClock: () => void;
  onPanic: () => void;
}

export const ControlDeck: React.FC<ControlDeckProps> = ({
  state,
  programsList,
  currentProgram,
  updateState,
  onSelectProgram,
  onSelectLiveSlot,
  onStoreConfirm,
  onStoreAsConfirm,
  onStoreCancel,
  onTapMasterClock,
  onPanic,
}) => {
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
        <ProgramSection
          state={state}
          programsList={programsList}
          currentProgram={currentProgram}
          updateState={updateState}
          onSelectProgram={onSelectProgram}
          onSelectLiveSlot={onSelectLiveSlot}
          onStoreConfirm={onStoreConfirm}
          onStoreAsConfirm={onStoreAsConfirm}
          onStoreCancel={onStoreCancel}
          onTapMasterClock={onTapMasterClock}
          onPanic={onPanic}
        />
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
