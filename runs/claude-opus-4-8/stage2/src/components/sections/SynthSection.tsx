import type { ControlApi } from '../../hooks/useControls';
import { ControlView } from '../controls/ControlView';
import { Group } from '../Group';
import { Oled } from '../Oled';
import { SectionHeader } from './SectionHeader';

/**
 * Synth section — dark inset plate. Landmarks: three level faders with LED
 * graphs, the single synth OLED (one of only two), MODE / ARP / VOICE / VIBRATO
 * groups up top, then OSCILLATORS / FILTER / AMP / LFO / UNISON knob groups.
 */
export function SynthSection({ ctl }: { ctl: ControlApi }) {
  return (
    <section className="deck-section synth inset" aria-label="Synth">
      <SectionHeader title="SYNTH" ctl={ctl} onId="synth-on" soloId="synth-solo" fxFocus />
      <div className="synth-body">
        <div className="synth-left">
          <div className="fader-trio">
            <ControlView id="synth-level-a" ctl={ctl} ledGraph />
            <ControlView id="synth-level-b" ctl={ctl} ledGraph />
            <ControlView id="synth-level-c" ctl={ctl} ledGraph />
          </div>
          <div className="layer-row">
            <ControlView id="synth-on-off-a" ctl={ctl} led="amber" buttonVariant="grey" />
            <ControlView id="synth-on-off-b" ctl={ctl} led="amber" buttonVariant="grey" />
            <ControlView id="synth-on-off-c" ctl={ctl} led="amber" buttonVariant="grey" />
          </div>
          <div className="layer-row">
            <ControlView id="synth-sustped" ctl={ctl} />
            <ControlView id="synth-pstick" ctl={ctl} />
          </div>
          <div className="layer-row">
            <ControlView id="synth-kb-hold" ctl={ctl} />
            <ControlView id="synth-arp-run" ctl={ctl} led="red" />
          </div>
          <div className="octave-row">
            <ControlView id="synth-octave-down" ctl={ctl} buttonVariant="grey" />
            <ControlView id="synth-octave-up" ctl={ctl} buttonVariant="grey" />
          </div>
        </div>

        <div className="synth-right">
          <div className="synth-top">
            <Oled variant="synth" />
            <Group title="MODE" className="synth-mode">
              <ControlView id="synth-mode" ctl={ctl} />
            </Group>
            <Group title="ARP/GATE" className="synth-arp-top">
              <ControlView id="synth-arp-rate" ctl={ctl} />
              <ControlView id="synth-arp-mode" ctl={ctl} />
              <ControlView id="synth-arp-range" ctl={ctl} />
            </Group>
            <Group title="VOICE" className="synth-voice">
              <ControlView id="synth-voice-mode" ctl={ctl} />
              <ControlView id="synth-glide" ctl={ctl} />
            </Group>
            <Group title="VIBRATO" className="synth-vibrato">
              <ControlView id="synth-vibrato" ctl={ctl} />
            </Group>
          </div>
          <div className="synth-bottom">
            <Group title="LFO" className="synth-lfo">
              <ControlView id="synth-lfo-waveform" ctl={ctl} buttonVariant="square" />
              <ControlView id="synth-lfo-rate" ctl={ctl} />
              <ControlView id="synth-lfo-amt" ctl={ctl} />
            </Group>
            <Group title="OSCILLATORS" className="synth-osc">
              <div className="btn-col">
                <ControlView id="synth-osc-pitch" ctl={ctl} buttonVariant="square" />
                <ControlView id="synth-osc-env" ctl={ctl} buttonVariant="square" />
              </div>
              <ControlView id="synth-osc-ctrl" ctl={ctl} />
              <ControlView id="synth-osc-env-amt" ctl={ctl} />
            </Group>
            <Group title="FILTER" className="synth-filter">
              <div className="btn-col">
                <ControlView id="synth-filter-type" ctl={ctl} buttonVariant="square" />
                <ControlView id="synth-filter-env" ctl={ctl} buttonVariant="square" />
              </div>
              <ControlView id="synth-filter-freq" ctl={ctl} />
              <ControlView id="synth-filter-res" ctl={ctl} />
              <ControlView id="synth-filter-env-amt" ctl={ctl} />
              <ControlView id="synth-filter-on" ctl={ctl} led="red" buttonVariant="grey" />
            </Group>
            <Group title="AMP" className="synth-amp">
              <ControlView id="synth-amp-env" ctl={ctl} buttonVariant="square" />
              <ControlView id="synth-unison" ctl={ctl} />
            </Group>
          </div>
        </div>
      </div>
    </section>
  );
}
