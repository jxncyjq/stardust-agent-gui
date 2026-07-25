import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
// defineConfig comes from 'vitest/config' (a superset of vite's) so the
// `test` block below type-checks; the `plugins`/build config still applies
// to the plain `vite build` used by `npm run build`.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Vite's default esbuild target (es2020 baseline) predates top-level await.
  // src/lib/highlighter.ts builds its Shiki highlighter with a module-level
  // `await`, and this app only ships inside Wails' bundled Chromium/WebKit
  // webview (not arbitrary older browsers), so es2022 — the first target with
  // TLA support — is safe here.
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
