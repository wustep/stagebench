// Fields every layer of every section shares (organ spec architecture.layerControls, synth spec
// architecture.layerControls, piano spec layers): enable, level fader, octave shift, SUSTPED,
// PSTICK and the KB zone range used by splits (programs spec split.zoneAssignment).

/** A contiguous KB zone range, zones numbered 1…4 from the bottom of the keyboard. */
export type ZoneRange = readonly [number, number]

export const FULL_ZONE: ZoneRange = [1, 4]

export interface CommonLayer {
  enabled: boolean
  /** 0…127 layer level fader. */
  level: number
  /** Octave shift in octaves (±12 semitones → -1…+1). */
  octave: number
  /** SUSTPED: the sustain pedal affects this layer. */
  sustPed: boolean
  /** PSTICK: the pitch stick bends this layer ±2 semitones. */
  pStick: boolean
  /** KB zone assignment (only applies while Split is on). */
  zone: ZoneRange
}

export function commonDefaults(enabled: boolean, level: number, sustPed = true): CommonLayer {
  return { enabled, level, octave: 0, sustPed, pStick: true, zone: FULL_ZONE }
}
