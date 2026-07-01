import React from 'react'
import { STAGE_4_88_HARDWARE_MAP } from '../data/hardwareMap'
import ControlSection from './ControlSection'
import './ControlDeck.css'

/**
 * Control Deck renders all six hardware sections with proper proportions and materials
 */
export const ControlDeck: React.FC = () => {
  return (
    <div className="control-deck">
      {STAGE_4_88_HARDWARE_MAP.sections.map((section) => (
        <ControlSection
          key={section.id}
          section={section}
          widthFraction={section.widthFraction}
        />
      ))}
    </div>
  )
}

export default ControlDeck
