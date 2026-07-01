import React, { useRef, useState } from 'react'
import './Stick.css'

interface StickProps {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  ariaLabel?: string
}

export const Stick: React.FC<StickProps> = ({
  id,
  label,
  value,
  onChange,
  min = -12,
  max = 12,
  ariaLabel,
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const range = max - min
  const percentage = ((value - min) / range) * 100
  const yPosition = (percentage / 100) * 100 - 50

  const handleMouseDown = () => {
    setIsDragging(true)
  }

  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (!ref.current) return

    const trackRect = ref.current.getBoundingClientRect()
    const y = e.clientY - trackRect.top
    const newPercentage = Math.max(0, Math.min(100, (y / trackRect.height) * 100))
    const newValue = min + (newPercentage / 100) * range
    onChange(newValue)
  }, [min, range, onChange])

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
    <div className="control stick-control">
      <div
        ref={ref}
        className="stick"
        role="slider"
        aria-label={ariaLabel || label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-control-id={id}
        onMouseDown={handleMouseDown}
      >
        <div className="stick-track">
          <div className="stick-center-line"></div>
          <div
            className="stick-thumb"
            style={{ transform: `translateY(${yPosition}%)` }}
          ></div>
        </div>
      </div>
      <label className="control-label">{label}</label>
    </div>
  )
}

export default Stick
