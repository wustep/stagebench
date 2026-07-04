import { useCallback, useRef } from 'react';
import type { ControlDef } from '../../model/controls';

interface KnobProps {
  def: ControlDef;
  value: number; // 0..1
  onChange: (value: number) => void;
  size?: number;
}

/**
 * Decorative rotary knob. Fully accessible: exposed as an ARIA slider with
 * value text, operable by keyboard (arrows / home / end) and by vertical drag.
 * Turning it moves the indicator and updates presentation state only.
 */
export function Knob({ def, value, onChange, size = 26 }: KnobProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ startY: number; startVal: number } | null>(null);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  // Map 0..1 to a -135deg .. +135deg sweep.
  const angle = -135 + value * 270;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 0.1 : 0.05;
      let next: number | null = null;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = clamp(value + step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = clamp(value - step);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = 1;
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
      dragging.current = { startY: e.clientY, startVal: value };
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dy = dragging.current.startY - e.clientY;
      onChange(clamp(dragging.current.startVal + dy / 120));
    },
    [onChange],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  const pct = Math.round(value * 100);

  return (
    <div className="ctl ctl-knob">
      <div
        ref={ref}
        className="knob"
        role="slider"
        tabIndex={0}
        aria-label={def.name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
        data-control-id={def.id}
        style={{ width: size, height: size }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="knob-indicator" style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      {def.caption ? <span className="ctl-caption">{def.caption}</span> : null}
    </div>
  );
}
