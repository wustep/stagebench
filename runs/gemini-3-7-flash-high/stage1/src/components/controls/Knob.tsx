import React, { useState, useRef, useCallback } from 'react';

interface KnobProps {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  size?: 'sm' | 'md' | 'lg';
  subLabel?: string;
  onChange: (val: number) => void;
}

export const Knob: React.FC<KnobProps> = ({
  id,
  label,
  value,
  min = 0,
  max = 10,
  step = 0.1,
  size = 'md',
  subLabel,
  onChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const startValRef = useRef(value);

  // Map value to angle (-140 deg to +140 deg = 280 deg range)
  const norm = (value - min) / (max - min);
  const angle = -140 + norm * 280;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (typeof (e.target as HTMLElement).setPointerCapture === 'function') {
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Safe
      }
    }
    setIsDragging(true);
    startYRef.current = e.clientY;
    startValRef.current = value;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dy = startYRef.current - e.clientY; // drag up increases value
    const range = max - min;
    const delta = (dy / 120) * range;
    let nextVal = Math.max(min, Math.min(max, startValRef.current + delta));
    if (step) {
      nextVal = Math.round(nextVal / step) * step;
    }
    onChange(nextVal);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      if (typeof (e.target as HTMLElement).releasePointerCapture === 'function') {
        try {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          // Safe
        }
      }
      setIsDragging(false);
    }
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let delta = 0;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        delta = step * (e.shiftKey ? 5 : 1);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        delta = -step * (e.shiftKey ? 5 : 1);
      } else if (e.key === 'Home') {
        onChange(min);
        e.preventDefault();
        return;
      } else if (e.key === 'End') {
        onChange(max);
        e.preventDefault();
        return;
      } else {
        return;
      }

      e.preventDefault();
      const nextVal = Math.max(min, Math.min(max, value + delta));
      onChange(Math.round(nextVal / step) * step);
    },
    [value, min, max, step, onChange]
  );

  const sizeClass = size === 'lg' ? 'knob-lg' : size === 'sm' ? 'knob-sm' : 'knob-md';

  return (
    <div className={`control-wrapper knob-wrapper ${sizeClass}`}>
      <span className="control-label" id={`${id}-label`}>{label}</span>
      <div
        id={id}
        role="slider"
        tabIndex={0}
        aria-labelledby={`${id}-label`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 10) / 10}
        aria-label={label}
        className={`knob-body ${isDragging ? 'dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <div className="knob-cap" style={{ transform: `rotate(${angle}deg)` }}>
          <div className="knob-indicator" />
        </div>
      </div>
      {subLabel && <span className="control-sublabel">{subLabel}</span>}
    </div>
  );
};
