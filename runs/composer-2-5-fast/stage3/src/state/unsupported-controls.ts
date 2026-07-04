/** Spec-excluded controls — decorative only, listed as unsupported per honesty contract. */
export const UNSUPPORTED_CONTROLS: string[] = [
  'program-morph-knob',
  'organ-preset-live',
  'synth-extern',
  'fx-master-wet',
  'piano-pstick',
]

export const UNSUPPORTED_NOTES: Record<string, string> = {
  'program-morph-knob': 'Aftertouch morph source excluded (programs spec)',
  'organ-preset-live': 'Organ preset/drawbar live modes excluded (organ spec)',
  'synth-extern': 'Extern mode excluded (synth spec)',
  'fx-master-wet': 'Undocumented master wet control',
  'piano-pstick': 'Pitch stick morph for piano only — presentation binding without aftertouch',
}

export function isUnsupportedControl(id: string): boolean {
  return UNSUPPORTED_CONTROLS.includes(id)
}
