import { describe, expect, it } from 'vitest'
import { setScene, setSplitKey, setSplitPoint, stepZone, toggleScene, toggleSplit, layerGesture, pressOrganLayer, pressSynthLayer, cycleCrossfade } from './edits'
import { assignMorph, clearMorph, morphDest, morphRange, resolveMorph } from './morph'
import { resolveState } from './resolve'
import { defaultState, type EngineState } from './state'
import {
  CROSSFADES,
  SPLIT_POSITIONS,
  SPLIT_POSITION_NAMES,
  boundaries,
  defaultSplit,
  effectiveRange,
  litPositions,
  nearestPosition,
  splitIsOn,
  stepZoneRange,
  zoneCount,
  zoneGain,
  zoneOf,
} from './zones'

describe('splits.zones — split points, zones and crossfade gains', () => {
  it('the eleven documented positions are C2 F2 C3 F3 C4 F4 C5 F5 C6 F6 C7', () => {
    expect(SPLIT_POSITION_NAMES).toEqual(['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'])
    expect(SPLIT_POSITIONS).toEqual([36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96])
    expect(CROSSFADES).toEqual([0, 6, 12])
  })

  it('SPLIT ON/SET switches a single Mid split at C4 on and off', () => {
    let s = defaultState()
    expect(splitIsOn(s.split)).toBe(false)
    expect(zoneCount(s.split)).toBe(1)
    s = toggleSplit(s)
    expect(splitIsOn(s.split)).toBe(true)
    expect(boundaries(s.split).map((b) => b.note)).toEqual([60])
    expect(zoneCount(s.split)).toBe(2)
    expect(litPositions(s.split).indexOf(true)).toBe(4)
    s = toggleSplit(s)
    expect(splitIsOn(s.split)).toBe(false)
  })

  it('up to three split points make up to four zones; each point moves over the 11 positions and keeps its crossfade', () => {
    let s = defaultState()
    for (const id of ['low', 'mid', 'high'] as const) s = setSplitPoint(s, id, { active: true })
    expect(zoneCount(s.split)).toBe(4)
    expect(boundaries(s.split).map((b) => b.note)).toEqual([48, 60, 72])
    expect([40, 50, 65, 80].map((n) => zoneOf(s.split, n))).toEqual([0, 1, 2, 3])
    s = setSplitPoint(s, 'mid', { position: 20 }) // clamps to the last position
    expect(s.split.mid.position).toBe(10)
    s = cycleCrossfade(s, 'high')
    s = cycleCrossfade(s, 'high')
    expect(s.split.high.crossfade).toBe(12)
    s = cycleCrossfade(s, 'high')
    expect(s.split.high.crossfade).toBe(0)
    expect(litPositions(s.split).filter(Boolean)).toHaveLength(3)
  })

  it('SET KEY snaps the pressed key to the nearest documented position', () => {
    expect(nearestPosition(61)).toBe(4)
    expect(nearestPosition(63)).toBe(5)
    expect(nearestPosition(20)).toBe(0)
    expect(nearestPosition(120)).toBe(10)
    const s = setSplitKey(defaultState(), 'low', 79)
    expect(s.split.low).toMatchObject({ active: true, position: 7 })
  })

  it('zone ranges: contiguous, stepped by the KB ZONE arrows, folded onto the zones that exist', () => {
    expect(stepZoneRange([0, 3], 1)).toEqual([1, 1])
    expect(stepZoneRange([0, 0], -1)).toEqual([3, 3]) // and the list wraps
    let s = defaultState()
    s = stepZone(s, 'piano', 1)
    expect(s.zones['piano.A']).toEqual([1, 1])
    s = stepZone({ ...s, organFocus: 'B' }, 'organ', 1)
    expect(s.zones['organ.B']).toEqual([1, 1])
    s = stepZone({ ...s, synthFocus: 'C' }, 'synth', -1)
    expect(s.zones['synth.C']).toEqual([0, 2]) // ranges step in order: 1, 1-2, 1-3, 1-4, 2, 2-3 …, so one step back from 1-4 is 1-3
    const one = defaultSplit() // no split: three zones assigned to layers fold onto zone 1
    expect(effectiveRange(one, [3, 3])).toEqual([0, 0])
    expect(zoneGain(one, [3, 3], 60)).toBe(1)
  })

  it('crossfade gains: Off switches at the split; ±6 and ±12 fade equal-power across that many semitones each side', () => {
    const split = (xf: 0 | 6 | 12) => setSplitPoint(defaultState(), 'mid', { active: true, position: 4, crossfade: xf }).split
    // a layer in the lower zone (0) and one in the upper zone (1)
    const lower = (xf: 0 | 6 | 12, n: number) => zoneGain(split(xf), [0, 0], n)
    const upper = (xf: 0 | 6 | 12, n: number) => zoneGain(split(xf), [1, 1], n)
    expect([lower(0, 59), lower(0, 60), upper(0, 59), upper(0, 60)]).toEqual([1, 0, 0, 1])
    for (const xf of [6, 12] as const) {
      expect(lower(xf, 60 - xf)).toBeCloseTo(1)
      expect(upper(xf, 60 - xf)).toBeCloseTo(0)
      expect(lower(xf, 60 + xf)).toBeCloseTo(0)
      expect(upper(xf, 60 + xf)).toBeCloseTo(1)
      expect(lower(xf, 60)).toBeCloseTo(Math.SQRT1_2)
      expect(upper(xf, 60)).toBeCloseTo(Math.SQRT1_2)
      for (let n = 60 - xf; n <= 60 + xf; n++) expect(lower(xf, n) ** 2 + upper(xf, n) ** 2).toBeCloseTo(1) // equal power
    }
    // a middle zone fades in at its lower and out at its upper boundary
    let s = setSplitPoint(defaultState(), 'low', { active: true, position: 2, crossfade: 6 })
    s = setSplitPoint(s, 'mid', { active: true, position: 6, crossfade: 6 })
    expect(zoneGain(s.split, [1, 1], 48)).toBeCloseTo(Math.SQRT1_2)
    expect(zoneGain(s.split, [1, 1], 60)).toBe(1)
    expect(zoneGain(s.split, [1, 1], 72)).toBeCloseTo(Math.SQRT1_2)
    expect(zoneGain(s.split, [0, 1], 48)).toBeCloseTo(1) // a two-zone layer has no boundary between its zones
  })
})

