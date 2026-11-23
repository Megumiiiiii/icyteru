import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  acceptAvatar,
  applyDelta,
  applyGatewayEvent,
  applySubagentEvent,
  buildCreateParams,
  bareModelId,
  buildGatewayWsUrl,
  cookieHeaderFromSetCookie,
  detectAuthMode,
  emptyTranscript,
  historyFromRows,
  modelIdsMatch,
  modelOptionsPath,
  pickReasoning,
  pickSessionModel,
  normalizeMemory,
  normalizeModels,
  normalizeProfiles,
  normalizeSessions,
  mergeSessionRows,
  pickReconnectProfile,
  orderedParts,
  questionFromControlEvent,
  questionFromRequest,
  readCreateContract,
  sourceLabel
} from './protocol'
import { HermesClient } from '../electron/hermes'

test('builds the desktop websocket url', () => {
  assert.equal(
    buildGatewayWsUrl('http://127.0.0.1:9119/', { name: 'token', value: 'abc def' }),
    'ws://127.0.0.1:9119/api/ws?token=abc+def'
  )
  assert.equal(
    buildGatewayWsUrl('https://hermes.example.com/gateway', { name: 'ticket', value: 't' }),
    'wss://hermes.example.com/gateway/api/ws?ticket=t'
  )
  assert.throws(() => buildGatewayWsUrl('http://user:secret@127.0.0.1:9119'), /token field/)
})

test('applies streamed chunks and ignores a resent prefix', () => {
  assert.equal(applyDelta('', 'Hel', 0), 'Hel')
  assert.equal(applyDelta('Hel', 'Hello', 0), 'Hello')
  assert.equal(applyDelta('Hello', 'lo', 3), 'Hello')
  assert.equal(applyDelta('Hello', ' world', null), 'Hello world')
})

test('folds tool calls into the assistant turn', () => {
  let transcript = emptyTranscript()
  transcript = applyGatewayEvent(transcript, { type: 'message.delta', payload: { text: 'Looking', offset: 0, turn_id: 't', segment: 0 } })
  transcript = applyGatewayEvent(transcript, { type: 'tool.start', payload: { tool_id: '1', name: 'read_file', args: { path: 'a.ts' } } })
  transcript = applyGatewayEvent(transcript, { type: 'tool.complete', payload: { tool_id: '1', name: 'read_file', summary: '12 lines' } })
  transcript = applyGatewayEvent(transcript, { type: 'message.complete', payload: { text: 'Looking at a.ts', status: 'ok' } })
  assert.equal(transcript.streaming, false)
  assert.equal(transcript.messages.length, 1)
  assert.equal(transcript.messages[0].text, 'Looking at a.ts')
  assert.equal(transcript.messages[0].tools[0].name, 'read_file')
  assert.equal(transcript.messages[0].tools[0].status, 'done')
  assert.match(transcript.messages[0].tools[0].resultText, /12 lines/)
})

test('replaces a tool.generating placeholder with the real tool call', () => {
  let transcript = emptyTranscript()
  transcript = applyGatewayEvent(transcript, { type: 'tool.generating', payload: { name: 'terminal' } })
  assert.equal(transcript.messages[0].tools.length, 1)
  assert.equal(transcript.messages[0].tools[0].status, 'running')
  assert.match(transcript.messages[0].tools[0].id, /^gen:/)
  transcript = applyGatewayEvent(transcript, {
    type: 'tool.start',
    payload: { tool_id: 'call-1', name: 'terminal', args: { command: 'echo hi' } }
  })
  assert.equal(transcript.messages[0].tools.length, 1)
  assert.equal(transcript.messages[0].tools[0].id, 'call-1')
  transcript = applyGatewayEvent(transcript, {
    type: 'tool.complete',
    payload: { tool_id: 'call-1', name: 'terminal', result: 'hi', is_error: false }
  })
  assert.equal(transcript.messages[0].tools[0].status, 'done')
})

