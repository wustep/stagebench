import type { HardwareSection } from '../hardware';
import type { PianoState } from '../pianoState';
import { HardwareControl } from './HardwareControl';

interface HardwarePanelProps {
  section: HardwareSection;
  values: Record<string, number | boolean>;
  onChange: (id: string, value: number | boolean) => void;
  displayText: string;
  audioStatus: string;
  pianoState: PianoState;
}

function SectionDisplay({ section, text, audioStatus }: { section: HardwareSection; text: string; audioStatus: string }) {
  if (!section.primaryDisplay) return null;
  return (
    <div className="oled" aria-label={`${section.label} primary OLED display`} role="status">
      <div className="oled-scanlines" aria-hidden="true" />
      <span className="oled-label">{section.id === 'program' ? 'PROGRAM' : 'SYNTH'}</span>
      <strong>{section.id === 'program' ? text : 'Analog Lead'}</strong>
      <small>{section.id === 'program' ? `A:11  ${audioStatus}` : 'SAMPLE / ANALOG  01'}</small>
    </div>
  );
}

export function HardwarePanel({ section, values, onChange, displayText, audioStatus, pianoState }: HardwarePanelProps) {
  const grouped = section.controls.reduce<Record<string, typeof section.controls>>((acc, control) => {
    (acc[control.group] ??= []).push(control);
    return acc;
  }, {});
  return (
    <section className={`section-panel section-${section.id}`} aria-labelledby={`${section.id}-heading`}>
      <div className="section-header">
        <span className="section-eyebrow">{section.eyebrow}</span>
        <h2 id={`${section.id}-heading`}>{section.label}</h2>
        <span className="section-rule" />
      </div>
      <SectionDisplay section={section} text={displayText} audioStatus={audioStatus} />
      <div className="section-groups">
        {Object.entries(grouped).map(([group, controls]) => (
          <div className={`control-group group-${group}`} key={group}>
            <span className="group-label">{group.replace('-', ' ')}</span>
            <div className="control-row">
              {controls.map((control) => {
                const pianoActive = section.id === 'piano' && (
                  (control.id === 'piano-layer-a' && pianoState.layerA.enabled) ||
                  (control.id === 'piano-layer-b' && pianoState.layerB.enabled) ||
                  (control.id === 'piano-on' && pianoState.on) ||
                  (control.id === 'piano-soft' && pianoState.softRelease) ||
                  (control.id === 'piano-string' && pianoState.stringResonance) ||
                  (control.id === 'piano-sustain' && pianoState.sustain)
                );
                return <HardwareControl key={control.id} control={control} value={pianoActive ? true : values[control.id] ?? false} onChange={onChange} />;
              })}
            </div>
          </div>
        ))}
      </div>
      {section.id === 'performance' && (
        <div className="performance-wheels" aria-label="Performance pitch and modulation controls">
          <div className="pitch-stick" role="slider" aria-label="Pitch stick" tabIndex={0}><span /></div>
          <div className="mod-wheel" role="slider" aria-label="Modulation wheel" tabIndex={0}><span /></div>
        </div>
      )}
      {section.id === 'program' && <div className="program-keypad" aria-label="Program keypad"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span></div>}
    </section>
  );
}
