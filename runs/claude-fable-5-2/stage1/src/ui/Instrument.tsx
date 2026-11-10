import { memo, useSyncExternalStore, type CSSProperties } from 'react'
import type { Session } from '../app/session'
import { CHEEK_WIDTH, DECK_HEIGHT, DESIGN, KEYBED, SECTIONS, VARIANT, type SectionGeometry } from '../hardware/geometry'
import { sectionInventory } from '../hardware/inventory'
import { KEYBED_MODEL, SPLIT_LED_NOTES } from '../hardware/keys'
import type { HardwareStore } from '../hardware/store'
import { ButtonControl, DECORATIVE_NOTE, DECORATIVE_NOTE_ID, Label, Led, Plate, RangeControl } from './controls'
import { Keybed } from './Keybed'
import { ProgramOled, SynthOled } from './Oleds'

interface InstrumentProps {
  session: Session
  /** Screen px per design px. */
  scale: number
}

/**
 * The whole instrument, drawn at photo scale (9013 × 2912 design px) and scaled to fit.
 * One continuous chassis: deck on top (54 %), keybed below (46 %), end cheeks either side.
 */
export function Instrument({ session, scale }: InstrumentProps) {
  const style = {
    width: DESIGN.width,
    height: DESIGN.height,
    transform: `scale(${scale})`,
    '--s': scale,
  } as CSSProperties
  return (
    <div
      className="instrument-frame"
      style={{ width: DESIGN.width * scale, height: DESIGN.height * scale }}
      data-instrument-frame=""
    >
      <div
        id="instrument"
        className="instrument"
        role="group"
        aria-label={`${VARIANT.fullName}, ${VARIANT.keyAction}`}
        data-instrument={VARIANT.id}
        data-variant={VARIANT.id}
        style={style}
      >
        <span id={DECORATIVE_NOTE_ID} className="visually-hidden">
          {DECORATIVE_NOTE}
        </span>
        <span className="chassis" aria-hidden="true">
          <span className="chassis__deck" style={{ height: DECK_HEIGHT }} />
          <span className="chassis__lip" style={{ top: DECK_HEIGHT - 118 }} />
          <span className="chassis__well" style={{ top: DECK_HEIGHT, left: CHEEK_WIDTH, right: CHEEK_WIDTH }} />
          <span className="chassis__block" style={{ top: DECK_HEIGHT, left: CHEEK_WIDTH, width: KEYBED.left - CHEEK_WIDTH }} />
          <span
            className="chassis__block"
            style={{ top: DECK_HEIGHT, left: KEYBED.right, width: DESIGN.width - CHEEK_WIDTH - KEYBED.right }}
          />
          <span className="chassis__cheek chassis__cheek--left" style={{ width: CHEEK_WIDTH }} />
          <span className="chassis__cheek chassis__cheek--right" style={{ width: CHEEK_WIDTH }} />
        </span>
        <div className="deck" data-region="deck" style={{ height: DECK_HEIGHT }}>
          {SECTIONS.map((section) => (
            <SectionView key={section.id} geometry={section} session={session} />
          ))}
          <SplitLeds store={session.hardware} />
        </div>
        <div className="keybed-slot" style={{ top: DECK_HEIGHT }}>
          <Keybed lifecycle={session.lifecycle} onGesture={session.wake} />
        </div>
      </div>
    </div>
  )
}

const SectionView = memo(function SectionView({ geometry, session }: { geometry: SectionGeometry; session: Session }) {
  const inventory = sectionInventory(geometry.id)
  const store = session.hardware
  return (
    <section
      id={`section-${geometry.id}`}
      className={`section section--${geometry.id}`}
      aria-label={geometry.label}
      data-section={geometry.id}
      data-fraction={geometry.fraction}
      style={{ left: geometry.x, width: geometry.width }}
    >
      {inventory.plates.map((plate, index) => (
        <Plate key={index} def={plate} />
      ))}
      {inventory.labels.map((label, index) => (
        <Label key={index} def={label} />
      ))}
      {inventory.oleds.map((oled) =>
        oled.id === 'program-oled' ? (
          <ProgramOled key={oled.id} def={oled} session={session} />
        ) : (
          <SynthOled key={oled.id} def={oled} />
        ),
      )}
      {inventory.leds.map((led) => (
        <Led key={led.id} def={led} store={store} />
      ))}
      {inventory.controls.map((control) =>
        control.kind === 'button' ? (
          <ButtonControl key={control.id} def={control} store={store} />
        ) : (
          <RangeControl key={control.id} def={control} store={store} />
        ),
      )}
    </section>
  )
})

/**
 * Split-point LEDs on the deck's front lip, above the C and F joints. Presentation only:
 * the C3 one follows the Split button's indicator, as on the photo. No split exists in Phase 1.
 */
function SplitLeds({ store }: { store: HardwareStore }) {
  const splitOn = useSyncExternalStore(
    store.subscribe,
    () => store.getValue('split') === 1,
    () => store.getValue('split') === 1,
  )
  const byNote = new Map(KEYBED_MODEL.keys.map((key) => [key.note, key]))
  return (
    <>
      {SPLIT_LED_NOTES.map((note) => {
        const key = byNote.get(note)
        if (!key) return null
        return (
          <span
            key={note}
            aria-hidden="true"
            className={`led led--yellow led--round${note === 48 && splitOn ? ' is-lit' : ''}`}
            data-split-led={note}
            style={{ left: key.x - 22, top: DECK_HEIGHT - 117 }}
          />
        )
      })}
    </>
  )
}
