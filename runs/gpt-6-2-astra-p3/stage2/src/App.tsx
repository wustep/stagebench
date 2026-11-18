import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Live, type Mutate } from './bindings'
import { defaults, models } from './settings'
import { Editor } from './Editor'
import { Instrument } from './Instrument'
import { connectInputs } from './inputs'
import { Grand, browserAudio, type AudioBoundary } from './piano'

function Book() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M12 5Q7 2 2 4v15q6-2 10 1 4-3 10-1V4q-6-2-10 1v15" />
    </svg>
  )
}
const requestMidi = () => navigator.requestMIDIAccess?.()
export default function App({
  boundary = browserAudio,
  midi = requestMidi,
}: {
  boundary?: AudioBoundary
  midi?: () => Promise<MIDIAccess> | undefined
}) {
  const [sound, setSound] = useState('Loading samples'),
    [midiState, setMidi] = useState('Connecting')
  const [pressed, setPressed] = useState(new Set<number>()),
    [sustain, setSustain] = useState(false)
  const [zoom, setZoom] = useState(1),
    [source, setSource] = useState('guide')
  const piano = useRef<Grand | null>(null),
    dialog = useRef<HTMLDialogElement>(null)
  const [settings, setSettings] = useState(defaults)
  const current = useRef(settings)
  const change = useCallback<Mutate>((fn) => {
    const next = structuredClone(current.current)
    fn(next)
    current.current = next
    piano.current?.apply(next)
    setSettings(next)
  }, [])
  useEffect(() => {
    const model = new Grand(setSound, boundary, () => {
      setPressed(model.pressed)
      setSustain(model.sustained)
    })
    model.settings = current.current
    piano.current = model
    void model.load()
    const disconnect = connectInputs(
      window,
      model,
      () => model.unlock(),
      midi,
      setMidi,
    )
    return () => {
      disconnect()
      model.dispose()
      piano.current = null
    }
  }, [boundary, midi])
  const open = (page: string) => {
    piano.current?.clear()
    if (page === 'edit' && current.current.target !== 'Piano')
      change((s) => {
        s.target = 'Piano'
      })
    setSource(page)
    dialog.current?.showModal()
  }
  const focusSound =
    piano.current?.modelState(settings.layers[settings.focus].type) ?? sound
  const live = useMemo(
    () => ({ settings, change, sound: focusSound, feedback: '' }),
    [settings, change, focusSound],
  )
  return (
    <Live.Provider value={live}>
      <div className="studio">
        <header>
          <div className="identity">
            <span className="brandmark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            Keyroom
          </div>
          <span className="header-line" />
          <span className="studio-name">Instrument studio</span>
          <button className="guide" onClick={() => open('guide')}>
            <Book />
            Playing guide
          </button>
        </header>
        <main>
          <div className="titlebar">
            <div>
              <div className="category">
                <span />
                STAGE KEYBOARD
              </div>
              <h1>
                Nord Stage 4 <em>73</em>
              </h1>
            </div>
            <div className="zoom" aria-label="Instrument magnification">
              <button
                aria-label="Zoom out"
                disabled={zoom === 1}
                onClick={() => setZoom((v) => Math.max(1, v - 0.5))}
              >
                −
              </button>
              <output>{zoom * 100}%</output>
              <button
                aria-label="Zoom in"
                disabled={zoom === 4}
                onClick={() => setZoom((v) => Math.min(4, v + 0.5))}
              >
                +
              </button>
            </div>
          </div>
          <div className="viewport">
            <div
              className="instrument-wrap"
              style={{ width: zoom * 100 + '%' }}
            >
              <Instrument piano={piano.current} pressed={pressed} />
            </div>
          </div>
          <div className="spec-strip">
            <span>
              <b>73</b> keys <i /> Hammer action
            </span>
            <span>E1 — E7</span>
          </div>
          <section className="session" aria-label="Playing status">
            <button
              className="voice edit-voice"
              onClick={() => open('edit')}
              title="Edit piano layers and effects"
            >
              <span className="voice-icon" aria-hidden="true">
                ♩
              </span>
              <div>
                <small>PIANO {settings.focus === 0 ? 'A' : 'B'} · EDIT ↗</small>
                <strong>
                  {focusSound.includes('fallback')
                    ? 'Synthesized piano'
                    : models[settings.layers[settings.focus].type]}
                </strong>
              </div>
            </button>
            <div>
              <small>AUDIO ENGINE</small>
              <span className="status">
                <i className={sound === 'Piano ready' ? 'green' : ''} />
                {sound}
              </span>
            </div>
            <div>
              <small>MIDI INPUT</small>
              <span className="status">
                <i
                  className={
                    midiState.includes('connected') &&
                    !midiState.startsWith('Dis')
                      ? 'green'
                      : ''
                  }
                />
                {midiState}
              </span>
            </div>
            <button
              className={'pedal ' + (sustain ? 'engaged' : '')}
              aria-pressed={sustain}
              onClick={() => {
                piano.current?.pedal(
                  'switch',
                  !piano.current.hasPedal('switch'),
                )
              }}
            >
              <span className="switch">
                <i />
              </span>
              Sustain
            </button>
          </section>
          <footer>
            <span>
              <kbd>A</kbd> – <kbd>K</kbd> Play notes <i /> <kbd>Space</kbd>{' '}
              Sustain
            </span>
            <button onClick={() => open('credits')}>
              Sample credits <span>↗</span>
            </button>
          </footer>
        </main>
        <dialog
          aria-label={
            source === 'edit'
              ? 'Piano layer editor'
              : source === 'guide'
                ? 'Playing guide'
                : 'Sample credits'
          }
          ref={dialog}
          onClick={(e) => {
            if (e.target === dialog.current) dialog.current?.close()
          }}
        >
          <div className="dialog-body">
            <div className="dialog-top">
              <small>KEYROOM</small>
              <button
                aria-label="Close"
                onClick={() => dialog.current?.close()}
              >
                ×
              </button>
            </div>
            {source === 'edit' ? (
              <Editor />
            ) : source === 'guide' ? (
              <>
                <h2>Playing guide</h2>
                <p>
                  Click or touch the keys to play the selected piano layers. Use
                  the zoom controls to inspect the panel, then scroll across the
                  instrument.
                </p>
                <h3>Computer keyboard</h3>
                <p>
                  Play white keys from C4 to E5 with{' '}
                  <kbd>A S D F G H J K L ;</kbd>. The black keys are{' '}
                  <kbd>W E T Y U O P</kbd>. Hold <kbd>Space</kbd> for sustain.
                </p>
                <h3>MIDI</h3>
                <p>
                  Allow MIDI access and click anywhere to enable sound.
                  Connected inputs send notes, velocity and sustain pedal
                  (CC64).
                </p>
                <h3>Panel controls</h3>
                <p>
                  The panel is an interactive hardware study. Press buttons or
                  drag controls vertically. Use Tab to focus, arrow keys to
                  adjust and Enter or Space to press. The Piano and Effects
                  plates edit the sound. A layer fader focuses that layer. Press
                  a layer button to enable and focus it, then press again to
                  turn it off. Shift-click the A or B button to route sustain or
                  pitch stick. Select the voice name below the instrument for
                  all layer and effect settings. Press FX Focus Piano to
                  alternate between A and B. Shift-click it to group both
                  chains. Shift-click Delay, Compressor or Reverb On to link
                  that unit globally. The Effects Shift button latches this
                  modifier for touch input.
                </p>
              </>
            ) : (
              <>
                <h2>Sample credits</h2>
                <p>
                  Salamander Grand Piano V3 by Alexander Holm, licensed under CC
                  BY 3.0. Stereo Yamaha C5 recordings, trimmed, levelled and
                  encoded as Ogg Vorbis.
                </p>
                <p>
                  <a href="https://creativecommons.org/licenses/by/3.0/">
                    CC BY 3.0 license
                  </a>{' '}
                  ·{' '}
                  <a href="https://archive.org/details/SalamanderGrandPianoV3">
                    Original recordings
                  </a>
                </p>
                <p>
                  Upright Piano KW by Gonzalo and Roberto (FreePats) and Rhodes
                  Mark I by Jeff Learman are CC0 recordings. A synthesized piano
                  plays while samples load, or if loading fails.
                </p>
              </>
            )}
          </div>
        </dialog>
      </div>
    </Live.Provider>
  )
}
