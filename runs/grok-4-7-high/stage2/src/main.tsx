import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource/comfortaa/700.css'
import '@fontsource/days-one/400.css'
import '@fontsource/roboto-condensed/700.css'
import '@fontsource/doto/500.css'
import '@fontsource/doto/700.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
