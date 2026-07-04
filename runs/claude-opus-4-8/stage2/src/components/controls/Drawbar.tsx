import { useCallback, useRef } from 'react';
import type { ControlDef } from '../../model/controls';

interface DrawbarProps {
  def: ControlDef;
  value: number; // 0..8
  onChange: (value: number) => void;
}

const MAX = 8;

/**
 * Organ drawbar with a 1..8 LED graph. Pulled "out" (higher value) means the
 * cap sits lower toward the player, matching a real drawbar. Accessible slider,
 * keyboard + drag operable, presentation state only.
 */
export function Drawbar({ def, value, onChange }: DrawbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const clamp = (v: number) => Math.max(0, Math.min(MAX, Math.round(v)));

  const setFromClientY = useCallback(
    (clientY: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Top of the track = 0 (pushed in), bottom = 8 (pulled out).
      const ratio = (clientY - rect.top) / rect.height;
      onChange(clamp(ratio * MAX));
    },
    [onChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let next: number | null = null;
      if (e.key === 'ArrowUp') next = clamp(value - 1);
      else if (e.key === 'ArrowDown') next = clamp(value + 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = MAX;
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

  // Cap travel: value 0 -> top, value 8 -> ~66% down (leaving room for graph).
  const capTop = (value / MAX) * 62;
  // Drawbar cap color pattern from the reference: white for octave feet, black otherwise.
  const isWhiteCap = def.id.endsWith('-1') || def.id.endsWith('-3') || def.id.endsWith('-4') || def.id.endsWith('-6') || def.id.endsWith('-9');

  return (
    <div className="ctl ctl-drawbar">
      <div className="drawbar-graph" aria-hidden="true">
        {Array.from({ length: MAX }).map((_, i) => (
          <span key={i} className={`db-seg ${i + 1 <= value ? 'on' : ''}`} />
        ))}
      </div>
      <div
        ref={trackRef}
        className="drawbar-track"
        role="slider"
        tabIndex={0}
        aria-label={def.name}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={MAX}
        aria-valuenow={value}
        aria-valuetext={`${value} of ${MAX}`}
        data-control-id={def.id}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span
          className={`drawbar-cap ${isWhiteCap ? 'white' : 'black'}`}
          style={{ top: `${capTop}%` }}
        >
          {value}
        </span>
      </div>
      {def.caption ? <span className="ctl-caption db-caption">{def.caption}</span> : null}
    </div>
  );
}
