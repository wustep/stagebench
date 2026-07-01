import React from 'react'
import { ControlSection as ControlSectionType } from '../types/hardware'
import Control from './Control'
import './ControlSection.css'

interface Props {
  section: ControlSectionType
  widthFraction: number
}

/**
 * A single section of the control deck (Performance, Organ, Piano, etc.)
 */
export const ControlSection: React.FC<Props> = ({ section, widthFraction }) => {
  const widthPercent = widthFraction * 100

  return (
    <div
      className={`control-section control-section-${section.id} surface-${section.surface}`}
      style={{ width: `${widthPercent}%` }}
      role="region"
      aria-label={section.label}
    >
      {/* Red perimeter when using dark plate */}
      {section.surface === 'dark-plate' && (
        <div className="dark-plate-perimeter"></div>
      )}

      {/* Section content */}
      <div className="section-content">
        {section.controls.map((control) => (
          <Control key={control.id} control={control} />
        ))}
      </div>
    </div>
  )
}

export default ControlSection
