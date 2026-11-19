import type { PianoEngineStatusSnapshot } from '../../audio/boundaries'
import type { NoteLifecycleSnapshot } from '../../audio/noteLifecycle'
import {
  getPianoModel,
  type InstrumentAction,
  type StageInstrumentState,
} from '../../model/instrumentState'
import {
  formatLiveSlotCode,
  formatProgramSlotCode,
} from '../../model/programBank'
import { SPLIT_CROSSFADE_OPTIONS, SPLIT_POSITION_NOTES } from '../../model/splits'
import { midiToNoteName } from '../../model/variant'
import { HardwareButton, HardwareKnob, LedDot, type SectionProps } from '../PanelControls'

export interface ProgramSectionProps extends SectionProps {
  readonly audioStatus: PianoEngineStatusSnapshot
  readonly noteSnapshot: NoteLifecycleSnapshot
  readonly instrumentState: StageInstrumentState
  readonly dispatchInstrument: (action: InstrumentAction) => void
}

export function ProgramSection({
  state,
  dispatch,
  audioStatus,
  noteSnapshot,
  instrumentState,
  dispatchInstrument,
}: ProgramSectionProps) {
  const prog = instrumentState.program
  const morphWheel = (state['program-morph-wheel'] ?? 0) > 0
  const morphAt = (state['program-morph-at'] ?? 0) > 0
  const morphCtrl = (state['program-morph-ctrlped'] ?? 0) > 0
  const splitOn = instrumentState.split.enabled
  const mstClkOn = prog.overlay.kind === 'clock-edit' || instrumentState.masterClock.kbSync
  const transpOn = instrumentState.transpose.enabled
  const storeFlashing = prog.overlay.kind === 'store-confirm' || prog.overlay.kind === 'store-as-name'
  const liveOn = prog.mode === 'live'
  const sceneOn = instrumentState.scenes.activeScene === 'II'

  const slotCode =
    prog.mode === 'live'
      ? formatLiveSlotCode(prog.activeLiveSlot)
      : formatProgramSlotCode(prog.activeSlot)
  const slotName =
    prog.mode === 'live'
      ? prog.liveSlots[prog.activeLiveSlot].name
      : prog.programs[prog.activeSlot].name

  const focusedLayerId = instrumentState.piano.focusedLayer
  const focusedLayer = instrumentState.piano.layers[focusedLayerId]
  const focusedModel = getPianoModel(focusedLayer.type, focusedLayer.modelIndex)
  const modelMissing = Boolean(
    focusedModel.sampleBankId && audioStatus.failedBanks?.includes(focusedModel.sampleBankId),
  )

  const activeVoiceSummary = (() => {
    if (audioStatus.status === 'error') return 'Audio Error'
    if (modelMissing) return `MISSING: ${focusedModel.name}`
    if (instrumentState.effects.focusedChain === 'organ') {
      const orgId = instrumentState.organ.focusedLayer
      return `ORG ${orgId}: ${instrumentState.organ.layers[orgId].model}`
    }
    if (instrumentState.effects.focusedChain.startsWith('synth')) {
      const synId = instrumentState.synth.focusedLayer
      return `SYN ${synId}: ${instrumentState.synth.layers[synId].oscWaveform}`
    }
    if (audioStatus.usingFallback) return `Fallback (${focusedModel.name})`
    return `${focusedLayerId}: ${focusedModel.name}`
  })()

  const fxFocusLabel = (() => {
    const fx = instrumentState.effects
    if (!fx.allOn) return 'FX: BYPASS'
    if (fx.pianoGroupMode && (fx.focusedChain === 'pianoA' || fx.focusedChain === 'pianoB')) {
      return 'FX: PNO GRP'
    }
    if (fx.synthGroupMode && fx.focusedChain.startsWith('synth')) {
      return 'FX: SYN GRP'
    }
    if (fx.focusedChain === 'pianoA') return 'FX: PNO A'
    if (fx.focusedChain === 'pianoB') return 'FX: PNO B'
    if (fx.focusedChain === 'organ') return 'FX: ORGAN'
    return `FX: ${fx.focusedChain.toUpperCase()}`
  })()

  const statusLine =
    prog.statusNotice ??
    (noteSnapshot.lastNoteMidi !== null
      ? `NOTE ${midiToNoteName(noteSnapshot.lastNoteMidi)} VEL ${noteSnapshot.lastVelocity ?? 0}`
      : `${fxFocusLabel} · ${instrumentState.masterClock.bpm}BPM`)

  const footerTags = [
    splitOn ? 'SPL' : null,
    sceneOn ? 'SC II' : 'SC I',
    transpOn
      ? `TR${instrumentState.transpose.semitones >= 0 ? '+' : ''}${instrumentState.transpose.semitones}`
      : null,
    `MST ${instrumentState.masterLevel}%`,
  ]
    .filter(Boolean)
    .join(' · ')

  const renderOledBody = () => {
    const ov = prog.overlay

    if (ov.kind === 'store-as-name') {
      return (
        <div className="ns4-oled-inline-edit" data-testid="store-as-overlay">
          <div className="ns4-oled-top">
            <span>STORE AS</span>
            <span>{ov.destMode === 'live' ? formatLiveSlotCode(ov.destSlot) : formatProgramSlotCode(ov.destSlot)}</span>
          </div>
          <input
            type="text"
            aria-label="Program name"
            className="ns4-oled-name-input"
            maxLength={20}
            value={ov.draftName}
            onChange={(e) => dispatchInstrument({ type: 'set-store-as-name', name: e.target.value })}
          />
          <div className="ns4-oled-mini-actions">
            <button
              type="button"
              onClick={() => dispatchInstrument({ type: 'store-as-delete-char' })}
            >
              DEL
            </button>
            <button
              type="button"
              onClick={() => dispatchInstrument({ type: 'advance-store-as-to-confirm' })}
            >
              NEXT
            </button>
            <button
              type="button"
              onClick={() => dispatchInstrument({ type: 'cancel-overlay' })}
            >
              ESC
            </button>
          </div>
        </div>
      )
    }

    if (ov.kind === 'store-confirm') {
      const destCode =
        ov.destMode === 'live'
          ? formatLiveSlotCode(ov.destSlot)
          : formatProgramSlotCode(ov.destSlot)
      return (
        <div className="ns4-oled-inline-edit" data-testid="store-confirm-overlay">
          <div className="ns4-oled-top">
            <span>STORE TO {destCode}</span>
            <span>AUDITION</span>
          </div>
          <div className="ns4-oled-main">{ov.pendingName}</div>
          <div className="ns4-oled-mini-actions">
            <button type="button" onClick={() => dispatchInstrument({ type: 'confirm-store' })}>
              STORE
            </button>
            <button type="button" onClick={() => dispatchInstrument({ type: 'cancel-overlay' })}>
              CANCEL
            </button>
          </div>
        </div>
      )
    }

    if (ov.kind === 'list-view') {
      return (
        <div className="ns4-oled-list" role="listbox" aria-label="Program numeric list" data-testid="program-list-view">
          {prog.programs.map((slot) => (
            <button
              key={slot.index}
              type="button"
              role="option"
              aria-selected={slot.index === prog.activeSlot}
              className={`ns4-oled-list-item ${slot.index === prog.activeSlot ? 'is-selected' : ''}`}
              onClick={() => dispatchInstrument({ type: 'select-program', index: slot.index })}
            >
              <span>{formatProgramSlotCode(slot.index)}</span>
              <span>{slot.name}</span>
            </button>
          ))}
        </div>
      )
    }

    if (ov.kind === 'split-edit') {
      const pt = instrumentState.split.points[ov.activePoint]
      return (
        <div className="ns4-oled-inline-edit" data-testid="split-edit-overlay">
          <div className="ns4-oled-top">
            <span>SPLIT {ov.activePoint.toUpperCase()}</span>
            <span>{pt.active ? pt.note : 'OFF'}</span>
          </div>
          <div className="ns4-oled-line">
            XFADE: {pt.crossfade === 0 ? 'OFF' : `±${pt.crossfade}`}
          </div>
          <div className="ns4-oled-mini-actions">
            <button
              type="button"
              onClick={() =>
                dispatchInstrument({
                  type: 'set-split-point',
                  point: ov.activePoint,
                  patch: { active: !pt.active },
                })
              }
            >
              {pt.active ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={() => {
                const idx = SPLIT_POSITION_NOTES.indexOf(pt.note)
                const next = SPLIT_POSITION_NOTES[(idx + 1) % SPLIT_POSITION_NOTES.length]
                dispatchInstrument({
                  type: 'set-split-point',
                  point: ov.activePoint,
                  patch: { active: true, note: next },
                })
              }}
            >
              NOTE
            </button>
            <button
              type="button"
              onClick={() => {
                const idx = SPLIT_CROSSFADE_OPTIONS.indexOf(pt.crossfade)
                const next = SPLIT_CROSSFADE_OPTIONS[(idx + 1) % SPLIT_CROSSFADE_OPTIONS.length]
                dispatchInstrument({
                  type: 'set-split-point',
                  point: ov.activePoint,
                  patch: { crossfade: next },
                })
              }}
            >
              XF
            </button>
          </div>
        </div>
      )
    }

    if (ov.kind === 'clock-edit') {
      return (
        <div className="ns4-oled-inline-edit" data-testid="clock-edit-overlay">
          <div className="ns4-oled-top">
            <span>MST CLOCK</span>
            <span>{instrumentState.masterClock.kbSync ? 'KB ON' : 'KB OFF'}</span>
          </div>
          <div className="ns4-oled-main">{instrumentState.masterClock.bpm} BPM</div>
          <div className="ns4-oled-mini-actions">
            <button
              type="button"
              onClick={() =>
                dispatchInstrument({
                  type: 'set-master-clock',
                  patch: { bpm: instrumentState.masterClock.bpm - 5 },
                })
              }
            >
              -5
            </button>
            <button
              type="button"
              onClick={() =>
                dispatchInstrument({
                  type: 'set-master-clock',
                  patch: { bpm: instrumentState.masterClock.bpm + 5 },
                })
              }
            >
              +5
            </button>
            <button
              type="button"
              onClick={() =>
                dispatchInstrument({
                  type: 'set-master-clock',
                  patch: { kbSync: !instrumentState.masterClock.kbSync },
                })
              }
            >
              SYNC
            </button>
          </div>
        </div>
      )
    }

    if (ov.kind === 'transpose-edit') {
      const tr = instrumentState.transpose.semitones
      return (
        <div className="ns4-oled-inline-edit" data-testid="transpose-edit-overlay">
          <div className="ns4-oled-top">
            <span>TRANSPOSE</span>
            <span>{instrumentState.transpose.enabled ? 'ON' : 'OFF'}</span>
          </div>
          <div className="ns4-oled-main">{tr >= 0 ? `+${tr}` : `${tr}`} ST</div>
          <div className="ns4-oled-mini-actions">
            <button
              type="button"
              onClick={() =>
                dispatchInstrument({ type: 'set-transpose', patch: { semitones: tr - 1 } })
              }
            >
              -1
            </button>
            <button
              type="button"
              onClick={() =>
                dispatchInstrument({ type: 'set-transpose', patch: { semitones: tr + 1 } })
              }
            >
              +1
            </button>
            <button
              type="button"
              onClick={() => dispatchInstrument({ type: 'cancel-overlay' })}
            >
              OK
            </button>
          </div>
        </div>
      )
    }

    return (
      <>
        <div className="ns4-oled-top">
          <span>
            {slotCode}
            {prog.dirty ? (
              <span className="ns4-oled-dirty" data-testid="dirty-indicator" title="Edited program">
                {' '}
                E
              </span>
            ) : null}
          </span>
          <span>{slotName}</span>
        </div>
        <div className="ns4-oled-main">{activeVoiceSummary}</div>
        <div className="ns4-oled-divider" aria-hidden="true" />
        <div className="ns4-oled-line">{statusLine}</div>
        <div className="ns4-oled-line ns4-oled-muted">{footerTags}</div>
      </>
    )
  }

  return (
    <section
      className="ns4-section ns4-section-program"
      data-section="program"
      data-program-slot={slotCode}
      data-program-mode={prog.mode}
      data-program-dirty={prog.dirty ? 'true' : 'false'}
      data-active-scene={instrumentState.scenes.activeScene}
      data-split-enabled={splitOn ? 'on' : 'off'}
      data-morph-assign={prog.morphAssignSource ?? 'none'}
      aria-label="Program and morph"
    >
      {/* Top strip: Morph Assign, Split, Mst Clk, Transp */}
      <div className="ns4-prog-top-row">
        <div className="ns4-morph-box">
          <div className="ns4-morph-header">MORPH ASSIGN</div>
          <div className="ns4-morph-btns">
            <div className="ns4-morph-cell">
              <LedDot on={morphWheel} color="red" size="xs" />
              <HardwareButton id="program-morph-wheel" state={state} dispatch={dispatch} size="xs" />
              <span className="ns4-legend-micro">WHL</span>
            </div>
            <div className="ns4-morph-cell">
              <LedDot on={morphAt} color="red" size="xs" />
              <HardwareButton id="program-morph-at" state={state} dispatch={dispatch} size="xs" />
              <span className="ns4-legend-micro">A.T.</span>
            </div>
            <div className="ns4-morph-cell">
              <LedDot on={morphCtrl} color="red" size="xs" />
              <HardwareButton id="program-morph-ctrlped" state={state} dispatch={dispatch} size="xs" />
              <span className="ns4-legend-micro">PED</span>
            </div>
          </div>
        </div>

        <div className="ns4-prog-mini-top">
          <span className="ns4-legend-micro">SPLIT</span>
          <LedDot on={splitOn} color="red" size="xs" />
          <HardwareButton id="program-split" state={state} dispatch={dispatch} size="xs" />
        </div>
        <div className="ns4-prog-mini-top">
          <span className="ns4-legend-micro">CLK</span>
          <LedDot on={mstClkOn} color="red" size="xs" />
          <HardwareButton id="program-mst-clk" state={state} dispatch={dispatch} size="xs" />
        </div>
        <div className="ns4-prog-mini-top">
          <span className="ns4-legend-micro">TRN</span>
          <LedDot on={transpOn} color="red" size="xs" />
          <HardwareButton id="program-transpose" state={state} dispatch={dispatch} size="xs" />
        </div>
      </div>

      {/* Second row: Store, Preset Library, Prog View */}
      <div className="ns4-prog-second-row">
        <div className="ns4-store-cell">
          <span className="ns4-legend-micro">STORE</span>
          <LedDot on={storeFlashing} color="red" size="xs" />
          <HardwareButton id="program-store" state={state} dispatch={dispatch} size="xs" />
        </div>

        <div className="ns4-preset-lib-box">
          <span className="ns4-preset-lib-title">PRESET LIBRARY</span>
          <div className="ns4-preset-lib-btns">
            <HardwareButton id="program-preset-organ" state={state} dispatch={dispatch} size="xs" />
            <HardwareButton id="program-preset-piano" state={state} dispatch={dispatch} size="xs" />
            <HardwareButton id="program-preset-synth" state={state} dispatch={dispatch} size="xs" />
          </div>
        </div>

        <div className="ns4-prog-view-cell">
          <span className="ns4-legend-micro">VIEW</span>
          <HardwareButton id="program-prog-view" state={state} dispatch={dispatch} size="xs" />
        </div>
      </div>

      {/* Middle row: Program Dial + Page/Cat | Primary Program OLED | Solo/Edit/Copy rail */}
      <div className="ns4-prog-mid-row">
        <div className="ns4-prog-dial-col">
          <HardwareKnob
            id="program-dial"
            state={state}
            dispatch={dispatch}
            size="md"
            variant="encoder"
            label="PROGRAM"
          />
          <div className="ns4-page-cat-row">
            <HardwareButton id="program-page-prev" state={state} dispatch={dispatch} size="xs" />
            <HardwareButton id="program-page-next" state={state} dispatch={dispatch} size="xs" />
          </div>
          <span className="ns4-legend-micro">◀ PAGE ▶</span>
        </div>

        {/* The ONLY primary OLED display in the Program section */}
        <div
          id="program-oled"
          className="ns4-oled-program"
          role="status"
          aria-live="polite"
          aria-label="Program primary OLED display"
        >
          {renderOledBody()}
        </div>

        <div className="ns4-prog-edit-rail">
          <span className="ns4-legend-micro">SOLO</span>
          <HardwareButton id="program-solo" state={state} dispatch={dispatch} size="xs" />
          <span className="ns4-legend-micro">EDIT</span>
          <HardwareButton id="program-section-edit" state={state} dispatch={dispatch} size="xs" />
          <span className="ns4-legend-micro">COPY</span>
          <HardwareButton id="program-mon-copy" state={state} dispatch={dispatch} size="xs" />
        </div>
      </div>

      {/* Bottom row: Live Mode / Layer Scene II | 8 Program buttons (1-8) | Shift */}
      <div className="ns4-prog-bottom-row">
        <div className="ns4-prog-mode-col">
          <div className="ns4-led-label-line">
            <LedDot on={liveOn} color="red" size="xs" />
            <span>LIVE</span>
          </div>
          <HardwareButton
            id="program-live-mode"
            state={state}
            dispatch={dispatch}
            variant="light"
            size="xs"
          />
          <span className="ns4-legend-micro">SCENE II</span>
          <HardwareButton
            id="program-layer-scene"
            state={state}
            dispatch={dispatch}
            size="xs"
          />
          <LedDot on={sceneOn} color="red" size="xs" />
        </div>

        <div className="ns4-prog-bank" role="group" aria-label="Program bank buttons 1 to 8">
          <div className="ns4-prog-bank-header">{liveOn ? 'LIVE 1-8' : 'PROGRAM'}</div>
          <div className="ns4-prog-bank-grid">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => {
              const id = `program-btn-${num}`
              const lit = (state[id] ?? 0) > 0
              return (
                <div key={num} className="ns4-prog-slot">
                  <div className="ns4-prog-slot-top">
                    <LedDot on={lit} color="red" size="xs" />
                    <span>{num}</span>
                  </div>
                  <HardwareButton id={id} state={state} dispatch={dispatch} size="xs" />
                </div>
              )
            })}
          </div>
        </div>

        <div className="ns4-shift-col">
          <span className="ns4-shift-tag">SHIFT</span>
          <HardwareButton
            id="program-shift"
            state={state}
            dispatch={dispatch}
            variant="tall-light"
            size="xs"
          />
          <span className="ns4-shift-tag">EXIT</span>
        </div>
      </div>
    </section>
  )
}
