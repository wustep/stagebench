/**
 * Decorative hardware controls. Every visible physical input renders here:
 * knobs/dials rotate, buttons light, faders/drawbars/wheels/stick slide.
 * All interaction updates presentation state only (see state/stage.tsx).
 */

import { useStage } from '../state/stage';
import type { ControlKind, ControlModel } from '../hardware/sections';

function roleFor(kind: ControlKind): string {
  switch (kind) {
    case 'button':
      return 'button';
    case 'knob':
    case 'dial':
    case 'fader':
    case 'drawbar':
    case 'wheel':
    case 'stick':
      return 'slider';
    case 'display':
      return 'status';
  }
}

function KnobFace({ control, value }: { control: ControlModel; value: number }) {
  const steps = Math.max(2, control.steps ?? 11);
  const angle = -135 + (value / (steps - 1)) * 270;
  return (
    <span className={`ctl-knobface ${control.kind === 'dial' ? 'ctl-dialface' : ''}`} aria-hidden="true">
      <span className="ctl-pointer" style={{ transform: `rotate(${angle}deg)` }} />
    </span>
  );
}

function SliderFace({ control, value }: { control: ControlModel; value: number }) {
  const steps = Math.max(2, control.steps ?? 11);
  const pct = steps <= 1 ? 0 : (value / (steps - 1)) * 100;
  if (control.kind === 'drawbar') {
    return (
      <span className="ctl-drawtrack" aria-hidden="true">
        <span className="ctl-drawcap" style={{ bottom: `${8 + (pct / 100) * 72}%` }} />
      </span>
    );
  }
  if (control.kind === 'wheel' || control.kind === 'stick') {
    return (
      <span className="ctl-wheeltrack" aria-hidden="true">
        <span className="ctl-wheelcap" style={{ bottom: `${4 + (pct / 100) * 80}%` }} />
      </span>
    );
  }
  return (
    <span className="ctl-fadetrack" aria-hidden="true">
      <span className="ctl-fadecap" style={{ bottom: `${6 + (pct / 100) * 76}%` }} />
    </span>
  );
}

function LedLadder({ value, steps }: { value: number; steps: number }) {
  return (
    <span className="ctl-leds" aria-hidden="true">
      {Array.from({ length: steps }, (_, i) => (
        <i key={i} className={i <= value ? 'on' : ''} />
      ))}
    </span>
  );
}

export function DecorativeControl({ control }: { control: ControlModel }) {
  const { valueOf, interact } = useStage();
  const value = valueOf(control.id);

  if (control.kind === 'display') {
    const primary = control.id === 'program-display' || control.id === 'synth-display';
    return (
      <div
        id={control.id}
        data-testid={control.id}
        data-kind="display"
        data-primary-oled={primary ? 'true' : 'false'}
        className={`ctl-oled${primary ? ' primary' : ' aux'}`}
        role={roleFor(control.kind)}
        aria-label={control.label}
      >
        {control.text}
      </div>
    );
  }

  const steps = Math.max(2, control.steps ?? 2);
  const isButton = control.kind === 'button';
  const pressed = isButton ? value > 0 : undefined;
  const sliderProps = isButton
    ? {}
    : { 'aria-valuemin': 0, 'aria-valuemax': steps - 1, 'aria-valuenow': value };

  const activate = (direction: 1 | -1 = 1) => interact(control.id, direction);

  return (
    <div className={`ctl ctl-${control.kind}${isButton && pressed ? ' lit' : ''}`}>
      <div
        id={control.id}
        data-testid={control.id}
        data-kind={control.kind}
        role={roleFor(control.kind)}
        tabIndex={0}
        aria-label={control.label}
        aria-pressed={isButton ? pressed : undefined}
        {...sliderProps}
        data-value={value}
        className="ctl-hit"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          activate(e.shiftKey ? -1 : 1);
        }}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            activate(1);
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault();
            activate(1);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            activate(-1);
          } else if (e.key === 'Home') {
            e.preventDefault();
            activate(-1);
          }
        }}
      >
        {control.kind === 'knob' || control.kind === 'dial' ? (
          <KnobFace control={control} value={value} />
        ) : control.kind === 'button' ? (
          <span className="ctl-btnface" aria-hidden="true">
            <span className={`ctl-led${pressed ? ' on' : ''}`} />
          </span>
        ) : (
          <SliderFace control={control} value={value} />
        )}
      </div>
      {(control.kind === 'fader' || control.id.endsWith('level-a') || control.id.endsWith('level-b')) &&
      control.kind !== 'drawbar' ? (
        <LedLadder value={value} steps={Math.min(steps, 5)} />
      ) : null}
      <span className="ctl-legend" aria-hidden="true">
        {control.label}
      </span>
    </div>
  );
}
