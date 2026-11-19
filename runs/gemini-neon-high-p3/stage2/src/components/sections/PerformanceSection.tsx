import {
  HardwareButton,
  HardwareKnob,
  HardwareModWheel,
  HardwarePitchStick,
  LedDot,
  type SectionProps,
} from '../PanelControls'

export function PerformanceSection({ state, dispatch }: SectionProps) {
  const driveOn = (state['perf-rotary-drive-on'] ?? 0) > 0
  const stopOn = (state['perf-rotary-stop'] ?? 0) > 0
  const fastSpeed = (state['perf-rotary-speed'] ?? 0) > 0

  return (
    <section
      className="ns4-section ns4-section-performance"
      data-section="performance"
      aria-label="Performance controls"
    >
      <div className="ns4-perf-left">
        <div className="ns4-perf-wheels">
          <div className="ns4-perf-pitch-row">
            <HardwarePitchStick state={state} dispatch={dispatch} />
          </div>
          <div className="ns4-perf-mod-row">
            <HardwareModWheel state={state} dispatch={dispatch} />
          </div>
        </div>
        <div className="ns4-branding" aria-label="Nord Stage 4 Hammer Action 73">
          <div className="ns4-brand-title">nord stage 4</div>
          <div className="ns4-brand-sub">HAMMER ACTION 73</div>
        </div>
      </div>

      <div className="ns4-perf-right">
        <div className="ns4-master-block">
          <span className="ns4-legend-top">MASTER LEVEL</span>
          <HardwareKnob id="perf-master-level" state={state} dispatch={dispatch} size="md" />
        </div>

        <div className="ns4-rotary-block">
          <div className="ns4-rotary-header">ROTARY SPEAKER</div>
          <div className="ns4-rotary-knob-row">
            <LedDot on={driveOn} color="red" size="xs" />
            <HardwareKnob
              id="perf-rotary-drive"
              state={state}
              dispatch={dispatch}
              size="sm"
              label="DRIVE"
            />
          </div>
          <div className="ns4-rotary-btn-col">
            <div className="ns4-rotary-btn-row">
              <LedDot on={driveOn} color="red" size="xs" />
              <HardwareButton id="perf-rotary-drive-on" state={state} dispatch={dispatch} size="xs" />
            </div>
            <span className="ns4-legend-micro">CLOSE MIC</span>
            <div className="ns4-rotary-btn-row">
              <LedDot on={stopOn} color="red" size="xs" />
              <HardwareButton id="perf-rotary-stop" state={state} dispatch={dispatch} size="xs" />
            </div>
            <span className="ns4-legend-micro">STOP MODE</span>
            <div className="ns4-rotary-speed-leds">
              <LedDot on={!fastSpeed && !stopOn} color="amber" size="xs" />
              <span className="ns4-legend-micro">SLOW / FAST</span>
              <LedDot on={fastSpeed && !stopOn} color="red" size="xs" />
            </div>
            <HardwareButton
              id="perf-rotary-speed"
              state={state}
              dispatch={dispatch}
              variant="red-frame"
              size="xs"
            />
            <span className="ns4-legend-micro">MORPH</span>
          </div>
        </div>
      </div>
    </section>
  )
}
