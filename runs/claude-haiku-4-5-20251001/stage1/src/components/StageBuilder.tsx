import React from 'react'
import Keyboard from './Keyboard'
import ControlDeck from './ControlDeck'
import './StageBuilder.css'

interface StageBuilderProps {
  scale?: number
}

/**
 * Main Stage Builder component assembles the complete Nord Stage 4 88
 * with continuous red chassis, control deck (54%), and keybed (46%)
 */
export const StageBuilder: React.FC<StageBuilderProps> = ({ scale = 1 }) => {
  return (
    <div className="stage-builder-container">
      <div className="stage-builder" style={{ transform: `scale(${scale})` }}>
        {/* Continuous red chassis container */}
        <div className="chassis-container">
          {/* Top red rail */}
          <div className="top-rail"></div>

          {/* Left end cheek */}
          <div className="left-cheek"></div>

          {/* Control deck section (54% of height) */}
          <div className="control-deck-section">
            <ControlDeck />
          </div>

          {/* Keybed section (46% of height) */}
          <div className="keybed-section">
            <Keyboard />
          </div>

          {/* Right end cheek */}
          <div className="right-cheek"></div>

          {/* Bottom red lip */}
          <div className="bottom-lip"></div>
        </div>
      </div>
    </div>
  )
}

export default StageBuilder
