import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { clearMorph } from '../instrument/morph'
import {
  categories, directions, envelopeTime, layerKeys, morphSources, splitIds, splitLabels, splitNotes, splitPoints, waves,
} from '../instrument/parameters'
import { address, editLayer, editSplit, editTempo, layerAt } from '../instrument/programs'
import type { ProgramControls } from '../instrument/usePrograms'
import { models } from '../piano/settings'
import type { Settings, Step } from '../piano/settings'
import { editSynth, synthGroup, synthState } from './engineBindings'
import type { Editor, PanelActions } from './panelActions'

const headings: Record<Editor, string> = {
  list: 'Program list', name: 'Store As', split: 'Keyboard splits', clock: 'Master Clock', transpose: 'Transpose',
  arp: 'Arpeggiator / Gate', vibrato: 'Synth vibrato', lfo: 'Synth LFO', pitch: 'Oscillator pitch',
  osc: 'Oscillator envelope', filter: 'Filter envelope', amp: 'Amplifier envelope', analog: 'Analog waveforms',
  piano: 'Piano models', tracking: 'Filter tracking and drive', morph: 'Morph assignments',
}

function Slider({ label, value, min = 0, max = 10, step = 1, text, change }: {
  label: string; value: number; min?: number; max?: number; step?: number; text?: string; change(value: number): void
}) {
  return <label className="panel-editor__field"><span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      aria-valuetext={text} onChange={(event) => change(event.currentTarget.valueAsNumber)} />
    <output>{text ?? value}</output>
  </label>
}

function Toggle({ label, checked, change }: { label: string; checked: boolean; change(checked: boolean): void }) {
  return <label className="panel-editor__toggle">
    <input type="checkbox" checked={checked} onChange={(event) => change(event.currentTarget.checked)} />{label}
  </label>
}

