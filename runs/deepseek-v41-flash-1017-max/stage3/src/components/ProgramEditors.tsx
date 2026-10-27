/**
 * The split and zone editor, and the morph-assignment panel.
 *
 * These are the Program section's *editing surfaces*: the hardware reaches split points and
 * zone assignment with press-and-hold gestures and Shift combinations, which a browser
 * cannot discover. Rather than pretend a key combination works, the instrument renders one
 * small, labelled editor inside the Program band that writes the same canonical state the
 * hardware gestures would.
 *
 * Everything here is a real control with a name, role and value. The split-point selectors
 * only ever offer the eleven documented positions, and the crossfade selectors only offer the
 * three documented widths, so an invalid split cannot be produced.
 */
import { useMemo } from 'react'
import type { ProgramSnapshot } from '../audio/programStore'
import { UNSUPPORTED_CONTROLS } from '../audio/panelBindings'
import type { LayerId } from '../audio/types'
import {
  CROSSFADE_WIDTHS,
  SPLIT_POINT_IDS,
  SPLIT_POSITIONS,
  assignmentsFor,
  interpolate,
  type CrossfadeWidth,
  type MorphSource,
  type ProgramState,
  type SplitPointId,
} from '../audio/programState'

const LAYER_LABELS: Record<LayerId, string> = {
  'piano.a': 'Piano A',
  'piano.b': 'Piano B',
  'organ.a': 'Organ A',
  'organ.b': 'Organ B',
  'synth.a': 'Synth A',
  'synth.b': 'Synth B',
  'synth.c': 'Synth C',
}

const ALL_LAYERS: readonly LayerId[] = [
  'piano.a',
  'piano.b',
  'organ.a',
  'organ.b',
  'synth.a',
  'synth.b',
  'synth.c',
]

export interface SplitEditorProps {
  program: ProgramState
  snapshot: ProgramSnapshot
  onSplitOn: (on: boolean) => void
  onPoint: (point: SplitPointId, change: { position?: (typeof SPLIT_POSITIONS)[number]; crossfade?: CrossfadeWidth }) => void
  onZone: (layer: LayerId, zone: number, on: boolean) => void
}

/**
 * Split points, crossfades and per-layer zone assignment.
 *
 * Four zones are implicit in the three split points, so the zone assignment is a 7 × 4 grid
 * of switches, labelled with the MIDI range each zone covers. That makes the routing
 * inspectable rather than hidden behind a gesture.
 */
