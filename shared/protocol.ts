/**
 * Hermes gateway helpers for Icyteru.
 *
 * The WebSocket URL shape matches Hermes Desktop (`buildGatewayWsUrl` in
 * apps/desktop and `buildHermesWebSocketUrl` in apps/shared, MIT, Nous Research).
 * JSON-RPC frames follow the tui_gateway wire used by Desktop and the dashboard:
 * one JSON-RPC 2.0 object per WebSocket text frame. Events are notifications
 * with method "event". Server questions (approval, clarify, …) are requests
 * the client answers with a response that carries the same id.
 */

export interface GatewayAuth {
  name: 'token' | 'ticket'
  value: string
}

/** A file staged by the renderer and sent with the next prompt. */
export interface OutgoingAttachment {
  name: string
  mime: string
  base64: string
}

/**
 * How a gateway asks a client to authenticate. Hermes Desktop and Mobile read
 * the public `/api/status` probe before showing a login form: `auth_required`
 * says whether a gate is engaged, `auth_providers` says which credentials the
 * gate accepts. A loopback gateway (`auth_required: false`) needs none; a gated
 * gateway advertises `basic` for username/password and/or `session-token` for
 * a deployment token. `either` means both are registered and the user may pick.
 */
export type AuthMode = 'none' | 'token' | 'password' | 'either' | 'unknown'

export interface AuthDiscovery {
  ok: boolean
  message: string
  mode: AuthMode
  authRequired: boolean
  providers: string[]
}

export function detectAuthMode(status: unknown): AuthMode {
  const body = asRecord(status)
  const providers = Array.isArray(body.auth_providers)
    ? body.auth_providers.filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
    : []
  if (body.auth_required !== true) return 'none'
  const password = providers.some(name => name === 'basic' || name === 'password')
  const token = providers.some(name => name === 'session-token' || name === 'token')
  if (password && token) return 'either'
  if (password) return 'password'
  if (token) return 'token'
  return 'unknown'
}

/** Keep only the name=value pair of each Set-Cookie value; attributes are not sent back. */
export function cookieHeaderFromSetCookie(values: string[]): string {
  const pairs = values
    .map(value => value.split(';', 1)[0]?.trim() ?? '')
    .filter(value => value.includes('='))
  return [...new Set(pairs)].join('; ')
}

export function buildGatewayHttpUrl(baseUrl: string, path: string): string {
  const parsed = parseGatewayBase(baseUrl)
  const prefix = parsed.pathname.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${parsed.protocol}//${parsed.host}${prefix}${suffix}`
}

export function buildGatewayWsUrl(baseUrl: string, auth?: GatewayAuth, extraParams?: Record<string, string>): string {
  const parsed = parseGatewayBase(baseUrl)
  const wsScheme = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  const prefix = parsed.pathname.replace(/\/+$/, '')
  const qs = new URLSearchParams(extraParams)
  if (auth?.value) qs.set(auth.name, auth.value)
  const query = qs.toString()
  return `${wsScheme}//${parsed.host}${prefix}/api/ws${query ? `?${query}` : ''}`
}

export function parseGatewayBase(baseUrl: string): URL {
  let parsed: URL
  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    throw new Error('Enter a full gateway URL, such as http://127.0.0.1:9119')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The gateway URL needs to start with http:// or https://')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Put the session token in the token field, not inside the URL.')
  }
  parsed.hash = ''
  parsed.search = ''
  return parsed
}

export function redactSecrets(text: string): string {
  return text
    .replace(/([?&](?:token|ticket|api_key)=)[^&\s]+/gi, '$1…')
    .replace(/(X-Hermes-Session-Token[^\n]{0,40})/gi, 'X-Hermes-Session-Token')
}

export interface ToolCall {
  id: string
  name: string
  argsText: string
  resultText: string
  status: 'running' | 'done'
}

export interface TranscriptMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: ToolCall[]
  pending: boolean
  error?: string
}

export interface Transcript {
  messages: TranscriptMessage[]
  streaming: boolean
}

export function emptyTranscript(): Transcript {
  return { messages: [], streaming: false }
}

export function applyDelta(current: string, text: string | null | undefined, offset?: number | null): string {
  if (text == null) return current
  if (offset == null || offset < 0 || Number.isNaN(offset)) return current + text
  const units = current.length
  if (offset > units) return current + text
  const prefix = current.slice(0, offset)
  const already = current.slice(offset)
  if (already === text || already.startsWith(text)) return current
  if (text.startsWith(already)) return prefix + text
  return prefix + text
}

