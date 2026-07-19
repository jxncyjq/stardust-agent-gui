// Vitest setup: registers @testing-library/jest-dom's matchers (toBeInTheDocument,
// etc.) on vitest's `expect` and augments its TS types. Loaded via
// `test.setupFiles` in vite.config.ts for every test file.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// @testing-library/react's auto-cleanup relies on a global `afterEach` hook
// that only exists when vitest's `test.globals` option is on; this project
// keeps globals off (explicit imports everywhere else), so cleanup is wired
// up here instead. Without it, a component rendered in one `it()` stays in
// the jsdom document for the next, and role/label queries in later tests
// start matching multiple elements.
afterEach(() => cleanup())
