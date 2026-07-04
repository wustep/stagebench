import { useCallback, useRef } from 'react';
import type { ControlDef } from '../../model/controls';

interface FaderProps {
  def: ControlDef;
  value: number; // 0..1
  onChange: (value: number) => void;
  height?: number;
  /** Render an LED ladder beside the cap (organ/synth level faders). */
  ledGraph?: boolean;
}

/**
 * Decorative vertical fader with an optional LED ladder. Accessible ARIA slider,
 * keyboard operable, drag operable. Presentation state only.
 */
export function Fader({ def, value, onChange, height = 62, ledGraph = false }: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  const setFromClientY = useCallback(
    (clientY: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = 1 - (clientY - rect.top) / rect.height;
      onChange(clamp(ratio));
    },
    [onChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 0.1 : 0.05;
      let next: number | null = null;
      if (e.key === 'ArrowUp') next = clamp(value + step);
      else if (e.key === 'ArrowDown') next = clamp(value - step);
      else if (e.key === 'Home') next = 1;
      else if (e.key === 'End') next = 0;
      if (next !== null) {
        e.preventDefault();
        onChange(next);
      }
    },
    [value, onChange],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragging.current = true;
      setFromClientY(e.clientY);
    },
    [setFromClientY],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      setFromClientY(e.clientY);
    },
    [setFromClientY],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  const pct = Math.round(value * 100);
  const capBottom = value * (height - 20);
  const ledCount = 12;
  const litLeds = Math.round(value * ledCount);

  return (
    <div className="ctl ctl-fader">
      <div className="fader-assembly" style={{ height }}>
        {ledGraph ? (
          <div className="led-ladder" aria-hidden="true">
            {Array.from({ length: ledCount }).map((_, i) => (
              <span
                key={i}
                className={`led-seg ${ledCount - i <= litLeds ? 'on' : ''}`}
              />
            ))}
          </div>
        ) : null}
        <div
          ref={trackRef}
          className="fader-track"
          role="slider"
          tabIndex={0}
          aria-label={def.name}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${pct}%`}
          data-control-id={def.id}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="fader-cap" style={{ bottom: capBottom }} />
        </div>
      </div>
    </div>
  );
}
