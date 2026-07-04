import type { ControlApi } from '../../hooks/useControls';
import { ControlView } from '../controls/ControlView';

interface SectionHeaderProps {
  title: string;
  ctl: ControlApi;
  onId?: string;
  soloId?: string;
  fxFocus?: boolean;
}

/** The strip at the top of an inset section: title, FX FOCUS led, ON, SOLO. */
export function SectionHeader({ title, ctl, onId, soloId, fxFocus }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <div className="section-title">
        {title}
        <span className="section-sub">SECTION</span>
      </div>
      <div className="section-header-controls">
        {fxFocus ? (
          <span className="fx-focus">
            <span className="fx-focus-led" aria-hidden="true" /> FX FOCUS
          </span>
        ) : null}
        {onId ? <ControlView id={onId} ctl={ctl} buttonVariant="pill" led="red" /> : null}
        {soloId ? <ControlView id={soloId} ctl={ctl} buttonVariant="square" /> : null}
      </div>
    </div>
  );
}
