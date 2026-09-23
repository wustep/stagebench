// Phase 3 panel bindings for the Organ and Synth sections (organ and synth specs): every control
// writes canonical SoundState for the focused layer, and the panel shows that state back. The
// Synth OLED's three dials edit the parameters of the page opened by the section's page buttons
// (manual p. 27). Shift functions follow the panel legends; a Shift function the specs exclude is
// ignored (and listed as unsupported), never faked.
import { ORGAN_MODELS, VIB_TYPES, type OrganLayerId, type OrganLayerState } from '../organState'
import {
  ARP_DIRECTIONS,
  ARP_MODES,
  defaultSynthLayer,
  DRIVE_LEVELS,
  FILTER_TYPES,
  KB_TRACK,
  LFO_DESTS,
  LFO_WAVE_NAMES,
  LFO_WAVES,
  PRIORITIES,
  SYNTH_WAVES,
  VIBRATO_MODES,
  VOICE_MODES,
  WAVE_CATEGORIES,
  waveDef,
  type SynthLayerId,
  type SynthLayerState,
} from '../synthState'
import { stepZone } from '../zones'
import { pressSlotButton, slotOf, updateOrganLayer, updateSlot, updateSynthLayer, type SectionId, type SoundState } from '../sound'

export type SynthPage = 'wave' | 'pitch' | 'oscEnv' | 'filter' | 'filterEnv' | 'ampEnv' | 'lfo' | 'arp' | 'vibrato'

export interface SectionCtx {
  shift: boolean
  page: SynthPage
}

export interface SectionResult {
  sound: SoundState
  page?: SynthPage
}

export const ORGAN_SYNTH_FUNCTIONAL: Readonly<Record<string, string>> = {
  'organ-on': 'Organ section on/off',
  'organ-level-a': 'Organ layer A level (morphable)',
  'organ-level-b': 'Organ layer B level (morphable)',
  'organ-layer-a': 'Organ layer A on/focus/off (Shift: SUSTPED for the focused layer)',
  'organ-layer-b': 'Organ layer B on/focus/off (Shift: PSTICK for the focused layer)',
  'organ-octave-down': 'Organ octave shift down, focused layer (Shift: KB zone)',
  'organ-octave-up': 'Organ octave shift up, focused layer (Shift: KB zone)',
  'organ-model': 'Organ model of the focused layer: Farf, Vox, B3, Pipe 1, Pipe 2, B3 Bass',
  'organ-vibchorus-type': 'Vibrato/chorus type V1–V3, C1–C3',
  'organ-vibchorus-on': 'Vibrato/chorus on for the focused organ layer',
  'organ-perc-volume': 'B3 percussion volume soft',
  'organ-perc-decay': 'B3 percussion decay fast',
  'organ-perc-harmonic': 'B3 percussion harmonic third',
  'organ-perc-on': 'B3 percussion on',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`organ-drawbar-${i + 1}`, `Drawbar ${i + 1} of the focused organ layer (morphable)`])),
  'synth-on': 'Synth section on/off',
  'synth-level-a': 'Synth layer A level (morphable)',
  'synth-level-b': 'Synth layer B level (morphable)',
  'synth-level-c': 'Synth layer C level (morphable)',
  'synth-layer-a': 'Synth layer A on/focus/off (Shift: SUSTPED for the focused layer)',
  'synth-layer-b': 'Synth layer B on/focus/off (Shift: PSTICK for the focused layer)',
  'synth-layer-c': 'Synth layer C on/focus/off (Shift+C Pan is unsupported)',
  'synth-octave-down': 'Synth octave shift down, focused layer (Shift: KB zone)',
  'synth-octave-up': 'Synth octave shift up, focused layer (Shift: KB zone)',
  'synth-sound-init': 'Synth waveform: next waveform, opens the waveform page (Shift: Sound Init of the focused layer)',
  'synth-info': 'Synth OLED dial 1: first parameter of the open page',
  'synth-list-1': 'Synth OLED dial 2: second parameter of the open page',
  'synth-list-2': 'Synth OLED dial 3: third parameter of the open page',
  'synth-arp-rate': 'Arpeggiator/gate rate (morphable; Shift + turn: MST CLK sync)',
  'synth-arp-mode': 'Arpeggiator mode Poly/Arp/Gate',
  'synth-arp-range': 'Arpeggiator range 1–4 octaves (Gate: gate hardness)',
  'synth-arp-menu': 'Arpeggiator page: direction, MST CLK sync, mode',
  'synth-voice': 'Voice mode Poly/Mono/Legato (Shift: note priority)',
  'synth-glide': 'Glide (constant-rate portamento in Mono/Legato)',
  'synth-vibrato': 'Vibrato source Off/Wheel/Delayed/On',
  'synth-vibrato-menu': 'Vibrato page: mode, rate 2–8 Hz, amount',
  'synth-kb-hold': 'KB Hold: synth notes and arpeggios keep running after keys are lifted',
  'synth-arp-run': 'Arpeggiator run (Shift: KB SYNC = master clock keyboard sync)',
  'synth-lfo-waveform': 'LFO waveform, opens the LFO page',
  'synth-lfo-mod-amt': 'LFO modulation amount (morphable)',
  'synth-lfo-rate': 'LFO rate (morphable; Shift + turn: MST CLK sync)',
  'synth-lfo-dest': 'LFO destination: off, Osc Pitch, Osc Ctrl, Filter',
  'synth-osc-pitch': 'Oscillator pitch page: coarse ±24, fine ±50 (Shift: Env To Pitch)',
  'synth-osc-envelope': 'Oscillator envelope page (Shift: velocity)',
  'synth-osc-ctrl': 'Osc Ctrl, per waveform category (morphable)',
  'synth-osc-env-amt': 'Oscillator envelope amount (bipolar)',
  'synth-filter-type': 'Filter type LP12/LP24/HP/BP, opens the filter page (tracking, drive)',
  'synth-filter-envelope': 'Filter envelope page (Shift: velocity)',
  'synth-filter-env-amt': 'Filter envelope amount',
  'synth-filter-freq': 'Filter cutoff (morphable)',
  'synth-filter-res': 'Filter resonance (morphable)',
  'synth-filter-on': 'Filter on/off',
  'synth-amp-envelope': 'Amplifier envelope page (Shift: velocity level Off/1/2/3)',
  'synth-unison': 'Unison Off/1/2/3',
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const next = <T>(list: readonly T[], cur: T, d = 1) => list[(((list.indexOf(cur) + d) % list.length) + list.length) % list.length]

