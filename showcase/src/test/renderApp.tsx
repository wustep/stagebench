import { render } from '@testing-library/react'
import App from '../App'
import {
  fakeAssetBoundary,
  fakeAudioBoundary,
  FakeMidiAccess,
  fakeMidiBoundary,
  fakeStorageBoundary,
  type FakeAudioSetup,
} from './fakes'
import type { AssetBoundary, MidiBoundary, StorageBoundary } from '../audio/boundaries'

export interface RenderedApp extends FakeAudioSetup {
  view: ReturnType<typeof render>
  midiAccess: FakeMidiAccess
  assets: AssetBoundary & { loaded: string[] }
  storage: StorageBoundary & { data: Map<string, string> }
}

export function renderApp(
  midiBoundary?: MidiBoundary,
  assets?: AssetBoundary & { loaded: string[] },
  storage?: StorageBoundary & { data: Map<string, string> },
): RenderedApp {
  const setup = fakeAudioBoundary()
  const midiAccess = new FakeMidiAccess()
  const assetBoundary = assets ?? fakeAssetBoundary()
  // Fresh in-memory storage per render keeps program persistence
  // deterministic and isolated between tests.
  const storageBoundary = storage ?? fakeStorageBoundary()
  const view = render(
    <App
      audioBoundary={setup.boundary}
      midiBoundary={midiBoundary ?? fakeMidiBoundary(midiAccess)}
      assetBoundary={assetBoundary}
      storageBoundary={storageBoundary}
      panelClock={() => setup.timers.now}
    />,
  )
  return { ...setup, view, midiAccess, assets: assetBoundary, storage: storageBoundary }
}
