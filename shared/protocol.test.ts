import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptAvatar,
  applyDelta,
  applyGatewayEvent,
  buildCreateParams,
  bareModelId,
  buildGatewayWsUrl,
  cookieHeaderFromSetCookie,
  detectAuthMode,
  emptyTranscript,
  historyFromRows,
  modelIdsMatch,
  normalizeMemory,
  normalizeModels,
  normalizeProfiles,
  normalizeSessions,
  questionFromControlEvent,
  questionFromRequest,
  readCreateContract
} from './protocol'

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
