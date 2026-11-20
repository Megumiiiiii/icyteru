import {
  buildCreateParams,
  buildGatewayHttpUrl,
  buildGatewayWsUrl,
  cookieHeaderFromSetCookie,
  detectAuthMode,
  historyFromRows,
  normalizeMemory,
  normalizeModels,
  normalizeSessions,
  normalizeSkills,
  sortSessions,
  parseGatewayBase,
  pickSessionIds,
  readCreateContract,
  questionFromControlEvent,
  redactSecrets,
  acceptAvatar,
  appendUser,
  applyGatewayEvent,
  emptyTranscript,
  normalizeProfiles,
  type AgentProfile,
  type AuthDiscovery,
  type AuthMode,
  type CreateContract,
  type GatewayEventFrame,
  type MemoryView,
  type OutgoingAttachment,
  type PendingQuestion,
  type SessionRow,
  type Transcript
} from '../shared/protocol'
import { HermesSocket } from '../shared/gateway-socket'
import type { QueuedMessage } from '../shared/snapshot'

export interface ProbeResult {
  ok: boolean
  message: string
  version?: string
  wsUrl?: string
  protocols?: string[]
  mode?: AuthMode
}

/** Credentials the user can bring to a gateway. Any field may be empty. */
export interface ConnectionCredentials {
  token: string
  username: string
  password: string
  method?: 'password' | 'token'
}

export function emptyCredentials(): ConnectionCredentials {
  return { token: '', username: '', password: '' }
}

interface LiveSession {
  live: string
  stored: string
  subscriptionId: string
}

export interface GatewayRef {
  id: string
  url: string
  token: string
  username: string
  password: string
  cookie: string
  label: string
}

export interface GatewayInput {
  id: string
  url: string
  token: string
  username?: string
  password?: string
}

export class HermesClient {
  private socket: HermesSocket | null = null
  private contract: CreateContract | null = null
  private profileName = 'Hermes'
  private avatar = ''
  private profiles: AgentProfile[] = []
  private gateways: GatewayRef[] = []
  private activeProfile = 'default'
  private activeGatewayId = 'primary'
  private version = ''
  private live: LiveSession | null = null
  private transcript: Transcript = emptyTranscript()
  private sessions: SessionRow[] = []
  private question: PendingQuestion | null = null
  private queued: QueuedMessage[] = []
  private queuePoll: ReturnType<typeof setInterval> | null = null
  private queuePolling = false
  private executionGeneration = 0
  private revision = 0
  private wsUrl = ''
  private protocols: string[] = []
  private baseUrl = ''
  private token = ''
  private username = ''
  private password = ''
  private cookie = ''
  private authMode: AuthMode = 'none'
  private loginProvider = 'basic'
  private readonly browser = typeof window !== 'undefined'
  private listStyle: 'picker' | 'plain' = 'picker'
  private reconnecting = false
  lastError = ''

  constructor(private readonly emit: () => void) {}

  get state() {
    return {
      profileName: this.profileName,
      avatar: this.avatar,
      profiles: this.profiles,
      activeProfile: this.activeProfile,
      activeGatewayId: this.activeGatewayId,
      gateways: this.gateways.map(gateway => ({ id: gateway.id, url: gateway.url, label: gateway.label })),
      authMode: this.authMode,
      version: this.version,
      transcript: this.transcript,
      sessions: this.sessions,
      question: this.question,
      queued: this.queued.filter(entry => entry.sessionId === this.live?.stored),
      connected: Boolean(this.socket?.isOpen),
      activeSessionId: this.live?.stored || '',
      side: this.side
    }
  }

  /** WebViews keep the cookie jar themselves; Electron main needs explicit headers. */
  private authFetch(url: string, init: RequestInit = {}): Promise<Response> {
    return this.browser ? fetch(url, { ...init, credentials: 'include' }) : fetch(url, init)
  }

  /** Read the public gateway probe and work out which login fields to show. */
  async discover(baseUrl: string): Promise<AuthDiscovery> {
    let status: unknown
    try {
      const response = await this.authFetch(buildGatewayHttpUrl(baseUrl, '/api/status'))
      if (!response.ok) {
        return { ok: false, message: `The gateway status check returned ${response.status}.`, mode: 'unknown', authRequired: false, providers: [] }
      }
      status = await response.json()
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Could not reach the gateway.', mode: 'unknown', authRequired: false, providers: [] }
    }
    const body = asRecord(status)
    const mode = detectAuthMode(status)
    const providers = Array.isArray(body.auth_providers)
      ? body.auth_providers.filter((name): name is string => typeof name === 'string')
      : []
    const messages: Record<AuthMode, string> = {
      none: 'This gateway is open. No login is needed.',
      token: 'This gateway asks for a session token.',
      password: 'This gateway asks for a username and password.',
      either: 'This gateway accepts a session token or a username and password.',
      unknown: 'This gateway requires login but did not say how. Try a session token or username and password.'
    }
    return {
      ok: true,
      message: messages[mode],
      mode,
      authRequired: body.auth_required === true,
      providers
    }
  }

  async probe(baseUrl: string, creds: ConnectionCredentials): Promise<ProbeResult> {
    const discovery = await this.discover(baseUrl)
    if (!discovery.ok) return { ok: false, message: discovery.message, mode: discovery.mode }
    await this.prepare(baseUrl, creds, discovery.mode, discovery.providers)
    const status = await this.readStatus(baseUrl)
    const dial = await this.openSocket(baseUrl)
    return {
      ok: true,
      message: `Connected to Hermes ${status.version || ''}.`.replace('Hermes .', 'Hermes.').replace('Hermes .', 'Hermes') + ` (${authModeHint(this.authMode)})`,
      version: status.version,
      wsUrl: dial.wsUrl,
      protocols: dial.protocols,
      mode: this.authMode
    }
  }

  async connect(baseUrl: string, creds: ConnectionCredentials, extras: GatewayInput[] = []): Promise<void> {
    this.reconnecting = true
    try {
      await this.connectInner(baseUrl, creds, extras)
    } finally {
      this.reconnecting = false
    }
  }

