import { local, round, type Pt } from '../geometry'
import type {
  ButtonMode,
  ButtonSpec,
  ButtonStyle,
  ControlSpec,
  FrameSpec,
  IndicatorSpec,
  LedColor,
  LedRule,
  LedSpec,
  LegendSpec,
  SectionId,
} from '../types'

export interface PanelData {
  controls: ControlSpec[]
  frames: FrameSpec[]
  legends: LegendSpec[]
  indicators: IndicatorSpec[]
}

export const newPanelData = (): PanelData => ({ controls: [], frames: [], legends: [], indicators: [] })

export interface LedInput {
  p: Pt
  c?: LedColor
  on?: LedRule
  t?: string
  side?: 'l' | 'r'
  shape?: LedSpec['shape']
}

export interface ButtonOptions {
  style?: ButtonStyle
  w?: number
  h?: number
  mode?: ButtonMode
  options?: string[]
  rim?: boolean
  leds?: LedInput[]
}

export interface TextOptions {
  align?: 'l' | 'c' | 'r'
  size?: number
  tone?: LegendSpec['tone']
  weight?: LegendSpec['weight']
  spacing?: number
  rotate?: number
  font?: LegendSpec['font']
}

export interface KnobOptions {
  size?: number
  min?: number
  max?: number
  initial?: number
  ticks?: string[] | 'none'
  ringTone?: 'light' | 'dark'
}

const DEFAULT_TICKS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']

export const step = (n: number): string[] => Array.from({ length: n }, (_, i) => `Step ${i + 1}`)

/** Authoring helper: takes photo points, stores section-local specs. */
export class Builder {
  constructor(
    private readonly section: SectionId,
    private readonly data: PanelData,
    private readonly prefix = '',
  ) {}

  private pt(p: Pt) {
    return local(this.section, p)
  }

  private id(id: string): string {
    return `${this.prefix}${id}`
  }

  private led(input: LedInput): LedSpec {
    const { x, y } = this.pt(input.p)
    return {
      x,
      y,
      color: input.c ?? 'red',
      rule: input.on ?? 'on',
      shape: input.shape ?? 'dot',
      text: input.t,
      textSide: input.side ?? 'r',
    }
  }

  frame(a: Pt, b: Pt, tone: FrameSpec['tone'], opts: { title?: string; titleTone?: 'light' | 'dark'; titleSize?: number; radius?: number } = {}) {
    const pa = this.pt(a)
    const pb = this.pt(b)
    this.data.frames.push({
      section: this.section,
      x: Math.min(pa.x, pb.x),
      y: Math.min(pa.y, pb.y),
      w: round(Math.abs(pb.x - pa.x)),
      h: round(Math.abs(pb.y - pa.y)),
      tone,
      ...opts,
    })
  }

  text(text: string, p: Pt, o: TextOptions = {}) {
    const { x, y } = this.pt(p)
    this.data.legends.push({
      section: this.section,
      text,
      x,
      y,
      align: o.align ?? 'c',
      size: o.size ?? 2.5,
      tone: o.tone ?? 'white',
      weight: o.weight ?? 'bold',
      spacing: o.spacing,
      rotate: o.rotate,
      font: o.font,
    })
  }

  /** unlit, non-interactive indicator LED (its function is not part of Phase 1) */
  indicator(p: Pt, color: LedColor = 'red', text?: string, side: 'l' | 'r' = 'r', id?: string) {
    const { x, y } = this.pt(p)
    this.data.indicators.push({ section: this.section, x, y, color, ...(id ? { id } : {}) })
    if (text) this.text(text, [p[0] + (side === 'r' ? 24 : -24), p[1]], { align: side === 'r' ? 'l' : 'r' })
  }

  knob(id: string, label: string, p: Pt, o: KnobOptions = {}) {
    const { x, y } = this.pt(p)
    this.data.controls.push({
      kind: 'knob',
      id: this.id(id),
      section: this.section,
      label,
      x,
      y,
      size: o.size ?? 14,
      min: o.min ?? 0,
      max: o.max ?? 10,
      initial: o.initial ?? 0,
      ticks: o.ticks ?? DEFAULT_TICKS,
      ringTone: o.ringTone,
    })
  }

  encoder(id: string, label: string, p: Pt, size = 12, detents = 32) {
    const { x, y } = this.pt(p)
    this.data.controls.push({ kind: 'encoder', id: this.id(id), section: this.section, label, x, y, size, detents })
  }

  fader(id: string, label: string, p: Pt, travel: number, initial: number, ladderDx: number) {
    const { x, y } = this.pt(p)
    this.data.controls.push({
      kind: 'fader',
      id: this.id(id),
      section: this.section,
      label,
      x,
      y,
      travel,
      capW: 10,
      capH: 7,
      initial,
      ladderDx,
      ladderLeds: 12,
    })
  }

  drawbar(id: string, label: string, p: Pt, travel: number, capTone: 'black' | 'white', initial: number) {
    const { x, y } = this.pt(p)
    this.data.controls.push({
      kind: 'drawbar',
      id: this.id(id),
      section: this.section,
      label,
      x,
      y,
      travel,
      capW: 12,
      capH: 17,
      capTone,
      initial,
      ladderLeds: 8,
    })
  }

  wheel(id: string, label: string, p: Pt, o: { variant: 'mod' | 'pitch'; length: number; width: number; angle: number; initial: number; spring: boolean }) {
    const { x, y } = this.pt(p)
    this.data.controls.push({ kind: 'wheel', id: this.id(id), section: this.section, label, x, y, ...o })
  }

  button(id: string, label: string, p: Pt, o: ButtonOptions = {}) {
    const { x, y } = this.pt(p)
    const style = o.style ?? 'dark'
    const vertical = style === 'rocker' || style === 'grayrocker'
    const spec: ButtonSpec = {
      kind: 'button',
      id: this.id(id),
      section: this.section,
      label,
      x,
      y,
      style,
      w: o.w ?? (vertical ? 6.5 : 14.5),
      h: o.h ?? (vertical ? 16 : 7.4),
      mode: o.mode ?? ((o.leds?.length ?? 0) > 0 ? 'latch' : 'momentary'),
      options: o.options ?? [],
      rim: o.rim ?? false,
      leds: (o.leds ?? []).map((l) => this.led(l)),
    }
    this.data.controls.push(spec)
  }

  /** an LED with its printed legend that also acts as a small toggle */
  tag(id: string, label: string, p: Pt, text: string, o: { c?: LedColor; mode?: ButtonMode; side?: 'l' | 'r'; box?: boolean } = {}) {
    const { x, y } = this.pt(p)
    const spec: ButtonSpec = {
      kind: 'button',
      id: this.id(id),
      section: this.section,
      label,
      x,
      y,
      style: 'tag',
      w: 4 + text.length * 1.55,
      h: 4,
      mode: o.mode ?? 'latch',
      options: [],
      rim: o.box ?? false,
      leds: [{ x: 0, y: 0, color: o.c ?? 'red', rule: 'on', shape: 'dot', text, textSide: o.side ?? 'r' }],
      text,
    }
    this.data.controls.push(spec)
  }
}
