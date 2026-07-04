import type { ControlApi } from '../../hooks/useControls';
import { ControlView } from '../controls/ControlView';
import { Group } from '../Group';
import { SectionHeader } from './SectionHeader';

/**
 * Piano section — dark inset plate. Landmarks: two level faders with LED graphs,
 * ACOUSTICS / UNISON, KB TOUCH / DYN COMP, TIMBRE, PIANO SELECT (type selector +
 * model dial), octave shift. No drawbar bank, no wide OLED.
 */
export function PianoSection({ ctl, onOctave }: { ctl: ControlApi; onOctave?: (dir: 1 | -1) => void }) {
  return (
    <section className="deck-section piano inset" aria-label="Piano">
      <SectionHeader title="PIANO" ctl={ctl} onId="piano-on" soloId="piano-solo" fxFocus />
      <div className="piano-body">
        <div className="piano-left">
          <div className="fader-pair">
            <ControlView id="piano-level-a" ctl={ctl} ledGraph />
            <ControlView id="piano-level-b" ctl={ctl} ledGraph />
          </div>
          <div className="layer-row">
            <ControlView id="piano-on-off-a" ctl={ctl} led="green" buttonVariant="grey" />
            <ControlView id="piano-on-off-b" ctl={ctl} led="green" buttonVariant="grey" />
          </div>
          <div className="layer-row">
            <ControlView id="piano-sustped" ctl={ctl} />
            <ControlView id="piano-pstick" ctl={ctl} />
          </div>
          <div className="octave-row">
            <ControlView id="piano-octave-down" ctl={ctl} buttonVariant="grey" onPress={() => onOctave?.(-1)} />
            <ControlView id="piano-octave-up" ctl={ctl} buttonVariant="grey" onPress={() => onOctave?.(1)} />
          </div>
        </div>

        <div className="piano-right">
          <div className="piano-top-row">
            <Group title="ACOUSTICS">
              <ControlView id="piano-soft-rel" ctl={ctl} />
              <ControlView id="piano-string-res" ctl={ctl} />
              <ControlView id="piano-ped-noise" ctl={ctl} />
            </Group>
            <ControlView id="piano-unison" ctl={ctl} />
          </div>
          <div className="piano-mid-row">
            <ControlView id="piano-kb-touch" ctl={ctl} />
            <ControlView id="piano-dyn-comp" ctl={ctl} />
            <ControlView id="piano-timbre" ctl={ctl} />
          </div>
          <Group title="PIANO SELECT" className="piano-select">
            <ControlView id="piano-type" ctl={ctl} />
            <ControlView id="piano-info" ctl={ctl} buttonVariant="grey" />
            <ControlView id="piano-model" ctl={ctl} />
          </Group>
        </div>
      </div>
    </section>
  );
}
