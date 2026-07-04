import { CONTROLS_BY_ID } from '../../model/controls';
import type { ControlApi } from '../../hooks/useControls';
import { Knob } from './Knob';
import { Fader } from './Fader';
import { Drawbar } from './Drawbar';
import { Button } from './Button';
import { Selector } from './Selector';
import { Encoder } from './Encoder';
import { Wheel } from './Wheel';

interface ControlViewProps {
  id: string;
  ctl: ControlApi;
  /** Extra rendering hints. */
  ledGraph?: boolean;
  led?: 'green' | 'red' | 'amber';
  buttonVariant?: 'pill' | 'square' | 'grey';
}

/**
 * Renders the correct decorative control primitive for a control id, wired to
 * the presentation store. Central dispatch keeps section markup declarative.
 */
export function ControlView({ id, ctl, ledGraph, led, buttonVariant }: ControlViewProps) {
  const def = CONTROLS_BY_ID.get(id);
  if (!def) return null;

  switch (def.kind) {
    case 'knob':
      return <Knob def={def} value={Number(ctl.get(id) ?? 0)} onChange={(v) => ctl.set(id, v)} />;
    case 'fader':
      return (
        <Fader
          def={def}
          value={Number(ctl.get(id) ?? 0)}
          onChange={(v) => ctl.set(id, v)}
          ledGraph={ledGraph}
        />
      );
    case 'drawbar':
      return <Drawbar def={def} value={Number(ctl.get(id) ?? 0)} onChange={(v) => ctl.set(id, v)} />;
    case 'button':
      return (
        <Button
          def={def}
          on={Boolean(ctl.get(id))}
          onToggle={() => ctl.toggle(id)}
          led={led}
          variant={buttonVariant}
        />
      );
    case 'selector':
      return (
        <Selector def={def} index={Number(ctl.get(id) ?? 0)} onCycle={(dir) => ctl.cycle(id, dir)} />
      );
    case 'encoder':
      // Endless dials have no absolute store value; the Encoder tracks its own
      // detent for presentation. onStep is a no-op on shared state by design.
      return <Encoder def={def} onStep={() => {}} />;
    case 'wheel':
      return <Wheel def={def} value={Number(ctl.get(id) ?? 0)} onChange={(v) => ctl.set(id, v)} />;
    default:
      return null;
  }
}
