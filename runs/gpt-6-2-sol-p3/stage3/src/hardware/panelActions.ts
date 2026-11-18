import { useMemo, useRef, useState } from 'react'
import { assignMorph, clearMorph, morphEditState } from '../instrument/morph'
import { categories, clamp, envelopeTime, splitPoints, waves } from '../instrument/parameters'
import type { MorphSource } from '../instrument/parameters'
import { address, editTempo, switchScene, toggleSplit } from '../instrument/programs'
import type { ProgramControls } from '../instrument/usePrograms'
import type { Settings } from '../piano/settings'
import { panelUpdate, panelValue, tapDelay } from './bindings'
import { editSynth, synthGroup, synthState } from './engineBindings'
import type { Control } from './model'

export type Editor = 'list' | 'name' | 'split' | 'clock' | 'transpose' | 'arp' | 'vibrato' | 'lfo' |
  'pitch' | 'osc' | 'filter' | 'amp' | 'analog' | 'piano' | 'tracking' | 'morph'
const envelopeEditors = ['osc', 'filter', 'amp'] as const
const dialIds = ['synth-osc-type', 'synth-osc-category', 'synth-osc-wave']
const envelopeKeys = ['attack', 'decay', 'release'] as const

export const actionControlIds = new Set([
  'program-dial', 'program-page-down', 'program-page-up', 'program-live-mode', 'program-layer-scene',
  'program-view', 'program-shift', 'effects-shift', 'program-store', 'program-split', 'program-master-clock',
  'program-transpose', 'morph-wheel', 'morph-control-pedal',
  'synth-mode', 'synth-osc-type', 'synth-arp-menu', 'synth-vibrato-menu', 'synth-lfo-wave', 'synth-osc-pitch-mode',
  'synth-osc-envelope', 'synth-filter-envelope', 'synth-amp-envelope', 'synth-filter-resonance', 'piano-model',
  ...Array.from({ length: 8 }, (_, index) => `program-slot-${index + 1}`),
])

export const unsupportedControls: Record<string, string> = {
  'morph-aftertouch': 'Aftertouch morph',
  'organ-preset': 'Organ presets and drawbar sync',
  'program-library-organ': 'Organ preset library',
  'program-library-piano': 'Piano preset library',
  'program-library-synth': 'Synth preset library',
  'program-section-edit': 'Section Edit and Layer Init',
  'program-copy': 'Monitor, Copy, Paste and Swap',
  'program-solo': 'Solo and Undo',
  'effects-delay-variation': 'Delay feedback-loop effects',
}

export const shiftExclusions: Record<string, string> = {
  'effects-mod-1-variation': 'Mod 1 variations',
  'effects-mod-2-variation': 'Mod 2 variations',
  'effects-amp-variation': 'Amp variations',
  'effects-delay-ping-pong': 'Delay Ping Pong',
  'effects-reverb-variation': 'Reverb variations and Chorale',
  'piano-type': 'Piano INFO',
  'piano-acoustics': 'Pedal noise',
  'rotary-organ': 'Rotary Close Mic',
  'rotary-stop': 'Rotary stop angle',
  'synth-waveform': 'Sound Init',
  'synth-kb-hold': 'Per-layer KB Hold exclude',
  'synth-arp-mode': 'Pattern editing',
  'synth-arp-menu': 'Arp Group',
  'synth-filter-type': 'Filter Group',
  'program-live-mode': 'Num Pad mode',
  'program-page-up': 'Bank navigation',
  'program-page-down': 'Bank navigation',
  'program-view': 'Preset name view',
  'program-layer-scene': 'Scene pedal switching',
}

function morphSource(id: string): MorphSource | undefined {
  if (id === 'morph-wheel') return 'wheel'
  if (id === 'morph-control-pedal') return 'pedal'
}

function envelopeEditor(editor?: Editor): 'osc' | 'filter' | 'amp' | undefined {
  return envelopeEditors.find((option) => option === editor)
}

