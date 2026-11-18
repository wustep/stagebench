import { useContext, useState } from 'react'
import { Live, timbres, touchNames } from './bindings'
import {
  delayTime,
  families,
  selectType,
  focus,
  globalMode,
  globalUnits,
  groupMode,
  layers,
  models,
  order,
  types,
  type Effect,
  type Unit,
  editEffect,
  type LayerId,
} from './settings'

function Select({
  label,
  value,
  items,
  set,
}: {
  label: string
  value: number
  items: string[]
  set: (n: number) => void
}) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
      >
        {items.map((t, i) => (
          <option key={t} value={i}>
            {t}
          </option>
        ))}
      </select>
    </label>
  )
}
function Slider({
  label,
  value,
  set,
}: {
  label: string
  value: number
  set: (n: number) => void
}) {
  return (
    <label>
      {label}
      <span className="pair">
        <input
          type="range"
          aria-label={label}
          value={value}
          onChange={(e) => set(+e.target.value)}
        />
        <output>{value}</output>
      </span>
    </label>
  )
}
function Check({
  label,
  on,
  set,
  disabled = false,
}: {
  label: string
  on: boolean
  set: () => void
  disabled?: boolean
}) {
  return (
    <label>
      {label}
      <input type="checkbox" checked={on} disabled={disabled} onChange={set} />
    </label>
  )
}
const titles = [
  'Mod 1',
  'Mod 2',
  'Delay',
  'Amp Sim / EQ',
  'Compressor',
  'Reverb',
]
export function Editor() {
  const { settings: s, change } = useContext(Live),
    l = s.layers[s.focus]
  const [unit, setUnit] = useState<Unit>('mod1'),
    fx = s.layers[s.fxFocus].fx[unit]
  const patch = (part: Partial<typeof l>) =>
    change((n) => Object.assign(n.layers[n.focus], part))
  const effect = (part: Partial<Effect>) =>
    change((n) => {
      n.target = 'Piano'
      editEffect(n, unit, part)
    })
  return (
    <div className="editor">
      <h2>Piano layers</h2>
      <div className="pair">
        {layers.map((i) => (
          <button
            key={i}
            aria-pressed={s.focus === i}
            onClick={() => change((n) => focus(n, i))}
          >
            Piano {'AB'[i]}
          </button>
        ))}
      </div>
      <fieldset>
        <legend>{models[l.type]}</legend>
        <Check
          label="Section on"
          on={s.section}
          set={() =>
            change((n) => {
              n.section = !n.section
            })
          }
        />
        <Check
          label="Layer enabled"
          on={l.enabled}
          set={() => patch({ enabled: !l.enabled })}
        />
        <Select
          label="Instrument"
          items={families}
          value={l.type}
          set={(type) => change((n) => selectType(n.layers[n.focus], type))}
        />
        <Slider
          label="Layer level"
          value={l.level}
          set={(level) => patch({ level })}
        />
        <Select
          label="Octave"
          value={l.octave + 1}
          items={['−1', '0', '+1']}
          set={(v) => patch({ octave: v - 1 })}
        />
        <Select
          label="KB touch"
          value={l.touch}
          items={touchNames}
          set={(touch) => patch({ touch })}
        />
        <Select
          label="Dyn comp"
          value={l.dyn}
          items={['Off', '1', '2', '3']}
          set={(dyn) => patch({ dyn })}
        />
        <Select
          label="Timbre"
          value={l.timbre}
          items={timbres.slice(0, l.type === 2 ? 6 : 4)}
          set={(timbre) => patch({ timbre })}
        />
        <Select
          label="Unison"
          value={l.unison}
          items={['Off', '1', '2', '3']}
          set={(unison) => patch({ unison })}
        />
        <Check
          label="Soft release"
          on={l.soft}
          disabled={l.type === 3}
          set={() => patch({ soft: !l.soft })}
        />
        <Check
          label="String resonance"
          on={l.res}
          disabled={l.type > 1}
          set={() => patch({ res: !l.res })}
        />
        <Check
          label="SUSTPED"
          on={l.pedal}
          set={() => patch({ pedal: !l.pedal })}
        />
        <Check
          label="PSTICK"
          on={l.stick}
          set={() => patch({ stick: !l.stick })}
        />
      </fieldset>
      <fieldset>
        <legend>Layer effects</legend>
        <Check
          label="Effects on"
          on={s.effects}
          set={() =>
            change((n) => {
              n.effects = !n.effects
            })
          }
        />
        <Select
          label="FX focus"
          value={s.fxFocus}
          items={['Piano A', 'Piano B']}
          set={(v) =>
            change((n) => {
              n.target = 'Piano'
              n.fxFocus = v as LayerId
            })
          }
        />
        <Check
          label="Piano group"
          on={s.group}
          set={() =>
            change((n) => {
              n.target = 'Piano'
              groupMode(n)
            })
          }
        />
        <Select
          label="Unit"
          value={order.indexOf(unit)}
          items={titles}
          set={(v) => setUnit(order[v])}
        />
        <Check label="Unit on" on={fx.on} set={() => effect({ on: !fx.on })} />
        {globalUnits.includes(unit) && (
          <Check
            label="Global"
            on={s.globals.includes(unit)}
            set={() =>
              change((n) => {
                n.target = 'Piano'
                globalMode(n, unit)
              })
            }
          />
        )}
        {types[unit].length > 1 && (
          <Select
            label="Type"
            value={fx.type}
            items={types[unit]}
            set={(type) => effect({ type })}
          />
        )}
        {(unit.startsWith('mod') || unit === 'delay') && (
          <Slider
            label={
              unit === 'delay'
                ? 'Tempo · ' +
                  Math.round(delayTime(fx.rate, fx.sync) * 1000) +
                  ' ms'
                : 'Rate / sens'
            }
            value={fx.rate}
            set={(rate) => effect({ rate })}
          />
        )}
        {(unit === 'delay' ||
          (unit === 'mod1' && ![2, 3].includes(fx.type))) && (
          <Check
            label="Clock sync · 120 BPM"
            on={fx.sync}
            set={() => effect({ sync: !fx.sync })}
          />
        )}
        {unit === 'delay' && (
          <>
            <Slider
              label="Feedback"
              value={fx.feedback}
              set={(feedback) => effect({ feedback })}
            />
            <Select
              label="Feedback filter"
              value={fx.filter}
              items={['Off', 'LP', 'HP', 'BP']}
              set={(filter) => effect({ filter })}
            />
          </>
        )}
        {!['delay', 'reverb'].includes(unit) && (
          <Slider
            label={unit === 'amp' ? 'Drive' : 'Amount'}
            value={fx.amount}
            set={(amount) => effect({ amount })}
          />
        )}
        {unit === 'amp' &&
          (['bass', 'mid', 'freq', 'treble'] as const).map((k) => (
            <Slider
              key={k}
              label={
                {
                  bass: 'Bass',
                  mid: 'Mid gain / resonance',
                  freq: 'Frequency',
                  treble: 'Treble',
                }[k]
              }
              value={fx[k]}
              set={(v) => effect({ [k]: v })}
            />
          ))}
        {unit === 'compressor' && (
          <Check
            label="Fast"
            on={fx.fast}
            set={() => effect({ fast: !fx.fast })}
          />
        )}
        {unit === 'reverb' && (
          <Select
            label="Tone"
            value={fx.tone}
            items={['Neutral', 'Bright', 'Dark']}
            set={(tone) => effect({ tone })}
          />
        )}
        <Slider
          label="Dry / wet"
          value={fx.mix}
          set={(mix) => effect({ mix })}
        />
      </fieldset>
    </div>
  )
}
