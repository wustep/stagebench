import { modelFor } from '../audio/library/catalog'
import { PAGE_DIALS } from '../engine/bind/synth'
import { drawbarGraph, type OrganLayerState } from '../engine/organ'
import type { ProgramsSnapshot } from '../engine/programs'
import { LAYER_IDS, type EngineState, type LayerId } from '../engine/state'
import {
  ARP_MODES,
  DIVISIONS,
  FILTER_TRACKING,
  LFO_WAVEFORMS,
  SYNTH_LAYER_IDS,
  arpOctaves,
  envSeconds,
  lfoHzFor,
  waveformInfo,
  type SynthLayerId,
} from '../engine/synth'
import type { UiMode } from '../engine/uiMode'
import { boundaries, positionName, SPLIT_POINT_IDS, SPLIT_POINT_NAMES, splitIsOn } from '../engine/zones'
import { noteName } from '../hardware/keybed'
import type { OledSpec } from '../hardware/layout'
import { box, useEngineState, useInstrumentSnapshot, useProgramsSnapshot, useUiMode } from './context'
import { envelopePoints, oscCtrlText, waveformPoints } from './oledGraphics'

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

const AUDIO_LABEL: Record<string, string> = {
  idle: 'AUDIO IDLE',
  loading: 'AUDIO LOADING',
  ready: 'AUDIO READY',
  fallback: 'AUDIO FALLBACK',
  error: 'AUDIO ERROR',
}

const octaveText = (n: number) => (n > 0 ? `+${n}` : String(n))
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
const seconds = (knob: number) => {
  const s = envSeconds(knob)
  return s < 1 ? `${Math.round(s * 1000)}ms` : `${s.toFixed(1)}s`
}

interface Row {
  text: string
  graph?: { points: string; kind: 'wave' | 'env' }
}

const organLine = (id: LayerId, l: OrganLayerState, focus: boolean) =>
  `${id}${focus ? '▸' : ' '} ${l.model} ${l.drawbars.map((d) => (l.model === 'Farf' ? (drawbarGraph('Farf', d) > 0 ? '1' : '0') : String(d))).join('')}`

/** Program display, main view (title bar + up to five rows) */
function mainRows(state: EngineState, snap: ReturnType<typeof useInstrumentSnapshot>, programs: ProgramsSnapshot, ui: UiMode): { title: string; rows: Row[] } {
  const layerLine = (id: LayerId) => {
    const layer = state.layers[id]
    const focus = state.focus === id ? '▸' : ' '
    if (!layer.enabled) return `${id}${focus} off`
    const model = modelFor(layer.type, layer.models[layer.type])
    const status = snap.models[id]
    const suffix = status.phase === 'error' ? '  PIANO NOT FOUND (fallback)' : status.phase === 'loading' ? `  loading ${status.loaded}/${status.total}` : ''
    const oct = layer.octave !== 0 ? `  oct ${octaveText(layer.octave)}` : ''
    return `${id}${focus} ${layer.type} · ${model.name}${oct}${suffix}`
  }
  const organs = LAYER_IDS.filter((id) => state.organ.layers[id].enabled)
  const synths = SYNTH_LAYER_IDS.filter((id) => state.synth[id].enabled)
  const organText = state.organOn && organs.length ? `ORG ${organs.map((id) => `${id}${state.organFocus === id ? '▸' : ''}${state.organ.layers[id].model}`).join(' ')}` : state.organOn ? 'ORG off' : 'ORG section off'
  const synthText = state.synthOn && synths.length ? `SYN ${synths.map((id) => `${id}${state.synthFocus === id ? '▸' : ''}${waveformInfo(state.synth[id].patch.waveform).name.split(' ')[0]}`).join(' ')}` : state.synthOn ? 'SYN off' : 'SYN section off'
  const bounds = boundaries(state.split)
  const split = splitIsOn(state.split) ? `Split ${bounds.map((b) => noteName(b.note)).join('|')}` : 'Split off'
  const transpose = state.transpose.on && state.transpose.semitones !== 0 ? ` T${signed(state.transpose.semitones)}` : ''
  const performance = ui.status ?? `${state.clock.bpm}BPM ${split} Scn ${state.scene === 0 ? 'I' : 'II'}${transpose}`
  const audio = `${AUDIO_LABEL[snap.audio.phase] ?? 'AUDIO'}  VOICES ${pad(snap.voices)}/${snap.maxVoices}`
  const title = `${programs.slotLabel} ${programs.name}`
  if (ui.progView === 'detail') {
    const rows: Row[] = []
    for (const id of LAYER_IDS) if (state.organOn && state.organ.layers[id].enabled) rows.push({ text: organLine(id, state.organ.layers[id], state.organFocus === id) })
    for (const id of SYNTH_LAYER_IDS) if (state.synthOn && state.synth[id].enabled) rows.push({ text: `${id}${state.synthFocus === id ? '▸' : ' '} ${waveformInfo(state.synth[id].patch.waveform).name} ${state.synth[id].patch.filter.type}` })
    if (state.pianoOn) for (const id of LAYER_IDS) if (state.layers[id].enabled) rows.push({ text: layerLine(id) })
    rows.push({ text: performance })
    rows.push({ text: audio })
    return { title: `${title} (detail)`, rows: rows.slice(0, 5) }
  }
  return {
    title,
    rows: [
      { text: state.pianoOn ? layerLine('A') : 'PIANO SECTION OFF' },
      { text: state.pianoOn ? layerLine('B') : '' },
      { text: `${organText}  ${synthText}` },
      { text: programs.message ?? performance },
      { text: audio },
    ],
  }
}

