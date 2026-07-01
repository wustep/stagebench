import React, { useRef, useState } from 'react'
import './Wheel.css'

interface WheelProps {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  ariaLabel?: string
}

export const Wheel: React.FC<WheelProps> = ({
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
  const rotation = (percentage / 100) * 360

  const handleMouseDown = () => {
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

    const newValue = min + (angle / 360) * range
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
    <div className="control wheel-control">
      <div
        ref={ref}
        className="wheel"
        role="slider"
        aria-label={ariaLabel || label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-control-id={id}
        onMouseDown={handleMouseDown}
      >
        <div
          className="wheel-surface"
          style={{
            transform: `rotate(${rotation}deg)`,
          }}
        >
          <div className="wheel-grip"></div>
          <div className="wheel-grip"></div>
          <div className="wheel-grip"></div>
          <div className="wheel-grip"></div>
        </div>
      </div>
      <label className="control-label">{label}</label>
    </div>
  )
}

export default Wheel
