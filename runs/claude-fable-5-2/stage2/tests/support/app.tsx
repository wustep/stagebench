import { act, render, type RenderResult } from '@testing-library/react'
import App from '../../src/App'
import { createFakePlatform, flush, type FakePlatform } from './fakes'

export interface MountedApp extends RenderResult {
  fake: FakePlatform
  /** Let async engine/MIDI start-up finish and React re-render. */
  settle(): Promise<void>
  key(note: number): HTMLElement
  control(id: string): HTMLElement
}

/** Mounts the real App against fake platform boundaries. */
export function mountApp(configure?: (fake: FakePlatform) => void): MountedApp {
  const fake = createFakePlatform()
  configure?.(fake)
  const result = render(<App platform={fake.platform} />)
  // Looked up inside this app's own container, so two apps mounted side by side stay separate.
  const find = (id: string) => {
    const element = result.container.querySelector<HTMLElement>(`[id="${id}"]`)
    if (!element) throw new Error(`No element #${id}`)
    return element
  }
  return {
    ...result,
    fake,
    settle: async () => {
      await act(async () => {
        await flush()
      })
    },
    key: (note) => find(`key-${note}`),
    control: find,
  }
}
