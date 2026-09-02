import { useSyncExternalStore } from 'react'
import { describeSplitPoint, describeXfade, formatTranspose } from '../audio/instrumentController'
import { getModel } from '../audio/pianoModels'
import { ORGAN_MODELS } from '../dsp/organTypes'
import { ANALOG_CATEGORIES, ARP_DIRECTIONS, ARP_MODES, ARP_SUBDIVISIONS, FILTER_DRIVE, FILTER_TRACKING, FILTER_TYPES, FM_PARTIALS, LFO_DESTINATIONS, LFO_SUBDIVISIONS, LFO_WAVEFORMS, OSC_CTRL_LEGENDS, SYNTH_MODES, SYNTH_VIBRATO_MODES, SYNTH_WAVE_TYPES, VIBRATO_DELAY_TIMES, VOICE_MODES, VOICE_PRIORITIES, arpKnobToBpm, formatEnvTime, oscCtrlCategory, subdivisionFromKnob, waveName } from '../dsp/synthTypes'
import { midiToName } from '../hardware/keybed'
import { focusedChainKey, isDirty, storedProgram, type InstrumentState } from '../state/instrumentState'
import { slotLabel } from '../state/programState'
import { useEngineStatus, useInstrumentState, useServices } from './context'

/**
 * The Program OLED: the only primary display of the program section. Shows the program (location, name, the E edit
 * indicator), the focused section's sound (manual p. 24: the model name is shown in the Program display), the split /
 * scene / transpose / clock summary, the truthful audio / MIDI / effects state, and the pages opened by the Program
 * section buttons (list, Store, Store As naming, Keyboard Split, Master Clock, Transpose, Undo).
 */
