import { useContext, useState } from 'react'
import { Performance } from './performance'
import { Live } from './bindings'
import { address, positions } from './programs'
import { allLayers, type Settings } from './settings'
import { property, options } from './engineBindings'
import { waves, registrations, vibratos } from './patches'
export const unsupported = [
  'Organ preset library, physical drawbar sync, swell, trigger and wear settings.',
  'Section preset libraries, aftertouch, Section Edit, Monitor/Copy, bank organization, Aux KB, Extern, Num Pad and Shift menus.',
  'Synth samples, pattern editing, group editing, aftertouch vibrato and external clock.',
  'Delay feedback-loop effects, analog delay, effect variations, reverb chorale, pedal-controlled Wah/Pump, rotary microphone and stop-angle settings, and post-rotary global reverb.',
  'Piano sample size and INFO pages, Sound Manager downloads, pedal noise, half-pedaling, soft and sostenuto pedals and triple-pedal configuration.',
  'Organize swap/move, layer initialization, external pedal tap, MIDI output, alphabetic sorting and program-change undo.',
]
const layerNames = [
  'Piano A',
  'Piano B',
  'Organ A',
  'Organ B',
  'Synth A',
  'Synth B',
  'Synth C',
]
const notes = (n: number) =>
  ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][n % 12] +
  (Math.floor(n / 12) - 1)
