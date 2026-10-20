// The two program dialogs: Store As (naming, then store) and the numeric list of all 32 programs,
// opened with Shift and the Program dial. Both act on the instrument state through its reducer.

import type { Dispatch } from 'react'
import type { InstrumentAction, InstrumentState } from '../model/instrument'
import { PROGRAM_SLOTS, slotLabel } from '../model/program'
import { storedSlotNames } from '../model/displays'

export interface ProgramDialogsProps {
  state: InstrumentState
  dispatch: Dispatch<InstrumentAction>
  listOpen: boolean
  onCloseList: () => void
}

export function ProgramDialogs({ state, dispatch, listOpen, onCloseList }: ProgramDialogsProps) {
  return (
    <>
      {state.storeAs && (
        <div className="program-dialog" role="dialog" aria-modal="false" aria-label="Store as">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              dispatch({ type: 'store-as-confirm' })
            }}
          >
            <p>
              Store as program {slotLabel(state.bank.selected)}. Name it (up to 16 characters).
            </p>
            <label>
              Program name
              <input
                type="text"
                id="store-as-name"
                maxLength={16}
                value={state.storeAs.name}
                onChange={(event) => dispatch({ type: 'store-as-name', name: event.target.value })}
                autoFocus
              />
            </label>
            <div className="program-dialog-actions">
              <button type="submit" id="store-as-confirm">
                Store
              </button>
              <button type="button" id="store-as-cancel" onClick={() => dispatch({ type: 'store-as-cancel' })}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      {listOpen && (
        <div className="program-dialog program-list" role="dialog" aria-label="Program list">
          <p>All {PROGRAM_SLOTS} programs. Choose one to load it.</p>
          <ol className="program-list-items">
            {storedSlotNames(state).map((label, index) => (
              <li key={label}>
                <button
                  type="button"
                  id={`program-list-${index + 1}`}
                  aria-current={state.bank.selected === index ? 'true' : undefined}
                  onClick={() => {
                    dispatch({ type: 'set', id: 'program.dial', value: index / (PROGRAM_SLOTS - 1) })
                    onCloseList()
                  }}
                >
                  {label}
                </button>
              </li>
            ))}
          </ol>
          <button type="button" id="program-list-close" onClick={onCloseList}>
            Close
          </button>
        </div>
      )}
    </>
  )
}
