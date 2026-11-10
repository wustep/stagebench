import { ENV_STEPS, clockDivision, lfoRate, arpBpm } from '../audio/dsp/params'
import { organModel, VIB_TYPES } from '../organ/catalog'
import type { ProgramBank } from '../programs/bank'
import {
  ARP_DIRECTIONS,
  ARP_MODES,
  FILTER_TYPES,
  KB_TRACKS,
  LFO_DESTS,
  LFO_WAVES,
  OSC_CTRL_ROLE,
  SYNTH_WAVEFORMS,
  VIBRATO_MODES,
  waveform,
  wavesOf,
} from '../synth/catalog'
import {
  LAYER_NAMES,
  LEVELS,
  NAME_CHARACTERS,
  NAME_LENGTH,
  PROGRAM_COUNT,
  SPLIT_POINT_NAMES,
  slotLabel,
  type StageState,
  type SynthPage,
} from './model'
import { describeEnvStep, describeSplit, formatHz, noteLabel } from './store'

/**
 * What the two displays say, as plain text. The React components only lay this out, so tests
 * and assistive technology read exactly what a sighted player reads.
 */

export interface ProgramDisplay {
  mode: StageState['ui']['mode']
  /** The top bar: where the program lives and what it is called. */
  header: string
  /** True when the loaded program differs from what is stored: the "E" next to its number. */
  edited: boolean
  /** Big line (editing pages only; the playing page shows the focused sound instead). */
  big: string
  /** Lines under it. */
  rows: string[]
}

function windowed<T>(items: readonly T[], centre: number, size: number): { start: number; items: T[] } {
  const start = Math.min(Math.max(0, centre - Math.floor(size / 2)), Math.max(0, items.length - size))
  return { start, items: items.slice(start, start + size) }
}

export function programHeader(state: StageState): string {
  return `${slotLabel(state.nav)} ${state.name}`
}

/** The Program display on its editing pages. On the playing page only the header is used. */
export function programDisplay(state: StageState, bank: ProgramBank): ProgramDisplay {
  const { ui, nav } = state
  const base = { mode: ui.mode, edited: nav.dirty, header: programHeader(state) }
  switch (ui.mode) {
    case 'list': {
      const names = bank.names()
      const view = windowed(names, ui.listCursor, 6)
      return {
        ...base,
        header: `PROGRAM LIST ${ui.listCursor + 1}/${PROGRAM_COUNT}`,
        big: '',
        rows: view.items.map((name, index) => {
          const slot = view.start + index
          // The loaded program shows its own (possibly unsaved) name.
          const shown = slot === nav.slot && !nav.live ? state.name : name
          return `${slot === ui.listCursor ? '>' : ' '}${slotLabel({ live: false, slot })} ${shown}`
        }),
      }
    }
    case 'store': {
      const dest = ui.store.dest
      return {
        ...base,
        header: 'STORE PROGRAM TO',
        big: `${slotLabel(dest)} ${bank.name(dest)}`,
        rows: [
          `STORING: ${ui.store.name.trim() || 'Untitled'}`,
          ui.audition ? 'KEYS PLAY THE DESTINATION' : 'DESTINATION IS THIS SLOT',
          'DIAL/PAGE/PROGRAM: CHOOSE',
          'LIVE MODE: LIVE SLOTS',
          'STORE: CONFIRM  SHIFT: CANCEL',
        ],
      }
    }
    case 'name': {
      const { name, cursor } = ui.store
      const padded = name.padEnd(NAME_LENGTH, ' ')
      const at = Math.max(0, NAME_CHARACTERS.indexOf(padded[cursor]))
      const strip = windowed(NAME_CHARACTERS.split(''), at, 21)
      return {
        ...base,
        header: 'STORE PROGRAM AS',
        big: padded.replace(/ /g, '·'),
        rows: [
          `${' '.repeat(cursor)}^`,
          strip.items.map((char, index) => (strip.start + index === at ? `[${char === ' ' ? '_' : char}]` : char === ' ' ? '_' : char)).join(''),
          'DIAL: CHARACTER  PAGE: CURSOR',
          'PROGRAM 1: INS  PROGRAM 2: DEL',
          'STORE: NEXT  SHIFT: CANCEL',
        ],
      }
    }
    case 'split': {
      const { points } = state.split
      const cell = (text: string, selected: boolean) => (selected ? `[${text}]` : ` ${text} `).padEnd(7, ' ')
      const xfade = points.map((point, index) => cell(point.xfade === 0 ? '-' : `±${point.xfade}`, ui.split.row === 'xfade' && ui.split.point === index))
      const note = points.map((point, index) => cell(point.on ? noteLabel(point.note) : 'Off', ui.split.row === 'note' && ui.split.point === index))
      return {
        ...base,
        header: 'KEYBOARD SPLIT',
        big: state.split.on ? describeSplit(state) : 'Split Off',
        rows: [
          `xFade ${xfade.join('')}`,
          `Note  ${note.join('')}`,
          `      ${SPLIT_POINT_NAMES.map((name, index) => cell(name, ui.split.point === index)).join('')}`,
          'PROGRAM 1: ROW  2-4: POINT',
          'DIAL: SET  SHIFT: EXIT',
        ],
      }
    }
    case 'clock':
      return {
        ...base,
        header: 'MASTER CLOCK',
        big: `${state.clock.bpm} BPM`,
        rows: [
          `KEYBOARD SYNC ${state.clock.kbSync ? 'ON' : 'OFF'}`,
          'DIAL: TEMPO  TAP 4 TIMES',
          'PROGRAM 1: KBS',
          'SHIFT: EXIT',
        ],
      }
    case 'transpose':
      return {
        ...base,
        header: 'TRANSPOSE',
        big: `${state.transpose.semitones > 0 ? '+' : ''}${state.transpose.semitones} semitones`,
        rows: [state.transpose.on ? 'TRANSPOSE ON' : 'TRANSPOSE OFF', 'DIAL: -6 .. +6', 'TRANSP: OFF  SHIFT: EXIT'],
      }
    default:
      return { ...base, big: '', rows: [] }
  }
}

