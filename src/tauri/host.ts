/**
 * Tauri desktop host. The renderer keeps the same window.icyteru API while
 * native Rust commands own transport, credential storage, and file writes.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { save } from '@tauri-apps/plugin-dialog'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as sendDesktopNotification
} from '@tauri-apps/plugin-notification'
import { HermesClient } from '../../electron/hermes'
import { emptySnapshot, isThemePreference, type AppScreen, type Snapshot, type ThemePreference } from '../../shared/snapshot'
import type { AuthDiscovery, NotificationPayload, OutgoingAttachment, SessionInfo } from '../../shared/protocol'
import type { ConnectionInput } from '../global'
import { installNativeFetch } from './net'
import { installNativeWebSocket } from './ws'

type BackdropMode = 'light' | 'dark'

interface SavedGateway {
  id: string
  url: string
  token: string
  username: string
  password: string
}

interface SavedConnection {
  url: string
  token: string
  username: string
  password: string
  method?: 'password' | 'token'
  theme: ThemePreference
  gateways: SavedGateway[]
}

export interface AppearanceState {
  dim: number
  blur: number
  light: string | null
  dark: string | null
}

const BACKDROP_KEY = 'icyteru-backdrop'
const DB_NAME = 'icyteru-canary'
const STORE = 'backgrounds'
const EMPTY_CONNECTION: SavedConnection = {
  url: '', token: '', username: '', password: '', theme: 'system', gateways: []
}

let saved: SavedConnection = { ...EMPTY_CONNECTION }
let screen: AppScreen = 'connect'
let phase: Snapshot['phase'] = 'idle'
let error = ''
let status = ''
let publishTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(snapshot: Snapshot) => void>()

const client = new HermesClient(() => {
  if (client.lastError) {
    phase = 'error'
    error = client.lastError
  }
  publish()
})

async function loadConnection(): Promise<SavedConnection> {
  try {
    const raw = await invoke<string | null>('vault_load')
    const parsed = JSON.parse(raw || '') as Partial<SavedConnection>
    return {
      url: typeof parsed.url === 'string' ? parsed.url : '',
      token: typeof parsed.token === 'string' ? parsed.token : '',
      username: typeof parsed.username === 'string' ? parsed.username : '',
      password: typeof parsed.password === 'string' ? parsed.password : '',
      method: parsed.method === 'password' || parsed.method === 'token' ? parsed.method : undefined,
      theme: isThemePreference(parsed.theme) ? parsed.theme : 'system',
      gateways: Array.isArray(parsed.gateways)
        ? parsed.gateways.flatMap(gateway => {
          if (!gateway || typeof gateway.url !== 'string' || !gateway.url) return []
          return [{
            id: String(gateway.id || gateway.url),
            url: gateway.url,
            token: typeof gateway.token === 'string' ? gateway.token : '',
            username: typeof gateway.username === 'string' ? gateway.username : '',
            password: typeof gateway.password === 'string' ? gateway.password : ''
          }]
        })
        : []
    }
  } catch {
    return { ...EMPTY_CONNECTION }
  }
}

async function persist(): Promise<void> {
  await invoke('vault_save', { value: JSON.stringify(saved) })
}

function connectionInfo() {
  return {
    url: saved.url,
    hasToken: Boolean(saved.token),
    hasPassword: Boolean(saved.username && saved.password),
    authMode: client.state.authMode,
    method: saved.method,
    theme: saved.theme,
    gateways: (saved.gateways || []).map(gateway => ({ id: gateway.id, url: gateway.url, label: gateway.url }))
  }
}

function credentials(input: ConnectionInput) {
  return {
    token: input.token === undefined ? saved.token : input.token.trim(),
    username: input.username === undefined ? saved.username : input.username.trim(),
    password: input.password === undefined ? saved.password : input.password,
    method: input.method
  }
}

function snapshot(): Snapshot {
  const state = client.state
  const base = emptySnapshot(connectionInfo())
  base.screen = screen
  base.phase = phase
  base.error = error
  base.status = status
  base.hermesVersion = state.version
  base.profileName = state.profileName || 'Hermes'
  base.avatar = state.avatar
  base.profiles = state.profiles
  base.activeProfile = state.activeProfile
  base.activeGatewayId = state.activeGatewayId
  base.sessions = state.sessions
  base.activeSessionId = state.activeSessionId
  base.transcript = state.transcript
  base.models = state.side.models.models
  base.currentModel = state.side.models.currentModel
  base.currentProvider = state.side.models.currentProvider
  base.globalModel = state.side.globalModel
  base.globalProvider = state.side.globalProvider
  base.currentReasoning = state.side.reasoning
  base.globalReasoning = state.side.globalReasoning
  base.tokensPerSecond = state.side.tokensPerSecond
  base.skills = state.side.skills
  base.skillsNote = state.side.skillsNote
  base.memory = state.side.memory
  if (state.side.instructionsNote) base.instructionsNote = state.side.instructionsNote
  else if (state.side.memory.instructions) base.instructionsNote = ''
  base.question = state.question
  base.remoteClarifies = state.remoteClarifies
  base.remoteApprovals = state.remoteApprovals
  base.subagents = state.subagents
  base.queued = state.queued
  return base
}

function publish(): void {
  if (publishTimer) return
  publishTimer = setTimeout(() => {
    publishTimer = null
    const next = snapshot()
    listeners.forEach(listener => listener(next))
  }, 30)
}

let reconnecting = false

async function ensureConnected(): Promise<void> {
  if (!saved.url || reconnecting || phase === 'connecting' || client.state.connected) return
  reconnecting = true
  try {
    await connectSaved()
  } finally {
    reconnecting = false
  }
}

async function startFeed(): Promise<void> {
  const auth = client.authSnapshot
  if (!auth.baseUrl) return
  await invoke('feed_start', {
    url: auth.baseUrl,
    token: auth.token,
    cookie: auth.cookie,
    activeSession: client.state.activeSessionId
  }).catch(() => undefined)
}

async function syncFeedSession(): Promise<void> {
  await invoke('feed_set_active_session', { sessionId: client.state.activeSessionId }).catch(() => undefined)
}

let pendingSession = ''

function noteFeedEvent(sessionId: string): void {
  if (!sessionId) return
  if (document.hidden) pendingSession = sessionId
  void client.refreshSessions().catch(() => undefined)
}

async function connectSaved(): Promise<void> {
  if (!saved.url) {
    screen = 'connect'
    phase = 'idle'
    publish()
    return
  }
  screen = 'chat'
  phase = 'connecting'
  error = ''
  status = 'Connecting to Hermes…'
  publish()
  try {
    await client.connect(saved.url, {
      token: saved.token,
      username: saved.username,
      password: saved.password,
      method: saved.method
    }, saved.gateways || [])
    phase = 'ready'
    status = ''
    error = ''
    client.lastError = ''
    void startFeed()
  } catch (err) {
    phase = 'error'
    error = err instanceof Error ? err.message : 'Could not connect to Hermes.'
    status = ''
  }
  publish()
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`
}

function backdropMeta(): { dim: number; blur: number } {
  try {
    const parsed = JSON.parse(localStorage.getItem(BACKDROP_KEY) || '') as { dim?: number; blur?: number }
    return {
      dim: clamp(parsed.dim, 0, 0.75, 0.22),
      blur: clamp(parsed.blur, 0, 28, 10)
    }
  } catch {
    return { dim: 0.22, blur: 10 }
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'))
  })
}

async function readImage(mode: BackdropMode): Promise<string | null> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(mode)
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null)
    request.onerror = () => reject(request.error ?? new Error('Could not read the background.'))
  })
}

async function writeImage(mode: BackdropMode, image: string | null): Promise<void> {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    if (image) store.put(image, mode)
    else store.delete(mode)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Could not store the background.'))
  })
}

async function appearance(): Promise<AppearanceState> {
  const meta = backdropMeta()
  const [light, dark] = await Promise.all([readImage('light'), readImage('dark')])
  return { ...meta, light, dark }
}

function installContextMenu(): void {
  const style = document.createElement('style')
  style.textContent = `
    .icyteru-menu{position:fixed;z-index:2147483000;min-width:190px;padding:6px;border-radius:12px;
      background:var(--panel,#221a2d);color:var(--ink,#f2eef7);border:1px solid var(--line,#3a2f4a);
      box-shadow:0 18px 40px rgba(0,0,0,.45);font-size:13px;line-height:1.3}
    .icyteru-menu button{display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:8px;
      background:transparent;color:inherit;font:inherit;cursor:default}
    .icyteru-menu button:hover{background:rgba(255,255,255,.09)}
    .icyteru-menu hr{margin:5px 4px;border:0;border-top:1px solid var(--line,#3a2f4a)}
  `
  document.head.appendChild(style)

  let menu: HTMLDivElement | null = null
  const close = () => {
    menu?.remove()
    menu = null
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const helper = document.createElement('textarea')
      helper.value = text
      helper.style.position = 'fixed'
      helper.style.opacity = '0'
      document.body.appendChild(helper)
      helper.select()
      document.execCommand('copy')
      helper.remove()
    }
  }

  document.addEventListener('mousedown', event => {
    if (menu && !menu.contains(event.target as Node)) close()
  }, true)
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close()
  })
  window.addEventListener('blur', close)

  document.addEventListener('contextmenu', event => {
    const target = event.target as HTMLElement | null
    // Text fields keep the WebView's own menu: it carries spellcheck and paste.
    if (target?.closest?.('textarea, input, [contenteditable="true"]')) return
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
    const image = target?.closest?.('img') as HTMLImageElement | null
    const href = anchor?.getAttribute('href') || ''
    const selected = String(window.getSelection() ?? '')
    if (!selected && !href) return
    event.preventDefault()
    close()

    menu = document.createElement('div')
    menu.className = 'icyteru-menu'
    const add = (label: string, run: () => void) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.addEventListener('click', () => {
        close()
        run()
      })
      menu?.appendChild(button)
    }

    if (selected) add('Copy', () => void copy(selected))
    if (selected) add('Select all', () => window.getSelection()?.selectAllChildren(document.body))
    if (href && /^https?:/i.test(href)) {
      if (!selected) menu.appendChild(document.createElement('hr'))
      add('Open link in browser', () => void invoke('open_external', { url: href }).catch(() => undefined))
      add('Copy link', () => void copy(href))
      if (image) add('Copy image address', () => void copy(image.currentSrc || image.src))
    }
    document.body.appendChild(menu)
    const box = menu.getBoundingClientRect()
    const x = Math.min(event.clientX, window.innerWidth - box.width - 8)
    const y = Math.min(event.clientY, window.innerHeight - box.height - 8)
    menu.style.left = `${Math.max(8, x)}px`
    menu.style.top = `${Math.max(8, y)}px`
  }, true)
}

async function enableDesktopNotifications(): Promise<boolean> {
  if (await isPermissionGranted()) return true
  return (await requestPermission()) === 'granted'
}

export async function installTauriHost(): Promise<void> {
  installNativeFetch()
  installNativeWebSocket()
  saved = await loadConnection()
  screen = saved.url ? 'chat' : 'connect'
  const api = {
    getSnapshot: () => Promise.resolve(snapshot()),
    testConnection: async (input: ConnectionInput) => {
      const url = (input.url || saved.url).trim()
      try {
        return await client.probe(url, credentials(input))
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'Could not reach Hermes.' }
      }
    },
    probeAuth: async (input: ConnectionInput) => {
      const url = (input.url || saved.url).trim()
      return client.discover(url)
    },
    saveConnection: async (input: ConnectionInput) => {
      const url = (input.url || '').trim()
      const next = credentials(input)
      const probe = await client.probe(url, next)
      if (!probe.ok) throw new Error(probe.message)
      saved = {
        ...saved,
        url: normalizeUrl(url),
        token: next.token,
        username: next.username,
        password: next.password,
        method: next.method
      }
      await persist()
      screen = 'chat'
      await connectSaved()
      return snapshot()
    },
    forgetConnection: async () => {
      client.disconnect()
      void invoke('feed_stop').catch(() => undefined)
      saved = { ...saved, url: '', token: '', username: '', password: '', method: undefined, gateways: [] }
      await invoke('vault_clear')
      screen = 'connect'
      phase = 'idle'
      error = ''
      status = ''
      publish()
      return snapshot()
    },
    setTheme: async (theme: ThemePreference) => {
      if (!isThemePreference(theme)) return snapshot()
      saved = { ...saved, theme }
      await persist()
      publish()
      return snapshot()
    },
    showScreen: async (next: AppScreen) => {
      if (next === 'connect' || next === 'settings' || next === 'chat') screen = next
      publish()
      return snapshot()
    },
    reconnect: () => connectSaved(),
    refreshSessions: () => client.refreshSessions(),
    openSession: async (id: string) => {
      await client.openSession(id)
      void syncFeedSession()
    },
    setSessionPinned: (id: string, pinned: boolean) => client.setSessionPinned(id, pinned),
    renameSession: (id: string, title: string) => client.renameSession(id, title),
    sessionInfo: (id: string): Promise<SessionInfo> => client.sessionInfo(id),
    newChat: async () => {
      await client.newChat()
      void syncFeedSession()
    },
    sendMessage: async (text: string, attachments?: OutgoingAttachment[]) => client.send(text, attachments),
    steer: async (text: string) => client.steer(text),
    queue: async (text: string, attachments?: OutgoingAttachment[]) => client.queue(text, attachments),
    deleteQueued: async (id: string) => client.deleteQueued(id),
    mediaUrl: async (path: string) => client.mediaUrl(path),
    mediaData: async (path: string) => client.mediaData(path),
    saveDownload: async (name: string, dataUrl: string) => {
      const path = await save({ defaultPath: name })
      if (!path) return ''
      return invoke<string>('save_download', { path, dataUrl })
    },
    compress: async () => client.compress(),
    slash: async (command: string) => client.slash(command),
    testApproval: async () => client.testApproval(),
    enableNotifications: () => enableDesktopNotifications(),
    notify: async (payload: NotificationPayload) => {
      if (!await enableDesktopNotifications()) return
      sendDesktopNotification({ title: payload.title, body: payload.body })
    },
    interrupt: () => client.interrupt(),
    answer: (id: string, result: unknown) => client.answer(id, result),
    answerRemoteClarify: (clarifyId: string, answer: string) => client.answerRemoteClarify(clarifyId, answer),
    answerRemoteApproval: (sessionKey: string, requestId: string, choice: string, reason = '', commandDigest = '') => client.answerRemoteApproval(sessionKey, requestId, choice, reason, commandDigest),
    setModel: (model: string, provider: string, confirm = false) => client.setModel(model, provider, confirm),
    setSessionModel: (model: string, provider: string, confirm = false) => client.setSessionModel(model, provider, confirm),
    cancelSessionModel: () => client.cancelSessionModel(),
    setReasoning: (value: string) => client.setReasoning(value),
    setGlobalReasoning: (value: string) => client.setGlobalReasoning(value),
    selectProfile: (gatewayId: string, name: string) => client.selectProfile(gatewayId, name),
    setPinned: (gatewayId: string, name: string, pinned: boolean) => client.setPinned(gatewayId, name, pinned),
    setProfileHidden: (gatewayId: string, name: string, hidden: boolean) => client.setProfileHidden(gatewayId, name, hidden),
    createProfile: (label: string) => client.createProfile(label),
    getAppearance: () => appearance(),
    getCloseBehavior: async () => (await invoke<string>('get_close_behavior')) === 'tray' ? 'tray' as const : 'quit' as const,
    setCloseBehavior: async (value: 'quit' | 'tray') =>
      (await invoke<string>('set_close_behavior', { value })) === 'tray' ? 'tray' as const : 'quit' as const,
    setBackground: async (mode: BackdropMode, image: string) => {
      if (mode !== 'light' && mode !== 'dark') throw new Error('Choose light or dark.')
      if (!image) throw new Error('That file was empty.')
      if (!/^data:image\/(png|jpeg|webp);base64,/i.test(image)) throw new Error('Use a PNG, JPEG, or WebP image.')
      if (image.length > Math.ceil(8 * 1024 * 1024 * 4 / 3) + 64) throw new Error('That image is larger than 8 MB.')
      await writeImage(mode, image)
      return appearance()
    },
    clearBackground: async (mode: BackdropMode) => {
      if (mode !== 'light' && mode !== 'dark') throw new Error('Choose light or dark.')
      await writeImage(mode, null)
      return appearance()
    },
    setBackdrop: async (dim: number, blur: number) => {
      localStorage.setItem(BACKDROP_KEY, JSON.stringify({
        dim: clamp(dim, 0, 0.75, 0.22),
        blur: clamp(blur, 0, 28, 10)
      }))
      return appearance()
    },
    addGateway: async (input: ConnectionInput) => {
      const url = (input.url || '').trim()
      const next = credentials(input)
      const probe = await client.probe(url, next)
      if (!probe.ok) throw new Error(probe.message)
      const gateway: SavedGateway = {
        id: `gw-${Date.now().toString(36)}`,
        url: normalizeUrl(url),
        token: next.token,
        username: next.username,
        password: next.password
      }
      saved = { ...saved, gateways: [...(saved.gateways || []), gateway] }
      await persist()
      await client.setExtraGateways(saved.gateways)
      publish()
      return snapshot()
    },
    removeGateway: async (id: string) => {
      saved = { ...saved, gateways: (saved.gateways || []).filter(gateway => gateway.id !== id) }
      await persist()
      await client.setExtraGateways(saved.gateways)
      publish()
      return snapshot()
    },
    onSnapshot: (listener: (snapshot: Snapshot) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
  window.icyteru = api
  installContextMenu()
  void listen<{ sessionId: string }>('icyteru-feed', event => noteFeedEvent(event.payload?.sessionId || ''))
    .catch(() => undefined)
  window.addEventListener('focus', () => {
    if (!pendingSession || phase !== 'ready') return
    const id = pendingSession
    pendingSession = ''
    void api.openSession(id).catch(() => undefined)
  })
  if (saved.url) void connectSaved()
  else publish()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return
    void ensureConnected()
  })

  // Links from the transcript open in the user's browser. Navigating the WebView
  // itself would replace the app with the page and leave no way back.
  document.addEventListener('click', event => {
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    const href = anchor.getAttribute('href') || ''
    if (!/^https?:/i.test(href) || href.startsWith(location.origin)) return
    event.preventDefault()
    void invoke('open_external', { url: href }).catch(() => undefined)
  }, true)
}