function listRows(programs: ProgramsSnapshot): { title: string; rows: Row[] } {
  const rows: Row[] = []
  for (let d = -2; d <= 2; d++) {
    const i = (programs.listCursor + d + programs.names.length * 2) % programs.names.length
    rows.push({ text: `${d === 0 ? '▸' : ' '}${(programs.slotLabel && `${Math.floor(i / 8) + 1}.${(i % 8) + 1}`).padEnd(4)}${programs.names[i]}` })
  }
  return { title: 'PROGRAM LIST', rows }
}

function storeRows(state: EngineState, programs: ProgramsSnapshot): { title: string; rows: Row[] } {
  const flow = programs.store!
  if (flow.step === 'name') {
    const chars = Array.from(flow.name)
    const shown = chars.length === 0 ? '▮' : chars.map((c, i) => (i === flow.cursor ? `[${c === ' ' ? '_' : c}]` : c)).join('')
    return {
      title: 'STORE AS: NAME',
      rows: [{ text: shown }, { text: 'Dial: character' }, { text: 'PAGE ◄►: cursor  Btn1: insert' }, { text: 'Btn2: delete  STORE: accept' }, { text: 'Shift: cancel' }],
    }
  }
  const destName = flow.dest.mode === 'live' ? programs.liveNames[flow.dest.index] : programs.names[flow.dest.index]
  const label = flow.dest.mode === 'live' ? `L${flow.dest.index + 1}` : `${Math.floor(flow.dest.index / 8) + 1}.${(flow.dest.index % 8) + 1}`
  void state
  return {
    title: 'STORE',
    rows: [{ text: `To ${label} ${destName}` }, { text: `As "${flow.name}"` }, { text: 'Dial/pages/buttons: choose' }, { text: 'LIVE MODE: program/live' }, { text: 'STORE: write  Shift: cancel' }],
  }
}

function splitRows(state: EngineState, editing: keyof EngineState['split']): { title: string; rows: Row[] } {
  return {
    title: `SPLIT EDIT: ${SPLIT_POINT_NAMES[editing].toUpperCase()}`,
    rows: [
      ...SPLIT_POINT_IDS.map((id) => {
        const p = state.split[id]
        return { text: `${id === editing ? '▸' : ' '}${SPLIT_POINT_NAMES[id].padEnd(5)}${p.active ? 'on ' : 'off'} ${positionName(p.position).padEnd(3)} xf ${p.crossfade === 0 ? 'Off' : `±${p.crossfade}`}` }
      }),
      { text: 'Dial or key: move  1-3: pick' },
      { text: '4: on/off  5: crossfade' },
    ],
  }
}

