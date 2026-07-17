import { create } from 'zustand'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'legion-theme'

// readInitialTheme resolves the startup theme: an explicit saved choice wins;
// otherwise fall back to the OS preference so the app matches the desktop.
function readInitialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// applyTheme toggles the `dark` class on <html>, which activates the .dark CSS
// variable block and every Tailwind `dark:` variant in one place.
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

interface ThemeState {
  theme: Theme
  toggle: () => void
  setTheme: (theme: Theme) => void
}

// useThemeStore is the single source of truth for light/dark mode. It applies
// the theme to the DOM and persists the choice on every change.
export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = readInitialTheme()
  applyTheme(initial)
  return {
    theme: initial,
    setTheme: (theme) => {
      applyTheme(theme)
      localStorage.setItem(STORAGE_KEY, theme)
      set({ theme })
    },
    toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  }
}
)
