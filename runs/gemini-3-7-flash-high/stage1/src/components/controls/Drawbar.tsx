import React, { useState, useRef, useCallback } from 'react';

interface DrawbarProps {
  id: string;
  harmonic: string;
  value: number; // 0..8
  colorClass: 'brown' | 'white' | 'black';
  onChange: (val: number) => void;
}

export const Drawbar: React.FC<DrawbarProps> = ({
  id,
  harmonic,
  value,
  colorClass,
  onChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const norm = value / 8;

  const updateFromPointer = (clientY: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect?.() || { top: 0, height: 90 };
    const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
    const clamped = Math.max(0, Math.min(1, ratio));
    const nextVal = Math.round(clamped * 8);
    onChange(nextVal);
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
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        delta = 1;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        delta = -1;
      } else if (e.key === 'Home') {
        onChange(0);
        e.preventDefault();
        return;
      } else if (e.key === 'End') {
        onChange(8);
        e.preventDefault();
        return;
      } else {
        return;
      }

      e.preventDefault();
      const nextVal = Math.max(0, Math.min(8, value + delta));
      onChange(nextVal);
    },
    [value, onChange]
  );

  return (
    <div className="control-wrapper drawbar-wrapper">
      <span className="drawbar-harmonic" id={`${id}-label`}>{harmonic}</span>
      <div className="drawbar-body-container">
        {/* LED Ladder beside the drawbar */}
        <div className="drawbar-led-ladder" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, idx) => {
            const step = idx + 1;
            const isLit = value >= step;
            return (
              <div
                key={idx}
                className={`drawbar-led ${isLit ? 'led-red-lit' : ''}`}
              />
            );
          })}
        </div>
        <div
          id={id}
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-labelledby={`${id}-label`}
          aria-label={`Drawbar ${harmonic}`}
          aria-valuemin={0}
          aria-valuemax={8}
          aria-valuenow={value}
          className={`drawbar-track ${isDragging ? 'dragging' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyDown={handleKeyDown}
        >
          <div className="drawbar-slot" />
          <div
            className={`drawbar-cap drawbar-cap-${colorClass}`}
            style={{ top: `calc(${norm * 100}% - 12px)` }}
          >
            <span className="drawbar-cap-num">{value}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
