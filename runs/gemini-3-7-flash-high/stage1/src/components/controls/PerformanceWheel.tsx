import React, { useState, useRef, useCallback } from 'react';

interface PitchStickProps {
  id: string;
  value: number; // -1 to +1
  onChange: (val: number) => void;
}

export const PitchStick: React.FC<PitchStickProps> = ({ id, value, onChange }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (typeof (e.target as HTMLElement).setPointerCapture === 'function') {
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Safe
      }
    }
    setIsDragging(true);
    startXRef.current = e.clientX;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startXRef.current;
    const nextVal = Math.max(-1, Math.min(1, dx / 40));
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
      // Wooden pitch stick returns to center
      onChange(0);
    }
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        onChange(-0.5);
      } else if (e.key === 'ArrowRight') {
        onChange(0.5);
      }
    },
    [onChange]
  );

  const handleKeyUp = useCallback(() => {
    onChange(0);
  }, [onChange]);

  return (
    <div className="control-wrapper pitch-stick-wrapper">
      <span className="control-label" id={`${id}-label`}>PITCH STICK</span>
      <div
        id={id}
        role="slider"
        tabIndex={0}
        aria-labelledby={`${id}-label`}
        aria-label="Pitch Stick"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Math.round(value * 100) / 100}
        className="pitch-stick-well"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      >
        <div
          className="pitch-stick-lever"
          style={{ transform: `rotate(${value * 25}deg)` }}
        />
      </div>
    </div>
  );
};

interface ModWheelProps {
  id: string;
  value: number; // 0 to 1
  onChange: (val: number) => void;
}

export const ModWheel: React.FC<ModWheelProps> = ({ id, value, onChange }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const startValRef = useRef(value);

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
    const dy = startYRef.current - e.clientY; // drag up increases
    const delta = dy / 80;
    const nextVal = Math.max(0, Math.min(1, startValRef.current + delta));
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
      if (e.key === 'ArrowUp') delta = 0.1;
      else if (e.key === 'ArrowDown') delta = -0.1;
      else if (e.key === 'Home') delta = -1;
      else if (e.key === 'End') delta = 1;
      else return;

      e.preventDefault();
      onChange(Math.max(0, Math.min(1, value + delta)));
    },
    [value, onChange]
  );

  return (
    <div className="control-wrapper mod-wheel-wrapper">
      <span className="control-label" id={`${id}-label`}>MOD WHEEL</span>
      <div
        id={id}
        role="slider"
        tabIndex={0}
        aria-labelledby={`${id}-label`}
        aria-label="Modulation Wheel"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.round(value * 100) / 100}
        className="mod-wheel-well"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <div
          className="mod-wheel-rim"
          style={{ transform: `rotate(${-value * 50}deg)` }}
        >
          <div className="mod-wheel-ridges" />
        </div>
      </div>
    </div>
  );
};
