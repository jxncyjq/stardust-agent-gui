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
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
