/**
 * Browser and Capacitor stand-in for the Electron main process.
 * The renderer keeps calling window.icyteru. On Android that object is this host,
 * which runs the same Hermes client inside the WebView.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { HermesClient } from '../../electron/hermes'
import { emptySnapshot, type AppScreen, type Snapshot, type ThemePreference } from '../../shared/snapshot'
import type { AuthDiscovery, NotificationPayload, OutgoingAttachment } from '../../shared/protocol'
import { enableNotifications, sendNotification } from '../notifications'
import type { ConnectionInput } from '../global'

type BackdropMode = 'light' | 'dark'

interface IcyteruPushBridge {
  getToken: () => Promise<{ token: string }>
  consumeSession: () => Promise<{ session_id: string }>
}

const IcyteruPush = registerPlugin<IcyteruPushBridge>('IcyteruPush')

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

const CONNECTION_KEY = 'icyteru-connection'
const BACKDROP_KEY = 'icyteru-backdrop'
const DB_NAME = 'icyteru'
const STORE = 'backgrounds'

let saved: SavedConnection = loadConnection()
let screen: AppScreen = saved.url ? 'chat' : 'connect'
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

function loadConnection(): SavedConnection {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONNECTION_KEY) || '') as Partial<SavedConnection>
    return {
      url: typeof parsed.url === 'string' ? parsed.url : '',
      token: typeof parsed.token === 'string' ? parsed.token : '',
      username: typeof parsed.username === 'string' ? parsed.username : '',
      password: typeof parsed.password === 'string' ? parsed.password : '',
      method: parsed.method === 'password' || parsed.method === 'token' ? parsed.method : undefined,
      theme: parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system' ? parsed.theme : 'system',
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
    return { url: '', token: '', username: '', password: '', theme: 'system', gateways: [] }
  }
}

function persist(): void {
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(saved))
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
  base.skills = state.side.skills
  base.skillsNote = state.side.skillsNote
  base.memory = state.side.memory
  if (state.side.instructionsNote) base.instructionsNote = state.side.instructionsNote
  else if (state.side.memory.instructions) base.instructionsNote = ''
  base.question = state.question
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

async function syncPushToken(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android' || !saved.url) return
  try {
    await enableNotifications()
    const { token } = await IcyteruPush.getToken()
    if (!token) return
    await fetch(`${normalizeUrl(saved.url)}/api/plugins/icyteru-push/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform: 'android', app_version: '0.0.11' })
    })
    const pending = await IcyteruPush.consumeSession()
    if (pending.session_id && phase === 'ready') await client.openSession(pending.session_id)
  } catch {
    // Push registration is a courtesy; a gateway or FCM hiccup must not block chat.
  }
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
    await syncPushToken()
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

export function installWebHost(): void {
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
      persist()
      screen = 'chat'
      await connectSaved()
      return snapshot()
    },
    forgetConnection: async () => {
      client.disconnect()
      saved = { ...saved, url: '', token: '', username: '', password: '', method: undefined, gateways: [] }
      persist()
      screen = 'connect'
      phase = 'idle'
      error = ''
      status = ''
      publish()
      return snapshot()
    },
    setTheme: async (theme: ThemePreference) => {
      if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return snapshot()
      saved = { ...saved, theme }
      persist()
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
    openSession: (id: string) => client.openSession(id),
    newChat: () => client.newChat(),
    sendMessage: async (text: string, attachments?: OutgoingAttachment[]) => client.send(text, attachments),
    steer: async (text: string) => client.steer(text),
    compress: async () => client.compress(),
    slash: async (command: string) => client.slash(command),
    enableNotifications: () => enableNotifications(),
    notify: async (payload: NotificationPayload) => sendNotification(payload),
    interrupt: () => client.interrupt(),
    answer: (id: string, result: unknown) => client.answer(id, result),
    setModel: (model: string, provider: string, confirm = false) => client.setModel(model, provider, confirm),
    selectProfile: (gatewayId: string, name: string) => client.selectProfile(gatewayId, name),
    setPinned: (gatewayId: string, name: string, pinned: boolean) => client.setPinned(gatewayId, name, pinned),
    createProfile: (label: string) => client.createProfile(label),
    getAppearance: () => appearance(),
    setBackground: async (mode: BackdropMode, image: string) => {
      if (mode !== 'light' && mode !== 'dark') throw new Error('Choose light or dark.')
      if (!image) throw new Error('That file was empty.')
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
      persist()
      await client.setExtraGateways(saved.gateways)
      publish()
      return snapshot()
    },
    removeGateway: async (id: string) => {
      saved = { ...saved, gateways: (saved.gateways || []).filter(gateway => gateway.id !== id) }
      persist()
      await client.setExtraGateways(saved.gateways)
      publish()
    },
    onSnapshot: (listener: (snapshot: Snapshot) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
  window.icyteru = api
  if (saved.url) void connectSaved()
  else publish()
}


if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && phase === 'ready') void syncPushToken()
  })
}