// ── What the focused section is playing ───────────────────────────────────────

export interface SectionSummary {
  /** e.g. `ORGAN A:B3<  B:OFF`. The focused layer is marked with `<`. */
  layers: string
  /** Name of the focused layer's sound. */
  name: string
  /** One all-caps line about where that sound comes from. */
  source: string
}

export function organSummary(state: StageState): SectionSummary {
  const { organ } = state
  const layer = organ.layers[organ.focus]
  const info = organModel(layer.model)
  const layers = organ.layers
    .map((each, index) => `${LAYER_NAMES[index]}:${!organ.on || !each.on ? 'OFF' : organModel(each.model).name.toUpperCase()}${organ.focus === index ? '<' : ''}`)
    .join('  ')
  return {
    layers: `ORGAN ${layers}`,
    name: `${info.name} ${layer.drawbars.join('')}`,
    source: `SYNTHESIZED ${info.kind.toUpperCase()}${layer.vibOn ? ` ${VIB_TYPES[organ.vibType]}` : ''}`,
  }
}

export function synthSummary(state: StageState): SectionSummary {
  const { synth } = state
  const layer = synth.layers[synth.focus]
  const wave = waveform(layer.wave)
  const layers = synth.layers
    .map((each, index) => `${LAYER_NAMES[index]}:${!synth.on || !each.on ? 'OFF' : waveform(each.wave).category.toUpperCase()}${synth.focus === index ? '<' : ''}`)
    .join('  ')
  return { layers: `SYNTH ${layers}`, name: wave.name, source: `SYNTHESIZED ${wave.category.toUpperCase()} OSCILLATOR` }
}

// ── The Synth display ─────────────────────────────────────────────────────────

export interface SynthDisplay {
  page: SynthPage
  /** Top bar: layer and waveform. */
  bar: string
  title: string
  /** The three dials under the display: what each one edits and its value. An empty label is an unused dial. */
  dials: Array<{ label: string; value: string }>
  /** One more line of context under the dials. */
  footer: string
  /** Envelope shape for the envelope pages: times as fractions of the dial range. */
  curve: { attack: number; decay: number; release: number; sustain: boolean } | null
}

const PAGE_TITLES: Record<SynthPage, string> = {
  osc: 'OSCILLATOR',
  pitch: 'OSC PITCH',
  oscEnv: 'OSC MOD ENVELOPE',
  filter: 'FILTER',
  filterEnv: 'FILTER ENVELOPE',
  ampEnv: 'AMP ENVELOPE',
  lfo: 'LFO',
  arp: 'ARPEGGIATOR/GATE',
  vibrato: 'VIBRATO',
}

