import { BrowserOpenURL } from '../../wailsjs/runtime/runtime'

// openLink routes a URL to the system browser when — and only when — it is
// http(s). Any other scheme (javascript:, file:, data:, …) is ignored rather
// than opened: those are either injection vectors or local-resource reads we
// never want a chat link to trigger. Malformed input is ignored too.
export function openLink(href: string): void {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    BrowserOpenURL(href)
  }
}
