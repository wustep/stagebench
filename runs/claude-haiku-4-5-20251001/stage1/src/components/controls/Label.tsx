import React from 'react'
import './Label.css'

interface LabelProps {
  label: string
}

export const Label: React.FC<LabelProps> = ({ label }) => {
  return (
    <div className="label-control">
      <span className="label-text">{label}</span>
    </div>
  )
}

export default Label
