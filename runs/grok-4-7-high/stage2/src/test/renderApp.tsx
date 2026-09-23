import { render } from '@testing-library/react'
import App, { type AppProps } from '../App'

export function renderApp(props?: AppProps) {
  return render(<App {...props} />)
}
