import assert from 'node:assert/strict'
import test from 'node:test'
import { HermesSocket, closeMessage } from './gateway-socket'
import type { GatewayEventFrame, PendingQuestion } from './protocol'

class FakeSocket {
  static last: FakeSocket | null = null
  readyState = 0
  sent: string[] = []
  listeners = new Map<string, Array<(event: any) => void>>()
  constructor(public url: string, public protocols?: string[]) {
    FakeSocket.last = this
  }
  addEventListener(type: string, listener: (event: any) => void) {
    const list = this.listeners.get(type) || []
    list.push(listener)
    this.listeners.set(type, list)
  }
  emit(type: string, event: any = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event)
  }
  send(data: string) { this.sent.push(data) }
  close() {
    this.readyState = 3
    this.emit('close', { code: 1000, reason: 'bye' })
  }
}

test('socket connects, requests, receives events, and closes', async () => {
  const original = globalThis.WebSocket
  ;(globalThis as any).WebSocket = FakeSocket
  const events: GatewayEventFrame[] = []
  const questions: PendingQuestion[] = []
  let closeText = ''
  const socket = new HermesSocket({
    onEvent: event => events.push(event),
    onQuestion: question => questions.push(question),
    onClose: text => { closeText = text }
  })
  const connected = socket.connect('ws://gw/api/ws', ['p'])
  const fake = FakeSocket.last!
  fake.readyState = 1
  fake.emit('open')
  await connected
  assert.equal(socket.isOpen, true)
  const reply = socket.request('gateway.ping', { a: 1 })
  const sent = JSON.parse(fake.sent[0])
  assert.equal(sent.method, 'gateway.ping')
  fake.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { ok: true } }) })
  assert.deepEqual(await reply, { ok: true })

  fake.emit('message', { data: JSON.stringify({ method: 'event', params: { type: 'message.delta', session_id: 's', payload: { text: 'x' } } }) })
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'message.delta')

  fake.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: 'server-1', method: 'unknown.method', params: {} }) })
  assert.ok(fake.sent.some(text => text.includes('server-1') && text.includes('does not answer')))
  assert.equal(questions.length, 0)
  socket.close()
  assert.equal(socket.isOpen, false)
  ;(globalThis as any).WebSocket = original
})

test('closeMessage explains auth, origin, normal, and dropped closes', () => {
  assert.match(closeMessage(4401, ''), /session token/)
  assert.match(closeMessage(1008, ''), /session token/)
  assert.match(closeMessage(4403, 'origin mismatch'), /origin mismatch/)
  assert.match(closeMessage(1000, ''), /gateway closed/)
  assert.match(closeMessage(1006, ''), /dropped/)
  assert.match(closeMessage(4999, 'custom'), /custom/)
})

test('consecutive heartbeat timeouts close a dead zombie socket', async () => {
  const original = globalThis.WebSocket
  ;(globalThis as any).WebSocket = FakeSocket
  let closedReason = ''
  const socket = new HermesSocket({
    onEvent: () => undefined,
    onQuestion: () => undefined,
    onClose: text => { closedReason = text }
  }, { heartbeatMs: 15, pingTimeoutMs: 10, maxMissedPings: 2 })
  try {
    const connected = socket.connect('ws://gw/api/ws')
    const fake = FakeSocket.last!
    fake.readyState = 1
    fake.emit('open')
    await connected
    await new Promise(resolve => setTimeout(resolve, 90))
    assert.equal(fake.readyState, 3)
    assert.ok(closedReason.length > 0)
  } finally {
    socket.close()
    ;(globalThis as any).WebSocket = original
  }
})
