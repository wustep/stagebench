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
    master: 81,
    bend: 50,
    focus: 0 as LayerId,
    fxFocus: 0 as LayerId,
    target: 'Piano',
    group: false,
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
  if (s.target !== 'Piano') return
  const indices = s.group || s.globals.includes(id) ? layers : [s.fxFocus]
  for (const i of indices) Object.assign(s.layers[i].fx[id], patch)
}
export function groupMode(s: Settings) {
  s.group = !s.group
  if (s.group)
    s.layers[1 - s.fxFocus].fx = structuredClone(s.layers[s.fxFocus].fx)
}
export function globalMode(s: Settings, id: Unit) {
  if (!globalUnits.includes(id)) return
  if (s.globals.includes(id)) s.globals = s.globals.filter((k) => k !== id)
  else {
    s.globals.push(id)
    editEffect(s, id, s.layers[s.fxFocus].fx[id])
  }
}
export const delayTime = (rate: number, sync: boolean) =>
  sync
    ? [1, 0.75, 0.5, 0.375, 0.25, 0.125, 0.0625][Math.round(rate * 0.06)]
    : 1.5 * (1 / 30) ** (rate / 100)
