import { defaultSoundState, type ChainSound, type LayerSound, type SampleSet, type SampleSetId, type SoundState } from '../../src/audio/dsp/params'
import { StageKernel } from '../../src/audio/dsp/stage'
import { SampleLibrary } from '../../src/audio/library/loader'
import { modelAt, PIANO_TYPES, type PianoTypeName } from '../../src/piano/catalog'
import { readBundledAsset } from './fakes'
import { SR, type Stereo } from './signal'

/** Helpers for rendering the real Phase 2 kernel offline, with the real bundled recordings. */

const library = new SampleLibrary((path) => Promise.resolve(readBundledAsset(path)))

export async function loadSet(id: SampleSetId): Promise<SampleSet> {
  const set = await library.load(id)
  if (!set) throw new Error(`Sample set ${id} failed to load: ${library.error(id)}`)
  return set
}

export async function loadAllSets(): Promise<SampleSet[]> {
  return Promise.all((['grand', 'upright', 'electric'] as const).map(loadSet))
}

/** A kernel at 48 kHz with every bundled sample set installed. */
export async function makeStage(configure?: (sound: SoundState) => void): Promise<StageKernel> {
  const kernel = new StageKernel({ sampleRate: SR })
  for (const set of await loadAllSets()) kernel.loadSampleSet(set.id, set)
  if (configure) kernel.setState(soundWith(configure))
  return kernel
}

/** The default sound state with changes applied to a private copy. */
export function soundWith(configure: (sound: SoundState) => void, from: SoundState = defaultSoundState()): SoundState {
  const copy = structuredClone(from)
  configure(copy)
  return copy
}

/** Change the kernel's current state in place (copy, mutate, set). */
export function change(kernel: StageKernel, configure: (sound: SoundState) => void): void {
  kernel.setState(soundWith(configure, kernel.getState()))
}

/** Point a layer at a piano type's model. */
export function selectType(layer: LayerSound, type: PianoTypeName, model = 0): void {
  const chosen = modelAt(PIANO_TYPES.indexOf(type), model)
  layer.source = chosen.source
  layer.family = chosen.family
}

export function renderStage(kernel: StageKernel, seconds: number): Stereo {
  const frames = Math.round((seconds * kernel.sampleRate) / 128) * 128
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let offset = 0; offset < frames; offset += 128) {
    kernel.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128))
  }
  return { left, right }
}

export function fx(sound: SoundState, layer = 0): ChainSound {
  return sound.layers[layer].fx
}

/** Normalised correlation of two equal-length signals: 1 = identical shape, 0 = unrelated. */
export function correlation(a: Float32Array, b: Float32Array): number {
  let ab = 0
  let aa = 0
  let bb = 0
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    ab += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  return ab / Math.sqrt(Math.max(1e-30, aa * bb))
}

/** RMS of the sample-by-sample difference, relative to the RMS of `a`. 0 = identical. */
export function difference(a: Float32Array, b: Float32Array): number {
  let diff = 0
  let ref = 0
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    diff += (a[i] - b[i]) * (a[i] - b[i])
    ref += a[i] * a[i]
  }
  return Math.sqrt(diff / Math.max(1e-30, ref))
}

/** Largest sample-to-sample jump, as a click detector. */
export function largestStep(buffer: Float32Array): number {
  let max = 0
  for (let i = 1; i < buffer.length; i += 1) max = Math.max(max, Math.abs(buffer[i] - buffer[i - 1]))
  return max
}
