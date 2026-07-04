/**
 * Phase-3 section bindings: map the Organ, Synth, and Program/performance panel
 * state onto the AudioEngine so every functional control changes real audio or
 * routing (honesty contract). Piano / Layer-Effects / Master bindings stay in
 * controlBindings.ts; this module adds Organ + Synth + the routing gate
 * (splits × scenes) that decides which section-layers sound per note.
 */

import type { AudioEngine, OrganLayerId, SynthLayerId, SectionId } from './audioEngine';
import type { OrganModelId } from './organEngine';
import type { SynthCategory, FilterType } from './synthEngine';
import { makeEnvelope } from './synthEngine';
import type { ControlState } from '../state/controlStore';
import type { PerformanceState, LayerKey, CrossfadeWidth } from '../state/program';
import { SPLIT_POSITION_MIDI, SPLIT_POSITIONS, crossfadeGain } from '../state/program';

const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : d);
const bool = (v: unknown): boolean => v === true;

// ---- Organ ----------------------------------------------------------------

const ORGAN_MODELS: OrganModelId[] = ['B3', 'VOX', 'FARF', 'PIPE1', 'PIPE2', 'B3BASS'];
const VIB_MODES = ['V1', 'C1', 'V2', 'V3', 'C2', 'C3'];

export function applyOrgan(engine: AudioEngine, state: ControlState): void {
  engine.setOrganSection({
    on: bool(state['organ-on']),
    sustPed: bool(state['organ-sustped']),
    pStick: bool(state['organ-pstick']),
    percussion: {
      on: bool(state['organ-perc-on']),
      soft: bool(state['organ-perc-volume']),
      fast: bool(state['organ-perc-decay']),
      third: bool(state['organ-perc-harmonic']),
    },
    vibChorus: { on: bool(state['organ-vib-on']), mode: VIB_MODES[num(state['organ-vib-chorus'])] ?? 'V1' },
    rotaryRouted: bool(state['performance-rotary-on']),
  });
  const model = ORGAN_MODELS[num(state['organ-model'])] ?? 'B3';
  for (const layer of ['A', 'B'] as OrganLayerId[]) {
    const l = layer.toLowerCase();
    engine.setOrganLayer(layer, {
      enabled: bool(state['organ-on']) && bool(state[`organ-on-off-${l}`]),
      level: num(state[`organ-level-${l}`], layer === 'A' ? 0.8 : 0.5),
      model,
      drawbars: Array.from({ length: 9 }, (_, i) => num(state[`organ-drawbar-${i + 1}`])),
    });
  }
}

// ---- Synth ----------------------------------------------------------------

const SYNTH_CATEGORIES: SynthCategory[] = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H'];
const FILTER_TYPES: FilterType[] = ['LP12', 'LP24', 'HP', 'BP'];
const VOICE_MODES = ['Poly', 'Mono', 'Legato'] as const;
const ARP_DIRECTIONS = ['Up', 'Down', 'Up/Down', 'Random'] as const;
const LFO_DESTS = ['off', 'pitch', 'ctrl', 'cutoff'] as const;

