import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Bundled OFL faces (SIL OFL 1.1) — vite inlines the woff2 into dist so the
// panel renders identically offline, with no runtime dependency on a system
// font or a network font host:
// - Comfortaa: the rounded "nord stage 4" logotype
// - Michroma: Eurostile/Microgramma-like square tech face for the section
//   and box titles (LAYER EFFECTS, FX FOCUS, MOD 1…)
// - Roboto Condensed: the bold condensed grotesque for all panel legends
// - Doto: dot-matrix face for the OLED displays
import '@fontsource/comfortaa/700.css'
import '@fontsource/michroma/400.css'
import '@fontsource/roboto-condensed/700.css'
import '@fontsource/doto/500.css'
import '@fontsource/doto/700.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
