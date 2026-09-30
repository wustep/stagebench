import { A1, A2, A3, B2, SA, SECTIONS, local, round, toU, type Pt } from './geometry'
import { buildEffects } from './panel/effects'
import { buildOrgan } from './panel/organ'
import { buildPerformance } from './panel/performance'
import { buildPiano } from './panel/piano'
import { buildProgram } from './panel/program'
import { buildSynth } from './panel/synth'
import { newPanelData, type PanelData } from './panel/builder'
import type { ControlSpec, FrameSpec, IndicatorSpec, LegendSpec, SectionId } from './types'

export interface OledSpec {
  id: 'program-oled' | 'synth-oled'
  section: SectionId
  x: number
  y: number
  w: number
  h: number
}

export interface JackSpec {
  section: SectionId
  x: number
}

const data: PanelData = newPanelData()
buildPerformance(data)
buildOrgan(data)
buildPiano(data)
buildProgram(data)
buildSynth(data)
buildEffects(data)

// --- printed rail legends and jacks along the rear of the chassis ------------------------------
const sectionOf = (pt: Pt): SectionId => {
  const [u] = toU(pt)
  const s = SECTIONS.find((x) => u < x.photo[1])
  return s ? s.id : 'effects'
}

const railLegends: LegendSpec[] = []
const rail = (text: string, pt: Pt) => {
  const section = sectionOf(pt)
  const { x, y } = local(section, pt)
  railLegends.push({ section, text, x, y, align: 'c', size: 2.1, tone: 'white', weight: 'bold' })
}
rail('MONITOR', A1(843, 183))
rail('IN', A1(848, 197))
rail('HEADPHONES', A1(923, 183))
rail('OUT 1', A1(1012, 183))
rail('—', A1(1060, 185))
rail('OUT 2', A1(1106, 183))
rail('OUT 3', A1(1199, 183))
rail('—', A1(1246, 185))
rail('OUT 4', A1(1291, 183))
rail('CONTROL', A1(1384, 183))
rail('PEDAL', A1(1384, 197))
rail('ORGAN', A1(1476, 183))
rail('SWELL', A1(1476, 197))
rail('SUSTAIN', A1(1568, 183))
rail('PEDAL', A1(1568, 197))
rail('TRIPLE', A1(1676, 183))
rail('PEDAL', A1(1676, 197))
rail('MIDI IN', A2(239, 181))
rail('MIDI OUT', A2(357, 181))
rail('ROTOR PEDAL', A2(468, 181))
rail('USB', A2(560, 181))
rail('FOOT SWITCH', A2(653, 181))
rail('AC IN', A2(1759, 179))
rail('POWER ON/OFF', SA(280, 268))

const jackPoints: Pt[] = [
  ...[215, 385, 1000, 1080, 1150, 1250, 1340, 1430, 1520, 1610].map((dx) => A1(dx, 68)),
  ...[125, 478, 660, 1060].map((dx) => A2(dx, 68)),
  ...[860, 1600, 1805].map((dx) => A3(dx, 62)),
]
export const JACKS: JackSpec[] = jackPoints.map((pt) => {
  const section = sectionOf(pt)
  return { section, x: local(section, pt).x }
})

// --- OLEDs: exactly two primary displays, one in Program and one in Synth -----------------------
const oled = (id: OledSpec['id'], section: SectionId, a: Pt, b: Pt): OledSpec => {
  const pa = local(section, a)
  const pb = local(section, b)
  return { id, section, x: pa.x, y: pa.y, w: round(pb.x - pa.x), h: round(pb.y - pa.y) }
}
export const OLEDS: OledSpec[] = [
  oled('program-oled', 'program', A2(723, 503), B2(1053, 95)),
  oled('synth-oled', 'synth', A2(1687, 290), SA(272, 685)),
]

// --- tone post-processing: legends printed on light plates are dark ------------------------------
const lightFrames = data.frames.filter((f) => f.tone === 'light' || f.tone === 'strip')
const onLight = (section: SectionId, x: number, y: number): boolean =>
  lightFrames.some((f) => f.section === section && x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h)

for (const l of data.legends) {
  if (l.tone === 'white' && onLight(l.section, l.x, l.y)) l.tone = 'dark'
}
export const LIGHT_LED_IDS = new Set<string>()
for (const c of data.controls) {
  if (c.kind !== 'button') continue
  if (c.style === 'tag' ? onLight(c.section, c.x, c.y) : c.leds.some((led) => led.text && onLight(c.section, led.x, led.y))) LIGHT_LED_IDS.add(c.id)
}

export const CONTROLS: ControlSpec[] = data.controls
export const FRAMES: FrameSpec[] = data.frames
export const LEGENDS: LegendSpec[] = [...data.legends, ...railLegends]
export const INDICATORS: IndicatorSpec[] = data.indicators

const ids = new Set<string>()
for (const c of CONTROLS) {
  if (ids.has(c.id)) throw new Error(`duplicate control id ${c.id}`)
  ids.add(c.id)
}

export const controlsInSection = (id: SectionId) => CONTROLS.filter((c) => c.section === id)
export const CONTROL_BY_ID: ReadonlyMap<string, ControlSpec> = new Map(CONTROLS.map((c) => [c.id, c]))