function synthPage(state: EngineState, page: UiMode['synthPage']): { title: string; rows: Row[] } {
  const id: SynthLayerId = state.synthFocus
  const layer = state.synth[id]
  const p = layer.patch
  const wave = waveformInfo(p.waveform)
  const dials = PAGE_DIALS[page]
  const head = `SYNTH ${id}${layer.enabled ? '' : ' (off)'}`
  const dialRow: Row = { text: `◄ ${dials.join(' · ')}`.slice(0, 40) }
  switch (page) {
    case 'osc':
      return {
        title: `${head} ANALOG`,
        rows: [{ text: `${wave.name} (${wave.category})` }, { text: `Ctrl ${oscCtrlText(p.oscCtrl)}  ${signed(p.coarse)}st ${signed(p.fine)}ct` }, { text: '', graph: { points: waveformPoints(wave, p.oscCtrl), kind: 'wave' } }, dialRow],
      }
    case 'oscEnv':
      return {
        title: `${head} OSC ENV`,
        rows: [{ text: `A ${seconds(p.oscEnv.attack)} D ${seconds(p.oscEnv.decay)} R ${seconds(p.oscEnv.release)}` }, { text: `Amt ${signed(Math.round(p.oscEnv.amount * 10))} ${p.oscEnv.toPitch ? 'to pitch' : 'to Osc Ctrl'} ${p.oscEnv.velocity ? 'vel' : ''}` }, { text: '', graph: { points: envelopePoints(p.oscEnv.attack, p.oscEnv.decay, p.oscEnv.release), kind: 'env' } }, dialRow],
      }
    case 'filterEnv':
      return {
        title: `${head} FILTER ENV`,
        rows: [{ text: `A ${seconds(p.filter.attack)} D ${seconds(p.filter.decay)} R ${seconds(p.filter.release)}` }, { text: `Amt ${Math.round(p.filter.envAmount * 10)} ${p.filter.velocity ? 'vel' : ''}` }, { text: '', graph: { points: envelopePoints(p.filter.attack, p.filter.decay, p.filter.release), kind: 'env' } }, dialRow],
      }
    case 'ampEnv':
      return {
        title: `${head} AMP ENV`,
        rows: [{ text: `A ${seconds(p.amp.attack)} D ${seconds(p.amp.decay)} R ${seconds(p.amp.release)}` }, { text: `Velocity ${p.amp.velocity === 0 ? 'off' : p.amp.velocity}` }, { text: '', graph: { points: envelopePoints(p.amp.attack, p.amp.decay, p.amp.release), kind: 'env' } }, dialRow],
      }
    case 'filter':
      return {
        title: `${head} FILTER`,
        rows: [{ text: `${p.filter.on ? p.filter.type : 'Off'}  Trk ${FILTER_TRACKING[p.filter.tracking]}  Drv ${p.filter.drive || 'Off'}` }, { text: `Freq ${Math.round(p.filter.freq * 100)} Res ${Math.round(p.filter.res * 100)} Env ${Math.round(p.filter.envAmount * 100)}` }, dialRow],
      }
    case 'lfo':
      return {
        title: `${head} LFO`,
        rows: [
          { text: `${LFO_WAVEFORMS[p.lfo.waveform]} → ${p.lfo.dest === 'off' ? 'off' : p.lfo.dest === 'ctrl' ? 'Osc Ctrl' : p.lfo.dest === 'pitch' ? 'Osc pitch' : 'Filter'}` },
          { text: `${lfoHzFor(p.lfo, state.clock.bpm).toFixed(2)} Hz  ${p.lfo.sync ? `Clock ${DIVISIONS[p.lfo.division].name}` : 'Free'}  Amt ${Math.round(p.lfo.amount * 100)}` },
          dialRow,
        ],
      }
    case 'vibrato':
      return {
        title: `${head} VIBRATO`,
        rows: [{ text: `Vibrato ${p.voice.vibrato.mode}` }, { text: `Rate ${p.voice.vibrato.rate.toFixed(1)} Hz  Amt ${p.voice.vibrato.amount}` }, dialRow],
      }
    case 'arp':
      return {
        title: `${head} ARP/GATE`,
        rows: [
          { text: `${ARP_MODES.includes(p.arp.mode) ? p.arp.mode : 'arp'} ${p.arp.run ? 'RUN' : 'stopped'} ${p.arp.direction} ${p.arp.hold ? 'hold' : ''}` },
          { text: `${p.arp.sync ? `Clock ${DIVISIONS[p.arp.division].name}` : 'Free rate'}  ${p.arp.mode === 'gate' ? `Hard ${Math.round(p.arp.range * 100)}` : `${arpOctaves(p.arp.range)} oct`}` },
          dialRow,
        ],
      }
  }
}

/** The two primary OLEDs. They only ever show state that is real. */
export default function Oled({ spec }: { spec: OledSpec }) {
  const snap = useInstrumentSnapshot()
  const state = useEngineState()
  const programs = useProgramsSnapshot()
  const ui = useUiMode()
  const program = spec.id === 'program-oled'

  let title: string
  let rows: Row[]
  let flag = false
  if (program) {
    const view = programs.store ? storeRows(state, programs) : ui.splitEdit ? splitRows(state, ui.splitEdit) : programs.listView ? listRows(programs) : mainRows(state, snap, programs, ui)
    title = view.title
    rows = view.rows
    flag = programs.dirty && !programs.store && !ui.splitEdit && !programs.listView
  } else {
    const view = synthPage(state, ui.synthPage)
    title = view.title
    rows = view.rows
  }
  const focused = state.focus
  return (
    <div
      id={spec.id}
      className={`oled oled--${program ? 'program' : 'synth'}`}
      role="status"
      aria-live="off"
      aria-label={
        program
          ? `Program OLED: program ${programs.slotLabel} ${programs.name}${flag ? ', edited' : ''}, layers, audio and effects status. Piano layer ${focused} has the focus`
          : `Synth OLED: synth layer ${state.synthFocus}, ${ui.synthPage} page`
      }
      data-oled={program ? 'program' : 'synth'}
      data-section={spec.section}
      data-page={program ? undefined : ui.synthPage}
      data-edited={program ? String(flag) : undefined}
      style={box(spec.x, spec.y, spec.w, spec.h, false)}
    >
      <div className="ol-title">
        <span>{title}</span>
        {flag && (
          <span className="ol-flag" data-testid="edited-indicator" title="Edited: unsaved changes">
            E
          </span>
        )}
      </div>
      {rows.map((r, i) =>
        r.graph ? (
          <svg key={i} className={`ol-graph ol-graph--${r.graph.kind}`} viewBox="0 0 60 14" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={r.graph.points} fill="none" />
          </svg>
        ) : (
          <div key={i} className="ol-line">
            {r.text || ' '}
          </div>
        ),
      )}
    </div>
  )
}
