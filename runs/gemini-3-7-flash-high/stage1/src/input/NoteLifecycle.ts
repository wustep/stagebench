import { PianoEngine } from '../audio/PianoEngine';
import { COMPUTER_KEY_MAP } from '../model/keyboard';

export type NoteSource = 'pointer' | 'touch' | 'keyboard' | 'midi';

export interface NoteLifecycleOptions {
  engine: PianoEngine;
  onActiveKeysChange?: (activeMidis: Set<number>) => void;
  onSustainChange?: (isSustained: boolean) => void;
}

export class NoteLifecycle {
  private engine: PianoEngine;
  private activeNoteSources: Map<number, Set<NoteSource>> = new Map();
  private heldComputerKeys: Set<string> = new Set();
  private isSustained: boolean = false;
  private onActiveKeysChange?: (activeMidis: Set<number>) => void;
  private onSustainChange?: (isSustained: boolean) => void;
  private isDisposed = false;

  constructor(options: NoteLifecycleOptions) {
    this.engine = options.engine;
    this.onActiveKeysChange = options.onActiveKeysChange;
    this.onSustainChange = options.onSustainChange;
  }

  public noteOn(midi: number, source: NoteSource, velocity: number = 0.8): void {
    if (this.isDisposed) return;

    let sources = this.activeNoteSources.get(midi);
    const isFirstSource = !sources || sources.size === 0;

    if (!sources) {
      sources = new Set<NoteSource>();
      this.activeNoteSources.set(midi, sources);
    }

    sources.add(source);

    // Play note if it's the first source triggering it, or if it's a re-trigger
    this.engine.noteOn(midi, velocity);

    if (isFirstSource) {
      this.notifyActiveKeys();
    }
  }

  public noteOff(midi: number, source: NoteSource): void {
    if (this.isDisposed) return;

    const sources = this.activeNoteSources.get(midi);
    if (!sources) return;

    sources.delete(source);

    if (sources.size === 0) {
      this.activeNoteSources.delete(midi);
      this.engine.noteOff(midi);
      this.notifyActiveKeys();
    }
  }

  public setSustain(down: boolean): void {
    if (this.isDisposed) return;
    this.isSustained = down;
    this.engine.setSustain(down);
    if (this.onSustainChange) {
      this.onSustainChange(down);
    }
  }

  public getSustain(): boolean {
    return this.isSustained;
  }

  public toggleSustain(): void {
    this.setSustain(!this.isSustained);
  }

  public handleKeyDown(e: KeyboardEvent): boolean {
    if (this.isDisposed) return false;

    // Repeat suppression: ignore auto-repeating keydown events from OS
    if (e.repeat) return false;

    const key = e.key.toLowerCase();

    // Sustain toggle with Space or Shift
    if (e.code === 'Space' && !['input', 'textarea'].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) {
      this.setSustain(true);
      return true;
    }

    const midi = COMPUTER_KEY_MAP[key];
    if (midi !== undefined) {
      this.heldComputerKeys.add(key);
      this.noteOn(midi, 'keyboard', 0.8);
      return true;
    }

    return false;
  }

  public handleKeyUp(e: KeyboardEvent): boolean {
    if (this.isDisposed) return false;

    const key = e.key.toLowerCase();

    if (e.code === 'Space') {
      this.setSustain(false);
      return true;
    }

    const midi = COMPUTER_KEY_MAP[key];
    if (midi !== undefined) {
      this.heldComputerKeys.delete(key);
      this.noteOff(midi, 'keyboard');
      return true;
    }

    return false;
  }

  public allNotesOff(): void {
    this.activeNoteSources.clear();
    this.heldComputerKeys.clear();
    this.engine.allNotesOff();
    this.notifyActiveKeys();
  }

  public getActiveKeys(): Set<number> {
    return new Set(this.activeNoteSources.keys());
  }

  private notifyActiveKeys(): void {
    if (this.onActiveKeysChange) {
      this.onActiveKeysChange(new Set(this.activeNoteSources.keys()));
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    this.allNotesOff();
  }
}
