import { photoToSectionX, sectionById, sectionScale, type SectionDef, type SectionId } from './geometry'
import type {
  BoxDef,
  ButtonStyle,
  ControlDef,
  DecorLine,
  GraphDef,
  KnobControl,
  LedColor,
  LedDef,
  LedShape,
  LegendDef,
  OledDef,
  PlateDef,
  Tone,
} from './panelTypes'

export interface PanelData {
  controls: ControlDef[]
  leds: LedDef[]
  legends: LegendDef[]
  boxes: BoxDef[]
  plates: PlateDef[]
  graphs: GraphDef[]
  oleds: OledDef[]
  lines: DecorLine[]
}

export function emptyPanel(): PanelData {
  return { controls: [], leds: [], legends: [], boxes: [], plates: [], graphs: [], oleds: [], lines: [] }
}

interface TextOpts {
  size?: number
  align?: LegendDef['align']
  weight?: LegendDef['weight']
  tone?: Tone
  boxed?: LegendDef['boxed']
  rotate?: number
  spacing?: number
  font?: 'brand'
}

interface ButtonOpts {
  w?: number
  h?: number
  style?: ButtonStyle
  outline?: boolean
  /** LED id toggled on/off by this button. */
  toggle?: string
  /** Explicit presentation states (LED ids lit per state); first state is the initial one. */
  states?: string[][]
  names?: string[]
}

/**
 * Builds one section from photo-measured coordinates. x values are design px measured on the
 * reference photo and are mapped into the spec section box; y values are used as-is.
 */
export class SectionBuilder {
  readonly sec: SectionDef
  readonly k: number
  readonly sz: number
  tone: Tone = 'light'

  constructor(
    private readonly out: PanelData,
    id: SectionId,
  ) {
    this.sec = sectionById(id)
    this.k = sectionScale(this.sec)
    this.sz = Math.min(1, this.k)
  }

  X(photoX: number): number {
    return round(photoToSectionX(this.sec, photoX))
  }

  private cid(key: string): string {
    return `${this.sec.id}-${key}`
  }

  led(key: string, x: number, y: number, color: LedColor = 'red', shape: LedShape = 'dot'): string {
    const id = `${this.sec.id}-led-${key}`
    this.out.leds.push({ id, section: this.sec.id, x: this.X(x), y, color, shape })
    return id
  }

  text(text: string, x: number, y: number, o: TextOpts = {}): void {
    this.out.legends.push({
      section: this.sec.id,
      text,
      x: this.X(x),
      y,
      size: o.size ?? 4.1,
      align: o.align ?? 'center',
      weight: o.weight ?? 700,
      tone: o.tone ?? this.tone,
      boxed: o.boxed,
      rotate: o.rotate,
      spacing: o.spacing,
      font: o.font,
    })
  }

  box(x1: number, y1: number, x2: number, y2: number, o: Partial<Omit<BoxDef, 'section' | 'x1' | 'x2' | 'y1' | 'y2'>> = {}): void {
    this.out.boxes.push({
      section: this.sec.id,
      x1: this.X(x1),
      y1,
      x2: this.X(x2),
      y2,
      title: o.title,
      titleStyle: o.titleStyle ?? 'notch',
      fill: o.fill ?? 'none',
      outline: o.outline ?? 'light',
    })
  }

  plate(x1: number, y1: number, x2: number, y2: number, headerTop: number, headerBottom: number, tab?: { x1: number; x2: number; y1: number }, redColumn?: { x1: number; x2: number }): void {
    this.out.plates.push({
      section: this.sec.id,
      x1: this.X(x1),
      y1,
      x2: this.X(x2),
      y2,
      headerTop,
      headerBottom,
      tab: tab ? { x1: this.X(tab.x1), x2: this.X(tab.x2), y1: tab.y1 } : undefined,
      redColumn: redColumn ? { x1: this.X(redColumn.x1), x2: this.X(redColumn.x2) } : undefined,
    })
  }

  line(points: [number, number][]): void {
    this.out.lines.push({ section: this.sec.id, points: points.map(([x, y]) => [this.X(x), y]) })
  }

  oled(key: string, label: string, x1: number, y1: number, x2: number, y2: number): void {
    this.out.oleds.push({ id: this.cid(key), section: this.sec.id, label, x1: this.X(x1), y1, x2: this.X(x2), y2 })
  }

