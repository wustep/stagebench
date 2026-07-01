import { useEffect, useRef } from 'react'
import { hardwareModel, visualsSpec } from './hardware'
import Keyboard from './components/Keyboard'
import { AudioContextProvider } from './audio/audioContext'
import { PianoEngine } from './audio/pianoEngine'
import { InputHandler } from './audio/inputHandler'
import './App.css'

export default function App() {
  const engineRef = useRef<{
    contextProvider: AudioContextProvider
    pianoEngine: PianoEngine
    inputHandler: InputHandler
    cleanups: Array<() => void>
  } | null>(null)

  useEffect(() => {
    // Initialize audio engine on mount
    const initializeAudio = async () => {
      try {
        // Create AudioContext provider
        const contextProvider = AudioContextProvider.create()

        // Create Piano Engine
        const engine = new PianoEngine({
          maxVoices: 32,
          masterVolume: 0.8,
          reverbWet: 0.3,
          sustain: false,
          touchCurve: 'medium',
          dynamicCompression: 1,
          timbre: 'bright',
          unison: 0,
        })

        // Initialize engine with audio context
        await engine.initialize(contextProvider)

        // Create InputHandler with NoteLifecycleService
        const noteLifecycle = engine.getLifecycleService()
        const handler = new InputHandler(noteLifecycle)

        // Attach input handlers
        const cleanups: Array<() => void> = []

        // Attach keyboard input
        cleanups.push(handler.attachKeyboard())

        // Try to attach MIDI (non-blocking)
        handler.attachMIDI().then(midiCleanup => {
          if (midiCleanup) {
            cleanups.push(midiCleanup)
          }
        }).catch(err => {
          console.warn('MIDI attachment failed:', err)
        })

        // Store references for cleanup
        engineRef.current = {
          contextProvider,
          pianoEngine: engine,
          inputHandler: handler,
          cleanups,
        }


        // Resume audio context on user interaction
        document.addEventListener('click', () => {
          contextProvider.resume().catch(err => {
            console.error('Failed to resume audio context:', err)
          })
        }, { once: true })
      } catch (error) {
        console.error('Failed to initialize audio engine:', error)
      }
    }

    initializeAudio()

    // Cleanup on unmount
    return () => {
      if (engineRef.current) {
        const { pianoEngine, cleanups } = engineRef.current

        // Run all cleanup functions
        for (const cleanup of cleanups) {
          try {
            cleanup()
          } catch (err) {
            console.error('Cleanup error:', err)
          }
        }

        // All notes off
        pianoEngine.allNotesOff()

        // Dispose audio engine
        pianoEngine.dispose()

        engineRef.current = null
      }
    }
  }, [])

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
          <Keyboard model={hardwareModel.keyboard} inputHandler={engineRef.current?.inputHandler} />
        </div>
      </div>
    </div>
  )
}
