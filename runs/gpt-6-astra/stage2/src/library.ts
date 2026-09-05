import type { PianoType } from './phase2-state'
export interface SampleEntry { file: string; type: PianoType; model: string; root: number; velocity: number; source: string; license: string }
export interface RecordedSample extends SampleEntry { data: Float32Array; sampleRate: number }
// No recording exists in the supplied inputs. An empty manifest is intentional,
// and is reported as unavailable rather than pretending synthesized audio is sampled.
export const bundledManifest: SampleEntry[] = []
export class PianoLibrary {
  status: 'idle' | 'loading' | 'ready' | 'fallback' = 'idle'
  error = ''
  samples: RecordedSample[] = []
  constructor(readonly manifest = bundledManifest, private fetcher: typeof fetch = (...args) => fetch(...args)) {}
  async load(decode: (data: ArrayBuffer) => Promise<AudioBuffer>) {
    this.status = 'loading'
    try {
      if (!['Grand', 'Upright', 'Electric'].every(type => this.manifest.some(s => s.type === type))) throw new Error('Recorded Grand, Upright and Electric assets were not supplied. Synthesized fallback is active.')
      this.samples = await Promise.all(this.manifest.map(async entry => {
        if (!entry.source || !entry.license) throw new Error('Recording provenance is incomplete')
        const response = await this.fetcher(entry.file)
        if (!response.ok) throw new Error(`Sample unavailable: ${entry.file}`)
        const buffer = await decode(await response.arrayBuffer())
        return { ...entry, data: new Float32Array(buffer.getChannelData(0)), sampleRate: buffer.sampleRate }
      }))
      this.status = 'ready'
    } catch (error) { this.samples = []; this.error = String(error); this.status = 'fallback' }
  }
}