export function ProgramOled() {
  const { midi, bus } = useServices()
  const status = useEngineStatus()
  const midiStatus = useSyncExternalStore(midi.subscribe, midi.getStatus, midi.getStatus)
  const notes = useSyncExternalStore(bus.subscribe, bus.getState, bus.getState)
  const state = useInstrumentState((s) => s)
  const dirty = isDirty(state)
  const held = [...notes.held.keys()].sort((a, b) => a - b).map(midiToName)
  const live = state.bank.liveMode
  const location = live ? slotLabel(state.bank.liveSlot, true) : slotLabel(state.bank.slot)
  const headline = `${location}${dirty ? ' E' : ''} ${state.name}`
  const focused = state.piano.layers[state.piano.focus]
  const model = getModel(focused.modelId)
  const layerStatus = status.layers[state.piano.focus]
  const pianoHeadline = !state.piano.on ? 'Piano section off' : layerStatus.state === 'fallback' ? 'Piano not found' : `${model.type} · ${model.name}`
  const soundLine = (() => {
    if (state.effects.focus === 'organ') {
      const o = state.organ.layers[state.organ.focus]
      return `Organ ${state.organ.focus}: ${state.organ.on ? ORGAN_MODELS[o.model] : 'section off'} ${o.drawbars.join('')}`
    }
    if (state.effects.focus === 'synth') {
      const l = state.synth.layers[state.synth.focus]
      return `Synth ${state.synth.focus}: ${state.synth.on ? waveName(l.wave) : 'section off'}${l.mode !== 0 ? ` (${SYNTH_MODES[l.mode]} unsupported)` : ''}`
    }
    return `Piano ${state.piano.focus}: ${pianoHeadline}`
  })()
  const layerLine = (id: 'A' | 'B') => {
    const l = status.layers[id]
    if (!l.on) return `${id}: off`
    const src = l.source === 'recorded-samples' ? 'rec' : l.source === 'generated-buffers' ? 'gen' : l.source === 'none' ? '' : 'fallback'
    const st = l.state === 'loading' ? `${l.loaded}/${l.total}` : l.state
    return `${id}: ${l.modelName} ${src} ${st}`.trim()
  }
  const fx = `${state.effects.focus === 'piano' ? `Piano ${state.piano.focus}` : state.effects.focus === 'organ' ? 'Organ' : `Synth ${state.synth.focus}`}${state.effects.pianoGroup && state.effects.focus === 'piano' ? ' GRP' : ''}${state.effects.synthGroup && state.effects.focus === 'synth' ? ' GRP' : ''}${state.effects.on ? '' : ' FX OFF'}`
  const globals = (['delay', 'comp', 'reverb'] as const).filter((u) => state.effects.global[u]).map((u) => u.toUpperCase()[0])
  const chain = state.effects.chains[focusedChainKey(state)]
  const splitSummary = state.split.on ? `Split ${(['low', 'mid', 'high'] as const).filter((k) => state.split.points[k].note !== null).map((k) => `${k[0].toUpperCase()}${midiToName(state.split.points[k].note!)}`).join(' ') || 'on'}` : 'Split off'
  const summary = `${splitSummary} · Scene ${state.scenes.active} · Tr ${state.transpose.on ? formatTranspose(state.transpose.semitones) : 'off'} · ${state.clock.bpm} BPM${state.clock.kbSync ? ' KBS' : ''}`
  const perf = `Keys ${held.length ? held.join(' ') : '—'} · Sus ${notes.sustain ? (state.piano.sustped ? 'on' : 'on (SUSTPED off)') : 'off'}${state.piano.pstick ? ' · PSTICK' : ''}${state.morphArmed.source ? ` · MORPH ${state.morphArmed.source.toUpperCase()}` : ''}`
  const view = state.view
  const body = (() => {
    switch (view.mode) {
      case 'list':
        return <ListView state={state} />
      case 'store':
        return <StoreView state={state} />
      case 'storeAs':
        return <StoreAsView state={state} />
      case 'split':
        return <SplitView state={state} />
      case 'clock':
        return (
          <>
            <div className="oled-row oled-big">MASTER CLOCK {state.clock.bpm} BPM</div>
            <div className="oled-row">Dial: tempo · [1] KBS {state.clock.kbSync ? 'On' : 'Off'} · EXIT closes</div>
            <div className="oled-row">Synced: Arp / LFO / Delay / Mod 1 with MST CLK on</div>
          </>
        )
      case 'transpose':
        return (
          <>
            <div className="oled-row oled-big">TRANSPOSE {formatTranspose(state.transpose.semitones)} st</div>
            <div className="oled-row">Dial: ±6 semitones · {state.transpose.on ? 'on' : 'off'} · EXIT closes</div>
            <div className="oled-row">Affects all layers of the program (manual p. 40)</div>
          </>
        )
      case 'undo':
        return (
          <>
            <div className="oled-row oled-big">UNDO program change?</div>
            <div className="oled-row">{state.undo ? `Restores ${slotLabel(state.undo.slot, state.undo.live)} ${state.undo.program.name} (edited)` : 'Nothing to undo'}</div>
            <div className="oled-row">[1] Undo · EXIT cancel</div>
          </>
        )
      default:
        return (
          <>
            <div className="oled-row oled-big">{headline}</div>
            <div className="oled-rule" />
            <div className="oled-row" data-role="sound">
              {soundLine}
            </div>
            <div className="oled-row" data-role="layers">
              {state.effects.focus === 'piano' ? `${layerLine('A')} · ${layerLine('B')}` : state.effects.focus === 'organ' ? `A: ${state.organ.layers.A.on ? ORGAN_MODELS[state.organ.layers.A.model] : 'off'} · B: ${state.organ.layers.B.on ? ORGAN_MODELS[state.organ.layers.B.model] : 'off'}` : `A: ${state.synth.layers.A.on ? waveName(state.synth.layers.A.wave) : 'off'} · B: ${state.synth.layers.B.on ? waveName(state.synth.layers.B.wave) : 'off'} · C: ${state.synth.layers.C.on ? waveName(state.synth.layers.C.wave) : 'off'}`}
            </div>
            <div className="oled-row">
              Audio {status.state} · MIDI {midiStatus.state} · FX {fx}
              {globals.length ? ` · Global ${globals.join('')}` : ''}
              {chain.delay.pingPong ? ' · PingPong' : ''}
              {chain.comp.fast ? ' · CompFast' : ''}
            </div>
            <div className="oled-row" data-role="hint">
              {view.hint ?? summary}
            </div>
            <div className="oled-row">{perf}</div>
          </>
        )
    }
  })()
  return (
    <div id="program.oled" className="oled oled-program" role="group" aria-label="Program display" data-display="primary" data-headline={headline} data-view={view.mode} data-dirty={dirty} data-live={live} data-slot={location}>
      <div className="oled-row oled-head">
        <span>{view.mode === 'program' ? 'STAGEBENCH' : view.mode.toUpperCase()}</span>
        <span>{state.shiftArmed ? 'SHIFT · ' : ''}PHASE 3</span>
      </div>
      {body}
    </div>
  )
}

