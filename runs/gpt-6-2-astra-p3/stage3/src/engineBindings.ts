import { type Settings } from './settings'
import {
  categories,
  registrations,
  synthPatch,
  vibratos,
  waveGroups,
  waves,
} from './patches'
import type { Binding } from './bindings'
export const options = {
  filterType: ['LP12', 'LP24', 'HP', 'BP'],
  mode: ['Poly', 'Mono', 'Legato'],
  priority: ['Last', 'Low', 'High'],
  lfoWave: ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'],
  lfoDest: ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'],
  arpMode: ['Arp', 'Poly', 'Gate'],
  direction: ['Up', 'Down', 'Up/Down', 'Random'],
  vibrato: ['Off', 'On', 'Wheel'],
  tracking: ['Off', '1/3', '2/3', '1'],
  drive: ['Off', '1', '2', '3'],
  unison: ['Off', '1', '2', '3'],
}
export function property(s: Settings, path: string) {
  const keys = path.split('.'),
    key = keys.pop()!
  let node = s as unknown as Record<string, unknown>
  for (const k of keys) node = node[k] as Record<string, unknown>
  return { node, key }
}
export function param(
  s: Settings,
  path: string,
  items?: string[],
  steps?: number,
  cycle = false,
): Binding {
  const { node, key } = property(s, path),
    raw = node[key],
    v = Number(raw)
  return {
    path,
    value:
      typeof raw === 'boolean'
        ? 100 * v
        : items || steps
          ? (v * 100) / ((items?.length ?? steps! + 1) - 1)
          : v,
    label:
      items?.[v] ??
      (typeof raw === 'boolean' ? (raw ? 'On' : 'Off') : String(v)),
    write: (n, value) => {
      const { node, key } = property(n, path)
      node[key] =
        typeof raw === 'boolean'
          ? !raw
          : items || steps
            ? cycle
              ? (v + 1) % (items?.length ?? steps! + 1)
              : Math.round((value / 100) * ((items?.length ?? steps! + 1) - 1))
            : value
    },
  }
}
export function engineBinding(id: string, s: Settings): Binding | undefined {
  if (id === 'performance-modulation-wheel') return param(s, 'wheel')
  const organ = id.startsWith('organ-'),
    part = organ ? 'organ' : 'synth'
  if (!organ && !id.startsWith('synth-')) return
  const name = id.slice(part.length + 1),
    index = organ ? s.organFocus : s.synthFocus
  const path = part + '.' + index + '.patch.'
  const select = (n: Settings, i: number) => {
    if (organ) n.organFocus = i
    else n.synthFxFocus = n.synthFocus = i
    n.target = organ ? 'Organ' : 'Synth'
  }
  if (name === 'section-on') return param(s, part + 'On')
  const layer = name.match(/^layer-([abc])-(on|level)$/)
  if (layer) {
    const i = 'abc'.indexOf(layer[1]),
      level = layer[2] === 'level',
      b = param(s, part + '.' + i + '.' + (level ? 'level' : 'enabled'))
    return {
      ...b,
      write: (n, v, shift) => {
        const l = n[part][i]
        if (shift && !level) {
          const key = i === 0 ? 'pedal' : 'stick'
          n[part][index][key] = !n[part][index][key]
          return
        }
        if (level) b.write(n, v, shift)
        else if (!n[organ ? 'organOn' : 'synthOn']) {
          n[organ ? 'organOn' : 'synthOn'] = true
          l.enabled = true
        } else if (index === i || !l.enabled) l.enabled = !l.enabled
        select(n, i)
      },
    }
  }
  if (name.startsWith('octave-')) {
    const l = s[part][index],
      d = name === 'octave-up' ? 1 : -1
    return {
      value: Number(l.octave === d) * 100,
      label: l.octave + ' oct',
      write: (n) => {
        n[part][index].octave = Math.max(-1, Math.min(1, l.octave + d))
      },
    }
  }
  if (organ) {
    const draw = name.match(/^drawbar-(\d+)/)
    if (draw) return param(s, path + 'bars.' + (+draw[1] - 1), undefined, 8)
    const fields: Record<string, string> = {
      'organ-model': 'model',
      'vibrato-mode': 'vibMode',
      'vibrato-on': 'vibrato',
      'percussion-on': 'percussion',
      'percussion-volume': 'soft',
      'percussion-decay': 'fast',
      'percussion-harmonic': 'third',
    }
    if (fields[name])
      return param(
        s,
        path + fields[name],
        name === 'organ-model'
          ? registrations
          : name === 'vibrato-mode'
            ? vibratos
            : undefined,
        undefined,
        true,
      )
    return
  }
  const p = s.synth[index].patch
  const fields: Record<string, string> = {
    'waveform-list': 'wave',
    'arp-rate': 'arpRate',
    'arp-pattern': 'arpMode',
    'voice-mode': 'mode',
    glide: 'glide',
    vibrato: 'vibrato',
    'kb-hold': 'hold',
    'arp-run': 'arp',
    'lfo-waveform': 'lfoWave',
    'lfo-mod-amount': 'lfoAmt',
    'lfo-rate': 'lfoRate',
    'lfo-destination': 'lfoDest',
    'oscillator-control': 'ctrl',
    'oscillator-env-amount': 'oscAmt',
    'filter-type': 'filterType',
    'filter-envelope-amount': 'filterAmt',
    'filter-frequency': 'cutoff',
    'filter-resonance': 'resonance',
    'filter-on': 'filter',
    'amp-unison': 'unison',
  }
  if (name === 'category') {
    const cat = waveGroups.filter((start) => start <= p.wave).length - 1
    return {
      value: cat * 25,
      label: categories[cat],
      write: (n, v) => {
        n.synth[index].patch.wave = waveGroups[Math.round(v / 25)]
      },
    }
  }
  if (name === 'sound-init')
    return {
      value: 0,
      label: 'Initialize focused synth',
      write: (n) => {
        n.synth[index].patch = synthPatch()
      },
    }
  if (name === 'arp-range')
    return {
      value: ((p.range - 1) * 100) / 3,
      label: String(p.range),
      write: (n, v) => {
        n.synth[index].patch.range = 1 + Math.round(v * 0.03)
      },
    }
  const key = fields[name]
  if (key)
    return param(
      s,
      path + key,
      key === 'wave' ? waves : options[key as keyof typeof options],
      undefined,
      key !== 'wave',
    )
}
