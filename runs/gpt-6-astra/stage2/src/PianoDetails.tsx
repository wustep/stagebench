import { LayeredPianoEngine } from './layer-audio'
import { effectTypes, modelNames, pianoTypes, timbres, unitIds, type LayerId } from './phase2-state'
export function PianoDetails({ engine }: { engine: LayeredPianoEngine }) {
  const s = engine.state, p = s.layers[s.focus]
  const toggle = (label: string, on: boolean, action: () => void) => <button type="button" aria-pressed={on} onClick={action}>{label}</button>
  return <details className="sound-editor"><summary>Piano &amp; effects controls · {s.focus}: {p.type} · FX {s.fxSection} {s.fxFocus}</summary>
    <p>Grand, Upright and Electric recordings are unavailable in the supplied inputs. Their playable models are labeled synthesis fallbacks. Organ, Synth, Program and excluded controls remain decorative.</p>
    <div className="editor-grid"><fieldset><legend>Piano layers</legend>
      {toggle('Piano section on', s.sectionOn, () => engine.set({ sectionOn: !s.sectionOn }))}
      {(['A', 'B'] as LayerId[]).map(id => <div key={id} className="editor-row">{toggle(`Enable Piano ${id}`, s.layers[id].enabled, () => engine.setLayer(id, { enabled: !s.layers[id].enabled }))}{toggle(`Focus Piano ${id}`, s.focus === id, () => engine.focus(id))}<label>Layer {id} level<input aria-label={`Piano ${id} level`} type="range" min="0" max="1" step=".01" value={s.layers[id].level} onChange={e => engine.setLayer(id, { level: +e.target.value })} /></label></div>)}
      <label>Type<select aria-label="Piano type" value={p.type} onChange={e => engine.setLayer(s.focus, { type: e.target.value as typeof p.type, timbre: 0, model: 0 })}>{pianoTypes.map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Model<select aria-label="Piano model" value="0" onChange={() => engine.setLayer(s.focus, { model: 0 })}><option value="0">{modelNames[p.type]}</option></select></label>
      <label>Octave<select aria-label="Piano octave" value={p.octave} onChange={e => engine.setLayer(s.focus, { octave: +e.target.value })}>{[-1, 0, 1].map(n => <option key={n} value={n}>{n * 12} semitones</option>)}</select></label>
      {(['touch', 'dynComp', 'timbre', 'unison'] as const).map(prop => <label key={prop}>{({ touch: 'KB Touch', dynComp: 'Dyn Comp', timbre: 'Timbre', unison: 'Unison' })[prop]}<select aria-label={`Piano ${prop}`} value={p[prop]} onChange={e => engine.setLayer(s.focus, { [prop]: +e.target.value })}>{(prop === 'touch' ? ['Heavy', 'Medium', 'Light'] : prop === 'timbre' ? timbres(p.type) : ['Off', '1', '2', '3']).map((v, i) => <option key={v} value={i}>{v}</option>)}</select></label>)}
      {(['sustped', 'pstick', 'softRelease', 'stringRes'] as const).map(prop => <span key={prop}>{toggle(({ sustped: 'SUSTPED', pstick: 'PSTICK', softRelease: 'Soft Release (except Clav)', stringRes: 'String Resonance' })[prop], p[prop], () => engine.setLayer(s.focus, { [prop]: !p[prop] }))}</span>)}
    </fieldset><fieldset><legend>Effects routing</legend>
      {toggle('All effects on', s.effectsOn, () => engine.set({ effectsOn: !s.effectsOn }))}{toggle('Piano group mode', s.group, () => engine.group(!s.group))}
      {(['A', 'B'] as const).map(id => <span key={id}>{toggle(`FX Piano ${id}`, s.fxSection === 'Piano' && s.fxFocus === id, () => engine.focusEffects('Piano', id))}</span>)}
      <label>Clock tempo<input aria-label="Effects clock BPM" type="number" min="30" max="240" value={Math.round(s.bpm)} onChange={e => engine.set({ bpm: Math.max(30, Math.min(240, +e.target.value)) })} /></label>
      <button onClick={() => engine.tap()}>Tap delay tempo</button>
      {toggle('Rotary on', s.rotary.on, () => engine.set({ rotary: { ...s.rotary, on: !s.rotary.on } }))}{toggle('Rotary fast', s.rotary.fast, () => engine.set({ rotary: { ...s.rotary, fast: !s.rotary.fast } }))}
      <label>Rotary drive<input type="range" min="0" max="1" step=".01" value={s.rotary.drive} onChange={e => engine.set({ rotary: { ...s.rotary, drive: +e.target.value } })} /></label>
      <p>Focus follows Piano focus. Shift+On sets global on Delay, Compressor or Reverb. Global targets both Piano layers; other sound engines are inactive. Reverb precedes To Rotary.</p>
    </fieldset>
    {unitIds.map(unit => { const e = s.layers[s.fxFocus].effects[unit]; return <fieldset key={unit} disabled={s.fxSection !== 'Piano'}><legend>{unit}</legend>
      {toggle(`${unit} on`, e.on, () => engine.effect(unit, { on: !e.on }))}
      {unit in s.globals && toggle(`${unit} global`, s.globals[unit as keyof typeof s.globals], () => engine.global(unit as keyof typeof s.globals, !s.globals[unit as keyof typeof s.globals]))}
      <label>{unit === 'delay' ? 'Feedback filter' : 'Type'}<select aria-label={`${unit} type`} value={e.type} onChange={event => engine.effect(unit, { type: +event.target.value })}>{effectTypes[unit].map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
      {(unit === 'mod1' || unit === 'delay') && toggle(`${unit} clock sync`, e.sync, () => engine.effect(unit, { sync: !e.sync }))}
      {(unit === 'mod1' || unit === 'mod2' ? ['rate', 'amount'] as const : unit === 'delay' ? ['rate', 'feedback', 'wet'] as const : unit === 'ampEq' ? ['amount', 'bass', 'mid', 'rate', 'treble'] as const : unit === 'compressor' ? ['amount'] as const : ['wet', 'tone'] as const).map(prop => { const eq = ['bass', 'mid', 'treble'].includes(prop); const name = prop === 'rate' ? unit === 'delay' ? 'Time' : unit === 'ampEq' ? 'Mid / Filter frequency' : 'Rate / Sensitivity' : prop === 'amount' && unit === 'ampEq' ? 'Drive' : prop === 'wet' ? 'Dry / Wet' : prop; return <label key={prop}>{name}<input aria-label={`${unit} ${name}`} type="range" min={eq ? -15 : 0} max={eq ? 15 : 1} step={eq ? .1 : .01} value={e[prop]} onChange={event => engine.effect(unit, { [prop]: +event.target.value })} /><output>{e[prop].toFixed(2)}</output></label> })}
    </fieldset> })}</div>
  </details>
}