const organFocus = (s: SoundState) => s.organ.layers[s.organ.focus]
const synthFocus = (s: SoundState) => s.synth.layers[s.synth.focus]
const setOrgan = (s: SoundState, patch: Partial<OrganLayerState>) => updateOrganLayer(s, s.organ.focus, patch)
const setSynth = (s: SoundState, patch: Partial<SynthLayerState>) => updateSynthLayer(s, s.synth.focus, patch)

function octave(s: SoundState, section: SectionId, delta: number, shift: boolean): SoundState {
  const layer = section === 'organ' ? organFocus(s) : section === 'synth' ? synthFocus(s) : s.piano.layers[s.piano.focus]
  const slot = slotOf(section, s[section].focus)
  if (shift) return updateSlot(s, slot, { zone: stepZone(layer.zone, delta) })
  return updateSlot(s, slot, { octave: clamp(layer.octave + delta, -1, 1) })
}

/** Octave buttons of any section (Shift: KB zone of the focused layer, manual p. 39). */
export function octaveButton(s: SoundState, id: string, shift: boolean): SoundState | null {
  const m = /^(organ|piano|synth)-octave-(down|up)$/.exec(id)
  if (!m) return null
  return octave(s, m[1] as SectionId, m[2] === 'up' ? 1 : -1, shift)
}

/** Sound Init: the focused synth layer's sound back to defaults (enable, level, zone and octave kept). */
export function soundInit(s: SoundState): SoundState {
  const l = synthFocus(s)
  const init = defaultSynthLayer(l.enabled)
  return setSynth(s, { ...init, enabled: l.enabled, level: l.level, zone: l.zone, octave: l.octave, sustPed: l.sustPed, pStick: l.pStick })
}