test('keeps tool calls after the final text when a preamble is replaced', () => {
  let transcript = emptyTranscript()
  transcript = applyGatewayEvent(transcript, {
    type: 'message.delta', payload: { text: 'Checking the data.', offset: 0, turn_id: 't', segment: 0 }
  })
  transcript = applyGatewayEvent(transcript, {
    type: 'tool.start', payload: { tool_id: 'call-1', name: 'terminal', args: { command: 'echo hi' } }
  })
  transcript = applyGatewayEvent(transcript, {
    type: 'tool.complete', payload: { tool_id: 'call-1', name: 'terminal', result: 'hi', is_error: false }
  })
  transcript = applyGatewayEvent(transcript, {
    type: 'message.complete', payload: { text: 'Final answer with results.', status: 'ok' }
  })
  const parts = orderedParts(transcript.messages[0])
  assert.equal(parts.length, 1)
  assert.equal(parts[0].text, 'Final answer with results.')
  assert.equal(parts[0].tools.length, 1)
})

test('folds subagent lifecycle events into one live row', () => {
  let subagents = applySubagentEvent([], {
    type: 'subagent.spawn_requested',
    payload: { subagent_id: 'sa-1', goal: 'audit menus', task_index: 0, task_count: 3, delegation_id: 'd1' }
  })
  assert.equal(subagents.length, 1)
  assert.equal(subagents[0].status, 'queued')
  assert.equal(subagents[0].goal, 'audit menus')
  subagents = applySubagentEvent(subagents, {
    type: 'subagent.tool',
    payload: { subagent_id: 'sa-1', goal: 'audit menus', task_index: 0, task_count: 3, tool_name: 'terminal', tool_preview: 'grep menus' }
  })
  assert.equal(subagents[0].status, 'running')
  assert.equal(subagents[0].activity, 'tool')
  assert.equal(subagents[0].toolName, 'terminal')
  assert.match(subagents[0].lastText, /grep menus/)
  subagents = applySubagentEvent(subagents, {
    type: 'subagent.complete',
    payload: { subagent_id: 'sa-1', status: 'completed', summary: 'done', duration_seconds: 1.5 }
  })
  assert.equal(subagents[0].status, 'completed')
  assert.equal(subagents[0].summary, 'done')
})

test('drops interim commentary when the final answer arrives', () => {
  let transcript = emptyTranscript()
  transcript = applyGatewayEvent(transcript, { type: 'message.interim', payload: { text: 'draft guess' } })
  assert.equal(transcript.messages[0].text, 'draft guess')
  transcript = applyGatewayEvent(transcript, { type: 'message.complete', payload: { text: 'final answer', status: 'ok' } })
  assert.equal(transcript.messages[0].text, 'final answer')
})

test('reads stored history and session rows', () => {
  const history = historyFromRows([
    { role: 'user', text: 'hi', row_id: 1 },
    { role: 'assistant', text: 'hello', row_id: 2 },
    { role: 'tool', name: 'search', tool_call_id: 'c1', content: 'found it' },
    { role: 'user', text: 'secret', display_kind: 'hidden', row_id: 4 }
  ])
  assert.equal(history.messages.length, 2)
  assert.equal(history.messages[1].tools[0].resultText, 'found it')
  const sessions = normalizeSessions({
    sessions: [{ session_id: 's1', title: 'Notes', source: 'telegram', preview: 'hi', last_active_at: 10, pinned: true }]
  })
  assert.equal(sessions[0].source, 'telegram')
  assert.equal(sessions[0].title, 'Notes')
})

test('keeps omitted rows when a live fallback is a subset, and preserves the reconnect profile', () => {
  const row = (id: string) => ({ id, title: id, preview: '', source: 'telegram', model: '', updatedAt: null, messageCount: 0, running: false, pinned: false })
  const merged = mergeSessionRows([row('old-a'), row('old-b')], [row('new-c'), row('old-b')])
  assert.deepEqual(merged.map(item => item.id).sort(), ['new-c', 'old-a', 'old-b'])
  const profiles = [
    { gatewayId: 'primary', name: 'default', label: 'Hermes' },
    { gatewayId: 'primary', name: 'scout', label: 'Scout' }
  ] as any
  assert.equal(pickReconnectProfile(profiles, 'primary', 'scout')?.name, 'scout')
  assert.equal(pickReconnectProfile(profiles, 'primary', 'missing')?.name, undefined)
})

