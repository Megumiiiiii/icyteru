import { app, BrowserWindow, clipboard, Menu, Notification, ipcMain, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { installNodeWebSocket } from './node-websocket'

installNodeWebSocket()
import path from 'node:path'
import { clearBackground, loadAppearance, saveBackdrop, saveBackground, type BackdropMode } from './appearance'
import { HermesClient, type ConnectionCredentials } from './hermes'
import { clearConnection, loadConnection, saveConnection, type SavedConnection } from './store'
import { emptySnapshot, isThemePreference, type AppScreen, type Snapshot, type ThemePreference } from '../shared/snapshot'
import type { AuthMode, NotificationPayload, OutgoingAttachment } from '../shared/protocol'

type ConnectionInput = { url?: string; token?: string; username?: string; password?: string; method?: 'password' | 'token' }

let window: BrowserWindow | null = null
let saved: SavedConnection = { url: '', token: '', username: '', password: '', theme: 'system', gateways: [] }
let authMode: AuthMode = 'none'
let screen: AppScreen = 'connect'
let phase: Snapshot['phase'] = 'idle'
let error = ''
let status = ''
let publishTimer: NodeJS.Timeout | null = null
let notifyTimer: NodeJS.Timeout | null = null
let notifyPolling = false
let notifyCursor = 0

const client = new HermesClient(() => {
  if (client.lastError) {
    phase = 'error'
    error = client.lastError
  }
  publish()
})

function connectionInfo() {
  return {
    url: saved.url,
    hasToken: Boolean(saved.token),
    hasPassword: Boolean(saved.username && saved.password),
    authMode,
    method: saved.method,
    theme: saved.theme,
    gateways: (saved.gateways || []).map(gateway => ({ id: gateway.id, url: gateway.url, label: gateway.url }))
  }
}

function credentials(input: ConnectionInput): ConnectionCredentials {
  return {
    token: input.token === undefined ? saved.token : input.token.trim(),
    username: input.username === undefined ? saved.username : input.username.trim(),
    password: input.password === undefined ? saved.password : input.password,
    method: input.method
  }
}

function snapshot(): Snapshot {
  const state = client.state
  authMode = state.authMode
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
    window?.webContents.send('snapshot', snapshot())
  }, 30)
}

function windowIcon(): string {
  const dev = path.join(__dirname, '../../build/icon.png')
  return app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : dev
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 620,
    title: 'Icyteru',
    icon: windowIcon(),
    backgroundColor: '#f4f1ea',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const dev = process.env.VITE_DEV_SERVER_URL
    if (dev && url.startsWith(dev)) return
    event.preventDefault()
  })
  window.webContents.on('context-menu', (_event, params) => {
    const target = window
    if (!target) return
    const items: MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      if (params.dictionarySuggestions.length > 0) {
        for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
          items.push({
            label: suggestion,
            click: () => target.webContents.replaceMisspelling(suggestion)
          })
        }
        items.push({ type: 'separator' })
      }
      items.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { role: 'pasteAndMatchStyle', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll }
      )
    } else {
      if (params.selectionText.trim()) {
        items.push({ role: 'copy' })
      }
      if (params.linkURL && /^https?:\/\//i.test(params.linkURL)) {
        if (items.length) items.push({ type: 'separator' })
        items.push(
          { label: 'Open Link in Browser', click: () => { void shell.openExternal(params.linkURL) } },
          { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) }
        )
      }
      if (params.mediaType === 'image') {
        if (items.length) items.push({ type: 'separator' })
        items.push({ label: 'Copy Image', click: () => target.webContents.copyImageAt(params.x, params.y) })
      }
      if (!items.length) {
        items.push({ role: 'selectAll' })
      }
    }
    Menu.buildFromTemplate(items).popup({ window: target })
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  window.on('closed', () => {
    window = null
  })
}

function showDesktopNotification(title: string, body: string, sessionId = ''): void {
  if (!Notification.isSupported()) return
  const note = new Notification({ title, body })
  note.on('click', () => {
    if (window?.isMinimized()) window.restore()
    window?.show()
    window?.focus()
    if (sessionId) {
      // A notification from another session should switch the open chat, not
      // just raise whichever session happened to be in front.
      screen = 'chat'
      publish()
      void client.openSession(sessionId).catch(() => undefined)
    }
  })
  note.show()
}

function stopDesktopNotifications(): void {
  if (notifyTimer) clearInterval(notifyTimer)
  notifyTimer = null
  notifyPolling = false
}

