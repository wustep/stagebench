import type { ControlApi } from '../../hooks/useControls';
import { ControlView } from '../controls/ControlView';
import { Group } from '../Group';

/**
 * Performance section — exposed red chassis (no full dark plate, no OLED).
 * Landmarks: master level knob, pitch stick, modulation wheel, Nord Stage 4
 * branding, plus the small Rotary Speaker cluster.
 */
export function PerformanceSection({ ctl }: { ctl: ControlApi }) {
  return (
    <section className="deck-section performance" aria-label="Performance controls">
      <div className="perf-top">
        <ControlView id="performance-master-level" ctl={ctl} />
      </div>

      <div className="perf-wheels">
        <ControlView id="performance-pitch-stick" ctl={ctl} />
        <ControlView id="performance-mod-wheel" ctl={ctl} />
      </div>

      <Group title="ROTARY SPEAKER" className="rotary-group">
        <ControlView id="performance-rotary-drive" ctl={ctl} />
        <div className="rotary-buttons">
          <ControlView id="performance-rotary-on" ctl={ctl} led="green" />
          <ControlView id="performance-rotary-source" ctl={ctl} />
          <ControlView id="performance-rotary-stopmode" ctl={ctl} />
          <ControlView id="performance-rotary-speed" ctl={ctl} />
          <ControlView id="performance-rotary-morph" ctl={ctl} />
        </div>
      </Group>

      <div className="brand">
        <span className="brand-name">nord stage 4</span>
        <span className="brand-sub">HAMMER ACTION 73</span>
      </div>
    </section>
  );
}
