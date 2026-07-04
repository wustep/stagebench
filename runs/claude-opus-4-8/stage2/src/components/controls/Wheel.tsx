import { useCallback, useRef } from 'react';
import type { ControlDef } from '../../model/controls';

interface WheelProps {
  def: ControlDef;
  value: number; // 0..1
  onChange: (value: number) => void;
  height?: number;
}

/**
 * Pitch stick (spring-centered) / modulation wheel. Vertical throw. The pitch
 * stick snaps back to center on release. Accessible ARIA slider, keyboard +
 * drag operable. Presentation state only.
 */
export function Wheel({ def, value, onChange, height = 84 }: WheelProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  const setFromClientY = useCallback(
    (clientY: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      onChange(clamp(1 - (clientY - rect.top) / rect.height));
    },
    [onChange],
  );

  const recenterIfNeeded = useCallback(() => {
    if (def.centered) onChange(0.5);
  }, [def.centered, onChange]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = 0.05;
      let next: number | null = null;
      if (e.key === 'ArrowUp') next = clamp(value + step);
      else if (e.key === 'ArrowDown') next = clamp(value - step);
      else if (e.key === 'Home') next = 1;
      else if (e.key === 'End') next = 0;
      else if (e.key === 'Enter' && def.centered) next = 0.5;
      if (next !== null) {
        e.preventDefault();
        onChange(next);
      }
    },
    [value, onChange, def.centered],
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

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = false;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      recenterIfNeeded();
    },
    [recenterIfNeeded],
  );

  const pct = Math.round(value * 100);
  const capBottom = value * (height - 26);

  return (
    <div className={`ctl ctl-wheel ${def.centered ? 'pitch' : 'mod'}`}>
      <div
        ref={trackRef}
        className="wheel-track"
        role="slider"
        tabIndex={0}
        aria-label={def.name}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={def.centered ? `${pct - 50 > 0 ? '+' : ''}${pct - 50}%` : `${pct}%`}
        data-control-id={def.id}
        style={{ height }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="wheel-cap" style={{ bottom: capBottom }} />
      </div>
      {def.caption ? <span className="ctl-caption">{def.caption}</span> : null}
    </div>
  );
}
