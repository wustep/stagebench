import { useMemo, useState } from 'react'
import { SECTIONS } from './hardware/catalog'
import { VARIANT } from './hardware/variant'
import { buildKeybed, keybedRangeLabel } from './hardware/keybed'
import { ProgramDisplay, SynthDisplay } from './components/Displays'
import { MorphPanel, SplitEditor, UnsupportedNotes } from './components/ProgramEditors'
import { Keybed } from './components/Keybed'
import { Section } from './components/Section'
import { useInstrument, type InstrumentDeps } from './instrument/useInstrument'
import { KEY_MAPPINGS, SUSTAIN_KEY_LABEL } from './input/keyboardMap'

export interface AppProps {
  deps?: InstrumentDeps
}

export default function App({ deps }: AppProps) {
  const keys = useMemo(() => buildKeybed(VARIANT), [])
  const instrument = useInstrument(deps)
  // The panel must write to the *same* presentation store the instrument installed its
  // functional-control sink on. A second store would leave every real control looking
  // connected while its edits went nowhere.
  const store = instrument.stores.presentation
  const [pedalDown, setPedalDown] = useState(false)

  const held = useMemo(() => new Set(instrument.snapshot.held), [instrument.snapshot.held])
  const sustained = useMemo(() => new Set(instrument.snapshot.sustained), [instrument.snapshot.sustained])
  const [editorsOpen, setEditorsOpen] = useState(false)

  const pedalPress = (down: boolean) => {
    setPedalDown(down)
    instrument.sustainFromUi(down)
  }

  return (
    <main className="stage">
      <div
        className="instrument"
        data-testid="instrument"
        data-variant={VARIANT.id}
        data-aspect={VARIANT.aspectRatio}
      >
        <div className="deck" data-testid="deck">
          <div className="rear-rail" aria-hidden="true">
            <span>MIDI IN</span>
            <span>MIDI OUT</span>
            <span>USB</span>
            <span>SUSTAIN PEDAL</span>
            <span>TRIPLE PEDAL</span>
            <span>OUT 1 – OUT 4</span>
            <span>HEADPHONES</span>
          </div>
          <div className="deck-inner" data-testid="deck-inner">
            {SECTIONS.map((section) => (
              <Section
                key={section.id}
                section={section}
                store={store}
                trailing={
                  section.id === 'performance' ? (
                    <div className="branding" data-landmark="branding">
                      <span className="brand-wordmark">nord</span>
                      <span className="brand-stage">stage&nbsp;4</span>
                      <span className="brand-action">HAMMER ACTION {VARIANT.totalKeys}</span>
                    </div>
                  ) : null
                }
              >
                {section.id === 'program' ? (
                  <ProgramDisplay
                    snapshot={instrument.snapshot}
                    midi={instrument.midi}
                    heldCount={instrument.snapshot.held.length}
                    piano={instrument.piano}
                    organ={instrument.organ}
                    synth={instrument.synth}
                    effects={instrument.effects}
                    library={instrument.library}
                    programs={instrument.programs}
                    program={instrument.program}
                  />
                ) : null}
                {section.id === 'synth' ? (
                  <SynthDisplay midi={instrument.midi} synth={instrument.synth} />
                ) : null}
              </Section>
            ))}
          </div>
          {/*
            The hardware reaches split points, zone assignment and morph recording with
            press-and-hold and Shift gestures. A browser cannot discover those, so the same
            state is also editable in this overlay, which sits inside the deck so the
            deck/keybed split and the keybed itself are untouched. Its controls are real
            widgets with names, roles and values, and it writes the identical state.
          */}
          <div className="program-editors" data-testid="program-editors">
            <button
              type="button"
              className="editors-toggle"
              aria-expanded={editorsOpen}
              aria-controls="editors-body"
              onClick={() => setEditorsOpen((open) => !open)}
            >
              {editorsOpen ? 'HIDE' : 'SPLIT / ZONES / MORPH'}
            </button>
            <div id="editors-body" className="editors-body" hidden={!editorsOpen}>
              {editorsOpen ? (
                <>
                  <SplitEditor
                    program={instrument.program}
                    snapshot={instrument.programs}
                    onSplitOn={instrument.setSplitOn}
                    onPoint={instrument.setSplitPoint}
                    onZone={instrument.setZone}
                  />
                  <MorphPanel
                    program={instrument.program}
                    onPosition={instrument.setMorphSource}
                    onClear={instrument.morphClear}
                  />
                  <UnsupportedNotes />
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="keybed-deck" data-testid="keybed-deck">
          <Keybed
            keys={keys}
            onPress={instrument.pressPointer}
            onRelease={instrument.releasePointer}
            held={held}
            sustained={sustained}
            lowestMidi={VARIANT.lowestMidi}
            highestMidi={VARIANT.highestMidi}
          />
          <div className="front-rail">
            <div className="pedal-unit" data-landmark="sustain-pedal">
              <button
                type="button"
                className={`pedal ${pedalDown ? 'is-down' : ''}`}
                aria-label="Sustain pedal"
                aria-pressed={pedalDown}
                data-testid="sustain-pedal"
                onPointerDown={(event) => {
                  if (event.button !== 0 && event.pointerType === 'mouse') return
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  event.preventDefault()
                  pedalPress(true)
                }}
                onPointerUp={() => pedalPress(false)}
                onPointerCancel={() => pedalPress(false)}
                onKeyDown={(event) => {
                  if (event.key !== ' ' && event.key !== 'Enter') return
                  event.preventDefault()
                  pedalPress(true)
                }}
                onKeyUp={(event) => {
                  if (event.key !== ' ' && event.key !== 'Enter') return
                  event.preventDefault()
                  pedalPress(false)
                }}
                onBlur={() => {
                  if (pedalDown) pedalPress(false)
                }}
              >
                <span className="pedal-face" aria-hidden="true" />
              </button>
              <span className="pedal-caption">
                <strong>SUSTAIN</strong>
                <span>
                  {VARIANT.totalKeys} · {keybedRangeLabel()} · SPACE / CC64
                </span>
              </span>
            </div>
            <div className="rail-tools">
              <button
                type="button"
                className="rail-tool"
                data-testid="midi-connect"
                aria-label="Connect a MIDI input"
                onClick={() => instrument.midiConnect()}
              >
                MIDI IN
              </button>
              <button
                type="button"
                className="rail-tool pedal-panic"
                data-testid="panic"
                aria-label="Panic — stop every sounding note"
                onClick={() => instrument.panic()}
              >
                PANIC
              </button>
            </div>
            {/* The mapped computer keys, printed where a player would look for them. */}
            <span className="rail-keys" data-testid="keyboard-legend" aria-label="Computer keyboard mapping">
              {KEY_MAPPINGS.filter((m) => m.offset < 17)
                .map((m) => m.label)
                .join(' ')}
              <span className="rail-keys-sep">·</span>
              {SUSTAIN_KEY_LABEL}
            </span>
            <span className="rail-serial">
              HANDMADE IN SWEDEN BY CLAVIA DMI AB · v2.0 Rev.B
            </span>
          </div>
        </div>
      </div>
    </main>
  )
}