export function SplitEditor({ program, snapshot, onSplitOn, onPoint, onZone }: SplitEditorProps) {
  const zones = useMemo(() => zoneLabels(program), [program])

  return (
    <section
      className="split-editor"
      data-testid="split-editor"
      aria-label="Split and keyboard zones"
    >
      <header className="split-head">
        <h4 className="split-title" id="split-title">
          SPLIT / KB ZONES
        </h4>
        <button
          type="button"
          role="switch"
          aria-checked={program.split.on}
          aria-label="Split on"
          className={`split-toggle ${program.split.on ? 'is-on' : ''}`}
          data-testid="split-on"
          onClick={() => onSplitOn(!program.split.on)}
        >
          <span className="led led-amber" aria-hidden="true" />
          <span>SPLIT</span>
        </button>
      </header>

      <div className="split-points" role="group" aria-label="Split points">
        {SPLIT_POINT_IDS.map((point) => {
          const value = program.split.points[point]
          return (
            <div className="split-point" key={point} data-testid={`split-point-${point.toLowerCase()}`}>
              <span className="split-point-name">{point}</span>
              <label className="split-field">
                <span className="split-field-label">Note</span>
                <select
                  aria-label={`${point} split point note`}
                  value={value.position}
                  onChange={(event) =>
                    onPoint(point, {
                      position: event.target.value as (typeof SPLIT_POSITIONS)[number],
                    })
                  }
                >
                  {SPLIT_POSITIONS.map((position) => (
                    <option key={position} value={position}>
                      {position}
                    </option>
                  ))}
                </select>
              </label>
              <label className="split-field">
                <span className="split-field-label">Crossfade</span>
                <select
                  aria-label={`${point} split crossfade`}
                  value={String(value.crossfade)}
                  onChange={(event) =>
                    onPoint(point, {
                      crossfade: Number(event.target.value) as CrossfadeWidth,
                    })
                  }
                >
                  {CROSSFADE_WIDTHS.map((width) => (
                    <option key={width} value={String(width)}>
                      {width === 0 ? 'Off' : `±${width}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )
        })}
      </div>

      <table className="zone-table" data-testid="zone-table">
        <caption className="zone-caption">
          Zone assignment · {snapshot.name}
        </caption>
        <thead>
          <tr>
            <th scope="col">Layer</th>
            {zones.map((zone, index) => (
              <th scope="col" key={`head-${index}`}>
                {index + 1}
                <span className="zone-range">{zone}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ALL_LAYERS.map((layer) => (
            <tr key={layer}>
              <th scope="row">{LAYER_LABELS[layer]}</th>
              {[0, 1, 2, 3].map((zone) => {
                const on = program.split.zones[layer]?.[zone] === true
                return (
                  <td key={`${layer}-${zone}`}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${LAYER_LABELS[layer]} in zone ${zone + 1}`}
                      className={`zone-cell ${on ? 'is-on' : ''}`}
                      data-testid={`zone-${layer}-${zone}`}
                      onClick={() => onZone(layer, zone, !on)}
                    >
                      <span className="led led-green" aria-hidden="true" />
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** A short MIDI-range label for each zone, so the assignment grid is readable. */
function zoneLabels(program: ProgramState): string[] {
  const order = SPLIT_POINT_IDS.map((id) => ({
    midi: midiFor(program.split.points[id].position),
    label: program.split.points[id].position,
  })).sort((a, b) => a.midi - b.midi)
  const labels: string[] = []
  let previous = 'E1'
  for (const point of order) {
    labels.push(`${previous}–${point.label}`)
    previous = point.label
  }
  labels.push(`${previous}–E7`)
  void program.split.on
  return labels
}

const POSITION_MIDI: Record<string, number> = {
  C2: 36,
  F2: 41,
  C3: 48,
  F3: 53,
  C4: 60,
  F4: 65,
  C5: 72,
  F5: 77,
  C6: 84,
  F6: 89,
  C7: 96,
}

function midiFor(position: string): number {
  return POSITION_MIDI[position] ?? 60
}

/* ------------------------------------------------------------------ */
/* Morph panel                                                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* The unsupported-control notes                                      */
/* ------------------------------------------------------------------ */

export interface UnsupportedNotesProps {
  entries?: readonly { id: string; reason: string; spec: string }[]
}

/**
 * The honesty contract, printed where a player can find it.
 *
 * Every control the specs exclude is listed here with the spec bullet that excludes it, so
 * "it moves but does nothing" is documented rather than hidden. The list is generated from
 * the same table the binding audit uses, so it cannot drift.
 */
export function UnsupportedNotes({ entries }: UnsupportedNotesProps) {
  const list = entries ?? UNSUPPORTED_CONTROLS
  return (
    <section className="unsupported-notes" data-testid="unsupported-notes" aria-label="Unsupported controls">
      <h4 className="split-title">PRESENT BUT UNSUPPORTED ({list.length})</h4>
      <p className="unsupported-intro">
        These controls exist, move and press, but do nothing: each is excluded by a spec.
      </p>
      <ul className="unsupported-list">
        {list.map((entry) => (
          <li key={entry.id} className="unsupported-item">
            <code className="unsupported-id">{entry.id}</code>
            <span className="unsupported-reason">{entry.reason}</span>
            <span className="unsupported-spec">{entry.spec}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}


export interface MorphPanelProps {
  program: ProgramState
  onPosition: (source: MorphSource, position: number) => void
  onClear: (source: MorphSource, controlId?: string) => void
}

/**
 * The two morph sources and what they drive.
 *
 * The hardware records a morph by holding a source button and sweeping the destinations.
 * A browser has no such gesture, so the assignment is listed here with its start and end
 * values, and each source has a real position control that interpolates them. That is the
 * same state and the same behaviour; only the gesture differs.
 */
export function MorphPanel({ program, onPosition, onClear }: MorphPanelProps) {
  const sources: MorphSource[] = ['Wheel', 'Control Pedal']
  return (
    <section className="morph-panel" data-testid="morph-panel" aria-label="Morph assignments">
      <h4 className="split-title">MORPH</h4>
      {sources.map((source) => {
        const assignments = assignmentsFor(program.morph, source)
        const position = source === 'Wheel' ? program.morph.wheelPosition : program.morph.pedalPosition
        return (
          <div className="morph-source" key={source} data-testid={`morph-${source.replace(' ', '-').toLowerCase()}`}>
            <div className="morph-head">
              <label className="morph-position">
                <span className="split-field-label">{source}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(position * 100)}
                  aria-label={`${source} morph position`}
                  onChange={(event) => onPosition(source, Number(event.target.value) / 100)}
                />
                <span className="morph-readout">{Math.round(position * 100)}%</span>
              </label>
              <button
                type="button"
                className="morph-clear"
                aria-label={`Clear all ${source} morph assignments`}
                disabled={assignments.length === 0}
                onClick={() => onClear(source)}
              >
                CLEAR
              </button>
            </div>
            {assignments.length === 0 ? (
              <p className="morph-empty">No assignments</p>
            ) : (
              <ul className="morph-list">
                {assignments.map((assignment) => (
                  <li key={assignment.controlId} className="morph-item">
                    <span className="morph-name">{assignment.controlId}</span>
                    <span className="morph-range">
                      {assignment.start.toFixed(1)} → {assignment.end.toFixed(1)}
                    </span>
                    <span className="morph-value">{interpolate(assignment, position).toFixed(1)}</span>
                    <button
                      type="button"
                      aria-label={`Clear ${source} morph on ${assignment.controlId}`}
                      onClick={() => onClear(source, assignment.controlId)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </section>
  )
}