describe('scenes.switching — Layer Scenes I/II', () => {
  const withOrgan = (s: EngineState): EngineState => ({ ...s, organOn: true, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, enabled: true, drawbars: [1, 2, 3, 4, 5, 6, 7, 8, 0] } } } })

  it('scene II is an independent on/off configuration; switching never touches a sound parameter', () => {
    let s = withOrgan(defaultState()) // scene I: piano A + organ A
    const sound = (x: EngineState) => JSON.stringify({ layers: { A: { ...x.layers.A, enabled: 0 }, B: { ...x.layers.B, enabled: 0 } }, organ: x.organ.layers.A.drawbars, synth: x.synth.A.patch, fx: x.fx, organFx: x.organFx })
    const before = sound(s)
    s = setScene(s, 1)
    expect(s.scene).toBe(1)
    // scene II starts with its own flags; make it "organ only"
    s = { ...s, layers: { ...s.layers, A: { ...s.layers.A, enabled: false } }, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, enabled: true } } }, organOn: true }
    s = setScene(s, 0)
    expect(s.layers.A.enabled && s.organ.layers.A.enabled).toBe(true) // scene I came back as it was
    s = setScene(s, 1)
    expect(s.layers.A.enabled).toBe(false)
    expect(s.organ.layers.A.enabled).toBe(true)
    expect(sound(s)).toBe(sound({ ...s, scene: 0 })) // nothing but enable flags differ
    expect(sound(setScene(s, 0))).toBe(before)
    expect(s.organ.layers.A.drawbars).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0])
  })

  it('toggleScene flips between I and II and both scenes stay serialisable', () => {
    let s = toggleScene(defaultState())
    expect(s.scene).toBe(1)
    s = toggleScene(s)
    expect(s.scene).toBe(0)
    expect(JSON.parse(JSON.stringify(s.scenes))).toEqual(s.scenes)
  })
})

