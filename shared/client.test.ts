import assert from 'node:assert/strict'
import test from 'node:test'
import { HermesClient } from '../electron/hermes'
import type { SessionRow } from './protocol'

type Rpc = (method: string, params?: Record<string, unknown>) => Promise<unknown>
type GetJson = (path: string) => Promise<unknown>

const sessionRow = (id: string, model: string): SessionRow => ({
  id,
  title: id,
  preview: '',
  source: 'telegram',
  model,
  updatedAt: null,
  messageCount: 0,
  running: false,
  pinned: false
})

const modelsPayload = (model: string, provider = 'commandcode') => ({
  model,
  provider,
  providers: [{
    name: 'CommandCode',
    slug: provider,
    models: [
      { id: 'tencent/hy4-flash', label: 'hy4-flash' },
      { id: 'deepseek/deepseek-v4.1-flash', label: 'deepseek-v4.1-flash' },
      { id: 'glm-5.3', label: 'glm-5.3' }
    ]
  }]
})

function clientWithSession(id: string, sessionModel: string): HermesClient {
  const client = new HermesClient(() => undefined)
  ;(client as unknown as { sessions: SessionRow[] }).sessions = [sessionRow(id, sessionModel)]
  ;(client as unknown as { live: unknown }).live = { live: id, stored: id, subscriptionId: '' }
  return client
}

test('stageAttachment retries once after permission_denied by resubscribing', async () => {
  const client = new HermesClient(() => undefined)
  let attempts = 0
  let resumed = 0
  ;(client as unknown as { attachStaged: () => Promise<{ ref: string }> }).attachStaged = async () => {
    attempts += 1
    if (attempts === 1) throw new Error('permission_denied')
    return { ref: '@file:notes.md' }
  }
  ;(client as unknown as { resumeSubscription: (id: string) => Promise<void> }).resumeSubscription = async () => {
    resumed += 1
  }
  const file = { name: 'notes.md', mime: 'text/markdown', base64: 'IyBOb3Rlcw==' }
  const result = await (client as unknown as {
    stageAttachment: (id: string, file: unknown) => Promise<{ ref: string }>
  }).stageAttachment('20261119_091305_9daddf0f', file)
  assert.equal(result.ref, '@file:notes.md')
  assert.equal(attempts, 2)
  assert.equal(resumed, 1)
})

test('openSession ignores a stale history response after another session opens', async () => {
  const a = '20261119_091305_9daddf0f'
  const b = '20261119_200207_2ec3086e'
  const client = new HermesClient(() => undefined)
  ;(client as unknown as { sessions: SessionRow[] }).sessions = [sessionRow(a, 'tencent/hy4-flash'), sessionRow(b, 'glm-5.3')]
  ;(client as unknown as { rpc: Rpc }).rpc = async (method, params) => {
    if (method !== 'session.resume') throw new Error(`unexpected ${method}`)
    const id = String(params?.session_id || '')
    return {
      session_id: id,
      stored_session_id: id,
      display_messages: id === b ? [{ role: 'user', content: 'history B' }] : [],
      info: {},
      revision: 1,
      execution_generation: 1
    }
  }
  let releaseA: ((rows: unknown[]) => void) | null = null
  let askedForA = false
  ;(client as unknown as { getJson: GetJson }).getJson = async path => {
    if (path.includes('/api/model/options')) return modelsPayload('deepseek/deepseek-v4.1-flash', 'commandcode')
    if (path.includes(`/api/sessions/${a}/messages`)) {
      askedForA = true
      return await new Promise(resolve => { releaseA = resolve })
    }
    return null
  }
  const openingA = client.openSession(a)
  while (!askedForA) await new Promise(resolve => setTimeout(resolve, 0))
  await client.openSession(b)
  ;(releaseA as unknown as (rows: unknown[]) => void)([{ role: 'user', content: 'history A' }])
  await openingA
  assert.equal(client.state.activeSessionId, b)
  assert.match(client.state.transcript.messages.map(message => message.text).join(' '), /history B/)
  assert.doesNotMatch(client.state.transcript.messages.map(message => message.text).join(' '), /history A/)
})

test('reconnect resumes receipt polling for queued entries', async () => {
  const client = new HermesClient(() => undefined)
  let receipts = 0
  ;(client as unknown as { queued: unknown[] }).queued = [{
    id: 'queued-1', sessionId: 's1', text: 'hello', attachmentNames: [],
    status: 'queued', createdAt: Date.now(), admissionId: 'admission-1'
  }]
  ;(client as unknown as { rpc: Rpc }).rpc = async method => {
    if (method !== 'prompt.receipt') throw new Error(`unexpected ${method}`)
    receipts += 1
    return { status: 'terminal' }
  }
  await (client as unknown as { resumeQueuePolling: () => void }).resumeQueuePolling()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(receipts, 1)
  assert.equal((client as unknown as { queued: unknown[] }).queued.length, 0)
  client.disconnect()
})

