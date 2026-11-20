// Exercise the production client and renderer; replace only the gateway transport.
import { HermesClient } from '../electron/hermes'
import { installPreview } from '../src/preview'

installPreview('chat')
const api = window.icyteru
const base = await api.getSnapshot()
const listeners = new Set()
const admissions = new Map()
const requests = new Set()
const calls = []
const errors = []
const session = 'test-session'
const client = new HermesClient(() => {
  for (const listener of listeners) listener(snapshot())
})
client.live = { stored: session, live: session, subscriptionId: '' }
client.transcript = { messages: [], streaming: true }
function snapshot() {
  return structuredClone({ ...base, activeSessionId: client.state.activeSessionId,
    transcript: client.state.transcript, queued: client.state.queued })
}
function invalid(message) {
  errors.push(message)
  throw Error(message)
}
// AdmissionStatus (tui_gateway/contracts/canonical.py) is returned flat by all three RPCs.
function admit(requestId) {
  if (typeof requestId !== 'string' || !requestId || requests.has(requestId)) invalid('Expected a fresh request id')
  requests.add(requestId)
  const sequence = admissions.size + 1
  const receipt = { admission_id: `server-${sequence}`, ref: { profile_id: 'default', session_id: session },
    sequence, status: 'queued', outcome: null, authority_epoch: 1, execution_generation: null }
  admissions.set(receipt.admission_id, receipt)
  return structuredClone(receipt)
}
client.rpc = async (method, params) => {
  calls.push({ method, params })
  if (params.session_id !== session) invalid(`Wrong session for ${method}`)
  if (method === 'prompt.submit' && params.queued === true) return admit(params.submission_id ?? params.input_id)
  const old = admissions.get(params.admission_id)
  if (!old) invalid(`Unknown admission in ${method}`)
  if (method === 'prompt.receipt') return structuredClone(old)
  invalid(`Unexpected ${method}; prompt.cancel is not pending-only`)
}
Object.assign(api, {
  getSnapshot: async () => snapshot(),
  onSnapshot: listener => { listeners.add(listener); return () => listeners.delete(listener) },
  sendMessage: client.send.bind(client), queue: client.queue.bind(client), deleteQueued: client.deleteQueued.bind(client)
})
window.queueHarness = { calls, errors, finishNext() {
  const next = [...admissions.values()].find(row => row.status === 'queued')
  if (!next) throw Error('No queued gateway admission')
  Object.assign(next, { status: 'terminal', outcome: 'completed', execution_generation: next.sequence })
} }
await import('../src/main.tsx')
