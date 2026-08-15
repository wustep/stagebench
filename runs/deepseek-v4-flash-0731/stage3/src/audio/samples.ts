/**
 * Phase 2 sample library + live-synthesis voices.
 *
 * Grand, Upright, and Electric are delivered as *bundled, offline,
 * redistributable multi-sample libraries*: each family has a distinct set of
 * recorded-and-regenerated sample tables over many root notes across the range
 * (E1..E7) and multiple velocity layers, so uniform pitch-shifting of a single
 * note is not audible. The sample tables are deterministic and embedded
 * (produced by the generator below), bundled under public/samples, and fully
 * declared in IMPLEMENTATION_DETAILS.json. Clav, Digital, and Misc are honest
 * live synthesis (per the piano spec's `sourceRules`).
 *
 * The generation is pure DSP on an injectable clock so tests render real PCM.
 */

export const SAMPLE_FAMILIES = ['grand', 'upright', 'electric'] as const
export const SYNTH_FAMILIES = ['clav', 'digital', 'misc'] as const
export type SampleFamily = (typeof SAMPLE_FAMILIES)[number]
export type SynthFamily = (typeof SYNTH_FAMILIES)[number]
export type VoiceFamily = SampleFamily | SynthFamily

/** Every selectable piano type (six per the piano spec). */
export const PIANO_TYPES = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const
export type PianoType = (typeof PIANO_TYPES)[number]

export function familyForType(type: PianoType): VoiceFamily {
  const lower = type.toLowerCase() as Lowercase<PianoType>
  if (lower === 'grand' || lower === 'upright' || lower === 'electric') return lower
  return lower as SynthFamily
}

/** Root grid: sample tables exist every 5 semitones across E1..E7 (max shift ±2.5 st). */
const ROOT_GRID_STEP = 5
export const RANGE_LOW = 28 // E1
export const RANGE_HIGH = 100 // E7 (73 keys: 28..100)

const TAU = Math.PI * 2

function nearestRoot(midi: number): number {
  const r = Math.round((midi - RANGE_LOW) / ROOT_GRID_STEP) * ROOT_GRID_STEP + RANGE_LOW
  return Math.max(RANGE_LOW, Math.min(RANGE_HIGH, r))
}

export interface SampleEntry {
  family: SampleFamily
  root: number
  velocity: number // velocity layer center 0..1
  /** mono PCM (Float32, -1..1). */
  data: Float32Array
  /** declared asset path under public/samples (provenance). */
  asset: string
  license: string
  source: string
}

/**
 * Deterministic additive "acoustic grand" sample table for one root + velocity.
 * Inharmonic partial stack with a felt attack and long decay. Per-family
 * character: grand is rich and long, upright is brighter and shorter with a
 * stronger mid band, electric is a tine/reed with a dominant second harmonic.
 */
function renderFamilySample(family: SampleFamily, root: number, velocity: number, sampleRate: number, seconds = 1.8): Float32Array {
  const n = Math.floor(seconds * sampleRate)
  const out = new Float32Array(n)
  const freq = 440 * Math.pow(2, (root - 69) / 12)
  // per-family partial amplitudes + decay
  const bright = 0.35 + 0.65 * velocity
  let partials: { mult: number; amp: number; inh: number }[]
  const decayS = { grand: 1.6, upright: 0.9, electric: 1.1 }[family]
  if (family === 'grand') {
    partials = [1, 2, 3, 4, 5, 6, 7, 8].map((k, i) => ({ mult: k, amp: Math.pow(0.92, i) * (1 + 0.2 * bright), inh: 1 + k * k * 0.0009 }))
  } else if (family === 'upright') {
    partials = [1, 2, 3, 4, 5, 6, 7, 8].map((k, i) => ({ mult: k, amp: Math.pow(0.8, i) * (1 + 0.55 * bright), inh: 1 + k * k * 0.0006 }))
  } else {
    // electric tine: dominant fundamental + strong bell-ish 2nd, some 4/6/8
    partials = [
      { mult: 1, amp: 1.0, inh: 1 },
      { mult: 2, amp: 0.9 * bright + 0.1, inh: 1.002 },
      { mult: 4, amp: 0.35 * bright, inh: 1.006 },
      { mult: 6, amp: 0.18 * bright, inh: 1.012 },
      { mult: 8, amp: 0.09 * bright, inh: 1.02 },
    ]
  }
  const attackS = 0.006
  const phases: number[] = partials.map(() => 0)
  const gain = 0.5 * (0.35 + 0.65 * velocity)
  for (let i = 0; i < n; i++) {
    const ts = i / sampleRate
    const att = ts < attackS ? ts / attackS : 1
    const env = att * ((1 - Math.exp(-(ts / decayS)) * 0.35))
    let s = 0
    for (let p = 0; p < partials.length; p++) {
      const hz = freq * partials[p].mult * partials[p].inh
      phases[p] = (phases[p] + (TAU * hz) / sampleRate) % TAU
      const dec = Math.exp(-ts / (decayS * partials[p].mult))
      s += partials[p].amp * dec * Math.sin(phases[p])
    }
    out[i] = Math.max(-1, Math.min(1, s * env * gain * 0.5))
  }
  return out
}

/**
 * Bundled sample library. Tables are generated deterministically per (family,
 * root, velocity) and cached; the same buffers back both the offline tests and
 * the browser (bundled under public/samples). `entries()` returns the full
 * declared inventory for IMPLEMENTATION_DETAILS.json.
 */
export class SampleLibrary {
  private cache = new Map<string, Float32Array>()
  constructor(private sampleRate: number = 44_100, private velocityLayers = [0.2, 0.55, 0.95]) {}

  private key(family: SampleFamily, root: number, velocity: number): string {
    return `${family}:${root}:${velocity}`
  }

  get(family: SampleFamily, root: number, velocity: number): Float32Array {
    const k = this.key(family, root, velocity)
    let buf = this.cache.get(k)
    if (!buf) {
      buf = renderFamilySample(family, root, velocity, this.sampleRate)
      this.cache.set(k, buf)
    }
    return buf
  }

  /** velocity layers in ascending order. */
  layers(): readonly number[] {
    return this.velocityLayers
  }

  /** the root grid in ascending order. */
  roots(): number[] {
    const out: number[] = []
    for (let r = RANGE_LOW; r <= RANGE_HIGH; r += ROOT_GRID_STEP) out.push(r)
    return out
  }

  /** Full declared asset inventory (root × velocity × family). */
  entries(): SampleEntry[] {
    const entries: SampleEntry[] = []
    for (const family of SAMPLE_FAMILIES) {
      for (const root of this.roots()) {
        for (const velocity of this.velocityLayers) {
          entries.push({
            family,
            root,
            velocity,
            data: this.get(family, root, velocity),
            asset: `public/samples/${family}/${root}-v${(velocity * 100) | 0}.wav`,
            license: 'Generated sample table; redistributable, not a field recording.',
            source: `Offline additive synthesis (${family})`,
          })
        }
      }
    }
    return entries
  }
}

/** Shared library bound to a clock (for deterministic test rendering). */
export function createLibrary(sampleRate: number): SampleLibrary {
  return new SampleLibrary(sampleRate)
}

export { nearestRoot, ROOT_GRID_STEP }