function Pick<T extends string | number>({ label, value, choices, change }: {
  label: string; value: T; choices: readonly (readonly [T, string])[]; change(value: T): void
}) {
  return <label className="panel-editor__field"><span>{label}</span>
    <select value={value} onChange={(event) => {
      const choice = choices.find(([item]) => String(item) === event.currentTarget.value)
      if (choice) change(choice[0])
    }}>
      {choices.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
    </select>
  </label>
}

function SplitEditor({ state, edit }: { state: Settings; edit(next: Settings): void }) {
  const count = splitPoints(state.splits).length + 1
  return <>
    <div className="panel-editor__splits">
      {splitIds.map((id) => {
        const point = state.splits[id]
        const occupied = splitIds.filter((key) => key !== id).map((key) => state.splits[key].note)
        return <fieldset key={id}>
          <legend>{id} split</legend>
          <Pick label={`${id} position`} value={point.note ?? 0}
            choices={[[0, 'Off'], ...splitNotes.flatMap((note, index) =>
              occupied.includes(note) ? [] : [[note, splitLabels[index]] as const])]}
            change={(note) => edit(editSplit(state, id, { note: note || null }))} />
          <Pick label={`${id} crossfade`} value={point.fade}
            choices={[[0, 'Off'], [6, '±6 semitones'], [12, '±12 semitones']]}
            change={(fade) => edit(editSplit(state, id, { fade }))} />
        </fieldset>
      })}
    </div>
    <fieldset className="panel-editor__zones">
      <legend>Layer zones</legend>
      {layerKeys.map((key) => {
        const zone = layerAt(state, key).zone
        const name = key[0].toUpperCase() + key.slice(1, -1) + ' ' + key.slice(-1)
        return <Pick key={key} label={name} value={zone.join(',')} choices={[
          ['0,3', 'All zones'],
          ...Array.from({ length: count }, (_, first) => Array.from({ length: count - first }, (_, i) => {
            const last = first + i
            return [`${first},${last}`, first === last ? `Zone ${first + 1}` : `Zones ${first + 1}–${last + 1}`] as const
          })).flat().filter(([value]) => value !== '0,3'),
          ...(zone[0] >= count || (zone[1] >= count && zone.join(',') !== '0,3')
            ? [[zone.join(','), `Zones ${zone[0] + 1}–${zone[1] + 1} (saved)`] as const] : []),
        ]} change={(value) => {
          const [first, last] = value.split(',').map(Number)
          edit(editLayer(state, key, { zone: [first, last] }))
        }} />
      })}
    </fieldset>
  </>
}

function NameEditor({ initial, save, close }: { initial: string; save(name: string): void; close(): void }) {
  const [name, setName] = useState(initial)
  return <form onSubmit={(event) => { event.preventDefault(); save(name) }}>
    <label className="panel-editor__field">Program name
      <input type="text" maxLength={24} value={name} onChange={(event) => setName(event.target.value)} />
    </label>
    <div className="panel-editor__buttons">
      <button type="button" onClick={close}>Cancel</button>
      <button type="submit">Choose destination</button>
    </div>
  </form>
}

function morphName(path: string) {
  const segments = path.split('.')
  const parameter = segments.at(-1) ?? path
  if (path === 'effects.rotary.fast') return 'Rotary speed'
  if (segments.includes('drawbars')) return `Organ ${segments[2]} drawbar ${Number(parameter) + 1}`
  const symbols = { lfo: 'LFO', arp: 'Arp', mod1: 'Mod 1', mod2: 'Mod 2', amp: 'Amp / EQ' } as Record<string, string>
  const unit = segments.at(-2) ?? ''
  const label = symbols[unit] ?? unit
  const engine = segments[0] === 'layers' ? `Piano ${segments[1]}`
    : segments[1] === 'layers' ? `${segments[0]} ${segments[2]}`
      : segments[0] === 'effects' ? 'Global' : segments[0]
  return [engine, ['level', 'control'].includes(parameter) ? undefined : label, parameter === 'control' ? 'Osc Ctrl' : parameter].filter(Boolean).join(' · ')
}

export function PanelEditor({ state, program, actions }: { state: Settings; program: ProgramControls; actions: PanelActions }) {
  const title = useId()
  const container = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)
  const editor = actions.editor
  useEffect(() => {
    if (!editor) return
    const root = container.current
    if (!root) return
    const doc = root.ownerDocument
    const active = doc.activeElement
    if (active instanceof HTMLElement && !root.contains(active)) restore.current = active
    const selector = editor === 'list' ? '[aria-current="true"]' : editor === 'name' ? 'input[type="text"]' : '[data-editor-field] input, [data-editor-field] select'
    const target = root.querySelector<HTMLElement>(selector) ?? root
    target.focus({ preventScroll: true })
    if (target instanceof HTMLInputElement && editor === 'name') target.select()
    if (editor === 'list') target.scrollIntoView?.({ block: 'nearest' })
    return () => {
      if (root.contains(doc.activeElement)) restore.current?.focus({ preventScroll: true })
    }
  }, [editor])

  if (!editor) return null
  const { edit } = program
  const synth = synthState(state)
  let content: ReactNode
  switch (editor) {
    case 'list':
      content = <ol className="panel-editor__programs">
        {program.library[program.selected.bank].map((slot, index) => {
          const at = { bank: program.selected.bank, index }
          return <li key={index}><button type="button" aria-current={index === program.selected.index}
            onClick={() => { program.select(at); if (!program.store) actions.close() }}>
            <span>{address(at)}</span>{slot.name}
          </button></li>
        })}
      </ol>
      break
    case 'name': content = <NameEditor initial={program.current.name} save={actions.storeName} close={actions.close} />; break
    case 'split': content = <SplitEditor state={state} edit={edit} />; break
    case 'clock':
      content = <>
        <Slider label="Master tempo" min={30} max={300} value={state.effects.clockBpm}
          text={`${state.effects.clockBpm} BPM`} change={(bpm) => edit(editTempo(state, bpm))} />
        <Toggle label="Keyboard sync" checked={state.keyboardSync} change={(keyboardSync) => edit({ ...state, keyboardSync })} />
      </>
      break
    case 'transpose':
      content = <Slider label="Transpose amount" min={-6} max={6} value={state.transpose.semitones}
        text={`${state.transpose.semitones} semitones`}
        change={(semitones) => edit({ ...state, transpose: { semitones, enabled: true } })} />
      break
    case 'arp':
      content = <>
        <Pick label="Direction" value={synth.arp.direction} choices={directions.map((value) => [value, value])}
          change={(direction) => edit(synthGroup(state, 'arp', { direction }))} />
        <Toggle label="Arpeggiator clock sync" checked={synth.arp.sync} change={(sync) => edit(synthGroup(state, 'arp', { sync }))} />
        <Toggle label="Keyboard sync" checked={state.keyboardSync} change={(keyboardSync) => edit({ ...state, keyboardSync })} />
      </>
      break
    case 'vibrato':
      content = <>
        <Slider label="Vibrato rate" value={synth.vibrato.rate} min={2} max={8} step={0.1}
          text={`${synth.vibrato.rate.toFixed(1)} Hz`} change={(rate) => edit(synthGroup(state, 'vibrato', { rate }))} />
        <Slider label="Vibrato amount" value={synth.vibrato.amount}
          change={(amount) => edit(synthGroup(state, 'vibrato', { amount }))} />
      </>
      break
    case 'lfo':
      content = <Toggle label="LFO clock sync" checked={synth.lfo.sync} change={(sync) => edit(synthGroup(state, 'lfo', { sync }))} />
      break
    case 'pitch':
      content = <>
        <Slider label="Coarse pitch" value={synth.coarse} min={-24} max={24} text={`${synth.coarse} semitones`}
          change={(coarse) => edit(editSynth(state, { coarse }))} />
        <Slider label="Fine pitch" value={synth.fine} min={-50} max={50} text={`${synth.fine} cents`}
          change={(fine) => edit(editSynth(state, { fine }))} />
        <Toggle label="Oscillator envelope to pitch" checked={synth.osc.toPitch}
          change={(toPitch) => edit(synthGroup(state, 'osc', { toPitch }))} />
      </>
      break
    case 'osc': case 'filter': case 'amp':
      content = <>
        {(['attack', 'decay', 'release'] as const).map((key) => <Slider key={key}
          label={key[0].toUpperCase() + key.slice(1)} value={synth[editor][key]}
          text={key === 'decay' && synth[editor].decay === 10 ? 'Sustain' : `${Math.round(envelopeTime(synth[editor][key]) * 1000)} ms`}
          change={(value) => edit(synthGroup(state, editor, { [key]: value }))} />)}
        {editor === 'amp'
          ? <Pick label="Amp velocity" value={synth.amp.velocity} choices={[[0, 'Off'], [1, '1'], [2, '2'], [3, '3']]}
            change={(velocity: Step) => edit(synthGroup(state, editor, { velocity }))} />
          : <Toggle label="Envelope velocity" checked={synth[editor].velocity}
            change={(velocity) => edit(synthGroup(state, editor, { velocity }))} />}
      </>
      break
    case 'analog':
      content = <div className="panel-editor__waves">{categories.map((category) => <fieldset key={category}>
        <legend>{category}</legend>
        {waves[category].map((wave, index) => <button key={wave} type="button"
          aria-pressed={synth.category === category && synth.wave === index} onClick={() => actions.selectWave(category, index)}>{wave}</button>)}
      </fieldset>)}</div>
      break
    case 'piano':
      content = <button aria-current="true" type="button" onClick={actions.close}>{models[state.layers[state.focus].type]}</button>
      break
    case 'tracking':
      content = <>
        <Pick label="Keyboard tracking" value={synth.filter.tracking} choices={[[0, 'Off'], [1, '1/3'], [2, '2/3'], [3, 'Full']]}
          change={(tracking: Step) => edit(synthGroup(state, 'filter', { tracking }))} />
        <Pick label="Filter drive" value={synth.filter.drive} choices={[[0, 'Off'], [1, '1'], [2, '2'], [3, '3']]}
          change={(drive: Step) => edit(synthGroup(state, 'filter', { drive }))} />
      </>
      break
    case 'morph':
      content = morphSources.map((source) => <fieldset key={source}>
        <legend>{source === 'wheel' ? 'Wheel' : 'Control Pedal'}</legend>
        {Object.keys(state.morph[source]).length === 0 && <span>No assignments</span>}
        {Object.entries(state.morph[source]).map(([key]) =>
          <button key={key} type="button" onClick={() => edit(clearMorph(state, source, key))}>Remove {morphName(key)}</button>)}
      </fieldset>)
      break
  }
  return <div className="panel-editor" aria-labelledby={title} role="dialog" tabIndex={-1} ref={container}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); actions.close() } }}>
    <div className="panel-editor__header">
      <h2 id={title}>{headings[editor]}</h2>
      <button type="button" onClick={actions.close} aria-label="Close panel editor">Close</button>
    </div>
    <div data-editor-field>{content}</div>
  </div>
}
