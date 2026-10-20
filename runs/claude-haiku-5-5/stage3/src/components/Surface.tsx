import { GROUPS, OLEDS, focusedKey, readValue, scopeOf, layerKey, type ControlAction, type GroupSpec, type OledSpec, type PresentationState } from '../model/hardware'
import { SECTIONS, type SectionSpec } from '../model/sections'
import { ROW_WEIGHTS, SECTION_ROWS } from '../model/layout'
import { Control } from './Controls'

export interface SurfaceProps {
  values: PresentationState
  dispatch: (action: ControlAction) => void
}

export interface DeckProps extends SurfaceProps {
  /** Printed display text, by display ID. */
  displays: Readonly<Record<string, readonly string[]>>
  /** Presentation keys that a morph destination is assigned to. */
  morphed: ReadonlySet<string>
  /** Shift and a click on the program dial opens the numeric list view. */
  onShiftDial: () => void
}

/** The control deck: six ordered sections across the instrument width. */
export function Deck({ values, dispatch, displays, morphed, onShiftDial }: DeckProps) {
  return (
    <div className="deck">
      {SECTIONS.map((section) => (
        <Section key={section.id} spec={section} values={values} dispatch={dispatch} displays={displays} morphed={morphed} onShiftDial={onShiftDial} />
      ))}
    </div>
  )
}

interface SectionProps extends SurfaceProps {
  spec: SectionSpec
  displays: DeckProps['displays']
  morphed: ReadonlySet<string>
  onShiftDial: () => void
}

function Section({ spec, values, dispatch, displays, morphed, onShiftDial }: SectionProps) {
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
        <Oled key={oled.id} spec={oled} lines={displays[oled.id] ?? []} />
      ))}
      <div className="section-body">
        {SECTION_ROWS[spec.id].map((row) => (
          <div className="row" key={row.join('|')} style={{ flexGrow: ROW_WEIGHTS[row[0]] ?? 1 }}>
            {row.map((groupId) => {
              const group = groups.find((candidate) => candidate.id === groupId)
              return group ? (
                <Group key={group.id} spec={group} values={values} dispatch={dispatch} morphed={morphed} onShiftDial={onShiftDial} />
              ) : null
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

interface GroupProps extends SurfaceProps {
  spec: GroupSpec
  morphed: ReadonlySet<string>
  onShiftDial: () => void
}

function Group({ spec, values, dispatch, morphed, onShiftDial }: GroupProps) {
  return (
    <div className={`group group-${spec.id.replace('.', '-')}`} role="group" aria-label={spec.label}>
      <div className="group-title" aria-hidden="true">
        {spec.label}
      </div>
      <div className="group-controls">
        {spec.controls.map((control) => {
          const scope = scopeOf(control.id)
          const key = scope ? layerKey(control.id, focusedKey(values, scope)) : control.id
          const element = (
            <Control key={control.id} spec={control} value={readValue(values, control.id)} dispatch={dispatch} global={isGlobalFor(values, control.id)} />
          )
          if (control.id === 'program.dial') {
            return (
              <div key={control.id} className="morph-slot" onClickCapture={(event) => event.shiftKey && onShiftDial()}>
                {element}
              </div>
            )
          }
          return (
            <div key={control.id} className="morph-slot" data-morph={morphed.has(key) ? 'on' : undefined}>
              {element}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function isGlobalFor(values: PresentationState, id: string): boolean {
  return id === 'effects.delay-on' ? (values['effects.delay-global'] ?? 0) >= 0.5 : id === 'effects.comp-on' ? (values['effects.comp-global'] ?? 0) >= 0.5 : id === 'effects.reverb-on' ? (values['effects.reverb-global'] ?? 0) >= 0.5 : false
}

/** A printed display. Its lines are computed from the instrument state, and are read by assistive tech as one label. */
function Oled({ spec, lines }: { spec: OledSpec; lines: readonly string[] }) {
  return (
    <div className="oled" id={spec.id} role="img" aria-label={`${spec.label}: ${lines.join(' ')}`}>
      {lines.map((line) => (
        <span key={line} className="readout-line" aria-hidden="true">
          {line}
        </span>
      ))}
    </div>
  )
}
