import React, { useCallback, useState } from 'react';
import { HardwareModel, ControlState, Section } from '../types';
import '../styles/panel.css';

interface ControlPanelProps {
  hardware: HardwareModel;
  onControlChange?: (controlId: string, value: number) => void;
}

interface KnobProps {
  control: ControlState;
  onValueChange: (value: number) => void;
}

function Knob({ control, onValueChange }: KnobProps) {
  const [isDragging, setIsDragging] = useState(false);
  const knobRotation = (control.value || 0) * 270 - 135; // -135 to 135 degrees

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaY = -e.movementY * 0.01; // negative because up should increase
      const newValue = Math.max(0, Math.min(1, (control.value || 0) + deltaY));
      onValueChange(newValue);
    },
    [isDragging, control.value, onValueChange]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div className="control knob">
      <div
        className="knob-visual"
        style={{ transform: `rotate(${knobRotation}deg)` }}
        onMouseDown={handleMouseDown}
        role="slider"
        aria-label={control.label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={control.value || 0}
        tabIndex={0}
      >
        <div className="knob-indicator" />
      </div>
      <label className="control-label">{control.label}</label>
    </div>
  );
}

interface FaderProps {
  control: ControlState;
  onValueChange: (value: number) => void;
}

function Fader({ control, onValueChange }: FaderProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onValueChange(parseFloat(e.target.value));
    },
    [onValueChange]
  );

  return (
    <div className="control fader">
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={control.value || 0}
        onChange={handleChange}
        className="fader-input"
        aria-label={control.label}
      />
      <label className="control-label">{control.label}</label>
    </div>
  );
}

interface ButtonProps {
  control: ControlState;
  onValueChange: (value: number) => void;
}

function Button({ control, onValueChange }: ButtonProps) {
  const isActive = (control.value || 0) > 0.5;

  const handleClick = useCallback(() => {
    onValueChange(isActive ? 0 : 1);
  }, [isActive, onValueChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick]
  );

  return (
    <div className="control button">
      <button
        className={`button-visual ${isActive ? 'active' : ''}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={control.label}
        aria-pressed={isActive}
      />
      <label className="control-label">{control.label}</label>
    </div>
  );
}

interface DrawbarProps {
  control: ControlState;
  onValueChange: (value: number) => void;
}

function Drawbar({ control, onValueChange }: DrawbarProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onValueChange(parseFloat(e.target.value));
    },
    [onValueChange]
  );

  return (
    <div className="control drawbar">
      <div className="drawbar-visual">
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={control.value || 0.5}
          onChange={handleChange}
          className="drawbar-input"
          aria-label={control.label}
          style={{ writingMode: 'bt-lr' } as unknown as React.CSSProperties}
        />
        <div className="drawbar-bar" style={{ height: `${(control.value || 0.5) * 100}%` }} />
      </div>
      <label className="control-label">{control.label}</label>
    </div>
  );
}

interface EncoderProps {
  control: ControlState;
  onValueChange: (value: number) => void;
}

function Encoder({ control, onValueChange }: EncoderProps) {
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      const newValue = Math.max(0, Math.min(1, (control.value || 0) + delta));
      onValueChange(newValue);
    },
    [control.value, onValueChange]
  );

  return (
    <div className="control encoder" onWheel={handleWheel}>
      <div className="encoder-visual" role="slider" aria-label={control.label} tabIndex={0}>
        {control.label}
      </div>
      <label className="control-label">{control.label}</label>
    </div>
  );
}

interface SectionProps {
  section: Section;
  onControlChange: (controlId: string, value: number) => void;
}

function ControlSection({ section, onControlChange }: SectionProps) {
  return (
    <div className={`section ${section.id}`} style={{ flex: section.fraction }}>
      <h2 className="section-label">{section.label}</h2>
      <div className="controls-grid">
        {section.controls.map((control: ControlState) => {
          const componentProps = {
            control,
            onValueChange: (value: number) => onControlChange(control.id, value),
          };

          switch (control.type) {
            case 'knob':
              return <Knob key={control.id} {...componentProps} />;
            case 'fader':
              return <Fader key={control.id} {...componentProps} />;
            case 'button':
              return <Button key={control.id} {...componentProps} />;
            case 'drawbar':
              return <Drawbar key={control.id} {...componentProps} />;
            case 'encoder':
              return <Encoder key={control.id} {...componentProps} />;
            case 'wheel':
              return <Knob key={control.id} {...componentProps} />;
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  hardware,
  onControlChange = () => {},
}) => {
  return (
    <div className="control-deck" role="group" aria-label="Control deck">
      {hardware.sections.map((section) => (
        <ControlSection
          key={section.id}
          section={section}
          onControlChange={onControlChange}
        />
      ))}
    </div>
  );
};