const titles: Record<string, string> = {
  'synth-info': 'Synth parameters',
  'synth-synth-mode': 'Analog oscillator',
  'synth-vibrato-menu': 'Vibrato',
  'synth-arp-menu': 'Arpeggiator / Gate',
  'synth-oscillator-pitch': 'Oscillator pitch',
  'synth-oscillator-envelope': 'Oscillator envelope',
  'synth-filter-envelope': 'Filter envelope',
  'synth-amp-envelope': 'Amplifier envelope',
}
export function SystemEditor({
  menu,
  select,
  refresh,
  close,
}: {
  menu: string
  select: (index: number, live?: boolean) => void
  refresh: () => void
  close: () => void
}) {
  const { bank, open, command, assignSource } = useContext(Performance)!
  const { settings: s, change } = useContext(Live)
  const [name, setName] = useState(bank.slot.name)
  const param = (
    path: string,
    label: string,
    min = 0,
    max = 100,
    choices?: string[],
  ) => {
    const { node, key } = property(s, path),
      value = node[key]
    const set = (v: number | boolean) =>
      change((n) => {
        const obj = property(n, path)
        obj.node[obj.key] = v
      })
    return (
      <label key={path}>
        {label}
        {typeof value === 'boolean' ? (
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => set(e.target.checked)}
          />
        ) : choices ? (
          <select value={Number(value)} onChange={(e) => set(+e.target.value)}>
            {choices.map((v, i) => (
              <option value={i + min} key={v}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <span className="pair">
            <input
              type="range"
              min={min}
              max={max}
              value={Number(value)}
              onChange={(e) => set(+e.target.value)}
            />
            <output>{Math.round(Number(value))}</output>
          </span>
        )}
      </label>
    )
  }
  const action = (label: string, fn: () => void) => (
    <button onClick={fn}>{label}</button>
  )
  const i = s.synthFocus,
    path = 'synth.' + i + '.patch.'
  const env = (key: string) => (
    <fieldset key={key}>
      <legend>
        {
          { oscEnv: 'Oscillator', ampEnv: 'Amplifier', filterEnv: 'Filter' }[
            key
          ]
        }{' '}
        envelope
      </legend>
      {['attack', 'decay', 'release', 'velocity'].map((k) =>
        param(
          path + key + '.' + k,
          k,
          0,
          k === 'velocity' ? (key === 'ampEnv' ? 3 : 1) : 100,
        ),
      )}
    </fieldset>
  )
  const list = menu === 'Program list' || menu === 'Store destination'
  const synth = menu.startsWith('synth-')
  return (
    <div className="editor system-editor">
      {menu !== 'Performance' && (
        <button className="back-link" onClick={() => open('Performance')}>
          ‹ Performance
        </button>
      )}
      <h2>{titles[menu] ?? menu}</h2>
      {bank.error && <p role="alert">{bank.error}</p>}
      {menu === 'Performance' && (
        <>
          <small>
            {bank.live ? 'LIVE ' + (bank.index + 1) : address(bank.index)} ·{' '}
            {bank.slot.name}
            {bank.dirty ? ' · Edited' : ''}
          </small>
          <div className="actions">
            {[
              'Program list',
              'Splits and zones',
              'Morphs',
              'Organ registration',
              'synth-info',
              'Effects',
              'Unsupported controls',
            ].map((m) => (
              <button key={m} onClick={() => open(m)}>
                {titles[m] ?? m}
              </button>
            ))}
          </div>
          <fieldset>
            <legend>Program memory</legend>
            <div className="actions">
              {action('Store', () => command('program-store'))}
              {action('Store As', () => open('Store As'))}
              {action(bank.live ? 'Leave Live mode' : 'Enter Live mode', () =>
                command('program-live-mode'),
              )}
            </div>
          </fieldset>
          <fieldset>
            <legend>Performance</legend>
            {param('bpm', 'Master clock BPM', 30, 300)}
            {param('kbSync', 'Keyboard clock sync')}
            {param('transpose', 'Transpose', -6, 6)}
            {param('pedalValue', 'Control pedal')}
            {action('Scene ' + (s.scene ? 'II' : 'I'), () =>
              command('program-layer-scene'),
            )}
            {action('Panic', () => command('program-transpose', 0, true))}
          </fieldset>
        </>
      )}
      {list && (
        <>
          <p>
            {bank.pending
              ? 'Audition a destination, then confirm to write “' +
                bank.pending.name +
                '”.'
              : 'Select a slot to play its stored settings.'}
          </p>
          <div className="actions">
            {action(bank.live ? 'Regular programs' : 'Live slots', () =>
              select(0, !bank.live),
            )}
          </div>
          <div className="slot-list">
            {bank.slots.map((slot, i) => (
              <button
                key={i}
                aria-pressed={i === bank.index}
                onClick={() => {
                  select(i)
                  if (!bank.pending) close()
                }}
              >
                <b>{bank.live ? 'L' + (i + 1) : address(i)}</b> {slot.name}
              </button>
            ))}
          </div>
          {bank.pending && (
            <div className="actions">
              {action('Confirm Store', () => command('confirm-store'))}
              {action('Cancel Store', () => command('cancel-store'))}
            </div>
          )}
        </>
      )}
      {menu === 'Store As' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            bank.store(name)
            refresh()
            close()
          }}
        >
          <label>
            Program name
            <input
              autoFocus
              maxLength={30}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit">Choose destination</button>
        </form>
      )}
      {menu === 'Splits and zones' && (
        <>
          {param('split', 'Split enabled')}
          {s.points.map((p, i) => (
            <fieldset key={i}>
              <legend>{['Low', 'Mid', 'High'][i]}</legend>
              {param('points.' + i + '.on', 'Active')}
              <label>
                Split note
                <select
                  value={p.note}
                  onChange={(e) =>
                    change((n) => {
                      n.points[i].note = +e.target.value
                    })
                  }
                >
                  {positions.map((note) => (
                    <option
                      key={note}
                      disabled={s.points.some(
                        (other, j) =>
                          other.on &&
                          j !== i &&
                          (j < i ? other.note >= note : other.note <= note),
                      )}
                      value={note}
                    >
                      {notes(note)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Crossfade
                <select
                  value={p.width}
                  onChange={(e) =>
                    change((n) => {
                      n.points[i].width = +e.target.value
                    })
                  }
                >
                  {[0, 6, 12].map((w) => (
                    <option key={w} value={w}>
                      {w ? '±' + w + ' semitones' : 'Off'}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          ))}
          <fieldset>
            <legend>Keyboard zones</legend>
            {allLayers(s).map((l, i) => (
              <label key={i}>
                {layerNames[i]}
                <select
                  aria-label={layerNames[i] + ' zone range'}
                  value={l.zone.join('-')}
                  onChange={(e) =>
                    change((n) => {
                      allLayers(n)[i].zone = e.target.value
                        .split('-')
                        .map(Number)
                    })
                  }
                >
                  {[0, 1, 2, 3].flatMap((a) =>
                    [0, 1, 2, 3].slice(a).map((b) => (
                      <option key={a + '-' + b} value={a + '-' + b}>
                        {a === b
                          ? 'Zone ' + (a + 1)
                          : 'Zones ' + (a + 1) + '–' + (b + 1)}
                      </option>
                    )),
                  )}
                </select>
              </label>
            ))}
          </fieldset>
        </>
      )}
      {menu === 'Morphs' && (
        <>
          <p>
            Press a source on the Morph Assign panel, then move destination
            controls to their end positions. Press the source again to finish.
            Shift plus a source clears its assignments.
          </p>
          {param('wheel', 'Wheel')}
          {param('pedalValue', 'Control pedal')}
          <p>
            {assignSource
              ? 'Assigning ' + assignSource
              : s.morphs.length + ' assignments'}
          </p>
          {s.morphs.map((m) => (
            <label key={m.source + m.path}>
              {m.source} · {m.path} · {m.start} → {m.end}
              {action('Remove', () =>
                change((n) => {
                  n.morphs = n.morphs.filter(
                    (a) => a.path !== m.path || a.source !== m.source,
                  )
                }),
              )}
            </label>
          ))}
        </>
      )}
      {synth && (
        <>
          <div className="actions">
            {s.synth.map((_, j) => (
              <button
                key={j}
                aria-pressed={i === j}
                onClick={() =>
                  change((n) => {
                    n.synthFxFocus = n.synthFocus = j
                    n.target = 'Synth'
                  })
                }
              >
                Synth {'ABC'[j]}
              </button>
            ))}
          </div>
          {(menu === 'synth-info' || menu === 'synth-synth-mode') && (
            <fieldset>
              <legend>Analog source</legend>
              {param(path + 'wave', 'Waveform', 0, 13, waves)}
              {param(path + 'ctrl', 'Osc Ctrl')}
              {param('synthOn', 'Synth section on')}
              {param('synth.' + i + '.enabled', 'Layer enabled')}
            </fieldset>
          )}
          {[
            'synth-info',
            'synth-oscillator-pitch',
            'synth-oscillator-envelope',
          ].includes(menu) && (
            <fieldset>
              <legend>Pitch</legend>
              {param(path + 'coarse', 'Coarse semitones', -24, 24)}
              {param(path + 'fine', 'Fine cents', -50, 50)}
              {param(path + 'toPitch', 'Env to pitch')}
              {param(path + 'oscAmt', 'Osc env amount')}
            </fieldset>
          )}
          {(menu === 'synth-info' || menu === 'synth-filter-envelope') && (
            <fieldset>
              <legend>Filter</legend>
              {(['filterType', 'tracking', 'drive'] as const).map((k) =>
                param(path + k, k, 0, 3, options[k]),
              )}
              {param(path + 'cutoff', 'Cutoff')}
              {param(path + 'resonance', 'Resonance')}
              {param(path + 'filterAmt', 'Env amount')}
            </fieldset>
          )}
          {(menu === 'synth-info' || menu === 'synth-oscillator-envelope') &&
            env('oscEnv')}
          {(menu === 'synth-info' || menu === 'synth-filter-envelope') &&
            env('filterEnv')}
          {(menu === 'synth-info' || menu === 'synth-amp-envelope') &&
            env('ampEnv')}
          {(menu === 'synth-info' || menu === 'synth-vibrato-menu') && (
            <fieldset>
              <legend>Voice</legend>
              {(['mode', 'priority', 'unison', 'vibrato'] as const).map((k) =>
                param(path + k, k, 0, 3, options[k]),
              )}
              {param(path + 'glide', 'Glide')}
              {param(path + 'vibRate', 'Vibrato Hz', 2, 8)}
              {param(path + 'vibAmt', 'Vibrato depth', 0, 10)}
            </fieldset>
          )}
          {menu === 'synth-info' && (
            <fieldset>
              <legend>LFO</legend>
              {param(path + 'lfoWave', 'Wave', 0, 4, options.lfoWave)}
              {param(path + 'lfoDest', 'Destination', 0, 3, options.lfoDest)}
              {param(path + 'lfoAmt', 'Depth')}
              {param(path + 'lfoRate', 'Rate')}
              {param(path + 'lfoSync', 'Clock sync')}
            </fieldset>
          )}
          {(menu === 'synth-info' || menu === 'synth-arp-menu') && (
            <fieldset>
              <legend>Arpeggiator / Gate</legend>
              {param(path + 'arp', 'Run')}
              {param(path + 'hold', 'Keyboard hold')}
              {param(path + 'arpMode', 'Mode', 0, 2, options.arpMode)}
              {param(path + 'direction', 'Direction', 0, 3, options.direction)}
              {param(path + 'arpRate', 'Rate')}
              {param(path + 'arpSync', 'Clock sync')}
              {param(path + 'range', 'Range / hardness', 1, 4)}
            </fieldset>
          )}
        </>
      )}
      {menu === 'Organ registration' && (
        <>
          <div className="actions">
            {s.organ.map((_, i) => (
              <button
                key={i}
                aria-pressed={s.organFocus === i}
                onClick={() =>
                  change((n) => {
                    n.organFocus = i
                    n.target = 'Organ'
                  })
                }
              >
                Organ {'AB'[i]}
              </button>
            ))}
          </div>
          {param('organOn', 'Organ section on')}
          {param('organ.' + s.organFocus + '.enabled', 'Layer enabled')}
          <fieldset>
            <legend>Registration</legend>
            {param(
              'organ.' + s.organFocus + '.patch.model',
              'Model',
              0,
              5,
              registrations,
            )}
            {s.organ[s.organFocus].patch.bars.map((_, i) =>
              param(
                'organ.' + s.organFocus + '.patch.bars.' + i,
                'Drawbar ' + (i + 1),
                0,
                8,
              ),
            )}
          </fieldset>
          <fieldset>
            <legend>Articulation</legend>
            {param('organ.' + s.organFocus + '.patch.click', 'B3 key click')}
            {param(
              'organ.' + s.organFocus + '.patch.percussion',
              'B3 percussion',
            )}
            {param(
              'organ.' + s.organFocus + '.patch.vibrato',
              'Vibrato / chorus enabled',
            )}
            {param(
              'organ.' + s.organFocus + '.patch.vibMode',
              'Vibrato / chorus',
              0,
              5,
              vibratos,
            )}
          </fieldset>
        </>
      )}
      {menu === 'Unsupported controls' && (
        <ul>
          {unsupported.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {menu === 'Effects' && <EffectsEditor />}
    </div>
  )
}
import {
  fxLayer,
  order,
  types,
  editEffect,
  globalMode,
  groupMode,
  grouped,
  globalUnits,
  type Effect,
} from './settings'
function EffectsEditor() {
  const { settings: s, change } = useContext(Live)
  return (
    <>
      {['Organ', 'Piano', 'Synth'].map((t) => (
        <button
          key={t}
          aria-pressed={s.target === t}
          onClick={() =>
            change((n) => {
              n.target = t
            })
          }
        >
          {t}
        </button>
      ))}
      {s.target !== 'Organ' && (
        <div className="actions">
          {(s.target === 'Piano' ? [0, 1] : [0, 1, 2]).map((i) => (
            <button
              key={i}
              aria-pressed={
                i === (s.target === 'Piano' ? s.fxFocus : s.synthFxFocus)
              }
              onClick={() =>
                change((n) => {
                  if (n.target === 'Piano') n.fxFocus = i as 0 | 1
                  else n.synthFxFocus = i
                })
              }
            >
              Layer {'ABC'[i]}
            </button>
          ))}
          <button aria-pressed={grouped(s)} onClick={() => change(groupMode)}>
            Group layers
          </button>
        </div>
      )}
      {order.map((unit) => {
        const fx = fxLayer(s).fx[unit],
          write = (patch: Partial<Effect>) =>
            change((n: Settings) => editEffect(n, unit, patch))
        return (
          <fieldset key={unit}>
            <legend>
              {unit} · {s.target}{' '}
              {
                'ABC'[
                  s.target === 'Synth'
                    ? s.synthFxFocus
                    : s.target === 'Piano'
                      ? s.fxFocus
                      : 0
                ]
              }
            </legend>
            <label>
              Enabled
              <input
                type="checkbox"
                checked={fx.on}
                onChange={() => write({ on: !fx.on })}
              />
            </label>
            <label>
              Type
              <select
                value={fx.type}
                onChange={(e) => write({ type: +e.target.value })}
              >
                {types[unit].map((v, i) => (
                  <option value={i} key={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {[
              'mix',
              ...(unit === 'delay'
                ? ['rate', 'feedback']
                : unit.startsWith('mod')
                  ? ['rate', 'amount']
                  : unit === 'amp'
                    ? ['amount', 'bass', 'mid', 'freq', 'treble']
                    : unit === 'compressor'
                      ? ['amount']
                      : []),
            ].map((k) => (
              <label key={k}>
                {k}
                <input
                  type="range"
                  value={Number(fx[k as keyof Effect])}
                  onChange={(e) => write({ [k]: +e.target.value })}
                />
              </label>
            ))}
            {globalUnits.includes(unit) && (
              <label>
                Global
                <input
                  type="checkbox"
                  checked={s.globals.includes(unit)}
                  onChange={() => change((n) => globalMode(n, unit))}
                />
              </label>
            )}
            {unit === 'delay' && (
              <>
                <label>
                  Feedback filter
                  <select
                    value={fx.filter}
                    onChange={(e) => write({ filter: +e.target.value })}
                  >
                    {['Off', 'LP', 'HP', 'BP'].map((v, i) => (
                      <option key={v} value={i}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Ping pong
                  <input
                    type="checkbox"
                    checked={fx.pingPong}
                    onChange={() => write({ pingPong: !fx.pingPong })}
                  />
                </label>
              </>
            )}
            {unit === 'compressor' && (
              <label>
                Fast
                <input
                  type="checkbox"
                  checked={fx.fast}
                  onChange={() => write({ fast: !fx.fast })}
                />
              </label>
            )}
            {unit === 'reverb' && (
              <label>
                Tone
                <select
                  value={fx.tone}
                  onChange={(e) => write({ tone: +e.target.value })}
                >
                  {['Neutral', 'Bright', 'Dark'].map((v, i) => (
                    <option key={v} value={i}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(unit === 'delay' ||
              (unit === 'mod1' && ![2, 3].includes(fx.type))) && (
              <label>
                Master clock sync
                <input
                  type="checkbox"
                  checked={fx.sync}
                  onChange={() => write({ sync: !fx.sync })}
                />
              </label>
            )}
          </fieldset>
        )
      })}
    </>
  )
}
