import { KEY_BY_MIDI, midiToName } from '../hardware/keybed'
import { SPLIT_POSITIONS, enabledSplitPoints } from '../state/programState'
import { Led } from './controls/Led'
import { useInstrumentState } from './context'

/**
 * The split-position LEDs between the panel and the keybed (manual p. 39): one per documented position (C2 … C7),
 * lit for every active split point while the split is on.
 */
export function SplitLeds() {
  const split = useInstrumentState((s) => s.split)
  const active = new Set(enabledSplitPoints(split).map((p) => p.note))
  return (
    <span className="split-strip" aria-hidden="true" data-active={[...active].join(',')}>
      {SPLIT_POSITIONS.map((note) => {
        const key = KEY_BY_MIDI.get(note)
        if (!key) return null
        return <Led key={note} small color="green" lit={active.has(note)} className={`led-split-pos led-split-${midiToName(note)}`} style={{ left: `${key.x + key.w / 2}%` }} />
      })}
    </span>
  )
}