interface StreamMeta {
  segments: Map<string, string>
  order: string[]
}

const streamMeta = new WeakMap<TranscriptMessage, StreamMeta>()

function metaFor(message: TranscriptMessage): StreamMeta {
  let meta = streamMeta.get(message)
  if (!meta) {
    meta = { segments: new Map(), order: [] }
    streamMeta.set(message, meta)
  }
  return meta
}

function renderSegments(message: TranscriptMessage): void {
  const meta = metaFor(message)
  message.text = meta.order.map(key => meta.segments.get(key) ?? '').filter(Boolean).join('\n\n')
}

function segmentKey(turnId?: string | null, segment?: number | null): string {
  return `${turnId || 'turn'}:${segment ?? 0}`
}

export function ensureAssistant(transcript: Transcript): TranscriptMessage {
  const last = transcript.messages[transcript.messages.length - 1]
  if (last && last.role === 'assistant' && last.pending) return last
  const created: TranscriptMessage = {
    id: `a-${Date.now()}-${transcript.messages.length}`,
    role: 'assistant',
    text: '',
    tools: [],
    pending: true
  }
  transcript.messages.push(created)
  transcript.streaming = true
  return created
}

export function appendUser(transcript: Transcript, text: string, id: string): Transcript {
  const next = cloneTranscript(transcript)
  next.messages.push({ id, role: 'user', text, tools: [], pending: false })
  next.streaming = true
  return next
}

export function cloneTranscript(transcript: Transcript): Transcript {
  const messages = transcript.messages.map(message => {
    const copy: TranscriptMessage = {
      ...message,
      tools: message.tools.map(tool => ({ ...tool }))
    }
    const meta = streamMeta.get(message)
    if (meta) {
      streamMeta.set(copy, {
        segments: new Map(meta.segments),
        order: [...meta.order]
      })
    }
    return copy
  })
  return { messages, streaming: transcript.streaming }
}

function writeSegment(message: TranscriptMessage, key: string, text: string | null | undefined, offset?: number | null): void {
  if (text == null) return
  const meta = metaFor(message)
  if (!meta.segments.has(key)) {
    meta.segments.set(key, '')
    meta.order.push(key)
  }
  meta.segments.set(key, applyDelta(meta.segments.get(key) ?? '', text, offset))
  renderSegments(message)
}

export function applyGatewayEvent(transcript: Transcript, event: GatewayEventFrame): Transcript {
  const next = cloneTranscript(transcript)
  const type = event.type
  const payload = (event.payload ?? {}) as Record<string, unknown>
  if (type === 'message.delta' || type === 'message.interim') {
    const message = ensureAssistant(next)
    const key = segmentKey(
      typeof payload.turn_id === 'string' ? payload.turn_id : null,
      typeof payload.segment === 'number' ? payload.segment : type === 'message.interim' ? 1000 : 0
    )
    writeSegment(message, key, typeof payload.text === 'string' ? payload.text : null, numberOrNull(payload.offset))
    next.streaming = true
    return next
  }
  if (type === 'reasoning.delta' || type === 'thinking.delta') {
    return next
  }
  if (type === 'tool.start' || type === 'tool.generating') {
    const message = ensureAssistant(next)
    const id = String(payload.tool_id || payload.id || `tool-${message.tools.length}`)
    const name = String(payload.name || payload.tool || 'tool')
    const existing = message.tools.find(tool => tool.id === id)
    const argsText = previewValue(payload.args ?? payload.args_text ?? payload.preview ?? payload.context)
    if (existing) {
      if (argsText) existing.argsText = argsText
      existing.status = 'running'
    } else {
      message.tools.push({ id, name, argsText, resultText: '', status: 'running' })
    }
    next.streaming = true
    return next
  }
  if (type === 'tool.complete' || type === 'tool.progress') {
    const message = ensureAssistant(next)
    const id = String(payload.tool_id || payload.id || '')
    const name = String(payload.name || 'tool')
    let tool = message.tools.find(item => item.id === id) || message.tools.find(item => item.name === name && item.status === 'running')
    if (!tool) {
      tool = { id: id || `tool-${message.tools.length}`, name, argsText: '', resultText: '', status: 'running' }
      message.tools.push(tool)
    }
    if (type === 'tool.complete') {
      tool.status = 'done'
      tool.name = name || tool.name
      const result = payload.summary ?? payload.result_text ?? payload.result ?? payload.preview
      tool.resultText = previewValue(result)
      if (payload.args) tool.argsText = previewValue(payload.args)
    } else if (typeof payload.message === 'string' && payload.message) {
      tool.resultText = payload.message
    }
    next.streaming = true
    return next
  }
  if (type === 'message.complete') {
    const message = next.messages[next.messages.length - 1]
    const assistant = message && message.role === 'assistant' ? message : ensureAssistant(next)
    const full = payload.text
    const reused = payload.response_reused === true
    if (!reused && typeof full === 'string' && full.trim()) {
      if (!assistant.text || full.startsWith(assistant.text) || assistant.text.startsWith(full)) {
        if (full.length >= assistant.text.length) assistant.text = full
      } else if (!assistant.text) {
        assistant.text = full
      }
    }
    if (typeof payload.error === 'string' && payload.error) assistant.error = payload.error
    else if (payload.status === 'failed' || payload.status === 'error') {
      assistant.error = typeof payload.failure_reason === 'string' ? payload.failure_reason : 'Hermes could not finish this reply.'
    }
    assistant.pending = false
    next.streaming = false
    for (const tool of assistant.tools) {
      if (tool.status === 'running') tool.status = 'done'
    }
    return next
  }
  if (type === 'error') {
    const message = ensureAssistant(next)
    message.error = typeof payload.message === 'string' ? payload.message : typeof payload.error === 'string' ? payload.error : 'Hermes reported an error.'
    message.pending = false
    next.streaming = false
    return next
  }
  return next
}