describe('layers.routing — layer gestures for two and three layers', () => {
  it('tap replaces a lone layer or takes the focus; hold and Shift turn a layer off/on; both adds', () => {
    const ids = ['A', 'B', 'C'] as const
    let r = layerGesture({ A: true, B: false, C: false }, 'A', ids, 'B', 'tap')
    expect(r).toEqual({ enabled: { A: false, B: true, C: false }, focus: 'B' })
    r = layerGesture(r.enabled, r.focus, ids, 'A', 'both')
    expect(r.enabled).toEqual({ A: true, B: true, C: false })
    r = layerGesture(r.enabled, r.focus, ids, 'C', 'tap') // two are on: a tap on a third adds it
    expect(r.enabled).toEqual({ A: true, B: true, C: true })
    r = layerGesture(r.enabled, r.focus, ids, 'C', 'hold')
    expect(r.enabled.C).toBe(false)
    expect(r.focus).toBe('A')
    const last = layerGesture({ A: true, B: false, C: false }, 'A', ids, 'A', 'hold')
    expect(last.enabled.A).toBe(true) // the last layer cannot be turned off
    expect(layerGesture({ A: true, B: false, C: false }, 'A', ids, 'C', 'shift').enabled).toEqual({ A: true, B: false, C: true })
  })

  it('enabling a layer of a section that is off switches the section on and moves the effects focus there', () => {
    let s = pressOrganLayer(defaultState(), 'A', 'tap')
    expect(s.organOn).toBe(true)
    expect(s.organ.layers.A.enabled).toBe(true)
    expect(s.fxSection).toBe('organ')
    s = pressSynthLayer(s, 'B', 'both')
    expect(s.synthOn).toBe(true)
    expect(s.synthFocus).toBe('B')
    expect(s.synthFxFocus).toBe('B')
    expect(s.fxSection).toBe('synth')
  })
})