/** A button press on an Organ/Synth control → next state (null = not bound here). */
export function activateSection(s: SoundState, id: string, ctx: SectionCtx): SectionResult | null {
  const o = organFocus(s)
  const y = synthFocus(s)
  const shift = ctx.shift
  const oct = octaveButton(s, id, shift)
  if (oct) return { sound: oct }
  switch (id) {
    case 'organ-on':
      return { sound: { ...s, organ: { ...s.organ, on: !s.organ.on } } }
    case 'organ-layer-a':
      return { sound: shift ? setOrgan(s, { sustPed: !o.sustPed }) : pressSlotButton(s, 'organA') }
    case 'organ-layer-b':
      return { sound: shift ? setOrgan(s, { pStick: !o.pStick }) : pressSlotButton(s, 'organB') }
    case 'organ-model':
      return { sound: setOrgan(s, { model: next(ORGAN_MODELS, o.model) }) }
    case 'organ-vibchorus-type':
      return { sound: { ...s, organ: { ...s.organ, vibType: next(VIB_TYPES, s.organ.vibType) } } }
    case 'organ-vibchorus-on':
      return { sound: setOrgan(s, { vibOn: !o.vibOn }) }
    case 'organ-perc-volume':
      return { sound: setOrgan(s, { perc: { ...o.perc, soft: !o.perc.soft } }) }
    case 'organ-perc-decay':
      return { sound: setOrgan(s, { perc: { ...o.perc, fast: !o.perc.fast } }) }
    case 'organ-perc-harmonic':
      return { sound: setOrgan(s, { perc: { ...o.perc, third: !o.perc.third } }) }
    case 'organ-perc-on':
      return { sound: setOrgan(s, { perc: { ...o.perc, on: !o.perc.on } }) }
    case 'synth-on':
      return { sound: { ...s, synth: { ...s.synth, on: !s.synth.on } } }
    case 'synth-layer-a':
      return { sound: shift ? setSynth(s, { sustPed: !y.sustPed }) : pressSlotButton(s, 'synthA') }
    case 'synth-layer-b':
      return { sound: shift ? setSynth(s, { pStick: !y.pStick }) : pressSlotButton(s, 'synthB') }
    case 'synth-layer-c':
      // Shift+C is Pan: not in the synth spec, unsupported — ignored rather than faked.
      return { sound: shift ? s : pressSlotButton(s, 'synthC') }
    case 'synth-sound-init':
      if (shift) return { sound: soundInit(s), page: 'wave' }
      return { sound: setSynth(s, { wave: (y.wave + 1) % SYNTH_WAVES.length }), page: 'wave' }
    case 'synth-arp-mode':
      return { sound: setSynth(s, { arp: { ...y.arp, mode: next(ARP_MODES, y.arp.mode) } }) }
    case 'synth-arp-menu':
      // Shift+Menu is Arp Group mode: excluded by the synth spec.
      return { sound: s, page: 'arp' }
    case 'synth-voice':
      if (shift) return { sound: setSynth(s, { voice: { ...y.voice, priority: next(PRIORITIES, y.voice.priority) } }) }
      return { sound: setSynth(s, { voice: { ...y.voice, mode: next(VOICE_MODES, y.voice.mode) } }) }
    case 'synth-vibrato':
      return { sound: setSynth(s, { vibrato: { ...y.vibrato, mode: next(VIBRATO_MODES, y.vibrato.mode) } }) }
    case 'synth-vibrato-menu':
      return { sound: s, page: 'vibrato' }
    case 'synth-kb-hold':
      // Shift+KB Hold is per-layer Exclude: excluded by the synth spec.
      return { sound: shift ? s : { ...s, synth: { ...s.synth, kbHold: !s.synth.kbHold } } }
    case 'synth-arp-run':
      if (shift) return { sound: { ...s, clock: { ...s.clock, kbSync: !s.clock.kbSync } } }
      return { sound: setSynth(s, { arp: { ...y.arp, run: !y.arp.run } }) }
    case 'synth-lfo-waveform':
      // Shift+Waveform is LFO Group mode: excluded by the synth spec.
      if (shift) return { sound: s, page: 'lfo' }
      return { sound: setSynth(s, { lfo: { ...y.lfo, wave: next(LFO_WAVES, y.lfo.wave) } }), page: 'lfo' }
    case 'synth-lfo-dest':
      return { sound: setSynth(s, { lfo: { ...y.lfo, dest: next(LFO_DESTS, y.lfo.dest) } }) }
    case 'synth-osc-pitch':
      if (shift) return { sound: setSynth(s, { envToPitch: !y.envToPitch }), page: 'pitch' }
      return { sound: s, page: 'pitch' }
    case 'synth-osc-envelope':
      if (shift) return { sound: setSynth(s, { oscEnv: { ...y.oscEnv, velocity: !y.oscEnv.velocity } }), page: 'oscEnv' }
      return { sound: s, page: 'oscEnv' }
    case 'synth-filter-type':
      // Shift+Type is Filter Group mode: excluded by the synth spec.
      if (shift) return { sound: s, page: 'filter' }
      return { sound: setSynth(s, { filter: { ...y.filter, type: next(FILTER_TYPES, y.filter.type) } }), page: 'filter' }
    case 'synth-filter-envelope':
      if (shift) return { sound: setSynth(s, { filterEnv: { ...y.filterEnv, velocity: !y.filterEnv.velocity } }), page: 'filterEnv' }
      return { sound: s, page: 'filterEnv' }
    case 'synth-filter-on':
      return { sound: setSynth(s, { filter: { ...y.filter, on: !y.filter.on } }) }
    case 'synth-amp-envelope':
      if (shift) return { sound: setSynth(s, { ampEnv: { ...y.ampEnv, velocity: (y.ampEnv.velocity + 1) % 4 } }), page: 'ampEnv' }
      return { sound: s, page: 'ampEnv' }
    case 'synth-unison':
      return { sound: setSynth(s, { unison: (y.unison + 1) % 4 }) }
  }
  return null
}