function ListView({ state }: { state: InstrumentState }) {
  const from = Math.max(0, Math.min(state.view.listIndex - 1, 32 - 4))
  return (
    <>
      <div className="oled-row">PROGRAM LIST (numeric) · dial browses · EXIT</div>
      {state.bank.programs.slice(from, from + 4).map((p, i) => {
        const slot = from + i
        const selected = slot === state.view.listIndex
        return (
          <div key={slot} className={`oled-row oled-list-row${selected ? ' is-selected' : ''}`} data-slot={slot}>
            {selected ? '▶ ' : '  '}
            {slotLabel(slot)} {p.name}
          </div>
        )
      })}
    </>
  )
}

function StoreView({ state }: { state: InstrumentState }) {
  const dest = state.view.store
  const pending = state.view.pending
  if (!dest || !pending) return <div className="oled-row">Store: no pending program</div>
  const existing = dest.live ? state.bank.live[dest.slot] : state.bank.programs[dest.slot]
  return (
    <>
      <div className="oled-row oled-big">STORE PROGRAM TO</div>
      <div className="oled-row" data-role="store-destination">
        {slotLabel(dest.slot, dest.live)} {existing.name}
      </div>
      <div className="oled-row">Storing: {pending.name} · destination is auditioned</div>
      <div className="oled-row">Dial / Page / Program / Live Mode select · STORE confirms · EXIT cancels</div>
    </>
  )
}

function StoreAsView({ state }: { state: InstrumentState }) {
  const naming = state.view.naming
  if (!naming) return null
  const chars = naming.name.length ? naming.name : ' '
  return (
    <>
      <div className="oled-row oled-big">STORE PROGRAM AS</div>
      <div className="oled-row oled-name" data-role="name" data-cursor={naming.cursor}>
        {[...chars].map((c, i) => (
          <span key={i} className={i === naming.cursor ? 'oled-cursor' : ''}>
            {c}
          </span>
        ))}
      </div>
      <div className="oled-row">{naming.charMode ? 'Dial: character · [1] ABC done' : 'Dial / Page: cursor · [1] ABC characters'}</div>
      <div className="oled-row">[2] Cat · [3] Ins · [4] Del · STORE → destination</div>
    </>
  )
}

function SplitView({ state }: { state: InstrumentState }) {
  const row = state.view.splitRow
  const cell = (key: 'low' | 'mid' | 'high') => {
    const p = state.split.points[key]
    const selected = state.view.splitPoint === key
    return (
      <span key={key} className={`oled-cell${selected ? ' is-selected' : ''}`} data-point={key}>
        {selected ? '▶' : ' '}
        {key[0].toUpperCase()}
        {key.slice(1)} {row === 'note' ? (p.note === null ? 'Off' : midiToName(p.note)) : describeXfade(p.xfade)}
      </span>
    )
  }
  return (
    <>
      <div className="oled-row oled-big">KEYBOARD SPLIT {state.split.on ? '' : '(off)'}</div>
      <div className="oled-row">
        {row === 'note' ? 'Note' : 'xFade'} row · [1] row · [2] Low [3] Mid [4] High
      </div>
      <div className="oled-row oled-cells" data-role="split-points">
        {(['low', 'mid', 'high'] as const).map(cell)}
      </div>
      <div className="oled-row">
        {(['low', 'mid', 'high'] as const).map((k) => `${k[0].toUpperCase()} ${describeSplitPoint(state.split.points[k])}`).join(' · ')}
      </div>
    </>
  )
}

const PAGE_TITLES = { wave: 'OSC WAVEFORM', pitch: 'OSC PITCH', oscEnv: 'OSC ENVELOPE', filterType: 'FILTER', filterEnv: 'FILTER ENVELOPE', ampEnv: 'AMP ENVELOPE', lfoWave: 'LFO WAVEFORM', arpMenu: 'ARPEGGIATOR', vibratoMenu: 'VIBRATO' } as const

/**
 * The Synth OLED: the section's single narrow display. Shows the open page of the focused layer (waveform, pitch,
 * envelopes, filter, LFO, arpeggiator, vibrato) and what the three dials below it edit (manual p. 27).
 */