export function synthDisplay(state: StageState): SynthDisplay {
  const { synth, ui } = state
  const layer = synth.layers[synth.focus]
  const wave = waveform(layer.wave)
  const page = ui.synthPage
  const { bpm } = state.clock
  const base = {
    page,
    bar: `${LAYER_NAMES[synth.focus]} ${wave.name}${synth.on && layer.on ? '' : ' (OFF)'}`,
    title: PAGE_TITLES[page],
    curve: null,
  }
  const env = page === 'oscEnv' ? layer.oscEnv : page === 'filterEnv' ? layer.filterEnv : page === 'ampEnv' ? layer.ampEnv : null
  if (env) {
    const velocity =
      page === 'ampEnv'
        ? `VELOCITY ${LEVELS[layer.ampEnv.velocity].toUpperCase()}`
        : `VELOCITY ${(page === 'oscEnv' ? layer.oscEnv.velocity : layer.filterEnv.velocity) ? 'ON' : 'OFF'}`
    return {
      ...base,
      dials: [
        { label: 'ATTACK', value: describeEnvStep('attack', env.attack) },
        { label: 'DECAY', value: describeEnvStep('decay', env.decay) },
        { label: 'RELEASE', value: describeEnvStep('release', env.release) },
      ],
      footer: page === 'oscEnv' ? `${velocity}  TO ${layer.oscEnv.toPitch ? 'PITCH' : 'OSC CTRL'}` : velocity,
      curve: {
        attack: env.attack / ENV_STEPS,
        decay: env.decay / ENV_STEPS,
        release: env.release / ENV_STEPS,
        sustain: env.decay >= ENV_STEPS,
      },
    }
  }
  switch (page) {
    case 'pitch':
      return {
        ...base,
        dials: [
          { label: 'SEMI', value: `${layer.coarse > 0 ? '+' : ''}${layer.coarse}` },
          { label: 'FINE', value: `${layer.fine > 0 ? '+' : ''}${layer.fine} c` },
          { label: '', value: '' },
        ],
        footer: `ENV TO PITCH ${layer.oscEnv.toPitch ? 'ON' : 'OFF'}`,
      }
    case 'filter':
      return {
        ...base,
        dials: [
          { label: 'TYPE', value: FILTER_TYPES[layer.filter.type] },
          { label: 'KB TRACK', value: KB_TRACKS[layer.filter.track] },
          { label: 'DRIVE', value: LEVELS[layer.filter.drive] },
        ],
        footer: `FILTER ${layer.filter.on ? 'ON' : 'OFF'}  ${formatHz(Math.min(20000, 20 * Math.pow(2, layer.filter.freq)))}`,
      }
    case 'lfo':
      return {
        ...base,
        dials: [
          { label: 'WAVE', value: LFO_WAVES[layer.lfo.wave] },
          { label: '', value: '' },
          { label: '', value: '' },
        ],
        footer: `TO ${LFO_DESTS[layer.lfo.dest].toUpperCase()}  ${layer.lfo.sync ? `${clockDivision(layer.lfo.rate).label} @ ${bpm}` : formatHz(lfoRate(layer.lfo.rate))}`,
      }
    case 'arp':
      return {
        ...base,
        dials: [
          { label: 'DIRECTION', value: ARP_DIRECTIONS[layer.arp.direction] },
          { label: '', value: '' },
          { label: '', value: '' },
        ],
        footer: `${ARP_MODES[layer.arp.mode].toUpperCase()} ${layer.arp.run ? 'RUN' : 'STOP'}  ${layer.arp.sync ? `${clockDivision(layer.arp.rate).label} @ ${bpm}` : `${Math.round(arpBpm(layer.arp.rate))} BPM`}`,
      }
    case 'vibrato':
      return {
        ...base,
        dials: [
          { label: 'RATE', value: `${layer.voice.vibRate.toFixed(1)} Hz` },
          { label: 'AMOUNT', value: layer.voice.vibAmount.toFixed(1) },
          { label: '', value: '' },
        ],
        footer: `MODE ${VIBRATO_MODES[layer.voice.vibrato].toUpperCase()}`,
      }
    default: {
      const inCategory = wavesOf(wave.category)
      return {
        ...base,
        dials: [
          { label: 'WAVE', value: `${wave.id + 1}/${SYNTH_WAVEFORMS.length}` },
          { label: 'CATEGORY', value: wave.category },
          { label: 'IN CAT', value: `${inCategory.findIndex((each) => each.id === wave.id) + 1}/${inCategory.length}` },
        ],
        footer: `OSC CTRL: ${OSC_CTRL_ROLE[wave.category].toUpperCase()}`,
      }
    }
  }
}
