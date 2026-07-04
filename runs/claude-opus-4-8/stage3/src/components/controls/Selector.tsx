import type { ControlDef } from '../../model/controls';

interface SelectorProps {
  def: ControlDef;
  index: number;
  onCycle: (direction: 1 | -1) => void;
}

/**
 * Decorative selector: a button that cycles a fixed list, with an LED column
 * showing the active option. Presented as an ARIA listbox-like control via a
 * button that advances the selection and announces the current option.
 * Presentation state only.
 */
export function Selector({ def, index, onCycle }: SelectorProps) {
  const options = def.options ?? [];
  const current = options[index] ?? '';

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      onCycle(1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onCycle(-1);
    }
  };

  return (
    <div className="ctl ctl-selector">
      {def.caption ? <span className="ctl-caption top">{def.caption}</span> : null}
      <div className="selector-body">
        <ul className="selector-leds" aria-hidden="true">
          {options.map((opt, i) => (
            <li key={opt} className={i === index ? 'active' : ''}>
              <span className={`sel-led ${i === index ? 'on' : ''}`} />
              <span className="sel-label">{opt}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="panel-btn square selector-btn"
          aria-label={`${def.name}: ${current}`}
          data-control-id={def.id}
          onClick={() => onCycle(1)}
          onKeyDown={onKeyDown}
        >
          <span className="btn-face" />
        </button>
      </div>
    </div>
  );
}
