import type { PianoEngineStatusSnapshot } from '../../audio/boundaries'
import type { NoteLifecycleSnapshot } from '../../audio/noteLifecycle'
import { midiToNoteName } from '../../model/variant'
import { HardwareButton, HardwareKnob, LedDot, type SectionProps } from '../PanelControls'

export interface ProgramSectionProps extends SectionProps {
  readonly audioStatus: PianoEngineStatusSnapshot
  readonly noteSnapshot: NoteLifecycleSnapshot
}

export function ProgramSection({
  state,
  dispatch,
  audioStatus,
  noteSnapshot,
}: ProgramSectionProps) {
  const morphWheel = (state['program-morph-wheel'] ?? 1) > 0
  const morphAt = (state['program-morph-at'] ?? 0) > 0
  const morphCtrl = (state['program-morph-ctrlped'] ?? 0) > 0
  const splitOn = (state['program-split'] ?? 1) > 0
  const mstClkOn = (state['program-mst-clk'] ?? 0) > 0
  const transpOn = (state['program-transpose'] ?? 0) > 0
  const storeOn = (state['program-store'] ?? 0) > 0
  const liveOn = (state['program-live-mode'] ?? 0) > 0
  const sceneOn = (state['program-layer-scene'] ?? 0) > 0

  const voiceTitle =
    audioStatus.status === 'ready'
      ? 'Salamander Grand'
      : audioStatus.status === 'fallback'
        ? 'Synth Fallback'
        : audioStatus.status === 'error'
          ? 'Audio Error'
          : 'Loading Grand...'

  const noteLine =
    noteSnapshot.lastNoteMidi !== null
      ? `NOTE ${midiToNoteName(noteSnapshot.lastNoteMidi)}  VEL ${noteSnapshot.lastVelocity ?? 0}`
      : '73 KEYS  E1 - E7'

  const sustainLine = noteSnapshot.sustainActive ? 'SUST ON' : 'SUST OFF'

  return (
    <section
      className="ns4-section ns4-section-program"
      data-section="program"
      aria-label="Program and morph"
    >
      {/* Top strip: Morph Assign, Split, Mst Clk, Transp */}
      <div className="ns4-prog-top-row">
        <div className="ns4-morph-box">
          <div className="ns4-morph-header">MORPH ASSIGN</div>
          <div className="ns4-morph-btns">
            <div className="ns4-morph-cell">
              <div className="ns4-led-label-line">
                <LedDot on={morphWheel} color="green" size="xs" />
                <span>WHL</span>
              </div>
              <HardwareButton id="program-morph-wheel" state={state} dispatch={dispatch} size="xs" />
            </div>
            <div className="ns4-morph-cell">
              <div className="ns4-led-label-line">
                <LedDot on={morphAt} color="green" size="xs" />
                <span>A.T.</span>
              </div>
              <HardwareButton id="program-morph-at" state={state} dispatch={dispatch} size="xs" />
            </div>
            <div className="ns4-morph-cell">
              <div className="ns4-led-label-line">
                <LedDot on={morphCtrl} color="green" size="xs" />
                <span>PED</span>
              </div>
              <HardwareButton id="program-morph-ctrlped" state={state} dispatch={dispatch} size="xs" />
            </div>
          </div>
        </div>

        <div className="ns4-prog-mini-top">
          <span className="ns4-red-pill">SPLIT</span>
          <div className="ns4-led-trio">
            <LedDot on={false} color="red" size="xs" />
            <LedDot on={splitOn} color="amber" size="xs" />
            <LedDot on={false} color="red" size="xs" />
          </div>
          <HardwareButton id="program-split" state={state} dispatch={dispatch} size="xs" />
        </div>

        <div className="ns4-prog-mini-top">
          <span className="ns4-red-pill">CLK</span>
          <LedDot on={mstClkOn} color="red" size="xs" />
          <HardwareButton id="program-mst-clk" state={state} dispatch={dispatch} size="xs" />
        </div>

        <div className="ns4-prog-mini-top">
          <span className="ns4-red-pill">TRN</span>
          <LedDot on={transpOn} color="red" size="xs" />
          <HardwareButton id="program-transpose" state={state} dispatch={dispatch} size="xs" />
        </div>
      </div>

      {/* Second row: Store, Preset Library, Prog View */}
      <div className="ns4-prog-second-row">
        <div className="ns4-store-cell">
          <div className="ns4-led-label-line">
            <LedDot on={storeOn} color="red" size="xs" />
            <span>STORE</span>
          </div>
          <HardwareButton
            id="program-store"
            state={state}
            dispatch={dispatch}
            variant="red"
            size="xs"
          />
        </div>

        <div className="ns4-preset-lib-box">
          <div className="ns4-preset-lib-title">PRESET LIBRARY</div>
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
          <div className="ns4-oled-top">
            <span>P1:01</span>
            <span>{sustainLine}</span>
          </div>
          <div className="ns4-oled-main">{voiceTitle}</div>
          <div className="ns4-oled-divider" aria-hidden="true" />
          <div className="ns4-oled-line">{noteLine}</div>
          <div className="ns4-oled-line ns4-oled-muted">PANEL: DECORATIVE</div>
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
          <div className="ns4-prog-bank-header">PROGRAM</div>
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
