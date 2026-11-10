import { sectionGeometry, toSectionX, toSectionY } from './geometry'
import type {
  ButtonDef,
  ButtonLook,
  KnobScale,
  LabelBox,
  LabelDef,
  LabelFont,
  LabelTone,
  LedBinding,
  LedColor,
  LedDef,
  LedShape,
  OledDef,
  PlateDef,
  PlateStyle,
  RangeDef,
  SectionId,
  SectionInventory,
} from './types'

/** Absolute pixel position on the reference photo. */
export type Pt = readonly [number, number]

/**
 * The deck was read off the photo in eight 1300×1400 crops ("tiles") starting at y=560.
 * `tile(n)` turns a coordinate read inside crop n back into an absolute photo position,
 * which keeps every number in the section files traceable to what was measured.
 */
const TILE_X = [1250, 2450, 3650, 4850, 6050, 7250, 8450, 9250] as const
const TILE_Y = 560
export function tile(n: number): (x: number, y: number) => Pt {
  return (x, y) => [TILE_X[n] + x, TILE_Y + y]
}

export const SIZE = {
  buttonW: 136,
  buttonH: 68,
  knob: 118,
  dial: 108,
  led: 22,
  faderW: 96,
  faderCapH: 70,
  drawbarW: 110,
  drawbarCapH: 235,
} as const

/** Drawbar travel on the photo: cap centre y (tile px) at value 0 and px per step. */
export const DRAWBAR = { y0: 905, perStep: 27, steps: 8 } as const

export interface ButtonOptions {
  look?: ButtonLook
  vertical?: boolean
  surround?: boolean
  steps?: number
  stepLabels?: readonly string[]
  initial?: number
}

export interface KnobOptions {
  scale?: KnobScale
  initial?: number
  min?: number
  max?: number
  step?: number
  size?: number
  unit?: string
  onLight?: boolean
}

export interface LabelOptions {
  size?: number
  font?: LabelFont
  tone?: LabelTone
  box?: LabelBox
  align?: 'center' | 'left' | 'right'
  vertical?: boolean
}

export interface SelectorLed {
  slug: string
  at: Pt
  on: readonly number[]
  shape?: LedShape
  color?: LedColor
}

