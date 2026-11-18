import { organPatch, synthPatch } from './patches'
export const families = [
  'Grand',
  'Upright',
  'Electric',
  'Clav',
  'Digital',
  'Misc',
]
export const models = [
  'Yamaha C5',
  'Kawai Upright',
  'Rhodes Mark I',
  'Plucked Clav',
  'Glass Piano',
  'Rosewood Mallet',
]
export const types = {
  mod1: ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'],
  mod2: ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'],
  delay: ['Delay'],
  amp: [
    'EQ only',
    'Twin',
    'JC',
    'Small',
    'LP24 Filter',
    'HP24 Filter',
    'To Rotary',
  ],
  compressor: ['Compressor'],
  reverb: ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'],
}
export type Unit = keyof typeof types
export const order = Object.keys(types) as Unit[]
export type LayerId = 0 | 1
export const layers: LayerId[] = [0, 1]
export const globalUnits: Unit[] = ['delay', 'compressor', 'reverb']
function unit(id: Unit) {
  return {
    on: false,
    type: 0,
    rate: 40,
    amount: 55,
    mix: id === 'delay' ? 26 : id === 'reverb' ? 45 : 100,
    feedback: 44,
    filter: 0,
    bass: 50,
    mid: 50,
    freq: 48,
    treble: 50,
    fast: false,
    tone: 0,
    sync: false,
    bpm: 120,
    pingPong: false,
  }
}
export type Effect = ReturnType<typeof unit>
function layer(i: LayerId) {
  const fx = Object.fromEntries(order.map((k) => [k, unit(k)])) as Record<
    Unit,
    Effect
  >
  return {
    enabled: i === 0,
    zone: [0, 3],
    level: i === 0 ? 76 : 54,
    octave: 0,
    type: 0,
    touch: 1,
    dyn: 0,
    timbre: 0,
    unison: 0,
    soft: false,
    res: false,
    pedal: true,
    stick: true,
    fx,
  }
}
export type Layer = ReturnType<typeof layer>
export function selectType(l: Layer, type: number) {
  l.type = type
  l.timbre = 0
  if (type === 3) l.soft = false
  if (type > 1) l.res = false
}
export function defaults() {
  return {
    section: true,
    organOn: false,
    synthOn: false,
    organFocus: 0,
    synthFocus: 0,
    synthFxFocus: 0,
    organ: layers.map((i) => ({ ...layer(i), patch: organPatch() })),
    synth: [0, 1, 2].map((i) => ({
      ...layer(i === 0 ? 0 : 1),
      patch: synthPatch(),
    })),
    split: false,
    points: [
      { on: false, note: 48, width: 0 },
      { on: true, note: 60, width: 0 },
      { on: false, note: 72, width: 0 },
    ],
    solo: -1,
    scene: 0,
    otherScene: [false, true, false, true, false, true, false],
    bpm: 120,
    transpose: 0,
    kbSync: false,
    wheel: 0,
    pedalValue: 0,
    morphs: [] as {
      source: 'wheel' | 'pedalValue'
      path: string
      start: number
      end: number
    }[],
    rotorMix: 0,
    master: 81,
    bend: 50,
    focus: 0 as LayerId,
    fxFocus: 0 as LayerId,
    target: 'Piano',
    group: false,
    synthGroup: false,
    globals: [] as Unit[],
    effects: true,
    shift: false,
    rotary: true,
    speed: false,
    drive: 25,
    stopped: false,
    layers: layers.map(layer),
  }
}
export type Settings = ReturnType<typeof defaults>
export function focus(s: Settings, i: LayerId) {
  s.focus = i
  s.fxFocus = i
  s.target = 'Piano'
}
export function editEffect(s: Settings, id: Unit, patch: Partial<Effect>) {
  const targets = s.globals.includes(id)
    ? chainLayers(s)
    : grouped(s)
      ? sectionChains(s)
      : [fxLayer(s)]
  for (const l of targets) Object.assign(l.fx[id], patch)
}
export const allLayers = (s: Settings) => [...s.layers, ...s.organ, ...s.synth]
export const chainLayers = (s: Settings) => [
  ...s.layers,
  s.organ[0],
  ...s.synth,
]
export const sectionChains = (s: Settings) =>
  s.target === 'Organ'
    ? [s.organ[0]]
    : s.target === 'Synth'
      ? s.synth
      : s.layers
export const fxLayer = (s: Settings) =>
  sectionChains(s)[
    s.target === 'Piano' ? s.fxFocus : s.target === 'Synth' ? s.synthFxFocus : 0
  ]
export const grouped = (s: Settings) =>
  s.target === 'Synth' ? s.synthGroup : s.target === 'Piano' && s.group
export function groupMode(s: Settings) {
  const key = s.target === 'Synth' ? 'synthGroup' : 'group'
  s[key] = !s[key]
  if (s[key])
    for (const l of sectionChains(s)) l.fx = structuredClone(fxLayer(s).fx)
}
export function globalMode(s: Settings, id: Unit) {
  if (!globalUnits.includes(id)) return
  if (s.globals.includes(id)) s.globals = s.globals.filter((k) => k !== id)
  else {
    s.globals.push(id)
    editEffect(s, id, fxLayer(s).fx[id])
  }
}
export const delayTime = (rate: number, sync: boolean, bpm = 120) =>
  sync
    ? ([1, 0.75, 0.5, 0.375, 0.25, 0.125, 0.0625][Math.round(rate * 0.06)] *
        120) /
      bpm
    : 1.5 * (1 / 30) ** (rate / 100)