export function historyFromRows(rows: unknown): Transcript {
  const list = Array.isArray(rows) ? rows : []
  const messages: TranscriptMessage[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    if (record.display_kind === 'hidden') continue
    const role = String(record.role || '')
    const text = messageText(record)
    const toolName = typeof record.name === 'string' ? record.name : typeof record.tool_name === 'string' ? record.tool_name : ''
    const toolId = record.tool_call_id ? String(record.tool_call_id) : ''
    const isTool = role === 'tool' || role === 'function' || Boolean(toolId) || (Boolean(toolName) && role !== 'user' && role !== 'assistant')
    if (isTool) {
      const host = messages[messages.length - 1]
      const assistant = host && host.role === 'assistant'
        ? host
        : (() => {
          const created: TranscriptMessage = { id: `h-${messages.length}`, role: 'assistant', text: '', tools: [], pending: false }
          messages.push(created)
          return created
        })()
      assistant.tools.push({
        id: toolId || `h-tool-${assistant.tools.length}`,
        name: toolName || 'tool',
        argsText: previewValue(record.args ?? record.arguments),
        resultText: text,
        status: 'done'
      })
      continue
    }
    if (role === 'user' || role === 'assistant') {
      if (!text && role === 'assistant') continue
      messages.push({
        id: record.row_id != null ? `row-${record.row_id}` : `h-${messages.length}`,
        role,
        text,
        tools: [],
        pending: false
      })
    }
  }
  return { messages, streaming: false }
}

export function messageText(record: Record<string, unknown>): string {
  if (typeof record.text === 'string') return record.text
  const content = record.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object') {
        const item = part as Record<string, unknown>
        if (typeof item.text === 'string') return item.text
        if (typeof item.type === 'string' && item.type.includes('image')) return '[image]'
      }
      return ''
    }).filter(Boolean).join('\n')
  }
  return ''
}

export interface SessionRow {
  id: string
  title: string
  preview: string
  source: string
  model: string
  updatedAt: number | null
  running: boolean
  pinned: boolean
}

export function normalizeSessions(payload: unknown): SessionRow[] {
  const body = asRecord(payload)
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(body.sessions)
      ? body.sessions
      : Array.isArray(body.rows)
        ? body.rows
        : Array.isArray(body.data)
          ? body.data
          : []
  const rows: SessionRow[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = String(record.session_id || record.id || '')
    if (!id) continue
    const updated = numberOrNull(record.last_active_at) ?? numberOrNull(record.last_active) ?? numberOrNull(record.started_at)
    rows.push({
      id,
      title: cleanTitle(record.title) || cleanTitle(record.preview) || 'New chat',
      preview: typeof record.preview === 'string' ? record.preview : typeof record.last_reply === 'string' ? record.last_reply : '',
      source: typeof record.source === 'string' ? record.source : '',
      model: typeof record.model === 'string' ? record.model : '',
      updatedAt: updated,
      running: record.running === true,
      pinned: record.pinned === true
    })
  }
  return rows
}

