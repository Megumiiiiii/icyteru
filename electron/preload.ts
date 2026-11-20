import { contextBridge, ipcRenderer } from 'electron'
import type { AuthDiscovery, NotificationPayload, OutgoingAttachment } from '../shared/protocol'
import type { AppScreen, Snapshot, TestResult, ThemePreference } from '../shared/snapshot'
import type { ConnectionInput } from '../src/global'

export interface Appearance {
  dim: number
  blur: number
  light: string | null
  dark: string | null
}

const api = {
  getSnapshot: (): Promise<Snapshot> => ipcRenderer.invoke('get-snapshot'),
  testConnection: (input: ConnectionInput): Promise<TestResult> => ipcRenderer.invoke('test-connection', input),
  probeAuth: (input: ConnectionInput): Promise<AuthDiscovery> => ipcRenderer.invoke('probe-auth', input),
  saveConnection: (input: ConnectionInput): Promise<Snapshot> => ipcRenderer.invoke('save-connection', input),
  forgetConnection: (): Promise<Snapshot> => ipcRenderer.invoke('forget-connection'),
  setTheme: (theme: ThemePreference): Promise<Snapshot> => ipcRenderer.invoke('set-theme', theme),
  showScreen: (screen: AppScreen): Promise<Snapshot> => ipcRenderer.invoke('show-screen', screen),
  reconnect: (): Promise<void> => ipcRenderer.invoke('reconnect'),
  refreshSessions: (): Promise<void> => ipcRenderer.invoke('refresh-sessions'),
  openSession: (id: string): Promise<void> => ipcRenderer.invoke('open-session', id),
  setSessionPinned: (id: string, pinned: boolean): Promise<void> => ipcRenderer.invoke('set-session-pinned', { id, pinned }),
  newChat: (): Promise<void> => ipcRenderer.invoke('new-chat'),
  sendMessage: (text: string, attachments?: OutgoingAttachment[]): Promise<void> => ipcRenderer.invoke('send-message', text, attachments),
  steer: (text: string): Promise<string> => ipcRenderer.invoke('steer', text),
  queue: (text: string, attachments?: OutgoingAttachment[]): Promise<void> => ipcRenderer.invoke('queue', text, attachments),
  deleteQueued: (id: string): Promise<void> => ipcRenderer.invoke('delete-queued', id),
  mediaUrl: (path: string): Promise<string> => ipcRenderer.invoke('media-url', path),
  compress: (): Promise<string> => ipcRenderer.invoke('compress'),
  slash: (command: string): Promise<string> => ipcRenderer.invoke('slash', command),
  enableNotifications: (): Promise<boolean> => ipcRenderer.invoke('enable-notifications'),
  notify: (payload: NotificationPayload): Promise<void> => ipcRenderer.invoke('notify', payload),
  testApproval: (): Promise<{ ok: boolean; session_id: string }> => ipcRenderer.invoke('test-approval'),
  interrupt: (): Promise<void> => ipcRenderer.invoke('interrupt'),
  answer: (id: string, result: unknown): Promise<void> => ipcRenderer.invoke('answer', { id, result }),
  setModel: (model: string, provider: string, confirm = false): Promise<string> => ipcRenderer.invoke('set-model', { model, provider, confirm }),
  selectProfile: (gatewayId: string, name: string): Promise<void> => ipcRenderer.invoke('select-profile', { gatewayId, name }),
  setPinned: (gatewayId: string, name: string, pinned: boolean): Promise<void> => ipcRenderer.invoke('set-pinned', { gatewayId, name, pinned }),
  createProfile: (label: string): Promise<void> => ipcRenderer.invoke('create-profile', label),
  getAppearance: (): Promise<Appearance> => ipcRenderer.invoke('get-appearance'),
  setBackground: (mode: 'light' | 'dark', image: string): Promise<Appearance> => ipcRenderer.invoke('set-background', { mode, image }),
  clearBackground: (mode: 'light' | 'dark'): Promise<Appearance> => ipcRenderer.invoke('clear-background', mode),
  setBackdrop: (dim: number, blur: number): Promise<Appearance> => ipcRenderer.invoke('set-backdrop', { dim, blur }),
  addGateway: (input: ConnectionInput): Promise<Snapshot> => ipcRenderer.invoke('add-gateway', input),
  removeGateway: (id: string): Promise<Snapshot> => ipcRenderer.invoke('remove-gateway', id),
  onSnapshot: (listener: (snapshot: Snapshot) => void): (() => void) => {
    const wrapped = (_event: unknown, snapshot: Snapshot) => listener(snapshot)
    ipcRenderer.on('snapshot', wrapped)
    return () => ipcRenderer.removeListener('snapshot', wrapped)
  }
}

contextBridge.exposeInMainWorld('icyteru', api)

export type IcyteruApi = typeof api
