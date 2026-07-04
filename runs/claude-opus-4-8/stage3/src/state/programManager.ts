/**
 * ProgramManager — the 32-slot bank (4 pages × 8) plus 8 Live slots, with the
 * dirty (E) lifecycle, Store / Store As (naming) / edit-discard-on-change, and
 * Live auto-store (programs spec `storage`).
 *
 * It sits over a ControlStore (panel controls) and a PerformanceStore
 * (split/scene/morph/clock/transpose). Storing snapshots both into a ProgramState
 * that round-trips through JSON; loading replaces both stores' state so the whole
 * instrument reconfigures. Any live edit sets the dirty flag; changing program
 * without storing discards edits (edit-discard). Live slots auto-store edits.
 */

import { ControlStore, type ControlState } from './controlStore';
import { PerformanceStore } from './performanceStore';
import {
  makeProgram,
  normalizeProgram,
  serializeProgram,
  deserializeProgram,
  defaultPerformanceState,
  structuredCloneCompat,
  PROGRAM_EXCLUDED_CONTROLS,
  type ProgramState,
} from './program';
import { factoryPrograms } from './factoryPrograms';
import { createInitialState } from './controlStore';

export const SLOT_COUNT = 32;
export const PAGE_SIZE = 8;
export const PAGE_COUNT = 4;
export const LIVE_SLOT_COUNT = 8;

export interface ProgramLocation {
  bank: 'program' | 'live';
  index: number; // 0..31 (program) or 0..7 (live)
}

export type ProgramListener = () => void;

export class ProgramManager {
  private slots: ProgramState[] = [];
  private liveSlots: ProgramState[] = [];
  private current: ProgramLocation = { bank: 'program', index: 0 };
  private dirty = false;
  /** Pending Store destination (STORE flashes then confirms). */
  private storeArmed: ProgramLocation | null = null;
  /** Snapshot captured when STORE is armed (the edited buffer to write). */
  private pendingSnapshot: ProgramState | null = null;
  private readonly listeners = new Set<ProgramListener>();

  constructor(
    private readonly controls: ControlStore,
    private readonly performance: PerformanceStore,
  ) {
    this.initSlots();
    // Load the first program so the panel reflects a real factory sound.
    this.loadInto(this.slots[0]);
    // Any control or performance edit marks the program dirty.
    controls.subscribe(() => this.onEdit());
    performance.subscribe(() => this.onEdit());
  }

