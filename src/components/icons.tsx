// Small inline SVG glyphs and the status light used across the gallery.
import type { RunEntry, StageStatus } from '../types'

export function StatusLight({ status }: { status: StageStatus | RunEntry['status'] | 'off' }) {
  return <span className={`status-light status-${status}`} aria-hidden="true" />
}

export function PlayIcon() {
  return (
    <svg className="play-icon" viewBox="0 0 10 12" width="10" height="12" aria-hidden="true">
      <path d="M0 0l10 6-10 6z" fill="currentColor" />
    </svg>
  )
}

export function ChevronIcon() {
  return (
    <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function InfoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7v4.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.6" r="1" fill="currentColor" />
    </svg>
  )
}

export function ReportIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <rect x="1" y="6.5" width="2.3" height="4.5" rx=".5" fill="currentColor" />
      <rect x="4.85" y="3.5" width="2.3" height="7.5" rx=".5" fill="currentColor" />
      <rect x="8.7" y="1" width="2.3" height="10" rx=".5" fill="currentColor" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M1 1l10 10M11 1L1 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
