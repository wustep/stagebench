import React from 'react'
import './OLED.css'

interface OLEDProps {
  id: string
  label: string
  value?: number
  ariaLabel?: string
}

export const OLED: React.FC<OLEDProps> = ({ id, label, ariaLabel }) => {
  return (
    <div
      className="oled"
      role="status"
      aria-label={ariaLabel || label}
      data-control-id={id}
    >
      <div className="oled-display">
        <div className="oled-content">
          <span className="oled-text">{label}</span>
        </div>
      </div>
    </div>
  )
}

export default OLED
