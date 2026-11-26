/**
 * The little always-on-top card that stands in for an OS toast, so a click can
 * actually bring Icyteru back and open the session it came from.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

interface Payload {
  title?: string
  body?: string
  session?: string
}

let session = ''

function paint(payload: Payload): void {
  session = payload.session || ''
  const title = document.getElementById('title')
  const body = document.getElementById('body')
  if (title) title.textContent = payload.title || 'Icyteru'
  if (body) body.textContent = payload.body || 'New message'
}

void listen<Payload>('icyteru-toast', event => paint(event.payload || {})).catch(() => undefined)

// The window can appear before this script runs, so ask for the pending payload.
void invoke<Payload | null>('toast_current')
  .then(payload => {
    if (payload) paint(payload)
  })
  .catch(() => undefined)

document.getElementById('card')?.addEventListener('click', () => {
  void invoke('toast_activate', { session }).catch(() => undefined)
})

document.getElementById('close')?.addEventListener('click', event => {
  event.stopPropagation()
  void invoke('toast_dismiss').catch(() => undefined)
})

// Escape closes it like any other transient popup.
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') void invoke('toast_dismiss').catch(() => undefined)
})