export function applySynth(engine: AudioEngine, state: ControlState): void {
  const arpModeIdx = num(state['synth-arp-mode']); // 0 Poly, 1 Arp (panel) -> map
  engine.setSynthSection({
    on: bool(state['synth-on']),
    sustPed: bool(state['synth-sustped']),
    pStick: bool(state['synth-pstick']),
    voiceMode: VOICE_MODES[num(state['synth-voice-mode'])] ?? 'Poly',
    priority: 'Off',
    arpOn: bool(state['synth-arp-run']),
    arpMode: arpModeIdx === 0 ? 'Poly' : 'Arp',
    arpRange: 1 + Math.round(num(state['synth-arp-range'], 0.3) * 3), // 1..4 octaves
    arpDirection: ARP_DIRECTIONS[num(state['synth-arp-dir'])] ?? 'Up',
    arpRate: num(state['synth-arp-rate'], 0.5),
    arpHold: bool(state['synth-kb-hold']),
    arpClockSync: bool(state['synth-arp-sync']),
    lfoWaveform: num(state['synth-lfo-wave-idx']),
    lfoDestination: LFO_DESTS[num(state['synth-lfo-dest'])] ?? 'off',
    lfoRate: num(state['synth-lfo-rate'], 0.3),
    lfoAmount: num(state['synth-lfo-amt'], 0.2),
    lfoClockSync: bool(state['synth-lfo-sync']),
    vibrato: bool(state['synth-vibrato']) ? 'On' : 'Off',
    kbHold: bool(state['synth-kb-hold']),
  });

  const category = SYNTH_CATEGORIES[num(state['synth-osc-cat'])] ?? 'Super';
  const filterType = FILTER_TYPES[num(state['synth-filter-type-idx'])] ?? 'LP24';
  const envA = num(state['synth-env-attack'], 0.0);
  const envD = num(state['synth-env-decay'], 0.5);
  const envR = num(state['synth-env-release'], 0.3);
  for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
    const l = layer.toLowerCase();
    engine.setSynthLayer(layer, {
      enabled: bool(state['synth-on']) && bool(state[`synth-on-off-${l}`]),
      level: num(state[`synth-level-${l}`], 0.6),
      category,
      waveIndex: num(state['synth-wave-idx']),
      oscCtrl: num(state['synth-osc-ctrl'], 0.4),
      oscEnvAmt: num(state['synth-osc-env-amt'], 0.5) * 2 - 1,
      filterType,
      filterFreq: num(state['synth-filter-freq'], 0.6),
      filterRes: num(state['synth-filter-res'], 0.3),
      filterEnvAmt: num(state['synth-filter-env-amt'], 0.5),
      filterTracking: num(state['synth-filter-track'], 0.66),
      drive: num(state['synth-filter-drive'], 0),
      oscEnv: makeEnvelope(envA, envD, envR),
      filterEnv: makeEnvelope(envA, envD, envR, bool(state['synth-filter-env'])),
      ampEnv: makeEnvelope(envA, envD, envR, true),
      unison: num(state['synth-unison']),
      glide: num(state['synth-glide'], 0.2),
    });
  }
}

// ---- Clock / transpose ----------------------------------------------------

export function applyPerformance(engine: AudioEngine, perf: PerformanceState): void {
  engine.setTranspose(perf.transpose);
  engine.clock.setBpm(perf.clock.bpm);
}

// ---- Routing gate (splits × scenes) --------------------------------------

/**
 * Build the per-note layer gain function from the performance state. A note
 * sounds on a layer only if that layer is enabled in the active scene; if a
 * split is on, the note must fall in the layer's assigned zone (with crossfades
 * fading across the boundary).
 */
export function makeRoutingGate(perf: PerformanceState): (section: SectionId, layer: string, midi: number) => number {
  const scene = perf.scenes[perf.scene];
  const split = perf.split;

  // Zone boundaries: the active split points sorted, splitting the keyboard into
  // up to 4 contiguous zones (0 = lowest).
  const boundaries: { midi: number; width: CrossfadeWidth }[] = [];
  const order: Array<['low' | 'mid' | 'high']> = [['low'], ['mid'], ['high']];
  for (const [which] of order) {
    const idx = split.points[which];
    if (idx !== null && idx !== undefined) {
      const pos = SPLIT_POSITIONS[idx];
      boundaries.push({ midi: SPLIT_POSITION_MIDI[pos], width: split.crossfades[which] });
    }
  }
  boundaries.sort((a, b) => a.midi - b.midi);

  return (section, layer, midi) => {
    const key = `${section}-${layer}` as LayerKey;
    if (scene[key] === false) return 0;
    if (!split.on || boundaries.length === 0) return scene[key] ? 1 : 0;

    // Which zone does this layer belong to?
    const zone = split.zones[key] ?? 0;
    // Compute a crossfaded gain for `midi` at zone `zone`.
    // Zone z is bounded below by boundaries[z-1] and above by boundaries[z].
    let gain = 1;
    if (zone > 0 && zone - 1 < boundaries.length) {
      const b = boundaries[zone - 1];
      gain *= crossfadeGain(midi, b.midi, b.width, 'high');
    }
    if (zone < boundaries.length) {
      const b = boundaries[zone];
      gain *= crossfadeGain(midi, b.midi, b.width, 'low');
    }
    return scene[key] ? gain : 0;
  };
}
