import { render } from '@testing-library/react'
import App from '../App'
import { fakeAudioBoundary, FakeMidiAccess, fakeMidiBoundary, type FakeAudioSetup } from './fakes'
import type { MidiBoundary } from '../audio/boundaries'

export interface RenderedApp extends FakeAudioSetup {
  view: ReturnType<typeof render>
  midiAccess: FakeMidiAccess
}

export function renderApp(midiBoundary?: MidiBoundary): RenderedApp {
  const setup = fakeAudioBoundary()
  const midiAccess = new FakeMidiAccess()
  const view = render(<App audioBoundary={setup.boundary} midiBoundary={midiBoundary ?? fakeMidiBoundary(midiAccess)} />)
  return { ...setup, view, midiAccess }
}
