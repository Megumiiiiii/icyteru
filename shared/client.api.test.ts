import assert from 'node:assert/strict'
import test from 'node:test'
import { HermesClient } from '../electron/hermes'

type AnyClient = Record<string, any>

function client(): AnyClient {
  return new HermesClient(() => undefined) as unknown as AnyClient
}

function live(id = 's1') {
  return { live: id, stored: id, subscriptionId: 'sub-1' }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

test('discovers an open, password, token, or unknown gateway', async () => {
  const c = client()
  c.authFetch = async () => response({ auth_required: false })
  assert.equal((await c.discover('http://gw')).mode, 'none')
  c.authFetch = async () => response({ auth_required: true, auth_providers: ['basic'] })
  assert.equal((await c.discover('http://gw')).mode, 'password')
  c.authFetch = async () => response({ auth_required: true, auth_providers: ['session-token'] })
  assert.equal((await c.discover('http://gw')).mode, 'token')
  c.authFetch = async () => response({ auth_required: true, auth_providers: ['nous'] })
  assert.equal((await c.discover('http://gw')).mode, 'unknown')
  c.authFetch = async () => response({}, 503)
  assert.equal((await c.discover('http://gw')).ok, false)
  c.authFetch = async () => { throw new Error('offline') }
  assert.equal((await c.discover('http://gw')).message, 'offline')
})

test('probe restores connection state and closes its isolated socket', async () => {
  const c = client()
  c.baseUrl = 'old'
  c.token = 'old-token'
  c.cookie = 'old-cookie'
  c.authMode = 'token'
  c.loginProvider = 'basic'
  c.discover = async () => ({ ok: true, mode: 'token', providers: [] })
  c.prepare = async (url: string, creds: { token: string }) => {
    c.baseUrl = url
    c.token = creds.token
    c.authMode = 'token'
  }
  c.readStatus = async () => ({ version: '1.2.3' })
  c.openSocket = async () => ({ wsUrl: 'ws://probe', protocols: ['p'], socket: { close() {} } })
  const result = await c.probe('http://new', { token: 'new-token' })
  assert.equal(result.ok, true)
  assert.match(result.message, /1\.2\.3/)
  assert.equal(c.baseUrl, 'old')
  assert.equal(c.token, 'old-token')
  assert.equal(c.cookie, 'old-cookie')
})

test('connect delegates to connectInner and clears the reconnecting flag', async () => {
  const c = client()
  let seen = false
  c.connectInner = async () => { seen = true }
  await c.connect('http://gw', { token: 't' })
  assert.equal(seen, true)
  assert.equal(c.reconnecting, false)
})

test('selectProfile applies the profile and starts a fresh chat', async () => {
  const c = client()
  c.gateways = [{ id: 'primary', url: 'http://gw' }]
  c.profiles = [{ gatewayId: 'primary', name: 'scout', label: 'Scout' }]
  c.activeGatewayId = 'primary'
  c.socket = { isOpen: true }
  let selected = ''
  c.applyProfile = (profile: { name: string }) => { selected = profile.name }
  c.newChat = async () => undefined
  c.refreshSideData = async () => undefined
  c.refreshSessions = async () => undefined
  await c.selectProfile('primary', 'scout')
  assert.equal(selected, 'scout')
})

test('setPinned and createProfile call the gateway and refresh the roster', async () => {
  const c = client()
  c.profiles = [{ gatewayId: 'primary', name: 'scout', botMeta: {} }]
  c.activeGatewayId = 'primary'
  c.socket = { isOpen: true }
  let configured: unknown
  c.tryRpc = async (method: string, params: unknown) => {
    configured = { method, params }
    return { ok: true }
  }
  c.refreshRoster = async () => undefined
  await c.setPinned('primary', 'scout', true)
  assert.equal((configured as any).method, 'profiles.configure')
  await c.createProfile('Scout Two')
  assert.equal((c.profiles as unknown[]).length, 1)
})

test('remote prompt cards are listed, answered, and removed', async () => {
  const c = client()
  c.socket = { isOpen: true }
  c.getJson = async (path: string) => path.includes('clarify')
    ? { pending: [{ clarify_id: 'c1', session_key: 's1', question: 'Q?', choices: ['A'], multi_select: false }] }
    : { pending: [{ request_id: 'r1', session_key: 's1', command: 'rm -rf x', allow_session: true }] }
  await c.refreshRemotePrompts()
  assert.equal((c.remoteClarifies as unknown[]).length, 1)
  assert.equal((c.remoteApprovals as unknown[]).length, 1)
  let posted = ''
  c.postJson = async (path: string) => { posted = path }
  await c.answerRemoteClarify('c1', 'A')
  assert.match(posted, /answer-clarify/)
  assert.equal((c.remoteClarifies as unknown[]).length, 0)
  await c.answerRemoteApproval('s1', 'r1', 'deny')
  assert.match(posted, /answer-approval/)
  assert.equal((c.remoteApprovals as unknown[]).length, 0)
})

test('push registration, feed, media URL, and media bytes use the authenticated client', async () => {
  const c = client()
  c.baseUrl = 'https://gw.example/base'
  const posts: Array<{ path: string; body: unknown }> = []
  c.postJson = async (path: string, body: unknown) => { posts.push({ path, body }); return { ok: true } }
  await c.registerPush('x'.repeat(40), '0.0.56')
  await c.unregisterPush('x'.repeat(40))
  assert.deepEqual(posts.map(item => item.path), [
    '/api/plugins/icyteru-push/register',
    '/api/plugins/icyteru-push/unregister'
  ])
  c.getJson = async () => ({ events: [{ at: 10, title: 'T', body: 'B', session_id: 's' }, { at: 'no' }] })
  assert.deepEqual(await c.notificationFeed(0), [{ at: 10, title: 'T', body: 'B', session_id: 's' }])
  assert.match(c.mediaUrl('/tmp/a b.png'), /media\?path=%2Ftmp%2Fa%20b\.png/)
  c.authFetch = async () => new Response(new Uint8Array([65, 66]), { headers: { 'content-type': 'text/plain' } })
  const media = await c.mediaData('/tmp/a.txt')
  assert.match(media, /^data:text\/plain;base64,QUI=/)
})

test('refreshSessions supports picker, plain, and REST fallbacks', async () => {
  const c = client()
  c.listSessions = async (params: { picker?: boolean }) => params.picker
    ? { ok: false }
    : { ok: true, value: [{ session_id: 's1', title: 'One', model: 'deepseek' }] }
  await c.refreshSessions()
  assert.equal((c.sessions as unknown[]).length, 1)
  c.listStyle = 'plain'
  await c.refreshSessions()
  assert.equal((c.sessions as unknown[]).length, 1)
  c.listSessions = async () => ({ ok: false })
  c.getJson = async () => ({ sessions: [{ session_id: 's2', title: 'Two' }] })
  await c.refreshSessions()
  assert.equal((c.sessions as unknown[]).length, 1)
})

test('send appends a user bubble and submits prompt text', async () => {
  const c = client()
  c.live = live()
  let submitted: any
  c.rpc = async (method: string, params: unknown) => {
    assert.equal(method, 'prompt.submit')
    submitted = params
    return { status: 'accepted' }
  }
  await c.send('hello')
  assert.equal((c.transcript.messages as unknown[]).length, 1)
  assert.match(submitted.text, /hello/)
  c.rpc = async () => { throw new Error('gateway_down') }
  await assert.rejects(() => c.send('again'), /gateway_down/)
  assert.match((c.transcript.messages as any[]).at(-1).error, /gateway_down/)
})

test('queue tracks a receipt and deleteQueued only removes failed entries', async () => {
  const c = client()
  c.live = live()
  c.rpc = async () => ({ status: 'queued', admission_id: 'a1' })
  await c.queue('later')
  assert.equal((c.queued as unknown[]).length, 1)
  await assert.rejects(() => c.deleteQueued((c.queued as any[])[0].id), /cannot safely delete/)
  ;(c.queued as any[])[0].status = 'failed'
  await c.deleteQueued((c.queued as any[])[0].id)
  assert.equal((c.queued as unknown[]).length, 0)
  c.disconnect()
})

test('steer, compress, slash, and interrupt cover their gateway paths', async () => {
  const c = client()
  c.live = live()
  c.executionGeneration = 7
  c.rpc = async (method: string) => {
    if (method === 'session.steer') return { status: 'queued' }
    if (method === 'session.mutate') return { status: 'ok', summary: { headline: 'Compressed' } }
    if (method === 'slash.exec') return { output: 'done' }
    if (method === 'session.interrupt') return {}
    throw new Error(method)
  }
  assert.match(await c.steer('continue'), /Steered/)
  assert.match(await c.compress(), /Compressed/)
  assert.equal(await c.slash('/status'), 'done')
  c.transcript = { messages: [], streaming: true }
  await c.interrupt()
  assert.equal(c.transcript.streaming, false)
})

test('answer handles test, approval, clarify, and generic responses', async () => {
  const c = client()
  const calls: string[] = []
  c.rpc = async (method: string) => { calls.push(method); return {} }
  c.question = { id: 'q-test', test: true }
  await c.answer('q-test', {})
  assert.equal(c.question, null)
  c.question = { id: 'q-a', method: 'approval.request', promptId: 'p1', sessionId: 's1', executionGeneration: 2 }
  await c.answer('q-a', { choice: 'once' })
  assert.deepEqual(calls, ['approval.respond'])
  c.question = { id: 'q-c', method: 'clarify.request', promptId: 'p2', sessionId: 's1', executionGeneration: 3 }
  await c.answer('q-c', { answers: { q1: ['A', 'B'], q2: 'C' } })
  assert.equal(calls.at(-1), 'clarify.respond')
})

test('setModel posts the global route and refreshes side data', async () => {
  const c = client()
  let posted: unknown
  c.postJson = async (_path: string, body: unknown) => { posted = body; return { ok: true } }
  c.refreshSideData = async () => undefined
  await c.setModel('deepseek', 'opencode-go')
  assert.equal((posted as any).scope, 'main')
  assert.equal((posted as any).model, 'deepseek')
  await assert.rejects(() => c.setGlobalReasoning('bogus'), /Choose a reasoning level/)
})

test('onEvent applies transcript, tool, session, control, and subagent events', async () => {
  const c = client()
  c.live = live('s1')
  c.sessions = [{ id: 's1', title: 'Old', model: 'deepseek' }]
  let refreshed = 0
  c.refreshSessions = async () => { refreshed += 1 }
  c.onEvent({ type: 'message.delta', session_id: 's1', payload: { text: 'Hello', offset: 0, turn_id: 't', segment: 0 } })
  assert.match(c.transcript.messages[0].text, /Hello/)
  c.onEvent({ type: 'tool.start', session_id: 's1', payload: { tool_id: 't1', name: 'terminal', args: { command: 'ls' } } })
  c.onEvent({ type: 'tool.complete', session_id: 's1', payload: { tool_id: 't1', name: 'terminal', summary: 'ok' } })
  assert.equal(c.transcript.messages[0].tools.length, 1)
  c.onEvent({ type: 'session.title', session_id: 's1', payload: { title: 'New title' } })
  assert.equal(c.sessions[0].title, 'New title')
  c.onEvent({ type: 'session.usage', session_id: 's1', payload: { usage: { avg_tps: 42 } } })
  assert.equal(c.side.tokensPerSecond, 42)
  c.onEvent({ type: 'message.complete', session_id: 's1', payload: { text: 'Done', status: 'ok' } })
  assert.equal(refreshed >= 1, true)
  c.onEvent({ type: 'approval.request', session_id: 's1', payload: { prompt_id: 'p1', title: 'Approval', body: 'Run?', choices: ['once', 'deny'] } })
  assert.equal(c.question?.promptId, 'p1')
  c.onEvent({ type: 'approval.settled', session_id: 's1', payload: { prompt_id: 'p1' } })
  assert.equal(c.question, null)
  c.onEvent({ type: 'subagent.start', session_id: 's1', payload: { subagent_id: 'sa1', goal: 'audit' } })
  assert.equal((c.subagents as unknown[]).length, 1)
  c.onEvent({ type: 'message.delta', session_id: 'other', payload: { text: 'ignored', offset: 0, turn_id: 'x', segment: 0 } })
  assert.doesNotMatch(c.transcript.messages.map((message: any) => message.text).join(' '), /ignored/)
})

test('onLost ignores a deliberate reconnect and reports an unexpected drop', () => {
  const c = client()
  c.transcript = { messages: [], streaming: true }
  c.reconnecting = true
  c.onLost('old socket closed')
  assert.equal(c.lastError, '')
  c.reconnecting = false
  c.onLost('connection dropped')
  assert.equal(c.lastError, 'connection dropped')
  assert.equal(c.transcript.streaming, false)
})

test('send stages image and file attachments into the submitted prompt', async () => {
  const c = client()
  c.live = live()
  c.stageAttachment = async (_session: string, file: { mime: string; name: string }) => file.mime.startsWith('image/')
    ? { ref: '@image:/tmp/a.png', image: { path: '/tmp/a.png', mime: file.mime } }
    : { ref: `@file:/tmp/${file.name}` }
  let submitted: any
  c.rpc = async (_method: string, params: unknown) => { submitted = params; return {} }
  await c.send('look', [
    { name: 'a.png', mime: 'image/png', base64: 'YQ==' },
    { name: 'notes.md', mime: 'text/markdown', base64: 'Yg==' }
  ])
  assert.match(submitted.text, /@image:\/tmp\/a\.png/)
  assert.match(submitted.text, /@file:\/tmp\/notes\.md/)
  assert.deepEqual(submitted.attachments, [{ path: '/tmp/a.png', mime: 'image/png' }])
  const bubble = c.transcript.messages[0] as any
  assert.equal(bubble.attachments.length, 2)
  assert.equal(bubble.attachments[0].image, true)
  assert.match(bubble.attachments[0].dataUrl, /^data:image\/png;base64,/)
  assert.equal(bubble.attachments[1].name, 'notes.md')
  assert.match(bubble.attachments[1].dataUrl, /^data:text\/markdown;base64,/)
})

test('setSessionModel returns a confirmation card and cancel drops it', async () => {
  const c = client()
  c.live = live('s1')
  c.rpc = async (method: string) => {
    if (method === 'session.resume') return { revision: 4, execution_generation: 2 }
    if (method === 'session.mutate') return { status: 'confirmation_required', confirm: 'token-1', confirm_message: 'Large context switch' }
    throw new Error(method)
  }
  const result = await c.setSessionModel('big-model', 'provider')
  assert.equal((result as any).confirmationRequired, true)
  assert.equal(c.pendingModelConfirmation.token, 'token-1')
  c.cancelSessionModel()
  assert.equal(c.pendingModelConfirmation, null)
})

test('refreshRoster falls back to a default profile and emits', async () => {
  const c = client()
  c.gateways = [{ id: 'primary', url: 'http://gw' }]
  c.activeGatewayId = 'primary'
  c.readProfiles = async () => []
  let emitted = 0
  c.emit = () => { emitted += 1 }
  await c.refreshRoster()
  assert.equal(c.profiles[0].name, 'default')
  assert.equal(emitted, 1)
})

test('connectInner wires discovery, status, socket, roster, and side data', async () => {
  const c = client()
  c.discover = async () => ({ ok: true, mode: 'token', providers: [] })
  c.prepare = async () => { c.token = 't' }
  c.readStatus = async () => ({ version: '9.9' })
  c.openSocket = async () => ({ wsUrl: 'ws://gw', protocols: ['p'], socket: { isOpen: true } })
  c.afterReady = async () => undefined
  c.refreshRoster = async () => {
    c.profiles = [{ gatewayId: 'primary', name: 'default', label: 'Hermes', avatar: '' }]
  }
  c.refreshSideData = async () => undefined
  c.refreshSessions = async () => undefined
  c.startClarifyPolling = () => undefined
  c.resumeQueuePolling = () => undefined
  await c.connectInner('http://gw', { token: 't' })
  assert.equal(c.version, '9.9')
  assert.equal(c.baseUrl, 'http://gw')
  assert.equal(c.activeProfile, 'default')
  assert.equal(c.socket.isOpen, true)
  assert.equal(c.gateways.length, 1)
})

test('refreshSessions keeps omitted history when the live fallback is a subset', async () => {
  const c = client()
  const row = (id: string) => ({ id, title: id, preview: '', source: 'telegram', model: 'deepseek', updatedAt: null, messageCount: 0, running: false, pinned: false })
  c.sessions = [row('old-a'), row('old-b')]
  ;(c as unknown as { listSessions: (params: Record<string, unknown>) => Promise<unknown> }).listSessions = async params => {
    if (params.scope === 'stored') return { ok: false, error: 'profile_mismatch' }
    return { ok: true, value: { sessions: [{ session_id: 'new-c', title: 'new-c', source: 'telegram', message_count: 1 }] } }
  }
  await c.refreshSessions()
  assert.deepEqual(c.sessions.map((row: { id: string }) => row.id).sort(), ['new-c', 'old-a', 'old-b'])
})

test('connectInner preserves the selected profile on reconnect', async () => {
  const c = client()
  c.activeProfile = 'scout'
  c.discover = async () => ({ ok: true, mode: 'token', providers: [] })
  c.prepare = async () => { c.token = 't' }
  c.readStatus = async () => ({ version: '9.9' })
  c.openSocket = async () => ({ wsUrl: 'ws://gw', protocols: ['p'], socket: { isOpen: true } })
  c.afterReady = async () => undefined
  c.refreshRoster = async () => {
    c.profiles = [
      { gatewayId: 'primary', name: 'default', label: 'Hermes', avatar: '' },
      { gatewayId: 'primary', name: 'scout', label: 'Scout', avatar: '' }
    ]
  }
  c.refreshSideData = async () => undefined
  c.refreshSessions = async () => undefined
  c.startClarifyPolling = () => undefined
  c.resumeQueuePolling = () => undefined
  await c.connectInner('http://gw', { token: 't' })
  assert.equal(c.activeProfile, 'scout')
})

test('prepare supports token and password modes and rejects missing credentials', async () => {
  const c = client()
  const cookieResponse = {
    ok: true,
    status: 200,
    headers: { getSetCookie: () => ['hermes_session_at=abc; Path=/'], get: () => null }
  }
  c.authFetch = async () => cookieResponse
  await c.prepare('http://gw', { username: 'u', password: 'p' }, 'password', ['basic'])
  assert.equal(c.cookie, 'hermes_session_at=abc')
  assert.equal(c.authMode, 'password')
  await c.prepare('http://gw', { token: 'tok' }, 'token')
  assert.equal(c.authMode, 'token')
  await assert.rejects(() => c.prepare('http://gw', {}, 'password', ['basic']), /username and password/)
})

test('createSession uses the contract and skips onboarding', async () => {
  const c = client()
  const calls: string[] = []
  c.rpc = async (method: string) => {
    calls.push(method)
    if (method === 'session.create') return { session_id: 'live-1', stored_session_id: 'stored-1', revision: 3, execution_generation: 4 }
    return {}
  }
  const result = await (c as unknown as { createSession: () => Promise<{ live: string; stored: string }> }).createSession()
  assert.deepEqual(result, { live: 'live-1', stored: 'stored-1' })
  assert.deepEqual(calls, ['session.create', 'onboarding.skip'])
  assert.equal(c.revision, 3)
  assert.equal(c.executionGeneration, 4)
})

test('openSocket tries a cookie ticket and a token URL', async () => {
  const c = client()
  c.token = 't'
  c.cookie = 'c'
  c.mintTicket = async () => 'ticket-1'
  c.dial = async (url: string) => ({ isOpen: true, url })
  const result = await (c as unknown as { openSocket: (url: string) => Promise<{ wsUrl: string; protocols: string[] }> }).openSocket('http://gw')
  assert.match(result.wsUrl, /native_dial=browser/)
  assert.deepEqual(result.protocols, ['hermes-gateway-v1', 'hermes-gateway-ticket.ticket-1'])
})

test('HTTP helpers parse JSON, renew a 401 once, and surface details', async () => {
  const c = client()
  c.baseUrl = 'http://gw'
  let calls = 0
  c.authFetch = async () => {
    calls += 1
    if (calls === 1) return response({ detail: 'expired' }, 401)
    return response({ ok: true })
  }
  c.renewSession = async () => true
  assert.deepEqual(await (c as unknown as { getJson: (path: string) => Promise<unknown> }).getJson('/x'), { ok: true })
  assert.equal(calls, 2)
  c.authFetch = async () => response({ detail: 'nope' }, 400)
  await assert.rejects(() => (c as unknown as { postJson: (path: string, body: unknown) => Promise<unknown> }).postJson('/x', {}), /nope/)
})

test('setExtraGateways keeps the primary and adds the extras', async () => {
  const c = client()
  c.gateways = [{ id: 'primary', url: 'http://gw' }]
  c.refreshRoster = async () => undefined
  await c.setExtraGateways([{ id: 'second', url: 'http://gw2', token: 't' }])
  assert.equal(c.gateways.length, 2)
  assert.equal(c.gateways[1].id, 'second')
})

test('testApproval and setSessionPinned call the plugin routes', async () => {
  const c = client()
  const posts: Array<{ path: string; body: unknown }> = []
  c.postJson = async (path: string, body: unknown) => { posts.push({ path, body }); return { ok: true, session_id: 's' } }
  c.refreshSessions = async () => undefined
  assert.deepEqual(await c.testApproval(), { ok: true, session_id: 's' })
  c.sessions = [{ id: 's1', title: 'One', pinned: false }]
  await c.setSessionPinned('s1', true)
  assert.equal((c.sessions[0] as any).pinned, true)
  assert.equal(posts[1].path, '/api/plugins/icyteru-push/session-pin')
})

test('compress handles pending and rows, and steer handles rejection', async () => {
  const c = client()
  c.live = live()
  c.executionGeneration = 3
  c.rpc = async (method: string) => {
    if (method === 'session.mutate') return { status: 'pending' }
    if (method === 'session.steer') return { status: 'rejected' }
    throw new Error(method)
  }
  assert.match(await c.compress(), /still running/)
  assert.match(await c.steer('x'), /rejected/)
})

test('answer covers generic server responses and no live interrupt', async () => {
  const c = client()
  let responded = ''
  c.socket = { respond: (id: string) => { responded = id } }
  c.question = { id: 'q-generic', promptId: 'p', method: 'custom' }
  await c.answer('q-generic', { ok: true })
  assert.equal(responded, 'q-generic')
  await c.interrupt()
  assert.equal(c.transcript.streaming, false)
})

test('passwordLogin reports gateway auth errors', async () => {
  const c = client()
  for (const [status, pattern] of [[401, /refused/], [429, /Too many/], [404, /does not offer/], [500, /rejected/]] as const) {
    c.authFetch = async () => response({}, status)
    await assert.rejects(() => c.prepare('http://gw', { username: 'u', password: 'p' }, 'password', ['basic']), pattern)
  }
})

test('probe returns a discovery failure without touching live credentials', async () => {
  const c = client()
  c.baseUrl = 'old'
  c.token = 'old'
  c.discover = async () => ({ ok: false, message: 'offline', mode: 'unknown' })
  const result = await c.probe('http://new', { token: 'new' })
  assert.equal(result.ok, false)
  assert.equal(result.message, 'offline')
  assert.equal(c.baseUrl, 'old')
  assert.equal(c.token, 'old')
})

test('compress applies returned messages and summary', async () => {
  const c = client()
  c.live = live()
  c.revision = 2
  c.rpc = async () => ({
    status: 'ok',
    messages: [{ role: 'user', content: 'after compress' }],
    summary: { headline: 'Headline', token_line: 'Tokens 1' }
  })
  c.refreshSessions = async () => undefined
  const text = await c.compress()
  assert.match(text, /Headline/)
  assert.match(text, /Tokens 1/)
  assert.match(c.transcript.messages[0].text, /after compress/)
})

test('openSocket falls back to the token attempt when the cookie attempt fails', async () => {
  const c = client()
  c.token = 't'
  c.cookie = 'c'
  c.mintTicket = async () => 'ticket'
  let calls = 0
  c.dial = async (url: string) => {
    calls += 1
    if (calls === 1) throw new Error('cookie attempt failed')
    return { isOpen: true, url }
  }
  const result = await (c as unknown as { openSocket: (url: string) => Promise<{ wsUrl: string }> }).openSocket('http://gw')
  assert.match(result.wsUrl, /token=t/)
  assert.equal(calls, 2)
})

test('sessionInfo reads live context and transcript estimate, and /usage is client-side', async () => {
  const c = client()
  c.live = live('s1')
  c.sessions = [{ id: 's1', title: 'Session One', preview: '', source: 'telegram', model: 'deepseek', updatedAt: null, messageCount: 30, running: false, pinned: false }]
  c.socket = { isOpen: true }
  c.rpc = async (method: string) => {
    assert.equal(method, 'session.stats')
    return { context_tokens: 24817, context_length: 200000, model: 'deepseek-v4.1-flash', input_tokens: 1000, output_tokens: 200, total_tokens: 1200, api_calls: 3 }
  }
  c.getJson = async () => Array.from({ length: 30 }, (_, index) => ({ role: 'user', content: `message ${index} ${'x'.repeat(40)}` }))
  const info = await c.sessionInfo('s1')
  assert.equal(info.messages, 30)
  assert.equal(info.estimatedTokens, 24817)
  const usage = await c.slash('/usage')
  assert.match(usage, /📊 Usage/)
  assert.match(usage, /Context: 24,817/)
  assert.match(usage, /Messages: 30/)
})

test('sessionInfo falls back to the transcript estimate without live stats', async () => {
  const c = client()
  c.sessions = [{ id: 's1', title: 'Old', preview: '', source: 'telegram', model: '', updatedAt: null, messageCount: 2, running: false, pinned: false }]
  c.socket = { isOpen: false }
  c.getJson = async () => [{ role: 'user', content: 'x'.repeat(400) }, { role: 'assistant', content: 'y'.repeat(400) }]
  const info = await c.sessionInfo('s1')
  assert.equal(info.messages, 2)
  assert.equal(info.estimatedTokens, 200)
})

test('disconnect stops polling and clears ephemeral session state', () => {
  const c = client()
  c.live = live()
  c.transcript = { messages: [{ id: 'u', role: 'user', text: 'x', tools: [], pending: false }], streaming: true }
  c.remoteClarifies = [{}]
  c.remoteApprovals = [{}]
  c.subagents = [{}]
  c.question = { id: 'q' }
  c.socket = { close() {} }
  c.queuePoll = setInterval(() => undefined, 10000)
  c.clarifyPoll = setInterval(() => undefined, 10000)
  c.disconnect()
  assert.equal(c.live, null)
  assert.equal(c.transcript.messages.length, 0)
  assert.equal(c.remoteClarifies.length, 0)
  assert.equal(c.remoteApprovals.length, 0)
  assert.equal(c.subagents.length, 0)
  assert.equal(c.question, null)
  assert.equal(c.queuePoll, null)
  assert.equal(c.clarifyPoll, null)
})
