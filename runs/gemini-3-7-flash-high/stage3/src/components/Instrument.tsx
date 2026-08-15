import React from 'react';
import { HardwareState } from '../model/hardware';
import { ProgramData } from '../model/programs';
import { NoteLifecycle } from '../input/NoteLifecycle';
import { ControlDeck } from './ControlDeck';
import { Keybed } from './Keybed';

interface InstrumentProps {
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
  lifecycle: NoteLifecycle;
  activeKeys: Set<number>;
}

export const Instrument: React.FC<InstrumentProps> = ({
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
  lifecycle,
  activeKeys,
}) => {
  return (
    <div
      id="nord-stage-4-instrument"
      className="nord-stage-4-chassis"
      role="application"
      aria-label="Nord Stage 4 73 Instrument"
    >
      {/* Left End Cheek */}
      <div className="chassis-side-cheek left-cheek" aria-hidden="true">
        <div className="cheek-wood-grain" />
      </div>

      {/* Main Continuous Metal Chassis Body */}
      <div className="chassis-main-body">
        {/* Top Rail */}
        <div className="chassis-top-rail" aria-hidden="true">
          <div className="screw screw-1" />
          <div className="screw screw-2" />
          <div className="screw screw-3" />
          <div className="screw screw-4" />
        </div>

        {/* 54% Control Deck */}
        <div className="chassis-deck-zone">
          <ControlDeck
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

        {/* Separator / Keybed Rail */}
        <div className="chassis-deck-keybed-separator" aria-hidden="true" />

        {/* 46% Keybed Zone */}
        <div className="chassis-keybed-zone">
          <Keybed lifecycle={lifecycle} activeKeys={activeKeys} />
        </div>

        {/* Bottom Rail / Lip */}
        <div className="chassis-bottom-rail" aria-hidden="true" />
      </div>

      {/* Right End Cheek */}
      <div className="chassis-side-cheek right-cheek" aria-hidden="true">
        <div className="cheek-wood-grain" />
      </div>
    </div>
  );
};