function startDesktopNotifications(): void {
  stopDesktopNotifications()
  notifyCursor = Math.floor(Date.now() / 1000)
  notifyTimer = setInterval(async () => {
    if (notifyPolling) return
    notifyPolling = true
    try {
      const events = await client.notificationFeed(notifyCursor)
      const activeSession = client.state.activeSessionId
      for (const event of events) {
        notifyCursor = Math.max(notifyCursor, event.at)
        // The open session is already handled by the renderer's local notifier;
        // other sessions (Telegram, Discord, schedule) arrive through this feed.
        if (event.session_id && event.session_id === activeSession) continue
        showDesktopNotification(event.title, event.body, event.session_id)
      }
    } finally {
      notifyPolling = false
    }
  }, 4000)
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
    startDesktopNotifications()
  } catch (err) {
    phase = 'error'
    error = err instanceof Error ? err.message : 'Could not connect to Hermes.'
    status = ''
  }
  publish()
}

function registerIpc(): void {
  ipcMain.handle('get-snapshot', () => snapshot())
  ipcMain.handle('test-connection', async (_event: IpcMainInvokeEvent, input: ConnectionInput) => {
    const url = (input.url || saved.url).trim()
    try {
      return await client.probe(url, credentials(input))
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Could not reach Hermes.' }
    }
  })
  ipcMain.handle('probe-auth', async (_event: IpcMainInvokeEvent, input: ConnectionInput) => {
    const url = (input.url || saved.url).trim()
    return client.discover(url)
  })
  ipcMain.handle('save-connection', async (_event: IpcMainInvokeEvent, input: ConnectionInput) => {
    const url = (input.url || '').trim()
    const next = credentials(input)
    const probe = await client.probe(url, next)
    if (!probe.ok) throw new Error(probe.message)
    authMode = probe.mode || 'none'
    saved = {
      ...saved,
      url: new URL(url).origin + new URL(url).pathname.replace(/\/$/, ''),
      token: next.token,
      username: next.username,
      password: next.password,
      method: next.method
    }
    saveConnection(saved)
    screen = 'chat'
    await connectSaved()
    return snapshot()
  })
  ipcMain.handle('forget-connection', async () => {
    stopDesktopNotifications()
    client.disconnect()
    saved = { ...saved, url: '', token: '', username: '', password: '', method: undefined, gateways: [] }
    authMode = 'none'
    clearConnection()
    screen = 'connect'
    phase = 'idle'
    error = ''
    status = ''
    publish()
    return snapshot()
  })
  ipcMain.handle('set-theme', async (_event: IpcMainInvokeEvent, theme: ThemePreference) => {
    if (!isThemePreference(theme)) return snapshot()
    saved = { ...saved, theme }
    saveConnection(saved)
    publish()
    return snapshot()
  })
  ipcMain.handle('show-screen', async (_event: IpcMainInvokeEvent, next: AppScreen) => {
    if (next === 'connect' || next === 'settings' || next === 'chat') screen = next
    publish()
    return snapshot()
  })
  ipcMain.handle('reconnect', () => connectSaved())
  ipcMain.handle('refresh-sessions', () => client.refreshSessions())
  ipcMain.handle('open-session', (_event, id: string) => client.openSession(id))
  ipcMain.handle('set-session-pinned', (_event, payload: { id: string; pinned: boolean }) => client.setSessionPinned(payload.id, payload.pinned))
  ipcMain.handle('rename-session', (_event, payload: { id: string; title: string }) => client.renameSession(payload.id, payload.title))
  ipcMain.handle('session-info', (_event, id: string) => client.sessionInfo(id))
  ipcMain.handle('new-chat', () => client.newChat())
  ipcMain.handle('send-message', (_event, text: string, attachments?: OutgoingAttachment[]) => client.send(text, attachments))
  ipcMain.handle('steer', (_event, text: string) => client.steer(text))
  ipcMain.handle('queue', (_event, text: string, attachments?: OutgoingAttachment[]) => client.queue(text, attachments))
  ipcMain.handle('delete-queued', (_event, id: string) => client.deleteQueued(id))
  ipcMain.handle('media-url', (_event, path: string) => client.mediaUrl(path))
  ipcMain.handle('media-data', (_event, path: string) => client.mediaData(path))
  ipcMain.handle('compress', () => client.compress())
  ipcMain.handle('slash', (_event, command: string) => client.slash(command))
  ipcMain.handle('enable-notifications', () => Notification.isSupported())
  ipcMain.handle('test-approval', () => client.testApproval())
  ipcMain.handle('notify', (_event, payload: NotificationPayload) => {
    if (!Notification.isSupported()) return
    const note = new Notification({ title: payload.title, body: payload.body })
    note.on('click', () => {
      if (window?.isMinimized()) window.restore()
      window?.show()
      window?.focus()
    })
    note.show()
  })
  ipcMain.handle('interrupt', () => client.interrupt())
  ipcMain.handle('answer', (_event, payload: { id: string; result: unknown }) => client.answer(payload.id, payload.result))
  ipcMain.handle('answer-remote-clarify', (_event, payload: { clarifyId: string; answer: string }) => (
    client.answerRemoteClarify(payload.clarifyId, payload.answer)
  ))
  ipcMain.handle('answer-remote-approval', (_event, payload: { sessionKey: string; requestId: string; choice: string; reason?: string; commandDigest?: string }) => (
    client.answerRemoteApproval(payload.sessionKey, payload.requestId, payload.choice, payload.reason || '', payload.commandDigest || '')
  ))
  ipcMain.handle('set-model', (_event, payload: { model: string; provider: string; confirm?: boolean }) => (
    client.setModel(payload.model, payload.provider, Boolean(payload.confirm))
  ))
  ipcMain.handle('set-reasoning', (_event, value: string) => client.setReasoning(value))
  ipcMain.handle('set-global-reasoning', (_event, value: string) => client.setGlobalReasoning(value))
  ipcMain.handle('set-session-model', (_event, payload: { model: string; provider: string; confirm?: boolean }) => (
    client.setSessionModel(payload.model, payload.provider, Boolean(payload.confirm))
  ))
  ipcMain.on('cancel-session-model', () => client.cancelSessionModel())
  ipcMain.handle('select-profile', (_event, payload: { gatewayId: string; name: string }) => (
    client.selectProfile(payload.gatewayId, payload.name)
  ))
  ipcMain.handle('set-pinned', (_event, payload: { gatewayId: string; name: string; pinned: boolean }) => (
    client.setPinned(payload.gatewayId, payload.name, payload.pinned)
  ))
  ipcMain.handle('set-profile-hidden', (_event, payload: { gatewayId: string; name: string; hidden: boolean }) => (
    client.setProfileHidden(payload.gatewayId, payload.name, payload.hidden)
  ))
  ipcMain.handle('create-profile', (_event, label: string) => client.createProfile(label))
  ipcMain.handle('get-appearance', () => loadAppearance())
  ipcMain.handle('set-background', (_event, payload: { mode?: BackdropMode; image?: string }) => {
    if (payload.mode !== 'light' && payload.mode !== 'dark') throw new Error('Choose light or dark.')
    if (!payload.image) throw new Error('That file was empty.')
    return saveBackground(payload.mode, payload.image)
  })
  ipcMain.handle('clear-background', (_event, mode: BackdropMode) => {
    if (mode !== 'light' && mode !== 'dark') throw new Error('Choose light or dark.')
    return clearBackground(mode)
  })
  ipcMain.handle('set-backdrop', (_event, payload: { dim?: number; blur?: number }) => (
    saveBackdrop(Number(payload.dim), Number(payload.blur))
  ))
  ipcMain.handle('add-gateway', async (_event: IpcMainInvokeEvent, input: ConnectionInput & { id?: string }) => {
    const url = (input.url || '').trim()
    const next = credentials(input)
    const probe = await client.probe(url, next)
    if (!probe.ok) throw new Error(probe.message)
    const parsed = new URL(url)
    const normalized = `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`
    const gateway = {
      id: input.id || `gw-${Date.now().toString(36)}`,
      url: normalized,
      token: next.token,
      username: next.username,
      password: next.password
    }
    saved = { ...saved, gateways: [...(saved.gateways || []), gateway] }
    saveConnection(saved)
    await client.setExtraGateways(saved.gateways)
    publish()
    return snapshot()
  })
  ipcMain.handle('remove-gateway', async (_event: IpcMainInvokeEvent, id: string) => {
    saved = { ...saved, gateways: (saved.gateways || []).filter(gateway => gateway.id !== id) }
    saveConnection(saved)
    await client.setExtraGateways(saved.gateways)
    publish()
    return snapshot()
  })
}

if (process.platform === 'win32') app.setAppUserModelId('dev.megumii.icyteru')

app.whenReady().then(() => {
  saved = loadConnection()
  screen = saved.url ? 'chat' : 'connect'
  registerIpc()
  createWindow()
  if (saved.url) void connectSaved()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopDesktopNotifications()
  client.disconnect()
})