  private initSlots(): void {
    const factory = factoryPrograms();
    const empty = (): ProgramState =>
      makeProgram('Init Program', createInitialState(), defaultPerformanceState());
    this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => (factory[i] ? structuredCloneCompat(factory[i]) : empty()));
    this.liveSlots = Array.from({ length: LIVE_SLOT_COUNT }, () => empty());
  }

  // ---- subscription ----------------------------------------------------

  subscribe(fn: ProgramListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // ---- state accessors -------------------------------------------------

  isDirty(): boolean {
    return this.dirty;
  }
  isStoreArmed(): boolean {
    return this.storeArmed !== null;
  }
  storeDestination(): ProgramLocation | null {
    return this.storeArmed;
  }
  location(): ProgramLocation {
    return this.current;
  }
  page(): number {
    return this.current.bank === 'program' ? Math.floor(this.current.index / PAGE_SIZE) : 0;
  }
  currentName(): string {
    return this.slotAt(this.current).name;
  }
  /** Display label like "3.2" (page.button) or "L4" for Live. */
  displayLabel(loc: ProgramLocation = this.current): string {
    if (loc.bank === 'live') return `L${loc.index + 1}`;
    const page = Math.floor(loc.index / PAGE_SIZE) + 1;
    const button = (loc.index % PAGE_SIZE) + 1;
    return `${page}.${button}`;
  }
  slotAt(loc: ProgramLocation): ProgramState {
    return loc.bank === 'live' ? this.liveSlots[loc.index] : this.slots[loc.index];
  }
  /** All 32 program names for the numeric list view. */
  programList(): { label: string; name: string }[] {
    return this.slots.map((p, i) => ({ label: this.displayLabel({ bank: 'program', index: i }), name: p.name }));
  }
  liveList(): { label: string; name: string }[] {
    return this.liveSlots.map((p, i) => ({ label: this.displayLabel({ bank: 'live', index: i }), name: p.name }));
  }

  // ---- edit lifecycle --------------------------------------------------

  private applying = false;
  private onEdit(): void {
    if (this.applying) return;
    // Live slots auto-store every edit.
    if (this.current.bank === 'live') {
      this.liveSlots[this.current.index] = this.snapshot(this.liveSlots[this.current.index].name);
      this.dirty = false;
      this.emit();
      return;
    }
    if (!this.dirty) {
      this.dirty = true;
      this.emit();
    }
  }

  /** Snapshot the live stores into a ProgramState. */
  snapshot(name: string): ProgramState {
    return makeProgram(name, this.controls.getState(), this.performance.getState());
  }

  /** Apply a program into both stores (edit-discard replaces live state). */
  private loadInto(program: ProgramState): void {
    const normalized = normalizeProgram(program);
    this.applying = true;
    // Preserve Master Level (excluded from program state).
    const masterLevel = this.controls.get('performance-master-level');
    const nextControls: ControlState = { ...normalized.controls };
    for (const id of PROGRAM_EXCLUDED_CONTROLS) {
      if (masterLevel !== undefined) nextControls[id] = masterLevel as number;
    }
    this.controls.replaceState(nextControls);
    this.performance.replace(normalized.performance);
    this.applying = false;
    this.dirty = false;
  }

  // ---- navigation ------------------------------------------------------

  /** Select a program by location; discards unstored edits (edit-discard). */
  select(loc: ProgramLocation): void {
    if (this.storeArmed) {
      // While STORE is armed, browsing sets the destination and auditions it,
      // but keeps the pending (edited) snapshot to write on confirm.
      this.storeArmed = loc;
      this.loadInto(this.slotAt(loc));
      this.current = loc;
      this.emit();
      return;
    }
    this.current = loc;
    this.loadInto(this.slotAt(loc));
    this.emit();
  }

  selectProgramIndex(index: number): void {
    this.select({ bank: 'program', index: Math.max(0, Math.min(SLOT_COUNT - 1, index)) });
  }

  /** Program dial browsing: step forward/back through the current bank. */
  step(dir: 1 | -1): void {
    const bank = this.current.bank;
    const count = bank === 'live' ? LIVE_SLOT_COUNT : SLOT_COUNT;
    const next = (this.current.index + dir + count) % count;
    this.select({ bank, index: next });
  }

  /** Page buttons: move ±8 in the program bank. */
  setPage(page: number): void {
    if (this.current.bank !== 'program') return;
    const p = Math.max(0, Math.min(PAGE_COUNT - 1, page));
    const button = this.current.index % PAGE_SIZE;
    this.select({ bank: 'program', index: p * PAGE_SIZE + button });
  }
  pageStep(dir: 1 | -1): void {
    this.setPage(this.page() + dir);
  }

  /** Press a program button (0..7) within the current page (or Live slot). */
  pressButton(button: number): void {
    if (this.current.bank === 'live') {
      this.select({ bank: 'live', index: button });
      return;
    }
    this.select({ bank: 'program', index: this.page() * PAGE_SIZE + button });
  }

  /** LIVE MODE toggles the 8 buttons between program page and Live slots. */
  setLiveMode(on: boolean): void {
    if (on && this.current.bank !== 'live') this.select({ bank: 'live', index: 0 });
    else if (!on && this.current.bank === 'live') this.select({ bank: 'program', index: 0 });
  }
  isLiveMode(): boolean {
    return this.current.bank === 'live';
  }

  // ---- store lifecycle -------------------------------------------------

  /** STORE: first press arms (flashes) to current slot; second press confirms. */
  store(): void {
    if (this.current.bank === 'live') {
      // Live already auto-stores; STORE is a no-op confirmation.
      this.liveSlots[this.current.index] = this.snapshot(this.liveSlots[this.current.index].name);
      this.dirty = false;
      this.emit();
      return;
    }
    if (!this.storeArmed) {
      // Arm: capture the current (edited) buffer to write on confirm.
      this.storeArmed = { ...this.current };
      this.pendingSnapshot = this.snapshot(this.currentName());
      this.emit();
      return;
    }
    this.commitStore(this.pendingSnapshot?.name ?? this.currentName());
  }

  /** STORE AS: store under a new name at the armed (or current) destination. */
  storeAs(name: string): void {
    if (!this.pendingSnapshot) this.pendingSnapshot = this.snapshot(this.currentName());
    const dest = this.storeArmed ?? { ...this.current };
    this.storeArmed = dest;
    this.commitStore(name || this.currentName());
  }

  private commitStore(name: string): void {
    const dest = this.storeArmed ?? { ...this.current };
    const base = this.pendingSnapshot ?? this.snapshot(name);
    const program: ProgramState = { ...base, name };
    if (dest.bank === 'live') this.liveSlots[dest.index] = program;
    else this.slots[dest.index] = program;
    this.current = dest;
    this.storeArmed = null;
    this.pendingSnapshot = null;
    // Load the just-stored program so live state matches the slot.
    this.loadInto(this.slotAt(dest));
    this.dirty = false;
    this.emit();
  }

  /** Shift/Exit cancels an armed store, reloading the current program. */
  cancelStore(): void {
    if (!this.storeArmed) return;
    this.storeArmed = null;
    this.pendingSnapshot = null;
    this.loadInto(this.slotAt(this.current));
    this.emit();
  }

  // ---- test / persistence helpers -------------------------------------

  /** Serialize the whole bank (for persistence tests / Live survival). */
  exportBank(): string {
    return JSON.stringify({
      slots: this.slots.map(serializeProgram),
      live: this.liveSlots.map(serializeProgram),
      current: this.current,
    });
  }
  importBank(json: string): void {
    const raw = JSON.parse(json) as { slots: string[]; live: string[]; current: ProgramLocation };
    this.slots = raw.slots.map(deserializeProgram);
    this.liveSlots = raw.live.map(deserializeProgram);
    this.current = raw.current ?? { bank: 'program', index: 0 };
    this.loadInto(this.slotAt(this.current));
    this.emit();
  }
}
