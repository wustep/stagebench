export type EngineKind = 'organ' | 'piano' | 'synth'
export type LayerId = 'organ-a' | 'organ-b' | 'piano-a' | 'piano-b' | 'synth-a' | 'synth-b' | 'synth-c'
export type KeyboardZone = 1 | 2 | 3 | 4
export interface InstrumentLayer { id: LayerId; engine: EngineKind; enabled: boolean; level: number; zones: KeyboardZone[]; effectChain: string }
export interface LayerSnapshot { focusedLayer: LayerId; splitPoints: number[]; layers: InstrumentLayer[] }
const LAYERS: InstrumentLayer[] = [
  { id: 'organ-a', engine: 'organ', enabled: true, level: 0.72, zones: [1, 2, 3, 4], effectChain: 'organ' },
  { id: 'organ-b', engine: 'organ', enabled: false, level: 0.55, zones: [1, 2, 3, 4], effectChain: 'organ' },
  { id: 'piano-a', engine: 'piano', enabled: true, level: 0.76, zones: [1, 2, 3, 4], effectChain: 'piano-a' },
  { id: 'piano-b', engine: 'piano', enabled: false, level: 0.58, zones: [1, 2, 3, 4], effectChain: 'piano-b' },
  { id: 'synth-a', engine: 'synth', enabled: false, level: 0.64, zones: [1, 2, 3, 4], effectChain: 'synth-a' },
  { id: 'synth-b', engine: 'synth', enabled: false, level: 0.48, zones: [1, 2, 3, 4], effectChain: 'synth-b' },
  { id: 'synth-c', engine: 'synth', enabled: false, level: 0.42, zones: [1, 2, 3, 4], effectChain: 'synth-c' },
]
const cloneLayer = (layer: InstrumentLayer): InstrumentLayer => ({ ...layer, zones: [...layer.zones] })
export class LayerSystem {
  private layers = new Map<LayerId, InstrumentLayer>(LAYERS.map((layer) => [layer.id, cloneLayer(layer)]))
  private splitPoints: number[] = []
  private focusedLayer: LayerId = 'piano-a'
  getLayer(id: LayerId) { const layer = this.layers.get(id); if (!layer) throw new Error(`Unknown layer ${id}`); return cloneLayer(layer) }
  updateLayer(id: LayerId, patch: Partial<Omit<InstrumentLayer, 'id'>>) {
    const layer = this.getLayer(id)
    const zones = patch.zones ? [...new Set(patch.zones)].filter((zone): zone is KeyboardZone => zone >= 1 && zone <= 4) : layer.zones
    this.layers.set(id, { ...layer, ...patch, level: Math.min(1, Math.max(0, patch.level ?? layer.level)), zones })
  }
  focus(id: LayerId) { this.getLayer(id); this.focusedLayer = id }
  setSplitPoints(points: number[]) { this.splitPoints = [...new Set(points.map(Math.round).filter((point) => point >= 28 && point <= 100))].sort((a, b) => a - b).slice(0, 3) }
  zoneFor(midi: number): KeyboardZone { return (1 + this.splitPoints.filter((point) => midi >= point).length) as KeyboardZone }
  routeNote(midi: number) { const zone = this.zoneFor(midi); return [...this.layers.values()].filter((layer) => layer.enabled && layer.zones.includes(zone)).map(cloneLayer) }
  snapshot(): LayerSnapshot { return { focusedLayer: this.focusedLayer, splitPoints: [...this.splitPoints], layers: [...this.layers.values()].map(cloneLayer) } }
  restore(snapshot: LayerSnapshot) { this.layers = new Map(snapshot.layers.map((layer) => [layer.id, cloneLayer(layer)])); this.splitPoints = [...snapshot.splitPoints]; this.focusedLayer = snapshot.focusedLayer }
}