test('keeps session.create inside the gateway contract', () => {
  const contract = readCreateContract({ session_create: { sources: ['cli', 'tui'], parameters: ['source', 'request_id', 'model'] } })
  const params = buildCreateParams(contract, 'req-1', 'demo-model', 'custom')
  assert.equal(params.source, 'tui')
  assert.equal(params.model, 'demo-model')
  assert.equal('client' in params, false)
  assert.equal('provider' in params, false)
  const legacy = buildCreateParams(null, 'req-2', undefined, undefined, 'scout')
  assert.deepEqual(legacy, { source: 'gui', profile: 'scout' })
})

test('reads profile names and only accepts image avatars', () => {
  const profiles = normalizeProfiles({
    profiles: [
      { name: 'default', display_name: 'Hermes', has_avatar: true, description: 'General', last_session: { preview: 'older', last_active: 10 } },
      {
        name: 'ain',
        ui_meta: { 'hermes-bots': { title: 'Aino', pinned: false } },
        canonical_session: { preview: 'pnl_pct is down', last_active: 50 }
      },
      {
        name: 'ineffa',
        ui_meta: { 'hermes-bots': { title: 'Ineffa', pinned: true } },
        last_session: { preview: 'standing by', last_active: 20 }
      },
      { name: 'guide' }
    ]
  }, 'primary')
  assert.equal(profiles[0].label, 'Ineffa')
  assert.equal(profiles[0].pinned, true)
  assert.equal(profiles[1].label, 'Aino')
  assert.equal(profiles[1].preview, 'pnl_pct is down')
  assert.equal(profiles[2].label, 'Hermes')
  assert.equal(profiles[2].hasAvatar, true)
  assert.equal(profiles[3].initial, 'G')
  assert.equal(profiles[3].hasAvatar, null)
  assert.equal(acceptAvatar('data:image/png;base64,aaaa'), 'data:image/png;base64,aaaa')
  assert.equal(acceptAvatar('http://example.com/a.png'), '')
})

test('normalizes models, memory, and approval cards', () => {
  const models = normalizeModels({
    model: 'demo',
    provider: 'custom',
    providers: [{ name: 'custom', models: [{ id: 'demo', label: 'Demo' }, 'other'] }]
  })
  assert.equal(models.models.length, 2)
  const memory = normalizeMemory({ active: '', builtin_files: { memory: 2048, user: 12 }, memory: 'Prefers aisle seats' })
  assert.match(memory.summary, /MEMORY.md/)
  assert.equal(memory.notes, 'Prefers aisle seats')
  const card = questionFromRequest('srq-1', 'approval', { session_id: 's', command: 'rm build', choices: ['once', 'deny'] })
  assert.equal(card?.choices[0], 'once')
  assert.equal(questionFromRequest('srq-2', 'terminal.read', {}) , null)
})

test('labels local sessions under the Local group', () => {
  assert.equal(sourceLabel('local'), 'Local')
  assert.equal(sourceLabel('telegram'), 'Telegram')
})