/** A continuous Organ/Synth control moved → next state (null = not bound here). */
export function setSectionValue(s: SoundState, id: string, value: number, delta: number, ctx: SectionCtx): SoundState | null {
  const y = synthFocus(s)
  const drawbar = /^organ-drawbar-(\d)$/.exec(id)
  if (drawbar) {
    const i = Number(drawbar[1]) - 1
    const bars = organFocus(s).drawbars.map((d, j) => (j === i ? clamp(Math.round(value), 0, 8) : d))
    return setOrgan(s, { drawbars: bars })
  }
  const level = /^(organ|synth)-level-([abc])$/.exec(id)
  if (level) {
    const layer = level[2].toUpperCase()
    return level[1] === 'organ' ? updateOrganLayer(s, layer as OrganLayerId, { level: value }) : updateSynthLayer(s, layer as SynthLayerId, { level: value })
  }
  switch (id) {
    case 'synth-arp-rate':
      if (ctx.shift) return delta === 0 ? s : setSynth(s, { arp: { ...y.arp, sync: delta > 0 } })
      return setSynth(s, { arp: { ...y.arp, rate: value } })
    case 'synth-arp-range':
      return setSynth(s, { arp: { ...y.arp, range: value } })
    case 'synth-glide':
      return setSynth(s, { voice: { ...y.voice, glide: value } })
    case 'synth-lfo-mod-amt':
      return setSynth(s, { lfo: { ...y.lfo, amount: value } })
    case 'synth-lfo-rate':
      if (ctx.shift) return delta === 0 ? s : setSynth(s, { lfo: { ...y.lfo, sync: delta > 0 } })
      return setSynth(s, { lfo: { ...y.lfo, rate: value } })
    case 'synth-osc-ctrl':
      return setSynth(s, { oscCtrl: value })
    case 'synth-osc-env-amt':
      return setSynth(s, { oscEnvAmt: value })
    case 'synth-filter-env-amt':
      return setSynth(s, { filter: { ...y.filter, envAmt: value } })
    case 'synth-filter-freq':
      return setSynth(s, { filter: { ...y.filter, freq: value } })
    case 'synth-filter-res':
      return setSynth(s, { filter: { ...y.filter, res: value } })
  }
  return null
}

// ---- Synth OLED pages: three dial parameters each ----

export interface DialParam {
  label: string
  text: (l: SynthLayerState, s: SoundState) => string
  step: (s: SoundState, l: SynthLayerState, d: number) => SoundState
}

const envParam = (key: 'oscEnv' | 'filterEnv' | 'ampEnv', part: 'attack' | 'decay' | 'release', label: string): DialParam => ({
  label,
  text: (l) => (part === 'decay' && l[key].decay >= 127 ? 'Sustain' : String(l[key][part])),
  step: (s, l, d) => setSynth(s, { [key]: { ...l[key], [part]: clamp(l[key][part] + 2 * d, 0, 127) } } as Partial<SynthLayerState>),
})

