/**
 * Phase 2 bundled-sample library: manifest + WAV loading over injectable
 * fetch/decode boundaries (no network in tests; deterministic by construction).
 *
 * Sets: `grand` / `upright` / `electric`, 15 roots each
 * (28..98 step 5, max pitch-shift ±3 st), 3 velocity layers per root
 * (soft/mid/loud). Clav/Digital/Misc are honest synthesis and never appear
 * here.
 */

export type SampleSetId = 'grand' | 'upright' | 'electric';

export const SAMPLE_ROOTS = [28, 33, 38, 43, 48, 53, 58, 63, 68, 73, 78, 83, 88, 93, 98];

export interface VelocityLayerDef {
  id: 'soft' | 'mid' | 'loud';
  velocity: number;
}

export const SAMPLE_LAYERS: VelocityLayerDef[] = [
  { id: 'soft', velocity: 40 },
  { id: 'mid', velocity: 80 },
  { id: 'loud', velocity: 115 },
];

export interface SampleManifestSet {
  id: string;
  name: string;
  kind: string;
  files: string[];
  rootNotes: number[];
  seed: number;
}

export interface SampleManifest {
  version: number;
  tool: string;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  format: string;
  durationSec: number;
  roots: number[];
  layers: Array<{ id: string; velocity: number }>;
  license: string;
  origin: string;
  sets: SampleManifestSet[];
}

export interface FetchLike {
  (url: string): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface DecodedSample {
  setId: SampleSetId;
  rootMidi: number;
  layerId: string;
  velocity: number;
  sampleRate: number;
  data: Float32Array;
}

export interface DecodeLike {
  (bytes: ArrayBuffer): Promise<{ sampleRate: number; length: number; getChannelData(c: number): Float32Array }>;
}

/** Nearest root for a MIDI note; shift stays within ±3 semitones. */
export function nearestRoot(midi: number): { root: number; shiftSt: number } {
  let best = SAMPLE_ROOTS[0];
  for (const root of SAMPLE_ROOTS) {
    if (Math.abs(midi - root) < Math.abs(midi - best)) best = root;
  }
  return { root: best, shiftSt: midi - best };
}

/** Velocity layer by stroke strength (boundary-tolerant). */
export function velocityLayer(velocity: number): VelocityLayerDef {
  if (velocity <= 60) return SAMPLE_LAYERS[0];
  if (velocity <= 100) return SAMPLE_LAYERS[1];
  return SAMPLE_LAYERS[2];
}

export function assetUrl(base: string, setId: SampleSetId, root: number, layer: string): string {
  return `${base}/${setId}/${setId}.${root}.${layer}.wav`;
}

export interface SampleLibrary {
  sets: SampleSetId[];
  manifest: SampleManifest | null;
  buffers: Map<string, DecodedSample>;
  failed: string[];
}

/**
 * Load every bundled asset through injected fetch/decode. Returns the
 * populated library; failures are recorded per-file and never throw, so the
 * caller can enter the labeled fallback path.
 */
export async function loadSampleLibrary(
  fetchImpl: FetchLike,
  decode: DecodeLike,
  base: string,
  manifestUrl: string,
): Promise<SampleLibrary> {
  const lib: SampleLibrary = { sets: [], manifest: null, buffers: new Map(), failed: [] };
  const manifestRes = await fetchImpl(manifestUrl);
  if (!manifestRes.ok) {
    lib.failed.push('manifest.json');
    return lib;
  }
  const manifest = JSON.parse(new TextDecoder().decode(await manifestRes.arrayBuffer())) as SampleManifest;
  lib.manifest = manifest;
  for (const setId of ['grand', 'upright', 'electric'] as SampleSetId[]) {
    let ok = true;
    for (const root of SAMPLE_ROOTS) {
      for (const layer of SAMPLE_LAYERS) {
        const url = assetUrl(base, setId, root, layer.id);
        const key = `${setId}.${root}.${layer.id}`;
        try {
          const res = await fetchImpl(url);
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
          const decoded = await decode(await res.arrayBuffer());
          const channel = decoded.getChannelData(0);
          lib.buffers.set(key, {
            setId,
            rootMidi: root,
            layerId: layer.id,
            velocity: layer.velocity,
            sampleRate: decoded.sampleRate,
            data: Float32Array.from(channel),
          });
        } catch {
          lib.failed.push(key);
          ok = false;
        }
      }
    }
    if (ok) lib.sets.push(setId);
  }
  return lib;
}

/** Parse the shipped manifest bytes (used by tests on the real file). */
export function parseManifest(bytes: ArrayBuffer): SampleManifest {
  return JSON.parse(new TextDecoder().decode(bytes)) as SampleManifest;
}