test('ensureLive subscribes a newly created session before file attachment', async () => {
  const client = new HermesClient(() => undefined)
  let opened = ''
  ;(client as unknown as { createSession: () => Promise<{ live: string; stored: string }> }).createSession = async () => ({
    live: 'live-new',
    stored: 'stored-new'
  })
  ;(client as unknown as { openSession: (id: string) => Promise<void> }).openSession = async (id: string) => {
    opened = id
    ;(client as unknown as { live: unknown }).live = { live: 'live-new', stored: id, subscriptionId: 'sub-1' }
  }
  await (client as unknown as { ensureLive: () => Promise<void> }).ensureLive()
  assert.equal(opened, 'stored-new')
  assert.equal((client as unknown as { live: { subscriptionId: string } }).live.subscriptionId, 'sub-1')
})

test('openSession keeps the model from the session row, not the options payload', async () => {
  const client = clientWithSession('20261119_091305_9daddf0f', 'tencent/hy4-flash')
  ;(client as unknown as { rpc: Rpc }).rpc = async method => {
    assert.equal(method, 'session.resume')
    return {
      session_id: '20261119_091305_9daddf0f',
      stored_session_id: '20261119_091305_9daddf0f',
      display_messages: [{ role: 'user', content: 'hello' }],
      info: { model: 'deepseek/deepseek-v4.1-flash', provider: 'opencode-go' },
      revision: 1,
      execution_generation: 1
    }
  }
  ;(client as unknown as { getJson: GetJson }).getJson = async path => {
    if (path.includes('/messages')) return []
    if (path.includes('/api/model/options')) return modelsPayload('deepseek/deepseek-v4.1-flash', 'commandcode')
    return null
  }
  await client.openSession('20261119_091305_9daddf0f')
  assert.equal(client.side.models.currentModel, 'tencent/hy4-flash')
  assert.equal(client.side.models.currentProvider, 'commandcode')
})

test('switching sessions repaints model and reasoning for each session', async () => {
  const a = '20261119_091305_9daddf0f'
  const b = '20261119_200207_2ec3086e'
  const client = new HermesClient(() => undefined)
  ;(client as unknown as { sessions: SessionRow[] }).sessions = [
    sessionRow(a, 'tencent/hy4-flash'),
    sessionRow(b, 'glm-5.3')
  ]
  ;(client as unknown as { socket: { isOpen: boolean } }).socket = { isOpen: true }
  ;(client as unknown as { rpc: Rpc }).rpc = async (method, params) => {
    if (method === 'session.resume') {
      const id = String(params?.session_id || '')
      return {
        session_id: id,
        stored_session_id: id,
        display_messages: [{ role: 'user', content: 'hello' }],
        info: { model: 'deepseek/deepseek-v4.1-flash' },
        revision: 1,
        execution_generation: 1
      }
    }
    if (method === 'config.get') {
      return { value: params?.session_id === a ? 'high' : 'low' }
    }
    throw new Error(`unexpected ${method}`)
  }
  ;(client as unknown as { getJson: GetJson }).getJson = async path => {
    if (path.includes('/messages')) return []
    if (path.includes('/api/model/options')) return modelsPayload('deepseek/deepseek-v4.1-flash', 'commandcode')
    return null
  }
  await client.openSession(a)
  assert.equal(client.side.models.currentModel, 'tencent/hy4-flash')
  assert.equal(client.side.reasoning, 'high')
  await client.openSession(b)
  assert.equal(client.side.models.currentModel, 'glm-5.3')
  assert.equal(client.side.reasoning, 'low')
})

test('global reasoning is read independently of the session level', async () => {
  const client = new HermesClient(() => undefined)
  client.side.reasoning = 'low'
  ;(client as unknown as { socket: { isOpen: boolean } }).socket = { isOpen: true }
  ;(client as unknown as { rpc: Rpc }).rpc = async (method, params) => {
    assert.equal(method, 'config.get')
    assert.equal(params?.session_id, undefined)
    return { value: 'max' }
  }
  await (client as unknown as { readGlobalReasoning: () => Promise<void> }).readGlobalReasoning()
  assert.equal(client.side.globalReasoning, 'max')
  assert.equal(client.side.reasoning, 'low')
})

test('refreshSideData keeps the session header while reading the global default separately', async () => {
  const client = clientWithSession('20261119_091305_9daddf0f', 'tencent/hy4-flash')
  ;(client as unknown as { side: { models: { currentModel: string; currentProvider: string; models: unknown[] } } }).side.models = {
    currentModel: 'deepseek/deepseek-v4.1-flash',
    currentProvider: 'opencode-go',
    models: []
  }
  ;(client as unknown as { getJson: GetJson }).getJson = async path => {
    if (path.includes('session_id=')) return modelsPayload('deepseek/deepseek-v4.1-flash', 'opencode-go')
    if (path.endsWith('/api/model/options')) return modelsPayload('glm-5.3', 'opencode-go')
    return null
  }
  await (client as unknown as { refreshSideData: () => Promise<void> }).refreshSideData()
  assert.equal(client.side.models.currentModel, 'tencent/hy4-flash')
  assert.equal(client.side.globalModel, 'glm-5.3')
  assert.equal(client.side.globalProvider, 'opencode-go')
})

