import React from 'react';

interface ButtonProps {
  id: string;
  label: string;
  subLabel?: string;
  active?: boolean;
  ledColor?: 'red' | 'green' | 'amber';
  shape?: 'round' | 'rect' | 'soft-rect';
  hasLed?: boolean;
  title?: string;
  onClick: () => void;
}

export const Button: React.FC<ButtonProps> = ({
  id,
  label,
  subLabel,
  active = false,
  ledColor = 'red',
  shape = 'soft-rect',
  hasLed = true,
  title,
  onClick,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div className="control-wrapper button-wrapper">
      {hasLed && (
        <div className={`button-led led-${ledColor} ${active ? 'active' : ''}`} aria-hidden="true" />
      )}
      <button
        id={id}
        type="button"
        role="button"
        aria-pressed={active}
        aria-label={subLabel ? `${label} ${subLabel}` : label}
        title={title}
        className={`nord-button nord-button-${shape} ${active ? 'btn-active' : ''}`}
        onClick={onClick}
        onKeyDown={handleKeyDown}
      >
        <span className="btn-label-main">{label}</span>
      </button>
      {subLabel && <span className="control-sublabel">{subLabel}</span>}
    </div>
  );
};