export interface ModelChoice {
  provider: string
  id: string
  label: string
}

/** A native notification the renderer asks the host to show. */
export interface NotificationPayload {
  title: string
  body: string
}

/** Model ids often carry the provider prefix in the current-model field but not in the list. */
/** The model part without the provider prefix, keeping its original casing. */
export function modelShortName(value: string): string {
  const trimmed = value.trim()
  const slash = trimmed.indexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

export function bareModelId(value: string): string {
  const lower = value.trim().toLowerCase()
  const slash = lower.indexOf('/')
  return slash >= 0 ? lower.slice(slash + 1) : lower
}

export function modelIdsMatch(a: string, b: string): boolean {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()
  if (!left || !right) return false
  return left === right || bareModelId(left) === bareModelId(right) || left === bareModelId(right) || bareModelId(left) === right
}

export function normalizeModels(payload: unknown): { currentModel: string; currentProvider: string; models: ModelChoice[] } {
  const body = asRecord(payload)
  const models: ModelChoice[] = []
  const providers = Array.isArray(body.providers) ? body.providers : []
  for (const provider of providers) {
    if (!provider || typeof provider !== 'object') continue
    const record = provider as Record<string, unknown>
    const name = String(record.name || record.slug || record.id || record.provider || 'model')
    const listed = record.models || record.available_models || record.curated || []
    if (!Array.isArray(listed)) continue
    for (const model of listed) {
      if (typeof model === 'string') {
        models.push({ provider: name, id: model, label: model })
      } else if (model && typeof model === 'object') {
        const item = model as Record<string, unknown>
        const id = String(item.id || item.name || item.model || '')
        if (!id) continue
        models.push({ provider: name, id, label: String(item.label || item.name || id) })
      }
    }
  }
  return {
    currentModel: String(body.model || body.default || ''),
    currentProvider: String(body.provider || ''),
    models
  }
}

export interface SkillRow {
  name: string
  description: string
  category: string
  enabled: boolean
}

export function normalizeSkills(payload: unknown): SkillRow[] {
  const body = asRecord(payload)
  const list = Array.isArray(payload) ? payload : Array.isArray(body.skills) ? body.skills : []
  return list.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const name = String(record.name || '')
    if (!name) return []
    return [{
      name,
      description: typeof record.description === 'string' ? record.description : '',
      category: typeof record.category === 'string' ? record.category : '',
      enabled: record.enabled !== false
    }]
  })
}

export interface MemoryView {
  available: boolean
  summary: string
  notes: string
  user: string
  instructions: string
}

export function normalizeMemory(payload: unknown): MemoryView {
  if (!payload || typeof payload !== 'object') {
    return { available: false, summary: '', notes: '', user: '', instructions: '' }
  }
  const record = payload as Record<string, unknown>
  const notes = textField(record, ['memory', 'notes', 'MEMORY.md'])
  const user = textField(record, ['user', 'user_profile', 'USER.md'])
  const instructions = textField(record, ['soul', 'instructions', 'SOUL.md'])
  const active = typeof record.active === 'string' ? record.active : ''
  const files = asRecord(record.builtin_files)
  const parts: string[] = []
  if (active) parts.push(`External memory: ${active}.`)
  else if ('active' in record || 'builtin_files' in record) parts.push('Built-in notes on the Hermes machine.')
  const memorySize = numberOrNull(files.memory)
  const userSize = numberOrNull(files.user)
  if (memorySize != null) parts.push(`MEMORY.md is ${formatBytes(memorySize)}.`)
  if (userSize != null) parts.push(`USER.md is ${formatBytes(userSize)}.`)
  const providers = Array.isArray(record.providers) ? record.providers : []
  const names = providers.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const name = (item as Record<string, unknown>).name || (item as Record<string, unknown>).id
    return typeof name === 'string' && name ? [name] : []
  })
  if (names.length) parts.push(`Available providers: ${names.join(', ')}.`)
  return {
    available: true,
    summary: parts.join(' '),
    notes,
    user,
    instructions
  }
}

export interface CreateContract {
  sources: string[]
  parameters: string[]
}

export function readCreateContract(describe: unknown): CreateContract | null {
  const body = asRecord(describe)
  const block = asRecord(body.session_create)
  const sources = Array.isArray(block.sources) ? block.sources.filter((item): item is string => typeof item === 'string') : []
  const parameters = Array.isArray(block.parameters) ? block.parameters.filter((item): item is string => typeof item === 'string') : []
  if (!sources.length && !parameters.length) return null
  return { sources, parameters }
}

