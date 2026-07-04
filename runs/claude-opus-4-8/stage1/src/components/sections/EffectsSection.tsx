import type { ControlApi } from '../../hooks/useControls';
import { ControlView } from '../controls/ControlView';
import { Group } from '../Group';

/**
 * Layer Effects section — dark inset plate. Landmarks: FX FOCUS group (Organ/
 * Piano/Synth A-B-C), MOD 1, MOD 2, AMP SIM/EQ, DELAY, COMP, REVERB. No OLED.
 */
export function EffectsSection({ ctl }: { ctl: ControlApi }) {
  return (
    <section className="deck-section effects inset" aria-label="Layer effects">
      <div className="section-header effects-header">
        <div className="section-title">
          LAYER EFFECTS<span className="section-sub">FX FOCUS</span>
        </div>
        <div className="effects-header-controls">
          <ControlView id="effects-focus" ctl={ctl} />
          <ControlView id="effects-all-off" ctl={ctl} buttonVariant="grey" />
          <ControlView id="effects-on" ctl={ctl} led="red" buttonVariant="pill" />
        </div>
      </div>

      <div className="effects-body">
        <div className="effects-grid">
          <Group title="MOD 1" className="fx-mod1">
            <ControlView id="effects-mod1-rate" ctl={ctl} />
            <ControlView id="effects-mod1-amount" ctl={ctl} />
            <ControlView id="effects-mod1-type" ctl={ctl} />
            <ControlView id="effects-mod1-on" ctl={ctl} led="red" buttonVariant="grey" />
          </Group>

          <Group title="DELAY" className="fx-delay">
            <ControlView id="effects-delay-tempo" ctl={ctl} />
            <ControlView id="effects-delay-feedback" ctl={ctl} />
            <ControlView id="effects-delay-drywet" ctl={ctl} />
            <ControlView id="effects-delay-type" ctl={ctl} />
            <ControlView id="effects-delay-filter" ctl={ctl} />
            <ControlView id="effects-delay-tap" ctl={ctl} buttonVariant="square" />
            <ControlView id="effects-delay-pingpong" ctl={ctl} buttonVariant="square" />
            <ControlView id="effects-delay-on" ctl={ctl} led="red" buttonVariant="grey" />
          </Group>

          <Group title="MOD 2" className="fx-mod2">
            <ControlView id="effects-mod2-rate" ctl={ctl} />
            <ControlView id="effects-mod2-amount" ctl={ctl} />
            <ControlView id="effects-mod2-type" ctl={ctl} />
            <ControlView id="effects-mod2-on" ctl={ctl} led="red" buttonVariant="grey" />
          </Group>

          <Group title="COMP" className="fx-comp">
            <ControlView id="effects-comp-amount" ctl={ctl} />
            <ControlView id="effects-comp-fast" ctl={ctl} />
            <ControlView id="effects-comp-on" ctl={ctl} led="red" buttonVariant="grey" />
          </Group>

          <Group title="AMP SIM / EQ" className="fx-amp">
            <ControlView id="effects-amp-drive" ctl={ctl} />
            <ControlView id="effects-amp-freq" ctl={ctl} />
            <ControlView id="effects-amp-bass" ctl={ctl} />
            <ControlView id="effects-amp-mid" ctl={ctl} />
            <ControlView id="effects-amp-treble" ctl={ctl} />
            <ControlView id="effects-amp-model" ctl={ctl} />
            <ControlView id="effects-amp-on" ctl={ctl} led="red" buttonVariant="grey" />
          </Group>

          <Group title="REVERB" className="fx-reverb">
            <ControlView id="effects-reverb-drywet" ctl={ctl} />
            <ControlView id="effects-reverb-type" ctl={ctl} />
            <ControlView id="effects-reverb-tone" ctl={ctl} />
            <ControlView id="effects-reverb-on" ctl={ctl} led="red" buttonVariant="grey" />
          </Group>
        </div>
      </div>
    </section>
  );
}
