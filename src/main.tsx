import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react'
import './index.css'
import App from './App.tsx'

function analyticsBeforeSend(event: BeforeSendEvent) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('va-disable')) {
      return null
    }
  } catch {
    // localStorage can be missing or throw (privacy mode / non-browser).
  }
  return event
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Analytics beforeSend={analyticsBeforeSend} />
  </StrictMode>,
)
