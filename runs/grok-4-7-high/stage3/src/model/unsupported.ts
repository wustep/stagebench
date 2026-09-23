/**
 * Spec-excluded controls stay decorative. Everything else is a real binding.
 * The hardware model's `decorative` flag stays true so the Phase 1 inventory
 * test still sees a complete deck; the DOM attribute is the honesty flag.
 */
export const UNSUPPORTED_CONTROLS: readonly { id: string; reason: string }[] = [
  { id: 'morph-at', reason: 'Aftertouch morph is excluded. Browser keyboards have no aftertouch.' },
  { id: 'preset-organ', reason: 'The organ preset library is excluded.' },
  { id: 'preset-piano', reason: 'The piano preset library is excluded.' },
  { id: 'preset-synth', reason: 'The synth preset library is excluded.' },
  { id: 'section-edit', reason: 'Section Edit is excluded.' },
  { id: 'mon-copy', reason: 'Monitor, Copy, Paste, and Swap are excluded.' },
  { id: 'organ-preset', reason: 'Organ preset and drawbar-live modes are excluded. Drawbars always show live values.' },
  { id: 'delay-variation', reason: 'Delay Chor, Vibe, Ens, Flam, Space, and Analog variations are excluded.' },
  { id: 'piano-model', reason: 'Per-type piano model variations and the model list are not implemented.' },
]

const UNSUPPORTED_IDS = new Set(UNSUPPORTED_CONTROLS.map((entry) => entry.id))

export function isUnsupportedControl(id: string): boolean {
  return UNSUPPORTED_IDS.has(id)
}
