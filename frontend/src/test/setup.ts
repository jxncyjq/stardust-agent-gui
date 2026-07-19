// Vitest setup: registers @testing-library/jest-dom's matchers (toBeInTheDocument,
// etc.) on vitest's `expect` and augments its TS types. Loaded via
// `test.setupFiles` in vite.config.ts for every test file.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom does not implement scrollIntoView (no layout engine); components that
// call it (ChatPanel's auto-scroll-to-bottom effect, SlashCommandMenu's
// keep-highlighted-row-visible effect) throw a TypeError as soon as they
// mount in a test otherwise. A no-op stands in since tests only assert
// behavior, not actual scroll position.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// @testing-library/react's auto-cleanup relies on a global `afterEach` hook
// that only exists when vitest's `test.globals` option is on; this project
// keeps globals off (explicit imports everywhere else), so cleanup is wired
// up here instead. Without it, a component rendered in one `it()` stays in
// the jsdom document for the next, and role/label queries in later tests
// start matching multiple elements.
afterEach(() => cleanup())