export function SynthOled() {
  const synth = useInstrumentState((s) => s.synth)
  const page = useInstrumentState((s) => s.view.synthPage)
  const l = synth.layers[synth.focus]
  const env = (e: { attack: number; decay: number; release: number }) => `A ${formatEnvTime(e.attack)} · D ${formatEnvTime(e.decay, true)} · R ${formatEnvTime(e.release)}`
  const content: { big: string; row: string; dials: [string, string, string] } = (() => {
    switch (page) {
      case 'pitch':
        return { big: `${l.pitch.coarse >= 0 ? '+' : ''}${l.pitch.coarse} st  ${l.pitch.fine >= 0 ? '+' : ''}${l.pitch.fine} ct`, row: `Octave ${l.octave >= 0 ? '+' : ''}${l.octave} · Env to pitch ${l.oscEnv.toPitch ? 'on' : 'off'}`, dials: ['PITCH', 'FINE', '—'] }
      case 'oscEnv':
        return { big: env(l.oscEnv), row: `Amt ${l.oscEnv.amount >= 0 ? '+' : ''}${l.oscEnv.amount.toFixed(1)} → ${l.oscEnv.toPitch ? 'Pitch' : 'Osc Ctrl'} · Vel ${l.oscEnv.velocity ? 'on' : 'off'}`, dials: ['ATTACK', 'DECAY', 'RELEASE'] }
      case 'filterType':
        return { big: `${FILTER_TYPES[l.filter.type]}${l.filter.on ? '' : ' (off)'}`, row: `KBD Trk ${FILTER_TRACKING[l.filter.tracking]} · Drive ${FILTER_DRIVE[l.filter.drive]} · Res ${l.filter.res.toFixed(1)}`, dials: ['TYPE', 'KBD TRK', 'DRIVE'] }
      case 'filterEnv':
        return { big: env(l.filterEnv), row: `Env Amt ${l.filter.envAmount.toFixed(1)} · Vel ${l.filterEnv.velocity ? 'on' : 'off'}`, dials: ['ATTACK', 'DECAY', 'RELEASE'] }
      case 'ampEnv':
        return { big: env(l.ampEnv), row: `Velocity ${['Off', '1', '2', '3'][l.ampEnv.velocity]}`, dials: ['ATTACK', 'DECAY', 'RELEASE'] }
      case 'lfoWave':
        return { big: LFO_WAVEFORMS[l.lfo.wave], row: `→ ${LFO_DESTINATIONS[l.lfo.destination]} · Rate ${l.lfo.sync ? subdivisionFromKnob(LFO_SUBDIVISIONS, l.lfo.rate).label : l.lfo.rate.toFixed(1)} · Amt ${l.lfo.amount.toFixed(1)}`, dials: ['WAVE', '—', '—'] }
      case 'arpMenu':
        return { big: `${ARP_MODES[l.arp.mode]} · ${ARP_DIRECTIONS[l.arp.direction]}`, row: `Rate ${l.arp.sync ? subdivisionFromKnob(ARP_SUBDIVISIONS, l.arp.rate).label : `${Math.round(arpKnobToBpm(l.arp.rate))} BPM`} · ${l.arp.run ? 'running' : 'stopped'} · Hold ${synth.kbHold ? 'on' : 'off'}`, dials: ['DIRECTION', 'ZIG ZAG ✕', 'PATTERN ✕'] }
      case 'vibratoMenu':
        return { big: `${l.vibrato.rate.toFixed(1)} Hz · Amt ${l.vibrato.amount.toFixed(1)}`, row: `${SYNTH_VIBRATO_MODES[l.vibrato.mode]} · Dly ${VIBRATO_DELAY_TIMES[l.vibrato.delay]} s`, dials: ['RATE', 'AMOUNT', 'DLY TIME'] }
      default: {
        const type = SYNTH_WAVE_TYPES[l.wave.type]
        const cat = l.wave.type === 1 ? `Harmonic · P ${FM_PARTIALS[l.wave.partial]}` : ANALOG_CATEGORIES[l.wave.category]
        return { big: waveName(l.wave), row: `${type} · ${cat} · Osc Ctrl: ${OSC_CTRL_LEGENDS[oscCtrlCategory(l.wave)]}`, dials: ['TYPE', 'CAT', l.wave.type === 1 ? 'PARTIAL' : 'WAVE'] }
      }
    }
  })()
  const mode = l.mode !== 0 ? ` · ${SYNTH_MODES[l.mode].toUpperCase()} unsupported` : ''
  return (
    <div id="synth.oled" className="oled oled-synth" role="group" aria-label="Synth display" data-display="primary" data-page={page} data-layer={synth.focus}>
      <div className="oled-row oled-head oled-center">
        SYNTH {synth.focus} · {PAGE_TITLES[page]}
        {mode}
      </div>
      <div className="oled-row oled-big">{content.big}</div>
      <div className="oled-row">{content.row}</div>
      <div className="oled-row oled-dials">
        {content.dials.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
    </div>
  )
}

/** Voice mode summary used by the status strip. */
export function synthVoiceSummary(state: InstrumentState): string {
  const l = state.synth.layers[state.synth.focus]
  return `${VOICE_MODES[l.voice.mode]}${l.voice.priority ? ` ${VOICE_PRIORITIES[l.voice.priority]}` : ''}`
}

export { storedProgram }
