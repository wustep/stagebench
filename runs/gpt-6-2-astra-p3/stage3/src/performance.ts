import { createContext } from 'react'
import type { Programs } from './programs'
export type MorphSource = 'wheel' | 'pedalValue'
export interface PerformancePanel {
  bank: Programs
  assignSource: MorphSource | null
  command: (id: string, value?: number, shift?: boolean) => boolean
  read: (id: string) => { value: number; label: string } | undefined
  range: (id: string) => number[]
  envelope: string | null
  menu: string
  open: (menu: string) => void
}
export const Performance = createContext<PerformancePanel | null>(null)
export const morphable = (id: string) =>
  /layer-[abc]-level$|^organ-drawbar-|^performance-rotary-speed$|^synth-(oscillator-control|filter-frequency|filter-resonance|arp-rate|lfo-rate|lfo-mod-amount)$|^effects-(mod-1-rate|mod-[12]-amount|delay-(tempo|feedback|mix)|mid-frequency|amp-drive|reverb-mix)$/.test(
    id,
  )

export const panelActions = new Set([
  'program-morph-wheel',
  'program-morph-ctrlped',
  'program-split',
  'program-master-clock',
  'program-transpose',
  'program-store',
  'program-program-dial',
  'program-page-previous',
  'program-page-next',
  'program-live-mode',
  'program-layer-scene',
  'program-prog-view',
  'program-shift',
  'program-solo',
  ...Array.from({ length: 8 }, (_, i) => 'program-program-' + (i + 1)),
  'synth-info',
  'synth-synth-mode',
  'synth-arp-menu',
  'synth-vibrato-menu',
  'synth-oscillator-pitch',
  'synth-oscillator-envelope',
  'synth-filter-envelope',
  'synth-amp-envelope',
  'piano-piano-model',
])
export const exclusions: Record<string, string> = {
  'program-morph-a-t': 'Aftertouch morph',
  'program-preset-organ': 'Organ preset library',
  'program-preset-piano': 'Piano preset library',
  'program-preset-synth': 'Synth preset library',
  'organ-organ-preset': 'Organ preset library',
  'program-section-edit': 'Section Edit and Layer Init',
  'program-mon-copy': 'Monitor, Copy and Paste',
  'effects-delay-variation': 'Delay feedback-loop variations',
}
