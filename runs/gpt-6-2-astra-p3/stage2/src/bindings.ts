import { createContext } from 'react'
import {
  defaults,
  selectType,
  editEffect,
  families,
  focus,
  globalMode,
  globalUnits,
  groupMode,
  types,
  type LayerId,
  type Settings,
  type Unit,
  type Effect,
  delayTime,
} from './settings'
export type Mutate = (fn: (s: Settings) => void) => void
export const Live = createContext({
  settings: defaults(),
  change: ((fn) => {
    void fn
  }) as Mutate,
  sound: 'Loading',
  feedback: '',
})
export const touchNames = ['Heavy', 'Medium', 'Light']
export const timbres = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2']
type Binding = {
  value: number
  label: string
  write: (s: Settings, v: number, shift: boolean) => void
}
const fxMap: Record<string, [Unit, keyof Effect]> = {
  'mod-1-rate': ['mod1', 'rate'],
  'mod-1-amount': ['mod1', 'amount'],
  'mod-1-variation': ['mod1', 'type'],
  'mod-1-on': ['mod1', 'on'],
  'mod-2-rate': ['mod2', 'rate'],
  'mod-2-amount': ['mod2', 'amount'],
  'mod-2-variation': ['mod2', 'type'],
  'mod-2-on': ['mod2', 'on'],
  'amp-drive': ['amp', 'amount'],
  'mid-frequency': ['amp', 'freq'],
  bass: ['amp', 'bass'],
  mid: ['amp', 'mid'],
  treble: ['amp', 'treble'],
  'amp-variation': ['amp', 'type'],
  'amp-on': ['amp', 'on'],
  'delay-tempo': ['delay', 'rate'],
  'delay-feedback': ['delay', 'feedback'],
  'delay-mix': ['delay', 'mix'],
  'delay-on': ['delay', 'on'],
  'compressor-on': ['compressor', 'on'],
  'compressor-amount': ['compressor', 'amount'],
  'reverb-on': ['reverb', 'on'],
  'reverb-mix': ['reverb', 'mix'],
  'reverb-tone': ['reverb', 'tone'],
  'reverb-variation': ['reverb', 'type'],
}
export function binding(id: string, s: Settings): Binding | undefined {
  const l = s.layers[s.focus]
  function field(
    value: boolean | number,
    label: string,
    write: Binding['write'],
  ): Binding {
    return {
      value: typeof value === 'boolean' ? Number(value) * 100 : value,
      label,
      write,
    }
  }
  function toggle(
    key: 'section' | 'effects' | 'rotary' | 'speed' | 'shift' | 'stopped',
  ) {
    return field(s[key], s[key] ? 'On' : 'Off', (n) => {
      n[key] = !n[key]
    })
  }
  const name = id.replace(/^[^-]+-/, '')
  if (id === 'performance-master-level')
    return field(s.master, s.master + '%', (n, v) => {
      n.master = v
    })
  if (id === 'performance-pitch-stick')
    return field(s.bend, (s.bend - 50) * 4 + ' cents', (n, v) => {
      n.bend = v
    })
  if (id === 'performance-rotary-drive')
    return field(s.drive, s.drive + '%', (n, v) => {
      n.drive = v
    })
  if (id === 'performance-rotary-on') return toggle('rotary')
  if (id === 'performance-rotary-speed') return toggle('speed')
  if (id === 'performance-rotary-stop-mode') return toggle('stopped')
  if (id.startsWith('piano-')) {
    if (name === 'section-on') return toggle('section')
    if (name.startsWith('layer-')) {
      const i: LayerId = name.startsWith('layer-a') ? 0 : 1,
        layer = s.layers[i]
      if (name.endsWith('level'))
        return field(layer.level, layer.level + '%', (n, v) => {
          focus(n, i)
          n.layers[i].level = v
        })
      return field(
        layer.enabled,
        layer.enabled ? 'Enabled' : 'Off',
        (n, _v, shift) => {
          if (shift) {
            const k = i === 0 ? 'pedal' : 'stick'
            n.layers[n.focus][k] = !n.layers[n.focus][k]
            return
          }
          if (n.focus === i || !layer.enabled)
            n.layers[i].enabled = !layer.enabled
          focus(n, i)
        },
      )
    }
    if (name.startsWith('octave-')) {
      const delta = name === 'octave-up' ? 1 : -1
      return field(l.octave === delta, l.octave + ' oct', (n) => {
        n.layers[n.focus].octave = Math.max(-1, Math.min(1, l.octave + delta))
      })
    }
    if (name === 'acoustics')
      return field(
        l.soft || l.res,
        [l.soft ? 'Soft release' : '', l.res ? 'String res' : '']
          .filter(Boolean)
          .join(' + ') || (l.type === 3 ? 'Unavailable for Clav' : 'Off'),
        (n) => {
          if (l.type === 3) return
          const next = (+l.soft + 2 * +l.res + 1) % (l.type < 2 ? 4 : 2)
          n.layers[n.focus].soft = !!(next & 1)
          n.layers[n.focus].res = !!(next & 2)
        },
      )
    const cycles: Record<
      string,
      ['type' | 'touch' | 'dyn' | 'timbre' | 'unison', string[]]
    > = {
      'piano-type': ['type', families],
      'keyboard-touch': ['touch', touchNames],
      timbre: ['timbre', timbres.slice(0, l.type === 2 ? 6 : 4)],
      'dynamic-compression': ['dyn', ['Off', '1', '2', '3']],
      unison: ['unison', ['Off', '1', '2', '3']],
    }
    const cycle = cycles[name]
    if (cycle) {
      const [k, labels] = cycle
      return field(l[k], labels[l[k]], (n) => {
        const layer = n.layers[n.focus]
        layer[k] = (layer[k] + 1) % labels.length
        if (k === 'type') selectType(layer, layer.type)
      })
    }
  }
  if (!id.startsWith('effects-')) return
  if (name === 'section-on') return toggle('effects')
  if (name === 'effects-shift') return toggle('shift')
  if (name.startsWith('layer-focus-')) {
    const t = name.slice(12),
      target = t[0].toUpperCase() + t.slice(1)
    return field(
      s.target === target,
      target === 'Piano'
        ? s.group
          ? 'Piano group'
          : 'FX Piano ' + 'AB'[s.fxFocus]
        : target + ' offline',
      (n, _v, shift) => {
        if (target === 'Piano') {
          if (shift || n.shift) groupMode(n)
          else
            n.fxFocus =
              n.target === 'Piano' ? ((1 - n.fxFocus) as LayerId) : n.focus
        }
        n.target = target
      },
    )
  }
  const entry = fxMap[name]
  if (!entry) return
  const [unit, key] = entry,
    fx = s.layers[s.fxFocus].fx[unit],
    v = fx[key]
  const text =
    key === 'type'
      ? types[unit][fx.type]
      : key === 'tone'
        ? ['Neutral', 'Bright', 'Dark'][fx.tone]
        : typeof v === 'boolean'
          ? v
            ? 'On'
            : 'Off'
          : String(v) + '%'
  return field(
    s.target === 'Piano' ? v : 0,
    s.target === 'Piano'
      ? text + (key === 'on' && s.globals.includes(unit) ? ' · global' : '')
      : 'Section offline',
    (n, value, shift) => {
      if (n.target !== 'Piano') return
      if ((shift || n.shift) && key === 'type') return
      if ((shift || n.shift) && key === 'on' && globalUnits.includes(unit)) {
        globalMode(n, unit)
        return
      }
      const next =
        key === 'type'
          ? (fx.type + 1) % types[unit].length
          : key === 'tone'
            ? (fx.tone + 1) % 3
            : typeof v === 'boolean'
              ? !v
              : value
      editEffect(n, unit, { [key]: next })
    },
  )
}
export function tap(s: Settings, interval: number) {
  if (interval < 0.05 || interval > 1.5 || s.target !== 'Piano') return
  const sync = s.layers[s.fxFocus].fx.delay.sync
  const rates = Array.from({ length: 101 }, (_, i) => i)
  const closest = rates.reduce((a, b) =>
    Math.abs(delayTime(a, sync) - interval) <
    Math.abs(delayTime(b, sync) - interval)
      ? a
      : b,
  )
  editEffect(s, 'delay', { rate: closest })
}
