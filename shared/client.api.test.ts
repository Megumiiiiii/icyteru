import assert from 'node:assert/strict'
import test from 'node:test'
import { HermesClient } from './hermes'

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

test('refreshSessions keeps a REST-only local session the picker omits', async () => {
  const c = client()
  c.listStyle = 'picker'
  c.sessions = []
  c.listJobSessions = async () => []
  c.listSessions = async (params: { scope?: string }) => params.scope === 'stored'
    ? { ok: true, value: { sessions: [{ session_id: 'stored-1', title: 'Stored', source: 'telegram', message_count: 2 }] } }
    : { ok: true, value: { sessions: [] } }
  c.getJson = async () => ({
    sessions: [{
      id: 'local-preview', title: 'Buka panel preview', source: 'local', message_count: 36
    }]
  })
  await c.refreshSessions()
  assert.deepEqual((c.sessions as Array<{ id: string }>).map(row => row.id).sort(), ['local-preview', 'stored-1'])
})

test('connect reopens the active session after a same-gateway reconnect', async () => {
  const c = client()
  c.baseUrl = 'http://gw'
  c.live = { live: 'live-1', stored: 'stored-1', subscriptionId: 'sub-1' }
  let opened = ''
  c.connectInner = async () => undefined
  c.openSession = async (id: string) => { opened = id }
  await c.connect('http://gw', { token: 't' })
  assert.equal(opened, 'stored-1')
  assert.equal(c.reconnecting, false)
})

test('connect restores a session remembered across a WebView restart', async () => {
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
    key: () => null,
    length: 0
  } as Storage
  store.set('icyteru.active-session.v1', JSON.stringify({ url: 'http://gw', id: 'stored-1' }))
  const c = client()
  c.baseUrl = ''
  c.live = null
  let opened = ''
  c.connectInner = async () => undefined
  c.openSession = async (id: string) => { opened = id }
  await c.connect('http://gw', { token: 't' })
  assert.equal(opened, 'stored-1')
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage
})

test('connect does not carry the old session to a different gateway', async () => {
  const c = client()
  c.baseUrl = 'http://old'
  c.live = { live: 'live-1', stored: 'stored-1', subscriptionId: 'sub-1' }
  let opened = ''
  c.connectInner = async () => undefined
  c.openSession = async (id: string) => { opened = id }
  await c.connect('http://new', { token: 't' })
  assert.equal(opened, '')
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
  c.sessions = [{ id: 'old-profile-row', title: 'Old profile' }]
  c.socket = { isOpen: true }
  let selected = ''
  c.applyProfile = (profile: { name: string }) => { selected = profile.name }
  c.newChat = async () => undefined
  c.refreshSideData = async () => undefined
  c.refreshSessions = async () => undefined
  await c.selectProfile('primary', 'scout')
  assert.equal(selected, 'scout')
  assert.equal(c.sessions.length, 0)
})

test('refreshSessions ignores a stale response after the profile changes', async () => {
  const c = client()
  c.activeProfile = 'rin'
  c.profileEpoch = 1
  c.sessions = [{ id: 'rin-row', title: 'Rin' }]
  c.listJobSessions = async () => []
  let resolveList: (value: unknown) => void = () => undefined
  c.listSessions = () => new Promise(resolve => { resolveList = resolve })
  const pending = c.refreshSessions()
  c.activeProfile = 'dialpool'
  c.profileEpoch = 2
  c.sessions = []
  resolveList({ ok: true, value: { sessions: [{ session_id: 'rin-row', title: 'Rin old' }] } })
  await pending
  assert.equal(c.sessions.length, 0)
})

