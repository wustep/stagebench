import React, { useRef, useState } from 'react'
import './Drawbar.css'

interface DrawbarProps {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  ariaLabel?: string
}

export const Drawbar: React.FC<DrawbarProps> = ({
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

  const handleMouseDown = () => {
    setIsDragging(true)
  }

  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (!ref.current) return

    const trackRect = ref.current.querySelector('.drawbar-track') as HTMLElement
    if (!trackRect) return

    const trackRect2 = trackRect.getBoundingClientRect()
    const y = e.clientY - trackRect2.top
    const newPercentage = Math.max(0, Math.min(100, (y / trackRect2.height) * 100))
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
    <div className="control drawbar-control">
      <div
        ref={ref}
        className="drawbar"
        role="slider"
        aria-label={ariaLabel || label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-control-id={id}
        onMouseDown={handleMouseDown}
      >
        <div className="drawbar-track">
          <div className="drawbar-slider" style={{ top: `${percentage}%` }}></div>
        </div>
      </div>
    </div>
  )
}

export default Drawbar
