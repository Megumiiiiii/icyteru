import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import { App } from './App'
import type { Snapshot } from '../shared/snapshot'
import { installPreview } from './preview'
import { installWebHost } from './web/host'
import './styles.css'

// Android 15 draws the WebView edge-to-edge by default, which puts the chat
// bar under the system clock and makes its buttons unreachable. MainActivity
// pads the WebView by the status/navigation bar insets; keep the bars dark.
if (Capacitor.isNativePlatform()) {
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined)
  void StatusBar.setBackgroundColor({ color: '#0d0714' }).catch(() => undefined)
}

const shot = new URLSearchParams(location.search).get('shot')

async function boot(): Promise<void> {
  if (shot) installPreview(shot)
  else if ('__TAURI_INTERNALS__' in window) {
    const { installTauriHost } = await import('./tauri/host')
    await installTauriHost()
  } else if (!window.icyteru) installWebHost()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>
  )
}

function Root() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  useEffect(() => {
    const stop = window.icyteru.onSnapshot(setSnapshot)
    void window.icyteru.getSnapshot().then(setSnapshot)
    return stop
  }, [])
  if (!snapshot) return <div className="boot">Opening Icyteru…</div>
  return <App snapshot={snapshot} />
}

void boot()

