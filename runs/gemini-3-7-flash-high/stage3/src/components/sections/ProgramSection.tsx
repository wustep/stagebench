import React, { useState } from 'react';
import { OledDisplay } from '../controls/OledDisplay';
import { Button } from '../controls/Button';
import { Knob } from '../controls/Knob';
import { HardwareState } from '../../model/hardware';
import { ProgramData } from '../../model/programs';
import { SPLIT_POSITIONS, SplitPosition, CrossfadeWidth } from '../../model/splits';

interface ProgramSectionProps {
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

export const ProgramSection: React.FC<ProgramSectionProps> = ({
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
  const [shiftActive, setShiftActive] = useState(false);
  const [tempName, setTempName] = useState(state.store_as_name || 'My Program');

  const programButtons = [1, 2, 3, 4, 5, 6, 7, 8];

  // Derive display text
  const currentSlot = state.live_mode
    ? `Live ${state.live_slot}`
    : `${state.program_page}.${state.program_button}`;

  const progName = state.live_mode
    ? `Live Buffer ${state.live_slot}`
    : currentProgram?.name || `Program ${currentSlot}`;

  const dirtyTag = state.is_dirty ? ' [E]' : '';

  // Layers summary
  const pnoActive = state.piano_on && (state.piano_layer_a_on || state.piano_layer_b_on);
  const orgActive = state.organ_on && (state.organ_layer_a_on || state.organ_layer_b_on);
  const synActive =
    state.synth_on && (state.synth_layer_a_on || state.synth_layer_b_on || state.synth_layer_c_on);

  const activeLayersSummary = `Layers: ${pnoActive ? 'PNO ' : ''}${orgActive ? 'ORG ' : ''}${synActive ? 'SYN ' : ''}${!pnoActive && !orgActive && !synActive ? 'None' : ''}`;

  let displayTitle = state.live_mode ? 'LIVE MODE' : 'PROGRAM';
  let line1 = `${currentSlot}: ${progName}${dirtyTag}`;
  let line2 = activeLayersSummary;
  let line3 = `Scene: S${state.layer_scene} | Split: ${state.split ? 'ON' : 'OFF'}`;

  if (state.store_mode) {
    displayTitle = 'STORE DESTINATION';
    const targetPage = Math.floor((state.store_target_slot - 1) / 8) + 1;
    const targetBtn = ((state.store_target_slot - 1) % 8) + 1;
    line1 = `STORE TO: ${targetPage}.${targetBtn}`;
    line2 = `Press STORE to confirm`;
    line3 = `Press SHIFT/EXIT to cancel`;
  } else if (state.store_as_mode) {
    displayTitle = 'STORE AS (NAME)';
    line1 = `NAME: ${tempName}`;
    line2 = `Enter name below`;
    line3 = `Press STORE to proceed`;
  }

  return (
    <section
      id="section-program"
      aria-label="Program and Performance Section"
      className="panel-section section-program"
    >
      <div className="section-title-bar">
        <div className="section-title-text">PROGRAM</div>
        <div className="section-flags">
          <Button
            id="btn-shift"
            label="SHIFT"
            active={shiftActive}
            ledColor="amber"
            onClick={() => setShiftActive(!shiftActive)}
          />
          <Button
            id="btn-panic"
            label="PANIC"
            subLabel="ALL OFF"
            onClick={onPanic}
          />
        </div>
      </div>

      <div className="program-main-layout">
        {/* Primary Program OLED */}
        <div className="program-display-container">
          <OledDisplay
            id="program-oled"
            title={displayTitle}
            badge={state.live_mode ? `L${state.live_slot}` : `P${currentSlot}`}
            lines={[line1, line2, line3]}
            subInfo={`Tempo: ${state.tempo_bpm} BPM | Transpose: ${state.transpose > 0 ? `+${state.transpose}` : state.transpose}`}
          />
        </div>

        {/* Naming Input for Store As */}
        {state.store_as_mode && (
          <div className="store-as-input-row">
            <input
              type="text"
              id="store-as-name-input"
              aria-label="Program Name"
              className="store-as-text-field"
              value={tempName}
              maxLength={24}
              onChange={(e) => setTempName(e.target.value)}
            />
            <Button
              id="store-as-ok-btn"
              label="NEXT"
              onClick={() => onStoreAsConfirm(tempName)}
            />
            <Button
              id="store-as-cancel-btn"
              label="CANCEL"
              onClick={onStoreCancel}
            />
          </div>
        )}

        {/* List View Modal if open */}
        {state.list_view_open && (
          <div className="program-list-view-overlay" role="dialog" aria-label="Program Numeric List">
            <div className="program-list-header">
              <span>NUMERIC PROGRAM LIST (1..32)</span>
              <Button
                id="btn-close-list"
                label="CLOSE"
                onClick={() => updateState((prev) => ({ ...prev, list_view_open: false }))}
              />
            </div>
            <div className="program-list-scroll">
              {programsList.map((p, idx) => (
                <div
                  key={p.id}
                  className={`list-item ${idx + 1 === state.program_number ? 'selected' : ''}`}
                  onClick={() => {
                    onSelectProgram(idx + 1);
                    updateState((prev) => ({ ...prev, list_view_open: false }));
                  }}
                >
                  <span className="list-slot">{p.id}</span>
                  <span className="list-name">{p.name}</span>
                  <span className="list-cat">{p.category}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Splits Config Menu Modal if open */}
        {state.split_menu_open && (
          <div className="split-menu-overlay" role="dialog" aria-label="Split Points and Crossfades Settings">
            <div className="split-menu-header">
              <span>SPLIT POINTS & CROSSFADES</span>
              <Button
                id="btn-close-split-menu"
                label="DONE"
                onClick={() => updateState((prev) => ({ ...prev, split_menu_open: false }))}
              />
            </div>
            <div className="split-menu-content">
              {/* Mid Split (Default) */}
              <div className="split-point-row">
                <span className="split-name">MID SPLIT:</span>
                <Button
                  id="split-mid-toggle"
                  label={state.split_mid_active ? 'ACTIVE' : 'OFF'}
                  active={state.split_mid_active}
                  onClick={() =>
                    updateState((prev) => ({ ...prev, split_mid_active: !prev.split_mid_active }))
                  }
                />
                <select
                  id="split-mid-pos-select"
                  aria-label="Mid Split Position"
                  value={state.split_mid_pos}
                  onChange={(e) =>
                    updateState((prev) => ({
                      ...prev,
                      split_mid_pos: e.target.value as SplitPosition,
                    }))
                  }
                >
                  {SPLIT_POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
                <select
                  id="split-mid-xfade-select"
                  aria-label="Mid Crossfade Width"
                  value={state.split_mid_xfade}
                  onChange={(e) =>
                    updateState((prev) => ({
                      ...prev,
                      split_mid_xfade: parseInt(e.target.value, 10) as CrossfadeWidth,
                    }))
                  }
                >
                  <option value={0}>Off (0)</option>
                  <option value={6}>±6 Semitones</option>
                  <option value={12}>±12 Semitones</option>
                </select>
              </div>

              {/* Low Split */}
              <div className="split-point-row">
                <span className="split-name">LOW SPLIT:</span>
                <Button
                  id="split-low-toggle"
                  label={state.split_low_active ? 'ACTIVE' : 'OFF'}
                  active={state.split_low_active}
                  onClick={() =>
                    updateState((prev) => ({ ...prev, split_low_active: !prev.split_low_active }))
                  }
                />
                <select
                  id="split-low-pos-select"
                  aria-label="Low Split Position"
                  value={state.split_low_pos}
                  onChange={(e) =>
                    updateState((prev) => ({
                      ...prev,
                      split_low_pos: e.target.value as SplitPosition,
                    }))
                  }
                >
                  {SPLIT_POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
                <select
                  id="split-low-xfade-select"
                  aria-label="Low Crossfade Width"
                  value={state.split_low_xfade}
                  onChange={(e) =>
                    updateState((prev) => ({
                      ...prev,
                      split_low_xfade: parseInt(e.target.value, 10) as CrossfadeWidth,
                    }))
                  }
                >
                  <option value={0}>Off (0)</option>
                  <option value={6}>±6 Semitones</option>
                  <option value={12}>±12 Semitones</option>
                </select>
              </div>

              {/* High Split */}
              <div className="split-point-row">
                <span className="split-name">HIGH SPLIT:</span>
                <Button
                  id="split-high-toggle"
                  label={state.split_high_active ? 'ACTIVE' : 'OFF'}
                  active={state.split_high_active}
                  onClick={() =>
                    updateState((prev) => ({ ...prev, split_high_active: !prev.split_high_active }))
                  }
                />
                <select
                  id="split-high-pos-select"
                  aria-label="High Split Position"
                  value={state.split_high_pos}
                  onChange={(e) =>
                    updateState((prev) => ({
                      ...prev,
                      split_high_pos: e.target.value as SplitPosition,
                    }))
                  }
                >
                  {SPLIT_POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
                <select
                  id="split-high-xfade-select"
                  aria-label="High Crossfade Width"
                  value={state.split_high_xfade}
                  onChange={(e) =>
                    updateState((prev) => ({
                      ...prev,
                      split_high_xfade: parseInt(e.target.value, 10) as CrossfadeWidth,
                    }))
                  }
                >
                  <option value={0}>Off (0)</option>
                  <option value={6}>±6 Semitones</option>
                  <option value={12}>±12 Semitones</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Dial & Navigation */}
        <div className="program-dial-navigation-row">
          <div className="program-dial-container">
            <Knob
              id="program-dial"
              label="PROGRAM DIAL"
              value={state.store_mode ? state.store_target_slot : state.program_number}
              min={1}
              max={32}
              step={1}
              size="lg"
              onChange={(val) => {
                if (shiftActive) {
                  // Shift + Dial opens numeric list view
                  updateState((prev) => ({ ...prev, list_view_open: true }));
                } else if (state.store_mode) {
                  updateState((prev) => ({ ...prev, store_target_slot: val }));
                } else {
                  onSelectProgram(val);
                }
              }}
            />
          </div>

          <div className="program-nav-buttons">
            <Button
              id="program-page-left"
              label="PAGE <"
              hasLed={false}
              onClick={() => {
                const prevPage = Math.max(1, state.program_page - 1);
                const nextSlot = (prevPage - 1) * 8 + state.program_button;
                if (state.store_mode) {
                  updateState((prev) => ({ ...prev, store_target_slot: nextSlot }));
                } else {
                  onSelectProgram(nextSlot);
                }
              }}
            />
            <Button
              id="program-page-right"
              label="PAGE >"
              hasLed={false}
              onClick={() => {
                const nextPage = Math.min(4, state.program_page + 1);
                const nextSlot = (nextPage - 1) * 8 + state.program_button;
                if (state.store_mode) {
                  updateState((prev) => ({ ...prev, store_target_slot: nextSlot }));
                } else {
                  onSelectProgram(nextSlot);
                }
              }}
            />
            <Button
              id="btn-list-view"
              label="LIST"
              active={state.list_view_open}
              onClick={() =>
                updateState((prev) => ({ ...prev, list_view_open: !prev.list_view_open }))
              }
            />
          </div>
        </div>

        {/* 1..8 Program Selection Buttons */}
        <div className="program-buttons-bank" role="group" aria-label="Program 1-8 Selection Buttons">
          {programButtons.map((btnNum) => {
            const isBtnActive = state.live_mode
              ? state.live_slot === btnNum
              : state.program_button === btnNum;

            return (
              <Button
                key={btnNum}
                id={`program-btn-${btnNum}`}
                label={`${btnNum}`}
                active={isBtnActive}
                onClick={() => {
                  if (state.live_mode) {
                    onSelectLiveSlot(btnNum);
                  } else if (state.store_mode) {
                    const targetSlot = (state.program_page - 1) * 8 + btnNum;
                    updateState((prev) => ({ ...prev, store_target_slot: targetSlot }));
                  } else {
                    const nextSlot = (state.program_page - 1) * 8 + btnNum;
                    onSelectProgram(nextSlot);
                  }
                }}
              />
            );
          })}
        </div>

        {/* System & Scene & Morph Controls */}
        <div className="program-utility-row">
          <div className="scene-live-group">
            <Button
              id="btn-live-mode"
              label="LIVE"
              active={state.live_mode}
              ledColor="amber"
              onClick={() => {
                updateState((prev) => ({ ...prev, live_mode: !prev.live_mode }));
              }}
            />
            <Button
              id="btn-layer-scene"
              label="SCENE"
              subLabel={`S${state.layer_scene}`}
              active={state.layer_scene === 2}
              onClick={() => {
                updateState((prev) => ({
                  ...prev,
                  layer_scene: prev.layer_scene === 1 ? 2 : 1,
                }));
              }}
            />
            <Button
              id="btn-store"
              label="STORE"
              active={state.store_mode}
              ledColor="red"
              onClick={() => {
                if (shiftActive) {
                  // Shift + Store = STORE AS
                  updateState((prev) => ({
                    ...prev,
                    store_as_mode: true,
                    store_mode: false,
                    store_as_name: currentProgram?.name || 'New Program',
                  }));
                } else if (state.store_mode) {
                  onStoreConfirm();
                } else {
                  updateState((prev) => ({
                    ...prev,
                    store_mode: true,
                    store_target_slot: prev.program_number,
                  }));
                }
              }}
            />
            <Button
              id="btn-split"
              label="SPLIT"
              active={state.split}
              ledColor="green"
              onClick={() => {
                if (shiftActive) {
                  // Shift + Split opens split config menu
                  updateState((prev) => ({
                    ...prev,
                    split_menu_open: !prev.split_menu_open,
                  }));
                } else {
                  updateState((prev) => ({ ...prev, split: !prev.split }));
                }
              }}
            />
          </div>

          <div className="morph-assign-group" role="group" aria-label="Morph Assign">
            <span className="group-label">MORPH</span>
            <div className="morph-buttons">
              <Button
                id="morph-wheel"
                label="WHEEL"
                active={state.morph_edit_source === 'wheel'}
                ledColor="amber"
                onClick={() => {
                  if (shiftActive) {
                    // Shift + Source = Clear all assignments for wheel
                    updateState((prev) => ({
                      ...prev,
                      morph_assignments: prev.morph_assignments.filter((a) => a.source !== 'wheel'),
                      morph_edit_source: null,
                    }));
                  } else {
                    updateState((prev) => ({
                      ...prev,
                      morph_edit_source: prev.morph_edit_source === 'wheel' ? null : 'wheel',
                    }));
                  }
                }}
              />
              <Button
                id="morph-aftertouch"
                label="A-TOUCH"
                subLabel="UNSUPPORTED"
                active={false}
                hasLed={false}
                title="Aftertouch morph is unsupported / spec-excluded"
                onClick={() => {}}
              />
              <Button
                id="morph-ctrlped"
                label="CTRLPED"
                active={state.morph_edit_source === 'ctrlped'}
                ledColor="amber"
                onClick={() => {
                  if (shiftActive) {
                    // Shift + Source = Clear all assignments for ctrlped
                    updateState((prev) => ({
                      ...prev,
                      morph_assignments: prev.morph_assignments.filter((a) => a.source !== 'ctrlped'),
                      morph_edit_source: null,
                    }));
                  } else {
                    updateState((prev) => ({
                      ...prev,
                      morph_edit_source: prev.morph_edit_source === 'ctrlped' ? null : 'ctrlped',
                    }));
                  }
                }}
              />
            </div>
          </div>

          <div className="clock-transpose-group">
            <Button
              id="btn-mst-clk"
              label="MST CLK"
              subLabel={`${state.tempo_bpm}`}
              onClick={onTapMasterClock}
            />
            <Button
              id="btn-transpose"
              label="TRANSPOSE"
              subLabel={state.transpose === 0 ? '0' : `${state.transpose > 0 ? `+${state.transpose}` : state.transpose}`}
              active={state.transpose !== 0}
              onClick={() => {
                if (shiftActive) {
                  onPanic();
                } else {
                  // Cycle -6..+6
                  updateState((prev) => {
                    const next = prev.transpose >= 6 ? -6 : prev.transpose + 1;
                    return { ...prev, transpose: next, transpose_active: next !== 0 };
                  });
                }
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