const cycleParam = <T>(label: string, list: readonly T[], get: (l: SynthLayerState) => T, set: (l: SynthLayerState, v: T) => Partial<SynthLayerState>, name: (v: T) => string = String): DialParam => ({
  label,
  text: (l) => name(get(l)),
  step: (s, l, d) => setSynth(s, set(l, list[clamp(list.indexOf(get(l)) + Math.sign(d), 0, list.length - 1)])),
})

const onOff = (label: string, get: (l: SynthLayerState) => boolean, set: (l: SynthLayerState, v: boolean) => Partial<SynthLayerState>): DialParam => ({
  label,
  text: (l) => (get(l) ? 'On' : 'Off'),
  step: (s, l, d) => (d === 0 ? s : setSynth(s, set(l, d > 0))),
})

export const SYNTH_PAGES: Record<SynthPage, { title: string; dials: [DialParam, DialParam, DialParam] }> = {
  wave: {
    title: 'WAVEFORM',
    dials: [
      {
        label: 'Category',
        text: (l) => waveDef(l.wave).category,
        step: (s, l, d) => {
          const cat = WAVE_CATEGORIES[clamp(WAVE_CATEGORIES.indexOf(waveDef(l.wave).category) + Math.sign(d), 0, WAVE_CATEGORIES.length - 1)]
          return setSynth(s, { wave: SYNTH_WAVES.findIndex((w) => w.category === cat) })
        },
      },
      { label: 'Wave', text: (l) => waveDef(l.wave).name, step: (s, l, d) => setSynth(s, { wave: clamp(l.wave + Math.sign(d), 0, SYNTH_WAVES.length - 1) }) },
      { label: 'Osc Ctrl', text: (l) => (waveDef(l.wave).category === 'Pure' ? `${(l.oscCtrl / 12.7).toFixed(1)} (no effect)` : (l.oscCtrl / 12.7).toFixed(1)), step: (s, l, d) => setSynth(s, { oscCtrl: clamp(l.oscCtrl + d, 0, 127) }) },
    ],
  },
  pitch: {
    title: 'OSC PITCH',
    dials: [
      { label: 'Coarse', text: (l) => `${l.pitch.coarse > 0 ? '+' : ''}${l.pitch.coarse} st`, step: (s, l, d) => setSynth(s, { pitch: { ...l.pitch, coarse: clamp(l.pitch.coarse + Math.sign(d), -24, 24) } }) },
      { label: 'Fine', text: (l) => `${l.pitch.fine > 0 ? '+' : ''}${l.pitch.fine} ct`, step: (s, l, d) => setSynth(s, { pitch: { ...l.pitch, fine: clamp(l.pitch.fine + d, -50, 50) } }) },
      onOff('Env→Pitch', (l) => l.envToPitch, (_l, v) => ({ envToPitch: v })),
    ],
  },
  oscEnv: { title: 'OSC ENV', dials: [envParam('oscEnv', 'attack', 'Attack'), envParam('oscEnv', 'decay', 'Decay'), envParam('oscEnv', 'release', 'Release')] },
  filter: {
    title: 'FILTER',
    dials: [
      cycleParam('Type', FILTER_TYPES, (l) => l.filter.type, (l, v) => ({ filter: { ...l.filter, type: v } })),
      cycleParam('KB Track', [0, 1, 2, 3], (l) => l.filter.track, (l, v) => ({ filter: { ...l.filter, track: v } }), (v) => KB_TRACK[v]),
      cycleParam('Drive', [0, 1, 2, 3], (l) => l.filter.drive, (l, v) => ({ filter: { ...l.filter, drive: v } }), (v) => DRIVE_LEVELS[v]),
    ],
  },
  filterEnv: { title: 'FILTER ENV', dials: [envParam('filterEnv', 'attack', 'Attack'), envParam('filterEnv', 'decay', 'Decay'), envParam('filterEnv', 'release', 'Release')] },
  ampEnv: { title: 'AMP ENV', dials: [envParam('ampEnv', 'attack', 'Attack'), envParam('ampEnv', 'decay', 'Decay'), envParam('ampEnv', 'release', 'Release')] },
  lfo: {
    title: 'LFO',
    dials: [
      cycleParam('Wave', LFO_WAVES, (l) => l.lfo.wave, (l, v) => ({ lfo: { ...l.lfo, wave: v } }), (v) => LFO_WAVE_NAMES[v]),
      cycleParam('Dest', LFO_DESTS, (l) => l.lfo.dest, (l, v) => ({ lfo: { ...l.lfo, dest: v } }), (v) => ({ off: 'Off', pitch: 'Osc Pitch', ctrl: 'Osc Ctrl', filter: 'Filter' })[v]),
      onOff('MST CLK', (l) => l.lfo.sync, (l, v) => ({ lfo: { ...l.lfo, sync: v } })),
    ],
  },
  arp: {
    title: 'ARPEGGIATOR',
    dials: [
      cycleParam('Direction', ARP_DIRECTIONS, (l) => l.arp.direction, (l, v) => ({ arp: { ...l.arp, direction: v } }), (v) => ({ up: 'Up', down: 'Down', upDown: 'Up/Down', random: 'Random' })[v]),
      onOff('MST CLK', (l) => l.arp.sync, (l, v) => ({ arp: { ...l.arp, sync: v } })),
      cycleParam('Mode', ARP_MODES, (l) => l.arp.mode, (l, v) => ({ arp: { ...l.arp, mode: v } }), (v) => ({ poly: 'Poly', arp: 'Arp', gate: 'Gate' })[v]),
    ],
  },
  vibrato: {
    title: 'VIBRATO',
    dials: [
      cycleParam('Mode', VIBRATO_MODES, (l) => l.vibrato.mode, (l, v) => ({ vibrato: { ...l.vibrato, mode: v } }), (v) => ({ off: 'Off', wheel: 'Wheel', delay: 'Delayed', on: 'On' })[v]),
      { label: 'Rate', text: (l) => `${(2 + (6 * l.vibrato.rate) / 127).toFixed(1)} Hz`, step: (s, l, d) => setSynth(s, { vibrato: { ...l.vibrato, rate: clamp(l.vibrato.rate + 2 * d, 0, 127) } }) },
      { label: 'Amount', text: (l) => ((10 * l.vibrato.amount) / 127).toFixed(1), step: (s, l, d) => setSynth(s, { vibrato: { ...l.vibrato, amount: clamp(l.vibrato.amount + 2 * d, 0, 127) } }) },
    ],
  },
}

