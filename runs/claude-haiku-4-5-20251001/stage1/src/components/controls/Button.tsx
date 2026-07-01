import React, { useState } from 'react'
import './Button.css'

interface ButtonProps {
  id: string
  label: string
  value?: number
  onChange?: (value: number) => void
  ariaLabel?: string
}

export const Button: React.FC<ButtonProps> = ({
  id,
  label,
  value,
  onChange,
  ariaLabel,
}) => {
  const [isPressed, setIsPressed] = useState(false)

  const handleMouseDown = () => {
    setIsPressed(true)
    if (onChange) onChange((value ?? 0) === 0 ? 1 : 0)
  }

  const handleMouseUp = () => {
    setIsPressed(false)
  }

  return (
    <div className="control button-control">
      <button
        className={`button ${isPressed ? 'pressed' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        aria-label={ariaLabel || label}
        aria-pressed={isPressed}
        data-control-id={id}
      >
        <span className="button-label-inner">{label}</span>
      </button>
      <label className="control-label">{label}</label>
    </div>
  )
}

export default Button