  button(key: string, label: string, x: number, y: number, o: ButtonOpts = {}): string {
    const id = this.cid(key)
    let states: string[][] = [[]]
    let names = ['released']
    if (o.states) {
      states = o.states
      names = o.names ?? o.states.map((s, i) => (s.length === 0 ? 'unlit' : `state ${i}`))
    } else if (o.toggle) {
      states = [[], [o.toggle]]
      names = ['LED off', 'LED lit']
    }
    this.out.controls.push({
      kind: 'button',
      id,
      section: this.sec.id,
      label,
      x: this.X(x),
      y,
      w: round((o.w ?? 23) * this.sz),
      h: o.h ?? 12,
      style: o.style ?? 'dark',
      outline: o.outline ?? false,
      states,
      stateNames: names,
    })
    return id
  }

  rocker(key: string, label: string, x: number, y: number, o: ButtonOpts = {}): string {
    return this.button(key, label, x, y, { w: 11.5, h: 24, style: 'rocker-dark', ...o })
  }

  knob(key: string, label: string, x: number, y: number, d: number, o: Partial<Pick<KnobControl, 'min' | 'max' | 'initial' | 'scale' | 'halo' | 'tone'>> = {}): string {
    const id = this.cid(key)
    const min = o.min ?? 0
    const max = o.max ?? 127
    this.out.controls.push({
      kind: 'knob',
      id,
      section: this.sec.id,
      label,
      x: this.X(x),
      y,
      w: round(d * this.sz),
      h: round(d * this.sz),
      min,
      max,
      initial: o.initial ?? Math.round((min + max) / 2),
      scale: o.scale ?? 'unit',
      halo: o.halo ?? false,
      tone: this.tone,
    })
    return id
  }

  encoder(key: string, label: string, x: number, y: number, d: number): string {
    const id = this.cid(key)
    this.out.controls.push({ kind: 'encoder', id, section: this.sec.id, label, x: this.X(x), y, w: round(d * this.sz), h: round(d * this.sz) })
    return id
  }

  fader(key: string, label: string, x: number, top: number, bottom: number, initial: number, ladderX: number): string {
    const id = this.cid(key)
    this.out.controls.push({
      kind: 'fader',
      id,
      section: this.sec.id,
      label,
      x: this.X(x),
      y: (top + bottom) / 2,
      w: round(16 * this.sz),
      h: bottom - top,
      trackTop: top,
      trackBottom: bottom,
      initial,
      min: 0,
      max: 127,
    })
    this.out.graphs.push({ id: `${id}-ladder`, section: this.sec.id, kind: 'ladder', owner: id, x: this.X(ladderX), y1: top + 2, y2: bottom - 6, cells: 12, w: 5 })
    return id
  }

  drawbar(key: string, label: string, footage: string, x: number, cap: 'black' | 'white', initial: number): string {
    const id = this.cid(key)
    this.out.controls.push({
      kind: 'drawbar',
      id,
      section: this.sec.id,
      label,
      footage,
      x: this.X(x),
      y: 207,
      w: 19,
      h: 78,
      cap,
      slotTop: 168,
      initial,
      min: 0,
      max: 8,
    })
    this.out.graphs.push({ id: `${id}-graph`, section: this.sec.id, kind: 'drawbar', owner: id, x: this.X(x) + 12, y1: 145, y2: 207, cells: 8, w: 5 })
    return id
  }

  stick(key: string, label: string, x: number, y: number, w: number, h: number, rotate: number): string {
    const id = this.cid(key)
    this.out.controls.push({ kind: 'pitch-stick', id, section: this.sec.id, label, x: this.X(x), y, w, h, rotate, min: -100, max: 100 })
    return id
  }

  wheel(key: string, label: string, x: number, y: number, w: number, h: number, rotate: number): string {
    const id = this.cid(key)
    this.out.controls.push({ kind: 'mod-wheel', id, section: this.sec.id, label, x: this.X(x), y, w, h, rotate, min: 0, max: 127, initial: 0 })
    return id
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

/** Attach each LED to the control whose states reference it. */
export function resolveLedOwners(panel: PanelData): void {
  const owners = new Map<string, string>()
  for (const control of panel.controls) {
    if (control.kind !== 'button') continue
    for (const state of control.states) {
      for (const led of state) {
        const prev = owners.get(led)
        if (prev && prev !== control.id) throw new Error(`LED ${led} owned by ${prev} and ${control.id}`)
        owners.set(led, control.id)
      }
    }
  }
  const known = new Set(panel.leds.map((l) => l.id))
  for (const led of owners.keys()) if (!known.has(led)) throw new Error(`Unknown LED ${led}`)
  for (const led of panel.leds) led.owner = owners.get(led.id)
}
