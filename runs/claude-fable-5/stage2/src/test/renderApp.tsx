import { render } from '@testing-library/react'
import App from '../App'
import { fakeAssetBoundary, fakeAudioBoundary, FakeMidiAccess, fakeMidiBoundary, type FakeAudioSetup } from './fakes'
import type { AssetBoundary, MidiBoundary } from '../audio/boundaries'

export interface RenderedApp extends FakeAudioSetup {
  view: ReturnType<typeof render>
  midiAccess: FakeMidiAccess
  assets: AssetBoundary & { loaded: string[] }
}

export function renderApp(midiBoundary?: MidiBoundary, assets?: AssetBoundary & { loaded: string[] }): RenderedApp {
  const setup = fakeAudioBoundary()
  const midiAccess = new FakeMidiAccess()
  const assetBoundary = assets ?? fakeAssetBoundary()
  const view = render(
    <App
      audioBoundary={setup.boundary}
      midiBoundary={midiBoundary ?? fakeMidiBoundary(midiAccess)}
      assetBoundary={assetBoundary}
      panelClock={() => setup.timers.now}
    />,
  )
  return { ...setup, view, midiAccess, assets: assetBoundary }
}