test('refreshSessions merges one-shot jobs hidden by the picker', async () => {
  const c = client()
  c.activeProfile = 'dialpool'
  c.sessions = []
  c.listStyle = 'plain'
  c.listJobSessions = async () => [{
    id: 'job-1', title: 'Job one', preview: '', source: 'oneshot', model: '',
    updatedAt: 2, messageCount: 4, running: false, pinned: false
  }]
  c.listSessions = async () => ({ ok: true, value: { sessions: [] } })
  await c.refreshSessions()
  assert.equal(c.sessions.length, 1)
  assert.equal(c.sessions[0].id, 'job-1')
  assert.equal(c.profileApiPath('/api/sessions?source=oneshot'), '/p/dialpool/api/sessions?source=oneshot')
})

test('listJobSessions respects the dashboard limit and reads one-shot rows', async () => {
  const c = client()
  let seen = ''
  c.getJson = async (path: string) => {
    seen = path
    return { data: [{ id: 'job-1', source: 'oneshot', title: 'Gleam audit', message_count: 15 }] }
  }
  const rows = await c.listJobSessions()
  assert.match(seen, /source=oneshot/)
  assert.match(seen, /limit=100/)
  assert.doesNotMatch(seen, /limit=200/)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'job-1')
})

test('refreshSessions merges a live local session the stored picker omits', async () => {
  const c = client()
  c.listStyle = 'picker'
  c.listJobSessions = async () => []
  let liveParams: { picker?: boolean } = {}
  c.listSessions = async (params: { scope?: string; picker?: boolean }) => {
    if (params.scope === 'stored') {
      return { ok: true, value: { sessions: [{ session_id: 'stored-1', title: 'Stored', source: 'telegram', message_count: 2, pinned: true }] } }
    }
    liveParams = params
    return { ok: true, value: { sessions: [{ session_id: 'live-local', title: 'Ineffa ASCII art self-portrait', source: 'local', message_count: 2, running: true, pinned: true }] } }
  }
  await c.refreshSessions()
  assert.equal(liveParams.picker, true)
  assert.deepEqual((c.sessions as Array<{ id: string }>).map(row => row.id).sort(), ['live-local', 'stored-1'])
  assert.equal((c.sessions as Array<{ pinned: boolean }>).every(row => row.pinned), true)
})

test('subagent.list fills the card when the turn route sends no subagent events', async () => {
  const c = client()
  c.live = live('s1')
  c.socket = { isOpen: true }
  c.rpc = async (method: string) => {
    assert.equal(method, 'subagent.list')
    return {
      subagents: [{
        subagent_id: 'sa-1', goal: 'write the guide', status: 'running',
        parent_id: '', child_session_id: 'child-1', delegation_id: 'deleg-1',
        depth: 0, model: 'deepseek', tool_count: 3, last_tool: 'write_file',
        started_at: Date.now() / 1000
      }]
    }
  }
  await c.refreshSubagents()
  assert.equal((c.subagents as Array<{ id: string; toolCount: number; lastText: string }>).length, 1)
  assert.equal(c.subagents[0].id, 'sa-1')
  assert.equal(c.subagents[0].toolCount, 3)
  assert.equal(c.subagents[0].lastText, 'write_file')
})

test('refreshSubagents clears a vanished live child after a confirmation poll', async () => {
  const c = client()
  c.live = live('s1')
  c.socket = { isOpen: true }
  c.subagents = [{ id: 'sa-gone', status: 'running' }]
  c.subagentPoll = setInterval(() => undefined, 60_000)
  c.rpc = async (method: string) => {
    assert.equal(method, 'subagent.list')
    return { subagents: [] }
  }
  try {
    await c.refreshSubagents()
    assert.equal(c.subagents.length, 1, 'first empty poll tolerates spawn/list registration races')
    assert.notEqual(c.subagentPoll, null)
    await c.refreshSubagents()
    assert.equal(c.subagents.length, 0, 'second empty poll is authoritative completion')
    assert.equal(c.subagentPoll, null)
  } finally {
    if (c.subagentPoll) clearInterval(c.subagentPoll)
  }
})