  private async connectInner(baseUrl: string, creds: ConnectionCredentials, extras: GatewayInput[] = []): Promise<void> {
    this.disconnect()
    const discovery = await this.discover(baseUrl)
    if (!discovery.ok) throw new Error(discovery.message)
    await this.prepare(baseUrl, creds, discovery.mode, discovery.providers)
    const primary = gatewayRef('primary', baseUrl, this.token, this.username, this.password, this.cookie)
    this.gateways = [primary, ...extras.map(extra => gatewayRef(extra.id, extra.url, extra.token, extra.username || '', extra.password || '', ''))]
    this.activeGatewayId = primary.id
    this.baseUrl = primary.url
    const status = await this.readStatus(this.baseUrl)
    this.version = status.version
    const dial = await this.openSocket(this.baseUrl)
    this.wsUrl = dial.wsUrl
    this.protocols = dial.protocols
    this.socket = dial.socket
    await this.afterReady()
    await this.refreshRoster()
    const home = this.profiles.find(profile => profile.gatewayId === primary.id && profile.name === 'default')
      || this.profiles.find(profile => profile.gatewayId === primary.id)
      || this.profiles[0]
    if (home) this.applyProfile(home)
    await this.refreshSideData()
    await this.refreshSessions()
  }

  async setExtraGateways(extras: GatewayInput[]): Promise<void> {
    const primary = this.gateways.find(gateway => gateway.id === 'primary')
    if (!primary) return
    this.gateways = [primary, ...extras.map(extra => gatewayRef(extra.id, extra.url, extra.token, extra.username || '', extra.password || '', ''))]
    await this.refreshRoster()
  }

  /**
   * Install the credentials for this connection. A gateway that advertises a
   * password provider gets a POST to /auth/password-login; the Set-Cookie
   * values are replayed on every later REST call and used to mint a WS ticket.
   */
  private async prepare(baseUrl: string, creds: ConnectionCredentials, mode: AuthMode, providers: string[] = []): Promise<void> {
    this.token = (creds.token || '').trim()
    this.username = (creds.username || '').trim()
    this.password = creds.password || ''
    this.cookie = ''
    this.authMode = mode
    this.loginProvider = providers.includes('basic') ? 'basic' : providers.includes('password') ? 'password' : 'basic'
    // The sign-in form lets the user pick one method explicitly. Only that
    // credential is used, so a saved token cannot silently override a password.
    const wanted = creds.method
      || (mode === 'token' ? 'token' : mode === 'password' ? 'password' : '')
      || (this.username && this.password ? 'password' : this.token ? 'token' : '')
    if (wanted === 'password') {
      if (!this.username || !this.password) throw new Error('Enter the username and password for this gateway.')
      await this.passwordLogin(baseUrl)
      return
    }
    if (wanted === 'token') {
      if (!this.token) throw new Error('Enter the session token for this gateway.')
      this.authMode = 'token'
      return
    }
    if (mode === 'password' || mode === 'either' || mode === 'unknown') {
      throw new Error('Choose password or session token for this gateway.')
    }
  }

  private async passwordLogin(baseUrl: string): Promise<void> {
    const response = await this.authFetch(buildGatewayHttpUrl(baseUrl, '/auth/password-login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: this.loginProvider, username: this.username, password: this.password })
    })
    if (!response.ok) {
      if (response.status === 401) throw new Error('Hermes refused that username or password.')
      if (response.status === 429) throw new Error('Too many login attempts. Try again shortly.')
      if (response.status === 404) throw new Error('This gateway does not offer password login.')
      throw new Error(`Hermes rejected the login (${response.status}).`)
    }
    const header = response.headers as Headers & { getSetCookie?: () => string[] }
    const values = typeof header.getSetCookie === 'function' ? header.getSetCookie() : [header.get('set-cookie') || '']
    this.cookie = cookieHeaderFromSetCookie(values)
    if (!this.cookie && this.browser) {
      // Browsers and WebViews forbid JS from reading Set-Cookie. The platform
      // cookie jar keeps the session; prove it with an authenticated read.
      const check = await this.authFetch(buildGatewayHttpUrl(baseUrl, '/api/auth/me'))
      if (!check.ok) {
        throw new Error('Hermes signed you in, but this device did not keep the session. Use the Token tab, or allow cookies for this gateway.')
      }
      this.cookie = 'browser-session'
      return
    }
    if (!this.cookie) throw new Error('Hermes signed you in but sent back no session cookie.')
  }

  /** A cookie can expire while the app stays open; one fresh login is enough. */
  private async renewSession(): Promise<boolean> {
    if (!this.username || !this.password || !this.baseUrl) return false
    try {
      await this.passwordLogin(this.baseUrl)
      return true
    } catch {
      return false
    }
  }

  private hasCredential(): boolean {
    return Boolean(this.token || this.cookie)
  }

  async selectProfile(gatewayId: string, name: string): Promise<void> {
    const gateway = this.gateways.find(item => item.id === gatewayId)
    const profile = this.profiles.find(item => item.gatewayId === gatewayId && item.name === name)
    if (!gateway || !profile) throw new Error('That Hermes profile is not on this gateway.')
    if (this.activeGatewayId !== gateway.id || !this.socket?.isOpen) {
      await this.activateGateway(gateway)
    }
    this.applyProfile(profile)
    await this.newChat()
    await this.refreshSideData()
    await this.refreshSessions()
  }

  async setPinned(gatewayId: string, name: string, pinned: boolean): Promise<void> {
    const profile = this.profiles.find(item => item.gatewayId === gatewayId && item.name === name)
    if (!profile) return
    if (this.activeGatewayId !== gatewayId || !this.socket?.isOpen) {
      const gateway = this.gateways.find(item => item.id === gatewayId)
      if (!gateway) return
      await this.activateGateway(gateway)
    }
    const meta = { ...profile.botMeta, pinned }
    const result = await this.tryRpc('profiles.configure', { name, ui_meta: { 'hermes-bots': meta } })
    if (!result.ok) throw new Error(result.error || 'Hermes did not save the pin.')
    await this.refreshRoster()
  }

