import type { HardwareControl as HardwareControlData } from '../hardware';

interface HardwareControlProps {
  control: HardwareControlData;
  value: number | boolean;
  onChange: (id: string, value: number | boolean) => void;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function HardwareControl({ control, value, onChange }: HardwareControlProps) {
  if (control.kind === 'display') return null;
  if (control.kind === 'button' || control.kind === 'led') {
    const active = Boolean(value);
    return (
      <button
        type="button"
        className={`hardware-button ${control.kind === 'led' ? 'led-button' : ''} accent-${control.accent ?? 'red'} ${active ? 'is-active' : ''}`}
        aria-pressed={active}
        aria-label={control.label}
        onClick={() => onChange(control.id, !active)}
      >
        <span className="button-led" aria-hidden="true" />
        <span>{control.label}</span>
      </button>
    );
  }

  const numericValue = typeof value === 'number' ? value : 0;
  const rotation = -132 + numericValue * 264;
  const isFader = control.kind === 'fader';
  const inputLabel = `${control.label}, ${Math.round(numericValue * 100)} percent`;
  return (
    <div className={`hardware-control ${isFader ? 'fader-control' : 'knob-control'}`}>
      {isFader ? (
        <div className="fader-track">
          <span className="fader-ticks" aria-hidden="true" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={numericValue}
            aria-label={inputLabel}
            onChange={(event) => onChange(control.id, clamp(Number(event.target.value)))}
          />
          <span className="fader-cap" style={{ bottom: `${numericValue * 78 + 6}%` }} aria-hidden="true" />
        </div>
      ) : (
        <div
          className="knob-shell"
          style={{ '--knob-rotation': `${rotation}deg` } as React.CSSProperties}
          role="slider"
          tabIndex={0}
          aria-label={inputLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(numericValue * 100)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.dataset.startY = String(event.clientY);
            event.currentTarget.dataset.startValue = String(numericValue);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const startY = Number(event.currentTarget.dataset.startY ?? event.clientY);
            const startValue = Number(event.currentTarget.dataset.startValue ?? numericValue);
            onChange(control.id, clamp(startValue + (startY - event.clientY) / 140));
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
              event.preventDefault();
              onChange(control.id, clamp(numericValue + 0.05));
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
              event.preventDefault();
              onChange(control.id, clamp(numericValue - 0.05));
            }
          }}
        >
          <span className="knob-mark" aria-hidden="true" />
        </div>
      )}
      <span className="control-label">{control.label}</span>
    </div>
  );
}
