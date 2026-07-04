import { useRef } from 'react';
import type { ControlApi } from '../../hooks/useControls';
import type { PerformanceStore } from '../../state/performanceStore';
import { usePerformanceState } from '../../hooks/usePerformance';
import { ControlView } from '../controls/ControlView';
import { Group } from '../Group';

/**
 * Performance section — exposed red chassis (no full dark plate, no OLED).
 * Landmarks: master level knob, pitch stick, modulation wheel, Nord Stage 4
 * branding, the small Rotary Speaker cluster, and the Master Clock tap button.
 */
export function PerformanceSection({
  ctl,
  perfStore,
  onPanic,
}: {
  ctl: ControlApi;
  perfStore: PerformanceStore;
  onPanic: () => void;
}) {
  const perf = usePerformanceState(perfStore);
  void onPanic;

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

      <Group title="MASTER CLOCK" className="clock-group">
        <MasterClockButton perfStore={perfStore} bpm={perf.clock.bpm} />
        <ControlView id="performance-ctrl-pedal" ctl={ctl} />
      </Group>

      <div className="brand">
        <span className="brand-name">nord stage 4</span>
        <span className="brand-sub">HAMMER ACTION 73</span>
      </div>
    </section>
  );
}

/** MST CLK: tap four+ times to set BPM, or ▲/▼ to dial it. */
function MasterClockButton({ perfStore, bpm }: { perfStore: PerformanceStore; bpm: number }) {
  const taps = useRef<number[]>([]);
  const onTap = () => {
    const now = performance.now();
    taps.current.push(now);
    if (taps.current.length > 8) taps.current.shift();
    const recent = taps.current.filter((t) => now - t < 3000);
    taps.current = recent;
    if (recent.length >= 4) {
      let sum = 0;
      for (let i = 1; i < recent.length; i++) sum += recent[i] - recent[i - 1];
      const avg = sum / (recent.length - 1);
      if (avg > 0) perfStore.setClockBpm(60000 / avg);
    }
  };
  return (
    <div className="clock-control">
      <button
        type="button"
        className="panel-btn square"
        aria-label={`Master clock tap (${bpm} BPM)`}
        data-control-id="performance-mst-clk"
        onClick={onTap}
      >
        MST CLK
      </button>
      <div
        className="clock-bpm"
        role="spinbutton"
        tabIndex={0}
        aria-label="Master clock BPM"
        aria-valuenow={bpm}
        aria-valuemin={30}
        aria-valuemax={300}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault();
            perfStore.setClockBpm(bpm + 1);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            perfStore.setClockBpm(bpm - 1);
          }
        }}
      >
        <button type="button" className="bpm-nub" aria-label="BPM down" onClick={() => perfStore.setClockBpm(bpm - 1)}>
          −
        </button>
        <span className="bpm-value">{bpm}</span>
        <button type="button" className="bpm-nub" aria-label="BPM up" onClick={() => perfStore.setClockBpm(bpm + 1)}>
          +
        </button>
      </div>
    </div>
  );
}
