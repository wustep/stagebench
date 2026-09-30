/**
 * Which panel controls are morph destinations (programs spec `morph.destinations`) and what they map to under the current
 * focus. The forward map is used while a morph source is in assign mode; the inverse map lights the morph LEDs.
 */
import { morphDestId } from './morph'
import { focusedChainId, type ChainId, type EngineState } from './state'

/** control id → destination id, or null when the control is not a morph destination */
export function destForControl(id: string, s: EngineState): string | null {
  const chain: ChainId = focusedChainId(s)
  switch (id) {
    case 'piano-level-a':
      return morphDestId.level('piano', 'A')
    case 'piano-level-b':
      return morphDestId.level('piano', 'B')
    case 'organ-level-a':
      return morphDestId.level('organ', 'A')
    case 'organ-level-b':
      return morphDestId.level('organ', 'B')
    case 'synth-level-a':
      return morphDestId.level('synth', 'A')
    case 'synth-level-b':
      return morphDestId.level('synth', 'B')
    case 'synth-level-c':
      return morphDestId.level('synth', 'C')
    case 'rotary-speed':
      return morphDestId.rotarySpeed()
    case 'synth-lfo-rate':
      return morphDestId.synth('lfoRate', s.synthFocus)
    case 'synth-osc-control':
      return morphDestId.synth('oscCtrl', s.synthFocus)
    case 'synth-lfo-amount':
      return morphDestId.synth('lfoAmount', s.synthFocus)
    case 'synth-filter-frequency':
      return morphDestId.synth('filterFreq', s.synthFocus)
    case 'synth-filter-resonance':
      return morphDestId.synth('filterRes', s.synthFocus)
    case 'synth-arp-rate':
      return morphDestId.synth('arpRate', s.synthFocus)
    case 'fx-mod1-rate':
      return morphDestId.fx('mod1Rate', chain)
    case 'fx-mod1-amount':
      return morphDestId.fx('mod1Amount', chain)
    case 'fx-mod2-amount':
      return morphDestId.fx('mod2Amount', chain)
    case 'fx-delay-tempo':
      return morphDestId.fx('delayTempo', chain)
    case 'fx-delay-feedback':
      return morphDestId.fx('delayFeedback', chain)
    case 'fx-delay-dry-wet':
      return morphDestId.fx('delayDryWet', chain)
    case 'fx-amp-frequency':
      return morphDestId.fx('ampFreq', chain)
    case 'fx-amp-drive':
      return morphDestId.fx('ampDrive', chain)
    case 'fx-reverb-dry-wet':
      return morphDestId.fx('reverbDryWet', chain)
  }
  const drawbar = /^organ-drawbar-(\d)$/.exec(id)
  if (drawbar) return morphDestId.drawbar(s.organFocus, Number(drawbar[1]) - 1)
  return null
}

/** every control id that can be a morph destination */
export const MORPH_CONTROL_IDS: readonly string[] = [
  'piano-level-a',
  'piano-level-b',
  'organ-level-a',
  'organ-level-b',
  'synth-level-a',
  'synth-level-b',
  'synth-level-c',
  'rotary-speed',
  'synth-lfo-rate',
  'synth-osc-control',
  'synth-lfo-amount',
  'synth-filter-frequency',
  'synth-filter-resonance',
  'synth-arp-rate',
  'fx-mod1-rate',
  'fx-mod1-amount',
  'fx-mod2-amount',
  'fx-delay-tempo',
  'fx-delay-feedback',
  'fx-delay-dry-wet',
  'fx-amp-frequency',
  'fx-amp-drive',
  'fx-reverb-dry-wet',
  ...Array.from({ length: 9 }, (_, i) => `organ-drawbar-${i + 1}`),
]
