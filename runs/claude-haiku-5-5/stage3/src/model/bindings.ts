// The control-binding audit. Every panel control is either bound to a canonical state path (and has a
// test that proves it), or listed here as unsupported with the spec clause that excludes it. A control
// that is neither is a silent no-op, which the honesty contract forbids; hardware.bindings.test.ts
// checks this table against the control inventory.

export const UNSUPPORTED: Readonly<Record<string, string>> = {
  'program.morph-3':
    'Aftertouch morph source. Browser keyboards have no aftertouch, so the A.T. button stays decorative (programs.json excluded: aftertouch morph).',
  'piano.model':
    'Piano model dial. Each piano type has one model, so the dial has nothing to select. More than one model per type is optional in piano.json, and this build leaves it out.',
}

export type Binding = 'bound' | 'unsupported'

export function bindingOf(id: string): Binding {
  return id in UNSUPPORTED ? 'unsupported' : 'bound'
}
