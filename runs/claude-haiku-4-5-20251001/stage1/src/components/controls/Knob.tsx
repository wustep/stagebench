import React, { useRef, useState } from 'react'
import './Knob.css'

interface KnobProps {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  ariaLabel?: string
}

/**
 * Rotary knob control
 */
export const Knob: React.FC<KnobProps> = ({
  id,
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  ariaLabel,
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const range = max - min
  const percentage = ((value - min) / range) * 100
  const rotation = (percentage / 100) * 270 - 135 // 270 degree range, centered at -135

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (!ref.current) return

    const rect = ref.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    const dx = e.clientX - centerX
    const dy = e.clientY - centerY

    let angle = Math.atan2(dy, dx) * (180 / Math.PI)
    angle = (angle + 90 + 360) % 360

    // Map angle (0-360) to value range with 270-degree range
    let normalizedAngle = angle - 45
    if (normalizedAngle < 0) normalizedAngle += 360

    const percentage = (normalizedAngle / 270) * 100
    const newValue = min + (percentage / 100) * range
    onChange(Math.max(min, Math.min(max, newValue)))
  }, [min, max, range, onChange])

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  return (
    <div className="control knob-control">
      <div
        ref={ref}
        className="knob"
        onMouseDown={handleMouseDown}
        role="slider"
        aria-label={ariaLabel || label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-control-id={id}
      >
        <div className="knob-body">
          <div
            className="knob-pointer"
            style={{
              transform: `rotate(${rotation}deg)`,
            }}
          ></div>
        </div>
      </div>
      <label className="control-label">{label}</label>
    </div>
  )
}

export default Knob
