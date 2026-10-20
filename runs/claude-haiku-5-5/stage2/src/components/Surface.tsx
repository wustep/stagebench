import { GLOBAL_UNITS, GROUPS, OLEDS, isGlobal, readValue, type ControlAction, type GroupSpec, type OledSpec, type PresentationState } from '../model/hardware'
import { SECTIONS, type SectionSpec } from '../model/sections'
import { SECTION_ROWS } from '../model/layout'
import { Control } from './Controls'

export interface SurfaceProps {
  values: PresentationState
  dispatch: (action: ControlAction) => void
}

/** The control deck: six ordered sections across the instrument width. */
export function Deck({ values, dispatch }: SurfaceProps) {
  return (
    <div className="deck">
      {SECTIONS.map((section) => (
        <Section key={section.id} spec={section} values={values} dispatch={dispatch} />
      ))}
    </div>
  )
}

function Section({ spec, values, dispatch }: SurfaceProps & { spec: SectionSpec }) {
  const groups = GROUPS.filter((group) => group.section === spec.id)
  const oleds = OLEDS.filter((oled) => oled.section === spec.id)
  return (
    <section
      className={`section section-${spec.id} surface-${spec.surface}`}
      data-section={spec.id}
      aria-label={spec.label}
      style={{ flexGrow: spec.fraction, flexBasis: 0 }}
    >
      <h2 className="section-heading">{spec.label}</h2>
      {spec.id === 'performance' && <div className="brand">nord stage 4</div>}
      {oleds.map((oled) => (
        <Oled key={oled.id} spec={oled} />
      ))}
      <div className="section-body">
        {SECTION_ROWS[spec.id].map((row) => (
          <div className="row" key={row.join('|')}>
            {row.map((groupId) => {
              const group = groups.find((candidate) => candidate.id === groupId)
              return group ? <Group key={group.id} spec={group} values={values} dispatch={dispatch} /> : null
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

function Group({ spec, values, dispatch }: SurfaceProps & { spec: GroupSpec }) {
  return (
    <div className={`group group-${spec.id.replace('.', '-')}`} role="group" aria-label={spec.label}>
      <div className="group-title" aria-hidden="true">
        {spec.label}
      </div>
      <div className="group-controls">
        {spec.controls.map((control) => (
          <Control
            key={control.id}
            spec={control}
            value={readValue(values, control.id)}
            dispatch={dispatch}
            global={control.id in GLOBAL_UNITS && isGlobal(values, GLOBAL_UNITS[control.id])}
          />
        ))}
      </div>
    </div>
  )
}

/** Primary OLED. The text is honest: programs and synth are not implemented until Phase 3. */
function Oled({ spec }: { spec: OledSpec }) {
  return (
    <div className="oled" id={spec.id} role="img" aria-label={`${spec.label}: ${spec.text.join(' ')}`}>
      {spec.text.map((line) => (
        <span key={line} className="readout-line" aria-hidden="true">
          {line}
        </span>
      ))}
    </div>
  )
}