test('refreshSubagents drops live rows absent from a non-empty authoritative list', async () => {
  const c = client()
  c.live = live('s1')
  c.socket = { isOpen: true }
  c.subagents = [
    { id: 'sa-live', status: 'running', goal: 'live old' },
    { id: 'sa-stale', status: 'running', goal: 'stale child' }
  ]
  c.rpc = async () => ({
    subagents: [{ subagent_id: 'sa-live', status: 'running', goal: 'live current', tool_count: 4 }]
  })
  await c.refreshSubagents()
  assert.deepEqual(c.subagents.map((item: { id: string }) => item.id), ['sa-live'])
  assert.equal(c.subagents[0].goal, 'live current')
  assert.equal(c.subagents[0].toolCount, 4)
})

test('a delegate_task event starts subagent polling and fills the card state', async () => {
  const c = client()
  c.live = live('s1')
  c.socket = { isOpen: true, close() {} }
  let calls = 0
  c.rpc = async (method: string) => {
    if (method !== 'subagent.list') throw new Error(`unexpected ${method}`)
    calls += 1
    return {
      subagents: [{
        subagent_id: 'sa-0-d2246c6e', goal: 'write the fiction file', status: 'running',
        parent_id: '', child_session_id: 'child-a', delegation_id: 'deleg-1',
        depth: 0, model: 'deepseek', tool_count: 1, last_tool: 'write_file',
        started_at: Date.now() / 1000
      }]
    }
  }
  c.onEvent({
    type: 'tool.start', session_id: 's1',
    payload: { tool_id: 'delegate-1', name: 'delegate_task', args: { tasks: [{ goal: 'write' }] } }
  })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.ok(calls >= 1)
  assert.equal((c.subagents as Array<{ id: string }>).length, 1)
  assert.equal(c.subagents[0].id, 'sa-0-d2246c6e')
  c.stopSubagentPolling()
})

test('onEvent never paints another session into an empty chat', () => {
  const c = client()
  c.live = null
  c.transcript = { messages: [], streaming: false }
  c.refreshSessions = async () => undefined
  c.onEvent({ type: 'message.delta', session_id: 'other', payload: { text: 'leak', offset: 0, turn_id: 't', segment: 0 } })
  c.onEvent({ type: 'tool.start', session_id: 'other', payload: { tool_id: 't1', name: 'terminal' } })
  c.onEvent({ type: 'message.complete', session_id: 'other', payload: { text: 'done', status: 'ok' } })
  assert.equal(c.transcript.messages.length, 0)
  assert.equal(c.transcript.streaming, false)
})

