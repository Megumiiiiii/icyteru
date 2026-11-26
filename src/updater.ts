/**
 * Desktop auto-update: check the release manifest, download, install, relaunch.
 * Everything fails quietly — an offline laptop must never break the app.
 */
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; version: string; notes: string; update: Update }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string; update: Update }
  | { kind: 'installing'; version: string }
  | { kind: 'error'; message: string }

let pending: Update | null = null

export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const update = await check()
    if (!update) return { kind: 'current' }
    pending = update
    return { kind: 'available', version: update.version, notes: update.body || '', update }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    // Before the first updater-aware release there is no manifest at all.
    if (/404|not found|latest\.json/i.test(message)) return { kind: 'current' }
    return { kind: 'error', message: message || 'Could not check for updates.' }
  }
}

/** Download + install, reporting progress; the caller relaunches afterwards. */
export async function installUpdate(onProgress: (percent: number) => void): Promise<boolean> {
  const update = pending
  if (!update) return false
  try {
    let total = 0
    let downloaded = 0
    await update.downloadAndInstall(event => {
      if (event.event === 'Started') {
        total = event.data.contentLength || 0
        downloaded = 0
        onProgress(0)
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength
        if (total > 0) onProgress(Math.min(100, Math.round((downloaded / total) * 100)))
      } else if (event.event === 'Finished') {
        onProgress(100)
      }
    })
    return true
  } catch {
    return false
  }
}

export async function restartIntoUpdate(): Promise<void> {
  try {
    await relaunch()
  } catch {
    // The new build is on disk; the next manual launch picks it up.
  }
}
