/** Module-level engine registration for control bindings */

import type { PianoEngine } from '../audio/piano-engine'
import { applyButtonToEngine, applyControlToEngine, isFunctionalControl } from './control-bindings'

let engineRef: PianoEngine | null = null

export function registerEngine(engine: PianoEngine | null): void {
  engineRef = engine
}

export function getRegisteredEngine(): PianoEngine | null {
  return engineRef
}

export function notifyControlChange(id: string, value: number): void {
  if (engineRef && isFunctionalControl(id)) {
    applyControlToEngine(engineRef, id, value)
  }
}

export function notifyButtonPress(id: string): void {
  if (engineRef && isFunctionalControl(id)) {
    applyButtonToEngine(engineRef, id)
  }
}
