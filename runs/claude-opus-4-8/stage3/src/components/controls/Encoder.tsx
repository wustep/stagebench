import { useCallback, useRef, useState } from 'react';
import type { ControlDef } from '../../model/controls';

interface EncoderProps {
  def: ControlDef;
  onStep: (direction: 1 | -1) => void;
  size?: number;
}

/**
 * Endless rotary encoder (the large Program / Model dials). It has no absolute
 * value; turning it emits relative steps. Rendered as a spinbutton with a
 * visible detent that rotates as you step. Accessible + keyboard operable.
 * Presentation state only — steps update a local detent, nothing else.
 */
export function Encoder({ def, onStep, size = 46 }: EncoderProps) {
  const [detent, setDetent] = useState(0);
  const dragging = useRef<{ startY: number; startDetent: number } | null>(null);

  const step = useCallback(
    (dir: 1 | -1) => {
      setDetent((d) => d + dir);
      onStep(dir);
    },
    [onStep],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragging.current = { startY: e.clientY, startDetent: detent };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dy = dragging.current.startY - e.clientY;
    const target = dragging.current.startDetent + Math.round(dy / 18);
    if (target !== detent) {
      const dir: 1 | -1 = target > detent ? 1 : -1;
      const count = Math.abs(target - detent);
      for (let i = 0; i < count; i++) step(dir);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className="ctl ctl-encoder">
      <div
        className="encoder"
        role="spinbutton"
        tabIndex={0}
        aria-label={def.name}
        aria-valuenow={detent}
        data-control-id={def.id}
        style={{ width: size, height: size }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span
          className="encoder-detent"
          style={{ transform: `rotate(${detent * 24}deg)` }}
        />
      </div>
      {def.caption ? <span className="ctl-caption">{def.caption}</span> : null}
    </div>
  );
}
