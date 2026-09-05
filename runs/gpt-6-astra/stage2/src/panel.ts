import type { Control } from './hardware'
import { LayeredPianoEngine } from './layer-audio'
import { effectTypes, pianoTypes, timbres, type LayerId, type UnitId } from './phase2-state'
export function panelBinding(engine: LayeredPianoEngine, c: Control): { value: number; text: string; change: (value: number, shift?: boolean) => void } | undefined {
  const s = engine.state, layer = s.focus, p = s.layers[layer]
  const dial = (value: number, change: (value: number) => void, text = `${Math.round(value)} percent`) => ({ value, text, change: (value: number) => change(Math.round(Math.max(0, Math.min(100, value)))) })
  const button = (on: boolean, text: string, action: (shift?: boolean) => void) => ({ value: on ? 1 : 0, text, change: (_value: number, shift?: boolean) => action(shift) })
  if (c.id === 'performance-master-level') return dial(s.master * 100, v => engine.set({ master: v / 100 }))
  if (c.id === 'performance-pitch-stick') return dial((s.bend + 1) * 50, v => engine.set({ bend: (v - 50) / 50 }), `${(s.bend * 2).toFixed(2)} semitones`)
  if (c.id === 'performance-rotary-drive') return dial(s.rotary.drive * 100, v => engine.set({ rotary: { ...s.rotary, drive: v / 100 } }))
  if (c.id === 'performance-rotary-on') return button(s.rotary.on, s.rotary.on ? 'On' : 'Bypassed', () => engine.set({ rotary: { ...s.rotary, on: !s.rotary.on } }))
  if (c.id === 'performance-slow-fast') return button(s.rotary.fast, s.rotary.fast ? 'Fast' : 'Slow', () => engine.set({ rotary: { ...s.rotary, fast: !s.rotary.fast } }))
  if (c.section === 'piano') {
    const layerMatch = c.id.match(/^piano-layer-([ab])(-level)?$/)
    if (layerMatch) {
      const id = layerMatch[1].toUpperCase() as LayerId
      return layerMatch[2] ? dial(s.layers[id].level * 100, v => engine.setLayer(id, { level: v / 100 })) : button(s.layers[id].enabled, `${s.layers[id].enabled ? 'On' : 'Off'} · ${s.focus === id ? 'focused' : 'click to focus; Shift to focus only'}`, shift => { engine.focus(id); if (!shift) engine.setLayer(id, { enabled: !s.layers[id].enabled }) })
    }
    if (c.id === 'piano-piano-type') return button(pianoTypes.indexOf(p.type) > 0, p.type, () => engine.setLayer(layer, { type: pianoTypes[(pianoTypes.indexOf(p.type) + 1) % 6], timbre: 0, model: 0 }))
    if (c.id === 'piano-piano-timbre') return button(p.timbre > 0, timbres(p.type)[p.timbre], () => engine.setLayer(layer, { timbre: (p.timbre + 1) % timbres(p.type).length }))
    if (c.id === 'piano-piano-model') return dial(p.model, v => engine.setLayer(layer, { model: v }), 'One model available for this type')
    if (c.id === 'piano-kb-touch') return button(p.touch > 0, ['Heavy', 'Medium', 'Light'][p.touch], () => engine.setLayer(layer, { touch: (p.touch + 1) % 3 }))
    if (c.id === 'piano-dyn-comp') return button(p.dynComp > 0, ['Off', '1', '2', '3'][p.dynComp], () => engine.setLayer(layer, { dynComp: (p.dynComp + 1) % 4 }))
    if (c.id === 'piano-unison') return button(p.unison > 0, ['Off', '1', '2', '3'][p.unison], () => engine.setLayer(layer, { unison: (p.unison + 1) % 4 }))
    const toggles = { 'piano-sustped': 'sustped', 'piano-pstick': 'pstick', 'piano-soft-release': 'softRelease', 'piano-string-resonance': 'stringRes' } as const
    if (c.id in toggles) { const prop = toggles[c.id as keyof typeof toggles]; return button(p[prop], prop === 'softRelease' && p.type === 'Clav' ? 'Disabled for Clav' : p[prop] ? 'On' : 'Off', () => engine.setLayer(layer, { [prop]: !p[prop] })) }
    if (c.id === 'piano-octave-down' || c.id === 'piano-octave-up') return button(c.id.endsWith('up') ? p.octave === 1 : p.octave === -1, `${p.octave * 12} semitones`, () => engine.setLayer(layer, { octave: Math.max(-1, Math.min(1, p.octave + (c.id.endsWith('up') ? 1 : -1))) }))
  }
  if (c.section === 'effects') {
    const focus = c.id.match(/^effects-(organ|piano|synth)-focus$/)
    if (focus) { const section = ({ organ: 'Organ', piano: 'Piano', synth: 'Synth' } as const)[focus[1] as 'organ' | 'piano' | 'synth']; return button(s.fxSection === section, section === 'Piano' ? `Piano ${s.fxFocus}` : `${section} inactive this phase`, () => engine.focusEffects(section)) }
    if (/^effects-layer-[ab]-focus$/.test(c.id)) { const id = c.id.includes('-a-') ? 'A' : 'B'; return button(s.fxFocus === id, `Piano ${id}`, () => engine.focusEffects('Piano', id)) }
    if (s.fxSection !== 'Piano') return undefined
    const prefix: Record<string, UnitId> = { 'mod-1': 'mod1', 'mod-2': 'mod2', 'amp-eq': 'ampEq', delay: 'delay', reverb: 'reverb', compressor: 'compressor' }
    for (const [name, unit] of Object.entries(prefix)) {
      const e = s.layers[s.fxFocus].effects[unit]
      if (c.id === `effects-${name}-on`) return button(e.on, `${e.on ? 'On' : 'Bypassed'}${unit in s.globals ? ' · Shift+click for global' : ''}`, shift => { if (shift && unit in s.globals) engine.global(unit as keyof typeof s.globals, !s.globals[unit as keyof typeof s.globals]); else engine.effect(unit, { on: !e.on }) })
      if (c.id === `effects-${name}-selector`) return button(e.type > 0, effectTypes[unit][e.type], () => engine.effect(unit, { type: (e.type + 1) % effectTypes[unit].length }))
      if (c.id === `effects-${name}-rate`) { const prop = unit === 'reverb' ? 'tone' : 'rate'; return dial(e[prop] * 100, v => engine.effect(unit, { [prop]: v / 100 }), unit === 'reverb' ? `Brightness ${Math.round(e.tone * 100)} percent` : unit === 'delay' ? `${Math.round((.06 + e.rate * 1.44) * 1000)} ms` : `${Math.round(e.rate * 100)} percent`) }
      if (c.id === `effects-${name}-amount`) { const prop = unit === 'delay' || unit === 'reverb' ? 'wet' : 'amount'; return dial(e[prop] * 100, v => engine.effect(unit, { [prop]: v / 100 })) }
    }
    const custom = { 'effects-eq-bass': ['ampEq', 'bass'], 'effects-eq-mid': ['ampEq', 'mid'], 'effects-delay-feedback': ['delay', 'feedback'], 'effects-reverb-tone': ['reverb', 'tone'] } as const
    if (c.id in custom) { const [unit, prop] = custom[c.id as keyof typeof custom], value = s.layers[s.fxFocus].effects[unit][prop], eq = prop === 'bass' || prop === 'mid'; return dial(eq ? (value + 15) / .3 : value * 100, v => engine.effect(unit, { [prop]: eq ? v * .3 - 15 : v / 100 }), eq ? `${value.toFixed(1)} dB` : `${Math.round(value * 100)} percent`) }
    if (c.id === 'effects-delay-tap-tempo') return button(false, `${Math.round(s.bpm)} BPM`, () => engine.tap())
  }
  return undefined
}
