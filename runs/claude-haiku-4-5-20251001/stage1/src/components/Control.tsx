import React, { useState } from 'react'
import { Control as ControlType } from '../types/hardware'
import Knob from './controls/Knob'
import Fader from './controls/Fader'
import Button from './controls/Button'
import LED from './controls/LED'
import Drawbar from './controls/Drawbar'
import Encoder from './controls/Encoder'
import OLED from './controls/OLED'
import Stick from './controls/Stick'
import Wheel from './controls/Wheel'
import Label from './controls/Label'
import './Control.css'

interface Props {
  control: ControlType
}

/**
 * Generic control dispatcher that renders the appropriate control type
 */
export const Control: React.FC<Props> = ({ control }) => {
  const [value, setValue] = useState(control.value ?? 0)

  const handleChange = (newValue: number) => {
    const min = control.min ?? 0
    const max = control.max ?? 100
    const clamped = Math.max(min, Math.min(max, newValue))
    setValue(clamped)
  }

  const commonProps = {
    id: control.id,
    label: control.label,
    value,
    onChange: handleChange,
    min: control.min,
    max: control.max,
    ariaLabel: control.ariaLabel,
    ariaRole: control.ariaRole,
  }

  switch (control.type) {
    case 'knob':
      return <Knob {...commonProps} />
    case 'fader':
      return <Fader {...commonProps} />
    case 'button':
      return <Button {...commonProps} />
    case 'led':
      return <LED {...commonProps} />
    case 'drawbar':
      return <Drawbar {...commonProps} />
    case 'encoder':
      return <Encoder {...commonProps} />
    case 'oled':
      return <OLED {...commonProps} />
    case 'stick':
      return <Stick {...commonProps} />
    case 'wheel':
      return <Wheel {...commonProps} />
    case 'label':
      return <Label label={control.label} />
    default:
      return null
  }
}

export default Control