test('normalizes browser-vault cards without putting secrets in the card body', () => {
  const unlock = questionFromRequest('srq-v1', 'vault.unlock_prompt', {
    session_id: 's', backend: 'bitwarden', display_name: 'Bitwarden'
  })
  assert.equal(unlock?.title, 'Unlock Bitwarden')
  assert.equal(unlock?.secret, true)
  assert.equal(unlock?.vault?.kind, 'unlock')
  assert.equal(unlock?.vault?.backend, 'bitwarden')
  assert.doesNotMatch(unlock?.body || '', /correct horse/)

  const code = questionFromRequest('srq-v2', 'vault.code', {
    session_id: 's', site: 'github.com', hint: 'Check your email'
  })
  assert.equal(code?.title, 'Code for github.com')
  assert.equal(code?.body, 'Check your email')
  assert.equal(code?.vault?.kind, 'code')

  const login = questionFromRequest('srq-v3', 'vault.save_login', {
    session_id: 's', site: 'github.com', origin: 'https://github.com'
  })
  assert.equal(login?.title, 'Save login for github.com')
  assert.equal(login?.secret, false)
  assert.equal(login?.vault?.kind, 'save_login')
  assert.equal(login?.vault?.origin, 'https://github.com')
})

test('detects the login a gateway asks for from its public status', () => {
  assert.equal(detectAuthMode({ auth_required: false }), 'none')
  assert.equal(detectAuthMode({ auth_required: true, auth_providers: ['basic'] }), 'password')
  assert.equal(detectAuthMode({ auth_required: true, auth_providers: ['session-token'] }), 'token')
  assert.equal(detectAuthMode({ auth_required: true, auth_providers: ['basic', 'session-token'] }), 'either')
  assert.equal(detectAuthMode({ auth_required: true, auth_providers: ['nous'] }), 'unknown')
  assert.equal(detectAuthMode({}), 'none')
})

test('turns Set-Cookie headers into a Cookie request header', () => {
  const values = [
    'hermes_session_at=abc; HttpOnly; Path=/; SameSite=Lax',
    'hermes_session_rt=def; HttpOnly; Path=/; SameSite=Lax',
    'hermes_session_provider=basic; Path=/; SameSite=Lax'
  ]
  assert.equal(
    cookieHeaderFromSetCookie(values),
    'hermes_session_at=abc; hermes_session_rt=def; hermes_session_provider=basic'
  )
  assert.equal(cookieHeaderFromSetCookie(['a=1; Path=/', 'a=1; Path=/']), 'a=1')
})

test('matches model ids with or without their provider prefix', () => {
  assert.equal(bareModelId('deepseek/deepseek-v4.1-flash'), 'deepseek-v4.1-flash')
  assert.equal(modelIdsMatch('deepseek/deepseek-v4.1-flash', 'deepseek-v4.1-flash'), true)
  assert.equal(modelIdsMatch('DeepSeek/DeepSeek-V4.1-Flash', 'deepseek-v4.1-flash'), true)
  assert.equal(modelIdsMatch('gpt-6.2', 'deepseek-v4.1-flash'), false)
  assert.equal(modelIdsMatch('', 'gpt-6.2'), false)
})

test('scopes model options to the open session', () => {
  assert.equal(modelOptionsPath(), '/api/model/options')
  assert.equal(
    modelOptionsPath('20261119_205710_f5c946e4'),
    '/api/model/options?session_id=20261119_205710_f5c946e4'
  )
  assert.equal(modelOptionsPath('a b'), '/api/model/options?session_id=a%20b')
})

test('prefers the session row model over resume info and the profile default', () => {
  assert.equal(pickSessionModel('tencent/hy4-flash', 'deepseek-v4.1-flash'), 'tencent/hy4-flash')
  assert.equal(pickSessionModel('', 'deepseek-v4.1-flash', 'glm-5.3'), 'deepseek-v4.1-flash')
  assert.equal(pickSessionModel('', '', 'deepseek-v4.1-flash'), 'deepseek-v4.1-flash')
})