export function buildCreateParams(contract: CreateContract | null, requestId: string, model?: string, provider?: string, profile?: string): Record<string, unknown> {
  const preferred = ['gui', 'tui', 'cli']
  const source = contract
    ? preferred.find(item => contract.sources.includes(item)) || contract.sources[0]
    : 'gui'
  const params: Record<string, unknown> = {}
  const allow = (key: string, value: unknown) => {
    if (!contract || contract.parameters.includes(key)) params[key] = value
  }
  if (source) allow('source', source)
  allow('request_id', requestId)
  allow('client', { name: 'icyteru', version: '0.1.0' })
  if (model) allow('model', model)
  if (provider) allow('provider', provider)
  if (profile) allow('profile', profile)
  if (!contract) {
    const legacy: Record<string, unknown> = { source: 'gui' }
    if (model) legacy.model = model
    if (provider) legacy.provider = provider
    if (profile) legacy.profile = profile
    return legacy
  }
  return params
}

export interface AgentProfile {
  gatewayId: string
  name: string
  label: string
  description: string
  model: string
  avatar: string
  initial: string
  hasAvatar: boolean | null
  preview: string
  lastActive: number | null
  pinned: boolean
  hidden: boolean
  /** The hermes-bots object from profile.yaml, kept so a pin write does not wipe the title. */
  botMeta: Record<string, unknown>
}

export function normalizeProfiles(payload: unknown, gatewayId: string): AgentProfile[] {
  const body = asRecord(payload)
  const list = Array.isArray(payload) ? payload : Array.isArray(body.profiles) ? body.profiles : []
  const profiles: AgentProfile[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = String(record.name || '').trim()
    if (!name) continue
    const bots = asRecord(asRecord(record.ui_meta)['hermes-bots'])
    const metaTitle = typeof bots.title === 'string' ? bots.title.trim() : ''
    const display = typeof record.display_name === 'string' ? record.display_name.trim() : ''
    const botTitle = typeof record.bot_title === 'string' ? record.bot_title.trim() : ''
    const label = metaTitle || display || botTitle || (name === 'default' ? 'Hermes' : name)
    const canonical = asRecord(record.canonical_session)
    const last = asRecord(record.last_session)
    const spoken = typeof canonical.preview === 'string' && canonical.preview.trim() ? canonical : last
    const preview = typeof spoken.preview === 'string' ? spoken.preview.trim() : ''
    const lastActive = numberOrNull(spoken.last_active) ?? numberOrNull(last.last_active)
    profiles.push({
      gatewayId,
      name,
      label,
      description: typeof record.description === 'string' ? record.description.trim() : '',
      model: typeof record.model === 'string' ? record.model : '',
      avatar: '',
      initial: [...label][0]?.toUpperCase() || 'H',
      hasAvatar: typeof record.has_avatar === 'boolean' ? record.has_avatar : null,
      preview,
      lastActive,
      pinned: bots.pinned === true,
      hidden: bots.hidden === true,
      botMeta: bots
    })
  }
  return sortProfiles(profiles)
}

export function sortProfiles(profiles: AgentProfile[]): AgentProfile[] {
  return [...profiles].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return (b.lastActive || 0) - (a.lastActive || 0)
  })
}

