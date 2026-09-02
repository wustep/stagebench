import type { LedColor } from '../../hardware/controls'

export function Led({ lit, color = 'red', legend, className = '', side = 'right', small = false }: { lit?: boolean; color?: LedColor; legend?: string; className?: string; side?: 'right' | 'left' | 'below' | 'above'; small?: boolean }) {
  return (
    <span className={`led-wrap led-${side} ${className}`}>
      <i className={`led led-${color}${lit ? ' lit' : ''}${small ? ' led-small' : ''}`} aria-hidden="true" />
      {legend ? <span className="lgd">{legend}</span> : null}
    </span>
  )
}

/** Vertical LED ladder used next to faders (green, 12 steps) and drawbars (red, 8 steps with numbers). */
export function LedLadder({ steps, litSteps, color, numbered = false, from = 'bottom' }: { steps: number; litSteps: number; color: LedColor; numbered?: boolean; from?: 'bottom' | 'top' }) {
  const items = []
  for (let i = 0; i < steps; i++) {
    const index = from === 'bottom' ? steps - 1 - i : i
    const lit = index < litSteps
    items.push(
      <span key={i} className="ladder-step">
        {numbered ? <span className="ladder-num">{index + 1}</span> : null}
        <i className={`ladder-led ladder-${color}${lit ? ' lit' : ''}`} />
      </span>,
    )
  }
  return (
    <span className={`ladder ladder-wrap-${color}`} aria-hidden="true">
      {items}
    </span>
  )
}
