/**
 * Decorative hardware controls. Every visible physical input renders here:
 * knobs/dials rotate, buttons light, faders/drawbars/wheels/stick slide.
 * All interaction updates presentation state only (see state/stage.tsx) —
 * except the Phase 2 bridged controls listed in `BRIDGED_CONTROLS`, which
 * additionally drive audible engine state through an injected bridge
 * (the same movement updates both the presentation store and the audio
 * engine, so panel feedback and sound never disagree).
 */

import { useStage } from '../state/stage';
import { usePianoFxBridge } from '../state/pianoFx';
import { usePhase3Bridge } from '../state/bridges';
import type { ControlKind, ControlModel } from '../hardware/sections';

/**
 * Phase 1 control IDs that became functional in Phase 2. The decorated
 * hardware keeps its exact DOM position/role; its movement now also drives
 * the StageEngine. Everything else stays presentation-only.
 */
export const BRIDGED_CONTROLS: Record<string, 'master' | 'pitch' | 'rotary-speed' | 'rotary-stop' | 'rotary-drive'> = {
  'perf-master-level': 'master',
  'perf-pitch-stick': 'pitch',
  'perf-rotary-speed': 'rotary-speed',
  'perf-rotary-stop': 'rotary-stop',
  'perf-rotary-drive': 'rotary-drive',
};

/**
 * Phase 3 bridged IDs: every non-excluded hardware control drives canonical
 * state through `usePhase3Bridge` (same movement moves knob + sound). The
 * only decorative ID left is `program-morph-3` (Aftertouch, spec-excluded).
 */
export const PHASE3_BRIDGED_IDS = new Set([
  'perf-mod-wheel',
  'organ-drawbar-1',
  'organ-drawbar-2',
  'organ-drawbar-3',
  'organ-drawbar-4',
  'organ-drawbar-5',
  'organ-drawbar-6',
  'organ-drawbar-7',
  'organ-drawbar-8',
  'organ-drawbar-9',
  'organ-volume',
  'organ-perc-1',
  'organ-perc-2',
  'organ-perc-3',
  'organ-perc-4',
  'organ-model-1',
  'organ-model-2',
  'organ-model-3',
  'organ-model-4',
  'organ-model-5',
  'organ-vib-1',
  'organ-vib-2',
  'organ-vib-3',
  'organ-vib-4',
  'organ-vib-5',
  'organ-on-a',
  'organ-on-b',
  'organ-level-a',
  'organ-level-b',
  'piano-level-a',
  'piano-level-b',
  'piano-on',
  'piano-type-1',
  'piano-type-2',
  'piano-type-3',
  'piano-type-4',
  'piano-type-5',
  'piano-type-6',
  'piano-model',
  'piano-timbre',
  'piano-detail-1',
  'piano-detail-2',
  'piano-detail-3',
  'piano-detail-4',
  'piano-detail-5',
  'piano-detail-6',
  'piano-octave',
  'program-dial',
  'program-slot-1',
  'program-slot-2',
  'program-slot-3',
  'program-slot-4',
  'program-slot-5',
  'program-slot-6',
  'program-slot-7',
  'program-slot-8',
  'program-fn-1',
  'program-fn-2',
  'program-fn-3',
  'program-fn-4',
  'program-fn-5',
  'program-fn-6',
  'program-fn-7',
  'program-fn-8',
  'program-fn-9',
  'program-fn-10',
  'program-morph-1',
  'program-morph-2',
  'synth-level-a',
  'synth-level-b',
  'synth-osc-wave',
  'synth-osc-shape',
  'synth-osc-oct',
  'synth-filter-cutoff',
  'synth-filter-res',
  'synth-filter-env',
  'synth-amp-attack',
  'synth-amp-decay',
  'synth-amp-sustain',
  'synth-amp-release',
  'synth-lfo-rate',
  'synth-lfo-amount',
  'synth-fn-1',
  'synth-fn-2',
  'synth-fn-3',
  'synth-fn-4',
  'synth-fn-5',
  'synth-fn-6',
  'fx-organ-amount',
  'fx-organ-rate',
  'fx-piano-amount',
  'fx-piano-rate',
  'fx-organ-focus-a',
  'fx-organ-focus-b',
  'fx-delay-time',
  'fx-delay-feedback',
  'fx-reverb-decay',
  'fx-amp-drive',
  'fx-eq-treble',
  'fx-comp-amount',
  'fx-on-1',
  'fx-on-2',
  'fx-on-3',
  'fx-on-4',
  'fx-on-5',
  'fx-on-6',
  'fx-on-7',
]);

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
  const bridge = usePianoFxBridge();
  const bridge3 = usePhase3Bridge();
  const bridgeKind = bridge ? BRIDGED_CONTROLS[control.id] : undefined;
  const phase3Kind = bridge3 && !bridgeKind ? (PHASE3_BRIDGED_IDS.has(control.id) ? true : undefined) : undefined;
  // Bridged controls mirror audible state (master level, pitch position,
  // rotary speed/drive) instead of the presentation store.
  const value = bridgeKind
    ? (bridge!.valueOf(control.id) ?? valueOf(control.id))
    : phase3Kind
      ? (bridge3!.valueOf(control.id) ?? valueOf(control.id))
      : valueOf(control.id);
  const morphed = bridge3?.isMorphed(control.id) ?? false;

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

  const activate = (direction: 1 | -1 = 1) => {
    if (bridgeKind) {
      bridge!.interact(control.id, direction);
      return;
    }
    if (phase3Kind) {
      bridge3!.interact(control.id, direction);
      return;
    }
    interact(control.id, direction);
  };

  return (
    <div className={`ctl ctl-${control.kind}${isButton && pressed ? ' lit' : ''}${morphed ? ' morphed' : ''}`}>
      <div
        id={control.id}
        data-testid={control.id}
        data-kind={control.kind}
        data-morph={morphed ? 'true' : 'false'}
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