export function usePanelActions(settings: Settings, program: ProgramControls, now: () => number, panic: () => void) {
  const [editor, setEditor] = useState<Editor>()
  const [programShift, setProgramShift] = useState(false)
  const [effectsShift, setEffectsShift] = useState(false)
  const [latched, setLatched] = useState<MorphSource>()
  const [held, setHeld] = useState<MorphSource>()
  const lastMorph = useRef<{ source: MorphSource; time: number } | undefined>(undefined)
  const taps = useRef<number[]>([])
  const lastDelayTap = useRef<number | undefined>(undefined)
  const source = held ?? latched
  const selected = program.selected
  const inLive = selected.bank === 'live'
  const last = inLive ? 7 : 31
  const envelope = envelopeEditor(editor)

  function close() {
    setEditor(undefined)
    setProgramShift(false)
    setEffectsShift(false)
  }

  function shiftFor(id: string, modifier: boolean) {
    return modifier || programShift || (id.startsWith('effects-') && effectsShift)
  }

  function pressMorph(id: string, down: boolean, modifier: boolean) {
    const morph = morphSource(id)
    if (!morph || shiftFor(id, modifier)) return
    if (down) setHeld(morph)
    else setHeld((previous) => previous === morph ? undefined : previous)
  }

  function describe(id: string): { value?: number | boolean; text?: string } | undefined {
    const morph = morphSource(id)
    if (morph) {
      const count = Object.keys(settings.morph[morph]).length
      return { value: source === morph || count > 0, text: `${count} assigned · Hold or double-tap · Shift clears` }
    }
    if (id.startsWith('program-slot-')) return {
      value: selected.index % 8 === Number(id.slice(-1)) - 1,
      text: `${address({ bank: selected.bank, index: Math.floor(selected.index / 8) * 8 + Number(id.slice(-1)) - 1 })} · ${program.library[selected.bank][Math.floor(selected.index / 8) * 8 + Number(id.slice(-1)) - 1].name}`,
    }
    const dial = dialIds.indexOf(id)
    if (envelope && dial !== -1) {
      const key = envelopeKeys[dial]
      const position = synthState(settings)[envelope][key]
      return { value: position, text: key === 'decay' && position === 10 ? 'Decay · Sustain' : `${key} · ${Math.round(envelopeTime(position) * 1000)} ms` }
    }
    switch (id) {
      case 'program-dial':
        if (editor === 'clock') return { value: settings.effects.clockBpm - 30, text: `${settings.effects.clockBpm} BPM` }
        if (editor === 'transpose') return { value: settings.transpose.semitones + 6, text: `${settings.transpose.semitones} semitones` }
        return { value: selected.index, text: `${address(selected)} · ${program.selectedSlot.name}` }
      case 'program-shift': return { value: programShift, text: program.store ? 'Cancel Store' : 'Shift / Exit' }
      case 'effects-shift': return { value: effectsShift }
      case 'program-store': return { value: Boolean(program.store), text: program.store ? `Confirm Store to ${address(selected)}` : 'Store · Shift for Store As' }
      case 'program-view': return { value: editor === 'list', text: 'Numeric program list' }
      case 'program-page-down': return { value: false, text: inLive ? 'Eight Live slots' : 'Previous page' }
      case 'program-page-up': return { value: false, text: inLive ? 'Eight Live slots' : 'Next page' }
      case 'program-live-mode': return { value: inLive }
      case 'program-layer-scene': return { value: settings.scene === 'II', text: `Scene ${settings.scene}` }
      case 'program-split': return { value: splitPoints(settings.splits).length > 0, text: 'Hold or Shift to edit split points and zones' }
      case 'program-master-clock': return { value: editor === 'clock', text: `${settings.effects.clockBpm} BPM · Tap four times or hold to edit` }
      case 'program-transpose': return { value: settings.transpose.enabled, text: `${settings.transpose.semitones} semitones · Hold to edit · Shift for Panic` }
      case 'piano-model': return { value: 4, text: panelValue(settings, id)?.text }
      default: return panelValue(source ? morphEditState(settings, source, id) : settings, id)
    }
  }

  function maximum(control: Control) {
    if (control.type === 'button') return
    const { id } = control
    if (id === 'program-dial') return editor === 'clock' ? 270 : editor === 'transpose' ? 12 : last
    if (envelope && dialIds.includes(id)) return 10
    if (id === 'synth-osc-type') return 4
    if (id === 'synth-osc-category') return categories.length - 1
    if (id === 'synth-osc-wave') return waves[synthState(settings).category].length - 1
    if (id === 'synth-arp-range') return synthState(settings).arp.mode === 'Gate' ? 10 : 3
    return control.maximum
  }

  function longPress(id: string) {
    switch (id) {
      case 'program-split': setEditor('split'); return true
      case 'program-master-clock': setEditor('clock'); return true
      case 'program-transpose': setEditor('transpose'); return true
      case 'synth-filter-resonance': setEditor('tracking'); return true
      default: return false
    }
  }

  function storeName(name: string) {
    program.beginStore(name.trim().slice(0, 24) || program.current.name)
    close()
  }

  function update(id: string, value: number | boolean, modifier: boolean, keyboard: boolean) {
    const shifted = shiftFor(id, modifier)
    if (id !== 'program-shift' && id !== 'effects-shift') {
      if (programShift && id !== 'program-dial') setProgramShift(false)
      if (effectsShift && id.startsWith('effects-')) setEffectsShift(false)
    }
    const morph = morphSource(id)
    if (morph) {
      if (shifted) {
        program.edit(clearMorph(settings, morph))
        setHeld(undefined)
        setLatched(undefined)
      } else if (keyboard) setLatched(latched === morph ? undefined : morph)
      else {
        const timestamp = now()
        if (lastMorph.current?.source === morph && timestamp - lastMorph.current.time < 370) {
          setLatched(latched === morph ? undefined : morph)
          lastMorph.current = undefined
        } else lastMorph.current = { source: morph, time: timestamp }
      }
      return
    }
    if (shifted && (shiftExclusions[id] || id.startsWith('program-slot-'))) return
    if (id.startsWith('program-slot-')) {
      program.select({ bank: selected.bank, index: Math.floor(selected.index / 8) * 8 + Number(id.slice(-1)) - 1 })
      return
    }
    const dial = dialIds.indexOf(id)
    if (envelope && dial !== -1) {
      program.edit(synthGroup(settings, envelope, { [envelopeKeys[dial]]: Number(value) }))
      return
    }
    switch (id) {
      case 'program-shift':
        if (program.store) program.cancelStore()
        else if (editor) close()
        else setProgramShift(!programShift)
        return
      case 'effects-shift': setEffectsShift(!effectsShift); return
      case 'program-view': setEditor(editor === 'list' ? undefined : 'list'); return
      case 'program-store':
        if (shifted) setEditor('name')
        else if (program.store) program.confirmStore()
        else program.beginStore()
        return
      case 'program-live-mode': program.toggleLive(); return
      case 'program-layer-scene': program.edit(switchScene(settings)); return
      case 'program-page-up': case 'program-page-down':
        if (!inLive) program.select({ bank: selected.bank, index: (selected.index + (id.endsWith('up') ? 8 : 24)) % 32 })
        return
      case 'program-dial':
        if (editor === 'clock') program.edit(editTempo(settings, 30 + Number(value)))
        else if (editor === 'transpose') program.edit({ ...settings, transpose: { enabled: true, semitones: Number(value) - 6 } })
        else if (shifted) { setEditor('list'); setProgramShift(false) }
        else program.select({ bank: selected.bank, index: clamp(Number(value), 0, last) })
        return
      case 'program-split':
        if (shifted) setEditor('split')
        else program.edit(toggleSplit(settings))
        return
      case 'program-master-clock': {
        if (shifted) { setEditor('clock'); return }
        const time = now()
        const previous = taps.current
        const gap = time - (previous.at(-1) ?? -Infinity)
        taps.current = gap >= 200 && gap <= 2000 ? [...previous.slice(-3), time] : [time]
        if (taps.current.length === 4) program.edit(editTempo(settings, 180000 / (time - taps.current[0])))
        return
      }
      case 'program-transpose':
        if (shifted) { panic(); setLatched(undefined); setHeld(undefined) }
        else if (settings.transpose.semitones === 0) setEditor('transpose')
        else program.edit({ ...settings, transpose: { ...settings.transpose, enabled: !settings.transpose.enabled } })
        return
      case 'effects-delay-tap':
        if (shifted) {
          program.edit(panelUpdate(settings, 'effects-delay-sync', !panelValue(settings, 'effects-delay-sync')?.value, false) ?? settings)
        } else {
          const time = now()
          const elapsed = time - (lastDelayTap.current ?? -Infinity)
          lastDelayTap.current = time
          if (elapsed >= 200 && elapsed <= 2000) program.edit(tapDelay(settings, Math.round(60000 / elapsed)))
        }
        return
      case 'piano-model': setEditor('piano'); return
      case 'synth-mode': setEditor('analog'); return
      case 'synth-osc-type': {
        const panels = ['analog', 'osc', 'filter', 'amp', 'pitch'] as const
        setEditor(panels[Number(value)])
        return
      }
      case 'synth-arp-menu': setEditor('arp'); return
      case 'synth-vibrato-menu': setEditor('vibrato'); return
      case 'synth-lfo-wave':
        if (shifted) { setEditor('lfo'); return }
        break
      case 'synth-osc-pitch-mode':
        if (!shifted) { setEditor('pitch'); return }
        break
      case 'synth-filter-resonance':
        if (shifted) { setEditor('tracking'); return }
        break
      case 'synth-osc-envelope': case 'synth-filter-envelope': case 'synth-amp-envelope':
        if (!shifted) { setEditor(id.split('-')[1] as Editor); return }
        break
      case 'synth-osc-category':
        if (Number(value) === categories.indexOf(synthState(settings).category)) return
        break
    }
    const next = panelUpdate(settings, id, value, shifted)
    if (next) {
      const assigned = source ? assignMorph(settings, source, id, next) : undefined
      program.edit(assigned ?? next)
      return
    }
    if (unsupportedControls[id]) return 'unsupported'
  }

  function open(next: Editor) {
    setEditor(next)
  }

  function selectWave(category: typeof categories[number], wave: number) {
    program.edit(editSynth(settings, { category, wave }))
  }

  return useMemo(() => ({
    editor, open, close, describe, maximum, longPress, pressMorph, update, selectWave, storeName,
    supportsHold: (id: string) => ['program-split', 'program-master-clock', 'program-transpose'].includes(id),
    isMorphSource: (id: string) => Boolean(morphSource(id)),
  }), [settings, program, now, panic, editor, programShift, effectsShift, latched, held])
}

export type PanelActions = ReturnType<typeof usePanelActions>