export const SYNTH_DIALS = ['synth-info', 'synth-list-1', 'synth-list-2'] as const

/** One of the three Synth OLED dials turned by `delta` detents on the open page. */
export function stepSynthDial(s: SoundState, id: string, delta: number, page: SynthPage): SoundState | null {
  const i = (SYNTH_DIALS as readonly string[]).indexOf(id)
  if (i < 0) return null
  return SYNTH_PAGES[page].dials[i].step(s, synthFocus(s), delta)
}

// ---- presentation ----

const PAGE_BUTTONS: Record<string, SynthPage> = {
  'synth-osc-pitch': 'pitch',
  'synth-osc-envelope': 'oscEnv',
  'synth-filter-type': 'filter',
  'synth-filter-envelope': 'filterEnv',
  'synth-amp-envelope': 'ampEnv',
  'synth-lfo-waveform': 'lfo',
}

export function sectionPresentation(s: SoundState, page: SynthPage): Record<string, number> {
  const o = organFocus(s)
  const y = synthFocus(s)
  const out: Record<string, number> = {
    'organ-on': s.organ.on ? 1 : 0,
    'organ-level-a': s.organ.layers.A.level,
    'organ-level-b': s.organ.layers.B.level,
    'organ-layer-a': s.organ.layers.A.enabled ? 1 : 0,
    'organ-layer-b': s.organ.layers.B.enabled ? 1 : 0,
    'organ-model': ORGAN_MODELS.indexOf(o.model) + 1,
    'organ-vibchorus-type': VIB_TYPES.indexOf(s.organ.vibType) + 1,
    'organ-vibchorus-on': o.vibOn ? 1 : 0,
    'organ-perc-volume': o.perc.soft ? 1 : 0,
    'organ-perc-decay': o.perc.fast ? 1 : 0,
    'organ-perc-harmonic': o.perc.third ? 1 : 0,
    'organ-perc-on': o.perc.on ? 1 : 0,
    'synth-on': s.synth.on ? 1 : 0,
    'synth-level-a': s.synth.layers.A.level,
    'synth-level-b': s.synth.layers.B.level,
    'synth-level-c': s.synth.layers.C.level,
    'synth-layer-a': s.synth.layers.A.enabled ? 1 : 0,
    'synth-layer-b': s.synth.layers.B.enabled ? 1 : 0,
    'synth-layer-c': s.synth.layers.C.enabled ? 1 : 0,
    'synth-arp-rate': y.arp.rate,
    'synth-arp-mode': ARP_MODES.indexOf(y.arp.mode) + 1,
    'synth-arp-range': y.arp.range,
    'synth-voice': VOICE_MODES.indexOf(y.voice.mode),
    'synth-glide': y.voice.glide,
    'synth-vibrato': VIBRATO_MODES.indexOf(y.vibrato.mode),
    'synth-kb-hold': s.synth.kbHold ? 1 : 0,
    'synth-arp-run': y.arp.run ? 1 : 0,
    'synth-lfo-mod-amt': y.lfo.amount,
    'synth-lfo-rate': y.lfo.rate,
    'synth-lfo-dest': LFO_DESTS.indexOf(y.lfo.dest),
    'synth-osc-ctrl': y.oscCtrl,
    'synth-osc-env-amt': y.oscEnvAmt,
    'synth-filter-env-amt': y.filter.envAmt,
    'synth-filter-freq': y.filter.freq,
    'synth-filter-res': y.filter.res,
    'synth-filter-on': y.filter.on ? 1 : 0,
    'synth-unison': y.unison,
    // The Analog mode LED stays lit: Samples (optional) and Extern (excluded) are unsupported.
    'synth-mode': 2,
  }
  o.drawbars.forEach((d, i) => (out[`organ-drawbar-${i + 1}`] = d))
  for (const [id, p] of Object.entries(PAGE_BUTTONS)) out[id] = page === p ? 1 : 0
  return out
}

