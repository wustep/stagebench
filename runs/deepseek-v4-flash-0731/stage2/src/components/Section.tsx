import { hardwareStore, useHardwareState } from '../hardware/store'
import type { ControlValue, SectionSpec } from '../hardware/types'
import { ControlView } from './controls/controls'

interface SectionProps {
  section: SectionSpec
}

/**
 * One deck section. Lays out its controls with a dense grid appropriate to the
 * section's surface (inset dark plate with red perimeter, or exposed chassis),
 * and binds each control to the shared presentation hardware store.
 */
export function Section({ section }: SectionProps) {
  const state = useHardwareState()
  return (
    <section
      className={`section section--${section.id} section--${section.surface}`}
      style={{ width: `${section.fraction * 100}%` }}
      aria-label={section.label}
      data-section={section.id}
    >
      <div className="section-title" aria-hidden="true">{section.label}</div>
      <div className="section-controls">
        {section.controls.map((control) => (
          <ControlView key={control.id} control={control} value={state[control.id]} />
        ))}
      </div>
    </section>
  )
}

/** Read-only status helper for tests: current value of a control. */
export function controlValueForTest(id: string): ControlValue {
  return hardwareStore.get(id)
}