import { allLayers, defaults, type Settings } from './settings'

export const positions = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96]
export const address = (index: number) =>
  Math.floor(index / 8) + 1 + '.' + ((index % 8) + 1)
export function zoneGain(s: Settings, range: number[], note: number) {
  if (!s.split) return 1
  const points = s.points.filter((p) => p.on).sort((a, b) => a.note - b.note)
  function above(index: number) {
    if (index < 0) return 1
    const p = points[index]
    if (!p) return 0
    return p.width
      ? Math.max(0, Math.min(1, 0.5 + (note - p.note) / (2 * p.width)))
      : Number(note >= p.note)
  }
  return Math.max(0, above(range[0] - 1) - above(range[1]))
}
export function switchScene(s: Settings) {
  const mask = allLayers(s).map((l) => l.enabled)
  allLayers(s).forEach((l, i) => {
    l.enabled = s.otherScene[i]
  })
  s.otherScene = mask
  s.scene = 1 - s.scene
}
function location(s: Settings, path: string) {
  const parts = path.split('.'),
    key = parts.pop()!
  let object = s as unknown as Record<string, unknown>
  for (const k of parts) object = object[k] as Record<string, unknown>
  return { object, key }
}
export function effective(s: Settings) {
  if (!s.morphs.length && s.solo < 0) return s
  const n = structuredClone(s)
  if (s.solo >= 0)
    allLayers(n).forEach((l, i) => {
      l.enabled = i === s.solo
    })
  for (const m of s.morphs) {
    const { object, key } = location(n, m.path)
    object[key] = Number(object[key]) + ((m.end - m.start) * s[m.source]) / 100
    object[key] = Math.max(
      0,
      Math.min(m.path.includes('.bars.') ? 8 : 100, Number(object[key])),
    )
    if (m.path.includes('.bars.')) object[key] = Math.round(Number(object[key]))
  }
  return n
}
export function assign(
  s: Settings,
  source: 'wheel' | 'pedalValue',
  path: string,
  end: number,
) {
  const { object, key } = location(s, path),
    start = Number(object[key])
  s.morphs = s.morphs.filter((m) => m.source !== source || m.path !== path)
  if (start !== end) s.morphs.push({ source, path, start, end })
}
function snapshot(s: Settings) {
  const { master, bend, wheel, pedalValue, shift, ...program } = s
  void [master, bend, wheel, pedalValue, shift]
  return structuredClone(program)
}
type Slot = { name: string; data: ReturnType<typeof snapshot> }
type Memory = Pick<Storage, 'getItem' | 'setItem'>
function factory(i: number): Slot {
  const s = defaults()
  const names = [
    'Concert Grand',
    'Sunday Drawbars',
    'Copper Lead',
    'Tine Stack',
    'Chapel Pipes',
    'Bass Split',
    'Velvet Strings',
    'Midnight Vox',
  ]
  if (i === 1 || i === 4 || i === 7) {
    s.organOn = true
    s.section = false
    s.target = 'Organ'
    s.organ[0].patch.model = i === 4 ? 3 : i === 7 ? 1 : 0
  }
  if ([2, 3, 5, 6].includes(i)) {
    s.synthOn = true
    s.section = i === 3 || i === 5
    s.target = 'Synth'
    s.synth[0].patch.wave = i === 2 ? 7 : i === 3 ? 13 : 11
  }
  if (i === 3) s.layers[0].type = 2
  if (i === 5) {
    s.split = true
    s.synth[0].zone = [0, 0]
    s.layers[0].zone = [1, 3]
    s.synth[0].octave = -1
  }
  if (i === 6) {
    s.synth[0].patch.ampEnv.attack = 38
    s.synth[0].patch.ampEnv.release = 54
  }
  return { name: names[i] ?? 'Init Program', data: snapshot(s) }
}
export class Programs {
  regular = Array.from({ length: 32 }, (_, i) => factory(i))
  lives = Array.from({ length: 8 }, (_, i) => factory(i))
  live = false
  index = 0
  settings = defaults()
  pending?: Slot
  origin?: { index: number; live: boolean; s: Settings }
  error = ''
  constructor(private storage?: Memory) {
    try {
      const raw = storage?.getItem('stage4.bank.3')
      if (raw) {
        const saved = JSON.parse(raw)
        // Older banks store complete arrays. New writes update a single slot
        // so moving a fader in Live mode does not serialize the whole bank.
        if (saved.regular?.length === 32 && saved.lives?.length === 8) {
          this.regular = saved.regular
          this.lives = saved.lives
        }
        for (const live of [false, true]) {
          const slots = live ? this.lives : this.regular
          slots.forEach((_, i) => {
            const rawSlot = storage?.getItem(this.slotKey(live, i))
            if (rawSlot) {
              const slot = JSON.parse(rawSlot)
              if (
                typeof slot.name === 'string' &&
                slot.data?.synth?.length === 3
              )
                slots[i] = slot
            }
          })
        }
        const cursor =
          JSON.parse(storage?.getItem('stage4.cursor.3') ?? 'null') ?? saved
        this.select(cursor.index, !!cursor.live)
      }
    } catch {
      this.error = 'Program memory unavailable'
    }
  }
  get slots() {
    return this.live ? this.lives : this.regular
  }
  get slot() {
    return this.slots[this.index]
  }
  get dirty() {
    return (
      JSON.stringify(snapshot(this.settings)) !== JSON.stringify(this.slot.data)
    )
  }
  private slotKey(live = this.live, index = this.index) {
    return 'stage4.' + (live ? 'live' : 'program') + '.3.' + index
  }
  private persist(writeSlot = false) {
    try {
      const memory = this.storage
      if (!memory) return
      if (!memory.getItem('stage4.bank.3'))
        memory.setItem('stage4.bank.3', '{"version":3}')
      if (writeSlot) memory.setItem(this.slotKey(), JSON.stringify(this.slot))
      memory.setItem(
        'stage4.cursor.3',
        JSON.stringify({ index: this.index, live: this.live }),
      )
    } catch {
      this.error = 'Program memory could not be saved'
    }
  }
  edit(s: Settings) {
    this.settings = s
    if (this.live && !this.pending) {
      const data = snapshot(s)
      if (JSON.stringify(data) !== JSON.stringify(this.slot.data)) {
        this.slot.data = data
        this.persist(true)
      }
    }
  }
  select(index: number, live = this.live) {
    this.live = live
    this.index = Math.max(
      0,
      Math.min(this.slots.length - 1, Math.round(index) || 0),
    )
    this.settings = {
      ...this.settings,
      ...structuredClone(this.slot.data),
      shift: false,
    }
    if (!this.pending) this.persist()
  }
  store(name = this.slot.name) {
    if (!this.pending) {
      this.pending = {
        name: name.trim().slice(0, 30) || this.slot.name,
        data: snapshot(this.settings),
      }
      this.origin = {
        index: this.index,
        live: this.live,
        s: structuredClone(this.settings),
      }
    } else {
      this.slots[this.index] = this.pending
      this.persist(true)
      this.pending = undefined
      this.origin = undefined
      this.select(this.index)
    }
  }
  cancel() {
    if (this.origin) {
      this.index = this.origin.index
      this.live = this.origin.live
      this.settings = this.origin.s
    }
    this.pending = undefined
    this.origin = undefined
  }
}