test('refreshSideData keeps the global provider when the inventory lists the same model under another provider', async () => {
  const client = clientWithSession('20261119_091305_9daddf0f', 'deepseek/deepseek-v4.1-flash')
  ;(client as unknown as { side: { models: { currentModel: string; currentProvider: string; models: unknown[] } } }).side.models = {
    currentModel: 'deepseek/deepseek-v4.1-flash',
    currentProvider: '',
    models: []
  }
  ;(client as unknown as { getJson: GetJson }).getJson = async path => {
    if (path.includes('session_id=')) return {
      model: 'deepseek/deepseek-v4.1-flash',
      provider: '',
      providers: [
        { name: 'Nous Portal', slug: 'nous', models: [{ id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }] },
        { name: 'OpenRouter', slug: 'openrouter', models: [{ id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }] }
      ]
    }
    if (path.endsWith('/api/model/options')) return {
      model: 'deepseek/deepseek-v4.1-flash',
      provider: 'opencode-go',
      providers: [{ name: 'OpenCode Go', slug: 'opencode-go', models: [{ id: 'deepseek/deepseek-v4.1-flash' }] }]
    }
    return null
  }
  await (client as unknown as { refreshSideData: () => Promise<void> }).refreshSideData()
  assert.equal(client.side.models.currentModel, 'deepseek/deepseek-v4.1-flash')
  assert.equal(client.side.models.currentProvider, 'opencode-go')
})

test('setSessionModel updates the row and the header, then survives a reopen', async () => {
  const id = '20261119_091305_9daddf0f'
  const client = clientWithSession(id, 'deepseek/deepseek-v4.1-flash')
  ;(client as unknown as { rpc: Rpc }).rpc = async method => {
    if (method === 'session.resume') return { revision: 1, execution_generation: 1 }
    if (method === 'session.mutate') return { status: 'ok', model: 'tencent/hy4-flash', provider: 'commandcode' }
    throw new Error(`unexpected ${method}`)
  }
  ;(client as unknown as { getJson: GetJson }).getJson = async path => {
    if (path.includes('/api/model/options')) return modelsPayload('deepseek/deepseek-v4.1-flash', 'opencode-go')
    return null
  }
  await client.setSessionModel('tencent/hy4-flash', 'commandcode')
  assert.equal(client.side.models.currentModel, 'tencent/hy4-flash')
  assert.equal(client.side.models.currentProvider, 'commandcode')
  assert.equal((client as unknown as { sessions: SessionRow[] }).sessions[0].model, 'tencent/hy4-flash')

  ;(client as unknown as { rpc: Rpc }).rpc = async method => {
    if (method !== 'session.resume') throw new Error(`unexpected ${method}`)
    return {
      session_id: id,
      stored_session_id: id,
      display_messages: [{ role: 'user', content: 'hello' }],
      info: { model: 'deepseek/deepseek-v4.1-flash' },
      revision: 1,
      execution_generation: 1
    }
  }
  await client.openSession(id)
  assert.equal(client.side.models.currentModel, 'tencent/hy4-flash')
})

test('reasoning header updates immediately and new chats use the global level', async () => {
  const client = clientWithSession('s1', 'deepseek/deepseek-v4.1-flash')
  ;(client as unknown as { rpc: Rpc }).rpc = async method => {
    if (method === 'config.set') return { value: 'high' }
    throw new Error(`unexpected ${method}`)
  }
  await client.setReasoning('high')
  assert.equal(client.side.reasoning, 'high')

  ;(client as unknown as { rpc: Rpc }).rpc = async method => {
    if (method === 'config.set') return { value: 'max' }
    throw new Error(`unexpected ${method}`)
  }
  await client.setGlobalReasoning('max')
  assert.equal(client.side.globalReasoning, 'max')
  assert.equal(client.side.reasoning, 'high')

  await client.newChat()
  assert.equal(client.side.reasoning, '')
})

test('readReasoning treats an inherited effort as no explicit session override', async () => {
  const client = new HermesClient(() => undefined)
  ;(client as unknown as { live: unknown }).live = { live: 's1', stored: 's1', subscriptionId: '' }
  ;(client as unknown as { socket: { isOpen: boolean } }).socket = { isOpen: true }
  ;(client as unknown as { rpc: Rpc }).rpc = async () => ({ value: 'medium', explicit: false, global: 'max' })
  await (client as unknown as { readReasoning: () => Promise<void> }).readReasoning()
  assert.equal(client.side.reasoning, '')
  ;(client as unknown as { rpc: Rpc }).rpc = async () => ({ value: 'high', explicit: true, global: 'max' })
  await (client as unknown as { readReasoning: () => Promise<void> }).readReasoning()
  assert.equal(client.side.reasoning, 'high')
})
