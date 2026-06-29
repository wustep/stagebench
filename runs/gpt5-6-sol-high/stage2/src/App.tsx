import { Keyboard } from './components/Keyboard'
import { Panel } from './components/Panel'
import { usePianoInstrument } from './hooks/usePianoInstrument'

export default function App() {
  const piano = usePianoInstrument()
  return (
    <main className="stage">
      <header className="page-header">
        <div><span className="eyebrow">PLAYABLE PIANO INSTRUMENT</span><h1>Stage 4 <em>73</em></h1></div>
        <p>Play Z–M / Q–P · hold space to sustain · shift for forte</p>
      </header>
      <div className="instrument-frame">
        <div className="instrument" aria-label="Nord Stage 4 73 visual recreation">
          <div className="end-cheek left" />
          <div className="end-cheek right" />
          <Panel piano={piano.state} controls={piano.controls} />
          <Keyboard activeNotes={piano.activeNotes} onNoteOn={piano.noteOn} onNoteOff={piano.noteOff} />
          <div className="front-lip"><span>nord stage 4 compact</span><b>73</b></div>
        </div>
      </div>
      <footer className="performance-status" aria-live="polite">
        <span>{piano.state.status}</span>
        <button type="button" onClick={() => piano.allNotesOff(true)}>ALL NOTES OFF</button>
        <span>{piano.state.midiStatus}</span>
      </footer>
    </main>
  )
}
