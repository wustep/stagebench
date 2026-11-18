import { expect, it } from 'vitest'
import {
  Programs,
  address,
  assign,
  effective,
  positions,
  switchScene,
  zoneGain,
} from '../src/programs'
import {
  allLayers,
  chainLayers,
  defaults,
  editEffect,
  globalMode,
} from '../src/settings'
import { controls } from '../src/hardware'
import { binding } from '../src/bindings'
import { exclusions, panelActions } from '../src/performance'

function memory() {
  const records = new Map<string, string>()
  return {
    getItem: (k: string) => records.get(k) ?? null,
    setItem: (k: string, v: string) => {
      records.set(k, v)
    },
  }
}
it('round-trips every slot with layer, effect, split, morph and scene edits, excluding the master and physical inputs', () => {
  const storage = memory(),
    bank = new Programs(storage),
    saved = []
  for (let i = 0; i < 32; i++) {
    bank.select(i)
    const s = structuredClone(bank.settings)
    s.bpm = 100 + i
    s.synth[2].patch.wave = i % 14
    s.synth[1].fx.reverb.tone = i % 3
    s.organ[1].patch.bars[0] = i % 9
    s.points[0] = { on: true, note: 36, width: 6 }
    s.layers[0].zone = [1, 3]
    s.synthFocus = 2
    s.transpose = (i % 13) - 6
    s.master = 20
    assign(s, 'wheel', 'synth.2.level', 100)
    switchScene(s)
    bank.edit(s)
    expect(bank.dirty).toBe(true)
    bank.store('Patch ' + address(i))
    bank.store()
    saved.push(structuredClone(bank.slot))
    expect(bank.dirty).toBe(false)
  }
  const recalled = new Programs(storage)
  saved.forEach((slot, i) => {
    recalled.select(i)
    expect(recalled.slot).toEqual(slot)
    expect(recalled.settings).toMatchObject(slot.data)
    expect(recalled.settings.master).toBe(81)
  })
})
it('discards abandoned edits, cancels an audition, copies between Live and regular slots and persists each Live change', () => {
  const storage = memory(),
    bank = new Programs(storage)
  bank.edit({ ...bank.settings, transpose: 3 })
  bank.store('Copy')
  bank.select(5)
  expect(bank.settings.split).toBe(true)
  bank.cancel()
  expect(bank.settings.transpose).toBe(3)
  expect(bank.dirty).toBe(true)
  bank.select(1)
  bank.select(0)
  expect(bank.settings.transpose).toBe(0)
  for (let i = 0; i < 8; i++) {
    bank.select(i, true)
    bank.edit({ ...bank.settings, bpm: 161 + i })
    const restored = new Programs(storage)
    expect(restored.live).toBe(true)
    expect(restored.settings.bpm).toBe(161 + i)
    expect(restored.dirty).toBe(false)
  }
  bank.store('Live copy')
  bank.select(31, false)
  bank.store()
  expect(bank.slot.name).toBe('Live copy')
  expect(bank.settings.bpm).toBe(168)
  bank.edit({
    ...bank.settings,
    master: 0,
    bend: 74,
    wheel: 12,
    pedalValue: 37,
    shift: true,
  })
  expect(bank.dirty).toBe(false)
})
it('crossfades adjacent zones across each available boundary; scenes swap only layer enables', () => {
  const s = defaults()
  s.split = true
  for (const point of positions)
    for (const width of [0, 6, 12]) {
      s.points[1] = { on: true, note: point, width }
      for (let offset = -13; offset <= 13; offset++) {
        const upper = zoneGain(s, [1, 3], point + offset)
        expect(upper).toBeCloseTo(
          width
            ? Math.max(0, Math.min(1, 0.5 + offset / (2 * width)))
            : Number(offset >= 0),
        )
        expect(upper + zoneGain(s, [0, 0], point + offset)).toBeCloseTo(1)
      }
    }
  s.points.forEach((p, i) =>
    Object.assign(p, { on: true, note: 48 + i * 12, width: 0 }),
  )
  for (let i = 0; i < 4; i++) expect(zoneGain(s, [i, i], 45 + 12 * i)).toBe(1)
  const mask = allLayers(s).map((l) => l.enabled),
    other = s.otherScene
  switchScene(s)
  expect(allLayers(s).map((l) => l.enabled)).toEqual(other)
  s.organ[1].patch.model = 3
  switchScene(s)
  expect(allLayers(s).map((l) => l.enabled)).toEqual(mask)
  expect(s.organ[1].patch.model).toBe(3)
})
it('assigns rising and falling morph ranges to their original layer after a focus change and removes a zero range', () => {
  const s = defaults()
  assign(s, 'wheel', 'organ.1.patch.bars.0', 0)
  assign(s, 'wheel', 'layers.1.level', 94)
  assign(s, 'pedalValue', 'synth.2.patch.ctrl', 95)
  s.organFocus = 0
  s.wheel = 50
  s.pedalValue = 25
  const n = effective(s)
  expect(n.organ[1].patch.bars[0]).toBe(4)
  expect(n.layers[1].level).toBe(74)
  expect(n.synth[2].patch.ctrl).toBe(50)
  expect(s.organ[1].patch.bars[0]).toBe(8)
  assign(s, 'wheel', 'organ.1.patch.bars.0', 8)
  expect(s.morphs).toHaveLength(2)
})
it('accounts for every physical control and follows all seven layer faders into their six effect chains', () => {
  const s = defaults()
  expect(
    controls
      .filter(
        (c) =>
          !binding(c.id, s) &&
          !panelActions.has(c.id) &&
          !exclusions[c.id] &&
          c.id !== 'effects-delay-tap',
      )
      .map((c) => c.id),
  ).toEqual([])
  for (const c of controls.filter((c) => c.kind === 'fader')) {
    binding(c.id, s)!.write(s, 23, false)
    expect(s.target.toLowerCase()).toBe(c.section)
    const i = 'abc'.indexOf(c.id.split('-')[2])
    expect(
      allLayers(s)[i + { organ: 2, synth: 4, piano: 0 }[c.section as 'organ']]
        .level,
    ).toBe(23)
    editEffect(s, 'amp', { bass: 12 + i })
    const fx =
      s.target === 'Organ'
        ? s.organ[0].fx
        : s.target === 'Piano'
          ? s.layers[i].fx
          : s.synth[i].fx
    expect(fx.amp.bass).toBe(12 + i)
  }
  globalMode(s, 'delay')
  editEffect(s, 'delay', { feedback: 83 })
  expect(chainLayers(s).every((l) => l.fx.delay.feedback === 83)).toBe(true)
})
