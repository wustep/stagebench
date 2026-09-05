import { controls, type Control } from './hardware'
import { panelBinding } from './panel'
import { SystemEngine } from './system-engine'
import { organModels, waves, type ExtraId, type Morph, type SynthLayer } from './system-state'
export const unsupportedControls: Record<string, string> = {
  'performance-close-mic': 'Effects: rotary close mic excluded',
  'organ-organ-preset': 'Organ preset library excluded', 'organ-drawbar-live': 'Physical drawbar live/sync excluded; virtual drawbars are always live',
  'program-aftertouch-morph': 'Aftertouch source excluded', 'program-preset-library': 'Section preset library excluded', 'program-monitor': 'Monitor/Copy/Paste/Swap excluded',
  'synth-synth-preset': 'Synth preset library excluded', 'effects-effects-variation': 'Per-type variations excluded',
}
export function morphPath(engine: SystemEngine, c: Control): string | undefined {
  const s = engine.system, layer = engine.state.focus
  if (c.id === 'performance-slow-fast') return 'system.rotarySpeed'
  if (c.id.startsWith('organ-drawbar-')) return `system.organ.${s.organFocus}.drawbars.${controls.filter(c => c.kind === 'drawbar').findIndex(x => x.id === c.id)}`
  const levels = c.id.match(/^(piano|organ|synth)-layer-([abc])-level$/)
  if (levels) return levels[1] === 'piano' ? `layers.${levels[2].toUpperCase()}.level` : `system.${levels[1]}.${levels[1] === 'organ' ? 'O' : 'S'}${levels[2]}.level`
  const synth: Record<string, string> = { 'synth-lfo-rate': 'lfoRate', 'synth-lfo-amount': 'lfoAmount', 'synth-osc-control': 'ctrl', 'synth-filter-cutoff': 'cutoff', 'synth-filter-resonance': 'resonance', 'synth-arp-rate': 'arpRate' }
  if (synth[c.id]) return `system.synth.${s.synthFocus}.${synth[c.id]}`
  const fx: Record<string, string> = { 'effects-mod-1-rate': 'mod1.rate', 'effects-mod-1-amount': 'mod1.amount', 'effects-mod-2-amount': 'mod2.amount', 'effects-delay-rate': 'delay.rate', 'effects-delay-feedback': 'delay.feedback', 'effects-delay-amount': 'delay.wet', 'effects-amp-eq-rate': 'ampEq.rate', 'effects-amp-eq-amount': 'ampEq.amount', 'effects-reverb-amount': 'reverb.wet' }
  if (fx[c.id]) return (engine.state.fxSection === 'Piano' ? `layers.${engine.state.fxFocus}.effects.` : engine.state.fxSection === 'Organ' ? 'system.organEffects.' : `system.synth.${s.fxExtra}.effects.`) + fx[c.id]
  if (layer) return undefined
}
export function systemBinding(e: SystemEngine, c: Control): ReturnType<typeof panelBinding> {
  if (unsupportedControls[c.id]) return undefined
  const s = e.system, state = e.state
  const dial = (value: number, action: (value: number) => void, text?: string) => ({ value, text: text ?? `${Math.round(value)} percent`, change: (v: number) => action(Math.max(0, Math.min(100, v))) })
  const button = (on: boolean, text: string, action: (shift: boolean) => void) => ({ value: +on, text, change: (_v: number, shift?: boolean) => action(!!shift || e.shift) })
  let binding: ReturnType<typeof panelBinding>
  if (c.id === 'performance-modulation-wheel') binding = dial(s.wheel * 100, v => e.morph('Wheel', v / 100))
  if (c.id === 'performance-stop-mode') binding = button(s.rotaryStop, 'Stop rotor', () => e.edit(s => { s.rotaryStop = !s.rotaryStop }))
  if (c.id === 'performance-slow-fast') binding = button(s.rotarySpeed > .5, `${s.rotarySpeed > .5 ? 'Fast' : 'Slow'} · Shift: continuous speed editor`, shift => { if (shift) e.editor = 'Performance'; else e.edit(s => { s.rotarySpeed = s.rotarySpeed > .5 ? 0 : 1 }); e.edit(() => {}) })
  if (c.id === 'performance-rotary-morph') binding = button(s.organRotary, 'Organ routing · assign speed via Wheel morph', () => e.edit(s => { s.organRotary = !s.organRotary }))
  if (c.section === 'program') {
    const slot = c.id.match(/program-program-(\d+)$/)
    if (slot) binding = button(e.selected % 8 === +slot[1] - 1, `${e.live ? 'Live' : 'Program'} ${+slot[1]}`, () => e.select(e.page * 8 + +slot[1] - 1))
    if (c.id === 'program-program-dial') binding = dial(e.selected / 31 * 100, v => { if (e.shift) { e.list = true; e.edit(() => {}) } else e.select(Math.round(v / 100 * (e.live ? 7 : 31))) }, e.displayName)
    if (c.id === 'program-page-previous' || c.id === 'program-page-next') binding = button(false, `Page ${e.page + 1}`, () => e.browsePage(c.id.endsWith('next') ? 1 : -1))
    if (c.id === 'program-store') binding = button(!!e.storePending, e.storePending ? 'Confirm Store; dial/buttons audition destination' : 'Store · Shift: Store As', shift => e.store(shift))
    if (c.id === 'program-exit') binding = button(false, 'Cancel / Exit', () => e.cancel())
    if (c.id === 'program-shift') binding = button(e.shift, 'Shift latch / Exit', () => { if (e.storePending) e.cancel(); else { e.shift = !e.shift; e.edit(() => {}) } })
    if (c.id === 'program-live-mode') binding = button(e.live, 'Eight auto-storing Live slots', () => e.toggleLive())
    if (c.id === 'program-layer-scene' || c.id === 'program-scene-a' || c.id === 'program-scene-b') binding = button(s.scene === (c.id.endsWith('-a') ? 0 : 1), `Scene ${s.scene ? 'II' : 'I'}`, () => e.scene(c.id.endsWith('-a') ? 0 : c.id.endsWith('-b') ? 1 : s.scene ? 0 : 1))
    if (c.id === 'program-split-on') binding = button(s.split, 'Split on · Shift: edit points and crossfades', shift => { e.edit(s => { if (!shift) s.split = !s.split }); e.editor = 'Splits'; e.edit(() => {}) })
    if (c.id === 'program-kb-zones') binding = button(e.editor === 'Splits', 'Edit contiguous layer zone ranges', () => { e.editor = 'Splits'; e.edit(() => {}) })
    if (c.id === 'program-master-clock') binding = button(e.editor === 'Performance', `${Math.round(state.bpm)} BPM · tap four times; Shift: BPM editor`, shift => { if (shift) e.editor = 'Performance'; e.masterTap() })
    if (c.id === 'program-transpose') binding = button(s.transpose !== 0, `${s.transpose} semitones · Shift: Panic`, shift => { if (shift) e.panic(); else e.editor = 'Performance'; e.edit(() => {}) })
    if (c.id === 'program-prog-view') binding = button(e.list, 'Numeric program list', () => { e.list = !e.list; e.edit(() => {}) })
    if (c.id === 'program-undo') binding = button(!!e.undoProgram, 'Restore last discarded edit', () => e.undo())
    if (c.id === 'program-panel-on') binding = button(state.sectionOn || s.organOn || s.synthOn, 'All sound sections on/off', () => { const on = !(state.sectionOn || s.organOn || s.synthOn); e.allOff(); e.set({ sectionOn: on }); e.edit(s => { s.organOn = on; s.synthOn = on }) })
    if (c.id === 'program-wheel-morph' || c.id === 'program-control-pedal-morph') { const source: Morph['source'] = c.id.includes('wheel') ? 'Wheel' : 'Control Pedal'; binding = button(e.morphSource === source || s.morphs.some(m => m.source === source), `${source}: click to latch assignment; Shift clears`, shift => { if (shift) e.clearMorph(source); else e.morphSource = e.morphSource === source ? undefined : source; e.editor = 'Morphs'; e.edit(() => {}) }) }
  }
  if (c.section === 'organ' || c.section === 'synth') {
    const organ = c.section === 'organ', id = organ ? s.organFocus : s.synthFocus, p = organ ? s.organ[s.organFocus] : s.synth[s.synthFocus]
    const match = c.id.match(/layer-([abc])(-level)?$/)
    if (match) { const layer = `${organ ? 'O' : 'S'}${match[1]}` as ExtraId, lp = organ ? s.organ[layer as 'Oa'] : s.synth[layer as 'Sa']; binding = match[2] ? dial(lp.level * 100, v => e.extraLayer(layer, { level: v / 100 })) : button(lp.enabled, `${lp.enabled ? 'On' : 'Off'} · Shift: focus only`, shift => { e.focusExtra(layer); if (!shift) e.extraLayer(layer, { enabled: !lp.enabled }) }) }
    if (c.id.endsWith('-sustped') || c.id.endsWith('-pstick')) { const prop = c.id.endsWith('sustped') ? 'sustped' : 'pstick'; binding = button(p[prop], prop, () => e.extraLayer(id, { [prop]: !p[prop] })) }
    if (c.id.includes('-octave-')) binding = button(false, `${p.octave * 12} semitones`, () => e.extraLayer(id, { octave: Math.max(-1, Math.min(1, p.octave + (c.id.endsWith('up') ? 1 : -1))) }))
    if (organ) {
      const o = s.organ[s.organFocus], index = controls.filter(c => c.kind === 'drawbar').findIndex(x => x.id === c.id)
      if (index >= 0) binding = dial(o.drawbars[index] * 12.5, v => { const drawbars = [...o.drawbars]; drawbars[index] = Math.round(v / 12.5); e.extraLayer(id, { drawbars }) }, `${o.drawbars[index]} / 8${o.model === 3 ? o.drawbars[index] > 4 ? ' · register on' : ' · register off' : ''}`)
      if (c.id === 'organ-organ-model') binding = button(true, organModels[o.model], () => e.extraLayer(id, { model: (o.model + 1) % 6 }))
      if (c.id === 'organ-vibrato-chorus' || c.id === 'organ-vibrato-mode') binding = button(o.vibrato, ['C1', 'C2', 'C3', 'V1', 'V2', 'V3'][o.chorus], () => e.extraLayer(id, { chorus: (o.chorus + 1) % 6 }))
      if (c.id === 'organ-vibrato-a' || c.id === 'organ-vibrato-b') { const target = c.id.endsWith('-a') ? 'Oa' : 'Ob'; binding = button(s.organ[target].vibrato, 'Vibrato/chorus on', () => e.extraLayer(target, { vibrato: !s.organ[target].vibrato })) }
      const props = { 'organ-percussion-on': 'percussion', 'organ-soft': 'soft', 'organ-fast': 'fast', 'organ-third': 'third', 'organ-percussion-mode': 'percussionPoly' } as const
      if (c.id in props) { const prop = props[c.id as keyof typeof props]; binding = button(o[prop], prop, () => e.extraLayer(id, { [prop]: !o[prop] })) }
    } else {
      const p = s.synth[s.synthFocus], set = (patch: Partial<SynthLayer>) => e.extraLayer(id, patch)
      const dialProps: Record<string, [keyof SynthLayer, number, number]> = { 'oscillator': ['wave', 0, 13], 'shape': ['fine', -50, 50], 'osc-control': ['ctrl', 0, 1], 'arp-rate': ['arpRate', 30, 300], 'arp-range': ['range', 1, 4], 'glide': ['glide', 0, 2], 'lfo-rate': ['lfoRate', .1, 20], 'lfo-amount': ['lfoAmount', 0, 1], 'filter-cutoff': ['cutoff', 0, 1], 'filter-resonance': ['resonance', 0, 1] }
      const prop = dialProps[c.id.slice(6)]
      if (prop) { const [key, min, max] = prop; binding = dial(((p[key] as number) - min) / (max - min) * 100, v => set({ [key]: ['wave', 'range'].includes(key) ? Math.round(min + v / 100 * (max - min)) : min + v / 100 * (max - min) }), key === 'wave' ? waves[p.wave] : key === 'ctrl' && p.wave < 7 ? 'Pure: Osc Ctrl has no effect (specified)' : `${key}: ${p[key]}`) }
      const cycles: Record<string, [keyof SynthLayer, number, string[]?]> = { 'waveform': ['wave', 14, [...waves]], 'voice-mode': ['mode', 3, ['Poly', 'Mono', 'Legato']], 'vibrato': ['vibrato', 3, ['Off', 'On', 'Wheel']], 'lfo-waveform': ['lfoWave', 5], 'filter-type': ['filter', 4, ['LP12', 'LP24', 'HP', 'BP']], 'amp-velocity': ['ampEnv', 4], 'arp-mode': ['arpMode', 3, ['Arp', 'Poly', 'Gate']] }
      const cycle = cycles[c.id.slice(6)]
      if (cycle) { const [key, count, names] = cycle; binding = button(true, names?.[p[key] as number] ?? key, () => key === 'ampEnv' ? set({ ampEnv: { ...p.ampEnv, velocity: (p.ampEnv.velocity + 1) % 4 } }) : set({ [key]: ((p[key] as number) + 1) % count })) }
      if (c.id === 'synth-lfo-destination') binding = button(p.lfoDest >= 0, ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'][p.lfoDest + 1], () => set({ lfoDest: (p.lfoDest + 2) % 4 - 1 }))
      if (['synth-arp-on', 'synth-arp-hold', 'synth-kb-hold'].includes(c.id)) { const key = c.id === 'synth-arp-on' ? 'arp' : 'hold'; binding = button(p[key], key, () => set({ [key]: !p[key] })) }
      if (c.id === 'synth-filter-velocity') binding = button(!!p.filterEnv.velocity, 'Filter envelope velocity', () => set({ filterEnv: { ...p.filterEnv, velocity: p.filterEnv.velocity ? 0 : 1 } }))
      if (c.id === 'synth-envelope-attack' || c.id === 'synth-envelope-decay') { const key = c.id.endsWith('attack') ? 'attack' : 'decay'; binding = dial(p.ampEnv[key] * 25, v => set({ ampEnv: { ...p.ampEnv, [key]: v / 25 } }), `Amp ${key}: ${p.ampEnv[key].toFixed(2)} s`) }
      if (c.id === 'synth-amp-envelope' || c.id === 'synth-sample-analog') binding = button(e.editor === 'Synth', 'Analog engine · edit three envelopes and synthesis parameters', () => { e.editor = 'Synth'; e.edit(() => {}) })
    }
  }
  if (c.id === 'effects-layer-c-focus' || /^effects-layer-[ab]-focus$/.test(c.id)) { const id = c.id.includes('-a-') ? 'a' : c.id.includes('-b-') ? 'b' : 'c'; binding = button(state.fxSection === 'Piano' ? state.fxFocus === id.toUpperCase() : s.fxExtra.endsWith(id), `FX layer ${id.toUpperCase()}`, () => { if (state.fxSection === 'Piano' && id !== 'c') e.focusEffects('Piano', id.toUpperCase() as 'A' | 'B'); else if (state.fxSection === 'Organ' && id !== 'c') e.focusExtra(`O${id}`); else e.focusExtra(`S${id}`) }) }
  binding ??= panelBinding(e, c)
  if (binding && e.morphSource) { const path = morphPath(e, c); if (path) { const original = binding, source = e.morphSource; binding = { ...original, text: `${original.text} · assign ${source}`, change: (v, shift) => { const before = structuredClone(e.state); original.change(v, shift); const end = path.split('.').reduce((o, k) => (o as Record<string, unknown>)[k], e.state as unknown) as number; e.state = before; e.assign(source, path, end) } } } }
  return binding
}
