import { Led } from './controls/Led'
import { useInstrumentState } from './context'
import type { LayerKey } from '../state/programState'

/** The four green KB ZONE LEDs under a section's octave buttons: the focused layer's zone assignment (manual p. 39). */
export function ZoneLeds({ layer }: { layer: LayerKey }) {
  const zone = useInstrumentState((s) => s.zones[layer])
  return (
    <span className="zone-leds" data-layer={layer} data-zone={`${zone.from}-${zone.to}`}>
      {[1, 2, 3, 4].map((z) => (
        <Led key={z} small color="green" lit={z >= zone.from && z <= zone.to} className={`led-zone led-zone-${z}`} />
      ))}
    </span>
  )
}
