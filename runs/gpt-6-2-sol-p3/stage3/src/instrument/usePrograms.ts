import { useCallback, useEffect, useState } from 'react'
import { initialSettings } from '../piano/settings'
import type { Settings } from '../piano/settings'
import { address, capture, edited, libraryKey, loadLibrary, recall, saveSlot } from './programs'
import type { Bank, Location, ProgramStorage, Slot } from './programs'

type Store = { draft: Slot; destination: Location }
function browserStorage(viewport: Window) {
  try { return viewport.localStorage } catch { return undefined }
}

export function usePrograms(storage: ProgramStorage | null | undefined, viewport: Window) {
  const bookStorage = storage === undefined ? browserStorage(viewport) : storage ?? undefined
  const [library, setLibrary] = useState(() => loadLibrary(bookStorage))
  const [initial] = useState(() => recall(library.programs[0].sound, initialSettings()))
  const [location, setLocation] = useState<Location>({ bank: 'programs', index: 0 })
  const [last, setLast] = useState<Record<Bank, number>>({ programs: 0, live: 0 })
  const [store, setStore] = useState<Store>()
  const [storageError, setStorageError] = useState(false)
  const [hasWritten, setHasWritten] = useState(false)

  useEffect(() => {
    if (!hasWritten || !bookStorage) return
    try {
      bookStorage.setItem(libraryKey, JSON.stringify(library))
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }, [bookStorage, hasWritten, library])

  const connect = useCallback((state: Settings, configure: (settings: Settings) => void, panic: (reset?: boolean) => void) => {
    function write(at: Location, slot: Slot) {
      setLibrary((previous) => saveSlot(previous, at, slot))
      setHasWritten(true)
    }
    const current = library[location.bank][location.index]
    const selected = store?.destination ?? location
    const selectedSlot = library[selected.bank][selected.index]
    function load(slot: Slot) {
      panic(false)
      configure(recall(slot.sound, state))
    }
    function select(next: Location) {
      if (selected.bank === next.bank && selected.index === next.index) return
      if (store) setStore({ ...store, destination: next })
      else {
        setLocation(next)
        setLast({ ...last, [next.bank]: next.index })
      }
      load(library[next.bank][next.index])
    }
    return {
      library, initial, location, selected, current, selectedSlot, store, storageError,
      dirty: location.bank === 'programs' && edited(store ? recall(store.draft.sound, state) : state, current),
      label: address(location),
      select,
      toggleLive() {
        const bank = selected.bank === 'programs' ? 'live' : 'programs'
        select({ bank, index: last[bank] })
      },
      beginStore(name = current.name) {
        setStore({ draft: { name, sound: capture(state) }, destination: location })
      },
      confirmStore() {
        if (!store) return
        write(store.destination, store.draft)
        setStore(undefined)
        setLocation(store.destination)
        setLast({ ...last, [store.destination.bank]: store.destination.index })
        load(store.draft)
      },
      cancelStore() {
        if (!store) return
        setStore(undefined)
        load(store.draft)
      },
      edit(next: Settings) {
        configure(next)
        if (!store && location.bank === 'live' && edited(next, current)) write(location, { ...current, sound: capture(next) })
      },
    }
  }, [initial, last, library, location, storageError, store])
  return { initial, connect }
}

export type ProgramControls = ReturnType<ReturnType<typeof usePrograms>['connect']>