export function createSection(id: SectionId) {
  const geometry = sectionGeometry(id)
  const inventory: SectionInventory = { id, controls: [], leds: [], labels: [], plates: [], oleds: [], landmarks: {} }

  const place = (point: Pt) => ({
    section: id,
    x: toSectionX(id, point[0]),
    y: toSectionY(point[1]),
    photo: { x: point[0], y: point[1] },
  })

  const api = {
    inventory,

    button(controlId: string, name: string, at: Pt, options: ButtonOptions = {}): ButtonDef {
      const vertical = options.vertical ?? false
      const steps = options.steps ?? 0
      const def: ButtonDef = {
        ...place(at),
        id: controlId,
        kind: 'button',
        name,
        w: vertical ? SIZE.buttonH : SIZE.buttonW,
        h: vertical ? SIZE.buttonW : SIZE.buttonH,
        look: options.look ?? 'dark',
        orientation: vertical ? 'vertical' : 'horizontal',
        surround: options.surround ?? false,
        steps,
        stepLabels: options.stepLabels,
        initial: options.initial ?? 0,
      }
      if (def.stepLabels && def.stepLabels.length !== steps) {
        throw new Error(`${controlId}: ${def.stepLabels.length} step labels for ${steps} steps`)
      }
      inventory.controls.push(def)
      return def
    },

    led(slug: string, at: Pt, color: LedColor, binding: LedBinding | boolean, shape: LedShape = 'round'): LedDef {
      const def: LedDef = {
        ...place(at),
        id: `led-${slug}`,
        color,
        shape,
        binding: typeof binding === 'boolean' ? { type: 'static', lit: binding } : binding,
      }
      inventory.leds.push(def)
      return def
    },

    /** Off/on button with its own LED. */
    toggle(
      controlId: string,
      name: string,
      at: Pt,
      ledAt: Pt,
      options: ButtonOptions & { color?: LedColor } = {},
    ): ButtonDef {
      const def = api.button(controlId, name, at, { ...options, steps: 2, stepLabels: ['Off', 'On'] })
      api.led(controlId, ledAt, options.color ?? 'red', { type: 'step', control: controlId, on: [1] })
      return def
    },

    /** Button that steps an indicator through printed positions. */
    selector(
      controlId: string,
      name: string,
      at: Pt,
      stepLabels: readonly string[],
      leds: readonly SelectorLed[],
      options: ButtonOptions = {},
    ): ButtonDef {
      const def = api.button(controlId, name, at, { ...options, steps: stepLabels.length, stepLabels })
      for (const led of leds) {
        api.led(
          `${controlId}-${led.slug}`,
          led.at,
          led.color ?? 'red',
          { type: 'step', control: controlId, on: led.on },
          led.shape ?? 'round',
        )
      }
      return def
    },

    knob(controlId: string, name: string, at: Pt, options: KnobOptions = {}): RangeDef {
      const size = options.size ?? SIZE.knob
      const min = options.min ?? 0
      const max = options.max ?? 10
      const def: RangeDef = {
        ...place(at),
        id: controlId,
        kind: 'knob',
        name,
        w: size,
        h: size,
        min,
        max,
        step: options.step ?? (max - min) / 100,
        keyStep: (max - min) / 20,
        bigStep: (max - min) / 5,
        initial: options.initial ?? (min + max) / 2,
        scale: options.scale ?? 'zero-to-ten',
        wrap: false,
        unit: options.unit,
        onLight: options.onLight,
      }
      inventory.controls.push(def)
      return def
    },

    /** Endless detented dial. */
    encoder(controlId: string, name: string, at: Pt, options: { size?: number; ring?: boolean } = {}): RangeDef {
      const size = options.size ?? SIZE.dial
      const def: RangeDef = {
        ...place(at),
        id: controlId,
        kind: 'encoder',
        name,
        w: size,
        h: size,
        min: 0,
        max: 23,
        step: 1,
        keyStep: 1,
        bigStep: 6,
        initial: 0,
        scale: 'none',
        wrap: true,
        ring: options.ring ?? false,
        unit: 'detent',
      }
      inventory.controls.push(def)
      return def
    },

    /** Layer level fader. `top`/`bottom` are the ends of the slot on the photo. */
    fader(controlId: string, name: string, top: Pt, bottom: Pt, initial: number): RangeDef {
      const def: RangeDef = {
        ...place([top[0], (top[1] + bottom[1]) / 2]),
        id: controlId,
        kind: 'fader',
        name,
        w: SIZE.faderW,
        h: bottom[1] - top[1],
        min: 0,
        max: 100,
        step: 1,
        keyStep: 5,
        bigStep: 20,
        initial,
        scale: 'none',
        wrap: false,
        unit: 'percent',
      }
      inventory.controls.push(def)
      return def
    },

    /** Organ drawbar. `capX` is the cap centre; travel is shared by all nine (see DRAWBAR). */
    drawbar(
      controlId: string,
      name: string,
      capX: Pt,
      initial: number,
      cap: 'brown' | 'white' | 'black',
    ): RangeDef {
      const yTop = DRAWBAR.y0 - SIZE.drawbarCapH / 2
      const yBottom = DRAWBAR.y0 + DRAWBAR.perStep * DRAWBAR.steps + SIZE.drawbarCapH / 2
      const def: RangeDef = {
        ...place([capX[0], capX[1] + (yTop + yBottom) / 2]),
        id: controlId,
        kind: 'drawbar',
        name,
        w: SIZE.drawbarW,
        h: yBottom - yTop,
        min: 0,
        max: DRAWBAR.steps,
        step: 1,
        keyStep: 1,
        bigStep: 2,
        initial,
        scale: 'none',
        wrap: false,
        cap,
      }
      inventory.controls.push(def)
      return def
    },

    wheel(controlId: string, name: string, at: Pt, w: number, h: number, tilt: number): RangeDef {
      const def: RangeDef = {
        ...place(at),
        id: controlId,
        kind: 'wheel',
        name,
        w,
        h,
        min: 0,
        max: 127,
        step: 1,
        keyStep: 8,
        bigStep: 32,
        initial: 0,
        scale: 'none',
        wrap: false,
        tilt,
      }
      inventory.controls.push(def)
      return def
    },

    stick(controlId: string, name: string, at: Pt, w: number, h: number, tilt: number): RangeDef {
      const def: RangeDef = {
        ...place(at),
        id: controlId,
        kind: 'stick',
        name,
        w,
        h,
        min: -100,
        max: 100,
        step: 5,
        keyStep: 10,
        bigStep: 50,
        initial: 0,
        scale: 'none',
        wrap: false,
        springTo: 0,
        tilt,
      }
      inventory.controls.push(def)
      return def
    },

    label(text: string, at: Pt, options: LabelOptions = {}): LabelDef {
      const def: LabelDef = {
        ...place(at),
        text,
        size: options.size ?? 29,
        font: options.font ?? 'legend',
        tone: options.tone ?? 'light',
        box: options.box ?? 'none',
        align: options.align ?? 'center',
        vertical: options.vertical ?? false,
      }
      inventory.labels.push(def)
      return def
    },

    plate(style: PlateStyle, from: Pt, to: Pt, radius = 16): PlateDef {
      const margin = 4
      const x0 = Math.max(margin, toSectionX(id, from[0]))
      const x1 = Math.min(geometry.width - margin, toSectionX(id, to[0]))
      const def: PlateDef = {
        section: id,
        style,
        x: x0,
        y: toSectionY(from[1]),
        w: x1 - x0,
        h: to[1] - from[1],
        radius,
      }
      inventory.plates.push(def)
      return def
    },

    oled(oledId: string, name: string, from: Pt, to: Pt): OledDef {
      const def: OledDef = {
        ...place([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]),
        id: oledId,
        name,
        w: (to[0] - from[0]) * geometry.scale,
        h: to[1] - from[1],
      }
      inventory.oleds.push(def)
      return def
    },

    landmark(name: string, ids: string[]): void {
      inventory.landmarks[name] = ids
    },
  }
  return api
}

export type SectionBuilder = ReturnType<typeof createSection>
