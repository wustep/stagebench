import { StageEngine } from '../audio/stage'
import { StatusModel } from './status'
import { SampleLibrary } from '../audio/samples'

/**
 * Truthful asset lifetime for the Piano library: loading / ready / error /
 * fallback.
 *
 * Grand, Upright, and Electric are bundled offline sample sets; the loader
 * "loads" them (from the bundled tables) and reports ready. If loading ever
 * fails, the engine switches to a *labeled* playable fallback voice and the
 * status reports `fallback` — never `ready`. Clav / Digital / Misc are live
 * synthesis and are always available even in fallback.
 *
 * The loader is injectable so tests can force an asset failure and verify the
 * fallback path without any device or network.
 */

export type LibraryPhase = 'loading' | 'ready' | 'error' | 'fallback'

export interface LibraryLoadOptions {
  engine: StageEngine
  status: StatusModel
  /** injectable loader; default is synchronous success for bundled tables. */
  load?: (library: SampleLibrary) => Promise<void>
  library?: SampleLibrary
}

export class PianoLibrary {
  readonly engine: StageEngine
  readonly status: StatusModel
  private loadFn: (library: SampleLibrary) => Promise<void>
  readonly library: SampleLibrary
  private _phase: LibraryPhase = 'loading'
  private _usingFallback = false

  constructor(options: LibraryLoadOptions) {
    this.engine = options.engine
    this.status = options.status
    this.library = options.library ?? new SampleLibrary(this.engine.sampleRate)
    this.loadFn = options.load ?? (() => Promise.resolve())
  }

  get phase(): LibraryPhase {
    return this._phase
  }

  get usingFallback(): boolean {
    return this._usingFallback
  }

  /** Start loading; calls resolve/reject through the injectable loader. */
  async load(): Promise<LibraryPhase> {
    this._phase = 'loading'
    this._usingFallback = false
    this.status.setLoading('Loading piano sample library…')
    try {
      await this.loadFn(this.library)
      this._phase = 'ready'
      this._usingFallback = false
      this.status.setReady('Piano library ready (sample sets + synthesis)')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this._phase = 'fallback'
      this._usingFallback = true
      // labeled fallback: keep the engine playable with a synthesized voice.
      this.engine.enableFallback(true)
      this.status.setFallback(`Sample library unavailable (${msg}); using labeled synthesized fallback.`)
    }
    return this._phase
  }

  /** Return to normal (non-fallback) operation. */
  async retry(): Promise<LibraryPhase> {
    this.engine.enableFallback(false)
    return this.load()
  }
}
