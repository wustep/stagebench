import { Keyboard } from './components/Keyboard'
import { Panel } from './components/Panel'

export default function App() {
  return (
    <main className="stage">
      <header className="page-header">
        <div><span className="eyebrow">INTERACTIVE HARDWARE STUDY</span><h1>Stage 4 <em>73</em></h1></div>
        <p>Drag controls vertically · use arrow keys when focused · press any key</p>
      </header>
      <div className="instrument-frame">
        <div className="instrument" aria-label="Nord Stage 4 73 visual recreation">
          <div className="end-cheek left" />
          <div className="end-cheek right" />
          <Panel />
          <Keyboard />
          <div className="front-lip"><span>nord stage 4 compact</span><b>73</b></div>
        </div>
      </div>
      <footer><span>VISUAL RECREATION · STAGE 1</span><span>NO AUDIO OUTPUT</span></footer>
    </main>
  )
}
