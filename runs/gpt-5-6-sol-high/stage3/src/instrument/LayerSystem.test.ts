import { describe, expect, it } from 'vitest'
import { LayerSystem } from './LayerSystem'

describe('layer routing and split zones', () => {
  it('supports seven layers with enable, focus, level, engine and effect assignment', () => {
    const layers = new LayerSystem()
    expect(layers.snapshot().layers).toHaveLength(7)
    layers.updateLayer('synth-c', { enabled: true, level: 1.4, engine: 'organ', effectChain: 'space-pad' })
    layers.focus('synth-c')
    expect(layers.snapshot().focusedLayer).toBe('synth-c')
    expect(layers.getLayer('synth-c')).toMatchObject({ enabled: true, level: 1, engine: 'organ', effectChain: 'space-pad' })
  })

  it('routes notes crossing ordered split boundaries only to assigned zones', () => {
    const layers = new LayerSystem()
    layers.setSplitPoints([60, 72])
    layers.updateLayer('piano-a', { enabled: true, zones: [1] })
    layers.updateLayer('organ-a', { enabled: true, zones: [2] })
    layers.updateLayer('synth-a', { enabled: true, zones: [3] })
    expect(layers.zoneFor(59)).toBe(1)
    expect(layers.zoneFor(60)).toBe(2)
    expect(layers.zoneFor(72)).toBe(3)
    expect(layers.routeNote(59).map((layer) => layer.id)).toEqual(['piano-a'])
    expect(layers.routeNote(60).map((layer) => layer.id)).toEqual(['organ-a'])
    expect(layers.routeNote(72).map((layer) => layer.id)).toEqual(['synth-a'])
  })

  it('normalizes boundaries and supports up to four zones', () => {
    const layers = new LayerSystem()
    layers.setSplitPoints([96, 36, 60, 72, 72])
    expect(layers.snapshot().splitPoints).toEqual([36, 60, 72])
    expect(layers.zoneFor(35)).toBe(1)
    expect(layers.zoneFor(36)).toBe(2)
    expect(layers.zoneFor(60)).toBe(3)
    expect(layers.zoneFor(72)).toBe(4)
  })
})
