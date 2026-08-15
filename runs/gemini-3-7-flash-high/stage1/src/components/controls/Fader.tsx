import React, { useState, useRef, useCallback } from 'react';

interface FaderProps {
  id: string;
  label: string;
  value: number; // 0..10
  min?: number;
  max?: number;
  step?: number;
  hasLedLadder?: boolean;
  ledCount?: number;
  subLabel?: string;
  onChange: (val: number) => void;
}

export const Fader: React.FC<FaderProps> = ({
  id,
  label,
  value,
  min = 0,
  max = 10,
  step = 0.5,
  hasLedLadder = true,
  ledCount = 8,
  subLabel,
  onChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));

  const updateFromPointer = (clientY: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect?.() || { bottom: 100, height: 60 };
    const ratio = rect.height > 0 ? (rect.bottom - clientY) / rect.height : 0.5;
    const clamped = Math.max(0, Math.min(1, ratio));
    const nextVal = min + clamped * (max - min);
    const rounded = Math.round(nextVal / step) * step;
    onChange(Math.max(min, Math.min(max, rounded)));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (typeof (e.target as HTMLElement).setPointerCapture === 'function') {
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Safe
      }
    }
    setIsDragging(true);
    updateFromPointer(e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    updateFromPointer(e.clientY);
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
        delta = step;
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        delta = -step;
      } else if (e.key === 'PageUp') {
        delta = step * 2;
      } else if (e.key === 'PageDown') {
        delta = -step * 2;
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

  return (
    <div className="control-wrapper fader-wrapper">
      <span className="control-label" id={`${id}-label`}>{label}</span>
      <div className="fader-container">
        {hasLedLadder && (
          <div className="fader-led-ladder" aria-hidden="true">
            {Array.from({ length: ledCount }).map((_, idx) => {
              // Ladder goes bottom to top
              const ledThresh = (idx + 1) / ledCount;
              const isLit = norm >= ledThresh - 0.05;
              const isPeak = idx === ledCount - 1;
              return (
                <div
                  key={idx}
                  className={`fader-led ${isLit ? (isPeak ? 'led-red-lit' : 'led-amber-lit') : ''}`}
                />
              );
            })}
          </div>
        )}
        <div
          id={id}
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-labelledby={`${id}-label`}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Math.round(value * 10) / 10}
          className={`fader-track ${isDragging ? 'dragging' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyDown={handleKeyDown}
        >
          <div className="fader-slot" />
          <div
            className="fader-cap"
            style={{ bottom: `calc(${norm * 100}% - 8px)` }}
          >
            <div className="fader-cap-line" />
          </div>
        </div>
      </div>
      {subLabel && <span className="control-sublabel">{subLabel}</span>}
    </div>
  );
};