describe('morph.assignments — assignment, interpolation, clearing and indicators', () => {
  const base = (): EngineState => defaultState()

  it('resolves every assigned destination between its stored start and its end, per source position', () => {
    let s = base()
    s = { ...s, morph: assignMorph(s.morph, 'wheel', 'level.piano.A', 0.95, 0.15) }
    s = { ...s, morph: assignMorph(s.morph, 'wheel', 'fx.delayDryWet.A', 0.4, 1) }
    for (const w of [0, 0.25, 0.5, 1]) {
      const r = resolveMorph({ ...s, modWheel: w })
      expect(r.layers.A.level).toBeCloseTo(0.95 + (0.15 - 0.95) * w) // one destination goes down while another goes up
      expect(r.fx.A.delay.dryWet).toBeCloseTo(0.4 + 0.6 * w)
    }
    expect(resolveMorph({ ...s, modWheel: 0.5 })).not.toBe(s)
    expect(s.layers.A.level).toBe(0.95) // the stored value never changes
  })

  it('an unassigned state resolves to itself (no work, no copy)', () => {
    const s = base()
    expect(resolveMorph(s)).toBe(s)
    expect(resolveState(s)).toBe(s)
  })

  it('the Control Pedal is a separate source; two sources on one destination add their offsets', () => {
    let s = base()
    s = { ...s, morph: assignMorph(s.morph, 'pedal', 'synth.filterFreq.A', 0.62, 0.92) }
    s = { ...s, morph: assignMorph(s.morph, 'wheel', 'synth.filterFreq.A', 0.62, 0.32) }
    expect(resolveMorph({ ...s, pedalPos: 1 }).synth.A.patch.filter.freq).toBeCloseTo(0.92)
    expect(resolveMorph({ ...s, modWheel: 1 }).synth.A.patch.filter.freq).toBeCloseTo(0.32)
    expect(resolveMorph({ ...s, pedalPos: 1, modWheel: 1 }).synth.A.patch.filter.freq).toBeCloseTo(0.62)
  })

  it('covers every destination the programs spec lists: organ (level, drawbars, rotary speed), piano level, synth (six), effects (nine)', () => {
    const ids = [
      'level.organ.A',
      'level.organ.B',
      ...Array.from({ length: 9 }, (_, i) => `drawbar.organ.A.${i}`),
      'rotary.speed',
      'level.piano.A',
      'level.piano.B',
      'level.synth.A',
      'level.synth.C',
      ...['lfoRate', 'oscCtrl', 'lfoAmount', 'filterFreq', 'filterRes', 'arpRate'].map((p) => `synth.${p}.B`),
      ...['mod1Rate', 'mod1Amount', 'mod2Amount', 'delayTempo', 'delayFeedback', 'delayDryWet', 'ampFreq', 'ampDrive', 'reverbDryWet'].flatMap((p) => ['A', 'B', 'organ', 'sA', 'sB', 'sC'].map((c) => `fx.${p}.${c}`)),
    ]
    for (const id of ids) {
      const d = morphDest(id)
      expect(d, id).not.toBeNull()
      const s = base()
      const moved = d!.set(s, d!.max)
      expect(d!.get(moved), id).toBe(d!.max)
      expect(d!.get(d!.set(s, d!.max + 5)), id).toBeLessThanOrEqual(d!.max) // clamped
    }
    expect(morphDest('nonsense')).toBeNull()
    expect(morphDest('drawbar.organ.A.9')).toBeNull()
  })

  it('moving a control back to its start removes just that assignment; clearing a source removes only its own', () => {
    let s = base()
    s = { ...s, morph: assignMorph(s.morph, 'wheel', 'level.piano.A', 0.95, 0.3) }
    s = { ...s, morph: assignMorph(s.morph, 'wheel', 'fx.reverbDryWet.A', 0.4, 0.9) }
    s = { ...s, morph: assignMorph(s.morph, 'pedal', 'level.piano.B', 0.5, 1) }
    s = { ...s, morph: assignMorph(s.morph, 'wheel', 'level.piano.A', 0.95, 0.95) } // back to the start
    expect(s.morph.wheel.map((a) => a.dest)).toEqual(['fx.reverbDryWet.A'])
    s = { ...s, morph: clearMorph(s.morph, 'wheel') }
    expect(s.morph.wheel).toEqual([])
    expect(s.morph.pedal).toHaveLength(1)
    expect(assignMorph(s.morph, 'wheel', 'no.such.dest', 0, 1)).toBe(s.morph)
  })

  it('morph range for the LED graphs spans the stored start to the morphed end', () => {
    let s = base()
    s = { ...s, morph: assignMorph(s.morph, 'wheel', 'level.piano.A', 0.95, 0.45) }
    const range = morphRange(s.morph, 'level.piano.A', s)!
    expect(range.from).toBeCloseTo(0.95)
    expect(range.to).toBeCloseTo(0.45)
    expect(morphRange(s.morph, 'level.piano.B', s)).toBeNull()
  })

  it('SOLO silences every other section in the effective state, not in the stored one', () => {
    const s = { ...base(), solo: 'organ' as const }
    const r = resolveState(s)
    expect(r.layers.A.level).toBe(0)
    expect(s.layers.A.level).toBeGreaterThan(0)
    expect(r.organ.layers.A.level).toBe(s.organ.layers.A.level)
  })
})