test('session.info keeps the active turn running after a tool preamble', () => {
  const c = client()
  c.live = live('s1')
  c.transcript = { messages: [], streaming: false }
  c.sessions = [{ id: 's1', title: 'Active', running: false }]
  c.onEvent({
    type: 'session.info',
    session_id: 's1',
    execution_generation: 9,
    payload: { running: true, revision: 7 }
  })
  assert.equal(c.transcript.streaming, true)
  assert.equal(c.sessions[0].running, true)
  assert.equal(c.executionGeneration, 9)
  assert.equal(c.revision, 7)
  c.onEvent({ type: 'session.info', session_id: 'other', payload: { running: true } })
  assert.equal(c.transcript.streaming, true)
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

test('setProfileHidden updates hermes-bots metadata and refuses to hide the last visible agent', async () => {
  const c = client()
  c.profiles = [
    { gatewayId: 'primary', name: 'scout', hidden: false, botMeta: { title: 'Scout' } },
    { gatewayId: 'primary', name: 'noustest', hidden: false, botMeta: {} }
  ]
  c.activeGatewayId = 'primary'
  c.activeProfile = 'scout'
  c.socket = { isOpen: true }
  let configured: unknown
  c.tryRpc = async (method: string, params: unknown) => {
    configured = { method, params }
    return { ok: true }
  }
  c.refreshRoster = async () => undefined
  await c.setProfileHidden('primary', 'noustest', true)
  assert.equal((configured as any).method, 'profiles.configure')
  assert.equal((configured as any).params.ui_meta['hermes-bots'].hidden, true)
  assert.equal((configured as any).params.ui_meta['hermes-bots'].title, undefined)
  c.profiles = [{ gatewayId: 'primary', name: 'scout', hidden: false, botMeta: { title: 'Scout' } }]
  await assert.rejects(
    () => c.setProfileHidden('primary', 'scout', true),
    /at least one visible agent/
  )
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

test('queue cancels a live entry through the gateway and drops failed ones locally', async () => {
  const c = client()
  c.live = live()
  const calls: string[] = []
  c.rpc = async (method: string) => {
    calls.push(method)
    if (method === 'prompt.cancel') return { status: 'terminal', outcome: 'cancelled' }
    return { status: 'queued', admission_id: 'a1' }
  }
  await c.queue('later')
  assert.equal((c.queued as unknown[]).length, 1)
  await c.deleteQueued((c.queued as any[])[0].id)
  assert.deepEqual(calls, ['prompt.submit', 'prompt.cancel'])
  assert.equal((c.queued as unknown[]).length, 0)

  ;(c.queued as any[]).push({ id: 'q2', sessionId: 's1', text: 'boom', attachmentNames: [], status: 'failed', createdAt: 1 })
  await c.deleteQueued('q2')
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

test('renameSession uses fenced PATCH with mutation-snapshot and updates sessions', async () => {
  const c = client()
  const patches: Array<{ path: string; body: Record<string, unknown> }> = []
  c.activeProfile = 'work'
  c.sessions = [{ id: 's1', title: 'Old title', pinned: false }]
  c.getJson = async (path: string) => {
    assert.equal(path, '/p/work/api/sessions/s1/mutation-snapshot')
    return { session_id: 's1', exists: true, runtime_revision: 7, runtime_generation: 2 }
  }
  c.patchJson = async (path: string, body: unknown) => {
    patches.push({ path, body: body as Record<string, unknown> })
    return { ok: true, title: 'New title' }
  }
  let refreshed = false
  c.refreshSessions = async () => { refreshed = true }
  await c.renameSession('s1', '  New title  ')
  assert.equal((c.sessions[0] as any).title, 'New title')
  assert.equal(refreshed, true)
  assert.equal(patches.length, 1)
  assert.equal(patches[0].path, '/p/work/api/sessions/s1')
  assert.equal(patches[0].body.title, 'New title')
  assert.equal(patches[0].body.profile, 'work')
  assert.equal(patches[0].body.expected_revision, 7)
  assert.equal(patches[0].body.expected_generation, 2)
  assert.match(String(patches[0].body.request_id), /^icy-rename-/)
  await assert.rejects(() => c.renameSession('s1', '   '), /Enter a name/)
})

test('renameSession falls back only for the legacy missing endpoint response', async () => {
  const c = client()
  c.baseUrl = 'http://gw'
  c.sessions = [{ id: 's2', title: 'Legacy', pinned: false }]
  c.refreshSessions = async () => undefined
  const patches: Record<string, unknown>[] = []
  c.authFetch = async (_url: string, init?: RequestInit) => {
    if ((init?.method || 'GET') === 'GET') return response({ detail: 'No such API endpoint' }, 404)
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    patches.push(body)
    return response({ ok: true, title: 'Renamed legacy' })
  }
  await c.renameSession('s2', 'Renamed legacy')
  assert.equal((c.sessions[0] as any).title, 'Renamed legacy')
  assert.deepEqual(patches, [{ title: 'Renamed legacy' }])
})

test('renameSession does not downgrade unrelated snapshot errors to an unfenced write', async () => {
  const c = client()
  c.baseUrl = 'http://gw'
  c.sessions = [{ id: 's404', title: 'Before', pinned: false }]
  let patches = 0
  c.authFetch = async (_url: string, init?: RequestInit) => {
    if ((init?.method || 'GET') !== 'GET') patches += 1
    return response({ detail: 'session_not_found' }, 404)
  }
  await assert.rejects(() => c.renameSession('s404', 'After'), /session_not_found/)
  assert.equal(patches, 0)
})

test('renameSession reports a real revision conflict without overwriting it', async () => {
  const c = client()
  c.baseUrl = 'http://gw'
  c.sessions = [{ id: 's3', title: 'Before', pinned: false }]
  let snapshots = 0
  let patches = 0
  c.authFetch = async (_url: string, init?: RequestInit) => {
    if ((init?.method || 'GET') === 'GET') {
      snapshots += 1
      return response({ exists: true, runtime_revision: 7, runtime_generation: 2 })
    }
    patches += 1
    return response({ detail: 'revision_conflict' }, 409)
  }
  await assert.rejects(() => c.renameSession('s3', 'After'), /session changed/)
  assert.equal(snapshots, 1)
  assert.equal(patches, 1)
  assert.equal((c.sessions[0] as any).title, 'Before')
})

test('renameSession rejects missing snapshot identity and overlong names cleanly', async () => {
  const c = client()
  c.sessions = [{ id: 'gone', title: 'Gone', pinned: false }]
  c.getJson = async () => ({ exists: false, runtime_revision: null })
  await assert.rejects(() => c.renameSession('gone', 'New title'), /no longer exists/)
  await assert.rejects(() => c.renameSession('gone', 'x'.repeat(201)), /at most 200/)

  c.getJson = async () => ({ exists: true, runtime_revision: null, runtime_generation: 1 })
  await assert.rejects(() => c.renameSession('gone', 'New title'), /current session state/)
  c.getJson = async () => ({ exists: true, runtime_revision: 1, runtime_generation: null })
  await assert.rejects(() => c.renameSession('gone', 'New title'), /current session generation/)
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

test('opening an idle session clears a stale running row and streaming state', async () => {
  const c = client()
  c.sessions = [{ id: 's1', title: 'Dialectica earn', preview: '', source: 'telegram', model: 'deepseek', updatedAt: null, messageCount: 438, running: true, pinned: true }]
  c.rpc = async (method: string) => {
    if (method === 'session.resume') return { messages: [], running: false, execution_generation: 42 }
    throw new Error(method)
  }
  c.getJson = async () => null
  await c.openSession('s1')
  assert.equal(c.transcript.streaming, false)
  assert.equal(c.sessions[0].running, false)
})

test('steer on an idle session clears a stale working state instead of failing', async () => {
  const c = client()
  c.live = live('s1')
  c.executionGeneration = 42
  c.transcript = { messages: [], streaming: true }
  c.rpc = async (method: string) => {
    if (method === 'session.steer') throw new Error('stale_generation')
    if (method === 'session.resume') return { running: false, execution_generation: 42 }
    throw new Error(method)
  }
  assert.equal(await c.steer('are you there?'), 'not_running')
  assert.equal(c.transcript.streaming, false)
  assert.equal(c.executionGeneration, 0)
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
  c.sessionPoll = setInterval(() => undefined, 10000)
  c.disconnect()
  assert.equal(c.live, null)
  assert.equal(c.transcript.messages.length, 0)
  assert.equal(c.remoteClarifies.length, 0)
  assert.equal(c.remoteApprovals.length, 0)
  assert.equal(c.subagents.length, 0)
  assert.equal(c.question, null)
  assert.equal(c.queuePoll, null)
  assert.equal(c.clarifyPoll, null)
  assert.equal(c.sessionPoll, null)
})

test('selectProfile keeps the open session when the active profile is clicked again', async () => {
  const c = client()
  c.gateways = [{ id: 'primary', url: 'http://gw' }]
  c.profiles = [{ gatewayId: 'primary', name: 'rin', label: 'Rin' }]
  c.activeGatewayId = 'primary'
  c.activeProfile = 'rin'
  c.live = live('s-open')
  c.sessions = [{ id: 's-open', title: 'Open chat', running: false }]
  c.socket = { isOpen: true }
  let reset = false
  c.newChat = async () => { reset = true }
  await c.selectProfile('primary', 'rin')
  assert.equal(reset, false)
  assert.equal(c.live.stored, 's-open')
  assert.equal(c.sessions.length, 1)
})

test('connect restores the remembered profile along with the active session', async () => {
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
    key: () => null,
    length: 0
  } as Storage
  store.set('icyteru.active-session.v1', JSON.stringify({ url: 'http://gw', id: 'stored-rin', profile: 'rin' }))
  const c = client()
  c.baseUrl = ''
  c.live = null
  c.activeProfile = 'default'
  let restoredProfile = ''
  let opened = ''
  c.connectInner = async (_url: string, _creds: unknown, _extras: unknown, profile?: string) => {
    restoredProfile = profile || ''
  }
  c.openSession = async (id: string) => { opened = id }
  await c.connect('http://gw', { token: 't' })
  assert.equal(restoredProfile, 'rin')
  assert.equal(opened, 'stored-rin')
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage
})

test('session.info and refreshLiveSessions keep background activity dots in sync', async () => {
  let emits = 0
  const c = new HermesClient(() => { emits += 1 }) as unknown as AnyClient
  c.live = live('s1')
  c.socket = { isOpen: true }
  c.transcript = { messages: [], streaming: false }
  c.sessions = [
    { id: 's1', title: 'Active', preview: '', source: 'local', model: '', updatedAt: 2, messageCount: 2, running: false, pinned: false },
    { id: 'tg-1', title: 'Telegram', preview: '', source: 'telegram', model: '', updatedAt: 1, messageCount: 4, running: false, pinned: false }
  ]
  c.onEvent({ type: 'session.info', session_id: 'tg-1', payload: { running: true } })
  assert.equal(c.transcript.streaming, false)
  assert.equal(c.sessions.find((row: { id: string }) => row.id === 'tg-1').running, true)

  const before = emits
  c.listSessions = async () => ({
    ok: true,
    value: {
      sessions: [
        { session_id: 'tg-1', title: 'Telegram', source: 'telegram', last_active_at: 3, message_count: 5, running: true }
      ]
    }
  })
  await c.refreshLiveSessions()
  assert.equal(c.sessions.find((row: { id: string }) => row.id === 'tg-1').running, true)
  assert.ok(emits > before)

  const afterRunning = emits
  await c.refreshLiveSessions()
  assert.equal(emits, afterRunning, 'unchanged poll should not emit extra snapshots')

  c.listSessions = async () => ({ ok: true, value: { sessions: [] } })
  await c.refreshLiveSessions()
  assert.equal(c.sessions.find((row: { id: string }) => row.id === 'tg-1').running, false)
  assert.ok(emits > afterRunning)
})

test('openSession paints cached transcripts immediately while refreshing in the background', async () => {
  const snapshots: Array<{ id: string; count: number }> = []
  const c = new HermesClient(() => {
    snapshots.push({ id: c.state.activeSessionId, count: c.state.transcript.messages.length })
  }) as unknown as AnyClient
  c.activeGatewayId = 'primary'
  c.activeProfile = 'rin'
  c.live = { live: 's1', stored: 's1', subscriptionId: 'sub-1' }
  c.transcript = {
    streaming: false,
    messages: [{ id: 'm1', role: 'user', text: 'cached hello', tools: [], pending: false }]
  }
  c.cacheActiveTranscript()
  c.live = { live: 's2', stored: 's2', subscriptionId: 'sub-2' }
  c.transcript = { streaming: false, messages: [] }
  c.tryRpc = async () => ({ ok: true })
  c.readReasoning = async () => undefined
  c.refreshModelOptions = async () => undefined
  let resolveResume: (value: unknown) => void = () => undefined
  c.rpc = () => new Promise(resolve => { resolveResume = resolve })

  const opening = c.openSession('s1')
  // Cached transcript is painted synchronously before session.resume resolves.
  assert.equal(c.state.activeSessionId, 's1')
  assert.equal(c.state.transcript.messages.length, 1)
  assert.equal(snapshots[0]?.id, 's1')
  assert.equal(snapshots[0]?.count, 1)

  resolveResume({
    session_id: 's1',
    stored_session_id: 's1',
    subscription_id: 'sub-3',
    running: false,
    messages: [
      { id: 'm1', role: 'user', content: 'cached hello' },
      { id: 'm2', role: 'assistant', content: 'fresh reply' }
    ]
  })
  await opening
  assert.equal(c.state.transcript.messages.length, 2)
})

test('selectProfile restores cached sessions immediately when switching back to a visited profile', async () => {
  const c = client()
  c.gateways = [{ id: 'primary', url: 'http://gw' }]
  c.profiles = [
    { gatewayId: 'primary', name: 'rin', label: 'Rin' },
    { gatewayId: 'primary', name: 'scout', label: 'Scout' }
  ]
  c.activeGatewayId = 'primary'
  c.activeProfile = 'rin'
  c.sessions = [{ id: 'rin-1', title: 'Rin chat', preview: '', source: 'local', model: '', updatedAt: 1, messageCount: 2, running: false, pinned: false }]
  c.socket = { isOpen: true }
  c.tryRpc = async () => ({ ok: true })
  c.refreshSessions = async () => undefined
  c.refreshSideData = async () => undefined

  await c.selectProfile('primary', 'scout')
  assert.equal(c.sessions.length, 0)

  await c.selectProfile('primary', 'rin')
  assert.equal(c.sessions.length, 1)
  assert.equal(c.sessions[0].id, 'rin-1')
})

test('refreshSideData reads fallback_providers and setFallbackModels persists cleaned entries via PUT /api/config', async () => {
  const c = client()
  c.activeProfile = 'rin'
  c.activeGatewayId = 'primary'
  c.getJson = async (path: string) => {
    if (path === '/api/config') {
      return {
        fallback_providers: [
          { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', base_url: 'https://custom.local/v1' },
          'openai/gpt-5-mini'
        ]
      }
    }
    return null
  }
  c.readReasoning = async () => undefined
  c.readGlobalReasoning = async () => undefined
  await c.refreshSideData()
  assert.equal(c.side.fallbackModels.length, 2)
  assert.equal(c.side.fallbackModels[0].provider, 'openrouter')
  assert.equal(c.side.fallbackModels[0].base_url, 'https://custom.local/v1')
  assert.equal(c.side.fallbackModels[1].provider, 'openai')
  assert.equal(c.side.fallbackModels[1].model, 'gpt-5-mini')

  let savedPath = ''
  let savedBody: any = null
  c.putJson = async (path: string, body: unknown) => {
    savedPath = path
    savedBody = body
    return { ok: true }
  }
  const note = await c.setFallbackModels([
    { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', base_url: 'https://custom.local/v1' },
    { provider: '', model: 'ignored-incomplete' }
  ])
  assert.equal(savedPath, '/api/config')
  assert.equal(savedBody.profile, 'rin')
  assert.deepEqual(savedBody.config.fallback_providers, [
    { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', base_url: 'https://custom.local/v1' }
  ])
  assert.equal(c.side.fallbackModels.length, 1)
  assert.match(note, /saved/i)

  const cleared = await c.setFallbackModels([])
  assert.deepEqual(savedBody.config.fallback_providers, [])
  assert.equal(c.side.fallbackModels.length, 0)
  assert.match(cleared, /cleared/i)
})
