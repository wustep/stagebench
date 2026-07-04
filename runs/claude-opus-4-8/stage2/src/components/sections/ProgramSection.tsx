import type { ControlApi } from '../../hooks/useControls';
import { ControlView } from '../controls/ControlView';
import { Group } from '../Group';
import { Oled } from '../Oled';

/**
 * Program & Morph section — red/dark central control area. Landmarks: MORPH
 * ASSIGN trio, STORE / STORE AS, the primary program OLED (one of only two),
 * large program dial, PAGE/CAT, LIVE MODE, LAYER SCENE, SPLIT/TRANSP/PANIC,
 * and the eight program buttons.
 */
export function ProgramSection({ ctl }: { ctl: ControlApi }) {
  const programButtons = Array.from({ length: 8 }, (_, i) => `program-button-${i + 1}`);
  return (
    <section className="deck-section program central" aria-label="Program and morph">
      <Group title="MORPH ASSIGN" className="morph-assign">
        <ControlView id="program-morph-wheel" ctl={ctl} led="green" buttonVariant="square" />
        <ControlView id="program-morph-at" ctl={ctl} buttonVariant="square" />
        <ControlView id="program-morph-ctrlped" ctl={ctl} buttonVariant="square" />
      </Group>

      <div className="program-mid">
        <div className="program-store-col">
          <ControlView id="program-store" ctl={ctl} led="amber" buttonVariant="pill" />
          <ControlView id="program-store-as" ctl={ctl} buttonVariant="pill" />
          <ControlView id="program-dial" ctl={ctl} />
        </div>
        <Oled variant="program" />
      </div>

      <div className="program-nav">
        <ControlView id="program-page-left" ctl={ctl} buttonVariant="square" />
        <ControlView id="program-page-right" ctl={ctl} buttonVariant="square" />
        <ControlView id="program-live-mode" ctl={ctl} led="green" buttonVariant="grey" />
        <ControlView id="program-num-pad" ctl={ctl} buttonVariant="square" />
      </div>

      <div className="program-scene-row">
        <ControlView id="program-layer-scene" ctl={ctl} />
        <ControlView id="program-split" ctl={ctl} led="amber" buttonVariant="square" />
        <ControlView id="program-transpose" ctl={ctl} buttonVariant="square" />
        <ControlView id="program-panic" ctl={ctl} buttonVariant="square" />
      </div>

      <Group title="PROGRAM" className="program-buttons">
        {programButtons.map((id) => (
          <ControlView key={id} id={id} ctl={ctl} buttonVariant="square" />
        ))}
      </Group>
    </section>
  );
}