type Ind = 'on' | 'off' | 'flash'
const on = (b: boolean): Ind => (b ? 'on' : 'off')

export function sectionIndicators(s: SoundState, page: SynthPage): Record<string, Ind> {
  const o = organFocus(s)
  const y = synthFocus(s)
  const out: Record<string, Ind> = {
    'organ-led-fx-focus': on(s.fx.focus === 'organ'),
    'synth-led-fx-focus': on(s.fx.focus === 'synthA' || s.fx.focus === 'synthB' || s.fx.focus === 'synthC'),
    'organ-led-sustped': on(o.sustPed),
    'organ-led-pstick': on(o.pStick),
    'synth-led-sustped': on(y.sustPed),
    'synth-led-pstick': on(y.pStick),
    'synth-led-kb-sync': on(s.clock.kbSync),
    'synth-led-glide-lo': on(y.voice.priority === 'low'),
    'synth-led-glide-hi': on(y.voice.priority === 'high'),
    'synth-led-arp-menu': on(page === 'arp'),
    'synth-led-vibrato-menu': on(page === 'vibrato'),
    'synth-led-osc-env-to-pitch': on(y.envToPitch),
    'synth-led-osc-velocity': on(y.oscEnv.velocity),
    'synth-led-filter-velocity': on(y.filterEnv.velocity),
    'synth-led-amp-velocity-1': on(y.ampEnv.velocity === 1 || y.ampEnv.velocity === 3),
    'synth-led-amp-velocity-2': on(y.ampEnv.velocity >= 2),
    'synth-led-arp-mst-clk': on(y.arp.sync),
    'synth-led-lfo-mst-clk': on(y.lfo.sync),
  }
  // With several layers on, the focused layer's LED blinks (manual p. 18, 27).
  const ob = s.organ.layers.A.enabled && s.organ.layers.B.enabled
  for (const l of ['A', 'B'] as const) out[`organ-led-${l.toLowerCase()}-on`] = ob && s.organ.focus === l ? 'flash' : on(s.organ.layers[l].enabled)
  const sEnabled = (['A', 'B', 'C'] as const).filter((l) => s.synth.layers[l].enabled).length
  for (const l of ['A', 'B', 'C'] as const) out[`synth-led-${l.toLowerCase()}-on`] = sEnabled > 1 && s.synth.focus === l ? 'flash' : on(s.synth.layers[l].enabled)
  return out
}

/** Accessible value text for the Synth OLED dials. */
export function synthDialText(s: SoundState, id: string, page: SynthPage): string | undefined {
  const i = (SYNTH_DIALS as readonly string[]).indexOf(id)
  if (i < 0) return undefined
  const d = SYNTH_PAGES[page].dials[i]
  return `${d.label}: ${d.text(synthFocus(s), s)}`
}
