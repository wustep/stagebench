import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Unmount everything after each test so session disposal runs and nothing leaks between tests.
afterEach(() => {
  cleanup()
})
