/**
 * Injectable timing boundary. Tests pass a manual clock; the browser passes the
 * platform one. Nothing in the note lifecycle calls `Date.now` or `setTimeout` directly.
 */
export interface Clock {
  now(): number
  setTimeout(handler: () => void, ms: number): number
  clearTimeout(handle: number): void
}

export const systemClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
}

/** Manual clock used by tests: nothing fires until `advance` is called. */
export interface ManualClock extends Clock {
  advance(ms: number): void
  readonly pending: number
}

export function createManualClock(start = 0): ManualClock {
  let current = start
  let nextHandle = 1
  const timers = new Map<number, { at: number; handler: () => void }>()

  return {
    now: () => current,
    setTimeout(handler, ms) {
      const handle = nextHandle
      nextHandle += 1
      timers.set(handle, { at: current + Math.max(0, ms), handler })
      return handle
    },
    clearTimeout(handle) {
      timers.delete(handle)
    },
    advance(ms) {
      const target = current + ms
      for (;;) {
        let dueHandle = -1
        let dueAt = Number.POSITIVE_INFINITY
        for (const [handle, timer] of timers) {
          if (timer.at <= target && timer.at < dueAt) {
            dueAt = timer.at
            dueHandle = handle
          }
        }
        if (dueHandle === -1) break
        const timer = timers.get(dueHandle)
        timers.delete(dueHandle)
        current = timer ? timer.at : current
        timer?.handler()
      }
      current = target
    },
    get pending() {
      return timers.size
    },
  }
}
