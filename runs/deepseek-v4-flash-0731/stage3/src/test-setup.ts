import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { hardwareStore } from './hardware/store'

// Ensure each test starts from a clean DOM and clean hardware presentation
// state: unmounts prior <App/> instances (tearing down their window listeners /
// singleton lifecycles) and resets the module-level hardware store.
afterEach(() => {
  cleanup()
  hardwareStore.reset()
})