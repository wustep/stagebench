/**
 * PerformanceStore — the observable home for performance state that is not a
 * single panel control: splits, zones, crossfades, layer scenes, morph
 * assignments, master clock, and transpose. It mirrors the ControlStore pattern
 * (immutable snapshots + subscribe) so React and the audio bindings can react.
 */

import {
  defaultPerformanceState,
  structuredCloneCompat,
  type PerformanceState,
  type MorphAssignment,
  type LayerKey,
  type CrossfadeWidth,
  type ZoneIndex,
} from './program';

export class PerformanceStore {
  private state: PerformanceState;
  private readonly listeners = new Set<(s: PerformanceState) => void>();

  constructor(initial: PerformanceState = defaultPerformanceState()) {
    this.state = initial;
  }

  getState(): PerformanceState {
    return this.state;
  }

  /** Replace whole state (program load). */
  replace(next: PerformanceState): void {
    this.state = structuredCloneCompat(next);
    this.emit();
  }

  private update(mut: (draft: PerformanceState) => void): void {
    const draft = structuredCloneCompat(this.state);
    mut(draft);
    this.state = draft;
    this.emit();
  }

  setTranspose(semitones: number): void {
    this.update((d) => {
      d.transpose = Math.max(-6, Math.min(6, Math.round(semitones)));
    });
  }

  setScene(scene: 'I' | 'II'): void {
    this.update((d) => {
      d.scene = scene;
    });
  }

  toggleScene(): void {
    this.update((d) => {
      d.scene = d.scene === 'I' ? 'II' : 'I';
    });
  }

  setLayerEnabled(scene: 'I' | 'II', layer: LayerKey, on: boolean): void {
    this.update((d) => {
      d.scenes[scene][layer] = on;
    });
  }

  setClockBpm(bpm: number): void {
    this.update((d) => {
      d.clock.bpm = Math.max(30, Math.min(300, Math.round(bpm)));
    });
  }

  setKeyboardSync(on: boolean): void {
    this.update((d) => {
      d.clock.keyboardSync = on;
    });
  }

  setSplitOn(on: boolean): void {
    this.update((d) => {
      d.split.on = on;
    });
  }

  setSplitPoint(which: 'low' | 'mid' | 'high', index: number | null): void {
    this.update((d) => {
      d.split.points[which] = index;
    });
  }

  setCrossfade(which: 'low' | 'mid' | 'high', width: CrossfadeWidth): void {
    this.update((d) => {
      d.split.crossfades[which] = width;
    });
  }

  setZone(layer: LayerKey, zone: ZoneIndex): void {
    this.update((d) => {
      d.split.zones[layer] = zone;
    });
  }

  setOctave(layer: LayerKey, octave: number): void {
    this.update((d) => {
      d.octaves[layer] = Math.max(-2, Math.min(2, octave));
    });
  }

  addMorph(source: 'wheel' | 'ctrlPedal', assignment: MorphAssignment): void {
    this.update((d) => {
      const list = d.morph[source];
      const existing = list.findIndex((a) => a.controlId === assignment.controlId);
      if (existing >= 0) list[existing] = assignment;
      else list.push(assignment);
    });
  }

  clearMorphSource(source: 'wheel' | 'ctrlPedal'): void {
    this.update((d) => {
      d.morph[source] = [];
    });
  }

  removeMorph(source: 'wheel' | 'ctrlPedal', controlId: string): void {
    this.update((d) => {
      d.morph[source] = d.morph[source].filter((a) => a.controlId !== controlId);
    });
  }

  subscribe(fn: (s: PerformanceState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}
