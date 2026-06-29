import { useMemo } from 'react'
import { HardwareControlView } from './components/Controls'
import { Keyboard } from './components/Keyboard'
import { HARDWARE_SECTIONS, type HardwareControl } from './model/hardware'
import './styles.css'

function groupControls(controls: HardwareControl[]) {
  const groups = new Map<string, HardwareControl[]>()
  for (const control of controls) {
    const group = groups.get(control.group) ?? []
    group.push(control)
    groups.set(control.group, group)
  }
  return [...groups.entries()]
}

function PanelSection({ section }: { section: (typeof HARDWARE_SECTIONS)[number] }) {
  const groups = useMemo(() => groupControls(section.controls), [section.controls])
  return (
    <section
      className={`panel-section section-${section.id}`}
      data-section={section.id}
      aria-label={`${section.label} section`}
    >
      <div className="section-title"><span>{section.label}</span><i aria-hidden="true" /></div>
      <div className="section-groups">
        {groups.map(([name, controls]) => (
          <div className={`section-group group-${name}`} data-group={name.replaceAll('-', ' ')} key={name}>
            {controls.map((control) => <HardwareControlView control={control} key={control.id} />)}
          </div>
        ))}
      </div>
      {section.id === 'performance' && (
        <div className="brand-lockup" aria-label="Nord Stage 4 Hammer Action 73">
          <span className="brand-nord">nord</span><span className="brand-stage">stage 4</span>
          <small>HAMMER ACTION 73</small>
        </div>
      )}
    </section>
  )
}

export default function App() {
  return (
    <main className="product-study">
      <div className="instrument-shadow" aria-hidden="true" />
      <div
        className="instrument"
        data-chassis
        role="region"
        aria-label="Nord Stage 4 73 hardware"
      >
        <div className="top-rail" aria-hidden="true">
          <span>PROGRAM</span><span>OUTPUTS</span><span>MIDI</span><span>USB</span><span>MONITOR IN</span><span>POWER</span>
        </div>
        <div className="control-deck" data-testid="control-deck">
          <div
            className="section-strip"
            style={{ gridTemplateColumns: HARDWARE_SECTIONS.map((section) => `${section.fraction}fr`).join(' ') }}
          >
            {HARDWARE_SECTIONS.map((section) => <PanelSection section={section} key={section.id} />)}
          </div>
        </div>
        <div className="keybed" data-testid="keybed">
          <div className="left-cheek" aria-hidden="true" />
          <Keyboard />
          <div className="right-cheek" aria-hidden="true" />
        </div>
        <div className="bottom-rail" aria-hidden="true" />
      </div>
      <p className="interaction-note">
        <span className="status-light" aria-hidden="true" />
        Stage 4 73 hardware study · keys, switches, faders and encoders are interactive
      </p>
    </main>
  )
}
