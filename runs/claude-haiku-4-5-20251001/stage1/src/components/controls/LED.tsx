import React from 'react'
import './LED.css'

interface LEDProps {
  id: string
  label: string
  value?: number
  ariaLabel?: string
}

export const LED: React.FC<LEDProps> = ({ id, label, value = 0, ariaLabel }) => {
  const isOn = (value ?? 0) > 0

  return (
    <div className="control led-control">
      <div
        className={`led ${isOn ? 'on' : 'off'}`}
        role="status"
        aria-label={ariaLabel || label}
        data-control-id={id}
      ></div>
      <label className="control-label">{label}</label>
    </div>
  )
}

export default LED