  async createProfile(label: string): Promise<void> {
    const title = label.trim()
    const name = title.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    if (!/^[a-z0-9]/.test(name)) throw new Error('Use a name made of letters and numbers, such as scout.')
    const created = await this.tryRpc('profiles.create', { name })
    if (!created.ok) await this.postJson('/api/profiles', { name })
    if (title && title !== name) {
      await this.tryRpc('profiles.configure', { name, ui_meta: { 'hermes-bots': { title } } })
    }
    await this.refreshRoster()
    const profile = this.profiles.find(item => item.name === name && item.gatewayId === this.activeGatewayId)
    if (profile) await this.selectProfile(profile.gatewayId, profile.name)
  }

  disconnect(): void {
    if (this.queuePoll) clearInterval(this.queuePoll)
    this.queuePoll = null
    this.queuePolling = false
    this.socket?.close()
    this.socket = null
    this.live = null
    this.question = null
    this.transcript = emptyTranscript()
  }

  async testApproval(): Promise<{ ok: boolean; session_id: string }> {
    return await this.postJson('/api/plugins/icyteru-push/test-approval', {}) as { ok: boolean; session_id: string }
  }

  /** Recent gateway notifications for desktop clients (Android uses FCM). */
  async notificationFeed(since: number): Promise<Array<{ at: number; title: string; body: string; session_id: string }>> {
    try {
      const payload = await this.getJson(`/api/plugins/icyteru-push/events?since=${encodeURIComponent(String(since))}`)
      const body = asRecord(payload)
      if (!Array.isArray(body.events)) return []
      return body.events.flatMap(item => {
        const event = asRecord(item)
        const at = Number(event.at)
        if (!Number.isFinite(at)) return []
        return [{
          at,
          title: typeof event.title === 'string' ? event.title : 'Icyteru',
          body: typeof event.body === 'string' ? event.body : '',
          session_id: typeof event.session_id === 'string' ? event.session_id : ''
        }]
      })
    } catch {
      return []
    }
  }

  async refreshSessions(): Promise<void> {
    if (this.listStyle === 'picker') {
      const listed = await this.listSessions({ scope: 'stored', limit: 60, picker: true })
      if (listed.ok) {
        this.sessions = sortSessions(normalizeSessions(listed.value))
        this.emit()
        return
      }
      this.listStyle = 'plain'
    }
    const fallback = await this.listSessions({ limit: 60 })
    if (fallback.ok) {
      this.sessions = sortSessions(normalizeSessions(fallback.value))
      this.emit()
      return
    }
    const rest = await this.getJson('/api/sessions?limit=60&order=recent').catch(() => null)
    if (rest) this.sessions = sortSessions(normalizeSessions(rest))
    this.emit()
  }

  async openSession(id: string): Promise<void> {
    await this.detach()
    let resumed: unknown
    try {
      resumed = await this.rpc('session.resume', this.scope({ session_id: id, display_projection: true }))
    } catch {
      resumed = await this.rpc('session.resume', this.scope({ session_id: id }))
    }
    const ids = pickSessionIds(resumed) ?? { live: id, stored: id }
    const body = asRecord(resumed)
    const stored = typeof body.stored_session_id === 'string' && body.stored_session_id
      ? body.stored_session_id
      : id
    this.executionGeneration = typeof body.execution_generation === 'number' ? body.execution_generation : 0
    this.revision = typeof body.revision === 'number' ? body.revision : 0
    this.live = {
      live: ids.live,
      stored,
      subscriptionId: typeof body.subscription_id === 'string' ? body.subscription_id : ''
    }
    const messages = Array.isArray(body.display_messages) ? body.display_messages : body.messages
    this.transcript = historyFromRows(messages)
    if (!this.transcript.messages.length) {
      const rest = await this.getJson(`/api/sessions/${encodeURIComponent(id)}/messages?limit=200&order=oldest`).catch(() => null)
      const rows = Array.isArray(rest) ? rest : asRecord(rest).messages
      if (rows) this.transcript = historyFromRows(rows)
    }
    this.question = null
    this.emit()
  }

  async setSessionPinned(id: string, pinned: boolean): Promise<void> {
    await this.postJson('/api/plugins/icyteru-push/session-pin', { session_id: id, pinned })
    this.sessions = sortSessions(this.sessions.map(row => row.id === id ? { ...row, pinned } : row))
    this.emit()
    await this.refreshSessions()
  }

  async newChat(): Promise<void> {
    await this.detach()
    this.live = null
    this.executionGeneration = 0
    this.revision = 0
    this.transcript = emptyTranscript()
    this.question = null
    this.emit()
  }

