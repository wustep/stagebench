/**
 * The six control-deck sections and the 73-key keybed.
 * Section widths are flex fractions from the visual spec; landmarks per the
 * sectionLandmarks inventory (wheels+master, 9 drawbars, piano selectors,
 * program OLED/dial/buttons, dense synth groups, effects matrix).
 */

import { useMemo } from 'react';
import { DecorativeControl } from './controls';
import { SECTIONS, controlsInSection, type ControlModel, type SectionId } from '../hardware/sections';
import { BLACK_KEYS, WHITE_KEYS, blackKeyLeftPct, BLACK_KEY_HEIGHT_FRACTION } from '../hardware/keys';
import { FxPanel, MasterStrip, PianoPanel } from './panels';
import { programDisplayText, usePianoFxSnapshot } from '../state/pianoFx';

const ORGAN_DRAWBAR_IDS = Array.from({ length: 9 }, (_, i) => `organ-drawbar-${i + 1}`);

function groupControls(controls: ControlModel[]): Array<{ name: string | null; items: ControlModel[] }> {
  const groups: Array<{ name: string | null; items: ControlModel[] }> = [];
  for (const control of controls) {
    const last = groups[groups.length - 1];
    if (last && last.name === (control.group ?? null)) last.items.push(control);
    else groups.push({ name: control.group ?? null, items: [control] });
  }
  return groups;
}

/** Organ renders drawbars as one bank plus the remaining mixed switches. */
function OrganBody({ controls }: { controls: ControlModel[] }) {
  const drawbars = ORGAN_DRAWBAR_IDS.map((id) => controls.find((c) => c.id === id)!).filter(Boolean);
  const rest = controls.filter((c) => !ORGAN_DRAWBAR_IDS.includes(c.id));
  return (
    <>
      <div className="drawbank" role="group" aria-label="Drawbars">
        {drawbars.map((control) => (
          <DecorativeControl key={control.id} control={control} />
        ))}
      </div>
      <div className="mixedgrid">
        {rest.map((control) => (
          <DecorativeControl key={control.id} control={control} />
        ))}
      </div>
    </>
  );
}

function SectionBody({ section, controls }: { section: SectionId; controls: ControlModel[] }) {
  if (section === 'organ') return <OrganBody controls={controls} />;
  if (section === 'synth' || section === 'effects') {
    return (
      <div className="subgroups">
        {groupControls(controls).map((group, i) => (
          <div className="subgroup" role="group" aria-label={group.name ?? 'Controls'} key={`${group.name ?? 'g'}-${i}`}>
            {group.name ? (
              <div className="subgroup-title" aria-hidden="true">
                {group.name}
              </div>
            ) : null}
            <div className="mixedgrid">
              {group.items.map((control) => (
                <DecorativeControl key={control.id} control={control} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mixedgrid">
      {controls.map((control) => (
        <DecorativeControl key={control.id} control={control} />
      ))}
    </div>
  );
}

/**
 * Phase 2 functional strips. Rendered AFTER the inherited Phase 1 grids so no
 * Phase 1 node moves; the strips are separate `p2-*` DOM subtrees. Outside a
 * PianoFxProvider (isolated Phase 1 tests) they render nothing.
 */
function PhaseStrip({ section }: { section: SectionId }) {
  const snap = usePianoFxSnapshot();
  if (!snap) return null;
  if (section === 'piano') return <PianoPanel loadFailed={snap.loadFailed} />;
  if (section === 'effects') return <FxPanel />;
  if (section === 'performance') return <MasterStrip />;
  if (section === 'program') {
    return (
      <div className="p2-programline" data-testid="p2-program-model" role="status" aria-label="Focused piano model">
        {programDisplayText(snap)}
      </div>
    );
  }
  return null;
}

export function ControlDeck() {
  return (
    <div className="deck" data-testid="control-deck" role="group" aria-label="Control deck">
      {SECTIONS.map((section) => (
        <section
          key={section.id}
          id={`section-${section.id}`}
          data-testid={`section-${section.id}`}
          data-section={section.id}
          data-surface={section.surface}
          aria-label={section.ariaLabel}
          className={`deck-section surface-${section.surface}`}
          style={{ flexGrow: section.fraction * 100, flexBasis: 0 }}
        >
          <h2 className="section-title" aria-hidden="true">
            {section.label}
          </h2>
          <SectionBody section={section.id} controls={controlsInSection(section.id)} />
          <PhaseStrip section={section.id} />
          {section.id === 'performance' ? (
            <div className="brandblock" aria-hidden="true">
              <span className="brand">nord stage 4</span>
              <span className="subbrand">HAMMER ACTION 73</span>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

export interface KeybedProps {
  /** MIDI numbers currently sounding (visual depression mirrors audio). */
  activeNotes: Set<number>;
  onPress: (midi: number, velocity: number, source: 'pointer' | 'touch') => void;
  onRelease: (midi: number, source: 'pointer' | 'touch') => void;
}

export function Keybed({ activeNotes, onPress, onRelease }: KeybedProps) {
  const whiteWidthPct = useMemo(() => 100 / WHITE_KEYS.length, []);
  return (
    <div
      className="keybed"
      data-testid="keybed"
      role="group"
      aria-label="73-key hammer-action keybed, E1 to E7"
    >
      <div className="whites" role="group" aria-label="White keys">
        {WHITE_KEYS.map((key) => (
          <button
            key={key.id}
            id={key.id}
            data-testid={key.id}
            data-midi={key.midi}
            data-white="true"
            type="button"
            aria-label={`Piano key ${key.ariaName}`}
            aria-pressed={activeNotes.has(key.midi)}
            className={`pkey white${activeNotes.has(key.midi) ? ' down' : ''}`}
            style={{ width: `${whiteWidthPct}%` }}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              const velocity = e.pressure && e.pressure > 0 ? Math.round(40 + e.pressure * 87) : 96;
              onPress(key.midi, velocity, e.pointerType === 'touch' ? 'touch' : 'pointer');
            }}
            onPointerUp={() => onRelease(key.midi, 'pointer')}
            onPointerCancel={() => onRelease(key.midi, 'pointer')}
            onLostPointerCapture={() => onRelease(key.midi, 'pointer')}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="pkey-label" aria-hidden="true">
              {key.midi === 60 ? 'C4' : ''}
            </span>
          </button>
        ))}
      </div>
      <div className="blacks" aria-hidden="false">
        {BLACK_KEYS.map((key) => (
          <button
            key={key.id}
            id={key.id}
            data-testid={key.id}
            data-midi={key.midi}
            data-white="false"
            type="button"
            aria-label={`Piano key ${key.ariaName}`}
            aria-pressed={activeNotes.has(key.midi)}
            className={`pkey black${activeNotes.has(key.midi) ? ' down' : ''}`}
            style={{
              left: `${blackKeyLeftPct(key)}%`,
              width: `${whiteWidthPct * 0.62}%`,
              height: `${BLACK_KEY_HEIGHT_FRACTION * 100}%`,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              const velocity = e.pressure && e.pressure > 0 ? Math.round(40 + e.pressure * 87) : 96;
              onPress(key.midi, velocity, e.pointerType === 'touch' ? 'touch' : 'pointer');
            }}
            onPointerUp={() => onRelease(key.midi, 'pointer')}
            onPointerCancel={() => onRelease(key.midi, 'pointer')}
            onLostPointerCapture={() => onRelease(key.midi, 'pointer')}
            onContextMenu={(e) => e.preventDefault()}
          />
        ))}
      </div>
    </div>
  );
}
