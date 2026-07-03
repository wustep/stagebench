import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Bundled OFL rounded logotype face (Comfortaa, SIL OFL 1.1) — vite inlines
// the woff2 into dist so the brand-line renders identically offline, with no
// runtime dependency on a system font or a network font host.
import '@fontsource/comfortaa/700.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