  async send(text: string, attachments: OutgoingAttachment[] = []): Promise<void> {
    const body = text.trim()
    if (!body && attachments.length === 0) return
    await this.ensureLive()
    const submissionId = crypto.randomUUID()
    const display = body || (attachments.some(file => file.mime.startsWith('image/')) ? 'Image attached' : 'File attached')
    this.transcript = appendUser(this.transcript, display, `local-${submissionId}`)
    this.emit()
    try {
      const liveId = this.live!.live
      const params = {
        session_id: liveId,
        ...await this.promptContent(liveId, body, attachments),
        input_id: submissionId
      }
      try {
        await this.rpc('prompt.submit', this.scope(params))
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (!/invalid|unexpected|unknown param/i.test(message)) throw error
        await this.rpc('prompt.submit', this.scope({ ...params, input_id: undefined }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Hermes did not accept the message.'
      this.transcript = {
        ...this.transcript,
        streaming: false,
        messages: this.transcript.messages.map(item => item.id === `local-${submissionId}` ? { ...item, error: message } : item)
      }
      this.emit()
      throw error
    }
  }

  private async promptContent(liveId: string, body: string, attachments: OutgoingAttachment[]) {
    const refs: string[] = []
    const images: Array<{ path: string; mime: string }> = []
    for (const file of attachments) {
      const staged = await this.stageAttachment(liveId, file)
      if (staged.ref) refs.push(staged.ref)
      if (staged.image) images.push(staged.image)
    }
    return {
      text: [...refs, body].filter(Boolean).join('\n\n') || 'What do you see in this image?',
      ...(images.length ? { attachments: images } : {})
    }
  }

  async queue(text: string, attachments: OutgoingAttachment[] = []): Promise<void> {
    const body = text.trim()
    if (!body && !attachments.length) throw new Error('Write a message to queue.')
    await this.ensureLive()
    const session = this.live!
    const scope = this.scope({ session_id: session.live })
    const entry: QueuedMessage = {
      id: crypto.randomUUID(), sessionId: session.stored, text: body,
      attachmentNames: attachments.map(file => file.name), status: 'queued', createdAt: Date.now()
    }
    const content = await this.promptContent(session.live, body, attachments)
    const receipt = asRecord(await this.rpc('prompt.submit', {
      ...scope, ...content, input_id: entry.id, queued: true
    }))
    this.trackReceipt(entry, receipt)
  }

  private trackReceipt(entry: QueuedMessage, receipt: Record<string, unknown>): void {
    if (receipt.status === 'rejected' || receipt.status === 'failed' || receipt.outcome === 'failed') {
      throw new Error('Hermes could not run the queued message.')
    }
    if (receipt.status === 'started' || receipt.status === 'streaming' || receipt.status === 'terminal' || receipt.voice_stopped === true) return
    if (receipt.status !== 'queued' && receipt.status !== 'unknown') {
      throw new Error('Unexpected queue status. Check the chat before resending.')
    }
    if (typeof receipt.admission_id !== 'string' || !receipt.admission_id) {
      throw new Error('Hermes did not return a queue receipt. Check the chat before resending.')
    }
    entry.status = receipt.status
    entry.admissionId = receipt.admission_id
    this.queued.push(entry)
    this.startQueuePolling()
    this.emit()
  }

  async editQueued(id: string, text: string): Promise<void> {
    const entry = this.queued.find(item => item.id === id)
    const body = text.trim()
    if (!entry || entry.sessionId !== this.live?.stored || entry.status !== 'queued' || !entry.admissionId) {
      throw new Error('That message is no longer queued.')
    }
    if (entry.attachmentNames?.length) throw new Error('Messages with attachments cannot be edited.')
    if (!body) throw new Error('Write a replacement message.')
    const inputId = crypto.randomUUID()
    // Atomic replacement refuses a claimed admission. Never cancel and resubmit.
    const receipt = asRecord(await this.rpc('prompt.replace_queued', this.scope({
      session_id: this.live.live, admission_id: entry.admissionId, text: body, submission_id: inputId
    })))
    this.queued = this.queued.filter(item => item !== entry)
    this.trackReceipt({ ...entry, id: inputId, text: body }, receipt)
    this.emit()
  }

  async deleteQueued(id: string): Promise<void> {
    const entry = this.queued.find(item => item.id === id)
    if (!entry) return
    // prompt.cancel interrupts a started admission, even if a receipt just said queued.
    if (entry.status !== 'failed') throw new Error('This gateway cannot safely delete a pending message.')
    this.queued = this.queued.filter(item => item !== entry)
    this.emit()
  }

  private startQueuePolling(): void {
    if (this.queuePoll) return
    this.queuePoll = setInterval(() => {
      void this.refreshQueued()
    }, 1500)
  }

  private async refreshQueued(): Promise<void> {
    if (this.queuePolling) return
    const pending = this.queued.filter(entry => entry.status !== 'failed' && entry.admissionId)
    if (!pending.length) {
      if (this.queuePoll) clearInterval(this.queuePoll)
      this.queuePoll = null
      return
    }
    this.queuePolling = true
    try {
      for (const entry of pending) {
        try {
          const result = await this.rpc('prompt.receipt', {
            session_id: entry.sessionId,
            admission_id: entry.admissionId
          })
          const record = asRecord(result)
          if (record.status === 'failed' || record.status === 'rejected' || record.outcome === 'failed') {
            entry.status = 'failed'
            entry.error = 'Hermes could not run this queued message.'
          } else if (record.status === 'started' || record.status === 'terminal' || record.status === 'cancelled') {
            this.queued = this.queued.filter(item => item !== entry)
          } else if (record.status === 'unknown' || record.status === 'queued') {
            entry.status = record.status
          }
        } catch {
          // Keep the entry; a transient receipt error should not drop the user's message.
        }
      }
      this.emit()
    } finally {
      this.queuePolling = false
      if (!this.queued.some(entry => entry.status !== 'failed' && entry.admissionId) && this.queuePoll) {
        clearInterval(this.queuePoll)
        this.queuePoll = null
      }
    }
  }

  /** Reply mid-turn so the agent reads it at its next tool result. */
  async steer(text: string): Promise<string> {
    await this.ensureLive()
    let generation = this.executionGeneration
    if (!generation) generation = await this.fetchGeneration()
    if (!generation) throw new Error('Steer needs a running turn. Send it as a normal message instead.')
    let result: unknown
    try {
      result = await this.rpc('session.steer', { session_id: this.live!.live, text: text.trim(), execution_generation: generation })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (!/invalid_params|stale_generation/i.test(message)) throw error
      generation = await this.fetchGeneration()
      if (!generation) throw new Error('Steer needs a running turn. Send it as a normal message instead.')
      result = await this.rpc('session.steer', { session_id: this.live!.live, text: text.trim(), execution_generation: generation })
    }
    const record = asRecord(result)
    if (record.status === 'queued') return 'Steered — the agent will read it at its next tool call.'
    if (record.status === 'rejected') return 'Steer rejected — the agent declined the input.'
    return 'Steer sent.'
  }

  /** Run the gateway's dedicated compression RPC, then show its new history. */
  async compress(): Promise<string> {
    await this.ensureLive()
    let revision = this.revision
    if (!Number.isFinite(revision)) revision = 0
    const result = await this.rpc('session.mutate', {
      session_id: this.live!.live,
      request_id: `compress:${crypto.randomUUID()}`,
      expected_revision: revision,
      operation: 'compress',
      payload: {}
    }, 300_000)
    const record = asRecord(result)
    const rows = Array.isArray(record.messages) ? record.messages : null
    if (rows) {
      this.transcript = historyFromRows(rows)
      this.emit()
    }
    void this.refreshSessions()
    if (record.status === 'pending') {
      return 'Compression is still running on Hermes; the new history will appear when it finishes.'
    }
    const summary = asRecord(record.summary)
    const headline = typeof summary.headline === 'string' ? summary.headline : ''
    const tokenLine = typeof summary.token_line === 'string' ? summary.token_line : ''
    const hostAck = asRecord(record.host_ack)
    const ack = typeof hostAck.output === 'string' ? hostAck.output : ''
    const message = typeof record.message === 'string' ? record.message : ''
    return [headline, tokenLine, ack, message].filter(Boolean).join('\n') || 'Context compressed.'
  }

  /** Fallback for any other gateway slash command. */
  async slash(command: string): Promise<string> {
    await this.ensureLive()
    const name = command.trim().replace(/^\/+/, '').split(/\s+/)[0] || 'command'
    const result = await this.rpc('slash.exec', {
      session_id: this.live!.live,
      command: command.trim().replace(/^\/+/, '')
    })
    const record = asRecord(result)
    if ((record.type === 'send' || record.type === 'skill') && typeof record.text === 'string' && record.text.trim()) {
      await this.send(record.text)
      return typeof record.notice === 'string' ? record.notice : `/${name}: sent.`
    }
    const output = [record.output, record.warning].filter(value => typeof value === 'string' && value.trim()).join('\n')
    return output || `/${name}: no output`
  }

  /** The live turn's generation, read from a resume when no event carried it yet. */
  private async fetchGeneration(): Promise<number> {
    if (!this.live) return 0
    try {
      const resumed = await this.rpc('session.resume', { session_id: this.live.live })
      const body = asRecord(resumed)
      if (typeof body.execution_generation === 'number') this.executionGeneration = body.execution_generation
    } catch {
      // The caller turns a missing generation into a clear message.
    }
    return this.executionGeneration
  }

  private async ensureLive(): Promise<void> {
    if (this.live) return
    const created = await this.createSession()
    this.live = { ...created, subscriptionId: '' }
    await this.refreshSessions()
  }

  /** Stage bytes in the session workspace, the same RPCs Hermes Desktop uses. */
  private async stageAttachment(sessionId: string, file: OutgoingAttachment): Promise<{ ref: string; image?: { path: string; mime: string } }> {
    if (file.mime.startsWith('image/')) {
      const result = await this.rpc('image.attach_bytes', this.scope({
        session_id: sessionId,
        content_base64: file.base64,
        filename: file.name
      }))
      const record = asRecord(result)
      if (record.attached !== true) {
        throw new Error(typeof record.message === 'string' ? record.message : `Could not attach ${file.name}.`)
      }
      const path = typeof record.path === 'string' ? record.path : ''
      return { ref: path ? `@image:${path}` : '', image: path ? { path, mime: file.mime } : undefined }
    }
    const result = await this.rpc('file.attach', this.scope({
      session_id: sessionId,
      name: file.name,
      data_url: `data:${file.mime || 'application/octet-stream'};base64,${file.base64}`
    }))
    const record = asRecord(result)
    if (record.attached !== true || typeof record.ref_text !== 'string') {
      throw new Error(typeof record.message === 'string' ? record.message : `Could not attach ${file.name}.`)
    }
    return { ref: record.ref_text }
  }

  async interrupt(): Promise<void> {
    if (!this.live) return
    await this.rpc('session.interrupt', this.scope({ session_id: this.live.live })).catch(() => undefined)
    this.transcript = { ...this.transcript, streaming: false }
    this.emit()
  }

  async answer(id: string, result: unknown): Promise<void> {
    const question = this.question
    if (question?.id === id && question.test) {
      this.question = null
      this.emit()
      return
    }
    if (question?.id === id && question.promptId) {
      const record = asRecord(result)
      if (question.method === 'approval.request') {
        const choice = typeof record.choice === 'string' ? record.choice : 'deny'
        await this.rpc('approval.respond', {
          session_id: question.sessionId,
          execution_generation: question.executionGeneration ?? 0,
          prompt_id: question.promptId,
          choice
        })
      } else if (question.method === 'clarify.request') {
        let answer = typeof record.answer === 'string' ? record.answer : ''
        if (!answer && record.answers && typeof record.answers === 'object') {
          const answers = asRecord(record.answers)
          answer = Object.values(answers)
            .flatMap(value => Array.isArray(value) ? value : [value])
            .map(value => String(value))
            .filter(Boolean)
            .join(', ')
        }
        await this.rpc('clarify.respond', {
          session_id: question.sessionId,
          execution_generation: question.executionGeneration ?? 0,
          prompt_id: question.promptId,
          answer
        })
      } else {
        this.socket?.respond(id, result)
      }
      if (this.question?.id === id) this.question = null
      this.emit()
      return
    }
    this.socket?.respond(id, result)
    if (this.question?.id === id) this.question = null
    this.emit()
  }

  async setModel(model: string, provider: string, confirm = false): Promise<string> {
    const response = await this.postJson('/api/model/set', {
      scope: 'main',
      provider,
      model,
      confirm_expensive_model: confirm,
      profile: this.activeProfile || undefined
    })
    const body = asRecord(response)
    if (body.confirm_required === true && !confirm) {
      throw new Error(String(body.confirm_message || 'Hermes asked for confirmation before switching to this model.'))
    }
    if (body.ok === false) {
      throw new Error(String(body.confirm_message || body.detail || 'Hermes did not change the model.'))
    }
    if (this.live) {
      await this.tryRpc('command.dispatch', this.scope({ session_id: this.live.live, name: 'model', arg: model }))
    }
    await this.refreshSideData()
    return 'Model saved on Hermes. New messages use it.'
  }

  private async createSession(): Promise<{ live: string; stored: string }> {
    const params = buildCreateParams(this.contract, crypto.randomUUID(), undefined, undefined, this.activeProfile || undefined)
    let created: unknown
    try {
      created = await this.rpc('session.create', params)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/source|policy|unsupported|client/i.test(message)) {
        created = await this.rpc('session.create', {
          source: params.source === 'gui' ? 'tui' : params.source || 'tui',
          ...(this.activeProfile ? { profile: this.activeProfile } : {})
        })
      } else {
        throw error instanceof Error ? error : new Error(message || 'Hermes did not start a chat.')
      }
    }
    const ids = pickSessionIds(created)
    if (!ids) throw new Error('Hermes did not return a session id.')
    const createdBody = asRecord(created)
    if (typeof createdBody.execution_generation === 'number') this.executionGeneration = createdBody.execution_generation
    if (typeof createdBody.revision === 'number') this.revision = createdBody.revision
    await this.tryRpc('onboarding.skip', this.scope({ session_id: ids.live }))
    return ids
  }

  private async afterReady(): Promise<void> {
    await this.tryRpc('client.capabilities', { server_requests: true })
    const described = await this.tryRpc('runtime.describe', {})
    if (described.ok) this.contract = readCreateContract(described.value)
  }

  private async refreshSideData(): Promise<void> {
    const soulPath = `/api/profiles/${encodeURIComponent(this.activeProfile || 'default')}/soul`
    const [models, skills, memory, soul] = await Promise.all([
      this.getJson('/api/model/options').catch(() => null),
      this.getJson('/api/skills').catch(() => null),
      this.getJson('/api/memory').catch(() => null),
      this.getJson(soulPath).catch(() => null)
    ])
    const soulText = typeof asRecord(soul).content === 'string' ? String(asRecord(soul).content).trim() : ''
    this.side = {
      models: models ? normalizeModels(models) : { currentModel: '', currentProvider: '', models: [] },
      skills: skills ? normalizeSkills(skills) : [],
      skillsNote: skills ? '' : 'This gateway does not share a skill list.',
      memory: memory ? normalizeMemory(memory) : { available: false, summary: '', notes: '', user: '', instructions: '' },
      instructionsNote: soulText
    }
    if (soulText) this.side.memory = { ...this.side.memory, instructions: soulText }
    this.emit()
  }

  side: {
    models: ReturnType<typeof normalizeModels>
    skills: ReturnType<typeof normalizeSkills>
    skillsNote: string
    memory: MemoryView
    instructionsNote?: string
  } = {
    models: { currentModel: '', currentProvider: '', models: [] },
    skills: [],
    skillsNote: '',
    memory: { available: false, summary: '', notes: '', user: '', instructions: '' },
    instructionsNote: ''
  }

  private async detach(): Promise<void> {
    if (!this.live?.subscriptionId) return
    await this.tryRpc('session.detach', this.scope({
      session_id: this.live.live,
      subscription_id: this.live.subscriptionId
    }))
  }

  private applyProfile(profile: AgentProfile): void {
    this.activeProfile = profile.name
    this.activeGatewayId = profile.gatewayId
    this.profileName = profile.label
    this.avatar = profile.avatar
  }

  private async refreshRoster(): Promise<void> {
    const profiles: AgentProfile[] = []
    for (const gateway of this.gateways) {
      if (gateway.id === this.activeGatewayId && this.socket?.isOpen) {
        profiles.push(...await this.readProfiles(this.socket, gateway))
      } else {
        profiles.push(...await this.readProfiles(null, gateway))
      }
    }
    this.profiles = profiles.filter(profile => !profile.hidden).length
      ? profiles.filter(profile => !profile.hidden)
      : profiles
    if (!this.profiles.length) {
      this.profiles = [{
        gatewayId: this.activeGatewayId,
        name: 'default',
        label: 'Hermes',
        description: '',
        model: '',
        avatar: '',
        initial: 'H',
        hasAvatar: false,
        preview: '',
        lastActive: null,
        pinned: false,
        hidden: false,
        botMeta: {}
      }]
    }
    const current = this.profiles.find(profile => profile.gatewayId === this.activeGatewayId && profile.name === this.activeProfile)
    if (current) this.applyProfile(current)
    this.emit()
  }

  private async readProfiles(socket: HermesSocket | null, gateway: GatewayRef): Promise<AgentProfile[]> {
    let payload: unknown = null
    let owned = socket
    if (!owned) {
      try {
        const dial = await this.openSocket(gateway.url, gateway.token, false, false, { token: gateway.token, cookie: gateway.cookie })
        owned = dial.socket
      } catch {
        owned = null
      }
    }
    if (owned?.isOpen) {
      payload = await owned.request('profiles.list', { include_sessions: true }).catch(() => null)
    }
    let profiles = normalizeProfiles(payload, gateway.id)
    if (!profiles.length) {
      try {
        const headers = headersFor(gateway)
        if (this.browser) delete headers.Cookie
        const response = await this.authFetch(buildGatewayHttpUrl(gateway.url, '/api/profiles'), { headers })
        if (response.ok) profiles = normalizeProfiles(await response.json(), gateway.id)
      } catch {
        profiles = []
      }
    }
    if (owned?.isOpen) await this.attachAvatars(owned, profiles)
    if (owned && owned !== socket) owned.close()
    return profiles
  }

  private async attachAvatars(socket: HermesSocket, profiles: AgentProfile[]): Promise<void> {
    await Promise.all(profiles.map(async profile => {
      if (profile.hasAvatar === false) return
      const result = await socket.request('profiles.get_asset', { name: profile.name, asset: 'avatar' }).catch(() => null)
      const body = asRecord(result)
      if (body.found === true) profile.avatar = acceptAvatar(body.data)
    }))
  }

  private async activateGateway(gateway: GatewayRef): Promise<void> {
    this.socket?.close()
    this.socket = null
    this.live = null
    this.question = null
    this.transcript = emptyTranscript()
    this.listStyle = 'picker'
    this.baseUrl = gateway.url
    this.token = gateway.token
    this.activeGatewayId = gateway.id
    this.username = gateway.username || ''
    this.password = gateway.password || ''
    this.cookie = gateway.cookie || ''
    this.authMode = this.token ? 'token' : this.cookie ? 'password' : 'none'
    this.loginProvider = 'basic'
    if (this.username && this.password && !this.cookie && !this.token) {
      await this.passwordLogin(gateway.url)
      gateway.cookie = this.cookie
      this.authMode = 'password'
    }
    const status = await this.readStatus(gateway.url)
    this.version = status.version
    const dial = await this.openSocket(gateway.url, gateway.token, false)
    this.wsUrl = dial.wsUrl
    this.protocols = dial.protocols
    this.socket = dial.socket
    this.lastError = ''
    await this.afterReady()
  }

  private scope(params: Record<string, unknown>): Record<string, unknown> {
    if (!this.activeProfile) return params
    return { ...params, profile: this.activeProfile }
  }

  private async listSessions(params: Record<string, unknown>) {
    const scoped = this.scope(params)
    const listed = await this.tryRpc('session.list', scoped)
    if (listed.ok || !scoped.profile) return listed
    if (/extra inputs|invalid params/i.test(listed.error)) return this.tryRpc('session.list', params)
    return listed
  }

  private withProfile(path: string): string {
    if (!this.activeProfile || /[?&]profile=/.test(path)) return path
    const join = path.includes('?') ? '&' : '?'
    return `${path}${join}profile=${encodeURIComponent(this.activeProfile)}`
  }

  private async readStatus(baseUrl: string): Promise<{ version: string; authRequired: boolean }> {
    const fetchStatus = () => this.authFetch(buildGatewayHttpUrl(baseUrl, '/api/status'), { headers: this.headers() })
    let response = await fetchStatus()
    if ((response.status === 401 || response.status === 403) && await this.renewSession()) response = await fetchStatus()
    if (response.status === 401 || response.status === 403) {
      throw new Error(this.cookie
        ? 'Hermes refused the username or password. Check the credentials on this gateway.'
        : 'Hermes refused the session token. Check the token from the machine running the gateway.')
    }
    if (!response.ok) {
      throw new Error(`The gateway status check returned ${response.status}.`)
    }
    const body = asRecord(await response.json())
    if (body.auth_required === true && !this.hasCredential()) {
      throw new Error('This gateway requires login. Add a session token or a username and password in Settings.')
    }
    return {
      version: typeof body.version === 'string' ? body.version : '',
      authRequired: body.auth_required === true
    }
  }

  private async openSocket(baseUrl: string, token = '', probe = false, attached = true, auth?: { token: string; cookie: string }): Promise<{ socket: HermesSocket; wsUrl: string; protocols: string[] }> {
    const useToken = auth ? (auth.token || '') : (token || this.token)
    const useCookie = auth ? (auth.cookie || '') : this.cookie
    const attempts: Array<{ url: string; protocols: string[] }> = []
    // Browsers (and Electron's WebSocket) cannot set Cookie or Authorization on
    // the upgrade. Hermes mints a single-use ticket from the session instead.
    if (useCookie) {
      const ticket = await this.mintTicket(baseUrl, useToken, useCookie)
      if (ticket) attempts.push({
        url: buildGatewayWsUrl(baseUrl, undefined, { native_dial: 'browser' }),
        protocols: ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`]
      })
    }
    if (useToken) attempts.push({ url: buildGatewayWsUrl(baseUrl, { name: 'token', value: useToken }), protocols: [] })
    attempts.push({ url: buildGatewayWsUrl(baseUrl), protocols: [] })
    let lastError = 'The chat connection failed.'
    for (const attempt of attempts) {
      try {
        const socket = await this.dial(attempt.url, attempt.protocols, probe, attached)
        return { socket, wsUrl: attempt.url, protocols: attempt.protocols }
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError
      }
    }
    if (useToken && !useCookie) {
      const ticket = await this.mintTicket(baseUrl, useToken, useCookie)
      if (ticket) {
        const url = buildGatewayWsUrl(baseUrl, undefined, { native_dial: 'browser' })
        const protocols = ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`]
        try {
          const socket = await this.dial(url, protocols, probe, attached)
          return { socket, wsUrl: url, protocols }
        } catch (error) {
          lastError = error instanceof Error ? error.message : lastError
        }
      }
    }
    throw new Error(`Reached the gateway over HTTP, but the live WebSocket (/api/ws) connection failed: ${lastError}`)
  }

  private dial(url: string, protocols: string[], probe: boolean, attached = true): Promise<HermesSocket> {
    return new Promise((resolve, reject) => {
      let ready = false
      let dropped = ''
      const socket = new HermesSocket({
        onEvent: event => {
          if (event.type === 'gateway.ready') ready = true
          if (attached && !probe) this.onEvent(event)
        },
        onQuestion: question => {
          if (attached && !probe) {
            this.question = question
            this.emit()
          }
        },
        onClose: message => {
          dropped = message
          if (attached && !probe && this.socket === socket) {
            this.socket = null
            this.onLost(message)
          }
        }
      })
      socket.connect(url, protocols).then(async () => {
        await waitForReady(() => ready || Boolean(dropped), 800)
        if (dropped) {
          socket.close()
          reject(new Error(dropped))
          return
        }
        if (probe) socket.close()
        resolve(socket)
      }).catch(error => {
        socket.close()
        reject(error instanceof Error ? error : new Error(redactSecrets(String(error))))
      })
    })
  }

  private onEvent(event: GatewayEventFrame): void {
    if (event.type === 'gateway.ready') return
    const sessionId = event.session_id
    // Control events belong to the turn, not to the session list. A prompt can
    // arrive while the client is between a stored and a live session id, so do
    // not drop it on that mismatch alone.
    if (event.type === 'approval.request' || event.type === 'clarify.request') {
      if (typeof event.execution_generation === 'number') this.executionGeneration = event.execution_generation
      const question = questionFromControlEvent(event.type, sessionId || this.live?.live || '', event.payload || {})
      if (question) {
        this.question = question
        this.emit()
      }
      return
    }
    if (sessionId && this.live && sessionId !== this.live.live && sessionId !== this.live.stored) {
      if (event.type === 'session.title' || event.type === 'message.complete') void this.refreshSessions()
      return
    }
    if (typeof event.execution_generation === 'number') this.executionGeneration = event.execution_generation
    if (event.type === 'approval.settled' || event.type === 'clarify.settled') {
      const promptId = typeof event.payload?.prompt_id === 'string' ? event.payload.prompt_id : ''
      if (this.question && (!promptId || this.question.promptId === promptId || this.question.id === promptId)) {
        this.question = null
        this.emit()
      }
      return
    }
    if (event.type === 'session.title') {
      const title = typeof event.payload?.title === 'string' ? event.payload.title : ''
      if (title && this.live) {
        this.sessions = this.sessions.map(row => row.id === this.live?.stored || row.id === this.live?.live ? { ...row, title } : row)
      }
    }
    const interesting = event.type.startsWith('message.') || event.type.startsWith('tool.') || event.type === 'error'
    if (interesting) {
      this.transcript = applyGatewayEvent(this.transcript, event)
      if (event.type === 'message.complete') void this.refreshSessions()
    }
    this.emit()
  }

  private onLost(message: string): void {
    // A deliberate reconnect closes the old socket first; its close event must
    // not overwrite the new socket's ready state.
    if (this.reconnecting) return
    this.lastError = message
    this.transcript = { ...this.transcript, streaming: false }
    this.emit()
  }

  private async mintTicket(baseUrl: string, token: string, cookie: string): Promise<string> {
    const headers: Record<string, string> = {}
    if (token) headers['X-Hermes-Session-Token'] = token
    if (cookie && !this.browser) headers['Cookie'] = cookie
    const paths = ['/api/auth/ws-ticket', '/api/webapp/socket-ticket?socket=gateway']
    for (const path of paths) {
      try {
        const response = await this.authFetch(buildGatewayHttpUrl(baseUrl, path), {
          method: 'POST',
          headers
        })
        if (!response.ok) continue
        const body = asRecord(await response.json())
        if (typeof body.ticket === 'string' && body.ticket) return body.ticket
      } catch {
        continue
      }
    }
    return ''
  }

  private async rpc(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    if (!this.socket?.isOpen) throw new Error('Icyteru is not connected to Hermes.')
    return this.socket.request(method, params, timeoutMs)
  }

  private async tryRpc(method: string, params: Record<string, unknown>): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    try {
      return { ok: true, value: await this.rpc(method, params) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'request failed' }
    }
  }

  private async getJson(path: string): Promise<unknown> {
    let response = await this.httpGet(path)
    if (response.status === 401 && await this.renewSession()) response = await this.httpGet(path)
    if (!response.ok) throw new Error(`${path} returned ${response.status}`)
    return response.json()
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const send = () => this.httpPost(path, body)
    let response = await send()
    if (response.status === 401 && await this.renewSession()) response = await send()
    const text = await response.text()
    const parsed = text ? JSON.parse(text) as unknown : {}
    if (!response.ok) {
      const detail = asRecord(parsed).detail
      throw new Error(typeof detail === 'string' ? detail : `Hermes returned ${response.status}.`)
    }
    return parsed
  }

  private async patchJson(path: string, body: unknown): Promise<unknown> {
    const send = () => this.httpPatch(path, body)
    let response = await send()
    if (response.status === 401 && await this.renewSession()) response = await send()
    const text = await response.text()
    const parsed = text ? JSON.parse(text) as unknown : {}
    if (!response.ok) {
      const detail = asRecord(parsed).detail
      throw new Error(typeof detail === 'string' ? detail : `Hermes returned ${response.status}.`)
    }
    return parsed
  }

  private httpGet(path: string): Promise<Response> {
    return this.authFetch(buildGatewayHttpUrl(this.baseUrl, this.withProfile(path)), { headers: this.headers() })
  }

  private httpPost(path: string, body: unknown): Promise<Response> {
    return this.authFetch(buildGatewayHttpUrl(this.baseUrl, this.withProfile(path)), {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  private httpPatch(path: string, body: unknown): Promise<Response> {
    return this.authFetch(buildGatewayHttpUrl(this.baseUrl, this.withProfile(path)), {
      method: 'PATCH',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.token) headers['X-Hermes-Session-Token'] = this.token
    if (this.cookie && !this.browser) headers['Cookie'] = this.cookie
    return headers
  }
}

function waitForReady(ready: () => boolean, graceMs: number): Promise<boolean> {
  if (ready()) return Promise.resolve(true)
  return new Promise(resolve => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (ready()) {
        clearInterval(timer)
        resolve(true)
      } else if (Date.now() - started > graceMs) {
        clearInterval(timer)
        resolve(false)
      }
    }, 30)
  })
}

function gatewayRef(id: string, url: string, token: string, username: string, password: string, cookie = ''): GatewayRef {
  const parsed = parseGatewayBase(url)
  const base = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`
  return { id, url: base, token, username, password, cookie, label: parsed.host }
}

function headersFor(gateway: GatewayRef): Record<string, string> {
  const headers: Record<string, string> = {}
  if (gateway.token) headers['X-Hermes-Session-Token'] = gateway.token
  if (gateway.cookie) headers['Cookie'] = gateway.cookie
  return headers
}

function authModeHint(mode: AuthMode): string {
  if (mode === 'password') return 'username and password'
  if (mode === 'token') return 'session token'
  if (mode === 'either') return 'session token or password'
  if (mode === 'unknown') return 'gateway login'
  return 'open gateway'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