test('repaints the header from the active session row after a switch', () => {
  const client = new HermesClient(() => undefined)
  client.side.models = {
    currentModel: 'deepseek-v4.1-flash',
    currentProvider: 'opencode-go',
    models: [
      { provider: 'CommandCode', providerId: 'commandcode', id: 'tencent/hy4-flash', label: 'hy4-flash' },
      { provider: 'OpenCode Go', providerId: 'opencode-go', id: 'deepseek-v4.1-flash', label: 'deepseek-v4.1-flash' }
    ]
  }
  ;(client as unknown as { sessions: unknown[] }).sessions = [{
    id: '20261119_091305_9daddf0f',
    title: 'Audit Sessions',
    preview: '',
    source: 'telegram',
    model: 'tencent/hy4-flash',
    updatedAt: null,
    messageCount: 0,
    running: false,
    pinned: false
  }]
  ;(client as unknown as { live: unknown }).live = {
    live: '20261119_091305_9daddf0f',
    stored: '20261119_091305_9daddf0f',
    subscriptionId: ''
  }
  ;(client as unknown as { applyActiveSessionModel: () => void }).applyActiveSessionModel()
  assert.equal(client.side.models.currentModel, 'tencent/hy4-flash')
  assert.equal(client.side.models.currentProvider, 'commandcode')
})

test('shows session reasoning, then the global default, then medium', () => {
  assert.equal(pickReasoning('high', 'max'), 'high')
  assert.equal(pickReasoning('', 'max'), 'max')
  assert.equal(pickReasoning('', ''), 'medium')
})

test('updates the reasoning header optimistically without a new turn', async () => {
  const client = new HermesClient(() => undefined)
  ;(client as unknown as { live: unknown }).live = {
    live: '20261119_091305_9daddf0f',
    stored: '20261119_091305_9daddf0f',
    subscriptionId: ''
  }
  ;(client as unknown as { rpc: () => Promise<unknown> }).rpc = async () => ({ value: 'high' })
  await client.setReasoning('high')
  assert.equal(client.side.reasoning, 'high')
  ;(client as unknown as { rpc: () => Promise<unknown> }).rpc = async () => ({ value: 'max' })
  await client.setGlobalReasoning('max')
  assert.equal(client.side.globalReasoning, 'max')
  assert.equal(client.side.reasoning, 'high')
})

test('refreshes the model header from the live session, never the profile default', () => {
  const source = readFileSync('electron/hermes.ts', 'utf8')
  const start = source.indexOf('private async refreshSideData')
  const body = source.slice(start, source.indexOf('side: {', start))
  assert.match(body, /modelOptionsPath\(this\.live\?\.live\)/)
  assert.match(body, /getJson\('\/api\/model\/options'\)/)
  assert.match(body, /pickSessionModel\(row\?\.model/)
  assert.match(body, /globalModel/)

  const openStart = source.indexOf('async openSession')
  const openBody = source.slice(openStart, source.indexOf('async setSessionPinned', openStart))
  assert.match(openBody, /refreshModelOptions/)
  assert.match(openBody, /pickSessionModel\(row\?\.model/)
})

test('global defaults read the global model, not the open session', () => {
  const source = readFileSync('src/SettingsScreen.tsx', 'utf8')
  assert.match(source, /snapshot\.globalModel/)
  assert.doesNotMatch(source, /snapshot\.currentModel/)
})

test('builds cards from approval and clarify control events', () => {
  const approval = questionFromControlEvent('approval.request', 'live-1', {
    kind: 'approval',
    prompt_id: 'p1',
    execution_generation: 7,
    command: 'rm -rf build',
    description: 'Clean the build folder',
    choices: ['once', 'session', 'deny']
  })
  assert.equal(approval?.method, 'approval.request')
  assert.equal(approval?.promptId, 'p1')
  assert.equal(approval?.executionGeneration, 7)
  assert.deepEqual(approval?.choices, ['once', 'session', 'deny'])
  assert.match(approval?.body || '', /rm -rf build/)

  const clarify = questionFromControlEvent('clarify.request', 'live-1', {
    kind: 'clarify',
    prompt_id: 'c1',
    execution_generation: 3,
    question: 'Which target?',
    choices: ['staging', 'production'],
    multi_select: true
  })
  assert.equal(clarify?.method, 'clarify.request')
  assert.equal(clarify?.questions[0].multiSelect, true)
  assert.deepEqual(clarify?.questions[0].choices, ['staging', 'production'])
  assert.equal(questionFromControlEvent('approval.request', 'live-1', {}), null)
})
