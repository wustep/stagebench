import type { ControlDef } from '../../model/controls';

interface ButtonProps {
  def: ControlDef;
  on: boolean;
  onToggle: () => void;
  /** Optional LED accent color class ("green" | "red" | "amber"). */
  led?: 'green' | 'red' | 'amber';
  /** Visual style: pill push-button or square. */
  variant?: 'pill' | 'square' | 'grey';
}

/**
 * Decorative panel button. A real toggle button (aria-pressed) with a status
 * LED. Pressing lights the LED and flips presentation state only.
 */
export function Button({ def, on, onToggle, led = 'red', variant = 'pill' }: ButtonProps) {
  return (
    <div className="ctl ctl-button">
      <span className={`btn-led ${led} ${on ? 'on' : ''}`} aria-hidden="true" />
      <button
        type="button"
        className={`panel-btn ${variant} ${on ? 'pressed' : ''}`}
        aria-pressed={on}
        aria-label={def.name}
        data-control-id={def.id}
        onClick={onToggle}
      >
        <span className="btn-face" />
      </button>
      {def.caption ? <span className="ctl-caption">{def.caption}</span> : null}
    </div>
  );
}