export function sortSessions(sessions: SessionRow[]): SessionRow[] {
  return [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export function acceptAvatar(data: unknown): string {
  if (typeof data !== 'string') return ''
  const compact = data.replace(/\s+/g, '')
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(compact)) return ''
  if (compact.length > 2_800_000) return ''
  return compact
}

export function pickSessionIds(result: unknown): { live: string; stored: string } | null {
  const body = asRecord(result)
  const live = body.session_id || body.id
  if (typeof live !== 'string' || !live) return null
  const stored = typeof body.stored_session_id === 'string' && body.stored_session_id ? body.stored_session_id : live
  return { live, stored }
}

export function previewValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return clip(value)
  try {
    return clip(JSON.stringify(value, null, 2))
  } catch {
    return ''
  }
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`
  return `${Math.round(size / (1024 * 102.4)) / 10} MB`
}

export function sourceLabel(source: string): string {
  const key = source.toLowerCase()
  const labels: Record<string, string> = {
    telegram: 'Telegram',
    discord: 'Discord',
    slack: 'Slack',
    whatsapp: 'WhatsApp',
    signal: 'Signal',
    cli: 'Terminal',
    tui: 'Terminal',
    gui: 'Desktop',
    desktop: 'Desktop',
    cron: 'Schedule',
    api: 'API',
    acp: 'Editor'
  }
  return labels[key] || (source ? source : 'Chat')
}

/** Build a card from an `approval.request` / `clarify.request` control event. */
export function questionFromControlEvent(type: string, sessionId: string, payload: unknown): PendingQuestion | null {
  const body = asRecord(payload)
  const promptId = typeof body.prompt_id === 'string' ? body.prompt_id : typeof body.request_id === 'string' ? body.request_id : ''
  const generation = typeof body.execution_generation === 'number' ? body.execution_generation : 0
  if (type === 'approval.request' && promptId) {
    const choices = Array.isArray(body.choices) && body.choices.length
      ? body.choices.map(item => String(item))
      : ['once', 'deny']
    return {
      id: promptId,
      method: 'approval.request',
      sessionId,
      title: 'Hermes wants approval',
      body: [body.tool_name, body.command, body.description].filter(item => typeof item === 'string' && item).join('\n'),
      choices,
      secret: false,
      questions: [],
      promptId,
      executionGeneration: generation
    }
  }
  if (type === 'clarify.request' && promptId) {
    const question = typeof body.question === 'string' ? body.question : 'Hermes has a question'
    const choices = Array.isArray(body.choices) ? body.choices.map(item => String(item)) : []
    const multiSelect = body.multi_select === true
    return {
      id: promptId,
      method: 'clarify.request',
      sessionId,
      title: 'Hermes has a question',
      body: question,
      choices: [],
      secret: false,
      questions: [{ id: promptId, question, choices, multiSelect }],
      promptId,
      executionGeneration: generation,
      multiSelect
    }
  }
  return null
}

export function approvalLabel(choice: string): string {
  const labels: Record<string, string> = {
    once: 'Approve once',
    session: 'Approve session',
    always: 'Always allow',
    deny: 'Deny'
  }
  return labels[choice] || choice
}

export interface GatewayEventFrame {
  type: string
  session_id?: string
  payload?: Record<string, unknown>
  seq?: number
  authority_epoch?: number
  execution_generation?: number
}

export interface PendingQuestion {
  id: string
  method: string
  sessionId: string
  title: string
  body: string
  choices: string[]
  secret: boolean
  questions: Array<{ id: string; question: string; choices: string[]; multiSelect?: boolean }>
  /** Event-backed approval/clarify prompt (gateway control stream). */
  promptId?: string
  executionGeneration?: number
  multiSelect?: boolean
}

export function questionFromRequest(id: string, method: string, params: unknown): PendingQuestion | null {
  const body = asRecord(params)
  const sessionId = typeof body.session_id === 'string' ? body.session_id : ''
  if (method === 'approval') {
    const choices = Array.isArray(body.choices) && body.choices.length
      ? body.choices.map(item => String(item))
      : ['once', 'deny']
    return {
      id,
      method,
      sessionId,
      title: 'Hermes wants approval',
      body: [body.tool_name, body.command, body.description].filter(item => typeof item === 'string' && item).join('\n'),
      choices,
      secret: false,
      questions: []
    }
  }
  if (method === 'clarify') {
    const questions = Array.isArray(body.questions) ? body.questions.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const question = item as Record<string, unknown>
      const qid = String(question.qid || question.id || '')
      if (!qid) return []
      return [{
        id: qid,
        question: String(question.question || 'Hermes has a question'),
        choices: Array.isArray(question.choices) ? question.choices.map(choice => String(choice)) : []
      }]
    }) : []
    return {
      id,
      method,
      sessionId,
      title: 'Hermes has a question',
      body: questions.map(item => item.question).join('\n'),
      choices: [],
      secret: false,
      questions
    }
  }
  if (method === 'sudo' || method === 'secret' || method === 'vault.code' || method === 'vault.unlock_prompt') {
    return {
      id,
      method,
      sessionId,
      title: method === 'sudo' ? 'Hermes needs a password' : 'Hermes needs a secret',
      body: typeof body.command === 'string' ? body.command : 'This stays on your Hermes gateway. Leave it blank to skip.',
      choices: [],
      secret: true,
      questions: []
    }
  }
  return null
}

function textField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function cleanTitle(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > 80 ? `${text.slice(0, 77)}…` : text
}

function clip(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= 4000) return trimmed
  return `${trimmed.slice(0, 4000)}\n…`
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value && Number.isFinite(Number(value))) return Number(value)
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
