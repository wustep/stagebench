import type { ControlApi } from '../../hooks/useControls';
import { ControlView } from '../controls/ControlView';
import { Group } from '../Group';
import { SectionHeader } from './SectionHeader';

/**
 * Organ section — dark inset plate. Landmarks: two level faders with LED graphs,
 * ORGAN MODEL / VIB-CHORUS / B3 PERCUSSION groups, nine drawbars with LED
 * ladders, octave shift, sustped/pstick. No wide OLED.
 */
export function OrganSection({ ctl }: { ctl: ControlApi }) {
  const drawbars = Array.from({ length: 9 }, (_, i) => `organ-drawbar-${i + 1}`);
  return (
    <section className="deck-section organ inset" aria-label="Organ">
      <SectionHeader title="ORGAN" ctl={ctl} onId="organ-on" soloId="organ-solo" fxFocus />
      <div className="organ-body">
        <div className="organ-left">
          <div className="fader-pair">
            <ControlView id="organ-level-a" ctl={ctl} ledGraph />
            <ControlView id="organ-level-b" ctl={ctl} ledGraph />
          </div>
          <div className="layer-row">
            <ControlView id="organ-on-off-a" ctl={ctl} led="green" buttonVariant="grey" />
            <ControlView id="organ-on-off-b" ctl={ctl} led="green" buttonVariant="grey" />
          </div>
          <div className="layer-row">
            <ControlView id="organ-sustped" ctl={ctl} />
            <ControlView id="organ-pstick" ctl={ctl} />
          </div>
          <ControlView id="organ-preset" ctl={ctl} />
          <div className="octave-row">
            <ControlView id="organ-octave-down" ctl={ctl} buttonVariant="grey" />
            <ControlView id="organ-octave-up" ctl={ctl} buttonVariant="grey" />
          </div>
        </div>

        <div className="organ-right">
          <div className="organ-top-groups">
            <Group title="ORGAN MODEL">
              <ControlView id="organ-model" ctl={ctl} />
            </Group>
            <Group title="VIB/CHORUS">
              <ControlView id="organ-vib-chorus" ctl={ctl} />
              <ControlView id="organ-vib-on" ctl={ctl} led="red" buttonVariant="grey" />
            </Group>
            <Group title="B3 PERCUSSION">
              <div className="perc-buttons">
                <ControlView id="organ-perc-volume" ctl={ctl} />
                <ControlView id="organ-perc-decay" ctl={ctl} />
                <ControlView id="organ-perc-harmonic" ctl={ctl} />
              </div>
              <ControlView id="organ-perc-on" ctl={ctl} led="red" buttonVariant="grey" />
            </Group>
          </div>
          <div className="drawbar-bank">
            {drawbars.map((id) => (
              <ControlView key={id} id={id} ctl={ctl} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
