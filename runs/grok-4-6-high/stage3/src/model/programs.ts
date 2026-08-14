import {
  applyEnables,
  applyPatch,
  captureEnables,
  cloneJson,
  extractPatch,
  patchesEqual,
  type InstrumentState,
  type ProgramPatch,
  type SceneId,
} from './instrument-state'

const NAME_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.'

export function markDirty(state: InstrumentState): void {
  if (state.liveMode) {
    state.liveSlots[state.liveIndex] = {
      name: state.liveSlots[state.liveIndex]?.name ?? `Live ${state.liveIndex + 1}`,
      patch: extractPatch(state),
    }
    state.dirty = false
    state.loadedPatch = extractPatch(state)
    return
  }
  state.dirty = !patchesEqual(state, state.loadedPatch)
}

export function selectProgram(state: InstrumentState, index: number, keepEdits = false): void {
  const next = ((index % 32) + 32) % 32
  if (!state.liveMode && next === state.programIndex && state.storeMode === 'off') return
  if (state.storeMode === 'dest') {
    state.storeDest = next
    state.page = Math.floor(next / 8)
    return
  }
  if (!keepEdits && state.dirty && !state.liveMode) {
    state.undoPatch = extractPatch(state)
  }
  const slot = state.slots[next]
  if (!slot) return
  applyPatch(state, slot.patch)
  state.programIndex = next
  state.page = Math.floor(next / 8)
  state.dirty = false
  state.loadedPatch = extractPatch(slot.patch)
  state.listView = false
  state.storeMode = 'off'
}

export function selectLive(state: InstrumentState, index: number): void {
  const next = ((index % 8) + 8) % 8
  if (state.storeMode === 'dest') {
    state.storeDest = next
    return
  }
  if (state.dirty && !state.liveMode) state.undoPatch = extractPatch(state)
  const slot = state.liveSlots[next]
  if (!slot) return
  applyPatch(state, slot.patch)
  state.liveIndex = next
  state.dirty = false
  state.loadedPatch = extractPatch(slot.patch)
  state.storeMode = 'off'
}

export function toggleLiveMode(state: InstrumentState, on: boolean): void {
  if (on === state.liveMode) return
  if (on) {
    if (state.dirty) state.undoPatch = extractPatch(state)
    state.liveMode = true
    selectLive(state, state.liveIndex)
  } else {
    state.liveMode = false
    selectProgram(state, state.programIndex, true)
  }
}

export function beginStore(state: InstrumentState, asNew: boolean): void {
  if (state.storeMode === 'off') {
    state.storeDest = state.liveMode ? state.liveIndex : state.programIndex
    state.storeName = currentSlot(state).name
    state.nameCursor = state.storeName.length
    state.storeMode = asNew ? 'name' : 'dest'
    return
  }
  if (state.storeMode === 'name') {
    state.storeMode = 'dest'
    return
  }
  commitStore(state)
}

export function commitStore(state: InstrumentState): void {
  const patch = extractPatch(state)
  const name = state.storeName.trim() || 'User'
  if (state.liveMode && state.storeDest < 8) {
    state.liveSlots[state.storeDest] = { name, patch }
    state.liveIndex = state.storeDest
  } else {
    const dest = state.storeDest % 32
    state.slots[dest] = { name, patch: cloneJson(patch) }
    state.programIndex = dest
    state.page = Math.floor(dest / 8)
    state.liveMode = false
  }
  state.loadedPatch = extractPatch(patch)
  state.dirty = false
  state.storeMode = 'off'
  state.listView = false
}

export function cancelStore(state: InstrumentState): void {
  state.storeMode = 'off'
  state.listView = false
  state.clockHold = false
  state.morphLatch = 'off'
  state.splitEdit = 'off'
}

export function undoProgram(state: InstrumentState): boolean {
  if (!state.undoPatch) return false
  applyPatch(state, state.undoPatch)
  state.dirty = !patchesEqual(state, state.loadedPatch)
  state.undoPatch = null
  if (state.liveMode) markDirty(state)
  return true
}

export function currentSlot(state: InstrumentState): { name: string; patch: ProgramPatch } {
  if (state.liveMode) return state.liveSlots[state.liveIndex] ?? { name: 'Live', patch: extractPatch(state) }
  return state.slots[state.programIndex] ?? { name: 'Init', patch: extractPatch(state) }
}

export function editNameChar(state: InstrumentState, delta: number): void {
  const chars = NAME_CHARS
  let name = state.storeName
  const i = Math.min(name.length, Math.max(0, state.nameCursor))
  if (name.length === 0) {
    state.storeName = chars[((delta % chars.length) + chars.length) % chars.length].trim() || 'A'
    state.nameCursor = 1
    return
  }
  const idx = i >= name.length ? name.length - 1 : i
  const cur = name[idx] ?? 'A'
  const at = chars.indexOf(cur)
  const next = chars[((at + delta) % chars.length + chars.length) % chars.length]
  state.storeName = name.slice(0, idx) + next + name.slice(idx + 1)
}

export function insertNameChar(state: InstrumentState): void {
  const i = Math.min(state.storeName.length, Math.max(0, state.nameCursor))
  if (state.storeName.length >= 16) return
  state.storeName = `${state.storeName.slice(0, i)}A${state.storeName.slice(i)}`
  state.nameCursor = i + 1
}

export function deleteNameChar(state: InstrumentState): void {
  if (state.storeName.length === 0) return
  const i = Math.min(state.storeName.length, Math.max(1, state.nameCursor))
  state.storeName = state.storeName.slice(0, i - 1) + state.storeName.slice(i)
  state.nameCursor = Math.max(0, i - 1)
}

export function switchScene(state: InstrumentState, scene: SceneId): void {
  if (scene === state.scene) return
  if (state.scene === 'I') state.sceneI = captureEnables(state)
  else state.sceneII = captureEnables(state)
  state.scene = scene
  applyEnables(state, scene === 'I' ? state.sceneI : state.sceneII)
  markDirty(state)
}

export function tapClock(state: InstrumentState, timeSec: number): void {
  const taps = state.clockTaps ?? []
  const recent = taps.filter((t) => timeSec - t < 2.5)
  recent.push(timeSec)
  state.clockTaps = recent
  if (recent.length >= 4) {
    let sum = 0
    for (let i = 1; i < recent.length; i++) sum += recent[i] - recent[i - 1]
    const interval = sum / (recent.length - 1)
    const bpm = 60 / interval
    state.clockBpm = Math.min(300, Math.max(30, bpm))
    markDirty(state)
  }
}
