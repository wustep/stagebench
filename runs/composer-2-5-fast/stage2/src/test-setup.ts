import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// node-web-audio-api emits plain objects; jsdom requires real Event instances.
const nativeDispatch = EventTarget.prototype.dispatchEvent
EventTarget.prototype.dispatchEvent = function dispatchEvent(event: Event) {
  if (!(event instanceof Event)) return true
  try {
    return nativeDispatch.call(this, event)
  } catch {
    return true
  }
}

import { AudioContext, OfflineAudioContext } from 'node-web-audio-api'

Object.assign(globalThis, {
  AudioContext,
  OfflineAudioContext,
  webkitAudioContext: AudioContext,
})

afterEach(() => cleanup())
