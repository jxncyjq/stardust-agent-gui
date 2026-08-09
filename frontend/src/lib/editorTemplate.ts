const KEY = 'legion:editorTemplate'

// getEditorTemplate returns the user's external-editor command template
// (e.g. `code "{path}"`), or "" if unset. Machine-specific → localStorage, not
// the shared agent config.
export function getEditorTemplate(): string {
  return localStorage.getItem(KEY) ?? ''
}

export function setEditorTemplate(template: string): void {
  localStorage.setItem(KEY, template)
}
