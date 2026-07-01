import { hardwareModel, visualsSpec } from './hardware'
import Keyboard from './components/Keyboard'
import './App.css'

export default function App() {
  return (
    <div className="app" style={{ backgroundColor: '#e8e8e8' }}>
      <div
        className="instrument"
        style={{
          backgroundColor: visualsSpec.chassisMid,
          aspectRatio: '3.095 / 1',
        }}
      >
        {/* Control deck */}
        <div className="control-deck">
          <div className="branding">Nord Stage 4</div>

          {hardwareModel.sections.map(section => (
            <div
              key={section.id}
              className={`section ${section.id}`}
              style={{ flex: section.widthFraction }}
            >
              <h3>{section.label}</h3>
              <div className="controls">
                {section.controls.map(control => (
                  <div key={control.id} className="control">
                    <span className="control-label">{control.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Keyboard */}
        <div className="keybed">
          <Keyboard model={hardwareModel.keyboard} />
        </div>
      </div>
    </div>
  )
}
