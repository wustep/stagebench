import type { LayerId } from './LayerSystem'
export const EFFECT_TYPES = ['reverb', 'delay', 'chorus', 'ensemble', 'phaser', 'flanger', 'tremolo', 'ring-mod', 'rotary', 'eq', 'compressor', 'drive', 'amp-sim', 'spin', 'pump', 'space-delay', 'flam-delay'] as const
export type EffectType = (typeof EFFECT_TYPES)[number]
export interface EffectSlot { type: EffectType; mix: number; bypassed: boolean; parameters: Record<string, number> }
export type EffectsSnapshot = Record<string, EffectSlot[]>
const targetFor = (layer: LayerId) => layer.startsWith('organ-') ? 'organ' : layer
const cloneSlot = (slot: EffectSlot): EffectSlot => ({ ...slot, parameters: { ...slot.parameters } })
export class EffectsRack {
  private chains = new Map<string, EffectSlot[]>()
  add(layer: LayerId, type: EffectType, mix = 0.5, parameters: Record<string, number> = {}) { const target = targetFor(layer); const chain = this.chains.get(target) ?? []; chain.push({ type, mix: Math.min(1, Math.max(0, mix)), bypassed: false, parameters: { ...parameters } }); this.chains.set(target, chain) }
  setBypass(layer: LayerId, index: number, bypassed: boolean) { const slot = this.slot(layer, index); if (slot) slot.bypassed = bypassed }
  setMix(layer: LayerId, index: number, mix: number) { const slot = this.slot(layer, index); if (slot) slot.mix = Math.min(1, Math.max(0, mix)) }
  setType(layer: LayerId, index: number, type: EffectType) { const slot = this.slot(layer, index); if (slot) slot.type = type }
  setParameter(layer: LayerId, index: number, parameter: string, value: number) { const slot = this.slot(layer, index); if (slot) slot.parameters[parameter] = Math.min(1, Math.max(0, value)) }
  move(layer: LayerId, from: number, to: number) { const chain = this.chains.get(targetFor(layer)); if (!chain || !chain[from]) return; const [slot] = chain.splice(from, 1); chain.splice(Math.min(chain.length, Math.max(0, to)), 0, slot) }
  chain(layer: LayerId) { return (this.chains.get(targetFor(layer)) ?? []).map(cloneSlot) }
  snapshot(): EffectsSnapshot { return Object.fromEntries([...this.chains].map(([target, chain]) => [target, chain.map(cloneSlot)])) }
  restore(snapshot: EffectsSnapshot) { this.chains = new Map(Object.entries(snapshot).map(([target, chain]) => [target, chain.map(cloneSlot)])) }
  private slot(layer: LayerId, index: number) { return this.chains.get(targetFor(layer))?.[index] }
}
