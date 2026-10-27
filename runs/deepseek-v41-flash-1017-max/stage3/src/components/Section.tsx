import { useMemo } from 'react'
import { BLOCKS, SECTIONS, type SectionSpec } from '../hardware/catalog'
import type { ControlSpec } from '../hardware/types'
import type { PresentationStore } from '../hardware/presentation'
import { ControlView, useControlValue, usePressed } from './Controls'

export interface ControlRowProps {
  store: PresentationStore
  controls: ControlSpec[]
  compact?: boolean
}

function ControlCell({ store, control, compact }: { store: PresentationStore; control: ControlSpec; compact?: boolean }) {
  const value = useControlValue(store, control.id)
  const pressed = usePressed(store, control.id)
  return <ControlView control={control} store={store} value={value} pressed={pressed} compact={compact} />
}

export function ControlGrid({ store, controls, compact }: ControlRowProps) {
  return (
    <>
      {controls.map((control) => (
        <ControlCell key={control.id} store={store} control={control} compact={compact} />
      ))}
    </>
  )
}

export interface SectionProps {
  section: SectionSpec
  store: PresentationStore
  compact?: boolean
  /** Rendered between the printed legend and the control blocks (e.g. a display). */
  children?: React.ReactNode
  /** Rendered after the control blocks (e.g. the chassis branding). */
  trailing?: React.ReactNode
}

/**
 * One section of the deck. Sections are the direct children of the deck grid, so their
 * widths are the spec's fractions and nothing inside can widen them.
 */
export function Section({ section, store, compact, children, trailing }: SectionProps) {
  const blocks = BLOCKS.filter((b) => b.section === section.id)
  return (
    <section
      className={`section section-${section.id} surface-${section.surface}`}
      data-section-id={section.id}
      data-section-fraction={section.fraction}
      aria-label={section.label}
    >
      {section.printedLabel ? (
        <h3 className="section-print" aria-hidden="true">
          {section.printedLabel}
        </h3>
      ) : null}
      {children}
      <div className="section-blocks">
        {blocks.map((block) => (
          <div
            key={block.id}
            className={`block block-${block.id.replace(/\./g, '-')}`}
            data-block-id={block.id}
          >
            {block.legend ? (
              <h4 className="block-legend" aria-hidden="true">
                {block.legend}
              </h4>
            ) : null}
            <div className="block-controls" style={{ ['--block-columns' as string]: block.columns ?? 1 }}>
              <ControlGrid store={store} controls={block.controls} compact={compact ?? block.controls.length > 8} />
            </div>
            {block.note ? (
              <p className="block-note" aria-hidden="true">
                {block.note}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {trailing}
    </section>
  )
}

export function useSections(): readonly SectionSpec[] {
  return useMemo(() => SECTIONS, [])
}
